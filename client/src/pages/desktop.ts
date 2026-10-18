import QRCode from "qrcode";
import type { InfoResponse, ServerToDesktop } from "@deskcapade/shared";
import { ObjectTracker, renderDetectedText } from "../lib/detections";
import { connectSocket } from "../lib/socket";
import { injectStyles } from "../lib/styles";

const STALE_FRAME_MS = 2000;
const BASE_STORAGE_KEY = "deskcapade.phoneBase";
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

/**
 * Phone-camera page (opened on the laptop): shows the phone's video with detection boxes on top
 * and the "Detected: ..." text underneath. It never opens the laptop camera. Detection runs
 * automatically on the server (every 250 ms), so there are no scan controls here.
 */
export function mountDesktop(root: HTMLElement): () => void {
  injectStyles();

  root.innerHTML = `
    <div class="dc-page dcd">
      <div class="dc-stage dcd-stage">
        <canvas id="view" width="1280" height="720"></canvas>
      </div>

      <div class="dcd-info">
        <div class="dcd-top">
          <h1>Deskcapade</h1>
          <div class="dc-bar">
            <span class="dc-chip" id="phoneChip"><span class="dc-dot"></span><span id="phoneText">Connecting…</span></span>
            <span class="dc-chip" id="countChip">0 objects</span>
            <span class="dc-chip" id="latencyChip">– ms</span>
            <span class="dc-chip warn dc-hidden" id="mockChip">MOCK</span>
          </div>
        </div>

        <div class="detected-text" id="detected" hidden aria-live="polite"></div>

        <details class="dc-connect" id="connect" open>
          <summary>Connect your phone</summary>
          <div class="dc-connect-body">
            <img id="qr" alt="QR code that opens the phone camera page" width="180" height="180">
            <div class="dc-connect-fields">
              <div>
                <div style="color: var(--dc-dim); font-size: 0.85rem;">Open on your phone, then hold it sideways</div>
                <div class="dc-url" id="phoneUrl">Looking for this laptop's address…</div>
              </div>
              <label class="dc-hidden" id="lanLabel">Phone link source
                <select id="lanSelect"></select>
              </label>
              <label>Tunnel or custom address (optional)
                <input type="text" id="baseOverride" placeholder="https://something.trycloudflare.com" autocomplete="off">
              </label>
            </div>
          </div>
        </details>
      </div>

      <div class="dc-toast dc-hidden" id="toast" role="status"></div>
    </div>
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

  // ---------- state ----------

  const tracker = new ObjectTracker();
  let socketOpen = false;
  let phoneConnected = false;
  let frameImg: ImageBitmap | null = null;
  let lastFrameAt = 0;
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let latencyMs: number | null = null;
  let toastTimer: number | undefined;
  let stopped = false;
  let raf = 0;

  // ---------- small UI helpers ----------

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.classList.remove("dc-hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("dc-hidden"), 5000);
  };

  const renderChips = (): void => {
    if (!socketOpen) {
      phoneText.textContent = "Server offline";
      phoneChip.className = "dc-chip warn";
    } else if (phoneConnected) {
      phoneText.textContent = "Phone connected";
      phoneChip.className = "dc-chip on";
    } else {
      phoneText.textContent = "Waiting for phone";
      phoneChip.className = "dc-chip warn";
    }

    const count = tracker.count;
    countChip.textContent = `${count} object${count === 1 ? "" : "s"}`;
    countChip.className = count > 0 ? "dc-chip on" : "dc-chip";
    latencyChip.textContent = latencyMs === null ? "– ms" : `${latencyMs} ms`;
    renderDetectedText(detectedEl, tracker);
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
        tracker.clear();
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
          tracker.update(msg.objects, msg.imageSize);
          renderChips();
          break;
        case "status":
          phoneConnected = msg.phoneConnected;
          if (!phoneConnected) tracker.clear();
          mockChip.classList.toggle("dc-hidden", !msg.mock);
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
    } else {
      ctx.fillStyle = "#120f20";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (!hasFrame) {
      ctx.fillStyle = "rgba(18, 15, 32, 0.6)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    tracker.draw(ctx, canvas.width, canvas.height);
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
    lanLabel.classList.toggle("dc-hidden", sources.length < 2);
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