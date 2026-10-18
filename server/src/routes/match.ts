import { Router } from "express";
import { z } from "zod";
import type { ApiError } from "@deskcapade/shared";
import { askGeminiJSON, GeminiError } from "../services/gemini.js";

/* ------------------------------------------------------------------
   POST /api/match: desk objects that aren't on the game's list (a stapler, a tape dispenser...)
   get matched to the listed object they're most like, so they take that object's shape.
   The client sends its list ({ name, kind }), so the server never has its own copy.
   ------------------------------------------------------------------ */

const bodySchema = z.object({
  labels: z.array(z.string().max(200)).min(1).max(20),
  options: z.array(z.object({ name: z.string(), kind: z.string() })).min(1).max(40),
});

const SYSTEM = `You help a pixel-art platformer built from photos of real desks. Each kind of desk object turns
into a game piece. For each detected object that isn't on the list, pick the listed object it is MOST
like, by shape and how it sits on a desk (tall and round like a can? flat and long like a pencil? a
small block like an eraser? a container like a cup?). Always pick one of the listed names exactly.`;

export const matchRouter = Router();

matchRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiError = { ok: false, error: "Invalid match request", code: "BAD_REQUEST" };
    res.status(400).json(body);
    return;
  }
  const { labels, options } = parsed.data;
  const names = options.map((o) => o.name);
  const schema = {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, like: { type: "string", enum: names } },
          required: ["label", "like"],
        },
      },
    },
    required: ["matches"],
  };
  try {
    const { data } = await askGeminiJSON<{ matches: { label: string; like: string }[] }>(
      SYSTEM,
      [{ text: `The list: ${names.join("; ")}.\nThe detected objects:\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}` }],
      schema,
    );
    const kindOf = new Map(options.map((o) => [o.name, o.kind]));
    const kinds: Record<string, string> = {};
    for (const m of data.matches ?? []) {
      const kind = kindOf.get(m.like);
      if (kind && labels.includes(m.label)) kinds[m.label] = kind;
    }
    res.json({ ok: true, kinds });
  } catch (err) {
    const e = err instanceof GeminiError ? err : new GeminiError("Matching failed", 500, "INTERNAL");
    console.error(`[match] ${e.status} ${e.code}: ${e.message}`);
    const body: ApiError = { ok: false, error: e.message, code: e.code };
    res.status(e.status).json(body);
  }
});
