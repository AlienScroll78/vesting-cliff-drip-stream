/**
 * Tooltip system built on @floating-ui/react.
 *
 * Exports:
 *  - Tooltip            — generic tooltip wrapping any trigger element
 *  - GlossaryTooltip    — tooltip populated from the GLOSSARY lookup table
 *  - TermWithTooltip    — inline span with dotted underline for glossary terms
 *  - InfoTooltip        — ℹ︎ icon button trigger with tooltip content
 */

import {
  arrow,
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useId,
  useInteractions,
  useRole,
  type Placement,
} from "@floating-ui/react";
import React, { useRef, useState } from "react";
import "./Tooltip.css";
import { GLOSSARY, type GlossaryKey } from "./glossary-tooltips";

// ─── Base Tooltip ─────────────────────────────────────────────────────────────

export interface TooltipProps {
  /** The trigger element. Must be a single React element that accepts ref. */
  children: React.ReactElement;
  /** Tooltip content. Can be a string or JSX. */
  content: React.ReactNode;
  /** Preferred placement (auto-adjusts to avoid viewport overflow). */
  side?: Placement;
}

export function Tooltip({ children, content, side = "top" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const { refs, floatingStyles, context, middlewareData, placement } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ fallbackAxisSideDirection: "start" }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
  });

  const hover = useHover(context, { delay: { open: 100, close: 0 }, move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { escapeKey: true });
  const role = useRole(context, { role: "tooltip" });
  // On mobile, also allow tap to open
  const click = useClick(context, { toggle: true });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
    click,
  ]);

  // Compute arrow position
  const arrowX = middlewareData.arrow?.x ?? 0;
  const arrowY = middlewareData.arrow?.y ?? 0;
  const staticSide: Record<string, string> = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right",
  };
  const arrowSide = staticSide[placement.split("-")[0]] ?? "bottom";

  return (
    <>
      {React.cloneElement(children, {
        ...getReferenceProps({
          ref: refs.setReference,
          "aria-describedby": open ? tooltipId : undefined,
          ...(children.props as Record<string, unknown>),
        }),
      })}

      <FloatingPortal>
        {open && (
          <div
            id={tooltipId}
            ref={refs.setFloating}
            style={floatingStyles}
            className="tooltip-content tooltip-enter"
            {...getFloatingProps()}
          >
            {content}
            <div
              ref={arrowRef}
              className="tooltip-arrow"
              style={{
                left: arrowX != null ? `${arrowX}px` : "",
                top: arrowY != null ? `${arrowY}px` : "",
                [arrowSide]: "-4px",
              }}
            />
          </div>
        )}
      </FloatingPortal>
    </>
  );
}

// ─── Glossary Tooltip ─────────────────────────────────────────────────────────

export interface GlossaryTooltipProps {
  /** Key into the GLOSSARY object. */
  term: GlossaryKey;
  /** The trigger element. */
  children: React.ReactElement;
  side?: Placement;
}

/**
 * Wraps any element with a tooltip populated from the canonical GLOSSARY.
 *
 * @example
 * <GlossaryTooltip term="cliff">
 *   <label>Cliff duration</label>
 * </GlossaryTooltip>
 */
export function GlossaryTooltip({ term, children, side = "top" }: GlossaryTooltipProps) {
  const entry = GLOSSARY[term];

  const content = (
    <>
      <span className="tooltip-term">{entry.term}</span>
      <span className="tooltip-definition">{entry.definition}</span>
      {entry.example && <span className="tooltip-example">{entry.example}</span>}
    </>
  );

  return (
    <Tooltip content={content} side={side}>
      {children}
    </Tooltip>
  );
}

// ─── TermWithTooltip ──────────────────────────────────────────────────────────

export interface TermWithTooltipProps {
  /** Key into the GLOSSARY object. */
  term: GlossaryKey;
  /** Optional override display text. Defaults to the glossary term name. */
  children?: React.ReactNode;
  side?: Placement;
}

/**
 * Renders an inline span with a dotted underline.
 * Hover or tap reveals the glossary definition.
 *
 * @example
 * The stream has a <TermWithTooltip term="cliff">cliff</TermWithTooltip> period.
 */
export function TermWithTooltip({ term, children, side = "top" }: TermWithTooltipProps) {
  return (
    <GlossaryTooltip term={term} side={side}>
      <button type="button" className="term-trigger">
        <span className="term-with-tooltip">{children ?? GLOSSARY[term].term}</span>
      </button>
    </GlossaryTooltip>
  );
}

// ─── InfoTooltip ──────────────────────────────────────────────────────────────

export interface InfoTooltipProps {
  /** Tooltip content or GLOSSARY key. */
  content: React.ReactNode;
  /** Preferred placement. */
  side?: Placement;
  /** Accessible label for the ℹ button. */
  label?: string;
}

/**
 * A small ℹ︎ icon button that shows a tooltip on hover/tap.
 * Use next to form labels and technical terms.
 *
 * @example
 * <label>Rate <InfoTooltip content="Tokens accrued per ledger" /></label>
 */
export function InfoTooltip({ content, side = "top", label = "More information" }: InfoTooltipProps) {
  return (
    <Tooltip content={content} side={side}>
      <button
        type="button"
        className="tooltip-info-btn"
        aria-label={label}
      >
        ℹ
      </button>
    </Tooltip>
  );
}

/**
 * Convenience: InfoTooltip pre-populated from the GLOSSARY.
 *
 * @example
 * <label>Cliff duration <GlossaryInfoTooltip term="cliff" /></label>
 */
export function GlossaryInfoTooltip({
  term,
  side = "top",
}: {
  term: GlossaryKey;
  side?: Placement;
}) {
  const entry = GLOSSARY[term];
  const content = (
    <>
      <span className="tooltip-term">{entry.term}</span>
      <span className="tooltip-definition">{entry.definition}</span>
      {entry.example && <span className="tooltip-example">{entry.example}</span>}
    </>
  );
  return (
    <InfoTooltip
      content={content}
      side={side}
      label={`What is ${entry.term}?`}
    />
  );
}
