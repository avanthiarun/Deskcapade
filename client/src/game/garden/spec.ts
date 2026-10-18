import type { ApiError, TransformResponse, TransformSpec } from "@deskcapade/shared";

export type Shape = "tall" | "wide" | "square";

export const shapeOf = (w: number, h: number): Shape =>
  h > w * 1.4 ? "tall" : w > h * 1.6 ? "wide" : "square";

type Rule = Omit<TransformSpec, "caption" | "source"> & {
  words: string[];
  caption: (label: string) => string;
};

const RULES: Rule[] = [
  { words: ["can", "soda", "tin", "bottle", "flask"], name: "Soda Castle", role: "house", ladder: "left", roof: "cone", decorations: ["windows", "flag"], accent: "#ff86a8", mood: "cheer", action: "Go inside", caption: (l) => `The ${l} is a soda castle. Climb the vine, or slip through the door.` },
  { words: ["mug", "cup", "coffee", "tea", "tumbler"], name: "Duck Pond", role: "pool", ladder: "right", roof: "none", decorations: ["ducks", "lilypads"], accent: "#5cb8ff", mood: "nap", action: "Splash", caption: (l) => `The ${l} is a tiny pond with ducks. The handle is a ladder.` },
  { words: ["bowl", "dish", "soup", "glass"], name: "Swimming Pool", role: "pool", ladder: "left", roof: "none", decorations: ["lilypads"], accent: "#7ad0c8", mood: "nap", action: "Splash", caption: (l) => `The ${l} is a swimming pool. Dive in!` },
  { words: ["phone", "smartphone", "iphone", "android"], name: "Buzzing Tower", role: "platform", ladder: "right", roof: "flat", decorations: ["lanterns"], accent: "#ffd84a", mood: "nervous", action: "Listen", caption: (l) => `The ${l} might buzz at any moment. The gardener looks nervous.` },
  { words: ["charger", "cable", "cord", "wire", "headphones", "earbuds"], name: "Rope Bridge", role: "bridge", ladder: "none", roof: "none", decorations: [], accent: "#a8745a", mood: "idle", action: "Cross", caption: (l) => `The ${l} is a wobbly rope bridge.` },
  { words: ["pen", "pencil", "marker", "highlighter", "ruler"], name: "Plank Walk", role: "bridge", ladder: "none", roof: "none", decorations: ["flowers"], accent: "#ffb870", mood: "idle", action: "Balance", caption: (l) => `The ${l} is a long plank, perfect for balancing.` },
  { words: ["note", "paper", "sticky", "card", "envelope", "post-it"], name: "Note Sign", role: "platform", ladder: "none", roof: "none", decorations: ["sign"], accent: "#ffd84a", mood: "idle", action: "Read", caption: (l) => `A ${l} is pinned here like a signpost.` },
  { words: ["book", "textbook", "journal", "novel", "notebook"], name: "Story Keep", role: "house", ladder: "right", roof: "flat", decorations: ["windows", "flag"], accent: "#c9a0ff", mood: "cheer", action: "Go inside", caption: (l) => `Towers of paper! The ${l} is a keep full of secret levels.` },
  { words: ["scissors", "scissor", "knife", "blade", "razor", "cutter"], name: "Thorn Patch", role: "hazard", ladder: "none", roof: "none", decorations: [], accent: "#e0405a", mood: "nervous", action: "Careful!", caption: (l) => `The ${l} is a thorny patch. It will nudge you away, gently.` },
  { words: ["plant", "flower", "succulent", "cactus", "leaf", "vase", "pot"], name: "Tiny Grove", role: "garden", ladder: "none", roof: "none", decorations: [], accent: "#ff86a8", mood: "cheer", action: "Water it", caption: (l) => `The ${l} is thirsty. Water it and flowers will bloom.` },
  { words: ["duck", "ball", "sponge", "mouse", "eraser"], name: "Bouncy Pad", role: "bounce", ladder: "none", roof: "none", decorations: [], accent: "#ff86a8", mood: "cheer", action: "Boing", caption: (l) => `The ${l} is spring-loaded. Jump!` },
  { words: ["monitor", "screen", "display", "tv", "laptop", "computer", "macbook"], name: "Sky Keep", role: "house", ladder: "right", roof: "flat", decorations: ["windows", "chimney"], accent: "#8fb4ff", mood: "idle", action: "Go inside", caption: (l) => `The ${l} is a floating keep in the clouds.` },
  { words: ["keyboard"], name: "Key Bridge", role: "bridge", ladder: "none", roof: "none", decorations: ["flowers"], accent: "#c9cde0", mood: "idle", action: "Cross", caption: (l) => `A brick road of keys stretches across the ${l}.` },
  { words: ["chair", "stool", "sofa", "couch", "pillow", "bed"], name: "Nap Spot", role: "nap", ladder: "none", roof: "none", decorations: ["mushrooms"], accent: "#ffb870", mood: "nap", action: "Nap", caption: (l) => `A cozy ${l} invites a nap between quests.` },
  { words: ["hand", "finger", "arm", "person", "man", "woman", "face"], name: "Friendly Cloud", role: "platform", ladder: "none", roof: "none", decorations: ["clouds"], accent: "#fff7e6", mood: "cheer", action: "Wave", caption: () => "A big friendly cloud drifts by. That is you, moving the world." },
];

