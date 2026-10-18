import type { Decoration, TransformSpec } from "@deskcapade/shared";
import { hexToRgb, mix, rgbToCss, shade, type RGB } from "./palette";

type Ctx = CanvasRenderingContext2D;

export type Px = { x: number; y: number; w: number; h: number };
export type Look = { body: string; edge: string; inner: string; light: string; accent: string; accentDark: string };
export type DrawEx = { grow: number; squash: number; doorOpen: number; dark: number };
export type PoolGeom = { rim: number; ix1: number; ix2: number; top: number; waterTop: number; bottom: number };

/** Tallest ledge the hero can hop onto from the ground. Anything taller gets a vine. */
export const SELF_REACH = 26;

export function fill(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw < 1 || rh < 1) return;
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), rw, rh);
}

export function makeLook(color: RGB, accentHex: string): Look {
  const acc = hexToRgb(accentHex);
  return {
    body: rgbToCss(color),
    edge: rgbToCss(shade(color, 0.45)),
    inner: rgbToCss(shade(color, 0.25)),
    light: rgbToCss(mix(color, [255, 255, 255], 0.55)),
    accent: rgbToCss(acc),
    accentDark: rgbToCss(shade(acc, 0.35)),
  };
}

// ---------- geometry shared by physics and drawing ----------

export function poolGeom(b: Px): PoolGeom | null {
  const rim = Math.max(1, Math.min(3, Math.round(b.w * 0.12)));
  const ix1 = b.x + rim;
  const ix2 = b.x + b.w - rim;
  if (ix2 - ix1 < 11 || b.h < 16) return null; // too small for the hero to swim in
  return { rim, ix1, ix2, top: b.y, waterTop: b.y + Math.round(b.h * 0.3), bottom: b.y + b.h - 2 };
}

export function doorRect(b: Px): Px {
  const w = b.w >= 16 ? 4 : 3;
  const h = Math.min(6, Math.max(3, Math.round(b.h * 0.3)));
  return { x: b.x + Math.round((b.w - w) / 2), y: b.y + b.h - h, w, h };
}

export function ladderSide(spec: TransformSpec, b: Px, groundY: number): "left" | "right" | "none" {
  if (spec.role === "hazard") return "none";
  if (Math.max(b.y + b.h, groundY) - b.y < 10) return "none";
  if (spec.ladder !== "none") return spec.ladder;
  return groundY - b.y > SELF_REACH ? "right" : "none";
}

export const roofInset = (spec: TransformSpec): number =>
  spec.roof === "dome" ? 2 : spec.roof === "cone" ? 1 : 0;

/** A detected can becomes a striped can you can climb, not a generic house. */
export function isSodaCan(spec: TransformSpec): boolean {
  return spec.role === "house" && /\b(can|soda|cola|tin|bottle|flask)\b/i.test(spec.name);
}

// ---------- pieces ----------

function drawBody(ctx: Ctx, b: Px, look: Look): void {
  if (b.w < 4 || b.h < 4) {
    fill(ctx, b.x, b.y, b.w, b.h, look.body);
    return;
  }
  fill(ctx, b.x + 1, b.y, b.w - 2, b.h, look.edge);
  fill(ctx, b.x, b.y + 1, b.w, b.h - 2, look.edge);
  fill(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, look.body);
  if (b.w >= 8 && b.h >= 8) fill(ctx, b.x + 2, b.y + 2, 1, b.h - 5, look.light);
}

function drawRoof(ctx: Ctx, b: Px, roof: TransformSpec["roof"], look: Look): void {
  if (roof === "flat") {
    fill(ctx, b.x - 1, b.y, b.w + 2, 2, look.accent);
    fill(ctx, b.x - 1, b.y + 2, b.w + 2, 1, look.accentDark);
  } else if (roof === "cone") {
    fill(ctx, b.x + 1, b.y, b.w - 2, 1, look.accent);
    fill(ctx, b.x, b.y + 1, b.w, 1, look.accent);
    fill(ctx, b.x - 1, b.y + 2, b.w + 2, 1, look.accent);
    fill(ctx, b.x - 1, b.y + 3, b.w + 2, 1, look.accentDark);
  } else if (roof === "dome") {
    fill(ctx, b.x + 2, b.y, b.w - 4, 1, look.accent);
    fill(ctx, b.x + 1, b.y + 1, b.w - 2, 1, look.accent);
    fill(ctx, b.x, b.y + 2, b.w, 1, look.accent);
    fill(ctx, b.x, b.y + 3, b.w, 1, look.accentDark);
  }
}

