/**
 * First-run setup support: read the current config presence (for the /setup page)
 * and persist user-entered credentials into `.env.local` (server-side, local only).
 *
 * This is a LOCAL app — credentials are written to the user's own `.env.local`
 * (gitignored) and set live on `process.env` so they take effect immediately
 * (getEspnConfig/getCbsConfig read process.env per request). Nothing leaves the
 * machine. Only an allowlisted set of keys can be written (no arbitrary env
 * injection), and values are stripped of newlines so they can't break the file.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCbsConfig, getEspnConfig, getFantasyProsConfig } from "./config";

/** Non-secret config (safe to echo back to the form to prefill). */
export const NONSECRET_KEYS = [
  "FANTASY_SEASON",
  "ESPN_LEAGUE_ID",
  "ESPN_TEAM_ID",
  "CBS_LEAGUE_HOST",
  "CBS_TEAM_ID",
] as const;

/** Secret config (presence reported, value never echoed back). */
export const SECRET_KEYS = [
  "ESPN_S2",
  "ESPN_SWID",
  "CBS_ACCESS_TOKEN",
  "FANTASYPROS_COOKIE",
  "FANTASYPROS_ESPN_KEY",
  "FANTASYPROS_CBS_KEY",
] as const;

export const ALL_KEYS: readonly string[] = [...NONSECRET_KEYS, ...SECRET_KEYS];

export interface ConfigStatus {
  /** Current values of the non-secret keys (to prefill the form). */
  values: Record<string, string>;
  /** Whether each key currently has a value (secrets: presence only). */
  present: Record<string, boolean>;
  /** Whether each provider is fully configured (would actually run). */
  espn: boolean;
  cbs: boolean;
  fantasypros: boolean;
  /** True if at least one league provider (ESPN or CBS) is configured. */
  anyConfigured: boolean;
}

export function getConfigStatus(): ConfigStatus {
  const present: Record<string, boolean> = {};
  for (const k of ALL_KEYS) present[k] = !!(process.env[k] && process.env[k]!.trim());
  const values: Record<string, string> = {};
  for (const k of NONSECRET_KEYS) values[k] = process.env[k] ?? "";
  return {
    values,
    present,
    espn: !!getEspnConfig(),
    cbs: !!getCbsConfig(),
    fantasypros: !!getFantasyProsConfig(),
    anyConfigured: !!(getEspnConfig() || getCbsConfig()),
  };
}

/**
 * Upsert the given key/value pairs into `.env.local` and apply them live. Only
 * allowlisted keys are honored; values are newline-stripped. A blank value for a
 * key clears it (writes `KEY=`).
 */
export async function saveConfig(fields: Record<string, unknown>): Promise<void> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALL_KEYS.includes(k)) continue; // allowlist — no arbitrary env injection
    const val = String(v ?? "").replace(/[\r\n]+/g, " ").trim();
    clean[k] = val;
    process.env[k] = val; // take effect immediately (no restart)
  }
  if (Object.keys(clean).length === 0) return;

  const file = path.join(process.cwd(), ".env.local");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    /* file may not exist yet — we'll create it */
  }
  for (const [k, v] of Object.entries(clean)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text += `${text.endsWith("\n") || text === "" ? "" : "\n"}${line}\n`;
  }
  await writeFile(file, text, "utf8");
}
