import QRCode from "qrcode";
import type {
  ApiError,
  InfoResponse,
  ScanResponse,
  ServerToDesktop,
} from "@deskcapade/shared";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { injectChallengeStyles } from "../lib/challengeStyles";
import { pickDeskObjects } from "../lib/deskFilter";
import {
  composeCoveredScene,
  composePixelWorldScene,
  makeDeskSprite,
  type DeskSprite,
} from "../lib/deskSprites";
import { playPixelTransition, type PixelTransition } from "../lib/pixelTransition";
import { connectSocket } from "../lib/socket";

const SNAP_WIDTH = 800; // the photo is scaled down to this width before it is sent
const SNAP_JPEG_QUALITY = 0.8;
const SCAN_TIMEOUT_MS = 20_000; // a bit longer than the server's own 15 s wait for Perceptron
/** If a scan is slow or the service is busy, try again with a smaller (faster) picture. */
const SCAN_ATTEMPT_WIDTHS = [SNAP_WIDTH, 640, 512];
/** Server error codes worth retrying: Perceptron was slow, busy, or unreachable. */
const RETRY_CODES = new Set(["TIMEOUT", "RATE_LIMITED", "NETWORK", "UPSTREAM_ERROR"]);
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

type Source = "laptop" | "phone";
type Screen = "source" | "camera" | "result";

const short = (s: string): string => (s.length > 34 ? `${s.slice(0, 33).trimEnd()}…` : s);

/**
 * Challenge mode: choose laptop or phone camera and snap a photo whenever you like. The desk
 * objects in it (not the background) are covered by cute pixel sprites right where they are;
 * the rest of the photo stays exactly as taken. No video is analysed here. The phone path reuses the same relay as the Story page,
 * but connects with scan=0 so the server doesn't scan continuously.
 */
