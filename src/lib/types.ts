/**
 * Normalized data model.
 *
 * Every provider (ESPN, CBS, ...) maps its own API/HTML shape into THESE types.
 * The UI and API routes only ever deal with this normalized model — they never
 * see provider-specific fields. To add a new fantasy site later, write one more
 * adapter that returns a `NormalizedTeam`.
 */

export type ProviderId = "espn" | "cbs";

export type PlayerSlotKind = "starter" | "bench" | "injured";

/** A single roster spot's player. */
export interface NormalizedPlayer {
  /** Provider-native player id, stringified. */
  id: string;
  name: string;
  /** Primary position label, e.g. "SS", "SP". */
  position: string;
  /** All positions the player is eligible at, e.g. ["2B", "SS", "UTIL"]. */
  eligiblePositions: string[];
  /** Pro team abbreviation, e.g. "LAD". Empty string if unknown. */
  proTeam: string;
  /** Where this player sits on the fantasy roster. */
  slot: PlayerSlotKind;
  /** The lineup-slot label as shown on the site, e.g. "SS", "BE", "IL", "UTIL". */
  slotLabel: string;
  /** Injury/availability note if any, e.g. "DTD", "IL10", "OUT". */
  injuryStatus?: string;
  /**
   * Human-readable expected-return note for an injured player, as supplied by
   * the provider, e.g. "Expected to be out until at least Jun 16". Only some
   * providers expose this (CBS does; ESPN's read API does not).
   */
  expectedReturn?: string;
  /** hitter/pitcher classification, set during stats enrichment (from position). */
  kind?: PlayerKind;
  /** Advanced stats (Savant + FanGraphs), attached after matching by name. */
  stats?: FreeAgentStats;
  /** MLBAM id (Baseball Savant link) and FanGraphs id (FanGraphs link), from the stats match. */
  mlbamId?: string;
  fgPlayerId?: string;
}

/** A team's win/loss record. */
export interface NormalizedRecord {
  wins: number;
  losses: number;
  ties: number;
}

/** One row of a league's standings (for the Teams-tab standings panel). */
export interface LeagueStanding {
  teamId: string;
  teamName: string;
  /** Season points total (the sort key). */
  points: number;
  /** Win/loss record — shown as an extra column where the provider has it (CBS). */
  record?: NormalizedRecord;
  /** Division label — shown as an extra column where the provider has it (CBS). */
  division?: string;
  /** True for the user's own team, so the row can be highlighted. */
  isUser?: boolean;
}

/** One fantasy team, fully normalized and provider-agnostic. */
export interface NormalizedTeam {
  provider: ProviderId;
  /** Human label for the source, e.g. "ESPN" / "CBS". */
  providerLabel: string;
  leagueId: string;
  leagueName: string;
  /** Season year, e.g. 2026. */
  season: number;

  teamId: string;
  teamName: string;
  /** Short code, e.g. "JK". May be empty. */
  abbrev: string;
  /** Logo URL if the provider exposes one. */
  logoUrl?: string;

  record: NormalizedRecord;
  /** League rank / playoff seed if known (1-based). */
  rank?: number;
  /** Season total points / category total, scoring-dependent. May be undefined. */
  pointsFor?: number;
  /**
   * Optional banner note about how this team was sourced — e.g. a degraded
   * fallback. When set, the UI shows it instead of the (unavailable) record.
   */
  note?: string;

  /** Full league standings (this team's league), sorted by points desc. */
  standings?: LeagueStanding[];

  roster: NormalizedPlayer[];
}

// ── Free agents ─────────────────────────────────────────────────────────────

export type PlayerKind = "hitter" | "pitcher";

/** Selectable rest-of-season projection systems (FanGraphs) + our weighted blend. */
export type ProjSystem = "blend" | "thebat" | "dc" | "oopsy";

/** One projection system's displayed rest-of-season stats (hitter + pitcher fields). */
export interface ProjStats {
  // hitter
  r?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  avg?: number;
  obp?: number;
  slg?: number;
  ops?: number;
  woba?: number;
  // pitcher
  ip?: number;
  era?: number;
  whip?: number;
  sv?: number;
}

/**
 * Advanced stats shown on the Free Agents page. Populated per kind; fields not
 * applicable to a kind (or unmatched/sparse players) stay undefined. Savant +
 * FanGraphs-leaderboard fields are season-to-date; proj* are rest-of-season
 * projections (blend/OOPSY/THE BAT/Depth Charts, selectable).
 */
