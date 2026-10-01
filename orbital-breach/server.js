/* ============================================================
 * Orbital Breach — Koop-Server (1–4 Spieler pro Einsatz)
 * ============================================================
 * Autoritativ für: Drohnen (KI, Treffer), Fensterzustand (Leck/Notschott),
 * Lebenspunkte, Missionsablauf. Die Spielerbewegung rechnet jeder Client
 * selbst (flüssiges Gefühl ohne Prediction-Aufwand) und meldet sie 20×/s.
 *
 * Start:  node orbital-breach/server.js   (bzw. npm run orbital)
 * Danach: http://localhost:3100 */
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import {
  ROOMS, ROOM_INDEX, WINDOWS, SPAWNS, DRONE_SPAWNS, TERMINAL, DRONE_HALF,
  RULES, roomAt, resolveBox, lineOfSight, nextDoorToward, windowProximity,
} from "./shared/level.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3100;
const TICK = 1 / 20;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.use("/shared", express.static(path.join(__dirname, "shared")));
app.get("/vendor/babylon.js", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "node_modules", "babylonjs", "babylon.js")));

const server = http.createServer(app);
const io = new Server(server);

const COLORS = ["#4fc3f7", "#ffb74d", "#81c784", "#f06292"];
const games = new Map();   // Code -> Game

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

