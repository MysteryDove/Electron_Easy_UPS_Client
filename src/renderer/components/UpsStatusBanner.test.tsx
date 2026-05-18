/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpsStatusBanner } from './UpsStatusBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
});

describe('UpsStatusBanner — rendering', () => {
  it('exposes role=status', () => {
    render(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the primary i18n key for online', () => {
    render(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('data-primary', 'online');
    expect(screen.getByText('dashboard.statusOnline')).toBeInTheDocument();
  });

  it('renders the primary i18n key for batteryLow', () => {
    render(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByText('dashboard.statusBatteryLow')).toBeInTheDocument();
  });

  it('renders the primary i18n key for driverIssue', () => {
    render(
      <UpsStatusBanner
        primary="driverIssue"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByText('dashboard.statusDriverIssue')).toBeInTheDocument();
  });

  it('applies the severity class', () => {
    const { rerender } = render(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status').className).toContain('ups-status-badge--ok');

    rerender(
      <UpsStatusBanner
        primary="onBattery"
        modifiers={[]}
        severity="warn"
      />,
    );
    expect(screen.getByRole('status').className).toContain(
      'ups-status-badge--warn',
    );
  });

  it('renders each modifier chip with its i18n key', () => {
    render(
      <UpsStatusBanner
        primary="online"
        modifiers={['charging', 'replaceBattery', 'stale']}
        severity="warn"
      />,
    );
    expect(screen.getByText('dashboard.modifierCharging')).toBeInTheDocument();
    expect(
      screen.getByText('dashboard.modifierReplaceBattery'),
    ).toBeInTheDocument();
    expect(screen.getByText('dashboard.modifierStale')).toBeInTheDocument();
  });

  it('exposes the raw token string as the banner tooltip', () => {
    render(
      <UpsStatusBanner
        primary="online"
        modifiers={[]}
        severity="ok"
        rawTokens={['OL', 'CHRG']}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('title', 'OL CHRG');
  });

  it('uses alarmText as the tooltip on the alarm modifier chip', () => {
    render(
      <UpsStatusBanner
        primary="online"
        modifiers={['alarm']}
        severity="warn"
        alarmText="Replace battery soon"
      />,
    );
    const chip = screen.getByText('dashboard.modifierAlarm').closest('span[data-modifier]');
    expect(chip).toHaveAttribute('title', 'Replace battery soon');
  });
});

describe('UpsStatusBanner — accessibility transitions', () => {
  it('starts polite when severity begins non-critical', () => {
    render(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('emits assertive on the render that transitions into critical, then polite on the next render while still critical', () => {
    const { rerender } = render(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');

    rerender(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-live',
      'assertive',
    );

    rerender(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('returns to assertive when severity exits critical and re-enters', () => {
    const { rerender } = render(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    rerender(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    rerender(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-live',
      'assertive',
    );
  });
});

describe('UpsStatusBanner — critical pulse class', () => {
  it('adds the pulse class while severity === critical', () => {
    render(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status').className).toContain(
      'ups-status-badge--pulse',
    );
  });

  it('drops the pulse class when severity leaves critical', () => {
    const { rerender } = render(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status').className).toContain(
      'ups-status-badge--pulse',
    );
    rerender(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    expect(screen.getByRole('status').className).not.toContain(
      'ups-status-badge--pulse',
    );
  });

  it('re-applies the pulse class when severity re-enters critical', () => {
    const { rerender } = render(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    rerender(
      <UpsStatusBanner primary="online" modifiers={[]} severity="ok" />,
    );
    rerender(
      <UpsStatusBanner
        primary="batteryLow"
        modifiers={[]}
        severity="critical"
      />,
    );
    expect(screen.getByRole('status').className).toContain(
      'ups-status-badge--pulse',
    );
  });

  it('does not apply the pulse class for non-critical severities', () => {
    render(
      <UpsStatusBanner
        primary="onBattery"
        modifiers={[]}
        severity="warn"
      />,
    );
    expect(screen.getByRole('status').className).not.toContain(
      'ups-status-badge--pulse',
    );
  });
});
