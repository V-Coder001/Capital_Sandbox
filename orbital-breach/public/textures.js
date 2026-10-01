/* ============================================================
 * Prozedurale PBR-Texturen — keine externen Assets nötig.
 * ============================================================
 * Jede Oberfläche wird als Höhenfeld + Farbe + Rauheit + Metallanteil
 * berechnet und daraus drei GPU-Texturen gebaut:
 *   albedo (sRGB) · normal (aus dem Höhenfeld) · ORM (Okklusion/Rauheit/Metall)
 * Alle Muster kacheln nahtlos (Rauschen mit Periode = Texturgröße). */

const B = window.BABYLON;

/* ---------- Kachelbares Wertrauschen ---------- */
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const p = period;
  const x0 = ((xi % p) + p) % p, x1 = (x0 + 1) % p, y0 = ((yi % p) + p) % p, y1 = (y0 + 1) % p;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, period, oct, seed) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(x * f, y * f, period * f, seed + o * 17) * amp; n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ---------- Arbeitsfläche ---------- */
class Surface {
  constructor(S) {
    this.S = S;
    this.col = new Float32Array(S * S * 3);
    this.h = new Float32Array(S * S);
    this.rough = new Float32Array(S * S);
    this.metal = new Float32Array(S * S);
    this.ao = new Float32Array(S * S).fill(1);
  }
  fill(c, r, m) {
    const { S } = this;
    for (let i = 0; i < S * S; i++) {
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      this.rough[i] = r; this.metal[i] = m;
    }
  }
  /** fn(i, x, y, lx, ly) für jedes Pixel im Rechteck; lx/ly = lokale 0..1 Koordinaten */
  rect(x0, y0, x1, y1, fn) {
    const { S } = this;
    for (let y = Math.max(0, y0 | 0); y < Math.min(S, y1); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(S, x1); x++)
        fn(y * S + x, x, y, (x - x0) / (x1 - x0), (y - y0) / (y1 - y0));
  }
  setCol(i, c, k = 1) {
    this.col[i * 3] += (c[0] - this.col[i * 3]) * k;
    this.col[i * 3 + 1] += (c[1] - this.col[i * 3 + 1]) * k;
    this.col[i * 3 + 2] += (c[2] - this.col[i * 3 + 2]) * k;
  }
  mulCol(i, k) { this.col[i * 3] *= k; this.col[i * 3 + 1] *= k; this.col[i * 3 + 2] *= k; }
  /** Erhabene Platte mit abgeschrägter Kante (Fase) */
  panel(x0, y0, x1, y1, height, bevel) {
    this.rect(x0, y0, x1, y1, (i, x, y) => {
      const e = Math.min(x - x0, x1 - 1 - x, y - y0, y1 - 1 - y);
      this.h[i] += height * smooth(0, bevel, e);
    });
  }
  bolt(cx, cy, r, steel = [0.42, 0.43, 0.45]) {
    this.rect(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (i, x, y) => {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1.15) return;
      if (d > 1) { this.ao[i] *= 0.6; return; }
      this.h[i] += Math.sqrt(1 - d * d) * 0.9;
      this.setCol(i, steel); this.metal[i] = 0.95; this.rough[i] = 0.32;
      if (Math.abs(x - cx) < r * 0.18) this.h[i] -= 0.5;   // Schlitz
    });
  }
  /** In GPU-Texturen umwandeln */
  toTextures(scene, name, normalStrength = 3) {
    const { S } = this;
    const alb = new Uint8Array(S * S * 4), nrm = new Uint8Array(S * S * 4), orm = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const hl = this.h[y * S + ((x - 1 + S) % S)], hr = this.h[y * S + ((x + 1) % S)];
      const hu = this.h[((y - 1 + S) % S) * S + x], hd = this.h[((y + 1) % S) * S + x];
      let nx = (hl - hr) * normalStrength, ny = (hd - hu) * normalStrength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nrm[i * 4] = (nx * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
      for (let c = 0; c < 3; c++) alb[i * 4 + c] = Math.pow(clamp01(this.col[i * 3 + c]), 1 / 2.2) * 255;
      alb[i * 4 + 3] = 255;
      orm[i * 4] = clamp01(this.ao[i]) * 255; orm[i * 4 + 1] = clamp01(this.rough[i]) * 255; orm[i * 4 + 2] = clamp01(this.metal[i]) * 255; orm[i * 4 + 3] = 255;
    }
    const mk = (data, gamma) => {
      const t = B.RawTexture.CreateRGBATexture(data, S, S, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
      t.gammaSpace = gamma; t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8;
      t.name = name;
      return t;
    };
    return { albedo: mk(alb, true), normal: mk(nrm, false), orm: mk(orm, false) };
  }
}

