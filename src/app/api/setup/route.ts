import { NextResponse } from "next/server";
import { getConfigStatus, saveConfig } from "@/lib/setup";

// Reads/writes .env.local (Node fs) — must run on the Node runtime, never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/setup — current config presence (no secret values are returned). */
export async function GET() {
  return NextResponse.json(getConfigStatus());
}

/** POST /api/setup — persist allowlisted credentials to .env.local (local only). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    await saveConfig(body);
    return NextResponse.json({ ok: true, status: getConfigStatus() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
