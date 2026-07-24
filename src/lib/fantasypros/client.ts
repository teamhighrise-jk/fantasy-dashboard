import type { FreeAgentPlayer, LeagueFreeAgents, PlayerKind } from "@/lib/types";
import { getFantasyProsConfig, type FantasyProsLeague } from "@/lib/config";

/** The My Playbook dashboard (defaults to the "My Team" view — carries the roster). */
const DASHBOARD = "https://www.fantasypros.com/mlb/myplaybook/";

/**
 * FantasyPros "My Playbook" adapter for the Free Agents view.
 *
 * FantasyPros has no public API for personalized data, so we replicate the
 * logged-in browser request to the available-players page and parse its HTML.
 * The page is league-synced and scoring-aware: it already lists each league's
 * AVAILABLE players with a rest-of-season (ROS) consensus rank.
 *
 *   GET /mlb/myplaybook/available-players.php?key=mlb~<uuid>
 *
 * Each player row looks like:
 *   <tr class="player-row top-H ..." data-pid="5965"> ... fp-player-name="Dansby Swanson" ...
 *       <small class="mpb__player-team-pos">(CHC - SS)</small> ...
 *       <span class="range ros">60</span> ...
 * `top-H` = overall hitters, `top-P` = overall pitchers (so no cross-position
 * merge is needed). Rows are duplicated per player (wide/narrow renders) so we
 * dedupe by data-pid.
 */

const BASE = "https://www.fantasypros.com/mlb/myplaybook/available-players.php";
const TOP_N = 100;

const PROVIDER_LABEL: Record<FantasyProsLeague["provider"], string> = {
  espn: "ESPN",
  cbs: "CBS",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ")
    .trim();
}

interface ParsedRow extends FreeAgentPlayer {}

/** Parse EVERY available player from the page (deduped by pid, unsorted, no top-N cap). */
function parseAllAvailable(html: string): { hitters: FreeAgentPlayer[]; pitchers: FreeAgentPlayer[] } {
  const rowRe = /<tr class="player-row top-([HP])[^"]*"[^>]*data-pid="(\d+)">([\s\S]*?)<\/tr>/g;
  const byKind: Record<PlayerKind, Map<string, ParsedRow>> = {
    hitter: new Map(),
    pitcher: new Map(),
  };

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const kind: PlayerKind = m[1] === "H" ? "hitter" : "pitcher";
    const pid = m[2];
    const row = m[3];
    const bucket = byKind[kind];
    if (bucket.has(pid)) continue; // dedupe the wide/narrow row pair

    const name = decodeEntities((row.match(/fp-player-name="([^"]+)"/) ?? [])[1] ?? "");
    if (!name) continue;
    const teamPos = (row.match(/mpb__player-team-pos">\s*\(([^)]*)\)/) ?? [])[1] ?? "";
    const [team, pos] = teamPos.split(/\s*-\s*/);
    const rosRaw = (row.match(/class="range ros">([^<]*)<\/span>/) ?? [])[1] ?? "";
    const ros = Number(rosRaw);
    // FantasyPros player-page link, e.g. /mlb/players/dansby-swanson.php
    const fpPath = (row.match(/href="(\/mlb\/players\/[^"]+\.php)"/) ?? [])[1];

    // FantasyPros lists this league's full multi-eligibility, e.g. "2B,3B,SS"
    // (already league-synced, so it reflects each league's own rules).
    const positions = (pos ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    bucket.set(pid, {
      id: pid,
      name,
      position: positions[0] ?? "",
      positions,
      proTeam: (team ?? "").trim(),
      kind,
      rosRank: Number.isFinite(ros) ? ros : Number.POSITIVE_INFINITY,
      rosRankSource: "fantasypros_ros",
      fantasyProsUrl: fpPath ? `https://www.fantasypros.com${fpPath}` : undefined,
    });
  }

  return { hitters: [...byKind.hitter.values()], pitchers: [...byKind.pitcher.values()] };
}

/** Parse the available-players HTML into ranked hitters and pitchers (deduped, sorted, top-N). */
function parseAvailablePlayers(html: string): { hitters: FreeAgentPlayer[]; pitchers: FreeAgentPlayer[] } {
  const all = parseAllAvailable(html);
  const topN = (arr: FreeAgentPlayer[]) =>
    [...arr].sort((a, b) => a.rosRank - b.rosRank).slice(0, TOP_N);
  return { hitters: topN(all.hitters), pitchers: topN(all.pitchers) };
}

/** Extract a league's display name from the page's nav settings, if present. */
function leagueNameFromHtml(html: string, key: string): string {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`"${esc}":\\{"primaryText":"([^"]+)"`));
  return m ? decodeEntities(m[1]) : "";
}

