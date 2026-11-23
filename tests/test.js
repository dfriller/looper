globalThis.LOOP_DEBUG=0;
require('../src/loop.js');
const { detectLoops } = globalThis.LoopDetect;
const sr = 44100;
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function pluck(buf, t0, f, dur, amp) {
  const s = Math.round(t0 * sr), n = Math.round(dur * sr);
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const t = i / sr, env = Math.exp(-t * 3) * Math.min(1, i / 40);
    let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h * Math.exp(-t * h);
    buf[s + i] += amp * env * v;
  }
}
function drum(buf, t0, type, amp) {
  const s = Math.round(t0 * sr), n = Math.round(0.25 * sr);
  for (let i = 0; i < n && s + i < buf.length; i++) {
    const t = i / sr;
    let v = type === 'k' ? Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) * Math.exp(-t * 12)
      : type === 's' ? (rnd() * 2 - 1) * Math.exp(-t * 18) : (rnd() * 2 - 1) * Math.exp(-t * 60) * 0.4;
    buf[s + i] += amp * v;
  }
}
const midi = m => 440 * 2 ** ((m - 69) / 12);
const jit = j => (rnd() * 2 - 1) * j;

function make(spec) {
  const { bpm, beats, reps, pre, post, kind, jitter } = spec;
  const b = 60 / bpm, L = beats * b;
  const buf = new Float32Array(Math.round((pre + L * reps + post) * sr));
  for (let i = 0; i < buf.length; i++) buf[i] = (rnd() * 2 - 1) * 0.003;
  // Phrase
  const notes = [60, 64, 67, 72, 62, 65, 69, 65, 57, 60, 64, 67, 59, 62, 67, 71];
  for (let r = 0; r < reps; r++) {
    const off = pre + r * L;
    for (let k = 0; k < beats * 2; k++) {
      const t = off + k * b / 2 + jit(jitter);
      if (t > buf.length / sr - 0.01) break;
      if (kind === 'g') { if (k % 2 === 0 || k % 3 === 0) pluck(buf, t, midi(notes[(k * 3) % notes.length] - 12), 0.6, 0.3); }
      else {
        if (k % 4 === 0 || k === beats * 2 - 3) drum(buf, t, 'k', 0.8);
        if (k % 4 === 2) drum(buf, t, 's', 0.5);
        drum(buf, t, 'h', 0.3);
      }
    }
  }
  return { buf, L };
}

const tests = [
  { name: 'Drums 2x, 2 Takte 100bpm, Stopp spät', bpm: 100, beats: 8, reps: 2, pre: 0.4, post: 0.5, kind: 'd', jitter: 0.008 },
  { name: 'Gitarre 2x, 8 Schläge 92bpm, ungenau', bpm: 92, beats: 8, reps: 2, pre: 0.8, post: 0.3, kind: 'g', jitter: 0.02 },
  { name: 'Gitarre 1x, Stopp +0.2s', bpm: 110, beats: 8, reps: 1, pre: 0.5, post: 0.2, kind: 'g', jitter: 0.015 },
  { top2: 1, name: 'Drums 1x, Stopp -0.1s', bpm: 120, beats: 8, reps: 1, pre: 0.3, post: -0.1, kind: 'd', jitter: 0.005 },
  { name: 'Gitarre 3x, 4 Schläge 130bpm', bpm: 130, beats: 4, reps: 3, pre: 0.2, post: 0.4, kind: 'g', jitter: 0.015 },
  { name: 'Drums 1.5x, 4 Takte 85bpm', bpm: 85, beats: 16, reps: 1.5, pre: 0.2, post: 0, kind: 'd', jitter: 0.01 },
  { name: 'Gitarre 2x, 16 Schläge 75bpm, stark ungenau', bpm: 75, beats: 16, reps: 2, pre: 1.0, post: 0.6, kind: 'g', jitter: 0.035 },
  { name: 'Drums 2x, 1 Takt 140bpm', bpm: 140, beats: 4, reps: 2, pre: 0.2, post: 0.3, kind: 'd', jitter: 0.006 },
  { name: 'Gitarre 1x, 16 Schläge 100bpm, Stopp +0.35s', bpm: 100, beats: 16, reps: 1, pre: 0.3, post: 0.35, kind: 'g', jitter: 0.02 },
];
for (const t of tests) {
  const { buf, L } = make(t);
  const t0 = Date.now();
  const r = detectLoops(buf, sr);
  const ms = Date.now() - t0;
  const c = r.candidates;
  const top = c[0];
  const hit = c.findIndex(k => Math.abs(k.lenS - L) < 0.03);
  const ok = hit === 0 || (t.top2 && hit === 1);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${t.name}: soll ${L.toFixed(3)}s | tempo ${r.bpm.toFixed(1)} | ${ms}ms`);
  for (const k of c) console.log(`      ${k.kind.padEnd(4)} ${k.lenS.toFixed(3)}s ${k.beats} Schl. ${k.bpm.toFixed(1)}bpm score ${k.score.toFixed(2)} start ${(k.start / sr).toFixed(3)}`);
}
