/* ============================================================
 * Orbital Breach — Client
 * ============================================================ */
import {
  ROOMS, WINDOWS, TERMINAL, PLAYER_HALF, EYE_OFFSET, RULES,
  roomAt, resolveBox, windowProximity,
} from "/shared/level.js";
import { buildWorld, drawTerminal } from "./world.js";
import { glowTexture } from "./textures.js";
import { Sfx } from "./audio.js";

const B = window.BABYLON;
const V3 = (x, y, z) => new B.Vector3(x, y, z);
const $ = id => document.getElementById(id);
const sfx = new Sfx();
const params = new URLSearchParams(location.search);

/* ---------- Lobby ---------- */
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } },
};
$("name").value = params.get("name") || store.get("ob-name") || "";
$("code").value = params.get("code") || "";
$("quality").value = params.get("q") || store.get("ob-quality") || "high";
$("start").onclick = () => start().catch(err => {
  console.error(err);
  $("err").textContent = "Start fehlgeschlagen: " + err.message;
  $("start").disabled = false;
  $("lobby").style.display = "grid"; $("loading").style.display = "none";
});
for (const id of ["name", "code"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") $("start").click(); });
if (params.get("auto")) setTimeout(() => $("start").click(), 50);

/* ---------- Spielzustand ---------- */
const me = {
  id: null, pos: [-3, 0.88, 0], vel: [0, 0, 0], yaw: Math.PI / 2, pitch: 0, grounded: false,
  hp: 100, o2: 100, alive: true, ammo: 30, reloadT: 0, fireCD: 0, ads: 0, room: 0,
  dying: null, stepT: 0, o2DmgAcc: 0, breathT: 0, lastHurt: 0, shake: 0, kick: 0,
};
const remote = new Map();     // id → { mesh, p, target, yaw, ... }
const drones = new Map();     // id → { root, parts, p, target, yaw }
let snap = null;
let world, scene, camera, engine, socket, gun;
const keys = new Set();
let mouseDown = false, rightDown = false;

async function createEngine(canvas, quality) {
  if (quality === "ultra" && navigator.gpu) {
    try {
      if (await B.WebGPUEngine.IsSupportedAsync) {
        const e = new B.WebGPUEngine(canvas, { antialias: true, stencil: true, adaptToDeviceRatio: false });
        await e.initAsync();
        return e;
      }
    } catch (err) { console.warn("WebGPU nicht verfügbar, nutze WebGL2", err); }
  }
  return new B.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }, false);
}

function progress(p, text) {
  $("loadBar").style.width = Math.round(p * 100) + "%";
  if (text) $("loadTxt").textContent = text;
}

async function start() {
  $("start").disabled = true; $("err").textContent = "";
  const name = $("name").value.trim() || "Astronaut";
  const quality = $("quality").value;
  store.set("ob-name", name); store.set("ob-quality", quality);
  sfx.init();

  // Verbinden
  socket = window.io();
  const res = await new Promise(r => socket.emit("join", { name, code: $("code").value }, r));
  if (res.error) { socket.disconnect(); throw new Error(res.error); }
  me.id = res.id; me.pos = [...res.spawn];
  history.replaceState(null, "", `?code=${res.code}`);

  $("lobby").style.display = "none"; $("loading").style.display = "grid";
  const canvas = $("view");
  engine = await createEngine(canvas, quality);
  const Q = { low: 0, medium: 1, high: 2, ultra: 3 }[quality];
  const dpr = window.devicePixelRatio || 1;
  engine.setHardwareScalingLevel(Q === 0 ? 1.4 : 1 / Math.min(dpr, Q >= 3 ? 2 : Q >= 2 ? 1.5 : 1));
  if (engine.useReverseDepthBuffer !== undefined) engine.useReverseDepthBuffer = true;

  scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0, 0, 0, 1);
  scene.skipPointerMovePicking = true;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;

  camera = new B.FreeCamera("cam", V3(...me.pos), scene);
  camera.minZ = 0.03; camera.maxZ = 1200; camera.fov = 1.2;
  camera.inputs.clear();

  world = await buildWorld(scene, quality, progress);
  setupPostFX(Q);
  gun = buildGun();
  setupFX();
  bindInput(canvas);
  bindNet(code => res.code === code);
  $("team").dataset.code = res.code;

  let last = performance.now(), netT = 0, hudT = 0;
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    netT += dt; hudT += dt;
    if (netT > 0.05 && me.alive && !me.dying) {
      netT = 0;
      socket.volatile.emit("state", { p: me.pos.map(v => +v.toFixed(3)), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), v: me.vel.map(v => +v.toFixed(2)) });
    }
    if (hudT > 0.1) { hudT = 0; updateHud(); }
    scene.render();
  });
  window.addEventListener("resize", () => engine.resize());
  window.__ob = { scene, camera, me, world, engine, setView, snapshot: () => snap };

  // Shader werden im Hintergrund kompiliert; Ladebildschirm erst danach ausblenden
  progress(1, "SHADER WERDEN KOMPILIERT");
  await Promise.race([scene.whenReadyAsync(), new Promise(r => setTimeout(r, 25000))]);
  window.__ob.ready = true;
  $("loading").style.display = "none";
  $("hud").style.display = "block";
  showBanner("ANDOCKEN ABGESCHLOSSEN", 2500);
  if (!params.get("auto")) $("click").style.display = "grid";
}

/* ---------- Postprocessing ---------- */
let pipeline;
function setupPostFX(Q) {
  pipeline = new B.DefaultRenderingPipeline("pp", true, scene, [camera]);
  pipeline.samples = Q >= 2 ? 4 : 1;
  pipeline.fxaaEnabled = Q < 2;
  pipeline.bloomEnabled = Q >= 1;
  pipeline.bloomThreshold = 0.85; pipeline.bloomWeight = 0.45; pipeline.bloomKernel = 72; pipeline.bloomScale = 0.5;
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.05; ip.contrast = 1.18;
  ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteStretch = 0.3; ip.vignetteColor = new B.Color4(0, 0, 0, 0);
  pipeline.chromaticAberrationEnabled = Q >= 2;
  pipeline.chromaticAberration.aberrationAmount = 14; pipeline.chromaticAberration.radialIntensity = 1.4;
  pipeline.grainEnabled = Q >= 1; pipeline.grain.intensity = 7; pipeline.grain.animated = true;
  pipeline.sharpenEnabled = Q >= 2; pipeline.sharpen.edgeAmount = 0.25;

  if (Q >= 2) {
    const ssao = new B.SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: Q >= 3 ? 0.75 : 0.5, blurRatio: 1 }, [camera], true);
    ssao.radius = 0.9; ssao.totalStrength = 1.15; ssao.samples = Q >= 3 ? 24 : 16; ssao.maxZ = 60;
    ssao.expensiveBlur = Q >= 3; ssao.minZAspect = 0.4; ssao.base = 0.08;
    const vls = new B.VolumetricLightScatteringPostProcess("vls", Q >= 3 ? 0.75 : 0.5, camera, world.sun, Q >= 3 ? 100 : 70, B.Texture.BILINEAR_SAMPLINGMODE, engine, false);
    vls.exposure = 0.22; vls.decay = 0.968; vls.weight = 0.55; vls.density = 0.92;
    vls.excludedMeshes = world.windows.map(w => w.glass);
    // Linsenreflexe der Sonne (verdeckt durch Wände/Hülle)
    const flares = new B.LensFlareSystem("flares", world.sun, scene);
    flares.meshesSelectionPredicate = m => m.isEnabled() && m.isVisible && !m.name.startsWith("glass") && m !== world.sun && m.name !== "atmo" && m.name !== "clouds" && !m.name.startsWith("stars");
    const img = (stops) => { const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d"); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); for (const [o, col] of stops) g.addColorStop(o, col); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return c.toDataURL(); };
    const soft = img([[0, "rgba(255,255,255,0.5)"], [1, "rgba(255,255,255,0)"]]);
    const ring = img([[0, "rgba(255,255,255,0)"], [0.8, "rgba(255,255,255,0)"], [0.9, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]]);
    new B.LensFlare(0.35, 0, new B.Color3(1, 0.9, 0.75), soft, flares);
    new B.LensFlare(0.08, 0.35, new B.Color3(0.4, 0.6, 1), soft, flares);
    new B.LensFlare(0.18, 0.6, new B.Color3(0.5, 1, 0.6), ring, flares);
    new B.LensFlare(0.05, 0.85, new B.Color3(1, 0.5, 0.3), soft, flares);
    new B.LensFlare(0.25, 1.2, new B.Color3(0.4, 0.5, 1), ring, flares);
  }
}

