import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../app/providers';
import { XCircle, CheckCircle2, Check } from 'lucide-react';
import { useNavigate as routerUseNavigate } from 'react-router-dom';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const DEFAULT_MAPPING: Record<string, string> = {
    battery_voltage: 'battery.voltage',
    battery_charge_pct: 'battery.charge',
    battery_current: 'battery.current',
    input_voltage: 'input.voltage',
    input_frequency_hz: 'input.frequency',
    input_current: 'input.current',
    output_voltage: 'output.voltage',
    output_frequency_hz: 'output.frequency',
    output_current: 'output.current',
    ups_apparent_power_pct: 'ups.power.percent',
    ups_apparent_power_va: 'ups.power',
    ups_realpower_watts: 'ups.realpower',
    ups_load_pct: 'ups.load',
};



// MAPPING_LABELS moved into component to use t()

function WizardSteps({ currentStep }: { currentStep: 1 | 2 | 3 }) {
    const { t } = useTranslation();

    return (
        <div className="wizard-steps">
            <div className={`wizard-step ${currentStep >= 1 ? (currentStep > 1 ? 'wizard-step--completed' : 'wizard-step--active') : ''}`}>
                <div className="wizard-step-circle">{currentStep > 1 ? <Check size={14} /> : '1'}</div>
                <span>{t('wizard.stepConnect', 'Connect')}</span>
            </div>
            <div className={`wizard-step-separator ${currentStep > 1 ? 'wizard-step-separator--active' : ''}`} />

            <div className={`wizard-step ${currentStep >= 2 ? (currentStep > 2 ? 'wizard-step--completed' : 'wizard-step--active') : ''}`}>
                <div className="wizard-step-circle">{currentStep > 2 ? <Check size={14} /> : '2'}</div>
                <span>{t('wizard.stepMap', 'Map')}</span>
            </div>
            <div className={`wizard-step-separator ${currentStep > 2 ? 'wizard-step-separator--active' : ''}`} />

            <div className={`wizard-step ${currentStep === 3 ? 'wizard-step--active' : ''}`}>
                <div className="wizard-step-circle">3</div>
                <span>{t('wizard.stepLine', 'Line')}</span>
            </div>
        </div>
    );
}

