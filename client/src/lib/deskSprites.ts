import type { Box } from "@deskcapade/shared";
import { blurBackground } from "./deskFilter";
import { drawPixelBackdrop } from "./pixelBackdrop";
import { FIXED_COLORS, OUTLINE_COLOR, findSpriteTemplate, type SpriteTemplate } from "./spriteDictionary";
import { pixelateCrop } from "./sprites";

/* ------------------------------------------------------------------
   Turn a detected desk object into a cute sprite:
   1) dictionary hit  -> premade template, recolored with the object's real color
   2) no dictionary hit -> the pixelization algorithm on the photo crop (fallback only)
   Then draw the sprites centered in their boxes on the (background-blurred) photo.
   ------------------------------------------------------------------ */

export type Rgb = readonly [number, number, number];

export type SpriteColors = { body: Rgb; shade: Rgb; highlight: Rgb };

export type DeskSprite = {
  label: string;
  /** Box in the photo's own pixels. */
  box: Box;
  /** The sprite at 1 canvas pixel per art pixel (scale it up with nearest-neighbor). */
  canvas: HTMLCanvasElement;
  source: "dictionary" | "pixelated";
  /** Template id when `source` is "dictionary". */
  templateId: string | null;
};

/* ---------- color helpers ---------- */

const hexToRgb = (s: string): Rgb => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const rgbCss = (c: Rgb): string => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function rgbToHsl([r0, g0, b0]: Rgb): [number, number, number] {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [ch(hue + 1 / 3) * 255, ch(hue) * 255, ch(hue - 1 / 3) * 255];
}

/** Move a hue a little toward a target hue (shadows lean purple, highlights lean warm: the cute look). */
const nudgeHue = (h: number, target: number, amount: number): number => {
  const diff = ((target - h + 540) % 360) - 180;
  return h + diff * amount;
};

/**
 * The object's main color: looks at the middle of the box (edges are mostly background),
 * ignores pixels that match the background around the box, and returns the most common color.
 */
export function sampleDominantColor(photo: HTMLCanvasElement, box: Box): Rgb {
  const SIZE = 40;
  const k = SIZE / Math.max(1, box.w, box.h);
  const w = Math.max(4, Math.round(box.w * k));
  const h = Math.max(4, Math.round(box.h * k));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, box.x, box.y, Math.max(1, box.w), Math.max(1, box.h), 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const px = (x: number, y: number): Rgb => {
    const i = (y * w + x) * 4;
    return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0];
  };

  // background reference = average of the box's outer border
  let br = 0;
  let bg = 0;
  let bb = 0;
  let bn = 0;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const p = px(x, y);
      br += p[0];
      bg += p[1];
      bb += p[2];
      bn++;
    }
  }
  for (let y = 1; y < h - 1; y++) {
    for (const x of [0, w - 1]) {
      const p = px(x, y);
      br += p[0];
      bg += p[1];
      bb += p[2];
      bn++;
    }
  }
  const back: Rgb = [br / bn, bg / bn, bb / bn];

  // histogram of the inner region (3 bits per channel), weighted toward the center
  const bins = new Map<number, { weight: number; r: number; g: number; b: number }>();
  const addPixels = (skipBackground: boolean): void => {
    for (let y = Math.floor(h * 0.18); y < Math.ceil(h * 0.82); y++) {
      for (let x = Math.floor(w * 0.18); x < Math.ceil(w * 0.82); x++) {
        const p = px(x, y);
        if (skipBackground) {
          const dist = Math.hypot(p[0] - back[0], p[1] - back[1], p[2] - back[2]);
          if (dist < 38) continue;
        }
        const dx = (x + 0.5) / w - 0.5;
        const dy = (y + 0.5) / h - 0.5;
        const weight = Math.exp(-(dx * dx + dy * dy) * 6);
        const key = ((p[0] >> 5) << 6) | ((p[1] >> 5) << 3) | (p[2] >> 5);
        const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
        bin.weight += weight;
        bin.r += p[0] * weight;
        bin.g += p[1] * weight;
        bin.b += p[2] * weight;
        bins.set(key, bin);
      }
    }
  };
  addPixels(true);
  if (bins.size === 0) addPixels(false); // the object is the same color as its background

  let best: { weight: number; r: number; g: number; b: number } | null = null;
  for (const bin of bins.values()) if (!best || bin.weight > best.weight) best = bin;
  if (!best || best.weight === 0) return back;
  return [best.r / best.weight, best.g / best.weight, best.b / best.weight];
}