/* Feine Oberflächenstruktur: Farb-/Rauheitsrauschen, Kratzer, Schmutz */
function weather(s, { grime = 0, scratches = 40, seed = 1, colVar = 0.05, rVar = 0.12 }) {
  const { S } = s;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const n = fbm(x / 64, y / 64, S / 64, 5, seed);
    const fine = vnoise(x / 3, y / 3, S / 3, seed + 9);
    s.mulCol(i, 1 - colVar + n * colVar * 2 - fine * 0.03);
    s.rough[i] = clamp01(s.rough[i] + (n - 0.5) * rVar + fine * 0.04);
    s.h[i] += fine * 0.04;
    if (grime > 0) {
      const g = smooth(0.42, 0.75, fbm(x / 110, y / 110, S / 110, 5, seed + 3)) * grime;
      const bottom = smooth(0.55, 1, y / S) * grime * 0.6;          // Schmutz sammelt sich unten
      const k = clamp01(g + bottom);
      s.setCol(i, [0.09, 0.08, 0.07], k * 0.7);
      s.rough[i] = clamp01(s.rough[i] + k * 0.3);
    }
  }
  let rng = seed * 99991;
  const rand = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < scratches; k++) {
    let x = rand() * S, y = rand() * S;
    const a = rand() * Math.PI * 2, len = 20 + rand() * 120;
    for (let t = 0; t < len; t++) {
      const px = ((((x + Math.cos(a) * t) | 0) % S) + S) % S, py = ((((y + Math.sin(a) * t) | 0) % S) + S) % S;
      const i = py * S + px;
      if (i < 0 || i >= S * S) continue;
      s.mulCol(i, 1.12); s.rough[i] *= 0.75; s.h[i] -= 0.08;
    }
  }
}

function hazard(s, x0, y0, x1, y1) {
  s.rect(x0, y0, x1, y1, (i, x, y) => {
    const stripe = ((x + y) / 34 | 0) % 2;
    s.setCol(i, stripe ? [0.75, 0.52, 0.02] : [0.03, 0.03, 0.03]);
    s.rough[i] = 0.55; s.metal[i] = 0;
  });
}

/* ---------- Konkrete Materialien ---------- */

