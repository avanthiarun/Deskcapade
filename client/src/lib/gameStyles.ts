const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap");

.gm {
  --ink: #2b1d3a; --sky: #5cb8ff; --sky2: #bfe8ff; --cream: #fff7e6;
  --orange: #ffb870; --orange2: #f08a30; --pink: #ff86a8; --mint: #a8e86c; --leaf: #5cbf5a;
  position: relative; min-height: 100dvh; overflow: hidden; color: var(--ink);
  font-family: "Press Start 2P", ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.7;
  background: linear-gradient(var(--sky), var(--sky2) 70%, #e8f7ff);
}
.gm *, .gm *::before, .gm *::after { box-sizing: border-box; }
.gm [hidden] { display: none !important; }
.gm a { color: inherit; }

.gm-wrap { position: relative; z-index: 1; max-width: 1000px; margin: 0 auto; padding: 18px 16px 48px; }

/* ---------- buttons ---------- */
.gm-btn { display: block; width: 100%; padding: 16px 18px; border: 4px solid var(--ink); border-radius: 0;
  background: var(--orange); color: var(--ink); font: inherit; text-align: left; text-decoration: none;
  cursor: pointer; box-shadow: 0 6px 0 var(--ink); transition: transform 80ms; }
.gm-btn b { display: block; margin-bottom: 8px; font-size: 15px; font-weight: 400; }
.gm-btn span { font-size: 9px; opacity: 0.8; }
.gm-btn.alt { background: var(--pink); }
.gm-btn.ghost { background: var(--cream); }
.gm-btn.small { display: inline-block; width: auto; padding: 12px 14px; font-size: 11px; }
.gm-btn:hover { transform: translateY(-2px); }
.gm-btn:active { transform: translateY(4px); box-shadow: 0 2px 0 var(--ink); }
.gm-btn:disabled { opacity: 0.5; cursor: default; transform: none; }
.gm-btn:focus-visible, .gm-back:focus-visible { outline: 4px solid #fff; outline-offset: 3px; }

/* ---------- home ---------- */
.gm-hero { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center;
  gap: 18px; padding: 8vh 20px 150px; text-align: center; }
.gm-cat { width: 128px; height: auto; image-rendering: pixelated; }
.gm-title { margin: 0; font-size: clamp(22px, 6vw, 40px); font-weight: 400; color: #fff; text-shadow: 4px 4px 0 var(--ink); }
.gm-tag { margin: 0; max-width: 30rem; font-size: 11px; }
.gm-menu { display: grid; gap: 20px; width: min(420px, 100%); margin-top: 8px; }

.gm-ground { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; z-index: 0;
  background: repeating-linear-gradient(90deg, var(--orange) 0 24px, var(--orange2) 24px 48px);
  border-top: 14px solid var(--leaf); box-shadow: inset 0 8px 0 var(--mint); }

.gm-clouds i { position: absolute; left: -160px; width: 96px; height: 28px; background: #fff;
  box-shadow: 24px -16px 0 #fff, 56px -8px 0 #fff; }
.gm-clouds i:nth-child(1) { top: 12%; }
.gm-clouds i:nth-child(2) { top: 30%; transform: scale(0.7); left: 30%; }
.gm-clouds i:nth-child(3) { top: 52%; left: 70%; }
@media (prefers-reduced-motion: no-preference) {
  .gm-clouds i { animation: gm-drift 60s linear infinite; }
  .gm-clouds i:nth-child(2) { animation-duration: 90s; animation-delay: -30s; }
  .gm-clouds i:nth-child(3) { animation-duration: 75s; animation-delay: -50s; }
  .gm-cat { animation: gm-bob 1.2s steps(2) infinite; }
  @keyframes gm-drift { from { translate: 0 0; } to { translate: calc(100vw + 320px) 0; } }
  @keyframes gm-bob { 50% { transform: translateY(-6px); } }
}

/* ---------- play pages ---------- */
.gm-back { display: inline-block; margin-bottom: 14px; padding: 8px 10px; font-size: 10px; text-decoration: none;
  background: var(--cream); border: 3px solid var(--ink); }
.gm-h1 { margin: 4px 0 12px; font-size: 22px; font-weight: 400; color: #fff; text-shadow: 3px 3px 0 var(--ink); }
.gm-note { margin: 0 0 16px; font-size: 10px; }
.gm-goal { display: inline-block; margin: 0 0 16px; padding: 10px 14px; font-size: 11px;
  background: var(--cream); border: 4px solid var(--ink); }
.gm-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }

.gm-stage { border: 4px solid var(--ink); box-shadow: 0 6px 0 var(--ink); background: #000; }
.gm-stage canvas { display: block; width: 100%; height: auto; max-height: 70dvh; object-fit: contain; }
.gm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 18px; }
.gm-chip { padding: 8px 10px; font-size: 9px; background: var(--cream); border: 3px solid var(--ink); }
.gm-chip.on { background: var(--mint); }

.gm-connect { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 18px; padding: 14px;
  background: var(--cream); border: 4px solid var(--ink); }
.gm-connect img { width: 160px; height: 160px; background: #fff; border: 3px solid var(--ink); image-rendering: pixelated; }
.gm-connect p { margin: 0 0 8px; font-size: 10px; }
.gm-url { word-break: break-all; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }

.gm-verdict { margin-bottom: 16px; padding: 14px; font-size: 14px; text-align: center; border: 4px solid var(--ink); }
.gm-verdict.win { background: var(--mint); }
.gm-verdict.lose { background: var(--pink); }
.gm-result { display: grid; grid-template-columns: minmax(0, 260px) 1fr; gap: 16px; align-items: start; }
@media (max-width: 700px) { .gm-result { grid-template-columns: 1fr; } }
.gm-photo { border: 4px solid var(--ink); background: #000; }
.gm-photo canvas { display: block; width: 100%; height: auto; }
.gm-shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
.gm-item { display: grid; gap: 8px; justify-items: center; padding: 10px; font-size: 8px; text-align: center;
  word-break: break-word; background: var(--cream); border: 4px solid var(--ink); }
.gm-px { width: 88px; height: 88px; object-fit: contain; image-rendering: pixelated; }
.gm-empty { grid-column: 1 / -1; padding: 14px; font-size: 10px; background: var(--cream); border: 4px solid var(--ink); }

.gm-toast { position: fixed; left: 50%; bottom: 20px; z-index: 5; transform: translateX(-50%);
  max-width: min(92vw, 520px); padding: 12px 16px; font-size: 10px; background: var(--pink); border: 4px solid var(--ink); }
.gm .hidden-video { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
`;

let injected = false;

export function injectGameStyles(): void {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-gm", "true");
  el.textContent = CSS;
  document.head.appendChild(el);
}