import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";

import { buildApp } from "../src/app.ts";
import { createPool } from "../src/db.ts";
import { EventHub } from "../src/services/events.ts";
import { resetVocabulary } from "../src/services/pricing.ts";
import { urls } from "./global-setup.ts";

export interface Ctx {
  admin: pg.Pool;
  pool: pg.Pool;
  app: FastifyInstance;
  hub: EventHub;
}

export async function start(): Promise<Ctx> {
  const { admin: a, app: u } = urls();
  const admin = createPool(a, 3);
  const pool = createPool(u, 6);
  const hub = new EventHub(pool);
  await hub.start();
  const app = await buildApp({
    pool,
    hub,
    config: { tokenSecret: "test-secret", corsOrigin: "http://localhost" },
  });
  return { admin, pool, app, hub };
}

export async function stop(c: Ctx): Promise<void> {
  await c.app.close();
  await c.hub.stop();
  await c.pool.end();
  await c.admin.end();
}

export async function reset(c: Ctx): Promise<void> {
  await c.admin.query(
    "TRUNCATE events, bid_items, bids, invitations, position_benchmarks, boq_positions, boq_versions, tenders, projects, users, organizations, jobs, price_points, price_signatures, price_companies, price_index, region_factors RESTART IDENTITY CASCADE",
  );
  resetVocabulary();
  const quarters: string[] = [];
  for (let y = 2023; y <= 2027; y++) for (let q = 1; q <= 4; q++) quarters.push(`${y}Q${q}`);
  // A flat index keeps the arithmetic in tests readable.
  await c.admin.query("INSERT INTO price_index (quarter, value) SELECT unnest($1::text[]), 100", [quarters]);
}

export interface World {
  buyer: { orgId: string; token: string };
  rival: { orgId: string; token: string };
  subs: { orgId: string; token: string; name: string }[];
  projectId: string;
}

export async function token(c: Ctx, email: string): Promise<string> {
  const r = await c.app.inject({ method: "POST", url: "/api/session", payload: { email } });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().token;
}

export async function world(c: Ctx, nSubs = 4): Promise<World> {
  const org = async (name: string, kind: string, email: string) => {
    const o = await c.admin.query<{ id: string }>(
      "INSERT INTO organizations (name, kind, region, trades) VALUES ($1, $2, 'BE', '{concrete}') RETURNING id",
      [name, kind],
    );
    await c.admin.query("INSERT INTO users (org_id, email, name) VALUES ($1, $2, $3)", [
      o.rows[0]!.id,
      email,
      name,
    ]);
    return { orgId: o.rows[0]!.id, token: await token(c, email), name };
  };
  const buyer = await org("Buyer GmbH", "contractor", "buyer@buyer.example");
  const rival = await org("Rival GmbH", "contractor", "rival@rival.example");
  const subs = [];
  for (let i = 1; i <= nSubs; i++)
    subs.push(await org(`Sub ${i} GmbH`, "subcontractor", `sub${i}@sub${i}.example`));
  const p = await api(c, buyer.token, "POST", "/api/projects", {
    name: "Haus A",
    city: "Berlin",
    region: "BE",
  });
  return { buyer, rival, subs, projectId: p.json().id };
}

export async function api(
  c: Ctx,
  token: string | null,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return c.app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as string } : {}),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

export const POSITIONS = [
  { oz: "01.0010", shortText: "Stahlbetonwand C30/37, d=24 cm", unit: "m2", quantity: 100 },
  { oz: "01.0020", shortText: "Betonstahl B500B", unit: "t", quantity: 10 },
  { oz: "01.0030", shortText: "Zulage Sichtbeton SB3", unit: "m2", quantity: 20, kind: "optional" },
  { oz: "01.0040", shortText: "Baustelleneinrichtung", unit: "psch", quantity: 1, kind: "lump" },
];

export async function openTender(
  c: Ctx,
  w: World,
  positions: unknown[] = POSITIONS,
  invite = w.subs,
): Promise<string> {
  const t = await api(c, w.buyer.token, "POST", "/api/tenders", {
    projectId: w.projectId,
    title: "Rohbau",
    trade: "concrete",
    positions,
  });
  if (t.statusCode !== 201) throw new Error(t.body);
  const id = t.json().id as string;
  const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString();
  await api(c, w.buyer.token, "POST", `/api/tenders/${id}/publish`, { deadline });
  if (invite.length)
    await api(c, w.buyer.token, "POST", `/api/tenders/${id}/invitations`, {
      orgIds: invite.map((s) => s.orgId),
    });
  return id;
}

export async function bid(
  c: Ctx,
  tok: string,
  tenderId: string,
  prices: Record<string, number>,
  submit = true,
) {
  const v = await api(c, tok, "GET", `/api/tenders/${tenderId}/bid`);
  const rev = v.json().bid?.revision ?? 0;
  const s = await api(c, tok, "PUT", `/api/tenders/${tenderId}/bid`, { revision: rev, prices });
  if (s.statusCode !== 200) throw new Error(s.body);
  if (!submit) return s.json().bid;
  const r = await api(c, tok, "POST", `/api/tenders/${tenderId}/bid/submit`, {
    revision: s.json().bid.revision,
  });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().bid;
}
