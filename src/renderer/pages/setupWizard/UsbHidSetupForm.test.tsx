/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UsbHidSetupForm } from './UsbHidSetupForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string>) => {
      if (!fallback) {
        return _key;
      }
      if (!values) {
        return fallback;
      }
      return Object.entries(values).reduce(
        (accumulator, [name, value]) => accumulator.replace(`{{${name}}}`, value),
        fallback,
      );
    },
  }),
}));

describe('UsbHidSetupForm', () => {
  it('shows missing VID/PID message when specify is enabled and IDs are empty', () => {
    render(
      <UsbHidSetupForm
        upsName="usbups"
        upsNameValid
        port="auto"
        specifyVidPid
        vendorId=""
        productId=""
        vendorIdValid={false}
        productIdValid={false}
        onUpsNameChange={() => {}}
        onSpecifyVidPidChange={() => {}}
        onVendorIdChange={() => {}}
        onProductIdChange={() => {}}
      />,
    );

    expect(
      screen.getByText('Enter both Vendor ID and Product ID, or disable Specify VID/PID'),
    ).toBeInTheDocument();
  });
});
