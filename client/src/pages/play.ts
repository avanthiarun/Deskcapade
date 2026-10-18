import { Platformer } from "../game/platformer";
import { injectGameStyles } from "../lib/gameStyles";
import { colorsFromDominant, renderSpriteTemplate, type Rgb } from "../lib/deskSprites";
import { drawPixelBackdrop } from "../lib/pixelBackdrop";
import { ROUTES } from "../lib/routes";
import { findSpriteTemplate } from "../lib/spriteDictionary";

const W = 1280;
const H = 720;

/** A pretend desk (canvas pixels), so the platformer can be tried without a camera or Perceptron. */
const SAMPLE_DESK: { label: string; color: Rgb; box: { x: number; y: number; w: number; h: number } }[] = [
  { label: "soda can", color: [220, 40, 50], box: { x: 250, y: 420, w: 70, h: 160 } },
  { label: "coffee mug", color: [90, 140, 220], box: { x: 430, y: 470, w: 150, h: 140 } },
  { label: "eraser", color: [255, 140, 170], box: { x: 700, y: 600, w: 90, h: 50 } },
  { label: "notebook", color: [240, 200, 80], box: { x: 860, y: 540, w: 230, h: 70 } },
  { label: "water bottle", color: [80, 200, 200], box: { x: 1140, y: 330, w: 80, h: 300 } },
];

/** Test level: the garden platformer on a sample desk (open /play). */
export function mountPlay(root: HTMLElement): () => void {
  injectGameStyles();
  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.home}">◀ Home</a>
        <h1 class="gm-h1">Test level</h1>
        <div class="gm-stage"><canvas id="view" width="${W}" height="${H}"></canvas></div>
        <p class="gm-note" style="margin-top:14px">A pretend desk for trying the platformer without a camera. ← → move · Space jump · ↑ ↓ climb · R restart</p>
      </div>
    </main>
  `;
  const canvas = root.querySelector<HTMLCanvasElement>("#view")!;
  const ctx = canvas.getContext("2d")!;
  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  drawPixelBackdrop(bg.getContext("2d")!, W, H);

  const game = new Platformer({ mode: "challenge", seed: Number(new URLSearchParams(location.search).get("seed")) || 7 });
  game.setSize(W, H);
  game.setObjects(
    SAMPLE_DESK.map((o, i) => {
      const template = findSpriteTemplate(o.label);
      return {
        id: `d${i}`,
        label: o.label,
        templateId: template?.id ?? null,
        box: o.box,
        ...(template ? { sprite: renderSpriteTemplate(template, colorsFromDominant(o.color)) } : {}),
      };
    }),
  );
  const detach = game.attachInput();

  let raf = 0;
  const loop = (now: number): void => {
    ctx.drawImage(bg, 0, 0);
    game.drawObjects(ctx, now);
    game.update(now);
    game.draw(ctx, now);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    detach();
  };
}
