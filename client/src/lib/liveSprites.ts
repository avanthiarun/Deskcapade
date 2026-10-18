import type { Box, DetectedObject } from "@deskcapade/shared";
import { pickDeskObjects } from "./deskFilter";
import { drawSpriteShadow, makeDeskSprite, type DeskSprite } from "./deskSprites";
import { drawPixelBackdropStrip } from "./pixelBackdrop";
import { findSpriteTemplate } from "./spriteDictionary";

/* ------------------------------------------------------------------
   Story mode's live version of the Challenge effect: every desk object in the
   video is covered by its pixel sprite, and the sprites move with the picture.

   Detection results arrive a few times per second and are always a little late,
   so two things keep the sprites glued to their objects in between:
   1) CameraMotion measures how the whole picture shifts from frame to frame
      (you moving the phone), and every sprite is moved by that shift right away.
   2) Each object's box glides smoothly to the newest detection.
   New objects pop in with sparkles; objects that leave shrink away.
   ------------------------------------------------------------------ */

/** Normalized point (fractions of the picture's width / height). */
type Pan = { x: number; y: number };

const MOTION_W = 80; // the motion estimator works on a tiny grayscale copy this wide
const SEARCH_X = 7; // max shift searched per comparison, in tiny-copy pixels
const SEARCH_Y = 5;
const REBASE_PX = 3; // once the picture has moved this far from the reference, make a new reference
const PAN_HISTORY_MS = 6000;

/**
 * Estimates how far the picture's content has slid since the page opened (camera panning).
 * Compares each new frame to a reference frame (not just the previous one), so slow pans
 * don't get lost to rounding.
 */
export class CameraMotion {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private ref: Float32Array | null = null;
  private refW = 0;
  private refH = 0;
  /** Content offset when the reference frame was taken. */
  private refPan: Pan = { x: 0, y: 0 };
  private pan: Pan = { x: 0, y: 0 };
  private history: { t: number; pan: Pan }[] = [];

  constructor() {
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  /** Where content that was at (0,0) when the page opened is now (normalized). */
  get current(): Pan {
    return { ...this.pan };
  }

  /** The offset at an earlier moment (used to place late detection results). */
  at(time: number): Pan {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (h && h.t <= time) return { ...h.pan };
    }
    return { ...(this.history[0]?.pan ?? this.pan) };
  }

  reset(): void {
    this.ref = null;
    this.refPan = { x: 0, y: 0 };
    this.pan = { x: 0, y: 0 };
    this.history = [];
  }

