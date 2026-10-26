/**
 * Demo companies, users, projects and tenders, created through the API's own services (as the
 * companies themselves, under row-level security), so the demo exercises the product's code.
 */
import { cents, type Cents } from "@tpw/domain";
import { bids, drain, tenders, withOrg } from "@tpw/api";
import type pg from "pg";

import { FAMILIES, type Family, type Region, type Trade, TRADES, truePrice } from "./catalog.ts";
import { intBetween, lognormal, mulberry32 } from "./rng.ts";

type PositionInput = tenders.PositionInput;

export interface DemoOrg {
  id: string;
  name: string;
  email: string;
  trades: Trade[];
  region: Region;
  level: number;
}

const SUBS: [string, Trade[], Region][] = [
  ["Havelland Betonbau GmbH", ["concrete", "earthworks"], "BB"],
  ["Spree Rohbau GmbH & Co. KG", ["concrete", "masonry"], "BE"],
  ["Lausitzer Massivbau GmbH", ["concrete", "masonry"], "SN"],
  ["Nordring Bau GmbH", ["concrete", "earthworks"], "BE"],
  ["Barnim Erdbau GmbH", ["earthworks"], "BB"],
  ["Kalkstein Mauerwerksbau GmbH", ["masonry"], "BE"],
  ["Ziegelwerk Bauservice GmbH", ["masonry", "screed_plaster"], "ST"],
  ["Trockenbau Teltow GmbH", ["drywall"], "BB"],
  ["Innenausbau Köpenick GmbH", ["drywall", "painting"], "BE"],
  ["Ständerwerk Ausbau GmbH", ["drywall"], "BE"],
  ["Estrich & Putz Ost GmbH", ["screed_plaster"], "BE"],
  ["Putzwerk Oberhavel GmbH", ["screed_plaster"], "BB"],
  ["Fliesen Lindner GmbH", ["tiling"], "BE"],
  ["Keramikverlegung Süd GmbH", ["tiling"], "SN"],
  ["Malerbetrieb Farbenfroh GmbH", ["painting"], "BE"],
  ["Malerwerkstatt Pankow GmbH", ["painting"], "BE"],
  ["Elektro Lichtenberg GmbH", ["electrical"], "BE"],
  ["Elektrotechnik Wedding GmbH", ["electrical"], "BE"],
  ["Haustechnik Spandau GmbH", ["plumbing", "electrical"], "BE"],
  ["Sanitär Marzahn GmbH", ["plumbing"], "BE"],
  ["Installationsbau Potsdam GmbH", ["plumbing"], "BB"],
  ["Ausbau Universal GmbH", ["drywall", "painting", "tiling", "screed_plaster"], "BE"],
  [
    "Generalausbau Mitte GmbH",
    ["drywall", "painting", "tiling", "screed_plaster", "electrical", "plumbing"],
    "BE",
  ],
  ["Rohbau Brandenburg GmbH", ["concrete", "masonry", "earthworks"], "BB"],
  ["Bauunternehmung Dahme GmbH", ["concrete", "masonry", "earthworks"], "BB"],
  ["Technik & Ausbau Ost GmbH", ["electrical", "plumbing", "drywall", "painting"], "SN"],
  [
    "Komplettbau Nordost GmbH",
    [
      "concrete",
      "masonry",
      "drywall",
      "screed_plaster",
      "tiling",
      "painting",
      "electrical",
      "plumbing",
      "earthworks",
    ],
    "MV",
  ],
  [
    "Allround Bau Zossen GmbH",
    [
      "concrete",
      "masonry",
      "drywall",
      "screed_plaster",
      "tiling",
      "painting",
      "electrical",
      "plumbing",
      "earthworks",
    ],
    "BB",
  ],
  [
    "Hauptstadt Ausbau GmbH",
    [
      "concrete",
      "masonry",
      "drywall",
      "screed_plaster",
      "tiling",
      "painting",
      "electrical",
      "plumbing",
      "earthworks",
    ],
    "BE",
  ],
  [
    "Gewerke Partner GmbH",
    [
      "concrete",
      "masonry",
      "drywall",
      "screed_plaster",
      "tiling",
      "painting",
      "electrical",
      "plumbing",
      "earthworks",
    ],
    "BE",
  ],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/gmbh.*$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * A bill of quantities from catalog families of the given trades. Each trade is a section; a
 * large BoQ repeats work per building part ("Bauteil A", "Bauteil B", ...), as hospital and
 * housing tenders do, with OZ trade.part.item.
 */
export function makeBoq(
  r: () => number,
  trades: Trade[],
  n: number,
  opts: { extras?: boolean } = {},
): (PositionInput & { family?: Family; attrs?: Record<string, string | number> })[] {
  const out: (PositionInput & { family?: Family; attrs?: Record<string, string | number> })[] = [];
  const perTrade = Math.ceil(n / trades.length);
  trades.forEach((trade, ti) => {
    const fams = FAMILIES.filter((f) => f.trade === trade);
    const combos = fams.flatMap((f) => {
      const keys = f.attrs.map((a) => a.values.map((v) => [a.key, v] as const));
      const product = keys.reduce<(readonly [string, string | number])[][]>(
        (acc, vs) => acc.flatMap((a) => vs.map((v) => [...a, v])),
        [[]],
      );
      return product.map((kv) => ({ f, attrs: Object.fromEntries(kv) as Record<string, string | number> }));
    });
    const parts = Math.ceil(perTrade / combos.length);
    let made = 0;
    for (let part = 0; part < parts && made < perTrade; part++) {
      const chosen = [...combos].sort(() => r() - 0.5).slice(0, Math.min(combos.length, perTrade - made));
      chosen.forEach(({ f, attrs }, k) => {
        if (out.length >= n) return;
        const sec = String(ti + 1).padStart(2, "0");
        const oz =
          parts > 1
            ? `${sec}.${String(part + 1).padStart(2, "0")}.${String((k + 1) * 10).padStart(4, "0")}`
            : `${sec}.${String((k + 1) * 10).padStart(4, "0")}`;
        out.push({
          oz,
          section: parts > 1 ? [TRADES[trade], `Bauteil ${String.fromCharCode(65 + part)}`] : [TRADES[trade]],
          shortText: f.history(attrs, r),
          longText: `${f.history(attrs, r)}. Ausführung nach DIN und Herstellervorgaben.`,
          unit: f.units[0]!,
          quantity: Math.round(intBetween(r, 5, 900) * (f.units[0] === "t" ? 0.05 : 1) * 1000) / 1000,
          family: f,
          attrs,
        });
        made++;
      });
    }
  });
  if (opts.extras) {
    out.unshift({
      oz: "00.0010",
      section: ["Allgemeines"],
      shortText: "Baustelleneinrichtung vorhalten und räumen",
      longText: "",
      unit: "psch",
      quantity: 1,
      kind: "lump",
    });
  }
  return out;
}

function priceFor(
  p: { family?: Family; attrs?: Record<string, string | number> | undefined; kind?: string | undefined },
  region: Region,
  quarter: string,
  level: number,
  r: () => number,
): Cents {
  if (!p.family || !p.attrs) return cents(Math.round(450_000 * level * lognormal(r, 0.2))); // lump sum
  const euro = truePrice(p.family, p.attrs, region, quarter) * level * lognormal(r, 0.07);
  return cents(Math.max(1, Math.round(euro * 100)));
}

export interface DemoResult {
  contractor: { id: string; email: string };
  otherContractor: { id: string; email: string };
  subs: DemoOrg[];
  tenders: Record<string, string>;
  roles: Record<string, string>;
  slipOz: string;
}

export async function loadDemo(
  admin: pg.Pool,
  app: pg.Pool,
  opts: { large: boolean } = { large: true },
): Promise<DemoResult> {
  const r = mulberry32(2026);
  await admin.query(
    "TRUNCATE events, bid_items, bids, invitations, position_benchmarks, boq_positions, boq_versions, tenders, projects, users, organizations, jobs RESTART IDENTITY CASCADE",
  );
  await admin.query("DELETE FROM price_points WHERE source_tender IS NOT NULL");
  await admin.query("DELETE FROM price_companies WHERE org_id IS NOT NULL");

  const org = async (
    name: string,
    kind: string,
    region: string,
    trades: string[],
    email: string,
    person: string,
  ) => {
    const o = await admin.query<{ id: string }>(
      "INSERT INTO organizations (name, kind, region, trades) VALUES ($1, $2, $3, $4) RETURNING id",
      [name, kind, region, trades],
    );
    await admin.query("INSERT INTO users (org_id, email, name) VALUES ($1, $2, $3)", [
      o.rows[0]!.id,
      email,
      person,
    ]);
    return o.rows[0]!.id;
  };
  const gc = await org(
    "Kranich Hochbau GmbH",
    "contractor",
    "BE",
    [],
    "anna.berger@kranich-hochbau.example",
    "Anna Berger",
  );
  await admin.query("INSERT INTO users (org_id, email, name) VALUES ($1, $2, $3)", [
    gc,
    "jonas.weber@kranich-hochbau.example",
    "Jonas Weber",
  ]);
  const other = await org(
    "Elbtal Projektbau GmbH",
    "contractor",
    "SN",
    [],
    "lea.schmidt@elbtal-projektbau.example",
    "Lea Schmidt",
  );
  const subs: DemoOrg[] = [];
  for (const [name, trades, region] of SUBS) {
    const email = `angebote@${slug(name)}.example`;
    const id = await org(name, "subcontractor", region, trades, email, `Kalkulation ${name.split(" ")[0]}`);
    subs.push({ id, name, email, trades, region, level: lognormal(r, 0.1) });
  }

  const project = async (name: string, city: string, region: Region) =>
    withOrg(
      app,
      gc,
      async (db) =>
        (
          await db.query<{ id: string }>(
            "INSERT INTO projects (org_id, name, city, region) VALUES ($1, $2, $3, $4) RETURNING id",
            [gc, name, city, region],
          )
        ).rows[0]!.id,
    );
  const spree = await project("Wohnquartier Spreebogen, Haus B", "Berlin", "BE");
  const kita = await project("Kita Am Fließ", "Potsdam", "BB");
  const klinik = await project("Klinikum Nord, Erweiterung", "Berlin", "BE");

  const now = Date.now();
  const days = (n: number) => new Date(now + n * 86_400_000).toISOString();
  const quarter = (iso: string) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
  const as = <T>(orgId: string, fn: (db: pg.PoolClient) => Promise<T>) => withOrg(app, orgId, fn);
  const ids: Record<string, string> = {};

  const tender = async (
    key: string,
    projectId: string,
    title: string,
    trade: string,
    boq: ReturnType<typeof makeBoq>,
  ) => {
    const id = await as(gc, (db) =>
      tenders.createTender(db, gc, {
        projectId,
        title,
        trade,
        positions: boq.map(({ family: _f, attrs: _a, ...p }) => p),
        source: "api",
      }),
    );
    ids[key] = id;
    return id;
  };

  const priceAll = async (
    s: DemoOrg,
    tenderId: string,
    boq: ReturnType<typeof makeBoq>,
    region: Region,
    q: string,
    tweak?: (oz: string, p: Cents) => Cents,
  ) => {
    const view = await as(s.id, (db) => bids.view(db, s.id, tenderId));
    const prices: Record<string, number> = {};
    for (const p of boq) {
      const price = priceFor(p, region, q, s.level, r);
      prices[p.oz] = tweak ? tweak(p.oz, price) : price;
    }
    const saved = await as(s.id, (db) =>
      bids.save(db, s.id, tenderId, { revision: view?.revision ?? 0, prices }),
    );
    return as(s.id, (db) => bids.submit(db, s.id, tenderId, saved.revision));
  };

  // 1. Rohbau Haus B: open, five bids, an addendum after three of them.
  const rohbau = makeBoq(r, ["earthworks", "concrete", "masonry"], 42, { extras: true });
  const t1 = await tender("rohbau", spree, "Rohbau Haus B", "concrete", rohbau);
  const d1 = days(12);
  await as(gc, (db) => tenders.publish(db, gc, t1, d1));
  const rohbauSubs = subs
    .filter((s) => s.trades.includes("concrete") || s.trades.includes("masonry"))
    .slice(0, 8);
  await as(gc, (db) =>
    tenders.invite(
      db,
      gc,
      t1,
      rohbauSubs.map((s) => s.id),
    ),
  );
  const q1 = quarter(d1);
  const slip = rohbau.find((p) => p.family?.id === "rebar") ?? rohbau[5]!;
  await priceAll(rohbauSubs[0]!, t1, rohbau, "BE", q1);
  await priceAll(rohbauSubs[1]!, t1, rohbau, "BE", q1, (oz, p) =>
    oz === slip.oz ? cents(Math.round(p / 10)) : p,
  ); // a decimal slip
  await priceAll(rohbauSubs[2]!, t1, rohbau, "BE", q1, (oz, p) =>
    oz === rohbau[8]!.oz ? cents(Math.round(p * 2.4)) : p,
  ); // a speculative price
  // Addendum: two quantities change, one text changes (the work is different), two positions are added.
  const v2 = rohbau.map((p, i) => {
    const { family: _f, attrs: _a, ...q } = p;
    if (i === 3 || i === 12) return { ...q, quantity: Math.round(q.quantity * 1.35 * 1000) / 1000 };
    if (i === 6)
      return {
        ...q,
        shortText: `${q.shortText}, Sichtbeton SB3`,
        longText: `${q.longText} Oberfläche Sichtbetonklasse SB3.`,
      };
    return q;
  });
  const added = makeBoq(mulberry32(99), ["concrete"], 2).map((p, i) => ({
    ...p,
    oz: `02.${String(9900 + i * 10).padStart(4, "0")}`,
  }));
  await as(gc, (db) =>
    tenders.addendum(
      db,
      gc,
      t1,
      [...v2, ...added.map(({ family: _f, attrs: _a, ...p }) => p)],
      "Nachtrag 1: Mengen Decke über EG angepasst, Sichtbeton SB3 an Wand Achse 4, zwei Positionen ergänzt",
    ),
  );
  const rohbau2 = [
    ...rohbau.map((p, i) => ({ ...p, quantity: v2[i]!.quantity, shortText: v2[i]!.shortText })),
    ...added,
  ];
  await priceAll(rohbauSubs[3]!, t1, rohbau2, "BE", q1);
  await priceAll(rohbauSubs[4]!, t1, rohbau2, "BE", q1);
  await as(rohbauSubs[5]!.id, (db) =>
    bids.decline(db, rohbauSubs[5]!.id, t1, "Keine Kapazität im Ausführungszeitraum"),
  );
  await as(rohbauSubs[6]!.id, (db) => bids.view(db, rohbauSubs[6]!.id, t1));

  const roles: Record<string, string> = {
    bidBeforeAddendum: rohbauSubs[0]!.email,
    bidAfterAddendum: rohbauSubs[3]!.email,
    viewedOnly: rohbauSubs[6]!.email,
  };

  // 2. Trockenbau Kita: open, one bid so far.
  const tb = makeBoq(r, ["drywall", "painting"], 18);
  const t2 = await tender("trockenbau", kita, "Trockenbau und Maler Kita", "drywall", tb);
  const d2 = days(20);
  await as(gc, (db) => tenders.publish(db, gc, t2, d2));
  const tbSubs = subs.filter((s) => s.trades.includes("drywall")).slice(0, 4);
  await as(gc, (db) =>
    tenders.invite(
      db,
      gc,
      t2,
      tbSubs.map((s) => s.id),
    ),
  );
  await priceAll(tbSubs[0]!, t2, tb, "BB", quarter(d2));
  roles["invitedNotStarted"] = tbSubs.find((s) => !rohbauSubs.includes(s))?.email ?? tbSubs[1]!.email;

  // 3. Fliesen Haus B: a draft.
  await tender("fliesen", spree, "Fliesenarbeiten Haus B", "tiling", makeBoq(r, ["tiling"], 12));

  // 4. Elektro Haus B: awarded; its prices join the history.
  const el = makeBoq(r, ["electrical"], 10);
  const t4 = await tender("elektro", spree, "Elektroinstallation Haus B", "electrical", el);
  await as(gc, (db) => tenders.publish(db, gc, t4, days(3)));
  const elSubs = subs.filter((s) => s.trades.includes("electrical")).slice(0, 5);
  await as(gc, (db) =>
    tenders.invite(
      db,
      gc,
      t4,
      elSubs.map((s) => s.id),
    ),
  );
  for (const s of elSubs) await priceAll(s, t4, el, "BE", quarter(days(3)));
  const cheapest = await as(
    gc,
    async (db) =>
      (
        await db.query<{ id: string }>(
          "SELECT b.id FROM bids b JOIN bid_items i ON i.bid_id = b.id WHERE b.tender_id = $1 GROUP BY b.id ORDER BY sum(i.unit_price_cents) LIMIT 1",
          [t4],
        )
      ).rows[0]!.id,
  );
  await as(gc, (db) => tenders.award(db, gc, t4, cheapest));

  // 5. Klinikum Nord: the large one (2,000 positions, 25 bids) for the comparison grid.
  if (opts.large) {
    const all: Trade[] = [
      "earthworks",
      "concrete",
      "masonry",
      "drywall",
      "screed_plaster",
      "tiling",
      "painting",
      "electrical",
      "plumbing",
    ];
    const big = makeBoq(r, all, 2_000);
    const t5 = await tender("klinikum", klinik, "Klinikum Nord, Rohbau und Ausbau", "general", big);
    const d5 = days(30);
    await as(gc, (db) => tenders.publish(db, gc, t5, d5));
    const bigSubs = subs.slice(0, 25);
    await as(gc, (db) =>
      tenders.invite(
        db,
        gc,
        t5,
        bigSubs.map((s) => s.id),
      ),
    );
    for (const [i, s] of bigSubs.entries()) {
      await priceAll(s, t5, big, "BE", quarter(d5), (oz, p) =>
        i === 7 && oz.endsWith("0100") ? cents(p * 10) : p,
      );
    }
  }

  await drain(app);
  return {
    contractor: { id: gc, email: "anna.berger@kranich-hochbau.example" },
    otherContractor: { id: other, email: "lea.schmidt@elbtal-projektbau.example" },
    subs,
    tenders: ids,
    /** Who to sign in as to see each state (the browser tests read this). */
    roles,
    slipOz: slip.oz,
  };
}
