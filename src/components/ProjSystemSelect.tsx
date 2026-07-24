import type { ProjSystem } from "@/lib/types";
import { PROJ_LABELS, PROJ_ORDER } from "@/lib/useProjSystem";

/** Dropdown to pick which RoS projection system the "Projections (RoS)" columns show. */
export default function ProjSystemSelect({
  value,
  onChange,
}: {
  value: ProjSystem;
  onChange: (s: ProjSystem) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
      Projections
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProjSystem)}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 focus:border-zinc-500 focus:outline-none"
      >
        {PROJ_ORDER.map((s) => (
          <option key={s} value={s}>
            {PROJ_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