  /** Feed the newest frame (call once per new video frame). */
  update(frame: CanvasImageSource, width: number, height: number, now: number): void {
    if (width <= 0 || height <= 0) return;
    const w = MOTION_W;
    const h = Math.max(8, Math.round((height / width) * MOTION_W));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.ref = null;
    }
    this.ctx.drawImage(frame, 0, 0, w, h);
    const d = this.ctx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0);
    }

    if (!this.ref || this.refW !== w || this.refH !== h) {
      this.ref = gray;
      this.refW = w;
      this.refH = h;
      this.refPan = { ...this.pan };
      this.record(now);
      return;
    }

    const shift = this.bestShift(this.ref, gray, w, h);
    if (shift) {
      this.pan = { x: this.refPan.x + shift.dx / w, y: this.refPan.y + shift.dy / h };
      if (Math.abs(shift.dx) >= REBASE_PX || Math.abs(shift.dy) >= REBASE_PX) {
        this.ref = gray;
        this.refPan = { ...this.pan };
      }
    } else {
      // no trustworthy match (big change, a hand in front of the camera...): start fresh from here
      this.ref = gray;
      this.refPan = { ...this.pan };
    }
    this.record(now);
  }

  private record(now: number): void {
    this.history.push({ t: now, pan: { ...this.pan } });
    while ((this.history[0]?.t ?? now) < now - PAN_HISTORY_MS) this.history.shift();
  }

  /** Shift (in tiny-copy pixels, sub-pixel) that best lines `cur` up with `ref`, or null if unsure. */
  private bestShift(ref: Float32Array, cur: Float32Array, w: number, h: number): { dx: number; dy: number } | null {
    const cost = (dx: number, dy: number): number => {
      let sum = 0;
      let n = 0;
      for (let y = SEARCH_Y; y < h - SEARCH_Y; y += 1) {
        for (let x = SEARCH_X; x < w - SEARCH_X; x += 1) {
          sum += Math.abs((cur[(y + dy) * w + (x + dx)] ?? 0) - (ref[y * w + x] ?? 0));
          n++;
        }
      }
      return n > 0 ? sum / n : Infinity;
    };

    let best = { dx: 0, dy: 0, c: Infinity };
    const grid = new Map<string, number>();
    for (let dy = -SEARCH_Y; dy <= SEARCH_Y; dy++) {
      for (let dx = -SEARCH_X; dx <= SEARCH_X; dx++) {
        const c = cost(dx, dy);
        grid.set(`${dx},${dy}`, c);
        if (c < best.c) best = { dx, dy, c };
      }
    }
    const still = grid.get("0,0") ?? Infinity;
    // flat / featureless picture, or the match is no better than not moving: trust "no motion"
    if (!Number.isFinite(best.c) || still - best.c < 0.4) return still < 25 ? { dx: 0, dy: 0 } : null;
    if (best.c > 30) return null;

    // sub-pixel refinement with a parabola through the neighbors
    const refine = (cm: number | undefined, c0: number, cp: number | undefined): number => {
      if (cm === undefined || cp === undefined) return 0;
      const den = cm - 2 * c0 + cp;
      return den > 0 ? Math.max(-0.5, Math.min(0.5, (cm - cp) / (2 * den))) : 0;
    };
    return {
      dx: best.dx + refine(grid.get(`${best.dx - 1},${best.dy}`), best.c, grid.get(`${best.dx + 1},${best.dy}`)),
      dy: best.dy + refine(grid.get(`${best.dx},${best.dy - 1}`), best.c, grid.get(`${best.dx},${best.dy + 1}`)),
    };
  }
}

/* ---------- the sprite layer ---------- */

const MISS_LIMIT = 1; // a sprite leaves as soon as a scan no longer finds its object
const GLIDE_MS = 140; // how quickly a sprite settles onto its newest detected spot
const POP_MS = 450;
const SPARKLE_MS = 650;
const LEAVE_MS = 280;
const SPARKLE_COLORS = ["#fff7e6", "#ffd84a", "#ff86a8"];

/* pixel background: pinned to the real world, revealed tile by tile */
const STRIP_SCREENS = 4; // the backdrop repeats every this many screen-widths
const FILL_MS = 1600; // turning it on: the whole screen fills in over this long
const EDGE_FILL_MS = 600; // tiles that slide into view fill in within this long
const CLEAR_MS = 700; // turning it off: tiles disappear over this long
const MAX_TILES = 30000; // forget revealed tiles after this many (long pans)

type LiveTrack = {
  label: string;
  templateId: string | null;
  /** Box in "world" coordinates (normalized, with camera motion taken out). */
  target: Box;
  shown: Box;
  misses: number;
  sprite: DeskSprite | null;
  bornAt: number;
  /** Set when the object is gone; the sprite shrinks away from this moment. */
  leftAt: number | null;
};

const iou = (a: Box, b: Box): number => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** `b` grown by `frac` of its size on every side, kept inside the picture. */
const padBox = (b: Box, frac: number, maxW: number, maxH: number): Box => {
  const x = Math.max(0, b.x - b.w * frac);
  const y = Math.max(0, b.y - b.h * frac);
  return {
    x,
    y,
    w: Math.min(maxW, b.x + b.w * (1 + frac)) - x,
    h: Math.min(maxH, b.y + b.h * (1 + frac)) - y,
  };
};

