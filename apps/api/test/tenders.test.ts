import { readFileSync } from "node:fs";

import { parseGaeb } from "@tpw/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { drain } from "../src/services/jobs.ts";
import {
  api,
  bid,
  type Ctx,
  openTender,
  POSITIONS,
  reset,
  start,
  stop,
  world,
  type World,
} from "./helpers.ts";

let c: Ctx;
let w: World;
beforeAll(async () => (c = await start()));
afterAll(async () => stop(c));
beforeEach(async () => {
  await reset(c);
  w = await world(c);
});

const x83 = readFileSync(
  new URL("../../../packages/domain/test/fixtures/rohbau.x83", import.meta.url),
  "utf8",
);

describe("tenders", () => {
  it("starts from a GAEB X83 upload and gives it back as X83", async () => {
    const r = await api(
      c,
      w.buyer.token,
      "POST",
      `/api/tenders/gaeb?projectId=${w.projectId}&trade=concrete`,
      x83,
      { "content-type": "application/xml" },
    );
    expect(r.statusCode).toBe(201);
    expect(r.json().positions).toBe(6);
    const t = (await api(c, w.buyer.token, "GET", `/api/tenders/${r.json().id}`)).json();
    expect(t.title).toBe("Rohbau Wohnanlage Lindenhof");
    expect(t.positions.map((p: { kind: string }) => p.kind)).toEqual([
      "lump",
      "normal",
      "normal",
      "normal",
      "optional",
      "alternative",
    ]);
    const back = await api(c, w.buyer.token, "GET", `/api/tenders/${r.json().id}/gaeb`);
    expect(back.headers["content-type"]).toContain("application/xml");
    expect(parseGaeb(back.body).positions.map((p) => p.oz)).toEqual(
      parseGaeb(x83).positions.map((p) => p.oz),
    );
  });

  it("rejects a broken GAEB file with the place of the error", async () => {
    const r = await api(
      c,
      w.buyer.token,
      "POST",
      `/api/tenders/gaeb?projectId=${w.projectId}&trade=concrete`,
      x83.replace("<Qty>38.500</Qty>", "<Qty>viel</Qty>"),
      { "content-type": "application/xml" },
    );
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toContain("BoQCtgy[1]/Item[1]");
  });

  it("validates what a BoQ and a publication must be", async () => {
    const dup = await api(c, w.buyer.token, "POST", "/api/tenders", {
      projectId: w.projectId,
      title: "x",
      trade: "y",
      positions: [POSITIONS[0], POSITIONS[0]],
    });
    expect(dup.json()).toMatchObject({ error: "duplicate_oz" });
    const t = await api(c, w.buyer.token, "POST", "/api/tenders", {
      projectId: w.projectId,
      title: "x",
      trade: "y",
      positions: POSITIONS,
    });
    const past = await api(c, w.buyer.token, "POST", `/api/tenders/${t.json().id}/publish`, {
      deadline: "2020-01-01T00:00:00Z",
    });
    expect(past.json()).toMatchObject({ error: "deadline_past" });
    const notSub = await api(c, w.buyer.token, "POST", `/api/tenders/${t.json().id}/invitations`, {
      orgIds: [w.rival.orgId],
    });
    expect(notSub.json()).toMatchObject({ error: "not_subcontractor" });
  });

  it("publishes an addendum: requantified prices stand, changed work must be priced again", async () => {
    const id = await openTender(c, w);
    await bid(c, w.subs[0]!.token, id, { "01.0010": 19_000, "01.0020": 220_000, "01.0040": 500_000 });
    const next = [
      { ...POSITIONS[0]!, quantity: 140 },
      { ...POSITIONS[1]!, shortText: "Betonstahl B500B, Durchmesser bis 28 mm" },
      POSITIONS[2]!,
      POSITIONS[3]!,
      { oz: "01.0050", shortText: "Schalung Wand", unit: "m2", quantity: 200 },
    ];
    const a = await api(c, w.buyer.token, "POST", `/api/tenders/${id}/addenda`, {
      note: "Nachtrag 1",
      positions: next,
    });
    expect(a.json()).toMatchObject({ version: 2, biddersAffected: 1 });
    expect(a.json().changes).toEqual([
      { oz: "01.0010", type: "quantity", from: 100, to: 140 },
      { oz: "01.0020", type: "work", fields: ["text"] },
      { oz: "01.0050", type: "added" },
    ]);
    const cmp = (await api(c, w.buyer.token, "GET", `/api/tenders/${id}/comparison`)).json();
    const cell = (oz: string) => cmp.rows.find((r: { oz: string }) => r.oz === oz).cells[cmp.bids[0].bidId];
    expect(cell("01.0010")).toMatchObject({ standing: "requantified", total: 2_660_000 });
    expect(cell("01.0020")).toMatchObject({ standing: "stale" });
    expect(cell("01.0050")).toMatchObject({ standing: "missing" });

    // The bidder reopens the bid: the stale price is dropped, the requantified one kept.
    const view = (await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}/bid`)).json().bid;
    const saved = await api(c, w.subs[0]!.token, "PUT", `/api/tenders/${id}/bid`, {
      revision: view.revision,
      prices: { "01.0050": 4_200 },
    });
    expect(saved.json().bid.prices).toEqual({ "01.0010": 19_000, "01.0040": 500_000, "01.0050": 4_200 });
    expect(saved.json().bid).toMatchObject({ status: "draft", version: 2 });
    const incomplete = await api(c, w.subs[0]!.token, "POST", `/api/tenders/${id}/bid/submit`, {
      revision: saved.json().bid.revision,
    });
    expect(incomplete.json()).toMatchObject({
      error: "incomplete_bid",
      details: [{ oz: "01.0020", problem: "missing_price" }],
    });
  });

  it("awards a submitted bid and adds the tender's prices to the history", async () => {
    const id = await openTender(c, w);
    const b = await bid(c, w.subs[0]!.token, id, {
      "01.0010": 19_000,
      "01.0020": 220_000,
      "01.0040": 500_000,
    });
    await bid(c, w.subs[1]!.token, id, { "01.0010": 21_000, "01.0020": 230_000, "01.0040": 450_000 });
    expect(
      (await api(c, w.buyer.token, "POST", `/api/tenders/${id}/award`, { bidId: b.id })).statusCode,
    ).toBe(200);
    expect(
      (await api(c, w.buyer.token, "POST", `/api/tenders/${id}/award`, { bidId: b.id })).json().error,
    ).toBe("already_awarded");
    await drain(c.pool);
    await drain(c.pool); // a second run of the job must not add the prices twice
    const pts = await c.admin.query(
      "SELECT s.unit_code, p.unit_price_cents FROM price_points p JOIN price_signatures s ON s.id = p.signature_id WHERE p.source_tender = $1 ORDER BY 2",
      [id],
    );
    // Wall per m² from both bidders; rebar converted from per t to per kg; lump sums are not history.
    expect(pts.rows).toEqual([
      { unit_code: "kg", unit_price_cents: 220 },
      { unit_code: "kg", unit_price_cents: 230 },
      { unit_code: "m2", unit_price_cents: 19_000 },
      { unit_code: "m2", unit_price_cents: 21_000 },
    ]);
  });

  it("refuses bids after the deadline and on closed tenders", async () => {
    const id = await openTender(c, w);
    await c.admin.query("UPDATE tenders SET deadline = now() - interval '1 minute' WHERE id = $1", [id]);
    const r = await api(c, w.subs[0]!.token, "PUT", `/api/tenders/${id}/bid`, {
      revision: 0,
      prices: { "01.0010": 1 },
    });
    expect(r.json().error).toBe("deadline_passed");
  });

  it("stops two people from overwriting each other's prices", async () => {
    const id = await openTender(c, w);
    const first = await api(c, w.subs[0]!.token, "PUT", `/api/tenders/${id}/bid`, {
      revision: 0,
      prices: { "01.0010": 19_000 },
    });
    expect(first.statusCode).toBe(200);
    const stale = await api(c, w.subs[0]!.token, "PUT", `/api/tenders/${id}/bid`, {
      revision: 0,
      prices: { "01.0010": 25_000 },
    });
    expect(stale.statusCode).toBe(409);
    expect(
      (await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}/bid`)).json().bid.prices["01.0010"],
    ).toBe(19_000);
  });

  it("imports a bid from GAEB X84 and ignores positions the BoQ does not have", async () => {
    const id = await openTender(c, w);
    const x84 = (await api(c, w.subs[0]!.token, "GET", `/api/tenders/${id}/bid/gaeb`)).body
      .replace('<Item RNoPart="0010">', '<Item RNoPart="0010"><UP>190.00</UP>')
      .replace('<Item RNoPart="0020">', '<Item RNoPart="0020"><UP>2200.00</UP>')
      .replace("<DP>84</DP>", "<DP>84</DP>");
    const r = await api(c, w.subs[0]!.token, "POST", `/api/tenders/${id}/bid/gaeb?revision=0`, x84, {
      "content-type": "application/xml",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().bid.prices).toEqual({ "01.0010": 19_000, "01.0020": 220_000 });
  });

  it("lists findings a bidder would have to guess", async () => {
    const id = await openTender(c, w, [
      { oz: "1", shortText: "Stahlbetonwand", unit: "m2", quantity: 10 },
      { oz: "2", shortText: "Bodenfliesen Feinsteinzeug", unit: "m2", quantity: 10 },
      { oz: "3", shortText: "KG-Rohr DN 150", unit: "m", quantity: 10 },
    ]);
    const r = (await api(c, w.buyer.token, "GET", `/api/tenders/${id}/review`)).json();
    expect(
      r.map((x: { oz: string; findings: { code: string }[] }) => [x.oz, x.findings.map((f) => f.code)]),
    ).toEqual([
      ["1", ["missing_concrete_class", "missing_thickness"]],
      ["2", ["missing_format", "missing_slip_class"]],
    ]);
  });
});
