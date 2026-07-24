"use client";

import { useCallback, useEffect, useState } from "react";
import type { TeamsResponse } from "@/lib/types";
import TeamCard from "@/components/TeamCard";
import StandingsPanel from "@/components/StandingsPanel";
import ProjSystemSelect from "@/components/ProjSystemSelect";
import { useProjSystem } from "@/lib/useProjSystem";

export default function Dashboard() {
  const [data, setData] = useState<TeamsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cbsRefreshing, setCbsRefreshing] = useState(false);
  const [cbsRefreshError, setCbsRefreshError] = useState<string | null>(null);
  // Standings sidebar is collapsed by default ("show only as needed"); the choice persists.
  const [standingsOpen, setStandingsOpen] = useState(false);
  const { system: projSystem, setSystem: setProjSystem } = useProjSystem();

  useEffect(() => {
    try {
      const v = localStorage.getItem("fantasy-dashboard:standings-open");
      if (v != null) setStandingsOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleStandings = useCallback(() => {
    setStandingsOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("fantasy-dashboard:standings-open", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/teams${force ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setData((await res.json()) as TeamsResponse);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch a CBS token (via saved session, else headless login), then reload.
  const refreshCbsToken = useCallback(async () => {
    setCbsRefreshing(true);
    setCbsRefreshError(null);
    try {
      const res = await fetch("/api/cbs/refresh-token", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `Request failed: ${res.status}`);
      await load(true); // bypass the teams cache so the fresh token's data is used
    } catch (err) {
      setCbsRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setCbsRefreshing(false);
    }
  }, [load]);

  // One-time: open a real browser to log into CBS (solve the reCAPTCHA), saving a
  // reusable session; then immediately refresh the token via that session.
  const setupCbsLogin = useCallback(async () => {
    setCbsRefreshing(true);
    setCbsRefreshError(null);
    try {
      const res = await fetch("/api/cbs/login-session", { method: "POST" });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `Request failed: ${res.status}`);
      await refreshCbsToken();
    } catch (err) {
      setCbsRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setCbsRefreshing(false);
    }
  }, [refreshCbsToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const providerErrors = data ? Object.entries(data.errors) : [];
  const noProviders = data && data.teams.length === 0 && providerErrors.length === 0;
  // CBS is "degraded" when its team loaded via the FantasyPros fallback (has a note)
  // or the provider errored outright — i.e. the access token is stale/missing.
  const cbsDegraded =
    !!data &&
    (!!data.errors.cbs || data.teams.some((t) => t.provider === "cbs" && !!t.note));

  return (
    <main className="px-3 py-6 sm:px-4 sm:py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
            Fantasy Baseball
          </h1>
          {data?.fetchedAt && (
            <p className="text-xs text-zinc-500">
              Updated {new Date(data.fetchedAt).toLocaleTimeString()}
            </p>
          )}
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

      {cbsDegraded && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <span className="flex-1 min-w-[12rem]">
            CBS token looks stale — lineup slots, record &amp; IL return dates may be missing.
            {cbsRefreshError && <span className="block text-red-300">⚠ {cbsRefreshError}</span>}
          </span>
          <button
            onClick={() => void refreshCbsToken()}
            disabled={cbsRefreshing}
            className="rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-50"
          >
            {cbsRefreshing ? "Working…" : "Refresh CBS token"}
          </button>
          <button
            onClick={() => void setupCbsLogin()}
            disabled={cbsRefreshing}
            title="Opens a browser window to log in once (solve the CAPTCHA); saves the session so refresh works."
            className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
          >
            Set up login
          </button>
        </div>
      )}

      {noProviders && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-8 text-center text-sm text-zinc-400">
          No providers configured yet. Copy{" "}
          <code className="text-zinc-200">.env.local.example</code> to{" "}
          <code className="text-zinc-200">.env.local</code>, fill in your ESPN/CBS
          details, and refresh.
        </div>
      )}

      {loading && !data && (
        <div className="py-12 text-center text-sm text-zinc-500">Loading teams…</div>
      )}

      {data && data.teams.length > 0 && (
        <div className="space-y-4">
          {data.teams.map((team) => (
            <div
              key={`${team.provider}-${team.teamId}`}
              className="flex flex-col gap-4 lg:flex-row lg:items-start"
            >
              <div className="min-w-0 flex-1">
                <TeamCard team={team} projSystem={projSystem} />
              </div>
              {team.standings && team.standings.length > 0 && (
                <StandingsPanel
                  standings={team.standings}
                  provider={team.provider}
                  open={standingsOpen}
                  onToggle={toggleStandings}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
