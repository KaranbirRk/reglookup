import { startBullWorkers } from "./lib/queue-dispatch.js";

async function main() {
  if (!process.env.REDIS_URL?.trim()) {
    console.error("REDIS_URL is required for worker mode");
    process.exit(1);
  }
  await startBullWorkers();
  console.log("reglookup BullMQ workers started");
}

void main();
