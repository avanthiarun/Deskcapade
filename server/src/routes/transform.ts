import { Router } from "express";
import type { ApiError, TransformResponse } from "@deskcapade/shared";
import { config } from "../config.js";
import { TransformError, decideTransform } from "../services/transform.js";

export const transformRouter = Router();

transformRouter.post("/", async (req, res) => {
  const body = (req.body ?? {}) as { label?: unknown; shape?: unknown };
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const shape = body.shape === "tall" || body.shape === "wide" ? body.shape : "square";

  if (!label) {
    const e: ApiError = { ok: false, error: "label is required", code: "BAD_REQUEST" };
    res.status(400).json(e);
    return;
  }
  if (!config.geminiApiKey) {
    const e: ApiError = { ok: false, error: "AI designer not configured", code: "NO_AI" };
    res.status(503).json(e);
    return;
  }
  try {
    const spec = await decideTransform(label, shape);
    const out: TransformResponse = { ok: true, spec };
    res.json(out);
  } catch (err) {
    const known = err instanceof TransformError;
    const e: ApiError = {
      ok: false,
      error: known ? err.message : "Designer failed",
      code: known ? err.code : "INTERNAL",
    };
    res.status(known ? err.status : 500).json(e);
  }
});