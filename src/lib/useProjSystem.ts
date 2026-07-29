"use client";

import { useCallback, useEffect, useState } from "react";
import type { FreeAgentStats, ProjSystem } from "@/lib/types";

const LS_KEY = "fantasy-dashboard:proj-system";
const VALID: ProjSystem[] = ["blend", "oopsy", "thebat", "dc"];

/** Display labels + order for the projection-system toggle. */
export const PROJ_LABELS: Record<ProjSystem, string> = {
  blend: "Blend",
  oopsy: "OOPSY",
  thebat: "THE BAT",
  dc: "Depth Charts",
};
export const PROJ_ORDER: ProjSystem[] = ["blend", "oopsy", "thebat", "dc"];

/**
 * Which rest-of-season projection system feeds the "Projections (RoS)" columns.
 * Persisted in localStorage so the choice sticks and is consistent across tabs.
 */
export function useProjSystem() {
  const [system, setSystemState] = useState<ProjSystem>("blend");
  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      if (v && VALID.includes(v as ProjSystem)) setSystemState(v as ProjSystem);
    } catch {
      /* ignore */
    }
  }, []);
  const setSystem = useCallback((s: ProjSystem) => {
    setSystemState(s);
    try {
      localStorage.setItem(LS_KEY, s);
    } catch {
      /* ignore */
    }
  }, []);
  return { system, setSystem };
}

/**
 * Resolve the chosen projection system's values into the flat `proj*` fields the
 * shared StatsTable renders. Returns stats unchanged if that system has no data
 * for the player (so the projection cells simply show blank).
 */
export function resolveProjection(
  stats: FreeAgentStats | undefined,
  system: ProjSystem
): FreeAgentStats | undefined {
  if (!stats) return stats;
  const p = stats.projBySystem?.[system];
  if (!p) return stats;
  return {
    ...stats,
    projPtsCbs: p.ptsCbs,
    projRaterEspn: p.raterEspn,
    projRaterEspnRem: p.raterEspnRem,
    projPa: p.pa,
    projR: p.r,
    projHr: p.hr,
    projRbi: p.rbi,
    projSb: p.sb,
    projAvg: p.avg,
    projObp: p.obp,
    projSlg: p.slg,
    projOps: p.ops,
    projWoba: p.woba,
    projIp: p.ip,
    projGs: p.gs,
    projEra: p.era,
    projWhip: p.whip,
    projSv: p.sv,
  };
}