async function fpGet(cookie: string, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (fantasy-dashboard)",
      Accept: "text/html",
      Referer: "https://www.fantasypros.com/mlb/myplaybook/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FantasyPros request failed: ${res.status} ${res.statusText}`);
  return res.text();
}

function fetchLeaguePage(cookie: string, league: FantasyProsLeague): Promise<string> {
  return fpGet(cookie, `${BASE}?key=${encodeURIComponent(league.key)}`);
}

async function fetchLeague(cookie: string, league: FantasyProsLeague): Promise<LeagueFreeAgents> {
  const html = await fetchLeaguePage(cookie, league);

  const { hitters, pitchers } = parseAvailablePlayers(html);
  // Zero rows almost always means the session cookie expired (served a login/landing page).
  if (hitters.length === 0 && pitchers.length === 0) {
    throw new Error(
      "FantasyPros returned no players — the session cookie may have expired (refresh FANTASYPROS_COOKIE)."
    );
  }

  return {
    provider: league.provider,
    providerLabel: PROVIDER_LABEL[league.provider],
    leagueName: leagueNameFromHtml(html, league.key),
    hitters,
    pitchers,
    rankingNote: "FantasyPros rest-of-season, synced to your league scoring",
  };
}

/**
 * Fetch FantasyPros free-agent lists for every configured league. Returns null
 * if FantasyPros isn't configured. Throws are surfaced per-league by the caller.
 */
export async function fetchFantasyProsFreeAgents(): Promise<
  | { leagues: LeagueFreeAgents[]; errors: Partial<Record<FantasyProsLeague["provider"], string>> }
  | null
> {
  const cfg = getFantasyProsConfig();
  if (!cfg) return null;

  const leagues: LeagueFreeAgents[] = [];
  const errors: Partial<Record<FantasyProsLeague["provider"], string>> = {};

  // Sequential to be gentle on FantasyPros (each response is large).
  for (const league of cfg.leagues) {
    try {
      leagues.push(await fetchLeague(cfg.cookie, league));
    } catch (e) {
      errors[league.provider] = e instanceof Error ? e.message : String(e);
    }
  }
  return { leagues, errors };
}

/** A currently-available player in a league (full pool, not capped to top-N). */
export interface FpAvailablePlayer {
  name: string;
  proTeam: string;
  kind: PlayerKind;
  positions: string[];
  fantasyProsUrl?: string;
}
export interface FpLeagueAvailability {
  provider: FantasyProsLeague["provider"];
  players: FpAvailablePlayer[];
}

/**
 * The COMPLETE set of available players per league (not sliced to top-N) — used
 * to flag free-agent status for arbitrary watchlisted players. Returns null if
 * FantasyPros isn't configured; per-league fetch errors are surfaced separately.
 */
export async function fetchFantasyProsAvailability(): Promise<
  { leagues: FpLeagueAvailability[]; errors: Partial<Record<FantasyProsLeague["provider"], string>> } | null
