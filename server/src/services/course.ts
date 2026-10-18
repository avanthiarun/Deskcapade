import type { CourseDesign, CourseRequest } from "@deskcapade/shared";
import { askGeminiJSON, type GeminiPart } from "./gemini.js";

/* ------------------------------------------------------------------
   The Challenge course designer: Gemini (free tier) looks at the desk photo and the detected
   objects and plans an obstacle course (start, goal, extra ledges, hazards, coins, beetles and a
   time limit) for the chosen difficulty. The game validates the plan and fills any gaps, so it
   only has to be good, not perfect, and the game has its own designer when this one is unavailable.
   ------------------------------------------------------------------ */

const SYSTEM = `You design levels for Deskcapade, a cozy pixel-art platformer built from a photo of a real desk.
Each detected desk object has become a garden-castle piece at its real size and position, and those
pieces can never be moved, resized or covered. You plan an obstacle course around them.

How the pieces play:
- platform (island), woodbridge, stonepath, conveyor, ice: stand on the top edge (conveyor carries you, ice is slippery)
- vine (tower with a vine), rockwall (rock wall with a ladder): climb from bottom to top
- pool: swim inside; a ladder on one side, a water slide on the other
- mushroom, plush, trampoline: bounce on the top (trampoline highest)
- updraft (lantern): warm air above it floats you up; geyser (fountain): erupts every few seconds, launching you up
- jello: a wobbly blob you can wade through, but slowly (no top to stand on)
- rail: a thin line platform to stand on
- river: water with stepping stones across it; falling in the water sends the player back to the start
- icepatch: a slippery patch; you slide across it and can't jump while on it
- spikes, flame: hurt
All surfaces are one-way: you can jump up through them from below and land on top.

The player is a small garden sprite that walks and jumps. Coordinates are canvas pixels, origin top-left,
y grows downward. The ground runs along y = groundY across the whole width. A jump rises at most
jumpHeight pixels and crosses at most jumpReach pixels sideways.

Plan:
- start: where the player begins; on the ground or on top of an object (y = that surface's top).
- goal: the flag at the end; on top of an object or a ledge, ideally high up and across the desk from
  the start, so the route uses the desk objects. Every arrangement should feel like its own course.
- ledges: extra floating ledges (x = left edge, y = top, w = width, 40-200 px wide) that link the
  objects into a route. Never overlap an object's box; leave head room above each ledge.
- hazards: spikes or lava pits on the ground (x = left edge, w = width), each narrow enough to jump
  over (w at most half of jumpReach). Touching one sends the player back to the start.
- coins: gold coins the player must ALL collect before the flag counts and the timer stops. Put each
  where it can be reached (above a surface, within a jump), spread along and around the route.
- ledge style: "still", "moving" (slides gently back and forth) or "crumbling" (gives way a moment
  after you land, then grows back).
- critters: beetles that patrol a surface near each point you give (on the ground or an object top).
  Touching one sends the player back to the start; jumping on top knocks it out.

Difficulty (follow these exactly; the game enforces them):
- easy: NO hazards. Add plenty of helper ledges, close together (about half a jump apart), so the
  route is gentle. Short route. 3 coins in easy spots.
- medium: one set of spikes (1-3 spike strips, no lava). Ledges about two thirds of a jump apart,
  some of them "moving". 1 beetle. The route visits a few objects. 5 coins.
- hard: spikes AND lava (3-5 hazards). Add NO helper ledges: the route must use the desk objects
  themselves (the game only adds a ledge if the flag would otherwise be impossible; make those
  "crumbling" or "moving"). 2 beetles. 6 coins, some near hazards.
- boss: the toughest course the desk allows: 6-8 hazards mixing spikes and lava, NO helper ledges,
  any ledge "moving" or "crumbling", 4 beetles, the flag at the highest reachable point, and 8 coins
  in daring spots (above hazards, high up).
Be creative with the route for each level: make the player use climbing, bouncing, swimming and
timing, not just more of the same obstacle.

Time limit (timeLimitSec): estimate how many seconds a decent player needs to grab every coin and
reach the flag on THIS course, counting the climbing, the waiting for moving ledges and a couple of
mistakes, then be generous: never make it tight. Harder levels have longer routes but the player is
expected to be quicker, so each level gets its own time. Typical range: 60-240 seconds.

Assess the desk first: which objects are high, which are bouncy or climbable, where the gaps are.
Then build the best-fitting course for the level. Also give it a short whimsical title and a
one-sentence intro.`;

const point = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    intro: { type: "string" },
    start: point,
    goal: point,
    ledges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          style: { type: "string", enum: ["still", "moving", "crumbling"] },
        },
        required: ["x", "y", "w", "style"],
      },
    },
    hazards: {
      type: "array",
      items: {
        type: "object",
        properties: { kind: { type: "string", enum: ["spikes", "lava"] }, x: { type: "number" }, w: { type: "number" } },
        required: ["kind", "x", "w"],
      },
    },
    coins: { type: "array", items: point },
    critters: { type: "array", items: point },
    timeLimitSec: { type: "number" },
  },
  required: ["title", "intro", "start", "goal", "ledges", "hazards", "coins", "critters", "timeLimitSec"],
} as const;

export async function designCourse(req: CourseRequest): Promise<{ design: CourseDesign; model: string }> {
  const level = {
    difficulty: req.difficulty,
    canvas: { width: Math.round(req.width), height: Math.round(req.height) },
    physics: Object.fromEntries(Object.entries(req.physics).map(([k, v]) => [k, Math.round(v)])),
    objects: req.objects.map((o) => ({
      id: o.id,
      label: o.label.slice(0, 80),
      kind: o.kind,
      box: { x: Math.round(o.box.x), y: Math.round(o.box.y), w: Math.round(o.box.w), h: Math.round(o.box.h) },
    })),
  };

  const parts: GeminiPart[] = [];
  const image = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(req.image ?? "");
  if (image) parts.push({ inlineData: { mimeType: image[1]!, data: image[2]! } });
  parts.push({
    text: `Here is the desk${image ? " (photo above, scaled to the canvas)" : ""} and the level so far:\n${JSON.stringify(level)}\n\nDesign the ${req.difficulty} course.`,
  });

  const { data, model } = await askGeminiJSON<CourseDesign>(SYSTEM, parts, SCHEMA);
  return { design: data, model };
}
