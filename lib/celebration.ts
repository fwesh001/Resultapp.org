"use client";

/**
 * Lightweight canvas celebration for the registration wizard.
 *
 * Dependency-free by design: the success screen needs a few hundred particles
 * for a few seconds, not a celebration framework in the initial bundle. All
 * functions are safe to call during render-guarded effects and do nothing when
 * reduced motion is requested, during SSR, or when canvas is unavailable.
 */

export interface CelebrationOrigin {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  circle: boolean;
  rotation: number;
  rotationSpeed: number;
  life: number;
  decay: number;
}

const DEFAULT_COLORS = ["#a855f7", "#e879f9", "#34d399", "#fbbf24", "#ffffff"];

function shouldCelebrate(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (typeof window.matchMedia !== "function") return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function originFromElement(el: HTMLElement | null, fallback: CelebrationOrigin = { x: 0.5, y: 0.35 }): CelebrationOrigin {
  if (!el || typeof window === "undefined") return fallback;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return fallback;
  return {
    x: clamp01((rect.left + rect.width / 2) / window.innerWidth),
    y: clamp01((rect.top + rect.height / 2) / window.innerHeight),
  };
}

export function originAlongElement(el: HTMLElement | null, fraction: number, fallback: CelebrationOrigin = { x: 0.5, y: 0.35 }): CelebrationOrigin {
  if (!el || typeof window === "undefined") return fallback;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return fallback;
  return {
    x: clamp01((rect.left + rect.width * clamp01(fraction)) / window.innerWidth),
    y: clamp01((rect.top + rect.height / 2) / window.innerHeight),
  };
}

interface BurstOptions {
  particleCount?: number;
  spreadDegrees?: number;
  startVelocity?: number;
  gravity?: number;
  durationMs?: number;
  colors?: string[];
  origin?: CelebrationOrigin;
}

function burst({
  particleCount = 60,
  spreadDegrees = 70,
  startVelocity = 9,
  gravity = 0.22,
  durationMs = 1400,
  colors = DEFAULT_COLORS,
  origin = { x: 0.5, y: 0.35 },
}: BurstOptions = {}): void {
  if (!shouldCelebrate()) return;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "90";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * scale);
  const height = Math.floor(window.innerHeight * scale);
  canvas.width = width;
  canvas.height = height;

  const originX = clamp01(origin.x) * width;
  const originY = clamp01(origin.y) * height;
  const spread = (Math.max(10, spreadDegrees) * Math.PI) / 180;
  const particles: Particle[] = Array.from({ length: Math.max(1, particleCount) }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = startVelocity * scale * (0.45 + Math.random() * 0.9);
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: (2.4 + Math.random() * 3.4) * scale,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#ffffff",
      circle: Math.random() < 0.42,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.28,
      life: 1,
      decay: 0.008 + Math.random() * 0.012,
    };
  });

  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
  };

  const frame = () => {
    if (stopped) return;
    ctx.clearRect(0, 0, width, height);
    let alive = false;
    for (const p of particles) {
      p.vy += gravity * scale;
      p.vx *= 0.988;
      p.vy *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > height + 24 * scale) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (!alive) {
      stop();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  window.setTimeout(stop, Math.max(400, durationMs) + 450);
}

/** Small milestone pop tied to a point along the progress bar. */
export function fireMilestoneBurst(bar: HTMLElement | null, milestoneFraction: number): void {
  burst({
    particleCount: 22,
    spreadDegrees: 58,
    startVelocity: 7,
    gravity: 0.2,
    durationMs: 900,
    origin: originAlongElement(bar, milestoneFraction, { x: milestoneFraction, y: 0.42 }),
  });
}

/** Focused completion burst anchored to the portal call to action. */
export function fireCompletionBurst(anchor: HTMLElement | null): void {
  burst({
    particleCount: 110,
    spreadDegrees: 78,
    startVelocity: 10,
    gravity: 0.22,
    durationMs: 2200,
    origin: originFromElement(anchor, { x: 0.5, y: 0.34 }),
  });
}
