/* ============================================================
 * Station, Außenansicht und Beleuchtung
 * ============================================================ */
import { ROOMS, DOORS, WINDOWS, SOLIDS, TERMINAL, roomAt } from "/shared/level.js";
import {
  wallTextures, floorTextures, ceilingTextures, hullTextures, solarTextures, crateTextures,
  generateEarth, glowTexture,
} from "./textures.js";

const B = window.BABYLON;
const V3 = (x, y, z) => new B.Vector3(x, y, z);

export const SUN_DIR = V3(-0.35, 0.34, -0.87).normalize();     // zeigt zur Sonne
const THEME_LIGHT = {
  clean:   { color: [1, 0.96, 0.9],   intensity: 9,  panel: [1, 0.97, 0.92] },
  worn:    { color: [1, 0.88, 0.72],  intensity: 7,  panel: [1, 0.86, 0.68] },
  hub:     { color: [0.82, 0.9, 1],   intensity: 14, panel: [0.8, 0.9, 1] },
  damaged: { color: [1, 0.16, 0.07],  intensity: 6,  panel: [1, 0.12, 0.05] },
};

/* ---------- Rechteck-Subtraktion für Wände mit Löchern ---------- */
function subtract(rects, hole) {
  const out = [];
  for (const r of rects) {
    if (hole.u1 <= r.u0 || hole.u0 >= r.u1 || hole.v1 <= r.v0 || hole.v0 >= r.v1) { out.push(r); continue; }
    const hu0 = Math.max(r.u0, hole.u0), hu1 = Math.min(r.u1, hole.u1), hv0 = Math.max(r.v0, hole.v0), hv1 = Math.min(r.v1, hole.v1);
    if (r.u0 < hu0) out.push({ u0: r.u0, u1: hu0, v0: r.v0, v1: r.v1 });
    if (hu1 < r.u1) out.push({ u0: hu1, u1: r.u1, v0: r.v0, v1: r.v1 });
    if (r.v0 < hv0) out.push({ u0: hu0, u1: hu1, v0: r.v0, v1: hv0 });
    if (hv1 < r.v1) out.push({ u0: hu0, u1: hu1, v0: hv1, v1: r.v1 });
  }
  return out;
}

/* Achsenzuordnung je Wandachse: (u, v) → Weltkoordinaten */
const AXES = {
  x: { n: 0, u: 2, v: 1 },
  y: { n: 1, u: 0, v: 2 },
  z: { n: 2, u: 0, v: 1 },
};

