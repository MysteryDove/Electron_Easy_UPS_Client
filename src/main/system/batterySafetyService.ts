import { Notification } from 'electron';
import type { AppConfig } from '../config/configSchema';
import type { TelemetryValues } from '../db/telemetryRepository';
import type { ConnectionState } from '../../shared/ipc/contracts';
import { migrateLegacyShutdownPolicyConfig } from '../shutdown/ShutdownPolicyMigration';
import { ShutdownPolicyContextBuilder } from '../shutdown/ShutdownPolicyContextBuilder';
import { ShutdownPolicyEngine } from '../shutdown/ShutdownPolicyEngine';
import {
  ShutdownExecutor,
  type ShutdownExecutionResult,
} from '../shutdown/ShutdownExecutor';
import {
  DEFAULT_BATTERY_SHUTDOWN_RULE_ID,
  DEFAULT_BATTERY_WARNING_RULE_ID,
  DEFAULT_FSD_SHUTDOWN_RULE_ID,
} from '../../shared/shutdownPolicy/defaultPolicies';
import { evaluatePolicyCondition } from '../../shared/shutdownPolicy/evaluation';
import {
  explainDecision,
  flattenConditionExplanation,
} from '../../shared/shutdownPolicy/explain';
import type {
  ShutdownPolicyConfig,
  ShutdownPolicyContext,
  ShutdownPolicyDecision,
  ShutdownPolicyDecisionLogEntry,
  ShutdownPolicyRule,
} from '../../shared/shutdownPolicy/types';
import type { CriticalAlertWindow } from './criticalAlertWindow';
import { t } from './i18nService';

const BATTERY_RECOVERY_HYSTERESIS_PCT = 5;
const MAX_DECISION_LOG_ENTRIES = 100;
const CONNECTION_LOSS_EVALUATION_INTERVAL_MS = 5000;

type CountdownDecision = Extract<
  ShutdownPolicyDecision,
  { type: 'startShutdownCountdown' }
>;

export class BatterySafetyService {
  private readonly criticalAlert: CriticalAlertWindow;
  private readonly policyContextBuilder = new ShutdownPolicyContextBuilder();
  private readonly shutdownExecutor = new ShutdownExecutor();
  private readonly appliedRuleIds = new Set<string>();
  private readonly decisionLog: ShutdownPolicyDecisionLogEntry[] = [];
  private batteryConfig: AppConfig['battery'];
  private policyConfig: ShutdownPolicyConfig;
  private policyEngine: ShutdownPolicyEngine;
  private fsdActive = false;
  private fsdShutdownCommitted = false;
  private activeCountdownRuleId: string | null = null;
  private lastBatteryPercent: number | null = null;
  private lastOnBattery = false;
  private latestContext: ShutdownPolicyContext | null = null;
  private connectionState: ConnectionState = 'idle';
  private decisionLogCounter = 0;
  private communicationLossEvaluationTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(config: AppConfig, criticalAlert: CriticalAlertWindow) {
    this.batteryConfig = config.battery;
    this.policyConfig = resolvePolicyConfig(config);
    this.policyEngine = new ShutdownPolicyEngine(this.policyConfig);
    this.criticalAlert = criticalAlert;
  }

  public handleTelemetry(values: TelemetryValues, rawUpsStatus?: string): void {
    const context = this.policyContextBuilder.build({
      values,
      rawUpsStatus,
      connectionState: this.connectionState,
      activeCountdownRuleId: this.activeCountdownRuleId ?? undefined,
    });
    this.latestContext = context;

    this.resetAppliedRuleState(context);
    this.resetBatterySideEffectsIfSafe(context);

    const decision = this.policyEngine.evaluate(context);
    this.applyDecision(decision, context);

    if (context.battery.chargePercent !== undefined) {
      this.lastBatteryPercent = context.battery.chargePercent;
    }
    this.lastOnBattery = context.ups.onBattery;
    this.updateCommunicationLossEvaluationTimer();
  }

