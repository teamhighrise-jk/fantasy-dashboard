"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FreeAgentsResponse } from "@/lib/types";
import FreeAgentStatsTable from "@/components/FreeAgentStatsTable";
import FreeAgentFilters, { type FilterRow } from "@/components/FreeAgentFilters";
import { STAT_CATALOG, parseStatExpr, type StatFilter } from "@/components/StatsTable";
import ProjSystemSelect from "@/components/ProjSystemSelect";
import { useWatchlist } from "@/lib/useWatchlist";
import { useProjSystem } from "@/lib/useProjSystem";

const PROVIDER_BADGE: Record<string, string> = {
  espn: "bg-red-500/15 text-red-400 ring-red-500/30",
  cbs: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
};

export default function FreeAgentsPage() {
  const [data, setData] = useState<FreeAgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { watched, toggle } = useWatchlist();
  const { system: projSystem, setSystem: setProjSystem } = useProjSystem();

  // Filter sidebar collapse (default collapsed, "show only as needed"; persisted).
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("fantasy-dashboard:fa-filters-open");
      if (v != null) setFiltersOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, []);
  const toggleFilters = useCallback(() => {
    setFiltersOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("fantasy-dashboard:fa-filters-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Stat filter builder (client-side, additive/AND). Raw rows → parsed active filters.
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const nextFilterId = useRef(1);
  const addFilter = useCallback(
    () =>
      setFilterRows((rs) => [
        ...rs,
        { id: String(nextFilterId.current++), key: STAT_CATALOG[0].key, expr: "" },
      ]),
    []
  );
  const updateFilter = useCallback(
    (id: string, patch: Partial<FilterRow>) =>
      setFilterRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    []
  );
  const removeFilter = useCallback(
    (id: string) => setFilterRows((rs) => rs.filter((r) => r.id !== id)),
    []
  );
  const clearFilters = useCallback(() => setFilterRows([]), []);

  const activeFilters = useMemo<StatFilter[]>(
    () =>
      filterRows.flatMap((r) => {
        const parsed = parseStatExpr(r.expr);
        return parsed ? [{ key: r.key, op: parsed.op, value: parsed.value }] : [];
      }),
    [filterRows]
  );

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/free-agents${force ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setData((await res.json()) as FreeAgentsResponse);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providerErrors = data ? Object.entries(data.errors) : [];
  const noLeagues = data && data.leagues.length === 0 && providerErrors.length === 0;

  return (
    <main className="px-3 py-6 sm:px-4 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Free Agents</h1>
          <p className="text-xs text-zinc-500">
            Top 100 available hitters &amp; pitchers per league, by rest-of-season rank
            {data?.fetchedAt
              ? ` · updated ${new Date(data.fetchedAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProjSystemSelect value={projSystem} onChange={setProjSystem} />
          <button
            onClick={() => void load(true)}
            disabled={loading}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Could not load: {fetchError}
        </div>
      )}

      {providerErrors.map(([provider, message]) => (
        <div
          key={provider}
          className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
        >
          <span className="font-semibold uppercase">{provider}:</span> {message}
        </div>
      ))}

      {noLeagues && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center text-sm text-zinc-400">
          No leagues configured. Add your ESPN/CBS credentials in{" "}
          <code className="text-zinc-200">.env.local</code> and refresh.
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-sm text-zinc-500">Loading free agents…</div>
      )}

      {data && data.leagues.length > 0 && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <FreeAgentFilters
            rows={filterRows}
            activeCount={activeFilters.length}
            open={filtersOpen}
            onToggle={toggleFilters}
            onAdd={addFilter}
            onUpdate={updateFilter}
            onRemove={removeFilter}
            onClear={clearFilters}
          />
          <div className="min-w-0 flex-1 space-y-4">
            {data.leagues.map((lg) => {
              const badge = PROVIDER_BADGE[lg.provider] ?? "bg-zinc-700 text-zinc-300 ring-zinc-600";
              return (
                <section
                  key={`${lg.provider}-${lg.leagueName}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5"
                >
                  <header className="mb-4 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${badge}`}
                    >
                      {lg.providerLabel}
                    </span>
                    {lg.leagueName && (
                      <span className="truncate text-xs text-zinc-500">{lg.leagueName}</span>
                    )}
                    {lg.rankingNote && (
                      <span className="ml-auto truncate text-[11px] italic text-zinc-600">
                        {lg.rankingNote}
                      </span>
                    )}
                  </header>
                  <div className="space-y-4">
                    <FreeAgentStatsTable
                      title="Top Hitters"
                      kind="hitter"
                      players={lg.hitters}
                      addDropUrl={lg.addDropUrl}
                      onToggleWatch={toggle}
                      watchedIds={watched}
                      statFilters={activeFilters}
                      projSystem={projSystem}
                    />
                    <FreeAgentStatsTable
                      title="Top Pitchers"
                      kind="pitcher"
                      players={lg.pitchers}
                      addDropUrl={lg.addDropUrl}
                      onToggleWatch={toggle}
                      watchedIds={watched}
                      statFilters={activeFilters}
                      projSystem={projSystem}
                    />
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