/** Body / shade / highlight from one real-world color, kept recognizably the same color but cuter. */
export function colorsFromDominant(rgb: Rgb): SpriteColors {
  const [h, s0, l0] = rgbToHsl(rgb);
  const gray = s0 < 0.12;
  // grays stay gray (with a tiny lavender tint); colors get a bit more saturated
  const hue = gray ? 255 : h;
  const s = gray ? Math.min(0.12, s0 + 0.06) : clamp(s0 * 1.25 + 0.05, 0.3, 0.85);
  const l = clamp(l0, 0.3, 0.8); // never as dark as the outline, never pure white

  return {
    body: hslToRgb(hue, s, l),
    shade: hslToRgb(gray ? hue : nudgeHue(hue, 270, 0.12), clamp(s + 0.05, 0, 0.9), clamp(l - 0.17, 0.18, 0.66)),
    highlight: hslToRgb(gray ? hue : nudgeHue(hue, 50, 0.08), clamp(s - 0.05, 0, 0.9), clamp(l + 0.17, 0.42, 0.94)),
  };
}

/** Draw a dictionary template at 1 px per art pixel, trimmed to its visible pixels (so it centers correctly). */
export function renderSpriteTemplate(template: SpriteTemplate, colors: SpriteColors): HTMLCanvasElement {
  const rows = template.rows;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ".") continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });

  const out = document.createElement("canvas");
  if (maxX < 0) {
    out.width = 1;
    out.height = 1;
    return out;
  }
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const ctx = out.getContext("2d")!;

  const roles: Record<string, string> = {
    o: OUTLINE_COLOR,
    b: rgbCss(colors.body),
    s: rgbCss(colors.shade),
    h: rgbCss(colors.highlight),
  };
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === undefined || ch === ".") continue;
      const color = roles[ch] ?? template.colors?.[ch] ?? FIXED_COLORS[ch];
      if (!color) continue; // unknown character: leave it transparent
      ctx.fillStyle = color;
      ctx.fillRect(x - minX, y - minY, 1, 1);
    }
  });
  return out;
}

/**
 * The sprite for one desk object. Dictionary objects never go through the pixelization
 * algorithm; it is only the fallback for objects the dictionary doesn't know.
 */
export function makeDeskSprite(label: string, photo: HTMLCanvasElement, box: Box): DeskSprite {
  const template = findSpriteTemplate(label);
  if (template) {
    const colors = colorsFromDominant(sampleDominantColor(photo, box));
    return { label, box, canvas: renderSpriteTemplate(template, colors), source: "dictionary", templateId: template.id };
  }
  return { label, box, canvas: pixelateCrop(photo, box), source: "pixelated", templateId: null };
}

/** Where a sprite lands: centered in its box, as big as fits, with a whole-number zoom so every art pixel is the same size. */
export function deskSpriteRect(sp: DeskSprite, scale = 1): { x: number; y: number; w: number; h: number; zoom: number } | null {
  const bx = sp.box.x * scale;
  const by = sp.box.y * scale;
  const bw = sp.box.w * scale;
  const bh = sp.box.h * scale;
  const cw = sp.canvas.width;
  const ch = sp.canvas.height;
  if (cw === 0 || ch === 0 || bw <= 0 || bh <= 0) return null;

  let zoom = Math.min((bw * 0.92) / cw, (bh * 0.92) / ch);
  if (zoom >= 1) zoom = Math.floor(zoom);
  const w = Math.round(cw * zoom);
  const h = Math.round(ch * zoom);
  return { x: Math.round(bx + (bw - w) / 2), y: Math.round(by + (bh - h) / 2), w, h, zoom };
}

