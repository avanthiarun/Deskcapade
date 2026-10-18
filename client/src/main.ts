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
      <p>Scan your desk with a camera and watch it live. Detected objects become platforms later.</p>
      <nav>
        <a href="/capture"><strong>Laptop camera</strong> — use this computer's camera to detect objects</a>
        <a href="/desktop"><strong>Phone camera</strong> — scan the QR code to stream your phone's camera here</a>
      </nav>
    </div>
  `;
}

function route(): void {
  dispose?.();
  dispose = null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  // /phone is the page the QR code opens on the phone; /play is still reachable by URL.
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