class Game {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.nextDroneId = 1;
    this.reset();
  }

  reset() {
    this.drones = [];
    this.windows = WINDOWS.map(w => ({ state: "intact", hp: w.hp, t: 0, by: null }));
    this.phase = "explore";      // explore → upload → extract → won | lost
    this.progress = 0;
    this.waveT = 6;
    this.endT = 0;
    this.kills = 0;
    for (const p of [...DRONE_SPAWNS.hub.slice(0, 3), ...DRONE_SPAWNS.corC, ...DRONE_SPAWNS.cmd.slice(0, 2)]) this.spawnDrone(p);
    for (const pl of this.players.values()) this.respawn(pl);
  }

  spawnDrone(p) {
    this.drones.push({
      id: this.nextDroneId++, p: [...p], v: [0, 0, 0], hp: RULES.droneHp,
      cd: rnd(1, 2.5), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rnd(1, 3), yaw: 0, target: null,
    });
  }

  respawn(pl) {
    const s = SPAWNS[pl.slot % SPAWNS.length];
    pl.p = [...s]; pl.hp = RULES.playerHp; pl.alive = true; pl.respawnAt = 0;
    io.to(pl.id).emit("respawn", { p: pl.p });
  }

  livingPlayers() { return [...this.players.values()].filter(p => p.alive); }

  feed(text) { io.to(this.code).emit("feed", text); }

  hurtPlayer(pl, dmg, cause) {
    if (!pl.alive) return;
    pl.hp = Math.max(0, pl.hp - dmg);
    if (pl.hp <= 0) this.killPlayer(pl, cause);
  }

  killPlayer(pl, cause) {
    if (!pl.alive) return;
    pl.alive = false; pl.hp = 0;
    pl.respawnAt = RULES.respawnSeconds;
    const how = { drone: "von einer Drohne getroffen", o2: "erstickt", spaced: "ins All gesaugt" }[cause] || "gefallen";
    this.feed(`${pl.name} wurde ${how}`);
    io.to(this.code).emit("playerDown", { id: pl.id, cause });
  }

  breach(wi, byName) {
    const w = this.windows[wi];
    w.state = "breached"; w.t = 0; w.hp = 0; w.by = byName;
    io.to(this.code).emit("breach", { win: wi });
    this.feed(`⚠ HÜLLENBRUCH im ${ROOMS[WINDOWS[wi].roomIdx].name}!`);
  }

  update(dt) {
    // --- Fenster / Notschotts ---
    this.windows.forEach((w, i) => {
      if (w.state === "intact") return;
      w.t += dt;
      if (w.state === "breached" && w.t >= RULES.breachSeconds) {
        w.state = "sealed"; w.t = 0;
        io.to(this.code).emit("sealed", { win: i });
      } else if (w.state === "sealed" && w.t >= RULES.sealedSeconds) {
        w.state = "intact"; w.t = 0; w.hp = WINDOWS[i].hp;
        io.to(this.code).emit("restored", { win: i });
      }
    });

    // --- Spieler-Respawn ---
    for (const pl of this.players.values()) {
      if (pl.alive || this.phase === "won" || this.phase === "lost") continue;
      pl.respawnAt -= dt;
      if (pl.respawnAt <= 0) this.respawn(pl);
    }

    this.updateMission(dt);
    this.updateDrones(dt);
  }

  updateMission(dt) {
    const living = this.livingPlayers();
    if (this.phase === "won" || this.phase === "lost") {
      this.endT -= dt;
      if (this.endT <= 0) { this.reset(); io.to(this.code).emit("mission", { phase: this.phase, text: "Neuer Einsatz beginnt" }); }
      return;
    }
    if (this.players.size && !living.length && this.phase !== "explore") {
      this.phase = "lost"; this.endT = 10;
      io.to(this.code).emit("mission", { phase: "lost", text: "EINSATZ GESCHEITERT — Team ausgelöscht" });
      return;
    }

    if (this.phase === "upload") {
      const inCmd = living.some(p => roomAt(p.p) === ROOM_INDEX.cmd);
      if (inCmd) this.progress = Math.min(1, this.progress + dt / RULES.uploadSeconds);
      this.waveT -= dt;
      const cap = 5 + this.players.size * 2;
      if (this.waveT <= 0 && this.drones.length < cap) {
        this.waveT = rnd(9, 13);
        const n = 1 + Math.ceil(this.players.size * 0.75);
        for (let i = 0; i < n; i++) {
          const pool = Math.random() < 0.6 ? DRONE_SPAWNS.cmd : DRONE_SPAWNS.hub;
          this.spawnDrone(pool[(Math.random() * pool.length) | 0]);
        }
        io.to(this.code).emit("alert", "Drohnen-Verstärkung aus den Lüftungsschächten!");
      }
      if (this.progress >= 1) {
        this.phase = "extract";
        for (let i = 0; i < 2 + this.players.size; i++) this.spawnDrone(DRONE_SPAWNS.hub[i % 4]);
        io.to(this.code).emit("mission", { phase: "extract", text: "Logbuch gesichert! Zurück zur Andockschleuse!" });
      }
    } else if (this.phase === "extract") {
      if (living.length && living.every(p => roomAt(p.p) === ROOM_INDEX.airlock)) {
        this.phase = "won"; this.endT = 15;
        io.to(this.code).emit("mission", { phase: "won", text: `EINSATZ ERFOLGREICH — ${this.kills} Drohnen ausgeschaltet` });
      }
    }
  }

  updateDrones(dt) {
    const living = this.livingPlayers();
    for (const d of this.drones) {
      const dRoom = roomAt(d.p);
      // Ziel: nächster lebender Spieler, Sichtlinie bevorzugt
      let target = null, best = Infinity, seen = false;
      for (const pl of living) {
        const eye = [pl.p[0], pl.p[1] + 0.6, pl.p[2]];
        const dd = dist(d.p, eye);
        const los = dd < 30 && lineOfSight(d.p, eye);
        const score = dd - (los ? 100 : 0);
        if (score < best) { best = score; target = pl; seen = los; }
      }
      const acc = [0, 0, 0];
      if (target) {
        const tp = [target.p[0], target.p[1] + 0.6, target.p[2]];
        const to = [tp[0] - d.p[0], tp[1] - d.p[1], tp[2] - d.p[2]];
        const dd = Math.hypot(...to) || 1;
        d.yaw = Math.atan2(to[0], to[2]);
        if (seen) {
          const want = dd > 9 ? 1 : dd < 5 ? -1 : 0;
          d.strafeT -= dt;
          if (d.strafeT <= 0) { d.strafe *= -1; d.strafeT = rnd(1.2, 3); }
          const side = [to[2] / dd, 0, -to[0] / dd];
          for (let a = 0; a < 3; a++) acc[a] = (to[a] / dd) * want * 4 + side[a] * d.strafe * 2.5;
          // Schweben auf Kopfhöhe (im Schwerelos-Knoten frei)
          if (ROOMS[dRoom]?.gravity) acc[1] += (2.1 - d.p[1]) * 3;
          d.cd -= dt;
          if (d.cd <= 0 && dd < 30) {
            d.cd = rnd(1.5, 2.4);
            const tv = Math.hypot(...(target.v || [0, 0, 0]));
            const chance = Math.max(0.12, Math.min(0.6, 0.7 - dd * 0.025 - tv * 0.05));
            const hit = Math.random() < chance;
            const aim = hit ? tp : [tp[0] + rnd(-1.2, 1.2), tp[1] + rnd(-0.8, 0.8), tp[2] + rnd(-1.2, 1.2)];
            io.to(this.code).emit("droneShot", { from: d.p, to: aim, target: target.id, hit });
            if (hit) {
              this.hurtPlayer(target, 7, "drone");
              io.to(target.id).emit("hurt", { from: d.p, dmg: 7 });
            }
          }
        } else {
          // Navigation über den Raumgraphen
          const tr = roomAt(target.p);
          const door = nextDoorToward(dRoom, tr);
          const goal = door ? [door.x, 1.3, 0] : tp;
          const g = [goal[0] - d.p[0], goal[1] - d.p[1], goal[2] - d.p[2]];
          const gl = Math.hypot(...g) || 1;
          for (let a = 0; a < 3; a++) acc[a] = (g[a] / gl) * 5;
        }
      }
      // Sog durch Hüllenbruch
      const suck = this.suctionAt(d.p);
      for (let a = 0; a < 3; a++) acc[a] += suck.acc[a];
      for (let a = 0; a < 3; a++) {
        d.v[a] += acc[a] * dt;
        d.v[a] *= suck.active ? 0.995 : 0.93;
      }
      const sp = Math.hypot(...d.v), max = suck.active ? 18 : 4;
      if (sp > max) for (let a = 0; a < 3; a++) d.v[a] *= max / sp;
      const np = [d.p[0] + d.v[0] * dt, d.p[1] + d.v[1] * dt, d.p[2] + d.v[2] * dt];
      const r = resolveBox(np, DRONE_HALF);
      if (r) { d.p = r.pos; for (let a = 0; a < 3; a++) if (r.contact[a]) d.v[a] *= -0.3; }
      else d.v = [0, 0, 0];
      if (suck.spaced) d.spaced = suck.win;
    }
    // Ins All gesaugte Drohnen entfernen
    for (const d of this.drones.filter(x => x.spaced !== undefined)) {
      const w = this.windows[d.spaced];
      this.kills++;
      io.to(this.code).emit("droneDown", { id: d.id, p: d.p, how: "spaced", win: d.spaced });
      if (w.by) this.feed(`${w.by} hat eine Drohne ins All befördert`);
    }
    this.drones = this.drones.filter(x => x.spaced === undefined);
  }

  /** Sogbeschleunigung an Position p (für Drohnen; Clients rechnen identisch). */
  suctionAt(p) {
    const ri = roomAt(p);
    const out = { acc: [0, 0, 0], active: false, spaced: false, win: -1 };
    this.windows.forEach((w, i) => {
      if (w.state !== "breached" || WINDOWS[i].roomIdx !== ri) return;
      const W = WINDOWS[i];
      const to = [W.center[0] - p[0], W.center[1] - p[1], W.center[2] - p[2]];
      const dd = Math.hypot(...to) || 1;
      const fade = Math.max(0, 1 - w.t / RULES.breachSeconds) * 0.6 + 0.4;
      const s = RULES.suction * fade * Math.min(1.6, 6 / (dd + 1));
      for (let a = 0; a < 3; a++) out.acc[a] += (to[a] / dd) * s;
      out.active = true;
      const prox = windowProximity(W, p);
      if (prox.inRect && prox.dist < 0.8) { out.spaced = true; out.win = i; }
    });
    return out;
  }

  snapshot() {
    return {
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, p: p.p, yaw: p.yaw, pitch: p.pitch, hp: p.hp, alive: p.alive, v: p.v, fx: p.fx,
      })),
      drones: this.drones.map(d => ({ id: d.id, p: d.p, yaw: d.yaw, hp: d.hp })),
      windows: this.windows.map(w => ({ state: w.state, hp: w.hp, t: w.t })),
      phase: this.phase, progress: this.progress,
    };
  }
}

