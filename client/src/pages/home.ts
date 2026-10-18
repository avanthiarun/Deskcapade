import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { getCharacter } from "../game/art";
import { bestChallengeMs, bindAbout, bindCharacterPicker, formatTime, logoHTML, paintArt, sceneryHTML } from "../lib/shell";

/** Home screen: the title, the two game modes, How to play / Credits, and the "?" about box. */
export function mountHome(root: HTMLElement): () => void {
  injectGameStyles();
  const best = bestChallengeMs();

  root.innerHTML = `
    <main class="gm">
      ${sceneryHTML()}
      <div class="gm-page">
        <header class="gm-header">
          ${logoHTML()}
          <div class="gm-header-right">
            <span class="gm-chip" title="Your fastest Challenge course">🏆 BEST ${best === null ? "--:--" : formatTime(best)}</span>
            <button class="gm-iconbtn" type="button" data-about aria-label="What is Deskcapades?">?</button>
          </div>
        </header>

        <section class="gm-hero">
          <span class="gm-tagchip">📷 YOUR DESK · A TINY WORLD</span>
          <div class="gm-titlerow">
            <canvas class="gm-bob" data-art="sprout" aria-hidden="true"></canvas>
            <h1 class="gm-title">Deskcapades</h1>
            <canvas class="gm-bob" data-art="sprout" data-flip="1" aria-hidden="true"></canvas>
          </div>
          <p class="gm-tagline">Point a camera at your desk and watch it spring into a pixel adventure. Climb your can, swim in your mug, bounce off your eraser.</p>

          <nav class="gm-cards" aria-label="Game modes">
            <a class="gm-card" href="${ROUTES.story}">
              <div class="gm-card-top"><span class="gm-tag">FREE ROAM</span></div>
              <div class="gm-card-head"><canvas data-art="tree" aria-hidden="true"></canvas><h2>Story Mode</h2></div>
              <p>Wander your desk-world at your own pace. Move things around and watch the world change live. Collect the golden seeds to make it bloom.</p>
              <span class="gm-card-play">PLAY ›</span>
            </a>
            <a class="gm-card challenge" href="${ROUTES.challenge}">
              <div class="gm-card-top"><span class="gm-tag red">RACE THE CLOCK</span><span class="gm-new">NEW</span></div>
              <div class="gm-card-head"><canvas data-art="coin" aria-hidden="true"></canvas><h2>Challenge Mode</h2></div>
              <p>Snap your desk and get an obstacle course built from it. Pick Easy to Boss, grab every coin and reach the flag as fast as you can.</p>
              <span class="gm-card-play">PLAY ›</span>
            </a>
          </nav>

          <div class="gm-home-actions">
            <button class="gm-btn green" type="button" data-characters>🎭 Character: <span data-charname>${getCharacter().name}</span></button>
            <a class="gm-btn" href="${ROUTES.how}">ⓘ How to play</a>
            <a class="gm-btn blue" href="${ROUTES.credits}">★ Credits</a>
          </div>
        </section>
      </div>
    </main>
  `;

  paintArt(root);
  bindAbout(root);
  bindCharacterPicker(root);
  return () => {
    /* nothing to clean up */
  };
}
