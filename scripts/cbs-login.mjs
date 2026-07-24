// One-time CBS login to capture a reusable session (cookies), so the token
// refresh can scrape `CBSi.token` without logging in again — CBS gates login
// with a reCAPTCHA that headless automation can't solve, so a human solves it
// once here. Opens a VISIBLE browser; prefills your email/password; you solve
// the CAPTCHA + submit; the session is saved to .cbs-session.json.
//
// Run: `npm run cbs-login`  (re-run when the saved session expires)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on the passed environment */
}

const host = process.env.CBS_LEAGUE_HOST;
const user = process.env.CBS_USERNAME;
const pass = process.env.CBS_PASSWORD;
const SESSION_FILE = path.join(process.cwd(), ".cbs-session.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

if (!host) {
  process.stderr.write("CBS_LEAGUE_HOST not set (.env.local)\n");
  process.exit(2);
}
const leagueUrl = `https://${host}.baseball.cbssports.com/`;

// Anti-bot: use real Chrome + strip the automation flags so reCAPTCHA presents a
// normal (human-passable) checkbox instead of flagging the controlled browser.
const launchOpts = {
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", ...launchOpts }); // installed Google Chrome
} catch {
  browser = await chromium.launch(launchOpts); // fall back to bundled Chromium
}
try {
  // No custom UA here — let real Chrome present its genuine fingerprint.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(leagueUrl, { waitUntil: "networkidle", timeout: 60000 });

  // Best-effort prefill so the only manual step is the CAPTCHA + submit.
  try {
    await page.locator('[data-testid="submit-button"]').first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(2500);
    if (user) await page.locator('input#name, input[name="email"]').first().fill(user);
    const pwd = page.locator('input[type="password"]').first();
    if (pass && (await pwd.isVisible().catch(() => false))) await pwd.fill(pass);
  } catch {
    /* form may differ — the user can just type manually */
  }

  process.stderr.write(
    "\n>> A browser window opened. Finish logging in to CBS (solve the 'I'm not a robot' " +
      "check and click Continue). Waiting up to 5 minutes…\n\n"
  );

  // Success = redirected back to the LEAGUE host (only happens after real auth via
  // the xurl redirect) AND the authenticated `CBSi.token` is actually present.
  await page.waitForURL((u) => u.host.endsWith("baseball.cbssports.com"), { timeout: 300000 });
  await page.waitForTimeout(2500);
  let token = await page.evaluate(() => (window.CBSi && window.CBSi.token) || null).catch(() => null);
  if (!token) {
    await page.goto(leagueUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    token = await page.evaluate(() => (window.CBSi && window.CBSi.token) || null).catch(() => null);
  }
  if (!token) {
    process.stderr.write(">> Reached the league page but couldn't confirm login (no CBSi.token) — NOT saving.\n");
    process.exit(3);
  }
  await ctx.storageState({ path: SESSION_FILE });
  process.stderr.write(`>> Success — logged in, session saved to ${SESSION_FILE}\n`);
  process.stderr.write(">> You can close the window. The 'Refresh CBS token' button will now work.\n");
} catch (e) {
  process.stderr.write(
    "Login not detected in time (" + (e instanceof Error ? e.message : String(e)) + ").\n"
  );
  process.exit(1);
} finally {
  await browser.close();
}
