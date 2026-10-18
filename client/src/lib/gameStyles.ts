/* ------------------------------------------------------------------
   The look of every screen: a cozy pixel farm-game shell. Sky with pixel clouds, a green hill
   and pixel trees behind everything; cream cards with dark borders and colored offset shadows;
   dark wooden panels; chunky pixel buttons.
   ------------------------------------------------------------------ */

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Pixelify+Sans:wght@400;600&display=swap");

.gm {
  --ink: #2b1d14; --wood: #3b2a17; --wood2: #2a1d0f; --wood-line: #57401f; --cream: #fff7e6; --cream2: #f3e6c8;
  --sky: #8fc4ec; --sky2: #cfe8f5; --leaf: #5cbf5a; --leaf2: #3f9e45; --mint: #a8e86c; --gold: #ffd84a;
  --red: #e0504a; --blue: #4a8fd6; --pink: #ff86a8; --text-dark: #2b1d14; --text-light: #f6ecd6;
  position: relative; min-height: 100dvh; overflow-x: hidden; color: var(--text-dark);
  font-family: "Pixelify Sans", ui-monospace, Consolas, monospace; font-size: 16px; line-height: 1.6;
  background: linear-gradient(var(--sky), var(--sky2) 75%, #e4f3fb);
}
.gm *, .gm *::before, .gm *::after { box-sizing: border-box; }
.gm [hidden] { display: none !important; }
.gm a:not([class]) { color: inherit; }
.gm h1, .gm h2, .gm h3 { font-family: "Press Start 2P", monospace; font-weight: 400; margin: 0; }
.gm button { font: inherit; }
.gm :focus-visible { outline: 3px solid #fff; outline-offset: 2px; }

/* ---------- scenery behind everything ---------- */
.gm-scenery { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.gm-cloud { position: absolute; width: 72px; height: 22px; background: #fff; opacity: 0.9;
  box-shadow: 16px -12px 0 #fff, 40px -6px 0 #fff, 8px 6px 0 #eaf5fc; }
.gm-hill { position: absolute; left: -10%; right: -10%; bottom: -55vh; height: 75vh; border-radius: 50%;
  background: var(--leaf2); box-shadow: inset 0 14px 0 var(--leaf); }
.gm-tree { position: absolute; image-rendering: pixelated; }
@media (prefers-reduced-motion: no-preference) {
  .gm-cloud { animation: gm-drift 90s linear infinite; }
  @keyframes gm-drift { from { transform: translateX(-30vw); } to { transform: translateX(130vw); } }
  .gm-bob { animation: gm-bob 1.4s steps(2) infinite; }
  @keyframes gm-bob { 50% { transform: translateY(-4px); } }
}
.gm-page { position: relative; z-index: 1; }

/* ---------- top bars ---------- */
.gm-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; }
.gm-logo { display: flex; align-items: center; gap: 10px; padding: 6px 12px 6px 8px; text-decoration: none;
  font-family: "Press Start 2P", monospace; font-size: 12px; line-height: 1.35; color: var(--ink);
  background: var(--cream); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); }
.gm-logo canvas { width: 28px; image-rendering: pixelated; }
.gm-header-right { display: flex; align-items: center; gap: 10px; }
.gm-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; font-family: "Press Start 2P", monospace;
  font-size: 9px; background: var(--cream); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); white-space: nowrap; }
.gm-iconbtn { display: inline-grid; place-items: center; width: 36px; height: 36px; padding: 0; cursor: pointer;
  font-family: "Press Start 2P", monospace; font-size: 13px; text-decoration: none; color: var(--ink);
  background: var(--cream); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); }
.gm-iconbtn:active, .gm-btn:active, .gm-card:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }

/* ---------- buttons ---------- */
.gm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 18px; cursor: pointer;
  font-family: "Press Start 2P", monospace; font-size: 11px; text-decoration: none; color: var(--text-light);
  background: var(--wood); border: 3px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); }
.gm-btn:hover { filter: brightness(1.1); }
.gm-btn:disabled { opacity: 0.5; cursor: default; filter: none; }
.gm-btn.blue { background: var(--blue); }
.gm-btn.green { background: var(--leaf2); }
.gm-btn.cream { background: var(--cream); color: var(--ink); }
.gm-btn.red { background: var(--red); }
.gm-btn.small { padding: 8px 12px; font-size: 9px; }
.gm-btn.wide { width: 100%; }