/** The little ground shadow under a sprite drawn at `r`. */
export function drawSpriteShadow(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number; zoom: number },
): void {
  ctx.fillStyle = "rgba(43, 29, 58, 0.28)";
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h - Math.max(1, r.zoom), r.w * 0.4, Math.max(2, r.h * 0.06), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Draw sprites centered in their boxes with crisp nearest-neighbor pixels. `scale` maps photo pixels to `ctx` pixels. */
export function drawDeskSprites(ctx: CanvasRenderingContext2D, sprites: readonly DeskSprite[], scale = 1): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const sp of sprites) {
    const r = deskSpriteRect(sp, scale);
    if (!r) continue;
    drawSpriteShadow(ctx, r); // so the sprite sits on the ground
    ctx.drawImage(sp.canvas, r.x, r.y, r.w, r.h);
  }
  ctx.restore();
}

/** Longest side of the composed scene; it's rendered larger than the photo so sprite pixels stay crisp when shown. */
const SCENE_MAX_SIDE = 1600;

/** Photo pixels -> scene pixels, the same for every composed scene. */
export function deskSceneScale(photo: HTMLCanvasElement): number {
  return Math.max(1, Math.min(2, SCENE_MAX_SIDE / Math.max(1, photo.width, photo.height)));
}

/** The finished picture: background-blurred photo with every desk sprite drawn on top. No text. */
export function composeDeskScene(photo: HTMLCanvasElement, sprites: readonly DeskSprite[]): HTMLCanvasElement {
  const blurred = blurBackground(photo, sprites.map((s) => s.box));
  const scale = deskSceneScale(photo);

  const out = document.createElement("canvas");
  out.width = Math.round(photo.width * scale);
  out.height = Math.round(photo.height * scale);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(blurred, 0, 0, out.width, out.height);
  drawDeskSprites(ctx, sprites, scale);
  return out;
}

/** The same scene, but the photo is swapped for the constant pixel-art backdrop. Sprites keep their real positions. */
export function composePixelWorldScene(photo: HTMLCanvasElement, sprites: readonly DeskSprite[]): HTMLCanvasElement {
  const scale = deskSceneScale(photo);

  const out = document.createElement("canvas");
  out.width = Math.round(photo.width * scale);
  out.height = Math.round(photo.height * scale);
  const ctx = out.getContext("2d")!;
  drawPixelBackdrop(ctx, out.width, out.height);
  drawDeskSprites(ctx, sprites, scale);
  return out;
}

/** Draw each sprite stretched over its whole box (crisp pixels), so it fully covers the real object. */
export function drawDeskSpritesCovering(
  ctx: CanvasRenderingContext2D,
  sprites: readonly DeskSprite[],
  scale = 1,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const sp of sprites) {
    if (sp.canvas.width === 0 || sp.canvas.height === 0 || sp.box.w <= 0 || sp.box.h <= 0) continue;
    const pad = Math.min(sp.box.w, sp.box.h) * 0.04; // a hair bigger than the box, so no real edges peek out
    ctx.drawImage(
      sp.canvas,
      Math.round((sp.box.x - pad) * scale),
      Math.round((sp.box.y - pad) * scale),
      Math.round((sp.box.w + pad * 2) * scale),
      Math.round((sp.box.h + pad * 2) * scale),
    );
  }
  ctx.restore();
}

/** The photo exactly as taken, with each detected object covered by its pixel sprite. No text. */
export function composeCoveredScene(photo: HTMLCanvasElement, sprites: readonly DeskSprite[]): HTMLCanvasElement {
  const scale = deskSceneScale(photo);
  const out = document.createElement("canvas");
  out.width = Math.round(photo.width * scale);
  out.height = Math.round(photo.height * scale);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, 0, 0, out.width, out.height);
  drawDeskSpritesCovering(ctx, sprites, scale);
  return out;
}