export function SetupWizardPage() {
    const navigate = routerUseNavigate();
    const { config, refreshConfig } = useAppConfig();
    const { t } = useTranslation();

    const MAPPING_LABELS: Record<string, string> = {
        battery_voltage: t('metrics.batteryVoltage'),
        battery_charge_pct: t('metrics.batteryCharge'),
        battery_current: t('metrics.batteryCurrent'),
        input_voltage: t('metrics.inputVoltage'),
        input_frequency_hz: t('metrics.inputFrequency'),
        input_current: t('metrics.inputCurrent'),
        output_voltage: t('metrics.outputVoltage'),
        output_frequency_hz: t('metrics.outputFrequency'),
        output_current: t('metrics.outputCurrent'),
        ups_apparent_power_pct: t('wizard.apparentPowerPct', 'Apparent Power %'),
        ups_apparent_power_va: t('metrics.apparentPower'),
        ups_realpower_watts: t('metrics.realPower'),
        ups_load_pct: t('metrics.upsLoad'),
    };

    const [step, setStep] = useState<1 | 2 | 3>(1);

    const [host, setHost] = useState(config?.nut?.host || '127.0.0.1');
    const [port, setPort] = useState(config?.nut?.port || 3493);
    const [username, setUsername] = useState(config?.nut?.username || '');
    const [password, setPassword] = useState(config?.nut?.password || '');
    const [upsName, setUpsName] = useState(config?.nut?.upsName || 'snmpups');

    const [testStatus, setTestStatus] = useState<TestStatus>('idle');
    const [testError, setTestError] = useState<string | null>(null);
    const [upsDescription, setUpsDescription] = useState<string | null>(null);
    const [completing, setCompleting] = useState(false);

    // Mapping step state
    const [availableVariables, setAvailableVariables] = useState<string[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>(config?.nut?.mapping || DEFAULT_MAPPING);

    // Line nominal values (step 3)
    const [nominalVoltage, setNominalVoltage] = useState(config?.line?.nominalVoltage || 220);
    const [nominalFrequency, setNominalFrequency] = useState(config?.line?.nominalFrequency || 50);

    const handleTestConnection = useCallback(async () => {
        setTestStatus('testing');
        setTestError(null);
        setUpsDescription(null);

        try {
            const result = await (window as unknown as { electronApi: { wizard: { testConnection: (cfg: { host: string; port: number; username?: string; password?: string; upsName: string }) => Promise<{ success: boolean; upsDescription?: string; error?: string; variables?: Record<string, string> }> } } }).electronApi.wizard.testConnection({
                host,
                port,
                username: username || undefined,
                password: password || undefined,
                upsName,
            });

            if (result.success) {
                setTestStatus('success');
                setUpsDescription(result.upsDescription ?? null);

                // Initialize mapping fields
                const vars = result.variables ? Object.keys(result.variables) : [];
                setAvailableVariables(vars);

                // Pre-fill mapping with found exact matches
                const newMapping = { ...DEFAULT_MAPPING };
                for (const [key, defaultVal] of Object.entries(DEFAULT_MAPPING)) {
                    if (!vars.includes(defaultVal) && vars.length > 0) {
                        newMapping[key] = ''; // clear if not found so user must select
                    }
                }
                setMapping(newMapping);
            } else {
                setTestStatus('error');
                setTestError(result.error ?? 'Connection test failed');
            }
        } catch (err) {
            setTestStatus('error');
            setTestError(err instanceof Error ? err.message : 'Unexpected error');
        }
    }, [host, port, username, password, upsName]);

    const handleComplete = useCallback(async () => {
        setCompleting(true);

        try {
            // Remove empty mappings
            const cleanMapping: Record<string, string> = {};
            for (const [key, val] of Object.entries(mapping)) {
                if (val) cleanMapping[key] = val;
            }

            await (window as unknown as { electronApi: { wizard: { complete: (cfg: Record<string, unknown>) => Promise<void> } } }).electronApi.wizard.complete({
                host,
                port,
                username: username || undefined,
                password: password || undefined,
                upsName,
                mapping: cleanMapping,
                line: { nominalVoltage, nominalFrequency },
            });

            await refreshConfig();
            navigate('/dashboard', { replace: true });
        } catch (err) {
            setTestError(err instanceof Error ? err.message : 'Failed to save');
            setCompleting(false);
        }
    }, [host, port, username, password, upsName, mapping, nominalVoltage, nominalFrequency, navigate, refreshConfig]);

    if (step === 2) {
        return (
            <div className="wizard-backdrop">
                <div className="wizard-card" style={{ maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                    <div className="wizard-header">
                        <WizardSteps currentStep={2} />
                        <h1 className="wizard-title">{t('wizard.mapTitle')}</h1>
                        <p className="wizard-subtitle">
                            {t('wizard.mapSubtitle', { count: availableVariables.length })}
                        </p>
                    </div>

                    <div className="wizard-form" style={{ overflowY: 'auto', paddingRight: '12px', flex: 1 }}>
                        {Object.entries(MAPPING_LABELS).map(([key, label]) => (
                            <div className="form-group" key={key}>
                                <label className="form-label">{label}</label>
                                <select
                                    className="form-input"
                                    value={mapping[key] || ''}
                                    onChange={(e) => setMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                >
                                    <option value="">-- {t('wizard.none')} --</option>
                                    {availableVariables.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))}
                                    {/* Include current value if it's not in the variables list but was defaulted */}
                                    {mapping[key] && !availableVariables.includes(mapping[key]) && (
                                        <option value={mapping[key]}>{mapping[key]} ({t('wizard.notFound')})</option>
                                    )}
                                </select>
                            </div>
                        ))}
                    </div>

                    {testError && (
                        <div className="wizard-feedback wizard-feedback--error" style={{ flexShrink: 0 }}>
                            <span className="feedback-icon"><XCircle size={20} /></span>
                            <span>{testError}</span>
                        </div>
                    )}

                    <div className="wizard-actions" style={{ flexShrink: 0, marginTop: '20px' }}>
                        <button
                            className="btn btn--secondary"
                            onClick={() => setStep(1)}
                            disabled={completing}
                        >
                            {t('wizard.back')}
                        </button>

                        <button
                            className="btn btn--primary"
                            onClick={() => setStep(3)}
                            disabled={completing}
                        >
                            {t('wizard.continue')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Step 3: Confirm line nominal values
    if (step === 3) {
        return (
            <div className="wizard-backdrop">
                <div className="wizard-card" style={{ maxWidth: '500px' }}>
                    <div className="wizard-header">
                        <WizardSteps currentStep={3} />
                        <h1 className="wizard-title">{t('wizard.lineTitle')}</h1>
                        <p className="wizard-subtitle">
                            {t('wizard.lineSubtitle')}
                        </p>
                    </div>

                    <div className="wizard-form">
                        <div className="form-row form-row--two">
                            <div className="form-group">
                                <label className="form-label" htmlFor="wiz-nom-voltage">
                                    {t('wizard.nominalVoltage')}
                                </label>
                                <input
                                    id="wiz-nom-voltage"
                                    className="form-input"
                                    type="number"
                                    value={nominalVoltage}
                                    onChange={(e) => setNominalVoltage(Number(e.target.value))}
                                    min={1}
                                    max={500}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="wiz-nom-freq">
                                    {t('wizard.nominalFrequency')}
                                </label>
                                <input
                                    id="wiz-nom-freq"
                                    className="form-input"
                                    type="number"
                                    value={nominalFrequency}
                                    onChange={(e) => setNominalFrequency(Number(e.target.value))}
                                    min={1}
                                    max={100}
                                />
                            </div>
                        </div>
                    </div>

                    {testError && (
                        <div className="wizard-feedback wizard-feedback--error" style={{ flexShrink: 0 }}>
                            <span className="feedback-icon"><XCircle size={20} /></span>
                            <span>{testError}</span>
                        </div>
                    )}

                    <div className="wizard-actions">
                        <button
                            className="btn btn--secondary"
                            onClick={() => setStep(2)}
                            disabled={completing}
                        >
                            {t('wizard.back')}
                        </button>

                        <button
                            className="btn btn--primary"
                            onClick={handleComplete}
                            disabled={completing || nominalVoltage <= 0 || nominalFrequency <= 0}
                        >
                            {completing ? (
                                <>
                                    <span className="btn-spinner" />
                                    {t('wizard.saving')}
                                </>
                            ) : (
                                t('wizard.completeSetup')
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="wizard-backdrop">
            <div className="wizard-card">
                {/* Header */}
                <div className="wizard-header">
                    <WizardSteps currentStep={1} />
                    <h1 className="wizard-title">{t('wizard.connectTitle')}</h1>
                    <p className="wizard-subtitle">
                        {t('wizard.connectSubtitle')}
                    </p>
                </div>

                {/* Form */}
                <div className="wizard-form">
                    <div className="form-row form-row--two">
                        <div className="form-group">
                            <label className="form-label" htmlFor="wiz-host">
                                {t('settings.host')}
                            </label>
                            <input
                                id="wiz-host"
                                className="form-input"
                                type="text"
                                value={host}
                                onChange={(e) => {
                                    setHost(e.target.value);
                                    setTestStatus('idle');
                                }}
                                placeholder="127.0.0.1"
                            />
                        </div>
                        <div className="form-group form-group--port">
                            <label className="form-label" htmlFor="wiz-port">
                                {t('settings.port')}
                            </label>
                            <input
                                id="wiz-port"
                                className="form-input"
                                type="number"
                                value={port}
                                onChange={(e) => {
                                    setPort(Number(e.target.value));
                                    setTestStatus('idle');
                                }}
                                min={1}
                                max={65535}
                            />
                        </div>
                    </div>

                    <div className="form-row form-row--two">
                        <div className="form-group">
                            <label className="form-label" htmlFor="wiz-user">
                                {t('settings.username')} <span className="form-hint">{t('settings.optional', '(optional)')}</span>
                            </label>
                            <input
                                id="wiz-user"
                                className="form-input"
                                type="text"
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.target.value);
                                    setTestStatus('idle');
                                }}
                                placeholder="admin"
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="wiz-pass">
                                {t('settings.password')} <span className="form-hint">{t('settings.optional', '(optional)')}</span>
                            </label>
                            <input
                                id="wiz-pass"
                                className="form-input"
                                type="password"
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setTestStatus('idle');
                                }}
                                placeholder="••••••"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="wiz-ups">
                            {t('settings.upsName')}
                        </label>
                        <input
                            id="wiz-ups"
                            className="form-input"
                            type="text"
                            value={upsName}
                            onChange={(e) => {
                                setUpsName(e.target.value);
                                setTestStatus('idle');
                            }}
                            placeholder="snmpups"
                        />
                    </div>
                </div>

                {/* Status feedback */}
                {testStatus === 'success' && (
                    <div className="wizard-feedback wizard-feedback--success">
                        <span className="feedback-icon"><CheckCircle2 size={20} /></span>
                        <span>
                            {t('wizard.testSuccess')}
                            {upsDescription ? ` — ${upsDescription} ` : ''}
                        </span>
                    </div>
                )}

                {testStatus === 'error' && testError && (
                    <div className="wizard-feedback wizard-feedback--error">
                        <span className="feedback-icon"><XCircle size={20} /></span>
                        <span>{testError}</span>
                    </div>
                )}

                {/* Actions */}
                <div className="wizard-actions">
                    <button
                        className="btn btn--secondary"
                        onClick={handleTestConnection}
                        disabled={testStatus === 'testing' || !host || !upsName}
                    >
                        {testStatus === 'testing' ? (
                            <>
                                <span className="btn-spinner" />
                                {t('wizard.testing')}
                            </>
                        ) : (
                            t('wizard.testConnection')
                        )}
                    </button>

                    <button
                        className="btn btn--primary"
                        onClick={() => setStep(2)}
                        disabled={testStatus !== 'success'}
                    >
                        {t('wizard.continueToMapping')}
                    </button>
                </div>
            </div>
        </div>
    );
}
