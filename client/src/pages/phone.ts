import type { ServerToPhone } from "@deskcapade/shared";
import { connectSocket, type SocketState } from "../lib/socket";
import { injectStyles } from "../lib/styles";

const MIN_FRAME_INTERVAL_MS = 1000 / 20; // never faster than 20 fps
const MAX_IN_FLIGHT = 2; // 2 frames in flight hides network latency without piling up
const ACK_TIMEOUT_MS = 2000; // if acks are lost, start fresh after this long
const MAX_LOCAL_BUFFER_BYTES = 150_000; // our own uplink is backed up: skip frames
const SLOW_RTT_MS = 350; // above this, drop to a smaller/lower-quality stream
const FAST_RTT_MS = 120; // below this for a while, step back up
const FAST_STREAK_TO_UPGRADE = 20;

// Quality ladder: the phone moves along it automatically to match the connection.
const LEVELS = [
  { width: 480, quality: 0.5 },
  { width: 640, quality: 0.55 },
  { width: 800, quality: 0.65 },
] as const;
const START_LEVEL = 1;

/**
 * Phone page: only streams the camera. No detection happens here.
 *
 * Frames are sent as binary websocket messages: a 4-byte header (width, height as
 * little-endian uint16) followed by the raw JPEG. Up to MAX_IN_FLIGHT frames are
 * outstanding; each ack frees a slot and the next frame is captured fresh at that
 * moment, so the laptop always sees a recent picture.
 */
