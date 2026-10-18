import { artPixelSize } from "./artPixel";

/* ------------------------------------------------------------------
   A constant, detailed pixel-art backdrop in a storybook castle-garden style: deep blue sky,
   puffy clouds, blue-green mountains, a pine forest, round trees, a wooden fence, bushes and
   flowers, and grassy cliffs over rich brown cobbled dirt with hanging vines. Drawn in code so
   no image files are needed. It's painted on the same small art-pixel grid as the desk sprites and the game,
   so everything matches. It looks the same every time; only its size follows the picture.
   ------------------------------------------------------------------ */

const INK = "#2b1d3a";
const SKY = ["#2f6fe0", "#3a7ce6", "#4689eb", "#5296ef", "#5fa3f2", "#6eb0f4", "#7fbdf6", "#93caf7"];
const CLOUD = ["#ffffff", "#eef6ff", "#cfe2fa", "#a9c8ef"];
const MOUNTAIN_FAR = ["#6f9fd8", "#5e8fcc", "#8cb4e2"];
const MOUNTAIN_NEAR = ["#3f8a8a", "#33767a", "#5aa39a"];
const PINE = ["#1f5a4a", "#2a6e58", "#3a8a68", "#56a878"];
const LEAVES = ["#2f6f2f", "#3f8f3a", "#5cb04a", "#86cf5a", "#b0e87a"];
const TRUNK = ["#5e3820", "#7a4a2a"];
const FENCE = ["#a8703f", "#c99a6a", "#7a4a2a"];
const GRASS = ["#4fae3a", "#6ccf4a", "#a8f070", "#2f7d2f"];
const SOIL = ["#7a4a2a", "#6b4228", "#8f5a32", "#4e2e1c"];
const STONE = ["#9a7a5a", "#7a5a40", "#b8956c"];
const FLOWERS = ["#ff86a8", "#ffd84a", "#fff7e6", "#b58cff", "#ff6a5a", "#ffffff"];

/** Small fixed-seed random generator, so the backdrop is identical every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Filled pixel disc. */
function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2 + 1, 1);
  }
}

/* ---------- pieces ---------- */

function sky(ctx: Ctx, w: number, h: number): void {
  const bottom = Math.round(h * 0.7);
  const band = bottom / SKY.length;
  SKY.forEach((color, i) => rect(ctx, 0, Math.round(i * band), w, h, color));
  // dithered seams between the bands, so the gradient looks hand-shaded
  for (let i = 1; i < SKY.length; i++) {
    const y0 = Math.round(i * band);
    ctx.fillStyle = SKY[i - 1]!;
    for (let x = 0; x < w; x += 2) ctx.fillRect(x + (i % 2), y0, 1, 1);
    for (let x = 0; x < w; x += 4) ctx.fillRect(x + 1, y0 + 1, 1, 1);
  }
}

/** A puffy cloud with a lit top and a shaded belly; `s` scales it. */
function cloud(ctx: Ctx, x: number, y: number, s: number, rand: () => number): void {
  const puffs = [
    { dx: 0, dy: 4, r: 4 },
    { dx: 7, dy: 1, r: 6 },
    { dx: 15, dy: 2, r: 5 },
    { dx: 22, dy: 4, r: 4 },
    { dx: 11, dy: 5, r: 5 },
  ].map((q) => ({ x: x + q.dx * s, y: y + q.dy * s, r: Math.max(2, Math.round(q.r * s * (0.85 + rand() * 0.3))) }));
  for (const q of puffs) disc(ctx, q.x, q.y + Math.round(s * 1.5), q.r, CLOUD[3]!);
  for (const q of puffs) disc(ctx, q.x, q.y + Math.round(s), q.r, CLOUD[2]!);
  for (const q of puffs) disc(ctx, q.x, q.y, q.r, CLOUD[0]!);
  for (const q of puffs) disc(ctx, q.x - Math.round(q.r * 0.3), q.y + Math.round(q.r * 0.3), Math.round(q.r * 0.5), CLOUD[1]!);
  rect(ctx, x - 2 * s, y + 5 * s, 26 * s, Math.max(1, Math.round(s)), CLOUD[2]!);
}

