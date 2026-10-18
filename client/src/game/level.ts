import type { Box } from "@deskcapade/shared";
import type { SpriteColors } from "../lib/deskSprites";
import type { ObjectKind } from "./materials";

/* ------------------------------------------------------------------
   Level geometry for the garden platformer, all in canvas pixels.

   Only two things are ever solid besides the ground (the bottom of the camera picture):
   the desk objects on screen, and bouncy clouds. Every desk object becomes
     surfaces  things you land on (one-way: you can jump up through them)
     climbs    vines, ladders, rock walls
     zones     areas with an effect: water, lava, updraft, geyser, flame, spikes
     walls     pool sides
   exactly the size of the object's box.

   A few clouds float near the top. The level designer (planFillers) then walks the level
   like a player would; wherever a desk object or a high cloud can't be reached, it adds
   another bouncy cloud as a stepping stone.
   ------------------------------------------------------------------ */

export type SurfaceKind = "ground" | "top" | "rim" | "floor" | "cloud" | "slide" | "bridge" | "ledge";

/** A one-way platform. `y` is its height at `x1`; slope / sag bend it (see surfaceY). */
export type Surface = {
  id: string;
  kind: SurfaceKind;
  x1: number;
  x2: number;
  y: number;
  /** dy/dx: a straight ramp (water slides). */
  slope?: number;
  /** How far the middle hangs below the ends (rope bridges). */
  sag?: number;
  /** Bounce strength (1 = mushroom). Bouncy surfaces launch you instead of letting you stand. */
  bounce?: number;
  /** Sideways speed it carries you at (conveyors). */
  conveyor?: number;
  ice?: boolean;
  /** You can't jump while standing on it (icy patches). */
  noJump?: boolean;
  /** The desk object this belongs to. */
  owner?: string;
  /** Challenge: slides back and forth (dx / dy = how far each way, period in ms). */
  motion?: { dx: number; dy: number; period: number; phase: number };
  /** Challenge: crumbles a moment after you land on it, then grows back. */
  crumble?: boolean;
};

/** Height of surface `s` at `x`. `extraSag` is added to the bridge's sag (someone standing on it). */
export function surfaceY(s: Surface, x: number, extraSag = 0): number {
  let y = s.y + (s.slope ?? 0) * (x - s.x1);
  if (s.sag !== undefined) {
    const f = (2 * (x - s.x1)) / Math.max(1, s.x2 - s.x1) - 1;
    y += (s.sag + extraSag) * Math.max(0, 1 - f * f);
  }
  return y;
}

/** Something you can move up and down on. */
export type Climb = { id: string; kind: "vine" | "ladder" | "wall"; x1: number; x2: number; y1: number; y2: number };

export type ZoneKind = "water" | "lava" | "updraft" | "geyser" | "flame" | "spikes" | "jello" | "river";
export type Zone = { id: string; kind: ZoneKind; x1: number; x2: number; y1: number; y2: number; owner: string; phase?: number };

/** A solid side wall (pool sides). */
export type Wall = { x1: number; x2: number; y1: number; y2: number };

export type GameObject = {
  id: string;
  label: string;
  templateId: string | null;
  /** Canvas pixels, the object's real size. */
  box: Box;
  /** The object's pixel sprite (Challenge draws it; in Story the live layer does). */
  sprite?: HTMLCanvasElement;
  /** The object's own colors; its decorations (bricks, mushroom cap, slide...) are drawn in them. */
  colors?: SpriteColors | null;
};

export type PlacedObject = GameObject & { kind: ObjectKind };

/** Sizes, all derived from the canvas so the game plays the same at any resolution. */
export type Metrics = {
  W: number;
  H: number;
  /** One hundredth of the canvas height. */
  u: number;
  groundY: number;
  playerW: number;
  playerH: number;
  /** How high a normal jump safely gets you (the level designer plans with these). */
  jumpH: number;
  /** How far sideways a jump safely gets you. */
  reach: number;
  /** How high a bounce of strength 1 safely gets you. */
  bounceH: number;
  /** Walking speed, in pixels per second. */
  walkV: number;
};

