import QRCode from "qrcode";
import type {
  ApiError,
  InfoResponse,
  ScanResponse,
  ServerToDesktop,
} from "@deskcapade/shared";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { spriteNodeFor } from "../lib/sprites";
import { connectSocket } from "../lib/socket";

const SNAP_WIDTH = 800; // the photo is scaled down to this width before it is sent
const SNAP_JPEG_QUALITY = 0.8;
const SCAN_TIMEOUT_MS = 20_000;
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

/** A goal is met when any detected label contains one of these words. Edit freely. */
const OBJECTIVES = [
  { text: "Find something you drink from", words: ["mug", "cup", "glass", "bottle"] },
  { text: "Find something you read", words: ["book", "notebook", "magazine", "paper"] },
  { text: "Find a plant", words: ["plant", "flower", "leaf", "leaves"] },
  { text: "Find a phone", words: ["phone", "smartphone"] },
  { text: "Find something to type on", words: ["keyboard", "laptop"] },
  { text: "Find a friendly face", words: ["person", "face", "man", "woman"] },
];

type Objective = (typeof OBJECTIVES)[number];
type Source = "laptop" | "phone";
type Screen = "source" | "camera" | "result";

const pickObjective = (prev?: Objective): Objective => {
  const pool = OBJECTIVES.filter((o) => o !== prev);
  return pool[Math.floor(Math.random() * pool.length)]!;
};

const short = (s: string): string => (s.length > 34 ? `${s.slice(0, 33).trimEnd()}…` : s);

/**
 * Challenge mode: choose laptop or phone camera, take ONE photo, and see what was found as
 * pixel art. No video is analysed here. The phone path reuses the same relay as the Story page,
 * but connects with scan=0 so the server doesn't scan continuously.
 */
export function mountChallenge(root: HTMLElement): () => void {
  injectGameStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.home}">◀ Home</a>
        <h1 class="gm-h1">Challenge</h1>
        <p class="gm-goal" id="goal"></p>

        <section id="sourceView">
          <p class="gm-note">Pick your camera. You get one photo per try.</p>
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
          <div class="gm-result">
            <div class="gm-photo" id="photo"></div>
            <div class="gm-shelf" id="shelf"></div>
          </div>
          <div class="gm-row">
            <button class="gm-btn small" id="again" type="button">Try again</button>
            <button class="gm-btn small ghost" id="next" type="button">New goal</button>
          </div>
        </section>

        <video id="video" class="hidden-video" autoplay muted playsinline></video>
        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>
  `;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const goalEl = q<HTMLElement>("#goal");
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
  const photoEl = q<HTMLElement>("#photo");
  const shelfEl = q<HTMLElement>("#shelf");
  const toast = q<HTMLElement>("#toast");

  // ---------- state ----------

  let screen: Screen = "source";
  let source: Source | null = null;
  let objective = pickObjective();
  let stream: MediaStream | null = null;
  let socket: ReturnType<typeof connectSocket> | null = null;
  let frame: ImageBitmap | null = null;
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let busy = false;
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

  const renderGoal = (): void => {
    goalEl.textContent = `Goal: ${objective.text}`;
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
      if (source === "laptop" && video.readyState >= 2 && video.videoWidth > 0) {
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

  const found = (labels: string[]): boolean =>
    labels.some((label) =>
      objective.words.some((w) => new RegExp(`\\b${w}s?\\b`, "i").test(label)),
    );

  const showResult = async (shot: HTMLCanvasElement, res: ScanResponse): Promise<void> => {
    stopSources(); // one photo only: camera and phone link are released
    const labels = res.objects.map((o) => o.label ?? "object");
    const won = found(labels);
    verdictEl.textContent = won ? "You found it! ★" : "Not quite… try again!";
    verdictEl.className = `gm-verdict ${won ? "win" : "lose"}`;

    shot.removeAttribute("class");
    photoEl.replaceChildren(shot);

    shelfEl.replaceChildren();
    if (res.objects.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gm-empty";
      empty.textContent = "Nothing spotted. Try more light or move closer!";
      shelfEl.append(empty);
    } else {
      const nodes = await Promise.all(
        res.objects.map((o) => spriteNodeFor(o.label ?? "object", shot, o.box)),
      );
      res.objects.forEach((o, i) => {
        const item = document.createElement("div");
        item.className = "gm-item";
        const caption = document.createElement("span");
        caption.textContent = short(o.label ?? "object");
        item.append(nodes[i]!, caption);
        shelfEl.append(item);
      });
    }

    if (stopped) return;
    screen = "result";
    render();
  };

  const snap = async (): Promise<void> => {
    if (busy) return;
    const shot = takeShot();
    if (!shot) return;

    busy = true;
    snapBtn.disabled = true;
    snapBtn.textContent = "Looking…";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: shot.toDataURL("image/jpeg", SNAP_JPEG_QUALITY),
          width: shot.width,
          height: shot.height,
        }),
        signal: controller.signal,
      });
      const body = (await res.json()) as ScanResponse | ApiError;
      if (stopped) return;
      if (!body.ok) {
        showToast(body.error);
        return;
      }
      await showResult(shot, body);
    } catch {
      if (!stopped) showToast("Could not scan that photo. Is the server running?");
    } finally {
      window.clearTimeout(timeout);
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
  q<HTMLButtonElement>("#next").addEventListener("click", () => {
    objective = pickObjective(objective);
    renderGoal();
    goSource();
  });

  renderGoal();
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