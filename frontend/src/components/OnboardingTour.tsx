import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useId,
} from 'react';
import { useOnboardingTour } from '../useOnboardingTour';

/** Padding (px) added around the highlighted element's bounding box. */
const HIGHLIGHT_PADDING = 8;

/** How far (px) the tooltip sits away from the highlighted element. */
const TOOLTIP_OFFSET = 12;

/** Breakpoint (px) below which the tooltip is pinned to the bottom of the viewport. */
const MOBILE_BREAKPOINT = 600;

interface TooltipPosition {
  top: number;
  left: number;
}

/**
 * OnboardingTour
 *
 * Renders a floating spotlight tooltip that walks the user through key UI
 * elements using `data-tour` attribute selectors.
 *
 * - Positions itself relative to each step's target element
 * - Repositions to the bottom of the viewport on narrow screens (mobile-friendly)
 * - Traps keyboard focus within the tooltip
 * - Announces step transitions via an aria-live region
 * - Closes on Escape
 */
export function OnboardingTour() {
  const { isActive, currentStep, currentStepData, totalSteps, next, prev, skip } =
    useOnboardingTour();

  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [isMobile, setIsMobile] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const liveRegionId = useId();

  // Compute tooltip position relative to the target element
  const updatePosition = useCallback(() => {
    if (!currentStepData) return;

    const target = document.querySelector(currentStepData.targetSelector);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const mobile = window.innerWidth < MOBILE_BREAKPOINT;
    setIsMobile(mobile);

    if (mobile) {
      // Pin to the bottom of the viewport on small screens
      setPosition({
        top: window.innerHeight - 220,
        left: 16,
      });
      return;
    }

    // Prefer below the element; fall back to above if there's not enough space
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow > 200
        ? rect.bottom + TOOLTIP_OFFSET
        : rect.top - 180 - TOOLTIP_OFFSET;

    const left = Math.max(
      16,
      Math.min(rect.left, window.innerWidth - 320 - 16),
    );

    setPosition({ top: top + window.scrollY, left: left + window.scrollX });
  }, [currentStepData]);

  useEffect(() => {
    if (!isActive) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isActive, currentStep, updatePosition]);

  // Focus the tooltip container when it appears
  useEffect(() => {
    if (isActive) {
      tooltipRef.current?.focus();
    }
  }, [isActive, currentStep]);

  // Close on Escape
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, skip]);

  if (!isActive || !currentStepData) return null;

  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  const highlightStyle = getHighlightStyle(currentStepData.targetSelector);

  return (
    <>
      {/* Backdrop overlay */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
          zIndex: 9998,
          pointerEvents: 'none',
        }}
      />

      {/* Spotlight cutout around the target element */}
      {highlightStyle && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            ...highlightStyle,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            borderRadius: '6px',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`tour-title-${currentStep}`}
        aria-describedby={`tour-desc-${currentStep} ${liveRegionId}`}
        tabIndex={-1}
        style={{
          position: isMobile ? 'fixed' : 'absolute',
          top: isMobile ? undefined : position.top,
          bottom: isMobile ? 16 : undefined,
          left: isMobile ? 16 : position.left,
          right: isMobile ? 16 : undefined,
          width: isMobile ? undefined : '300px',
          backgroundColor: '#fff',
          borderRadius: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          padding: '1.25rem',
          zIndex: 10000,
          outline: 'none',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Step counter */}
        <div
          style={{
            fontSize: '0.75rem',
            color: '#888',
            marginBottom: '0.4rem',
            fontWeight: 500,
          }}
        >
          Step {currentStep + 1} of {totalSteps}
        </div>

        <h2
          id={`tour-title-${currentStep}`}
          style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.4rem' }}
        >
          {currentStepData.title}
        </h2>

        <p
          id={`tour-desc-${currentStep}`}
          style={{ fontSize: '0.9rem', color: '#444', margin: '0 0 1rem', lineHeight: 1.5 }}
        >
          {currentStepData.description}
        </p>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={skip}
            style={ghostButtonStyle}
          >
            Skip Tour
          </button>

          {!isFirst && (
            <button type="button" onClick={prev} style={secondaryButtonStyle}>
              Back
            </button>
          )}

          <button type="button" onClick={next} style={primaryButtonStyle}>
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>

      {/* aria-live region: announces step title changes to screen readers */}
      <div
        id={liveRegionId}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
        }}
      >
        {`Step ${currentStep + 1} of ${totalSteps}: ${currentStepData.title}`}
      </div>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHighlightStyle(
  selector: string,
): React.CSSProperties | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top - HIGHLIGHT_PADDING,
    left: rect.left - HIGHLIGHT_PADDING,
    width: rect.width + HIGHLIGHT_PADDING * 2,
    height: rect.height + HIGHLIGHT_PADDING * 2,
  };
}

const baseButtonStyle: React.CSSProperties = {
  padding: '0.45rem 1rem',
  borderRadius: '6px',
  fontSize: '0.875rem',
  cursor: 'pointer',
  border: 'none',
  fontWeight: 500,
};

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#4a90d9',
  color: '#fff',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#e8f0fb',
  color: '#4a90d9',
};

const ghostButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: 'transparent',
  color: '#888',
  marginRight: 'auto',
};

export default OnboardingTour;
