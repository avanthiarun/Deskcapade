import type { Box, TransformSpec } from "@deskcapade/shared";
import { hashLabel } from "../materials";
import { clockHour, hashColor, mix, pastel, rgbToCss, skyAt, type RGB, type Sky } from "./palette";
import { SpecStore, shapeOf, type Shape } from "./spec";
import {
  doorRect, drawLadder, drawStructureBack, drawStructureFront, fill, isSodaCan, ladderSide, makeLook, poolGeom, roofInset,
  type DrawEx, type PoolGeom, type Px,
} from "./structures";

const GRID = 220; // pixel-grid width. Chunky on purpose.
const HERO_W = 8;
const HERO_H = 10;
const GRAVITY = 420;
const MOVE = 58;
const JUMP_V = -172;
const BOUNCE_V = -262;
const CLIMB = 44;
const MAX_FALL = 260;
const LABEL_HOLD_MS = 700; // a new label must persist this long before the object is re-skinned
const NOTICE_MS = 3500;
const GROUND_KEY = "deskgarden.groundFrac";
const IDLE_CAPTION = "Arrow keys to wander, Space to interact. Move something on your desk and the garden follows.";
const GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "a", "d", "w", "s"]);
const TIME_OVERRIDES: Array<number | null> = [null, 9, 13, 18.8, 22];

export type GardenObject = { id: number; label: string; box: Box; fading: boolean };

type Emote = "nap" | "cheer" | "water" | "ow";
type HeroMood = Emote | "idle" | "nervous" | "climb" | "swim" | "air";

type Hero = {
  x: number; y: number; vx: number; vy: number; face: 1 | -1;
  onGround: boolean; standingOn: number | null; standBounce: boolean; // standingOn: -1 = ground
  climb: number | null; cup: number | null; wasInWater: boolean;
  stun: number; invuln: number; grabLock: number; dropThrough: number;
  idleFor: number; moving: boolean;
  hidden: number; pop: { x: number; y: number } | null;
  emote: Emote | null; emoteT: number;
};

type Inst = {
  id: number; key: string; label: string; shape: Shape; candKey: string; candSince: number;
  spec: TransformSpec; color: RGB; target: RGB; colorAt: number;
  grow: number; squash: number; doorOpen: number; poof: number;
  px: Px; prevCx: number; prevCy: number; fading: boolean;
};

type Platform = { id: number; x1: number; x2: number; y: number; bounce: boolean };
type Ladder = { id: number; cx: number; yTop: number; yBot: number; topX: number };
type Pool = { id: number; g: PoolGeom };
type Hazard = { id: number; x1: number; y1: number; x2: number; y2: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; grav: number };

const rnd = Math.round;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function boxToPx(b: Box, gw: number, gh: number): Px {
  return {
    x: rnd(b.x * gw),
    y: rnd(b.y * gh),
    w: Math.max(4, rnd(b.w * gw)),
    h: Math.max(4, rnd(b.h * gh)),
  };
}

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  if ("width" in src && "height" in src) return { w: Number(src.width) || 0, h: Number(src.height) || 0 };
  return { w: 0, h: 0 };
}

function drawHero(ctx: CanvasRenderingContext2D, x: number, y: number, mood: HeroMood, face: 1 | -1, t: number, moving: boolean): void {
  const skin = "#ffcf9e";
  const step = moving ? Math.floor(t * 10) % 2 : 0;
  const shake = mood === "nervous" || mood === "ow" ? rnd(Math.sin(t * 40)) : 0;
  const bob = mood === "cheer" ? rnd(Math.abs(Math.sin(t * 8)) * 2) : mood === "swim" ? rnd(Math.sin(t * 4)) : 0;
  const hx = rnd(x) + shake;
  const hy = rnd(y) - bob;

  fill(ctx, hx + 2, hy, 4, 1, "#ffd84a"); // straw hat
  fill(ctx, hx, hy + 1, 8, 1, "#e8c48a");
  fill(ctx, hx + 1, hy + 2, 6, 3, skin); // face
  const eyeY = mood === "nap" ? hy + 4 : hy + 3;
  fill(ctx, hx + (face > 0 ? 3 : 2), eyeY, 1, 1, "#2b1d3a");
  fill(ctx, hx + (face > 0 ? 5 : 4), eyeY, 1, 1, "#2b1d3a");
  fill(ctx, hx + 2, hy + 5, 4, 3, "#ff86a8"); // shirt

  if (mood === "cheer") {
    fill(ctx, hx, hy + 3, 1, 2, skin);
    fill(ctx, hx + 7, hy + 3, 1, 2, skin);
  } else if (mood === "climb") {
    const a = Math.floor(t * 6) % 2;
    fill(ctx, hx + 1, hy + (a ? 3 : 5), 1, 2, skin);
    fill(ctx, hx + 6, hy + (a ? 5 : 3), 1, 2, skin);
  } else {
    fill(ctx, hx + 1, hy + 5, 1, 2, skin);
    fill(ctx, hx + 6, hy + 5, 1, 2, skin);
  }

  fill(ctx, hx + 2, hy + 8, 2, step ? 1 : 2, "#6b4a9a"); // legs
  fill(ctx, hx + 4, hy + 8, 2, step ? 2 : 1, "#6b4a9a");

  if (mood === "nap") {
    const k = (t * 1.5) % 1;
    fill(ctx, hx + 8, hy - 1 - Math.round(k * 5), 2, 1, "#fff7e6");
  } else if (mood === "nervous") {
    fill(ctx, hx + 7, hy + 2 + (Math.floor(t * 6) % 3), 1, 2, "#5cb8ff");
  } else if (mood === "water") {
    const cx = face > 0 ? hx + 7 : hx - 3;
    fill(ctx, cx, hy + 5, 3, 2, "#7ab8d8");
    fill(ctx, face > 0 ? cx + 3 : cx - 1, hy + 7 + (Math.floor(t * 8) % 3), 1, 1, "#5cb8ff");
  }
}

