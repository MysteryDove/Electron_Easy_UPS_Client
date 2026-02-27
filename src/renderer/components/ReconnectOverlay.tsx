import { Fragment, useEffect, useState } from 'react';
import { Transition } from '@headlessui/react';
import { useTranslation } from 'react-i18next';
import { useConnection, useAppConfig } from '../app/providers';

export function ReconnectOverlay() {
    const { t } = useTranslation();
    const { state, lastTelemetry } = useConnection();
    const { config } = useAppConfig();
    const [hasReachedReadyOnce, setHasReachedReadyOnce] = useState(false);

    useEffect(() => {
        if (state === 'ready') {
            setHasReachedReadyOnce(true);
        }
    }, [state]);

    // Do not show the overlay if the user is still in the setup wizard
    if (!config?.wizard.completed) {
        return null;
    }

    const shouldShow = state !== 'ready';

    const isColdStartDriverInit =
        Boolean(config.nut.launchLocalComponents) && !hasReachedReadyOnce;
    const title = isColdStartDriverInit
        ? t('reconnect.titleInitializing', 'Waiting for driver initialization')
        : t('reconnect.title');
    const message = isColdStartDriverInit
        ? t(
            'reconnect.messageInitializing',
            'Starting local UPS driver. This can take a moment on cold start.',
        )
        : state === 'degraded'
            ? t('reconnect.messageDegraded')
            : t('reconnect.messageConnecting');

    return (
        <Transition
            as={Fragment}
            show={shouldShow}
            appear
            enter="reconnect-overlay-transition"
            enterFrom="reconnect-overlay-transition-from"
            enterTo="reconnect-overlay-transition-to"
            leave="reconnect-overlay-transition reconnect-overlay-transition-leave"
            leaveFrom="reconnect-overlay-transition-to"
            leaveTo="reconnect-overlay-transition-from"
        >
            <div className="reconnect-overlay">
                <div className="reconnect-card">
                    <div className="reconnect-spinner" />
                    <h2 className="reconnect-title">{title}</h2>
                    <p className="reconnect-message">{message}</p>
                    {lastTelemetry?.values?.['battery_charge_pct'] !== undefined && (
                        <p className="reconnect-battery">
                            {t('reconnect.lastKnownBattery', { percent: lastTelemetry.values['battery_charge_pct'] })}
                        </p>
                    )}
                </div>
            </div>
        </Transition>
    );
}
