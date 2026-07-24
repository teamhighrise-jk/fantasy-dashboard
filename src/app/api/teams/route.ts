import { NextResponse } from "next/server";
import { getTeams } from "@/lib/providers";
import type { TeamsResponse } from "@/lib/types";

// Always run on the server at request time — secrets and live (cached) fetches.
export const dynamic = "force-dynamic";

/**
 * GET /api/teams
 * Combined, normalized teams for every configured provider. Backed by a 20-min
 * in-process cache (getTeams) so tab switches are instant; `?fresh=1` bypasses it
 * (the Refresh button, and the reload after a CBS token refresh). A failure in
 * one provider is reported per-provider, not fatal.
 */
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.has("fresh");
  const value = await getTeams({ force: fresh });
  return NextResponse.json<TeamsResponse>(value);
}
