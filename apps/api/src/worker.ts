/**
 * Runs only the job worker (benchmarks, price contributions, regional levels), for deployments
 * that scale it apart from the API. GET /healthz on WORKER_HEALTH_PORT answers 200 while the
 * loop is turning and 503 once it has been stuck for a minute.
 */
import { createServer } from "node:http";

import { loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { startWorker } from "./services/jobs.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl, 8);
let lastTick = Date.now();
const log = (m: string) => {
  lastTick = Date.now();
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg: m }));
};
const stop = startWorker(pool, log);
const beat = setInterval(() => {
  // An idle loop polls every two seconds; a running job logs when it finishes.
  pool
    .query("SELECT 1")
    .then(() => (lastTick = Date.now()))
    .catch(() => undefined);
}, 10_000);

const health = createServer((req, res) => {
  const ok = req.url === "/healthz" && Date.now() - lastTick < 60_000;
  res.writeHead(ok ? 200 : 503, { "content-type": "text/plain" }).end(ok ? "ok" : "stale");
});
health.listen(Number(process.env["WORKER_HEALTH_PORT"] ?? "4001"));

const shutdown = async () => {
  clearInterval(beat);
  health.close();
  await stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
