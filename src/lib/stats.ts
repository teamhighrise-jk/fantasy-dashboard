import type {
  FgStatus,
  FreeAgentStats,
  PlayerKind,
  PlayerStatsEntry,
  ProjStats,
  ProjSystem,
} from "@/lib/types";
import { normalizeName, teamsConflict } from "@/lib/teams";
import { cbsHitterPoints, cbsPitcherPoints, roundPts, type ScoreCounts } from "@/lib/cbs/scoring";
import {
  fetchAndFitEspnRater,
  hitterRater,
  pitcherRater,
  type RaterModel,
} from "@/lib/espn/playerRater";
import { loadLastGood, saveLastGood } from "@/lib/fgCache";

/**
 * Advanced-stats sourcing for the Free Agents page.
 *
 * Two public sources (no auth):
 *  - Baseball Savant custom leaderboard (CSV) — season-to-date expected stats +
 *    run value, keyed by MLBAM player_id.
 *  - FanGraphs leaderboard (FIP/xFIP/SIERA, season) and "OOPSY DC (RoS)"
 *    projections (type=roopsydc) — keyed by xMLBAMID (== MLBAM id).
 *
 * Savant and FanGraphs join cleanly by MLBAM id. Our free-agent list comes from
 * FantasyPros (no MLBAM id), so the final lookup is by normalized name + a team
 * safeguard (see `lib/teams`). Everything is best-effort: a failed source just
 * leaves those stats undefined.
 */

const SEASON = Number(process.env.FANTASY_SEASON) || new Date().getFullYear();

const SAVANT_UA = { "User-Agent": "Mozilla/5.0 (fantasy-dashboard)", Accept: "text/csv,*/*" };
const FG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.fangraphs.com/",
};

function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s === "" || s.toLowerCase() === "null") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

/** Parse one CSV line, honoring double-quoted fields that contain commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** "Sánchez, Cristopher" -> "Cristopher Sánchez" */
function savantName(raw: string): string {
  const [last, first] = raw.split(/,\s*/);
  return first ? `${first} ${last}` : raw;
}

interface RawRecord {
  name: string;
  team?: string;
  stats: FreeAgentStats;
  /** FanGraphs player id (from FG sources) — for the FanGraphs player-page link. */
  fgPlayerId?: string;
  /** Position label where a source provides one (e.g. OOPSY minpos). */
  position?: string;
}

