import type { PoolLayout, Surface } from "./level";

/* ------------------------------------------------------------------
   Pixel art for the garden platformer, drawn in code on a grid of `p`-sized art pixels.
   Every object piece is drawn to fill the rect it's given, so it's exactly the size of
   the real desk object it replaces.
   ------------------------------------------------------------------ */

const INK = "#2b1d3a";
const LEAF = "#7ad957";
const LEAF_DARK = "#3f9e45";
const LEAF_LIGHT = "#c4f590";
const STALK = "#5cbf5a";
const PINK = "#ff86a8";
const YELLOW = "#ffd84a";
const YELLOW_LIGHT = "#fff0a0";
const CREAM = "#fff7e6";
const TILE_LINE = "#c9cde0";
const WATER = "#5cb8ff";
const WATER_DEEP = "#3f8fe0";
const WATER_LIGHT = "#a8e0ff";
const AIR = "#d8f1ff";
const METAL = "#c9cde0";
const METAL_DARK = "#8b8fa8";
const CAP = "#ff5a6e";
const CAP_SHADE = "#d43d55";
const STEM_SHADE = "#e8d8c0";
const BARK = "#8a5a3a";
const BARK_DARK = "#5e3a26";
const BARK_LIGHT = "#b07a50";
const CLOUD = "#ffffff";
const CLOUD_SHADE = "#d8ecff";
const GRASS = "#a8e86c";
const GRASS_DARK = "#5cbf5a";
const DIRT = "#c97a3a";
const DIRT_DARK = "#a8573a";

export type Rect = { x: number; y: number; w: number; h: number };

/** Art pixel size for a canvas whose height is 100 u. */
export const artPixel = (u: number): number => Math.max(2, Math.round(u * 0.7));

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Snap `n` down to the art grid. */
const snap = (n: number, p: number): number => Math.floor(n / p) * p;

/* ---------- vine (cans, bottles, tall things) ---------- */

/** A leafy vine filling `r`, with a leaf pad (half-width `padHalf`) and a flower on top. */
export function drawVine(ctx: CanvasRenderingContext2D, r: Rect, p: number, padHalf: number, t: number): void {
  const cx = r.x + r.w / 2;
  const top = r.y;
  const bottom = r.y + r.h;
  const reach = Math.max(p, Math.min(r.w / 2 - p, 5 * p)); // how far leaves stick out

  // stalk, swaying gently
  for (let y = top + 2 * p; y < bottom; y += p) {
    const sway = Math.round(Math.sin((y - top) / (p * 6) + t / 900)) * p;
    const sx = snap(cx + sway, p);
    px(ctx, sx - 2 * p, y, 4 * p, p, INK);
    px(ctx, sx - p, y, 2 * p, p, STALK);
    px(ctx, sx - p, y, p, p, LEAF_LIGHT);
  }

  // leaves, alternating sides
  let side = 1;
  for (let y = top + 5 * p; y < bottom - 2 * p; y += 5 * p) {
    const sway = Math.round(Math.sin((y - top) / (p * 6) + t / 900)) * p;
    const base = snap(cx + sway, p) + side * 2 * p;
    const len = snap(reach, p);
    const x0 = side > 0 ? base : base - len;
    px(ctx, x0, y - p, len, 3 * p, INK);
    px(ctx, x0 + (side > 0 ? 0 : p), y, len - p, p, LEAF);
    px(ctx, x0 + (side > 0 ? 0 : 2 * p), y + p, Math.max(0, len - 2 * p), p, LEAF_DARK);
    side = -side;
  }

  // leaf pad on top (the platform), plus a flower
  const x1 = snap(cx - padHalf, p);
  const x2 = snap(cx + padHalf, p);
  px(ctx, x1 - p, top - p, x2 - x1 + 2 * p, 3 * p + p, INK);
  px(ctx, x1, top, x2 - x1, p, LEAF_LIGHT);
  px(ctx, x1, top + p, x2 - x1, p, LEAF);
  px(ctx, x1 + p, top + 2 * p, x2 - x1 - 2 * p, p, LEAF_DARK);
  const fx = snap(cx, p);
  px(ctx, fx - 2 * p, top - 4 * p, 4 * p, 3 * p, INK);
  px(ctx, fx - p, top - 4 * p + p, 2 * p, p, PINK);
  px(ctx, fx - 2 * p + p / 2, top - 3 * p, p, p, PINK);
  px(ctx, fx + p, top - 3 * p, p, p, PINK);
  px(ctx, fx - p, top - 2 * p, 2 * p, p, YELLOW);
}

