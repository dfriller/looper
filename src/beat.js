// ================= Beat-Modus =================
const PRESETS = {
  rock:  { name: 'Rock', bpm: 100, rows: { K: 'x.......x.x.....', S: '....x.......x...', H: 'x.o.x.o.x.o.x.o.' } },
  funk:  { name: 'Funk', bpm: 96, rows: { K: 'x..o..x...x..o..', S: '....x..o.o..x..o', H: 'xoooxoooxoooxooo' } },
  hiphop:{ name: 'Hip-Hop', bpm: 88, rows: { K: 'x......o..x..o..', S: '....x.......x...', H: 'x.o.x.o.x.o.xoo.' } },
  house: { name: 'House', bpm: 122, rows: { K: 'x...x...x...x...', C: '....x.......x...', O: '..o...o...o...o.', H: 'o.o.o.o.o.o.o.o.' } },
  bossa: { name: 'Bossa', bpm: 128, rows: { K: 'x..ox..ox..ox..o', R: 'x..x..x...x..x..', H: 'o.o.o.o.o.o.o.o.' } },
  click: { name: 'Nur Klick', bpm: 100, rows: { Q: 'x...o...o...o...' } },
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('looper.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('looper.' + k, JSON.stringify(v)); } catch (e) {} }
};
const B = {
  preset: store.get('preset', 'rock'), bpm: store.get('bpm', 100), bars: store.get('bars', 2),
  running: false, t0: 0, step: 0, next: 0, timer: 0, w: 0,
  state: 'idle', recStart: 0, recEnd: Infinity, nBars: 0,
  loop: null, loopDur: 0, loopAnchor: 0, loopOn: true, src: null, peaks: null,
  gDrum: null, gLoop: null, gClick: null, cur: null, quiet: store.get('quiet', true), noise: null, mic: null, chunks: [], level: 0, lat: store.get('lat', null)
};
const stepDur = () => 60 / B.bpm / 4, barDur = () => 16 * stepDur();
const bmsg = t => { $('bmsg').textContent = t || ''; $('bmsg').hidden = !t; };
const bhint = t => { $('bhint').textContent = t || ' '; };

function graph() {
  const c = ctx();
  if (B.gDrum) return c;
  B.gDrum = c.createGain(); B.gDrum.gain.value = +$('vDrum').value; B.gDrum.connect(c.destination);
  B.gLoop = c.createGain(); B.gLoop.gain.value = +$('vLoop').value; B.gLoop.connect(c.destination);
  B.gClick = c.createGain(); B.gClick.gain.value = +$('vClick').value; B.gClick.connect(c.destination);
  B.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = B.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return c;
}

// ---------- Drum-Sounds (synthetisch) ----------
function env(g, t, v, d) { g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); }
function noiseHit(t, d, type, f, v, q) {
  const c = st.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = B.noise; fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q;
  env(g, t, v, d); s.connect(fl).connect(g).connect(B.cur || B.gDrum);
  s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
}
function toneHit(t, f0, f1, d, v, type) {
  const c = st.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + d * 0.35);
  env(g, t, v, d); o.connect(g).connect(B.cur || B.gDrum); o.start(t); o.stop(t + d + 0.02);
}
function hit(k, t, v) {
  if (k === 'K') { toneHit(t, 160, 42, 0.42, v); toneHit(t, 1200, 200, 0.012, v * 0.25, 'triangle'); }
  else if (k === 'S') { noiseHit(t, 0.19, 'highpass', 1300, v * 0.75); toneHit(t, 190, 160, 0.11, v * 0.45, 'triangle'); }
  else if (k === 'H') noiseHit(t, 0.045, 'highpass', 7500, v * 0.38);
  else if (k === 'O') noiseHit(t, 0.28, 'highpass', 6800, v * 0.3);
  else if (k === 'C') { for (let i = 0; i < 3; i++) noiseHit(t + i * 0.011, i < 2 ? 0.02 : 0.16, 'bandpass', 1150, v * 0.7, 1.2); }
  else if (k === 'R') { toneHit(t, 820, 0, 0.035, v * 0.4, 'triangle'); noiseHit(t, 0.02, 'bandpass', 2400, v * 0.4, 2); }
  else if (k === 'Q') toneHit(t, v > 0.8 ? 1900 : 1300, 0, 0.03, v * 0.5);
}

