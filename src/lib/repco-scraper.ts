// Repco Web Scraper Service — state is always VIC (Victoria).
import type { Browser, Page } from "puppeteer-core";
import { isVercelServerlessRuntime, launchPuppeteerBrowser } from "./puppeteer-launch.js";

const IS_VERCEL_SERVERLESS = isVercelServerlessRuntime();

/** Repco AU; lookups are always for Victoria registration plates. */
const REPCO_STATE = "VIC" as const;
const REPCO_HOME = "https://www.repco.com.au/";
const VEHICLE_SELECTOR_BTN = ".header-vehicle-selector.js-header-vehicle-selector-link";
const REGO_STATE_ROOT = "#rego-state";
const REGO_INPUT = "#rego-number";

const OPEN_PANEL_TIMEOUT_MS = IS_VERCEL_SERVERLESS ? 25000 : 12000;
const STATE_CLICK_TIMEOUT_MS = IS_VERCEL_SERVERLESS ? 25000 : 12000;
const REGO_INPUT_TIMEOUT_MS = IS_VERCEL_SERVERLESS ? 20000 : 10000;
const REPCO_RESULT_MARKER_MS = IS_VERCEL_SERVERLESS
  ? 15000
  : Math.max(4000, parseInt(process.env.REPCO_RESULT_WAIT_MS ?? "7000", 10) || 7000);

interface RepcoData {
  [key: string]: string | undefined;
}

const globalRepcoBrowser = globalThis as unknown as {
  repcoBrowser: Browser | null;
  repcoPage: Page | null;
  repcoWarmupInProgress: Promise<void> | null;
};

if (!globalRepcoBrowser.repcoBrowser) {
  globalRepcoBrowser.repcoBrowser = null;
  globalRepcoBrowser.repcoPage = null;
  globalRepcoBrowser.repcoWarmupInProgress = null;
}

/**
 * Opens the header vehicle selector and selects Victoria (always VIC).
 * Tries radios, data-state, labels, and list items — not only `#rego-state label`.
 */
async function openVehicleSelectorAndSelectVictoria(page: Page): Promise<void> {
  await page.waitForSelector(VEHICLE_SELECTOR_BTN, { visible: true, timeout: OPEN_PANEL_TIMEOUT_MS });
  await new Promise((r) => setTimeout(r, 120));
  await page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (el) (el as HTMLElement).scrollIntoView({ block: "center", inline: "nearest" });
  }, VEHICLE_SELECTOR_BTN);
  await page.click(VEHICLE_SELECTOR_BTN);

  // Wait for state UI (container may appear before <label> nodes attach).
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#rego-state");
      if (!root) return false;
      const style = window.getComputedStyle(root);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return (
        root.querySelector("label") !== null ||
        root.querySelector("input[type='radio']") !== null ||
        root.querySelector("select") !== null ||
        root.querySelector("[data-state]") !== null ||
        /vic/i.test(root.textContent || "")
      );
    },
    { timeout: STATE_CLICK_TIMEOUT_MS }
  );
  await new Promise((r) => setTimeout(r, 80));

  // Keep this callback flat (no nested `function` / helpers). tsx/esbuild can inject
  // `__name()` for nested functions; that helper does not exist inside the browser VM.
  const clicked = (await page.evaluate((state: string) => {
    const root = document.querySelector("#rego-state");
    if (!root) return { ok: 0, reason: "no #rego-state" };

    const st = state;
    const stLower = state.toLowerCase();

    const radio = root.querySelector(
      'input[type="radio"][value="' +
        st +
        '"], input[type="radio"][value="' +
        stLower +
        '"]'
    );
    if (radio) {
      radio.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
      (radio as HTMLElement).click();
      return { ok: 1, via: "radio value" };
    }

    const byData = root.querySelector(
      '[data-state="' +
        st +
        '"], [data-state="' +
        stLower +
        '"], [data-code="' +
        st +
        '"]'
    );
    if (byData) {
      byData.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
      (byData as HTMLElement).click();
      return { ok: 1, via: "data-state" };
    }

    const sel = root.querySelector("select");
    if (sel && "options" in sel) {
      const selectEl = sel as HTMLSelectElement;
      const opts = Array.prototype.slice.call(selectEl.options) as HTMLOptionElement[];
      for (let i = 0; i < opts.length; i++) {
        const o = opts[i];
        const ov = o.value;
        const ot = o.text || "";
        if (ov === st || ov === stLower || /vic/i.test(ot)) {
          selectEl.value = o.value;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: 1, via: "select" };
        }
      }
    }

    const labels = root.querySelectorAll("label");
    for (let i = 0; i < labels.length; i++) {
      const lab = labels[i];
      const t = (lab.textContent && lab.textContent.trim()) || "";
      if (t === st || t.indexOf(st) !== -1 || /victoria/i.test(t)) {
        lab.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
        );
        (lab as HTMLElement).click();
        return { ok: 1, via: "label" };
      }
    }

    const candidates = root.querySelectorAll(
      "li, button, span[role='button'], a, div[role='button']"
    );
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i];
      const t = (node.textContent && node.textContent.trim()) || "";
      if (t === st || (t.length <= 6 && t.indexOf("VIC") !== -1) || /^vic$/i.test(t)) {
        node.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
        );
        (node as HTMLElement).click();
        return { ok: 1, via: "list/text" };
      }
    }

    return { ok: 0, reason: "no VIC control found inside #rego-state" };
  }, REPCO_STATE)) as { ok: number; via?: string; reason?: string };

  if (clicked.ok !== 1) {
    throw new Error(`Could not select ${REPCO_STATE}: ${clicked.reason ?? "unknown"}`);
  }

  await page.waitForSelector(REGO_INPUT, { visible: true, timeout: REGO_INPUT_TIMEOUT_MS });
}