/* ---------- pool (mugs, cups, bowls) ---------- */

/** A swimming pool filling `r`, with its ladder (`ladder` in canvas pixels) down to the ground. */
export function drawPool(ctx: CanvasRenderingContext2D, r: Rect, pool: PoolLayout, box: Rect, p: number, t: number): void {
  // scale the pool's proportions from the physics box to the (maybe animating) drawn rect
  const k = r.h / Math.max(1, box.h);
  const wall = Math.max(p, Math.round(pool.wall * k));
  const waterTop = r.y + (pool.waterTop - box.y) * k;
  const bottom = r.y + r.h;

  // outline + tiled walls and floor
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, r.h, CREAM);
  for (let y = r.y + 3 * p; y < bottom; y += 3 * p) px(ctx, r.x, y, r.w, Math.max(1, p / 2), TILE_LINE);
  px(ctx, r.x + wall - p, r.y, p, r.h - wall + p, INK);
  px(ctx, r.x + r.w - wall, r.y, p, r.h - wall + p, INK);
  px(ctx, r.x + wall - p, bottom - wall, r.w - 2 * wall + 2 * p, p, INK);

  // inside: air, then water with a moving wave line
  const ix = r.x + wall;
  const iw = r.w - 2 * wall;
  px(ctx, ix, r.y, iw, waterTop - r.y, AIR);
  px(ctx, ix, waterTop, iw, bottom - wall - waterTop, WATER);
  px(ctx, ix, bottom - wall - 2 * p, iw, 2 * p, WATER_DEEP);
  const shift = Math.floor(t / 180) % 4;
  for (let x = ix; x < ix + iw; x += p) {
    const n = Math.floor((x - ix) / p) + shift;
    px(ctx, x, waterTop - (n % 4 === 0 ? p : 0), p, p, WATER_LIGHT);
  }
  // a couple of bubbles
  for (let i = 0; i < 2; i++) {
    const bx = ix + ((i * 0.5 + 0.25) * iw);
    const span = Math.max(p, bottom - wall - waterTop - 2 * p);
    const by = bottom - wall - 2 * p - ((t / 12 + i * span * 0.5) % span);
    px(ctx, snap(bx, p), snap(by, p), p, p, WATER_LIGHT);
  }

  // ladder from the rim down to the ground
  const L = pool.ladder;
  const top = r.y - p * 2;
  px(ctx, L.x1 - p, top - p, p * 3, (L.y2 - top) + p, INK);
  px(ctx, L.x2 - 2 * p, top - p, p * 3, (L.y2 - top) + p, INK);
  px(ctx, L.x1, top, p, L.y2 - top, METAL);
  px(ctx, L.x2 - p, top, p, L.y2 - top, METAL);
  for (let y = top + 2 * p; y < L.y2; y += 3 * p) px(ctx, L.x1 + p, y, L.x2 - L.x1 - 2 * p, p, METAL_DARK);
  // hand rail over the rim
  const hx1 = pool.ladderSide === "right" ? r.x + r.w - wall : L.x1;
  const hx2 = pool.ladderSide === "right" ? L.x2 : r.x + wall;
  px(ctx, hx1, top - p, hx2 - hx1, 3 * p, INK);
  px(ctx, hx1, top, hx2 - hx1, p, METAL);
}

/* ---------- mushroom (erasers, balls...) ---------- */

