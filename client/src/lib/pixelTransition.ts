import { deskSceneScale, deskSpriteRect, drawDeskSprites, drawSpriteShadow, type DeskSprite } from "./deskSprites";
import { drawPixelBackdrop } from "./pixelBackdrop";

/* ------------------------------------------------------------------
   The "real photo -> pixel world" transition (about 4 seconds):
     0.0 - 1.6 s  the photo gets blockier and blockier
     1.1 - 2.7 s  the pixel backdrop dissolves in, tile by tile
     2.3 - 3.7 s  each object pops into its sprite (one after another) with sparkles
     3.7 - 4.0 s  hold on the finished pixel world
   The last frame is exactly the pixel-world scene.
   ------------------------------------------------------------------ */

export const PIXEL_TRANSITION_MS = 4000;

const PIXELATE = { start: 0, end: 1600 };
const DISSOLVE = { start: 1100, end: 2700 };
const POPS = { start: 2300, end: 3700 };
const POP_MS = 600;
const SPARKLE_COLORS = ["#fff7e6", "#ffd84a", "#ff86a8"];

export type PixelTransition = {
  /** The canvas being animated; put it on the page. */
  canvas: HTMLCanvasElement;
  /** Resolves when the animation finishes (or is cancelled). */
  done: Promise<void>;
  /** Stop now and leave the last drawn frame. */
  cancel: () => void;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const phase = (t: number, p: { start: number; end: number }): number => clamp01((t - p.start) / (p.end - p.start));
const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
/** 0 -> overshoot a little -> 1, for a bouncy pop. */
const easeOutBack = (p: number): number => {
  const c = 1.9;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};

/** Small fixed-seed random generator, so the dissolve pattern is the same for a given photo size. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 4-point pixel star. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = Math.max(1, Math.round(size));
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x - s / 2), Math.round(y - s * 1.5), s, s * 3);
  ctx.fillRect(Math.round(x - s * 1.5), Math.round(y - s / 2), s * 3, s);
}

/** Animate `photo` turning into the pixel world with `sprites`, on a new canvas the size of the composed scene. */
export function playPixelTransition(photo: HTMLCanvasElement, sprites: readonly DeskSprite[]): PixelTransition {
  const scale = deskSceneScale(photo);
  const W = Math.round(photo.width * scale);
  const H = Math.round(photo.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const backdrop = document.createElement("canvas");
  backdrop.width = W;
  backdrop.height = H;
  drawPixelBackdrop(backdrop.getContext("2d")!, W, H);

  // shrunken copy of the photo, redrawn at each block size
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d")!;
  const maxBlock = Math.max(12, Math.round(W / 48));

  // sprites pop in left to right
  const order = sprites
    .map((sp) => ({ sp, rect: deskSpriteRect(sp, scale) }))
    .filter((o): o is { sp: DeskSprite; rect: NonNullable<ReturnType<typeof deskSpriteRect>> } => o.rect !== null)
    .sort((a, b) => a.rect.x - b.rect.x);
  const popGap = order.length > 1 ? (POPS.end - POPS.start - POP_MS) / (order.length - 1) : 0;
  const popStart = (i: number): number => POPS.start + i * popGap;

  // dissolve tiles, each with its own moment to flip (a soft top-to-bottom wave plus randomness).
  // Tiles over an object wait for that object's pop, so the real thing never vanishes before its sprite arrives.
  const tile = Math.max(8, Math.round(W / 60));
  const cols = Math.ceil(W / tile);
  const rows = Math.ceil(H / tile);
  const rand = seeded(W * 31 + H);
  const flipMs = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wave = 0.7 * rand() + 0.3 * (r / Math.max(1, rows - 1));
      let at = DISSOLVE.start + wave * (DISSOLVE.end - DISSOLVE.start);
      const cx = (c + 0.5) * tile;
      const cy = (r + 0.5) * tile;
      order.forEach(({ sp }, i) => {
        const b = sp.box;
        if (cx >= b.x * scale && cx <= (b.x + b.w) * scale && cy >= b.y * scale && cy <= (b.y + b.h) * scale) {
          at = Math.max(at, popStart(i) + 60);
        }
      });
      flipMs[r * cols + c] = at;
    }
  }

  const drawPhoto = (block: number): void => {
    ctx.imageSmoothingEnabled = block <= 1;
    if (block <= 1) {
      ctx.drawImage(photo, 0, 0, W, H);
      return;
    }
    small.width = Math.max(1, Math.round(W / block));
    small.height = Math.max(1, Math.round(H / block));
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(photo, 0, 0, small.width, small.height);
    ctx.drawImage(small, 0, 0, W, H);
  };

  const drawFrame = (t: number): void => {
    // 1) blockier and blockier photo
    const block = Math.round(1 + (maxBlock - 1) * easeInOut(phase(t, PIXELATE)));
    drawPhoto(block);

    // 2) backdrop tiles flip in
    if (t >= DISSOLVE.start) {
      ctx.imageSmoothingEnabled = false;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((flipMs[r * cols + c] ?? Infinity) > t) continue;
          const x = c * tile;
          const y = r * tile;
          ctx.drawImage(backdrop, x, y, tile, tile, x, y, tile, tile);
        }
      }
    }

    // 3) sprites pop in with sparkles
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    order.forEach(({ sp, rect }, i) => {
      const local = (t - popStart(i)) / POP_MS;
      if (local <= 0) return;
      const p = clamp01(local);
      const k = Math.max(0, easeOutBack(p));
      const w = Math.round(rect.w * k);
      const h = Math.round(rect.h * k);
      if (w > 0 && h > 0) {
        const x = Math.round(rect.x + (rect.w - w) / 2);
        const y = Math.round(rect.y + rect.h - h); // grows up from the ground
        drawSpriteShadow(ctx, { x, y, w, h, zoom: rect.zoom * k });
        ctx.drawImage(sp.canvas, x, y, w, h);
      }
      if (local < 1.4) {
        const fade = clamp01(local / 1.4);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const reach = Math.max(rect.w, rect.h) * (0.35 + 0.45 * fade);
        const size = Math.max(2, rect.zoom * (1.6 - fade));
        for (let n = 0; n < 6; n++) {
          const a = (n / 6) * Math.PI * 2 + i;
          ctx.globalAlpha = 1 - fade;
          sparkle(ctx, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach * 0.8, size, SPARKLE_COLORS[n % 3] ?? "#fff");
        }
        ctx.globalAlpha = 1;
      }
    });
    ctx.restore();
  };

  /** The exact finished pixel-world picture. */
  const drawFinal = (): void => {
    ctx.drawImage(backdrop, 0, 0);
    drawDeskSprites(ctx, sprites, scale);
  };

  let raf = 0;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduceMotion) {
    drawFinal();
    finish();
  } else {
    drawFrame(0);
    let start = -1;
    const tick = (now: number): void => {
      if (start < 0) start = now;
      const t = now - start;
      if (t >= PIXEL_TRANSITION_MS) {
        drawFinal();
        finish();
        return;
      }
      drawFrame(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    canvas,
    done,
    cancel: () => {
      cancelAnimationFrame(raf);
      finish();
    },
  };
}
