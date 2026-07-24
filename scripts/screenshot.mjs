// Dev helper: screenshot the running dashboard for visual verification.
// Usage: node scripts/screenshot.mjs [url] [outPath]
// Waits for the client-side /api/teams fetch to settle before capturing.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3000";
const out = process.argv[3] ?? "/tmp/dash.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1500 }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
// Belt-and-suspenders: wait for a team card (or the empty/error state) to render.
await page.waitForSelector("section, [class*='border-amber'], [class*='border-red']", { timeout: 10000 }).catch(() => {});
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`screenshot saved: ${out}`);
