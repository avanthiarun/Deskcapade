import {
  artPixel,
  drawBigFlame,
  drawCloud,
  drawGeyser,
  drawGround,
  drawLadder,
  drawSeed,
  drawSlide,
  drawSprout,
  drawUpdraft,
  type Rect,
} from "./art";
import type { CourseDesign, CourseObject, Difficulty } from "@deskcapade/shared";
import { finalizeCourse, groundSegments, localDesign, type Course } from "./course";
import { drawBeetle, drawCoin, drawGoalFlag, drawSlab, drawGroundSpikes, drawLedgeGhost, drawLavaPit, drawLedge, drawPiece, drawStartSign, tonesOf } from "./pieces";
import {
  BRIDGE_SAG_U,
  GEYSER_ON_MS,
  GEYSER_PERIOD_MS,
  bridgeDeckY,
  conveyorDir,
  geyserTime,
  makeHighClouds,
  SLAB_THICK_U,
  slabsUnder,
  metrics,
  objectGeometry,
  planFillers,
  poolLayout,
  surfaceY,
  type GameObject,
  type Geometry,
  type Metrics,
  type PlacedObject,
  type Surface,
} from "./level";
import { objectKind, type ObjectKind } from "./materials";
import { sfx } from "../lib/sound";

/* ------------------------------------------------------------------
   The garden platformer. You're a little garden sprite; the desk objects on screen are
   your world (see materials.ts for what each one does), plus bouncy clouds. Collect the
   golden seeds waiting on the high clouds and on the objects.

   Story mode: the level is live. Call setObjects() every frame with what the camera sees;
     objects move, appear and vanish, and the level designer re-plans the stepping clouds.
     Collecting every seed makes the garden bloom, then new clouds (and seeds) appear.
   Challenge mode: the level is frozen around one photo. Collect every seed as fast as you can.

   Physics speeds are in u per second, where u = 1/100 of the canvas height.
   ------------------------------------------------------------------ */

const GRAVITY = 300;
const JUMP_V = 105;
const MOVE_V = 48;
const BOUNCE_V = 175;
const CLIMB_V = 38;
const MAX_FALL = 170;
const WATER_GRAVITY = 80;
const MAX_SINK = 20;
const SWIM_V = 50;
const SLIDE_V = 95;
const UPDRAFT_ACC = 420;
const UPDRAFT_MAX = 42;
const GEYSER_V = 115;
const ICE_GRIP = 2.2; // lower = slipperier
const JELLO_SPEED = 0.45; // moving through jello: this much of your normal speed
const JELLO_JUMP = 0.75;
const JELLO_MAX_FALL = 30; // you sink through jello slowly
const FIRE_MS = 4000;
const FIRE_SPEED = 1.35; // running around on fire is fast
const SAFE_MS = 1500; // blinking after a respawn: spikes can't hurt you
const COYOTE_MS = 90;
const JUMP_BUFFER_MS = 120;
const DROP_MS = 250;
const STEP_S = 1 / 120;
const REPLAN_MS = 600;
const BLOOM_MS = 2600;
const SQUASH_MS = 220;
const SEED_PICKUP_U = 4.5;

const PHYSICS = { gravity: GRAVITY, jumpV: JUMP_V, moveV: MOVE_V, bounceV: BOUNCE_V };

type Player = {
  x: number;
  /** Feet. */
  y: number;
  vx: number;
  vy: number;
  /** Extra sideways speed that fades out (slide launches). */
  boost: number;
  onGround: boolean;
  climbing: boolean;
  /** Rising from a jump (not a bounce), so letting go of jump early cuts it short. */
  hopping: boolean;
  facing: 1 | -1;
  /** The surface under the player, as it was last step (so moving objects carry the player). */
  standing: { id: string; x1: number } | null;
  lastGroundAt: number;
  dropUntil: number;
  fireUntil: number;
  safeUntil: number;
  walk: number;
};

type Particle = { x: number; y: number; vx: number; vy: number; born: number; life: number; color: string; rise: boolean };
type FloatText = { text: string; x: number; y: number; born: number };

export type PlatformerOptions = {
  mode: "story" | "challenge";
  /** Picks the random cloud layout. */
  seed?: number;
  /** Challenge: every seed collected, in `ms` since the first move. */
  onWin?: (ms: number) => void;
  /** Challenge: the clock ran out (the course starts over). */
  onTimeUp?: () => void;
  /** Bouncy clouds in the sky (on by default; Story turns them off: only your desk pieces are solid). */
  clouds?: boolean;
};

const JUMP_KEYS = new Set(["ArrowUp", "w", "W", " ", "Spacebar"]);
const GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "A", "d", "D", "w", "W", "s", "S", " ", "Spacebar"]);

const overlaps = (ax1: number, ax2: number, bx1: number, bx2: number): boolean => ax2 > bx1 && ax1 < bx2;
const curved = (s: Surface): boolean => s.slope !== undefined || s.sag !== undefined;

