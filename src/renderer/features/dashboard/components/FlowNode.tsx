import { ReactNode } from 'react';
import styles from './FlowNode.module.css';

export interface FlowNodeProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  primaryValue: string;
  primaryUnit: string;
  badge: string;
  className?: string;
}

export function FlowNode({
  icon,
  title,
  subtitle,
  primaryValue,
  primaryUnit,
  badge,
  className = '',
}: FlowNodeProps) {
  return (
    <div className={`${styles.node} ${className}`}>
      <div className={styles.icon}>{icon}</div>
      <div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.label}>{subtitle}</p>
      </div>
      <div>
        <span className={styles.value}>{primaryValue}</span>
        <span className={styles.unit}>{primaryUnit}</span>
      </div>
      <span className={styles.tag}>{badge}</span>
    </div>
  );
}

