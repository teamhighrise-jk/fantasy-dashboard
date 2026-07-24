import type {
  FantasyProvider,
  LeagueStanding,
  NormalizedPlayer,
  NormalizedTeam,
  PlayerKind,
  PlayerSlotKind,
} from "@/lib/types";
import { getCbsConfig, type CbsConfig } from "@/lib/config";
import { teamsConflict, normalizeName } from "@/lib/teams";

/**
 * CBS Sports fantasy baseball adapter.
 *
 * CBS has no clean public API. Two ways in, in order of preference:
 *
 *  1. API-token mode (CBS_ACCESS_TOKEN set): hits api.cbssports.com. Your league
 *     must have API access enabled (League Office → "API Access"); CBS then shows
 *     a long-lived access token. This is the robust path.
 *
 *  2. Cookie/scrape mode (CBS_COOKIE set): falls back to fetching the authenticated
 *     league HTML and parsing it. Brittle; only used if no token is available.
 *
 * NOTE: CBS's JSON field names are not officially documented and vary by sport/era.
 * The normalizer below reads several likely field names defensively, and the raw
 * response is logged once (server console) so we can lock the mapping to YOUR
 * league's actual shape on first run.
 */

const API_HOST = "https://api.cbssports.com/fantasy";

/** Loose shape — CBS responses are not strictly typed; we read defensively. */
type CbsAny = Record<string, unknown>;

function pick(obj: CbsAny, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return "";
}

/** Build an authenticated CBS fantasy API URL. The token must be URL-encoded. */
function buildApiUrl(token: string, path: string): string {
  return (
    `${API_HOST}${path}?version=3.0&SPORT=baseball` +
    `&response_format=json&access_token=${encodeURIComponent(token)}`
  );
}

const FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (fantasy-dashboard)",
};

export interface CbsInjuryInfo {
  expectedReturn?: string;
  injury?: string;
  status?: string;
  /** CBS pro-team abbreviation, for cross-provider match disambiguation. */
  proTeam?: string;
}

/** A name-keyed lookup over CBS's league-wide injury report. */
export interface CbsInjuryIndex {
  lookup(name: string): CbsInjuryInfo | undefined;
  size: number;
}

/**
 * Fetch CBS's league-wide injury report (`/players/injuries`) and index it by
 * normalized player name. CBS is the only configured source that exposes an
 * expected-return estimate, so this lets us enrich injured players from other
 * providers (e.g. ESPN) that don't.
 *
 * Returns null if CBS isn't configured with an access token. Throws on a failed
 * request — callers treat this as best-effort and ignore failures.
 */
