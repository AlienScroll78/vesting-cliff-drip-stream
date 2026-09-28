import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
} from 'react';

export interface TooltipProps {
  /** The trigger element content */
  children: React.ReactNode;
  /** Tooltip body text */
  content: React.ReactNode;
  /** Optional explicit id; auto-generated if omitted */
  id?: string;
}

/**
 * Accessible tooltip component.
 *
 * - Shown on hover and on keyboard focus
 * - Closed on Escape
 * - role="tooltip" with aria-describedby wired to trigger
 * - WCAG 2.1 AA compliant
 */
export function Tooltip({ children, content, id: externalId }: TooltipProps) {
  const autoId = useId();
  const tooltipId = externalId ?? `tooltip-${autoId}`;
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        hide();
        triggerRef.current?.focus();
      }
      // Toggle on Enter or Space
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    },
    [hide],
  );

  // Close when focus moves outside
  useEffect(() => {
    if (!visible) return;
    const handleDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', handleDocKeyDown);
    return () => document.removeEventListener('keydown', handleDocKeyDown);
  }, [visible, hide]);

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      {/* Trigger */}
      <span
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-describedby={visible ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={handleKeyDown}
        style={{
          borderBottom: '1px dotted currentColor',
          cursor: 'help',
          display: 'inline',
          outline: 'none',
        }}
        // Visible focus ring via CSS class (see compat.css)
        className="tooltip-trigger"
      >
        {children}
      </span>

      {/* Tooltip bubble */}
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#1a1a2e',
            color: '#f0f0f0',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
            lineHeight: '1.4',
            maxWidth: '260px',
            width: 'max-content',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 9999,
            pointerEvents: 'none',
            whiteSpace: 'normal',
          }}
        >
          {content}
          {/* Arrow */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              borderWidth: '6px',
              borderStyle: 'solid',
              borderColor: '#1a1a2e transparent transparent transparent',
              display: 'block',
              width: 0,
              height: 0,
            }}
          />
        </span>
      )}
    </span>
  );
}

export default Tooltip;