  public handleConnectionState(state: ConnectionState): void {
    this.connectionState = state;

    if (this.latestContext === null) {
      this.updateCommunicationLossEvaluationTimer();
      return;
    }

    const context = this.policyContextBuilder.build({
      connectionState: state,
      pollSucceeded: false,
      activeCountdownRuleId: this.activeCountdownRuleId ?? undefined,
    });
    this.latestContext = context;

    this.resetAppliedRuleState(context);
    this.resetBatterySideEffectsIfSafe(context);
    const decision = this.policyEngine.evaluate(context);
    this.applyDecision(decision, context);

    this.lastOnBattery = context.ups.onBattery;
    this.updateCommunicationLossEvaluationTimer();
  }

  public getDecisionLog(): ShutdownPolicyDecisionLogEntry[] {
    return [...this.decisionLog];
  }

  public stop(): void {
    this.stopCommunicationLossEvaluationTimer();
  }

  public handleConfigUpdated(config: AppConfig): void {
    const hadCancellableCountdown =
      this.activeCountdownRuleId !== null && !this.fsdShutdownCommitted;

    // PRESERVE FSD STATE across config swaps. Previously this method reset
    // `activeCountdownRuleId` and `appliedRuleIds` unconditionally, leaving an
    // active FSD overlay visible while the engine and service forgot which rule
    // owned the countdown. That widened the L2-F1 attack surface: after a config
    // save, even the (post-fix) FSD guard could not associate a future cancel
    // decision with the still-armed FSD. Capture state before the swap so we can
    // restore it for the FSD-committed case.
    const fsdWasCommitted = this.fsdShutdownCommitted;
    const fsdCountdownRuleId =
      fsdWasCommitted && this.activeCountdownRuleId !== null
        ? this.activeCountdownRuleId
        : null;

    this.batteryConfig = config.battery;
    this.policyConfig = resolvePolicyConfig(config);
    this.policyEngine = new ShutdownPolicyEngine(this.policyConfig);
    this.policyContextBuilder.reset();
    this.appliedRuleIds.clear();
    this.activeCountdownRuleId = null;
    this.lastOnBattery = false;

    if (fsdCountdownRuleId !== null) {
      // The new policy engine instance starts with no in-memory countdown; the
      // overlay is still shown to the user. Re-link the service-level FSD state
      // so cancelPolicyCountdown's fsdShutdownCommitted guard still protects it
      // and applyDecision branches that key off DEFAULT_FSD_SHUTDOWN_RULE_ID work.
      this.activeCountdownRuleId = fsdCountdownRuleId;
      this.appliedRuleIds.add(fsdCountdownRuleId);
    }

    if (hadCancellableCountdown) {
      this.cancelPendingShutdown();
      this.criticalAlert.dismiss();
    }

    if (this.lastBatteryPercent === null) {
      return;
    }

    this.resetNotificationStateIfRecovered(
      this.lastBatteryPercent,
      config.battery.warningPct,
    );
  }

  private applyDecision(
    decision: ShutdownPolicyDecision,
    context: ShutdownPolicyContext,
  ): void {
    switch (decision.type) {
      case 'none':
        return;
      case 'showWarning':
        this.showPolicyWarning(decision, context);
        return;
      case 'showCriticalAlert':
        this.showPolicyCriticalAlert(decision, context);
        return;
      case 'startShutdownCountdown':
        if (decision.ruleId === DEFAULT_FSD_SHUTDOWN_RULE_ID) {
          this.startFsdCountdown(decision, context);
          return;
        }
        this.startPolicyShutdownCountdown(decision, context);
        return;
      case 'shutdownNow':
        this.applyShutdownNowDecision(decision, context);
        return;
      case 'cancelShutdownCountdown':
        this.cancelPolicyCountdown(decision);
        return;
      default:
        assertNever(decision);
    }
  }

  private resetNotificationStateIfRecovered(
    batteryPercent: number,
    warningPct: number,
  ): void {
    if (batteryPercent > warningPct + BATTERY_RECOVERY_HYSTERESIS_PCT) {
      this.resetBatteryAlertState();
    }
  }

  private resetBatteryAlertState(): void {
    if (!this.fsdShutdownCommitted) {
      this.cancelPendingShutdown();
      this.criticalAlert.dismiss();
      this.activeCountdownRuleId = null;
    }
  }

