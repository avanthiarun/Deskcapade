import { Router } from "express";
import { z } from "zod";
import type { ApiError, CharacterResponse } from "@deskcapade/shared";
import { askGeminiJSON, GeminiError, type GeminiPart } from "../services/gemini.js";

/* ------------------------------------------------------------------
   POST /api/character: turn a photographed object (a stuffed pig, a toy frog...) into a
   playable pixel character. Perceptron already said what it is (`label`); Gemini draws it on
   the game's 16-wide character grid, in the same cute style as the built-in characters.
   The client validates the drawing and has its own fallback.
   ------------------------------------------------------------------ */

const bodySchema = z.object({
  label: z.string().min(1).max(200),
  image: z.string().startsWith("data:image/").optional(),
});

/** The Sprout, as the style example (6 head rows, then the shared round body with its face). */
const EXAMPLE = [
  "..ooo......ooo..",
  ".oLLlo....olLLo.",
  ".oLlllo..olllLo.",
  "..oLlllooollLo..",
  "...ooollsllooo..",
  "......osso......",
  "....oooooooo....",
  "...obbbbbbhho...",
  "..obbbbbbbbhho..",
  ".obbbbbbbbbbbho.",
  ".obbwwbbbbwwbbo.",
  ".obbwkbbbbwkbbo.",
  ".obpkkbbbbkkpbo.",
  ".obbbbbmmbbbbbo.",
  ".odbbbbbbbbbbdo.",
  "..odbbbbbbbbdo..",
  "...oddddddddoo..",
  "....oooooooo....",
];

const SYSTEM = `You draw tiny, cute pixel-art player characters for a cozy platformer. Every character is
exactly 18 rows of exactly 16 characters, one letter per pixel:
  .  transparent      o  dark outline
  b  main body color  h  highlight (lighter)  d  shade (darker)
  w  eye white        k  eye pupil / dark detail     p  blush (pink)     m  mouth
  a, c, e, n  up to four extra colors of your choosing (ears, snout, spots, belly, beak...)
Here is the Sprout character, which shows the style:
${EXAMPLE.join("\n")}
Rows 0-5 are the head decoration (ears, leaves, horns, antennae, a cap...). Rows 6-17 are a round,
outlined, chubby body with a cute face (big eyes with a white shine, small mouth, blush). Keep that
chubby round body and cute face, and make the character clearly read as the given object: a pig gets
pink color, pointy ears and a snout; a frog gets green with eyes on top; a teddy bear gets round ears
and a muzzle. Use the photo for its real colors. Keep every row exactly 16 characters, and keep the
dark "o" outline all the way around. Give the character a short cute name.`;

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    rows: { type: "array", items: { type: "string" } },
    colors: {
      type: "object",
      properties: Object.fromEntries(["b", "h", "d", "a", "c", "e", "n"].map((k) => [k, { type: "string", description: "hex color like #ff86a8" }])),
      required: ["b", "h", "d"],
    },
  },
  required: ["name", "rows", "colors"],
};

export const characterRouter = Router();

characterRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiError = { ok: false, error: "Invalid character request", code: "BAD_REQUEST" };
    res.status(400).json(body);
    return;
  }
  const { label, image } = parsed.data;
  const parts: GeminiPart[] = [];
  const img = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image ?? "");
  if (img) parts.push({ inlineData: { mimeType: img[1]!, data: img[2]! } });
  parts.push({ text: `Make a character from this: ${label}${img ? " (photo above)" : ""}.` });
  try {
    const { data } = await askGeminiJSON<{ name: string; rows: string[]; colors: Record<string, string> }>(SYSTEM, parts, SCHEMA);
    const body: CharacterResponse = { ok: true, name: String(data.name ?? "").slice(0, 20), rows: data.rows ?? [], colors: data.colors ?? {} };
    res.json(body);
  } catch (err) {
    const e = err instanceof GeminiError ? err : new GeminiError("Character drawing failed", 500, "INTERNAL");
    console.error(`[character] ${e.status} ${e.code}: ${e.message}`);
    const body: ApiError = { ok: false, error: e.message, code: e.code };
    res.status(e.status).json(body);
  }
});
