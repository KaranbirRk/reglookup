import Fastify from "fastify";
import cors from "@fastify/cors";
import { initQueueLayer } from "./lib/queue-dispatch.js";
import { registerAuth } from "./plugins/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLookupCombinedRoutes } from "./routes/lookup-combined.js";
import { registerRepcoRoutes } from "./routes/repco-search.js";
import { registerVehicleLookupRoutes } from "./routes/vehicle-lookup.js";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
    genReqId: () => crypto.randomUUID(),
  });

  const origins = process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean);
  if (origins && origins.length > 0) {
    await app.register(cors, { origin: origins });
  }

  await registerAuth(app);
  await registerHealthRoutes(app);
  await registerVehicleLookupRoutes(app);
  await registerRepcoRoutes(app);
  await registerLookupCombinedRoutes(app);
  await initQueueLayer();

  return app;
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
