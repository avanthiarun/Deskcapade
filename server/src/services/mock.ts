import type { DetectedObject } from "@deskcapade/shared";

const TEMPLATES: { nx: number; ny: number; nw: number; nh: number; label: string }[] = [
  { nx: 0.08, ny: 0.22, nw: 0.26, nh: 0.28, label: "mug" },
  { nx: 0.40, ny: 0.48, nw: 0.32, nh: 0.16, label: "keyboard" },
  { nx: 0.68, ny: 0.18, nw: 0.2, nh: 0.22, label: "plant" },
  { nx: 0.18, ny: 0.62, nw: 0.18, nh: 0.16, label: "phone" },
  { nx: 0.52, ny: 0.12, nw: 0.16, nh: 0.14, label: "bowl" },
];

function jitter(n: number, amount: number): number {
  return n + (Math.random() * 2 - 1) * amount;
}

/** 2–4 desk-like boxes that move slightly between calls. */
export function mockDetections(imageSize: { w: number; h: number }): DetectedObject[] {
  const count = 2 + Math.floor(Math.random() * 3);
  const picked = TEMPLATES.slice(0, count);

  return picked.map((t, i) => {
    const nw = Math.max(0.08, jitter(t.nw, 0.02));
    const nh = Math.max(0.08, jitter(t.nh, 0.02));
    const nx = Math.min(0.9 - nw, Math.max(0.02, jitter(t.nx, 0.03)));
    const ny = Math.min(0.9 - nh, Math.max(0.02, jitter(t.ny, 0.03)));
    return {
      id: `mock-${i}`,
      label: t.label,
      box: {
        x: nx * imageSize.w,
        y: ny * imageSize.h,
        w: nw * imageSize.w,
        h: nh * imageSize.h,
      },
    };
  });
}
