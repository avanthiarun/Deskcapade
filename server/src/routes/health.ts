import { Router } from "express";
import { config } from "../config.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ ok: true, mock: config.mock, scanMaxWidth: config.scanMaxWidth });
});