/** The ground is the bottom of the camera picture, with this much grass showing (in u). */
const GROUND_STRIP_U = 2;
export const CLOUD_BOUNCE = 0.8;

export function metrics(W: number, H: number, physics: { gravity: number; jumpV: number; moveV: number; bounceV: number }): Metrics {
  const u = H / 100;
  const { gravity, jumpV, moveV, bounceV } = physics;
  return {
    W,
    H,
    u,
    groundY: Math.round(H - GROUND_STRIP_U * u),
    playerW: 4.5 * u,
    playerH: 7.5 * u,
    jumpH: 0.85 * ((jumpV * jumpV) / (2 * gravity)) * u,
    reach: 0.75 * moveV * ((2 * jumpV) / gravity) * u,
    bounceH: 0.85 * ((bounceV * bounceV) / (2 * gravity)) * u,
    walkV: moveV * u,
  };
}

/** Small stable number from a string (conveyor direction, geyser timing). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Which way a conveyor (keyboard) carries you: 1 right, -1 left. */
export const conveyorDir = (id: string): number => (hash(id) % 2 === 0 ? 1 : -1);

/* ---------- desk objects ---------- */

export type PoolLayout = {
  /** False when the cup is too narrow to swim in: it's still a pool, just without inner walls. */
  swimmable: boolean;
  wall: number;
  waterTop: number;
  /** The handle side: a water slide from the rim down to the ground. */
  slideSide: "left" | "right";
  slide: { x1: number; y1: number; x2: number; y2: number };
  /** The other side: a ladder from the ground up to the rim. */
  ladder: { x1: number; x2: number; y1: number; y2: number };
};

/** The handle side, when the detection label says ("mug ... handle facing right"). */
const HANDLE_SIDE = /handle\s+(?:is\s+)?(?:on|facing|to|pointing)\s+(?:the\s+)?(left|right)/i;
const SLIDE_MAX_U = 26;
const SLIDE_DROP = 0.75; // how steeply the slide falls (dy per dx)

/**
 * Where a pool's walls, water, slide and ladder go, sized from the cup / bowl / glass.
 * The slide goes on the handle side (from `label` when it says, else the side with more room).
 */
export function poolLayout(box: Box, m: Metrics, label = ""): PoolLayout {
  const wall = Math.max(m.u, box.w * 0.1);
  const swimmable = box.w - wall * 2 >= m.playerW + m.u;
  const right = box.x + box.w;
  const said = HANDLE_SIDE.exec(label)?.[1]?.toLowerCase();
  const slideSide = said === "left" || said === "right" ? said : m.W - right >= box.x ? "right" : "left";
  const room = slideSide === "right" ? m.W - right : box.x;

  // a short slide that launches you off its end (it doesn't have to reach the ground)
  const sy1 = box.y + box.h * 0.15;
  const len = Math.max(4 * m.u, Math.min(room - m.u, SLIDE_MAX_U * m.u, (m.groundY - sy1) / SLIDE_DROP));
  const sy2 = sy1 + len * SLIDE_DROP;
  const slide =
    slideSide === "right"
      ? { x1: right, y1: sy1, x2: right + len, y2: sy2 }
      : { x1: box.x - len, y1: sy2, x2: box.x, y2: sy1 };

  const half = 1.5 * m.u;
  const gap = m.playerW / 2 + 0.3 * m.u; // far enough from the wall that the climbing player doesn't bump it
  const cx = slideSide === "right" ? Math.max(half, box.x - gap) : Math.min(m.W - half, right + gap);
  return {
    swimmable,
    wall,
    waterTop: box.y + box.h * 0.2,
    slideSide,
    slide,
    ladder: { x1: cx - half, x2: cx + half, y1: box.y, y2: Math.max(m.groundY, box.y + box.h) },
  };
}

/** Where the ladder sits on a rock wall (the only part of the wall you can climb), as a share of its width. */
export function rockLadder(x: number, w: number): { x1: number; x2: number } {
  const x1 = x + w * 0.12;
  return { x1, x2: Math.min(x + w, x1 + Math.max(w * 0.28, 1)) };
}