async function fetchSavantCsv(url: string): Promise<{ header: string[]; rows: string[][] }> {
  const res = await fetch(url, { headers: SAVANT_UA, cache: "no-store" });
  if (!res.ok) throw new Error(`Savant failed: ${res.status}`);
  const lines = (await res.text()).split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]).map((h) => h.replace(/"/g, "").trim());
  const rows = lines.slice(1).map((l) => parseCsvLine(l).map((c) => c.replace(/^"|"$/g, "")));
  return { header, rows };
}

/** Expected stats (season) — fully populated via the dedicated endpoint. */
async function fetchSavantExpected(type: "pitcher" | "batter"): Promise<Map<string, RawRecord>> {
  const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=${type}&year=${SEASON}&min=1&csv=true`;
  const { header, rows } = await fetchSavantCsv(url);
  const idx = (c: string) => header.indexOf(c);
  const out = new Map<string, RawRecord>();
  for (const f of rows) {
    const mlbam = f[idx("player_id")];
    if (!mlbam) continue;
    const stats: FreeAgentStats =
      type === "pitcher"
        ? { xera: num(f[idx("xera")]), xba: num(f[idx("est_ba")]) }
        : { xwoba: num(f[idx("est_woba")]), xba: num(f[idx("est_ba")]), xslg: num(f[idx("est_slg")]) };
    out.set(mlbam, { name: savantName(f[idx("last_name, first_name")] ?? ""), stats });
  }
  return out;
}

/**
 * Run Value — Savant exposes it per pitch type (pitch-arsenal-stats); the
 * player's total Batting/Pitching Run Value is the sum across their pitch types.
 */
async function fetchSavantRunValue(type: "pitcher" | "batter"): Promise<Map<string, RawRecord>> {
  const url = `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=${type}&year=${SEASON}&min=1&csv=true`;
  const { header, rows } = await fetchSavantCsv(url);
  const iId = header.indexOf("player_id");
  const iRv = header.indexOf("run_value");
  const iName = header.indexOf("last_name, first_name");
  const sum = new Map<string, number>();
  const name = new Map<string, string>();
  for (const f of rows) {
    const id = f[iId];
    if (!id) continue;
    const rv = num(f[iRv]);
    if (rv !== undefined) sum.set(id, (sum.get(id) ?? 0) + rv);
    name.set(id, savantName(f[iName] ?? ""));
  }
  // Percentile of each player's run value within this kind's pool (higher = better,
  // like Savant's percentile circle). Approximate — our pool isn't Savant's exact
  // qualified set — but conveys the same at-a-glance ranking.
  const totals = [...sum.values()].sort((a, b) => a - b);
  const denom = Math.max(1, totals.length - 1);
  const percentile = (v: number) => {
    let below = 0;
    for (const t of totals) if (t < v) below++;
    return Math.round((below / denom) * 100);
  };

  const out = new Map<string, RawRecord>();
  for (const [id, total] of sum) {
    out.set(id, {
      name: name.get(id) ?? "",
      stats: { runValue: Math.round(total), runValuePct: percentile(total) },
    });
  }
  return out;
}

/**
 * Savant percentile ranks (0-100, higher = better) — the values behind Savant's
 * slider colors. One CSV per kind carries every field we want: whiff + fastball
 * velocity (pitchers); exit velo, barrel, hard-hit, whiff, chase (hitters).
 */
async function fetchSavantPercentiles(type: "pitcher" | "batter"): Promise<Map<string, RawRecord>> {
  const url = `https://baseballsavant.mlb.com/leaderboard/percentile-rankings?type=${type}&year=${SEASON}&csv=true`;
  const { header, rows } = await fetchSavantCsv(url);
  const idx = (c: string) => header.indexOf(c);
  const out = new Map<string, RawRecord>();
  for (const f of rows) {
    const mlbam = f[idx("player_id")];
    if (!mlbam) continue;
    const stats: FreeAgentStats =
      type === "pitcher"
        ? { whiffPctl: num(f[idx("whiff_percent")]), fbVeloPctl: num(f[idx("fb_velocity")]) }
        : {
            evPctl: num(f[idx("exit_velocity")]),
            brlPctl: num(f[idx("brl_percent")]),
            hardHitPctl: num(f[idx("hard_hit_percent")]),
            whiffPctl: num(f[idx("whiff_percent")]),
            chasePctl: num(f[idx("chase_percent")]),
          };
    out.set(mlbam, { name: savantName(f[idx("player_name")] ?? ""), stats });
  }
  return out;
}

async function fetchFgJson(url: string): Promise<Record<string, unknown>[]> {
  // FanGraphs can soft-rate-limit (200 with an empty body) under rapid requests.
  // Retry with backoff and only accept a non-empty array, so we don't cache gaps.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: FG_HEADERS, cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { data?: unknown } | unknown[];
        const arr = (Array.isArray(j) ? j : ((j as { data?: unknown[] }).data ?? [])) as Record<
          string,
          unknown
        >[];
        if (arr.length) return arr;
      }
    } catch {
      /* fall through to retry */
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error(`FanGraphs returned no data: ${url.split("?")[0]}`);
}

/**
 * FanGraphs season PITCHING leaderboard — advanced (FIP/xFIP/SIERA/K%/BB%/K-BB%)
 * plus ACTUAL season totals (IP/ERA/WHIP/K9/BB9/SV).
 */
async function fetchFgLeaderboardPit(): Promise<Map<string, RawRecord>> {
  const url =
    `https://www.fangraphs.com/api/leaders/major-league/data?pos=all&stats=pit&lg=all` +
    `&qual=0&season=${SEASON}&season1=${SEASON}&month=0&team=0&pageitems=2000&pagenum=1&ind=0&type=8`;
  const rows = await fetchFgJson(url);
  const out = new Map<string, RawRecord>();
  for (const r of rows) {
    const mlbam = String(r.xMLBAMID ?? "");
    if (!mlbam) continue;
    out.set(mlbam, {
      name: stripTags(String(r.Name ?? "")),
      team: stripTags(String(r.Team ?? "")),
      fgPlayerId: String(r.playerid ?? "") || undefined,
      stats: {
        fip: num(r.FIP),
        xfip: num(r.xFIP),
        siera: num(r.SIERA),
        kPct: num(r["K%"]),
        bbPct: num(r["BB%"]),
        kbbPct: num(r["K-BB%"]),
        seasonIp: num(r.IP),
        seasonEra: num(r.ERA),
        seasonWhip: num(r.WHIP),
        seasonK9: num(r["K/9"]),
        seasonBb9: num(r["BB/9"]),
        seasonSv: num(r.SV),
      },
    });
  }
  return out;
}

