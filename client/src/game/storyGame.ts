import type { LiveObject, LiveSpriteLayer } from "../lib/liveSprites";
import { sceneZoom, type GameObject } from "./level";
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
  /** World scale from how big the objects look (camera further back = smaller world), re-checked now and then. */
  private zoom = 1;
  private zoomCheckedAt = 0;
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
          this.game.setSize(ctx.canvas.width, ctx.canvas.height, this.zoom);
          this.game.drawObjectArt(ctx, toGame(obj), rect);
          return true;
        }
      : null;
    // floating objects rest on slabs of land, drawn before (under) the objects
    this.layer.beforeObjects = on ? (ctx, items) => this.game.drawSlabs(ctx, items.map((it) => ({ obj: toGame(it.obj), rect: it.rect }))) : null;
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
    const objects = this.layer.objects(W, H);
    if (now - this.zoomCheckedAt > 1500 && objects.length > 0) {
      this.zoomCheckedAt = now;
      const z = sceneZoom(objects.map((o) => o.box), H);
      if (Math.abs(z - this.zoom) >= 0.1) this.zoom = z; // only real changes (not detection wobble)
    }
    this.game.setSize(W, H, this.zoom);
    this.game.setObjects(objects.map(toGame), now);
    this.game.update(now);
    this.game.draw(ctx, now);
  }

  dispose(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.layer.objectArt = null;
    this.layer.beforeObjects = null;
  }
}
