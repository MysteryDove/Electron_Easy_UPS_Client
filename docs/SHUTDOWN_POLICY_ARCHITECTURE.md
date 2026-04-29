# Shutdown Policy Architecture

The shutdown policy system separates rule evaluation from side effects.
Policy evaluation is synchronous and deterministic; UI alerts and operating
system commands are applied only after a decision has been produced.

## Main Components

`src/shared/shutdownPolicy/types.ts`

Defines the cross-process policy model, condition tree, decision type,
normalized policy context, and decision log entry type.

`src/shared/shutdownPolicy/evaluation.ts`

Pure condition evaluator used by the main process and the renderer simulator.
It supports `all`, `any`, `not`, equality, numeric comparison, array includes,
and existence checks.

`src/shared/shutdownPolicy/simulator.ts`

Renderer-safe simulation helper. It evaluates the current policy against a
synthetic context and returns rule-by-rule condition results plus the selected
decision.

`src/shared/shutdownPolicy/explain.ts`

Formats decisions and condition evaluation results into human-readable lines
for the simulator and runtime decision history.

`src/main/shutdown/ShutdownPolicyContextBuilder.ts`

Converts raw NUT telemetry into normalized policy fields. It parses
`ups.status` tokens, maps battery charge/runtime values, tracks duration fields,
and maps polling connection state to `connected`, `degraded`, or
`disconnected`.

During communication loss, the builder keeps the previously-on-battery duration
advancing when the last known status included `OB`. This lets the optional
communication-loss fail-safe represent "communication lost while previously on
battery" even after fresh status tokens stop arriving.

`src/main/shutdown/ShutdownPolicyEngine.ts`

Evaluates active rules with hold duration, cooldown, active countdown tracking,
and cancellation conditions. It returns only a `ShutdownPolicyDecision`.

`src/main/system/batterySafetyService.ts`

Receives telemetry and connection-state updates, builds policy context,
evaluates the engine, applies the resulting decision, and records decision log
entries. It preserves existing warning, countdown, and FSD behavior while using
policy rules as the decision source.

`src/main/shutdown/ShutdownExecutor.ts`

Owns platform-specific shutdown command execution. Windows shutdown and sleep
commands are supported. Other platforms return an explicit unsupported result
instead of attempting privileged or platform-specific commands.

## IPC Surface

The renderer reads decision history through:

```text
shutdown-policy:get-decision-log
```

The channel is defined in `src/shared/ipc/contracts.ts`, handled in
`src/main/ipc/ipcHandlers.ts`, exposed in `src/preload.ts`, and consumed by the
settings renderer.

## Adding a Policy Field

1. Add the field to `PolicyField` in `src/shared/shutdownPolicy/types.ts`.
2. Add the field to `POLICY_FIELDS` in `src/shared/shutdownPolicy/constants.ts`.
3. Add metadata in `src/shared/shutdownPolicy/fieldMetadata.ts`.
4. Populate the field in `ShutdownPolicyContextBuilder` or another normalized
   context source.
5. Add schema tests for valid operators and values.
6. Add evaluator, engine, and simulator tests if behavior is new.

Do not expose arbitrary raw NUT variables directly. Add normalized fields that
have clear semantics and safe defaults.

## Adding a Policy Action

1. Extend `ShutdownPolicyAction` and `ShutdownPolicyDecision`.
2. Validate the action in `src/main/shutdown/schema/policyActionSchema.ts`.
3. Map rules to decisions in the engine and simulator.
4. Apply the decision in `BatterySafetyService`.
5. Keep side effects in a focused service such as `ShutdownExecutor`.
6. Add tests for validation, engine behavior, and side-effect application.

Do not add user-supplied scripts or shell commands as policy actions.

## Migration Behavior

Legacy battery and FSD settings are still kept in config for compatibility.
When `shutdownPolicy` is absent, `ShutdownPolicyMigration` generates equivalent
simple-mode rules from existing settings. Existing advanced policy configs are
preserved and not overwritten by legacy fields.
