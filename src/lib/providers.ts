import type {
  FantasyProvider,
  NormalizedPlayer,
  NormalizedTeam,
  PlayerKind,
  ProviderId,
  TeamsResponse,
} from "@/lib/types";
import { createEspnProvider } from "@/lib/espn/client";
import { createCbsProvider, fetchCbsInjuryIndex } from "@/lib/cbs/client";
import { fetchFantasyProsRoster } from "@/lib/fantasypros/client";
import { getCbsConfig } from "@/lib/config";
import { teamsConflict } from "@/lib/teams";
import { getStatsIndex } from "@/lib/stats";

/**
 * Returns every provider that is configured (has the required env vars).
 * Unconfigured providers are simply skipped, so the app works with one or both.
 */
export function getConfiguredProviders(): FantasyProvider[] {
  const providers = [createEspnProvider(), createCbsProvider()];
  return providers.filter((p) => p !== null);
}

/** Classify a rostered player as hitter/pitcher from their position label. */
function playerKind(position: string): PlayerKind {
  return /^(SP|RP|P)$/i.test(position.trim()) ? "pitcher" : "hitter";
}

/**
 * Fetch a provider's teams, with a FantasyPros fallback for CBS. CBS's own API
 * needs an access token that expires often; when that fetch fails (expired/absent
 * token), we fall back to the FantasyPros-synced roster so the CBS team still
 * shows up (degraded: no lineup slots, record, or IL status — see the team note).
 * If the fallback is also unavailable, the original provider error propagates.
 */
export async function fetchTeamsForProvider(p: FantasyProvider): Promise<NormalizedTeam[]> {
  try {
    return await p.fetchTeams();
  } catch (e) {
    if (p.id === "cbs") {
      const fallback = await cbsRosterFromFantasyPros().catch(() => null);
      if (fallback) return [fallback];
    }
    throw e;
  }
}

/** Build a (degraded) CBS NormalizedTeam from the FantasyPros My-Team roster. */
async function cbsRosterFromFantasyPros(): Promise<NormalizedTeam | null> {
  const fp = await fetchFantasyProsRoster("cbs");
  if (!fp) return null;
  const cfg = getCbsConfig();
  const roster: NormalizedPlayer[] = fp.players.map((pl) => ({
    id: pl.id,
    name: pl.name,
    position: pl.position,
    eligiblePositions: pl.eligiblePositions,
    proTeam: pl.proTeam,
    slot: "starter", // FantasyPros doesn't expose CBS lineup slots
    slotLabel: "",
    kind: pl.kind,
  }));
  return {
    provider: "cbs",
    providerLabel: "CBS",
    leagueId: cfg?.leagueHost ?? "",
    leagueName: fp.leagueName || cfg?.leagueHost || "CBS League",
    season: cfg?.season ?? new Date().getFullYear(),
    teamId: String(cfg?.teamId ?? ""),
    teamName: fp.teamName || "CBS Team",
    abbrev: "",
    record: { wins: 0, losses: 0, ties: 0 },
    note: "Roster via FantasyPros — CBS token unavailable, so lineup slots, record & IL status aren't shown.",
    roster,
  };
}

/**
 * Enrich every rostered player with advanced stats (Savant + FanGraphs), matched
 * by name + kind + team — same source/index as the Free Agents page (cached).
 * Best-effort and in place; a stats-fetch failure leaves rosters unchanged.
 */
export async function applyPlayerStats(teams: NormalizedTeam[]): Promise<void> {
  if (teams.length === 0) return;
  let index;
  try {
    index = await getStatsIndex();
  } catch {
    return;
  }
  for (const team of teams) {
    for (const player of team.roster) {
      player.kind = playerKind(player.position);
      const m = index.lookup(player.name, player.kind, player.proTeam);
      if (m) {
        player.stats = m.stats;
        player.mlbamId = m.mlbamId;
        player.fgPlayerId = m.fgPlayerId;
      }
    }
  }
}

/**
 * Cross-provider enrichment: fill in missing injured-player return estimates
 * using CBS's league-wide injury report — CBS is the only configured source
 * that exposes a return date, so this mainly benefits ESPN injured players.
 *
 * Matches by normalized name, then guards against same-name collisions with a
 * pro-team check: a candidate is rejected only when both teams are known and
 * disagree (a missing team on either side falls back to name-only matching).
 *
 * Mutates `teams` in place and is strictly best-effort: if CBS isn't configured
 * or the request fails, teams are returned unchanged. Skips the network call
 * entirely when nothing is missing a return.
 */
export async function applyInjuryReturnDates(teams: NormalizedTeam[]): Promise<void> {
  // A player is "injured" if they carry an injury status — note ESPN keeps such
  // players in their bench/IL lineup slot, so we key off injuryStatus, not slot.
  const isInjuredMissingReturn = (p: NormalizedTeam["roster"][number]) =>
    !!p.injuryStatus && !p.expectedReturn;
  if (!teams.some((t) => t.roster.some(isInjuredMissingReturn))) return;

  let index;
  try {
    index = await fetchCbsInjuryIndex();
  } catch {
    return; // best-effort — leave teams unchanged on failure
  }
  if (!index) return;

  for (const team of teams) {
    for (const player of team.roster) {
      if (!isInjuredMissingReturn(player)) continue;
      const info = index.lookup(player.name);
      if (!info?.expectedReturn) continue;
      // Reject only on a definite team mismatch; allow when either side is blank.
      if (teamsConflict(player.proTeam, info.proTeam)) continue;
      player.expectedReturn = info.expectedReturn;
    }
  }
}

/**
 * Assemble every configured provider's teams (in parallel), then backfill injury
 * return estimates + advanced stats. A failure in one provider is reported
 * per-provider rather than failing the whole response.
 */
async function assembleTeams(): Promise<TeamsResponse> {
  const providers = getConfiguredProviders();
  if (providers.length === 0) {
    return { teams: [], errors: {}, fetchedAt: new Date().toISOString() };
  }

  const results = await Promise.allSettled(providers.map((p) => fetchTeamsForProvider(p)));
  const teams: NormalizedTeam[] = [];
  const errors: Partial<Record<ProviderId, string>> = {};
  results.forEach((result, i) => {
    const provider = providers[i];
    if (result.status === "fulfilled") teams.push(...result.value);
    else errors[provider.id] = result.reason instanceof Error ? result.reason.message : String(result.reason);
  });

  await Promise.all([applyInjuryReturnDates(teams), applyPlayerStats(teams)]);
  return { teams, errors, fetchedAt: new Date().toISOString() };
}

// In-process TTL cache of the assembled teams response — same pattern as
// getFreeAgents(). The Teams page (`/`) re-fetches on every navigation, and the
// assembly is the expensive part (ESPN + CBS live calls, CBS's big FantasyPros
// fallback page, injury + stats enrichment). `?fresh=1` (Refresh button, and the
// reload after a CBS token refresh) bypasses it.
const TEAMS_TTL_MS = 20 * 60 * 1000;
let teamsCache: { at: number; value: TeamsResponse } | null = null;

export async function getTeams(opts: { force?: boolean } = {}): Promise<TeamsResponse> {
  if (!opts.force && teamsCache && Date.now() - teamsCache.at < TEAMS_TTL_MS) return teamsCache.value;
  const value = await assembleTeams();
  // Only cache a healthy build so a total failure doesn't pin emptiness for the TTL.
  if (value.teams.length > 0) teamsCache = { at: Date.now(), value };
  return value;
}
