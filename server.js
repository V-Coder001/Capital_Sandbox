/* ============================================================
 * Capital Sandbox — autoritativer Game-Server (localhost:3000)
 * Single Source of Truth: Map, Orderbuch, Anleihen, Pfändung.
 * Keine NPCs — alle Orders, Bonds und Preise kommen von Spielern.
 * ============================================================ */
import express from "express";
import http from "http";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { statisch, cacheKoepfe } from "./statisch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

/* ---------- Fremde Herkunft zulassen ----------
 * Wird das Spiel von einem Portal ausgeliefert (die hosten nur die Dateien,
 * der Server bleibt unserer), kommt die Verbindung von deren Domain. Ohne
 * Freigabe weist Socket.io sie ab — es laesst von Haus aus nur dieselbe
 * Herkunft zu.
 *
 * Geprueft wird per MUSTER, nicht per Liste: CrazyGames laeuft unter Dutzenden
 * Laenderdomains (crazygames.com, .fr, .com.br, .co.id …) und legt neue nach.
 * Eine ausgeschriebene Liste waere am Tag ihrer Entstehung unvollstaendig und
 * faellt erst auf, wenn Spieler aus dem falschen Land nicht mehr hereinkommen.
 *
 * Kein "*": Mit Wildcard duerfte jede beliebige Seite im Netz eine Verbindung
 * zu diesem Spielserver aufbauen. Zusaetzliche Adressen (eigene Domain,
 * Testumgebung) kommen ueber CORS_EXTRA, kommagetrennt. */
const CORS_EXTRA = String(process.env.CORS_EXTRA || "").split(",").map(s => s.trim()).filter(Boolean);
/* crazygames.<tld> und beliebige Unterdomains davon; die TLD darf zweiteilig
 * sein (.com.br). Dazu die WebView der iOS-App, die eine capacitor-Herkunft hat. */
const PORTAL = /^https?:\/\/([a-z0-9-]+\.)*crazygames\.[a-z]{2,}(\.[a-z]{2,})?$/i;
function herkunftErlaubt(origin) {
  /* Ohne Origin-Kopf: gleiche Herkunft oder ein Client ohne Browser (unsere
   * Bots, Testskripte). Beides ist der bisherige, normale Fall. */
  if (!origin) return true;
  if (PORTAL.test(origin)) return true;
  if (origin === "capacitor://app.crazygames.com") return true;
  return CORS_EXTRA.includes(origin);
}
/* Dieselbe Regel fuer die /api-Aufrufe — der Client holt darueber Rundenliste,
 * Einladungslink und Bestenliste, und die laufen nicht ueber Socket.io. */
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

/* Vom Standort dieser Datei aus, nicht vom Arbeitsverzeichnis: Sonst liefert
 * der Server stillschweigend nichts aus, sobald er von woanders gestartet wird
 * — genau das ist beim Dev-Server passiert. */
app.use(statisch(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "public"), { setHeaders: cacheKoepfe }));

/* Einladungslink: LAN-IP ermitteln, optional öffentlicher Tunnel (npm run share) */
let publicUrl = null;
function lanUrls(port) {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces || [])
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
  return urls;
}
/* Kennung dieses Serverlaufs. Der Client merkt sich die zuletzt gesehene und
 * spielt das Intro nur, wenn sie sich geändert hat — also genau einmal je
 * "sh start.sh", nicht bei jedem Neuladen des Tabs. */
const BOOT_ID = crypto.randomUUID();
/* Kennzeichen fuer Bots — rein fuer die Anzeige, nicht fuer Sonderrechte. Es
 * entsteht in diesem Prozess und verlaesst ihn nie, ein fremder Client kann
 * sich also nicht als Bot ausgeben. Ohne die Unterscheidung zaehlt die Liste
 * der oeffentlichen Runden Bots als Mitspieler: "7/8" bei drei Menschen und
 * vier Bots liest sich wie eine fast volle Runde. */
const BOT_TOKEN = crypto.randomUUID();
app.get("/api/invite", (_req, res) => {
  /* hof: die Bestenliste für den Startbildschirm — dort gibt es noch keinen
   * Socket-Spielzustand, also kommt sie über diesen ohnehin geladenen Weg. */
  res.json({ urls: [ ...(publicUrl ? [publicUrl] : []), ...lanUrls(PORT) ], bootId: BOOT_ID, hof: HOF });
});
/* ---------- Bugreports ----------
 * Spieler melden Fehler mit Beschreibung und optionalem Screenshot; die
 * Meldungen landen als JSON-Zeilen plus Bilddateien im Ordner bugreports/.
 * Die Admin-Ansicht unter /bugs ist mit einem festen Schlüssel geschützt
 * (FESTER_SCHLUESSEL, überschreibbar per BUGS_KEY / ADMIN_KEY). */
const BUGDIR = path.join(__dirname, "bugreports");
fs.mkdirSync(BUGDIR, { recursive: true });
/* Fester Schlüssel für Bugreports und Adminpanel — bleibt über Neustarts und
 * Deploys gleich. Per Umgebungsvariable (ADMIN_KEY / BUGS_KEY) überschreibbar. */
const FESTER_SCHLUESSEL = "79ce89d";
const BUGKEY = process.env.BUGS_KEY || process.env.ADMIN_KEY || FESTER_SCHLUESSEL;
app.post("/api/bugreport", express.json({ limit: "8mb" }), (req, res) => {
  const text = String(req.body?.text || "").slice(0, 4000).trim();
  if (!text) return res.status(400).json({ error: "Beschreibung fehlt" });
  const id = Date.now() + "-" + crypto.randomBytes(3).toString("hex");
  let hatBild = false;
  const bild = req.body?.image;
  if (typeof bild === "string") {
    const m = bild.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (m && m[2].length < 8_000_000) {
      fs.writeFileSync(path.join(BUGDIR, id + "." + (m[1] === "jpeg" ? "jpg" : m[1])), Buffer.from(m[2], "base64"));
      hatBild = true;
    }
  }
  const eintrag = { id, ts: new Date().toISOString(), name: String(req.body?.name || "").slice(0, 40), text, bild: hatBild };
  fs.appendFileSync(path.join(BUGDIR, "reports.jsonl"), JSON.stringify(eintrag) + "\n");
  res.json({ ok: true });
});
const bugAuth = (req, res) => {
  if (req.query.key !== BUGKEY) { res.status(403).send("Zugriff verweigert — ?key=… fehlt oder ist falsch."); return false; }
  return true;
};
app.get("/bugs", (req, res) => {
  if (!bugAuth(req, res)) return;
  let zeilen = [];
  try {
    zeilen = fs.readFileSync(path.join(BUGDIR, "reports.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(z => JSON.parse(z));
  } catch {}
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bugreports — Capital Sandbox</title>
<style>body{font-family:system-ui;background:#0b1220;color:#e3e9f4;margin:0;padding:28px;max-width:900px}
h1{font-size:20px}.r{background:#111a2c;border:1px solid #22304a;border-radius:12px;padding:16px;margin:14px 0}
.meta{color:#8ea0bd;font-size:12px;margin-bottom:8px}img{max-width:100%;border-radius:8px;margin-top:10px;border:1px solid #22304a}
p{white-space:pre-wrap;margin:0;line-height:1.5}</style>
<h1>Bugreports (${zeilen.length})</h1>` +
    (zeilen.reverse().map(r =>
      `<div class="r"><div class="meta">${esc(r.ts)} · ${esc(r.name || "anonym")}</div><p>${esc(r.text)}</p>` +
      (r.bild ? `<img src="/bugs/img/${esc(r.id)}?key=${encodeURIComponent(BUGKEY)}" loading="lazy">` : "") + `</div>`
    ).join("") || "<p>Noch keine Meldungen.</p>"));
});
app.get("/bugs/img/:id", (req, res) => {
  if (!bugAuth(req, res)) return;
  const id = String(req.params.id).replace(/[^0-9a-f-]/g, "");
  for (const ext of ["png", "jpg", "webp"]) {
    const f = path.join(BUGDIR, id + "." + ext);
    if (fs.existsSync(f)) return res.sendFile(f);
  }
  res.status(404).end();
});

/* ---------- Adminpanel ----------
 * Eine Runde von aussen einsehen und eingreifen: Wer spielt mit, wie steht es,
 * und notfalls jemandem Geld oder Ware geben. Gedacht fuers Testen und fuer
 * den Fall, dass sich eine Partie festfaehrt — nicht als Spielmechanik.
 *
 * Anmeldung ueber denselben Schluessel wie die Bugreports: entweder aus
 * ADMIN_KEY, sonst aus BUGS_KEY, sonst aus der Datei bugreports/.key. Die
 * Rundenprozesse teilen sich diese Datei, es ist also fuer alle derselbe
 * Schluessel. Nach dem Anmelden liegt er in einem HttpOnly-Cookie, damit er
 * nicht in jeder Adresszeile und in keinem Verlauf steht. */
const ADMINKEY = process.env.ADMIN_KEY || BUGKEY;
const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function adminSchluessel(req) {
  if (req.query?.key) return String(req.query.key);
  const m = String(req.headers.cookie || "").match(/(?:^|;\s*)csadmin=([^;]+)/);
  try { return m ? decodeURIComponent(m[1]) : ""; } catch { return ""; }
}
const adminOk = req => !!ADMINKEY && adminSchluessel(req) === ADMINKEY;
const ADMIN_CSS = `body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#e3e9f4;margin:0;padding:26px}
*{box-sizing:border-box}h1{font-size:19px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#8ea0bd;margin:22px 0 8px;font-weight:600}
.sub{color:#8ea0bd;font-size:12.5px;margin-bottom:18px}
.karte{background:#111a2c;border:1px solid #22304a;border-radius:12px;padding:16px;margin-bottom:14px;max-width:1000px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:#8ea0bd;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid #22304a}
td{padding:7px 8px;border-bottom:1px solid #1a2337;vertical-align:middle}tr:last-child td{border-bottom:0}
.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;white-space:nowrap}
input,select{background:#0b1220;border:1px solid #22304a;border-radius:7px;color:#e3e9f4;padding:6px 8px;font:inherit;font-size:12.5px}
input[type=number]{width:104px;text-align:right}
button{background:#38bdf8;color:#04121b;border:0;border-radius:7px;padding:6px 12px;font:600 12.5px system-ui;cursor:pointer}
button:hover{filter:brightness(1.1)}button.geist{background:transparent;border:1px solid #22304a;color:#8ea0bd}
.pill{display:inline-block;background:#0b1220;border:1px solid #22304a;border-radius:20px;padding:3px 10px;font-size:11.5px;color:#8ea0bd;margin-right:6px}
.ok{color:#34d399}.warn{color:#fb7185}a{color:#38bdf8}
form.login{max-width:360px}form.login input{width:100%;margin:10px 0}`;
function adminLogin(res, hinweis, aktion = "admin/login") {
  res.status(hinweis ? 401 : 200).send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin — Capital Sandbox</title>
<style>${ADMIN_CSS}</style><div class="karte"><h1>Adminpanel</h1>
<div class="sub">Bitte anmelden.</div>
${hinweis ? `<div class="sub warn">${escHtml(hinweis)}</div>` : ""}
<form class="login" method="post" action="${aktion}">
  <input type="password" name="key" placeholder="Schlüssel" autofocus autocomplete="current-password">
  <button type="submit">Anmelden</button></form></div>`);
}
app.post("/admin/login", express.urlencoded({ extended: false }), (req, res) => {
  /* Bei Fehlschlag zeigt dieselbe Adresse (/…/admin/login) das Formular erneut —
   * das Ziel ist von dort aus "login", nicht "admin/login". */
  if (String(req.body?.key || "") !== ADMINKEY) return adminLogin(res, "Falscher Schlüssel.", "login");
  res.setHeader("Set-Cookie",
    `csadmin=${encodeURIComponent(ADMINKEY)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
  res.redirect("../admin");
});
app.post("/admin/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "csadmin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.redirect("../admin");
});
/* Eingriffe. Bewusst nur additiv (Geld/Ware geben, auch negativ) — nichts,
 * was den Rundenzustand strukturell zerlegen koennte. */
/* Der eigentliche Eingriff liegt in einer Funktion, nicht im HTTP-Handler:
 * Dieselbe Aktion kommt ueber zwei Wege herein — das Adminpanel im Browser und
 * das eingebaute Panel im Spiel. Zwei Kopien derselben Regeln wuerden
 * frueher oder spaeter auseinanderlaufen, und zwar genau bei der Pruefung, die
 * man in der einen Fassung nachtraegt und in der anderen vergisst. */
function adminEingriff({ pid, art, betrag, good, menge }) {
  /* Finanzamt-Konten der Stadt setzen (kein Spieler nötig) */
  if (art === "stadtkasse" || art === "reserve") {
    const v = Math.max(0, Math.round(+betrag));
    if (!Number.isFinite(v)) return { status: 400, error: "Betrag fehlt" };
    if (art === "stadtkasse") G.stadtkasse = v; else G.wettReserve = v;
    pushState();
    return { ok: true };
  }
  if (art === "stufe") {
    const i = Math.round(+betrag);
    if (!(i >= 0 && i < STEUER_STUFEN.length)) return { status: 400, error: "Stufe ungültig" };
    G.steuerStufe = i;
    io.emit("notice", { text: `Finanzamt: ${STUFE_TEXT[STEUER_STUFEN[i].key]} Börsengebühr jetzt ${Math.round(satzBoerse() * 1000) / 10} %, Gewinnsteuer ${Math.round(satzGewinn() * 1000) / 10} %.` });
    pushState();
    return { ok: true };
  }
  if (art === "projekt") {
    if (G.stadtprojekt) return { status: 400, error: "Es läuft schon ein Stadtprojekt" };
    if (stadtFrei() < 1000) return { status: 400, error: "Kaum Geld über dem Grundstock (20.000 $) — erst Geld setzen" };
    stadtprojektStarten(); pushState();
    return { ok: true };
  }
  const p = G.players[String(pid || "")];
  if (!p) return { status: 404, error: "Spieler unbekannt" };
  if (art === "geld") {
    betrag = Math.round(+betrag || 0);
    if (!betrag) return { status: 400, error: "Betrag fehlt" };
    p.cash = Math.max(0, p.cash + betrag);
    logTx(p, "Admin", betrag > 0 ? "Gutschrift durch die Verwaltung" : "Abbuchung durch die Verwaltung", betrag);
    io.emit("notice", { text: `Verwaltung: ${p.name} ${betrag > 0 ? "erhält" : "verliert"} ${Math.abs(betrag).toLocaleString("de-DE")} $.` });
  } else if (art === "ware") {
    good = String(good || "");
    menge = Math.round(+menge || 0);
    if (!GOODS[good]) return { status: 400, error: "Ware unbekannt" };
    if (!menge) return { status: 400, error: "Menge fehlt" };
    p.inv[good] = Math.max(0, (p.inv[good] || 0) + menge);
    logTx(p, "Admin", `${menge > 0 ? "+" : ""}${menge} ${GOODS[good].name} durch die Verwaltung`, 0);
  } else return { status: 400, error: "Unbekannte Aktion" };
  pushState();
  return { ok: true, cash: Math.round(p.cash) };
}

app.post("/admin/eingriff", express.json(), (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "nicht angemeldet" });
  const r = adminEingriff(req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
});

/* ---------- Schutz gegen Durchprobieren des Schluessels ----------
 * Der Schluessel ist zwoelf Hexzeichen. Ueber HTTP war das kaum angreifbar,
 * weil jeder Versuch eine eigene Anfrage kostet — ueber eine offene
 * Socket-Verbindung lassen sich dagegen Tausende Versuche pro Sekunde
 * durchjagen. Nach fuenf Fehlversuchen ist die Adresse eine Minute gesperrt.
 *
 * Gezaehlt wird je IP, nicht je Verbindung: Wer sich nach jedem Fehlversuch neu
 * verbindet, bekaeme sonst jedes Mal fuenf frische Versuche geschenkt. */
const ADMIN_MAX_FEHL = 5, ADMIN_SPERRE_MS = 60_000;
const adminVersuche = new Map();   // ip -> { fehl, bis }
/* Hinter dem Gateway ist die Gegenstelle immer der Proxy (127.0.0.1) — ohne
 * X-Forwarded-For teilten sich ALLE Spieler einen Zaehler, und fuenf
 * Fehlversuche eines Fremden sperrten den Wirt aus seinem eigenen Panel aus.
 * Das Gateway setzt den Kopf (xfwd), der erste Eintrag ist der urspruengliche
 * Client.
 *
 * Der Kopf ist faelschbar, wer den Server direkt erreicht, kann sich also einen
 * frischen Zaehler verschaffen. Das nimmt der Sperre etwas von ihrer Wirkung,
 * aber die Alternative waere eine Sperre, die zuverlaessig den Falschen trifft. */
function adminIp(sock) {
  const kopf = sock.handshake?.headers?.["x-forwarded-for"];
  const erster = String(kopf || "").split(",")[0].trim();
  return erster || sock.handshake?.address || "?";
}
function adminGesperrtBis(ip) {
  const v = adminVersuche.get(ip);
  if (!v?.bis) return 0;
  const rest = Math.ceil((v.bis - Date.now()) / 1000);
  return rest > 0 ? rest : 0;
}
function adminFehlversuch(ip) {
  const v = adminVersuche.get(ip) || { fehl: 0, bis: 0 };
  v.fehl++;
  if (v.fehl >= ADMIN_MAX_FEHL) { v.bis = Date.now() + ADMIN_SPERRE_MS; v.fehl = 0; }
  adminVersuche.set(ip, v);
  console.warn(`Adminpanel: Fehlversuch von ${ip}${v.bis ? " — jetzt gesperrt" : ""}`);
}
const adminVersucheLoeschen = ip => adminVersuche.delete(ip);

/* Die Sicht des Adminpanels auf die Runde. Bots stehen mit drin: Wenn eine
 * Runde sich festfaehrt, liegt es oft an ihnen, und dann will man sehen, wie
 * sie dastehen — eingreifen kann man bei ihnen genauso. */
function adminUebersicht() {
  return {
    runde: {
      modus: MODE, gestartet: G.started, sieger: G.winner, tick: G.tick,
      ziel: WIN_NW, hostId: G.hostId,
      /* Der Schluessel selbst geht NIE an den Client — er steht schon im
       * Serverprotokoll und im Adminpanel-Link, das reicht. */
    },
    spieler: Object.values(G.players).map(p => ({
      id: p.id, name: p.name, farbe: p.color, bot: !!p.bot,
      branche: INDUSTRIES[p.industry]?.name || p.industry,
      online: !!p.socketId, weg: !!p.disconnected,
      cash: Math.round(p.cash), nw: Math.round(netWorth(p)), rating: rating(p),
      gebaeude: G.map.filter(t => t.owner === p.id && t.btype).length,
    })).sort((a, b) => b.nw - a.nw),
    waren: Object.entries(GOODS).map(([k, g]) => ({ k, name: g.name })),
  };
}
/* Kurzfassung fuer die Rundenuebersicht im Gateway — es fragt jeden
 * Kindprozess einmal ab, statt selbst Spielzustand zu fuehren. */
app.get("/admin/api/kurz", (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "nicht angemeldet" });
  res.json({ started: G.started, mode: MODE, tick: G.tick, winGoal: WIN_NW,
    winner: G.winner ? (G.players[G.winner]?.name || true) : null,
    spieler: Object.values(G.players).map(p => ({ name: p.name, verbunden: !!p.socketId,
      cash: Math.round(p.cash), netWorth: Math.round(netWorth(p)) })) });
});
app.get("/admin", (req, res) => {
  if (!adminOk(req)) return adminLogin(res);
  /* Kam der Schluessel per ?key=, gleich in ein Cookie umwandeln und die
   * Adresszeile saeubern — sonst steht er im Verlauf und in jedem Screenshot. */
  if (req.query.key) {
    res.setHeader("Set-Cookie", `csadmin=${encodeURIComponent(ADMINKEY)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
    return res.redirect("admin");
  }
  const spieler = Object.values(G.players);
  const geld = n => Math.round(n).toLocaleString("de-DE") + " $";
  const zeilen = spieler.map(p => {
    const geb = G.map.filter(t => t.owner === p.id && t.btype).length;
    return `<tr>
      <td><b>${escHtml(p.name)}</b><br><span class="pill">${escHtml(INDUSTRIES[p.industry]?.name || p.industry)}</span>
        ${p.socketId ? '<span class="pill ok">verbunden</span>' : '<span class="pill">offline</span>'}</td>
      <td class="num">${geld(p.cash)}</td>
      <td class="num">${geld(netWorth(p))}</td>
      <td class="num">${rating(p)}</td>
      <td class="num">${geld(p.stats.steuern || 0)}${p.steuerSchuld > 0 ? `<br><span class="pill">${geld(p.steuerSchuld)} offen</span>` : ""}</td>
      <td class="num">${geb}</td>
      <td><input type="number" step="1000" value="10000" id="b-${escHtml(p.id)}">
        <button onclick="geld('${escHtml(p.id)}')">Geld geben</button></td>
      <td><select id="w-${escHtml(p.id)}">${Object.entries(GOODS).map(([k, g]) =>
          `<option value="${escHtml(k)}">${escHtml(g.name)}</option>`).join("")}</select>
        <input type="number" step="1" value="10" id="m-${escHtml(p.id)}" style="width:70px">
        <button class="geist" onclick="ware('${escHtml(p.id)}')">Geben</button></td>
    </tr>`;
  }).join("");
  const min = Math.floor(G.tick / 60), sek = G.tick % 60;
  res.send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Runde — Adminpanel</title>
<style>${ADMIN_CSS}</style>
<h1>Runde verwalten</h1>
<div class="sub">
  <span class="pill">${G.started ? "läuft" : "Warteraum"}</span>
  <span class="pill">Modus ${escHtml(MODE)}</span>
  <span class="pill">Laufzeit ${min}:${String(sek).padStart(2, "0")}</span>
  <span class="pill">Ziel ${geld(WIN_NW)}</span>
  <span class="pill">${spieler.length} Firmen</span>
  ${G.winner ? `<span class="pill ok">beendet</span>` : ""}
  · <a href="bugs?key=${encodeURIComponent(ADMINKEY)}">Bugreports</a>
  · <form method="post" action="admin/logout" style="display:inline"><button class="geist" type="submit">Abmelden</button></form>
</div>
<div class="karte">
  <h2>Finanzamt</h2>
  ${finanzamtAktiv() ? `<div class="sub">Steuern gesamt ${geld(G.steuernGesamt)} · nächster Steuertermin in ${Math.floor(G.nextDividendIn / 60)}:${String(G.nextDividendIn % 60).padStart(2, "0")}
    ${G.stadtprojekt ? ` · läuft: <b>${escHtml(G.stadtprojekt.name)}</b> (${Math.floor(G.stadtprojekt.ttl / 60)} min)` : ""}
    ${G.stadtprojekteFertig.length ? ` · gebaut: ${G.stadtprojekteFertig.map(f => escHtml(f.name)).join(", ")}` : ""}</div>
  <table><tr><th>Konto</th><th class="num">Stand</th><th>Setzen</th></tr>
    <tr><td>Stadtkasse</td><td class="num">${geld(G.stadtkasse)}</td><td><input type="number" step="1000" value="${Math.round(G.stadtkasse)}" id="fa-stadtkasse">
      <button onclick="konto('stadtkasse')">Setzen</button> <button class="geist" onclick="senden({ art: 'projekt' })">Stadtprojekt starten</button></td></tr>
    <tr><td>Bankreserve (Kurswetten)</td><td class="num">${geld(G.wettReserve)}</td><td><input type="number" step="1000" value="${Math.round(G.wettReserve)}" id="fa-reserve">
      <button onclick="konto('reserve')">Setzen</button></td></tr>
    <tr><td>Steuerlage <span class="sub">(Lage ${geld(stadtVermoegen())})</span></td><td class="num">${escHtml(steuerStufe().name)} · ×${steuerFaktor()}<br><span class="sub">Börse ${Math.round(satzBoerse() * 1000) / 10} % · Gewinn ${Math.round(satzGewinn() * 1000) / 10} % · Wette ${Math.round(satzWette() * 1000) / 10} %</span></td>
      <td><select id="fa-stufe">${STEUER_STUFEN.map((st, i) => `<option value="${i}"${i === (G.steuerStufe ?? 2) ? " selected" : ""}>${escHtml(st.name)} (×${st.faktor})</option>`).join("")}</select>
      <button onclick="senden({ art: 'stufe', betrag: document.getElementById('fa-stufe').value })">Setzen</button>
      <div class="sub">Wird jede Minute neu bewertet (max. eine Stufe pro Minute).</div></td></tr></table>`
  : `<div class="sub">Im Modus ${escHtml(MODE)} gibt es kein Finanzamt.</div>`}
</div>
<div class="karte">
  <h2>Firmen</h2>
  ${spieler.length ? `<table><tr><th>Firma</th><th class="num">Bargeld</th><th class="num">Nettovermögen</th>
    <th class="num">Rating</th><th class="num">Steuern</th><th class="num">Gebäude</th><th>Geld</th><th>Ware</th></tr>${zeilen}</table>`
    : "<div class='sub'>Noch niemand in dieser Runde.</div>"}
</div>
<script>
async function senden(nutzlast) {
  const r = await fetch("admin/eingriff", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nutzlast) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return alert(j.error || "Fehlgeschlagen");
  location.reload();
}
const geld = pid => senden({ art: "geld", pid, betrag: +document.getElementById("b-" + pid).value });
const konto = art => senden({ art, betrag: +document.getElementById("fa-" + art).value });
const ware = pid => senden({ art: "ware", pid,
  good: document.getElementById("w-" + pid).value, menge: +document.getElementById("m-" + pid).value });
</script>`);
});

/* Schaufenster einer Runde — ohne Anmeldung erreichbar, damit das Gateway die
 * Liste oeffentlicher Runden fuellen kann. Bewusst knapp: Firmennamen und
 * Spielerzahl sieht man ohnehin, sobald man beitritt. Nichts darueber hinaus. */
app.get("/api/lobby", (_req, res) => {
  const alle = Object.values(G.players);
  const menschen = alle.filter(p => !p.bot);
  res.json({
    started: G.started, mode: MODE, winGoal: WIN_NW, beendet: !!G.winner,
    /* Getrennt gezaehlt: Die Platzzahl gilt fuer Menschen. Bots stehen daneben,
     * damit "3/8" nicht wie eine fast volle Runde aussieht, nur weil vier Bots
     * mitspielen. */
    spieler: menschen.length, bots: alle.length - menschen.length, max: 8,
    host: menschen[0] ? menschen[0].name : null,
    namen: menschen.map(p => p.name),
    laufzeit: G.tick,
  });
});

/* ---------- Bestenliste ----------
 * Bleibt über Server-Neustarts erhalten (leaderboard.json neben server.js):
 * Am Ende jeder Runde landet jeder menschliche Spieler mit Firmenname,
 * Nettovermögen, Spieldauer und Modus in der Liste; gehalten werden die
 * zehn besten nach Nettovermögen. Der Startbildschirm zeigt sie als Ansporn. */
const HOF_DATEI = path.join(__dirname, "leaderboard.json");
let HOF = [];
try { HOF = JSON.parse(fs.readFileSync(HOF_DATEI, "utf8")); if (!Array.isArray(HOF)) HOF = []; } catch {}
function hofSpeichern() {
  for (const p of Object.values(G.players)) {
    if (p.bot) continue;
    const nw = Math.round(netWorth(p));
    if (nw < 1000) continue;
    HOF.push({ name: p.name, nw, minuten: Math.max(1, Math.round(G.tick / 60)),
      modus: MODE, sieger: p.name === G.winner, datum: new Date().toISOString().slice(0, 10) });
  }
  HOF.sort((a, b) => b.nw - a.nw);
  HOF = HOF.slice(0, 10);
  try { fs.writeFileSync(HOF_DATEI, JSON.stringify(HOF)); } catch {}
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: (origin, cb) => cb(null, herkunftErlaubt(origin)), credentials: false },
  /* Nachrichten ab 2 KB komprimiert über die Leitung (Socket.io hat das von Haus
   * aus aus). Der volle Stand beim Beitreten ist mit Karte ~200 KB JSON und
   * schrumpft so auf einen Bruchteil; kleine Teil-Stände bleiben unkomprimiert. */
  perMessageDeflate: { threshold: 2048 },
});

/* ---------- Stammdaten ---------- */
/* Produktionsschema:
 *  Enabler erzeugen Strom/Wasser/Öl → landen im Lager, sind börsenhandelbar.
 *  Produktionsgebäude haben eine Basisrate; jeder passende Boost-Rohstoff,
 *  der im Lager liegt, wird 1×/s verbraucht und boostet die Produktion.
 *  Vertriebsbüro: Bot-Kaufangebote über Erzeugnisse — farmen oder an der
 *  Börse kaufen, dann erfüllen. */
export const GOODS = {
  strom:    { name: "Strom", en: "Electricity",    cat: "Enabler", catEn: "Utilities" },
  wasser:   { name: "Wasser", en: "Water",   cat: "Enabler", catEn: "Utilities" },
  oel:      { name: "Öl", en: "Oil",       cat: "Enabler", catEn: "Utilities" },
  obst:     { name: "Obst", en: "Fruit",     cat: "Erzeugnisse", catEn: "Raw goods" },
  erze:     { name: "Erze", en: "Ore",     cat: "Erzeugnisse", catEn: "Raw goods" },
  kannabis: { name: "Kannabis", en: "Cannabis", cat: "Erzeugnisse", catEn: "Raw goods" },
  honig:    { name: "Honig", en: "Honey",    cat: "Erzeugnisse", catEn: "Raw goods" },
  silizium: { name: "Silizium", en: "Silicon", cat: "Erzeugnisse", catEn: "Raw goods" },
  saft:     { name: "Saft", en: "Juice",        cat: "Verarbeitet", catEn: "Processed" },
  stahl:    { name: "Stahl", en: "Steel",       cat: "Verarbeitet", catEn: "Processed" },
  medizin:  { name: "Medikamente", en: "Medicine", cat: "Verarbeitet", catEn: "Processed" },
  gebaeck:  { name: "Gebäck", en: "Pastry",      cat: "Verarbeitet", catEn: "Processed" },
  diesel:   { name: "Diesel", en: "Diesel",      cat: "Verarbeitet", catEn: "Processed" },
  uebernachtung: { name: "Übernachtung", en: "Lodging", cat: "Verarbeitet", catEn: "Processed" },
  munition: { name: "Munition", en: "Ammunition",  cat: "Verarbeitet", catEn: "Processed" },
  pistole:  { name: "Pistole", en: "Pistol",   cat: "Rüstung", catEn: "Armament" },
  panzer:   { name: "Panzer", en: "Tank",    cat: "Rüstung", catEn: "Armament" },
  ziegel:   { name: "Ziegel", en: "Bricks",      cat: "Baumaterial", catEn: "Building material" },
  beton:    { name: "Beton", en: "Concrete",       cat: "Baumaterial", catEn: "Building material" },
  elektronik: { name: "Elektronik", en: "Electronics", cat: "Baumaterial", catEn: "Building material" },
  benzinauto: { name: "Benzin-Auto", en: "Petrol car",  cat: "Fahrzeuge", catEn: "Vehicles" },
  dieselauto: { name: "Diesel-Auto", en: "Diesel car",  cat: "Fahrzeuge", catEn: "Vehicles" },
  eauto:      { name: "Elektro-Auto", en: "Electric car", cat: "Fahrzeuge", catEn: "Vehicles" },
  rennreifen:   { name: "Rennreifen", en: "Racing tyres",      cat: "Motorsport", catEn: "Motorsport" },
  rennsoftware: { name: "Rennsoftware", en: "Racing software", cat: "Motorsport", catEn: "Motorsport" },
  /* Illegale Waren (Kartellmodus): je Familie ein Produkt. Sie gehören weder
   * an die Börse noch in Läden — der einzige Absatzweg ist der Hehler. */
  schnaps:    { name: "Schwarzgebrannter", en: "Moonshine",             cat: "Illegal", catEn: "Illegal" },
  falschgeld: { name: "Falschgeld", en: "Counterfeit money",            cat: "Illegal", catEn: "Illegal" },
  goldbarren: { name: "Goldbarren", en: "Gold bars",                    cat: "Illegal", catEn: "Illegal" },
  zigaretten: { name: "Schmuggelzigaretten", en: "Contraband cigarettes", cat: "Illegal", catEn: "Illegal" },
};
const ILLEGAL = ["schnaps", "falschgeld", "goldbarren", "zigaretten"];
/* Strom und Elektronik kauft die Stadt im Online-Marktplatz nur gebremst —
 * beides brauchen die Firmen selbst. Gemessen gingen sonst rund die Hälfte des
 * Stroms (300–500 von 660 Einheiten je Minute) und die Hälfte der Elektronik an
 * Stadtkunden, während an der Börse dauerhaft Kaufgesuche offen blieben. Ganz
 * ohne Stadtkunden stapelten sich dagegen 9.000 Strom bei den Stadtwerken und
 * 790 Elektronik bei ChipWerke, und beide verloren 30–40 % Vermögen. */
const NUR_FIRMEN = [];
const STADT_FLOW_MAX = { strom: 2, elektronik: 0.15 };   // statt rund 8 bzw. 0,3
/* Stadtnetz: Notversorgung der Stadt an der Börse. Sie bietet Strom und
 * Elektronik als ganz normales Angebot an — aber deutlich über dem Grundpreis
 * und nur begrenzt nachgefüllt. Damit steht niemand völlig ohne da (frühes
 * Spiel, kein Versorger am Tisch), eigene Produktion bleibt trotzdem billiger. */
const STADTNETZ_ID = "stadtnetz";
const STADTNETZ = {
  strom:      { faktor: 1.6, proMin: 150, max: 300 },
  elektronik: { faktor: 1.5, proMin: 8,   max: 20 },
};
/* Fahrzeuge sind Endprodukte: hoher Stückwert, dafür langsame Fertigung und ein
 * eigener Absatzweg (Autohaus). Am Handelskontor wären sie mit dessen hoher
 * Grundrate ein Gelddrucker, deshalb sind sie dort ausgenommen. */
const VEHICLES = ["benzinauto", "dieselauto", "eauto"];
/* Rüstungsgüter laufen wie Fahrzeuge über einen eigenen Absatzweg. Am
 * Handelskontor mit seiner hohen Grundrate wäre ein Panzer zu 640 $ ein
 * Gelddrucker — derselbe Grund, aus dem Autos dort ausgenommen sind. */
const WEAPONS = ["pistole", "panzer"];
/* Preise so gesetzt, dass jede Veredelungsstufe echten Mehrwert schafft. Vorher
 * waren Ziegel (20) billiger als das Erz, aus dem sie entstehen (1,8 Erz = 28,8 $)
 * — Verarbeiten hat Wert VERNICHTET, und die Rohstoffindustrie, deren ganzes
 * Geschäft das Verarbeiten ist, konnte nicht gewinnen. */
const BASEP = { strom: 1.8, wasser: 1.4, oel: 8, obst: 7, erze: 16, kannabis: 45, honig: 14, silizium: 20,
                saft: 46, stahl: 115, medizin: 140, gebaeck: 70, diesel: 42, uebernachtung: 38, ziegel: 34, beton: 82, elektronik: 98,
                benzinauto: 300, dieselauto: 360, eauto: 440,
                munition: 26, pistole: 110, panzer: 420,
                /* Motorsport-Zulieferung: Vorleistungen für den Rennstall. Anders als
                 * Fahrzeuge und Rüstung bleiben sie am Handelskontor zugelassen — in den
                 * ersten Minuten einer Runde steht noch kein Rennstall, ohne Absatzweg
                 * wäre die Linie so lange tot. Ihr Stückwert liegt ohnehin in derselben
                 * Liga wie Stahl (115) und Medikamente (140), die dort seit jeher laufen. */
                rennreifen: 165, rennsoftware: 210,
                /* Illegale Ware: hoher Stückwert — der Reiz des Risikos. Der
                 * Hehler zahlt genau diesen Basispreis, ohne Marktdynamik. */
                schnaps: 90, falschgeld: 130, goldbarren: 260, zigaretten: 75 };

/* ---------- Kartellmodus: die vier Familien ----------
 * Feste Familien statt frei gegründeter Banden: Jede hat Farbe, EIN illegales
 * Produkt und EIN Produktionsgebäude, das nur ihre Mitglieder bauen können.
 * Die Familie wird im Warteraum gewählt; wer keine wählt (auch Bots), wird
 * beim Rundenstart reihum zugeteilt. Hehler-Verkäufe bringen der Familie
 * Respekt — die Währung des Modus. */
const FAMILIEN = {
  famiglia: { name: "La Famiglia",  farbe: "#e74c3c", produkt: "schnaps",    gebaeude: "destille" },
  syndikat: { name: "Das Syndikat", farbe: "#a78bfa", produkt: "falschgeld", gebaeude: "druckerei" },
  bratwa:   { name: "Die Bratwa",   farbe: "#f5c542", produkt: "goldbarren", gebaeude: "goldschmelze" },
  triade:   { name: "Die Triade",   farbe: "#2ecc71", produkt: "zigaretten", gebaeude: "schmuggellager" },
};
/* ---- Die Polizei: der Gegenspieler der Familien ----
 * Wählbar wie eine Familie (auch für KI), aber mit eigenen Regeln: Ihre
 * Gebäude zählen nie für Bezirkskontrolle, sie erpresst und überfällt nicht —
 * sie KONTROLLIERT Transporte (Beschlagnahme) und führt RAZZIEN gegen
 * kontrollierte Bezirke. Sold statt Schutzgeld; Sieg über Einsatzpunkte. */
const POLIZEI = { id: "polizei", name: "Die Polizei", farbe: "#4a90d9" };
const FAMILIE_MAX = 2;            // je Familie höchstens zwei Mitglieder (Mensch/Bot)
const POLIZEI_ZIEL = 25;          // Einsatzpunkte bis zum Polizei-Sieg
const RAZZIA_BEZIRK_CD = 90;      // Sekunden je Polizist zwischen Bezirks-Razzien
const POLIZEI_SOLD = 150;         // $ Sold je Minute und Polizist
const GESICHERT_DAUER = 60;       // so lange ist ein Bezirk nach einer Razzia „gesichert"
const famDef = fid => fid === "polizei" ? POLIZEI : FAMILIEN[fid];
const famAnzahl = fid => Object.values(G.players).filter(x => x.familie === fid).length;
const famMenschen = fid => Object.values(G.players).filter(x => x.familie === fid && !x.bot).length;
/* Ein echter Spieler verdrängt die KI: Ist die Familie nur wegen eines Bots
 * voll, packt der Bot seine Sachen — der Mensch übernimmt den Platz. */
function famBotVerdraengen(fid) {
  if (famAnzahl(fid) <= FAMILIE_MAX) return;
  const bot = Object.values(G.players).find(x => x.familie === fid && x.bot);
  if (!bot) return;
  for (let i = botHandles.length - 1; i >= 0; i--) {
    const h = botHandles[i];
    if (G.socketToPid[h.socket.id] === bot.id) {
      clearInterval(h.timer); h.socket.close(); botHandles.splice(i, 1);
    }
  }
  if (G.familienBoss?.[fid] === bot.id) delete G.familienBoss[fid];
  delete G.players[bot.id];
  io.emit("notice", { text: `${bot.name} macht Platz für einen echten Mafioso und verlässt die Stadt.` });
}
/* ---- Casino Municipale ----
 * Das städtische Casino steht fest an der Piazza. Es GEHÖRT niemandem —
 * es gehorcht dem, der die Piazza Grande (Bezirk 4) kontrolliert: Die
 * Herrscher-Familie kassiert den Bürger-Umsatz, stellt die Quoten, baut
 * Stufen aus und verkauft unterm Tisch heiße Ware ans Volk (besser als der
 * Hehler, OHNE Paten-Abgabe). Gewinne der Gäste zahlt die Familie — gedeckelt
 * durch ihre Kassen, damit ein Glückstreffer sie nicht ruiniert. */
const GCASINO_SPIELE = {
  rot:     { name: "Roulette · Rot/Schwarz", chance: .48,  faktor: 2 },
  zahl:    { name: "Roulette · Volle Zahl",  chance: .027, faktor: 30 },
  wuerfel: { name: "Hohe Neun (Würfel)",     chance: .40,  faktor: 2.4 },
  slots:   { name: "Slots „La Fortuna“",     chance: .15,  faktor: 6 },
  baccara: { name: "Baccara",                chance: .44,  faktor: 2.2 },
};
const GCASINO_STILE = ["Spelunke", "Salon Rosso", "Belle Époque", "Art déco", "La Dorata"];
const GCASINO_QUOTEN = {
  fair:         { name: "faire Quoten",   netto: 100, chanceDelta: 0,    respekt: 0, fahndung: 0 },
  gierig:       { name: "gierige Quoten", netto: 170, chanceDelta: -.03, respekt: 0, fahndung: 2 },
  grosszuegig:  { name: "großzügige Quoten", netto: 50, chanceDelta: .03, respekt: 1, fahndung: 0 },
};
const GCASINO_BEZIRK = 4;             // Piazza Grande
const GCASINO_EINSATZ_MAX = 2000;
const GCASINO_SCHWARZPREIS = 1.3;     // Faktor auf den Hehler-Basispreis
/* --- Wahrzeichen: ein interaktives Gebäude je Bezirk. Jeder kann es nutzen,
 * die Familie, die den Bezirk hält, verdient daran mit. --- */
const WZ_DEF = {
  kathedrale: { bezirk: 0, name: "Cattedrale",     icon: "\u26EA" },
  depot:      { bezirk: 1, name: "Frachtdepot",    icon: "\u{1F682}" },
  werft:      { bezirk: 2, name: "Alte Werft",     icon: "\u{1F3D7}" },
  markthalle: { bezirk: 3, name: "Markthalle",     icon: "\u{1F3DB}" },
  villa:      { bezirk: 5, name: "Villa del Capo", icon: "\u{1F3F0}" },
  kai:        { bezirk: 6, name: "Schmuggelkai",   icon: "\u2693" },
  yacht:      { bezirk: 7, name: "Yachtclub",      icon: "\u26F5" },
  brunnen:    { bezirk: 8, name: "Wunschbrunnen",  icon: "\u26F2" },
};
const wzHerr = b => G.bezirke?.[b]?.kontrolle || G.besatzung?.[b]?.familie || null;
/* Einnahmen eines Wahrzeichens an die kontrollierende Familie verteilen. */
function wzKasse(bezirk, betrag, quelle) {
  const fam = wzHerr(bezirk);
  if (!fam || betrag <= 0) return;
  const bank = Object.values(G.players).filter(m => m.familie === fam);
  const teil = Math.round(betrag / Math.max(1, bank.length));
  for (const m of bank) { m.cash += teil; logTx(m, "Kartell", `${quelle} (${BEZIRK_NAMEN[bezirk]})`, teil); }
}
/* Gewinne (Regatta) zahlt die kontrollierende Familie — gedeckelt wie im Casino. */
function wzGewinn(p, bezirk, brutto, quelle) {
  const fam = wzHerr(bezirk);
  const bank = fam ? Object.values(G.players).filter(m => m.familie === fam) : [];
  if (!bank.length) { p.cash += brutto; logTx(p, "Kartell", quelle, brutto); return brutto; }
  let offen = brutto;
  for (const m of bank) {
    const teil = Math.min(m.cash, Math.ceil(offen / Math.max(1, bank.length)));
    m.cash -= teil; offen -= teil;
    logTx(m, "Kartell", `Auszahlung an ${p.name} (${quelle})`, -teil);
    if (offen <= 0) break;
  }
  const gezahlt = brutto - Math.max(0, offen);
  p.cash += gezahlt; logTx(p, "Kartell", quelle, gezahlt);
  return gezahlt;
}

/* Eine Wahrzeichen-Aktion — Spieler (Socket) und Bots (Tick) gehen durch dieselbe Tür. */
function wzAktion(p, { art, betrag, good, qty, yacht }) {
  const def = WZ_DEF[art];
  if (!def) return { error: "Dieses Wahrzeichen kennt die Stadt nicht" };
  const bez = def.bezirk;
  betrag = Math.floor(+betrag) || 0;

  if (art === "kathedrale") {
    if (p.familie === "polizei") return { error: "Der Commissario spendet dienstlich nicht" };
    if (!(betrag >= 100 && betrag <= 2000)) return { error: "Spende zwischen 100 und 2000 $" };
    if (p.cash < betrag) return { error: "Zu wenig Bargeld" };
    p.cash -= betrag;
    logTx(p, "Kartell", "Spende an die Cattedrale", -betrag);
    G.fahndung[p.familie] = Math.max(0, (G.fahndung[p.familie] || 0) - betrag / 200);
    const respekt = Math.round(betrag / 300);
    G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + respekt;
    wzKasse(bez, Math.round(betrag * .2), "Kollekte der Cattedrale");
    return { ok: true, text: `Der Priester nickt — die Akten werden dünner. −${(betrag / 200).toFixed(1)} Fahndung, +${respekt} Respekt.` };
  }
  if (art === "depot") {
    if (!GOODS[good] || ILLEGAL.includes(good)) return { error: "Das Depot liefert nur saubere Ware" };
    qty = Math.min(50, Math.max(1, Math.floor(+qty) || 10));
    const marktwert = Math.round(qty * MM[good].price);
    const preis = Math.round(marktwert * 1.2);
    if (p.cash < preis) return { error: `Expressfracht kostet ${preis} $` };
    p.cash -= preis;
    p.inv[good] = (p.inv[good] || 0) + qty;
    logTx(p, "Kartell", `Expressfracht: ${qty}× ${GOODS[good].name}`, -preis);
    wzKasse(bez, preis - marktwert, "Frachtmarge des Depots");
    return { ok: true, text: `Der Zug pfeift — ${qty}× ${GOODS[good].name} liegen im Lager (${preis} $).` };
  }
  if (art === "werft") {
    if (p.cash < 500) return { error: "Schrott ausschlachten kostet 500 $" };
    p.cash -= 500;
    const ziegel = 8 + Math.floor(Math.random() * 13), beton = 2 + Math.floor(Math.random() * 5);
    p.inv.ziegel = (p.inv.ziegel || 0) + ziegel;
    p.inv.beton = (p.inv.beton || 0) + beton;
    logTx(p, "Kartell", `Alte Werft: Schrott ausgeschlachtet (+${ziegel} Ziegel, +${beton} Beton)`, -500);
    wzKasse(bez, 500, "Werftgebühr");
    return { ok: true, text: `Die Jungs schleppen an: +${ziegel} Ziegel, +${beton} Beton.` };
  }
  if (art === "markthalle") {
    if (!GOODS[good] || ILLEGAL.includes(good)) return { error: "In der Halle zählt nur legale Ware" };
    qty = Math.min(Math.floor(p.inv[good] || 0), Math.max(1, Math.floor(+qty) || Math.floor(p.inv[good] || 0)));
    if (qty <= 0) return { error: `Kein ${GOODS[good].name} im Lager` };
    const brutto = Math.round(qty * MM[good].price * 1.15);
    const gebuehr = Math.round(brutto * .05);
    p.inv[good] -= qty; p.cash += brutto - gebuehr;
    logTx(p, "Kartell", `Großmarkt-Deal: ${qty}× ${GOODS[good].name} (+15 %, −5 % Standgebühr)`, brutto - gebuehr);
    wzKasse(bez, gebuehr, "Standgebühr der Markthalle");
    return { ok: true, text: `Deal! ${brutto - gebuehr} $ für ${qty}× ${GOODS[good].name}.` };
  }
  if (art === "villa") {
    if (p.familie === "polizei") return { error: "Der Capo verhandelt nicht mit der Questura" };
    if (p.cash < 800) return { error: "Ein Gefallen des Capo kostet 800 $ Tribut" };
    p.cash -= 800;
    logTx(p, "Kartell", "Tribut in der Villa del Capo", -800);
    wzKasse(bez, 800, "Tribut an den Capo");
    const kampf = Object.entries(G.revierKaempfe || {}).find(([, k]) => k.punkte?.[p.familie] != null);
    if (kampf) {
      kampf[1].punkte[p.familie] += 2;
      return { ok: true, text: `Der Capo schickt zwei Schränke — +2 Punkte im Kampf um den ${BEZIRK_NAMEN[+kampf[0]]}.` };
    }
    G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + 3;
    return { ok: true, text: "Der Capo legt ein gutes Wort ein — +3 Respekt für deine Familie." };
  }
  if (art === "kai") {
    if (p.familie === "polizei") return { error: "Die Questura schmuggelt nicht — offiziell" };
    if (!ILLEGAL.includes(good)) return { error: "Am Kai zählt nur heiße Ware" };
    qty = Math.min(Math.floor(p.inv[good] || 0), Math.max(1, Math.floor(+qty) || Math.floor(p.inv[good] || 0)));
    if (qty <= 0) return { error: `Kein ${GOODS[good].name} im Lager` };
    const erloes = Math.round(qty * BASEP[good] * 1.4);
    const zoll = Math.round(erloes * .1);
    p.inv[good] -= qty; p.cash += erloes - zoll;
    G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 3;
    logTx(p, "Kartell", `Nachtschmuggel am Kai: ${qty}× ${GOODS[good].name} (140 %, −10 % Zoll)`, erloes - zoll);
    wzKasse(bez, zoll, "Hafenzoll");
    questProg(p, "hehler");
    return { ok: true, text: `Das Boot legt ab — ${erloes - zoll} $, keine Paten-Abgabe. Aber die Questura hört Motoren (+3 Fahndung).` };
  }
  if (art === "yacht") {
    yacht = Math.floor(+yacht);
    if (!(yacht >= 1 && yacht <= 3)) return { error: "Setz auf Yacht 1, 2 oder 3" };
    if (!(betrag >= 100 && betrag <= 1000)) return { error: "Einsatz zwischen 100 und 1000 $" };
    if (p.cash < betrag) return { error: "Zu wenig Bargeld" };
    p.cash -= betrag;
    logTx(p, "Kartell", `Regatta-Wette auf Yacht ${yacht}`, -betrag);
    wzKasse(bez, betrag, "Wetteinnahme des Yachtclubs");
    const sieger = 1 + Math.floor(Math.random() * 3);
    if (sieger === yacht) {
      const gezahlt = wzGewinn(p, bez, Math.round(betrag * 2.7), "Regatta gewonnen");
      return { ok: true, gewonnen: true, sieger, betrag: gezahlt };
    }
    return { ok: true, gewonnen: false, sieger, betrag };
  }
  if (art === "brunnen") {
    if (!(betrag >= 50 && betrag <= 500)) return { error: "Münzen zwischen 50 und 500 $" };
    if (p.cash < betrag) return { error: "Zu wenig Bargeld" };
    p.cash -= betrag; G.brunnenPot += betrag;
    logTx(p, "Kartell", "Münze in den Wunschbrunnen", -betrag);
    if (Math.random() < .07 && G.brunnenPot > betrag * 2) {
      const fang = Math.round(G.brunnenPot * .7);
      G.brunnenPot -= fang; p.cash += fang;
      logTx(p, "Kartell", "Der Brunnen erhört dich!", fang);
      io.emit("notice", { text: `\u26F2 ${p.name} fischt den Wunschbrunnen leer — ${fang} $!` });
      if (fang >= 3000) io.emit("gcasinoEreignis", { art: "grossgewinn", name: p.name, betrag: fang });
      return { ok: true, jackpot: fang, pot: G.brunnenPot };
    }
    return { ok: true, pot: G.brunnenPot };
  }
  return { error: "Diese Aktion kennt das Wahrzeichen nicht" };
}

/* ---- Familien-Hierarchie: Oberhaupt, Capos, Rekruten, Kasse, Soldaten ----
 * Das Oberhaupt verwaltet die Familienkasse, stellt den Tributsatz ein und
 * heuert Soldaten an — Bürger, die ausschließlich um Bezirke kämpfen. */
const famMitglieder = fid => Object.values(G.players).filter(x => x.familie === fid);
const famBoss = fid => G.familienBoss[fid] && G.players[G.familienBoss[fid]]?.familie === fid
  ? G.familienBoss[fid] : null;
const famRang = p => p.familie && famBoss(p.familie) === p.id ? "oberhaupt" : (G.familienRang[p.id] || "rekrut");
function familienPflegen() {
  for (const fid of Object.keys(FAMILIEN)) {
    G.familienBank[fid] ??= 0;
    G.familienTribut[fid] ??= .10;
    G.soldaten[fid] ??= 0;
    if (!famBoss(fid)) {
      /* Boss fehlt: bevorzugt ein Mensch, sonst das erste Mitglied. */
      const mit = famMitglieder(fid);
      const neu = mit.find(m => !m.bot) || mit[0];
      if (neu) {
        G.familienBoss[fid] = neu.id;
        io.emit("notice", { text: `\u{1F396} ${neu.name} führt jetzt ${FAMILIEN[fid].name} als Oberhaupt.` });
      }
    }
  }
  /* Tribut: Jede Minute zahlen alle außer dem Oberhaupt ihren Satz in die Kasse. */
  if (G.tick % 60 === 0) for (const fid of Object.keys(FAMILIEN)) {
    const satz = G.familienTribut[fid] || 0;
    if (!satz) continue;
    for (const m of famMitglieder(fid)) {
      if (m.id === famBoss(fid)) continue;
      const tribut = Math.floor(m.cash * satz);
      if (tribut < 10) continue;
      m.cash -= tribut;
      G.familienBank[fid] += tribut;
      logTx(m, "Kartell", `Tribut an die Familienkasse (${Math.round(satz * 100)} %)`, -tribut);
    }
  }
  /* Bot-Oberhäupter regieren — jede Familie mit eigener Strategie:
   * Triade & Bratwa rüsten für die Vendetta, La Famiglia hortet fürs
   * Imperium, das Syndikat spielt ausgewogen. */
  for (const fid of Object.keys(FAMILIEN)) {
    const bossId = famBoss(fid), boss = bossId && G.players[bossId];
    if (!boss?.bot) continue;
    const krieger = fid === "triade" || fid === "bratwa";
    const hortet = fid === "famiglia";
    const soldatChance = krieger ? .025 : hortet ? .004 : .01;
    if (G.familienBank[fid] >= SOLDAT_KOSTEN + 400 && G.soldaten[fid] < SOLDATEN_MAX && Math.random() < soldatChance)
      famSoldatKaufen(fid);
    else if (!hortet && G.familienBank[fid] > 4000 && Math.random() < .004) famAusschuetten(fid);
  }
}
const SOLDAT_KOSTEN = 600, SOLDATEN_MAX = 5;
function famSoldatKaufen(fid) {
  if (G.familienBank[fid] < SOLDAT_KOSTEN || G.soldaten[fid] >= SOLDATEN_MAX) return false;
  G.familienBank[fid] -= SOLDAT_KOSTEN;
  G.soldaten[fid]++;
  io.emit("notice", { text: `\u{1F94A} ${FAMILIEN[fid].name} heuert einen Soldaten an (${G.soldaten[fid]}/${SOLDATEN_MAX}) — mehr Schlagkraft in Revierkämpfen.` });
  return true;
}
function famAusschuetten(fid) {
  const mit = famMitglieder(fid);
  if (!mit.length || G.familienBank[fid] < mit.length) return 0;
  const teil = Math.floor(G.familienBank[fid] / mit.length);
  for (const m of mit) { m.cash += teil; logTx(m, "Kartell", "Ausschüttung aus der Familienkasse", teil); }
  G.familienBank[fid] -= teil * mit.length;
  return teil;
}
/* Startpunkte im Revierkampf: Größe der Familie plus Soldaten. */
const kampfStart = (fid, angreifer) =>
  (angreifer ? 1 : 0) + Math.min(3, famMitglieder(fid).length) + Math.min(3, G.soldaten[fid] || 0);

/* Wer führt das Haus? Die Familie, die die Piazza kontrolliert — und während
 * dort gekämpft wird, läuft der Laden beim Besatzer bzw. Verteidiger weiter:
 * Das Casino schließt erst, wenn die Piazza wirklich verloren oder verwaist ist. */
const gcasinoHerrscher = () =>
  G.bezirke?.[GCASINO_BEZIRK]?.kontrolle
  || G.besatzung?.[GCASINO_BEZIRK]?.familie
  || G.revierKaempfe?.[GCASINO_BEZIRK]?.verteidiger
  || null;

/* --- Live-Spieltische: gemeinsames Roulette-Rad & Blackjack-Tisch ---
 * Ergebnisse würfelt der Server; die Clients animieren nur, was feststeht. */
const GROULETTE_ROT = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const KARTEN_WERTE = ["2","3","4","5","6","7","8","9","10","B","D","K","A"];
const karteZiehen = () => {
  const i = Math.floor(Math.random() * 13), f = "\u2660\u2665\u2666\u2663"[Math.floor(Math.random() * 4)];
  return { txt: KARTEN_WERTE[i] + f, rot: f === "\u2665" || f === "\u2666",
    bj: i <= 7 ? i + 2 : i === 12 ? 11 : 10,
    bac: i <= 7 ? i + 2 : i === 12 ? 1 : 0 };
};
const bjSumme = karten => {
  let s = karten.reduce((a, k) => a + k.bj, 0), asse = karten.filter(k => k.bj === 11).length;
  while (s > 21 && asse-- > 0) s -= 10;
  return s;
};
const bacSumme = karten => karten.reduce((a, k) => a + k.bac, 0) % 10;

/* Poker braucht ein echtes Deck (keine doppelten Karten) und eine Handwertung. */
const deckNeu = () => {
  const d = [];
  for (let i = 0; i < 13; i++) for (const f of "\u2660\u2665\u2666\u2663") d.push({
    txt: KARTEN_WERTE[i] + f, rot: f === "\u2665" || f === "\u2666", f, w: i + 2,
    bj: i <= 7 ? i + 2 : i === 12 ? 11 : 10, bac: i <= 7 ? i + 2 : i === 12 ? 1 : 0 });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
};
const POKER_RAENGE = ["H\u00f6chste Karte", "Paar", "Zwei Paare", "Drilling", "Stra\u00dfe", "Flush", "Full House", "Vierling", "Straight Flush"];
function pokerWert(karten) {   // 7 Karten -> Score-Array, lexikografisch vergleichbar
  const ws = karten.map(k => k.w);
  const byW = {}; for (const w of ws) byW[w] = (byW[w] || 0) + 1;
  const byF = {}; for (const k of karten) (byF[k.f] = byF[k.f] || []).push(k.w);
  const desc = a => [...a].sort((x, y) => y - x);
  const strasseHoch = vals => {
    const u = [...new Set(vals)].sort((a, b) => b - a);
    if (u[0] === 14) u.push(1);
    let run = 1;
    for (let i = 1; i < u.length; i++) { if (u[i] === u[i - 1] - 1) { run++; if (run >= 5) return u[i] + 4; } else run = 1; }
    return 0;
  };
  let flush = null; for (const f in byF) if (byF[f].length >= 5) flush = desc(byF[f]);
  const sf = flush ? strasseHoch(flush) : 0;
  if (sf) return [8, sf];
  const grp = Object.entries(byW).map(([w, n]) => [n, +w]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (grp[0][0] === 4) return [7, grp[0][1], desc(ws.filter(w => w !== grp[0][1]))[0]];
  if (grp[0][0] === 3 && grp[1] && grp[1][0] >= 2) return [6, grp[0][1], grp[1][1]];
  if (flush) return [5, ...flush.slice(0, 5)];
  const st = strasseHoch(ws); if (st) return [4, st];
  if (grp[0][0] === 3) return [3, grp[0][1], ...desc(ws.filter(w => w !== grp[0][1])).slice(0, 2)];
  if (grp[0][0] === 2 && grp[1] && grp[1][0] === 2)
    return [2, grp[0][1], grp[1][1], desc(ws.filter(w => w !== grp[0][1] && w !== grp[1][1]))[0]];
  if (grp[0][0] === 2) return [1, grp[0][1], ...desc(ws.filter(w => w !== grp[0][1])).slice(0, 3)];
  return [0, ...desc(ws).slice(0, 5)];
}
const pokerVergleich = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
const kartePub = k => ({ txt: k.txt, rot: k.rot });

/* Einsatz wandert in die Familienkasse; Gewinne zahlt die Familie — anteilig,
 * gedeckelt auf das, was da ist (sonst gibt es Spott und Respektverlust). */
function gcasinoEinsatz(p, einsatz, quelle) {
  const herr = gcasinoHerrscher();
  const bank = Object.values(G.players).filter(m => m.familie === herr);
  p.cash -= einsatz;
  const teil = Math.round(einsatz / Math.max(1, bank.length));
  for (const m of bank) { m.cash += teil; logTx(m, "Casino", `Spieleinnahme (${quelle})`, teil); }
  logTx(p, "Casino", `Einsatz im Casino Municipale (${quelle})`, -einsatz);
}
function gcasinoGewinn(p, brutto, quelle) {
  const herr = gcasinoHerrscher();
  const bank = herr ? Object.values(G.players).filter(m => m.familie === herr) : [];
  if (!bank.length) {
    /* Die Piazza ist gerade herrenlos: Laufende Runden spielt "die Stadt" zu
     * Ende — voller Gewinn, niemandem tut es weh. */
    p.cash += brutto;
    logTx(p, "Casino", `Gewinn im Casino Municipale (${quelle})`, brutto);
    return brutto;
  }
  let offen = brutto;
  for (const m of bank) {
    const teil = Math.min(m.cash, Math.ceil(offen / Math.max(1, bank.length)));
    m.cash -= teil; offen -= teil;
    logTx(m, "Casino", `Auszahlung an ${p.name} (${quelle})`, -teil);
    if (offen <= 0) break;
  }
  const gezahlt = brutto - Math.max(0, offen);
  p.cash += gezahlt;
  logTx(p, "Casino", `Gewinn im Casino Municipale (${quelle})`, gezahlt);
  if (offen > 0) {
    G.familienRespekt[herr] = Math.max(0, (G.familienRespekt[herr] || 0) - 3);
    io.emit("notice", { text: `\u{1F3B0} ${p.name} sprengt die Bank — ${famDef(herr).name} kann nicht voll auszahlen (−3 Respekt)!` });
    io.emit("gcasinoEreignis", { art: "gesprengt", name: p.name, betrag: gezahlt });
  } else if (brutto >= 3000) {
    io.emit("notice", { text: `\u{1F3B0} Großer Abend im Casino Municipale: ${p.name} gewinnt ${brutto} $ bei ${quelle}.` });
    io.emit("gcasinoEreignis", { art: "grossgewinn", name: p.name, betrag: brutto });
  }
  return gezahlt;
}

const bjSitzNeu = (p, einsatz) => ({ pid: p.id, name: p.name, farbe: p.color, einsatz, einsatz2: 0,
  karten: [], karten2: null, aktiv: 1, fertig: false, fertig2: false, ergebnis: null });
const bjSitzFertig = s => s.fertig && (!s.karten2 || s.fertig2);
/* Eine Aktion auf der gerade aktiven Hand — vom Spieler wie vom Bot benutzt. */
function gblackjackAktion(p, s, aktion) {
  const B = G.gblackjack;
  const hand = s.aktiv === 2 ? s.karten2 : s.karten;
  const handZu = () => { if (s.aktiv === 1) { s.fertig = true; if (s.karten2 && !s.fertig2) { s.aktiv = 2; return; } } else s.fertig2 = true; };
  if (aktion === "hit") {
    hand.push(karteZiehen());
    if (bjSumme(hand) >= 21) handZu();
  } else if (aktion === "double") {
    if (hand.length !== 2) return { error: "Verdoppeln geht nur mit den ersten zwei Karten" };
    const grund = s.aktiv === 2 ? s.einsatz2 : s.einsatz;
    if (p.cash < grund) return { error: "Zu wenig Bargeld zum Verdoppeln" };
    gcasinoEinsatz(p, grund, "Blackjack (verdoppelt)");
    if (s.aktiv === 2) s.einsatz2 *= 2; else s.einsatz *= 2;
    hand.push(karteZiehen());
    handZu();
  } else if (aktion === "split") {
    if (s.aktiv !== 1 || s.karten2 || s.karten.length !== 2 || s.karten[0].bj !== s.karten[1].bj)
      return { error: "Splitten geht nur mit einem Paar als erste Hand" };
    if (p.cash < s.einsatz) return { error: "Zu wenig Bargeld zum Splitten" };
    gcasinoEinsatz(p, s.einsatz, "Blackjack (Split)");
    s.einsatz2 = s.einsatz;
    s.karten2 = [s.karten.pop(), karteZiehen()];
    s.karten.push(karteZiehen());
    if (bjSumme(s.karten) >= 21) handZu();
  } else {   // stand
    handZu();
  }
  if (bjSitzFertig(s)) gblackjackWeiter();
  else B.endet = G.tick + 20;
  return { ok: true };
}
/* Poker: eine Aktion des Spielers an der Reihe — Spieler und Bots nutzen dieselbe Tür. */
function gpokerAktion(p, s, aktion) {
  const P = G.gpoker;
  const kosten = P.aktBet - s.gesetzt;
  if (aktion === "fold") s.gefoldet = true;
  else if (aktion === "check") {
    if (kosten > 0) return { error: `Da liegt eine Erhöhung — mitgehen kostet ${kosten} $` };
  } else if (aktion === "call") {
    if (kosten <= 0) return { error: "Nichts zu callen — schieb (Check) oder erhöhe" };
    if (p.cash < kosten) return { error: "Zu wenig Bargeld zum Mitgehen" };
    p.cash -= kosten; P.pot += kosten; s.gesetzt = P.aktBet;
    logTx(p, "Casino", "Poker: mitgegangen", -kosten);
  } else if (aktion === "raise") {
    if (P.raises >= 3) return { error: "Dreimal erhöht ist genug — Call, Check oder Fold" };
    const gesamt = kosten + P.einsatz;
    if (p.cash < gesamt) return { error: `Erhöhen kostet ${gesamt} $` };
    p.cash -= gesamt; P.pot += gesamt;
    P.aktBet += P.einsatz; s.gesetzt = P.aktBet; P.raises++;
    for (const x of P.spieler) if (x !== s) x.dranWar = false;
    logTx(p, "Casino", "Poker: erhöht", -gesamt);
  } else return { error: "Diese Ansage kennt der Croupier nicht" };
  s.dranWar = true;
  gpokerWeiter();
  return { ok: true };
}
function gpokerWeiter() {
  const P = G.gpoker;
  const aktive = P.spieler.filter(s => !s.gefoldet);
  if (aktive.length <= 1) return gpokerShowdown();
  for (let i = 1; i <= P.spieler.length; i++) {
    const j = (P.dran + i) % P.spieler.length, s = P.spieler[j];
    if (!s.gefoldet && (!s.dranWar || s.gesetzt < P.aktBet)) { P.dran = j; P.endet = G.tick + 25; return; }
  }
  /* Setzrunde vorbei -> nächste Straße oder Showdown */
  P.strasse++;
  for (const s of P.spieler) { s.gesetzt = 0; s.dranWar = false; }
  P.aktBet = 0; P.raises = 0;
  if (P.strasse === 1) P.board.push(P.deck.pop(), P.deck.pop(), P.deck.pop());
  else if (P.strasse === 2 || P.strasse === 3) P.board.push(P.deck.pop());
  else return gpokerShowdown();
  P.dran = -1;
  for (let i = 0; i < P.spieler.length; i++) if (!P.spieler[i].gefoldet) { P.dran = i; break; }
  P.endet = G.tick + 25;
}
function gpokerShowdown() {
  const P = G.gpoker;
  const aktive = P.spieler.filter(s => !s.gefoldet);
  let gewinner = aktive, rangName = null;
  if (aktive.length > 1) {
    for (const s of aktive) s.wert = pokerWert([...s.karten, ...P.board]);
    let best = aktive[0].wert;
    for (const s of aktive) if (pokerVergleich(s.wert, best) > 0) best = s.wert;
    gewinner = aktive.filter(s => pokerVergleich(s.wert, best) === 0);
    rangName = POKER_RAENGE[best[0]];
  }
  /* 5 % Rake ans Haus, der Rest an die Gewinner */
  const herr = gcasinoHerrscher();
  const rake = Math.round(P.pot * .05);
  if (herr && rake > 0) {
    const bank = Object.values(G.players).filter(m => m.familie === herr);
    const teil = Math.round(rake / Math.max(1, bank.length));
    for (const m of bank) { m.cash += teil; logTx(m, "Casino", "Poker-Rake", teil); }
  }
  const anteil = Math.floor((P.pot - rake) / gewinner.length);
  for (const s of P.spieler) {
    const pl = G.players[s.pid];
    if (s.gefoldet) { s.ergebnis = "Gefoldet"; continue; }
    if (gewinner.includes(s)) {
      if (pl) { pl.cash += anteil; logTx(pl, "Casino", `Poker gewonnen${rangName ? ` (${rangName})` : ""}`, anteil); }
      s.ergebnis = `+${anteil} $${rangName ? ` · ${rangName}` : ""}`;
    } else s.ergebnis = s.wert ? POKER_RAENGE[s.wert[0]] : "Verloren";
  }
  io.emit("notice", { text: `\u{1F0A1} Poker: ${gewinner.map(s => s.name).join(" & ")} ${gewinner.length > 1 ? "teilen sich" : "holt"} den Pot von ${P.pot} $${rangName ? ` mit ${rangName}` : " — alle anderen gefoldet"}.` });
  if (anteil >= 3000) io.emit("gcasinoEreignis", { art: "grossgewinn", name: gewinner.map(s => s.name).join(" & "), betrag: anteil });
  P.phase = "vorbei"; P.endet = G.tick + 12;
}
function gblackjackWeiter() {
  const B = G.gblackjack;
  B.dran = B.spieler.findIndex((s, i) => i > B.dran && !bjSitzFertig(s));
  if (B.dran >= 0) { B.endet = G.tick + 20; return; }
  /* Alle fertig: Dealer zieht bis 17, dann wird abgerechnet. */
  while (bjSumme(B.dealer) < 17) B.dealer.push(karteZiehen());
  const d = bjSumme(B.dealer);
  const handWerten = (pl, karten, einsatz, split) => {
    const sum = bjSumme(karten);
    if (sum > 21) return "Überkauft";
    if (sum === 21 && karten.length === 2 && !split) {
      if (pl) gcasinoGewinn(pl, Math.round(einsatz * 2.5), "Blackjack");
      return "Blackjack!";
    }
    if (d > 21 || sum > d) { if (pl) gcasinoGewinn(pl, einsatz * 2, "Blackjack"); return "Gewonnen"; }
    if (sum === d) { if (pl) gcasinoGewinn(pl, einsatz, "Blackjack"); return "Push"; }
    return "Verloren";
  };
  for (const s of B.spieler) {
    const pl = G.players[s.pid];
    s.ergebnis = handWerten(pl, s.karten, s.einsatz, !!s.karten2);
    if (s.karten2) s.ergebnis += " / " + handWerten(pl, s.karten2, s.einsatz2, true);
  }
  const sieger = B.spieler.filter(s => /Gewonnen|Blackjack/.test(s.ergebnis)).map(s => s.name);
  io.emit("notice", { text: `\u{1F0CF} Blackjack: Der Dealer hat ${d > 21 ? d + " — überkauft!" : d}. ${sieger.length ? "Es gewinnen: " + sieger.join(", ") : "Der Tisch geht leer aus."}` });
  B.phase = "vorbei"; B.endet = G.tick + 10;
}

/* Solo-Spiele: erst entscheidet die Quote über Sieg/Niederlage, dann werden
 * Würfel, Walzen oder Karten passend zum Ausgang erzeugt — die Animation im
 * Client zeigt also immer genau das, was zählt. */
function gcasinoDetail(spiel, gewonnen) {
  if (spiel === "wuerfel") {
    let a, b;
    do { a = 1 + Math.floor(Math.random() * 6); b = 1 + Math.floor(Math.random() * 6); }
    while ((a + b >= 9) !== gewonnen);
    return { wuerfel: [a, b] };
  }
  if (spiel === "slots") {
    const SYM = ["\u{1F34B}", "\u{1F352}", "\u{1F514}", "\u2B50", "\u{1F347}", "7\uFE0F\u20E3"];
    if (gewonnen) { const s = SYM[Math.floor(Math.random() * SYM.length)]; return { walzen: [s, s, s] }; }
    let w;
    do { w = [0, 0, 0].map(() => SYM[Math.floor(Math.random() * SYM.length)]); }
    while (w[0] === w[1] && w[1] === w[2]);
    return { walzen: w };
  }
  if (spiel === "baccara") {
    for (let i = 0; i < 400; i++) {
      const sp = [karteZiehen(), karteZiehen()], bk = [karteZiehen(), karteZiehen()];
      if (bacSumme(sp) <= 4) sp.push(karteZiehen());
      if (bacSumme(bk) <= 4) bk.push(karteZiehen());
      if ((bacSumme(sp) > bacSumme(bk)) === gewonnen)
        return { spieler: sp.map(k => ({ txt: k.txt, rot: k.rot })), bank: bk.map(k => ({ txt: k.txt, rot: k.rot })),
                 ps: bacSumme(sp), bs: bacSumme(bk) };
    }
    return null;
  }
  if (spiel === "rot" || spiel === "zahl") {
    let z;
    do { z = Math.floor(Math.random() * 37); }
    while (spiel === "rot" && (z !== 0 && GROULETTE_ROT.has(z)) !== gewonnen);
    return { zahl: z, rot: GROULETTE_ROT.has(z) };
  }
  return null;
}
const MAFIA_BOT_NAMEN = {
  famiglia: ["Don Salvatore", "Luca Moretti"],
  syndikat: ["Viktor Kroll", "Greta Falk"],
  bratwa:   ["Sergej Wolkow", "Anja Petrova"],
  triade:   ["Onkel Chen", "Mei Ling"],
};
/* ---- Bezirke (Kartellmodus) ----
 * Die 26x26-Karte zerfällt in ein 3x3-Raster aus neun Bezirken. Wer in einem
 * Bezirk die meisten Gebäude stehen hat (mindestens zwei, und mehr als jede
 * andere Familie), kontrolliert ihn: Schutzgeld jede Minute plus Respekt.
 * Die Familie mit den meisten Bezirken stellt den PATEN — alle anderen
 * Familien zahlen ihm 10 % ihrer Hehler-Erlöse als Abgabe. */
/* Italienische Viertel — die Karte des Kartellmodus ist eine alte
 * Mittelmeerstadt, ihre Bezirke heißen entsprechend. Reihenfolge = 3x3-Raster
 * von Nordwest nach Südost; die Zona Industriale liegt wirklich im Nordosten,
 * der Porto Vecchio wirklich an der Küste. */
const BEZIRK_NAMEN = ["Borgo Antico", "Stazione", "Zona Industriale",
                      "Mercato Vecchio", "Piazza Grande", "Collina",
                      "Porto Vecchio", "Marina", "Giardini"];
const SCHUTZGELD_JE_BEZIRK = 200;   // $ je Minute, unter den Mitgliedern aufgeteilt
const PATEN_ABGABE = 0.10;          // Anteil der Hehler-Erlöse an den Paten
const bezirkVon = (x, y) => Math.min(2, Math.floor(x / 9)) + 3 * Math.min(2, Math.floor(y / 9));
function bezirkeBerechnen() {
  const staerken = Array.from({ length: 9 }, () => ({}));
  for (const t of G.map) {
    /* Eine Straßensperre markiert Revier wie zwei Gebäude — Muskeln zeigen
     * zählt in diesen Vierteln mehr als Mauern hochziehen. */
    if (t.sperre) {
      const b2 = bezirkVon(t.x, t.y);
      staerken[b2][t.sperre.familie] = (staerken[b2][t.sperre.familie] || 0) + 2;
    }
    if (!t.btype || !t.owner) continue;
    const fam = G.players[t.owner]?.familie;
    if (!fam || fam === "polizei") continue;   // Polizeiwachen kontrollieren keine Reviere
    const b = bezirkVon(t.x, t.y);
    staerken[b][fam] = (staerken[b][fam] || 0) + 1;
  }
  G.bezirke = staerken.map((s, i) => {
    const reihen = Object.entries(s).sort((a, b2) => b2[1] - a[1]);
    let kontrolle = null;
    if (reihen.length && reihen[0][1] >= 2 && (reihen.length === 1 || reihen[0][1] > reihen[1][1]))
      kontrolle = reihen[0][0];
    /* Tauziehen: Während des Kampfs ist die Kontrolle ausgesetzt (kein
     * Schutzgeld, kein sicheres Erpressen). Eine BESATZUNG des Kampfsiegers
     * überstimmt danach 5 min lang die Gebäudemehrheit. */
    const kampf = G.revierKaempfe?.[i];
    const bes = G.besatzung?.[i];
    const gesichert = Math.max(0, (G.gesichert?.[i] || 0) - G.tick);
    const umkaempft = kampf ? Math.max(0, kampf.bis - G.tick) : 0;
    if (kampf) kontrolle = null;
    else if (gesichert > 0) kontrolle = null;   // frisch von der Polizei ausgeräumt
    else if (bes && bes.bis > G.tick) kontrolle = bes.familie;
    return { id: i, name: BEZIRK_NAMEN[i], kontrolle, staerken: s, umkaempft,
      gesichert,
      kampf: kampf ? { angreifer: kampf.angreifer, verteidiger: kampf.verteidiger,
        pa: kampf.punkte[kampf.angreifer], pv: kampf.punkte[kampf.verteidiger], rest: umkaempft } : null,
      besatzung: bes && bes.bis > G.tick ? { familie: bes.familie, rest: bes.bis - G.tick } : null };
  });
  /* Mafia-Auftrag „Bezirk kontrollieren“: zählt für jedes Familienmitglied,
   * sobald die Familie irgendeinen Bezirk hält (questProg ignoriert Erledigte). */
  for (const b of G.bezirke) if (b.kontrolle)
    for (const m of Object.values(G.players)) if (m.familie === b.kontrolle) questProg(m, "bezirk");
  /* Der Pate wird nicht mehr ernannt, sondern GEWÄHLT — alle 20 Minuten,
   * siehe pateWahlTick(). Hier passiert dafür nichts mehr. */
}

/* ---- Patenwahl in drei Phasen ----
 * 1. Kandidatur (45 s): Wer Pate werden will, wirft den Hut in den Ring.
 * 2. Versprechen (45 s): Jeder Kandidat gibt ein Wahlversprechen ab — das
 *    Versprechen des Siegers gilt als DEKRET für die ganze Amtszeit.
 * 3. Wahl (60 s): Offenes Votum. Bei Gleichstand an der Spitze folgt eine
 *    Stichwahl (30 s) zwischen den besten beiden. */
const PATE_WAHL_INTERVALL = 1200;
const PATE_DEKRETE = {
  steuer: { name: "Steuersenkung",  text: "Die Paten-Abgabe sinkt von 10 % auf 5 %." },
  schutz: { name: "Starke Familien", text: "Schutzgeld bringt allen Familien +25 %." },
  brot:   { name: "Brot & Spiele",   text: "Sofort 500 $ für jeden, Casino-Bürgerumsatz +50 %." },
  ruhe:   { name: "Ruhige Stadt",    text: "Sofort −25 Fahndung für alle Familien." },
};
function pateWahlErgebnis(stimmen, kandidaten) {
  const zaehl = {};
  for (const kid of Object.values(stimmen)) zaehl[kid] = (zaehl[kid] || 0) + 1;
  return kandidaten
    .map(k => [k, zaehl[k.pid] || 0])
    .sort((a, b2) => b2[1] - a[1]
      || (bezirkeVon(b2[0].familie) - bezirkeVon(a[0].familie))
      || ((G.familienRespekt[b2[0].familie] || 0) - (G.familienRespekt[a[0].familie] || 0)));
}
const bezirkeVon = fid => (G.bezirke || []).filter(b => b.kontrolle === fid).length;
function pateKroenen(k, stimmen) {
  G.pate = k.familie; G.pateName = k.name; G.pateDekret = k.versprechen || null;
  G.wahlSiege[k.familie] = (G.wahlSiege[k.familie] || 0) + 1;
  const dek = k.versprechen && PATE_DEKRETE[k.versprechen];
  io.emit("notice", { text: `\u{1F451} ${k.name} (${FAMILIEN[k.familie].name}) ist der neue Pate${stimmen != null ? ` — ${stimmen} Stimme${stimmen === 1 ? "" : "n"}` : " — ohne Gegenkandidat"}.${dek ? ` Dekret: „${dek.name}“ — ${dek.text}` : ""}` });
  io.emit("pateGewaehlt", { familie: k.familie, name: `${k.name} (${FAMILIEN[k.familie].name})`, farbe: FAMILIEN[k.familie].farbe });
  /* Einmal-Dekrete sofort vollstrecken */
  if (k.versprechen === "brot")
    for (const m of Object.values(G.players)) { m.cash += 500; logTx(m, "Kartell", "Dekret „Brot & Spiele“: Geschenk des Paten", 500); }
  if (k.versprechen === "ruhe")
    for (const fid of Object.keys(FAMILIEN)) G.fahndung[fid] = Math.max(0, (G.fahndung[fid] || 0) - 25);
}
function pateWahlTick() {
  const W = G.pateWahl;
  if (!W.naechste) W.naechste = G.tick + 120;
  const bots = () => Object.values(G.players).filter(b => b.bot && b.familie && b.familie !== "polizei");
  if (!W.phase && G.tick >= W.naechste) {
    W.phase = "kandidatur"; W.endet = G.tick + 45; W.kandidaten = []; W.stimmen = {}; W.stich = null;
    io.emit("notice", { text: "\u{1F3A9} PATENWAHL, Phase 1: Kandidatur! 45 Sekunden lang kann jeder Mafioso den Hut in den Ring werfen." });
    return;
  }
  if (!W.phase) return;
  if (W.phase === "kandidatur") {
    /* Je Familie schickt höchstens ein Bot einen Kandidaten ins Rennen. */
    for (const b of bots()) {
      if (famBoss(b.familie) !== b.id) continue;   // nur Oberhäupter kandidieren
      if (W.kandidaten.some(k => k.familie === b.familie)) continue;
      if (Math.random() < .04)
        W.kandidaten.push({ pid: b.id, name: b.name, familie: b.familie, versprechen: null });
    }
    if (G.tick < W.endet) return;
    if (!W.kandidaten.length) {
      W.phase = null; W.naechste = G.tick + PATE_WAHL_INTERVALL;
      G.pate = null; G.pateName = null; G.pateDekret = null;
      io.emit("notice", { text: "\u{1F3A9} Niemand will Pate sein — der Stuhl bleibt 20 Minuten verwaist." });
      return;
    }
    if (W.kandidaten.length === 1) {
      pateKroenen(W.kandidaten[0], null);
      W.phase = null; W.naechste = G.tick + PATE_WAHL_INTERVALL;
      return;
    }
    W.phase = "versprechen"; W.endet = G.tick + 45;
    io.emit("notice", { text: `\u{1F4DC} Phase 2: Wahlversprechen! ${W.kandidaten.length} Kandidaten — 45 Sekunden für große Worte. Das Versprechen des Siegers gilt als Dekret.` });
    return;
  }
  if (W.phase === "versprechen") {
    for (const k of W.kandidaten) {
      const pl = G.players[k.pid];
      if (pl?.bot && !k.versprechen && Math.random() < .1) {
        const arten = Object.keys(PATE_DEKRETE);
        k.versprechen = arten[Math.floor(Math.random() * arten.length)];
      }
    }
    if (G.tick < W.endet) return;
    W.phase = "wahl"; W.endet = G.tick + 60; W.stimmen = {};
    io.emit("notice", { text: "\u{1F5F3} Phase 3: Die Wahl! 60 Sekunden offenes Votum — jeder Mafioso hat eine Stimme." });
    return;
  }
  if (W.phase === "wahl" || W.phase === "stichwahl") {
    const wahlbar = W.stich ? W.kandidaten.filter(k => W.stich.includes(k.pid)) : W.kandidaten;
    for (const b of bots()) {
      if (W.stimmen[b.id] || Math.random() > .08) continue;
      let ziel = wahlbar.find(k => k.familie === b.familie);
      if (!ziel || Math.random() < .2)
        ziel = [...wahlbar].sort((a, b2) => (G.familienRespekt[b2.familie] || 0) - (G.familienRespekt[a.familie] || 0))[0];
      if (ziel) W.stimmen[b.id] = ziel.pid;
    }
    if (G.tick < W.endet) return;
    const reihen = pateWahlErgebnis(W.stimmen, wahlbar);
    const patt = reihen.length > 1 && reihen[0][1] === reihen[1][1];
    if (patt && W.phase === "wahl") {
      W.phase = "stichwahl"; W.endet = G.tick + 30; W.stimmen = {};
      W.stich = [reihen[0][0].pid, reihen[1][0].pid];
      io.emit("notice", { text: `\u2694 STICHWAHL! ${reihen[0][0].name} gegen ${reihen[1][0].name} — 30 Sekunden, alle Stimmen zurückgesetzt.` });
      return;
    }
    /* Endergebnis (bei erneutem Patt entscheiden Bezirke, dann Respekt — steckt in der Sortierung) */
    pateKroenen(reihen[0][0], reihen[0][1]);
    W.phase = null; W.naechste = G.tick + PATE_WAHL_INTERVALL; W.stich = null;
  }
}
/* ---- Werttransporte, Straßensperren, Fahndung (Kartellmodus) ----
 * Auf den Hauptstraßen rollen regelmäßig Werttransporte quer über die Karte.
 * Wer sich traut, überfällt sie: Erfolg bringt Bargeld, Pistolen oder
 * Goldbarren plus Respekt — Misserfolg kostet Kaution und treibt den
 * FAHNDUNGSDRUCK der Familie hoch. Bei 100 schlägt die Polizei mit einer
 * RAZZIA zu: alle illegale Ware der Mitglieder wird beschlagnahmt.
 * Straßensperren markieren Revier: Sie zählen wie zwei Gebäude für die
 * Bezirkskontrolle und stoppen Transporte, die in sie hineinfahren. */
const TRANSPORT_INTERVALL = 75;   // Sekunden zwischen zwei Werttransporten
const TRANSPORT_TEMPO = 0.45;     // Kacheln je Sekunde
const TRANSPORT_ARTEN = {
  geld:   { name: "Geldtransport",   gewicht: 3 },
  waffen: { name: "Waffentransport", gewicht: 2 },
  gold:   { name: "Goldtransport",   gewicht: 1 },
};
const UEBERFALL_COOLDOWN = 45;    // Sekunden Sperrfrist je Spieler
const ERPRESS_COOLDOWN = 180;     // Sekunden je Spieler UND Bezirk — die Läden zahlen nicht zweimal am Tag
/* Revierkampf: geclaimte Bezirke lassen sich mit WAFFEN umkämpfen. Der Angriff
 * kostet Pistolen (aus Waffentransport-Überfällen); Erfolg setzt die Kontrolle
 * des Bezirks für eine Weile aus — das Fenster, in dem man mit Bauten und
 * Sperren selbst die Mehrheit holt. */
const KAMPF_COOLDOWN = 180;       // Sekunden je Spieler (egal welcher Bezirk)
const KAMPF_PISTOLEN_MIN = 3;     // Mindesteinsatz; bis zu 6 werden automatisch eingesetzt
const KAMPF_PISTOLEN_MAX = 6;
const KAMPF_DAUER = 120;          // solange tobt das Tauziehen um den Bezirk
/* Revierkampf 2.0 — das Tauziehen: Der Angriff eröffnet einen sichtbaren
 * Kontroll-Balken (Angreifer- vs. Verteidiger-Punkte). Alles im Bezirk zählt:
 * Gebäude +2, Sperre +2, Erpressung +1, „Verstärkung schicken" +1. Bei Ablauf
 * gewinnt, wer vorn liegt (Gleichstand: Verteidiger). Der Sieger übernimmt
 * den Bezirk als BESATZUNG für 5 Minuten — egal, wer mehr Gebäude hat — und
 * plündert die Kassen des Viertels. */
const VERST_KOSTEN = 300;         // Verstärkung schicken: $ je Klick
const VERST_CD = 10;              // Sekunden je Spieler zwischen Verstärkungen
const BESATZUNG_DAUER = 300;      // eroberte Bezirke bleiben 5 min besetzt
function kampfPunkte(idx, familie, n) {
  const k = G.revierKaempfe?.[idx];
  if (k && k.punkte[familie] != null) k.punkte[familie] += n;
}
const SPERRE_KOSTEN = 800;
const SPERRE_DAUER = 180;         // Sekunden Lebenszeit einer Sperre
const SPERRE_MAX_JE_FAMILIE = 2;
const BESTECHUNG_KOSTEN = 2000;

/* Durchgehende Straßenzüge der aktuellen Karte — auf ihnen fahren die
 * Transporte. Wird je Runde einmal aus dem Gitter abgeleitet. */
function transportLinien() {
  /* Längster ZUSAMMENHÄNGENDER Straßenzug je Zeile/Spalte — auf der
   * Küstenkarte enden die Nord-Süd-Corsi im Meer, eine „volle Spalte“ gibt
   * es dort nicht mehr. Ab 12 Kacheln am Stück lohnt sich ein Transport. */
  const linien = [];
  const lauf = (achse, linie, laenge, lies) => {
    let start = 0, bestVon = 0, bestBis = -1;
    for (let i = 0; i <= laenge; i++) {
      if (i < laenge && lies(i)) continue;
      if (i - start > bestBis - bestVon + 1) { bestVon = start; bestBis = i - 1; }
      start = i + 1;
    }
    if (bestBis - bestVon + 1 >= 12) linien.push({ achse, linie, von: bestVon, bis: bestBis });
  };
  for (let x = 0; x < MAP_W; x++) lauf("y", x, MAP_H, y => !!G.map[y * MAP_W + x]?.road);
  for (let y = 0; y < MAP_H; y++) lauf("x", y, MAP_W, x => !!G.map[y * MAP_W + x]?.road);
  return linien;
}
const transportKachel = tr => {
  const p = Math.round(tr.pos);
  const x = tr.achse === "x" ? p : tr.linie, y = tr.achse === "x" ? tr.linie : p;
  return { x, y, t: G.map[y * MAP_W + x] };
};

/* Industrien: jeder Spieler wählt beim Beitritt EINE — nur deren Gebäude sind
 * baubar (Shops kann jeder). Erzwingt Handel: Agrar braucht Wasser/Strom von
 * den Versorgern, alle brauchen Ziegel/Beton der Bauindustrie, Bau braucht
 * Erze der Rohstoffindustrie usw. */
const INDUSTRIES = {
  agrar:     { name: "Agrarwirtschaft", en: "Agriculture" },
  rohstoff:  { name: "Rohstoff- & Bauindustrie", en: "Raw materials & construction" },
  versorger: { name: "Grundbedürfnisse (Wasser, Energie, Öl)", en: "Essentials (water, energy, oil)" },
  tech:      { name: "Technologie & Elektronik", en: "Technology & electronics" },
  touristik: { name: "Touristik", en: "Tourism" },
  ruestung:  { name: "Rüstungsindustrie", en: "Armament industry" },
  /* Stellt keine Waren her, sondern Shop-Systeme, die andere Firmen auf ihren
   * Online-Marktplätzen installieren (siehe "Software-Branche" weiter unten). */
  software:  { name: "Software & Digitales", en: "Software & digital" },
  /* Nur im Renntag-Modus waehlbar: Dort gibt es keine sechs Branchen, sondern
   * zwei Rollen — wer faehrt und wer beliefert. */
  rennclub:      { name: "Race Club", en: "Race club" },
  rennindustrie: { name: "Rennindustrie", en: "Racing industry" },
};
/* Welche Rollen im Renntag zur Wahl stehen. */
const RENNTAG_ROLLEN = ["rennclub", "rennindustrie"];
/* Was die beiden Rollen bauen duerfen. Laeden (bt.retail) und der Rennstall
 * sind gesondert geregelt.
 *
 * Die Rennindustrie bekommt die komplette Zulieferkette, nicht nur die beiden
 * Teile-Werke: Rennreifen brauchen Oel und Stahl, Rennsoftware Elektronik und
 * Silizium. Ohne die Vorstufen stuenden ihre Werke still, denn im Renntag gibt
 * es keine Agrar- oder Versorgerbranche mehr, die sie liefern koennte. */
const RENNTAG_BAUTEN = {
  rennclub: new Set(["rennstall", "werbeagentur", "fanhub"]),
  rennindustrie: new Set(["reifenwerk", "rennlabor", "oelpumpe", "mine", "stahlwerk",
                          "siliziummine", "chipfabrik", "ewerk", "windpark", "werbeagentur"]),
};
/* Baumaterial-Bedarf jedes Gebäudes: Ziegel immer, Beton ab $4.000. Elektronik
 * wird NICHT zum Bauen gebraucht, sondern zum Aufleveln bestehender Gebäude
 * (siehe upgradeCost / "upgradeBuilding"-Handler weiter unten). */
const matCost = bt => {
  /* Kartellmodus: kein Baumaterial. Es gibt dort keine verlässliche
   * Ziegel-Lieferkette (reines P2P ohne Markt-Bot, Bots bauen keine
   * Ziegeleien) — nach dem Starter-Kit war JEDES Gebäude unbaubar.
   * Die Mafia zahlt bar, Handwerker stellen keine Fragen. */
  if (MODE === "kartell") return {};
  const m = { ziegel: Math.ceil(bt.cost / 400) };
  /* Ausnahme Betonwerk: es selbst mit Beton zu verlangen wäre ein Henne-Ei-Problem
   * (ohne ein erstes Werk kann niemand je das Material haben, um eins zu bauen). */
  if (bt.cost >= 4000 && bt.proc?.out !== "beton") m.beton = Math.ceil(bt.cost / 2000);
  return m;
};
/* Market-Maker mit Angebots-/Nachfrage-Anker:
 * `sold` sammelt, was Spieler an Bot-Senken verkaufen (Börsen-Bot, Vertrieb,
 * Gruppenaufträge) und zerfällt langsam (~2 min Halbwertszeit). Viel Verkauf
 * drückt den Preisanker bis auf 50 % des Basispreises, Knappheit hebt ihn bis
 * 130 %. Um den Anker schwankt der Kurs weiter im kurzfristigen Band (max ±$5).
 * Folge: Monokultur (z. B. nur Plantagen) ruiniert sich ihren eigenen Preis. */
const MM = Object.fromEntries(Object.keys(GOODS).map(k =>
  [k, { price: BASEP[k], anchor: BASEP[k], sold: 0, band: Math.min(5, BASEP[k] * 0.5) }]));
const soldPressure = k => MM[k].sold * BASEP[k] / 4000;   // verkaufter Wert / $4000 = 1 Druckpunkt
function noteSold(k, qty) { MM[k].sold = Math.max(-200 / BASEP[k], MM[k].sold + qty); }

const BOOST_MULT = 0.75;   // je verfügbarem Boost-Rohstoff: +75 % Produktion

/* Gebäude-Level: Elektronik der Technologie-Industrie levelt bestehende
 * Produktions-/Verarbeitungsgebäude auf (nicht Shops) — jede Stufe +30 %
 * Ausstoß. Kosten steigen mit Stufe UND Gebäudepreis, damit teure Gebäude
 * (und hohe Stufen) spürbar mehr Elektronik verschlingen. */
/* ---- Motorsport: Rennwerte ----
 * Bewusst KEINE zweite Fahrzeugdatenbank: Schlüssel ist die vorhandene Ware.
 * Die Werte des Elektro-Autos sind die aus der Vorlage; Benziner und Diesel
 * sind so gesetzt, dass keine Motorisierung auf allen fünf Achsen führt —
 * der Benziner ist schnell und durstig, der Diesel zäh und sparsam. */
const RACE_STATS = {
  benzinauto: { speed: 78, beschl: 71, handling: 66, effizienz: 41, standfest: 74 },
  dieselauto: { speed: 69, beschl: 58, handling: 63, effizienz: 66, standfest: 88 },
  eauto:      { speed: 72, beschl: 68, handling: 61, effizienz: 79, standfest: 84 },
};
/* Stellplätze = Ausbaustufe. Bewusst das vorhandene 5-Stufen-System statt der
 * vier Stufen aus der Vorlage — ein zweites Stufenschema neben `level` wäre
 * genau die Doppelung, die vermieden werden soll. */
const stallKapazitaet = level => level || 1;
let autoNr = 0;
/* Motorsport ist bewusst Spätspiel: Er geht erst ab diesem Nettovermögen auf.
 * Der Grund ist nicht Balancing um seiner selbst willen, sondern der Wettpool —
 * er trägt nur, wenn die Mitspieler Kapital zum Setzen haben. Vorher wäre der
 * Rennstall ein Klotz, den sich eine junge Firma vom Mund abspart.
 * ACHTUNG: In kurzen Runden (Rundenziel 100.000 $) geht er damit NIE auf, und
 * beim Ziel 250.000 $ erst kurz vor Schluss. Als Spätspiel-Inhalt gedacht ab
 * dem Ziel 500.000 $ aufwärts. */
const RACING_UNLOCK_NW = +process.env.RACING_UNLOCK || 200_000;

/* ---- Tuning ----
 * Datengetrieben, damit neue Bereiche später nur ein Eintrag sind. Jeder
 * Bereich hebt zwei Werte und senkt andere: Es gibt bewusst KEINE Ausbaustufe,
 * die alles verbessert — sonst gäbe es genau ein bestes Setup und die ganze
 * Entscheidung wäre keine. Die Teile kommen aus der Wirtschaft (Rennreifen und
 * Rennsoftware von fremden Betrieben), nicht aus dem Nichts. */
const TUNING = {
  antrieb:     { name: "Antrieb",      en: "Drivetrain",
                 plus: { speed: 7, beschl: 6 },      minus: { effizienz: 5, standfest: 3 },
                 teile: { rennsoftware: 1, rennreifen: 1 }, cash: 6000 },
  batterie:    { name: "Batterie",     en: "Battery",
                 plus: { effizienz: 9 },             minus: { beschl: 3 },
                 teile: { rennsoftware: 2 },               cash: 5000 },
  reifen:      { name: "Reifen",       en: "Tyres",
                 plus: { handling: 8 },              minus: { standfest: 2 },
                 teile: { rennreifen: 3 },                 cash: 4000 },
  fahrwerk:    { name: "Fahrwerk",     en: "Chassis",
                 plus: { handling: 6, standfest: 3 }, minus: { speed: 2 },
                 teile: { rennreifen: 2 },                 cash: 5000 },
  aerodynamik: { name: "Aerodynamik",  en: "Aerodynamics",
                 plus: { speed: 6, handling: 4 },    minus: { effizienz: 6 },
                 teile: { rennreifen: 1, rennsoftware: 1 }, cash: 7000 },
  software:    { name: "Rennsoftware", en: "Race software",
                 plus: { beschl: 5, effizienz: 4 },  minus: { standfest: 4 },
                 teile: { rennsoftware: 3 },               cash: 8000 },
};
const TUNING_MAX = 3;            // Stufen je Bereich
const STAT_MIN = 15, STAT_MAX = 130;
const STATS = ["speed", "beschl", "handling", "effizienz", "standfest"];
/* Werte eines Wagens = Grundwerte der Motorisierung plus alle Tuningstufen.
 * Absichtlich JEDES MAL neu gerechnet statt fortgeschrieben: So kann eine
 * spätere Balancing-Änderung an TUNING rückwirkend greifen, und ein Rundungs-
 * fehler kann sich nicht über Dutzende Stufen aufaddieren. */
/* Was ein Wagen wert ist: Grundfahrzeug plus alles, was investiert wurde.
 * Ohne den Tuninganteil wäre ein durchentwickelter Rennwagen in der Bilanz
 * genauso viel wert wie ein Serienauto vom Hof — und die Versteigerung eines
 * Rennstalls, der einzige Verkaufsweg, wäre ein Verlustgeschäft. */
function autoWert(a) {
  let v = MM[a.good].price * (a.zustand / 100);
  for (const [b, stufe] of Object.entries(a.tuning || {}))
    for (let st = 1; st <= stufe; st++) {
      const k = tuningKosten(b, st);
      v += k.cash * 0.6;
      for (const [g, n] of Object.entries(k.teile)) v += MM[g].price * n * 0.6;
    }
  return v;
}
/* Anzeigename eines Wagens: der selbst vergebene, sonst Gattung plus Nummer.
 * An einer Stelle gebuendelt, damit Rennmeldung, Notizen und Finanzlog nicht
 * auseinanderlaufen, sobald jemand seinen Wagen umtauft. */
const autoName = a => a.name || `${GOODS[a.good].name} #${a.nr}`;
/* Bot-Ställe tauften ihre Wagen nicht — im Startfeld standen dann "Benzin-Auto
 * #4" neben "Ferro Tipo 12", und die Werksteams wirkten als Einzige wie echte
 * Rennwagen. Jeder Bot-Wagen bekommt deshalb einen Namen aus diesem Pool,
 * deterministisch nach Startnummer, damit er ueber die Runde stabil bleibt. */
const BOT_WAGENNAMEN = [
  "Sturmvogel", "Nordlicht", "Basilisk", "Kometa", "Wildkatze", "Zenit",
  "Falkenauge", "Donnerkeil", "Silberdistel", "Taifun", "Mistral", "Panther",
  "Rubin", "Vulkan", "Habicht", "Meteor", "Lawine", "Orkan",
];
const botWagenName = nr => BOT_WAGENNAMEN[(nr - 1) % BOT_WAGENNAMEN.length];
function autoWerte(a) {
  const w = { ...RACE_STATS[a.good] };
  for (const [b, stufe] of Object.entries(a.tuning || {})) {
    const T = TUNING[b]; if (!T) continue;
    for (const [k, v] of Object.entries(T.plus))  w[k] += v * stufe;
    for (const [k, v] of Object.entries(T.minus)) w[k] -= v * stufe;
  }
  for (const k of STATS) w[k] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(w[k])));
  return w;
}
/* ---- Instandsetzung ----
 * Ohne Reparatur ist Verschleiss eine Einbahnstrasse: Der Zustand faellt je
 * Rennen um 8 bis 18 Punkte, unter 25 % ist der Wagen nicht mehr startklar —
 * und da ein eingestelltes Auto weder verkauft noch ausgemustert werden kann,
 * blockiert es danach dauerhaft einen Stellplatz. Nach rund sechs Rennen waere
 * jeder Wagen ein Totalschaden, den man nicht loswird.
 *
 * Die Kosten haengen am WERT des Wagens, nicht an einer festen Summe: Einen
 * durchentwickelten Rennwagen instand zu setzen muss mehr kosten als ein
 * Serienauto, sonst waere Verschleiss ausgerechnet fuer die teuren Fahrzeuge
 * folgenlos. Ersatzteile kommen wie beim Tuning aus der Wirtschaft. */
/* 15 %, nicht 50 %. Die erste Kalibrierung haengte die Reparatur zu stark am
 * Fahrzeugwert und drehte damit den Anreiz um: Ein voll entwickelter Wagen
 * kostete nach EINEM Rennen 8.833 $ Instandsetzung, waehrend Platz drei nur
 * 6.400 $ einbringt — wer am meisten investiert hatte, fuhr ausser bei einem
 * Sieg Verlust. Entwickeln machte den Rennsport also unrentabler. Der
 * Verschleiss ist aber derselbe, egal wie teuer der Wagen ist; der Wert darf
 * die Kosten nur daempfen, nicht bestimmen. */
const REPARATUR_ANTEIL = 0.15;    // Anteil des Fahrzeugwerts bei Totalschaden
const REPARATUR_MIN = 600;
function reparaturKosten(a) {
  const fehlend = Math.max(0, 100 - (a.zustand ?? 100));
  if (!fehlend) return { fehlend: 0, cash: 0, teile: {} };
  /* Der Wert ist bereits um den Zustand gemindert — fuer die Rechnung wieder
   * auf den Neuzustand hochziehen, sonst wird die Reparatur umso billiger, je
   * kaputter der Wagen ist. */
  const neuwert = autoWert(a) + MM[a.good].price * (fehlend / 100);
  return {
    fehlend,
    cash: Math.max(REPARATUR_MIN, Math.round(neuwert * REPARATUR_ANTEIL * fehlend / 100)),
    teile: { rennreifen: Math.max(1, Math.ceil(fehlend / 25)) },
  };
}

const tuningKosten = (bereich, stufe) => ({
  cash: Math.round(TUNING[bereich].cash * stufe),
  teile: Object.fromEntries(Object.entries(TUNING[bereich].teile).map(([g, n]) => [g, n * stufe])),
});

/* ---- Fahrer ----
 * Ein Pool je Runde, aus dem alle schöpfen — wer zuerst zugreift, hat ihn.
 * Das Gehalt läuft pro Minute weiter, ein Fahrer ist also eine Verpflichtung
 * und kein Einmalkauf. */
const FAHRER_NAMEN = ["Alexander Vogt", "Lena Neumann", "Daichi Sato", "Mira Kowalski",
  "Tomas Bauer", "Yara Okonkwo", "Finn Larsen", "Elif Demir", "Marco Ferrari", "Nora Lindqvist"];
const FAHRER_LAND = ["DE", "DE", "JP", "PL", "AT", "NG", "DK", "TR", "IT", "SE"];
const FAHRER_GEHALT_TAKT = 60;   // Ticks (1/s) — Gehalt jede Minute
function fahrerBauen(i) {
  const r = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const koennen = r(58, 92);
  return { id: id(), name: FAHRER_NAMEN[i], land: FAHRER_LAND[i], nr: i + 1,
    speed: koennen + r(-8, 8), handling: koennen + r(-8, 8), reaktion: koennen + r(-8, 8),
    strategie: r(50, 90), konstanz: r(50, 90), erfahrung: r(0, 40),
    gehalt: Math.round((koennen * koennen) / 9 / 50) * 50,   // 58 -> 750 $, 92 -> 1900 $ je Minute
    ruf: 0, rennen: 0, siege: 0, teamId: null, autoId: null };
}

/* ---- Rennen ----
 * Der Renntag kommt in festem Takt, sobald mindestens ein startklarer Wagen
 * (mit Fahrer) im Spiel steht. Ablauf: Anmelde- und Wettphase, dann eine
 * Minute Live-Rennen (jede Sekunde ein Simulationsschritt, alle Clients sehen
 * die Zwischenstände), dann die Siegerehrung. Kein Rennen im Plan-Modus —
 * Motorsport ist Marktwirtschaft. */
const RENN_INTERVALL = +process.env.RENN_INTERVALL || 240;   // Sekunden zwischen zwei Renntagen
const RENN_ANMELDUNG = 75;       // Anmelde- und Wettphase
const RENN_DAUER = 75;           // Fahrzeit
const RENN_NENNGELD = 1500;
const RENN_GRUNDPREIS = 8000;
/* Antrittspraemie im Renntag. Dort ist Rennen die einzige Taetigkeit eines
 * Race Clubs — Laeden gibt es nicht, produziert wird nichts. Ohne eine
 * Einnahme, die nicht vom Podest abhaengt, zahlt der Club nur Fahrergehalt und
 * ist nach gut zehn Minuten pleite; danach kuendigt der Fahrer und der Club
 * kann nicht einmal mehr starten. Gemessen: 9.100 $ Ausgaben, 0 Einnahmen.
 *
 * Die Hoehe folgt aus dem gemessenen Zyklus: Anmeldung, Rennen und Siegerehrung
 * dauern zusammen rund sieben Minuten, ein Fahrer kostet dabei bis zu 4.900 $.
 * Mit 3.000 verlor ein Club, der nicht in die Punkte faehrt, jeden Renntag
 * rund 1.900 $ — ein langsames Ausbluten ohne Weg zurueck. 5.000 deckt das
 * Gehalt auch ohne Podestplatz; verdient wird weiterhin ueber das Ergebnis. */
const RENN_STARTGELD = 5000;
const RENN_RUNDE = 900;          // Distanz einer Runde (für Runden-Anzeige und Streckengrafik)
const WETT_RAKE = 0.1;           // Anteil des Wettpools, der in den Preistopf fließt
const RENN_FELD_SOLL = 5;        // so viele Wagen sollen mindestens am Start stehen
const RENN_FELD_MAX = 8;         // mehr passen nicht auf die Strecke

/* ---- Werksteams ----
 * Renntage brauchten frueher mindestens einen Spielerwagen mit Fahrer. Da ein
 * Rennstall erst ab 200.000 $ Nettovermoegen gebaut werden darf, gab es in der
 * ersten Stunde einer Runde ueberhaupt keinen Motorsport — und damit auch
 * nichts zu wetten, obwohl Wetten keinen eigenen Stall voraussetzen.
 *
 * Jetzt tritt immer ein Feld aus Werkswagen an. Sie fahren um Ruhm, nicht um
 * Geld: der Preistopf geht an die menschlichen Teilnehmer (siehe rennBeenden),
 * ihre Aufgabe ist, dass es etwas zu sehen und zu wetten gibt.
 *
 * Sobald Spieler melden, weichen sie — Spieler haben Vorrang (siehe
 * botWeichen). Damit loesen sich die Werksteams von selbst auf, je weiter die
 * Runde fortschreitet. */
const WERKS_TEAMS = [
  { team: "Scuderia Ferro",  wagen: "Ferro Tipo 12",   land: "IT", livree: "#e74c3c" },
  { team: "Nordstern",       wagen: "Nordstern NS-4",  land: "DE", livree: "#3b9cf6" },
  { team: "Albion Works",    wagen: "Albion Mk III",   land: "GB", livree: "#2ecc71" },
  { team: "Meridian",        wagen: "Meridian M7",     land: "FR", livree: "#f5c542" },
  { team: "Kaskade Motors",  wagen: "Kaskade K2",      land: "US", livree: "#b07cf7" },
  { team: "Tsubame",         wagen: "Tsubame Type-R",  land: "JP", livree: "#1abc9c" },
];
const WERKS_FAHRER = ["A. Moreau", "K. Lindqvist", "R. Okafor", "D. Halvorsen",
                      "M. Ferrari", "S. Tanaka", "J. Brennan", "L. Vargas"];
/* Einmal je Runde gewuerfelt, damit Form und Quoten ueber die Runde stabil
 * bleiben — ein Wagen, der jedes Rennen andere Werte haette, waere nicht
 * einschaetzbar, und Wetten waeren reines Raten. */
function werksTeamsBauen() {
  const r = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const basen = Object.values(RACE_STATS);
  return WERKS_TEAMS.map((w, i) => {
    const basis = basen[i % basen.length];
    const form = r(-9, 9);                       // Staerke des Teams in dieser Runde
    const werte = {};
    for (const k of STATS)
      werte[k] = Math.max(STAT_MIN, Math.min(STAT_MAX, basis[k] + form + r(-4, 4)));
    /* Negative Nummern: Wagen-IDs sind sonst fortlaufende Zahlen aus id(), und
     * der Client schickt sie als Zahl zurueck. Eine Zeichenkette wie "werk-0"
     * wuerde dort zu NaN — dann liesse sich auf Werkswagen gar nicht wetten.
     * id() selbst geht hier nicht: der Spielzustand wird aufgebaut, bevor die
     * Funktion existiert. */
    return { ...w, werte, id: -(i + 1), fahrer: WERKS_FAHRER[i % WERKS_FAHRER.length],
             fahrerWert: 58 + form + r(-5, 5), konstanz: r(55, 88), zustand: r(82, 100) };
  });
}

function findeAuto(autoId) {
  for (const t of G.map) for (const a of t.autos || []) if (a.id === autoId) return { t, a };
  return null;
}
function autosImSpiel() {
  const list = [];
  for (const t of G.map) {
    if (!t.btype || !BTYPES[t.btype]?.racing || !t.owner) continue;
    for (const a of t.autos || []) list.push({ t, a });
  }
  return list;
}
/* Parimutuel-Quoten: Der ganze Pool (abzüglich Rake) wird unter den
 * Siegerwetten aufgeteilt — die Quote je Wagen ergibt sich dynamisch aus dem,
 * was auf ihn gesetzt ist. Ohne Einsatz keine Quote (Anzeige "—"). */
/* Drei Wettmärkte, jeder als eigener Totalisator-Pool: Sieg, Podium (Top 3)
 * und Ausfall. Die Sieg-Quote je Wagen wird live angezeigt; Podium und
 * Ausfall haben mehrere mögliche Gewinner, dort steht die Quote erst mit
 * der Zielflagge fest. */
const WETT_ARTEN = ["sieg", "podium", "ausfall"];
function rennQuoten(r) {
  const pools = { sieg: 0, podium: 0, ausfall: 0 };
  for (const w of r.wetten) pools[w.art || "sieg"] += w.betrag;
  const pool = pools.sieg + pools.podium + pools.ausfall;
  const q = {};
  for (const teil of r.teilnehmer) {
    const drauf = r.wetten.filter(w => (w.art || "sieg") === "sieg" && w.autoId === teil.autoId)
      .reduce((s, w) => s + w.betrag, 0);
    q[teil.autoId] = drauf > 0 ? Math.max(1.1, Math.round(pools.sieg * (1 - WETT_RAKE) / drauf * 100) / 100) : null;
  }
  return { pool, pools, quoten: q };
}
/* Kommentar-Ticker: kurze Meldungen vom Streckenrand, neueste zuerst. */
function tickerPush(r, text) {
  (r.ticker ??= []).unshift({ t: G.tick, text });
  if (r.ticker.length > 8) r.ticker.pop();
}
/* Freie Startplaetze mit Werkswagen fuellen. Muss bei der ANKUENDIGUNG
 * passieren, nicht beim Start: gewettet wird waehrend der Anmeldephase, und
 * wetteSetzen verlangt, dass der Wagen schon im Feld steht. */
function feldAuffuellen(r) {
  const frei = (G.werksTeams || []).filter(w => !r.teilnehmer.some(t => t.autoId === w.id));
  for (const w of frei) {
    if (r.teilnehmer.length >= RENN_FELD_SOLL) break;
    r.teilnehmer.push({ autoId: w.id, bot: true, ownerId: null, team: w.team, farbe: w.livree,
      livree: w.livree, name: w.wagen, fahrer: w.fahrer, werte: w.werte, zustand: w.zustand,
      fahrerWert: w.fahrerWert, konstanz: w.konstanz, letztes: w.letztes || null,
      dist: 0, ausgefallen: false });
  }
}
/* Spieler haben Vorrang: Ist das Feld voll, raeumt der schwaechste Werkswagen
 * den Platz. Wetten auf ihn werden erstattet — wer gesetzt hat, kann nichts
 * dafuer, dass sein Wagen zurueckgezogen wird. */
function botWeichen(r) {
  const bots = r.teilnehmer.filter(t => t.bot);
  if (!bots.length) return false;
  const raus = bots.sort((a2, b2) =>
    (a2.werte.speed + a2.fahrerWert) - (b2.werte.speed + b2.fahrerWert))[0];
  r.teilnehmer.splice(r.teilnehmer.indexOf(raus), 1);
  for (const w of r.wetten.filter(x => x.autoId === raus.autoId)) {
    const p = G.players[w.playerId];
    if (p) { p.cash += w.betrag; logTx(p, "Motorsport", `Wette erstattet — ${raus.name} zurueckgezogen`, w.betrag); }
  }
  r.wetten = r.wetten.filter(x => x.autoId !== raus.autoId);
  io.emit("notice", { text: `${raus.name} (${raus.team}) macht Platz fuer einen gemeldeten Wagen.` });
  return true;
}
/* ---- Sponsorgesuche ----
 * Frueher suchte man sich selbst ein Team aus einer Liste und warf ihm Geld
 * hinterher. Jetzt kommt die Anfrage vom Team: "Wir brauchen 4.000 $" oder
 * "Wir brauchen 3x Rennreifen". Das gibt dem Sponsoring einen Anlass und macht
 * die Teile aus der eigenen Produktion zu einer echten zweiten Waehrung.
 *
 * Der Gegenwert zaehlt wie bisher pro rata beim Preisgeld — Teile werden dafuer
 * zum aktuellen Boersenkurs bewertet, damit Geld und Ware vergleichbar bleiben. */
const GESUCH_ARTEN = ["geld", "rennsoftware", "rennreifen"];
function gesuchStellen(r, team) {
  if ((r.gesuche ??= []).some(g => g.teamId === team.id)) return;
  const art = GESUCH_ARTEN[Math.floor(Math.random() * GESUCH_ARTEN.length)];
  if (art === "geld") {
    const betrag = (2 + Math.floor(Math.random() * 7)) * 1000;
    r.gesuche.push({ id: id(), teamId: team.id, team: team.name, art, betrag, wert: betrag });
  } else {
    const menge = 1 + Math.floor(Math.random() * 4);
    r.gesuche.push({ id: id(), teamId: team.id, team: team.name, art, menge,
                     wert: Math.round(menge * MM[art].price) });
  }
}
/* ---- Wettkontore ----
 * Ohne Publikum ist der Totalisator leer: Wer als Erster setzt, bekommt bei
 * einem Sieg fast nur den eigenen Einsatz zurueck, und die Quoten sagen
 * nichts. Drei Kontore tragen deshalb den Markt — mit klarem Profil statt
 * Zufall, damit sich die Quoten lesen lassen:
 *
 *   Sicher    setzt auf den staerksten Wagen — druekt dessen Quote
 *   Risiko    setzt auf den schwaechsten — haelt Aussenseiterquoten hoch
 *   Streuung  verteilt kleine Betraege auf alle
 *
 * Sie sind keine Spieler: Ihre Einsaetze wandern in den Pool, gewinnen aber
 * nie etwas zurueck (G.players kennt ihre Kennung nicht). Was sie einzahlen,
 * geht damit an die menschlichen Siegerwetten und ueber den Rake in den
 * Preistopf — das Publikum finanziert das Rennen mit. */
const WETTKONTORE = [
  { id: "kontor-sicher",   name: "Kontor Sicher",   art: "favorit",      einsatz: 3000 },
  { id: "kontor-risiko",   name: "Kontor Risiko",   art: "aussenseiter", einsatz: 2500 },
  { id: "kontor-streuung", name: "Kontor Streuung", art: "streuung",     einsatz: 2400 },
];
/* Dieselbe Formel wie im Rennschritt, nur ohne Streuung und Zustand: Was ein
 * Wagen im Mittel leisten kann. Waeren es andere Gewichte, saehen die Kontore
 * ein anderes Rennen als das, das gefahren wird. */
function staerkeSchaetzen(teil) {
  if (teil.bot) {
    const w = teil.werte;
    return w.speed * .45 + w.beschl * .2 + w.handling * .2 + teil.fahrerWert * .45;
  }
  const fund = findeAuto(teil.autoId);
  if (!fund) return 0;
  const w = autoWerte(fund.a);
  const f = G.fahrer.find(x => x.id === teil.fahrerId);
  const fWert = f ? (f.speed + f.handling + f.reaktion) / 3 + f.erfahrung * .15 : 40;
  return w.speed * .45 + w.beschl * .2 + w.handling * .2 + fWert * .45;
}
/* In zwei Wellen: eine Eroeffnungsquote gleich nach der Ankuendigung, der Rest
 * kurz vor Schluss auf dem fertigen Feld. Nur spaet zu setzen hiesse, dass die
 * Quoten die ersten 55 Sekunden auf "—" stehen — also genau dann, wenn der
 * Spieler seine Wette ueberlegt. Nur frueh zu setzen hiesse, dass spaet
 * gemeldete Wagen ungepreist bleiben. */
function wettkontoreSetzen(r, welle) {
  if (r.teilnehmer.length < 2) return;
  if ((r.kontorWellen ??= []).includes(welle)) return;
  r.kontorWellen.push(welle);
  const nachStaerke = [...r.teilnehmer].sort((a, b) => staerkeSchaetzen(b) - staerkeSchaetzen(a));
  for (const k of WETTKONTORE) {
    const anteil = Math.round(k.einsatz / 2);
    if (k.art === "streuung") {
      const je = Math.max(100, Math.round(anteil / r.teilnehmer.length / 100) * 100);
      for (const teil of r.teilnehmer) r.wetten.push({ playerId: k.id, autoId: teil.autoId, betrag: je });
      continue;
    }
    const ziel = k.art === "favorit" ? nachStaerke[0] : nachStaerke[nachStaerke.length - 1];
    if (ziel) r.wetten.push({ playerId: k.id, autoId: ziel.autoId, betrag: anteil });
  }
  /* Nachzuegler mitnehmen: Wer nach der Eroeffnung gemeldet hat, hatte noch
   * kein Geld auf sich und stuende sonst bis zum Start ohne Quote da — genau
   * die Wagen, die ein Spieler interessant faende. */
  const streu = WETTKONTORE.find(k => k.art === "streuung");
  for (const teil of r.teilnehmer) {
    if (r.wetten.some(w => w.autoId === teil.autoId)) continue;
    r.wetten.push({ playerId: streu.id, autoId: teil.autoId, betrag: 300 });
  }
  io.emit("notice", { text: welle === 1
    ? "Die Wettkontore eröffnen — erste Quoten stehen."
    : "Die Wettkontore legen nach — Schlussquoten stehen." });
}
function rennAnkuendigen() {
  G.rennen = { id: id(), phase: "anmeldung", rest: RENN_ANMELDUNG, teilnehmer: [], wetten: [], sponsoren: [], gesuche: [] };
  /* Wer seinen Fahrer verloren hat, koennte im Renntag nie wieder starten und
   * damit auch nichts mehr verdienen — eine Sackgasse, aus der es keinen Weg
   * zurueck gibt. Deshalb bekommt ein Stall ohne Fahrer vor dem Renntag einen
   * freien zugewiesen, ohne Handgeld. */
  if (MODE === "renntag") for (const t of G.map) {
    if (!BTYPES[t.btype]?.racing || !t.owner) continue;
    for (const a of t.autos || []) {
      if (a.fahrerId && G.fahrer.some(f => f.id === a.fahrerId && f.teamId === t.owner)) continue;
      const frei = G.fahrer.find(f => !f.teamId);
      if (!frei) break;
      frei.teamId = t.owner; frei.autoId = a.id; a.fahrerId = frei.id;
      const p2 = G.players[t.owner];
      if (p2) logTx(p2, "Motorsport", `${frei.name} übernimmt das Cockpit von ${autoName(a)}`, 0);
    }
  }
  feldAuffuellen(G.rennen);
  io.emit("notice", { text: `🏁 Renntag! Anmeldung, Wetten und Sponsoring sind ${RENN_ANMELDUNG} s offen — Nenngeld ${RENN_NENNGELD.toLocaleString("de-DE")} $.` });
}
function rennStarten() {
  const r = G.rennen;
  if (r.teilnehmer.length < 2) {
    for (const teil of r.teilnehmer) {
      const p = G.players[teil.ownerId];
      if (p) { p.cash += RENN_NENNGELD; logTx(p, "Motorsport", "Rennen abgesagt — Nenngeld zurück", RENN_NENNGELD); }
    }
    for (const w of r.wetten) { const p = G.players[w.playerId]; if (p) p.cash += w.betrag; }
    io.emit("notice", { text: "Rennen abgesagt — weniger als zwei Wagen gemeldet. Nenngeld und Einsätze zurück." });
    G.rennen = null; G.naechstesRennenIn = Math.round(RENN_INTERVALL / 2);
    return;
  }
  r.phase = "laeuft"; r.rest = RENN_DAUER;
  for (const teil of r.teilnehmer) { teil.dist = 0; teil.ausgefallen = false; }
  tickerPush(r, `🏁 Startflagge! ${r.teilnehmer.length} Wagen gehen ins Rennen.`);
  io.emit("notice", { text: `🏁 Startflagge! ${r.teilnehmer.length} Wagen sind auf der Strecke.` });
}
/* Ein Simulationsschritt pro Sekunde: Tempo aus Wagenwerten, Fahrerkönnen und
 * Zustand; die Konstanz des Fahrers bestimmt, wie stark das Tempo streut.
 * Standfestigkeit und Verschleiß speisen das Ausfallrisiko. */
/* Boxenstopp: ~5 Sekunden Stillstand, danach zählt der Wagen für den Rest
 * des Rennens als frischer — mehr Tempo-Substanz und weniger Ausfallrisiko.
 * Der Zustand des Wagens selbst bleibt unangetastet: repariert wird in der
 * Werkstatt (Instandsetzung), nicht gratis an der Box. */
const BOX_DAUER = 5, BOX_FRISCHE = 30, BOX_MAX = 2;
function boxenstoppStarten(r, teil) {
  teil.boxe = true;
  teil.boxeRest = BOX_DAUER;
  teil.stopps = (teil.stopps || 0) + 1;
  tickerPush(r, `🔧 ${teil.name} biegt an die Box ab!`);
}
function rennTick() {
  const r = G.rennen;
  for (const teil of r.teilnehmer) {
    if (teil.ausgefallen) continue;
    /* In der Box: Der Wagen steht, die Uhr läuft. */
    if (teil.boxe) {
      if (--teil.boxeRest <= 0) {
        teil.boxe = false;
        teil.frisch = (teil.frisch || 0) + BOX_FRISCHE;
        tickerPush(r, `🔧 ${teil.name} verlässt die Box — frische Technik!`);
      }
      continue;
    }
    /* Werkswagen stehen auf keiner Kachel — ihre Werte haengen am Teilnehmer
     * selbst. Sonst rechnet der Schritt fuer beide gleich. */
    const fund = teil.bot ? null : findeAuto(teil.autoId);
    if (!teil.bot && !fund) { teil.ausgefallen = true; continue; }
    const a = fund?.a;
    const w = teil.bot ? teil.werte : autoWerte(a);
    const zustand = teil.bot ? teil.zustand : a.zustand;
    const f = teil.bot ? null : G.fahrer.find(x => x.id === teil.fahrerId);
    const fWert = teil.bot ? teil.fahrerWert
      : f ? (f.speed + f.handling + f.reaktion) / 3 + f.erfahrung * .15 : 40;
    const konstanz = teil.bot ? teil.konstanz : f?.konstanz;
    /* Werksteams ziehen bei Verschleiß selbst an die Box. */
    if (teil.bot && !teil.frisch && zustand < 60 && r.rest > 25 && Math.random() < .06) {
      boxenstoppStarten(r, teil);
      continue;
    }
    /* Frische aus dem Boxenstopp wirkt wie zusätzlicher Zustand — nur für
     * dieses Rennen, der Wagen selbst bleibt wie er ist. */
    const zustandEff = Math.min(100, zustand + (teil.frisch || 0));
    const koennen = w.speed * .45 + w.beschl * .2 + w.handling * .2 + fWert * .45;
    const streu = 1 + (Math.random() - .5) * (konstanz ? (1.4 - konstanz / 100) : .7);
    teil.dist += koennen * streu * (zustandEff / 100 * .4 + .6) / 6;
    /* Kalibrierung: Ein frischer Wagen mit Standfestigkeit 84 soll pro Rennen
     * etwa 10 % Ausfallchance haben, ein verschlissener deutlich mehr — mit
     * den ersten Werten (0.00045/0.0004) fielen im Test BEIDE Wagen aus. */
    const risiko = (100 - w.standfest) * .00016 + (100 - zustandEff) * .00025;
    if (Math.random() < risiko) {
      teil.ausgefallen = true;
      tickerPush(r, `💥 ${teil.name} rollt aus — technischer Defekt!`);
      io.emit("notice", { text: `💥 ${teil.name} (${teil.team}) rollt aus — technischer Defekt!` });
    }
  }
  /* Boxenfunk: Überholmanöver an der Spitze und Rundenwechsel melden. */
  const ordnung = [...r.teilnehmer].filter(t2 => !t2.ausgefallen).sort((a2, b2) => b2.dist - a2.dist);
  const ids = ordnung.map(t2 => t2.autoId);
  if (r.letzteOrdnung) {
    for (let pos = 0; pos < Math.min(3, ids.length); pos++) {
      const alt = r.letzteOrdnung.indexOf(ids[pos]);
      if (alt > pos) {
        const vorbei = r.letzteOrdnung[pos];
        const opfer = r.teilnehmer.find(t2 => t2.autoId === vorbei);
        tickerPush(r, `${ordnung[pos].name} geht vorbei${opfer ? ` an ${opfer.name}` : ""} — jetzt P${pos + 1}!`);
        break;   // höchstens eine Meldung pro Sekunde, sonst rauscht der Funk
      }
    }
  }
  r.letzteOrdnung = ids;
  if (ordnung[0]) {
    const runde = Math.floor(ordnung[0].dist / RENN_RUNDE) + 1;
    if (runde !== r.letzteRunde) {
      if (r.letzteRunde) tickerPush(r, `Runde ${runde}: ${ordnung[0].name} führt${ordnung[1] ? ` vor ${ordnung[1].name}` : ""}.`);
      r.letzteRunde = runde;
    }
  }
  if (r.rest === 10) tickerPush(r, `Schlussphase — noch 10 Sekunden!`);
}
function rennBeenden() {
  const r = G.rennen;
  const reihen = [...r.teilnehmer].sort((x, y) => (x.ausgefallen - y.ausgefallen) || (y.dist - x.dist));
  const { pool } = rennQuoten(r);
  /* Nur gemeldete Spielerwagen haben Nenngeld gezahlt — Werkswagen duerfen den
   * Topf also nicht aufblaehen. */
  const zahlende = MODE === "renntag" ? 0 : r.teilnehmer.filter(t2 => !t2.bot).length;
  const topf = RENN_GRUNDPREIS + zahlende * RENN_NENNGELD * 2 + Math.round(pool * WETT_RAKE);
  /* Das Preisgeld geht an die menschlichen Teilnehmer, in ihrer Reihenfolge
   * untereinander. Werkswagen fahren um Ruhm und fuer die Wetten: sie zahlen
   * kein Nenngeld, also nehmen sie auch nichts aus dem Topf — sonst verschwaende
   * jedes Rennen einen Teil dessen, was die Spieler eingezahlt haben. */
  const menschen = reihen.filter(t2 => !t2.bot);
  const anteile = menschen.length >= 3 ? [.5, .3, .2] : menschen.length === 2 ? [.65, .35] : [1];
  reihen.forEach((teil, i) => {
    teil.platz = i + 1;
    const fund = teil.bot ? null : findeAuto(teil.autoId);
    const a = fund?.a;
    const f = teil.bot ? null : G.fahrer.find(x => x.id === teil.fahrerId);
    const kmHeute = Math.round(teil.dist / 10);
    if (a) {
      a.rennen++; a.km = (a.km || 0) + kmHeute;
      a.zustand = Math.max(5, Math.round(a.zustand - (8 + Math.random() * 10) - (teil.ausgefallen ? 10 : 0)));
      if (i === 0 && !teil.ausgefallen) a.siege++;
      (a.historie ??= []).push({ t: G.tick, text: `Rennen: Platz ${i + 1}${teil.ausgefallen ? " (ausgefallen)" : ""} · ${kmHeute} km`, amt: 0 });
    }
    if (f) { f.rennen++; if (i === 0 && !teil.ausgefallen) { f.siege++; f.ruf += 10; } else f.ruf += Math.max(0, 4 - i); }
    /* Letztes Ergebnis festhalten, damit das Startfeld beim naechsten Renntag
     * zeigt, wie der Wagen zuletzt abgeschnitten hat. Beim Werkswagen gehoert
     * es ans Team, es gibt ja kein Auto auf der Karte. */
    /* Fans nach Ergebnis — auch ein Zieleinlauf ohne Podest bringt welche, und
     * selbst ein Ausfall ein wenig: angetreten ist angetreten. */
    if (MODE === "renntag" && !teil.bot) {
      const club = G.players[teil.ownerId];
      if (club) {
        const zu = teil.ausgefallen ? FAN_GEWINN.aus
          : teil.platz === 1 ? FAN_GEWINN.sieg
          : teil.platz === 2 ? FAN_GEWINN.zwei
          : teil.platz === 3 ? FAN_GEWINN.drei : FAN_GEWINN.ziel;
        club.fans = (club.fans || 0) + zu;
      }
    }
    const ergebnis = { platz: teil.platz, aus: !!teil.ausgefallen, feld: r.teilnehmer.length };
    if (teil.bot) { const w = (G.werksTeams || []).find(x => x.id === teil.autoId); if (w) w.letztes = ergebnis; }
    else if (a) a.letztes = ergebnis;
    /* Antrittspraemie fuer jeden gemeldeten Spielerwagen, unabhaengig vom
     * Ergebnis — auch wer ausfaellt, war angetreten. */
    if (MODE === "renntag" && !teil.bot) {
      const club = G.players[teil.ownerId];
      if (club) {
        club.cash += RENN_STARTGELD;
        logTx(club, "Motorsport", `Antrittsprämie: ${teil.name}`, RENN_STARTGELD);
      }
    }
    const preis = teil.bot ? 0 : Math.round(topf * (anteile[menschen.indexOf(teil)] || 0));
    if (preis > 0) {
      const p = G.players[teil.ownerId];
      /* Sponsoren dieses Teams bekommen ihren Anteil vom Preisgeld: je mehr
       * Sponsorgeld floss, desto größer der abgegebene Anteil (Deckel 50 %),
       * untereinander pro rata nach Einsatz. */
      const spons = r.sponsoren.filter(s => s.teamId === teil.ownerId);
      const summe = spons.reduce((s2, s) => s2 + s.betrag, 0);
      const anteil = summe > 0 ? Math.min(.5, summe / (summe + 10000)) : 0;
      let anSponsoren = 0;
      for (const s of spons) {
        const teilBetrag = Math.round(preis * anteil * (s.betrag / summe));
        const sp = G.players[s.playerId];
        if (sp) { sp.cash += teilBetrag; anSponsoren += teilBetrag;
          logTx(sp, "Motorsport", `Sponsoranteil: ${teil.team} wird ${i + 1}.`, teilBetrag); }
      }
      if (p) {
        p.cash += preis - anSponsoren;
        if (a) (a.historie ??= []).push({ t: G.tick, text: `Preisgeld Platz ${i + 1}`, amt: preis - anSponsoren });
        logTx(p, "Motorsport", `Preisgeld: Platz ${i + 1} mit ${teil.name}`, preis - anSponsoren);
      }
    }
  });
  /* Wetten: jeder Markt ist ein eigener Totalisator — der Pool des Markts
   * (abzüglich Rake) geht pro rata an die Gewinner-Einsätze. Gibt es in
   * einem Markt keinen Gewinner, fließen die Einsätze zurück. */
  const sieger = reihen[0];
  const pariAuszahlen = (art, istGewinner, beschreibung) => {
    const einsaetze = r.wetten.filter(w => (w.art || "sieg") === art);
    if (!einsaetze.length) return 0;
    const topfArt = einsaetze.reduce((s, w) => s + w.betrag, 0) * (1 - WETT_RAKE);
    const gewinner = einsaetze.filter(istGewinner);
    const summe = gewinner.reduce((s, w) => s + w.betrag, 0);
    if (!summe) {
      for (const w of einsaetze) {
        const p = G.players[w.playerId];
        if (p) { p.cash += w.betrag; logTx(p, "Motorsport", `${beschreibung}: kein Gewinner — Einsatz zurück`, w.betrag); }
      }
      return 0;
    }
    const quoteArt = topfArt / summe;
    for (const w of gewinner) {
      const p = G.players[w.playerId];
      const gewinn = Math.round(w.betrag * quoteArt);
      if (p) { p.cash += gewinn; logTx(p, "Motorsport", `${beschreibung} gewonnen (Quote ${quoteArt.toFixed(2)})`, gewinn); }
    }
    return quoteArt;
  };
  const quote = pariAuszahlen("sieg", w => w.autoId === sieger.autoId, "Siegwette");
  const podiumIds = new Set(reihen.filter(t2 => t2.platz <= 3 && !t2.ausgefallen).map(t2 => t2.autoId));
  pariAuszahlen("podium", w => podiumIds.has(w.autoId), "Podiumswette");
  const dnfIds = new Set(reihen.filter(t2 => t2.ausgefallen).map(t2 => t2.autoId));
  pariAuszahlen("ausfall", w => dnfIds.has(w.autoId), "Ausfallwette");
  /* Meisterschaftspunkte: nur im Renntag-Modus, nur fuer Spielerwagen —
   * Werksteams fahren um Ruhm, nicht um den Titel. */
  if (MODE === "renntag") {
    let rang = 0;
    for (const teil of reihen) {
      if (teil.bot) continue;
      const punkte = teil.ausgefallen ? 0 : (WM_PUNKTE[rang] || 0);
      rang++;
      if (punkte) G.wm[teil.ownerId] = (G.wm[teil.ownerId] || 0) + punkte;
    }
    G.saisonRennen++;
    if (G.saisonRennen >= SAISON_RENNEN && !G.winner) {
      const beste = Object.entries(G.wm).sort((a2, b2) => b2[1] - a2[1])[0];
      const champ = beste && G.players[beste[0]];
      if (champ) {
        G.winner = champ.name;
        G.report = buildReport(beste[0]);
        io.emit("notice", { text: `Saisonende nach ${SAISON_RENNEN} Renntagen — ${champ.name} ist Meister mit ${beste[1]} Punkten!` });
      }
    }
  }
  r.phase = "ergebnis"; r.rest = 25;
  r.topf = topf;
  r.ergebnis = reihen.map(t2 => ({ platz: t2.platz, name: t2.name, team: t2.team, farbe: t2.livree || t2.farbe,
    fahrer: t2.fahrer, ausgefallen: t2.ausgefallen, dist: Math.round(t2.dist) }));
  io.emit("notice", { text: `🏁 ${sieger.name} (${sieger.team}) gewinnt — ${topf.toLocaleString("de-DE")} $ im Topf${quote ? `, Siegquote ${quote.toFixed(2)}` : ""}!` });
}

const LEVEL_MAX = 5;
const levelMult = level => 1 + 0.3 * ((level || 1) - 1);
const upgradeCost = (bt, level) => ({
  elektronik: Math.ceil(bt.cost / 2500 * level),
  cash: Math.round(bt.cost * 0.35 * level),
});
const BTYPES = {
  /* Grundbedürfnisse (Versorger) */
  ewerk:      { name: "Elektrizitätswerk", en: "Power plant", cost: 2000, out: "strom",    rate: 5,    zone: "industrie", industry: "versorger" },
  wasserwerk: { name: "Wasserwerk", en: "Waterworks",        cost: 1800, out: "wasser",   rate: 5,    zone: "industrie", industry: "versorger" },
  oelpumpe:   { name: "Ölpumpe", en: "Oil pump",           cost: 2500, out: "oel",      rate: 1.2,  zone: "kueste",    industry: "versorger" },
  /* ---- Touristik ----
   * Die erste Branche, die vor allem VERBRAUCHT statt zu produzieren. Ein
   * Strandhotel zieht 150 Wasser und 75 Strom pro Minute — zwei davon binden
   * ein komplettes Wasserwerk. Genau das fehlte: Grundversorgung staute sich
   * bisher ungenutzt an, weil es zu wenige Abnehmer gab. Nebenbei bekommt die
   * Küstenzone endlich einen Zweck; bislang durften dort nur Ölpumpe und
   * Windpark stehen. Werte auf 2,2x Wertschöpfung gerechnet, also auf dem
   * Niveau von Ziegelei, Stahlwerk und Chipfabrik. */
  /* Campingplatz bewusst aufs freie Agrarland statt an die Küste: Dort kostet
   * jede Kachel 700 $ Freischaltung. Der Einstiegsbetrieb muss ohne Vorkasse
   * erreichbar sein — sonst steckt die Branche in einem Teufelskreis fest
   * (gemessen: der Bot verbaute sein ganzes Startkapital in Freischaltungen,
   * konnte danach keinen Strom mehr kaufen, das Hotel stand still und ohne
   * Produktion kam auch kein Geld nach). Die Küste bleibt dem Hotel. */
  campingplatz: { name: "Campingplatz", en: "Campground", cost: 1500, out: "uebernachtung", rate: 10/60, zone: "agrar", industry: "touristik" },
  strandhotel:  { name: "Strandhotel", en: "Beach hotel",  cost: 2400, out: null, rate: 0, zone: "kueste", industry: "touristik",
                  proc: { in: { wasser: 2.5, strom: 1.25 }, out: "uebernachtung", rate: 10/30 } },
  brunnen:    { name: "Brunnen", en: "Well",           cost: 800,  out: "wasser",   rate: 2.5,  zone: "agrar",     industry: "versorger" },
  windpark:   { name: "Windpark", en: "Wind farm",          cost: 2200, out: "strom",    rate: 5,    zone: "kueste",    industry: "versorger" },
  /* Agrarwirtschaft */
  farm:       { name: "Farm", en: "Farm",              cost: 1200, out: "obst",     rate: 0.62, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  plantage:   { name: "Plantage", en: "Plantation",          cost: 2200, out: "kannabis", rate: 0.22, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  imkerei:    { name: "Imkerei", en: "Apiary",           cost: 1400, out: "honig",    rate: 0.42, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  /* Technologie & Elektronik: liefert Elektronik — ab $5.000 Baukosten für ALLE
   * Industrien Pflicht, analog zu Ziegel/Beton der Bauindustrie. */
  siliziummine: { name: "Siliziummine", en: "Silicon mine",    cost: 1400, out: "silizium", rate: 10/30, zone: "industrie", industry: "tech", boosts: ["strom"] },
  /* Rohstoff- & Bauindustrie: fördert Erze und macht daraus das Baumaterial für ALLE */
  mine:       { name: "Mine", en: "Ore mine",              cost: 1400, out: "erze",     rate: 0.383, zone: "industrie", industry: "rohstoff", boosts: ["strom", "oel"] },
  /* Ziegel und Elektronik waren die beiden unattraktivsten Waren der Wirtschaft
   * (Wertschöpfung 1,63x bzw. 1,71x) — obwohl JEDES Gebäude Ziegel und JEDES
   * Upgrade Elektronik braucht. Wer sich dagegen selbst versorgen konnte, verdiente
   * am besten: Medikamente 2,59x ganz ohne fremde Branche. Das Spiel belohnte damit
   * genau das Gegenteil dessen, wofür es gebaut ist. Entschärfte Rezepturen bringen
   * beide auf ~2,2x, also auf Augenhöhe mit Stahl (2,18x). Bewusst über den
   * Materialbedarf statt über den Verkaufspreis: So wird Herstellen lohnender,
   * ohne dass Bauen für alle anderen teurer wird. */
  ziegelei:   { name: "Ziegelei", en: "Brickworks",          cost: 1500, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 0.3, wasser: 0.3 }, out: "ziegel", rate: 10/30 } },
  betonwerk:  { name: "Betonwerk", en: "Concrete plant",         cost: 4000, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 0.8, oel: 0.2 },    out: "beton",  rate: 10/30 } },
  /* Verkaufsgebäude (Shops): Ware + Stückpreis selbst festlegen; verkauft
   * dann passiv. Tempo hängt vom Preis ab: bei Ø-Kurs = volle Rate, teurer
   * = langsamer (Kundschaft überlegt), billiger = schneller (max. ×2). */
  /* Verarbeitung (gehört zur jeweiligen Industrie) */
  saftpresse: { name: "Saftpresse", en: "Juice press",  cost: 2600, out: null, rate: 0, zone: "agrar",     industry: "agrar",    proc: { in: { obst: 1.1 },            out: "saft",    rate: 10/30 } },
  pharma:     { name: "Pharma-Labor", en: "Pharma lab",cost: 8000, out: null, rate: 0, zone: "zentrum",   industry: "agrar",    proc: { in: { kannabis: 0.4 },        out: "medizin", rate: 10/30 } },
  baeckerei:  { name: "Bäckerei", en: "Bakery",    cost: 3400, out: null, rate: 0, zone: "zentrum",   industry: "agrar",    proc: { in: { obst: 1.1, honig: 0.35 }, out: "gebaeck", rate: 10/30 } },
  stahlwerk:  { name: "Stahlwerk", en: "Steel mill",   cost: 6000, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 1.0, oel: 0.2 },  out: "stahl",   rate: 10/30 } },
  raffinerie: { name: "Raffinerie", en: "Refinery",  cost: 4200, out: null, rate: 0, zone: "industrie", industry: "versorger", proc: { in: { oel: 0.5 },             out: "diesel",  rate: 10/30 } },
  chipfabrik: { name: "Chipfabrik", en: "Chip factory",  cost: 3200, out: null, rate: 0, zone: "industrie", industry: "tech",      proc: { in: { silizium: 0.7, strom: 0.5 }, out: "elektronik", rate: 15/30 } },
  /* Fahrzeugbau der Technologie-Industrie: drei Antriebsarten, die jeweils eine
   * andere Industrie mitversorgen — Benzin zieht Öl, Diesel zieht die Raffinerie,
   * Elektro zieht Strom und viel Elektronik. Stahl braucht jedes davon. */
  autowerk:   { name: "Autowerk (Benzin)", en: "Car plant (petrol)",  cost: 6500, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.04, stahl: 0.07, oel: 0.2 },   out: "benzinauto", rate: 10/95 } },
  dieselwerk: { name: "Autowerk (Diesel)", en: "Car plant (diesel)",  cost: 7000, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.04, stahl: 0.07, diesel: 0.1 }, out: "dieselauto", rate: 10/95 } },
  eautowerk:  { name: "Autowerk (Elektro)", en: "Car plant (electric)", cost: 8500, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.1, stahl: 0.07, strom: 1.0 },  out: "eauto",      rate: 10/95 } },
  /* (Hinweis: Rohstoff & Bau sind EINE Industrie — Erzförderung und Baumaterial aus einer Hand) */
  /* Verkauf: darf JEDE Industrie bauen (industry: null) */
  markt:      { name: "Marktstand", en: "Market stall",        cost: 1000, out: null, rate: 0, zone: "zentrum",   retail: { slots: 1, base: 0.5, goods: ["obst", "saft", "honig", "gebaeck"] } },
  bauhandel:  { name: "Baustoffhandel", en: "Builders merchant",    cost: 2800, out: null, rate: 0, zone: "industrie", retail: { slots: 1, base: 0.8, goods: ["erze", "oel", "stahl", "ziegel", "beton", "diesel", "silizium", "elektronik"] } },
  laden:      { name: "Grüner Laden", en: "Green store",      cost: 4500, out: null, rate: 0, zone: "zentrum",   retail: { slots: 1, base: 0.3, goods: ["kannabis", "medizin"] } },
  kontor:     { name: "Handelskontor", en: "Trading house",     cost: 3500, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.7, goods: Object.keys(GOODS).filter(g => !VEHICLES.includes(g) && !WEAPONS.includes(g) && !ILLEGAL.includes(g)) } },
  autohaus:   { name: "Autohaus", en: "Car dealership",           cost: 5000, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.30, goods: VEHICLES } },
  /* ---- Software & Digitales ----
   * Das Studio macht aus Strom und etwas Elektronik Entwicklungspunkte (EP),
   * daraus entstehen Versionen eines Shop-Systems. Das Rechenzentrum trägt
   * die Kunden: je Stufe 5 Online-Marktplätze, ohne Strom fällt es aus. */
  /* Beide bewusst unter 4.000 $ (kein Beton) und im Zentrum: Die Branche hat
   * vor ihren ersten Kunden keinerlei Einnahmen. Gemessen mit Studio 4.000 $
   * und Rechenzentrum 6.000 $ in der Industriezone (+2.500 $ Freischaltung):
   * Byteforge kam in 30 Spielminuten nie über das Studio hinaus, sein System
   * hatte 0 Plätze, und kein einziger Marktplatz konnte es nehmen.
   * Stromverbrauch so, dass fünf Kunden das Rechenzentrum deutlich tragen. */
  entwicklerstudio: { name: "Entwicklerstudio", en: "Dev studio", cost: 3000, out: null, rate: 0, zone: "zentrum", industry: "software",
                      studio: { in: { strom: 0.3, elektronik: 0.005 }, ep: 1 } },
  rechenzentrum:    { name: "Rechenzentrum", en: "Data centre", cost: 3500, out: null, rate: 0, zone: "zentrum", industry: "software",
                      rz: { in: { strom: 0.3 }, plaetze: 5 } },
  /* Online-Marktplatz: der EINZIGE Laden. Er führt alle Waren, die früher
   * Marktstand, Baustoffhandel, Kontor, Grüner Laden, Autohaus und
   * Waffenhandel verkauften — nur Kartell-Ware nicht. Verkauf an die Stadt
   * (frisches Geld) läuft nur noch hier, und erst mit installiertem
   * Shop-System. 3 Regale, jede Ausbaustufe bringt eines dazu. */
  onlinemarkt: { name: "Online-Marktplatz", en: "Online marketplace", cost: 3000, out: null, rate: 0, zone: "zentrum", online: true,
                 retail: { slots: 3, base: 0.6, goods: Object.keys(GOODS).filter(g => !ILLEGAL.includes(g) && !NUR_FIRMEN.includes(g)) } },
  /* ---- Rüstungsindustrie ----
   * Die Branche am Ende der Kette: Sie verarbeitet, was Rohstoff und
   * Technologie liefern, und erzeugt die wertvollsten Güter im Spiel. Ihre
   * Werte sind auf 2,2x Wertschöpfung und rund fünf Minuten Amortisation
   * gerechnet, also auf dem Niveau von Stahlwerk und Chipfabrik. Der Einstieg
   * über die Munitionsfabrik ist billig und braucht nur Erze und Öl; wer
   * Panzer bauen will, hängt dagegen an drei fremden Branchen gleichzeitig. */
  munitionsfabrik: { name: "Munitionsfabrik", en: "Ammunition factory", cost: 1400, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { erze: 0.18, oel: 0.13 }, out: "munition", rate: 10/30 } },
  waffenschmiede:  { name: "Waffenschmiede", en: "Gunsmith",  cost: 4000, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { stahl: 0.055, elektronik: 0.030, munition: 0.075 }, out: "pistole", rate: 10/45 } },
  panzerwerk:      { name: "Panzerwerk", en: "Tank works",      cost: 8000, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { stahl: 0.105, elektronik: 0.055, diesel: 0.070 }, out: "panzer", rate: 10/95 } },
  waffenhandel:    { name: "Waffenhandel", en: "Arms dealer",    cost: 5200, out: null, rate: 0, zone: "zentrum",
                     retail: { slots: 2, base: 0.30, goods: WEAPONS } },
  /* ---- Motorsport ----
   * Zulieferung und Rennstall. Die beiden Werke gehören bestehenden Branchen
   * und sind wie deren übrige Gebäude auf rund 2x Wertschöpfung und etwa fünf
   * Minuten Amortisation gerechnet: Rennreifen kosten 82,50 $ an Zutaten bei
   * 165 $ Verkaufswert, Rennsoftware 105 $ bei 210 $.
   * Der Rennstall selbst produziert nichts. Er ist reiner Abnehmer und darf
   * deshalb — wie die Verkaufsgebäude — von JEDER Industrie gebaut werden
   * (industry weggelassen). Genau EINER je Firma, geprüft im "build"-Handler. */
  reifenwerk: { name: "Rennreifenwerk", en: "Racing tyre plant", cost: 5500, out: null, rate: 0, zone: "industrie", industry: "rohstoff",
                proc: { in: { oel: 1.333, stahl: 0.0667 }, out: "rennreifen", rate: 10/45 } },
  rennlabor:  { name: "Renn-Softwarelabor", en: "Racing software lab", cost: 6500, out: null, rate: 0, zone: "zentrum", industry: "tech",
                proc: { in: { elektronik: 0.2, silizium: 0.07 }, out: "rennsoftware", rate: 10/50 } },
  /* Ein Auto, das hier einzieht, verlässt das Warenlager endgültig: Es ist
   * danach keine handelbare Ware mehr, sondern Inventar dieser Kachel. Zu Geld
   * machen lässt sich nur noch der ganze Stall samt Fahrzeugen, über die
   * Versteigerung an der Stadtbank. Deshalb sperrt der "demolish"-Handler den
   * Abriss, solange Autos darin stehen — sonst wäre der Abriss ein
   * Schlupfloch, das genau diese Regel umgeht. */
  /* 30.000 $ statt der ursprünglichen 7.500: Bei einer Freischaltung ab
   * 200.000 $ Nettovermögen wäre der alte Preis Kleingeld gewesen. So sind es
   * rund 15 % des Vermögens, das man zum Einstieg braucht — eine spürbare
   * Entscheidung, und der Ausbau (er rechnet mit bt.cost) staffelt sich
   * entsprechend: Stufe 2 kostet 12 Elektronik und 10.500 $, Stufe 5 dann
   * 60 Elektronik und 52.500 $. */
  rennstall:  { name: "Rennstall", en: "Racing stable", cost: 30000, out: null, rate: 0, zone: "industrie", racing: true },
  /* Familien-Gebäude (Kartellmodus): je eines pro Familie, nur von deren
   * Mitgliedern baubar. Die Zutaten kommen aus der legalen Wirtschaft —
   * die Fassade ernährt das Geschäft. Raten so gesetzt, dass jede Familie
   * nach Abzug der Zutaten in derselben Gewinnliga spielt (~15–25 $/s). */
  destille:       { name: "Destille", en: "Moonshine still",              cost: 3200, out: null, rate: 0, zone: "agrar",     familie: "famiglia",
                    proc: { in: { obst: 2, wasser: 1 },   out: "schnaps",    rate: .35 } },
  druckerei:      { name: "Falschgeld-Druckerei", en: "Counterfeit shop", cost: 4200, out: null, rate: 0, zone: "zentrum",   familie: "syndikat",
                    proc: { in: { strom: 2, elektronik: .04 }, out: "falschgeld", rate: .2 } },
  goldschmelze:   { name: "Goldschmelze", en: "Gold smelter",             cost: 4800, out: null, rate: 0, zone: "industrie", familie: "bratwa",
                    proc: { in: { erze: 3, strom: 1 },    out: "goldbarren", rate: .3 } },
  schmuggellager: { name: "Schmuggellager", en: "Smuggling depot",        cost: 3600, out: null, rate: 0, zone: "kueste",    familie: "triade",
                    proc: { in: { kannabis: .5 },         out: "zigaretten", rate: .6 } },
  /* Illegales Casino (Kartellmodus, jede Familie): kein Produktionsgebäude,
   * sondern ein Spieltisch — Mitspieler zocken hier 17+4 gegen die Kasse des
   * Besitzers. Einsätze und Gewinne fließen direkt zwischen den Spielern. */
  casino: { name: "Illegales Casino", en: "Illegal casino", cost: 6000, out: null, rate: 0, zone: "zentrum", casino: true },
  /* Werbeagentur: produziert nichts und verkauft nichts. Sie schaltet
   * Kampagnen frei, die den Preis anheben, den die Kundschaft in den EIGENEN
   * Läden ohne Tempoverlust akzeptiert. Darf jede Industrie bauen. */
  werbeagentur: { name: "Werbeagentur", en: "Ad agency",     cost: 3500, out: null, rate: 0, zone: "zentrum",   ad: true },
  /* Nur im Renntag und nur fuer Race Clubs (siehe RENNTAG_BAUTEN). Erzeugt als
   * einziges Gebaeude im Spiel direkt Bargeld — der Ertrag laeuft deshalb
   * ueber addRevenue, damit Umsatz, Firmenwert und Rangliste stimmig bleiben. */
  fanhub:       { name: "Fan-Hub", en: "Fan hub",            cost: 4500, out: null, rate: 0, zone: "zentrum",   fanhub: true },
};
/* Verkaufstempo eines Shops: (Ø-Kurs / eigener Preis)² — gedeckelt bei ×2 */
/* Verkaufstempo eines Shops: (Ø-Kurs / eigener Preis)² — gedeckelt bei ×2.
 * Mit `ref` lässt sich der Bezugspreis anheben: genau das macht Werbung. */
const shopSpeed = (good, price, ref = MM[good].price) => Math.min(2, Math.pow(ref / price, 2));

/* Ein Laden-Slot bewegte bisher gleich viele STÜCK pro Sekunde, egal ob Strom
 * für 1,80 $ oder ein Auto für 300 $. Dadurch hätte ein Elektrizitätswerk mit
 * 5 Strom/s über sieben Slots gebraucht, um seinen Ausstoß überhaupt loszuwerden
 * (bei 1,30 $/s je Slot), während ein Autowerk mit 0,15 Slots auskam. Der
 * Durchsatz wird deshalb am Stückwert skaliert: billige Massenware fließt
 * schneller durch den Laden als teure Einzelstücke. Der Exponent unter 1 dämpft
 * das, damit teure Ware je Slot weiterhin mehr einbringt — sie ist ja auch
 * aufwendiger herzustellen. Bezug ist der Basispreis, nicht der Tageskurs:
 * sonst entstünde eine Rückkopplung (Preis fällt -> mehr Durchsatz -> Preis
 * fällt weiter). */
const RETAIL_REF = 30, RETAIL_K = 0.75;
const retailFlow = good => Math.min(STADT_FLOW_MAX[good] ?? 10, Math.max(0.30, Math.pow(RETAIL_REF / BASEP[good], RETAIL_K)));

/* ---------- Werbung ----------
 * Reichweite ist ein Vorrat, der laufend zerfällt: gebuchte Kampagnen füllen ihn
 * auf, ohne Nachschub ist er nach gut zwei Minuten praktisch weg und die Preise
 * fallen auf den Ø-Kurs zurück. Wie hoch der Aufschlag maximal reichen kann,
 * hängt an der Zahl der eigenen Werbeagenturen — ohne Agentur wirkt gar nichts. */
/* ---- Fanbasis (Race Day) ----
 * Sportlicher Erfolg wird zu Fans, Fans werden im Fan-Hub zu laufendem Geld.
 * Aufgebaut wie die Werbereichweite (adReach): eine Zahl je Spieler, die
 * jeden Tick zerfaellt und deren Ertrag an der Zahl der Gebaeude haengt.
 *
 * Der Zerfall ist der Kern: Ohne ihn truege ein frueher Sieg die ganze Runde.
 * Halbwertszeit rund acht Minuten — viel langsamer als Werbung (57 s), eine
 * Fanbasis ist kein Werbespot, aber wer aufhoert zu fahren, verliert sie. */
const FAN_ZERFALL = 0.99856;          // je Tick ≈ 8 min Halbwertszeit
const FAN_GEWINN = { sieg: 400, zwei: 250, drei: 160, ziel: 80, aus: 30 };
const FAN_ERTRAG = 0.01;              // $ je Fan und Sekunde (0,6 $/Fan/Minute)
const FAN_TAKT = 30;                  // Auszahlung alle 30 s, sonst flutet es das Finanzlog
/* Mehrere Hubs mit abnehmendem Ertrag, gedeckelt — wie bei den Werbeagenturen. */
const fanHubs = p => G.map.filter(t => t.owner === p.id && BTYPES[t.btype]?.fanhub);
const fanFaktor = n => n <= 0 ? 0 : Math.min(1.5, 1 + 0.25 * (n - 1));

const AD_DECAY = 0.988;          // je Tick, entspricht ~1,2 %/s (Halbwertszeit ~57 s)
/* Preise gegen den tatsächlichen Nutzen gerechnet: eine volle Reichweite wirkt
 * wegen des Zerfalls wie rund 83 Sekunden Vollaufschlag. Bei 20 % Aufschlag
 * bringt sie also etwa 16,6 Sekunden Ladenumsatz zusätzlich. Zu den alten
 * Preisen hätte sich eine Kampagne erst ab 300–480 $/s Ladenumsatz gelohnt —
 * das schafft kein Laden im Spiel, Werbung war schlicht eine Geldfalle.
 * Jetzt liegt der Break-even bei rund 55 $/s — ein gut beliefertes Handelskontor
 * trägt eine Kampagne also gerade so, zwei Läden lohnen sich deutlich. Wer die
 * Reichweite dauerhaft oben hält, zahlt rund 11 $/s Unterhalt. */
const AD_PACKAGES = {
  klein:  { name: "Aushänge & Flyer",    cost:  280, reach: 30 },
  mittel: { name: "Radio & Lokalpresse", cost:  620, reach: 70 },
  gross:  { name: "Stadtweite Kampagne", cost:  950, reach: 100 },
};
const adAgenturen = p => G.map.filter(t => t.owner === p.id && BTYPES[t.btype]?.ad).length;
const adCap = n => n <= 0 ? 0 : Math.min(0.40, 0.20 + 0.10 * (n - 1));
/* Preisaufschlag, den die Kundschaft ohne Tempoverlust mitgeht (1 = keine Werbung) */
/* Sandbox: Werbung kommt aus dem Werbemodul eines Shop-Systems (siehe
 * swTick), die Werbeagentur gibt es dort nicht mehr. Andere Modi wie bisher. */
const adBoost = p => MODE === "sandbox"
  ? 1 + (G.werbeAktiv?.has(p.id) ? SW.WERBE_BOOST : 0)
  : 1 + adCap(adAgenturen(p)) * Math.min(100, p.adReach || 0) / 100;
const PRODUCTS = Object.keys(GOODS);   // was Städte in Großaufträgen nachfragen — mittlerweile alle Waren

/* Gruppenaufträge: eine Stadt braucht Waren, alle zahlen gemeinsam ein.
 * Bei Abschluss erhält jeder Einzahler Ø-Kurs × 2 je geliefertem Stück. */
const CITIES = ["Hamcity", "Bergstadt", "Neuhafen", "Ostbrück", "Klarwald", "Südport"];
const GROUP_PAYOUT_MULT = 2;
const GROUP_TTL = 300;                                          // Laufzeit eines Großauftrags: 5 Minuten
const GROUP_GAP = () => 15 + Math.floor(Math.random() * 30);    // Pause danach: 15–45 s
const GROUP_VALUE = +process.env.GROUP_VALUE || 0;   // Testgröße überschreibbar

/* Aktien: jede Firma startet mit 4 Anteilen (= 25 %-Schritten) im Eigenbesitz.
 * Reicht das Kapital nicht, können eigene Anteile an der Börse verkauft werden —
 * Käufer bekommen dafür alle 10 min einen Anteil vom laufenden Erlös (Dividende). */
const BANK_POS = [7, 6];         // feste Position der Stadtbank im Zentrum
const NEWS_POS = [10, 6];        // Nachrichtenzentrale, ebenfalls im Zentrum
const SHARE_BID_TTL = 180;       // Kaufanfragen verfallen nach 3 Minuten
const CONTRACT_TTL = 120;        // Direktangebote verfallen nach 2 Minuten
const REV_WINDOW_MIN = 10;       // Umsatzfenster der Firmenbewertung: 10 Minuten
const DIVIDEND_INTERVAL = 600;   // Ticks (1×/s) = 10 min
const DIVIDEND_RATE = 0.25;      // Anteil des seit der letzten Ausschüttung erzielten Erlöses

/* Reconnect: Verbindung weg ≠ sofort raus — erst nach dieser Gnadenfrist ohne
 * Rückkehr wird der Spieler endgültig entfernt (siehe rejoin-Handler & runTick). */
const RECONNECT_GRACE_MS = 5 * 60 * 1000;   // 5 Minuten

/* $7.000 Start: deckt die Tutorial-Gebäude Farm+Plantage+Vertriebsbüro ($5.900) plus Puffer */
/* Siegziel $250k ≈ 1–2 h Partie (Playtest: ~$1k/min Anfangswachstum, skaliert später).
 * Überschreibbar: WIN_NW=1000000 npm start */
/* $8.500 deckt in jeder Industrie 2 Grundgebäude + 1 Verarbeitungsgebäude:
 * Agrar 2×Farm+Saftpresse=$5.600, Rohstoff 2×Mine+Betonwerk=$8.000,
 * Versorger Brunnen+Wasserwerk+Ölpumpe=$5.100, Tech 2×Siliziummine+Chipfabrik=$6.000
 * (Zonen-Freischaltung kommt on top, dafür gibt's die Starter-Aufgabe +$1.000). */
const START_CASH = +process.env.START_CASH || 9500;
/* Die Kartengroesse haengt an der Karte, nicht am Spiel: der Sandkasten und
 * die Planwirtschaft laufen auf 26x26, die gebackene San-Francisco-Karte auf
 * 64x64. buildMap() und der Kartenlader setzen beides, alles andere liest es. */
let MAP_W = 26, MAP_H = 26;

/* Spielergesteuerte Texte — Firmenname und Chatnachricht — landen im Client an
 * rund einem Dutzend Stellen in innerHTML: Kopfleiste, Kurstafel, Orderbuch,
 * Anleihenliste, Verträge, Chat und jetzt auch im Marktbericht. Eine einzige
 * dieser Stellen ohne Maskierung genügt, damit ein Mitspieler fremden Code in
 * den Browsern aller anderen ausführt. Statt jede Ausgabestelle einzeln
 * abzusichern — und dabei eine zu übersehen — wird hier an der Quelle
 * maskiert: Was gespeichert wird, ist bereits unschädlich.
 * Vergleiche bleiben stimmig, weil beide Seiten dieselbe Form sehen. */
const sicherText = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Die Firmenfarbe wurde ungeprüft übernommen und landet im Client in
 * Stil-Attributen (style="background:${p.color}"). Ein Wert wie
 * '#fff" onmouseover="…' bricht dort aus dem Attribut aus und hängt einen
 * Ereignis-Handler an — Maskieren allein hilft nicht, weil eine Farbe
 * ohnehin nur aus Ziffern und Buchstaben bestehen darf. Deshalb hart
 * geprüft statt entschärft: Was nicht wie eine Hex-Farbe aussieht, wird
 * durch die Vorgabe ersetzt. */
const STANDARDFARBE = "#e8b544";
const sichereFarbe = c => /^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c) : STANDARDFARBE;
/* Rundenziel: Default $250k ≈ 1–2 h; der ERSTE Spieler der Runde legt es beim
 * Beitreten fest (Auswahl im Join-Screen). Env-Override: WIN_NW=... npm start */
let WIN_NW = +process.env.WIN_NW || 250_000;
const WIN_CHOICES = [100_000, 250_000, 500_000, 1_000_000, 10_000_000];
/* ---- Meisterschaft (Race Day) ----
 * Der Renntag-Modus hatte bisher dieselbe Siegbedingung wie der Sandkasten:
 * das hoechste Nettovermoegen. In einem Rennmodus soll aber gewinnen, wer
 * faehrt — also Punkte je Rennen und ein Titel am Saisonende.
 * Punkte nur fuer die ersten sechs, wie ueblich; wer ausfaellt, bekommt nichts. */
const WM_PUNKTE = [10, 6, 4, 3, 2, 1];
const SAISON_CHOICES = [3, 5, 8, 12];
let SAISON_RENNEN = 5;

/* ---------- Spielmodus ----------
 * "sandbox": die freie Marktwirtschaft wie bisher.
 * "plan": Planwirtschaft im DDR-Stil — kein Vermögensziel, sondern Plansolls
 * vom Planbüro. Spieler liefern Waren zu festen Ankaufspreisen ab und sammeln
 * Planpunkte; nach fünf Planphasen (oder beim Punkteziel) gewinnt der
 * "Held der Arbeit".
 * "kartell": Kartellwirtschaft — dasselbe Vermögensziel wie im Sandkasten, aber
 * Spieler dürfen sich zu Kartellen zusammenschließen und den Markt unter sich
 * ausmachen, solange das Kartellamt ihnen nichts nachweisen kann.
 * Der Host wählt den Modus im Warteraum. */
let MODE = "sandbox";
const PLAN_PHASEN = 5;
const PLAN_DAUER = 8 * 60;      // Sekunden je Planphase
const PLAN_ZIEL = 1000;         // Planpunkte für den vorzeitigen Sieg
/* Freischaltung von Zonen: bewusst als Formalität, nicht als Kapitalgrab.
 * Die Agrarzone ist frei, Industrie und Küste nicht — bei 900/2.500 $ je Kachel
 * steckte ein Versorger 40 % seines Startkapitals in reinen Landzutritt, der
 * nichts produziert, ein Agrarspieler dagegen 0 %. Bei gleicher Rendite je
 * Dollar entscheidet aber genau das, wer schneller wächst. Mit 300/700 $ bleibt
 * die Zone eine bewusste Entscheidung, ohne die Branche auszubremsen. */
const UNLOCK = { industrie: 300, kueste: 700 };
const ROOMS = ["[Game]", "[Sales]", "[DE] Spielthemen", "[DE] Handel", "[DE] Plauderecke"];

/* ---------- Gebackene Karten ----------
 * Der Einsteiger-Modus laeuft auf einer echten Stadt: maps/sanfrancisco.json
 * entsteht offline aus einem topoexport-DXF (siehe tools/build-sf-map.py) und
 * liegt fertig im Repository, damit der Server keine Geodaten-Bibliothek
 * braucht. Sie bringt ihre eigenen Fahrspuren mit — die echten Strassenzuege
 * laufen diagonal, aus geraden Gitterzeilen liesse sich dort kein Verkehr
 * ableiten. Quellen und Lizenz: maps/ATTRIBUTION.md */
let MAP_ROUTES = null;          // Fahrspuren der aktuellen Karte, null = aus dem Gitter ableiten
let BAKED = null;
function ladeGebackeneKarte(datei = "sanfrancisco.json") {
  if (!BAKED) BAKED = JSON.parse(fs.readFileSync(path.join(__dirname, "maps", datei), "utf8"));
  const k = BAKED;
  MAP_W = k.w; MAP_H = k.h;
  MAP_ROUTES = k.routes;
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const z = k.tiles[y][x];
    const water = z === "~", road = z === "#", park = z === '"';
    const dichte = +k.dichte[y][x];
    /* Die Zonen stecken schon in der Karte: der Konverter leitet sie aus der
     * geglaetteten Bebauungsintensitaet ab (Anzahl x Hoehe ueber 3x3, danach
     * Perzentile). So liegt die Innenstadt da, wo sie in der Stadt auch liegt,
     * statt in einem gemalten Kreis. */
    const zc = k.zonen[y][x];
    const zone = water ? "wasser" : zc === "Z" ? "zentrum" : zc === ":" ? "industrie" : "agrar";
    tiles.push({ x, y, zone, road, water, locked: false, unlockCost: 0,
      park, field: !water && !road && !park && dichte === 0 && +k.baeume[y][x] > 0,
      owner: null, btype: null, lien: false });
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : tiles[y * MAP_W + x];
  for (const t of tiles) {
    const nb = [at(t.x+1,t.y), at(t.x-1,t.y), at(t.x,t.y+1), at(t.x,t.y-1)];
    if (!t.water && nb.some(n => n?.water)) t.sand = true;
    if (t.water && !nb.some(n => n && !n.water)) t.deep = true;
  }
  /* Bank und Nachrichtenzentrale in die dichteste Ecke der Innenstadt, aber
   * nicht auf eine Strasse — sonst fehlt dem Verkehr eine Spur. */
  const frei = tiles.filter(t => t.zone === "zentrum" && !t.road && !t.water && !t.park);
  const mitte = [MAP_W / 2, MAP_H / 2];
  frei.sort((a, b) => Math.hypot(a.x-mitte[0], a.y-mitte[1]) - Math.hypot(b.x-mitte[0], b.y-mitte[1]));
  if (frei[0]) Object.assign(frei[0], { bank: true, park: false, field: false });
  const news = frei.find(t => !t.bank && Math.hypot(t.x-frei[0].x, t.y-frei[0].y) > 2);
  if (news) Object.assign(news, { news: true, park: false, field: false });
  return tiles;
}

/* ---------- Stadtflaechen ----------
 * Ein Generator fuer alle von Hand entworfenen Karten. Der erste Versuch nahm
 * einen echten Stadtausschnitt aus CAD-Daten; das sah schlecht aus, weil aus
 * 18 m je Kachel ein Flickenteppich aus Strassenstummeln und riesigen
 * einfarbigen Feldern wurde. Eine Spielkarte braucht Lesbarkeit, keine
 * Katastergenauigkeit.
 *
 * Ueber die Optionen unterscheiden sich die Flaechen deutlich, ohne dass es
 * zwei Generatoren braucht:
 *   ufer    "ecke" = diagonale Bucht in einer Ecke, "sued" = Kueste ueber die
 *           ganze Unterkante mit vorgelagerter Halbinsel
 *   sperren Industrie und Kueste kosten Zutritt (Sandkasten) oder nicht
 *           (Einsteiger — dort soll nichts im Weg stehen)
 *   deko    wie viele Hochhaeuser als Kulisse ins Zentrum kommen
 *   seed    verschiebt das Rauschen, damit zwei Karten nicht gleich aussehen */
function buildStadtMap({ w = 32, h = 32, seed = 0, ufer = "ecke",
                         sperren = false, deko = 4, raster = 6, inseln = [] } = {}) {
  MAP_W = w; MAP_H = h; MAP_ROUTES = null;
  const noise = (x, y) => {
    const n = Math.sin((x + seed) * 12.9898 + (y + seed * 1.7) * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  /* Wasserfeld, danach zweimal Mehrheitsglaettung gegen Sprenkel. */
  let wat = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const tiefe = ufer === "sued"
      ? y - (MAP_H - 5.5) + Math.max(0, (x - MAP_W * .62)) * .12
      : (x + y) - (MAP_W + MAP_H - 17);
    wat.push(tiefe + (noise(x, y) - .5) * 3 > 0);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = [...wat];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let n = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) {
          n += (ufer === "sued" ? yy >= MAP_H : (xx >= MAP_W || yy >= MAP_H)) ? 1 : 0; c++; continue;
        }
        n += wat[yy * MAP_W + xx] ? 1 : 0; c++;
      }
      next[y * MAP_W + x] = n > c / 2;
    }
    wat = next;
  }
  /* Inseln und Halbinseln: bebaubares Land mit Aussicht statt leerer Flaeche. */
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++)
    if (inseln.some(([ix, iy, r]) => Math.hypot(x - ix, y - iy) < r)) wat[y * MAP_W + x] = false;

  const mx = (MAP_W - 1) / 2, my = (MAP_H - 1) / 2;
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const water = wat[y * MAP_W + x];
    const road = !water && (x % raster === 3 || y % raster === 3);
    /* Ganze Blocks als Park statt einzelner Streukacheln — ein Stadtpark liest
     * sich als Ort, verteilte Einzelbaeume nur als Rauschen. */
    const bx = Math.floor(x / raster), by = Math.floor(y / raster);
    const park = !water && !road && (bx * 7 + by * 13 + seed) % 7 === 0;
    let zone = "agrar";
    if (water) zone = "wasser";
    /* Radius 0,30 statt 0,24: Laeden duerfen nur im Zentrum stehen, und mit
     * dem kleineren Kreis blieben auf 30x30 nur 73 freie Kacheln fuer bis zu
     * acht Spieler. Die alte Sandkasten-Flaeche hatte anteilig ein Drittel
     * Innenstadt — darunter wird es eng. */
    else if (Math.hypot(x - mx, y - my) < Math.min(MAP_W, MAP_H) * .30) zone = "zentrum";
    tiles.push({ x, y, zone, road, water, locked: false, unlockCost: 0, park,
      field: false, owner: null, btype: null, lien: false });
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : tiles[y * MAP_W + x];
  /* Kueste und Industrie haengen am Wasser, nicht an einem gemalten Band:
   * was nah am Ufer liegt, ist Kueste; der Streifen dahinter Hafenindustrie. */
  for (const t of tiles) {
    if (t.water || t.zone === "zentrum") continue;
    let d = 99;
    for (let r = 1; r <= 6 && d === 99; r++)
      for (let dy = -r; dy <= r && d === 99; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (at(t.x + dx, t.y + dy)?.water) { d = Math.max(Math.abs(dx), Math.abs(dy)); break; }
    /* Der Hafenguertel reicht weit landeinwaerts. Weil das Wasser nur an einer
     * Kante liegt, bleibt er sonst ein schmaler Streifen: bei fuenf Kacheln
     * Tiefe waren nach Strassen, Parks und Zentrum noch 32 bebaubare Kacheln
     * uebrig, bei acht 44 — die alte Sandkasten-Flaeche bot rund 95. */
    if (d <= 2) t.zone = "kueste";
    else if (d <= 12) t.zone = "industrie";
  }
  /* Nur das groesste zusammenhaengende Strassennetz behalten. Auf einer Insel
   * entstuende sonst ein eigenes Kreuz, das an nichts anschliesst und wie ein
   * Zeichenfehler aussieht. Eine Stadt hat ein Netz, nicht mehrere. */
  {
    const gesehen = new Set(); const gruppen = [];
    for (const start of tiles) {
      if (!start.road || gesehen.has(start)) continue;
      const gruppe = [], stapel = [start];
      gesehen.add(start);
      while (stapel.length) {
        const t = stapel.pop(); gruppe.push(t);
        for (const n of [at(t.x+1,t.y), at(t.x-1,t.y), at(t.x,t.y+1), at(t.x,t.y-1)])
          if (n?.road && !gesehen.has(n)) { gesehen.add(n); stapel.push(n); }
      }
      gruppen.push(gruppe);
    }
    gruppen.sort((a, b) => b.length - a.length);
    for (const g of gruppen.slice(1)) for (const t of g) t.road = false;
  }
  /* Deko-Felder nur im Ackerland und abseits der Strassen. */
  for (const t of tiles)
    if (t.zone === "agrar" && !t.road && !t.park && (t.x * 5 + t.y * 11) % 9 === 0) t.field = true;
  for (const t of tiles) {
    const nb = [at(t.x+1,t.y), at(t.x-1,t.y), at(t.x,t.y+1), at(t.x,t.y-1)];
    if (!t.water && nb.some(n => n?.water)) t.sand = true;
    if (t.water && !nb.some(n => n && !n.water)) t.deep = true;
    if (t.water && (t.x * 3 + t.y * 17) % 19 === 0) t.rock = true;
  }
  /* Zutritt zu Industrie und Kueste kostet — aber bewusst als Formalitaet,
   * nicht als Kapitalgrab (siehe UNLOCK). Im Einsteiger-Modus entfaellt es. */
  if (sperren) for (const t of tiles) {
    if (t.water || t.road || t.park) continue;
    if (t.zone === "industrie" || t.zone === "kueste") {
      t.locked = true; t.unlockCost = UNLOCK[t.zone] || 0;
    }
  }
  /* Bank und Nachrichtenzentrale an die Hauptkreuzung im Zentrum, aber neben
   * die Strasse — auf der Fahrbahn fehlte dem Verkehr sonst eine Spur. */
  const zentral = tiles.filter(t => t.zone === "zentrum" && !t.road && !t.water && !t.park)
    .sort((a, b) => Math.hypot(a.x-mx, a.y-my) - Math.hypot(b.x-mx, b.y-my));
  if (!zentral.length) return tiles;
  Object.assign(zentral[0], { bank: true, park: false, field: false, locked: false, unlockCost: 0 });
  const news = zentral.find(t => !t.bank && Math.hypot(t.x - zentral[0].x, t.y - zentral[0].y) > 4.5);
  if (news) Object.assign(news, { news: true, park: false, field: false, locked: false, unlockCost: 0 });
  /* Hochhaeuser als reine Kulisse: Sie geben der Innenstadt eine Skyline,
   * gehoeren aber niemandem und lassen sich nicht bebauen. Verteilt statt
   * nebeneinander — ein Block aus Tuermen sieht aus wie ein Zaun. */
  let gesetzt = 0;
  for (const t of zentral) {
    if (gesetzt >= deko) break;
    if (t.bank || t.news) continue;
    /* Abstand 2,5 statt 3: dichter beieinander wirkt die Innenstadt belebt,
     * ohne dass die Tuerme zu einer geschlossenen Wand zusammenlaufen. Zur
     * Bank und zur Nachrichtenzentrale bleibt es bei drei Kacheln, damit ihre
     * Beschriftung frei steht. */
    const nah = tiles.some(o => (o.bank || o.news) && Math.hypot(o.x - t.x, o.y - t.y) < 3)
             || tiles.some(o => o.deko && Math.hypot(o.x - t.x, o.y - t.y) < 2.5);
    if (nah) continue;
    Object.assign(t, { deko: (gesetzt % 4) + 1, park: false, field: false, locked: false, unlockCost: 0 });
    gesetzt++;
  }
  return tiles;
}

/* ---------- Karte (deterministisch, damit alle Clients identisch rendern) ---------- */
/* Das Finanzamt steht als städtisches Gebäude im Zentrum, mit Abstand zu Bank
 * und Nachrichtenzentrale, damit die Beschriftungen frei bleiben. Im Kartell-
 * und Planmodus gibt es kein Finanzamt. */
function buildMap(mode = "sandbox") {
  const tiles = buildMapRoh(mode);
  if (mode !== "kartell" && mode !== "plan") {
    const bank = tiles.find(t => t.bank);
    const frei = tiles.filter(t => t.zone === "zentrum" && !t.road && !t.water && !t.park && !t.bank && !t.news && !t.finanzamt && !t.deko && !t.owner
      && !tiles.some(o => (o.bank || o.news || o.deko) && Math.hypot(o.x - t.x, o.y - t.y) < 2.5));
    if (bank) frei.sort((a, b) => Math.hypot(a.x - bank.x, a.y - bank.y) - Math.hypot(b.x - bank.x, b.y - bank.y));
    if (frei[0]) Object.assign(frei[0], { finanzamt: true, park: false, field: false, locked: false, unlockCost: 0 });
  }
  return tiles;
}
function buildMapRoh(mode = "sandbox") {
  /* Einsteiger und Sandkasten laufen beide auf einer entworfenen Stadt, aber
   * mit deutlich anderer Flaeche. Nur die Planwirtschaft benutzt noch den
   * prozeduralen Code weiter unten. */
  if (mode === "einsteiger")
    return buildStadtMap({ w: 32, h: 32, seed: 0, ufer: "ecke", sperren: false,
                           deko: 6, inseln: [[26, 26, 2.6]] });
  if (mode === "sandbox")
    return buildStadtMap({ w: 30, h: 30, seed: 71, ufer: "sued", sperren: true,
                           deko: 9, inseln: [[6, 27, 2.2], [21, 28, 2.8]] });
  /* Race Day: nichts gesperrt — jeder soll sofort losfahren koennen, nicht
   * erst Land freikaufen. */
  if (mode === "renntag")
    return buildStadtMap({ w: 30, h: 30, seed: 137, ufer: "ecke", sperren: false,
                           deko: 7, inseln: [[7, 25, 2.4]] });
  /* Kartellmodus: eine alte italienische Küstenstadt. 27x27, damit die neun
   * Bezirke exakt 9x9 groß sind und die beiden Hauptstraßen-Kreuze (x/y = 8
   * und 17) genau auf den Bezirksgrenzen liegen. Enge, versetzte Gassen in
   * den Vierteln, eine Piazza mit dem Bankpalazzo in der Mitte, Weinberge im
   * Umland, Mittelmeer im Süden — und NICHTS ist gesperrt: Der Modus soll
   * Spaß machen, nicht Bauland verkaufen. */
  if (mode === "kartell") {
    MAP_W = 27; MAP_H = 27; MAP_ROUTES = null;
    const noise = (x, y) => {
      const n = Math.sin((x + 53) * 12.9898 + (y + 17) * 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    /* Mittelmeer: Bucht im Süden, sanft ausgefranst. */
    let wat = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++)
      wat.push((y - (MAP_H - 3.4)) + (noise(x, y) - 0.5) * 1.6 > 0);
    for (let pass = 0; pass < 2; pass++) {
      const next = [...wat];
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        let n = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) { n += (yy >= MAP_H) ? 1 : 0; c++; continue; }
          n += wat[yy * MAP_W + xx] ? 1 : 0; c++;
        }
        next[y * MAP_W + x] = n > c / 2;
      }
      wat = next;
    }
    /* Eine kleine Insel vor dem Hafen — Schmugglerromantik. */
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++)
      if (Math.hypot(x - 5, y - (MAP_H - 1.4)) < 1.9) wat[y * MAP_W + x] = false;
    const CX2 = 13, CY2 = 12;   // die Piazza
    const tiles = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const water = wat[y * MAP_W + x];
      /* Straßennetz: zwei Hauptstraßen-Kreuze auf den Bezirksgrenzen (Corso),
       * dazu je Viertel kurze, versetzte Gassen — Altstadt statt Schachbrett. */
      const corso = x === 8 || x === 17 || y === 8 || y === 17;
      const bx = Math.min(2, Math.floor(x / 9)), by = Math.min(2, Math.floor(y / 9));
      const gasse =
        (y === by * 9 + 4 && x % 9 >= 1 && x % 9 <= 7 && (bx + by) % 2 === 0) ||
        (x === bx * 9 + 4 && y % 9 >= 1 && y % 9 <= 7 && (bx + by) % 2 === 1);
      /* Hafenpromenade: eine Uferstraße oberhalb der Küstenlinie. */
      const promenade = y === MAP_H - 6;
      const road = !water && (corso || gasse || promenade);
      let zone = "agrar";
      if (water) zone = "wasser";
      else if (Math.hypot(x - CX2, y - CY2) < 6.5) zone = "zentrum";
      else if (y >= MAP_H - 8) zone = "kueste";
      else if (x >= 18 && y <= 8) zone = "industrie";
      /* Piazza: der freie Platz ums Zentrum — gepflastert, mit Brunnen in der
       * Mitte. Als eigenes Flag, damit der Client Pflaster + Fontana zeichnet. */
      const piazza = Math.abs(x - CX2) <= 1 && Math.abs(y - CY2) <= 1;
      const park = !water && !road && !piazza && (x * 7 + y * 13) % 19 === 0;
      /* Weinberge und Olivenhaine: das Umland ist sichtbar Landwirtschaft. */
      const field = !water && !road && !park && !piazza && zone === "agrar" && (x * 5 + y * 11) % 7 === 0;
      tiles.push({ x, y, zone, road, water, locked: false, unlockCost: 0,
        piazza, fontana: piazza && x === CX2 && y === CY2,
        park, field, owner: null, btype: null, lien: false });
    }
    const at2 = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : tiles[y * MAP_W + x];
    for (const t of tiles) {
      const nb = [at2(t.x + 1, t.y), at2(t.x - 1, t.y), at2(t.x, t.y + 1), at2(t.x, t.y - 1)];
      if (!t.water && nb.some(n => n?.water)) t.sand = true;
      if (t.water && !nb.some(n => n && !n.water)) t.deep = true;
      if (t.water && (t.x * 3 + t.y * 17) % 19 === 0) t.rock = true;
    }
    /* Der Hafen des Porto Vecchio: zwei Holzmolen ragen von der Küste ins
     * Meer — vom ersten Landstück unterhalb der Promenade senkrecht nach
     * Süden, bis zu 3 Kacheln weit. An den Molen liegen (clientseitig
     * gezeichnete) Fischerboote. Molen sind begehbar-hübsch, nicht bebaubar. */
    for (const px2 of [3, 7]) {
      let y2 = MAP_H - 6;                          // Promenaden-Höhe
      while (y2 < MAP_H - 1 && !at2(px2, y2)?.water) y2++;   // erste Wasserkachel finden
      for (let i = 0; i < 3 && y2 + i < MAP_H; i++) {
        const t2 = at2(px2, y2 + i);
        if (t2?.water) { t2.pier = true; t2.rock = false; t2.deep = false; }
      }
    }
    /* Der Leuchtturm wacht auf der Schmuggler-Insel — reines Stadtbild,
     * nicht bebaubar, nachts kreist sein Licht (Client-Animation). */
    const turm = at2(5, MAP_H - 2);
    if (turm && !turm.water)
      Object.assign(turm, { leuchtturm: true, park: false, field: false, rock: false });
    /* Der Bankpalazzo thront am Rand der Piazza. */
    const bank2 = at2(CX2, CY2 - 2) && !at2(CX2, CY2 - 2).water && !at2(CX2, CY2 - 2).road
      ? at2(CX2, CY2 - 2)
      : tiles.find(t => t.zone === "zentrum" && !t.water && !t.road && !t.park);
    if (bank2) Object.assign(bank2, { bank: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
    /* Die Questura: Sitz der Polizei, nahe dem Corso-Kreuz im Stazione-Viertel.
     * Reines Stadtbild wie die Bank — nicht bebaubar, nachts mit Blaulicht. */
    const qKandidaten = [[16, 7], [15, 7], [16, 6], [18, 6], [15, 6]];
    let questura = null;
    for (const [qx, qy] of qKandidaten) {
      const t2 = at2(qx, qy);
      if (t2 && !t2.water && !t2.road && !t2.bank) { questura = t2; break; }
    }
    questura ??= tiles.find(t2 => t2.zone === "zentrum" && !t2.water && !t2.road && !t2.bank && !t2.piazza);
    if (questura) Object.assign(questura, { questura: true, park: false, field: false, locked: false, unlockCost: 0 });
    /* Das Casino Municipale glänzt direkt am Piazza-Rand. */
    for (const [cxK, cyK] of [[15, 12], [15, 13], [11, 14], [15, 11], [12, 14]]) {
      const t2 = at2(cxK, cyK);
      if (t2 && !t2.water && !t2.road && !t2.bank && !t2.questura && !t2.piazza) {
        Object.assign(t2, { gcasino: true, park: false, field: false, locked: false, unlockCost: 0 });
        break;
      }
    }
    /* Ein Wahrzeichen je Bezirk: nahe der Bezirksmitte, spiralförmig gesucht. */
    const belegt = t2 => !t2 || t2.water || t2.road || t2.bank || t2.questura || t2.piazza
      || t2.gcasino || t2.pier || t2.leuchtturm || t2.fontana || t2.wz || t2.famhaus;
    for (const [key, def] of Object.entries(WZ_DEF)) {
      const bx = (def.bezirk % 3) * 9 + 4, by = Math.floor(def.bezirk / 3) * 9 + 4;
      let ziel = null;
      aussen: for (let r = 0; r < 5; r++)
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t2 = at2(bx + dx, by + dy);
          if (!belegt(t2)) { ziel = t2; break aussen; }
        }
      if (ziel) Object.assign(ziel, { wz: key, park: false, field: false, locked: false, unlockCost: 0 });
    }
    /* Familienhäuser: der Stammsitz jeder Familie in ihrem Heimatbezirk. */
    const heimat = { famiglia: 0, syndikat: 2, bratwa: 6, triade: 8 };
    for (const [fid, bez] of Object.entries(heimat)) {
      const bx = (bez % 3) * 9 + 3, by = Math.floor(bez / 3) * 9 + 6;
      let ziel = null;
      aussen2: for (let r = 0; r < 6; r++)
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const t2 = at2(bx + dx, by + dy);
          if (!belegt(t2) && !t2.famhaus) { ziel = t2; break aussen2; }
        }
      if (ziel) Object.assign(ziel, { famhaus: fid, park: false, field: false, locked: false, unlockCost: 0 });
    }
    return tiles;
  }
  MAP_W = 26; MAP_H = 26; MAP_ROUTES = null;
  /* Die Planwirtschaft spielt auf einer eigenen Fläche: andere Küstenlinie
   * (verschobenes Rauschen), engeres Straßenraster, Industrie links statt
   * rechts und das Zentrum in der Kartenmitte. Statt Stadtbank steht dort
   * der Schwarzmarkt; eine Nachrichtenzentrale gibt es nicht. */
  const plan = mode === "plan";
  /* Deterministisches Pseudo-Rauschen → organische Küste, identisch auf allen Clients */
  const noise = (x, y) => {
    const n = Math.sin((x + (plan ? 37 : 0)) * 12.9898 + (y + (plan ? 91 : 0)) * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  /* Wasserfeld zuerst berechnen, dann 2× Mehrheits-Glättung gegen Sprenkel */
  let wat = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    /* schmaler Küstenstreifen (Wasser nur ~3 Randreihen) — Land ist wertvoller */
    const coastDepth = (y - (MAP_H - 3.2)) + Math.max(0, (x - (MAP_W - 6)) * 0.4 + (y - (MAP_H - 8)) * 0.3) * ((x > MAP_W - 7 && y > MAP_H - 9) ? 1 : 0);
    wat.push(coastDepth + (noise(x, y) - 0.5) * 1.4 > 0);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = [...wat];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let n = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) { n += (yy >= MAP_H) ? 1 : 0; c++; continue; }
        n += wat[yy * MAP_W + xx] ? 1 : 0; c++;
      }
      next[y * MAP_W + x] = n > c / 2;
    }
    wat = next;
  }
  /* Große Inseln in der Bucht: bebaubares Küsten-Land statt leerem Wasser */
  const ISLANDS = [[5, MAP_H - 1.6, 2.1], [14, MAP_H - 1.9, 2.6], [22, MAP_H - 2.2, 1.9]];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (ISLANDS.some(([ix, iy, r]) => Math.hypot(x - ix, y - iy) < r)) wat[y * MAP_W + x] = false;
  }
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const water = wat[y * MAP_W + x];
    const road = !water && (plan ? (x % 6 === 2 || y % 6 === 2) : (x % 6 === 3 || y % 6 === 3));
    /* Zonen: rundes Zentrum, Industrie-Band rechts (Plan: links, Zentrum mittig) */
    let zone = "agrar";
    if (water) zone = "wasser";
    else if (plan ? Math.hypot(x - MAP_W / 2, y - 8) < 7.5 : Math.hypot(x - 7, y - 6) < 8.5) zone = "zentrum";
    else if (y >= MAP_H - 9) zone = "kueste";
    else if (plan ? x < 9 : x >= MAP_W - 9) zone = "industrie";
    const park = !water && !road && (x * 7 + y * 13) % 17 === 0;   // Parks/Palmen vor Sperrzonen
    const field = !water && !road && !park && zone === "agrar" && (x * 5 + y * 11) % 13 === 0; // Deko-Felder (bebaubar)
    const locked = !water && !road && !park && (zone === "industrie" || zone === "kueste");
    tiles.push({ x, y, zone, road, water, locked, unlockCost: UNLOCK[zone] || 0,
      park, field, owner: null, btype: null, lien: false });
  }
  /* Nachbarschafts-Pass: Strand am Wasserrand, Tiefwasser, Felsen im Meer */
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : tiles[y * MAP_W + x];
  for (const t of tiles) {
    const nb = [at(t.x+1,t.y), at(t.x-1,t.y), at(t.x,t.y+1), at(t.x,t.y-1)];
    if (!t.water && nb.some(n => n?.water)) t.sand = true;                        // Strandsaum
    if (t.water && !nb.some(n => n && !n.water)) t.deep = true;                   // offenes Meer
    if (t.water && (t.x * 3 + t.y * 17) % 19 === 0) t.rock = true;                // Felsen
  }
  if (plan) {
    /* Planwirtschaft: Wo sonst die Stadtbank steht, sitzt der Schwarzmarkt —
     * eine Baracke im Zentrum, der einzige Ort für Handel unter der Hand.
     * Eine Nachrichtenzentrale gibt es auf dieser Fläche nicht. */
    const schwarz = tiles.find(t => t.zone === "zentrum" && !t.water && !t.road && !t.park);
    if (schwarz) Object.assign(schwarz, { schwarz: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
    return tiles;
  }
  /* Die Stadtbank steht fest im Zentrum und gehört niemandem: hier handeln alle
   * Spieler Firmenanteile. Kein Bauplatz, kein Besitzer, nicht freischaltbar. */
  const bank = tiles.find(t => t.x === BANK_POS[0] && t.y === BANK_POS[1] && !t.water)
            || tiles.find(t => t.zone === "zentrum" && !t.water && !t.road && !t.park);
  if (bank) Object.assign(bank, { bank: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
  /* Nachrichtenzentrale: gehört wie die Bank der Stadt und ist unbebaubar. */
  const news = tiles.find(t => t.x === NEWS_POS[0] && t.y === NEWS_POS[1] && !t.water)
    || tiles.find(t => t.zone === "zentrum" && !t.water && !t.bank && !t.road);
  if (news) Object.assign(news, { news: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
  return tiles;
}

/* ---------- Race Day: Startausruestung ----------
 * Im Renntag-Modus faengt niemand bei null an: Rennstall, ein Startwagen und
 * ein Fahrer gehoeren zur Grundausstattung. Sonst waere die erste Stunde
 * dieselbe Wirtschaftsrunde wie ueberall, nur mit anderem Namen — der
 * Rennstall kostet regulaer 30.000 $ und ist erst ab 200.000 $ Nettovermoegen
 * ueberhaupt baubar.
 *
 * Der Wagen ist Stufe 1 und laesst sich wie jeder andere tunen; der Stall
 * laesst sich ausbauen und bietet dann mehr Stellplaetze. */
const RENNTAG_STARTWAGEN = "benzinauto";
/* Die beiden Werke, die Rennteile herstellen. */
const RENNTEILE_WERKE = new Set(["reifenwerk", "rennlabor"]);
/* Ein Grundstock, damit die erste Ausbaustufe und das erste Teile-Gesuch nicht
 * daran scheitern, dass noch niemand ein Werk gebaut hat. Bewusst knapp: er
 * reicht fuer ein bis zwei Ausbauten, danach muss man produzieren oder kaufen. */
const RENNTAG_STARTTEILE = { rennreifen: 6, rennsoftware: 4 };
function renntagAusstatten(p) {
  if (MODE !== "renntag") return;
  /* Die Rennindustrie faehrt nicht — sie bekommt statt Stall und Wagen einen
   * Vorrat, um sofort produzieren zu koennen, statt erst Rohstoffe zu suchen,
   * die im Renntag niemand sonst herstellt. */
  if (p.industry === "rennindustrie") {
    if (p.rennstart) return;
    p.rennstart = true;
    for (const [g, n2] of Object.entries({ oel: 40, erze: 40, stahl: 8, silizium: 20, elektronik: 8 }))
      p.inv[g] = (p.inv[g] || 0) + n2;
    logTx(p, "Motorsport", "Race Day: Grundstock für die Zulieferkette", 0);
    return;
  }
  if (G.map.some(t => t.owner === p.id && BTYPES[t.btype]?.racing)) return;   // hat schon einen
  /* Platz suchen: bevorzugt in der Industriezone (dort gehoert ein Rennstall
   * hin), sonst irgendwo frei — niemand soll ohne Stall dastehen, bloss weil
   * die Zone voll ist. */
  const passt = t => !t.road && !t.water && !t.park && !t.owner && !t.bank && !t.news && !t.finanzamt && !t.deko;
  const platz = G.map.find(t => passt(t) && t.zone === "industrie") || G.map.find(passt);
  if (!platz) return;
  Object.assign(platz, { owner: p.id, btype: "rennstall", level: 1, locked: false, unlockCost: 0 });
  const nr = ++autoNr;
  platz.autos = [{ id: id(), good: RENNTAG_STARTWAGEN, nr, zustand: 100, rennen: 0, siege: 0,
    tuning: {}, fahrerId: null, km: 0, kaufpreis: 0, tuningAusgaben: 0,
    name: p.bot ? botWagenName(nr) : null,
    historie: [{ t: G.tick, text: "Startwagen — Race Day", amt: 0 }] }];
  /* Ohne Fahrer kein Start. Einen aus dem Pool zuweisen, ohne Handgeld: die
   * Ausruestung soll fahrbereit sein, nicht halb. Das Gehalt laeuft ab jetzt
   * wie bei jedem anderen Fahrer. */
  const f = G.fahrer.find(x => !x.teamId);
  if (f) { f.teamId = p.id; f.autoId = platz.autos[0].id; platz.autos[0].fahrerId = f.id; }
  for (const [g, n2] of Object.entries(RENNTAG_STARTTEILE)) p.inv[g] = (p.inv[g] || 0) + n2;
  logTx(p, "Motorsport", `Race Day: Rennstall, ${GOODS[RENNTAG_STARTWAGEN].name} #${nr}` +
    (f ? ` und ${f.name} am Steuer` : " (noch ohne Fahrer)"), 0);
}

/* ---------- Spielzustand ---------- */
const G = {
  map: buildMap(),
  players: {},          // persistente Spieler-ID (Reconnect-Token) -> Player
  socketToPid: {},       // aktuelle socket.id -> persistente Spieler-ID
  orders: [],           // {id, side:'sell'|'buy', good, qty, price, playerId, ts}
  bonds: [],            // {id, issuerId, holderId|null, principal, rate, termLeft, strikes}
  auctions: [],         // {id, tileIdx, btype, minBid, bestBid, bestBidder, tLeft}
  lastTrade: {},        // good -> Preis des letzten echten Trades (Ticker)
  priceHist: {},        // good -> Kursverlauf, alle 10 s ein Punkt (Chart)
  news: [],             // Marktberichte der Nachrichtenzentrale, neueste zuerst
  firmHist: {},         // pid  -> Firmenwert-Verlauf, gleiche Taktung
  chat: Object.fromEntries(ROOMS.map(r => [r, []])),
  contracts: [],        // {id, fromId, toId, good, qty, price, status}
  cartels: [],          // Kartellmodus: {id, name, kopfId, mitglieder[], einladungen[], minPreise, verdacht, ermittlung, umsatz, gegruendet}
  familienRespekt: {},  // Kartellmodus: Respekt je Familie (famiglia/syndikat/bratwa/triade)
  fahndung: {},         // Kartellmodus: Fahndungsdruck 0–100 je Familie; bei 100 Razzia
  transporte: [],       // Kartellmodus: fahrende Werttransporte {id, art, achse, linie, pos, dir, gestoppt}
  naechsterTransport: 30,
  tick: 0, winner: null, report: null,
  /* Warteraum: die Runde läuft erst, wenn der Host sie startet — bis dahin
   * sammeln sich die Mitspieler, ohne dass Produktion oder Bots anlaufen. */
  started: false, hostId: null,
  groupOrder: null, nextGroupIn: 20,   // erster Stadt-Auftrag nach 20 s
  gcasino: { stufe: 1, quote: "fair" },   // Casino Municipale (Kartellmodus)
  groulette: { phase: "warten", endet: 0, zahl: null, letzteZahl: null, einsaetze: [] },
  gblackjack: { phase: "warten", endet: 0, dran: -1, dealer: [], spieler: [] },
  gpoker: { phase: "warten", endet: 0, einsatz: 100, pot: 0, board: [], deck: [], strasse: 0, dran: -1, aktBet: 0, raises: 0, spieler: [] },
  brunnenPot: 0,        // Wunschbrunnen in den Giardini: Münzen aller Spieler
  pateWahl: { phase: null, endet: 0, naechste: 0, kandidaten: [], stimmen: {}, stich: null },   // Patenwahl alle 20 min (3 Phasen + Stichwahl)
  pateDekret: null, pateName: null,
  familienBank: {}, familienBoss: {}, familienRang: {}, familienTribut: {}, soldaten: {},
  wahlSiege: {}, kampfSiege: {}, siegWarnungen: {},
  shareListings: [],     // {id, companyId, sellerId, count(1-4 = 25%-Schritte), price, ts, toId}
  shareBids: [],         // Kaufanfragen an eine Firma: {id, companyId, bidderId, count, price, ttl}
  nextDividendIn: DIVIDEND_INTERVAL,
  wettrunde: { nr: 1, phase: "annahme", rest: 120, start: {} },   // Kurswetten (long/short auf Firmenwerte)
  wetten: [],            // {id, spielerId, firmaId, richtung, einsatz}
  wettLetzte: [],        // Ergebnis der letzten Runde je Firma
  wettReserve: 20000,    // Bankreserve für die Kurswetten (WETT_RESERVE)
  markt: {}, marktLog: [], panikTag: null, panikErledigt: false,   // Aktienkurse (siehe marktTag)
  fonds: {}, etfHist: {}, faEtf: {}, software: {}, paint: {}, swFaktor: {},   // Branchenfonds (ETFs), Fondsanteile des Finanzamts
  stadtkasse: 20000, steuerStufe: 2, boerseGebuehren: 0,         // Finanzamt: Anteil der Steuern für Großauftrags-Prämien und Stadtprojekte
  steuernGesamt: 0,
  stadtprojekt: null, projektPause: 120, stadtprojekteFertig: [],
  fahrer: [],            // Fahrerpool der Runde: {id, name, land, Werte…, teamId, autoId}
  fahrerGehaltIn: FAHRER_GEHALT_TAKT,
  rennen: null,                    // laufender Renntag (Anmeldung/Rennen/Ergebnis)
  naechstesRennenIn: RENN_INTERVALL,
  werksTeams: werksTeamsBauen(),   // Werkswagen, die das Startfeld fuellen
  wm: {},                          // Meisterschaftspunkte je Spieler (Race Day)
  fanAuszahlungIn: FAN_TAKT,       // Ticks bis zur naechsten Fan-Hub-Auszahlung
  saisonRennen: 0,                 // gefahrene Renntage der Saison
};
let nextId = 1;
const id = () => nextId++;

const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : G.map[y * MAP_W + x];

function newPlayer(pid, name, color, industry, socketId) {
  const inv = Object.fromEntries(Object.keys(GOODS).map(k => [k, 0]));
  inv.ziegel = 30;   // reicht für 2 Grundgebäude + 1 Verarbeitungsgebäude (max. 21) plus den Online-Marktplatz (8), danach Börse
  /* Beton von Anfang an: alles ab 4.000 $ Baukosten verlangt welchen, hergestellt
   * wird er aber ausschließlich im Betonwerk der Rohstoffindustrie. Spielt niemand
   * diese Industrie, wäre sonst der gesamte zweite Bauabschnitt für alle gesperrt.
   * 6 Stück decken genau ein Gebäude bis 12.000 $ ab — danach führt der Weg über
   * die Börse. */
  inv.beton = 6;
  /* Grundausstattung Strom und Elektronik: Die ersten Minuten gab es gemessen
   * gar keinen Strom (das erste E-Werk lief frühestens in Minute 4) und bis
   * Minute 5 keine einzige Einheit Elektronik — Boosts, Studio und der erste
   * Ausbau standen bei allen still. */
  inv.strom = 60;
  inv.elektronik = 4;
  /* Software-Firmen brauchen zusätzlich den eigenen Online-Shop (8 Ziegel) für ihre Programme. */
  if (industry === "software") inv.ziegel += 16;
  /* Testhilfe (nur per Umgebungsvariable): TEST_GARAGE=1 legt jedem neuen
   * Spieler Fahrzeuge, Tuningteile und Baumaterial ins Lager — zum schnellen
   * Durchspielen des Renntags, ohne die Produktionskette hochzuziehen. */
  if (process.env.TEST_GARAGE) { inv.eauto = 2; inv.benzinauto = 1; inv.rennreifen = 12; inv.rennsoftware = 12; inv.ziegel = 200; inv.beton = 40; inv.pistole = 8;
    inv.obst = 150; inv.wasser = 150; inv.erze = 150; inv.kannabis = 80; inv.strom = 200; inv.elektronik = 20; }
  return { id: pid, name, color, industry, industries: [industry], cash: START_CASH, xp: 0, lvl: 1,
    inv,
    equityAvg: {},     // companyId -> Ø-Einstand je Aktie (Durchschnittsmethode)
    quests: {},        // Starter-Aufgaben: {id: {n, done}}
    tx: [],            // Transaktions-Log: {t, cat, text, amt}
    sales: {},         // je Ware: {botQty, botRev, playerQty, playerRev, buyQty, buyCost}
    /* Laufende Summen für die Rundenauswertung. p.revenue taugt dafür nicht —
     * das wird bei jeder Dividende auf 0 gesetzt, und revBuckets deckt nur die
     * letzten 10 Minuten ab. */
    stats: { produziert: {}, umsatz: 0, ausgaben: 0, gebaut: 0, abgerissen: 0,
             grossauftraege: 0, besterHandel: null, dividendeRein: 0, dividendeRaus: 0,
             werbung: 0, anteileGekauft: 0, anteileVerkauft: 0, fusionen: 0,
             zinsErtrag: 0, zinsAufwand: 0, aufgelevelt: 0, steuern: 0, projekte: 0,
             investiert: 0, kapitalNetto: 0 },   // kapitalNetto: Emissionen − Ausschüttungen (für den Ertrag in F)
    fin: { zinsErtrag: 0, zinsAufwand: 0 },
    nwHist: [],        // Nettovermögens-Verlauf für den Chart
    equity: { [pid]: AKTIEN },   // Cap-Table: holderId -> Anzahl Aktien (Summe immer AKTIEN)
    ausschuettung: null,   // null = automatisch (DIVIDEND_RATE des Umsatzes), sonst fester Betrag je Periode
    afa: [],           // Investitionen für die Abschreibung: {b: Betrag, t: Tick}
    adReach: 0,        // Werbe-Reichweite 0–100, zerfällt laufend (siehe AD_DECAY)
    fans: 0,           // Fanbasis (Race Day), zerfällt laufend (siehe FAN_ZERFALL)
    revenue: 0,        // Erlös seit letzter Dividendenausschüttung (Handel/Shop/Großaufträge)
    /* Rollendes Umsatzfenster: ein Eimer je Minute, für die Firmenbewertung an
     * der Bank. p.revenue allein taugt dafür nicht — das wird alle 10 min auf 0
     * gesetzt und sähe an der Börse aus wie ein Umsatzeinbruch. */
    revBuckets: new Array(REV_WINDOW_MIN).fill(0),
    socketId,          // aktuell aktive Socket-Verbindung, null = getrennt
    disconnected: false, disconnectedAt: null };
}
/* Private Events an die AKTUELLE Verbindung eines Spielers schicken — pid bleibt über
 * Reconnects stabil, socketId wechselt bei jeder neuen Verbindung. */
function emitTo(pid, event, payload) {
  const sid = G.players[pid]?.socketId;
  if (sid) io.to(sid).emit(event, payload);
}

/* ---------- Bewertung ----------
 * Zwei Ebenen, bewusst getrennt:
 *   substance(firma)  = was die Firma selbst besitzt (Bargeld, Lager, Gebäude,
 *                       Anleihen abzüglich Schulden). Das ist der Firmenwert.
 *   netWorth(spieler) = die Summe seiner Beteiligungen, jeweils prozentual auf
 *                       die Substanz der jeweiligen Firma — auch auf die eigene.
 * Dadurch ist ein gekaufter Anteil ein echter Vermögenswert, und Anteilshandel
 * bläht das Gesamtvermögen im Spiel nicht künstlich auf: was der Käufer an
 * Beteiligung gewinnt, gibt der Verkäufer ab. */
/* Anlagen zählen mit dem, was sie gekostet haben: Kaufpreis, Freischaltung,
 * verbautes Material und Ausbauten (t.anlagewert). Damit ändert ein Bau den
 * Buchwert nicht — Geld und Material werden zu Anlage, auch während der Bauzeit
 * ("Anlage in Arbeit"). Ältere Kacheln ohne Eintrag: Baukosten. */
const anlageWert = t => t.anlagewert ?? BTYPES[t.btype]?.cost ?? 0;
const imBau = t => (t.bauBis || 0) > G.tick;
let bldCache = { tick: -1, byOwner: null };
function buildingValueOf(pid) {
  /* Gebäudewerte einmal je Tick über die ganze Karte summieren statt für jede
   * Bewertung erneut — netWorth ruft substance() sonst für jeden Spieler auf
   * und läuft dabei jedes Mal über alle 676 Kacheln. */
  if (bldCache.tick !== G.tick) {
    const by = {};
    for (const t of G.map) if (t.owner && t.btype) {
      by[t.owner] = (by[t.owner] || 0) + anlageWert(t);
      /* Fahrzeuge im Rennstall sind Vermögen, auch wenn sie das Warenlager
       * verlassen haben. Ohne diese Zeile würde ein Einzug das Nettovermögen
       * senken — der Wagen wäre aus `inv` verschwunden und nirgends wieder
       * aufgetaucht. Bewertet zum Marktkurs, gemindert um den Zustand. */
      if (t.autos) for (const a of t.autos) by[t.owner] += autoWert(a);
    }
    bldCache = { tick: G.tick, byOwner: by };
  }
  return bldCache.byOwner[pid] || 0;
}
function substance(p) {
  let v = p.cash + buildingValueOf(p.id) + (p.wettOffen || 0);   // laufende Kurswetten gehören weiter dem Spieler
  v += swMarkenwert(p);   // Software-Firmen: das System selbst ist ein Wert
  v -= p.steuerSchuld || 0;   // gestundete Steuern sind Schulden — sonst gewänne man mit offenen Steuern
  for (const k in p.inv) v += p.inv[k] * MM[k].price;
  for (const b of G.bonds) {
    if (b.holderId === p.id) v += b.principal;
    if (b.issuerId === p.id && b.holderId) v -= b.principal;
  }
  return v;
}
function netWorth(p) {
  let nw = 0;
  for (const o of Object.values(G.players)) {
    const aktien = o.equity[p.id] || 0;
    if (aktien > 0) nw += substance(o) * (aktien / AKTIEN);   // Buchwert, nicht Kurs
  }
  /* Anteile, die gerade zum Verkauf angeboten sind, liegen in Verwahrung und
   * fehlen in der Cap-Table — sie gehören aber weiter dem Anbieter. */
  for (const l of G.shareListings) {
    const co = G.players[l.companyId];
    if (co && (l.sellerId ?? l.companyId) === p.id) nw += substance(co) * (l.count / AKTIEN);
  }
  for (const [br, n] of Object.entries(p.etf || {})) if (n > 0) nw += n * (etfPreis(br, true) || 0);   // Fondsanteile zum Buchwert, wie direkte Beteiligungen
  return nw;
}
/* Jeder Erlös läuft hierüber, damit er sowohl in die Dividende als auch in das
 * rollende Umsatzfenster der Firmenbewertung eingeht. */
function addRevenue(p, amt) {
  if (!(amt > 0)) return;
  p.stats.umsatz += amt;
  p.revenue += amt;
  p.revBuckets[0] += amt;
  questProg(p, "revenue", amt);   // zählt jeden Erlös, egal aus welcher Industrie
}
const rev10 = p => p.revBuckets.reduce((a, b) => a + b, 0);
/* Marktwert einer Firma ist schlicht ihre Substanz — ein 25 %-Block kostet ein
 * Viertel davon. Der Handelsgewinn entsteht dadurch, dass die Firma wächst:
 * früh gekauft, später zu einem höheren Nettovermögen verkauft. Der Umsatz der
 * letzten 10 Minuten fließt NICHT in den Preis ein, sondern wird nur angezeigt —
 * er ist der Hinweis darauf, wie schnell diese Substanz gerade wächst.
 * Nach unten begrenzt, damit auch eine überschuldete Firma handelbar bleibt. */
/* ============================================================
 * Aktien, Fundamentalwert F und Kurs P
 * ------------------------------------------------------------
 * Jede Firma hat AKTIEN Aktien (statt früher 4 Blöcken à 25 %).
 *
 *  Buchwert   S = Kasse + Inventar + Anlagen + Anlagen in Arbeit ± Anleihen
 *                 − Steuerschuld                       (substance)
 *  Ertrag     E = Zuwachs von S in den letzten ERTRAG_FENSTER Tagen,
 *                 bereinigt um Ausschüttungen und Kapitalzuflüsse
 *  Fundament  F = S + max(0, E) × M_ERTRAG
 *  Kurs       P(t+1) = P + α·(F(t−d)/AKTIEN − P) + Rauschen, je Tag
 *
 * Das Nettovermögen (Siegbedingung) bewertet Beteiligungen zum BUCHWERT S,
 * nicht zum Kurs: Kursschwankungen erzeugen so kein Vermögen aus dem Nichts.
 * Gehandelt wird dagegen zu Preisen um P; Kurswetten laufen auf P.
 * Alle Parameter hier, überschreibbar per Umgebung MARKT='{"ALPHA":0.3}'.
 * ============================================================ */
const AKTIEN = 100;
const MARKT = Object.assign({
  TAG: 60,              // Sekunden je Markttag (Kurs-Takt)
  ALPHA: 0.25,          // Anpassung an F je Tag
  DELAY: 3,             // Verzögerung in Tagen
  NOISE: 0.02,          // Rauschen ±2 % je Tag
  M_ERTRAG: 1,          // Ertragsmultiplikator
  ERTRAG_FENSTER: 10,   // Tage für den Ertrag
  P_FLAUTE: 0.02,       // Chance je Firma und Tag auf eine Nachfrageflaute
  FLAUTE: 0.08,         // Kursverlust bei Flaute
  PANIK: 0.15,          // einmaliger Panikschock je Runde
  PANIK_VON: 20, PANIK_BIS: 40,   // Spielminute des Schocks (zufällig dazwischen)
  BETA: 0.5,            // Preiswirkung: P × (1 ± β × Anteil gehandelter Aktien)
  BAU_DAUER: 30,        // Sekunden Bauzeit (Anlage in Arbeit)
  AFA_DAUER: 1800,      // Sekunden Abschreibung von Bau/Ausbau für die Steuer
  /* Finanzamt als Stabilisator (siehe finanzamtBoerse) */
  THETA: 0.10,          // ab dieser Lücke g = (F − P)/F wird gekauft bzw. verkauft
  SCHRITT: 2,           // Aktien je Schritt
  MAX_SCHRITTE: 3,      // Schritte je Firma und Tag
  MAX_ANTEIL: 20,       // höchstens so viele Aktien je Firma
  FA_ANTEIL_TAG: 0.2,   // je Tag höchstens dieser Teil des Geldes über dem Grundstock
  FA_GUT: 0.15,         // Chance je Tag, eine gut laufende Firma auch ohne große Lücke zu kaufen
  FA_AUFSCHLAG: 0.05,   // stehendes Verkaufsangebot der Fonds: max(Kurs, Wert) + 5 % — Übernahmen bleiben möglich
  FA_MAX_FONDS: 25000,  // Finanzamt: höchstens so viel $ je Branchenfonds
  /* Branchen-ETFs (siehe etfPreis) */
  ETF_GEBUEHR: 0.01,    // je Kauf und Verkauf, bleibt bei der Bank
  ETF_MAX_RESERVE: 0.5, // alle ETFs zusammen höchstens dieser Teil der Bankreserve
}, (() => { try { return JSON.parse(process.env.MARKT || "{}"); } catch { return {}; } })());

/* Marktdaten je Firma: Kurs, Verlauf von F (für die Verzögerung) und von S
 * samt bereinigtem Kapitalfluss (für den Ertrag). */
const marktVon = p => (G.markt[p.id] ??= { kurs: null, fHist: [], sHist: [] });
function ertragVon(p) {
  const h = marktVon(p).sHist;
  if (h.length < 2) return 0;
  const alt = h[Math.max(0, h.length - 1 - MARKT.ERTRAG_FENSTER)], neu = [substance(p), p.stats.kapitalNetto || 0];
  return (neu[0] - alt[0]) - (neu[1] - alt[1]);
}
const fundament = p => Math.max(500, substance(p) + Math.max(0, ertragVon(p)) * MARKT.M_ERTRAG);
/* Kurs je Aktie. Neue Firmen starten bei F — keine festen Startwerte. */
function kursVon(p) { const m = marktVon(p); if (!(m.kurs > 0)) m.kurs = fundament(p) / AKTIEN; return m.kurs; }
/* Marktwert = Kurs × Aktien. Heißt aus Kompatibilität weiter companyValue:
 * Kurswetten, Nachrichten und die Kurstafel laufen darüber. */
const companyValue = p => kursVon(p) * AKTIEN;
/* Ein Handel bewegt den Kurs: Kauf hebt, Verkauf senkt (β × Anteil). */
function kursWirkung(company, aktien, richtung) {
  const m = marktVon(company);
  m.kurs = Math.max(0.01, kursVon(company) * (1 + richtung * MARKT.BETA * aktien / AKTIEN));
}
function marktLog(art, text, daten = {}) {
  (G.marktLog ??= []).unshift({ tick: G.tick, ts: Date.now(), art, text, ...daten });
  if (G.marktLog.length > 60) G.marktLog.length = 60;
}
/* Einmal je Markttag, feste Reihenfolge: F messen, dann P nachführen. */
function marktTag() {
  const tag = Math.floor(G.tick / MARKT.TAG);
  if (G.panikTag == null) G.panikTag = Math.floor((MARKT.PANIK_VON + Math.random() * (MARKT.PANIK_BIS - MARKT.PANIK_VON)) * 60 / MARKT.TAG);
  const panik = !G.panikErledigt && tag >= G.panikTag;
  for (const p of Object.values(G.players)) {
    const m = marktVon(p), F = fundament(p);
    m.sHist.push([substance(p), p.stats.kapitalNetto || 0]); if (m.sHist.length > MARKT.ERTRAG_FENSTER + 1) m.sHist.shift();
    m.fHist.push(F); if (m.fHist.length > MARKT.DELAY + 1) m.fHist.shift();
    const Fd = m.fHist.length > MARKT.DELAY ? m.fHist[0] : m.fHist[0];   // F vor d Tagen (anfangs der älteste)
    let P = kursVon(p);
    P += MARKT.ALPHA * (Fd / AKTIEN - P);
    P *= 1 + (Math.random() * 2 - 1) * MARKT.NOISE;
    if (Math.random() < MARKT.P_FLAUTE) {
      P *= 1 - MARKT.FLAUTE;
      marktLog("flaute", `Nachfrageflaute bei ${p.name}: −${Math.round(MARKT.FLAUTE * 100)} %`, { firmaId: p.id });
    }
    if (panik) P *= 1 - MARKT.PANIK;
    m.kurs = Math.max(0.01, P);
  }
  finanzamtBoerse();   // feste Reihenfolge: erst F und P, dann die Reaktion des Finanzamts
  fondsTag();          // dann die Branchenfonds
  for (const br of Object.keys(INDUSTRIES)) {
    const pr = etfPreis(br); if (pr == null) continue;
    const h = ((G.etfHist ??= {})[br] ??= []); h.push(Math.round(pr * 100) / 100); if (h.length > 60) h.shift();
  }
  if (panik) {
    G.panikErledigt = true;
    marktLog("panik", `Panik an der Börse: alle Kurse −${Math.round(MARKT.PANIK * 100)} %`);
    io.emit("notice", { text: `PANIK an der Börse — alle Aktienkurse fallen um ${Math.round(MARKT.PANIK * 100)} %. Die Firmen selbst sind nicht weniger wert.` });
  }
}
/* ---------- Finanzamt als Stabilisator ----------
 * Das Finanzamt hält eigene Aktien (Halter FA_ID) und zahlt aus der Stadtkasse,
 * aber nur aus dem Geld über der Projektschwelle. Einmal je Markttag, je Firma:
 *  - Lücke g = (F − P·Aktien) / F
 *  - g > θ: kaufen, in Schritten, bis höchstens MAX_ANTEIL Aktien — erst aus
 *    offenen Angeboten bis zum Wert F je Aktie, sonst per Kaufanfrage an die
 *    Firma (die nie unter 50 % fallen muss). Gut laufende Firmen kauft es
 *    gelegentlich auch ohne große Lücke: es baut ein eigenes Portfolio auf.
 *  - g < −θ: verkaufen, höchstens den eigenen Bestand, zum Kurs.
 *  - sonst steht sein Bestand zum Wert + 5 % im Angebot — wer eine Firma
 *    übernehmen will, kommt an die Aktien des Finanzamts heran.
 * Jede Ausführung bewegt den Kurs: Kauf des Finanzamts hebt, Verkauf senkt.
 * Dividenden auf seine Aktien fließen in die Stadtkasse. */
/* Rangfolge: erst Stadtprojekte, dann Aktien. Gemessen (je 3 Bot-Runden):
 * Kaufte das Finanzamt aus dem ganzen Überschuss über dem Grundstock, wurde
 * kein einziges Projekt mehr fertig (vorher 2). Jetzt nur mit Geld über der
 * Projektschwelle. */
/* Das Finanzamt darf schon über der Notstandsgrenze (3.000 $) kaufen — sonst
 * bleibt die Stadtkasse unter der Projektschwelle und es kauft nie. */
const faFrei = () => Math.max(0, G.stadtkasse - STEUER_STUFEN[0].bis);
const faBestand = co => co.equity[FA_ID] || 0;
const faVerwahrt = co => G.shareListings.filter(l => l.companyId === co.id && l.sellerId === FA_ID).reduce((a, l) => a + l.count, 0);
const faGesamt = co => faBestand(co) + faVerwahrt(co);
const faBuchwert = () => Object.entries(G.faEtf || {}).reduce((a, [br, n]) => a + n * (etfPreis(br, true) || 0), 0);
/* Institutionen als Aktionäre: das Finanzamt und die Branchenfonds. */
const istInstitution = hid => hid === FA_ID || istFonds(hid);
const institutionName = hid => hid === FA_ID ? "Finanzamt" : `${INDUSTRIES[fondsBranche(hid)]?.name ?? "?"}-Fonds`;
function institutionZahlt(hid, betrag) { if (hid === FA_ID) G.stadtkasse -= betrag; else fondsVon(fondsBranche(hid)).cash -= betrag; }
function institutionErhaelt(hid, betrag) { if (hid === FA_ID) G.stadtkasse += betrag; else fondsVon(fondsBranche(hid)).cash += betrag; }
const institutionFrei = hid => hid === FA_ID ? faFrei() : fondsVon(fondsBranche(hid)).cash;
const faKauftAngebot = l => institutionKauftAngebot(FA_ID, l);
/* Kauf eines offenen Angebots durch eine Institution */
function institutionKauftAngebot(hid, l) {
  const company = G.players[l.companyId], sellerId = l.sellerId ?? l.companyId, seller = G.players[sellerId];
  if (!company) return false;
  institutionZahlt(hid, l.price);
  company.equity[hid] = (company.equity[hid] || 0) + l.count;
  G.shareListings.splice(G.shareListings.indexOf(l), 1);
  if (sellerId === company.id) {
    company.cash += l.price; company.stats.kapitalNetto = (company.stats.kapitalNetto || 0) + l.price;
    logTx(company, "Aktien", `${l.count} eigene Aktien an ${institutionName(hid)} ausgegeben`, l.price);
  } else if (istInstitution(sellerId)) {
    institutionErhaelt(sellerId, l.price);
  } else if (seller) {
    seller.cash += l.price;
    logTx(seller, "Aktien", `${l.count} Aktien von ${company.name} an ${institutionName(hid)} verkauft`, l.price);
  }
  if (seller && !seller.bot) emitTo(sellerId, "notice", { text: `${institutionName(hid)} kauft dein Angebot: ${l.count} Aktien von ${company.name} für ${Math.round(l.price)} $.` });
  kursWirkung(company, l.count, +1);
  marktLog(hid === FA_ID ? "fa-kauf" : "etf-kauf", `${institutionName(hid)} kauft ${l.count} Aktien von ${company.name} (Angebot)`, { firmaId: company.id, aktien: l.count, preis: Math.round(l.price) });
  return true;
}
/* Das Finanzamt baut ein eigenes Portfolio auf — aber NUR aus Anteilen der
 * Branchenfonds, nie aus Einzelaktien. Einmal je Markttag, je Branche:
 *  - Lücke der Branche g = Σ(F − P·Aktien) / ΣF über alle Firmen der Branche
 *  - g > θ: Fondsanteile kaufen (der Fonds kauft damit echte Aktien → hebt
 *    die Kurse der ganzen Branche). Gut laufende Branchen gelegentlich auch
 *    ohne große Lücke — so wächst das Portfolio.
 *  - g < −θ: einen Teil der Anteile zurückgeben, nie mehr als vorhanden,
 *    und nur, soweit die Fondskasse auszahlen kann.
 * Bezahlt nur mit Geld über der Projektschwelle; je Fonds höchstens
 * FA_MAX_FONDS $. Dividenden landen im Fonds und heben den Anteilspreis. */
function brancheLuecke(br) {
  const fi = etfFirmen(br); if (!fi.length) return null;
  let F = 0, M = 0;
  for (const co of fi) { F += fundament(co); M += kursVon(co) * AKTIEN; }
  return F > 0 ? (F - M) / F : 0;
}
function finanzamtBoerse() {
  if (!finanzamtAktiv()) return;
  /* Altbestand aus Einzelaktien (frühere Fassung) nicht mehr anbieten */
  for (const l of G.shareListings) if (l.sellerId === FA_ID) returnListingToSeller(l);
  G.shareListings = G.shareListings.filter(l => l.sellerId !== FA_ID);
  G.shareBids = G.shareBids.filter(b => b.bidderId !== FA_ID);
  G.faEtf ??= {};
  let budget = faFrei() * MARKT.FA_ANTEIL_TAG;
  const gesamtBudget = budget;
  for (const br of Object.keys(INDUSTRIES)) {
    const g = brancheLuecke(br); if (g == null) continue;
    const hat = G.faEtf[br] || 0, preis = etfPreis(br);
    /* Investiert immer, sobald Geld über der Projektschwelle liegt — verteilt
     * auf alle Branchen, die nicht deutlich überbewertet sind. Unterbewertete
     * Branchen (Lücke > 0) bekommen mehr: Gewicht 1 + 5 × Lücke. */
    const offen = Object.keys(INDUSTRIES).filter(b2 => { const g2 = brancheLuecke(b2); return g2 != null && g2 >= -MARKT.THETA; });
    const gew = b2 => 1 + 5 * Math.max(0, brancheLuecke(b2));
    const summe = offen.reduce((x, b2) => x + gew(b2), 0) || 1;
    if (g >= -MARKT.THETA && budget >= 100) {
      const raum = MARKT.FA_MAX_FONDS - hat * preis;
      const betrag = Math.floor(Math.min(gesamtBudget * gew(br) / summe, raum, faFrei()));
      if (betrag >= 100) {
        const n = fondsEinzahlen(br, betrag);
        G.stadtkasse -= betrag; budget -= betrag;
        G.faEtf[br] = hat + n;
        marktLog("fa-kauf", `Finanzamt kauft ${INDUSTRIES[br].name}-Fonds für ${betrag.toLocaleString("de-DE")} $ (Branche ${g >= 0 ? Math.round(g * 100) + " % unter" : Math.round(-g * 100) + " % über"} Wert)`, { branche: br, betrag });
      }
    } else if (g < -MARKT.THETA && hat > 0) {
      const n = hat * 0.25;
      const aus = fondsAuszahlen(br, n);
      if (aus != null) {
        G.faEtf[br] = hat - n; if (G.faEtf[br] < 1e-9) delete G.faEtf[br];
        G.stadtkasse += aus;
        marktLog("fa-verkauf", `Finanzamt gibt ${INDUSTRIES[br].name}-Fondsanteile für ${Math.round(aus).toLocaleString("de-DE")} $ zurück (Branche ${Math.round(-g * 100)} % über Wert)`, { branche: br, betrag: Math.round(aus) });
      }
    }
  }
}
function fondsTag() {
  for (const br of Object.keys(INDUSTRIES)) {
    const f = fondsVon(br), fid = fondsId(br);
    if (!(f.anteile > 0) && !(f.cash > 0)) continue;
    /* eigene Angebote zurückholen, neu stellen */
    for (const l of G.shareListings) if (l.sellerId === fid) returnListingToSeller(l);
    G.shareListings = G.shareListings.filter(l => l.sellerId !== fid);
    fondsInvestieren(br);
    const nav = fondsWert(br), knapp = f.cash < nav * 0.1 && f.anteile > 0;
    for (const co of Object.values(G.players)) {
      const n = co.equity[fid] || 0;
      if (n <= 0) continue;
      const P = kursVon(co), Fa = fundament(co) / AKTIEN;
      const anzahl = knapp ? Math.min(n, MARKT.SCHRITT * MARKT.MAX_SCHRITTE) : n;
      const je = knapp ? P : Math.max(P, Fa) * (1 + MARKT.FA_AUFSCHLAG);
      co.equity[fid] = n - anzahl;
      G.shareListings.push({ id: id(), companyId: co.id, sellerId: fid, count: anzahl, price: Math.round(anzahl * je), ts: Date.now(), toId: null });
    }
  }
}
function faPortfolio() {
  return Object.entries(G.faEtf || {}).filter(([, n]) => n > 0).map(([br, n]) => ({ branche: br, fonds: INDUSTRIES[br]?.name ?? br,
    anteile: Math.round(n * 100) / 100, wert: Math.round(n * (etfPreis(br) || 0)), buchwert: Math.round(n * (etfPreis(br, true) || 0)) }));
}
/* ---------- Branchen-ETFs: echte Fonds ----------
 * Je Branche ein Fonds. Wer Anteile kauft, zahlt in den Fonds ein; der Fonds
 * kauft damit ECHTE Aktien der Firmen dieser Branche, gewichtet nach Wert F —
 * aus offenen Angeboten bis zum Wert F je Aktie, sonst per Kaufanfrage (die
 * Eigentümer fallen dadurch nie unter 50 %). Jeder dieser Käufe hebt den Kurs.
 *   Anteilspreis = (Fondskasse + Aktien × Kurs) / Anteile, zu Beginn 100.
 * Kein neues Geld, keine Haftung der Bank: Steigen die Kurse, ist der Gewinn
 * durch die Aktien im Fonds gedeckt. (Eine erste Fassung als Zertifikat der
 * Bank machte aus 4.000 $ in zehn Minuten einen Anspruch von 18.400 $ gegen
 * die Bankreserve.) Dividenden auf Fondsaktien fließen in die Fondskasse.
 * Auszahlen kann der Fonds nur aus seiner Kasse; wird sie knapp, bietet er
 * Aktien zum Kurs an. Seine Aktien stehen sonst zum Wert + 5 % im Angebot —
 * Übernahmen bleiben möglich. */
const FONDS_PREFIX = "__etf_";
const fondsId = br => FONDS_PREFIX + br;
const istFonds = holderId => typeof holderId === "string" && holderId.startsWith(FONDS_PREFIX);
const fondsBranche = holderId => holderId.slice(FONDS_PREFIX.length);
const fondsVon = br => ((G.fonds ??= {})[br] ??= { cash: 0, anteile: 0 });
const etfFirmen = br => Object.values(G.players).filter(p => p.industry === br);
const fondsAktien = (br, co) => (co.equity[fondsId(br)] || 0)
  + G.shareListings.filter(l => l.companyId === co.id && l.sellerId === fondsId(br)).reduce((a, l) => a + l.count, 0);
function fondsWert(br, buch = false) {
  const f = fondsVon(br);
  return f.cash + Object.values(G.players).reduce((a, co) => a + fondsAktien(br, co) * (buch ? substance(co) / AKTIEN : kursVon(co)), 0);
}
function etfPreis(br, buch = false) {
  if (!etfFirmen(br).length && !(fondsVon(br).anteile > 0)) return null;
  const f = fondsVon(br);
  return f.anteile > 1e-9 ? Math.max(0.01, fondsWert(br, buch) / f.anteile) : 100;
}
/* Fonds legt seine Kasse in Aktien an (Zielgewicht nach F), wird bei jedem
 * Kauf und einmal je Markttag aufgerufen. */
function fondsInvestieren(br) {
  const f = fondsVon(br), fid = fondsId(br), fi = etfFirmen(br);
  if (!fi.length || f.cash < 1) return;
  const Fs = fi.map(fundament), sumF = Fs.reduce((a, b) => a + b, 0) || 1, nav = fondsWert(br);
  fi.forEach((co, i) => {
    const P = kursVon(co), Fa = Fs[i] / AKTIEN;
    let fehlt = Math.floor((nav * Fs[i] / sumF - fondsAktien(br, co) * P) / P);
    fehlt = Math.min(fehlt, MARKT.MAX_ANTEIL - fondsAktien(br, co));
    if (fehlt < 1) return;
    /* a) günstigstes offenes Angebot bis zum Wert F je Aktie */
    const l = G.shareListings.filter(x => x.companyId === co.id && !x.toId && x.sellerId !== fid && x.count <= fehlt && x.price / x.count <= Fa)
      .sort((a, b) => a.price / a.count - b.price / b.count)[0];
    if (l && l.price <= f.cash) { institutionKauftAngebot(fid, l); return; }
    /* b) Kaufanfrage an die Firma — eine je Firma, Eigentümer bleibt über 50 % */
    const n = Math.min(fehlt, MARKT.SCHRITT * MARKT.MAX_SCHRITTE);
    if ((co.equity[co.id] || 0) - n < AKTIEN / 2) return;
    if (G.shareBids.some(b => b.companyId === co.id && b.bidderId === fid)) return;
    const preis = Math.round(n * P * 1.02 * 100) / 100;
    if (preis > f.cash) return;
    G.shareBids.push({ id: id(), companyId: co.id, bidderId: fid, count: n, price: preis, ttl: SHARE_BID_TTL });
    if (!co.bot) emitTo(co.id, "notice", { text: `Der ${INDUSTRIES[br].name}-Fonds bietet ${Math.round(preis)} $ für ${n} Aktien deiner Firma — an der Stadtbank entscheiden.` });
  });
}
/* Einzahlen: Anteile zum aktuellen Preis, 1 % Gebühr an die Bank, Fonds legt an */
function fondsEinzahlen(br, betrag) {
  const preis = etfPreis(br), geb = betrag * MARKT.ETF_GEBUEHR, n = (betrag - geb) / preis, f = fondsVon(br);
  f.cash += betrag - geb; G.wettReserve += geb; f.anteile += n;
  fondsInvestieren(br);
  return n;
}
/* Auszahlen: nur aus der Fondskasse; null, wenn sie nicht reicht */
function fondsAuszahlen(br, n) {
  const f = fondsVon(br), brutto = n * etfPreis(br), geb = brutto * MARKT.ETF_GEBUEHR;
  if (brutto - geb > f.cash + 0.01) return null;
  f.cash -= brutto; G.wettReserve += geb; f.anteile -= n;
  return brutto - geb;
}
const etfOffenWert = () => 0;   // Fonds haften selbst, die Bank schuldet niemandem etwas
const bankEigen = () => G.wettReserve;
function etfPublic() {
  return Object.keys(INDUSTRIES).map(br => {
    const pr = etfPreis(br); if (pr == null) return null;
    const f = fondsVon(br);
    return { branche: br, name: INDUSTRIES[br].name, preis: pr, kasse: Math.round(f.cash), wert: Math.round(fondsWert(br)),
      firmen: etfFirmen(br).map(p => p.name), aktien: etfFirmen(br).map(co => ({ firma: co.name, aktien: fondsAktien(br, co) })).filter(x => x.aktien > 0),
      verlauf: (G.etfHist?.[br] || []).slice(-30) };
  }).filter(Boolean);
}
/* ---------- Software-Branche: Shop-Systeme ----------
 * Software-Firmen entwickeln im Entwicklerstudio ein Shop-System und
 * betreiben es in ihren Rechenzentren. Andere Firmen bauen einen
 * Online-Marktplatz und installieren darauf ein System — erst dann verkauft
 * er. Zwei feste Regeln:
 *  1. Der Online-Marktplatz ist der einzige Laden — Verkauf an die Stadt
 *     (frisches Geld) gibt es nur dort, und nur mit installiertem System.
 *     Gibt es keine Software-Firma (oder geht der Anbieter verloren), steht
 *     das Stadtportal bereit: teurer, ohne Extras, aber immer da.
 *  2. Werbung läuft im Sandbox-Modus über das Werbemodul eines Shop-Systems
 *     statt über die Werbeagentur. In allen anderen Modi (v. a. im Renntag,
 *     wo der Race Club sie braucht) bleibt die Agentur.
 * Gebühren je Verkauf und die Einrichtung gehen an den Anbieter, beim
 * Stadtportal an die Stadtkasse. */
const SW_MODULE = {
  basis:       { name: "Shop-Grundsystem", ep: 150 },
  werbung:     { name: "Werbemodul", ep: 60 },
  bewertungen: { name: "Kundenbewertungen", ep: 60, tempo: 0.10 },
  lieferung:   { name: "Lieferdienst", ep: 90, tempo: 0.15 },
};
const SW = {
  INSTALL: 45, PORTAL_INSTALL: 90,   // Sekunden bis der Marktplatz öffnet
  PORTAL_GEBUEHR: 5,                 // % je Verkauf beim Stadtportal
  VERSION_EP: 60,                    // Grundaufwand jeder neuen Version
  WERBE_BOOST: 0.20,                 // Werbemodul: wie eine volle Agentur-Kampagne (+20 %)
  /* Gebühr bis 8 %: Mit höchstens 4 % (und Bots bei 1,5–3,5 %) blieb einer
   * Software-Firma nur ein Bruchteil dessen, was ihre Kunden verdienten.
   * Ein gutes System macht +30–40 % Tempo — da lohnen sich auch 6 % noch
   * deutlich gegenüber dem Stadtportal (5 %, ohne Module). */
  GEB_MIN: 0.5, GEB_MAX: 8, EINR_MAX: 1500,
  /* Werbe-Abo je Marktplatz und Minute. Eine dauerhaft volle Kampagne der
   * alten Werbeagentur kostete rund 660 $/min (11 $/s, siehe AD_PACKAGES).
   * Das erste Abo mit 15–25 $/min war also um das Dreißigfache zu billig —
   * Werbung lohnte sich für jeden immer. Jetzt liegt sie in derselben Liga. */
  ABO_MIN: 60, ABO_MAX: 400, ABO_START: 150,
  HANDELSSTEUER: 0.5,                // Shop-Kauf zwischen Firmen: halbe Börsengebühr an die Stadt
  EP_SPEICHER: 600,                  // so viele EP sammelt ein Studio ohne laufende Entwicklung an
  RUF_START: 80,
  /* Markenwert: Eine Software-Firma hat kaum Lager und wenige Gebäude — ihr
   * Wert steckt im System. Gemessen standen Byteforge und Pixelwerk nach
   * 45 Minuten mit 11–13k $ da, die Produzenten mit 40–180k $, obwohl ihre
   * Systeme in der halben Stadt liefen. Darum zählt das Ertragswert-Prinzip:
   * die Einnahmen der letzten 10 Minuten × MARKENWERT gehen in den Firmenwert. */
  MARKENWERT: 2,
};
/* ---- Skill-Tree je Branche ----
 * Die allgemeinen Module oben wirken auf alle Waren. Daneben hat jede Branche
 * einen eigenen Baum mit drei Stufen, der NUR auf die Waren dieser Branche
 * wirkt: Stufe 1 und 2 machen den Verkauf schneller, Stufe 3 gibt Spielraum
 * beim Preis. Vorher gewann einfach das System mit den meisten Modulen und der
 * niedrigsten Gebühr, und alle Bots wechselten dorthin. Jetzt lohnt sich für
 * eine Agrarfirma ein Agrar-System, für Tech ein Tech-System.
 * Spezialisierung hat ihren Preis: Die erste Branche ist normal teuer. Eine
 * zweite geht erst ab Version 3 und kostet doppelte EP plus 2.000 $, eine
 * dritte erst ab Version 5, vierfache EP plus 8.000 $ — und so weiter. */
const SW_BAEUME = {
  agrar:     { name: "Agrar",          module: ["Frische-Siegel", "Gemüsekisten-Abo", "Hof-zu-Haus"] },
  rohstoff:  { name: "Rohstoff & Bau", module: ["Baustoff-Rechner", "Großhandels-Konto", "Baustellen-Lieferung"] },
  versorger: { name: "Versorger",      module: ["Tarifrechner", "Smart-Meter", "Ökostrom-Label"] },
  tech:      { name: "Technologie",    module: ["Chip-Konfigurator", "B2B-Portal", "Express-Versand"] },
  touristik: { name: "Touristik",      module: ["Online-Buchung", "Bewertungsportal", "Last-Minute-Börse"] },
  ruestung:  { name: "Rüstung",        module: ["Lizenz-Prüfung", "Behörden-Portal", "Sicherheitstransport"] },
};
const SW_STUFE = [ { ep: 90, tempo: 0.15 }, { ep: 140, tempo: 0.15 }, { ep: 200, preis: 0.08 } ];
/* ---- Website-Design je Shop-System ----
 * Jede Software-Firma gestaltet die Website, auf der ihre Kunden verkaufen:
 * Schrift, Farben, Kopfzeile, Produktkarten, Bezahlkarte, Slogan und Banner.
 * Jede neue Version schaltet weitere Optionen frei ("ab": Mindestversion) —
 * so sieht man jedem Shop an, mit welchem System er läuft und von wem es ist.
 * Speichern kostet nichts und geht jederzeit. */
const SW_DESIGN = {
  schrift: { modern: { name: "Modern", ab: 1 }, klassisch: { name: "Klassisch", ab: 1 }, freundlich: { name: "Freundlich", ab: 1 },
             plakativ: { name: "Plakativ", ab: 2 }, technik: { name: "Technik", ab: 3 }, handschrift: { name: "Handschrift", ab: 3 },
             elegant: { name: "Elegant", ab: 4 }, retro: { name: "Retro-Pixel", ab: 5 } },
  thema:   { hell: { name: "Hell", ab: 1 }, creme: { name: "Creme", ab: 2 }, dunkel: { name: "Dunkel", ab: 2 }, neon: { name: "Neon", ab: 4 } },
  ecken:   { rund: { name: "Rund", ab: 1 }, eckig: { name: "Eckig", ab: 2 }, pille: { name: "Sehr rund", ab: 3 } },
  kopf:    { flaeche: { name: "Farbfläche", ab: 1 }, minimal: { name: "Minimal", ab: 2 }, verlauf: { name: "Verlauf", ab: 2 },
             streifen: { name: "Streifen", ab: 3 }, punkte: { name: "Punkte", ab: 3 }, welle: { name: "Welle", ab: 4 } },
  karten:  { standard: { name: "Standard", ab: 1 }, schatten: { name: "Schwebend", ab: 2 }, rahmen: { name: "Farbrahmen", ab: 3 }, glas: { name: "Glas", ab: 5 } },
  motiv:   { verlauf: { name: "Verlauf", ab: 1 }, streifen: { name: "Streifen", ab: 2 }, kreise: { name: "Kreise", ab: 3 }, holo: { name: "Holo", ab: 4 }, metall: { name: "Metall", ab: 5 } },
  effekt:  { aus: { name: "Keiner", ab: 1 }, glanz: { name: "Glanz", ab: 5 }, konfetti: { name: "Konfetti beim Kauf", ab: 6 } },
};
/* Freitexte und Zweitfarbe: ab welcher Version */
const SW_DESIGN_AB = { slogan: 1, akzent: 2, banner: 3 };
const SW_DESIGN_START = { schrift: "modern", thema: "hell", ecken: "rund", kopf: "flaeche", karten: "standard", motiv: "verlauf", effekt: "aus", slogan: "", banner: "", akzent: null };
/* ---- Malprogramm ----
 * Das zweite Produkt einer Software-Firma. Sie entwickelt es im Studio (ab
 * Shop-System v2) und verkauft Lizenzen über einen EIGENEN Online-Marktplatz —
 * ohne eigenen Shop kann niemand es kaufen. Wer eine Lizenz hat, malt damit
 * sein Firmenlogo: Es erscheint im Shop, im Kopf, an der Börse und als Schild
 * an den Gebäuden. Updates der Lizenz sind gratis; jede Version kann mehr. */
const PAINT = {
  AB_SYSTEM: 2,
  STUFEN: [
    { ep: 180, groesse: 16, farben: 8,  werkzeuge: ["stift", "radierer"] },
    { ep: 220, groesse: 24, farben: 16, werkzeuge: ["stift", "radierer", "fuellen"] },
    { ep: 300, groesse: 32, farben: 0,  werkzeuge: ["stift", "radierer", "fuellen", "spiegeln"] },   // 0 = frei wählbar (bis 16)
  ],
  PREIS_MIN: 100, PREIS_MAX: 6000, PREIS_START: 900,
  PALETTE: ["#111827", "#ffffff", "#ef4444", "#f59e0b", "#facc15", "#22c55e", "#3b82f6", "#a855f7",
            "#6b7280", "#d1d5db", "#7f1d1d", "#ea580c", "#14532d", "#0ea5e9", "#1e3a8a", "#ec4899"],
};
const PX_ZEICHEN = "0123456789abcdef";
const paintVon = id => G.paint?.[id] || null;
const paintEigenes = p => Object.values(G.paint || {}).find(x => x.ownerId === p.id) || null;
/* Welche Stufe darf diese Firma benutzen? Eigenes Programm oder Lizenz. */
function paintStufeVon(p) {
  const eigen = paintEigenes(p);
  const lz = p.paintLizenz ? paintVon(p.paintLizenz) : null;
  const v = Math.max(eigen?.version || 0, lz?.version || 0, lz ? 0 : (p.paintLizenzStufe || 0));
  return v >= 1 ? { version: v, ...PAINT.STUFEN[Math.min(v, PAINT.STUFEN.length) - 1], programm: (eigen?.version >= v ? eigen : lz)?.name || p.paintLizenzName || "Malprogramm" } : null;
}
/* Logo prüfen: Raster, Palette und Größe passend zur Stufe */
function logoPruefen(l, stufe) {
  if (!l || !stufe) return null;
  const g = Math.floor(+l.g);
  if (![16, 24, 32].includes(g) || g > stufe.groesse) return null;
  if (!Array.isArray(l.pal) || l.pal.length < 1 || l.pal.length > 16) return null;
  const pal = l.pal.map(c => String(c).toLowerCase());
  if (!pal.every(c => /^#[0-9a-f]{6}$/.test(c))) return null;
  if (stufe.farben && !pal.every(c => PAINT.PALETTE.slice(0, stufe.farben).includes(c))) return null;
  const px = String(l.px || "");
  if (px.length !== g * g || !/^[0-9a-f.]+$/.test(px)) return null;
  if ([...px].some(ch => ch !== "." && PX_ZEICHEN.indexOf(ch) >= pal.length)) return null;
  if (!/[0-9a-f]/.test(px)) return null;   // leeres Bild
  return { g, pal, px };
}
/* Logo für Bots: symmetrisches Pixelmuster in der Firmenfarbe, passend zur
 * Stufe des Programms (Größe, erlaubte Farben). */
function botLogo(farbe, seed, stufe) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const abst = (a, b) => rgb(a).reduce((s2, v, i) => s2 + (v - rgb(b)[i]) ** 2, 0);
  const erlaubt = stufe.farben ? PAINT.PALETTE.slice(0, stufe.farben) : null;
  const naechste = c => erlaubt ? [...erlaubt].filter(x => x !== "#ffffff" && x !== "#111827").sort((a, b) => abst(a, c) - abst(b, c))[0] : c;
  const dunkel = c => "#" + rgb(c).map(v => Math.round(v * 0.55).toString(16).padStart(2, "0")).join("");
  const haupt = naechste(sichereFarbe(farbe));
  const pal = ["#ffffff", haupt, erlaubt ? "#111827" : dunkel(haupt)];
  let h = 2166136261; for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const bit = i => (h >>> (i % 31)) & 1 ^ ((Math.imul(h, i + 7) >>> 13) & 1);
  const g = stufe.groesse, b = g / 8, px = [];
  for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
    const bx = Math.floor(x / b), by = Math.floor(y / b);
    if (bx === 0 || by === 0 || bx === 7 || by === 7) { px.push(1); continue; }   // Rahmen
    const sx = bx <= 3 ? bx : 7 - bx;
    px.push(bit(by * 4 + sx) ? (by > 4 ? 2 : 1) : 0);
  }
  return { g, pal, px: px.map(v => v.toString(16)).join("") };
}
function paintPublic() {
  return Object.values(G.paint || {}).map(x => {
    const owner = G.players[x.ownerId];
    const laeden = G.map.filter(t => t.owner === x.ownerId && t.btype === "onlinemarkt").map(t => ({ x: t.x, y: t.y, offen: swOffen(t) }));
    return { id: x.id, ownerId: x.ownerId, anbieter: owner?.name ?? "—", name: x.name, farbe: owner?.color || "#64748b", version: x.version || 0, preis: x.preis,
      verkauft: x.verkauft || 0, einnahmen10: Math.round((x.eb || []).reduce((a, b) => a + b, 0)), laeden,
      stufe: x.version >= 1 ? PAINT.STUFEN[x.version - 1] : null,
      entwicklung: x.entwicklung ? { version: x.entwicklung.version, ep: Math.floor(x.entwicklung.ep), ziel: x.entwicklung.ziel } : null };
  });
}
function paintVeroeffentlichen(x, p) {
  x.version = x.entwicklung.version; x.entwicklung = null;
  const st = PAINT.STUFEN[x.version - 1];
  marktLog("software", `${p.name} veröffentlicht ${x.name} v${x.version} (${st.groesse}×${st.groesse} Pixel${st.farben ? `, ${st.farben} Farben` : ", freie Farben"})`, { firmaId: p.id });
  io.emit("notice", { text: `Neues Malprogramm: ${x.name} v${x.version} von ${p.name} — Lizenz ${x.preis.toLocaleString("de-DE")} $ in ihrem Online-Shop.` });
  for (const k of Object.values(G.players)) if (k.paintLizenz === x.id && k.id !== p.id)
    emitTo(k.id, "notice", { text: `Gratis-Update: ${x.name} v${x.version} — jetzt ${st.groesse}×${st.groesse} Pixel${st.werkzeuge.includes("fuellen") ? ", Füllen" : ""}${st.werkzeuge.includes("spiegeln") ? ", Spiegeln" : ""}.` });
}
/* Wunsch gegen die freigeschaltete Version prüfen; Gesperrtes bleibt beim alten Wert. */
function swDesignPruefen(wunsch = {}, alt = SW_DESIGN_START, version = 1) {
  const d = { ...SW_DESIGN_START, ...alt };
  for (const [k, optionen] of Object.entries(SW_DESIGN)) {
    const w = wunsch[k];
    if (w != null && optionen[w] && optionen[w].ab <= version) d[k] = w;
  }
  if (wunsch.slogan != null && version >= SW_DESIGN_AB.slogan) d.slogan = sicherText(String(wunsch.slogan).trim().slice(0, 40));
  if (wunsch.banner != null && version >= SW_DESIGN_AB.banner) d.banner = sicherText(String(wunsch.banner).trim().slice(0, 70));
  if (wunsch.akzent !== undefined && version >= SW_DESIGN_AB.akzent) d.akzent = wunsch.akzent ? sichereFarbe(wunsch.akzent) : null;
  return d;
}
/* Weitere Branchen: ab welcher Version, EP-Faktor und Lizenzkosten */
const swAusbau = n => ({ abVersion: 1 + 2 * n, epFaktor: 2 ** n, cash: 2000 * n * n });
/* Welche Branche eine Ware herstellt (aus den Gebäuden abgeleitet) */
let WARE_BRANCHE = null;
const wareBranche = g => {
  if (!WARE_BRANCHE) {
    WARE_BRANCHE = {};
    for (const bt of Object.values(BTYPES)) {
      if (!bt.industry || !SW_BAEUME[bt.industry]) continue;
      const out = bt.out || bt.proc?.out;
      if (out && !WARE_BRANCHE[out]) WARE_BRANCHE[out] = bt.industry;
    }
  }
  return WARE_BRANCHE[g] || null;
};
const swModulId = (br, stufe) => `${br}:${stufe}`;
const swStufeVon = (prod, br) => [1, 2, 3].filter(k => prod.module?.[swModulId(br, k)]).length;
/* Tempo für eine Ware: allgemeine Module + Baum der Branche dieser Ware */
function swTempoFuer(prod, g) {
  if (!prod || prod.portal) return 1;
  let t = 1;
  for (const [m, an] of Object.entries(prod.module || {})) if (an && SW_MODULE[m]?.tempo) t += SW_MODULE[m].tempo;
  const br = wareBranche(g);
  if (br) for (let k = 1; k <= 3; k++) if (prod.module?.[swModulId(br, k)]) t += SW_STUFE[k - 1].tempo || 0;
  return t;
}
const swPreisFuer = (prod, g) => { const br = wareBranche(g); return prod && !prod.portal && br && prod.module?.[swModulId(br, 3)] ? 1 + SW_STUFE[2].preis : 1; };
/* Dasselbe je Kundenbranche (für Bewertung und Anzeige) */
function swTempoBranche(prod, br) {
  if (!prod || prod.portal) return 1;
  let t = 1;
  for (const [m, an] of Object.entries(prod.module || {})) if (an && SW_MODULE[m]?.tempo) t += SW_MODULE[m].tempo;
  if (br) for (let k = 1; k <= 3; k++) if (prod.module?.[swModulId(br, k)]) t += SW_STUFE[k - 1].tempo || 0;
  return t;
}
const STADTPORTAL = "stadtportal";
const istSoftwareFirma = p => (p.industries || [p.industry]).includes("software");
const portalProdukt = () => ({ id: STADTPORTAL, ownerId: null, name: "Stadtportal", farbe: "#64748b", version: 1, module: {},
  einrichtung: 0, gebuehr: SW.PORTAL_GEBUEHR, werbeAbo: 0, ruf: 70, portal: true });
const swVon = id => id === STADTPORTAL ? portalProdukt() : (G.software || {})[id] || null;
const swEigenes = p => Object.values(G.software || {}).find(s => s.ownerId === p.id) || null;
/* Markenwert des eigenen Systems (siehe SW.MARKENWERT) — Teil der Substanz. */
const swMarkenwert = p => {
  const prod = G.software && swEigenes(p), mp = G.paint && paintEigenes(p);
  const summe = (prod?.eb || []).reduce((a, b) => a + b, 0) + (mp?.eb || []).reduce((a, b) => a + b, 0);
  return summe * SW.MARKENWERT;
};
const swKunden = prod => G.map.filter(t => t.system?.produktId === prod.id).length;
const swPlaetze = prod => prod.portal ? Infinity : G.map
  .filter(t => t.owner === prod.ownerId && BTYPES[t.btype]?.rz && t.rzAktiv && !imBau(t))
  .reduce((a, t) => a + BTYPES[t.btype].rz.plaetze * (t.level || 1), 0);
const swTempo = prod => swTempoBranche(prod, null);   // nur die allgemeinen Module
const swOffen = t => !!(t.system && G.tick >= t.system.bis);
/* Gebühr an den Anbieter (oder die Stadt). Zählt bei ihm als Umsatz. */
function swGebuehr(prod, betrag) {
  if (!(betrag > 0)) return;
  if (prod.portal) { G.stadtkasse += betrag; return; }
  const owner = G.players[prod.ownerId];
  if (!owner) { G.stadtkasse += betrag; return; }
  owner.cash += betrag; addRevenue(owner, betrag);
  const live = G.software[prod.id];
  if (live) { live.einnahmen = (live.einnahmen || 0) + betrag; (live.eb ??= [0])[0] += betrag; }
}
/* Einmal je Tick: Auslastung der Anbieter, Ruf, Werbe-Abos, Notlösung. */
function swTick() {
  G.software ??= {};
  G.swFaktor = {};
  for (const prod of Object.values(G.software)) {
    /* Anbieter weg (z. B. Firma aufgelöst): das System gehört der übernehmenden
     * Firma (siehe Fusion) — fehlt auch die, springt das Stadtportal ein. */
    if (!G.players[prod.ownerId]) {
      for (const t of G.map) if (t.system?.produktId === prod.id) {
        t.system = { produktId: STADTPORTAL, bis: G.tick, werbung: false };
        if (t.owner) emitTo(t.owner, "notice", { text: `${prod.name} gibt es nicht mehr — dein Online-Marktplatz läuft jetzt über das Stadtportal.` });
      }
      delete G.software[prod.id];
      continue;
    }
    if (!(prod.version >= 1)) continue;
    const kunden = swKunden(prod), plaetze = swPlaetze(prod);
    const faktor = kunden ? Math.min(1, plaetze / kunden) : 1;
    G.swFaktor[prod.id] = faktor;
    /* Geglätteter Wert (rund eine halbe Minute) für die Bewertung: Ein kurzer
     * Stromausfall soll nicht alle Kunden sofort ins Stadtportal treiben —
     * gemessen wechselten sonst bei jedem Aussetzer alle Bots weg und zahlten
     * beim Zurückwechseln jedes Mal wieder die Einrichtung. */
    prod.faktorEma = (prod.faktorEma ?? 1) * 0.97 + faktor * 0.03;
    const ueber = kunden > 0 && faktor < 1;
    if (ueber !== !!prod.ueberlast) {
      prod.ueberlast = ueber;
      const owner = G.players[prod.ownerId];
      if (ueber) {
        emitTo(prod.ownerId, "notice", { text: plaetze ? `${prod.name} ist überlastet (${kunden} Kunden, ${plaetze} Plätze) — Rechenzentrum ausbauen!` : `${prod.name} fällt aus: Deine Rechenzentren laufen nicht (Strom fehlt?).` });
        marktLog("software", plaetze ? `${prod.name} von ${owner?.name} ist überlastet` : `${prod.name} von ${owner?.name} fällt aus`, { firmaId: prod.ownerId });
      }
    }
    if (G.tick % 10 === 0) prod.ruf = Math.max(0, Math.min(100, (prod.ruf ?? SW.RUF_START) + (ueber ? -1 : 0.2)));
    if (G.tick % 60 === 0) { (prod.eb ??= [0]).unshift(0); if (prod.eb.length > 10) prod.eb.length = 10; }
  }
  if (G.tick % 60 === 0) for (const x of Object.values(G.paint || {})) {
    if (!G.players[x.ownerId]) { delete G.paint[x.id]; continue; }   // Lizenzen bleiben gültig (Stufe gemerkt)
    (x.eb ??= [0]).unshift(0); if (x.eb.length > 10) x.eb.length = 10;
  }
  /* Werbung: Wer sie im System eingeschaltet hat, zahlt das Abo je Minute
   * und je Marktplatz an den Anbieter. */
  G.werbeAktiv = new Set();
  const abos = new Map();
  for (const t of G.map) {
    if (!t.system?.werbung || !swOffen(t) || !t.owner) continue;
    const prod = swVon(t.system.produktId);
    if (!prod?.module?.werbung || (G.swFaktor[prod.id] ?? 1) <= 0) continue;
    G.werbeAktiv.add(t.owner);
    abos.set(t.x + "," + t.y, { kunde: G.players[t.owner], prod });
  }
  if (G.tick % 60 === 0) for (const { kunde, prod } of abos.values()) {
    if (!kunde) continue;
    const abo = prod.werbeAbo || 0;
    if (kunde.cash < abo) {
      for (const t of G.map) if (t.owner === kunde.id && t.system?.produktId === prod.id) t.system.werbung = false;
      G.werbeAktiv.delete(kunde.id);
      emitTo(kunde.id, "notice", { text: `Werbemodul von ${prod.name} pausiert — zu wenig Geld für das Abo (${abo} $/min).` });
      continue;
    }
    kunde.cash -= abo; kunde.stats.werbung += abo; kunde.stats.ausgaben += abo;
    swGebuehr(prod, abo);
  }
}
/* Wert eines Systems aus Sicht eines Kunden — dieselbe Rechnung für Bots und
 * für die Anzeige. Umsatztempo × (1 − Gebühr) + Werbung, gedämpft durch den
 * Ruf, minus die Einrichtung auf rund 20.000 $ Umsatz umgelegt. */
function swWert(prod, br = null) {
  if (!prod || !(prod.version >= 1)) return -1;
  const ruf = prod.portal ? 1 : Math.min(1, (prod.ruf ?? SW.RUF_START) / 80);
  const preis = !prod.portal && br && prod.module?.[swModulId(br, 3)] ? 1 + SW_STUFE[2].preis : 1;
  return (swTempoBranche(prod, br) * preis * (prod.faktorSchnitt ?? prod.faktor ?? 1) * (1 - prod.gebuehr / 100) + (prod.module?.werbung ? 0.06 : 0)) * ruf
    - (prod.einrichtung || 0) / 20000;
}
function softwarePublic() {
  const liste = [portalProdukt(), ...Object.values(G.software || {})];
  return liste.map(s => {
    const kunden = swKunden(s), plaetze = swPlaetze(s);
    const owner = s.ownerId ? G.players[s.ownerId] : null;
    const pub = { faktorSchnitt: s.portal ? 1 : Math.round((s.faktorEma ?? 1) * 100) / 100, id: s.id, ownerId: s.ownerId, anbieter: owner?.name ?? "Stadt", name: s.name, farbe: s.farbe, version: s.version || 0,
      module: s.module || {}, einrichtung: s.einrichtung, gebuehr: s.gebuehr, werbeAbo: s.werbeAbo || 0,
      design: s.portal ? { ...SW_DESIGN_START, kopf: "minimal", schrift: "klassisch" } : (s.design || SW_DESIGN_START),
      kunden, plaetze: Number.isFinite(plaetze) ? plaetze : null, faktor: Math.round((G.swFaktor?.[s.id] ?? 1) * 100) / 100,
      ruf: Math.round(s.ruf ?? SW.RUF_START), portal: !!s.portal, tempo: Math.round(swTempo(s) * 100) / 100,
      einnahmen10: Math.round((s.eb || []).reduce((a, b) => a + b, 0)),
      markenwert: Math.round((s.eb || []).reduce((a, b) => a + b, 0) * SW.MARKENWERT),
      entwicklung: s.entwicklung ? { ep: Math.floor(s.entwicklung.ep), ziel: s.entwicklung.ziel, version: s.entwicklung.version, module: s.entwicklung.module, branchen: s.entwicklung.branchen } : null };
    pub.branchen = s.branchen || [];
    pub.stufen = Object.fromEntries(Object.keys(SW_BAEUME).map(br => [br, swStufeVon(s, br)]));
    pub.wert = Math.round(swWert(pub) * 1000) / 1000;
    pub.wertJe = Object.fromEntries(Object.keys(SW_BAEUME).map(br => [br, Math.round(swWert(pub, br) * 1000) / 1000]));
    return pub;
  });
}
/* Studio und Rechenzentrum laufen im Produktionstakt (siehe runTick). */
function swBetrieb(t, p, bt, sperr = 1) {
  const lvl = levelMult(t.level);
  if (bt.rz) {
    const need = bt.rz.in.strom * lvl;
    t.rzAktiv = (p.inv.strom || 0) >= need;
    if (t.rzAktiv) p.inv.strom -= need;
    return;
  }
  /* Die Rechenzentren haben Vorrang: Das Studio rührt die letzten Strom-Einheiten
   * nicht an (30), sonst fällt bei knappem Strom das laufende System aus, nur weil
   * nebenher an der nächsten Version gearbeitet wird. */
  const RZ_RESERVE = { strom: 30 };
  /* Strom ist Pflicht. Elektronik (Dev-Hardware) ist ein Beschleuniger: Ohne
   * sie arbeitet das Studio mit halbem Tempo weiter. Gemessen stand Byteforge
   * über zehn Minuten bei 240/260 EP, nur weil 0,3 Elektronik/min fehlten. */
  const strom = bt.studio.in.strom * lvl;
  let frac = Math.min(1, Math.max(0, (p.inv.strom || 0) - RZ_RESERVE.strom) / strom);
  if (!(frac > 0)) return;
  frac *= sperr;
  p.inv.strom -= strom * frac;
  const elNeed = (bt.studio.in.elektronik || 0) * lvl * frac;
  let tempo = 1;
  if (elNeed > 0) {
    if ((p.inv.elektronik || 0) >= elNeed) p.inv.elektronik -= elNeed;
    else tempo = 0.5;
  }
  const ep = bt.studio.ep * lvl * frac * tempo;
  const prod = swEigenes(p), mp = paintEigenes(p);
  /* Laufen Shop-System und Malprogramm gleichzeitig, teilt das Studio seine
   * EP halb und halb — sonst käme das Malprogramm bei Firmen, die ständig am
   * System weiterbauen, nie voran. */
  const beide = !!(prod?.entwicklung && mp?.entwicklung), lauf = !!(prod?.entwicklung || mp?.entwicklung);
  if (prod?.entwicklung) {
    prod.entwicklung.ep += beide ? ep / 2 : ep;
    if (prod.entwicklung.ep >= prod.entwicklung.ziel) swVeroeffentlichen(prod, p);
  }
  if (mp?.entwicklung) {
    mp.entwicklung.ep += beide ? ep / 2 : ep;
    if (mp.entwicklung.ep >= mp.entwicklung.ziel) paintVeroeffentlichen(mp, p);
  }
  if (!lauf) p.swEp = Math.min(SW.EP_SPEICHER, (p.swEp || 0) + ep);
}
function swVeroeffentlichen(prod, p) {
  const e = prod.entwicklung;
  prod.version = e.version; prod.module = { ...e.module }; prod.branchen = [...(e.branchen || prod.branchen || [])]; prod.entwicklung = null;
  prod.released = G.tick; prod.ruf = Math.min(100, (prod.ruf ?? SW.RUF_START) + 5);
  G.softwareNeu = G.tick;
  const was = Object.keys(prod.module).filter(m => prod.module[m])
    .map(m => SW_MODULE[m]?.name || SW_BAEUME[m.split(":")[0]]?.module[+m.split(":")[1] - 1] || m).join(", ");
  marktLog("software", `${p.name} veröffentlicht ${prod.name} v${prod.version}${was ? ` (${was})` : ""}`, { firmaId: p.id });
  io.emit("notice", { text: `Neue Software: ${prod.name} v${prod.version} von ${p.name} — ${prod.gebuehr.toLocaleString("de-DE")} % je Verkauf.` });
  logTx(p, "Software", `${prod.name} v${prod.version} veröffentlicht`, 0);
  /* Neue Design-Optionen dieser Version melden */
  const neu = Object.values(SW_DESIGN).flatMap(o => Object.values(o).filter(x => x.ab === prod.version).map(x => x.name))
    .concat(Object.entries(SW_DESIGN_AB).filter(([, ab]) => ab === prod.version).map(([k]) => ({ slogan: "Slogan", akzent: "Zweitfarbe", banner: "Banner" })[k]));
  if (neu.length) emitTo(p.id, "notice", { text: `Website-Design: Mit v${prod.version} neu freigeschaltet — ${neu.join(", ")}.` });
}

/* Stadtnetz-Angebot je Ware nachfüllen (siehe STADTNETZ). Die Menge
 * wächst fließend, im Orderbuch steht der ganzzahlige Teil. */
function stadtnetzTick() {
  G.stadtnetz ??= {};
  for (const [g, c] of Object.entries(STADTNETZ)) {
    const st = G.stadtnetz[g] ??= { vorrat: c.max / 2, orderId: null, qty: 0 };
    let o = st.orderId != null ? G.orders.find(o2 => o2.id === st.orderId) : null;
    st.vorrat -= st.qty - (o ? o.qty : 0);              // seit dem letzten Tick verkauft
    st.vorrat = Math.min(c.max, Math.max(0, st.vorrat) + c.proMin / 60);
    const qty = Math.floor(st.vorrat);
    if (qty < 1) { if (o) G.orders.splice(G.orders.indexOf(o), 1); st.orderId = null; st.qty = 0; continue; }
    if (!o) {
      o = { id: id(), side: "sell", good: g, qty, price: 0, playerId: STADTNETZ_ID, player: "Stadtnetz · Notversorgung", ts: Date.now(), stadt: true };
      G.orders.push(o); st.orderId = o.id;
    }
    o.qty = qty; o.price = Math.round(BASEP[g] * c.faktor * 100) / 100;
    st.qty = qty;
  }
}

/* Öffentliche Kursdaten je Firma */
function marktPublic(p) {
  const F = fundament(p), P = kursVon(p);
  return { kurs: Math.round(P * 100) / 100, fundament: Math.round(F / AKTIEN * 100) / 100, luecke: Math.round((F - P * AKTIEN) / F * 1000) / 1000 };
}
/* Ein zurückgezogenes oder hinfälliges Angebot gibt die verwahrten Anteile an
 * den Verkäufer zurück — sonst verschwänden sie aus der Cap-Table und die Summe
 * der Anteile einer Firma wäre nicht mehr 100 %. */
function returnListingToSeller(l) {
  const company = G.players[l.companyId];
  const sellerId = l.sellerId ?? l.companyId;
  if (!company || (!G.players[sellerId] && !istInstitution(sellerId))) return;
  company.equity[sellerId] = (company.equity[sellerId] || 0) + l.count;
}
function debtOf(p) {
  return G.bonds.filter(b => b.issuerId === p.id && b.holderId).reduce((s, b) => s + b.principal, 0);
}
// Rating rein aus Nettovermögen & Verschuldungsgrad des Spielers — keine Fantasiewerte
function rating(p) {
  const nw = netWorth(p), debt = debtOf(p);
  if (nw <= 0) return "D";
  const lever = debt / Math.max(1, nw + debt);
  const steps = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
  let i = Math.min(6, Math.floor(lever * 8));
  if (nw < 2000) i = Math.min(6, i + 2);       // kleine Firmen = riskanter
  else if (nw > 100000) i = Math.max(0, i - 1);
  return steps[i];
}

/* ---------- Matching-Engine (reines P2P) ----------
 * Sell-Orders und Buy-Orders liegen im selben Buch. Beim Einstellen einer
 * Order wird sofort gegen die Gegenseite gematcht (Preis-Zeit-Priorität);
 * der Rest bleibt als Limit-Order stehen. Trades setzen den Tickerpreis. */
function escrowForOrder(p, o) {           // Sell: Ware sperren, Buy: Geld sperren
  if (o.side === "sell") { p.inv[o.good] -= o.qty; }
  else { p.cash -= o.qty * o.price; }
}
function refundOrder(o) {
  const p = G.players[o.playerId];
  if (!p) return;
  if (o.side === "sell") p.inv[o.good] += o.qty;
  else p.cash += o.qty * o.price;
}
function settleTrade(good, qty, price, buyerId, sellerId) {
  const buyer = G.players[buyerId], seller = G.players[sellerId];
  const gname = GOODS[good].name;
  if (buyer) { buyer.inv[good] += qty; gainXp(buyer, 2);
    const r = salesRec(buyer, good); r.buyQty += qty; r.buyCost += qty * price;
    buyer.stats.ausgaben += qty * price;
    logTx(buyer, "Kauf", `Kauf ${qty}× ${gname} von ${seller?.name ?? (sellerId === STADTNETZ_ID ? "Stadtnetz" : "?")}`, -qty * price); }
  if (sellerId === STADTNETZ_ID) G.stadtkasse += qty * price;   // Notversorgung: Erlös an die Stadt
  if (seller) {
    const geb = Math.round(qty * price * satzBoerse() * 100) / 100;
    seller.cash += qty * price - geb; addRevenue(seller, qty * price - geb); gainXp(seller, 2);
    if (geb > 0) { finanzamtEinnahme(geb); G.boerseGebuehren = (G.boerseGebuehren || 0) + geb;
      seller.stats.steuern = (seller.stats.steuern || 0) + geb; }
    const r = salesRec(seller, good); r.playerQty += qty; r.playerRev += qty * price;
    const summe = qty * price;
    if (!seller.stats.besterHandel || summe > seller.stats.besterHandel.summe)
      seller.stats.besterHandel = { good, qty, price, summe, partner: buyer?.name ?? "?" };
    logTx(seller, "Verkauf", `Verkauf ${qty}× ${gname} an ${buyer?.name ?? "?"}${geb > 0 ? ` (−${Math.round(geb)} $ Börsengebühr)` : ""}`, qty * price - geb);
    kartellUmsatzMerken(seller, good, qty * price); }
  G.lastTrade[good] = price;
  io.emit("trade", { good, qty, price, buyer: buyer?.name, seller: seller?.name ?? (sellerId === STADTNETZ_ID ? "Stadtnetz" : undefined) });
}
function matchOrder(order) {
  const opp = order.side === "sell" ? "buy" : "sell";
  const book = G.orders
    .filter(o => o.good === order.good && o.side === opp && o.playerId !== order.playerId)
    .sort((a, b) => (opp === "buy" ? b.price - a.price : a.price - b.price) || a.ts - b.ts);
  for (const o of book) {
    if (order.qty <= 0) break;
    const crosses = order.side === "sell" ? o.price >= order.price : o.price <= order.price;
    if (!crosses) break;
    const qty = Math.min(order.qty, o.qty);
    const price = o.price;                        // Preis der liegenden Order gilt
    const buyerId  = order.side === "buy"  ? order.playerId : o.playerId;
    const sellerId = order.side === "sell" ? order.playerId : o.playerId;
    // Escrow-Ausgleich: Buy-Order hat ggf. mehr Geld gesperrt als der Ausführungspreis
    if (order.side === "buy" && order.price > price) G.players[buyerId].cash += qty * (order.price - price);
    settleTrade(order.good, qty, price, buyerId, sellerId);
    order.qty -= qty; o.qty -= qty;
    if (o.qty <= 0) G.orders.splice(G.orders.indexOf(o), 1);
  }
  if (order.qty > 0) G.orders.push(order);
}

/* ---------- Gruppenaufträge ---------- */
function spawnGroupOrder() {
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const nGoods = Math.random() < 0.5 ? 1 : 2;
  const goods = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, nGoods);
  const needs = {};
  /* Zielwert je Ware, skaliert mit der Spielerzahl — die mit Abstand
   * bestvergütete Absatzquelle (Ø×2 vs. Vertrieb ×1,2–1,6), aber nur gemeinsam
   * schaffbar. Die Menge ist auf die kurze Laufzeit von 5 Minuten ausgelegt:
   * lieber viele kleine Aufträge in Folge als ein riesiger, der halb liegen
   * bleibt. Über die Zeit kommt dadurch mehr zusammen, nicht weniger. */
  const playerScale = Math.max(1, 0.5 + Object.keys(G.players).length * 0.5);
  for (const g of goods) {
    const targetVal = GROUP_VALUE || (700 + Math.random() * 900) * playerScale;
    needs[g] = { req: Math.max(3, Math.round(targetVal / MM[g].price)), have: 0,
      pay: Math.round(MM[g].price * GROUP_PAYOUT_MULT * 100) / 100 };   // Stückpreis beim Spawn fixiert
  }
  G.groupOrder = { id: id(), city, needs, contrib: {}, ttl: GROUP_TTL, praemie: 0 };
  grossauftragPraemie(G.groupOrder);
  const txt = Object.entries(needs).map(([g, n]) => `${n.req}× ${GOODS[g].name}`).join(" und ");
  const vol = Object.entries(needs).reduce((s, [g, n]) => s + n.req * n.pay, 0) + G.groupOrder.praemie;
  G.groupOrder.volumen = Math.round(vol);
  io.emit("notice", { text: `GROSSAUFTRAG: ${city} braucht ${txt} — Gesamttopf ~${Math.round(vol).toLocaleString("de-DE")} $${G.groupOrder.praemie ? ` inkl. ${G.groupOrder.praemie.toLocaleString("de-DE")} $ Prämie der Stadtkasse` : ` (Ø×${GROUP_PAYOUT_MULT})`}! ${GROUP_TTL / 60} Minuten Zeit.` });
}
function finishGroupOrder() {
  const o = G.groupOrder;
  /* Prämie der Stadtkasse anteilig nach geliefertem Wert verteilen */
  const wertVon = goods => Object.entries(goods).reduce((a, [g, q]) => a + q * o.needs[g].pay, 0);
  const gesamtWert = Object.values(o.contrib).reduce((a, goods) => a + wertVon(goods), 0) || 1;
  for (const [pid, goods] of Object.entries(o.contrib)) {
    const p = G.players[pid];
    if (!p) continue;
    let sum = wertVon(goods) * (1 + (o.praemie || 0) / gesamtWert);   // fixierter Stückpreis + Prämie
    p.cash += sum; addRevenue(p, sum); gainXp(p, 40); p.stats.grossauftraege++;
    logTx(p, "Gruppenauftrag", `${o.city} beliefert (Ø×${GROUP_PAYOUT_MULT})`, sum);
    emitTo(pid, "notice", { text: `${o.city} abgeschlossen — deine Auszahlung: ${Math.round(sum)} $` });
  }
  io.emit("notice", { text: `Gruppenauftrag für ${o.city} erfüllt! Alle Einzahler wurden ausgezahlt.` });
  G.groupOrder = null; G.nextGroupIn = GROUP_GAP();
}

/* ---------- Aktien: Dividendenausschüttung alle 10 min ----------
 * Ein Anteil (DIVIDEND_RATE) des seit der letzten Ausschüttung erzielten
 * Erlöses wird proportional zu den verkauften 25%-Anteilen an deren Halter
 * ausgezahlt (Eigenbesitz braucht nicht bewegt zu werden — bleibt einfach
 * im Firmen-Cash). Der Rest-Erlös verbleibt vollständig bei der Firma. */
/* Einstandswert einer Beteiligung mitführen. Ohne ihn zeigt das Depot zwar den
 * aktuellen Wert, aber nicht, ob die Beteiligung im Plus oder im Minus steht —
 * und genau das ist die Frage beim Verkaufen.
 * Durchschnittsmethode: Der Ø-Preis JE BLOCK ändert sich nur beim Zukauf, ein
 * Verkauf lässt ihn unberührt. Das spart die fehleranfällige Fortschreibung an
 * jedem Abgang. Bereits zum Verkauf eingestellte Blöcke liegen in Verwahrung
 * (equity ist dann schon reduziert) und werden mitgezählt — sonst würde ein
 * Zukauf während eines offenen Angebots den Schnitt verfälschen. */
function merkeEinstand(kaeufer, company, count, preis) {
  const verwahrt = G.shareListings
    .filter(l => l.companyId === company.id && (l.sellerId ?? l.companyId) === kaeufer.id)
    .reduce((a, l) => a + l.count, 0);
  const vorher = (company.equity[kaeufer.id] || 0) + verwahrt;   // vor dem Zukauf aufrufen
  const alt = kaeufer.equityAvg[company.id] || 0;
  const nachher = vorher + count;
  if (nachher > 0) kaeufer.equityAvg[company.id] = (alt * vorher + preis) / nachher;
}

/* ---------- Nachrichtenzentrale ----------
 * Alle zwei Minuten ein Marktbericht in den Chat. Die Lage im Spiel ist zwar
 * vollständig sichtbar, aber über acht Panels verteilt: Wer gerade baut,
 * bemerkt weder einen einbrechenden Kurs noch einen Konkurrenten, der
 * davonzieht. Der Bericht fasst genau das zusammen, was sonst niemand
 * nachschlägt — und nutzt dieselben Verläufe, die auch die Charts speisen. */
const NEWS_INTERVAL = 120;   // Ticks (1x/s) = 2 min
const NEWS_FENSTER = 12;     // Verlaufspunkte à 10 s = ebenfalls 2 min

function veraenderung(reihe, fenster) {
  if (!reihe || reihe.length < 2) return null;
  const von = reihe[Math.max(0, reihe.length - 1 - fenster)], bis = reihe[reihe.length - 1];
  if (!von) return null;
  return (bis / von - 1) * 100;
}

/* Aufzählung in Fließtext: „A, B und C". Verben werden im Text immer auf die
 * LÄNGE der Liste bezogen formuliert, nie auf das Geschlecht der Ware — sonst
 * müsste jedes Gut einen Genus-Eintrag bekommen, nur damit „Erze klettert"
 * nicht falsch dasteht. */
function liste(teile) {
  if (teile.length <= 1) return teile[0] || "";
  return teile.slice(0, -1).join(", ") + " und " + teile[teile.length - 1];
}
const proz = v => (v > 0 ? "+" : "−") + Math.abs(v).toFixed(0) + " Prozent";
const geld = v => v.toFixed(2).replace(".", ",") + " $";
const wucht = v => Math.abs(v) >= 25 ? "sprunghaft" : Math.abs(v) >= 12 ? "deutlich" : "leicht";

/* Der Bericht entsteht in beiden Sprachen und reist gemeinsam mit — der Client
 * wählt beim Anzeigen. Eine Übersetzung im Browser ginge nicht: Das hier sind
 * gebaute Sätze, keine festen Beschriftungen. */
function marktbericht(sp) {
  const en = sp === "en";
  const wandel = k => veraenderung(G.priceHist[k], NEWS_FENSTER);
  const wname = k => (en ? GOODS[k].en : GOODS[k].name) || GOODS[k].name;
  const proz = v => (v > 0 ? "+" : "−") + Math.abs(v).toFixed(0) + (en ? " percent" : " Prozent");
  const geld = v => en ? "$" + v.toFixed(2) : v.toFixed(2).replace(".", ",") + " $";
  const zahl = v => v.toLocaleString(en ? "en-US" : "de-DE");
  const liste = teile => teile.length <= 1 ? (teile[0] || "")
    : teile.slice(0, -1).join(", ") + (en ? " and " : " und ") + teile[teile.length - 1];

  const waren = Object.keys(GOODS)
    .map(k => ({ k, name: wname(k), v: wandel(k), kurs: MM[k].price }))
    .filter(x => x.v != null && Math.abs(x.v) >= 2).sort((a, b) => b.v - a.v);
  const hoch = waren.filter(x => x.v > 0).slice(0, 3);
  const tief = waren.filter(x => x.v < 0).slice(-3).reverse();

  const knapp = Object.keys(GOODS).map(k => {
    const angebot = G.orders.filter(o => o.good === k && o.side === "sell").reduce((a, o) => a + o.qty, 0);
    const nachfrage = G.orders.filter(o => o.good === k && o.side === "buy").reduce((a, o) => a + o.qty, 0);
    return { k, name: wname(k), nachfrage, leer: angebot === 0 && nachfrage >= 10 };
  }).filter(x => x.leer).sort((a, b) => b.nachfrage - a.nachfrage);

  const firmen = Object.values(G.players)
    .map(p => ({ p, v: veraenderung(G.firmHist[p.id], NEWS_FENSTER) }))
    .filter(x => x.v != null && x.v >= 1).sort((a, b) => b.v - a.v);
  const rang = Object.values(G.players).sort((a, b) => netWorth(b) - netWorth(a));

  let schlagzeile;
  if (knapp.length && knapp[0].nachfrage >= 40)
    schlagzeile = en ? `${knapp[0].name} sold out — ${knapp[0].nachfrage} units wanted, none on offer`
                     : `${knapp[0].name} ausverkauft — ${knapp[0].nachfrage} Einheiten gesucht, keine im Angebot`;
  else if (hoch.length && hoch[0].v >= 20)
    schlagzeile = en ? `${hoch[0].name} surges: ${proz(hoch[0].v)} to ${geld(hoch[0].kurs)}`
                     : `${hoch[0].name} zieht kräftig an: ${proz(hoch[0].v)} auf ${geld(hoch[0].kurs)}`;
  else if (tief.length && tief[0].v <= -15)
    schlagzeile = en ? `${tief[0].name} slumps: ${proz(tief[0].v)} to ${geld(tief[0].kurs)}`
                     : `${tief[0].name} bricht ein: ${proz(tief[0].v)} auf ${geld(tief[0].kurs)}`;
  else if (firmen.length && firmen[0].v >= 10)
    schlagzeile = en ? `${firmen[0].p.name} pulls ahead — company value ${proz(firmen[0].v)}`
                     : `${firmen[0].p.name} zieht davon — Firmenwert ${proz(firmen[0].v)}`;
  else if (knapp.length)
    schlagzeile = en ? `${knapp[0].name} remains in short supply` : `${knapp[0].name} bleibt Mangelware`;
  else
    schlagzeile = en ? "Quiet trading, no major swings" : "Ruhiger Handel, keine großen Ausschläge";

  const absaetze = [];
  if (hoch.length || tief.length) {
    const teile = [];
    const nenn = x => en ? `${x.name} (${proz(x.v)} to ${geld(x.kurs)})` : `${x.name} (${proz(x.v)} auf ${geld(x.kurs)})`;
    if (hoch.length) teile.push(en
      ? `The biggest gains went to ${liste(hoch.map(nenn))}`
      : `Am kräftigsten ${hoch.length > 1 ? "legten" : "legte"} ${liste(hoch.map(nenn))} zu`);
    if (tief.length) {
      const auftakt = en ? (hoch.length ? "Losing ground: " : "Down this period: ")
        : (hoch.length ? "Nach unten ging es dagegen für " : (tief.length > 1 ? "Nachgegeben haben " : "Nachgegeben hat "));
      teile.push(auftakt + liste(tief.map(nenn)));
    }
    absaetze.push(teile.join(". ") + ".");
  }

  if (knapp.length) {
    const erste = knapp[0];
    const nenn = x => en ? `${x.name} (${x.nachfrage} wanted)` : `${x.name} (${x.nachfrage} gesucht)`;
    let t = en
      ? `Currently unavailable: ${liste(knapp.slice(0, 4).map(nenn))}. `
      : `Nicht lieferbar ${knapp.length > 1 ? "sind derzeit" : "ist derzeit"} ${liste(knapp.slice(0, 4).map(nenn))}. `;
    t += erste.nachfrage >= 60
      ? (en ? `The gap is widest for ${erste.name} — whoever produces it now sets the price.`
            : `Vor allem bei ${erste.name} klafft eine große Lücke — wer jetzt produziert, kann seinen Preis selbst bestimmen.`)
      : (en ? `Anyone making these goods will find buyers without effort.`
            : `Wer diese Waren herstellt, findet gerade mühelos Abnehmer.`);
    absaetze.push(t);
  } else if (waren.length) {
    absaetze.push(en ? "No supply shortages at the moment — every good in demand can be had on the market."
                     : "Lieferengpässe gibt es derzeit keine — alle nachgefragten Waren sind am Markt zu haben.");
  }

  if (firmen.length) {
    const spitze = firmen.slice(0, 3);
    absaetze.push(en
      ? `On the exchange, ${liste(spitze.map(x => `${x.p.name} ${proz(x.v)}`))} gained in value. One share of ${spitze[0].p.name} now trades at $${zahl(kursVon(spitze[0].p))}.`
      : `An der Börse ${spitze.length > 1 ? "gewannen" : "gewann"} ${liste(spitze.map(x => `${x.p.name} ${proz(x.v)}`))} an Wert. Eine Aktie von ${spitze[0].p.name} kostet inzwischen ${zahl(kursVon(spitze[0].p))} $.`);
  }

  if (rang.length) {
    const f = rang[0], zweiter = rang[1];
    let t = en ? `${f.name} leads with $${zahl(Math.round(netWorth(f)))} in net worth`
               : `An der Spitze steht ${f.name} mit ${zahl(Math.round(netWorth(f)))} $ Nettovermögen`;
    if (zweiter) {
      const abstand = Math.round(netWorth(f) - netWorth(zweiter));
      const knappDran = abstand < netWorth(f) * 0.05;
      t += en
        ? (knappDran ? `, with ${zweiter.name} right behind — just $${zahl(abstand)} between them.`
                     : `, $${zahl(abstand)} ahead of ${zweiter.name}.`)
        : (knappDran ? `, dicht gefolgt von ${zweiter.name} — nur ${zahl(abstand)} $ trennen die beiden.`
                     : `, mit ${zahl(abstand)} $ Vorsprung auf ${zweiter.name}.`);
    } else t += ".";
    absaetze.push(t);
  }

  return absaetze.length ? { schlagzeile, absaetze } : null;
}

function sendeMarktbericht() {
  const bericht = marktbericht("de"), berichtEn = marktbericht("en");
  if (!bericht) return;   // in den ersten Minuten gibt es schlicht nichts zu melden
  /* Die Berichte sammeln sich in der Nachrichtenzentrale, statt im Chat
   * vorbeizuziehen: Dort geht ein Bericht zwischen den Nachrichten der
   * Mitspieler unter, und wer später dazukommt, sieht ihn nie. Im Panel steht
   * die Entwicklung der letzten Viertelstunde am Stück. */
  G.news.unshift({ ...bericht, en: berichtEn, min: Math.round(G.tick / 60), ts: Date.now() });
  if (G.news.length > 8) G.news.pop();
  io.emit("notice", { text: "Neuer Marktbericht der Nachrichtenzentrale" });
  pushState();
}

/* Aktionär "Finanzamt": hält eigene Aktien (Stabilisator, siehe Etappe 2);
 * seine Dividenden fließen in die Stadtkasse. */
const FA_ID = "__fa";
function distributeDividends() {
  for (const p of Object.values(G.players)) {
    /* Die Firma legt die Ausschüttung selbst fest: automatisch ein Anteil des
     * Umsatzes der Periode (wie bisher) oder ein fester Betrag — höchstens so
     * viel, wie in der Kasse liegt. Verteilt wird nach Aktien; was auf die
     * eigenen Aktien entfiele, bleibt einfach in der Firma. */
    const wunsch = p.ausschuettung == null ? (p.revenue > 0 ? p.revenue * DIVIDEND_RATE : 0) : p.ausschuettung;
    const pool = Math.min(wunsch, Math.max(0, p.cash));
    let paidOut = 0;
    if (pool > 0.01) {
      /* Das Finanzamt hält seinen Bestand fast immer im stehenden Angebot
       * (Verwahrung) — er zählt trotzdem voll für die Dividende. */
      const fa = faGesamt(p);
      if (fa > 0) { const share = pool * (fa / AKTIEN); p.cash -= share; paidOut += share; G.stadtkasse += share; }
      for (const br of Object.keys(G.fonds || {})) {
        const n = fondsAktien(br, p);
        if (n > 0) { const share = pool * (n / AKTIEN); p.cash -= share; paidOut += share; fondsVon(br).cash += share; }
      }
      for (const [holderId, count] of Object.entries(p.equity)) {
        if (holderId === p.id || istInstitution(holderId) || !(count > 0)) continue;
        const share = pool * (count / AKTIEN);
        const pct = Math.round(count / AKTIEN * 1000) / 10;
        const holder = G.players[holderId];
        if (!holder) continue;
        p.cash -= share; holder.cash += share; paidOut += share;
        holder.stats.dividendeRein += share;
        logTx(holder, "Dividende", `${count} Aktien (${pct} %) an ${p.name}`, share);
        emitTo(holderId, "notice", { text: `Dividende von ${p.name}: +${Math.round(share)} $ (${count} Aktien)` });
      }
      if (paidOut > 0.01) {
        p.stats.dividendeRaus += paidOut;
        /* Ausschüttung verlässt die Firma: senkt F um genau diesen Betrag.
         * Für den Ertrag in F wird sie herausgerechnet (kapitalNetto). */
        p.stats.kapitalNetto = (p.stats.kapitalNetto || 0) - paidOut;
        logTx(p, "Dividende", "Dividenden an Aktionäre ausgeschüttet", -paidOut);
        marktLog("ausschuettung", `${p.name} schüttet ${Math.round(paidOut)} $ aus`, { firmaId: p.id, betrag: Math.round(paidOut) });
      }
    }
    p.revenue = 0;
  }
}



/* ---------- Finanzamt ----------
 * Gewinnsteuer alle 10 Minuten (mit der Dividende): 8 % auf den Gewinn des
 * Zeitraums über einem Freibetrag von 1.000 $. Gewinn = Umsatz + Dividenden
 * + Zinserträge − Ausgaben (Bau, Ausbau, Einkauf, Werbung, Gehälter) −
 * ausgezahlte Dividenden − Zinsaufwand. Wettgewinne: 10 % auf den Reingewinn.
 * Bots zahlen genauso wie Spieler. Einnahmen: 40 % Bankreserve (Kurswetten),
 * 60 % Stadtkasse (Großauftrags-Prämien und Stadtprojekte). */
const STEUER_SATZ = 0.08, STEUER_FREI = 1000, WETT_STEUER = 0.10;
const STEUER_RESERVE_ANTEIL = 0.4, RESERVE_MAX_ANTEIL = 0.10;
/* Grundstock der Stadt: Mit dieser Summe startet die Kasse, und sie bleibt als
 * eiserne Rücklage immer liegen. Prämien und Stadtprojekte zahlt die Stadt nur
 * aus dem Geld DARÜBER. Vorher nahm ein Projekt 80 % der ganzen Kasse — direkt
 * danach rief das Finanzamt den Notstand aus, den die Stadt selbst verursacht
 * hatte, und die Steuern stiegen ausgerechnet nach dem Bau. Jetzt kann die
 * Lage nur noch durch echte Verluste fallen (etwa Kurswetten gegen die Bank). */
const STADT_GRUNDSTOCK = 20000;
const stadtFrei = () => Math.max(0, G.stadtkasse - STADT_GRUNDSTOCK);
/* Abgestimmt per Simulation (12 Bots, je 45 min, Zeitraffer): Mit 20 % je
 * Großauftrag frassen die Prämien jeden Überschuss — in sieben Läufen startete
 * kein einziges Projekt. Mit 10 %, höchstens 1.500 $, und Projekten ab 10.000 $
 * über dem Grundstock (Kasse ab 30.000 $) kommen ~2 Projekte je 45 min. */
const PRAEMIE_MAX = 1500;
const PRAEMIE_ANTEIL = 0.1, PROJEKT_SCHWELLE = STADT_GRUNDSTOCK + 10000, PROJEKT_BUDGET = 0.8, PROJEKT_TTL = 600, PROJEKT_PAUSE = 300;
const STADTPROJEKTE = [
  { key: "stadion", name: "Stadion" }, { key: "krankenhaus", name: "Krankenhaus" },
  { key: "hafen", name: "Hafenterminal" }, { key: "bibliothek", name: "Stadtbibliothek" },
  { key: "messe", name: "Messehalle" }, { key: "bahnhof", name: "Hauptbahnhof" },
];
const finanzamtAktiv = () => MODE !== "kartell" && MODE !== "plan";
/* Börsengebühr: der Verkäufer gibt einen Teil des Erlöses jedes Warenbörsen-
 * Handels an das Finanzamt ab (Basis 20 %, je nach Lage 15–25 %). */
const BOERSE_GEBUEHR = 0.20;
/* Dynamische Sätze: Alle 60 s schaut das Finanzamt auf die Lage der Stadt —
 * Stadtkasse plus das, was die Bankreserve über ihrem Startwert hat (Kurswetten,
 * die für die Bank gut liefen, machen die Stadt reicher; schlecht gelaufene
 * ziehen sie runter). Pro Prüfung höchstens eine Stufe, damit nichts springt.
 * Ein Faktor gilt für alle drei Sätze: Gewinnsteuer, Wettsteuer, Börsengebühr. */
/* Ab 20.000 $ ist alles normal — keine Rabatte darüber. Da die Kasse mit dem
 * Grundstock (20.000 $) startet und Projekte/Prämien ihn nicht anrühren, fällt
 * die Lage nur durch echte Verluste der Bank (Kurswetten) darunter. */
const STEUER_STUFEN = [
  { key: "notstand",  name: "Notstand",     faktor: 1.25, bis: 3000 },
  { key: "knapp",     name: "Knappe Kasse", faktor: 1.10, bis: 20000 },
  { key: "normal",    name: "Normal",       faktor: 1.00, bis: Infinity },
];
const STUFE_TEXT = {
  notstand:  "NOTSTAND: Die Stadt hat kaum noch Geld — alle Steuern und Gebühren +25 %.",
  knapp:     "Die Stadtkasse wird knapp — Steuern und Gebühren steigen um 10 %.",
  normal:    "Die Stadtfinanzen sind im Lot — Steuern und Gebühren wieder normal.",
};
/* Lage der Stadt: Kasse plus das, was die Bank über ihrem Startkapital hat.
 * Die Einsätze der Bank in laufenden Kurswetten zählen MIT — beim Einfrieren
 * gehen sie aus der Reserve und kommen erst bei der Abrechnung zurück. Ohne
 * sie sah die Stadt während jeder Wettrunde ärmer aus, als sie war, und das
 * Finanzamt erhöhte die Steuern wegen Geld, das nur gebunden war. */
const bankImEinsatz = () => G.wetten.reduce((a, w) => a + (w.bank ? w.einsatz : 0), 0);
const stadtVermoegen = () => G.stadtkasse + faBuchwert() + Math.max(-WETT_RESERVE, bankEigen() + bankImEinsatz() - WETT_RESERVE);
const steuerStufe = () => STEUER_STUFEN[G.steuerStufe ?? 2];
const steuerFaktor = () => steuerStufe().faktor;
const satzGewinn = () => STEUER_SATZ * steuerFaktor();
const satzWette  = () => WETT_STEUER * steuerFaktor();
const satzBoerse = () => finanzamtAktiv() ? BOERSE_GEBUEHR * steuerFaktor() : 0;
function steuerStufePruefen() {
  const v = stadtVermoegen();
  const ziel = STEUER_STUFEN.findIndex(st => v < st.bis);
  const alt = G.steuerStufe ?? 2;
  if (ziel === alt) return;
  G.steuerStufe = alt + Math.sign(ziel - alt);
  const st = steuerStufe();
  io.emit("notice", { text: `Finanzamt: ${STUFE_TEXT[st.key]} Börsengebühr jetzt ${Math.round(satzBoerse() * 1000) / 10} %, Gewinnsteuer ${Math.round(satzGewinn() * 1000) / 10} %.` });
}
/* Abschreibung: Bau und Ausbau mindern den steuerlichen Gewinn nicht mehr
 * sofort, sondern gleichmäßig über MARKT.AFA_DAUER. Vorher stellten die Bots
 * jeden Gewinn sofort in Gebäude, und die Gewinnsteuer brachte in 40 Minuten
 * keine 1.000 $ — obwohl die Firmen auf das Neunfache wuchsen. */
function investieren(p, betrag) {
  if (!(betrag > 0)) return;
  p.stats.investiert = (p.stats.investiert || 0) + betrag;
  (p.afa ??= []).push({ b: betrag, t: G.tick });
}
function abschreibungBisher(p) {
  let s = 0;
  for (const a of p.afa || []) s += Math.min(a.b, a.b * Math.max(0, G.tick - a.t) / MARKT.AFA_DAUER);
  return s + (p.afaFertig || 0);
}
function steuerBasis(p) {
  const st = p.stats;
  /* Ausgaben ohne Investitionen, dafür die bisher angefallene Abschreibung.
   * Dividenden an Aktionäre sind Gewinnverwendung — sie mindern ihn nicht. */
  return (st.umsatz || 0) + (st.dividendeRein || 0) + (st.zinsErtrag || 0)
       - ((st.ausgaben || 0) - (st.investiert || 0)) - abschreibungBisher(p) - (st.zinsAufwand || 0);
}
function steuerSchaetzung(p) {
  const gewinn = steuerBasis(p) - (p.steuerStand ?? 0);
  return { gewinn: Math.round(gewinn),
           steuer: Math.ceil(Math.max(0, gewinn - STEUER_FREI) * satzGewinn()) + Math.round(p.steuerSchuld || 0) };
}
function finanzamtEinnahme(betrag) {
  if (!(betrag > 0)) return;
  G.steuernGesamt += betrag;
  const r = betrag * STEUER_RESERVE_ANTEIL;
  G.wettReserve += r; G.stadtkasse += betrag - r;
  /* Obergrenze: die Bankreserve wächst mit der Wirtschaft, aber nicht ins
   * Uferlose — Überschuss läuft in die Stadtkasse. */
  /* Gesamtvermögen nur einmal je Tick: seit der Börsengebühr läuft das hier
   * bei JEDEM Handel, und netWorth aller Firmen ist nicht billig. */
  if (finanzamtEinnahme.tick !== G.tick) {
    finanzamtEinnahme.tick = G.tick;
    finanzamtEinnahme.gesamt = Object.values(G.players).reduce((a, q) => a + netWorth(q), 0);
  }
  const cap = Math.max(WETT_RESERVE, finanzamtEinnahme.gesamt * RESERVE_MAX_ANTEIL);
  const ueber = bankEigen() - cap;   // ETF-Gelder der Anleger fließen nie in die Stadtkasse
  if (ueber > 0) { G.stadtkasse += ueber; G.wettReserve -= ueber; }
}
function steuernErheben() {
  if (!finanzamtAktiv()) return;
  for (const p of Object.values(G.players)) {
    /* Voll abgeschriebene Posten zusammenfassen, damit die Liste nicht wächst */
    if (p.afa?.length) {
      const fertig = p.afa.filter(a => G.tick - a.t >= MARKT.AFA_DAUER);
      if (fertig.length) { p.afaFertig = (p.afaFertig || 0) + fertig.reduce((x, a) => x + a.b, 0); p.afa = p.afa.filter(a => G.tick - a.t < MARKT.AFA_DAUER); }
    }
    const basis = steuerBasis(p);
    const gewinn = basis - (p.steuerStand ?? 0);
    p.steuerStand = basis;
    const faellig = Math.ceil(Math.max(0, gewinn - STEUER_FREI) * satzGewinn()) + (p.steuerSchuld || 0);
    const zahl = Math.min(faellig, Math.max(0, Math.floor(p.cash)));
    p.cash -= zahl; p.steuerSchuld = faellig - zahl;
    p.stats.steuern = (p.stats.steuern || 0) + zahl;
    finanzamtEinnahme(zahl);
    p.steuerLetzter = { gewinn: Math.round(gewinn), steuer: zahl, schuld: Math.round(p.steuerSchuld), tick: G.tick };
    if (zahl > 0) logTx(p, "Steuer", `Gewinnsteuer (Gewinn ${Math.round(gewinn).toLocaleString("de-DE")} $)`, -zahl);
    if (!p.bot && faellig > 0) emitTo(p.id, "notice", { text: `Steuerbescheid: ${zahl.toLocaleString("de-DE")} $ Gewinnsteuer${p.steuerSchuld > 0 ? ` — ${Math.round(p.steuerSchuld)} $ gestundet` : ""}.` });
  }
}
function steuerVorwarnung() {
  if (!finanzamtAktiv()) return;
  for (const p of Object.values(G.players)) {
    if (p.bot) continue;
    const { steuer } = steuerSchaetzung(p);
    if (steuer > 0) emitTo(p.id, "notice", { text: `Finanzamt: Steuerbescheid in 1 min — voraussichtlich ${steuer.toLocaleString("de-DE")} $. Investitionen senken den Gewinn.` });
  }
}
/* Großauftrag: Prämie aus der Stadtkasse beim Erscheinen reservieren */
function grossauftragPraemie(o) {
  if (!finanzamtAktiv() || G.stadtkasse < 100) return;
  o.praemie = Math.floor(Math.min(PRAEMIE_MAX, stadtFrei() * PRAEMIE_ANTEIL));
  G.stadtkasse -= o.praemie;
}
/* Stadtprojekt: großer Auftrag mit drei Waren, komplett aus der Stadtkasse */
function stadtprojektStarten() {
  const frei = STADTPROJEKTE.filter(sp => !G.stadtprojekteFertig.some(f => f.key === sp.key));
  const art = (frei.length ? frei : STADTPROJEKTE)[Math.floor(Math.random() * (frei.length || STADTPROJEKTE.length))];
  /* Budget: bis 80 % des Geldes über dem Grundstock, aber in einer Größe, die die Runde in zehn
   * Minuten auch liefern kann — skaliert wie die Großaufträge mit der Spielerzahl. */
  const playerScale = Math.max(1, 0.5 + Object.keys(G.players).length * 0.5);
  let budget = Math.floor(Math.min(stadtFrei() * PROJEKT_BUDGET, 7000 * playerScale));
  /* Nur Waren, die es in dieser Runde wirklich gibt: jemand stellt sie her oder
   * hat sie auf Lager. Vorher wurde rein zufällig gewählt — in der Simulation
   * verlangte die Stadt Panzer, obwohl kein einziger existierte; Hanf und Honig
   * kamen komplett, das Projekt scheiterte trotzdem. Keine Billigware (Strom,
   * Wasser …), sonst wären es Tausende Stück. */
  const bestand = g => Object.values(G.players).reduce((a, q) => a + (q.inv[g] || 0), 0);
  const hergestellt = new Set(G.map.filter(t => t.owner && t.btype).map(t => BTYPES[t.btype]?.out).filter(Boolean));
  const teuer = PRODUCTS.filter(g => BASEP[g] >= 6);
  const da = teuer.filter(g => hergestellt.has(g) || bestand(g) >= 5);
  if (!da.length) { G.projektPause = 60; return; }   // noch nichts Brauchbares in der Stadt — in einer Minute wieder schauen
  const goods = da.sort(() => Math.random() - 0.5).slice(0, 3);
  const needs = {};
  for (const g of goods) {
    const pay = Math.round(MM[g].price * GROUP_PAYOUT_MULT * 100) / 100;
    /* Höchstens so viel, wie in zehn Minuten realistisch zusammenkommt: der
     * heutige Bestand plus etwas Nachproduktion — sonst bleibt es unerfüllbar. */
    const machbar = Math.max(5, Math.floor(bestand(g) * 0.6) + (hergestellt.has(g) ? 20 : 0));
    needs[g] = { req: Math.max(5, Math.min(machbar, Math.floor(budget / goods.length / pay))), have: 0, pay };
  }
  /* Nur so viel Budget binden, wie die Bestellung wirklich kostet */
  budget = Math.min(budget, Math.ceil(Object.values(needs).reduce((a, n) => a + n.req * n.pay, 0)));
  G.stadtkasse -= budget;
  G.stadtprojekt = { id: id(), key: art.key, name: art.name, budget, needs, contrib: {}, ttl: PROJEKT_TTL };
  const txt = Object.entries(needs).map(([g, n]) => `${n.req}× ${GOODS[g].name}`).join(", ");
  io.emit("notice", { text: `STADTPROJEKT: Die Stadt baut ein ${art.name}! Gebraucht: ${txt} — Budget ${budget.toLocaleString("de-DE")} $ aus der Stadtkasse, 10 Minuten Zeit.` });
}
function stadtprojektAbrechnen(fertig) {
  const o = G.stadtprojekt;
  let ausgezahlt = 0;
  const lieferanten = [];
  for (const [pid, goods] of Object.entries(o.contrib)) {
    const p = G.players[pid];
    if (!p) continue;
    let sum = 0;
    for (const [g, qty] of Object.entries(goods)) sum += qty * o.needs[g].pay;
    sum = Math.min(sum, o.budget - ausgezahlt);
    if (!(sum > 0)) continue;
    ausgezahlt += sum;
    p.cash += sum; addRevenue(p, sum); gainXp(p, fertig ? 80 : 30); p.stats.projekte = (p.stats.projekte || 0) + 1;
    logTx(p, "Stadtprojekt", `${o.name}: Lieferung bezahlt`, sum);
    lieferanten.push(p.name);
    if (!p.bot) emitTo(pid, "notice", { text: `${o.name}: deine Auszahlung ${Math.round(sum).toLocaleString("de-DE")} $` });
  }
  G.stadtkasse += o.budget - ausgezahlt;   // Rest zurück in die Kasse
  if (fertig) {
    /* Das fertige Projekt steht danach sichtbar in der Stadt */
    const fin = G.map.find(t => t.finanzamt) || G.map.find(t => t.bank);
    const platz = G.map.filter(t => (t.zone === "zentrum" || t.zone === "stadt") && !t.road && !t.water && !t.park && !t.bank
        && !t.news && !t.finanzamt && !t.deko && !t.denkmal && !t.owner && !t.schwarz
        && !G.map.some(o => (o.bank || o.news || o.finanzamt || o.denkmal) && Math.hypot(o.x - t.x, o.y - t.y) < 2.5))
      .sort((a, b) => fin ? Math.hypot(a.x - fin.x, a.y - fin.y) - Math.hypot(b.x - fin.x, b.y - fin.y) : 0)[0];
    if (platz) Object.assign(platz, { denkmal: o.key, denkmalName: o.name, locked: false, field: false });
    G.stadtprojekteFertig.push({ key: o.key, name: o.name, tick: G.tick, lieferanten });
    io.emit("notice", { text: `Das ${o.name} ist fertig! Danke an ${lieferanten.join(", ") || "alle"}.` });
  } else io.emit("notice", { text: `Stadtprojekt ${o.name} nicht rechtzeitig fertig — Lieferungen wurden bezahlt, der Rest geht zurück in die Stadtkasse.` });
  G.stadtprojekt = null; G.projektPause = PROJEKT_PAUSE;
}
function finanzamtTick() {
  if (!finanzamtAktiv()) return;
  if (G.nextDividendIn === 60) steuerVorwarnung();
  if (G.tick % 60 === 0) steuerStufePruefen();
  if (G.stadtprojekt) { if (--G.stadtprojekt.ttl <= 0) stadtprojektAbrechnen(false); }
  else if (--G.projektPause <= 0 && G.stadtkasse >= PROJEKT_SCHWELLE) stadtprojektStarten();
}
function finanzamtPublic() {
  return { aktiv: finanzamtAktiv(), stadtkasse: Math.round(G.stadtkasse), reserve: Math.round(G.wettReserve),
    gesamt: Math.round(G.steuernGesamt), satz: satzGewinn(), frei: STEUER_FREI, wettSteuer: satzWette(),
    boerse: satzBoerse(), boerseBasis: BOERSE_GEBUEHR, stufe: steuerStufe().key, stufeName: steuerStufe().name,
    faktor: steuerFaktor(), lage: Math.round(stadtVermoegen()), stufen: STEUER_STUFEN.map(st => ({ key: st.key, name: st.name, faktor: st.faktor, bis: isFinite(st.bis) ? st.bis : null })),
    boerseGesamt: Math.round(G.boerseGebuehren || 0),
    reserveAnteil: STEUER_RESERVE_ANTEIL, praemieAnteil: PRAEMIE_ANTEIL, praemieMax: PRAEMIE_MAX, schwelle: PROJEKT_SCHWELLE, grundstock: STADT_GRUNDSTOCK,
    naechsterIn: G.nextDividendIn, fertig: G.stadtprojekteFertig,
    portfolio: faPortfolio(), theta: MARKT.THETA, maxAnteil: MARKT.MAX_ANTEIL };
}

/* ---------- Kurswetten (long / short auf Firmenwerte) ----------
 * Geschlossene Wirtschaft: es entsteht kein Geld. Wer verliert, zahlt in den
 * Topf der Gegenseite; die Bank behält 5 % als Gebühr (Geldsenke).
 *  Annahme (2 min): Wetten setzen → Sperre: Firmenwerte werden eingefroren
 *  Laufzeit (5 min) → Abrechnung je Firma:
 *    Verlierer verlieren Einsatz × min(1, |Änderung| × 10)
 *    Gewinner teilen diesen Topf (minus Gebühr) nach Einsatz
 *    Rückzahlung, wenn keine Gegenseite oder |Änderung| < 0,5 %. */
const WETT_ANNAHME = 120, WETT_LAUFZEIT = 300;
const WETT_GEBUEHR = 0.05, WETT_HEBEL = 10, WETT_SCHWELLE = 0.005;
const WETT_MIN = 100, WETT_MAX_ANTEIL = 0.2;
/* Die Bank als Gegenpartei: beim Einfrieren füllt sie die kleinere Seite jeder
 * Firma bis zur Größe der anderen auf — aus einer Reserve, die pro Spielrunde
 * mit 20.000 $ startet und in die alle Gebühren und die Gewinne der Bank
 * fließen. Ist sie leer, nimmt die Bank nicht mehr teil. */
const WETT_RESERVE = 20000, BANK_ID = "__bank";
let wettSeq = 1;

function wettMax(p) { return Math.max(0, Math.floor(Math.min(p.cash, netWorth(p) * WETT_MAX_ANTEIL))); }
function wettVerbot(p, firma) {
  if (!firma) return "Firma existiert nicht";
  if (firma.id === p.id) return "Auf die eigene Firma kannst du nicht wetten";
  if ((firma.equity[p.id] || 0) >= AKTIEN / 2) return "Du hältst 50 % oder mehr an dieser Firma";
  return null;
}
function wetteBuchen(p, firma, richtung, einsatz) {
  const alt = G.wetten.find(w => w.spielerId === p.id && w.firmaId === firma.id);
  if (alt && alt.richtung !== richtung) return "Pro Firma und Runde nur eine Richtung";
  const schon = alt ? alt.einsatz : 0;
  if (einsatz < WETT_MIN && !alt) return `Mindesteinsatz ${WETT_MIN} $`;
  if (schon + einsatz > Math.floor(netWorth(p) * WETT_MAX_ANTEIL) + 0.5) return "Höchstens 20 % deines Nettovermögens je Firma";
  if (p.cash < einsatz) return "Zu wenig Kapital";
  p.cash -= einsatz; p.wettOffen = (p.wettOffen || 0) + einsatz;
  if (alt) alt.einsatz += einsatz;
  else G.wetten.push({ id: wettSeq++, spielerId: p.id, firmaId: firma.id, richtung, einsatz });
  logTx(p, "Wette", `${richtung === "long" ? "Long" : "Short"} auf ${firma.name}`, -einsatz);
  return null;
}
function wettPools(firmaId) {
  let long = 0, short = 0, n = 0;
  for (const w of G.wetten) if (w.firmaId === firmaId) { n++; if (w.richtung === "long") long += w.einsatz; else short += w.einsatz; }
  return { long, short, n };
}
function wettAuszahlen(w, betrag, text) {
  if (w.bank) { G.wettReserve += betrag; return; }
  const p = G.players[w.spielerId];
  if (!p) return;
  p.wettOffen = Math.max(0, (p.wettOffen || 0) - w.einsatz);
  if (betrag > 0.01) { p.cash += betrag; logTx(p, "Wette", text, betrag); }
  (p.wettLog ??= []).unshift({ runde: G.wettrunde.nr, firma: G.players[w.firmaId]?.name ?? "—",
    richtung: w.richtung, einsatz: Math.round(w.einsatz), auszahlung: Math.round(betrag) });
  p.wettLog.length = Math.min(p.wettLog.length, 8);
}
function wettenAbrechnen() {
  const R = G.wettrunde, ergebnisse = [];
  const firmen = [...new Set(G.wetten.map(w => w.firmaId))];
  for (const fid of firmen) {
    const ws = G.wetten.filter(w => w.firmaId === fid);
    const firma = G.players[fid], start = R.start[fid];
    const ende = firma ? companyValue(firma) : null;
    const aend = (start && ende != null) ? (ende - start) / start : 0;
    const pools = wettPools(fid);
    const name = firma?.name ?? "—";
    if (!firma || !start || Math.abs(aend) < WETT_SCHWELLE || !pools.long || !pools.short) {
      for (const w of ws) wettAuszahlen(w, w.einsatz, `Wette auf ${name} zurückerstattet`);
      for (const w of ws) if (!w.bank) emitTo(w.spielerId, "notice", { text: `Kurswette ${name}: ${!pools.long || !pools.short ? "keine Gegenseite" : "kaum Bewegung"} — Einsatz zurück.` });
      ergebnisse.push({ firmaId: fid, name, aenderung: aend, gewinner: null, topf: 0 });
      continue;
    }
    const gew = aend > 0 ? "long" : "short";
    const anteil = Math.min(1, Math.abs(aend) * WETT_HEBEL);
    let topf = 0;
    for (const w of ws) if (w.richtung !== gew) {
      const verlust = w.einsatz * anteil; topf += verlust;
      wettAuszahlen(w, w.einsatz - verlust, `Wette auf ${name} verloren (Rest)`);
      if (!w.bank) emitTo(w.spielerId, "notice", { text: `Kurswette ${name} verloren: −${Math.round(verlust)} $` });
    }
    const netto = topf * (1 - WETT_GEBUEHR);
    G.wettReserve += topf * WETT_GEBUEHR;   // Gebühr bleibt bei der Bank
    const gewPool = gew === "long" ? pools.long : pools.short;
    for (const w of ws) if (w.richtung === gew) {
      let plus = netto * (w.einsatz / gewPool);
      /* Finanzamt: 10 % auf den Reingewinn der Spieler (nicht der Bank) */
      if (!w.bank && finanzamtAktiv()) { const st = plus * satzWette(); plus -= st; finanzamtEinnahme(st);
        const wp = G.players[w.spielerId]; if (wp) wp.stats.steuern = (wp.stats.steuern || 0) + st; }
      wettAuszahlen(w, w.einsatz + plus, `Wette auf ${name} gewonnen`);
      if (!w.bank) emitTo(w.spielerId, "notice", { text: `Kurswette ${name} gewonnen: +${Math.round(plus)} $${finanzamtAktiv() ? " (nach Steuer)" : ""}` });
    }
    ergebnisse.push({ firmaId: fid, name, aenderung: aend, gewinner: gew, topf: Math.round(topf) });
  }
  G.wettLetzte = ergebnisse;
  G.wetten = [];
}
/* Bots sorgen für Gegenseite: kleine Einsätze, Richtung nach jüngstem Trend
 * mit viel Zufall — sie sind Liquidität, keine Orakel. */
function botsWetten() {
  const firmen = Object.values(G.players);
  if (firmen.length < 2) return;
  for (const b of firmen) {
    if (!b.bot || Math.random() > 0.6 || b.cash < 1500) continue;
    const ziel = firmen[Math.floor(Math.random() * firmen.length)];
    if (wettVerbot(b, ziel)) continue;
    const h = G.firmHist[ziel.id] || [];
    const trend = h.length > 3 ? h[h.length - 1] - h[h.length - 4] : 0;
    const richtung = Math.random() < (trend > 0 ? 0.6 : trend < 0 ? 0.4 : 0.5) ? "long" : "short";
    const einsatz = Math.min(Math.round(b.cash * (0.1 + Math.random() * 0.05) / 100) * 100, wettMax(b));
    if (einsatz >= WETT_MIN) wetteBuchen(b, ziel, richtung, einsatz);
  }
}
function bankGegenpartei() {
  for (const fid of [...new Set(G.wetten.map(w => w.firmaId))]) {
    const { long, short } = wettPools(fid);
    /* Pro Firma höchstens ein Viertel der Reserve — sonst bindet eine einzige
     * Runde mit großen Bot-Einsätzen die ganze Bank. */
    const b = Math.min(Math.abs(long - short), Math.floor(Math.max(0, bankEigen()) * 0.25));   // nur eigenes Geld, nicht das der ETF-Anleger
    if (b < WETT_MIN) continue;
    G.wettReserve -= b;
    G.wetten.push({ id: wettSeq++, spielerId: BANK_ID, firmaId: fid, richtung: long > short ? "short" : "long", einsatz: b, bank: true });
  }
}
function wettTick() {
  const R = G.wettrunde;
  if (R.phase === "annahme" && R.rest % 20 === 10) botsWetten();
  if (--R.rest > 0) return;
  if (R.phase === "annahme") {
    R.phase = "laufzeit"; R.rest = WETT_LAUFZEIT;
    R.start = Object.fromEntries(Object.values(G.players).map(p => [p.id, companyValue(p)]));
    bankGegenpartei();
  } else {
    wettenAbrechnen();
    Object.assign(R, { nr: R.nr + 1, phase: "annahme", rest: WETT_ANNAHME, start: {} });
  }
}
function wettrundePublic() {
  const R = G.wettrunde;
  return { nr: R.nr, phase: R.phase, rest: R.rest, dauer: R.phase === "annahme" ? WETT_ANNAHME : WETT_LAUFZEIT,
    gebuehr: WETT_GEBUEHR, hebel: WETT_HEBEL, min: WETT_MIN, reserve: Math.round(G.wettReserve),
    firmen: Object.values(G.players).map(p => {
      const pools = wettPools(p.id);
      const bw = G.wetten.find(w => w.bank && w.firmaId === p.id);
      pools.bank = bw ? { richtung: bw.richtung, einsatz: Math.round(bw.einsatz) } : null;
      return { id: p.id, name: p.name, farbe: p.color, jetzt: Math.round(companyValue(p)),
               start: R.start[p.id] != null ? Math.round(R.start[p.id]) : null, ...pools };
    }),
    letzte: G.wettLetzte };
}

/* ---------- Pfändung & Versteigerung ---------- */
function seizeAndAuction(debtor, bond) {
  const tiles = G.map.filter(t => t.owner === debtor.id && t.btype);
  const target = tiles.find(t => t.lien) || tiles[0];
  if (!target) { // nichts pfändbar → Bond wertlos, Gläubiger geht leer aus
    G.bonds.splice(G.bonds.indexOf(bond), 1);
    io.emit("notice", { text: `${debtor.name} ist zahlungsunfähig — Anleihe ausgefallen.` });
    return;
  }
  const btype = target.btype;
  target.owner = null; target.btype = null; target.lien = false;
  /* Ein gepfändeter Rennstall wird MIT seinen Fahrzeugen versteigert — sie
   * bleiben auf der Kachel liegen und wechseln mit ihr den Besitzer. Der Wert
   * des Inhalts steht am Los, sonst bietet niemand (Mensch wie Bot) auf das,
   * was er nicht sieht, und das Mindestgebot wäre grotesk niedrig. */
  const inhalt = (target.autos || []).reduce((sum, a) => sum + autoWert(a), 0);
  G.auctions.push({ id: id(), tileIdx: G.map.indexOf(target), btype,
    autos: (target.autos || []).length, inhalt: Math.round(inhalt),
    minBid: Math.round(BTYPES[btype].cost * 0.3 + inhalt * 0.3), bestBid: 0, bestBidder: null,
    creditorId: bond.holderId, tLeft: 30 });
  G.bonds.splice(G.bonds.indexOf(bond), 1);
  io.emit("notice", { text: `${BTYPES[btype].name} von ${debtor.name} gepfändet — Versteigerung läuft (30 s)!` });
}

/* ---------- Starter-Aufgaben ---------- */
/* Starter-Aufgaben: bewusst so formuliert, dass JEDE Industrie sie erfüllen kann.
 * "Verkaufe 20 Obst" ging früher nur mit einer Farm — ein Techniker konnte die
 * Aufgabe gar nicht abschließen. Stattdessen zählt jetzt der Umsatz, egal womit
 * er entsteht, und jeder Schritt führt an ein Spielsystem heran: bauen,
 * verkaufen, handeln, freischalten, aufleveln, Anteile kaufen. */
const QUESTS = [
  { id: "build",   text: "Baue dein erstes Produktionsgebäude", en: "Build your first production site",           target: 1,    reward: 800 },
  { id: "shop",    text: "Richte einen Verkaufsslot ein", en: "Set up a sales slot",                 target: 1,    reward: 1000 },
  { id: "order",   text: "Platziere eine Order an der Börse", en: "Place an order on the exchange",             target: 1,    reward: 600 },
  { id: "revenue", text: "Erwirtschafte 3.000 $ Umsatz", en: "Earn $3,000 in revenue",                  target: 3000, reward: 1500 },
  { id: "upgrade", text: "Level ein Gebäude mit Elektronik auf Stufe 2", en: "Upgrade a building to level 2 using electronics",  target: 1,    reward: 1500 },
  { id: "shares",  text: "Kaufe an der Stadtbank Anteile einer Firma", en: "Buy shares in a company at the city bank",    target: 1,    reward: 1800 },
];
/* Im Kartellmodus führen MAFIA-AUFTRÄGE durchs Spiel statt der Börsen-Basics:
 * Sie zeigen dem Spieler genau die Schleife, um die sich der Modus dreht —
 * Familienbetrieb, Hehler, Bezirk, Überfall, Sperre, Schutzgeld. */
const KARTELL_QUESTS = [
  { id: "familiebau", text: "Baue den Betrieb deiner Familie", en: "Build your family's business",            target: 1, reward: 1500 },
  { id: "hehler",     text: "Verkaufe heiße Ware beim Hehler", en: "Sell hot goods to the fence",             target: 1, reward: 1000 },
  { id: "bezirk",     text: "Kontrolliere mit deiner Familie einen Bezirk", en: "Control a district with your family", target: 1, reward: 2000 },
  { id: "ueberfall",  text: "Wage einen Überfall auf einen Werttransport", en: "Attempt a heist on a transport",  target: 1, reward: 800 },
  { id: "sperre",     text: "Errichte eine Straßensperre", en: "Set up a road block",                          target: 1, reward: 800 },
  { id: "schutzgeld", text: "Kassiere Schutzgeld aus einem Bezirk", en: "Collect protection money",            target: 1, reward: 600 },
  { id: "kampf",      text: "Gewinne einen Revierkampf", en: "Win a turf war",                                 target: 1, reward: 1500 },
];
const QUESTSET = () => MODE === "kartell" ? KARTELL_QUESTS : QUESTS;
function questProg(p, id, n = 1) {
  const def = QUESTSET().find(q => q.id === id);
  const q = p.quests[id] ??= { n: 0, done: false };
  if (!def || q.done) return;
  q.n += n;
  if (q.n >= def.target) {
    q.done = true; p.cash += def.reward;
    logTx(p, "Aufgabe", `Aufgabe erfüllt: ${def.text}`, def.reward);
    emitTo(p.id, "notice", { text: `Aufgabe erfüllt: „${def.text}" — +${def.reward} $` });
  }
}

/* ---------- XP & Statistik ---------- */
function gainXp(p, n) {
  p.xp += n;
  while (p.xp >= p.lvl * 100) {
    p.xp -= p.lvl * 100; p.lvl++;
    const bonus = 250 * p.lvl;                       // Level-Belohnung: +$250 × neues Level
    p.cash += bonus;
    logTx(p, "Level", `Level ${p.lvl} erreicht`, bonus);
    emitTo(p.id, "notice", { text: `Level ${p.lvl}! Bonus: +${bonus} $` });
  }
}
/* ---------- Planwirtschaft ---------- */
/* Welche Waren ein Spieler überhaupt herstellen kann — daraus baut das
 * Planbüro sein Soll, damit niemand Unmögliches gefordert bekommt. */
function planGueter(p) {
  const set = new Set();
  for (const bt of Object.values(BTYPES)) {
    if (bt.industry && !(p.industries || [p.industry]).includes(bt.industry)) continue;
    const g = bt.out || bt.proc?.out;
    if (g && GOODS[g]) set.add(g);
  }
  return [...set];
}
/* Bis zu drei Waren je Phase. Die Menge orientiert sich am Grundpreis:
 * billige Massenware in großen Stückzahlen, teure Güter in kleinen —
 * und jede Phase fordert spürbar mehr als die vorige. */
function planSollFuer(p, phase, faktor = 1) {
  const gueter = planGueter(p);
  const anzahl = Math.min(3, gueter.length);
  const start = (phase * 7 + p.name.length) % Math.max(1, gueter.length);
  const soll = [];
  for (let i = 0; i < anzahl; i++) {
    const g = gueter[(start + i) % gueter.length];
    const basis = Math.max(6, Math.min(300, Math.round(500 / (BASEP[g] || 10))));
    soll.push({ good: g, menge: Math.max(4, Math.round(basis * (1 + phase * 0.4) * faktor)), geliefert: 0 });
  }
  return soll;
}
/* Bezugsschein-Budget der Phase: Wer zuletzt gut erfüllt hat, bekommt bei der
 * Materialzuteilung Vorrang — mehr Budget. Wer schlecht lag, weniger. Wer
 * dreimal beim Schwarzhandel erwischt wurde, bekommt eine Phase lang nur die
 * Hälfte (die Sperre wird beim Phasenstart verbraucht). */
function planBudgetFuer(ps) {
  let budget = Math.round(600 + 600 * (ps.prio ?? 1));
  if (ps.sperre) { budget = Math.round(budget / 2); ps.sperre = false; ps.akte = 0; }
  return budget;
}
const SCHWARZ_RISIKO = 0.25;   // Entdeckungswahrscheinlichkeit je Tausch
const AKTE_STRAFE = 40;        // Punktabzug je Eintrag in die Kaderakte
function kaderEintrag(p, ps) {
  ps.akte = (ps.akte || 0) + 1;
  ps.punkte = Math.max(0, ps.punkte - AKTE_STRAFE);
  if (ps.akte >= 3) {
    ps.sperre = true;
    io.emit("notice", { text: `${p.name} wurde zum dritten Mal beim Schwarzhandel erwischt — die nächste Zuteilung wird halbiert.` });
  } else {
    io.emit("notice", { text: `Schwarzhandel aufgeflogen! ${p.name} erhält einen Eintrag in die Kaderakte (−${AKTE_STRAFE} Punkte).` });
  }
  logTx(p, "Plan", `Beim Schwarzhandel erwischt — Kaderakte (${ps.akte}/3)`, 0);
}
/* Volkswirtschaftsziel: EIN gemeinsames Liefersoll je Phase. Wird es
 * verfehlt, gibt es in der Folgephase Stromabschaltungen für ALLE. */
const VOLK_GUETER = ["strom", "wasser", "ziegel", "stahl", "elektronik"];
function planPhaseStarten() {
  G.plan.phase++;
  G.plan.rest = PLAN_DAUER;
  for (const p of Object.values(G.players)) {
    const ps = G.plan.spieler[p.id] ??= { punkte: 0 };
    ps.faktor ??= 1; ps.prio ??= 1;
    ps.soll = planSollFuer(p, G.plan.phase - 1, ps.faktor);
    ps.budget = planBudgetFuer(ps);
  }
  const vg = VOLK_GUETER[(G.plan.phase - 1) % VOLK_GUETER.length];
  const koepfe = Math.max(1, Object.keys(G.players).length);
  G.plan.volk = {
    good: vg,
    menge: Math.round(Math.max(10, Math.min(300, 500 / (BASEP[vg] || 10))) * koepfe * .5 * (1 + (G.plan.phase - 1) * .3)),
    geliefert: 0
  };
  io.emit("notice", { text: `Planphase ${G.plan.phase}/${PLAN_PHASEN}: Neue Plansolls und Bezugsscheine. Volkswirtschaftsziel: ${G.plan.volk.menge}× ${GOODS[vg].name} — sonst drohen Stromabschaltungen.` });
}
function planPhaseAuswerten() {
  for (const [pid, ps] of Object.entries(G.plan.spieler)) {
    const p = G.players[pid];
    if (!p || !ps.soll?.length) continue;
    /* Erfüllungsquote bis 150 %: Übererfüllung zählt — aber siehe Basiseffekt. */
    const quote = ps.soll.reduce((s, z) => s + Math.min(1.5, z.geliefert / z.menge), 0) / ps.soll.length;
    const punkte = Math.round(Math.min(1, quote) * 200 + Math.max(0, quote - 1) * 100);
    ps.punkte += punkte;
    /* Priorität für die Zuteilung der nächsten Phase */
    ps.prio = Math.max(.5, Math.min(1.5, quote));
    /* BASISEFFEKT — das DDR-Dilemma: Wer erfüllt oder gar glänzt, dessen
     * nächstes Soll steigt spürbar; wer deutlich scheitert, bekommt Nachsicht. */
    const alt = ps.faktor ?? 1;
    ps.faktor = Math.max(.7, Math.min(2.5,
      alt * (quote >= 1 ? 1.1 + (quote - 1) * .5 : quote < .6 ? .9 : 1)));
    logTx(p, "Plan", `Planphase ${G.plan.phase}: ${(quote * 100).toFixed(0)} % erfüllt (+${punkte} Punkte)` +
      (ps.faktor > alt ? " — das Soll wird angehoben" : ps.faktor < alt ? " — das Soll wird gesenkt" : ""), 0);
  }
  /* Volkswirtschaftsziel auswerten: gemeinsam geschafft = Bonus für alle,
   * verfehlt = Stromabschaltungen in der ganzen nächsten Phase. */
  const volk = G.plan.volk;
  if (volk) {
    if (volk.geliefert >= volk.menge) {
      G.plan.stromsperre = false;
      for (const ps of Object.values(G.plan.spieler)) ps.punkte += 25;
      io.emit("notice", { text: `Volkswirtschaftsziel erreicht (${Math.round(volk.geliefert)}× ${GOODS[volk.good].name}) — +25 Punkte für alle Betriebe!` });
    } else {
      G.plan.stromsperre = true;
      io.emit("notice", { text: `Volkswirtschaftsziel verfehlt (${Math.round(volk.geliefert)}/${volk.menge}× ${GOODS[volk.good].name}) — STROMABSCHALTUNG: Alle Betriebe laufen nächste Phase nur mit halber Kraft.` });
    }
  }
  io.emit("notice", { text: `Planphase ${G.plan.phase} abgeschlossen — Punkte vergeben, die Solls werden angepasst (Basiseffekt).` });
}

/* ---------- Kartellmodus ----------
 * Das Gegenstück zur Planwirtschaft: Nicht der Staat lenkt den Markt, sondern
 * die Firmen tun es unter sich. Mehrere Spieler schließen sich zu einem Kartell
 * zusammen, sprechen Preise ab und teilen den Markt auf — solange das
 * Kartellamt ihnen nichts nachweisen kann.
 *
 * Diese erste Stufe legt nur das Fundament: gründen, einladen, beitreten,
 * verlassen. Preisabsprache, Verdacht/Ermittlung und Kronzeugenregelung setzen
 * darauf auf.
 *
 * Bewusste Entscheidungen:
 * - MEHRERE Kartelle je Runde. Ein einziges wäre entweder eine
 *   Zwangsgemeinschaft aller oder ein Zweiklassenspiel; konkurrierende Kartelle
 *   halten den Markt in Bewegung.
 * - Der Verdachtswert geht NUR an Mitglieder (privateState, nicht snapshot).
 *   Von außen sieht man, DASS es ein Kartell gibt, aber nicht, wie dicht das
 *   Kartellamt ihm schon auf den Fersen ist — sonst wüsste jeder Außenstehende
 *   genau, wann sich das Zuschlagen lohnt.
 * - Die Mitgliedschaft steht AUSSCHLIESSLICH im Kartell (k.mitglieder), nicht
 *   zusätzlich am Spieler. Zwei Listen, die dasselbe wissen müssten, laufen
 *   früher oder später auseinander — bei Austritt, Auflösung oder wenn ein
 *   Spieler endgültig aus der Sitzung fliegt. */
const KARTELL_MAX = 4;          // Mitglieder je Kartell — sind alle drin, richtet es sich gegen niemanden
const KARTELL_NAME_MAX = 28;

const kartellVon = p => G.cartels.find(k => k.mitglieder.includes(p.id)) || null;
const kartellFinden = kid => G.cartels.find(k => k.id === kid) || null;

/* Ein Kartell ohne Mitglieder ist eine Karteileiche — es hielte sonst seinen
 * Namen und (später) seine Absprachen bis zum Rundenende besetzt. */
function kartellAufloesen(k, grund) {
  const i = G.cartels.indexOf(k);
  if (i >= 0) G.cartels.splice(i, 1);
  if (grund) io.emit("notice", { text: `Kartell „${k.name}“ ${grund}.` });
}

/* Austritt an EINER Stelle, damit jeder Weg hinaus dieselbe Aufräumarbeit
 * macht: freiwillig, oder weil jemand endgültig aus der Sitzung geflogen ist.
 * Verlässt der Kopf das Kartell, rückt das dienstälteste verbliebene Mitglied
 * nach — sonst hinge das Kartell führungslos fest, genau wie früher der
 * Warteraum, wenn der Host ging. */
function kartellVerlassen(p) {
  const k = kartellVon(p);
  if (!k) return null;
  k.mitglieder = k.mitglieder.filter(mid => mid !== p.id);
  if (!k.mitglieder.length) { kartellAufloesen(k, "hat sich aufgelöst"); return k; }
  if (k.kopfId === p.id) {
    k.kopfId = k.mitglieder[0];
    io.emit("notice", { text: `${G.players[k.kopfId]?.name ?? "—"} führt jetzt das Kartell „${k.name}“.` });
  }
  return k;
}

/* Öffentliche Sicht: Name, Kopf und Mitglieder eines Kartells sind bekannt —
 * ein Kartell, von dem niemand weiß, könnte man auch nicht bekämpfen. Was NICHT
 * hier steht: der Verdachtswert und die internen Absprachen. */
const kartellPublic = k => ({
  id: k.id, name: k.name, kopfId: k.kopfId,
  /* Eine laufende Ermittlung ist oeffentlich — genau das ist der Preis des
   * Auffliegens: Die Konkurrenz kann sich darauf einstellen. Der Verdachtswert
   * davor bleibt privat. */
  ermittlung: k.ermittlung ? { rest: k.ermittlung.rest } : null,
  mitglieder: k.mitglieder.map(mid => ({ id: mid, name: G.players[mid]?.name ?? "—" })),
  gegruendet: k.gegruendet,
});

/* ---------- Preisabsprache ----------
 * Der Kern des Modus: Das Kartell legt Mindestpreise fest, unter denen kein
 * Mitglied verkaufen darf. Der Gewinn entsteht nicht durch eine Prämie vom
 * Server, sondern dadurch, dass mehrere Anbieter gleichzeitig aufhören, sich
 * gegenseitig zu unterbieten — genau wie im Echten.
 *
 * Die Absprache gilt für JEDEN Weg, auf dem Ware gegen Geld das Lager verlässt:
 * Börsenorder, Direktvertrag und Ladenpreis. Bliebe auch nur einer davon offen,
 * wäre die Absprache in zehn Sekunden umgangen — und zwar von dem Mitglied, das
 * als Erstes darauf kommt. Der Laden zählt ausdrücklich mit: Wer dort billig
 * abgibt, verkauft zwar an die Stadt, drückt über noteSold aber den
 * Durchschnittspreis, an dem die Absprache der anderen hängt.
 *
 * Geprüft wird ausschließlich die VERKAUFSseite. Ein Nachfragekartell, das
 * Höchsteinkaufspreise durchsetzt, wäre ein eigenes System mit eigener
 * Verdachtslogik — nicht dieselbe Regel mit umgedrehtem Vergleich. */
const kartellMindestpreis = (p, good) => {
  const k = MODE === "kartell" ? kartellVon(p) : null;
  return k?.minPreise?.[good] ?? null;
};
/* Gibt den Ablehnungstext zurück, sonst null. Text statt Boolean, damit an
 * jeder der vier Aufrufstellen dieselbe Begründung ankommt. */
function kartellPreisVerstoss(p, good, preis) {
  const min = kartellMindestpreis(p, good);
  if (min == null || preis >= min) return null;
  return `Kartellabsprache: ${GOODS[good].name} nicht unter ${min} $ verkaufen`;
}
/* Eine neue Absprache zieht laufende Ladenpreise mit hoch. Ohne das könnte man
 * erst billige Verkaufsslots einrichten und danach dem Kartell beitreten — die
 * Absprache bände dann nur noch künftige Entscheidungen und wäre wertlos. */
function kartellLaedenAngleichen(k, good, min) {
  let angehoben = 0;
  for (const t of G.map) {
    if (!t.btype || !k.mitglieder.includes(t.owner) || !t.shop) continue;
    for (const slot of t.shop) {
      if (slot?.good === good && slot.price < min) { slot.price = min; angehoben++; }
    }
  }
  return angehoben;
}


/* ---------- Das Kartellamt ----------
 * Der Gegenspieler des Modus. Entscheidend ist, WORAUS der Verdacht entsteht:
 * nicht daraus, DASS ein Kartell besteht — das ist oeffentlich und fuer sich
 * genommen harmlos —, sondern daraus, dass die Absprache am Markt sichtbar
 * wirkt. Sonst waere der Verdacht nur ein Zeitgeber, der einen dafuer bestraft,
 * die Spielmechanik ueberhaupt zu benutzen.
 *
 * Das Amt sieht genau das, was jeder sieht: Abschlusspreise, das Orderbuch und
 * die Ladenpreise auf der Karte. Daraus liest es zwei Dinge:
 *
 * 1. GLEICHFOERMIGKEIT — verkaufen mehrere Mitglieder dieselbe Ware zum selben
 *    Preis, ist das das klassische Kartellzeichen. Ein einzelnes Mitglied, das
 *    teuer verkauft, ist ein teurer Anbieter; drei, die auf den Cent genau
 *    gleich anbieten, sind eine Absprache.
 * 2. HEBUNG — wie weit der abgesprochene Preis ueber dem liegt, was die Ware
 *    sonst kostet. Ein Mindestpreis UNTER dem Marktpreis faellt niemandem auf,
 *    weil er nichts veraendert: Er kostet nichts und bringt nichts.
 *
 * Daraus folgt das Spiel: Eine Absprache knapp ueber Marktpreis bleibt lange
 * unentdeckt und traegt wenig; eine, die den Preis verdoppelt, traegt sofort
 * viel und fliegt schnell auf. Der Verdacht faellt wieder, sobald die Absprache
 * aufgehoben ist — Stillhalten ist ein gangbarer Zug. */
/* Ueberschreibbar wie die uebrigen Stellschrauben des Spiels (RENN_INTERVALL,
 * GROUP_VALUE, START_CASH): Wie schnell ein Kartell auffliegen soll, laesst
 * sich nur am laufenden Spiel herausfinden, nicht am Schreibtisch. */
const VERDACHT_TEMPO = +process.env.VERDACHT_TEMPO || 0.55;   // Punkte/s bei voller Auffaelligkeit
const VERDACHT_ABBAU = +process.env.VERDACHT_ABBAU || 0.35;   // Punkte/s ohne wirksame Absprache
const ERMITTLUNG_DAUER = +process.env.ERMITTLUNG_DAUER || 90; // Sekunden bis zum Bescheid
const BUSSGELD_ANTEIL = +process.env.BUSSGELD_ANTEIL || 0.55; // Anteil des Umsatzes unter Absprache
/* Wird das Kartell angezeigt, zahlen die uebrigen mehr. Die Anzeige bringt dem
 * Amt den Beweis frei Haus — und ohne Aufschlag waere sie fuer die anderen
 * folgenlos, der Verrat also ohne Gewicht. */
const BUSSGELD_KRONZEUGE = +process.env.BUSSGELD_KRONZEUGE || 0.85;

/* Umsatz, der unter einer laufenden Absprache entstanden ist. Das Bussgeld
 * haengt daran und nicht am Vermoegen: Bestraft wird, was die Absprache
 * eingebracht hat, nicht wer ohnehin gross ist. Wer eine Absprache beschliesst
 * und dann nichts verkauft, zahlt fast nichts — zu Recht. */
function kartellUmsatzMerken(p, good, betrag) {
  if (MODE !== "kartell" || !(betrag > 0)) return;
  const k = kartellVon(p);
  if (!k || k.minPreise[good] == null) return;
  k.umsatz[p.id] = (k.umsatz[p.id] || 0) + betrag;
}

/* Wie auffaellig ist die Ware gerade? 0 = niemand merkt etwas, 1 = das Amt
 * muesste blind sein. */
function kartellAuffaelligkeit(k, good, min) {
  const markt = MM[good]?.price || BASEP[good] || min;
  /* Hebung: erst ab einem Fuenftel ueber Marktpreis faellt es ins Gewicht,
   * voll ausgereizt beim Doppelten. Darunter ist die Absprache Kosmetik. */
  const hebung = Math.max(0, Math.min(1, (min / markt - 1.2) / 0.8));
  if (hebung <= 0) return 0;
  /* Gleichfoermigkeit: Wie viele Mitglieder bieten diese Ware sichtbar zum
   * abgesprochenen Preis an — im Orderbuch oder im eigenen Laden? Bei einem
   * allein gibt es nichts zu vergleichen, ab zwei wird es ein Muster. */
  const bietetAn = mid => {
    if (G.orders.some(o => o.playerId === mid && o.side === "sell" && o.good === good && o.price <= min * 1.02)) return true;
    return G.map.some(t => t.owner === mid && t.shop?.some(sl => sl?.good === good && sl.price <= min * 1.02));
  };
  const zahl = k.mitglieder.filter(bietetAn).length;
  if (zahl < 2) return 0;
  const gleich = Math.min(1, (zahl - 1) / 3);   // 2 Mitglieder = 0,33 … 4 = 1
  return hebung * gleich;
}

function kartellamtTick() {
  if (MODE !== "kartell") return;
  for (const k of [...G.cartels]) {
    if (k.ermittlung) {
      k.ermittlung.rest--;
      if (k.ermittlung.rest <= 0) kartellBescheid(k);
      continue;
    }
    /* Die auffaelligste Ware zaehlt, nicht die Summe: Zehn harmlose Absprachen
     * sind kein Kartell, eine dreiste schon. */
    let spitze = 0;
    for (const [good, min] of Object.entries(k.minPreise))
      spitze = Math.max(spitze, kartellAuffaelligkeit(k, good, min));
    k.verdacht = Math.max(0, Math.min(100,
      k.verdacht + (spitze > 0 ? spitze * VERDACHT_TEMPO : -VERDACHT_ABBAU)));

    if (k.verdacht >= 100) kartellErmittlungStarten(k);
    else if (k.verdacht >= 60 && !k.gewarnt) {
      /* Eine Warnung, damit die Entscheidung eine ist: weitermachen und mehr
       * verdienen, oder aufhoeren und behalten, was man hat. Ohne sie stuende
       * die Ermittlung ohne Vorwarnung im Raum. */
      k.gewarnt = true;
      for (const mid of k.mitglieder)
        emitTo(mid, "notice", { text: `Das Kartellamt stellt Fragen zu „${k.name}“. Noch ist nichts bewiesen.` });
    } else if (k.verdacht < 40) k.gewarnt = false;
  }
}

function kartellErmittlungStarten(k) {
  k.ermittlung = { rest: ERMITTLUNG_DAUER };
  k.verdacht = 100;
  /* Oeffentlich: Ab hier weiss der ganze Markt Bescheid. Das ist der Preis des
   * Auffliegens — die Konkurrenz kann sich darauf einstellen, bevor der
   * Bescheid da ist. */
  /* Nicht ERMITTLUNG_DAUER/60: Bei den voreingestellten 90 Sekunden stuende da
   * "1.5 Minuten". Sekunden unter zwei Minuten, darueber gerundete Minuten. */
  const frist = ERMITTLUNG_DAUER < 120
    ? `${ERMITTLUNG_DAUER} Sekunden`
    : `${Math.round(ERMITTLUNG_DAUER / 60)} Minuten`;
  io.emit("notice", { text: `KARTELLAMT: Ermittlungen gegen „${k.name}“ eröffnet — Bescheid in ${frist}.` });
}

/* kronzeugeId gesetzt = das Kartell wurde von innen angezeigt. Der Kronzeuge
 * zahlt nichts und behaelt, was er unter der Absprache verdient hat; die
 * uebrigen zahlen den hoeheren Satz. */
function kartellBescheid(k, kronzeugeId = null) {
  const zeilen = [];
  const satz = kronzeugeId ? BUSSGELD_KRONZEUGE : BUSSGELD_ANTEIL;
  for (const mid of k.mitglieder) {
    const p = G.players[mid];
    if (!p) continue;
    if (mid === kronzeugeId) {
      logTx(p, "Kartellamt", `Kronzeuge: straffrei („${k.name}“)`, 0);
      zeilen.push(`${p.name}: straffrei`);
      continue;
    }
    const umsatz = k.umsatz[mid] || 0;
    /* Gedeckelt am Bargeld: Ein Bussgeld, das die Firma ins Minus reisst,
     * beendet die Runde fuer den Betroffenen — bestraft werden soll der
     * Gewinn aus der Absprache, nicht die Teilnahme am Spiel. */
    const busse = Math.min(Math.round(umsatz * satz), Math.max(0, Math.round(p.cash)));
    if (busse > 0) {
      p.cash -= busse;
      logTx(p, "Kartellamt", `Bußgeld wegen Preisabsprache („${k.name}“)`, -busse);
    }
    emitTo(mid, "notice", { text: busse > 0
      ? `Bußgeld: ${busse.toLocaleString("de-DE")} $ — die Absprachen von „${k.name}“ sind aufgehoben.`
      : `Verfahren gegen „${k.name}“ eingestellt — unter der Absprache wurde nichts verdient.` });
    zeilen.push(`${p.name}: ${busse.toLocaleString("de-DE")} $`);
  }
  const wer = kronzeugeId ? G.players[kronzeugeId]?.name ?? "Ein Mitglied" : null;
  io.emit("notice", { text: wer
    /* Der Name des Kronzeugen ist oeffentlich. Ein Verrat, den niemand
     * bemerkt, waere folgenlos — und der Modus lebt davon, dass man weiss,
     * wem man beim naechsten Mal nicht mehr schreibt. */
    ? `KARTELLAMT: „${k.name}“ wurde von ${wer} angezeigt — ${zeilen.join(", ")}.`
    : `KARTELLAMT: Bescheid gegen „${k.name}“ — ${zeilen.join(", ") || "keine Bußgelder"}.` });
  /* Die Absprachen fallen, das Kartell bleibt. Es aufzuloesen waere die
   * haertere Strafe, naehme dem Modus aber seinen zweiten Akt: Wer einmal
   * erwischt wurde, soll es wieder versuchen duerfen — vorsichtiger diesmal. */
  k.minPreise = {}; k.umsatz = {}; k.ermittlung = null; k.gewarnt = false;
  /* Nicht auf null: Wer einmal aufgefallen ist, steht weiter unter Beobachtung
   * und hat beim naechsten Mal weniger Anlauf. */
  k.verdacht = 35;
}

function logTx(p, cat, text, amt) {
  p.tx.unshift({ t: G.tick, cat, text, amt: Math.round(amt * 100) / 100 });
  if (p.tx.length > 60) p.tx.pop();
}
function salesRec(p, good) {
  return p.sales[good] ??= { botQty: 0, botRev: 0, playerQty: 0, playerRev: 0, buyQty: 0, buyCost: 0 };
}

/* ---------- Snapshot für Clients ---------- */
function snapshot() {
  // Rangliste nach Nettovermögen
  const ranked = Object.values(G.players).map(p => [p.id, netWorth(p)]).sort((a, b) => b[1] - a[1]);
  const rankOf = Object.fromEntries(ranked.map(([pid], i) => [pid, i + 1]));
  return {
    tick: G.tick, winner: G.winner, winGoal: WIN_NW, report: G.report || null,
    etf: etfPublic(),
    software: softwarePublic(), swModule: SW_MODULE, swBaeume: SW_BAEUME, swStufe: SW_STUFE, swAusbau: [0, 1, 2, 3].map(swAusbau), paint: paintPublic(), paintCfg: { stufen: PAINT.STUFEN, abSystem: PAINT.AB_SYSTEM, preisMin: PAINT.PREIS_MIN, preisMax: PAINT.PREIS_MAX, palette: PAINT.PALETTE },
    logoV: Object.fromEntries(Object.values(G.players).filter(p => p.logo).map(p => [p.id, p.logo.v])), swDesign: SW_DESIGN, swDesignAb: SW_DESIGN_AB, swCfg: { install: SW.INSTALL, portalInstall: SW.PORTAL_INSTALL, versionEp: SW.VERSION_EP, werbeBoost: SW.WERBE_BOOST, gebMin: SW.GEB_MIN, gebMax: SW.GEB_MAX, einrMax: SW.EINR_MAX, aboMin: SW.ABO_MIN, aboMax: SW.ABO_MAX, handelssteuer: Math.round(satzBoerse() * SW.HANDELSSTEUER * 1000) / 10, markenwert: SW.MARKENWERT },
    marktLog: (G.marktLog || []).slice(0, 20), marktCfg: { aktien: AKTIEN, tag: MARKT.TAG, beta: MARKT.BETA, bauDauer: MARKT.BAU_DAUER, afaDauer: MARKT.AFA_DAUER },
    /* Countdown bis zum naechsten Renntag — ohne ihn sieht man erst bei der
     * Ankuendigung, dass etwas ansteht, und kann nichts vorbereiten. */
    /* Im Kartellmodus zählt der Countdown gar nicht mehr herunter — ihn trotzdem
     * zu senden hieße, eine eingefrorene Uhr anzuzeigen. */
    naechstesRennen: (G.rennen || MODE === "kartell") ? null : G.naechstesRennenIn,
    wm: MODE === "renntag" ? G.wm : null,
    saison: MODE === "renntag" ? { gefahren: G.saisonRennen, gesamt: SAISON_RENNEN } : null,
    tutorialEnde: !!G.tutorialEnde,
    winGrund: G.winGrund || null,
    /* Immer mitschicken: Die Aufgaben hängen am Modus, und der kann sich nach
     * der Registrierung noch ändern (Lobby-Wahl) — die Liste aus dem
     * Register-Ack wäre dann veraltet. */
    questDefs: QUESTSET(),
    started: G.started, hostId: G.hostId,
    mode: MODE, plan: MODE === "plan" ? G.plan : null,
    /* Wer mit wem gemeinsame Sache macht, ist öffentlich; wie heiß es dem
     * Kartell unter den Füßen wird, erfahren nur seine Mitglieder (privateState). */
    cartels: MODE === "kartell" ? G.cartels.map(kartellPublic) : null,
    bezirke: MODE === "kartell" ? G.bezirke : null,
    transporte: MODE === "kartell" ? G.transporte.map(tr => {
      const { x, y } = transportKachel(tr);
      return { id: tr.id, art: tr.art,
        x: tr.achse === "x" ? tr.pos : tr.linie, y: tr.achse === "x" ? tr.linie : tr.pos,
        kx: x, ky: y, gestoppt: !!tr.gestoppt };
    }) : null,
    pate: MODE === "kartell" ? G.pate : null,
    pateWahl: MODE === "kartell" ? { phase: G.pateWahl.phase,
      rest: Math.max(0, G.pateWahl.endet - G.tick),
      naechsteIn: Math.max(0, (G.pateWahl.naechste || 0) - G.tick),
      kandidaten: G.pateWahl.kandidaten, stimmen: G.pateWahl.stimmen,
      stich: G.pateWahl.stich, dekrete: PATE_DEKRETE } : null,
    pateDekret: MODE === "kartell" ? G.pateDekret : null,
    pateName: MODE === "kartell" ? G.pateName : null,
    gcasino: MODE === "kartell" ? { stufe: G.gcasino.stufe, stil: GCASINO_STILE[G.gcasino.stufe - 1],
      quote: G.gcasino.quote, herrscher: gcasinoHerrscher(),
      spiele: Object.fromEntries(Object.entries(GCASINO_SPIELE).map(([k, sp]) => {
        const q = GCASINO_QUOTEN[G.gcasino.quote];
        return [k, { name: sp.name, chance: Math.max(.005, sp.chance + (sp.chance > .1 ? q.chanceDelta : q.chanceDelta / 10)), faktor: sp.faktor }];
      })),
      upgradeKosten: G.gcasino.stufe < 5 ? 4000 * G.gcasino.stufe : null } : null,
    groulette: MODE === "kartell" ? { phase: G.groulette.phase,
      rest: Math.max(0, G.groulette.endet - G.tick),
      zahl: G.groulette.phase === "drehen" ? G.groulette.zahl : null,
      letzteZahl: G.groulette.letzteZahl, letzteGewinner: G.groulette.letzteGewinner || [],
      einsaetze: G.groulette.einsaetze.map(e => ({ name: e.name, farbe: e.farbe, art: e.art, zahl: e.zahl, einsatz: e.einsatz })) } : null,
    gblackjack: MODE === "kartell" ? { phase: G.gblackjack.phase,
      rest: Math.max(0, G.gblackjack.endet - G.tick), dran: G.gblackjack.dran,
      dealer: G.gblackjack.dealer.map(k => ({ txt: k.txt, rot: k.rot })),
      dealerSumme: G.gblackjack.dealer.length ? bjSumme(G.gblackjack.dealer) : null,
      spieler: G.gblackjack.spieler.map(s => ({ pid: s.pid, name: s.name, farbe: s.farbe,
        einsatz: s.einsatz, einsatz2: s.einsatz2, aktiv: s.aktiv,
        karten: s.karten.map(kartePub), summe: bjSumme(s.karten),
        karten2: s.karten2 ? s.karten2.map(kartePub) : null, summe2: s.karten2 ? bjSumme(s.karten2) : null,
        fertig: s.fertig, ergebnis: s.ergebnis })) } : null,
    wzInfo: MODE === "kartell" ? { brunnenPot: G.brunnenPot,
      herren: Object.fromEntries(Object.entries(WZ_DEF).map(([k, d]) => [k, wzHerr(d.bezirk)])) } : null,
    gpoker: MODE === "kartell" ? { phase: G.gpoker.phase, rest: Math.max(0, G.gpoker.endet - G.tick),
      einsatz: G.gpoker.einsatz, pot: G.gpoker.pot, aktBet: G.gpoker.aktBet, raises: G.gpoker.raises,
      strasse: G.gpoker.strasse, dran: G.gpoker.dran, board: G.gpoker.board.map(kartePub),
      spieler: G.gpoker.spieler.map(s => ({ pid: s.pid, name: s.name, farbe: s.farbe,
        gefoldet: s.gefoldet, gesetzt: s.gesetzt, ergebnis: s.ergebnis,
        karten: G.gpoker.phase === "vorbei" && !s.gefoldet ? s.karten.map(kartePub) : null })) } : null,
    polizei: MODE === "kartell" ? { punkte: G.polizeiPunkte || 0, ziel: POLIZEI_ZIEL,
      farbe: POLIZEI.farbe,
      mitglieder: Object.values(G.players).filter(p2 => p2.familie === "polizei").map(p2 => p2.name) } : null,
    familien: MODE === "kartell" ? Object.entries(FAMILIEN).map(([fid, f]) => ({
      id: fid, name: f.name, farbe: f.farbe, produkt: f.produkt, gebaeude: f.gebaeude,
      respekt: Math.round(G.familienRespekt[fid] || 0),
      fahndung: Math.round(G.fahndung[fid] || 0),
      mitglieder: Object.values(G.players).filter(p2 => p2.familie === fid).map(p2 => p2.name),
      kasse: Math.round(G.familienBank[fid] || 0),
      tribut: G.familienTribut[fid] ?? .10,
      soldaten: G.soldaten[fid] || 0,
      bossPid: famBoss(fid),
      wahlSiege: G.wahlSiege[fid] || 0,
      kampfSiege: G.kampfSiege[fid] || 0,
      raenge: Object.values(G.players).filter(p2 => p2.familie === fid)
        .map(p2 => ({ pid: p2.id, name: p2.name, bot: !!p2.bot, rang: famRang(p2) })),
    })) : null,
    hof: HOF,
    routes: MAP_ROUTES,
    lobby: G.started ? null : { winGoal: WIN_NW, bots: botAuswahl, botLevel: botLevelKey, mode: MODE, saison: SAISON_RENNEN, saisonWahl: SAISON_CHOICES },
    map: G.map.map(t => ({ x: t.x, y: t.y, zone: t.zone, road: t.road, water: t.water,
      park: t.park, field: t.field, sand: t.sand, deep: t.deep, rock: t.rock,
      piazza: t.piazza, fontana: t.fontana, pier: t.pier, leuchtturm: t.leuchtturm, questura: t.questura, gcasino: t.gcasino, wz: t.wz, famhaus: t.famhaus,
      bank: t.bank, news: t.news, finanzamt: t.finanzamt, denkmal: t.denkmal, denkmalName: t.denkmalName, schwarz: t.schwarz, deko: t.deko, locked: t.locked, unlockCost: t.unlockCost, owner: t.owner, btype: t.btype, lien: t.lien, shop: t.shop, paused: t.paused, level: t.level, autos: autosDyn(t), sperre: t.sperre ?? null, bauBis: imBau(t) ? t.bauBis : null })),
    players: Object.fromEntries(Object.entries(G.players).map(([sid, p]) =>
      [sid, { id: sid, name: p.name, color: p.color, lvl: p.lvl, xp: p.xp, industry: p.industry, industries: p.industries,
              familie: p.familie || null,
              netWorth: Math.round(netWorth(p)), rating: rating(p), rank: rankOf[sid],
              /* Kennzahlen für den Aktienhandel an der Bank */
              marketValue: Math.round(companyValue(p)), rev10: Math.round(rev10(p)), ...marktPublic(p),
              buchwert: Math.round(substance(p)), aktien: AKTIEN, ausschuettung: p.ausschuettung ?? null,
              ownPct: Math.round((p.equity[sid] || 0) / AKTIEN * 1000) / 10,
              equity: Object.fromEntries(Object.entries(p.equity).filter(([, c]) => c > 0)
                .map(([hid, c]) => [istInstitution(hid) ? institutionName(hid) : (G.players[hid]?.name ?? "—"), Math.round(c / AKTIEN * 1000) / 10])) }])),
    orders: G.orders,
    bonds: G.bonds.map(b => ({ ...b, issuer: G.players[b.issuerId]?.name ?? "—",
      holder: b.holderId ? (G.players[b.holderId]?.name ?? "—") : null,
      issuerRating: G.players[b.issuerId] ? rating(G.players[b.issuerId]) : "D" })),
    shareBids: G.shareBids.map(b => ({ ...b,
      company: G.players[b.companyId]?.name ?? "—",
      bidder: istInstitution(b.bidderId) ? institutionName(b.bidderId) : (G.players[b.bidderId]?.name ?? "—") })),
    shareListings: G.shareListings.map(l => ({ ...l,
      sellerId: l.sellerId ?? l.companyId,
      company: G.players[l.companyId]?.name ?? "—",
      seller: istInstitution(l.sellerId) ? institutionName(l.sellerId) : (G.players[l.sellerId ?? l.companyId]?.name ?? "—"),
      isIssue: (l.sellerId ?? l.companyId) === l.companyId,   // Emission der Firma statt Weiterverkauf
      toName: l.toId ? (G.players[l.toId]?.name ?? "—") : null })),
    nextDividendIn: G.nextDividendIn,
    wettrunde: wettrundePublic(),
    finanzamt: finanzamtPublic(),
    stadtprojekt: G.stadtprojekt ? { id: G.stadtprojekt.id, name: G.stadtprojekt.name, key: G.stadtprojekt.key,
      budget: G.stadtprojekt.budget, ttl: G.stadtprojekt.ttl, needs: G.stadtprojekt.needs,
      contrib: Object.fromEntries(Object.entries(G.stadtprojekt.contrib).map(([pid, goods]) =>
        [pid, { name: G.players[pid]?.name ?? "—", color: G.players[pid]?.color, bot: !!G.players[pid]?.bot, goods }])) } : null,
    auctions: G.auctions,
    fahrer: G.fahrer,
    rennen: G.rennen ? (() => {
      const { pool, quoten } = rennQuoten(G.rennen);
      return {
        phase: G.rennen.phase, rest: G.rennen.rest, pool, quoten, runde: RENN_RUNDE,
        pools: rennQuoten(G.rennen).pools, ticker: G.rennen.ticker || [],
        nenngeld: RENN_NENNGELD,
        /* Nur gemeldete Spielerwagen zahlen Nenngeld — die Vorschau muss
         * dieselbe Rechnung benutzen wie rennBeenden, sonst verspricht sie
         * einen Topf, den es nicht gibt. */
        topf: G.rennen.topf ?? (RENN_GRUNDPREIS
          + G.rennen.teilnehmer.filter(t2 => !t2.bot).length * RENN_NENNGELD * 2
          + Math.round(pool * WETT_RAKE)),
        teilnehmer: G.rennen.teilnehmer.map(t2 => ({ autoId: t2.autoId, name: t2.name, team: t2.team,
          farbe: t2.livree || t2.farbe, fahrer: t2.fahrer, ownerId: t2.ownerId, bot: !!t2.bot,
          letztes: t2.letztes || null,
          boxe: !!t2.boxe, frisch: t2.frisch || 0, stopps: t2.stopps || 0,
          dist: Math.round(t2.dist), ausgefallen: t2.ausgefallen })),
        sponsoren: G.rennen.sponsoren.map(s => ({ name: s.name, team: G.players[s.teamId]?.name, betrag: s.betrag, was: s.was })),
        gesuche: (G.rennen.gesuche || []).map(g => ({ ...g })),
        ergebnis: G.rennen.ergebnis || null,
      };
    })() : null,
    lastTrade: G.lastTrade,
    news: G.news,
    avg: Object.fromEntries(Object.keys(GOODS).map(k => [k, MM[k].price])),
    groupOrder: G.groupOrder ? { id: G.groupOrder.id, city: G.groupOrder.city, ttl: G.groupOrder.ttl,
      needs: G.groupOrder.needs,
      contrib: Object.fromEntries(Object.entries(G.groupOrder.contrib).map(([pid, goods]) =>
        [G.players[pid]?.name ?? "—", goods])) } : null,
    contracts: G.contracts.filter(c => c.status === "open"),
  };
}
function privateState(p) {
  /* Vermögensaufstellung wie im Dashboard: Bargeld, Inventar, Gebäude, Anleihen, Schulden */
  let invVal = 0; for (const k in p.inv) invVal += p.inv[k] * MM[k].price;
  /* Fahrzeuge im Rennstall gehören zum Gebäudewert. Sie sind aus `inv`
   * verschwunden und tauchen sonst in der eigenen Bilanz nirgends mehr auf —
   * der Spieler säehe sein Vermögen beim Einzug schrumpfen, obwohl sich nichts
   * geändert hat. Dieselbe Rechnung wie in buildingValueOf(). */
  let bldVal = 0;
  for (const t of G.map) if (t.owner === p.id && t.btype) {
    bldVal += anlageWert(t);
    if (t.autos) for (const a of t.autos) bldVal += autoWert(a);
  }
  let bondVal = 0, debtVal = 0;
  for (const b of G.bonds) {
    if (b.holderId === p.id) bondVal += b.principal;
    if (b.issuerId === p.id && b.holderId) debtVal += b.principal;
  }
  /* Depot: was man an FREMDEN Firmen hält — mit aktueller Bewertung, damit man
   * an der Bank sieht, ob sich ein Weiterverkauf gerade lohnt. */
  const portfolio = Object.values(G.players)
    .filter(other => other.id !== p.id && (other.equity[p.id] || 0) > 0)
    .map(other => ({ id: other.id, company: other.name, industry: other.industry,
      count: other.equity[p.id], pct: Math.round(other.equity[p.id] / AKTIEN * 1000) / 10,
      kurs: Math.round(kursVon(other) * 100) / 100, value: Math.round(kursVon(other) * other.equity[p.id]),
      buchwert: Math.round(substance(other) * other.equity[p.id] / AKTIEN),
      einstand: Math.round((p.equityAvg[other.id] || 0) * other.equity[p.id]),
      marketValue: Math.round(companyValue(other)), rev10: Math.round(rev10(other)) }));
  /* Kartell-Innensicht: der Verdachtswert und die offenen Einladungen gehen
   * ausschließlich an Mitglieder — und die eigenen offenen Einladungen an den,
   * der sie bekommen hat. Beides hat im öffentlichen Snapshot nichts verloren. */
  const eigenesKartell = MODE === "kartell" ? kartellVon(p) : null;
  return { cash: p.cash, inv: p.inv, xp: p.xp, lvl: p.lvl,
    kartell: eigenesKartell ? { ...kartellPublic(eigenesKartell),
      verdacht: Math.round(eigenesKartell.verdacht),
      minPreise: eigenesKartell.minPreise,
      /* Was die Absprache bisher eingebracht hat — und damit, woran das
       * Bussgeld haengen wuerde. Wer das sieht, kann abwaegen, statt zu raten. */
      ermittlung: eigenesKartell.ermittlung,
      umsatz: Math.round(eigenesKartell.umsatz[p.id] || 0),
      risiko: Math.round((eigenesKartell.umsatz[p.id] || 0) * BUSSGELD_ANTEIL),
      einladungen: eigenesKartell.einladungen.map(mid => ({ id: mid, name: G.players[mid]?.name ?? "—" })) } : null,
    kartellEinladungen: MODE === "kartell" && !eigenesKartell
      ? G.cartels.filter(k => k.einladungen.includes(p.id)).map(kartellPublic) : [],
    /* Restzeit je Bezirk, bis dort wieder Schutzgeld erpresst werden kann */
    erpress: MODE === "kartell"
      ? Object.fromEntries(Object.entries(p.erpressCd || {})
          .filter(([, bis]) => bis > G.tick).map(([b, bis]) => [b, bis - G.tick])) : null,
    kampfCd: MODE === "kartell" ? Math.max(0, (p.kampfCd || 0) - G.tick) : 0,
    verstCd: MODE === "kartell" ? Math.max(0, (p.verstCd || 0) - G.tick) : 0,
    razziaCd: MODE === "kartell" ? Math.max(0, (p.razziaCd || 0) - G.tick) : 0,
    quests: p.quests,
    tx: p.tx, sales: p.sales, fin: p.fin, nwHist: p.nwHist,
    fans: Math.round(p.fans || 0), fanHubs: fanHubs(p).length,
    ad: { reach: Math.round(p.adReach || 0), boost: +adBoost(p).toFixed(3),
          agenturen: adAgenturen(p), cap: adCap(adAgenturen(p)), pakete: AD_PACKAGES },
    meineWetten: G.wetten.filter(w => w.spielerId === p.id)
      .map(w => ({ ...w, firma: G.players[w.firmaId]?.name ?? "—" })),
    wettLog: p.wettLog || [], wettMax: wettMax(p),
    steuer: finanzamtAktiv() ? { ...steuerSchaetzung(p), letzter: p.steuerLetzter || null,
      schuld: Math.round(p.steuerSchuld || 0), gezahlt: Math.round(p.stats.steuern || 0) } : null,
    ownPct: Math.round((p.equity[p.id] || 0) / AKTIEN * 1000) / 10, ownAktien: p.equity[p.id] || 0, aktien: AKTIEN,
    portfolio, revenue: Math.round(p.revenue), ausschuettung: p.ausschuettung,
    swEp: Math.floor(p.swEp || 0),
    paintStufe: paintStufeVon(p), paintLizenz: p.paintLizenz || null,
    etf: Object.entries(p.etf || {}).map(([br, n]) => ({ branche: br, name: INDUSTRIES[br]?.name ?? br, anteile: Math.round(n * 100) / 100,
      wert: Math.round(n * (etfPreis(br) || 0)), buchwert: Math.round(n * (etfPreis(br, true) || 0)), einstand: Math.round(p.etfEinstand?.[br] || 0) })),
    marketValue: Math.round(companyValue(p)), rev10: Math.round(rev10(p)), ...marktPublic(p),
    /* Bilanz: erst die Substanz der eigenen Firma, dann der Anteil daran, den man
     * selbst noch hält, plus die Beteiligungen an fremden Firmen. Nur so passt
     * die Summe zum Nettovermögen in der Kopfzeile. */
    balance: { cash: Math.round(p.cash), invVal: Math.round(invVal), bldVal: Math.round(bldVal),
               bondVal, debtVal, markenwert: Math.round(swMarkenwert(p)),
               firmVal: Math.round(substance(p)),
               ownShare: (p.equity[p.id] || 0) / AKTIEN,
               holdings: Math.round(portfolio.reduce((sum, h) => sum + h.buchwert, 0)),   // Buchwert — wie im Nettovermögen
               total: Math.round(netWorth(p)) } };
}
/* Diagnose: mit DEBUG_PERF=1 alle 30 s eine Kennzahlenzeile ins Log. Damit lässt
 * sich belegen statt vermuten, ob und was über die Spielzeit wächst. */
const PERF = !!process.env.DEBUG_PERF;
const perf = { pushes: 0, snapMs: 0, maxTickMs: 0 };
/* Erledigte Verträge sofort aus der Liste nehmen. Sie blieben früher mit
 * geändertem Status für immer stehen — bei jedem Snapshot mitgefiltert und im
 * Speicher mitgeschleppt, obwohl niemand sie je wieder braucht. */
function dropContract(c) {
  const i = G.contracts.indexOf(c);
  if (i >= 0) G.contracts.splice(i, 1);
}
/* ---------- Kartendiff ----------
 * Die Karte macht 99 % des Zustands aus (676 Kacheln, ~104 KB) und ändert sich
 * fast nie — nur wenn jemand baut, freischaltet, pausiert oder auflevelt. Sie
 * trotzdem jede Sekunde vollständig zu senden hieß, dass jeder Browser rund
 * 366 MB pro Spielstunde einliest und wieder wegräumen muss. Genau daran wurde
 * ein Tab nach längerer Spielzeit zäh und blieb schließlich stehen.
 * Jetzt geht die volle Karte einmal je Verbindung raus, danach nur noch die
 * Kacheln, an denen sich wirklich etwas geändert hat. */
/* `autos` gehört dazu, sonst sieht der Client den Einzug eines Fahrzeugs nie:
 * Nach dem ersten Snapshot reist die Karte nur noch als Differenz über diese
 * Liste. Der Vergleich läuft über JSON, verschachtelte Arrays sind also
 * abgedeckt (derselbe Grund, aus dem `shop` hier steht). */
const DYNAMIC_TILE_KEYS = ["locked", "owner", "btype", "lien", "shop", "paused", "level", "autos", "sperre", "denkmal", "denkmalName", "bauBis", "system", "rzAktiv", "bestellungen", "vorrat"];
/* undefined wird zu null normalisiert, damit auch "Feld gelöscht" (z. B. der
 * Abriss räumt t.shop weg) beim Empfänger sicher ankommt. */
/* Fahrzeuge gehen MIT ihren gerechneten Werten über die Leitung. Sie hier
 * zentral zu bilden ist wichtig: Snapshot und Differenz müssen byte-gleich
 * aufgebaut sein, sonst meldet der Vergleich bei jedem Tick eine Änderung —
 * oder schlimmer: das Tuning ändert die Werte und die Kachel gilt als
 * unverändert, weil die Rohdaten gleich aussehen. */
const autosDyn = t => t.autos ? t.autos.map(a => ({ ...a, werte: autoWerte(a),
  wert: Math.round(autoWert(a)), reparatur: reparaturKosten(a) })) : null;
const tileDyn = t => { const d = {}; for (const k of DYNAMIC_TILE_KEYS) d[k] = k === "autos" ? autosDyn(t) : k === "bauBis" ? (imBau(t) ? t.bauBis : null) : (t[k] ?? null); return d; };
let lastTileSigs = null;
function tileDelta() {
  const sigs = new Array(G.map.length);
  const delta = [];
  for (let i = 0; i < G.map.length; i++) {
    const d = tileDyn(G.map[i]);
    /* Vergleich über JSON, nicht über eine Feld-Verkettung: `shop` ist ein
     * verschachteltes Slot-Array — ein String-Join würde Preis- und Warenwechsel
     * darin nicht bemerken und das Kachel-Update verschlucken. */
    const sig = JSON.stringify(d);
    sigs[i] = sig;
    if (lastTileSigs && lastTileSigs[i] !== sig) { d.i = i; delta.push(d); }
  }
  const ersterLauf = !lastTileSigs;
  lastTileSigs = sigs;
  return ersterLauf ? null : delta;
}
/* ---------- Rundenauswertung ----------
 * Wird einmal beim Sieg erstellt: eine Tabelle aller Firmen plus Auszeichnungen.
 * Die Zahlen stammen aus den laufenden Zählern (p.stats), nicht aus einer
 * nachträglichen Schätzung. */
function buildReport(siegerId) {
  const wertProduziert = st => Object.entries(st.produziert).reduce((sum, [g, n]) => sum + n * BASEP[g], 0);
  const zeilen = Object.values(G.players).map(p => {
    const st = p.stats;
    const geb = G.map.filter(t => t.owner === p.id && t.btype);
    const beteiligungen = Object.values(G.players)
      .filter(o => o.id !== p.id && (o.equity[p.id] || 0) > 0)
      .map(o => ({ firma: o.name, pct: Math.round(o.equity[p.id] / AKTIEN * 1000) / 10, wert: Math.round(substance(o) * o.equity[p.id] / AKTIEN) }));
    return {
      id: p.id, name: p.name, color: p.color, industrien: p.industries || [p.industry],
      sieger: p.id === siegerId,
      netWorth: Math.round(netWorth(p)),
      umsatz: Math.round(st.umsatz), ausgaben: Math.round(st.ausgaben),
      gebaeude: geb.length, stufen: geb.reduce((a, t) => a + ((t.level || 1) - 1), 0),
      produziertStk: Math.round(Object.values(st.produziert).reduce((a, b) => a + b, 0)),
      produziertWert: Math.round(wertProduziert(st)),
      grossauftraege: st.grossauftraege,
      besterHandel: st.besterHandel && { ...st.besterHandel, summe: Math.round(st.besterHandel.summe) },
      dividendeRein: Math.round(st.dividendeRein), dividendeRaus: Math.round(st.dividendeRaus),
      zinsErtrag: Math.round(st.zinsErtrag), zinsAufwand: Math.round(st.zinsAufwand),
      werbung: Math.round(st.werbung), fusionen: st.fusionen,
      anteileGekauft: st.anteileGekauft, anteileVerkauft: st.anteileVerkauft,
      beteiligungen, beteiligungswert: Math.round(beteiligungen.reduce((a, b) => a + b.wert, 0)),
      eigenanteil: Math.round((p.equity[p.id] || 0) / AKTIEN * 1000) / 10,
    };
  }).sort((a, b) => b.netWorth - a.netWorth);

  /* Auszeichnungen: nur vergeben, wenn überhaupt jemand etwas vorzuweisen hat */
  const beste = (titel, feld, format, zusatz) => {
    const top = zeilen.filter(z => (typeof feld === "function" ? feld(z) : z[feld]) > 0)
      .sort((a, b) => (typeof feld === "function" ? feld(b) - feld(a) : b[feld] - a[feld]))[0];
    return top ? { titel, name: top.name, color: top.color, wert: format(top), zusatz: zusatz?.(top) } : null;
  };
  const auszeichnungen = [
    beste("Größter Produzent", "produziertWert", z => `${z.produziertStk.toLocaleString("de-DE")} Stück`,
          z => `im Wert von ${Math.round(z.produziertWert).toLocaleString("de-DE")} $`),
    beste("Höchster Umsatz", "umsatz", z => `${z.umsatz.toLocaleString("de-DE")} $`),
    beste("Bester Einzelhandel", z => z.besterHandel?.summe || 0,
          z => `${z.besterHandel.summe.toLocaleString("de-DE")} $`,
          z => `${z.besterHandel.qty}× ${GOODS[z.besterHandel.good]?.name} an ${z.besterHandel.partner}`),
    beste("Größter Bauherr", "gebaeude", z => `${z.gebaeude} Gebäude`,
          z => z.stufen ? `${z.stufen} Ausbaustufen` : null),
    beste("Größter Aktionär", "beteiligungswert", z => `${z.beteiligungswert.toLocaleString("de-DE")} $`,
          z => z.beteiligungen.map(b => `${b.pct} % ${b.firma}`).join(", ")),
    beste("Stütze der Stadt", "grossauftraege", z => `${z.grossauftraege} Großaufträge`),
    beste("Größter Werbeetat", "werbung", z => `${z.werbung.toLocaleString("de-DE")} $`),
    beste("Meiste Dividende kassiert", "dividendeRein", z => `${z.dividendeRein.toLocaleString("de-DE")} $`),
  ].filter(Boolean);

  return { zeilen, auszeichnungen, dauerMin: Math.round(G.tick / 60), ziel: WIN_NW };
}

/* Throttle: pushState() wird max. alle 100ms aufgerufen. Dazwischen werden
 * Calls ignoriert, aber als "pending" markiert — beim nächsten echten Push
 * wird dann sofort nochmal gepusht. Das reduziert Network-Load massiv. */
let pushScheduled = false, pushPending = false, letzteFeldSigs = {};
function pushState() {
  if (pushScheduled) { pushPending = true; return; }
  pushScheduled = true;
  pushPending = false;

  const t0 = PERF ? process.hrtime.bigint() : 0n;
  const voll = snapshot();
  const delta = tileDelta();
  /* Nicht mehr jedes Mal den ganzen Stand: Gemessen gingen bei 12 Firmen rund
   * 36 KB pro Push und Spieler raus, fast alles unverändert (Orderbuch,
   * Auswertung, Rangliste, Fahrer …). Jetzt kommt je oberstem Feld nur, was
   * sich seit dem letzten Push geändert hat, markiert mit teil: true. Der
   * Client legt es über seinen letzten Stand (mergeState). Wer neu verbunden
   * ist, bekommt weiterhin den vollen Stand samt Karte. */
  const sigs = {};
  let schlank = null;
  if (delta !== null) {
    schlank = { teil: true, mapDelta: delta };
    for (const k in voll) {
      if (k === "map") continue;
      const sig = JSON.stringify(voll[k] ?? null);
      sigs[k] = sig;
      if (letzteFeldSigs[k] !== sig) schlank[k] = voll[k] ?? null;
    }
    for (const k in letzteFeldSigs) if (!(k in sigs)) schlank[k] = null;
  } else for (const k in voll) if (k !== "map") sigs[k] = JSON.stringify(voll[k] ?? null);
  letzteFeldSigs = sigs;
  for (const sock of io.sockets.sockets.values()) {
    /* Wer die Karte noch nie bekommen hat — frisch verbunden oder erster Push
     * überhaupt —, bekommt sie vollständig; alle anderen nur die Änderungen. */
    if (schlank && sock.data.gotMap) sock.emit("state", schlank);
    else { sock.emit("state", voll); sock.data.gotMap = true; }
  }
  for (const p of Object.values(G.players)) if (p.socketId) {
    const ps = privateState(p);
    const sitz = G.gpoker?.spieler?.find(s => s.pid === p.id);
    if (sitz?.karten?.length && G.gpoker.phase !== "warten") ps.gpokerKarten = sitz.karten.map(kartePub);
    /* Wie beim öffentlichen Stand: je Verbindung nur geänderte Felder. Eine neue
     * Verbindung (Beitritt, Reconnect) hat noch keine Signaturen → voll. */
    const sock = io.sockets.sockets.get(p.socketId);
    let out = ps;
    if (sock) {
      /* Signaturen gelten nur für denselben Spieler auf dieser Verbindung — nach
       * einem Rundenreset meldet sich dieselbe Verbindung als neue Firma an. */
      const alt = sock.data.mePid === p.id ? sock.data.meSigs : null, neu = {}, teil = { teil: true };
      sock.data.mePid = p.id;
      for (const k in ps) { const sig = JSON.stringify(ps[k] ?? null); neu[k] = sig; if (!alt || alt[k] !== sig) teil[k] = ps[k] ?? null; }
      if (alt) { for (const k in alt) if (!(k in neu)) teil[k] = null; out = teil; }
      sock.data.meSigs = neu;
    }
    io.to(p.socketId).emit("me", out);
  }
  if (PERF) { perf.pushes++; perf.snapMs += Number(process.hrtime.bigint() - t0) / 1e6; }

  setTimeout(() => {
    pushScheduled = false;
    if (pushPending) pushState();  // Wenn zwischendrin nochmal aufgerufen wurde → nochmal pushen
  }, 100);
}
if (PERF) setInterval(() => {
  const mb = (process.memoryUsage().heapUsed / 1048576).toFixed(1);
  console.log(`[perf] t=${Math.round(G.tick / 60)}min pushes/s=${(perf.pushes / 30).toFixed(1)} `
    + `broadcastMs/s=${(perf.snapMs / 30).toFixed(1)} tickMaxMs=${perf.maxTickMs.toFixed(1)} heap=${mb}MB `
    + `| spieler=${Object.keys(G.players).length} orders=${G.orders.length} contracts=${G.contracts.length} `
    + `bonds=${G.bonds.length} auktionen=${G.auctions.length} angebote=${G.shareListings.length} `
    + `anfragen=${G.shareBids.length} tx=${Object.values(G.players).reduce((a, p) => a + p.tx.length, 0)}`);
  perf.pushes = 0; perf.snapMs = 0; perf.maxTickMs = 0;
}, 30000);

/* ---------- Socket-Handling ---------- */
io.on("connection", socket => {
  /* Kursverlauf sofort mitgeben. Er wird sonst nur alle 10 s gesendet — wer
   * mitten im Intervall beitritt, säße bis dahin vor leeren Charts. */
  socket.emit("kurse", { waren: G.priceHist, firmen: G.firmHist });
  /* Reconnect: Browser hat noch ein Token aus einer früheren Verbindung (Tab zu,
   * WLAN-Aussetzer, versehentlich verlassen) — Spielstand bleibt komplett erhalten. */
  socket.on("rejoin", ({ token }, ack) => {
    const p = G.players[token];
    if (!p) return ack?.({ error: "Sitzung abgelaufen oder unbekannt" });
    G.socketToPid[socket.id] = token;
    p.socketId = socket.id; p.disconnected = false; p.disconnectedAt = null;
    socket.data.registered = true;
    io.emit("notice", { text: `${p.name} ist wieder da.` });
    ack?.({ ok: true, goods: GOODS, btypes: BTYPES, rooms: ROOMS, you: token, winGoal: WIN_NW,
      questDefs: QUESTSET(), industry: p.industry, industries: INDUSTRIES, racingUnlock: RACING_UNLOCK_NW,
      tuning: TUNING, tuningMax: TUNING_MAX, raceStats: RACE_STATS, stats: STATS,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.name])),
      retailFlow: Object.fromEntries(Object.keys(GOODS).map(k => [k, +retailFlow(k).toFixed(3)])),
      dividendRate: DIVIDEND_RATE, dividendInterval: DIVIDEND_INTERVAL });
    pushState();
  });

  /* Lobby / Registrierung */
  socket.on("register", ({ name, color, winGoal, industry, bots, botLevel, botToken, familieWunsch }, ack) => {
    name = sicherText(String(name || "").trim().slice(0, 20));
    if (!name) return ack?.({ error: "Name fehlt" });
    if (Object.values(G.players).some(p => p.name === name)) return ack?.({ error: "Name vergeben" });
    if (!INDUSTRIES[industry]) return ack?.({ error: "Bitte eine Industrie wählen" });
    /* Der erste Spieler wird Host: seine Angaben vom Startbildschirm sind die
     * Voreinstellung des Warteraums, die er dort bis zum Start noch ändern kann. */
    if (Object.keys(G.players).length === 0 && WIN_CHOICES.includes(+winGoal)) WIN_NW = +winGoal;
    if (Object.keys(G.players).length === 0) {
      if (bots && typeof bots === "object") botAuswahl = bots;
      if (BOT_LEVELS[botLevel]) botLevelKey = botLevel;
    }
    const pid = crypto.randomUUID();
    const istErster = Object.keys(G.players).length === 0;
    G.players[pid] = newPlayer(pid, name, sichereFarbe(color), industry, socket.id);
    /* Nur fuer die Anzeige — am Spiel aendert das Kennzeichen nichts. */
    if (botToken && botToken === BOT_TOKEN) G.players[pid].bot = true;
    /* Wer im Renntag-Modus einer laufenden Runde beitritt, bekommt seine
     * Startausruestung sofort — sonst saesse er ohne Wagen da, waehrend alle
     * anderen fahren. */
    if (MODE === "renntag" && G.started) renntagAusstatten(G.players[pid]);
    G.socketToPid[socket.id] = pid;
    socket.data.registered = true;
    if (istErster) G.hostId = pid;   // Host: darf im Warteraum einstellen und die Runde starten
    /* Wer mitten in eine laufende Planphase einsteigt, bekommt sofort ein
     * Soll und ein volles Bezugsschein-Budget. */
    if (MODE === "plan" && G.plan && G.started && !G.plan.spieler[pid]) {
      const ps = G.plan.spieler[pid] = { punkte: 0, prio: 1, faktor: 1 };
      ps.soll = planSollFuer(G.players[pid], G.plan.phase - 1);
      ps.budget = planBudgetFuer(ps);
    }
    /* Kartellmodus: Wer nach dem Start dazukommt (auch die Bots — sie
     * registrieren sich asynchron NACH startRound), landet sofort in der
     * jeweils kleinsten Familie. */
    if (MODE === "kartell" && G.started && !G.players[pid].familie) {
      const fids = Object.keys(FAMILIEN);
      /* Wunsch aus der Registrierung (Bots wollen in IHRE Familie bzw. zur
       * Polizei); sonst die kleinste Familie mit freiem Platz — sind alle
       * voll, geht der Nachzügler zur Polizei. */
      /* Für Menschen zählt nur die Zahl der MENSCHEN je Familie (max 2) —
       * ein Bot auf dem zweiten Platz macht dem Neuling Platz. Bots selbst
       * respektieren weiter die harte Obergrenze. */
      const zaehler = G.players[pid].bot ? famAnzahl : famMenschen;
      const wunsch = ["polizei", ...fids].includes(familieWunsch) ? familieWunsch : null;
      const frei = fids.filter(f => zaehler(f) < FAMILIE_MAX)
        .sort((a, b) => famAnzahl(a) - famAnzahl(b));
      G.players[pid].familie =
        (wunsch && (wunsch === "polizei" || zaehler(wunsch) < FAMILIE_MAX)) ? wunsch
        : frei[0] || (zaehler("polizei") < FAMILIE_MAX ? "polizei"
        : fids.slice().sort((a, b) => famAnzahl(a) - famAnzahl(b))[0]);
      if (!G.players[pid].bot) famBotVerdraengen(G.players[pid].familie);
      /* Späteinsteiger bekommen dasselbe Familien-Startkapital wie alle. */
      G.players[pid].cash += 8000;
      logTx(G.players[pid], "Kartell", "Startkapital der Familie", 8000);
      io.emit("notice", { text: G.players[pid].familie === "polizei"
        ? `${name} tritt in die Polizei ein — die Familien sind gewarnt.`
        : `${name} schwört „${famDef(G.players[pid].familie).name}“ die Treue.` });
    }
    io.emit("notice", { text: `${name} ist der Sitzung beigetreten.` + (Object.keys(G.players).length === 1 ? ` Rundenziel: ${WIN_NW.toLocaleString("de-DE")} $` : "") });
    ack?.({ ok: true, goods: GOODS, btypes: BTYPES, rooms: ROOMS, you: pid, winGoal: WIN_NW, questDefs: QUESTSET(), industry, industries: INDUSTRIES,
      /* Dieselben Motorsport-Daten wie beim Wiederverbinden weiter oben. Fehlten
       * sie hier, stünde beim frisch beigetretenen Spieler im Panel überall
       * "undefined" — genau das war beim ersten Blick auf die Oberfläche zu sehen. */
      racingUnlock: RACING_UNLOCK_NW, tuning: TUNING, tuningMax: TUNING_MAX, raceStats: RACE_STATS, stats: STATS,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.name])),
      retailFlow: Object.fromEntries(Object.keys(GOODS).map(k => [k, +retailFlow(k).toFixed(3)])),
      dividendRate: DIVIDEND_RATE, dividendInterval: DIVIDEND_INTERVAL });
    pushState();
  });

  /* ---------- Warteraum ----------
   * Solange die Runde nicht gestartet ist, darf der Host Ziel und Bots noch
   * ändern — anders als früher, wo beides beim Registrieren festgenagelt war
   * und Mitspieler, die später dazukamen, nichts mehr davon mitbekamen. */
  socket.on("lobbySettings", ({ winGoal, bots, botLevel, mode, saison }, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Das darf nur der Host" });
    if (G.started) return ack?.({ error: "Die Runde läuft schon" });
    if (["sandbox", "plan", "einsteiger", "renntag", "kartell"].includes(mode)) MODE = mode;
    if (WIN_CHOICES.includes(+winGoal)) WIN_NW = +winGoal;
    if (SAISON_CHOICES.includes(+saison)) SAISON_RENNEN = +saison;
    if (bots && typeof bots === "object") botAuswahl = bots;
    if (BOT_LEVELS[botLevel]) botLevelKey = botLevel;
    ack?.({ ok: true });
    pushState();
  });
  /* Das Einsteiger-Tutorial beendet die Runde, wenn es durch ist — so war der
   * Modus gedacht: er laeuft, bis alles gezeigt wurde. Derselbe Weg wie beim
   * Sieg, damit die Auswertung am Ende identisch aussieht. */
  socket.on("tutorialFertig", (_payload, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid) return ack?.({ error: "Unbekannter Spieler" });
    if (MODE !== "einsteiger") return ack?.({ error: "Nur im Einsteiger-Modus" });
    if (G.winner) return ack?.({ ok: true });
    const p = G.players[pid];
    if (!p) return ack?.({ error: "Unbekannter Spieler" });
    G.winner = p.name;
    G.tutorialEnde = true;      // damit der Endbildschirm nicht vom Vermoegensziel spricht
    G.report = buildReport(pid);
    io.emit("notice", { text: `${p.name} hat das Einsteiger-Tutorial abgeschlossen — Runde beendet.` });
    pushState();
    ack?.({ ok: true });
  });
  socket.on("startRound", (_payload, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Nur der Host startet die Runde" });
    if (G.started) return ack?.({ ok: true });
    G.started = true;
    /* Fahrerpool einmal je Runde würfeln — alle sehen dieselben Leute, wer
     * zuerst zugreift, hat sie. */
    if (!G.fahrer.length) G.fahrer = FAHRER_NAMEN.map((_, i) => fahrerBauen(i));
    /* Kartell: keine Wirtschafts-Bots (AgrarGenossen & Co.) — hier spielen
     * Mafiosi mit; die Auffüllung passiert unten nach der Familienzuteilung. */
    if (MODE !== "kartell") startBots();
    if (MODE === "kartell") {
      /* Familien auffüllen: Wer keine gewählt hat (auch Bots), kommt reihum in
       * die jeweils kleinste Familie — vier lebende Familien sind der Modus. */
      const fids = Object.keys(FAMILIEN);
      for (const sp of Object.values(G.players)) {
        if (sp.familie) continue;
        const frei = fids.filter(f => famAnzahl(f) < FAMILIE_MAX)
          .sort((a, b) => famAnzahl(a) - famAnzahl(b));
        sp.familie = frei[0] || fids.slice().sort((a, b) => famAnzahl(a) - famAnzahl(b))[0];
      }
      for (const f of fids) G.familienRespekt[f] ??= 0;
      /* Jede Familie bekommt genau ZWEI Plätze: freie Plätze füllen Mafia-Bots.
       * Bleibt die Polizei unbesetzt, übernimmt ein KI-Kommissar — es soll
       * immer einen Gegenspieler geben. */
      mafiaBotsAuffuellen();
      /* Weicher Einstieg: Startkapital der Familie obendrauf — der Betrieb
       * soll in Minute zwei stehen, nicht erst nach einer Börsenlehre.
       * Hier statt in newPlayer, weil die Registrierung VOR der Moduswahl
       * in der Lobby passiert. */
      for (const sp of Object.values(G.players)) {
        sp.cash += 8000;
        logTx(sp, "Kartell", "Startkapital der Familie", 8000);
      }
      /* Eigene Spielfläche: die alte italienische Küstenstadt. Wie bei Plan/
       * Renntag muss die Karte nach dem Tausch einmal VOLLSTÄNDIG an alle —
       * der Kachel-Diff trägt nur veränderliche Felder. */
      G.map = buildMap("kartell");
      G.groupOrder = null;
      lastTileSigs = null;
      for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
      io.emit("notice", { text: "Die vier Familien teilen die Stadt unter sich auf — Respekt entscheidet, wer das Sagen hat." });
    }
    if (MODE === "renntag") {
      /* Eigene Flaeche, dann jeder Spieler seine Startausruestung. Wie beim
       * Plan- und Einsteiger-Modus muss die Karte danach einmal vollstaendig
       * an alle gehen — der Kachel-Diff traegt nur veraenderliche Felder. */
      G.map = buildMap("renntag");
      lastTileSigs = null;
      for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
      for (const sp of Object.values(G.players)) renntagAusstatten(sp);
      /* Renntage kommen haeufiger — sie sind der Zweck des Modus, nicht Beiwerk. */
      G.naechstesRennenIn = Math.min(G.naechstesRennenIn, 45);
    }
    if (MODE === "einsteiger") {
      /* Einsteiger: eigene Flaeche (San Francisco, 64x64). Wie beim Plan-Modus
       * muss nach dem Kartentausch jeder Client die Karte einmal vollstaendig
       * bekommen — der Kachel-Diff traegt nur veraenderliche Felder. */
      G.map = buildMap("einsteiger");
      lastTileSigs = null;
      for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
    }
    if (MODE === "plan") {
      /* Eigene Spielfläche für die Planwirtschaft — Gebäude gibt es zu diesem
       * Zeitpunkt noch keine, der Tausch ist also verlustfrei. WICHTIG: Der
       * Kachel-Diff überträgt nur veränderliche Felder (owner, btype, …) —
       * nach einem Kartentausch muss deshalb jeder Client die Karte einmal
       * wieder vollständig bekommen, sonst behält er das alte Layout. */
      G.map = buildMap("plan");
      G.groupOrder = null;   // kein Stadt-Großauftrag im Plan-Modus
      lastTileSigs = null;
      for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
      G.plan = { phase: 0, rest: 0, spieler: {}, markt: [] };
      planPhaseStarten();
      io.emit("notice", { text: `Planwirtschaft: Der Fünfjahresplan beginnt — ${PLAN_ZIEL} Planpunkte machen dich zum Helden der Arbeit.` });
    } else if (MODE === "kartell") {
      io.emit("notice", { text: "Die Runde läuft — Ziel: 6 von 9 Bezirken. Wer die Stadt hält, gewinnt." });
    } else {
      io.emit("notice", { text: `Die Runde läuft — Ziel: ${WIN_NW.toLocaleString("de-DE")} $` });
    }
    ack?.({ ok: true });
    pushState();
  });

  const me = () => G.players[G.socketToPid[socket.id]];
  const guard = fn => (payload, ack) => {
    const p = me();
    if (!p || G.winner) return ack?.({ error: G.winner ? "Spiel beendet" : "Nicht registriert" });
    try { fn(p, payload || {}, ack); } catch (e) { ack?.({ error: e.message }); }
    pushState();
  };

  /* ---------- Adminpanel im Spiel ----------
   * Dasselbe wie /admin, aber ohne den Browser zu wechseln: Der Wirt oeffnet es
   * mitten in der laufenden Runde. Bewusst NICHT ueber guard():
   * - guard() verlangt einen registrierten Spieler; das Panel soll aber auch
   *   im Warteraum aufgehen.
   * - guard() sperrt alles ab, sobald G.winner steht ("Spiel beendet") — genau
   *   dann will man aber noch nachsehen koennen, wie die Runde ausging.
   *
   * Die Anmeldung haengt an der VERBINDUNG (socket.data.admin), nicht an einem
   * Feld, das der Client mitschickt. Ein Client, der sich einfach
   * "istAdmin: true" in seinen Zustand schreibt, kommt damit keinen Schritt
   * weiter — jedes Ereignis prueft die serverseitige Sitzung neu. */
  const adminNurAngemeldet = ack => {
    if (!socket.data.admin) { ack?.({ error: "Nicht angemeldet" }); return false; }
    return true;
  };

  socket.on("adminLogin", ({ key } = {}, ack) => {
    const ip = adminIp(socket);
    const sperre = adminGesperrtBis(ip);
    if (sperre) return ack?.({ error: `Zu viele Fehlversuche — noch ${sperre} s gesperrt` });
    if (!ADMINKEY || String(key || "") !== ADMINKEY) {
      adminFehlversuch(ip);
      /* Absichtlich dieselbe Meldung, egal ob der Schluessel falsch ist oder
       * gar keiner gesetzt wurde: Sonst verraet die Antwort, ob es ueberhaupt
       * etwas zu erraten gibt. */
      return ack?.({ error: "Falscher Schlüssel" });
    }
    adminVersucheLoeschen(ip);
    socket.data.admin = true;
    console.log(`Adminpanel: Anmeldung von ${ip}`);
    ack?.({ ok: true });
  });

  socket.on("adminLogout", (_p, ack) => { socket.data.admin = false; ack?.({ ok: true }); });

  socket.on("adminUebersicht", (_p, ack) => {
    if (!adminNurAngemeldet(ack)) return;
    ack?.({ ok: true, ...adminUebersicht() });
  });

  socket.on("adminEingriff", (payload, ack) => {
    if (!adminNurAngemeldet(ack)) return;
    const r = adminEingriff(payload || {});
    ack?.(r.error ? { error: r.error } : { ok: true, ...adminUebersicht() });
  });

  /* --- Branche im Warteraum waehlen ---
   * Frueher stand die Wahl am Startbildschirm, bevor man ueberhaupt wusste,
   * wer sonst mitspielt. Jetzt entscheidet man sie im Warteraum, wo alle
   * Branchen sichtbar sind — bis zum Start ist sie frei wechselbar, danach
   * nicht mehr: ab da haengen Gebaeude und Rezepte daran. */
  socket.on("brancheWaehlen", guard((p, { industry }, ack) => {
    if (G.started) return ack?.({ error: "Die Runde läuft schon" });
    if (!INDUSTRIES[industry]) return ack?.({ error: "Unbekannte Branche" });
    p.industry = industry;
    p.industries = [industry];
    ack?.({ ok: true });
  }));

  /* --- Planwirtschaft: Ware ans Planbüro abliefern ---
   * Liefert so viel wie möglich (Lagerbestand, gedeckelt aufs Restsoll) zum
   * festen staatlichen Ankaufspreis. Punkte gibt es sofort je Warenwert. */
  socket.on("planDeliver", guard((p, { good }, ack) => {
    if (MODE !== "plan" || !G.plan) return ack?.({ error: "Kein Planwirtschafts-Modus" });
    const ps = G.plan.spieler[p.id];
    const volk = G.plan.volk;
    const ziel = ps?.soll?.find(z => z.good === good);
    if (!ziel && !(volk && volk.good === good))
      return ack?.({ error: "Diese Ware steht weder in deinem Plansoll noch im Volkswirtschaftsziel" });
    let qty;
    if (ziel) {
      /* Übererfüllung bis 150 % ist möglich — bringt Bonuspunkte, hebt aber
       * über den Basiseffekt das Soll der nächsten Phase an. */
      const rest = Math.ceil(ziel.menge * 1.5) - ziel.geliefert;
      qty = Math.min(p.inv[good] || 0, rest);
      if (qty <= 0) return ack?.({ error: rest <= 0 ? "Mehr nimmt das Planbüro nicht an (150 %)" : "Nichts auf Lager" });
      ziel.geliefert += qty;
    } else {
      /* Reine Volksziel-Lieferung: unbegrenzt, aber halber Punktesatz. */
      qty = Math.min(p.inv[good] || 0, 1000);
      if (qty <= 0) return ack?.({ error: "Nichts auf Lager" });
    }
    if (volk && volk.good === good) volk.geliefert += qty;
    p.inv[good] -= qty;
    const erloes = qty * (BASEP[good] || 1) * 0.9;
    p.cash += erloes;
    ps.punkte += Math.round(qty * (BASEP[good] || 1) / (ziel ? 10 : 20));
    gainXp(p, 10);
    logTx(p, "Plan", `${Math.round(qty)}× ${GOODS[good].name} ans Planbüro geliefert`, erloes);
    ack?.({ ok: true });
  }));

  /* --- Planwirtschaft: Materialzuteilung beantragen ---
   * Statt frei einzukaufen, bezieht man Waren vom Staat: zum festen
   * Basispreis, begrenzt durch das Bezugsschein-Budget der Phase. */
  socket.on("planRequest", guard((p, { good, qty }, ack) => {
    if (MODE !== "plan" || !G.plan) return ack?.({ error: "Kein Planwirtschafts-Modus" });
    const ps = G.plan.spieler[p.id];
    if (!ps) return ack?.({ error: "Kein Planeintrag" });
    if (!GOODS[good]) return ack?.({ error: "Unbekannte Ware" });
    qty = Math.floor(+qty);
    if (!(qty > 0) || qty > 1000) return ack?.({ error: "Ungültige Menge" });
    const kosten = qty * (BASEP[good] || 1);
    if ((ps.budget || 0) < kosten) return ack?.({ error: `Bezugsschein-Budget reicht nicht (${Math.floor((ps.budget || 0) / (BASEP[good] || 1))}× möglich)` });
    if (p.cash < kosten) return ack?.({ error: "Zu wenig Geld" });
    ps.budget -= kosten;
    p.cash -= kosten;
    p.inv[good] = (p.inv[good] || 0) + qty;
    logTx(p, "Plan", `Zuteilung: ${qty}× ${GOODS[good].name} bezogen`, -kosten);
    ack?.({ ok: true });
  }));

  /* --- Planwirtschaft: Schwarzmarkt ---
   * Offiziell gibt es keinen Handel unter Spielern — inoffiziell schon:
   * Ware gegen Ware, ohne Geld. Die angebotene Ware wandert beim Einstellen
   * in Verwahrung (kein Zeitfenster für Doppelausgaben). Jeder abgeschlossene
   * Tausch kann auffliegen: Eintrag in die Kaderakte für BEIDE Seiten. */
  socket.on("planOfferCreate", guard((p, { gebeGood, gebeQty, willGood, willQty }, ack) => {
    if (MODE !== "plan" || !G.plan) return ack?.({ error: "Kein Planwirtschafts-Modus" });
    gebeQty = Math.floor(+gebeQty); willQty = Math.floor(+willQty);
    if (!GOODS[gebeGood] || !GOODS[willGood] || gebeGood === willGood) return ack?.({ error: "Ungültige Waren" });
    if (!(gebeQty > 0) || !(willQty > 0) || gebeQty > 1000 || willQty > 1000) return ack?.({ error: "Ungültige Mengen" });
    if ((p.inv[gebeGood] || 0) < gebeQty) return ack?.({ error: "Nicht genug Ware im Lager" });
    if (G.plan.markt.filter(o => o.von === p.id).length >= 3) return ack?.({ error: "Höchstens 3 eigene Angebote" });
    p.inv[gebeGood] -= gebeQty;   // Verwahrung
    G.plan.markt.push({ id: id(), von: p.id, gebeGood, gebeQty, willGood, willQty });
    ack?.({ ok: true });
  }));
  socket.on("planOfferCancel", guard((p, { offerId }, ack) => {
    if (MODE !== "plan" || !G.plan) return ack?.({ error: "Kein Planwirtschafts-Modus" });
    const i = G.plan.markt.findIndex(o => o.id === offerId && o.von === p.id);
    if (i < 0) return ack?.({ error: "Angebot nicht gefunden" });
    const o = G.plan.markt.splice(i, 1)[0];
    p.inv[o.gebeGood] = (p.inv[o.gebeGood] || 0) + o.gebeQty;
    ack?.({ ok: true });
  }));
  socket.on("planOfferAccept", guard((p, { offerId }, ack) => {
    if (MODE !== "plan" || !G.plan) return ack?.({ error: "Kein Planwirtschafts-Modus" });
    const i = G.plan.markt.findIndex(o => o.id === offerId);
    if (i < 0) return ack?.({ error: "Angebot nicht mehr da" });
    const o = G.plan.markt[i];
    if (o.von === p.id) return ack?.({ error: "Eigenes Angebot — zurückziehen statt annehmen" });
    const anbieter = G.players[o.von];
    if (!anbieter) { G.plan.markt.splice(i, 1); return ack?.({ error: "Anbieter nicht mehr da" }); }
    if ((p.inv[o.willGood] || 0) < o.willQty) return ack?.({ error: `Dir fehlt ${GOODS[o.willGood].name}` });
    G.plan.markt.splice(i, 1);
    p.inv[o.willGood] -= o.willQty;
    p.inv[o.gebeGood] = (p.inv[o.gebeGood] || 0) + o.gebeQty;         // Verwahrtes an den Käufer
    anbieter.inv[o.willGood] = (anbieter.inv[o.willGood] || 0) + o.willQty;
    logTx(p, "Plan", `Schwarzmarkt: ${o.gebeQty}× ${GOODS[o.gebeGood].name} gegen ${o.willQty}× ${GOODS[o.willGood].name} getauscht`, 0);
    logTx(anbieter, "Plan", `Schwarzmarkt: ${o.gebeQty}× ${GOODS[o.gebeGood].name} gegen ${o.willQty}× ${GOODS[o.willGood].name} getauscht`, 0);
    /* Ein Würfelwurf pro Tausch: Fliegt er auf, trifft es beide Seiten. */
    if (Math.random() < SCHWARZ_RISIKO) {
      kaderEintrag(p, G.plan.spieler[p.id] ??= { punkte: 0 });
      kaderEintrag(anbieter, G.plan.spieler[anbieter.id] ??= { punkte: 0 });
    }
    ack?.({ ok: true });
  }));

  /* --- Kartellmodus: gründen, einladen, beitreten, verlassen ---
   * Beitritt ausschließlich auf Einladung. Ein Kartell, dem man ungefragt
   * beitreten könnte, wäre kein Kartell, sondern ein Marktplatz — und ein
   * Konkurrent könnte sich hineinsetzen, nur um die Absprachen mitzulesen. */
  const kartellModus = ack => {
    if (MODE !== "kartell") { ack?.({ error: "Kartelle gibt es nur in der Kartellwirtschaft" }); return false; }
    if (!G.started) { ack?.({ error: "Erst wenn die Runde läuft" }); return false; }
    return true;
  };

  /* --- Familie wählen (vor dem Start; danach ist der Schwur bindend) --- */
  socket.on("familieWaehlen", guard((p, { fid }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Familien gibt es nur in der Kartellwirtschaft" });
    if (!famDef(fid)) return ack?.({ error: "Diese Familie kennt hier niemand" });
    if (G.started && p.familie) return ack?.({ error: "Der Familie schwört man nur einmal — ein Wechsel wäre Verrat" });
    if (fid !== p.familie && famMenschen(fid) >= FAMILIE_MAX)
      return ack?.({ error: `${famDef(fid).name} hat schon ${FAMILIE_MAX} Spieler — such dir eine andere Seite` });
    p.familie = fid;
    if (!p.bot) famBotVerdraengen(fid);
    io.emit("notice", { text: fid === "polizei"
      ? `${p.name} tritt in die Polizei ein — die Familien sind gewarnt.`
      : `${p.name} schwört „${famDef(fid).name}“ die Treue.` });
    ack?.({ ok: true });
  }));

  /* --- Hehler: der einzige Absatzweg für illegale Ware ---
   * Fester Ankaufspreis, bar auf die Hand — und jeder verkaufte Posten
   * bringt der Familie Respekt (1 Punkt je 100 $ Warenwert). */
  socket.on("hehlerVerkauf", guard((p, { good, qty }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Der Hehler arbeitet nur in der Kartellwirtschaft" });
    if (p.familie === "polizei") return ack?.({ error: "Der Hehler bedient keine Beamten — schon gar nicht in Uniform" });
    if (!ILLEGAL.includes(good)) return ack?.({ error: "Der Hehler nimmt nur heiße Ware" });
    qty = Math.floor(+qty) || Math.floor(p.inv[good] || 0);
    qty = Math.min(qty, Math.floor(p.inv[good] || 0));
    if (qty <= 0) return ack?.({ error: `Kein ${GOODS[good].name} im Lager` });
    const erloes = qty * BASEP[good];
    p.inv[good] -= qty;
    p.cash += erloes;
    p.stats.umsatz = (p.stats.umsatz || 0) + erloes;
    const respekt = erloes / 100;
    if (p.familie) G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + respekt;
    /* Abgabe an den Paten: 10 % des Erlöses, unter dessen Familie aufgeteilt —
     * außer man gehört selbst zur Familie des Paten. */
    let abgabe = 0;
    if (G.pate && p.familie !== G.pate) {
      const paten = Object.values(G.players).filter(x2 => x2.familie === G.pate);
      if (paten.length) {
        abgabe = Math.round(erloes * PATEN_ABGABE * (G.pateDekret === "steuer" ? .5 : 1));
        p.cash -= abgabe;
        const teil = Math.round(abgabe / paten.length);
        for (const x2 of paten) { x2.cash += teil; logTx(x2, "Kartell", `Abgabe von ${p.name} an den Paten`, teil); }
        logTx(p, "Kartell", `Abgabe an den Paten (${FAMILIEN[G.pate].name})`, -abgabe);
      }
    }
    gainXp(p, Math.min(30, Math.round(respekt)));
    questProg(p, "hehler");
    logTx(p, "Kartell", `Hehler: ${qty}× ${GOODS[good].name} verkauft (+${Math.round(respekt)} Respekt)`, erloes);
    ack?.({ ok: true, erloes, abgabe });
  }));

  /* --- Überfall auf einen Werttransport ---
   * Chance: 50 % Basis, +6 % je Pistole im Lager (höchstens +30 %), +25 %
   * wenn der Transport an einer Sperre festhängt, minus Fahndungs-Malus.
   * Erfolg bringt Beute und Respekt, Misserfolg Kaution — beides heizt die
   * Fahndung an. */
  socket.on("ueberfall", guard((p, { transportId }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Überfälle gibt es nur in der Kartellwirtschaft" });
    if (!p.familie) return ack?.({ error: "Ohne Familie überfällt man niemanden" });
    const tr = G.transporte.find(t2 => t2.id === transportId);
    if (!tr) return ack?.({ error: "Der Transport ist längst über alle Berge" });
    /* Polizei: keine Beute, sondern Kontrolle — der Transport wird eskortiert,
     * die Ladung sichergestellt. Verlässlich, aber unspektakulär bezahlt. */
    if (p.familie === "polizei") {
      if (p.ueberfallSperre && p.ueberfallSperre > G.tick)
        return ack?.({ error: `Die Streife ist noch unterwegs — ${p.ueberfallSperre - G.tick} s` });
      p.ueberfallSperre = G.tick + UEBERFALL_COOLDOWN;
      G.transporte = G.transporte.filter(t2 => t2 !== tr);
      const praemie = 400 + Math.floor(Math.random() * 300);
      p.cash += praemie;
      G.polizeiPunkte = (G.polizeiPunkte || 0) + 1;
      logTx(p, "Polizei", `Transport kontrolliert und sichergestellt`, praemie);
      io.emit("notice", { text: `🚔 ${p.name} kontrolliert einen ${TRANSPORT_ARTEN[tr.art].name} — Ladung sichergestellt (+1 Einsatzpunkt).` });
      return ack?.({ ok: true, praemie });
    }
    if (p.ueberfallSperre && p.ueberfallSperre > G.tick)
      return ack?.({ error: `Zu heiß — warte noch ${p.ueberfallSperre - G.tick} s` });
    p.ueberfallSperre = G.tick + UEBERFALL_COOLDOWN;
    questProg(p, "ueberfall");   // der Versuch zählt — Mut wird belohnt
    const pistolen = Math.floor(p.inv.pistole || 0);
    const chance = 0.5 + Math.min(0.3, pistolen * 0.06) + (tr.gestoppt ? 0.25 : 0)
      - Math.min(0.25, (G.fahndung[p.familie] || 0) / 400);
    G.transporte = G.transporte.filter(t2 => t2 !== tr);
    if (Math.random() < chance) {
      let beuteText;
      if (tr.art === "geld") {
        const geld = 1500 + Math.floor(Math.random() * 2000);
        p.cash += geld; beuteText = `${geld} $ Bargeld`;
        logTx(p, "Kartell", "Überfall: Geldtransport ausgeraubt", geld);
      } else if (tr.art === "waffen") {
        const n = 3 + Math.floor(Math.random() * 4);
        p.inv.pistole = (p.inv.pistole || 0) + n; beuteText = `${n} Pistolen`;
        logTx(p, "Kartell", `Überfall: Waffentransport ausgeraubt (${n} Pistolen)`, 0);
      } else {
        const n = 2 + Math.floor(Math.random() * 3);
        p.inv.goldbarren = (p.inv.goldbarren || 0) + n; beuteText = `${n} Goldbarren`;
        logTx(p, "Kartell", `Überfall: Goldtransport ausgeraubt (${n} Goldbarren)`, 0);
      }
      G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + 5;
      G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 8;
      gainXp(p, 15);
      io.emit("notice", { text: `💥 ${p.name} (${FAMILIEN[p.familie].name}) überfällt einen ${TRANSPORT_ARTEN[tr.art].name}: ${beuteText} erbeutet!` });
      ack?.({ ok: true, beute: beuteText });
    } else {
      const kaution = Math.min(p.cash, 500);
      p.cash -= kaution;
      G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 15;
      logTx(p, "Kartell", "Überfall vereitelt — Kaution gezahlt", -kaution);
      io.emit("notice", { text: `🚓 Die Polizei vereitelt einen Überfall von ${p.name} — die Fahndung nach ${FAMILIEN[p.familie].name} verschärft sich.` });
      ack?.({ error: "Der Überfall ist geplatzt — die Fahrer haben Verstärkung gerufen (−500 $ Kaution)" });
    }
  }));

  /* --- Schutzgelderpressung: die Läden eines Bezirks einschüchtern ---
   * Ergänzt das passive Bezirks-Schutzgeld (das weiter jede Minute an die
   * kontrollierende Familie fließt): Wer selbst durch die Gassen zieht, holt
   * mehr heraus — bezahlt aber mit Fahndungsdruck. Im eigenen Revier zahlen
   * die Läden das Anderthalbfache ohne Murren; im Revier einer FREMDEN
   * Familie riskiert man, von deren Schlägern rausgeworfen zu werden. */
  socket.on("erpressen", guard((p, { bezirk }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Schutzgeld gibt es nur in der Kartellwirtschaft" });
    if (p.familie === "polizei") return ack?.({ error: "Die Polizei erpresst niemanden — sie macht Razzien" });
    if (!p.familie) return ack?.({ error: "Ohne Familie erpresst man niemanden" });
    bezirk = Math.floor(+bezirk);
    const b = G.bezirke?.[bezirk];
    if (!b) return ack?.({ error: "Diesen Bezirk kennt hier niemand" });
    p.erpressCd ??= {};
    if ((p.erpressCd[bezirk] || 0) > G.tick)
      return ack?.({ error: `Die Läden im ${b.name} haben gerade erst gezahlt — warte noch ${p.erpressCd[bezirk] - G.tick} s` });
    p.erpressCd[bezirk] = G.tick + ERPRESS_COOLDOWN;
    const eigene = b.kontrolle === p.familie, fremd = b.kontrolle && b.kontrolle !== p.familie;
    if (fremd && Math.random() < 0.3) {
      /* Die Schläger der kontrollierenden Familie funken dazwischen */
      G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 10;
      G.familienRespekt[p.familie] = Math.max(0, (G.familienRespekt[p.familie] || 0) - 2);
      G.familienRespekt[b.kontrolle] = (G.familienRespekt[b.kontrolle] || 0) + 1;
      io.emit("notice", { text: `👊 ${FAMILIEN[b.kontrolle].name} wirft ${p.name} aus dem ${b.name} — die Erpressung platzt.` });
      return ack?.({ error: `${FAMILIEN[b.kontrolle].name} hält ihre Hand über den ${b.name} — ihre Schläger haben dich rausgeworfen (−2 Respekt, +Fahndung)` });
    }
    let betrag = 250 + Math.floor(Math.random() * 200);
    if (eigene) betrag = Math.round(betrag * 1.5);
    p.cash += betrag;
    kampfPunkte(bezirk, p.familie, 1);   // Tauziehen: wer eintreibt, zeigt, wem die Straße gehört
    G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 6;
    G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + 1;
    questProg(p, "schutzgeld");
    gainXp(p, 8);
    logTx(p, "Kartell", `Schutzgeld aus dem ${b.name} erpresst`, betrag);
    io.to(p.id).emit("notice", { text: `💰 Die Läden im ${b.name} zahlen: +${betrag} $${eigene ? " — euer Revier, keiner mault" : ""}` });
    ack?.({ ok: true, betrag });
  }));

  /* --- Revierkampf: geclaimte Bezirke mit Waffen umkämpfen ---
   * Setzt bei Erfolg die Kontrolle des Bezirks für KAMPF_DAUER aus. In dem
   * Fenster holt man sich mit Bauten und Sperren selbst die Mehrheit. */
  socket.on("revierkampf", guard((p, { bezirk }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Revierkämpfe gibt es nur in der Kartellwirtschaft" });
    if (p.familie === "polizei") return ack?.({ error: "Die Polizei führt keine Revierkämpfe — sie sichert Bezirke per Razzia" });
    if (!p.familie) return ack?.({ error: "Ohne Familie kämpft man um kein Revier" });
    bezirk = Math.floor(+bezirk);
    const b = G.bezirke?.[bezirk];
    if (!b) return ack?.({ error: "Diesen Bezirk kennt hier niemand" });
    if ((G.revierKaempfe ??= {})[bezirk])
      return ack?.({ error: "Dort tobt schon ein Revierkampf — misch dich mit Verstärkung ein" });
    if (!b.kontrolle) return ack?.({ error: "Der Bezirk ist frei — bau einfach, statt zu schießen" });
    if (b.kontrolle === p.familie) return ack?.({ error: "Das ist euer eigenes Revier" });
    if ((p.kampfCd || 0) > G.tick)
      return ack?.({ error: `Deine Leute lecken noch ihre Wunden — warte ${p.kampfCd - G.tick} s` });
    const pistolen = Math.floor(p.inv.pistole || 0);
    if (pistolen < KAMPF_PISTOLEN_MIN)
      return ack?.({ error: `Für einen Revierkampf brauchst du mindestens ${KAMPF_PISTOLEN_MIN} Pistolen — Waffentransporte überfallen!` });
    p.kampfCd = G.tick + KAMPF_COOLDOWN;
    const einsatz = Math.min(KAMPF_PISTOLEN_MAX, pistolen);
    p.inv.pistole -= einsatz;
    /* Chance: Waffen helfen, die Präsenz der Verteidiger (Gebäude im Bezirk) bremst */
    const verteidigung = b.staerken?.[b.kontrolle] || 2;
    const chance = Math.min(.85, .35 + einsatz * .08 - Math.max(0, verteidigung - 2) * .04);
    G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 8;
    if (Math.random() < chance) {
      /* Das Tauziehen beginnt: Startpunkte = Momentum + Familiengröße + Soldaten */
      G.revierKaempfe[bezirk] = { angreifer: p.familie, verteidiger: b.kontrolle,
        punkte: { [p.familie]: kampfStart(p.familie, true), [b.kontrolle]: kampfStart(b.kontrolle, false) },
        bis: G.tick + KAMPF_DAUER };
      G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + 2;
      questProg(p, "kampf");
      gainXp(p, 20);
      bezirkeBerechnen();
      logTx(p, "Kartell", `Revierkampf eröffnet: ${b.name}`, 0);
      io.emit("kampfStart", { bezirk, name: b.name, angreifer: p.familie, verteidiger: b.kontrolle });
      io.emit("notice", { text: `⚔️ REVIERKAMPF! ${FAMILIEN[p.familie].name} stürmt den ${b.name} der ${FAMILIEN[b.kontrolle].name} — ${KAMPF_DAUER} s Tauziehen: Bauten, Sperren, Erpressungen und Verstärkung zählen!` });
      ack?.({ ok: true, dauer: KAMPF_DAUER });
    } else {
      const kaution = Math.min(p.cash, 500);
      p.cash -= kaution;
      G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 4;   // insgesamt +12
      G.familienRespekt[p.familie] = Math.max(0, (G.familienRespekt[p.familie] || 0) - 1);
      logTx(p, "Kartell", `Revierkampf im ${b.name} verloren (${einsatz} Pistolen weg)`, -kaution);
      io.emit("notice", { text: `⚔️ ${FAMILIEN[b.kontrolle].name} schlägt einen Angriff von ${p.name} auf den ${b.name} zurück.` });
      ack?.({ error: `Zurückgeschlagen — ${einsatz} Pistolen verloren, ${kaution} $ Kaution, die Fahndung brennt (+12)` });
    }
  }));

  /* --- Polizei: Razzia gegen einen kontrollierten Bezirk ---
   * Das Kerngeschäft des Gegenspielers: Die Polizei liest im Panel ab, WER
   * einen Bezirk hält und wie heiß dessen Fahndung läuft — je höher die
   * Fahndung, desto sicherer der Zugriff. Erfolg: Ware der Familie weg,
   * Bußgeld an die Staatskasse (den Polizisten), Bezirk 60 s „gesichert",
   * ein Einsatzpunkt. 25 Punkte, und die Polizei gewinnt die Runde. */
  socket.on("razziaBezirk", guard((p, { bezirk }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Razzien gibt es nur in der Kartellwirtschaft" });
    if (p.familie !== "polizei") return ack?.({ error: "Razzien führt nur die Polizei" });
    bezirk = Math.floor(+bezirk);
    const b = G.bezirke?.[bezirk];
    if (!b) return ack?.({ error: "Diesen Bezirk kennt hier niemand" });
    if (!b.kontrolle) return ack?.({ error: "Dort kontrolliert niemand etwas — keine Grundlage für einen Zugriff" });
    if ((p.razziaCd || 0) > G.tick)
      return ack?.({ error: `Das Einsatzkommando rüstet noch — ${p.razziaCd - G.tick} s` });
    p.razziaCd = G.tick + RAZZIA_BEZIRK_CD;
    const fam = b.kontrolle;
    const chance = Math.min(.9, .35 + (G.fahndung[fam] || 0) / 200);   // heiße Familien = leichte Beute
    if (Math.random() < chance) {
      let beschlagnahmt = 0, strafe = 0;
      for (const m of Object.values(G.players)) {
        if (m.familie !== fam) continue;
        for (const g of ILLEGAL) { const n = Math.floor(m.inv[g] || 0); if (n > 0) { m.inv[g] = 0; beschlagnahmt += n; } }
        const st2 = Math.min(m.cash, 800); m.cash -= st2; strafe += st2;
        logTx(m, "Kartell", `Razzia im ${b.name} — Ware beschlagnahmt, Bußgeld`, -st2);
      }
      p.cash += strafe;
      G.familienRespekt[fam] = Math.max(0, (G.familienRespekt[fam] || 0) - 5);
      G.fahndung[fam] = Math.max(0, (G.fahndung[fam] || 0) - 30);   // Akte abgearbeitet
      (G.gesichert ??= {})[bezirk] = G.tick + GESICHERT_DAUER;
      G.polizeiPunkte = (G.polizeiPunkte || 0) + 2;
      gainXp(p, 15);
      logTx(p, "Polizei", `Razzia im ${b.name}: ${beschlagnahmt}× Ware, ${strafe} $ Bußgeld`, strafe);
      bezirkeBerechnen();
      io.emit("notice", { text: `🚨 RAZZIA! ${p.name} stürmt den ${b.name} (${famDef(fam).name}): ${beschlagnahmt}× heiße Ware beschlagnahmt, ${strafe} $ Bußgeld — der Bezirk ist ${GESICHERT_DAUER} s gesichert.` });
      ack?.({ ok: true, beschlagnahmt, strafe });
    } else {
      G.fahndung[fam] = Math.max(0, (G.fahndung[fam] || 0) - 5);
      io.emit("notice", { text: `🚔 Eine Razzia im ${b.name} läuft ins Leere — ${famDef(fam).name} wurde gewarnt.` });
      ack?.({ error: "Der Zugriff platzt — die Läden waren sauber. Mehr Fahndungsdruck macht den nächsten sicherer" });
    }
  }));

  /* --- Casino Municipale: spielen, Quoten, Ausbau, Schwarzverkauf --- */
  socket.on("gcasinoSpielen", guard((p, { spiel, einsatz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Das Casino Municipale gibt es nur in der Kartellwirtschaft" });
    const sp = GCASINO_SPIELE[spiel];
    if (!sp) return ack?.({ error: "Dieses Spiel kennt das Haus nicht" });
    const herr = gcasinoHerrscher();
    if (!herr) return ack?.({ error: "Das Casino ist geschlossen — niemand beherrscht die Piazza Grande" });
    /* Jeder darf ans Tableau — auch das Haus selbst (dann schiebt die Familie
     * das Geld intern hin und her) und der Commissario nach Feierabend. */
    einsatz = Math.floor(+einsatz);
    if (!(einsatz >= 50 && einsatz <= GCASINO_EINSATZ_MAX))
      return ack?.({ error: `Einsatz zwischen 50 und ${GCASINO_EINSATZ_MAX} $` });
    if (p.cash < einsatz) return ack?.({ error: "Zu wenig Bargeld" });
    const q = GCASINO_QUOTEN[G.gcasino.quote];
    const chance = Math.max(.005, sp.chance + (sp.chance > .1 ? q.chanceDelta : q.chanceDelta / 10));
    gcasinoEinsatz(p, einsatz, sp.name);
    const gewonnen = Math.random() < chance;
    const detail = gcasinoDetail(spiel, gewonnen);
    let betrag = einsatz;
    if (gewonnen) betrag = gcasinoGewinn(p, Math.round(einsatz * sp.faktor), sp.name);
    ack?.({ ok: true, gewonnen, betrag, detail });
  }));

  /* --- Live-Roulette: gemeinsamer Tisch, alle setzen, ein Rad dreht --- */
  socket.on("grouletteSetzen", guard((p, { art, zahl, einsatz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (!gcasinoHerrscher()) return ack?.({ error: "Das Casino ist geschlossen — niemand beherrscht die Piazza Grande" });
    const R = G.groulette;
    if (R.phase === "drehen") return ack?.({ error: "Rien ne va plus — das Rad dreht sich schon" });
    if (!["rot", "schwarz", "zahl"].includes(art)) return ack?.({ error: "Diese Wette kennt der Croupier nicht" });
    zahl = Math.floor(+zahl);
    if (art === "zahl" && !(zahl >= 0 && zahl <= 36)) return ack?.({ error: "Volle Zahl: 0 bis 36" });
    einsatz = Math.floor(+einsatz);
    if (!(einsatz >= 50 && einsatz <= GCASINO_EINSATZ_MAX))
      return ack?.({ error: `Einsatz zwischen 50 und ${GCASINO_EINSATZ_MAX} $` });
    if (p.cash < einsatz) return ack?.({ error: "Zu wenig Bargeld" });
    gcasinoEinsatz(p, einsatz, "Roulette");
    if (R.phase === "warten") {
      R.phase = "setzen"; R.endet = G.tick + 20; R.zahl = null;
      io.emit("notice", { text: `\u{1F3A1} ${p.name} eröffnet eine Runde am Roulette-Tisch — Einsätze bitte! (20 s)` });
    }
    R.einsaetze.push({ pid: p.id, name: p.name, farbe: p.color, art, zahl: art === "zahl" ? zahl : null, einsatz });
    ack?.({ ok: true, endet: R.endet });
  }));

  /* --- Blackjack: bis zu 4 Plätze, reihum ziehen, der Dealer zieht bis 17 --- */
  socket.on("gblackjackBeitreten", guard((p, { einsatz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (!gcasinoHerrscher()) return ack?.({ error: "Das Casino ist geschlossen — niemand beherrscht die Piazza Grande" });
    const B = G.gblackjack;
    if (B.phase !== "warten" && B.phase !== "setzen")
      return ack?.({ error: "Die Runde läuft — gleich wird neu gegeben" });
    if (B.spieler.some(s => s.pid === p.id)) return ack?.({ error: "Du sitzt schon am Tisch" });
    if (B.spieler.length >= 4) return ack?.({ error: "Der Tisch ist voll (4 Plätze)" });
    einsatz = Math.floor(+einsatz);
    if (!(einsatz >= 50 && einsatz <= GCASINO_EINSATZ_MAX))
      return ack?.({ error: `Einsatz zwischen 50 und ${GCASINO_EINSATZ_MAX} $` });
    if (p.cash < einsatz) return ack?.({ error: "Zu wenig Bargeld" });
    gcasinoEinsatz(p, einsatz, "Blackjack");
    B.spieler.push(bjSitzNeu(p, einsatz));
    if (B.phase === "warten") {
      B.phase = "setzen"; B.endet = G.tick + 12; B.dealer = []; B.dran = -1;
      io.emit("notice", { text: `\u{1F0CF} ${p.name} setzt sich an den Blackjack-Tisch — wer spielt mit? (12 s)` });
    }
    ack?.({ ok: true });
  }));

  socket.on("gblackjackZug", guard((p, { aktion }, ack) => {
    const B = G.gblackjack;
    if (MODE !== "kartell" || B.phase !== "ziehen") return ack?.({ error: "Gerade wird nicht gezogen" });
    const s = B.spieler[B.dran];
    if (!s || s.pid !== p.id) return ack?.({ error: "Du bist nicht an der Reihe" });
    ack?.(gblackjackAktion(p, s, aktion));
  }));

  /* --- Poker: 2-4 Spieler gegeneinander, das Haus nimmt 5 % Rake --- */
  socket.on("gpokerBeitreten", guard((p, { einsatz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (!gcasinoHerrscher()) return ack?.({ error: "Das Casino ist geschlossen — niemand beherrscht die Piazza Grande" });
    const P = G.gpoker;
    if (P.phase !== "warten" && P.phase !== "setzen") return ack?.({ error: "Die Hand läuft — gleich wird neu gemischt" });
    if (P.spieler.some(s => s.pid === p.id)) return ack?.({ error: "Du sitzt schon am Tisch" });
    if (P.spieler.length >= 4) return ack?.({ error: "Der Tisch ist voll (4 Plätze)" });
    if (P.phase === "warten") {
      einsatz = Math.floor(+einsatz);
      if (!(einsatz >= 50 && einsatz <= GCASINO_EINSATZ_MAX))
        return ack?.({ error: `Grundeinsatz zwischen 50 und ${GCASINO_EINSATZ_MAX} $` });
      P.einsatz = einsatz;
    }
    if (p.cash < P.einsatz * 6) return ack?.({ error: `Für diesen Tisch brauchst du Reserven: ${P.einsatz * 6} $ (6× Grundeinsatz)` });
    p.cash -= P.einsatz; P.pot += P.einsatz;
    logTx(p, "Casino", "Poker: Ante", -P.einsatz);
    P.spieler.push({ pid: p.id, name: p.name, farbe: p.color, karten: [], gefoldet: false,
      gesetzt: 0, dranWar: false, ergebnis: null, wert: null });
    if (P.phase === "warten") {
      P.phase = "setzen"; P.endet = G.tick + 15; P.board = []; P.pot = P.einsatz;
      io.emit("notice", { text: `\u{1F0A1} ${p.name} eröffnet einen Poker-Tisch (Grundeinsatz ${P.einsatz} $) — wer setzt sich dazu? (15 s)` });
    }
    ack?.({ ok: true });
  }));

  socket.on("gpokerZug", guard((p, { aktion }, ack) => {
    const P = G.gpoker;
    if (MODE !== "kartell" || P.phase !== "wetten") return ack?.({ error: "Gerade wird nicht gesetzt" });
    const s = P.spieler[P.dran];
    if (!s || s.pid !== p.id) return ack?.({ error: "Du bist nicht an der Reihe" });
    ack?.(gpokerAktion(p, s, aktion));
  }));

  /* --- Patenwahl: kandidieren, versprechen, abstimmen --- */
  socket.on("pateKandidieren", guard((p, _x, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    const W = G.pateWahl;
    if (W.phase !== "kandidatur") return ack?.({ error: "Gerade nimmt niemand Kandidaturen an" });
    if (!p.familie || p.familie === "polizei") return ack?.({ error: "Die Questura kandidiert nicht" });
    if (famBoss(p.familie) !== p.id) return ack?.({ error: "Nur das Oberhaupt einer Familie darf kandidieren — rede mit deinem Boss (oder stürze ihn)" });
    if (W.kandidaten.some(k => k.pid === p.id)) return ack?.({ error: "Du stehst schon auf der Liste" });
    W.kandidaten.push({ pid: p.id, name: p.name, familie: p.familie, versprechen: null });
    io.emit("notice", { text: `\u{1F3A9} ${p.name} (${FAMILIEN[p.familie].name}) kandidiert für das Amt des Paten.` });
    ack?.({ ok: true });
  }));

  socket.on("pateVersprechen", guard((p, { art }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    const W = G.pateWahl;
    if (W.phase !== "versprechen") return ack?.({ error: "Jetzt ist nicht die Zeit für große Worte" });
    const k = W.kandidaten.find(k2 => k2.pid === p.id);
    if (!k) return ack?.({ error: "Nur Kandidaten geben Versprechen ab" });
    if (!PATE_DEKRETE[art]) return ack?.({ error: "Dieses Versprechen kennt niemand" });
    k.versprechen = art;
    io.emit("notice", { text: `\u{1F4DC} ${p.name} verspricht: „${PATE_DEKRETE[art].name}“ — ${PATE_DEKRETE[art].text}` });
    ack?.({ ok: true });
  }));

  socket.on("patenStimme", guard((p, { kandidat }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    const W = G.pateWahl;
    if (W.phase !== "wahl" && W.phase !== "stichwahl") return ack?.({ error: "Gerade läuft keine Abstimmung" });
    if (!p.familie || p.familie === "polizei") return ack?.({ error: "Die Questura wählt keinen Paten" });
    if (!W.kandidaten.some(k => k.pid === kandidat)) return ack?.({ error: "Der steht nicht auf dem Zettel" });
    if (W.stich && !W.stich.includes(kandidat)) return ack?.({ error: "In der Stichwahl stehen nur noch zwei zur Wahl" });
    W.stimmen[p.id] = kandidat;
    ack?.({ ok: true });
  }));

  /* --- Familienhaus: Ränge, Tribut, Kasse, Soldaten --- */
  socket.on("famRang", guard((p, { pid, rang }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (famBoss(p.familie) !== p.id) return ack?.({ error: "Ränge vergibt nur das Oberhaupt" });
    const ziel = G.players[pid];
    if (!ziel || ziel.familie !== p.familie) return ack?.({ error: "Der gehört nicht zu deiner Familie" });
    if (pid === p.id) return ack?.({ error: "Dich selbst befördern? Sehr souverän — nein." });
    if (rang === "oberhaupt") {
      G.familienBoss[p.familie] = pid;
      G.familienRang[p.id] = "capo";
      io.emit("notice", { text: `\u{1F396} Machtübergabe bei ${FAMILIEN[p.familie].name}: ${ziel.name} ist das neue Oberhaupt.` });
    } else if (rang === "capo" || rang === "rekrut") {
      G.familienRang[pid] = rang;
    } else return ack?.({ error: "Diesen Rang kennt die Familie nicht" });
    ack?.({ ok: true });
  }));

  socket.on("famTribut", guard((p, { satz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (famBoss(p.familie) !== p.id) return ack?.({ error: "Den Tribut setzt nur das Oberhaupt fest" });
    satz = +satz;
    if (![0, .05, .10, .15].includes(satz)) return ack?.({ error: "Tribut: 0, 5, 10 oder 15 %" });
    G.familienTribut[p.familie] = satz;
    io.emit("notice", { text: `\u{1F4B0} ${p.name} setzt den Tribut bei ${FAMILIEN[p.familie].name} auf ${Math.round(satz * 100)} % fest.` });
    ack?.({ ok: true });
  }));

  socket.on("famKasse", guard((p, { aktion }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    const fid = p.familie;
    if (!fid || fid === "polizei") return ack?.({ error: "Du gehörst keiner Familie an" });
    if (aktion === "einzahlen") {
      const betrag = Math.min(p.cash, 1000);
      if (betrag <= 0) return ack?.({ error: "Kein Bargeld" });
      p.cash -= betrag; G.familienBank[fid] += betrag;
      logTx(p, "Kartell", "Einzahlung in die Familienkasse", -betrag);
      return ack?.({ ok: true, text: `${betrag} $ eingezahlt.` });
    }
    if (famBoss(p.familie) !== p.id) return ack?.({ error: "An die Kasse darf nur das Oberhaupt" });
    if (aktion === "ausschuetten") {
      const teil = famAusschuetten(fid);
      if (!teil) return ack?.({ error: "Die Kasse ist praktisch leer" });
      return ack?.({ ok: true, text: `Ausgeschüttet: ${teil} $ an jedes Mitglied.` });
    }
    if (aktion === "einsacken") {
      const betrag = Math.floor(G.familienBank[fid]);
      if (betrag <= 0) return ack?.({ error: "Die Kasse ist leer" });
      G.familienBank[fid] = 0;
      p.cash += betrag;
      logTx(p, "Kartell", "Familienkasse geleert — der Boss bedient sich", betrag);
      G.familienRespekt[fid] = Math.max(0, (G.familienRespekt[fid] || 0) - 2);
      io.emit("notice", { text: `\u{1F911} ${p.name} leert die Kasse von ${FAMILIEN[fid].name} (−2 Respekt — die Rekruten murren).` });
      return ack?.({ ok: true, text: `${betrag} $ in die eigene Tasche.` });
    }
    if (aktion === "soldat") {
      if (G.soldaten[fid] >= SOLDATEN_MAX) return ack?.({ error: `Mehr als ${SOLDATEN_MAX} Soldaten hält keine Familie` });
      if (!famSoldatKaufen(fid)) return ack?.({ error: `Ein Soldat kostet ${SOLDAT_KOSTEN} $ aus der Kasse` });
      return ack?.({ ok: true, text: `Soldat angeheuert (${G.soldaten[fid]}/${SOLDATEN_MAX}).` });
    }
    ack?.({ error: "Diese Kassen-Aktion gibt es nicht" });
  }));

  /* --- Wahrzeichen: ein interaktives Gebäude je Bezirk --- */
  socket.on("wahrzeichen", guard((p, payload, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    ack?.(wzAktion(p, payload || {}));
  }));

  socket.on("gcasinoQuote", guard((p, { quote }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (!GCASINO_QUOTEN[quote]) return ack?.({ error: "Diese Quote kennt das Haus nicht" });
    if (p.familie !== gcasinoHerrscher()) return ack?.({ error: "Die Quoten stellt nur die Familie ein, die die Piazza hält" });
    G.gcasino.quote = quote;
    io.emit("notice", { text: `🎰 ${famDef(p.familie).name} stellt im Casino ${GCASINO_QUOTEN[quote].name} ein.` });
    ack?.({ ok: true });
  }));

  socket.on("gcasinoUpgrade", guard((p, _x, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (p.familie !== gcasinoHerrscher()) return ack?.({ error: "Ausbauen darf nur die Familie, die die Piazza hält" });
    if (G.gcasino.stufe >= 5) return ack?.({ error: "„La Dorata“ ist die höchste Ausbaustufe — prunkvoller geht es nicht" });
    const kosten = 4000 * G.gcasino.stufe;
    if (p.cash < kosten) return ack?.({ error: `Der Ausbau kostet ${kosten} $` });
    p.cash -= kosten;
    G.gcasino.stufe++;
    logTx(p, "Casino", `Casino ausgebaut: „${GCASINO_STILE[G.gcasino.stufe - 1]}“`, -kosten);
    gainXp(p, 25);
    io.emit("notice", { text: `🎰 Das Casino Municipale erstrahlt neu: Stil „${GCASINO_STILE[G.gcasino.stufe - 1]}“ (Stufe ${G.gcasino.stufe}) — mehr Bürger, mehr Umsatz. Achtung: Der Ausbau bleibt, auch wenn die Piazza den Herrn wechselt.` });
    ack?.({ ok: true, stufe: G.gcasino.stufe });
  }));

  socket.on("gcasinoVerkauf", guard((p, { good, qty }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Nur in der Kartellwirtschaft" });
    if (p.familie !== gcasinoHerrscher()) return ack?.({ error: "Unterm Tisch verkauft nur die Familie, die die Piazza hält" });
    if (!ILLEGAL.includes(good)) return ack?.({ error: "Das Volk will nur heiße Ware" });
    qty = Math.floor(+qty) || Math.floor(p.inv[good] || 0);
    qty = Math.min(qty, Math.floor(p.inv[good] || 0));
    if (qty <= 0) return ack?.({ error: `Kein ${GOODS[good].name} im Lager` });
    const erloes = Math.round(qty * BASEP[good] * GCASINO_SCHWARZPREIS);
    p.inv[good] -= qty;
    p.cash += erloes;
    G.familienRespekt[p.familie] = (G.familienRespekt[p.familie] || 0) + Math.floor(erloes / 100);
    G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 2;
    logTx(p, "Casino", `${qty}× ${GOODS[good].name} unterm Tisch ans Volk (ohne Paten-Abgabe)`, erloes);
    questProg(p, "hehler");
    ack?.({ ok: true, erloes });
  }));

  /* --- Verstärkung: im laufenden Tauziehen Schläger in den Bezirk schicken --- */
  socket.on("verstaerkung", guard((p, { bezirk }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Verstärkung gibt es nur in der Kartellwirtschaft" });
    if (p.familie === "polizei") return ack?.({ error: "Die Polizei mischt sich nicht in Bandenkriege — sie beendet sie" });
    bezirk = Math.floor(+bezirk);
    const k = G.revierKaempfe?.[bezirk];
    if (!k) return ack?.({ error: "Dort kämpft gerade niemand" });
    if (k.punkte[p.familie] == null)
      return ack?.({ error: "Das ist nicht der Kampf deiner Familie — halt dich raus" });
    if ((p.verstCd || 0) > G.tick)
      return ack?.({ error: `Deine Schläger sind noch unterwegs — ${p.verstCd - G.tick} s` });
    if (p.cash < VERST_KOSTEN) return ack?.({ error: `Verstärkung kostet ${VERST_KOSTEN} $` });
    p.cash -= VERST_KOSTEN;
    p.verstCd = G.tick + VERST_CD;
    k.punkte[p.familie] += 1;
    logTx(p, "Kartell", `Verstärkung in den ${BEZIRK_NAMEN[bezirk]} geschickt`, -VERST_KOSTEN);
    ack?.({ ok: true, punkte: k.punkte });
  }));

  /* --- Straßensperre: Revier markieren --- */
  socket.on("sperreBauen", guard((p, { x, y }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Sperren gibt es nur in der Kartellwirtschaft" });
    if (p.familie === "polizei") return ack?.({ error: "Die Polizei baut keine Barrikaden" });
    if (!p.familie) return ack?.({ error: "Ohne Familie sperrt man keine Straßen" });
    const t = G.map[y * MAP_W + x];
    if (!t?.road) return ack?.({ error: "Sperren stehen nur auf Straßen" });
    if (t.sperre) return ack?.({ error: "Hier steht schon eine Sperre" });
    /* Limit je SPIELER, nicht je Familie: Mit Bots als Familienmitgliedern
     * war das Familien-Kontingent sonst belegt, bevor ein Mensch klickte. */
    const aktive = G.map.filter(t2 => t2.sperre?.von === p.id).length;
    if (aktive >= SPERRE_MAX_JE_FAMILIE)
      return ack?.({ error: `Du hältst schon ${SPERRE_MAX_JE_FAMILIE} Sperren — mehr Leute hast du nicht` });
    if (p.cash < SPERRE_KOSTEN) return ack?.({ error: `Zu wenig Bargeld (${SPERRE_KOSTEN} $)` });
    p.cash -= SPERRE_KOSTEN;
    t.sperre = { familie: p.familie, von: p.id, bis: G.tick + SPERRE_DAUER };
    kampfPunkte(bezirkVon(x, y), p.familie, 2);   // Tauziehen: Sperre zeigt Präsenz
    G.fahndung[p.familie] = (G.fahndung[p.familie] || 0) + 5;
    questProg(p, "sperre");
    logTx(p, "Kartell", `Straßensperre errichtet (${BEZIRK_NAMEN[bezirkVon(x, y)]})`, -SPERRE_KOSTEN);
    io.emit("notice", { text: `🚧 ${FAMILIEN[p.familie].name} sperrt eine Straße im ${BEZIRK_NAMEN[bezirkVon(x, y)]}.` });
    ack?.({ ok: true });
  }));

  /* --- Illegales Casino: 17+4 gegen die Kasse des Besitzers ---
   * Der Server hält die Hand, der Client zeigt sie nur an. Einsatz wird beim
   * Geben abgebucht; am Ende fließt Geld direkt zwischen Gast und Besitzer.
   * Klassische 17+4-Karten: 7, 8, 9, 10, Unter (2), Ober (3), König (4),
   * Ass (11) — Ziel 21, die Bank zieht bis 17 und gewinnt den Gleichstand. */
  const KARTEN = [{ w: 7, n: "7" }, { w: 8, n: "8" }, { w: 9, n: "9" }, { w: 10, n: "10" },
                  { w: 2, n: "U" }, { w: 3, n: "O" }, { w: 4, n: "K" }, { w: 11, n: "A" }];
  const karte = () => KARTEN[Math.floor(Math.random() * KARTEN.length)];
  const handWert = h => h.reduce((s, k) => s + k.w, 0);
  const casinoEnde = (p, gast) => {
    const sp = p.casinoSpiel; p.casinoSpiel = null;
    const owner = G.players[sp.ownerId];
    const wert = handWert(sp.hand);
    let bank = sp.bankHand || [];
    let status, auszahlung = 0;
    /* Zwei Asse aus der Hand sind das „Feuer“ — nach klassischer 17+4-Regel
     * ein sofortiger Sieg, kein Überkauf. */
    if (wert === 22 && sp.hand.length === 2) status = "gewonnen";
    else if (wert > 21) status = "verloren";
    else {
      while (handWert(bank) < 17) bank.push(karte());
      const bw = handWert(bank);
      if (bw > 21 || bw < wert) status = "gewonnen";
      else if (bw === wert) status = "push";
      else status = "verloren";
    }
    if (!owner) { p.cash += sp.einsatz; status = "push"; }   // Besitzer weg: Einsatz zurück
    else if (status === "gewonnen") {
      /* Einsatz zurück plus Gewinn aus der Kasse des Besitzers — mehr als der
       * Besitzer bar hat, kann der Tisch nicht auszahlen. */
      auszahlung = Math.min(sp.einsatz, Math.max(0, owner.cash));
      p.cash += sp.einsatz + auszahlung;
      owner.cash -= auszahlung;
      logTx(p, "Kartell", `Casino: 17+4 gewonnen (${wert} gegen ${handWert(bank)})`, auszahlung);
      logTx(owner, "Kartell", `Casino: ${p.name} sprengt den Tisch`, -auszahlung);
    } else if (status === "push") {
      p.cash += sp.einsatz;
    } else {
      owner.cash += sp.einsatz;
      owner.stats.umsatz = (owner.stats.umsatz || 0) + sp.einsatz;
      logTx(p, "Kartell", `Casino: 17+4 verloren (${wert > 21 ? "über 21" : wert + " gegen " + handWert(bank)})`, -sp.einsatz);
      logTx(owner, "Kartell", `Casino: das Haus gewinnt gegen ${p.name}`, sp.einsatz);
      if (owner.familie) G.familienRespekt[owner.familie] = (G.familienRespekt[owner.familie] || 0) + 2;
    }
    if (owner?.familie) G.fahndung[owner.familie] = (G.fahndung[owner.familie] || 0) + 2;
    return { status, hand: sp.hand, wert, bank, bankWert: handWert(bank), auszahlung, einsatz: sp.einsatz };
  };

  socket.on("casinoStart", guard((p, { x, y, einsatz }, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Casinos gibt es nur in der Kartellwirtschaft" });
    const t = G.map[y * MAP_W + x];
    if (!t || t.btype !== "casino") return ack?.({ error: "Hier steht kein Casino" });
    if (t.owner === p.id) return ack?.({ error: "Am eigenen Tisch spielt man nicht — das Haus gewinnt immer" });
    if (t.paused) return ack?.({ error: "Der Tisch ist gerade geschlossen" });
    if (p.casinoSpiel) return ack?.({ error: "Du sitzt schon an einem Tisch" });
    einsatz = Math.floor(+einsatz);
    if (!(einsatz >= 50 && einsatz <= 2000)) return ack?.({ error: "Einsatz zwischen 50 und 2.000 $" });
    if (p.cash < einsatz) return ack?.({ error: "Zu wenig Bargeld" });
    p.cash -= einsatz;
    p.casinoSpiel = { x, y, ownerId: t.owner, einsatz, hand: [karte(), karte()] };
    const wert = handWert(p.casinoSpiel.hand);
    /* 21 mit den ersten beiden Karten (oder das Feuer): sofort ausbezahlt. */
    if (wert >= 21) return ack?.(casinoEnde(p));
    ack?.({ status: "offen", hand: p.casinoSpiel.hand, wert, einsatz });
  }));

  socket.on("casinoZiehen", guard((p, _a, ack) => {
    const sp = p.casinoSpiel;
    if (!sp) return ack?.({ error: "Du sitzt an keinem Tisch" });
    sp.hand.push(karte());
    const wert = handWert(sp.hand);
    if (wert >= 21) return ack?.(casinoEnde(p));
    ack?.({ status: "offen", hand: sp.hand, wert, einsatz: sp.einsatz });
  }));

  socket.on("casinoHalten", guard((p, _a, ack) => {
    if (!p.casinoSpiel) return ack?.({ error: "Du sitzt an keinem Tisch" });
    ack?.(casinoEnde(p));
  }));

  /* --- Bestechung: die Fahndung abkühlen --- */
  socket.on("bestechen", guard((p, _a, ack) => {
    if (MODE !== "kartell") return ack?.({ error: "Bestechung gibt es nur in der Kartellwirtschaft" });
    if (!p.familie) return ack?.({ error: "Ohne Familie besticht man niemanden" });
    if ((G.fahndung[p.familie] || 0) <= 0) return ack?.({ error: "Nach euch fahndet gerade niemand" });
    if (p.cash < BESTECHUNG_KOSTEN) return ack?.({ error: `Zu wenig Bargeld (${BESTECHUNG_KOSTEN} $)` });
    p.cash -= BESTECHUNG_KOSTEN;
    G.fahndung[p.familie] = Math.max(0, (G.fahndung[p.familie] || 0) - 25);
    logTx(p, "Kartell", "Beamte bestochen — die Fahndung kühlt ab", -BESTECHUNG_KOSTEN);
    ack?.({ ok: true, fahndung: Math.round(G.fahndung[p.familie]) });
  }));

  socket.on("kartellGruenden", guard((p, { name }, ack) => {
    if (!kartellModus(ack)) return;
    if (kartellVon(p)) return ack?.({ error: "Du bist schon in einem Kartell" });
    /* Wie beim Firmennamen: erst kürzen, dann entschärfen. Der Kartellname geht
     * an alle Clients und landet dort in Mitgliederlisten — ungefiltert wäre er
     * der direkte Weg, jedem Mitspieler eigenes Markup unterzuschieben. */
    name = sicherText(String(name || "").trim().slice(0, KARTELL_NAME_MAX));
    if (name.length < 3) return ack?.({ error: "Name zu kurz (mindestens 3 Zeichen)" });
    if (G.cartels.some(k => k.name.toLowerCase() === name.toLowerCase()))
      return ack?.({ error: "Diesen Namen gibt es schon" });
    const k = { id: id(), name, kopfId: p.id, mitglieder: [p.id], einladungen: [],
      minPreise: {}, verdacht: 0, ermittlung: null, umsatz: {}, gegruendet: G.tick };
    G.cartels.push(k);
    logTx(p, "Kartell", `Kartell „${name}“ gegründet`, 0);
    /* Die Gründung ist öffentlich: Ein Zusammenschluss lässt sich nicht
     * verbergen, nur das, was drinnen besprochen wird. */
    io.emit("notice", { text: `${p.name} gründet das Kartell „${name}“.` });
    ack?.({ ok: true, kartellId: k.id });
  }));

  socket.on("kartellEinladen", guard((p, { toId }, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellVon(p);
    if (!k) return ack?.({ error: "Du bist in keinem Kartell" });
    if (k.kopfId !== p.id) return ack?.({ error: "Nur der Kopf des Kartells lädt ein" });
    const ziel = G.players[toId];
    if (!ziel || ziel.id === p.id) return ack?.({ error: "Unbekannter Spieler" });
    if (k.mitglieder.length >= KARTELL_MAX) return ack?.({ error: `Höchstens ${KARTELL_MAX} Mitglieder` });
    if (kartellVon(ziel)) return ack?.({ error: `${ziel.name} ist schon in einem Kartell` });
    if (k.einladungen.includes(ziel.id)) return ack?.({ error: "Einladung läuft bereits" });
    k.einladungen.push(ziel.id);
    /* Die Einladung geht privat raus — wer sie bekommt, soll selbst entscheiden
     * können, ohne dass der Rest der Stadt zusieht. */
    emitTo(ziel.id, "notice", { text: `${p.name} lädt dich ins Kartell „${k.name}“ ein.` });
    ack?.({ ok: true });
  }));

  socket.on("kartellBeitreten", guard((p, { kartellId }, ack) => {
    if (!kartellModus(ack)) return;
    if (kartellVon(p)) return ack?.({ error: "Du bist schon in einem Kartell" });
    const k = kartellFinden(kartellId);
    if (!k) return ack?.({ error: "Kartell gibt es nicht mehr" });
    if (!k.einladungen.includes(p.id)) return ack?.({ error: "Ohne Einladung geht das nicht" });
    /* Zwischen Einladung und Beitritt kann das Kartell vollgelaufen sein — die
     * Einladung allein garantiert keinen Platz. */
    if (k.mitglieder.length >= KARTELL_MAX) {
      k.einladungen = k.einladungen.filter(mid => mid !== p.id);
      return ack?.({ error: "Das Kartell ist inzwischen voll" });
    }
    k.einladungen = k.einladungen.filter(mid => mid !== p.id);
    k.mitglieder.push(p.id);
    logTx(p, "Kartell", `Kartell „${k.name}“ beigetreten`, 0);
    io.emit("notice", { text: `${p.name} gehört jetzt zum Kartell „${k.name}“.` });
    ack?.({ ok: true });
  }));

  socket.on("kartellAblehnen", guard((p, { kartellId }, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellFinden(kartellId);
    if (!k) return ack?.({ ok: true });          // schon weg — für den Ablehnenden dasselbe Ergebnis
    k.einladungen = k.einladungen.filter(mid => mid !== p.id);
    emitTo(k.kopfId, "notice", { text: `${p.name} lehnt die Einladung ins Kartell „${k.name}“ ab.` });
    ack?.({ ok: true });
  }));

  socket.on("kartellVerlassen", guard((p, _payload, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellVon(p);
    if (!k) return ack?.({ error: "Du bist in keinem Kartell" });
    kartellVerlassen(p);
    logTx(p, "Kartell", `Kartell „${k.name}“ verlassen`, 0);
    io.emit("notice", { text: `${p.name} verlässt das Kartell „${k.name}“.` });
    ack?.({ ok: true });
  }));

  /* --- Kartellmodus: Preisabsprache ---
   * Wie beim Einladen entscheidet der Kopf. Eine Abstimmung unter Mitgliedern
   * klänge demokratischer, brächte aber nur eine Warteschlange offener
   * Vorschläge — die Spannung des Modus liegt nicht in der Beschlussfassung,
   * sondern darin, ob sich alle daran halten. */
  socket.on("kartellPreisSetzen", guard((p, { good, price }, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellVon(p);
    if (!k) return ack?.({ error: "Du bist in keinem Kartell" });
    if (k.kopfId !== p.id) return ack?.({ error: "Nur der Kopf des Kartells legt Preise fest" });
    if (!GOODS[good]) return ack?.({ error: "Unbekannte Ware" });
    price = Math.round(+price * 100) / 100;
    if (!(price > 0) || !Number.isFinite(price)) return ack?.({ error: "Preis > 0 nötig" });
    k.minPreise[good] = price;
    const angehoben = kartellLaedenAngleichen(k, good, price);
    /* Die Absprache bleibt unter den Mitgliedern — nach außen sieht man nur die
     * Preise, die sich daraus ergeben, nicht die Abmachung selbst. */
    for (const mid of k.mitglieder) {
      emitTo(mid, "notice", { text: `Kartellabsprache: ${GOODS[good].name} ab sofort nicht unter ${price} $` +
        (angehoben ? ` — ${angehoben} Ladenpreis${angehoben === 1 ? "" : "e"} angehoben.` : ".") });
    }
    logTx(p, "Kartell", `Mindestpreis ${GOODS[good].name}: ${price} $`, 0);
    ack?.({ ok: true });
  }));

  /* --- Kronzeugenregelung ---
   * Der Zug, der aus der Absprache ein Misstrauensspiel macht: Jedes Mitglied
   * kann das eigene Kartell anzeigen, auch der Kopf. Wer anzeigt, geht
   * straffrei aus und behaelt, was er unter der Absprache verdient hat — die
   * uebrigen zahlen den hoeheren Satz.
   *
   * Moeglich, solange eine Absprache laeuft, also auch vorbeugend, bevor
   * ueberhaupt Verdacht besteht. Damit haengt die Drohung dauerhaft ueber jeder
   * Absprache und nicht erst in den Minuten vor einem Bescheid.
   *
   * Der Kronzeuge verlaesst das Kartell dabei. In einem Kartell zu bleiben, das
   * man gerade verraten hat, waere unglaubwuerdig — und die anderen wissen es
   * ohnehin, der Name steht in der Meldung. */
  socket.on("kartellAnzeigen", guard((p, _payload, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellVon(p);
    if (!k) return ack?.({ error: "Du bist in keinem Kartell" });
    /* Ohne laufende Absprache gibt es nichts anzuzeigen — ein Zusammenschluss
     * allein ist nicht verboten. */
    if (!Object.keys(k.minPreise).length)
      return ack?.({ error: "Ohne laufende Preisabsprache gibt es nichts anzuzeigen" });

    emitTo(p.id, "notice", { text: `Du hast „${k.name}“ angezeigt — für dich bleibt es folgenlos.` });
    /* Erst den Bescheid, dann den Austritt: Der Bescheid geht die
     * Mitgliederliste durch, und der Kronzeuge muss darin noch vorkommen,
     * damit er als straffrei ausgewiesen wird statt einfach zu fehlen. */
    kartellBescheid(k, p.id);
    kartellVerlassen(p);
    logTx(p, "Kartell", `Kartell „${k.name}“ angezeigt und verlassen`, 0);
    ack?.({ ok: true });
  }));

  socket.on("kartellPreisAufheben", guard((p, { good }, ack) => {
    if (!kartellModus(ack)) return;
    const k = kartellVon(p);
    if (!k) return ack?.({ error: "Du bist in keinem Kartell" });
    if (k.kopfId !== p.id) return ack?.({ error: "Nur der Kopf des Kartells legt Preise fest" });
    if (k.minPreise[good] == null) return ack?.({ error: "Für diese Ware gibt es keine Absprache" });
    delete k.minPreise[good];
    for (const mid of k.mitglieder) {
      emitTo(mid, "notice", { text: `Kartellabsprache für ${GOODS[good].name} aufgehoben.` });
    }
    ack?.({ ok: true });
  }));

  /* --- Karte: Bauen (schaltet gesperrte Kacheln atomar mit frei) / Abriss --- */
  socket.on("build", guard((p, { x, y, btype }, ack) => {
    const t = tileAt(x, y), bt = BTYPES[btype];
    if (!t || !bt) return ack?.({ error: "Ungültig" });
    if (t.water || t.road || t.park || t.piazza || t.pier || t.leuchtturm || t.questura || t.gcasino || t.wz || t.famhaus) return ack?.({ error: "Nicht bebaubar" });
    if (t.bank) return ack?.({ error: "Die Stadtbank gehört der Stadt" });
    if (t.news) return ack?.({ error: "Die Nachrichtenzentrale gehört der Stadt" });
    if (t.finanzamt) return ack?.({ error: "Das Finanzamt gehört der Stadt" });
    if (t.denkmal) return ack?.({ error: "Hier steht ein Stadtprojekt" });
    if (t.deko) return ack?.({ error: "Das Hochhaus gehört der Stadt" });
    if (t.schwarz) return ack?.({ error: "Hier wird nur unter der Hand gehandelt" });
    if (t.owner) return ack?.({ error: "Kachel bereits belegt" });
    if (bt.zone !== t.zone) return ack?.({ error: `Nur in Zone ${bt.zone} baubar` });
    /* Verkauft wird nur noch über den Online-Marktplatz. Die alten Läden
     * bleiben als Gebäudetyp bestehen (Lexikon, alte Spielstände), lassen
     * sich aber nicht mehr neu bauen. */
    if (bt.retail && !bt.online)
      return ack?.({ error: `${bt.name} gibt es nicht mehr — verkauft wird nur noch über den Online-Marktplatz` });
    /* Regel 2: Im Sandbox-Modus ersetzt das Werbemodul der Shop-Systeme die
     * Werbeagentur. Im Renntag (Race Club) und den übrigen Modi bleibt sie. */
    if (bt.ad && MODE === "sandbox")
      return ack?.({ error: "Werbung läuft hier über das Werbemodul eines Shop-Systems — baue einen Online-Marktplatz" });
    /* Rennreifen kann sonst nur die Rohstoffbranche herstellen, Rennsoftware
     * nur die Technikbranche. Spielt niemand diese Branchen, gibt es die Teile
     * im ganzen Spiel nicht — dann laesst sich kein Wagen tunen und kein
     * Teile-Sponsorgesuch erfuellen. Im Renntag-Modus, wo genau das der Kern
     * ist, darf sie deshalb jede Branche bauen — wie Laeden und Rennstall. */
    if (MODE === "renntag") {
      /* Im Renntag zaehlt die Rolle, nicht die Branche — und Laeden gibt es
       * hier nicht. Es produziert niemand mehr Konsumgueter, die Regale
       * blieben leer. Gehandelt wird ausschliesslich ueber die Boerse: die
       * Rennindustrie stellt Teile ein, die Clubs kaufen sie dort. */
      const erlaubt = RENNTAG_BAUTEN[p.industry];
      if (!(erlaubt && erlaubt.has(btype)))
        return ack?.({ error: bt.retail
          ? "Im Race Day gibt es keine Läden — gehandelt wird über die Börse"
          : p.industry === "rennclub"
            ? "Als Race Club baust du Rennstall und Werbung — Teile kaufst du an der Börse bei der Rennindustrie"
            : "Als Rennindustrie baust du die Zulieferkette und die Teile-Werke — gefahren wird im Race Club" });
    } else if (MODE !== "kartell" && bt.industry && !(p.industries || [p.industry]).includes(bt.industry)) {
      /* Kartellmodus: Familien bauen branchenfrei — Bezirkskontrolle zählt
       * Gebäude, die Industrie-Sperre gilt nur in der normalen Wirtschaft. */
      return ack?.({ error: `Nur ${INDUSTRIES[bt.industry].name} kann das bauen` });
    }
    /* Der Rennstall ist branchenfrei, aber auf einen je Firma begrenzt: Ohne
     * diese Grenze wäre "mehr Ställe" die beste Strategie, und der Wettpool
     * gehörte am Ende dem, der am meisten Kacheln hält. */
    /* Familien-Gebäude: nur im Kartellmodus, nur von der eigenen Familie. */
    if (bt.familie) {
      if (MODE !== "kartell") return ack?.({ error: "Solche Geschäfte gibt es nur in der Kartellwirtschaft" });
      if (p.familie !== bt.familie)
        return ack?.({ error: `${FAMILIEN[bt.familie].name} lässt sich nicht in die Karten schauen — nur ihre Mitglieder bauen ${bt.name}` });
    }
    if (bt.casino && MODE !== "kartell")
      return ack?.({ error: "Solche Etablissements gibt es nur in der Kartellwirtschaft" });
    if (bt.racing) {
      /* Planwirtschaft und Kartellmodus: keine Renntage, kein Wettpool — ein
       * Rennstall wäre ein totes Gebäude mit laufenden Fahrergehältern. */
      if (MODE === "plan")
        return ack?.({ error: "In der Planwirtschaft gibt es keinen Motorsport" });
      if (MODE === "kartell")
        return ack?.({ error: "In der Kartellwirtschaft gibt es keinen Motorsport — hier zählen die Warenmärkte" });
      const nw = netWorth(p);
      if (MODE !== "renntag" && nw < RACING_UNLOCK_NW)
        return ack?.({ error: `Motorsport öffnet ab ${RACING_UNLOCK_NW.toLocaleString("de-DE")} $ Nettovermögen — dir fehlen noch ${Math.round(RACING_UNLOCK_NW - nw).toLocaleString("de-DE")} $` });
      if (G.map.some(o => o.owner === p.id && BTYPES[o.btype]?.racing))
        return ack?.({ error: "Du betreibst bereits einen Rennstall — mehr als einer ist nicht erlaubt" });
    }
    /* Freischalten + Bauen in einem atomaren Schritt (kein Zeitfenster,
     * in dem eine gesperrte Kachel für andere sichtbar frei würde). */
    const unlockCost = t.locked ? t.unlockCost : 0;
    if (p.cash < bt.cost + unlockCost) return ack?.({ error: "Zu wenig Kapital" });
    /* Baumaterial prüfen & verbrauchen (kommt von der Bauindustrie via Börse) */
    const mats = matCost(bt);
    const missing = Object.entries(mats).filter(([g, n]) => p.inv[g] < n);
    if (missing.length) return ack?.({ error: "Baumaterial fehlt: " +
      missing.map(([g, n]) => `${Math.ceil(n - p.inv[g])}× ${GOODS[g].name}`).join(", ") + " — an der Börse kaufen" });
    const matWert = Object.entries(mats).reduce((a, [g, n]) => a + n * MM[g].price, 0);
    for (const [g, n] of Object.entries(mats)) p.inv[g] -= n;
    if (t.locked) { t.locked = false; gainXp(p, 30); }
    if (MODE === "kartell" && p.familie) kampfPunkte(bezirkVon(x, y), p.familie, 2);   // Tauziehen
    if (bt.out || bt.proc) questProg(p, "build");
    if (bt.familie) questProg(p, "familiebau");
    p.cash -= bt.cost + unlockCost; t.owner = p.id; t.btype = btype; t.level = 1; gainXp(p, 20);
    /* Geld und Material werden zur Anlage — der Buchwert bleibt gleich. Während
     * der Bauzeit ist es eine "Anlage in Arbeit" und produziert noch nichts. */
    t.anlagewert = bt.cost + unlockCost + matWert;
    t.bauBis = G.tick + MARKT.BAU_DAUER;
    p.stats.gebaut++; p.stats.ausgaben += bt.cost + unlockCost;
    investieren(p, bt.cost + unlockCost);
    marktLog("bau", `${p.name} baut ${bt.name}`, { firmaId: p.id, betrag: Math.round(t.anlagewert) });
    if (bt.retail) t.shop = Array.from({ length: bt.retail.slots }, () => null);
    logTx(p, "Bau", `${bt.name} gebaut${unlockCost ? " (inkl. Freischaltung)" : ""}`, -(bt.cost + unlockCost));
    ack?.({ ok: true });
  }));

  /* --- Gebäude mit Elektronik aufleveln: +30 % Produktion je Stufe (max. Stufe 5) --- */
  socket.on("upgradeBuilding", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    /* Der Rennstall produziert nichts, wird aber ausgebaut — jede Stufe ist
     * ein zusätzlicher Stellplatz statt +30 % Ausstoß. */
    if (!t || t.owner !== p.id || !(bt?.out || bt?.proc || bt?.racing || bt?.fanhub || bt?.studio || bt?.rz || bt?.online))
      return ack?.({ error: "Kein eigenes Produktions- oder Rennstallgebäude" });
    const level = t.level || 1;
    if (level >= LEVEL_MAX) return ack?.({ error: `Bereits auf Höchststufe ${LEVEL_MAX}` });
    const cost = upgradeCost(bt, level);
    if (p.inv.elektronik < cost.elektronik) return ack?.({ error: `Zu wenig Elektronik (${cost.elektronik} nötig)` });
    if (p.cash < cost.cash) return ack?.({ error: "Zu wenig Kapital" });
    p.inv.elektronik -= cost.elektronik; p.cash -= cost.cash; t.level = level + 1; gainXp(p, 25);
    if (bt.online) (t.shop ??= []).push(null);   // Marktplatz: +1 Regal je Stufe
    t.anlagewert = anlageWert(t) + cost.cash + cost.elektronik * MM.elektronik.price;   // Ausbau erhöht die Anlage
    p.stats.aufgelevelt++; p.stats.ausgaben += cost.cash;
    investieren(p, cost.cash);
    questProg(p, "upgrade");
    logTx(p, "Ausbau", bt.racing
      ? `${bt.name} auf Stufe ${t.level} — jetzt ${stallKapazitaet(t.level)} Stellplätze`
      : `${bt.name} auf Stufe ${t.level} aufgelevelt`, -cost.cash);
    ack?.({ ok: true, level: t.level });
  }));

  /* --- Fahrzeug in den Rennstall einstellen ---
   * Der Kern der ganzen Erweiterung: Hier hört das Auto auf, eine Ware zu
   * sein. Es verlässt `p.inv` und wird Inventar DIESER Kachel. Damit gibt es
   * es an der Börse nicht mehr — verkaufen lässt sich danach nur noch der
   * ganze Stall über die Versteigerung an der Stadtbank. Einen Rückweg ins
   * Lager gibt es bewusst nicht; er wäre genau das Schlupfloch, das die
   * Regel verhindern soll. */
  socket.on("stallEinstellen", guard((p, { x, y, good }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !bt?.racing) return ack?.({ error: "Kein eigener Rennstall" });
    if (!VEHICLES.includes(good)) return ack?.({ error: "Nur Fahrzeuge können in den Rennstall" });
    if ((p.inv[good] || 0) < 1) return ack?.({ error: `Kein ${GOODS[good].name} im Lager — an der Börse kaufen` });
    const autos = t.autos ??= [];
    const kap = stallKapazitaet(t.level || 1);
    if (autos.length >= kap)
      return ack?.({ error: `Stufe ${t.level || 1}: ${kap} Stellplatz${kap === 1 ? "" : "e"} belegt — erst ausbauen` });
    p.inv[good] -= 1;
    const nr = ++autoNr;
    /* Historie ab Tag eins: Kaufwert (aktueller Kurs), Kilometer und alle
     * Tuningausgaben laufen hier zusammen — die Akte des Wagens. */
    const kaufpreis = Math.round(MM[good].price);
    autos.push({ id: id(), good, nr, zustand: 100, rennen: 0, siege: 0, tuning: {}, fahrerId: null,
      km: 0, kaufpreis, tuningAusgaben: 0, name: p.bot ? botWagenName(nr) : null,
      historie: [{ t: G.tick, text: "In den Rennstall eingestellt", amt: -kaufpreis }] });
    gainXp(p, 15);
    logTx(p, "Motorsport", `${GOODS[good].name} #${nr} in den Rennstall eingestellt`, 0);
    ack?.({ ok: true, nr });
  }));

  /* --- Fahrzeug entwickeln ---
   * Die Teile kommen aus dem eigenen Lager, also über die Börse von fremden
   * Betrieben. Jede Stufe kostet mehr als die vorige und bringt denselben
   * Zugewinn — der Grenznutzen sinkt damit von allein, ohne Sonderregel. */
  socket.on("stallTunen", guard((p, { x, y, autoId, bereich }, ack) => {
    if (process.env.DIAG) console.log(`[DIAG] stallTunen von ${p.name} (bot=${!!p.bot}) socket=${socket.id}`);
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !bt?.racing) return ack?.({ error: "Kein eigener Rennstall" });
    const a = (t.autos || []).find(a => a.id === autoId);
    if (!a) return ack?.({ error: "Fahrzeug nicht gefunden" });
    const T = TUNING[bereich];
    if (!T) return ack?.({ error: "Unbekannter Tuningbereich" });
    const stufe = (a.tuning[bereich] || 0) + 1;
    if (stufe > TUNING_MAX) return ack?.({ error: `${T.name} ist bereits auf Höchststufe ${TUNING_MAX}` });
    const k = tuningKosten(bereich, stufe);
    if (p.cash < k.cash) return ack?.({ error: `Zu wenig Kapital (${k.cash.toLocaleString("de-DE")} $ nötig)` });
    const fehlt = Object.entries(k.teile).filter(([g, n]) => (p.inv[g] || 0) < n);
    if (fehlt.length) return ack?.({ error: "Teile fehlen: " +
      fehlt.map(([g, n]) => `${Math.ceil(n - (p.inv[g] || 0))}× ${GOODS[g].name}`).join(", ") + " — an der Börse kaufen" });
    p.cash -= k.cash;
    for (const [g, n] of Object.entries(k.teile)) p.inv[g] -= n;
    a.tuning[bereich] = stufe;
    /* Fahrzeughistorie: jede Ausbaustufe mit ihren vollen Kosten (Geld + Teile
     * zum aktuellen Kurs) festhalten. */
    const teileWert = Object.entries(k.teile).reduce((s, [g, n]) => s + Math.round(MM[g].price * n), 0);
    a.tuningAusgaben = (a.tuningAusgaben || 0) + k.cash + teileWert;
    (a.historie ??= []).push({ t: G.tick, text: `${T.name} auf Stufe ${stufe}`, amt: -(k.cash + teileWert) });
    p.stats.ausgaben += k.cash;
    gainXp(p, 20);
    logTx(p, "Motorsport", `${autoName(a)}: ${T.name} auf Stufe ${stufe}`, -k.cash);
    ack?.({ ok: true, stufe, werte: autoWerte(a) });
  }));

  /* --- Fahrzeug instand setzen --- */
  socket.on("stallReparieren", guard((p, { x, y, autoId }, ack) => {
    if (process.env.DIAG) console.log(`[DIAG] stallReparieren von ${p.name} (bot=${!!p.bot}) socket=${socket.id}`);
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id || !BTYPES[t.btype]?.racing) return ack?.({ error: "Kein eigener Rennstall" });
    const a = (t.autos || []).find(a2 => a2.id === autoId);
    if (!a) return ack?.({ error: "Fahrzeug nicht gefunden" });
    if (a.zustand >= 100) return ack?.({ error: "Der Wagen ist in einwandfreiem Zustand" });
    /* Nicht schrauben, solange der Wagen gemeldet ist oder faehrt: Sein
     * Zustand geht in Tempo und Ausfallrisiko ein. In der Ergebnisphase ist
     * das Rennen dagegen vorbei — genau dann will man reparieren. */
    if (G.rennen && ["anmeldung", "laeuft"].includes(G.rennen.phase)
        && (G.rennen.teilnehmer || []).some(x2 => x2.autoId === a.id))
      return ack?.({ error: "Der Wagen ist zum Rennen gemeldet" });
    const k = reparaturKosten(a);
    if (p.cash < k.cash) return ack?.({ error: `Zu wenig Kapital (${k.cash.toLocaleString("de-DE")} $ nötig)` });
    const fehlt = Object.entries(k.teile).filter(([g, n]) => (p.inv[g] || 0) < n);
    if (fehlt.length) return ack?.({ error: "Teile fehlen: " +
      fehlt.map(([g, n]) => `${Math.ceil(n - (p.inv[g] || 0))}× ${GOODS[g].name}`).join(", ") + " — an der Börse kaufen" });
    p.cash -= k.cash;
    for (const [g, n] of Object.entries(k.teile)) p.inv[g] -= n;
    const teileWert = Object.entries(k.teile).reduce((s2, [g, n]) => s2 + Math.round(MM[g].price * n), 0);
    const vorher = a.zustand;
    a.zustand = 100;
    p.stats.ausgaben += k.cash;
    gainXp(p, 12);
    (a.historie ??= []).push({ t: G.tick, text: `Instandsetzung ${vorher} % → 100 %`, amt: -(k.cash + teileWert) });
    logTx(p, "Motorsport", `${autoName(a)} instand gesetzt (${vorher} % → 100 %)`, -k.cash);
    ack?.({ ok: true, zustand: 100 });
  }));

  /* --- Rennen: Anmeldung, Wetten, Sponsoring --- */
  socket.on("rennenAnmelden", guard((p, { x, y, autoId }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Gerade keine offene Anmeldung" });
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id || !BTYPES[t.btype]?.racing) return ack?.({ error: "Kein eigener Rennstall" });
    const a = (t.autos || []).find(a2 => a2.id === autoId);
    if (!a) return ack?.({ error: "Fahrzeug nicht gefunden" });
    /* Nicht nur "irgendeine Fahrer-ID", sondern ein Fahrer, der wirklich unter
     * Vertrag steht. Ein entlassener Fahrer hinterliess frueher seine ID im
     * Cockpit — der Wagen galt damit als besetzt und waere mit einem Phantom
     * am Steuer ins Rennen gegangen. */
    const cockpit = G.fahrer.find(x2 => x2.id === a.fahrerId && x2.teamId === p.id);
    if (!cockpit) { a.fahrerId = null; return ack?.({ error: "Ohne Fahrer kein Start — erst zuweisen" }); }
    if (a.zustand < 25) return ack?.({ error: "Der Wagen ist zu verschlissen (unter 25 %)" });
    if (r.teilnehmer.some(x2 => x2.autoId === a.id)) return ack?.({ error: "Schon angemeldet" });
    /* Werkswagen sind Platzhalter, keine Konkurrenz um Startplaetze: Sobald ein
     * Spieler meldet und das Feld schon die Sollgroesse hat, raeumt der
     * schwaechste Werkswagen. So bleibt das Feld bei fuenf Wagen und wird mit
     * jedem gemeldeten Stall menschlicher — erst wenn mehr Spieler starten
     * wollen, waechst es bis zum Maximum. */
    if (r.teilnehmer.length >= RENN_FELD_SOLL) botWeichen(r);
    if (r.teilnehmer.length >= RENN_FELD_MAX)
      return ack?.({ error: `Das Startfeld ist voll (${RENN_FELD_MAX} Wagen)` });
    /* Im Renntag kostet das Melden nichts: Teilnehmen ist dort der Zweck des
     * Modus, nicht eine Investition, die sich lohnen muss. */
    if (MODE !== "renntag") {
      if (p.cash < RENN_NENNGELD) return ack?.({ error: `Nenngeld fehlt (${RENN_NENNGELD.toLocaleString("de-DE")} $)` });
      p.cash -= RENN_NENNGELD;
    }
    const f = cockpit;
    /* Jede Startnummer bekommt eine eindeutige Lackierung — Teamfarben
     * kollidieren sonst (zwei blaue Teams = zwei ununterscheidbare Wagen). */
    const LIVREEN = ["#e74c3c", "#f5c542", "#2ecc71", "#3b9cf6", "#e67e22", "#b07cf7", "#1abc9c", "#eef2f7"];
    const livree = LIVREEN.find(c => !r.teilnehmer.some(x2 => x2.livree === c)) || p.color;
    r.teilnehmer.push({ autoId: a.id, fahrerId: a.fahrerId, ownerId: p.id, team: p.name, farbe: p.color, livree,
      name: autoName(a), fahrer: f?.name || "?", letztes: a.letztes || null,
      dist: 0, ausgefallen: false });
    /* Wer meldet, sucht einen Sponsor. Ein Team fragt entweder nach Geld oder
     * nach Teilen — Teile sind fuer den Sponsor oft der guenstigere Weg, weil
     * er sie selbst herstellen oder billiger einkaufen kann als der Rennstall. */
    /* Haben die Kontore schon eroeffnet, bekommt der neu gemeldete Wagen sofort
     * einen Grundeinsatz — sonst stuende er bis zum Start ohne Quote da. Die
     * Wellen holen Nachzuegler zwar nach, aber nach der letzten Welle meldet
     * sich sonst niemand mehr ein. */
    if (r.kontorWellen?.length) {
      const streu = WETTKONTORE.find(k => k.art === "streuung");
      r.wetten.push({ playerId: streu.id, autoId: a.id, betrag: 300 });
    }
    gesuchStellen(r, p);
    /* Betrag nur buchen, wenn er auch gezogen wurde — im Renntag ist das Melden
     * kostenlos, eine Buchung ueber -1.500 $ waere schlicht falsch. */
    logTx(p, "Motorsport", `Zum Rennen gemeldet: ${autoName(a)}`,
      MODE === "renntag" ? 0 : -RENN_NENNGELD);
    io.emit("notice", { text: `${p.name} meldet ${autoName(a)} (Fahrer: ${f?.name || "?"}) zum Rennen.` });
    ack?.({ ok: true });
  }));
  socket.on("wetteSetzen", guard((p, { autoId, betrag, art }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Wetten nur vor dem Start" });
    betrag = Math.floor(+betrag);
    if (!(betrag >= 100) || betrag > 20000) return ack?.({ error: "Einsatz zwischen 100 und 20.000 $" });
    if (!WETT_ARTEN.includes(art)) art = "sieg";
    const teil = r.teilnehmer.find(x2 => x2.autoId === autoId);
    if (!teil) return ack?.({ error: "Dieser Wagen ist nicht gemeldet" });
    if (teil.ownerId === p.id) return ack?.({ error: "Auf den eigenen Stall wettet man nicht" });
    if (p.cash < betrag) return ack?.({ error: "Zu wenig Geld" });
    p.cash -= betrag;
    r.wetten.push({ playerId: p.id, autoId, betrag, art });
    const artText = { sieg: "Sieg", podium: "Podium", ausfall: "Ausfall" }[art];
    logTx(p, "Motorsport", `Wette (${artText}): ${betrag.toLocaleString("de-DE")} $ auf ${teil.name}`, -betrag);
    ack?.({ ok: true });
  }));
  /* --- Boxenstopp: die eine Live-Entscheidung während des Rennens --- */
  socket.on("boxenstopp", guard((p, { autoId }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "laeuft") return ack?.({ error: "Kein laufendes Rennen" });
    const meine = r.teilnehmer.filter(t2 => t2.ownerId === p.id && !t2.bot);
    const teil = autoId != null ? meine.find(t2 => t2.autoId === autoId) : meine[0];
    if (!teil) return ack?.({ error: "Kein eigener Wagen im Rennen" });
    if (teil.ausgefallen) return ack?.({ error: "Der Wagen steht schon — da hilft keine Box mehr" });
    if (teil.boxe) return ack?.({ error: "Der Wagen ist bereits in der Box" });
    if ((teil.stopps || 0) >= BOX_MAX) return ack?.({ error: `Höchstens ${BOX_MAX} Boxenstopps je Rennen` });
    if (r.rest <= BOX_DAUER + 3) return ack?.({ error: "Zu spät — die Boxengasse ist zu" });
    boxenstoppStarten(r, teil);
    ack?.({ ok: true });
  }));

  socket.on("sponsern", guard((p, { teamId, betrag }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Sponsoring nur vor dem Start" });
    betrag = Math.floor(+betrag);
    if (!(betrag >= 500) || betrag > 50000) return ack?.({ error: "Sponsorsumme zwischen 500 und 50.000 $" });
    if (teamId === p.id) return ack?.({ error: "Sich selbst sponsern bringt nichts" });
    if (!r.teilnehmer.some(x2 => x2.ownerId === teamId)) return ack?.({ error: "Dieses Team ist nicht gemeldet" });
    const team = G.players[teamId];
    if (!team) return ack?.({ error: "Team nicht gefunden" });
    if (p.cash < betrag) return ack?.({ error: "Zu wenig Geld" });
    p.cash -= betrag;
    team.cash += betrag;
    r.sponsoren.push({ playerId: p.id, teamId, betrag, name: p.name });
    logTx(p, "Motorsport", `Sponsoring: ${betrag.toLocaleString("de-DE")} $ an ${team.name}`, -betrag);
    logTx(team, "Motorsport", `Sponsorgeld von ${p.name}`, betrag);
    io.emit("notice", { text: `${p.name} sponsert Team ${team.name} mit ${betrag.toLocaleString("de-DE")} $ — dafür fließt ein Teil des Preisgelds zurück.` });
    ack?.({ ok: true });
  }));

  /* --- Fahrer anheuern --- Gehalt läuft ab sofort jede Minute weiter. */
  socket.on("fahrerAnheuern", guard((p, { fahrerId }, ack) => {
    const f = G.fahrer.find(f => f.id === fahrerId);
    if (!f) return ack?.({ error: "Fahrer nicht gefunden" });
    if (f.teamId) return ack?.({ error: `${f.name} fährt bereits für ${G.players[f.teamId]?.name ?? "ein anderes Team"}` });
    if (!G.map.some(t => t.owner === p.id && BTYPES[t.btype]?.racing))
      return ack?.({ error: "Ohne Rennstall kein Fahrer" });
    /* Ein Monatsgehalt als Handgeld — sonst heuert man risikolos jeden an und
     * entlässt ihn, sobald es teuer wird. */
    if (p.cash < f.gehalt * 2) return ack?.({ error: `Handgeld und erstes Gehalt nötig (${(f.gehalt * 2).toLocaleString("de-DE")} $)` });
    p.cash -= f.gehalt;
    f.teamId = p.id;
    logTx(p, "Motorsport", `${f.name} verpflichtet (Handgeld)`, -f.gehalt);
    io.emit("notice", { text: `${p.name} verpflichtet ${f.name} — ${f.gehalt.toLocaleString("de-DE")} $ je Minute.` });
    ack?.({ ok: true });
  }));

  socket.on("fahrerEntlassen", guard((p, { fahrerId }, ack) => {
    const f = G.fahrer.find(f => f.id === fahrerId && f.teamId === p.id);
    if (!f) return ack?.({ error: "Nicht dein Fahrer" });
    f.teamId = null; f.autoId = null;
    /* Auch das Cockpit raeumen: Sonst zeigt der Wagen weiter auf einen Fahrer,
     * der nicht mehr im Team ist — er gilt als besetzt, waehrend die Auswahl
     * "kein Fahrer" anzeigt. */
    for (const tt of G.map) for (const aa of tt.autos || []) if (aa.fahrerId === f.id) aa.fahrerId = null;
    logTx(p, "Motorsport", `${f.name} entlassen`, 0);
    ack?.({ ok: true });
  }));

  /* Zuweisung: ein Fahrer sitzt in höchstens einem Wagen, ein Wagen hat
   * höchstens einen Fahrer. Beide Richtungen werden hier gelöst. */
  socket.on("fahrerZuweisen", guard((p, { fahrerId, autoId }, ack) => {
    const f = G.fahrer.find(f => f.id === fahrerId && f.teamId === p.id);
    if (!f) return ack?.({ error: "Nicht dein Fahrer" });
    if (autoId == null) { f.autoId = null; return ack?.({ ok: true }); }
    const t = G.map.find(t => t.owner === p.id && (t.autos || []).some(a => a.id === autoId));
    const a = t && t.autos.find(a => a.id === autoId);
    if (!a) return ack?.({ error: "Fahrzeug nicht gefunden" });
    for (const o of G.fahrer) if (o.teamId === p.id && o.autoId === autoId) o.autoId = null;
    for (const tt of G.map) for (const aa of tt.autos || []) if (aa.fahrerId === f.id) aa.fahrerId = null;
    f.autoId = autoId; a.fahrerId = f.id;
    logTx(p, "Motorsport", `${f.name} sitzt jetzt in ${autoName(a)}`, 0);
    ack?.({ ok: true });
  }));

  /* --- Wagen umbenennen ---
   * Ein eigener Name statt "Benzin-Auto #2". Leerer Name setzt auf die
   * Vorgabe zurueck. Wie Spielernamen beim Speichern maskiert, damit im
   * Client nichts ausbrechen kann. */
  socket.on("autoUmbenennen", guard((p, { x, y, autoId, name }, ack) => {
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id || !BTYPES[t.btype]?.racing) return ack?.({ error: "Kein eigener Rennstall" });
    const a = (t.autos || []).find(a2 => a2.id === autoId);
    if (!a) return ack?.({ error: "Fahrzeug nicht gefunden" });
    const neu = sicherText(String(name || "").trim().slice(0, 24));
    a.name = neu || null;
    logTx(p, "Motorsport", neu ? `Wagen umbenannt: ${neu}` : `Wagenname zurueckgesetzt (${autoName(a)})`, 0);
    ack?.({ ok: true, name: a.name });
  }));

  /* --- Eigenes Sponsorgesuch aufgeben ---
   * Bisher wuerfelte der Server beim Melden ein Gesuch. Wer weiss, was ihm
   * fehlt, soll es selbst sagen duerfen — ein bestehendes wird dabei ersetzt,
   * es bleibt bei einem Gesuch je Team. */
  socket.on("gesuchAufgeben", guard((p, { art, menge }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Nur waehrend der Anmeldung" });
    if (!r.teilnehmer.some(t2 => t2.ownerId === p.id))
      return ack?.({ error: "Erst einen Wagen melden, dann Sponsoren suchen" });
    if (!GESUCH_ARTEN.includes(art)) return ack?.({ error: "Unbekannte Art" });
    menge = Math.floor(+menge);
    if (art === "geld") {
      if (!(menge >= 1000) || menge > 20000) return ack?.({ error: "Zwischen 1.000 und 20.000 $" });
    } else if (!(menge >= 1) || menge > 10) return ack?.({ error: "Zwischen 1 und 10 Stück" });
    r.gesuche = (r.gesuche || []).filter(g => g.teamId !== p.id);
    r.gesuche.push(art === "geld"
      ? { id: id(), teamId: p.id, team: p.name, art, betrag: menge, wert: menge }
      : { id: id(), teamId: p.id, team: p.name, art, menge, wert: Math.round(menge * MM[art].price) });
    io.emit("notice", { text: `${p.name} sucht Sponsoren: ${art === "geld"
      ? menge.toLocaleString("de-DE") + " $" : menge + "× " + GOODS[art].name}.` });
    ack?.({ ok: true });
  }));

  /* --- Sponsorgesuch erfuellen --- */
  socket.on("gesuchErfuellen", guard((p, { gesuchId }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Sponsoring nur vor dem Start" });
    const g = (r.gesuche || []).find(x2 => x2.id === gesuchId);
    if (!g) return ack?.({ error: "Dieses Gesuch gibt es nicht mehr" });
    if (g.teamId === p.id) return ack?.({ error: "Das eigene Team sponsert man nicht" });
    const team = G.players[g.teamId];
    if (!team) return ack?.({ error: "Team nicht gefunden" });
    if (g.art === "geld") {
      if (p.cash < g.betrag) return ack?.({ error: `Dir fehlen ${Math.ceil(g.betrag - p.cash).toLocaleString("de-DE")} $` });
      p.cash -= g.betrag; team.cash += g.betrag;
    } else {
      if ((p.inv[g.art] || 0) < g.menge)
        return ack?.({ error: `Du hast nur ${p.inv[g.art] || 0}× ${GOODS[g.art].name}, gebraucht werden ${g.menge}` });
      p.inv[g.art] -= g.menge;
      team.inv[g.art] = (team.inv[g.art] || 0) + g.menge;
    }
    const was = g.art === "geld" ? `${g.betrag.toLocaleString("de-DE")} $`
                                 : `${g.menge}× ${GOODS[g.art].name}`;
    r.sponsoren.push({ playerId: p.id, teamId: g.teamId, betrag: g.wert, name: p.name, was });
    r.gesuche = r.gesuche.filter(x2 => x2.id !== g.id);
    logTx(p, "Motorsport", `Sponsoring an ${team.name}: ${was}`, g.art === "geld" ? -g.betrag : 0);
    logTx(team, "Motorsport", `Sponsor ${p.name}: ${was}`, g.art === "geld" ? g.betrag : 0);
    io.emit("notice", { text: `${p.name} erfüllt das Sponsorgesuch von ${team.name} (${was}).` });
    ack?.({ ok: true });
  }));

  socket.on("demolish", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id) return ack?.({ error: "Nicht dein Gebäude" });
    if (t.lien) return ack?.({ error: "Pfandrecht aktiv — Verkauf gesperrt" });
    /* Ein Rennstall mit Fahrzeugen darf nicht abgerissen werden. Der Abriss
     * zahlt die halben BAUKOSTEN — die Autos darin wären ersatzlos weg, und
     * wer aussteigen will, hätte damit einen Weg an der Versteigerung vorbei.
     * Genau die soll aber der einzige Ausgang sein. */
    if (t.autos?.length)
      return ack?.({ error: t.autos.length === 1
        ? "Im Rennstall steht ein Fahrzeug — nur der ganze Stall lässt sich an der Stadtbank versteigern"
        : `Im Rennstall stehen ${t.autos.length} Fahrzeuge — nur der ganze Stall lässt sich an der Stadtbank versteigern` });
    p.cash += BTYPES[t.btype].cost * 0.5;
    logTx(p, "Bau", `Abriss ${BTYPES[t.btype].name}`, BTYPES[t.btype].cost * 0.5);
    p.stats.abgerissen++;
    t.owner = null; t.btype = null; t.shop = undefined; t.anlagewert = undefined; t.bauBis = undefined; t.system = undefined; t.rzAktiv = undefined; t.bestellungen = undefined; t.vorrat = undefined;
    ack?.({ ok: true });
  }));

  /* --- Börse: reine Spieler-Orders --- */
  socket.on("placeOrder", guard((p, { side, good, qty, price }, ack) => {
    /* Planwirtschaft: freien Handel gibt es offiziell nicht. */
    if (MODE === "plan") return ack?.({ error: "In der Planwirtschaft gibt es keine freie Börse — nutze die Zuteilung oder den Schwarzmarkt im Planbüro." });
    /* Illegale Ware taucht in keinem Orderbuch auf. */
    if (ILLEGAL.includes(good)) return ack?.({ error: "Heiße Ware gehört nicht an die Börse — der Hehler zahlt bar und fragt nicht" });
    qty = Math.floor(+qty); price = Math.round(+price * 100) / 100;
    if (!GOODS[good] || !["sell", "buy"].includes(side)) return ack?.({ error: "Ungültig" });
    if (!(qty > 0) || !(price > 0)) return ack?.({ error: "Menge/Preis > 0 nötig" });
    if (side === "sell" && p.inv[good] < qty) return ack?.({ error: "Nicht genug Ware im Lager" });
    if (side === "buy" && p.cash < qty * price) return ack?.({ error: "Zu wenig Kapital" });
    if (side === "sell") {
      const verstoss = kartellPreisVerstoss(p, good, price);
      if (verstoss) return ack?.({ error: verstoss });
    }
    const order = { id: id(), side, good, qty, price, playerId: p.id, player: p.name, ts: Date.now() };
    escrowForOrder(p, order);
    questProg(p, "order");
    matchOrder(order);
    ack?.({ ok: true });
  }));

  socket.on("cancelOrder", guard((p, { orderId }, ack) => {
    const o = G.orders.find(o => o.id === orderId && o.playerId === p.id);
    if (!o) return ack?.({ error: "Order nicht gefunden" });
    refundOrder(o); G.orders.splice(G.orders.indexOf(o), 1);
    ack?.({ ok: true });
  }));

  // Direkt eine liegende Order (teilweise) ausführen — "aus dem Buch kaufen"
  socket.on("takeOrder", guard((p, { orderId, qty }, ack) => {
    const o = G.orders.find(o => o.id === orderId);
    if (!o) return ack?.({ error: "Order weg — schon gehandelt?" });
    if (o.playerId === p.id) return ack?.({ error: "Eigene Order — nutze Stornieren" });
    qty = Math.min(Math.floor(+qty) || o.qty, o.qty);
    if (qty <= 0) return ack?.({ error: "Menge ungültig" });
    if (o.side === "sell") {
      if (p.cash < qty * o.price) return ack?.({ error: "Zu wenig Kapital" });
      p.cash -= qty * o.price;
      settleTrade(o.good, qty, o.price, p.id, o.playerId);
    } else {
      if (p.inv[o.good] < qty) return ack?.({ error: "Nicht genug Ware" });
      /* Hier verkauft man in eine fremde Kaufofferte hinein — der Preis kommt
       * von der Gegenseite, unterschreitet die eigene Absprache aber genauso. */
      const verstoss = kartellPreisVerstoss(p, o.good, o.price);
      if (verstoss) return ack?.({ error: verstoss });
      p.inv[o.good] -= qty;
      settleTrade(o.good, qty, o.price, o.playerId, p.id);
    }
    o.qty -= qty;
    if (o.qty <= 0) G.orders.splice(G.orders.indexOf(o), 1);
    ack?.({ ok: true });
  }));

  /* --- Shop konfigurieren: Ware + eigener Stückpreis je Verkaufsslot --- */
  socket.on("configureShop", guard((p, { x, y, slot, good, price, qty }, ack) => {
    const t = tileAt(x, y);
    const bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !bt?.retail) return ack?.({ error: "Kein eigenes Verkaufsgebäude" });
    slot = Math.floor(+slot);
    if (!(slot >= 0 && slot < (t.shop?.length ?? bt.retail.slots))) return ack?.({ error: "Slot ungültig" });
    if (good === null) { t.shop[slot] = null; return ack?.({ ok: true }); }   // Slot leeren
    price = Math.round(+price * 100) / 100;
    if (!bt.retail.goods.includes(good)) return ack?.({ error: "Ware hier nicht verkäuflich" });
    if (!(price > 0)) return ack?.({ error: "Preis > 0 nötig" });
    /* Der Laden verkauft an die Stadt, nicht an Mitspieler — die Absprache gilt
     * hier trotzdem: Billig abgeben drückt über noteSold den Durchschnittspreis,
     * an dem die Absprache der anderen Mitglieder hängt. */
    const verstoss = kartellPreisVerstoss(p, good, price);
    if (verstoss) return ack?.({ error: verstoss });
    qty = Math.floor(+qty);
    if (qty <= 0 || !Number.isFinite(qty)) qty = null;   // leer = unbegrenzt verkaufen
    t.shop[slot] = { good, price, qty };
    questProg(p, "shop");
    ack?.({ ok: true });
  }));

  /* --- Verkauf (Shop) bzw. Weiterverarbeitung (proc) an einem Gebäude pausieren --- */
  socket.on("togglePause", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y);
    const bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !(bt?.retail || bt?.proc)) return ack?.({ error: "Kein eigenes Verkaufs-/Verarbeitungsgebäude" });
    t.paused = !t.paused;
    ack?.({ ok: true, paused: t.paused });
  }));

  /* --- Gruppenauftrag: Waren einzahlen --- */
  socket.on("contribute", guard((p, { good, qty }, ack) => {
    const o = G.groupOrder;
    if (!o) return ack?.({ error: "Kein aktiver Gruppenauftrag" });
    const need = o.needs[good];
    if (!need) return ack?.({ error: "Diese Ware wird nicht gebraucht" });
    qty = Math.min(Math.floor(+qty), need.req - need.have);
    if (!(qty > 0)) return ack?.({ error: "Menge ungültig oder Bedarf gedeckt" });
    if (p.inv[good] < qty) return ack?.({ error: `Nicht genug ${GOODS[good].name} im Lager` });
    p.inv[good] -= qty;
    need.have += qty;
    /* bewusst KEIN noteSold: der Großauftrag soll den Marktkurs nicht drücken */
    (o.contrib[p.id] ??= {})[good] = (o.contrib[p.id][good] || 0) + qty;
    logTx(p, "Gruppenauftrag", `${qty}× ${GOODS[good].name} an ${o.city} eingezahlt`, 0);
    if (Object.values(o.needs).every(n => n.have >= n.req)) finishGroupOrder();
    ack?.({ ok: true });
  }));

  /* --- Stadtprojekt: Waren liefern (Spieler und Bots) --- */
  socket.on("projektLiefern", guard((p, { good, qty } = {}, ack) => {
    const o = G.stadtprojekt;
    if (!o) return ack?.({ error: "Kein laufendes Stadtprojekt" });
    const need = o.needs[good];
    if (!need) return ack?.({ error: "Diese Ware wird nicht gebraucht" });
    qty = Math.min(Math.floor(+qty), need.req - need.have);
    if (!(qty > 0)) return ack?.({ error: "Menge ungültig oder Bedarf gedeckt" });
    if ((p.inv[good] || 0) < qty) return ack?.({ error: `Nicht genug ${GOODS[good].name} im Lager` });
    p.inv[good] -= qty; need.have += qty;
    (o.contrib[p.id] ??= {})[good] = (o.contrib[p.id][good] || 0) + qty;
    logTx(p, "Stadtprojekt", `${qty}× ${GOODS[good].name} an ${o.name} geliefert`, 0);
    if (Object.values(o.needs).every(n => n.have >= n.req)) stadtprojektAbrechnen(true);
    ack?.({ ok: true });
  }));

  /* --- Anleihen: nur Spieler emittieren & kaufen --- */
  socket.on("issueBond", guard((p, { principal, rate, term }, ack) => {
    if (MODE === "plan") return ack?.({ error: "In der Planwirtschaft gibt es keinen Kapitalmarkt" });
    principal = Math.floor(+principal); rate = +rate; term = Math.floor(+term);
    if (!(principal >= 100) || !(rate > 0 && rate <= 0.5) || !(term >= 30))
      return ack?.({ error: "Min. $100, Zins 0–50 %, Laufzeit ≥ 30 s" });
    G.bonds.push({ id: id(), issuerId: p.id, holderId: null, principal, rate, termLeft: term, strikes: 0 });
    ack?.({ ok: true });
  }));

  socket.on("buyBond", guard((p, { bondId }, ack) => {
    const b = G.bonds.find(b => b.id === bondId && !b.holderId);
    if (!b) return ack?.({ error: "Anleihe nicht verfügbar" });
    if (b.issuerId === p.id) return ack?.({ error: "Eigene Anleihe" });
    if (p.cash < b.principal) return ack?.({ error: "Zu wenig Kapital" });
    const issuer = G.players[b.issuerId];
    p.cash -= b.principal;
    if (issuer) issuer.cash += b.principal;   // Kapitalzufluss beim Emittenten
    b.holderId = p.id;
    logTx(p, "Anleihen", `Anleihe von ${issuer?.name ?? "?"} gekauft`, -b.principal);
    if (issuer) logTx(issuer, "Anleihen", `Anleihe platziert bei ${p.name}`, b.principal);
    io.emit("notice", { text: `${p.name} finanziert ${issuer?.name ?? "?"} mit ${b.principal} $ (${(b.rate * 100).toFixed(1)} %)` });
    ack?.({ ok: true });
  }));

  /* --- Aktien: eigene 25%-Anteile verkaufen, um Kapital zu bekommen.
   * Käufer erhalten dafür alle 10 min eine Dividende vom laufenden Erlös
   * der Firma (siehe distributeDividends im Server-Tick). --- */
  /* Ausschüttung festlegen: null/"auto" = automatisch (DIVIDEND_RATE des Umsatzes
   * der Periode), sonst ein fester Betrag je Periode (gedeckelt durch die Kasse). */
  socket.on("setAusschuettung", guard((p, { betrag } = {}, ack) => {
    if (betrag == null || betrag === "auto") { p.ausschuettung = null; return ack?.({ ok: true }); }
    betrag = Math.round(+betrag);
    if (!(betrag >= 0) || betrag > 1e7) return ack?.({ error: "Ungültiger Betrag" });
    p.ausschuettung = betrag;
    logTx(p, "Aktien", betrag ? `Ausschüttung auf ${betrag.toLocaleString("de-DE")} $ je ${DIVIDEND_INTERVAL / 60} min festgelegt` : "Ausschüttung ausgesetzt", 0);
    ack?.({ ok: true });
  }));

  /* Branchen-ETF kaufen: Betrag in $ → Anteile am Branchenfonds */
  socket.on("etfKaufen", guard((p, { branche, betrag } = {}, ack) => {
    betrag = Math.floor(+betrag);
    if (!INDUSTRIES[branche] || !etfFirmen(branche).length) return ack?.({ error: "In dieser Branche gibt es keine Firma" });
    if (!(betrag >= 100)) return ack?.({ error: "Mindestens 100 $" });
    if (p.cash < betrag) return ack?.({ error: "Zu wenig Kapital" });
    const preis = etfPreis(branche);
    p.cash -= betrag;
    const n = fondsEinzahlen(branche, betrag);   // der Fonds legt das Geld sofort an, soweit es Aktien gibt
    (p.etf ??= {})[branche] = (p.etf[branche] || 0) + n;
    (p.etfEinstand ??= {})[branche] = (p.etfEinstand[branche] || 0) + betrag;
    logTx(p, "ETF", `${INDUSTRIES[branche].name}-Fonds: ${n.toFixed(2)} Anteile zu ${preis.toFixed(2)} $`, -betrag);
    marktLog("etf-kauf", `${p.name} zahlt ${betrag.toLocaleString("de-DE")} $ in den ${INDUSTRIES[branche].name}-Fonds ein`, { branche, betrag });
    ack?.({ ok: true });
  }));
  /* Branchen-ETF verkaufen: Anteil 0–1 des Bestands — ausgezahlt aus der Fondskasse */
  socket.on("etfVerkaufen", guard((p, { branche, anteil = 1 } = {}, ack) => {
    const hat = p.etf?.[branche] || 0;
    if (!(hat > 0)) return ack?.({ error: "Keine Anteile" });
    anteil = Math.max(0, Math.min(1, +anteil || 1));
    const f = fondsVon(branche), n = hat * anteil;
    const aus = fondsAuszahlen(branche, n);
    if (aus == null)
      return ack?.({ error: `Der Fonds hat gerade nur ${Math.round(f.cash).toLocaleString("de-DE")} $ flüssig — verkaufe weniger, er bietet Aktien an, um Geld zu beschaffen` });
    p.cash += aus;
    p.etf[branche] = hat - n; if (p.etf[branche] < 1e-9) delete p.etf[branche];
    if (p.etfEinstand?.[branche]) p.etfEinstand[branche] *= 1 - anteil;
    logTx(p, "ETF", `${INDUSTRIES[branche].name}-Fonds: ${n.toFixed(2)} Anteile verkauft`, aus);
    marktLog("etf-verkauf", `${p.name} zieht ${Math.round(aus).toLocaleString("de-DE")} $ aus dem ${INDUSTRIES[branche].name}-Fonds ab`, { branche, betrag: Math.round(aus) });
    ack?.({ ok: true });
  }));

  socket.on("listShares", guard((p, { companyId, count, price, toId }, ack) => {
    companyId = companyId || p.id;   // ohne Angabe: eigene Anteile emittieren (Rückwärtskompatibilität)
    count = Math.floor(+count); price = +price; toId = toId || null;
    const company = G.players[companyId];
    if (!company) return ack?.({ error: "Firma unbekannt" });
    if (!(count >= 1 && count <= AKTIEN)) return ack?.({ error: `1–${AKTIEN} Aktien` });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    /* Verkaufen darf jeder, der die Anteile hält — die Firma ihre eigenen (Emission)
     * genauso wie ein Aktionär seine zugekauften (Weiterverkauf). */
    if ((company.equity[p.id] || 0) < count)
      return ack?.({ error: `So viele Aktien von ${company.name} hältst du nicht` });
    if (toId && (toId === p.id || !G.players[toId])) return ack?.({ error: "Ungültiger Empfänger" });
    company.equity[p.id] -= count;   // in Verwahrung, bis gekauft oder zurückgezogen
    const listing = { id: id(), companyId, sellerId: p.id, count, price, ts: Date.now(), toId };
    G.shareListings.push(listing);
    const what = companyId === p.id ? "eigene Aktien" : `Aktien von ${company.name}`;
    if (toId) {
      emitTo(toId, "shareOffer", { ...listing, from: p.name, company: company.name });
      logTx(p, "Aktien", `${count} ${what} an ${G.players[toId].name} angeboten`, 0);
    } else {
      logTx(p, "Aktien", `${count} ${what} an der Bank angeboten`, 0);
    }
    ack?.({ ok: true });
  }));

  /* --- Kaufanfragen: jeder kann einer beliebigen Firma ein Angebot für einen
   * Anteil machen. Die Firma entscheidet dann selbst — Spieler per Knopf,
   * Bots nach ihrer eigenen Bewertung (siehe spawnBot). Es wird nichts
   * hinterlegt; die Deckung wird erst beim Annehmen geprüft, wie bei Verträgen. --- */
  socket.on("bidShares", guard((p, { companyId, count, price }, ack) => {
    count = Math.floor(+count); price = +price;
    const company = G.players[companyId];
    if (!company) return ack?.({ error: "Firma unbekannt" });
    if (companyId === p.id) return ack?.({ error: "Das ist deine eigene Firma" });
    if (!(count >= 1 && count <= AKTIEN)) return ack?.({ error: `1–${AKTIEN} Aktien` });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    if (p.cash < price) return ack?.({ error: "So viel Kapital hast du nicht" });
    if ((company.equity[companyId] || 0) < count)
      return ack?.({ error: `${company.name} hält selbst nur noch ${company.equity[companyId] || 0} Aktien` });
    if (G.shareBids.some(b => b.companyId === companyId && b.bidderId === p.id))
      return ack?.({ error: "Du hast dieser Firma bereits eine Anfrage geschickt" });
    const bid = { id: id(), companyId, bidderId: p.id, count, price, ttl: SHARE_BID_TTL };
    G.shareBids.push(bid);
    emitTo(companyId, "notice", { text: `${p.name} bietet ${Math.round(price)} $ für ${count} Aktien deiner Firma — an der Stadtbank entscheiden.` });
    logTx(p, "Aktien", `Kaufanfrage über ${count} Aktien von ${company.name}`, 0);
    ack?.({ ok: true });
  }));

  socket.on("acceptShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.companyId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    const bid = G.shareBids[i];
    if (istInstitution(bid.bidderId)) {
      /* Kaufanfrage des Finanzamts (aus dem Geld über der Projektschwelle)
       * oder eines Branchenfonds (aus seiner Kasse) */
      const hid = bid.bidderId;
      if (institutionFrei(hid) < bid.price) { G.shareBids.splice(i, 1); return ack?.({ error: `${institutionName(hid)} hat dafür gerade kein Geld mehr` }); }
      if ((p.equity[p.id] || 0) < bid.count) return ack?.({ error: "Du hältst nicht mehr genug eigene Aktien" });
      institutionZahlt(hid, bid.price); p.cash += bid.price;
      p.stats.kapitalNetto = (p.stats.kapitalNetto || 0) + bid.price;
      p.equity[p.id] -= bid.count; p.equity[hid] = (p.equity[hid] || 0) + bid.count;
      G.shareBids.splice(i, 1);
      kursWirkung(p, bid.count, +1);   // Kauf der Institution hebt den Kurs
      logTx(p, "Aktien", `${bid.count} eigene Aktien an ${institutionName(hid)} verkauft`, bid.price);
      p.stats.anteileVerkauft += bid.count;
      marktLog(hid === FA_ID ? "fa-kauf" : "etf-kauf", `${institutionName(hid)} kauft ${bid.count} Aktien von ${p.name}`, { firmaId: p.id, aktien: bid.count, preis: Math.round(bid.price) });
      return ack?.({ ok: true });
    }
    const bidder = G.players[bid.bidderId];
    if (!bidder) { G.shareBids.splice(i, 1); return ack?.({ error: "Bieter ist nicht mehr im Spiel" }); }
    if (bidder.cash < bid.price) return ack?.({ error: `${bidder.name} hat nicht mehr genug Kapital` });
    if ((p.equity[p.id] || 0) < bid.count)
      return ack?.({ error: "Du hältst nicht mehr genug eigene Anteile" });
    bidder.cash -= bid.price;
    p.cash += bid.price;                    // Verkauf eigener Anteile = frisches Firmenkapital
    p.stats.kapitalNetto = (p.stats.kapitalNetto || 0) + bid.price;   // kein Ertrag — für F herausrechnen
    p.equity[p.id] -= bid.count;
    kursWirkung(p, bid.count, -1);          // Firma gibt Aktien ab: Kurs gibt nach
    marktLog("verkauf", `${p.name} gibt ${bid.count} eigene Aktien an ${bidder.name} ab`, { firmaId: p.id, aktien: bid.count, preis: Math.round(bid.price) });
    merkeEinstand(bidder, p, bid.count, bid.price);
    p.equity[bidder.id] = (p.equity[bidder.id] || 0) + bid.count;
    G.shareBids.splice(i, 1);
    logTx(p, "Aktien", `${bid.count} eigene Aktien an ${bidder.name} verkauft`, bid.price);
    logTx(bidder, "Aktien", `${bid.count} Aktien von ${p.name} gekauft`, -bid.price);
    bidder.stats.anteileGekauft += bid.count; p.stats.anteileVerkauft += bid.count;
    questProg(bidder, "shares");
    emitTo(bidder.id, "notice", { text: `${p.name} nimmt deine Kaufanfrage an — du hältst jetzt ${p.equity[bidder.id]} Aktien von ${p.name}.` });
    io.emit("notice", { text: `${bidder.name} übernimmt ${bid.count} Aktien von ${p.name} für ${Math.round(bid.price)} $` });
    ack?.({ ok: true });
  }));

  socket.on("declineShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.companyId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    emitTo(G.shareBids[i].bidderId, "notice", { text: `${p.name} lehnt deine Kaufanfrage ab.` });
    G.shareBids.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("cancelShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.bidderId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    G.shareBids.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("kurswetteSetzen", guard((p, { firmaId, richtung, einsatz } = {}, ack) => {
    if (G.wettrunde.phase !== "annahme") return ack?.({ error: "Die Runde läuft — neue Wetten ab der nächsten Annahme" });
    if (richtung !== "long" && richtung !== "short") return ack?.({ error: "Richtung fehlt" });
    einsatz = Math.floor(Number(einsatz));
    if (!(einsatz > 0)) return ack?.({ error: "Ungültiger Einsatz" });
    const firma = G.players[firmaId];
    const verbot = wettVerbot(p, firma);
    if (verbot) return ack?.({ error: verbot });
    const fehler = wetteBuchen(p, firma, richtung, einsatz);
    if (fehler) return ack?.({ error: fehler });
    ack?.({ ok: true });
  }));

  socket.on("cancelShareListing", guard((p, { listingId }, ack) => {
    const i = G.shareListings.findIndex(l => l.id === listingId && (l.sellerId ?? l.companyId) === p.id);
    if (i < 0) return ack?.({ error: "Angebot nicht gefunden" });
    returnListingToSeller(G.shareListings[i]);
    G.shareListings.splice(i, 1);
    ack?.({ ok: true });
  }));

  /* Teilkauf: `count` ist optional — ohne Angabe wird das ganze Angebot gekauft
   * (Rückwärtskompatibilität, die Bots nutzen das). Ein Teil kostet den
   * anteiligen Preis; was übrig bleibt, bleibt als Angebot an der Börse. */
  socket.on("buyShares", guard((p, { listingId, count }, ack) => {
    const l = G.shareListings.find(l => l.id === listingId);
    if (!l) return ack?.({ error: "Angebot nicht mehr verfügbar" });
    const sellerId = l.sellerId ?? l.companyId;
    if (sellerId === p.id) return ack?.({ error: "Das ist dein eigenes Angebot" });
    if (l.toId && l.toId !== p.id) return ack?.({ error: "Dieses Angebot ist an jemand anderen gerichtet" });
    const n = count == null ? l.count : Math.floor(+count);
    if (!(n >= 1 && n <= l.count)) return ack?.({ error: `1–${l.count} Aktien aus diesem Angebot` });
    const preis = n === l.count ? l.price : Math.max(1, Math.round(l.price * n / l.count));
    if (p.cash < preis) return ack?.({ error: "Zu wenig Kapital" });
    const company = G.players[l.companyId];
    if (!company) { G.shareListings.splice(G.shareListings.indexOf(l), 1); return ack?.({ error: "Firma existiert nicht mehr" }); }
    const seller = G.players[sellerId];
    /* Angebot aufteilen: der Rest bleibt mit seinem anteiligen Preis stehen */
    if (n === l.count) G.shareListings.splice(G.shareListings.indexOf(l), 1);
    else { l.count -= n; l.price -= preis; }
    p.cash -= preis;
    merkeEinstand(p, company, n, preis);   // vor dem Erhöhen: braucht den alten Stand
    company.equity[p.id] = (company.equity[p.id] || 0) + n;
    logTx(p, "Aktien", `${n} Aktien von ${company.name} gekauft`, -preis);
    kursWirkung(company, n, sellerId === FA_ID ? -1 : +1);   // jemand kauft: Kurs zieht an — verkauft das Finanzamt, gibt er nach
    marktLog("kauf", `${p.name} kauft ${n} Aktien von ${company.name}`, { firmaId: company.id, aktien: n, preis: Math.round(preis) });
    p.stats.anteileGekauft += n;
    questProg(p, "shares");
    if (sellerId === l.companyId) {
      /* Emission: die Firma gibt eigene Anteile aus, das Geld ist frisches
       * Firmenkapital. Es zählt NICHT als Umsatz — sonst würde eine Firma sich
       * über den Verkauf eigener Anteile selbst hochbewerten. */
      company.cash += preis;
      company.stats.kapitalNetto = (company.stats.kapitalNetto || 0) + preis;   // kein Ertrag — für F herausrechnen
      logTx(company, "Aktien", `${n} eigene Aktien an ${p.name} ausgegeben`, preis);
    } else if (istInstitution(sellerId)) {
      institutionErhaelt(sellerId, preis);   // Finanzamt → Stadtkasse, Fonds → Fondskasse
      marktLog(sellerId === FA_ID ? "fa-verkauf" : "etf-verkauf", `${institutionName(sellerId)} verkauft ${n} Aktien von ${company.name} an ${p.name}`, { firmaId: company.id, aktien: n, preis: Math.round(preis) });
    } else if (seller) {
      /* Weiterverkauf: der Erlös geht an den Aktionär — hier entsteht der
       * Kursgewinn oder -verlust aus dem Anteilshandel. */
      seller.cash += preis;
      logTx(seller, "Aktien", `${n} Aktien von ${company.name} an ${p.name} verkauft`, preis);
      emitTo(sellerId, "notice", { text: `${p.name} hat deine ${n} Aktien von ${company.name} für ${Math.round(preis)} $ gekauft.` });
    }
    io.emit("notice", { text: `${p.name} kauft ${n} Aktien von ${company.name} für ${Math.round(preis)} $` });
    ack?.({ ok: true });
  }));

  /* --- Firmenfusion: hältst du 100 % einer anderen Firma, kannst du sie
   * eingliedern — ihre Gebäude, Kapital, Lager und Industrie werden deine.
   * Funktioniert branchenübergreifend, z. B. Rohstoff + Grundbedürfnisse. --- */
  /* --- Neue Runde nach dem Sieg ---
   * Ein reiner Rücksprung zum Startbildschirm würde nicht reichen: solange
   * G.winner gesetzt ist, blockt guard() jede Aktion mit "Spiel beendet", und
   * die alte Karte samt aller Firmen stünde noch. Deshalb wird hier der gesamte
   * Rundenzustand neu aufgebaut und alle Verbundenen zurück in die Lobby
   * geschickt. Bewusst ohne Rechteprüfung ausser dem Rundenende — wer die Runde
   * zu Ende gespielt hat, darf sie auch neu starten. */
  socket.on("newRound", (_payload, ack) => {
    if (!G.winner) return ack?.({ error: "Die Runde läuft noch" });
    stopBots();
    botAuswahl = null; botLevelKey = BOT_LEVEL_DEFAULT;
    G.map = buildMap();
    /* Frische Karte → Kachel-Diff zurücksetzen, alle bekommen sie voll. */
    lastTileSigs = null;
    for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
    G.players = {}; G.socketToPid = {};
    G.orders = []; G.stadtnetz = {}; G.bonds = []; G.auctions = []; G.contracts = [];
    G.shareListings = []; G.shareBids = [];
    G.lastTrade = {};
    G.chat = Object.fromEntries(ROOMS.map(r => [r, []]));
    G.tick = 0; G.winner = null; G.winGrund = null; G.report = null; G.plan = null; G.tutorialEnde = false;
    G.rennen = null; G.naechstesRennenIn = RENN_INTERVALL; G.werksTeams = werksTeamsBauen();
    G.wm = {}; G.saisonRennen = 0; G.fanAuszahlungIn = FAN_TAKT;
    G.hofGespeichert = false;
    G.cartels = []; G.familienRespekt = {}; G.bezirke = null; G.pate = null;
    G.pateWahl = { phase: null, endet: 0, naechste: 0, kandidaten: [], stimmen: {}, stich: null };
    G.pateDekret = null; G.pateName = null;
    G.familienBank = {}; G.familienBoss = {}; G.familienRang = {}; G.familienTribut = {}; G.soldaten = {};
    G.wahlSiege = {}; G.kampfSiege = {}; G.siegWarnungen = {};
    G.fahndung = {}; G.transporte = []; G.naechsterTransport = 30;
    G.started = false; G.hostId = null;   // neue Runde beginnt wieder im Warteraum
    G.groupOrder = null; G.nextGroupIn = 20;
    G.nextDividendIn = DIVIDEND_INTERVAL;
    G.wettrunde = { nr: 1, phase: "annahme", rest: WETT_ANNAHME, start: {} }; G.wetten = []; G.wettLetzte = []; G.wettReserve = WETT_RESERVE;
    G.markt = {}; G.marktLog = []; G.panikTag = null; G.panikErledigt = false; G.fonds = {}; G.etfHist = {}; G.faEtf = {}; G.software = {}; G.paint = {}; G.swFaktor = {}; G.werbeAktiv = new Set();
    G.stadtkasse = STADT_GRUNDSTOCK; G.steuerStufe = 2; G.boerseGebuehren = 0; G.steuernGesamt = 0; G.stadtprojekt = null; G.projektPause = 120; G.stadtprojekteFertig = [];
    for (const pl of Object.values(G.players)) { pl.steuerStand = undefined; pl.steuerSchuld = 0; pl.steuerLetzter = null; }
    for (const pl of Object.values(G.players)) { pl.wettOffen = 0; pl.wettLog = []; }
    /* Preisanker zurücksetzen — sonst startet die neue Runde mit den
     * verzerrten Kursen der alten (z. B. dauerhaft gedrücktem Ölpreis). */
    for (const k of Object.keys(GOODS)) Object.assign(MM[k], { price: BASEP[k], anchor: BASEP[k], sold: 0 });
    G.priceHist = {}; G.firmHist = {}; G.news = [];
    /* Alle Clients bekommen die Karte danach wieder vollständig */
    lastTileSigs = null;
    for (const sock of io.sockets.sockets.values()) { sock.data.gotMap = false; sock.data.meSigs = null; }
    io.emit("roundReset", {});
    ack?.({ ok: true });
    pushState();
  });

  /* --- Kampagne buchen ---
   * Nur mit eigener Werbeagentur. Reichweite ist bei 100 gedeckelt; wer
   * nachlegt, bevor der Vorrat leer ist, hält den Aufschlag oben. */
  /* --- Software: Shop-System einstellen (Name, Farbe, Preise) ---
   * Preise und Aussehen gelten sofort; neue Funktionen kosten Entwicklung
   * (softwareEntwickeln). */
  socket.on("softwareEinstellen", guard((p, d, ack) => {
    if (!istSoftwareFirma(p)) return ack?.({ error: "Nur die Software-Branche entwickelt Shop-Systeme" });
    let prod = swEigenes(p);
    const name = sicherText(String(d.name ?? prod?.name ?? "").trim().slice(0, 16));
    if (name.length < 3) return ack?.({ error: "Name: mindestens 3 Zeichen" });
    if (name.toLowerCase() === "stadtportal" || Object.values(G.software).some(o => o !== prod && o.name.toLowerCase() === name.toLowerCase()))
      return ack?.({ error: "Diesen Namen gibt es schon" });
    const zahl = (v, min, max, alt) => { const n = +v; return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : alt; };
    if (!prod) {
      prod = { id: "sw_" + id(), ownerId: p.id, name, farbe: p.color, version: 0, module: {}, branchen: [], einrichtung: 400, gebuehr: 2, werbeAbo: SW.ABO_START,
               ruf: SW.RUF_START, einnahmen: 0, eb: [0], entwicklung: null };
      G.software[prod.id] = prod;
    }
    prod.name = name;
    if (d.farbe) prod.farbe = sichereFarbe(d.farbe);
    prod.einrichtung = Math.round(zahl(d.einrichtung, 0, SW.EINR_MAX, prod.einrichtung));
    prod.gebuehr = Math.round(zahl(d.gebuehr, SW.GEB_MIN, SW.GEB_MAX, prod.gebuehr) * 10) / 10;
    prod.werbeAbo = Math.round(zahl(d.werbeAbo, SW.ABO_MIN, SW.ABO_MAX, prod.werbeAbo));
    ack?.({ ok: true, id: prod.id });
  }));
  /* --- Malprogramm: Name und Lizenzpreis --- */
  socket.on("paintEinstellen", guard((p, d = {}, ack) => {
    if (!istSoftwareFirma(p)) return ack?.({ error: "Nur Software-Firmen entwickeln Malprogramme" });
    const sys = swEigenes(p);
    if (!(sys?.version >= PAINT.AB_SYSTEM)) return ack?.({ error: `Erst ab Shop-System v${PAINT.AB_SYSTEM}` });
    let x = paintEigenes(p);
    const name = sicherText(String(d.name ?? x?.name ?? "").trim().slice(0, 16));
    if (name.length < 3) return ack?.({ error: "Name: mindestens 3 Zeichen" });
    if (Object.values(G.paint || {}).some(o => o !== x && o.name.toLowerCase() === name.toLowerCase())) return ack?.({ error: "Diesen Namen gibt es schon" });
    const preis = Math.round(Math.min(PAINT.PREIS_MAX, Math.max(PAINT.PREIS_MIN, +d.preis || x?.preis || PAINT.PREIS_START)) / 10) * 10;
    if (!x) { x = { id: "mp_" + id(), ownerId: p.id, name, version: 0, preis, verkauft: 0, eb: [0], entwicklung: null }; (G.paint ??= {})[x.id] = x; }
    x.name = name; x.preis = preis;
    ack?.({ ok: true, id: x.id });
  }));
  socket.on("paintEntwickeln", guard((p, _d, ack) => {
    const x = istSoftwareFirma(p) && paintEigenes(p);
    if (!x) return ack?.({ error: "Lege zuerst Name und Preis des Malprogramms fest" });
    if (x.entwicklung) return ack?.({ error: `v${x.entwicklung.version} ist schon in Arbeit` });
    if ((x.version || 0) >= PAINT.STUFEN.length) return ack?.({ error: "Dein Malprogramm ist voll ausgebaut" });
    if (!G.map.some(t => t.owner === p.id && BTYPES[t.btype]?.studio)) return ack?.({ error: "Dafür brauchst du ein Entwicklerstudio" });
    const version = (x.version || 0) + 1, ep = PAINT.STUFEN[version - 1].ep;
    const vorrat = Math.min(ep, p.swEp || 0);
    p.swEp = (p.swEp || 0) - vorrat;
    x.entwicklung = { version, ziel: ep, ep: vorrat };
    marktLog("software", `${p.name} entwickelt das Malprogramm ${x.name} v${version}`, { firmaId: p.id });
    if (x.entwicklung.ep >= ep) paintVeroeffentlichen(x, p);
    ack?.({ ok: true, ep });
  }));
  /* --- Lizenz im Online-Shop der Software-Firma kaufen ---
   * Wie ein Shop-Kauf: Gebühr an das installierte Shop-System (fällt weg,
   * wenn es das eigene ist), halbe Börsengebühr als Handelssteuer an die Stadt. */
  socket.on("lizenzKaufen", guard((p, { x: tx, y: ty } = {}, ack) => {
    const t = tileAt(tx, ty);
    if (!t || t.btype !== "onlinemarkt" || !t.owner) return ack?.({ error: "Kein Online-Shop" });
    const haendler = G.players[t.owner], mp = haendler && paintEigenes(haendler);
    if (!mp || !(mp.version >= 1)) return ack?.({ error: "Dieser Shop verkauft kein Malprogramm" });
    if (t.owner === p.id) return ack?.({ error: "Dein eigenes Programm hast du schon" });
    if (!swOffen(t)) return ack?.({ error: "Der Shop ist gerade geschlossen" });
    const sys = swVon(t.system.produktId);
    if (!sys || (!sys.portal && !((G.swFaktor?.[sys.id] ?? 1) > 0))) return ack?.({ error: "Das Bezahlsystem des Shops ist ausgefallen" });
    if (p.paintLizenz === mp.id) return ack?.({ error: "Du hast diese Lizenz schon — Updates kommen automatisch" });
    if (p.cash < mp.preis) return ack?.({ error: `Zu wenig Geld (${mp.preis.toLocaleString("de-DE")} $)` });
    const summe = mp.preis;
    const gebuehr = sys.ownerId === haendler.id ? 0 : Math.round(summe * (sys.gebuehr || 0)) / 100;
    const steuer = Math.round(summe * satzBoerse() * SW.HANDELSSTEUER * 100) / 100;
    p.cash -= summe; p.stats.ausgaben += summe;
    haendler.cash += summe - gebuehr - steuer; addRevenue(haendler, summe);
    if (gebuehr) { haendler.stats.ausgaben += gebuehr; swGebuehr(sys, gebuehr); }
    finanzamtEinnahme(steuer); haendler.stats.steuern = (haendler.stats.steuern || 0) + steuer;
    mp.verkauft = (mp.verkauft || 0) + 1; (mp.eb ??= [0])[0] += summe - gebuehr - steuer;
    Object.assign(p, { paintLizenz: mp.id, paintLizenzStufe: mp.version, paintLizenzName: mp.name });
    (t.bestellungen ??= []).unshift({ id: G.tick + "lz" + p.id, g: "lizenz", n: 1, b: summe, t: G.tick, von: p.name, name: mp.name });
    if (t.bestellungen.length > 8) t.bestellungen.length = 8;
    logTx(p, "Software", `Lizenz ${mp.name} von ${haendler.name}`, -summe);
    logTx(haendler, "Software", `Lizenz ${mp.name} an ${p.name}`, summe - gebuehr - steuer);
    marktLog("software", `${p.name} kauft eine Lizenz für ${mp.name}`, { firmaId: haendler.id, betrag: summe });
    emitTo(haendler.id, "notice", { text: `${p.name} hat eine Lizenz für ${mp.name} gekauft (+${Math.round(summe - gebuehr - steuer).toLocaleString("de-DE")} $).` });
    ack?.({ ok: true, summe, gebuehr, steuer, steuerSatz: Math.round(satzBoerse() * SW.HANDELSSTEUER * 1000) / 10, system: sys.name, programm: mp.name, version: mp.version });
  }));
  /* --- Logo speichern / abrufen --- */
  socket.on("logoSpeichern", guard((p, { logo } = {}, ack) => {
    const stufe = paintStufeVon(p);
    if (!stufe) return ack?.({ error: "Du brauchst ein Malprogramm — Lizenzen gibt es im Online-Shop einer Software-Firma" });
    const l = logoPruefen(logo, stufe);
    if (!l) return ack?.({ error: `Logo ungültig (höchstens ${stufe.groesse}×${stufe.groesse} Pixel${stufe.farben ? `, ${stufe.farben} Grundfarben` : ""})` });
    p.logo = { ...l, v: (p.logo?.v || 0) + 1 };
    ack?.({ ok: true, v: p.logo.v });
  }));
  socket.on("logoHolen", (ids, ack) => {
    if (typeof ack !== "function") return;
    const liste = Array.isArray(ids) ? ids.slice(0, 40) : [];
    ack(Object.fromEntries(liste.map(pid => [pid, G.players[pid]?.logo || null])));
  });
  /* --- Software: Website-Design des Shop-Systems --- */
  socket.on("softwareDesign", guard((p, d = {}, ack) => {
    const prod = istSoftwareFirma(p) && swEigenes(p);
    if (!prod) return ack?.({ error: "Lege zuerst dein Shop-System an" });
    const vorher = JSON.stringify(prod.design || SW_DESIGN_START);
    prod.design = swDesignPruefen(d, prod.design, Math.max(1, prod.version || 0));
    ack?.({ ok: true, design: prod.design, geaendert: JSON.stringify(prod.design) !== vorher });
  }));
  /* --- Software: neue Version mit (weiteren) Modulen entwickeln --- */
  socket.on("softwareEntwickeln", guard((p, { module = {} } = {}, ack) => {
    if (!istSoftwareFirma(p)) return ack?.({ error: "Nur die Software-Branche entwickelt Shop-Systeme" });
    const prod = swEigenes(p);
    if (!prod) return ack?.({ error: "Lege zuerst Name und Preise deines Shop-Systems fest" });
    if (prod.entwicklung) return ack?.({ error: `v${prod.entwicklung.version} ist schon in Arbeit` });
    if (!G.map.some(t => t.owner === p.id && BTYPES[t.btype]?.studio)) return ack?.({ error: "Dafür brauchst du ein Entwicklerstudio" });
    const ziel = { ...(prod.module || {}) }, branchen = [...(prod.branchen || [])];
    const version = (prod.version || 0) + 1;
    let ep = prod.version >= 1 ? SW.VERSION_EP : SW_MODULE.basis.ep, kosten = 0, neueBranche = null;
    /* Allgemeine Module zuerst, Bäume Stufe für Stufe — so darf man Stufe 1
     * und 2 derselben Branche in einer Version zusammen anstoßen. */
    const stufe = m => +(m.split(":")[1] || 0);
    const wunsch = Object.keys(module).filter(m => module[m]).sort((x, y) => stufe(x) - stufe(y));
    for (const m of wunsch) {
      if (ziel[m]) continue;
      if (SW_MODULE[m] && m !== "basis") { ziel[m] = true; ep += SW_MODULE[m].ep; continue; }
      const [br] = m.split(":"), k = stufe(m);
      if (!SW_BAEUME[br] || !(k >= 1 && k <= 3)) return ack?.({ error: "Unbekannte Funktion" });
      if (k > 1 && !ziel[swModulId(br, k - 1)])
        return ack?.({ error: `${SW_BAEUME[br].module[k - 1]} braucht zuerst ${SW_BAEUME[br].module[k - 2]}` });
      let idx = branchen.indexOf(br);
      if (idx < 0) {
        if (neueBranche) return ack?.({ error: "Je Version kommt höchstens eine neue Branche dazu" });
        idx = branchen.length;
        const aus = swAusbau(idx);
        if (version < aus.abVersion)
          return ack?.({ error: `Eine ${idx + 1}. Branche geht erst ab Version ${aus.abVersion} — dein System steht bei v${prod.version || 0}` });
        neueBranche = br; branchen.push(br); kosten += aus.cash;
      }
      ziel[m] = true; ep += Math.round(SW_STUFE[k - 1].ep * swAusbau(idx).epFaktor);
    }
    const neu = Object.keys(ziel).filter(m => ziel[m] && !prod.module?.[m]);
    if (prod.version >= 1 && !neu.length) return ack?.({ error: "Wähle mindestens eine neue Funktion" });
    if (p.cash < kosten) return ack?.({ error: `Die Erweiterung auf eine weitere Branche kostet ${kosten.toLocaleString("de-DE")} $` });
    if (kosten) { p.cash -= kosten; p.stats.ausgaben += kosten; logTx(p, "Software", `${prod.name}: Lizenz für die Branche ${SW_BAEUME[neueBranche].name}`, -kosten); }
    const vorrat = Math.min(ep, p.swEp || 0);
    p.swEp = (p.swEp || 0) - vorrat;
    prod.entwicklung = { version, module: ziel, branchen, ziel: ep, ep: vorrat };
    marktLog("software", `${p.name} entwickelt ${prod.name} v${version}${neueBranche ? ` für ${SW_BAEUME[neueBranche].name}` : ""}`, { firmaId: p.id });
    if (prod.entwicklung.ep >= ep) swVeroeffentlichen(prod, p);
    ack?.({ ok: true, ep, kosten });
  }));
  /* --- Online-Marktplatz: Shop-System installieren oder wechseln ---
   * Einrichtung zahlt der Kunde sofort an den Anbieter. Bis die Installation
   * fertig ist, verkauft der Marktplatz nichts; Regale und Lager bleiben. */
  socket.on("installSystem", guard((p, { x, y, produktId }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !bt?.online) return ack?.({ error: "Kein eigener Online-Marktplatz" });
    const prod = swVon(produktId);
    if (!prod || !(prod.version >= 1)) return ack?.({ error: "Dieses System gibt es (noch) nicht" });
    if (t.system?.produktId === prod.id) return ack?.({ error: "Dieses System läuft hier schon" });
    if (!prod.portal && swKunden(prod) >= swPlaetze(prod))
      return ack?.({ error: `Das Rechenzentrum von ${G.players[prod.ownerId]?.name ?? "dem Anbieter"} ist voll — später nochmal oder ein anderes System` });
    if (p.cash < prod.einrichtung) return ack?.({ error: `Einrichtung kostet ${prod.einrichtung.toLocaleString("de-DE")} $` });
    const wechsel = !!t.system;
    p.cash -= prod.einrichtung; p.stats.ausgaben += prod.einrichtung;
    if (prod.ownerId !== p.id) swGebuehr(prod, prod.einrichtung);
    else if (!prod.portal) p.cash += prod.einrichtung;   // eigenes System: kein Geld im Kreis
    const dauer = prod.portal ? SW.PORTAL_INSTALL : SW.INSTALL;
    t.system = { produktId: prod.id, bis: G.tick + dauer, werbung: !!(t.system?.werbung && prod.module?.werbung) };
    logTx(p, "Software", `${prod.name} auf ${bt.name} ${wechsel ? "gewechselt" : "installiert"}`, -prod.einrichtung);
    if (prod.ownerId && prod.ownerId !== p.id) {
      emitTo(prod.ownerId, "notice", { text: `${p.name} installiert ${prod.name} (+${prod.einrichtung.toLocaleString("de-DE")} $ Einrichtung).` });
      logTx(G.players[prod.ownerId], "Software", `Einrichtung ${prod.name} bei ${p.name}`, prod.einrichtung);
    }
    marktLog("software", `${p.name} ${wechsel ? "wechselt zu" : "installiert"} ${prod.name}`, { firmaId: p.id });
    ack?.({ ok: true, dauer });
  }));
  /* --- Im Online-Shop einer anderen Firma einkaufen ---
   * Bezahlt wird über das installierte Shop-System: Der Käufer zahlt den
   * Regalpreis, der Händler gibt davon die Gebühr an den Anbieter ab (wie
   * bei Stadtkunden). Die Ware geht direkt ins Lager des Käufers. */
  socket.on("shopKaufen", guard((p, { x, y, slot, qty }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || !bt?.online) return ack?.({ error: "Kein Online-Shop" });
    if (t.owner === p.id) return ack?.({ error: "Das ist dein eigener Shop" });
    const haendler = G.players[t.owner];
    const prod = swOffen(t) ? swVon(t.system.produktId) : null;
    if (!haendler || !prod) return ack?.({ error: "Der Shop ist gerade geschlossen" });
    if (!prod.portal && (G.swFaktor?.[prod.id] ?? 1) <= 0) return ack?.({ error: `${prod.name} ist gerade ausgefallen — keine Zahlung möglich` });
    const sl = t.shop?.[slot];
    if (!sl?.good || !(sl.price > 0)) return ack?.({ error: "Dieses Regal ist leer" });
    let n = Math.floor(+qty);
    if (!(n >= 1)) return ack?.({ error: "Menge ungültig" });
    const vorrat = Math.floor(Math.min(haendler.inv[sl.good] || 0, sl.qty ?? Infinity));
    if (vorrat < 1) return ack?.({ error: "Ausverkauft" });
    n = Math.min(n, vorrat);
    const summe = Math.round(n * sl.price * 100) / 100;
    if (p.cash < summe) return ack?.({ error: `Zu wenig Geld — ${n}× kosten ${summe.toLocaleString("de-DE")} $` });
    const gebuehr = summe * prod.gebuehr / 100;
    /* Handelssteuer: Ohne sie wäre der Shop-Kauf zwischen Firmen steuerfrei,
     * die Börse kostet den Verkäufer aber 20 % — der ganze Handel wanderte in
     * die Shops, und der Stadtkasse fehlte das Geld für Projekte. Mit der
     * halben Börsengebühr bleibt der Shop klar günstiger. */
    const steuer = Math.round(summe * satzBoerse() * SW.HANDELSSTEUER * 100) / 100;
    p.cash -= summe; p.inv[sl.good] = (p.inv[sl.good] || 0) + n; p.stats.ausgaben += summe;
    haendler.inv[sl.good] -= n; haendler.cash += summe - gebuehr - steuer; addRevenue(haendler, summe); haendler.stats.ausgaben += gebuehr;
    haendler.stats.steuern = (haendler.stats.steuern || 0) + steuer;
    G.stadtkasse += steuer; G.boerseGebuehren = (G.boerseGebuehren || 0) + steuer;
    swGebuehr(prod, gebuehr);
    if (sl.qty != null) { sl.qty -= n; if (sl.qty <= 0.001) t.shop[slot] = null; }
    if (t.vorrat) t.vorrat[slot] = Math.max(0, (t.vorrat[slot] || 0) - n);
    (t.bestellungen ??= []).unshift({ id: G.tick + sl.good + p.id, g: sl.good, n, b: summe, t: G.tick, von: p.name });
    if (t.bestellungen.length > 8) t.bestellungen.length = 8;
    logTx(p, "Einkauf", `${n}× ${GOODS[sl.good].name} im Online-Shop von ${haendler.name} (${prod.name})`, -summe);
    logTx(haendler, "Verkauf", `${n}× ${GOODS[sl.good].name} an ${p.name} über ${prod.name} (Gebühr ${gebuehr.toFixed(2)} $, Handelssteuer ${steuer.toFixed(2)} $)`, summe - gebuehr - steuer);
    emitTo(haendler.id, "notice", { text: `🛒 ${p.name} kauft ${n}× ${GOODS[sl.good].name} in deinem Online-Shop (${summe.toLocaleString("de-DE")} $, bezahlt mit ${prod.name}).` });
    ack?.({ ok: true, n, summe, gebuehr: Math.round(gebuehr * 100) / 100, steuer, steuerSatz: Math.round(satzBoerse() * SW.HANDELSSTEUER * 1000) / 10, system: prod.name });
  }));
  /* --- Werbemodul ein-/ausschalten (Abo je Minute an den Anbieter) --- */
  socket.on("systemWerbung", guard((p, { x, y, an }, ack) => {
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id || !t.system) return ack?.({ error: "Hier läuft kein Shop-System" });
    const prod = swVon(t.system.produktId);
    if (!prod?.module?.werbung) return ack?.({ error: `${prod?.name ?? "Dieses System"} hat kein Werbemodul` });
    if (an && p.cash < (prod.werbeAbo || 0)) return ack?.({ error: `Das Abo kostet ${prod.werbeAbo} $ je Minute` });
    for (const o of G.map) if (o.owner === p.id && o.system?.produktId === prod.id) o.system.werbung = !!an;
    ack?.({ ok: true });
  }));

  socket.on("bookAd", guard((p, { paket }, ack) => {
    if (MODE === "sandbox") return ack?.({ error: "Werbung läuft hier über das Werbemodul eines Shop-Systems (Online-Marktplatz)" });
    const paketDef = AD_PACKAGES[paket];
    if (!paketDef) return ack?.({ error: "Unbekanntes Paket" });
    const n = adAgenturen(p);
    if (n < 1) return ack?.({ error: "Dafür brauchst du eine eigene Werbeagentur" });
    if (p.cash < paketDef.cost) return ack?.({ error: `${paketDef.name} kostet ${paketDef.cost.toLocaleString("de-DE")} $` });
    p.cash -= paketDef.cost;
    p.adReach = Math.min(100, (p.adReach || 0) + paketDef.reach);
    p.stats.werbung += paketDef.cost; p.stats.ausgaben += paketDef.cost;
    gainXp(p, 15);
    logTx(p, "Werbung", `${paketDef.name} gebucht (+${paketDef.reach} Reichweite)`, -paketDef.cost);
    ack?.({ ok: true, reach: Math.round(p.adReach), boost: adBoost(p) });
  }));

  socket.on("mergeCompany", guard((p, { targetId }, ack) => {
    const target = G.players[targetId];
    if (!target || targetId === p.id) return ack?.({ error: "Ungültige Zielfirma" });
    if ((target.equity[p.id] || 0) < AKTIEN) return ack?.({ error: `Du brauchst alle ${AKTIEN} Aktien für eine Fusion` });
    p.afa.push(...(target.afa || []));   // Abschreibungen laufen bei der übernehmenden Firma weiter
    /* Vermögen zusammenlegen */
    p.cash += target.cash;
    for (const g of Object.keys(target.inv)) p.inv[g] = (p.inv[g] || 0) + target.inv[g];
    p.xp += target.xp;
    /* Gebäude & Anleihen auf die übernehmende Firma ummelden */
    for (const t of G.map) if (t.owner === targetId) t.owner = p.id;
    for (const b of G.bonds) {
      if (b.issuerId === targetId) b.issuerId = p.id;
      if (b.holderId === targetId) b.holderId = p.id;
    }
    /* Offene Direktverträge mit der aufgelösten Firma sind hinfällig */
    G.contracts = G.contracts.filter(c => c.fromId !== targetId && c.toId !== targetId);
    /* Aktienangebote aufräumen. Wichtig: verwahrte Anteile immer zurückgeben,
     * sonst fehlen sie in der Cap-Table und die Summe ist nicht mehr 100 %. */
    G.shareListings = G.shareListings.filter(l => {
      const sellerId = l.sellerId ?? l.companyId;
      if (l.companyId === targetId) return false;            // Firma verschwindet — Angebot hinfällig
      if (sellerId === targetId) {                            // Verkäufer wird übernommen — Anteile an den Käufer
        const company = G.players[l.companyId];
        if (company) company.equity[p.id] = (company.equity[p.id] || 0) + l.count;
        return false;
      }
      if (l.toId === targetId) { returnListingToSeller(l); return false; }   // Empfänger gibt es nicht mehr
      return true;
    });
    G.shareBids = G.shareBids.filter(b => b.companyId !== targetId && b.bidderId !== targetId);
    /* Neue Industrie(n) übernehmen (keine Duplikate) */
    p.stats.fusionen++;
    p.industries = [...new Set([...(p.industries || [p.industry]), ...(target.industries || [target.industry])])];
    logTx(p, "Fusion", `${target.name} übernommen (+${INDUSTRIES[target.industry]?.name ?? target.industry})`, target.cash);
    io.emit("notice", { text: `${p.name} fusioniert mit ${target.name} — jetzt auch in ${INDUSTRIES[target.industry]?.name ?? target.industry} tätig!` });
    /* Shop-Systeme der aufgelösten Firma laufen beim Käufer weiter — samt
     * Kunden. Ihre Rechenzentren gehören ihm ja jetzt auch. */
    for (const sw of Object.values(G.software || {})) if (sw.ownerId === targetId) sw.ownerId = p.id;
    /* Malprogramm samt Lizenz geht mit; das eigene Logo bleibt. */
    if (!paintEigenes(p)) for (const x of Object.values(G.paint || {})) if (x.ownerId === targetId) x.ownerId = p.id;
    if (!p.paintLizenz && target.paintLizenz) Object.assign(p, { paintLizenz: target.paintLizenz, paintLizenzStufe: target.paintLizenzStufe, paintLizenzName: target.paintLizenzName });
    if (!p.logo && target.logo) p.logo = { ...target.logo, v: (target.logo.v || 0) + 1 };
    p.swEp = (p.swEp || 0) + (target.swEp || 0);
    /* Falls die aufgelöste Firma selbst Anteile an DRITTEN Firmen hielt, gehen
     * die mit auf die übernehmende Firma über — sonst blieben sie verwaist. */
    for (const other of Object.values(G.players)) {
      if (other.id === targetId || !other.equity[targetId]) continue;
      other.equity[p.id] = (other.equity[p.id] || 0) + other.equity[targetId];
      delete other.equity[targetId];
    }
    /* Zielfirma auflösen: bestehende Verbindung trennen (falls online) und entfernen */
    if (target.socketId) { const ts = io.sockets.sockets.get(target.socketId); if (ts) ts.disconnect(true); delete G.socketToPid[target.socketId]; }
    delete G.players[targetId]; delete G.markt[targetId];
    ack?.({ ok: true });
  }));

  socket.on("bid", guard((p, { auctionId, amount }, ack) => {
    const a = G.auctions.find(a => a.id === auctionId);
    amount = Math.floor(+amount);
    if (!a) return ack?.({ error: "Auktion beendet" });
    if (amount < Math.max(a.minBid, a.bestBid + 1)) return ack?.({ error: "Gebot zu niedrig" });
    if (p.cash < amount) return ack?.({ error: "Zu wenig Kapital" });
    if (a.bestBidder) G.players[a.bestBidder] && (G.players[a.bestBidder].cash += a.bestBid);
    p.cash -= amount; a.bestBid = amount; a.bestBidder = p.id;
    ack?.({ ok: true });
  }));

  /* --- Chat & Direktverträge --- */
  socket.on("chat", guard((p, { room, text }, ack) => {
    if (!ROOMS.includes(room)) return ack?.({ error: "Raum unbekannt" });
    text = sicherText(String(text || "").slice(0, 300));
    /* Auch dieser Fall muss quittiert werden. Ein blankes return ließ die
     * Ack-Funktion des Clients für immer offen: wer darauf wartet, hängt, und
     * socket.io hält den Rückruf bis zum Verbindungsende im Speicher. */
    if (!text.trim()) return ack?.({ error: "Leere Nachricht" });
    const msg = { who: p.name, color: p.color, text, ts: Date.now() };
    G.chat[room].push(msg); if (G.chat[room].length > 100) G.chat[room].shift();
    io.emit("chat", { room, msg });
    ack?.({ ok: true });
  }));

  socket.on("offerContract", guard((p, { toId, good, qty, price }, ack) => {
    if (MODE === "plan") return ack?.({ error: "Verträge gibt es in der Planwirtschaft nicht — nutze Zuteilung oder Schwarzmarkt" });
    const to = G.players[toId];
    qty = Math.floor(+qty); price = +price;
    if (!to || toId === p.id || !GOODS[good] || !(qty > 0) || !(price > 0)) return ack?.({ error: "Ungültig" });
    if (p.inv[good] < qty) return ack?.({ error: "Nicht genug Ware für dieses Angebot" });
    /* Der Direktvertrag geht an der Börse vorbei — die Absprache gilt trotzdem,
     * sonst wäre er der bequemste Weg, sie zu unterlaufen. */
    const verstoss = kartellPreisVerstoss(p, good, price);
    if (verstoss) return ack?.({ error: verstoss });
    const c = { id: id(), fromId: p.id, from: p.name, toId, good, qty, price, status: "open", ttl: CONTRACT_TTL };
    G.contracts.push(c);
    emitTo(toId, "contractOffer", c);
    ack?.({ ok: true });
  }));

  socket.on("acceptContract", guard((p, { contractId }, ack) => {
    const c = G.contracts.find(c => c.id === contractId && c.toId === p.id && c.status === "open");
    if (!c) return ack?.({ error: "Vertrag nicht mehr offen" });
    const seller = G.players[c.fromId];
    if (!seller || seller.inv[c.good] < c.qty) { dropContract(c); return ack?.({ error: "Verkäufer kann nicht liefern" }); }
    if (p.cash < c.qty * c.price) return ack?.({ error: "Zu wenig Kapital" });
    p.cash -= c.qty * c.price; seller.inv[c.good] -= c.qty;
    settleTrade(c.good, c.qty, c.price, p.id, c.fromId);
    dropContract(c);
    ack?.({ ok: true });
  }));

  socket.on("declineContract", guard((p, { contractId }, ack) => {
    const c = G.contracts.find(c => c.id === contractId && c.toId === p.id);
    if (!c) return ack?.({ error: "Vertrag nicht gefunden" });
    emitTo(c.fromId, "notice", { text: `${p.name} lehnt dein Angebot über ${c.qty}× ${GOODS[c.good].name} ab.` });
    dropContract(c);
    ack?.({ ok: true });
  }));

  /* Verbindung weg (Tab zu, WLAN-Aussetzer, Reload) — Spieler bleibt mit vollem
   * Zustand erhalten; erst nach RECONNECT_GRACE_MS ohne Rückkehr räumt der
   * Tick-Loop endgültig auf (siehe runTick). Orders/Gebäude/Bonds bleiben so lange
   * unangetastet, ein rejoin mit dem gespeicherten Token setzt alles nahtlos fort. */
  socket.on("disconnect", () => {
    const pid = G.socketToPid[socket.id];
    delete G.socketToPid[socket.id];
    const p = G.players[pid];
    if (!p) return;
    /* Nach einem Verbindungsabriss meldet sich der Client sofort über eine neue
     * Verbindung zurück (rejoin), während das "disconnect" der alten oft erst
     * danach eintrifft. Ohne diese Prüfung setzte dieser Nachzügler socketId
     * wieder auf null — der Spieler blieb dann zwar handlungsfähig (Aktionen
     * laufen über socketToPid), bekam aber nie wieder ein "me": Bargeld und
     * Lager standen für den Rest der Runde eingefroren da, ohne Fehlermeldung. */
    if (p.socketId && p.socketId !== socket.id) return;
    p.disconnected = true; p.disconnectedAt = Date.now(); p.socketId = null;
    io.emit("notice", { text: `${p.name} hat die Verbindung verloren — kann wieder beitreten.` });
    /* Verlässt der Host den Warteraum, bevor die Runde läuft, könnte sonst
     * niemand mehr starten — die Wartenden säßen dauerhaft fest. */
    if (!G.started && pid === G.hostId) {
      const ersatz = Object.values(G.players).find(o => o.id !== pid && !o.disconnected);
      if (ersatz) {
        G.hostId = ersatz.id;
        io.emit("notice", { text: `${ersatz.name} übernimmt als Host.` });
      }
    }
    pushState();
  });
});

/* ---------- Server-Tick: 1×/s Produktion, Zinsen, Fristen, Auktionen ----------
 * Läuft komplett in try/catch: ein einzelner Bug in einem Tick darf niemals den
 * ganzen Prozess (und damit die Runde für alle Spieler) abschießen — Node killt
 * den Prozess sonst standardmäßig bei jeder unabgefangenen Exception im Timer. */
setInterval(() => {
  const _t0 = PERF ? process.hrtime.bigint() : 0n;
  try { runTick(); } catch (e) { console.error("Tick-Fehler (übersprungen):", e); }
  if (PERF) perf.maxTickMs = Math.max(perf.maxTickMs, Number(process.hrtime.bigint() - _t0) / 1e6);
}, 1000);
function runTick() {
  if (!G.started) return;   // Warteraum: nichts produzieren, keine Fristen laufen lassen
  G.tick++;
  /* Rundenende: die Bestenliste genau einmal fortschreiben. */
  if (G.winner && !G.hofGespeichert) { G.hofGespeichert = true; hofSpeichern(); }
  /* --- Renntage (nicht in Planwirtschaft und Kartellmodus) ---
   * In der Kartellwirtschaft geht es um Absprachen auf den Warenmärkten. Ein
   * Renntag mit eigenem Wettpool wäre ein zweites Spiel daneben, das von der
   * einzigen Frage ablenkt, die den Modus trägt: Hält sich das Kartell? */
  if (MODE !== "plan" && MODE !== "kartell" && !G.winner) {
    if (!G.rennen) {
      if (--G.naechstesRennenIn <= 0) {
        G.naechstesRennenIn = RENN_INTERVALL;
        rennAnkuendigen();   // Werkswagen fuellen das Feld, es geht auch ohne Spielerstall
      }
    } else {
      const r = G.rennen;
      r.rest--;
      /* 25 s nach der Ankuendigung, nicht sofort: Die Rennstaelle melden ihre
       * Wagen erst im Lauf der Anmeldephase. Eroeffnet man zu frueh, bewerten
       * die Kontore ein Feld aus lauter Werkswagen, und die spaeter gemeldeten
       * bleiben ohne Quote. */
      if (r.phase === "anmeldung" && r.rest === RENN_ANMELDUNG - 25) wettkontoreSetzen(r, 1);
      if (r.phase === "anmeldung" && r.rest === 20) wettkontoreSetzen(r, 2);
      if (r.phase === "anmeldung" && r.rest <= 0) rennStarten();
      else if (r.phase === "laeuft") { rennTick(); if (r.rest <= 0) rennBeenden(); }
      else if (r.phase === "ergebnis" && r.rest <= 0) { G.rennen = null; G.naechstesRennenIn = RENN_INTERVALL; }
    }
  }
  /* Das Kartellamt schaut jede Sekunde auf den Markt. */
  if (!G.winner) kartellamtTick();
  /* --- Kartellmodus: Bezirkskontrolle und Schutzgeld --- */
  if (MODE === "kartell" && G.started && !G.winner) {
    /* Während eines Tauziehens jede Sekunde neu rechnen — der Kontroll-Balken
     * soll live zucken, nicht im 5-Sekunden-Takt nachhinken. */
    if (G.tick % 5 === 0 || Object.keys(G.revierKaempfe || {}).length) bezirkeBerechnen();
    /* Tauziehen auflösen: Wer bei Ablauf vorn liegt, gewinnt den Bezirk.
     * Gleichstand geht an den Verteidiger — Angreifen muss sich lohnen MÜSSEN. */
    for (const [idxS, k] of Object.entries(G.revierKaempfe || {})) {
      if (k.bis > G.tick) continue;
      const idx = +idxS;
      delete G.revierKaempfe[idx];
      const pa = k.punkte[k.angreifer], pv = k.punkte[k.verteidiger];
      const name = BEZIRK_NAMEN[idx];
      if (pa > pv) {
        (G.besatzung ??= {})[idx] = { familie: k.angreifer, bis: G.tick + BESATZUNG_DAUER };
        /* Plünderung: die Kassen des Viertels — mehr Verteidiger-Gebäude, mehr Beute */
        const gebaeude = G.map.filter(t => t.btype && G.players[t.owner]?.familie === k.verteidiger &&
          bezirkVon(t.x, t.y) === idx).length;
        const beute = 800 + gebaeude * 100;
        const sieger = Object.values(G.players).filter(p2 => p2.familie === k.angreifer);
        const teil = Math.round(beute / Math.max(1, sieger.length));
        for (const m of sieger) { m.cash += teil; logTx(m, "Kartell", `Plünderung im ${name}`, teil); }
        G.familienRespekt[k.angreifer] = (G.familienRespekt[k.angreifer] || 0) + 6;
        G.familienRespekt[k.verteidiger] = Math.max(0, (G.familienRespekt[k.verteidiger] || 0) - 3);
        G.kampfSiege[k.angreifer] = (G.kampfSiege[k.angreifer] || 0) + 1;
        io.emit("revierErgebnis", { bezirk: idx, name, sieger: k.angreifer, verlierer: k.verteidiger,
          art: "erobert", beute, pa, pv, dauer: BESATZUNG_DAUER });
        io.emit("notice", { text: `⚔️ ${FAMILIEN[k.angreifer].name} EROBERT den ${name} (${pa}:${pv})! ${beute} $ geplündert — 5 min Besatzung, dann zählt wieder die Gebäudemehrheit.` });
      } else {
        G.familienRespekt[k.verteidiger] = (G.familienRespekt[k.verteidiger] || 0) + 3;
        io.emit("revierErgebnis", { bezirk: idx, name, sieger: k.verteidiger, verlierer: k.angreifer,
          art: "verteidigt", pa, pv });
        io.emit("notice", { text: `🛡️ ${FAMILIEN[k.verteidiger].name} VERTEIDIGT den ${name} (${pv}:${pa}) — der Angriff von ${FAMILIEN[k.angreifer].name} verpufft.` });
      }
      bezirkeBerechnen();
    }
    /* Abgelaufene Besatzungen und Sicherungen aufräumen */
    for (const [idxS, bes] of Object.entries(G.besatzung || {}))
      if (bes.bis <= G.tick) delete G.besatzung[idxS];
    for (const [idxS, bis] of Object.entries(G.gesichert || {}))
      if (bis <= G.tick) delete G.gesichert[idxS];
    /* Polizei: Sold im Minutentakt und der Blick auf das Einsatzziel */
    if (G.tick % 60 === 0) for (const p2 of Object.values(G.players)) {
      if (p2.familie !== "polizei") continue;
      p2.cash += POLIZEI_SOLD;
      logTx(p2, "Polizei", "Sold", POLIZEI_SOLD);
    }
    if (!G.winner && (G.polizeiPunkte || 0) >= POLIZEI_ZIEL) {
      const beste = Object.values(G.players).filter(p2 => p2.familie === "polizei")
        .sort((a, b) => netWorth(b) - netWorth(a))[0];
      if (beste) {
        G.winner = beste.name;
        G.winGrund = `Die Polizei hat die Stadt aufgeräumt — ${POLIZEI_ZIEL} erfolgreiche Einsätze`;
        G.report = buildReport(beste.id);
        io.emit("notice", { text: `🚔 DIE POLIZEI GEWINNT: ${POLIZEI_ZIEL} Einsätze abgeschlossen — die Stadt gehört wieder dem Gesetz. ${beste.name} führt die Ehrenliste an.` });
      }
    }
    if (G.tick % 60 === 0 && G.bezirke) {
      for (const b of G.bezirke) {
        if (!b.kontrolle) continue;
        const mitglieder = Object.values(G.players).filter(p2 => p2.familie === b.kontrolle);
        if (!mitglieder.length) continue;
        const teil = Math.round(SCHUTZGELD_JE_BEZIRK * (G.pateDekret === "schutz" ? 1.25 : 1) / mitglieder.length);
        for (const m of mitglieder) {
          m.cash += teil;
          questProg(m, "schutzgeld");
          logTx(m, "Kartell", `Schutzgeld aus dem ${b.name}`, teil);
        }
        G.familienRespekt[b.kontrolle] = (G.familienRespekt[b.kontrolle] || 0) + 2;
      }
    }
    /* Casino Municipale: Alle 30 s spielen die Bürger — der Netto-Erlös
     * (Quote × Ausbaustufe) geht an die Familie, die die Piazza hält. Bürger
     * gewinnen auch mal, aber gedeckelt: Das steckt bereits im Netto. */
    if (G.tick % 30 === 0) {
      const herr = gcasinoHerrscher();
      if (herr) {
        const q = GCASINO_QUOTEN[G.gcasino.quote];
        const brutto = Math.round(q.netto * G.gcasino.stufe * (G.pateDekret === "brot" ? 1.5 : 1));
        const bank = Object.values(G.players).filter(m => m.familie === herr);
        const teil = Math.round(brutto / Math.max(1, bank.length));
        for (const m of bank) { m.cash += teil; logTx(m, "Casino", `Bürger-Umsatz (${GCASINO_STILE[G.gcasino.stufe - 1]})`, teil); }
        if (q.respekt) G.familienRespekt[herr] = (G.familienRespekt[herr] || 0) + q.respekt;
        if (q.fahndung) G.fahndung[herr] = (G.fahndung[herr] || 0) + q.fahndung;
      }
    }
    familienPflegen();
    pateWahlTick();
    /* Wunschbrunnen: Alle 2 Minuten fischt die Giardini-Familie Münzen heraus. */
    if (G.tick % 120 === 0 && G.brunnenPot > 200) {
      const anteil = Math.round(G.brunnenPot * .15);
      G.brunnenPot -= anteil;
      wzKasse(8, anteil, "Münzen aus dem Wunschbrunnen gefischt");
    }
    /* Live-Roulette: Setzphase zu Ende -> Kugel fällt (Nummer steht fest, die
     * Clients drehen das Rad dorthin); nach der Drehphase wird ausgezahlt. */
    {
      const R = G.groulette;
      if (R.phase === "setzen" && G.tick >= R.endet) {
        R.phase = "drehen"; R.zahl = Math.floor(Math.random() * 37); R.endet = G.tick + 8;
      } else if (R.phase === "drehen" && G.tick >= R.endet) {
        const rot = GROULETTE_ROT.has(R.zahl);
        const gewinner = [];
        for (const e of R.einsaetze) {
          const pl = G.players[e.pid]; if (!pl) continue;
          const faktor = e.art === "zahl" ? (e.zahl === R.zahl ? 36 : 0)
            : (R.zahl !== 0 && (e.art === "rot") === rot ? 2 : 0);
          if (faktor) { gcasinoGewinn(pl, e.einsatz * faktor, "Roulette"); gewinner.push(pl.name); }
        }
        const farbe = R.zahl === 0 ? "Zero — die Bank lacht" : rot ? "Rot" : "Schwarz";
        io.emit("notice", { text: `\u{1F3A1} Roulette: Die ${R.zahl} (${farbe}). ${gewinner.length ? "Es kassieren: " + [...new Set(gewinner)].join(", ") : "Das Haus räumt den Tisch ab."}` });
        R.letzteZahl = R.zahl; R.letzteGewinner = [...new Set(gewinner)];
        R.phase = "warten"; R.einsaetze = []; R.endet = 0;
      }
    }
    /* Blackjack: geben, Zug-Timeouts, Dealer, Abrechnung */
    {
      const B = G.gblackjack;
      if (B.phase === "setzen" && G.tick >= B.endet) {
        for (const s of B.spieler) { s.karten = [karteZiehen(), karteZiehen()]; s.fertig = bjSumme(s.karten) === 21; }
        B.dealer = [karteZiehen()];
        B.phase = "ziehen"; B.dran = -1;
        gblackjackWeiter();
      } else if (B.phase === "ziehen" && G.tick >= B.endet) {
        const s = B.spieler[B.dran];
        if (s) s.fertig = true;   // Zeit um -> automatisch halten
        gblackjackWeiter();
      } else if (B.phase === "vorbei" && G.tick >= B.endet) {
        Object.assign(B, { phase: "warten", endet: 0, dran: -1, dealer: [], spieler: [] });
      }
    }
    /* Poker: geben, Zug-Timeouts, Aufräumen */
    {
      const P = G.gpoker;
      if (P.phase === "setzen" && G.tick >= P.endet) {
        if (P.spieler.length >= 2) {
          P.deck = deckNeu();
          for (const s of P.spieler) s.karten = [P.deck.pop(), P.deck.pop()];
          P.strasse = 0; P.aktBet = 0; P.raises = 0; P.dran = 0; P.phase = "wetten"; P.endet = G.tick + 25;
        } else {
          const s = P.spieler[0];
          const pl = s && G.players[s.pid];
          if (pl) { pl.cash += P.einsatz; logTx(pl, "Casino", "Poker: niemand kam — Ante zurück", P.einsatz); }
          Object.assign(P, { phase: "warten", endet: 0, pot: 0, board: [], dran: -1, spieler: [] });
        }
      } else if (P.phase === "wetten" && G.tick >= P.endet) {
        const s = P.spieler[P.dran];
        if (s) {
          const pl = G.players[s.pid];
          gpokerAktion(pl || {}, s, P.aktBet - s.gesetzt > 0 ? "fold" : "check");
        }
      } else if (P.phase === "vorbei" && G.tick >= P.endet) {
        Object.assign(P, { phase: "warten", endet: 0, pot: 0, board: [], dran: -1, aktBet: 0, raises: 0, spieler: [] });
      }
    }
    /* Die Bots zieht es an die Tische: Sie setzen beim Roulette mit, nehmen am
     * Blackjack- und Poker-Tisch Platz und spielen ordentlich ihre Züge. */
    {
      const tischBots = Object.values(G.players).filter(b => b.bot && b.familie && b.familie !== "polizei" && b.cash > 1500);
      const casinoOffen = !!gcasinoHerrscher();
      const R2 = G.groulette;
      if (casinoOffen && R2.phase === "setzen" && R2.endet - G.tick <= 15) for (const b of tischBots) {
        if (R2.einsaetze.some(e => e.pid === b.id) || Math.random() > .06) continue;
        const einsatz = 100 * (1 + Math.floor(Math.random() * 4));
        const art = Math.random() < .12 ? "zahl" : Math.random() < .5 ? "rot" : "schwarz";
        gcasinoEinsatz(b, einsatz, "Roulette");
        R2.einsaetze.push({ pid: b.id, name: b.name, farbe: b.color, art,
          zahl: art === "zahl" ? Math.floor(Math.random() * 37) : null, einsatz });
      }
      const B2 = G.gblackjack;
      if (casinoOffen && B2.phase === "setzen" && B2.spieler.length < 4) for (const b of tischBots) {
        if (B2.spieler.some(s => s.pid === b.id) || Math.random() > .05) continue;
        const einsatz = 100 * (1 + Math.floor(Math.random() * 3));
        gcasinoEinsatz(b, einsatz, "Blackjack");
        B2.spieler.push(bjSitzNeu(b, einsatz));
      }
      if (B2.phase === "ziehen") {
        const s = B2.spieler[B2.dran], pl = s && G.players[s.pid];
        if (pl?.bot && G.tick >= B2.endet - 17) {   // ~3 s Bedenkzeit
          const hand = s.aktiv === 2 ? s.karten2 : s.karten;
          const sum = bjSumme(hand);
          let akt = sum < 17 ? "hit" : "stand";
          if (hand.length === 2 && (sum === 10 || sum === 11) && pl.cash > s.einsatz && Math.random() < .5) akt = "double";
          else if (s.aktiv === 1 && !s.karten2 && hand.length === 2 && hand[0].bj === hand[1].bj && hand[0].bj >= 8 && pl.cash > s.einsatz && Math.random() < .5) akt = "split";
          gblackjackAktion(pl, s, akt);
        }
      }
      const P2 = G.gpoker;
      const pokerSitz = b => {
        b.cash -= P2.einsatz; P2.pot += P2.einsatz;
        logTx(b, "Casino", "Poker: Ante", -P2.einsatz);
        P2.spieler.push({ pid: b.id, name: b.name, farbe: b.color, karten: [], gefoldet: false,
          gesetzt: 0, dranWar: false, ergebnis: null, wert: null });
      };
      /* Ab und zu eroeffnet ein Bot selbst einen Tisch — kleiner Grundeinsatz,
       * damit auch die Kollegen (und Menschen) mithalten koennen. */
      if (casinoOffen && P2.phase === "warten" && Math.random() < .012) {
        const b = tischBots[Math.floor(Math.random() * tischBots.length)];
        if (b && b.cash > 100 * 8 && !G.gblackjack.spieler.some(s => s.pid === b.id)) {
          P2.einsatz = 100 * (1 + Math.floor(Math.random() * 2));
          P2.pot = 0; P2.board = [];
          pokerSitz(b);
          P2.phase = "setzen"; P2.endet = G.tick + 15;
          io.emit("notice", { text: `\u{1F0A1} ${b.name} eröffnet einen Poker-Tisch (Grundeinsatz ${P2.einsatz} $) — wer setzt sich dazu? (15 s)` });
        }
      }
      if (casinoOffen && P2.phase === "setzen" && P2.spieler.length < 4) for (const b of tischBots) {
        if (P2.spieler.some(s => s.pid === b.id) || b.cash < P2.einsatz * 6 || Math.random() > .12) continue;
        pokerSitz(b);
      }
      /* Wahrzeichen: Bots spenden, schmuggeln, wetten und werfen Münzen. */
      for (const b of tischBots) {
        if (Math.random() > .012) continue;
        const wurf = Math.random();
        if (wurf < .3) {
          if ((G.fahndung[b.familie] || 0) > 40 && b.cash > 1500)
            wzAktion(b, { art: "kathedrale", betrag: 300 + 100 * Math.floor(Math.random() * 5) });
        } else if (wurf < .5) {
          if (b.cash > 600) wzAktion(b, { art: "brunnen", betrag: 50 + 50 * Math.floor(Math.random() * 4) });
        } else if (wurf < .62) {
          if (b.cash > 1500) wzAktion(b, { art: "yacht", yacht: 1 + Math.floor(Math.random() * 3), betrag: 100 + 100 * Math.floor(Math.random() * 3) });
        } else if (wurf < .82) {
          const heiss = ILLEGAL.find(g2 => Math.floor(b.inv[g2] || 0) >= 5);
          if (heiss && Math.random() < .5) wzAktion(b, { art: "kai", good: heiss });
        } else {
          if (b.cash > 3000 && Object.values(G.revierKaempfe || {}).some(k => k.punkte?.[b.familie] != null))
            wzAktion(b, { art: "villa" });
        }
      }
      if (P2.phase === "wetten") {
        const s = P2.spieler[P2.dran], pl = s && G.players[s.pid];
        if (pl?.bot && G.tick >= P2.endet - 21) {   // ~4 s Bedenkzeit
          const kosten = P2.aktBet - s.gesetzt;
          let akt = kosten > 0 ? "call" : "check";
          if (kosten === 0 && P2.raises < 3 && pl.cash > P2.einsatz * 3 && Math.random() < .18) akt = "raise";
          else if (kosten > 0 && Math.random() < .12) akt = "fold";
          if (akt !== "fold" && akt !== "check" && pl.cash < kosten + (akt === "raise" ? P2.einsatz : 0)) akt = "fold";
          gpokerAktion(pl, s, akt);
        }
      }
    }
    /* Endbedingung — VIER Wege zur Macht:
     *   Herrschaft: 6 der 9 Bezirke halten
     *   Dynastie:   3 Patenwahlen gewinnen
     *   Vendetta:   10 Bezirke im Revierkampf erobern
     *   Imperium:   Casino „La Dorata“ + Piazza + 100.000 $ in der Familienkasse
     * Die Familie gewinnt gemeinsam; den Titel trägt ihr vermögendstes Mitglied. */
    if (!G.winner && G.bezirke) {
      const famSieg = (fid, grund) => {
        const boss = Object.values(G.players).filter(p2 => p2.familie === fid)
          .sort((x2, y2) => netWorth(y2) - netWorth(x2))[0];
        if (!boss) return;
        G.winner = boss.name;
        G.winGrund = `${FAMILIEN[fid].name}: ${grund}`;
        G.report = buildReport(boss.id);
        io.emit("notice", { text: `\u{1F3C6} ${FAMILIEN[fid].name} — ${grund}! ${boss.name} ist der Boss der Bosse.` });
      };
      const warnung = (fid, art, text) => {
        const key = fid + ":" + art;
        if (G.siegWarnungen[key]) return;
        G.siegWarnungen[key] = true;
        io.emit("notice", { text: `\u26A0 ${text}` });
      };
      const zaehl = {};
      for (const b of G.bezirke) if (b.kontrolle) zaehl[b.kontrolle] = (zaehl[b.kontrolle] || 0) + 1;
      for (const fid of Object.keys(FAMILIEN)) {
        if (G.winner) break;
        const bez = zaehl[fid] || 0;
        /* Herrschaft */
        if (bez >= 6) { famSieg(fid, `kontrolliert ${bez} von 9 Bezirken — die Stadt gehört ihr`); break; }
        if (bez === 5) warnung(fid, "stadt", `${FAMILIEN[fid].name} hält 5 Bezirke — noch einer, und die Stadt fällt!`);
        /* Dynastie */
        const w = G.wahlSiege[fid] || 0;
        if (w >= 3) { famSieg(fid, `stellt zum dritten Mal den Paten — die Dynastie regiert die Stadt`); break; }
        if (w === 2) warnung(fid, "dynastie", `${FAMILIEN[fid].name} hat 2 Patenwahlen gewonnen — eine dritte besiegelt die Dynastie!`);
        /* Vendetta */
        const s = G.kampfSiege[fid] || 0;
        if (s >= 10) { famSieg(fid, `hat 10 Bezirke im Revierkampf erobert — die Vendetta ist vollstreckt`); break; }
        if (s === 8) warnung(fid, "vendetta", `${FAMILIEN[fid].name} steht bei 8 von 10 Vendetta-Siegen — stoppt sie!`);
        /* Imperium */
        const imperium = G.gcasino.stufe >= 5 && G.bezirke[GCASINO_BEZIRK]?.kontrolle === fid;
        if (imperium && (G.familienBank[fid] || 0) >= 100000) {
          famSieg(fid, `„La Dorata“, die Piazza und 100.000 $ in der Kasse — das Imperium steht`); break;
        }
        if (imperium && (G.familienBank[fid] || 0) >= 80000)
          warnung(fid, "imperium", `${FAMILIEN[fid].name} hortet ${Math.round(G.familienBank[fid] / 1000)}k $ im goldenen Casino — bei 100k steht das Imperium!`);
      }
    }
    /* Werttransporte: spawnen, rollen, an Sperren hängenbleiben, entkommen. */
    if (--G.naechsterTransport <= 0) {
      G.naechsterTransport = TRANSPORT_INTERVALL;
      const linien = transportLinien();
      if (linien.length) {
        const l = linien[Math.floor(Math.random() * linien.length)];
        const arten = Object.entries(TRANSPORT_ARTEN)
          .flatMap(([id2, a]) => Array(a.gewicht).fill(id2));
        const art = arten[Math.floor(Math.random() * arten.length)];
        const dir = Math.random() < 0.5 ? 1 : -1;
        G.transporte.push({ id: id(), art, achse: l.achse, linie: l.linie,
          von: l.von, bis: l.bis, pos: dir === 1 ? l.von : l.bis, dir, gestoppt: 0 });
        io.emit("notice", { text: `🚚 Ein ${TRANSPORT_ARTEN[art].name} ist in der Stadt unterwegs — wer greift zu?` });
      }
    }
    for (const tr of [...G.transporte]) {
      if (tr.gestoppt) {
        /* An einer Sperre festgesetzt: leichte Beute — aber nur eine Minute,
         * dann trauen sich die Fahrer an der Barrikade vorbei. */
        if (++tr.gestoppt > 60) { tr.gestoppt = 0; }
        continue;
      }
      tr.pos += tr.dir * TRANSPORT_TEMPO;
      if (tr.pos < (tr.von ?? 0) || tr.pos > (tr.bis ?? (tr.achse === "x" ? MAP_W : MAP_H) - 1)) {
        G.transporte = G.transporte.filter(t2 => t2 !== tr);
        continue;
      }
      const { t: kachel } = transportKachel(tr);
      if (kachel?.sperre) tr.gestoppt = 1;
    }
    /* Sperren verfallen; Fahndung kühlt langsam ab; bei 100 kommt die Razzia. */
    for (const t of G.map) if (t.sperre && t.sperre.bis <= G.tick) t.sperre = null;
    if (G.tick % 30 === 0)
      for (const f of Object.keys(G.fahndung)) G.fahndung[f] = Math.max(0, G.fahndung[f] - 1);
    for (const [fid, wert] of Object.entries(G.fahndung)) {
      if (wert < 100) continue;
      G.fahndung[fid] = 40;
      G.familienRespekt[fid] = Math.max(0, (G.familienRespekt[fid] || 0) - 10);
      let beschlagnahmt = 0;
      for (const m of Object.values(G.players)) {
        if (m.familie !== fid) continue;
        for (const g of ILLEGAL) {
          const n = Math.floor(m.inv[g] || 0);
          if (n > 0) { m.inv[g] = 0; beschlagnahmt += n; }
        }
        const strafe = Math.min(m.cash, 1000);
        m.cash -= strafe;
        logTx(m, "Kartell", "Razzia! Illegale Ware beschlagnahmt, Strafe kassiert", -strafe);
      }
      io.emit("notice", { text: `🚨 RAZZIA bei ${FAMILIEN[fid].name}! ${beschlagnahmt} Einheiten heiße Ware beschlagnahmt, −10 Respekt.` });
    }
  }
  /* Stromabschaltung (Planwirtschaft): Wurde das Volkswirtschaftsziel der
   * Vorphase verfehlt, läuft jede Produktion nur mit halber Kraft. */
  const SPERR = (MODE === "plan" && G.plan?.stromsperre) ? 0.5 : 1;
  swTick();   // Software: Auslastung, Ruf, Werbe-Abos — vor dem Verkauf
  stadtnetzTick();
  /* Produktion: Enabler-Rohstoffe im Lager boosten (und werden verbraucht) */
  for (const t of G.map) {
    if (!t.btype || !t.owner) continue;
    const p = G.players[t.owner], bt = BTYPES[t.btype];
    if (!p) continue;
    if (imBau(t)) continue;   // Anlage in Arbeit: produziert und verkauft noch nichts
    if (bt.studio || bt.rz) {   // Software: Entwicklungspunkte bzw. Rechenzentrum am Netz
      if (t.paused) { t.rzAktiv = false; continue; }
      swBetrieb(t, p, bt, SPERR);
      continue;
    }
    if (bt.retail) {   // Shop: verkauft konfigurierte Ware zum selbstgesetzten Preis
      if (t.paused) continue;
      /* Online-Marktplatz: ohne fertig installiertes System kein Verkauf.
       * Mit System läuft er so schnell, wie die Module und die Auslastung
       * des Anbieters es zulassen; je Verkauf geht die Gebühr an ihn. */
      let swProd = null, swKap = 1;
      if (bt.online) {
        swProd = swOffen(t) ? swVon(t.system.produktId) : null;
        if (!swProd) continue;
        swKap = swProd.portal ? 1 : (G.swFaktor?.[swProd.id] ?? 1);
        if (!(swKap > 0)) continue;
      }
      t.shop?.forEach((slot, i) => {
        if (!slot?.good || !(slot.price > 0)) return;
        /* Werbung hebt den Bezugspreis: derselbe Verkaufspreis wirkt dadurch
         * günstiger und bremst das Tempo weniger. Stufe 3 eines Branchenbaums
         * wirkt genauso, aber nur auf die Waren dieser Branche. */
        const swF = swProd ? swKap * swTempoFuer(swProd, slot.good) : 1;
        const bezug = MM[slot.good].price * adBoost(p) * (swProd ? swPreisFuer(swProd, slot.good) : 1);
        let q = Math.min(p.inv[slot.good], bt.retail.base * swF * retailFlow(slot.good) * shopSpeed(slot.good, slot.price, bezug));
        if (slot.qty != null) q = Math.min(q, slot.qty);   // begrenzte Verkaufsmenge
        if (q <= 0) return;
        p.inv[slot.good] -= q;
        const erloes = q * slot.price, gebuehr = swProd ? erloes * swProd.gebuehr / 100 : 0;
        p.cash += erloes - gebuehr; addRevenue(p, erloes);
        if (gebuehr) { p.stats.ausgaben += gebuehr; swGebuehr(swProd, gebuehr); }
        if (bt.online) { const l = (t._lauf ??= {}); const e = (l[slot.good] ??= { n: 0, b: 0 }); e.n += q; e.b += erloes; }
        const r = salesRec(p, slot.good); r.botQty += q; r.botRev += q * slot.price;
        kartellUmsatzMerken(p, slot.good, q * slot.price);
        noteSold(slot.good, q);
        if (slot.qty != null) {
          slot.qty -= q;
          if (slot.qty <= 0.001) {   // Auftrag komplett verkauft
            t.shop[i] = null;
            logTx(p, "Verkauf", `${bt.name}: Verkaufsauftrag ${GOODS[slot.good].name} @ ${slot.price} $ abgeschlossen`, 0);
            emitTo(p.id, "notice", { text: `${bt.name}: ${GOODS[slot.good].name}-Auftrag ausverkauft (@ ${slot.price} $/Stk).` });
          }
        }
      });
      /* Online-Shop: alle 5 s die Verkäufe an Stadtkunden als "Bestellung"
       * festhalten — daraus speist sich der Live-Feed im Shop-Fenster. */
      /* Vorrat je Regal öffentlich machen (Lager des Händlers, gedeckelt durch
       * die Auftragsmenge), damit Käufer im Shop sehen, was es noch gibt. */
      if (bt.online && G.tick % 5 === 0) t.vorrat = (t.shop || []).map(sl => sl?.good ? Math.floor(Math.min(p.inv[sl.good] || 0, sl.qty ?? Infinity)) : 0);
      if (bt.online && t._lauf && G.tick % 5 === 0) {
        for (const [g, e] of Object.entries(t._lauf)) if (e.n >= 0.5)
          (t.bestellungen ??= []).unshift({ id: G.tick + g, g, n: Math.round(e.n), b: Math.round(e.b * 100) / 100, t: G.tick, von: "Stadtkunde" });
        if (t.bestellungen?.length > 8) t.bestellungen.length = 8;
        t._lauf = null;
      }
      continue;
    }
    if (bt.proc) {   // Verarbeitung: Inputs anteilig verbrauchen, Output erzeugen
      if (t.paused) continue;
      const lvl = levelMult(t.level);   // Elektronik-Upgrade: mehr Input rein, mehr Output raus
      let frac = 1;
      for (const [g, need] of Object.entries(bt.proc.in)) frac = Math.min(frac, (p.inv[g] || 0) / (need * lvl));
      if (frac > 0) {
        frac *= SPERR;   // Stromabschaltung drosselt Verbrauch und Ausstoß gleichermaßen
        for (const [g, need] of Object.entries(bt.proc.in)) p.inv[g] -= need * lvl * frac;
        const menge = bt.proc.rate * lvl * frac;
        p.inv[bt.proc.out] += menge;
        p.stats.produziert[bt.proc.out] = (p.stats.produziert[bt.proc.out] || 0) + menge;
      }
      continue;
    }
    if (!bt.out) continue;
    const stufe = levelMult(t.level);
    let mult = 1;
    /* Boost-Verbrauch hängt an der Größe des Betriebs, nicht an einer festen
     * Stückzahl. Vorher verschlang jeder Betrieb 1 Einheit JE TICK — bei der
     * Mine also 60 Öl pro Minute, mehr als drei Viertel dessen, was eine ganze
     * Ölpumpe fördert. Öl fehlte dadurch überall sonst: Stahlwerk und
     * Raffinerie brauchen es zwingend, also gab es weder Stahl noch Diesel und
     * damit auch keine Fahrzeuge. Obendrein war der Handel für die Mine ein
     * sicheres Verlustgeschäft (8,80 $ Einsatz für 4,60 $ Mehrertrag) — sie tat
     * es trotzdem, weil der Verbrauch automatisch läuft. */
    for (const r of bt.boosts || []) {
      const bedarf = bt.rate * stufe * 0.5;
      if ((p.inv[r] || 0) >= bedarf) { p.inv[r] -= bedarf; mult += BOOST_MULT; }
    }
    const menge = bt.rate * mult * stufe * SPERR;   // Elektronik-Upgrade: +30 %/Stufe
    p.inv[bt.out] += menge;
    p.stats.produziert[bt.out] = (p.stats.produziert[bt.out] || 0) + menge;
  }
  /* Referenzkurs (Ticker/Bewertung): Anker folgt Angebot/Nachfrage, Kurs driftet im Band.
   * Reine Preis-Simulation ohne Gegenpartei — die Börse selbst ist ausschließlich P2P,
   * es gibt keinen Bot mehr, der Spieler-Orders automatisch kauft oder verkauft. */
  for (const k of Object.keys(GOODS)) {
    const mm = MM[k];
    mm.sold *= 0.994;                                                   // Druck zerfällt (~2 min HWZ)
    const targetAnchor = BASEP[k] * Math.min(1.3, Math.max(0.5, 1.15 - 0.4 * soldPressure(k)));
    mm.anchor += (targetAnchor - mm.anchor) * 0.02;                     // Anker wandert langsam
    mm.price += (Math.random() - 0.5) * mm.band * 0.15;                 // Zufallsdrift
    if (G.lastTrade[k]) mm.price += (G.lastTrade[k] - mm.price) * 0.03; // echte Trades ziehen leicht
    mm.price = Math.min(mm.anchor + mm.band, Math.max(mm.anchor - mm.band, mm.price)); // Band um Anker
    mm.price = Math.round(mm.price * 100) / 100;
  }
  /* Anleihen: Kupon pro Sekunde = principal * rate / 60 (Zins „pro Minute") */
  for (const b of [...G.bonds]) {
    if (!b.holderId) continue;
    const debtor = G.players[b.issuerId], holder = G.players[b.holderId];
    const coupon = b.principal * b.rate / 60;
    if (debtor && debtor.cash >= coupon) {
      debtor.cash -= coupon; debtor.fin.zinsAufwand += coupon; debtor.stats.zinsAufwand += coupon;
      if (holder) { holder.cash += coupon; holder.fin.zinsErtrag += coupon; holder.stats.zinsErtrag += coupon; }
      b.strikes = 0;
      const lienTile = G.map.find(t => t.owner === b.issuerId && t.lien);
      if (lienTile && !G.bonds.some(x => x !== b && x.issuerId === b.issuerId && x.strikes > 0)) lienTile.lien = false;
    } else if (debtor) {
      b.strikes++;
      if (b.strikes === 3) {           // Pfandrecht setzen
        const t = G.map.find(t => t.owner === debtor.id && t.btype && !t.lien);
        if (t) { t.lien = true; io.emit("notice", { text: `Pfandrecht auf ${BTYPES[t.btype].name} von ${debtor.name}` }); }
      }
      if (b.strikes >= 15) seizeAndAuction(debtor, b);
    }
    b.termLeft--;
    if (b.termLeft <= 0 && G.bonds.includes(b)) {   // Tilgung fällig
      if (debtor && debtor.cash >= b.principal) {
        debtor.cash -= b.principal;
        logTx(debtor, "Anleihen", "Anleihe getilgt", -b.principal);
        if (holder) { holder.cash += b.principal; logTx(holder, "Anleihen", `Tilgung von ${debtor.name}`, b.principal); }
        G.bonds.splice(G.bonds.indexOf(b), 1);
        io.emit("notice", { text: `${debtor.name} hat eine Anleihe (${b.principal} $) getilgt.` });
      } else if (debtor) {
        b.termLeft = 30; b.strikes += 5;             // Verzug bei Tilgung eskaliert
      }
    }
  }
  /* Unverkaufte Emissionen nach Laufzeit vom Markt nehmen */
  G.bonds = G.bonds.filter(b => b.holderId || (--b.termLeft ?? 1) > -60);
  /* Auktionen */
  for (const a of [...G.auctions]) {
    a.tLeft--;
    if (a.tLeft > 0) continue;
    G.auctions.splice(G.auctions.indexOf(a), 1);
    const t = G.map[a.tileIdx];
    if (a.bestBidder && G.players[a.bestBidder]) {
      t.owner = a.bestBidder; t.btype = a.btype;
      logTx(G.players[a.bestBidder], "Auktion", `Zuschlag ${BTYPES[a.btype].name}`, -a.bestBid);
      const creditor = G.players[a.creditorId];
      if (creditor) { creditor.cash += a.bestBid;    // Erlös an den Gläubiger
        logTx(creditor, "Auktion", `Verwertungserlös ${BTYPES[a.btype].name}`, a.bestBid); }
      io.emit("notice", { text: `Zuschlag: ${BTYPES[a.btype].name} für ${a.bestBid} $ an ${G.players[a.bestBidder].name}` });
    } else {
      /* Ohne Gebot verfällt das Los. Die Fahrzeuge müssen dabei mit weg —
       * sonst blieben sie als herrenloses Inventar auf einer leeren Kachel
       * liegen und tauchten beim nächsten Bauherrn wieder auf. */
      if (a.autos) io.emit("notice", { text: `${a.autos} Fahrzeug(e) im verfallenen Rennstall sind verloren.` });
      t.autos = undefined;
      io.emit("notice", { text: `Auktion ohne Gebot beendet — ${BTYPES[a.btype].name} verfällt.` });
    }
  }
  /* Gruppenauftrag: spawnen bzw. Ablauf (Waren zurück an die Einzahler) */
  /* Großaufträge der Stadt sind ein Marktinstrument — in der Planwirtschaft
   * übernimmt das Plansoll ihre Rolle. */
  if (MODE !== "plan" && !G.groupOrder && --G.nextGroupIn <= 0) spawnGroupOrder();
  else if (G.groupOrder && --G.groupOrder.ttl <= 0) {
    for (const [pid, goods] of Object.entries(G.groupOrder.contrib)) {
      const p = G.players[pid];
      if (p) for (const [g, qty] of Object.entries(goods)) p.inv[g] += qty;
    }
    G.stadtkasse += G.groupOrder.praemie || 0;
    io.emit("notice", { text: `Gruppenauftrag für ${G.groupOrder.city} abgelaufen — Einzahlungen wurden zurückerstattet.` });
    G.groupOrder = null; G.nextGroupIn = GROUP_GAP();
  }
  /* Werbe-Reichweite zerfällt: wer aufhört zu werben, ist nach gut zwei Minuten
   * wieder beim Ø-Kurs. */
  for (const p of Object.values(G.players)) {
    if (p.adReach > 0) p.adReach = p.adReach < 0.5 ? 0 : p.adReach * AD_DECAY;
  }
  /* Umsatzfenster weiterdrehen: jede Minute rutscht ein neuer Eimer nach vorn,
   * der älteste fällt hinten raus. Damit misst rev10() immer die letzten 10 min. */
  if (G.tick % 60 === 0) for (const p of Object.values(G.players)) {
    p.revBuckets.unshift(0);
    p.revBuckets.length = REV_WINDOW_MIN;
  }
  /* Direktangebote verfallen, wenn der Empfänger nicht reagiert */
  for (let i = G.contracts.length - 1; i >= 0; i--) {
    const c = G.contracts[i];
    if (c.status !== "open" || --c.ttl > 0) continue;
    emitTo(c.fromId, "notice", { text: `Dein Angebot an ${G.players[c.toId]?.name ?? "einen Spieler"} ist abgelaufen.` });
    G.contracts.splice(i, 1);
  }
  /* Kaufanfragen verfallen, wenn niemand entscheidet */
  for (let i = G.shareBids.length - 1; i >= 0; i--) {
    if (--G.shareBids[i].ttl <= 0) {
      emitTo(G.shareBids[i].bidderId, "notice", { text: `Deine Kaufanfrage an ${G.players[G.shareBids[i].companyId]?.name ?? "eine Firma"} ist abgelaufen.` });
      G.shareBids.splice(i, 1);
    }
  }
  /* Nachrichtenzentrale: Marktbericht alle zwei Minuten. Bewusst versetzt zur
   * vollen Minute, damit er nicht mit der Dividendenmeldung zusammenfällt. */
  /* Kartellmodus: keine Nachrichtenzentrale — die Stadt redet nicht mit der Presse. */
  if (MODE !== "plan" && MODE !== "kartell" && G.tick > 60 && G.tick % NEWS_INTERVAL === 0) sendeMarktbericht();
  /* Aktien: Dividendenausschüttung alle 10 min */
  if (--G.nextDividendIn <= 0) { distributeDividends(); steuernErheben(); G.nextDividendIn = DIVIDEND_INTERVAL; }
  finanzamtTick();
  if (G.tick % MARKT.TAG === 0) marktTag();   // Aktienkurse: F messen, P nachführen
  /* Kurswetten: Annahme → Laufzeit → Abrechnung */
  wettTick();
  /* Fahrergehälter: eine laufende Verpflichtung, kein Einmalkauf. Wer nicht
   * zahlen kann, verliert den Fahrer — er geht zurück in den Pool und steht
   * den Mitbewerbern offen. Genau deshalb ist ein Spitzenfahrer eine Wette
   * auf das eigene Preisgeld und nicht einfach eine Ausgabe. */
  /* Fanbasis: zerfaellt jeden Tick, zahlt alle FAN_TAKT Sekunden aus. Gebuendelt,
   * weil eine Buchung je Sekunde das Finanzlog unlesbar machen wuerde. */
  if (MODE === "renntag") {
    for (const p of Object.values(G.players)) {
      if (!p.fans) continue;
      p.fans *= FAN_ZERFALL;
      if (p.fans < 1) p.fans = 0;
    }
    if (--G.fanAuszahlungIn <= 0) {
      G.fanAuszahlungIn = FAN_TAKT;
      for (const p of Object.values(G.players)) {
        const hubs = fanHubs(p);
        if (!hubs.length || !p.fans) continue;
        /* Ausbaustufen wirken wie ueberall: je Stufe 30 % mehr. */
        const stufen = hubs.reduce((sum, t) => sum + levelMult(t.level), 0) / hubs.length;
        const betrag = Math.round(p.fans * FAN_ERTRAG * FAN_TAKT * fanFaktor(hubs.length) * stufen);
        if (betrag <= 0) continue;
        p.cash += betrag;
        addRevenue(p, betrag);
        logTx(p, "Motorsport", `Fan-Hub: ${Math.round(p.fans).toLocaleString("de-DE")} Fans`, betrag);
      }
    }
  }
  if (--G.fahrerGehaltIn <= 0) {
    G.fahrerGehaltIn = FAHRER_GEHALT_TAKT;
    for (const f of G.fahrer) {
      if (!f.teamId) continue;
      const team = G.players[f.teamId];
      if (!team) { f.teamId = null; f.autoId = null; continue; }
      if (team.cash >= f.gehalt) {
        team.cash -= f.gehalt;
        team.stats.ausgaben += f.gehalt;
        logTx(team, "Motorsport", `Gehalt ${f.name}`, -f.gehalt);
      } else {
        for (const t of G.map) for (const a of t.autos || []) if (a.fahrerId === f.id) a.fahrerId = null;
        f.teamId = null; f.autoId = null;
        logTx(team, "Motorsport", `${f.name} hat gekündigt — Gehalt nicht gedeckt`, 0);
        io.emit("notice", { text: `${f.name} verlässt ${team.name}: Gehalt nicht bezahlt.` });
      }
    }
  }
  /* Nettovermögens-Verlauf (alle 10 s ein Punkt, max. 120 Punkte = 20 min) */
  if (G.tick % 10 === 0) for (const p of Object.values(G.players)) {
    p.nwHist.push(Math.round(netWorth(p)));
    if (p.nwHist.length > 120) p.nwHist.shift();
  }
  /* Kursverlauf je Ware — Grundlage der Sparklines an der Börse.
   * Bewusst NICHT Teil des Zustands: der geht jede Sekunde an jeden Spieler,
   * die Historie ändert sich aber nur alle 10 s. Als eigenes Ereignis kostet
   * sie ein Zehntel der Daten (33 Waren × 60 Punkte wären sonst rund 20 KB
   * pro Sekunde und Spieler, nur damit sich neunmal von zehn nichts ändert). */
  if (G.tick % 10 === 0) {
    for (const k of Object.keys(GOODS)) {
      const h = (G.priceHist[k] ??= []);
      h.push(MM[k].price);
      if (h.length > 60) h.shift();          // 60 Punkte = 10 min Rückblick
    }
    /* Firmenwerte im selben Takt. p.nwHist gibt es zwar schon, das steckt aber
     * im PRIVATEN Zustand — man sähe damit nur die eigene Kurve, während die
     * Kurstafel gerade den Vergleich mit den anderen leisten soll. */
    for (const pl of Object.values(G.players)) {
      const h = (G.firmHist[pl.id] ??= []);
      h.push(Math.round(companyValue(pl)));
      if (h.length > 60) h.shift();
    }
    for (const pid of Object.keys(G.firmHist)) if (!G.players[pid]) delete G.firmHist[pid];
    /* Beides in einem Ereignis: zwei Sendungen im selben Takt wären eine
     * Rundreise mehr, ohne dass die Daten je getrennt gebraucht würden. */
    io.emit("kurse", { waren: G.priceHist, firmen: G.firmHist });
  }
  /* Planwirtschaft: Phasen-Uhr, Phasenwechsel und Punktesieg */
  if (MODE === "plan" && G.plan && !G.winner) {
    if (--G.plan.rest <= 0) {
      planPhaseAuswerten();
      if (G.plan.phase >= PLAN_PHASEN) {
        const best = Object.entries(G.plan.spieler).sort((a, b) => b[1].punkte - a[1].punkte)[0];
        const p = best && G.players[best[0]];
        if (p) {
          G.winner = p.name;
          G.report = buildReport(best[0]);
          io.emit("notice", { text: `Der Fünfjahresplan ist abgeschlossen! ${p.name} ist Held der Arbeit (${best[1].punkte} Planpunkte).` });
        }
      } else planPhaseStarten();
    }
    if (!G.winner) for (const [pid, ps] of Object.entries(G.plan.spieler)) {
      const p = G.players[pid];
      if (!p || ps.punkte < PLAN_ZIEL) continue;
      G.winner = p.name;
      G.report = buildReport(pid);
      io.emit("notice", { text: `${p.name} erreicht ${PLAN_ZIEL} Planpunkte und ist Held der Arbeit!` });
      break;
    }
  }
  /* Siegbedingung (Sandbox: Nettovermögen — in der Planwirtschaft zählen nur Punkte) */
  /* Im Renntag entscheidet die Meisterschaft, nicht das Vermoegen — sonst
   * gewaenne dort der beste Kaufmann statt des besten Rennstalls. */
  /* Im Kartellmodus zählt nicht das Konto, sondern die Straße: Dort gewinnt
   * ausschließlich, wer die Bezirke beherrscht — kein Vermögenssieg. */
  if (MODE !== "plan" && MODE !== "renntag" && MODE !== "kartell" && !G.winner) for (const p of Object.values(G.players)) {
    if (netWorth(p) >= WIN_NW) {
      G.winner = p.name;
      /* Auswertung genau einmal berechnen und in den Zustand legen — sie geht
       * dann mit dem nächsten Broadcast an alle. Sie jedes Mal mitzuschicken
       * wäre Verschwendung, sie ist nur am Rundenende interessant. */
      G.report = buildReport(p.id);
      io.emit("notice", { text: `${p.name} gewinnt mit ${WIN_NW.toLocaleString("de-DE")} $ Nettovermögen!` });
    }
  }
  /* Reconnect-Gnadenfrist abgelaufen → jetzt endgültig aufräumen (offene Orders
   * zurückerstatten, Spieler entfernen). Gebäude/Bonds/Anteile bleiben wie bei
   * jedem Ausscheiden verwaist bestehen, wie in den Design-Notizen dokumentiert. */
  for (const [pid, p] of Object.entries(G.players)) {
    if (p.disconnected && Date.now() - p.disconnectedAt > RECONNECT_GRACE_MS) {
      for (const o of G.orders.filter(o => o.playerId === pid)) refundOrder(o);
      G.orders = G.orders.filter(o => o.playerId !== pid);
      /* Aktienangebote auflösen, bevor der Spieler weg ist — verwahrte Anteile
       * gehen an ihre Verkäufer zurück, Angebote auf die eigene Firma verfallen. */
      G.shareListings = G.shareListings.filter(l => {
        const sellerId = l.sellerId ?? l.companyId;
        if (l.companyId === pid) return false;
        if (sellerId === pid || l.toId === pid) { returnListingToSeller(l); return sellerId !== pid; }
        return true;
      });
      G.shareBids = G.shareBids.filter(b => b.companyId !== pid && b.bidderId !== pid);
      /* Laufende Auktionen mitziehen. Das Gebot wurde beim Bieten bereits vom
       * Konto abgebucht; verschwindet der Bieter, war es bisher trotzdem noch
       * das Höchstgebot: Es blockierte günstigere Gebote, und am Ende griff
       * mangels Spieler der "verfällt"-Zweig — das Gebäude war weg und der
       * Gläubiger ging leer aus, obwohl ein gültiges Gebot vorlag. Jetzt wird
       * die Auktion wieder freigegeben, damit sie noch einen Käufer findet. */
      for (const a of G.auctions) {
        if (a.bestBidder === pid) { a.bestBidder = null; a.bestBid = 0; }
      }
      /* Kartellmitgliedschaft und offene Einladungen mitnehmen — sonst stünde
       * ein Geist auf der Mitgliederliste, und ein Kartell, dessen Kopf gegangen
       * ist, könnte niemanden mehr einladen. */
      kartellVerlassen(p);
      for (const k of G.cartels) k.einladungen = k.einladungen.filter(mid => mid !== pid);
      delete G.players[pid];
      io.emit("notice", { text: `${p.name} hat die Sitzung endgültig verlassen.` });
    }
  }
  pushState();
}

/* ============================================================
 * Vier Industrie-Bots — je einer pro Kategorie. Sie verbinden sich
 * als normale Clients über die öffentliche API (können nicht schummeln)
 * und halten den Markt am Laufen:
 *  - DECKEN BEDARF: stehende Kauforders für die Inputs ihrer Industrie
 *    (leicht unter Ø) → echte Spieler können jederzeit an sie verkaufen
 *  - BEFÜLLEN DIE BÖRSE: verkaufen ihre Outputs in kleinen Tranchen,
 *    aber NUR wenn das Orderbuch dünn ist (< 15 Stk) → kein Überschuss,
 *    Spieler-Orders haben immer Vorrang und Absatzchancen
 *  - bauen träge ihre eigene Kette auf (1 Gebäude / ~2 min)
 * Abschalten: BOT=0 npm start
 * ============================================================ */
/* ---------- Schwierigkeitsgrade ----------
 * Die Bots spielen auf allen Stufen über dieselbe öffentliche API wie Menschen —
 * sie bekommen keine Sonderrechte, kein Extrakapital und keine höhere
 * Produktionsrate. Unterschiedlich stark sind sie dadurch, wie schnell sie
 * ausbauen, wie oft sie überhaupt handeln, wie hart sie um Preise feilschen und
 * ob sie die teuren Optimierungen (Gebäude aufleveln, Produktion boosten)
 * überhaupt nutzen. */
const BOT_LEVELS = {
  /* Zu den Handelsfaktoren: ein Messlauf über 4 Minuten hat gezeigt, dass sie
   * anfangs verkehrt herum wirkten — der "schwere" Bot zahlte mehr für Material
   * UND verlangte mehr beim Verkauf, seine Orders wurden dadurch seltener
   * bedient, und er hatte am Ende WENIGER Gebäude als der leichte. Richtig ist:
   * der schwache Bot wirtschaftet schlecht (kauft teuer ein, verschleudert die
   * Ware unter Wert), der starke handelt sauber zum Marktpreis und zahlt beim
   * Einkauf nur den kleinen Aufschlag, der nötig ist, um wirklich zum Zug zu
   * kommen. Kein Bot bekommt Sonderrechte — alle laufen über dieselbe API. */
  einfach: { name: "Einfach", bauPause: 150_000, takt: 34_000, maxGebaeude: 3,
             kaufAufschlag: 1.08, verkaufKurs: 0.88, leveln: false, boosten: false, auktionen: false, rennen: false },
  mittel:  { name: "Mittel",  bauPause:  85_000, takt: 26_000, maxGebaeude: 5,
             kaufAufschlag: 1.00, verkaufKurs: 0.98, leveln: true,  boosten: false, auktionen: true,  rennen: true },
  schwer:  { name: "Schwer",  bauPause:  40_000, takt: 17_000, maxGebaeude: 8,
             kaufAufschlag: 1.02, verkaufKurs: 1.00, leveln: true,  boosten: true,  auktionen: true,  rennen: true },
};
const BOT_LEVEL_DEFAULT = "mittel";

/* ---------- Produktabdeckung ----------
 * Fehler, der das hier nötig gemacht hat: Montan & Bau AG lief mit dem Plan
 * ["mine","mine","bauhandel","ziegelei",...] — zwei Erzminen VOR der Ziegelei.
 * Bei kurzen Runden oder der niedrigen Baugrenze von "Einfach" (3 Gebäude) kam
 * die Ziegelei nie dran: die Firma produzierte am Ende nur Erz, kein einziges
 * Ziegel — obwohl "Rohstoff- & Bauindustrie" laut Auswahlbildschirm genau dafür
 * dasteht ("jeder braucht sie zum Bauen").
 *
 * Deshalb jetzt hart getrennt in zwei Phasen: ERST eine Kachel für JEDES
 * Produkt der eigenen Branche (kein zweites Gebäude, solange noch ein Produkt
 * fehlt), DANACH erst Shops, Werbung und Dopplungen zur Skalierung. Die
 * Reihenfolge innerhalb der Abdeckung ist so gewählt, dass ein Rohstoff, den
 * ein späterer Eintrag als Zutat braucht, immer schon vorher gebaut ist (z. B.
 * Mine vor Ziegelei — die Ziegelei verarbeitet Erz).
 * Bei niedrigen Baugrenzen (Stufe "Einfach": nur 3 Gebäude) deckt ein Bot dann
 * eben nur die ersten drei Produkte ab, statt eines davon doppelt zu bauen —
 * genau das war die Forderung: Abdeckung geht immer vor Dopplung. */
const INDUSTRY_COVERAGE = {
  agrar:     ["farm", "imkerei", "plantage", "saftpresse", "baeckerei", "pharma"],
  rohstoff:  ["mine", "ziegelei", "betonwerk", "stahlwerk"],
  versorger: ["brunnen", "ewerk", "oelpumpe", "raffinerie"],
  tech:      ["siliziummine", "chipfabrik", "autowerk", "dieselwerk", "eautowerk"],
  touristik: ["campingplatz", "strandhotel"],
  ruestung:  ["munitionsfabrik", "waffenschmiede", "panzerwerk"],
  software:  ["entwicklerstudio", "rechenzentrum"],
};

/* Genau zwei Bots je Branche — der Startbildschirm lässt je Branche 0, 1 oder 2
 * davon zu. `plan` ist hier nur noch die ZWEITE Phase (nach vollständiger
 * Produktabdeckung): Shops, Werbung, welches Produkt zuerst verdoppelt wird.
 * Die beiden einer Branche unterscheiden sich weiterhin bewusst darin. */
/* Bots fuer den Renntag: abwechselnd Club und Zulieferer. Die Bauplaene der
 * normalen Bots taugen hier nicht — deren Gebaeude darf im Renntag niemand
 * bauen, sie stuenden untaetig herum. */
const RENNTAG_BOT_CFGS = [
  /* Ohne Laeden: die Clubs leben von Preisgeld und Sponsoring, die Zulieferer
   * verkaufen ueber die Boerse. Ein Laden im Plan wuerde nur Geld binden und
   * leer stehen. */
  { name: "Scuderia Bora",    industry: "rennclub",      color: "#e74c3c",
    plan: ["werbeagentur"], needs: [], rennstall: true },
  { name: "Tempo Motors",     industry: "rennindustrie", color: "#3b9cf6",
    plan: ["reifenwerk", "mine", "stahlwerk", "ewerk"], needs: ["strom"] },
  { name: "Vento Racing",     industry: "rennclub",      color: "#2ecc71",
    plan: ["werbeagentur"], needs: [], rennstall: true },
  { name: "Silizium Dynamics",industry: "rennindustrie", color: "#b07cf7",
    plan: ["rennlabor", "siliziummine", "chipfabrik", "ewerk"], needs: ["strom"] },
  { name: "Aurora Team",      industry: "rennclub",      color: "#f5c542",
    plan: ["werbeagentur"], needs: [], rennstall: true },
  { name: "Kraft & Reifen",   industry: "rennindustrie", color: "#1abc9c",
    plan: ["reifenwerk", "oelpumpe", "stahlwerk", "mine"], needs: ["strom"] },
];
const BOT_CFGS = [
  { name: "AgrarGenossen",   industry: "agrar",     color: "#34d399",
    plan: ["onlinemarkt", "farm", "werbeagentur"], needs: ["wasser", "strom"], rennstall: true },
  { name: "Grünhof & Söhne", industry: "agrar",     color: "#6fae4e",
    plan: ["onlinemarkt", "plantage", "werbeagentur"], needs: ["wasser", "strom"] },

  /* Zweites Stahlwerk gleich nach der Abdeckung. Über eine ganze Runde von
   * 78 Minuten gab es im Spiel nur EIN Stahlwerk, und Stahl war durchgehend
   * nicht käuflich: Angebot 0 bei Nachfrage 98, der Kurs stand zehn Minuten
   * unbewegt auf 137,25 $ — ein Preis, zu dem kein einziger Handel zustande
   * kam. Das legte gleich zwei Produktlinien still (das fertig ausgebaute
   * Benzin-Autowerk eines Spielers und die komplette Rüstungskette). Stahl ist
   * die Zutat mit der breitesten Abhängigkeit im Spiel, sie darf nicht an
   * einem einzigen Gebäude hängen. */
  { name: "Montan & Bau AG", industry: "rohstoff",  color: "#fbbf24",
    plan: ["stahlwerk", "reifenwerk", "onlinemarkt", "werbeagentur"], needs: ["strom", "oel", "wasser"] },
  { name: "Felswerk",        industry: "rohstoff",  color: "#f97316",
    plan: ["stahlwerk", "onlinemarkt", "mine", "werbeagentur"], needs: ["strom", "oel", "wasser"], rennstall: true },

  { name: "Stadtwerke",      industry: "versorger", color: "#38bdf8",
    plan: ["onlinemarkt", "wasserwerk", "werbeagentur", "windpark"], needs: [],
    /* Öl gehört hier zwingend dazu. Der eigentliche Ölförderer "Nordsee Öl"
     * ist der ZWEITE Versorger-Bot und läuft bei der Voreinstellung von einem
     * Bot je Branche gar nicht mit. Stadtwerke baut zwar über die
     * Produktabdeckung eine Ölpumpe, verbrauchte das Öl aber still in der
     * eigenen Raffinerie — am Markt kam nie welches an. Ohne Öl steht das
     * Stahlwerk, ohne Stahl gibt es keine Fahrzeuge. */
    alwaysSell: ["wasser", "strom", "oel"], rennstall: true },
  /* Reiner Ölförderer: baut immer weiter Ölpumpen und stellt alles Geförderte
   * sofort in den Markt. Öl ist mit 8 $ das wertvollste Grundgut, deshalb bleibt
   * er auch auf "Schwer" bei höchstens vier Pumpen gedeckelt. Bewusste Ausnahme
   * von der Abdeckungsregel oben: er soll gar nicht die ganze Branche
   * abbilden, sondern gezielt nur den Ölnachschub sichern. */
  { name: "Nordsee Öl",      industry: "versorger", color: "#e5762f",
    plan: ["oelpumpe"], planLoop: true, maxGebaeude: 4, needs: [], alwaysSell: ["oel"] },

  { name: "ChipWerke",       industry: "tech",      color: "#a78bfa",
    plan: ["onlinemarkt", "rennlabor", "siliziummine", "werbeagentur"], needs: ["strom", "stahl", "oel"] },
  { name: "Volt & Silicon",  industry: "tech",      color: "#e879f9",
    plan: ["onlinemarkt", "siliziummine", "werbeagentur"], needs: ["strom", "stahl"], rennstall: true },

  /* Touristik: kauft Wasser und Strom zu und verkauft Übernachtungen über ein
   * eigenes Kontor. Bewusst nur einer — die Branche ist neu und soll den Markt
   * erst einmal nicht dominieren. */
  { name: "Küstenperle",     industry: "touristik", color: "#2dd4bf",
    plan: ["campingplatz", "onlinemarkt", "strandhotel", "werbeagentur"], maxGebaeude: 4,
    needs: ["wasser", "strom"], alwaysSell: ["uebernachtung"], rennstall: true },

  /* Rüstung: baut erst die billige Munitionsfabrik, damit früh Geld reinkommt,
   * und kauft Stahl, Elektronik und Diesel für die teureren Stufen zu. */
  { name: "Stahlfaust",      industry: "ruestung",  color: "#f43f5e",
    plan: ["onlinemarkt", "munitionsfabrik", "werbeagentur"], maxGebaeude: 5, rennstall: true,
    /* Bewusst nur die Zutaten der ersten Stufen: Jede Ware in dieser Liste
     * bindet beim Einkauf bis zu 25 Stück Kapital. Mit Stahl (115 $) und
     * Elektronik (98 $) gleichzeitig war der Bot sofort klamm und kam über
     * die Munitionsfabrik nie hinaus — gemessen: Bargeld 2001 → 1136 bei
     * einem einzigen Gebäude. */
    needs: ["erze", "oel", "stahl"], alwaysSell: ["munition"] },
  /* Software: entwickeln je ein Shop-System und betreiben es. Die beiden
   * unterscheiden sich im Preis — Byteforge ist billig und schlicht, Pixelwerk
   * teurer, legt aber schneller Funktionen nach. Ohne sie gäbe es im Spiel nur
   * das Stadtportal. */
  { name: "Byteforge",       industry: "software",  color: "#60a5fa",
    plan: ["rechenzentrum", "entwicklerstudio"], needs: ["strom", "elektronik"], vorrat: { strom: 150, elektronik: 5 },
    sw: { name: "KassenKlick", paint: "PixelPinsel", paintPreis: 800, einrichtung: 300, gebuehr: 3, abo: 120, module: ["bewertungen", "lieferung"] } },
  { name: "Pixelwerk",       industry: "software",  color: "#f472b6",
    plan: ["entwicklerstudio", "rechenzentrum"], needs: ["strom", "elektronik"], vorrat: { strom: 150, elektronik: 5 },
    sw: { name: "ShopStern", paint: "MalMeister", paintPreis: 1200, einrichtung: 600, gebuehr: 4, abo: 180, module: ["lieferung", "bewertungen"] } },
];
let botsStarted = false;
/* Vom ersten Spieler der Runde gewählt (siehe register): wie viele Bots je
 * Branche mitspielen und wie stark sie sind. */
let botAuswahl = null, botLevelKey = BOT_LEVEL_DEFAULT;
/* Laufende Bots festhalten: bei einem Rundenneustart müssen ihre Verbindungen
 * und Zeitgeber beendet werden, sonst laufen die alten Schleifen mit veralteten
 * Spieler-IDs weiter und die neue Runde bekommt die Bots doppelt. */
const botHandles = [];
/* Rundenzähler: die Bots starten zeitversetzt. Ohne diesen Zähler könnten noch
 * ausstehende Starts einer beendeten Runde in die neue hineinfeuern und die
 * Bots doppelt anlegen. */
let botGen = 0;
function startBots() {
  if (botsStarted || process.env.BOT === "0") return;
  botsStarted = true;
  const lvl = BOT_LEVELS[botLevelKey] || BOT_LEVELS[BOT_LEVEL_DEFAULT];
  /* Ohne Auswahl (z. B. alter Client) je Branche ein Bot. Sonst genau so viele,
   * wie im Startbildschirm eingestellt wurden — höchstens zwei je Branche. */
  const gewuenscht = {};
  for (const k of Object.keys(INDUSTRIES)) {
    const n = botAuswahl ? Math.max(0, Math.min(2, Math.floor(+botAuswahl[k] || 0))) : 1;
    gewuenscht[k] = n;
  }
  /* Im Renntag gibt es die sechs Branchen nicht — die Botauswahl im Warteraum
   * zaehlt dort nur, WIE VIELE mitspielen. Die Rollen verteilt der Server
   * abwechselnd, damit immer beide Seiten besetzt sind: ohne Zulieferer gaebe
   * es keine Teile, ohne Clubs kein Rennen. */
  const genommen = {};
  const liste = MODE === "renntag"
    ? RENNTAG_BOT_CFGS.slice(0, Object.values(gewuenscht).reduce((a2, b2) => a2 + b2, 0))
    : BOT_CFGS.filter(cfg => {
        genommen[cfg.industry] = (genommen[cfg.industry] || 0) + 1;
        return genommen[cfg.industry] <= (gewuenscht[cfg.industry] || 0);
      });
  if (!liste.length) { botsStarted = false; return; }   // ohne Bots gar nicht erst hochfahren
  const gen = ++botGen;
  console.log(`Bots: ${liste.map(c => c.name).join(", ") || "keine"} — Stufe ${lvl.name}`);
  liste.forEach((cfg, i) => setTimeout(() => { if (gen === botGen && botsStarted) spawnBot(cfg, lvl); }, 8000 + i * 5000));
}
function mafiaBotsAuffuellen() {
  if (process.env.BOT === "0") return;
  botsStarted = true;
  let delay = 4000;
  for (const fid of Object.keys(FAMILIEN)) {
    const fehlt = FAMILIE_MAX - famAnzahl(fid);
    for (let i = 0; i < fehlt; i++) {
      const name = (MAFIA_BOT_NAMEN[fid] || [])[i] || `${FAMILIEN[fid].name}-Soldat`;
      const cfg = { name, color: FAMILIEN[fid].farbe, industry: "agrar", kartellFamilie: fid };
      const d = delay; delay += 3500;
      setTimeout(() => spawnBot(cfg), d);
    }
  }
  if (famAnzahl("polizei") === 0) {
    const d = delay;
    setTimeout(() => spawnBot({ name: "Commissario Rizzo", color: POLIZEI.farbe,
      industry: "agrar", polizei: true }), d);
  }
  console.log("Mafia-Bots werden aufgefüllt (2 je Familie, Polizei besetzt).");
}
function stopBots() {
  botGen++;
  for (const h of botHandles) { clearInterval(h.timer); h.socket.close(); }
  botHandles.length = 0;
  botsStarted = false;
}
async function spawnBot(cfg, lvl = BOT_LEVELS[BOT_LEVEL_DEFAULT]) {
  const { io: ioClient } = await import("socket.io-client");
  const s = ioClient(`http://localhost:${PORT}`);
  let me = null, st = null, myId = null, lastBuild = 0;
  let swPreisZeit = Date.now();   // Software-Anbieter: wann zuletzt die Gebühr überprüft wurde
  let botLogoGroesse = 0;            // Malprogramm: Größe des zuletzt gemalten Logos
  const swWechsel = {};           // Online-Marktplatz: wann zuletzt das System gewechselt wurde (je Kachel)
  s.on("me", m => { if (m.teil && me) { const { teil, ...f } = m; me = { ...me, ...f }; } else me = m; });
  /* Auch die Bots bekommen die Karte nur noch als Diff — sie lesen st.map aber
   * direkt, also hier dieselbe Zusammenführung wie im Browser-Client. */
  let botMap = null;
  s.on("state", x => {
    if (x.map) botMap = x.map;
    else if (x.mapDelta && botMap) {
      for (const d of x.mapDelta) {
        const t = botMap[d.i];
        if (t) for (const k in d) if (k !== "i") t[k] = d[k];
      }
    }
    /* Teil-Stände (nur geänderte Felder) über den letzten Stand legen. */
    const basis = x.teil && st ? st : {};
    st = botMap ? { ...basis, ...x, map: botMap } : { ...basis, ...x };
  });
  let botMeta = null;   // Registrierungsdaten (Tuning-Tabelle, Schwellen) für die Rennlogik
  s.on("connect", () => s.emit("register", { name: cfg.name, color: cfg.color, industry: cfg.industry, botToken: BOT_TOKEN, familieWunsch: cfg.polizei ? "polizei" : cfg.kartellFamilie },
    res => { if (res?.ok) { myId = res.you; botMeta = res; } }));
  /* Mit Zeitlimit: bleibt eine Bestätigung aus — etwa weil ein Handler sie
   * vergisst —, würde der Bot sonst an dieser Stelle für immer stehen bleiben
   * und den Rest seiner Runde nie erreichen. Lieber weitermachen. */
  const em = (ev, p) => new Promise(r => {
    const frist = setTimeout(() => r({ error: "keine Antwort" }), 8000);
    s.emit(ev, p, res => { clearTimeout(frist); r(res); });
  });
  /* Überlappungsschutz: der Rumpf ist asynchron und wird mit der Zeit länger
   * (mehr Gebäude, mehr Shops, mehr Angebote). Ohne diese Sperre startet der
   * Timer den nächsten Durchlauf, während der vorige noch läuft — die
   * Durchläufe stapeln sich dann auf und schaukeln sich gegenseitig hoch. */
  let laeuft = false;
  const timer = setInterval(async () => {
    if (laeuft || !me || !st || !myId || st.winner) return;
    laeuft = true;
    try {
      /* --- Polizei-KI: kontrolliert Transporte und razzt die heißeste
       * Familie — wirtschaftet aber nicht und kennt keinen Hehler. --- */
      if (cfg.polizei) {
        if (st.mode === "kartell" && st.started && !st.winner) {
          if ((st.transporte || []).length && Math.random() < .6)
            await em("ueberfall", { transportId: st.transporte[0].id });
          if (!me.razziaCd) {
            const fahndungVon = Object.fromEntries((st.familien || []).map(f => [f.id, f.fahndung || 0]));
            const ziel = (st.bezirke || []).filter(b => b.kontrolle)
              .sort((a, b) => (fahndungVon[b.kontrolle] || 0) - (fahndungVon[a.kontrolle] || 0)).pop();
            if (ziel && (fahndungVon[ziel.kontrolle] || 0) >= 15)
              await em("razziaBezirk", { bezirk: ziel.id });
          }
        }
        return;
      }
      /* --- Planwirtschaft: Bots bedienen ihr Soll, das Volksziel und den
       * Schwarzmarkt — die Markt-Routinen weiter unten laufen ins Leere
       * (Börse/Verträge sind gesperrt) und stören nicht. --- */
      if (st.mode === "plan" && st.plan) {
        const meinPlan = st.plan.spieler?.[myId];
        /* Soll bedienen: Lagerbestand ans Planbüro, bis zur 150-%-Grenze. */
        for (const z of meinPlan?.soll || []) {
          if ((me.inv[z.good] || 0) >= 3 && z.geliefert < z.menge * 1.5) await em("planDeliver", { good: z.good });
        }
        /* Volkswirtschaftsziel: Überschuss beisteuern, solange es offen ist. */
        const volk = st.plan.volk;
        if (volk && volk.geliefert < volk.menge && (me.inv[volk.good] || 0) > 6
            && !(meinPlan?.soll || []).some(z => z.good === volk.good)) {
          await em("planDeliver", { good: volk.good });
        }
        /* Schwarzmarkt: passende fremde Angebote annehmen … */
        for (const o of st.plan.markt || []) {
          if (o.von === myId) continue;
          if ((me.inv[o.willGood] || 0) >= o.willQty + 8 && Math.random() < 0.3) {
            await em("planOfferAccept", { offerId: o.id });
            break;
          }
        }
        /* … und gelegentlich eigenen Überschuss gegen Fehlendes anbieten. */
        if (Math.random() < 0.08 && (st.plan.markt || []).filter(o => o.von === myId).length < 2) {
          const surplus = Object.keys(GOODS).find(g => (me.inv[g] || 0) > 15 && !(meinPlan?.soll || []).some(z => z.good === g));
          const brauch = (meinPlan?.soll || []).find(z => z.geliefert < z.menge && (me.inv[z.good] || 0) < 3);
          if (surplus && brauch && surplus !== brauch.good) {
            const gq = Math.min(10, Math.floor(me.inv[surplus] / 2));
            const wq = Math.max(1, Math.round(gq * (BASEP[surplus] || 1) / (BASEP[brauch.good] || 1)));
            await em("planOfferCreate", { gebeGood: surplus, gebeQty: gq, willGood: brauch.good, willQty: wq });
          }
        }
      }
      /* --- Kartellmodus: Bots leben das Familienleben — sie ziehen den
       * Betrieb ihrer Familie hoch, tragen heiße Ware zum Hehler und greifen
       * sich gelegentlich einen Werttransport. Die normalen Markt-Routinen
       * weiter unten laufen zusätzlich, damit die Wirtschaft lebt. --- */
      if (st.mode === "kartell") {
        const famDef = (st.familien || []).find(f2 => f2.id === st.players?.[myId]?.familie);
        if (famDef) {
          const btF = BTYPES[famDef.gebaeude];
          const meine = st.map.filter(t2 => t2.owner === myId && t2.btype === famDef.gebaeude).length;
          if (btF && meine < 2 && me.cash > btF.cost + 2500 && Date.now() - lastBuild > lvl.bauPause) {
            const mats = matCost(btF);
            const fehlt = Object.entries(mats).find(([g, n]) => me.inv[g] < n);
            if (fehlt) {
              if (me.cash > 2000 && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === fehlt[0]))
                await em("placeOrder", { side: "buy", good: fehlt[0],
                  qty: Math.ceil(fehlt[1] - me.inv[fehlt[0]]) + 4,
                  price: Math.round((st.avg[fehlt[0]] || BASEP[fehlt[0]] || 1) * 1.12 * 100) / 100 });
            } else {
              const frei = t2 => t2.zone === btF.zone && !t2.road && !t2.water && !t2.park
                && !t2.bank && !t2.news && !t2.finanzamt && !t2.deko && !t2.schwarz && !t2.owner;
              /* Die Piazza Grande zuerst: Wer sie hält, führt das Casino. */
              const kandidaten = st.map.filter(t2 => frei(t2) && !t2.locked)
                .sort((a2, b2) => (bezirkVon(a2.x, a2.y) === GCASINO_BEZIRK ? 0 : 1) -
                                  (bezirkVon(b2.x, b2.y) === GCASINO_BEZIRK ? 0 : 1));
              let ziel = kandidaten[0];
              if (!ziel) {
                const lt = st.map.find(t2 => frei(t2) && t2.locked);
                if (lt && me.cash > btF.cost + lt.unlockCost + 2000) ziel = lt;
              }
              if (ziel) {
                const r = await em("build", { x: ziel.x, y: ziel.y, btype: famDef.gebaeude });
                if (r?.ok) lastBuild = Date.now();
              }
            }
          }
          /* Heiße Ware: Hält die Familie die Piazza, läuft der Verkauf übers
           * Casino (bessere Preise, keine Paten-Abgabe) — sonst zum Hehler. */
          const piazzaMeins = st.bezirke?.[4]?.kontrolle === st.players[myId]?.familie;
          if ((me.inv[famDef.produkt] || 0) >= 5)
            await em(piazzaMeins ? "gcasinoVerkauf" : "hehlerVerkauf", { good: famDef.produkt });
          /* Casino pflegen: gelegentlich ausbauen, wenn die Kasse prall ist */
          if (piazzaMeins && st.gcasino?.upgradeKosten && me.cash > st.gcasino.upgradeKosten + 6000 && Math.random() < .3)
            await em("gcasinoUpgrade", {});
          /* Die Piazza EROBERN, wenn eine fremde Familie sie hält */
          if (!piazzaMeins && st.bezirke?.[4]?.kontrolle && !st.bezirke[4].kampf &&
              Math.floor(me.inv.pistole || 0) >= 3 && !me.kampfCd && Math.random() < .25)
            await em("revierkampf", { bezirk: 4 });
          /* Überfall: ab und zu traut sich ein Bot an einen Transport —
           * der Server würfelt Erfolg, Kaution und Fahndung wie bei jedem. */
          if ((st.transporte || []).length && Math.random() < 0.2)
            await em("ueberfall", { transportId: st.transporte[0].id });
          /* Tauziehen: Wird die Familie des Bots angegriffen (oder greift sie
           * an), schickt er Verstärkung, solange die Kasse es hergibt — sonst
           * wären Bot-Familien im Revierkampf wehrlose Beute. */
          const meinKampf = (st.bezirke || []).find(b2 => b2.kampf &&
            (b2.kampf.verteidiger === st.players[myId]?.familie || b2.kampf.angreifer === st.players[myId]?.familie));
          if (meinKampf && me.cash > 1200 && !me.verstCd)
            await em("verstaerkung", { bezirk: meinKampf.id });
          /* Schutzgeld: gelegentlich zieht der Bot durchs EIGENE Revier —
           * fremde Bezirke lässt er in Ruhe (Bots provozieren keine Kriege). */
          if (Math.random() < 0.25) {
            const revier = (st.bezirke || []).find(b2 =>
              b2.kontrolle === st.players[myId]?.familie && !(me.erpress || {})[b2.id]);
            if (revier) await em("erpressen", { bezirk: revier.id });
          }
        }
      }
      /* --- Motorsport: Bots bestücken ihren Stall, tunen, melden, wetten
       * und sponsern — alles nur, wenn die Kasse es hergibt. --- */
      if (st.mode !== "plan" && st.mode !== "kartell" && lvl.rennen) {
        const meinStall = st.map.find(t2 => t2.owner === myId && t2.btype === "rennstall");
        const meineAutos = meinStall?.autos || [];
        if (meinStall) {
          /* Stall füllen: erst Fahrzeug aus dem Lager einstellen, sonst eines
           * an der Börse nachfragen. */
          const imLager = ["eauto", "benzinauto", "dieselauto"].find(g => (me.inv[g] || 0) >= 1);
          if (meineAutos.length < (meinStall.level || 1)) {
            if (imLager) await em("stallEinstellen", { x: meinStall.x, y: meinStall.y, good: imLager });
            else if (me.cash > 3000 && !st.orders.some(o => o.playerId === myId && o.side === "buy" && ["eauto", "benzinauto", "dieselauto"].includes(o.good))) {
              const billig = ["eauto", "benzinauto", "dieselauto"].sort((a2, b2) => (st.avg[a2] || 999) - (st.avg[b2] || 999))[0];
              await em("placeOrder", { side: "buy", good: billig, qty: 1, price: Math.round((st.avg[billig] || 500) * 1.1 * 100) / 100 });
            }
          }
          /* Fahrer: freien aus dem Pool verpflichten und ins Auto setzen. */
          const ohneFahrer = meineAutos.find(a2 => !a2.fahrerId);
          if (ohneFahrer) {
            const frei = (st.fahrer || []).filter(f2 => !f2.teamId).sort((a2, b2) => a2.gehalt - b2.gehalt)[0];
            if (frei && me.cash > frei.gehalt * 4) {
              await em("fahrerAnheuern", { fahrerId: frei.id });
              await em("fahrerZuweisen", { fahrerId: frei.id, autoId: ohneFahrer.id });
            }
          }
          /* Instandsetzung geht dem Tuning VOR. Ein Bot, der nur ausbaut,
           * faehrt seinen Wagen in sechs Rennen unter die Startgrenze und
           * meldet danach nie wieder — das Startfeld liefe leer, und ohne
           * Feld gibt es weder Rennen noch Wetten. */
          const kaputt = meineAutos.filter(a2 => (a2.zustand ?? 100) < 70)
            .sort((a2, b2) => a2.zustand - b2.zustand)[0];
          if (kaputt) {
            const rep = kaputt.reparatur;
            const fehltTeil = rep && Object.entries(rep.teile || {}).find(([g2, n2]) => (me.inv[g2] || 0) < n2);
            if (fehltTeil && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === fehltTeil[0])) {
              await em("placeOrder", { side: "buy", good: fehltTeil[0], qty: fehltTeil[1] + 2,
                price: Math.round((st.avg[fehltTeil[0]] || 150) * 1.15 * 100) / 100 });
            } else if (rep && !fehltTeil && me.cash > rep.cash + 4000) {
              await em("stallReparieren", { x: meinStall.x, y: meinStall.y, autoId: kaputt.id });
            }
          }
          /* Tunen, wenn die Kasse dick genug ist: fehlende Teile an der Börse
           * ordern, sonst die nächste günstige Ausbaustufe kaufen. */
          if (me.cash > 20000 && meineAutos.length) {
            const auto = meineAutos[0];
            const bereiche = Object.keys(botMeta?.tuning || {}).filter(b2 => (auto.tuning?.[b2] || 0) < (botMeta?.tuningMax || 3));
            const bereich = bereiche[Math.floor(Math.random() * bereiche.length)];
            if (bereich) {
              const T2 = botMeta.tuning[bereich];
              const stufe = (auto.tuning?.[bereich] || 0) + 1;
              const fehlt = Object.entries(T2.teile).find(([g2, n2]) => (me.inv[g2] || 0) < n2 * stufe);
              if (fehlt && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === fehlt[0])) {
                await em("placeOrder", { side: "buy", good: fehlt[0],
                  qty: fehlt[1] * stufe + 2, price: Math.round((st.avg[fehlt[0]] || 100) * 1.1 * 100) / 100 });
              } else if (!fehlt) {
                await em("stallTunen", { x: meinStall.x, y: meinStall.y, autoId: auto.id, bereich });
              }
            }
          }
        }
        /* Läuft das Rennen: bei Verschleiß rechtzeitig an die Box. */
        if (st.rennen?.phase === "laeuft") {
          const meinTeil = st.rennen.teilnehmer.find(x2 => x2.ownerId === myId);
          if (meinTeil && !meinTeil.ausgefallen && !meinTeil.boxe && !meinTeil.frisch && st.rennen.rest > 25) {
            const autoZ = meineAutos.find(a2 => a2.id === meinTeil.autoId)?.zustand ?? 100;
            if (autoZ < 60) await em("boxenstopp", { autoId: meinTeil.autoId });
          }
        }
        /* Renntag: eigene startklare Wagen melden … */
        if (st.rennen?.phase === "anmeldung") {
          if (meinStall) for (const a2 of meineAutos) {
            if (a2.fahrerId && a2.zustand >= 25 && me.cash > (st.rennen.nenngeld || 1500) + 2500
                && !st.rennen.teilnehmer.some(x2 => x2.autoId === a2.id)) {
              await em("rennenAnmelden", { x: meinStall.x, y: meinStall.y, autoId: a2.id });
            }
          }
          /* … auf fremde Wagen wetten … */
          const fremde = st.rennen.teilnehmer.filter(x2 => x2.ownerId !== myId);
          if (fremde.length && me.cash > 4000 && Math.random() < 0.35
              && !st.rennen.teilnehmer.some(x2 => x2.ownerId === myId)) {
            const tipp = fremde[Math.floor(Math.random() * fremde.length)];
            const wuerfel = Math.random();
            await em("wetteSetzen", { autoId: tipp.autoId, betrag: 200 + Math.floor(Math.random() * 12) * 100,
              art: wuerfel < .6 ? "sieg" : wuerfel < .85 ? "podium" : "ausfall" });
          }
          /* … und reiche Bots sponsern gelegentlich ein Team. */
          if (fremde.length && me.cash > 15000 && Math.random() < 0.15) {
            const team = fremde[Math.floor(Math.random() * fremde.length)];
            await em("sponsern", { teamId: team.ownerId, betrag: 1000 + Math.floor(Math.random() * 4) * 500 });
          }
        }
      }
      /* Gebäude außerhalb des Bauplans (z. B. ein zweites Rechenzentrum):
       * fehlendes Material bestellen, sonst auf der ersten freien Kachel bauen. */
      const botBaue = async btid => {
        const bt = BTYPES[btid], mats = matCost(bt);
        const fehlt = Object.entries(mats).find(([g, n]) => me.inv[g] < n);
        if (fehlt) {
          if (me.cash > 2000 && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === fehlt[0]))
            await em("placeOrder", { side: "buy", good: fehlt[0], qty: Math.ceil(fehlt[1] - me.inv[fehlt[0]]) + 4,
              price: Math.round((st.avg[fehlt[0]] || BASEP[fehlt[0]]) * (lvl.kaufAufschlag + 0.03) * 100) / 100 });
          return null;
        }
        const frei = t => t.zone === bt.zone && !t.road && !t.water && !t.park && !t.bank && !t.news && !t.finanzamt && !t.deko && !t.schwarz && !t.denkmal && !t.owner;
        let ziel = st.map.find(t => frei(t) && !t.locked);
        if (!ziel) { const lt = st.map.find(t => frei(t) && t.locked); if (lt && me.cash > bt.cost + lt.unlockCost + 800) ziel = lt; }
        if (!ziel || me.cash < bt.cost + (ziel.locked ? ziel.unlockCost : 0)) return null;
        return em("build", { x: ziel.x, y: ziel.y, btype: btid });
      };
      /* --- Software-Anbieter: System anlegen, Versionen nachlegen, Gebühr an
       * den Wettbewerb anpassen, bei voller Auslastung ein Rechenzentrum mehr. --- */
      if (cfg.sw && cfg.industry === "software") {
        const meins = (st.software || []).find(s2 => s2.ownerId === myId);
        if (!meins) {
          await em("softwareEinstellen", { name: cfg.sw.name, farbe: cfg.color, einrichtung: cfg.sw.einrichtung, gebuehr: cfg.sw.gebuehr, werbeAbo: cfg.sw.abo });
        } else if (!meins.entwicklung && st.map.some(t2 => t2.owner === myId && t2.btype === "entwicklerstudio")) {
          /* Schwerpunkt: die Branche mit den meisten Firmen, die noch kein
           * anderes System bedient — so teilen sich zwei Software-Bots den
           * Markt, statt um dieselben Kunden zu kämpfen. */
          const fokusVon = s2 => (s2.branchen?.length ? s2.branchen : s2.entwicklung?.branchen || [])[0];
          const waehle = (ohne = []) => {
            const zahl = {};
            for (const pl of Object.values(st.players)) {
              const br = pl.industry;
              if (!SW_BAEUME[br] || pl.id === myId) continue;
              zahl[br] = (zahl[br] || 0) + 1;
            }
            /* Eine Branche, die ein anderes System schon als Schwerpunkt hat,
             * zählt deutlich weniger — gemessen wählten sonst beide Bots Agrar. */
            for (const s2 of st.software || []) {
              if (s2.ownerId === myId || s2.portal) continue;
              (s2.branchen?.length ? s2.branchen : s2.entwicklung?.branchen || []).forEach((br, i) => { if (zahl[br] != null) zahl[br] -= i === 0 ? 1.5 : 0.75; });
            }
            return Object.keys(SW_BAEUME).filter(br => !ohne.includes(br))
              .sort((a2, b2) => (zahl[b2] || 0) - (zahl[a2] || 0))[0];
          };
          const eigene = meins.branchen?.length ? meins.branchen : [];
          const fokus = eigene[0] || waehle();
          const plan = [swModulId(fokus, 1), "werbung", swModulId(fokus, 2), swModulId(fokus, 3), ...cfg.sw.module];
          let naechstes = plan.find(m => !meins.module?.[m]);
          /* Zweite Branche erst, wenn die erste ausgebaut ist, ab v3 und mit
           * Polster für die Lizenz — dann Stufe für Stufe weiter. */
          if (!naechstes) {
            const zweit = eigene[1] || waehle(eigene);
            const k = [1, 2, 3].find(k2 => !meins.module?.[swModulId(zweit, k2)]);
            const aus = swAusbau(eigene.indexOf(zweit) >= 0 ? eigene.indexOf(zweit) : eigene.length);
            if (k && meins.version + 1 >= aus.abVersion && me.cash > aus.cash + 3000) naechstes = swModulId(zweit, k);
          }
          if (meins.version < 1) await em("softwareEntwickeln", { module: { [swModulId(fokus, 1)]: true } });
          else if (naechstes && me.cash > 2500) await em("softwareEntwickeln", { module: { [naechstes]: true } });
        }
        if (meins?.version >= 1 && Date.now() - swPreisZeit > 180_000) {
          swPreisZeit = Date.now();
          const fremdeMitKunden = (st.software || []).some(s2 => s2.ownerId !== myId && !s2.portal && s2.kunden > 0);
          let geb = meins.gebuehr;
          /* Untergrenze 2,5 %: Im Messlauf drückte Byteforge seine Gebühr auf
           * 1 % und kam nie über 6.000 $ Vermögen — zu wenig für Strom und
           * Rechenzentren. Kunden gewinnt man über den Branchenbaum. */
          if (meins.kunden === 0 && fremdeMitKunden) geb = Math.max(2.5, geb - 0.5);
          else if (meins.plaetze > 0 && meins.kunden >= meins.plaetze) geb = Math.min(6, geb + 0.5);
          if (geb !== meins.gebuehr) await em("softwareEinstellen", { gebuehr: geb });
        }
        if (meins?.plaetze > 0 && meins.version >= 1 && meins.kunden >= meins.plaetze - 1 && me.cash > 4200
            && Date.now() - lastBuild > lvl.bauPause / 2
            /* Ziegel für den eigenen Shop zurücklegen (Malprogramm-Bots) */
            && !(cfg.sw.paint && meins.version >= 2 && me.inv.ziegel < 24 && !st.map.some(t2 => t2.owner === myId && t2.btype === "onlinemarkt"))) {
          const r = await botBaue("rechenzentrum");
          if (r?.ok) lastBuild = Date.now();
        }
      }
      /* --- Malprogramm (Software-Bots): ab Shop-System v3 einen eigenen
       * Online-Shop bauen — ohne ihn kann niemand die Lizenz kaufen —, dann das
       * Programm Stufe für Stufe entwickeln. --- */
      if (cfg.sw?.paint && cfg.industry === "software") {
        const meins = (st.software || []).find(s2 => s2.ownerId === myId);
        const mp = (st.paint || []).find(x => x.ownerId === myId);
        const laden = st.map.find(t2 => t2.owner === myId && t2.btype === "onlinemarkt");
        if (meins?.version >= 3) {
          if (!laden && me.cash > 5500 && Date.now() - lastBuild > lvl.bauPause / 2) { const r = await botBaue("onlinemarkt"); if (r?.ok) lastBuild = Date.now(); }
          if (!mp) await em("paintEinstellen", { name: cfg.sw.paint, preis: cfg.sw.paintPreis || 900 });
          else if (!mp.entwicklung && mp.version < PAINT.STUFEN.length && me.cash > 1500) await em("paintEntwickeln", {});
        }
      }
      /* --- Firmenlogo: Bots kaufen eine Malprogramm-Lizenz, sobald sie genug
       * Polster haben, und malen sich ein Logo (nach jedem Update größer). --- */
      if (!me.paintStufe) {
        const ang = (st.paint || []).filter(x => x.version >= 1 && x.ownerId !== myId && x.laeden.some(l => l.offen))
          .sort((a2, b2) => b2.version - a2.version || a2.preis - b2.preis)[0];
        if (ang && me.cash > ang.preis * 4 + 3000 && Math.random() < 0.35) {
          const l = ang.laeden.find(l2 => l2.offen);
          await em("lizenzKaufen", { x: l.x, y: l.y });
        }
      } else if (botLogoGroesse !== me.paintStufe.groesse) {
        const r = await em("logoSpeichern", { logo: botLogo(cfg.color, cfg.name, me.paintStufe) });
        if (r?.ok) botLogoGroesse = me.paintStufe.groesse;
      }
      /* --- Online-Marktplatz (Kunde): Jeder Bot prüft in jedem Durchlauf alle
       * veröffentlichten Systeme. Ohne System installiert er das beste, das er
       * sich leisten kann (notfalls das Stadtportal). Kommt neue Software
       * heraus oder wird sein Anbieter schlechter (Überlast, Ruf), wechselt
       * er, sobald ein anderes System mindestens 5 % mehr bringt — höchstens
       * alle drei Minuten, damit er nicht hin- und herspringt. Das Werbemodul
       * schaltet er nach Kassenlage ein und aus. --- */
      const angebote = (st.software || []).filter(s2 => s2.version >= 1);
      for (const t2 of st.map) {
        if (t2.owner !== myId || t2.btype !== "onlinemarkt" || t2.bauBis > st.tick) continue;
        const key = t2.x + "," + t2.y;
        const jetzt = angebote.find(s2 => s2.id === t2.system?.produktId);
        const hatPlatz = s2 => s2.portal || s2.plaetze == null || s2.kunden < s2.plaetze || s2.id === jetzt?.id;
        const leistbar = s2 => s2.id === jetzt?.id || s2.einrichtung <= Math.max(0, me.cash - 800);
        /* Bewertet wird aus Sicht der eigenen Branche: Ein Agrar-Bot zieht ein
         * System mit Agrar-Baum vor, auch wenn ein anderes mehr Module hat. */
        const wertVon = s2 => s2?.wertJe?.[cfg.industry] ?? s2?.wert ?? -1;
        const beste = angebote.filter(s2 => hatPlatz(s2) && leistbar(s2) && (s2.portal || s2.ruf >= 50))
          .sort((a2, b2) => wertVon(b2) - wertVon(a2))[0];
        if (!t2.system) {
          if (beste) { const r = await em("installSystem", { x: t2.x, y: t2.y, produktId: beste.id }); if (r?.ok) swWechsel[key] = Date.now(); }
          continue;
        }
        if (t2.system.bis > st.tick) continue;   // Installation läuft noch
        if (beste && beste.id !== jetzt?.id && (!jetzt || wertVon(beste) > wertVon(jetzt) * 1.05)
            && Date.now() - (swWechsel[key] || 0) > 180_000) {
          const r = await em("installSystem", { x: t2.x, y: t2.y, produktId: beste.id });
          if (r?.ok) { swWechsel[key] = Date.now(); continue; }
        }
        if (jetzt?.module?.werbung) {
          /* Werbung nur mit dickem Polster: ein Abo kostet jetzt so viel wie
           * früher eine Dauerkampagne (rund 30 Minuten Abo als Reserve). */
          const abo = jetzt.werbeAbo || 0;
          const soll = me.cash > abo * 30 ? true : me.cash < abo * 10 ? false : !!t2.system.werbung;
          if (soll !== !!t2.system.werbung) await em("systemWerbung", { x: t2.x, y: t2.y, an: soll });
        }
      }
      /* Shops konfigurieren: eigene Ware zum Ø-Kurs, unbegrenzt — je Regal eine
       * andere Ware (der Online-Marktplatz hat vier Regale). Nur, was der Bot
       * selbst herstellt: Mit "alles über 5 Stück" stellte er im ersten
       * Messlauf sein eingekauftes Baumaterial (Beton, Ziegel) in die Regale. */
      const eigeneWare = new Set(cfg.alwaysSell || []);
      for (const t of st.map) if (t.owner === myId && t.btype) {
        const b = BTYPES[t.btype]; if (b?.out) eigeneWare.add(b.out); if (b?.proc) eigeneWare.add(b.proc.out);
      }
      for (const t of st.map) {
        if (t.owner !== myId || !t.shop) continue;
        /* Grundversorgung (alwaysSell: Strom, Wasser, Öl) gehört an die Börse —
         * andere Firmen brauchen sie zum Produzieren. Gemessen stellten die
         * Stadtwerke ihren Strom ins Regal, die Stadt kaufte das E-Werk leer,
         * und beide Software-Firmen standen 35 Minuten ohne Strom da. Nur echter
         * Überschuss darf ins Regal. */
        const grund = new Set(cfg.alwaysSell || []);
        const goods = (BTYPES[t.btype]?.retail?.goods || []).filter(g => me.inv[g] > (grund.has(g) ? 300 : 5) && eigeneWare.has(g))
          .sort((a2, b2) => (me.inv[b2] || 0) * (st.avg[b2] || 0) - (me.inv[a2] || 0) * (st.avg[a2] || 0));
        /* Grundversorgung wieder aus dem Regal nehmen, sobald der Überschuss weg ist. */
        t.shop.forEach((sl, i) => {
          if (sl && grund.has(sl.good) && (me.inv[sl.good] || 0) < 100) { em("configureShop", { x: t.x, y: t.y, slot: i, good: null }); t.shop[i] = null; }
        });
        const belegt = new Set(t.shop.filter(Boolean).map(sl => sl.good));
        t.shop.forEach((sl, i) => {
          if (sl) return;
          const g = goods.find(g2 => !belegt.has(g2));
          if (!g) return;
          belegt.add(g);
          em("configureShop", { x: t.x, y: t.y, slot: i, good: g, price: Math.round(st.avg[g] * 100) / 100 });
        });
      }
      /* Stadtprojekt: ebenfalls die Hälfte des Lagers liefern */
      if (st.stadtprojekt) for (const [g, n] of Object.entries(st.stadtprojekt.needs)) {
        const q = Math.min(Math.floor((me.inv[g] || 0) / 2), n.req - n.have);
        if (q > 0) await em("projektLiefern", { good: g, qty: q });
      }
      /* Großauftrag: die Hälfte des Lagers beisteuern */
      if (st.groupOrder) for (const [g, n] of Object.entries(st.groupOrder.needs)) {
        const q = Math.min(Math.floor((me.inv[g] || 0) / 2), n.req - n.have);
        if (q > 0) await em("contribute", { good: g, qty: q });
      }
      /* Zwangsversteigerungen: bieten bis max. 70 % des Neuwerts (Schnäppchenjäger).
       * Auf der leichten Stufe halten sich die Bots hier ganz raus. */
      for (const a of (lvl.auktionen ? st.auctions || [] : [])) {
        /* Inhalt eines Rennstalls zählt zum Wert des Loses, sonst unterbieten
         * Bots einen vollen Stall systematisch und der Verkaufsweg, den der
         * Stallbesitzer als einzigen hat, wäre praktisch wertlos. */
        const cap = Math.floor(((BTYPES[a.btype]?.cost || 0) + (a.inhalt || 0)) * 0.7);
        const next = Math.max(a.minBid, a.bestBid + Math.ceil(cap * 0.05));
        if (a.bestBidder !== myId && next <= cap && me.cash > next + 2500) {
          await em("bid", { auctionId: a.id, amount: next });
        }
      }
      /* --- Aktien ---
       * Reihenfolge wie in einer echten Firma: fehlt Kapital, wird zuerst
       * Beteiligung an FREMDEN Firmen zu Geld gemacht und erst danach die eigene
       * Firma verwässert. Preise richten sich nach dem Marktwert je 25 %-Block,
       * den der Server ohnehin mitliefert — vorher boten die Bots ihre eigene
       * Firma pauschal für 12 % des Nettovermögens an, also für rund die Hälfte
       * des fairen Preises. */
      const PAKET = 25;   // Bots handeln in Paketen zu 25 Aktien (wie früher ein 25-%-Block)
      const meinBlock = (st.players[myId]?.kurs || 0) * PAKET;
      const eigeneOffen = st.shareListings.some(l => l.sellerId === myId);
      if (me.cash < 1500 && !eigeneOffen) {
        const depot = (me.portfolio || []).filter(h => h.count > 0);
        if (depot.length) {
          /* Beteiligung abstoßen — leicht unter Marktwert, damit sie zügig weggeht */
          const h = depot.sort((a, b) => b.value - a.value)[0];
          const n = Math.min(PAKET, h.count);
          await em("listShares", { companyId: h.id, count: n, price: Math.max(200, Math.round(h.kurs * n * 0.95)) });
        } else if ((st.players[myId]?.ownPct ?? 0) > 50 && meinBlock > 0) {
          /* Notverkauf eigener Anteile: 10 % Abschlag auf den Marktwert, nicht mehr.
           * Untergrenze 50 %: Vorher stand hier nur "> 0", ein dauerhaft klammer
           * Bot verkaufte sich damit Block für Block bis auf null herunter.
           * Gemessen an Stahlfaust am Rundenende: Nettovermögen 0 bei 8.300 $
           * Umsatz und Bonität D — netWorth summiert ausschliesslich GEHALTENE
           * Anteile, und er hielt keinen einzigen mehr an sich selbst. Die
           * Anzeige war korrekt, die Firma hatte sich selbst aufgelöst. */
          await em("listShares", { count: PAKET, price: Math.max(400, Math.round(meinBlock * 0.9)) });
        }
      } else if (me.cash > 6000) {
        /* Günstige fremde Anteile aufsammeln: nur unter Marktwert zugreifen */
        const guenstig = (st.shareListings || [])
          .filter(l => l.sellerId !== myId && !l.toId && l.price <= me.cash * 0.3)
          .find(l => { const co = st.players[l.companyId]; return co && l.price < (co.kurs || 0) * l.count * 0.95; });
        if (guenstig) await em("buyShares", { listingId: guenstig.id });
        else if (lvl.leveln && Math.random() < 0.25) {
          /* Ab "Mittel" auch von sich aus Kaufanfragen stellen — sonst bleibt der
           * Handelsplatz tot, wenn gerade niemand etwas eingestellt hat. */
          const ziel = Object.values(st.players).find(pp =>
            pp.id !== myId && pp.ownPct >= PAKET && pp.kurs > 0 &&
            pp.kurs * PAKET < me.cash * 0.3 && !(st.shareBids || []).some(b => b.bidderId === myId && b.companyId === pp.id));
          if (ziel) await em("bidShares", { companyId: ziel.id, count: PAKET, price: Math.round(ziel.kurs * PAKET * 1.05) });
        }
      }
      /* Branchen-ETFs: Überschuss breit streuen, in der Klemme wieder verkaufen */
      if (me.cash < 1000 && (me.etf || []).length) {
        await em("etfVerkaufen", { branche: me.etf[0].branche, anteil: 1 });
      } else if (me.cash > 9000 && Math.random() < 0.08 && (st.etf || []).length) {
        const fremd = st.etf.filter(e => e.branche !== cfg.industry);
        const e = fremd[Math.floor(Math.random() * fremd.length)];
        if (e) await em("etfKaufen", { branche: e.branche, betrag: Math.round(me.cash * 0.1 / 100) * 100 });
      }
      /* Expansion: nächstes Gebäude, inkl. Zonen-Freischaltung + Materialkauf.
       * Reihenfolge IMMER: erst jedes Produkt der Branche einmal abdecken
       * (INDUSTRY_COVERAGE), erst danach in cfg.plan weiter (Shops, Werbung,
       * Dopplungen). planLoop-Spezialisten (Nordsee Öl) überspringen die
       * Abdeckung bewusst — die sollen ja nur ihr eines Produkt bauen. */
      /* Der Rennstall gehört keiner Branche und steht deshalb weder in
       * INDUSTRY_COVERAGE noch in cfg.plan. Hinten angehängt würde er nie
       * gebaut: Die Baugrenze der Stufe greift vorher (Stahlfaust auf "Mittel"
       * kommt über Planindex 4 nicht hinaus). Er wird darum direkt HINTER die
       * Produktabdeckung gesetzt — die Abdeckung behält ihren Vorrang, der
       * Rest des Plans rutscht um eins nach hinten, und die Grenze steigt um
       * genau eins, damit kein Gebäude aus dem Plan verlorengeht.
       * Auf "Einfach" bauen Bots keinen Stall — dieselbe Staffelung wie bei
       * den Zwangsversteigerungen. */
      /* Bots unterliegen derselben Schwelle wie Menschen — sonst stünden im
       * Frühspiel Bot-Ställe herum, während kein Spieler einen bauen darf. */
      const meinNW = st.players[myId]?.netWorth ?? 0;
      /* Im Kartellmodus lehnt der Server den Rennstall ab — ohne diese Zeile
       * liefe der Bot bis zum Rundenende gegen dieselbe Absage an, statt das
       * Geld in Produktion zu stecken. */
      const baueRennstall = !!cfg.rennstall && lvl.rennen && !cfg.planLoop
        && st.mode !== "kartell"
        && meinNW >= (botMeta?.racingUnlock ?? 200000);
      let gesamtplan = cfg.planLoop ? cfg.plan
        : [...(INDUSTRY_COVERAGE[cfg.industry] || []), ...(baueRennstall ? ["rennstall"] : []), ...cfg.plan];
      /* Sandbox: Werbeagentur gibt es nicht mehr (Regel 2). Dafür baut jeder
       * Bot früh einen Online-Marktplatz — direkt nach seinen ersten beiden
       * Produktionsgebäuden und zusätzlich zur Baugrenze, damit dafür keine
       * Produktion wegfällt. */
      /* Der Online-Marktplatz ist der einzige Laden: ohne ihn kein Verkauf an
       * die Stadt. Deshalb steht er immer direkt nach den ersten beiden
       * Produktionsgebäuden — zusätzlich zur Baugrenze. Ein zweiter (aus dem
       * Plan, früher Kontor oder Fachhandel) kommt später für mehr Regale. */
      let omBonus = 0;
      if (st.mode === "sandbox") gesamtplan = gesamtplan.filter(b => b !== "werbeagentur");
      if (!cfg.planLoop && cfg.industry !== "software" && st.mode !== "renntag" && st.mode !== "kartell") {   // Software-Bots haben nichts zu verkaufen
        gesamtplan.splice(Math.min(2, gesamtplan.length), 0, "onlinemarkt"); omBonus = 1;
      }
      const built = st.map.filter(t => t.owner === myId && t.btype).length;
      /* planLoop: der Bot arbeitet seinen Plan nicht einmal ab, sondern beginnt
       * danach wieder von vorn — für Spezialisten wie den Ölförderer. Die
       * Obergrenze kommt aus der Schwierigkeitsstufe, ein Bot kann sie zusätzlich
       * nach unten deckeln (cfg.maxGebaeude). */
      const rennBonus = baueRennstall ? 1 : 0;
      const maxGeb = Math.min(lvl.maxGebaeude + rennBonus + omBonus, (cfg.maxGebaeude ?? Infinity) + rennBonus + omBonus,
                              cfg.planLoop ? Infinity : gesamtplan.length);
      const planFertig = built >= maxGeb;

      /* ---- Fremdkapital ----
       * Bisher rührte kein Bot das Anleihesystem an: `issueBond` und `buyBond`
       * kamen in der ganzen Bot-Schleife nicht vor. Der komplette
       * Fremdkapitalmarkt lief damit nur, wenn zufällig zwei Menschen
       * gleichzeitig spielten — in einer normalen Runde passierte dort nichts.
       *
       * AUFNEHMEN: Genau der Fall, der heute als Kapitalfalle aufgefallen ist —
       * Stahlfaust stand mit 1356 $ fest, konnte keine Zutaten mehr kaufen und
       * kam ohne Produktion nie wieder hoch. Wer Substanz hat, aber kein
       * Bargeld, leiht sich jetzt welches, statt zu erstarren.
       * Bedingungen bewusst eng: mindestens zwei Gebäude als Sicherheit, keine
       * zweite Anleihe parallel, und ein Nettovermögen, das die Tilgung
       * überhaupt tragen kann. */
      const meineAnleihen = (st.bonds || []).filter(b => b.issuerId === myId);
      const meinRating = st.players[myId]?.rating || "BBB";
      /* Schwelle bewusst tief. Bei 1500 $ emittierte binnen Minuten FAST JEDER
       * Bot — sie pendeln ohnehin dauernd um diesen Wert. In der Messung lagen
       * dadurch fünf Anleihen gleichzeitig unverkauft am Markt, während der
       * reichste Bot nur 3568 $ hatte. Eine Anleihe soll die Ausnahme für einen
       * wirklich festgefahrenen Bot sein, nicht der Normalzustand. */
      /* Hürde war zuvor zusätzlich `meinNw > 4000`. Beides zusammen schliesst
       * sich in der Praxis aus: Bots mit Substanz geht das Bargeld nicht aus,
       * und dem einen, dem es ausging, fehlte genau diese Substanz. Ergebnis
       * einer vollen Runde über 78 Minuten: NULL Anleihen, das Feature löste
       * kein einziges Mal aus. Sicherheit sind jetzt die Gebäude selbst — sie
       * haften bei Zahlungsverzug ohnehin über das Pfandrecht. */
      if (me.cash < 1000 && built >= 2 && !meineAnleihen.length) {
        /* Zins nach eigener Bonität — schlechtere Schuldner müssen mehr bieten,
         * sonst zeichnet niemand. Der Satz gilt PRO MINUTE (Kupon je Sekunde =
         * principal * rate / 60), über 300 s Laufzeit sind das also das
         * Fünffache an Gesamtzins. */
        const zinsNachBonitaet = { AAA: 0.015, AA: 0.02, A: 0.025, BBB: 0.03, BB: 0.04, B: 0.05, CCC: 0.065, D: 0.08 };
        /* Bewusst klein gestückelt. Ein erster Anlauf mit bis zu 3000 $ ließ
         * drei Anleihen vier Minuten lang unverkauft liegen: Wer zeichnen
         * könnte, hat selten so viel entbehrliches Bargeld gleichzeitig. */
        /* Klein halten: Ein 1800-$-Papier verlangt vom Zeichner rund 2600 $
         * frei — so viel hat in dieser Wirtschaft selten jemand gleichzeitig.
         * 1200 $ sind aus einer Kasse von 2000 $ darstellbar. */
        /* Höhe an den Gebäuden bemessen statt am Nettovermögen: Der Wert der
         * Gebäude ist das, was im Ernstfall gepfändet wird, und er bleibt auch
         * dann stehen, wenn die Firma ihre Anteile abgegeben hat. */
        const gebaeudeWert = st.map.filter(t => t.owner === myId && t.btype)
          .reduce((a, t) => a + (BTYPES[t.btype]?.cost || 0), 0);
        const betrag = Math.min(1200, Math.round(gebaeudeWert * 0.15 / 100) * 100);
        if (betrag >= 500) {
          await em("issueBond", { principal: betrag, rate: zinsNachBonitaet[meinRating] ?? 0.04, term: 300 });
        }
      }
      /* ZEICHNEN: Wer Kapital übrig hat, legt es an, statt es liegen zu lassen.
       * Erst ab "Mittel" — dieselbe Grenze wie beim Aktienhandel. Nur solide
       * Schuldner und höchstens ein Drittel der eigenen Kasse je Anleihe,
       * damit ein Ausfall den Zeichner nicht mitreißt. */
      if (lvl.leveln) {
        /* Entbehrlich ist nur, was nach dem nächsten Gebäude übrig bleibt —
         * ist der Bauplan fertig, liegt die ganze Kasse ohnehin ungenutzt da.
         * Die vorherige feste Schwelle von 6000 $ hat nie gegriffen: Bots
         * emittieren erst, wenn sie klamm sind, und zu diesem Zeitpunkt lag in
         * der Messung KEIN Bot mehr darüber. Drei Anleihen blieben vier
         * Minuten unverkauft liegen, während die Emittenten weiter ausbluteten
         * (Stahlfaust 1246 -> 302 $). */
        const naechsteKosten = planFertig ? 0 : (BTYPES[gesamtplan[built % gesamtplan.length]]?.cost || 0);
        /* Ein dickes Polster darf auch dann gezeichnet werden, wenn noch ein
         * Gebäude aussteht — die Anleihe zahlt Nennbetrag und Zins binnen 300 s
         * zurück, der Bau verzögert sich also höchstens kurz. */
        /* Die Polstergrenze lag mit 4500 $ knapp über dem, was ein Bot in
         * dieser Wirtschaft je hält: In der Messung pendelte der reichste
         * (ChipWerke) bei 3700–4400 und zeichnete deshalb nie, während eine
         * Anleihe drei Minuten unverkauft lag. Die reguläre Rechnung greift
         * bei ihm ohnehin nicht, weil sein nächstes Gebäude mehr kostet als
         * seine gesamte Kasse. */
        const entbehrlich = Math.max(me.cash - naechsteKosten - 800, me.cash > 3000 ? me.cash - 2000 : 0);
        const solide = ["AAA", "AA", "A", "BBB"];
        const kandidat = (st.bonds || [])
          .filter(b => !b.holderId && b.issuerId !== myId
                    && solide.includes(b.issuerRating)
                    && b.principal <= entbehrlich && b.principal <= me.cash * 0.5)
          .sort((a, b) => b.rate - a.rate)[0];   // bester Zins zuerst
        if (kandidat) await em("buyBond", { bondId: kandidat.id });
      }
      if (Date.now() - lastBuild > lvl.bauPause && !planFertig) {
        let btid = gesamtplan[built % gesamtplan.length];
        if (BTYPES[btid]?.racing && st.map.some(t => t.owner === myId && BTYPES[t.btype]?.racing))
          btid = gesamtplan[(built + 1) % gesamtplan.length];
        const bt = BTYPES[btid];
        const mats = matCost(bt);
        const missingMat = Object.entries(mats).find(([g, n]) => me.inv[g] < n);
        if (missingMat && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === missingMat[0])) {
          /* Planwirtschaft: Baumaterial per Zuteilung statt Börse beziehen. */
          if (st.mode === "plan") {
            if (me.cash > 1200) await em("planRequest", { good: missingMat[0],
              qty: Math.ceil(missingMat[1] - me.inv[missingMat[0]]) + 2 });
          }
          /* fehlendes Baumaterial an der Börse nachfragen (etwas über Ø) */
          else if (me.cash > 2000) await em("placeOrder", { side: "buy", good: missingMat[0],
            qty: Math.ceil(missingMat[1] - me.inv[missingMat[0]]) + 4,
            price: Math.round(st.avg[missingMat[0]] * (lvl.kaufAufschlag + 0.03) * 100) / 100 });
        } else if (!missingMat) {
          /* Stadtgebäude ausschliessen. Die Suche nimmt die ERSTE passende Kachel,
           * und Bank wie Nachrichtenzentrale sehen wie freie Zentrumsflächen aus:
           * kein Besitzer, keine Strasse, nicht gesperrt. Trifft ein Bot eine
           * davon zuerst, scheitert sein Bau in jedem Zyklus erneut an derselben
           * Kachel — er käme in der Zone nie voran. Bei der Bank lag das seit
           * jeher latent vor, mit der zweiten Stadtkachel wird es wahrscheinlicher. */
          const frei = t => t.zone === bt.zone && !t.road && !t.water && !t.park && !t.bank && !t.news && !t.finanzamt && !t.deko;
          let t = st.map.find(t => frei(t) && !t.locked && !t.owner);
          if (!t) {   // Zone gesperrt → passende Kachel wird beim Bauen mit-freigeschaltet
            const lt = st.map.find(t => frei(t) && t.locked);
            if (lt && me.cash > bt.cost + lt.unlockCost + 800) t = lt;
          }
          /* Die Tilgungsreserve ist auch fürs Bauen tabu — sonst steht das
           * Geld am Stichtag im Gebäude statt in der Kasse. */
          const tilgungSperre = (st.bonds || []).find(b => b.issuerId === myId && b.holderId && b.termLeft < 90)?.principal || 0;
          if (t && me.cash > bt.cost + (t.locked ? t.unlockCost : 0) + 800 + tilgungSperre) {
            const r = await em("build", { x: t.x, y: t.y, btype: btid });
            if (r?.ok) lastBuild = Date.now();
          }
        }
      }
      /* Direktangebote (P2P-Verträge) prüfen: annehmen, wenn der Preis fair ist
       * (≤ 110 % Ø-Kurs) und genug Kapital da ist — sonst ablehnen, damit das
       * Angebot beim Anbieter nicht ewig offen hängen bleibt. */
      for (const c of st.contracts.filter(c => c.toId === myId)) {
        const fair = st.avg[c.good] ? c.price <= st.avg[c.good] * 1.1 : true;
        if (fair && me.cash >= c.qty * c.price) await em("acceptContract", { contractId: c.id });
        else await em("declineContract", { contractId: c.id });
      }
      /* Kaufanfragen auf die eigene Firma bewerten. Maßstab ist der eigene
       * Marktwert je 25 %-Block; je größer der abgegebene Anteil, desto höher
       * der verlangte Aufschlag — Kontrolle gibt niemand zum Nennwert her.
       * Klemmt es beim Kapital, wird auch zum fairen Preis verkauft. */
      for (const b of (st.shareBids || []).filter(b => b.companyId === myId)) {
        const block = st.players[myId]?.kurs || 0;   // je Aktie
        const fair = block * b.count;
        const klamm = me.cash < 1500;
        const verlangt = fair * (klamm ? 1 : 1 + 0.08 * b.count / 25);   // je 25 Aktien 8 % Aufschlag
        if (block > 0 && b.price >= verlangt) await em("acceptShareBid", { bidId: b.id });
        else await em("declineShareBid", { bidId: b.id });
      }
      /* VERALTETE EIGENE ORDERS ZURÜCKZIEHEN.
       * Der Bot legt nur dann eine neue Order an, wenn für die Ware noch keine
       * eigene offen ist. Wandert der Kurs danach weg, bleibt die alte für immer
       * im Buch stehen — und blockiert die Ware, weil ja "schon eine da ist".
       * Gemessen beim Öl: Ø-Kurs 6,47, eigenes Angebot noch bei 7,42 aus einer
       * Zeit mit Ø 7,57, daneben 37 Stück Nachfrage bei 6,62–6,64. Beide Seiten
       * waren da, trafen sich aber nie. Deshalb: was deutlich neben dem Markt
       * liegt, wird storniert. Das passiert bewusst GANZ AM ANFANG des Durchlaufs:
       * Stand es am Ende, sah der Bot beim Prüfen seines Bedarfs noch die alte
       * Order, übersprang sie deshalb, und die frische kam erst einen Takt
       * später — bei 26 Sekunden Takt driftete der Kurs derweil weiter davon. */
      for (const o of st.orders.filter(o => o.playerId === myId)) {
        const kurs = st.avg[o.good];
        if (!kurs) continue;
        /* Eng gefasst, weil die Bots selbst nur in einem schmalen Band handeln:
         * Sie bieten zu Ø×1,03 und stellen zu Ø×0,98–1,02 an. Eine Toleranz von
         * ±10 % war dadurch wirkungslos — gemessen lagen Angebot bei Ø×1,069 und
         * Gebot bei Ø×0,989, also 8 % auseinander und trotzdem beide "in Ordnung".
         * Sie standen sich gegenüber, ohne sich je zu treffen. */
        const daneben = o.side === "sell" ? o.price > kurs * 1.05 : o.price < kurs * 1.00;
        if (daneben) await em("cancelOrder", { orderId: o.id });
      }
      /* BEDARF DECKEN: stehende Kauforders für die Inputs der eigenen Industrie.
       * Auf "Schwer" kommen die Boost-Rohstoffe der eigenen Gebäude dazu — Strom
       * und Wasser im Lager steigern die Produktion um bis zu 150 %, das ist der
       * größte Hebel, den ein Bot ohne Sonderrechte ziehen kann. */
      const bedarf = new Set(cfg.needs);
      /* Boost-Rohstoffe nur mit Kapitalpolster kaufen — sonst geht das Geld für
       * Strom und Wasser drauf, das eigentlich das nächste Gebäude finanzieren
       * sollte, und der starke Bot fällt hinter den schwachen zurück. */
      if (lvl.boosten && me.cash > 6000) {
        for (const t of st.map) {
          if (t.owner !== myId || !t.btype) continue;
          for (const g of BTYPES[t.btype]?.boosts || []) bedarf.add(g);
        }
      }
      /* Einkaufsbudget statt Mindestkasse. Vorher stand hier die Bedingung
       * `me.cash > 1500` — eine harte Sperre, die einen Bot dauerhaft lahmlegen
       * konnte: Gemessen an Stahlfaust, der nach dem Bau seiner Waffenschmiede
       * bei 1356 $ landete. Damit kaufte er GAR NICHTS mehr, auch kein Erz und
       * kein Öl für ein paar Dollar. Ohne Zutaten stand die Produktion, ohne
       * Produktion kam kein Umsatz, und ohne Umsatz kam er nie wieder über die
       * 1500 — sein Bargeld stand über 8 Minuten unverändert auf 1356.
       * Zweiter Fehler am selben Ort: pauschal auf 25 Stück auffüllen. Bei
       * Stahl (~115 $) ist das eine Order über 2875 $ — mehr, als der Bot
       * überhaupt besitzt; die Order kam nie zustande oder hätte die Kasse in
       * einem Zug geleert. Jetzt wird ein Budget je Zyklus verteilt und die
       * Menge daran angepasst: teure Zutaten kommen eben in kleineren
       * Portionen, statt dass gar nicht gehandelt wird. Die Reserve stellt
       * sicher, dass weiter Geld fürs Bauen übrig bleibt. */
      /* Anteil bewusst niedrig: Ein erster Anlauf mit 70 % des Bargelds hat die
       * Falle zwar geöffnet, dafür aber das Sparen abgewürgt — Montan & Bau AG
       * verplante bei 2248 $ je Zyklus 1364 $ für Zutaten und wuchs damit nie an
       * sein Stahlwerk (6000 $) heran. Mit höchstens einem Drittel bleibt beides
       * möglich: laufender Nachschub UND Rücklage fürs nächste Gebäude. */
      /* Vor Fälligkeit einer eigenen Anleihe Geld zurücklegen. Ohne das rollt
       * die Schuld ewig weiter: Der Bot gibt sein Bargeld laufend für Zutaten
       * aus und hat zum Stichtag nie den Nennbetrag am Stück. Der Server setzt
       * dann termLeft zurück auf 30 s und vergibt fünf Strikes — die der
       * nächste bezahlte Kupon aber sofort wieder auf 0 setzt (siehe
       * b.strikes = 0 im Kuponzweig). Gemessen an Stahlfaust: dieselbe Anleihe
       * stand über drei Stichproben hinweg unverändert bei rest=24s, str=0,
       * ohne je getilgt zu werden — eine ewige Rente für den Zeichner und eine
       * Dauerlast für den Schuldner. */
      const faellig = (st.bonds || []).find(b => b.issuerId === myId && b.holderId && b.termLeft < 90);
      const tilgungsReserve = faellig ? faellig.principal : 0;
      let einkaufsbudget = Math.max(0, Math.min(me.cash - 300 - tilgungsReserve, me.cash * 0.35));
      for (const g of bedarf) {
        const vorratZiel = cfg.vorrat?.[g] ?? 25;   // Software-Bots halten mehr Strom (Rechenzentren)
        if (me.inv[g] >= vorratZiel) continue;
        if (st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === g)) continue;
        /* Aufschlag statt Abschlag. Vorher wurde mit (kaufAufschlag - 0.03)
         * geboten, also auf Stufe "Mittel" zu Ø × 0,97 — während Verkäufer zu
         * Ø × 1,02 anboten. Die beiden Seiten kreuzten sich nie: die Ziegelei
         * bekam kein Wasser, die Chipfabrik keinen Strom. Beide brauchen ihre
         * Zutat zwingend (die Produktion rechnet mit dem Minimum über alle
         * Inputs), also entstanden NULL Ziegel und NULL Elektronik, während
         * sich Erz und Silizium ungenutzt stapelten. Da jedes Gebäude Ziegel
         * kostet und jedes Upgrade Elektronik, konnte danach niemand mehr
         * bauen oder aufleveln. */
        let preis = Math.max(0.05, Math.round(st.avg[g] * (lvl.kaufAufschlag + 0.03) * 100) / 100);
        /* Fast leer: notfalls zum günstigsten Angebot kaufen — auch beim
         * teuren Stadtnetz (bis 1,7 × Ø). Sonst stehen Studio, Rechenzentrum
         * und Boosts still, während die eigene Order unter dem Angebot liegt. */
        if ((me.inv[g] || 0) < vorratZiel / 3) {
          const ask = st.orders.filter(o => o.good === g && o.side === "sell" && o.playerId !== myId).reduce((m, o) => Math.min(m, o.price), Infinity);
          if (ask > preis && ask <= st.avg[g] * 1.7) preis = ask;
        }
        /* Bis zur eigenen Obergrenze auffüllen statt pauschal 10 Stück. Eine
         * Chipfabrik verbrennt 36 Strom/Minute; mit 10 Stück je Zyklus (Takt
         * 26 s) kamen höchstens 23 an — sie lief also selbst bei perfekt
         * gefüllten Orders dauerhaft am Limit und stand die meiste Zeit still. */
        const wunsch = Math.max(10, Math.ceil(vorratZiel - (me.inv[g] || 0)));
        /* Software-Bots: Strom ist ihr Lebensnerv. Gemessen lief Byteforge bei
         * 836 $ Bargeld der Strom aus — KassenKlick fiel aus, alle Kunden
         * wanderten zu ShopStern ab, und die Firma kam nie wieder auf die Beine.
         * Wird der Vorrat knapp, darf der Bot fast sein ganzes Geld dafür nehmen. */
        if (cfg.vorrat?.[g] && (me.inv[g] || 0) < cfg.vorrat[g] / 3)
          einkaufsbudget = Math.max(einkaufsbudget, me.cash * 0.9 - tilgungsReserve);
        const qty = Math.min(wunsch, Math.floor(einkaufsbudget / preis));
        if (qty < 1) continue;
        einkaufsbudget -= qty * preis;
        await em("placeOrder", { side: "buy", good: g, qty, price: preis });
      }
      /* Grundversorger-Bots: definierte Waren laufend abstoßen statt zu horten,
       * damit der Markt für diese Güter nie trockenläuft (unabhängig davon, wie
       * dick das Orderbuch schon ist — anders als die generische Regel unten). */
      for (const g of cfg.alwaysSell || []) {
        if (me.inv[g] < 2) continue;
        const menge = Math.floor(me.inv[g] * 0.8);
        const offen = st.orders.find(o => o.playerId === myId && o.side === "sell" && o.good === g);
        if (offen) {
          /* Eine offene Order blockierte bisher jedes weitere Angebot — auch wenn
           * der Bestand danach um ein Vielfaches gewachsen war. Gemessen bei den
           * Stadtwerken: 411 Strom auf Lager, davon 10 am Markt, während die
           * Touristik händeringend welchen suchte. Ist inzwischen deutlich mehr
           * da, wird die alte Order durch eine größere ersetzt. */
          if (menge < offen.qty * 2) continue;
          await em("cancelOrder", { orderId: offen.id });
        }
        await em("placeOrder", { side: "sell", good: g, qty: menge,
          price: Math.max(0.05, Math.round(st.avg[g] * lvl.verkaufKurs * 100) / 100) });
      }
      /* Werbung: sobald eine eigene Agentur steht und die Reichweite absackt,
       * eine Kampagne nachlegen — aber nur mit Kapitalpolster, damit das Budget
       * fürs nächste Gebäude nicht draufgeht. Ab Stufe "Mittel". */
      if (lvl.leveln && me.ad?.agenturen > 0 && me.ad.reach < 40 && me.cash > 6000) {
        await em("bookAd", { paket: me.cash > 15000 ? "gross" : "mittel" });
      }
      /* Elektronik kaufen (alle außer der Tech-Industrie selbst, die produziert
       * es ja schon) und eigene Produktionsgebäude damit auflevel, sobald genug
       * da ist — hält die Nachfrage nach Elektronik am Laufen. */
      if (lvl.leveln && cfg.industry !== "tech" && me.inv.elektronik < 10 && me.cash > 2000 &&
          !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === "elektronik")) {
        await em("placeOrder", { side: "buy", good: "elektronik", qty: 5,
          price: Math.round(st.avg.elektronik * 1.03 * 100) / 100 });
      }
      /* Aufleveln erst, wenn die Branche vollständig abgedeckt ist. Der Grundsatz
       * "Abdeckung geht vor Dopplung" galt bisher nur fürs Bauen — Aufleveln lief
       * daneben ungebremst weiter und war meist billiger als das nächste fehlende
       * Gebäude. Gemessen an Montan & Bau AG über 24 Minuten: mine St.5,
       * ziegelei St.3, betonwerk St.1 — und KEIN Stahlwerk, obwohl es das vierte
       * Produkt der Branche ist. Im ganzen Spiel gab es damit null Stahl bei
       * einer Nachfrage von 22 Stück. Eine Firma, die ihre Mine zum fünften Mal
       * ausbaut, während ihr Kernprodukt fehlt, wirtschaftet nicht plausibel. */
      const abdeckung = INDUSTRY_COVERAGE[cfg.industry] || [];
      const abdeckungFertig = cfg.planLoop || built >= abdeckung.length;
      const upgradable = lvl.leveln && abdeckungFertig && st.map.find(t => t.owner === myId && t.btype &&
        (BTYPES[t.btype].out || BTYPES[t.btype].proc) && (t.level || 1) < 5);
      if (upgradable) {
        const ubt = BTYPES[upgradable.btype], ulvl = upgradable.level || 1;
        const ec = Math.ceil(ubt.cost / 2500 * ulvl), cc = Math.round(ubt.cost * 0.35 * ulvl);
        if (me.inv.elektronik >= ec && me.cash > cc + 1000) {
          await em("upgradeBuilding", { x: upgradable.x, y: upgradable.y });
        }
      }
      /* ZUERST ECHTE NACHFRAGE BEDIENEN.
       * Die generische Regel darunter verlangt 18 Stück auf Lager. Verarbeitete
       * Waren erreichen diese Schwelle nie: Der Bot verbaut seine Ziegel selbst
       * und verbraucht seine Elektronik fürs Aufleveln, er pendelt also dauerhaft
       * darunter. Das Ergebnis war ein Markt, auf dem Ziegel und Elektronik
       * ständig nachgefragt, aber nie angeboten wurden — und in dem niemand mehr
       * bauen oder aufleveln konnte, sobald das Startmaterial aufgebraucht war.
       * Liegt ein fremdes Kaufgebot vor und ist mehr als die eigene Reserve da,
       * wird jetzt verkauft: höchstes Gebot zuerst. */
      /* Reserve gestaffelt: Von Baumaterial bleibt genug für das nächste eigene
       * Gebäude liegen (sonst verkauft der Bot seine Ziegel und muss sie gleich
       * darauf teurer zurückkaufen), von allem anderen nur ein kleiner Rest.
       * Elektronik pendelte in der Messung um 9 Stück — mit einer pauschalen
       * Reserve von 6 wären davon nur 3 je Zyklus in den Markt gegangen, zu
       * wenig, um die Nachfrage je einzuholen. */
      const reserveFuer = g => (g === "ziegel" || g === "beton") ? 12 : 3;
      /* Rangfolge nach AUFSCHLAG auf den Ø-Kurs, nicht nach dem Stückpreis.
       * Vorher stand hier `b.price - a.price` — quer über alle Waren sortiert,
       * also gewann immer die teuerste Ware. Strom kostet rund 2 $, Stahl 127 $,
       * ein Panzer 478 $: Ein einzelnes Stahlgebot schlug damit jedes
       * Stromgebot, auch wenn dort Hunderte Einheiten gesucht wurden. Genau die
       * billigsten Waren — Strom und Wasser — sind aber die Boost-Zutaten, die
       * jede Branche dauernd braucht. Gemessen in einer 50-Minuten-Runde:
       * Nachfrage nach Strom stieg auf 244 Stück bei einem Angebot von null,
       * während teurere Waren bedient wurden.
       * Der Aufschlag ist zudem das ehrlichere Signal: Er zeigt, wie dringend
       * jemand die Ware braucht, unabhängig davon, was sie grundsätzlich kostet. */
      const aufschlag = o => o.price / Math.max(0.01, st.avg[o.good] || o.price);
      const gebote = st.orders
        .filter(o => o.side === "buy" && o.playerId !== myId &&
                     (me.inv[o.good] || 0) > reserveFuer(o.good) + 1)
        .sort((a, b) => aufschlag(b) - aufschlag(a));
      /* Mehrere Gebote je Zyklus bedienen. Bei einem einzigen pro Bot-Takt
       * (26 s auf "Mittel") holt der Markt eine Nachfrage von 244 Stück nie
       * ein — ein Bot hätte dafür Stunden gebraucht. */
      for (const g of gebote.slice(0, 3)) {
        const menge = Math.min(g.qty, Math.floor((me.inv[g.good] || 0) - reserveFuer(g.good)));
        if (menge >= 1) await em("takeOrder", { orderId: g.id, qty: menge });
      }
      /* BÖRSE BEFÜLLEN ohne Überschuss: nur wenn das Buch dünn ist */
      let eingestellt = 0;
      for (const g of Object.keys(me.inv)) {
        if (me.inv[g] < 18) continue;
        /* Das Stadtnetz zählt nicht mit: Sein teures Notangebot (20 Elektronik)
         * hielt ChipWerke sonst davon ab, je selbst Elektronik anzubieten —
         * gemessen lagen nach 45 Minuten 890 Stück ungenutzt in ihrem Lager. */
        const bookQty = st.orders.filter(o => o.side === "sell" && o.good === g && o.playerId !== STADTNETZ_ID).reduce((s, o) => s + o.qty, 0);
        if (bookQty >= 15) continue;   // Spieler-Angebot hat Vorrang
        if (st.orders.some(o => o.playerId === myId && o.side === "sell" && o.good === g)) continue;
        /* Großer Überschuss geht in größeren Posten raus: Mit höchstens 10 Stück
         * je Zyklus lagen bei ChipWerke nach 45 Minuten 770 Elektronik, während
         * andere sie händeringend suchten. */
        const posten = Math.max(10, Math.min(200, Math.floor((me.inv[g] - 8) * 0.25)));
        await em("placeOrder", { side: "sell", good: g, qty: Math.min(posten, Math.floor(me.inv[g] - 8)),
          price: Math.round(st.avg[g] * (lvl.verkaufKurs + 0.04) * 100) / 100 });
        if (++eingestellt >= 2) break;   // zwei Waren je Zyklus statt einer
      }
    } catch {} finally { laeuft = false; }
  }, lvl.takt + Math.random() * 8000);
  botHandles.push({ socket: s, timer });
}

/* Letztes Sicherheitsnetz: Server bleibt auch bei einem übersehenen Bug am Leben
 * (sonst beendet Node den Prozess standardmäßig bei jeder unabgefangenen Exception). */
process.on("uncaughtException", e => console.error("Unerwarteter Fehler (Server läuft weiter):", e));
process.on("unhandledRejection", e => console.error("Unerwarteter Promise-Fehler (Server läuft weiter):", e));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`Capital Sandbox Server → http://localhost:${PORT}`);
  for (const u of lanUrls(PORT)) console.log(`  Einladungslink (LAN): ${u}`);
  console.log(`  Bugreports (Admin): http://localhost:${PORT}/bugs?key=${BUGKEY}`);
  /* Früher spannte "--share" hier einen localtunnel auf. Das Paket ist raus:
   * es schleppte zwei hochbewertete Sicherheitslücken (axios) mit und wurde
   * überflüssig, seit es eine eigene öffentliche Adresse gibt. */
  if (process.argv.includes("--share")) {
    console.log("  Hinweis: --share gibt es nicht mehr. Für öffentliche Runden das Gateway");
    console.log("  hinter der eigenen Domain betreiben (npm run gateway), im Heimnetz genügt der LAN-Link.");
  }
});
