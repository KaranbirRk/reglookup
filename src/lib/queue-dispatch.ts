import PQueue from "p-queue";
import { Queue, QueueEvents, Worker, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { scrapeVicRoadsData } from "./vicroads-scraper.js";
import { scrapeRepcoData } from "./repco-scraper.js";

const redisUrl = process.env.REDIS_URL?.trim();

const bullGlobal = globalThis as unknown as {
  reglookupBullProducers?: Promise<void>;
  reglookupBullWorkers?: Promise<void>;
};

let bullBase: Redis | null = null;
let vcBullQueue: Queue | null = null;
let repcoBullQueue: Queue | null = null;
let vcQueueEvents: QueueEvents | null = null;
let repcoQueueEvents: QueueEvents | null = null;

const vcLocal = new PQueue({
  concurrency: Math.max(1, parseInt(process.env.VICROADS_CONCURRENCY ?? "1", 10) || 1),
});
const repcoLocal = new PQueue({
  concurrency: Math.max(1, parseInt(process.env.REPCO_CONCURRENCY ?? "1", 10) || 1),
});

export const QUEUE_MAX_DEPTH = Math.max(
  1,
  parseInt(process.env.QUEUE_MAX_DEPTH ?? "100", 10) || 100
);

const SCRAPE_JOB_TIMEOUT_MS = Math.max(
  10_000,
  parseInt(process.env.SCRAPE_JOB_TIMEOUT_MS ?? "120000", 10) || 120_000
);

function dupConnection(): ConnectionOptions {
  if (!bullBase) {
    bullBase = new Redis(redisUrl!, { maxRetriesPerRequest: null });
  }
  return bullBase.duplicate({ maxRetriesPerRequest: null });
}

/** HTTP tier: queues + events only (no Workers — avoids sharing one browser with workers in-process). */
export async function initBullProducers(): Promise<void> {
  if (!redisUrl) return;
  if (bullGlobal.reglookupBullProducers) return bullGlobal.reglookupBullProducers;

  bullGlobal.reglookupBullProducers = (async () => {
    vcBullQueue = new Queue("reglookup-vicroads", { connection: dupConnection() });
    repcoBullQueue = new Queue("reglookup-repco", { connection: dupConnection() });
    vcQueueEvents = new QueueEvents("reglookup-vicroads", { connection: dupConnection() });
    repcoQueueEvents = new QueueEvents("reglookup-repco", { connection: dupConnection() });
    await vcQueueEvents.waitUntilReady();
    await repcoQueueEvents.waitUntilReady();
  })();

  return bullGlobal.reglookupBullProducers;
}

/** Worker tier: BullMQ Workers only (run as separate container/process). */
export async function startBullWorkers(): Promise<void> {
  if (!redisUrl) throw new Error("REDIS_URL required for workers");
  if (bullGlobal.reglookupBullWorkers) return bullGlobal.reglookupBullWorkers;

  bullGlobal.reglookupBullWorkers = (async () => {
    new Worker(
      "reglookup-vicroads",
      async (job) => {
        const reg = (job.data as { registrationNumber: string }).registrationNumber;
        return await scrapeVicRoadsData(reg);
      },
      { connection: dupConnection(), concurrency: 1 }
    );

    new Worker(
      "reglookup-repco",
      async (job) => {
        const reg = (job.data as { registrationNumber: string }).registrationNumber;
        return await scrapeRepcoData(reg);
      },
      { connection: dupConnection(), concurrency: 1 }
    );
  })();

  return bullGlobal.reglookupBullWorkers;
}

export function usesRedisQueue(): boolean {
  return Boolean(redisUrl);
}

export async function initQueueLayer(): Promise<void> {
  if (redisUrl) await initBullProducers();
}

export function localVicroadsBacklog(): number {
  return vcLocal.size + vcLocal.pending;
}

export function localRepcoBacklog(): number {
  return repcoLocal.size + repcoLocal.pending;
}

export async function vicroadsBullBacklog(): Promise<number> {
  if (!vcBullQueue) return 0;
  const c = await vcBullQueue.getJobCounts("waiting", "active", "delayed");
  return (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0);
}

export async function repcoBullBacklog(): Promise<number> {
  if (!repcoBullQueue) return 0;
  const c = await repcoBullQueue.getJobCounts("waiting", "active", "delayed");
  return (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0);
}

export async function runVicroadsScrape(registrationNumber: string) {
  if (redisUrl) {
    await initBullProducers();
    if (!vcBullQueue || !vcQueueEvents) throw new Error("BullMQ VicRoads not initialized");
    const job = await vcBullQueue.add(
      "lookup",
      { registrationNumber },
      { removeOnComplete: 100, removeOnFail: 50 }
    );
    return await job.waitUntilFinished(vcQueueEvents, SCRAPE_JOB_TIMEOUT_MS);
  }
  return vcLocal.add(() => scrapeVicRoadsData(registrationNumber));
}

export async function runRepcoScrape(registrationNumber: string) {
  if (redisUrl) {
    await initBullProducers();
    if (!repcoBullQueue || !repcoQueueEvents) throw new Error("BullMQ Repco not initialized");
    const job = await repcoBullQueue.add(
      "lookup",
      { registrationNumber },
      { removeOnComplete: 100, removeOnFail: 50 }
    );
    return await job.waitUntilFinished(repcoQueueEvents, SCRAPE_JOB_TIMEOUT_MS);
  }
  return repcoLocal.add(() => scrapeRepcoData(registrationNumber));
}

/** Serialize VicRoads browser mutations on the HTTP process (warmup/cleanup). */
export async function runVicroadsExclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (redisUrl) return fn();
  return vcLocal.add(fn) as Promise<T>;
}

export async function runRepcoExclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (redisUrl) return fn();
  return repcoLocal.add(fn) as Promise<T>;
}
