import type { DetectedObject } from "@deskcapade/shared";

const BOX_COLOR = "#7dffb3";
const LINE_WIDTH = 3;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draw boxes in scan-image pixels, scaled to the canvas (video) pixels. */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  objects: DetectedObject[],
  imageSize: { w: number; h: number },
  canvasSize: { w: number; h: number },
  alpha: number,
): void {
  if (alpha <= 0 || imageSize.w <= 0 || imageSize.h <= 0) return;

  const sx = canvasSize.w / imageSize.w;
  const sy = canvasSize.h / imageSize.h;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = BOX_COLOR;
  ctx.lineWidth = LINE_WIDTH;
  ctx.font = "12px system-ui, sans-serif";

  for (const obj of objects) {
    const x = obj.box.x * sx;
    const y = obj.box.y * sy;
    const w = obj.box.w * sx;
    const h = obj.box.h * sy;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    const label = obj.label?.trim() || "object";
    const padX = 6;
    const textW = ctx.measureText(label).width;
    const chipH = 18;
    const chipY = Math.max(0, y - chipH - 4);
    ctx.fillStyle = "rgba(4, 20, 10, 0.85)";
    roundRect(ctx, x, chipY, textW + padX * 2, chipH, 6);
    ctx.fill();
    ctx.fillStyle = BOX_COLOR;
    ctx.fillText(label, x + padX, chipY + 13);
  }

  ctx.restore();
}
