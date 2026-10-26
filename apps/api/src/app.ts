/**
 * The HTTP API (Fastify, schemas in zod, OpenAPI at /api/docs/json). Handlers stay thin: they
 * check the session, open a transaction for the caller's organisation and call a service.
 */
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import { formatEuro, parseGaeb, writeGaeb, type Boq, type Cents } from "@tpw/domain";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";

import { checkPassword, DUMMY_HASH, type Session, sign, verify } from "./auth.ts";
import type { Config } from "./config.ts";
import { withOrg } from "./db.ts";
import * as bids from "./services/bids.ts";
import { comparison } from "./services/comparison.ts";
import { type EventHub, type EventRow, eventsSince } from "./services/events.ts";
import { priceOne } from "./services/pricing.ts";
import { type Explainer, reviewPosition } from "./services/review.ts";
import * as tenders from "./services/tenders.ts";
import { HttpError } from "./services/tenders.ts";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export interface AppDeps {
  pool: pg.Pool;
  config: Pick<Config, "tokenSecret" | "corsOrigin"> & {
    demoMode?: boolean;
    metricsToken?: string | undefined;
  };
  hub?: EventHub | undefined;
  explainer?: Explainer | undefined;
  logger?: boolean;
}

const Position = z.object({
  oz: z.string().min(1).max(40),
  section: z.array(z.string()).optional(),
  shortText: z.string().min(1).max(500),
  longText: z.string().max(20_000).optional(),
  unit: z.string().min(1).max(20),
  quantity: z.number().min(0).max(1e9),
  kind: z.enum(["normal", "optional", "alternative", "lump"]).optional(),
  alternativeGroup: z.string().max(20).optional(),
});
const Id = z.object({ id: z.uuid() });

function session(req: FastifyRequest): Session {
  if (!req.session) throw new HttpError(401, "unauthenticated", "sign in first");
  return req.session;
}

function buyer(req: FastifyRequest): Session {
  const s = session(req);
  if (s.kind !== "contractor")
    throw new HttpError(403, "contractors_only", "only tendering companies can do this");
  return s;
}

function bidder(req: FastifyRequest): Session {
  const s = session(req);
  if (s.kind !== "subcontractor")
    throw new HttpError(403, "subcontractors_only", "only bidding companies can do this");
  return s;
}