/* ---------- Waffe (Gaußkarabiner) ---------- */
function buildGun() {
  const root = new B.TransformNode("gunRoot", scene);
  root.parent = camera;
  const metal = new B.PBRMaterial("gunMetal", scene);
  metal.albedoColor = new B.Color3(0.08, 0.085, 0.09); metal.metallic = 0.9; metal.roughness = 0.32; metal.maxSimultaneousLights = 8;
  const poly = new B.PBRMaterial("gunPoly", scene);
  poly.albedoColor = new B.Color3(0.16, 0.17, 0.16); poly.metallic = 0; poly.roughness = 0.62; poly.maxSimultaneousLights = 8;
  const accent = new B.PBRMaterial("gunAccent", scene);
  accent.albedoColor = new B.Color3(0.75, 0.42, 0.05); accent.metallic = 0.3; accent.roughness = 0.4; accent.maxSimultaneousLights = 8;
  const glowM = new B.PBRMaterial("gunGlow", scene);
  glowM.albedoColor = B.Color3.Black(); glowM.emissiveColor = new B.Color3(0.3, 0.85, 1); glowM.emissiveIntensity = 3; glowM.disableLighting = true;
  const parts = [];
  const box = (n, w, h, d, x, y, z, mat, parent = root) => {
    const b = B.MeshBuilder.CreateBox(n, { width: w, height: h, depth: d }, scene);
    b.position.set(x, y, z); b.material = mat; b.parent = parent; parts.push(b); return b;
  };
  const cyl = (n, dia, len, x, y, z, mat, tess = 20) => {
    const c = B.MeshBuilder.CreateCylinder(n, { diameter: dia, height: len, tessellation: tess }, scene);
    c.rotation.x = Math.PI / 2; c.position.set(x, y, z); c.material = mat; c.parent = root; parts.push(c); return c;
  };
  box("receiver", 0.075, 0.09, 0.42, 0, 0, 0.05, metal);
  box("upper", 0.06, 0.03, 0.46, 0, 0.058, 0.06, poly);
  box("handguard", 0.07, 0.07, 0.3, 0, -0.005, 0.38, poly);
  for (let i = 0; i < 4; i++) box("vent" + i, 0.072, 0.012, 0.03, 0, 0.02, 0.28 + i * 0.06, metal);
  cyl("barrel", 0.028, 0.34, 0, 0.005, 0.62, metal);
  cyl("muzzle", 0.045, 0.07, 0, 0.005, 0.8, metal, 8);
  for (let i = 0; i < 3; i++) cyl("coil" + i, 0.05, 0.012, 0, 0.005, 0.5 + i * 0.06, glowM, 16);
  box("mag", 0.05, 0.16, 0.08, 0, -0.11, 0.06, poly).rotation.x = 0.18;
  box("grip", 0.045, 0.13, 0.06, 0, -0.1, -0.1, poly).rotation.x = -0.3;
  box("stock", 0.05, 0.08, 0.2, 0, -0.01, -0.25, poly);
  box("stockPad", 0.055, 0.1, 0.03, 0, -0.015, -0.36, accent);
  box("sightBase", 0.03, 0.02, 0.1, 0, 0.083, 0.02, metal);
  const sight = box("sight", 0.05, 0.045, 0.07, 0, 0.11, 0.02, metal);
  const lens = B.MeshBuilder.CreatePlane("lens", { size: 0.035 }, scene);
  lens.parent = sight; lens.position.z = -0.036; lens.rotation.y = Math.PI;
  const lm = new B.PBRMaterial("lens", scene); lm.albedoColor = new B.Color3(0.05, 0.1, 0.08); lm.metallic = 1; lm.roughness = 0.05;
  lm.emissiveColor = new B.Color3(1, 0.1, 0.05); lm.emissiveIntensity = 0;
  lens.material = lm; parts.push(lens);
  const dot = B.MeshBuilder.CreateDisc("reddot", { radius: 0.0025 }, scene);
  dot.parent = sight; dot.position.z = -0.037; dot.rotation.y = Math.PI;
  dot.material = glowM.clone("dotM"); dot.material.emissiveColor = new B.Color3(1, 0.1, 0.05); dot.material.emissiveIntensity = 5;
  parts.push(dot);
  // Munitionsanzeige
  const ammoTex = new B.DynamicTexture("ammoTex", { width: 128, height: 64 }, scene, true);
  const ammoScr = B.MeshBuilder.CreatePlane("ammoScr", { width: 0.05, height: 0.025 }, scene);
  ammoScr.parent = root; ammoScr.position.set(-0.039, 0.02, 0.05); ammoScr.rotation.y = -Math.PI / 2;
  const am = new B.PBRMaterial("ammoM", scene); am.albedoColor = B.Color3.Black(); am.emissiveTexture = ammoTex; am.emissiveColor = B.Color3.White(); am.emissiveIntensity = 1.5; am.disableLighting = true;
  ammoScr.material = am; parts.push(ammoScr);
  // Arme im Raumanzug-Handschuh
  const suit = new B.PBRMaterial("armSuit", scene);
  suit.albedoColor = new B.Color3(0.78, 0.78, 0.75); suit.metallic = 0; suit.roughness = 0.85; suit.maxSimultaneousLights = 8;
  const glove = new B.PBRMaterial("glove", scene);
  glove.albedoColor = new B.Color3(0.12, 0.12, 0.13); glove.metallic = 0; glove.roughness = 0.7; glove.maxSimultaneousLights = 8;
  const arm = (x, y, z, rx, ry) => {
    const a = B.MeshBuilder.CreateCapsule("arm", { radius: 0.05, height: 0.42 }, scene);
    a.parent = root; a.position.set(x, y, z); a.rotation.set(rx, ry, 0); a.material = suit; parts.push(a);
    return a;
  };
  arm(0.05, -0.16, -0.2, 1.2, -0.25);
  arm(-0.06, -0.1, 0.25, 1.35, 0.5);
  const g1 = B.MeshBuilder.CreateSphere("glove1", { diameter: 0.085, segments: 10 }, scene); g1.parent = root; g1.position.set(0, -0.09, -0.1); g1.scaling.set(0.9, 1.2, 1); g1.material = glove; parts.push(g1);
  const g2 = B.MeshBuilder.CreateSphere("glove2", { diameter: 0.085, segments: 10 }, scene); g2.parent = root; g2.position.set(-0.02, -0.04, 0.37); g2.scaling.set(1.1, 0.9, 1.2); g2.material = glove; parts.push(g2);

  // Mündungsfeuer
  const flashTex = glowTexture(scene, "flashTex", [[0, "rgba(255,255,255,1)"], [0.15, "rgba(190,240,255,0.9)"], [0.45, "rgba(80,170,255,0.35)"], [1, "rgba(40,120,255,0)"]]);
  const flash = B.MeshBuilder.CreatePlane("flash", { size: 0.32 }, scene);
  flash.parent = root; flash.position.set(0, 0.005, 0.86);
  const fm = new B.StandardMaterial("flashM", scene);
  fm.emissiveTexture = flashTex; fm.opacityTexture = flashTex; fm.disableLighting = true; fm.alphaMode = B.Constants.ALPHA_ADD;
  fm.emissiveColor = new B.Color3(3, 3, 3);
  flash.material = fm; flash.isVisible = false;
  const flashLight = new B.PointLight("muzzleLight", V3(0, 0, 1), scene);
  flashLight.diffuse = new B.Color3(0.55, 0.8, 1); flashLight.intensity = 0; flashLight.range = 9;

  for (const p of [...parts, flash]) { p.renderingGroupId = 1; p.isPickable = false; }
  scene.setRenderingAutoClearDepthStencil(1, true);
  root.position.set(0.2, -0.2, 0.42);
  return { root, parts, flash, flashLight, ammoTex, lens, drawAmmo: () => {
    const c = ammoTex.getContext(); c.fillStyle = "#020608"; c.fillRect(0, 0, 128, 64);
    c.fillStyle = me.ammo <= 8 ? "#ff5a3c" : "#5fd1ff"; c.font = "bold 44px monospace"; c.fillText(String(me.ammo).padStart(2, "0"), 30, 48);
    ammoTex.update();
  } };
}

