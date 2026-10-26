/** Starts the API, the live-event hub and (unless RUN_WORKER=false) the job worker. */
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { EventHub } from "./services/events.ts";
import { startWorker } from "./services/jobs.ts";
import { anthropicExplainer } from "./services/review.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl, 20);
const hub = new EventHub(pool);
await hub.start();
const app = await buildApp({
  pool,
  config,
  hub,
  explainer: config.anthropicApiKey ? anthropicExplainer(config.anthropicApiKey) : undefined,
  logger: true,
});
const stopWorker = config.runWorker ? startWorker(pool, (m) => app.log.info(m)) : async () => undefined;
await app.listen({ port: config.port, host: config.host });

const shutdown = async () => {
  await app.close();
  await stopWorker();
  await hub.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
