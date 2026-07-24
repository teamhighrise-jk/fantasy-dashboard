"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AvailabilityResponse,
  PlayerAvailability,
  PlayersResponse,
  PlayerStatsEntry,
} from "@/lib/types";
import StatsTable, {
  type StatRow,
  sourceLinks,
  fantasyProsUrlFromName,
} from "@/components/StatsTable";
import { useWatchlist } from "@/lib/useWatchlist";
import { useProjSystem, resolveProjection } from "@/lib/useProjSystem";
import ProjSystemSelect from "@/components/ProjSystemSelect";

export default function WatchlistPage() {
  const [players, setPlayers] = useState<PlayerStatsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { ids, add: addId, remove } = useWatchlist();
  const { system: projSystem, setSystem: setProjSystem } = useProjSystem();
  const [availability, setAvailability] = useState<Record<string, PlayerAvailability>>({});
  const [positionsById, setPositionsById] = useState<Record<string, string[]>>({});
  const [injuryById, setInjuryById] = useState<Record<string, string>>({});

  // Load the searchable player universe (cached server-side).
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/players", { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        setPlayers(((await res.json()) as PlayersResponse).players);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Free-agent availability per league (best-effort; failure just hides the FA column data).
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/availability", { cache: "no-store" });
        if (res.ok) {
          const a = (await res.json()) as AvailabilityResponse;
          setAvailability(a.byId);
          setPositionsById(a.positionsById ?? {});
          setInjuryById(a.injuryById ?? {});
        }
      } catch {
        /* ignore — FA column stays empty */
      }
    })();
  }, []);

  // Watchlist ids come from the shared useWatchlist hook (localStorage-backed),
  // so additions made on the Free Agents page show up here too.
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const add = (id: string) => {
    addId(id);
    setQuery("");
  };

  // Typeahead suggestions: name match, not already added, best matches first.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const have = new Set(ids);
    return players
      .filter((p) => !have.has(p.id) && p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [query, players, ids]);

  const watch = ids.map((id) => byId.get(id)).filter(Boolean) as PlayerStatsEntry[];
  const toRows = (list: PlayerStatsEntry[]): StatRow[] =>
    list.map((p, i) => ({
      id: p.id,
      lead: "",
      leadSort: i,
      name: p.name,
      // Full eligibility joined from league data; fall back to the single OOPSY position.
      position: positionsById[p.id]?.length ? positionsById[p.id].join("/") : p.position,
      positions: positionsById[p.id]?.length ? positionsById[p.id] : p.position ? [p.position] : [],
      proTeam: p.team,
      stats: resolveProjection(p.stats, projSystem),
      injury: injuryById[p.id],
      links: sourceLinks({
        mlbamId: p.mlbamId,
        fgPlayerId: p.fgPlayerId,
        fantasyProsUrl: fantasyProsUrlFromName(p.name),
      }),
      freeAgent: availability[p.id],
    }));
  const hitters = toRows(watch.filter((p) => p.kind === "hitter"));
  const pitchers = toRows(watch.filter((p) => p.kind === "pitcher"));

  return (
    <main className="px-3 py-6 sm:px-4 sm:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Watchlist</h1>
          <p className="text-xs text-zinc-500">
            Search any player and track them with the same advanced stats
            {watch.length > 0 ? ` · ${watch.length} tracked` : ""}
          </p>
        </div>
        <ProjSystemSelect value={projSystem} onChange={setProjSystem} />
      </header>

      {/* Search + typeahead */}
      <div className="relative mb-6 max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={loading ? "Loading players…" : "Search for a player to add…"}
          disabled={loading || !!error}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(p.id);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-800"
                >
                  <span className="truncate font-medium text-zinc-100">{p.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {p.position || (p.kind === "pitcher" ? "P" : "H")}
                    {p.team ? ` · ${p.team}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Could not load players: {error}
        </div>
      )}

      {!loading && !error && watch.length === 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center text-sm text-zinc-400">
          Your watchlist is empty. Search for a player above to start tracking them.
        </div>
      )}

      {watch.length > 0 && (
        <div className="space-y-4">
          {hitters.length > 0 && (
            <StatsTable
              title="Hitters"
              kind="hitter"
              leadingLabel=""
              rows={hitters}
              onRemove={remove}
              showFreeAgentCol
            />
          )}
          {pitchers.length > 0 && (
            <StatsTable
              title="Pitchers"
              kind="pitcher"
              leadingLabel=""
              rows={pitchers}
              onRemove={remove}
              showFreeAgentCol
            />
          )}
        </div>
      )}
    </main>
  );
}
