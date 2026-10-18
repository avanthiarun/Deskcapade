import type { DetectedObject } from "@deskcapade/shared";
import { config } from "../config.js";

const DETECT_TIMEOUT_MS = 15_000;

export class PerceptronError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PerceptronError";
  }
}

type Point = { x: number; y: number };

type DetectPayload = {
  detections?: Array<{
    mention: string;
    point_box?: { top_left: Point; bottom_right: Point } | null;
  }>;
  finish_reason?: "complete" | "max_tokens";
  error?: { message?: string; code?: string };
};

function boxFromCorners(tl: Point, br: Point) {
  return {
    x: tl.x,
    y: tl.y,
    w: br.x - tl.x,
    h: br.y - tl.y,
  };
}

function messageFromStatus(status: number, upstream?: string): string {
  if (upstream) return upstream;
  switch (status) {
    case 400:
      return "Invalid detection request";
    case 401:
      return "Perceptron authentication failed";
    case 429:
      return "Perceptron rate limit exceeded";
    case 500:
      return "Perceptron had an internal error";
    default:
      return `Perceptron request failed (${status})`;
  }
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "UPSTREAM_ERROR";
    default:
      return "UPSTREAM_ERROR";
  }
}

function detectBody(imageDataUrl: string, categories?: readonly string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    media: { type: "image", image_url: imageDataUrl },
    config: { output: "box" },
  };
  const cats = config.detectCategories ?? categories;
  if (cats) body.categories = cats;
  return body;
}

/** Raw POST /v1/detect. Never logs the API key. Used by detectObjects and testDetect. */
export async function detectRaw(imageDataUrl: string, categories?: readonly string[]): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.perceptronBaseUrl}/v1/detect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.perceptronApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(detectBody(imageDataUrl, categories)),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new PerceptronError("Perceptron request timed out", 504, "TIMEOUT");
    }
    throw new PerceptronError("Could not reach Perceptron", 502, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The only module that talks to Perceptron.
 * Never logs or returns the API key.
 */
/**
 * `categories`: look only for these kinds of things and label them with these words. Much faster
 * than free-form descriptions (Story's live scans use it).
 */
export async function detectObjects(imageDataUrl: string, categories?: readonly string[]): Promise<DetectedObject[]> {
  const { status, body } = await detectRaw(imageDataUrl, categories);
  const payload = (body && typeof body === "object" ? body : {}) as DetectPayload;

  if (status < 200 || status >= 300) {
    const mapped = [400, 401, 429, 500].includes(status) ? status : 502;
    throw new PerceptronError(
      messageFromStatus(status, payload.error?.message),
      mapped,
      payload.error?.code ?? codeFromStatus(status),
    );
  }

  if (payload.finish_reason === "max_tokens") {
    console.warn("[perceptron] finish_reason=max_tokens; detections may be truncated");
  }

  const objects: DetectedObject[] = [];
  for (const [i, det] of (payload.detections ?? []).entries()) {
    if (!det.point_box) continue;
    const { top_left: tl, bottom_right: br } = det.point_box;
    if (
      typeof tl?.x !== "number" ||
      typeof tl?.y !== "number" ||
      typeof br?.x !== "number" ||
      typeof br?.y !== "number"
    ) {
      continue;
    }
    const box = boxFromCorners(tl, br);
    if (box.w <= 0 || box.h <= 0) continue;
    const label = det.mention?.trim();
    objects.push({
      id: `det-${i}`,
      box,
      ...(label ? { label } : {}),
    });
  }

  return objects;
}
