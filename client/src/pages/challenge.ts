import QRCode from "qrcode";
import type {
  ApiError,
  CourseResponse,
  Difficulty,
  InfoResponse,
  ScanResponse,
  ServerToDesktop,
} from "@deskcapade/shared";
import type { Course } from "../game/course";
import { sceneZoom } from "../game/level";
import { Platformer } from "../game/platformer";
import { artPixelSize } from "../lib/artPixel";
import { pickDeskObjects } from "../lib/deskFilter";
import { matchNow } from "../lib/matchObjects";
import { deskSceneScale, makeDeskSprite, type DeskSprite } from "../lib/deskSprites";
import { injectGameStyles } from "../lib/gameStyles";
import { drawPixelBackdrop } from "../lib/pixelBackdrop";
import { playPixelTransition, type PixelTransition } from "../lib/pixelTransition";
import { ROUTES } from "../lib/routes";
import { addPoints, bindAbout, formatTime, getPoints, paintArt, pauseOverlay, sceneryHTML } from "../lib/shell";
import { bindSoundToggle, music, sfx } from "../lib/sound";
import { connectSocket } from "../lib/socket";
import { phoneLink } from "../lib/room";

const SNAP_WIDTH = 800; // the photo is scaled down to this width before it is sent
const SNAP_JPEG_QUALITY = 0.8;
const SCAN_TIMEOUT_MS = 20_000; // a bit longer than the server's own 15 s wait for Perceptron
/** If a scan is slow or the service is busy, try again with a smaller (faster) picture. */
const SCAN_ATTEMPT_WIDTHS = [SNAP_WIDTH, 640, 512];
/** Server error codes worth retrying: Perceptron was slow, busy, or unreachable. */
const RETRY_CODES = new Set(["TIMEOUT", "RATE_LIMITED", "NETWORK", "UPSTREAM_ERROR"]);
const FRAME_HEADER_BYTES = 4; // width + height (uint16 each), then the JPEG
const BEST_TIME_KEY = "deskcapade.challengeBestMs"; // + "." + difficulty
const COURSE_TIMEOUT_MS = 45_000; // the AI course designer can take a while; after this, the game designs it
const COURSE_IMAGE_WIDTH = 640;
const LEVELS: readonly { id: Difficulty; name: string; icon: string; blurb: string }[] = [
  { id: "easy", name: "Easy", icon: "🌱", blurb: "stepping stones, no hazards" },
  { id: "medium", name: "Medium", icon: "🌿", blurb: "spikes, sliding ledges" },
  { id: "hard", name: "Hard", icon: "🔥", blurb: "lava, crumbling ledges" },
  { id: "boss", name: "Boss", icon: "👑", blurb: "everything at once" },
];
const levelName = (d: Difficulty): string => LEVELS.find((l) => l.id === d)?.name ?? d;

type Source = "laptop" | "phone";
type Screen = "source" | "camera" | "result";

const levelButtons = (cls: string): string =>
  LEVELS.map((l) => `<button class="gm-btn ${cls} gm-level-${l.id}" type="button" data-level="${l.id}" title="${l.blurb}">${l.icon} ${l.name}</button>`).join("");

/**
 * Challenge mode: snap a photo of your desk, pick a level, and play an obstacle course built
 * around the objects in it (frozen exactly where and as big as they were). Grab every coin,
 * then reach the flag; the clock stops when you do.
 */
