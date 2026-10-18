import QRCode from "qrcode";
import type { DesktopToServer, InfoResponse, ServerToDesktop } from "@deskcapade/shared";
import { StoryGame } from "../game/storyGame";
import { LiveSpriteLayer } from "../lib/liveSprites";
import { matchInBackground, onMatched } from "../lib/matchObjects";
import { injectGameStyles } from "../lib/gameStyles";
import { connectSocket } from "../lib/socket";
import { bindStoryUi, storyLayoutHTML } from "./storyLayout";

const STALE_FRAME_MS = 2000;
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG

const CONNECT_PANEL = `
  <section class="gm-panel">
    <h3>PHONE CAMERA</h3>
    <div class="gm-qr">
      <img id="qr" alt="QR code that opens the phone camera page" width="150" height="150">
      <div class="gm-url" id="phoneUrl">Finding this laptop's address…</div>
      <p id="phoneStatus">Waiting for your phone…</p>
    </div>
  </section>`;

const WAITING_MSG = `
  <h2>📷 Connect your phone camera</h2>
  <p>Scan the QR code with your phone, allow camera access, then prop it up looking at your desk (hold it sideways).
    Whatever it sees becomes your world.</p>`;

/**
 * Story with the phone as the camera (this page runs on the laptop): the phone's live video
 * becomes the garden world. Detection runs on the server, about every 250 ms.
 */
export function mountDesktop(root: HTMLElement): () => void {
  injectGameStyles();
  root.innerHTML = storyLayoutHTML(CONNECT_PANEL);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const canvas = q<HTMLCanvasElement>("#view");
  const ctx = canvas.getContext("2d")!;
  const qrImg = q<HTMLImageElement>("#qr");
  const phoneUrlEl = q<HTMLElement>("#phoneUrl");
  const phoneStatus = q<HTMLElement>("#phoneStatus");

  const layer = new LiveSpriteLayer();
  const story = new StoryGame(layer);
  // the phone shows a Freeze button too: tell the server whenever the desk freezes or unfreezes
  const ui = bindStoryUi(root, story, layer, (frozen) => socket.send({ type: "frozen", frozen } satisfies DesktopToServer));
  const stopMatching = onMatched(() => layer.refreshSprites());
  let socketOpen = false;
  let phoneConnected = false;
  let frameImg: ImageBitmap | null = null;
  let lastFrameAt = 0;
  let freshFrame = false; // a new phone frame arrived since the last draw
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let infoTimer: number | undefined;
  let infoPolls = 0;
  let shownUrl = "";
  let stopped = false;
  let raf = 0;

  const renderStatus = (): void => {
    phoneStatus.textContent = !socketOpen ? "Can't reach the game server." : phoneConnected ? "✔ Phone connected!" : "Waiting for your phone…";
    ui.showMessage(phoneConnected ? null : socketOpen ? WAITING_MSG : `<h2>Game server offline</h2><p>Start it on this laptop, then reload.</p>`);
  };

  // ---------- websocket ----------

  /** Frames arrive as binary: 4-byte header (width, height), then a JPEG. Only the newest waiting frame is kept. */
  const decodeFrame = (buf: ArrayBuffer): void => {
    if (buf.byteLength <= FRAME_HEADER_BYTES) return;
    if (ui.isFrozen()) {
      lastFrameAt = performance.now(); // frozen on purpose: don't dim the held picture
      return;
    }
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
      if (socketOpen && ui.isFrozen()) socket.send({ type: "frozen", frozen: true } satisfies DesktopToServer); // after a reconnect
      if (!socketOpen) {
        phoneConnected = false;
        layer.clear();
      }
      renderStatus();
    },
    onBinary: decodeFrame,
    onMessage: (raw) => {
      let msg: ServerToDesktop;
      try {
        msg = JSON.parse(raw) as ServerToDesktop;
      } catch {
        return;
      }
      if (msg.type === "scanResult") {
        if (ui.isFrozen()) return; // the desk is frozen: keep the pieces as they are
        // the server scanned a frame from about `latencyMs` ago: place boxes where the picture was then
        layer.update(msg.objects, msg.imageSize, layer.motion.at(performance.now() - msg.latencyMs - 60));
        matchInBackground(msg.objects.map((o) => o.label ?? "")); // unlisted things take the shape of the closest listed one
      } else if (msg.type === "status") {
        phoneConnected = msg.phoneConnected;
        if (!phoneConnected) layer.clear();
        renderStatus();
      } else if (msg.type === "freeze") {
        ui.toggleFreeze(); // the Freeze button on the phone
      } else if (msg.type === "error") {
        ui.toast(`The desk spotter hiccuped: ${msg.error}`);
      }
    },
  });

  // ---------- drawing ----------

  const draw = (): void => {
    const now = performance.now();
    if (frameImg) {
      if (frameImg.width > 0 && (canvas.width !== frameImg.width || canvas.height !== frameImg.height)) {
        canvas.width = frameImg.width;
        canvas.height = frameImg.height;
      }
      ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);
      layer.frame(ctx, freshFrame && !ui.isFrozen(), now);
      freshFrame = false;
    } else {
      ctx.fillStyle = "#1d140b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    layer.draw(ctx, now);
    story.frame(ctx, now);
    if (frameImg && now - lastFrameAt > STALE_FRAME_MS) {
      ctx.fillStyle = "rgba(29, 20, 11, 0.6)"; // the phone stopped sending: dim the old picture
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ui.refresh();
    if (!stopped) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  // ---------- QR code: the address the phone should open ----------

  const showUrl = async (base: string): Promise<void> => {
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

  /** Opened through a tunnel or LAN address already? Use it. Else the tunnel (any network), else same Wi-Fi. */
  const loadInfo = async (): Promise<void> => {
    if (stopped) return;
    const host = location.hostname;
    const opened = host !== "localhost" && host !== "127.0.0.1";
    try {
      const info = (await (await fetch("/api/info")).json()) as InfoResponse;
      const base = opened ? location.origin : (info.tunnelUrl ?? info.lanUrls[0] ?? "");
      if (base) await showUrl(base);
      if (opened || info.tunnelUrl) return;
    } catch {
      phoneUrlEl.textContent = "Can't read this laptop's address. Is the game server running?";
    }
    infoPolls += 1;
    if (infoPolls < 40) infoTimer = window.setTimeout(() => void loadInfo(), 3000); // the tunnel can take a few seconds
  };

  renderStatus();
  void loadInfo();

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(infoTimer);
    story.dispose();
    ui.dispose();
    stopMatching();
    frameImg?.close();
    frameImg = null;
    socket.close();
  };
}
