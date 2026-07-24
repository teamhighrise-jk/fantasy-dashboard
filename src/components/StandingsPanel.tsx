import type { LeagueStanding, NormalizedRecord, ProviderId } from "@/lib/types";

function fmtPoints(p: number): string {
  return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtRecord(r?: NormalizedRecord): string {
  if (!r) return "";
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/**
 * Minimal league-standings sidebar for the Teams tab — sits in the right margin
 * next to a team card. Sorted by points (desc). CBS adds record + division as
 * extra columns; ESPN shows team + points only. The user's row is highlighted.
 */
export default function StandingsPanel({
  standings,
  provider,
  open,
  onToggle,
}: {
  standings: LeagueStanding[];
  provider: ProviderId;
  /** When false, the panel is collapsed to just its toggle header (minimized). */
  open: boolean;
  onToggle: () => void;
}) {
  const showExtra = provider === "cbs"; // record + division
  return (
    <aside className={`w-full shrink-0 ${open ? "md:w-60 lg:w-72" : "md:w-auto"}`}>
      <button
        onClick={onToggle}
        title={open ? "Hide standings" : "Show standings"}
        className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span> Standings
      </button>
      {open && (
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full border-collapse text-xs">
          <thead className="select-none text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-2 py-1 text-left font-medium">Team</th>
              <th className="px-2 py-1 text-right font-medium">Pts</th>
              {showExtra && <th className="px-2 py-1 text-right font-medium">Rec</th>}
              {showExtra && <th className="px-2 py-1 text-left font-medium">Div</th>}
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr
                key={s.teamId}
                className={`border-b border-zinc-800/50 last:border-0 ${
                  s.isUser ? "bg-zinc-200/10 font-semibold text-zinc-100" : "text-zinc-300"
                }`}
              >
                <td className="max-w-[9rem] truncate px-2 py-1" title={s.teamName}>
                  {s.teamName}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtPoints(s.points)}</td>
                {showExtra && (
                  <td className="px-2 py-1 text-right tabular-nums text-zinc-400">
                    {fmtRecord(s.record)}
                  </td>
                )}
                {showExtra && <td className="px-2 py-1 text-zinc-500">{s.division ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </aside>
  );
}
