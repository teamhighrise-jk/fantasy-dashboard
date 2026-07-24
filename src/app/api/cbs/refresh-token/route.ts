import { NextResponse } from "next/server";
import { refreshCbsAccessToken } from "@/lib/cbs/refreshToken";

// Spawns Playwright (Node-only) and writes .env.local — must run on the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cbs/refresh-token
 * Headlessly logs into CBS, scrapes a fresh access token, and applies it (live +
 * .env.local). Returns { ok, tokenPreview } on success, { ok:false, error } else.
 */
export async function POST() {
  try {
    const { tokenPreview } = await refreshCbsAccessToken();
    return NextResponse.json({ ok: true, tokenPreview, refreshedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
