import styles from './MetricChip.module.css';

export interface MetricChipProps {
  label: string;
  value: string;
  unit?: string;
  className?: string;
}

export function MetricChip({ label, value, unit, className = '' }: MetricChipProps) {
  return (
    <div className={`${styles.chip} ${className}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {value}
        {unit && <span className={styles.unit}>{unit}</span>}
      </div>
    </div>
  );
}
