# Shutdown Policy Release Checklist

Use this checklist before shipping a release that includes shutdown policy
changes.

## Automated Validation

- `npx.cmd tsc --noEmit` passes.
- `npm.cmd run lint` passes.
- `npm.cmd test` passes.
- Policy schema tests cover invalid fields, operators, countdown limits, unsafe
  shutdown triggers, immediate shutdown gating, and FSD cancellation safety.
- Policy engine tests cover hold duration, cooldown, priority resolution,
  countdown cancellation, FSD priority, and communication-loss fail-safe rules.
- Migration tests cover configs with no `shutdownPolicy`, disabled legacy
  shutdown settings, FSD migration, and preserving existing advanced policies.
- Renderer tests cover simple mode, advanced mode, simulator explanation, and
  invalid policy rejection when renderer tests are added for this feature.

## Manual QA

- UPS online with low battery shows no shutdown countdown by default.
- UPS on battery with low battery starts the configured battery countdown.
- Power restoration cancels the normal battery countdown.
- `OL FSD` starts and preserves the FSD countdown, including after a settings save.
- Dismissing the FSD overlay follows the explicit FSD dismiss behavior.
- Runtime remaining template triggers only while on battery.
- Communication loss while online does not shut down by default.
- Communication loss after previously-on-battery state triggers only when the
  fail-safe rule is enabled.
- Advanced mode rejects `cancelShutdownCountdown` rules unless Allow FSD
  auto-cancel is enabled.
- Upgrading from a pre-policy build applies the documented immediate-shutdown
  disclosure and the Allow immediate shutdown setting matches the migrated
  legacy behavior.
- The simulator explains both matched and unmatched rules.
- Decision history records warning, countdown, cancellation, execution, and
  failure entries.

## Platform Checks

- Windows shutdown command path is verified in a controlled test environment.
- Windows sleep command path is verified in a controlled test environment.
- Non-Windows platforms show an explicit unsupported shutdown result.
- Shutdown command failures show a user-visible notification when notifications
  are supported.

## Security Review

- Policy config remains data-only.
- No arbitrary JavaScript execution is introduced.
- No user-provided shell commands are accepted.
- IPC channels use shared contracts and do not expose raw privileged operations
  to the renderer.
- Renderer imports only shared policy modules, not Electron main-process modules.

## Packaging

- Packaged Windows app launches normally.
- Existing settings migrate on first launch after update.
- Reset-settings development launch generates safe defaults.
- The installer does not remove legacy battery/FSD fields from existing config.
