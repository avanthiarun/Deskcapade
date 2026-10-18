import {
  artPixel,
  drawBranch,
  drawCloud,
  drawGrassTop,
  drawGround,
  drawMushroom,
  drawPad,
  drawPool,
  drawSeed,
  drawSprout,
  drawVine,
  type Rect,
} from "./art";
import {
  makeBranches,
  metrics,
  objectGeometry,
  planFillers,
  poolLayout,
  vinePadHalf,
  type Climb,
  type GameObject,
  type Metrics,
  type PlacedObject,
  type SeedSpot,
  type Surface,
  type Wall,
} from "./level";
import { objectKind } from "./materials";

/* ------------------------------------------------------------------
   The garden platformer. You're a little garden sprite; the desk objects are your world
   (see materials.ts for what turns into what). Collect the golden seeds on the tree
   branches at the top.

   Story mode: the level is live. Call setObjects() every frame with what the camera sees;
     objects move, appear and vanish, and the level designer re-plans stepping stones.
     Collecting every seed makes the garden bloom, then new branches grow.
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
const COYOTE_MS = 90;
const JUMP_BUFFER_MS = 120;
const DROP_MS = 250;
const STEP_S = 1 / 120;
const REPLAN_MS = 600;
const BLOOM_MS = 2600;
const SQUASH_MS = 220;
const SEED_PICKUP_U = 4;

const PHYSICS = { gravity: GRAVITY, jumpV: JUMP_V, moveV: MOVE_V, bounceV: BOUNCE_V };

type Player = {
  x: number;
  /** Feet. */
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  climbing: boolean;
  /** Rising from a jump (not a bounce), so letting go of jump early cuts it short. */
  hopping: boolean;
  facing: 1 | -1;
  /** The surface under the player, as it was last frame (so moving objects carry the player). */
  standing: { id: string; x1: number; y: number } | null;
  lastGroundAt: number;
  dropUntil: number;
  walk: number;
};

export type PlatformerOptions = {
  mode: "story" | "challenge";
  /** Picks the random branch layout. */
  seed?: number;
  /** Challenge: every seed collected, in `ms` since the first move. */
  onWin?: (ms: number) => void;
};

const JUMP_KEYS = new Set(["ArrowUp", "w", "W", " ", "Spacebar"]);
const GAME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "A", "d", "D", "w", "W", "s", "S", " ", "Spacebar"]);

const overlaps = (ax1: number, ax2: number, bx1: number, bx2: number): boolean => ax2 > bx1 && ax1 < bx2;

export class Platformer {
  private m: Metrics = metrics(1280, 720, PHYSICS);
  private p = artPixel(this.m.u);
  private placed: PlacedObject[] = [];
  private surfaces: Surface[] = [];
  private climbs: Climb[] = [];
  private walls: Wall[] = [];
  private branches: Surface[] = [];
  private fillers: Surface[] = [];
  private seeds: (SeedSpot & { got: boolean })[] = [];
  private branchSeed: number;
  private planKey = "";
  private plannedAt = -Infinity;
  private player: Player = this.spawn();
  private keys = new Set<string>();
  private jumpAt = -Infinity;
  private lastNow = 0;
  private startedAt: number | null = null;
  private wonMs: number | null = null;
  private bloomAt: number | null = null;
  private bounceAt = new Map<string, number>();

  constructor(private readonly opts: PlatformerOptions) {
    this.branchSeed = opts.seed ?? 1;
    this.growBranches();
  }

  /* ---------- setup ---------- */

  /** Match the canvas size (cheap when unchanged). */
  setSize(W: number, H: number): void {
    if (W === this.m.W && H === this.m.H) return;
    this.m = metrics(W, H, PHYSICS);
    this.p = artPixel(this.m.u);
    this.growBranches();
    this.player = this.spawn();
  }

