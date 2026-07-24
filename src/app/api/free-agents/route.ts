import { NextResponse } from "next/server";
import { getFreeAgents } from "@/lib/freeAgents";
import type { FreeAgentsResponse } from "@/lib/types";

// Always run on the server at request time — secrets and live fetches.
export const dynamic = "force-dynamic";

/**
 * GET /api/free-agents
 * Returns the top available hitters and pitchers per league with advanced stats.
 * Result is cached server-side (see getFreeAgents); `?fresh=1` bypasses the cache.
 */
export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get("fresh") === "1";
  const data = await getFreeAgents({ force });
  return NextResponse.json<FreeAgentsResponse>(data);
}
