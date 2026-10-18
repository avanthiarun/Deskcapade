import type { Box } from "@deskcapade/shared";
import type { ObjectKind } from "./materials";

/* ------------------------------------------------------------------
   Level geometry for the garden platformer, all in canvas pixels.

   Every desk object becomes surfaces (things you stand on), climbs (vines, ladders,
   water you can swim up) and walls (pool sides), exactly the size of the object's box.
   A few tree branches hang at the top of the map; reaching them is the goal.

   The level designer (planFillers) then walks the level like a player would: starting
   on the ground, which surfaces can be jumped to, climbed to, bounced to? Wherever a desk
   object or a branch can't be reached, it adds a stepping stone where one is needed:
   a floating leaf low down, a cloud in the open sky, a branch near the top or the edges.
   ------------------------------------------------------------------ */

export type SurfaceKind =
  | "ground"
  | "top" // top of a plain desk object
  | "leaf" // the leaf pad on top of a vine
  | "rim" // a pool's rim
  | "floor" // a pool's floor
  | "mushroom"
  | "branch"
  | "cloud"
  | "pad"; // a floating leaf stepping stone

/** A one-way platform: you land on it from above and can jump up through it. */
export type Surface = {
  id: string;
  kind: SurfaceKind;
  x1: number;
  x2: number;
  y: number;
  bounce?: boolean;
  /** Branches growing out of the left or right edge of the map. */
  side?: "left" | "right";
};

/** Something you can move up and down inside: a vine, a ladder, or a pool's water. */
export type Climb = { id: string; kind: "vine" | "ladder" | "water"; x1: number; x2: number; y1: number; y2: number };

/** A solid side wall (pool sides). */
export type Wall = { x1: number; x2: number; y1: number; y2: number };

export type GameObject = {
  id: string;
  label: string;
  templateId: string | null;
  /** Canvas pixels, the object's real size. */
  box: Box;
  /** The object's pixel sprite (drawn for plain platforms). */
  sprite?: HTMLCanvasElement;
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
  /** How high a mushroom bounce safely gets you. */
  bounceH: number;
};

/** The ground line, as a fraction of the canvas height. */
export const GROUND_FRAC = 0.94;

export function metrics(W: number, H: number, physics: { gravity: number; jumpV: number; moveV: number; bounceV: number }): Metrics {
  const u = H / 100;
  const { gravity, jumpV, moveV, bounceV } = physics;
  return {
    W,
    H,
    u,
    groundY: Math.round(H * GROUND_FRAC),
    playerW: 4.5 * u,
    playerH: 7.5 * u,
    jumpH: 0.85 * ((jumpV * jumpV) / (2 * gravity)) * u,
    reach: 0.75 * moveV * ((2 * jumpV) / gravity) * u,
    bounceH: 0.85 * ((bounceV * bounceV) / (2 * gravity)) * u,
  };
}

/* ---------- desk objects ---------- */

export type PoolLayout = {
  wall: number;
  waterTop: number;
  ladderSide: "left" | "right";
  ladder: { x1: number; x2: number; y1: number; y2: number };
};

/** Where a pool's walls, water and ladder go, or null if the cup is too narrow to swim in (it's then a platform). */
export function poolLayout(box: Box, m: Metrics): PoolLayout | null {
  const wall = Math.max(m.u, box.w * 0.1);
  if (box.w - wall * 2 < m.playerW + m.u) return null;
  const roomLeft = box.x;
  const roomRight = m.W - (box.x + box.w);
  const ladderSide = roomRight >= roomLeft ? "right" : "left";
  const half = 1.5 * m.u;
  // far enough from the wall that the climbing player doesn't bump into it
  const cx = ladderSide === "right" ? box.x + box.w + m.playerW / 2 + 0.3 * m.u : box.x - m.playerW / 2 - 0.3 * m.u;
  return {
    wall,
    waterTop: box.y + box.h * 0.2,
    ladderSide,
    ladder: { x1: cx - half, x2: cx + half, y1: box.y, y2: Math.max(m.groundY, box.y + box.h) },
  };
}

export type ObjectGeometry = { surfaces: Surface[]; climbs: Climb[]; walls: Wall[] };

/** The vine's leaf pad is at least this wide (in u) so it's easy to land on. */
const MIN_PAD_HALF_U = 3;

export function vinePadHalf(box: Box, m: Metrics): number {
  return Math.max(MIN_PAD_HALF_U * m.u, box.w / 2);
}