/**
 * FanGraphs season BATTING leaderboard — ACTUAL season totals (PA/AVG/OBP/SLG/
 * HR/SB). Total bases (TB) isn't returned, so derive it from 1B/2B/3B/HR.
 */
async function fetchFgLeaderboardBat(): Promise<Map<string, RawRecord>> {
  const url =
    `https://www.fangraphs.com/api/leaders/major-league/data?pos=all&stats=bat&lg=all` +
    `&qual=0&season=${SEASON}&season1=${SEASON}&month=0&team=0&pageitems=2000&pagenum=1&ind=0&type=8`;
  const rows = await fetchFgJson(url);
  const out = new Map<string, RawRecord>();
  for (const r of rows) {
    const mlbam = String(r.xMLBAMID ?? "");
    if (!mlbam) continue;
    const singles = num(r["1B"]);
    const doubles = num(r["2B"]);
    const triples = num(r["3B"]);
    const hr = num(r.HR);
    // TB = 1B + 2·2B + 3·3B + 4·HR (only when we have the components).
    const tb =
      singles !== undefined && doubles !== undefined && triples !== undefined && hr !== undefined
        ? singles + 2 * doubles + 3 * triples + 4 * hr
        : undefined;
    out.set(mlbam, {
      name: stripTags(String(r.Name ?? "")),
      team: stripTags(String(r.Team ?? "")),
      fgPlayerId: String(r.playerid ?? "") || undefined,
      stats: {
        seasonPa: num(r.PA),
        seasonAvg: num(r.AVG),
        seasonObp: num(r.OBP),
        seasonSlg: num(r.SLG),
        seasonHr: hr,
        seasonTb: tb,
        seasonSb: num(r.SB),
        seasonWoba: num(r.wOBA),
        seasonWrcPlus: num(r["wRC+"]),
      },
    });
  }
  return out;
}

/**
 * Rest-of-season PROJECTIONS from several FanGraphs systems + our weighted blend.
 * Systems: THE BAT (X for hitters), Depth Charts (Steamer+ZiPS), OOPSY. Each is
 * exposed under `projBySystem`; "blend" is a 40/40/20 (THE BAT / DC / OOPSY)
 * weighted combination — counting stats weighted, rate stats RECOMPUTED from
 * weighted components (not naive rate-averaging). Keyed by MLBAM id.
 */
// Base blend weights (renormalized per player over whichever systems are present).
const BLEND_W: Record<Exclude<ProjSystem, "blend">, number> = { thebat: 0.4, dc: 0.4, oopsy: 0.2 };

// Component totals we need to recompute blended rates.
interface ProjComp {
  disp: ProjStats; // this system's own displayed stats
  // Raw counting stats fed to the CBS scoring (blended separately from rates).
  score: ScoreCounts;
  // Projected wins (pitcher) — an ESPN-rater input not used by CBS scoring.
  w?: number;
  // hitter components
  pa?: number;
  ab?: number;
  h?: number;
  tb?: number;
  obpNum?: number; // H + BB + HBP
  obpDen?: number; // AB + BB + HBP + SF
  // pitcher components
  ip?: number;
  er?: number;
  hbb?: number; // H + BB
}

