import type { InstallStatus, SetupMode, TestStatus, WizardStep } from '../types';

export type WizardUiState = {
  mode: SetupMode;
  step: WizardStep;
  testStatus: TestStatus;
  testError: string | null;
  upsDescription: string | null;
  completing: boolean;
  installStatus: InstallStatus;
  installError: string | null;
  installErrorDetails: string | null;
};

export const initialWizardUiState: WizardUiState = {
  mode: 'directNut',
  step: 'choose',
  testStatus: 'idle',
  testError: null,
  upsDescription: null,
  completing: false,
  installStatus: 'idle',
  installError: null,
  installErrorDetails: null,
};

export type WizardUiAction =
  | { type: 'setMode'; mode: SetupMode }
  | { type: 'setStep'; step: WizardStep }
  | { type: 'setTestStatus'; status: TestStatus }
  | { type: 'setTestError'; error: string | null }
  | { type: 'setUpsDescription'; upsDescription: string | null }
  | { type: 'setTestResult'; status: TestStatus; error: string | null; upsDescription: string | null }
  | { type: 'resetTestState' }
  | { type: 'setCompleting'; completing: boolean }
  | { type: 'setInstallStatus'; status: InstallStatus }
  | { type: 'setInstallError'; error: string | null }
  | { type: 'setInstallErrorDetails'; details: string | null }
  | { type: 'setInstallResult'; status: InstallStatus; error: string | null; details: string | null }
  | { type: 'resetInstallState' };

export function wizardUiReducer(
  state: WizardUiState,
  action: WizardUiAction,
): WizardUiState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'setStep':
      return { ...state, step: action.step };
    case 'setTestStatus':
      return { ...state, testStatus: action.status };
    case 'setTestError':
      return { ...state, testError: action.error };
    case 'setUpsDescription':
      return { ...state, upsDescription: action.upsDescription };
    case 'setTestResult':
      return {
        ...state,
        testStatus: action.status,
        testError: action.error,
        upsDescription: action.upsDescription,
      };
    case 'resetTestState':
      return {
        ...state,
        testStatus: 'idle',
        testError: null,
        upsDescription: null,
      };
    case 'setCompleting':
      return { ...state, completing: action.completing };
    case 'setInstallStatus':
      return { ...state, installStatus: action.status };
    case 'setInstallError':
      return {
        ...state,
        installError: action.error,
      };
    case 'setInstallErrorDetails':
      return {
        ...state,
        installErrorDetails: action.details,
      };
    case 'setInstallResult':
      return {
        ...state,
        installStatus: action.status,
        installError: action.error,
        installErrorDetails: action.details,
      };
    case 'resetInstallState':
      return {
        ...state,
        installStatus: 'idle',
        installError: null,
        installErrorDetails: null,
      };
    default:
      return state;
  }
}
