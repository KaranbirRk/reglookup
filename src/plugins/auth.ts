import type { FastifyInstance } from "fastify";

export async function registerAuth(app: FastifyInstance): Promise<void> {
  const key = process.env.LOOKUP_API_KEY?.trim();
  if (!key) return;

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url.startsWith("/health?")) return;
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${key}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
