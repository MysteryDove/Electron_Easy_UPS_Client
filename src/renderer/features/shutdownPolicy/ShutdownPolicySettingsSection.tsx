import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList,
  Copy,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { AppConfig } from '../../../shared/config/types';
import { electronApi } from '../../app/electronApi';
import {
  DEFAULT_COMMUNICATION_LOSS_RULE_ID,
  createCommunicationLossPolicy,
  createSimpleShutdownPolicyConfig,
  getNumericConditionValue,
  getRuleById,
} from '../../../shared/shutdownPolicy/defaultPolicies';
import { POLICY_FIELDS } from '../../../shared/shutdownPolicy/constants';
import { POLICY_FIELD_METADATA } from '../../../shared/shutdownPolicy/fieldMetadata';
import {
  explainDecision,
  flattenConditionExplanation,
} from '../../../shared/shutdownPolicy/explain';
import { simulateShutdownPolicy } from '../../../shared/shutdownPolicy/simulator';
import type {
  PolicyCondition,
  PolicyField,
  PolicyOperator,
  ShutdownMethod,
  ShutdownPolicyConnectionState,
  ShutdownPolicyAction,
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyDecision,
  ShutdownPolicyDecisionLogEntry,
  ShutdownPolicyRule,
  ShutdownPolicySeverity,
} from '../../../shared/shutdownPolicy/types';
import { UiButton, UiCheckbox, UiInput, UiSelect } from '../../components/ui';

type ShutdownPolicySettingsSectionProps = {
  config: AppConfig;
  batterySettings: AppConfig['battery'];
  fsdSettings: AppConfig['fsd'];
  onSave: (shutdownPolicy: ShutdownPolicyConfig) => Promise<void>;
};

const severityOptions: ShutdownPolicySeverity[] = [
  'info',
  'warning',
  'critical',
  'forced',
];

const actionOptions: ShutdownPolicyAction['type'][] = [
  'showWarning',
  'showCriticalAlert',
  'startShutdownCountdown',
  'shutdownNow',
  'cancelShutdownCountdown',
];

type SimulatorStatusToken = 'OL' | 'OB' | 'LB' | 'FSD';

const simulatorStatusTokenOptions: SimulatorStatusToken[] = [
  'OL',
  'OB',
  'LB',
  'FSD',
];

