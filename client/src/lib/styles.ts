const CSS = `
:root {
  --dc-bg: #1f1a33;
  --dc-panel: #2c2547;
  --dc-line: #433a6b;
  --dc-text: #fbf3e8;
  --dc-dim: #b9b0d4;
  --dc-peach: #ffb870;
  --dc-pink: #ff86a8;
  --dc-mint: #8fe3b4;
  --dc-bad: #ff6b6b;
}
.dc-page { box-sizing: border-box; min-height: 100dvh; margin: 0; padding: 16px;
  background: var(--dc-bg); color: var(--dc-text);
  font: 16px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
.dc-page *, .dc-page *::before, .dc-page *::after { box-sizing: inherit; }
.dc-page h1 { margin: 0 0 4px; font-size: 1.5rem; }
.dc-page p { margin: 0; color: var(--dc-dim); }

.dc-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0; }
.dc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
  border-radius: 999px; background: var(--dc-panel); border: 1px solid var(--dc-line);
  font-size: 0.85rem; color: var(--dc-dim); }
.dc-chip.on { color: var(--dc-text); border-color: var(--dc-mint); }
.dc-chip.warn { color: var(--dc-peach); border-color: var(--dc-peach); }
.dc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dc-dim); }
.on .dc-dot { background: var(--dc-mint); }
.warn .dc-dot { background: var(--dc-peach); }

.dc-btn { appearance: none; border: 0; border-radius: 10px; padding: 10px 16px;
  background: var(--dc-peach); color: #2a1c0a; font: inherit; font-weight: 600; cursor: pointer; }
.dc-btn:hover { background: #ffc78d; }
.dc-btn:focus-visible, .dc-page select:focus-visible, .dc-page input:focus-visible,
.dc-page summary:focus-visible { outline: 3px solid var(--dc-pink); outline-offset: 2px; }
.dc-btn.ghost { background: var(--dc-panel); color: var(--dc-text); border: 1px solid var(--dc-line); }
.dc-btn.ghost:hover { background: var(--dc-line); }
.dc-btn:disabled { opacity: 0.5; cursor: default; }

.dc-page select, .dc-page input[type="text"] { padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dc-line); background: var(--dc-panel); color: var(--dc-text); font: inherit; }
.dc-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }

.dc-stage { position: relative; max-width: 960px; border: 1px solid var(--dc-line);
  border-radius: 14px; overflow: hidden; background: #120f20; }
.dc-stage canvas, .dc-stage video { display: block; width: 100%; height: auto; }
.dc-banner { position: absolute; left: 12px; top: 12px; padding: 6px 12px; border-radius: 999px;
  background: var(--dc-mint); color: #0c2a1a; font-weight: 700; }
.dc-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
  max-width: min(92vw, 520px); padding: 10px 16px; border-radius: 10px;
  background: var(--dc-bad); color: #2b0606; font-weight: 600; }
.dc-hidden { display: none !important; }

.dc-connect { margin-top: 16px; max-width: 960px; border: 1px solid var(--dc-line);
  border-radius: 14px; background: var(--dc-panel); padding: 12px 16px; }
.dc-connect summary { cursor: pointer; font-weight: 600; }
.dc-connect-body { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; margin-top: 12px; }
.dc-connect img { width: 180px; height: 180px; border-radius: 10px; background: #fff; }
.dc-connect-fields { display: grid; gap: 10px; min-width: 260px; flex: 1; }
.dc-connect label { display: grid; gap: 4px; color: var(--dc-dim); font-size: 0.85rem; }
.dc-url { word-break: break-all; color: var(--dc-text); font-family: ui-monospace, Consolas, monospace; }

.dc-phone video { width: 100%; max-height: 62dvh; object-fit: cover; border-radius: 14px; background: #120f20; }
.dc-phone .dc-bar { justify-content: space-between; }

@media (prefers-reduced-motion: no-preference) {
  .dc-banner { animation: dc-pop 0.25s ease-out; }
  @keyframes dc-pop { from { transform: scale(0.85); opacity: 0; } to { transform: none; opacity: 1; } }
}
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-dc", "true");
  el.textContent = CSS;
  document.head.appendChild(el);
}