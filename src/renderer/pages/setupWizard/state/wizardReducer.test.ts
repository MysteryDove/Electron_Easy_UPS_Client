import { describe, expect, it } from 'vitest';
import {
  initialWizardUiState,
  wizardUiReducer,
} from './wizardReducer';

describe('wizard UI reducer', () => {
  it('resets install state', () => {
    const state = wizardUiReducer(initialWizardUiState, {
      type: 'setInstallResult',
      status: 'error',
      error: 'boom',
      details: 'stack',
    });

    const reset = wizardUiReducer(state, { type: 'resetInstallState' });
    expect(reset.installStatus).toBe('idle');
    expect(reset.installError).toBeNull();
    expect(reset.installErrorDetails).toBeNull();
  });

  it('sets mode and step', () => {
    const state = wizardUiReducer(initialWizardUiState, {
      type: 'setMode',
      mode: 'usbHidSetup',
    });
    const next = wizardUiReducer(state, {
      type: 'setStep',
      step: 'nutSetup',
    });

    expect(next.mode).toBe('usbHidSetup');
    expect(next.step).toBe('nutSetup');
  });
});