export interface FreeAgentStats {
  // Baseball Savant (season-to-date)
  xba?: number; // both kinds
  xera?: number; // pitcher
  xwoba?: number; // hitter
  xslg?: number; // hitter
  runValue?: number; // pitching RV (pitcher) or batting RV (hitter) — raw Savant figure
  runValuePct?: number; // computed 0-100 percentile of runValue within kind (higher = better)
  // Baseball Savant percentile ranks (0-100, higher = better — like Savant's slider colors)
  whiffPctl?: number; // both kinds
  fbVeloPctl?: number; // pitcher (fastball velocity rank)
  evPctl?: number; // hitter (exit velocity rank)
  brlPctl?: number; // hitter (barrel rate rank)
  hardHitPctl?: number; // hitter (hard-hit rate rank)
  chasePctl?: number; // hitter (chase rate rank)
  // FanGraphs leaderboard (season-to-date, pitcher)
  fip?: number;
  xfip?: number;
  siera?: number;
  kPct?: number; // pitcher, fraction (0.301 = 30.1%)
  bbPct?: number; // pitcher, fraction
  kbbPct?: number; // pitcher, K-BB% fraction
  // Rest-of-season PROJECTIONS. `projBySystem` carries each FanGraphs RoS system
  // (+ our blend); the flat proj* fields below are the CURRENTLY-SELECTED system's
  // values (resolved client-side per the projection-system toggle) and are what
  // the shared StatsTable's "Projections (RoS)" group renders.
  projBySystem?: Partial<Record<ProjSystem, ProjStats>>;
  projIp?: number; // pitcher
  projEra?: number; // pitcher
  projWhip?: number; // pitcher
  projSv?: number; // pitcher (saves)
  projR?: number; // hitter (runs)
  projHr?: number; // hitter
  projRbi?: number; // hitter
  projSb?: number; // hitter
  projAvg?: number; // hitter
  projObp?: number; // hitter
  projSlg?: number; // hitter
  projOps?: number; // hitter
  projWoba?: number; // hitter
  // FanGraphs season leaderboard — ACTUAL season-to-date totals (distinct from
  // the OOPSY RoS projections above).
  seasonPa?: number; // hitter (plate appearances)
  seasonAvg?: number; // hitter
  seasonObp?: number; // hitter
  seasonSlg?: number; // hitter
  seasonHr?: number; // hitter
  seasonTb?: number; // hitter (total bases — derived from 1B/2B/3B/HR)
  seasonSb?: number; // hitter
  seasonWoba?: number; // hitter
  seasonWrcPlus?: number; // hitter (wRC+, 100 = league average)
  seasonIp?: number; // pitcher (innings pitched)
  seasonEra?: number; // pitcher
  seasonWhip?: number; // pitcher
  seasonK9?: number; // pitcher (K/9)
  seasonBb9?: number; // pitcher (BB/9)
  seasonSv?: number; // pitcher (saves)
}

/** A ranked available player for the Free Agents view. */
export interface FreeAgentPlayer {
  /** Provider-native id of the league where this player is a free agent. */
  id: string;
  name: string;
  /** Primary position label, e.g. "OF", "SP", "RP". */
  position: string;
  /** All positions the player is eligible at in this league, e.g. ["2B","3B","SS"]. */
  positions?: string[];
  /** Pro team abbreviation, e.g. "NYM". */
  proTeam: string;
  kind: PlayerKind;
  /**
   * Rest-of-season rank used to order this list (lower = better). Sourced from
   * CBS's ROS roto rankings; see `rosRankSource` for provenance.
   */
  rosRank: number;
  /** Where the ROS rank came from, e.g. "cbs_avg_roto". */
  rosRankSource: string;
  /** Advanced stats (Savant + FanGraphs), attached after matching by name. */
  stats?: FreeAgentStats;
  /** MLBAM id (for the Baseball Savant player-page link), from the stats match. */
  mlbamId?: string;
  /** FanGraphs player id (for the FanGraphs player-page link), from the stats match. */
  fgPlayerId?: string;
  /** FantasyPros player-page URL, parsed from the available-players HTML. */
  fantasyProsUrl?: string;
  /**
   * Per-player override for the name link (e.g. CBS player page). When unset the
   * name falls back to the league's add/drop page (LeagueFreeAgents.addDropUrl).
   */
  addDropUrl?: string;
}

/** Top available hitters and pitchers within a single league. */
export interface LeagueFreeAgents {
  provider: ProviderId;
  providerLabel: string;
  leagueName: string;
  hitters: FreeAgentPlayer[];
  pitchers: FreeAgentPlayer[];
  /** Set when this league's ranking is a stand-in (e.g. ESPN ranked via CBS). */
  rankingNote?: string;
  /** Link to this league's add/drop (free-agent) page on its fantasy site. */
  addDropUrl?: string;
}

/** A player in the searchable universe (every player our stat sources cover). */
export interface PlayerStatsEntry {
  /** Stable key: MLBAM id when known, else `<kind-initial>:<normalized-name>`. */
  id: string;
  name: string;
  kind: PlayerKind;
  team: string;
  position: string;
  stats?: FreeAgentStats;
  mlbamId?: string;
  fgPlayerId?: string;
}

/** Shape returned by the /api/players route (Watchlist search universe). */
export interface PlayersResponse {
  players: PlayerStatsEntry[];
  fetchedAt: string;
}

/**
 * Per-league free-agent availability for a player (Watchlist). A provider key is
 * present only when the player is currently available in that league; its value
 * is the add/drop URL to act on it (per-player where the provider allows it).
 */
export interface PlayerAvailability {
  espn?: string;
  cbs?: string;
}

/** Shape returned by the /api/availability route — keyed by PlayerStatsEntry.id. */
export interface AvailabilityResponse {
  byId: Record<string, PlayerAvailability>;
  /**
   * Full position eligibility per player id, joined from league data (FantasyPros
   * available pool + team rosters). Only players found in a league appear here.
   */
  positionsById: Record<string, string[]>;
  /**
   * Injury note per player id (from CBS's league-wide injury report, joined by
   * name). Present only for currently-injured players — drives the Watchlist IL
   * marker, same as the Teams tab.
   */
  injuryById: Record<string, string>;
  errors: Partial<Record<ProviderId, string>>;
  fetchedAt: string;
}

/** Shape returned by the /api/free-agents route. */
export interface FreeAgentsResponse {
  leagues: LeagueFreeAgents[];
  errors: Partial<Record<ProviderId, string>>;
  fetchedAt: string;
}

/** What every provider adapter must implement. */
export interface FantasyProvider {
  id: ProviderId;
  label: string;
  /** Fetch the configured team(s) for this provider and return them normalized. */
  fetchTeams(): Promise<NormalizedTeam[]>;
}

/** Shape returned by the /api/teams route. */
export interface TeamsResponse {
  teams: NormalizedTeam[];
  /** Per-provider error messages, keyed by provider id. Empty if all succeeded. */
  errors: Partial<Record<ProviderId, string>>;
  fetchedAt: string;
}
