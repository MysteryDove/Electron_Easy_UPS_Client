import { useCallback } from 'react';
import { electronApi } from '../../../app/electronApi';
import type {
  NutSetupListSerialDriversPayload,
  NutSetupPrepareLocalDriverPayload,
  NutSetupPrepareLocalNutPayload,
  NutSetupPrepareUsbHidPayload,
  NutSetupValidateFolderPayload,
  WizardCompletePayload,
  WizardTestConnectionPayload,
} from '../../../../shared/ipc/contracts';

export function useWizardActions() {
  const testConnection = useCallback(
    (payload: WizardTestConnectionPayload) =>
      electronApi.wizard.testConnection(payload),
    [],
  );

  const completeWizard = useCallback(
    (payload: WizardCompletePayload) => electronApi.wizard.complete(payload),
    [],
  );

  const chooseNutFolder = useCallback(
    () => electronApi.nutSetup.chooseFolder(),
    [],
  );

  const validateNutFolder = useCallback(
    (payload: NutSetupValidateFolderPayload) =>
      electronApi.nutSetup.validateFolder(payload),
    [],
  );

  const prepareLocalNut = useCallback(
    (payload: NutSetupPrepareLocalNutPayload) =>
      electronApi.nutSetup.prepareLocalNut(payload),
    [],
  );

  const listSerialDrivers = useCallback(
    (payload: NutSetupListSerialDriversPayload) =>
      electronApi.nutSetup.listSerialDrivers(payload),
    [],
  );

  const listComPorts = useCallback(
    () => electronApi.nutSetup.listComPorts(),
    [],
  );

  const prepareLocalDriver = useCallback(
    (payload: NutSetupPrepareLocalDriverPayload) =>
      electronApi.nutSetup.prepareLocalDriver(payload),
    [],
  );

  const prepareUsbHid = useCallback(
    (payload: NutSetupPrepareUsbHidPayload) =>
      electronApi.nutSetup.prepareUsbHid(payload),
    [],
  );

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
