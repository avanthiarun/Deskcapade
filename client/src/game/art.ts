import type { PoolLayout, Surface } from "./level";

/* ------------------------------------------------------------------
   Pixel art for the garden platformer, drawn in code on a grid of `p`-sized art pixels.

   Shared helpers and the pieces that sit around desk objects (slides, ladders, updrafts,
   geysers, flames), plus clouds, ground, seeds and the player. The desk objects themselves
   are drawn in pieces.ts.
   ------------------------------------------------------------------ */

export const INK = "#2b1d3a";
const LEAF = "#7ad957";
const LEAF_DARK = "#3f9e45";
const LEAF_LIGHT = "#c4f590";
const PINK = "#ff86a8";
const YELLOW = "#ffd84a";
const YELLOW_LIGHT = "#fff0a0";
const ORANGE = "#ff8a2a";
const RED = "#e8432e";
const CREAM = "#fff7e6";
const WATER_LIGHT = "#a8e0ff";
const METAL = "#c9cde0";
const BARK = "#8a5a3a";
const BARK_DARK = "#5e3a26";
const BARK_LIGHT = "#b07a50";
const CLOUD = "#ffffff";
const CLOUD_SHADE = "#d8ecff";
const DIRT = "#7a4a2a";

export type Rect = { x: number; y: number; w: number; h: number };

/** An object's own colors (CSS), so its decorations match it: a blue phone makes a blue brick wall. */
export type Tint = { body: string; shade: string; highlight: string };

/** Art pixel size for a canvas whose height is 100 u (the same size the object sprites use). */
export const artPixel = (u: number): number => Math.max(2, Math.round(u / 2.6));

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Snap `n` down to the art grid. */
export const snap = (n: number, p: number): number => Math.floor(n / p) * p;

/** A filled pixel with a 1-art-pixel ink outline. */
export function blob(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: number, color: string): void {
  px(ctx, x - p, y - p, w + 2 * p, h + 2 * p, INK);
  px(ctx, x, y, w, h, color);
}

/** A 4-point pixel star (sparkles, stars). */
export function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  px(ctx, x - s / 2, y - s * 1.5, s, s * 3, color);
  px(ctx, x - s * 1.5, y - s / 2, s * 3, s, color);
}

/* ---------- mug: the water slide and ladder beside the pool ---------- */

export function drawLadder(ctx: CanvasRenderingContext2D, L: { x1: number; x2: number; y1: number; y2: number }, p: number): void {
  const top = L.y1 - 3 * p;
  for (const x of [L.x1, L.x2 - p]) {
    px(ctx, x - p, top - p, 3 * p, L.y2 - top + p, INK);
    px(ctx, x, top, p, L.y2 - top, BARK_LIGHT);
  }
  for (let y = top + 2 * p; y < L.y2; y += 3 * p) {
    px(ctx, L.x1 + p, y - p, L.x2 - L.x1 - 2 * p, 3 * p, INK);
    px(ctx, L.x1 + p, y, L.x2 - L.x1 - 2 * p, p, BARK);
  }
}

/** The water slide on the mug's handle, in the mug's own colors, with water rushing down it. */
export function drawSlide(ctx: CanvasRenderingContext2D, s: Surface, p: number, groundY: number, t: number, c: Tint): void {
  const slope = s.slope ?? 0;
  const downhill = slope >= 0 ? 1 : -1;
  // stilts, only where the slide is close to the floor (high up it just floats)
  for (let x = s.x1 + 6 * p; x < s.x2 - 2 * p; x += 12 * p) {
    const y = s.y + slope * (x - s.x1);
    if (groundY - y > 30 * p) continue;
    px(ctx, x - p, y, 3 * p, groundY - y, INK);
    px(ctx, x, y, p, groundY - y, METAL);
  }
  // chute: outline, lip, body, shadow
  for (let x = s.x1; x < s.x2; x += p) {
    const y = s.y + slope * (x - s.x1);
    px(ctx, x, y - 3 * p, p, 7 * p, INK);
  }
  for (let x = s.x1; x < s.x2; x += p) {
    const y = s.y + slope * (x - s.x1);
    px(ctx, x, y - 2 * p, p, p, c.highlight);
    px(ctx, x, y - p, p, 2 * p, c.body);
    px(ctx, x, y + p, p, 2 * p, c.shade);
  }
  // water rushing downhill
  const len = s.x2 - s.x1;
  for (let i = 0; i < 6; i++) {
    const f = (((t / 600) * downhill + i / 6) % 1 + 1) % 1;
    const x = s.x1 + f * len;
    const y = s.y + slope * (x - s.x1);
    px(ctx, snap(x, p), y - p, 3 * p, p, WATER_LIGHT);
    px(ctx, snap(x, p) + p, y - 2 * p, p, p, CREAM);
  }
}

