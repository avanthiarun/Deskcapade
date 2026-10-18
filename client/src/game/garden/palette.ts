export type RGB = [number, number, number];
export type Sky = { top: RGB; bot: RGB; dark: number };

export function hexToRgb(hex: string): RGB {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return [255, 184, 112];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lospec Sweetie 16. Free. Every painted color snaps to the nearest entry. */
export const SWEETIE_16: RGB[] = [
  [26, 28, 44],
  [93, 39, 93],
  [177, 62, 83],
  [239, 125, 87],
  [255, 205, 117],
  [167, 240, 112],
  [56, 183, 100],
  [37, 113, 121],
  [41, 54, 111],
  [59, 93, 201],
  [65, 166, 246],
  [115, 239, 247],
  [244, 244, 244],
  [148, 176, 194],
  [86, 108, 134],
  [51, 60, 87],
];

export function snap(c: RGB): RGB {
  let best = SWEETIE_16[0]!;
  let bestD = Infinity;
  for (const p of SWEETIE_16) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export const rgbToCss = (c: RGB): string => {
  const [r, g, b] = snap(c);
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
};

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Real color pulled toward cream, so everything reads as pastel. */
export const pastel = (c: RGB): RGB => mix(c, [255, 250, 240], 0.42);
export const shade = (c: RGB, t = 0.4): RGB => mix(c, [43, 29, 58], t);

/** Fallback color before the camera has been sampled. */
export function hashColor(h: number): RGB {
  const hue = (h % 360) / 60;
  const s = 0.55;
  const l = 0.76;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = l - c / 2;
  const rgb: RGB =
    hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

// ---------- time of day ----------

type Key = { h: number; top: RGB; bot: RGB; dark: number };
const K = (h: number, top: string, bot: string, dark: number): Key => ({
  h,
  top: hexToRgb(top),
  bot: hexToRgb(bot),
  dark,
});

const KEYS: Key[] = [
  K(0, "#14173a", "#2b2f63", 0.85),
  K(5.5, "#3a3a7a", "#f2a38a", 0.45), // dawn
  K(8, "#8fd3ff", "#e6f7ff", 0),
  K(13, "#6cc4ff", "#d8f3ff", 0),
  K(17.5, "#8fb4ff", "#ffd9a8", 0.1),
  K(19, "#6a4a9a", "#ff9f80", 0.4), // dusk
  K(21, "#232652", "#453a7a", 0.75),
  K(24, "#14173a", "#2b2f63", 0.85),
];

export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    if (h >= a.h && h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      return { top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t), dark: a.dark + (b.dark - a.dark) * t };
    }
  }
  const k = KEYS[0]!;
  return { top: k.top, bot: k.bot, dark: k.dark };
}

export function clockHour(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}