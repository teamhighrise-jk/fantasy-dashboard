/**
 * ESPN fantasy baseball (game code "flb") magic-number maps.
 *
 * ESPN returns positions, lineup slots, and pro teams as numeric ids. These maps
 * translate them to human labels. They are derived from the community-maintained
 * espn-api project. If a label ever looks wrong against your real roster, this is
 * the file to correct — it's the one place these constants live.
 */

/** lineupSlotId -> label (where the player is rostered). */
export const SLOT_MAP: Record<number, string> = {
  0: "C",
  1: "1B",
  2: "2B",
  3: "3B",
  4: "SS",
  5: "OF",
  6: "2B/SS",
  7: "1B/3B",
  8: "LF",
  9: "CF",
  10: "RF",
  11: "DH",
  12: "UTIL",
  13: "P",
  14: "SP",
  15: "RP",
  16: "BE", // bench
  17: "IL", // injured list
  18: "P",
  19: "IF",
};

/** Lineup slots that mean "not in the active lineup". */
export const BENCH_SLOT_IDS = new Set([16]);
export const INJURED_SLOT_IDS = new Set([17]);

/**
 * defaultPositionId -> primary position label.
 *
 * NOTE: this is a DIFFERENT id space than SLOT_MAP/eligibleSlots. ESPN's player
 * `defaultPositionId` for baseball is its own enumeration (validated against a
 * real roster): 1=SP, 2=C, 3=1B ... 9=RF, 10=DH, 11=RP. Do not feed
 * eligibleSlots through this map — those are lineup-slot ids (use SLOT_MAP).
 */
export const POSITION_MAP: Record<number, string> = {
  1: "SP",
  2: "C",
  3: "1B",
  4: "2B",
  5: "3B",
  6: "SS",
  7: "LF",
  8: "CF",
  9: "RF",
  10: "DH",
  11: "RP",
};

/** MLB proTeamId -> abbreviation. 0 = free agent / none. */
export const PRO_TEAM_MAP: Record<number, string> = {
  0: "FA",
  1: "BAL",
  2: "BOS",
  3: "LAA",
  4: "CWS",
  5: "CLE",
  6: "DET",
  7: "KC",
  8: "MIL",
  9: "MIN",
  10: "NYY",
  11: "OAK",
  12: "SEA",
  13: "TEX",
  14: "TOR",
  15: "ATL",
  16: "CHC",
  17: "CIN",
  18: "HOU",
  19: "LAD",
  20: "WSH",
  21: "NYM",
  22: "PHI",
  23: "PIT",
  24: "STL",
  25: "SD",
  26: "SF",
  27: "COL",
  28: "MIA",
  29: "ARI",
  30: "TB",
};

export function slotLabel(id: number): string {
  return SLOT_MAP[id] ?? `slot${id}`;
}

export function positionLabel(id: number): string {
  return POSITION_MAP[id] ?? `pos${id}`;
}

export function proTeamAbbrev(id: number): string {
  return PRO_TEAM_MAP[id] ?? "";
}