async function fetchFgProjections(
  stats: "pit" | "bat",
  raterModel: RaterModel | null,
  /** Season-to-date volume (PA for hitters, IP for pitchers) by MLBAM id — sets
   * the full-season-pace scale factor k = seasonVol / rosVol for the ESPN rater. */
  seasonVol: Map<string, number>
): Promise<Map<string, RawRecord>> {
  const systems: { system: Exclude<ProjSystem, "blend">; type: string }[] =
    stats === "bat"
      ? [
          { system: "thebat", type: "rthebatx" }, // THE BAT X (Statcast) for hitters
          { system: "dc", type: "rfangraphsdc" },
          { system: "oopsy", type: "roopsydc" },
        ]
      : [
          { system: "thebat", type: "rthebat" }, // X == BAT for pitchers
          { system: "dc", type: "rfangraphsdc" },
          { system: "oopsy", type: "roopsydc" },
        ];

  const parse = (r: RawRecord2): ProjComp => {
    if (stats === "pit") {
      const ip = num(r.IP);
      const er = num(r.ER);
      const h = num(r.H);
      const bb = num(r.BB);
      const sv = num(r.SV);
      const so = num(r.SO);
      const w = num(r.W);
      // Raw counting stats fed to the CBS pitcher scoring (BS/NH/PG unprojected).
      const score: ScoreCounts = {
        bb,
        er,
        hbp: num(r.HBP),
        ibb: num(r.IBB),
        ip,
        so,
        qs: num(r.QS),
        sv,
        h,
        hr: num(r.HR),
      };
      const ptsCbs = ip !== undefined ? roundPts(cbsPitcherPoints(score)) : undefined;
      return {
        disp: { ip, gs: num(r.GS), era: num(r.ERA), whip: num(r.WHIP), sv, ptsCbs },
        score,
        w,
        ip,
        er,
        hbb: h !== undefined && bb !== undefined ? h + bb : undefined,
      };
    }
    const pa = num(r.PA);
    const ab = num(r.AB);
    const h = num(r.H);
    const b2 = num(r["2B"]);
    const b3 = num(r["3B"]);
    const hr = num(r.HR);
    const b1 = num(r["1B"]);
    const bb = num(r.BB);
    const hbp = num(r.HBP);
    const sf = num(r.SF);
    const rr = num(r.R);
    const rbi = num(r.RBI);
    const sb = num(r.SB);
    const cs = num(r.CS);
    const tb =
      b1 !== undefined && b2 !== undefined && b3 !== undefined && hr !== undefined
        ? b1 + 2 * b2 + 3 * b3 + 4 * hr
        : undefined;
    const score: ScoreCounts = { bb, cs, r: rr, rbi, sb, tb };
    const hasPt = ab !== undefined || pa !== undefined;
    const ptsCbs = hasPt ? roundPts(cbsHitterPoints(score)) : undefined;
    return {
      disp: {
        pa,
        r: rr,
        hr,
        rbi,
        sb,
        avg: num(r.AVG),
        obp: num(r.OBP),
        slg: num(r.SLG),
        ops: num(r.OPS) ?? add(num(r.OBP), num(r.SLG)),
        woba: num(r.wOBA),
        ptsCbs,
      },
      score,
      pa,
      ab,
      h,
      tb,
      obpNum: sum(h, bb, hbp),
      obpDen: sum(ab, bb, hbp, sf),
    };
  };

  const fetched = await Promise.all(
    systems.map(async ({ system, type }) => {
      const url =
        `https://www.fangraphs.com/api/projections?type=${type}&stats=${stats}` +
        `&pos=all&team=0&players=0&lg=all`;
      const byId = new Map<string, ProjComp>();
      const meta = new Map<string, { name: string; team?: string; fgPlayerId?: string; position?: string }>();
      try {
        for (const r of await fetchFgJson(url)) {
          const mlbam = String(r.xMLBAMID ?? "");
          if (!mlbam) continue;
          byId.set(mlbam, parse(r as RawRecord2));
          meta.set(mlbam, {
            name: stripTags(String(r.PlayerName ?? "")),
            team: String(r.Team ?? "") || undefined,
            fgPlayerId: String(r.playerid ?? "") || undefined,
            position: String(r.minpos ?? "") || undefined,
          });
        }
      } catch (e) {
        console.warn(`[stats] projection ${type} failed:`, e instanceof Error ? e.message : e);
      }
      return { system, byId, meta };
    })
  );

  const ids = new Set<string>();
  for (const f of fetched) for (const id of f.byId.keys()) ids.add(id);

  const out = new Map<string, RawRecord>();
  for (const id of ids) {
    const projBySystem: Partial<Record<ProjSystem, ProjStats>> = {};
    const present: { system: Exclude<ProjSystem, "blend">; comp: ProjComp }[] = [];
    let name = "";
    let team: string | undefined;
    let fgPlayerId: string | undefined;
    let position: string | undefined;
    for (const f of fetched) {
      const comp = f.byId.get(id);
      if (!comp) continue;
      projBySystem[f.system] = comp.disp;
      present.push({ system: f.system, comp });
      const m = f.meta.get(id);
      if (m) {
        name ||= m.name;
        team ||= m.team;
        fgPlayerId ||= m.fgPlayerId;
        position ||= m.position;
      }
    }
    // ESPN Player Rater per system: PACE (scaled to season-to-date volume, so a
    // player at his projected rate reads ~his current ESPN PR) + REMAINING (raw
    // rest-of-season accumulation, k=1).
    const vol = seasonVol.get(id);
    if (raterModel) {
      for (const { comp } of present) {
        const rosVol = stats === "bat" ? comp.pa : comp.ip;
        const k = vol && rosVol ? vol / rosVol : 1;
        const pace =
          stats === "bat"
            ? hitterRater(raterModel, { r: comp.disp.r, hr: comp.disp.hr, rbi: comp.disp.rbi, sb: comp.disp.sb, h: comp.h, ab: comp.ab }, k)
            : pitcherRater(raterModel, { w: comp.w, sv: comp.disp.sv, k: comp.score.so, er: comp.er, h: comp.score.h, bb: comp.score.bb, ip: comp.ip }, k);
        const rem =
          stats === "bat"
            ? hitterRater(raterModel, { r: comp.disp.r, hr: comp.disp.hr, rbi: comp.disp.rbi, sb: comp.disp.sb, h: comp.h, ab: comp.ab }, 1)
            : pitcherRater(raterModel, { w: comp.w, sv: comp.disp.sv, k: comp.score.so, er: comp.er, h: comp.score.h, bb: comp.score.bb, ip: comp.ip }, 1);
        if (pace !== undefined) comp.disp.raterEspn = roundPts(pace);
        if (rem !== undefined) comp.disp.raterEspnRem = roundPts(rem);
      }
    }
    const blend = blendProjections(present, stats, raterModel, vol);
    if (blend) projBySystem.blend = blend;
    out.set(id, { name, team, fgPlayerId, position, stats: { projBySystem } });
  }
  return out;
}

