"use client";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const DURATION_MS = 900;
const PARTICLE_COUNT = 48;
const COLORS = ["#7C3AED", "#4F46E5", "#06B6D4", "#10B981", "#F59E0B"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
}

function makeParticles(originX: number, originY: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3, // initial upward bias
      size: 4 + Math.random() * 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#7C3AED",
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
    };
  });
}

interface Props {
  /** Set true to trigger a one-shot burst; ignored while already running. */
  active: boolean;
  /** Called once the burst has finished (or immediately if reduced motion / inactive). */
  onDone: () => void;
  /** Optional immediate dismissal handler (defaults to onDone). */
  onDismiss?: () => void;
  /** Screen-space origin of the burst. Defaults to viewport center. */
  originX?: number;
  originY?: number;
}

/**
 * Lightweight canvas confetti burst — no external dependency. Draws onto a
 * fixed, pointer-events-none canvas and cleans itself up after ~1.1s.
 * Renders nothing under prefers-reduced-motion (calls onDone immediately).
 */
export function ConfettiBurst({ active, onDone, onDismiss, originX, originY }: Props) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active) return;
    if (reduced) {
      onDoneRef.current();
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      onDoneRef.current();
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const particles = makeParticles(
      originX ?? window.innerWidth / 2,
      originY ?? window.innerHeight / 2
    );

    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / DURATION_MS, 1);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // gravity
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        onDoneRef.current();
      }
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [active, reduced, originX, originY]);

  if (!active || reduced) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          pointerEvents: "none",
          zIndex: 2000,
        }}
      />
      <button
        type="button"
        aria-label="Dismiss celebration"
        onClick={onDismiss ?? onDone}
        style={{
          position: "fixed",
          top: "1rem",
          right: "1rem",
          zIndex: 2001,
          minHeight: 44,
          padding: "0.5rem 0.75rem",
          border: "1px solid rgba(255,255,255,0.65)",
          borderRadius: "9999px",
          background: "rgba(17,24,39,0.82)",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </>
  );
}
