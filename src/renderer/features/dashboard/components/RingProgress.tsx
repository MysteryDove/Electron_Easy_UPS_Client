import styles from './RingProgress.module.css';

export interface RingProgressProps {
  percentage: number;
  size?: number;
  label?: string;
  color?: string;
  className?: string;
}

export function RingProgress({
  percentage,
  size = 140,
  label,
  color = 'var(--color-accent)',
  className = '',
}: RingProgressProps) {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  return (
    <div
      className={`${styles.container} ${className}`}
      style={{
        width: size,
        height: size,
        ['--ring-percentage' as string]: `${clampedPercentage}%`,
        ['--ring-color' as string]: color,
      }}
      role="progressbar"
      aria-valuenow={clampedPercentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `${clampedPercentage}% progress`}
    >
      <div className={styles.content}>
        <div className={styles.percentage}>{Math.round(clampedPercentage)}%</div>
        {label && <div className={styles.label}>{label}</div>}
      </div>
    </div>
  );
}

