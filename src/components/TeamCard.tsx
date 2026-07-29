import type { NormalizedPlayer, NormalizedTeam, ProjSystem } from "@/lib/types";
import StatsTable, { type StatRow, sourceLinks, fantasyProsUrlFromName } from "./StatsTable";
import { cleanPositions } from "@/lib/teams";
import { resolveProjection } from "@/lib/useProjSystem";

const PROVIDER_STYLES: Record<string, string> = {
  espn: "bg-red-500/15 text-red-400 ring-red-500/30",
  cbs: "bg-blue-500/15 text-blue-400 ring-blue-500/30",
};

function recordText(r: NormalizedTeam["record"]): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** Roster players → table rows: leading column is the lineup slot; injuries shown as a marker. */
function toRows(players: NormalizedPlayer[], projSystem: ProjSystem): StatRow[] {
  return players.map((p, i) => {
    // Full eligibility (cleaned of ESPN combined-slot/bench artifacts); primary as fallback.
    const positions = cleanPositions(p.eligiblePositions);
    const display = positions.length ? positions.join("/") : p.position;
    return {
    id: `${p.id}-${p.slotLabel}-${i}`,
    lead: p.slotLabel || "—",
    leadSort: i, // preserve roster order by default
    name: p.name,
    position: display,
    positions,
    proTeam: p.proTeam,
    stats: resolveProjection(p.stats, projSystem),
    injury: p.injuryStatus
      ? `${p.injuryStatus}${p.expectedReturn ? ` · ${p.expectedReturn}` : ""}`
      : undefined,
    links: sourceLinks({
      mlbamId: p.mlbamId,
      fgPlayerId: p.fgPlayerId,
      fantasyProsUrl: fantasyProsUrlFromName(p.name),
    }),
    };
  });
}

export default function TeamCard({ team, projSystem }: { team: NormalizedTeam; projSystem: ProjSystem }) {
  const badge = PROVIDER_STYLES[team.provider] ?? "bg-zinc-700 text-zinc-300 ring-zinc-600";
  const hitters = team.roster.filter((p) => p.kind !== "pitcher");
  const pitchers = team.roster.filter((p) => p.kind === "pitcher");
  return (
    <section className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ${badge}`}
            >
              {team.providerLabel}
            </span>
            <span className="truncate text-xs text-zinc-500">{team.leagueName}</span>
          </div>
          <h2 className="truncate text-lg font-bold text-zinc-50">{team.teamName}</h2>
          {team.note && (
            <p className="mt-1 text-[11px] leading-snug text-amber-500/80">{team.note}</p>
          )}
        </div>
        {/* Record/rank/points come from the provider API; hide them in degraded (note) mode. */}
        {!team.note && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-base font-semibold text-zinc-100">
              {recordText(team.record)}
            </div>
            {team.rank != null && <div className="text-xs text-zinc-500">Rank #{team.rank}</div>}
            {team.pointsFor != null && (
              <div className="text-xs text-zinc-500">{team.pointsFor.toFixed(1)} pts</div>
            )}
          </div>
        )}
      </header>
      <div className="space-y-4">
        {hitters.length > 0 && (
          <StatsTable
            title="Hitters"
            kind="hitter"
            leadingLabel="Slot"
            rows={toRows(hitters, projSystem)}
            valueCols={[team.provider]}
          />
        )}
        {pitchers.length > 0 && (
          <StatsTable
            title="Pitchers"
            kind="pitcher"
            leadingLabel="Slot"
            rows={toRows(pitchers, projSystem)}
            valueCols={[team.provider]}
          />
        )}
      </div>
    </section>
  );
}
