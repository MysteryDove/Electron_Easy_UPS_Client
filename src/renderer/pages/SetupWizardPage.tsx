import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../app/providers';
import {
  XCircle,
  CheckCircle2,
  Check,
  ShieldAlert,
  Download,
  FolderOpen,
  Router,
  MonitorCog,
} from 'lucide-react';
import { useNavigate as routerUseNavigate } from 'react-router-dom';
import type {
  NutSetupPrepareLocalNutPayload,
  NutSetupValidateFolderResult,
} from '../../main/ipc/ipcChannels';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type InstallStatus = 'idle' | 'installing' | 'success' | 'error';
type WizardStep = 'choose' | 'nutSetup' | 'connect' | 'map' | 'line';
type SetupMode = 'directNut' | 'snmpSetup';
type SnmpVersion = 'v1' | 'v2c' | 'v3';
type SecLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
type AuthProtocol = 'MD5' | 'SHA';
type PrivProtocol = 'DES' | 'AES';

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

const UPS_NAME_PATTERN = /^[a-zA-Z0-9-]+$/;
const IPV4_OCTET_PATTERN = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const SNMP_TARGET_PATTERN = new RegExp(
  `^${IPV4_OCTET_PATTERN}(?:\\.${IPV4_OCTET_PATTERN}){3}(?::([1-9]\\d{0,4}))?$`,
);

