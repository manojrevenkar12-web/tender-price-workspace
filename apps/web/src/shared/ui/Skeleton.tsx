import styles from "./Skeleton.module.css";

export function Skeleton({ width = "100%", height = "1rem" }: { width?: string; height?: string }) {
  return <span className={styles.block} style={{ width, height }} aria-hidden />;
}

/** Placeholder rows shaped like the content that is loading. */
export function SkeletonRows({
  rows = 6,
  height = "2.5rem",
  label,
}: {
  rows?: number;
  height?: string;
  label: string;
}) {
  return (
    <div className={styles.rows} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={`${100 - (i % 3) * 6}%`} />
      ))}
    </div>
  );
}