  private resetBatterySideEffectsIfSafe(context: ShutdownPolicyContext): void {
    const batteryPercent = context.battery.chargePercent;
    const recovered =
      batteryPercent !== undefined &&
      batteryPercent > this.batteryConfig.warningPct + BATTERY_RECOVERY_HYSTERESIS_PCT;
    const returnedOnline =
      this.lastOnBattery && !context.ups.onBattery && context.ups.online;

    if (!recovered && !returnedOnline) {
      return;
    }

    if (!this.fsdShutdownCommitted && this.activeCountdownRuleId === null) {
      this.criticalAlert.dismiss();
    }
  }

  private resetAppliedRuleState(context: ShutdownPolicyContext): void {
    for (const ruleId of [...this.appliedRuleIds]) {
      if (ruleId === this.activeCountdownRuleId) {
        continue;
      }

      if (this.fsdShutdownCommitted && ruleId === DEFAULT_FSD_SHUTDOWN_RULE_ID) {
        continue;
      }

      const rule = this.findPolicyRule(ruleId);
      if (!rule) {
        this.appliedRuleIds.delete(ruleId);
        continue;
      }

      const triggerResult = evaluatePolicyCondition(rule.trigger, context);
      const cancelResult = rule.cancelWhen
        ? evaluatePolicyCondition(rule.cancelWhen, context)
        : null;

      if (!triggerResult.matched || cancelResult?.matched) {
        this.appliedRuleIds.delete(ruleId);
      }
    }
  }

  private showPolicyWarning(
    decision: Extract<ShutdownPolicyDecision, { type: 'showWarning' }>,
    context: ShutdownPolicyContext,
  ): void {
    if (this.appliedRuleIds.has(decision.ruleId)) {
      return;
    }

    this.appliedRuleIds.add(decision.ruleId);
    this.recordDecision(decision, context, 'decision');

    const content = this.buildPolicyAlertContent(
      decision,
      context,
      'warning',
    );
    const batteryPercent = this.resolveDisplayBatteryPercent(context);

    this.showNotification(content.title, content.body);

    this.criticalAlert.show({
      type: 'warning',
      title: content.title,
      body: content.body,
      batteryPct: batteryPercent,
      shutdownPct: this.batteryConfig.shutdownPct,
      showShutdown: false,
    });
  }

  private showPolicyCriticalAlert(
    decision: Extract<ShutdownPolicyDecision, { type: 'showCriticalAlert' }>,
    context: ShutdownPolicyContext,
  ): void {
    if (this.appliedRuleIds.has(decision.ruleId)) {
      return;
    }

    this.appliedRuleIds.add(decision.ruleId);
    this.criticalAlert.dismiss();
    this.recordDecision(decision, context, 'decision');

    const content = this.buildPolicyAlertContent(
      decision,
      context,
      'critical',
    );
    const batteryPercent = this.resolveDisplayBatteryPercent(context);
    this.criticalAlert.show({
      type: 'critical',
      title: content.title,
      body: content.body,
      batteryPct: batteryPercent,
      shutdownPct: this.batteryConfig.shutdownPct,
      showShutdown: false,
    });
  }

  private startPolicyShutdownCountdown(
    decision: CountdownDecision,
    context: ShutdownPolicyContext,
  ): void {
    if (this.appliedRuleIds.has(decision.ruleId)) {
      return;
    }

    this.appliedRuleIds.add(decision.ruleId);
    this.activeCountdownRuleId = decision.ruleId;
    this.criticalAlert.dismiss();
    this.recordDecision(decision, context, 'decision');

    const content = this.buildPolicyCountdownContent(decision, context);
    const batteryPercent = this.resolveDisplayBatteryPercent(context);

    this.showNotification(content.notificationTitle, content.notificationBody);

    this.criticalAlert.show(
      {
        type: 'critical',
        title: content.title,
        body: content.body,
        batteryPct: batteryPercent,
        shutdownPct: this.batteryConfig.shutdownPct,
        showShutdown: true,
        shutdownCountdownSeconds: decision.countdownSeconds,
      },
      () => this.executeShutdown(decision.method, context, decision),
    );
  }

