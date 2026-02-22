import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../app/providers';
import { Sun, Moon, Monitor, CheckCircle2, XCircle, Plug } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function SettingsPage() {
    const { t } = useTranslation();
    const { config, refreshConfig } = useAppConfig();
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);

    // Local form state (mirrors config)
    const [host, setHost] = useState('');
    const [port, setPort] = useState(3493);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [upsName, setUpsName] = useState('');
    const [intervalMs, setIntervalMs] = useState(6000);
    const [retentionDays, setRetentionDays] = useState(30);
    const [warningPct, setWarningPct] = useState(40);
    const [shutdownPct, setShutdownPct] = useState(20);
    const [warningToastEnabled, setWarningToastEnabled] = useState(true);
    const [shutdownEnabled, setShutdownEnabled] = useState(false);
    const [shutdownMethod, setShutdownMethod] = useState<'sleep' | 'shutdown'>('sleep');
    const [shutdownCountdownSeconds, setShutdownCountdownSeconds] = useState(45);
    const [criticalAlertEnabled, setCriticalAlertEnabled] = useState(true);
    const [criticalShutdownAlertEnabled, setCriticalShutdownAlertEnabled] = useState(true);
    const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
    const [nominalVoltage, setNominalVoltage] = useState(220);
    const [nominalFrequency, setNominalFrequency] = useState(50);
    const [voltageTolerancePosPct, setVoltageTolerancePosPct] = useState(10);
    const [voltageToleranceNegPct, setVoltageToleranceNegPct] = useState(10);
    const [frequencyTolerancePosPct, setFrequencyTolerancePosPct] = useState(1);
    const [frequencyToleranceNegPct, setFrequencyToleranceNegPct] = useState(1);
    const [lineAlertEnabled, setLineAlertEnabled] = useState(true);
    const [lineAlertCooldown, setLineAlertCooldown] = useState(5);
    const [locale, setLocale] = useState('system');
    const [startWithWindows, setStartWithWindows] = useState(false);

    // Sync from config on load
    useEffect(() => {
        if (!config) return;
        setHost(config.nut.host);
        setPort(config.nut.port);
        setUsername(config.nut.username ?? '');
        setPassword(config.nut.password ?? '');
        setUpsName(config.nut.upsName);
        setIntervalMs(config.polling.intervalMs);
        setRetentionDays(config.data.retentionDays);
        setWarningPct(config.battery.warningPct);
        setShutdownPct(config.battery.shutdownPct);
        setWarningToastEnabled(config.battery.warningToastEnabled);
        setShutdownEnabled(config.battery.shutdownEnabled);
        setShutdownMethod(config.battery.shutdownMethod);
        setShutdownCountdownSeconds(config.battery.shutdownCountdownSeconds);
        setCriticalAlertEnabled(config.battery.criticalAlertEnabled);
        setCriticalShutdownAlertEnabled(config.battery.criticalShutdownAlertEnabled);
        setThemeMode(config.theme.mode);
        setNominalVoltage(config.line.nominalVoltage);
        setNominalFrequency(config.line.nominalFrequency);
        setVoltageTolerancePosPct(config.line.voltageTolerancePosPct);
        setVoltageToleranceNegPct(config.line.voltageToleranceNegPct);
        setFrequencyTolerancePosPct(config.line.frequencyTolerancePosPct);
        setFrequencyToleranceNegPct(config.line.frequencyToleranceNegPct);
        setLineAlertEnabled(config.line.alertEnabled);
        setLineAlertCooldown(config.line.alertCooldownMinutes);
        setLocale(config.i18n.locale);
        setStartWithWindows(config.startup.startWithWindows);
    }, [config]);

    const handleSave = useCallback(
        async (e: FormEvent) => {
            e.preventDefault();
            setSaving(true);
            setSaveMessage(null);

            try {
                // Validate shutdownPct < warningPct client-side
                if (shutdownPct >= warningPct) {
                    setSaveMessage({
                        type: 'error',
                        text: 'Shutdown % must be lower than Warning %.',
                    });
                    setSaving(false);
                    return;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (window as any).electronApi.settings.update({
                    nut: {
                        host,
                        port,
                        username: username || undefined,
                        password: password || undefined,
                        upsName,
                    },
                    polling: { intervalMs },
                    data: { retentionDays },
                    battery: {
                        warningPct,
                        shutdownPct,
                        warningToastEnabled,
                        shutdownEnabled,
                        shutdownMethod,
                        shutdownCountdownSeconds,
                        criticalAlertEnabled,
                        criticalShutdownAlertEnabled,
                    },
                    theme: { mode: themeMode },
                    line: {
                        nominalVoltage,
                        nominalFrequency,
                        voltageTolerancePosPct,
                        voltageToleranceNegPct,
                        frequencyTolerancePosPct,
                        frequencyToleranceNegPct,
                        alertEnabled: lineAlertEnabled,
                        alertCooldownMinutes: lineAlertCooldown,
                    },
                    i18n: { locale },
                    startup: { startWithWindows },
                });

                await refreshConfig();
                setSaveMessage({ type: 'success', text: 'Settings saved.' });
                setTimeout(() => setSaveMessage(null), 6000);
            } catch (err) {
                setSaveMessage({
                    type: 'error',
                    text: err instanceof Error ? err.message : t('settings.saveFailed'),
                });
            } finally {
                setSaving(false);
            }
        },
        [
            host,
            port,
            username,
            password,
            upsName,
            intervalMs,
            retentionDays,
            warningPct,
            shutdownPct,
            warningToastEnabled,
            shutdownEnabled,
            shutdownMethod,
            shutdownCountdownSeconds,
            criticalAlertEnabled,
            criticalShutdownAlertEnabled,
            themeMode,
            nominalVoltage,
            nominalFrequency,
            voltageTolerancePosPct,
            voltageToleranceNegPct,
            frequencyTolerancePosPct,
            frequencyToleranceNegPct,
            lineAlertEnabled,
            lineAlertCooldown,
            locale,
            startWithWindows,
            refreshConfig,
        ],
    );

    if (!config) {
        return (
            <div className="page-loading">
                <div className="reconnect-spinner" />
            </div>
        );
    }

    return (
        <div className="settings-page">
            <header className="page-header">
                <h1 className="page-title">{t('settings.title')}</h1>
            </header>

            <form className="settings-form" onSubmit={handleSave}>
                {/* NUT Connection */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.nutConnection')}</h2>
                    <div className="settings-section-body">
                        <p className="form-hint" style={{ marginBottom: '16px' }}>
                            {t('settings.connectionDescription', 'Launch the setup wizard to reconfigure the NUT server address, port, and authentication details.')}
                        </p>
                        <button
                            type="button"
                            className="btn btn--secondary"
                            onClick={() => navigate('/wizard')}
                        >
                            <Plug size={18} style={{ marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }} />
                            <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>{t('settings.reconfigureConnection', 'Reconfigure connection...')}</span>
                        </button>
                    </div>
                </section>

                {/* Polling */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.polling')}</h2>
                    <div className="settings-section-body">
                        <div className="form-group">
                            <label className="form-label" htmlFor="set-interval">
                                {t('settings.pollInterval')}
                            </label>
                            <div className="form-range-row">
                                <input
                                    id="set-interval"
                                    className="form-range"
                                    type="range"
                                    min={500}
                                    max={60000}
                                    step={500}
                                    value={intervalMs}
                                    onChange={(e) => setIntervalMs(Number(e.target.value))}
                                />
                                <span className="form-range-value">
                                    {intervalMs >= 1000
                                        ? `${(intervalMs / 1000).toFixed(1)}s`
                                        : `${intervalMs}ms`}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Data Retention */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.dataRetention')}</h2>
                    <div className="settings-section-body">
                        <div className="form-group">
                            <label className="form-label" htmlFor="set-retention">
                                {t('settings.retainDataDays')}
                            </label>
                            <input
                                id="set-retention"
                                className="form-input form-input--narrow"
                                type="number"
                                value={retentionDays}
                                onChange={(e) => setRetentionDays(Number(e.target.value))}
                                min={1}
                                max={3650}
                            />
                        </div>
                    </div>
                </section>

                {/* Line Nominal Values */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.lineSettings')}</h2>
                    <div className="settings-section-body">
                        <div className="form-row form-row--two">
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-nominal-voltage">
                                    {t('settings.nominalVoltage')}
                                </label>
                                <input
                                    id="set-nominal-voltage"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={nominalVoltage}
                                    onChange={(e) => setNominalVoltage(Number(e.target.value))}
                                    min={1}
                                    max={500}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-nominal-freq">
                                    {t('settings.nominalFrequency')}
                                </label>
                                <input
                                    id="set-nominal-freq"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={nominalFrequency}
                                    onChange={(e) => setNominalFrequency(Number(e.target.value))}
                                    min={1}
                                    max={100}
                                />
                            </div>
                        </div>

                        <div className="form-row form-row--two">
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-volt-tol-pos">
                                    {t('settings.voltageTolPos', 'Voltage +Tolerance %')}
                                </label>
                                <input
                                    id="set-volt-tol-pos"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={voltageTolerancePosPct}
                                    onChange={(e) => setVoltageTolerancePosPct(Number(e.target.value))}
                                    min={0}
                                    max={100}
                                    step={1}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-volt-tol-neg">
                                    {t('settings.voltageTolNeg', 'Voltage −Tolerance %')}
                                </label>
                                <input
                                    id="set-volt-tol-neg"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={voltageToleranceNegPct}
                                    onChange={(e) => setVoltageToleranceNegPct(Number(e.target.value))}
                                    min={0}
                                    max={100}
                                    step={1}
                                />
                            </div>
                        </div>

                        <div className="form-row form-row--two">
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-freq-tol-pos">
                                    {t('settings.freqTolPos', 'Frequency +Tolerance %')}
                                </label>
                                <input
                                    id="set-freq-tol-pos"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={frequencyTolerancePosPct}
                                    onChange={(e) => setFrequencyTolerancePosPct(Number(e.target.value))}
                                    min={0}
                                    max={100}
                                    step={0.5}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-freq-tol-neg">
                                    {t('settings.freqTolNeg', 'Frequency −Tolerance %')}
                                </label>
                                <input
                                    id="set-freq-tol-neg"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={frequencyToleranceNegPct}
                                    onChange={(e) => setFrequencyToleranceNegPct(Number(e.target.value))}
                                    min={0}
                                    max={100}
                                    step={0.5}
                                />
                            </div>
                        </div>

                        <p className="form-hint">
                            {t('settings.toleranceHint')}
                        </p>

                        <div className="form-row form-row--two" style={{ marginTop: 12 }}>
                            <label className="form-toggle">
                                <input
                                    type="checkbox"
                                    checked={lineAlertEnabled}
                                    onChange={(e) => setLineAlertEnabled(e.target.checked)}
                                />
                                <span className="form-toggle-label">{t('settings.enableLineAlerts')}</span>
                            </label>
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-alert-cooldown">
                                    {t('settings.alertCooldown')}
                                </label>
                                <input
                                    id="set-alert-cooldown"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={lineAlertCooldown}
                                    onChange={(e) => setLineAlertCooldown(Number(e.target.value))}
                                    min={1}
                                    max={1440}
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* Battery Safety */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.batterySafety')}</h2>
                    <div className="settings-section-body">
                        <div className="form-row form-row--two">
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-warn-pct">
                                    {t('settings.warningPct')}
                                </label>
                                <input
                                    id="set-warn-pct"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={warningPct}
                                    onChange={(e) => setWarningPct(Number(e.target.value))}
                                    min={1}
                                    max={100}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="set-shut-pct">
                                    {t('settings.shutdownPct')}
                                </label>
                                <input
                                    id="set-shut-pct"
                                    className="form-input form-input--narrow"
                                    type="number"
                                    value={shutdownPct}
                                    onChange={(e) => setShutdownPct(Number(e.target.value))}
                                    min={1}
                                    max={100}
                                />
                            </div>
                        </div>
                        <div className="form-row form-row--two">
                            <label className="form-toggle">
                                <input
                                    type="checkbox"
                                    checked={warningToastEnabled}
                                    onChange={(e) => setWarningToastEnabled(e.target.checked)}
                                />
                                <span className="form-toggle-label">{t('settings.enableWarningToasts')}</span>
                            </label>
                            <label className="form-toggle">
                                <input
                                    type="checkbox"
                                    checked={shutdownEnabled}
                                    onChange={(e) => setShutdownEnabled(e.target.checked)}
                                />
                                <span className="form-toggle-label">
                                    {t('settings.enableAutoShutdown')}
                                </span>
                            </label>
                        </div>
                        <div className="form-row form-row--two" style={{ marginTop: 8 }}>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label" htmlFor="shutdownMethod">
                                    {t('settings.autoShutdownMethod')}
                                </label>
                                <select
                                    id="shutdownMethod"
                                    className="telemetry-select"
                                    value={shutdownMethod}
                                    onChange={(e) => setShutdownMethod(e.target.value as 'sleep' | 'shutdown')}
                                    disabled={!shutdownEnabled}
                                    style={{ width: '100%' }}
                                >
                                    <option value="sleep">{t('settings.shutdownMethodSleep')}</option>
                                    <option value="shutdown">{t('settings.shutdownMethodFull')}</option>
                                </select>
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label className="form-label" htmlFor="set-shutdown-countdown">
                                    {t('settings.shutdownDelay')}
                                </label>
                                <input
                                    id="set-shutdown-countdown"
                                    className="form-input"
                                    type="number"
                                    value={shutdownCountdownSeconds}
                                    onChange={(e) => setShutdownCountdownSeconds(Number(e.target.value))}
                                    min={1}
                                    max={300}
                                    disabled={!shutdownEnabled}
                                />
                            </div>
                        </div>
                        <div className="form-row form-row--two" style={{ marginTop: 8 }}>
                            <label className="form-toggle">
                                <input
                                    type="checkbox"
                                    checked={criticalAlertEnabled}
                                    onChange={(e) => setCriticalAlertEnabled(e.target.checked)}
                                />
                                <span className="form-toggle-label">{t('settings.warningOverlay')}</span>
                            </label>
                            <label className="form-toggle">
                                <input
                                    type="checkbox"
                                    checked={criticalShutdownAlertEnabled}
                                    onChange={(e) => setCriticalShutdownAlertEnabled(e.target.checked)}
                                />
                                <span className="form-toggle-label">{t('settings.shutdownOverlay')}</span>
                            </label>
                        </div>

                    </div>
                </section>

                {/* Startup */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.startup')}</h2>
                    <div className="settings-section-body">
                        <label className="form-toggle">
                            <input
                                type="checkbox"
                                checked={startWithWindows}
                                onChange={(e) => setStartWithWindows(e.target.checked)}
                            />
                            <span className="form-toggle-label">{t('settings.startWithWindows')}</span>
                        </label>
                    </div>
                </section>

                {/* Appearance */}
                <section className="settings-section">
                    <h2 className="settings-section-title">{t('settings.appearance')}</h2>
                    <div className="settings-section-body">
                        <div className="form-group">
                            <label className="form-label" htmlFor="set-theme">
                                {t('settings.theme')}
                            </label>
                            <div className="theme-selector">
                                {(['light', 'dark', 'system'] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`theme-btn ${themeMode === mode ? 'theme-btn--active' : ''}`}
                                        onClick={async () => {
                                            setThemeMode(mode);
                                            try {
                                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                await (window as any).electronApi.settings.update({ theme: { mode } });
                                                await refreshConfig();
                                            } catch (err) {
                                                console.error("Failed to apply theme", err);
                                            }
                                        }}
                                    >
                                        {mode === 'light' ? <Sun size={18} /> : mode === 'dark' ? <Moon size={18} /> : <Monitor size={18} />}
                                        <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="form-group" style={{ marginTop: 16 }}>
                            <label className="form-label" htmlFor="set-language">
                                {t('settings.language')}
                            </label>
                            <select
                                id="set-language"
                                className="telemetry-select"
                                value={locale}
                                onChange={(e) => {
                                    setLocale(e.target.value);
                                    // Save language change immediately for preview logic or let the user click save?
                                    // The save button makes sense. But language is nice immediately. We'll wait for explicitly saving.
                                }}
                                style={{ width: '100%', maxWidth: 300 }}
                            >
                                <option value="system">{t('settings.system')}</option>
                                <option value="en">{t('settings.en')}</option>
                                <option value="zh">{t('settings.zh')}</option>
                            </select>
                        </div>
                    </div>
                </section>

                {/* Submit */}
                <div className="settings-actions">
                    <button
                        type="submit"
                        className="btn btn--primary"
                        disabled={saving}
                    >
                        {saving ? (
                            <>
                                <span className="btn-spinner" />
                                {t('settings.saving')}
                            </>
                        ) : (
                            t('settings.saveSettings')
                        )}
                    </button>
                </div>
            </form>

            {/* Floating Snackbar */}
            {saveMessage && (
                <div className={`snackbar snackbar--${saveMessage.type}`}>
                    <span className="feedback-icon">
                        {saveMessage.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                    </span>
                    <span>{saveMessage.text}</span>
                </div>
            )}
        </div>
    );
}
