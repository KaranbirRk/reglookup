import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET || "http://127.0.0.1:3000";

  return {
    server: {
      port: 5173,
      proxy: {
        "/health": { target, changeOrigin: true },
        "/api": { target, changeOrigin: true },
      },
    },
  };
});
