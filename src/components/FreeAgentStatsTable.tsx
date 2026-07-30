import type { FreeAgentPlayer, PlayerKind, ProjSystem } from "@/lib/types";
import StatsTable, { type StatRow, type StatFilter, type ValueCol, sourceLinks } from "./StatsTable";
import { resolveProjection } from "@/lib/useProjSystem";

/** Free Agents: rank-ordered stat table; player names link to the add/drop page. */
export default function FreeAgentStatsTable({
  title,
  kind,
  players,
  addDropUrl,
  onToggleWatch,
  watchedIds,
  statFilters,
  projSystem,
  valueCols,
}: {
  title: string;
  kind: PlayerKind;
  players: FreeAgentPlayer[];
  addDropUrl?: string;
  /** Which ROS-value column(s) to show — the league's own scoring. */
  valueCols?: ValueCol[];
  /** Add/remove a player to the watchlist (renders a ★ toggle by the name). */
  onToggleWatch?: (watchId: string) => void;
  /** Watchlist ids currently tracked — drives the ★ state. */
  watchedIds?: Set<string>;
  /** Additive stat filters from the Free Agents filter panel. */
  statFilters?: StatFilter[];
  /** Which RoS projection system feeds the Projections columns. */
  projSystem: ProjSystem;
}) {
  // Rank only the free agents (1..N); the user's own merged players get a blank
  // lead and sort to the end by default (they still intermix when sorting a stat).
  let faRank = 0;
  const rows: StatRow[] = players.map((p, i) => {
    const rank = p.mine ? 0 : ++faRank;
    return {
      id: `${p.id}-${i}`,
      lead: p.mine ? "" : String(rank),
      leadSort: p.mine ? 1_000_000 + i : rank,
      name: p.name,
      position: p.positions?.length ? p.positions.join("/") : p.position,
      positions: p.positions?.length ? p.positions : p.position ? [p.position] : [],
      proTeam: p.proTeam,
      stats: resolveProjection(p.stats, projSystem),
      // Per-player link (e.g. CBS player page) when set; else the league add/drop hub.
      nameHref: p.addDropUrl ?? addDropUrl,
      links: sourceLinks({
        mlbamId: p.mlbamId,
        fgPlayerId: p.fgPlayerId,
        fantasyProsUrl: p.fantasyProsUrl,
      }),
      // Only matched players (with an MLBAM id) can be watchlisted — that id is the
      // same key the Watchlist tab uses. Unmatched players get no ★.
      watchId: p.mlbamId,
      mlbamId: p.mlbamId,
      mine: p.mine,
    };
  });
  return (
    <StatsTable
      title={title}
      kind={kind}
      leadingLabel="#"
      rows={rows}
      enablePositionFilter
      collapsible
      onToggleWatch={onToggleWatch}
      watchedIds={watchedIds}
      statFilters={statFilters}
      valueCols={valueCols}
    />
  );
}