/* ---------- home ---------- */
.gm-hero { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 4vh 20px 40px; text-align: center; }
.gm-tagchip { padding: 6px 12px; font-family: "Press Start 2P", monospace; font-size: 9px; background: var(--cream);
  border: 3px solid var(--ink); }
.gm-titlerow { display: flex; align-items: center; gap: 14px; }
.gm-titlerow canvas { width: 44px; image-rendering: pixelated; }
.gm-title { font-size: clamp(26px, 6.5vw, 64px); line-height: 1.1; letter-spacing: -1px;
  background: linear-gradient(180deg, var(--gold) 0 50%, #7ad957 50% 100%); -webkit-background-clip: text; background-clip: text;
  color: transparent; filter: drop-shadow(3px 3px 0 var(--ink)) drop-shadow(-1px -1px 0 var(--ink)); }
.gm-tagline { max-width: 34rem; margin: 0; font-size: 18px; color: #fff; text-shadow: 2px 2px 0 rgba(43, 29, 20, 0.6); }
.gm-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 28px; width: min(780px, 100%); margin-top: 18px; }
.gm-card { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; text-align: left; text-decoration: none;
  color: var(--ink); background: var(--cream); border: 4px solid var(--ink); box-shadow: 8px 8px 0 var(--leaf2); cursor: pointer; }
.gm-card.challenge { box-shadow: 8px 8px 0 #8e2f2a; }
.gm-card:hover { transform: translate(-2px, -2px); }
.gm-card-top { display: flex; justify-content: space-between; align-items: center; }
.gm-tag { padding: 3px 8px; font-family: "Press Start 2P", monospace; font-size: 8px; color: #fff; background: var(--leaf2); border: 2px solid var(--ink); }
.gm-tag.red { background: var(--red); }
.gm-new { font-family: "Press Start 2P", monospace; font-size: 8px; }
.gm-card-head { display: flex; align-items: center; gap: 12px; }
.gm-card-head canvas { width: 32px; image-rendering: pixelated; }
.gm-card h2 { font-size: 15px; }
.gm-card p { margin: 0; font-size: 15px; }
.gm-card-play { align-self: flex-end; font-family: "Press Start 2P", monospace; font-size: 10px; }
.gm-home-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; margin-top: 18px; }

/* ---------- dark wooden panels (how to play, credits, side panels) ---------- */
.gm-panel { color: var(--text-light); background: var(--wood); border: 4px solid var(--wood2); box-shadow: 6px 6px 0 var(--ink); }
.gm-sheet { width: min(860px, calc(100% - 32px)); margin: 8px auto 60px; padding: 28px; }
.gm-sheet h1 { font-size: 22px; color: var(--mint); margin-bottom: 14px; }
.gm-sheet > p { margin: 0 0 18px; }
.gm-steps { display: grid; gap: 18px; margin: 18px 0 26px; }
.gm-step { display: grid; grid-template-columns: 40px 1fr; gap: 14px; align-items: start; }
.gm-step-n { display: grid; place-items: center; width: 36px; height: 36px; font-family: "Press Start 2P", monospace; font-size: 11px;
  color: var(--mint); background: var(--wood2); border: 3px solid var(--ink); }
.gm-step h3 { font-size: 11px; margin: 6px 0 6px; color: #fff; }
.gm-step p { margin: 0; font-size: 15px; }
.gm-subcards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.gm-subcard { padding: 16px; color: var(--ink); background: var(--cream);
  background-image: repeating-linear-gradient(90deg, transparent 0 6px, rgba(43, 29, 20, 0.05) 6px 7px); border: 3px solid var(--ink); }
.gm-subcard h3 { font-size: 10px; margin-bottom: 10px; }
.gm-subcard ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 15px; }
.gm-subcard li { display: flex; gap: 10px; align-items: center; }
.gm-subcard li canvas { width: 28px; height: 28px; image-rendering: pixelated; flex: none; }
.gm-kbd { display: inline-block; min-width: 22px; padding: 1px 6px; font-family: "Press Start 2P", monospace; font-size: 9px;
  text-align: center; color: var(--ink); background: #fff; border: 2px solid var(--ink); }
.gm-levels { display: grid; gap: 8px; font-size: 15px; }
.gm-levels b { font-family: "Press Start 2P", monospace; font-size: 9px; }

/* ---------- modal ("?" button) ---------- */
.gm-modal { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(20, 14, 8, 0.55); }
.gm-modal .gm-panel { width: min(520px, 100%); padding: 24px; }
.gm-modal h2 { font-size: 14px; color: var(--mint); margin-bottom: 12px; }
.gm-modal p { margin: 0 0 12px; }
.gm-modal-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 16px; }

/* ---------- character picker ---------- */
.gm-chargrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }
.gm-charbtn { display: grid; justify-items: center; gap: 6px; padding: 10px 6px; cursor: pointer; color: var(--ink);
  font-family: "Press Start 2P", monospace; font-size: 8px; background: var(--cream); border: 3px solid var(--ink); }
.gm-charbtn canvas { width: 48px; image-rendering: pixelated; }
.gm-charbtn[aria-pressed="true"] { background: var(--mint); outline: 3px solid var(--gold); outline-offset: 1px; }
.gm-charbtn:hover { filter: brightness(1.05); }

/* ---------- play screens ---------- */
.gm-topbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; padding: 14px 20px; }
.gm-topbar-left { display: flex; align-items: center; gap: 10px; }
.gm-topbar-right { display: flex; justify-content: flex-end; gap: 10px; }
.gm-modechip { padding: 9px 12px; font-family: "Press Start 2P", monospace; font-size: 10px; color: var(--text-light);
  background: var(--wood); border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); }