/**
 * A river (eyeglasses): where its water starts and where the stepping stones sit. Stones are
 * spaced evenly across, one at each bank, so every gap can be jumped.
 */
export function riverLayout(box: Box, u: number): { waterTop: number; stones: { x1: number; x2: number; y: number }[] } {
  const stoneY = box.y + Math.min(box.h * 0.3, 3 * u);
  const stoneW = Math.min(4 * u, box.w / 4);
  const n = Math.max(2, Math.round(box.w / (10 * u)) + 1);
  const stones = Array.from({ length: n }, (_, i) => {
    const cx = box.x + stoneW / 2 + ((box.w - stoneW) * i) / (n - 1);
    return { x1: cx - stoneW / 2, x2: cx + stoneW / 2, y: stoneY };
  });
  return { waterTop: stoneY + Math.max(1, u * 0.8), stones };
}

/** The leaf pad on a vine is at least this wide (in u) so it's easy to land on. */
const MIN_PAD_HALF_U = 3;
export const vinePadHalf = (box: Box, m: Metrics): number => Math.max(MIN_PAD_HALF_U * m.u, box.w / 2);

/** Where a bridge's deck hangs inside its box. */
export const bridgeDeckY = (box: Box): number => box.y + Math.min(box.h * 0.3, box.h / 2);
export const BRIDGE_SAG_U = 1.5;

/** Geysers erupt for GEYSER_ON_MS out of every GEYSER_PERIOD_MS. */
export const GEYSER_PERIOD_MS = 3400;
export const GEYSER_ON_MS = 1200;
export const geyserTime = (z: Zone, now: number): number => (now + (z.phase ?? 0)) % GEYSER_PERIOD_MS;

export type Geometry = { surfaces: Surface[]; climbs: Climb[]; zones: Zone[]; walls: Wall[] };