const easeOutBack = (p: number): number => {
  const c = 1.9;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const s = Math.max(1, Math.round(size));
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x - s / 2), Math.round(y - s * 1.5), s, s * 3);
  ctx.fillRect(Math.round(x - s * 1.5), Math.round(y - s / 2), s * 3, s);
}

/**
 * Live pixel sprites over a video. Per animation frame:
 *   1) draw the raw video frame onto the canvas
 *   2) layer.frame(ctx, isNewVideoFrame)   (measures motion, makes sprites for new objects)
 *   3) layer.draw(ctx)                      (backdrop if pixel world is on, then sprites)
 * Whenever a detection result arrives: layer.update(objects, imageSize, panAtCapture).
 */
export class LiveSpriteLayer {
  readonly motion = new CameraMotion();
  /** Turn the pixel background on by itself the first time desk objects are found (like Challenge). */
  autoPixelWorld = true;
  private tracks: LiveTrack[] = [];
  private pending: { objects: DetectedObject[]; imageSize: { w: number; h: number }; pan: Pan } | null = null;
  private lastNow = 0;

  private worldOn = false;
  private worldChangedAt = 0;
  private autoDone = false;
  private strip: HTMLCanvasElement | null = null;
  private tile = 8;
  /** When each world tile (key "tx,ty") turns into backdrop. */
  private revealAt = new Map<string, number>();

  /** Is the pixel background on (or filling in)? */
  get pixelWorld(): boolean {
    return this.worldOn;
  }

  /** Turn the pixel background on (fills in tile by tile) or off (tiles drop away). */
  setPixelWorld(on: boolean, now = performance.now()): void {
    this.autoDone = true; // a manual choice wins over the automatic start
    if (on === this.worldOn) return;
    this.worldOn = on;
    this.worldChangedAt = now;
    if (on) this.revealAt.clear();
  }

  /** Desk objects currently shown (not the ones leaving). */
  get count(): number {
    return this.tracks.filter((t) => t.leftAt === null && t.misses === 0).length;
  }

  labels(): string[] {
    return [...new Set(this.tracks.filter((t) => t.leftAt === null && t.misses === 0).map((t) => t.label))];
  }

  clear(): void {
    this.tracks = [];
    this.pending = null;
    this.motion.reset();
    this.revealAt.clear();
  }

  /**
   * A new detection result. `pan` is the camera offset when the scanned frame was captured
   * (`motion.current` at capture time, or `motion.at(time)`); defaults to "now".
   */
  update(objects: readonly DetectedObject[], imageSize: { w: number; h: number }, pan?: Pan): void {
    this.pending = { objects: [...objects], imageSize, pan: pan ?? this.motion.current };
  }

  /**
   * Call right after drawing the raw video frame (before any overlay) on `ctx`.
   * Returns true when a new detection result was applied (time to refresh counts / labels).
   */
  frame(ctx: CanvasRenderingContext2D, isNewVideoFrame: boolean, now = performance.now()): boolean {
    const { width: W, height: H } = ctx.canvas;
    if (isNewVideoFrame) this.motion.update(ctx.canvas, W, H, now);
    if (!this.pending) return false;
    this.applyDetections(ctx.canvas, this.pending.objects, this.pending.imageSize, this.pending.pan, now);
    this.pending = null;
    return true;
  }