const SEC = 1_000;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 20 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cors, { origin: deps.config.corsOrigin.split(","), credentials: true });
  // A 2,000-position comparison is ~6 MB of JSON and ~0.5 MB compressed.
  await app.register(compress, { global: true, threshold: 2048, encodings: ["br", "gzip"] });
  await app.register(swagger, {
    openapi: { info: { title: "tender-price-workspace API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });
  app.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );

  const { pool } = deps;
  const metrics = { requests: 0, errors: 0, durationsMs: [] as number[] };

  app.addHook("onRequest", async (req) => {
    (req as FastifyRequest & { t0: number }).t0 = performance.now();
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ")
      ? h.slice(7)
      : (req.query as Record<string, string> | undefined)?.["token"];
    if (token) {
      const s = verify(token, deps.config.tokenSecret);
      if (s) req.session = s;
    }
  });
  app.addHook("onResponse", async (req, reply) => {
    metrics.requests++;
    if (reply.statusCode >= 500) metrics.errors++;
    metrics.durationsMs.push(performance.now() - (req as FastifyRequest & { t0: number }).t0);
    if (metrics.durationsMs.length > 5_000) metrics.durationsMs.splice(0, 2_500);
  });

  app.setErrorHandler(
    (
      err: Error & { statusCode?: number; code?: string; details?: unknown; validation?: unknown },
      req,
      reply,
    ) => {
      if (err instanceof HttpError) {
        return reply.status(err.status).send({
          error: err.code,
          message: err.message,
          ...((err as { details?: unknown }).details
            ? { details: (err as { details?: unknown }).details }
            : {}),
        });
      }
      if (err.validation || err.code === "FST_ERR_VALIDATION")
        return reply.status(400).send({ error: "invalid_request", message: err.message });
      if (err.name === "GaebError")
        return reply.status(422).send({ error: "invalid_gaeb", message: err.message });
      if (err.code === "42501")
        return reply.status(403).send({ error: "forbidden", message: "not allowed for your organisation" });
      if (err.code === "22P02")
        return reply.status(400).send({ error: "invalid_request", message: "malformed identifier" });
      if (err.statusCode && err.statusCode < 500)
        return reply.status(err.statusCode).send({ error: "invalid_request", message: err.message });
      req.log.error(err);
      return reply
        .status(500)
        .send({ error: "internal", message: "something went wrong; it has been logged" });
    },
  );

  const org = <T>(req: FastifyRequest, fn: (db: pg.PoolClient, s: Session) => Promise<T>) => {
    const s = session(req);
    return withOrg(pool, s.orgId, (db) => fn(db, s));
  };

  // ---------------------------------------------------------------- session and directory
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  app.get("/api/metrics", async (req, reply) => {
    // Prometheus scrapes with a bearer token; without METRICS_TOKEN the endpoint is open (local runs).
    const want = deps.config.metricsToken;
    if (want && req.headers.authorization !== `Bearer ${want}`)
      throw new HttpError(401, "unauthorised", "metrics need a token");
    const d = [...metrics.durationsMs].sort((a, b) => a - b);
    const q = (p: number) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))]! : 0);
    const jobs = await pool.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM jobs GROUP BY status",
    );
    const lines = [
      `tpw_http_requests_total ${metrics.requests}`,
      `tpw_http_errors_total ${metrics.errors}`,
      `tpw_http_duration_ms{quantile="0.5"} ${q(0.5).toFixed(1)}`,
      `tpw_http_duration_ms{quantile="0.95"} ${q(0.95).toFixed(1)}`,
      ...jobs.rows.map((r) => `tpw_jobs{status="${r.status}"} ${r.n}`),
      `tpw_sse_subscribers ${deps.hub?.size ?? 0}`,
    ];
    return reply.type("text/plain").send(lines.join("\n") + "\n");
  });

  app.post(
    "/api/session",
    { schema: { body: z.object({ email: z.email(), password: z.string().max(200).optional() }) } },
    async (req) => {
      const r = await pool.query(
        "SELECT u.id, u.name, u.email, u.password_hash, o.id AS org_id, o.kind, o.name AS org FROM users u JOIN organizations o ON o.id = u.org_id WHERE lower(u.email) = lower($1)",
        [req.body.email],
      );
      const u = r.rows[0];
      const { password } = req.body;
      // One answer for an unknown e-mail and a wrong password, and the same work for both.
      const ok =
        password !== undefined
          ? checkPassword(password, u?.password_hash ?? DUMMY_HASH) && Boolean(u?.password_hash)
          : Boolean(u) && deps.config.demoMode === true;
      if (!ok || !u) throw new HttpError(401, "invalid_credentials", "e-mail or password is not right");
      const s: Session = {
        userId: u.id,
        orgId: u.org_id,
        kind: u.kind,
        name: u.name,
        exp: Date.now() + 12 * 3600 * SEC,
      };
      return {
        token: sign(s, deps.config.tokenSecret),
        user: { id: u.id, name: u.name, email: u.email, org: u.org, orgId: u.org_id, kind: u.kind },
      };
    },
  );

  // Demo sign-in helper: lists the seeded users. Off unless DEMO_MODE=true.
  app.get("/api/demo-users", async () => {
    if (!deps.config.demoMode) throw new HttpError(404, "not_found", "not available");
    const r = await pool.query(
      `SELECT u.email, u.name, o.name AS org, o.kind FROM users u JOIN organizations o ON o.id = u.org_id
        ORDER BY o.kind, o.created_at, u.created_at LIMIT 40`,
    );
    return r.rows;
  });

  app.get("/api/me", async (req) => {
    const s = session(req);
    const r = await pool.query(
      "SELECT u.name, u.email, o.name AS org, o.kind, o.region FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = $1",
      [s.userId],
    );
    return { ...r.rows[0], orgId: s.orgId };
  });

  app.get(
    "/api/organizations",
    { schema: { querystring: z.object({ trade: z.string().optional() }) } },
    async (req) => {
      buyer(req);
      const r = await pool.query(
        "SELECT id, name, region, trades FROM organizations WHERE kind = 'subcontractor' AND ($1::text IS NULL OR $1 = ANY(trades)) ORDER BY name",
        [req.query.trade ?? null],
      );
      return r.rows;
    },
  );

  app.get("/api/projects", async (req) =>
    org(
      req,
      async (db) =>
        (await db.query("SELECT id, name, city, region FROM projects ORDER BY created_at DESC")).rows,
    ),
  );

  app.post(
    "/api/projects",
    {
      schema: {
        body: z.object({ name: z.string().min(1), city: z.string().min(1), region: z.string().length(2) }),
      },
    },
    async (req, reply) => {
      const s = buyer(req);
      const id = await withOrg(
        pool,
        s.orgId,
        async (db) =>
          (
            await db.query<{ id: string }>(
              "INSERT INTO projects (org_id, name, city, region) VALUES ($1, $2, $3, $4) RETURNING id",
              [s.orgId, req.body.name, req.body.city, req.body.region],
            )
          ).rows[0]!.id,
      );
      return reply.status(201).send({ id });
    },
  );

  // ---------------------------------------------------------------- tenders (buyer)
  app.get("/api/tenders", async (req) => org(req, (db, s) => tenders.list(db, s.orgId)));

  app.post(
    "/api/tenders",
    {
      schema: {
        body: z.object({
          projectId: z.uuid(),
          title: z.string().min(1).max(200),
          trade: z.string().min(1),
          positions: z.array(Position).min(1).max(20_000),
        }),
      },
    },
    async (req, reply) => {
      const s = buyer(req);
      const id = await withOrg(pool, s.orgId, (db) =>
        tenders.createTender(db, s.orgId, { ...req.body, source: "api" }),
      );
      return reply.status(201).send({ id });
    },
  );

  app.post(
    "/api/tenders/gaeb",
    {
      schema: {
        querystring: z.object({
          projectId: z.uuid(),
          title: z.string().min(1).optional(),
          trade: z.string().min(1),
        }),
        body: z.string(),
      },
    },
    async (req, reply) => {
      const s = buyer(req);
      const boq = parseGaeb(req.body);
      if (boq.dp !== 83)
        throw new HttpError(422, "not_x83", `this is a DP ${boq.dp} file; a tender starts from DP 83`);
      const id = await withOrg(pool, s.orgId, (db) =>
        tenders.createTender(db, s.orgId, {
          projectId: req.query.projectId,
          title: req.query.title ?? boq.name,
          trade: req.query.trade,
          positions: boq.positions,
          source: "gaeb",
        }),
      );
      return reply.status(201).send({ id, positions: boq.positions.length });
    },
  );

  app.get("/api/tenders/:id", { schema: { params: Id } }, async (req) =>
    org(req, async (db, s) => {
      const t = await tenders.getTender(db, req.params.id);
      const project = (
        await db.query("SELECT name, city, region FROM projects WHERE id = $1", [t.project_id])
      ).rows[0];
      const versions = (
        await db.query(
          "SELECT version, note, source, created_at FROM boq_versions WHERE tender_id = $1 ORDER BY version",
          [t.id],
        )
      ).rows;
      const positions = await tenders.positions(db, t.id, t.current_version);
      const mine = t.org_id === s.orgId;
      const invitations = mine
        ? (
            await db.query(
              `SELECT i.org_id AS "orgId", o.name, o.region, i.status, i.updated_at AS "updatedAt"
                 FROM invitations i JOIN organizations o ON o.id = i.org_id WHERE i.tender_id = $1 ORDER BY o.name`,
              [t.id],
            )
          ).rows
        : [];
      return {
        id: t.id,
        title: t.title,
        trade: t.trade,
        status: t.status,
        deadline: t.deadline?.toISOString() ?? null,
        version: t.current_version,
        awardedBidId: mine ? t.awarded_bid_id : null,
        role: mine ? "buyer" : "bidder",
        project,
        versions,
        positions,
        invitations,
      };
    }),
  );

  app.get(
    "/api/tenders/:id/versions/:version",
    { schema: { params: Id.extend({ version: z.coerce.number().int().min(1) }) } },
    async (req) => org(req, (db) => tenders.positions(db, req.params.id, req.params.version)),
  );

  app.get(
    "/api/tenders/:id/diff",
    {
      schema: {
        params: Id,
        querystring: z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }),
      },
    },
    async (req) => org(req, (db) => tenders.versionDiff(db, req.params.id, req.query.from, req.query.to)),
  );

  app.post(
    "/api/tenders/:id/publish",
    { schema: { params: Id, body: z.object({ deadline: z.iso.datetime({ offset: true }) }) } },
    async (req) => {
      const s = buyer(req);
      await withOrg(pool, s.orgId, (db) => tenders.publish(db, s.orgId, req.params.id, req.body.deadline));
      return { ok: true };
    },
  );

  app.post(
    "/api/tenders/:id/invitations",
    { schema: { params: Id, body: z.object({ orgIds: z.array(z.uuid()).min(1).max(200) }) } },
    async (req) => {
      const s = buyer(req);
      return {
        invited: await withOrg(pool, s.orgId, (db) =>
          tenders.invite(db, s.orgId, req.params.id, req.body.orgIds),
        ),
      };
    },
  );

  app.post(
    "/api/tenders/:id/addenda",
    {
      schema: {
        params: Id,
        body: z.object({
          note: z.string().max(2_000).default(""),
          positions: z.array(Position).min(1).max(20_000),
        }),
      },
    },
    async (req) => {
      const s = buyer(req);
      return withOrg(pool, s.orgId, (db) =>
        tenders.addendum(db, s.orgId, req.params.id, req.body.positions, req.body.note),
      );
    },
  );

  app.post("/api/tenders/:id/close", { schema: { params: Id } }, async (req) => {
    const s = buyer(req);
    await withOrg(pool, s.orgId, (db) => tenders.close(db, s.orgId, req.params.id));
    return { ok: true };
  });

  app.post(
    "/api/tenders/:id/award",
    { schema: { params: Id, body: z.object({ bidId: z.uuid() }) } },
    async (req) => {
      const s = buyer(req);
      await withOrg(pool, s.orgId, (db) => tenders.award(db, s.orgId, req.params.id, req.body.bidId));
      return { ok: true };
    },
  );

  app.get("/api/tenders/:id/comparison", { schema: { params: Id } }, async (req) => {
    const s = buyer(req);
    return withOrg(pool, s.orgId, (db) => comparison(db, s.orgId, req.params.id));
  });

  app.get(
    "/api/tenders/:id/positions/:oz/market",
    { schema: { params: Id.extend({ oz: z.string() }) } },
    async (req) => {
      const s = buyer(req);
      return withOrg(pool, s.orgId, async (db) => {
        const t = await tenders.ownTender(db, s.orgId, req.params.id);
        const p = (await tenders.positions(db, t.id, t.current_version)).find((x) => x.oz === req.params.oz);
        if (!p) throw tenders.notFound("position");
        const region = (await db.query("SELECT region FROM projects WHERE id = $1", [t.project_id])).rows[0]
          .region;
        const quarter = quarterOfDate(t.deadline ?? new Date());
        const answer = await priceOne(db, {
          text: p.shortText,
          longText: p.longText,
          unit: p.unit,
          region,
          quarter,
          excludeTender: t.id,
        });
        return { position: p, region, quarter, ...answer };
      });
    },
  );

  app.get("/api/tenders/:id/review", { schema: { params: Id } }, async (req) => {
    const s = buyer(req);
    return withOrg(pool, s.orgId, async (db) => {
      const t = await tenders.ownTender(db, s.orgId, req.params.id);
      const ps = await tenders.positions(db, t.id, t.current_version);
      return ps
        .map((p) => ({ oz: p.oz, shortText: p.shortText, findings: reviewPosition(p) }))
        .filter((x) => x.findings.length);
    });
  });

  app.post(
    "/api/tenders/:id/positions/:oz/explain",
    { schema: { params: Id.extend({ oz: z.string() }) } },
    async (req) => {
      const s = buyer(req);
      if (!deps.explainer)
        throw new HttpError(501, "explainer_off", "plain-language explanations need an ANTHROPIC_API_KEY");
      const p = await withOrg(pool, s.orgId, async (db) => {
        const t = await tenders.ownTender(db, s.orgId, req.params.id);
        return (await tenders.positions(db, t.id, t.current_version)).find((x) => x.oz === req.params.oz);
      });
      if (!p) throw tenders.notFound("position");
      return { oz: p.oz, explanation: await deps.explainer.explain(`${p.shortText}\n${p.longText}`) };
    },
  );

  app.get("/api/tenders/:id/gaeb", { schema: { params: Id } }, async (req, reply) => {
    const xml = await org(req, async (db) => {
      const t = await tenders.getTender(db, req.params.id);
      const ps = await tenders.positions(db, t.id, t.current_version);
      const boq: Boq = {
        name: t.title,
        dp: 83,
        positions: ps.map((p) => ({
          oz: p.oz,
          section: p.section,
          shortText: p.shortText,
          longText: p.longText,
          quantity: p.quantity,
          unit: p.unit,
          kind: p.kind as Boq["positions"][number]["kind"],
          ...(p.alternativeGroup ? { alternativeGroup: p.alternativeGroup } : {}),
        })),
      };
      return writeGaeb(boq);
    });
    return reply
      .type("application/xml")
      .header("content-disposition", `attachment; filename="tender-${req.params.id}.x83"`)
      .send(xml);
  });

  app.get(
    "/api/tenders/:id/activity",
    { schema: { params: Id, querystring: z.object({ after: z.coerce.number().int().min(0).default(0) }) } },
    async (req) => (await eventsSince(pool, session(req).orgId, req.params.id, req.query.after)).map(present),
  );

  app.get("/api/tenders/:id/events", { schema: { params: Id } }, async (req, reply) => {
    const s = session(req);
    await withOrg(pool, s.orgId, (db) => tenders.getTender(db, req.params.id));
    const last = Number(req.headers["last-event-id"] ?? 0) || 0;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const send = (e: EventRow) =>
      reply.raw.write(`id: ${e.id}\nevent: activity\ndata: ${JSON.stringify(present(e))}\n\n`);
    for (const e of await eventsSince(pool, s.orgId, req.params.id, last)) send(e);
    const unsubscribe =
      deps.hub?.subscribe({ orgId: s.orgId, tenderId: req.params.id, send }) ?? (() => undefined);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25 * SEC);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
    return reply;
  });

  app.get(
    "/api/price-check",
    {
      schema: {
        querystring: z.object({
          text: z.string().min(2).max(2_000),
          unit: z.string().min(1),
          region: z.string().length(2),
          quarter: z
            .string()
            .regex(/^\d{4}Q[1-4]$/)
            .optional(),
        }),
      },
    },
    async (req) => {
      const s = buyer(req);
      return withOrg(pool, s.orgId, (db) =>
        priceOne(db, {
          text: req.query.text,
          unit: req.query.unit,
          region: req.query.region,
          quarter: req.query.quarter ?? quarterOfDate(new Date()),
        }),
      );
    },
  );

  // ---------------------------------------------------------------- bids (bidder)
  app.get("/api/tenders/:id/bid", { schema: { params: Id } }, async (req) => {
    const s = bidder(req);
    return { bid: await withOrg(pool, s.orgId, (db) => bids.view(db, s.orgId, req.params.id)) };
  });

  app.put(
    "/api/tenders/:id/bid",
    {
      schema: {
        params: Id,
        body: z.object({
          revision: z.number().int().min(0),
          prices: z.record(z.string(), z.number().int().min(0).nullable()),
        }),
      },
    },
    async (req) => {
      const s = bidder(req);
      return { bid: await withOrg(pool, s.orgId, (db) => bids.save(db, s.orgId, req.params.id, req.body)) };
    },
  );

  app.post(
    "/api/tenders/:id/bid/submit",
    { schema: { params: Id, body: z.object({ revision: z.number().int().min(0) }) } },
    async (req) => {
      const s = bidder(req);
      return {
        bid: await withOrg(pool, s.orgId, (db) => bids.submit(db, s.orgId, req.params.id, req.body.revision)),
      };
    },
  );

  app.post(
    "/api/tenders/:id/bid/gaeb",
    {
      schema: {
        params: Id,
        querystring: z.object({ revision: z.coerce.number().int().min(0) }),
        body: z.string(),
      },
    },
    async (req) => {
      const s = bidder(req);
      return withOrg(pool, s.orgId, (db) =>
        bids.importX84(db, s.orgId, req.params.id, req.body, req.query.revision),
      );
    },
  );

  app.get("/api/tenders/:id/bid/gaeb", { schema: { params: Id } }, async (req, reply) => {
    const s = bidder(req);
    const xml = await withOrg(pool, s.orgId, async (db) => {
      const t = await tenders.getTender(db, req.params.id);
      const b = await bids.view(db, s.orgId, t.id);
      const ps = await tenders.positions(db, t.id, t.current_version);
      const prices = new Map(Object.entries(b?.prices ?? {}).map(([k, v]) => [k, v as Cents]));
      return writeGaeb({
        name: t.title,
        dp: 84,
        bidder: s.name,
        prices,
        positions: ps.map((p) => ({
          oz: p.oz,
          section: p.section,
          shortText: p.shortText,
          longText: p.longText,
          quantity: p.quantity,
          unit: p.unit,
          kind: p.kind as Boq["positions"][number]["kind"],
        })),
      });
    });
    return reply
      .type("application/xml")
      .header("content-disposition", `attachment; filename="bid-${req.params.id}.x84"`)
      .send(xml);
  });

  app.post(
    "/api/tenders/:id/decline",
    { schema: { params: Id, body: z.object({ reason: z.string().max(1_000).default("") }) } },
    async (req) => {
      const s = bidder(req);
      await withOrg(pool, s.orgId, (db) => bids.decline(db, s.orgId, req.params.id, req.body.reason));
      return { ok: true };
    },
  );

  app.get("/api/docs/json", async () => app.swagger());

  return app;
}

function present(e: EventRow) {
  return {
    id: e.id,
    kind: e.kind,
    actor: e.actor,
    actorOrg: e.actor_org,
    payload: e.payload,
    at: e.at.toISOString(),
  };
}

function quarterOfDate(d: Date): string {
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export { formatEuro };
