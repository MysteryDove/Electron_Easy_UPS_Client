import { useTranslation } from 'react-i18next';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../../../shared/upsStatus/statusModel';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { QualityBandCard } from '../components';
import { SparklineCard } from '../../../components/SparklineCard';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
import styles from './PowerQualityTemplate.module.css';

export function PowerQualityTemplate() {
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

  // Extract telemetry values
  const inputVoltage = telemetry?.values.input_voltage ?? null;
  const outputVoltage = telemetry?.values.output_voltage ?? null;
  const inputFreq = telemetry?.values.input_frequency_hz ?? null;
  const outputFreq = telemetry?.values.output_frequency_hz ?? null;
  const inputCurrent = telemetry?.values.input_current ?? 0;
  const outputCurrent = telemetry?.values.output_current ?? 0;
  const apparentPower = telemetry?.values.ups_apparent_power_va ?? 0;
  const realPower = telemetry?.values.ups_realpower_watts ?? 0;

  const {
    nominalVoltage,
    nominalFrequency,
    voltageTolerancePosPct,
    voltageToleranceNegPct,
    frequencyTolerancePosPct,
    frequencyToleranceNegPct,
  } = data.config.line;

  // Prepare sparkline data
  const inputCurrentHistory = history
    .map((row) => row.values.input_current)
    .filter((v): v is number => typeof v === 'number');
  const outputCurrentHistory = history
    .map((row) => row.values.output_current)
    .filter((v): v is number => typeof v === 'number');
  const apparentPowerHistory = history
    .map((row) => row.values.ups_apparent_power_va)
    .filter((v): v is number => typeof v === 'number');
  const realPowerHistory = history
    .map((row) => row.values.ups_realpower_watts)
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

      {/* Quality cards grid (2x2) */}
      <div className={styles.qualityGrid}>
        <QualityBandCard
          label={t('metrics.inputVoltage')}
          value={inputVoltage}
          unit="V"
          nominalValue={nominalVoltage}
          tolerancePosPct={voltageTolerancePosPct}
          toleranceNegPct={voltageToleranceNegPct}
        />
        <QualityBandCard
          label={t('metrics.outputVoltage')}
          value={outputVoltage}
          unit="V"
          nominalValue={nominalVoltage}
          tolerancePosPct={voltageTolerancePosPct}
          toleranceNegPct={voltageToleranceNegPct}
        />
        <QualityBandCard
          label={t('metrics.inputFrequency')}
          value={inputFreq}
          unit="Hz"
          nominalValue={nominalFrequency}
          tolerancePosPct={frequencyTolerancePosPct}
          toleranceNegPct={frequencyToleranceNegPct}
        />
        <QualityBandCard
          label={t('metrics.outputFrequency')}
          value={outputFreq}
          unit="Hz"
          nominalValue={nominalFrequency}
          tolerancePosPct={frequencyTolerancePosPct}
          toleranceNegPct={frequencyToleranceNegPct}
        />
      </div>

      {/* Mini metrics grid (4 columns) */}
      <div className={styles.miniGrid}>
        <SparklineCard
          title={t('metrics.inputCurrent')}
          currentValue={inputCurrent}
          unit="A"
          data={inputCurrentHistory}
          
        />
        <SparklineCard
          title={t('metrics.outputCurrent')}
          currentValue={outputCurrent}
          unit="A"
          data={outputCurrentHistory}
          
        />
        <SparklineCard
          title={t('metrics.apparentPower')}
          currentValue={apparentPower}
          unit="VA"
          data={apparentPowerHistory}
          
        />
        <SparklineCard
          title={t('metrics.realPower')}
          currentValue={realPower}
          unit="W"
          data={realPowerHistory}
          
        />
      </div>
    </div>
  );
}
