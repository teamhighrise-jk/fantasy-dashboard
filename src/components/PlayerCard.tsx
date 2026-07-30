"use client";

import type { FreeAgentStats, PlayerKind } from "@/lib/types";
import { cell, type StatGroup, type StatKey, type StatRow } from "./StatsTable";

/**
 * Rich player card shown on name-hover (and pop-out-able to its own window). Shows
 * the player's headshot, a three-lens visual (rest-of-season projection vs. actual
 * season-to-date vs. Statcast expected), and the full stat set from the table.
 */

/** MLB headshot; the `d_...generic` default serves a silhouette for unknown ids. */
function headshotUrl(mlbamId?: string): string | undefined {
  return mlbamId
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_180,q_auto:best/v1/people/${mlbamId}/headshot/67/current`
    : undefined;
}

const fmtRate = (v: number) => v.toFixed(3).replace(/^(-?)0\./, "$1.");
const fmtDec2 = (v: number) => v.toFixed(2);

interface Metric {
  label: string;
  season: StatKey;
  proj: StatKey;
  /** Statcast "expected" counterpart, if one exists. */
  sc?: StatKey;
  /** Bar scale max for this metric. */
  max: number;
}

// The three-lens comparison metrics (only rate stats that exist across lenses).
const HITTER_METRICS: Metric[] = [
  { label: "AVG", season: "seasonAvg", proj: "projAvg", sc: "xba", max: 0.4 },
  { label: "OBP", season: "seasonObp", proj: "projObp", max: 0.45 },
  { label: "SLG", season: "seasonSlg", proj: "projSlg", sc: "xslg", max: 0.7 },
  { label: "wOBA", season: "seasonWoba", proj: "projWoba", sc: "xwoba", max: 0.45 },
];
const PITCHER_METRICS: Metric[] = [
  { label: "ERA", season: "seasonEra", proj: "projEra", sc: "xera", max: 6 },
  { label: "WHIP", season: "seasonWhip", proj: "projWhip", max: 1.6 },
];

const LENS = [
  { name: "Szn", color: "#a1a1aa", label: "Season-to-date (actual)" },
  { name: "RoS", color: "#38bdf8", label: "Rest-of-season projection" },
  { name: "xStat", color: "#fbbf24", label: "Statcast expected" },
] as const;

type LensKey = "season" | "proj" | "sc";
const LENS_FIELD: LensKey[] = ["season", "proj", "sc"];

function metricsFor(kind: PlayerKind): { metrics: Metric[]; fmt: (v: number) => string } {
  return kind === "pitcher"
    ? { metrics: PITCHER_METRICS, fmt: fmtDec2 }
    : { metrics: HITTER_METRICS, fmt: fmtRate };
}

function num(stats: FreeAgentStats | undefined, key: StatKey | undefined): number | undefined {
  if (!stats || !key) return undefined;
  const v = stats[key] as unknown;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** The three-lens comparison chart (grouped mini-bars per metric). */
function ComparisonViz({ stats, kind }: { stats: FreeAgentStats | undefined; kind: PlayerKind }) {
  const { metrics, fmt } = metricsFor(kind);
  const rows = metrics.filter(
    (m) => LENS_FIELD.filter((f) => num(stats, m[f]) !== undefined).length >= 2
  );
  if (!rows.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Projection · Actual · Statcast
        </span>
        <span className="ml-auto flex gap-2">
          {LENS.map((l) => (
            <span key={l.name} className="flex items-center gap-1" title={l.label}>
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: l.color }} />
              <span className="text-[9px] text-zinc-500">{l.name}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((m) => (
          <div key={m.label}>
            <div className="mb-0.5 text-[10px] font-medium text-zinc-300">{m.label}</div>
            <div className="space-y-0.5">
              {LENS_FIELD.map((f, i) => {
                const v = num(stats, m[f]);
                if (v === undefined) return null;
                const pct = Math.max(2, Math.min(100, (v / m.max) * 100));
                return (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="w-8 shrink-0 text-[9px] text-zinc-500">{LENS[i].name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-sm bg-zinc-800">
                      <span
                        className="block h-full rounded-sm"
                        style={{ width: `${pct}%`, background: LENS[i].color }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-zinc-200">
                      {fmt(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The full stat set, grouped like the table but laid out card-style. */
function StatGrid({ stats, groups }: { stats: FreeAgentStats | undefined; groups: StatGroup[] }) {
  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            {g.label}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1">
            {g.cols.map((c) => {
              const v = cell(stats, c);
              return (
                <div key={c.label} className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-1">
                  <div className="text-[9px] text-zinc-500">{c.label}</div>
                  <div className={`text-[11px] tabular-nums ${v === "–" ? "text-zinc-600" : "text-zinc-200"}`}>
                    {v}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Pop-out (separate window) — self-contained inline-styled HTML ────────────
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function comparisonHtml(stats: FreeAgentStats | undefined, kind: PlayerKind): string {
  const { metrics, fmt } = metricsFor(kind);
  const rows = metrics.filter(
    (m) => LENS_FIELD.filter((f) => num(stats, m[f]) !== undefined).length >= 2
  );
  if (!rows.length) return "";
  const body = rows
    .map((m) => {
      const cells = LENS_FIELD.map((f, i) => {
        const v = num(stats, m[f]);
        return `<td style="padding:2px 8px;text-align:right;color:${LENS[i].color};font-variant-numeric:tabular-nums">${
          v === undefined ? "–" : esc(fmt(v))
        }</td>`;
      }).join("");
      return `<tr><td style="padding:2px 8px;color:#d4d4d8">${esc(m.label)}</td>${cells}</tr>`;
    })
    .join("");
  const head = LENS.map(
    (l) => `<th style="padding:2px 8px;text-align:right;color:${l.color};font-size:10px">${l.name}</th>`
  ).join("");
  return `<div style="margin-bottom:14px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#a1a1aa;margin-bottom:4px">Projection · Actual · Statcast</div>
    <table style="border-collapse:collapse;font-size:12px"><tr><th></th>${head}</tr>${body}</table></div>`;
}

/** Build a self-contained HTML document for the pop-out window. */
export function playerCardHtml(row: StatRow, kind: PlayerKind, groups: StatGroup[]): string {
  const photo = headshotUrl(row.mlbamId);
  const grid = groups
    .map(
      (g) => `<div style="margin-bottom:12px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-bottom:4px">${esc(g.label)}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px">
          ${g.cols
            .map((c) => {
              const v = cell(row.stats, c);
              return `<div style="background:#18181b;border:1px solid #27272a;border-radius:4px;padding:3px 6px">
                <div style="font-size:9px;color:#71717a">${esc(c.label)}</div>
                <div style="font-size:12px;color:${v === "–" ? "#52525b" : "#e4e4e7"};font-variant-numeric:tabular-nums">${esc(v)}</div>
              </div>`;
            })
            .join("")}
        </div>
      </div>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(
    row.name
  )} — Player Card</title>
    <style>body{margin:0;background:#09090b;color:#e4e4e7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;padding:16px}</style>
    </head><body>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
      ${photo ? `<img src="${photo}" alt="" width="90" height="90" style="border-radius:8px;background:#18181b;object-fit:cover"/>` : ""}
      <div>
        <div style="font-size:20px;font-weight:700;color:#fafafa">${esc(row.name)}</div>
        <div style="font-size:12px;color:#a1a1aa">${esc(row.position || "")}${row.proTeam ? ` · ${esc(row.proTeam)}` : ""}</div>
      </div>
    </div>
    ${comparisonHtml(row.stats, kind)}
    ${grid}
    </body></html>`;
}

export default function PlayerCard({
  row,
  kind,
  groups,
}: {
  row: StatRow;
  kind: PlayerKind;
  groups: StatGroup[];
}) {
  const photo = headshotUrl(row.mlbamId);
  const popOut = () => {
    const w = window.open("", "_blank", "width=440,height=680");
    if (w) {
      w.document.write(playerCardHtml(row, kind, groups));
      w.document.close();
    }
  };
  return (
    <div className="w-[340px] max-w-[92vw] rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-2xl shadow-black/60">
      <div className="mb-3 flex items-start gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            width={72}
            height={72}
            className="h-[72px] w-[72px] shrink-0 rounded-lg bg-zinc-900 object-cover"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-2xl text-zinc-700">
            ⚾
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-zinc-50">{row.name}</div>
          <div className="text-xs text-zinc-400">
            {row.position}
            {row.proTeam ? ` · ${row.proTeam}` : ""}
          </div>
          {row.injury && <div className="mt-0.5 text-[10px] text-red-400">{row.injury}</div>}
        </div>
        <button
          onClick={popOut}
          title="Open in a separate window"
          className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
        >
          ⧉ Pop out
        </button>
      </div>
      <ComparisonViz stats={row.stats} kind={kind} />
      <StatGrid stats={row.stats} groups={groups} />
    </div>
  );
}
