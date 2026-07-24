import type {
  FantasyProvider,
  LeagueStanding,
  NormalizedPlayer,
  NormalizedTeam,
  PlayerKind,
  PlayerSlotKind,
} from "@/lib/types";
import { getEspnConfig, type EspnConfig } from "@/lib/config";
import {
  BENCH_SLOT_IDS,
  INJURED_SLOT_IDS,
  positionLabel,
  proTeamAbbrev,
  slotLabel,
} from "./constants";

/**
 * ESPN fantasy baseball adapter.
 *
 * Uses ESPN's unofficial v3 read API. Private leagues require two cookies
 * (`espn_s2` and `SWID`) which the user copies from their logged-in browser
 * session — see README for how to grab them.
 */

const READ_HOST = "https://lm-api-reads.fantasy.espn.com";

/** Minimal shapes of the bits of the ESPN response we actually read. */
interface EspnPlayer {
  fullName?: string;
  id?: number;
  defaultPositionId?: number;
  eligibleSlots?: number[];
  proTeamId?: number;
  injuryStatus?: string;
}
interface EspnRosterEntry {
  lineupSlotId: number;
  playerId?: number;
  playerPoolEntry?: { player?: EspnPlayer };
}
interface EspnTeam {
  id: number;
  abbrev?: string;
  name?: string;
  location?: string;
  nickname?: string;
  logo?: string;
  playoffSeed?: number;
  points?: number;
  record?: { overall?: { wins?: number; losses?: number; ties?: number } };
  roster?: { entries?: EspnRosterEntry[] };
}
interface EspnLeagueResponse {
  teams?: EspnTeam[];
  settings?: { name?: string };
}

function buildCookieHeader(cfg: EspnConfig): string {
  // SWID is expected to include its surrounding braces; tolerate either form.
  const swid = cfg.swid.startsWith("{") ? cfg.swid : cfg.swid ? `{${cfg.swid}}` : "";
  const parts: string[] = [];
  if (cfg.espnS2) parts.push(`espn_s2=${cfg.espnS2}`);
  if (swid) parts.push(`SWID=${swid}`);
  return parts.join("; ");
}

function teamDisplayName(t: EspnTeam): string {
  if (t.location || t.nickname) return [t.location, t.nickname].filter(Boolean).join(" ").trim();
  return t.name ?? `Team ${t.id}`;
}

function slotKind(slotId: number): PlayerSlotKind {
  if (INJURED_SLOT_IDS.has(slotId)) return "injured";
  if (BENCH_SLOT_IDS.has(slotId)) return "bench";
  return "starter";
}

function normalizePlayer(entry: EspnRosterEntry): NormalizedPlayer {
  const p = entry.playerPoolEntry?.player ?? {};
  // eligibleSlots are lineup-slot ids (same space as lineupSlotId), NOT the
  // defaultPositionId space — so they map through slotLabel, not positionLabel.
  const eligible = (p.eligibleSlots ?? [])
    .map(slotLabel)
    // Drop the catch-all / utility / bench / generic-infield pseudo-slots.
    .filter((label) => !["BE", "IL", "UTIL", "P", "IF"].includes(label));
  return {
    id: String(p.id ?? entry.playerId ?? ""),
    name: p.fullName ?? "Unknown",
    position: positionLabel(p.defaultPositionId ?? -1),
    eligiblePositions: Array.from(new Set(eligible)),
    proTeam: proTeamAbbrev(p.proTeamId ?? 0),
    slot: slotKind(entry.lineupSlotId),
    slotLabel: slotLabel(entry.lineupSlotId),
    injuryStatus:
      p.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : undefined,
  };
}

export class EspnProvider implements FantasyProvider {
  id = "espn" as const;
  label = "ESPN";
  constructor(private cfg: EspnConfig) {}