export async function fetchCbsInjuryIndex(): Promise<CbsInjuryIndex | null> {
  const cfg = getCbsConfig();
  if (!cfg?.accessToken) return null;

  const res = await fetch(buildApiUrl(cfg.accessToken, "/players/injuries"), {
    headers: FETCH_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CBS injuries request failed: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as CbsAny;
  const body = (json.body ?? json) as CbsAny;
  const rows = (body.injuries ?? []) as CbsAny[];

  const byName = new Map<string, CbsInjuryInfo>();
  for (const r of rows) {
    const player = (r.player ?? {}) as CbsAny;
    const key = normalizeName(pick(player, "fullname", "name"));
    if (!key || byName.has(key)) continue; // first entry wins on duplicate names
    byName.set(key, {
      expectedReturn: pick(r, "expected_return") || undefined,
      injury: pick(r, "injury_type") || undefined,
      status: pick(r, "status_full", "status") || undefined,
      proTeam: pick(player, "pro_team", "team", "proteam") || undefined,
    });
  }

  return {
    lookup: (name: string) => byName.get(normalizeName(name)),
    size: byName.size,
  };
}

// ── Player id index (name → CBS player id, for player-page links) ────────────

export interface CbsPlayerIndex {
  /** CBS player id for a name (team guards same-name collisions), or undefined. */
  lookup(name: string, proTeam?: string): string | undefined;
}

/**
 * Build a name → CBS-player-id index from `/players/list` (CBS's full player
 * directory). Used to link free agents to their CBS player page
 * (`https://<host>.baseball.cbssports.com/players/playerpage/<id>`).
 * Returns null if CBS isn't configured. Throws on a failed request.
 */
export async function fetchCbsPlayerIndex(): Promise<CbsPlayerIndex | null> {
  const cfg = getCbsConfig();
  if (!cfg?.accessToken) return null;

  const res = await fetch(buildApiUrl(cfg.accessToken, "/players/list"), {
    headers: FETCH_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CBS players/list failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as CbsAny;
  const players = (((json.body ?? json) as CbsAny).players ?? []) as CbsAny[];

  const byName = new Map<string, { id: string; team: string }>();
  for (const p of players) {
    const id = pick(p, "id", "player_id");
    const key = normalizeName(pick(p, "fullname", "name"));
    if (!id || !key || byName.has(key)) continue; // first wins on dup names
    byName.set(key, { id, team: pick(p, "pro_team", "team", "proteam") });
  }

  return {
    lookup(name, proTeam) {
      const rec = byName.get(normalizeName(name));
      if (!rec) return undefined;
      if (teamsConflict(proTeam, rec.team)) return undefined;
      return rec.id;
    },
  };
}

// ── ROS rankings (Free Agents) ───────────────────────────────────────────────

export interface CbsRankedPlayer {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  kind: PlayerKind;
  /** Rest-of-season rank used for ordering (lower = better). See heuristic below. */
  rosRank: number;
  /** CBS team id that owns this player, or null if a free agent in the CBS league. */
  ownedByTeamId: string | null;
}

export interface CbsRosRankings {
  /** Ranking source name, e.g. "cbs_avg_roto". */
  source: string;
  /** All ranked players, deduped, hitters and pitchers. */
  players: CbsRankedPlayer[];
  /**
   * ROS rank for a player by name within a kind — used to rank ESPN free agents.
   * `proTeam` guards against same-name collisions: a match is rejected when both
   * teams are known and differ (blank on either side still matches).
   */
  rankByName(name: string, kind: PlayerKind, proTeam?: string): number | undefined;
}

/** CBS ranking position groups that are hitters. "U" (utility) is the overall hitter list. */
const HITTER_POSITION_GROUPS = ["C", "1B", "2B", "3B", "SS", "OF", "DH"];

function rankedFrom(p: CbsAny, kind: PlayerKind, rosRank: number): CbsRankedPlayer {
  const owned = pick(p, "owned_by_team_id");
  return {
    id: pick(p, "id", "player_id"),
    name: pick(p, "fullname", "name"),
    position: pick(p, "position", "eligible_positions_display"),
    proTeam: pick(p, "pro_team", "team", "proteam"),
    kind,
    rosRank,
    ownedByTeamId: owned && owned !== "0" ? owned : null,
  };
}

/**
 * Fetch CBS's rest-of-season roto rankings (`/players/rankings?period=ros`) and
 * flatten the position-grouped response into one ranked list of hitters and
 * pitchers, each carrying CBS-league ownership (so free agents are detectable).
 *
 * Cross-position ranking heuristic (CBS exposes only per-position ranks, no
 * single global number):
 *  - Hitters: use the "U" (utility) group as the overall hitter ranking; hitters
 *    outside the top-100 U list fall after it, ordered by their best positional
 *    rank (offset by 100).
 *  - Pitchers: SP and RP are merged on their positional rank, with RP nudged
 *    behind SP on ties (rank + 0.5) since there's no combined pitcher ranking.
 * This is a "for now" approximation — see the planned third-party ROS source.
 *
 * Returns null if CBS isn't configured. Throws on a failed request.
 */
export async function fetchCbsRosRankings(): Promise<CbsRosRankings | null> {
  const cfg = getCbsConfig();
  if (!cfg?.accessToken) return null;

  const res = await fetch(buildApiUrl(cfg.accessToken, "/players/rankings") + "&period=ros", {
    headers: FETCH_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CBS rankings request failed: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as CbsAny;
  const rankings = ((json.body ?? json) as CbsAny).rankings as CbsAny;
  const source = pick(rankings, "source") || "cbs_roto";
  const groups = new Map<string, CbsAny[]>();
  for (const g of (rankings.positions ?? []) as CbsAny[]) {
    groups.set(pick(g, "abbr", "position"), (g.players ?? []) as CbsAny[]);
  }
  const rankOf = (p: CbsAny) => Number(pick(p, "rank")) || 9999;
  const players: CbsRankedPlayer[] = [];

  // Hitters: overall "U" rank, deepening with positional rank for non-U players.
  const uRankById = new Map<string, number>();
  for (const p of groups.get("U") ?? []) uRankById.set(pick(p, "id"), rankOf(p));

  const hitterById = new Map<string, { p: CbsAny; bestPos: number }>();
  for (const ab of HITTER_POSITION_GROUPS) {
    for (const p of groups.get(ab) ?? []) {
      const id = pick(p, "id");
      if (!id) continue;
      const cur = hitterById.get(id);
      if (!cur || rankOf(p) < cur.bestPos) hitterById.set(id, { p, bestPos: rankOf(p) });
    }
  }
  for (const p of groups.get("U") ?? []) {
    const id = pick(p, "id");
    if (id && !hitterById.has(id)) hitterById.set(id, { p, bestPos: 9999 });
  }
  for (const { p, bestPos } of hitterById.values()) {
    const id = pick(p, "id");
    const rosRank = uRankById.has(id) ? uRankById.get(id)! : 100 + bestPos;
    players.push(rankedFrom(p, "hitter", rosRank));
  }

  // Pitchers: merge SP + RP on positional rank, RP nudged behind SP on ties.
  const pitcherById = new Map<string, number>();
  for (const ab of ["SP", "RP"]) {
    for (const p of groups.get(ab) ?? []) {
      const id = pick(p, "id");
      if (!id) continue;
      const rosRank = ab === "RP" ? rankOf(p) + 0.5 : rankOf(p);
      const cur = pitcherById.get(id);
      if (cur === undefined || rosRank < cur) pitcherById.set(id, rosRank);
    }
  }
  for (const [id, rosRank] of pitcherById) {
    const p = (groups.get("SP") ?? []).concat(groups.get("RP") ?? []).find((x) => pick(x, "id") === id)!;
    players.push(rankedFrom(p, "pitcher", rosRank));
  }

  const hitterByName = new Map<string, { rosRank: number; proTeam: string }>();
  const pitcherByName = new Map<string, { rosRank: number; proTeam: string }>();
  for (const pl of players) {
    const map = pl.kind === "hitter" ? hitterByName : pitcherByName;
    const key = normalizeName(pl.name);
    if (!key) continue;
    const cur = map.get(key);
    if (cur === undefined || pl.rosRank < cur.rosRank) {
      map.set(key, { rosRank: pl.rosRank, proTeam: pl.proTeam });
    }
  }

  return {
    source,
    players,
    rankByName: (name, kind, proTeam) => {
      const hit = (kind === "hitter" ? hitterByName : pitcherByName).get(normalizeName(name));
      if (!hit) return undefined;
      if (teamsConflict(proTeam, hit.proTeam)) return undefined;
      return hit.rosRank;
    },
  };
}

/**
 * CBS signals lineup membership via `roster_status`, NOT `roster_pos` (which is
 * just the player's position label). Observed values: A=active/starter,
 * RS=reserve/bench, ML=minor-league (bench), I=injured (IL).
 */
function classifyRosterStatus(status: string): PlayerSlotKind {
  const s = status.toUpperCase();
  if (s === "I" || s === "IL" || s === "DL" || s === "IR") return "injured";
  if (s === "RS" || s === "ML" || s === "RES" || s === "BE") return "bench";
  return "starter";
}

/** UI slot label, consistent with the ESPN adapter (BE for bench, IL for injured). */
function slotLabelFor(kind: PlayerSlotKind, rosterPos: string): string {
  if (kind === "injured") return "IL";
  if (kind === "bench") return "BE";
  return rosterPos || "";
}

export class CbsProvider implements FantasyProvider {
  id = "cbs" as const;
  label = "CBS";
  constructor(private cfg: CbsConfig) {}

  async fetchTeams(): Promise<NormalizedTeam[]> {
    if (this.cfg.accessToken) return this.fetchViaApi();
    if (this.cfg.cookie) return this.fetchViaScrape();
    throw new Error(
      "CBS not configured: set CBS_ACCESS_TOKEN (preferred) or CBS_COOKIE in .env.local."
    );
  }

  private async getJson(path: string): Promise<CbsAny> {
    const res = await fetch(buildApiUrl(this.cfg.accessToken!, path), {
      headers: FETCH_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CBS request failed (${path}): ${res.status} ${res.statusText}`);
    return (await res.json()) as CbsAny;
  }

  /**
   * Overall standings (record + season points). This is an H2H *and* points
   * league, so we surface both: W/L/T from the head-to-head record and
   * `points_scored` as the season point total. Standings live under
   * body.overall_standings.divisions[].teams[]. Best-effort — callers treat a
   * failure here as "record unknown", not a fatal error.
   */
  private async fetchStandings(): Promise<{
    byId: Map<string, { wins: number; losses: number; ties: number; pointsFor?: number; rank?: number }>;
    league: LeagueStanding[];
  }> {
    const json = await this.getJson("/league/standings/overall");
    const body = (json.body ?? json) as CbsAny;
    const standings = (body.overall_standings ?? body) as CbsAny;
    const divisions = (standings.divisions ?? []) as CbsAny[];
    // Keep each team's division label alongside its row. CBS puts the division
    // name on the division node's `id` (e.g. "Broken Controller"); the team row
    // also carries its own `division` field, which we prefer when present.
    const rows = divisions.flatMap((d) => {
      const division = pick(d, "name", "division_name", "abbr", "id") || undefined;
      return ((d.teams ?? d.team ?? []) as CbsAny[]).map((t) => ({ t, division }));
    });

    // Overall rank by head-to-head winning pct, then season points as tiebreak.
    const ranked = [...rows].sort((a, b) => {
      const pa = Number(pick(a.t, "winning_pct")) || 0;
      const pb = Number(pick(b.t, "winning_pct")) || 0;
      if (pb !== pa) return pb - pa;
      return (Number(pick(b.t, "points_scored")) || 0) - (Number(pick(a.t, "points_scored")) || 0);
    });

    const byId = new Map<
      string,
      { wins: number; losses: number; ties: number; pointsFor?: number; rank?: number }
    >();
    ranked.forEach(({ t }, i) => {
      const id = pick(t, "id", "team_id", "teamid");
      if (!id) return;
      const pts = Number(pick(t, "points_scored"));
      byId.set(id, {
        wins: Number(pick(t, "wins")) || 0,
        losses: Number(pick(t, "losses")) || 0,
        ties: Number(pick(t, "ties")) || 0,
        pointsFor: Number.isFinite(pts) ? Math.round(pts * 100) / 100 : undefined,
        rank: i + 1,
      });
    });

    // The standings PANEL: the whole league sorted by POINTS desc (record +
    // division are shown but not used for sorting/grouping).
    const league: LeagueStanding[] = rows
      .map(({ t, division }) => {
        const pts = Number(pick(t, "points_scored"));
        return {
          teamId: pick(t, "id", "team_id", "teamid"),
          teamName: pick(t, "name", "team_name") || "—",
          points: Number.isFinite(pts) ? Math.round(pts * 100) / 100 : 0,
          record: {
            wins: Number(pick(t, "wins")) || 0,
            losses: Number(pick(t, "losses")) || 0,
            ties: Number(pick(t, "ties")) || 0,
          },
          division: pick(t, "division") || division,
        };
      })
      .filter((s) => s.teamId)
      .sort((a, b) => b.points - a.points);

    return { byId, league };
  }

  /** API-token path against api.cbssports.com. */
  private async fetchViaApi(): Promise<NormalizedTeam[]> {
    // Rosters and standings are independent calls — fetch them together. Rosters
    // is required; standings is best-effort (record/points are nice-to-have).
    const [json, standings] = await Promise.all([
      this.getJson("/league/rosters"),
      this.fetchStandings().catch((e) => {
        console.warn("[cbs] standings fetch failed, record/points unavailable:", e.message);
        return null;
      }),
    ]);

    // Log once so we can verify the real field names on first run.
    console.log("[cbs] raw rosters response (first run inspection):", JSON.stringify(json).slice(0, 2000));

    const body = (json.body ?? json) as CbsAny;
    // CBS nests the team list under body.rosters.teams (rosters also carries
    // period/lineup-optimizer metadata, so it is an object, not the array).
    const rostersNode = (body.rosters ?? body) as CbsAny;
    const teams = ((rostersNode.teams ?? body.teams ?? []) as CbsAny[]) || [];
    const wanted = String(this.cfg.teamId);

    // The rosters endpoint returns only the owner's team(s); match by id, but
    // fall back to the sole team if the id space ever differs.
    const team =
      teams.find((r) => pick(r, "id", "team_id", "teamid") === wanted) ??
      (teams.length === 1 ? teams[0] : undefined);
    if (!team) {
      const ids = teams.map((r) => pick(r, "id", "team_id", "teamid")).filter(Boolean).join(", ");
      throw new Error(`CBS team id ${wanted} not found. Available ids: ${ids || "none"}.`);
    }

    const leagueName = pick(body, "league_name", "name") || `CBS League (${this.cfg.leagueHost})`;
    const players = (team.players ?? team.roster ?? []) as CbsAny[];

    const roster: NormalizedPlayer[] = players.map((p): NormalizedPlayer => {
      const rosterPos = pick(p, "roster_pos", "lineup_pos", "slot");
      const kind = classifyRosterStatus(pick(p, "roster_status", "status") || "A");
      // eligible_positions_display is the clean comma list (no "U" utility slot);
      // fall back to `eligible` and strip the utility pseudo-slot.
      const eligible = (pick(p, "eligible_positions_display", "eligible") || "")
        .split(/[,\s]+/)
        .filter((x) => x && x.toUpperCase() !== "U");
      return {
        id: pick(p, "id", "player_id"),
        name: pick(p, "fullname", "name", "fullName"),
        position: pick(p, "position", "pos", "primary_position"),
        eligiblePositions: Array.from(new Set(eligible)),
        proTeam: pick(p, "pro_team", "team", "proteam"),
        slot: kind,
        slotLabel: slotLabelFor(kind, rosterPos),
        injuryStatus: kind === "injured" ? pick(p, "injury_status", "headline") || "IL" : undefined,
        // CBS exposes a free-text return estimate on its `return` field,
        // e.g. "Expected to be out until at least Jun 16".
        expectedReturn: kind === "injured" ? pick(p, "return") || undefined : undefined,
      };
    });

    const teamId = pick(team, "id", "team_id", "teamid") || wanted;
    // Record and season points come from the standings call (the rosters
    // endpoint carries neither). Falls back to 0 / undefined if standings failed.
    const stand = standings?.byId.get(teamId);
    const leagueStandings = standings?.league.map((s) => ({ ...s, isUser: s.teamId === teamId }));

    return [
      {
        provider: "cbs",
        providerLabel: "CBS",
        leagueId: this.cfg.leagueHost,
        leagueName,
        season: this.cfg.season,
        teamId,
        teamName: pick(team, "name", "team_name") || `Team ${wanted}`,
        abbrev: pick(team, "abbr", "abbrev"),
        record: {
          wins: stand?.wins ?? 0,
          losses: stand?.losses ?? 0,
          ties: stand?.ties ?? 0,
        },
        rank: stand?.rank,
        pointsFor: stand?.pointsFor,
        standings: leagueStandings,
        roster,
      },
    ];
  }

  /**
   * Cookie/scrape fallback. The exact HTML structure of the CBS roster page is
   * not yet known to this code, so parsing is intentionally left as a clearly
   * marked TODO rather than guessed — guessed selectors would silently break.
   * Provide a sample of the roster page HTML and this gets filled in.
   */
  private async fetchViaScrape(): Promise<NormalizedTeam[]> {
    throw new Error(
      "CBS cookie/scrape mode is not implemented yet — prefer CBS_ACCESS_TOKEN. " +
        "To enable scraping, share a sample of your CBS roster page HTML so the parser can be written against the real markup."
    );
  }
}

export function createCbsProvider(): CbsProvider | null {
  const cfg = getCbsConfig();
  return cfg ? new CbsProvider(cfg) : null;
}
