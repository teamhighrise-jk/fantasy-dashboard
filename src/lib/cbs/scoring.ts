/**
 * CBS league fantasy scoring — "Head-to-Head, Points".
 *
 * The point VALUES below are league-specific and are NOT exposed by the CBS API:
 * `/league/scoring/categories` lists which categories are active (and the TB/INN
 * formulas) but not their weights, so the weights are recorded here from the
 * league's Scoring settings page. **Update these if the league's scoring changes.**
 * (Active categories confirmed against /league/scoring/categories on 2026-07-26.)
 *
 * Coverage vs. our rest-of-season projections (FanGraphs blend):
 *  - Fully projected: all batting cats; pitcher BB/ER/HBP/IBB/IP/K/QS/SV.
 *  - NOT projected by any source → contribute 0: BS (blown saves; feeds return
 *    null), NH (no-hitters), PG (perfect games). These are negligible in a RoS
 *    projection anyway.
 *  - Estimated: TBA (total bases allowed). Projections give hits + HR allowed but
 *    not the 2B/3B-allowed split, so TBA is estimated with a league-average
 *    bases-per-non-HR-hit constant (see below).
 */

/** Batting point weights (points per unit of each counting stat). */
export const CBS_HITTER_WEIGHTS = {
  bb: 0.5, // Walks (Batters)
  cs: -0.5, // Caught Stealing
  r: 0.75, // Runs
  rbi: 0.75, // Runs Batted In
  sb: 2, // Stolen Bases
  tb: 0.5, // Total Bases (1B + 2·2B + 3·3B + 4·HR)
} as const;

/** Pitching point weights. */
export const CBS_PITCHER_WEIGHTS = {
  bb: -0.5, // Walks Issued (BBI)
  er: -2, // Earned Runs
  hbp: -0.5, // Hit Batsmen (HB)
  ibb: -0.5, // Intentional Walks issued (IBBI) — scored in ADDITION to BBI
  ip: 2, // Innings (INN = Outs/3)
  so: 0.5, // Strikeouts (K)
  qs: 3, // Quality Starts
  sv: 3, // Saves (S)
  tba: -0.5, // Total Bases Allowed (estimated — see cbsPitcherPoints)
  // Present in the league but not projectable (→ 0): bs (-3), nh (+8), pg (+12).
} as const;

/**
 * League-average total bases per NON-home-run hit (≈1.28, from 2024 MLB:
 * (1·1B + 2·2B + 3·3B) / (1B+2B+3B)). Used to estimate Total Bases Allowed from
 * projected hits + HR allowed, since the feeds don't break out 2B/3B allowed.
 */
const BASES_PER_NON_HR_HIT = 1.28;

/** Counting-stat inputs for scoring. All optional; missing values count as 0. */
export interface ScoreCounts {
  // hitter
  bb?: number;
  cs?: number;
  r?: number;
  rbi?: number;
  sb?: number;
  tb?: number;
  // pitcher
  er?: number;
  hbp?: number;
  ibb?: number;
  ip?: number;
  so?: number;
  qs?: number;
  sv?: number;
  h?: number; // hits allowed (for TBA estimate)
  hr?: number; // HR allowed (for TBA estimate)
}

const n = (v?: number) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Projected CBS fantasy points for a hitter from projected counting stats. */
export function cbsHitterPoints(s: ScoreCounts): number {
  const W = CBS_HITTER_WEIGHTS;
  return (
    n(s.bb) * W.bb +
    n(s.cs) * W.cs +
    n(s.r) * W.r +
    n(s.rbi) * W.rbi +
    n(s.sb) * W.sb +
    n(s.tb) * W.tb
  );
}

/** Projected CBS fantasy points for a pitcher from projected counting stats. */
export function cbsPitcherPoints(s: ScoreCounts): number {
  const W = CBS_PITCHER_WEIGHTS;
  // Estimate total bases allowed: non-HR hits at the league-average bases/hit,
  // plus 4 bases per HR allowed.
  const tba = Math.max(0, n(s.h) - n(s.hr)) * BASES_PER_NON_HR_HIT + n(s.hr) * 4;
  return (
    n(s.bb) * W.bb +
    n(s.er) * W.er +
    n(s.hbp) * W.hbp +
    n(s.ibb) * W.ibb +
    n(s.ip) * W.ip +
    n(s.so) * W.so +
    n(s.qs) * W.qs +
    n(s.sv) * W.sv +
    tba * W.tba
  );
}

/** Round fantasy points to 1 decimal (display + stable sort). */
export function roundPts(v: number): number {
  return Math.round(v * 10) / 10;
}
