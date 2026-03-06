import { Fragment, useEffect, useMemo, useState } from 'react';
import { Transition } from '@headlessui/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useConnection, useAppConfig } from '../app/providers';
import { UiButton, UiDialog, UiDialogPanel, UiDialogTitle } from './ui';

export function ReconnectOverlay() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { state, lastTelemetry, localDriverLaunchIssue } = useConnection();
    const { config } = useAppConfig();
    const [hasReachedReadyOnce, setHasReachedReadyOnce] = useState(false);
    const [rescanState, setRescanState] =
        useState<'idle' | 'scanning' | 'success' | 'missing' | 'error'>('idle');
    const [rescanMessage, setRescanMessage] = useState<string | null>(null);
    const [canContinue, setCanContinue] = useState(false);
    const [continuing, setContinuing] = useState(false);
    const targetComPort = localDriverLaunchIssue?.port?.trim().toUpperCase() ?? '';
    const retryFailedFallback = t(
        'reconnect.driverLogRetryFailed',
        'Driver retry failed. Resolve issue and rescan before continuing.',
    );

    const resetRetryUiState = () => {
        setRescanState('idle');
        setRescanMessage(null);
        setCanContinue(false);
        setContinuing(false);
    };

    const setRetryFailure = (
        message: string,
        mode: 'idle' | 'error' = 'error',
    ) => {
        setCanContinue(false);
        setRescanState(mode);
        setRescanMessage(message);
        setContinuing(false);
    };

    useEffect(() => {
        if (state === 'ready') {
            setHasReachedReadyOnce(true);
            resetRetryUiState();
        }
    }, [state]);

    useEffect(() => {
        resetRetryUiState();
    }, [localDriverLaunchIssue?.signature]);

    // Do not show the overlay if the user is still in the setup wizard
    if (!config?.wizard.completed) {
        return null;
    }

    const shouldShow = state !== 'ready';

    const isColdStartDriverInit =
        Boolean(config.nut.launchLocalComponents) && !hasReachedReadyOnce;
    const shouldShowDriverIssueDialog =
        shouldShow &&
        isColdStartDriverInit &&
        Boolean(localDriverLaunchIssue);
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

    const issueSummary = localDriverLaunchIssue
        ? localDriverLaunchIssue.code === 'SERIAL_COM_PRECHECK_MISSING'
            ? t(
                'reconnect.driverLogSummaryPrecheckMissing',
                'Configured serial port {{port}} was not found before launching the driver.',
                { port: localDriverLaunchIssue.port ?? 'COM port' },
            )
            : localDriverLaunchIssue.code === 'SERIAL_COM_OPEN_FAILED'
                ? t(
                    'reconnect.driverLogSummaryComOpen',
                    'Driver failed to open {{port}}. The port may be busy, inaccessible, or disconnected.',
                    { port: localDriverLaunchIssue.port ?? 'the serial port' },
                )
                : t(
                    'reconnect.driverLogSummaryGeneric',
                    'Driver launch failed during cold start. Review logs below for details.',
                )
        : '';

    const issueLogSections = useMemo(() => {
        if (!localDriverLaunchIssue) {
            return [];
        }

        const sections: Array<{ key: string; label: string; value: string }> = [];
        if (localDriverLaunchIssue.stdout?.trim()) {
            sections.push({
                key: 'stdout',
                label: t('reconnect.driverLogSectionStdout', 'Driver stdout'),
                value: localDriverLaunchIssue.stdout.trim(),
            });
        }
        if (localDriverLaunchIssue.stderr?.trim()) {
            sections.push({
                key: 'stderr',
                label: t('reconnect.driverLogSectionStderr', 'Driver stderr'),
                value: localDriverLaunchIssue.stderr.trim(),
            });
        }
        if (localDriverLaunchIssue.technicalDetails?.trim()) {
            sections.push({
                key: 'details',
                label: t('reconnect.driverLogSectionDetails', 'Technical details'),
                value: localDriverLaunchIssue.technicalDetails.trim(),
            });
        }

        return sections;
    }, [localDriverLaunchIssue, t]);

    const handleRescan = async () => {
        if (!targetComPort) {
            setRetryFailure(
                t(
                    'reconnect.driverLogTargetPortMissing',
                    'No target COM port was parsed from the driver configuration. Re-configure serial settings in wizard.',
                ),
            );
            return;
        }

        setRescanState('scanning');
        setCanContinue(false);
        setRescanMessage(null);

        try {
            const result = await window.electronApi.nutSetup.listComPorts();
            const found = result.ports.includes(targetComPort);
            if (found) {
                setRescanState('success');
                setCanContinue(true);
                setRescanMessage(t(
                    'reconnect.driverLogRescanSuccess',
                    '{{port}} detected. You can continue to retry driver startup.',
                    { port: targetComPort },
                ));
                return;
            }

            setRescanState('missing');
            setCanContinue(false);
            setRescanMessage(t(
                'reconnect.driverLogRescanMissing',
                '{{port}} not found. Reconnect cable/device, then rescan.',
                { port: targetComPort },
            ));
        } catch (error) {
            setRetryFailure(
                error instanceof Error
                    ? error.message
                    : t(
                        'reconnect.driverLogRescanError',
                        'Failed to rescan COM ports.',
                    ),
            );
        }
    };

    const handleContinue = async () => {
        if (!canContinue || continuing) {
            return;
        }

        setContinuing(true);
        try {
            const result = await window.electronApi.nut.retryLocalDriverLaunch();
            if (!result.success) {
                setRetryFailure(
                    result.error ?? retryFailedFallback,
                    'idle',
                );
                return;
            }

            // Keep the Continue button in loading state until the dialog closes
            // via a real ready transition / issue-clear event.
        } catch (error) {
            setRetryFailure(
                error instanceof Error
                    ? error.message
                    : retryFailedFallback,
            );
        }
    };

    const rescanStatusClass =
        rescanState === 'success'
            ? 'driver-launch-issue-rescan-status--success'
            : rescanState === 'error' || rescanState === 'missing'
                ? 'driver-launch-issue-rescan-status--error'
                : 'driver-launch-issue-rescan-status--neutral';

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

                {shouldShowDriverIssueDialog && localDriverLaunchIssue && (
                    <UiDialog
                        as="div"
                        open={shouldShowDriverIssueDialog}
                        onClose={() => { /* No-op: explicit action buttons drive this flow */ }}
                        className="driver-launch-issue-layer"
                    >
                        <UiDialogPanel className="driver-launch-issue-card">
                            <div className="driver-launch-issue-header">
                                <UiDialogTitle
                                    as="h3"
                                    id="driver-launch-issue-title"
                                    className="driver-launch-issue-title"
                                >
                                    {t('reconnect.driverLogTitle', 'Driver startup failed')}
                                </UiDialogTitle>
                                <p className="driver-launch-issue-summary">{issueSummary}</p>
                                <div className="driver-launch-issue-meta">
                                    <span className="driver-launch-issue-code">
                                        {localDriverLaunchIssue.code}
                                    </span>
                                    {localDriverLaunchIssue.port && (
                                        <span className="driver-launch-issue-port">
                                            {localDriverLaunchIssue.port}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="driver-launch-issue-body">
                                {rescanMessage && (
                                    <p className={`driver-launch-issue-rescan-status ${rescanStatusClass}`}>
                                        {rescanMessage}
                                    </p>
                                )}
                                {issueLogSections.map((section) => (
                                    <section key={section.key} className="driver-launch-issue-section">
                                        <h4 className="driver-launch-issue-section-title">{section.label}</h4>
                                        <pre className="driver-launch-issue-pre">{section.value}</pre>
                                    </section>
                                ))}
                            </div>

                            <div className="driver-launch-issue-actions">
                                <UiButton
                                    type="button"
                                    className="btn btn--secondary"
                                    onClick={() => navigate('/wizard')}
                                >
                                    {t('reconnect.driverLogReconfigure', 'Re-configure')}
                                </UiButton>
                                <div className="driver-launch-issue-actions-right">
                                    <UiButton
                                        type="button"
                                        className="btn btn--secondary"
                                        onClick={handleRescan}
                                        disabled={rescanState === 'scanning' || continuing}
                                    >
                                        {rescanState === 'scanning'
                                            ? t('reconnect.driverLogRescanning', 'Rescanning...')
                                            : t('reconnect.driverLogRescan', 'Rescan')}
                                    </UiButton>
                                    <UiButton
                                        type="button"
                                        className="btn btn--primary"
                                        onClick={handleContinue}
                                        disabled={!canContinue || continuing}
                                    >
                                        {continuing
                                            ? t('reconnect.driverLogContinuing', 'Continuing...')
                                            : t('reconnect.driverLogContinue', 'Continue')}
                                    </UiButton>
                                </div>
                            </div>
                        </UiDialogPanel>
                    </UiDialog>
                )}
            </div>
        </Transition>
    );
}
