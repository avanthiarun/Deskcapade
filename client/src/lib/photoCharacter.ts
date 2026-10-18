import QRCode from "qrcode";
import type { ApiError, CharacterResponse, InfoResponse, ScanResponse, ServerToDesktop } from "@deskcapade/shared";
import { addCustomCharacter, buddyRows, type Character } from "../game/art";
import { colorsFromDominant, sampleDominantColor, type Rgb } from "./deskSprites";
import { connectSocket } from "./socket";

/* ------------------------------------------------------------------
   "Make a character from a photo": snap your stuffed pig (laptop or phone camera), Perceptron
   says what it is, and Gemini draws it as a pixel character in the game's style. Without the AI,
   you still get a round-eared buddy in the object's own colors.
   ------------------------------------------------------------------ */

const FRAME_HEADER_BYTES = 4;
const SNAP_WIDTH = 800;
/** Not the thing you're holding up: people, hands and the room. */
const NOT_IT = /\b(?:person|people|man|woman|boy|girl|child|hand|hands|finger|fingers|arm|arms|face|head|hair|shirt|wall|walls|desk|table|floor|room|background|ceiling|window|door|chair|couch|sofa|bed|curtain)\b/i;
/** Toy-ish words: these win when there are several things in the photo. */
const TOYISH = /\b(?:plush|plushie|stuffed|toy|teddy|doll|figure|figurine|animal|bear|bunny|rabbit|pig|cat|dog|duck|frog|penguin|dinosaur|unicorn|shark|fox|monkey|owl|elephant|lion|panda|puppet)\b/i;

