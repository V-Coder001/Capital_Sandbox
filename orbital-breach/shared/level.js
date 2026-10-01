/* ============================================================
 * Orbital Breach — Leveldefinition + Kollision (Server UND Client)
 * ============================================================
 * Die Station besteht aus achsenparallelen Innenräumen (ROOMS), die über
 * Durchgänge (DOORS) verbunden sind. Begehbar ist genau die Vereinigung
 * aller Räume und Durchgänge, abzüglich der festen Einbauten (SOLIDS).
 * Diese Datei wird unverändert vom Server (Drohnen-KI, Sichtlinien) und
 * vom Browser (Spielerbewegung, Rendering) importiert — beide rechnen so
 * garantiert mit derselben Geometrie.
 *
 * Einheiten: Meter. Station liegt entlang +X. */

export const ROOMS = [
  { id: "airlock", name: "Andockschleuse",   min: [-6, 0, -2.5], max: [0, 3, 2.5],  gravity: true,  atmo: true,  theme: "clean" },
  { id: "corA",    name: "Korridor A",       min: [0, 0, -1.5],  max: [14, 3, 1.5], gravity: true,  atmo: true,  theme: "clean" },
  { id: "obs",     name: "Beobachtungsdeck", min: [14, 0, -5],   max: [24, 4, 5],   gravity: true,  atmo: true,  theme: "clean" },
  { id: "corB",    name: "Korridor B",       min: [24, 0, -1.5], max: [32, 3, 1.5], gravity: true,  atmo: true,  theme: "worn" },
  { id: "hub",     name: "Zentralknoten",    min: [32, -4, -7],  max: [46, 8, 7],   gravity: false, atmo: true,  theme: "hub" },
  { id: "corC",    name: "Korridor C",       min: [46, 0, -1.5], max: [54, 3, 1.5], gravity: true,  atmo: false, theme: "damaged" },
  { id: "cmd",     name: "Kommandomodul",    min: [54, 0, -6],   max: [66, 4, 6],   gravity: true,  atmo: false, theme: "damaged" },
];

export const ROOM_INDEX = Object.fromEntries(ROOMS.map((r, i) => [r.id, i]));

/* Durchgänge: Volumen, das die gemeinsame Wand zweier Räume durchstößt. */
function door(x, a, b) {
  return { min: [x - 0.6, 0, -0.8], max: [x + 0.6, 2.4, 0.8], a: ROOM_INDEX[a], b: ROOM_INDEX[b], x };
}
export const DOORS = [
  door(0, "airlock", "corA"),
  door(14, "corA", "obs"),
  door(24, "obs", "corB"),
  door(32, "corB", "hub"),
  door(46, "hub", "corC"),
  door(54, "corC", "cmd"),
];

/* Fenster: Loch in einer Raumwand. axis = Achse der Wandnormalen,
 * side = -1 (Wand bei min) / +1 (Wand bei max). u/v = Ausdehnung in der
 * Wandebene (axis "z": u=x, v=y; axis "x": u=z, v=y).
 * Bruchfeste Bullaugen haben breachable:false. */
export const WINDOWS = [
  { room: "obs", axis: "z", side: -1, u: [15.5, 22.5], v: [0.7, 3.4], breachable: true,  hp: 140 },
  { room: "hub", axis: "z", side: 1,  u: [36, 42],     v: [-1, 5],    breachable: true,  hp: 160 },
  { room: "cmd", axis: "x", side: 1,  u: [-3, 3],      v: [1, 3.2],   breachable: true,  hp: 120 },
  { room: "corA", axis: "z", side: 1, u: [3, 4.6],     v: [1.1, 2.2], breachable: false, hp: 0 },
  { room: "corA", axis: "z", side: 1, u: [7, 8.6],     v: [1.1, 2.2], breachable: false, hp: 0 },
  { room: "corA", axis: "z", side: 1, u: [11, 12.6],   v: [1.1, 2.2], breachable: false, hp: 0 },
  { room: "corB", axis: "z", side: -1, u: [27, 29],    v: [1.1, 2.2], breachable: false, hp: 0 },
].map((w, i) => {
  const r = ROOMS[ROOM_INDEX[w.room]];
  const ax = w.axis === "x" ? 0 : 2;
  const plane = w.side < 0 ? r.min[ax] : r.max[ax];
  const uc = (w.u[0] + w.u[1]) / 2, vc = (w.v[0] + w.v[1]) / 2;
  const center = w.axis === "x" ? [plane, vc, uc] : [uc, vc, plane];
  const normal = w.axis === "x" ? [w.side, 0, 0] : [0, 0, w.side];   // zeigt nach draußen
  return { ...w, id: i, roomIdx: ROOM_INDEX[w.room], plane, center, normal };
});

