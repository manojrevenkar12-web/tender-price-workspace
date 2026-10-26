/** Row-level security is the tenancy boundary: these tests try to cross it. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withOrg } from "../src/db.ts";
import { api, bid, type Ctx, openTender, reset, start, stop, world, type World } from "./helpers.ts";

let c: Ctx;
let w: World;
beforeAll(async () => (c = await start()));
afterAll(async () => stop(c));
beforeEach(async () => {
  await reset(c);
  w = await world(c);
});

describe("tenancy", () => {
  it("another contractor sees none of our tenders, not even by id", async () => {
    const id = await openTender(c, w);
    expect((await api(c, w.rival.token, "GET", "/api/tenders")).json()).toEqual([]);
    expect((await api(c, w.rival.token, "GET", `/api/tenders/${id}`)).statusCode).toBe(404);
  });

  it("an invited company sees a published tender; an uninvited one does not", async () => {
    const id = await openTender(c, w, undefined, [w.subs[0]!]);
    expect((await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}`)).json().role).toBe("bidder");
    expect((await api(c, w.subs[1]!.token, "GET", `/api/tenders/${id}`)).statusCode).toBe(404);
  });

  it("a draft is invisible even to companies already invited", async () => {
    const t = await api(c, w.buyer.token, "POST", "/api/tenders", {
      projectId: w.projectId,
      title: "Draft",
      trade: "concrete",
      positions: [{ oz: "1", shortText: "x", unit: "m2", quantity: 1 }],
    });
    const id = t.json().id;
    await api(c, w.buyer.token, "POST", `/api/tenders/${id}/invitations`, { orgIds: [w.subs[0]!.orgId] });
    expect((await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}`)).statusCode).toBe(404);
  });

  it("bidders never see each other's bids, and the buyer never sees a draft", async () => {
    const id = await openTender(c, w);
    await bid(c, w.subs[0]!.token, id, { "01.0010": 19_000, "01.0020": 220_000, "01.0040": 500_000 });
    await bid(c, w.subs[1]!.token, id, { "01.0010": 20_000 }, false); // draft
    const asSub1 = await withOrg(c.pool, w.subs[1]!.orgId, (db) => db.query("SELECT org_id FROM bids"));
    expect(asSub1.rows.map((r) => r.org_id)).toEqual([w.subs[1]!.orgId]);
    const asBuyer = await withOrg(c.pool, w.buyer.orgId, (db) => db.query("SELECT org_id FROM bids"));
    expect(asBuyer.rows.map((r) => r.org_id)).toEqual([w.subs[0]!.orgId]);
    const items = await withOrg(c.pool, w.buyer.orgId, (db) =>
      db.query("SELECT count(*)::int AS n FROM bid_items"),
    );
    expect(items.rows[0].n).toBe(3);
  });

  it("bidders cannot read market ranges or the comparison", async () => {
    const id = await openTender(c, w);
    expect((await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}/comparison`)).statusCode).toBe(403);
    expect(
      (await api(c, w.subs[0]!.token, "GET", "/api/price-check?text=Stahlbetonwand&unit=m2&region=BE"))
        .statusCode,
    ).toBe(403);
    await c.admin.query(
      "INSERT INTO position_benchmarks (tender_id, version, oz, status) VALUES ($1, 1, '01.0010', 'ok')",
      [id],
    );
    const seen = await withOrg(c.pool, w.subs[0]!.orgId, (db) =>
      db.query("SELECT * FROM position_benchmarks"),
    );
    expect(seen.rowCount).toBe(0);
  });

  it("a connection without an organisation sees nothing at all", async () => {
    await openTender(c, w);
    const client = await c.pool.connect();
    try {
      for (const t of ["tenders", "boq_positions", "invitations", "bids", "events", "projects"]) {
        expect((await client.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, t).toBe(0);
      }
    } finally {
      client.release();
    }
  });

  it("a bidder cannot write into someone else's bid, even with SQL", async () => {
    const id = await openTender(c, w);
    const b = await bid(c, w.subs[0]!.token, id, {
      "01.0010": 19_000,
      "01.0020": 220_000,
      "01.0040": 500_000,
    });
    const r = await withOrg(c.pool, w.subs[1]!.orgId, (db) =>
      db.query("UPDATE bid_items SET unit_price_cents = 1 WHERE bid_id = $1", [b.id]),
    );
    expect(r.rowCount).toBe(0);
    await expect(
      withOrg(c.pool, w.subs[1]!.orgId, (db) =>
        db.query("INSERT INTO bid_items (bid_id, oz, unit_price_cents) VALUES ($1, '01.0010', 1)", [b.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("only contractors create tenders and only subcontractors bid", async () => {
    expect(
      (await api(c, w.subs[0]!.token, "POST", "/api/projects", { name: "x", city: "y", region: "BE" }))
        .statusCode,
    ).toBe(403);
    const id = await openTender(c, w);
    expect(
      (await api(c, w.buyer.token, "PUT", `/api/tenders/${id}/bid`, { revision: 0, prices: {} })).statusCode,
    ).toBe(403);
    expect((await api(c, null, "GET", "/api/tenders")).statusCode).toBe(401);
    expect((await api(c, "forged.token", "GET", "/api/tenders")).statusCode).toBe(401);
  });
});
