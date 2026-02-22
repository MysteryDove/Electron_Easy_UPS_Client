import { useTranslation } from 'react-i18next';
import { useConnection, useAppConfig } from '../app/providers';

export function ReconnectOverlay() {
    const { t } = useTranslation();
    const { state, lastTelemetry } = useConnection();
    const { config } = useAppConfig();

    // Do not show the overlay if the user is still in the setup wizard
    if (!config?.wizard.completed) {
        return null;
    }

    // Do not show the overlay if we are successfully connected
    if (state === 'ready') {
        return null;
    }

    return (
        <div className="reconnect-overlay">
            <div className="reconnect-card">
                <div className="reconnect-spinner" />
                <h2 className="reconnect-title">{t('reconnect.title')}</h2>
                <p className="reconnect-message">
                    {state === 'degraded'
                        ? t('reconnect.messageDegraded')
                        : t('reconnect.messageConnecting')}
                </p>
                {lastTelemetry?.values?.['battery_charge_pct'] !== undefined && (
                    <p className="reconnect-battery">
                        {t('reconnect.lastKnownBattery', { percent: lastTelemetry.values['battery_charge_pct'] })}
                    </p>
                )}
            </div>
        </div>
    );
}
