import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { type FormEvent, useState } from "react";

import { api } from "../../shared/api/client";
import type { Market } from "../../shared/api/types";
import { formatCents } from "../../shared/lib/format";
import { motion as m } from "../../shared/theme/tokens";
import { Button, EmptyState, ErrorState, PageHeader, Panel, SkeletonRows } from "../../shared/ui";
import { PriceStrip } from "../comparison/PriceStrip";
import styles from "./PriceCheckPage.module.css";

const REGIONS = [
  "BW",
  "BY",
  "BE",
  "BB",
  "HB",
  "HH",
  "HE",
  "MV",
  "NI",
  "NW",
  "RP",
  "SL",
  "SN",
  "ST",
  "SH",
  "TH",
];
const EXAMPLES = [
  { text: "Stahlbetonwand C30/37, d=24 cm", unit: "m²" },
  { text: "Betonstahl B500B liefern und verlegen", unit: "t" },
  { text: "Bodenfliesen Feinsteinzeug 60x60 cm, R10", unit: "m²" },
  { text: "Kabel NYM-J 5x2,5 mm²", unit: "m" },
];
const REASON: Record<string, string> = {
  no_data:
    "Nothing comparable in the price history for this wording and unit. Try the wording a bill of quantities would use.",
  too_few_companies:
    "Fewer than five companies priced comparable work, so the range is withheld: it would reveal their prices.",
  dominated: "One company supplied most comparable prices, so the range is withheld.",
  too_few_points: "Too few comparable prices for a reliable range.",
  lump_sum: "Lump sums have no price per unit.",
  unknown_unit: "That unit is not one the price history knows (try m, m², m³, St, kg, t).",
};

interface Query {
  text: string;
  unit: string;
  region: string;
}

export function PriceCheckPage() {
  const [form, setForm] = useState<Query>({ text: EXAMPLES[0]!.text, unit: EXAMPLES[0]!.unit, region: "BE" });
  const [asked, setAsked] = useState<Query | null>(null);
  const q = useQuery({
    queryKey: ["price-check", asked],
    queryFn: () =>
      api.get<Market>(
        `/api/price-check?text=${encodeURIComponent(asked!.text)}&unit=${encodeURIComponent(asked!.unit)}&region=${asked!.region}`,
      ),
    enabled: asked !== null,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAsked({ ...form });
  };

  return (
    <>
      <PageHeader
        title="Price check"
        sub="What a position costs today, from comparable historical bids, before you send it out."
      />
      <div className={styles.layout}>
        <Panel title="Position" id="pc-position">
          <form className={styles.form} onSubmit={submit}>
            <label className={styles.field}>
              Short text
              <textarea
                className={`${styles.input} ${styles.text}`}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                required
                minLength={2}
              />
            </label>
            <div className={styles.row}>
              <label className={styles.field}>
                Unit
                <input
                  className={styles.input}
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  required
                />
              </label>
              <label className={styles.field}>
                Region
                <select
                  className={styles.input}
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                >
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            <Button type="submit" variant="primary" busy={q.isFetching}>
              Check price
            </Button>
            <div className={styles.examples}>
              {EXAMPLES.map((x) => (
                <button
                  key={x.text}
                  type="button"
                  className={styles.example}
                  onClick={() => setForm({ ...form, ...x })}
                >
                  {x.text}
                </button>
              ))}
            </div>
          </form>
        </Panel>
        <div>
          {!asked && (
            <EmptyState title="Ask about a position">
              Write it the way it would stand in a bill of quantities. The answer is a range from at least
              five companies' prices, adjusted to today and to the region.
            </EmptyState>
          )}
          {asked && q.isPending && <SkeletonRows rows={4} height="3rem" label="Checking the price" />}
          {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
          {q.data && (
            <motion.div
              key={JSON.stringify(asked)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: m.base, ease: m.ease }}
            >
              <Panel title={q.data.status === "ok" ? "Market range" : "No range"} id="pc-result">
                {q.data.status === "ok" ? (
                  <>
                    <div>
                      <span className={styles.median} data-cy="median">
                        {formatCents(q.data.p50)}
                      </span>{" "}
                      <span className={styles.per}>
                        median per {asked!.unit} in {asked!.region}
                      </span>
                    </div>
                    <PriceStrip
                      width={560}
                      height={32}
                      market={{ p10: q.data.p10!, p50: q.data.p50!, p90: q.data.p90! }}
                      dots={[]}
                      label="Market range"
                    />
                    <div className={styles.quantiles}>
                      {(["p10", "p25", "p50", "p75", "p90"] as const).map((k) => (
                        <div key={k}>
                          <span>{k === "p50" ? "median" : `${k.slice(1)}th percentile`}</span>
                          <strong>{formatCents(q.data[k])}</strong>
                        </div>
                      ))}
                    </div>
                    <p className={styles.note}>
                      {q.data.points.toLocaleString("de-DE")} prices from {q.data.companies} companies in the
                      last three years, matched on {q.data.signatures} wordings of the same work, brought to
                      this quarter and region. Ranges are withheld when fewer than five companies contributed
                      or one company dominates.
                    </p>
                  </>
                ) : (
                  <p>{REASON[q.data.reason ?? ""] ?? "No range."}</p>
                )}
              </Panel>
            </motion.div>
          )}
        </div>
      </div>
    </>
  );
}