/* ---------- Effekte: Funken, Einschusslöcher, Leuchtspuren, Explosionen ---------- */
let sparks, smoke, shards, decalPool = [], decalIdx = 0, tracers = [], spacedDrones = [], breachFog;
function setupFX() {
  const sparkTex = glowTexture(scene, "spark", [[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,200,120,0.8)"], [1, "rgba(255,120,40,0)"]], 64);
  sparks = new B.ParticleSystem("sparks", 600, scene);
  sparks.particleTexture = sparkTex;
  sparks.emitter = V3(0, 0, 0);
  sparks.minSize = 0.015; sparks.maxSize = 0.05; sparks.minLifeTime = 0.12; sparks.maxLifeTime = 0.45;
  sparks.minEmitPower = 2; sparks.maxEmitPower = 7; sparks.emitRate = 0; sparks.manualEmitCount = 0;
  sparks.color1 = new B.Color4(1, 0.85, 0.5, 1); sparks.color2 = new B.Color4(1, 0.5, 0.15, 1); sparks.colorDead = new B.Color4(0.6, 0.1, 0, 0);
  sparks.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  sparks.gravity = V3(0, -9.8, 0);
  sparks.createSphereEmitter(0.05);
  sparks.isLocal = false; sparks.renderingGroupId = 0;
  sparks.start();

  const smokeTex = glowTexture(scene, "smoke", [[0, "rgba(200,200,200,0.5)"], [1, "rgba(200,200,200,0)"]], 64);
  smoke = new B.ParticleSystem("smoke", 400, scene);
  smoke.particleTexture = smokeTex; smoke.emitter = V3(0, 0, 0);
  smoke.minSize = 0.2; smoke.maxSize = 0.8; smoke.minLifeTime = 0.6; smoke.maxLifeTime = 1.6;
  smoke.minEmitPower = 0.4; smoke.maxEmitPower = 2; smoke.emitRate = 0; smoke.manualEmitCount = 0;
  smoke.color1 = new B.Color4(0.35, 0.35, 0.36, 0.5); smoke.color2 = new B.Color4(0.2, 0.2, 0.22, 0.4); smoke.colorDead = new B.Color4(0, 0, 0, 0);
  smoke.createSphereEmitter(0.2);
  smoke.addSizeGradient(0, 0.3); smoke.addSizeGradient(1, 1.4);
  smoke.start();

  shards = new B.ParticleSystem("shards", 500, scene);
  shards.particleTexture = sparkTex; shards.emitter = V3(0, 0, 0);
  shards.minSize = 0.02; shards.maxSize = 0.07; shards.minLifeTime = 1; shards.maxLifeTime = 2.5;
  shards.minEmitPower = 8; shards.maxEmitPower = 20; shards.emitRate = 0; shards.manualEmitCount = 0;
  shards.color1 = new B.Color4(0.8, 0.9, 1, 0.9); shards.color2 = new B.Color4(0.6, 0.8, 1, 0.6); shards.colorDead = new B.Color4(0.6, 0.8, 1, 0);
  shards.minAngularSpeed = -8; shards.maxAngularSpeed = 8;
  shards.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  shards.start();

  // Staub/Nebel, der beim Hüllenbruch zum Leck strömt
  breachFog = new B.ParticleSystem("breachFog", 900, scene);
  breachFog.particleTexture = smokeTex; breachFog.emitter = V3(0, 0, 0);
  breachFog.minSize = 0.3; breachFog.maxSize = 1.2; breachFog.minLifeTime = 0.6; breachFog.maxLifeTime = 1.4;
  breachFog.emitRate = 0; breachFog.color1 = new B.Color4(0.8, 0.85, 0.9, 0.18); breachFog.color2 = new B.Color4(0.6, 0.65, 0.7, 0.12);
  breachFog.colorDead = new B.Color4(0.5, 0.5, 0.5, 0);
  breachFog.minEmitPower = 6; breachFog.maxEmitPower = 14;
  breachFog.start();

  const holeTex = glowTexture(scene, "hole", [[0, "rgba(0,0,0,1)"], [0.25, "rgba(10,8,6,0.95)"], [0.5, "rgba(30,25,20,0.4)"], [1, "rgba(0,0,0,0)"]], 64);
  const hm = new B.PBRMaterial("holeM", scene);
  hm.albedoTexture = holeTex; hm.useAlphaFromAlbedoTexture = true; hm.albedoColor = new B.Color3(0.05, 0.05, 0.05);
  hm.metallic = 0.5; hm.roughness = 0.6; hm.zOffset = -2; hm.maxSimultaneousLights = 8;
  for (let i = 0; i < 80; i++) {
    const d = B.MeshBuilder.CreatePlane("hole" + i, { size: 0.09 }, scene);
    d.material = hm; d.isPickable = false; d.setEnabled(false);
    decalPool.push(d);
  }
}

function burst(sys, pos, n, dir, spread = 1) {
  sys.emitter = pos.clone ? pos.clone() : V3(...pos);
  if (dir) {
    sys.direction1 = dir.add(V3(-spread, -spread, -spread));
    sys.direction2 = dir.add(V3(spread, spread, spread));
  }
  sys.manualEmitCount = (sys.manualEmitCount > 0 ? sys.manualEmitCount : 0) + n;
}

function addDecal(point, normal) {
  const d = decalPool[decalIdx++ % decalPool.length];
  d.setEnabled(true);
  d.position.copyFrom(point.add(normal.scale(0.004)));
  d.lookAt(point.subtract(normal));
  d.rotate(B.Axis.Z, Math.random() * 6, B.Space.LOCAL);
  world.placeDynamic([d], roomAt([point.x, point.y, point.z]));
}

const tracerMat = () => {
  const m = new B.StandardMaterial("tracerM", scene);
  m.emissiveColor = new B.Color3(0.6, 0.9, 1); m.disableLighting = true; m.alpha = 0.9; m.alphaMode = B.Constants.ALPHA_ADD;
  return m;
};
let tracerMaterial, laserMaterial;
function tracer(a, b, laser = false) {
  if (!tracerMaterial) {
    tracerMaterial = tracerMat();
    laserMaterial = tracerMat(); laserMaterial.emissiveColor = new B.Color3(3, 0.15, 0.08);
  }
  const len = B.Vector3.Distance(a, b);
  if (len < 0.1) return;
  const t = B.MeshBuilder.CreateCylinder("tracer", { diameter: laser ? 0.035 : 0.012, height: len, tessellation: 6 }, scene);
  t.material = laser ? laserMaterial : tracerMaterial;
  t.position = a.add(b).scale(0.5);
  const dir = b.subtract(a).normalize();
  const axis = B.Vector3.Cross(B.Axis.Y, dir);
  const ang = Math.acos(Math.max(-1, Math.min(1, B.Vector3.Dot(B.Axis.Y, dir))));
  if (axis.lengthSquared() > 1e-6) t.rotationQuaternion = B.Quaternion.RotationAxis(axis.normalize(), ang);
  t.isPickable = false;
  tracers.push({ mesh: t, life: laser ? 0.12 : 0.05 });
}

/* ---------- Drohnen ---------- */
let droneMats;
function makeDrone(id) {
  if (!droneMats) {
    const body = new B.PBRMaterial("droneBody", scene);
    body.albedoColor = new B.Color3(0.07, 0.075, 0.08); body.metallic = 0.85; body.roughness = 0.3; body.maxSimultaneousLights = 8;
    const plate = new B.PBRMaterial("dronePlate", scene);
    plate.albedoColor = new B.Color3(0.55, 0.56, 0.58); plate.metallic = 1; plate.roughness = 0.25; plate.maxSimultaneousLights = 8;
    const eye = new B.PBRMaterial("droneEye", scene);
    eye.albedoColor = B.Color3.Black(); eye.emissiveColor = new B.Color3(1, 0.08, 0.04); eye.emissiveIntensity = 8; eye.disableLighting = true;
    const thr = new B.PBRMaterial("droneThr", scene);
    thr.albedoColor = B.Color3.Black(); thr.emissiveColor = new B.Color3(0.3, 0.6, 1); thr.emissiveIntensity = 4; thr.disableLighting = true;
    const warn = new B.PBRMaterial("droneWarn", scene);
    warn.albedoColor = new B.Color3(0.8, 0.5, 0.02); warn.metallic = 0.2; warn.roughness = 0.5; warn.maxSimultaneousLights = 8;
    droneMats = { body, plate, eye, thr, warn };
  }
  const root = new B.TransformNode("drone" + id, scene);
  const parts = [];
  const add = (m, mat) => { m.parent = root; m.material = mat; m.metadata = { drone: id }; parts.push(m); return m; };
  add(B.MeshBuilder.CreateSphere("dBody", { diameter: 0.56, segments: 24 }, scene), droneMats.body);
  const ring = add(B.MeshBuilder.CreateTorus("dRing", { diameter: 0.74, thickness: 0.06, tessellation: 40 }, scene), droneMats.plate);
  ring.rotation.x = Math.PI / 2;
  const band = add(B.MeshBuilder.CreateCylinder("dBand", { diameter: 0.58, height: 0.08, tessellation: 32 }, scene), droneMats.warn);
  band.position.y = 0.05;
  const lensHousing = add(B.MeshBuilder.CreateCylinder("dHouse", { diameter: 0.2, height: 0.14, tessellation: 20 }, scene), droneMats.plate);
  lensHousing.rotation.x = Math.PI / 2; lensHousing.position.z = 0.26;
  const eye = add(B.MeshBuilder.CreateSphere("dEye", { diameter: 0.12, segments: 12 }, scene), droneMats.eye);
  eye.position.z = 0.33;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const pod = add(B.MeshBuilder.CreateCylinder("dPod", { diameter: 0.13, height: 0.16, tessellation: 14 }, scene), droneMats.body);
    pod.position.set(Math.cos(a) * 0.37, -0.02, Math.sin(a) * 0.37);
    const glow = add(B.MeshBuilder.CreateDisc("dThr", { radius: 0.05, tessellation: 14 }, scene), droneMats.thr);
    glow.position.set(Math.cos(a) * 0.37, -0.105, Math.sin(a) * 0.37); glow.rotation.x = Math.PI / 2;
    const ant = add(B.MeshBuilder.CreateBox("dFin", { width: 0.02, height: 0.18, depth: 0.1 }, scene), droneMats.plate);
    ant.position.set(Math.cos(a + 1) * 0.2, 0.27, Math.sin(a + 1) * 0.2); ant.rotation.y = -a;
  }
  for (const p of parts) p.receiveShadows = true;
  world.castShadows(parts.filter(p => p.name === "dBody" || p.name === "dRing"));
  return { root, parts, eye, p: null, target: null, yaw: 0, hp: 60, bob: Math.random() * 6 };
}

function destroyDrone(d, how, win) {
  drones.delete(d.id);
  if (how === "spaced") {
    const w = WINDOWS[win];
    spacedDrones.push({ d, vel: V3(...w.normal).scale(14).add(V3(0, 1, 0)), spin: V3(Math.random() * 8, Math.random() * 8, Math.random() * 8), life: 4 });
    return;
  }
  const p = d.root.position.clone();
  burst(sparks, p, 90, V3(0, 1, 0), 3);
  burst(smoke, p, 25, V3(0, 0.5, 0), 0.8);
  const L = new B.PointLight("boom", p, scene);
  L.diffuse = new B.Color3(1, 0.55, 0.2); L.intensity = 40; L.range = 10;
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += engine.getDeltaTime() / 1000; L.intensity = Math.max(0, 40 * (1 - t / 0.35));
    if (t > 0.35) { L.dispose(); scene.onBeforeRenderObservable.remove(obs); }
  });
  const dist = B.Vector3.Distance(p, camera.position);
  sfx.explosion(Math.min(1, 5 / (dist + 1)));
  d.root.dispose();
}