/**
 * Live camera -> animated pastel garden. Same draw() signature as StoryWorld, so the
 * capture and desktop pages only have to swap which world they construct.
 */
export class GardenWorld {
  private specs = new SpecStore();
  private insts = new Map<number, Inst>();
  private particles: Particle[] = [];
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private lastNow = 0;
  private spawned = false;
  private groundFrac = 0.9;
  private todIndex = 0;
  private showChips = true;
  private notice = "";
  private noticeUntil = 0;
  private scratch = document.createElement("canvas");
  private sctx: CanvasRenderingContext2D;
  private flies = Array.from({ length: 16 }, () => ({ x: Math.random(), y: Math.random(), ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.6 }));
  private hero: Hero = {
    x: 0, y: 0, vx: 0, vy: 0, face: 1, onGround: false, standingOn: null, standBounce: false,
    climb: null, cup: null, wasInWater: false, stun: 0, invuln: 0, grabLock: 0, dropThrough: 0,
    idleFor: 0, moving: false, hidden: 0, pop: null, emote: null, emoteT: 0,
  };

  constructor() {
    this.scratch.width = 12;
    this.scratch.height = 12;
    this.sctx = this.scratch.getContext("2d", { willReadFrequently: true })!;
    try {
      const saved = Number(localStorage.getItem(GROUND_KEY));
      if (saved >= 0.5 && saved <= 0.97) this.groundFrac = saved;
    } catch {
      /* storage unavailable: fine */
    }
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Call from the page's cleanup function. */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  // ---------- input ----------

  private norm(ev: KeyboardEvent): string {
    return ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  }
  private typing(ev: KeyboardEvent): boolean {
    const t = ev.target;
    return t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
  }
  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (this.typing(ev)) return;
    const k = this.norm(ev);
    if (GAME_KEYS.has(k)) ev.preventDefault(); // stop arrows and space from scrolling the page
    if (!ev.repeat) this.pressed.add(k);
    this.keys.add(k);
  };
  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(this.norm(ev));
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  // ---------- helpers ----------

  private say(text: string, now: number): void {
    this.notice = text;
    this.noticeUntil = now + NOTICE_MS;
  }

