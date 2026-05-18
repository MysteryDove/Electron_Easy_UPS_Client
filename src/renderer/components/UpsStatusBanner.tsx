import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Battery,
  BatteryWarning,
  Loader,
  Plug,
  PlugOff,
  Power,
  RefreshCw,
  Settings,
  ZapOff,
} from 'lucide-react';
import type {
  BannerModifier,
  BannerPrimary,
  BannerSeverity,
} from '../../shared/upsStatus/statusModel';

const PRIMARY_ICON: Record<BannerPrimary, React.ReactNode> = {
  online: <Plug size={18} />,
  onBattery: <BatteryWarning size={18} />,
  batteryLow: <AlertTriangle size={18} />,
  batteryFailing: <BatteryWarning size={18} />,
  forcedShutdown: <Power size={18} />,
  off: <Power size={18} />,
  bypass: <ZapOff size={18} />,
  overload: <AlertTriangle size={18} />,
  calibration: <Settings size={18} />,
  boosting: <ArrowUp size={18} />,
  trimming: <ArrowDown size={18} />,
  transferring: <RefreshCw size={18} />,
  alarm: <AlertTriangle size={18} />,
  unknown: <Activity size={18} />,
  driverIssue: <AlertOctagon size={18} />,
  reconnecting: <RefreshCw size={18} />,
  initializing: <Loader size={18} />,
  connecting: <Loader size={18} />,
  disconnected: <PlugOff size={18} />,
};

const MODIFIER_ICON: Record<BannerModifier, React.ReactNode> = {
  charging: <ArrowUp size={12} />,
  discharging: <ArrowDown size={12} />,
  replaceBattery: <BatteryWarning size={12} />,
  alarm: <AlertTriangle size={12} />,
  eco: <Battery size={12} />,
  highBattery: <Battery size={12} />,
  overload: <AlertTriangle size={12} />,
  bypass: <ZapOff size={12} />,
  stale: <Activity size={12} />,
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export type UpsStatusBannerProps = {
  primary: BannerPrimary;
  modifiers: BannerModifier[];
  severity: BannerSeverity;
  rawTokens?: string[];
  alarmText?: string;
};

export function UpsStatusBanner({
  primary,
  modifiers,
  severity,
  rawTokens,
  alarmText,
}: UpsStatusBannerProps) {
  const { t } = useTranslation();
  const previousSeverityRef = useRef<BannerSeverity | null>(null);

  const isCriticalEntry =
    previousSeverityRef.current !== 'critical' && severity === 'critical';
  const ariaLive: 'assertive' | 'polite' = isCriticalEntry ? 'assertive' : 'polite';

  useEffect(() => {
    previousSeverityRef.current = severity;
  }, [severity]);

  const primaryLabel = t(`dashboard.status${capitalize(primary)}`);
  const tooltip = rawTokens && rawTokens.length > 0 ? rawTokens.join(' ') : undefined;

  return (
    <div
      role="status"
      aria-live={ariaLive}
      className={
        'ups-status-badge ups-status-badge--' +
        severity +
        (severity === 'critical' ? ' ups-status-badge--pulse' : '')
      }
      title={tooltip}
      data-primary={primary}
    >
      <span className="ups-status-badge-icon">{PRIMARY_ICON[primary]}</span>
      <span className="ups-status-badge-label">{primaryLabel}</span>
      {modifiers.map((modifier) => (
        <span
          key={modifier}
          className={
            'ups-status-modifier-chip ups-status-modifier-chip--' + modifier
          }
          title={modifier === 'alarm' ? alarmText : undefined}
          data-modifier={modifier}
        >
          <span className="ups-status-modifier-chip-icon">
            {MODIFIER_ICON[modifier]}
          </span>
          <span>{t(`dashboard.modifier${capitalize(modifier)}`)}</span>
        </span>
      ))}
    </div>
  );
}
