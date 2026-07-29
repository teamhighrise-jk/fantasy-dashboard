import { getEspnConfig, type EspnConfig } from "@/lib/config";

/**
 * Reverse-engineered ESPN "Player Rater" for a 5x5 roto league.
 *
 * ESPN's Player Rater assigns each player a value = the SUM of per-category
 * z-scores (standard deviations above the average rostered player) across the
 * league's scoring categories. Because a z-score is linear in the underlying
 * stat — and even a rate category's contribution (AVG) is linear once written as
 * an impact, H - μ·AB — the whole rating is a LINEAR function of the raw counting
 * stats. So we can recover ESPN's exact per-category weights by an ordinary
 * least-squares regression of ESPN's published `totalRating` on the stat
 * components, then apply those same weights to our rest-of-season projections to
 * get a ROS Player Rater on ESPN's own scale.
 *
 * The fit is near-exact (validated R² ≈ 0.999 hitters / 0.996 pitchers), and
 * because we refit on every data refresh the ROS rater auto-recalibrates to
 * ESPN's current numbers as the season progresses.
 *
 * League categories (auto-confirmed via mSettings scoringType=ROTO):
 *   Hitting  R / HR / RBI / SB / AVG   → model inputs [R, HR, RBI, SB, H, AB]
 *   Pitching W / SV / K / ERA / WHIP   → model inputs [W, SV, K, ER, (H+BB), Outs]
 * (ERA impact is linear in ER+Outs; WHIP impact is linear in (H+BB)+Outs.)
 */

const READ_HOST = "https://lm-api-reads.fantasy.espn.com";

// ESPN stat ids in the player `stats` map.
const HIT = { AB: "0", H: "1", HR: "5", R: "20", RBI: "21", SB: "23" };
const PIT = { OUTS: "34", H: "37", BB: "39", ER: "45", K: "48", W: "53", SV: "57" };

export interface RaterModel {
  /** OLS coefficients for [intercept, R, HR, RBI, SB, H, AB]. */
  hitter: number[];
  /** OLS coefficients for [intercept, W, SV, K, ER, (H+BB), Outs]. */
  pitcher: number[];
  hitterR2: number;
  pitcherR2: number;
  hitterN: number;
  pitcherN: number;
}

/** Rest-of-season projection components for a hitter (from our blend). */
export interface HitterRaterInput {
  r?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  h?: number;
  ab?: number;
}
/** Rest-of-season projection components for a pitcher (from our blend). */
export interface PitcherRaterInput {
  w?: number;
  sv?: number;
  k?: number;
  er?: number;
  h?: number;
  bb?: number;
  ip?: number;
}

function buildCookieHeader(cfg: EspnConfig): string {
  const swid = cfg.swid.startsWith("{") ? cfg.swid : cfg.swid ? `{${cfg.swid}}` : "";
  const parts: string[] = [];
  if (cfg.espnS2) parts.push(`espn_s2=${cfg.espnS2}`);
  if (swid) parts.push(`SWID=${swid}`);
  return parts.join("; ");
}

/** Ordinary least squares via normal equations (Gauss-Jordan). Returns coefficients + R². */
function ols(X: number[][], y: number[]): { beta: number[]; r2: number } {
  const n = X.length;
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const B = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      B[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b];
    }
  }
  const M = A.map((row, i) => [...row, B[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-9;
    for (let k = c; k <= p; k++) M[c][k] /= d;
    for (let r = 0; r < p; r++)
      if (r !== c) {
        const f = M[r][c];
        for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k];
      }
  }
  const beta = M.map((row) => row[p]);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yh = X[i].reduce((s, x, a) => s + x * beta[a], 0);
    ssr += (y[i] - yh) ** 2;
    sst += (y[i] - ybar) ** 2;
  }
  return { beta, r2: sst > 0 ? 1 - ssr / sst : 0 };
}

type EspnStatSplit = { statSourceId: number; statSplitTypeId: number; seasonId: number; stats?: Record<string, number> };
type EspnRatingEntry = {
  ratings?: Record<string, { totalRating?: number }>;
  player?: { fullName?: string; stats?: EspnStatSplit[] };
};

