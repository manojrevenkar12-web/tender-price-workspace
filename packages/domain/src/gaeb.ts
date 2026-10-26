/**
 * GAEB DA XML 3.x, the exchange format of German construction tendering: X83 is the bill of
 * quantities sent out with a tender, X84 is a bid that prices it.
 *
 * This reads and writes the subset a tendering platform needs: the BoQ breakdown (sections and
 * items with their ordinal numbers, "OZ"), short and long texts, quantities and units, optional
 * items (Eventualpositionen, no total), alternatives (grouped by ALNGroupNo) and lump sums, plus
 * unit prices and totals in X84. Formatting markup inside texts is flattened to plain text.
 */
import { XMLBuilder, XMLParser } from "fast-xml-parser";

import { type Cents, lineTotal, parseEuro } from "./money.ts";

export type PositionKind = "normal" | "optional" | "alternative" | "lump";

export interface BoqPosition {
  /** Full ordinal number, e.g. "01.02.0030". */
  oz: string;
  /** Labels of the enclosing sections, outermost first. */
  section: string[];
  shortText: string;
  longText: string;
  quantity: number;
  unit: string;
  kind: PositionKind;
  /** For alternatives: which base position group they belong to. */
  alternativeGroup?: string;
}

export interface Boq {
  name: string;
  dp: 83 | 84;
  positions: BoqPosition[];
  /** Only in X84: unit price per OZ. */
  prices?: Map<string, Cents>;
  bidder?: string;
}

export class GaebError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = "GaebError";
    this.path = path;
  }
}

