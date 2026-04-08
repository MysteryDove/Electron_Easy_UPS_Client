/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type {
  ConnectionState,
  LocalDriverLaunchIssue,
} from '../../shared/ipc/contracts';
import { ReconnectOverlay } from './ReconnectOverlay';

const mockNavigate = vi.fn();
const mockWizardEnter = vi.fn();
const mockRetryLocalDriverLaunch = vi.fn();
const mockListComPorts = vi.fn();

let mockConnectionState: {
  state: ConnectionState;
  staticData: Record<string, string> | null;
  dynamicData: Record<string, string> | null;
  lastTelemetry: { ts: string; values: Record<string, number | null> } | null;
  localDriverLaunchIssue: LocalDriverLaunchIssue | null;
};

let mockAppConfig: {
  config: {
    wizard: { completed: boolean };
    nut: { launchLocalComponents: boolean };
  } | null;
};

vi.mock('@headlessui/react', async () => {
  const actual = await vi.importActual<typeof import('@headlessui/react')>('@headlessui/react');
  return {
    ...actual,
  Transition: ({
    show,
    children,
  }: {
    show?: boolean;
    children: ReactNode;
  }) => (show ? <>{children}</> : null),
  };
});

vi.mock('./ui', () => ({
  UiButton: ({
    children,
    ...props
  }: { children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  UiDialog: ({
    children,
    open,
    onClose: _onClose,
    ...props
  }: {
    children: ReactNode;
    open?: boolean;
    onClose?: () => void;
  } & HTMLAttributes<HTMLDivElement>) => (
    open ? <div {...props}>{children}</div> : null
  ),
  UiDialogPanel: ({
    children,
    ...props
  }: { children?: ReactNode } & HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  UiDialogTitle: ({
    children,
    ...props
  }: { children?: ReactNode } & HTMLAttributes<HTMLHeadingElement>) => <h3 {...props}>{children}</h3>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultValueOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const defaultValue = typeof defaultValueOrOptions === 'string'
        ? defaultValueOrOptions
        : key;
      const values = typeof defaultValueOrOptions === 'string'
        ? maybeOptions
        : defaultValueOrOptions;

      if (!values) {
        return defaultValue;
      }

      return Object.entries(values).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        defaultValue,
      );
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../app/providers', () => ({
  useConnection: () => mockConnectionState,
  useAppConfig: () => mockAppConfig,
}));

vi.mock('../app/electronApi', () => ({
  electronApi: {
    wizard: {
      enter: () => mockWizardEnter(),
    },
    nut: {
      retryLocalDriverLaunch: () => mockRetryLocalDriverLaunch(),
    },
    nutSetup: {
      listComPorts: () => mockListComPorts(),
    },
  },
}));

describe('ReconnectOverlay', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockWizardEnter.mockReset();
    mockRetryLocalDriverLaunch.mockReset();
    mockListComPorts.mockReset();

    mockConnectionState = {
      state: 'connecting',
      staticData: null,
      dynamicData: null,
      lastTelemetry: null,
      localDriverLaunchIssue: null,
    };
    mockAppConfig = {
      config: {
        wizard: { completed: true },
        nut: { launchLocalComponents: false },
      },
    };

    mockRetryLocalDriverLaunch.mockResolvedValue({ success: true });
    mockListComPorts.mockResolvedValue({ ports: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a generic reconfigure action on normal connection loss and enters the wizard', async () => {
    mockWizardEnter.mockResolvedValue(undefined);

    renderOverlay();

    expect(
      screen.getByText(
        'Launch the setup wizard to reconfigure the NUT server address, port, and authentication details.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Reconfigure connection...' }),
    );

    await waitFor(() => {
      expect(mockWizardEnter).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/wizard');
    });
  });

  it('shows an inline error and re-enables the generic reconfigure button when wizard entry fails', async () => {
    mockWizardEnter.mockRejectedValue(new Error('Failed to stop runtime services'));

    renderOverlay();

    fireEvent.click(
      screen.getByRole('button', { name: 'Reconfigure connection...' }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent('Failed to stop runtime services');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Reconfigure connection...' }),
    ).toBeEnabled();
  });

  it('keeps the existing driver issue dialog reconfigure action without rendering the generic one', () => {
    mockConnectionState = {
      ...mockConnectionState,
      localDriverLaunchIssue: createLocalDriverLaunchIssue(),
    };
    mockAppConfig = {
      config: {
        wizard: { completed: true },
        nut: { launchLocalComponents: true },
      },
    };

    renderOverlay();

    expect(
      screen.getByRole('button', { name: 'Re-configure' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reconfigure connection...' }),
    ).not.toBeInTheDocument();
  });
});

function renderOverlay() {
  return render(
    <MemoryRouter>
      <ReconnectOverlay />
    </MemoryRouter>,
  );
}

function createLocalDriverLaunchIssue(): LocalDriverLaunchIssue {
  return {
    code: 'SERIAL_COM_OPEN_FAILED',
    summary: 'Driver failed to open COM3',
    occurredAt: '2026-04-08T00:00:00.000Z',
    signature: 'serial-open-com3',
    driverExecutable: 'blazer_ser',
    port: 'COM3',
    stderr: 'The port is unavailable',
  };
}
