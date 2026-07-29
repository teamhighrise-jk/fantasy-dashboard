"use client";

import { useMemo, useState } from "react";
import type { FreeAgentStats, PlayerAvailability, PlayerKind } from "@/lib/types";
import { EspnLogo, CbsLogo } from "@/components/LeagueLogos";
import { sortPositions } from "@/lib/teams";

type Fmt = (v: number) => string;
// Baseball rate stats: 3 decimals, no leading zero (".311").
const rate3: Fmt = (v) => v.toFixed(3).replace(/^(-?)0\./, "$1.");
const dec2: Fmt = (v) => v.toFixed(2);
const dec1: Fmt = (v) => v.toFixed(1);
const int: Fmt = (v) => String(Math.round(v));
// FanGraphs returns K%/BB% as fractions (0.301 → "30.1%").
const pct1: Fmt = (v) => `${(v * 100).toFixed(1)}%`;

/** FreeAgentStats keys that hold a numeric stat (excludes the nested projBySystem bag). */
export type StatKey = Exclude<keyof FreeAgentStats, "projBySystem">;

interface StatCol {
  label: string;
  key: StatKey;
  fmt: Fmt;
  /** True if a lower value is better (sorts smallest-first on first click). */
  lowerBetter: boolean;
  tooltip?: (stats: FreeAgentStats) => string | undefined;
}
interface StatGroup {
  label: string;
  cols: StatCol[];
}

// RV is displayed as a 0-100 percentile (matches Savant's circle); raw value on hover.
const rvCol = (): StatCol => ({
  label: "RV",
  key: "runValuePct",
  fmt: int,
  lowerBetter: false,
  tooltip: (s) =>
    typeof s.runValue === "number" ? `Run value ${s.runValue} · percentile (0–100, higher=better)` : undefined,
});

// Savant percentile-rank column (0-100, higher = better — like Savant's slider colors).
const pctlCol = (label: string, key: StatKey, what: string): StatCol => ({
  label,
  key,
  fmt: int,
  lowerBetter: false,
  tooltip: () => `${what} — Savant percentile rank (0–100, higher=better)`,
});

// Rest-of-season league VALUE, run through each league's scoring — shown per the
// `valueCols` prop (CBS on CBS views, ESPN on ESPN views, both on the Watchlist).
// Follows the projection-system toggle (blend by default), like the other proj*.
export type ValueCol = "cbs" | "espn";
// CBS = league fantasy points (one column). ESPN = 5x5-roto Player Rater, shown
// two ways: PACE (full-season pace — a player at his projected rate reads ~his
// current ESPN PR) and REM (value remaining — the raw rest-of-season projection).
const CBS_PTS: StatCol = {
  label: "CBS",
  key: "projPtsCbs",
  fmt: dec1,
  lowerBetter: false,
  tooltip: () =>
    "Projected CBS fantasy points (rest-of-season), from the selected projection system. Blown saves / no-hitters / perfect games aren't projected; total-bases-allowed is estimated.",
};
const ESPN_SEASON: StatCol = {
  label: "Szn",
  key: "espnPrSeason",
  fmt: dec1,
  lowerBetter: false,
  tooltip: () =>
    "ESPN's actual season-to-date Player Rater (the published number), joined by name. Not a projection — shown for reference next to the projected Pace/Rem.",
};
const ESPN_PACE: StatCol = {
  label: "Pace",
  key: "projRaterEspn",
  fmt: dec1,
  lowerBetter: false,
  tooltip: () =>
    "ESPN Player Rater (5x5 roto), full-season PACE — the projection scaled to season-to-date volume, so a player continuing at his projected rate reads ~his current ESPN Player Rater. Reverse-engineered from ESPN's live rater.",
};
const ESPN_REM: StatCol = {
  label: "Rem",
  key: "projRaterEspnRem",
  fmt: dec1,
  lowerBetter: false,
  tooltip: () =>
    "ESPN Player Rater (5x5 roto), value REMAINING — the actual rest-of-season projection (naturally smaller later in the season, reflecting fewer games left to accrue).",
};
/** Build the leading value group(s) for the requested leagues (one group each). */
function valueGroups(cols: ValueCol[]): StatGroup[] {
  const out: StatGroup[] = [];
  if (cols.includes("cbs")) out.push({ label: "Pts ROS", cols: [CBS_PTS] });
  if (cols.includes("espn")) out.push({ label: "Player Rater", cols: [ESPN_SEASON, ESPN_PACE, ESPN_REM] });
  return out;
}

