import type { Rgb, SpriteColors } from "../lib/deskSprites";
import { INK, blob, drawBridge, px, snap, sparkle, type Rect } from "./art";
import { riverLayout, rockLadder } from "./level";
import type { ObjectKind } from "./materials";

/* ------------------------------------------------------------------
   The garden-castle pieces desk objects turn into. Each piece fills the object's rect
   (its real size on camera) and takes its colors from the real object, but is drawn as
   whimsical pixel art matching the backdrop: a gray can becomes a gray stone tower with
   a vine crawling up it, a blue mug a stone pool, a yellow pencil a wooden bridge with yellow
   trim, a pink eraser a pink-capped mushroom...

   Every function draws at art-pixel size `p` and animates with time `t` (ms).
   ------------------------------------------------------------------ */

/** Four tones of the object's own color: lit, base, shaded, deep shadow. */
export type Tones = { hi: string; mid: string; lo: string; deep: string };

const css = (c: Rgb): string => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const INK_RGB: Rgb = [43, 29, 58];
const STONE_GRAY: SpriteColors = { body: [150, 150, 165], shade: [105, 105, 125], highlight: [195, 195, 208] };

export function tonesOf(c: SpriteColors | null | undefined): Tones {
  const col = c ?? STONE_GRAY;
  return { hi: css(col.highlight), mid: css(col.body), lo: css(col.shade), deep: css(mix(col.shade, INK_RGB, 0.5)) };
}

const GRASS_HI = "#a8f070";
const GRASS = "#6ccf4a";
const GRASS_LO = "#3f9e45";
const LEAF = "#5cbf5a";
const LEAF_DARK = "#2f7d3f";
const DIRT = "#8f5a32";
const DIRT_LO = "#6b4228";
const DIRT_DEEP = "#4e2e1c";
const WOOD = "#a8703f";
const WOOD_LO = "#7a4a2a";
const WOOD_HI = "#c99a6a";
const WATER = "#3f8fe0";
const WATER_MID = "#5cb2f4";
const WATER_HI = "#a8e0ff";
const CREAM = "#fff7e6";
const YELLOW = "#ffd84a";
const YELLOW_HI = "#fff0a0";
const PINK = "#ff86a8";
const METAL = "#9aa0b4";
const METAL_LO = "#5e6278";
const GLOW = "#ffcf5a";

/** Filled ellipse, row by row on the art grid. */
function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, p: number, color: string): void {
  for (let dy = -ry; dy <= ry; dy += p) {
    const half = snap(rx * Math.sqrt(Math.max(0, 1 - (dy / Math.max(1, ry)) ** 2)) + p / 2, p);
    px(ctx, snap(cx, p) - half, snap(cy + dy, p), half * 2, p, color);
  }
}

/** Stone bricks in the object's colors over `r`; `round` shades it like a cylinder. */
function bricks(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones, round: boolean): void {
  px(ctx, r.x, r.y, r.w, r.h, T.mid);
  const bh = 3 * p;
  const bw = 5 * p;
  for (let y = r.y, row = 0; y < r.y + r.h; y += bh, row++) {
    const off = row % 2 ? Math.round(bw / 2 / p) * p : 0;
    px(ctx, r.x, y + bh - p, r.w, p, T.lo); // mortar
    for (let x = r.x - off; x < r.x + r.w; x += bw) {
      if (x > r.x) px(ctx, x, y, p, bh - p, T.lo);
      px(ctx, Math.max(r.x, x + p), y, Math.min(bw - 2 * p, r.x + r.w - x - p), p, T.hi); // lit top of each brick
    }
  }
  if (round) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    px(ctx, r.x, r.y, Math.max(p, snap(r.w * 0.2, p)), r.h, "#ffffff");
    ctx.globalAlpha = 0.3;
    const sw = Math.max(p, snap(r.w * 0.25, p));
    px(ctx, r.x + r.w - sw, r.y, sw, r.h, T.deep);
    ctx.restore();
  }
}

/** Grassy top edge with blade tips and a few flowers in `flower` color. */
function grassTop(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, p: number, flower: string): void {
  px(ctx, x1 - p, y - p, x2 - x1 + 2 * p, p, INK);
  px(ctx, x1, y, x2 - x1, p, GRASS_HI);
  px(ctx, x1, y + p, x2 - x1, 2 * p, GRASS);
  px(ctx, x1, y + 3 * p, x2 - x1, p, GRASS_LO);
  for (let x = snap(x1, p), i = 0; x < x2 - p; x += p, i++) {
    const n = (i * 7919) % 11;
    if (n < 3) px(ctx, x, y - 2 * p, p, p, n === 0 ? GRASS_HI : GRASS);
    if (n === 5) px(ctx, x, y + 4 * p, p, 2 * p, GRASS_LO); // hanging grass
    if (n === 8 && x2 - x1 > 10 * p) {
      px(ctx, x, y - 3 * p, p, 2 * p, GRASS_LO);
      px(ctx, x - p, y - 4 * p, 3 * p, p, flower);
      px(ctx, x, y - 5 * p, p, 3 * p, flower);
      px(ctx, x, y - 4 * p, p, p, YELLOW);
    }
  }
}

/** Dirt body with cobbles, its bottom edge tapering into a ragged point like a floating island. */
function earth(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const cols = Math.max(1, Math.round(r.w / p));
  for (let i = 0; i < cols; i++) {
    const x = r.x + i * p;
    const edge = Math.min(i, cols - 1 - i) / Math.max(1, cols / 2); // 0 at the sides, 1 in the middle
    const ragged = ((i * 7919) % 5) * p * 0.4;
    const h = Math.max(p, snap(r.h * (0.55 + 0.45 * Math.sqrt(edge)) - ragged, p));
    px(ctx, x, r.y, p, h + p, INK);
    px(ctx, x, r.y, p, h, DIRT);
    if (h > 3 * p) px(ctx, x, r.y + h - 2 * p, p, 2 * p, DIRT_LO);
  }
  // cobbles, some in the object's own color
  for (let y = r.y + 3 * p, row = 0; y < r.y + r.h * 0.7; y += 4 * p, row++) {
    for (let x = r.x + (row % 2) * 3 * p + p; x < r.x + r.w - 4 * p; x += 6 * p) {
      const own = ((x / p + row) | 0) % 3 === 0;
      px(ctx, x, y, 4 * p, 3 * p, DIRT_DEEP);
      px(ctx, x + p, y, 2 * p, 2 * p, own ? T.mid : DIRT_LO);
      px(ctx, x + p, y, p, p, own ? T.hi : WOOD_LO);
    }
  }
}

