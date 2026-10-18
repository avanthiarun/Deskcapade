import "./styles.css";
import { mountCapture } from "./pages/capture";
import { mountDesktop } from "./pages/desktop";
import { mountPhone } from "./pages/phone";
import { mountPlay } from "./pages/play";

const app = document.querySelector<HTMLDivElement>("#app")!;
let dispose: (() => void) | null = null;

function landing(): void {
  app.innerHTML = `
    <div class="landing">
      <h1>Deskcapade</h1>
      <p>Scan your desk with your phone and watch it on your laptop. Detected objects become platforms later.</p>
      <nav>
        <a href="/desktop"><strong>Laptop view</strong> — open this on your laptop, scan the QR code with your phone</a>
        <a href="/phone"><strong>Phone camera</strong> — streams your phone camera to the laptop</a>
        <a href="/capture"><strong>Capture</strong> — single-device test (camera + detection on one screen)</a>
        <a href="/play"><strong>Play</strong> — desktop game (stub)</a>
      </nav>
    </div>
  `;
}

function route(): void {
  dispose?.();
  dispose = null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
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
  landing();
}

document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest("a");
  if (!a) return;
  const url = new URL(a.href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  ev.preventDefault();
  history.pushState({}, "", url.pathname);
  route();
});

window.addEventListener("popstate", route);
route();