export function objectGeometry(objects: readonly PlacedObject[], m: Metrics): ObjectGeometry {
  const surfaces: Surface[] = [];
  const climbs: Climb[] = [];
  const walls: Wall[] = [];

  for (const o of objects) {
    const b = o.box;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    switch (o.kind) {
      case "vine": {
        const cx = b.x + b.w / 2;
        const half = Math.max(1.2 * m.u, b.w * 0.3);
        const pad = vinePadHalf(b, m);
        climbs.push({ id: `${o.id}:vine`, kind: "vine", x1: cx - half, x2: cx + half, y1: b.y, y2: bottom });
        surfaces.push({ id: `${o.id}:leaf`, kind: "leaf", x1: cx - pad, x2: cx + pad, y: b.y });
        break;
      }
      case "pool": {
        const pool = poolLayout(b, m);
        if (!pool) {
          surfaces.push({ id: `${o.id}:top`, kind: "top", x1: b.x, x2: right, y: b.y });
          break;
        }
        const { wall, ladder, ladderSide } = pool;
        walls.push({ x1: b.x, x2: b.x + wall, y1: b.y, y2: bottom }, { x1: right - wall, x2: right, y1: b.y, y2: bottom });
        // the rim on the ladder's side stretches over the ladder, so climbing up lands you on it
        surfaces.push(
          { id: `${o.id}:rimL`, kind: "rim", x1: ladderSide === "left" ? ladder.x1 : b.x, x2: b.x + wall, y: b.y },
          { id: `${o.id}:rimR`, kind: "rim", x1: right - wall, x2: ladderSide === "right" ? ladder.x2 : right, y: b.y },
          { id: `${o.id}:floor`, kind: "floor", x1: b.x + wall, x2: right - wall, y: bottom - wall },
        );
        climbs.push(
          { id: `${o.id}:water`, kind: "water", x1: b.x + wall, x2: right - wall, y1: pool.waterTop, y2: bottom - wall },
          { id: `${o.id}:ladder`, kind: "ladder", ...ladder },
        );
        break;
      }
      case "mushroom":
        surfaces.push({ id: `${o.id}:cap`, kind: "mushroom", x1: b.x, x2: right, y: b.y, bounce: true });
        break;
      default:
        surfaces.push({ id: `${o.id}:top`, kind: "top", x1: b.x, x2: right, y: b.y });
    }
  }
  return { surfaces, climbs, walls };
}

/* ---------- branches at the top ---------- */

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

export type SeedSpot = { x: number; y: number };

/** A few random tree branches across the top of the map, each holding a seed to collect. */
export function makeBranches(m: Metrics, seed: number): { branches: Surface[]; seeds: SeedSpot[] } {
  const rand = seeded(seed);
  const { W, u } = m;
  const n = Math.max(3, Math.min(5, Math.round(W / (m.H * 0.45))));
  const slot = W / n;
  const branches: Surface[] = [];
  for (let i = 0; i < n; i++) {
    const w = Math.min(slot * 0.8, (14 + rand() * 6) * u);
    const cx = slot * (i + 0.5) + (rand() - 0.5) * 0.3 * slot;
    const y = (12 + rand() * 12) * u;
    let x1 = cx - w / 2;
    let x2 = cx + w / 2;
    let side: "left" | "right" | undefined;
    if (i === 0 && rand() < 0.6) {
      x1 = 0;
      side = "left";
    } else if (i === n - 1 && rand() < 0.6) {
      x2 = W;
      side = "right";
    }
    branches.push({ id: `branch${i}`, kind: "branch", x1, x2, y, ...(side ? { side } : {}) });
  }
  const seeds = branches.map((b) => ({ x: (b.side === "left" ? b.x2 - 4 * u : b.side === "right" ? b.x1 + 4 * u : (b.x1 + b.x2) / 2), y: b.y }));
  return { branches, seeds };
}

/* ---------- the level designer ---------- */

/** A spot you can stand on (or hang at) during the reachability walk. */
type Spot = { x1: number; x2: number; y: number; bounce?: boolean };

/** Can you get from standing on `from` to landing on `to`? Conservative, so planned levels are always playable. */
function canJump(m: Metrics, from: Spot, to: Spot): boolean {
  const rise = from.y - to.y; // > 0: `to` is higher
  const gap = Math.max(0, to.x1 - from.x2, from.x1 - to.x2);
  const jumpH = from.bounce ? m.bounceH : m.jumpH;
  if (rise > jumpH) return false;
  if (rise > 0) return gap <= m.reach * (1 - 0.4 * (rise / jumpH));
  return gap <= m.reach + Math.min(-rise, 40 * m.u) * 0.6; // falling buys extra distance
}

/** Can you grab climb `c` from `from` (jump up to its bottom, or drop onto it from above)? */
function canGrab(m: Metrics, from: Spot, c: Climb): boolean {
  const gap = Math.max(0, c.x1 - from.x2, from.x1 - c.x2);
  const jumpH = from.bounce ? m.bounceH : m.jumpH;
  return from.y - c.y2 <= jumpH && gap <= m.reach * 0.8;
}

type Reach = { spots: Spot[]; surfaces: Set<string>; climbs: Set<string> };