  private applyDetections(
    photo: HTMLCanvasElement,
    objects: DetectedObject[],
    imageSize: { w: number; h: number },
    pan: Pan,
    now: number,
  ): void {
    if (imageSize.w <= 0 || imageSize.h <= 0 || photo.width === 0) return;
    // same desk-only filter as Challenge (background, far away, blurry)
    const { kept } = pickDeskObjects(photo, objects, imageSize);
    const panNow = this.motion.current;
    const matched = new Set<LiveTrack>();

    for (const c of kept) {
      // photo pixels -> normalized screen box at capture time -> world box
      const world: Box = {
        x: c.box.x / photo.width - pan.x,
        y: c.box.y / photo.height - pan.y,
        w: c.box.w / photo.width,
        h: c.box.h / photo.height,
      };
      const templateId = findSpriteTemplate(c.label)?.id ?? null;

      let best: LiveTrack | null = null;
      let bestScore = 0;
      for (const t of this.tracks) {
        if (matched.has(t) || t.leftAt !== null) continue;
        const overlap = iou(t.target, world);
        const same = t.templateId !== null && t.templateId === templateId;
        const sameLabel = t.label.toLowerCase() === c.label.toLowerCase();
        if (overlap < 0.15 || (!same && !sameLabel && overlap < 0.5)) continue;
        const score = overlap + (same || sameLabel ? 0.3 : 0);
        if (score > bestScore) {
          best = t;
          bestScore = score;
        }
      }

      if (best) {
        best.target = world;
        best.misses = 0;
        matched.add(best);
        if (templateId !== null && templateId !== best.templateId) {
          // it turned out to be something else: redraw its sprite
          best.label = c.label;
          best.templateId = templateId;
          best.sprite = null;
        }
      } else {
        const t: LiveTrack = {
          label: c.label,
          templateId,
          target: world,
          shown: { ...world },
          misses: 0,
          sprite: null,
          bornAt: now,
          leftAt: null,
        };
        this.tracks.push(t);
        matched.add(t);
      }
    }

    for (const t of this.tracks) {
      if (matched.has(t) || t.leftAt !== null) continue;
      t.misses += 1;
      if (t.misses >= MISS_LIMIT) t.leftAt = now;
    }

    if (this.autoPixelWorld && !this.autoDone && kept.length > 0) this.setPixelWorld(true, now);

    // make sprites for new / changed objects from the current frame, at where they are now
    for (const t of this.tracks) {
      if (t.sprite || t.leftAt !== null) continue;
      const box: Box = {
        x: (t.target.x + panNow.x) * photo.width,
        y: (t.target.y + panNow.y) * photo.height,
        w: t.target.w * photo.width,
        h: t.target.h * photo.height,
      };
      if (box.w < 2 || box.h < 2) continue;
      // Detection boxes hug the object, so the color sampler would mistake the object's own edge
      // for background. Give dictionary objects a margin of real background around them.
      t.sprite = makeDeskSprite(t.label, photo, t.templateId ? padBox(box, 0.12, photo.width, photo.height) : box);
    }
  }

