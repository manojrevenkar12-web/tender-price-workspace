/**
 * One row's prices at a glance: the market range from comparable historical prices (p10 to p90,
 * with the median as a bar) and every bid as a dot, on a log scale so a decimal slip still fits.
 */
import styles from "./PriceStrip.module.css";

export interface StripDot {
  value: number;
  kind: "plain" | "flag" | "stale";
  active?: boolean;
}

export function PriceStrip({
  market,
  dots,
  width = 132,
  height = 18,
  label,
}: {
  market: { p10: number; p50: number; p90: number } | null;
  dots: StripDot[];
  width?: number;
  height?: number;
  label: string;
}) {
  const values = [...dots.map((d) => d.value), ...(market ? [market.p10, market.p90] : [])].filter(
    (v) => v > 0,
  );
  if (values.length === 0)
    return <svg className={styles.strip} width={width} height={height} role="img" aria-label={label} />;
  const lo = Math.log(Math.min(...values) * 0.9);
  const hi = Math.log(Math.max(...values) * 1.1);
  const pad = 4;
  const x = (v: number) => pad + ((Math.log(v) - lo) / Math.max(hi - lo, 1e-6)) * (width - 2 * pad);
  const mid = height / 2;
  return (
    <svg className={styles.strip} width={width} height={height} role="img" aria-label={label}>
      <line className={styles.axis} x1={pad} x2={width - pad} y1={mid} y2={mid} />
      {market && (
        <>
          <rect
            className={styles.band}
            x={x(market.p10)}
            y={mid - 4}
            width={Math.max(x(market.p90) - x(market.p10), 2)}
            height={8}
            rx={2}
          />
          <line className={styles.median} x1={x(market.p50)} x2={x(market.p50)} y1={mid - 6} y2={mid + 6} />
        </>
      )}
      {dots
        .filter((d) => d.value > 0)
        .map((d, i) => (
          <circle
            key={i}
            className={`${styles.dot} ${d.kind === "flag" ? styles.dotFlag : d.kind === "stale" ? styles.dotStale : ""} ${d.active ? styles.dotActive : ""}`}
            cx={x(d.value)}
            cy={mid}
            r={d.active ? 4 : 3}
          />
        ))}
    </svg>
  );
}
