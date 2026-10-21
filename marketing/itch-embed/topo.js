/* ---- Topo-Hintergrund für den Startbildschirm ----
 * Vanilla-Port von kokonutUI „Topo Background" (MIT, © 2025 kokonutUI,
 * https://kokonutui.com). Das Original ist eine React-Komponente; das Spiel
 * läuft ohne Build-Schritt, darum hier dieselbe Technik als einfache Funktion:
 * Rauschfeld → Marching Squares → Höhenlinien auf einem Canvas.
 *
 * startTopo(root, canvas, opts) zeichnet die Karte auf `canvas`, hört auf
 * Maus/Klick in `root` und gibt eine stop()-Funktion zurück.
 *   opts.interactiveWhen  Funktion → true, solange Maus/Klick wirken sollen
 *                         (im Spiel selbst soll ein Klick auf die Karte keine
 *                         Welle auslösen, auf dem Startbildschirm schon).
 *   opts.calmSpeed        Tempo, solange interactiveWhen() false ist.
 *   opts.calmFrameMs      Bildabstand dann (spart Rechenzeit neben dem Spiel). Elemente mit
 * `data-topo-avoid` bekommen keine Höhenzahlen über sich gedruckt, und Klicks
 * darauf lösen keine Welle aus. */
(function () {
  "use strict";

  const CELL = 12;               // Abstand der Feldpunkte (px)
  const TERRAIN_SCALE = 360;     // Breite eines Hügels (px)
  const INDEX_EVERY = 5;         // jede 5. Linie kräftiger, wie auf echten Karten
  const HILL_HEIGHT = 0.5, HILL_SPREAD = 120, HILL_FOLLOW = 9, HILL_RISE = 5;
  const RIPPLE_MS = 1800, RIPPLE_SPEED = 0.24, RIPPLE_WIDTH = 42,
        RIPPLE_HEIGHT = 0.2, RIPPLE_WAVELENGTH = 96;
  const IDLE_FRAME_MS = 33;   // im ruhigen Modus über opts.calmFrameMs anpassbar
  const LABEL_SPACING = 210, LABEL_BASE = 500, LABEL_STEP = 20,
        LABEL_MARGIN = 0.12, MAX_LABEL_ANGLE = Math.PI / 3;
  const LABEL_FONT = '500 10px "IBM Plex Mono", ui-monospace, Menlo, monospace';

  /* Perlins „improved noise", mit Seed, damit die Karte immer gleich startet. */
  function createNoise(seed) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let state = seed >>> 0 || 1;
    const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    const grad = (hash, x, y, z) => {
      const h = hash & 15, u = h < 8 ? x : y;
      let v = z;
      if (h < 4) v = y; else if (h === 12 || h === 14) v = x;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    return (x, y, z) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      const fx = x - Math.floor(x), fy = y - Math.floor(y), fz = z - Math.floor(z);
      const u = fade(fx), v = fade(fy), w = fade(fz);
      const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
      const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
      return lerp(
        lerp(lerp(grad(perm[AA], fx, fy, fz), grad(perm[BA], fx - 1, fy, fz), u),
             lerp(grad(perm[AB], fx, fy - 1, fz), grad(perm[BB], fx - 1, fy - 1, fz), u), v),
        lerp(lerp(grad(perm[AA + 1], fx, fy, fz - 1), grad(perm[BA + 1], fx - 1, fy, fz - 1), u),
             lerp(grad(perm[AB + 1], fx, fy - 1, fz - 1), grad(perm[BB + 1], fx - 1, fy - 1, fz - 1), u), v),
        w);
    };
  }

  /* Liniensegment durch eine Zelle je nach Eckenmuster (TL 8, TR 4, BR 2, BL 1). */
  function cellSegments(path, index, x0, y0, x1, y1, top, right, bottom, left) {
    const line = (ax, ay, bx, by) => { path.moveTo(ax, ay); path.lineTo(bx, by); };
    switch (index) {
      case 1: case 14: line(x0, left, bottom, y1); break;
      case 2: case 13: line(bottom, y1, x1, right); break;
      case 3: case 12: line(x0, left, x1, right); break;
      case 4: case 11: line(top, y0, x1, right); break;
      case 6: case 9:  line(top, y0, bottom, y1); break;
      case 7: case 8:  line(x0, left, top, y0); break;
      case 5:  line(x0, left, top, y0); line(bottom, y1, x1, right); break;
      case 10: line(top, y0, x1, right); line(x0, left, bottom, y1); break;
    }
  }

  function offerLabel(slots, label) {
    const { x, y } = label;
    if (y < slots.height * LABEL_MARGIN || y > slots.height * (1 - LABEL_MARGIN) ||
        x < 24 || x > slots.width - 24 ||
        slots.avoid.some(r => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) return;
    const row = Math.floor(y / LABEL_SPACING);
    const shifted = x + slots.drift + (row % 2) * (LABEL_SPACING / 2);
    const col = Math.floor(shifted / LABEL_SPACING);
    const cx = (col + 0.5) * LABEL_SPACING, cy = (row + 0.5) * LABEL_SPACING;
    const score = (shifted - cx) ** 2 + (y - cy) ** 2;
    if (score > (LABEL_SPACING * 0.32) ** 2) return;
    const key = row * 100000 + col;
    const cur = slots.best.get(key);
    if (!cur || score < cur.score) slots.best.set(key, { ...label, score });
  }

  function offerCellLabel(slots, a, b, c, d, x0, y0, level, t) {
    const gx = b - a + c - d, gy = d - a + c - b;
    const px = gx / (2 * CELL), py = gy / (2 * CELL), g2 = px * px + py * py;
    const lift = g2 > 0 ? (t - (a + b + c + d) / 4) / g2 : 0;
    const half = CELL / 2;
    const ox = Math.max(-half, Math.min(half, lift * px));
    const oy = Math.max(-half, Math.min(half, lift * py));
    let angle = Math.atan2(gx, -gy);
    if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
    if (Math.abs(angle) > MAX_LABEL_ANGLE) return;
    offerLabel(slots, { x: x0 + half + ox, y: y0 + half + oy, angle, level });
  }

  function traceContours(field, cols, rows, interval, minor, major, slots) {
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i], b = field[j * cols + i + 1];
        const c = field[(j + 1) * cols + i + 1], d = field[(j + 1) * cols + i];
        const first = Math.ceil(Math.min(a, b, c, d) / interval);
        const last = Math.floor(Math.max(a, b, c, d) / interval);
        if (first > last) continue;
        const x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
        for (let level = first; level <= last; level++) {
          const t = level * interval;
          const index = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
          if (index === 0 || index === 15) continue;
          const isIndex = level % INDEX_EVERY === 0;
          cellSegments(isIndex ? major : minor, index, x0, y0, x1, y1,
            x0 + CELL * ((t - a) / (b - a)), y0 + CELL * ((t - b) / (c - b)),
            x0 + CELL * ((t - d) / (c - d)), y0 + CELL * ((t - a) / (d - a)));
          if (isIndex && slots && index !== 5 && index !== 10)
            offerCellLabel(slots, a, b, c, d, x0, y0, level, t);
        }
      }
    }
  }

  function startTopo(root, canvas, opts) {
    opts = opts || {};
    const interval = opts.interval ?? 0.07;
    const speed = opts.speed ?? 1;
    const interactive = opts.interactive ?? true;
    const labels = opts.labels ?? true;
    const interactiveWhen = opts.interactiveWhen || (() => true);
    const calmSpeed = opts.calmSpeed ?? speed;
    const calmFrameMs = opts.calmFrameMs ?? IDLE_FRAME_MS;
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => {};

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const noise = createNoise(opts.seed ?? 26);
    let width = 0, height = 0, cols = 0, rows = 0, field = new Float32Array(0), color = "";
    const hill = { x: 0, y: 0, targetX: 0, targetY: 0, amount: 0, on: false };
    const ripples = [];
    let time = 0, last = 0, lastPaint = 0, raf = 0, visible = true;
    const slots = { drift: 0, width: 0, height: 0, best: new Map(), avoid: [] };

    const measureAvoid = () => {
      const o = canvas.getBoundingClientRect();
      slots.avoid = [];
      for (const el of root.querySelectorAll("[data-topo-avoid]")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        slots.avoid.push({ x0: r.left - o.left - 16, y0: r.top - o.top - 12,
                           x1: r.right - o.left + 16, y1: r.bottom - o.top + 12 });
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / CELL) + 1; rows = Math.ceil(height / CELL) + 1;
      field = new Float32Array(cols * rows);
      color = getComputedStyle(canvas).color;
      measureAvoid();
    };

    const sample = now => {
      const z = time * 0.05, drift = time * 6, hillOn = hill.amount > 0.001;
      const spread = 2 * HILL_SPREAD * HILL_SPREAD, ringWidth = 2 * RIPPLE_WIDTH * RIPPLE_WIDTH;
      for (let j = 0; j < rows; j++) {
        const y = j * CELL;
        for (let i = 0; i < cols; i++) {
          const x = i * CELL;
          const nx = (x + drift) / TERRAIN_SCALE, ny = y / TERRAIN_SCALE;
          let v = noise(nx, ny, z) * 0.78 + noise(nx * 2.3 + 17.1, ny * 2.3 + 4.7, z * 1.4) * 0.22;
          if (hillOn) {
            const dx = x - hill.x, dy = y - hill.y;
            v += HILL_HEIGHT * hill.amount * Math.exp(-(dx * dx + dy * dy) / spread);
          }
          for (const r of ripples) {
            const age = now - r.start;
            const d = Math.hypot(x - r.x, y - r.y) - age * RIPPLE_SPEED;
            const f = 1 - age / RIPPLE_MS;
            v += RIPPLE_HEIGHT * f * f * Math.exp(-(d * d) / ringWidth) *
                 Math.cos((d / RIPPLE_WAVELENGTH) * Math.PI * 2);
          }
          field[j * cols + i] = v;
        }
      }
    };

    const drawLabels = () => {
      ctx.font = LABEL_FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const l of slots.best.values()) {
        const text = String(LABEL_BASE + l.level * LABEL_STEP);
        const w = ctx.measureText(text).width + 8;
        ctx.save();
        ctx.translate(Math.round(l.x), Math.round(l.y)); ctx.rotate(l.angle);
        ctx.globalCompositeOperation = "destination-out"; ctx.globalAlpha = 1;
        ctx.fillRect(-w / 2, -6, w, 12);
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.55;
        ctx.fillText(text, 0, 0.5);
        ctx.restore();
      }
    };

    const paint = now => {
      sample(now);
      const minor = new Path2D(), major = new Path2D();
      slots.best.clear(); slots.drift = time * 6; slots.width = width; slots.height = height;
      traceContours(field, cols, rows, interval, minor, major, labels ? slots : null);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round";
      ctx.globalAlpha = 0.16; ctx.lineWidth = 0.75; ctx.stroke(minor);
      ctx.globalAlpha = 0.38; ctx.lineWidth = 1.1;  ctx.stroke(major);
      if (labels) drawLabels();
      ctx.globalAlpha = 1;
    };

    const stepHill = dt => {
      const follow = 1 - Math.exp(-HILL_FOLLOW * dt);
      hill.x += (hill.targetX - hill.x) * follow; hill.y += (hill.targetY - hill.y) * follow;
      const goal = hill.on ? 1 : 0;
      hill.amount += (goal - hill.amount) * (1 - Math.exp(-HILL_RISE * dt));
      return Math.abs(hill.targetX - hill.x) > 0.5 || Math.abs(hill.targetY - hill.y) > 0.5 ||
             Math.abs(goal - hill.amount) > 0.002;
    };

    const frame = now => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      const hillMoving = stepHill(dt);
      while (ripples.length && now - ripples[0].start > RIPPLE_MS) ripples.shift();
      const settling = hillMoving || ripples.length > 0;
      const live = interactiveWhen();
      time += dt * (live ? speed : calmSpeed);
      if (settling || now - lastPaint >= (live ? IDLE_FRAME_MS : calmFrameMs)) { paint(now); lastPaint = now; }
      if (speed > 0 || settling) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !reduceMotion) { last = 0; raf = requestAnimationFrame(frame); }
    };

    resize(); paint(performance.now());
    canvas.style.opacity = "1";
    start();

    /* Themenwechsel (Vermessung/Kartenpapier): Linienfarbe neu lesen. */
    const aufThema = () => { color = getComputedStyle(canvas).color; paint(performance.now()); };
    document.addEventListener("themawechsel", aufThema);
    const ro = new ResizeObserver(() => { resize(); paint(performance.now()); });
    ro.observe(canvas);
    /* Elemente, die sich nachträglich verschieben (Modus-Wechsel, Plakate),
     * gelegentlich neu vermessen — billig und nur, solange sichtbar. */
    const avoidTimer = setInterval(() => { if (visible) measureAvoid(); }, 1000);

    let onScreen = true;
    const updateVisible = () => {
      visible = onScreen && document.visibilityState === "visible";
      if (visible) start();
    };
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; updateVisible(); });
    io.observe(canvas);
    document.addEventListener("visibilitychange", updateVisible);

    const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onMove = e => {
      if (e.pointerType !== "mouse") return;
      if (!interactiveWhen()) { if (hill.on) onLeave(); return; }
      const p = local(e);
      if (!hill.on) { hill.x = p.x; hill.y = p.y; }
      hill.targetX = p.x; hill.targetY = p.y; hill.on = true;
      start();
    };
    const onLeave = () => { hill.on = false; start(); };
    const onDown = e => {
      if (!interactiveWhen()) return;
      if (e.target.closest("[data-topo-avoid], a, button, input, textarea, select")) return;
      ripples.push({ ...local(e), start: performance.now() });
      if (ripples.length > 4) ripples.shift();
      start();
    };
    if (interactive && !reduceMotion) {
      root.addEventListener("pointermove", onMove);
      root.addEventListener("pointerleave", onLeave);
      root.addEventListener("pointerdown", onDown);
    }

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); clearInterval(avoidTimer);
      document.removeEventListener("visibilitychange", updateVisible);
      document.removeEventListener("themawechsel", aufThema);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerdown", onDown);
    };
  }

  window.startTopo = startTopo;
})();
