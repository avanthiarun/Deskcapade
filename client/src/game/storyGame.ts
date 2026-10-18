import type { LiveObject, LiveSpriteLayer } from "../lib/liveSprites";
import type { GameObject } from "./level";
import { Platformer } from "./platformer";

const toGame = (o: LiveObject): GameObject => ({
  id: `o${o.id}`,
  label: o.label,
  templateId: o.templateId,
  box: o.box,
  colors: o.colors,
  ...(o.sprite ? { sprite: o.sprite } : {}),
});

/**
 * The garden platformer on top of Story's live video (both the laptop- and phone-camera pages).
 * Per animation frame, after `layer.draw(ctx)`: `story.frame(ctx)`.
 */
export class StoryGame {
  // no clouds in Story: the world is just your desk pieces
  private readonly game = new Platformer({ mode: "story", seed: Date.now() % 100000, clouds: false });
  private detachInput: (() => void) | null = null;
  private enabled = false;

  constructor(private readonly layer: LiveSpriteLayer) {
    this.setOn(true);
  }

  get on(): boolean {
    return this.enabled;
  }

  setOn(on: boolean): void {
    this.enabled = on;
    this.detachInput?.();
    this.detachInput = on ? this.game.attachInput() : null;
    // while the game is on, desk objects are drawn as their animated garden pieces
    this.layer.objectArt = on
      ? (ctx, obj, rect) => {
          this.game.setSize(ctx.canvas.width, ctx.canvas.height);
          this.game.drawObjectArt(ctx, toGame(obj), rect);
          return true;
        }
      : null;
  }

  /** What the page's top bar shows (seeds, blooms). */
  stats(): ReturnType<Platformer["stats"]> {
    return this.game.stats();
  }

  setPaused(paused: boolean): void {
    this.game.setPaused(paused);
  }

  frame(ctx: CanvasRenderingContext2D, now = performance.now()): void {
    if (!this.enabled) return;
    const { width: W, height: H } = ctx.canvas;
    this.game.setSize(W, H);
    this.game.setObjects(this.layer.objects(W, H).map(toGame), now);
    this.game.update(now);
    this.game.draw(ctx, now);
  }

  dispose(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.layer.objectArt = null;
  }
}
