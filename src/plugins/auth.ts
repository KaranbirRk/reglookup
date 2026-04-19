import type { FastifyInstance } from "fastify";

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const key = process.env.LOOKUP_API_KEY?.trim();
  if (!key) return;

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    // Only protect JSON API; dashboard HTML/assets live outside /api
    if (!path.startsWith("/api")) return;
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${key}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
