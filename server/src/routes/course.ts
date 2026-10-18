import { Router } from "express";
import { z } from "zod";
import type { ApiError, CourseResponse } from "@deskcapade/shared";
import { designCourse } from "../services/course.js";
import { GeminiError } from "../services/gemini.js";

const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const bodySchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard", "boss"]),
  width: z.number().positive(),
  height: z.number().positive(),
  image: z.string().optional(),
  objects: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string(), box: boxSchema })).max(40),
  physics: z.object({
    groundY: z.number(),
    jumpHeight: z.number(),
    jumpReach: z.number(),
    playerWidth: z.number(),
    playerHeight: z.number(),
  }),
});

export const courseRouter = Router();

/** POST /api/course: plan a Challenge obstacle course for a desk photo (see services/course.ts). */
courseRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiError = { ok: false, error: "Invalid course request", code: "BAD_REQUEST" };
    res.status(400).json(body);
    return;
  }
  try {
    const { design, model } = await designCourse(parsed.data);
    const body: CourseResponse = { ok: true, design, model };
    res.json(body);
  } catch (err) {
    const e = err instanceof GeminiError ? err : new GeminiError("Course design failed", 500, "INTERNAL");
    console.error(`[course] ${e.status} ${e.code}: ${e.message}`);
    const body: ApiError = { ok: false, error: e.message, code: e.code };
    res.status(e.status).json(body);
  }
});
