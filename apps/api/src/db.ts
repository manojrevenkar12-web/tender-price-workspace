/**
 * Database access. Every tenant query runs inside `withOrg`, which opens a transaction and sets
 * app.org_id for row-level security; there is no other way to reach tenant tables from a request
 * handler. Background work uses `withSystem`. Both roll back on error.
 */
import pg from "pg";

// numeric -> number (quantities have 3 decimals and stay well inside double precision);
// bigint -> number (cents never reach 2^53).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.PoolClient;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: "tender-price-workspace" });
}

async function tx<T>(
  pool: pg.Pool,
  settings: Record<string, string>,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [k, v] of Object.entries(settings))
      await client.query("SELECT set_config($1, $2, true)", [k, v]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function withOrg<T>(pool: pg.Pool, orgId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return tx(pool, { "app.org_id": orgId }, fn);
}

export function withSystem<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  return tx(pool, { "app.system": "on" }, fn);
}
