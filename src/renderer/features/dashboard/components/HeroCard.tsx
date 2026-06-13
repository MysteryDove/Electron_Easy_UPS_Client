import { ReactNode } from 'react';
import styles from './HeroCard.module.css';

export interface HeroCardProps {
  title: string;
  status: 'normal' | 'warning' | 'critical';
  description: string;
  ringContent: ReactNode;
  className?: string;
}

export function HeroCard({
  title,
  status,
  description,
  ringContent,
  className = '',
}: HeroCardProps) {
  return (
    <div className={`${styles.card} ${className}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.statusPill} data-status={status}>
          {status === 'normal' && 'Normal'}
          {status === 'warning' && 'Warning'}
          {status === 'critical' && 'Critical'}
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.ring}>{ringContent}</div>
        <p className={styles.description}>{description}</p>
      </div>
    </div>
  );
}
