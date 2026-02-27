import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  XCircle,
  ShieldAlert,
  FolderOpen,
} from 'lucide-react';
import type { NutSetupValidateFolderResult } from '../../../main/ipc/ipcChannels';
import type { InstallStatus, SetupMode } from './types';
import { WizardSteps } from './WizardSteps';
import { SnmpSetupForm, type SnmpSetupFormProps } from './SnmpSetupForm';
import { SerialSetupForm, type SerialSetupFormProps } from './SerialSetupForm';

type NutSetupStepProps = {
  mode: SetupMode;
  nutFolderPath: string;
  validatingFolder: boolean;
  folderValidation: NutSetupValidateFolderResult | null;
  hasFolderValidation: boolean;
  isFolderValid: boolean;
  requiresUac: boolean;
  installStatus: InstallStatus;
  installError: string | null;
  installErrorDetails: string | null;
  canPrepareLocalNut: boolean;
  canPrepareLocalDriver: boolean;
  onChooseNutFolder: () => void;
  onPrepareLocalNut: () => void;
  onPrepareLocalDriver: () => void;
  onBack: () => void;
  snmpFormProps: SnmpSetupFormProps;
  serialFormProps: SerialSetupFormProps;
};

export function NutSetupStep({
  mode,
  nutFolderPath,
  validatingFolder,
  folderValidation,
  hasFolderValidation,
  isFolderValid,
  requiresUac,
  installStatus,
  installError,
  installErrorDetails,
  canPrepareLocalNut,
  canPrepareLocalDriver,
  onChooseNutFolder,
  onPrepareLocalNut,
  onPrepareLocalDriver,
  onBack,
  snmpFormProps,
  serialFormProps,
}: NutSetupStepProps) {
  const { t } = useTranslation();

  return (
    <div className="wizard-backdrop">
      <div className="wizard-card" style={{ maxWidth: '780px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="wizard-header">
          <WizardSteps currentStep="nutSetup" mode={mode} />
          <h1 className="wizard-title">
            {mode === 'serialSetup'
              ? t('wizard.serialSetupTitle', 'Configure NUT Serial Driver')
              : t('wizard.nutDownloadTitle', 'Configure NUT for Windows')}
          </h1>
          <p className="wizard-subtitle">
            {mode === 'serialSetup'
              ? t(
                'wizard.serialSetupDesc',
                'Download the latest NUT for Windows release, decompress the zip file into a new folder, select it, then configure serial driver, COM port, and ttymode below.',
              )
              : t(
                'wizard.nutDownloadDesc',
                'Download the latest NUT for Windows release, decompress the zip file into a new folder, then select the folder below.',
              )}
          </p>
        </div>

        <div className="wizard-form" style={{ overflowY: 'auto', paddingRight: '12px', flex: 1 }}>
          <h2
            style={{
              fontSize: '0.96rem',
              fontWeight: 600,
              marginBottom: '10px',
            }}
          >
            {t('wizard.nutSelectionTitle', 'NUT Folder Selection')}
          </h2>

          <div className="form-group">
            <a
              className="wizard-inline-link"
              href="https://github.com/networkupstools/nut/releases"
              target="_blank"
              rel="noreferrer"
              style={{ width: 'fit-content', fontSize: '0.9rem' }}
            >
              {t('wizard.nutDownloadLink', 'Download NUT from GitHub Releases')}
            </a>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="wiz-nut-folder-path">
              {t('wizard.nutFolderPathLabel', 'NUT Folder')}
            </label>
            <div className="wizard-folder-row">
              <button
                className="btn btn--secondary"
                onClick={onChooseNutFolder}
                disabled={validatingFolder || installStatus === 'installing'}
                type="button"
                style={{ width: '100%' }}
              >
                <FolderOpen size={16} />
                {t('wizard.nutChooseFolder', 'Choose NUT Folder')}
              </button>

              <input
                id="wiz-nut-folder-path"
                className="form-input"
                type="text"
                value={nutFolderPath}
                readOnly
                placeholder={t('wizard.nutFolderPathPlaceholder', 'No folder selected')}
              />
            </div>
          </div>

          {isFolderValid && (
            <div className="wizard-feedback wizard-feedback--success">
              <span className="feedback-icon"><CheckCircle2 size={20} /></span>
              <span>{t('wizard.nutFolderValid', 'NUT folder structure verified')}</span>
            </div>
          )}

          {hasFolderValidation && folderValidation && !folderValidation.valid && (
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

          {mode === 'serialSetup' ? (
            <SerialSetupForm {...serialFormProps} />
          ) : (
            <SnmpSetupForm {...snmpFormProps} />
          )}

          <p className="form-hint">
            {mode === 'serialSetup'
              ? t(
                'wizard.prepareSerialHint',
                'This writes NUT configuration files (ups.conf, upsd.conf) and starts the selected local serial driver plus upsd immediately. If the folder is protected, an administrator permission prompt will appear.',
              )
              : t(
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
              <div style={{ minWidth: 0 }}>
                <div>{installError}</div>
                {installErrorDetails && (
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer' }}>
                      {t('wizard.errorDetails', 'Technical details')}
                    </summary>
                    <pre
                      style={{
                        marginTop: '8px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontSize: '0.8rem',
                        lineHeight: 1.4,
                      }}
                    >
                      {installErrorDetails}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="wizard-actions" style={{ flexShrink: 0, marginTop: '20px' }}>
          <button
            className="btn btn--secondary"
            onClick={onBack}
            disabled={installStatus === 'installing'}
          >
            {t('wizard.back')}
          </button>

          <button
            className="btn btn--primary"
            onClick={mode === 'serialSetup' ? onPrepareLocalDriver : onPrepareLocalNut}
            disabled={mode === 'serialSetup' ? !canPrepareLocalDriver : !canPrepareLocalNut}
          >
            {installStatus === 'installing' ? (
              <>
                <span className="btn-spinner" />
                {mode === 'serialSetup'
                  ? t(
                    'wizard.initializingSerialDriver',
                    'Configuring and starting serial driver, waiting for UPS status...',
                  )
                  : t('wizard.applyingConfig', 'Configuring and starting...')}
              </>
            ) : (
              requiresUac ? (
                <>
                  <ShieldAlert size={16} />
                  {t('wizard.askForUac', 'Ask for UAC')}
                </>
              ) : (
                mode === 'serialSetup'
                  ? t('wizard.prepareLocalDriver', 'Configure and Start Local Driver')
                  : t('wizard.prepareLocalNut', 'Configure and Start Local NUT')
              )
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
