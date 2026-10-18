import "./styles.css";
import { mountCapture } from "./pages/capture";
import { mountChallenge } from "./pages/challenge";
import { mountCredits } from "./pages/credits";
import { mountHow } from "./pages/how";
import { mountDesktop } from "./pages/desktop";
import { mountHome } from "./pages/home";
import { mountPhone } from "./pages/phone";
import { mountPlay } from "./pages/play";
import { mountStory } from "./pages/story";

const app = document.querySelector<HTMLDivElement>("#app")!;
let dispose: (() => void) | null = null;

function route(): void {
  dispose?.();
  dispose = null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  // "/" is the home screen. /story and /challenge are the two game modes.
  // /capture and /desktop are Story's live-camera pages; /phone is what the QR code opens on the phone.
  if (path === "/story") {
    dispose = mountStory(app);
    return;
  }
  if (path === "/how-to-play") {
    dispose = mountHow(app);
    return;
  }
  if (path === "/credits") {
    dispose = mountCredits(app);
    return;
  }
  if (path === "/challenge") {
    dispose = mountChallenge(app);
    return;
  }
  if (path === "/desktop") {
    dispose = mountDesktop(app);
    return;
  }
  if (path === "/phone") {
    dispose = mountPhone(app);
    return;
  }
  if (path === "/capture") {
    dispose = mountCapture(app);
    return;
  }
  if (path === "/play") {
    dispose = mountPlay(app);
    return;
  }
  // Home screen (also the fallback for unknown addresses).
  dispose = mountHome(app);
}

document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest("a");
  if (!a) return;
  const url = new URL(a.href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  ev.preventDefault();
  history.pushState({}, "", url.pathname);
  window.scrollTo(0, 0);
  route();
});

window.addEventListener("popstate", route);
route();