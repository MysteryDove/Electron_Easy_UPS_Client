# Shutdown Policy User Guide

Easy UPS Client uses a data-driven shutdown policy system. A policy is a set
of validated rules that look at normalized UPS state and choose a known action,
such as showing a warning, starting a shutdown countdown, or cancelling an
active countdown.

The policy editor is in Settings under Shutdown Policy.

## Upgrading from Legacy Settings

Existing battery and FSD settings migrate automatically to shutdown policy
rules on first launch after upgrade.

If your old configuration had `battery.shutdownEnabled = true` and
`battery.criticalShutdownAlertEnabled = false`, the migration also enables
Allow immediate shutdown so the upgraded policy keeps the same quiet-shutdown
behavior. You can review or change that in Settings > Shutdown Policy >
Advanced > Safety.

The default hold times were also raised from `0` seconds to short non-zero
values to suppress single-poll glitches: battery warning waits 5 seconds,
battery shutdown waits 10 seconds, FSD waits 3 seconds, the runtime rule
template waits 10 seconds, and the communication-loss fail-safe waits 5
seconds after its `secondsOnBattery >= 60` and poll-loss thresholds are both
met. See the [release notice](SHUTDOWN_POLICY_RELEASE_NOTICE.md) for the full
upgrade table.

## Simple Mode

Simple mode is the recommended mode for most installations. It keeps the same
behavior as the legacy battery and FSD settings:

- Warn only when the UPS is on battery and the battery reaches the warning
  threshold.
- Start a shutdown countdown when the UPS is on battery and reaches the
  shutdown threshold.
- Cancel the normal battery shutdown countdown when utility power returns.
- Keep FSD shutdown separate and high priority.
- Keep communication-loss shutdown disabled unless the user enables it.

Low battery while the UPS is online does not shut the computer down by default.
That state can happen while a UPS is recharging, recovering from discharge, or
reporting a weak battery. The default policy requires `ups.onBattery == true`
before battery threshold shutdown rules can run.

## FSD

FSD means Forced Shutdown. It is reported by NUT in `ups.status` as the `FSD`
token. When enabled, the default FSD rule starts a shutdown countdown as soon as
FSD is seen. The FSD rule has higher priority than ordinary battery rules and is
not cancelled just because the UPS also reports online status.

Saving settings while an FSD countdown is active does not clear that countdown.
The overlay and shutdown state stay active until the configured FSD behavior is
resolved.

## Communication-Loss Fail-Safe

The communication-loss rule is available but disabled by default. When enabled,
it can shut down if NUT communication is lost after the UPS was previously seen
on battery.

Use this only when loss of NUT communication during an outage should be treated
as unsafe. The rule uses normalized connection state and
`connection.secondsSinceLastSuccessfulPoll`, so it is independent of raw NUT
variable names.

The fail-safe also tracks stale telemetry more reliably during an outage. If
polling still reports `connected` but UPS status has stopped updating beyond the
grace window, the previously-on-battery timing continues instead of resetting to
zero.

## Advanced Safety Settings

Advanced mode includes safety toggles that gate the riskiest actions.

- Allow immediate shutdown is off by default unless migration preserved a
  legacy quiet-shutdown setup.
- Rules that use `cancelShutdownCountdown` are rejected unless Allow FSD
  auto-cancel is enabled.
- FSD remains higher priority than ordinary battery rules and is not cancelled
  just because the UPS also reports online status.

## Runtime Remaining Rules

Advanced mode includes a runtime remaining template. It creates a rule like:

```text
UPS is on battery
and battery.runtimeSeconds <= 300
then start shutdown countdown
```

This is useful when runtime estimates are more reliable than charge percentage
for a specific UPS.

## Simulator

The policy simulator in Settings lets you test policy behavior without shutting
down the machine. Set UPS status tokens, battery charge, runtime remaining,
connection state, and duration values. The simulator shows the selected rule
and condition-by-condition pass/fail explanations.

## Decision History

The decision history panel shows runtime policy decisions and audit events:

- rule matched,
- warning or critical alert shown,
- shutdown countdown started,
- countdown cancelled,
- shutdown executor success or failure.

Failures are also surfaced through the normal notification path when
notifications are supported by the host platform.
