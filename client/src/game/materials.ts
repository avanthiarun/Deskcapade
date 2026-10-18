/**
 * What a desk object does in the garden platformer, and which garden-castle piece it is drawn
 * as (pieces.ts), in the object's own color and size.
 */
export type ObjectKind =
  | "vine" // can -> a stone tower with a vine: climb it
  | "pool" // bowl / cup / glass -> a pool you can swim in, with a ladder and a slide
  | "woodbridge" // pencil -> a wooden bridge
  | "stonepath" // pen -> a stone bridge
  | "rockwall" // phone -> a rock wall with a ladder: climb it
  | "mushroom" // eraser / small cube -> a mushroom you bounce on
  | "jello" // sticky note -> a wobbly jello blob: you can move through it, but slowly
  | "rail" // spoon / fork -> a thin line platform
  | "river" // eyeglasses -> a river with stepping stones: miss them and you fall in
  | "icepatch" // plastic water bottle -> an icy patch: you slide and can't jump off it
  | "lava" // a pit of lava (Challenge hazard)
  | "spikes" // a row of spikes (Challenge hazard, and scissors)
  | "bridge" // cable -> a rope bridge that sags under you
  | "trampoline" // big bounce
  | "plush" // a bouncy berry bush
  | "conveyor" // carries you sideways
  | "updraft" // a lantern whose warm air floats you up
  | "geyser" // a fountain that erupts every few seconds, launching you up
  | "flame" // a brazier: sets you on fire
  | "ice" // slippery
  | "platform"; // a grassy floating island: stand on it

/**
 * The fixed transformations. Each object always becomes exactly this, from any camera angle
 * (bird's-eye for flat things, side-on for tall ones): only its color and size change.
 * Words are matched whole (plurals listed explicitly, so "glass" never matches "glasses").
 */
const RULES: readonly { kind: ObjectKind; words: readonly string[] }[] = [
  { kind: "woodbridge", words: ["pencil", "pencils", "colored pencil", "coloured pencil"] },
  { kind: "stonepath", words: ["pen", "pens", "ballpoint", "fountain pen", "gel pen"] },
  { kind: "rockwall", words: ["phone", "phones", "smartphone", "iphone", "cellphone", "cell phone", "mobile phone"] },
  { kind: "vine", words: ["can", "cans", "soda can", "tin can", "soda", "coke", "energy drink"] },
  { kind: "jello", words: ["sticky note", "sticky notes", "post-it", "post-its", "post-it note", "post-it notes", "postit", "sticky pad"] },
  { kind: "mushroom", words: ["eraser", "erasers", "cube", "cubes", "dice", "die", "block", "blocks", "rubik's cube", "rubiks cube"] },
  { kind: "pool", words: ["bowl", "bowls", "cup", "cups", "mug", "mugs", "glass", "teacup", "tumbler", "drinking glass"] },
  { kind: "rail", words: ["spoon", "spoons", "fork", "forks", "utensil", "utensils", "cutlery", "silverware", "teaspoon", "chopsticks", "spatula"] },
  { kind: "spikes", words: ["knife", "knives", "butter knife", "scissors", "scissor", "shears"] },
  { kind: "river", words: ["eyeglasses", "glasses", "sunglasses", "spectacles", "reading glasses"] },
  { kind: "icepatch", words: ["plastic water bottle", "plastic bottle", "water bottle", "disposable bottle", "bottled water"] },
  // other desk things keep one role each too
  { kind: "bridge", words: ["cable", "cables", "cord", "wire", "wires", "charger", "usb cable"] },
  { kind: "trampoline", words: ["mouse", "computer mouse"] },
  { kind: "conveyor", words: ["keyboard", "keyboards"] },
  { kind: "updraft", words: ["lamp", "desk lamp"] },
  { kind: "geyser", words: ["bottle", "bottles", "flask", "thermos"] },
  { kind: "flame", words: ["candle", "candles"] },
  { kind: "ice", words: ["plate", "plates", "saucer", "mirror"] },
  { kind: "plush", words: ["ball", "balls", "plush", "plushie", "stuffed animal", "teddy", "toy"] },
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = RULES.map((r) => ({ kind: r.kind, re: new RegExp(`\\b(?:${r.words.map(escape).join("|")})\\b`, "i") }));

/**
 * The listed object a label names, if any. Detection labels are descriptions ("white ceramic mug
 * holding scissors and a pen"), so the object named FIRST wins: that one is the mug.
 */
export function listedKind(label: string): ObjectKind | null {
  let best: { kind: ObjectKind; at: number } | null = null;
  for (const { kind, re } of PATTERNS) {
    const m = re.exec(label);
    if (m && (!best || m.index < best.at)) best = { kind, at: m.index };
  }
  return best?.kind ?? null;
}

/** The list as the AI matcher sees it: one plain name per transformation. */
export const LIST_FOR_MATCHING: readonly { name: string; kind: ObjectKind }[] = RULES.map((r) => ({
  name: r.words.slice(0, 3).join(" / "),
  kind: r.kind,
}));

/** Unlisted objects the AI matched to the listed object they're most like (label -> kind). */
const learned = new Map<string, ObjectKind>();
const key = (label: string): string => label.trim().toLowerCase();
export const isObjectKind = (k: string): k is ObjectKind => k in KIND_LABEL;

/** Remember AI matches. Returns true if anything new was learned. */
export function learnKinds(kinds: Record<string, string>): boolean {
  let added = false;
  for (const [label, kind] of Object.entries(kinds)) {
    if (!isObjectKind(kind) || learned.get(key(label)) === kind) continue;
    learned.set(key(label), kind);
    added = true;
  }
  return added;
}

/** Has this unlisted label been matched yet? */
export const isMatched = (label: string): boolean => learned.has(key(label));

/**
 * What an object becomes: its listed transformation; else the listed object the AI found it's
 * most like; else (no match yet, or no AI available) a grassy island.
 */
export function objectKind(label: string): ObjectKind {
  return listedKind(label) ?? learned.get(key(label)) ?? "platform";
}

/** Short words for captions ("pencil → wooden bridge"). */
export const KIND_LABEL: Readonly<Record<ObjectKind, string>> = {
  vine: "vine tower",
  pool: "pool + slide",
  woodbridge: "wooden bridge",
  stonepath: "stone bridge",
  rockwall: "rock wall",
  mushroom: "mushroom",
  jello: "jello blob",
  rail: "rail",
  river: "river",
  icepatch: "icy patch",
  lava: "lava pit",
  spikes: "spikes",
  bridge: "rope bridge",
  trampoline: "trampoline",
  plush: "berry bush",
  conveyor: "conveyor",
  updraft: "lantern updraft",
  geyser: "fountain geyser",
  flame: "brazier",
  ice: "ice",
  platform: "island",
};
