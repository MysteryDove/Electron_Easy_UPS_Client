# Shutdown Policy User Guide

Easy UPS Client uses a data-driven shutdown policy system. A policy is a set
of validated rules that look at normalized UPS state and choose a known action,
such as showing a warning, starting a shutdown countdown, or cancelling an
active countdown.

The policy editor is in Settings under Shutdown Policy.

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

## Communication-Loss Fail-Safe

The communication-loss rule is available but disabled by default. When enabled,
it can shut down if NUT communication is lost after the UPS was previously seen
on battery.

Use this only when loss of NUT communication during an outage should be treated
as unsafe. The rule uses normalized connection state and
`connection.secondsSinceLastSuccessfulPoll`, so it is independent of raw NUT
variable names.

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
