import type { Box, DetectedObject } from "@deskcapade/shared";
import { findSpriteTemplate } from "./spriteDictionary";
import { listedKind } from "../game/materials";

/* ------------------------------------------------------------------
   Desk objects only: decide which detections are things ON the desk (foreground)
   and which are background (wall, furniture, people, anything on the floor), far away,
   or cut off by the edge of the picture, then blur everything that isn't a kept desk object.

   Three signals, all measured on the photo in the browser:
   - sharpness inside the box (in-focus things have crisp edges; far / out-of-focus things don't),
     normalized by the box's own contrast so a pale mug on a pale desk isn't punished
   - size: tiny boxes are usually far away, giant boxes are usually the desk or wall itself
   - what it is: labels like wall / ceiling / chair / person are background, as are boxes
     that are flat and featureless (a patch of wall) or mostly covered by a person / furniture
   ------------------------------------------------------------------ */

/** The photo is analysed at this width (fast, and makes sharpness comparable between photos). */
const ANALYSIS_WIDTH = 320;
/** Smaller than this fraction of the photo = too far away. */
const MIN_AREA_FRACTION = 0.003;
/** One object covering this much of the photo (or more) is the desk / wall itself, not an object on it. */
const MAX_AREA_FRACTION = 1 / 3;
/** Below this fraction of the sharpest object's sharpness = out of focus (background). */
const MIN_RELATIVE_SHARPNESS = 0.15;
/** Combined score (0..1) an object needs to count as a desk object. */
const MIN_SCORE = 0.3;
/** Grayscale standard deviation below this = a flat patch (wall, ceiling) unless it's a known object. */
const FLAT_STD = 3;

/** Head nouns that mean "this is the room, not a thing on the desk". */
const BACKGROUND_WORDS = [
  "wall", "ceiling", "floor", "window", "door", "curtain", "blind", "blinds", "desk", "table",
  "tabletop", "countertop", "counter", "surface", "shelf", "shelves", "bookshelf", "bookcase",
  "cabinet", "drawer", "furniture", "chair", "sofa", "couch", "bed", "room", "background",
  "person", "people", "man", "woman", "boy", "girl", "child", "kid", "face", "head", "hair",
  "hand", "arm", "finger", "fingers", "body", "shirt", "poster", "painting", "rug", "carpet",
];
/**
 * The game happens on the desk: the desk is the lowest level, so anything on the floor is skipped.
 * (Matched anywhere in the label: "trash can on the floor" is a floor thing, not a can.)
 */
const FLOOR_PATTERN =
  /(?:floor|flooring|floorboards?|rugs?|carpets?|trash ?cans?|wastebaskets?|waste baskets?|garbage cans?|bins?|shoes?|slippers?|sneakers?|boots?|socks?|baseboards?|on the ground|chair legs?|table legs?|desk legs?)/i;
/** Labels for the desk itself (to find where its top is). */
const DESK_WORDS = ["desk", "table", "tabletop", "countertop", "workspace", "workbench"];
/** A box this close to the picture's edge (fraction of its size) is cut off: only part of it is in view. */
const EDGE_MARGIN = 0.012;
/** Live video: boxes wobble from frame to frame, so only boxes right at the edge count as cut off. */
const LIVE_EDGE_MARGIN = 0.004;
/** A listed object (can, mug...) may fill this much of the picture: a close-up side view of a tall thing. */
const MAX_LISTED_AREA_FRACTION = 0.65;

/** Background labels whose box hides whatever is inside it (a person, a chair...). */
const COVERING_WORDS = [
  "person", "people", "man", "woman", "boy", "girl", "child", "kid", "face", "body", "shirt",
  "chair", "sofa", "couch", "bed", "cabinet", "shelf", "bookcase",
];

export type SkipReason = "background" | "far" | "blurry" | "floor" | "cut off";

export type DeskCandidate = {
  object: DetectedObject;
  /** Box in the photo's own pixels. */
  box: Box;
  label: string;
  /** Box area / photo area. */
  areaFraction: number;
  /** Edge detail per unit of contrast inside the box (higher = sharper). */
  sharpness: number;
  /** 0..1 foreground score. */
  score: number;
};

export type SkippedCandidate = DeskCandidate & { reason: SkipReason };

export type DeskFilterResult = { kept: DeskCandidate[]; skipped: SkippedCandidate[] };

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const headNoun = (label: string): string => {
  const words = label.toLowerCase().match(/[a-z]+/g) ?? [];
  return words[words.length - 1] ?? "";
};

const isWord = (label: string, words: readonly string[]): boolean => words.includes(headNoun(label));

/** Is this label the room/people rather than an object? Known sprite objects are never background. */
export function isBackgroundLabel(label: string): boolean {
  return findSpriteTemplate(label) === null && isWord(label, BACKGROUND_WORDS);
}

const scaleBox = (b: Box, sx: number, sy: number): Box => ({ x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy });

const clipBox = (b: Box, w: number, h: number): Box => {
  const x = Math.max(0, Math.min(w, b.x));
  const y = Math.max(0, Math.min(h, b.y));
  return { x, y, w: Math.max(0, Math.min(w, b.x + b.w) - x), h: Math.max(0, Math.min(h, b.y + b.h) - y) };
};

/** Fraction of `a` that lies inside `b`. */
const coveredBy = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = a.w * a.h;
  return area > 0 ? (ix * iy) / area : 0;
};

/** Grayscale copy of the photo plus the absolute Laplacian (edge detail) at every pixel. */
class EdgeMap {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  private readonly gray: Float32Array;
  private readonly lap: Float32Array;

  constructor(src: HTMLCanvasElement) {
    this.scale = Math.min(1, ANALYSIS_WIDTH / Math.max(1, src.width));
    this.width = Math.max(3, Math.round(src.width * this.scale));
    this.height = Math.max(3, Math.round(src.height * this.scale));

    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, this.width, this.height);
    const d = ctx.getImageData(0, 0, this.width, this.height).data;

    const n = this.width * this.height;
    this.gray = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.gray[i] = 0.299 * (d[i * 4] ?? 0) + 0.587 * (d[i * 4 + 1] ?? 0) + 0.114 * (d[i * 4 + 2] ?? 0);
    }

    this.lap = new Float32Array(n);
    const w = this.width;
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v =
          4 * (this.gray[i] ?? 0) -
          (this.gray[i - 1] ?? 0) -
          (this.gray[i + 1] ?? 0) -
          (this.gray[i - w] ?? 0) -
          (this.gray[i + w] ?? 0);
        this.lap[i] = Math.abs(v);
      }
    }
  }

  /** Sharpness and contrast inside a box given in source-photo pixels (inner 80%, so edges against the background don't count). */
  measure(box: Box): { sharpness: number; std: number } {
    const inset = 0.1;
    const x0 = Math.max(1, Math.floor((box.x + box.w * inset) * this.scale));
    const y0 = Math.max(1, Math.floor((box.y + box.h * inset) * this.scale));
    const x1 = Math.min(this.width - 1, Math.ceil((box.x + box.w * (1 - inset)) * this.scale));
    const y1 = Math.min(this.height - 1, Math.ceil((box.y + box.h * (1 - inset)) * this.scale));

    let n = 0;
    let sum = 0;
    let sumSq = 0;
    let lapSum = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * this.width + x;
        const g = this.gray[i] ?? 0;
        sum += g;
        sumSq += g * g;
        lapSum += this.lap[i] ?? 0;
        n++;
      }
    }
    if (n === 0) return { sharpness: 0, std: 0 };
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return { sharpness: lapSum / n / (std + 6), std };
  }
}

/**
 * Splits detections into desk objects (kept) and background / far-away things (skipped).
 * `imageSize` is the size the boxes are measured in (the scan response's imageSize).
 */
