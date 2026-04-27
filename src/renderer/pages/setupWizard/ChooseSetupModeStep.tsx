import { useTranslation } from 'react-i18next';
import { Router, MonitorCog, Cable, Usb } from 'lucide-react';
import { UiButton } from '../../components/ui';

type ChooseSetupModeStepProps = {
  onChooseDirectNut: () => void;
  onChooseSnmpSetup: () => void;
  onChooseSerialSetup: () => void;
  onChooseUsbHidSetup: () => void;
};

export function ChooseSetupModeStep({
  onChooseDirectNut,
  onChooseSnmpSetup,
  onChooseSerialSetup,
  onChooseUsbHidSetup,
}: ChooseSetupModeStepProps) {
  const { t } = useTranslation();

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
          <UiButton
            className="btn btn--secondary"
            onClick={onChooseDirectNut}
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
              style={{ flexShrink: 0, marginInlineStart: '12px' }}
            />
          </UiButton>

          <UiButton
            className="btn btn--secondary"
            onClick={onChooseSnmpSetup}
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
              style={{ flexShrink: 0, marginInlineStart: '12px' }}
            />
          </UiButton>

          <UiButton
            className="btn btn--secondary"
            onClick={onChooseSerialSetup}
            style={{
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
              padding: '16px',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
              <strong>{t('wizard.modeSerialSetup', 'Set Up Serial UPS')}</strong>
              <span className="form-hint">
                {t('wizard.modeSerialSetupDesc', 'Help me configure NUT to monitor a UPS over RS-232 serial')}
              </span>
            </span>
            <Cable
              size={20}
              style={{ flexShrink: 0, marginInlineStart: '12px' }}
            />
          </UiButton>

          <UiButton
            className="btn btn--secondary"
            onClick={onChooseUsbHidSetup}
            style={{
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'center',
              textAlign: 'left',
              padding: '16px',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
              <strong>{t('wizard.modeUsbHidSetup', 'Set Up USB HID UPS')}</strong>
              <span className="form-hint">
                {t('wizard.modeUsbHidSetupDesc', 'Help me configure NUT usbhid-ups on Windows with an official NUT release version 2.8.5 or newer')}
              </span>
            </span>
            <Usb
              size={20}
              style={{ flexShrink: 0, marginInlineStart: '12px', transform: 'rotate(45deg)' }}
            />
          </UiButton>
        </div>
      </div>
    </div>
  );
}