/** Little vines hanging down from an edge. */
function hangingVines(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, maxLen: number, p: number, t: number): void {
  for (let x = snap(x1, p) + 2 * p, i = 0; x < x2 - 2 * p; x += 7 * p, i++) {
    const len = Math.min(maxLen, ((i * 37) % 5 + 2) * 2 * p);
    const sway = Math.round(Math.sin(t / 700 + i)) * (len > 6 * p ? p : 0);
    for (let d = 0; d < len; d += p) px(ctx, x + (d > len / 2 ? sway : 0), y + d, p, p, (d / p) % 3 === 2 ? LEAF : LEAF_DARK);
  }
}

/* ---------- can -> stone tower with vines crawling up ---------- */

export function drawTower(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const cren = Math.max(2 * p, snap(Math.min(r.h * 0.12, 4 * p), p));
  const wallTop = r.y + cren;
  const bottom = r.y + r.h;
  // outline, crenellations, then the brick wall
  px(ctx, r.x - p, wallTop - p, r.w + 2 * p, bottom - wallTop + p, INK);
  const mw = Math.max(2 * p, snap(r.w / 5, p));
  for (let x = r.x, i = 0; x < r.x + r.w; x += mw, i++) {
    if (i % 2) continue;
    const w = Math.min(mw, r.x + r.w - x);
    px(ctx, x - p, r.y - p, w + 2 * p, cren + p, INK);
    px(ctx, x, r.y, w, cren, T.mid);
    px(ctx, x, r.y, w, p, T.hi);
  }
  px(ctx, r.x, wallTop, r.w, p, T.hi);
  bricks(ctx, { x: r.x, y: wallTop + p, w: r.w, h: bottom - wallTop - p }, p, T, true);

  const cx = snap(r.x + r.w / 2, p);
  // arched window with a warm flickering light
  if (r.h > 26 * p && r.w > 7 * p) {
    const wy = snap(wallTop + r.h * 0.22, p);
    px(ctx, cx - 2 * p, wy - p, 4 * p, 7 * p, INK);
    px(ctx, cx - p, wy - 2 * p, 2 * p, p, INK);
    const lit = Math.sin(t / 380) + Math.sin(t / 170) > -0.6;
    px(ctx, cx - p, wy, 2 * p, 5 * p, lit ? GLOW : "#7a5a3a");
    px(ctx, cx - p, wy - p, 2 * p, p, lit ? YELLOW_HI : "#7a5a3a");
  }
  // arched wooden door at the bottom
  if (r.h > 16 * p && r.w > 7 * p) {
    const dh = Math.min(7 * p, snap(r.h * 0.22, p));
    px(ctx, cx - 3 * p, bottom - dh - p, 6 * p, dh + p, INK);
    px(ctx, cx - 2 * p, bottom - dh - 2 * p, 4 * p, p, INK);
    px(ctx, cx - 2 * p, bottom - dh, 4 * p, dh, WOOD);
    px(ctx, cx - 2 * p, bottom - dh - p, 4 * p, p, WOOD_HI);
    px(ctx, cx, bottom - dh, p, dh, WOOD_LO);
    px(ctx, cx + p, bottom - snap(dh / 2, p), p, p, YELLOW);
  }
  // flag waving on top, in the object's own lit color
  const pole = r.y - 9 * p;
  px(ctx, cx - p, pole - p, 3 * p, 10 * p, INK);
  px(ctx, cx, pole, p, 9 * p, METAL);
  const wave = Math.floor(t / 220) % 2;
  blob(ctx, cx + p, pole + wave * p, 5 * p, 3 * p, p, T.hi);
  px(ctx, cx + 4 * p, pole + (1 - wave) * p, 2 * p, 2 * p, T.hi);
  px(ctx, cx + 3 * p, pole + p + wave * p, p, p, YELLOW);
}

/** A vine winding up the tower (drawn after it), with leaves that sway. */
export function drawCrawlingVines(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number): void {
  const turn = Math.max(10 * p, r.w * 1.6);
  for (const phase of [0]) {
    const xAt = (y: number): number => snap(r.x + r.w / 2 + Math.sin(((y - r.y) / turn) * Math.PI * 2 + phase) * (r.w / 2 - p), p);
    const start = r.y + r.h * 0.05;
    for (let y = start; y < r.y + r.h; y += p) px(ctx, xAt(y) - p, y, 2 * p, p, INK);
    for (let y = start; y < r.y + r.h; y += p) px(ctx, xAt(y), y, p, p, LEAF_DARK);
    let side = 1;
    for (let y = start + 3 * p; y < r.y + r.h - p; y += 5 * p) {
      const sway = Math.round(Math.sin(t / 600 + y)) * p;
      const x = xAt(y) + side * p + (side > 0 ? 0 : -p) + sway;
      blob(ctx, x, y, 2 * p, p, p, LEAF);
      px(ctx, x, y, p, p, GRASS_HI);
      side = -side;
    }
  }
}

/* ---------- mug -> round stone pool ---------- */

/** A stone pool seen in cutaway: thick stone sides in the mug's colors, water inside, a lily pad. */
export function drawPoolBasin(ctx: CanvasRenderingContext2D, r: Rect, wall: number, waterTop: number, p: number, t: number, T: Tones): void {
  const bottom = r.y + r.h;
  wall = Math.max(2 * p, snap(wall, p));
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p, INK);
  // back wall inside (darker), then the water
  px(ctx, r.x + wall, r.y, r.w - 2 * wall, bottom - wall - r.y, T.deep);
  px(ctx, r.x + wall, waterTop, r.w - 2 * wall, bottom - wall - waterTop, WATER);
  px(ctx, r.x + wall, waterTop, r.w - 2 * wall, 2 * p, WATER_MID);
  const shift = Math.floor(t / 160) % 6;
  for (let x = r.x + wall, i = 0; x < r.x + r.w - wall; x += p, i++) {
    if ((i + shift) % 6 === 0) px(ctx, x, waterTop - p, 2 * p, p, WATER_HI);
    if ((i * 7 + shift) % 13 === 0) px(ctx, x, waterTop + 4 * p + ((i * 3) % 5) * p, 2 * p, p, WATER_MID);
  }
  // bubbles rising
  for (let i = 0; i < 3; i++) {
    const span = Math.max(p, bottom - wall - waterTop - 3 * p);
    const by = bottom - wall - 2 * p - ((t / 16 + i * span * 0.37) % span);
    px(ctx, snap(r.x + wall + ((i + 0.6) / 3.4) * (r.w - 2 * wall), p), snap(by, p), p, p, WATER_HI);
  }
  // stone sides and floor in the mug's colors, with a lit rim on top
  bricks(ctx, { x: r.x, y: r.y, w: wall, h: r.h }, p, T, false);
  bricks(ctx, { x: r.x + r.w - wall, y: r.y, w: wall, h: r.h }, p, T, false);
  bricks(ctx, { x: r.x + wall, y: bottom - wall, w: r.w - 2 * wall, h: wall }, p, T, false);
  px(ctx, r.x, r.y, wall, p, T.hi);
  px(ctx, r.x + r.w - wall, r.y, wall, p, T.hi);
  // a lily pad with a flower bobbing on the water
  if (r.w - 2 * wall > 10 * p) {
    const lx = snap(r.x + wall + (r.w - 2 * wall) * 0.3 + Math.sin(t / 900) * p, p);
    const ly = waterTop - p + (Math.floor(t / 600) % 2) * p;
    blob(ctx, lx, ly, 4 * p, p, p, LEAF);
    px(ctx, lx + p, ly - p, 2 * p, p, PINK);
  }
}