  /**
   * The pixel background, pinned to the world: it slides with the camera like the video does.
   * Each tile has its own moment to turn from video into backdrop, so it fills in pixel by pixel,
   * and tiles that slide in at the edge fill in shortly after they appear.
   */
  private drawBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, pan: Pan, now: number): void {
    const clearing = !this.worldOn && now - this.worldChangedAt < CLEAR_MS;
    if (!this.worldOn && !clearing) {
      if (this.revealAt.size > 0) this.revealAt.clear();
      return;
    }

    const stripW = W * STRIP_SCREENS;
    if (!this.strip || this.strip.width !== stripW || this.strip.height !== H) {
      this.strip = document.createElement("canvas");
      this.strip.width = stripW;
      this.strip.height = H;
      drawPixelBackdropStrip(this.strip.getContext("2d")!, stripW, H, STRIP_SCREENS);
      // tile size that divides the strip exactly, so tiles never straddle its wrap-around
      this.tile = stripW / Math.round(stripW / Math.max(8, Math.round(W / 60)));
      this.revealAt.clear();
    }
    if (this.revealAt.size > MAX_TILES) this.revealAt.clear();

    const T = this.tile;
    const offX = pan.x * W; // content has slid this far right; only sideways motion moves the backdrop
    const rows = Math.ceil(H / T);
    const first = Math.floor(-offX / T);
    const last = Math.floor((W - offX) / T);
    const sinceChange = now - this.worldChangedAt;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let tx = first; tx <= last; tx++) {
      const sx = (((tx * T) % stripW) + stripW) % stripW; // where this world column is in the strip
      const dx = Math.round(tx * T + offX);
      const dw = Math.round((tx + 1) * T + offX) - dx;
      for (let ty = 0; ty < rows; ty++) {
        const key = `${tx},${ty}`;
        let at = this.revealAt.get(key);
        if (at === undefined) {
          at = sinceChange < FILL_MS
            ? this.worldChangedAt + (0.7 * Math.random() + 0.3 * (ty / Math.max(1, rows - 1))) * FILL_MS
            : now + Math.random() * EDGE_FILL_MS;
          this.revealAt.set(key, at);
        }
        if (now < at) continue;
        // turning off: every tile drops away at its own (stable) moment
        if (clearing && sinceChange > ((at * 7919) % 1000) / 1000 * CLEAR_MS) continue;
        const sy = ty * T;
        ctx.drawImage(this.strip, sx, sy, T, Math.min(T, H - sy), dx, Math.round(sy), dw, Math.min(T, H - sy));
      }
    }
    ctx.restore();
  }

  /** Draw the backdrop (when pixel world is on) and every sprite onto `ctx`. */
  draw(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    const { width: W, height: H } = ctx.canvas;
    const dt = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;
    const glide = 1 - Math.exp(-dt / GLIDE_MS);
    const pan = this.motion.current;

    this.drawBackdrop(ctx, W, H, pan, now);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.tracks = this.tracks.filter((t) => t.leftAt === null || now - t.leftAt < LEAVE_MS);
    for (const [i, t] of this.tracks.entries()) {
      t.shown.x += (t.target.x - t.shown.x) * glide;
      t.shown.y += (t.target.y - t.shown.y) * glide;
      t.shown.w += (t.target.w - t.shown.w) * glide;
      t.shown.h += (t.target.h - t.shown.h) * glide;
      if (!t.sprite) continue;

      // where the object is on screen right now (camera motion added back in)
      const bx = (t.shown.x + pan.x) * W;
      const by = (t.shown.y + pan.y) * H;
      const bw = t.shown.w * W;
      const bh = t.shown.h * H;

      const grow = clamp01((now - t.bornAt) / POP_MS);
      const shrink = t.leftAt === null ? 1 : 1 - clamp01((now - t.leftAt) / LEAVE_MS);
      const k = Math.max(0, easeOutBack(grow)) * shrink;
      if (k <= 0) continue;

      const pad = Math.min(bw, bh) * 0.04;
      const w = (bw + pad * 2) * k;
      const h = (bh + pad * 2) * k;
      const x = bx - pad + (bw + pad * 2 - w) / 2;
      const y = by - pad + (bh + pad * 2 - h); // grows up from the bottom of its box
      const zoom = Math.max(1, Math.min(w / t.sprite.canvas.width, h / t.sprite.canvas.height));

      ctx.globalAlpha = t.misses > 0 ? 0.75 : 1; // a little see-through while it might be leaving
      if (this.pixelWorld) drawSpriteShadow(ctx, { x, y, w, h, zoom });
      ctx.drawImage(t.sprite.canvas, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
      ctx.globalAlpha = 1;

      const age = now - t.bornAt;
      if (age < SPARKLE_MS) {
        const f = age / SPARKLE_MS;
        const cx = bx + bw / 2;
        const cy = by + bh / 2;
        const reach = Math.max(bw, bh) * (0.35 + 0.45 * f);
        ctx.globalAlpha = 1 - f;
        for (let n = 0; n < 6; n++) {
          const a = (n / 6) * Math.PI * 2 + i;
          sparkle(ctx, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach * 0.8, Math.max(2, zoom * (1.6 - f)), SPARKLE_COLORS[n % 3] ?? "#fff");
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }
}

/** Fill the "Detected: ..." text for the live sprite layer; hidden when nothing is shown. */
export function renderLiveDetectedText(el: HTMLElement, layer: LiveSpriteLayer): void {
  const labels = layer.labels();
  el.textContent = labels.length > 0 ? `Detected: ${labels.join(" • ")}` : "";
  el.hidden = labels.length === 0;
}
