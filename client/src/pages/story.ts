import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { bindAbout, paintArt, sceneryHTML } from "../lib/shell";

/** Story mode, step one: pick which camera watches the desk (same screen style as Challenge). */
export function mountStory(root: HTMLElement): () => void {
  injectGameStyles();

  root.innerHTML = `
    <main class="gm">
      ${sceneryHTML()}
      <div class="gm-page">
        <header class="gm-topbar">
          <div class="gm-topbar-left">
            <a class="gm-iconbtn" href="${ROUTES.home}" aria-label="Home">⌂</a>
            <span class="gm-modechip">STORY</span>
          </div>
          <div></div>
          <div class="gm-topbar-right">
            <button class="gm-iconbtn" type="button" data-about aria-label="What is Deskcapades?">?</button>
          </div>
        </header>

        <div class="gm-playarea">
          <div class="gm-stage">
            <div class="gm-stage-msg">
              <h2>🌱 Bring your desk to life</h2>
              <p>Pick a camera and point it at your desk. Everything it sees becomes your world, live:
                move things around and the world changes as you play.</p>
              <div class="gm-stage-choices">
                <a class="gm-btn green" href="${ROUTES.storyLaptop}">💻 Laptop camera</a>
                <a class="gm-btn blue" href="${ROUTES.storyPhone}">📱 Phone camera</a>
              </div>
            </div>
          </div>
          <aside class="gm-side">
            <section class="gm-panel">
              <h3>YOUR GOAL</h3>
              <p>Explore at your own pace and collect the golden seeds. Gather them all and the garden blooms!</p>
            </section>
            <section class="gm-panel">
              <h3>WHICH CAMERA?</h3>
              <p><b>Laptop:</b> tilt the screen so the webcam sees your desk.</p>
              <p><b>Phone:</b> scan a QR code and prop it up looking at your desk. Best view!</p>
            </section>
            <section class="gm-panel">
              <h3>CONTROLS</h3>
              <p><span class="gm-kbd">← →</span> walk · <span class="gm-kbd">Space</span> jump</p>
              <p><span class="gm-kbd">↑ ↓</span> climb · <span class="gm-kbd">R</span> respawn · <span class="gm-kbd">P</span> pause</p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  `;

  paintArt(root);
  bindAbout(root);
  return () => {
    /* nothing to clean up */
  };
}
