import { CHARACTERS, drawSprout, getCharacter, setCharacter } from "../game/art";
import type { ObjectKind } from "../game/materials";
import { drawCoin, drawGoalFlag, drawPiece, tonesOf } from "../game/pieces";
import { ROUTES } from "./routes";

/* ------------------------------------------------------------------
   Shared bits of the game shell: the scenery behind every screen, the logo, little pixel-art
   icons (drawn with the game's own art), the "?" about box and the pause overlay.
   ------------------------------------------------------------------ */

const TREE = [
  "....oooooo....",
  "..oollllllo...",
  ".olllLLlllloo.",
  "olllllllLLllo.",
  "ollLLlllllllo.",
  "olllllLLllLlo.",
  ".ollllllllloo.",
  "..oollllloo...",
  "....obbbo.....",
  "....obbbo.....",
  "...obbbbbo....",
  "..sssssssss...",
];
const TREE_COLORS: Record<string, string> = { o: "#2b1d14", l: "#5cbf5a", L: "#a8e86c", b: "#7a4a2a", s: "#e0b886" };

/** Clouds, the green hill and pixel trees behind a page. */
export function sceneryHTML(): string {
  const clouds = [
    [8, 12, -10],
    [30, 26, -40],
    [62, 8, -70],
    [78, 34, -20],
    [46, 44, -55],
  ]
    .map(([left, top, delay]) => `<i class="gm-cloud" style="left:${left}%;top:${top}%;animation-delay:${delay}s"></i>`)
    .join("");
  const trees = [
    [6, 18, 96],
    [12, 6, 40],
    [84, 22, 112],
    [74, 4, 52],
  ]
    .map(([left, bottom, size]) => `<canvas class="gm-tree" data-art="tree" style="left:${left}%;bottom:${bottom}%;width:${size}px"></canvas>`)
    .join("");
  return `<div class="gm-scenery" aria-hidden="true">${clouds}<div class="gm-hill"></div>${trees}</div>`;
}

/** The little tree + "DESK CAPADES" logo, linking home. */
export function logoHTML(): string {
  return `<a class="gm-logo" href="${ROUTES.home}" aria-label="Deskcapades home"><canvas data-art="tree"></canvas><span>DESK<br>CAPADES</span></a>`;
}

/**
 * Paint every `<canvas data-art="...">` under `root`: tree, sprout (your character),
 * char:<id> (a specific character), coin, flag, or piece:<kind>.
 */
export function paintArt(root: HTMLElement): void {
  for (const c of root.querySelectorAll<HTMLCanvasElement>("canvas[data-art]")) {
    const art = c.dataset.art ?? "";
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    if (art === "tree") {
      c.width = TREE[0]!.length;
      c.height = TREE.length;
      TREE.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const color = TREE_COLORS[row[x] ?? "."];
          if (!color) continue;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, 1, 1);
        }
      });
    } else if (art === "sprout" || art.startsWith("char:")) {
      c.width = 16;
      c.height = 19;
      ctx.clearRect(0, 0, 16, 19);
      drawSprout(ctx, 8, 19, 19, 0, c.dataset.flip ? -1 : 1, 0, art.startsWith("char:") ? art.slice(5) : undefined);
    } else if (art === "coin") {
      c.width = 12;
      c.height = 12;
      drawCoin(ctx, 6, 11, 1, 0);
    } else if (art === "flag") {
      c.width = 16;
      c.height = 28;
      drawGoalFlag(ctx, 3, 27, 1, 0);
    } else if (art.startsWith("piece:")) {
      c.width = 32;
      c.height = 32;
      drawPiece(ctx, art.slice(6) as ObjectKind, { x: 4, y: 8, w: 24, h: 22 }, 1, 1000, tonesOf(null));
    }
  }
}

const ABOUT_HTML = `
  <div class="gm-modal" role="dialog" aria-modal="true" aria-labelledby="aboutTitle">
    <div class="gm-panel">
      <h2 id="aboutTitle">Bored at the office?</h2>
      <p>Your stapler, your coffee mug, that pile of sticky notes: they've been waiting for an adventure.</p>
      <p>Point a camera at your desk and Deskcapades turns whatever is lying around into a tiny pixel world:
        cans become vine towers, mugs become pools, erasers become bouncy mushrooms.</p>
      <p>Move things around and the world changes with them. Every desk is a different level.</p>
      <div class="gm-modal-actions">
        <a class="gm-btn small cream" href="${ROUTES.how}">How to play</a>
        <button class="gm-btn small green" type="button" data-close>Let's play!</button>
      </div>
    </div>
  </div>`;