/** A jagged mountain range: peaks around `top`, filled down to `bottom`, lit on the left slopes. */
function mountains(ctx: Ctx, w: number, top: number, bottom: number, peakW: number, height: number, seed: number, colors: readonly string[]): void {
  const rand = seeded(seed);
  const peaks: { x: number; h: number }[] = [];
  for (let x = -peakW; x < w + peakW; x += peakW * (0.6 + rand() * 0.8)) peaks.push({ x, h: height * (0.5 + rand() * 0.5) });
  for (let x = 0; x < w; x++) {
    let y = bottom;
    let lit = false;
    for (const pk of peaks) {
      const d = Math.abs(x - pk.x);
      const py = top + (height - pk.h) + d * (pk.h / peakW) * 1.1;
      if (py < y) {
        y = py;
        lit = x < pk.x;
      }
    }
    y = Math.round(y);
    rect(ctx, x, y, 1, bottom - y, colors[0]!);
    if (!lit) rect(ctx, x, y, 1, Math.min(bottom - y, 10), colors[1]!);
    else rect(ctx, x, y, 1, 1, colors[2]!);
  }
}

/** A pine tree: stacked triangles in dark teal greens with a lit edge. */
function pine(ctx: Ctx, x: number, baseY: number, h: number, shade: number): void {
  const dark = PINE[Math.min(PINE.length - 1, shade)]!;
  const light = PINE[Math.min(PINE.length - 1, shade + 1)]!;
  rect(ctx, x - 1, baseY - Math.round(h * 0.15), 2, Math.round(h * 0.15), TRUNK[0]!);
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const tierTop = baseY - h + Math.round((t * h * 0.8) / tiers);
    const tierH = Math.round(h * 0.45);
    for (let y = 0; y < tierH; y++) {
      const half = Math.round(((y + 1) / tierH) * (h * 0.22 + t * 1.5));
      rect(ctx, x - half, tierTop + y, half * 2 + 1, 1, dark);
      rect(ctx, x - half, tierTop + y, Math.max(1, Math.round(half * 0.6)), 1, light);
    }
  }
}

/** A round leafy tree with a trunk; canopy in four tones with leaf speckles. */
function tree(ctx: Ctx, x: number, baseY: number, size: number, rand: () => number): void {
  const trunkH = Math.round(size * 0.9);
  rect(ctx, x - 2, baseY - trunkH, 5, trunkH, TRUNK[0]!);
  rect(ctx, x - 1, baseY - trunkH, 2, trunkH, TRUNK[1]!);
  const cy = baseY - trunkH - Math.round(size * 0.55);
  const blobs = [
    { dx: 0, dy: 0, r: size },
    { dx: -Math.round(size * 0.7), dy: Math.round(size * 0.35), r: Math.round(size * 0.7) },
    { dx: Math.round(size * 0.7), dy: Math.round(size * 0.3), r: Math.round(size * 0.72) },
    { dx: 0, dy: -Math.round(size * 0.55), r: Math.round(size * 0.65) },
  ];
  for (const b of blobs) disc(ctx, x + b.dx, cy + b.dy + 1, b.r + 1, INK);
  for (const b of blobs) disc(ctx, x + b.dx, cy + b.dy, b.r, LEAVES[1]!);
  for (const b of blobs) disc(ctx, x + b.dx - 1, cy + b.dy - 1, Math.round(b.r * 0.75), LEAVES[2]!);
  for (const b of blobs) disc(ctx, x + b.dx - Math.round(b.r * 0.35), cy + b.dy - Math.round(b.r * 0.35), Math.round(b.r * 0.35), LEAVES[3]!);
  // leaf speckles
  for (let i = 0; i < size * 3; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * size * 1.1;
    rect(ctx, x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 1, 1, rand() < 0.5 ? LEAVES[0]! : LEAVES[4]!);
  }
}