  private async fetchLeague(): Promise<EspnLeagueResponse> {
    const url =
      `${READ_HOST}/apis/v3/games/flb/seasons/${this.cfg.season}` +
      `/segments/0/leagues/${this.cfg.leagueId}` +
      `?view=mTeam&view=mRoster&view=mSettings`;

    const cookie = buildCookieHeader(this.cfg);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // ESPN rejects requests without a browser-like UA on some endpoints.
        "User-Agent": "Mozilla/5.0 (fantasy-dashboard)",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: "no-store",
    });

    if (res.status === 401) {
      throw new Error(
        "ESPN returned 401 Unauthorized — check ESPN_S2 / ESPN_SWID for a private league."
      );
    }
    if (!res.ok) {
      throw new Error(`ESPN request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as EspnLeagueResponse;
  }

  async fetchTeams(): Promise<NormalizedTeam[]> {
    const data = await this.fetchLeague();
    const leagueName = data.settings?.name ?? `ESPN League ${this.cfg.leagueId}`;
    const wanted = String(this.cfg.teamId);

    // League standings: every team by season points (ESPN here is points-based).
    const standings: LeagueStanding[] = (data.teams ?? [])
      .map((t) => ({
        teamId: String(t.id),
        teamName: teamDisplayName(t),
        points: t.points ?? 0,
        isUser: String(t.id) === wanted,
      }))
      .sort((a, b) => b.points - a.points);

    const teams = (data.teams ?? []).filter((t) => String(t.id) === wanted);
    if (teams.length === 0) {
      const available = (data.teams ?? []).map((t) => t.id).join(", ");
      throw new Error(
        `ESPN team id ${wanted} not found in league. Available team ids: ${available || "none"}.`
      );
    }

    return teams.map((t): NormalizedTeam => {
      const overall = t.record?.overall ?? {};
      const entries = t.roster?.entries ?? [];
      return {
        provider: "espn",
        providerLabel: "ESPN",
        leagueId: this.cfg.leagueId,
        leagueName,
        season: this.cfg.season,
        teamId: String(t.id),
        teamName: teamDisplayName(t),
        abbrev: t.abbrev ?? "",
        logoUrl: t.logo,
        record: {
          wins: overall.wins ?? 0,
          losses: overall.losses ?? 0,
          ties: overall.ties ?? 0,
        },
        rank: t.playoffSeed,
        pointsFor: t.points,
        standings,
        roster: entries.map(normalizePlayer),
      };
    });
  }
}

/** Factory: returns a configured provider, or null if ESPN isn't set up. */
export function createEspnProvider(): EspnProvider | null {
  const cfg = getEspnConfig();
  return cfg ? new EspnProvider(cfg) : null;
}

// ── Free agents ──────────────────────────────────────────────────────────────

export interface EspnFreeAgent {
  id: string;
  name: string;
  position: string;
  proTeam: string;
  kind: PlayerKind;
}

/** ESPN primary-position labels that mean "pitcher". */
const PITCHER_POSITIONS = new Set(["SP", "RP", "P"]);

/**
 * Fetch ESPN's available player pool (free agents + waivers) for the configured
 * league. Returns lightweight rows; ranking is applied later from CBS's ROS data
 * (ESPN's API has no usable ROS ranking). Returns null if ESPN isn't configured.
 */
export async function fetchEspnFreeAgents(): Promise<EspnFreeAgent[] | null> {
  const cfg = getEspnConfig();
  if (!cfg) return null;

  const url =
    `${READ_HOST}/apis/v3/games/flb/seasons/${cfg.season}` +
    `/segments/0/leagues/${cfg.leagueId}/players?view=kona_player_info`;
  // Bias toward rosterable players; limit keeps the payload sane if honored.
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      limit: 1000,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };

  const cookie = buildCookieHeader(cfg);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (fantasy-dashboard)",
      "x-fantasy-filter": JSON.stringify(filter),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) {
    throw new Error("ESPN returned 401 Unauthorized — check ESPN_S2 / ESPN_SWID.");
  }
  if (!res.ok) throw new Error(`ESPN free-agent request failed: ${res.status} ${res.statusText}`);

  type FaEntry = { player?: EspnPlayer; status?: string; onTeamId?: number };
  const json = (await res.json()) as { players?: FaEntry[] } | FaEntry[];
  const entries = Array.isArray(json) ? json : json.players ?? [];

  const out: EspnFreeAgent[] = [];
  for (const entry of entries) {
    // ESPN ignores the filterStatus filter on this endpoint and returns ONTEAM
    // players too, so filter to genuinely available players here (onTeamId 0).
    const available = entry.onTeamId === 0 || entry.status === "FREEAGENT" || entry.status === "WAIVERS";
    if (!available) continue;
    const p = entry.player ?? {};
    if (!p.fullName) continue;
    const position = positionLabel(p.defaultPositionId ?? -1);
    out.push({
      id: String(p.id ?? ""),
      name: p.fullName,
      position,
      proTeam: proTeamAbbrev(p.proTeamId ?? 0),
      kind: PITCHER_POSITIONS.has(position) ? "pitcher" : "hitter",
    });
  }
  return out;
}
