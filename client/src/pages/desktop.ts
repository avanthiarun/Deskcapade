import QRCode from "qrcode";
import type { InfoResponse, ServerToDesktop } from "@deskcapade/shared";
import { LiveSpriteLayer, renderLiveDetectedText } from "../lib/liveSprites";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { connectSocket } from "../lib/socket";
import { injectStoryStyles } from "../lib/storyStyles";

const STALE_FRAME_MS = 2000;
const BASE_STORAGE_KEY = "deskcapade.phoneBase";
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

/**
 * Phone-camera page (opened on the laptop): shows the phone's video with every desk object
 * covered by its pixel sprite (sprites follow the picture as the phone moves), and the
 * "Detected: ..." text underneath. "Pixel world" swaps the video for the pixel backdrop. It never opens the laptop camera. Detection runs
 * automatically on the server (every 250 ms), so there are no scan controls here.
 */
export function mountDesktop(root: HTMLElement): () => void {
  injectGameStyles();
  injectStoryStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.story}">◀ Story</a>
        <h1 class="gm-h1">Story</h1>
        <div class="gm-stage"><canvas id="view" width="1280" height="720"></canvas></div>
        <div class="gm-row">
          <span class="gm-chip" id="phoneChip"><span id="phoneText">Connecting…</span></span>
          <span class="gm-chip" id="countChip">0 objects</span>
          <span class="gm-chip" id="latencyChip">– ms</span>
          <span class="gm-chip warn" id="mockChip" hidden>MOCK</span>
          <button class="gm-btn small ghost" id="pixelToggle" type="button" aria-pressed="false">🌄 Pixel world: Off</button>
        </div>

        <p class="st-detected" id="detected" hidden aria-live="polite"></p>

        <details class="st-connect" id="connect" open>
          <summary>Connect your phone</summary>
          <div class="st-connect-body">
            <img id="qr" alt="QR code that opens the phone camera page" width="160" height="160">
            <div class="st-fields">
              <div>
                <p>Open this on your phone, then hold it sideways:</p>
                <div class="gm-url" id="phoneUrl">Looking for this laptop's address…</div>
              </div>
              <label id="lanLabel" hidden>Phone link source
                <select id="lanSelect"></select>
              </label>
              <label>Tunnel or custom address (optional)
                <input type="text" id="baseOverride" placeholder="https://something.trycloudflare.com" autocomplete="off">
              </label>
            </div>
          </div>
        </details>

        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>
  `;

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>("#view");
  const ctx = canvas.getContext("2d")!;
  const phoneChip = q<HTMLElement>("#phoneChip");
  const phoneText = q<HTMLElement>("#phoneText");
  const countChip = q<HTMLElement>("#countChip");
  const latencyChip = q<HTMLElement>("#latencyChip");
  const mockChip = q<HTMLElement>("#mockChip");
  const detectedEl = q<HTMLElement>("#detected");
  const toast = q<HTMLElement>("#toast");
  const connect = q<HTMLDetailsElement>("#connect");
  const qrImg = q<HTMLImageElement>("#qr");
  const phoneUrlEl = q<HTMLElement>("#phoneUrl");
  const lanLabel = q<HTMLElement>("#lanLabel");
  const lanSelect = q<HTMLSelectElement>("#lanSelect");
  const baseOverride = q<HTMLInputElement>("#baseOverride");
  const pixelToggle = q<HTMLButtonElement>("#pixelToggle");

  // ---------- state ----------

  const layer = new LiveSpriteLayer();
  let socketOpen = false;
  let phoneConnected = false;
  let frameImg: ImageBitmap | null = null;
  let lastFrameAt = 0;
  let freshFrame = false; // a new phone frame arrived since the last draw
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let latencyMs: number | null = null;
  let toastTimer: number | undefined;
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


  const renderChips = (): void => {
    if (!socketOpen) {
      phoneText.textContent = "Server offline";
      phoneChip.className = "gm-chip warn";
    } else if (phoneConnected) {
      phoneText.textContent = "Phone connected";
      phoneChip.className = "gm-chip on";
    } else {
      phoneText.textContent = "Waiting for phone";
      phoneChip.className = "gm-chip warn";
    }

    const count = layer.count;
    countChip.textContent = `${count} object${count === 1 ? "" : "s"}`;
    countChip.className = count > 0 ? "gm-chip on" : "gm-chip";
    latencyChip.textContent = latencyMs === null ? "– ms" : `${latencyMs} ms`;
    renderLiveDetectedText(detectedEl, layer);
    renderToggle();
  };

  // ---------- websocket ----------

  /**
   * Frames arrive as binary: 4-byte header (width, height), then a JPEG.
   * Decoded off the main thread; if one is decoding, only the newest waiting frame is kept.
   */
  const decodeFrame = (buf: ArrayBuffer): void => {
    if (buf.byteLength <= FRAME_HEADER_BYTES) return;
    if (decoding) {
      pendingFrame = buf;
      return;
    }
    decoding = true;
    createImageBitmap(new Blob([buf.slice(FRAME_HEADER_BYTES)], { type: "image/jpeg" }))
      .then((bmp) => {
        if (stopped) {
          bmp.close();
          return;
        }
        frameImg?.close();
        frameImg = bmp;
        lastFrameAt = performance.now();
        freshFrame = true;
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

  const socket = connectSocket("desktop", {
    onState: (s) => {
      socketOpen = s === "open";
      if (!socketOpen) {
        phoneConnected = false;
        layer.clear();
      }
      renderChips();
    },
    onBinary: decodeFrame,
    onMessage: (raw) => {
      let msg: ServerToDesktop;
      try {
        msg = JSON.parse(raw) as ServerToDesktop;
      } catch {
        return;
      }
      switch (msg.type) {
        case "scanResult":
          latencyMs = msg.latencyMs;
          // the server scanned a frame from about `latencyMs` ago: place boxes where the picture was then
          layer.update(msg.objects, msg.imageSize, layer.motion.at(performance.now() - msg.latencyMs - 60));
          break;
        case "status":
          phoneConnected = msg.phoneConnected;
          if (!phoneConnected) layer.clear();
          mockChip.hidden = !msg.mock;
          connect.open = !phoneConnected;
          renderChips();
          break;
        case "error":
          showToast(msg.error);
          break;
        default:
          break;
      }
    },
  });

  // ---------- drawing ----------

  const draw = (): void => {
    const now = performance.now();
    const hasFrame = frameImg !== null && now - lastFrameAt < STALE_FRAME_MS;

    if (frameImg) {
      const w = frameImg.width;
      const h = frameImg.height;
      if (w > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
      if (layer.frame(ctx, freshFrame, now)) renderChips();
      freshFrame = false;
    } else {
      ctx.fillStyle = "#120f20";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    layer.draw(ctx, now);

    if (!hasFrame) {
      ctx.fillStyle = "rgba(18, 15, 32, 0.6)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!stopped) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // ---------- connect panel (QR + URL) ----------

  type Source = { label: string; url: string };
  let sources: Source[] = [];
  let userPicked = false;
  let infoTimer: number | undefined;
  let infoPolls = 0;

  const normalizeBase = (value: string): string => {
    let v = value.trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return v.replace(/\/+$/, "").replace(/\/phone$/i, "").replace(/\/+$/, "");
  };

  const defaultBase = (): string => {
    const host = location.hostname;
    // Opened through a tunnel or a LAN address already: that address works for the phone too.
    if (host !== "localhost" && host !== "127.0.0.1") return location.origin;
    return sources[Number(lanSelect.value) || 0]?.url ?? "";
  };

  const renderConnect = async (): Promise<void> => {
    const base = normalizeBase(baseOverride.value) || defaultBase();
    if (!base) {
      phoneUrlEl.textContent = "Looking for this laptop's address…";
      qrImg.removeAttribute("src");
      return;
    }
    const url = `${base}/phone`;
    phoneUrlEl.textContent = url;
    try {
      qrImg.src = await QRCode.toDataURL(url, { margin: 1, width: 360 });
    } catch {
      qrImg.removeAttribute("src");
    }
  };

  /** Tunnel first (works on any network), then same-Wi-Fi addresses. */
  const applyInfo = (info: InfoResponse): void => {
    const next: Source[] = [];
    if (info.tunnelUrl) {
      next.push({ label: `Tunnel (any network): ${info.tunnelUrl}`, url: info.tunnelUrl });
    }
    for (const u of info.lanUrls) next.push({ label: `Same Wi-Fi: ${u}`, url: u });

    if (JSON.stringify(next) === JSON.stringify(sources)) return;
    const previous = sources[Number(lanSelect.value)]?.url;
    sources = next;

    lanSelect.innerHTML = "";
    sources.forEach((src, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = src.label;
      lanSelect.appendChild(opt);
    });

    // Keep the person's own choice; otherwise use the first entry (the tunnel, once it exists).
    const keep = userPicked ? sources.findIndex((src) => src.url === previous) : -1;
    lanSelect.value = String(keep >= 0 ? keep : 0);
    lanLabel.hidden = sources.length < 2;
    void renderConnect();
  };

  /** The tunnel can start a few seconds after the server, so keep checking for a while. */
  const loadInfo = async (): Promise<void> => {
    try {
      const res = await fetch("/api/info");
      const info = (await res.json()) as InfoResponse;
      applyInfo(info);
      if (info.tunnelUrl) return;
    } catch {
      if (sources.length === 0) {
        phoneUrlEl.textContent = "Could not read this laptop's address. Is the server running?";
      }
    }
    infoPolls += 1;
    if (!stopped && infoPolls < 40) infoTimer = window.setTimeout(() => void loadInfo(), 3000);
  };

  try {
    baseOverride.value = localStorage.getItem(BASE_STORAGE_KEY) ?? "";
  } catch {
    /* storage unavailable: fine */
  }
  baseOverride.addEventListener("input", () => {
    try {
      localStorage.setItem(BASE_STORAGE_KEY, baseOverride.value);
    } catch {
      /* ignore */
    }
    void renderConnect();
  });
  pixelToggle.addEventListener("click", () => {
    layer.setPixelWorld(!layer.pixelWorld);
    renderToggle();
  });
  lanSelect.addEventListener("change", () => {
    userPicked = true;
    void renderConnect();
  });

  void loadInfo();
  void renderConnect();
  renderChips();

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(toastTimer);
    window.clearTimeout(infoTimer);
    frameImg?.close();
    frameImg = null;
    socket.close();
  };
}