/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineErrorMessage } from './InlineErrorMessage';

describe('InlineErrorMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders message with alert role', () => {
    const onDismiss = vi.fn();
    render(<InlineErrorMessage message="Test error" onDismiss={onDismiss} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Test error');
  });

  it('calls onDismiss after 5 seconds', () => {
    const onDismiss = vi.fn();
    render(<InlineErrorMessage message="Test error" onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when dismiss button clicked', () => {
    const onDismiss = vi.fn();
    render(<InlineErrorMessage message="Test error" onDismiss={onDismiss} />);

    const dismissButton = screen.getByLabelText('Dismiss error');
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not reset timer when parent re-renders with new onDismiss', () => {
    const onDismiss1 = vi.fn();
    const onDismiss2 = vi.fn();
    const { rerender } = render(
      <InlineErrorMessage message="Test error" onDismiss={onDismiss1} />,
    );

    vi.advanceTimersByTime(3000); // 3 seconds pass

    // Parent re-renders with new callback
    rerender(<InlineErrorMessage message="Test error" onDismiss={onDismiss2} />);

    // Advance remaining 2 seconds (total 5)
    vi.advanceTimersByTime(2000);

    // Should call the LATEST callback (onDismiss2), not the stale one
    expect(onDismiss1).not.toHaveBeenCalled();
    expect(onDismiss2).toHaveBeenCalledTimes(1);
  });

  it('clears timer on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <InlineErrorMessage message="Test error" onDismiss={onDismiss} />,
    );

    vi.advanceTimersByTime(3000);
    unmount();

    // Advance past 5 seconds total
    vi.advanceTimersByTime(3000);

    // Should NOT call onDismiss because component unmounted
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