/* ---------- Mitspieler (Astronauten) ---------- */
let suitMat, visorMat, packMat;
function makeAstronaut(pl) {
  if (!suitMat) {
    suitMat = new B.PBRMaterial("suit", scene);
    suitMat.albedoColor = new B.Color3(0.82, 0.82, 0.79); suitMat.metallic = 0; suitMat.roughness = 0.82; suitMat.maxSimultaneousLights = 8;
    visorMat = new B.PBRMaterial("visor", scene);
    visorMat.albedoColor = new B.Color3(1, 0.72, 0.3); visorMat.metallic = 1; visorMat.roughness = 0.06; visorMat.maxSimultaneousLights = 8;
    packMat = new B.PBRMaterial("pack", scene);
    packMat.albedoColor = new B.Color3(0.65, 0.66, 0.66); packMat.metallic = 0.2; packMat.roughness = 0.6; packMat.maxSimultaneousLights = 8;
  }
  const root = new B.TransformNode("astro" + pl.id, scene);
  const parts = [];
  const add = (m, mat) => { m.parent = root; m.material = mat; m.isPickable = false; parts.push(m); return m; };
  const torso = add(B.MeshBuilder.CreateCapsule("torso", { radius: 0.27, height: 0.95 }, scene), suitMat); torso.position.y = 0.15;
  const helmet = add(B.MeshBuilder.CreateSphere("helmet", { diameter: 0.42, segments: 24 }, scene), suitMat); helmet.position.y = 0.72;
  const visor = add(B.MeshBuilder.CreateSphere("visorS", { diameter: 0.4, segments: 24, slice: 0.5 }, scene), visorMat);
  visor.position.set(0, 0.73, 0.04); visor.rotation.x = Math.PI / 2; visor.scaling.set(0.95, 0.85, 0.95);
  const pack = add(B.MeshBuilder.CreateBox("pack", { width: 0.5, height: 0.6, depth: 0.22 }, scene), packMat); pack.position.set(0, 0.25, -0.33);
  for (const s of [-1, 1]) {
    const leg = add(B.MeshBuilder.CreateCapsule("leg", { radius: 0.11, height: 0.85 }, scene), suitMat); leg.position.set(s * 0.13, -0.48, 0);
    const armM = add(B.MeshBuilder.CreateCapsule("arm", { radius: 0.085, height: 0.62 }, scene), suitMat);
    armM.position.set(s * 0.34, 0.25, 0.15); armM.rotation.x = 1.1;
    const boot = add(B.MeshBuilder.CreateBox("boot", { width: 0.16, height: 0.12, depth: 0.28 }, scene), packMat); boot.position.set(s * 0.13, -0.84, 0.04);
  }
  const bandMat = new B.PBRMaterial("band" + pl.id, scene);
  bandMat.albedoColor = B.Color3.FromHexString(pl.color); bandMat.emissiveColor = B.Color3.FromHexString(pl.color); bandMat.emissiveIntensity = 1.4;
  const band = add(B.MeshBuilder.CreateCylinder("band", { diameter: 0.57, height: 0.07, tessellation: 24 }, scene), bandMat); band.position.y = 0.42;
  const rifle = add(B.MeshBuilder.CreateBox("rifle", { width: 0.07, height: 0.1, depth: 0.75 }, scene), packMat); rifle.position.set(0.12, 0.25, 0.45);
  // Namensschild
  const tagTex = new B.DynamicTexture("tag" + pl.id, { width: 256, height: 64 }, scene, true);
  const c = tagTex.getContext(); c.clearRect(0, 0, 256, 64);
  c.font = "bold 34px Arial"; c.textAlign = "center"; c.fillStyle = pl.color; c.fillText(pl.name, 128, 44);
  tagTex.update(); tagTex.hasAlpha = true;
  const tag = B.MeshBuilder.CreatePlane("tagP", { width: 0.8, height: 0.2 }, scene);
  tag.parent = root; tag.position.y = 1.12; tag.billboardMode = B.Mesh.BILLBOARDMODE_ALL; tag.isPickable = false;
  const tm = new B.StandardMaterial("tagM" + pl.id, scene);
  tm.emissiveTexture = tagTex; tm.opacityTexture = tagTex; tm.disableLighting = true; tm.backFaceCulling = false;
  tag.material = tm; tag.renderingGroupId = 1;
  for (const p of parts) p.receiveShadows = true;
  world.castShadows(parts);
  return { root, parts, p: null, target: null, yaw: 0, name: pl.name, color: pl.color };
}