/* Feste Einbauten (Kisten, Konsolen, Säulen) — blockieren Bewegung + Sicht. */
export const SOLIDS = [
  { min: [-5.8, 0, -2.4], max: [-4.6, 2.2, -1.8], kind: "locker" },
  { min: [-5.8, 0, 1.8],  max: [-4.6, 2.2, 2.4],  kind: "locker" },
  { min: [5.5, 0, -1.5],  max: [6.5, 1.0, -0.7],  kind: "crate" },
  { min: [9.8, 0, 0.6],   max: [10.6, 0.8, 1.5],  kind: "crate" },
  { min: [18, 0, 1.2],    max: [20.5, 1.0, 2.4],  kind: "console" },
  { min: [16, 0, 3.6],    max: [17.2, 1.2, 4.9],  kind: "crate" },
  { min: [22.4, 0, 2.6],  max: [23.6, 0.9, 3.8],  kind: "crate" },
  { min: [28.6, 0, 0.5],  max: [29.6, 1.1, 1.5],  kind: "crate" },
  { min: [38, -1, -1.5],  max: [40, 4.5, 1.5],    kind: "core" },     // Versorgungskern im Knoten
  { min: [34, 3.2, -6.5], max: [35.5, 4.4, -4],   kind: "crate" },
  { min: [43, -3.5, 3.5], max: [44.8, -2, 5.5],   kind: "crate" },
  { min: [50, 0, -1.5],   max: [51.2, 1.3, -0.4], kind: "debris" },
  { min: [62.2, 0, -0.8], max: [63.4, 1.1, 0.8],  kind: "terminal" },
  { min: [57, 0, 3.8],    max: [58.4, 1.2, 5.2],  kind: "crate" },
  { min: [58, 0, -5.4],   max: [60.5, 1.0, -4],   kind: "console" },
];

export const TERMINAL = { pos: [61.6, 1.2, 0], room: ROOM_INDEX.cmd, radius: 2.6 };

/* Spieler-Position = Körpermittelpunkt; HALF = halbe Ausdehnung der Kollisionsbox. */
export const PLAYER_HALF = [0.32, 0.88, 0.32];
export const EYE_OFFSET = 0.72;
export const DRONE_HALF = [0.42, 0.42, 0.42];

export const SPAWNS = [[-3.8, 0.88, -1], [-3.8, 0.88, 1], [-2.2, 0.88, -1], [-2.2, 0.88, 1]];

export const DRONE_SPAWNS = {
  hub: [[35, 5, 5], [44, 6, -5], [42, -2, 5], [34, -2, -5]],
  cmd: [[64.5, 3, -4.5], [64.5, 3, 4.5], [56, 3.2, 0]],
  corC: [[52, 2.2, 0]],
};

/* ---------- Geometrie-Helfer ---------- */

const VOLUMES = [...ROOMS, ...DOORS];

function inside(v, p, eps = 0) {
  return p[0] >= v.min[0] - eps && p[0] <= v.max[0] + eps &&
         p[1] >= v.min[1] - eps && p[1] <= v.max[1] + eps &&
         p[2] >= v.min[2] - eps && p[2] <= v.max[2] + eps;
}

/** Raum-Index, in dem der Punkt liegt (Durchgänge zählen zum näheren Raum), sonst -1. */
export function roomAt(p) {
  for (let i = 0; i < ROOMS.length; i++) if (inside(ROOMS[i], p, 0.001)) return i;
  for (const d of DOORS) if (inside(d, p)) return p[0] < d.x ? d.a : d.b;
  return -1;
}

