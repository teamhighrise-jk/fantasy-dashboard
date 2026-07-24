import { STAT_CATALOG, type StatCatalogEntry, type StatKey, parseStatExpr } from "./StatsTable";

/** One row in the filter builder: a chosen stat + a raw comparison expression. */
export interface FilterRow {
  id: string;
  key: StatKey;
  expr: string;
}

// Catalog grouped by source, for the <select> optgroups.
const GROUPED: [string, StatCatalogEntry[]][] = (() => {
  const m = new Map<string, StatCatalogEntry[]>();
  for (const e of STAT_CATALOG) {
    const arr = m.get(e.group) ?? [];
    arr.push(e);
    m.set(e.group, arr);
  }
  return [...m.entries()];
})();

/**
 * Free Agents filter panel — build an unlimited list of additive (AND) filters,
 * each = a displayed stat + a comparison like "> 3.5" / "< .300". Rows with an
 * invalid/blank expression are inactive (flagged) until valid.
 */
export default function FreeAgentFilters({
  rows,
  activeCount,
  open,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
  onClear,
}: {
  rows: FilterRow[];
  activeCount: number;
  /** When false, the panel is collapsed to just its toggle header (minimized). */
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<FilterRow>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <aside className={`w-full shrink-0 ${open ? "lg:w-56" : "lg:w-auto"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={onToggle}
          title={open ? "Hide filters" : "Show filters"}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
        >
          <span className="text-[10px]">{open ? "▾" : "▸"}</span> Filters
          {activeCount > 0 && <span className="ml-1 font-normal text-zinc-500">{activeCount}</span>}
        </button>
        {open && rows.length > 0 && (
          <button onClick={onClear} className="text-[11px] text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
        )}
      </div>

      {open && (
      <div className="space-y-2">
        {rows.map((r) => {
          const invalid = r.expr.trim() !== "" && !parseStatExpr(r.expr);
          return (
            <div key={r.id} className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
              <select
                value={r.key}
                onChange={(e) => onUpdate(r.id, { key: e.target.value as StatKey })}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
              >
                {GROUPED.map(([group, entries]) => (
                  <optgroup key={group} label={group}>
                    {entries.map((e) => (
                      <option key={e.key} value={e.key}>
                        {e.label} · {e.group}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  value={r.expr}
                  onChange={(e) => onUpdate(r.id, { expr: e.target.value })}
                  placeholder="> 3.5"
                  className={`w-full rounded border bg-zinc-900 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
                    invalid ? "border-red-500/60" : "border-zinc-700 focus:border-zinc-500"
                  }`}
                />
                <button
                  onClick={() => onRemove(r.id)}
                  title="Remove filter"
                  className="shrink-0 px-1 text-sm text-zinc-500 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}

        <button
          onClick={onAdd}
          className="w-full rounded-lg border border-dashed border-zinc-700 px-2 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
        >
          + Add filter
        </button>
      </div>
      )}
    </aside>
  );
}
