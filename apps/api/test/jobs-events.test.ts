import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withSystem } from "../src/db.ts";
import type { EventRow } from "../src/services/events.ts";
import { HANDLERS, runOne } from "../src/services/jobs.ts";
import { api, bid, type Ctx, openTender, reset, start, stop, world, type World } from "./helpers.ts";

let c: Ctx;
let w: World;
beforeAll(async () => (c = await start()));
afterAll(async () => stop(c));
beforeEach(async () => {
  await reset(c);
  w = await world(c, 2);
});

describe("jobs", () => {
  it("retries a failing job with backoff and gives up after five attempts", async () => {
    let calls = 0;
    HANDLERS["flaky"] = async () => {
      calls++;
      throw new Error("provider down");
    };
    await c.admin.query("INSERT INTO jobs (kind, payload) VALUES ('flaky', '{}')");
    for (let i = 0; i < 5; i++) {
      await c.admin.query("UPDATE jobs SET run_after = now() WHERE kind = 'flaky'");
      expect(await runOne(c.pool)).toBe(true);
    }
    const j = (await c.admin.query("SELECT status, attempts, last_error FROM jobs WHERE kind = 'flaky'"))
      .rows[0];
    expect(j).toEqual({ status: "failed", attempts: 5, last_error: "provider down" });
    expect(calls).toBe(5);
    delete HANDLERS["flaky"];
  });

  it("lets two workers take different jobs at the same time", async () => {
    const seen: number[] = [];
    HANDLERS["slow"] = async (_db, p) => {
      seen.push(Number(p["n"]));
      await new Promise((r) => setTimeout(r, 150));
    };
    await c.admin.query(
      "INSERT INTO jobs (kind, payload) VALUES ('slow', '{\"n\":1}'), ('slow', '{\"n\":2}')",
    );
    const t0 = Date.now();
    await Promise.all([runOne(c.pool), runOne(c.pool)]);
    expect(seen.sort()).toEqual([1, 2]);
    expect(Date.now() - t0).toBeLessThan(290);
    delete HANDLERS["slow"];
  });
});

describe("live activity", () => {
  it("streams events through row-level security: a bidder does not learn that a competitor submitted", async () => {
    const id = await openTender(c, w);
    const buyerSeen: EventRow[] = [];
    const sub1Seen: EventRow[] = [];
    const off1 = c.hub.subscribe({ orgId: w.buyer.orgId, tenderId: id, send: (e) => buyerSeen.push(e) });
    const off2 = c.hub.subscribe({ orgId: w.subs[0]!.orgId, tenderId: id, send: (e) => sub1Seen.push(e) });
    await bid(c, w.subs[1]!.token, id, { "01.0010": 19_000, "01.0020": 220_000, "01.0040": 500_000 });
    await api(c, w.buyer.token, "POST", `/api/tenders/${id}/close`);
    await new Promise((r) => setTimeout(r, 400));
    off1();
    off2();
    expect(buyerSeen.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["viewed", "bid_submitted", "tender_closed"]),
    );
    expect(sub1Seen.map((e) => e.kind)).toEqual(["tender_closed"]);
  });

  it("replays what a client missed from its last event id", async () => {
    const id = await openTender(c, w);
    const all = (await api(c, w.buyer.token, "GET", `/api/tenders/${id}/activity`)).json();
    expect(all.map((e: { kind: string }) => e.kind)).toEqual([
      "tender_created",
      "tender_published",
      "invited",
    ]);
    const after = (
      await api(c, w.buyer.token, "GET", `/api/tenders/${id}/activity?after=${all[1].id}`)
    ).json();
    expect(after.map((e: { kind: string }) => e.kind)).toEqual(["invited"]);
  });
});

describe("operations", () => {
  it("reports health, request metrics and the job queue", async () => {
    expect((await api(c, null, "GET", "/api/health")).json()).toEqual({ ok: true });
    await withSystem(c.pool, (db) => db.query("INSERT INTO jobs (kind, payload) VALUES ('noop', '{}')"));
    const m = (await api(c, null, "GET", "/api/metrics")).body;
    expect(m).toMatch(/tpw_http_requests_total \d+/);
    expect(m).toContain('tpw_jobs{status="queued"} 1');
  });

  it("documents itself as OpenAPI", async () => {
    const doc = (await api(c, null, "GET", "/api/docs/json")).json();
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/tenders/{id}/comparison", "/api/price-check"]),
    );
  });
});
