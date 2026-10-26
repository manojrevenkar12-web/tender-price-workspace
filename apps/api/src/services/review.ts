/**
 * Position review: what a bidder will have to guess because the text does not say it.
 *
 * Rules find the gaps (a concrete wall without a strength class or thickness, tiles without a
 * format, a pipe without a nominal diameter); they are deterministic and tested. An optional
 * language model only rewrites a long text in plain words for the buyer, and is never asked to
 * decide anything; without an API key the feature is simply off.
 */
import { normalise, parseUnit } from "@tpw/domain";

export interface Finding {
  code: string;
  message: string;
}

const has = (words: string[], ...stems: string[]) => words.some((w) => stems.some((s) => w.startsWith(s)));

export function reviewPosition(p: {
  shortText: string;
  longText: string;
  unit: string;
  quantity: number;
  kind: string;
}): Finding[] {
  const n = normalise(`${p.shortText}\n${p.longText}`);
  const w = n.words;
  const a = n.attributes;
  const out: Finding[] = [];
  const unit = parseUnit(p.unit);
  if (!unit)
    out.push({ code: "unknown_unit", message: `Unit "${p.unit}" is not a unit bidders can price against.` });
  if (p.kind === "normal" && p.quantity === 0)
    out.push({ code: "zero_quantity", message: "Quantity is 0: the position will not count in any total." });
  if (unit?.dimension === "lump")
    out.push({
      code: "lump_sum",
      message: "Lump sum: no market comparison is possible; describe the scope precisely.",
    });
  const concrete = has(w, "stahlbeton", "beton") && !has(w, "betonstahl", "fertigteil");
  if (concrete && !a["concrete"])
    out.push({
      code: "missing_concrete_class",
      message: "Concrete strength class (e.g. C30/37) is not stated.",
    });
  if ((concrete && has(w, "wand", "deck")) || has(w, "mauerwerk", "estrich")) {
    if (!a["thickness_mm"])
      out.push({
        code: "missing_thickness",
        message: "Thickness is not stated; it drives the price per m².",
      });
  }
  if (has(w, "flies")) {
    if (!a["format_cm"]) out.push({ code: "missing_format", message: "Tile format is not stated." });
    if (has(w, "boden") && !a["slip"])
      out.push({
        code: "missing_slip_class",
        message: "Slip resistance class (R9-R13) is not stated for a floor.",
      });
  }
  if (has(w, "rohr", "leitung") && !has(w, "kabel") && !a["dn"])
    out.push({ code: "missing_dn", message: "Nominal diameter (DN) is not stated." });
  if (has(w, "kabel", "nym") && !a["section"])
    out.push({
      code: "missing_cross_section",
      message: "Cable cross-section (e.g. 3x1,5 mm²) is not stated.",
    });
  if (has(w, "trockenbau", "gipskarton") && has(w, "wand") && !a["system"])
    out.push({ code: "missing_system", message: "Drywall system (e.g. W112) is not stated." });
  return out;
}

export interface Explainer {
  explain(text: string): Promise<string>;
}

/** Plain-language summary of a long text via the Anthropic Messages API (optional). */
export function anthropicExplainer(
  apiKey: string,
  model = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-5-5",
): Explainer {
  return {
    async explain(text) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system:
            "You explain German construction bill-of-quantities texts to a buyer in plain English, in at most three sentences. " +
            "Describe only what the text says. Do not estimate prices and do not add requirements.",
          messages: [{ role: "user", content: text }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`model call failed: ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (body.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
    },
  };
}
