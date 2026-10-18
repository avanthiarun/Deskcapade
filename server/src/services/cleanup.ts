import type { Box, DetectedObject } from "@deskcapade/shared";

const MIN_AREA_FRACTION = 0.01;
const MAX_AREA_FRACTION = 0.6;
const MERGE_IOU_THRESHOLD = 0.7;
const MAX_OBJECTS = 20;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function clampBox(box: Box, imgW: number, imgH: number): Box {
  const x = clamp(box.x, 0, imgW);
  const y = clamp(box.y, 0, imgH);
  const x2 = clamp(box.x + box.w, 0, imgW);
  const y2 = clamp(box.y + box.h, 0, imgH);
  return { x, y, w: x2 - x, h: y2 - y };
}

function area(box: Box): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

function unionBox(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Merge overlapping detections (greedy, largest first). */
function mergeOverlapping(objects: DetectedObject[]): DetectedObject[] {
  const sorted = [...objects].sort((a, b) => area(b.box) - area(a.box));
  const kept: DetectedObject[] = [];

  for (const obj of sorted) {
    const hit = kept.find((k) => iou(k.box, obj.box) > MERGE_IOU_THRESHOLD);
    if (!hit) {
      kept.push({ ...obj, box: { ...obj.box } });
      continue;
    }
    hit.box = unionBox(hit.box, obj.box);
    if (!hit.label && obj.label) hit.label = obj.label;
  }

  return kept;
}

export function cleanupDetections(
  objects: DetectedObject[],
  imageSize: { w: number; h: number },
): DetectedObject[] {
  const imgArea = imageSize.w * imageSize.h;
  if (imgArea <= 0) return [];

  const minArea = MIN_AREA_FRACTION * imgArea;
  const maxArea = MAX_AREA_FRACTION * imgArea;

  const clamped = objects
    .map((obj) => ({ ...obj, box: clampBox(obj.box, imageSize.w, imageSize.h) }))
    .filter((obj) => {
      const a = area(obj.box);
      return a >= minArea && a <= maxArea;
    });

  const merged = mergeOverlapping(clamped);
  return merged.slice(0, MAX_OBJECTS);
}