export function mountChallenge(root: HTMLElement): () => void {
  injectGameStyles();
  injectChallengeStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.home}">◀ Home</a>
        <h1 class="gm-h1">Challenge</h1>

        <section id="sourceView">
          <p class="gm-note">Pick your camera, then snap your desk whenever you're ready. Everything on it turns pixel-cute!</p>
          <div class="gm-choices">
            <button class="gm-btn" id="pickLaptop" type="button"><b>Laptop camera</b><span>Use this computer's camera</span></button>
            <button class="gm-btn alt" id="pickPhone" type="button"><b>Phone camera</b><span>Use your phone as the camera</span></button>
          </div>
        </section>

        <section id="cameraView" hidden>
          <div class="gm-stage"><canvas id="view" width="1280" height="720"></canvas></div>
          <div class="gm-row">
            <button class="gm-btn small" id="snap" type="button" disabled>📸 Snap!</button>
            <button class="gm-btn small ghost" id="changeCam" type="button">Change camera</button>
            <span class="gm-chip" id="camStatus">Starting…</span>
          </div>
          <div class="gm-connect" id="connect" hidden>
            <img id="qr" alt="QR code that opens the phone camera page" width="160" height="160">
            <div>
              <p>Open this on your phone, then hold it sideways:</p>
              <div class="gm-url" id="phoneUrl">Looking for this laptop's address…</div>
            </div>
          </div>
        </section>

        <section id="resultView" hidden>
          <div class="gm-verdict" id="verdict"></div>
          <div class="ch-scene" id="scene"></div>
          <p class="ch-skipped" id="skipped" hidden></p>
          <div class="gm-row">
            <button class="gm-btn small" id="again" type="button">📸 Snap another</button>
            <button class="gm-btn small ghost" id="next" type="button">Change camera</button>
            <button class="gm-btn small ghost" id="bgToggle" type="button" aria-pressed="false">🌄 Pixel background: Off</button>
          </div>
          <div class="gm-shelf ch-shelf" id="shelf"></div>
        </section>

        <video id="video" class="hidden-video" autoplay muted playsinline></video>
        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>
  `;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const sourceView = q<HTMLElement>("#sourceView");
  const cameraView = q<HTMLElement>("#cameraView");
  const resultView = q<HTMLElement>("#resultView");
  const canvas = q<HTMLCanvasElement>("#view");
  const ctx = canvas.getContext("2d")!;
  const video = q<HTMLVideoElement>("#video");
  const snapBtn = q<HTMLButtonElement>("#snap");
  const camStatus = q<HTMLElement>("#camStatus");
  const connectEl = q<HTMLElement>("#connect");
  const qrImg = q<HTMLImageElement>("#qr");
  const phoneUrlEl = q<HTMLElement>("#phoneUrl");
  const verdictEl = q<HTMLElement>("#verdict");
  const sceneEl = q<HTMLElement>("#scene");
  const skippedEl = q<HTMLElement>("#skipped");
  const bgToggle = q<HTMLButtonElement>("#bgToggle");
  const shelfEl = q<HTMLElement>("#shelf");
  const toast = q<HTMLElement>("#toast");

  // ---------- state ----------

  let screen: Screen = "source";
  let source: Source | null = null;
  let stream: MediaStream | null = null;
  let socket: ReturnType<typeof connectSocket> | null = null;
  let frame: ImageBitmap | null = null;
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let busy = false;
  /** The photo just taken. While set, the preview shows it instead of the live camera. */
  let frozenShot: HTMLCanvasElement | null = null;
  /** Pixel background instead of the photo. Remembered between snaps. */
  let pixelBackground = false;
  let lastShot: HTMLCanvasElement | null = null;
  let lastSprites: DeskSprite[] = [];
  /** The photo -> pixel world animation, while it's playing. */
  let transition: PixelTransition | null = null;
  let stopped = false;
  let raf = 0;
  let toastTimer: number | undefined;
  let infoTimer: number | undefined;
  let infoPolls = 0;
  let shownUrl = "";

  // ---------- small helpers ----------

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 5000);
  };

  const setStatus = (text: string, on: boolean): void => {
    camStatus.textContent = text;
    camStatus.className = on ? "gm-chip on" : "gm-chip";
  };

  const render = (): void => {
    sourceView.hidden = screen !== "source";
    cameraView.hidden = screen !== "camera";
    resultView.hidden = screen !== "result";
  };

  const isReady = (): boolean =>
    source === "laptop" ? video.readyState >= 2 && video.videoWidth > 0 : frame !== null;

  // ---------- camera sources ----------

  const stopSources = (): void => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    socket?.close();
    socket = null;
    frame?.close();
    frame = null;
    pendingFrame = null;
    frozenShot = null;
    stopTransition();
    window.clearTimeout(infoTimer);
    infoPolls = 0;
    shownUrl = "";
  };

  const goSource = (): void => {
    stopSources();
    source = null;
    screen = "source";
    render();
  };

  const fail = (text: string): void => {
    showToast(text);
    goSource();
  };

  const startLaptop = async (): Promise<void> => {
    setStatus("Starting camera…", false);
    if (!navigator.mediaDevices?.getUserMedia) {
      fail("This browser can't open the camera on this page.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (stopped || source !== "laptop") {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;
      video.srcObject = media;
      await video.play().catch(() => undefined);
      setStatus("Laptop camera on", true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      fail(
        name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access, then try again."
          : "Could not start the camera. Close other apps using it and try again.",
      );
    }
  };

  /** Phone frames arrive as binary: 4-byte header (width, height), then a JPEG. */
  const decodeFrame = (buf: ArrayBuffer): void => {
    if (buf.byteLength <= FRAME_HEADER_BYTES) return;
    if (decoding) {
      pendingFrame = buf;
      return;
    }
    decoding = true;
    createImageBitmap(new Blob([buf.slice(FRAME_HEADER_BYTES)], { type: "image/jpeg" }))
      .then((bmp) => {
        if (stopped || source !== "phone") {
          bmp.close();
          return;
        }
        frame?.close();
        frame = bmp;
      })
      .catch(() => undefined)
      .finally(() => {
        decoding = false;
        if (pendingFrame && !stopped) {
          const next = pendingFrame;
          pendingFrame = null;
          decodeFrame(next);
        }
      });
  };

  const renderConnect = async (base: string): Promise<void> => {
    const url = `${base}/phone`;
    if (url === shownUrl) return;
    shownUrl = url;
    phoneUrlEl.textContent = url;
    try {
      qrImg.src = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    } catch {
      qrImg.removeAttribute("src");
    }
  };

  /** The tunnel can appear a few seconds after the server, so check a few times. */
  const loadInfo = async (): Promise<void> => {
    if (stopped || source !== "phone") return;
    try {
      const info = (await (await fetch("/api/info")).json()) as InfoResponse;
      const host = location.hostname;
      const opened = host !== "localhost" && host !== "127.0.0.1";
      const base = opened ? location.origin : (info.tunnelUrl ?? info.lanUrls[0] ?? "");
      if (base) await renderConnect(base);
      if (opened || info.tunnelUrl) return;
    } catch {
      phoneUrlEl.textContent = "Could not read this laptop's address. Is the server running?";
    }
    infoPolls += 1;
    if (infoPolls < 20) infoTimer = window.setTimeout(() => void loadInfo(), 3000);
  };

  const startPhone = (): void => {
    setStatus("Connecting…", false);
    connectEl.hidden = false;
    socket = connectSocket(
      "desktop",
      {
        onState: (s) => {
          if (s !== "open") {
            setStatus(s === "closed" ? "Server offline" : "Connecting…", false);
            connectEl.hidden = false;
          }
        },
        onBinary: decodeFrame,
        onMessage: (raw) => {
          let msg: ServerToDesktop;
          try {
            msg = JSON.parse(raw) as ServerToDesktop;
          } catch {
            return;
          }
          if (msg.type === "status") {
            connectEl.hidden = msg.phoneConnected;
            if (msg.phoneConnected) setStatus("Phone connected", true);
            else {
              frame?.close();
              frame = null;
              setStatus("Waiting for phone", false);
            }
          }
        },
      },
      { scan: false }, // single photo: the server must not scan the stream
    );
    void loadInfo();
  };

  const startSource = async (src: Source): Promise<void> => {
    stopSources();
    source = src;
    screen = "camera";
    connectEl.hidden = src !== "phone";
    render();
    if (src === "laptop") await startLaptop();
    else startPhone();
  };

  // ---------- preview drawing ----------

  const draw = (): void => {
    if (screen === "camera") {
      snapBtn.disabled = busy || !isReady();
      if (frozenShot) {
        // a photo was just taken: hold it on screen instead of the live camera
        if (canvas.width !== frozenShot.width || canvas.height !== frozenShot.height) {
          canvas.width = frozenShot.width;
          canvas.height = frozenShot.height;
        }
        ctx.drawImage(frozenShot, 0, 0);
      } else if (source === "laptop" && video.readyState >= 2 && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else if (source === "phone" && frame) {
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#120f20";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    if (!stopped) raf = requestAnimationFrame(draw);
  };

  // ---------- the one photo ----------

  const takeShot = (): HTMLCanvasElement | null => {
    const shot = document.createElement("canvas");
    const sctx = shot.getContext("2d")!;
    if (source === "laptop") {
      if (video.videoWidth === 0) return null;
      const scale = Math.min(1, SNAP_WIDTH / video.videoWidth);
      shot.width = Math.round(video.videoWidth * scale);
      shot.height = Math.round(video.videoHeight * scale);
      sctx.drawImage(video, 0, 0, shot.width, shot.height);
      return shot;
    }
    if (!frame) return null;
    shot.width = frame.width;
    shot.height = frame.height;
    sctx.drawImage(frame, 0, 0);
    return shot;
  };

  const stopTransition = (): void => {
    transition?.cancel();
    transition = null;
  };

  const renderBgToggle = (): void => {
    bgToggle.textContent = `🌄 Pixel background: ${pixelBackground ? "On" : "Off"}`;
    bgToggle.setAttribute("aria-pressed", String(pixelBackground));
  };

  /** Draw the result: the photo as taken with each object covered by its sprite, or the sprites on the pixel backdrop. */
  const renderScene = (): void => {
    stopTransition(); // e.g. the background toggle was clicked mid-animation: jump straight to that view
    renderBgToggle();
    if (!lastShot) return;
    sceneEl.replaceChildren(
      pixelBackground
        ? composePixelWorldScene(lastShot, lastSprites)
        : composeCoveredScene(lastShot, lastSprites),
    );
  };

  const showResult = (shot: HTMLCanvasElement, res: ScanResponse): void => {
    stopSources(); // camera and phone link are released while you look at the result

    const { kept, skipped } = pickDeskObjects(shot, res.objects, res.imageSize);
    const sprites = kept.map((c) => makeDeskSprite(c.label, shot, c.box));

    verdictEl.textContent =
      sprites.length > 0
        ? `Found ${sprites.length} desk thing${sprites.length === 1 ? "" : "s"}! ★`
        : "No desk things spotted. Try more light or move closer!";
    verdictEl.className = `gm-verdict ${sprites.length > 0 ? "win" : "lose"}`;

    lastShot = shot;
    lastSprites = sprites;
    if (sprites.length > 0) {
      // the real photo morphs into the pixel world (~4 s), ending with the pixel background on
      pixelBackground = true;
      renderBgToggle();
      const anim = playPixelTransition(shot, sprites);
      transition = anim;
      sceneEl.replaceChildren(anim.canvas);
      void anim.done.then(() => {
        if (transition === anim) transition = null;
      });
    } else {
      renderScene();
    }

    skippedEl.hidden = skipped.length === 0;
    skippedEl.textContent = `Ignored as background: ${skipped.map((c) => `${short(c.label)} (${c.reason})`).join(", ")}`;

    shelfEl.replaceChildren(
      ...sprites.map((sp) => {
        const item = document.createElement("div");
        item.className = "gm-item";
        sp.canvas.className = "gm-px";
        const caption = document.createElement("span");
        caption.textContent = short(sp.label);
        item.append(sp.canvas, caption);
        return item;
      }),
    );

    if (stopped) return;
    screen = "result";
    render();
  };

  /** A copy of `src` no wider than `maxWidth` (or `src` itself if it already fits). */
  const shrink = (src: HTMLCanvasElement, maxWidth: number): HTMLCanvasElement => {
    if (src.width <= maxWidth) return src;
    const out = document.createElement("canvas");
    out.width = maxWidth;
    out.height = Math.round((src.height * maxWidth) / src.width);
    const octx = out.getContext("2d")!;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(src, 0, 0, out.width, out.height);
    return out;
  };

  type ScanAttempt =
    | { kind: "ok"; res: ScanResponse }
    | { kind: "retry"; error: string; code: string }
    | { kind: "fail"; error: string };

  /** One request to the server. Slow / busy / network problems are worth retrying; anything else isn't. */
  const scanOnce = async (image: HTMLCanvasElement): Promise<ScanAttempt> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: image.toDataURL("image/jpeg", SNAP_JPEG_QUALITY),
          width: image.width,
          height: image.height,
        }),
        signal: controller.signal,
      });
      const body = (await res.json()) as ScanResponse | ApiError;
      if (body.ok) return { kind: "ok", res: body };
      const code = body.code ?? "";
      return RETRY_CODES.has(code) || res.status >= 500
        ? { kind: "retry", error: body.error, code }
        : { kind: "fail", error: body.error };
    } catch {
      // our own timeout, or the server didn't answer
      return { kind: "retry", error: "Could not scan that photo. Is the server running?", code: "NETWORK" };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

  const snap = async (): Promise<void> => {
    if (busy) return;
    const shot = takeShot();
    if (!shot) return;

    busy = true;
    frozenShot = shot;
    snapBtn.disabled = true;
    try {
      let last = "";
      for (let i = 0; i < SCAN_ATTEMPT_WIDTHS.length; i++) {
        snapBtn.textContent = i === 0 ? "Looking…" : `Still looking… (${i + 1}/${SCAN_ATTEMPT_WIDTHS.length})`;
        // later tries send a smaller picture, which Perceptron answers faster.
        // The boxes come back in that picture's size and are scaled back to the full photo.
        const attempt = await scanOnce(shrink(shot, SCAN_ATTEMPT_WIDTHS[i] ?? SNAP_WIDTH));
        if (stopped || frozenShot !== shot) return; // left the page or changed camera meanwhile
        if (attempt.kind === "ok") {
          showResult(shot, attempt.res);
          return;
        }
        last = attempt.error;
        if (attempt.kind === "fail") break;
        if (i < SCAN_ATTEMPT_WIDTHS.length - 1) await wait(attempt.code === "RATE_LIMITED" ? 2500 : 700);
        if (stopped || frozenShot !== shot) return;
      }
      frozenShot = null; // back to the live camera so you can try again
      showToast(last || "Could not scan that photo. Try again!");
    } finally {
      busy = false;
      snapBtn.textContent = "📸 Snap!";
    }
  };

  // ---------- buttons ----------

  q<HTMLButtonElement>("#pickLaptop").addEventListener("click", () => void startSource("laptop"));
  q<HTMLButtonElement>("#pickPhone").addEventListener("click", () => void startSource("phone"));
  q<HTMLButtonElement>("#changeCam").addEventListener("click", goSource);
  snapBtn.addEventListener("click", () => void snap());
  q<HTMLButtonElement>("#again").addEventListener("click", () => {
    if (source) void startSource(source);
    else goSource();
  });
  q<HTMLButtonElement>("#next").addEventListener("click", goSource);
  bgToggle.addEventListener("click", () => {
    pixelBackground = !pixelBackground;
    renderScene();
  });

  render();
  raf = requestAnimationFrame(draw);

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(toastTimer);
    stopSources();
  };
}