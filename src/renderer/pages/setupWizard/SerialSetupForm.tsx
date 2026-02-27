import { useTranslation } from 'react-i18next';
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { ChevronsUpDown, RefreshCw } from 'lucide-react';
import type { InstallStatus } from './types';

export type SerialSetupFormProps = {
  upsName: string;
  upsNameValid: boolean;
  driverFilter: string;
  driverName: string;
  filteredDrivers: string[];
  isFolderValid: boolean;
  availableDrivers: string[];
  availableComPorts: string[];
  normalizedDriverPort: string | null;
  driverPort: string;
  driverPortValid: boolean;
  ttymode: string;
  installStatus: InstallStatus;
  onUpsNameChange: (value: string) => void;
  onDriverFilterChange: (value: string) => void;
  onDriverNameChange: (value: string) => void;
  onRefreshComPorts: () => void;
  onDriverPortChange: (value: string) => void;
  onTtymodeChange: (value: string) => void;
};

export function SerialSetupForm({
  upsName,
  upsNameValid,
  driverFilter,
  driverName,
  filteredDrivers,
  isFolderValid,
  availableDrivers,
  availableComPorts,
  normalizedDriverPort,
  driverPort,
  driverPortValid,
  ttymode,
  installStatus,
  onUpsNameChange,
  onDriverFilterChange,
  onDriverNameChange,
  onRefreshComPorts,
  onDriverPortChange,
  onTtymodeChange,
}: SerialSetupFormProps) {
  const { t } = useTranslation();
  const driverSelectionEnabled = isFolderValid && availableDrivers.length > 0;
  const driverInputPlaceholder = !isFolderValid
    ? t('wizard.serialDriverDisabledNoFolder', 'Choose and validate a NUT folder first')
    : t('wizard.serialDriverFilterPlaceholder', 'Type to filter drivers');

  return (
    <>
      <h2
        style={{
          fontSize: '0.96rem',
          fontWeight: 600,
          marginBottom: '10px',
        }}
      >
        {t('wizard.serialConfigTitle', 'Serial UPS Configuration')}
      </h2>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-serial-ups-name">
          {t('wizard.serialUpsName', 'UPS Name')}
        </label>
        <input
          id="wiz-serial-ups-name"
          className="form-input"
          type="text"
          value={upsName}
          onChange={(event) => onUpsNameChange(event.target.value)}
          placeholder="serialups"
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
        <label className="form-label" htmlFor="wiz-serial-driver-input">
          {t('wizard.serialDriver', 'NUT Serial Driver')}
        </label>
        <Combobox
          value={driverName}
          disabled={!driverSelectionEnabled}
          onChange={(value: string | null) => {
            onDriverNameChange(typeof value === 'string' ? value : '');
            onDriverFilterChange('');
          }}
          onClose={() => onDriverFilterChange('')}
        >
          <div className="wizard-combobox-container">
            <ComboboxInput
              id="wiz-serial-driver-input"
              className="form-input wizard-combobox-input"
              displayValue={(value: string) => value ?? ''}
              onChange={(event) => onDriverFilterChange(event.target.value)}
              placeholder={driverInputPlaceholder}
              disabled={!driverSelectionEnabled}
            />
            <ComboboxButton
              className="wizard-combobox-button"
              type="button"
              aria-label={t('wizard.serialDriver', 'NUT Serial Driver')}
              disabled={!driverSelectionEnabled}
            >
              <ChevronsUpDown size={14} />
            </ComboboxButton>

            <ComboboxOptions className="wizard-combobox-options">
              {!driverSelectionEnabled ? (
                <div className="wizard-combobox-empty">
                  {t('wizard.serialDriverDisabledNoFolder', 'Choose and validate a NUT folder first')}
                </div>
              ) : filteredDrivers.length === 0 ? (
                <div className="wizard-combobox-empty">
                  {t('wizard.notFound', 'Not found')}
                </div>
              ) : (
                filteredDrivers.map((candidateDriver) => (
                  <ComboboxOption
                    key={candidateDriver}
                    value={candidateDriver}
                    className="wizard-combobox-option"
                  >
                    {candidateDriver}
                  </ComboboxOption>
                ))
              )}
            </ComboboxOptions>
          </div>
        </Combobox>
        <span className="form-hint">
          {t('wizard.serialDriverHint', 'Only drivers found in this NUT folder are listed.')}
        </span>
        <a
          href="https://networkupstools.org/stable-hcl.html"
          target="_blank"
          rel="noreferrer"
          className="wizard-inline-link"
          style={{ display: 'inline-block' }}
        >
          {t('wizard.serialHclLink', 'Need help choosing a driver? Search the NUT Hardware Compatibility List')}
        </a>
        {isFolderValid && availableDrivers.length === 0 && (
          <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
            {t('wizard.serialNoDriversFound', 'No known serial driver binaries were found in this folder')}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-serial-port">
          {t('wizard.serialPort', 'COM Port')}
        </label>
        <div className="wizard-com-port-row">
          <select
            id="wiz-serial-port"
            className="form-input wizard-com-port-select"
            value={normalizedDriverPort ?? ''}
            onChange={(event) => onDriverPortChange(event.target.value)}
          >
            <option value="">
              {t('wizard.serialPortSelectPlaceholder', '-- Select a COM port --')}
            </option>
            {availableComPorts.map((candidatePort) => (
              <option key={candidatePort} value={candidatePort}>
                {candidatePort}
              </option>
            ))}
            {normalizedDriverPort && !availableComPorts.includes(normalizedDriverPort) && (
              <option value={normalizedDriverPort}>
                {normalizedDriverPort} ({t('wizard.notFound')})
              </option>
            )}
          </select>
          <button
            className="btn btn--secondary"
            type="button"
            onClick={onRefreshComPorts}
            disabled={installStatus === 'installing'}
            style={{ minWidth: '96px' }}
          >
            <RefreshCw size={14} />
            {t('wizard.serialRefreshPorts', 'Refresh')}
          </button>
        </div>
        {availableComPorts.length === 0 && (
          <span className="form-hint">
            {t('wizard.serialNoComPorts', 'No COM ports detected. Click refresh after connecting the UPS serial cable.')}
          </span>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-serial-ttymode">
          {t('wizard.serialTtyMode', 'TTY Mode')}
        </label>
        <input
          id="wiz-serial-ttymode"
          className="form-input"
          type="text"
          value={ttymode}
          onChange={(event) => onTtymodeChange(event.target.value)}
          placeholder="raw"
        />
        <span className="form-hint">
          {t('wizard.serialTtyModeHint', 'Default on Windows is raw')}
        </span>
      </div>

      {!driverPortValid && driverPort.length > 0 && (
        <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
          {t('wizard.serialPortInvalid', 'Enter a valid COM port such as COM3')}
        </span>
      )}
    </>
  );
}
