import { useCallback } from 'react';
import type {
  NutSetupListSerialDriversPayload,
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalNutPayload,
  NutSetupPrepareUsbHidPayload,
  NutSetupValidateFolderPayload,
  WizardCompletePayload,
  WizardTestConnectionPayload,
} from '../../../../main/ipc/ipcChannels';

export function useWizardActions() {
  const testConnection = useCallback((payload: WizardTestConnectionPayload) => (
    window.electronApi.wizard.testConnection(payload)
  ), []);

  const completeWizard = useCallback((payload: WizardCompletePayload) => (
    window.electronApi.wizard.complete(payload)
  ), []);

  const chooseNutFolder = useCallback(() => (
    window.electronApi.nutSetup.chooseFolder()
  ), []);

  const validateNutFolder = useCallback((payload: NutSetupValidateFolderPayload) => (
    window.electronApi.nutSetup.validateFolder(payload)
  ), []);

  const prepareLocalNut = useCallback((payload: NutSetupPrepareLocalNutPayload) => (
    window.electronApi.nutSetup.prepareLocalNut(payload)
  ), []);

  const listSerialDrivers = useCallback((payload: NutSetupListSerialDriversPayload) => (
    window.electronApi.nutSetup.listSerialDrivers(payload)
  ), []);

  const listComPorts = useCallback(() => (
    window.electronApi.nutSetup.listComPorts()
  ), []);

  const prepareLocalDriver = useCallback((payload: NutSetupPrepareLocalDriverPayload) => (
    window.electronApi.nutSetup.prepareLocalDriver(payload)
  ), []);

  const prepareUsbHid = useCallback((payload: NutSetupPrepareUsbHidPayload) => (
    window.electronApi.nutSetup.prepareUsbHid(payload)
  ), []);

  return {
    testConnection,
    completeWizard,
    chooseNutFolder,
    validateNutFolder,
    prepareLocalNut,
    listSerialDrivers,
    listComPorts,
    prepareLocalDriver,
    prepareUsbHid,
  };
}
