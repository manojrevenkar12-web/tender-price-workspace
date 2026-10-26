import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.ts";
import { checkPassword, hashPassword, sign, verify } from "../src/auth.ts";
import { type Ctx, reset, start, stop } from "./helpers.ts";

describe("passwords and tokens", () => {
  it("hashes with a fresh salt and checks in constant time", () => {
    const a = hashPassword("correct horse");
    expect(a).not.toBe(hashPassword("correct horse"));
    expect(checkPassword("correct horse", a)).toBe(true);
    expect(checkPassword("correct hors", a)).toBe(false);
    expect(checkPassword("x", "plain")).toBe(false);
  });

  it("refuses tampered and expired tokens", () => {
    const s = { userId: "u", orgId: "o", kind: "contractor" as const, name: "A", exp: 2_000 };
    const t = sign(s, "k");
    expect(verify(t, "k", 1_000)).toEqual(s);
    expect(verify(t, "k", 3_000)).toBeNull();
    expect(verify(t, "other", 1_000)).toBeNull();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, orgId: "victim" })).toString("base64url");
    expect(verify(`${forged}.${mac}`, "k", 1_000)).toBeNull();
    expect(body).toBeTruthy();
  });
});

describe("sign-in outside a demo deployment", () => {
  let c: Ctx;
  let prod: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    c = await start();
    prod = await buildApp({
      pool: c.pool,
      config: { tokenSecret: "s", corsOrigin: "x", demoMode: false, metricsToken: "scrape" },
    });
  });
  afterAll(async () => {
    await prod.close();
    await stop(c);
  });
  beforeEach(async () => {
    await reset(c);
    const o = await c.admin.query<{ id: string }>(
      "INSERT INTO organizations (name, kind, region, trades) VALUES ('A GmbH', 'contractor', 'BE', '{}') RETURNING id",
    );
    await c.admin.query(
      "INSERT INTO users (org_id, email, name, password_hash) VALUES ($1, 'a@a.example', 'A', $2)",
      [o.rows[0]!.id, hashPassword("s3cret-enough")],
    );
    await c.admin.query("INSERT INTO users (org_id, email, name) VALUES ($1, 'sso@a.example', 'B')", [
      o.rows[0]!.id,
    ]);
  });

  const signIn = (payload: object) => prod.inject({ method: "POST", url: "/api/session", payload });

  it("needs the right password", async () => {
    expect((await signIn({ email: "A@a.example", password: "s3cret-enough" })).statusCode).toBe(200);
    const wrong = await signIn({ email: "a@a.example", password: "nope" });
    const unknown = await signIn({ email: "zz@a.example", password: "nope" });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json()); // does not reveal which e-mails exist
  });

  it("does not let anyone in by e-mail alone", async () => {
    expect((await signIn({ email: "a@a.example" })).statusCode).toBe(401);
    expect((await signIn({ email: "sso@a.example" })).statusCode).toBe(401);
    expect((await signIn({ email: "sso@a.example", password: "" })).statusCode).toBe(401);
    expect((await prod.inject({ url: "/api/demo-users" })).statusCode).toBe(404);
  });

  it("keeps metrics behind the scrape token", async () => {
    expect((await prod.inject({ url: "/api/metrics" })).statusCode).toBe(401);
    const ok = await prod.inject({ url: "/api/metrics", headers: { authorization: "Bearer scrape" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("tpw_http_requests_total");
  });
});
