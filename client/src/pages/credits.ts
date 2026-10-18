import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { bindAbout, paintArt, sceneryHTML } from "../lib/shell";

/** Credits: who made it and what it's built with. */
export function mountCredits(root: HTMLElement): () => void {
  injectGameStyles();
  root.innerHTML = `
    <main class="gm">
      ${sceneryHTML()}
      <div class="gm-page">
        <header class="gm-header">
          <a class="gm-btn small cream" href="${ROUTES.home}">← Back</a>
          <button class="gm-iconbtn" type="button" data-about aria-label="What is Deskcapades?">?</button>
        </header>

        <article class="gm-panel gm-sheet">
          <h1>Credits</h1>
          <p>Deskcapades was made at DubHacks 2026, for everyone who has ever stared at their desk wishing it were more fun.</p>
          <div class="gm-subcards">
            <section class="gm-subcard">
              <h3>MADE BY</h3>
              <ul>
                <li><canvas data-art="char:sprout" aria-hidden="true"></canvas>Avanthika Arun</li>
                <li><canvas data-art="char:strawberry" aria-hidden="true"></canvas>Prathiyanka Arun</li>
                <li><canvas data-art="char:bunny" aria-hidden="true"></canvas>Ria Kharade</li>
              </ul>
            </section>
            <section class="gm-subcard">
              <h3>POWERED BY</h3>
              <ul>
                <li>👁 Perceptron: spotting what's on your desk</li>
                <li>✨ Google Gemini: designing Challenge courses</li>
                <li>🎨 Every pixel drawn in code, no image files</li>
              </ul>
            </section>
            <section class="gm-subcard">
              <h3>SPECIAL THANKS</h3>
              <ul>
                <li>☕ The coffee mug that became the first pool</li>
                <li>✏️ Every pencil that agreed to be a bridge</li>
                <li>🎮 You, for playing</li>
              </ul>
            </section>
          </div>
          <div class="gm-home-actions">
            <a class="gm-btn green" href="${ROUTES.home}">⌂ Back to the title</a>
          </div>
        </article>
      </div>
    </main>
  `;
  paintArt(root);
  bindAbout(root);
  return () => undefined;
}