export function objectGeometry(objects: readonly PlacedObject[], m: Metrics): Geometry {
  const g: Geometry = { surfaces: [], climbs: [], zones: [], walls: [] };
  const { u } = m;

  for (const o of objects) {
    const b = o.box;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    const cx = b.x + b.w / 2;
    const id = o.id;
    const top = (extra: Partial<Surface> = {}): void => {
      g.surfaces.push({ id: `${id}:top`, kind: "top", x1: b.x, x2: right, y: b.y, owner: id, ...extra });
    };

    switch (o.kind) {
      case "vine": {
        const half = Math.max(1.2 * u, b.w * 0.35);
        const pad = vinePadHalf(b, m);
        g.climbs.push({ id: `${id}:vine`, kind: "vine", x1: cx - half, x2: cx + half, y1: b.y, y2: bottom });
        g.surfaces.push({ id: `${id}:top`, kind: "top", x1: cx - pad, x2: cx + pad, y: b.y, owner: id });
        break;
      }
      case "pool": {
        const pool = poolLayout(b, m, o.label);
        const { wall, ladder, slide } = pool;
        if (pool.swimmable) g.walls.push({ x1: b.x, x2: b.x + wall, y1: b.y, y2: bottom }, { x1: right - wall, x2: right, y1: b.y, y2: bottom });
        const ladderLeft = pool.slideSide === "right";
        g.surfaces.push(
          { id: `${id}:rimL`, kind: "rim", x1: ladderLeft ? ladder.x1 : b.x, x2: b.x + wall, y: b.y, owner: id },
          { id: `${id}:rimR`, kind: "rim", x1: right - wall, x2: ladderLeft ? right : ladder.x2, y: b.y, owner: id },
          { id: `${id}:floor`, kind: "floor", x1: b.x + wall, x2: right - wall, y: bottom - wall, owner: id },
          {
            id: `${id}:slide`,
            kind: "slide",
            x1: slide.x1,
            x2: slide.x2,
            y: slide.y1,
            slope: (slide.y2 - slide.y1) / Math.max(1, slide.x2 - slide.x1),
            owner: id,
          },
        );
        g.climbs.push({ id: `${id}:ladder`, kind: "ladder", ...ladder });
        g.zones.push({ id: `${id}:water`, kind: "water", x1: b.x + wall, x2: right - wall, y1: pool.waterTop, y2: bottom - wall, owner: id });
        break;
      }
      case "lava": {
        const rim = Math.max(u, b.w * 0.12);
        g.surfaces.push(
          { id: `${id}:rimL`, kind: "rim", x1: b.x, x2: b.x + rim, y: b.y, owner: id },
          { id: `${id}:rimR`, kind: "rim", x1: right - rim, x2: right, y: b.y, owner: id },
        );
        g.zones.push({ id: `${id}:lava`, kind: "lava", x1: b.x + rim, x2: right - rim, y1: b.y + b.h * 0.15, y2: bottom, owner: id });
        break;
      }
      case "spikes":
        // no surface: there's nothing safe to stand on
        g.zones.push({ id: `${id}:spikes`, kind: "spikes", x1: b.x, x2: right, y1: b.y - 1.5 * u, y2: b.y + b.h * 0.6, owner: id });
        break;
      case "bridge":
        g.surfaces.push({ id: `${id}:top`, kind: "bridge", x1: b.x, x2: right, y: bridgeDeckY(b), sag: BRIDGE_SAG_U * u, owner: id });
        break;
      case "woodbridge":
      case "rail":
        top();
        break;
      case "icepatch":
        top({ ice: true, noJump: true });
        break;
      case "river": {
        // stepping stones over deadly water
        const river = riverLayout(b, u);
        river.stones.forEach((s, i) => g.surfaces.push({ id: `${id}:stone${i}`, kind: "top", ...s, owner: id }));
        g.zones.push({ id: `${id}:river`, kind: "river", x1: b.x, x2: right, y1: river.waterTop, y2: Math.max(bottom, river.waterTop + 2 * u), owner: id });
        break;
      }
      case "jello":
        // no surface: you wade through it, slowly
        g.zones.push({ id: `${id}:jello`, kind: "jello", x1: b.x, x2: right, y1: b.y, y2: bottom, owner: id });
        break;
      case "rockwall":
        // only the ladder can be climbed, not the whole rock face
        g.climbs.push({ id: `${id}:ladder`, kind: "ladder", ...rockLadder(b.x, b.w), y1: b.y, y2: bottom });
        top();
        break;
      case "trampoline":
        top({ bounce: 1.15 });
        break;
      case "mushroom":
        top({ bounce: 1 });
        break;
      case "plush":
        top({ bounce: 0.75 });
        break;
      case "conveyor":
        top({ conveyor: conveyorDir(id) * 24 * u });
        break;
      case "ice":
        top({ ice: true });
        break;
      case "updraft":
        top();
        g.zones.push({ id: `${id}:updraft`, kind: "updraft", x1: b.x - 0.5 * u, x2: right + 0.5 * u, y1: Math.max(4 * u, b.y - 38 * u), y2: b.y + 0.5 * u, owner: id });
        break;
      case "geyser": {
        top();
        const half = Math.max(2 * u, b.w * 0.3);
        g.zones.push({ id: `${id}:geyser`, kind: "geyser", x1: cx - half, x2: cx + half, y1: Math.max(4 * u, b.y - 32 * u), y2: b.y + 0.5 * u, owner: id, phase: hash(id) % GEYSER_PERIOD_MS });
        break;
      }
      case "flame": {
        const half = Math.max(1.5 * u, b.w * 0.3);
        g.zones.push({ id: `${id}:flame`, kind: "flame", x1: cx - half, x2: cx + half, y1: b.y - 6 * u, y2: b.y + 2 * u, owner: id });
        break;
      }
      default:
        top();
    }
  }
  return g;
}

/* ---------- clouds near the top ---------- */