/** Everything reachable from the ground. */
function walk(m: Metrics, surfaces: readonly Surface[], climbs: readonly Climb[]): Reach {
  const ground = surfaces.find((s) => s.kind === "ground");
  const reached: Reach = { spots: [], surfaces: new Set(), climbs: new Set() };
  if (!ground) return reached;
  const queue: Spot[] = [ground];
  reached.surfaces.add(ground.id);
  while (queue.length > 0) {
    const from = queue.shift()!;
    reached.spots.push(from);
    for (const s of surfaces) {
      if (reached.surfaces.has(s.id) || !canJump(m, from, s)) continue;
      reached.surfaces.add(s.id);
      queue.push(s);
    }
    for (const c of climbs) {
      if (reached.climbs.has(c.id) || !canGrab(m, from, c)) continue;
      reached.climbs.add(c.id);
      // from a climb you can jump off anywhere along it; its top and bottom cover the extremes
      queue.push({ x1: c.x1, x2: c.x2, y: c.y1 }, { x1: c.x1, x2: c.x2, y: c.y2 });
    }
  }
  return reached;
}

type Target = { id: string; spot: Spot; climb: boolean };

/** True if a stepping stone at (x1..x2, y) would sit inside an object or crowd another platform. */
function blocked(m: Metrics, x1: number, x2: number, y: number, boxes: readonly Box[], others: readonly Surface[]): boolean {
  const top = y - m.playerH - m.u; // leave headroom to stand on it
  const bottom = y + 2 * m.u;
  for (const b of boxes) {
    if (x2 > b.x - m.u && x1 < b.x + b.w + m.u && bottom > b.y && top < b.y + b.h) return true;
  }
  for (const s of others) {
    if (x2 > s.x1 && x1 < s.x2 && Math.abs(s.y - y) < m.playerH) return true;
  }
  return false;
}

/**
 * Add stepping stones (clouds, branches, floating leaves) until every desk object and
 * every top branch can be reached from the ground. Returns only the new stones.
 */
export function planFillers(
  m: Metrics,
  objects: readonly PlacedObject[],
  geo: ObjectGeometry,
  branches: readonly Surface[],
): Surface[] {
  const { u, W } = m;
  const ground: Surface = { id: "ground", kind: "ground", x1: 0, x2: W, y: m.groundY };
  const fillers: Surface[] = [];
  const boxes = objects.map((o) => o.box);
  const tries = new Map<string, number>();
  const STONE_HALF = 5 * u;

  const targets: Target[] = [
    ...geo.surfaces.filter((s) => s.kind !== "floor").map((s) => ({ id: s.id, spot: s, climb: false })),
    ...geo.climbs.filter((c) => c.kind !== "water").map((c) => ({ id: c.id, spot: { x1: c.x1, x2: c.x2, y: c.y2 }, climb: true })),
    ...branches.map((b) => ({ id: b.id, spot: b, climb: false })),
  ];

  for (let iter = 0; iter < 24; iter++) {
    const all = [ground, ...geo.surfaces, ...branches, ...fillers];
    const r = walk(m, all, geo.climbs);
    const open = targets.filter(
      (t) => !(t.climb ? r.climbs.has(t.id) : r.surfaces.has(t.id)) && (tries.get(t.id) ?? 0) < 6,
    );
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

    // step from the point on `from` closest to the target, up and toward it
    const tx = (to.spot.x1 + to.spot.x2) / 2;
    const sx = Math.max(from.x1, Math.min(from.x2, tx));
    const higher = from.y - to.spot.y > m.jumpH * 0.8;
    // too high: a step up toward it (zigzagging, not a straight tower). Too far: a stone halfway across.
    let y = higher ? from.y - m.jumpH * 0.7 : (from.y + to.spot.y) / 2;
    const maxDx = m.reach * (higher ? 0.5 : 0.7);
    let dx = Math.max(-maxDx, Math.min(maxDx, tx - sx));
    if (higher && Math.abs(dx) < m.reach * 0.2) dx = (iter % 2 === 0 ? 1 : -1) * m.reach * 0.3;
    let x = sx + dx;
    y = Math.max(8 * u, y);

    // nudge it sideways / up a little if it would sit inside an object
    const others = [...branches, ...fillers, ...geo.surfaces];
    const nudges = [0, -6, 6, -12, 12, -18, 18];
    let placed = false;
    for (const dy of [0, -3 * u, 3 * u]) {
      for (const n of nudges) {
        const nx = Math.max(STONE_HALF, Math.min(W - STONE_HALF, x + n * u));
        if (!blocked(m, nx - STONE_HALF, nx + STONE_HALF, y + dy, boxes, others)) {
          x = nx;
          y += dy;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    let x1 = x - STONE_HALF;
    let x2 = x + STONE_HALF;
    let kind: SurfaceKind;
    let side: "left" | "right" | undefined;
    const nearEdge = x < 14 * u || x > W - 14 * u;
    if (y < m.H * 0.35 || nearEdge) {
      kind = "branch";
      if (x < 14 * u) {
        x1 = 0;
        side = "left";
      } else if (x > W - 14 * u) {
        x2 = W;
        side = "right";
      }
    } else if (y < m.H * 0.6) {
      kind = "cloud";
    } else {
      kind = "pad";
    }
    fillers.push({ id: `fill${iter}`, kind, x1, x2, y, ...(side ? { side } : {}) });
  }
  return fillers;
}