// ---------- Scheduler ----------
function tick() {
  const c = st.ctx, rows = PRESETS[B.preset].rows;
  while (B.next < c.currentTime + 0.15) {
    const s = B.step % 16, tn = B.next;
    // Ohne Kopfhörer: von Vorzähler bis Aufnahmeende nur ein leiser Klick, damit der Beat nicht mit aufs Mikro kommt
    const quiet = B.quiet && ['count', 'rec', 'finishing'].includes(B.state) && tn >= B.recStart - barDur() - 1e-4 && tn < B.recEnd - 1e-4;
    if (quiet) {
      B.cur = B.gClick;
      const ch = PRESETS.click.rows.Q[s]; if (ch !== '.') hit('Q', tn, ch === 'x' ? 1 : 0.55);
    } else {
      B.cur = B.gDrum;
      for (const k in rows) { const ch = rows[k][s]; if (ch === 'x') hit(k, tn, 1); else if (ch === 'o') hit(k, tn, 0.55); }
    }
    B.cur = null;
    B.step++; B.next = B.t0 + B.step * stepDur();
  }
  B.timer = setTimeout(tick, 25);
}
function beatStart() {
  const c = graph();
  if (c.state === 'suspended') c.resume();
  B.t0 = c.currentTime + 0.1; B.step = 0; B.next = B.t0; B.running = true;
  if (B.loop) B.loopAnchor = B.t0;
  tick(); startLoopAligned(); bui();
}
function beatStop() {
  B.running = false; clearTimeout(B.timer); stopLoopSrc();
  if (B.state === 'count' || B.state === 'rec') B.state = B.loop ? 'loop' : 'idle';
  bui();
}
function setTempo(v) {
  if (B.loop || ['count', 'rec', 'finishing'].includes(B.state)) return;
  B.bpm = Math.max(60, Math.min(180, Math.round(v)));
  if (B.running) B.t0 = B.next - B.step * stepDur();
  store.set('bpm', B.bpm); bui();
}

// ---------- Mikro: rohe Samples mit Zeitstempel ----------
async function micOn() {
  if (B.mic) return true;
  const c = graph();
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const code = `class C extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(4096);this.n=0;this.f=0}
      process(i){const x=i[0]&&i[0][0];if(x){if(this.n===0)this.f=currentFrame;this.b.set(x,this.n);this.n+=x.length;
      if(this.n>4096-128){this.port.postMessage({f:this.f,d:this.b.slice(0,this.n)});this.n=0}}return true}}
      registerProcessor('cap',C)`;
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const src = c.createMediaStreamSource(s), node = new AudioWorkletNode(c, 'cap'), z = c.createGain();
    z.gain.value = 0; src.connect(node).connect(z).connect(c.destination);
    node.port.onmessage = e => {
      const ch = e.data; B.chunks.push(ch);
      let p = 0; for (let i = 0; i < ch.d.length; i += 8) p = Math.max(p, Math.abs(ch.d[i]));
      B.level = p;
      const keep = ch.f - 120 * c.sampleRate; // ~2 Minuten Puffer
      while (B.chunks.length && B.chunks[0].f + B.chunks[0].d.length < keep) B.chunks.shift();
    };
    B.mic = { s, src, node };
    return true;
  } catch (e) {
    bmsg('Kein Mikrofonzugriff. Bitte in Chrome erlauben (Schloss-Symbol → Berechtigungen).');
    return false;
  }
}
function grab(f0, n) {
  const out = new Float32Array(n);
  for (const ch of B.chunks) {
    const a = Math.max(f0, ch.f), b = Math.min(f0 + n, ch.f + ch.d.length);
    for (let f = a; f < b; f++) out[f - f0] = ch.d[f - ch.f];
  }
  return out;
}
function lat() {
  if (B.lat !== null) return B.lat;
  const c = st.ctx;
  return (c.outputLatency || 0) + (c.baseLatency || 0) + 0.03; // Schätzung bis gemessen
}

