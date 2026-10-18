import type { ApiError, ScanResponse } from "@deskcapade/shared";
import { StoryGame } from "../game/storyGame";
import { LiveSpriteLayer } from "../lib/liveSprites";
import { matchInBackground, onMatched } from "../lib/matchObjects";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { bindStoryUi, storyLayoutHTML } from "./storyLayout";

// Each scan takes a few seconds, so scans overlap: a new one starts every SCAN_START_EVERY_MS
// (at most MAX_SCANS_IN_FLIGHT at once) and results arrive every couple of seconds.
const SCAN_START_EVERY_MS = 1500; // 40 scans a minute
const MAX_SCANS_IN_FLIGHT = 4; // each scan takes 4-6 s, so ~4 overlap at this pace
const ERROR_BACKOFF_MS = 2000; // after a failed scan, wait longer before starting another
const SCAN_REQUEST_TIMEOUT_MS = 15_000;
const SCAN_WIDTH = 512; // small frames come back faster
const SCAN_JPEG_QUALITY = 0.7;

/**
 * Story with this computer's camera: the live video becomes the garden world (pixel pieces over
 * the desk objects, the garden game on top). Detection runs automatically, several scans overlapping.
 */
export function mountCapture(root: HTMLElement): () => void {
  injectGameStyles();
  root.innerHTML = storyLayoutHTML();
  const video = document.createElement("video");
  video.className = "hidden-video";
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  root.querySelector(".gm")!.appendChild(video);

  const canvas = root.querySelector<HTMLCanvasElement>("#view")!;
  const ctx = canvas.getContext("2d")!;

  const layer = new LiveSpriteLayer();
  const story = new StoryGame(layer);
  const ui = bindStoryUi(root, story, layer);
  const stopMatching = onMatched(() => layer.refreshSprites());
  let lastVideoTime = -1;
  let stream: MediaStream | null = null;
  let lastError = "";
  let scanTimer: number | undefined;
  let stopped = false;
  let raf = 0;

  ui.showMessage(`<h2>Starting the camera…</h2><p>Allow camera access when your browser asks.</p>`);

  // ---------- camera ----------

  const startCamera = async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      ui.showMessage(`<h2>No camera here</h2><p>This browser can't open the camera on this page.</p>
        <a class="gm-btn cream small" href="${ROUTES.story}">← Choose another camera</a>`);
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
      ui.showMessage(null);
    } catch (err) {
      const blocked = err instanceof DOMException && err.name === "NotAllowedError";
      ui.showMessage(`<h2>${blocked ? "Camera blocked" : "Camera busy"}</h2>
        <p>${blocked ? "Allow camera access for this site, then reload the page." : "Close other apps using the camera, then reload the page."}</p>
        <a class="gm-btn cream small" href="${ROUTES.story}">← Choose another camera</a>`);
    }
  };

  // ---------- drawing ----------

  /** While the desk is frozen: the camera picture at the moment you froze it. */
  let still: HTMLCanvasElement | null = null;

  const draw = (): void => {
    if (ui.isFrozen()) {
      // keep showing the picture from when you froze it; no new frames, no motion tracking
      if (!still && video.videoWidth > 0) {
        still = document.createElement("canvas");
        still.width = canvas.width;
        still.height = canvas.height;
        still.getContext("2d")!.drawImage(video, 0, 0, still.width, still.height);
      }
      if (still) ctx.drawImage(still, 0, 0);
    } else if (video.readyState >= 2 && video.videoWidth > 0) {
      still = null;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const fresh = video.currentTime !== lastVideoTime;
      lastVideoTime = video.currentTime;
      layer.frame(ctx, fresh);
    } else {
      ctx.fillStyle = "#1d140b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    layer.draw(ctx);
    story.frame(ctx);
    ui.refresh();
    if (!stopped) raf = requestAnimationFrame(draw);
  };

  // ---------- automatic scanning (overlapping, fast category scans) ----------

  const scanCanvas = document.createElement("canvas");
  const scanCtx = scanCanvas.getContext("2d")!;
  let inFlight = 0;
  let scanSeq = 0;
  let newestApplied = 0;
  let backoffUntil = 0;

  /** Send the current camera frame to the server; a slower answer than a newer one is dropped. */
  const startScan = async (): Promise<void> => {
    if (ui.isFrozen() || inFlight >= MAX_SCANS_IN_FLIGHT || performance.now() < backoffUntil) return;
    if (video.readyState < 2 || video.videoWidth === 0) return; // camera not ready yet
    const scale = Math.min(1, SCAN_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    scanCanvas.width = width;
    scanCanvas.height = height;
    scanCtx.drawImage(video, 0, 0, width, height);
    const image = scanCanvas.toDataURL("image/jpeg", SCAN_JPEG_QUALITY);
    const panAtCapture = layer.motion.current; // where the picture was when this frame was taken
    const seq = ++scanSeq;
    inFlight++;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, width, height, fast: true }),
        signal: controller.signal,
      });
      const body = (await res.json()) as ScanResponse | ApiError;
      if (stopped) return;
      if (!body.ok) {
        if (body.error !== lastError) ui.toast(`The desk spotter hiccuped: ${body.error}`);
        lastError = body.error;
        backoffUntil = performance.now() + ERROR_BACKOFF_MS;
        return;
      }
      lastError = "";
      if (seq < newestApplied || ui.isFrozen()) return; // a newer scan already answered, or the desk is frozen
      newestApplied = seq;
      layer.update(body.objects, body.imageSize, panAtCapture);
      matchInBackground(body.objects.map((o) => o.label ?? "")); // unlisted things take the shape of the closest listed one
    } catch {
      if (!stopped && lastError !== "offline") ui.toast("Can't reach the game server. Is it running?");
      lastError = "offline";
      backoffUntil = performance.now() + ERROR_BACKOFF_MS;
    } finally {
      inFlight--;
      window.clearTimeout(timeout);
    }
  };

  const tick = (): void => {
    if (stopped) return;
    void startScan();
    scanTimer = window.setTimeout(tick, SCAN_START_EVERY_MS);
  };

  raf = requestAnimationFrame(draw);
  void startCamera();
  tick();

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    story.dispose();
    ui.dispose();
    stopMatching();
    window.clearTimeout(scanTimer);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}
