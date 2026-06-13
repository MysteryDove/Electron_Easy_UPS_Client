import { useEffect, useRef } from 'react';

type InlineErrorMessageProps = {
  message: string;
  onDismiss: () => void;
};

export function InlineErrorMessage({
  message,
  onDismiss
}: InlineErrorMessageProps) {
  // Ref pattern avoids stale closure
  const onDismissRef = useRef(onDismiss);

  // Keep ref current
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Timer uses ref, safe with empty deps
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismissRef.current();
    }, 5000);

    return () => {
      clearTimeout(timer);
    };
  }, []); // Empty deps: timer set once, ref ensures latest callback

  return (
    <div className="inline-error-message" role="alert">
      <span className="inline-error-message__text">{message}</span>
      <button
        type="button"
        className="inline-error-message__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
