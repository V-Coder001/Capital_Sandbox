/* ---- Spielfläche „Geländemodell" ----
 * Neue Optik der Insel, passend zum Topo-Hintergrund (topo.js):
 *  - flache, gedeckte Zonenfarben statt Fototexturen; Ackerfurchen, Beton mit
 *    Warnschraffur für die Industrie, schraffiertes Wasser im Kartenpapier-Stil
 *  - Sockel unter der Insel mit Schichtlinien (wie ein Geländemodell)
 *  - Höhenlinien auf dem Boden, Mittelstreifen auf Straßen, Bezirksgrenzen
 *  - Bezirksschilder (Agrar, Zentrum, Industrie, Küste)
 *
 * Zwei Themen: "vermessung" (Standard, dunkel) und "papier" (hell). Das Thema
 * steht in <html data-theme="…">. Alles Teure (Kachelrauten, Linien-Ebene)
 * wird je Karte + Thema EINMAL vorgerendert und danach nur noch platziert.
 *
 * Aufrufe aus draw() in index.html (nur außerhalb von Plan-/Kartellmodus):
 *   FLAECHE.unter(cx, map)    → Sockel, vor den Kacheln
 *   FLAECHE.tile(t)           → Raute für eine Kachel (statt tileSprite)
 *   FLAECHE.gesperrt()        → Schleier für gesperrte Kacheln
 *   FLAECHE.ueber(cx, map)    → Linien-Ebene, nach den Kacheln
 *   FLAECHE.schilder(cx, map) → Bezirksschilder, nach den Gebäuden
 * iso, TW, TH und makeDiamond kommen aus dem Hauptskript (globale Namen). */