/** Compute the 40/40/20 blend, renormalizing over present systems; recompute rates. */
function blendProjections(
  present: { system: Exclude<ProjSystem, "blend">; comp: ProjComp }[],
  stats: "pit" | "bat",
  raterModel: RaterModel | null,
  seasonVol: number | undefined
): ProjStats | undefined {
  if (present.length === 0) return undefined;
  const W = present.reduce((s, p) => s + BLEND_W[p.system], 0);
  if (W <= 0) return undefined;
  const wsum = (pick: (c: ProjComp) => number | undefined) =>
    present.reduce((s, p) => {
      const v = pick(p.comp);
      return v === undefined ? s : s + BLEND_W[p.system] * v;
    }, 0);

  if (stats === "pit") {
    const ipW = wsum((c) => c.ip);
    // Blended counting stats → CBS points (weighted average over present systems).
    const pScore: ScoreCounts = {
      bb: wsum((c) => c.score.bb) / W,
      er: wsum((c) => c.score.er) / W,
      hbp: wsum((c) => c.score.hbp) / W,
      ibb: wsum((c) => c.score.ibb) / W,
      ip: wsum((c) => c.score.ip) / W,
      so: wsum((c) => c.score.so) / W,
      qs: wsum((c) => c.score.qs) / W,
      sv: wsum((c) => c.score.sv) / W,
      h: wsum((c) => c.score.h) / W,
      hr: wsum((c) => c.score.hr) / W,
    };
    const pInput = {
      w: wsum((c) => c.w) / W,
      sv: pScore.sv,
      k: pScore.so,
      er: pScore.er,
      h: pScore.h,
      bb: pScore.bb,
      ip: pScore.ip,
    };
    const kBlend = seasonVol && pScore.ip ? seasonVol / pScore.ip : 1;
    const prPace = raterModel && ipW > 0 ? pitcherRater(raterModel, pInput, kBlend) : undefined;
    const prRem = raterModel && ipW > 0 ? pitcherRater(raterModel, pInput, 1) : undefined;
    return {
      ip: wsum((c) => c.ip) / W,
      gs: wsum((c) => c.disp.gs) / W,
      sv: wsum((c) => c.disp.sv) / W,
      era: ipW > 0 ? (9 * wsum((c) => c.er)) / ipW : undefined,
      whip: ipW > 0 ? wsum((c) => c.hbb) / ipW : undefined,
      ptsCbs: ipW > 0 ? roundPts(cbsPitcherPoints(pScore)) : undefined,
      raterEspn: prPace === undefined ? undefined : roundPts(prPace),
      raterEspnRem: prRem === undefined ? undefined : roundPts(prRem),
    };
  }
  const abW = wsum((c) => c.ab);
  const paW = wsum((c) => c.pa);
  const obpDenW = wsum((c) => c.obpDen);
  const hScore: ScoreCounts = {
    bb: wsum((c) => c.score.bb) / W,
    cs: wsum((c) => c.score.cs) / W,
    r: wsum((c) => c.score.r) / W,
    rbi: wsum((c) => c.score.rbi) / W,
    sb: wsum((c) => c.score.sb) / W,
    tb: wsum((c) => c.score.tb) / W,
  };
  const rBlend = wsum((c) => c.disp.r) / W;
  const hrBlendVal = wsum((c) => c.disp.hr) / W;
  const rbiBlend = wsum((c) => c.disp.rbi) / W;
  const sbBlend = wsum((c) => c.disp.sb) / W;
  const paBlend = paW / W;
  const hInput = {
    r: rBlend,
    hr: hrBlendVal,
    rbi: rbiBlend,
    sb: sbBlend,
    h: wsum((c) => c.h) / W,
    ab: abW / W,
  };
  const kBlend = seasonVol && paBlend ? seasonVol / paBlend : 1;
  const hrPace = raterModel && abW > 0 ? hitterRater(raterModel, hInput, kBlend) : undefined;
  const hrRem = raterModel && abW > 0 ? hitterRater(raterModel, hInput, 1) : undefined;
  return {
    pa: paBlend,
    r: rBlend,
    hr: hrBlendVal,
    rbi: rbiBlend,
    sb: sbBlend,
    avg: abW > 0 ? wsum((c) => c.h) / abW : undefined,
    obp: obpDenW > 0 ? wsum((c) => c.obpNum) / obpDenW : undefined,
    slg: abW > 0 ? wsum((c) => c.tb) / abW : undefined,
    ops:
      abW > 0 && obpDenW > 0
        ? wsum((c) => c.obpNum) / obpDenW + wsum((c) => c.tb) / abW
        : undefined,
    // wOBA lacks public constants to recompute — PA-weight the rate.
    woba: paW > 0 ? wsum((c) => mul(c.disp.woba, c.pa)) / paW : undefined,
    ptsCbs: abW > 0 ? roundPts(cbsHitterPoints(hScore)) : undefined,
    raterEspn: hrPace === undefined ? undefined : roundPts(hrPace),
    raterEspnRem: hrRem === undefined ? undefined : roundPts(hrRem),
  };
}

