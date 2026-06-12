import { useTranslation } from 'react-i18next';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../../../shared/upsStatus/statusModel';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { DenseMetricRow } from '../components';
import { SparklineCard } from '../../../components/SparklineCard';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
import styles from './CompactCommandTemplate.module.css';

export function CompactCommandTemplate() {
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

  // Extract telemetry values with null handling
  const batteryCharge = telemetry?.values.battery_charge_pct ?? null;
  const upsLoad = telemetry?.values.ups_load_pct ?? null;
  const batteryVoltage = telemetry?.values.battery_voltage ?? null;
  const inputVoltage = telemetry?.values.input_voltage ?? null;
  const outputVoltage = telemetry?.values.output_voltage ?? null;
  const outputCurrent = telemetry?.values.output_current ?? null;
  const realPower = telemetry?.values.ups_realpower_watts ?? null;
  const inputFreq = telemetry?.values.input_frequency_hz ?? null;
  const outputFreq = telemetry?.values.output_frequency_hz ?? null;
  const alarmStatus = data.ups.dynamic?.['ups.alarm'] || t('dashboard.noAlarms');

  // Prepare sparkline data (number arrays)
  const realPowerHistory = history
    .map((row) => row.values.ups_realpower_watts)
    .filter((v): v is number => typeof v === 'number');
  const inputFreqHistory = history
    .map((row) => row.values.input_frequency_hz)
    .filter((v): v is number => typeof v === 'number');
  const outputFreqHistory = history
    .map((row) => row.values.output_frequency_hz)
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
        {/* Left column: Dense metric rows */}
        <div className={styles.leftColumn}>
          <DenseMetricRow
            label={t('metrics.batteryCharge')}
            value={batteryCharge}
            unit="%"
            barWidth={batteryCharge ?? 0}
          />
          <DenseMetricRow
            label={t('metrics.upsLoad')}
            value={upsLoad}
            unit="%"
            barWidth={upsLoad ?? 0}
          />
          <DenseMetricRow
            label={t('metrics.batteryVoltage')}
            value={batteryVoltage}
            unit="V"
            barWidth={batteryVoltage ? (batteryVoltage / 60) * 100 : 0}
          />
          <DenseMetricRow
            label={t('metrics.inputVoltage')}
            value={inputVoltage}
            unit="V"
            barWidth={inputVoltage ? (inputVoltage / 250) * 100 : 0}
          />
          <DenseMetricRow
            label={t('metrics.outputVoltage')}
            value={outputVoltage}
            unit="V"
            barWidth={outputVoltage ? (outputVoltage / 250) * 100 : 0}
          />
          <DenseMetricRow
            label={t('metrics.outputCurrent')}
            value={outputCurrent}
            unit="A"
            barWidth={outputCurrent ? (outputCurrent / 10) * 100 : 0}
          />
        </div>

        {/* Right column: Mini cards */}
        <div className={styles.rightColumn}>
          <SparklineCard
            title={t('metrics.realPower')}
            currentValue={realPower ?? 0}
            unit="W"
            data={realPowerHistory}
            
          />
          <SparklineCard
            title={t('metrics.inputFrequency')}
            currentValue={inputFreq ?? 0}
            unit="Hz"
            data={inputFreqHistory}
            
          />
          <SparklineCard
            title={t('metrics.outputFrequency')}
            currentValue={outputFreq ?? 0}
            unit="Hz"
            data={outputFreqHistory}
            
          />
          <div className={styles.alarmCard}>
            <div className={styles.alarmLabel}>{t('dashboard.statusAlarm')}</div>
            <div className={styles.alarmValue}>{alarmStatus}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
