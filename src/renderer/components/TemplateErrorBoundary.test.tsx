/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplateErrorBoundary } from './TemplateErrorBoundary';

function ThrowingChild() {
  throw new Error('template exploded');
}

describe('TemplateErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('renders fallback details with a defined background token', () => {
    render(
      <TemplateErrorBoundary>
        <ThrowingChild />
      </TemplateErrorBoundary>,
    );

    expect(screen.getByText('Template failed to render')).toBeInTheDocument();
    const errorDetails = screen.getByText('template exploded');
    expect(errorDetails.closest('pre')).toHaveStyle('background: var(--color-bg-card)');
  });
});