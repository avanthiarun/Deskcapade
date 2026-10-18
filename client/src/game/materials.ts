import type { Box } from "@deskcapade/shared";

/**
 * What a desk object becomes in the garden platformer:
 *   vine      climb it (cans, bottles, plants, anything tall)
 *   pool      swim in it, with a ladder down to the ground (mugs, cups, bowls)
 *   mushroom  bounces you up high (erasers, balls, mice...)
 *   platform  stand on its top (everything else)
 */
export type ObjectKind = "vine" | "pool" | "mushroom" | "platform";

/** Sprite dictionary ids (lib/spriteDictionary.ts) for each kind. Edit these lists to remap objects. */
const VINE_IDS = new Set(["can", "bottle", "cylinder", "candle", "lamp", "plant"]);
const POOL_IDS = new Set(["cup", "bowl"]);
const MUSHROOM_IDS = new Set(["eraser", "ball", "rubiks", "mouse", "duck", "lipgloss"]);

/** Taller than this times its width = tall enough to be a vine, even if the dictionary doesn't know it. */
const TALL_RATIO = 1.4;

export function objectKind(templateId: string | null, box: Box): ObjectKind {
  if (templateId && POOL_IDS.has(templateId)) return "pool";
  if (templateId && MUSHROOM_IDS.has(templateId)) return "mushroom";
  // a bottle lying on its side is a platform, not a vine
  if (templateId && VINE_IDS.has(templateId)) return box.h >= box.w ? "vine" : "platform";
  return box.h > box.w * TALL_RATIO ? "vine" : "platform";
}