/** Sammelt Quads in einem Mesh (ein Material pro Mesh). */
class QuadBatch {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  /** axis: "x"|"y"|"z", plane: Koordinate, dir: Normalenrichtung ±1, tile: Meter pro Texturkachel */
  add(axis, plane, dir, r, tile = 2, uvOffset = [0, 0]) {
    const A = AXES[axis];
    const base = this.pos.length / 3;
    const corners = [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
    for (const [u, v] of corners) {
      const p = [0, 0, 0]; p[A.n] = plane; p[A.u] = u; p[A.v] = v;
      this.pos.push(...p);
      const n = [0, 0, 0]; n[A.n] = dir; this.nrm.push(...n);
      // Wände: v=Höhe nach oben; Kachelung in Weltmetern → nahtlos zwischen Räumen
      this.uv.push((u * (axis === "x" ? -dir : dir)) / tile + uvOffset[0], v / tile + uvOffset[1]);
    }
    // Babylon: Vorderseite, wenn cross(b-a, c-a) entgegen der Normalen zeigt
    const a = V3(...this.pos.slice(base * 3, base * 3 + 3)), b = V3(...this.pos.slice(base * 3 + 3, base * 3 + 6)), c = V3(...this.pos.slice(base * 3 + 6, base * 3 + 9));
    const cr = B.Vector3.Cross(b.subtract(a), c.subtract(a));
    const nn = [0, 0, 0]; nn[A.n] = dir;
    if (B.Vector3.Dot(cr, V3(...nn)) < 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  build(name, scene, mat) {
    if (!this.idx.length) return null;
    const m = new B.Mesh(name, scene);
    const vd = new B.VertexData();
    vd.positions = this.pos; vd.normals = this.nrm; vd.uvs = this.uv; vd.indices = this.idx;
    vd.applyToMesh(m);
    m.material = mat;
    m.freezeWorldMatrix();
    return m;
  }
}

function pbr(scene, name, tex, opts = {}) {
  const m = new B.PBRMaterial(name, scene);
  if (tex) {
    m.albedoTexture = tex.albedo; m.bumpTexture = tex.normal; m.metallicTexture = tex.orm;
    m.useRoughnessFromMetallicTextureGreen = true; m.useMetallnessFromMetallicTextureBlue = true;
    m.useAmbientOcclusionFromMetallicTextureRed = true; m.useRoughnessFromMetallicTextureAlpha = false;
    m.metallic = 1; m.roughness = 1;
    m.bumpTexture.level = opts.bump ?? 1;
  } else {
    m.metallic = opts.metallic ?? 0; m.roughness = opts.roughness ?? 0.5;
  }
  if (opts.color) m.albedoColor = B.Color3.FromArray(opts.color);
  if (opts.emissive) { m.emissiveColor = B.Color3.FromArray(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity ?? 1; }
  m.maxSimultaneousLights = 8;
  return m;
}

function emissiveMat(scene, name, color, intensity = 4) {
  const m = new B.PBRMaterial(name, scene);
  m.albedoColor = B.Color3.Black(); m.metallic = 0; m.roughness = 1;
  m.emissiveColor = B.Color3.FromArray(color); m.emissiveIntensity = intensity;
  m.disableLighting = true;
  return m;
}

/* Text/Bildschirm-Textur */
function screenTexture(scene, name, w, h, draw) {
  const t = new B.DynamicTexture(name, { width: w, height: h }, scene, true);
  const ctx = t.getContext();
  draw(ctx, w, h);
  t.update();
  return t;
}

export async function buildWorld(scene, quality, progress) {
  const Q = { low: 0, medium: 1, high: 2, ultra: 3 }[quality] ?? 2;
  const texS = Q >= 2 ? 1024 : 512;

  /* ===== Texturen ===== */
  progress(0.05, "ERDE WIRD BERECHNET");
  const earthTex = await generateEarth(scene, Q >= 2 ? 2048 : 1024, Q >= 2 ? 1024 : 512, p => progress(0.05 + p * 0.45, "ERDE WIRD BERECHNET"));
  progress(0.52, "OBERFLÄCHEN WERDEN GEFERTIGT");
  await tick();
  const T = {
    wall: wallTextures(scene, { S: texS }),
    wallDirty: wallTextures(scene, { S: texS, dirty: true, seed: 8 }),
  };
  progress(0.65, "OBERFLÄCHEN WERDEN GEFERTIGT"); await tick();
  T.floor = floorTextures(scene, { S: texS });
  T.ceiling = ceilingTextures(scene, { S: texS / 2 });
  progress(0.75, "AUSSENHÜLLE"); await tick();
  T.hull = hullTextures(scene, { S: texS });
  T.solar = solarTextures(scene, { S: 512 });
  T.crateOrange = crateTextures(scene, [0.55, 0.22, 0.04], { seed: 13 });
  T.crateGrey = crateTextures(scene, [0.38, 0.4, 0.42], { seed: 17 });
  T.crateWhite = crateTextures(scene, [0.7, 0.7, 0.68], { seed: 19 });
  progress(0.85, "MODULE WERDEN VERBUNDEN"); await tick();

  const M = {
    wall: pbr(scene, "wall", T.wall),
    wallHub: pbr(scene, "wallHub", T.wall, { color: [0.8, 0.86, 0.95] }),
    wallDirty: pbr(scene, "wallDirty", T.wallDirty, { color: [0.85, 0.82, 0.8] }),
    floor: pbr(scene, "floor", T.floor),
    floorDirty: pbr(scene, "floorDirty", T.floor, { color: [0.7, 0.66, 0.62] }),
    ceiling: pbr(scene, "ceiling", T.ceiling),
    hull: pbr(scene, "hull", T.hull, { bump: 0.6 }),
    solar: pbr(scene, "solar", T.solar),
    frame: pbr(scene, "frame", null, { color: [0.1, 0.105, 0.115], metallic: 0.9, roughness: 0.38 }),
    steel: pbr(scene, "steel", null, { color: [0.6, 0.6, 0.62], metallic: 1, roughness: 0.28 }),
    rail: pbr(scene, "rail", null, { color: [0.75, 0.55, 0.08], metallic: 0.2, roughness: 0.45 }),
    pipe: pbr(scene, "pipe", null, { color: [0.55, 0.56, 0.58], metallic: 1, roughness: 0.35 }),
    pipeWhite: pbr(scene, "pipeWhite", null, { color: [0.8, 0.8, 0.78], metallic: 0, roughness: 0.6 }),
    crate: [T.crateOrange, T.crateGrey, T.crateWhite].map((t, i) => pbr(scene, "crate" + i, t)),
    console: pbr(scene, "console", null, { color: [0.08, 0.085, 0.095], metallic: 0.7, roughness: 0.35 }),
    doorLeaf: pbr(scene, "doorLeaf", T.wall, { color: [0.55, 0.58, 0.62] }),
  };

  const roomMeshes = ROOMS.map(() => []);
  const roomLights = ROOMS.map(() => []);
  const shadowCasters = [];
  const interiorMeshes = [];
  const exteriorMeshes = [];
  const pickables = [];
  const flicker = [];

  const wallMatFor = r => r.theme === "damaged" ? M.wallDirty : r.theme === "hub" ? M.wallHub : M.wall;
  const floorMatFor = r => r.theme === "damaged" || r.theme === "worn" ? M.floorDirty : M.floor;

  /* ===== Innenräume ===== */
  ROOMS.forEach((r, ri) => {
    const walls = new QuadBatch(), floors = new QuadBatch(), ceil = new QuadBatch();
    const faces = [
      { axis: "x", side: -1 }, { axis: "x", side: 1 },
      { axis: "z", side: -1 }, { axis: "z", side: 1 },
    ];
    for (const f of faces) {
      const A = AXES[f.axis];
      const plane = f.side < 0 ? r.min[A.n] : r.max[A.n];
      let rects = [{ u0: r.min[A.u], u1: r.max[A.u], v0: r.min[A.v], v1: r.max[A.v] }];
      if (f.axis === "x") for (const d of DOORS) if (Math.abs(d.x - plane) < 0.01 && (d.a === ri || d.b === ri))
        rects = subtract(rects, { u0: d.min[2], u1: d.max[2], v0: d.min[1], v1: d.max[1] });
      for (const w of WINDOWS) if (w.roomIdx === ri && w.axis === f.axis && w.side === f.side)
        rects = subtract(rects, { u0: w.u[0], u1: w.u[1], v0: w.v[0], v1: w.v[1] });
      for (const rc of rects) walls.add(f.axis, plane, -f.side, rc, 2);
    }
    floors.add("y", r.min[1], 1, { u0: r.min[0], u1: r.max[0], v0: r.min[2], v1: r.max[2] }, 2);
    ceil.add("y", r.max[1], -1, { u0: r.min[0], u1: r.max[0], v0: r.min[2], v1: r.max[2] }, 2);
    for (const [batch, mat, nm] of [[walls, wallMatFor(r), "walls"], [floors, floorMatFor(r), "floor"], [ceil, M.ceiling, "ceil"]]) {
      const m = batch.build(`${r.id}-${nm}`, scene, mat);
      if (!m) continue;
      m.receiveShadows = true;
      roomMeshes[ri].push(m); interiorMeshes.push(m); pickables.push(m);
    }

    /* Deckenleuchten + Punktlichter */
    const th = THEME_LIGHT[r.theme];
    const long = r.max[0] - r.min[0];
    const n = Math.max(1, Math.min(4, Math.round(long / 4.5)));
    const cz = (r.min[2] + r.max[2]) / 2;
    for (let i = 0; i < n; i++) {
      const x = r.min[0] + (long / n) * (i + 0.5);
      const y = r.max[1] - 0.02;
      const L = new B.PointLight(`${r.id}-L${i}`, V3(x, y - 0.35, cz), scene);
      L.diffuse = B.Color3.FromArray(th.color);
      L.specular = L.diffuse.clone();
      L.intensity = th.intensity * (r.theme === "hub" ? 2.2 : 1);
      L.range = r.theme === "hub" ? 22 : 11;
      L.includedOnlyMeshes = [];
      L.metadata = { base: L.intensity, baseColor: L.diffuse.clone(), room: ri };
      roomLights[ri].push(L);
      const panel = B.MeshBuilder.CreateBox(`${r.id}-panel${i}`, { width: 1.4, height: 0.04, depth: 0.32 }, scene);
      panel.position.set(x, y, cz);
      panel.material = emissiveMat(scene, `${r.id}-pm${i}`, th.panel, r.theme === "damaged" ? 3 : 6);
      L.metadata.panel = panel;
      if (r.theme === "damaged" || (r.theme === "worn" && i === 1)) flicker.push(L);
    }
    if (r.theme === "hub") {
      // Zusätzlich Ringleuchten an den Wänden des Knotens
      for (const [y, z] of [[-3.95, 0], [7.95, 0]]) {
        const strip = B.MeshBuilder.CreateBox(`hub-strip${y}`, { width: 10, height: 0.05, depth: 0.25 }, scene);
        strip.position.set(39, y, z + (y < 0 ? 4 : -4));
        strip.material = emissiveMat(scene, "hubStrip" + y, [0.6, 0.85, 1], 5);
      }
    }
  });

  /* ===== Durchgänge (Rahmen + automatische Schiebetüren) ===== */
  const doors = DOORS.map((d, i) => {
    const parts = [];
    const depth = 1.2, wz = d.max[2], h = d.max[1];
    for (const s of [-1, 1]) {
      const post = B.MeshBuilder.CreateBox(`door${i}-post${s}`, { width: depth, height: h, depth: 0.12 }, scene);
      post.position.set(d.x, h / 2, s * (wz + 0.06));
      post.material = M.frame; parts.push(post);
      const glow = B.MeshBuilder.CreateBox(`door${i}-glow${s}`, { width: depth + 0.02, height: h * 0.9, depth: 0.03 }, scene);
      glow.position.set(d.x, h / 2, s * (wz - 0.005));
      glow.material = emissiveMat(scene, `doorGlow${i}${s}`, ROOMS[d.b].atmo ? [0.25, 0.75, 1] : [1, 0.25, 0.1], 3);
      parts.push(glow);
    }
    const lintel = B.MeshBuilder.CreateBox(`door${i}-top`, { width: depth, height: 0.14, depth: wz * 2 + 0.24 }, scene);
    lintel.position.set(d.x, h + 0.07, 0); lintel.material = M.frame; parts.push(lintel);
    const sill = B.MeshBuilder.CreateBox(`door${i}-sill`, { width: depth, height: 0.02, depth: wz * 2 }, scene);
    sill.position.set(d.x, 0.01, 0); sill.material = M.frame; parts.push(sill);
    const leaves = [-1, 1].map(s => {
      const leaf = B.MeshBuilder.CreateBox(`door${i}-leaf${s}`, { width: 0.08, height: h, depth: wz }, scene);
      leaf.setPivotPoint(V3(0, 0, s * wz / 2));    // Drehpunkt an der Außenkante → Skalieren = Einfahren
      leaf.position.set(d.x, h / 2, -s * wz / 2);
      leaf.material = M.doorLeaf; parts.push(leaf);
      return { leaf, s };
    });
    for (const p of parts) {
      for (const ri of [d.a, d.b]) roomMeshes[ri].push(p);
      p.receiveShadows = true; interiorMeshes.push(p);
    }
    pickables.push(...parts.filter(p => !p.name.includes("glow")));
    return { d, leaves, open: 0 };
  });

  /* ===== Fenster: Glas mit Rissen, Notschott, Rahmen ===== */
  const windows = WINDOWS.map((w, i) => {
    const A = AXES[w.axis];
    const uw = w.u[1] - w.u[0], vh = w.v[1] - w.v[0];
    const crackTex = new B.DynamicTexture(`crack${i}`, { width: 512, height: Math.round(512 * vh / uw) }, scene, true);
    const cctx = crackTex.getContext();
    const clearGlass = () => {
      const { width, height } = crackTex.getSize();
      cctx.clearRect(0, 0, width, height);
      cctx.fillStyle = "rgba(180,200,220,0.05)"; cctx.fillRect(0, 0, width, height);
      crackTex.update();
    };
    crackTex.hasAlpha = true; clearGlass();
    const gm = new B.PBRMaterial(`glass${i}`, scene);
    gm.albedoTexture = crackTex; gm.useAlphaFromAlbedoTexture = true;
    gm.albedoColor = B.Color3.White();
    gm.metallic = 0; gm.roughness = 0.04;
    gm.alpha = 1; gm.transparencyMode = B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
    gm.backFaceCulling = false;
    gm.environmentIntensity = 1.2;
    gm.maxSimultaneousLights = 8;
    const glass = B.MeshBuilder.CreatePlane(`glass${i}`, { width: uw, height: vh }, scene);
    const inset = 0.04;
    const pos = [...w.center]; pos[A.n] -= w.side * inset;
    glass.position.set(...pos);
    if (w.axis === "x") glass.rotation.y = Math.PI / 2;
    glass.material = gm;
    glass.metadata = { window: i };
    glass.isPickable = true;
    roomMeshes[w.roomIdx].push(glass);
    pickables.push(glass);

    // Fensterlaibung (Tunnel von Innenwand bis Außenhülle)
    const p0 = w.plane, p1 = w.plane + w.side * 0.25;
    const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
    const frameParts = [];
    const thick = 0.08, d = hi - lo;
    const mk = (name, size, center) => {
      const b = B.MeshBuilder.CreateBox(name, size, scene);
      b.position.set(...center); b.material = M.frame; frameParts.push(b); return b;
    };
    const mid = (lo + hi) / 2;
    const C = (u, v) => { const p = [0, 0, 0]; p[A.n] = mid; p[A.u] = u; p[A.v] = v; return p; };
    const size = (su, sv) => { const s = [0, 0, 0]; s[A.n] = d + 0.06; s[A.u] = su; s[A.v] = sv; return { width: s[0], height: s[1], depth: s[2] }; };
    mk(`win${i}-b`, size(uw + thick * 2, thick), C((w.u[0] + w.u[1]) / 2, w.v[0] - thick / 2));
    mk(`win${i}-t`, size(uw + thick * 2, thick), C((w.u[0] + w.u[1]) / 2, w.v[1] + thick / 2));
    mk(`win${i}-l`, size(thick, vh), C(w.u[0] - thick / 2, (w.v[0] + w.v[1]) / 2));
    mk(`win${i}-r`, size(thick, vh), C(w.u[1] + thick / 2, (w.v[0] + w.v[1]) / 2));
    for (const f of frameParts) { roomMeshes[w.roomIdx].push(f); shadowCasters.push(f); f.receiveShadows = true; }

    // Notschott: wartet über dem Fenster zwischen Innenwand und Hülle
    const sh = B.MeshBuilder.CreateBox(`shutter${i}`, size(uw + 0.1, vh + 0.1), scene);
    const sp = [...w.center]; sp[A.n] = w.plane + w.side * 0.13;
    sh.position.set(...sp);
    sh.scaling[["x", "y", "z"][A.n]] = 0.4;
    sh.material = M.doorLeaf;
    sh.metadata = { closedY: sp[1], openY: sp[1] + vh + 0.2 };
    sh.position.y = sh.metadata.openY;
    roomMeshes[w.roomIdx].push(sh); shadowCasters.push(sh);

    return {
      w, glass, crackTex, shutter: sh, shutterT: 0, state: "intact", clearGlass,
      addCrack(pt) {
        // Trefferpunkt → Texturkoordinaten, dann Sprungrisse zeichnen
        const { width, height } = crackTex.getSize();
        const u = (w.axis === "x" ? pt[2] : pt[0]);
        let tu = (u - w.u[0]) / uw;
        if ((w.axis === "z" && w.side > 0) || (w.axis === "x" && w.side < 0)) tu = 1 - tu;
        const tv = 1 - (pt[1] - w.v[0]) / vh;
        const cx = tu * width, cy = tv * height;
        cctx.strokeStyle = "rgba(235,245,255,0.85)"; cctx.lineWidth = 1.4;
        for (let k = 0; k < 9; k++) {
          let x = cx, y = cy, a = Math.random() * Math.PI * 2;
          cctx.beginPath(); cctx.moveTo(x, y);
          const len = 6 + Math.random() * 10;
          for (let s = 0; s < len; s++) { a += (Math.random() - 0.5) * 0.7; x += Math.cos(a) * 7; y += Math.sin(a) * 7; cctx.lineTo(x, y); }
          cctx.stroke();
        }
        cctx.fillStyle = "rgba(255,255,255,0.7)";
        cctx.beginPath(); cctx.arc(cx, cy, 5, 0, Math.PI * 2); cctx.fill();
        crackTex.update();
      },
    };
  });

  /* ===== Einbauten (Kisten, Spinde, Konsolen, Terminal, Versorgungskern) ===== */
  const screens = [];
  SOLIDS.forEach((s, i) => {
    const w = s.max[0] - s.min[0], h = s.max[1] - s.min[1], d = s.max[2] - s.min[2];
    const c = V3((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    const box = B.MeshBuilder.CreateBox(`solid${i}`, { width: w, height: h, depth: d }, scene);
    box.position.copyFrom(c);
    const ri = roomAt([c.x, c.y, c.z]);
    if (s.kind === "crate" || s.kind === "debris") box.material = M.crate[i % 3];
    else if (s.kind === "locker") box.material = M.crate[1];
    else if (s.kind === "core") box.material = M.wallHub;
    else box.material = M.console;
    box.receiveShadows = true;
    roomMeshes[ri]?.push(box); shadowCasters.push(box); pickables.push(box); interiorMeshes.push(box);
    if (s.kind === "debris") box.rotation.set(0.3, 0.5, 0.15);
    if (s.kind === "console" || s.kind === "terminal") {
      const sw = Math.max(w, d) * 0.9, shh = s.kind === "terminal" ? 0.9 : 0.5;
      const tex = screenTexture(scene, `scr${i}`, 512, Math.round(512 * shh / sw), (ctx, W, H) => drawConsole(ctx, W, H, s.kind, ROOMS[ri]?.atmo));
      const scr = B.MeshBuilder.CreatePlane(`screen${i}`, { width: sw, height: shh }, scene);
      const mat = emissiveMat(scene, `scrm${i}`, [1, 1, 1], s.kind === "terminal" ? 1.6 : 1.2);
      mat.emissiveTexture = tex;
      scr.material = mat;
      if (d > w) {   // Bildschirm zeigt in x-Richtung (Terminal: zur Raummitte)
        scr.position.set(s.min[0] - 0.02, s.max[1] + shh / 2 - 0.05, c.z);
        scr.rotation.y = Math.PI / 2;
        scr.rotation.z = 0;
      } else {
        const toward = c.z > 0 ? -1 : 1;
        scr.position.set(c.x, s.max[1] + shh / 2 - 0.05, toward > 0 ? s.max[2] + 0.02 : s.min[2] - 0.02);
        scr.rotation.y = toward > 0 ? Math.PI : 0;
      }
      if (s.kind === "terminal") { scr.position.y = s.max[1] + 0.55; scr.rotation.y = -Math.PI / 2; scr.position.x = s.min[0] + 0.25; }
      roomMeshes[ri]?.push(scr);
      screens.push({ tex, kind: s.kind, mesh: scr, room: ri });
    }
    if (s.kind === "core") {
      for (let k = 0; k < 4; k++) {
        const ring = B.MeshBuilder.CreateBox(`coreRing${k}`, { width: w + 0.04, height: 0.06, depth: d + 0.04 }, scene);
        ring.position.set(c.x, s.min[1] + 0.8 + k * 1.2, c.z);
        ring.material = emissiveMat(scene, "coreGlow" + k, [0.3, 0.8, 1], 4);
      }
    }
  });

  /* ===== Rohre, Kabeltrassen, Handläufe ===== */
  const pipeMeshes = [];
  const addPipe = (a, b, r, mat, ri) => {
    const p = B.MeshBuilder.CreateTube("pipe", { path: [V3(...a), V3(...b)], radius: r, tessellation: 12, cap: B.Mesh.CAP_ALL }, scene);
    p.material = mat; p.receiveShadows = true;
    roomMeshes[ri].push(p); pipeMeshes.push(p);
    return p;
  };
  ROOMS.forEach((r, ri) => {
    if (r.theme === "hub") return;
    const y = r.max[1] - 0.18, x0 = r.min[0] + 0.05, x1 = r.max[0] - 0.05;
    for (const [dz, rad, mat] of [[0.18, 0.06, M.pipe], [0.36, 0.04, M.pipeWhite], [0.5, 0.03, M.rail]]) {
      addPipe([x0, y, r.min[2] + dz], [x1, y, r.min[2] + dz], rad, mat, ri);
      if (r.max[2] - r.min[2] > 4) addPipe([x0, y, r.max[2] - dz], [x1, y, r.max[2] - dz], rad, mat, ri);
    }
    // Handlauf in Hüfthöhe
    if (r.max[2] - r.min[2] <= 3.2) for (const s of [-1, 1]) {
      const z = s < 0 ? r.min[2] + 0.07 : r.max[2] - 0.07;
      addPipe([x0 + 0.3, 1.05, z], [x1 - 0.3, 1.05, z], 0.022, M.steel, ri);
    }
  });
  // Haltestangen im Schwerelos-Knoten (Kreuz aus Griffen)
  for (const [a, b] of [[[33, -3.6, -6.6], [33, 7.6, -6.6]], [[45, -3.6, 6.6], [45, 7.6, 6.6]], [[33, 6, -6.6], [45, 6, -6.6]], [[33, -2, 6.6], [45, -2, 6.6]]])
    addPipe(a, b, 0.03, M.rail, ROOMS.findIndex(r => r.id === "hub"));

  /* ===== Schwebende Trümmer im Knoten (nur Optik) ===== */
  const floaters = [];
  const hubIdx = ROOMS.findIndex(r => r.id === "hub");
  for (let i = 0; i < 14; i++) {
    const kind = i % 3;
    const m = kind === 0 ? B.MeshBuilder.CreateBox("float" + i, { width: 0.3 + Math.random() * 0.3, height: 0.2 + Math.random() * 0.2, depth: 0.25 + Math.random() * 0.3 }, scene)
      : kind === 1 ? B.MeshBuilder.CreateCylinder("float" + i, { diameter: 0.12, height: 0.4 + Math.random() * 0.4, tessellation: 10 }, scene)
      : B.MeshBuilder.CreateBox("float" + i, { width: 0.6, height: 0.02, depth: 0.4 }, scene);
    m.material = kind === 0 ? M.crate[i % 3] : kind === 1 ? M.pipe : M.console;
    m.position.set(33.5 + Math.random() * 11, -3 + Math.random() * 10, -6 + Math.random() * 12);
    if (m.position.x > 37.4 && m.position.x < 40.6 && Math.abs(m.position.z) < 2) m.position.z += 3;
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.metadata = { spin: V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(0.4), vel: V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(0.08) };
    roomMeshes[hubIdx].push(m); shadowCasters.push(m);
    floaters.push(m);
  }

  /* ===== Beschilderung ===== */
  const sign = (text, sub, pos, rotY, ri, color = "#5fd1ff") => {
    const tex = screenTexture(scene, "sign", 512, 128, (ctx, W, H) => {
      ctx.fillStyle = "#0b1118"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = color; ctx.fillRect(0, 0, 10, H);
      ctx.fillStyle = "#e8f2ff"; ctx.font = "bold 52px Arial"; ctx.fillText(text, 30, 62);
      ctx.fillStyle = "#7f9bb3"; ctx.font = "28px Arial"; ctx.fillText(sub, 32, 104);
    });
    const p = B.MeshBuilder.CreatePlane("sign", { width: 1.6, height: 0.4 }, scene);
    p.position.set(...pos); p.rotation.y = rotY;
    p.material = emissiveMat(scene, "signm", [1, 1, 1], 0.7); p.material.emissiveTexture = tex;
    roomMeshes[ri].push(p);
  };
  sign("MODUL 1", "ANDOCKSCHLEUSE · DRUCK OK", [-0.02, 2.65, 1.7], -Math.PI / 2, 0);
  sign("BEOBACHTUNG", "MODUL 3 →", [13.98, 2.65, 1.1], -Math.PI / 2, 1);
  sign("ZENTRALKNOTEN", "SCHWERELOS · FESTHALTEN", [31.98, 2.65, 1.1], -Math.PI / 2, 3, "#ffb03b");
  sign("KOMMANDO", "⚠ KEIN DRUCK · O₂ ANLEGEN", [45.98 + 0.04, 2.65, 1.1], -Math.PI / 2, 4, "#ff4b4b");
  sign("⚠ VAKUUM", "DRUCKVERLUST · SEKTION C", [53.98, 2.6, 1.1], -Math.PI / 2, 5, "#ff4b4b");

  /* ===== Außenhülle ===== */
  ROOMS.forEach((r, ri) => {
    const hull = new QuadBatch();
    const doorAt = (a, side) => a === "x" && DOORS.some(d => (d.a === ri || d.b === ri) && Math.abs(d.x - (side < 0 ? r.min[0] : r.max[0])) < 0.01);
    const off = 0.25;
    const mn = [...r.min], mx = [...r.max];
    for (let a = 0; a < 3; a++) {
      const an = ["x", "y", "z"][a];
      if (!doorAt(an, -1)) mn[a] -= off;
      if (!doorAt(an, 1)) mx[a] += off;
    }
    for (const axis of ["x", "y", "z"]) for (const side of [-1, 1]) {
      if (doorAt(axis, side)) continue;
      const A = AXES[axis];
      const plane = side < 0 ? mn[A.n] : mx[A.n];
      let rects = [{ u0: mn[A.u], u1: mx[A.u], v0: mn[A.v], v1: mx[A.v] }];
      for (const w of WINDOWS) if (w.roomIdx === ri && w.axis === axis && w.side === side)
        rects = subtract(rects, { u0: w.u[0], u1: w.u[1], v0: w.v[0], v1: w.v[1] });
      for (const rc of rects) hull.add(axis, plane, side, rc, 3);
    }
    const m = hull.build(`${r.id}-hull`, scene, M.hull);
    if (m) { exteriorMeshes.push(m); shadowCasters.push(m); m.receiveShadows = true; }
  });

  /* Gitterträger + Solarflügel über der Station (sichtbar durch die Fenster) */
  const truss = B.MeshBuilder.CreateBox("truss", { width: 74, height: 0.9, depth: 0.9 }, scene);
  truss.position.set(30, 7, 0); truss.material = M.frame;
  const trussLegs = [];
  for (let x = -4; x <= 64; x += 12) {
    const leg = B.MeshBuilder.CreateBox("leg", { width: 0.4, height: 3.8, depth: 0.4 }, scene);
    leg.position.set(x, 5, 0); leg.material = M.steel; trussLegs.push(leg);
  }
  exteriorMeshes.push(truss, ...trussLegs);
  for (const x of [6, 56]) for (const s of [-1, 1]) {
    const mast = B.MeshBuilder.CreateCylinder("mast", { diameter: 0.25, height: 32, tessellation: 8 }, scene);
    mast.rotation.x = Math.PI / 2; mast.position.set(x, 7, s * 17); mast.material = M.steel;
    exteriorMeshes.push(mast);
    for (const dx of [-3.4, 3.4]) {
      const wing = B.MeshBuilder.CreateBox("wing", { width: 6, height: 0.04, depth: 28 }, scene);
      wing.position.set(x + dx, 7, s * 18); wing.rotation.x = s * 0.18;
      wing.material = M.solar;
      // Kacheln der Solarzellen
      const uv = wing.getVerticesData(B.VertexBuffer.UVKind);
      for (let k = 0; k < uv.length; k += 2) { uv[k] *= 2; uv[k + 1] *= 9; }
      wing.setVerticesData(B.VertexBuffer.UVKind, uv);
      exteriorMeshes.push(wing);
    }
  }
  // Radiator-Paneele (weiß, nach unten)
  for (const x of [22, 40]) {
    const rad = B.MeshBuilder.CreateBox("radiator", { width: 8, height: 0.05, depth: 3 }, scene);
    rad.position.set(x, -3.5, 0); rad.rotation.z = 0.2; rad.material = M.hull;
    exteriorMeshes.push(rad);
  }

  /* ===== Weltall: Erde, Wolken, Atmosphäre, Sterne, Sonne ===== */
  const far = new B.TransformNode("far", scene);    // folgt der Kamera → unendlich weit entfernt
  const earthPivot = new B.TransformNode("earthPivot", scene);
  earthPivot.parent = far;
  earthPivot.position.set(0, -108, -45);
  earthPivot.rotation.set(0.35, 0, 0.2);
  const earth = B.MeshBuilder.CreateSphere("earth", { diameter: 200, segments: 96 }, scene);
  earth.parent = earthPivot;
  const em = new B.PBRMaterial("earthMat", scene);
  em.albedoTexture = earthTex.albedo; em.metallicTexture = earthTex.orm; em.bumpTexture = earthTex.normal;
  em.bumpTexture.level = 0.8;
  em.useRoughnessFromMetallicTextureGreen = true; em.useMetallnessFromMetallicTextureBlue = true;
  em.metallic = 1; em.roughness = 1;
  em.environmentIntensity = 0.0;
  em.maxSimultaneousLights = 2;
  earth.material = em;
  const clouds = B.MeshBuilder.CreateSphere("clouds", { diameter: 200.8, segments: 96 }, scene);
  clouds.parent = earthPivot;
  const cm = new B.PBRMaterial("cloudMat", scene);
  cm.albedoTexture = earthTex.clouds; cm.useAlphaFromAlbedoTexture = true;
  cm.metallic = 0; cm.roughness = 1; cm.environmentIntensity = 0;
  cm.transparencyMode = B.PBRMaterial.PBRMATERIAL_ALPHABLEND;
  clouds.material = cm;
  const atmo = B.MeshBuilder.CreateSphere("atmo", { diameter: 205.5, segments: 96 }, scene);
  atmo.parent = earthPivot;
  const am = new B.StandardMaterial("atmoMat", scene);
  am.diffuseColor = new B.Color3(0.25, 0.5, 1); am.specularColor = B.Color3.Black();
  am.emissiveColor = new B.Color3(0.18, 0.42, 1);
  am.alphaMode = B.Constants.ALPHA_ADD;
  am.opacityFresnelParameters = new B.FresnelParameters();
  am.opacityFresnelParameters.leftColor = B.Color3.White();
  am.opacityFresnelParameters.rightColor = new B.Color3(0.02, 0.02, 0.02);
  am.opacityFresnelParameters.power = 3.2; am.opacityFresnelParameters.bias = 0.02;
  am.emissiveFresnelParameters = new B.FresnelParameters();
  am.emissiveFresnelParameters.leftColor = new B.Color3(0.55, 0.8, 1);
  am.emissiveFresnelParameters.rightColor = new B.Color3(0.05, 0.12, 0.35);
  am.emissiveFresnelParameters.power = 2.4;
  am.maxSimultaneousLights = 1;
  atmo.material = am;
  for (const m of [earth, clouds, atmo]) { m.isPickable = false; m.infiniteDistance = false; }

  const earthSun = new B.DirectionalLight("earthSun", SUN_DIR.scale(-1), scene);
  earthSun.intensity = 4.2;
  earthSun.diffuse = new B.Color3(1, 0.97, 0.92);
  earthSun.includedOnlyMeshes = [earth, clouds, atmo];

  // Sterne
  const stars = new B.PointsCloudSystem("stars", 2, scene);
  stars.addPoints(Q >= 2 ? 9000 : 4000, p => {
    let v; do v = V3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); while (v.lengthSquared() > 1 || v.lengthSquared() < 0.01);
    p.position = v.normalize().scale(480);
    const b = Math.pow(Math.random(), 6) * 0.9 + 0.12;
    const t = Math.random();
    p.color = new B.Color4(b * (t < 0.2 ? 1 : 0.85), b * 0.92, b * (t > 0.7 ? 1.15 : 0.9), 1);
  });
  const starMesh = await stars.buildMeshAsync();
  starMesh.parent = far; starMesh.isPickable = false;
  starMesh.material.disableLighting = true;
  starMesh.material.emissiveColor = B.Color3.White();
  starMesh.material.pointSize = Q >= 2 ? 2 : 1.5;

  // Sonne + Glanz
  const sunTex = glowTexture(scene, "sunTex", [[0, "rgba(255,255,255,1)"], [0.06, "rgba(255,252,240,1)"], [0.12, "rgba(255,240,210,0.6)"], [0.35, "rgba(255,220,170,0.12)"], [1, "rgba(255,200,150,0)"]]);
  const sun = B.MeshBuilder.CreatePlane("sun", { size: 90 }, scene);
  sun.parent = far; sun.position = SUN_DIR.scale(420);
  sun.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
  const sm = new B.StandardMaterial("sunMat", scene);
  sm.emissiveTexture = sunTex; sm.opacityTexture = sunTex; sm.disableLighting = true;
  sm.emissiveColor = new B.Color3(6, 5.6, 5); sm.alphaMode = B.Constants.ALPHA_ADD;
  sun.material = sm; sun.isPickable = false;

  /* ===== Sonnenlicht im Innern (fällt nur durch die Fenster dank Schattenwurf der Hülle) ===== */
  let sunInterior = null, shadowGen = null;
  if (Q >= 2) {
    sunInterior = new B.DirectionalLight("sunInterior", SUN_DIR.scale(-1), scene);
    sunInterior.position = V3(30, 0, 0).add(SUN_DIR.scale(80));
    sunInterior.intensity = 7;
    sunInterior.diffuse = new B.Color3(1, 0.96, 0.9);
    sunInterior.includedOnlyMeshes = [];
    sunInterior.shadowMinZ = 1; sunInterior.shadowMaxZ = 200;
    shadowGen = new B.ShadowGenerator(Q >= 3 ? 4096 : 2048, sunInterior);
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = Q >= 3 ? B.ShadowGenerator.QUALITY_HIGH : B.ShadowGenerator.QUALITY_MEDIUM;
    shadowGen.bias = 0.0008; shadowGen.normalBias = 0.02;
    for (const c of shadowCasters) shadowGen.addShadowCaster(c, false);
    for (const ri of new Set(WINDOWS.map(w => w.roomIdx))) roomLights[ri].push(sunInterior);
  }
  const exteriorSun = new B.DirectionalLight("exteriorSun", SUN_DIR.scale(-1), scene);
  exteriorSun.intensity = 5;
  exteriorSun.includedOnlyMeshes = [...exteriorMeshes];

  /* ===== Licht-Zuordnung je Raum ===== */
  const addTo = (L, m) => { if (!L.includedOnlyMeshes.includes(m)) L.includedOnlyMeshes.push(m); };
  ROOMS.forEach((_, ri) => {
    for (const m of roomMeshes[ri]) for (const L of roomLights[ri]) addTo(L, m);
  });
  // Rohre etc. auch an den Schattenwurf (dezent)
  if (shadowGen) for (const p of pipeMeshes) shadowGen.addShadowCaster(p, false);

  /** Dynamische Meshes (Spieler, Drohnen, Waffe) beim Raumwechsel umhängen */
  function placeDynamic(meshes, ri) {
    for (const m of meshes) {
      if (m.metadata?.lightRoom === ri) continue;
      const old = m.metadata?.lightRoom;
      if (old !== undefined && old >= 0) for (const L of roomLights[old]) {
        if (ri >= 0 && roomLights[ri].includes(L)) continue;
        const k = L.includedOnlyMeshes.indexOf(m);
        if (k >= 0) L.includedOnlyMeshes.splice(k, 1);
      }
      if (ri >= 0) for (const L of roomLights[ri]) addTo(L, m);
      m.metadata = { ...(m.metadata || {}), lightRoom: ri };
    }
  }
  function castShadows(meshes) { if (shadowGen) for (const m of meshes) shadowGen.addShadowCaster(m, false); }

  /* ===== Umgebungsreflexionen: einmal gerenderte Reflexionssonde ===== */
  const probe = new B.ReflectionProbe("envProbe", Q >= 2 ? 256 : 128, scene, true, true);
  probe.position = V3(19, 2, 0);
  for (const m of scene.meshes) if (m !== sun && !m.name.startsWith("glass")) probe.renderList.push(m);
  probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 0.55;

  progress(0.98, "DRUCKAUSGLEICH");

  /* ===== Laufende Animationen ===== */
  let time = 0;
  function update(dt, cameraPos, entities, alarmRooms) {
    time += dt;
    far.position.copyFrom(cameraPos);
    earthPivot.rotation.x += dt * 0.0045;
    clouds.rotation.y += dt * 0.0012;
    for (const f of floaters) {
      f.rotation.addInPlace(f.metadata.spin.scale(dt));
      f.position.addInPlace(f.metadata.vel.scale(dt));
      const p = f.position, r = ROOMS[hubIdx];
      for (const a of ["x", "y", "z"]) {
        const i = { x: 0, y: 1, z: 2 }[a];
        if (p[a] < r.min[i] + 0.4 || p[a] > r.max[i] - 0.4) f.metadata.vel[a] *= -1;
      }
    }
    // Flackernde Lampen in beschädigten Bereichen
    for (const L of flicker) {
      const on = Math.sin(time * 13 + L.position.x) + Math.sin(time * 31 + L.position.z * 3) > -0.6 || Math.random() < 0.1;
      const k = on ? 1 : 0.15;
      L.intensity = L.metadata.base * k;
      L.metadata.panel.material.emissiveIntensity = (L.metadata.room >= 5 ? 3 : 6) * k;
    }
    // Alarm in Räumen mit Leck: rot pulsierend
    ROOMS.forEach((r, ri) => {
      const alarm = alarmRooms.has(ri);
      for (const L of roomLights[ri]) {
        if (!L.metadata || L === sunInterior) continue;
        if (alarm) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 9);
          L.diffuse.set(1, 0.08 + 0.1 * pulse, 0.04);
          L.intensity = L.metadata.base * (0.5 + pulse);
        } else if (!flicker.includes(L)) {
          L.diffuse.copyFrom(L.metadata.baseColor);
          L.intensity = L.metadata.base;
        }
      }
    });
    // Schiebetüren öffnen, wenn jemand in der Nähe ist
    for (const dr of doors) {
      const near = entities.some(p => Math.abs(p[0] - dr.d.x) < 2.6 && Math.abs(p[2]) < 2.5 && p[1] > -1 && p[1] < 3.5);
      dr.open += ((near ? 1 : 0) - dr.open) * Math.min(1, dt * 7);
      for (const { leaf } of dr.leaves) leaf.scaling.z = Math.max(0.02, 1 - dr.open);
    }
    // Notschotts
    for (const w of windows) {
      const target = w.state === "sealed" ? w.shutter.metadata.closedY : w.shutter.metadata.openY;
      w.shutter.position.y += (target - w.shutter.position.y) * Math.min(1, dt * (w.state === "sealed" ? 5 : 1.5));
    }
  }

  return {
    M, windows, doors, screens, pickables, roomMeshes, roomLights, placeDynamic, castShadows, update,
    sun, far, shadowGen, sunInterior, interiorMeshes, exteriorMeshes, earth, clouds, atmo,
  };
}

function drawConsole(ctx, W, H, kind, atmo) {
  ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
  const c = atmo === false ? "#ff5a3c" : "#4fc3f7";
  ctx.strokeStyle = c; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.font = "bold 22px monospace";
  if (kind === "terminal") {
    ctx.fillText("KOMMANDO-TERMINAL", 18, 36);
    ctx.font = "16px monospace";
    ctx.fillText("LOGBUCH: VERSCHLÜSSELT", 18, 70);
    ctx.fillText("ENERGIE: NOTSTROM 12%", 18, 94);
    ctx.fillText("[E] DOWNLOAD STARTEN", 18, 140);
  } else {
    ctx.fillText(atmo === false ? "⚠ DRUCKVERLUST" : "LEBENSERHALTUNG", 14, 30);
    ctx.beginPath(); ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 6) ctx.lineTo(x, H * 0.62 + Math.sin(x * 0.05) * 18 + Math.random() * 8);
    ctx.stroke();
  }
}

/** Terminal-Bildschirm mit Downloadfortschritt neu zeichnen */
export function drawTerminal(tex, phase, progress) {
  const ctx = tex.getContext();
  const { width: W, height: H } = tex.getSize();
  ctx.fillStyle = "#03080d"; ctx.fillRect(0, 0, W, H);
  const c = phase === "explore" ? "#ffb03b" : "#6dff9c";
  ctx.fillStyle = c; ctx.font = "bold 24px monospace";
  ctx.fillText("KOMMANDO-TERMINAL", 18, 38);
  ctx.font = "17px monospace";
  if (phase === "explore") {
    ctx.fillText("LOGBUCH GESPERRT", 18, 80);
    ctx.fillText("[E] DOWNLOAD STARTEN", 18, 120);
  } else {
    ctx.fillText(progress >= 1 ? "DOWNLOAD ABGESCHLOSSEN" : "DOWNLOAD LÄUFT …", 18, 80);
    ctx.strokeStyle = c; ctx.strokeRect(18, 110, W - 36, 34);
    ctx.fillRect(22, 114, (W - 44) * progress, 26);
    ctx.fillText(`${Math.round(progress * 100)} %`, 18, 180);
  }
  tex.update();
}

const tick = () => new Promise(r => setTimeout(r, 0));
export { roomAt, TERMINAL };
