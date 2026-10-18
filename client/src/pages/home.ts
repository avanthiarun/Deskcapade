import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";
import { drawPixelCat } from "../lib/sprites";

/**
 * Game modes. To change where a mode goes (or swap which mode does what),
 * edit `href` here and the paths in lib/routes.ts.
 */
const MODES = [
  { href: ROUTES.story, title: "Story", blurb: "Live camera adventure", alt: false },
  { href: ROUTES.challenge, title: "Challenge", blurb: "Snap one photo, beat the goal", alt: true },
] as const;

/** Home screen: title, a little cat, and the two game modes. */
export function mountHome(root: HTMLElement): () => void {
  injectGameStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-clouds" aria-hidden="true"><i></i><i></i><i></i></div>
      <section class="gm-hero">
        <canvas class="gm-cat" id="cat" aria-hidden="true"></canvas>
        <h1 class="gm-title">Deskcapade</h1>
        <p class="gm-tag">Point your camera at the world and see what wanders out of it.</p>
        <nav class="gm-menu" aria-label="Game modes">
          ${MODES.map(
            (m) =>
              `<a class="gm-btn${m.alt ? " alt" : ""}" href="${m.href}"><b>${m.title}</b><span>${m.blurb}</span></a>`,
          ).join("")}
        </nav>
      </section>
      <div class="gm-ground" aria-hidden="true"></div>
    </main>
  `;

  drawPixelCat(root.querySelector<HTMLCanvasElement>("#cat")!);

  return () => {
    /* nothing to clean up */
  };
}