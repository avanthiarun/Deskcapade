import type { DetectedObject } from "@deskcapade/shared";

const TEMPLATES: { nx: number; ny: number; nw: number; nh: number; label: string }[] = [
  { nx: 0.08, ny: 0.18, nw: 0.22, nh: 0.16, label: "mug" },
  { nx: 0.38, ny: 0.42, nw: 0.28, nh: 0.18, label: "keyboard" },
  { nx: 0.62, ny: 0.12, nw: 0.24, nh: 0.2, label: "monitor" },
  { nx: 0.18, ny: 0.62, nw: 0.2, nh: 0.14, label: "notebook" },
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