export function ShutdownPolicySettingsSection({
  config,
  batterySettings,
  fsdSettings,
  onSave,
}: ShutdownPolicySettingsSectionProps) {
  const { t } = useTranslation();
  const policy = config.shutdownPolicy as ShutdownPolicyConfig;
  const communicationRule = getRuleById(
    policy,
    DEFAULT_COMMUNICATION_LOSS_RULE_ID,
  );
  const [selectedRuleId, setSelectedRuleId] = useState<string>(
    policy.rules[0]?.id ?? '',
  );
  const selectedRule = useMemo(
    () => policy.rules.find((rule) => rule.id === selectedRuleId)
      ?? policy.rules[0],
    [policy.rules, selectedRuleId],
  );
  const communicationSettings = getCommunicationLossSettings(communicationRule);
  const [decisionLog, setDecisionLog] = useState<ShutdownPolicyDecisionLogEntry[]>([]);
  const [decisionLogError, setDecisionLogError] = useState<string | null>(null);

  const refreshDecisionLog = async () => {
    try {
      setDecisionLog(await electronApi.shutdownPolicy.getDecisionLog());
      setDecisionLogError(null);
    } catch (error) {
      setDecisionLogError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    void electronApi.shutdownPolicy.getDecisionLog()
      .then((entries) => {
        if (!cancelled) {
          setDecisionLog(entries);
          setDecisionLogError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDecisionLogError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveSimplePolicy = async (
    overrides: Partial<ReturnType<typeof getCommunicationLossSettings>> = {},
  ) => {
    const nextCommunicationSettings = {
      ...communicationSettings,
      ...overrides,
    };
    await onSave(createSimpleShutdownPolicyConfig(
      {
        battery: batterySettings,
        fsd: fsdSettings,
        mode: 'simple',
        communicationLoss: nextCommunicationSettings,
      },
      policy,
    ));
  };

  const savePolicy = async (nextPolicy: ShutdownPolicyConfig) => {
    await onSave(nextPolicy);
  };

  const updateRule = async (
    ruleId: string,
    patch: Partial<ShutdownPolicyRule>,
  ) => {
    const nextRules = policy.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...patch } : rule,
    );
    await savePolicy({
      ...policy,
      mode: 'advanced',
      rules: nextRules,
    });
  };

  const addRule = async (template: PolicyTemplate) => {
    const nextRule = createPolicyTemplateRule(template);
    setSelectedRuleId(nextRule.id);
    await savePolicy({
      ...policy,
      mode: 'advanced',
      rules: [...policy.rules, nextRule],
    });
  };

  const duplicateRule = async (rule: ShutdownPolicyRule) => {
    const nextRule = {
      ...rule,
      id: `user-${Date.now()}`,
      name: `${rule.name} copy`,
      createdBy: 'user' as const,
    };
    setSelectedRuleId(nextRule.id);
    await savePolicy({
      ...policy,
      mode: 'advanced',
      rules: [...policy.rules, nextRule],
    });
  };

  const deleteRule = async (ruleId: string) => {
    const nextRules = policy.rules.filter((rule) => rule.id !== ruleId);
    setSelectedRuleId(nextRules[0]?.id ?? '');
    await savePolicy({
      ...policy,
      mode: 'advanced',
      rules: nextRules,
    });
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">
        {t('settings.shutdownPolicy')}
      </h2>
      <div className="settings-section-body">
        <div className="form-group">
          <label className="form-label" htmlFor="shutdown-policy-mode">
            {t('settings.shutdownPolicyMode')}
          </label>
          <UiSelect
            id="shutdown-policy-mode"
            className="telemetry-select"
            value={policy.mode}
            onChange={(event) => {
              const mode = event.target.value as ShutdownPolicyConfig['mode'];
              if (mode === 'simple') {
                void saveSimplePolicy();
                return;
              }

              if (
                policy.mode === 'simple' &&
                !window.confirm(
                  t(
                    'settings.shutdownPolicyAdvancedWarning',
                    'Switching to advanced mode keeps the generated simple rules and lets you edit them directly.',
                  ),
                )
              ) {
                return;
              }

              void savePolicy({
                ...policy,
                mode: 'advanced',
              });
            }}
          >
            <option value="simple">{t('settings.shutdownPolicySimple')}</option>
            <option value="advanced">{t('settings.shutdownPolicyAdvanced')}</option>
          </UiSelect>
        </div>

        {policy.mode === 'simple' ? (
          <SimplePolicyControls
            communicationSettings={communicationSettings}
            onChange={(next) => {
              void saveSimplePolicy(next);
            }}
          />
        ) : (
          <div className="policy-advanced">
            <div className="policy-actions">
              <UiButton
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  void addRule('batteryPercent');
                }}
              >
                <Plus size={16} />
                <span>{t('settings.policyTemplateBattery')}</span>
              </UiButton>
              <UiButton
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  void addRule('runtime');
                }}
              >
                <Plus size={16} />
                <span>{t('settings.policyTemplateRuntime')}</span>
              </UiButton>
              <UiButton
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  void addRule('fsd');
                }}
              >
                <Plus size={16} />
                <span>{t('settings.policyTemplateFsd')}</span>
              </UiButton>
              <UiButton
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  void addRule('communicationLoss');
                }}
              >
                <Plus size={16} />
                <span>{t('settings.policyTemplateCommunication')}</span>
              </UiButton>
            </div>

            <div className="policy-rule-list">
              {policy.rules.map((rule) => (
                <div
                  className={`policy-rule-row ${selectedRule?.id === rule.id ? 'policy-rule-row--selected' : ''}`}
                  key={rule.id}
                >
                  <UiCheckbox
                    checked={rule.enabled}
                    onChange={(event) => {
                      void updateRule(rule.id, { enabled: event.target.checked });
                    }}
                    title={t('settings.policyEnabled')}
                  />
                  <button
                    type="button"
                    className="policy-rule-main"
                    onClick={() => setSelectedRuleId(rule.id)}
                  >
                    <span className="policy-rule-name">{rule.name}</span>
                    <span className="policy-rule-meta">
                      {rule.priority} / {rule.severity} / {formatPolicyAction(rule.action)}
                    </span>
                  </button>
                  <UiButton
                    type="button"
                    className="policy-icon-btn"
                    title={t('settings.policyDuplicate')}
                    onClick={() => {
                      void duplicateRule(rule);
                    }}
                  >
                    <Copy size={16} />
                  </UiButton>
                  <UiButton
                    type="button"
                    className="policy-icon-btn"
                    title={t('settings.policyDelete')}
                    onClick={() => {
                      void deleteRule(rule.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </UiButton>
                </div>
              ))}
            </div>

            {selectedRule && (
              <PolicyRuleEditor
                rule={selectedRule}
                onUpdate={(patch) => {
                  void updateRule(selectedRule.id, patch);
                }}
              />
            )}
          </div>
        )}

        <PolicySimulator policy={policy} />
        <PolicyDecisionHistory
          entries={decisionLog}
          error={decisionLogError}
          onRefresh={() => {
            void refreshDecisionLog();
          }}
        />
      </div>
    </section>
  );
}

