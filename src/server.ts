import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { initQueueLayer } from "./lib/queue-dispatch.js";
import { warmupRepcoBrowser } from "./lib/repco-scraper.js";
import { warmupBrowser } from "./lib/vicroads-scraper.js";
import { registerAuth } from "./plugins/auth.js";
import { registerDashboardStatic } from "./plugins/dashboard-static.js";
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

  await registerDashboardStatic(app);

  return app;
}

function startBackgroundWarmup(app: FastifyInstance): void {
  if (process.env.WARMUP_ON_START === "false") {
    app.log.info("WARMUP_ON_START=false — skipping background browser warmup");
    return;
  }
  app.log.info("Background browser warmup starting (VicRoads + Repco in parallel)…");
  void Promise.all([warmupBrowser(), warmupRepcoBrowser()])
    .then(() => app.log.info("Background browser warmup finished"))
    .catch((err: unknown) =>
      app.log.warn({ err }, "Background browser warmup failed — first lookup may be slower")
    );
}

async function main() {
  const app = await buildServer();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  startBackgroundWarmup(app);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
