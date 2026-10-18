/**
 * STUB — desktop play view for later milestones (Creative / Expedition).
 * TODO: Phaser game mount, world from phone relay, co-op hooks.
 */
export function mountPlay(root: HTMLElement): () => void {
  root.innerHTML = `
    <div class="stub-page">
      <h1>Play</h1>
      <p>Desktop game view — not implemented in Milestone 1.</p>
      <p><a href="/">Back</a></p>
    </div>
  `;
  return () => undefined;
}
