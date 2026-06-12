import styles from './QualityBandCard.module.css';

export interface QualityBandCardProps {
  label: string;
  value: number | null;
  unit: string;
  nominalValue: number;
  tolerancePosPct: number;
  toleranceNegPct: number;
  className?: string;
}

export function QualityBandCard({
  label,
  value,
  unit,
  nominalValue,
  tolerancePosPct,
  toleranceNegPct,
  className = '',
}: QualityBandCardProps) {
  const displayValue = value !== null ? value.toFixed(1) : '--';

  // Calculate tolerance range
  const minValue = nominalValue * (1 - toleranceNegPct / 100);
  const maxValue = nominalValue * (1 + tolerancePosPct / 100);
  const range = maxValue - minValue;

  // Calculate needle position (0-100%)
  let needlePosition = 50; // default to center
  if (value !== null) {
    needlePosition = ((value - minValue) / range) * 100;
    needlePosition = Math.max(0, Math.min(100, needlePosition)); // clamp to 0-100
  }

  // Determine if value is in tolerance
  const isInTolerance = value !== null && value >= minValue && value <= maxValue;
  const isOutOfRange = value !== null && (value < minValue || value > maxValue);

  return (
    <div className={`${styles.card} ${className}`}>
      <div className={styles.header}>
        <div className={styles.label}>{label}</div>
        <div className={styles.value}>
          {displayValue}
          <span className={styles.unit}>{unit}</span>
        </div>
      </div>
      <div className={styles.bandContainer}>
        <div className={styles.band} data-in-tolerance={isInTolerance}>
          <div
            className={styles.needle}
            style={{ left: `${needlePosition}%` }}
            data-out-of-range={isOutOfRange}
            role="img"
            aria-label={`Current value: ${displayValue}${unit}`}
          />
        </div>
        <div className={styles.labels}>
          <span className={styles.labelMin}>{minValue.toFixed(0)}</span>
          <span className={styles.labelNominal}>{nominalValue.toFixed(0)}</span>
          <span className={styles.labelMax}>{maxValue.toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
