import type { LiveObject, LiveSpriteLayer } from "../lib/liveSprites";
import type { GameObject } from "./level";
import { Platformer } from "./platformer";

const toGame = (o: LiveObject): GameObject => ({ id: `o${o.id}`, label: o.label, templateId: o.templateId, box: o.box });

/**
 * The garden platformer on top of Story's live video (both the laptop- and phone-camera pages).
 * Per animation frame, after `layer.draw(ctx)`: `story.frame(ctx)`.
 */
export class StoryGame {
  private readonly game = new Platformer({ mode: "story", seed: Date.now() % 100000 });
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
    // desk objects are drawn as their garden pieces (vines, pools, mushrooms) while the game is on
    this.layer.objectArt = on
      ? (ctx, obj, rect) => {
          this.game.setSize(ctx.canvas.width, ctx.canvas.height);
          return this.game.drawObjectArt(ctx, toGame(obj), rect);
        }
      : null;
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
