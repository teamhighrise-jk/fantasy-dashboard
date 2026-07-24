// Scrape the CBS league's `CBSi.token` (the API access token). Spawned by
// /api/cbs/refresh-token. Prints {"token":"…","via":"session|login"} on success.
//
// Strategy:
//   1. If a saved login session exists (.cbs-session.json, created by
//      `npm run cbs-login`), reuse those cookies headlessly — no login, no
//      CAPTCHA. This is the reliable path now that CBS gates login with reCAPTCHA.
//   2. Otherwise fall back to a headless email+password login (kept as a first
//      attempt; usually blocked by the CAPTCHA, but harmless to try).
//
// Env in: CBS_LEAGUE_HOST, CBS_USERNAME, CBS_PASSWORD (login fallback only).
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Load .env.local for any vars not already in the environment (so this also works
// when run directly, not just when spawned by the route with process.env).
try {
  for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — rely on the passed environment */
}

const host = process.env.CBS_LEAGUE_HOST;
const user = process.env.CBS_USERNAME;
const pass = process.env.CBS_PASSWORD;
const SESSION_FILE = path.join(process.cwd(), ".cbs-session.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function fail(code, msg) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}
if (!host) fail(2, "CBS_LEAGUE_HOST not set");
const leagueUrl = `https://${host}.baseball.cbssports.com/`;

/** Read CBSi.token from the current (authenticated) page — live global, then HTML fallback. */
async function readToken(page) {
  if (!/baseball\.cbssports\.com/.test(page.url())) {
    await page.goto(leagueUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  let token = await page.evaluate(() => (window.CBSi && window.CBSi.token) || null).catch(() => null);
  if (!token) {
    const html = await page.content();
    token =
      (html.match(/CBSi\.token\s*=\s*['"]([^'"]+)['"]/) ||
        html.match(/"token"\s*:\s*"(U2Fsd[^"]+)"/) ||
        [])[1] || null;
  }
  return token;
}

const browser = await chromium.launch();
try {
  // 1) Saved session (cookies) — preferred.
  if (existsSync(SESSION_FILE)) {
    const ctx = await browser.newContext({ userAgent: UA, storageState: SESSION_FILE });
    const page = await ctx.newPage();
    await page.goto(leagueUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const token = await readToken(page);
    if (token) {
      process.stdout.write(JSON.stringify({ token, via: "session" }));
      process.exit(0);
    }
    await ctx.close(); // session expired/invalid → fall through to login
  }

  // 2) Headless email+password login (first attempt; may be CAPTCHA-blocked).
  if (!user || !pass) {
    fail(
      4,
      "No saved CBS session and no CBS_USERNAME/CBS_PASSWORD. Run `npm run cbs-login` to set one up."
    );
  }
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  // networkidle + a pause so React hydrates before we interact (else the form
  // does a raw submit that never authenticates).
  await page.goto(leagueUrl, { waitUntil: "networkidle", timeout: 40000 });
  await page.locator('[data-testid="submit-button"]').first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(3000);

  await page.locator('input#name, input[name="email"]').first().fill(user);
  const pwd = page.locator('input[type="password"]').first();
  if (!(await pwd.isVisible().catch(() => false))) {
    await page.locator('[data-testid="submit-button"]').first().click();
    await pwd.waitFor({ state: "visible", timeout: 12000 });
  }
  await pwd.fill(pass);
  await Promise.all([
    page.waitForURL((u) => u.host.endsWith("baseball.cbssports.com"), { timeout: 30000 }).catch(() => {}),
    page.locator('[data-testid="submit-button"]').first().click(),
  ]);

  const token = await readToken(page);
  if (!token) {
    fail(
      3,
      "Headless login didn't authenticate (CBS shows a reCAPTCHA). Run `npm run cbs-login` once to save a login session, then retry."
    );
  }
  process.stdout.write(JSON.stringify({ token, via: "login" }));
} catch (e) {
  fail(1, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}