/** A low bush, sometimes with berries or blossoms. */
function bush(ctx: Ctx, x: number, baseY: number, size: number, rand: () => number): void {
  const blobs = [
    { dx: 0, r: size },
    { dx: -Math.round(size * 0.9), r: Math.round(size * 0.7) },
    { dx: Math.round(size * 0.9), r: Math.round(size * 0.75) },
  ];
  for (const b of blobs) disc(ctx, x + b.dx, baseY - b.r + 1, b.r + 1, INK);
  for (const b of blobs) disc(ctx, x + b.dx, baseY - b.r, b.r, LEAVES[2]!);
  for (const b of blobs) disc(ctx, x + b.dx - 1, baseY - b.r - 1, Math.round(b.r * 0.6), LEAVES[3]!);
  for (const b of blobs) rect(ctx, x + b.dx - b.r + 1, baseY - 2, b.r * 2 - 1, 2, LEAVES[1]!);
  const dots = rand() < 0.5 ? FLOWERS[rand() < 0.5 ? 0 : 5]! : null;
  if (dots) {
    for (let i = 0; i < size; i++) rect(ctx, x + (rand() - 0.5) * size * 2.4, baseY - size * 0.4 - rand() * size, 1, 1, dots);
  }
}

/** A wooden fence along the grass: posts with caps and two rails. */
function fence(ctx: Ctx, w: number, groundY: number, rand: () => number): void {
  const postH = 14;
  const gap = 18;
  for (const railY of [groundY - 11, groundY - 5]) {
    rect(ctx, 0, railY - 1, w, 4, INK);
    rect(ctx, 0, railY, w, 2, FENCE[0]!);
    rect(ctx, 0, railY, w, 1, FENCE[1]!);
  }
  for (let x = Math.floor(rand() * gap); x < w; x += gap) {
    rect(ctx, x - 1, groundY - postH - 1, 6, postH + 1, INK);
    rect(ctx, x, groundY - postH, 4, postH, FENCE[0]!);
    rect(ctx, x, groundY - postH, 1, postH, FENCE[1]!);
    rect(ctx, x + 3, groundY - postH + 1, 1, postH - 1, FENCE[2]!);
    rect(ctx, x + 1, groundY - postH - 2, 2, 1, INK); // pointed cap
  }
}

function flower(ctx: Ctx, x: number, y: number, color: string, rand: () => number): void {
  rect(ctx, x, y + 1, 1, 3, GRASS[3]!);
  if (rand() < 0.5) rect(ctx, x + 1, y + 2, 1, 1, GRASS[1]!); // leaf
  rect(ctx, x - 1, y, 3, 1, color);
  rect(ctx, x, y - 1, 1, 3, color);
  rect(ctx, x, y, 1, 1, color === FLOWERS[1] ? FLOWERS[5]! : FLOWERS[1]!);
}

/** Grass with blade tips and hanging vines, over rich brown dirt full of rounded cobbles. */
function ground(ctx: Ctx, w: number, h: number, groundY: number, rand: () => number): void {
  rect(ctx, 0, groundY - 1, w, 1, INK);
  rect(ctx, 0, groundY, w, 2, GRASS[2]!);
  rect(ctx, 0, groundY + 2, w, 3, GRASS[1]!);
  rect(ctx, 0, groundY + 5, w, 2, GRASS[0]!);
  const soilTop = groundY + 7;
  rect(ctx, 0, soilTop, w, h - soilTop, SOIL[0]!);
  // rounded cobbles packed in the dirt
  for (let y = soilTop + 1, row = 0; y < h; y += 6, row++) {
    for (let x = (row % 2) * 4 - 4 + Math.floor(rand() * 3); x < w; x += 7 + Math.floor(rand() * 3)) {
      const cw = 5 + Math.floor(rand() * 2);
      rect(ctx, x, y, cw, 5, SOIL[3]!);
      rect(ctx, x + 1, y + 1, cw - 2, 3, SOIL[rand() < 0.5 ? 2 : 1]!);
      rect(ctx, x + 1, y + 1, cw - 3, 1, STONE[2]!);
    }
  }
  // grass blades, drips and hanging vines along the edge
  for (let x = 0; x < w; x++) {
    const r = rand();
    if (r < 0.3) rect(ctx, x, groundY - 2, 1, 1, GRASS[r < 0.1 ? 1 : 2]!);
    if (r > 0.8) rect(ctx, x, groundY + 7, 1, 1 + Math.floor(rand() * 3), GRASS[0]!);
    if (r > 0.97) {
      const len = 6 + Math.floor(rand() * 14);
      for (let d = 0; d < len; d++) rect(ctx, x + (d > len / 2 ? 1 : 0), groundY + 7 + d, 1, 1, d % 3 === 2 ? GRASS[1]! : GRASS[3]!);
    }
  }
}

