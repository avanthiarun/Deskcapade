import type { Box } from "@deskcapade/shared";
import { hashLabel, skinFor, type HeroReaction, type WorldKind, type WorldSkin } from "./materials";

/** Longest side of the pixel grid. Chunky on purpose — this is the whole look. */
const GRID = 220;
const CAPTION_MS = 5000;
const IDLE_CAPTION = "The desk is quiet. Move something, and a legend starts.";

export type WorldObject = { label: string; box: Box; fading: boolean };

type Px = { x: number; y: number; w: number; h: number };

const px = (n: number): number => (n < 0 ? Math.ceil(n) : Math.floor(n));

function boxToPx(b: Box, gw: number, gh: number): Px {
  return {
    x: px(b.x * gw),
    y: px(b.y * gh),
    w: Math.max(4, px(b.w * gw)),
    h: Math.max(4, px(b.h * gh)),
  };
}

function posterize(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // 3 bits per channel + a little extra contrast so it reads as cartoony
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    const boost = (v: number): number => Math.max(0, Math.min(255, (v - 128) * 1.18 + 128));
    d[i] = boost(r) & 0xe0;
    d[i + 1] = boost(g) & 0xe0;
    d[i + 2] = boost(b) & 0xe0;
  }
  ctx.putImageData(img, 0, 0);
}

function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(px(x), px(y), Math.max(1, px(w)), Math.max(1, px(h)));
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if ("width" in src && "height" in src) {
    return { w: Number(src.width) || 0, h: Number(src.height) || 0 };
  }
  return { w: 0, h: 0 };
}

function drawDuck(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bob = Math.round(Math.sin(t) * 1);
  fill(ctx, x + 1, y + bob + 1, 5, 3, "#ffd84a");
  fill(ctx, x + 5, y + bob, 3, 3, "#ffd84a");
  fill(ctx, x + 7, y + bob + 1, 2, 1, "#f08a30");
  fill(ctx, x + 6, y + bob, 1, 1, "#2b1d3a");
}

function drawFlamingo(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bob = Math.round(Math.sin(t * 0.8) * 1);
  fill(ctx, x, y + bob + 2, 7, 3, "#ff86a8");
  fill(ctx, x + 6, y + bob, 2, 3, "#ff86a8");
  fill(ctx, x + 2, y + bob + 5, 1, 3, "#fff7e6");
}

function drawTube(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  fill(ctx, x, y, 6, 4, "#ff6b6b");
  fill(ctx, x + 2, y + 1, 2, 2, "#5cb8ff");
}

function drawWater(ctx: CanvasRenderingContext2D, b: Px, t: number, seed: number): void {
  const insetX = Math.max(1, Math.round(b.w * 0.18));
  const insetY = Math.max(1, Math.round(b.h * 0.22));
  const ix = b.x + insetX;
  const iy = b.y + insetY;
  const iw = Math.max(3, b.w - insetX * 2);
  const ih = Math.max(3, b.h - insetY * 2);
  const waterTop = iy + Math.round(ih * 0.28);

  fill(ctx, ix, waterTop, iw, iy + ih - waterTop, "#2a6fd6");
  fill(ctx, ix, waterTop, iw, Math.max(1, Math.round(ih * 0.12)), "#5cb8ff");
  // foam sparkle
  for (let i = 0; i < 4; i++) {
    const sx = ix + ((seed + i * 13 + Math.floor(t * 8)) % Math.max(1, iw - 1));
    fill(ctx, sx, waterTop, 1, 1, "#a8e0ff");
  }

  if (iw >= 14 && ih >= 10) {
    drawDuck(ctx, ix + 2 + (seed % 3), waterTop - 1, t + seed);
    drawDuck(ctx, ix + Math.round(iw * 0.55), waterTop, t * 1.1 + 2);
  }
  if (iw >= 22 && ih >= 14) {
    drawFlamingo(ctx, ix + Math.round(iw * 0.28), waterTop - 2, t + seed * 0.01);
    drawTube(ctx, ix + Math.round(iw * 0.7), waterTop + 1);
  }

  // handle-side waterslide / ladder
  const slideX = b.x + b.w - Math.max(3, Math.round(b.w * 0.14));
  const slideW = Math.max(2, Math.round(b.w * 0.1));
  fill(ctx, slideX, b.y + 1, slideW, b.h - 2, "#e8c48a");
  for (let y = b.y + 2; y < b.y + b.h - 2; y += 3) {
    fill(ctx, slideX, y, slideW, 1, "#6b4a3a");
  }
  fill(ctx, slideX - 1, waterTop, slideW + 2, 1, "#fff7e6");

  if (iw >= 18) {
    // tiny beach umbrella
    const ux = ix + Math.round(iw * 0.15);
    const uy = iy + 1;
    fill(ctx, ux + 2, uy, 1, waterTop - uy, "#6b4a3a");
    fill(ctx, ux, uy, 5, 2, "#ff86a8");
  }
}

