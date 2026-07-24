import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const pexec = promisify(execFile);

const SESSION_FILE = () => path.join(process.cwd(), ".cbs-session.json");

/**
 * Refresh the CBS API access token by driving a headless CBS login (Playwright)
 * to scrape the league's `CBSi.token`. The Playwright work runs in a spawned
 * Node script (scripts/refresh-cbs-token.mjs) so the heavy browser dep is never
 * bundled into the Next server.
 *
 * On success the new token is applied two ways:
 *  - in-memory: `process.env.CBS_ACCESS_TOKEN` (getCbsConfig reads it live, so it
 *    takes effect for the next request with NO server restart), and
 *  - persisted: rewritten into `.env.local` so it survives a restart.
 *
 * Requires CBS_USERNAME + CBS_PASSWORD in .env.local. Throws with a readable
 * message on any failure (missing creds, login failure, token not found).
 */
export async function refreshCbsAccessToken(): Promise<{ tokenPreview: string }> {
  // A saved login session OR credentials is enough — the script tries session first.
  if (!existsSync(SESSION_FILE()) && !(process.env.CBS_USERNAME && process.env.CBS_PASSWORD)) {
    throw new Error(
      "No saved CBS session and no CBS_USERNAME/CBS_PASSWORD. Run `npm run cbs-login` (or click “Set up CBS login”) to save a session."
    );
  }

  const script = path.join(process.cwd(), "scripts", "refresh-cbs-token.mjs");
  let stdout: string;
  try {
    ({ stdout } = await pexec("node", [script], {
      env: process.env, // carries CBS_LEAGUE_HOST / CBS_USERNAME / CBS_PASSWORD
      timeout: 120_000,
      maxBuffer: 1 << 20,
    }));
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = (err.stderr?.toString().trim() || err.message || "login script failed").trim();
    throw new Error(detail);
  }

  let token: string | undefined;
  try {
    token = (JSON.parse(stdout.trim()) as { token?: string }).token;
  } catch {
    throw new Error("Could not parse the refresh result.");
  }
  if (!token) throw new Error("No token was returned by the login.");

  // Apply live (no restart) + persist.
  process.env.CBS_ACCESS_TOKEN = token;
  await persistToken(token);

  return { tokenPreview: `${token.slice(0, 12)}…` };
}

/** Rewrite (or append) the CBS_ACCESS_TOKEN line in .env.local. */
async function persistToken(token: string): Promise<void> {
  const file = path.join(process.cwd(), ".env.local");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    /* file may not exist yet */
  }
  if (/^CBS_ACCESS_TOKEN=.*$/m.test(text)) {
    text = text.replace(/^CBS_ACCESS_TOKEN=.*$/m, `CBS_ACCESS_TOKEN=${token}`);
  } else {
    text += `${text.endsWith("\n") || text === "" ? "" : "\n"}CBS_ACCESS_TOKEN=${token}\n`;
  }
  await writeFile(file, text, "utf8");
}

/**
 * One-time CBS login to capture a reusable session: spawns the HEADED
 * scripts/cbs-login.mjs so the user can solve the login reCAPTCHA in a real
 * browser window; on success the session is saved to .cbs-session.json and
 * future token refreshes reuse it (no login needed). Resolves when saved.
 */
export async function startCbsLoginSession(): Promise<{ ok: true }> {
  const script = path.join(process.cwd(), "scripts", "cbs-login.mjs");
  try {
    await pexec("node", [script], {
      env: process.env,
      timeout: 330_000, // give the user ~5 min to log in + solve the CAPTCHA
      maxBuffer: 1 << 20,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = (err.stderr?.toString().trim() || err.message || "login setup failed").trim();
    throw new Error(detail);
  }
  if (!existsSync(SESSION_FILE())) throw new Error("Login window closed before a session was saved.");
  return { ok: true };
}
