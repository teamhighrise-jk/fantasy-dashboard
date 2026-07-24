"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/** localStorage key for the personal watchlist (array of PlayerStatsEntry.id). */
export const WATCHLIST_LS_KEY = "fantasy-dashboard:watchlist";

/**
 * Shared client-side watchlist state, persisted in localStorage so the Watchlist
 * and Free Agents pages stay in sync (each reads the same key on mount; writes
 * go straight to localStorage). Ids are PlayerStatsEntry.id (== MLBAM id when
 * known) so they line up with what the Watchlist tab renders from the stats index.
 */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(WATCHLIST_LS_KEY);
      if (saved) setIds(JSON.parse(saved) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev : persist([...prev, id]))),
    []
  );
  const remove = useCallback(
    (id: string) => setIds((prev) => persist(prev.filter((x) => x !== id))),
    []
  );
  const toggle = useCallback(
    (id: string) =>
      setIds((prev) => persist(prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    []
  );

  const watched = useMemo(() => new Set(ids), [ids]);
  return { ids, watched, add, remove, toggle };
}

/** Write to localStorage inside a setState updater and return the same value. */
function persist(next: string[]): string[] {
  try {
    localStorage.setItem(WATCHLIST_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