const css = (c: Rgb): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** "light pink plush pig toy sitting..." -> "Pig" style short name from the label. */
function shortName(label: string): string {
  const animal = TOYISH.exec(label.replace(/\b(?:plush|plushie|stuffed|toy|figure|figurine|doll|animal)\b/gi, ""))?.[0];
  const word = animal ?? label.split(/[\s,]+/).find((w) => w.length > 2) ?? "Buddy";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Show the photo flow inside `host` (the picker's panel). Calls `onMade` with the new character,
 * or `onCancel` if you back out. Returns a cleanup function (stops cameras and sockets).
 */
export function openPhotoCharacter(host: HTMLElement, onMade: (c: Character) => void, onCancel: () => void): () => void {
  host.innerHTML = `
    <h2>Make a character from a photo</h2>
    <p>Hold up a stuffed animal or toy (or anything!) in front of a camera and snap it. It becomes a pixel character you can play as.</p>
    <div class="gm-photo-stage" id="pcStage">
      <div class="gm-stage-choices" id="pcChoose">
        <button class="gm-btn green" type="button" id="pcLaptop">💻 Laptop camera</button>
        <button class="gm-btn blue" type="button" id="pcPhone">📱 Phone camera</button>
      </div>
      <canvas id="pcView" width="640" height="360" hidden></canvas>
      <div class="gm-qr" id="pcQr" hidden>
        <img alt="QR code that opens the phone camera page" width="150" height="150">
        <div class="gm-url">Finding this laptop's address…</div>
        <p>Scan this with your phone, then hold it sideways and snap here or with the 📸 button on your phone.</p>
      </div>
      <div id="pcResult" hidden></div>
    </div>
    <div class="gm-modal-actions">
      <button class="gm-btn small" type="button" id="pcBack">← Back</button>
      <button class="gm-btn small green" type="button" id="pcSnap" hidden disabled>📸 Snap!</button>
    </div>
    <video class="hidden-video" autoplay muted playsinline></video>`;

  const q = <T extends HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
  const choose = q<HTMLElement>("#pcChoose");
  const view = q<HTMLCanvasElement>("#pcView");
  const vctx = view.getContext("2d")!;
  const qr = q<HTMLElement>("#pcQr");
  const result = q<HTMLElement>("#pcResult");
  const snapBtn = q<HTMLButtonElement>("#pcSnap");
  const video = host.querySelector<HTMLVideoElement>("video")!;

  let stream: MediaStream | null = null;
  let socket: ReturnType<typeof connectSocket> | null = null;
  let frame: ImageBitmap | null = null;
  let decoding = false;
  let source: "laptop" | "phone" | null = null;
  let busy = false;
  let stopped = false;
  let raf = 0;

  const stopCamera = (): void => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    socket?.close();
    socket = null;
    frame?.close();
    frame = null;
  };

  const ready = (): boolean => (source === "laptop" ? video.readyState >= 2 && video.videoWidth > 0 : frame !== null);

  const draw = (): void => {
    if (stopped) return;
    const img = source === "laptop" && ready() ? video : source === "phone" ? frame : null;
    if (img && !busy) {
      const w = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
      const h = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
      if (view.width !== w || view.height !== h) {
        view.width = w;
        view.height = h;
      }
      vctx.drawImage(img, 0, 0);
    }
    view.hidden = !img && source !== "laptop";
    qr.hidden = !(source === "phone" && !frame);
    snapBtn.disabled = busy || !ready();
    raf = requestAnimationFrame(draw);
  };

  const showResult = (html: string): void => {
    result.innerHTML = html;
    result.hidden = false;
    view.hidden = true;
    qr.hidden = true;
  };

  // ---------- the two cameras ----------

  const startLaptop = async (): Promise<void> => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (stopped) return stopCamera();
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    } catch {
      showResult(`<p>Couldn't open the camera. Allow camera access for this site and try again.</p>`);
    }
  };

  const startPhone = (): void => {
    socket = connectSocket(
      "desktop",
      {
        onState: () => undefined,
        onBinary: (buf) => {
          if (buf.byteLength <= FRAME_HEADER_BYTES || decoding) return;
          decoding = true;
          createImageBitmap(new Blob([buf.slice(FRAME_HEADER_BYTES)], { type: "image/jpeg" }))
            .then((bmp) => {
              if (stopped) return bmp.close();
              frame?.close();
              frame = bmp;
            })
            .catch(() => undefined)
            .finally(() => (decoding = false));
        },
        onMessage: (raw) => {
          try {
            const msg = JSON.parse(raw) as ServerToDesktop;
            if (msg.type === "snap" && !busy) void snap(); // the phone's 📸 button
          } catch {
            /* ignore */
          }
        },
      },
      { scan: false },
    );
    void (async () => {
      try {
        const info = (await (await fetch("/api/info")).json()) as InfoResponse;
        const opened = location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
        const base = opened ? location.origin : (info.tunnelUrl ?? info.lanUrls[0] ?? "");
        if (!base) return;
        qr.querySelector(".gm-url")!.textContent = `${base}/phone`;
        qr.querySelector("img")!.src = await QRCode.toDataURL(`${base}/phone`, { margin: 1, width: 320 });
      } catch {
        qr.querySelector(".gm-url")!.textContent = "Can't read this laptop's address. Is the game server running?";
      }
    })();
  };

  const pick = (src: "laptop" | "phone"): void => {
    source = src;
    choose.hidden = true;
    snapBtn.hidden = false;
    result.hidden = true;
    if (src === "laptop") void startLaptop();
    else startPhone();
  };

  // ---------- snap -> Perceptron -> Gemini ----------

  const snap = async (): Promise<void> => {
    const img = source === "laptop" ? video : frame;
    if (!img || busy || !ready()) return;
    busy = true;
    const w0 = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
    const h0 = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
    const k = Math.min(1, SNAP_WIDTH / w0);
    const shot = document.createElement("canvas");
    shot.width = Math.round(w0 * k);
    shot.height = Math.round(h0 * k);
    shot.getContext("2d")!.drawImage(img, 0, 0, shot.width, shot.height);
    showResult(`<p class="gm-photo-status">🔍 Looking at what you're holding…</p>`);

    try {
      // 1) Perceptron: what is it? (full descriptions: more accurate than the quick category scan)
      const scanRes = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: shot.toDataURL("image/jpeg", 0.85), width: shot.width, height: shot.height }),
      });
      const scan = (await scanRes.json()) as ScanResponse | ApiError;
      if (!scan.ok) throw new Error(scan.error);
      const sx = shot.width / scan.imageSize.w;
      const sy = shot.height / scan.imageSize.h;
      const candidates = scan.objects
        .filter((o) => o.label && !NOT_IT.test(o.label))
        .map((o) => ({ label: o.label!, box: { x: o.box.x * sx, y: o.box.y * sy, w: o.box.w * sx, h: o.box.h * sy } }))
        .sort((a, b) => b.box.w * b.box.h * (TOYISH.test(b.label) ? 2 : 1) - a.box.w * a.box.h * (TOYISH.test(a.label) ? 2 : 1));
      const it = candidates[0];
      if (!it) {
        busy = false;
        showResult(`<p>Couldn't spot anything there. Hold it closer, in good light, and snap again.</p>`);
        return;
      }

      // the object, with a little margin
      const pad = 0.1;
      const cx = Math.max(0, it.box.x - it.box.w * pad);
      const cy = Math.max(0, it.box.y - it.box.h * pad);
      const cw = Math.min(shot.width - cx, it.box.w * (1 + 2 * pad));
      const ch = Math.min(shot.height - cy, it.box.h * (1 + 2 * pad));
      const ck = Math.min(1, 384 / Math.max(cw, ch));
      const crop = document.createElement("canvas");
      crop.width = Math.max(1, Math.round(cw * ck));
      crop.height = Math.max(1, Math.round(ch * ck));
      crop.getContext("2d")!.drawImage(shot, cx, cy, cw, ch, 0, 0, crop.width, crop.height);
      showResult(`<p class="gm-photo-status">✏️ That's a <b>${shortName(it.label).toLowerCase()}</b>! Drawing your character…</p>`);

      // 2) Gemini: draw it as a pixel character
      let made: Character | null = null;
      try {
        const res = await fetch("/api/character", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: it.label, image: crop.toDataURL("image/jpeg", 0.85) }),
        });
        const drawn = (await res.json()) as CharacterResponse | ApiError;
        if (drawn.ok) made = addCustomCharacter(drawn.name || shortName(it.label), drawn.rows, drawn.colors);
      } catch {
        /* no AI right now: the fallback below */
      }
      if (!made) {
        // fallback: a round-eared buddy in the object's own colors
        const col = colorsFromDominant(sampleDominantColor(crop, { x: 0, y: 0, w: crop.width, h: crop.height }));
        made = addCustomCharacter(shortName(it.label), buddyRows(), { b: css(col.body), h: css(col.highlight), d: css(col.shade) });
      }
      stopCamera();
      busy = false;
      if (!made) {
        showResult(`<p>Hmm, that drawing didn't work out. Try snapping again!</p>`);
        return;
      }
      const character = made;
      showResult(`
        <div class="gm-photo-made">
          <canvas class="gm-bob" data-art="char:${character.id}" aria-hidden="true"></canvas>
          <h3>Meet ${character.name}!</h3>
          <div class="gm-stage-choices">
            <button class="gm-btn green small" type="button" data-use>▶ Play as ${character.name}</button>
            <button class="gm-btn small" type="button" data-retry>📸 Try again</button>
          </div>
        </div>`);
      snapBtn.hidden = true;
      result.dispatchEvent(new CustomEvent("paint", { bubbles: true }));
      result.querySelector("[data-use]")!.addEventListener("click", () => onMade(character));
      result.querySelector("[data-retry]")!.addEventListener("click", () => {
        result.hidden = true;
        snapBtn.hidden = false;
        if (source) pick(source);
      });
    } catch (err) {
      busy = false;
      showResult(`<p>Couldn't read that photo (${err instanceof Error ? err.message : "error"}). Try again!</p>`);
    }
  };

  q<HTMLButtonElement>("#pcLaptop").addEventListener("click", () => pick("laptop"));
  q<HTMLButtonElement>("#pcPhone").addEventListener("click", () => pick("phone"));
  q<HTMLButtonElement>("#pcBack").addEventListener("click", onCancel);
  snapBtn.addEventListener("click", () => void snap());
  raf = requestAnimationFrame(draw);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stopCamera();
  };
}