  private burst(x: number, y: number, colors: string[], n: number, speed: number, up = 0.5): void {
    for (let i = 0; i < n && this.particles.length < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      const life = 0.5 + Math.random() * 0.5;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * up, life, max: life, color: colors[i % colors.length]!, grav: 160 });
    }
  }

  /** Dominant, saturation-weighted color inside the middle of the object's box on the camera frame. */
  private sample(src: CanvasImageSource, size: { w: number; h: number }, box: Box): RGB | null {
    let sx = (box.x + box.w * 0.2) * size.w;
    let sy = (box.y + box.h * 0.2) * size.h;
    sx = clamp(sx, 0, size.w - 2);
    sy = clamp(sy, 0, size.h - 2);
    const sw = Math.min(box.w * 0.6 * size.w, size.w - sx);
    const sh = Math.min(box.h * 0.6 * size.h, size.h - sy);
    if (sw < 2 || sh < 2) return null;
    let data: Uint8ClampedArray;
    try {
      this.sctx.drawImage(src, sx, sy, sw, sh, 0, 0, 12, 12);
      data = this.sctx.getImageData(0, 0, 12, 12).data;
    } catch {
      return null;
    }
    const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const weight = 1 + (Math.max(r, g, b) - Math.min(r, g, b)) / 32; // colorful pixels count more than grey
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
      cur.w += weight;
      cur.r += r * weight;
      cur.g += g * weight;
      cur.b += b * weight;
      buckets.set(key, cur);
    }
    let best: { w: number; r: number; g: number; b: number } | null = null;
    for (const v of buckets.values()) if (!best || v.w > best.w) best = v;
    return best ? [best.r / best.w, best.g / best.w, best.b / best.w] : null;
  }

  // ---------- main entry ----------

  draw(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource | null,
    canvas: HTMLCanvasElement,
    objects: GardenObject[],
    now: number,
  ): string {
    const size = source ? sourceSize(source) : { w: 0, h: 0 };
    const gw = GRID;
    const gh = size.w > 0 && size.h > 0 ? Math.max(80, rnd((GRID * size.h) / size.w)) : rnd((GRID * 9) / 16);
    if (canvas.width !== gw || canvas.height !== gh) {
      canvas.width = gw;
      canvas.height = gh;
    }
    ctx.imageSmoothingEnabled = false;

    const dt = this.lastNow === 0 ? 0 : Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const t = now / 1000;

    this.sync(objects, source && size.w > 0 ? source : null, size, gw, gh, now, dt);
    const list = [...this.insts.values()];
    this.hotkeys(list, gh, now);

    const groundY = rnd(gh * this.groundFrac);
    if (!this.spawned) {
      this.hero.x = gw / 2 - HERO_W / 2;
      this.hero.y = groundY - HERO_H;
      this.hero.vx = this.hero.vy = 0;
      this.spawned = true;
    }

    this.step(dt, gw, groundY, list, now);
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    // ----- render -----
    const hour = TIME_OVERRIDES[this.todIndex] ?? clockHour();
    const sky = skyAt(hour);
    this.drawBackdrop(ctx, gw, gh, groundY, sky, t);

    const sorted = [...list].sort((a, b) => b.px.w * b.px.h - a.px.w * a.px.h); // small things in front
    for (const inst of sorted) {
      const look = makeLook(pastel(inst.color), inst.spec.accent);
      const ex: DrawEx = { grow: inst.grow, squash: inst.squash, doorOpen: inst.doorOpen, dark: sky.dark };
      ctx.globalAlpha = inst.fading ? 0.5 : 1;
      drawStructureBack(ctx, inst.px, inst.spec, look, t, ex);
      const side = ladderSide(inst.spec, inst.px, groundY);
      if (side !== "none") drawLadder(ctx, side, inst.px, inst.spec.role, groundY, t);
      ctx.globalAlpha = 1;
    }

    const h = this.hero;
    const contactId = h.climb ?? h.cup ?? (h.standingOn !== null && h.standingOn >= 0 ? h.standingOn : null);
    const contact = contactId !== null ? this.insts.get(contactId) : undefined;
    if (h.hidden <= 0 && !(h.invuln > 0 && Math.floor(t * 12) % 2 === 0)) {
      let mood: HeroMood = "idle";
      if (h.emote) mood = h.emote;
      else if (h.climb !== null) mood = "climb";
      else if (h.cup !== null && h.wasInWater) mood = "swim";
      else if (!h.onGround) mood = "air";
      else if (contact && h.idleFor > 1.4 && contact.spec.mood === "nap") mood = "nap";
      else if (contact && contact.spec.mood === "nervous") mood = "nervous";
      drawHero(ctx, h.x, h.y, mood, h.face, t, h.moving);
    }

    for (const inst of sorted) {
      ctx.globalAlpha = inst.fading ? 0.5 : 1;
      drawStructureFront(ctx, inst.px, inst.spec, t, hashLabel(inst.label) % 97);
      ctx.globalAlpha = 1;
      if (inst.poof > 0) this.drawPoof(ctx, inst);
      if (this.showChips && !inst.fading && inst.px.w >= 16) {
        const label = inst.spec.name;
        const chipW = Math.min(inst.px.w + 8, 2 + label.length * 4);
        const cy = Math.max(0, inst.px.y - 10);
        fill(ctx, inst.px.x, cy, chipW, 5, "#fff7e6");
        ctx.fillStyle = "#2b1d3a";
        ctx.font = "5px monospace";
        ctx.textBaseline = "top";
        ctx.fillText(label.slice(0, Math.floor(chipW / 4)), inst.px.x + 1, cy);
      }
    }

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      fill(ctx, p.x, p.y, 1, 1, p.color);
    }
    ctx.globalAlpha = 1;

    if (sky.dark > 0.3) {
      for (const f of this.flies) {
        const fx = f.x * gw + Math.sin(t * f.sp + f.ph) * 8;
        const fy = groundY - 8 - f.y * groundY * 0.55 + Math.cos(t * f.sp * 1.3 + f.ph) * 5;
        ctx.globalAlpha = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2 + f.ph));
        fill(ctx, fx, fy, 1, 1, "#e8ff7a");
      }
      ctx.globalAlpha = 1;
    }
    if (sky.dark > 0) {
      ctx.globalAlpha = sky.dark * 0.35;
      fill(ctx, 0, 0, gw, gh, "#1a1a4a");
      ctx.globalAlpha = 1;
    }

    // tiny raw camera picture in the corner, with the detection boxes
    if (source && size.w > 0) {
      const pw = 52;
      const ph = rnd((pw * size.h) / size.w);
      const x0 = gw - pw - 3;
      fill(ctx, x0 - 1, 2, pw + 2, ph + 2, "#2b1d3a");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, x0, 3, pw, ph);
      ctx.imageSmoothingEnabled = false;
      for (const o of objects) {
        if (o.fading) continue;
        const bx = x0 + o.box.x * pw;
        const by = 3 + o.box.y * ph;
        const bw = Math.max(2, o.box.w * pw);
        const bh = Math.max(2, o.box.h * ph);
        fill(ctx, bx, by, bw, 1, "#ffb870");
        fill(ctx, bx, by + bh - 1, bw, 1, "#ffb870");
        fill(ctx, bx, by, 1, bh, "#ffb870");
        fill(ctx, bx + bw - 1, by, 1, bh, "#ffb870");
      }
    }

    this.pressed.clear();
    if (contact) return `${contact.spec.caption}  [Space] ${contact.spec.action}`;
    if (now < this.noticeUntil) return this.notice;
    return IDLE_CAPTION;
  }

  // ---------- object bookkeeping ----------

  private sync(objects: GardenObject[], source: CanvasImageSource | null, size: { w: number; h: number }, gw: number, gh: number, now: number, dt: number): void {
    const seen = new Set<number>();
    for (const o of objects) {
      seen.add(o.id);
      const b = boxToPx(o.box, gw, gh);
      const shape = shapeOf(b.w, b.h);
      const key = `${o.label.toLowerCase()}|${shape}`;
      let inst = this.insts.get(o.id);

      if (!inst) {
        const base = hashColor(hashLabel(o.label));
        const spec = this.specs.get(o.label, shape, now);
        inst = {
          id: o.id, key, label: o.label, shape, candKey: "", candSince: 0, spec, color: base, target: base,
          colorAt: 0, grow: 0, squash: 0, doorOpen: 0, poof: 0.7, px: b,
          prevCx: b.x + b.w / 2, prevCy: b.y + b.h / 2, fading: o.fading,
        };
        this.insts.set(o.id, inst);
        this.burst(b.x + b.w / 2, b.y + b.h / 2, [spec.accent, "#fff7e6"], 12, 40);
        this.say(`${spec.name} sprouted where your ${o.label} is.`, now);
      } else if (key !== inst.key) {
        // the detector may flicker between labels. Only re-skin once the new label sticks.
        if (key === inst.candKey) {
          if (now - inst.candSince >= LABEL_HOLD_MS) {
            inst.key = key;
            inst.label = o.label;
            inst.shape = shape;
            inst.candKey = "";
          }
        } else {
          inst.candKey = key;
          inst.candSince = now;
        }
      } else {
        inst.candKey = "";
      }

      inst.px = b;
      inst.fading = o.fading;
      inst.squash = Math.max(0, inst.squash - dt);
      inst.doorOpen = Math.max(0, inst.doorOpen - dt);
      inst.poof = Math.max(0, inst.poof - dt);

      const spec = this.specs.get(inst.label, inst.shape, now);
      if (spec !== inst.spec) {
        inst.spec = spec; // the AI answer arrived: transform with a poof
        inst.poof = 0.7;
        this.burst(b.x + b.w / 2, b.y + b.h / 2, [spec.accent, "#fff7e6", "#ffd84a"], 16, 50);
      }

      if (source && !o.fading && now - inst.colorAt > 350) {
        inst.colorAt = now;
        const c = this.sample(source, size, o.box);
        if (c) inst.target = c;
      }
      inst.color = mix(inst.color, inst.target, 0.12);

      // "the world shifts": dust puffs while an object is being moved
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const speed = dt > 0 ? Math.hypot(cx - inst.prevCx, cy - inst.prevCy) / dt : 0;
      if (speed > 30 && Math.random() < 0.5) this.burst(cx, b.y + b.h, ["#fff7e6"], 1, 12, 0.3);
      inst.prevCx = cx;
      inst.prevCy = cy;
    }
    for (const [id, inst] of this.insts) {
      if (seen.has(id)) continue;
      this.burst(inst.px.x + inst.px.w / 2, inst.px.y + inst.px.h / 2, [inst.spec.accent, "#fff7e6"], 10, 35);
      this.insts.delete(id);
    }
  }

  private hotkeys(list: Inst[], gh: number, now: number): void {
    const p = this.pressed;
    if (p.has("g")) {
      let low = 0;
      for (const i of list) if (!i.fading) low = Math.max(low, i.px.y + i.px.h);
      if (low > 0) {
        this.groundFrac = clamp(low / gh, 0.5, 0.97);
        try {
          localStorage.setItem(GROUND_KEY, String(this.groundFrac));
        } catch {
          /* ignore */
        }
        this.say("Ground line set to your lowest object.", now);
      }
    }
    if (p.has("t")) {
      this.todIndex = (this.todIndex + 1) % TIME_OVERRIDES.length;
      this.say(this.todIndex === 0 ? "Time of day: follows your clock." : "Time of day changed.", now);
    }
    if (p.has("n")) this.showChips = !this.showChips;
    if (p.has("r")) this.spawned = false;
  }

  // ---------- physics ----------

  private step(dt: number, gw: number, groundY: number, list: Inst[], now: number): void {
    void now;
    const h = this.hero;
    h.stun = Math.max(0, h.stun - dt);
    h.invuln = Math.max(0, h.invuln - dt);
    h.grabLock = Math.max(0, h.grabLock - dt);
    h.dropThrough = Math.max(0, h.dropThrough - dt);
    if (h.emoteT > 0) {
      h.emoteT -= dt;
      if (h.emoteT <= 0) h.emote = null;
    }

    // Build this frame's colliders straight from the current object boxes.
    const platforms: Platform[] = [{ id: -1, x1: -100, x2: gw + 100, y: groundY, bounce: false }];
    const ladders: Ladder[] = [];
    const pools: Pool[] = [];
    const hazards: Hazard[] = [];
    for (const inst of list) {
      const b = inst.px;
      const spec = inst.spec;
      if (spec.role === "hazard") {
        hazards.push({ id: inst.id, x1: b.x, y1: b.y - 2, x2: b.x + b.w, y2: b.y + b.h });
        continue;
      }
      const g = spec.role === "pool" ? poolGeom(b) : null;
      if (g) {
        platforms.push({ id: inst.id, x1: b.x, x2: g.ix1, y: b.y, bounce: false });
        platforms.push({ id: inst.id, x1: g.ix2, x2: b.x + b.w, y: b.y, bounce: false });
        platforms.push({ id: inst.id, x1: g.ix1, x2: g.ix2, y: g.bottom, bounce: false });
        pools.push({ id: inst.id, g });
      } else {
        const inset = roofInset(spec);
        platforms.push({ id: inst.id, x1: b.x + inset, x2: b.x + b.w - inset, y: b.y, bounce: spec.role === "bounce" });
      }
      const side = ladderSide(spec, b, groundY);
      if (side !== "none") {
        const x1 = side === "right" ? b.x + b.w : b.x - 3;
        let topX = side === "right" ? b.x + b.w - HERO_W + 1 : b.x - 1;
        if (g) topX = (side === "right" ? (g.ix2 + b.x + b.w) / 2 : (b.x + g.ix1) / 2) - HERO_W / 2;
        ladders.push({ id: inst.id, cx: x1 + 1.5, yTop: b.y, yBot: Math.max(b.y + b.h, groundY), topX });
      }
    }

    // Inside a house: hidden until the door animation ends, then pop out on the roof.
    if (h.hidden > 0) {
      h.hidden -= dt;
      if (h.hidden <= 0 && h.pop) {
        h.x = h.pop.x;
        h.y = h.pop.y;
        h.vx = 0;
        h.vy = -100;
        h.onGround = false;
        h.standingOn = null;
        this.burst(h.x + HERO_W / 2, h.y + HERO_H, ["#ffd84a", "#fff7e6", "#ff86a8"], 14, 45);
        h.pop = null;
      }
      return;
    }

    const k = this.keys;
    const left = k.has("ArrowLeft") || k.has("a");
    const right = k.has("ArrowRight") || k.has("d");
    const up = k.has("ArrowUp") || k.has("w");
    const down = k.has("ArrowDown") || k.has("s");
    const control = h.stun <= 0;
    const dir = control ? (right ? 1 : 0) - (left ? 1 : 0) : 0;
    if (dir !== 0) h.face = dir === 1 ? 1 : -1;
    h.moving = dir !== 0;
    if (dir !== 0 || up || down || this.pressed.has(" ")) h.idleFor = 0;
    else h.idleFor += dt;
    if (h.emote === "nap" && (dir !== 0 || up)) h.emote = null;

    const cx = h.x + HERO_W / 2;

    // ----- climbing a vine or rope ladder -----
    if (h.climb !== null) {
      const L = ladders.find((l) => l.id === h.climb);
      if (!L) {
        h.climb = null;
      } else {
        h.vx = 0;
        h.vy = 0;
        h.x += (L.cx - HERO_W / 2 - h.x) * Math.min(1, dt * 18);
        const v = (down ? 1 : 0) - (up ? 1 : 0);
        h.y += v * CLIMB * dt;
        const feet = h.y + HERO_H;
        if (control && (dir !== 0 || this.pressed.has(" "))) {
          h.climb = null; // hop off the side
          h.vx = (dir !== 0 ? dir : h.face) * 55;
          h.vy = -90;
          h.grabLock = 0.3;
        } else if (v < 0 && feet <= L.yTop + 1) {
          h.climb = null; // reached the top: step onto the platform
          h.x = L.topX;
          h.y = L.yTop - HERO_H;
          h.grabLock = 0.3;
        } else if (v > 0 && feet >= L.yBot) {
          h.climb = null;
          h.y = L.yBot - HERO_H;
          h.grabLock = 0.2;
        }
        if (h.climb !== null) {
          h.onGround = false;
          h.standingOn = null;
        }
        return;
      }
    }

    // ----- grab a vine -----
    if (control && h.grabLock <= 0 && (up || down)) {
      const feet = h.y + HERO_H;
      for (const L of ladders) {
        if (Math.abs(cx - L.cx) > 6) continue;
        const ok = (up && feet > L.yTop + 2 && feet < L.yBot + 2) || (down && feet >= L.yTop - 1 && feet < L.yBot - 1);
        if (!ok) continue;
        h.climb = L.id;
        h.vx = 0;
        h.vy = 0;
        h.onGround = false;
        h.standingOn = null;
        return;
      }
    }

    // ----- are we inside a cup, and is it water? -----
    const cy = h.y + 6;
    let cup: Pool | null = null;
    for (const P of pools) {
      if (cx > P.g.ix1 && cx < P.g.ix2 && cy > P.g.top + 2 && cy < P.g.bottom + 2) cup = P;
    }
    h.cup = cup ? cup.id : null;
    const inWater = cup !== null && cy >= cup.g.waterTop;

    if (inWater && cup) {
      if (!h.wasInWater) this.burst(cx, cup.g.waterTop, ["#a8e0ff", "#ffffff"], 10, 35);
      h.vx += (dir * 34 - h.vx) * Math.min(1, dt * 6);
      h.vy += 90 * dt; // sinks slowly
      if (control && up) h.vy -= 330 * dt;
      if (control && down) h.vy += 200 * dt;
      if (control && up && cy <= cup.g.waterTop + 3) h.vy = -135; // hop out at the surface
      else h.vy = clamp(h.vy, -48, 28);
    } else {
      if (control) h.vx += (dir * MOVE - h.vx) * Math.min(1, dt * (h.onGround ? 18 : 8));
      else h.vx -= h.vx * Math.min(1, dt * 3);
      if (control && (this.pressed.has("ArrowUp") || this.pressed.has("w")) && h.onGround) {
        h.vy = h.standBounce ? BOUNCE_V * 0.85 : JUMP_V;
        h.onGround = false;
        h.standingOn = null;
      }
      if (control && down && h.onGround && h.standingOn !== null && h.standingOn !== -1) {
        h.dropThrough = 0.25; // fall through the platform you are standing on
        h.onGround = false;
        h.standingOn = null;
      }
      h.vy = Math.min(MAX_FALL, h.vy + GRAVITY * dt);
    }
    h.wasInWater = inWater;

    // ----- move, then resolve one-way platform landings -----
    const prevFeet = h.y + HERO_H;
    h.x = clamp(h.x + h.vx * dt, 0, gw - HERO_W);
    h.y += h.vy * dt;
    if (cup) h.x = clamp(h.x, cup.g.ix1, cup.g.ix2 - HERO_W);
    const ncx = h.x + HERO_W / 2;
    const feet = h.y + HERO_H;

    let landed: Platform | null = null;
    if (h.vy >= 0) {
      for (const p of platforms) {
        if (p.id !== -1 && h.dropThrough > 0) continue;
        if (ncx < p.x1 - 1 || ncx > p.x2 + 1) continue;
        const crossed = prevFeet <= p.y + 0.5 && feet >= p.y;
        const riding = h.standingOn === p.id && h.onGround && Math.abs(feet - p.y) < 14; // follows a moving object
        if ((crossed || riding) && (!landed || p.y < landed.y)) landed = p;
      }
    }
    if (landed) {
      h.y = landed.y - HERO_H;
      if (landed.bounce && h.vy > 60) {
        h.vy = BOUNCE_V;
        h.onGround = false;
        h.standingOn = landed.id;
        h.standBounce = true;
        const pad = this.insts.get(landed.id);
        if (pad) pad.squash = 0.25;
        this.burst(ncx, landed.y, ["#ff86a8", "#fff7e6"], 8, 40);
      } else {
        h.vy = 0;
        h.onGround = true;
        h.standingOn = landed.id;
        h.standBounce = landed.bounce;
      }
    } else {
      h.onGround = false;
      h.standingOn = null;
      h.standBounce = false;
    }

    // A can is solid. The lid is the platform above; the little door is the only gap.
    if (h.climb === null) {
      const feetNow = h.y + HERO_H;
      const mid = h.x + HERO_W / 2;
      for (const inst of list) {
        if (!isSodaCan(inst.spec) || inst.fading) continue;
        if (h.standingOn === inst.id) continue;
        const b = inst.px;
        const door = doorRect(b);
        const inDoor = mid >= door.x && mid <= door.x + door.w && feetNow > door.y - 1 && feetNow <= b.y + b.h + 2;
        if (inDoor) continue;
        const hit = h.x + HERO_W > b.x + 1 && h.x < b.x + b.w - 1 && feetNow > b.y + 2 && h.y < b.y + b.h - 1;
        if (!hit) continue;
        h.x = mid < b.x + b.w / 2 ? b.x - HERO_W : b.x + b.w;
        h.vx = 0;
      }
    }

    // ----- hazards: a gentle bump, never death -----
    if (h.invuln <= 0) {
      for (const z of hazards) {
        const hit = h.x + HERO_W > z.x1 + 1 && h.x < z.x2 - 1 && h.y + HERO_H > z.y1 + 1 && h.y < z.y2 - 1;
        if (!hit) continue;
        h.vx = (ncx < (z.x1 + z.x2) / 2 ? -1 : 1) * 85;
        h.vy = -125;
        h.stun = 0.5;
        h.invuln = 1.2;
        h.onGround = false;
        h.standingOn = null;
        h.emote = "ow";
        h.emoteT = 0.8;
        this.burst(ncx, h.y + 4, ["#ffd84a", "#ff86a8"], 8, 45);
        break;
      }
    }

    if (this.pressed.has(" ") && control) this.interact(list, groundY);
  }

  private interact(list: Inst[], groundY: number): void {
    const h = this.hero;
    const cx = h.x + HERO_W / 2;
    const feet = h.y + HERO_H;

    if (h.cup !== null && h.wasInWater) {
      h.emote = "cheer";
      h.emoteT = 0.8;
      this.burst(cx, feet - 6, ["#a8e0ff", "#ffffff"], 10, 30);
      return;
    }

    for (const inst of list) {
      if (inst.spec.role !== "house" || inst.fading) continue;
      const b = inst.px;
      const bottom = b.y + b.h;
      const nearDoor = Math.abs(cx - (b.x + b.w / 2)) <= 8;
      const atFoot = Math.abs(feet - bottom) <= 6 || (h.standingOn === -1 && bottom >= groundY - 10);
      if (!nearDoor || !atFoot) continue;
      h.hidden = 0.8;
      h.vx = 0;
      h.vy = 0;
      inst.doorOpen = 0.8;
      h.pop = { x: b.x + b.w / 2 - HERO_W / 2, y: b.y - HERO_H };
      this.burst(b.x + b.w / 2, bottom - 2, ["#ffe27a", "#fff7e6"], 8, 25);
      return;
    }

    for (const inst of list) {
      if (inst.spec.role !== "garden") continue;
      const b = inst.px;
      const near = h.x + HERO_W > b.x - 6 && h.x < b.x + b.w + 6 && feet > b.y - 4 && h.y < b.y + b.h + 4;
      if (!near) continue;
      inst.grow = Math.min(6, inst.grow + 1);
      h.face = cx < b.x + b.w / 2 ? 1 : -1;
      h.emote = "water";
      h.emoteT = 0.9;
      this.burst(b.x + b.w / 2, b.y, ["#5cb8ff", "#a8e0ff"], 8, 20, 0.2);
      return;
    }

    const under = h.standingOn !== null ? this.insts.get(h.standingOn) : undefined;
    if (under && under.spec.mood === "nap") {
      h.emote = "nap";
      h.emoteT = 3;
      return;
    }
    h.emote = "cheer";
    h.emoteT = 0.6;
    this.burst(cx, h.y, ["#ff86a8", "#fff7e6"], 5, 25);
  }

  // ---------- scenery ----------

  private drawPoof(ctx: CanvasRenderingContext2D, inst: Inst): void {
    const b = inst.px;
    const k = 1 - inst.poof / 0.7;
    const r = Math.round(3 + k * Math.max(b.w, b.h) * 0.8);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.globalAlpha = inst.poof / 0.7;
    fill(ctx, cx - r, cy - r, r * 2, 1, inst.spec.accent);
    fill(ctx, cx - r, cy + r, r * 2, 1, inst.spec.accent);
    fill(ctx, cx - r, cy - r, 1, r * 2, inst.spec.accent);
    fill(ctx, cx + r, cy - r, 1, r * 2 + 1, inst.spec.accent);
    ctx.globalAlpha = 1;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, gw: number, gh: number, groundY: number, sky: Sky, t: number): void {
    for (let y = 0; y < groundY; y += 3) {
      fill(ctx, 0, y, gw, 3, rgbToCss(mix(sky.top, sky.bot, y / groundY)));
    }
    if (sky.dark > 0.5) {
      ctx.globalAlpha = Math.min(1, (sky.dark - 0.5) * 3);
      for (let i = 0; i < 26; i++) {
        if (Math.sin(t * 2 + i) > -0.3) fill(ctx, (i * 47 + 13) % gw, (i * 29 + 7) % Math.max(10, groundY * 0.6), 1, 1, "#fff7e6");
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1 - sky.dark * 0.8;
    for (let i = 0; i < 3; i++) {
      const cx = ((t * 3 + i * 90) % (gw + 40)) - 20;
      const cy = 10 + i * 14;
      fill(ctx, cx, cy + 1, 14, 3, "#ffffff");
      fill(ctx, cx + 3, cy - 1, 8, 3, "#ffffff");
    }
    ctx.globalAlpha = 1;

    const far = rgbToCss(mix([150, 214, 170], [40, 56, 100], sky.dark * 0.75));
    const near = rgbToCss(mix([118, 196, 128], [34, 60, 86], sky.dark * 0.75));
    for (let x = 0; x < gw; x += 4) {
      const h1 = rnd(groundY - 22 - Math.sin(x * 0.035 + 1) * 9 - Math.sin(x * 0.09) * 3);
      fill(ctx, x, h1, 4, groundY - h1, far);
      const h2 = rnd(groundY - 9 - Math.sin(x * 0.05 + 4) * 5);
      fill(ctx, x, h2, 4, groundY - h2, near);
    }

    const grass = rgbToCss(mix([124, 201, 106], [38, 66, 86], sky.dark * 0.7));
    const light = rgbToCss(mix([168, 232, 108], [60, 100, 110], sky.dark * 0.7));
    fill(ctx, 0, groundY, gw, gh - groundY, grass);
    fill(ctx, 0, groundY, gw, 1, light);
    for (let x = 2; x < gw; x += 7) {
      const sway = Math.round(Math.sin(t * 2 + x));
      fill(ctx, x + sway, groundY - 3, 1, 3, light);
    }
    const petals = ["#ff86a8", "#ffd84a", "#fff7e6"];
    for (let x = 11; x < gw; x += 29) {
      const sway = Math.round(Math.sin(t * 1.4 + x));
      fill(ctx, x + sway, groundY - 1, 1, 2, "#2e7d46");
      fill(ctx, x - 1 + sway, groundY - 2, 3, 1, petals[Math.floor(x / 29) % 3]!);
    }
    if (sky.dark < 0.45) {
      for (let i = 0; i < 3; i++) {
        const bx = (Math.sin(t * 0.35 + i * 2.1) * 0.5 + 0.5) * (gw - 12);
        const by = 16 + i * 14 + Math.sin(t * 1.6 + i) * 5;
        const wing = Math.sin(t * 8 + i) > 0 ? 3 : 1;
        fill(ctx, bx, by, wing, 2, i % 2 === 0 ? "#ff86a8" : "#fff7e6");
        fill(ctx, bx + wing, by, 1, 2, "#2b1d3a");
        fill(ctx, bx + wing + 1, by, wing, 2, i % 2 === 0 ? "#ffd84a" : "#c9a0ff");
      }
    }
  }
}
