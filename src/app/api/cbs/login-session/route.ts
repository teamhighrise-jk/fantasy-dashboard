import { NextResponse } from "next/server";
import { startCbsLoginSession } from "@/lib/cbs/refreshToken";

// Spawns a HEADED Playwright browser (Node-only) for the one-time manual login.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cbs/login-session
 * Opens a visible browser so the user can log in to CBS (solving the reCAPTCHA)
 * once; saves the session cookies (.cbs-session.json) that the token refresh
 * then reuses. Long-running (waits for the user). Local-dev only.
 */
export async function POST() {
  try {
    await startCbsLoginSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
