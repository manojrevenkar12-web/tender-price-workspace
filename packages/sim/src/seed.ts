/**
 * pnpm db:seed [--tenders 24000] [--no-large] [--keep-history]
 *
 * Migrates, loads the price history (about two million unit prices), the price index and the
 * regional price levels, then the demo companies and tenders.
 */
import { readFileSync } from "node:fs";

import { createPool, loadConfig, migrate, pricing, withSystem } from "@tpw/api";

import { DEFAULT_HISTORY, loadHistory } from "./history.ts";
import { loadDemo } from "./demo.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = loadConfig();
await migrate(config.migrationDatabaseUrl, config.appRolePassword, () => undefined);
const admin = createPool(config.migrationDatabaseUrl, 4);
const app = createPool(config.databaseUrl, 4);
const t0 = Date.now();

const have = Number(
  (await admin.query("SELECT count(*) AS n FROM price_points WHERE source_tender IS NULL")).rows[0].n,
);
if (args.includes("--keep-history") && have > 0) {
  console.log(`history: keeping ${have.toLocaleString("en")} prices`);
} else {
  const client = await admin.connect();
  const stats = await loadHistory(client, {
    ...DEFAULT_HISTORY,
    tenders: Number(arg("--tenders") ?? 24_000),
  });
  client.release();
  console.log(
    `history: ${stats.points.toLocaleString("en")} prices, ${stats.signatures.toLocaleString("en")} signatures, ${stats.companies} companies (${stats.seconds.toFixed(1)} s)`,
  );
}

await withSystem(app, async (db) => {
  const n = await pricing.loadPriceIndex(
    db,
    readFileSync(new URL("../../../apps/api/data/price_index.csv", import.meta.url), "utf8"),
  );
  await pricing.refreshRegionFactors(db);
  console.log(`price index: ${n} quarters; regional price levels estimated`);
});

const demo = await loadDemo(admin, app, { large: !args.includes("--no-large") });
console.log(`demo: ${Object.keys(demo.tenders).length} tenders, ${demo.subs.length} subcontractors`);
console.log(`sign in as ${demo.contractor.email} (buyer) or ${demo.subs[1]!.email} (bidder)`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await admin.end();
await app.end();
