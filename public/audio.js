// Sound for the sky, synthesised live with the Web Audio API: no audio files,
// no library, nothing to license or download. One slow ambient bed (a drifting
// pad plus sparse high "starlight" notes) and a short cue per action. All of
// it goes through one master gain, so the sound toggle is a single fade.
// Browsers only allow audio after a user gesture, so nothing plays until the
// first click or key press.

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic: any two notes sound fine together
const ROOT = 146.83; // D3
const CHORDS = [
  [0, 7, 14, 16, 23], // D add9
  [-3, 4, 11, 14, 19], // B minor 7
  [-5, 2, 9, 14, 21], // G add9
  [-1, 6, 13, 16, 21], // A sus
];
const hz = (semi) => ROOT * Math.pow(2, semi / 12);

let ctx = null, master = null, sfxBus = null, musicBus = null, reverb = null;
let enabled = true;
let started = false;

try {
  const saved = localStorage.getItem("constellation:sound");
  if (saved !== null) enabled = saved === "1";
} catch {}

export function soundEnabled() { return enabled; }

export function setSoundEnabled(on) {
  enabled = on;
  try { localStorage.setItem("constellation:sound", on ? "1" : "0"); } catch {}
  if (on) unlock();
  if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.4);
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

// Called from the first gesture; safe to call again.
export function unlock() {
  if (!enabled) return;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    reverb = ctx.createConvolver();
    reverb.buffer = impulse(4.5, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
    musicBus.connect(reverb);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);
    sfxBus.connect(reverb);
  }
  if (ctx.state === "suspended") ctx.resume();
  master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
  if (!started) { started = true; startMusic(); }
}
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, unlock, { capture: true });

// --- ambient bed ------------------------------------------------------------
function startMusic() {
  const pad = ctx.createGain();
  pad.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  lp.Q.value = 0.4;
  pad.connect(lp).connect(musicBus);
  // the filter breathes slowly, so the pad never sits completely still
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.035;
  lfoAmt.gain.value = 380;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start();
  pad.gain.setTargetAtTime(0.5, ctx.currentTime, 3);

  // five voices, each two slightly detuned oscillators, gliding to the next chord
  const voices = CHORDS[0].map((semi, i) => {
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 0.32 : 0.16;
    g.connect(pad);
    const oscs = [-6, 6].map((cents) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = hz(semi);
      o.detune.value = cents;
      o.connect(g);
      o.start();
      return o;
    });
    return oscs;
  });
  let chord = 0;
  setInterval(() => {
    chord = (chord + 1) % CHORDS.length;
    const t = ctx.currentTime;
    CHORDS[chord].forEach((semi, i) => {
      for (const o of voices[i]) o.frequency.setTargetAtTime(hz(semi), t, 2.5);
    });
  }, 14000);

  // sparse starlight: a soft high note every few seconds, from the scale
  const sparkle = () => {
    if (enabled) {
      const semi = 24 + SCALE[Math.floor(Math.random() * SCALE.length)] + 12 * Math.floor(Math.random() * 2);
      bell(hz(semi), { gain: 0.05, decay: 3.5, bus: musicBus, pan: Math.random() * 1.6 - 0.8 });
    }
    setTimeout(sparkle, 2500 + Math.random() * 5000);
  };
  setTimeout(sparkle, 3000);
}

// --- voices -----------------------------------------------------------------
function bell(freq, { gain = 0.2, decay = 2, when = 0, bus = sfxBus, pan = 0, type = "sine" } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + when;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  g.connect(p).connect(bus);
  // a fundamental plus a quiet inharmonic partial reads as glass, not beep
  for (const [mult, amp] of [[1, 1], [2.76, 0.25], [5.4, 0.08]]) {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + decay + 0.1);
  }
}

function whoosh({ dur = 1.6, from = 300, to = 2400, gain = 0.12 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = impulse(dur, 0); // flat white noise
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  bp.frequency.exponentialRampToValueAtTime(from, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(bp).connect(g).connect(sfxBus);
  src.start(t);
}

function swell(freq, { dur = 2.5, gain = 0.15 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(sfxBus);
  for (const mult of [1, 1.5, 2]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * mult * 0.98, t);
    o.frequency.linearRampToValueAtTime(freq * mult, t + dur * 0.5);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
}

// A star's own note: its spectral class picks a scale degree, so every star
// has a pitch of its own and hotter stars sit higher.
const CLASS_DEGREE = { M: 0, K: 1, G: 2, F: 3, A: 4, B: 5, O: 6 };
function noteFor(cls) {
  const d = CLASS_DEGREE[cls] ?? 2;
  return hz(12 + SCALE[d % 5] + 12 * Math.floor(d / 5));
}

let lastHover = 0;
export const sfx = {
  hover(cls) {
    const now = performance.now();
    if (now - lastHover < 120) return;
    lastHover = now;
    bell(noteFor(cls) * 2, { gain: 0.035, decay: 0.6 });
  },
  focus(cls) {
    bell(noteFor(cls), { gain: 0.16, decay: 2.4 });
    bell(noteFor(cls) * 1.5, { gain: 0.07, decay: 2, when: 0.09 });
  },
  connectMode(on) {
    if (on) { bell(hz(12), { gain: 0.1, decay: 1.2 }); bell(hz(19), { gain: 0.1, decay: 1.4, when: 0.08 }); }
    else bell(hz(7), { gain: 0.08, decay: 0.9 });
  },
  connect() {
    [0, 4, 7, 12, 16].forEach((s, i) => bell(hz(19 + s), { gain: 0.12, decay: 2.6, when: i * 0.07, pan: -0.5 + i * 0.25 }));
    whoosh({ dur: 2.2, from: 400, to: 3000, gain: 0.08 });
  },
  arrive() { bell(hz(31), { gain: 0.1, decay: 3 }); bell(hz(36), { gain: 0.06, decay: 3.2, when: 0.12 }); },
  otherConnect() { bell(hz(26), { gain: 0.05, decay: 2.5, pan: Math.random() - 0.5 }); },
  travel() { whoosh({ dur: 3.2, from: 200, to: 1800, gain: 0.1 }); },
  birth() { swell(hz(0), { dur: 3.5, gain: 0.14 }); bell(hz(24), { gain: 0.12, decay: 3.5, when: 0.6 }); },
  newStar() { swell(hz(7), { dur: 2.4, gain: 0.06 }); bell(hz(31), { gain: 0.06, decay: 2.5, when: 0.4 }); },
  levelUp() { [0, 4, 7, 11].forEach((s, i) => bell(hz(24 + s), { gain: 0.08, decay: 1.8, when: i * 0.1 })); },
  enter() { swell(hz(-5), { dur: 3, gain: 0.1 }); },
  panel() { whoosh({ dur: 0.9, from: 600, to: 1600, gain: 0.05 }); },
};
