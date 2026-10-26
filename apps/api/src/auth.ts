/**
 * Session tokens: HMAC-signed, short-lived, carrying the user and organisation. Sign-in here is a
 * demo sign-in by e-mail for the seeded users; production would put SSO (SAML / OIDC) in front
 * and keep the same token and the same row-level security behind it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

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
