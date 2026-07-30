"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Field {
  key: string;
  label: string;
  help: React.ReactNode;
  secret?: boolean;
  long?: boolean;
  placeholder?: string;
}

const ESPN_FIELDS: Field[] = [
  { key: "ESPN_LEAGUE_ID", label: "League ID", help: "The leagueId= number in your ESPN fantasy URL." },
  { key: "ESPN_TEAM_ID", label: "Team ID", help: "The teamId= in your team page URL." },
  {
    key: "ESPN_S2",
    label: "espn_s2 cookie",
    secret: true,
    long: true,
    help: "In a browser logged into ESPN: DevTools → Application → Cookies → fantasy.espn.com → copy espn_s2.",
  },
  {
    key: "ESPN_SWID",
    label: "SWID cookie",
    secret: true,
    help: "Same cookies panel — copy SWID including the surrounding { braces }.",
  },
];

const CBS_FIELDS: Field[] = [
  {
    key: "CBS_LEAGUE_HOST",
    label: "League subdomain",
    help: "For myleague.baseball.cbssports.com, enter myleague.",
  },
  { key: "CBS_TEAM_ID", label: "Team ID", help: "Your team's id within the CBS league." },
  {
    key: "CBS_ACCESS_TOKEN",
    label: "API access token",
    secret: true,
    long: true,
    help: "CBS League Office → enable API Access, or open your league page → View Source → copy the CBSi.token value.",
  },
];

const FP_FIELDS: Field[] = [
  {
    key: "FANTASYPROS_COOKIE",
    label: "FantasyPros cookie",
    secret: true,
    long: true,
    help: "Logged into fantasypros.com: DevTools → Network → any request → copy the Cookie header.",
  },
  {
    key: "FANTASYPROS_ESPN_KEY",
    label: "ESPN league key",
    secret: true,
    help: "The ?key=mlb~<uuid> from your ESPN league's FantasyPros My Playbook URL.",
  },
  {
    key: "FANTASYPROS_CBS_KEY",
    label: "CBS league key",
    secret: true,
    help: "The ?key=mlb~<uuid> from your CBS league's FantasyPros My Playbook URL.",
  },
];

const ALL_FIELDS = [...ESPN_FIELDS, ...CBS_FIELDS, ...FP_FIELDS, { key: "FANTASY_SEASON" } as Field];
const NONSECRET = new Set(ALL_FIELDS.filter((f) => !f.secret).map((f) => f.key));

