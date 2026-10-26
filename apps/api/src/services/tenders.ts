/**
 * Tenders and their bills of quantities: create (from GAEB or JSON), publish, invite, addenda,
 * close and award. All functions take a transaction that already carries the caller's
 * organisation (db.withOrg); row-level security decides what exists for them.
 */
import {
  type BoqPosition,
  diffVersions,
  normalisePosition,
  parseUnit,
  type VersionedPosition,
  workHash,
} from "@tpw/domain";

import type { Db } from "../db.ts";
import { baseUnit } from "./pricing.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

export interface PositionInput {
  oz: string;
  section?: string[] | undefined;
  shortText: string;
  longText?: string | undefined;
  unit: string;
  quantity: number;
  kind?: BoqPosition["kind"] | undefined;
  alternativeGroup?: string | undefined;
}

export interface PositionRow extends VersionedPosition {
  ordinal: number;
  section: string[];
  unitCode: string | null;
  alternativeGroup: string | null;
}

function checkPositions(positions: readonly PositionInput[]): void {
  if (positions.length === 0)
    throw new HttpError(422, "empty_boq", "a bill of quantities needs at least one position");
  const seen = new Set<string>();
  for (const p of positions) {
    if (!/^[0-9A-Za-z]+(\.[0-9A-Za-z]+)*$/.test(p.oz))
      throw new HttpError(422, "invalid_oz", `OZ "${p.oz}" is not an ordinal number`);
    if (seen.has(p.oz)) throw new HttpError(422, "duplicate_oz", `OZ ${p.oz} appears twice`);
    seen.add(p.oz);
    if (!(p.quantity >= 0))
      throw new HttpError(422, "invalid_quantity", `OZ ${p.oz}: quantity must be zero or more`);
  }
}

export async function insertVersion(
  db: Db,
  tenderId: string,
  version: number,
  positions: readonly PositionInput[],
  source: "gaeb" | "api" | "addendum",
  note = "",
): Promise<void> {
  checkPositions(positions);
  await db.query("INSERT INTO boq_versions (tender_id, version, note, source) VALUES ($1, $2, $3, $4)", [
    tenderId,
    version,
    note,
    source,
  ]);
  const cols = {
    oz: [] as string[],
    ord: [] as number[],
    section: [] as string[],
    short: [] as string[],
    long: [] as string[],
    unit: [] as string[],
    code: [] as (string | null)[],
    qty: [] as number[],
    kind: [] as string[],
    alt: [] as (string | null)[],
    hash: [] as string[],
    words: [] as string[],
    attrs: [] as string[],
  };
  positions.forEach((p, i) => {
    const kind = p.kind ?? "normal";
    const unit = parseUnit(p.unit);
    const n = normalisePosition(p.shortText, p.longText ?? "");
    cols.oz.push(p.oz);
    cols.ord.push(i + 1);
    cols.section.push(JSON.stringify(p.section ?? []));
    cols.short.push(p.shortText);
    cols.long.push(p.longText ?? "");
    cols.unit.push(p.unit);
    cols.code.push(unit ? baseUnit(unit).code : null);
    cols.qty.push(p.quantity);
    cols.kind.push(kind);
    cols.alt.push(p.alternativeGroup ?? null);
    cols.hash.push(workHash({ shortText: p.shortText, longText: p.longText ?? "", unit: p.unit, kind }));
    cols.words.push(n.words.join(" "));
    cols.attrs.push(JSON.stringify(n.attributes));
  });
  await db.query(
    `INSERT INTO boq_positions (tender_id, version, oz, ordinal, section, short_text, long_text, unit, unit_code, quantity, kind,
                                alternative_group, work_hash, norm_words, attributes)
     SELECT $1, $2, oz, ord, ARRAY(SELECT jsonb_array_elements_text(sec::jsonb)), st, lt, u, uc, q, k, alt, h, w, a::jsonb
       FROM unnest($3::text[], $4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::numeric[], $11::text[],
                   $12::text[], $13::text[], $14::text[], $15::text[]) AS x(oz, ord, sec, st, lt, u, uc, q, k, alt, h, w, a)`,
    [
      tenderId,
      version,
      cols.oz,
      cols.ord,
      cols.section,
      cols.short,
      cols.long,
      cols.unit,
      cols.code,
      cols.qty,
      cols.kind,
      cols.alt,
      cols.hash,
      cols.words,
      cols.attrs,
    ],
  );
  await db.query("INSERT INTO jobs (kind, payload) VALUES ('benchmark_version', $1)", [
    JSON.stringify({ tenderId, version }),
  ]);
}

