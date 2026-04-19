// VicRoads Web Scraper Service
import type { Browser, Page } from "puppeteer-core";
import { isVercelServerlessRuntime, launchPuppeteerBrowser } from "./puppeteer-launch.js";

/** Request interception (blocking trackers/fonts) can break SPAs behind bot protection; skip on Vercel. */
const IS_VERCEL_SERVERLESS = isVercelServerlessRuntime();

interface VehicleData {
  registrationNumber: string;
  makeModel?: string;
  year?: string;
  color?: string;
  vin?: string;
  registrationExpiry?: string;
  status?: string;
  [key: string]: string | undefined;
}

const globalBrowser = globalThis as unknown as {
  cachedBrowser: Browser | null;
  cachedPage: Page | null;
  warmupInProgress: Promise<void> | null;
};

if (!globalBrowser.cachedBrowser) {
  globalBrowser.cachedBrowser = null;
  globalBrowser.cachedPage = null;
  globalBrowser.warmupInProgress = null;
}

export async function warmupBrowser(): Promise<void> {
  if (globalBrowser.warmupInProgress) {
    console.log("⏳ Warmup already in progress, waiting...");
    await globalBrowser.warmupInProgress;
    return;
  }

  if (globalBrowser.cachedBrowser && globalBrowser.cachedPage) {
    try {
      if (!globalBrowser.cachedBrowser.connected) {
        console.log("⚠️ Browser was closed, will create new instance");
        globalBrowser.cachedBrowser = null;
        globalBrowser.cachedPage = null;
      } else {
        console.log("⚡ Browser already warmed up and ready!");
        const baseUrl =
          "https://www.vicroads.vic.gov.au/registration/buy-sell-or-transfer-a-vehicle/check-vehicle-registration/vehicle-registration-enquiry";
        const currentUrl = globalBrowser.cachedPage.url();
        if (currentUrl !== baseUrl) {
          await globalBrowser.cachedPage.goto(baseUrl, {
            waitUntil: IS_VERCEL_SERVERLESS ? "load" : "domcontentloaded",
            timeout: IS_VERCEL_SERVERLESS ? 45000 : 30000,
          });
        }
        return;
      }
    } catch (error) {
      console.log(
        "⚠️ Error checking browser state, will create new instance:",
        error instanceof Error ? error.message : "Unknown"
      );
      globalBrowser.cachedBrowser = null;
      globalBrowser.cachedPage = null;
    }
  }

  console.log("🚀 Warming up browser for VicRoads scraping...");

  const warmupPromise = (async () => {
    globalBrowser.cachedBrowser = await launchPuppeteerBrowser();

    globalBrowser.cachedPage = await globalBrowser.cachedBrowser.newPage();

    if (!IS_VERCEL_SERVERLESS) {
      await globalBrowser.cachedPage.setRequestInterception(true);
      globalBrowser.cachedPage.removeAllListeners("request");
      globalBrowser.cachedPage.on("request", (req) => {
        try {
          const resourceType = req.resourceType();
          const url = req.url().toLowerCase();
          const shouldBlock =
            resourceType === "image" ||
            resourceType === "font" ||
            resourceType === "media" ||
            url.includes("google-analytics") ||
            url.includes("doubleclick") ||
            url.includes("facebook") ||
            url.includes("hotjar") ||
            url.includes("googletagmanager");
          if (shouldBlock) {
            req.abort("blockedbyclient").catch(() => {});
          } else {
            req.continue().catch(() => {});
          }
        } catch {
          /* best-effort */
        }
      });
    }

    await globalBrowser.cachedPage.setViewport({ width: 1366, height: 768 });
    await globalBrowser.cachedPage.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await globalBrowser.cachedPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(window, "chrome", {
        get: () => ({ runtime: {} }),
        configurable: true,
      });
    });

    await globalBrowser.cachedPage.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    });

    const baseUrl =
      "https://www.vicroads.vic.gov.au/registration/buy-sell-or-transfer-a-vehicle/check-vehicle-registration/vehicle-registration-enquiry";
    await globalBrowser.cachedPage.goto(baseUrl, {
      waitUntil: IS_VERCEL_SERVERLESS ? "load" : "domcontentloaded",
      timeout: IS_VERCEL_SERVERLESS ? 45000 : 30000,
    });

    console.log("✅ Browser warmed up and ready for instant search");
  })();

  globalBrowser.warmupInProgress = warmupPromise;

  try {
    await warmupPromise;
  } catch (error) {
    console.error("❌ Warmup error:", error);
    globalBrowser.cachedBrowser = null;
    globalBrowser.cachedPage = null;
  } finally {
    globalBrowser.warmupInProgress = null;
  }
}

