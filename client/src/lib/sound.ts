/* ------------------------------------------------------------------
   Chiptune sound effects and a little looping tune, synthesized with Web Audio (no files).
   Browsers only allow sound after you click or press a key, so the audio wakes up on the first
   one. A 🔊 / 🔇 button anywhere on the page mutes everything (remembered in this browser).
   ------------------------------------------------------------------ */

const MUTE_KEY = "deskcapade.muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* storage unavailable */
}

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// wake the audio on the first click / key press (browsers block sound before that)
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => audio(), { once: true, capture: true });

/** One note: `freq` Hz (sliding to `to`), `dur` seconds, starting `at` seconds from now. */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; at?: number } = {}): void {
  const ac = audio();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + (opts.at ?? 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  gain.gain.setValueAtTime(opts.vol ?? 0.12, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A burst of noise (splashes, crumbles, sizzles). */
function noise(dur: number, vol = 0.1, at = 0, lowpass = 2000): void {
  const ac = audio();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + at;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpass;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

export type Sfx =
  | "jump" | "coin" | "seed" | "bounce" | "stomp" | "hurt" | "splash" | "fire" | "crumble"
  | "win" | "timeup" | "bloom" | "snap" | "click";

export function sfx(name: Sfx): void {
  if (muted) return;
  switch (name) {
    case "jump":
      tone(330, 0.14, { to: 660, vol: 0.08 });
      break;
    case "coin":
      tone(988, 0.07, { vol: 0.09 });
      tone(1319, 0.16, { vol: 0.09, at: 0.07 });
      break;
    case "seed":
      tone(784, 0.08, { type: "triangle", vol: 0.14 });
      tone(1175, 0.14, { type: "triangle", vol: 0.12, at: 0.07 });
      break;
    case "bounce":
      tone(200, 0.22, { type: "triangle", to: 700, vol: 0.16 });
      break;
    case "stomp":
      tone(260, 0.1, { to: 90, vol: 0.14 });
      noise(0.08, 0.08, 0, 900);
      break;
    case "hurt":
      tone(440, 0.4, { type: "sawtooth", to: 110, vol: 0.08 });
      break;
    case "splash":
      noise(0.35, 0.12, 0, 1400);
      tone(600, 0.2, { type: "sine", to: 200, vol: 0.08 });
      break;
    case "fire":
      noise(0.4, 0.09, 0, 3000);
      break;
    case "crumble":
      noise(0.3, 0.1, 0, 500);
      break;
    case "win":
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.4 : 0.12, { vol: 0.1, at: i * 0.11 }));
      break;
    case "timeup":
      [523, 466, 415, 349].forEach((f, i) => tone(f, 0.18, { type: "triangle", vol: 0.14, at: i * 0.16 }));
      break;
    case "bloom":
      [523, 659, 784, 988, 1175].forEach((f, i) => tone(f, 0.2, { type: "triangle", vol: 0.12, at: i * 0.08 }));
      break;
    case "snap":
      noise(0.05, 0.15, 0, 6000);
      tone(1800, 0.05, { vol: 0.05 });
      break;
    case "click":
      tone(660, 0.04, { vol: 0.05 });
      break;
  }
}

/* ---------- a gentle looping tune ---------- */

// a cozy pentatonic tune (0 = rest), 8th notes, and a bass note per beat
const MELODY = [523, 659, 784, 659, 880, 784, 659, 0, 587, 698, 784, 698, 659, 587, 523, 0,
  523, 659, 784, 880, 1047, 880, 784, 0, 698, 659, 587, 659, 523, 0, 0, 0];
const BASS = [131, 131, 165, 165, 147, 147, 131, 131, 131, 131, 175, 175, 147, 147, 131, 131];
const STEP_S = 0.2;

let musicTimer: number | undefined;
let nextStepAt = 0;
let step = 0;

function scheduleMusic(): void {
  const ac = audio();
  if (!ac) return;
  // schedule a little ahead of time, so the tune keeps steady time
  while (nextStepAt < ac.currentTime + 0.3) {
    const at = Math.max(0, nextStepAt - ac.currentTime);
    const note = MELODY[step % MELODY.length]!;
    if (note && !muted) tone(note, STEP_S * 0.9, { type: "square", vol: 0.025, at });
    if (step % 2 === 0 && !muted) tone(BASS[(step / 2) % BASS.length]!, STEP_S * 1.8, { type: "triangle", vol: 0.06, at });
    nextStepAt += STEP_S;
    step++;
  }
}

export const music = {
  start(): void {
    if (musicTimer !== undefined) return;
    const ac = audio();
    nextStepAt = (ac?.currentTime ?? 0) + 0.1;
    step = 0;
    musicTimer = window.setInterval(scheduleMusic, 100);
  },
  stop(): void {
    window.clearInterval(musicTimer);
    musicTimer = undefined;
  },
};

export const isMuted = (): boolean => muted;

export function setMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** Wire every `[data-sound]` button under `root` as the 🔊 / 🔇 toggle. */
export function bindSoundToggle(root: HTMLElement): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-sound]")) {
    const render = (): void => {
      btn.textContent = muted ? "🔇" : "🔊";
      btn.setAttribute("aria-label", muted ? "Sound off (click to turn on)" : "Sound on (click to mute)");
    };
    render();
    btn.addEventListener("click", () => {
      setMuted(!muted);
      render();
      btn.blur();
    });
  }
}
