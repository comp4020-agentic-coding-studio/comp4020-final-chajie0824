// Sound for the sky, synthesised live with the Web Audio API: no audio files,
// no library, nothing to license or download. The register is warm, slow and
// far away (think of the calm stretches of a space-builder soundtrack): a
// low drone, a soft pad that changes chord only every half minute or so, and
// a faint wash of "space air". Nothing in the bed is percussive or random, so
// it never pings on its own. Action cues are soft sine swells, rounded off by
// a low-pass filter — felt more than heard. Everything goes through one
// master gain, so the sound toggle is a single fade. Browsers only allow
// audio after a user gesture, so nothing plays until the first click or key.

const ROOT = 73.42; // D2
const hz = (semi) => ROOT * Math.pow(2, semi / 12);
// two open, consonant voicings over the same D pedal: no minor, no tension
const CHORDS = [
  [12, 19, 26, 28], // D  A  E  F#  — D add9
  [10, 17, 24, 26], // C  G  D  E   — C add9 over D: a lift, not a turn
];
const CHORD_SECONDS = 34;
const GLIDE_SECONDS = 9;

let ctx = null, master = null, sfxBus = null, musicBus = null, reverb = null;
let enabled = true;
let started = false;
const LEVEL = 0.7;

try {
  const saved = localStorage.getItem("constellation:sound");
  if (saved !== null) enabled = saved === "1";
} catch {}

export function soundEnabled() { return enabled; }

export function setSoundEnabled(on) {
  enabled = on;
  try { localStorage.setItem("constellation:sound", on ? "1" : "0"); } catch {}
  if (on) unlock();
  if (master) master.gain.setTargetAtTime(on ? LEVEL : 0, ctx.currentTime, 0.8);
}

function noiseBuffer(seconds, decay = 0) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (decay ? Math.pow(1 - i / len, decay) : 1);
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
    // long, dark hall: everything sits a long way off
    reverb = ctx.createConvolver();
    reverb.buffer = noiseBuffer(6, 3);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(tone).connect(wet).connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.22;
    musicBus.connect(master);
    musicBus.connect(reverb);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.28;
    sfxBus.connect(master);
    sfxBus.connect(reverb);
  }
  if (ctx.state === "suspended") ctx.resume();
  // a slow fade in, so the first click doesn't switch a room on
  master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.2);
  if (!started) { started = true; startMusic(); }
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { capture: true });
// Try at once on load too: a browser that already trusts the site lets it
// play straight away; otherwise the context stays suspended until the first
// key press in the name box, or the first click, resumes it.
unlock();

// --- ambient bed ------------------------------------------------------------
function startMusic() {
  const t0 = ctx.currentTime;

  // drone: the root, very low and steady
  const drone = ctx.createGain();
  drone.gain.value = 0.28;
  drone.connect(musicBus);
  for (const [semi, cents] of [[0, -3], [0, 3], [7, 0]]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = hz(semi);
    o.detune.value = cents;
    o.connect(drone);
    o.start();
  }

  // pad: soft sawtooth through a dark filter that breathes over ~50 s
  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0, t0);
  pad.gain.linearRampToValueAtTime(0.12, t0 + 5);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 520;
  lp.Q.value = 0.3;
  pad.connect(lp).connect(musicBus);
  const lfo = ctx.createOscillator();
  const lfoAmt = ctx.createGain();
  lfo.frequency.value = 0.02;
  lfoAmt.gain.value = 140;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start();

  const voices = CHORDS[0].map((semi) => {
    const g = ctx.createGain();
    g.gain.value = 0.25;
    g.connect(pad);
    return [-5, 5].map((cents) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz(semi);
      o.detune.value = cents;
      o.connect(g);
      o.start();
      return o;
    });
  });
  let chord = 0;
  setInterval(() => {
    chord = (chord + 1) % CHORDS.length;
    const t = ctx.currentTime;
    CHORDS[chord].forEach((semi, i) => {
      for (const o of voices[i]) o.frequency.setTargetAtTime(hz(semi), t, GLIDE_SECONDS / 3);
    });
  }, CHORD_SECONDS * 1000);

  // space air: filtered noise, barely there, slowly swelling
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(8);
  air.loop = true;
  const airLp = ctx.createBiquadFilter();
  airLp.type = "lowpass";
  airLp.frequency.value = 380;
  const airG = ctx.createGain();
  airG.gain.value = 0.05;
  const airLfo = ctx.createOscillator();
  const airAmt = ctx.createGain();
  airLfo.frequency.value = 0.013;
  airAmt.gain.value = 0.03;
  airLfo.connect(airAmt).connect(airG.gain);
  airLfo.start();
  air.connect(airLp).connect(airG).connect(musicBus);
  air.start();
}

// --- cues -------------------------------------------------------------------
// A soft tone: sine partials, slow attack, long gentle tail, low-passed so
// there is no click and no glassy edge.
function tone(freqs, { gain = 0.1, attack = 0.08, decay = 1.8, when = 0, cutoff = 1400 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + when;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay / 4);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  g.connect(lp).connect(sfxBus);
  for (const f of freqs) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g);
    o.start(t);
    o.stop(t + attack + decay + 0.5);
  }
}

function breath({ dur = 2.4, centre = 700, gain = 0.05 } = {}) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(centre * 0.6, t);
  bp.frequency.linearRampToValueAtTime(centre, t + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(centre * 0.6, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.45);
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(bp).connect(g).connect(sfxBus);
  src.start(t);
}

// A star's own note: its spectral class picks a degree of the pentatonic
// scale an octave above the pad, so hotter stars sit a little higher.
const PENTA = [0, 2, 4, 7, 9];
const CLASS_DEGREE = { M: 0, K: 1, G: 2, F: 3, A: 4, B: 5, O: 6 };
function noteFor(cls) {
  const d = CLASS_DEGREE[cls] ?? 2;
  return hz(24 + PENTA[d % 5] + 12 * Math.floor(d / 5));
}

// Only the viewer's own actions make a sound. Hovering is silent (it fires
// too often to be quiet), and other people's activity stays visual only.
export const sfx = {
  focus(cls) { tone([noteFor(cls)], { gain: 0.09, attack: 0.12, decay: 2.4, cutoff: 1100 }); },
  connectMode(on) {
    if (on) tone([hz(24), hz(31)], { gain: 0.06, attack: 0.15, decay: 1.6, cutoff: 1000 });
  },
  connect() {
    // two notes a fifth apart, the second arriving softly after the first
    tone([hz(26)], { gain: 0.08, attack: 0.2, decay: 3, cutoff: 1200 });
    tone([hz(33)], { gain: 0.06, attack: 0.3, decay: 3.4, when: 0.35, cutoff: 1200 });
  },
  travel() { breath({ dur: 3.2, centre: 600, gain: 0.04 }); },
  arrive() { tone([hz(31)], { gain: 0.05, attack: 0.25, decay: 2.6, cutoff: 1000 }); },
  birth() { tone([hz(12), hz(19), hz(24)], { gain: 0.07, attack: 1.6, decay: 5, cutoff: 900 }); },
  enter() { tone([hz(12), hz(19)], { gain: 0.06, attack: 1.2, decay: 4, cutoff: 800 }); },
};
