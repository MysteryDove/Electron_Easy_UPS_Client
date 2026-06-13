/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateSelector } from './TemplateSelector';

const mockUpdate = vi.fn<(payload: unknown) => Promise<void>>();
const mockRefreshConfig = vi.fn<() => Promise<void>>();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

vi.mock('../../app/electronApi', () => ({
  electronApi: {
    settings: {
      update: (payload: unknown) => mockUpdate(payload),
    },
  },
}));

vi.mock('../../app/providers', () => ({
  useAppConfig: () => ({
    refreshConfig: () => mockRefreshConfig(),
  }),
}));

vi.mock('./registry', () => ({
  templateRegistry: {
    getAll: () => [
      {
        metadata: {
          id: 'default',
          name: 'dashboard.templateDefault',
          description: 'dashboard.templateDefaultDesc',
        },
        Component: (): null => null,
      },
      {
        metadata: {
          id: 'power-quality',
          name: 'dashboard.templatePowerQuality',
          description: 'dashboard.templatePowerQualityDesc',
        },
        Component: (): null => null,
      },
    ],
  },
}));

describe('TemplateSelector', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockUpdate.mockReset();
    mockRefreshConfig.mockReset().mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('keeps the controlled selection when persisting the next template fails', async () => {
    const updateError = new Error('save failed');
    mockUpdate.mockRejectedValue(updateError);

    render(<TemplateSelector activeTemplateId="default" />);

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('default');

    fireEvent.change(select, { target: { value: 'power-quality' } });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        selectedDashboardTemplate: 'power-quality',
      });
    });

    await waitFor(() => {
      expect(select).toHaveValue('default');
    });

    expect(mockRefreshConfig).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to update dashboard template selection',
      updateError,
    );
  });
});