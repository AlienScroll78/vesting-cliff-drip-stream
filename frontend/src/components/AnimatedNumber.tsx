"use client";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const DURATION_MS = 500;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface Props {
  /** Raw numeric value to animate to. */
  value: number;
  /** Formats the (possibly interpolated) numeric value for display. */
  format: (n: number) => string;
}

/**
 * Tweens between the previous and next `value` over 500ms whenever it
 * changes, compositor-only (no layout thrash — just re-rendered text).
 * Renders the final value immediately under prefers-reduced-motion.
 */
export function AnimatedNumber({ value, format }: Props) {
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (reduced) {
      setDisplayed(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = easeOutCubic(t);
      setDisplayed(from + (to - from) * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  return <span data-testid="animated-number">{format(displayed)}</span>;
}