function drawLava(ctx: CanvasRenderingContext2D, b: Px, t: number, seed: number): void {
  const insetX = Math.max(1, Math.round(b.w * 0.16));
  const insetY = Math.max(1, Math.round(b.h * 0.2));
  const ix = b.x + insetX;
  const iy = b.y + insetY;
  const iw = Math.max(3, b.w - insetX * 2);
  const ih = Math.max(3, b.h - insetY * 2);
  fill(ctx, ix, iy, iw, ih, "#e0405a");
  fill(ctx, ix, iy, iw, 2, "#ffb870");
  const n = 3 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const phase = t * 3 + i * 1.7 + seed;
    const bx = ix + 1 + ((seed + i * 17) % Math.max(1, iw - 3));
    const rise = Math.round((Math.sin(phase) * 0.5 + 0.5) * Math.max(2, ih * 0.4));
    fill(ctx, bx, iy + ih - rise - 2, 2, 2, "#ffd84a");
  }
}

function drawVine(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const sway = Math.round(Math.sin(t) * Math.max(1, b.w * 0.08));
  let x = b.x + Math.round(b.w / 2);
  for (let y = b.y; y < b.y + b.h; y += 2) {
    x += Math.round(Math.sin(y * 0.4 + t) * 1);
    fill(ctx, x + sway, y, 2, 2, "#2e7d46");
    if (y % 6 === 0) fill(ctx, x + sway + 2, y, 2, 1, "#a8e86c");
  }
}

function drawGarden(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const ground = b.y + b.h - 2;
  fill(ctx, b.x + 1, ground, b.w - 2, 2, "#3d5a2a");
  for (let i = 0; i < 3; i++) {
    const fx = b.x + 2 + i * Math.max(3, Math.round(b.w / 3));
    fill(ctx, fx + 1, b.y + 2, 1, ground - b.y - 2, "#2e7d46");
    fill(ctx, fx, b.y + 1, 3, 2, "#5cbf5a");
    fill(ctx, fx + 1, b.y, 1, 1, "#ff86a8");
  }
  const dropY = b.y + 2 + ((Math.floor(t * 8) + b.x) % Math.max(2, b.h - 4));
  fill(ctx, b.x + Math.round(b.w * 0.3), dropY, 1, 2, "#5cb8ff");
}

function drawNervous(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const flash = Math.sin(t * 8) > 0.4;
  fill(ctx, b.x, b.y, b.w, 2, flash ? "#ffd84a" : "#e0405a");
  fill(ctx, b.x, b.y + b.h - 2, b.w, 2, flash ? "#ffd84a" : "#e0405a");
  const ex = b.x + Math.round(b.w * 0.3);
  const ey = b.y + Math.round(b.h * 0.35);
  fill(ctx, ex, ey, 2, 2, "#fff7e6");
  fill(ctx, ex + 4, ey, 2, 2, "#fff7e6");
  fill(ctx, ex, ey, 1, 1, "#2b1d3a");
  fill(ctx, ex + 4, ey, 1, 1, "#2b1d3a");
  if (flash) fill(ctx, b.x + b.w - 3, b.y + 3, 2, 2, "#ffd84a");
}

function drawBounce(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const squash = Math.round(Math.abs(Math.sin(t * 4)) * 2);
  fill(ctx, b.x + 1, b.y + b.h - 4 + squash, b.w - 2, 4 - squash, "#ff86a8");
  fill(ctx, b.x + 2, b.y + b.h - 5 + squash, b.w - 4, 1, "#fff7e6");
  fill(ctx, b.x + Math.round(b.w / 2) - 1, b.y + 2, 2, b.h - 8, "#a8e86c");
  fill(ctx, b.x + Math.round(b.w / 2) - 3, b.y + 2, 6, 2, "#a8e86c");
}

