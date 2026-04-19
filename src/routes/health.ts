import type { FastifyInstance } from "fastify";
import { isRepcoSessionReady } from "../lib/repco-scraper.js";
import { isVicRoadsSessionReady } from "../lib/vicroads-scraper.js";
import {
  localRepcoBacklog,
  localVicroadsBacklog,
  repcoBullBacklog,
  usesRedisQueue,
  vicroadsBullBacklog,
} from "../lib/queue-dispatch.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      ok: true,
      redisQueue: usesRedisQueue(),
      browsers: {
        vicroadsReady: isVicRoadsSessionReady(),
        repcoReady: isRepcoSessionReady(),
      },
      backlog: {
        vicroadsLocal: localVicroadsBacklog(),
        repcoLocal: localRepcoBacklog(),
        vicroadsBull: usesRedisQueue() ? await vicroadsBullBacklog() : 0,
        repcoBull: usesRedisQueue() ? await repcoBullBacklog() : 0,
      },
    };
  });
}