/* ---------- cable: rope bridge ---------- */

export function drawBridge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  deckY: (x: number) => number,
  p: number,
  c: Tint,
): void {
  const rope = c.shade; // the cable's own color
  // posts at both ends
  for (const x of [x1, x2 - 2 * p]) {
    blob(ctx, x, deckY(x) - 8 * p, 2 * p, 10 * p, p, BARK);
    px(ctx, x, deckY(x) - 8 * p, p, 10 * p, BARK_LIGHT);
    px(ctx, x - p, deckY(x) - 9 * p, 4 * p, p, BARK_DARK);
  }
  // hand rope (sagging less than the deck), hangers, then planks
  const rail = (x: number): number => deckY(x) - 6 * p - (deckY(x) - deckY(x1)) * 0.4;
  for (let x = x1 + 2 * p; x < x2 - 2 * p; x += p) px(ctx, x, snap(rail(x), p), p, p, rope);
  for (let x = x1 + 2 * p; x < x2 - 2 * p; x += 3 * p) {
    const y = snap(deckY(x), p);
    const top = snap(rail(x), p);
    px(ctx, x + p, top, p, y - top, rope);
    blob(ctx, x, y, 2 * p, p, p, BARK_LIGHT);
    px(ctx, x, y + p, 2 * p, p, BARK);
  }
}

/* ---------- lamp: the warm updraft above the lantern ---------- */

export function drawUpdraft(ctx: CanvasRenderingContext2D, zone: Rect, p: number, t: number): void {
  ctx.save();
  ctx.globalAlpha = 0.16;
  px(ctx, zone.x, zone.y, zone.w, zone.h, YELLOW_LIGHT);
  ctx.restore();
  // rising light streaks and sparkles
  for (let i = 0; i < 6; i++) {
    const f = ((t / 1600 + i / 6) % 1 + 1) % 1;
    const x = snap(zone.x + ((i * 0.37 + 0.1) % 1) * zone.w, p);
    const y = zone.y + zone.h * (1 - f);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - f) * 2);
    px(ctx, x, snap(y, p), p, 3 * p, CREAM);
    if (i % 2 === 0) sparkle(ctx, x + 2 * p, y - 4 * p, p, YELLOW);
    ctx.restore();
  }
}

/* ---------- bottle: the geyser erupting out of the fountain ---------- */

/** `phase`: ms into the geyser's cycle; it's erupting while phase < onMs, rumbling just before. */
export function drawGeyser(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  zone: Rect,
  p: number,
  t: number,
  phase: number,
  onMs: number,
  periodMs: number,
): void {
  const cx = snap(r.x + r.w / 2, p);
  if (phase < onMs) {
    // erupting column, tallest in the middle of the eruption
    const k = Math.sin((phase / onMs) * Math.PI);
    const h = Math.max(2 * p, (r.y - zone.y) * Math.min(1, k * 1.6));
    const half = Math.max(p, snap(zone.w / 2, p));
    px(ctx, cx - half - p, r.y - h, 2 * half + 2 * p, h, INK);
    px(ctx, cx - half, r.y - h, 2 * half, h, "#5cb8ff");
    for (let y = r.y - h; y < r.y; y += 3 * p) {
      const off = ((Math.floor((y + t / 4) / p) % 3) - 1) * p;
      px(ctx, cx - p + off, snap(y, p), p, 2 * p, WATER_LIGHT);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI + t / 200;
      px(ctx, snap(cx + Math.cos(a) * (half + 3 * p), p), snap(r.y - h - Math.abs(Math.sin(a)) * 3 * p, p), p, p, WATER_LIGHT);
    }
  } else if (periodMs - phase < 600) {
    // rumble: bubbles fizzing out of the cap
    for (let i = 0; i < 3; i++) px(ctx, cx - 2 * p + i * 2 * p, r.y - (2 + ((t / 60 + i) % 3)) * p, p, p, WATER_LIGHT);
  } else {
    const f = (t / 1000) % 1;
    px(ctx, cx, snap(r.y - p - f * 2 * p, p), p, p, WATER_LIGHT);
  }
}

