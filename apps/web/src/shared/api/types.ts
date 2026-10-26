/** Shapes the API returns (see apps/api/src/app.ts). */
import type { Change, Comparison, PositionKind } from "@tpw/domain";

export type Role = "contractor" | "subcontractor";

export interface User {
  id: string;
  name: string;
  email: string;
  org: string;
  orgId: string;
  kind: Role;
}

export type TenderStatus = "draft" | "open" | "closed" | "awarded";

export interface TenderSummary {
  id: string;
  title: string;
  trade: string;
  status: TenderStatus;
  deadline: string | null;
  project: string;
  city: string;
  positions: number;
  version: number;
  invited: number;
  submitted: number;
  role: "buyer" | "bidder";
  myBid: "draft" | "submitted" | "withdrawn" | null;
  updatedAt: string;
}

export interface Position {
  oz: string;
  ordinal: number;
  section: string[];
  shortText: string;
  longText: string;
  unit: string;
  unitCode: string | null;
  quantity: number;
  kind: PositionKind;
  alternativeGroup: string | null;
}

export interface Invitation {
  orgId: string;
  name: string;
  region: string;
  status: "invited" | "viewed" | "declined" | "submitted";
  updatedAt: string;
}

export interface TenderDetail {
  id: string;
  title: string;
  trade: string;
  status: TenderStatus;
  deadline: string | null;
  version: number;
  awardedBidId: string | null;
  role: "buyer" | "bidder";
  project: { name: string; city: string; region: string };
  versions: { version: number; note: string; source: string; created_at: string }[];
  positions: Position[];
  invitations: Invitation[];
}

export interface ComparisonView extends Comparison {
  tenderId: string;
  version: number;
  benchmarks: { ready: number; total: number };
  marketStatus: Record<string, { status: string; reason: string | null; companies: number }>;
}

export interface Activity {
  id: number;
  kind: string;
  actor: string;
  actorOrg: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface Bid {
  id: string;
  tenderId: string;
  status: "draft" | "submitted" | "withdrawn";
  version: number;
  currentVersion: number;
  revision: number;
  submittedAt: string | null;
  prices: Record<string, number>;
}

export interface Market {
  status: "ok" | "suppressed" | "not_comparable";
  reason?: string;
  p10?: number;
  p25?: number;
  p50?: number;
  p75?: number;
  p90?: number;
  points: number;
  companies: number;
  signatures: number;
  matches: { text: string; similarity: number; weight: number }[];
}

export interface Organization {
  id: string;
  name: string;
  region: string;
  trades: string[];
}

export type { Change };
