import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

/** Serves Vite build from `public/` next to `dist/` when present (Docker + `npm run build:all`). */
export async function registerDashboardStatic(app: FastifyInstance): Promise<void> {
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
  const indexHtml = path.join(publicDir, "index.html");

  if (!fs.existsSync(indexHtml)) {
    app.get("/", async () => ({
      name: "reglookup",
      note: "No dashboard bundle in this process. Use Docker/Railway image, or: npm run build:all then npm start.",
      health: "/health",
      combinedLookup: {
        method: "POST",
        path: "/api/lookup-combined",
        body: { registrationNumber: "ABC123" },
      },
    }));
    return;
  }

  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET") {
      const p = request.url.split("?")[0] ?? "";
      if (!p.startsWith("/api") && p !== "/health") {
        return reply.sendFile("index.html");
      }
    }
    return reply.status(404).send({
      error: "Not Found",
      message: `Route ${request.method}:${request.url} not found`,
      statusCode: 404,
    });
  });
}
