import type {
  PolicyCondition,
  ShutdownPolicySeverity,
} from '../../shared/shutdownPolicy/types';

export type ShutdownPolicyRuleRuntimeState = {
  firstMatchedAt?: number;
  cooldownUntil?: number;
  lastDecisionAt?: number;
};

export type ActiveShutdownCountdown = {
  ruleId: string;
  cancelWhen?: PolicyCondition | null;
  priority: number;
  severity: ShutdownPolicySeverity;
  order: number;
};

export class ShutdownPolicyRuntimeState {
  private readonly ruleStates = new Map<string, ShutdownPolicyRuleRuntimeState>();
  private activeCountdown: ActiveShutdownCountdown | null = null;

  public reset(): void {
    this.ruleStates.clear();
    this.activeCountdown = null;
  }

  public markRuleMatched(ruleId: string, now: number): number {
    const state = this.getRuleState(ruleId);
    if (state.firstMatchedAt === undefined) {
      state.firstMatchedAt = now;
    }
    return secondsBetween(state.firstMatchedAt, now);
  }

  public markRuleUnmatched(ruleId: string): void {
    const state = this.ruleStates.get(ruleId);
    if (!state) {
      return;
    }
    state.firstMatchedAt = undefined;
  }

  public isRuleCoolingDown(ruleId: string, now: number): boolean {
    const cooldownUntil = this.ruleStates.get(ruleId)?.cooldownUntil;
    return cooldownUntil !== undefined && now < cooldownUntil;
  }

  public markRuleDecision(
    ruleId: string,
    now: number,
    cooldownSeconds: number | undefined,
  ): void {
    const state = this.getRuleState(ruleId);
    state.lastDecisionAt = now;
    state.cooldownUntil =
      cooldownSeconds && cooldownSeconds > 0
        ? now + cooldownSeconds * 1000
        : undefined;
  }

  public getActiveCountdown(): ActiveShutdownCountdown | null {
    return this.activeCountdown;
  }

  public setActiveCountdown(countdown: ActiveShutdownCountdown): void {
    this.activeCountdown = countdown;
  }

  public clearActiveCountdown(ruleId?: string): void {
    if (ruleId !== undefined && this.activeCountdown?.ruleId !== ruleId) {
      return;
    }

    this.activeCountdown = null;
  }

  public clearRuleDecision(ruleId: string): void {
    const state = this.ruleStates.get(ruleId);
    if (!state) {
      return;
    }

    state.lastDecisionAt = undefined;
    state.cooldownUntil = undefined;
  }

  private getRuleState(ruleId: string): ShutdownPolicyRuleRuntimeState {
    const existing = this.ruleStates.get(ruleId);
    if (existing) {
      return existing;
    }

    const created: ShutdownPolicyRuleRuntimeState = {};
    this.ruleStates.set(ruleId, created);
    return created;
  }
}

function secondsBetween(previous: number, next: number): number {
  return Math.max(0, (next - previous) / 1000);
}
