import { injectGameStyles } from "../lib/gameStyles";
import { ROUTES } from "../lib/routes";

/**
 * Story mode: pick the camera, then you land on the live-video page you already have
 * (capture.ts for the laptop camera, desktop.ts for the phone camera).
 */
export function mountStory(root: HTMLElement): () => void {
  injectGameStyles();

  root.innerHTML = `
    <main class="gm">
      <div class="gm-wrap">
        <a class="gm-back" href="${ROUTES.home}">◀ Home</a>
        <h1 class="gm-h1">Story</h1>
        <p class="gm-note">Live camera, pixel world. A mug can become a duck pond with a waterslide; a bowl can turn into lava. The hero reacts to whatever is on the desk.</p>
        <div class="gm-choices">
          <a class="gm-btn" href="${ROUTES.storyLaptop}"><b>Laptop camera</b><span>Use this computer's camera</span></a>
          <a class="gm-btn alt" href="${ROUTES.storyPhone}"><b>Phone camera</b><span>Use your phone as the camera</span></a>
        </div>
      </div>
    </main>
  `;

  return () => {
    /* nothing to clean up */
  };
}