async function attachRepcoPage(page: Page): Promise<void> {
  // Repco is a heavy SPA; request interception often breaks hydrated dropdowns — do not intercept here.
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(window, "chrome", {
      get: () => ({ runtime: {} }),
      configurable: true,
    });
  });

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  });
}

export async function warmupRepcoBrowser(): Promise<void> {
  if (globalRepcoBrowser.repcoWarmupInProgress) {
    console.log("⏳ Repco warmup already in progress, waiting...");
    await globalRepcoBrowser.repcoWarmupInProgress;
    return;
  }

  if (globalRepcoBrowser.repcoBrowser && globalRepcoBrowser.repcoPage) {
    try {
      if (!globalRepcoBrowser.repcoBrowser.connected) {
        console.log("⚠️ Repco browser was closed, will create new instance");
        globalRepcoBrowser.repcoBrowser = null;
        globalRepcoBrowser.repcoPage = null;
      } else {
        const page = globalRepcoBrowser.repcoPage;
        const regoReady = await page.evaluate((regoSelector: string) => {
          const input = document.querySelector(regoSelector) as HTMLInputElement | null;
          return Boolean(input && input.offsetParent !== null);
        }, REGO_INPUT);
        if (regoReady) {
          console.log("⚡ Repco browser already warmed up and ready (VIC)!");
          return;
        }
        console.log("⚠️ Repco page present but rego field not ready — re-running VIC flow");
      }
    } catch (error) {
      console.log(
        "⚠️ Error checking Repco browser state, will create new instance:",
        error instanceof Error ? error.message : "Unknown"
      );
      globalRepcoBrowser.repcoBrowser = null;
      globalRepcoBrowser.repcoPage = null;
    }
  }

  console.log("🚀 Warming up Repco browser (state=VIC)...");

  const warmupPromise = (async () => {
    globalRepcoBrowser.repcoBrowser = await launchPuppeteerBrowser();
    globalRepcoBrowser.repcoPage = await globalRepcoBrowser.repcoBrowser.newPage();
    const page = globalRepcoBrowser.repcoPage;

    await attachRepcoPage(page);

    console.log("🌐 Navigating to Repco homepage...");
    await page.goto(REPCO_HOME, {
      waitUntil: IS_VERCEL_SERVERLESS ? "load" : "domcontentloaded",
      timeout: IS_VERCEL_SERVERLESS ? 45000 : 30000,
    });

    console.log("📂 Opening vehicle selector and selecting VIC...");
    await openVehicleSelectorAndSelectVictoria(page);
    console.log("✅ Repco warmup: VIC selected, #rego-number ready");
  })();

  globalRepcoBrowser.repcoWarmupInProgress = warmupPromise;

  try {
    await warmupPromise;
  } catch (error) {
    console.error("❌ Repco warmup error:", error);
    globalRepcoBrowser.repcoBrowser = null;
    globalRepcoBrowser.repcoPage = null;
  } finally {
    globalRepcoBrowser.repcoWarmupInProgress = null;
  }
}

export async function closeRepcoBrowser(): Promise<void> {
  if (globalRepcoBrowser.repcoBrowser) {
    try {
      console.log("🔒 Closing persistent Repco browser...");
      if (globalRepcoBrowser.repcoBrowser.connected) {
        await globalRepcoBrowser.repcoBrowser.close();
      }
      console.log("✅ Repco browser closed");
    } catch (error) {
      console.log(
        "⚠️ Error closing Repco browser:",
        error instanceof Error ? error.message : "Unknown"
      );
    } finally {
      globalRepcoBrowser.repcoBrowser = null;
      globalRepcoBrowser.repcoPage = null;
      globalRepcoBrowser.repcoWarmupInProgress = null;
    }
  }
}