/** FanGraphs projection rows carry many numeric fields under string keys. */
type RawRecord2 = Record<string, unknown>;
const add = (a?: number, b?: number) => (a !== undefined && b !== undefined ? a + b : undefined);
const mul = (a?: number, b?: number) => (a !== undefined && b !== undefined ? a * b : undefined);
const sum = (...xs: (number | undefined)[]) =>
  xs.some((x) => x === undefined) ? undefined : xs.reduce<number>((s, x) => s + (x as number), 0);

/** A matched player's stats plus the ids needed for source-page links. */
export interface StatsMatch {
  stats: FreeAgentStats;
  mlbamId?: string;
  fgPlayerId?: string;
}

interface NameRecord {
  name: string;
  team?: string;
  position?: string;
  stats: FreeAgentStats;
  mlbamId: string;
  fgPlayerId?: string;
}

export interface StatsIndex {
  /** Stats + ids for a player by name within a kind; team guards same-name collisions. */
  lookup(name: string, kind: PlayerKind, team?: string): StatsMatch | undefined;
  /** Every player in the index (hitters + pitchers) — for search/watchlist. */
  all: PlayerStatsEntry[];
  /** FanGraphs data health (fresh / stale-cached / down) — surfaced to the UI. */
  fg: FgStatus;
}

