import type { Box, DetectedObject } from "@deskcapade/shared";
import { skinFor } from "../game/materials";

/** A box stays on screen until it has been missed on this many scans in a row (scans run every 250 ms). */
const MISS_LIMIT = 3;
/** 0..1, higher = the drawn box snaps to a new position faster. */
const SMOOTHING = 0.35;

/** A detected object that persists between scans. Boxes are normalized (0..1). */
type Track = {
  id: number;
  label: string;
  target: Box;
  shown: Box;
  misses: number;
};

const toNorm = (b: Box, s: { w: number; h: number }): Box => ({
  x: b.x / s.w,
  y: b.y / s.h,
  w: b.w / s.w,
  h: b.h / s.h,
});

const iou = (a: Box, b: Box): number => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * Keeps detected objects on screen between scans: an object is only removed after it has
 * been missed on several scans in a row, and its box glides instead of jumping.
 * Used by both the phone-camera page and the laptop-camera page.
 */
export class ObjectTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  /** Objects seen in the most recent scan (boxes that are only fading out don't count). */
  get count(): number {
    return this.tracks.filter((t) => t.misses === 0).length;
  }

  /** Labels of what the latest scan actually saw. Moved/removed objects drop out right away. */
  labels(): string[] {
    return [
      ...new Set(
        this.tracks.filter((t) => t.misses === 0).map((t) => t.label)
      ),
    ];
  }

  clear(): void {
    this.tracks = [];
  }

  /** Match a new scan's detections to existing objects. */
  update(objects: DetectedObject[], imageSize: { w: number; h: number }): void {
    const matched = new Set<Track>();

    for (const obj of objects) {
      const box = toNorm(obj.box, imageSize);
      const label = obj.label ?? "object";

      let best: Track | null = null;
      let bestScore = 0;

      for (const t of this.tracks) {
        if (matched.has(t)) continue;

        const overlap = iou(t.target, box);
        const sameLabel = t.label.toLowerCase() === label.toLowerCase();

        if (overlap < 0.2 || (!sameLabel && overlap < 0.6)) continue;

        const score = overlap + (sameLabel ? 0.3 : 0);

        if (score > bestScore) {
          best = t;
          bestScore = score;
        }
      }

      if (best) {
        best.target = box;
        best.label = label;
        best.misses = 0;
        matched.add(best);
      } else {
        const t: Track = {
          id: this.nextId++,
          label,
          target: box,
          shown: { ...box },
          misses: 0,
        };

        this.tracks.push(t);
        matched.add(t);
      }
    }

    for (const t of this.tracks) {
      if (!matched.has(t)) {
        t.misses += 1;
      }
    }

    this.tracks = this.tracks.filter((t) => t.misses < MISS_LIMIT);
  }

  /** Glide drawn boxes toward the latest detections. Call once per animation frame. */
  tick(): void {
    for (const t of this.tracks) {
      t.shown.x += (t.target.x - t.shown.x) * SMOOTHING;
      t.shown.y += (t.target.y - t.shown.y) * SMOOTHING;
      t.shown.w += (t.target.w - t.shown.w) * SMOOTHING;
      t.shown.h += (t.target.h - t.shown.h) * SMOOTHING;
    }
  }

  /** Normalized boxes (0..1) after smoothing, for story-world overlays. */
  list(): Array<{
    id: number;
    label: string;
    box: Box;
    fading: boolean;
  }> {
    return this.tracks.map((t) => ({
      id: t.id,
      label: t.label,
      box: t.shown,
      fading: t.misses > 0,
    }));
  }

  /** Draw every tracked object's outline onto the canvas (boxes only, no text). */
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.tick();

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffb870";

    for (const t of this.tracks) {
      const x = t.shown.x * width;
      const y = t.shown.y * height;
      const w = t.shown.w * width;
      const h = t.shown.h * height;

      ctx.globalAlpha = t.misses > 0 ? 0.55 : 1;
      ctx.beginPath();

      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, 6);
      } else {
        ctx.rect(x, y, w, h);
      }

      ctx.stroke();
    }

    ctx.restore();
  }
}

/** Fill the "Detected: ..." text under the video; hidden when nothing is detected. */
export function renderDetectedText(
  el: HTMLElement,
  tracker: ObjectTracker
): void {
  const labels = tracker.labels();

  if (labels.length === 0) {
    el.textContent = "";
    el.hidden = true;
    return;
  }

  el.textContent = `Detected: ${labels
    .map((l) => `${l} → ${skinFor(l).title}`)
    .join(" • ")}`;

  el.hidden = false;
}