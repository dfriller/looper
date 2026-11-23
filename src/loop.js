// Loop-Erkennung: Onset-Hüllkurve, Tempo, Selbstähnlichkeit -> Loop-Kandidaten
(function (g) {
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < h; k++) {
          const a = i + k, b = a + h;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Frame-Features: Onset-Flux, RMS, Bandenergien, Chroma
  function analyzeFrames(x, sr) {
    const N = 2048, H = Math.round(sr / 100), half = N >> 1;
    const T = Math.max(1, Math.floor(x.length / H));
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const NB = 24, fLo = 50, fHi = Math.min(10000, sr / 2 - 100);
    const bandOf = new Int16Array(half).fill(-1), chromaOf = new Int8Array(half).fill(-1);
    for (let k = 1; k < half; k++) {
      const f = k * sr / N;
      if (f >= fLo && f < fHi) bandOf[k] = Math.min(NB - 1, Math.floor(NB * Math.log(f / fLo) / Math.log(fHi / fLo)));
      if (f >= 80 && f <= 4000) chromaOf[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
    }
    const kMax = Math.min(half, Math.floor(11000 * N / sr));
    const flux = new Float64Array(T), rms = new Float64Array(T);
    const bands = [], chroma = [];
    const re = new Float64Array(N), im = new Float64Array(N);
    let prev = new Float64Array(half), cur = new Float64Array(half);
    for (let t = 0; t < T; t++) {
      const c = t * H - half;
      let e = 0;
      for (let i = 0; i < N; i++) {
        const j = c + i, v = j >= 0 && j < x.length ? x[j] : 0;
        re[i] = v * win[i]; im[i] = 0; e += v * v;
      }
      rms[t] = Math.sqrt(e / N);
      fft(re, im);
      const b = new Float64Array(NB), ch = new Float64Array(12);
      let fl = 0;
      for (let k = 1; k < half; k++) {
        const p = re[k] * re[k] + im[k] * im[k], m = Math.sqrt(p);
        cur[k] = Math.log1p(100 * m);
        if (k < kMax) { const d = cur[k] - prev[k]; if (d > 0) fl += d; }
        if (bandOf[k] >= 0) b[bandOf[k]] += p;
        if (chromaOf[k] >= 0) ch[chromaOf[k]] += m;
      }
      for (let i = 0; i < NB; i++) b[i] = Math.log(1e-8 + b[i]);
      flux[t] = t ? fl : 0;
      bands.push(b); chroma.push(ch);
      const tmp = prev; prev = cur; cur = tmp;
    }
    return { H, T, flux, rms, bands, chroma, fps: sr / H };
  }

  function pearson(a, b, n, i0, j0) {
    let sa = 0, sb = 0;
    for (let k = 0; k < n; k++) { sa += a[i0 + k]; sb += b[j0 + k]; }
    sa /= n; sb /= n;
    let ab = 0, aa = 0, bb = 0;
    for (let k = 0; k < n; k++) {
      const u = a[i0 + k] - sa, v = b[j0 + k] - sb;
      ab += u * v; aa += u * u; bb += v * v;
    }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
  }

  function parabolic(arr, i) {
    if (i <= 0 || i >= arr.length - 1) return i;
    const a = arr[i - 1], b = arr[i], c = arr[i + 1], d = a - 2 * b + c;
    return d < 0 ? i + 0.5 * (a - c) / d : i;
  }

  function detectLoops(x, sr) {
    // normalisieren
    let peak = 0;
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    if (peak < 1e-4) return { candidates: [], error: 'Aufnahme ist (fast) still.' };
    const xs = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) xs[i] = x[i] / peak;

    const F = analyzeFrames(xs, sr), { T, fps, flux, rms } = F;
    // Onset-Hüllkurve: lokal mittelwertbereinigt
    const on = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, t - 15); k <= Math.min(T - 1, t + 15); k++) { s += flux[k]; n++; }
      on[t] = Math.max(0, flux[t] - s / n);
    }
    // Aktiver Bereich
    let rMax = 0; for (let t = 0; t < T; t++) rMax = Math.max(rMax, rms[t]);
    const gate = rMax * 0.06;
    let a0 = 0; while (a0 < T - 1 && rms[a0] < gate) a0++;
    let a1 = T - 1; while (a1 > a0 && rms[a1] < gate) a1--;
    // Start = stärkster Onset kurz nach Aktivitätsbeginn
    let onMax = 0; for (let t = a0; t <= a1; t++) onMax = Math.max(onMax, on[t]);
    let s0 = a0;
    for (let t = Math.max(0, a0 - 5); t < Math.min(T, a0 + 15); t++) if (on[t] > on[s0]) s0 = t;
    if (on[s0] < onMax * 0.15) s0 = a0;
    const recEnd = T; // Stoppzeitpunkt
    const active = recEnd - s0;
    if (active < fps * 0.6) return { candidates: [], error: 'Aufnahme zu kurz.' };

    // Tempo per Onset-Autokorrelation (60–180 BPM)
    const lagMin = Math.round(fps * 60 / 180), lagMax = Math.round(fps * 60 / 60);
    const ac = new Float64Array(lagMax + 2);
    const segN = recEnd - s0;
    for (let L = lagMin - 1; L <= lagMax + 1 && L < segN - 10; L++) {
      const n = segN - L;
      const r = pearson(on, on, n, s0, s0 + L);
      const bpm = 60 * fps / L;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.9, 2));
      ac[L] = r * (0.6 + 0.4 * w);
    }
    let best = lagMin;
    for (let L = lagMin; L <= lagMax && L < segN - 10; L++) if (ac[L] > ac[best]) best = L;
    let beat = parabolic(ac, best); // Frames pro Schlag
    // Verfeinern über lange Lags (4/8/16 Schläge) -> genaueres Tempo
    for (const mlt of [16, 8, 4]) {
      const c = mlt * beat, w = Math.max(2, Math.round(c * 0.03));
      if (c + w >= segN * 0.6) continue;
      let bL = -1, bR = -2; const arr = new Float64Array(2 * w + 3);
      for (let d = -w - 1; d <= w + 1; d++) {
        const L = Math.round(c) + d, r = pearson(on, on, segN - L, s0, s0 + L);
        arr[d + w + 1] = r;
        if (Math.abs(d) <= w && r > bR) { bR = r; bL = d; }
      }
      const pk = parabolic(arr, bL + w + 1) - (w + 1) + Math.round(c);
      beat = pk / mlt;
      break;
    }
    const tempoConf = ac[best];

    // Feature-Vektoren (z-standardisierte Bänder + Chroma), normiert
    const NB = 24, D = NB + 12;
    const mu = new Float64Array(NB), sd = new Float64Array(NB);
    for (let t = s0; t < recEnd; t++) for (let i = 0; i < NB; i++) mu[i] += F.bands[t][i];
    for (let i = 0; i < NB; i++) mu[i] /= segN;
    for (let t = s0; t < recEnd; t++) for (let i = 0; i < NB; i++) sd[i] += (F.bands[t][i] - mu[i]) ** 2;
    for (let i = 0; i < NB; i++) sd[i] = Math.sqrt(sd[i] / segN) + 1e-6;
    const P = 2; // Pooling
    const M = Math.floor(segN / P);
    const fv = [];
    for (let m = 0; m < M; m++) {
      const v = new Float64Array(D);
      for (let q = 0; q < P; q++) {
        const t = s0 + m * P + q;
        for (let i = 0; i < NB; i++) v[i] += (F.bands[t][i] - mu[i]) / sd[i];
        let cs = 0; for (let i = 0; i < 12; i++) cs += F.chroma[t][i];
        for (let i = 0; i < 12; i++) v[NB + i] += cs > 0 ? 3 * F.chroma[t][i] / cs : 0;
      }
      let nn = 0; for (let i = 0; i < D; i++) nn += v[i] * v[i];
      nn = Math.sqrt(nn) || 1;
      for (let i = 0; i < D; i++) v[i] /= nn;
      fv.push(v);
    }
    const onRaw = new Float64Array(M), act = new Uint8Array(M);
    for (let m = 0; m < M; m++) {
      let r = 0;
      for (let q = 0; q < P; q++) { onRaw[m] += on[s0 + m * P + q]; r = Math.max(r, rms[s0 + m * P + q]); }
      act[m] = r >= gate ? 1 : 0;
    }
    // geglättet (~30 ms), damit menschliches Timing-Wackeln nicht bestraft wird
    const onP = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      let s = 0, w = 0;
      for (let k = -3; k <= 3; k++) { const j = m + k; if (j >= 0 && j < M) { const ww = Math.exp(-k * k / 4); s += onRaw[j] * ww; w += ww; } }
      onP[m] = s / w;
    }

    // Wiederholungs-Score pro Lag: Mittel + unteres Quantil der Blockähnlichkeit
    // (empfindlich für lokale Abweichungen wie ein Fill am Phrasenende)
    const Lmin = Math.max(Math.round(0.9 * fps / P), 2);
    const rep = new Float64Array(M);
    const minOverlap = Math.round(0.8 * fps / P);
    const blk = Math.max(2, Math.round(0.2 * fps / P));
    const simRow = new Float64Array(M);
    const stats = [];
    for (let L = Lmin; L < M - minOverlap; L++) {
      const n = M - L;
      if (n < Math.max(minOverlap, 0.45 * L)) break;
      let s = 0;
      for (let m = 0; m < n; m++) {
        const u = fv[m], v = fv[m + L];
        let d = 0; for (let i = 0; i < D; i++) d += u[i] * v[i];
        simRow[m] = d; s += d;
      }
      const blocks = [];
      for (let m = 0; m + blk <= n; m += blk) {
        let b = 0, a = 0;
        for (let q = 0; q < blk; q++) { b += simRow[m + q]; a += act[m + q] & act[m + q + L]; }
        if (a >= blk / 2) blocks.push(b / blk); // nur Bereiche, in denen beidseitig gespielt wird
      }
      if (blocks.length < 5) continue; // zu wenig gemeinsames Material
      blocks.sort((a, b) => a - b);
      let bm = 0; for (const b of blocks) bm += b; bm /= blocks.length;
      const q10 = blocks[Math.floor(blocks.length * 0.1)], med = blocks[blocks.length >> 1], mn = blocks[0];
      const oc = pearson(onP, onP, n, 0, L);
      rep[L] = 0.25 * bm + 0.35 * q10 + 0.15 * mn + 0.25 * oc;
      stats[L] = { mean: bm, q10, med, mn, oc };
    }
    const valid = [];
    for (let L = Lmin; L < M; L++) if (rep[L] !== 0) valid.push(L);

    const cands = [];
    const beatS = beat / fps;
    function beatsFor(lenS) {
      let bestN = 1, bestE = 1e9;
      for (let n = 1; n <= 64; n++) {
        const bpm = 60 * n / lenS;
        if (bpm < 55 || bpm > 200) continue;
        const e = Math.abs(Math.log2(lenS / n / beatS));
        const nice = n % 4 === 0 ? 0 : n % 2 === 0 ? 0.03 : 0.06;
        if (e + nice < bestE) { bestE = e + nice; bestN = n; }
      }
      return { n: bestN, err: bestE };
    }

    const REP_MIN = 0.4;
    let repPick = null;
    const repOthers = [];
    if (valid.length > 5) {
      const peaks = [];
      for (const L of valid) {
        if (rep[L] > rep[L - 1] && rep[L] >= rep[L + 1]) {
          const lenS = parabolic(rep, L) * P / fps;
          const sub = lenS < 1.5 ? 0.12 : 0; // sehr kurze Loops: unwahrscheinlich
          const nb = beatsFor(lenS).n;
          const odd = nb % 4 === 0 ? 0 : nb % 2 === 0 ? 0.07 : 0.1; // 4/8/16 Schläge sind typisch
          peaks.push({ L, lenS, v: rep[L] - sub - odd });
        }
      }
      const good = peaks.filter(p => p.v >= REP_MIN);
      let best = -1; for (const p of good) best = Math.max(best, p.v);
      // kürzeste Länge, die fast so gut passt wie die beste (Vielfache passen ja auch)
      good.sort((a, b) => a.L - b.L);
      for (const p of good) {
        const c = { kind: 'rep', lenS: p.lenS, score: p.v };
        if (!repPick && p.v >= best - 0.03) repPick = c; else repOthers.push(c);
      }
      repOthers.sort((a, b) => b.score - a.score);
      if (globalThis.LOOP_DEBUG) { console.log('   good', good.map(p=>p.lenS.toFixed(2)+':'+p.v.toFixed(3)).join(' '));
        const sorted = valid.map(L => rep[L]).sort((a, b) => a - b), medAll = sorted[sorted.length >> 1];
        console.log('   medAll', medAll.toFixed(2));
        for (const p of peaks.filter(p => p.v > 0.3)) { const st = stats[p.L]; console.log('   ', (p.L * P / fps).toFixed(2), 'v', p.v.toFixed(2), 'mean', st.mean.toFixed(2), 'q10', st.q10.toFixed(2), 'med', st.med.toFixed(2), 'min', st.mn.toFixed(2), 'oc', st.oc.toFixed(2)); }
      }
    }

    // Einmal gespielt: Länge bis Stopp, auf Schläge gerastert
    const D1 = (recEnd - s0) / fps;
    {
      const nRaw = D1 / beatS;
      const opts = new Set([Math.round(nRaw), Math.floor(nRaw), Math.ceil(nRaw)]);
      for (const k of [2, 4, 8, 16]) opts.add(Math.round(nRaw / k) * k);
      for (const n of opts) {
        if (n < 2) continue;
        const lenS = n * beatS;
        if (lenS > D1 + 0.6 * beatS + 0.15) continue;
        const dev = Math.abs(lenS - D1) / beatS;
        const nice = n % 4 === 0 ? 0.12 : n % 2 === 0 ? 0.05 : 0;
        cands.push({ kind: 'snap', lenS, score: 0.95 + 0.2 * Math.max(0, tempoConf) + nice - 0.25 * dev });
      }
    }
    cands.push({ kind: 'raw', lenS: D1, score: 0.5 });

    // Reihenfolge: bester Wiederholungs-Loop, dann gerasterte Gesamtlänge, dann Rest
    const snaps = cands.filter(c => c.kind !== 'rep').sort((a, b) => b.score - a.score);
    const ordered = (repPick ? [repPick] : []).concat(snaps.slice(0, 1), repOthers, snaps.slice(1));
    const out = [];
    for (const c of ordered) {
      if (out.some(o => Math.abs(o.lenS - c.lenS) / o.lenS < 0.03)) continue;
      out.push(c);
      if (out.length >= 4) break;
    }

    // Sample-genaue Verfeinerung
    const startSample = refineStart(xs, s0 * F.H, sr);
    const env = envelope(xs, sr); // 1 kHz
    const results = out.map(c => {
      let len = Math.round(c.lenS * sr);
      if (c.kind === 'rep') len = refineLen(env, startSample, len, sr);
      const lenS = len / sr;
      const bf = beatsFor(lenS);
      return {
        kind: c.kind, start: startSample, len, lenS,
        beats: bf.n, bpm: 60 * bf.n / lenS, score: c.score
      };
    });
    return {
      candidates: results, bpm: 60 / beatS, tempoConf,
      rep: Array.from(rep), repFps: fps / P, s0: s0 * F.H
    };
  }

  function envelope(x, sr) {
    const step = Math.round(sr / 1000), n = Math.floor(x.length / step);
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < step; k++) s += Math.abs(x[i * step + k]);
      e[i] = s / step;
    }
    // Onset-artig: positive Ableitung, geglättet
    const d = new Float64Array(n);
    for (let i = 1; i < n; i++) d[i] = Math.max(0, e[i] - e[i - 1]);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) s += d[j]; }
      out[i] = 0.6 * s + 0.4 * e[i];
    }
    return { v: out, step };
  }

  function refineLen(env, start, len, sr) {
    const { v, step } = env;
    const s = Math.floor(start / step), L = Math.round(len / step);
    const W = Math.min(L, 3000, v.length - (s + L) - 25);
    if (W < 300) return len;
    let best = 0, bestR = -2;
    const R = new Float64Array(41);
    for (let d = -20; d <= 20; d++) {
      const r = pearson(v, v, W, s, s + L + d);
      R[d + 20] = r;
      if (r > bestR) { bestR = r; best = d; }
    }
    const fine = parabolic(R, best + 20) - 20;
    return Math.round((L + fine) * step);
  }

  function refineStart(x, approx, sr) {
    const a = Math.max(0, approx - Math.round(0.04 * sr)), b = Math.min(x.length, approx + Math.round(0.04 * sr));
    let pk = 0; for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(x[i]));
    let i = a; while (i < b && Math.abs(x[i]) < 0.15 * pk) i++;
    i = Math.max(0, i - Math.round(0.004 * sr));
    // Nulldurchgang in der Nähe
    for (let k = 0; k < Math.round(0.002 * sr) && i > 0; k++, i--) if (x[i] * x[i - 1] <= 0) break;
    return i;
  }

  // Loop-Puffer mit Crossfade bauen (nutzt, was nach dem Loopende gespielt wurde)
  function renderLoop(chs, start, len, sr) {
    const xf = Math.round(0.012 * sr);
    return chs.map(x => {
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = x[start + i] || 0;
      const tailOk = start + len + xf <= x.length;
      for (let i = 0; i < xf && i < len; i++) {
        const t = i / xf;
        if (tailOk) {
          out[i] = out[i] * Math.sin(t * Math.PI / 2) + x[start + len + i] * Math.cos(t * Math.PI / 2);
        } else {
          out[i] *= t; out[len - 1 - i] *= t;
        }
      }
      return out;
    });
  }

  g.LoopDetect = { detectLoops, renderLoop };
})(typeof window !== 'undefined' ? window : globalThis);
