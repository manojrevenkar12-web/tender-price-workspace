/** Settings come from the environment; defaults are for a laptop with docker compose. */
export interface Config {
  databaseUrl: string;
  migrationDatabaseUrl: string;
  appRolePassword: string;
  port: number;
  host: string;
  tokenSecret: string;
  corsOrigin: string;
  runWorker: boolean;
  anthropicApiKey: string | undefined;
  demoMode: boolean;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
}

export function loadConfig(): Config {
  return {
    databaseUrl: env("DATABASE_URL", "postgres://tpw_app:tpw_app@localhost:5432/tpw"),
    migrationDatabaseUrl: env("MIGRATION_DATABASE_URL", "postgres://postgres:postgres@localhost:5432/tpw"),
    appRolePassword: env("APP_DB_PASSWORD", "tpw_app"),
    port: Number(env("PORT", "4000")),
    host: env("HOST", "0.0.0.0"),
    tokenSecret: env("TOKEN_SECRET", "dev-only-secret-change-me"),
    corsOrigin: env("CORS_ORIGIN", "http://localhost:5173"),
    runWorker: env("RUN_WORKER", "true") === "true",
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"] || undefined,
    demoMode: env("DEMO_MODE", "false") === "true",
  };
}
