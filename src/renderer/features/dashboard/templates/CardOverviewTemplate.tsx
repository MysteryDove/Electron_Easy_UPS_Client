import { useTranslation } from 'react-i18next';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../../../shared/upsStatus/statusModel';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { RingProgress, HeroCard } from '../components';
import { SparklineCard } from '../../../components/SparklineCard';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
import styles from './CardOverviewTemplate.module.css';

export function CardOverviewTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();

  const telemetry = data.telemetry.latest;
  const history = data.telemetry.history;
  const connectionState = data.connection.state;

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

  // Extract telemetry values
  const batteryCharge = telemetry?.values.battery_charge_pct ?? 0;
  const upsLoad = telemetry?.values.ups_load_pct ?? 0;
  const inputVoltage = telemetry?.values.input_voltage ?? 0;
  const outputVoltage = telemetry?.values.output_voltage ?? 0;
  const realPower = telemetry?.values.ups_realpower_watts ?? 0;
  const batteryRuntime = telemetry?.values.battery_runtime_sec ?? 0;

  // Determine health status based on connection and alarms
  const hasAlarm = data.ups.dynamic?.['ups.alarm'] !== undefined;
  const isOnBattery = data.ups.dynamic?.['ups.status']?.includes('OB');
  let healthStatus: 'normal' | 'warning' | 'critical' = 'normal';
  let healthDescription = t('dashboard.powerStable');

  if (connectionState !== 'ready') {
    healthStatus = 'critical';
    healthDescription = t('dashboard.statusDisconnected');
  } else if (hasAlarm || batteryCharge < 20) {
    healthStatus = 'critical';
    healthDescription = t('dashboard.systemCritical');
  } else if (isOnBattery || batteryCharge < 50) {
    healthStatus = 'warning';
    healthDescription = t('dashboard.systemWarning');
  } else {
    healthDescription = t('dashboard.systemNormal');
  }

  // Prepare sparkline data
  const loadHistory = history
    .map((row) => row.values.ups_load_pct)
    .filter((v): v is number => typeof v === 'number');
  const inputVoltageHistory = history
    .map((row) => row.values.input_voltage)
    .filter((v): v is number => typeof v === 'number');
  const outputVoltageHistory = history
    .map((row) => row.values.output_voltage)
    .filter((v): v is number => typeof v === 'number');
  const realPowerHistory = history
    .map((row) => row.values.ups_realpower_watts)
    .filter((v): v is number => typeof v === 'number');
  const runtimeHistory = history
    .map((row) => row.values.battery_runtime_sec)
    .filter((v): v is number => typeof v === 'number')
    .map((sec) => sec / 60); // Convert to minutes

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
        {/* Hero card spans 2 columns */}
        <HeroCard
          title={t('dashboard.healthOverall')}
          status={healthStatus}
          description={healthDescription}
          ringContent={
            <RingProgress
              percentage={batteryCharge}
              label={t('metrics.batteryCharge')}
              size={140}
            />
          }
          className={styles.heroCard}
        />

        {/* Mini metric cards */}
        <SparklineCard
          title={t('metrics.upsLoad')}
          currentValue={upsLoad}
          unit="%"
          data={loadHistory}
          
        />
        <SparklineCard
          title={t('metrics.inputVoltage')}
          currentValue={inputVoltage}
          unit="V"
          data={inputVoltageHistory}
          
        />
        <SparklineCard
          title={t('metrics.outputVoltage')}
          currentValue={outputVoltage}
          unit="V"
          data={outputVoltageHistory}
          
        />
        <SparklineCard
          title={t('metrics.realPower')}
          currentValue={realPower}
          unit="W"
          data={realPowerHistory}
          
        />
        <SparklineCard
          title={t('metrics.batteryRuntime')}
          currentValue={batteryRuntime / 60}
          unit="min"
          data={runtimeHistory}
          
        />
      </div>
    </div>
  );
}
