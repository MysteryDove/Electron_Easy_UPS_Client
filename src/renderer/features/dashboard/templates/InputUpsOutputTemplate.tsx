import { Plug, Battery, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  deriveUpsBannerState,
  parseUpsStatusTokens,
} from '../../../../shared/upsStatus/statusModel';
import { useDashboardDataContext } from '../DashboardDataProvider';
import { FlowNode } from '../components';
import { UpsStatusBanner } from '../../../components/UpsStatusBanner';
import styles from './InputUpsOutputTemplate.module.css';

export function InputUpsOutputTemplate() {
  const { t } = useTranslation();
  const data = useDashboardDataContext();

  const telemetry = data.telemetry.latest;

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

  // Extract values for flow diagram
  const inputVoltage = telemetry?.values.input_voltage ?? 0;
  const inputFreq = telemetry?.values.input_frequency_hz ?? 0;
  const batteryCharge = telemetry?.values.battery_charge_pct ?? 0;
  const batteryRuntime = telemetry?.values.battery_runtime_sec ?? 0;
  const outputVoltage = telemetry?.values.output_voltage ?? 0;
  const upsLoad = telemetry?.values.ups_load_pct ?? 0;

  const runtimeMinutes = Math.floor(batteryRuntime / 60);

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
        {/* Input node */}
        <FlowNode
          icon={<Plug />}
          title={t('dashboard.groupInput')}
          subtitle="AC Power"
          primaryValue={inputVoltage.toFixed(0)}
          primaryUnit="V"
          badge={`${inputFreq.toFixed(1)} Hz`}
        />

        {/* Arrow separator */}
        <div className={styles.arrow} aria-hidden="true">
          →
        </div>

        {/* UPS node */}
        <FlowNode
          icon={<Battery />}
          title="UPS"
          subtitle="Uninterruptible Power"
          primaryValue={batteryCharge.toFixed(0)}
          primaryUnit="%"
          badge={`~${runtimeMinutes} min`}
        />

        {/* Arrow separator */}
        <div className={styles.arrow} aria-hidden="true">
          →
        </div>

        {/* Output node */}
        <FlowNode
          icon={<Zap />}
          title={t('dashboard.groupOutput')}
          subtitle="Protected Load"
          primaryValue={outputVoltage.toFixed(0)}
          primaryUnit="V"
          badge={`${upsLoad.toFixed(0)}% load`}
        />
      </div>
    </div>
  );
}