/* ---------- bowl -> stone basin of lava ---------- */

export function drawLavaBasin(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const rim = Math.max(2 * p, snap(r.w * 0.12, p));
  const lavaTop = snap(r.y + r.h * 0.15, p);
  const bottom = r.y + r.h;
  // basin: a wide bowl shape in the object's colors
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + p, INK);
  for (let y = r.y; y < bottom; y += p) {
    const f = (y - r.y) / r.h;
    const inset = snap(r.w * 0.12 * f * f, p);
    px(ctx, r.x + inset, y, r.w - 2 * inset, p, f > 0.85 ? T.lo : T.mid);
    px(ctx, r.x + inset, y, p, p, T.hi);
  }
  px(ctx, r.x, r.y, r.w, p, T.hi);
  // lava
  const lw = r.w - 2 * rim;
  const depth = Math.max(3 * p, snap(r.h * 0.4, p));
  px(ctx, r.x + rim, lavaTop, lw, depth, "#e8432e");
  px(ctx, r.x + rim, lavaTop, lw, p, YELLOW);
  px(ctx, r.x + rim, lavaTop + p, lw, p, "#ff8a2a");
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 900 + i * 0.37) % 1 + 1) % 1;
    const bx = snap(r.x + rim + ((i * 0.31 + 0.2) % 1) * lw, p);
    const size = ph < 0.8 ? Math.ceil(ph * 3) * p : 0;
    if (size > 0) blob(ctx, bx, lavaTop - size + p, size, size, p, "#ff8a2a");
    else sparkle(ctx, bx, lavaTop - 2 * p, p, YELLOW);
  }
  // glow and embers
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.06 * Math.sin(t / 300);
  px(ctx, r.x + rim, lavaTop - 5 * p, lw, 5 * p, "#ff8a2a");
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const f = ((t / 1500 + i / 4) % 1 + 1) % 1;
    px(ctx, snap(r.x + rim + ((i * 0.27 + 0.1) % 1) * lw, p), snap(lavaTop - f * 12 * p, p), p, p, f < 0.5 ? YELLOW : "#ff8a2a");
  }
}

/* ---------- scissors -> row of cone spikes on a grassy ledge ---------- */

export function drawSpikeRow(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const baseH = Math.max(4 * p, snap(r.h * 0.35, p));
  const baseY = r.y + r.h - baseH;
  earth(ctx, { x: r.x, y: baseY + 3 * p, w: r.w, h: baseH - 3 * p }, p, T);
  grassTop(ctx, r.x, r.x + r.w, baseY, p, T.hi);
  const spikeH = Math.max(4 * p, snap(r.h - baseH, p));
  const sw = Math.max(4 * p, snap(Math.min(spikeH * 0.6, 7 * p), p));
  const n = Math.max(1, Math.floor(r.w / sw));
  const x0 = r.x + snap((r.w - n * sw) / 2, p);
  const glint = Math.floor(t / 110) % (n + 6);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * sw;
    for (let y = 0; y < spikeH; y += p) {
      const half = Math.max(p / 2, ((sw / 2) * (y + p)) / spikeH);
      const left = snap(x + sw / 2 - half, p);
      const w = Math.max(p, snap(half * 2, p));
      px(ctx, left - p, baseY - spikeH + y, w + 2 * p, p, INK);
      px(ctx, left, baseY - spikeH + y, w, p, T.lo);
      px(ctx, left, baseY - spikeH + y, Math.max(p, snap(w / 2, p)), p, i === glint && y < spikeH / 2 ? CREAM : T.hi);
    }
  }
}

/* ---------- pencil -> stone arch bridge ---------- */

export function drawArchBridge(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const deck = Math.max(3 * p, snap(Math.min(r.h, 5 * p), p));
  // parapet blocks
  for (let x = r.x, i = 0; x < r.x + r.w - p; x += 4 * p, i++) {
    blob(ctx, x, r.y - 2 * p, 3 * p, 2 * p, p, i % 2 ? T.mid : T.hi);
  }
  bricks(ctx, { x: r.x, y: r.y, w: r.w, h: deck }, p, T, false);
  px(ctx, r.x - p, r.y + deck, r.w + 2 * p, p, INK);
  // arch underneath, if there's room
  const below = r.h - deck;
  if (below > 4 * p) {
    const pier = Math.max(3 * p, snap(r.w * 0.12, p));
    bricks(ctx, { x: r.x, y: r.y + deck, w: pier, h: below }, p, T, false);
    bricks(ctx, { x: r.x + r.w - pier, y: r.y + deck, w: pier, h: below }, p, T, false);
    const span = r.w - 2 * pier;
    for (let x = 0; x < span; x += p) {
      const f = (x / span) * 2 - 1;
      const archH = snap(below * 0.6 * (1 - Math.sqrt(Math.max(0, 1 - f * f))) + p, p);
      px(ctx, r.x + pier + x, r.y + deck, p, archH + p, INK);
      px(ctx, r.x + pier + x, r.y + deck, p, archH, x % (3 * p) === 0 ? T.lo : T.mid);
    }
  }
}

/* ---------- phone -> rock wall with a ladder ---------- */

