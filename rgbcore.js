/* RGBコード 可変サイズ版 コア(DOM非依存)
 * N×N マス(N=12〜48)、1マス3bit(8色)、GF(64)リード・ソロモン(ブロック分割+インターリーブ)
 * ペイロードは任意のバイト列。サイズNは「入る最小のN」を自動選択する。 */
(function (root) {
  const COLORS = [[0,0,0],[0,0,255],[0,255,0],[0,255,255],[255,0,0],[255,0,255],[255,255,0],[255,255,255]];
  const IS_BRIGHT = [0,0,0,1,0,1,1,1];
  // ec: パリティ割合(ブロック長に対して)。送信側と受信側で同じ値にすること
  const cfg = { ec: 0.25, minN: 12, maxN: 48 };

  // ---------- GF(64) と リード・ソロモン ----------
  const exp = new Uint8Array(128), log = new Uint8Array(64);
  { let v = 1; for (let i = 0; i < 63; i++) { exp[i] = v; exp[i + 63] = v; log[v] = i; v <<= 1; if (v & 64) v ^= 67; } }
  const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 63] : 0);
  const div = (a, b) => (a ? exp[(log[a] - log[b] + 63) % 63] : 0);
  const pow = (a, p) => (a ? exp[(log[a] * p) % 63] : p === 0 ? 1 : 0);

  const gens = {};
  function genPoly(n) {
    if (gens[n]) return gens[n];
    let g = [1];
    for (let i = 0; i < n; i++) {
      const nx = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { nx[j] ^= g[j]; nx[j + 1] ^= mul(g[j], exp[i]); }
      g = nx;
    }
    return (gens[n] = g);
  }
  function rsEncode(msg, n) {
    const g = genPoly(n), rem = new Array(n).fill(0);
    for (const m of msg) {
      const c = m ^ rem[0];
      rem.shift(); rem.push(0);
      if (c) for (let j = 0; j < n; j++) rem[j] ^= mul(g[j + 1], c);
    }
    return msg.concat(rem);
  }
  function syndromes(cw, n) {
    const s = [];
    for (let i = 0; i < n; i++) { let y = cw[0]; for (let k = 1; k < cw.length; k++) y = mul(y, exp[i]) ^ cw[k]; s.push(y); }
    return s;
  }
  function bm(synd, n) {
    let C = [1], B = [1], L = 0, m = 1, b = 1;
    for (let i = 0; i < n; i++) {
      let d = synd[i];
      for (let j = 1; j <= L; j++) if (j < C.length) d ^= mul(C[j], synd[i - j]);
      if (d === 0) { m++; continue; }
      const coef = div(d, b);
      const sc = new Array(m).fill(0).concat(B).map((v) => mul(v, coef));
      const nc = new Array(Math.max(C.length, sc.length)).fill(0);
      C.forEach((v, j) => (nc[j] ^= v)); sc.forEach((v, j) => (nc[j] ^= v));
      if (2 * L <= i) { B = C; L = i + 1 - L; b = d; m = 1; } else m++;
      C = nc;
    }
    while (C.length > 1 && C[C.length - 1] === 0) C.pop();
    return C;
  }
  function chien(loc, len) {
    const r = [];
    for (let i = 0; i < 63; i++) {
      let s = 0;
      for (let j = 0; j < loc.length; j++) s ^= mul(loc[j], pow(exp[i], j));
      if (s === 0) { const p = (63 - i) % 63; if (p < len) r.push(p); }
    }
    return r;
  }
  function forney(synd, loc, pos) {
    const n = synd.length, full = new Array(n + loc.length - 1).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < loc.length; j++) full[i + j] ^= mul(synd[i], loc[j]);
    const om = full.slice(0, n), der = [];
    for (let i = 1; i < loc.length; i += 2) der.push(loc[i]);
    const mag = {};
    for (const p of pos) {
      const i = (63 - p) % 63, xi = exp[i];
      let ov = 0; for (let k = 0; k < om.length; k++) ov ^= mul(om[k], pow(xi, k));
      const xi2 = mul(xi, xi);
      let dv = 0; for (let k = 0; k < der.length; k++) dv ^= mul(der[k], pow(xi2, k));
      if (dv === 0) { mag[p] = null; continue; }
      mag[p] = mul(exp[(63 - i) % 63], div(ov, dv));
    }
    return mag;
  }
  function rsDecode(rx, n) {
    const s = syndromes(rx, n);
    if (s.every((v) => v === 0)) return { ok: true, cw: rx.slice(), errs: 0 };
    const loc = bm(s, n), L = loc.length - 1;
    if (L === 0 || L > n / 2) return { ok: false };
    const pos = chien(loc, rx.length);
    if (pos.length !== L) return { ok: false };
    const mag = forney(s, loc, pos), cw = rx.slice();
    for (const p of pos) { const m = mag[p]; if (m == null) return { ok: false }; cw[rx.length - 1 - p] ^= m; }
    return syndromes(cw, n).every((v) => v === 0) ? { ok: true, cw, errs: pos.length } : { ok: false };
  }

  // ---------- レイアウト ----------
  function sysCells(N, mask) {
    const [A, B] = [[4, 3], [2, 5], [1, 6]][mask];
    const m = new Map(), set = (x, y, c) => m.set(y * N + x, c);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { set(x, y, 0); set(N - 3 + x, N - 3 + y, 0); }
    set(1, 1, 7); set(2, 1, A); set(1, 2, B);
    set(N - 2, N - 2, 7); set(N - 4, N - 3, A); set(N - 3, N - 4, B);
    [[3, 0], [0, 3], [N - 1, N - 4], [N - 4, N - 1]].forEach(([x, y]) => set(x, y, 7));
    set(N - 1, 0, 0); set(0, N - 1, 0);
    return m;
  }
  const planCache = {};
  function plan(N) {
    const key = N + ":" + cfg.ec;
    if (planCache[key]) return planCache[key];
    const sys = sysCells(N, 0), dataIdx = [];
    for (let i = 0; i < N * N; i++) if (!sys.has(i)) dataIdx.push(i);
    const S = dataIdx.length >> 1, nb = Math.ceil(S / 63), blocks = [];
    for (let b = 0; b < nb; b++) {
      const len = Math.floor(S / nb) + (b < S % nb ? 1 : 0), nsym = Math.max(2, Math.floor(len * cfg.ec));
      blocks.push({ len, nsym, k: len - nsym });
    }
    const K = blocks.reduce((a, b) => a + b.k, 0);
    return (planCache[key] = { N, dataIdx, S, blocks, K, capacity: Math.max(0, Math.floor((K * 6 - 20) / 8)) });
  }
  const capacity = (N) => plan(N).capacity;
  const masked = (mask, x, y) => (mask === 0 ? (x + y) % 2 === 0 : mask === 1 ? (x + y) % 3 === 0 : x % 2 === 0);

  function crc8(b) {
    let c = 0;
    for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = c & 128 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; }
    return c;
  }
  function whitener() { let s = 0x2f6e2b1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s >>> 7) & 63; }; }

  function penalty(g, N) {
    let p = 0, br = 0;
    for (let y = 0; y < N; y++) {
      let rx = 1, ry = 1;
      for (let x = 0; x < N; x++) {
        br += IS_BRIGHT[g[y * N + x]];
        if (x) {
          rx = g[y * N + x] === g[y * N + x - 1] ? rx + 1 : 1; if (rx === 3) p += 3;
          ry = g[x * N + y] === g[(x - 1) * N + y] ? ry + 1 : 1; if (ry === 3) p += 3;
        }
      }
    }
    return p + Math.abs(br - (N * N) / 2);
  }

  // ---------- エンコード ----------
  function encode(bytes) {
    bytes = Array.from(bytes);
    if (bytes.length > 4095) throw new Error("データが大きすぎます(最大4095バイト)");
    let p = null;
    for (let N = cfg.minN; N <= cfg.maxN; N++) { const q = plan(N); if (q.capacity >= bytes.length) { p = q; break; } }
    if (!p) throw new Error(`データが大きすぎます(${cfg.maxN}×${cfg.maxN}で最大${capacity(cfg.maxN)}バイト)`);
    const N = p.N, syms = [];
    let acc = 0, nb = 0;
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) { acc = (acc << 1) | ((v >> i) & 1); if (++nb === 6) { syms.push(acc); acc = 0; nb = 0; } } };
    put(bytes.length, 12); put(crc8(bytes), 8); bytes.forEach((b) => put(b, 8));
    if (nb) put(0, 6 - nb);
    while (syms.length < p.K) syms.push(0);
    const rnd = whitener();
    for (let i = 0; i < p.K; i++) syms[i] ^= rnd();
    let o = 0;
    const cws = p.blocks.map((b) => { const d = syms.slice(o, o + b.k); o += b.k; return rsEncode(d, b.nsym); });
    const tx = [];
    for (let i = 0; i < cws[0].length; i++) for (const c of cws) if (i < c.length) tx.push(c[i]);
    const vals = new Array(p.dataIdx.length).fill(0);
    tx.forEach((s, j) => { vals[2 * j] = s >> 3; vals[2 * j + 1] = s & 7; });
    let best = null;
    for (let mask = 0; mask < 3; mask++) {
      const grid = new Uint8Array(N * N);
      sysCells(N, mask).forEach((c, i) => (grid[i] = c));
      p.dataIdx.forEach((idx, i) => { grid[idx] = vals[i] ^ (masked(mask, idx % N, (idx / N) | 0) ? 7 : 0); });
      const pen = penalty(grid, N);
      if (!best || pen < best.penalty) best = { grid, mask, penalty: pen };
    }
    return { N, grid: best.grid, mask: best.mask, penalty: best.penalty, capacity: p.capacity };
  }

  // ---------- デコード(色インデックスのグリッド → バイト列) ----------
  function resolveMask(g, N) {
    const pair = (a, b) => (a === 4 && b === 3 ? 0 : a === 2 && b === 5 ? 1 : a === 1 && b === 6 ? 2 : -1);
    const main = pair(g[1 * N + 2], g[2 * N + 1]);
    return main !== -1 ? main : pair(g[(N - 3) * N + N - 4], g[(N - 4) * N + N - 3]);
  }
  function decodeGrid(grid, N) {
    const mask = resolveMask(grid, N);
    if (mask < 0) return { ok: false, msg: "マスク情報を特定できません" };
    const p = plan(N);
    const vals = p.dataIdx.map((idx) => grid[idx] ^ (masked(mask, idx % N, (idx / N) | 0) ? 7 : 0));
    const tx = [];
    for (let j = 0; j < p.S; j++) tx.push((vals[2 * j] << 3) | vals[2 * j + 1]);
    const cws = p.blocks.map((b) => new Array(b.len));
    let t = 0;
    for (let i = 0; i < p.blocks[0].len; i++) for (let b = 0; b < cws.length; b++) if (i < cws[b].length) cws[b][i] = tx[t++];
    let syms = [], errs = 0;
    for (let b = 0; b < cws.length; b++) {
      const r = rsDecode(cws[b], p.blocks[b].nsym);
      if (!r.ok) return { ok: false, msg: "誤り訂正の限界を超えました" };
      errs += r.errs; syms = syms.concat(r.cw.slice(0, p.blocks[b].k));
    }
    const rnd = whitener();
    syms = syms.map((s) => s ^ rnd());
    let bi = 0;
    const get = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((syms[(bi / 6) | 0] >> (5 - (bi % 6))) & 1); bi++; } return v; };
    const len = get(12), crc = get(8);
    if (20 + len * 8 > p.K * 6) return { ok: false, msg: "長さが不正です" };
    const out = [];
    for (let i = 0; i < len; i++) out.push(get(8));
    if (crc8(out) !== crc) return { ok: false, msg: "CRC不一致" };
    return { ok: true, bytes: Uint8Array.from(out), N, mask, errs };
  }

  // ---------- 画像から読む(ホモグラフィ + ガイド枠方式) ----------
  function homography(src, dst) {
    const A = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u], [0, 0, 0, x, y, 1, -x * v, -y * v, v]);
    }
    for (let i = 0; i < 8; i++) {
      let m = i;
      for (let j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[m][i])) m = j;
      [A[i], A[m]] = [A[m], A[i]];
      for (let j = i + 1; j < 8; j++) { const f = A[j][i] / A[i][i]; for (let k = i; k < 9; k++) A[j][k] -= A[i][k] * f; }
    }
    const h = new Array(8);
    for (let i = 7; i >= 0; i--) { let s = 0; for (let j = i + 1; j < 8; j++) s += A[i][j] * h[j]; h[i] = (A[i][8] - s) / A[i][i]; }
    return [...h, 1];
  }
  const project = (x, y, H) => { const w = H[6] * x + H[7] * y + H[8]; return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }; };
  function sample(img, px, py) {
    px = Math.round(px); py = Math.round(py);
    if (!(px >= 0 && px < img.width && py >= 0 && py < img.height)) return null;
    const i = (py * img.width + px) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  function otsu(img) {
    const h = new Array(256).fill(0), d = img.data;
    for (let i = 0; i < d.length; i += 4) h[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    const tot = img.width * img.height;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * h[t];
    let sb = 0, wb = 0, mx = 0, th = 127;
    for (let t = 0; t < 256; t++) {
      wb += h[t]; if (!wb) continue;
      const wf = tot - wb; if (!wf) break;
      sb += t * h[t];
      const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) ** 2;
      if (v > mx) { mx = v; th = t; }
    }
    return th;
  }
  const unitSquare = (N) => [{ x: 0, y: 0 }, { x: N, y: 0 }, { x: N, y: N }, { x: 0, y: N }];

  function score(img, N, corners, T) {
    const H = homography(unitSquare(N), corners);
    const cell = (x, y) => { const q = project(x + 0.5, y + 0.5, H); return sample(img, q.x, q.y); };
    let ok = 0, tot = 0;
    const chk = (x, y, white) => { tot++; const c = cell(x, y); if (c && (lum(c) < T) === !white) ok++; };
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      if (x === 1 && y === 1) chk(x, y, true);
      else if (!(x === 2 && y === 1) && !(x === 1 && y === 2)) chk(x, y, false);
      chk(N - 3 + x, N - 3 + y, x === 1 && y === 1);
    }
    [[3, 0], [0, 3], [N - 1, N - 4], [N - 4, N - 1]].forEach(([x, y]) => chk(x, y, true));
    chk(N - 1, 0, false); chk(0, N - 1, false);
    tot++;
    const a = cell(2, 1), b = cell(1, 2);
    if (a && b && Math.abs(lum(a) - lum(b)) > 20) ok++;
    return ok / tot;
  }
  function rot(p, c, a) {
    const dx = p.x - c.x, dy = p.y - c.y, co = Math.cos(a), si = Math.sin(a);
    return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
  }
  function coarse(img, N, box, T) {
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const base = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([x, y]) => ({ x, y }));
    let best = null, bs = -1;
    for (let d = 0; d < 360; d += 114 / N) {
      const cs = base.map((p) => rot(p, c, (d * Math.PI) / 180)), s = score(img, N, cs, T);
      if (s > bs) { bs = s; best = cs; }
    }
    return { corners: best, score: bs };
  }
  function refine(img, N, box, T, st) {
    let corners = st.corners, sc = st.score;
    const cs = (box.x1 - box.x0) / N, offs = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1].map((v) => v * cs * 0.4);
    for (let r = 0; r < 6; r++) {
      let imp = false;
      for (let ci = 0; ci < 4; ci++) {
        let lb = null, ls = sc;
        for (const ox of offs) for (const oy of offs) {
          if (!ox && !oy) continue;
          const t = corners.map((p, i) => (i === ci ? { x: p.x + ox, y: p.y + oy } : p)), s = score(img, N, t, T);
          if (s > ls) { ls = s; lb = t; }
        }
        if (lb) { corners = lb; sc = ls; imp = true; }
      }
      if (!imp) break;
    }
    return { corners, score: sc };
  }
  function readGrid(img, N, corners) {
    const H = homography(unitSquare(N), corners);
    const cell = (x, y) => { const q = project(x + 0.5, y + 0.5, H); return sample(img, q.x, q.y); };
    const k = cell(0, 0), w = cell(1, 1);
    const pal = k && w ? COLORS.map((c) => c.map((v, i) => k[i] + (v / 255) * (w[i] - k[i]))) : COLORS;
    const g = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = cell(x, y);
      if (!c) { g[y * N + x] = 7; continue; }
      let best = 0, bd = Infinity;
      pal.forEach((p, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } });
      g[y * N + x] = best;
    }
    return g;
  }
  function scanFrame(img, attempts = [{ scale: 0.7 }]) {
    const w = img.width, h = img.height, m = Math.min(w, h), T = otsu(img);
    for (const a of attempts) {
      const cands = [];
      for (let N = cfg.minN; N <= cfg.maxN; N++) {
        const size = a.quiet != null ? (m * N) / (N + 2 * a.quiet) : m * a.scale;
        const box = { x0: (w - size) / 2, y0: (h - size) / 2, x1: (w + size) / 2, y1: (h + size) / 2 };
        cands.push({ N, box, ...coarse(img, N, box, T) });
      }
      cands.sort((p, q) => q.score - p.score);
      for (const c of cands.slice(0, 12)) {
        if (c.score < 0.6) break;
        let d = c.score >= 0.9 ? decodeGrid(readGrid(img, c.N, c.corners), c.N) : { ok: false };
        if (d.ok) return d;
        const r = refine(img, c.N, c.box, T, c);
        if (r.score < 0.8) continue;
        d = decodeGrid(readGrid(img, c.N, r.corners), c.N);
        if (d.ok) return d;
      }
    }
    return { ok: false, msg: "読み取れませんでした" };
  }

  function render(grid, N, cell, quiet = 1) {
    const W = (N + 2 * quiet) * cell, d = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
      const x = ((px / cell) | 0) - quiet, y = ((py / cell) | 0) - quiet;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const c = COLORS[grid[y * N + x]], i = (py * W + px) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    return { data: d, width: W, height: W };
  }

  const api = { cfg, COLORS, plan, capacity, encode, decodeGrid, scanFrame, render };
  if (typeof module !== "undefined") module.exports = api; else root.RGBCode = api;
})(globalThis);
