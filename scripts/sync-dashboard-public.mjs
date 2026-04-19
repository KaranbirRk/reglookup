import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "frontend", "dist");
const to = path.join(root, "public");
const index = path.join(from, "index.html");

if (!fs.existsSync(index)) {
  console.warn("sync-dashboard-public: frontend/dist/index.html missing — run: npm run build --prefix frontend");
  process.exit(0);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log("sync-dashboard-public: copied frontend/dist → public/");