const GROUPS: Record<PlayerKind, StatGroup[]> = {
  hitter: [
    {
      label: "Season",
      cols: [
        { label: "PA", key: "seasonPa", fmt: int, lowerBetter: false },
        { label: "AVG", key: "seasonAvg", fmt: rate3, lowerBetter: false },
        { label: "OBP", key: "seasonObp", fmt: rate3, lowerBetter: false },
        { label: "SLG", key: "seasonSlg", fmt: rate3, lowerBetter: false },
        { label: "wOBA", key: "seasonWoba", fmt: rate3, lowerBetter: false },
        { label: "wRC+", key: "seasonWrcPlus", fmt: int, lowerBetter: false },
        { label: "HR", key: "seasonHr", fmt: int, lowerBetter: false },
        { label: "TB", key: "seasonTb", fmt: int, lowerBetter: false },
        { label: "SB", key: "seasonSb", fmt: int, lowerBetter: false },
      ],
    },
    {
      label: "Savant",
      cols: [
        { label: "xwOBA", key: "xwoba", fmt: rate3, lowerBetter: false },
        { label: "xBA", key: "xba", fmt: rate3, lowerBetter: false },
        { label: "xSLG", key: "xslg", fmt: rate3, lowerBetter: false },
        rvCol(),
      ],
    },
    {
      label: "Savant %ile",
      cols: [
        pctlCol("EV", "evPctl", "Exit velocity"),
        pctlCol("Barrel", "brlPctl", "Barrel rate"),
        pctlCol("HardHit", "hardHitPctl", "Hard-hit rate"),
        pctlCol("Whiff", "whiffPctl", "Whiff rate"),
        pctlCol("Chase", "chasePctl", "Chase rate"),
      ],
    },
    {
      label: "Projections (RoS)",
      cols: [
        { label: "PA", key: "projPa", fmt: int, lowerBetter: false },
        { label: "R", key: "projR", fmt: int, lowerBetter: false },
        { label: "HR", key: "projHr", fmt: int, lowerBetter: false },
        { label: "RBI", key: "projRbi", fmt: int, lowerBetter: false },
        { label: "SB", key: "projSb", fmt: int, lowerBetter: false },
        { label: "AVG", key: "projAvg", fmt: rate3, lowerBetter: false },
        { label: "OBP", key: "projObp", fmt: rate3, lowerBetter: false },
        { label: "SLG", key: "projSlg", fmt: rate3, lowerBetter: false },
        { label: "OPS", key: "projOps", fmt: rate3, lowerBetter: false },
        { label: "wOBA", key: "projWoba", fmt: rate3, lowerBetter: false },
      ],
    },
  ],
  pitcher: [
    {
      label: "Season",
      cols: [
        { label: "IP", key: "seasonIp", fmt: dec1, lowerBetter: false },
        { label: "ERA", key: "seasonEra", fmt: dec2, lowerBetter: true },
        { label: "WHIP", key: "seasonWhip", fmt: dec2, lowerBetter: true },
        { label: "K/9", key: "seasonK9", fmt: dec1, lowerBetter: false },
        { label: "BB/9", key: "seasonBb9", fmt: dec1, lowerBetter: true },
        { label: "SV", key: "seasonSv", fmt: int, lowerBetter: false },
      ],
    },
    {
      label: "Savant",
      cols: [
        { label: "xERA", key: "xera", fmt: dec2, lowerBetter: true },
        { label: "xBA", key: "xba", fmt: rate3, lowerBetter: true },
        rvCol(),
      ],
    },
    {
      label: "Savant %ile",
      cols: [
        pctlCol("Whiff", "whiffPctl", "Whiff rate"),
        pctlCol("FBv", "fbVeloPctl", "Fastball velocity"),
      ],
    },
    {
      label: "FanGraphs",
      cols: [
        { label: "FIP", key: "fip", fmt: dec2, lowerBetter: true },
        { label: "xFIP", key: "xfip", fmt: dec2, lowerBetter: true },
        { label: "SIERA", key: "siera", fmt: dec2, lowerBetter: true },
        { label: "K%", key: "kPct", fmt: pct1, lowerBetter: false },
        { label: "BB%", key: "bbPct", fmt: pct1, lowerBetter: true },
        { label: "K-BB%", key: "kbbPct", fmt: pct1, lowerBetter: false },
      ],
    },
    {
      label: "Projections (RoS)",
      cols: [
        { label: "IP", key: "projIp", fmt: dec1, lowerBetter: false },
        { label: "GS", key: "projGs", fmt: int, lowerBetter: false },
        { label: "ERA", key: "projEra", fmt: dec2, lowerBetter: true },
        { label: "WHIP", key: "projWhip", fmt: dec2, lowerBetter: true },
        { label: "SV", key: "projSv", fmt: int, lowerBetter: false },
      ],
    },
  ],
};

