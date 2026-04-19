import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { closeBrowser, warmupBrowser } from "../lib/vicroads-scraper.js";
import {
  QUEUE_MAX_DEPTH,
  localVicroadsBacklog,
  runVicroadsExclusive,
  runVicroadsScrape,
  usesRedisQueue,
  vicroadsBullBacklog,
} from "../lib/queue-dispatch.js";

const bodySchema = z.object({
  registrationNumber: z.string().optional(),
});

function mapVicRoadsError(error: unknown, reply: FastifyReply) {
  const errorMessage =
    error instanceof Error ? error.message : "Failed to lookup vehicle registration";

  if (errorMessage.includes("not found") || errorMessage.includes("invalid")) {
    return reply.status(404).send({ error: "Vehicle registration not found" });
  }
  if (errorMessage.includes("timeout") || errorMessage.includes("slow")) {
    return reply.status(503).send({ error: "VicRoads lookup timed out" });
  }
  if (errorMessage.includes("denied") || errorMessage.includes("403")) {
    return reply.status(403).send({ error: "Access denied by VicRoads service" });
  }
  return reply.status(500).send({ error: "Failed to lookup vehicle registration" });
}

export async function registerVehicleLookupRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/vehicle-lookup", async (req, reply) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid JSON body" });
      }
      const { registrationNumber } = parsed.data;
      if (!registrationNumber) {
        return reply.status(400).send({ error: "Registration number is required" });
      }

      const cleanRegNumber = registrationNumber.trim().toUpperCase();
      if (cleanRegNumber.length < 3 || cleanRegNumber.length > 10) {
        return reply.status(400).send({ error: "Invalid registration number format" });
      }

      if (usesRedisQueue()) {
        const bl = await vicroadsBullBacklog();
        if (bl >= QUEUE_MAX_DEPTH) {
          return reply.status(503).send({ error: "Lookup queue is at capacity" });
        }
      } else {
        if (localVicroadsBacklog() >= QUEUE_MAX_DEPTH) {
          return reply.status(503).send({ error: "Lookup queue is at capacity" });
        }
      }

      const vehicleData = await runVicroadsScrape(cleanRegNumber);
      return reply.status(200).send(vehicleData);
    } catch (error) {
      req.log.error({ err: error }, "Vehicle lookup error");
      return mapVicRoadsError(error, reply);
    }
  });

  app.post("/api/vehicle-lookup/warmup", async (req, reply) => {
    try {
      req.log.info("API: Warming up VicRoads browser...");
      await runVicroadsExclusive(() => warmupBrowser());
      return reply.status(200).send({ message: "Browser warmup initiated" });
    } catch (error) {
      req.log.error({ err: error }, "Warmup API error");
      return reply.status(500).send({ error: "Failed to warmup browser" });
    }
  });

  app.post("/api/vehicle-lookup/cleanup", async (req, reply) => {
    try {
      req.log.info("API: Closing VicRoads browser...");
      await runVicroadsExclusive(() => closeBrowser());
      return reply.status(200).send({ message: "Browser cleanup completed" });
    } catch (error) {
      req.log.error({ err: error }, "Cleanup API error");
      return reply.status(500).send({ error: "Failed to cleanup browser" });
    }
  });
}