export async function event(
  db: Db,
  tenderId: string,
  actorOrg: string,
  kind: string,
  payload: object,
  isPublic = false,
): Promise<void> {
  await db.query(
    "INSERT INTO events (tender_id, actor_org, kind, payload, public) VALUES ($1, $2, $3, $4, $5)",
    [tenderId, actorOrg, kind, JSON.stringify(payload), isPublic],
  );
}

export interface CreateTender {
  projectId: string;
  title: string;
  trade: string;
  deadline?: string | undefined;
  positions: PositionInput[];
  source: "gaeb" | "api";
}

export async function createTender(db: Db, orgId: string, input: CreateTender): Promise<string> {
  const p = await db.query("SELECT 1 FROM projects WHERE id = $1 AND org_id = $2", [input.projectId, orgId]);
  if (!p.rowCount) throw notFound("project");
  const t = await db.query<{ id: string }>(
    "INSERT INTO tenders (org_id, project_id, title, trade, deadline) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [orgId, input.projectId, input.title, input.trade, input.deadline ?? null],
  );
  const id = t.rows[0]!.id;
  await insertVersion(db, id, 1, input.positions, input.source);
  await event(db, id, orgId, "tender_created", { title: input.title, positions: input.positions.length });
  return id;
}

export interface TenderRow {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  trade: string;
  status: "draft" | "open" | "closed" | "awarded";
  deadline: Date | null;
  current_version: number;
  awarded_bid_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getTender(db: Db, id: string): Promise<TenderRow> {
  const r = await db.query<TenderRow>("SELECT * FROM tenders WHERE id = $1", [id]);
  if (!r.rows[0]) throw notFound("tender");
  return r.rows[0];
}

export async function ownTender(db: Db, orgId: string, id: string): Promise<TenderRow> {
  const t = await getTender(db, id);
  if (t.org_id !== orgId) throw new HttpError(403, "not_owner", "only the tendering company can do this");
  return t;
}

export async function positions(db: Db, tenderId: string, version: number): Promise<PositionRow[]> {
  const r = await db.query(
    `SELECT oz, ordinal, section, short_text, long_text, unit, unit_code, quantity, kind, alternative_group
       FROM boq_positions WHERE tender_id = $1 AND version = $2 ORDER BY ordinal`,
    [tenderId, version],
  );
  return r.rows.map((x) => ({
    oz: x.oz,
    ordinal: x.ordinal,
    section: x.section,
    shortText: x.short_text,
    longText: x.long_text,
    unit: x.unit,
    unitCode: x.unit_code,
    quantity: Number(x.quantity),
    kind: x.kind,
    alternativeGroup: x.alternative_group,
  }));
}

export async function publish(db: Db, orgId: string, tenderId: string, deadline: string): Promise<void> {
  const t = await ownTender(db, orgId, tenderId);
  if (t.status !== "draft") throw new HttpError(409, "not_draft", `tender is ${t.status}`);
  if (new Date(deadline).getTime() <= Date.now())
    throw new HttpError(422, "deadline_past", "the deadline must be in the future");
  await db.query("UPDATE tenders SET status = 'open', deadline = $2, updated_at = now() WHERE id = $1", [
    tenderId,
    deadline,
  ]);
  await event(db, tenderId, orgId, "tender_published", { deadline }, true);
}

export async function invite(db: Db, orgId: string, tenderId: string, orgIds: string[]): Promise<number> {
  const t = await ownTender(db, orgId, tenderId);
  if (t.status === "closed" || t.status === "awarded")
    throw new HttpError(409, "tender_closed", "the tender is closed");
  const subs = await db.query<{ id: string }>(
    "SELECT id FROM organizations WHERE id = ANY($1::uuid[]) AND kind = 'subcontractor'",
    [orgIds],
  );
  if (subs.rowCount !== new Set(orgIds).size)
    throw new HttpError(422, "not_subcontractor", "every invitee must be a subcontractor");
  const r = await db.query(
    "INSERT INTO invitations (tender_id, org_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING",
    [tenderId, orgIds],
  );
  if (r.rowCount) await event(db, tenderId, orgId, "invited", { count: r.rowCount });
  return r.rowCount ?? 0;
}

export interface AddendumResult {
  version: number;
  changes: ReturnType<typeof diffVersions>;
  biddersAffected: number;
}

/**
 * Publishes a new version of the BoQ. Bidders are told what changed; bids on the old version
 * stay as they are, and the comparison says which of their prices still stand.
 */
export async function addendum(
  db: Db,
  orgId: string,
  tenderId: string,
  next: PositionInput[],
  note: string,
): Promise<AddendumResult> {
  const t = await ownTender(db, orgId, tenderId);
  if (t.status === "closed" || t.status === "awarded")
    throw new HttpError(409, "tender_closed", "the tender is closed");
  const before = await positions(db, tenderId, t.current_version);
  const version = t.current_version + 1;
  const after = next.map((p) => ({ ...p, longText: p.longText ?? "", kind: p.kind ?? "normal" }));
  const changes = diffVersions(before, after);
  if (changes.length === 0)
    throw new HttpError(422, "no_changes", "the new version is identical to the current one");
  await insertVersion(db, tenderId, version, next, "addendum", note);
  await db.query("UPDATE tenders SET current_version = $2, updated_at = now() WHERE id = $1", [
    tenderId,
    version,
  ]);
  const affected = await db.query(
    "SELECT count(*)::int AS n FROM bids WHERE tender_id = $1 AND status = 'submitted'",
    [tenderId],
  );
  await event(db, tenderId, orgId, "addendum_published", { version, note, changes: changes.length }, true);
  return { version, changes, biddersAffected: affected.rows[0].n };
}

export async function versionDiff(db: Db, tenderId: string, from: number, to: number) {
  return diffVersions(await positions(db, tenderId, from), await positions(db, tenderId, to));
}

export async function award(db: Db, orgId: string, tenderId: string, bidId: string): Promise<void> {
  const t = await ownTender(db, orgId, tenderId);
  if (t.status === "awarded") throw new HttpError(409, "already_awarded", "the tender is already awarded");
  if (t.status === "draft") throw new HttpError(409, "not_published", "a draft cannot be awarded");
  const b = await db.query<{ status: string }>("SELECT status FROM bids WHERE id = $1 AND tender_id = $2", [
    bidId,
    tenderId,
  ]);
  if (b.rows[0]?.status !== "submitted")
    throw new HttpError(422, "bid_not_submitted", "only a submitted bid can be awarded");
  await db.query(
    "UPDATE tenders SET status = 'awarded', awarded_bid_id = $2, updated_at = now() WHERE id = $1",
    [tenderId, bidId],
  );
  await event(db, tenderId, orgId, "awarded", { bidId }, true);
  // Every submitted bid's prices join the price history (pseudonymised), in the worker.
  await db.query("INSERT INTO jobs (kind, payload) VALUES ('contribute_prices', $1)", [
    JSON.stringify({ tenderId }),
  ]);
}

export async function close(db: Db, orgId: string, tenderId: string): Promise<void> {
  const t = await ownTender(db, orgId, tenderId);
  if (t.status !== "open") throw new HttpError(409, "not_open", `tender is ${t.status}`);
  await db.query("UPDATE tenders SET status = 'closed', updated_at = now() WHERE id = $1", [tenderId]);
  await event(db, tenderId, orgId, "tender_closed", {}, true);
}

export interface TenderSummary {
  id: string;
  title: string;
  trade: string;
  status: string;
  deadline: string | null;
  project: string;
  city: string;
  positions: number;
  version: number;
  invited: number;
  submitted: number;
  role: "buyer" | "bidder";
  myBid: string | null;
  updatedAt: string;
}

export async function list(db: Db, orgId: string): Promise<TenderSummary[]> {
  const r = await db.query(
    `SELECT t.id, t.title, t.trade, t.status, t.deadline, p.name AS project, p.city, t.current_version AS version, t.updated_at,
            (SELECT count(*)::int FROM boq_positions b WHERE b.tender_id = t.id AND b.version = t.current_version) AS positions,
            (SELECT count(*)::int FROM invitations i WHERE i.tender_id = t.id) AS invited,
            (SELECT count(*)::int FROM invitations i WHERE i.tender_id = t.id AND i.status = 'submitted') AS submitted,
            t.org_id = $1 AS mine,
            (SELECT x.status FROM bids x WHERE x.tender_id = t.id AND x.org_id = $1) AS my_bid
       FROM tenders t JOIN projects p ON p.id = t.project_id
      ORDER BY t.updated_at DESC`,
    [orgId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    title: x.title,
    trade: x.trade,
    status: x.status,
    deadline: x.deadline?.toISOString() ?? null,
    project: x.project,
    city: x.city,
    positions: x.positions,
    version: x.version,
    invited: x.mine ? x.invited : 0,
    submitted: x.mine ? x.submitted : 0,
    role: x.mine ? "buyer" : "bidder",
    myBid: x.my_bid,
    updatedAt: x.updated_at.toISOString(),
  }));
}