/* ---------- Eingabe ---------- */
function bindInput(canvas) {
  const lock = () => { sfx.init(); sfx.ctx?.resume(); canvas.requestPointerLock?.(); };
  $("click").onclick = lock;
  canvas.addEventListener("click", lock);
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    $("click").style.display = locked || $("chatIn").style.display === "block" ? "none" : "grid";
  });
  document.addEventListener("mousemove", e => {
    if (document.pointerLockElement !== canvas || me.dying) return;
    const sens = 0.0022 * (1 - me.ads * 0.45);
    me.yaw += e.movementX * sens;
    me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch + e.movementY * sens));
  });
  document.addEventListener("mousedown", e => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) rightDown = true;
  });
  document.addEventListener("mouseup", e => { if (e.button === 0) mouseDown = false; if (e.button === 2) rightDown = false; });
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (document.activeElement === $("chatIn")) {
      if (e.key === "Enter") {
        const t = $("chatIn").value.trim(); if (t) socket.emit("chat", t);
        $("chatIn").value = ""; $("chatIn").style.display = "none"; canvas.requestPointerLock?.();
      } else if (e.key === "Escape") { $("chatIn").style.display = "none"; }
      return;
    }
    keys.add(e.code);
    if (e.code === "KeyR") reload();
    if (e.code === "KeyE") socket.emit("interact", {}, () => {});
    if (e.code === "KeyT") {
      e.preventDefault(); document.exitPointerLock?.();
      $("chatIn").style.display = "block"; setTimeout(() => $("chatIn").focus(), 0);
    }
    if (e.code === "Space" || e.code.startsWith("Control")) e.preventDefault();
  });
  document.addEventListener("keyup", e => keys.delete(e.code));
  window.addEventListener("blur", () => { keys.clear(); mouseDown = false; rightDown = false; });
}

function reload() {
  if (me.reloadT > 0 || me.ammo === 30 || !me.alive) return;
  me.reloadT = 1.9;
  sfx.beep(420, 0.05, 0.1);
  setTimeout(() => sfx.beep(660, 0.05, 0.1), 900);
}