const wordRe = (w: string): RegExp => new RegExp(`\\b${w}s?\\b`, "i");
const title = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function ruleSpec(label: string, shape: Shape): TransformSpec {
  const text = label.trim() || "object";
  const rule = RULES.find((r) => r.words.some((w) => wordRe(w).test(text)));
  if (!rule) {
    return {
      name: `Mossy ${title(text)}`.slice(0, 32), role: "platform", ladder: "none", roof: "none",
      decorations: ["mushrooms"], accent: "#a8e86c", mood: "idle", action: "Look around",
      caption: `The ${text} became a mossy landmark.`, source: "rules",
    };
  }
  const { words, caption, ...rest } = rule;
  void words;
  const spec: TransformSpec = { ...rest, caption: caption(text), source: "rules" };
  if (spec.role === "bridge" && shape === "tall") {
    return { ...spec, name: "Hanging Vine", role: "platform", ladder: "right", decorations: ["flowers"] };
  }
  return spec;
}

/**
 * Hands out a spec for every (label, shape). The rule-based answer is instant. The AI answer
 * is requested in the background and replaces it when it arrives.
 */
export class SpecStore {
  private cache = new Map<string, TransformSpec>();
  private inflight = new Set<string>();
  private retryAt = new Map<string, number>();

  get(label: string, shape: Shape, now: number): TransformSpec {
    const key = `${label.toLowerCase()}|${shape}`;
    let spec = this.cache.get(key);
    if (!spec) {
      spec = ruleSpec(label, shape);
      this.cache.set(key, spec);
    }
    if (spec.source === "rules" && !this.inflight.has(key) && now >= (this.retryAt.get(key) ?? 0)) {
      void this.ask(key, label, shape);
    }
    return spec;
  }

  private async ask(key: string, label: string, shape: Shape): Promise<void> {
    this.inflight.add(key);
    try {
      const res = await fetch("/api/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, shape }),
      });
      const body = (await res.json()) as TransformResponse | ApiError;
      if (body.ok) {
        this.cache.set(key, { ...body.spec, source: "ai" });
      } else {
        // No API key: stop asking. Any other failure: try again in 30 seconds.
        this.retryAt.set(key, body.code === "NO_AI" ? Infinity : performance.now() + 30_000);
      }
    } catch {
      this.retryAt.set(key, performance.now() + 30_000);
    } finally {
      this.inflight.delete(key);
    }
  }
}