/* ---------- candle: the brazier's flame (also used when you're on fire) ---------- */

export function drawBigFlame(ctx: CanvasRenderingContext2D, x: number, baseY: number, p: number, t: number, size = 1): void {
  const f = Math.floor(t / 90) % 3;
  const h = Math.round((5 + f) * size);
  const cx = snap(x, p);
  for (let i = 0; i < h; i++) {
    const half = Math.max(1, Math.round((h - i) * 0.45 * (i < 2 ? 0.8 : 1)));
    const wob = i > h * 0.6 ? ((f + i) % 2) * p : 0;
    const y = baseY - (i + 1) * p;
    px(ctx, cx - (half + 1) * p + wob, y, (2 * half + 2) * p, p, INK);
    px(ctx, cx - half * p + wob, y, 2 * half * p, p, i < h * 0.35 ? YELLOW : i < h * 0.7 ? ORANGE : RED);
    if (i < h * 0.3 && half > 1) px(ctx, cx - p + wob, y, 2 * p, p, YELLOW_LIGHT);
  }
}

/* ---------- clouds and ground ---------- */

export function drawCloud(ctx: CanvasRenderingContext2D, s: Surface, p: number, squash: number): void {
  const dip = Math.round(squash * 2) * p; // squishes down when bounced on
  const y = snap(s.y + dip, p);
  const w = s.x2 - s.x1;
  // round puffs along the top: big, small, big...
  const n = Math.max(2, Math.round(w / (5 * p)));
  const puffs = Array.from({ length: n }, (_, i) => ({ cx: s.x1 + ((i + 0.5) * w) / n, r: (i % 2 === 0 ? 3 : 2) * p }));
  const dome = (cx: number, r: number, color: string): void => {
    for (let dy = r; dy > 0; dy -= p) {
      const half = snap(Math.sqrt(Math.max(0, r * r - (dy - p / 2) ** 2)) + p / 2, p);
      px(ctx, snap(cx, p) - half, y - dy, half * 2, p, color);
    }
  };
  for (const q of puffs) dome(q.cx, q.r + p, INK);
  px(ctx, s.x1, y - p, w, 5 * p, INK);
  for (const q of puffs) dome(q.cx, q.r, CLOUD);
  px(ctx, s.x1 + p, y, w - 2 * p, 2 * p, CLOUD);
  px(ctx, s.x1 + p, y + 2 * p, w - 2 * p, p, CLOUD_SHADE);
}

