import { useState, useCallback, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppConfig } from '../app/providers';
import {
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { useNavigate as routerUseNavigate } from 'react-router-dom';
import type {
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalDriverResult,
  NutSetupPrepareLocalNutPayload,
  NutSetupPrepareUsbHidPayload,
  NutSetupPrepareUsbHidResult,
  NutSetupValidateFolderResult,
} from '../../shared/ipc/contracts';
import { ChooseSetupModeStep } from './setupWizard/ChooseSetupModeStep';
import { NutSetupStep } from './setupWizard/NutSetupStep';
import { WizardSteps } from './setupWizard/WizardSteps';
import type {
  AuthProtocol,
  InstallStatus,
  PrivProtocol,
  SecLevel,
  SetupMode,
  SnmpVersion,
  TestStatus,
  WizardStep,
} from './setupWizard/types';
import {
  isValidPollfreq,
  isValidSnmpTarget,
  isValidSnmpV3Configuration,
  isValidUpsName,
  isValidUsbDeviceId,
  normalizeComPort,
  normalizeUsbDeviceId,
} from '../../shared/wizard/validation';
import { hasNoMatchingUsbHidUpsSignal } from '../../shared/wizard/usbHidErrors';
import { UiButton, UiInput, UiSelect } from '../components/ui';
import {
  initialWizardUiState,
  wizardUiReducer,
} from './setupWizard/state/wizardReducer';
import {
  selectCanPrepareLocalDriver,
  selectCanPrepareLocalNut,
  selectCanPrepareLocalUsbHid,
} from './setupWizard/state/wizardSelectors';
import { useWizardActions } from './setupWizard/actions/useWizardActions';


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

  const [uiState, dispatchUi] = useReducer(wizardUiReducer, initialWizardUiState);
  const {
    mode,
    step,
    testStatus,
    testError,
    upsDescription,
    completing,
    installStatus,
    installError,
    installErrorDetails,
  } = uiState;

  const {
    testConnection,
    completeWizard,
    chooseNutFolder,
    validateNutFolder,
    prepareLocalNut,
    listSerialDrivers,
    listComPorts,
    prepareLocalDriver,
    prepareUsbHid,
  } = useWizardActions();

  const setMode = useCallback((nextMode: SetupMode) => {
    dispatchUi({ type: 'setMode', mode: nextMode });
  }, []);
  const setStep = useCallback((nextStep: WizardStep) => {
    dispatchUi({ type: 'setStep', step: nextStep });
  }, []);
  const setTestStatus = useCallback((status: TestStatus) => {
    dispatchUi({ type: 'setTestStatus', status });
  }, []);
  const setTestError = useCallback((error: string | null) => {
    dispatchUi({ type: 'setTestError', error });
  }, []);
  const setUpsDescription = useCallback((description: string | null) => {
    dispatchUi({ type: 'setUpsDescription', upsDescription: description });
  }, []);
  const setCompleting = useCallback((nextCompleting: boolean) => {
    dispatchUi({ type: 'setCompleting', completing: nextCompleting });
  }, []);
  const setInstallStatus = useCallback((status: InstallStatus) => {
    dispatchUi({ type: 'setInstallStatus', status });
  }, []);
  const setInstallError = useCallback((error: string | null) => {
    dispatchUi({ type: 'setInstallError', error });
  }, []);
  const setInstallErrorDetails = useCallback((details: string | null) => {
    dispatchUi({ type: 'setInstallErrorDetails', details });
  }, []);
  const resetInstallUi = useCallback(() => {
    dispatchUi({ type: 'resetInstallState' });
  }, []);

  const [host, setHost] = useState(config?.nut?.host || '127.0.0.1');
  const [port, setPort] = useState(config?.nut?.port || 3493);
  const [username, setUsername] = useState(config?.nut?.username || '');
  const [password, setPassword] = useState(config?.nut?.password || '');
  const [upsName, setUpsName] = useState(config?.nut?.upsName || 'snmpups');

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
  const [driverName, setDriverName] = useState('');
  const [driverPort, setDriverPort] = useState('');
  const [ttymode, setTtymode] = useState('raw');
  const [usbPort] = useState('auto');
  const [specifyVidPid, setSpecifyVidPid] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [productId, setProductId] = useState('');
  const [availableDrivers, setAvailableDrivers] = useState<string[]>([]);
  const [availableComPorts, setAvailableComPorts] = useState<string[]>([]);
  const [driverFilter, setDriverFilter] = useState('');

  const [secLevel, setSecLevel] = useState<SecLevel>('noAuthNoPriv');
  const [secName, setSecName] = useState('');
  const [authProtocol, setAuthProtocol] = useState<AuthProtocol>('MD5');
  const [authPassword, setAuthPassword] = useState('');
  const [privProtocol, setPrivProtocol] = useState<PrivProtocol>('AES');
  const [privPassword, setPrivPassword] = useState('');

  const normalizedDriverName = typeof driverName === 'string' ? driverName : '';
  const normalizedDriverFilter =
    typeof driverFilter === 'string' ? driverFilter : '';
  const normalizedTtymode = typeof ttymode === 'string' ? ttymode : '';
  const normalizedVendorId = normalizeUsbDeviceId(vendorId);
  const normalizedProductId = normalizeUsbDeviceId(productId);
  const upsNameValid = isValidUpsName(upsName);
  const snmpTargetValid = isValidSnmpTarget(snmpTarget);
  const normalizedDriverPort = normalizeComPort(driverPort);
  const vendorIdValid = isValidUsbDeviceId(normalizedVendorId);
  const productIdValid = isValidUsbDeviceId(normalizedProductId);
  const driverNameValid =
    normalizedDriverName.trim().length > 0 &&
    availableDrivers.includes(normalizedDriverName);
  const driverPortValid = normalizedDriverPort !== null;
  const ttymodeValid = normalizedTtymode.trim().length > 0;
  const pollfreqValid = isValidPollfreq(pollfreq);
  const v3Valid = isValidSnmpV3Configuration({
    snmpVersion,
    secLevel,
    secName,
    authProtocol,
    authPassword,
    privProtocol,
    privPassword,
  });
  const hasFolderValidation = !validatingFolder && folderValidation !== null;
  const isFolderValid = hasFolderValidation && folderValidation.valid;
  const requiresUac = isFolderValid && !folderValidation.writable;

  const canPrepareLocalNut = selectCanPrepareLocalNut({
    isFolderValid,
    upsNameValid,
    snmpTargetValid,
    pollfreqValid,
    v3Valid,
    validatingFolder,
    installStatus,
  });

  const canPrepareLocalDriver = selectCanPrepareLocalDriver({
    isFolderValid,
    upsNameValid,
    driverNameValid,
    driverPortValid,
    ttymodeValid,
    validatingFolder,
    installStatus,
  });

  const canPrepareLocalUsbHid = selectCanPrepareLocalUsbHid({
    isFolderValid,
    upsNameValid,
    specifyVidPid,
    normalizedVendorId,
    normalizedProductId,
    vendorIdValid,
    productIdValid,
    validatingFolder,
    installStatus,
  });

  const filteredDrivers = availableDrivers.filter((candidateDriver) =>
    candidateDriver.toLowerCase().includes(normalizedDriverFilter.trim().toLowerCase()),
  );

  const resolveSerialDriverInstallErrorMessage = useCallback((
    result: NutSetupPrepareLocalDriverResult,
    selectedPortRaw: string,
  ): string => {
    const selectedPort = normalizeComPort(selectedPortRaw) ?? selectedPortRaw.trim();
    const fallback =
      result.error ?? 'Failed to configure and start local NUT serial driver';

    switch (result.errorCode) {
      case 'SERIAL_COM_PORT_ACCESS':
        return t(
          'wizard.serialComPortAccess',
          'Unable to open {{port}}. The port is in use or access is denied. Close other serial software and retry.',
          { port: selectedPort || 'the selected COM port' },
        );
      case 'SERIAL_COM_PORT_MISSING':
        return t(
          'wizard.serialComPortMissing',
          '{{port}} is no longer available. Reconnect the serial cable, refresh COM ports, and retry.',
          { port: selectedPort || 'The selected COM port' },
        );
      case 'SERIAL_DRIVER_INIT_TIMEOUT':
        return t(
          'wizard.serialDriverInitTimeout',
          'Driver started, but UPS status did not leave WAIT in time. Check COM port, cable, and selected driver.',
        );
      case 'SERIAL_DRIVER_STARTUP_FAILED':
        return t(
          'wizard.serialDriverStartupFailed',
          'Serial driver failed to start. Check port and driver settings, then retry.',
        );
      default:
        return fallback;
    }
  }, [t]);

  const resolveUsbHidInstallErrorMessage = useCallback((
    result: NutSetupPrepareUsbHidResult,
  ): string => {
    const fallback =
      result.error ?? 'Failed to configure and start local NUT USB HID driver';

    if (hasNoMatchingUsbHidUpsSignal(result.error, result.technicalDetails)) {
      return t(
        'wizard.usbHidNoMatchingUps',
        'No matching HID UPS found. Check USB cable/power and optional VID/PID settings, then retry.',
      );
    }

    return fallback;
  }, [t]);

  const handleTestConnection = useCallback(async () => {
    setTestStatus('testing');
    setTestError(null);
    setUpsDescription(null);

    try {
      const result = await testConnection({
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

      await completeWizard({
        host,
        port,
        username: username || undefined,
        password: password || undefined,
        upsName,
        mapping: cleanMapping,
        line: { nominalVoltage, nominalFrequency },
        launchLocalComponents: mode !== 'directNut',
        localNutFolderPath:
          mode !== 'directNut' ? nutFolderPath : undefined,
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

  const handlePrepareLocalSuccess = useCallback(() => {
    setInstallStatus('success');
    setInstallError(null);
    setInstallErrorDetails(null);
    setHost('127.0.0.1');
    setPort(3493);
    setTestStatus('idle');
    setTestError(null);
    setUpsDescription(null);
    window.setTimeout(() => {
      setStep('connect');
    }, 900);
  }, []);

  const refreshSerialSetupOptions = useCallback(async (folderPath: string) => {
    const [driversResult, portsResult] = await Promise.all([
      listSerialDrivers({ folderPath }),
      listComPorts(),
    ]);

    setAvailableDrivers(driversResult.drivers);
    setAvailableComPorts(portsResult.ports);

    setDriverName((previousDriverName) => {
      if (previousDriverName && driversResult.drivers.includes(previousDriverName)) {
        return previousDriverName;
      }
      return driversResult.drivers[0] ?? '';
    });

    setDriverPort((previousDriverPort) => {
      const previousNormalizedPort = normalizeComPort(previousDriverPort);
      if (previousNormalizedPort && portsResult.ports.includes(previousNormalizedPort)) {
        return previousNormalizedPort;
      }
      return portsResult.ports[0] ?? previousDriverPort;
    });
  }, []);

  const handleRefreshComPorts = useCallback(async () => {
    if (mode !== 'serialSetup') {
      return;
    }

    try {
      const result = await listComPorts();
      setAvailableComPorts(result.ports);
      setDriverPort((previousDriverPort) => {
        const previousNormalizedPort = normalizeComPort(previousDriverPort);
        if (previousNormalizedPort && result.ports.includes(previousNormalizedPort)) {
          return previousNormalizedPort;
        }
        return result.ports[0] ?? previousDriverPort;
      });
    } catch (err) {
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to refresh COM ports');
    }
  }, [mode]);

  const handleChooseNutFolder = useCallback(async () => {
    resetInstallUi();
    setDriverFilter('');

    try {
      const selection = await chooseNutFolder();
      if (selection.cancelled || !selection.folderPath) {
        return;
      }

      setNutFolderPath(selection.folderPath);
      setFolderValidation(null);
      if (mode === 'serialSetup') {
        setAvailableDrivers([]);
        setAvailableComPorts([]);
      }
      setValidatingFolder(true);

      const validation = await validateNutFolder({
        folderPath: selection.folderPath,
        requireUsbHidExperimentalSupport: mode === 'usbHidSetup',
      });
      setFolderValidation(validation);

      if (validation.valid && mode === 'serialSetup') {
        await refreshSerialSetupOptions(selection.folderPath);
      }
    } catch (err) {
      setFolderValidation(null);
      if (mode === 'serialSetup') {
        setAvailableDrivers([]);
        setAvailableComPorts([]);
      }
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to choose folder');
    } finally {
      setValidatingFolder(false);
    }
  }, [mode, refreshSerialSetupOptions]);

  const handlePrepareLocalNut = useCallback(async () => {
    if (!canPrepareLocalNut) {
      return;
    }

    setInstallStatus('installing');
    setInstallError(null);
    setInstallErrorDetails(null);

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

      const result = await prepareLocalNut(payload);
      if (!result.success) {
        setInstallStatus('error');
        setInstallError(result.error ?? 'Failed to configure and start local NUT');
        setInstallErrorDetails(result.technicalDetails ?? null);
        return;
      }

      handlePrepareLocalSuccess();
    } catch (err) {
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to configure and start local NUT');
      setInstallErrorDetails(err instanceof Error ? err.message : null);
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
    handlePrepareLocalSuccess,
  ]);

  const handlePrepareLocalDriver = useCallback(async () => {
    if (!canPrepareLocalDriver) {
      return;
    }

    setInstallStatus('installing');
    setInstallError(null);
    setInstallErrorDetails(null);

    try {
      const payload: NutSetupPrepareLocalDriverPayload = {
        folderPath: nutFolderPath,
        upsName,
        driver: normalizedDriverName,
        port: normalizedDriverPort ?? driverPort,
        ttymode: normalizedTtymode.trim() || 'raw',
      };

      const result = await prepareLocalDriver(payload);
      if (!result.success) {
        setInstallStatus('error');
        setInstallError(resolveSerialDriverInstallErrorMessage(
          result,
          normalizedDriverPort ?? driverPort,
        ));
        setInstallErrorDetails(result.technicalDetails ?? null);
        return;
      }

      handlePrepareLocalSuccess();
    } catch (err) {
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to configure and start local NUT serial driver');
      setInstallErrorDetails(err instanceof Error ? err.message : null);
    }
  }, [
    canPrepareLocalDriver,
    nutFolderPath,
    upsName,
    normalizedDriverName,
    normalizedDriverPort,
    driverPort,
    normalizedTtymode,
    resolveSerialDriverInstallErrorMessage,
    handlePrepareLocalSuccess,
  ]);

  const handlePrepareLocalUsbHid = useCallback(async () => {
    if (!canPrepareLocalUsbHid) {
      return;
    }

    setInstallStatus('installing');
    setInstallError(null);
    setInstallErrorDetails(null);

    try {
      const payload: NutSetupPrepareUsbHidPayload = {
        folderPath: nutFolderPath,
        upsName,
        port: usbPort,
        ...(specifyVidPid
          ? {
            vendorid: normalizedVendorId,
            productid: normalizedProductId,
          }
          : {}),
      };

      const result = await prepareUsbHid(payload);
      if (!result.success) {
        setInstallStatus('error');
        setInstallError(resolveUsbHidInstallErrorMessage(result));
        setInstallErrorDetails(result.technicalDetails ?? null);
        return;
      }

      handlePrepareLocalSuccess();
    } catch (err) {
      setInstallStatus('error');
      setInstallError(err instanceof Error ? err.message : 'Failed to configure and start local NUT USB HID driver');
      setInstallErrorDetails(err instanceof Error ? err.message : null);
    }
  }, [
    canPrepareLocalUsbHid,
    nutFolderPath,
    upsName,
    usbPort,
    specifyVidPid,
    normalizedVendorId,
    normalizedProductId,
    resolveUsbHidInstallErrorMessage,
    handlePrepareLocalSuccess,
  ]);

  if (step === 'choose') {
    return (
      <ChooseSetupModeStep
        onChooseDirectNut={() => {
          setMode('directNut');
          resetInstallUi();
          setStep('connect');
        }}
        onChooseSnmpSetup={() => {
          setMode('snmpSetup');
          resetInstallUi();
          setUpsName((previous) => {
            const normalized = previous.trim().toLowerCase();
            if (!normalized || normalized === 'serialups') {
              return 'snmpups';
            }
            return previous;
          });
          setStep('nutSetup');
        }}
        onChooseSerialSetup={() => {
          setMode('serialSetup');
          resetInstallUi();
          setUpsName((previous) => {
            const normalized = previous.trim().toLowerCase();
            if (!normalized || normalized === 'snmpups') {
              return 'serialups';
            }
            return previous;
          });
          setNutFolderPath('');
          setFolderValidation(null);
          setDriverFilter('');
          setDriverName('');
          setAvailableDrivers([]);
          setDriverPort('');
          setAvailableComPorts([]);
          setStep('nutSetup');
        }}
        onChooseUsbHidSetup={() => {
          setMode('usbHidSetup');
          resetInstallUi();
          setUpsName((previous) => {
            const normalized = previous.trim().toLowerCase();
            if (!normalized || normalized === 'snmpups' || normalized === 'serialups') {
              return 'usbups';
            }
            return previous;
          });
          setNutFolderPath('');
          setFolderValidation(null);
          setDriverFilter('');
          setDriverName('');
          setAvailableDrivers([]);
          setDriverPort('');
          setAvailableComPorts([]);
          setSpecifyVidPid(false);
          setVendorId('');
          setProductId('');
          setStep('nutSetup');
        }}
      />
    );
  }

  if (step === 'nutSetup') {
    return (
      <NutSetupStep
        mode={mode}
        nutFolderPath={nutFolderPath}
        validatingFolder={validatingFolder}
        folderValidation={folderValidation}
        hasFolderValidation={hasFolderValidation}
        isFolderValid={isFolderValid}
        requiresUac={requiresUac}
        installStatus={installStatus}
        installError={installError}
        installErrorDetails={installErrorDetails}
        canPrepareLocalNut={canPrepareLocalNut}
        canPrepareLocalDriver={canPrepareLocalDriver}
        canPrepareLocalUsbHid={canPrepareLocalUsbHid}
        onChooseNutFolder={handleChooseNutFolder}
        onPrepareLocalNut={handlePrepareLocalNut}
        onPrepareLocalDriver={handlePrepareLocalDriver}
        onPrepareLocalUsbHid={handlePrepareLocalUsbHid}
        onBack={() => setStep('choose')}
        snmpFormProps={{
          upsName,
          upsNameValid,
          snmpTarget,
          snmpTargetValid,
          snmpVersion,
          pollfreq,
          mibs,
          community,
          secLevel,
          secName,
          authProtocol,
          authPassword,
          privProtocol,
          privPassword,
          onUpsNameChange: (value: string) => {
            setUpsName(value);
            resetInstallUi();
          },
          onSnmpTargetChange: (value: string) => {
            setSnmpTarget(value);
            resetInstallUi();
          },
          onSnmpVersionChange: (value: SnmpVersion) => {
            setSnmpVersion(value);
            resetInstallUi();
          },
          onPollfreqChange: (value: number) => {
            setPollfreq(value);
            resetInstallUi();
          },
          onMibsChange: (value: string) => {
            setMibs(value);
            resetInstallUi();
          },
          onCommunityChange: (value: string) => {
            setCommunity(value);
            resetInstallUi();
          },
          onSecLevelChange: (value: SecLevel) => {
            setSecLevel(value);
            resetInstallUi();
          },
          onSecNameChange: (value: string) => {
            setSecName(value);
            resetInstallUi();
          },
          onAuthProtocolChange: (value: AuthProtocol) => {
            setAuthProtocol(value);
            resetInstallUi();
          },
          onAuthPasswordChange: (value: string) => {
            setAuthPassword(value);
            resetInstallUi();
          },
          onPrivProtocolChange: (value: PrivProtocol) => {
            setPrivProtocol(value);
            resetInstallUi();
          },
          onPrivPasswordChange: (value: string) => {
            setPrivPassword(value);
            resetInstallUi();
          },
        }}
        serialFormProps={{
          upsName,
          upsNameValid,
          driverFilter: normalizedDriverFilter,
          driverName: normalizedDriverName,
          filteredDrivers,
          isFolderValid,
          availableDrivers,
          availableComPorts,
          normalizedDriverPort,
          driverPort,
          driverPortValid,
          ttymode: normalizedTtymode,
          installStatus,
          onUpsNameChange: (value: string) => {
            setUpsName(value);
            resetInstallUi();
          },
          onDriverFilterChange: (value: string) => {
            setDriverFilter(typeof value === 'string' ? value : '');
          },
          onDriverNameChange: (value: string) => {
            setDriverName(typeof value === 'string' ? value : '');
            resetInstallUi();
          },
          onRefreshComPorts: handleRefreshComPorts,
          onDriverPortChange: (value: string) => {
            setDriverPort(value);
            resetInstallUi();
          },
          onTtymodeChange: (value: string) => {
            setTtymode(value);
            resetInstallUi();
          },
        }}
        usbHidFormProps={{
          upsName,
          upsNameValid,
          port: usbPort,
          specifyVidPid,
          vendorId: normalizedVendorId,
          productId: normalizedProductId,
          vendorIdValid,
          productIdValid,
          onUpsNameChange: (value: string) => {
            setUpsName(value);
            resetInstallUi();
          },
          onSpecifyVidPidChange: (value: boolean) => {
            setSpecifyVidPid(value);
            resetInstallUi();
          },
          onVendorIdChange: (value: string) => {
            setVendorId(value);
            resetInstallUi();
          },
          onProductIdChange: (value: string) => {
            setProductId(value);
            resetInstallUi();
          },
        }}
      />
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
                <UiSelect
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
                </UiSelect>
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
            <UiButton
              className="btn btn--secondary"
              onClick={() => setStep('connect')}
              disabled={completing}
            >
              {t('wizard.back')}
            </UiButton>

            <UiButton
              className="btn btn--primary"
              onClick={() => setStep('line')}
              disabled={completing}
            >
              {t('wizard.continue')}
            </UiButton>
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
          style={{ maxWidth: mode === 'directNut' ? '560px' : '680px' }}
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
                <UiInput
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
                <UiInput
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
            <UiButton
              className="btn btn--secondary"
              onClick={() => setStep('map')}
              disabled={completing}
            >
              {t('wizard.back')}
            </UiButton>

            <UiButton
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
            </UiButton>
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
              <UiInput
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
              <UiInput
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
              <UiInput
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
              <UiInput
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
            <UiInput
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
          <UiButton
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
          </UiButton>

          <UiButton
            className="btn btn--primary"
            onClick={() => setStep('map')}
            disabled={testStatus !== 'success'}
          >
            {t('wizard.continueToMapping')}
          </UiButton>
        </div>
      </div>
    </div>
  );
}


