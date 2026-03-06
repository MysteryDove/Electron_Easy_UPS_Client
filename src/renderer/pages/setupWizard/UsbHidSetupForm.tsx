import { useTranslation } from 'react-i18next';
import { UiCheckbox, UiInput } from '../../components/ui';

export type UsbHidSetupFormProps = {
  upsName: string;
  upsNameValid: boolean;
  port: string;
  specifyVidPid: boolean;
  vendorId: string;
  productId: string;
  vendorIdValid: boolean;
  productIdValid: boolean;
  onUpsNameChange: (value: string) => void;
  onSpecifyVidPidChange: (value: boolean) => void;
  onVendorIdChange: (value: string) => void;
  onProductIdChange: (value: string) => void;
};

export function UsbHidSetupForm({
  upsName,
  upsNameValid,
  port,
  specifyVidPid,
  vendorId,
  productId,
  vendorIdValid,
  productIdValid,
  onUpsNameChange,
  onSpecifyVidPidChange,
  onVendorIdChange,
  onProductIdChange,
}: UsbHidSetupFormProps) {
  const { t } = useTranslation();

  const vidPidMissing = specifyVidPid && (!vendorId.trim() || !productId.trim());

  return (
    <>
      <h2
        style={{
          fontSize: '0.96rem',
          fontWeight: 600,
          marginBottom: '10px',
        }}
      >
        {t('wizard.usbHidConfigTitle', 'USB HID UPS Configuration')}
      </h2>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-usbhid-ups-name">
          {t('wizard.usbHidUpsName', 'UPS Name')}
        </label>
        <UiInput
          id="wiz-usbhid-ups-name"
          className="form-input"
          type="text"
          value={upsName}
          onChange={(event) => onUpsNameChange(event.target.value)}
          placeholder="usbups"
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
        <label className="form-label" htmlFor="wiz-usbhid-port">
          {t('wizard.usbHidPort', 'Port')}
        </label>
        <UiInput
          id="wiz-usbhid-port"
          className="form-input"
          type="text"
          value={port}
          disabled
          readOnly
        />
        <span className="form-hint">
          {t('wizard.usbHidPortHint', 'Fixed to auto for this experimental Windows build')}
        </span>
      </div>

      <div className="form-group">
        <label className="form-toggle" htmlFor="wiz-usbhid-specify-vidpid">
          <UiCheckbox
            id="wiz-usbhid-specify-vidpid"
            checked={specifyVidPid}
            onChange={(event) => onSpecifyVidPidChange(event.target.checked)}
          />
          <span className="form-toggle-label">
            {t('wizard.usbHidSpecifyVidPid', 'Specify VID/PID')}
          </span>
        </label>
      </div>

      <div className="form-row form-row--two">
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-usbhid-vendorid">
            {t('wizard.usbHidVendorId', 'Vendor ID')}
          </label>
          <UiInput
            id="wiz-usbhid-vendorid"
            className="form-input"
            type="text"
            value={vendorId}
            onChange={(event) => onVendorIdChange(event.target.value)}
            placeholder=""
            disabled={!specifyVidPid}
          />
          {specifyVidPid && !vendorIdValid && vendorId.length > 0 && (
            <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
              {t('wizard.usbHidHexIdInvalid', 'Use 4 hexadecimal digits (for example 051d)')}
            </span>
          )}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-usbhid-productid">
            {t('wizard.usbHidProductId', 'Product ID')}
          </label>
          <UiInput
            id="wiz-usbhid-productid"
            className="form-input"
            type="text"
            value={productId}
            onChange={(event) => onProductIdChange(event.target.value)}
            placeholder=""
            disabled={!specifyVidPid}
          />
          {specifyVidPid && !productIdValid && productId.length > 0 && (
            <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
              {t('wizard.usbHidHexIdInvalid', 'Use 4 hexadecimal digits (for example 051d)')}
            </span>
          )}
        </div>
      </div>

      {vidPidMissing && (
        <span style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>
          {t('wizard.usbHidVidPidRequired', 'Enter both Vendor ID and Product ID, or disable Specify VID/PID')}
        </span>
      )}

      <div className="form-row form-row--two" style={{ marginTop: '8px' }}>
        <label className="form-toggle" htmlFor="wiz-usbhid-experimentalhid">
          <UiCheckbox
            id="wiz-usbhid-experimentalhid"
            checked
            disabled
            readOnly
          />
          <span className="form-toggle-label">
            {t('wizard.usbHidExperimentalhid', 'experimentalhid')}
          </span>
        </label>

        <label className="form-toggle" htmlFor="wiz-usbhid-pollonly">
          <UiCheckbox
            id="wiz-usbhid-pollonly"
            checked
            disabled
            readOnly
          />
          <span className="form-toggle-label">
            {t('wizard.usbHidPollonly', 'pollonly')}
          </span>
        </label>
      </div>

      <span className="form-hint">
        {t(
          'wizard.usbHidFixedFlagsHint',
          'experimentalhid and pollonly are currently fixed ON and cannot be changed on Windows.',
        )}
      </span>
    </>
  );
}