export function mountChallenge(root: HTMLElement): () => void {
  injectGameStyles();

  root.innerHTML = `
    <main class="gm">
      ${sceneryHTML()}
      <div class="gm-page">
        <header class="gm-topbar">
          <div class="gm-topbar-left">
            <a class="gm-iconbtn" href="${ROUTES.home}" aria-label="Home">⌂</a>
            <span class="gm-modechip">CHALLENGE</span>
          </div>
          <div class="gm-stats" aria-live="polite">
            <div class="gm-stat"><small>COINS</small><b id="statCoins">–</b></div>
            <div class="gm-stat"><small id="statTimeLabel">TIME</small><b id="statTime">0.0s</b></div>
            <div class="gm-stat"><small>RESPAWNS</small><b id="statRespawns">0</b></div>
            <div class="gm-stat"><small>POINTS</small><b id="statPoints">0</b></div>
          </div>
          <div class="gm-topbar-right">
            <button class="gm-iconbtn" type="button" data-sound></button>
            <button class="gm-btn small cream" id="pauseBtn" type="button" disabled>❚❚ PAUSE</button>
            <button class="gm-iconbtn" type="button" data-about aria-label="What is Deskcapades?">?</button>
          </div>
        </header>

        <div class="gm-playarea">
          <div class="gm-stage" id="stage">
            <div class="gm-stage-msg" id="sourceMsg">
              <h2>📸 Snap your desk</h2>
              <p>Pick a camera, frame your desk, and snap. We'll build an obstacle course out of whatever is on it.</p>
              <div class="gm-stage-choices">
                <button class="gm-btn green" id="pickLaptop" type="button">💻 Laptop camera</button>
                <button class="gm-btn blue" id="pickPhone" type="button">📱 Phone camera</button>
              </div>
            </div>
            <canvas id="view" width="1280" height="720" hidden></canvas>
            <div id="scene" hidden></div>
            <div class="gm-stage-overlay" id="overlay" hidden><div class="gm-panel gm-stage-msg" id="overlayBody"></div></div>
          </div>

          <aside class="gm-side">
            <section class="gm-panel" id="goalPanel">
              <h3 id="goalTitle">YOUR GOAL</h3>
              <p id="goalText">Snap a photo of your desk to build a course.</p>
              <p class="gm-best" id="bestText" hidden></p>
            </section>

            <section class="gm-panel" id="cameraPanel" hidden>
              <h3>YOUR DESK</h3>
              <div class="gm-side-buttons">
                <button class="gm-btn green wide" id="snap" type="button" disabled>📸 Snap!</button>
                <button class="gm-btn small wide" id="changeCam" type="button">↺ Change camera</button>
              </div>
            </section>

            <section class="gm-panel" id="phonePanel" hidden>
              <h3>PHONE CAMERA</h3>
              <div class="gm-qr">
                <img id="qr" alt="QR code that opens the phone camera page" width="150" height="150">
                <div class="gm-url" id="phoneUrl">Finding this laptop's address…</div>
              </div>
            </section>

            <section class="gm-panel" id="levelPanel" hidden>
              <h3>DIFFICULTY</h3>
              <div class="gm-levelpick">${levelButtons("small")}</div>
            </section>

            <section class="gm-panel" id="resultPanel" hidden>
              <h3>COURSE</h3>
              <div class="gm-side-buttons">
                <button class="gm-btn small wide" id="restart" type="button" hidden>↺ Restart course</button>
                <button class="gm-switch" id="bgToggle" type="button" aria-pressed="true"><span>🌄 Pixel world</span><span>ON</span></button>
                <button class="gm-btn small wide green" id="again" type="button">📸 Snap another desk</button>
                <button class="gm-btn small wide" id="next" type="button">↺ Change camera</button>
              </div>
            </section>

            <section class="gm-panel">
              <h3>CONTROLS</h3>
              <p><span class="gm-kbd">← →</span> walk · <span class="gm-kbd">Space</span> jump</p>
              <p><span class="gm-kbd">↑ ↓</span> climb · <span class="gm-kbd">R</span> restart · <span class="gm-kbd">P</span> pause</p>
              <p class="tip">Stomp beetles from above. Spikes, lava and beetles send you back to the start.</p>
            </section>
          </aside>
        </div>
        <video id="video" class="hidden-video" autoplay muted playsinline></video>
        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>
  `;
  paintArt(root);
  bindAbout(root);
  bindSoundToggle(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const stage = q<HTMLElement>("#stage");
  const sourceMsg = q<HTMLElement>("#sourceMsg");
  const canvas = q<HTMLCanvasElement>("#view");
  const ctx = canvas.getContext("2d")!;
  const sceneEl = q<HTMLElement>("#scene");
  const overlay = q<HTMLElement>("#overlay");
  const overlayBody = q<HTMLElement>("#overlayBody");
  const video = q<HTMLVideoElement>("#video");
  const snapBtn = q<HTMLButtonElement>("#snap");
  const cameraPanel = q<HTMLElement>("#cameraPanel");
  const phonePanel = q<HTMLElement>("#phonePanel");
  const levelPanel = q<HTMLElement>("#levelPanel");
  const resultPanel = q<HTMLElement>("#resultPanel");
  const goalTitle = q<HTMLElement>("#goalTitle");
  const goalText = q<HTMLElement>("#goalText");
  const bestText = q<HTMLElement>("#bestText");
  const qrImg = q<HTMLImageElement>("#qr");
  const phoneUrlEl = q<HTMLElement>("#phoneUrl");
  const bgToggle = q<HTMLButtonElement>("#bgToggle");
  const restartBtn = q<HTMLButtonElement>("#restart");
  const pauseBtn = q<HTMLButtonElement>("#pauseBtn");
  const statCoins = q<HTMLElement>("#statCoins");
  const statTime = q<HTMLElement>("#statTime");
  const statTimeLabel = q<HTMLElement>("#statTimeLabel");
  const statRespawns = q<HTMLElement>("#statRespawns");
  const statPoints = q<HTMLElement>("#statPoints");
  statPoints.textContent = String(getPoints());
  const toast = q<HTMLElement>("#toast");

  // ---------- state ----------

  let screen: Screen = "source";
  let source: Source | null = null;
  let stream: MediaStream | null = null;
  let socket: ReturnType<typeof connectSocket> | null = null;
  let frame: ImageBitmap | null = null;
  let phoneConnected = false;
  let decoding = false;
  let pendingFrame: ArrayBuffer | null = null;
  let busy = false;
  /** The photo just taken. While set, the preview shows it instead of the live camera. */
  let frozenShot: HTMLCanvasElement | null = null;
  /** Pixel background instead of the photo. Remembered between snaps. */
  let pixelBackground = true;
  let lastShot: HTMLCanvasElement | null = null;
  let lastSprites: DeskSprite[] = [];
  /** The photo -> pixel world animation, while it's playing. */
  let transition: PixelTransition | null = null;
  /** The course being played. */
  let game: Platformer | null = null;
  let detachGame: (() => void) | null = null;
  let gameRaf = 0;
  /** Bumped for every new course request, so a slow answer for an old one is ignored. */
  let courseRequest = 0;
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

  const showOverlay = (html: string | null): void => {
    overlay.hidden = html === null;
    if (html !== null) overlayBody.innerHTML = html;
  };

  const readBest = (d: Difficulty): number | null => {
    try {
      const v = Number(localStorage.getItem(`${BEST_TIME_KEY}.${d}`));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  };

  const setGoal = (title: string, text: string): void => {
    goalTitle.textContent = title;
    goalText.textContent = text;
  };

  const renderStats = (): void => {
    const s = game?.stats();
    statCoins.textContent = s?.coins ? `${s.coins.got}/${s.coins.total}` : "–";
    // with a time limit, the clock counts down
    const left = s?.limitMs ? s.limitMs - (s.timeMs ?? 0) : null;
    statTimeLabel.textContent = left !== null && !s?.won ? "TIME LEFT" : "TIME";
    statTime.textContent = formatTime(left !== null && !s?.won ? left : (s?.timeMs ?? 0));
    statTime.style.color = left !== null && !s?.won && left < 15_000 ? "#ff86a8" : "";
    statRespawns.textContent = String(s?.respawns ?? 0);
  };

  /** Which parts of the screen show, for where you are in the flow. */
  const render = (): void => {
    sourceMsg.hidden = screen !== "source";
    canvas.hidden = screen !== "camera";
    sceneEl.hidden = screen !== "result";
    cameraPanel.hidden = screen !== "camera";
    phonePanel.hidden = !(screen === "camera" && source === "phone" && !phoneConnected);
    resultPanel.hidden = screen !== "result";
    levelPanel.hidden = screen !== "result" || lastSprites.length === 0;
    if (screen === "source") setGoal("YOUR GOAL", "Snap a photo of your desk to build a course.");
    if (screen === "camera") {
      setGoal(
        "FRAME YOUR DESK",
        `Fit your whole desk in view (objects cut off at the edges don't count), then snap${source === "phone" ? " here or with the 📸 button on your phone" : ""}!`,
      );
    }
  };

  const isReady = (): boolean =>
    source === "laptop" ? video.readyState >= 2 && video.videoWidth > 0 : frame !== null;

  // ---------- camera sources ----------

  const stopTransition = (): void => {
    transition?.cancel();
    transition = null;
  };

  const stopGame = (): void => {
    music.stop();
    cancelAnimationFrame(gameRaf);
    detachGame?.();
    detachGame = null;
    game = null;
    restartBtn.hidden = true;
    pauseBtn.disabled = true;
    pause.set(false);
    renderStats();
  };

  const stopSources = (): void => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    socket?.close();
    socket = null;
    frame?.close();
    frame = null;
    phoneConnected = false;
    pendingFrame = null;
    frozenShot = null;
    stopTransition();
    stopGame();
    showOverlay(null);
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
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      fail(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow it for this site, then try again."
          : "Couldn't start the camera. Close other apps using it and try again.",
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

  const showPhoneUrl = async (base: string): Promise<void> => {
    const url = phoneLink(base);
    if (url === shownUrl) return;
    shownUrl = url;
    phoneUrlEl.textContent = url;
    try {
      qrImg.src = await QRCode.toDataURL(url, { margin: 1, width: 320 });
    } catch {
      qrImg.removeAttribute("src");
    }
  };

  /** Opened through a tunnel or LAN address already? Use it. Else the tunnel, else same Wi-Fi. */
  const loadInfo = async (): Promise<void> => {
    if (stopped || source !== "phone") return;
    const host = location.hostname;
    const opened = host !== "localhost" && host !== "127.0.0.1";
    try {
      const info = (await (await fetch("/api/info")).json()) as InfoResponse;
      const base = opened ? location.origin : (info.tunnelUrl ?? info.lanUrls[0] ?? "");
      if (base) await showPhoneUrl(base);
      if (opened || info.tunnelUrl) return;
    } catch {
      phoneUrlEl.textContent = "Can't read this laptop's address. Is the game server running?";
    }
    infoPolls += 1;
    if (infoPolls < 20) infoTimer = window.setTimeout(() => void loadInfo(), 3000);
  };

  const startPhone = (): void => {
    socket = connectSocket(
      "desktop",
      {
        onState: (s) => {
          if (s !== "open") {
            phoneConnected = false;
            render();
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
          if (msg.type === "snap") {
            // the Snap button on the phone
            if (screen === "camera" && !busy) void snap();
            return;
          }
          if (msg.type === "status") {
            phoneConnected = msg.phoneConnected;
            if (!phoneConnected) {
              frame?.close();
              frame = null;
            }
            render();
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
    render();
    if (src === "laptop") await startLaptop();
    else startPhone();
  };

  // ---------- camera preview ----------

  const draw = (): void => {
    if (screen === "camera") {
      snapBtn.disabled = busy || !isReady();
      const img = frozenShot ?? (source === "laptop" && video.readyState >= 2 && video.videoWidth > 0 ? video : source === "phone" ? frame : null);
      if (img) {
        const w = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
        const h = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = "#1d140b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f6ecd6";
        ctx.font = `${Math.round(canvas.height / 30)}px "Press Start 2P", monospace`;
        ctx.textAlign = "center";
        ctx.fillText(source === "phone" ? "Waiting for your phone…" : "Starting the camera…", canvas.width / 2, canvas.height / 2);
        ctx.textAlign = "left";
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

  // ---------- the course ----------

  const pause = pauseOverlay(stage, {
    onChange: (paused) => {
      game?.setPaused(paused);
      if (paused) music.stop();
      else if (game) music.start();
      pauseBtn.textContent = paused ? "▶ RESUME" : "❚❚ PAUSE";
    },
    onRestart: () => game?.restart(),
  });

  const chooseLevelHTML = `
    <h2>Choose your challenge</h2>
    <p>Same desk, four different courses. The tougher the level, the trickier the twists.</p>
    <div class="gm-levelpick" style="width: 100%">${levelButtons("")}</div>`;

  /** Ask the AI course designer (server) for a course; an error if it's unavailable or too slow. */
  const requestCourse = async (g: Platformer, shot: HTMLCanvasElement, d: Difficulty): Promise<CourseResponse | { ok: false; error: string }> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), COURSE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty: d, image: shrink(shot, COURSE_IMAGE_WIDTH).toDataURL("image/jpeg", 0.7), ...g.levelInfo() }),
        signal: controller.signal,
      });
      return (await res.json()) as CourseResponse | ApiError;
    } catch {
      return { ok: false, error: "The course designer took too long" };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const showCourseInfo = (course: Course, d: Difficulty): void => {
    setGoal(
      `${course.title.toUpperCase()}`,
      `${course.intro ? `${course.intro} ` : ""}Grab all ${course.coins.length} coins, then reach the flag within ${formatTime(course.timeLimitMs)}, or start over. ` +
        `Win for 5 points, or under ${formatTime(course.timeLimitMs / 2)} for 10!`,
    );
    const best = readBest(d);
    bestText.hidden = best === null;
    bestText.textContent = best === null ? "" : `🏆 Best on ${levelName(d)}: ${formatTime(best)}`;
  };

  /**
   * Build and start a course: same photo, every object frozen exactly where and as big as it
   * was. The AI designer plans it; the game checks the plan and fills the gaps so it can be beaten.
   */
  const startGame = async (d: Difficulty): Promise<void> => {
    stopGame();
    if (!lastShot || lastSprites.length === 0 || stopped) return;
    const shot = lastShot;
    const request = ++courseRequest;
    const scale = deskSceneScale(shot);
    const W = Math.round(shot.width * scale);
    const H = Math.round(shot.height * scale);

    const g = new Platformer({
      mode: "challenge",
      seed: Math.floor(Math.random() * 1e6),
      onTimeUp: () => {
        // ran out of time: no points, and the course starts over
        showToast("⏰ Time's up! +0 points. Try again!");
      },
      onWin: (ms) => {
        // 10 points for a fast run (within half the time limit), 5 for any win
        const limit = g.stats().limitMs ?? Infinity;
        const fast = ms <= limit * 0.5;
        const earned = fast ? 10 : 5;
        statPoints.textContent = String(addPoints(earned));
        showToast(fast ? `⚡ Lightning fast! +${earned} points` : `★ Course cleared! +${earned} points`);
        const best = readBest(d);
        const record = best === null || ms < best;
        if (record) {
          try {
            localStorage.setItem(`${BEST_TIME_KEY}.${d}`, String(Math.round(ms)));
          } catch {
            /* storage unavailable: fine */
          }
        }
        bestText.hidden = false;
        bestText.textContent = record ? `🏆 New best on ${levelName(d)}: ${formatTime(ms)}!` : `Cleared in ${formatTime(ms)} · best ${formatTime(best ?? ms)}`;
      },
    });
    // a photo from further back has smaller objects: shrink the world (player, jumps) to match
    g.setSize(W, H, sceneZoom(lastSprites.map((sp) => ({ x: 0, y: 0, w: sp.box.w * scale, h: sp.box.h * scale })), H));
    g.setObjects(
      lastSprites.map((sp, i) => ({
        id: `s${i}`,
        label: sp.label,
        templateId: sp.templateId,
        box: { x: sp.box.x * scale, y: sp.box.y * scale, w: sp.box.w * scale, h: sp.box.h * scale },
        sprite: sp.canvas,
        colors: sp.colors,
      })),
    );

    showOverlay(`<h2>Building your ${levelName(d).toLowerCase()} course…</h2><p>Studying your desk and placing coins, ledges and traps.</p>`);
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => (b.disabled = true));
    const answer = await requestCourse(g, shot, d);
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => (b.disabled = false));
    if (request !== courseRequest || stopped || lastShot !== shot || screen !== "result") return;

    const course = answer.ok ? g.useCourse(answer.design, d, answer.model) : g.useCourse(null, d, "built-in");
    showCourseInfo(course, d);
    showOverlay(null);
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === d)));

    const view = document.createElement("canvas");
    view.width = W;
    view.height = H;
    const vctx = view.getContext("2d")!;
    const photoBg = document.createElement("canvas");
    photoBg.width = W;
    photoBg.height = H;
    const pctx = photoBg.getContext("2d")!;
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(shot, 0, 0, W, H);
    const pixelBg = document.createElement("canvas");
    pixelBg.width = W;
    pixelBg.height = H;
    drawPixelBackdrop(pixelBg.getContext("2d")!, W, H);

    game = g;
    detachGame = g.attachInput();
    music.start();
    sceneEl.replaceChildren(view);
    restartBtn.hidden = false;
    pauseBtn.disabled = false;

    const loop = (now: number): void => {
      if (game !== g) return;
      vctx.drawImage(pixelBackground ? pixelBg : photoBg, 0, 0);
      g.drawObjects(vctx, now);
      g.update(now);
      g.draw(vctx, now);
      renderStats();
      gameRaf = requestAnimationFrame(loop);
    };
    gameRaf = requestAnimationFrame(loop);
  };

  const renderBgToggle = (): void => {
    bgToggle.setAttribute("aria-pressed", String(pixelBackground));
    bgToggle.lastElementChild!.textContent = pixelBackground ? "ON" : "OFF";
  };

  const showResult = async (shot: HTMLCanvasElement, res: ScanResponse): Promise<void> => {
    stopSources(); // camera and phone link are released while you look at the result
    const request = ++courseRequest; // forget any course still being designed for the previous photo
    const { kept } = pickDeskObjects(shot, res.objects, res.imageSize);
    // things not on the list take the shape of the listed object they're most like
    screen = "result";
    render();
    const still = document.createElement("canvas");
    still.width = shot.width;
    still.height = shot.height;
    still.getContext("2d")!.drawImage(shot, 0, 0);
    sceneEl.replaceChildren(still);
    showOverlay(`<h2>Reading your desk…</h2><p>Working out what each thing on your desk should become.</p>`);
    await matchNow(kept.map((c) => c.label));
    if (stopped || request !== courseRequest) return;
    showOverlay(null);
    // sprites use the same art-pixel size the level is drawn at (the scene is bigger than the photo)
    const sceneScale = deskSceneScale(shot);
    const pixel = artPixelSize(shot.height * sceneScale) / sceneScale;
    const sprites = kept.map((c) => makeDeskSprite(c.label, shot, c.box, pixel));

    lastShot = shot;
    lastSprites = sprites;
    screen = "result";
    render();
    bestText.hidden = true;

    if (sprites.length === 0) {
      setGoal("NOTHING SPOTTED", "No desk things in that photo. Try more light, move closer, or fit whole objects in view.");
      showOverlay(`<h2>Nothing to build with</h2><p>Try more light, move closer, or make sure whole objects are in view.</p>
        <div class="gm-stage-choices"><button class="gm-btn green small" type="button" data-again>📸 Try again</button></div>`);
      return;
    }

    setGoal("YOUR DESK", `${sprites.length} desk piece${sprites.length === 1 ? "" : "s"} found! Choose a level to build your course.`);
    // the real photo morphs into the pixel world (~4 s), then you choose the level
    pixelBackground = true;
    renderBgToggle();
    const anim = playPixelTransition(shot, sprites);
    transition = anim;
    sceneEl.replaceChildren(anim.canvas);
    void anim.done.then(() => {
      if (transition === anim) transition = null;
      if (screen === "result" && lastShot === shot && !stopped && !game) showOverlay(chooseLevelHTML);
    });
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
        body: JSON.stringify({ image: image.toDataURL("image/jpeg", SNAP_JPEG_QUALITY), width: image.width, height: image.height }),
        signal: controller.signal,
      });
      const body = (await res.json()) as ScanResponse | ApiError;
      if (body.ok) return { kind: "ok", res: body };
      const code = body.code ?? "";
      return RETRY_CODES.has(code) || res.status >= 500 ? { kind: "retry", error: body.error, code } : { kind: "fail", error: body.error };
    } catch {
      return { kind: "retry", error: "Couldn't reach the game server. Is it running?", code: "NETWORK" };
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
    sfx("snap");
    try {
      let last = "";
      for (let i = 0; i < SCAN_ATTEMPT_WIDTHS.length; i++) {
        snapBtn.textContent = i === 0 ? "Looking…" : `Still looking… (${i + 1}/${SCAN_ATTEMPT_WIDTHS.length})`;
        // later tries send a smaller picture, which the spotter answers faster
        const attempt = await scanOnce(shrink(shot, SCAN_ATTEMPT_WIDTHS[i] ?? SNAP_WIDTH));
        if (stopped || frozenShot !== shot) return; // left the page or changed camera meanwhile
        if (attempt.kind === "ok") {
          await showResult(shot, attempt.res);
          return;
        }
        last = attempt.error;
        if (attempt.kind === "fail") break;
        if (i < SCAN_ATTEMPT_WIDTHS.length - 1) await wait(attempt.code === "RATE_LIMITED" ? 2500 : 700);
        if (stopped || frozenShot !== shot) return;
      }
      frozenShot = null; // back to the live camera so you can try again
      showToast(last || "Couldn't read that photo. Try again!");
    } finally {
      busy = false;
      snapBtn.textContent = "📸 Snap!";
    }
  };

  // ---------- buttons and keys ----------

  /** The camera you last picked, so "Snap another" goes straight back to it. */
  let lastSource: Source | null = null;
  const snapAgain = (): void => {
    if (source) void startSource(source);
    else if (lastSource) void startSource(lastSource);
    else goSource();
  };
  q<HTMLButtonElement>("#pickLaptop").addEventListener("click", () => void startSource((lastSource = "laptop")));
  q<HTMLButtonElement>("#pickPhone").addEventListener("click", () => void startSource((lastSource = "phone")));
  q<HTMLButtonElement>("#changeCam").addEventListener("click", goSource);
  q<HTMLButtonElement>("#next").addEventListener("click", goSource);
  q<HTMLButtonElement>("#again").addEventListener("click", snapAgain);
  snapBtn.addEventListener("click", () => void snap());
  bgToggle.addEventListener("click", () => {
    pixelBackground = !pixelBackground;
    renderBgToggle();
    bgToggle.blur(); // so Space jumps instead of pressing the button again
  });
  restartBtn.addEventListener("click", () => {
    game?.restart();
    restartBtn.blur();
  });
  pauseBtn.addEventListener("click", () => {
    if (game) pause.toggle();
    pauseBtn.blur();
  });
  // level buttons live both in the side panel and on the stage
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const levelBtn = target.closest<HTMLButtonElement>("[data-level]");
    if (levelBtn && !levelBtn.disabled) {
      levelBtn.blur();
      void startGame(levelBtn.dataset.level as Difficulty);
    }
    if (target.closest("[data-again]")) snapAgain();
  });
  const onKey = (e: KeyboardEvent): void => {
    if ((e.key === "p" || e.key === "P" || e.key === "Escape") && game) pause.toggle();
  };
  window.addEventListener("keydown", onKey);

  render();
  raf = requestAnimationFrame(draw);

  // Called by the router when you leave this page.
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", onKey);
    window.clearTimeout(toastTimer);
    stopSources();
  };
}