export function mountPhone(root: HTMLElement): () => void {
  injectStyles();

  root.innerHTML = `
    <div class="dc-page dc-phone">
      <h1>Deskcapade camera</h1>
      <p>Point this at your desk. Keep this page open.</p>
      <div class="dc-bar">
        <span class="dc-chip" id="conn"><span class="dc-dot"></span><span id="connText">Connecting…</span></span>
        <button class="dc-btn ghost" id="flip" type="button">Flip camera</button>
      </div>
      <video id="video" autoplay muted playsinline></video>
      <p id="error" class="dc-hidden" style="color: var(--dc-bad); margin-top: 12px;"></p>
    </div>
  `;

  const video = root.querySelector<HTMLVideoElement>("#video")!;
  const connChip = root.querySelector<HTMLElement>("#conn")!;
  const connText = root.querySelector<HTMLElement>("#connText")!;
  const flipBtn = root.querySelector<HTMLButtonElement>("#flip")!;
  const errorEl = root.querySelector<HTMLElement>("#error")!;

  let socketState: SocketState = "connecting";
  let desktopConnected = false;
  let facing: "environment" | "user" = "environment";
  let stream: MediaStream | null = null;
  let stopped = false;

  // flow control + adaptive quality
  let sentTimes: number[] = []; // send time of each un-acked frame, oldest first
  let lastSentAt = 0;
  let encoding = false;
  let level = START_LEVEL;
  let rttEma = 0;
  let fastStreak = 0;
  let lastChipUpdate = 0;

  // ---------- socket + status ----------

  const renderStatus = (): void => {
    let text = "Connecting…";
    let cls = "dc-chip";
    if (socketState === "open") {
      if (desktopConnected) {
        const cfg = LEVELS[level]!;
        const delay = rttEma > 0 ? ` · ${Math.round(rttEma)} ms` : "";
        text = `Streaming to laptop · ${cfg.width}px${delay}`;
        cls = "dc-chip on";
      } else {
        text = "Waiting for laptop";
        cls = "dc-chip warn";
      }
    } else if (socketState === "closed") {
      text = "Reconnecting…";
      cls = "dc-chip warn";
    }
    connText.textContent = text;
    connChip.className = cls;
  };

  const onAck = (): void => {
    const sent = sentTimes.shift();
    if (sent === undefined) return;
    const rtt = performance.now() - sent;
    rttEma = rttEma === 0 ? rtt : rttEma * 0.7 + rtt * 0.3;

    if (rttEma > SLOW_RTT_MS && level > 0) {
      level -= 1;
      rttEma = 0;
      fastStreak = 0;
    } else if (rttEma > 0 && rttEma < FAST_RTT_MS) {
      fastStreak += 1;
      if (fastStreak >= FAST_STREAK_TO_UPGRADE && level < LEVELS.length - 1) {
        level += 1;
        rttEma = 0;
        fastStreak = 0;
      }
    } else {
      fastStreak = 0;
    }

    const now = performance.now();
    if (now - lastChipUpdate > 500) {
      lastChipUpdate = now;
      renderStatus();
    }
  };

  const socket = connectSocket("phone", {
    onState: (s) => {
      socketState = s;
      if (s !== "open") {
        desktopConnected = false;
        sentTimes = []; // a reconnect starts clean
      }
      renderStatus();
    },
    onMessage: (raw) => {
      try {
        const msg = JSON.parse(raw) as ServerToPhone;
        if (msg.type === "ack") {
          onAck();
        } else if (msg.type === "status") {
          desktopConnected = msg.desktopConnected;
          renderStatus();
        }
      } catch {
        /* ignore malformed messages */
      }
    },
  });

  // ---------- camera ----------

  const showError = (text: string): void => {
    errorEl.textContent = text;
    errorEl.classList.remove("dc-hidden");
  };

  const startCamera = async (): Promise<void> => {
    errorEl.classList.add("dc-hidden");
    stream?.getTracks().forEach((t) => t.stop());

    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Camera needs a secure (https) page. Open the https:// link, not http://.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      showError(
        name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access in your browser settings, then reload."
          : "Could not start the camera. Close other apps using it and reload.",
      );
    }
  };

  flipBtn.addEventListener("click", () => {
    facing = facing === "environment" ? "user" : "environment";
    void startCamera();
  });

  // ---------- frame streaming ----------

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const sendFrame = (): void => {
    if (!ctx || encoding || !socket.isOpen() || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }
    if (socket.bufferedAmount() > MAX_LOCAL_BUFFER_BYTES) return;

    const now = performance.now();
    if (sentTimes.length > 0 && now - sentTimes[0]! > ACK_TIMEOUT_MS) sentTimes = [];
    if (sentTimes.length >= MAX_IN_FLIGHT) return;
    if (now - lastSentAt < MIN_FRAME_INTERVAL_MS) return;

    const cfg = LEVELS[level]!;
    const scale = Math.min(1, cfg.width / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(video, 0, 0, width, height);
    lastSentAt = now;
    encoding = true;

    // Binary frame: 4-byte header (width, height) + raw JPEG. No base64.
    canvas.toBlob(
      (blob) => {
        encoding = false;
        if (!blob || stopped) return;
        const header = new ArrayBuffer(4);
        const view = new DataView(header);
        view.setUint16(0, width, true);
        view.setUint16(2, height, true);
        if (socket.sendBinary(new Blob([header, blob]))) sentTimes.push(performance.now());
      },
      "image/jpeg",
      cfg.quality,
    );
  };

  // Send on every new camera frame when the browser supports it; otherwise use a short timer.
  let timer: number | undefined;
  const loop = (): void => {
    if (stopped) return;
    sendFrame();
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(loop);
    } else {
      timer = window.setTimeout(loop, 20);
    }
  };
  loop();
  // Safety net: if the video callback ever stalls (e.g. after a camera restart), keep things moving.
  const watchdog = window.setInterval(sendFrame, 100);

  // ---------- keep the screen awake ----------

  let wakeLock: WakeLockSentinel | null = null;
  const requestWakeLock = async (): Promise<void> => {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      /* not supported or denied: fine */
    }
  };
  const onVisible = (): void => {
    if (document.visibilityState === "visible") void requestWakeLock();
  };
  document.addEventListener("visibilitychange", onVisible);
  void requestWakeLock();

  renderStatus();
  void startCamera();

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(watchdog);
    document.removeEventListener("visibilitychange", onVisible);
    void wakeLock?.release().catch(() => undefined);
    stream?.getTracks().forEach((t) => t.stop());
    socket.close();
  };
}