export function pickDeskObjects(
  photo: HTMLCanvasElement,
  objects: readonly DetectedObject[],
  imageSize: { w: number; h: number },
  opts: {
    /** Live video (Story): gentler, so objects don't flicker in and out from scan to scan. */
    live?: boolean;
  } = {},
): DeskFilterResult {
  const kept: DeskCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  if (objects.length === 0 || photo.width === 0 || photo.height === 0) return { kept, skipped };

  const sx = imageSize.w > 0 ? photo.width / imageSize.w : 1;
  const sy = imageSize.h > 0 ? photo.height / imageSize.h : 1;
  const photoArea = photo.width * photo.height;
  const edges = new EdgeMap(photo);

  const all = objects.map((object) => {
    const box = clipBox(scaleBox(object.box, sx, sy), photo.width, photo.height);
    const label = object.label?.trim() || "object";
    const { sharpness, std } = edges.measure(box);
    const candidate: DeskCandidate = {
      object,
      box,
      label,
      areaFraction: (box.w * box.h) / photoArea,
      sharpness,
      score: 0,
    };
    return { candidate, std };
  });

  const coverBoxes = all
    .filter((a) => isWord(a.candidate.label, COVERING_WORDS) && findSpriteTemplate(a.candidate.label) === null)
    .map((a) => a.candidate.box);

  // the desk's top surface, if it was detected: everything entirely below the desk is on the floor
  const desk = all
    .map((a) => a.candidate)
    .filter((c) => isWord(c.label, DESK_WORDS))
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const margin = opts.live ? LIVE_EDGE_MARGIN : EDGE_MARGIN;
  const mx = photo.width * margin;
  const my = photo.height * margin;
  const cutOff = (b: Box): boolean => b.x <= mx || b.y <= my || b.x + b.w >= photo.width - mx || b.y + b.h >= photo.height - my;

  // 1) what it is, where it is, and how big it is
  const remaining: DeskCandidate[] = [];
  for (const { candidate, std } of all) {
    const known = findSpriteTemplate(candidate.label) !== null;
    const covered = coverBoxes.some((b) => b !== candidate.box && coveredBy(candidate.box, b) > 0.8);
    const belowDesk = desk !== undefined && candidate !== desk && candidate.box.y >= desk.box.y + desk.box.h;
    if (FLOOR_PATTERN.test(candidate.label) || belowDesk) {
      skipped.push({ ...candidate, reason: "floor" });
    } else if (cutOff(candidate.box)) {
      skipped.push({ ...candidate, reason: "cut off" });
    } else if (isBackgroundLabel(candidate.label) || (!known && (std < FLAT_STD || covered))) {
      skipped.push({ ...candidate, reason: "background" });
    } else if (candidate.areaFraction < MIN_AREA_FRACTION) {
      skipped.push({ ...candidate, reason: "far" });
    } else if (candidate.areaFraction >= (listedKind(candidate.label) ? MAX_LISTED_AREA_FRACTION : MAX_AREA_FRACTION)) {
      skipped.push({ ...candidate, reason: "background" });
    } else {
      remaining.push(candidate);
    }
  }

  // 2) focus + size + position, relative to the sharpest object in this photo
  const sharpest = Math.max(0, ...remaining.map((c) => c.sharpness));
  for (const c of remaining) {
    const relSharp = sharpest > 0 ? c.sharpness / sharpest : 1;
    const sizeScore = clamp01(Math.sqrt(c.areaFraction / 0.08));
    const lowerScore = clamp01((c.box.y + c.box.h) / photo.height); // nearer things sit lower in the frame
    c.score = 0.6 * relSharp + 0.25 * sizeScore + 0.15 * lowerScore;

    // live video: focus and sharpness jump around from frame to frame, so they don't decide anything
    if (opts.live) kept.push(c);
    else if (relSharp < MIN_RELATIVE_SHARPNESS) skipped.push({ ...c, reason: "blurry" });
    else if (c.score < MIN_SCORE) skipped.push({ ...c, reason: c.areaFraction < 0.02 ? "far" : "blurry" });
    else kept.push(c);
  }

  return { kept, skipped };
}

/* ------------------------------------------------------------------
   Background blur: Gaussian-blur the whole photo, then paste the sharp
   original back over the kept desk objects with soft (feathered) edges.
   ------------------------------------------------------------------ */

const supportsCanvasFilter = (ctx: CanvasRenderingContext2D): boolean =>
  typeof (ctx as { filter?: unknown }).filter === "string";

const roundedRect = (ctx: CanvasRenderingContext2D, b: Box, r: number): void => {
  const radius = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  ctx.beginPath();
  ctx.moveTo(b.x + radius, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, radius);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, radius);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, radius);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, radius);
  ctx.closePath();
};

/** Blur by shrinking and re-growing (close to Gaussian) for browsers without canvas `filter`. */
function softBlurFallback(src: HTMLCanvasElement, radius: number): HTMLCanvasElement {
  const factor = Math.max(2, Math.round(radius / 1.5));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(src.width / factor));
  small.height = Math.max(1, Math.round(src.height / factor));
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, 0, 0, small.width, small.height);
  sctx.drawImage(small, 0, 0, small.width, small.height); // second pass softens the blocks

  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

/** A copy of `photo` where everything outside `keep` (photo pixels) is Gaussian-blurred. */
export function blurBackground(photo: HTMLCanvasElement, keep: readonly Box[]): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = photo.width;
  out.height = photo.height;
  const ctx = out.getContext("2d")!;
  const radius = Math.max(4, photo.width / 110);
  const feather = Math.max(3, photo.width / 160);
  const useFilter = supportsCanvasFilter(ctx);

  // blurred base (drawn over the original so the blurred edges don't fade to transparent)
  ctx.drawImage(photo, 0, 0);
  if (useFilter) {
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(photo, 0, 0);
    ctx.filter = "none";
  } else {
    ctx.drawImage(softBlurFallback(photo, radius), 0, 0);
  }
  if (keep.length === 0) return out;

  // sharp desk objects, cut out with a soft-edged mask
  const sharp = document.createElement("canvas");
  sharp.width = photo.width;
  sharp.height = photo.height;
  const sctx = sharp.getContext("2d")!;
  sctx.drawImage(photo, 0, 0);

  const mask = document.createElement("canvas");
  mask.width = photo.width;
  mask.height = photo.height;
  const mctx = mask.getContext("2d")!;
  if (useFilter) mctx.filter = `blur(${feather}px)`;
  mctx.fillStyle = "#fff";
  for (const b of keep) {
    const pad = Math.min(b.w, b.h) * 0.06;
    roundedRect(mctx, { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, Math.min(b.w, b.h) * 0.2);
    mctx.fill();
  }

  sctx.globalCompositeOperation = "destination-in";
  sctx.drawImage(mask, 0, 0);
  ctx.drawImage(sharp, 0, 0);
  return out;
}
