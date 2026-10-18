/* ------------------------------------------------------------------
   A constant pixel-art backdrop (sky, clouds, hills, bushes, grassy brick ground),
   drawn in code so no image files are needed. It looks the same every time; only its
   size follows the photo. Detected desk sprites are drawn on top of it.
   ------------------------------------------------------------------ */

const INK = "#2b1d3a";
const SKY_BANDS = ["#5cb8ff", "#74c4ff", "#8fd0ff", "#a8dcff", "#bfe8ff"];
const HILL = "#8fd3e8";
const HILL_SHADE = "#74bcd6";
const BUSH = "#5cbf5a";
const BUSH_LIGHT = "#a8e86c";
const GRASS = "#a8e86c";
const GRASS_DARK = "#5cbf5a";
const DIRT = "#f08a30";
const DIRT_LIGHT = "#ffb870";
const ROCK = "#e0905a";
const ROCK_SHADE = "#a8573a";

/** Art pixels across the backdrop; each one is scaled up to a block on the real canvas. */
const ART_WIDTH = 160;

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

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y + 2 * s, 12 * s, 3 * s);
  ctx.fillRect(x + 2 * s, y + s, 5 * s, 2 * s);
  ctx.fillRect(x + 3 * s, y, 3 * s, s);
  ctx.fillRect(x + 6 * s, y + s, 4 * s, s);
  ctx.fillStyle = "#e8f7ff";
  ctx.fillRect(x, y + 4 * s, 12 * s, s);
}

/** Row of rounded bumps (hills or bushes) whose tops sit around `top`; filled down to `bottom`. */
function bumps(
  ctx: CanvasRenderingContext2D,
  w: number,
  top: number,
  bottom: number,
  radius: number,
  rand: () => number,
  fill: string,
  shade: string,
  checker: string | null,
): void {
  for (let cx = -radius; cx < w + radius; cx += radius * 1.6 + rand() * radius) {
    const r = radius * (0.75 + rand() * 0.5);
    const cy = top + r;
    for (let y = Math.floor(cy - r); y < bottom; y++) {
      const dy = Math.max(0, cy - y);
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      if (half <= 0) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(Math.round(cx - half), y, half * 2, 1);
      ctx.fillStyle = shade;
      ctx.fillRect(Math.round(cx + half - 2), y, 2, 1);
      if (checker) {
        ctx.fillStyle = checker;
        for (let x = Math.round(cx - half) + 1; x < cx + half - 2; x++) {
          if ((x + y) % 4 === 0) ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
}

/**
 * Paint the backdrop at art resolution (w x h art pixels). `unit` is one screen's width in art
 * pixels; features are sized from it, so a multi-screen strip looks like the single screen.
 */
function paintArt(ctx: CanvasRenderingContext2D, w: number, h: number, unit = w): void {
  const rand = seeded(20261018);

  // sky in flat bands
  SKY_BANDS.forEach((color, i) => {
    ctx.fillStyle = color;
    const y0 = Math.floor((h * 0.62 * i) / SKY_BANDS.length);
    ctx.fillRect(0, y0, w, h - y0);
  });

  // clouds (the same pattern on every screen-width)
  const s = Math.max(1, Math.round(unit / 160));
  for (let ox = 0; ox < w; ox += unit) {
    cloud(ctx, ox + Math.round(unit * 0.06), Math.round(h * 0.08), s);
    cloud(ctx, ox + Math.round(unit * 0.42), Math.round(h * 0.16), s);
    cloud(ctx, ox + Math.round(unit * 0.74), Math.round(h * 0.05), s);
    cloud(ctx, ox + Math.round(unit * 0.88), Math.round(h * 0.3), s);
    cloud(ctx, ox + Math.round(unit * 0.22), Math.round(h * 0.34), s);
  }

  const groundTop = Math.round(h * 0.82);

  // far hills, then nearer bushes
  bumps(ctx, w, Math.round(h * 0.52), groundTop, Math.max(6, unit * 0.07), rand, HILL, HILL_SHADE, null);
  bumps(ctx, w, Math.round(h * 0.68), groundTop, Math.max(4, unit * 0.04), rand, BUSH, GRASS_DARK, BUSH_LIGHT);

  // ground: dark edge, grass, then orange brick dirt with rocks
  ctx.fillStyle = INK;
  ctx.fillRect(0, groundTop - 1, w, 1);
  ctx.fillStyle = GRASS;
  ctx.fillRect(0, groundTop, w, 3);
  ctx.fillStyle = GRASS_DARK;
  ctx.fillRect(0, groundTop + 3, w, 2);
  for (let x = 0; x < w; x += 3) ctx.fillRect(x, groundTop + 5, 1, 1 + (x % 2)); // grass drips

  const dirtTop = groundTop + 5;
  ctx.fillStyle = DIRT;
  ctx.fillRect(0, dirtTop, w, h - dirtTop);
  const brickH = 4;
  const brickW = 8;
  for (let y = dirtTop + 2; y < h; y += brickH) {
    const offset = ((y - dirtTop) / brickH) % 2 === 0 ? 0 : brickW / 2;
    ctx.fillStyle = DIRT_LIGHT;
    for (let x = -offset; x < w; x += brickW) ctx.fillRect(x + 1, y, brickW - 2, 1);
    ctx.fillStyle = ROCK_SHADE;
    for (let x = -offset; x < w; x += brickW) ctx.fillRect(x, y, 1, brickH - 1);
  }
  for (let i = 0; i < Math.round(w / 14); i++) {
    const rx = Math.floor(rand() * w);
    const ry = dirtTop + 3 + Math.floor(rand() * Math.max(1, h - dirtTop - 6));
    ctx.fillStyle = ROCK_SHADE;
    ctx.fillRect(rx - 1, ry - 1, 5, 4);
    ctx.fillStyle = ROCK;
    ctx.fillRect(rx, ry - 1, 3, 3);
  }

  // a few flowers in the grass
  for (let i = 0; i < Math.round(w / 20); i++) {
    const fx = Math.floor(rand() * w);
    ctx.fillStyle = GRASS_DARK;
    ctx.fillRect(fx, groundTop - 3, 1, 3);
    ctx.fillStyle = rand() > 0.5 ? "#ff86a8" : "#ffd84a";
    ctx.fillRect(fx - 1, groundTop - 5, 3, 2);
  }
}

/** Fill `ctx` (w x h real pixels) with the pixel backdrop, scaled up with crisp nearest-neighbor blocks. */
export function drawPixelBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const artW = ART_WIDTH;
  const artH = Math.max(40, Math.round((h / Math.max(1, w)) * ART_WIDTH));
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
export function drawPixelBackdropStrip(ctx: CanvasRenderingContext2D, w: number, h: number, screens: number): void {
  const artW = ART_WIDTH * screens;
  const artH = Math.max(40, Math.round((h / Math.max(1, w / screens)) * ART_WIDTH));
  const art = document.createElement("canvas");
  art.width = artW;
  art.height = artH;
  paintArt(art.getContext("2d")!, artW, artH, ART_WIDTH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, 0, 0, w, h);
  ctx.restore();
}