function newCode() {
  const C = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c;
  do c = Array.from({ length: 4 }, () => C[(Math.random() * C.length) | 0]).join(""); while (games.has(c));
  return c;
}

io.on("connection", socket => {
  let game = null, me = null;

  socket.on("join", ({ name, code } = {}, ack) => {
    if (typeof ack !== "function" || game) return;
    code = String(code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (!code) code = newCode();
    game = games.get(code);
    if (!game) { game = new Game(code); games.set(code, game); }
    if (game.players.size >= RULES.maxPlayers) { game = null; return ack({ error: "Einsatz ist voll (max. 4 Spieler)" }); }
    const used = new Set([...game.players.values()].map(p => p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    me = {
      id: socket.id, slot, name: String(name || "Astronaut").slice(0, 16), color: COLORS[slot],
      p: [...SPAWNS[slot]], v: [0, 0, 0], yaw: Math.PI / 2, pitch: 0, hp: RULES.playerHp, alive: true, respawnAt: 0, fx: 0,
    };
    game.players.set(socket.id, me);
    socket.join(code);
    ack({ ok: true, id: socket.id, code, color: me.color, spawn: me.p, phase: game.phase });
    game.feed(`${me.name} ist an Bord gekommen`);
  });

  socket.on("state", s => {
    if (!me || !me.alive || !s || !Array.isArray(s.p)) return;
    const p = s.p.map(Number);
    if (p.some(x => !Number.isFinite(x))) return;
    me.p = p; me.yaw = +s.yaw || 0; me.pitch = +s.pitch || 0;
    me.v = Array.isArray(s.v) ? s.v.map(Number) : [0, 0, 0];
    me.fx = s.fx | 0;
  });

  socket.on("fire", s => {
    if (!me || !me.alive || !s) return;
    socket.to(game.code).emit("tracer", { id: me.id, o: s.o, e: s.e });
    const h = s.hit;
    if (!h) return;
    if (h.type === "drone") {
      const d = game.drones.find(x => x.id === h.id);
      if (!d || dist(d.p, me.p) > 80) return;
      d.hp -= RULES.rifleDamage;
      if (d.hp <= 0) {
        game.drones = game.drones.filter(x => x !== d);
        game.kills++;
        io.to(game.code).emit("droneDown", { id: d.id, p: d.p, how: "shot", by: me.id });
      }
    } else if (h.type === "window") {
      const w = game.windows[h.id];
      if (!w || !WINDOWS[h.id]?.breachable || w.state !== "intact") return;
      w.hp -= RULES.rifleDamage;
      io.to(game.code).emit("windowHit", { win: h.id, hp: w.hp, pt: s.e });
      if (w.hp <= 0) game.breach(h.id, me.name);
    }
  });

  socket.on("interact", (_s, ack) => {
    if (!me || !me.alive || !game) return;
    if (game.phase === "explore" && dist(me.p, TERMINAL.pos) < TERMINAL.radius + 0.8) {
      game.phase = "upload"; game.waveT = 4;
      io.to(game.code).emit("mission", { phase: "upload", text: `${me.name} startet den Logbuch-Download — haltet das Kommandomodul!` });
      ack?.({ ok: true });
    }
  });

  socket.on("selfDamage", s => {
    if (!me || !me.alive) return;
    const amt = Math.max(0, Math.min(50, +s?.amt || 0));
    if (s?.cause === "spaced") return game.killPlayer(me, "spaced");
    game.hurtPlayer(me, amt, s?.cause === "o2" ? "o2" : "other");
  });

  socket.on("chat", text => {
    if (!me) return;
    io.to(game.code).emit("chat", { name: me.name, color: me.color, text: String(text).slice(0, 140) });
  });

  socket.on("disconnect", () => {
    if (!game || !me) return;
    game.players.delete(socket.id);
    game.feed(`${me.name} hat die Station verlassen`);
    io.to(game.code).emit("left", { id: socket.id });
    if (!game.players.size) games.delete(game.code);
  });
});

setInterval(() => {
  for (const g of games.values()) {
    g.update(TICK);
    io.to(g.code).emit("snap", g.snapshot());
  }
}, TICK * 1000);

server.listen(PORT, () => {
  console.log(`🛰  Orbital Breach läuft auf http://localhost:${PORT}`);
});