async function ensureRepcoVicAndRegoInput(page: Page): Promise<void> {
  const isReady = await page.evaluate((regoSelector: string) => {
    const input = document.querySelector(regoSelector) as HTMLInputElement | null;
    return Boolean(input && input.offsetParent !== null);
  }, REGO_INPUT);

  if (isReady) {
    const vicLikely = await page.evaluate((stateRootSelector: string) => {
      const root = document.querySelector(stateRootSelector);
      if (!root) return true;
      const active = root.querySelector(
        'input[type="radio"]:checked, option:checked, [aria-selected="true"]'
      );
      const activeEl = active as HTMLElement | null;
      const t =
        (activeEl && activeEl.textContent) ||
        (root.textContent || "");
      return /vic/i.test(t) || t.indexOf("Victoria") !== -1;
    }, REGO_STATE_ROOT);
    if (vicLikely) {
      console.log("✅ Repco form ready (VIC)");
      return;
    }
  }

  console.log("🔄 Repco form not ready — reloading home and selecting VIC...");
  await page.goto(REPCO_HOME, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  await openVehicleSelectorAndSelectVictoria(page);
  console.log("✅ Repco re-init: VIC + rego input");
}

export async function scrapeRepcoData(registrationNumber: string): Promise<RepcoData> {
  if (globalRepcoBrowser.repcoWarmupInProgress) {
    console.log("⏳ Waiting for Repco browser warmup to complete...");
    await globalRepcoBrowser.repcoWarmupInProgress;
  }

  if (!globalRepcoBrowser.repcoBrowser || !globalRepcoBrowser.repcoPage) {
    console.log("⚠️ Repco browser not ready, warming up now...");
    await warmupRepcoBrowser();
  }

  if (!globalRepcoBrowser.repcoPage || !globalRepcoBrowser.repcoBrowser?.connected) {
    throw new Error(
      "Repco browser is not available (warmup failed). Registration lookup on the parts site cannot run until the browser starts."
    );
  }

  const page = globalRepcoBrowser.repcoPage;
  console.log(`🔍 Starting Repco lookup for: ${registrationNumber} (state=${REPCO_STATE})`);

  try {
    await ensureRepcoVicAndRegoInput(page);

    const searchResult = await page.evaluate((reg: string) => {
      const input = document.querySelector("#rego-number") as HTMLInputElement;
      const button = document.querySelector("#rego-search-button") as HTMLButtonElement;

      if (input && button) {
        input.value = reg;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        button.click();
        return true;
      }
      return false;
    }, registrationNumber.toUpperCase());

    if (!searchResult) {
      throw new Error("Could not find Repco registration input or search button");
    }

    console.log("📝 registration submitted to Repco, waiting for vehicle data...");

    console.log("⏳ Waiting for vehicle result to appear...");
    try {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector("#btn-9381");
          const bodyText = document.body.innerText;
          return (
            btn ||
            bodyText.includes("We found your vehicle") ||
            bodyText.includes("Select your vehicle") ||
            bodyText.includes("Engine:") ||
            bodyText.includes("Year:") ||
            document.querySelector(".vehicle-name") ||
            document.querySelector(".search-results-item")
          );
        },
        { timeout: REPCO_RESULT_MARKER_MS }
      );
      console.log("🎯 Result detected on page!");
    } catch {
      console.log("⚠️ Timeout waiting for result markers.");
    }

    const resultText = await page.evaluate(() => {
      const specificBtn = document.querySelector("#btn-9381");
      if (specificBtn && specificBtn.textContent?.trim()) {
        return { source: "ID #btn-9381", text: specificBtn.textContent.trim() };
      }

      const allText = document.body.innerText;
      const findIndex = allText.indexOf("We found your vehicle");
      if (findIndex !== -1) {
        const afterText = allText.substring(findIndex + 21, findIndex + 300).trim();
        const lines = afterText
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        if (lines.length > 0) {
          return { source: "Text Matching", text: lines[0] };
        }
      }

      const descriptionElement = document.querySelector(
        ".vehicle-description, .search-results-item__title, .js-vehicle-name"
      );
      if (descriptionElement) {
        return { source: "Class-based", text: descriptionElement.textContent?.trim() };
      }

      return null;
    });

    console.log("------------------------------------------");
    console.log("🚗 REPCO SEARCH RESULT:");
    if (resultText) {
      console.log(`📢 SOURCE: ${resultText.source}`);
      console.log(`📢 VEHICLE: ${resultText.text}`);
    } else {
      console.log("❌ NO VEHICLE DESCRIPTION FOUND");
    }
    console.log("------------------------------------------");

    return {
      registrationNumber: registrationNumber.toUpperCase(),
      vehicleInfo: resultText?.text || "No info found",
      status: resultText ? "Success" : "Failed",
      state: REPCO_STATE,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Repco scraping error: ${errorMsg}`);
    return {
      registrationNumber: registrationNumber.toUpperCase(),
      error: errorMsg,
      status: "Failed",
      state: REPCO_STATE,
    };
  }
}