function cell(stats: FreeAgentStats | undefined, col: StatCol): string {
  const v = stats?.[col.key];
  return typeof v === "number" && Number.isFinite(v) ? col.fmt(v) : "–";
}

/** One selectable stat for the Free Agents filter dropdown (union across kinds). */
export interface StatCatalogEntry {
  key: StatKey;
  label: string;
  group: string;
}

/** Every distinct stat column across both kinds (deduped by key), for the filter UI. */
export const STAT_CATALOG: StatCatalogEntry[] = (() => {
  const seen = new Set<string>();
  const out: StatCatalogEntry[] = [];
  // Lead with the value columns so they're filterable too.
  for (const c of [CBS_PTS, ESPN_SEASON, ESPN_PACE, ESPN_REM]) {
    seen.add(c.key);
    out.push({ key: c.key, label: c.label, group: c === CBS_PTS ? "Pts ROS" : "Player Rater" });
  }
  for (const kind of ["hitter", "pitcher"] as PlayerKind[]) {
    for (const g of GROUPS[kind]) {
      for (const c of g.cols) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        out.push({ key: c.key, label: c.label, group: g.label });
      }
    }
  }
  return out;
})();

export type StatFilterOp = ">" | ">=" | "<" | "<=" | "=";
export interface StatFilter {
  key: StatKey;
  op: StatFilterOp;
  value: number;
}

/** Parse a comparison expression like "> 3.5", "<.300", ">= 20", "=0". Null if invalid. */
export function parseStatExpr(text: string): { op: StatFilterOp; value: number } | null {
  const m = text.trim().match(/^(>=|<=|=|>|<)\s*(-?(?:\d+\.?\d*|\.\d+))$/);
  if (!m) return null;
  return { op: m[1] as StatFilterOp, value: Number(m[2]) };
}

function passesFilter(v: number | undefined, f: StatFilter): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  switch (f.op) {
    case ">":
      return v > f.value;
    case ">=":
      return v >= f.value;
    case "<":
      return v < f.value;
    case "<=":
      return v <= f.value;
    case "=":
      return v === f.value;
  }
}

/** Per-source player-page links shown as small icons by the name. */
export interface SourceLinks {
  fantasypros?: string;
  fangraphs?: string;
  savant?: string;
}

/** Build the per-source links from a player's ids/urls. */
export function sourceLinks(opts: {
  mlbamId?: string;
  fgPlayerId?: string;
  fantasyProsUrl?: string;
}): SourceLinks {
  return {
    fantasypros: opts.fantasyProsUrl,
    fangraphs: opts.fgPlayerId
      ? `https://www.fangraphs.com/statss.aspx?playerid=${opts.fgPlayerId}`
      : undefined,
    savant: opts.mlbamId ? `https://baseballsavant.mlb.com/savant-player/${opts.mlbamId}` : undefined,
  };
}

/** Best-effort FantasyPros player-page URL from a name (Teams rosters have no parsed href). */
export function fantasyProsUrlFromName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `https://www.fantasypros.com/mlb/players/${slug}.php`;
}

