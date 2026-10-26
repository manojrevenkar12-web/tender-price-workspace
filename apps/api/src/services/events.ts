/**
 * Live tender activity over server-sent events.
 *
 * One LISTEN connection per API process receives a notification for every new event row (the
 * trigger in 001). For each subscriber of that tender the row is read again inside the
 * subscriber's own organisation context, so row-level security, not this code, decides whether a
 * bidder may see that a competitor submitted. Subscribers that fall behind are dropped and
 * resume with Last-Event-ID.
 */
import type pg from "pg";

import { withOrg } from "../db.ts";

export interface EventRow {
  id: number;
  tender_id: string;
  actor_org: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
  at: Date;
}

export interface Subscriber {
  orgId: string;
  tenderId: string;
  send: (e: EventRow) => void;
}

const SELECT = `SELECT e.id, e.tender_id, e.actor_org, o.name AS actor, e.kind, e.payload, e.at
                  FROM events e JOIN organizations o ON o.id = e.actor_org`;

export async function eventsSince(
  pool: pg.Pool,
  orgId: string,
  tenderId: string,
  afterId: number,
  limit = 200,
): Promise<EventRow[]> {
  return withOrg(pool, orgId, async (db) => {
    const r = await db.query<EventRow>(
      `${SELECT} WHERE e.tender_id = $1 AND e.id > $2 ORDER BY e.id LIMIT $3`,
      [tenderId, afterId, limit],
    );
    return r.rows;
  });
}

export class EventHub {
  private subs = new Set<Subscriber>();
  private client: pg.PoolClient | null = null;
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async start(): Promise<void> {
    this.client = await this.pool.connect();
    this.client.on("notification", (msg) => {
      if (msg.channel !== "tender_events" || !msg.payload) return;
      const { tender_id, id } = JSON.parse(msg.payload) as { tender_id: string; id: number };
      void this.dispatch(tender_id, id);
    });
    await this.client.query("LISTEN tender_events");
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    await this.client.query("UNLISTEN *").catch(() => undefined);
    this.client.release();
    this.client = null;
  }

  subscribe(s: Subscriber): () => void {
    this.subs.add(s);
    return () => this.subs.delete(s);
  }

  get size(): number {
    return this.subs.size;
  }

  private async dispatch(tenderId: string, id: number): Promise<void> {
    const byOrg = new Map<string, Subscriber[]>();
    for (const s of this.subs)
      if (s.tenderId === tenderId) byOrg.set(s.orgId, [...(byOrg.get(s.orgId) ?? []), s]);
    for (const [orgId, subs] of byOrg) {
      const rows = await withOrg(this.pool, orgId, (db) =>
        db.query<EventRow>(`${SELECT} WHERE e.id = $1`, [id]),
      ).then((r) => r.rows);
      for (const row of rows) for (const s of subs) s.send(row);
    }
  }
}