/** Small fixed-seed random generator. */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few random bouncy clouds across the top of the map (seeds wait on them). */
export function makeHighClouds(m: Metrics, seed: number): Surface[] {
  const rand = seeded(seed);
  const { W, u } = m;
  const n = Math.max(3, Math.min(5, Math.round(W / (m.H * 0.45))));
  const slot = W / n;
  const clouds: Surface[] = [];
  for (let i = 0; i < n; i++) {
    const w = Math.min(slot * 0.7, (12 + rand() * 5) * u);
    const cx = slot * (i + 0.5) + (rand() - 0.5) * 0.3 * slot;
    const y = (12 + rand() * 12) * u;
    clouds.push({ id: `cloud${i}`, kind: "cloud", x1: cx - w / 2, x2: cx + w / 2, y, bounce: CLOUD_BOUNCE });
  }
  return clouds;
}

/* ---------- the level designer ---------- */

/** A spot you can stand on (or hang at) during the reachability walk. */
export type Spot = { x1: number; x2: number; y: number; bounce?: number };

const riseFrom = (m: Metrics, from: Spot): number => (from.bounce ? m.bounceH * from.bounce * from.bounce : m.jumpH);

/** Can you get from `from` to landing on `to`? Conservative, so planned levels are always playable. */
function canJump(m: Metrics, from: Spot, to: Spot): boolean {
  const rise = from.y - to.y; // > 0: `to` is higher
  const gap = Math.max(0, to.x1 - from.x2, from.x1 - to.x2);
  const jumpH = riseFrom(m, from);
  if (rise > jumpH) return false;
  if (rise > 0) return gap <= m.reach * (1 - 0.4 * (rise / jumpH));
  return gap <= m.reach + Math.min(-rise, 40 * m.u) * 0.6; // falling buys extra distance
}

/** Anything you can move up inside: climbs, plus water / updrafts / geysers. */
export type Lift = { id: string; x1: number; x2: number; y1: number; y2: number };

function canGrab(m: Metrics, from: Spot, c: Lift): boolean {
  const gap = Math.max(0, c.x1 - from.x2, from.x1 - c.x2);
  return from.y - c.y2 <= riseFrom(m, from) && gap <= m.reach * 0.8;
}

type Reach = { spots: Spot[]; surfaces: Set<string>; lifts: Set<string> };

/** Everything reachable from `start` (default: the ground). */
function walk(m: Metrics, surfaces: readonly Surface[], lifts: readonly Lift[], start?: Spot): Reach {
  const reached: Reach = { spots: [], surfaces: new Set(), lifts: new Set() };
  const ground = surfaces.find((s) => s.kind === "ground");
  const first = start ?? ground;
  if (!first) return reached;
  const queue: Spot[] = [first];
  if (!start && ground) reached.surfaces.add(ground.id);
  while (queue.length > 0) {
    const from = queue.shift()!;
    reached.spots.push(from);
    for (const s of surfaces) {
      const spot = { x1: s.x1, x2: s.x2, y: Math.min(s.y, surfaceY(s, s.x2)), ...(s.bounce ? { bounce: s.bounce } : {}) };
      if (reached.surfaces.has(s.id) || !canJump(m, from, spot)) continue;
      reached.surfaces.add(s.id);
      queue.push(spot);
    }
    for (const c of lifts) {
      if (reached.lifts.has(c.id) || !canGrab(m, from, c)) continue;
      reached.lifts.add(c.id);
      // from a climb you can jump off anywhere along it; its top and bottom cover the extremes
      queue.push({ x1: c.x1, x2: c.x2, y: c.y1 }, { x1: c.x1, x2: c.x2, y: c.y2 });
    }
  }
  return reached;
}

type Target = { id: string; spot: Spot; lift: boolean };

/** True if a cloud at (x1..x2, y) would sit inside an object or crowd another platform. */
function blocked(m: Metrics, x1: number, x2: number, y: number, boxes: readonly Box[], others: readonly Surface[]): boolean {
  const top = y - m.playerH - m.u; // leave headroom to land on it
  const bottom = y + 2 * m.u;
  for (const b of boxes) {
    if (x2 > b.x - m.u && x1 < b.x + b.w + m.u && bottom > b.y && top < b.y + b.h) return true;
  }
  for (const s of others) {
    if (x2 > s.x1 - m.u && x1 < s.x2 + m.u && Math.abs(s.y - y) < m.playerH) return true;
  }
  return false;
}