// ---------- Aufnahme im Taktraster ----------
async function bRecPress() {
  const c = graph();
  if (c.state === 'suspended') c.resume();
  if (B.state === 'count') { B.state = B.loop ? 'loop' : 'idle'; bui(); return; }
  if (B.state === 'rec') { // Ende auf den nächstliegenden ganzen Takt legen
    const n = Math.max(1, Math.round((c.currentTime - B.recStart) / barDur()));
    B.nBars = n; B.recEnd = B.recStart + n * barDur(); bui(); return;
  }
  if (B.state === 'finishing') return;
  if (B.loop) { B.loopOn = !B.loopOn; B.loopOn ? startLoopAligned() : stopLoopSrc(); bui(); return; }
  if (!await micOn()) return;
  startRecording();
}
function startRecording() {
  const c = st.ctx;
  if (!B.running) beatStart();
  const bd = barDur();
  let k = Math.ceil((c.currentTime + 0.35 - B.t0) / bd); if (k < 1) k = 1;
  B.recStart = B.t0 + k * bd;
  B.nBars = B.bars === 'auto' ? 0 : B.bars;
  B.recEnd = B.nBars ? B.recStart + B.nBars * bd : Infinity;
  B.state = 'count'; bmsg(''); bui(); watch();
}
function watch() {
  clearInterval(B.w);
  B.w = setInterval(() => {
    const c = st.ctx, t = c.currentTime;
    if (!B.running && (B.state === 'count' || B.state === 'rec')) { B.state = B.loop ? 'loop' : 'idle'; bui(); }
    if (B.state === 'count' && t >= B.recStart) { B.state = 'rec'; bui(); }
    if (B.state === 'rec' && B.recEnd === Infinity && t - B.recStart >= 16 * barDur()) { B.nBars = 16; B.recEnd = B.recStart + 16 * barDur(); }
    if (B.state === 'rec' && t >= B.recEnd) { B.state = 'finishing'; bui(); }
    if (B.state === 'finishing' && t >= B.recEnd + lat() + 0.06) finish();
    if (B.state === 'idle' || B.state === 'loop') clearInterval(B.w);
  }, 25);
}
function finish() {
  const c = st.ctx, sr = c.sampleRate, dur = B.recEnd - B.recStart;
  const len = Math.ceil(dur * sr) + 1, f0 = Math.round((B.recStart + lat()) * sr);
  const raw = grab(f0, B.quiet ? len : len + Math.round(0.02 * sr));
  const [data] = LoopDetect.renderLoop([raw], 0, len, sr);
  const buf = c.createBuffer(1, len, sr); buf.copyToChannel(data, 0);
  B.loop = buf; B.loopDur = dur; B.loopAnchor = B.recStart; B.loopOn = true;
  // Peaks fürs Display
  const P = 600, pk = new Float32Array(P), spp = len / P;
  for (let i = 0; i < P; i++) { let m = 0; for (let j = Math.floor(i * spp); j < Math.floor((i + 1) * spp); j += 4) m = Math.max(m, Math.abs(data[j])); pk[i] = m; }
  let mx = 0; for (const v of pk) mx = Math.max(mx, v);
  B.peaks = { pk, mx: mx || 1 };
  B.state = 'loop';
  if (mx < 0.003) bmsg('Die Aufnahme ist fast still. Ist das Mikro frei?');
  startLoopAligned(); bui();
}
function startLoopAligned() {
  stopLoopSrc();
  if (!B.loop || !B.running || !B.loopOn) return;
  const c = st.ctx, when = c.currentTime + 0.04;
  const off = ((when - B.loopAnchor) % B.loopDur + B.loopDur) % B.loopDur;
  const s = c.createBufferSource();
  s.buffer = B.loop; s.loop = true; s.loopStart = 0; s.loopEnd = B.loopDur;
  s.connect(B.gLoop); s.start(when, off); B.src = s;
}
function stopLoopSrc() { if (B.src) { try { B.src.stop(); } catch (e) {} B.src = null; } }
function clearLoop() { stopLoopSrc(); B.loop = null; B.peaks = null; B.state = 'idle'; bmsg(''); bui(); }

// ---------- Latenz messen (Lautsprecher -> Mikro) ----------
async function calibrate() {
  if (!await micOn()) { $('latMsg').textContent = 'Ohne Mikro geht das nicht.'; return; }
  const c = graph(); if (c.state === 'suspended') await c.resume();
  const was = B.running; if (was) beatStop();
  $('latMsg').textContent = 'Misst … bitte kurz still sein.';
  $('latMeasure').disabled = true;
  const T = [], gap = 0.5, t0 = c.currentTime + 0.4;
  for (let i = 0; i < 8; i++) {
    const t = t0 + i * gap; T.push(t);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = 1000; env(g, t, 0.9, 0.03);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.05);
  }
  await new Promise(r => setTimeout(r, (t0 + 8 * gap + 0.5 - c.currentTime) * 1000));
  const sr = c.sampleRate, res = [];
  for (const t of T) {
    const f0 = Math.round(t * sr), n = Math.round(0.45 * sr), x = grab(f0, n);
    const pre = grab(f0 - Math.round(0.04 * sr), Math.round(0.04 * sr));
    let fl = 0; for (const v of pre) fl = Math.max(fl, Math.abs(v));
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    if (pk < 0.01 || pk < fl * 4) continue;
    let i = 0; while (i < n && Math.abs(x[i]) < 0.3 * pk) i++;
    res.push(i / sr);
  }
  $('latMeasure').disabled = false;
  res.sort((a, b) => a - b);
  if (res.length < 5) { $('latMsg').textContent = 'Klicks nicht gehört. Lauter stellen oder Hörer ans Mikro halten und nochmal.'; if (was) beatStart(); return; }
  const med = res[res.length >> 1], spread = res[res.length - 2] - res[1];
  if (spread > 0.012) { $('latMsg').textContent = `Messung zu unruhig (Streuung ${Math.round(spread * 1000)} ms). Bitte in ruhiger Umgebung nochmal.`; if (was) beatStart(); return; }
  B.lat = med; store.set('lat', med);
  $('latMsg').textContent = `Gemessen: ${Math.round(med * 1000)} ms (Streuung ${Math.round(spread * 1000)} ms). Ist gespeichert.`;
  bui(); if (was) beatStart();
}

