import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  QUEUE_MAX_DEPTH,
  localRepcoBacklog,
  localVicroadsBacklog,
  repcoBullBacklog,
  runRepcoScrape,
  runVicroadsScrape,
  usesRedisQueue,
  vicroadsBullBacklog,
} from "../lib/queue-dispatch.js";

const bodySchema = z.object({
  registrationNumber: z.string().optional(),
});

/**
 * One HTTP call: VicRoads + Repco in parallel. No response caching — every request scrapes fresh
 * (aside from Puppeteer reusing warm browser tabs in-process).
 */
export async function registerLookupCombinedRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/lookup-combined", async (req, reply) => {
    const t0 = Date.now();
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid JSON body" });
      }
      const { registrationNumber } = parsed.data;
      if (!registrationNumber) {
        return reply.status(400).send({ error: "Registration number is required" });
      }

      const clean = registrationNumber.trim().toUpperCase();
      if (clean.length < 3 || clean.length > 10) {
        return reply.status(400).send({ error: "Invalid registration number format" });
      }

      if (usesRedisQueue()) {
        const vb = await vicroadsBullBacklog();
        const rb = await repcoBullBacklog();
        if (vb >= QUEUE_MAX_DEPTH || rb >= QUEUE_MAX_DEPTH) {
          return reply.status(503).send({ error: "Lookup queue is at capacity" });
        }
      } else {
        if (localVicroadsBacklog() >= QUEUE_MAX_DEPTH || localRepcoBacklog() >= QUEUE_MAX_DEPTH) {
          return reply.status(503).send({ error: "Lookup queue is at capacity" });
        }
      }

      const [vicroads, repco] = await Promise.all([
        runVicroadsScrape(clean)
          .then((data) => ({ ok: true as const, data }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : "VicRoads lookup failed",
          })),
        runRepcoScrape(clean)
          .then((data) => ({ ok: true as const, data }))
          .catch((err: unknown) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : "Repco lookup failed",
          })),
      ]);

      return reply.status(200).send({
        registrationNumber: clean,
        ms: Date.now() - t0,
        vicroads: vicroads.ok ? vicroads.data : { error: vicroads.error },
        repco: repco.ok ? repco.data : { error: repco.error },
      });
    } catch (error) {
      req.log.error({ err: error }, "lookup-combined error");
      return reply.status(500).send({ error: "Combined lookup failed" });
    }
  });
}