  /** The desk objects, in canvas pixels. Story calls this every frame; Challenge once. */
  setObjects(objects: readonly GameObject[], now = performance.now()): void {
    this.placed = objects.map((o) => {
      let kind = objectKind(o.templateId, o.box);
      if (kind === "pool" && !poolLayout(o.box, this.m)) kind = "platform";
      return { ...o, kind };
    });
    const geo = objectGeometry(this.placed, this.m);

    // re-plan the stepping stones when the desk changes enough to matter
    const q = 4 * this.m.u;
    const key = this.placed
      .map((o) => `${o.id}:${o.kind}:${Math.round(o.box.x / q)},${Math.round(o.box.y / q)},${Math.round(o.box.w / q)},${Math.round(o.box.h / q)}`)
      .sort()
      .join("|");
    if (key !== this.planKey && now - this.plannedAt >= REPLAN_MS) {
      this.planKey = key;
      this.plannedAt = now;
      this.fillers = planFillers(this.m, this.placed, geo, this.branches);
    }

    const ground: Surface = { id: "ground", kind: "ground", x1: 0, x2: this.m.W, y: this.m.groundY };
    this.surfaces = [ground, ...geo.surfaces, ...this.branches, ...this.fillers];
    this.climbs = geo.climbs;
    this.walls = geo.walls;
  }