/* ---------- Netzwerk ---------- */
function bindNet() {
  socket.on("snap", s => {
    snap = s;
    const seen = new Set();
    for (const pl of s.players) {
      if (pl.id === me.id) {
        if (me.alive && !pl.alive) onDeath();
        me.hp = pl.hp;
        continue;
      }
      seen.add(pl.id);
      let r = remote.get(pl.id);
      if (!r) { r = makeAstronaut(pl); remote.set(pl.id, r); }
      r.target = pl.p; r.tyaw = pl.yaw; r.alive = pl.alive; r.hp = pl.hp;
      if (!r.p) r.p = [...pl.p];
    }
    for (const [id, r] of remote) if (!seen.has(id)) { r.root.dispose(); remote.delete(id); }
    const ids = new Set();
    for (const d of s.drones) {
      ids.add(d.id);
      let x = drones.get(d.id);
      if (!x) { x = makeDrone(d.id); x.id = d.id; drones.set(d.id, x); x.p = [...d.p]; }
      x.target = d.p; x.tyaw = d.yaw;
    }
    for (const [id, d] of drones) if (!ids.has(id)) destroyDrone(d, "shot");
    s.windows.forEach((w, i) => {
      const W = world.windows[i];
      if (W.state === w.state) return;
      if (w.state === "intact") { W.glass.setEnabled(true); W.clearGlass(); }
      if (w.state === "breached") W.glass.setEnabled(false);
      W.state = w.state;
    });
  });
  socket.on("respawn", ({ p }) => {
    Object.assign(me, { pos: [...p], vel: [0, 0, 0], hp: 100, o2: 100, alive: true, dying: null, ammo: 30, reloadT: 0, yaw: Math.PI / 2, pitch: 0 });
    $("dead").style.display = "none";
    showBanner("WIEDERBELEBT — ANDOCKSCHLEUSE", 2000);
  });
  socket.on("tracer", ({ o, e }) => {
    tracer(V3(...o), V3(...e));
    const d = B.Vector3.Distance(V3(...o), camera.position);
    sfx.shot(Math.min(0.8, 4 / (d + 2)), panOf(V3(...o)));
  });
  socket.on("droneShot", ({ from, to, target, hit }) => {
    const a = V3(...from), b = V3(...to);
    const dir = b.subtract(a).normalize();
    const end = target === me.id && hit ? camera.position.add(V3(0, -0.25, 0)) : b.add(dir.scale(3));
    tracer(a.add(dir.scale(0.35)), end, true);
    sfx.laser(Math.min(1, 6 / (B.Vector3.Distance(a, camera.position) + 1)), panOf(a));
    if (!(target === me.id && hit)) {
      const ray = new B.Ray(a.add(dir.scale(0.5)), dir, 40);
      const pick = scene.pickWithRay(ray, m => m.isPickable && !m.metadata?.drone);
      if (pick?.hit) burst(sparks, pick.pickedPoint, 12, pick.getNormal(true), 1.5);
    }
  });
  socket.on("hurt", ({ from, dmg }) => {
    me.lastHurt = 1; me.shake = Math.max(me.shake, 0.25);
    const dirTo = V3(...from).subtract(camera.position);
    showHitDirection(dirTo);
    sfx.impact(0.8, 0, false);
    void dmg;
  });
  socket.on("droneDown", ({ id, how, win, by }) => {
    const d = drones.get(id);
    if (d) destroyDrone(d, how, win);
    if (by === me.id) hitmark(true);
  });
  socket.on("windowHit", ({ win, pt }) => {
    world.windows[win].addCrack(pt);
    sfx.glass(0.25);
  });
  socket.on("breach", ({ win }) => {
    const W = world.windows[win], w = WINDOWS[win];
    W.glass.setEnabled(false); W.state = "breached";
    const c = V3(...w.center), n = V3(...w.normal);
    burst(shards, c, 400, n.scale(1), 0.8);
    sfx.glass(1); sfx.explosion(0.9);
    if (roomAt(me.pos) === w.roomIdx) me.shake = 1;
  });
  socket.on("sealed", ({ win }) => { world.windows[win].state = "sealed"; sfx.impact(1, 0, true); sfx.explosion(0.4); });
  socket.on("restored", ({ win }) => { const W = world.windows[win]; W.state = "intact"; W.glass.setEnabled(true); W.clearGlass(); });
  socket.on("feed", t => addLine("feed", t));
  socket.on("chat", ({ name, color, text }) => addLine("chat", `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}`, true));
  socket.on("alert", t => { showBanner(t, 2500, true); sfx.beep(520, 0.15, 0.2); });
  socket.on("mission", ({ phase, text }) => {
    showBanner(text, 5000, phase === "lost");
    if (phase === "won") sfx.beep(990, 0.3, 0.2);
  });
  socket.on("left", ({ id }) => { const r = remote.get(id); if (r) { r.root.dispose(); remote.delete(id); } });
  socket.on("disconnect", () => showBanner("VERBINDUNG ZUR STATION VERLOREN", 99999, true));
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function addLine(id, html, raw = false) {
  const el = document.createElement("div");
  if (raw) el.innerHTML = html; else el.textContent = html;
  $(id).appendChild(el);
  while ($(id).children.length > 6) $(id).firstChild.remove();
  setTimeout(() => el.remove(), id === "chat" ? 10000 : 6000);
}
let bannerTimer;
function showBanner(text, ms, alert = false) {
  const b = $("banner"); b.textContent = text; b.className = "show" + (alert ? " alert" : "");
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.className = "", ms);
}
function hitmark(kill) {
  const h = $("hitmark"); h.style.transition = "none"; h.style.opacity = 1;
  h.style.filter = kill ? "drop-shadow(0 0 4px red)" : "none";
  requestAnimationFrame(() => { h.style.transition = "opacity .25s"; h.style.opacity = 0; });
}
function showHitDirection() {
  $("dmg").style.transition = "none"; $("dmg").style.opacity = 0.9;
  requestAnimationFrame(() => { $("dmg").style.transition = "opacity .6s"; $("dmg").style.opacity = 0; });
}
function panOf(p) {
  const right = V3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
  const d = p.subtract(camera.position); d.normalize();
  return B.Vector3.Dot(d, right);
}

/* ---------- Tod ---------- */
function onDeath() {
  me.alive = false;
  if (!me.dying) me.dying = { t: 0, kind: me.o2 <= 0 ? "o2" : "drone" };
  $("dead").style.display = "grid";
  $("deadTxt").textContent = { o2: "Sauerstoff erschöpft", spaced: "Ins All gesaugt", drone: "Von Sicherheitsdrohne ausgeschaltet" }[me.dying.kind] + " — Wiederbelebung in Kürze";
}

/* ---------- Hauptschleife ---------- */
function roomHasAir(ri) {
  if (ri < 0 || !ROOMS[ri].atmo) return false;
  if (!snap) return true;
  return !snap.windows.some((w, i) => WINDOWS[i].roomIdx === ri && (w.state === "breached" || (w.state === "sealed" && w.t < 10)));
}

let viewOverride = null;
function setView(pos, yaw, pitch) { viewOverride = pos ? { pos, yaw, pitch } : null; }