/** Wandpaneele (2 m × 2 m pro Kachel) */
export function wallTextures(scene, { dirty = false, S = 1024, seed = 3 } = {}) {
  const s = new Surface(S);
  s.fill([0.62, 0.64, 0.66], 0.42, 0.15);
  const P = S / 2, seam = 5;
  for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
    const x0 = px * P + seam, y0 = py * P + seam, x1 = (px + 1) * P - seam, y1 = (py + 1) * P - seam;
    if (py === 0 && px === 1) {
      // geteilte Platte mit Lüftungsgitter
      const ym = (y0 + y1) / 2;
      s.panel(x0, y0, x1, ym - 3, 1, 10); s.panel(x0, ym + 3, x1, y1, 1, 10);
      s.rect(x0 + 40, y0 + 40, x1 - 40, ym - 40, (i, x, y) => {
        if (((y - y0) / 14 | 0) % 2 === 0) { s.h[i] -= 1.2; s.setCol(i, [0.05, 0.05, 0.06]); s.ao[i] = 0.35; s.rough[i] = 0.7; }
      });
    } else if (py === 1 && px === 0) {
      s.panel(x0, y0, x1, y1, 1, 10);
      hazard(s, x0 + 20, y1 - 70, x1 - 20, y1 - 40);
      s.rect(x0 + 60, y0 + 60, x1 - 60, y0 + 200, (i, x, y, lx, ly) => {   // Kabelkanal-Abdeckung
        s.h[i] += 0.6 * smooth(0, 0.05, Math.min(lx, 1 - lx, ly, 1 - ly));
        s.setCol(i, [0.42, 0.45, 0.48], 0.5);
      });
    } else {
      s.panel(x0, y0, x1, y1, 1, 10);
      s.panel(x0 + 50, y0 + 50, x1 - 50, y1 - 50, -0.35, 6);           // Kassette
    }
    for (const [bx, by] of [[x0 + 18, y0 + 18], [x1 - 18, y0 + 18], [x0 + 18, y1 - 18], [x1 - 18, y1 - 18]]) s.bolt(bx, by, 7);
  }
  // Fugen dunkel + Umgebungsverdeckung
  for (let i = 0; i < S * S; i++) if (s.h[i] < 0.05) { s.ao[i] = 0.45; s.mulCol(i, 0.35); s.rough[i] = 0.8; }
  weather(s, { grime: dirty ? 1 : 0.15, scratches: dirty ? 120 : 45, seed });
  if (dirty) scorch(s, seed);
  return s.toTextures(scene, dirty ? "wallDirty" : "wall", 2.2);
}

function scorch(s, seed) {
  const { S } = s;
  for (let k = 0; k < 3; k++) {
    const cx = hash2(k, 1, seed) * S, cy = hash2(k, 2, seed) * S, r = 80 + hash2(k, 3, seed) * 140;
    s.rect(cx - r, cy - r, cx + r, cy + r, (i, x, y) => {
      const d = Math.hypot(x - cx, y - cy) / r + (fbm(x / 30, y / 30, S / 30, 3, seed + k) - 0.5) * 0.6;
      if (d > 1) return;
      const k2 = smooth(1, 0.2, d);
      s.setCol(i, [0.02, 0.018, 0.015], k2 * 0.9); s.rough[i] = clamp01(s.rough[i] + k2 * 0.4); s.metal[i] *= 1 - k2;
    });
  }
}

/** Bodenplatten: Riffelblech mit Verschraubung */
export function floorTextures(scene, { S = 1024, dirty = false } = {}) {
  const s = new Surface(S);
  s.fill([0.24, 0.25, 0.27], 0.42, 0.85);
  const P = S / 2;
  for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
    const x0 = px * P + 4, y0 = py * P + 4, x1 = (px + 1) * P - 4, y1 = (py + 1) * P - 4;
    s.panel(x0, y0, x1, y1, 1, 4);
    // Riffelmuster
    s.rect(x0 + 10, y0 + 10, x1 - 10, y1 - 10, (i, x, y) => {
      const cell = 32, ox = (x % cell) - cell / 2, oy = (y % cell) - cell / 2;
      const alt = (((x / cell) | 0) + ((y / cell) | 0)) % 2;
      const ang = alt ? 0.785 : -0.785, c = Math.cos(ang), sn = Math.sin(ang);
      const u = ox * c - oy * sn, v = ox * sn + oy * c;
      const lens = (u * u) / 110 + (v * v) / 6;
      if (lens < 1) { s.h[i] += (1 - lens) * 0.7; s.rough[i] = 0.3; }
    });
    for (const [bx, by] of [[x0 + 14, y0 + 14], [x1 - 14, y0 + 14], [x0 + 14, y1 - 14], [x1 - 14, y1 - 14]]) s.bolt(bx, by, 6, [0.3, 0.3, 0.32]);
  }
  for (let i = 0; i < S * S; i++) if (s.h[i] < 0.05) { s.ao[i] = 0.4; s.mulCol(i, 0.3); }
  weather(s, { grime: dirty ? 0.9 : 0.35, scratches: 160, seed: 7, colVar: 0.08, rVar: 0.2 });
  return s.toTextures(scene, "floor", 2.5);
}