export class Platformer {
  private m: Metrics = metrics(1280, 720, PHYSICS);
  private p = artPixel(this.m.u);
  private placed: PlacedObject[] = [];
  private geo: Geometry = { surfaces: [], climbs: [], zones: [], walls: [] };
  private surfaces: Surface[] = [];
  private highClouds: Surface[] = [];
  private cloudsNow: Surface[] = [];
  private fillers: Surface[] = [];
  private cloudSeed: number;
  private planKey = "";
  private plannedAt = -Infinity;
  /** Challenge: the obstacle course being played (start, flag, added ledges, hazards). */
  private course: Course | null = null;
  private deaths = 0;
  private lockedSaidAt = -Infinity;
  /** Ledges where they are right now (moving ones slide, crumbled ones are missing). */
  private fillersNow: Surface[] = [];
  /** Crumbling ledges: when you stepped on them, and until when they're gone. */
  private crumbles = new Map<string, { touchedAt: number | null; goneUntil: number }>();
  /** Challenge beetles: where each one is, which way it walks, and until when it's knocked out. */
  private bugs: { id: string; x1: number; x2: number; y: number; x: number; dir: 1 | -1; outUntil: number }[] = [];
  private paused = false;
  /** World scale (see setSize). */
  private zoom = 1;
  /** Challenge: when the clock last ran out (shows "Time's up!"). */
  private timeUpAt = -Infinity;
  /** Story: how many times the garden has bloomed (every seed collected). */
  private blooms = 0;
  private pausedAt = 0;
  private player: Player = this.spawn();
  private keys = new Set<string>();
  private jumpAt = -Infinity;
  private lastNow = 0;
  private startedAt: number | null = null;
  private wonMs: number | null = null;
  private bloomAt: number | null = null;
  private got = new Set<string>();
  private bounceAt = new Map<string, number>();
  private bridgeLoad = new Map<string, number>();
  private particles: Particle[] = [];
  private texts: FloatText[] = [];

  constructor(private readonly opts: PlatformerOptions) {
    this.cloudSeed = opts.seed ?? 1;
    this.newClouds();
  }

  /* ---------- setup ---------- */

  /** Match the canvas size (cheap when unchanged). */
  /**
   * Match the canvas size (cheap when unchanged). `zoom` scales the whole world (player, jumps,
   * pixel size) to how big the objects look: see sceneZoom.
   */
  setSize(W: number, H: number, zoom = this.zoom): void {
    if (W === this.m.W && H === this.m.H && zoom === this.zoom) return;
    const rescale = W === this.m.W && H === this.m.H; // only the zoom changed: keep the player's spot
    const keep = { x: this.player.x / this.m.W, y: this.player.y / this.m.H };
    this.zoom = zoom;
    this.m = metrics(W, H, PHYSICS, zoom);
    this.p = artPixel(this.m.u);
    this.newClouds();
    this.player = this.spawn();
    if (rescale) {
      // same picture, new scale: stay where you were
      this.player.x = keep.x * W;
      this.player.y = Math.min(this.m.groundY, keep.y * H);
      this.player.onGround = false;
    }
  }

  /** The desk objects, in canvas pixels. Story calls this every frame; Challenge once. */
  setObjects(objects: readonly GameObject[], now = performance.now()): void {
    this.placed = objects.map((o) => ({ ...o, kind: this.kindOf(o) }));
    this.geo = objectGeometry(this.placed, this.m);

    // re-plan the stepping clouds when the desk changes enough to matter
    const q = 4 * this.m.u;
    const key = this.placed
      .map((o) => `${o.id}:${o.kind}:${Math.round(o.box.x / q)},${Math.round(o.box.y / q)},${Math.round(o.box.w / q)},${Math.round(o.box.h / q)}`)
      .sort()
      .join("|");
    if (this.course) this.addHazardZones();
    else if (this.opts.clouds !== false && key !== this.planKey && now - this.plannedAt >= REPLAN_MS) {
      this.planKey = key;
      this.plannedAt = now;
      this.fillers = planFillers(this.m, this.placed, this.geo, this.highClouds);
    }
    this.rebuild(now);
  }

  /** The level as the course designer sees it: the objects (and what they became) and the jump physics. */
  levelInfo(): { width: number; height: number; objects: CourseObject[]; physics: { groundY: number; jumpHeight: number; jumpReach: number; playerWidth: number; playerHeight: number } } {
    const m = this.m;
    return {
      width: m.W,
      height: m.H,
      objects: this.placed.map((o) => ({ id: o.id, label: o.label, kind: o.kind, box: o.box })),
      physics: { groundY: m.groundY, jumpHeight: m.jumpH, jumpReach: m.reach, playerWidth: m.playerW, playerHeight: m.playerH },
    };
  }

  /**
   * Challenge: play an obstacle course. `design` comes from the AI course designer; null lets
   * the game design one itself. Either way it is checked and completed so it can be beaten.
   */
  useCourse(design: CourseDesign | null, difficulty: Difficulty, by: string): Course {
    const plan = design ?? localDesign(this.m, this.placed, this.geo, difficulty, Math.floor(Math.random() * 1e9));
    this.course = finalizeCourse(this.m, this.placed, this.geo, plan, difficulty, design ? by : "built-in");
    this.highClouds = [];
    this.fillers = this.course.ledges;
    this.fillersNow = this.fillers;
    this.geo.zones = this.geo.zones.filter((z) => !z.id.startsWith("course:"));
    this.addHazardZones();
    this.restart();
    this.rebuild(performance.now());
    return this.course;
  }

  /** Spikes and lava from the course become zones that send you back to the start. */
  private addHazardZones(): void {
    if (!this.course) return;
    const { u, groundY, H } = this.m;
    for (const h of this.course.hazards) {
      this.geo.zones.push(
        h.kind === "lava"
          ? { id: `course:${h.id}`, kind: "lava", x1: h.x1, x2: h.x2, y1: groundY - 0.5 * u, y2: H, owner: h.id }
          : { id: `course:${h.id}`, kind: "spikes", x1: h.x1 + 0.5 * u, x2: h.x2 - 0.5 * u, y1: groundY - 3 * u, y2: groundY + 1, owner: h.id },
      );
    }
  }

