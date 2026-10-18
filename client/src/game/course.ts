import type { Box } from "@deskcapade/shared";
import type { CourseDesign, Difficulty } from "@deskcapade/shared";
import {
  canReach,
  liftsOf,
  planPath,
  rowY,
  seeded,
  surfaceY,
  type Geometry,
  type Metrics,
  type PlacedObject,
  type Spot,
  type Surface,
} from "./level";

/* ------------------------------------------------------------------
   Challenge courses. A design (from the AI course designer on the server, or from
   localDesign() below when that isn't available) says where the course starts and ends,
   which extra ledges to add and where the hazards go. finalizeCourse() then makes it safe:
   the desk objects stay exactly where and how big they are (nothing may cover them),
   hazards stay jumpable and away from the start and the flag, and ledges are added until
   the flag can really be reached.
   ------------------------------------------------------------------ */

export type Hazard = { id: string; kind: "spikes" | "lava"; x1: number; x2: number };

export type Course = {
  difficulty: Difficulty;
  title: string;
  intro: string;
  /** Who designed it: the AI model's name, or "built-in". */
  by: string;
  /** Feet position where the player starts / where the goal flag stands. */
  start: { x: number; y: number };
  goal: { x: number; y: number };
  ledges: Surface[];
  hazards: Hazard[];
  /** All of these must be collected before the flag counts. */
  coins: { id: string; x: number; y: number }[];
  /** Beetles patrolling between x1 and x2 on top of a surface at y. */
  critters: { id: string; x1: number; x2: number; y: number }[];
  /** Beat the course within this, or start over. */
  timeLimitMs: number;
};

/**
 * The rules for each level (the AI designer is told the same, and the game enforces them):
 *   easy    no hazards, lots of close helper ledges, 3 coins
 *   medium  a set of spikes, some ledges slide back and forth, a beetle, 5 coins
 *   hard    spikes and lava, crumbling and moving ledges, no helper ledges unless the flag
 *           would be impossible, 2 beetles, 6 coins
 *   boss    everything: lots of spikes and lava, moving and crumbling ledges, 4 beetles,
 *           8 coins in daring spots
 */
