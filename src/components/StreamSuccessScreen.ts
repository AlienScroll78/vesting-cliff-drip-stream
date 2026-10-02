export interface StreamConfig {
  recipient: string;
  token: string;
  rate: number;
  cliffDays: number;
  totalDays: number;
  txHash: string;
}

export function createSuccessScreen(config: StreamConfig, onReset?: () => void) {
  let root: HTMLElement | null = null;
  let cancelConfetti: (() => void) | null = null;

  function buildHTML(): string {
    const short = `${config.recipient.slice(0, 6)}…${config.recipient.slice(-4)}`;
    return `
<div class="ss-overlay" role="dialog" aria-modal="true" aria-label="Stream created">
  <div class="ss-card">
    <h1 class="ss-title">🎉 Stream Created!</h1>
    <canvas class="ss-confetti" aria-hidden="true"></canvas>
    <dl class="ss-summary">
      <dt>Recipient</dt><dd title="${config.recipient}">${short}</dd>
      <dt>Token</dt><dd>${config.token}</dd>
      <dt>Rate</dt><dd>${config.rate} tokens / ledger</dd>
      <dt>Cliff</dt><dd>${config.cliffDays} days</dd>
      <dt>Duration</dt><dd>${config.totalDays} days</dd>
    </dl>
    <div class="ss-actions">
      <button class="ss-btn ss-btn-share">Copy share link</button>
      <button class="ss-btn ss-btn-primary ss-btn-reset">Create another</button>
    </div>
    <button class="ss-close" aria-label="Close">✕</button>
  </div>
</div>`;
  }

  function runConfetti(canvas: HTMLCanvasElement) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = canvas.getContext("2d")!;
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 200;

    const COLOURS = ["#5B21B6", "#7C3AED", "#06B6D4", "#10B981", "#F59E0B"];
    const particles = Array.from({ length: 28 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 8,
      h: 6 + Math.random() * 8,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      vx: (Math.random() - 0.5) * 4,
      vy: 1 + Math.random() * 3,
      alpha: 1,
    }));

    let raf: number;
    const start = performance.now();

    function draw(now: number) {
      const elapsed = now - start;
      if (elapsed > 2000) { cancelConfetti = null; return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        p.alpha = Math.max(0, 1 - elapsed / 2000);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    cancelConfetti = () => cancelAnimationFrame(raf);
  }

  return {
    mount(container: HTMLElement) {
      container.insertAdjacentHTML("beforeend", buildHTML());
      root = container.querySelector<HTMLElement>(".ss-overlay")!;

      const canvas = root.querySelector<HTMLCanvasElement>(".ss-confetti")!;
      runConfetti(canvas);

      root.querySelector(".ss-btn-share")!.addEventListener("click", async (e) => {
        const url = `${location.origin}/stream/${config.txHash}`;
        await navigator.clipboard.writeText(url);
        (e.target as HTMLButtonElement).textContent = "Copied!";
        setTimeout(() => { (e.target as HTMLButtonElement).textContent = "Copy share link"; }, 2000);
      });

      const dismiss = () => { cancelConfetti?.(); root?.remove(); root = null; };
      root.querySelector(".ss-btn-reset")!.addEventListener("click", () => { dismiss(); onReset?.(); });
      root.querySelector(".ss-close")!.addEventListener("click", dismiss);
    },

    unmount() {
      cancelConfetti?.();
      root?.remove();
      root = null;
    },
  };
}
