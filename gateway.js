/* ============================================================
 * Capital Sandbox — Gateway für mehrere gleichzeitige Runden
 * ============================================================
 * Bisher war server.js selbst der öffentliche Einstiegspunkt — und weil sein
 * gesamter Spielzustand (Karte, Firmen, Börse, Bots, Preise: G und MM) in
 * modulweiten Variablen liegt, kann pro laufendem Prozess immer nur EINE Runde
 * existieren. Zwei Gruppen, die dieselbe Adresse besuchen, wären zwangsläufig
 * in derselben Welt gelandet.
 *
 * Statt server.js selbst umzubauen (jede der ~30 Socket-Aktionen, den ganzen
 * Markt, die Bots — ein Umbau mit hohem Risiko, echte Wirtschaftslogik im
 * laufenden Betrieb kaputtzumachen), bekommt jede Runde hier ihren EIGENEN,
 * echten Node-Prozess: server.js bleibt zu 100 % unverändert, läuft aber
 * mehrfach gleichzeitig auf internen Ports, die niemand von außen sieht.
 *
 * Dieses Gateway ist der einzige öffentlich erreichbare Port. Es:
 *  - vergibt beim "Runde erstellen" einen 5-stelligen Code + startet dafür
 *    einen frischen server.js-Kindprozess auf einem freien internen Port,
 *  - leitet den kompletten Spielverkehr (Socket.io, inkl. WebSocket-Upgrade)
 *    unter dem Pfad /r/<CODE>/socket.io/... transparent an den passenden
 *    Kindprozess weiter — für den Browser sieht das aus wie eine normale
 *    Socket.io-Verbindung zur eigenen Adresse,
 *  - beendet Runden, die eine Weile niemand mehr benutzt, automatisch wieder.
 *
 * Start: node gateway.js   (bzw. "npm run gateway")
 * Für den lokalen Gebrauch (start.sh) ändert sich nichts — das bleibt der
 * einfache Einzelrunden-Modus mit WebRTC-Beitritt übers eigene Netz. */
import express from "express";
import http from "http";
import { spawn } from "child_process";
import net from "net";
import crypto from "crypto";
import httpProxy from "http-proxy";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_ROOMS = +process.env.MAX_ROOMS || 20;
const IDLE_MS = (+process.env.ROOM_IDLE_MIN || 20) * 60_000;   // Leerlauf, bevor eine Runde beendet wird
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";          // ohne verwechselbare Zeichen (I/1, O/0)

/* Eigene Kennung dieses Gateway-Prozesses — analog zu server.js' BOOT_ID, aber
 * unabhängig von einzelnen Runden (die kommen und gehen ständig). Der Client
 * nutzt sie, um das Intro-Video genau einmal je Gateway-Neustart zu zeigen,
 * statt bei jeder einzelnen neu erstellten Runde erneut. */
const GATEWAY_BOOT_ID = crypto.randomUUID();

const app = express();
app.use(express.static(path.join(__dirname, "public")));   // vom Dateistandort, nicht vom Arbeitsverzeichnis
app.get("/api/mode", (_req, res) => res.json({ multiroom: true, maxRooms: MAX_ROOMS, bootId: GATEWAY_BOOT_ID }));
/* Wie viele Runden gerade laufen — der Startbildschirm zeigt das an, damit
 * man sieht, ob überhaupt jemand spielt. Bewusst schlank gehalten, weil der
 * Client das im Sekundentakt abfragt. */
app.get("/api/stats", (_req, res) => res.json({ rooms: rooms.size, maxRooms: MAX_ROOMS }));

/* Das Gateway selbst betreibt keinen Socket.io-Server (das übernehmen die
 * Kindprozesse unter /r/<CODE>/) — die Client-Bibliothek, die server.js sonst
 * automatisch unter /socket.io/socket.io.js mitausliefert, gibt es hier also
 * nicht von selbst. Sie ist aber unabhängig vom jeweiligen Raum immer
 * identisch, deshalb reicht ein einziger statischer Export aus dem Paket. */
app.get("/socket.io/socket.io.js", (_req, res) =>
  res.sendFile(path.join(__dirname, "node_modules/socket.io/client-dist/socket.io.js")));

/* ---------- Raum-Verwaltung ---------- */
const rooms = new Map();   // code -> { proc, port, createdAt, lastActivity }

function freierPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
function neuerCode() {
  let code;
  do { code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
/* Wartet, bis der frisch gestartete Kindprozess wirklich Anfragen beantwortet —
 * sonst könnte der erste Verbindungsversuch des Beitretenden ins Leere laufen. */
function wartenBisBereit(port, versucheUebrig = 300) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/invite", timeout: 800 }, res => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (--versucheUebrig <= 0) return reject(new Error("Kindprozess wurde nicht rechtzeitig bereit"));
        setTimeout(tick, 200);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

async function raumErstellen() {
  if (rooms.size >= MAX_ROOMS) throw new Error("Gerade sind schon so viele Runden gleichzeitig aktiv — bitte kurz später erneut versuchen.");
  const port = await freierPort();
  const code = neuerCode();
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const room = { proc, port, createdAt: Date.now(), lastActivity: Date.now() };
  rooms.set(code, room);
  proc.stdout.on("data", d => process.stdout.write(`[Runde ${code}] ${d}`));
  proc.stderr.on("data", d => process.stderr.write(`[Runde ${code}] ${d}`));
  proc.on("exit", () => { if (rooms.get(code) === room) rooms.delete(code); });
  try {
    await wartenBisBereit(port);
  } catch (e) {
    try { proc.kill(); } catch {}
    rooms.delete(code);
    throw e;
  }
  return code;
}

app.post("/api/rooms", express.json(), async (_req, res) => {
  try {
    const code = await raumErstellen();
    res.json({ code });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
app.get("/api/rooms/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  res.json({ exists: rooms.has(code) });
});

/* ---------- Reverse-Proxy: /r/<CODE>/... an den passenden Kindprozess ---------- */
const proxy = httpProxy.createProxyServer({ ws: true, xfwd: true });
proxy.on("error", (_err, _req, res) => {
  try { res.writeHead?.(502, { "Content-Type": "text/plain" }); res.end?.("Runde nicht erreichbar — evtl. schon beendet."); } catch {}
});
const ROOM_PATH = /^\/r\/([A-Z0-9]{5})(\/.*)?$/i;

app.use((req, res, next) => {
  const m = ROOM_PATH.exec(req.url);
  if (!m) return next();
  const code = m[1].toUpperCase(), room = rooms.get(code);
  if (!room) { res.writeHead(404).end("Diese Runde gibt es nicht (mehr)."); return; }
  room.lastActivity = Date.now();
  req.url = m[2] || "/";   // Präfix abstreifen — der Kindprozess kennt nur den nackten Socket.io-Pfad
  proxy.web(req, res, { target: `http://127.0.0.1:${room.port}` });
});

const httpServer = http.createServer(app);
/* WebSocket-Upgrades laufen NICHT über Express — die müssen hier separat
 * abgefangen werden (Socket.io braucht das für den echten WebSocket-Transport,
 * nicht nur fürs anfängliche Long-Polling). */
httpServer.on("upgrade", (req, socket, head) => {
  const m = ROOM_PATH.exec(req.url);
  if (!m) { socket.destroy(); return; }
  const code = m[1].toUpperCase(), room = rooms.get(code);
  if (!room) { socket.destroy(); return; }
  room.lastActivity = Date.now();
  /* Nach diesem Upgrade läuft der komplette Spielverkehr direkt über diesen
   * einen durchgereichten TCP-Stream — Express/das "upgrade"-Event sehen ihn
   * nie wieder. Ohne diesen Listener bliebe lastActivity für den Rest der
   * Session auf dem Verbindungszeitpunkt stehen, und der Leerlauf-Timer
   * würde aktiv bespielte Runden trotzdem beenden. */
  socket.on("data", () => { room.lastActivity = Date.now(); });
  req.url = m[2] || "/";
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${room.port}` });
});

/* ---------- Aufräumen ---------- */
setInterval(() => {
  const jetzt = Date.now();
  for (const [code, room] of rooms) {
    if (jetzt - room.lastActivity > IDLE_MS) {
      console.log(`[Gateway] Runde ${code} seit ${Math.round(IDLE_MS / 60000)} min ohne Aktivität — wird beendet.`);
      try { room.proc.kill(); } catch {}
      rooms.delete(code);
    }
  }
}, 60_000);

function allesBeenden() {
  for (const room of rooms.values()) { try { room.proc.kill(); } catch {} }
  process.exit(0);
}
process.on("SIGINT", allesBeenden);
process.on("SIGTERM", allesBeenden);

httpServer.listen(PORT, () => {
  console.log(`Capital Sandbox Gateway → http://localhost:${PORT}`);
  console.log(`  Jede "Neue Runde starten" bekommt einen eigenen Code und eine eigene, isolierte Welt.`);
  console.log(`  Höchstens ${MAX_ROOMS} Runden gleichzeitig, Leerlauf-Grenze ${Math.round(IDLE_MS / 60000)} min.`);
});
