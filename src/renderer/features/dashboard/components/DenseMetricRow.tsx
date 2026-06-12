import styles from './DenseMetricRow.module.css';

export interface DenseMetricRowProps {
  label: string;
  value: number | null;
  unit: string;
  barWidth: number;
  note?: string;
  className?: string;
}

export function DenseMetricRow({
  label,
  value,
  unit,
  barWidth,
  note,
  className = '',
}: DenseMetricRowProps) {
  const displayValue = value !== null ? value.toFixed(1) : '--';
  const clampedWidth = Math.max(0, Math.min(100, barWidth));

  return (
    <div className={`${styles.row} ${className}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {displayValue}
        <span className={styles.unit}>{unit}</span>
      </div>
      <div className={styles.barContainer}>
        <div
          className={styles.barFill}
          style={{ width: `${clampedWidth}%` }}
          role="progressbar"
          aria-valuenow={clampedWidth}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} progress`}
        />
      </div>
      {note && <div className={styles.note}>{note}</div>}
    </div>
  );
}