  private applyShutdownNowDecision(
    decision: Extract<ShutdownPolicyDecision, { type: 'shutdownNow' }>,
    context: ShutdownPolicyContext,
  ): void {
    if (this.appliedRuleIds.has(decision.ruleId)) {
      return;
    }

    if (decision.ruleId === DEFAULT_FSD_SHUTDOWN_RULE_ID) {
      this.fsdActive = true;
      this.fsdShutdownCommitted = true;
    }

    this.appliedRuleIds.add(decision.ruleId);
    this.criticalAlert.dismiss();
    this.recordDecision(decision, context, 'decision');
    this.executeShutdown(decision.method, context, decision);
  }

  private startFsdCountdown(
    decision: CountdownDecision,
    context: ShutdownPolicyContext,
  ): void {
    if (this.fsdActive) {
      return;
    }

    this.fsdActive = true;
    this.fsdShutdownCommitted = true;
    this.activeCountdownRuleId = decision.ruleId;
    this.appliedRuleIds.add(decision.ruleId);
    this.criticalAlert.dismiss();
    this.recordDecision(decision, context, 'decision');

    this.criticalAlert.show(
      {
        type: 'critical',
        title: t('batterySafety.fsdAlertTitle'),
        body: t('batterySafety.fsdAlertBody'),
        batteryPct: this.resolveDisplayBatteryPercent(context),
        shutdownPct: this.batteryConfig.shutdownPct,
        showShutdown: true,
        shutdownCountdownSeconds: decision.countdownSeconds,
      },
      () => this.executeShutdown(decision.method, context, decision),
      () => this.handleFsdUserDismissed(),
    );
  }

  private cancelPolicyCountdown(
    decision: Extract<ShutdownPolicyDecision, { type: 'cancelShutdownCountdown' }>,
  ): void {
    // SAFETY INVARIANT: FSD shutdowns are non-cancellable through the policy engine.
    // Previously this guard checked `ruleId === DEFAULT_FSD_SHUTDOWN_RULE_ID`, which
    // let a user-authored rule whose `action.type === 'cancelShutdownCountdown'`
    // (with any ruleId) call `cancelPendingShutdown()` — silently aborting the queued
    // OS-level FSD shutdown while the overlay still ticked down. Violates §8.3 of
    // shutdown_policy_implementation_plan.md and Definition-of-Done #5.
    // Fix: any committed FSD shutdown is sticky, regardless of the cancelling rule.
    if (this.fsdShutdownCommitted) {
      return;
    }

    const { ruleId } = decision;
    const context = this.latestContext;
    if (context) {
      this.recordDecision(decision, context, 'cancellation');
    }

    this.activeCountdownRuleId = null;
    this.appliedRuleIds.delete(ruleId);
    this.cancelPendingShutdown(context, decision);
    this.criticalAlert.dismiss();
  }

  private resolveDisplayBatteryPercent(context: ShutdownPolicyContext): number {
    return context.battery.chargePercent
      ?? this.lastBatteryPercent
      ?? this.batteryConfig.shutdownPct;
  }

  private buildPolicyAlertContent(
    decision: Extract<
      ShutdownPolicyDecision,
      { type: 'showWarning' } | { type: 'showCriticalAlert' }
    >,
    context: ShutdownPolicyContext,
    level: 'warning' | 'critical',
  ): { title: string; body: string } {
    const rule = this.findPolicyRule(decision.ruleId);
    const batteryPercent = this.resolveDisplayBatteryPercent(context);

    if (decision.ruleId === DEFAULT_BATTERY_WARNING_RULE_ID) {
      return {
        title: t('batterySafety.warningAlertTitle'),
        body: t('batterySafety.warningAlertBody', {
          percent: batteryPercent,
          threshold: this.batteryConfig.warningPct,
        }),
      };
    }

    if (decision.ruleId === DEFAULT_BATTERY_SHUTDOWN_RULE_ID) {
      return {
        title: t('batterySafety.criticalAlertTitle'),
        body: t('batterySafety.criticalAlertBody', {
          percent: batteryPercent,
          threshold: this.batteryConfig.shutdownPct,
        }),
      };
    }

    const titleKey = level === 'warning'
      ? 'batterySafety.policyWarningTitle'
      : 'batterySafety.policyCriticalAlertTitle';
    const bodyKey = level === 'warning'
      ? 'batterySafety.policyWarningBody'
      : 'batterySafety.policyCriticalAlertBody';
    const ruleName = rule?.name ?? decision.ruleId;

    return {
      title: t(titleKey, {
        defaultValue: level === 'warning'
          ? 'UPS policy warning'
          : 'UPS policy alert',
      }),
      body: decision.message ?? t(bodyKey, {
        defaultValue: 'Policy rule "{{rule}}" matched.',
        rule: ruleName,
      }),
    };
  }

