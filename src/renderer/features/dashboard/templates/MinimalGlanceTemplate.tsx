import { useTranslation } from 'react-i18next';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { MetricChip } from '../components';
import styles from './MinimalGlanceTemplate.module.css';

export function MinimalGlanceTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();

  const telemetry = data.telemetry.latest;
  const connectionState = data.connection.state;

  // Extract key metrics
  const batteryCharge = telemetry?.values.battery_charge_pct ?? 0;
  const batteryRuntime = telemetry?.values.battery_runtime_sec ?? 0;
  const upsLoad = telemetry?.values.ups_load_pct ?? 0;
  const inputVoltage = telemetry?.values.input_voltage ?? 0;
  const outputVoltage = telemetry?.values.output_voltage ?? 0;
  const realPower = telemetry?.values.ups_realpower_watts ?? 0;

  // Determine health status
  const hasAlarm = data.ups.dynamic?.['ups.alarm'] !== undefined;
  const isOnBattery = data.ups.dynamic?.['ups.status']?.includes('OB');
  let healthText = t('dashboard.systemNormal');
  let statusPill = 'normal';

  if (connectionState !== 'ready') {
    healthText = t('dashboard.statusDisconnected');
    statusPill = 'critical';
  } else if (hasAlarm || batteryCharge < 20) {
    healthText = t('dashboard.systemCritical');
    statusPill = 'critical';
  } else if (isOnBattery || batteryCharge < 50) {
    healthText = t('dashboard.systemWarning');
    statusPill = 'warning';
  }

  const runtimeMinutes = Math.floor(batteryRuntime / 60);
  const descriptionParts = [];
  if (hasAlarm) {
    descriptionParts.push(t('dashboard.statusAlarm'));
  } else {
    descriptionParts.push(t('dashboard.noAlarms'));
  }
  descriptionParts.push(`${upsLoad.toFixed(0)}% load`);
  descriptionParts.push(`~${runtimeMinutes} min runtime`);

  return (
    <div className={styles.template}>
      <div className={styles.centered}>
        <div className={styles.statusPill} data-status={statusPill}>
          {statusPill === 'normal' && 'Normal'}
          {statusPill === 'warning' && 'Warning'}
          {statusPill === 'critical' && 'Critical'}
        </div>

        <div className={styles.largeValue}>{Math.round(batteryCharge)}%</div>

        <h2 className={styles.healthHeading}>{healthText}</h2>

        <p className={styles.description}>{descriptionParts.join(' • ')}</p>

        <div className={styles.chips}>
          <MetricChip
            label={t('metrics.inputVoltage')}
            value={inputVoltage.toFixed(0)}
            unit="V"
          />
          <MetricChip
            label={t('metrics.outputVoltage')}
            value={outputVoltage.toFixed(0)}
            unit="V"
          />
          <MetricChip label={t('metrics.realPower')} value={realPower.toFixed(0)} unit="W" />
        </div>
      </div>
    </div>
  );
}
