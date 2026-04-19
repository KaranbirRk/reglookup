import type { FastifyInstance } from "fastify";
import { closeRepcoBrowser, warmupRepcoBrowser } from "../lib/repco-scraper.js";
import {
  QUEUE_MAX_DEPTH,
  localRepcoBacklog,
  repcoBullBacklog,
  runRepcoExclusive,
  runRepcoScrape,
  usesRedisQueue,
} from "../lib/queue-dispatch.js";

export async function registerRepcoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/repco-search", async (req, reply) => {
    const registration = (req.query as { registration?: string }).registration;
    if (!registration) {
      return reply.status(400).send({ error: "Registration number is required" });
    }

    const clean = registration.trim().toUpperCase();

    try {
      if (usesRedisQueue()) {
        const bl = await repcoBullBacklog();
        if (bl >= QUEUE_MAX_DEPTH) {
          return reply
            .status(503)
            .send({ error: "Lookup queue is at capacity" });
        }
      } else {
        if (localRepcoBacklog() >= QUEUE_MAX_DEPTH) {
          return reply
            .status(503)
            .send({ error: "Lookup queue is at capacity" });
        }
      }

      const data = await runRepcoScrape(clean);
      return reply.status(200).send(data);
    } catch (error) {
      req.log.error({ err: error }, "Repco search error");
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.post("/api/repco-search/warmup", async (req, reply) => {
    try {
      req.log.info("API: Warming up Repco browser...");
      await runRepcoExclusive(() => warmupRepcoBrowser());
      return reply.status(200).send({ message: "Repco browser warmup completed" });
    } catch (error) {
      req.log.error({ err: error }, "Repco warmup API error");
      return reply.status(500).send({ error: "Failed to warmup Repco browser" });
    }
  });

  app.post("/api/repco-search/cleanup", async (req, reply) => {
    try {
      req.log.info("API: Closing Repco browser...");
      await runRepcoExclusive(() => closeRepcoBrowser());
      return reply.status(200).send({ message: "Repco browser cleanup completed" });
    } catch (error) {
      req.log.error({ err: error }, "Repco cleanup API error");
      return reply.status(500).send({ error: "Failed to cleanup Repco browser" });
    }
  });
}
