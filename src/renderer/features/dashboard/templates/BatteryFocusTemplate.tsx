import { useTranslation } from 'react-i18next';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../../../shared/upsStatus/statusModel';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { RingProgress, HeroCard } from '../components';
import { SparklineCard } from '../../../components/SparklineCard';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
import styles from './BatteryFocusTemplate.module.css';

export function BatteryFocusTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();

  const telemetry = data.telemetry.latest;
  const history = data.telemetry.history;

  // Derive banner state
  const bannerTokens = parseUpsStatusTokens(data.ups.dynamic?.['ups.status']);
  const bannerAlarmText = data.ups.dynamic?.['ups.alarm'];
  const bannerStaleSeconds = data.connection.isStale
    ? Math.floor((Date.now() - (data.connection.lastUpdateTime?.getTime() ?? Date.now())) / 1000)
    : 0;
  const bannerState = deriveUpsBannerState({
    tokens: bannerTokens,
    legacyStatusNum: telemetry?.values.ups_status_num ?? null,
    connection: data.connection.state,
    staleSeconds: bannerStaleSeconds,
    driverIssue: data.connection.driverIssue,
  });

  // Extract battery-focused telemetry
  const batteryCharge = telemetry?.values.battery_charge_pct ?? 0;
  const batteryVoltage = telemetry?.values.battery_voltage ?? 0;
  const batteryCurrent = telemetry?.values.battery_current ?? 0;
  const batteryRuntime = telemetry?.values.battery_runtime_sec ?? 0;
  const upsLoad = telemetry?.values.ups_load_pct ?? 0;

  // Determine battery status
  const isCharging = data.ups.dynamic?.['ups.status']?.includes('CHRG');
  const isDischarging = data.ups.dynamic?.['ups.status']?.includes('DISCHRG');
  const batteryStatus = isCharging
    ? t('dashboard.modifierCharging')
    : isDischarging
      ? t('dashboard.modifierDischarging')
      : t('dashboard.systemNormal');

  // Health status for hero card
  let healthStatus: 'normal' | 'warning' | 'critical' = 'normal';
  if (batteryCharge < 20) {
    healthStatus = 'critical';
  } else if (batteryCharge < 50 || isDischarging) {
    healthStatus = 'warning';
  }

  const runtimeMinutes = Math.floor(batteryRuntime / 60);
  const description = `${batteryVoltage.toFixed(1)}V, ${batteryCurrent.toFixed(1)}A, ~${runtimeMinutes} min runtime`;

  // Prepare sparkline data
  const voltageHistory = history
    .map((row) => row.values.battery_voltage)
    .filter((v): v is number => typeof v === 'number');
  const currentHistory = history
    .map((row) => row.values.battery_current)
    .filter((v): v is number => typeof v === 'number');
  const loadHistory = history
    .map((row) => row.values.ups_load_pct)
    .filter((v): v is number => typeof v === 'number');

  return (
    <div className={styles.template}>
      <UpsStatusBanner
        primary={bannerState.primary}
        modifiers={bannerState.modifiers}
        severity={bannerState.severity}
        rawTokens={bannerTokens}
        alarmText={bannerAlarmText}
      />
      <div className={styles.layout}>
        {/* Hero card with battery ring */}
        <HeroCard
          title={t('metrics.batteryCharge')}
          status={healthStatus}
          description={description}
          ringContent={
            <RingProgress
              percentage={batteryCharge}
              label={batteryStatus}
              size={140}
            />
          }
          className={styles.heroCard}
        />

        {/* Mini metric cards */}
        <SparklineCard
          title={t('metrics.batteryVoltage')}
          currentValue={batteryVoltage}
          unit="V"
          data={voltageHistory}
          
        />
        <SparklineCard
          title={t('metrics.batteryCurrent')}
          currentValue={batteryCurrent}
          unit="A"
          data={currentHistory}
          
        />
        <SparklineCard
          title={t('metrics.upsLoad')}
          currentValue={upsLoad}
          unit="%"
          data={loadHistory}
          
        />

        {/* Maintenance notes card */}
        <div className={styles.maintenanceCard}>
          <div className={styles.maintenanceTitle}>{t('dashboard.maintenance')}</div>
          <div className={styles.maintenanceContent}>
            {batteryCharge < 20 && (
              <p className={styles.maintenanceAlert}>
                ⚠️ Battery critically low - charge immediately
              </p>
            )}
            {batteryCharge >= 80 && (
              <p className={styles.maintenanceNote}>✓ Battery in good condition</p>
            )}
            {batteryCharge < 80 && batteryCharge >= 20 && (
              <p className={styles.maintenanceNote}>→ Consider charging soon</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