/** A rugged rock face in the phone's colors, a grassy top, and a wooden ladder up one side. */
export function drawRockFace(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, r.h, T.lo);
  // irregular boulders packed together, lit from the top-left
  for (let y = r.y, row = 0; y < r.y + r.h; row++) {
    const rh = (3 + ((row * 5) % 3)) * p;
    for (let x = r.x - ((row * 3) % 4) * p, k = 0; x < r.x + r.w; k++) {
      const rw = (4 + ((row * 7 + k * 3) % 4)) * p;
      const x1 = Math.max(r.x, x + p);
      const w = Math.min(rw - p, r.x + r.w - x1);
      const h = Math.min(rh - p, r.y + r.h - y - p);
      if (w > 0 && h > 0) {
        px(ctx, x1, y, w, h, T.mid);
        px(ctx, x1, y, w, p, T.hi);
        px(ctx, x1, y, p, h, T.hi);
        if (h > 2 * p) px(ctx, x1 + w - p, y + p, p, h - p, T.deep);
      }
      x += rw;
    }
    y += rh;
  }
  // moss patches
  for (let i = 0; i < Math.max(1, Math.floor((r.w * r.h) / (90 * p * p))); i++) {
    const mx = snap(r.x + ((i * 0.618 + 0.2) % 1) * r.w, p);
    const my = snap(r.y + ((i * 0.381 + 0.3) % 1) * r.h, p);
    px(ctx, mx, my, 2 * p, p, LEAF);
    px(ctx, mx + p, my - p, p, p, GRASS);
  }
  // grassy top and a few flowers
  grassTop(ctx, r.x, r.x + r.w, r.y, p, T.hi);
  // wooden ladder up the left part of the face
  const ladder = rockLadder(r.x, r.w); // the same strip the game lets you climb
  const lx = snap(ladder.x1, p);
  const lw = Math.max(3 * p, snap(ladder.x2 - ladder.x1, p));
  for (const x of [lx, lx + lw - p]) {
    px(ctx, x - p, r.y - 3 * p, 3 * p, r.h + 3 * p, INK);
    px(ctx, x, r.y - 3 * p, p, r.h + 3 * p, WOOD_HI);
  }
  for (let y = r.y - p; y < r.y + r.h; y += 3 * p) {
    px(ctx, lx + p, y - p, lw - 2 * p, 3 * p, INK);
    px(ctx, lx + p, y, lw - 2 * p, p, WOOD);
  }
  // a pebble tumbling now and then
  const f = (t / 2400) % 1;
  if (f < 0.3) px(ctx, snap(r.x + r.w * 0.75, p), snap(r.y + f * r.h * 3, p), p, p, T.hi);
}

/* ---------- pencil -> wooden bridge ---------- */

/** A plank bridge with rails and posts, trimmed in the pencil's own color. */
export function drawWoodBridge(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const deckH = Math.max(3 * p, snap(Math.min(r.h, 4 * p), p));
  // deck planks
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, deckH + 2 * p, INK);
  for (let x = r.x, i = 0; x < r.x + r.w; x += 3 * p, i++) {
    const w = Math.min(3 * p, r.x + r.w - x);
    px(ctx, x, r.y, w, deckH, i % 2 ? WOOD : WOOD_HI);
    px(ctx, x + w - p, r.y, p, deckH, WOOD_LO);
    if (i % 4 === 1) px(ctx, x + p, r.y + p, p, p, DIRT_DEEP); // nail
  }
  px(ctx, r.x, r.y + deckH - p, r.w, p, T.lo); // trim in the pencil's color
  // posts and a hand rail above the deck
  const postH = 6 * p;
  const step = Math.max(8 * p, snap(r.w / Math.max(1, Math.round(r.w / (14 * p))), p));
  for (let x = r.x; x <= r.x + r.w - 2 * p; x += step) {
    px(ctx, x - p, r.y - postH - p, 4 * p, postH + p, INK);
    px(ctx, x, r.y - postH, 2 * p, postH, WOOD);
    px(ctx, x, r.y - postH, p, postH, WOOD_HI);
    px(ctx, x, r.y - postH - p, 2 * p, p, T.hi); // little caps in the pencil's color
  }
  px(ctx, r.x, r.y - postH + p, r.w, p, INK);
  px(ctx, r.x, r.y - postH + 2 * p, r.w, p, WOOD_HI);
  // supports underneath, if the pencil is thick enough
  if (r.h > deckH + 3 * p) {
    for (const f of [0.2, 0.8]) {
      const x = snap(r.x + r.w * f, p);
      px(ctx, x - p, r.y + deckH, 3 * p, r.h - deckH, INK);
      px(ctx, x, r.y + deckH, p, r.h - deckH, WOOD_LO);
    }
  }
}

/* ---------- sticky note -> jello blob ---------- */

/** A wobbly, see-through jello blob in the sticky note's own color (you wade through it slowly). */
export function drawJello(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const bottom = r.y + r.h;
  const cols = Math.max(1, Math.round(r.w / p));
  // the top wobbles like jello; the sides round off near the bottom corners
  const topAt = (i: number): number => {
    const f = i / Math.max(1, cols - 1);
    const round = (1 - Math.sin(f * Math.PI)) * Math.min(r.h * 0.3, 4 * p);
    return snap(r.y + round + Math.sin(t / 260 + f * 5) * p * 0.9, p);
  };
  for (let i = 0; i < cols; i++) {
    const x = r.x + i * p;
    const top = topAt(i);
    px(ctx, x, top - p, p, bottom - top + 2 * p, INK);
  }
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < cols; i++) {
    const x = r.x + i * p;
    const top = topAt(i);
    px(ctx, x, top, p, bottom - top, T.mid);
    px(ctx, x, bottom - 3 * p, p, 3 * p, T.lo);
    if (i > 1 && i < cols * 0.35) px(ctx, x, top + p, p, p, T.hi);
  }
  ctx.restore();
  // shine, bubbles drifting up inside, and a sleepy little face
  const sx = snap(r.x + r.w * 0.2, p);
  px(ctx, sx, topAt(Math.round(cols * 0.2)) + 3 * p, p, Math.max(p, snap(r.h * 0.3, p)), CREAM);
  for (let i = 0; i < 3; i++) {
    const span = Math.max(p, r.h - 6 * p);
    const by = bottom - 3 * p - ((t / 30 + i * span * 0.37) % span);
    px(ctx, snap(r.x + ((i + 0.6) / 3.4) * r.w, p), snap(by, p), p, p, T.hi);
  }
  if (r.w > 10 * p && r.h > 8 * p) {
    const cx = snap(r.x + r.w / 2, p);
    const ey = snap(r.y + r.h * 0.45, p);
    px(ctx, cx - 3 * p, ey, 2 * p, p, INK);
    px(ctx, cx + p, ey, 2 * p, p, INK);
    px(ctx, cx - p, ey + 2 * p, 2 * p, p, INK);
  }
}

/* ---------- spoon / fork -> a thin rail ---------- */

/** A thin metal rail in the utensil's own color, with rivets and end caps. */
export function drawRail(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const y = snap(r.y, p);
  px(ctx, r.x - p, y - p, r.w + 2 * p, 4 * p, INK);
  px(ctx, r.x, y, r.w, p, T.hi);
  px(ctx, r.x, y + p, r.w, p, T.mid);
  px(ctx, r.x, y + 2 * p, r.w, p, T.lo);
  for (let x = r.x + 3 * p; x < r.x + r.w - 2 * p; x += 6 * p) px(ctx, snap(x, p), y + p, p, p, CREAM);
  for (const x of [r.x - p, r.x + r.w - 2 * p]) blob(ctx, x, y - p, 3 * p, 4 * p, p, T.lo);
}