function drawCastle(ctx: CanvasRenderingContext2D, b: Px): void {
  const top = b.y + 1;
  const tw = Math.max(2, Math.round(b.w / 5));
  fill(ctx, b.x + 1, top, tw, 4, "#c9cde0");
  fill(ctx, b.x + b.w - tw - 1, top, tw, 4, "#c9cde0");
  fill(ctx, b.x + Math.round(b.w / 2) - 1, top - 3, 2, 5, "#e0405a");
  fill(ctx, b.x + Math.round(b.w / 2), top - 4, 3, 2, "#e0405a");
}

function drawPath(ctx: CanvasRenderingContext2D, b: Px): void {
  const y = b.y + Math.round(b.h * 0.55);
  for (let x = b.x + 1; x < b.x + b.w - 2; x += 4) {
    fill(ctx, x, y, 3, 3, "#a8745a");
    fill(ctx, x + 1, y + 1, 1, 1, "#6b4a3a");
  }
}

function drawPotion(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const glow = Math.sin(t * 3) > 0 ? "#c9a0ff" : "#7a4cc2";
  fill(ctx, b.x + Math.round(b.w * 0.25), b.y + Math.round(b.h * 0.35), Math.round(b.w * 0.5), Math.round(b.h * 0.45), glow);
  fill(ctx, b.x + Math.round(b.w * 0.4), b.y + 2, Math.round(b.w * 0.2), Math.round(b.h * 0.2), "#fff7e6");
}

function drawCozy(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  if (Math.sin(t * 2) > 0) {
    fill(ctx, b.x + b.w - 6, b.y + 2, 3, 2, "#fff7e6");
    fill(ctx, b.x + b.w - 4, b.y, 2, 2, "#fff7e6");
  }
}

function drawGeneric(ctx: CanvasRenderingContext2D, b: Px, t: number): void {
  const spark = Math.floor(t * 6) % 3;
  fill(ctx, b.x + spark, b.y, 1, 1, "#ffd84a");
  fill(ctx, b.x + b.w - 1 - spark, b.y + 2, 1, 1, "#fff7e6");
}

function outline(ctx: CanvasRenderingContext2D, b: Px, color: string, fading: boolean): void {
  ctx.globalAlpha = fading ? 0.4 : 0.9;
  ctx.fillStyle = color;
  fill(ctx, b.x, b.y, b.w, 1, color);
  fill(ctx, b.x, b.y + b.h - 1, b.w, 1, color);
  fill(ctx, b.x, b.y, 1, b.h, color);
  fill(ctx, b.x + b.w - 1, b.y, 1, b.h, color);
  ctx.globalAlpha = 1;
}

const KIND_COLOR: Record<WorldKind, string> = {
  pool: "#5cb8ff",
  lava: "#e0405a",
  vine: "#5cbf5a",
  cozy: "#ffb870",
  nervous: "#ffd84a",
  bounce: "#ff86a8",
  castle: "#c9cde0",
  garden: "#a8e86c",
  path: "#a8745a",
  potion: "#c9a0ff",
  generic: "#fff7e6",
};