/** Wire every `[data-about]` button under `root` to open the "bored at the office?" box. */
export function bindAbout(root: HTMLElement): void {
  for (const btn of root.querySelectorAll<HTMLElement>("[data-about]")) {
    btn.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = ABOUT_HTML;
      const modal = wrap.firstElementChild as HTMLElement;
      const close = (): void => modal.remove();
      modal.addEventListener("click", (e) => {
        if (e.target === modal || (e.target as HTMLElement).closest("[data-close]")) close();
      });
      root.querySelector(".gm")?.appendChild(modal);
      modal.querySelector<HTMLElement>("[data-close]")?.focus();
    });
  }
}

/**
 * Wire every `[data-characters]` button under `root` to open the character picker. Picking one
 * saves it and repaints every picture of "your character" on the page.
 */
export function bindCharacterPicker(root: HTMLElement): void {
  for (const btn of root.querySelectorAll<HTMLElement>("[data-characters]")) {
    btn.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <div class="gm-modal" role="dialog" aria-modal="true" aria-labelledby="charTitle">
          <div class="gm-panel" style="width: min(640px, 100%)">
            <h2 id="charTitle">Choose your character</h2>
            <div class="gm-chargrid">
              ${CHARACTERS.map(
                (c) => `<button class="gm-charbtn" type="button" data-pick="${c.id}" aria-pressed="${c.id === getCharacter().id}">
                  <canvas class="gm-bob" data-art="char:${c.id}" aria-hidden="true"></canvas><span>${c.name}</span></button>`,
              ).join("")}
            </div>
            <div class="gm-modal-actions"><button class="gm-btn small green" type="button" data-close>Done</button></div>
          </div>
        </div>`;
      const modal = wrap.firstElementChild as HTMLElement;
      paintArt(modal);
      modal.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const pick = target.closest<HTMLElement>("[data-pick]");
        if (pick) {
          setCharacter(pick.dataset.pick ?? "");
          modal.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b === pick)));
          for (const c of root.querySelectorAll<HTMLCanvasElement>('canvas[data-art="sprout"]')) paintArt(c.parentElement ?? root);
          root.querySelectorAll("[data-charname]").forEach((el) => (el.textContent = getCharacter().name));
        }
        if (e.target === modal || target.closest("[data-close]")) modal.remove();
      });
      root.querySelector(".gm")?.appendChild(modal);
    });
  }
}

/** The best Challenge time across all difficulties, or null. */
export function bestChallengeMs(): number | null {
  let best: number | null = null;
  try {
    for (const level of ["easy", "medium", "hard", "boss"]) {
      const v = Number(localStorage.getItem(`deskcapade.challengeBestMs.${level}`));
      if (Number.isFinite(v) && v > 0 && (best === null || v < best)) best = v;
    }
  } catch {
    /* storage unavailable */
  }
  return best;
}

export const formatTime = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`;
};

/**
 * A pause overlay over `stage`: Resume, Restart (optional) and Home. `onChange` hears every
 * pause / resume so the page can stop its game.
 */
export function pauseOverlay(
  stage: HTMLElement,
  opts: { onChange: (paused: boolean) => void; onRestart?: () => void },
): { toggle: () => void; set: (paused: boolean) => void; get paused(): boolean } {
  const el = document.createElement("div");
  el.className = "gm-stage-overlay";
  el.hidden = true;
  el.innerHTML = `
    <div class="gm-panel gm-stage-msg">
      <h2>Paused</h2>
      <div class="gm-stage-choices">
        <button class="gm-btn green small" type="button" data-act="resume">▶ Resume</button>
        ${opts.onRestart ? `<button class="gm-btn small" type="button" data-act="restart">↺ Restart</button>` : ""}
        <a class="gm-btn cream small" href="${ROUTES.home}">⌂ Home</a>
      </div>
    </div>`;
  stage.appendChild(el);
  let paused = false;
  const set = (p: boolean): void => {
    if (p === paused) return;
    paused = p;
    el.hidden = !p;
    opts.onChange(p);
  };
  el.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "resume") set(false);
    if (act === "restart") {
      opts.onRestart?.();
      set(false);
    }
  });
  return {
    toggle: () => set(!paused),
    set,
    get paused() {
      return paused;
    },
  };
}