function WizardSteps({
  currentStep,
  mode,
}: {
  currentStep: Exclude<WizardStep, 'choose'>;
  mode: SetupMode;
}) {
  const { t } = useTranslation();
  const steps =
    mode === 'snmpSetup'
      ? [
        { id: 'nutSetup', label: t('wizard.stepSetup', 'NUT Setup') },
        { id: 'connect', label: t('wizard.stepConnect', 'Connect') },
        { id: 'map', label: t('wizard.stepMap', 'Map') },
        { id: 'line', label: t('wizard.stepLine', 'Line') },
      ]
      : [
        { id: 'connect', label: t('wizard.stepConnect', 'Connect') },
        { id: 'map', label: t('wizard.stepMap', 'Map') },
        { id: 'line', label: t('wizard.stepLine', 'Line') },
      ];

  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <div className="wizard-steps">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isActive = index === currentIndex;
        const className = isCompleted
          ? 'wizard-step wizard-step--completed'
          : isActive
            ? 'wizard-step wizard-step--active'
            : 'wizard-step';

        return (
          <div
            key={step.id}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}
          >
            <div className={className}>
              <div className="wizard-step-circle">
                {isCompleted ? <Check size={14} /> : String(index + 1)}
              </div>
              <span>{step.label}</span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`wizard-step-separator ${isCompleted ? 'wizard-step-separator--active' : ''}`}
              />
            )}
          </div>
        );
      })}
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

  const [mode, setMode] = useState<SetupMode>('directNut');
  const [step, setStep] = useState<WizardStep>('choose');

  const [host, setHost] = useState(config?.nut?.host || '127.0.0.1');
  const [port, setPort] = useState(config?.nut?.port || 3493);
  const [username, setUsername] = useState(config?.nut?.username || '');
  const [password, setPassword] = useState(config?.nut?.password || '');
  const [upsName, setUpsName] = useState(config?.nut?.upsName || 'snmpups');

  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [upsDescription, setUpsDescription] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const [availableVariables, setAvailableVariables] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>(
    config?.nut?.mapping || DEFAULT_MAPPING,
  );

  const [nominalVoltage, setNominalVoltage] = useState(
    config?.line?.nominalVoltage || 220,
  );
  const [nominalFrequency, setNominalFrequency] = useState(
    config?.line?.nominalFrequency || 50,
  );

  const [nutFolderPath, setNutFolderPath] = useState('');
  const [folderValidation, setFolderValidation] =
    useState<NutSetupValidateFolderResult | null>(null);
  const [validatingFolder, setValidatingFolder] = useState(false);

  const [snmpTarget, setSnmpTarget] = useState('');
  const [snmpVersion, setSnmpVersion] = useState<SnmpVersion>('v2c');
  const [mibs, setMibs] = useState('auto');
  const [community, setCommunity] = useState('public');
  const [pollfreq, setPollfreq] = useState(5);

  const [secLevel, setSecLevel] = useState<SecLevel>('noAuthNoPriv');
  const [secName, setSecName] = useState('');
  const [authProtocol, setAuthProtocol] = useState<AuthProtocol>('MD5');
  const [authPassword, setAuthPassword] = useState('');
  const [privProtocol, setPrivProtocol] = useState<PrivProtocol>('AES');
  const [privPassword, setPrivPassword] = useState('');

  const [installStatus, setInstallStatus] = useState<InstallStatus>('idle');
  const [installError, setInstallError] = useState<string | null>(null);

  const upsNameValid = UPS_NAME_PATTERN.test(upsName);
  const snmpTargetValid = isValidSnmpTarget(snmpTarget);
  const pollfreqValid = Number.isInteger(pollfreq) && pollfreq >= 3 && pollfreq <= 15;
  const authRequired = snmpVersion === 'v3' && (secLevel === 'authNoPriv' || secLevel === 'authPriv');
  const privRequired = snmpVersion === 'v3' && secLevel === 'authPriv';
  const v3Valid =
    snmpVersion !== 'v3' ||
    (secName.trim().length > 0 &&
      (!authRequired ||
        (authProtocol.length > 0 && authPassword.trim().length > 0)) &&
      (!privRequired ||
        (privProtocol.length > 0 && privPassword.trim().length > 0)));
  const hasFolderValidation = !validatingFolder && folderValidation !== null;
  const isFolderValid = hasFolderValidation && folderValidation.valid;
  const requiresUac = isFolderValid && !folderValidation.writable;

  const canPrepareLocalNut =
    isFolderValid &&
    upsNameValid &&
    snmpTargetValid &&
    pollfreqValid &&
    v3Valid &&
    !validatingFolder &&
    installStatus !== 'installing';

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestError(null);
    setUpsDescription(null);

    try {
      const result = await window.electronApi.wizard.testConnection({
        host,
        port,
        username: username || undefined,
        password: password || undefined,
        upsName,
      });

      if (result.success) {
        setTestStatus('success');
        setUpsDescription(result.upsDescription ?? null);

        const vars = result.variables ? Object.keys(result.variables) : [];
        setAvailableVariables(vars);

        const newMapping = { ...DEFAULT_MAPPING };
        for (const [key, defaultVal] of Object.entries(DEFAULT_MAPPING)) {
          if (!vars.includes(defaultVal) && vars.length > 0) {
            newMapping[key] = '';
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
      const cleanMapping: Record<string, string> = {};
      for (const [key, value] of Object.entries(mapping)) {
        if (value) {
          cleanMapping[key] = value;
        }
      }

      await window.electronApi.wizard.complete({
        host,
        port,
        username: username || undefined,
        password: password || undefined,
        upsName,
        mapping: cleanMapping,
        line: { nominalVoltage, nominalFrequency },
        launchLocalComponents: mode === 'snmpSetup',
        localNutFolderPath:
          mode === 'snmpSetup' ? nutFolderPath : undefined,
      });

      await refreshConfig();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Failed to save');
      setCompleting(false);
    }
  }, [
    host,
    port,
    username,
    password,
    upsName,
    mapping,
    nominalVoltage,
    nominalFrequency,
    mode,
    nutFolderPath,
    navigate,
    refreshConfig,
  ]);

  const handleChooseNutFolder = useCallback(async () => {
    setInstallStatus('idle');
    setInstallError(null);

    try {
      const selection = await window.electronApi.nutSetup.chooseFolder();
      if (selection.cancelled || !selection.folderPath) {
        return;
      }

      setNutFolderPath(selection.folderPath);
      setFolderValidation(null);
      setValidatingFolder(true);

      const validation = await window.electronApi.nutSetup.validateFolder({
        folderPath: selection.folderPath,
      });
      setFolderValidation(validation);
    } catch (err) {
      setFolderValidation(null);
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to choose folder');
    } finally {
      setValidatingFolder(false);
    }
  }, []);

  const handlePrepareLocalNut = useCallback(async () => {
    if (!canPrepareLocalNut) {
      return;
    }

    setInstallStatus('installing');
    setInstallError(null);

    try {
      const payload: NutSetupPrepareLocalNutPayload = {
        folderPath: nutFolderPath,
        upsName,
        port: snmpTarget,
        snmpVersion,
        mibs: mibs || 'auto',
        community: community || 'public',
        pollfreq,
      };

      if (snmpVersion === 'v3') {
        payload.secLevel = secLevel;
        payload.secName = secName;

        if (secLevel === 'authNoPriv' || secLevel === 'authPriv') {
          payload.authProtocol = authProtocol;
          payload.authPassword = authPassword;
        }

        if (secLevel === 'authPriv') {
          payload.privProtocol = privProtocol;
          payload.privPassword = privPassword;
        }
      }

      const result = await window.electronApi.nutSetup.prepareLocalNut(payload);
      if (!result.success) {
        setInstallStatus('error');
        setInstallError(result.error ?? 'Failed to configure and start local NUT');
        return;
      }

      setInstallStatus('success');
      setInstallError(null);
      setHost('127.0.0.1');
      setPort(3493);
      setTestStatus('idle');
      setTestError(null);
      setUpsDescription(null);
      window.setTimeout(() => {
        setStep('connect');
      }, 900);
    } catch (err) {
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to configure and start local NUT');
    }
  }, [
    canPrepareLocalNut,
    nutFolderPath,
    upsName,
    snmpTarget,
    snmpVersion,
    mibs,
    community,
    pollfreq,
    secLevel,
    secName,
    authProtocol,
    authPassword,
    privProtocol,
    privPassword,
  ]);

  if (step === 'choose') {
    return (
      <div className="wizard-backdrop">
        <div className="wizard-card" style={{ maxWidth: '680px' }}>
          <div className="wizard-header">
            <h1 className="wizard-title">{t('wizard.chooseMode', 'How would you like to connect?')}</h1>
            <p className="wizard-subtitle">{t('wizard.connectSubtitle')}</p>
          </div>

          <div
            className="wizard-form"
            style={{ display: 'grid', gap: '12px', marginBottom: '0' }}
          >
            <button
              className="btn btn--secondary"
              onClick={() => {
                setMode('directNut');
                setInstallStatus('idle');
                setInstallError(null);
                setStep('connect');
              }}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
                padding: '16px',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                <strong>{t('wizard.modeNutDirect', 'Connect to NUT Server')}</strong>
                <span className="form-hint">
                  {t('wizard.modeNutDirectDesc', 'I already have a NUT server running')}
                </span>
              </span>
              <Router
                size={20}
                style={{ flexShrink: 0, marginLeft: '12px' }}
              />
            </button>

            <button
              className="btn btn--secondary"
              onClick={() => {
                setMode('snmpSetup');
                setInstallStatus('idle');
                setInstallError(null);
                setStep('nutSetup');
              }}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left',
                padding: '16px',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                <strong>{t('wizard.modeSnmpSetup', 'Set Up SNMP UPS')}</strong>
                <span className="form-hint">
                  {t('wizard.modeSnmpSetupDesc', 'Help me configure NUT to monitor an SNMP UPS')}
                </span>
              </span>
              <MonitorCog
                size={20}
                style={{ flexShrink: 0, marginLeft: '12px' }}
              />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'nutSetup') {
    return (
      <div className="wizard-backdrop">
        <div className="wizard-card" style={{ maxWidth: '780px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          <div className="wizard-header">
            <WizardSteps currentStep="nutSetup" mode={mode} />
            <h1 className="wizard-title">{t('wizard.nutDownloadTitle', 'Configure NUT for Windows')}</h1>
            <p className="wizard-subtitle">
              {t(
                'wizard.nutDownloadDesc',
                'Download the latest NUT for Windows release, decompress the zip file into a new folder, then select the folder below.',
              )}
            </p>
          </div>

          <div className="wizard-form" style={{ overflowY: 'auto', paddingRight: '12px', flex: 1 }}>
            <div className="form-group">
              <a
                className="btn btn--secondary"
                href="https://github.com/networkupstools/nut/releases"
                target="_blank"
                rel="noreferrer"
                style={{ width: 'fit-content' }}
              >
                <Download size={16} />
                {t('wizard.nutDownloadLink', 'Download NUT from GitHub Releases')}
              </a>
            </div>

            <div className="form-group">
              <button
                className="btn btn--secondary"
                onClick={handleChooseNutFolder}
                disabled={validatingFolder || installStatus === 'installing'}
                type="button"
                style={{ width: 'fit-content' }}
              >
                <FolderOpen size={16} />
                {t('wizard.nutChooseFolder', 'Choose NUT Folder')}
              </button>
              {nutFolderPath && (
                <input
                  className="form-input"
                  type="text"
                  value={nutFolderPath}
                  readOnly
                />
              )}
            </div>

            {isFolderValid && (
              <div className="wizard-feedback wizard-feedback--success">
                <span className="feedback-icon"><CheckCircle2 size={20} /></span>
                <span>{t('wizard.nutFolderValid', 'NUT folder structure verified')}</span>
              </div>
            )}

            {hasFolderValidation && !folderValidation.valid && (
              <div className="wizard-feedback wizard-feedback--error">
                <span className="feedback-icon"><XCircle size={20} /></span>
                <span>
                  {t('wizard.nutFolderInvalid', 'Folder is not a valid NUT folder')}
                </span>
              </div>
            )}

            {requiresUac && (
              <div className="wizard-feedback wizard-feedback--error">
                <span className="feedback-icon"><ShieldAlert size={20} /></span>
                <span>
                  {t(
                    'wizard.nutFolderNeedsUac',
                    'NUT folder structure is valid, but writing config requires administrator permission. Click "Ask for UAC" to continue.',
                  )}
                </span>
              </div>
            )}

            <h2
              style={{
                fontSize: '0.96rem',
                fontWeight: 600,
                marginBottom: '10px',
              }}
            >
              {t('wizard.snmpConfigTitle', 'SNMP UPS Configuration')}
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="wiz-snmp-ups-name">
                {t('wizard.snmpUpsName', 'UPS Name')}
              </label>
              <input
                id="wiz-snmp-ups-name"
                className="form-input"
                type="text"
                value={upsName}
                onChange={(e) => {
                  setUpsName(e.target.value);
                  setInstallStatus('idle');
                }}
                placeholder="snmpups"
              />
              <span className="form-hint">
                {t('wizard.snmpUpsNameHint', 'Letters, numbers, and hyphens only')}
              </span>
              {!upsNameValid && upsName.length > 0 && (
                <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
                  {t('wizard.upsNameInvalid', 'UPS name may only contain letters, numbers, and hyphens')}
                </span>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wiz-snmp-target">
                {t('wizard.snmpPort', 'SNMP Target (IP or IP:port)')}
              </label>
              <input
                id="wiz-snmp-target"
                className="form-input"
                type="text"
                value={snmpTarget}
                onChange={(e) => {
                  setSnmpTarget(e.target.value);
                  setInstallStatus('idle');
                }}
                placeholder="192.168.1.100 or 192.168.1.100:161"
              />
              {!snmpTargetValid && snmpTarget.length > 0 && (
                <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
                  {t('wizard.snmpPortInvalid', 'Enter a valid IP address or IP:port')}
                </span>
              )}
            </div>

            <div className="form-row form-row--two">
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-snmp-version">
                  {t('wizard.snmpVersion', 'SNMP Version')}
                </label>
                <select
                  id="wiz-snmp-version"
                  className="form-input"
                  value={snmpVersion}
                  onChange={(e) => {
                    setSnmpVersion(e.target.value as SnmpVersion);
                    setInstallStatus('idle');
                  }}
                >
                  <option value="v1">v1</option>
                  <option value="v2c">v2c</option>
                  <option value="v3">v3</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-snmp-pollfreq">
                  {t('wizard.snmpPollFreq', 'Poll Frequency (sec)')}
                </label>
                <input
                  id="wiz-snmp-pollfreq"
                  className="form-input"
                  type="number"
                  value={pollfreq}
                  min={3}
                  max={15}
                  onChange={(e) => {
                    setPollfreq(Number(e.target.value));
                    setInstallStatus('idle');
                  }}
                />
              </div>
            </div>

            <div className="form-row form-row--two">
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-snmp-mibs">
                  {t('wizard.snmpMibs', 'MIBs')}
                </label>
                <input
                  id="wiz-snmp-mibs"
                  className="form-input"
                  type="text"
                  value={mibs}
                  onChange={(e) => {
                    setMibs(e.target.value);
                    setInstallStatus('idle');
                  }}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-snmp-community">
                  {t('wizard.snmpCommunity', 'Community')}
                </label>
                <input
                  id="wiz-snmp-community"
                  className="form-input"
                  type="text"
                  value={community}
                  onChange={(e) => {
                    setCommunity(e.target.value);
                    setInstallStatus('idle');
                  }}
                />
              </div>
            </div>

            {snmpVersion === 'v3' && (
              <>
                <div className="form-row form-row--two">
                  <div className="form-group">
                    <label className="form-label" htmlFor="wiz-snmp-seclevel">
                      {t('wizard.snmpSecLevel', 'Security Level')}
                    </label>
                    <select
                      id="wiz-snmp-seclevel"
                      className="form-input"
                      value={secLevel}
                      onChange={(e) => {
                        setSecLevel(e.target.value as SecLevel);
                        setInstallStatus('idle');
                      }}
                    >
                      <option value="noAuthNoPriv">noAuthNoPriv</option>
                      <option value="authNoPriv">authNoPriv</option>
                      <option value="authPriv">authPriv</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="wiz-snmp-secname">
                      {t('wizard.snmpSecName', 'Security Name')}
                    </label>
                    <input
                      id="wiz-snmp-secname"
                      className="form-input"
                      type="text"
                      value={secName}
                      onChange={(e) => {
                        setSecName(e.target.value);
                        setInstallStatus('idle');
                      }}
                    />
                  </div>
                </div>

                {(secLevel === 'authNoPriv' || secLevel === 'authPriv') && (
                  <div className="form-row form-row--two">
                    <div className="form-group">
                      <label className="form-label" htmlFor="wiz-snmp-auth-proto">
                        {t('wizard.snmpAuthProtocol', 'Auth Protocol')}
                      </label>
                      <select
                        id="wiz-snmp-auth-proto"
                        className="form-input"
                        value={authProtocol}
                        onChange={(e) => {
                          setAuthProtocol(e.target.value as AuthProtocol);
                          setInstallStatus('idle');
                        }}
                      >
                        <option value="MD5">MD5</option>
                        <option value="SHA">SHA</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="wiz-snmp-auth-pass">
                        {t('wizard.snmpAuthPassword', 'Auth Password')}
                      </label>
                      <input
                        id="wiz-snmp-auth-pass"
                        className="form-input"
                        type="password"
                        value={authPassword}
                        onChange={(e) => {
                          setAuthPassword(e.target.value);
                          setInstallStatus('idle');
                        }}
                      />
                    </div>
                  </div>
                )}

                {secLevel === 'authPriv' && (
                  <div className="form-row form-row--two">
                    <div className="form-group">
                      <label className="form-label" htmlFor="wiz-snmp-priv-proto">
                        {t('wizard.snmpPrivProtocol', 'Priv Protocol')}
                      </label>
                      <select
                        id="wiz-snmp-priv-proto"
                        className="form-input"
                        value={privProtocol}
                        onChange={(e) => {
                          setPrivProtocol(e.target.value as PrivProtocol);
                          setInstallStatus('idle');
                        }}
                      >
                        <option value="DES">DES</option>
                        <option value="AES">AES</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="wiz-snmp-priv-pass">
                        {t('wizard.snmpPrivPassword', 'Priv Password')}
                      </label>
                      <input
                        id="wiz-snmp-priv-pass"
                        className="form-input"
                        type="password"
                        value={privPassword}
                        onChange={(e) => {
                          setPrivPassword(e.target.value);
                          setInstallStatus('idle');
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <p className="form-hint">
              {t(
                'wizard.prepareHint',
                'This writes NUT configuration files (ups.conf, upsd.conf) and starts local snmp-ups/upsd immediately. If the folder is protected, an Administrator permission prompt will appear.',
              )}
            </p>

            {installStatus === 'success' && (
              <div className="wizard-feedback wizard-feedback--success">
                <span className="feedback-icon"><CheckCircle2 size={20} /></span>
                <span>{t('wizard.configApplied', 'NUT configured and local processes started successfully')}</span>
              </div>
            )}

            {installStatus === 'error' && installError && (
              <div className="wizard-feedback wizard-feedback--error">
                <span className="feedback-icon"><XCircle size={20} /></span>
                <span>{installError}</span>
              </div>
            )}
          </div>

          <div className="wizard-actions" style={{ flexShrink: 0, marginTop: '20px' }}>
            <button
              className="btn btn--secondary"
              onClick={() => setStep('choose')}
              disabled={installStatus === 'installing'}
            >
              {t('wizard.back')}
            </button>

            <button
              className="btn btn--primary"
              onClick={handlePrepareLocalNut}
              disabled={!canPrepareLocalNut}
            >
              {installStatus === 'installing' ? (
                <>
                  <span className="btn-spinner" />
                  {t('wizard.applyingConfig', 'Configuring and starting...')}
                </>
              ) : (
                requiresUac ? (
                  <>
                    <ShieldAlert size={16} />
                    {t('wizard.askForUac', 'Ask for UAC')}
                  </>
                ) : (
                  t('wizard.prepareLocalNut', 'Configure and Start Local NUT')
                )
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'map') {
    return (
      <div className="wizard-backdrop">
        <div className="wizard-card" style={{ maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          <div className="wizard-header">
            <WizardSteps currentStep="map" mode={mode} />
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
                  onChange={(e) => setMapping((previous) => ({
                    ...previous,
                    [key]: e.target.value,
                  }))}
                >
                  <option value="">-- {t('wizard.none')} --</option>
                  {availableVariables.map((variableName) => (
                    <option key={variableName} value={variableName}>{variableName}</option>
                  ))}
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
              onClick={() => setStep('connect')}
              disabled={completing}
            >
              {t('wizard.back')}
            </button>

            <button
              className="btn btn--primary"
              onClick={() => setStep('line')}
              disabled={completing}
            >
              {t('wizard.continue')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'line') {
    return (
      <div className="wizard-backdrop">
        <div
          className="wizard-card"
          style={{ maxWidth: mode === 'snmpSetup' ? '680px' : '560px' }}
        >
          <div className="wizard-header">
            <WizardSteps currentStep="line" mode={mode} />
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
              onClick={() => setStep('map')}
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
        <div className="wizard-header">
          <WizardSteps currentStep="connect" mode={mode} />
          <h1 className="wizard-title">{t('wizard.connectTitle')}</h1>
          <p className="wizard-subtitle">
            {t('wizard.connectSubtitle')}
          </p>
        </div>

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
                placeholder="******"
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

        {testStatus === 'success' && (
          <div className="wizard-feedback wizard-feedback--success">
            <span className="feedback-icon"><CheckCircle2 size={20} /></span>
            <span>
              {t('wizard.testSuccess')}
              {upsDescription ? ` - ${upsDescription}` : ''}
            </span>
          </div>
        )}

        {testStatus === 'error' && testError && (
          <div className="wizard-feedback wizard-feedback--error">
            <span className="feedback-icon"><XCircle size={20} /></span>
            <span>{testError}</span>
          </div>
        )}

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
            onClick={() => setStep('map')}
            disabled={testStatus !== 'success'}
          >
            {t('wizard.continueToMapping')}
          </button>
        </div>
      </div>
    </div>
  );
}

function isValidSnmpTarget(value: string): boolean {
  if (!value) {
    return false;
  }

  const match = value.trim().match(SNMP_TARGET_PATTERN);
  if (!match) {
    return false;
  }

  if (!match[1]) {
    return true;
  }

  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
