import QRCode from "qrcode";
import type {
  Box,
  DesktopToServer,
  InfoResponse,
  ScanResultMessage,
  ServerToDesktop,
} from "@deskcapade/shared";
import { connectSocket } from "../lib/socket";
import { injectStyles } from "../lib/styles";

const STALE_FRAME_MS = 2000;
const SCAN_TIMEOUT_MS = 20_000;
const BASE_STORAGE_KEY = "deskcapade.phoneBase";
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

// Object tracking: an object stays on screen until it is missed on this many scans in a row.
const MISS_LIMIT = 3;
const SMOOTHING = 0.35; // 0..1, higher = box snaps to new position faster

/** A detected object that persists between scans. Boxes are normalized (0..1). */
type Track = {
  id: number;
  label: string;
  target: Box;
  shown: Box;
  misses: number;
};

/**
 * Laptop page: shows the phone's video with detection boxes on top.
 * It never opens the laptop camera. Later, the game canvas and keyboard controls live here.
 */
export function mountDesktop(root: HTMLElement): () => void {
  injectStyles();

  root.innerHTML = `
    <div class="dc-page">
      <h1>Deskcapade</h1>
      <p>Live view from your phone camera.</p>

      <div class="dc-bar">
        <span class="dc-chip" id="phoneChip"><span class="dc-dot"></span><span id="phoneText">Connecting…</span></span>
        <span class="dc-chip" id="countChip">0 objects</span>
        <span class="dc-chip" id="latencyChip">– ms</span>
        <span class="dc-chip warn dc-hidden" id="mockChip">MOCK</span>
      </div>

      <div class="dc-bar">
        <button class="dc-btn" id="scan" type="button">Scan</button>
        <label class="dc-toggle"><input type="checkbox" id="auto"> Auto-scan</label>
        <select id="interval" aria-label="Auto-scan interval">
          <option value="1000">every 1.0 s</option>
          <option value="1500" selected>every 1.5 s</option>
          <option value="2500">every 2.5 s</option>
        </select>
      </div>

      <div class="dc-stage">
        <canvas id="view" width="800" height="450"></canvas>
        <div class="dc-banner dc-hidden" id="banner">Object detected!</div>
      </div>

      <div class="dc-bar" id="objList" aria-live="polite"></div>

      <details class="dc-connect" id="connect" open>
        <summary>Connect your phone</summary>
        <div class="dc-connect-body">
          <img id="qr" alt="QR code that opens the phone camera page" width="180" height="180">
          <div class="dc-connect-fields">
            <div>
              <div style="color: var(--dc-dim); font-size: 0.85rem;">Open on your phone</div>
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
  const scanBtn = q<HTMLButtonElement>("#scan");
  const autoBox = q<HTMLInputElement>("#auto");
  const intervalSel = q<HTMLSelectElement>("#interval");
  const banner = q<HTMLElement>("#banner");
  const objList = q<HTMLElement>("#objList");
  const toast = q<HTMLElement>("#toast");
  const connect = q<HTMLDetailsElement>("#connect");
  const qrImg = q<HTMLImageElement>("#qr");
  const phoneUrlEl = q<HTMLElement>("#phoneUrl");
  const lanLabel = q<HTMLElement>("#lanLabel");
  const lanSelect = q<HTMLSelectElement>("#lanSelect");
  const baseOverride = q<HTMLInputElement>("#baseOverride");

  // ---------- state ----------

  let socketOpen = false;
  let phoneConnected = false;
  let frameImg: ImageBitmap | null = null;
  let lastFrameAt = 0;
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let lastResult: ScanResultMessage | null = null;
  let scanTimeout: number | undefined;
  let toastTimer: number | undefined;
  let stopped = false;
  let raf = 0;

  let tracks: Track[] = [];
  let nextTrackId = 1;
  let listKey = "";

  // ---------- small UI helpers ----------

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.classList.remove("dc-hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("dc-hidden"), 5000);
  };

  const setScanning = (busy: boolean): void => {
    scanBtn.disabled = busy;
    scanBtn.textContent = busy ? "Scanning…" : "Scan";
    window.clearTimeout(scanTimeout);
    if (busy) scanTimeout = window.setTimeout(() => setScanning(false), SCAN_TIMEOUT_MS);
  };

  /** The always-visible list of what is currently on screen. */
  const renderObjects = (): void => {
    const labels = tracks.map((t) => t.label);
    const key = labels.join("|");
    if (key !== listKey) {
      listKey = key;
      objList.replaceChildren(
        ...labels.map((label) => {
          const chip = document.createElement("span");
          chip.className = "dc-chip on";
          chip.textContent = label;
          return chip;
        }),
      );
    }

    const count = tracks.length;
    countChip.textContent = `${count} object${count === 1 ? "" : "s"}`;
    countChip.className = count > 0 ? "dc-chip on" : "dc-chip";
    banner.textContent = count > 0 ? `Detected: ${[...new Set(labels)].join(", ")}` : "";
    banner.classList.toggle("dc-hidden", count === 0);
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
    latencyChip.textContent = lastResult ? `${lastResult.latencyMs} ms` : "– ms";
    renderObjects();
  };

  // ---------- object tracking ----------

  const toNorm = (b: Box, s: { w: number; h: number }): Box => ({
    x: b.x / s.w,
    y: b.y / s.h,
    w: b.w / s.w,
    h: b.h / s.h,
  });

  const iou = (a: Box, b: Box): number => {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  };

  /** Match new detections to existing objects; drop an object only after several misses. */
  const updateTracks = (res: ScanResultMessage): void => {
    const matched = new Set<Track>();

    for (const obj of res.objects) {
      const box = toNorm(obj.box, res.imageSize);
      const label = obj.label ?? "object";

      let best: Track | null = null;
      let bestScore = 0;
      for (const t of tracks) {
        if (matched.has(t)) continue;
        const overlap = iou(t.target, box);
        const sameLabel = t.label.toLowerCase() === label.toLowerCase();
        if (overlap < 0.2 || (!sameLabel && overlap < 0.6)) continue;
        const score = overlap + (sameLabel ? 0.3 : 0);
        if (score > bestScore) {
          best = t;
          bestScore = score;
        }
      }

      if (best) {
        best.target = box;
        best.label = label;
        best.misses = 0;
        matched.add(best);
      } else {
        const t: Track = { id: nextTrackId++, label, target: box, shown: { ...box }, misses: 0 };
        tracks.push(t);
        matched.add(t);
      }
    }

    for (const t of tracks) if (!matched.has(t)) t.misses += 1;
    tracks = tracks.filter((t) => t.misses < MISS_LIMIT);
  };

  // ---------- websocket ----------

  const send = (msg: DesktopToServer): boolean => {
    const ok = socket.send(msg);
    if (!ok) showToast("Not connected to the server yet.");
    return ok;
  };

  const sendAutoscan = (): void => {
    send({ type: "autoscan", enabled: autoBox.checked, intervalMs: Number(intervalSel.value) });
  };

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
        tracks = [];
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
          lastResult = msg;
          updateTracks(msg);
          setScanning(false);
          renderChips();
          break;
        case "status":
          phoneConnected = msg.phoneConnected;
          if (!phoneConnected) tracks = [];
          autoBox.checked = msg.autoscan;
          mockChip.classList.toggle("dc-hidden", !msg.mock);
          connect.open = !phoneConnected;
          renderChips();
          break;
        case "error":
          setScanning(false);
          showToast(msg.error);
          break;
        default:
          break;
      }
    },
  });

  scanBtn.addEventListener("click", () => {
    if (send({ type: "scan" })) setScanning(true);
  });
  autoBox.addEventListener("change", sendAutoscan);
  intervalSel.addEventListener("change", sendAutoscan);

  // ---------- drawing ----------

  const drawLabel = (text: string, x: number, y: number): void => {
    ctx.font = "600 16px system-ui, sans-serif";
    const padX = 8;
    const w = ctx.measureText(text).width + padX * 2;
    const top = Math.max(0, y - 26);
    ctx.fillStyle = "#ffb870";
    ctx.fillRect(x, top, w, 24);
    ctx.fillStyle = "#2a1c0a";
    ctx.textBaseline = "middle";
    ctx.textAlign = "start";
    ctx.fillText(text, x + padX, top + 12);
  };

  const drawBoxes = (): void => {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffb870";
    for (const t of tracks) {
      // glide the drawn box toward the latest detection so it doesn't jump
      t.shown.x += (t.target.x - t.shown.x) * SMOOTHING;
      t.shown.y += (t.target.y - t.shown.y) * SMOOTHING;
      t.shown.w += (t.target.w - t.shown.w) * SMOOTHING;
      t.shown.h += (t.target.h - t.shown.h) * SMOOTHING;

      const x = t.shown.x * canvas.width;
      const y = t.shown.y * canvas.height;
      const w = t.shown.w * canvas.width;
      const h = t.shown.h * canvas.height;

      ctx.globalAlpha = t.misses > 0 ? 0.55 : 1; // fades slightly while it might be leaving
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 6);
      else ctx.rect(x, y, w, h);
      ctx.stroke();
      ctx.globalAlpha = t.misses > 0 ? 0.55 : 1;
      drawLabel(t.label, x, y);
    }
    ctx.restore();
  };

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
      ctx.fillStyle = "#fbf3e8";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for phone…", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "start";
    }

    drawBoxes();
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
    window.clearTimeout(scanTimeout);
    window.clearTimeout(toastTimer);
    window.clearTimeout(infoTimer);
    frameImg?.close();
    frameImg = null;
    socket.close();
  };
}