type LevelRules = {
  /** How much of a full jump each added step asks for (lower = easier). */
  spacing: number;
  maxHazards: number;
  hazardKinds: readonly ("spikes" | "lava")[];
  /** Widest hazard, as a fraction of a jump's reach. */
  hazardWidth: number;
  /** Keep the designer's helper ledges? (hard and boss use the desk objects themselves) */
  helperLedges: boolean;
  coins: number;
  /** Share of the ledges that slide / that crumble. */
  moving: number;
  crumbling: number;
  critters: number;
};
export const LEVELS: Record<Difficulty, LevelRules> = {
  easy: { spacing: 0.5, maxHazards: 0, hazardKinds: [], hazardWidth: 0, helperLedges: true, coins: 3, moving: 0, crumbling: 0, critters: 0 },
  medium: { spacing: 0.7, maxHazards: 3, hazardKinds: ["spikes"], hazardWidth: 0.4, helperLedges: true, coins: 5, moving: 0.4, crumbling: 0, critters: 1 },
  hard: { spacing: 0.9, maxHazards: 5, hazardKinds: ["spikes", "lava"], hazardWidth: 0.45, helperLedges: false, coins: 6, moving: 0.25, crumbling: 0.5, critters: 2 },
  boss: { spacing: 0.95, maxHazards: 8, hazardKinds: ["spikes", "lava"], hazardWidth: 0.5, helperLedges: false, coins: 8, moving: 0.4, crumbling: 0.45, critters: 4 },
};
const LEDGE_MIN_U = 6;
const LEDGE_MAX_U = 28;
const HAZARD_MIN_U = 3;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The ground, cut into pieces around the hazards (you can't stand on spikes or lava). */
export function groundSegments(m: Metrics, hazards: readonly Hazard[]): Surface[] {
  const cuts = [...hazards].sort((a, b) => a.x1 - b.x1);
  const out: Surface[] = [];
  let x = 0;
  cuts.forEach((h, i) => {
    if (h.x1 > x) out.push({ id: `ground${i}`, kind: "ground", x1: x, x2: h.x1, y: m.groundY });
    x = Math.max(x, h.x2);
  });
  if (x < m.W) out.push({ id: "groundEnd", kind: "ground", x1: x, x2: m.W, y: m.groundY });
  return out;
}

/** Things you can stand on at the start or goal (not the inside of pools, not slides). */
const standable = (s: Surface): boolean => s.kind !== "floor" && s.kind !== "slide" && !s.bounce;
/** ...with room for your head above it (objects can reach the very top of the photo). */
const roomy = (m: Metrics, s: Surface): boolean => s.kind === "ground" || s.y >= m.playerH + 2 * m.u;

/** The surface top nearest to (x, y), within `range` vertically. */
function snapTo(surfaces: readonly Surface[], x: number, y: number, range: number): { x: number; y: number } | null {
  let best: { x: number; y: number; d: number } | null = null;
  for (const s of surfaces) {
    if (!standable(s) || x < s.x1 - 2 || x > s.x2 + 2) continue;
    const sx = clamp(x, s.x1 + 1, s.x2 - 1);
    const sy = surfaceY(s, sx);
    const d = Math.abs(sy - y);
    if (d <= range && (!best || d < best.d)) best = { x: sx, y: sy, d };
  }
  return best ? { x: best.x, y: best.y } : null;
}

const spotAt = (m: Metrics, p: { x: number; y: number }): Spot => ({ x1: p.x - m.u, x2: p.x + m.u, y: p.y });

/** Does a ledge at (x1..x2, y) cover or crowd a desk object or another ledge? */
function ledgeBlocked(m: Metrics, x1: number, x2: number, y: number, boxes: readonly Box[], ledges: readonly Surface[]): boolean {
  for (const b of boxes) {
    if (x2 > b.x - m.u && x1 < b.x + b.w + m.u && y + 2 * m.u > b.y && y - m.playerH - m.u < b.y + b.h) return true;
  }
  return ledges.some((l) => x2 > l.x1 - m.u && x1 < l.x2 + m.u && Math.abs(l.y - y) < m.playerH);
}

/** Make any design playable (see the comment at the top). */
export function finalizeCourse(
  m: Metrics,
  placed: readonly PlacedObject[],
  geo: Geometry,
  design: CourseDesign,
  difficulty: Difficulty,
  by: string,
): Course {
  const { u, W, groundY } = m;
  const boxes = placed.map((o) => o.box);
  const objectSurfaces = geo.surfaces;
  const lifts = liftsOf(geo);

  const rules = LEVELS[difficulty];

  // ---------- extra ledges (never on top of a desk object; none on hard / boss) ----------
  const ledges: Surface[] = [];
  const wantedStyle = new Map<string, string | undefined>();
  for (const [i, l] of (rules.helperLedges && Array.isArray(design.ledges) ? design.ledges : []).entries()) {
    if (!finite(l?.x) || !finite(l?.y) || !finite(l?.w)) continue;
    const w = clamp(l.w, LEDGE_MIN_U * u, LEDGE_MAX_U * u);
    const x1 = clamp(l.x, 0, W - w);
    const y = Math.max(8 * u, rowY(m, clamp(l.y, 8 * u, groundY - 6 * u), rules.spacing)); // tidy rows
    if (ledgeBlocked(m, x1, x1 + w, y, boxes, ledges)) continue;
    ledges.push({ id: `ai${i}`, kind: "ledge", x1, x2: x1 + w, y });
    wantedStyle.set(`ai${i}`, l.style);
  }

  // ---------- start ----------
  const plain = [...groundSegments(m, []), ...objectSurfaces, ...ledges].filter((s) => roomy(m, s));
  const ds = design.start ?? { x: 6 * u, y: groundY };
  const start =
    (finite(ds.x) && finite(ds.y) ? snapTo(plain, clamp(ds.x, 2 * u, W - 2 * u), ds.y, 15 * u) : null) ?? { x: 6 * u, y: groundY };

  // ---------- goal (a ledge is added under it if nothing is there) ----------
  const dg = design.goal ?? { x: W - 6 * u, y: 20 * u };
  let goal = finite(dg.x) && finite(dg.y) ? snapTo(plain, clamp(dg.x, 3 * u, W - 3 * u), dg.y, 15 * u) : null;
  if (!goal && finite(dg.x) && finite(dg.y)) {
    const gx = clamp(dg.x, 6 * u, W - 6 * u);
    const gy = clamp(dg.y, 10 * u, groundY - 6 * u);
    if (!ledgeBlocked(m, gx - 6 * u, gx + 6 * u, gy, boxes, ledges)) {
      ledges.push({ id: "goalLedge", kind: "ledge", x1: gx - 6 * u, x2: gx + 6 * u, y: gy });
      goal = { x: gx, y: gy };
    }
  }
  if (!goal || Math.hypot(goal.x - start.x, goal.y - start.y) < 20 * u) {
    // fall back to the top of the desk object farthest from the start
    const tops = objectSurfaces.filter((s) => standable(s) && roomy(m, s));
    const far = tops.sort((a, b) => Math.abs((b.x1 + b.x2) / 2 - start.x) - Math.abs((a.x1 + a.x2) / 2 - start.x))[0];
    goal = far ? { x: (far.x1 + far.x2) / 2, y: far.y } : { x: start.x < W / 2 ? W - 6 * u : 6 * u, y: groundY };
  }

  // ---------- hazards: on the ground, jumpable, away from the start, the flag and the objects ----------
  const hazards: Hazard[] = [];
  const flag = goal;
  const keepClear = (x1: number, x2: number): boolean =>
    [start, flag].some((pt) => pt.y >= groundY - 1 && x2 > pt.x - 8 * u && x1 < pt.x + 8 * u) ||
    placed.some((o) => o.box.y + o.box.h >= groundY - 4 * u && x2 > o.box.x - u && x1 < o.box.x + o.box.w + u) ||
    hazards.some((h) => x2 > h.x1 - m.playerW * 1.5 && x1 < h.x2 + m.playerW * 1.5);
  for (const [i, h] of (Array.isArray(design.hazards) ? design.hazards : []).entries()) {
    if (hazards.length >= rules.maxHazards) break;
    if (!finite(h?.x) || !finite(h?.w) || !rules.hazardKinds.includes(h.kind)) continue;
    const w = clamp(h.w, HAZARD_MIN_U * u, m.reach * rules.hazardWidth);
    const x1 = clamp(h.x, 0, W - w);
    if (keepClear(x1, x1 + w)) continue;
    hazards.push({ id: `hz${i}`, kind: h.kind, x1, x2: x1 + w });
  }

  // levels with lava always get at least one pit when any hazard fits
  if (rules.hazardKinds.includes("lava") && hazards.length > 1 && !hazards.some((h) => h.kind === "lava")) hazards[hazards.length - 1]!.kind = "lava";

  // ---------- make sure the flag can be reached ----------
  const spacing = rules.spacing;
  const solve = (hz: Hazard[]): { added: Surface[]; reached: boolean } =>
    planPath(m, boxes, [...groundSegments(m, hz), ...objectSurfaces, ...ledges], lifts, spotAt(m, start), spotAt(m, flag), spacing);
  let path = solve(hazards);
  if (!path.reached && hazards.length > 0) {
    hazards.length = 0; // the hazards made it impossible: drop them rather than the course
    path = solve(hazards);
  }
  ledges.push(...path.added);
  if (!path.reached) {
    // last resort: the flag moves to the highest spot that can be reached
    const all = [...groundSegments(m, hazards), ...objectSurfaces, ...ledges];
    const r = canReach(m, all, lifts, spotAt(m, start), spotAt(m, goal));
    // only real surfaces you can stand on, with room above (not the top of an updraft or a vine)
    const isSurface = (sp: Spot): boolean =>
      all.some((s) => Math.abs(s.x1 - sp.x1) < 1 && Math.abs(s.x2 - sp.x2) < 1 && standable(s) && roomy(m, s));
    const top = r.spots.filter((s) => s.x2 - s.x1 > m.playerW && isSurface(s)).sort((a, b) => a.y - b.y)[0];
    if (top) goal = { x: (top.x1 + top.x2) / 2, y: top.y };
  }

  // ---------- twists: some ledges slide, some crumble (never the flag's or the start's) ----------
  const rand = seeded(Math.round(start.x * 7 + goal.y * 13 + ledges.length * 31));
  for (const l of ledges) {
    const underFlag = goal.x >= l.x1 && goal.x <= l.x2 && Math.abs(goal.y - l.y) < 1;
    const underStart = start.x >= l.x1 && start.x <= l.x2 && Math.abs(start.y - l.y) < 1;
    if (underFlag || underStart) continue;
    const want = wantedStyle.get(l.id);
    const roll = rand();
    const style =
      want === "moving" && rules.moving > 0 ? "moving"
      : want === "crumbling" && rules.crumbling > 0 ? "crumbling"
      : want === "still" ? "still"
      : roll < rules.crumbling ? "crumbling"
      : roll < rules.crumbling + rules.moving ? "moving"
      : "still";
    if (style === "crumbling") l.crumble = true;
    if (style === "moving") {
      const others = ledges.filter((o) => o !== l);
      const dx = (difficulty === "medium" ? 5 : 7) * u;
      const period = 2600 + rand() * 1400;
      if (!ledgeBlocked(m, l.x1 - dx, l.x2 + dx, l.y, boxes, others)) l.motion = { dx, dy: 0, period, phase: rand() * Math.PI * 2 };
      else if (!ledgeBlocked(m, l.x1, l.x2, l.y - 4 * u, boxes, others)) l.motion = { dx: 0, dy: 4 * u, period, phase: rand() * Math.PI * 2 };
    }
  }

  // hard and boss always have at least one ledge that gives way
  if (rules.crumbling > 0 && !ledges.some((l) => l.crumble || l.motion)) {
    const pick = ledges.find((l) => !(goal.x >= l.x1 && goal.x <= l.x2 && Math.abs(goal.y - l.y) < 1));
    if (pick) pick.crumble = true;
  }

  // ---------- coins: every one must be reachable ----------
  const surfaces = [...groundSegments(m, hazards), ...objectSurfaces, ...ledges];
  const spots = canReach(m, surfaces, lifts, spotAt(m, start), spotAt(m, goal)).spots.filter((sp) => sp.x2 - sp.x1 >= m.playerW);
  const coins = placeCoins(m, Array.isArray(design.coins) ? design.coins : [], rules.coins, spots, boxes, start, goal, difficulty);

  // ---------- beetles: patrolling a stretch of ground or an object top, away from start and flag ----------
  const critters: Course["critters"] = [];
  // beetles only patrol wide stretches with plenty of room above, so you can always jump over or stomp them
  const walkable = surfaces.filter(
    (sf) => standable(sf) && !sf.motion && !sf.crumble && sf.x2 - sf.x1 >= 20 * u && (sf.kind === "ground" || sf.y >= m.playerH + m.jumpH * 0.7),
  );
  const addCritter = (x: number, y: number): void => {
    const sf = walkable.find((w) => x >= w.x1 && x <= w.x2 && Math.abs(w.y - y) < 6 * u);
    if (!sf) return;
    const x1 = Math.max(sf.x1 + u, x - 12 * u);
    const x2 = Math.min(sf.x2 - u, x + 12 * u);
    const tooClose = [start, goal].some((pt) => Math.abs(pt.y - sf.y) < 2 * u && pt.x > x1 - 12 * u && pt.x < x2 + 12 * u);
    if (x2 - x1 < 8 * u || tooClose || critters.some((c) => c.x2 > x1 && c.x1 < x2 && Math.abs(c.y - sf.y) < 2 * u)) return;
    critters.push({ id: `bug${critters.length}`, x1, x2, y: sf.y });
  };
  for (const c of Array.isArray(design.critters) ? design.critters : []) {
    if (critters.length >= rules.critters) break;
    if (finite(c?.x) && finite(c?.y)) addCritter(c.x, c.y);
  }
  for (let i = 0; critters.length < rules.critters && i < 40; i++) {
    const sf = walkable[Math.floor(rand() * walkable.length)];
    if (sf) addCritter(sf.x1 + rand() * (sf.x2 - sf.x1), sf.y);
  }

  return {
    difficulty,
    timeLimitMs: timeLimit(m, start, goal, coins, difficulty, design.timeLimitSec),
    title: typeof design.title === "string" && design.title.trim() ? design.title.trim().slice(0, 48) : "Desk Dash",
    intro: typeof design.intro === "string" ? design.intro.trim().slice(0, 160) : "",
    by,
    start,
    goal,
    ledges,
    hazards,
    coins,
    critters,
  };
}

/** How generous the clock is on each level (times the plain walking time), and a flat extra. */
const TIME_FACTOR: Record<Difficulty, number> = { easy: 4.5, medium: 4, hard: 3.6, boss: 3.3 };
const TIME_EXTRA_S: Record<Difficulty, number> = { easy: 40, medium: 45, hard: 50, boss: 55 };

/**
 * The time limit: the AI's estimate, but never shorter than the game's own generous estimate
 * (walking start -> every coin -> flag, climbing counted extra) and never absurdly long.
 */
function timeLimit(
  m: Metrics,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  coins: readonly { x: number; y: number }[],
  difficulty: Difficulty,
  aiSec: unknown,
): number {
  let at = start;
  let px = 0;
  const left = [...coins];
  const leg = (to: { x: number; y: number }): void => {
    const up = Math.max(0, at.y - to.y);
    px += Math.abs(to.x - at.x) + up * 2.5 + Math.max(0, to.y - at.y) * 0.5;
    at = to;
  };
  while (left.length > 0) {
    left.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
    leg(left.shift()!);
  }
  leg(goal);
  const ownSec = (px / m.walkV) * TIME_FACTOR[difficulty] + TIME_EXTRA_S[difficulty];
  const sec = finite(aiSec) ? clamp(aiSec, ownSec, ownSec * 2.5) : ownSec;
  return Math.ceil(sec / 5) * 5 * 1000;
}

/** Can a coin at (x, y) be grabbed from one of the reachable `spots` (standing, or with a jump)? */
function coinReachable(m: Metrics, x: number, y: number, spots: readonly Spot[]): boolean {
  return spots.some((sp) => {
    const gap = Math.max(0, sp.x1 - x, x - sp.x2);
    const rise = sp.y - y;
    return gap <= m.reach * 0.5 && rise >= -2 * m.u && rise <= m.jumpH * 0.85;
  });
}

/** The designer's coins that can really be collected, topped up from reachable spots along the course. */
function placeCoins(
  m: Metrics,
  wanted: readonly { x: number; y: number }[],
  count: number,
  spots: readonly Spot[],
  boxes: readonly Box[],
  start: { x: number; y: number },
  goal: { x: number; y: number },
  difficulty: Difficulty,
): Course["coins"] {
  const { u, W } = m;
  const coins: Course["coins"] = [];
  const free = (x: number, y: number): boolean =>
    !boxes.some((b) => x > b.x - u && x < b.x + b.w + u && y > b.y - u && y < b.y + b.h + u) &&
    !coins.some((c) => Math.hypot(c.x - x, c.y - y) < 8 * u) &&
    Math.hypot(start.x - x, start.y - 4 * u - y) > 10 * u &&
    Math.hypot(goal.x - x, goal.y - 4 * u - y) > 6 * u;
  for (const c of wanted) {
    if (coins.length >= count) break;
    if (!finite(c?.x) || !finite(c?.y)) continue;
    const x = clamp(c.x, 2 * u, W - 2 * u);
    const y = clamp(c.y, 6 * u, m.groundY - 3 * u);
    if (free(x, y) && coinReachable(m, x, y, spots)) coins.push({ id: `coin${coins.length}`, x, y });
  }
  // top up: spread over the reachable spots, from one end of the course to the other
  const sorted = [...spots].sort((a, b) => a.x1 - b.x1);
  const lift = difficulty === "boss" ? 0.6 : difficulty === "hard" ? 0.4 : 0; // tougher levels hang coins higher
  for (let i = 0; coins.length < count && i < sorted.length * 3; i++) {
    const sp = sorted[Math.floor(((i * 0.618033) % 1) * sorted.length)]!;
    const x = clamp((sp.x1 + sp.x2) / 2, 2 * u, W - 2 * u);
    const y = Math.max(6 * u, sp.y - 4 * u - m.jumpH * lift);
    if (free(x, y) && coinReachable(m, x, y, spots)) coins.push({ id: `coin${coins.length}`, x, y });
  }
  return coins;
}

/* ---------- the built-in designer (no AI needed) ---------- */

const TITLE_A = ["Mossy", "Teacup", "Whispering", "Sunny", "Tangled", "Pebble", "Bramble", "Starlit", "Clover", "Puddle"];
const TITLE_B = ["Climb", "Trail", "Scramble", "Hop", "Ramble", "Gauntlet", "Ascent", "Dash", "Quest", "Caper"];

/** A course from the desk alone: start on the ground on one side, flag up high on the far side. */
export function localDesign(m: Metrics, placed: readonly PlacedObject[], geo: Geometry, difficulty: Difficulty, seed: number): CourseDesign {
  const rand = seeded(seed);
  const { u, W, groundY } = m;
  // somewhere to plant a flag: wide enough to stand on, and not hugging the top edge of the photo
  const tops = geo.surfaces.filter((s) => standable(s) && roomy(m, s) && s.x2 - s.x1 >= m.playerW * 1.5 && s.y >= 15 * u);

  // the flag: the highest object top (hard: a ledge above it), else high on one side
  const highest = [...tops].sort((a, b) => a.y - b.y)[0];
  let goal = highest
    ? { x: (highest.x1 + highest.x2) / 2, y: highest.y }
    : { x: rand() < 0.5 ? W * 0.2 : W * 0.8, y: groundY - 30 * u };
  if (difficulty === "hard" || difficulty === "boss") goal = { x: goal.x, y: Math.max(12 * u, goal.y - m.jumpH * 1.3) }; // a ledge well above it
  else if (difficulty === "easy" && highest && groundY - highest.y > m.jumpH * 3) {
    // easy: a lower object if the highest one is a long climb
    const lower = [...tops].sort((a, b) => b.y - a.y).find((s) => groundY - s.y > m.jumpH * 0.8);
    if (lower) goal = { x: (lower.x1 + lower.x2) / 2, y: lower.y };
  }

  // the start: the ground on the far side from the flag
  const start = { x: goal.x > W / 2 ? 6 * u : W - 6 * u, y: groundY };

  // hazards evenly spread between start and flag, each a different moment of the run
  const rules = LEVELS[difficulty];
  const count = { easy: 0, medium: 2, hard: 4, boss: 7 }[difficulty];
  const width = m.reach * rules.hazardWidth * 0.9;
  const lo = Math.min(start.x, goal.x) + 10 * u;
  const hi = Math.max(start.x, goal.x) - 10 * u;
  const hazards: CourseDesign["hazards"] = [];
  for (let i = 0; i < count && hi > lo; i++) {
    const cx = lo + ((i + 0.5) / count) * (hi - lo) + (rand() - 0.5) * 6 * u;
    const kind = rules.hazardKinds.length === 1 ? rules.hazardKinds[0]! : i % 2 ? "lava" : "spikes";
    hazards.push({ kind, x: cx - width / 2, w: width });
  }

  const title = `${TITLE_A[Math.floor(rand() * TITLE_A.length)]} ${TITLE_B[Math.floor(rand() * TITLE_B.length)]}`;
  const intro = {
    easy: "A gentle stroll across the desk. Grab the coins and hop up to the flag!",
    medium: "Mind the spikes! Collect every coin, then reach the flag.",
    hard: "Spikes, lava and no helping hand: only the desk itself will get you up there.",
    boss: "The desk at its most dangerous. Every coin, every hazard, one flag. Good luck!",
  }[difficulty];
  // helper ledges: easy gets extra stepping stones between the objects (the planner adds the rest)
  const ledges: CourseDesign["ledges"] = [];
  if (difficulty === "easy" || difficulty === "medium") {
    // beside each tall object (on whichever side has room), stepping stones up to its top;
    // on medium they're further apart and every other one slides back and forth
    const row = m.jumpH * rules.spacing;
    for (const s of tops) {
      const height = groundY - s.y;
      if (height < m.jumpH * 0.6) continue;
      const side = s.x2 + 18 * u < W ? s.x2 + 2 * u : s.x1 - 16 * u;
      for (let k = 1; k * row < height; k++) {
        ledges.push({ x: side, y: groundY - k * row, w: 14 * u, style: difficulty === "medium" && k % 2 === 0 ? "moving" : "still" });
      }
    }
  }
  return { title, intro, start, goal, ledges, hazards, coins: [] };
}