const nz = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Fetch ESPN's whole player pool (each carries its live Player Rater + season
 * stats) and fit the hitter/pitcher rating models. Best-effort: returns null if
 * ESPN isn't configured or the request fails (callers just show a blank column).
 */
export async function fetchAndFitEspnRater(): Promise<RaterModel | null> {
  const cfg = getEspnConfig();
  if (!cfg) return null;

  const url =
    `${READ_HOST}/apis/v3/games/flb/seasons/${cfg.season}` +
    `/segments/0/leagues/${cfg.leagueId}/players?view=kona_player_info&scoringPeriodId=0`;
  let entries: EspnRatingEntry[];
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (fantasy-dashboard)",
        ...(buildCookieHeader(cfg) ? { Cookie: buildCookieHeader(cfg) } : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ESPN players ${res.status}`);
    const j = (await res.json()) as { players?: EspnRatingEntry[] } | EspnRatingEntry[];
    entries = Array.isArray(j) ? j : j.players ?? [];
  } catch (e) {
    console.warn("[espn rater] fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }

  const actual = (e: EspnRatingEntry) =>
    e.player?.stats?.find(
      (s) => s.statSourceId === 0 && s.statSplitTypeId === 0 && s.seasonId === cfg.season
    )?.stats;

  const HX: number[][] = [];
  const HY: number[] = [];
  const PX: number[][] = [];
  const PY: number[] = [];
  for (const e of entries) {
    const s = actual(e);
    const y = e.ratings?.["0"]?.totalRating;
    if (!s || typeof y !== "number") continue;
    const ab = nz(s[HIT.AB]);
    const outs = nz(s[PIT.OUTS]);
    const twoWay = ab > 50 && outs > 30;
    if (twoWay) continue; // skip two-way players from calibration (noisy)
    if (outs >= 30) {
      PX.push([1, nz(s[PIT.W]), nz(s[PIT.SV]), nz(s[PIT.K]), nz(s[PIT.ER]), nz(s[PIT.H]) + nz(s[PIT.BB]), outs]);
      PY.push(y);
    } else if (ab >= 20) {
      HX.push([1, nz(s[HIT.R]), nz(s[HIT.HR]), nz(s[HIT.RBI]), nz(s[HIT.SB]), nz(s[HIT.H]), ab]);
      HY.push(y);
    }
  }

  if (HX.length < 30 || PX.length < 30) {
    console.warn(`[espn rater] too few samples (H=${HX.length} P=${PX.length}) — skipping`);
    return null;
  }
  const h = ols(HX, HY);
  const p = ols(PX, PY);
  return {
    hitter: h.beta,
    pitcher: p.beta,
    hitterR2: h.r2,
    pitcherR2: p.r2,
    hitterN: HX.length,
    pitcherN: PX.length,
  };
}

/**
 * Apply the fitted model to ROS projection components → ROS Player Rater.
 *
 * `k` scales the projection to the volume basis the model was calibrated on
 * (ESPN's season-to-date accumulation). Because the rating is affine
 * (rating = intercept + Σ coef·stat), scaling the stats by k scales only the
 * non-intercept part: rating(k·x) = intercept + k·(rating(x) − intercept). With
 * k = seasonToDateVolume / rosVolume, a player projected to continue at his
 * current rate reproduces ~his current ESPN Player Rater (the "full-season pace"
 * reading). k defaults to 1 (raw rest-of-season accumulation).
 */
export function hitterRater(model: RaterModel, c: HitterRaterInput, k = 1): number | undefined {
  if (c.ab === undefined && c.h === undefined) return undefined;
  const b = model.hitter;
  const sum = b[1] * nz(c.r) + b[2] * nz(c.hr) + b[3] * nz(c.rbi) + b[4] * nz(c.sb) + b[5] * nz(c.h) + b[6] * nz(c.ab);
  return b[0] + k * sum;
}

export function pitcherRater(model: RaterModel, c: PitcherRaterInput, k = 1): number | undefined {
  if (c.ip === undefined) return undefined;
  const b = model.pitcher;
  const outs = nz(c.ip) * 3;
  const sum = b[1] * nz(c.w) + b[2] * nz(c.sv) + b[3] * nz(c.k) + b[4] * nz(c.er) + b[5] * (nz(c.h) + nz(c.bb)) + b[6] * outs;
  return b[0] + k * sum;
}
