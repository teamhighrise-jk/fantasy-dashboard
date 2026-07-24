import type { FreeAgentPlayer } from "@/lib/types";

export default function FreeAgentTable({
  title,
  players,
}: {
  title: string;
  players: FreeAgentPlayer[];
}) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
        <span className="ml-1.5 font-normal text-zinc-600">{players.length}</span>
      </h4>
      {players.length === 0 ? (
        <p className="py-2 text-sm text-zinc-600">None available.</p>
      ) : (
        <ol className="divide-y divide-zinc-800/60">
          {players.map((p, i) => (
            <li key={`${p.id}-${i}`} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-zinc-500">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
                {p.name}
              </span>
              <span className="shrink-0 text-xs text-zinc-400">
                {p.position}
                {p.proTeam ? ` · ${p.proTeam}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
