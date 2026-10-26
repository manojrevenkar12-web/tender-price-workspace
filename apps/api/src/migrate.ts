/** Applies migrations/*.sql in order, each in its own transaction, once. */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadConfig } from "./config.ts";

const DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function migrate(
  url: string,
  appPassword: string,
  log: (m: string) => void = console.log,
): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const name of (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      const sql = await readFile(DIR + name, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`${name}: ${(e as Error).message}`, { cause: e });
      }
      applied.push(name);
      log(`applied ${name}`);
    }
    await client.query(`ALTER ROLE tpw_app PASSWORD '${appPassword.replace(/'/g, "''")}'`);
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    await client.end();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = loadConfig();
  await migrate(c.migrationDatabaseUrl, c.appRolePassword);
}