const ARRAYS = new Set(["BoQCtgy", "Item", "p", "span", "BoQBkdn", "Itemlist", "image"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, unknown>;

function asNode(v: unknown): Node {
  return v && typeof v === "object" ? (v as Node) : {};
}

/** All text inside a GAEB rich-text element, paragraphs separated by newlines. */
function plain(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(plain).join("");
  const node = v as Node;
  const parts: string[] = [];
  for (const [k, child] of Object.entries(node)) {
    if (k.startsWith("@_")) continue;
    if (k === "p") {
      parts.push(
        (child as unknown[])
          .map(plain)
          .map((s) => s.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .join("\n"),
      );
    } else parts.push(plain(child));
  }
  return parts
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function quantity(raw: unknown, path: string): number {
  if (raw === undefined) return 0;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) throw new GaebError(`quantity "${String(raw)}" is not a number`, path);
  return n;
}

export function parseGaeb(xml: string): Boq {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    throw new GaebError(`not well-formed XML (${(e as Error).message})`, "/");
  }
  const gaeb = asNode(doc["GAEB"]);
  if (!doc["GAEB"]) throw new GaebError("no <GAEB> root element", "/");
  const award = asNode(gaeb["Award"]);
  const dpRaw = String(award["DP"] ?? "").trim();
  if (dpRaw !== "83" && dpRaw !== "84")
    throw new GaebError(`exchange phase DP ${dpRaw || "missing"}; expected 83 or 84`, "/GAEB/Award/DP");
  const dp = Number(dpRaw) as 83 | 84;
  const boq = asNode(award["BoQ"]);
  const info = asNode(boq["BoQInfo"]);
  const name = plain(info["Name"]) || plain(info["LblBoQ"]) || "BoQ";
  const positions: BoqPosition[] = [];
  const prices = new Map<string, Cents>();
  const seen = new Set<string>();

  const walk = (body: Node, ozPrefix: string[], labels: string[], path: string) => {
    for (const [i, ctgy] of ((body["BoQCtgy"] as Node[] | undefined) ?? []).entries()) {
      const part = String(ctgy["@_RNoPart"] ?? "").trim();
      if (!part) throw new GaebError("section without RNoPart", `${path}/BoQCtgy[${i}]`);
      walk(
        asNode(ctgy["BoQBody"]),
        [...ozPrefix, part],
        [...labels, plain(ctgy["LblTx"])],
        `${path}/BoQCtgy[${i}]`,
      );
    }
    for (const list of (body["Itemlist"] as Node[] | undefined) ?? []) {
      for (const [j, item] of ((list["Item"] as Node[] | undefined) ?? []).entries()) {
        const ipath = `${path}/Item[${j}]`;
        const part = String(item["@_RNoPart"] ?? "").trim();
        if (!part) throw new GaebError("item without RNoPart", ipath);
        const oz = [...ozPrefix, part].join(".");
        if (seen.has(oz)) throw new GaebError(`duplicate OZ ${oz}`, ipath);
        seen.add(oz);
        const complete = asNode(asNode(item["Description"])["CompleteText"]);
        const shortText = plain(asNode(complete["OutlineText"])["OutlTxt"]);
        const longText = plain(asNode(complete["DetailTxt"])["Text"]);
        const unit = plain(item["QU"]);
        const provis = String(item["Provis"] ?? "").trim();
        const lump =
          String(item["LumpSumItem"] ?? "")
            .trim()
            .toLowerCase() === "yes";
        const altGroup = item["ALNGroupNo"] !== undefined ? String(item["ALNGroupNo"]).trim() : undefined;
        const altSer = item["ALNSerNo"] !== undefined ? String(item["ALNSerNo"]).trim() : undefined;
        let kind: PositionKind = "normal";
        if (provis === "WithoutTotal" || provis === "WithTotal") kind = "optional";
        else if (altGroup && altSer && altSer !== "0") kind = "alternative";
        else if (lump) kind = "lump";
        positions.push({
          oz,
          section: labels,
          shortText: shortText || longText.split("\n")[0] || "",
          longText,
          quantity: lump ? 1 : quantity(item["Qty"], ipath),
          unit: lump ? "psch" : unit,
          kind,
          ...(altGroup ? { alternativeGroup: altGroup } : {}),
        });
        if (dp === 84 && item["UP"] !== undefined) {
          try {
            prices.set(oz, parseEuro(String(item["UP"])));
          } catch {
            throw new GaebError(`unit price "${String(item["UP"])}" is not an amount`, ipath);
          }
        }
      }
    }
  };
  walk(asNode(boq["BoQBody"]), [], [], "/GAEB/Award/BoQ/BoQBody");
  if (positions.length === 0) throw new GaebError("the bill of quantities has no items", "/GAEB/Award/BoQ");
  const bidder = plain(asNode(asNode(award["CTR"])["Address"])["Name1"]) || undefined;
  return { name, dp, positions, ...(dp === 84 ? { prices } : {}), ...(bidder ? { bidder } : {}) };
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressEmptyNode: true,
});

function richText(text: string) {
  return { p: text.split("\n").map((line) => ({ span: [line] })) };
}

/**
 * Writes an X83 (prices omitted) or X84 (with unit prices and totals). Sections are rebuilt from
 * the OZ: every OZ part but the last is a section.
 */
export function writeGaeb(boq: Boq): string {
  interface Ctgy {
    part: string;
    label: string;
    ctgys: Map<string, Ctgy>;
    items: BoqPosition[];
  }
  const root: Ctgy = { part: "", label: "", ctgys: new Map(), items: [] };
  for (const p of boq.positions) {
    const parts = p.oz.split(".");
    let node = root;
    parts.slice(0, -1).forEach((part, depth) => {
      let next = node.ctgys.get(part);
      if (!next) {
        next = { part, label: p.section[depth] ?? "", ctgys: new Map(), items: [] };
        node.ctgys.set(part, next);
      }
      node = next;
    });
    node.items.push(p);
  }
  const item = (p: BoqPosition) => {
    const part = p.oz.split(".").at(-1)!;
    const out: Record<string, unknown> = { "@_RNoPart": part };
    if (p.kind === "optional") out["Provis"] = "WithoutTotal";
    if (p.kind === "alternative" && p.alternativeGroup) {
      out["ALNGroupNo"] = p.alternativeGroup;
      out["ALNSerNo"] = "1";
    } else if (p.alternativeGroup) {
      out["ALNGroupNo"] = p.alternativeGroup;
      out["ALNSerNo"] = "0";
    }
    if (p.kind === "lump") out["LumpSumItem"] = "Yes";
    else {
      out["Qty"] = p.quantity.toFixed(3);
      out["QU"] = p.unit;
    }
    out["Description"] = {
      CompleteText: {
        DetailTxt: { Text: richText(p.longText) },
        OutlineText: { OutlTxt: { TextOutlTxt: richText(p.shortText) } },
      },
    };
    const price = boq.prices?.get(p.oz);
    if (boq.dp === 84 && price !== undefined) {
      out["UP"] = (price / 100).toFixed(2);
      if (p.kind !== "optional" && p.kind !== "alternative")
        out["IT"] = (lineTotal(price, p.quantity) / 100).toFixed(2);
    }
    return out;
  };
  const body = (node: Ctgy): Record<string, unknown> => ({
    ...(node.ctgys.size
      ? {
          BoQCtgy: [...node.ctgys.values()].map((c) => ({
            "@_RNoPart": c.part,
            LblTx: richText(c.label),
            BoQBody: body(c),
          })),
        }
      : {}),
    ...(node.items.length ? { Itemlist: { Item: node.items.map(item) } } : {}),
  });
  const depth = Math.max(...boq.positions.map((p) => p.oz.split(".").length));
  const doc = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    GAEB: {
      "@_xmlns": `http://www.gaeb.de/GAEB_DA_XML/DA${boq.dp}/3.3`,
      GAEBInfo: { Version: "3.3", ProgSystem: "tender-price-workspace" },
      Award: {
        DP: String(boq.dp),
        ...(boq.bidder ? { CTR: { Address: { Name1: boq.bidder } } } : {}),
        BoQ: {
          BoQInfo: {
            Name: boq.name,
            BoQBkdn: [
              ...Array.from({ length: depth - 1 }, () => ({ Type: "BoQLevel", Length: 2 })),
              { Type: "Item", Length: 4 },
            ],
          },
          BoQBody: body(root),
        },
      },
    },
  };
  return builder.build(doc) as string;
}
