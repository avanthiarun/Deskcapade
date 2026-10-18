import type { Box } from "@deskcapade/shared";

/* ------------------------------------------------------------------
   1) Sprite pack lookup
   Put pixel-art PNGs in  client/public/sprites/  named like  mug.png, book.png ...
   A detected label is matched to a sprite name by keyword. If there is no keyword
   match, or the PNG doesn't exist, we fall back to pixelating the real photo (below),
   so ANY object always gets a pixel-art picture.
   ------------------------------------------------------------------ */

const SPRITE_DIR = "/sprites";

/** sprite file name (without .png) -> words in a detection label that should use it. Order matters: first match wins. */
const SPRITE_KEYWORDS: Record<string, string[]> = {
  mug: ["mug", "cup", "coffee", "tea"],
  bottle: ["bottle", "flask", "tumbler"],
  book: ["book", "notebook", "novel", "textbook"],
  phone: ["phone", "smartphone", "iphone"],
  laptop: ["laptop", "computer", "macbook"],
  keyboard: ["keyboard"],
  mouse: ["mouse"],
  plant: ["plant", "flower", "succulent", "cactus"],
  chair: ["chair", "stool"],
  glasses: ["glasses", "spectacles"],
  person: ["person", "man", "woman", "face"],
};

const spriteCache = new Map<string, Promise<HTMLImageElement | null>>();

export function spriteName(label: string): string | null {
  for (const [name, words] of Object.entries(SPRITE_KEYWORDS)) {
    if (words.some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(label))) return name;
  }
  return null;
}

/** Loads /sprites/<name>.png for this label, or null if there isn't one. */
export function loadSprite(label: string): Promise<HTMLImageElement | null> {
  const name = spriteName(label);
  if (!name) return Promise.resolve(null);
  let p = spriteCache.get(name);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null); // file missing (Vite answers with index.html, which isn't an image)
      img.src = `${SPRITE_DIR}/${name}.png`;
    });
    spriteCache.set(name, p);
  }
  return p;
}

/**
 * The picture to show for one detected object: a sprite from your pack when there is one,
 * otherwise a pixel-art version of the actual photo crop.
 */
export async function spriteNodeFor(
  label: string,
  shot: HTMLCanvasElement,
  box: Box,
): Promise<HTMLImageElement | HTMLCanvasElement> {
  const img = await loadSprite(label);
  if (img) {
    const el = new Image();
    el.src = img.src;
    el.alt = label;
    el.className = "gm-px";
    return el;
  }
  const c = pixelateCrop(shot, box);
  c.className = "gm-px";
  return c;
}

/* ------------------------------------------------------------------
   2) Turn any photo crop into cute pixel art
   Crop the box -> shrink to ~32 px -> snap every pixel to a small whimsical palette
   -> round the corners -> add a dark outline. Show it with `image-rendering: pixelated`.
   ------------------------------------------------------------------ */

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

const OUTLINE = hex("#2b1d3a");

const PALETTE: [number, number, number][] = [
  "#2b1d3a", "#4a3a6b", "#8b8fa8", "#c9cde0", "#fff7e6",
  "#6b4a3a", "#a8745a", "#e0405a", "#ff86a8", "#ffc2d4",
  "#f08a30", "#ffb870", "#ffd84a", "#fff0a0", "#2e7d46",
  "#5cbf5a", "#a8e86c", "#3d5a2a", "#2a6fd6", "#5cb8ff",
  "#a8e0ff", "#1d3f7a", "#7a4cc2", "#c9a0ff", "#2fb5a8",
].map(hex);

const clamp255 = (n: number): number => Math.max(0, Math.min(255, n));

function nearest(r: number, g: number, b: number): [number, number, number] {
  let best = PALETTE[0]!;
  let bestD = Infinity;
  for (const c of PALETTE) {
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** `box` is in the pixels of `src` (the snapshot). `grid` = pixels on the longest side. */
export function pixelateCrop(src: HTMLCanvasElement, box: Box, grid = 32): HTMLCanvasElement {
  const padX = box.w * 0.05;
  const padY = box.h * 0.05;
  const sx = Math.max(0, box.x - padX);
  const sy = Math.max(0, box.y - padY);
  const sw = Math.max(1, Math.min(src.width - sx, box.w + padX * 2));
  const sh = Math.max(1, Math.min(src.height - sy, box.h + padY * 2));

  const k = grid / Math.max(sw, sh);
  const w = Math.max(8, Math.round(sw * k));
  const h = Math.max(8, Math.round(sh * k));

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // rounded-corner "token" shape, so the leftover background looks intentional
  const radius = Math.min(w, h) * 0.28;
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const cx = x + 0.5;
    const cy = y + 0.5;
    const rx = Math.min(cx, w - cx);
    const ry = Math.min(cy, h - cy);
    if (rx >= radius || ry >= radius) return true;
    const dx = radius - rx;
    const dy = radius - ry;
    return dx * dx + dy * dy <= radius * radius;
  };

  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = inside(x, y) ? 1 : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!mask[y * w + x]) {
        d[i + 3] = 0;
        continue;
      }
      // a little extra color + contrast so it reads as cartoony
      const r0 = d[i]!;
      const g0 = d[i + 1]!;
      const b0 = d[i + 2]!;
      const gray = 0.3 * r0 + 0.59 * g0 + 0.11 * b0;
      const boost = (v: number): number => clamp255((gray + (v - gray) * 1.35 - 128) * 1.1 + 128);
      const c = nearest(boost(r0), boost(g0), boost(b0));
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }

  // dark outline on the edge of the token
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const edge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (!edge) continue;
      const i = (y * w + x) * 4;
      d[i] = OUTLINE[0];
      d[i + 1] = OUTLINE[1];
      d[i + 2] = OUTLINE[2];
    }
  }

  ctx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------------------------------------------
   3) The home-screen cat (16 x 15 pixels, drawn from text so there's no image file)
   ------------------------------------------------------------------ */

const CAT_ROWS = [
  "................",
  "..oo........oo..",
  ".oaao......oaao.",
  ".oaaaooooooaaao.",
  "oaaaaaaaaaaaaaao",
  "oaaaaaaaaaaaaaao",
  "oaakaaaaaaaakaao",
  "oaakaaaaaaaakaao",
  "oapaaaappaaaapao",
  ".oaaaaaaaaaaaao.",
  "..oowwwwwwwwoo..",
  ".oaowwwwwwwwoao.",
  ".oaaowwwwwwoaao.",
  ".ooaaoo..ooaaoo.",
  "..oooo....oooo..",
];

const CAT_COLORS: Record<string, string> = {
  o: "#2b1d3a",
  a: "#ffb870",
  w: "#fff7e6",
  k: "#2b1d3a",
  p: "#ff86a8",
};

export function drawPixelCat(canvas: HTMLCanvasElement): void {
  canvas.width = 16;
  canvas.height = CAT_ROWS.length;
  const ctx = canvas.getContext("2d")!;
  CAT_ROWS.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = CAT_COLORS[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
}