/** Merge several MLBAM-keyed maps into one name-keyed record (stats + ids). */
function buildNameMap(maps: Map<string, RawRecord>[]): Map<string, NameRecord> {
  const ids = new Set<string>();
  for (const m of maps) for (const id of m.keys()) ids.add(id);
  const byName = new Map<string, NameRecord>();
  for (const id of ids) {
    let name = "";
    let team: string | undefined;
    let position: string | undefined;
    let fgPlayerId: string | undefined;
    const stats: FreeAgentStats = {};
    for (const m of maps) {
      const rec = m.get(id);
      if (!rec) continue;
      if (rec.name) name ||= rec.name;
      if (rec.team) team ||= rec.team;
      if (rec.position) position ||= rec.position;
      if (rec.fgPlayerId) fgPlayerId ||= rec.fgPlayerId;
      Object.assign(stats, rec.stats);
    }
    const key = normalizeName(name);
    if (key && !byName.has(key)) byName.set(key, { name, team, position, stats, mlbamId: id, fgPlayerId });
  }
  return byName;
}

/** Flatten a name-keyed map into PlayerStatsEntry rows of a given kind. */
function entriesFrom(map: Map<string, NameRecord>, kind: PlayerKind): PlayerStatsEntry[] {
  const out: PlayerStatsEntry[] = [];
  for (const [key, r] of map) {
    out.push({
      id: r.mlbamId || `${kind[0]}:${key}`,
      name: r.name,
      kind,
      team: r.team ?? "",
      position: r.position ?? "",
      stats: r.stats,
      mlbamId: r.mlbamId,
      fgPlayerId: r.fgPlayerId,
    });
  }
  return out;
}

/**
 * Fetch all stat sources in parallel and return a name+kind lookup. Always
 * resolves (best-effort): any source that fails contributes nothing.
 */
