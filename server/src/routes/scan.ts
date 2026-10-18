import { Router } from "express";
import { z } from "zod";
import type { ApiError } from "@deskcapade/shared";
import { PerceptronError } from "../services/perceptron.js";
import { runScan } from "../services/scan.js";

export const scanRouter = Router();

const bodySchema = z.object({
  image: z.string().startsWith("data:image/"),
  width: z.number().positive(),
  height: z.number().positive(),
});

scanRouter.post("/", async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiError = { ok: false, error: "Invalid scan request", code: "BAD_REQUEST" };
    res.status(400).json(body);
    return;
  }

  try {
    const { image, width, height } = parsed.data;
    res.json(await runScan(image, width, height));
  } catch (err) {
    if (err instanceof PerceptronError) {
      const body: ApiError = {
        ok: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      };
      res.status(err.status).json(body);
      return;
    }
    console.error("[scan] unexpected error", err);
    const body: ApiError = { ok: false, error: "Scan failed", code: "INTERNAL" };
    res.status(500).json(body);
  }
});