/** A bouncy mushroom filling `r`. `squash` 0..1 flattens it right after a bounce. */
export function drawMushroom(ctx: CanvasRenderingContext2D, r0: Rect, p: number, squash: number): void {
  const r = { ...r0, y: r0.y + r0.h * 0.2 * squash, h: r0.h * (1 - 0.2 * squash) };
  const capH = Math.max(2 * p, snap(r.h * 0.58, p));
  const cx = r.x + r.w / 2;

  // stem
  const stemW = Math.max(2 * p, snap(r.w * 0.42, p));
  const stemX = snap(cx - stemW / 2, p);
  const stemTop = r.y + capH - p;
  px(ctx, stemX - p, stemTop, stemW + 2 * p, r.y + r.h - stemTop + p, INK);
  px(ctx, stemX, stemTop, stemW, r.y + r.h - stemTop, CREAM);
  px(ctx, stemX + stemW - p, stemTop, p, r.y + r.h - stemTop, STEM_SHADE);
  // little face
  const eyeY = stemTop + Math.max(p, snap((r.y + r.h - stemTop) * 0.35, p));
  px(ctx, stemX + snap(stemW * 0.25, p), eyeY, p, p, INK);
  px(ctx, stemX + stemW - snap(stemW * 0.25, p) - p, eyeY, p, p, INK);

  // dome cap, row by row
  for (let y = 0; y < capH; y += p) {
    const f = 1 - (capH - y) / capH; // 0 at the very top
    const half = (r.w / 2) * Math.sqrt(Math.max(0.08, 1 - (1 - f) * (1 - f)));
    const x1 = snap(cx - half, p);
    const x2 = snap(cx + half, p) + p;
    px(ctx, x1 - p, r.y + y, x2 - x1 + 2 * p, p, INK);
    px(ctx, x1, r.y + y, x2 - x1, p, y >= capH - 2 * p ? CAP_SHADE : CAP);
  }
  px(ctx, snap(cx - r.w * 0.3, p), r.y - p, snap(r.w * 0.6, p), p, INK);
  // spots
  const spots: [number, number, number][] = [[-0.25, 0.35, 0.16], [0.18, 0.25, 0.2], [0.05, 0.62, 0.12]];
  for (const [ox, oy, s] of spots) {
    const sw = Math.max(p, snap(r.w * s, p));
    px(ctx, snap(cx + ox * r.w, p), snap(r.y + oy * capH, p), sw, Math.max(p, snap(sw * 0.7, p)), CREAM);
  }
}

/* ---------- grass on top of plain desk objects ---------- */

export function drawGrassTop(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, p: number): void {
  px(ctx, x1, y - p, x2 - x1, p, INK);
  px(ctx, x1, y, x2 - x1, p, GRASS);
  px(ctx, x1, y + p, x2 - x1, p, GRASS_DARK);
  for (let x = snap(x1, p) + p; x < x2 - p; x += 4 * p) {
    px(ctx, x, y - 2 * p, p, p, GRASS);
    px(ctx, x + 2 * p, y + 2 * p, p, p, GRASS_DARK);
  }
}

/* ---------- branches, clouds, floating leaves ---------- */

export function drawBranch(ctx: CanvasRenderingContext2D, s: Surface, p: number, H: number): void {
  const w = s.x2 - s.x1;
  px(ctx, s.x1, s.y - p, w, 4 * p, INK);
  px(ctx, s.x1, s.y, w, p, BARK_LIGHT);
  px(ctx, s.x1, s.y + p, w, p, BARK);
  px(ctx, s.x1, s.y + 2 * p, w, p, BARK_DARK);
  // trunk at the map edge
  if (s.side) {
    const tx = s.side === "left" ? s.x1 : s.x2 - 3 * p;
    px(ctx, tx - p, 0, 5 * p, Math.min(H, s.y + 8 * p), INK);
    px(ctx, tx, 0, 3 * p, Math.min(H, s.y + 8 * p), BARK);
    px(ctx, tx + p, 0, p, Math.min(H, s.y + 8 * p), BARK_DARK);
  }
  // leaf clusters along it
  for (let x = snap(s.x1, p) + 2 * p; x < s.x2 - 3 * p; x += 7 * p) {
    px(ctx, x - p, s.y - 3 * p, 4 * p, 3 * p, INK);
    px(ctx, x, s.y - 2 * p, 2 * p, 2 * p, LEAF);
    px(ctx, x, s.y - 2 * p, p, p, LEAF_LIGHT);
    px(ctx, x + 2 * p, s.y + 3 * p, 2 * p, 2 * p, LEAF_DARK);
  }
}

export function drawCloud(ctx: CanvasRenderingContext2D, s: Surface, p: number): void {
  const w = s.x2 - s.x1;
  px(ctx, s.x1 - p, s.y - p, w + 2 * p, 4 * p, INK);
  px(ctx, s.x1, s.y, w, 2 * p, CLOUD);
  px(ctx, s.x1, s.y + 2 * p, w, p, CLOUD_SHADE);
  // puffs on top
  for (let x = snap(s.x1, p) + p; x < s.x2 - 4 * p; x += 5 * p) {
    px(ctx, x - p, s.y - 3 * p, 5 * p, 3 * p, INK);
    px(ctx, x, s.y - 2 * p, 3 * p, 3 * p, CLOUD);
  }
}