let windSnd = null;
function update(dt) {
  const ri = roomAt(me.pos);
  me.room = ri;
  const room = ROOMS[ri] || ROOMS[0];
  const air = roomHasAir(ri);
  sfx.setAir(air);

  /* --- Bewegung --- */
  if (me.alive && !me.dying) {
    const fwdIn = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const sideIn = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
    const v = me.vel;
    if (room.gravity) {
      const sprint = keys.has("ShiftLeft") && fwdIn > 0 && me.ads < 0.5;
      const speed = sprint ? 6.4 : me.ads > 0.5 ? 2.6 : 4.2;
      let wx = sy * fwdIn + cy * sideIn, wz = cy * fwdIn - sy * sideIn;
      const l = Math.hypot(wx, wz) || 1; wx = wx / l * speed * (fwdIn || sideIn ? 1 : 0); wz = wz / l * speed * (fwdIn || sideIn ? 1 : 0);
      const k = Math.min(1, dt * (me.grounded ? 12 : 1.5));
      v[0] += (wx - v[0]) * k; v[2] += (wz - v[2]) * k;
      v[1] -= 9.81 * dt;
      if (keys.has("Space") && me.grounded) { v[1] = 4.2; me.grounded = false; }
      if (me.grounded && (fwdIn || sideIn)) {
        me.stepT -= dt * (sprint ? 1.5 : 1);
        if (me.stepT <= 0) { me.stepT = 0.42; sfx.footstep(air ? 0.18 : 0.3); }
      }
    } else {
      // Schwerelos: Schubdüsen in Blickrichtung, Impuls bleibt erhalten
      const cp = Math.cos(me.pitch), sp = Math.sin(me.pitch);
      const f = [sy * cp, -sp, cy * cp], r = [cy, 0, -sy];
      const up = (keys.has("Space") ? 1 : 0) - (keys.has("ControlLeft") || keys.has("KeyC") ? 1 : 0);
      const t = [0, 0, 0];
      for (let a = 0; a < 3; a++) t[a] = f[a] * fwdIn + r[a] * sideIn + (a === 1 ? up : 0);
      const tl = Math.hypot(...t);
      if (tl > 0) for (let a = 0; a < 3; a++) v[a] += t[a] / tl * 5.5 * dt;
      const sp2 = Math.hypot(...v);
      if (sp2 > 6) for (let a = 0; a < 3; a++) v[a] *= 6 / sp2;
      for (let a = 0; a < 3; a++) v[a] *= 1 - dt * 0.25;
      me.grounded = false;
    }
    // Sog durch Hüllenbruch
    let suck = 0;
    if (snap) snap.windows.forEach((w, i) => {
      const W = WINDOWS[i];
      if (w.state !== "breached" || W.roomIdx !== ri) return;
      const to = [W.center[0] - me.pos[0], W.center[1] - me.pos[1], W.center[2] - me.pos[2]];
      const dd = Math.hypot(...to) || 1;
      const fade = Math.max(0, 1 - w.t / RULES.breachSeconds) * 0.6 + 0.4;
      const s = RULES.suction * fade * Math.min(1.6, 6 / (dd + 1)) * (me.grounded && keys.has("ControlLeft") ? 0.35 : 1);
      for (let a = 0; a < 3; a++) v[a] += (to[a] / dd) * s * dt;
      suck = Math.max(suck, s / RULES.suction);
      const prox = windowProximity(W, me.pos);
      if (prox.inRect && prox.dist < 0.75) {
        me.dying = { t: 0, kind: "spaced", vel: V3(...W.normal).scale(12).add(V3(v[0], v[1], v[2]).scale(0.3)), spin: V3(0.6, 1.4, 0.9) };
        socket.emit("selfDamage", { cause: "spaced" });
        onDeath();
      }
    });
    if (suck > 0) { if (!windSnd) windSnd = sfx.wind(); windSnd.set(Math.min(1, suck)); me.shake = Math.max(me.shake, suck * 0.12); }
    else if (windSnd) { windSnd.stop(); windSnd = null; }

    if (!me.dying) {
      const sp = Math.hypot(...v) * dt;
      const n = Math.max(1, Math.ceil(sp / 0.12));
      me.grounded = false;
      for (let s = 0; s < n; s++) {
        const np = [me.pos[0] + v[0] * dt / n, me.pos[1] + v[1] * dt / n, me.pos[2] + v[2] * dt / n];
        const r = resolveBox(np, PLAYER_HALF);
        if (!r) { for (let a = 0; a < 3; a++) v[a] *= -0.2; break; }
        me.pos = r.pos;
        for (let a = 0; a < 3; a++) if (r.contact[a]) {
          if (a === 1 && r.contact[1] < 0) me.grounded = true;
          v[a] = room.gravity ? 0 : -v[a] * 0.35;
        }
      }
    }

    /* --- Sauerstoff --- */
    const sprinting = keys.has("ShiftLeft") && room.gravity;
    if (air) me.o2 = Math.min(100, me.o2 + 14 * dt);
    else me.o2 = Math.max(0, me.o2 - (1.5 + (sprinting ? 1 : 0)) * dt);
    if (me.o2 <= 0) {
      me.o2DmgAcc += 9 * dt;
      if (me.o2DmgAcc >= 3) { socket.emit("selfDamage", { amt: me.o2DmgAcc, cause: "o2" }); me.o2DmgAcc = 0; }
    }
    if (!air) {
      me.breathT -= dt;
      const stress = 1 - me.o2 / 100;
      if (me.breathT <= 0) { me.breathT = 2.6 - stress * 1.6; sfx.breath(stress); }
    }

    /* --- Waffe --- */
    me.ads += ((rightDown && me.reloadT <= 0 ? 1 : 0) - me.ads) * Math.min(1, dt * 12);
    me.fireCD -= dt;
    if (me.reloadT > 0) { me.reloadT -= dt; if (me.reloadT <= 0) { me.ammo = 30; gun.drawAmmo(); } }
    if (mouseDown && me.fireCD <= 0 && me.reloadT <= 0) {
      if (me.ammo > 0) fire(room); else reload();
    }
  }

  /* --- Tod: Kamera treibt ins All bzw. sinkt zu Boden --- */
  if (me.dying) {
    me.dying.t += dt;
    if (me.dying.kind === "spaced") {
      me.pos = me.pos.map((x, a) => x + me.dying.vel.asArray()[a] * dt);
      me.dying.vel.scaleInPlace(0.995);
      me.yaw += me.dying.spin.y * dt; me.pitch += me.dying.spin.x * dt * 0.5;
      me.o2 = Math.max(0, me.o2 - 6 * dt);
    }
  }

  /* --- Kamera --- */
  const shake = me.shake;
  me.shake = Math.max(0, me.shake - dt * 1.8);
  me.kick = Math.max(0, me.kick - dt * 10);
  const bob = me.grounded && Math.hypot(me.vel[0], me.vel[2]) > 0.5 ? Math.sin(performance.now() / 120) * 0.025 : 0;
  if (viewOverride) {
    camera.position.set(...viewOverride.pos);
    camera.rotation.set(viewOverride.pitch, viewOverride.yaw, 0);
  } else {
    const lowY = me.dying && me.dying.kind !== "spaced" ? -Math.min(0.9, me.dying.t * 1.5) : 0;
    camera.position.set(me.pos[0], me.pos[1] + EYE_OFFSET + bob * (1 - me.ads) + lowY, me.pos[2]);
    camera.rotation.set(
      me.pitch - me.kick * 0.04 + (Math.random() - 0.5) * shake * 0.05,
      me.yaw + (Math.random() - 0.5) * shake * 0.05,
      (me.dying && me.dying.kind !== "spaced" ? Math.min(1.2, me.dying.t * 2) : 0) + (!room.gravity ? Math.sin(performance.now() / 1400) * 0.02 : 0),
    );
  }
  camera.fov = 1.2 - me.ads * 0.42;

  // Waffe: Visier, Nachladen, Schwanken
  const swayT = performance.now() / 1000;
  const idle = [Math.sin(swayT * 1.1) * 0.004, Math.sin(swayT * 1.7) * 0.003];
  const hip = [0.2, -0.2, 0.42], aim = [0, -0.112 - 0.0, 0.3];
  const rl = me.reloadT > 0 ? Math.sin(Math.min(1, (1.9 - me.reloadT) / 1.9) * Math.PI) : 0;
  gun.root.position.set(
    hip[0] + (aim[0] - hip[0]) * me.ads + idle[0] * (1 - me.ads) + bob * 0.3,
    hip[1] + (aim[1] - hip[1]) * me.ads + idle[1] - rl * 0.18 + bob * 0.4,
    hip[2] + (aim[2] - hip[2]) * me.ads - me.kick * 0.05,
  );
  gun.root.rotation.set(rl * 0.6 - me.kick * 0.08, 0, rl * 0.4);
  gun.root.setEnabled(me.alive && !me.dying);
  gun.flashLight.position.copyFrom(camera.position.add(camera.getForwardRay(1).direction.scale(0.9)));
  gun.flashLight.intensity = Math.max(0, gun.flashLight.intensity - dt * 400);
  if (gun.flashLight.intensity <= 0) gun.flash.isVisible = false;
  world.placeDynamic(gun.parts, ri);

  // Interaktion
  const nearTerm = snap?.phase === "explore" && Math.hypot(me.pos[0] - TERMINAL.pos[0], me.pos[2] - TERMINAL.pos[2]) < TERMINAL.radius + 0.6;
  $("prompt").style.display = nearTerm && me.alive ? "block" : "none";
  if (nearTerm) $("prompt").innerHTML = "<kbd>E</kbd> LOGBUCH-DOWNLOAD STARTEN";

  /* --- Mitspieler & Drohnen interpolieren --- */
  const k = 1 - Math.exp(-dt * 14);
  const entities = [me.pos];
  for (const r of remote.values()) {
    if (!r.target) continue;
    for (let a = 0; a < 3; a++) r.p[a] += (r.target[a] - r.p[a]) * k;
    r.yaw += angDiff(r.tyaw, r.yaw) * k;
    r.root.position.set(...r.p);
    r.root.rotation.y = r.yaw;
    r.root.setEnabled(r.alive !== false);
    world.placeDynamic(r.parts, roomAt(r.p));
    entities.push(r.p);
  }
  for (const d of drones.values()) {
    if (!d.target) continue;
    for (let a = 0; a < 3; a++) d.p[a] += (d.target[a] - d.p[a]) * k;
    d.yaw += angDiff(d.tyaw, d.yaw) * k;
    d.bob += dt;
    d.root.position.set(d.p[0], d.p[1] + Math.sin(d.bob * 2.2) * 0.04, d.p[2]);
    d.root.rotation.set(Math.sin(d.bob * 1.3) * 0.08, d.yaw, Math.sin(d.bob * 1.7) * 0.08);
    world.placeDynamic(d.parts, roomAt(d.p));
    entities.push(d.p);
  }
  for (const s of spacedDrones) {
    s.life -= dt;
    s.d.root.position.addInPlace(s.vel.scale(dt));
    s.d.root.rotation.addInPlace(s.spin.scale(dt));
    s.vel.scaleInPlace(1.01);
    if (s.life <= 0) s.d.root.dispose();
  }
  spacedDrones = spacedDrones.filter(s => s.life > 0);
  for (const t of tracers) { t.life -= dt; if (t.life <= 0) t.mesh.dispose(); }
  tracers = tracers.filter(t => t.life > 0);

  // Hüllenbruch-Nebel
  const alarmRooms = new Set();
  let fogOn = false;
  if (snap) snap.windows.forEach((w, i) => {
    if (w.state === "breached" || (w.state === "sealed" && w.t < 3)) alarmRooms.add(WINDOWS[i].roomIdx);
    if (w.state === "breached") {
      const W = WINDOWS[i], R = ROOMS[W.roomIdx];
      fogOn = true;
      breachFog.emitter = V3(...W.center);
      breachFog.minEmitBox = V3(R.min[0] - W.center[0], R.min[1] - W.center[1], R.min[2] - W.center[2]).scale(0.5);
      breachFog.maxEmitBox = V3(R.max[0] - W.center[0], R.max[1] - W.center[1], R.max[2] - W.center[2]).scale(0.5);
      const n = V3(...W.normal);
      breachFog.direction1 = n.scale(0.6).add(V3(-0.3, -0.3, -0.3));
      breachFog.direction2 = n.scale(1.2).add(V3(0.3, 0.3, 0.3));
    }
  });
  breachFog.emitRate = fogOn ? 280 : 0;
  sfx.alarm(alarmRooms.has(ri));

  // Terminal-Bildschirm
  const term = world.screens.find(s => s.kind === "terminal");
  if (term && snap && (term.lastP !== snap.progress || term.lastPhase !== snap.phase)) {
    term.lastP = snap.progress; term.lastPhase = snap.phase;
    drawTerminal(term.tex, snap.phase, snap.progress);
  }

  // Unterdruck-Effekte im Bild
  if (pipeline) {
    const hyp = Math.max(0, 1 - me.o2 / 30);
    pipeline.chromaticAberration.aberrationAmount = 14 + hyp * 60 + me.lastHurt * 40;
    pipeline.imageProcessing.exposure = 1.05 - hyp * 0.4;
  }
  me.lastHurt = Math.max(0, me.lastHurt - dt * 2);
  $("hypoxia").style.opacity = Math.max(0, 1 - me.o2 / 30).toFixed(2);

  world.update(dt, camera.position, entities, alarmRooms);
}

