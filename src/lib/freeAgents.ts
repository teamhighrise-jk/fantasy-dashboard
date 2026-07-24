import type {
  AvailabilityResponse,
  FreeAgentPlayer,
  FreeAgentsResponse,
  LeagueFreeAgents,
  PlayerKind,
  ProviderId,
} from "@/lib/types";
import { getEspnConfig, getCbsConfig } from "@/lib/config";
import { fetchEspnFreeAgents } from "@/lib/espn/client";
import {
  fetchCbsRosRankings,
  fetchCbsPlayerIndex,
  fetchCbsInjuryIndex,
  type CbsRankedPlayer,
  type CbsRosRankings,
} from "@/lib/cbs/client";
import {
  fetchFantasyProsFreeAgents,
  fetchFantasyProsAvailability,
} from "@/lib/fantasypros/client";
import { getStatsIndex } from "@/lib/stats";
import { normalizeName, teamsConflict, cleanPositions } from "@/lib/teams";
import { getConfiguredProviders, fetchTeamsForProvider } from "@/lib/providers";

/** How many of each kind (hitters, pitchers) to show per league. */
const TOP_N = 100;

function topN(players: FreeAgentPlayer[]): FreeAgentPlayer[] {
  return [...players].sort((a, b) => a.rosRank - b.rosRank).slice(0, TOP_N);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The add/drop (free-agent) page URL for a league's fantasy site, from config. */
function addDropUrl(provider: ProviderId): string | undefined {
  if (provider === "espn") {
    const cfg = getEspnConfig();
    return cfg ? `https://fantasy.espn.com/baseball/players/add?leagueId=${cfg.leagueId}` : undefined;
  }
  const cfg = getCbsConfig();
  return cfg ? `https://${cfg.leagueHost}.baseball.cbssports.com/stats/stats-main` : undefined;
}

/** Build the CBS league's free agents directly from CBS's ROS rankings + ownership. */
function cbsLeague(rankings: CbsRosRankings): LeagueFreeAgents {
  const cfg = getCbsConfig();
  const toFa = (p: CbsRankedPlayer): FreeAgentPlayer => ({
    id: p.id,
    name: p.name,
    position: p.position,
    proTeam: p.proTeam,
    kind: p.kind,
    rosRank: p.rosRank,
    rosRankSource: rankings.source,
  });
  const available = rankings.players.filter((p) => !p.ownedByTeamId);
  return {
    provider: "cbs",
    providerLabel: "CBS",
    leagueName: cfg?.leagueHost ?? "",
    hitters: topN(available.filter((p) => p.kind === "hitter").map(toFa)),
    pitchers: topN(available.filter((p) => p.kind === "pitcher").map(toFa)),
  };
}

/**
 * Build the ESPN league's free agents: ESPN supplies the available pool, CBS's
 * ROS ranking supplies the ordering (matched by name + kind). ESPN free agents
 * with no CBS rank are dropped from the top-N lists.
 */
async function espnLeague(rankings: CbsRosRankings | null): Promise<LeagueFreeAgents | null> {
  const cfg = getEspnConfig();
  if (!cfg) return null;

  const fas = await fetchEspnFreeAgents();
  if (!fas) return null;

  const ranked: FreeAgentPlayer[] = [];
  if (rankings) {
    for (const fa of fas) {
      const rosRank = rankings.rankByName(fa.name, fa.kind, fa.proTeam);
      if (rosRank === undefined) continue; // unranked by CBS (or team mismatch) — skip
      ranked.push({
        id: fa.id,
        name: fa.name,
        position: fa.position,
        proTeam: fa.proTeam,
        kind: fa.kind,
        rosRank,
        rosRankSource: rankings.source,
      });
    }
  }

  return {
    provider: "espn",
    providerLabel: "ESPN",
    leagueName: cfg.leagueId,
    hitters: topN(ranked.filter((p) => p.kind === "hitter")),
    pitchers: topN(ranked.filter((p) => p.kind === "pitcher")),
    rankingNote: rankings
      ? "Ranked by CBS rest-of-season roto (ESPN exposes no ROS ranking)"
      : "ROS ranking unavailable — CBS rankings could not be loaded",
  };
}

/**
 * Assemble per-league free-agent lists.
 *
 * Preferred source is FantasyPros (league-synced, scoring-aware ROS rankings of
 * already-available players) when configured. If FantasyPros isn't configured we
 * fall back to the legacy approach: CBS's ROS roto ranking used for both leagues
 * (ESPN free agents matched by name) — see `legacyFreeAgents`.
 */
// In-process cache of the assembled response. The payload (top-N lists + stats)
// is small; the cost we're avoiding is ~9 external fetches (FantasyPros ~14MB
// pages, Savant CSVs, FanGraphs). TTL keeps it fresh enough; the Refresh button
// passes force to bypass it.
const CACHE_TTL_MS = 20 * 60 * 1000;
let cache: { at: number; value: FreeAgentsResponse } | null = null;

export async function getFreeAgents(opts: { force?: boolean } = {}): Promise<FreeAgentsResponse> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  // Free-agent lists, the advanced-stats index, and the CBS player-id index are
  // independent — fetch together.
  const [base, statsIndex, cbsPlayers] = await Promise.all([
    assembleFreeAgents(),
    getStatsIndex().catch(() => null),
    fetchCbsPlayerIndex().catch(() => null),
  ]);

  if (statsIndex) {
    for (const league of base.leagues) {
      for (const player of [...league.hitters, ...league.pitchers]) {
        const m = statsIndex.lookup(player.name, player.kind, player.proTeam);
        if (m) {
          player.stats = m.stats;
          player.mlbamId = m.mlbamId;
          player.fgPlayerId = m.fgPlayerId;
        }
      }
    }
  }

  // Per-league add/drop (free-agent) page on each fantasy site (the fallback
  // destination for a player name, opens in the user's logged-in browser).
  for (const league of base.leagues) {
    league.addDropUrl = addDropUrl(league.provider) ?? league.addDropUrl;
  }

  // CBS: link each free agent's name straight to their CBS player page (has an
  // Add button) — player-specific, overriding the league fallback. Matched by
  // name+team to a CBS player id.
  const cbsHost = getCbsConfig()?.leagueHost;
  if (cbsPlayers && cbsHost) {
    for (const league of base.leagues) {
      if (league.provider !== "cbs") continue;
      for (const player of [...league.hitters, ...league.pitchers]) {
        const id = cbsPlayers.lookup(player.name, player.proTeam);
        if (id) player.addDropUrl = `https://${cbsHost}.baseball.cbssports.com/players/playerpage/${id}`;
      }
    }
  }

  const value: FreeAgentsResponse = {
    leagues: base.leagues,
    errors: base.errors,
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Source the free-agent lists: FantasyPros when configured, else the legacy path. */
async function assembleFreeAgents(): Promise<{
  leagues: LeagueFreeAgents[];
  errors: Partial<Record<ProviderId, string>>;
}> {
  let fp: Awaited<ReturnType<typeof fetchFantasyProsFreeAgents>> = null;
  try {
    fp = await fetchFantasyProsFreeAgents();
  } catch {
    fp = null;
  }
  if (fp) return { leagues: fp.leagues, errors: fp.errors };

  return legacyFreeAgents();
}

/** Legacy free-agent assembly from CBS/ESPN directly (pre-FantasyPros). */
async function legacyFreeAgents(): Promise<{
  leagues: LeagueFreeAgents[];
  errors: Partial<Record<ProviderId, string>>;
}> {
  const errors: Partial<Record<ProviderId, string>> = {};

  let rankings: CbsRosRankings | null = null;
  try {
    rankings = await fetchCbsRosRankings();
  } catch (e) {
    errors.cbs = errMsg(e);
  }

  const leagues: LeagueFreeAgents[] = [];

  // CBS league (only when its rankings loaded and CBS is configured).
  if (rankings && getCbsConfig()) leagues.push(cbsLeague(rankings));

  // ESPN league (availability from ESPN, ranking from CBS).
  try {
    const espn = await espnLeague(rankings);
    if (espn) leagues.push(espn);
  } catch (e) {
    errors.espn = errMsg(e);
  }

  return { leagues, errors };
}

/**
 * Free-agent availability for the Watchlist: which of our known players are
 * currently available in each league, with the add/drop URL to act on them.
 *
 * Matches the COMPLETE FantasyPros available pool (per league) against the stats
 * index by normalized name + kind + a team safeguard, keyed by the same player
 * ids the Watchlist uses (PlayerStatsEntry.id). CBS gets a per-player CBS page
 * link (same as the Free Agents tab); ESPN uses the league add hub.
 */
const AVAIL_TTL_MS = 20 * 60 * 1000;
let availCache: { at: number; value: AvailabilityResponse } | null = null;

export async function getWatchlistAvailability(
  opts: { force?: boolean } = {}
): Promise<AvailabilityResponse> {
  if (!opts.force && availCache && Date.now() - availCache.at < AVAIL_TTL_MS) return availCache.value;

  const [statsIndex, avail, cbsPlayers, teams, injuries] = await Promise.all([
    getStatsIndex().catch(() => null),
    fetchFantasyProsAvailability().catch(() => null),
    fetchCbsPlayerIndex().catch(() => null),
    // Rosters give eligibility for players we own (available pool covers the rest).
    Promise.all(getConfiguredProviders().map((p) => fetchTeamsForProvider(p).catch(() => [])))
      .then((a) => a.flat())
      .catch(() => []),
    // CBS's league-wide injury report (has return dates) — same source Teams uses.
    fetchCbsInjuryIndex().catch(() => null),
  ]);

  const byId: Record<string, { espn?: string; cbs?: string }> = {};
  const positionsById: Record<string, string[]> = {};
  const injuryById: Record<string, string> = {};
  const errors: Partial<Record<ProviderId, string>> = avail?.errors ?? {};
  const cbsHost = getCbsConfig()?.leagueHost;

  // Union new positions into a player's eligibility (cleaned + deduped).
  const addPositions = (id: string, list: string[] | undefined) => {
    const clean = cleanPositions(list);
    if (clean.length === 0) return;
    const cur = positionsById[id] ?? [];
    for (const p of clean) if (!cur.includes(p)) cur.push(p);
    positionsById[id] = cur;
  };

  if (statsIndex && avail) {
    for (const league of avail.leagues) {
      // Normalized-name → candidate available players (team + add/drop URL + eligibility).
      const candidates = new Map<
        string,
        { team: string; kind: PlayerKind; url?: string; positions: string[] }[]
      >();
      for (const p of league.players) {
        const key = normalizeName(p.name);
        if (!key) continue;
        let url = addDropUrl(league.provider);
        if (league.provider === "cbs" && cbsPlayers && cbsHost) {
          const id = cbsPlayers.lookup(p.name, p.proTeam);
          if (id) url = `https://${cbsHost}.baseball.cbssports.com/players/playerpage/${id}`;
        }
        const arr = candidates.get(key) ?? [];
        arr.push({ team: p.proTeam, kind: p.kind, url, positions: p.positions });
        candidates.set(key, arr);
      }

      for (const e of statsIndex.all) {
        const cand = candidates.get(normalizeName(e.name));
        if (!cand) continue;
        const hit = cand.find((c) => c.kind === e.kind && !teamsConflict(e.team, c.team));
        if (!hit) continue;
        (byId[e.id] ??= {})[league.provider] = hit.url;
        addPositions(e.id, hit.positions);
      }
    }
  }

  // Rostered players (our own teams): eligibility from the provider rosters.
  if (statsIndex && teams.length) {
    const roster = new Map<string, { team: string; kind: PlayerKind; positions: string[] }[]>();
    for (const t of teams) {
      for (const pl of t.roster) {
        const key = normalizeName(pl.name);
        if (!key) continue;
        const kind: PlayerKind = /^(SP|RP|P)$/i.test(pl.position.trim()) ? "pitcher" : "hitter";
        const arr = roster.get(key) ?? [];
        arr.push({ team: pl.proTeam, kind, positions: pl.eligiblePositions });
        roster.set(key, arr);
      }
    }
    for (const e of statsIndex.all) {
      const cand = roster.get(normalizeName(e.name));
      if (!cand) continue;
      const hit = cand.find((c) => c.kind === e.kind && !teamsConflict(e.team, c.team));
      if (hit) addPositions(e.id, hit.positions);
    }
  }

  // Injuries: any known player in CBS's injury report (matched by name + team
  // guard) gets an IL note — presence in the report means currently injured.
  if (statsIndex && injuries) {
    for (const e of statsIndex.all) {
      const info = injuries.lookup(e.name);
      if (!info) continue;
      if (teamsConflict(e.team, info.proTeam)) continue;
      const label = [info.status, info.injury ? `(${info.injury})` : ""].filter(Boolean).join(" ");
      const note = [label, info.expectedReturn].filter(Boolean).join(" · ");
      injuryById[e.id] = note || "IL";
    }
  }

  const value: AvailabilityResponse = {
    byId,
    positionsById,
    injuryById,
    errors,
    fetchedAt: new Date().toISOString(),
  };
  availCache = { at: Date.now(), value };
  return value;
}

// re-exported for convenience to API route consumers
export type { PlayerKind };
