import type { ApiError, ScanResponse } from "@deskcapade/shared";
import type { GameObject } from "../game/level";
import { Platformer } from "../game/platformer";
import { injectGameStyles } from "../lib/gameStyles";
import { pickDeskObjects } from "../lib/deskFilter";
import { colorsFromDominant, deskSceneScale, makeDeskSprite, renderSpriteTemplate, type Rgb } from "../lib/deskSprites";
import { artPixelSize } from "../lib/artPixel";
import { drawPixelBackdrop } from "../lib/pixelBackdrop";
import { ROUTES } from "../lib/routes";
import { findSpriteTemplate } from "../lib/spriteDictionary";

const W = 1280;
const H = 720;
const PHOTO_WIDTH = 800; // same as Challenge's snapshots

/** A pretend desk (canvas pixels), so the platformer can be tried without a camera or Perceptron. */
const SAMPLE_DESK: { label: string; color: Rgb; box: { x: number; y: number; w: number; h: number } }[] = [
  { label: "soda can", color: [220, 40, 50], box: { x: 90, y: 480, w: 60, h: 150 } },
  { label: "coffee mug", color: [90, 140, 220], box: { x: 230, y: 560, w: 120, h: 120 } },
  { label: "scissors", color: [255, 120, 60], box: { x: 500, y: 650, w: 110, h: 45 } },
  { label: "usb cable", color: [60, 60, 70], box: { x: 330, y: 400, w: 230, h: 40 } },
  { label: "desk lamp", color: [255, 220, 90], box: { x: 640, y: 330, w: 80, h: 110 } },
  { label: "pencil", color: [255, 200, 60], box: { x: 630, y: 560, w: 170, h: 18 } },
  { label: "bowl", color: [240, 240, 240], box: { x: 820, y: 620, w: 130, h: 70 } },
  { label: "computer mouse", color: [200, 200, 210], box: { x: 960, y: 650, w: 70, h: 45 } },
  { label: "phone", color: [40, 90, 200], box: { x: 880, y: 360, w: 70, h: 140 } },
  { label: "keyboard", color: [230, 230, 235], box: { x: 1040, y: 530, w: 200, h: 40 } },
  { label: "water bottle", color: [80, 200, 200], box: { x: 1180, y: 330, w: 60, h: 190 } },
  { label: "candle", color: [255, 240, 220], box: { x: 1060, y: 420, w: 40, h: 70 } },
  { label: "plate", color: [250, 250, 255], box: { x: 760, y: 260, w: 120, h: 20 } },
  { label: "eraser", color: [255, 140, 170], box: { x: 400, y: 660, w: 70, h: 35 } },
];

function sampleObjects(): GameObject[] {
  return SAMPLE_DESK.map((o, i) => {
    const template = findSpriteTemplate(o.label);
    const colors = colorsFromDominant(o.color);
    return {
      id: `d${i}`,
      label: o.label,
      templateId: template?.id ?? null,
      box: o.box,
      colors,
      ...(template ? { sprite: renderSpriteTemplate(template, colors) } : {}),
    };
  });
}

/** Load a photo (same-origin path or a CORS-enabled URL) into a canvas the size Challenge would send. */
async function loadPhoto(url: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const scale = Math.min(1, PHOTO_WIDTH / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Test level (open /play): the garden platformer on a pretend desk, no camera needed.
 * /play?photo=<image url> runs the real Challenge pipeline (Perceptron, desk filter,
 * detailed sprites) on that picture instead; add &scan=<json url> to reuse a saved /api/scan
 * answer for it. B toggles the photo / pixel background (&bg=photo starts on the photo).
 */
export function mountPlay(root: HTMLElement): () => void {
  injectGameStyles();
  const params = new URLSearchParams(location.search);
  const photoUrl = params.get("photo");
  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.home}">◀ Home</a>
        <h1 class="gm-h1">Test level</h1>
        <div class="gm-stage"><canvas id="view" width="${W}" height="${H}"></canvas></div>
        <p class="gm-note" id="note" style="margin-top:14px">${
          photoUrl ? "Scanning the photo…" : "A pretend desk for trying the platformer without a camera."
        } ← → move · Space jump · ↑ ↓ climb · R restart${photoUrl ? " · B background" : ""}</p>
      </div>
    </main>
  `;
  const canvas = root.querySelector<HTMLCanvasElement>("#view")!;
  const note = root.querySelector<HTMLElement>("#note")!;
  const ctx = canvas.getContext("2d")!;
  const game = new Platformer({ mode: "challenge", seed: Number(params.get("seed")) || 7 });
  const detach = game.attachInput();
  let bg: HTMLCanvasElement | null = null;
  let photoBg: HTMLCanvasElement | null = null;
  let showPhoto = false;
  let raf = 0;
  let stopped = false;

  const backdrop = (w: number, h: number): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    drawPixelBackdrop(c.getContext("2d")!, w, h);
    return c;
  };

  const start = (objects: GameObject[]): void => {
    game.setSize(canvas.width, canvas.height);
    game.setObjects(objects);
    bg = backdrop(canvas.width, canvas.height);
    const loop = (now: number): void => {
      if (stopped) return;
      ctx.drawImage(showPhoto && photoBg ? photoBg : bg!, 0, 0);
      game.drawObjects(ctx, now);
      game.update(now);
      game.draw(ctx, now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };

  const fromPhoto = async (url: string, savedScan: string | null): Promise<void> => {
    const shot = await loadPhoto(url);
    // a saved /api/scan answer (JSON) skips the slow detection call when trying the same photo again
    const res = savedScan
      ? await fetch(savedScan)
      : await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: shot.toDataURL("image/jpeg", 0.85), width: shot.width, height: shot.height }),
        });
    const body = (await res.json()) as ScanResponse | ApiError;
    if (!body.ok) throw new Error(body.error);
    if (stopped) return;

    const scale = deskSceneScale(shot);
    canvas.width = Math.round(shot.width * scale);
    canvas.height = Math.round(shot.height * scale);
    photoBg = document.createElement("canvas");
    photoBg.width = canvas.width;
    photoBg.height = canvas.height;
    photoBg.getContext("2d")!.drawImage(shot, 0, 0, canvas.width, canvas.height);

    const { kept } = pickDeskObjects(shot, body.objects, body.imageSize);
    const pixel = artPixelSize(shot.height * scale) / scale;
    const objects = kept.map((c, i): GameObject => {
      const sp = makeDeskSprite(c.label, shot, c.box, pixel);
      return {
        id: `p${i}`,
        label: sp.label,
        templateId: sp.templateId,
        box: { x: sp.box.x * scale, y: sp.box.y * scale, w: sp.box.w * scale, h: sp.box.h * scale },
        sprite: sp.canvas,
        colors: sp.colors,
      };
    });
    note.textContent = `Found: ${kept.map((c) => c.label).join(" • ") || "nothing"}. ← → move · Space jump · ↑ ↓ climb · R restart · B background`;
    start(objects);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "b" || e.key === "B") showPhoto = !showPhoto;
  };
  window.addEventListener("keydown", onKey);

  if (photoUrl) {
    showPhoto = params.get("bg") === "photo";
    fromPhoto(photoUrl, params.get("scan")).catch((err: unknown) => {
      note.textContent = `Could not use that photo: ${err instanceof Error ? err.message : String(err)}`;
    });
  } else {
    start(sampleObjects());
  }

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    detach();
  };
}