/** True when a VicRoads tab is connected (after warmup or first scrape). */
export function isVicRoadsSessionReady(): boolean {
  try {
    return Boolean(globalBrowser.cachedBrowser?.connected && globalBrowser.cachedPage);
  } catch {
    return false;
  }
}

export async function closeBrowser(): Promise<void> {
  if (globalBrowser.cachedBrowser) {
    try {
      console.log("🔒 Closing persistent VicRoads browser...");
      if (globalBrowser.cachedBrowser.connected) {
        await globalBrowser.cachedBrowser.close();
      }
      console.log("✅ Browser closed");
    } catch (error) {
      console.log(
        "⚠️ Error closing browser:",
        error instanceof Error ? error.message : "Unknown"
      );
    } finally {
      globalBrowser.cachedBrowser = null;
      globalBrowser.cachedPage = null;
      globalBrowser.warmupInProgress = null;
    }
  }
}

export async function scrapeVicRoadsData(registrationNumber: string): Promise<VehicleData> {
  let page: Page;
  const navTimeout = IS_VERCEL_SERVERLESS
    ? 45000
    : Math.max(2500, parseInt(process.env.VICROADS_NAV_TIMEOUT_MS ?? "5500", 10) || 5500);
  const inputWaitMs = IS_VERCEL_SERVERLESS
    ? 20000
    : Math.max(1500, parseInt(process.env.VICROADS_INPUT_WAIT_MS ?? "2200", 10) || 2200);
  const resultWaitMs = IS_VERCEL_SERVERLESS
    ? 25000
    : Math.max(1500, parseInt(process.env.VICROADS_RESULT_WAIT_MS ?? "2800", 10) || 2800);
  const waitUntil = IS_VERCEL_SERVERLESS ? ("load" as const) : ("domcontentloaded" as const);

  try {
    console.log(`🚀 Starting VicRoads lookup for registration: ${registrationNumber}`);

    await warmupBrowser();

    if (globalBrowser.cachedBrowser && globalBrowser.cachedPage) {
      console.log("⚡ Using pre-warmed browser session");
      page = globalBrowser.cachedPage;
    } else {
      console.log("⚠️ No pre-warmed browser, launching new instance...");
      globalBrowser.cachedBrowser = await launchPuppeteerBrowser();
      page = await globalBrowser.cachedBrowser.newPage();

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

      globalBrowser.cachedPage = page;
    }

    const baseUrl =
      "https://www.vicroads.vic.gov.au/registration/buy-sell-or-transfer-a-vehicle/check-vehicle-registration/vehicle-registration-enquiry";
    if (page.url() !== baseUrl) {
      console.log("🌐 Navigating to VicRoads page...");
      await page.goto(baseUrl, { waitUntil, timeout: navTimeout });
    }

    const isInputReady = await page.evaluate(() => {
      const input = document.querySelector("#RegistrationNumbercar") as HTMLInputElement;
      return input && input.offsetParent !== null;
    });

    if (!isInputReady) {
      console.log("🔄 VicRoads input not ready, waiting or re-navigating...");
      await page.goto(baseUrl, { waitUntil, timeout: navTimeout });
      await page.waitForSelector("#RegistrationNumbercar", {
        visible: true,
        timeout: inputWaitMs,
      });
    }

    const result = await page.evaluate((reg: string) => {
      const input = document.querySelector("#RegistrationNumbercar") as HTMLInputElement;
      const button = document.querySelector(
        'input[type="submit"][value="Search"].mvc-form__actions-btn'
      ) as HTMLButtonElement;

      if (input && button) {
        input.value = reg;
        button.click();
        return true;
      }
      return false;
    }, registrationNumber.toUpperCase());

    if (!result) {
      throw new Error("Could not find VicRoads registration input field or search button");
    }

    console.log(`📝 Entered registration and clicked search instantly`);

    try {
      await page.waitForSelector(
        ".vhr-panel.vhr-panel--small.vhr-panel--gray, .mvc-error-summary",
        { timeout: resultWaitMs }
      );
      console.log("✅ Results or error detected");
    } catch {
      console.log("⚠️ Timeout waiting for results, trying to extract anyway...");
    }

    const vehicleData: VehicleData = {
      registrationNumber: registrationNumber.toUpperCase(),
    };

    const extractedData = await page.evaluate(() => {
      const data: Record<string, string> = {};

      const panels = document.querySelectorAll(".vhr-panel.vhr-panel--small.vhr-panel--gray");

      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        const listItems = panel.querySelectorAll(".vhr-panel__list-item-container");

        for (let j = 0; j < listItems.length; j++) {
          const container = listItems[j];
          const term = container.querySelector(".vhr-panel__list-item--term")?.textContent?.trim();
          const description = container
            .querySelector(".vhr-panel__list-item--description")
            ?.textContent?.trim();

          if (!term || !description) continue;

          const termLower = term.toLowerCase();

          if (termLower.includes("registration number")) {
            data.registrationNumber = description;
          }

          if (termLower.includes("registration status") && termLower.includes("expiry")) {
            data.registrationStatus = description;
            const expiryMatch = description.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (expiryMatch) {
              data.registrationExpiry = expiryMatch[1];
            }
          }

          if (termLower.includes("registration serial number")) {
            data.registrationSerial = description;
          }

          if (termLower === "year") {
            data.year = description;
          }

          if (termLower === "make") {
            data.make = description.trim();
          }

          if (termLower === "body type") {
            data.bodyType = description;
          }

          if (termLower === "colour") {
            data.color = description;
          }

          if (termLower.includes("vin") || termLower.includes("chassis")) {
            data.vin = description;
          }

          if (termLower.includes("engine number")) {
            data.engineNumber = description;
          }

          if (termLower.includes("compliance plate") || termLower.includes("rav entry")) {
            data.complianceDate = description;
          }

          if (termLower.includes("sanctions")) {
            data.sanctions = description;
          }

          if (termLower.includes("goods carrying")) {
            data.goodsCarrying = description;
          }

          if (termLower.includes("transfer in dispute")) {
            data.transferDispute = description;
          }
        }
      }

      const allText = document.body.textContent || "";

      return { data, allText: allText.substring(0, 1000), panelsFound: panels.length };
    });

    if (extractedData.data.make && extractedData.data.model) {
      vehicleData.makeModel = `${extractedData.data.make} ${extractedData.data.model}`.trim();
    }
    if (extractedData.data.year) vehicleData.year = extractedData.data.year;
    if (extractedData.data.color) vehicleData.color = extractedData.data.color;
    if (extractedData.data.vin) vehicleData.vin = extractedData.data.vin;
    if (extractedData.data.registrationExpiry)
      vehicleData.registrationExpiry = extractedData.data.registrationExpiry;

    if (extractedData.data.registrationStatus)
      vehicleData.registrationStatus = extractedData.data.registrationStatus;
    if (extractedData.data.registrationSerial)
      vehicleData.registrationSerial = extractedData.data.registrationSerial;
    if (extractedData.data.bodyType) vehicleData.bodyType = extractedData.data.bodyType;
    if (extractedData.data.engineNumber)
      vehicleData.engineNumber = extractedData.data.engineNumber;
    if (extractedData.data.complianceDate)
      vehicleData.complianceDate = extractedData.data.complianceDate;
    if (extractedData.data.sanctions) vehicleData.sanctions = extractedData.data.sanctions;
    if (extractedData.data.goodsCarrying)
      vehicleData.goodsCarrying = extractedData.data.goodsCarrying;
    if (extractedData.data.transferDispute)
      vehicleData.transferDispute = extractedData.data.transferDispute;

    console.log(`🔍 Found ${extractedData.panelsFound} VicRoads panels`);
    console.log("📄 Page content preview:", extractedData.allText);

    const pageText = extractedData.allText.toLowerCase();
    if (
      pageText.includes("registration number was not found") ||
      pageText.includes("invalid registration number") ||
      pageText.includes("no vehicle found") ||
      pageText.includes("registration does not exist")
    ) {
      throw new Error("Vehicle registration not found or invalid");
    }

    if (vehicleData.makeModel && vehicleData.year) {
      vehicleData.status = "Current - Retrieved from VicRoads";
      console.log("✅ Successfully scraped vehicle data:", vehicleData);
    } else if (extractedData.panelsFound > 0) {
      vehicleData.status = "Partial data retrieved - some fields may be missing";
      console.log("⚠️ Partial data retrieved:", vehicleData);
    } else {
      vehicleData.status =
        "No detailed data found - registration may be valid but details not available";
      console.log("⚠️ No VicRoads panels found, returning basic data");
    }

    return vehicleData;
  } catch (error) {
    console.error("❌ Scraping error:", error);

    if (error instanceof Error) {
      if (error.message.includes("timeout")) {
        throw new Error(
          "Request timeout - VicRoads server is slow or Cloudflare challenge took too long"
        );
      } else if (error.message.includes("navigation")) {
        throw new Error("Page navigation failed - site may be temporarily unavailable");
      } else if (error.message.includes("cloudflare") || error.message.includes("challenge")) {
        throw new Error("Cloudflare protection is active - please try again in a few minutes");
      }
    }

    throw new Error(
      `Failed to retrieve vehicle data: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  } finally {
    console.log("🔄 VicRoads lookup operation finished (browser kept alive)");
  }
}