  private buildPolicyCountdownContent(
    decision: CountdownDecision,
    context: ShutdownPolicyContext,
  ): {
    title: string;
    body: string;
    notificationTitle: string;
    notificationBody: string;
  } {
    const rule = this.findPolicyRule(decision.ruleId);
    const batteryPercent = this.resolveDisplayBatteryPercent(context);

    if (decision.ruleId === DEFAULT_BATTERY_SHUTDOWN_RULE_ID) {
      return {
        title: t('batterySafety.criticalAlertTitle'),
        body: t('batterySafety.criticalAlertBody', {
          percent: batteryPercent,
          threshold: this.batteryConfig.shutdownPct,
        }),
        notificationTitle: t('batterySafety.shutdownToastTitle'),
        notificationBody: t('batterySafety.shutdownToastBody', {
          percent: batteryPercent,
          threshold: this.batteryConfig.shutdownPct,
        }),
      };
    }

    const ruleName = rule?.name ?? decision.ruleId;
    return {
      title: t('batterySafety.policyShutdownCountdownTitle', {
        defaultValue: 'UPS shutdown countdown',
      }),
      body: t('batterySafety.policyShutdownCountdownBody', {
        defaultValue:
          'Policy rule "{{rule}}" started a {{seconds}} second {{method}} countdown.',
        rule: ruleName,
        seconds: decision.countdownSeconds,
        method: decision.method,
      }),
      notificationTitle: t('batterySafety.policyShutdownCountdownToastTitle', {
        defaultValue: 'UPS shutdown countdown started',
      }),
      notificationBody: t('batterySafety.policyShutdownCountdownToastBody', {
        defaultValue:
          'Policy rule "{{rule}}" started a {{seconds}} second {{method}} countdown.',
        rule: ruleName,
        seconds: decision.countdownSeconds,
        method: decision.method,
      }),
    };
  }

  private handleFsdUserDismissed(): void {
    this.fsdActive = false;
    this.fsdShutdownCommitted = false;
    this.activeCountdownRuleId = null;
    this.appliedRuleIds.delete(DEFAULT_FSD_SHUTDOWN_RULE_ID);
    this.policyEngine.reset();
    this.cancelPendingShutdown();
  }

  private showNotification(title: string, body: string): void {
    if (!Notification.isSupported()) {
      console.warn(
        '[BatterySafetyService] Notification API is not supported on this platform.',
      );
      return;
    }

    const notification = new Notification({
      title,
      body,
    });
    notification.show();
  }

  private updateCommunicationLossEvaluationTimer(): void {
    if (
      this.latestContext === null ||
      (
        this.connectionState !== 'degraded' &&
        this.connectionState !== 'reconnecting'
      )
    ) {
      this.stopCommunicationLossEvaluationTimer();
      return;
    }

    if (this.communicationLossEvaluationTimer !== null) {
      return;
    }

    this.communicationLossEvaluationTimer = setInterval(() => {
      this.evaluateConnectionLossPolicyTick();
    }, CONNECTION_LOSS_EVALUATION_INTERVAL_MS);

    const timer = this.communicationLossEvaluationTimer as ReturnType<
      typeof setInterval
    > & { unref?: () => void };
    timer.unref?.();
  }

  private stopCommunicationLossEvaluationTimer(): void {
    if (this.communicationLossEvaluationTimer === null) {
      return;
    }

    clearInterval(this.communicationLossEvaluationTimer);
    this.communicationLossEvaluationTimer = null;
  }

  private evaluateConnectionLossPolicyTick(): void {
    const context = this.policyContextBuilder.build({
      connectionState: this.connectionState,
      pollSucceeded: false,
      activeCountdownRuleId: this.activeCountdownRuleId ?? undefined,
    });
    this.latestContext = context;

    this.resetAppliedRuleState(context);
    this.resetBatterySideEffectsIfSafe(context);
    const decision = this.policyEngine.evaluate(context);
    this.applyDecision(decision, context);
    this.lastOnBattery = context.ups.onBattery;
  }

