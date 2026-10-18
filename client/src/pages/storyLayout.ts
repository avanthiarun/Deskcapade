import type { StoryGame } from "../game/storyGame";
import type { LiveSpriteLayer } from "../lib/liveSprites";
import { ROUTES } from "../lib/routes";
import { bindAbout, paintArt, pauseOverlay, sceneryHTML } from "../lib/shell";

/**
 * The in-game screen shared by both Story pages: top bar (home, mode, seeds, blooms, pause),
 * the live game in a dark frame, and side panels (goal, controls, options, tip).
 * `extraSide` adds panels (the phone page's QR code).
 */
export function storyLayoutHTML(extraSide = ""): string {
  return `
    <main class="gm">
      ${sceneryHTML()}
      <div class="gm-page">
        <header class="gm-topbar">
          <div class="gm-topbar-left">
            <a class="gm-iconbtn" href="${ROUTES.home}" aria-label="Home">⌂</a>
            <span class="gm-modechip">STORY</span>
          </div>
          <div class="gm-stats" aria-live="polite">
            <div class="gm-stat"><small>SEEDS</small><b id="statSeeds">0/0</b></div>
            <div class="gm-stat"><small>BLOOMS</small><b id="statBlooms">0</b></div>
          </div>
          <div class="gm-topbar-right">
            <button class="gm-btn small cream" id="pauseBtn" type="button">❚❚ PAUSE</button>
            <button class="gm-iconbtn" type="button" data-about aria-label="What is Deskcapades?">?</button>
          </div>
        </header>

        <div class="gm-playarea">
          <div class="gm-stage" id="stage">
            <canvas id="view" width="1280" height="720"></canvas>
            <div class="gm-stage-overlay" id="stageMsg" hidden><div class="gm-panel gm-stage-msg" id="stageMsgBody"></div></div>
          </div>
          <aside class="gm-side">
            ${extraSide}
            <section class="gm-panel">
              <h3>TODAY'S GOAL</h3>
              <p>Collect the golden seeds floating above your desk pieces. Gather them all and the garden blooms!</p>
            </section>
            <section class="gm-panel">
              <h3>CONTROLS</h3>
              <p><span class="gm-kbd">← →</span> walk · <span class="gm-kbd">Space</span> jump</p>
              <p><span class="gm-kbd">↑ ↓</span> climb · <span class="gm-kbd">R</span> respawn · <span class="gm-kbd">P</span> pause</p>
            </section>
            <section class="gm-panel">
              <h3>OPTIONS</h3>
              <div class="gm-side-buttons">
                <button class="gm-switch" id="pixelToggle" type="button" aria-pressed="false"><span>🌄 Pixel world</span><span>OFF</span></button>
                <button class="gm-switch" id="gameToggle" type="button" aria-pressed="true"><span>🌱 Play the game</span><span>ON</span></button>
              </div>
            </section>
            <section class="gm-panel">
              <p class="tip">Tip: move things around on your desk: the world reshapes itself as you play.</p>
            </section>
          </aside>
        </div>
        <div class="gm-toast" id="toast" role="status" hidden></div>
      </div>
    </main>`;
}

/**
 * Wires the shared Story screen: option switches, pause (button and P key), the top-bar stats.
 * Returns `refresh()` (call it each frame) and `dispose()`.
 */
export function bindStoryUi(
  root: HTMLElement,
  story: StoryGame,
  layer: LiveSpriteLayer,
): { refresh: () => void; showMessage: (html: string | null) => void; toast: (text: string) => void; dispose: () => void } {
  paintArt(root);
  bindAbout(root);
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const pixelToggle = q<HTMLButtonElement>("#pixelToggle");
  const gameToggle = q<HTMLButtonElement>("#gameToggle");
  const pauseBtn = q<HTMLButtonElement>("#pauseBtn");
  const seedsEl = q<HTMLElement>("#statSeeds");
  const bloomsEl = q<HTMLElement>("#statBlooms");
  const stageMsg = q<HTMLElement>("#stageMsg");
  const stageMsgBody = q<HTMLElement>("#stageMsgBody");
  const toastEl = q<HTMLElement>("#toast");
  let toastTimer: number | undefined;

  const setSwitch = (btn: HTMLButtonElement, on: boolean): void => {
    btn.setAttribute("aria-pressed", String(on));
    btn.lastElementChild!.textContent = on ? "ON" : "OFF";
  };
  const pause = pauseOverlay(q<HTMLElement>("#stage"), {
    onChange: (paused) => {
      story.setPaused(paused);
      pauseBtn.textContent = paused ? "▶ RESUME" : "❚❚ PAUSE";
    },
  });

  pixelToggle.addEventListener("click", () => {
    layer.setPixelWorld(!layer.pixelWorld);
    pixelToggle.blur(); // so Space jumps instead of pressing the button again
  });
  gameToggle.addEventListener("click", () => {
    story.setOn(!story.on);
    setSwitch(gameToggle, story.on);
    gameToggle.blur();
  });
  pauseBtn.addEventListener("click", () => {
    pause.toggle();
    pauseBtn.blur();
  });
  const onKey = (e: KeyboardEvent): void => {
    if ((e.key === "p" || e.key === "P" || e.key === "Escape") && !(e.target instanceof HTMLInputElement)) pause.toggle();
  };
  window.addEventListener("keydown", onKey);

  return {
    refresh: () => {
      const s = story.stats();
      seedsEl.textContent = s.seeds ? `${s.seeds.got}/${s.seeds.total}` : "–";
      bloomsEl.textContent = String(s.blooms);
      setSwitch(pixelToggle, layer.pixelWorld);
    },
    showMessage: (html) => {
      stageMsg.hidden = html === null;
      if (html !== null) stageMsgBody.innerHTML = html;
    },
    toast: (text) => {
      toastEl.textContent = text;
      toastEl.hidden = false;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toastEl.hidden = true), 5000);
    },
    dispose: () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(toastTimer);
    },
  };
}