interface Status {
  values: Record<string, string>;
  present: Record<string, boolean>;
  espn: boolean;
  cbs: boolean;
  fantasypros: boolean;
  anyConfigured: boolean;
}

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFp, setShowFp] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      const s = (await res.json()) as Status;
      setStatus(s);
      setForm((f) => ({ FANTASY_SEASON: s.values.FANTASY_SEASON || "", ...s.values, ...f }));
      if (s.fantasypros) setShowFp(true);
      return s;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    // Send all non-secret fields (blank clears); send secrets only when typed.
    const payload: Record<string, string> = {};
    for (const f of ALL_FIELDS) {
      const v = (form[f.key] ?? "").trim();
      if (NONSECRET.has(f.key)) payload[f.key] = v;
      else if (v) payload[f.key] = v;
    }
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch {
      // The dev server may reload on the .env.local change and drop this request;
      // re-check status before treating it as a real failure.
      await new Promise((r) => setTimeout(r, 1500));
      const s = await loadStatus();
      if (!s?.anyConfigured) {
        setError("Could not save. Check the app's terminal for errors and try again.");
        setSaving(false);
        return;
      }
    }
    const s = await loadStatus();
    setSaving(false);
    setSaved(true);
    if (s?.anyConfigured) setTimeout(() => router.push("/"), 700);
  };

  const badge = (on: boolean) =>
    on
      ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
      : "bg-zinc-700/40 text-zinc-400 ring-zinc-600/40";

  const renderField = (f: Field) => {
    const isSet = status?.present[f.key];
    const placeholder = f.secret && isSet ? "•••••••• saved — leave blank to keep" : f.placeholder;
    return (
      <div key={f.key} className="mb-3">
        <label className="mb-1 flex items-center gap-2 text-xs font-medium text-zinc-300">
          {f.label}
          {f.secret && isSet && (
            <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-semibold uppercase text-emerald-400">
              saved
            </span>
          )}
        </label>
        {f.long ? (
          <textarea
            rows={2}
            value={form[f.key] ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={placeholder}
            className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        ) : (
          <input
            type="text"
            value={form[f.key] ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={placeholder}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        )}
        <p className="mt-1 text-[11px] leading-snug text-zinc-500">{f.help}</p>
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Set up your dashboard</h1>

      {/* How it works */}
      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm leading-relaxed text-zinc-300">
        <p>
          This is a <strong>combined dashboard for your fantasy baseball teams</strong> across ESPN
          and CBS. Connect one or both leagues below and you get three tabs:
        </p>
        <ul className="mt-2 space-y-1 text-[13px] text-zinc-400">
          <li>
            <strong className="text-zinc-300">Teams</strong> — your rosters with deep stats
            (season, Statcast, FanGraphs) + rest-of-season projections and a league value column.
          </li>
          <li>
            <strong className="text-zinc-300">Free Agents</strong> — the top available players in
            each league, filterable and sortable, with the same stats.
          </li>
          <li>
            <strong className="text-zinc-300">Watchlist</strong> — track any player across leagues.
          </li>
        </ul>
        <p className="mt-2 text-[13px] text-zinc-500">
          Everything runs locally — your credentials are saved to a local file on your machine
          (<code className="text-zinc-400">.env.local</code>, gitignored) and are never sent anywhere
          else. Configure just one provider if you only play in one league.
        </p>
      </div>

      {/* ESPN */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <header className="mb-3 flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-400 ring-1 ring-red-500/30">
            ESPN
          </span>
          <h2 className="text-sm font-semibold text-zinc-200">Connect your ESPN league</h2>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${badge(!!status?.espn)}`}>
            {status?.espn ? "connected" : "not set"}
          </span>
        </header>
        {ESPN_FIELDS.map(renderField)}
      </section>

      {/* CBS */}
      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <header className="mb-3 flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-400 ring-1 ring-blue-500/30">
            CBS
          </span>
          <h2 className="text-sm font-semibold text-zinc-200">Connect your CBS league</h2>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${badge(!!status?.cbs)}`}>
            {status?.cbs ? "connected" : "not set"}
          </span>
        </header>
        {CBS_FIELDS.map(renderField)}
      </section>

      {/* FantasyPros — optional */}
      <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <header className="mb-1 flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-400 ring-1 ring-amber-500/30">
            FantasyPros
          </span>
          <h2 className="text-sm font-semibold text-zinc-200">
            Better free-agent rankings <span className="font-normal text-zinc-500">— optional</span>
          </h2>
          <button
            onClick={() => setShowFp((v) => !v)}
            className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            {showFp ? "Hide" : "Add"}
          </button>
        </header>
        <p className="text-[12px] leading-snug text-zinc-500">
          <strong className="text-zinc-400">You don&apos;t need a FantasyPros account.</strong> If you
          add one, the Free Agents page uses FantasyPros&apos; league-synced, scoring-aware
          rest-of-season rankings. Without it, Free Agents still works using each league&apos;s own
          available-player lists.
        </p>
        {showFp && <div className="mt-3">{FP_FIELDS.map(renderField)}</div>}
      </section>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save & open dashboard"}
        </button>
        {status?.anyConfigured && (
          <button
            onClick={() => router.push("/")}
            className="text-sm text-zinc-400 hover:text-zinc-200"
          >
            Skip to dashboard →
          </button>
        )}
      </div>
    </main>
  );
}