/* ---------- eyeglasses -> a river with stepping stones ---------- */

/** A flowing river with stepping stones (rimmed in the glasses' own color). Fall in = back to start. */
export function drawRiver(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const { waterTop, stones } = riverLayout(r, p * 2.6);
  const bottom = Math.max(r.y + r.h, waterTop + 6 * p);
  px(ctx, r.x - p, waterTop - p, r.w + 2 * p, bottom - waterTop + 2 * p, INK);
  px(ctx, r.x, waterTop, r.w, bottom - waterTop, WATER);
  px(ctx, r.x, waterTop, r.w, p, WATER_MID);
  // ripples flowing along
  for (let i = 0; i < Math.max(2, r.w / (6 * p)); i++) {
    const f = ((t / 1400 + i * 0.37) % 1 + 1) % 1;
    const x = snap(r.x + f * r.w, p);
    const y = snap(waterTop + 2 * p + ((i * 3) % Math.max(1, Math.floor((bottom - waterTop - 3 * p) / p))) * p, p);
    if (y < bottom - p) px(ctx, x, y, 3 * p, p, WATER_HI);
  }
  // reeds at the banks
  for (const x of [r.x + p, r.x + r.w - 2 * p]) {
    px(ctx, snap(x, p), waterTop - 4 * p, p, 4 * p, LEAF_DARK);
    px(ctx, snap(x, p), waterTop - 5 * p, p, 2 * p, "#8a5a3a");
  }
  // stepping stones, bobbing very slightly
  stones.forEach((st, i) => {
    const bob = Math.floor(t / 600 + i) % 2 === 0 ? 0 : p;
    const x = snap(st.x1, p);
    const w = Math.max(2 * p, snap(st.x2 - st.x1, p));
    blob(ctx, x, snap(st.y, p) + bob, w, 3 * p, p, "#a39fae");
    px(ctx, x, snap(st.y, p) + bob, w, p, "#e2dfe6");
    px(ctx, x, snap(st.y, p) + bob + 2 * p, w, p, T.lo); // a ring in the frames' color
  });
}

/* ---------- plastic water bottle -> an icy patch ---------- */

/** A frosty, slippery patch: you slide across it and can't jump off it. */
export function drawIcePatch(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const h = Math.max(4 * p, snap(Math.min(r.h, 6 * p), p));
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, h + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, h, "#cdeefe");
  ctx.save();
  ctx.globalAlpha = 0.25;
  px(ctx, r.x, r.y, r.w, h, T.mid);
  ctx.restore();
  px(ctx, r.x, r.y, r.w, p, CREAM);
  // frost crystals and a sliding glint
  for (let x = r.x + 2 * p, i = 0; x < r.x + r.w - 2 * p; x += 6 * p, i++) {
    const cx = snap(x, p);
    const cy = snap(r.y + h / 2, p);
    px(ctx, cx - p, cy, 3 * p, p, i % 2 ? WATER_HI : CREAM);
    px(ctx, cx, cy - p, p, 3 * p, i % 2 ? WATER_HI : CREAM);
  }
  for (let x = r.x + p, i = 0; x < r.x + r.w - p; x += 3 * p, i++) px(ctx, x, r.y + h, p, (1 + (i % 3)) * p, WATER_HI);
  const gx = r.x + ((t / 4) % (r.w + 20 * p)) - 10 * p;
  if (gx > r.x && gx < r.x + r.w - 3 * p) px(ctx, snap(gx, p), r.y + p, 3 * p, p, "#ffffff");
}

/* ---------- mouse -> trampoline ---------- */

export function drawTrampolinePiece(ctx: CanvasRenderingContext2D, r: Rect, p: number, squash: number, T: Tones): void {
  const ry = Math.max(2 * p, snap(Math.min(r.h * 0.25, r.w * 0.18), p));
  const cy = r.y + ry;
  const cx = r.x + r.w / 2;
  // legs
  for (const f of [0.15, 0.5, 0.85]) {
    const x = snap(r.x + r.w * f, p);
    px(ctx, x - p, cy, 3 * p, r.y + r.h - cy, INK);
    px(ctx, x, cy, p, r.y + r.h - cy, METAL_LO);
  }
  // rim (object color) and the dark mat, which dips when bounced
  ellipse(ctx, cx, cy, r.w / 2 + p, ry + p, p, INK);
  ellipse(ctx, cx, cy, r.w / 2, ry, p, T.mid);
  ellipse(ctx, cx, cy - p, r.w / 2 - p, ry - p, p, T.hi);
  ellipse(ctx, cx, cy + Math.round(squash * 2) * p, r.w / 2 - 3 * p, Math.max(p, ry - 2 * p), p, "#2b2440");
  for (let x = r.x + 3 * p; x < r.x + r.w - 3 * p; x += 4 * p) px(ctx, snap(x, p), cy + ry, p, p, METAL);
}

/* ---------- eraser -> mushroom ---------- */

export function drawMushroomPiece(ctx: CanvasRenderingContext2D, r0: Rect, p: number, squash: number, T: Tones): void {
  const r = { ...r0, y: r0.y + r0.h * 0.15 * squash, h: r0.h * (1 - 0.15 * squash) };
  const capH = Math.max(3 * p, snap(r.h * 0.6, p));
  const cx = r.x + r.w / 2;
  // stem
  const stemW = Math.max(2 * p, snap(r.w * 0.38, p));
  const sx = snap(cx - stemW / 2, p);
  const stemTop = r.y + capH - p;
  px(ctx, sx - p, stemTop, stemW + 2 * p, r.y + r.h - stemTop + p, INK);
  px(ctx, sx, stemTop, stemW, r.y + r.h - stemTop, CREAM);
  px(ctx, sx + stemW - 2 * p, stemTop, 2 * p, r.y + r.h - stemTop, "#e2d4bc");
  // cap in the object's color
  for (let y = 0; y < capH; y += p) {
    const f = y / capH;
    const half = (r.w / 2) * Math.sqrt(Math.max(0.06, 1 - (1 - f) * (1 - f)));
    const x1 = snap(cx - half, p);
    const x2 = snap(cx + half, p) + p;
    px(ctx, x1 - p, r.y + y, x2 - x1 + 2 * p, p, INK);
    px(ctx, x1, r.y + y, x2 - x1, p, y >= capH - 2 * p ? T.lo : T.mid);
    if (y > 0 && y < capH * 0.55) px(ctx, x1 + p, r.y + y, Math.max(p, snap((x2 - x1) * 0.2, p)), p, T.hi);
  }
  px(ctx, snap(cx - r.w * 0.3, p), r.y - p, snap(r.w * 0.6, p), p, INK);
  for (const [ox, oy, s] of [[-0.24, 0.35, 0.16], [0.16, 0.22, 0.2], [0.04, 0.6, 0.12], [0.3, 0.55, 0.1]] as const) {
    const sw = Math.max(2 * p, snap(r.w * s, p));
    px(ctx, snap(cx + ox * r.w, p), snap(r.y + oy * capH, p), sw, Math.max(p, snap(sw * 0.7, p)), CREAM);
  }
}

