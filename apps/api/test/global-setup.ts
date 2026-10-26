/** Creates a fresh test database and migrates it once per run. */
import pg from "pg";

import { migrate } from "../src/migrate.ts";

export const ADMIN_URL =
  process.env["TEST_ADMIN_URL"] ?? "postgres://postgres:postgres@localhost:5432/postgres";
export const TEST_DB = process.env["TEST_DB"] ?? "tpw_test";

export function urls() {
  const admin = new URL(ADMIN_URL);
  admin.pathname = `/${TEST_DB}`;
  const app = new URL(admin.toString());
  app.username = "tpw_app";
  app.password = "tpw_app";
  return { admin: admin.toString(), app: app.toString() };
}

export default async function setup() {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB],
  );
  await c.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await c.query(`CREATE DATABASE ${TEST_DB}`);
  await c.end();
  await migrate(urls().admin, "tpw_app", () => undefined);
}