/** Deckenpaneele mit Lochblech */
export function ceilingTextures(scene, { S = 512 } = {}) {
  const s = new Surface(S);
  s.fill([0.55, 0.57, 0.6], 0.5, 0.3);
  const P = S / 2;
  for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) {
    const x0 = px * P + 3, y0 = py * P + 3, x1 = (px + 1) * P - 3, y1 = (py + 1) * P - 3;
    s.panel(x0, y0, x1, y1, 1, 5);
    s.rect(x0 + 16, y0 + 16, x1 - 16, y1 - 16, (i, x, y) => {
      const ox = (x % 10) - 5, oy = (y % 10) - 5;
      if (ox * ox + oy * oy < 5) { s.h[i] -= 0.8; s.setCol(i, [0.04, 0.04, 0.05]); s.ao[i] = 0.4; }
    });
  }
  for (let i = 0; i < S * S; i++) if (s.h[i] < 0.05) { s.ao[i] = 0.4; s.mulCol(i, 0.3); }
  weather(s, { scratches: 10, seed: 11 });
  return s.toTextures(scene, "ceiling", 2);
}

/** Außenhülle: weiße MLI-Thermodecke wie auf der ISS (gesteppt, leicht knittrig) */
export function hullTextures(scene, { S = 1024 } = {}) {
  const s = new Surface(S);
  s.fill([0.82, 0.82, 0.8], 0.75, 0);
  const Q = S / 4;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const qx = (x % Q) / Q, qy = (y % Q) / Q;
    const pillow = Math.sin(qx * Math.PI) * Math.sin(qy * Math.PI);
    const wr = fbm(x / 40, y / 40, S / 40, 5, 21);
    s.h[i] = pillow * 1.4 + wr * 0.8;
    s.mulCol(i, 0.9 + wr * 0.15);
    s.rough[i] = 0.55 + wr * 0.35;
    if (qx < 0.01 || qy < 0.01) { s.ao[i] = 0.6; s.mulCol(i, 0.7); }
  }
  // Haltegriffe/Handläufe als gelbe Streifen
  s.rect(0, S * 0.48, S, S * 0.52, (i) => { s.setCol(i, [0.75, 0.6, 0.1]); s.rough[i] = 0.5; s.h[i] += 0.6; });
  weather(s, { scratches: 0, seed: 5, colVar: 0.06 });
  return s.toTextures(scene, "hull", 1.5);
}

/** Solarzellen: dunkelblaue Zellen mit Silberraster */
export function solarTextures(scene, { S = 512 } = {}) {
  const s = new Surface(S);
  s.fill([0.02, 0.04, 0.11], 0.22, 0.6);
  const C = S / 8;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const cx = x % C, cy = y % C;
    if (cx < 3 || cy < 3) { s.setCol(i, [0.7, 0.7, 0.72]); s.metal[i] = 1; s.rough[i] = 0.3; s.h[i] = 0.3; }
    else if (cx % 16 === 0) { s.setCol(i, [0.25, 0.27, 0.3]); s.metal[i] = 1; }
    else s.mulCol(i, 0.85 + vnoise(x / 6, y / 6, S / 6, 3) * 0.3);
  }
  return s.toTextures(scene, "solar", 1);
}