function drawSodaCan(ctx: Ctx, b: Px, look: Look, t: number, ex: DrawEx): void {
  const { x, y, w, h } = b;
  fill(ctx, x + 2, y, w - 4, 2, look.light);
  fill(ctx, x + 1, y + 2, w - 2, 2, look.edge);
  fill(ctx, x + Math.round(w / 2) - 1, y, 2, 1, look.inner);
  const top = y + 4;
  const bodyH = Math.max(4, h - 6);
  fill(ctx, x + 1, top, Math.max(1, w - 2), bodyH, look.body);
  fill(ctx, x, top + 1, w, Math.max(1, bodyH - 2), look.body);
  fill(ctx, x + 2, top + 2, 1, Math.max(1, bodyH - 5), look.light);
  for (let i = 0; i < 3; i++) {
    const by = top + 4 + i * Math.max(8, Math.floor(bodyH / 4));
    if (by + 2 >= top + bodyH - 2) break;
    fill(ctx, x + 1, by, Math.max(1, w - 2), 2, i === 1 ? look.accent : look.light);
  }
  const lh = Math.min(12, Math.max(6, Math.round(bodyH * 0.28)));
  const ly = top + Math.round((bodyH - lh) / 2);
  fill(ctx, x, ly, w, lh, look.light);
  fill(ctx, x + 2, ly + 2, Math.max(1, w - 4), Math.max(1, lh - 4), look.accent);
  const bubble = Math.floor(t * 3) % Math.max(1, w - 4);
  fill(ctx, x + 2 + bubble, ly + Math.min(3, lh - 2), 1, 1, look.light);
  fill(ctx, x + 1, y + h - 2, Math.max(1, w - 2), 2, look.edge);
  drawDoor(ctx, b, ex);
}

function drawDoor(ctx: Ctx, b: Px, ex: DrawEx): void {
  const d = doorRect(b);
  fill(ctx, d.x + 1, d.y, d.w - 2, 1, "#6b4a3a");
  fill(ctx, d.x, d.y + 1, d.w, d.h - 1, ex.doorOpen > 0 ? "#2b1d3a" : "#6b4a3a");
  if (ex.doorOpen > 0) fill(ctx, d.x + 1, d.y + 2, 1, 2, "#ffe27a");
  else fill(ctx, d.x + d.w - 2, d.y + Math.round(d.h / 2), 1, 1, "#ffd84a");
}

function drawBridge(ctx: Ctx, b: Px, look: Look): void {
  const th = Math.min(b.h, 4);
  for (let x = b.x, i = 0; x < b.x + b.w; x += 3, i++) {
    fill(ctx, x, b.y, Math.min(2, b.x + b.w - x), th, i % 2 === 0 ? look.body : look.light);
  }
  fill(ctx, b.x, b.y + th, b.w, 1, look.edge);
  fill(ctx, b.x, b.y - 2, 1, th + 3, look.edge);
  fill(ctx, b.x + b.w - 1, b.y - 2, 1, th + 3, look.edge);
}

function drawThorns(ctx: Ctx, b: Px, look: Look, t: number): void {
  drawBody(ctx, b, look);
  const flash = Math.sin(t * 6) > 0.5;
  for (let x = b.x + 1; x < b.x + b.w - 2; x += 3) {
    fill(ctx, x, b.y - 1, 3, 1, look.accent);
    fill(ctx, x + 1, b.y - 2, 1, 1, flash ? "#fff7e6" : look.accentDark);
  }
}

function drawSpring(ctx: Ctx, b: Px, look: Look, ex: DrawEx): void {
  const sq = Math.min(2, Math.round(ex.squash * 8));
  drawBody(ctx, { x: b.x, y: b.y + sq, w: b.w, h: Math.max(4, b.h - sq) }, look);
  fill(ctx, b.x - 1, b.y + sq, b.w + 2, 2, look.accent);
  fill(ctx, b.x, b.y + sq, b.w, 1, look.light);
}

function drawPlanter(ctx: Ctx, b: Px, look: Look, t: number, ex: DrawEx): void {
  const potH = Math.max(4, Math.round(b.h * 0.4));
  const potY = b.y + b.h - potH;
  drawBody(ctx, { x: b.x, y: potY, w: b.w, h: potH }, look);
  fill(ctx, b.x + 1, potY, Math.max(1, b.w - 2), 1, "#5a3d2a");
  const n = Math.max(2, Math.min(5, Math.floor(b.w / 5)));
  const room = potY - b.y;
  const blooms = ["#ff86a8", "#ffd84a", "#fff7e6", "#c9a0ff", "#ff9f80"];
  for (let i = 0; i < n; i++) {
    const x = b.x + 2 + Math.round((i * (b.w - 6)) / Math.max(1, n - 1));
    const stalk = Math.max(2, Math.round(room * Math.min(1, 0.45 + 0.1 * ex.grow)));
    const topY = potY - stalk;
    const sway = Math.round(Math.sin(t * 1.5 + i));
    fill(ctx, x + 1, topY, 1, stalk, "#2e7d46");
    fill(ctx, x + (i % 2 === 0 ? 2 : -1) + sway, topY + 1, 2, 1, "#5cbf5a");
    if (i < ex.grow) {
      fill(ctx, x, topY - 1, 3, 2, blooms[i % blooms.length]!);
      fill(ctx, x + 1, topY - 1, 1, 1, "#ffd84a");
    }
  }
}