// ---------- UI ----------
function bui() {
  const btn = $('brec');
  btn.classList.remove('on', 'play', 'idle');
  const s = B.state;
  if (s === 'idle') { btn.textContent = 'REC'; btn.setAttribute('aria-label', 'Aufnahme starten'); }
  else if (s === 'count') { btn.classList.add('idle'); btn.setAttribute('aria-label', 'Abbrechen'); }
  else if (s === 'rec') { btn.classList.add('on'); btn.textContent = B.nBars && B.bars === 'auto' ? '…' : 'STOP'; btn.setAttribute('aria-label', 'Aufnahme beenden'); }
  else if (s === 'finishing') { btn.textContent = '…'; }
  else if (s === 'loop') { btn.classList.add(B.loopOn && B.running ? 'play' : 'idle'); btn.textContent = B.loopOn && B.running ? '■' : '▶'; btn.setAttribute('aria-label', B.loopOn ? 'Loop stummschalten' : 'Loop einschalten'); }
  $('bBeat').textContent = B.running ? 'Beat ■' : 'Beat ▶';
  $('bNew').disabled = !B.loop; $('bClear').disabled = !B.loop;
  $('tempo').value = B.bpm; $('tVal').textContent = B.bpm + ' BPM';
  const lock = !!B.loop || ['count', 'rec', 'finishing'].includes(s);
  ['tempo', 'tDown', 'tUp'].forEach(id => $(id).disabled = lock);
  $('tLock').textContent = B.loop ? '· gesperrt, solange ein Loop existiert' : '';
  document.querySelectorAll('#presets .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === B.preset));
  document.querySelectorAll('#lens .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k) === String(B.bars)));
  $('quiet').setAttribute('aria-pressed', B.quiet);
  $('latVal').textContent = B.lat === null ? 'nicht gemessen (geschätzt)' : Math.round(B.lat * 1000) + ' ms';
  const h = {
    idle: B.running ? 'REC drücken: Nach dem Vorzähler-Takt geht die Aufnahme los.' : 'Beat ▶ startet den Beat, REC startet ihn automatisch mit.',
    count: B.quiet ? 'Vorzähler … nur Klick, bei Takt 1 losspielen.' : 'Vorzähler … bei Takt 1 losspielen.',
    rec: B.bars === 'auto' ? 'Aufnahme läuft. STOP rundet auf den nächsten ganzen Takt.' : `Aufnahme läuft (${B.nBars} Takte). STOP beendet früher, auf ganze Takte gerundet.`,
    finishing: 'Loop wird gebaut …',
    loop: 'Taster schaltet den Loop stumm/an. „Neu“ nimmt einen neuen auf.'
  }[s];
  bhint(h);
}
function bdraw() {
  requestAnimationFrame(bdraw);
  if ($('vBeat').hidden) return;
  const cv = $('bwave'), g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  const W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  g.clearRect(0, 0, W, H);
  const c = st.ctx, t = c ? c.currentTime : 0, bd = barDur();
  let bars = 1, pos = B.running ? ((t - B.t0) % bd + bd) % bd / bd : -1;
  if (B.state === 'loop' && B.loop) {
    bars = Math.round(B.loopDur / bd);
    const { pk, mx } = B.peaks;
    g.fillStyle = '#9ee6c4';
    for (let x = 0; x < W; x++) { const v = pk[Math.floor(x / W * pk.length)] / mx * H * 0.45; g.fillRect(x, H / 2 - v, 1, Math.max(1, 2 * v)); }
    pos = B.running ? ((t - B.loopAnchor) % B.loopDur + B.loopDur) % B.loopDur / B.loopDur : -1;
    $('brd1').innerHTML = `<b>${bars} ${bars === 1 ? 'Takt' : 'Takte'}</b> · Loop${B.loopOn ? '' : ' (stumm)'}`;
  } else if (B.state === 'rec' || B.state === 'finishing') {
    const el = Math.max(0, t - B.recStart);
    bars = B.nBars || Math.max(1, Math.ceil(el / bd + 0.001));
    const p = Math.min(1, el / (bars * bd));
    g.fillStyle = 'rgba(255,90,78,.22)'; g.fillRect(0, 0, p * W, H);
    const v = Math.min(1, B.level * 1.5) * H * 0.45;
    g.fillStyle = '#ff5a4e'; g.fillRect(p * W - 3 * dpr, H / 2 - v, 3 * dpr, Math.max(2, 2 * v));
    pos = p;
    $('brd1').innerHTML = `<b>Takt ${Math.min(bars, Math.floor(el / bd) + 1)}</b>${B.nBars ? ' / ' + B.nBars : ''} · Aufnahme`;
  } else if (B.state === 'count') {
    const left = Math.max(1, Math.ceil((B.recStart - t) / (bd / 4) - 0.001));
    $('brec').textContent = left;
    $('brd1').innerHTML = `<b>Vorzähler ${left}</b>`;
  } else {
    $('brd1').innerHTML = B.running ? `<b>${PRESETS[B.preset].name}</b> · läuft` : '<b>Bereit</b>';
  }
  $('brd2').textContent = B.bpm + ' BPM';
  // Raster
  const beats = bars * 4;
  for (let k = 0; k <= beats; k++) {
    const x = k / beats * W;
    g.fillStyle = k % 4 === 0 ? 'rgba(234,242,236,.6)' : 'rgba(234,242,236,.2)';
    g.fillRect(Math.min(W - dpr, x), 0, dpr, k % 4 === 0 ? H : H * 0.12);
  }
  if (pos >= 0) { g.fillStyle = B.state === 'rec' ? '#ffffff' : '#ff5a4e'; g.fillRect(pos * W, 0, 2 * dpr, H); }
}

// ---------- Bedienung ----------
$('presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button class="chip" data-k="${k}">${p.name}</button>`).join('');
$('lens').innerHTML = [1, 2, 4, 8, 'auto'].map(k => `<button class="chip" data-k="${k}">${k === 'auto' ? 'Auto' : k + (k === 1 ? ' Takt' : ' Takte')}</button>`).join('');
$('presets').onclick = e => {
  const b = e.target.closest('.chip'); if (!b) return;
  B.preset = b.dataset.k; store.set('preset', B.preset);
  if (!B.loop && !B.running) setTempo(PRESETS[B.preset].bpm);
  bui();
};
$('lens').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; B.bars = b.dataset.k === 'auto' ? 'auto' : +b.dataset.k; store.set('bars', B.bars); bui(); };
$('tempo').oninput = e => setTempo(+e.target.value);
$('tDown').onclick = () => setTempo(B.bpm - 1);
$('tUp').onclick = () => setTempo(B.bpm + 1);
$('vDrum').oninput = e => { if (B.gDrum) B.gDrum.gain.value = +e.target.value; };
$('vLoop').oninput = e => { if (B.gLoop) B.gLoop.gain.value = +e.target.value; };
$('vClick').value = store.get('clickVol', 0.35);
$('vClick').oninput = e => { if (B.gClick) B.gClick.gain.value = +e.target.value; store.set('clickVol', +e.target.value); };
$('quiet').onclick = () => { B.quiet = !B.quiet; store.set('quiet', B.quiet); bui(); };
$('brec').onclick = bRecPress;
$('bBeat').onclick = () => B.running ? beatStop() : beatStart();
$('bClear').onclick = clearLoop;
$('bNew').onclick = async () => { clearLoop(); if (await micOn()) startRecording(); };
$('latMeasure').onclick = calibrate;
$('latDown').onclick = () => { ctx(); B.lat = Math.max(0, lat() - 0.005); store.set('lat', B.lat); bui(); };
$('latUp').onclick = () => { ctx(); B.lat = lat() + 0.005; store.set('lat', B.lat); bui(); };
function mode(beat) {
  $('vBeat').hidden = !beat; $('vFree').hidden = beat;
  $('tabBeat').setAttribute('aria-selected', beat); $('tabFree').setAttribute('aria-selected', !beat);
  if (beat) { stopLoop(); } else { beatStop(); }
}
$('tabBeat').onclick = () => mode(true);
$('tabFree').onclick = () => mode(false);
bui(); requestAnimationFrame(bdraw);