const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

function fire(room) {
  me.fireCD = 0.105; me.ammo--; me.kick = 1;
  gun.drawAmmo();
  const spread = (0.003 + (1 - me.ads) * 0.012 + Math.hypot(me.vel[0], me.vel[2]) * 0.002);
  const fwd = camera.getForwardRay(1).direction;
  const right = camera.getDirection(B.Axis.X), up = camera.getDirection(B.Axis.Y);
  const dir = fwd.add(right.scale((Math.random() - 0.5) * 2 * spread)).add(up.scale((Math.random() - 0.5) * 2 * spread)).normalize();
  const origin = camera.position.clone();
  const ray = new B.Ray(origin, dir, 150);
  const pick = scene.pickWithRay(ray, m => m.isPickable && m.isEnabled() && m.renderingGroupId === 0 && !m.name.startsWith("tracer") && !m.name.startsWith("hole"));
  let end = origin.add(dir.scale(150)), hit = null;
  if (pick?.hit) {
    end = pick.pickedPoint;
    const n = pick.getNormal(true) || dir.scale(-1);
    const md = pick.pickedMesh.metadata || {};
    if (md.drone) {
      hit = { type: "drone", id: md.drone };
      burst(sparks, end, 22, n, 1.2); hitmark(false);
      sfx.impact(0.5, 0, true);
    } else if (md.window !== undefined) {
      hit = { type: "window", id: md.window };
      burst(shards, end, 18, n.scale(0.2), 0.5);
      if (!WINDOWS[md.window].breachable) { world.windows[md.window].addCrack([end.x, end.y, end.z]); sfx.glass(0.2); }
    } else {
      burst(sparks, end, 14, n, 1); burst(smoke, end, 2, n.scale(0.5), 0.2);
      addDecal(end, n);
      sfx.impact(0.3 * Math.min(1, 6 / (pick.distance + 1)), 0, true);
    }
  }
  const muzzle = camera.position.add(dir.scale(0.8)).add(right.scale(0.2 * (1 - me.ads))).add(up.scale(-0.12));
  tracer(muzzle, end);
  socket.emit("fire", { o: [muzzle.x, muzzle.y, muzzle.z], e: [end.x, end.y, end.z], hit });
  gun.flash.isVisible = true; gun.flash.rotation.z = Math.random() * 6;
  gun.flashLight.intensity = 6;
  sfx.shot(0.9);
  me.pitch -= 0.006 * (1 - me.ads * 0.5);
  me.yaw += (Math.random() - 0.5) * 0.004;
  // Rückstoß im Schwerelosen: Impulserhaltung
  if (!room.gravity) for (let a = 0; a < 3; a++) me.vel[a] -= dir.asArray()[a] * 0.22;
}

/* ---------- HUD ---------- */
function updateHud() {
  const ri = me.room, room = ROOMS[ri];
  const air = roomHasAir(ri);
  $("roomname").textContent = room ? room.name.toUpperCase() : "—";
  const breach = snap?.windows.some((w, i) => WINDOWS[i].roomIdx === ri && w.state === "breached");
  $("env").innerHTML =
    `<span class="tag ${room?.gravity ? "ok" : "warnc"}">${room?.gravity ? "1 G" : "0 G"}</span>` +
    `<span class="tag ${air ? "ok" : "bad"}">${air ? "DRUCK OK" : "VAKUUM"}</span>` +
    (breach ? `<span class="tag bad">⚠ LECK</span>` : "");
  $("hpbar").firstChild.style.width = me.hp + "%"; $("hpv").textContent = Math.round(me.hp);
  $("hprow").classList.toggle("low", me.hp < 30);
  $("o2bar").firstChild.style.width = me.o2 + "%"; $("o2v").textContent = Math.round(me.o2);
  $("o2row").classList.toggle("low", me.o2 < 25);
  $("mag").textContent = me.reloadT > 0 ? "··" : me.ammo;
  if (!snap) return;
  const obj = {
    explore: "Erreicht das Kommandomodul am Ende der Station und startet am Terminal den Logbuch-Download. Ab Korridor C gibt es keinen Luftdruck — achtet auf euren Sauerstoff.",
    upload: "Haltet das Kommandomodul, bis der Download abgeschlossen ist.",
    extract: "Logbuch gesichert. Alle Überlebenden zurück in die Andockschleuse!",
    won: "Einsatz erfolgreich. Neuer Einsatz in Kürze …",
    lost: "Einsatz gescheitert. Neustart in Kürze …",
  }[snap.phase];
  $("objText").textContent = obj;
  $("objProg").style.display = snap.phase === "upload" ? "block" : "none";
  $("objProg").firstChild.style.width = (snap.progress * 100).toFixed(1) + "%";
  $("team").innerHTML = `<span class="code">EINSATZ-CODE: ${$("team").dataset.code} · Link teilen</span>` + snap.players.map(p =>
    `<div class="${p.alive ? "" : "dead"}"><span style="color:${p.color}">${esc(p.name)}${p.id === me.id ? " (du)" : ""}</span><span>${Math.round(p.hp)}</span></div>`).join("");
  $("stats").textContent = `${engine.getFps().toFixed(0)} FPS · ${engine.isWebGPU ? "WebGPU" : "WebGL2"} · ${drones.size} Drohnen aktiv`;
}
