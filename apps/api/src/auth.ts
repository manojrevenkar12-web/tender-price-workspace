/**
 * Session tokens: HMAC-signed, short-lived, carrying the user and organisation.
 *
 * Users sign in with a password (scrypt). A demo deployment (DEMO_MODE=true) also lets the seeded
 * users in by e-mail alone so a reviewer can switch roles in one click; that path is refused
 * everywhere else. Single sign-on (SAML / OIDC) would sit in front and issue the same token, with
 * the same row-level security behind it.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface Session {
  userId: string;
  orgId: string;
  kind: "contractor" | "subcontractor";
  name: string;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function sign(s: Session, secret: string): string {
  const body = b64(JSON.stringify(s));
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verify(token: string, secret: string, now = Date.now()): Session | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function checkPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    ...SCRYPT,
    N: Number(n),
  });
  return timingSafeEqual(given, expected);
}

/** A stored hash to compare against when the user does not exist, so both cases take as long. */
export const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));
