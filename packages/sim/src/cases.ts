/**
 * Evaluation cases: one per kind of work, attribute combination, region and wording.
 *
 * Two wording sets. `dev` comes from the catalog and was used while the matcher was developed.
 * `blind` (blind/phrasings.json) was written from blind/BRIEF.md alone by someone who saw neither
 * the history wordings nor the matcher; its first result is kept in reports/blind/FIRST_RUN.json
 * and never rewritten.
 */
import { readFileSync } from "node:fs";

import { FAMILIES, type Family, type Region, truePrice } from "./catalog.ts";
import { mulberry32 } from "./rng.ts";

export type WordingSet = "dev" | "blind" | "regression-v1";

export interface Case {
  set: WordingSet;
  family: string;
  attrs: Record<string, string | number>;
  text: string;
  unit: string;
  region: Region;
  quarter: string;
  /** True market price in cents per written unit (what a good benchmark's median should be). */
  truthCents: number;
}

const comma = (n: number) => String(n).replace(".", ",");

/** How each attribute is written in the brief's placeholders (thicknesses in cm, with a comma). */
const PLACEHOLDER: Record<string, { name: string; write: (v: string | number) => string }> = {
  soil: { name: "soil", write: String },
  d: { name: "thickness", write: (v) => comma(Number(v) / 10) },
  c: { name: "concrete", write: String },
  len: { name: "length", write: (v) => (Number(v) === 2 ? "2,0" : comma(Number(v))) },
  sys: { name: "system", write: String },
  layers: { name: "layers", write: String },
  fmt: { name: "format", write: String },
  slip: { name: "slip", write: String },
  coats: { name: "coats", write: String },
  sec: { name: "section", write: String },
  dn: { name: "dn", write: String },
};

export function fill(template: string, attrs: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(attrs)) {
    const p = PLACEHOLDER[key];
    if (!p) throw new Error(`no placeholder for attribute ${key}`);
    out = out.replaceAll(`{${p.name}}`, p.write(value));
  }
  const left = out.match(/\{[a-z_]+\}/);
  if (left) throw new Error(`placeholder ${left[0]} left in "${template}"`);
  return out;
}

export function combinations(f: Family): Record<string, string | number>[] {
  let out: Record<string, string | number>[] = [{}];
  for (const a of f.attrs) out = out.flatMap((o) => a.values.map((v) => ({ ...o, [a.key]: v })));
  return out;
}

const WORDINGS: Record<Exclude<WordingSet, "dev">, URL> = {
  blind: new URL("../blind/phrasings.json", import.meta.url),
  // Blind set v1: its failures were studied (soil classes and more), so it is a regression set now.
  "regression-v1": new URL("../regression/blind-v1/phrasings.json", import.meta.url),
};

export function loadBlind(set: Exclude<WordingSet, "dev"> = "blind"): Record<string, string[]> {
  return JSON.parse(readFileSync(WORDINGS[set], "utf8")) as Record<string, string[]>;
}

export const EVAL_REGIONS: Region[] = ["BE", "BY", "SN", "NW"];
/** The platform's "now": the quarter after the last quarter of history. */
export const EVAL_QUARTER = "2026Q4";

export function cases(set: WordingSet, wordings?: Record<string, string[]>): Case[] {
  const blind = set === "dev" ? {} : (wordings ?? loadBlind(set));
  const r = mulberry32(2026);
  const out: Case[] = [];
  for (const f of FAMILIES) {
    for (const attrs of combinations(f)) {
      const texts = set === "dev" ? [f.dev(attrs, r)] : (blind[f.id] ?? []).map((t) => fill(t, attrs));
      for (const region of EVAL_REGIONS)
        for (const text of texts)
          out.push({
            set,
            family: f.id,
            attrs,
            text,
            unit: f.units[0]!,
            region,
            quarter: EVAL_QUARTER,
            truthCents: Math.round(truePrice(f, attrs, region, EVAL_QUARTER) * 100),
          });
    }
  }
  return out;
}
