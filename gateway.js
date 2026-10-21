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
import { statisch, cacheKoepfe } from "./statisch.js";
import http from "http";
import { spawn } from "child_process";
import net from "net";
import crypto from "crypto";
import httpProxy from "http-proxy";
import path from "path";
import fs from "fs";
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

/* ---------- Fremde Herkunft zulassen ----------
 * Dieselbe Regel wie in server.js. Sie muss hier stehen, weil die Runden-
 * verwaltung (/api/mode, /api/rooms, /api/stats) am Gateway haengt: Wird das
 * Spiel von einem Portal ausgeliefert, fragt der Client zuerst hier an — und
 * ohne Freigabe scheitert er, bevor er ueberhaupt eine Runde findet.
 *
 * Geprueft wird per Muster statt per Liste: CrazyGames laeuft unter Dutzenden
 * Laenderdomains und legt neue nach. Kein "*", sonst duerfte jede Seite im Netz
 * Runden auf diesem Server aufmachen. */
const CORS_EXTRA = String(process.env.CORS_EXTRA || "").split(",").map(x => x.trim()).filter(Boolean);
const PORTAL = /^https?:\/\/([a-z0-9-]+\.)*crazygames\.[a-z]{2,}(\.[a-z]{2,})?$/i;
function herkunftErlaubt(origin) {
  if (!origin) return true;                                   // gleiche Herkunft oder kein Browser
  if (PORTAL.test(origin)) return true;
  if (origin === "capacitor://app.crazygames.com") return true;
  return CORS_EXTRA.includes(origin);
}
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && herkunftErlaubt(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
/* Vom Dateistandort, nicht vom Arbeitsverzeichnis. Text komprimiert mit ETag,
 * Medien lange gecacht — siehe statisch.js. */
app.use(statisch(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "public"), { setHeaders: cacheKoepfe }));
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

