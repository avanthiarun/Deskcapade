/**
 * Map a detected desk object onto a game “skin”: vibe, mechanic, hero reaction, caption.
 * Labels come from Perceptron (or mock), so matching is keyword-based and forgiving.
 */

export type WorldKind =
  | "pool"
  | "lava"
  | "vine"
  | "cozy"
  | "nervous"
  | "bounce"
  | "castle"
  | "garden"
  | "path"
  | "potion"
  | "generic";

export type HeroReaction = "nap" | "nervous" | "water" | "bounce" | "idle";

export type WorldSkin = {
  kind: WorldKind;
  title: string;
  mechanic: string;
  reaction: HeroReaction;
  caption: string;
};

type Rule = {
  words: string[];
  skin: Omit<WorldSkin, "caption"> & { caption: (label: string) => string };
};

const pretty = (label: string): string =>
  label.replace(/\s+/g, " ").trim() || "mystery object";

const RULES: Rule[] = [
  {
    words: ["mug", "cup", "coffee", "tea", "tumbler"],
    skin: {
      kind: "pool",
      title: "Duck Pond",
      mechanic: "water level",
      reaction: "nap",
      caption: (l) => `The Great ${pretty(l)} looms ahead — a tiny sea with ducks on vacation.`,
    },
  },
  {
    words: ["bowl", "dish", "soup"],
    skin: {
      kind: "lava",
      title: "Lava Pit",
      mechanic: "hazard",
      reaction: "nervous",
      caption: (l) => `The ${pretty(l)} bubbles like a lava pit. Mind the rim!`,
    },
  },
  {
    words: ["glass", "wine", "water glass"],
    skin: {
      kind: "pool",
      title: "Crystal Pool",
      mechanic: "water level",
      reaction: "idle",
      caption: (l) => `A glassy lagoon shimmers inside the ${pretty(l)}.`,
    },
  },
  {
    words: ["charger", "cable", "cord", "wire"],
    skin: {
      kind: "vine",
      title: "Swing Vine",
      mechanic: "swing",
      reaction: "idle",
      caption: (l) => `A wild ${pretty(l)} vine unfurls — swing if you dare.`,
    },
  },
  {
    words: ["plant", "flower", "succulent", "cactus", "leaf", "leaves", "vase"],
    skin: {
      kind: "garden",
      title: "Tiny Grove",
      mechanic: "helper",
      reaction: "water",
      caption: (l) => `The ${pretty(l)} drinks the afternoon light. A grove is growing.`,
    },
  },
  {
    words: ["phone", "smartphone", "iphone", "android"],
    skin: {
      kind: "nervous",
      title: "Buzzing Relic",
      mechanic: "hazard",
      reaction: "nervous",
      caption: (l) => `The ${pretty(l)} might buzz at any moment. The hero looks nervous.`,
    },
  },
  {
    words: ["book", "notebook", "novel", "textbook", "journal"],
    skin: {
      kind: "castle",
      title: "Story Keep",
      mechanic: "platform",
      reaction: "idle",
      caption: (l) => `Towers of paper! The ${pretty(l)} is a keep of secret levels.`,
    },
  },
  {
    words: ["monitor", "screen", "display", "tv"],
    skin: {
      kind: "castle",
      title: "Sky Keep",
      mechanic: "platform",
      reaction: "idle",
      caption: (l) => `The ${pretty(l)} is a floating keep in the clouds.`,
    },
  },
  {
    words: ["duck", "rubber duck"],
    skin: {
      kind: "bounce",
      title: "Bouncy Duck",
      mechanic: "bounce",
      reaction: "bounce",
      caption: (l) => `The ${pretty(l)} is a bouncy pad. Boing!`,
    },
  },
  {
    words: ["mouse"],
    skin: {
      kind: "bounce",
      title: "Bouncy Pad",
      mechanic: "bounce",
      reaction: "bounce",
      caption: (l) => `The ${pretty(l)} is spring-loaded. Jump!`,
    },
  },
  {
    words: ["keyboard", "laptop", "computer", "macbook"],
    skin: {
      kind: "path",
      title: "Key Bridge",
      mechanic: "path",
      reaction: "idle",
      caption: (l) => `A brick road of keys stretches across the ${pretty(l)}.`,
    },
  },
  {
    words: ["bottle", "flask", "can"],
    skin: {
      kind: "potion",
      title: "Potion",
      mechanic: "helper",
      reaction: "idle",
      caption: (l) => `The ${pretty(l)} glows like a potion. One sip, extra hearts.`,
    },
  },
  {
    words: ["chair", "stool", "sofa", "couch"],
    skin: {
      kind: "cozy",
      title: "Nap Spot",
      mechanic: "rest",
      reaction: "nap",
      caption: (l) => `A cozy ${pretty(l)} invites a nap between quests.`,
    },
  },
  {
    words: ["person", "man", "woman", "face", "human"],
    skin: {
      kind: "cozy",
      title: "Villager",
      mechanic: "npc",
      reaction: "idle",
      caption: (l) => `A villager appears (${pretty(l)}). They nod, as if they know the plot.`,
    },
  },
];

const GENERIC: WorldSkin = {
  kind: "generic",
  title: "Landmark",
  mechanic: "platform",
  reaction: "idle",
  caption: "Something new wandered onto the desk. The adventure rewrites itself.",
};

const wordRe = (w: string): RegExp => new RegExp(`\\b${w}s?\\b`, "i");

export function skinFor(label: string): WorldSkin {
  const text = label.trim() || "object";
  for (const rule of RULES) {
    if (rule.words.some((w) => wordRe(w).test(text))) {
      const { caption, ...rest } = rule.skin;
      return { ...rest, caption: caption(text) };
    }
  }
  return { ...GENERIC, caption: `The ${pretty(text)} becomes a strange landmark.` };
}

export function hashLabel(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