/** The things you can rise inside, for the reachability walk. */
export const liftsOf = (geo: Geometry): Lift[] => [
  ...geo.climbs,
  ...geo.zones.filter((z) => z.kind === "water" || z.kind === "updraft" || z.kind === "geyser"),
];

/** Can you get from `start` to land on `goal`? Also returns every spot you can reach. */
export function canReach(m: Metrics, surfaces: readonly Surface[], lifts: readonly Lift[], start: Spot, goal: Spot): { ok: boolean; spots: Spot[] } {
  const target: Surface = { id: "__goal", kind: "ledge", x1: goal.x1, x2: goal.x2, y: goal.y };
  const r = walk(m, [...surfaces, target], lifts, start);
  return { ok: r.surfaces.has(target.id), spots: r.spots };
}

/**
 * Added ledges sit in tidy rows above the desk: one row every `spacing` of a full jump.
 * Snaps `y` to the nearest row (never the desk itself).
 */
export function rowY(m: Metrics, y: number, spacing: number): number {
  const step = m.jumpH * spacing;
  return m.groundY - Math.max(1, Math.round((m.groundY - y) / step)) * step;
}

/**
 * Challenge: add floating ledges from `start` toward `goal` until the goal can be reached.
 * `spacing` (0..1) is how much of a full jump each step asks for: lower is easier.
 * Ledges are stacked in rows: going up, each new one sits directly above the last, one row
 * higher; going across, it stays in the same row.
 */