/** Frachtkiste mit Kantenschutz und Beschriftungsfeld */
export function crateTextures(scene, color, { S = 512, seed = 13 } = {}) {
  const s = new Surface(S);
  s.fill(color, 0.55, 0.3);
  const b = 34;
  s.rect(0, 0, S, S, (i, x, y) => {
    const e = Math.min(x, S - 1 - x, y, S - 1 - y);
    if (e < b) { s.setCol(i, [0.18, 0.18, 0.2]); s.metal[i] = 0.9; s.rough[i] = 0.35; s.h[i] += 1 + smooth(0, 6, e) * 0.5; }
  });
  s.panel(b + 30, b + 30, S - b - 30, S - b - 30, -0.4, 8);
  s.rect(S * 0.3, S * 0.4, S * 0.7, S * 0.55, (i) => { s.setCol(i, [0.85, 0.85, 0.8]); s.rough[i] = 0.7; s.metal[i] = 0; });
  s.rect(S * 0.33, S * 0.44, S * 0.67, S * 0.46, (i) => s.setCol(i, [0.1, 0.1, 0.1]));
  s.rect(S * 0.33, S * 0.49, S * 0.55, S * 0.51, (i) => s.setCol(i, [0.1, 0.1, 0.1]));
  for (const [bx, by] of [[b / 2, b / 2], [S - b / 2, b / 2], [b / 2, S - b / 2], [S - b / 2, S - b / 2]]) s.bolt(bx, by, 7);
  weather(s, { grime: 0.4, scratches: 60, seed });
  return s.toTextures(scene, "crate", 2.5);
}

/* ============================================================
 * Erde: im Web-Worker generiert (equirektangular, nahtlos)
 * Kontinente, Klimazonen, Polkappen, Ozeanglanz, Wolkenwirbel
 * ============================================================ */