export async function fetchFreeAgentStats(): Promise<StatsIndex> {
  const safe = <T>(p: Promise<Map<string, T>>) =>
    p.catch((e) => {
      console.warn("[stats] source failed:", e instanceof Error ? e.message : e);
      return new Map<string, T>();
    });

  // Fit the ESPN Player Rater model first (best-effort) so the projection
  // fetchers can turn each system's RoS projection into a ROS Player Rater. Also
  // carries ESPN's ACTUAL season-to-date PR (joined by name into the index below).
  const espn = await fetchAndFitEspnRater().catch((e) => {
    console.warn("[stats] espn rater fetch failed:", e instanceof Error ? e.message : e);
    return null;
  });
  const raterModel = espn?.model ?? null;
  const espnSeasonPr = espn?.seasonPrByName ?? new Map<string, { pr: number; team: string }>();
  if (raterModel) {
    console.log(
      `[stats] ESPN rater fit: hitters R²=${raterModel.hitterR2.toFixed(4)} (n=${raterModel.hitterN}), ` +
        `pitchers R²=${raterModel.pitcherR2.toFixed(4)} (n=${raterModel.pitcherN})`
    );
  }

  // Phase 1: everything except the projections. The season leaderboards give the
  // season-to-date volume (PA/IP) that sets the ESPN-rater "full-season pace" scale.
  const [expPit, expBat, rvPit, rvBat, pctPit, pctBat, fgLeadPit, fgLeadBat] = await Promise.all([
    safe(fetchSavantExpected("pitcher")),
    safe(fetchSavantExpected("batter")),
    safe(fetchSavantRunValue("pitcher")),
    safe(fetchSavantRunValue("batter")),
    safe(fetchSavantPercentiles("pitcher")),
    safe(fetchSavantPercentiles("batter")),
    safe(fetchFgLeaderboardPit()),
    safe(fetchFgLeaderboardBat()),
  ]);

  // FanGraphs resilience: when a FG fetch is empty (e.g. Cloudflare-blocked us),
  // fall back to the last-good persisted copy so FG-derived stats degrade to
  // "last-known" instead of blank. A map below this many rows counts as failed.
  const MIN_FG = 50;
  const resolveFg = async (
    key: string,
    fresh: Map<string, RawRecord>
  ): Promise<{ map: Map<string, RawRecord>; ok: boolean; stale: boolean; savedAt?: string }> => {
    if (fresh.size >= MIN_FG) return { map: fresh, ok: true, stale: false };
    const last = await loadLastGood<RawRecord>(key);
    if (last && last.map.size >= MIN_FG) {
      console.warn(
        `[stats] FanGraphs "${key}" unavailable (${fresh.size} rows) — serving last-good from ${last.savedAt} (${last.map.size} rows)`
      );
      return { map: last.map, ok: true, stale: true, savedAt: last.savedAt };
    }
    return { map: fresh, ok: false, stale: false };
  };

  const leadPitR = await resolveFg("leadPit", fgLeadPit);
  const leadBatR = await resolveFg("leadBat", fgLeadBat);

  // Season-to-date volume by MLBAM id: PA for hitters, IP for pitchers.
  const volFrom = (m: Map<string, RawRecord>, key: "seasonPa" | "seasonIp") => {
    const out = new Map<string, number>();
    for (const [id, rec] of m) {
      const v = rec.stats[key];
      if (typeof v === "number" && v > 0) out.set(id, v);
    }
    return out;
  };
  const volPit = volFrom(leadPitR.map, "seasonIp");
  const volBat = volFrom(leadBatR.map, "seasonPa");

  // Phase 2: projections (need the volume maps + rater model).
  const [fgProjPit, fgProjBat] = await Promise.all([
    safe(fetchFgProjections("pit", raterModel, volPit)),
    safe(fetchFgProjections("bat", raterModel, volBat)),
  ]);
  const projPitR = await resolveFg("projPit", fgProjPit);
  const projBatR = await resolveFg("projBat", fgProjBat);

  // Persist any FRESH healthy FG maps as the new last-good (best-effort).
  await saveLastGood({
    ...(fgLeadPit.size >= MIN_FG ? { leadPit: fgLeadPit } : {}),
    ...(fgLeadBat.size >= MIN_FG ? { leadBat: fgLeadBat } : {}),
    ...(fgProjPit.size >= MIN_FG ? { projPit: fgProjPit } : {}),
    ...(fgProjBat.size >= MIN_FG ? { projBat: fgProjBat } : {}),
  });

  const pitchers = buildNameMap([expPit, rvPit, pctPit, leadPitR.map, projPitR.map]);
  const hitters = buildNameMap([expBat, rvBat, pctBat, leadBatR.map, projBatR.map]);
  // FG health: down if any map is missing entirely; else stale if any came from
  // last-good; else ok. `savedAt` = earliest last-good timestamp in use.
  const fgResults = [leadPitR, leadBatR, projPitR, projBatR];
  const savedAt = fgResults
    .map((r) => r.savedAt)
    .filter((s): s is string => !!s)
    .sort()[0];
  const fg: FgStatus = !fgResults.every((r) => r.ok)
    ? { state: "down" }
    : fgResults.some((r) => r.stale)
      ? { state: "stale", savedAt }
      : { state: "ok" };

  // Attach ESPN's actual season-to-date Player Rater by normalized name (team-
  // guarded against same-name collisions). Applies to both kinds (two-way players
  // carry ESPN's single combined rating on each row).
  for (const map of [hitters, pitchers]) {
    for (const [key, rec] of map) {
      const e = espnSeasonPr.get(key);
      if (e && !teamsConflict(rec.team, e.team)) rec.stats.espnPrSeason = roundPts(e.pr);
    }
  }

  return {
    lookup(name, kind, team) {
      const rec = (kind === "pitcher" ? pitchers : hitters).get(normalizeName(name));
      if (!rec) return undefined;
      if (teamsConflict(team, rec.team)) return undefined;
      return { stats: rec.stats, mlbamId: rec.mlbamId, fgPlayerId: rec.fgPlayerId };
    },
    all: [...entriesFrom(hitters, "hitter"), ...entriesFrom(pitchers, "pitcher")],
    fg,
  };
}

// Shared TTL cache so the Free Agents and Teams pages don't each refetch the ~7
// stat-source calls. fetchFreeAgentStats is best-effort (never rejects).
const INDEX_TTL_MS = 20 * 60 * 1000;
// When FanGraphs is fully unavailable (and no last-good exists), cache only
// briefly so we retry soon instead of pinning an FG-less build for 20 minutes.
const INDEX_TTL_DEGRADED_MS = 2 * 60 * 1000;
let indexCache: { at: number; ttl: number; value: StatsIndex } | null = null;

export async function getStatsIndex(): Promise<StatsIndex> {
  if (indexCache && Date.now() - indexCache.at < indexCache.ttl) return indexCache.value;
  const value = await fetchFreeAgentStats();
  // Only cache a healthy build — if sources mostly failed, don't pin the gaps.
  if (value.all.length > 100) {
    // Full TTL only when FG is fresh; when stale/down, retry soon to recover.
    const ttl = value.fg.state === "ok" ? INDEX_TTL_MS : INDEX_TTL_DEGRADED_MS;
    indexCache = { at: Date.now(), ttl, value };
  }
  return value;
}
