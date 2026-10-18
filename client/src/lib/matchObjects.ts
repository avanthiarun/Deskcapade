import type { ApiError, MatchResponse } from "@deskcapade/shared";
import { isMatched, learnKinds, listedKind, LIST_FOR_MATCHING } from "../game/materials";

/* ------------------------------------------------------------------
   Desk objects that aren't on the game's list get matched (by the AI on the server) to the
   listed object they're most like, so a stapler or a tape dispenser still takes a proper shape.
   Matches are remembered in this browser, so each label is only ever asked about once.
   ------------------------------------------------------------------ */

const STORE_KEY = "deskcapade.matchedKinds";
const MIN_GAP_MS = 6000; // Story scans constantly; this keeps us well inside Gemini's free limits
const MAX_PER_REQUEST = 12;

const asked = new Set<string>();
const waiting = new Set<string>();
let lastRequestAt = 0;
let timer: number | undefined;
let listeners: (() => void)[] = [];

// matches from earlier visits
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>;
  learnKinds(saved);
  for (const label of Object.keys(saved)) asked.add(label.trim().toLowerCase());
} catch {
  /* storage unavailable or empty: fine */
}

const needsMatch = (label: string): boolean => !listedKind(label) && !isMatched(label) && !asked.has(label.trim().toLowerCase());

function remember(kinds: Record<string, string>): void {
  if (!learnKinds(kinds)) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...saved, ...kinds }));
  } catch {
    /* storage unavailable: they're still learned for this visit */
  }
  for (const fn of listeners) fn();
}

async function request(labels: string[], timeoutMs: number): Promise<void> {
  if (labels.length === 0) return;
  for (const l of labels) asked.add(l.trim().toLowerCase());
  lastRequestAt = Date.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels, options: LIST_FOR_MATCHING }),
      signal: controller.signal,
    });
    const body = (await res.json()) as MatchResponse | ApiError;
    if (body.ok) remember(body.kinds);
  } catch {
    /* no AI right now: these stay grassy islands */
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Story: queue unlisted labels; they're matched in small batches in the background. */
export function matchInBackground(labels: readonly string[]): void {
  for (const l of labels) if (needsMatch(l)) waiting.add(l);
  if (waiting.size === 0 || timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    const batch = [...waiting].slice(0, MAX_PER_REQUEST);
    batch.forEach((l) => waiting.delete(l));
    void request(batch, 20_000).then(() => {
      if (waiting.size > 0) matchInBackground([]);
    });
  }, Math.max(1500, MIN_GAP_MS - (Date.now() - lastRequestAt)));
}

/** Challenge: match the photo's unlisted objects now (waits at most `timeoutMs`). */
export async function matchNow(labels: readonly string[], timeoutMs = 12_000): Promise<void> {
  const todo = [...new Set(labels.filter(needsMatch))].slice(0, 20);
  await request(todo, timeoutMs);
}

/** Call `fn` whenever new matches arrive. Returns a function that stops listening. */
export function onMatched(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}