/* ---------- plushies & balls -> bouncy berry bush ---------- */

export function drawBerryBush(ctx: CanvasRenderingContext2D, r0: Rect, p: number, t: number, squash: number, T: Tones): void {
  const r = { ...r0, y: r0.y + r0.h * 0.15 * squash, h: r0.h * (1 - 0.15 * squash) };
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  ellipse(ctx, cx, cy + p, r.w / 2 + p, r.h / 2 + p, p, INK);
  ellipse(ctx, cx, cy, r.w / 2, r.h / 2, p, GRASS_LO);
  ellipse(ctx, cx - p, cy - p, r.w / 2 - 2 * p, r.h / 2 - 2 * p, p, LEAF);
  ellipse(ctx, cx - r.w * 0.15, cy - r.h * 0.18, r.w * 0.2, r.h * 0.18, p, GRASS);
  // berries in the object's color, twinkling
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39996;
    const d = Math.sqrt((i + 0.5) / 7) * 0.75;
    const bx = snap(cx + Math.cos(a) * d * (r.w / 2), p);
    const by = snap(cy + Math.sin(a) * d * (r.h / 2), p);
    blob(ctx, bx, by, p * 2, p * 2, p, T.mid);
    if ((Math.floor(t / 400) + i) % 5 === 0) px(ctx, bx, by, p, p, CREAM);
    else px(ctx, bx, by, p, p, T.hi);
  }
}

/* ---------- keyboard -> conveyor ledge ---------- */

export function drawConveyorLedge(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, dir: number, T: Tones): void {
  const belt = Math.max(3 * p, snap(Math.min(r.h * 0.4, 4 * p), p));
  if (r.h > belt + 2 * p) earth(ctx, { x: r.x, y: r.y + belt, w: r.w, h: r.h - belt }, p, T);
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, belt + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, belt, T.lo);
  // slats sliding along in the object's color
  const step = 4 * p;
  const shift = snap(((((t / 16) * dir) % step) + step) % step, p);
  for (let x = r.x + shift - step; x < r.x + r.w; x += step) {
    if (x < r.x) continue;
    px(ctx, x, r.y, Math.min(2 * p, r.x + r.w - x), belt - p, T.mid);
    px(ctx, x, r.y, Math.min(2 * p, r.x + r.w - x), p, T.hi);
  }
  // rollers with an arrow showing the way
  for (const x of [r.x - p, r.x + r.w - 2 * p]) {
    blob(ctx, x, r.y + p, 3 * p, belt - 2 * p, p, METAL);
    px(ctx, x + p, r.y + p, p, p, CREAM);
  }
  const ax = snap(r.x + r.w / 2, p);
  px(ctx, ax, r.y - 3 * p, p, p, YELLOW);
  px(ctx, ax + dir * p, r.y - 2 * p, p, p, YELLOW);
  px(ctx, ax, r.y - p, p, p, YELLOW);
}

/* ---------- lamp -> lantern post ---------- */

export function drawLanternPost(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const cx = snap(r.x + r.w / 2, p);
  const lw = Math.max(4 * p, snap(Math.min(r.w, 10 * p), p));
  const lh = Math.max(5 * p, snap(Math.min(r.h * 0.35, 12 * p), p));
  const ly = r.y + 2 * p;
  // post and foot
  px(ctx, cx - 2 * p, ly + lh, 4 * p, r.y + r.h - ly - lh, INK);
  px(ctx, cx - p, ly + lh, 2 * p, r.y + r.h - ly - lh, T.lo);
  px(ctx, cx - p, ly + lh, p, r.y + r.h - ly - lh, T.mid);
  blob(ctx, cx - 3 * p, r.y + r.h - 2 * p, 6 * p, 2 * p, p, T.lo);
  // lantern: roof, glowing glass, frame in the object's color
  const flicker = 0.8 + 0.2 * Math.sin(t / 130) * Math.sin(t / 310);
  ctx.save();
  ctx.globalAlpha = 0.25 * flicker;
  ellipse(ctx, cx, ly + lh / 2, lw * 1.2, lh, p, GLOW);
  ctx.restore();
  px(ctx, cx - lw / 2 - p, ly - p, lw + 2 * p, lh + 2 * p, INK);
  px(ctx, cx - lw / 2, ly, lw, lh, T.mid);
  px(ctx, cx - lw / 2 + p, ly + p, lw - 2 * p, lh - 2 * p, flicker > 0.85 ? YELLOW_HI : GLOW);
  px(ctx, cx, ly + p, p, lh - 2 * p, T.mid);
  for (let i = 0; i < 3; i++) px(ctx, cx - lw / 2 + i * p, ly - (3 - i) * p, lw - 2 * i * p + p, p, i === 2 ? T.hi : T.lo); // roof
  px(ctx, cx, ly - 4 * p, p, p, INK);
}

/* ---------- bottle -> stone fountain (the geyser erupts out of it) ---------- */

export function drawFountain(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const colW = Math.max(3 * p, snap(r.w * 0.6, p));
  const cx = r.x + r.w / 2;
  const cl = snap(cx - colW / 2, p);
  const basinH = Math.max(3 * p, snap(Math.min(r.h * 0.18, 5 * p), p));
  px(ctx, cl - p, r.y + basinH, colW + 2 * p, r.h - basinH + p, INK);
  bricks(ctx, { x: cl, y: r.y + basinH, w: colW, h: r.h - basinH }, p, T, true);
  // basin on top with water in it
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, basinH + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, basinH, T.mid);
  px(ctx, r.x, r.y, r.w, p, T.hi);
  px(ctx, r.x + p, r.y + p, r.w - 2 * p, p, WATER_MID);
  px(ctx, r.x, r.y + basinH - p, r.w, p, T.lo);
}

/* ---------- candle -> stone brazier (the flame is drawn on top of it) ---------- */

export function drawBrazier(ctx: CanvasRenderingContext2D, r: Rect, p: number, T: Tones): void {
  const colW = Math.max(3 * p, snap(r.w * 0.55, p));
  const cl = snap(r.x + r.w / 2 - colW / 2, p);
  const bowlH = Math.max(2 * p, snap(Math.min(r.h * 0.2, 4 * p), p));
  px(ctx, cl - p, r.y + bowlH, colW + 2 * p, r.h - bowlH + p, INK);
  bricks(ctx, { x: cl, y: r.y + bowlH, w: colW, h: r.h - bowlH }, p, T, true);
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, bowlH + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, bowlH, METAL_LO);
  px(ctx, r.x, r.y, r.w, p, METAL);
  px(ctx, r.x + p, r.y + p, r.w - 2 * p, p, "#ff8a2a");
}

