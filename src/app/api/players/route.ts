import { NextResponse } from "next/server";
import { getStatsIndex } from "@/lib/stats";
import type { PlayersResponse } from "@/lib/types";

// Always run on the server at request time — live (cached) stat fetches.
export const dynamic = "force-dynamic";

/**
 * GET /api/players
 * The full searchable player universe (everyone our stat sources cover) with
 * their advanced stats — powers the Watchlist tab's typeahead + tables. Backed
 * by the shared, cached stats index.
 */
export async function GET() {
  let players: PlayersResponse["players"] = [];
  let fg: PlayersResponse["fg"];
  try {
    const index = await getStatsIndex();
    players = index.all;
    fg = index.fg;
  } catch {
    players = [];
  }
  return NextResponse.json<PlayersResponse>({
    players,
    fetchedAt: new Date().toISOString(),
    fg,
  });
}