  private recordDecision(
    decision: Exclude<ShutdownPolicyDecision, { type: 'none' }>,
    context: ShutdownPolicyContext,
    event: ShutdownPolicyDecisionLogEntry['event'],
  ): void {
    const rule = this.findPolicyRule(decision.ruleId);
    this.pushDecisionLogEntry({
      id: this.createDecisionLogId(),
      timestampIso: new Date(context.now).toISOString(),
      event,
      decision,
      ruleId: decision.ruleId,
      ruleName: rule?.name,
      summary: explainDecision(decision, rule),
      conditionExplanation: this.buildConditionExplanation(
        decision,
        context,
        rule,
      ),
      context: this.summarizeContext(context),
    });
  }

  private recordExecutionResult(
    decision: ShutdownPolicyDecision,
    context: ShutdownPolicyContext,
    result: ShutdownExecutionResult,
  ): void {
    const ruleId = getDecisionRuleId(decision);
    const rule = ruleId ? this.findPolicyRule(ruleId) : undefined;

    this.pushDecisionLogEntry({
      id: this.createDecisionLogId(),
      timestampIso: new Date().toISOString(),
      event: result.success ? 'execution' : 'failure',
      decision,
      ruleId,
      ruleName: rule?.name,
      summary: formatExecutionSummary(result),
      context: this.summarizeContext(context),
      execution: {
        method: result.method,
        platform: result.platform,
        supported: result.supported,
        success: result.success,
        command: result.command,
        message: result.message,
        errorMessage: result.errorMessage,
      },
    });
  }

  private releaseFailedShutdownDecision(decision: ShutdownPolicyDecision): void {
    const ruleId = getDecisionRuleId(decision);
    if (!ruleId) {
      return;
    }

    this.appliedRuleIds.delete(ruleId);
    if (this.activeCountdownRuleId === ruleId) {
      this.activeCountdownRuleId = null;
    }
    if (ruleId === DEFAULT_FSD_SHUTDOWN_RULE_ID) {
      this.fsdActive = false;
      this.fsdShutdownCommitted = false;
    }
    this.policyEngine.releaseFailedDecision(ruleId);
  }

  private handleShutdownExecutionResult(
    decision: ShutdownPolicyDecision,
    context: ShutdownPolicyContext,
    result: ShutdownExecutionResult,
  ): void {
    this.recordExecutionResult(decision, context, result);

    if (result.success) {
      return;
    }

    this.releaseFailedShutdownDecision(decision);
    console.error(
      '[BatterySafetyService] Failed to execute shutdown action.',
      result.errorMessage ?? result.message,
    );
    this.showShutdownExecutionFailure(result);
  }

  private buildConditionExplanation(
    decision: ShutdownPolicyDecision,
    context: ShutdownPolicyContext,
    rule: ShutdownPolicyConfig['rules'][number] | undefined,
  ): string[] | undefined {
    if (!rule) {
      return undefined;
    }

    const condition =
      decision.type === 'cancelShutdownCountdown' && rule.cancelWhen
        ? rule.cancelWhen
        : rule.trigger;
    return flattenConditionExplanation(
      evaluatePolicyCondition(condition, context),
    );
  }

  private summarizeContext(
    context: ShutdownPolicyContext,
  ): ShutdownPolicyDecisionLogEntry['context'] {
    return {
      statusTokens: [...context.ups.statusTokens],
      batteryChargePercent: context.battery.chargePercent,
      runtimeSeconds: context.battery.runtimeSeconds,
      connectionState: context.connection.state,
      secondsSinceLastSuccessfulPoll:
        Math.floor(context.connection.secondsSinceLastSuccessfulPoll),
      secondsOnBattery: Math.floor(context.state.secondsOnBattery),
      activeCountdownRuleId: context.state.activeCountdownRuleId,
    };
  }

  private pushDecisionLogEntry(entry: ShutdownPolicyDecisionLogEntry): void {
    this.decisionLog.unshift(entry);
    if (this.decisionLog.length > MAX_DECISION_LOG_ENTRIES) {
      this.decisionLog.length = MAX_DECISION_LOG_ENTRIES;
    }
  }

  private createDecisionLogId(): string {
    this.decisionLogCounter += 1;
    return `shutdown-policy-${Date.now()}-${this.decisionLogCounter}`;
  }