/* ---------- plate -> slab of ice ---------- */

export function drawIceSlab(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  px(ctx, r.x - p, r.y - p, r.w + 2 * p, r.h + 2 * p, INK);
  px(ctx, r.x, r.y, r.w, r.h, "#bfe8ff");
  ctx.save();
  ctx.globalAlpha = 0.25;
  px(ctx, r.x, r.y, r.w, r.h, T.mid); // tinted with the object's color
  ctx.restore();
  px(ctx, r.x, r.y, r.w, p, CREAM); // snow on top
  px(ctx, r.x, r.y + r.h - p, r.w, p, "#8fc8ea");
  // cracks
  for (let x = r.x + 4 * p, i = 0; x < r.x + r.w - 4 * p; x += 9 * p, i++) {
    for (let d = 0; d < Math.min(r.h - 2 * p, 4 * p); d += p) px(ctx, x + ((d / p + i) % 2) * p, r.y + p + d, p, p, "#8fc8ea");
  }
  // icicles below and a glint sliding across
  for (let x = r.x + p, i = 0; x < r.x + r.w - p; x += 4 * p, i++) px(ctx, x, r.y + r.h, p, (1 + (i % 3)) * p, WATER_HI);
  const gx = r.x + ((t / 6) % (r.w + 20 * p)) - 10 * p;
  if (gx > r.x && gx < r.x + r.w - 2 * p) px(ctx, snap(gx, p), r.y + p, 2 * p, p, CREAM);
}

/* ---------- everything else -> grassy floating island ---------- */

export function drawIsland(ctx: CanvasRenderingContext2D, r: Rect, p: number, t: number, T: Tones): void {
  const grassH = 4 * p;
  if (r.h > grassH + p) earth(ctx, { x: r.x, y: r.y + grassH, w: r.w, h: r.h - grassH }, p, T);
  grassTop(ctx, r.x, r.x + r.w, r.y, p, T.hi);
  if (r.h > 10 * p) hangingVines(ctx, r.x, r.x + r.w, r.y + grassH, r.h * 0.5, p, t);
}

/** The piece for `kind` filling `r` (no extras around it: those are drawn by the game). */
export function drawPiece(
  ctx: CanvasRenderingContext2D,
  kind: ObjectKind,
  r: Rect,
  p: number,
  t: number,
  T: Tones,
  extra: { squash?: number; dir?: number; poolWall?: number; poolWaterTop?: number; deckY?: (x: number) => number } = {},
): void {
  const squash = extra.squash ?? 0;
  switch (kind) {
    case "vine":
      drawTower(ctx, r, p, t, T);
      drawCrawlingVines(ctx, r, p, t);
      break;
    case "pool":
      drawPoolBasin(ctx, r, extra.poolWall ?? r.w * 0.1, extra.poolWaterTop ?? r.y + r.h * 0.2, p, t, T);
      break;
    case "lava":
      drawLavaBasin(ctx, r, p, t, T);
      break;
    case "spikes":
      drawSpikeRow(ctx, r, p, t, T);
      break;
    case "stonepath":
      drawArchBridge(ctx, r, p, T);
      break;
    case "woodbridge":
      drawWoodBridge(ctx, r, p, T);
      break;
    case "bridge": {
      // a rope bridge in the cable's color; the game passes the live deck (it sags under you)
      const deckY = extra.deckY ?? ((x: number) => r.y + r.h * 0.3 + Math.sin(((x - r.x) / Math.max(1, r.w)) * Math.PI) * 2 * p);
      drawBridge(ctx, r.x, r.x + r.w, deckY, p, { body: T.mid, shade: T.lo, highlight: T.hi });
      break;
    }
    case "rockwall":
      drawRockFace(ctx, r, p, t, T);
      break;
    case "trampoline":
      drawTrampolinePiece(ctx, r, p, squash, T);
      break;
    case "mushroom":
      drawMushroomPiece(ctx, r, p, squash, T);
      break;
    case "jello":
      drawJello(ctx, r, p, t, T);
      break;
    case "rail":
      drawRail(ctx, r, p, T);
      break;
    case "river":
      drawRiver(ctx, r, p, t, T);
      break;
    case "icepatch":
      drawIcePatch(ctx, r, p, t, T);
      break;
    case "plush":
      drawBerryBush(ctx, r, p, t, squash, T);
      break;
    case "conveyor":
      drawConveyorLedge(ctx, r, p, t, extra.dir ?? 1, T);
      break;
    case "updraft":
      drawLanternPost(ctx, r, p, t, T);
      break;
    case "geyser":
      drawFountain(ctx, r, p, T);
      break;
    case "flame":
      drawBrazier(ctx, r, p, T);
      break;
    case "ice":
      drawIceSlab(ctx, r, p, t, T);
      break;
    default:
      drawIsland(ctx, r, p, t, T);
  }
}

/* ---------- Challenge course pieces ---------- */

const STONE_TONES = tonesOf(null);

/**
 * An added floating ledge: a small grassy island like the desk-object islands. Moving ledges
 * carry little arrow pebbles; crumbling ones are cracked through.
 */
export function drawLedge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  p: number,
  t: number,
  style: "still" | "moving" | "crumbling" = "still",
): void {
  const r = { x: snap(x1, p), y: snap(y, p), w: snap(x2 - x1, p), h: 8 * p };
  drawIsland(ctx, r, p, t, STONE_TONES);
  if (style === "moving") {
    for (const [x, d] of [[r.x + 2 * p, -1], [r.x + r.w - 3 * p, 1]] as const) {
      px(ctx, x, r.y + 5 * p, p, p, CREAM);
      px(ctx, x + d * p, r.y + 4 * p, p, 3 * p, CREAM);
    }
  } else if (style === "crumbling") {
    for (let x = r.x + 3 * p, i = 0; x < r.x + r.w - 2 * p; x += 5 * p, i++) {
      for (let d = 0; d < 5 * p; d += p) px(ctx, x + ((d / p + i) % 2) * p, r.y + 4 * p + d, p, p, DIRT_DEEP);
    }
  }
}

/** The faint outline a crumbled ledge leaves while it grows back. */
export function drawLedgeGhost(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, p: number): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let x = snap(x1, p); x < x2; x += 2 * p) px(ctx, x, snap(y, p), p, p, CREAM);
  ctx.restore();
}

