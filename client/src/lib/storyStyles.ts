/** Extra styles for Story's live pages, on top of gameStyles (so Story looks like Challenge). */
const CSS = `
.gm-chip.warn { background: var(--pink); }
.st-controls { margin: 14px 0 0; font-size: 9px; }
.st-detected { display: inline-block; margin-top: 14px; padding: 10px 14px; font-size: 10px; line-height: 1.8;
  background: var(--cream); border: 4px solid var(--ink); }
.st-connect { margin-top: 18px; padding: 14px; background: var(--cream); border: 4px solid var(--ink); }
.st-connect summary { cursor: pointer; font-size: 11px; }
.st-connect-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; margin-top: 14px; }
.st-connect img { width: 160px; height: 160px; background: #fff; border: 3px solid var(--ink); image-rendering: pixelated; }
.st-fields { display: grid; gap: 12px; flex: 1; min-width: min(260px, 100%); }
.st-fields p { margin: 0; font-size: 10px; }
.st-fields label { display: grid; gap: 6px; font-size: 9px; }
.st-fields select, .st-fields input { width: 100%; padding: 8px; font: 12px ui-monospace, Consolas, monospace;
  color: var(--ink); background: #fff; border: 3px solid var(--ink); border-radius: 0; }
.st-fields select:focus-visible, .st-fields input:focus-visible, .st-connect summary:focus-visible {
  outline: 4px solid #fff; outline-offset: 2px; }
`;

let injected = false;

export function injectStoryStyles(): void {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-st", "true");
  el.textContent = CSS;
  document.head.appendChild(el);
}
