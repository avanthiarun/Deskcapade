import type { ObjectKind } from "../game/materials";
import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { bindAbout, paintArt, sceneryHTML } from "../lib/shell";

/** What each desk thing turns into, for the "Desk pieces" card. */
const PIECES: readonly [string, ObjectKind, string][] = [
  ["Can", "vine", "a tower with a vine to climb"],
  ["Cup, mug, bowl, glass", "pool", "a pool to swim in, with a ladder and a slide"],
  ["Phone", "rockwall", "a rock wall: climb its ladder"],
  ["Pencil", "woodbridge", "a wooden bridge"],
  ["Pen", "stonepath", "a stone bridge"],
  ["Eraser, small cube", "mushroom", "a bouncy mushroom"],
  ["Sticky note", "jello", "a jello blob: wade through it, slowly"],
  ["Scissors, knife", "spikes", "spikes: ouch!"],
  ["Spoon, fork", "rail", "a thin rail to stand on"],
  ["Eyeglasses", "river", "a river: hop the stepping stones or splash!"],
  ["Plastic water bottle", "icepatch", "an icy patch: you slide and can't jump"],
  ["Mouse", "trampoline", "a trampoline"],
  ["Keyboard", "conveyor", "a conveyor belt"],
  ["Lamp", "updraft", "a lantern whose warm air lifts you"],
  ["Bottle", "geyser", "a fountain that erupts"],
  ["Anything else", "platform", "the AI picks the closest thing on this list"],
];

/** How to play: the steps, the controls, the desk pieces and the Challenge levels. */
export function mountHow(root: HTMLElement): () => void {
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
          <h1>How to play</h1>
          <p>Deskcapades turns your camera's view of your desk into a pixel adventure. Here's the gist.</p>

          <div class="gm-steps">
            <div class="gm-step"><span class="gm-step-n">1</span><div>
              <h3>📷 Point a camera at your desk</h3>
              <p>Use your laptop's webcam, or scan the QR code with your phone and prop it up so it looks at your desk.
                Bird's-eye works great for flat things, side-on for tall ones. Only things fully in view on the desk count.</p>
            </div></div>
            <div class="gm-step"><span class="gm-step-n">2</span><div>
              <h3>🌱 Watch your desk sprout</h3>
              <p>Every object becomes a piece of the world, in its own color and at its real size: your can grows into a vine tower,
                your mug fills into a pool.</p>
            </div></div>
            <div class="gm-step"><span class="gm-step-n">3</span><div>
              <h3>⏱ Explore or race</h3>
              <p>In <b>Story</b>, roam freely and collect golden seeds; move things on your desk and the world changes live.
                In <b>Challenge</b>, snap a photo, pick a level, grab every coin and reach the flag as fast as you can.</p>
            </div></div>
          </div>

          <div class="gm-subcards">
            <section class="gm-subcard">
              <h3>CONTROLS</h3>
              <ul>
                <li><span class="gm-kbd">← →</span> or <span class="gm-kbd">A D</span> walk</li>
                <li><span class="gm-kbd">Space</span> jump (hold for higher)</li>
                <li><span class="gm-kbd">↑ ↓</span> climb vines and ladders</li>
                <li><span class="gm-kbd">↓</span> drop through a ledge</li>
                <li><span class="gm-kbd">R</span> back to the start</li>
                <li><span class="gm-kbd">P</span> pause</li>
              </ul>
            </section>
            <section class="gm-subcard">
              <h3>CHALLENGE LEVELS</h3>
              <div class="gm-levels">
                <div><b>🌱 EASY</b> plenty of stepping stones, no hazards.</div>
                <div><b>🌿 MEDIUM</b> spikes, sliding ledges and a beetle.</div>
                <div><b>🔥 HARD</b> spikes and lava, crumbling ledges, no helping hand.</div>
                <div><b>👑 BOSS</b> everything at once. Stomp the beetles!</div>
              </div>
            </section>
            <section class="gm-subcard" style="grid-column: 1 / -1">
              <h3>DESK PIECES</h3>
              <ul style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
                ${PIECES.map(([what, kind, becomes]) => `<li><canvas data-art="piece:${kind}" aria-hidden="true"></canvas><span><b>${what}</b>: ${becomes}</span></li>`).join("")}
              </ul>
            </section>
          </div>

          <div class="gm-home-actions">
            <a class="gm-btn green" href="${ROUTES.story}">▶ Play Story</a>
            <a class="gm-btn red" href="${ROUTES.challenge}">⏱ Play Challenge</a>
          </div>
        </article>
      </div>
    </main>
  `;
  paintArt(root);
  bindAbout(root);
  return () => undefined;
}