/** One table row. `lead` is the leading-column display; `leadSort` orders it. */
export interface StatRow {
  id: string;
  lead: string;
  leadSort: number;
  name: string;
  /** Display string for the Pos column (e.g. "2B/3B/SS"). */
  position: string;
  /** Eligible positions for filtering (when the position filter is enabled). */
  positions?: string[];
  proTeam: string;
  stats?: FreeAgentStats;
  /** When set, the name links here (opens new tab). */
  nameHref?: string;
  /** When set, shows a small IL marker by the name with this tooltip text. */
  injury?: string;
  /** Per-source player-page links rendered as small icons by the name. */
  links?: SourceLinks;
  /** League free-agent availability — renders league logos in the FA column. */
  freeAgent?: PlayerAvailability;
  /** Watchlist id (== stats-index id / MLBAM id). Enables the ★ add-to-watchlist toggle. */
  watchId?: string;
}

const LINK_META: { key: keyof SourceLinks; label: string; title: string }[] = [
  { key: "fantasypros", label: "FP", title: "FantasyPros player page" },
  { key: "fangraphs", label: "FG", title: "FanGraphs player page" },
  { key: "savant", label: "SV", title: "Baseball Savant player page" },
];

type SortKey = "lead" | StatKey;

// The "OF" position chip is an umbrella: it selects any outfield eligibility
// (FantasyPros splits the outfield into LF/CF/RF; some sources use a generic OF).
const OF_GROUP = ["LF", "CF", "RF", "OF"];

