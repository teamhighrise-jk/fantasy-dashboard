/**
 * @deprecated NOT USED as of 2026-06-10. The Teams dashboard now renders rosters
 * as Hitters/Pitchers advanced-stats tables via `StatsTable` (see `TeamCard`),
 * mirroring the Free Agents page. This compact slot-grouped roster view (with the
 * two-line injury display) is kept for reference / possible future "lineup view"
 * toggle, but nothing imports it. Don't add features here without rewiring.
 */
import type { NormalizedPlayer, PlayerSlotKind } from "@/lib/types";

const GROUPS: { kind: PlayerSlotKind; label: string }[] = [
  { kind: "starter", label: "Starters" },
  { kind: "bench", label: "Bench" },
  { kind: "injured", label: "Injured" },
];

/**
 * Compact a provider's free-text return note for inline display, e.g.
 * "Expected to be out until at least Jun 16" -> "Out until ~Jun 16".
 * Falls back to the raw string for phrasings we don't recognize.
 */
function formatReturn(raw: string): string {
  const m = raw.match(/until\s+(?:at least\s+)?(.+)$/i);
  if (!m) return raw;
  return /at least/i.test(raw) ? `Out until ~${m[1]}` : `Out until ${m[1]}`;
}

function PlayerRow({ player }: { player: NormalizedPlayer }) {
  const hasInjuryInfo = player.injuryStatus || player.expectedReturn;
  return (
    <li className="py-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 font-mono text-xs text-zinc-500">
          {player.slotLabel}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
          {player.name}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {player.position}
          {player.proTeam ? ` · ${player.proTeam}` : ""}
        </span>
      </div>
      {/* Injury detail on its own line so a long CBS news headline (the status)
          and the return estimate have room and never collide with the row above. */}
      {hasInjuryInfo && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-14">
          {player.expectedReturn && (
            <span className="shrink-0 text-[11px] font-medium text-red-300/90">
              {formatReturn(player.expectedReturn)}
            </span>
          )}
          {player.injuryStatus && (
            <span className="min-w-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-tight text-red-400">
              {player.injuryStatus}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export default function RosterTable({ roster }: { roster: NormalizedPlayer[] }) {
  return (
    <div className="space-y-3">
      {GROUPS.map(({ kind, label }) => {
        const players = roster.filter((p) => p.slot === kind);
        if (players.length === 0) return null;
        return (
          <div key={kind}>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {label}
              <span className="ml-1.5 font-normal text-zinc-600">{players.length}</span>
            </h4>
            <ul className="divide-y divide-zinc-800/60">
              {players.map((p) => (
                <PlayerRow key={`${p.id}-${p.slotLabel}`} player={p} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