export function drawGround(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number, p: number): void {
  px(ctx, 0, groundY - p, W, p, INK);
  px(ctx, 0, groundY, W, p, "#8fe05a");
  px(ctx, 0, groundY + p, W, p, LEAF_DARK);
  px(ctx, 0, groundY + 2 * p, W, H - groundY - 2 * p, DIRT);
  for (let x = 0, i = 0; x < W; x += p, i++) {
    const n = (i * 7919) % 13;
    if (n < 4) px(ctx, x, groundY - 2 * p, p, p, n < 2 ? "#8fe05a" : LEAF);
    if (n === 6) px(ctx, x, groundY + 2 * p, p, 2 * p, LEAF_DARK); // hanging grass
    if (n === 9) px(ctx, x, groundY + 3 * p, 2 * p, p, "#5e3820"); // cobble edge
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
  px(ctx, bx, by - 5 * p, p, p, LEAF_DARK);
  if (Math.floor(t / 250) % 3 === 0) px(ctx, bx + 2 * p, by - 5 * p, p, p, CREAM);
}

/* ---------- the player: 10 cute characters ---------- */

/**
 * Every character shares one round body (16 x 12 art pixels, with a face) and has its own head
 * decoration (6 rows), colors and little touches (seeds, stripes, a belly...). Rows are padded
 * to 16 wide automatically.
 *   o outline  b body  h highlight  d shade  w eye white  k eye / mouth dark  p blush  m mouth
 *   anything else: a color from the character's own `colors`
 */
const BODY = [
  "....oooooooo....",
  "...obbbbbbhho...",
  "..obbbbbbbbhho..",
  ".obbbbbbbbbbbho.",
  ".obbwwbbbbwwbbo.",
  ".obbwkbbbbwkbbo.",
  ".obpkkbbbbkkpbo.",
  ".obbbbbmmbbbbbo.",
  ".odbbbbbbbbbbdo.",
  "..odbbbbbbbbdo..",
  "...oddddddddoo..",
  "....oooooooo....",
];
const FEET = ["....oo....oo....", "...oo......oo...", ".....oo..oo....."];
const BASE_COLORS: Record<string, string> = { o: INK, w: CREAM, k: INK, p: PINK, m: "#c4506a" };

type Grid = string[][];
export type Character = {
  id: string;
  name: string;
  head: readonly string[];
  colors: Readonly<Record<string, string>>;
  /** Little touches drawn over the body (body rows are grid rows 6-17). */
  tweak?: (g: Grid) => void;
};

/** Replace body-colored pixels at (x, y) cells with `ch`. */
const dot = (g: Grid, cells: readonly [number, number][], ch: string): void => {
  for (const [x, y] of cells) if (g[y]?.[x] === "b" || g[y]?.[x] === "h" || g[y]?.[x] === "d") g[y]![x] = ch;
};
/** Recolor every body-colored pixel in row `y` between columns x1..x2. */
const band = (g: Grid, y: number, x1: number, x2: number, ch: string): void => {
  for (let x = x1; x <= x2; x++) if (g[y]?.[x] === "b" || g[y]?.[x] === "d" || g[y]?.[x] === "h") g[y]![x] = ch;
};
/** Plain eyes off: for characters whose eyes sit on the head instead. */
const noBodyEyes = (g: Grid): void => {
  for (const y of [10, 11, 12]) for (let x = 0; x < 16; x++) if (g[y]![x] === "w" || (g[y]![x] === "k" && y < 13)) g[y]![x] = "b";
  g[12]![5] = "k";
  g[12]![10] = "k";
};

export const CHARACTERS: readonly Character[] = [
  {
    id: "sprout",
    name: "Sprout",
    head: ["..ooo......ooo..", ".oLLlo....olLLo.", ".oLlllo..olllLo.", "..oLlllooollLo..", "...ooollsllooo..", "......osso......"],
    colors: { l: "#7ad957", L: "#3f9e45", s: "#5cbf5a", b: "#c8f7a0", h: "#f2ffe4", d: "#8fd46a" },
  },
  {
    id: "carrot",
    name: "Carrot",
    head: ["......o..o......", ".....oLooLo.....", "....oLlLLlLo....", ".....oLllLo.....", "......oLLo......", ".......oo......."],
    colors: { l: "#7ad957", L: "#3f9e45", b: "#ff9a3c", h: "#ffc27a", d: "#d96b1c", r: "#c45a14" },
    tweak: (g) => {
      dot(g, [[3, 9], [4, 9], [11, 14], [12, 14], [4, 15], [5, 15]], "r"); // carrot ridges
    },
  },
  {
    id: "strawberry",
    name: "Strawberry",
    head: ["................", "................", "....oo.oo.oo....", "...oLLoLLoLLo...", "....oLLllLLo....", "......oLLo......"],
    colors: { l: "#7ad957", L: "#3f9e45", b: "#ff4d5e", h: "#ff9aa5", d: "#c22a3a", y: "#ffe28a" },
    tweak: (g) => dot(g, [[4, 8], [9, 8], [3, 9], [7, 9], [12, 9], [5, 14], [10, 14], [3, 15], [8, 15], [12, 15], [6, 16], [10, 16]], "y"),
  },
  {
    id: "tomato",
    name: "Tomato",
    head: ["................", "................", "................", ".....o.oo.o.....", "....oLoLLoLo....", ".....oLLLLo....."],
    colors: { L: "#3f9e45", b: "#ff5a3c", h: "#ff9a80", d: "#c8361e" },
  },
  {
    id: "frog",
    name: "Frog",
    head: ["................", "................", "...ooo....ooo...", "..owwko..owwko..", "..obbbo..obbbo..", "...ooo....ooo..."],
    colors: { b: "#7ad957", h: "#c4f590", d: "#3f9e45" },
    tweak: noBodyEyes,
  },
  {
    id: "cat",
    name: "Cat",
    head: ["................", "...oo......oo...", "..obpo....opbo..", "..obbbo..obbbo..", "..obbbboobbbbo..", "...obbbbbbbbo..."],
    colors: { b: "#ffb870", h: "#ffe0b8", d: "#e08a3a", z: "#e08a3a" },
    tweak: (g) => {
      dot(g, [[7, 7], [8, 7], [6, 8], [9, 8]], "z"); // stripes on the forehead
    },
  },
  {
    id: "bunny",
    name: "Bunny",
    head: ["...oo......oo...", "..obpo....opbo..", "..obpo....opbo..", "..obpo....opbo..", "..obbo....obbo..", "...oo......oo..."],
    colors: { b: "#f4f0f8", h: "#ffffff", d: "#c9c0d8" },
  },
  {
    id: "penguin",
    name: "Penguin",
    head: ["................", "................", "................", "................", ".......oo.......", "......obbo......"],
    colors: { b: "#3a3a5c", h: "#5a5a80", d: "#26263c", e: "#fff7e6", n: "#ff9a3c" },
    tweak: (g) => {
      for (const y of [13, 14, 15, 16]) band(g, y, 5, 10, "e"); // white belly
      g[13]![7] = "n"; // beak
      g[13]![8] = "n";
    },
  },
  {
    id: "mushroom",
    name: "Mushroom",
    head: ["......oooo......", "....ooccccoo....", "...occwccwcco...", "..occcccccccco..", "..ocwcccccccwo..", "..oooooooooooo.."],
    colors: { c: "#ff5a6e", b: "#fff0d8", h: "#ffffff", d: "#e2cfae" },
  },
  {
    id: "bee",
    name: "Bee",
    head: ["....o......o....", ".....o....o.....", "......o..o......", "................", "................", "................"],
    colors: { b: "#ffd84a", h: "#fff0a0", d: "#e0a020", x: "#3a2a17", v: "#bfe8ff" },
    tweak: (g) => {
      band(g, 9, 1, 14, "x"); // stripes
      band(g, 14, 1, 14, "x");
      band(g, 15, 2, 13, "x");
      for (const [x, y] of [[0, 8], [1, 8], [0, 9], [15, 8], [14, 8], [15, 9]] as const) if (g[y]![x] === ".") g[y]![x] = "v"; // wings
    },
  },
];

const CHARACTER_KEY = "deskcapade.character";
let currentId = "sprout";
try {
  const saved = localStorage.getItem(CHARACTER_KEY);
  if (saved && CHARACTERS.some((c) => c.id === saved)) currentId = saved;
} catch {
  /* storage unavailable: the sprout it is */
}

/** The character you play as (saved in this browser). */
export const getCharacter = (): Character => CHARACTERS.find((c) => c.id === currentId) ?? CHARACTERS[0]!;

export function setCharacter(id: string): void {
  if (!CHARACTERS.some((c) => c.id === id)) return;
  currentId = id;
  try {
    localStorage.setItem(CHARACTER_KEY, id);
  } catch {
    /* storage unavailable: it still applies for this visit */
  }
}

const charCache = new Map<string, HTMLCanvasElement>();

function characterCanvas(ch: Character, frame: number): HTMLCanvasElement {
  const cacheKey = `${ch.id}:${frame}`;
  const cached = charCache.get(cacheKey);
  if (cached) return cached;
  const rows = [...ch.head, ...BODY, FEET[frame] ?? FEET[0]!].map((r) => r.padEnd(16, ".").slice(0, 16));
  const grid: Grid = rows.map((r) => [...r]);
  ch.tweak?.(grid);
  const colors = { ...BASE_COLORS, ...ch.colors };
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = grid.length;
  const ctx = c.getContext("2d")!;
  grid.forEach((row, y) =>
    row.forEach((cell, x) => {
      const color = colors[cell];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  charCache.set(cacheKey, c);
  return c;
}

/**
 * The player character, feet at (x, y), about `height` canvas pixels tall.
 * `frame`: 0 standing, 1/2 walking. `facing`: 1 right, -1 left. Returns its drawn height.
 * `characterId` defaults to the one you picked.
 */
export function drawSprout(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  frame: number,
  facing: number,
  bob: number,
  characterId?: string,
): number {
  const ch = (characterId && CHARACTERS.find((c) => c.id === characterId)) || getCharacter();
  const c = characterCanvas(ch, frame);
  const scale = Math.max(1, Math.round(height / c.height));
  const w = c.width * scale;
  const h = c.height * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y - h + bob * scale));
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(c, -w / 2, 0, w, h);
  ctx.restore();
  return h;
}