(function () {
  "use strict";

  const PAL = {
    vermessung: {
      line: "125,211,252",
      agrar: "#173a2e", field: "#1c4434", park: "#18402f", zentrum: "#1b2535", industrie: "#2a2b31",
      kueste: "#33402f", sand: "#4a4128", wasser: "#0d2a40", deep: "#0a2134", road: "#0d131d", wohnen: "#2a2a3c",
      furche: "rgba(125,211,252,.10)", schraffur: "rgba(251,191,36,.20)", raster: "rgba(125,211,252,.09)",
      wasserLinie: null, lane: "rgba(125,211,252,.5)", hoehe: "rgba(125,211,252,.16)",
      grenze: "rgba(125,211,252,.55)", indGrenze: "rgba(251,191,36,.6)",
      seite1: "#0c1a28", seite2: "#08121c", schicht: "rgba(125,211,252,.22)",
      schildBg: "rgba(7,11,16,.82)", schildRand: "rgba(125,211,252,.45)", schildText: "#bae6fd",
      indBg: "rgba(30,22,6,.88)", indText: "#fcd34d",
      schildFont: '600 13px "IBM Plex Mono", ui-monospace, monospace',
      gesperrt: "rgba(4,10,18,.30)",
    },
    papier: {
      line: "31,26,20",
      agrar: "#c6cf9f", field: "#b8c58a", park: "#a9bd84", zentrum: "#e4dccb", industrie: "#c9c4bb",
      kueste: "#d9d3a8", sand: "#eadbb2", wasser: "#a8c3cc", deep: "#93b3be", road: "#f8f4ea", wohnen: "#e6d3c6",
      furche: "rgba(31,26,20,.18)", schraffur: "rgba(31,26,20,.30)", raster: "rgba(31,26,20,.14)",
      wasserLinie: "rgba(31,26,20,.20)", lane: "rgba(31,26,20,.35)", hoehe: "rgba(31,26,20,.22)",
      grenze: "rgba(31,26,20,.85)", indGrenze: "rgba(156,59,31,.9)",
      seite1: "#d8ccb4", seite2: "#c4b596", schicht: "rgba(31,26,20,.45)",
      schildBg: "#f8f4ea", schildRand: "#1f1a14", schildText: "#1f1a14",
      indBg: "#f8f4ea", indText: "#9c3b1f",
      schildFont: '800 13px "Archivo", system-ui, sans-serif',
      gesperrt: "rgba(31,26,20,.16)",
    },
  };
  const thema = () => document.documentElement.dataset.theme === "papier" ? "papier" : "vermessung";
  const pal = () => PAL[thema()];


  /* ---- Kachelrauten ---- */
  const RAUTEN = {};
  function art(t) {
    if (t.water) return t.deep ? "deep" : "wasser";
    if (t.road) return "road";
    if (t.park) return "park";
    if (t.sand) return "sand";
    if (t.zone === "agrar" && t.field) return "field";
    return t.zone in PAL.vermessung ? t.zone : "agrar";
  }
  function kachel(t, TW, TH, makeDiamond) {
    const th = thema(), a = art(t), key = th + ":" + a;
    if (RAUTEN[key]) return RAUTEN[key];
    const P = PAL[th];
    RAUTEN[key] = makeDiamond(g => {
      g.fillStyle = P[a]; g.fillRect(0, 0, TW, TH);
      if (a === "field") {                     // Ackerfurchen
        g.strokeStyle = P.furche; g.lineWidth = .8;
        for (let k = -TW; k < TW * 2; k += 6) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + TW, TH); g.stroke(); }
      }
      if (a === "wohnen") {                    // Wohngebiet: Parzellen wie im Bebauungsplan
        g.strokeStyle = `rgba(${P.line},${th === "papier" ? .22 : .14})`; g.lineWidth = .8;
        g.beginPath(); g.moveTo(TW / 2, TH * .18); g.lineTo(TW / 2, TH * .82);
        g.moveTo(TW * .2, TH / 2); g.lineTo(TW * .8, TH / 2); g.stroke();
      }
      if (a === "industrie") {                 // Beton: Warnschraffur + Hallenraster
        g.strokeStyle = P.schraffur; g.lineWidth = 1.3;
        for (let k = -TW; k < TW * 2; k += 8) { g.beginPath(); g.moveTo(k, TH); g.lineTo(k + TW, 0); g.stroke(); }
        g.strokeStyle = `rgba(${P.line},${th === "papier" ? .2 : .12})`; g.lineWidth = .8;
        g.beginPath(); g.moveTo(TW / 4, TH / 4); g.lineTo(TW * 3 / 4, TH * 3 / 4);
        g.moveTo(TW * 3 / 4, TH / 4); g.lineTo(TW / 4, TH * 3 / 4); g.stroke();
      }
      if ((a === "wasser" || a === "deep") && P.wasserLinie) {   // Wasserschraffur (Papier)
        g.strokeStyle = P.wasserLinie; g.lineWidth = .8;
        for (let k = 2; k < TH; k += 4) { g.beginPath(); g.moveTo(0, k); g.lineTo(TW, k); g.stroke(); }
      }
      // Rasterlinie
      g.strokeStyle = a === "wasser" || a === "deep" ? `rgba(${P.line},.05)` : P.raster; g.lineWidth = .8;
      g.beginPath(); g.moveTo(TW / 2, 0); g.lineTo(TW, TH / 2); g.lineTo(TW / 2, TH); g.lineTo(0, TH / 2); g.closePath(); g.stroke();
    });
    return RAUTEN[key];
  }

  /* ---- Vorberechnete Linien-Ebene (Höhenlinien, Mittelstreifen, Grenzen) ---- */
  let EBENE = null;   // { key, canvas, ox, oy, s }
  function kartenKey(map) {
    /* Über ALLE Kacheln: Zone und Sperre. Ändert sich eins davon (Freischaltung),
     * wird der gebackene Boden neu erzeugt. 900 Ganzzahl-Schritte je Bild. */
    let h = map.length;
    for (let i = 0; i < map.length; i++) {
      const t = map[i];
      h = (h * 31 + t.x * 7 + t.y * 13 + (t.zone ? t.zone.charCodeAt(0) : 0) + (t.locked ? 101 : 0) + (t.road ? 3 : 0) + (t.water ? 5 : 0)) >>> 0;
    }
    return thema() + ":" + h;
  }
  function noise2(seed) {
    const p = Array.from({ length: 256 }, (_, i) => i); let s = seed;
    const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    const P = new Uint8Array(512); for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    const f = t => t * t * t * (t * (t * 6 - 15) + 10), L = (a, b, t) => a + (b - a) * t;
    const g = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
    return (x, y) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, fx = x - Math.floor(x), fy = y - Math.floor(y), u = f(fx), v = f(fy);
      const A = P[X] + Y, B = P[X + 1] + Y;
      return L(L(g(P[A], fx, fy), g(P[B], fx - 1, fy), u), L(g(P[A + 1], fx, fy - 1), g(P[B + 1], fx - 1, fy - 1), u), v);
    };
  }
  const zoneVon = t => t.water ? "wasser" : t.zone;

  function ebeneBauen(map, iso, TW, TH) {
    const T = new Map(); let maxX = 0, maxY = 0;
    for (const t of map) { T.set(t.x + "," + t.y, t); if (t.x > maxX) maxX = t.x; if (t.y > maxY) maxY = t.y; }
    const P = pal();
    // Weltausschnitt der Karte (iso: Spitze der Raute bei (sx, sy))
    const ox = -(maxY + 1) * TW / 2, oy = 0;
    const breite = (maxX + maxY + 2) * TW / 2, hoehe = (maxX + maxY + 2) * TH / 2 + TH;   // + Sockel
    const s = Math.min(2, 8192 / Math.max(breite, hoehe));
    const c = document.createElement("canvas");
    c.width = Math.ceil(breite * s); c.height = Math.ceil(hoehe * s);
    const g = c.getContext("2d");
    g.scale(s, s); g.translate(-ox, -oy);
    g.imageSmoothingQuality = "high";
    const mitte = (fx, fy) => { const [x, y] = iso(fx, fy); return [x, y + TH / 2]; };

    /* ---- Boden einmal backen (Performance) ----
     * Vorher: je Bild 900 Kachel-drawImage + Sockel-Pfade + diese Ebene. Jetzt
     * steckt alles Statische in EINEM Bild, das je Bild einmal platziert wird. */
    sockelZeichnen(g, map, T, iso, TW, TH, P);
    for (const t of map) {
      const [sx, sy] = iso(t.x, t.y);
      g.drawImage(kachel(t, TW, TH, makeDiamond), sx - TW / 2, sy, TW, TH);
      if (t.locked) {
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + TW / 2, sy + TH / 2); g.lineTo(sx, sy + TH); g.lineTo(sx - TW / 2, sy + TH / 2); g.closePath();
        g.fillStyle = P.gesperrt; g.fill();
        // kleines Schloss (wie drawLock im Hauptskript)
        const lx = sx, ly = sy + TH / 2 - 1;
        g.globalAlpha = .42; g.fillStyle = g.strokeStyle = thema() === "papier" ? "#4a4134" : "#7d97b5"; g.lineWidth = 1.4;
        g.beginPath(); g.arc(lx, ly - 2.6, 2.4, Math.PI, 0); g.stroke(); g.fillRect(lx - 3.6, ly - 2.4, 7.2, 5.4);
        g.globalAlpha = 1; g.lineWidth = 1;
      }
    }

    // Höhenlinien — Rauschfeld über das Kachelgitter, 2 Proben je Kachel
    const nz = noise2(9), R = 2, NX = (maxX + 1) * R + 1, NY = (maxY + 1) * R + 1;
    const F = new Float32Array(NX * NY);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
      F[j * NX + i] = nz(i / (7 * R), j / (7 * R)) + .4 * nz(i / (3 * R) + 9, j / (3 * R) + 3);
    const zuWelt = (gx, gy) => mitte(gx / R - .5, gy / R - .5);
    g.strokeStyle = P.hoehe; g.lineWidth = 1;
    for (let lv = -6; lv <= 6; lv++) {
      const th = lv * .12; g.beginPath();
      for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
        const a = F[j * NX + i], b = F[j * NX + i + 1], cc = F[(j + 1) * NX + i + 1], d = F[(j + 1) * NX + i];
        const pts = [];
        const e = (v0, v1, x0, y0, x1, y1) => { if ((v0 > th) !== (v1 > th)) { const k = (th - v0) / (v1 - v0); pts.push(zuWelt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)); } };
        e(a, b, i, j, i + 1, j); e(b, cc, i + 1, j, i + 1, j + 1); e(d, cc, i, j + 1, i + 1, j + 1); e(a, d, i, j, i, j + 1);
        if (pts.length >= 2) { g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); }
        if (pts.length === 4) { g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); }
      }
      g.stroke();
    }

    // Mittelstreifen auf Straßen
    g.strokeStyle = P.lane; g.lineWidth = 1.2; g.setLineDash([4, 4]);
    g.beginPath();
    for (const t of map) {
      if (!t.road) continue;
      const nb = (dx, dy) => T.get((t.x + dx) + "," + (t.y + dy))?.road;
      if (nb(1, 0) || nb(-1, 0)) { const a = mitte(t.x - .5, t.y), b = mitte(t.x + .5, t.y); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      if (nb(0, 1) || nb(0, -1)) { const a = mitte(t.x, t.y - .5), b = mitte(t.x, t.y + .5); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    }
    g.stroke(); g.setLineDash([]);

    // Bezirksgrenzen — Industrie in eigener Warnfarbe
    const kanten = { normal: new Path2D(), ind: new Path2D() };
    for (const t of map) {
      const [sx, sy] = iso(t.x, t.y), z = zoneVon(t);
      const rechts = T.get((t.x + 1) + "," + t.y), unten = T.get(t.x + "," + (t.y + 1));
      if (rechts && zoneVon(rechts) !== z) {
        const p = (z === "industrie" || zoneVon(rechts) === "industrie") ? kanten.ind : kanten.normal;
        p.moveTo(sx + TW / 2, sy + TH / 2); p.lineTo(sx, sy + TH);
      }
      if (unten && zoneVon(unten) !== z) {
        const p = (z === "industrie" || zoneVon(unten) === "industrie") ? kanten.ind : kanten.normal;
        p.moveTo(sx - TW / 2, sy + TH / 2); p.lineTo(sx, sy + TH);
      }
    }
    g.lineCap = "round";
    g.strokeStyle = P.grenze; g.lineWidth = 1.8; g.stroke(kanten.normal);
    g.strokeStyle = P.indGrenze; g.lineWidth = 2.4; g.stroke(kanten.ind);

    // Bezirksschilder: je zusammenhängendem Bezirksteil ab 12 Kacheln
    const NAMEN = { agrar: "AGRAR", zentrum: "ZENTRUM", industrie: "INDUSTRIE", kueste: "KÜSTE", wohnen: "WOHNGEBIET" };
    const gesehen = new Set(), schilder = [];
    for (const t of map) {
      const k = t.x + "," + t.y; if (gesehen.has(k) || t.water || !NAMEN[t.zone]) continue;
      const teil = [], stapel = [t]; gesehen.add(k);
      while (stapel.length) {
        const u = stapel.pop(); teil.push(u);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const kk = (u.x + dx) + "," + (u.y + dy), v = T.get(kk);
          if (v && !gesehen.has(kk) && !v.water && v.zone === t.zone) { gesehen.add(kk); stapel.push(v); }
        }
      }
      if (teil.length < 12) continue;
      const mx = teil.reduce((s, u) => s + u.x, 0) / teil.length, my = teil.reduce((s, u) => s + u.y, 0) / teil.length;
      // Schild auf eine Straße/freie Kachel nahe dem Schwerpunkt, nicht mitten auf ein Gebäude
      let best = null, bd = 1e9;
      for (const u of teil) { const d = (u.x - mx) ** 2 + (u.y - my) ** 2 + (u.btype || (u.zone === "wohnen" && !u.road) ? 6 : 0); if (d < bd) { bd = d; best = u; } }
      schilder.push({ x: best.x, y: best.y, text: NAMEN[t.zone], ind: t.zone === "industrie" });
    }

    return { key: kartenKey(map), canvas: c, ox, oy, s, w: breite, h: hoehe, maxX, maxY, T, schilder };
  }

  /* Gebackenen Boden zeichnen. Als ImageBitmap liegt er fertig auf der
   * Grafikkarte; bis die Umwandlung fertig ist, dient das Canvas selbst.
   * Glättung "low": das Bild wird nur skaliert, nicht gedreht — die teure
   * Hochqualitäts-Filterung (vorher je Bild auf ~4000 px) bringt hier nichts. */
  function boden(cx, map, iso, TW, TH) {
    const key = kartenKey(map);
    if (!EBENE || EBENE.key !== key) {
      EBENE = ebeneBauen(map, iso, TW, TH);
      const e = EBENE;
      if (window.createImageBitmap) createImageBitmap(e.canvas).then(bm => { if (EBENE === e) e.bitmap = bm; }).catch(() => {});
    }
    const q = cx.imageSmoothingQuality;
    cx.imageSmoothingQuality = "low";
    cx.drawImage(EBENE.bitmap || EBENE.canvas, EBENE.ox, EBENE.oy, EBENE.w, EBENE.h);
    cx.imageSmoothingQuality = q;
  }

  /* ---- Sockel: Seitenflächen an den unteren Kartenkanten ---- */
  function sockelZeichnen(cx, map, T, iso, TW, TH, P) {
    const H = TH * .9;
    const flaechen = [[new Path2D(), P.seite1], [new Path2D(), P.seite2]];
    const linien = new Path2D();
    for (const t of map) {
      const [sx, sy] = iso(t.x, t.y);
      if (!T.has((t.x + 1) + "," + t.y)) {     // rechte Kante
        const p = flaechen[0][0];
        p.moveTo(sx + TW / 2, sy + TH / 2); p.lineTo(sx, sy + TH); p.lineTo(sx, sy + TH + H); p.lineTo(sx + TW / 2, sy + TH / 2 + H); p.closePath();
        for (let k = H / 4; k < H; k += H / 4) { linien.moveTo(sx + TW / 2, sy + TH / 2 + k); linien.lineTo(sx, sy + TH + k); }
      }
      if (!T.has(t.x + "," + (t.y + 1))) {     // linke Kante
        const p = flaechen[1][0];
        p.moveTo(sx - TW / 2, sy + TH / 2); p.lineTo(sx, sy + TH); p.lineTo(sx, sy + TH + H); p.lineTo(sx - TW / 2, sy + TH / 2 + H); p.closePath();
        for (let k = H / 4; k < H; k += H / 4) { linien.moveTo(sx - TW / 2, sy + TH / 2 + k); linien.lineTo(sx, sy + TH + k); }
      }
    }
    for (const [p, f] of flaechen) { cx.fillStyle = f; cx.fill(p); }
    cx.strokeStyle = P.schicht; cx.lineWidth = 1; cx.stroke(linien);
  }

  /* ---- Bezirksschilder (über den Gebäuden) ---- */
  function schilder(cx, map, iso, TW, TH) {
    if (!EBENE) return;
    const P = pal();
    cx.save();
    cx.font = P.schildFont; cx.textAlign = "center"; cx.textBaseline = "middle";
    for (const s of EBENE.schilder) {
      const [sx, sy] = iso(s.x, s.y), y = sy + TH / 2;
      const w = cx.measureText(s.text).width + 20;
      cx.fillStyle = s.ind ? P.indBg : P.schildBg; cx.fillRect(sx - w / 2, y - 12, w, 24);
      cx.strokeStyle = s.ind ? P.indGrenze : P.schildRand; cx.lineWidth = s.ind ? 1.6 : 1.2;
      cx.strokeRect(sx - w / 2, y - 12, w, 24);
      cx.fillStyle = s.ind ? P.indText : P.schildText; cx.fillText(s.text, sx, y + 1);
    }
    cx.restore();
  }

  /* iso, TW, TH, makeDiamond: globale Namen aus dem Hauptskript, erst beim
   * Aufruf aufgelöst (dieses Skript lädt davor). */
  window.FLAECHE = {
    /* boden(): Sockel, Kacheln, Schlösser, Linien — alles in einem Bild */
    boden: (cx, map) => boden(cx, map, iso, TW, TH),
    tile: t => kachel(t, TW, TH, makeDiamond),
    unter: () => {}, ueber: () => {},          // in boden() aufgegangen
    schilder: (cx, map) => schilder(cx, map, iso, TW, TH),
    gesperrt: () => pal().gesperrt,
    thema,
  };
})();