> {
  const cfg = getFantasyProsConfig();
  if (!cfg) return null;

  const leagues: FpLeagueAvailability[] = [];
  const errors: Partial<Record<FantasyProsLeague["provider"], string>> = {};

  for (const league of cfg.leagues) {
    try {
      const html = await fetchLeaguePage(cfg.cookie, league);
      const { hitters, pitchers } = parseAllAvailable(html);
      if (hitters.length === 0 && pitchers.length === 0) {
        throw new Error("FantasyPros returned no players — the session cookie may have expired.");
      }
      const players: FpAvailablePlayer[] = [...hitters, ...pitchers].map((p) => ({
        name: p.name,
        proTeam: p.proTeam,
        kind: p.kind,
        positions: p.positions ?? (p.position ? [p.position] : []),
        fantasyProsUrl: p.fantasyProsUrl,
      }));
      leagues.push({ provider: league.provider, players });
    } catch (e) {
      errors[league.provider] = e instanceof Error ? e.message : String(e);
    }
  }
  return { leagues, errors };
}

/** A player on the user's roster, parsed from the My Playbook "My Team" view. */
export interface FpRosterPlayer {
  id: string; // FantasyPros player id
  name: string;
  proTeam: string;
  position: string;
  eligiblePositions: string[];
  kind: PlayerKind;
}
export interface FpRoster {
  leagueName: string;
  teamName: string;
  players: FpRosterPlayer[];
}

/** Parse pid → name/team/positions from any My Playbook page that renders player rows. */
function parsePlayerRows(html: string): Map<string, { name: string; proTeam: string; positions: string[] }> {
  const out = new Map<string, { name: string; proTeam: string; positions: string[] }>();
  const re = /<tr[^>]*data-pid="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const pid = m[1];
    if (out.has(pid)) continue; // dedupe wide/narrow render pair
    const row = m[2];
    const name = decodeEntities((row.match(/fp-player-name="([^"]+)"/) ?? [])[1] ?? "");
    if (!name) continue;
    const teamPos = (row.match(/mpb__player-team-pos">\s*\(([^)]*)\)/) ?? [])[1] ?? "";
    const [team, pos] = teamPos.split(/\s*-\s*/);
    const positions = (pos ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    out.set(pid, { name, proTeam: (team ?? "").trim(), positions });
  }
  return out;
}

/**
 * The user's roster for one league, from FantasyPros' My Playbook "My Team" view
 * (`playerPool = {"H":[…ids],"P":[…ids]}` + the rendered player rows). Used as a
 * fallback roster source when a provider's own API is unavailable (e.g. an
 * expired CBS token). Returns null if FantasyPros isn't configured for that
 * provider or the page can't be parsed. Throws only on the HTTP fetch failing.
 */
export async function fetchFantasyProsRoster(provider: FantasyProsLeague["provider"]): Promise<FpRoster | null> {
  const cfg = getFantasyProsConfig();
  if (!cfg) return null;
  const league = cfg.leagues.find((l) => l.provider === provider);
  if (!league) return null;

  const html = await fpGet(cfg.cookie, `${DASHBOARD}?key=${encodeURIComponent(league.key)}`);
  const poolRaw = (html.match(/playerPool\s*=\s*(\{.*?\});/) ?? [])[1];
  if (!poolRaw) return null;
  let pool: { H?: number[]; P?: number[] };
  try {
    pool = JSON.parse(poolRaw);
  } catch {
    return null;
  }

  const rows = parsePlayerRows(html);
  const players: FpRosterPlayer[] = [];
  const add = (pid: number, kind: PlayerKind) => {
    const info = rows.get(String(pid));
    if (!info) return;
    players.push({
      id: String(pid),
      name: info.name,
      proTeam: info.proTeam,
      position: info.positions[0] ?? "",
      eligiblePositions: info.positions,
      kind,
    });
  };
  for (const pid of pool.H ?? []) add(pid, "hitter");
  for (const pid of pool.P ?? []) add(pid, "pitcher");
  if (players.length === 0) return null;

  // Header carries the league + team name, e.g.
  //   "primaryText":"<League Name>","secondaryText":"<Team Name>","linkToHost":true
  const lt = html.match(/"primaryText":"([^"]+)","secondaryText":"([^"]+)","linkToHost":true/);
  return {
    leagueName: lt ? decodeEntities(lt[1]) : "",
    teamName: lt ? decodeEntities(lt[2]) : "",
    players,
  };
}