/** A patrolling beetle, feet at (x, y). Knocked out = flipped on its back. */
export function drawBeetle(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, t: number, dir: number, out: boolean): void {
  const cx = snap(x, p);
  const by = snap(y, p);
  const step = Math.floor(t / 120) % 2;
  ctx.save();
  if (out) ctx.globalAlpha = 0.6;
  // legs
  for (const lx of [-3, 0, 3]) px(ctx, cx + lx * p, by - (out ? 5 : 1) * p, p, p + ((lx / 3 + step) % 2 === 0 ? p : 0), INK);
  // shell
  blob(ctx, cx - 4 * p, by - (out ? 4 : 5) * p, 8 * p, 3 * p, p, "#7a4cc2");
  px(ctx, cx - 3 * p, by - (out ? 4 : 5) * p, 3 * p, p, "#b58cff");
  px(ctx, cx, by - (out ? 4 : 5) * p, p, 3 * p, "#4a2a80");
  // head and eyes, facing the way it walks
  if (!out) {
    const hx = cx + dir * 5 * p - (dir > 0 ? 0 : 2 * p);
    blob(ctx, hx, by - 4 * p, 2 * p, 2 * p, p, "#4a2a80");
    px(ctx, hx + (dir > 0 ? p : 0), by - 4 * p, p, p, CREAM);
  }
  ctx.restore();
}

/** A strip of metal floor spikes sitting on the ground. */
export function drawGroundSpikes(ctx: CanvasRenderingContext2D, x1: number, x2: number, groundY: number, p: number, t: number): void {
  const sw = 4 * p;
  const n = Math.max(1, Math.floor((x2 - x1) / sw));
  const x0 = snap(x1 + (x2 - x1 - n * sw) / 2, p);
  const glint = Math.floor(t / 110) % (n + 6);
  const h = 6 * p;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * sw;
    for (let y = 0; y < h; y += p) {
      const half = Math.max(p / 2, ((sw / 2) * (y + p)) / h);
      const left = snap(x + sw / 2 - half, p);
      const w = Math.max(p, snap(half * 2, p));
      px(ctx, left - p, groundY - h + y, w + 2 * p, p, INK);
      px(ctx, left, groundY - h + y, w, p, METAL_LO);
      px(ctx, left, groundY - h + y, Math.max(p, snap(w / 2, p)), p, i === glint && y < h / 2 ? CREAM : METAL);
    }
  }
}

/** A bubbling pit of lava cut into the ground. */
export function drawLavaPit(ctx: CanvasRenderingContext2D, x1: number, x2: number, groundY: number, H: number, p: number, t: number): void {
  const x = snap(x1, p);
  const w = snap(x2 - x1, p);
  px(ctx, x - p, groundY - p, w + 2 * p, H - groundY + p, INK);
  px(ctx, x, groundY, w, H - groundY, "#e8432e");
  px(ctx, x, groundY, w, p, YELLOW);
  px(ctx, x, groundY + p, w, p, "#ff8a2a");
  ctx.save();
  ctx.globalAlpha = 0.2 + 0.08 * Math.sin(t / 280);
  px(ctx, x, groundY - 6 * p, w, 6 * p, "#ff8a2a");
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 800 + i * 0.37) % 1 + 1) % 1;
    const bx = snap(x + ((i * 0.33 + 0.15) % 1) * w, p);
    if (ph < 0.75) blob(ctx, bx, groundY - Math.ceil(ph * 3) * p + p, p * Math.ceil(ph * 2 + 1), p * Math.ceil(ph * 2 + 1), p, "#ff8a2a");
    else sparkle(ctx, bx, groundY - 2 * p, p, YELLOW);
  }
  for (let i = 0; i < 3; i++) {
    const f = ((t / 1400 + i / 3) % 1 + 1) % 1;
    px(ctx, snap(x + ((i * 0.41 + 0.2) % 1) * w, p), snap(groundY - f * 10 * p, p), p, p, f < 0.5 ? YELLOW : "#ff8a2a");
  }
}

/** The goal: a tall pole with a waving star banner, its feet at (x, y). */
export function drawGoalFlag(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, t: number): void {
  const cx = snap(x, p);
  const top = y - 22 * p;
  px(ctx, cx - p, top - p, 3 * p, y - top + p, INK);
  px(ctx, cx, top, p, y - top, METAL);
  blob(ctx, cx - p, top - 2 * p, 3 * p, 2 * p, p, YELLOW); // finial
  const wave = Math.floor(t / 200) % 3;
  for (let i = 0; i < 8; i++) {
    const dy = Math.round(Math.sin(i / 2 + wave)) * p;
    px(ctx, cx + p + i * p, top + 2 * p + dy - p, p, 7 * p, INK);
    px(ctx, cx + p + i * p, top + 2 * p + dy, p, 5 * p, i % 7 === 0 ? "#3a5fd0" : "#4a74e8");
  }
  sparkle(ctx, cx + 5 * p, top + 4 * p + Math.round(Math.sin(2 + wave)) * p, p, YELLOW);
  blob(ctx, cx - 2 * p, y - 2 * p, 5 * p, 2 * p, p, "#8a8fa8"); // base stone
  if (Math.floor(t / 300) % 2 === 0) sparkle(ctx, cx + 11 * p, top, p, CREAM);
}

/** A little wooden "start" sign, its feet at (x, y). */
export function drawStartSign(ctx: CanvasRenderingContext2D, x: number, y: number, p: number): void {
  const cx = snap(x, p);
  px(ctx, cx - p, y - 9 * p, 3 * p, 9 * p, INK);
  px(ctx, cx, y - 9 * p, p, 9 * p, WOOD_LO);
  blob(ctx, cx - 5 * p, y - 13 * p, 11 * p, 5 * p, p, WOOD);
  px(ctx, cx - 5 * p, y - 13 * p, 11 * p, p, WOOD_HI);
  // a little arrow on the board
  px(ctx, cx - 3 * p, y - 11 * p, 5 * p, p, CREAM);
  px(ctx, cx + p, y - 12 * p, p, 3 * p, CREAM);
}

/** A spinning gold coin to collect, bobbing above (x, y). */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, t: number): void {
  const cy = snap(y - 4 * p + Math.sin(t / 320 + x) * p, p);
  const cx = snap(x, p);
  const turn = Math.abs(Math.cos(t / 260 + x * 0.01)); // 1 = facing you, 0 = edge-on
  const half = Math.max(1, Math.round(turn * 3)) * p;
  px(ctx, cx - half - p, cy - 4 * p, 2 * half + 2 * p, 8 * p, INK);
  px(ctx, cx - half, cy - 3 * p, 2 * half, 6 * p, YELLOW);
  px(ctx, cx - half, cy - 3 * p, Math.max(p, half / 2), 6 * p, YELLOW_HI);
  if (half > 2 * p) px(ctx, cx - p / 2, cy - 2 * p, p, 4 * p, "#e0a020"); // the coin's notch
  if (Math.floor(t / 300) % 3 === 0) sparkle(ctx, cx + half + p, cy - 4 * p, p, CREAM);
}
