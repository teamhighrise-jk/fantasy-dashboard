import { NextResponse } from "next/server";
import { getWatchlistAvailability } from "@/lib/freeAgents";
import type { AvailabilityResponse } from "@/lib/types";

// Always run on the server at request time — live (cached) availability fetches.
export const dynamic = "force-dynamic";

/**
 * GET /api/availability
 * Per-league free-agent availability for the Watchlist, keyed by player id
 * (same ids as /api/players). Each entry carries the add/drop URL for any league
 * the player is currently available in. `?fresh=1` bypasses the cache.
 */
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.has("fresh");
  try {
    const value = await getWatchlistAvailability({ force: fresh });
    return NextResponse.json<AvailabilityResponse>(value);
  } catch {
    return NextResponse.json<AvailabilityResponse>({
      byId: {},
      positionsById: {},
      injuryById: {},
      errors: {},
      fetchedAt: new Date().toISOString(),
    });
  }
}
