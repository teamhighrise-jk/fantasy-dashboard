/**
 * Central credential/config loader. All secrets live in `.env.local` (gitignored)
 * and are read here once, server-side only. Never import this from a client component.
 */

export interface EspnConfig {
  leagueId: string;
  season: number;
  /** Team id within the league (the team you want to show). */
  teamId: string;
  /** Auth cookies for private leagues. */
  espnS2: string;
  swid: string;
}

export interface CbsConfig {
  /** League subdomain, e.g. "myleague" for myleague.baseball.cbssports.com. */
  leagueHost: string;
  season: number;
  /** Team id within the league. */
  teamId: string;
  /** Either a CBS API access token... */
  accessToken?: string;
  /** ...or a raw session cookie string copied from the browser (scrape mode). */
  cookie?: string;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value ? n : fallback;
}

const DEFAULT_SEASON = num(process.env.FANTASY_SEASON, new Date().getFullYear());

/** Returns ESPN config, or null if not configured (so the provider is skipped). */
export function getEspnConfig(): EspnConfig | null {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const teamId = process.env.ESPN_TEAM_ID;
  if (!leagueId || !teamId) return null;
  return {
    leagueId,
    teamId,
    season: num(process.env.ESPN_SEASON, DEFAULT_SEASON),
    espnS2: process.env.ESPN_S2 ?? "",
    swid: process.env.ESPN_SWID ?? "",
  };
}

export interface FantasyProsLeague {
  /** Our provider id this FantasyPros league corresponds to. */
  provider: "espn" | "cbs";
  /** FantasyPros "My Playbook" key, e.g. "mlb~<uuid>". */
  key: string;
}

export interface FantasyProsConfig {
  /** Raw Cookie header from a logged-in fantasypros.com session. */
  cookie: string;
  /** Configured leagues (only those with a key set). */
  leagues: FantasyProsLeague[];
  season: number;
}

/**
 * Returns FantasyPros config, or null if not configured (no cookie, or no league
 * keys). Powers the Free Agents page from FantasyPros' league-synced ROS lists.
 */
export function getFantasyProsConfig(): FantasyProsConfig | null {
  const cookie = process.env.FANTASYPROS_COOKIE;
  if (!cookie) return null;
  const leagues: FantasyProsLeague[] = [];
  if (process.env.FANTASYPROS_ESPN_KEY)
    leagues.push({ provider: "espn", key: process.env.FANTASYPROS_ESPN_KEY });
  if (process.env.FANTASYPROS_CBS_KEY)
    leagues.push({ provider: "cbs", key: process.env.FANTASYPROS_CBS_KEY });
  if (leagues.length === 0) return null;
  return { cookie, leagues, season: DEFAULT_SEASON };
}

/** Returns CBS config, or null if not configured (so the provider is skipped). */
export function getCbsConfig(): CbsConfig | null {
  const leagueHost = process.env.CBS_LEAGUE_HOST;
  const teamId = process.env.CBS_TEAM_ID;
  if (!leagueHost || !teamId) return null;
  return {
    leagueHost,
    teamId,
    season: num(process.env.CBS_SEASON, DEFAULT_SEASON),
    accessToken: process.env.CBS_ACCESS_TOKEN || undefined,
    cookie: process.env.CBS_COOKIE || undefined,
  };
}