function SimplePolicyControls({
  communicationSettings,
  onChange,
}: {
  communicationSettings: ReturnType<typeof getCommunicationLossSettings>;
  onChange: (settings: Partial<ReturnType<typeof getCommunicationLossSettings>>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="policy-simple">
      <label className="form-toggle">
        <UiCheckbox
          checked={communicationSettings.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span className="form-toggle-label">
          {t('settings.policyCommunicationLossEnable')}
        </span>
      </label>
      <div className="form-row form-row--two" style={{ marginTop: 8 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-comms-after">
            {t('settings.policyCommunicationLossAfter')}
          </label>
          <UiInput
            id="policy-comms-after"
            className="form-input form-input--narrow"
            type="number"
            min={30}
            max={3600}
            value={communicationSettings.secondsSinceLastSuccessfulPoll}
            disabled={!communicationSettings.enabled}
            onChange={(event) =>
              onChange({
                secondsSinceLastSuccessfulPoll: Number(event.target.value),
              })}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-comms-countdown">
            {t('settings.policyCountdownSeconds')}
          </label>
          <UiInput
            id="policy-comms-countdown"
            className="form-input form-input--narrow"
            type="number"
            min={1}
            max={300}
            value={communicationSettings.countdownSeconds}
            disabled={!communicationSettings.enabled}
            onChange={(event) =>
              onChange({ countdownSeconds: Number(event.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}

function PolicySimulator({ policy }: { policy: ShutdownPolicyConfig }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Record<SimulatorStatusToken, boolean>>({
    OL: false,
    OB: true,
    LB: true,
    FSD: false,
  });
  const [batteryChargePercent, setBatteryChargePercent] = useState(18);
  const [runtimeSeconds, setRuntimeSeconds] = useState(240);
  const [connectionState, setConnectionState] =
    useState<ShutdownPolicyConnectionState>('connected');
  const [
    secondsSinceLastSuccessfulPoll,
    setSecondsSinceLastSuccessfulPoll,
  ] = useState(0);
  const [secondsOnBattery, setSecondsOnBattery] = useState(120);

  const context = useMemo<ShutdownPolicyContext>(() => {
    const statusTokens = simulatorStatusTokens(status);
    return {
      now: Date.now(),
      ups: {
        online: status.OL,
        onBattery: status.OB,
        lowBattery: status.LB,
        fsd: status.FSD,
        statusTokens,
      },
      battery: {
        chargePercent: batteryChargePercent,
        runtimeSeconds,
      },
      connection: {
        state: connectionState,
        secondsSinceLastSuccessfulPoll,
      },
      state: {
        secondsOnBattery: status.OB ? secondsOnBattery : 0,
        secondsOnline: status.OL ? secondsOnBattery : 0,
        secondsLowBattery: status.LB ? secondsOnBattery : 0,
        secondsInFsd: status.FSD ? secondsOnBattery : 0,
      },
    };
  }, [
    batteryChargePercent,
    connectionState,
    runtimeSeconds,
    secondsOnBattery,
    secondsSinceLastSuccessfulPoll,
    status,
  ]);

  const simulation = useMemo(
    () => simulateShutdownPolicy(policy, context),
    [context, policy],
  );
  const selectedRuleResult = simulation.selectedRule
    ? simulation.ruleResults.find(
      (result) => result.rule.id === simulation.selectedRule?.id,
    )
    : undefined;
  const selectedExplanation = selectedRuleResult
    ? flattenConditionExplanation(selectedRuleResult.condition)
    : [];

  return (
    <div className="policy-tool-panel">
      <div className="policy-editor-title">
        <ClipboardList size={16} />
        <span>{t('settings.policySimulator')}</span>
      </div>

      <div className="policy-simulator-grid">
        <div className="form-group">
          <span className="form-label">{t('settings.policySimulatorStatus')}</span>
          <div className="policy-status-toggles">
            {simulatorStatusTokenOptions.map((token) => (
              <label className="form-toggle" key={token}>
                <UiCheckbox
                  checked={status[token]}
                  onChange={(event) =>
                    setStatus({
                      ...status,
                      [token]: event.target.checked,
                    })}
                />
                <span className="form-toggle-label">{token}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-simulator-charge">
            {t('settings.policySimulatorCharge')}
          </label>
          <UiInput
            id="policy-simulator-charge"
            className="form-input form-input--narrow"
            type="number"
            min={0}
            max={100}
            value={batteryChargePercent}
            onChange={(event) =>
              setBatteryChargePercent(Number(event.target.value))}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-simulator-runtime">
            {t('settings.policySimulatorRuntime')}
          </label>
          <UiInput
            id="policy-simulator-runtime"
            className="form-input form-input--narrow"
            type="number"
            min={0}
            value={runtimeSeconds}
            onChange={(event) => setRuntimeSeconds(Number(event.target.value))}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-simulator-connection">
            {t('settings.policySimulatorConnection')}
          </label>
          <UiSelect
            id="policy-simulator-connection"
            className="telemetry-select"
            value={connectionState}
            onChange={(event) =>
              setConnectionState(
                event.target.value as ShutdownPolicyConnectionState,
              )}
          >
            <option value="connected">connected</option>
            <option value="degraded">degraded</option>
            <option value="disconnected">disconnected</option>
          </UiSelect>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-simulator-last-poll">
            {t('settings.policySimulatorLastPoll')}
          </label>
          <UiInput
            id="policy-simulator-last-poll"
            className="form-input form-input--narrow"
            type="number"
            min={0}
            value={secondsSinceLastSuccessfulPoll}
            onChange={(event) =>
              setSecondsSinceLastSuccessfulPoll(Number(event.target.value))}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-simulator-on-battery">
            {t('settings.policySimulatorOnBattery')}
          </label>
          <UiInput
            id="policy-simulator-on-battery"
            className="form-input form-input--narrow"
            type="number"
            min={0}
            value={secondsOnBattery}
            onChange={(event) => setSecondsOnBattery(Number(event.target.value))}
          />
        </div>
      </div>

      <div className="policy-simulator-result">
        <div className="policy-result-summary">
          {explainDecision(simulation.decision, simulation.selectedRule)}
        </div>
        {selectedExplanation.length > 0 && (
          <ul className="policy-explanation-lines">
            {selectedExplanation.map((line, index) => (
              <li
                className={line.startsWith('PASS')
                  ? 'policy-explanation-line--pass'
                  : 'policy-explanation-line--fail'}
                key={`${line}-${index}`}
              >
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="policy-rule-explanations">
        {simulation.ruleResults.map((result) => (
          <details
            className="policy-rule-explanation"
            key={result.rule.id}
            open={result.rule.id === simulation.selectedRule?.id}
          >
            <summary>
              <span>{result.rule.name}</span>
              <span className={result.matched
                ? 'policy-rule-explanation-status--matched'
                : 'policy-rule-explanation-status--unmatched'}
              >
                {result.matched
                  ? t('settings.policySimulatorMatched')
                  : t('settings.policySimulatorNotMatched')}
              </span>
            </summary>
            <ul className="policy-explanation-lines">
              {flattenConditionExplanation(result.condition).map((line, index) => (
                <li
                  className={line.startsWith('PASS')
                    ? 'policy-explanation-line--pass'
                    : 'policy-explanation-line--fail'}
                  key={`${result.rule.id}-${line}-${index}`}
                >
                  {line}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function PolicyDecisionHistory({
  entries,
  error,
  onRefresh,
}: {
  entries: ShutdownPolicyDecisionLogEntry[];
  error: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="policy-tool-panel">
      <div className="policy-history-header">
        <div className="policy-editor-title">
          <ClipboardList size={16} />
          <span>{t('settings.policyDecisionHistory')}</span>
        </div>
        <UiButton
          type="button"
          className="policy-icon-btn"
          title={t('settings.policyDecisionHistoryRefresh')}
          onClick={onRefresh}
        >
          <RefreshCw size={16} />
        </UiButton>
      </div>

      {error && (
        <div className="policy-history-error">
          {t('settings.policyDecisionHistoryFailed', { reason: error })}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="policy-history-empty">
          {t('settings.policyDecisionHistoryEmpty')}
        </div>
      ) : (
        <div className="policy-history-list">
          {entries.map((entry) => (
            <div className="policy-history-entry" key={entry.id}>
              <div className="policy-history-entry-main">
                <span className="policy-history-entry-time">
                  {new Date(entry.timestampIso).toLocaleString()}
                </span>
                <span className={`policy-history-entry-event policy-history-entry-event--${entry.event}`}>
                  {entry.event}
                </span>
              </div>
              <div className="policy-history-entry-summary">
                {entry.summary}
              </div>
              <div className="policy-history-entry-meta">
                {entry.ruleName ?? entry.ruleId ?? formatPolicyDecision(entry.decision)}
                {' / '}
                {formatLogContext(entry)}
              </div>
              {entry.execution?.errorMessage && (
                <div className="policy-history-entry-error">
                  {entry.execution.errorMessage}
                </div>
              )}
              {entry.conditionExplanation && entry.conditionExplanation.length > 0 && (
                <details className="policy-history-entry-details">
                  <summary>{t('settings.policyDecisionHistoryConditions')}</summary>
                  <ul className="policy-explanation-lines">
                    {entry.conditionExplanation.map((line, index) => (
                      <li
                        className={line.startsWith('PASS')
                          ? 'policy-explanation-line--pass'
                          : 'policy-explanation-line--fail'}
                        key={`${entry.id}-${line}-${index}`}
                      >
                        {line}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyRuleEditor({
  rule,
  onUpdate,
}: {
  rule: ShutdownPolicyRule;
  onUpdate: (patch: Partial<ShutdownPolicyRule>) => void;
}) {
  const { t } = useTranslation();
  const editableCondition = getEditableCondition(rule.trigger);
  const actionType = rule.action.type;
  const actionMethod = 'method' in rule.action ? rule.action.method : 'shutdown';
  const countdownSeconds =
    rule.action.type === 'startShutdownCountdown'
      ? rule.action.countdownSeconds
      : 60;

  return (
    <div className="policy-editor">
      <div className="policy-editor-title">
        <SlidersHorizontal size={16} />
        <span>{t('settings.policyRuleEditor')}</span>
      </div>
      <div className="form-row form-row--two">
        <div className="form-group">
          <label className="form-label" htmlFor="policy-rule-name">
            {t('settings.policyRuleName')}
          </label>
          <UiInput
            id="policy-rule-name"
            className="form-input"
            value={rule.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-rule-priority">
            {t('settings.policyPriority')}
          </label>
          <UiInput
            id="policy-rule-priority"
            className="form-input form-input--narrow"
            type="number"
            value={rule.priority}
            onChange={(event) => onUpdate({ priority: Number(event.target.value) })}
          />
        </div>
      </div>
      <div className="form-row form-row--two">
        <div className="form-group">
          <label className="form-label" htmlFor="policy-rule-severity">
            {t('settings.policySeverity')}
          </label>
          <UiSelect
            id="policy-rule-severity"
            className="telemetry-select"
            value={rule.severity}
            onChange={(event) =>
              onUpdate({ severity: event.target.value as ShutdownPolicySeverity })}
          >
            {severityOptions.map((severity) => (
              <option key={severity} value={severity}>{severity}</option>
            ))}
          </UiSelect>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="policy-rule-action">
            {t('settings.policyAction')}
          </label>
          <UiSelect
            id="policy-rule-action"
            className="telemetry-select"
            value={actionType}
            onChange={(event) => {
              const nextActionType =
                event.target.value as ShutdownPolicyAction['type'];
              onUpdate({
                action: createAction(nextActionType),
                cancelWhen: nextActionType === 'startShutdownCountdown'
                  ? rule.cancelWhen ?? null
                  : rule.cancelWhen,
              });
            }}
          >
            {actionOptions.map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </UiSelect>
        </div>
      </div>

      {(actionType === 'startShutdownCountdown' || actionType === 'shutdownNow') && (
        <div className="form-row form-row--two">
          {actionType === 'startShutdownCountdown' && (
            <div className="form-group">
              <label className="form-label" htmlFor="policy-action-countdown">
                {t('settings.policyCountdownSeconds')}
              </label>
              <UiInput
                id="policy-action-countdown"
                className="form-input form-input--narrow"
                type="number"
                min={1}
                max={300}
                value={countdownSeconds}
                onChange={(event) =>
                  onUpdate({
                    action: {
                      type: 'startShutdownCountdown',
                      countdownSeconds: Number(event.target.value),
                      method: actionMethod,
                    },
                  })}
              />
            </div>
          )}
          <div className="form-group">
            <label className="form-label" htmlFor="policy-action-method">
              {t('settings.policyShutdownMethod')}
            </label>
            <UiSelect
              id="policy-action-method"
              className="telemetry-select"
              value={actionMethod}
              onChange={(event) => {
                const method = event.target.value as ShutdownMethod;
                if (actionType === 'shutdownNow') {
                  onUpdate({ action: { type: 'shutdownNow', method } });
                  return;
                }

                onUpdate({
                  action: {
                    type: 'startShutdownCountdown',
                    countdownSeconds,
                    method,
                  },
                });
              }}
            >
              <option value="shutdown">{t('settings.shutdownMethodFull')}</option>
              <option value="sleep">{t('settings.shutdownMethodSleep')}</option>
            </UiSelect>
          </div>
        </div>
      )}

      <div className="policy-condition-builder">
        <div className="policy-editor-title">
          <span>{t('settings.policyCondition')}</span>
        </div>
        <div className="form-row form-row--two">
          <div className="form-group">
            <label className="form-label" htmlFor="policy-condition-field">
              {t('settings.policyField')}
            </label>
            <UiSelect
              id="policy-condition-field"
              className="telemetry-select"
              value={editableCondition.field}
              onChange={(event) => {
                const field = event.target.value as PolicyField;
                const nextOperator =
                  POLICY_FIELD_METADATA[field].supportedOperators[0];
                onUpdate({
                  trigger: updateEditableTrigger(
                    rule.trigger,
                    field,
                    nextOperator,
                    defaultValueForField(field),
                    editableCondition.requireOnBattery,
                  ),
                });
              }}
            >
              {POLICY_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {POLICY_FIELD_METADATA[field].label}
                </option>
              ))}
            </UiSelect>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="policy-condition-op">
              {t('settings.policyOperator')}
            </label>
            <UiSelect
              id="policy-condition-op"
              className="telemetry-select"
              value={editableCondition.operator}
              onChange={(event) => {
                const operator = event.target.value as PolicyOperator;
                onUpdate({
                  trigger: updateEditableTrigger(
                    rule.trigger,
                    editableCondition.field,
                    operator,
                    editableCondition.value,
                    editableCondition.requireOnBattery,
                  ),
                });
              }}
            >
              {POLICY_FIELD_METADATA[editableCondition.field].supportedOperators.map((operator) => (
                <option key={operator} value={operator}>{operator}</option>
              ))}
            </UiSelect>
          </div>
        </div>
        {editableCondition.operator !== 'exists' &&
          editableCondition.operator !== 'notExists' && (
          <div className="form-group">
            <label className="form-label" htmlFor="policy-condition-value">
              {t('settings.policyValue')}
            </label>
            <UiInput
              id="policy-condition-value"
              className="form-input"
              value={String(editableCondition.value ?? '')}
              onChange={(event) => {
                onUpdate({
                  trigger: updateEditableTrigger(
                    rule.trigger,
                    editableCondition.field,
                    editableCondition.operator,
                    parseConditionValue(
                      editableCondition.field,
                      event.target.value,
                    ),
                    editableCondition.requireOnBattery,
                  ),
                });
              }}
            />
          </div>
        )}
        <label className="form-toggle">
          <UiCheckbox
            checked={editableCondition.requireOnBattery}
            onChange={(event) =>
              onUpdate({
                trigger: updateEditableTrigger(
                  rule.trigger,
                  editableCondition.field,
                  editableCondition.operator,
                  editableCondition.value,
                  event.target.checked,
                ),
              })}
          />
          <span className="form-toggle-label">
            {t('settings.policyRequireOnBattery')}
          </span>
        </label>
      </div>
    </div>
  );
}

type PolicyTemplate =
  | 'batteryPercent'
  | 'runtime'
  | 'fsd'
  | 'communicationLoss';

function createPolicyTemplateRule(template: PolicyTemplate): ShutdownPolicyRule {
  if (template === 'communicationLoss') {
    return {
      ...createCommunicationLossPolicy({ enabled: true }),
      id: `user-comms-${Date.now()}`,
      createdBy: 'user',
    };
  }

  if (template === 'fsd') {
    return {
      id: `user-fsd-${Date.now()}`,
      name: 'FSD shutdown',
      enabled: true,
      priority: 1000,
      severity: 'forced',
      trigger: { field: 'ups.fsd', op: 'eq', value: true },
      action: {
        type: 'startShutdownCountdown',
        countdownSeconds: 30,
        method: 'shutdown',
      },
      cancelWhen: null,
      holdForSeconds: 0,
      createdBy: 'user',
    };
  }

  const field = template === 'runtime'
    ? 'battery.runtimeSeconds'
    : 'battery.chargePercent';
  const value = template === 'runtime' ? 300 : 20;

  return {
    id: `user-${template}-${Date.now()}`,
    name: template === 'runtime'
      ? 'Runtime remaining shutdown'
      : 'Battery percentage shutdown',
    enabled: true,
    priority: 100,
    severity: 'critical',
    trigger: createEditableTrigger(field, 'lte', value, true),
    holdForSeconds: 0,
    action: {
      type: 'startShutdownCountdown',
      countdownSeconds: 60,
      method: 'shutdown',
    },
    cancelWhen: {
      all: [
        { field: 'ups.online', op: 'eq', value: true },
        { field: 'ups.fsd', op: 'eq', value: false },
      ],
    },
    createdBy: 'user',
  };
}

function getCommunicationLossSettings(rule: ShutdownPolicyRule | undefined) {
  const countdownAction = rule?.action.type === 'startShutdownCountdown'
    ? rule.action
    : undefined;

  return {
    enabled: rule?.enabled ?? false,
    secondsOnBattery:
      rule ? getNumericConditionValue(rule.trigger, 'state.secondsOnBattery') ?? 60 : 60,
    secondsSinceLastSuccessfulPoll:
      rule
        ? getNumericConditionValue(
          rule.trigger,
          'connection.secondsSinceLastSuccessfulPoll',
        ) ?? 300
        : 300,
    countdownSeconds: countdownAction?.countdownSeconds ?? 60,
    method: countdownAction?.method ?? 'shutdown',
  };
}

function formatPolicyAction(action: ShutdownPolicyAction): string {
  if (action.type === 'startShutdownCountdown') {
    return `${action.type} ${action.countdownSeconds}s`;
  }

  return action.type;
}

function formatPolicyDecision(decision: ShutdownPolicyDecision): string {
  switch (decision.type) {
    case 'none':
      return 'none';
    case 'showWarning':
    case 'showCriticalAlert':
    case 'cancelShutdownCountdown':
      return decision.type;
    case 'startShutdownCountdown':
      return `${decision.type} ${decision.countdownSeconds}s`;
    case 'shutdownNow':
      return `${decision.type} ${decision.method}`;
    default:
      return assertNever(decision);
  }
}

function formatLogContext(entry: ShutdownPolicyDecisionLogEntry): string {
  const tokens = entry.context.statusTokens.length > 0
    ? entry.context.statusTokens.join(' ')
    : 'no status';
  const charge = entry.context.batteryChargePercent === undefined
    ? 'charge unknown'
    : `${entry.context.batteryChargePercent}%`;
  return `${tokens}, ${charge}, ${entry.context.connectionState}`;
}

function simulatorStatusTokens(
  status: Record<SimulatorStatusToken, boolean>,
): string[] {
  return simulatorStatusTokenOptions.filter((token) => status[token]);
}

function createAction(actionType: ShutdownPolicyAction['type']): ShutdownPolicyAction {
  switch (actionType) {
    case 'showWarning':
      return { type: 'showWarning' };
    case 'showCriticalAlert':
      return { type: 'showCriticalAlert' };
    case 'startShutdownCountdown':
      return {
        type: 'startShutdownCountdown',
        countdownSeconds: 60,
        method: 'shutdown',
      };
    case 'shutdownNow':
      return {
        type: 'shutdownNow',
        method: 'shutdown',
      };
    case 'cancelShutdownCountdown':
      return { type: 'cancelShutdownCountdown' };
    default:
      return assertNever(actionType);
  }
}

function getEditableCondition(condition: PolicyCondition): {
  field: PolicyField;
  operator: PolicyOperator;
  value?: string | number | boolean;
  requireOnBattery: boolean;
} {
  const requireOnBattery = conditionIncludesOnBattery(condition);
  const leaf = findFirstEditableLeaf(condition);

  return {
    field: leaf?.field ?? 'battery.chargePercent',
    operator: leaf?.op ?? 'lte',
    value: leaf?.value ?? 20,
    requireOnBattery,
  };
}

function createEditableTrigger(
  field: PolicyField,
  operator: PolicyOperator,
  value: string | number | boolean | undefined,
  requireOnBattery: boolean,
): PolicyCondition {
  const leaf = createEditableLeaf(field, operator, value);

  if (!requireOnBattery) {
    return leaf;
  }

  return {
    all: [
      { field: 'ups.onBattery', op: 'eq', value: true },
      leaf,
    ],
  };
}

function updateEditableTrigger(
  originalCondition: PolicyCondition,
  field: PolicyField,
  operator: PolicyOperator,
  value: string | number | boolean | undefined,
  requireOnBattery: boolean,
): PolicyCondition {
  const nextLeaf = createEditableLeaf(field, operator, value);
  const baseCondition = stripOnBatteryRequirement(originalCondition) ?? nextLeaf;
  const [updatedCondition, replaced] = replaceFirstEditableLeaf(baseCondition, nextLeaf);
  const nextCondition = replaced ? updatedCondition : nextLeaf;

  return requireOnBattery
    ? ensureOnBatteryRequirement(nextCondition)
    : nextCondition;
}

function conditionIncludesOnBattery(condition: PolicyCondition): boolean {
  if ('all' in condition) {
    return condition.all.some(conditionIncludesOnBattery);
  }

  if ('any' in condition) {
    return condition.any.some(conditionIncludesOnBattery);
  }

  if ('not' in condition) {
    return false;
  }

  return (
    condition.field === 'ups.onBattery' &&
    condition.op === 'eq' &&
    condition.value === true
  );
}

function findFirstEditableLeaf(
  condition: PolicyCondition,
): Extract<PolicyCondition, { field: PolicyField; op: PolicyOperator }> | null {
  if ('all' in condition) {
    for (const child of condition.all) {
      const leaf = findFirstEditableLeaf(child);
      if (leaf && leaf.field !== 'ups.onBattery') {
        return leaf;
      }
    }
    return null;
  }

  if ('any' in condition) {
    return findFirstEditableLeaf(condition.any[0]);
  }

  if ('not' in condition) {
    return findFirstEditableLeaf(condition.not);
  }

  return condition;
}

function createEditableLeaf(
  field: PolicyField,
  operator: PolicyOperator,
  value: string | number | boolean | undefined,
): PolicyCondition {
  return operator === 'exists' || operator === 'notExists'
    ? { field, op: operator }
    : { field, op: operator, value };
}

function replaceFirstEditableLeaf(
  condition: PolicyCondition,
  nextLeaf: PolicyCondition,
): [PolicyCondition, boolean] {
  if ('all' in condition) {
    let replaced = false;
    return [
      {
        all: condition.all.map((child) => {
          if (replaced) {
            return child;
          }

          const [nextChild, childReplaced] = replaceFirstEditableLeaf(child, nextLeaf);
          replaced = childReplaced;
          return nextChild;
        }),
      },
      replaced,
    ];
  }

  if ('any' in condition) {
    let replaced = false;
    return [
      {
        any: condition.any.map((child) => {
          if (replaced) {
            return child;
          }

          const [nextChild, childReplaced] = replaceFirstEditableLeaf(child, nextLeaf);
          replaced = childReplaced;
          return nextChild;
        }),
      },
      replaced,
    ];
  }

  if ('not' in condition) {
    const [nextCondition, replaced] = replaceFirstEditableLeaf(condition.not, nextLeaf);
    return [{ not: nextCondition }, replaced];
  }

  return isOnBatteryRequirementLeaf(condition)
    ? [condition, false]
    : [nextLeaf, true];
}

function ensureOnBatteryRequirement(condition: PolicyCondition): PolicyCondition {
  if (conditionIncludesOnBattery(condition)) {
    return condition;
  }

  if ('all' in condition) {
    return {
      all: [onBatteryRequirement(), ...condition.all],
    };
  }

  return {
    all: [onBatteryRequirement(), condition],
  };
}

function stripOnBatteryRequirement(condition: PolicyCondition): PolicyCondition | null {
  if ('all' in condition) {
    const children = condition.all
      .map((child) => stripOnBatteryRequirement(child))
      .filter((child): child is PolicyCondition => child !== null);
    return simplifyConditionGroup('all', children);
  }

  if ('any' in condition) {
    const children = condition.any
      .map((child) => stripOnBatteryRequirement(child))
      .filter((child): child is PolicyCondition => child !== null);
    return simplifyConditionGroup('any', children);
  }

  if ('not' in condition) {
    const nextCondition = stripOnBatteryRequirement(condition.not);
    return nextCondition ? { not: nextCondition } : null;
  }

  return isOnBatteryRequirementLeaf(condition) ? null : condition;
}

function simplifyConditionGroup(
  kind: 'all' | 'any',
  children: PolicyCondition[],
): PolicyCondition | null {
  if (children.length === 0) {
    return null;
  }

  if (children.length === 1) {
    return children[0];
  }

  return kind === 'all'
    ? { all: children }
    : { any: children };
}

function isOnBatteryRequirementLeaf(
  condition: Extract<PolicyCondition, { field: PolicyField; op: PolicyOperator }>,
): boolean {
  return (
    condition.field === 'ups.onBattery' &&
    condition.op === 'eq' &&
    condition.value === true
  );
}

function onBatteryRequirement(): PolicyCondition {
  return {
    field: 'ups.onBattery',
    op: 'eq',
    value: true,
  };
}

function parseConditionValue(
  field: PolicyField,
  rawValue: string,
): string | number | boolean {
  const valueType = POLICY_FIELD_METADATA[field].valueType;
  if (valueType === 'number') {
    return Number(rawValue);
  }

  if (valueType === 'boolean') {
    return rawValue === 'true';
  }

  return rawValue;
}

function defaultValueForField(field: PolicyField): string | number | boolean {
  const valueType = POLICY_FIELD_METADATA[field].valueType;
  if (valueType === 'number') {
    return 0;
  }

  if (valueType === 'boolean') {
    return true;
  }

  if (field === 'connection.state') {
    return 'connected';
  }

  return '';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