export default function StatsTable({
  title,
  kind,
  leadingLabel,
  rows,
  onRemove,
  showFreeAgentCol,
  enablePositionFilter,
  onToggleWatch,
  watchedIds,
  statFilters,
  collapsible,
  valueCols = ["cbs", "espn"],
}: {
  title: string;
  kind: PlayerKind;
  leadingLabel: string;
  rows: StatRow[];
  /** When set, the leading column shows a ✕ remove button (Watchlist). */
  onRemove?: (id: string) => void;
  /** When true, renders an "FA" column (ESPN/CBS logos) between Player and Pos. */
  showFreeAgentCol?: boolean;
  /** When true, renders position-filter chips that narrow rows by eligibility. */
  enablePositionFilter?: boolean;
  /** When set, renders a ★ toggle by each name (add/remove that row's watchId to the watchlist). */
  onToggleWatch?: (watchId: string) => void;
  /** Watchlist ids currently tracked — drives the ★ filled/outline state. */
  watchedIds?: Set<string>;
  /** Additive (AND) stat filters; those whose key isn't a column here are ignored. */
  statFilters?: StatFilter[];
  /** When true, the title becomes a toggle that rolls the whole table up/down. */
  collapsible?: boolean;
  /** Which league ROS-value columns to show as the leading group (CBS pts / ESPN rater). */
  valueCols?: ValueCol[];
}) {
  const valueKey = valueCols.join(",");
  const groups = useMemo(() => {
    return [...valueGroups(valueCols), ...GROUPS[kind]];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, valueKey]);
  const [collapsed, setCollapsed] = useState(false);
  // Keys that are actual columns for this kind — a filter on any other key is ignored here.
  const colKeys = useMemo(
    () => new Set(groups.flatMap((g) => g.cols.map((c) => c.key))),
    [groups]
  );
  // Leading (non-stat) columns: lead, Player, [FA], Pos, Tm.
  const leadColSpan = 4 + (showFreeAgentCol ? 1 : 0);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "lead",
    dir: "asc",
  });
  const [posFilter, setPosFilter] = useState<string | null>(null);

  // The set of positions available to filter by (union of all rows' eligibility).
  const filterPositions = useMemo(() => {
    if (!enablePositionFilter) return [];
    const set = new Set<string>();
    for (const r of rows) for (const p of r.positions ?? []) set.add(p);
    // Offer an umbrella "OF" chip whenever any outfield eligibility is present.
    if (OF_GROUP.some((p) => set.has(p))) set.add("OF");
    return sortPositions([...set]);
  }, [rows, enablePositionFilter]);

  // Apply the position filter + additive stat filters (rows lacking a value fail).
  const visibleRows = useMemo(() => {
    let rs = rows;
    if (enablePositionFilter && posFilter) {
      rs =
        posFilter === "OF"
          ? rs.filter((r) => r.positions?.some((p) => OF_GROUP.includes(p)))
          : rs.filter((r) => r.positions?.includes(posFilter));
    }
    const active = (statFilters ?? []).filter((f) => colKeys.has(f.key));
    if (active.length) rs = rs.filter((r) => active.every((f) => passesFilter(r.stats?.[f.key], f)));
    return rs;
  }, [rows, posFilter, enablePositionFilter, statFilters, colKeys]);

  const sorted = useMemo(() => {
    const out = [...visibleRows];
    if (sort.key === "lead") {
      out.sort((a, b) => (sort.dir === "asc" ? a.leadSort - b.leadSort : b.leadSort - a.leadSort));
      return out;
    }
    const key = sort.key;
    out.sort((a, b) => {
      const va = a.stats?.[key];
      const vb = b.stats?.[key];
      const aOk = typeof va === "number" && Number.isFinite(va);
      const bOk = typeof vb === "number" && Number.isFinite(vb);
      if (!aOk && !bOk) return a.leadSort - b.leadSort;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return sort.dir === "asc" ? va - vb : vb - va;
    });
    return out;
  }, [visibleRows, sort]);

  // Heat-map: for each stat column, the sorted finite values across the rows
  // currently shown. A cell's color comes from where its value ranks among these
  // (best = green → worst = red), so it adapts to filtering as well as the set.
  const colVals = useMemo(() => {
    const m = new Map<StatKey, number[]>();
    for (const g of groups)
      for (const c of g.cols) {
        const vals: number[] = [];
        for (const r of visibleRows) {
          const v = r.stats?.[c.key];
          if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
        }
        vals.sort((a, b) => a - b);
        m.set(c.key, vals);
      }
    return m;
  }, [visibleRows, groups]);

  function heatBg(c: StatCol, value: unknown): string | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const vals = colVals.get(c.key);
    if (!vals || vals.length < 2 || vals[0] === vals[vals.length - 1]) return undefined;
    let below = 0;
    let equal = 0;
    for (const v of vals) {
      if (v < value) below++;
      else if (v === value) equal++;
    }
    // Mid-rank position 0..1 (0 = lowest value), then flip for lower-is-better.
    const pos = (below + (equal - 1) / 2) / (vals.length - 1);
    const good = c.lowerBetter ? 1 - pos : pos;
    const hue = Math.round(good * 130); // 0 = red (bad) → 130 = green (good)
    return `hsla(${hue}, 65%, 45%, 0.22)`;
  }

  function onSort(key: SortKey, lowerBetter: boolean) {
    setSort((cur) => {
      if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
      return { key, dir: key === "lead" ? "asc" : lowerBetter ? "asc" : "desc" };
    });
  }

  const caret = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const num = "px-2 py-1 text-right tabular-nums whitespace-nowrap";
  const tints = ["bg-transparent", "bg-zinc-800/20", "bg-zinc-800/40"];
  const groupTint = (gi: number) => tints[gi % tints.length];
  // Vertical divider before each stat group (and between the player-info columns
  // and the first group) so sections read as distinct blocks.
  const groupEdge = "border-l border-zinc-600";

  const chip = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
      active
        ? "bg-zinc-200 text-zinc-900"
        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
    }`;

  const count =
    visibleRows.length !== rows.length ? `${visibleRows.length}/${rows.length}` : `${rows.length}`;

  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {collapsible ? (
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-zinc-200"
          >
            <span className="text-[10px]">{collapsed ? "▸" : "▾"}</span>
            {title}
            <span className="ml-1.5 font-normal text-zinc-600">{count}</span>
          </button>
        ) : (
          <>
            {title}
            <span className="ml-1.5 font-normal text-zinc-600">{count}</span>
          </>
        )}
      </h4>
      {!collapsed && enablePositionFilter && filterPositions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <button className={chip(!posFilter)} onClick={() => setPosFilter(null)}>
            All
          </button>
          {filterPositions.map((p) => (
            <button key={p} className={chip(posFilter === p)} onClick={() => setPosFilter(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      {!collapsed && (
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full border-collapse text-xs">
          <thead className="select-none text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-left" colSpan={leadColSpan} />
              {groups.map((g, gi) => (
                <th
                  key={g.label}
                  colSpan={g.cols.length}
                  className={`px-2 py-1 text-center font-semibold uppercase tracking-wide text-zinc-500 ${groupEdge} ${groupTint(gi)}`}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-zinc-800 text-zinc-500">
              {onRemove ? (
                <th className="px-2 py-1" />
              ) : (
                <th
                  className="cursor-pointer px-2 py-1 text-right font-medium hover:text-zinc-300"
                  onClick={() => onSort("lead", false)}
                >
                  {leadingLabel}
                  {caret("lead")}
                </th>
              )}
              <th className="px-2 py-1 text-left font-medium">Player</th>
              {showFreeAgentCol && <th className="px-2 py-1 text-center font-medium">FA</th>}
              <th className="px-2 py-1 text-left font-medium">Pos</th>
              <th className="px-2 py-1 text-left font-medium">Tm</th>
              {groups.map((g, gi) =>
                g.cols.map((c, ci) => (
                  <th
                    key={c.label}
                    className={`cursor-pointer px-2 py-1 text-right font-medium hover:text-zinc-300 ${groupTint(gi)} ${
                      ci === 0 ? groupEdge : ""
                    } ${sort.key === c.key ? "text-zinc-200" : ""}`}
                    onClick={() => onSort(c.key, c.lowerBetter)}
                    title={`Sort by ${c.label}`}
                  >
                    {c.label}
                    {caret(c.key)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/50 last:border-0">
                {onRemove ? (
                  <td className="px-2 py-1 text-center">
                    <button
                      onClick={() => onRemove(r.id)}
                      title="Remove from watchlist"
                      className="text-zinc-500 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </td>
                ) : (
                  <td className="px-2 py-1 text-right font-mono text-zinc-500 tabular-nums">{r.lead}</td>
                )}
                <td className="px-2 py-1 font-medium text-zinc-100 whitespace-nowrap">
                  {r.nameHref ? (
                    <a
                      href={r.nameHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-400 hover:underline"
                      title="Open this league's add/drop page"
                    >
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )}
                  {r.injury && (
                    <span
                      className="ml-1 rounded bg-red-500/15 px-1 text-[9px] font-semibold uppercase text-red-400"
                      title={r.injury}
                    >
                      IL
                    </span>
                  )}
                  {r.links && (
                    <span className="ml-1.5 inline-flex gap-1 align-middle">
                      {LINK_META.map(({ key, label, title }) => {
                        const href = r.links?.[key];
                        return href ? (
                          <a
                            key={key}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={title}
                            className="rounded bg-zinc-800 px-1 text-[9px] font-semibold text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
                          >
                            {label}
                          </a>
                        ) : null;
                      })}
                    </span>
                  )}
                  {onToggleWatch && r.watchId && (
                    <button
                      onClick={() => onToggleWatch(r.watchId!)}
                      title={
                        watchedIds?.has(r.watchId) ? "Remove from watchlist" : "Add to watchlist"
                      }
                      className={`ml-1.5 align-middle text-sm leading-none ${
                        watchedIds?.has(r.watchId)
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-zinc-600 hover:text-amber-400"
                      }`}
                    >
                      {watchedIds?.has(r.watchId) ? "★" : "☆"}
                    </button>
                  )}
                </td>
                {showFreeAgentCol && (
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 align-middle">
                      {r.freeAgent?.espn !== undefined && (
                        <a
                          href={r.freeAgent.espn}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Free agent in ESPN — open add/drop"
                          className="opacity-90 hover:opacity-100"
                        >
                          <EspnLogo />
                        </a>
                      )}
                      {r.freeAgent?.cbs !== undefined && (
                        <a
                          href={r.freeAgent.cbs}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Free agent in CBS — open player page"
                          className="opacity-90 hover:opacity-100"
                        >
                          <CbsLogo />
                        </a>
                      )}
                    </span>
                  </td>
                )}
                <td className="px-2 py-1 text-zinc-400 whitespace-nowrap">{r.position}</td>
                <td className="px-2 py-1 text-zinc-400 whitespace-nowrap">{r.proTeam}</td>
                {groups.map((g, gi) =>
                  g.cols.map((c, ci) => {
                    const bg = heatBg(c, r.stats?.[c.key]);
                    return (
                      <td
                        key={c.label}
                        className={`${num} ${bg ? "" : groupTint(gi)} ${ci === 0 ? groupEdge : ""} text-zinc-200`}
                        style={bg ? { backgroundColor: bg } : undefined}
                        title={c.tooltip?.(r.stats ?? {})}
                      >
                        {cell(r.stats, c)}
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