export function insideSolid(p, pad = 0) {
  for (const s of SOLIDS) if (inside(s, p, pad)) return true;
  return false;
}

/**
 * Schiebt eine Box (Mittelpunkt p, halbe Größe h) in den begehbaren Raum.
 * Gibt null zurück, wenn p in keinem Volumen liegt (Aufrufer setzt dann zurück).
 * contact[ax] = -1/+1, wenn auf dieser Achse gegen Boden/Wand korrigiert wurde.
 */
export function resolveBox(p, h) {
  let best = null, bestD = Infinity;
  for (const v of VOLUMES) {
    if (!inside(v, p, 0.002)) continue;
    const q = [0, 0, 0];
    let d = 0;
    for (let a = 0; a < 3; a++) {
      const lo = v.min[a] + h[a], hi = v.max[a] - h[a];
      q[a] = lo > hi ? (v.min[a] + v.max[a]) / 2 : Math.min(hi, Math.max(lo, p[a]));
      d += Math.abs(q[a] - p[a]);
    }
    if (d < bestD) { bestD = d; best = q; }
  }
  if (!best) return null;
  const contact = [0, 0, 0];
  for (let a = 0; a < 3; a++) if (best[a] !== p[a]) contact[a] = best[a] > p[a] ? -1 : 1;
  // Einbauten: entlang der kleinsten Eindringtiefe herausdrücken
  for (const s of SOLIDS) {
    let minPen = Infinity, axis = -1, dir = 0;
    let overlap = true;
    for (let a = 0; a < 3; a++) {
      const lo = s.min[a] - h[a], hi = s.max[a] + h[a];
      if (best[a] <= lo || best[a] >= hi) { overlap = false; break; }
      const pl = best[a] - lo, ph = hi - best[a];
      if (pl < minPen) { minPen = pl; axis = a; dir = -1; }
      if (ph < minPen) { minPen = ph; axis = a; dir = 1; }
    }
    if (!overlap) continue;
    best[axis] = dir < 0 ? s.min[axis] - h[axis] : s.max[axis] + h[axis];
    contact[axis] = dir < 0 ? 1 : -1;
  }
  return { pos: best, contact };
}

/** Freie Sichtlinie zwischen a und b (keine Wand, kein Einbau dazwischen)? */
export function lineOfSight(a, b, step = 0.3) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
    if (!VOLUMES.some(v => inside(v, p))) return false;
    if (insideSolid(p)) return false;
  }
  return true;
}

/** Nächster Durchgang auf dem kürzesten Raumpfad von Raum `from` nach `to` (BFS). */
export function nextDoorToward(from, to) {
  if (from === to || from < 0 || to < 0) return null;
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift();
    if (r === to) break;
    for (const d of DOORS) {
      const n = d.a === r ? d.b : d.b === r ? d.a : -1;
      if (n >= 0 && !prev.has(n)) { prev.set(n, { r, d }); queue.push(n); }
    }
  }
  if (!prev.has(to)) return null;
  let cur = to, step = prev.get(cur);
  while (step && step.r !== from) { cur = step.r; step = prev.get(cur); }
  return step ? step.d : null;
}

/** Abstand eines Punkts zur Fensteröffnung (Ebene) und ob er im Fensterrechteck liegt. */
export function windowProximity(w, p) {
  const ax = w.axis === "x" ? 0 : 2;
  const dist = (w.plane - p[ax]) * w.side;          // >0 = noch im Raum
  const u = w.axis === "x" ? p[2] : p[0];
  const inRect = u > w.u[0] - 0.4 && u < w.u[1] + 0.4 && p[1] > w.v[0] - 0.6 && p[1] < w.v[1] + 0.6;
  return { dist, inRect };
}

export const RULES = {
  maxPlayers: 4,
  playerHp: 100,
  droneHp: 60,
  rifleDamage: 20,
  breachSeconds: 7,          // so lange saugt ein Leck, bevor das Notschott fällt
  sealedSeconds: 40,         // danach wird das Fenster ersetzt
  uploadSeconds: 75,
  respawnSeconds: 10,
  suction: 26,               // m/s² Sog am Leck
};