  /** Back to the start (Challenge's restart). */
  restart(): void {
    this.player = this.spawn();
    for (const s of this.seeds) s.got = false;
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

  private spawn(): Player {
    return {
      x: 6 * this.m.u,
      y: this.m.groundY,
      vx: 0,
      vy: 0,
      onGround: true,
      climbing: false,
      hopping: false,
      facing: 1,
      standing: null,
      lastGroundAt: 0,
      dropUntil: 0,
      walk: 0,
    };
  }

  private growBranches(): void {
    const { branches, seeds } = makeBranches(this.m, this.branchSeed);
    this.branches = branches;
    this.seeds = seeds.map((s) => ({ ...s, got: false }));
    this.fillers = [];
    this.planKey = "";
    this.plannedAt = -Infinity;
  }

  /* ---------- simulation ---------- */

  update(now = performance.now()): void {
    const dt = this.lastNow ? Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;

    // story: after the bloom, new branches (and seeds) grow
    if (this.bloomAt !== null && now - this.bloomAt > BLOOM_MS) {
      this.bloomAt = null;
      this.branchSeed += 1;
      this.growBranches();
    }

    this.carry();
    for (let left = dt; left > 1e-6; left -= STEP_S) this.step(Math.min(STEP_S, left), now);

    // seeds
    const { u, playerH } = this.m;
    const pl = this.player;
    for (const s of this.seeds) {
      if (s.got) continue;
      if (Math.hypot(s.x - pl.x, s.y - 3 * this.p - (pl.y - playerH / 2)) < SEED_PICKUP_U * u) s.got = true;
    }
    if (this.seeds.length > 0 && this.seeds.every((s) => s.got)) {
      if (this.opts.mode === "challenge" && this.wonMs === null) {
        this.wonMs = now - (this.startedAt ?? now);
        this.opts.onWin?.(this.wonMs);
      } else if (this.opts.mode === "story" && this.bloomAt === null) {
        this.bloomAt = now;
      }
    }
  }

  /** If the player stands on something that moved (live camera), move with it. */
  private carry(): void {
    const pl = this.player;
    if (!pl.onGround || !pl.standing) return;
    const s = this.surfaces.find((x) => x.id === pl.standing!.id);
    if (!s) {
      pl.standing = null;
      pl.onGround = false;
      return;
    }
    pl.x += s.x1 - pl.standing.x1;
    pl.y = s.y;
    pl.standing = { id: s.id, x1: s.x1, y: s.y };
  }

  private held(...keys: string[]): boolean {
    return keys.some((k) => this.keys.has(k));
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

    const midY = pl.y - playerH / 2;
    const climb = this.climbs.find(
      (c) => c.kind !== "water" && pl.x > c.x1 - 0.5 * u && pl.x < c.x2 + 0.5 * u && pl.y > c.y1 - 0.5 * u && pl.y - playerH < c.y2,
    );
    const water = this.climbs.find((c) => c.kind === "water" && pl.x > c.x1 && pl.x < c.x2 && midY > c.y1 && midY < c.y2);

    // Up grabs a vine / ladder (unless you're already on top of it); Down on top climbs back down
    const atTop = climb !== undefined && pl.y <= climb.y1 + u;
    if (!pl.climbing && climb && ((upKey && !atTop) || (downKey && atTop))) {
      pl.climbing = true;
      pl.vx = 0;
      pl.vy = 0;
    }
    if (pl.climbing && !climb) pl.climbing = false;

    if (pl.climbing && climb) {
      pl.vx = dir * MOVE_V * 0.4 * u;
      pl.vy = ((downKey ? 1 : 0) - (upKey ? 1 : 0)) * CLIMB_V * u;
      if (wantJump && !upKey) {
        pl.climbing = false;
        pl.vy = -JUMP_V * 0.85 * u;
        this.jumpAt = -Infinity;
      } else if (pl.y + pl.vy * dt <= climb.y1) {
        // reached the top: step off onto the leaf pad / rim
        pl.climbing = false;
        pl.y = climb.y1 - 0.01;
        pl.vy = 0;
      } else if (pl.y + pl.vy * dt >= climb.y2 && climb.y2 >= groundY - 1) {
        pl.climbing = false;
      }
    } else if (water) {
      pl.vx = dir * MOVE_V * 0.7 * u;
      pl.vy = Math.min(MAX_SINK * u, pl.vy + WATER_GRAVITY * u * dt);
      if (wantJump) {
        // at the surface, jump right out; deeper down, swim a stroke up
        pl.vy = midY < water.y1 + 2 * u ? -JUMP_V * u : -SWIM_V * u;
        this.jumpAt = -Infinity;
      } else if (upKey) {
        pl.vy = Math.max(-SWIM_V * 0.6 * u, pl.vy - 200 * u * dt);
      }
    } else {
      pl.vx = dir * MOVE_V * u;
      pl.vy = Math.min(MAX_FALL * u, pl.vy + GRAVITY * u * dt);
      if (wantJump && (pl.onGround || now - pl.lastGroundAt < COYOTE_MS)) {
        pl.vy = -JUMP_V * u;
        pl.hopping = true;
        pl.onGround = false;
        pl.lastGroundAt = -Infinity;
        this.jumpAt = -Infinity;
      }
      if (pl.vy >= 0) pl.hopping = false;
      if (pl.hopping && !jumpHeld) pl.vy += GRAVITY * u * dt * 1.5; // let go early for a short hop
      if (downKey && pl.onGround && pl.standing && pl.standing.id !== "ground") pl.dropUntil = now + DROP_MS;
    }

    // move sideways, then pool walls push back
    const prevX = pl.x;
    pl.x = Math.max(playerW / 2, Math.min(W - playerW / 2, pl.x + pl.vx * dt));
    for (const w of this.walls) {
      if (!overlaps(pl.x - playerW / 2, pl.x + playerW / 2, w.x1, w.x2)) continue;
      if (pl.y <= w.y1 + 0.3 * u || pl.y - playerH >= w.y2) continue; // on top of it, or below it
      pl.x = prevX <= (w.x1 + w.x2) / 2 ? w.x1 - playerW / 2 : w.x2 + playerW / 2;
    }

    // move up/down; land on one-way surfaces
    const prevY = pl.y;
    pl.y += pl.vy * dt;
    pl.onGround = false;
    if (pl.vy >= 0 && !pl.climbing) {
      let land: Surface | null = null;
      for (const s of this.surfaces) {
        if (!overlaps(pl.x - playerW / 2, pl.x + playerW / 2, s.x1, s.x2)) continue;
        if (prevY > s.y + 0.01 || pl.y < s.y) continue;
        if (now < pl.dropUntil && s.kind !== "ground" && s.y <= prevY + u) continue; // dropping through
        if (!land || s.y < land.y) land = s;
      }
      if (land) {
        pl.y = land.y;
        if (land.bounce) {
          pl.vy = -BOUNCE_V * (jumpHeld ? 1.08 : 1) * u;
          this.bounceAt.set(land.id.split(":")[0] ?? land.id, now);
        } else {
          pl.vy = 0;
          pl.onGround = true;
          pl.lastGroundAt = now;
          pl.standing = { id: land.id, x1: land.x1, y: land.y };
        }
      }
    }
    if (pl.y >= groundY) {
      pl.y = groundY;
      pl.vy = Math.min(0, pl.vy);
      if (!pl.onGround) {
        pl.onGround = true;
        pl.lastGroundAt = now;
        pl.standing = { id: "ground", x1: 0, y: groundY };
      }
    }
    if (pl.y - playerH < 0) {
      pl.y = playerH;
      pl.vy = Math.max(0, pl.vy);
    }
    if (!pl.onGround && !pl.climbing) pl.standing = null;
    pl.walk += Math.abs(pl.vx) * dt;
  }

  /* ---------- drawing ---------- */

  /**
   * Draw `obj` as its garden piece (vine / pool / mushroom) filling `rect`.
   * Returns false for plain platforms (draw the normal sprite; draw() adds grass on top).
   */
  drawObjectArt(ctx: CanvasRenderingContext2D, obj: GameObject, rect: Rect, now = performance.now()): boolean {
    if (rect.w < 2 || rect.h < 2) return true;
    const kind = objectKind(obj.templateId, obj.box);
    const p = this.p;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    try {
      switch (kind) {
        case "vine": {
          const k = rect.w / Math.max(1, obj.box.w);
          drawVine(ctx, rect, p, vinePadHalf(obj.box, this.m) * k, now);
          return true;
        }
        case "pool": {
          const pool = poolLayout(obj.box, this.m);
          if (!pool) return false;
          drawPool(ctx, rect, pool, obj.box, p, now);
          return true;
        }
        case "mushroom": {
          const at = this.bounceAt.get(obj.id);
          const since = at === undefined ? Infinity : now - at;
          const squash = since < SQUASH_MS ? Math.sin((since / SQUASH_MS) * Math.PI) : 0;
          drawMushroom(ctx, rect, p, squash);
          return true;
        }
        default:
          return false;
      }
    } finally {
      ctx.restore();
    }
  }

  /** Challenge: draw every desk object (garden piece, or its sprite for plain platforms). */
  drawObjects(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const o of this.placed) {
      const rect = { x: Math.round(o.box.x), y: Math.round(o.box.y), w: Math.round(o.box.w), h: Math.round(o.box.h) };
      if (this.drawObjectArt(ctx, o, rect, now) || !o.sprite) continue;
      ctx.drawImage(o.sprite, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
  }

  /** Ground, branches, stepping stones, grass on platforms, seeds, the player and the HUD. */
  draw(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    const { W, H, groundY, playerH, u } = this.m;
    const p = this.p;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    drawGround(ctx, W, H, groundY, p);
    for (const o of this.placed) {
      if (o.kind === "platform") drawGrassTop(ctx, o.box.x, o.box.x + o.box.w, o.box.y, p);
    }
    for (const s of [...this.fillers, ...this.branches]) {
      if (s.kind === "branch") drawBranch(ctx, s, p, H);
      else if (s.kind === "cloud") drawCloud(ctx, s, p);
      else if (s.kind === "pad") drawPad(ctx, s, p);
    }
    for (const s of this.seeds) if (!s.got) drawSeed(ctx, s.x, s.y, p, now);

    const pl = this.player;
    const moving = Math.abs(pl.vx) > 1 && pl.onGround;
    const frame = moving ? 1 + (Math.floor(pl.walk / (3 * u)) % 2) : 0;
    const bob = !moving && pl.onGround && Math.floor(now / 500) % 2 === 0 ? -1 : 0; // idle breathing
    drawSprout(ctx, pl.x, pl.y, playerH * 1.1, pl.climbing ? 1 + (Math.floor(pl.y / (2 * u)) % 2) : frame, pl.facing, bob);

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

    const got = this.seeds.filter((s) => s.got).length;
    panel(`Seeds ${got}/${this.seeds.length}`, 2 * u, 2 * u, "left", "#fff7e6");

    if (this.opts.mode === "challenge") {
      const ms = this.wonMs ?? (this.startedAt === null ? 0 : now - this.startedAt);
      panel(`${(ms / 1000).toFixed(1)}s`, W - 2 * u, 2 * u, "right", "#fff7e6");
      if (this.wonMs !== null) panel(`Garden grown in ${(this.wonMs / 1000).toFixed(1)}s! R to replay`, W / 2, H * 0.42, "center", "#a8e86c");
      else if (this.startedAt === null) panel("Arrows / WASD to move, Space to jump", W / 2, H * 0.42, "center", "#ffb870");
    } else if (this.bloomAt !== null) {
      panel("The garden blooms!", W / 2, H * 0.42, "center", "#ff86a8");
    }
  }
}