/**
 * Paint the backdrop at art resolution (w x h art pixels). `unit` is one screen's width in art
 * pixels; the scenery repeats every screen-width, so a multi-screen strip loops seamlessly.
 */
function paintArt(ctx: Ctx, w: number, h: number, unit = w): void {
  const groundY = Math.round(h * 0.82);
  sky(ctx, w, h);

  // each screen-width gets the same scenery (drawn one screen early too, so nothing is cut at the seam)
  for (let ox = -unit; ox < w; ox += unit) {
    const rand = seeded(20261018);
    const s = Math.max(1, unit / 240);
    ctx.save();
    ctx.translate(ox, 0);
    cloud(ctx, unit * 0.08, h * 0.12, s * 1.1, rand);
    cloud(ctx, unit * 0.38, h * 0.08, s * 0.8, rand);
    cloud(ctx, unit * 0.7, h * 0.18, s, rand);
    cloud(ctx, unit * 0.55, h * 0.3, s * 0.5, rand);
    cloud(ctx, unit * 0.9, h * 0.06, s * 0.6, rand);
    ctx.restore();
  }
  mountains(ctx, w, Math.round(h * 0.34), groundY, unit / 6, h * 0.18, 11, MOUNTAIN_FAR);
  mountains(ctx, w, Math.round(h * 0.46), groundY, unit / 9, h * 0.13, 23, MOUNTAIN_NEAR);
  // pine forest in two rows, the back row darker and smaller
  for (let ox = -unit; ox < w; ox += unit) {
    const rand = seeded(7331);
    const base = Math.max(10, Math.round(h * 0.11));
    for (let x = 0; x < unit; x += 4 + rand() * 6) pine(ctx, ox + x, groundY - Math.round(h * 0.08), Math.round(base * (0.7 + rand() * 0.4)), 0);
    for (let x = 2; x < unit; x += 6 + rand() * 9) pine(ctx, ox + x, groundY - 2, Math.round(base * (0.9 + rand() * 0.5)), 1);
    const treeSize = Math.max(6, Math.round(h * 0.06));
    for (let x = unit * 0.05 + rand() * 20; x < unit; x += unit * (0.3 + rand() * 0.3)) tree(ctx, ox + x, groundY - 2, treeSize, rand);
  }
  fence(ctx, w, groundY, seeded(99));
  for (let ox = -unit; ox < w; ox += unit) {
    const rand = seeded(4242);
    const bushSize = Math.max(4, Math.round(h * 0.028));
    for (let x = rand() * 20; x < unit; x += bushSize * 5 + rand() * bushSize * 8) bush(ctx, ox + x, groundY, bushSize, rand);
  }
  const rand = seeded(1234);
  ground(ctx, w, h, groundY, rand);
  for (let i = 0; i < w / 9; i++) flower(ctx, Math.floor(rand() * w), groundY - 4, FLOWERS[Math.floor(rand() * FLOWERS.length)]!, rand);
}

/** Fill `ctx` (w x h real pixels) with the pixel backdrop, on the shared art-pixel grid. */
export function drawPixelBackdrop(ctx: Ctx, w: number, h: number): void {
  const pixel = artPixelSize(h);
  const artW = Math.max(40, Math.round(w / pixel));
  const artH = Math.max(40, Math.round(h / pixel));
  const art = document.createElement("canvas");
  art.width = artW;
  art.height = artH;
  paintArt(art.getContext("2d")!, artW, artH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, 0, 0, w, h);
  ctx.restore();
}

/**
 * A wider backdrop for scrolling: `screens` screen-widths side by side, drawn at the same
 * pixel size as drawPixelBackdrop (so it looks identical), for a canvas of w x h real pixels.
 */
export function drawPixelBackdropStrip(ctx: Ctx, w: number, h: number, screens: number): void {
  const pixel = artPixelSize(h);
  const unit = Math.max(40, Math.round(w / screens / pixel));
  const artW = unit * screens;
  const artH = Math.max(40, Math.round(h / pixel));
  const art = document.createElement("canvas");
  art.width = artW;
  art.height = artH;
  paintArt(art.getContext("2d")!, artW, artH, unit);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, 0, 0, w, h);
  ctx.restore();
}