export function planPath(
  m: Metrics,
  boxes: readonly Box[],
  surfaces: readonly Surface[],
  lifts: readonly Lift[],
  start: Spot,
  goal: Spot,
  spacing: number,
  maxAdd = 16,
): { added: Surface[]; reached: boolean } {
  const { u, W } = m;
  const HALF = 6 * u;
  const added: Surface[] = [];
  for (let iter = 0; iter < maxAdd; iter++) {
    const all = [...surfaces, ...added];
    const r = canReach(m, all, lifts, start, goal);
    if (r.ok) return { added, reached: true };

    // the reachable spot that is the cheapest jump-off toward the goal
    let from: Spot | null = null;
    let best = Infinity;
    for (const s of r.spots) {
      const gap = Math.max(0, goal.x1 - s.x2, s.x1 - goal.x2);
      const cost = Math.max(0, s.y - goal.y - m.jumpH * spacing) + gap * 0.5 + Math.abs(s.y - goal.y) * 0.1;
      if (cost < best) {
        best = cost;
        from = s;
      }
    }
    if (!from) break;

    const step = m.jumpH * spacing;
    const tx = (goal.x1 + goal.x2) / 2;
    const sx = Math.max(from.x1, Math.min(from.x2, tx));
    const higher = from.y - goal.y > step;
    // up: straight above, the next row higher. Across: the same row, a step toward the goal.
    let y = Math.max(8 * u, higher ? rowY(m, from.y - step, spacing) : rowY(m, from.y, spacing));
    const maxDx = m.reach * spacing * 0.8;
    // stacking on a ledge (or anything narrow): centered right above it, so the rows form a column
    const narrow = from.x2 - from.x1 <= HALF * 3;
    const above = narrow ? (from.x1 + from.x2) / 2 : sx;
    let x = higher ? above : sx + Math.max(-maxDx, Math.min(maxDx, tx - sx));
    let placed = false;
    for (const ny of [0, -step]) {
      for (const n of [0, -1, 1, -2, 2]) {
        const nx = Math.max(HALF, Math.min(W - HALF, x + n * HALF * 2)); // shift by whole ledge widths, keeping columns
        if (!blocked(m, nx - HALF, nx + HALF, y + ny, boxes, all)) {
          x = nx;
          y += ny;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    added.push({ id: `ledge${iter}`, kind: "ledge", x1: x - HALF, x2: x + HALF, y });
  }
  return { added, reached: canReach(m, [...surfaces, ...added], lifts, start, goal).ok };
}

/**
 * Add bouncy clouds until every desk object and every high cloud can be reached from the
 * ground. Returns only the new clouds.
 */
export function planFillers(m: Metrics, objects: readonly PlacedObject[], geo: Geometry, highClouds: readonly Surface[]): Surface[] {
  const { u, W } = m;
  const ground: Surface = { id: "ground", kind: "ground", x1: 0, x2: W, y: m.groundY };
  const fillers: Surface[] = [];
  const boxes = [...objects.map((o) => o.box), ...geo.zones.filter((z) => z.kind !== "water").map((z) => ({ x: z.x1, y: z.y1, w: z.x2 - z.x1, h: z.y2 - z.y1 }))];
  const lifts: Lift[] = [...geo.climbs, ...geo.zones.filter((z) => z.kind === "water" || z.kind === "updraft" || z.kind === "geyser")];
  const tries = new Map<string, number>();
  const HALF = 5 * u;

  const targets: Target[] = [
    ...geo.surfaces.filter((s) => s.kind !== "floor" && s.kind !== "slide").map((s) => ({ id: s.id, spot: s, lift: false })),
    ...geo.climbs.map((c) => ({ id: c.id, spot: { x1: c.x1, x2: c.x2, y: c.y2 }, lift: true })),
    ...highClouds.map((c) => ({ id: c.id, spot: c, lift: false })),
  ];

  for (let iter = 0; iter < 24; iter++) {
    const r = walk(m, [ground, ...geo.surfaces, ...highClouds, ...fillers], lifts);
    const open = targets.filter((t) => !(t.lift ? r.lifts.has(t.id) : r.surfaces.has(t.id)) && (tries.get(t.id) ?? 0) < 6);
    if (open.length === 0) break;

    // the unreached target closest to anything reachable, and where to start from
    let best: { from: Spot; to: Target; cost: number } | null = null;
    for (const to of open) {
      for (const from of r.spots) {
        const gap = Math.max(0, to.spot.x1 - from.x2, from.x1 - to.spot.x2);
        const cost = Math.max(0, from.y - to.spot.y - m.jumpH * 0.8) + gap * 0.5 + Math.abs(from.y - to.spot.y) * 0.1;
        if (!best || cost < best.cost) best = { from, to, cost };
      }
    }
    if (!best) break;
    const { from, to } = best;
    tries.set(to.id, (tries.get(to.id) ?? 0) + 1);

    // too high: a step up toward it (zigzagging, not a straight tower). Too far: a cloud halfway across.
    const tx = (to.spot.x1 + to.spot.x2) / 2;
    const sx = Math.max(from.x1, Math.min(from.x2, tx));
    const higher = from.y - to.spot.y > riseFrom(m, from) * 0.8;
    let y = higher ? from.y - m.jumpH * 0.7 : (from.y + to.spot.y) / 2;
    const maxDx = m.reach * (higher ? 0.5 : 0.7);
    let dx = Math.max(-maxDx, Math.min(maxDx, tx - sx));
    if (higher && Math.abs(dx) < m.reach * 0.2) dx = (iter % 2 === 0 ? 1 : -1) * m.reach * 0.3;
    let x = sx + dx;
    y = Math.max(8 * u, y);

    // nudge it sideways / up a little if it would sit inside an object
    const others = [...highClouds, ...fillers, ...geo.surfaces];
    let placed = false;
    for (const dy of [0, -3 * u, 3 * u]) {
      for (const n of [0, -6, 6, -12, 12, -18, 18]) {
        const nx = Math.max(HALF, Math.min(W - HALF, x + n * u));
        if (!blocked(m, nx - HALF, nx + HALF, y + dy, boxes, others)) {
          x = nx;
          y += dy;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    fillers.push({ id: `fill${iter}`, kind: "cloud", x1: x - HALF, x2: x + HALF, y, bounce: CLOUD_BOUNCE });
  }
  return fillers;
}