function earthWorker() {
  // 3D-Gradientenrauschen (Perlin-artig) — nahtlos auf der Kugel
  const perm = new Uint8Array(512);
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const g = (h, a, b, c) => { const q = G[h % 12]; return q[0] * a + q[1] * b + q[2] * c; };
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B2 = perm[X + 1] + Y, BA = perm[B2] + Z, BB = perm[B2 + 1] + Z;
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(g(perm[AA], x, y, z), g(perm[BA], x - 1, y, z), u), l(g(perm[AB], x, y - 1, z), g(perm[BB], x - 1, y - 1, z), u), v),
             l(l(g(perm[AA + 1], x, y, z - 1), g(perm[BA + 1], x - 1, y, z - 1), u), l(g(perm[AB + 1], x, y - 1, z - 1), g(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  function fbm(x, y, z, oct) {
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { s += noise(x * f, y * f, z * f) * a; a *= 0.5; f *= 2.03; }
    return s;
  }
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  onmessage = e => {
    const { W, H } = e.data;
    const alb = new Uint8ClampedArray(W * H * 4), orm = new Uint8ClampedArray(W * H * 4);
    const nrm = new Uint8ClampedArray(W * H * 4), cld = new Uint8ClampedArray(W * H * 4);
    const height = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2;
        const nx = cl * Math.cos(lon), ny = sl, nz = cl * Math.sin(lon);
        const i = y * W + x;
        // Domain-Warp für natürlich zerklüftete Küsten
        const wx = fbm(nx * 1.5 + 7, ny * 1.5, nz * 1.5, 3) * 0.6;
        const h = fbm(nx * 1.8 + wx, ny * 1.8 + wx, nz * 1.8 - wx, 7) + 0.02;
        height[i] = h;
        const moist = fbm(nx * 2.6 + 30, ny * 2.6, nz * 2.6, 4);
        const absLat = Math.abs(lat) / (Math.PI / 2);
        let c, rough = 0.85;
        if (h < 0) {
          const depth = sm(0, -0.25, h);
          c = mix([0.03, 0.16, 0.24], [0.004, 0.025, 0.07], depth);
          rough = 0.18;
        } else {
          const elev = sm(0.0, 0.32, h);
          const desertBelt = 1 - sm(0.12, 0.38, Math.abs(absLat - 0.27));
          const dry = sm(-0.05, 0.25, desertBelt * 0.6 - moist * 1.3);
          const forest = [0.05, 0.11, 0.035], grass = [0.17, 0.2, 0.08], desert = [0.52, 0.4, 0.25], rock = [0.32, 0.29, 0.25];
          c = mix(mix(forest, grass, sm(0.1, 0.55, absLat + moist * 0.2)), desert, dry);
          c = mix(c, rock, sm(0.18, 0.34, h));
          if (h < 0.015) c = mix(c, [0.45, 0.42, 0.33], 0.4);   // Strände/Flachland
          rough = 0.9 - elev * 0.1;
        }
        // Polkappen + Hochgebirgsschnee
        const ice = sm(0.8, 0.86, absLat + fbm(nx * 6, ny * 6, nz * 6, 3) * 0.08) + (h > 0 ? sm(0.3, 0.4, h) : 0);
        if (ice > 0) { c = mix(c, [0.86, 0.9, 0.95], Math.min(1, ice)); rough = rough * (1 - ice) + 0.6 * ice; }
        alb[i * 4] = Math.pow(c[0], 1 / 2.2) * 255; alb[i * 4 + 1] = Math.pow(c[1], 1 / 2.2) * 255; alb[i * 4 + 2] = Math.pow(c[2], 1 / 2.2) * 255; alb[i * 4 + 3] = 255;
        orm[i * 4] = 255; orm[i * 4 + 1] = rough * 255; orm[i * 4 + 2] = 0; orm[i * 4 + 3] = 255;
        // Wolken: großräumige Bänder + Wirbel
        const sw = fbm(nx * 2 + 50, ny * 4, nz * 2, 3) * 1.5;
        const cn = fbm(nx * 3 + sw, ny * 6 + sw * 0.5, nz * 3 - sw, 7);
        const band = 0.12 * Math.cos(lat * 6);   // Passatwinde, ITCZ
        const ca = sm(0.02, 0.3, cn + band);
        cld[i * 4] = cld[i * 4 + 1] = cld[i * 4 + 2] = 255; cld[i * 4 + 3] = ca * 235;
      }
      if (y % 64 === 0) postMessage({ progress: y / H });
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hl = Math.max(0, height[y * W + (x - 1 + W) % W]), hr = Math.max(0, height[y * W + (x + 1) % W]);
      const hu = Math.max(0, height[Math.max(0, y - 1) * W + x]), hd = Math.max(0, height[Math.min(H - 1, y + 1) * W + x]);
      let nx = (hl - hr) * 9, ny = (hd - hu) * 9, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nrm[i * 4] = (nx / l * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
    }
    postMessage({ done: true, alb, orm, nrm, cld }, [alb.buffer, orm.buffer, nrm.buffer, cld.buffer]);
  };
}

export function generateEarth(scene, W, H, onProgress) {
  return new Promise(resolve => {
    const src = `(${earthWorker.toString()})()`;
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = e => {
      if (!e.data.done) return onProgress?.(e.data.progress);
      worker.terminate();
      const mk = (data, gamma) => {
        const t = B.RawTexture.CreateRGBATexture(new Uint8Array(data.buffer), W, H, scene, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
        t.gammaSpace = gamma; t.wrapU = B.Texture.WRAP_ADDRESSMODE; t.wrapV = B.Texture.CLAMP_ADDRESSMODE;
        t.anisotropicFilteringLevel = 8;
        return t;
      };
      const r = { albedo: mk(e.data.alb, true), orm: mk(e.data.orm, false), normal: mk(e.data.nrm, false), clouds: mk(e.data.cld, true) };
      r.clouds.hasAlpha = true;
      resolve(r);
    };
    worker.postMessage({ W, H });
  });
}

/** Weicher, radialer Lichtfleck (Sonne, Mündungsfeuer, Funken) */
export function glowTexture(scene, name, stops, size = 256) {
  const t = new B.DynamicTexture(name, size, scene, true);
  const ctx = t.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  t.update(); t.hasAlpha = true;
  return t;
}
