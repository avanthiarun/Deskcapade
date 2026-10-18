/** Extra styles for Challenge mode's result screen (builds on gameStyles). */
const CSS = `
.ch-scene { border: 4px solid var(--ink); box-shadow: 0 6px 0 var(--ink); background: #000; }
.ch-scene canvas { display: block; width: 100%; height: auto; max-height: 72dvh; object-fit: contain; }
.ch-skipped { margin: 12px 0 0; font-size: 9px; }
.ch-controls { margin: 12px 0 0; font-size: 9px; }
.ch-shelf { margin-top: 18px; }
`;

let injected = false;

export function injectChallengeStyles(): void {
  if (injected) return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-ch", "true");
  el.textContent = CSS;
  document.head.appendChild(el);
}
