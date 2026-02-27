import { useTranslation } from 'react-i18next';
import type {
  AuthProtocol,
  PrivProtocol,
  SecLevel,
  SnmpVersion,
} from './types';

export type SnmpSetupFormProps = {
  upsName: string;
  upsNameValid: boolean;
  snmpTarget: string;
  snmpTargetValid: boolean;
  snmpVersion: SnmpVersion;
  pollfreq: number;
  mibs: string;
  community: string;
  secLevel: SecLevel;
  secName: string;
  authProtocol: AuthProtocol;
  authPassword: string;
  privProtocol: PrivProtocol;
  privPassword: string;
  onUpsNameChange: (value: string) => void;
  onSnmpTargetChange: (value: string) => void;
  onSnmpVersionChange: (value: SnmpVersion) => void;
  onPollfreqChange: (value: number) => void;
  onMibsChange: (value: string) => void;
  onCommunityChange: (value: string) => void;
  onSecLevelChange: (value: SecLevel) => void;
  onSecNameChange: (value: string) => void;
  onAuthProtocolChange: (value: AuthProtocol) => void;
  onAuthPasswordChange: (value: string) => void;
  onPrivProtocolChange: (value: PrivProtocol) => void;
  onPrivPasswordChange: (value: string) => void;
};

export function SnmpSetupForm({
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
  onUpsNameChange,
  onSnmpTargetChange,
  onSnmpVersionChange,
  onPollfreqChange,
  onMibsChange,
  onCommunityChange,
  onSecLevelChange,
  onSecNameChange,
  onAuthProtocolChange,
  onAuthPasswordChange,
  onPrivProtocolChange,
  onPrivPasswordChange,
}: SnmpSetupFormProps) {
  const { t } = useTranslation();

  return (
    <>
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
          onChange={(event) => onUpsNameChange(event.target.value)}
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
          onChange={(event) => onSnmpTargetChange(event.target.value)}
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
            onChange={(event) => onSnmpVersionChange(event.target.value as SnmpVersion)}
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
            onChange={(event) => onPollfreqChange(Number(event.target.value))}
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
            onChange={(event) => onMibsChange(event.target.value)}
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
            onChange={(event) => onCommunityChange(event.target.value)}
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
                onChange={(event) => onSecLevelChange(event.target.value as SecLevel)}
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
                onChange={(event) => onSecNameChange(event.target.value)}
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
                  onChange={(event) => onAuthProtocolChange(event.target.value as AuthProtocol)}
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
                  onChange={(event) => onAuthPasswordChange(event.target.value)}
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
                  onChange={(event) => onPrivProtocolChange(event.target.value as PrivProtocol)}
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
                  onChange={(event) => onPrivPasswordChange(event.target.value)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
