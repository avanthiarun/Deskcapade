import type { ApiError, ScanResponse } from "@deskcapade/shared";
import { LiveSpriteLayer, renderLiveDetectedText } from "../lib/liveSprites";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { injectStoryStyles } from "../lib/storyStyles";

const SCAN_INTERVAL_MS = 250; // detection always runs automatically, every 250 ms
const ERROR_BACKOFF_MS = 2000; // after a failed scan, wait longer before trying again
const SCAN_REQUEST_TIMEOUT_MS = 15_000;
const SCAN_WIDTH = 800; // frames are scaled down to this width before being sent
const SCAN_JPEG_QUALITY = 0.7;

type CameraState = "starting" | "on" | "error";

/**
 * Laptop-camera page: same view as the phone-camera page (pixel sprites over the desk objects
 * in the video, "Detected: ..." text underneath, automatic scanning every 250 ms). The only difference is the video source:
 * this computer's own camera instead of the phone.
 */
export function mountCapture(root: HTMLElement): () => void {
  injectGameStyles();
  injectStoryStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.story}">◀ Story</a>
        <h1 class="gm-h1">Story</h1>
        <div class="gm-stage"><canvas id="view" width="1280" height="720"></canvas></div>
        <div class="gm-row">
          <span class="gm-chip" id="cameraChip"><span id="cameraText">Starting camera…</span></span>
          <span class="gm-chip" id="countChip">0 objects</span>
          <span class="gm-chip" id="latencyChip">– ms</span>
          <span class="gm-chip warn" id="mockChip" hidden>MOCK</span>
          <button class="gm-btn small ghost" id="pixelToggle" type="button" aria-pressed="false">🌄 Pixel world: Off</button>
        </div>

        <p class="st-detected" id="detected" hidden aria-live="polite"></p>

        <video id="video" class="hidden-video" autoplay muted playsinline></video>
        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>
  `;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>("#view");
  const ctx = canvas.getContext("2d")!;
  const video = q<HTMLVideoElement>("#video");
  const cameraChip = q<HTMLElement>("#cameraChip");
  const cameraText = q<HTMLElement>("#cameraText");
  const countChip = q<HTMLElement>("#countChip");
  const latencyChip = q<HTMLElement>("#latencyChip");
  const mockChip = q<HTMLElement>("#mockChip");
  const detectedEl = q<HTMLElement>("#detected");
  const toast = q<HTMLElement>("#toast");
  const pixelToggle = q<HTMLButtonElement>("#pixelToggle");

  // ---------- state ----------

  const layer = new LiveSpriteLayer();
  let lastVideoTime = -1;
  let cameraState: CameraState = "starting";
  let cameraError = "";
  let stream: MediaStream | null = null;
  let latencyMs: number | null = null;
  let toastTimer: number | undefined;
  let scanTimer: number | undefined;
  let stopped = false;
  let raf = 0;

  // ---------- small UI helpers ----------

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 5000);
  };

  const renderToggle = (): void => {
    pixelToggle.textContent = `🌄 Pixel world: ${layer.pixelWorld ? "On" : "Off"}`;
    pixelToggle.setAttribute("aria-pressed", String(layer.pixelWorld));
  };


  const renderUi = (): void => {
    if (cameraState === "on") {
      cameraText.textContent = "Laptop camera on";
      cameraChip.className = "gm-chip on";
    } else if (cameraState === "error") {
      cameraText.textContent = "Camera unavailable";
      cameraChip.className = "gm-chip warn";
    } else {
      cameraText.textContent = "Starting camera…";
      cameraChip.className = "gm-chip warn";
    }

    const count = layer.count;
    countChip.textContent = `${count} object${count === 1 ? "" : "s"}`;
    countChip.className = count > 0 ? "gm-chip on" : "gm-chip";
    latencyChip.textContent = latencyMs === null ? "– ms" : `${latencyMs} ms`;
    renderLiveDetectedText(detectedEl, layer);
    renderToggle();
  };

  // ---------- camera ----------

  const startCamera = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraState = "error";
      cameraError = "This browser can't open the camera on this page.";
      showToast(cameraError);
      renderUi();
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (stopped) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      video.srcObject = media;
      await video.play().catch(() => undefined);
      cameraState = "on";
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      cameraState = "error";
      cameraError =
        name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access, then reload."
          : "Could not start the camera. Close other apps using it and reload.";
      showToast(cameraError);
    }
    renderUi();
  };

  // ---------- drawing ----------

  const draw = (): void => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const fresh = video.currentTime !== lastVideoTime;
      lastVideoTime = video.currentTime;
      if (layer.frame(ctx, fresh)) renderUi();
    } else {
      ctx.fillStyle = "#120f20";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    layer.draw(ctx);
    if (!stopped) raf = requestAnimationFrame(draw);
  };

  // ---------- automatic scanning (every 250 ms, one at a time) ----------

  const scanCanvas = document.createElement("canvas");
  const scanCtx = scanCanvas.getContext("2d")!;

  /** Send the current camera frame to the server. Returns false only if the scan failed. */
  const scanOnce = async (): Promise<boolean> => {
    if (video.readyState < 2 || video.videoWidth === 0) return true; // camera not ready yet

    const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    scanCanvas.width = width;
    scanCanvas.height = height;
    scanCtx.drawImage(video, 0, 0, width, height);
    const image = scanCanvas.toDataURL("image/jpeg", SCAN_JPEG_QUALITY);
    const panAtCapture = layer.motion.current; // where the picture was when this frame was taken

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, width, height }),
        signal: controller.signal,
      });
      const body = (await res.json()) as ScanResponse | ApiError;
      if (stopped) return true;
      if (!body.ok) {
        showToast(body.error);
        return false;
      }
      latencyMs = body.latencyMs;
      mockChip.hidden = !body.mock;
      layer.update(body.objects, body.imageSize, panAtCapture);
      return true;
    } catch {
      if (!stopped) showToast("Could not reach the server.");
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const started = performance.now();
    const ok = await scanOnce();
    if (stopped) return;
    const wait = ok ? SCAN_INTERVAL_MS : ERROR_BACKOFF_MS;
    scanTimer = window.setTimeout(() => void tick(), Math.max(0, wait - (performance.now() - started)));
  };

  pixelToggle.addEventListener("click", () => {
    layer.setPixelWorld(!layer.pixelWorld);
    renderToggle();
  });

  renderUi();
  raf = requestAnimationFrame(draw);
  void startCamera();
  void tick();

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(scanTimer);
    window.clearTimeout(toastTimer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}