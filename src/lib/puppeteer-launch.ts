import fs from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * Friday app uses Vercel + Sparticuz; this microservice always uses system Chrome.
 * Kept for scraper compatibility (`isVercelServerlessRuntime()` → false here).
 */
export function isVercelServerlessRuntime(): boolean {
  return false;
}

const LOCAL_CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
].filter((p): p is string => Boolean(p));

function resolveLocalChromePath(): string {
  for (const p of LOCAL_CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  throw new Error(
    "Chrome/Chromium not found. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH."
  );
}

const PROTOCOL_TIMEOUT_MS = Math.max(
  60_000,
  parseInt(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS ?? "480000", 10) || 480_000
);

export async function launchPuppeteerBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: resolveLocalChromePath(),
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--disable-plugins",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=TranslateUI",
      "--disable-ipc-flooding-protection",
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
  });
}