  private findPolicyRule(ruleId: string): ShutdownPolicyRule | undefined {
    return this.policyConfig.rules.find((item) => item.id === ruleId);
  }

  private executeShutdown(
    method: 'sleep' | 'shutdown',
    context: ShutdownPolicyContext,
    decision: ShutdownPolicyDecision,
  ): void {
    void this.shutdownExecutor.execute(method)
      .then((result) => {
        this.handleShutdownExecutionResult(decision, context, result);
      })
      .catch((error: unknown) => {
        this.handleShutdownExecutionResult(
          decision,
          context,
          createUnexpectedShutdownExecutionResult(method, error),
        );
      });
  }

  private cancelPendingShutdown(
    context: ShutdownPolicyContext | null = this.latestContext,
    decision?: ShutdownPolicyDecision,
  ): void {
    void this.shutdownExecutor.cancelPending().then((result) => {
      if (context && decision && (result.command || !result.success)) {
        this.recordExecutionResult(decision, context, result);
      }

      if (!result.success) {
        console.warn(
          '[BatterySafetyService] Failed to cancel pending shutdown action.',
          result.errorMessage ?? result.message,
        );
        this.showShutdownExecutionFailure(result);
      }
    });
  }

  private showShutdownExecutionFailure(result: ShutdownExecutionResult): void {
    const reason = result.errorMessage ?? result.message ?? 'Unknown error';
    const title = t('batterySafety.shutdownCommandFailedTitle', {
      defaultValue: 'Shutdown action failed',
    });
    const body = t('batterySafety.shutdownCommandFailedBody', {
      defaultValue: 'The configured shutdown action could not be completed: {{reason}}',
      reason,
    });

    this.showNotification(
      title,
      body,
    );
    this.criticalAlert.dismiss();
    this.criticalAlert.show({
      type: 'critical',
      title,
      body,
      batteryPct: this.lastBatteryPercent ?? this.batteryConfig.shutdownPct,
      shutdownPct: this.batteryConfig.shutdownPct,
      showShutdown: false,
    });
  }
}

function getDecisionRuleId(decision: ShutdownPolicyDecision): string | undefined {
  return decision.type === 'none' ? undefined : decision.ruleId;
}

function createUnexpectedShutdownExecutionResult(
  method: 'sleep' | 'shutdown',
  error: unknown,
): ShutdownExecutionResult {
  return {
    method,
    platform: process.platform,
    supported: true,
    success: false,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function formatExecutionSummary(result: ShutdownExecutionResult): string {
  if (!result.supported) {
    return result.message ?? `Shutdown is not supported on ${result.platform}.`;
  }

  if (result.success) {
    return result.command
      ? `Executed shutdown command: ${result.command}`
      : result.message ?? 'Shutdown command completed.';
  }

  return result.errorMessage
    ? `Shutdown command failed: ${result.errorMessage}`
    : result.message ?? 'Shutdown command failed.';
}

/**
 * @deprecated Runtime policy parsing lives in ShutdownPolicyContextBuilder.
 * This export remains for compatibility with older regression tests.
 */
export function containsFsdToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'FSD');
}

/**
 * @deprecated Runtime policy parsing lives in ShutdownPolicyContextBuilder.
 * This export remains for compatibility with older regression tests.
 */
export function containsObToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'OB');
}

/**
 * @deprecated Runtime policy parsing lives in ShutdownPolicyContextBuilder.
 * This export remains for compatibility with older regression tests.
 */
export function containsLbToken(rawUpsStatus: string | undefined | null): boolean {
  if (!rawUpsStatus) {
    return false;
  }

  return rawUpsStatus
    .split(/\s+/u)
    .some((token) => token.toUpperCase() === 'LB');
}

function resolvePolicyConfig(config: AppConfig): ShutdownPolicyConfig {
  const maybeConfig = config as Partial<AppConfig>;
  return maybeConfig.shutdownPolicy
    ? maybeConfig.shutdownPolicy as ShutdownPolicyConfig
    : migrateLegacyShutdownPolicyConfig({
      battery: config.battery,
      fsd: config.fsd,
    });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled shutdown policy decision: ${JSON.stringify(value)}`);
}