export function drawPad(ctx: CanvasRenderingContext2D, s: Surface, p: number): void {
  const w = s.x2 - s.x1;
  px(ctx, s.x1, s.y - p, w, 4 * p, INK);
  px(ctx, s.x1 + p, s.y, w - 2 * p, p, LEAF_LIGHT);
  px(ctx, s.x1 + p, s.y + p, w - 2 * p, p, LEAF);
  px(ctx, s.x1 + 2 * p, s.y + 2 * p, w - 4 * p, p, LEAF_DARK);
  px(ctx, s.x1 + p, s.y + p, w - 2 * p, Math.max(1, p / 3), LEAF_DARK); // vein
}

/* ---------- ground ---------- */

export function drawGround(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number, p: number): void {
  px(ctx, 0, groundY - p, W, p, INK);
  px(ctx, 0, groundY, W, p, GRASS);
  px(ctx, 0, groundY + p, W, p, GRASS_DARK);
  px(ctx, 0, groundY + 2 * p, W, H - groundY - 2 * p, DIRT);
  for (let x = 0; x < W; x += 6 * p) {
    px(ctx, x + 2 * p, groundY - 2 * p, p, p, GRASS);
    px(ctx, x + 4 * p, groundY + 4 * p, 2 * p, p, DIRT_DARK);
  }
}

/* ---------- seeds ---------- */

/** A golden seed to collect, bobbing above (x, y). */
export function drawSeed(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, t: number): void {
  const by = snap(y - 3 * p + Math.sin(t / 300 + x) * p, p);
  const bx = snap(x, p);
  px(ctx, bx - 2 * p, by - 4 * p, 4 * p, 5 * p, INK);
  px(ctx, bx - p, by - 3 * p, 2 * p, 3 * p, YELLOW);
  px(ctx, bx - p, by - 3 * p, p, p, YELLOW_LIGHT);
  px(ctx, bx, by - 5 * p, p, p, LEAF_DARK); // little sprout
  if (Math.floor(t / 250) % 3 === 0) {
    px(ctx, bx + 2 * p, by - 5 * p, p, p, CREAM);
  }
}

/* ---------- the garden sprite (the player) ---------- */

const SPROUT_ROWS = [
  "..oo....oo..",
  ".olloooLLLo.",
  ".ollllsLLLo.",
  "..oooosoooo.",
  ".....oso....",
  "..oooooooo..",
  ".obbbbbbbbo.",
  "obbhhbbbbbbo",
  "obbwkbbwkbbo",
  "obpbbbbbbpbo",
  "obbbbkkbbbbo",
  ".osbbbbbbso.",
  "..osssssso..",
];
const FEET = ["..oo....oo..", "...oo..oo...", ".oo......oo."];
const SPROUT_COLORS: Record<string, string> = {
  o: INK,
  l: LEAF,
  L: LEAF_DARK,
  s: STALK,
  b: "#bff59a",
  h: "#ecffd8",
  w: CREAM,
  k: INK,
  p: PINK,
};
const sproutCache = new Map<number, HTMLCanvasElement>();

function sproutCanvas(frame: number): HTMLCanvasElement {
  const cached = sproutCache.get(frame);
  if (cached) return cached;
  const rows = [...SPROUT_ROWS, FEET[frame] ?? FEET[0]!];
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = rows.length;
  const ctx = c.getContext("2d")!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = SPROUT_COLORS[row[x] ?? "."];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  sproutCache.set(frame, c);
  return c;
}

export const SPROUT_ART_ROWS = SPROUT_ROWS.length + 1;

/**
 * The garden sprite, feet at (x, y), `height` canvas pixels tall.
 * `frame`: 0 standing, 1/2 walking. `facing`: 1 right, -1 left.
 */
export function drawSprout(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  frame: number,
  facing: number,
  bob: number,
): void {
  const c = sproutCanvas(frame);
  const scale = Math.max(1, Math.round(height / c.height));
  const w = c.width * scale;
  const h = c.height * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y - h + bob * scale));
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(c, -w / 2, 0, w, h);
  ctx.restore();
}
