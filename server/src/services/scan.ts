import { DESK_CATEGORIES, type DetectedObject, type ScanResponse } from "@deskcapade/shared";
import { config } from "../config.js";
import { cleanupDetections } from "./cleanup.js";
import { mockDetections } from "./mock.js";
import { PerceptronError, detectObjects } from "./perceptron.js";

/**
 * The one scan pipeline: detect (or mock) -> cleanup -> response.
 * Used by both POST /api/scan and the websocket relay.
 */
export async function runScan(
  imageDataUrl: string,
  width: number,
  height: number,
  opts: { fast?: boolean } = {},
): Promise<ScanResponse> {
  const started = Date.now();
  const imageSize = { w: width, h: height };

  let raw: DetectedObject[];
  try {
    // fast (Story's live scans): look for desk-object categories only, about twice as quick
    raw = config.mock ? mockDetections(imageSize) : await detectObjects(imageDataUrl, opts.fast ? DESK_CATEGORIES : undefined);
  } catch (err) {
    if (err instanceof PerceptronError) {
      // Never includes the API key.
      console.error(`[perceptron] ${err.status} ${err.code ?? ""}: ${err.message}`);
    }
    throw err;
  }

  return {
    ok: true,
    objects: cleanupDetections(raw, imageSize),
    imageSize,
    latencyMs: Date.now() - started,
    mock: config.mock,
  };
}