  /** Pause / resume (the clock stops while paused). */
  setPaused(paused: boolean, now = performance.now()): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.pausedAt = now;
      this.keys.clear();
    } else if (this.startedAt !== null && this.wonMs === null) {
      this.startedAt += now - this.pausedAt;
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** What the page's top bar shows. */
  stats(now = performance.now()): {
    seeds: { got: number; total: number } | null;
    coins: { got: number; total: number } | null;
    timeMs: number | null;
    /** Challenge: the course's time limit. */
    limitMs: number | null;
    respawns: number;
    blooms: number;
    won: boolean;
    onFire: boolean;
  } {
    const spots = this.seedSpots();
    const got = spots.filter((sp) => this.got.has(sp.id)).length;
    const clock = this.paused ? this.pausedAt : now;
    return {
      seeds: this.course ? null : { got, total: spots.length },
      coins: this.course ? { got, total: spots.length } : null,
      timeMs: this.opts.mode === "challenge" ? (this.wonMs ?? (this.startedAt === null ? 0 : clock - this.startedAt)) : null,
      limitMs: this.course?.timeLimitMs ?? null,
      respawns: this.deaths,
      blooms: this.blooms,
      won: this.wonMs !== null,
      onFire: this.player.fireUntil > now,
    };
  }

  /** Back to the start (Challenge's restart). */
  restart(): void {
    this.player = this.spawn();
    this.deaths = 0;
    this.crumbles.clear();
    this.bugs = (this.course?.critters ?? []).map((c, i) => ({ ...c, x: (c.x1 + c.x2) / 2, dir: i % 2 ? -1 : 1, outUntil: 0 }));
    this.got.clear();
    this.startedAt = null;
    this.wonMs = null;
  }

  /** Keyboard controls on `window`. Returns a function that removes them. */
  attachInput(): () => void {
    const typing = (e: KeyboardEvent): boolean => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (typing(e)) return;
      if (e.key === "r" || e.key === "R") {
        if (this.opts.mode === "challenge") this.restart();
        else this.player = this.spawn();
        return;
      }
      if (!GAME_KEYS.has(e.key)) return;
      e.preventDefault(); // no page scrolling while playing
      if (JUMP_KEYS.has(e.key) && !e.repeat) this.jumpAt = performance.now();
      this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if (this.startedAt === null) this.startedAt = performance.now();
    };
    const up = (e: KeyboardEvent): void => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };
    const blur = (): void => this.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  private kindOf(o: GameObject): ObjectKind {
    return objectKind(o.label);
  }

  private spawn(): Player {
    return {
      x: this.course?.start.x ?? 6 * this.m.u,
      y: this.course?.start.y ?? this.m.groundY,
      vx: 0,
      vy: 0,
      boost: 0,
      onGround: true,
      climbing: false,
      hopping: false,
      facing: 1,
      standing: null,
      lastGroundAt: 0,
      dropUntil: 0,
      fireUntil: 0,
      safeUntil: 0,
      walk: 0,
    };
  }

  private newClouds(): void {
    this.highClouds = this.opts.clouds === false ? [] : makeHighClouds(this.m, this.cloudSeed);
    this.fillers = [];
    this.planKey = "";
    this.plannedAt = -Infinity;
    this.got.clear();
  }

  /** All solid things this moment: ground, desk objects, clouds (the high ones drift a little). */
  private rebuild(now: number): void {
    const { u } = this.m;
    this.cloudsNow = this.highClouds.map((c, i) => {
      const dx = Math.sin(now / 3000 + i * 1.7) * 2 * u;
      return { ...c, x1: c.x1 + dx, x2: c.x2 + dx };
    });
    const ground: Surface = { id: "ground", kind: "ground", x1: 0, x2: this.m.W, y: this.m.groundY };
    const grounds = this.course ? groundSegments(this.m, this.course.hazards) : [ground];
    this.fillersNow = this.fillers
      .filter((f) => !f.crumble || now >= (this.crumbles.get(f.id)?.goneUntil ?? 0))
      .map((f) => {
        if (!f.motion) return f;
        const k = Math.sin((now / f.motion.period) * Math.PI * 2 + f.motion.phase);
        return { ...f, x1: f.x1 + f.motion.dx * k, x2: f.x2 + f.motion.dx * k, y: f.y + f.motion.dy * k };
      });
    this.surfaces = [...grounds, ...this.geo.surfaces, ...this.cloudsNow, ...this.fillersNow];
  }

  /** Seeds: one on every high cloud, one on every desk object that isn't a hazard. */
  private seedSpots(): { id: string; x: number; y: number }[] {
    const { u } = this.m;
    if (this.course) return this.course.coins; // Challenge: the coins to collect before the flag counts
    const out = this.cloudsNow.map((c) => ({ id: c.id, x: (c.x1 + c.x2) / 2, y: c.y - u }));
    for (const o of this.placed) {
      const b = o.box;
      const x = b.x + b.w / 2;
      switch (o.kind) {
        case "spikes":
        case "flame":
          continue;
        case "updraft":
          out.push({ id: o.id, x, y: Math.max(8 * u, b.y - 30 * u) });
          break;
        case "geyser":
          out.push({ id: o.id, x, y: Math.max(8 * u, b.y - 24 * u) });
          break;
        case "bridge":
          out.push({ id: o.id, x, y: bridgeDeckY(b) - u });
          break;
        default:
          out.push({ id: o.id, x, y: b.y - 2 * u });
      }
    }
    return out;
  }

  /* ---------- simulation ---------- */

  update(now = performance.now()): void {
    const dt = this.lastNow ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    if (this.paused) return;
    const { u } = this.m;

    // story: after the bloom, new clouds (and seeds) appear
    if (this.bloomAt !== null && now - this.bloomAt > BLOOM_MS) {
      this.bloomAt = null;
      this.blooms++;
      this.cloudSeed += 1;
      this.newClouds();
      this.planKey = "";
      if (this.opts.clouds !== false) this.fillers = planFillers(this.m, this.placed, this.geo, this.highClouds);
    }

    this.rebuild(now);
    this.carry();
    for (let left = dt; left > 1e-6; left -= STEP_S) this.step(Math.min(STEP_S, left), now);
    this.updateCourseTwists(dt, now);
    // Challenge: out of time = start the course over
    if (this.course && this.wonMs === null && this.startedAt !== null && now - this.startedAt > this.course.timeLimitMs) {
      this.timeUpAt = now;
      sfx("timeup");
      this.opts.onTimeUp?.();
      this.restart();
    }

    // bridges sag under you
    for (const s of this.geo.surfaces) {
      if (s.kind !== "bridge") continue;
      const target = this.player.onGround && this.player.standing?.id === s.id ? BRIDGE_SAG_U * 1.5 * u : 0;
      const cur = this.bridgeLoad.get(s.id) ?? 0;
      this.bridgeLoad.set(s.id, cur + (target - cur) * (1 - Math.exp(-dt * 10)));
    }

    // seeds
    const pl = this.player;
    const spots = this.seedSpots();
    for (const s of spots) {
      if (this.got.has(s.id)) continue;
      if (Math.hypot(s.x - pl.x, s.y - 3 * this.p - (pl.y - this.m.playerH / 2)) < SEED_PICKUP_U * u) {
        this.got.add(s.id);
        sfx(this.course ? "coin" : "seed");
        this.burst(s.x, s.y - 3 * this.p, ["#ffd84a", "#fff0a0", "#fff7e6"], 10, now);
      }
    }
    const goal = this.course?.goal;
    const atFlag = goal !== undefined && Math.hypot(pl.x - goal.x, pl.y - this.m.playerH / 2 - (goal.y - 4 * u)) < 6 * u;
    const allCoins = spots.every((s) => this.got.has(s.id));
    if (goal && atFlag && !allCoins && now - this.lockedSaidAt > 1500) {
      this.lockedSaidAt = now;
      this.say(`${spots.length - spots.filter((s) => this.got.has(s.id)).length} coins left!`, now);
    }
    if (goal && atFlag && allCoins && this.wonMs === null) {
      this.wonMs = now - (this.startedAt ?? now);
      this.burst(goal.x, goal.y - 10 * u, ["#ffd84a", "#fff7e6", "#4a74e8", "#ff86a8"], 24, now);
      sfx("win");
      this.opts.onWin?.(this.wonMs);
    }
    if (!this.course && spots.length > 0 && allCoins) {
      if (this.opts.mode === "challenge" && this.wonMs === null) {
        this.wonMs = now - (this.startedAt ?? now);
        this.opts.onWin?.(this.wonMs);
      } else if (this.opts.mode === "story" && this.bloomAt === null) {
        this.bloomAt = now;
        sfx("bloom");
      }
    }

    // particles (sparks fall, steam and smoke rise) and floating words
    for (const q of this.particles) {
      q.vy += (q.rise ? -40 : 120) * u * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    this.particles = this.particles.filter((q) => now - q.born < q.life);
    this.texts = this.texts.filter((t) => now - t.born < 900);
  }

  /** Crumbling ledges give way under you; beetles patrol, and bonk you unless you stomp them. */
  private updateCourseTwists(dt: number, now: number): void {
    if (!this.course) return;
    const { u, playerW, playerH } = this.m;
    const pl = this.player;
    const CRUMBLE_MS = 650;
    const REGROW_MS = 3200;
    for (const f of this.fillers) {
      if (!f.crumble) continue;
      const st = this.crumbles.get(f.id) ?? { touchedAt: null, goneUntil: 0 };
      if (st.touchedAt === null && pl.onGround && pl.standing?.id === f.id) st.touchedAt = now;
      if (st.touchedAt !== null && now - st.touchedAt > CRUMBLE_MS) {
        st.touchedAt = null;
        st.goneUntil = now + REGROW_MS;
        sfx("crumble");
        this.burst((f.x1 + f.x2) / 2, f.y, ["#8f5a32", "#6b4228", "#6ccf4a"], 10, now);
      }
      this.crumbles.set(f.id, st);
    }
    for (const b of this.bugs) {
      if (now < b.outUntil) continue;
      b.x += b.dir * 14 * u * dt;
      if (b.x < b.x1 || b.x > b.x2) {
        b.dir = b.dir > 0 ? -1 : 1;
        b.x = Math.max(b.x1, Math.min(b.x2, b.x));
      }
      const bw = 4 * u;
      const bh = 3 * u;
      const hit = pl.x + playerW / 2 > b.x - bw / 2 && pl.x - playerW / 2 < b.x + bw / 2 && pl.y > b.y - bh && pl.y - playerH < b.y;
      if (!hit) continue;
      if (pl.vy > 0 && pl.y < b.y - bh + 1.5 * u) {
        b.outUntil = now + 5000; // stomped!
        sfx("stomp");
        pl.vy = -JUMP_V * 0.8 * u;
        this.burst(b.x, b.y - bh, ["#b58cff", "#fff7e6", "#ffd84a"], 10, now);
        this.say("Stomp!", now);
      } else if (now >= pl.safeUntil) {
        this.respawn(now, "Bonk!");
        return;
      }
    }
  }

  /** If the player stands on something that moved (live camera), move with it. */
  private carry(): void {
    const pl = this.player;
    if (!pl.onGround || !pl.standing || pl.standing.id === "ground") return; // the ground never moves
    const id = pl.standing.id;
    const s = this.surfaces.find((x) => x.id === id);
    if (!s) {
      pl.standing = null;
      pl.onGround = false;
      return;
    }
    pl.x += s.x1 - pl.standing.x1;
    pl.y = surfaceY(s, Math.max(s.x1, Math.min(s.x2, pl.x)), this.bridgeLoad.get(s.id) ?? 0);
    pl.standing = { id, x1: s.x1 };
  }

  private held(...keys: string[]): boolean {
    return keys.some((k) => this.keys.has(k));
  }

  private say(text: string, now: number): void {
    this.texts.push({ text, x: this.player.x, y: this.player.y - this.m.playerH - 3 * this.m.u, born: now });
  }

  private burst(x: number, y: number, colors: readonly string[], n: number, now: number, rise = false): void {
    const { u } = this.m;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const speed = (15 + Math.random() * 25) * u;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: rise ? -Math.abs(Math.sin(a) * speed) : Math.sin(a) * speed,
        born: now,
        life: 450 + Math.random() * 350,
        color: colors[i % colors.length] ?? "#fff",
        rise,
      });
    }
  }

  private ignite(now: number): void {
    const pl = this.player;
    if (pl.fireUntil <= now) sfx("fire");
    if (pl.fireUntil <= now) this.say("Hot!", now);
    pl.fireUntil = now + FIRE_MS;
  }

  /** Back to the start: spikes, or burning for too long. */
  private respawn(now: number, word: string): void {
    sfx(word === "Splash!" ? "splash" : "hurt");
    this.burst(this.player.x, this.player.y - this.m.playerH / 2, ["#fff7e6", "#c9cde0", "#ff86a8"], 14, now);
    this.say(word, now);
    this.player = this.spawn();
    this.player.safeUntil = now + SAFE_MS;
    if (this.course) this.deaths++;
  }

  private step(dt: number, now: number): void {
    const { u, playerW, playerH, W, groundY } = this.m;
    const pl = this.player;
    const dir = (this.held("ArrowRight", "d") ? 1 : 0) - (this.held("ArrowLeft", "a") ? 1 : 0);
    const upKey = this.held("ArrowUp", "w");
    const downKey = this.held("ArrowDown", "s");
    const jumpHeld = this.held("ArrowUp", "w", " ", "Spacebar");
    const wantJump = now - this.jumpAt < JUMP_BUFFER_MS;
    if (dir !== 0) pl.facing = dir > 0 ? 1 : -1;

    // ---------- zones: water, lava, fire, spikes, updrafts, geysers ----------
    type Area = { x1: number; x2: number; y1: number; y2: number };
    const midY = pl.y - playerH / 2;
    const touching = (z: Area): boolean => overlaps(pl.x - playerW / 2, pl.x + playerW / 2, z.x1, z.x2) && pl.y > z.y1 && pl.y - playerH < z.y2;
    const inside = (z: Area): boolean => pl.x > z.x1 && pl.x < z.x2 && midY > z.y1 && midY < z.y2;
    let water: Area | null = null;
    let updraft = false;
    let geyser = false;
    let jello = false;
    for (const z of this.geo.zones) {
      switch (z.kind) {
        case "water":
          if (inside(z)) water = z;
          break;
        case "lava":
          // Challenge lava pits sit in the ground: standing at ground level over one is touching it
          if (this.course && touching(z) && pl.y >= z.y1) {
            this.burst(pl.x, z.y1, ["#ff8a2a", "#ffd84a", "#e8432e"], 12, now, true);
            this.respawn(now, "Too hot!"); // back to the start
            return;
          }
          if (touching(z) && pl.y > z.y1 + u) {
            this.ignite(now);
            pl.vy = -JUMP_V * 1.15 * u; // yelp! out of the lava
            pl.climbing = false;
            pl.hopping = false;
            this.burst(pl.x, z.y1, ["#ff8a2a", "#ffd84a", "#e8432e"], 8, now, true);
          }
          break;
        case "flame":
          if (touching(z)) this.ignite(now);
          break;
        case "spikes":
          if (touching(z) && now >= pl.safeUntil) {
            this.respawn(now, "Ouch!");
            return;
          }
          break;
        case "updraft":
          if (touching(z)) updraft = true;
          break;
        case "geyser":
          if (touching(z) && geyserTime(z, now) < GEYSER_ON_MS) geyser = true;
          break;
        case "jello":
          if (touching(z)) jello = true;
          break;
        case "river":
          if (touching(z) && pl.y > z.y1 && now >= pl.safeUntil) {
            this.burst(pl.x, z.y1, ["#a8e0ff", "#5cb2f4", "#fff7e6"], 12, now, true);
            this.respawn(now, "Splash!"); // missed the stepping stones
            return;
          }
          break;
      }
    }
    if (water && pl.fireUntil > 0) {
      pl.fireUntil = 0;
      this.burst(pl.x, water.y1, ["#fff7e6", "#d8ecff"], 10, now, true);
      this.say("Phew!", now);
    }
    if (pl.fireUntil > 0 && now > pl.fireUntil) {
      this.respawn(now, "Poof!");
      return;
    }
    const speed = MOVE_V * (pl.fireUntil > now ? FIRE_SPEED : 1) * (jello ? JELLO_SPEED : 1) * u;
    const standingOn = pl.onGround && pl.standing ? this.surfaces.find((s) => s.id === pl.standing!.id) : undefined;

    // ---------- climbing, swimming, or walking / jumping ----------
    const climb = this.geo.climbs.find(
      (c) => pl.x > c.x1 - 0.5 * u && pl.x < c.x2 + 0.5 * u && pl.y > c.y1 - 0.5 * u && pl.y - playerH < c.y2,
    );
    // Up grabs a vine / ladder / wall (unless you're already on top); Down on top climbs back down
    const atTop = climb !== undefined && pl.y <= climb.y1 + u;
    if (!pl.climbing && climb && ((upKey && !atTop) || (downKey && atTop))) {
      pl.climbing = true;
      pl.vx = 0;
      pl.vy = 0;
      pl.boost = 0;
    }
    if (pl.climbing && !climb) pl.climbing = false;

    let carryV = 0;
    if (pl.climbing && climb) {
      pl.vx = dir * speed * (climb.kind === "wall" ? 0.6 : 0.4);
      pl.vy = ((downKey ? 1 : 0) - (upKey ? 1 : 0)) * CLIMB_V * u;
      if (wantJump && !upKey) {
        pl.climbing = false;
        pl.vy = -JUMP_V * 0.85 * u;
        this.jumpAt = -Infinity;
      } else if (pl.y + pl.vy * dt <= climb.y1) {
        // reached the top: step off onto it
        pl.climbing = false;
        pl.y = climb.y1 - 0.01;
        pl.vy = 0;
      } else if (pl.y + pl.vy * dt >= climb.y2 && climb.y2 >= groundY - 1) {
        pl.climbing = false;
      }
    } else if (water) {
      pl.vx = dir * speed * 0.7;
      pl.vy = Math.min(MAX_SINK * u, pl.vy + WATER_GRAVITY * u * dt);
      if (wantJump) {
        // at the surface, jump right out; deeper down, swim a stroke up
        pl.vy = midY < water.y1 + 2 * u ? -JUMP_V * u : -SWIM_V * u;
        this.jumpAt = -Infinity;
      } else if (upKey) {
        pl.vy = Math.max(-SWIM_V * 0.6 * u, pl.vy - 200 * u * dt);
      }
    } else {
      const target = dir * speed;
      if (standingOn?.ice) pl.vx += (target - pl.vx) * (1 - Math.exp(-dt * (standingOn.noJump ? ICE_GRIP * 0.5 : ICE_GRIP)));
      else pl.vx = target;
      if (standingOn?.kind === "slide") {
        // whee: the slide takes over until you shoot off the end
        pl.vx = 0;
        pl.boost = Math.sign(standingOn.slope ?? 1) * SLIDE_V * u;
      }
      if (standingOn?.conveyor) carryV = standingOn.conveyor;

      pl.vy = Math.min(MAX_FALL * u, pl.vy + GRAVITY * u * dt);
      if (jello) pl.vy = Math.min(pl.vy, JELLO_MAX_FALL * u);
      // icy patches: your feet just slide, there's no grip to jump from
      if (wantJump && !standingOn?.noJump && (pl.onGround || now - pl.lastGroundAt < COYOTE_MS || jello)) {
        pl.vy = -JUMP_V * (jello ? JELLO_JUMP : 1) * u;
        sfx("jump");
        pl.hopping = true;
        pl.onGround = false;
        pl.lastGroundAt = -Infinity;
        this.jumpAt = -Infinity;
      }
      if (pl.vy >= 0) pl.hopping = false;
      if (pl.hopping && !jumpHeld) pl.vy += GRAVITY * u * dt * 1.5; // let go early for a short hop
      if (updraft) {
        pl.vy = Math.max(-UPDRAFT_MAX * u, pl.vy - (UPDRAFT_ACC + GRAVITY) * u * dt);
        pl.hopping = false;
      }
      if (geyser) {
        pl.vy = -GEYSER_V * u;
        pl.hopping = false;
      }
      if (downKey && pl.onGround && pl.standing && pl.standing.id !== "ground") pl.dropUntil = now + DROP_MS;
    }
    const sliding = standingOn?.kind === "slide";
    pl.boost *= Math.exp(-dt * (pl.onGround && !sliding ? 10 : 1.2));
    if (Math.abs(pl.boost) < u) pl.boost = 0;

    // ---------- move sideways; pool walls push back ----------
    const prevX = pl.x;
    pl.x = Math.max(playerW / 2, Math.min(W - playerW / 2, pl.x + (pl.vx + pl.boost + carryV) * dt));
    for (const w of this.geo.walls) {
      if (!overlaps(pl.x - playerW / 2, pl.x + playerW / 2, w.x1, w.x2)) continue;
      if (pl.y <= w.y1 + 0.3 * u || pl.y - playerH >= w.y2) continue; // on top of it, or below it
      pl.x = prevX <= (w.x1 + w.x2) / 2 ? w.x1 - playerW / 2 : w.x2 + playerW / 2;
    }

    // ---------- move up/down; land on one-way surfaces ----------
    const prevY = pl.y;
    pl.y += pl.vy * dt;
    const wasOn = pl.onGround ? pl.standing?.id : undefined;
    pl.onGround = false;
    if (pl.vy >= 0 && !pl.climbing) {
      let land: Surface | null = null;
      let landY = 0;
      for (const s of this.surfaces) {
        // slopes and bridges follow the player's middle; flat things catch any part of the feet
        const hit = curved(s) ? pl.x >= s.x1 && pl.x <= s.x2 : overlaps(pl.x - playerW / 2, pl.x + playerW / 2, s.x1, s.x2);
        if (!hit) continue;
        const sy = surfaceY(s, Math.max(s.x1, Math.min(s.x2, pl.x)), this.bridgeLoad.get(s.id) ?? 0);
        if (now < pl.dropUntil && s.kind !== "ground" && sy <= prevY + u) continue; // dropping through
        const ok = s.id === wasOn ? Math.abs(pl.y - sy) < 2.5 * u : prevY <= sy + 0.01 && pl.y >= sy;
        if (ok && (!land || sy < landY)) {
          land = s;
          landY = sy;
        }
      }
      if (land) {
        pl.y = landY;
        if (land.bounce) {
          pl.vy = -BOUNCE_V * land.bounce * (jumpHeld ? 1.08 : 1) * u;
          pl.hopping = false;
          this.bounceAt.set(land.owner ?? land.id, now);
          sfx("bounce");
          this.burst(pl.x, landY, ["#fff7e6", "#ff86a8", "#ffd84a"], 6, now);
        } else {
          pl.vy = 0;
          pl.onGround = true;
          pl.lastGroundAt = now;
          pl.standing = { id: land.id, x1: land.x1 };
        }
      }
    }
    if (pl.y >= groundY) {
      pl.y = groundY;
      pl.vy = Math.min(0, pl.vy);
      if (!pl.onGround) {
        pl.onGround = true;
        pl.lastGroundAt = now;
        pl.standing = { id: "ground", x1: 0 };
      }
    }
    if (pl.y - playerH < 0) {
      pl.y = playerH;
      pl.vy = Math.max(0, pl.vy);
    }
    if (!pl.onGround && !pl.climbing) pl.standing = null;
    pl.walk += Math.abs(pl.vx + pl.boost) * dt;
  }

  /* ---------- drawing ---------- */

  private squash(owner: string, now: number): number {
    const at = this.bounceAt.get(owner);
    const since = at === undefined ? Infinity : now - at;
    return since < SQUASH_MS ? Math.sin((since / SQUASH_MS) * Math.PI) : 0;
  }

  /**
   * Draw a desk object as its animated garden piece (pieces.ts) filling `rect`, in the object's
   * own colors, plus what stands around it: ladders, slides, updrafts, geyser spouts, flames.
   * `rect` is where its sprite would go; `obj.box` is the object's real (physics) box.
   */
  drawObjectArt(ctx: CanvasRenderingContext2D, obj: GameObject, rect: Rect, now = performance.now()): void {
    if (rect.w < 2 || rect.h < 2) return;
    const p = this.p;
    const b = obj.box;
    const T = tonesOf(obj.colors);
    const kind = this.kindOf(obj);
    const zone = (name: string): Rect | null => {
      const z = this.geo.zones.find((x) => x.id === `${obj.id}:${name}`);
      return z ? { x: z.x1, y: z.y1, w: z.x2 - z.x1, h: z.y2 - z.y1 } : null;
    };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    switch (kind) {
      case "pool": {
        const pool = poolLayout(b, this.m, obj.label);
        const s = pool.slide;
        const k = rect.h / Math.max(1, b.h);
        drawSlide(ctx, { id: "", kind: "slide", x1: s.x1, x2: s.x2, y: s.y1, slope: (s.y2 - s.y1) / Math.max(1, s.x2 - s.x1) }, p, this.m.groundY, now, { body: T.mid, shade: T.lo, highlight: T.hi });
        drawLadder(ctx, pool.ladder, p);
        drawPiece(ctx, kind, rect, p, now, T, { poolWall: pool.wall * k, poolWaterTop: rect.y + (pool.waterTop - b.y) * k });
        break;
      }
      case "bridge": {
        const deck: Surface = { id: `${obj.id}:top`, kind: "bridge", x1: b.x, x2: b.x + b.w, y: bridgeDeckY(b), sag: BRIDGE_SAG_U * this.m.u };
        const load = this.bridgeLoad.get(deck.id) ?? 0;
        drawPiece(ctx, kind, rect, p, now, T, { deckY: (x) => surfaceY(deck, x, load) });
        break;
      }
      case "updraft": {
        const z = zone("updraft");
        if (z) drawUpdraft(ctx, z, p, now); // warm air rising behind the lantern
        drawPiece(ctx, kind, rect, p, now, T);
        break;
      }
      case "geyser": {
        drawPiece(ctx, kind, rect, p, now, T);
        const z = this.geo.zones.find((x) => x.id === `${obj.id}:geyser`);
        if (z) drawGeyser(ctx, rect, { x: z.x1, y: z.y1, w: z.x2 - z.x1, h: z.y2 - z.y1 }, p, now, geyserTime(z, now), GEYSER_ON_MS, GEYSER_PERIOD_MS);
        break;
      }
      case "flame":
        drawPiece(ctx, kind, rect, p, now, T);
        drawBigFlame(ctx, rect.x + rect.w / 2, rect.y + p, p, now, Math.max(1, Math.min(2.4, rect.w / (5 * p))));
        break;
      default:
        drawPiece(ctx, kind, rect, p, now, T, { squash: this.squash(obj.id, now), dir: conveyorDir(obj.id) });
    }
    ctx.restore();
  }

  /**
   * The slabs of land floating objects rest on (see slabsUnder). Draw them BEFORE the objects,
   * so each object sits on top of its slab.
   */
  drawSlabs(ctx: CanvasRenderingContext2D, items: readonly { obj: GameObject; rect: Rect }[], now = performance.now()): void {
    const p = this.p;
    const u = this.m.u;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const { obj, rect } of items) {
      if (rect.w < 2) continue;
      // follow the drawn rect (it may be mid-animation), shaped like the physics slabs
      const k = rect.w / Math.max(1, obj.box.w);
      for (const sl of slabsUnder(obj.box, this.kindOf(obj), this.m)) {
        const x1 = rect.x + (sl.x1 - obj.box.x) * k;
        const x2 = rect.x + (sl.x2 - obj.box.x) * k;
        const y = rect.y + (sl.y - obj.box.y) * (rect.h / Math.max(1, obj.box.h));
        drawSlab(ctx, x1, x2, y, SLAB_THICK_U * u, p, now);
      }
    }
    ctx.restore();
  }

  /** Challenge: draw every desk object as its garden piece (floating ones on their slab of land). */
  drawObjects(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    const rectOf = (o: GameObject): Rect => ({ x: Math.round(o.box.x), y: Math.round(o.box.y), w: Math.round(o.box.w), h: Math.round(o.box.h) });
    this.drawSlabs(ctx, this.placed.map((o) => ({ obj: o, rect: rectOf(o) })), now);
    for (const o of this.placed) {
      const rect = { x: Math.round(o.box.x), y: Math.round(o.box.y), w: Math.round(o.box.w), h: Math.round(o.box.h) };
      this.drawObjectArt(ctx, o, rect, now);
    }
  }

  /** Ground, clouds, seeds, the player, effects and the HUD. */
  draw(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    const { W, H, groundY, playerH, u } = this.m;
    const p = this.p;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    drawGround(ctx, W, H, groundY, p);
    for (const f of this.fillers) {
      // a crumbled ledge leaves a faint outline where it will grow back
      if (f.crumble && now < (this.crumbles.get(f.id)?.goneUntil ?? 0)) drawLedgeGhost(ctx, f.x1, f.x2, f.y, p);
    }
    for (const c of [...this.cloudsNow, ...this.fillersNow]) {
      if (c.kind === "ledge") {
        const touched = c.crumble ? this.crumbles.get(c.id)?.touchedAt ?? null : null;
        const shake = touched !== null ? Math.round(Math.sin(now / 25) * 1) * p : 0;
        drawLedge(ctx, c.x1 + shake, c.x2 + shake, c.y, p, now, c.crumble ? "crumbling" : c.motion ? "moving" : "still");
      }
      else drawCloud(ctx, c, p, this.squash(c.id, now));
    }
    if (this.course) {
      for (const h of this.course.hazards) {
        if (h.kind === "lava") drawLavaPit(ctx, h.x1, h.x2, groundY, H, p, now);
        else drawGroundSpikes(ctx, h.x1, h.x2, groundY, p, now);
      }
      drawStartSign(ctx, this.course.start.x - 4 * u, this.course.start.y, p);
      for (const b of this.bugs) drawBeetle(ctx, b.x, b.y, p, now, b.dir, now < b.outUntil);
      drawGoalFlag(ctx, this.course.goal.x, this.course.goal.y, p, now);
    }
    for (const s of this.seedSpots()) {
      if (this.got.has(s.id)) continue;
      if (this.course) drawCoin(ctx, s.x, s.y, p, now);
      else drawSeed(ctx, s.x, s.y, p, now);
    }

    // the player (blinking right after a respawn, flames while on fire)
    const pl = this.player;
    const blink = now < pl.safeUntil && Math.floor(now / 100) % 2 === 0;
    if (!blink) {
      const moving = Math.abs(pl.vx + pl.boost) > 1 && pl.onGround;
      const frame = pl.climbing ? 1 + (Math.floor(pl.y / (2 * u)) % 2) : moving ? 1 + (Math.floor(pl.walk / (3 * u)) % 2) : 0;
      const bob = !moving && pl.onGround && Math.floor(now / 500) % 2 === 0 ? -1 : 0; // idle breathing
      const h = drawSprout(ctx, pl.x, pl.y, playerH * 1.1, frame, pl.facing, bob);
      if (pl.fireUntil > now) {
        drawBigFlame(ctx, pl.x, pl.y - h * 0.7, p, now, 1.1);
        if (Math.random() < 0.3) {
          this.particles.push({ x: pl.x, y: pl.y - h, vx: (Math.random() - 0.5) * 10 * u, vy: -20 * u, born: now, life: 500, color: "#ff8a2a", rise: true });
        }
      }
    }

    for (const q of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - (now - q.born) / q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), p, p);
    }
    ctx.globalAlpha = 1;

    this.drawHud(ctx, now);
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, now: number): void {
    const { W, H, u } = this.m;
    const size = Math.max(10, Math.round(u * 2.4));
    ctx.font = `${size}px "Press Start 2P", ui-monospace, monospace`;
    ctx.textBaseline = "top";

    const panel = (text: string, x: number, y: number, align: "left" | "right" | "center", bg: string): void => {
      const w = ctx.measureText(text).width + size * 1.6;
      const h = size * 2.2;
      const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
      ctx.fillStyle = "#2b1d3a";
      ctx.fillRect(Math.round(left - 3), Math.round(y - 3), Math.round(w + 6), Math.round(h + 6));
      ctx.fillStyle = bg;
      ctx.fillRect(Math.round(left), Math.round(y), Math.round(w), Math.round(h));
      ctx.fillStyle = "#2b1d3a";
      ctx.fillText(text, Math.round(left + size * 0.8), Math.round(y + size * 0.6));
    };

    // little words over the player's head ("Ouch!", "Hot!", "Phew!")
    ctx.textAlign = "center";
    for (const t of this.texts) {
      const f = (now - t.born) / 900;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = "#2b1d3a";
      ctx.fillText(t.text, Math.round(t.x + 2), Math.round(t.y - f * 4 * u + 2));
      ctx.fillStyle = "#fff7e6";
      ctx.fillText(t.text, Math.round(t.x), Math.round(t.y - f * 4 * u));
    }
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;

    if (this.player.fireUntil > now) panel("On fire! Find water!", W / 2, 3 * u, "center", "#ff8a2a");
    if (now - this.timeUpAt < 2500) {
      panel("Time's up! Back to the start", W / 2, H * 0.3, "center", "#ff86a8");
      return;
    }
    if (this.opts.mode === "challenge") {
      if (this.wonMs !== null) {
        const what = this.course ? "Course cleared" : "Garden grown";
        panel(`${what} in ${(this.wonMs / 1000).toFixed(1)}s! R to replay`, W / 2, H * 0.42, "center", "#a8e86c");
      } else if (this.startedAt === null) {
        panel(this.course ? "Grab every coin, then reach the flag!" : "Arrows / WASD to move, Space to jump", W / 2, H * 0.42, "center", "#ffb870");
      }
    } else if (this.bloomAt !== null) {
      panel("The garden blooms!", W / 2, H * 0.42, "center", "#ff86a8");
    }
  }
}