function drawSkin(ctx: CanvasRenderingContext2D, b: Px, skin: WorldSkin, t: number, seed: number): void {
  switch (skin.kind) {
    case "pool":
      drawWater(ctx, b, t, seed);
      break;
    case "lava":
      drawLava(ctx, b, t, seed);
      break;
    case "vine":
      drawVine(ctx, b, t);
      break;
    case "garden":
      drawGarden(ctx, b, t);
      break;
    case "nervous":
      drawNervous(ctx, b, t);
      break;
    case "bounce":
      drawBounce(ctx, b, t);
      break;
    case "castle":
      drawCastle(ctx, b);
      break;
    case "path":
      drawPath(ctx, b);
      break;
    case "potion":
      drawPotion(ctx, b, t);
      break;
    case "cozy":
      drawCozy(ctx, b, t);
      break;
    default:
      drawGeneric(ctx, b, t);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, reaction: HeroReaction, t: number): void {
  const bob = reaction === "bounce" ? Math.round(Math.abs(Math.sin(t * 6)) * 3) : Math.round(Math.sin(t * 2) * 1);
  const shake = reaction === "nervous" ? Math.round(Math.sin(t * 20) * 1) : 0;
  const hx = x + shake;
  const hy = y - bob;
  fill(ctx, hx + 1, hy, 6, 5, "#ffb870");
  fill(ctx, hx, hy + 1, 1, 2, "#ffb870");
  fill(ctx, hx + 7, hy + 1, 1, 2, "#ffb870");
  fill(ctx, hx + 2, hy + 2, 1, 1, "#2b1d3a");
  fill(ctx, hx + 5, hy + 2, 1, 1, "#2b1d3a");
  fill(ctx, hx + 2, hy + 5, 4, 3, "#ff86a8");
  fill(ctx, hx + 2, hy + 8, 2, 2, "#ffb870");
  fill(ctx, hx + 5, hy + 8, 2, 2, "#ffb870");

  if (reaction === "nap") {
    fill(ctx, hx + 9, hy - 2, 3, 2, "#fff7e6");
    fill(ctx, hx + 11, hy - 5, 2, 2, "#fff7e6");
  }
  if (reaction === "water") {
    fill(ctx, hx - 3, hy + 1, 2, 3, "#5cb8ff");
    fill(ctx, hx - 2, hy + 4, 1, 2, "#5cb8ff");
  }
}

function pickFeatured(objects: WorldObject[]): WorldObject | null {
  let best: WorldObject | null = null;
  let area = 0;
  for (const o of objects) {
    if (o.fading) continue;
    const a = o.box.w * o.box.h;
    if (a > area) {
      area = a;
      best = o;
    }
  }
  return best;
}

/**
 * Live camera → chunky pixel scene with object decorations and a reacting hero.
 * Returns the current story caption (HTML overlay).
 */
export class StoryWorld {
  private caption = IDLE_CAPTION;
  private captionUntil = 0;
  private lastKey = "";

  draw(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource | null,
    canvas: HTMLCanvasElement,
    objects: WorldObject[],
    now: number,
  ): string {
    const size = source ? sourceSize(source) : { w: 0, h: 0 };
    const ready = size.w > 0 && size.h > 0 && source;

    if (!ready) {
      if (canvas.width !== GRID || canvas.height !== Math.round(GRID * 9 / 16)) {
        canvas.width = GRID;
        canvas.height = Math.round((GRID * 9) / 16);
      }
      ctx.fillStyle = "#1d3f7a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return this.caption;
    }

    const gw = GRID;
    const gh = Math.max(80, Math.round((GRID * size.h) / size.w));
    if (canvas.width !== gw || canvas.height !== gh) {
      canvas.width = gw;
      canvas.height = gh;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(source, 0, 0, gw, gh);
    posterize(ctx, gw, gh);

    const t = now / 1000;
    let featured: WorldObject | null = pickFeatured(objects);
    let featuredSkin: WorldSkin | null = featured ? skinFor(featured.label) : null;

    for (const obj of objects) {
      const skin = skinFor(obj.label);
      const b = boxToPx(obj.box, gw, gh);
      ctx.globalAlpha = obj.fading ? 0.55 : 1;
      drawSkin(ctx, b, skin, t, hashLabel(obj.label));
      outline(ctx, b, KIND_COLOR[skin.kind], obj.fading);
      ctx.globalAlpha = 1;

      // tiny title chip
      if (!obj.fading && b.w >= 16) {
        const label = skin.title;
        ctx.fillStyle = "#fff7e6";
        const chipW = Math.min(b.w, 2 + label.length * 4);
        fill(ctx, b.x, Math.max(0, b.y - 6), chipW, 5, "#fff7e6");
        ctx.fillStyle = "#2b1d3a";
        ctx.font = "5px monospace";
        ctx.textBaseline = "top";
        ctx.fillText(label.slice(0, Math.floor(chipW / 4)), b.x + 1, Math.max(0, b.y - 6));
      }
    }

    const key = objects
      .filter((o) => !o.fading)
      .map((o) => o.label)
      .sort()
      .join("|");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.captionUntil = 0;
    }
    if (now >= this.captionUntil) {
      this.caption = featuredSkin?.caption ?? IDLE_CAPTION;
      this.captionUntil = now + CAPTION_MS;
    }

    const reaction: HeroReaction = featuredSkin?.reaction ?? "idle";
    if (featured) {
      const b = boxToPx(featured.box, gw, gh);
      const hx = Math.max(1, Math.min(gw - 10, b.x + Math.round(b.w / 2) - 4));
      const hy = Math.max(10, Math.min(gh - 12, b.y + 4));
      drawHero(ctx, hx, hy, reaction, t);
    } else {
      drawHero(ctx, Math.round(gw / 2) - 4, gh - 14, "idle", t);
    }

    return this.caption;
  }
}