.gm-stats { display: flex; gap: 8px; }
.gm-stat { display: grid; min-width: 78px; padding: 4px 10px; color: var(--text-light); background: var(--wood);
  border: 3px solid var(--ink); box-shadow: 3px 3px 0 var(--ink); }
.gm-stat small { font-family: "Press Start 2P", monospace; font-size: 7px; opacity: 0.8; }
.gm-stat b { font-family: "Press Start 2P", monospace; font-size: 12px; font-weight: 400; color: var(--mint); }
.gm-playarea { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; width: min(1320px, calc(100% - 32px)); margin: 0 auto 40px; }
@media (max-width: 960px) { .gm-playarea { grid-template-columns: 1fr; } .gm-topbar { grid-template-columns: 1fr; } .gm-stats { flex-wrap: wrap; } }
.gm-stage { position: relative; min-height: 340px; display: grid; place-items: center; background: #1d140b;
  border: 4px solid var(--ink); box-shadow: 6px 6px 0 var(--ink); overflow: hidden; }
.gm-stage canvas { display: block; width: 100%; height: auto; max-height: 76dvh; object-fit: contain; image-rendering: pixelated; }
.gm-stage-msg { display: grid; justify-items: center; gap: 14px; max-width: 460px; padding: 30px 20px; text-align: center; color: var(--text-light); }
.gm-stage-msg h2 { font-size: 13px; color: #fff; }
.gm-stage-msg p { margin: 0; font-size: 15px; }
.gm-stage-choices { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; }
.gm-stage-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(20, 14, 8, 0.6); }
.gm-side { display: grid; align-content: start; gap: 16px; }
.gm-side .gm-panel { padding: 14px 16px; font-size: 15px; }
.gm-side h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 10px; color: #fff; }
.gm-side h3::before { content: ""; width: 8px; height: 8px; background: var(--leaf); }
.gm-side p { margin: 0 0 8px; }
.gm-side .tip { color: var(--gold); }
.gm-side-buttons { display: grid; gap: 10px; }
.gm-levelpick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gm-levelpick .gm-btn { padding: 10px 6px; font-size: 9px; }
.gm-levelpick .gm-btn[aria-pressed="true"] { outline: 3px solid var(--gold); outline-offset: 1px; }
.gm-level-easy { background: var(--leaf2); }
.gm-level-medium { background: #c98a2a; }
.gm-level-hard { background: var(--red); }
.gm-level-boss { background: #7a4cc2; }
.gm-switch { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; cursor: pointer;
  font-family: "Press Start 2P", monospace; font-size: 9px; color: var(--text-light); background: var(--wood2); border: 3px solid var(--ink); }
.gm-switch span:last-child { padding: 2px 6px; color: var(--ink); background: var(--cream2); }
.gm-switch[aria-pressed="true"] span:last-child { background: var(--mint); }
.gm-qr { display: grid; justify-items: center; gap: 10px; }
.gm-qr img { width: 150px; height: 150px; background: #fff; border: 3px solid var(--ink); image-rendering: pixelated; }
.gm-url { word-break: break-all; font-size: 13px; color: var(--gold); }
.gm-best { font-size: 14px; color: var(--gold); }

.gm-toast { position: fixed; left: 50%; bottom: 20px; z-index: 30; transform: translateX(-50%); max-width: min(92vw, 520px);
  padding: 12px 16px; font-size: 15px; color: var(--ink); background: var(--cream); border: 3px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); }
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
