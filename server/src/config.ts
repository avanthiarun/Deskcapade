import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(rootDir, ".env") });

const PLACEHOLDER_KEY = "your-api-key-here";

const envSchema = z.object({
  PERCEPTRON_API_KEY: z.string().optional().default(""),
  PERCEPTRON_BASE_URL: z.string().url().default("https://api.perceptron.inc"),
  PORT: z.coerce.number().int().positive().default(8787),
  USE_MOCK: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  DETECT_CATEGORIES: z.string().optional().default(""),
  SCAN_MAX_WIDTH: z.coerce.number().positive().default(960),
});

const parsed = envSchema.parse(process.env);

function parseCategories(raw: string): string[] | undefined {
  const cats = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cats.length > 0 ? cats : undefined;
}

const apiKey = parsed.PERCEPTRON_API_KEY.trim();
const mock =
  parsed.USE_MOCK || apiKey.length === 0 || apiKey === PLACEHOLDER_KEY;

export const config = {
  port: parsed.PORT,
  perceptronBaseUrl: parsed.PERCEPTRON_BASE_URL.replace(/\/+$/, ""),
  /** Use only inside perceptron.ts. Never log this value. */
  perceptronApiKey: apiKey,
  mock,
  detectCategories: parseCategories(parsed.DETECT_CATEGORIES),
  scanMaxWidth: parsed.SCAN_MAX_WIDTH,
};

export function logStartupMode(): void {
  if (config.mock) {
    console.log(
      "[deskcapade] Mode: MOCK — detections are synthetic. Set PERCEPTRON_API_KEY in .env for LIVE.",
    );
  } else {
    console.log("[deskcapade] Mode: LIVE — calling Perceptron /v1/detect");
  }
}