function drawDuck(ctx: Ctx, x: number, y: number, t: number): void {
  const bob = Math.round(Math.sin(t * 2));
  fill(ctx, x + 1, y + bob + 1, 5, 3, "#ffd84a");
  fill(ctx, x + 5, y + bob, 3, 3, "#ffd84a");
  fill(ctx, x + 7, y + bob + 1, 2, 1, "#f08a30");
  fill(ctx, x + 6, y + bob, 1, 1, "#2b1d3a");
}

function drawDecor(ctx: Ctx, d: Decoration, b: Px, look: Look, t: number, ex: DrawEx): void {
  const lit = ex.dark > 0.35;
  switch (d) {
    case "flowers": {
      const n = Math.min(4, Math.floor(b.w / 5));
      const colors = ["#ff86a8", "#ffd84a", "#fff7e6"];
      for (let i = 0; i < n; i++) {
        const x = b.x + 2 + i * 5;
        fill(ctx, x, b.y - 3, 1, 3, "#2e7d46");
        fill(ctx, x - 1, b.y - 4, 3, 2, colors[i % 3]!);
      }
      break;
    }
    case "windows": {
      if (b.h < 12) break;
      const ww = b.w >= 20 ? 3 : 2;
      const n = b.w >= 14 ? 2 : 1;
      const wy = b.y + 5;
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? b.x + (b.w - ww) / 2 : b.x + 2 + i * (b.w - 4 - ww);
        fill(ctx, x, wy, ww, ww, lit ? "#fff1a8" : "#bfe6ff");
        fill(ctx, x, wy, ww, 1, look.edge);
      }
      break;
    }
    case "flag": {
      if (b.w < 6) break;
      const px = b.x + b.w - 2;
      fill(ctx, px, b.y - 6, 1, 6, look.edge);
      fill(ctx, px + 1, b.y - 6, Math.sin(t * 4) > 0 ? 3 : 2, 2, look.accent);
      break;
    }
    case "chimney": {
      const x = b.x + 2;
      fill(ctx, x, b.y - 3, 2, 3, look.edge);
      const k = (t * 5) % 4;
      fill(ctx, x + (k > 2 ? 1 : 0), b.y - 4 - k, 1, 1, "rgba(255,255,255,0.8)");
      break;
    }
    case "mushrooms": {
      for (const x of [b.x + 2, b.x + Math.max(3, b.w - 6)]) {
        fill(ctx, x + 1, b.y - 1, 1, 1, "#fff7e6");
        fill(ctx, x, b.y - 2, 3, 1, "#ff6b6b");
        fill(ctx, x + 1, b.y - 2, 1, 1, "#fff7e6");
      }
      break;
    }
    case "lanterns": {
      for (const x of [b.x + 2, b.x + b.w - 3]) {
        fill(ctx, x, b.y - 4, 1, 2, look.edge);
        fill(ctx, x - 1, b.y - 2, 3, 2, lit ? "#ffe27a" : "#f4c95d");
        if (lit) {
          ctx.globalAlpha = 0.25;
          fill(ctx, x - 3, b.y - 4, 7, 6, "#ffe27a");
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
    case "sign": {
      const x = b.x + Math.round(b.w / 2) - 2;
      fill(ctx, x + 2, b.y - 2, 1, 2, "#6b4a3a");
      fill(ctx, x, b.y - 5, 5, 3, "#e8c48a");
      fill(ctx, x + 1, b.y - 4, 3, 1, "#6b4a3a");
      break;
    }
    case "clouds": {
      const bob = Math.round(Math.sin(t * 1.2));
      fill(ctx, b.x + 1, b.y - 2 + bob, 5, 3, "#ffffff");
      fill(ctx, b.x + Math.max(2, b.w - 7), b.y - 3 - bob, 6, 4, "#ffffff");
      break;
    }
    default:
      break; // "ducks" and "lilypads" are drawn inside pools
  }
}

function drawCupBack(ctx: Ctx, b: Px, look: Look, g: PoolGeom): void {
  fill(ctx, b.x + 1, b.y, b.w - 2, b.h, look.edge);
  fill(ctx, b.x, b.y + 1, b.w, b.h - 3, look.edge);
  fill(ctx, b.x + 1, b.y + 1, b.w - 2, b.h - 2, look.body);
  fill(ctx, g.ix1, b.y + 1, g.ix2 - g.ix1, b.h - 3, look.inner);
  fill(ctx, b.x, b.y, g.rim + 1, 1, look.light);
  fill(ctx, g.ix2, b.y, g.rim, 1, look.light);
}

// ---------- entry points ----------

/** Pass 1: everything that sits behind the hero. */
export function drawStructureBack(ctx: Ctx, b: Px, spec: TransformSpec, look: Look, t: number, ex: DrawEx): void {
  const g = spec.role === "pool" ? poolGeom(b) : null;
  if (g) {
    drawCupBack(ctx, b, look, g);
  } else if (spec.role === "house") {
    if (isSodaCan(spec)) drawSodaCan(ctx, b, look, t, ex);
    else {
      drawBody(ctx, b, look);
      drawRoof(ctx, b, spec.roof, look);
      drawDoor(ctx, b, ex);
    }
  } else if (spec.role === "bridge") {
    drawBridge(ctx, b, look);
  } else if (spec.role === "hazard") {
    drawThorns(ctx, b, look, t);
  } else if (spec.role === "bounce") {
    drawSpring(ctx, b, look, ex);
  } else if (spec.role === "garden") {
    drawPlanter(ctx, b, look, t, ex);
  } else {
    drawBody(ctx, b, look);
    drawRoof(ctx, b, spec.roof, look);
    if (spec.role === "nap") fill(ctx, b.x + 2, b.y + 2, Math.max(1, b.w - 4), 1, look.accent);
  }
  for (const d of spec.decorations) drawDecor(ctx, d, b, look, t, ex);
}

/** Pass 2: drawn after the hero, so water covers a swimming hero. */
export function drawStructureFront(ctx: Ctx, b: Px, spec: TransformSpec, t: number, seed: number): void {
  if (spec.role !== "pool") return;
  const g = poolGeom(b);
  if (!g) return;
  const iw = g.ix2 - g.ix1;
  ctx.globalAlpha = 0.72;
  fill(ctx, g.ix1, g.waterTop, iw, g.bottom + 1 - g.waterTop, "#3d8fe6");
  ctx.globalAlpha = 1;
  fill(ctx, g.ix1, g.waterTop, iw, 1, "#a8e0ff");
  for (let i = 0; i < 3; i++) {
    const sx = g.ix1 + ((seed + i * 11 + Math.floor(t * 6)) % Math.max(1, iw - 1));
    fill(ctx, sx, g.waterTop, 1, 1, "#ffffff");
  }
  if (spec.decorations.includes("ducks") && iw >= 14) {
    const dx = g.ix1 + 1 + Math.round((Math.sin(t * 0.7 + seed) * 0.5 + 0.5) * (iw - 11));
    drawDuck(ctx, dx, g.waterTop - 3, t + seed);
  }
  if (spec.decorations.includes("lilypads") && iw >= 10) {
    const lx = g.ix2 - 6 - Math.round((Math.sin(t * 0.5 + seed) * 0.5 + 0.5) * Math.max(0, iw - 14));
    fill(ctx, lx, g.waterTop, 4, 1, "#5cbf5a");
    fill(ctx, lx + 2, g.waterTop - 1, 1, 1, "#ff86a8");
  }
}

/** The vine (or rope ladder on pools) hanging beside an object. */
export function drawLadder(ctx: Ctx, side: "left" | "right", b: Px, role: TransformSpec["role"], groundY: number, t: number): void {
  const x = side === "right" ? b.x + b.w : b.x - 3;
  const top = b.y;
  const bot = Math.max(b.y + b.h, groundY);
  if (role === "pool") {
    fill(ctx, x, top, 1, bot - top, "#a8745a");
    fill(ctx, x + 2, top, 1, bot - top, "#a8745a");
    for (let y = top + 2; y < bot - 1; y += 4) fill(ctx, x, y, 3, 1, "#e8c48a");
    return;
  }
  for (let y = top, step = 0; y < bot; y += 2, step++) {
    const off = Math.round(Math.sin(y * 0.5 + t * 1.5));
    fill(ctx, x + 1 + off, y, 2, 2, "#2e7d46");
    if (step % 3 === 0) fill(ctx, side === "right" ? x + 3 + off : x - 1 + off, y, 2, 1, "#a8e86c");
    if (step % 8 === 0) fill(ctx, side === "right" ? x + 3 + off : x - 2 + off, y, 2, 2, "#ff86a8");
  }
}