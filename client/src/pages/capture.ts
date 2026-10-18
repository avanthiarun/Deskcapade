import type { ScanResponse } from "@deskcapade/shared";
import { getHealth, postScan } from "../lib/api";
import { startRearCamera, stopStream } from "../lib/camera";
import { drawDetections } from "../lib/overlay";

const SCAN_MAX_WIDTH = 960;
const STALE_MS = 3000;
const FADE_MS = 800;
const DEFAULT_INTERVAL_MS = 1500;

type LastScan = ScanResponse & { at: number };

export function mountCapture(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="capture">
      <video class="hidden-video" playsinline muted></video>
      <canvas></canvas>
      <div class="banner" id="banner">Object detected!</div>
      <div class="bar">
        <div class="status" id="status">Starting camera…</div>
        <div class="bar-row">
          <button class="scan-btn" id="scan" type="button">Scan</button>
          <label class="toggle">
            <input type="checkbox" id="auto" />
            Auto-scan
          </label>
          <select id="interval" aria-label="Auto-scan interval">
            <option value="1000">1000ms</option>
            <option value="1500" selected>1500ms</option>
            <option value="2500">2500ms</option>
          </select>
        </div>
      </div>
    </div>
  `;

  const video = root.querySelector("video")!;
  const canvas = root.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  const banner = root.querySelector("#banner") as HTMLElement;
  const status = root.querySelector("#status") as HTMLElement;
  const scanBtn = root.querySelector("#scan") as HTMLButtonElement;
  const autoEl = root.querySelector("#auto") as HTMLInputElement;
  const intervalEl = root.querySelector("#interval") as HTMLSelectElement;

  const offscreen = document.createElement("canvas");
  let stream: MediaStream | null = null;
  let raf = 0;
  let inFlight = false;
  let last: LastScan | null = null;
  let mockKnown: boolean | null = null;
  let scanMaxWidth = SCAN_MAX_WIDTH;
  let autoTimer: number | null = null;
  let stopped = false;

  function setStatus(extra?: string): void {
    const count = last?.objects.length ?? 0;
    const latency = last ? `${Math.round(last.latencyMs)}ms` : "—";
    const mockOn = last ? last.mock : Boolean(mockKnown);
    status.innerHTML = `
      <span class="badge${mockOn ? " show" : ""}">MOCK</span>
      <span>${count} object${count === 1 ? "" : "s"}</span>
      <span>${latency}</span>
      ${extra ? `<span class="error">${extra}</span>` : ""}
    `;
    banner.classList.toggle("show", count >= 1);
  }

  function boxAlpha(now: number): number {
    if (!last) return 0;
    const age = now - last.at;
    if (age <= STALE_MS) return 1;
    return Math.max(0, 1 - (age - STALE_MS) / FADE_MS);
  }

  function frame(): void {
    if (stopped) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w && h) {
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      if (last) {
        drawDetections(ctx, last.objects, last.imageSize, { w, h }, boxAlpha(performance.now()));
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function grabFrame(): { image: string; width: number; height: number } | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const width = Math.min(scanMaxWidth, vw);
    const height = Math.round((vh * width) / vw);
    offscreen.width = width;
    offscreen.height = height;
    const octx = offscreen.getContext("2d");
    if (!octx) return null;
    octx.drawImage(video, 0, 0, width, height);
    return {
      image: offscreen.toDataURL("image/jpeg", 0.8),
      width,
      height,
    };
  }

  async function scan(): Promise<void> {
    if (inFlight || stopped) return;
    const frameData = grabFrame();
    if (!frameData) return;
    inFlight = true;
    scanBtn.disabled = true;
    try {
      const result = await postScan(frameData);
      last = { ...result, at: performance.now() };
      mockKnown = result.mock;
      setStatus();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Scan failed");
    } finally {
      inFlight = false;
      scanBtn.disabled = false;
    }
  }

  function clearAuto(): void {
    if (autoTimer != null) {
      window.clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function syncAuto(): void {
    clearAuto();
    if (!autoEl.checked) return;
    const ms = Number(intervalEl.value) || DEFAULT_INTERVAL_MS;
    autoTimer = window.setInterval(() => {
      if (!inFlight) void scan();
    }, ms);
  }

  scanBtn.addEventListener("click", () => void scan());
  autoEl.addEventListener("change", syncAuto);
  intervalEl.addEventListener("change", syncAuto);

  void (async () => {
    try {
      const health = await getHealth();
      mockKnown = health.mock;
      if (health.scanMaxWidth) scanMaxWidth = health.scanMaxWidth;
      setStatus();
    } catch {
      /* first scan will surface API issues */
    }
    try {
      stream = await startRearCamera(video);
      setStatus();
      raf = requestAnimationFrame(frame);
    } catch (err) {
      status.innerHTML = `<span class="error">${err instanceof Error ? err.message : "Camera error"}</span>`;
    }
  })();

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    clearAuto();
    stopStream(stream);
  };
}