async function raumErstellen(oeffentlich = false) {
  if (rooms.size >= MAX_ROOMS) throw new Error("Gerade sind schon so viele Runden gleichzeitig aktiv — bitte kurz später erneut versuchen.");
  const port = await freierPort();
  const code = neuerCode();
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const room = { proc, port, createdAt: Date.now(), lastActivity: Date.now(), oeffentlich: false };
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

app.post("/api/rooms", express.json(), async (req, res) => {
  try {
    const code = await raumErstellen();
    /* Oeffentlich heisst: taucht auf dem Startbildschirm auf und ist ohne Code
     * zu betreten. Der Code funktioniert weiterhin — er ist nur nicht mehr
     * noetig. Voreinstellung ist privat, damit eine Runde nicht versehentlich
     * fuer alle offensteht. */
    const room = rooms.get(code);
    if (room) room.oeffentlich = req.body?.oeffentlich === true;
    res.json({ code, oeffentlich: !!room?.oeffentlich });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});
/* Liste der oeffentlichen Runden. Das Gateway fragt dafuer jeden Kindprozess
 * einmal nach seinem Schaufenster. Der Startbildschirm ruft das im Sekundentakt
 * ab, deshalb ein kurzer Zwischenspeicher — sonst laeuft bei zwanzig Runden
 * jede Sekunde ein Schwall interner Anfragen los. */
let oeffentlicheListe = { zeit: 0, daten: [] };
app.get("/api/rooms/public", async (_req, res) => {
  if (Date.now() - oeffentlicheListe.zeit < 2500) return res.json(oeffentlicheListe.daten);
  const eintraege = await Promise.all([...rooms.entries()]
    .filter(([, r]) => r.oeffentlich)
    .map(async ([code, r]) => {
      try {
        const ctrl = new AbortController();
        const zu = setTimeout(() => ctrl.abort(), 900);
        const a = await fetch(`http://127.0.0.1:${r.port}/api/lobby`, { signal: ctrl.signal });
        clearTimeout(zu);
        if (!a.ok) return null;
        const l = await a.json();
        /* Beendete und volle Runden bleiben in der Liste, aber gekennzeichnet —
         * sonst verschwindet eine Runde vor den Augen dessen, der gerade
         * daraufklickt. */
        return { code, spieler: l.spieler, bots: l.bots || 0, max: l.max, host: l.host, namen: l.namen,
                 gestartet: l.started, beendet: l.beendet, mode: l.mode,
                 winGoal: l.winGoal, alter: Date.now() - r.createdAt };
      } catch { return null; }
    }));
  oeffentlicheListe = { zeit: Date.now(), daten: eintraege.filter(Boolean) };
  res.json(oeffentlicheListe.daten);
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
/* ---------- Adminpanel: Uebersicht aller Runden ----------
 * Das Gateway ist die einzige Stelle, die alle laufenden Runden kennt — die
 * Rundenprozesse wissen nichts voneinander. Der Schluessel ist derselbe wie in
 * den Rundenservern: ADMIN_KEY, sonst BUGS_KEY, sonst der feste Schlüssel. */
const ADMINKEY = process.env.ADMIN_KEY || process.env.BUGS_KEY || "79ce89d";
const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function adminSchluessel(req) {
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("key")) return u.searchParams.get("key");
  const m = String(req.headers.cookie || "").match(/(?:^|;\s*)csadmin=([^;]+)/);
  try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
}
const adminOk = req => !!ADMINKEY && adminSchluessel(req) === ADMINKEY;
const ADMIN_CSS = `body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#e3e9f4;margin:0;padding:26px}
*{box-sizing:border-box}h1{font-size:19px;margin:0 0 4px}
.sub{color:#8ea0bd;font-size:12.5px;margin-bottom:18px}
.karte{background:#111a2c;border:1px solid #22304a;border-radius:12px;padding:16px;margin-bottom:14px;max-width:1000px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#8ea0bd;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid #22304a}
td{padding:8px;border-bottom:1px solid #1a2337;vertical-align:middle}tr:last-child td{border-bottom:0}
.num{font-family:ui-monospace,Menlo,monospace;text-align:right;white-space:nowrap}
.code{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;letter-spacing:.12em;color:#38bdf8}
button{background:#38bdf8;color:#04121b;border:0;border-radius:7px;padding:6px 12px;font:600 12.5px system-ui;cursor:pointer}
button.warn{background:transparent;border:1px solid #4a2733;color:#fb7185}
input{background:#0b1220;border:1px solid #22304a;border-radius:7px;color:#e3e9f4;padding:6px 8px;font:inherit}
.pill{display:inline-block;background:#0b1220;border:1px solid #22304a;border-radius:20px;padding:3px 10px;font-size:11.5px;color:#8ea0bd;margin-right:6px}
a{color:#38bdf8}.ok{color:#34d399}
form.login{max-width:360px}form.login input{width:100%;margin:10px 0}`;
function adminLogin(res, hinweis) {
  res.status(hinweis ? 401 : 200).set("Content-Type", "text/html; charset=utf-8").end(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — Capital Sandbox</title>
<style>${ADMIN_CSS}</style><div class="karte"><h1>Adminpanel</h1><div class="sub">Bitte anmelden.</div>
${hinweis ? `<div class="sub" style="color:#fb7185">${escHtml(hinweis)}</div>` : ""}
<form class="login" method="post" action="/admin/login">
<input type="password" name="key" placeholder="Schlüssel" autofocus autocomplete="current-password">
<button type="submit">Anmelden</button></form></div>`);
}
const setzeCookie = res => res.setHeader("Set-Cookie",
  `csadmin=${encodeURIComponent(ADMINKEY)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);

app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  if (!ADMINKEY || String(req.body?.key || "") !== ADMINKEY) return adminLogin(res, "Falscher Schlüssel.");
  setzeCookie(res); res.redirect("/admin");
});
app.post("/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "csadmin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.redirect("/admin");
});
app.post("/admin/beenden/:code", (req, res) => {
  if (!adminOk(req)) return res.status(403).end("nicht angemeldet");
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (room) { try { room.proc.kill(); } catch {} }
  res.redirect("/admin");
});
app.get("/admin", async (req, res) => {
  if (!adminOk(req)) return adminLogin(res);
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("key")) { setzeCookie(res); return res.redirect("/admin"); }
  /* Jede Runde einmal nach ihrem Kurzstand fragen. Faellt eine nicht rechtzeitig
   * zurueck, wird sie trotzdem gelistet — nur eben ohne Zahlen. */
  const eintraege = await Promise.all([...rooms.entries()].map(async ([code, r]) => {
    let kurz = null;
    try {
      const ctrl = new AbortController();
      const zu = setTimeout(() => ctrl.abort(), 1200);
      const a = await fetch(`http://127.0.0.1:${r.port}/admin/api/kurz?key=${encodeURIComponent(ADMINKEY)}`,
        { signal: ctrl.signal });
      clearTimeout(zu);
      if (a.ok) kurz = await a.json();
    } catch {}
    return { code, r, kurz };
  }));
  const dauer = ms => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const zeilen = eintraege.map(({ code, r, kurz }) => `<tr>
      <td><span class="code">${escHtml(code)}</span><br>
        <span class="pill">Port ${r.port}</span>${kurz ? `<span class="pill">${kurz.started ? "läuft" : "Warteraum"}</span>` : `<span class="pill">keine Antwort</span>`}
        ${kurz?.winner ? `<span class="pill ok">beendet</span>` : ""}</td>
      <td class="num">${dauer(Date.now() - r.createdAt)}</td>
      <td class="num">${dauer(Date.now() - r.lastActivity)}</td>
      <td>${kurz ? (kurz.spieler.length
        ? kurz.spieler.map(s2 => `${escHtml(s2.name)}${s2.verbunden ? "" : " <span class='pill'>offline</span>"} <span class="num">${s2.netWorth.toLocaleString("de-DE")} $</span>`).join("<br>")
        : "<span class='pill'>leer</span>") : "—"}</td>
      <td><a href="/r/${escHtml(code)}/admin"><button type="button">Verwalten</button></a>
        <form method="post" action="/admin/beenden/${escHtml(code)}" style="display:inline"
              onsubmit="return confirm('Runde ${escHtml(code)} wirklich beenden? Alle Mitspieler fliegen raus.')">
          <button class="warn" type="submit">Beenden</button></form></td>
    </tr>`).join("");
  res.set("Content-Type", "text/html; charset=utf-8").end(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Runden — Adminpanel</title>
<style>${ADMIN_CSS}</style>
<h1>Laufende Runden</h1>
<div class="sub"><span class="pill">${rooms.size} von ${MAX_ROOMS}</span>
  <span class="pill">Leerlaufgrenze ${Math.round(IDLE_MS / 60000)} min</span>
  · <a href="/admin">neu laden</a>
  · <form method="post" action="/admin/logout" style="display:inline"><button class="warn" type="submit">Abmelden</button></form></div>
<div class="karte">${rooms.size
  ? `<table><tr><th>Code</th><th class="num">Alter</th><th class="num">Letzte Aktivität</th><th>Firmen</th><th>Aktionen</th></tr>${zeilen}</table>`
  : "<div class='sub'>Gerade läuft keine Runde.</div>"}</div>`);
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
