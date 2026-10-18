import { ApiError, GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

/* ------------------------------------------------------------------
   One place that talks to Gemini (free tier) for JSON answers: the Challenge course designer
   and the "which listed object is this most like?" matcher both use it.
   ------------------------------------------------------------------ */

/** Always points at Google's current Flash model. */
const LATEST_MODEL = "gemini-flash-latest";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) throw new GeminiError("No GEMINI_API_KEY in .env", 503, "NO_KEY");
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

export type GeminiPart = { inlineData: { mimeType: string; data: string } } | { text: string };

/** Ask Gemini for JSON matching `schema`. Returns the parsed answer and the model that gave it. */
export async function askGeminiJSON<T>(system: string, parts: GeminiPart[], schema: unknown): Promise<{ data: T; model: string }> {
  const ask = async (model: string): Promise<string | undefined> =>
    (
      await getClient().models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: schema },
      })
    ).text;

  let text: string | undefined;
  let model = config.geminiModel;
  try {
    try {
      text = await ask(model);
    } catch (err) {
      // Google retires model names; the "-latest" alias always points at a current one
      if (!(err instanceof ApiError) || err.status !== 404 || model === LATEST_MODEL) throw err;
      console.warn(`[gemini] ${model} is not available, using ${LATEST_MODEL}`);
      model = LATEST_MODEL;
      text = await ask(model);
    }
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (err instanceof ApiError) {
      if ((err.status === 400 && /api key/i.test(err.message)) || err.status === 401 || err.status === 403) {
        throw new GeminiError("Gemini rejected the API key", 503, "NO_KEY");
      }
      if (err.status === 429) throw new GeminiError("Gemini free-tier limit reached, try again soon", 429, "RATE_LIMITED");
      throw new GeminiError(`Gemini failed (${err.status})`, 502, "UPSTREAM_ERROR");
    }
    throw new GeminiError("Could not reach Gemini", 502, "NETWORK");
  }

  try {
    return { data: JSON.parse(text ?? "") as T, model };
  } catch {
    throw new GeminiError("Gemini answered in the wrong shape", 502, "BAD_OUTPUT");
  }
}
