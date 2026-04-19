import type { FastifyInstance } from "fastify";
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
      backlog: {
        vicroadsLocal: localVicroadsBacklog(),
        repcoLocal: localRepcoBacklog(),
        vicroadsBull: usesRedisQueue() ? await vicroadsBullBacklog() : 0,
        repcoBull: usesRedisQueue() ? await repcoBullBacklog() : 0,
      },
    };
  });
}
