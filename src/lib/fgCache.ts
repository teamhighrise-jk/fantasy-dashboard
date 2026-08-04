/**
 * Last-good FanGraphs data cache.
 *
 * FanGraphs occasionally Cloudflare-blocks our automated requests (e.g. under
 * trade-deadline traffic), which would otherwise blank every FG-derived stat —
 * season leaderboards, the FIP/xFIP group, and the rest-of-season projections
 * (and, downstream, the ESPN Pace/Rem + CBS points computed from them).
 *
 * To degrade gracefully, each healthy build persists its FG maps to a local,
 * gitignored file; when a fetch fails/empties we fall back to the last-good copy
 * so the dashboard shows "last-known" numbers instead of blanks. Public stat data
 * only — no secrets. Serialized as { key: { savedAt, entries: [id, record][] } }.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Bundle = Record<string, { savedAt: string; entries: [string, unknown][] }>;

const FILE = () => path.join(process.cwd(), ".fg-cache.local.json");

// In-process copy so we don't re-read the (possibly large) file every build.
let mem: Bundle | null = null;

async function load(): Promise<Bundle> {
  if (mem) return mem;
  try {
    mem = JSON.parse(await readFile(FILE(), "utf8")) as Bundle;
  } catch {
    mem = {};
  }
  return mem;
}

export interface LastGood<T> {
  map: Map<string, T>;
  savedAt: string;
}

/** Load the last-good map for a key, or null if none persisted. */
export async function loadLastGood<T>(key: string): Promise<LastGood<T> | null> {
  const b = await load();
  const e = b[key];
  if (!e?.entries?.length) return null;
  return { map: new Map(e.entries as [string, T][]), savedAt: e.savedAt };
}

/** Persist the given healthy maps as the new last-good (best-effort). */
export async function saveLastGood(
  updates: Record<string, ReadonlyMap<string, unknown>>
): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  const b = await load();
  const savedAt = new Date().toISOString();
  for (const [k, m] of Object.entries(updates)) b[k] = { savedAt, entries: [...m.entries()] };
  mem = b;
  try {
    await writeFile(FILE(), JSON.stringify(b), "utf8");
  } catch (e) {
    console.warn("[fgCache] write failed:", e instanceof Error ? e.message : e);
  }
}
