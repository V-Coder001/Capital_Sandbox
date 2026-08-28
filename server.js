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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
/* Vom Standort dieser Datei aus, nicht vom Arbeitsverzeichnis: Sonst liefert
 * der Server stillschweigend nichts aus, sobald er von woanders gestartet wird
 * — genau das ist beim Dev-Server passiert. */
app.use(express.static(path.join(__dirname, "public")));

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
app.get("/api/invite", (_req, res) => {
  res.json({ urls: [ ...(publicUrl ? [publicUrl] : []), ...lanUrls(PORT) ], bootId: BOOT_ID });
});
/* ---------- Bugreports ----------
 * Spieler melden Fehler mit Beschreibung und optionalem Screenshot; die
 * Meldungen landen als JSON-Zeilen plus Bilddateien im Ordner bugreports/.
 * Die Admin-Ansicht unter /bugs ist mit einem Schlüssel geschützt, der beim
 * ersten Start erzeugt und in bugreports/.key abgelegt wird (überschreibbar
 * per Umgebungsvariable BUGS_KEY). Der fertige Link steht im Server-Log. */
const BUGDIR = path.join(__dirname, "bugreports");
fs.mkdirSync(BUGDIR, { recursive: true });
let BUGKEY = process.env.BUGS_KEY || "";
if (!BUGKEY) {
  try { BUGKEY = fs.readFileSync(path.join(BUGDIR, ".key"), "utf8").trim(); } catch {}
  if (!BUGKEY) { BUGKEY = crypto.randomBytes(6).toString("hex"); fs.writeFileSync(path.join(BUGDIR, ".key"), BUGKEY); }
}
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
app.post("/admin/eingriff", express.json(), (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: "nicht angemeldet" });
  const p = G.players[String(req.body?.pid || "")];
  if (!p) return res.status(404).json({ error: "Spieler unbekannt" });
  const art = String(req.body?.art || "");
  if (art === "geld") {
    const betrag = Math.round(+req.body.betrag || 0);
    if (!betrag) return res.status(400).json({ error: "Betrag fehlt" });
    p.cash = Math.max(0, p.cash + betrag);
    logTx(p, "Admin", betrag > 0 ? "Gutschrift durch die Verwaltung" : "Abbuchung durch die Verwaltung", betrag);
    io.emit("notice", { text: `Verwaltung: ${p.name} ${betrag > 0 ? "erhält" : "verliert"} ${Math.abs(betrag).toLocaleString("de-DE")} $.` });
  } else if (art === "ware") {
    const good = String(req.body.good || "");
    const menge = Math.round(+req.body.menge || 0);
    if (!GOODS[good]) return res.status(400).json({ error: "Ware unbekannt" });
    if (!menge) return res.status(400).json({ error: "Menge fehlt" });
    p.inv[good] = Math.max(0, (p.inv[good] || 0) + menge);
    logTx(p, "Admin", `${menge > 0 ? "+" : ""}${menge} ${GOODS[good].name} durch die Verwaltung`, 0);
  } else return res.status(400).json({ error: "Unbekannte Aktion" });
  pushState();
  res.json({ ok: true, cash: Math.round(p.cash) });
});
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
  <h2>Firmen</h2>
  ${spieler.length ? `<table><tr><th>Firma</th><th class="num">Bargeld</th><th class="num">Nettovermögen</th>
    <th class="num">Rating</th><th class="num">Gebäude</th><th>Geld</th><th>Ware</th></tr>${zeilen}</table>`
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
const ware = pid => senden({ art: "ware", pid,
  good: document.getElementById("w-" + pid).value, menge: +document.getElementById("m-" + pid).value });
</script>`);
});

const httpServer = http.createServer(app);
const io = new Server(httpServer);

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
                rennreifen: 165, rennsoftware: 210 };

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
};
/* Baumaterial-Bedarf jedes Gebäudes: Ziegel immer, Beton ab $4.000. Elektronik
 * wird NICHT zum Bauen gebraucht, sondern zum Aufleveln bestehender Gebäude
 * (siehe upgradeCost / "upgradeBuilding"-Handler weiter unten). */
const matCost = bt => {
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
const RENN_RUNDE = 900;          // Distanz einer Runde (für Runden-Anzeige und Streckengrafik)
const WETT_RAKE = 0.1;           // Anteil des Wettpools, der in den Preistopf fließt

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
function rennQuoten(r) {
  const pool = r.wetten.reduce((s, w) => s + w.betrag, 0);
  const q = {};
  for (const teil of r.teilnehmer) {
    const drauf = r.wetten.filter(w => w.autoId === teil.autoId).reduce((s, w) => s + w.betrag, 0);
    q[teil.autoId] = drauf > 0 ? Math.max(1.1, Math.round(pool * (1 - WETT_RAKE) / drauf * 100) / 100) : null;
  }
  return { pool, quoten: q };
}
function rennAnkuendigen() {
  G.rennen = { id: id(), phase: "anmeldung", rest: RENN_ANMELDUNG, teilnehmer: [], wetten: [], sponsoren: [] };
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
  io.emit("notice", { text: `🏁 Startflagge! ${r.teilnehmer.length} Wagen sind auf der Strecke.` });
}
/* Ein Simulationsschritt pro Sekunde: Tempo aus Wagenwerten, Fahrerkönnen und
 * Zustand; die Konstanz des Fahrers bestimmt, wie stark das Tempo streut.
 * Standfestigkeit und Verschleiß speisen das Ausfallrisiko. */
function rennTick() {
  const r = G.rennen;
  for (const teil of r.teilnehmer) {
    if (teil.ausgefallen) continue;
    const fund = findeAuto(teil.autoId);
    if (!fund) { teil.ausgefallen = true; continue; }
    const { a } = fund;
    const w = autoWerte(a);
    const f = G.fahrer.find(x => x.id === teil.fahrerId);
    const fWert = f ? (f.speed + f.handling + f.reaktion) / 3 + f.erfahrung * .15 : 40;
    const koennen = w.speed * .45 + w.beschl * .2 + w.handling * .2 + fWert * .45;
    const streu = 1 + (Math.random() - .5) * (f ? (1.4 - f.konstanz / 100) : .7);
    teil.dist += koennen * streu * (a.zustand / 100 * .4 + .6) / 6;
    /* Kalibrierung: Ein frischer Wagen mit Standfestigkeit 84 soll pro Rennen
     * etwa 10 % Ausfallchance haben, ein verschlissener deutlich mehr — mit
     * den ersten Werten (0.00045/0.0004) fielen im Test BEIDE Wagen aus. */
    const risiko = (100 - w.standfest) * .00016 + (100 - a.zustand) * .00025;
    if (Math.random() < risiko) {
      teil.ausgefallen = true;
      io.emit("notice", { text: `💥 ${teil.name} (${teil.team}) rollt aus — technischer Defekt!` });
    }
  }
}
function rennBeenden() {
  const r = G.rennen;
  const reihen = [...r.teilnehmer].sort((x, y) => (x.ausgefallen - y.ausgefallen) || (y.dist - x.dist));
  const { pool } = rennQuoten(r);
  const topf = RENN_GRUNDPREIS + r.teilnehmer.length * RENN_NENNGELD * 2 + Math.round(pool * WETT_RAKE);
  const anteile = r.teilnehmer.length >= 3 ? [.5, .3, .2] : [.65, .35];
  reihen.forEach((teil, i) => {
    teil.platz = i + 1;
    const fund = findeAuto(teil.autoId);
    const a = fund?.a;
    const f = G.fahrer.find(x => x.id === teil.fahrerId);
    const kmHeute = Math.round(teil.dist / 10);
    if (a) {
      a.rennen++; a.km = (a.km || 0) + kmHeute;
      a.zustand = Math.max(5, Math.round(a.zustand - (8 + Math.random() * 10) - (teil.ausgefallen ? 10 : 0)));
      if (i === 0 && !teil.ausgefallen) a.siege++;
      (a.historie ??= []).push({ t: G.tick, text: `Rennen: Platz ${i + 1}${teil.ausgefallen ? " (ausgefallen)" : ""} · ${kmHeute} km`, amt: 0 });
    }
    if (f) { f.rennen++; if (i === 0 && !teil.ausgefallen) { f.siege++; f.ruf += 10; } else f.ruf += Math.max(0, 4 - i); }
    const preis = Math.round(topf * (anteile[i] || 0));
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
  /* Wetten: Siegereinsätze bekommen den Pool (abzüglich Rake) nach Schlussquote. */
  const sieger = reihen[0];
  const drauf = r.wetten.filter(w => w.autoId === sieger.autoId);
  const einsatzSieger = drauf.reduce((s, w) => s + w.betrag, 0);
  const quote = einsatzSieger > 0 ? Math.max(1.1, pool * (1 - WETT_RAKE) / einsatzSieger) : 0;
  for (const w of drauf) {
    const p = G.players[w.playerId];
    const gewinn = Math.round(w.betrag * quote);
    if (p) { p.cash += gewinn; logTx(p, "Motorsport", `Wette gewonnen: ${sieger.name} (Quote ${quote.toFixed(2)})`, gewinn); }
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
  chipfabrik: { name: "Chipfabrik", en: "Chip factory",  cost: 3200, out: null, rate: 0, zone: "industrie", industry: "tech",      proc: { in: { silizium: 0.7, strom: 0.5 }, out: "elektronik", rate: 10/30 } },
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
  kontor:     { name: "Handelskontor", en: "Trading house",     cost: 3500, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.7, goods: Object.keys(GOODS).filter(g => !VEHICLES.includes(g) && !WEAPONS.includes(g)) } },
  autohaus:   { name: "Autohaus", en: "Car dealership",           cost: 5000, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.30, goods: VEHICLES } },
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
  /* Werbeagentur: produziert nichts und verkauft nichts. Sie schaltet
   * Kampagnen frei, die den Preis anheben, den die Kundschaft in den EIGENEN
   * Läden ohne Tempoverlust akzeptiert. Darf jede Industrie bauen. */
  werbeagentur: { name: "Werbeagentur", en: "Ad agency",     cost: 3500, out: null, rate: 0, zone: "zentrum",   ad: true },
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
const retailFlow = good => Math.min(10, Math.max(0.30, Math.pow(RETAIL_REF / BASEP[good], RETAIL_K)));

/* ---------- Werbung ----------
 * Reichweite ist ein Vorrat, der laufend zerfällt: gebuchte Kampagnen füllen ihn
 * auf, ohne Nachschub ist er nach gut zwei Minuten praktisch weg und die Preise
 * fallen auf den Ø-Kurs zurück. Wie hoch der Aufschlag maximal reichen kann,
 * hängt an der Zahl der eigenen Werbeagenturen — ohne Agentur wirkt gar nichts. */
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
const adBoost = p => 1 + adCap(adAgenturen(p)) * Math.min(100, p.adReach || 0) / 100;
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
const START_CASH = +process.env.START_CASH || 9500, MAP_W = 26, MAP_H = 26;

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

/* ---------- Spielmodus ----------
 * "sandbox": die freie Marktwirtschaft wie bisher.
 * "plan": Planwirtschaft im DDR-Stil — kein Vermögensziel, sondern Plansolls
 * vom Planbüro. Spieler liefern Waren zu festen Ankaufspreisen ab und sammeln
 * Planpunkte; nach fünf Planphasen (oder beim Punkteziel) gewinnt der
 * "Held der Arbeit". Der Host wählt den Modus im Warteraum. */
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

/* ---------- Karte (deterministisch, damit alle Clients identisch rendern) ---------- */
function buildMap(mode = "sandbox") {
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
  tick: 0, winner: null, report: null,
  /* Warteraum: die Runde läuft erst, wenn der Host sie startet — bis dahin
   * sammeln sich die Mitspieler, ohne dass Produktion oder Bots anlaufen. */
  started: false, hostId: null,
  groupOrder: null, nextGroupIn: 20,   // erster Stadt-Auftrag nach 20 s
  shareListings: [],     // {id, companyId, sellerId, count(1-4 = 25%-Schritte), price, ts, toId}
  shareBids: [],         // Kaufanfragen an eine Firma: {id, companyId, bidderId, count, price, ttl}
  nextDividendIn: DIVIDEND_INTERVAL,
  fahrer: [],            // Fahrerpool der Runde: {id, name, land, Werte…, teamId, autoId}
  fahrerGehaltIn: FAHRER_GEHALT_TAKT,
  rennen: null,                    // laufender Renntag (Anmeldung/Rennen/Ergebnis)
  naechstesRennenIn: RENN_INTERVALL,
};
let nextId = 1;
const id = () => nextId++;

const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : G.map[y * MAP_W + x];

function newPlayer(pid, name, color, industry, socketId) {
  const inv = Object.fromEntries(Object.keys(GOODS).map(k => [k, 0]));
  inv.ziegel = 22;   // reicht für 2 Grundgebäude + 1 Verarbeitungsgebäude (max. 21 nötig), danach Börse
  /* Beton von Anfang an: alles ab 4.000 $ Baukosten verlangt welchen, hergestellt
   * wird er aber ausschließlich im Betonwerk der Rohstoffindustrie. Spielt niemand
   * diese Industrie, wäre sonst der gesamte zweite Bauabschnitt für alle gesperrt.
   * 6 Stück decken genau ein Gebäude bis 12.000 $ ab — danach führt der Weg über
   * die Börse. */
  inv.beton = 6;
  /* Testhilfe (nur per Umgebungsvariable): TEST_GARAGE=1 legt jedem neuen
   * Spieler Fahrzeuge, Tuningteile und Baumaterial ins Lager — zum schnellen
   * Durchspielen des Renntags, ohne die Produktionskette hochzuziehen. */
  if (process.env.TEST_GARAGE) { inv.eauto = 2; inv.benzinauto = 1; inv.rennreifen = 12; inv.rennsoftware = 12; inv.ziegel = 200; inv.beton = 40; }
  return { id: pid, name, color, industry, industries: [industry], cash: START_CASH, xp: 0, lvl: 1,
    inv,
    equityAvg: {},     // companyId -> Ø-Einstand je 25-%-Block (Durchschnittsmethode)
    quests: {},        // Starter-Aufgaben: {id: {n, done}}
    tx: [],            // Transaktions-Log: {t, cat, text, amt}
    sales: {},         // je Ware: {botQty, botRev, playerQty, playerRev, buyQty, buyCost}
    /* Laufende Summen für die Rundenauswertung. p.revenue taugt dafür nicht —
     * das wird bei jeder Dividende auf 0 gesetzt, und revBuckets deckt nur die
     * letzten 10 Minuten ab. */
    stats: { produziert: {}, umsatz: 0, ausgaben: 0, gebaut: 0, abgerissen: 0,
             grossauftraege: 0, besterHandel: null, dividendeRein: 0, dividendeRaus: 0,
             werbung: 0, anteileGekauft: 0, anteileVerkauft: 0, fusionen: 0,
             zinsErtrag: 0, zinsAufwand: 0, aufgelevelt: 0 },
    fin: { zinsErtrag: 0, zinsAufwand: 0 },
    nwHist: [],        // Nettovermögens-Verlauf für den Chart
    equity: { [pid]: 4 },   // Cap-Table: holderId -> Anzahl 25%-Anteile (Summe immer 4)
    adReach: 0,        // Werbe-Reichweite 0–100, zerfällt laufend (siehe AD_DECAY)
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
let bldCache = { tick: -1, byOwner: null };
function buildingValueOf(pid) {
  /* Gebäudewerte einmal je Tick über die ganze Karte summieren statt für jede
   * Bewertung erneut — netWorth ruft substance() sonst für jeden Spieler auf
   * und läuft dabei jedes Mal über alle 676 Kacheln. */
  if (bldCache.tick !== G.tick) {
    const by = {};
    for (const t of G.map) if (t.owner && t.btype) {
      by[t.owner] = (by[t.owner] || 0) + BTYPES[t.btype].cost * 0.7;
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
  let v = p.cash + buildingValueOf(p.id);
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
    const blocks = o.equity[p.id] || 0;
    if (blocks > 0) nw += substance(o) * (blocks / 4);
  }
  /* Anteile, die gerade zum Verkauf angeboten sind, liegen in Verwahrung und
   * fehlen in der Cap-Table — sie gehören aber weiter dem Anbieter. */
  for (const l of G.shareListings) {
    const co = G.players[l.companyId];
    if (co && (l.sellerId ?? l.companyId) === p.id) nw += substance(co) * (l.count / 4);
  }
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
const companyValue = p => Math.max(500, substance(p));
const blockPrice = p => Math.round(companyValue(p) / 4);   // Preis für 25 %
/* Ein zurückgezogenes oder hinfälliges Angebot gibt die verwahrten Anteile an
 * den Verkäufer zurück — sonst verschwänden sie aus der Cap-Table und die Summe
 * der Anteile einer Firma wäre nicht mehr 100 %. */
function returnListingToSeller(l) {
  const company = G.players[l.companyId];
  const sellerId = l.sellerId ?? l.companyId;
  if (!company || !G.players[sellerId]) return;
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
    logTx(buyer, "Kauf", `Kauf ${qty}× ${gname} von ${seller?.name ?? "?"}`, -qty * price); }
  if (seller) { seller.cash += qty * price; addRevenue(seller, qty * price); gainXp(seller, 2);
    const r = salesRec(seller, good); r.playerQty += qty; r.playerRev += qty * price;
    const summe = qty * price;
    if (!seller.stats.besterHandel || summe > seller.stats.besterHandel.summe)
      seller.stats.besterHandel = { good, qty, price, summe, partner: buyer?.name ?? "?" };
    logTx(seller, "Verkauf", `Verkauf ${qty}× ${gname} an ${buyer?.name ?? "?"}`, qty * price); }
  G.lastTrade[good] = price;
  io.emit("trade", { good, qty, price, buyer: buyer?.name, seller: seller?.name });
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
  G.groupOrder = { id: id(), city, needs, contrib: {}, ttl: GROUP_TTL };
  const txt = Object.entries(needs).map(([g, n]) => `${n.req}× ${GOODS[g].name}`).join(" und ");
  const vol = Object.entries(needs).reduce((s, [g, n]) => s + n.req * n.pay, 0);
  io.emit("notice", { text: `GROSSAUFTRAG: ${city} braucht ${txt} — Gesamttopf ~${Math.round(vol).toLocaleString("de-DE")} $ (Ø×${GROUP_PAYOUT_MULT}, beste Vergütung im Spiel)! ${GROUP_TTL / 60} Minuten Zeit.` });
}
function finishGroupOrder() {
  const o = G.groupOrder;
  for (const [pid, goods] of Object.entries(o.contrib)) {
    const p = G.players[pid];
    if (!p) continue;
    let sum = 0;
    for (const [g, qty] of Object.entries(goods)) sum += qty * o.needs[g].pay;   // fixierter Stückpreis
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
      ? `On the exchange, ${liste(spitze.map(x => `${x.p.name} ${proz(x.v)}`))} gained in value. A 25 percent block in ${spitze[0].p.name} now costs $${zahl(blockPrice(spitze[0].p))}.`
      : `An der Börse ${spitze.length > 1 ? "gewannen" : "gewann"} ${liste(spitze.map(x => `${x.p.name} ${proz(x.v)}`))} an Wert. Ein 25-Prozent-Block an ${spitze[0].p.name} kostet inzwischen ${zahl(blockPrice(spitze[0].p))} $.`);
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

function distributeDividends() {
  for (const p of Object.values(G.players)) {
    const revenue = p.revenue;
    if (revenue > 0) {
      const pool = Math.min(revenue * DIVIDEND_RATE, Math.max(0, p.cash));
      let paidOut = 0;
      if (pool > 0.01) {
        for (const [holderId, count] of Object.entries(p.equity)) {
          if (holderId === p.id || !(count > 0)) continue;
          const holder = G.players[holderId];
          if (!holder) continue;
          const share = pool * (count / 4);
          p.cash -= share; holder.cash += share; paidOut += share;
          holder.stats.dividendeRein += share; p.stats.dividendeRaus += share;
          logTx(holder, "Dividende", `${count * 25}% Anteil an ${p.name}`, share);
          emitTo(holderId, "notice", { text: `Dividende von ${p.name}: +${Math.round(share)} $ (${count * 25}% Anteil)` });
        }
        /* Nur loggen, wenn wirklich Geld an externe Aktionäre floss — bei 100 %
         * Eigenbesitz bleibt das Geld komplett in der Firma, keine Ausschüttung. */
        if (paidOut > 0.01) logTx(p, "Dividende", "Dividenden an Aktionäre ausgeschüttet", -paidOut);
      }
    }
    p.revenue = 0;
  }
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
  { id: "unlock",  text: "Schalte eine Kachel in einer Sperrzone frei", en: "Unlock a tile in a locked zone",   target: 1,    reward:  500 },
  { id: "upgrade", text: "Level ein Gebäude mit Elektronik auf Stufe 2", en: "Upgrade a building to level 2 using electronics",  target: 1,    reward: 1500 },
  { id: "shares",  text: "Kaufe an der Stadtbank Anteile einer Firma", en: "Buy shares in a company at the city bank",    target: 1,    reward: 1800 },
];
function questProg(p, id, n = 1) {
  const def = QUESTS.find(q => q.id === id);
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
    started: G.started, hostId: G.hostId,
    mode: MODE, plan: MODE === "plan" ? G.plan : null,
    lobby: G.started ? null : { winGoal: WIN_NW, bots: botAuswahl, botLevel: botLevelKey, mode: MODE },
    map: G.map.map(t => ({ x: t.x, y: t.y, zone: t.zone, road: t.road, water: t.water,
      park: t.park, field: t.field, sand: t.sand, deep: t.deep, rock: t.rock,
      bank: t.bank, news: t.news, schwarz: t.schwarz, locked: t.locked, unlockCost: t.unlockCost, owner: t.owner, btype: t.btype, lien: t.lien, shop: t.shop, paused: t.paused, level: t.level, autos: autosDyn(t) })),
    players: Object.fromEntries(Object.entries(G.players).map(([sid, p]) =>
      [sid, { id: sid, name: p.name, color: p.color, lvl: p.lvl, xp: p.xp, industry: p.industry, industries: p.industries,
              netWorth: Math.round(netWorth(p)), rating: rating(p), rank: rankOf[sid],
              /* Kennzahlen für den Aktienhandel an der Bank */
              marketValue: Math.round(companyValue(p)), blockPrice: blockPrice(p), rev10: Math.round(rev10(p)),
              ownPct: (p.equity[sid] || 0) * 25,
              equity: Object.fromEntries(Object.entries(p.equity).filter(([, c]) => c > 0)
                .map(([hid, c]) => [G.players[hid]?.name ?? "—", c * 25])) }])),
    orders: G.orders,
    bonds: G.bonds.map(b => ({ ...b, issuer: G.players[b.issuerId]?.name ?? "—",
      holder: b.holderId ? (G.players[b.holderId]?.name ?? "—") : null,
      issuerRating: G.players[b.issuerId] ? rating(G.players[b.issuerId]) : "D" })),
    shareBids: G.shareBids.map(b => ({ ...b,
      company: G.players[b.companyId]?.name ?? "—",
      bidder: G.players[b.bidderId]?.name ?? "—" })),
    shareListings: G.shareListings.map(l => ({ ...l,
      sellerId: l.sellerId ?? l.companyId,
      company: G.players[l.companyId]?.name ?? "—",
      seller: G.players[l.sellerId ?? l.companyId]?.name ?? "—",
      isIssue: (l.sellerId ?? l.companyId) === l.companyId,   // Emission der Firma statt Weiterverkauf
      toName: l.toId ? (G.players[l.toId]?.name ?? "—") : null })),
    nextDividendIn: G.nextDividendIn,
    auctions: G.auctions,
    fahrer: G.fahrer,
    rennen: G.rennen ? (() => {
      const { pool, quoten } = rennQuoten(G.rennen);
      return {
        phase: G.rennen.phase, rest: G.rennen.rest, pool, quoten, runde: RENN_RUNDE,
        nenngeld: RENN_NENNGELD,
        topf: G.rennen.topf ?? (RENN_GRUNDPREIS + G.rennen.teilnehmer.length * RENN_NENNGELD * 2 + Math.round(pool * WETT_RAKE)),
        teilnehmer: G.rennen.teilnehmer.map(t2 => ({ autoId: t2.autoId, name: t2.name, team: t2.team,
          farbe: t2.livree || t2.farbe, fahrer: t2.fahrer, ownerId: t2.ownerId, dist: Math.round(t2.dist), ausgefallen: t2.ausgefallen })),
        sponsoren: G.rennen.sponsoren.map(s => ({ name: s.name, team: G.players[s.teamId]?.name, betrag: s.betrag })),
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
    bldVal += BTYPES[t.btype].cost * 0.7;
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
      count: other.equity[p.id], pct: other.equity[p.id] * 25,
      blockPrice: blockPrice(other), value: blockPrice(other) * other.equity[p.id],
      einstand: Math.round((p.equityAvg[other.id] || 0) * other.equity[p.id]),
      marketValue: Math.round(companyValue(other)), rev10: Math.round(rev10(other)) }));
  return { cash: p.cash, inv: p.inv, xp: p.xp, lvl: p.lvl,
    quests: p.quests,
    tx: p.tx, sales: p.sales, fin: p.fin, nwHist: p.nwHist,
    ad: { reach: Math.round(p.adReach || 0), boost: +adBoost(p).toFixed(3),
          agenturen: adAgenturen(p), cap: adCap(adAgenturen(p)), pakete: AD_PACKAGES },
    ownPct: (p.equity[p.id] || 0) * 25, portfolio, revenue: Math.round(p.revenue),
    marketValue: Math.round(companyValue(p)), blockPrice: blockPrice(p), rev10: Math.round(rev10(p)),
    /* Bilanz: erst die Substanz der eigenen Firma, dann der Anteil daran, den man
     * selbst noch hält, plus die Beteiligungen an fremden Firmen. Nur so passt
     * die Summe zum Nettovermögen in der Kopfzeile. */
    balance: { cash: Math.round(p.cash), invVal: Math.round(invVal), bldVal: Math.round(bldVal),
               bondVal, debtVal,
               firmVal: Math.round(substance(p)),
               ownShare: (p.equity[p.id] || 0) / 4,
               holdings: Math.round(portfolio.reduce((sum, h) => sum + h.value, 0)),
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
const DYNAMIC_TILE_KEYS = ["locked", "owner", "btype", "lien", "shop", "paused", "level", "autos"];
/* undefined wird zu null normalisiert, damit auch "Feld gelöscht" (z. B. der
 * Abriss räumt t.shop weg) beim Empfänger sicher ankommt. */
/* Fahrzeuge gehen MIT ihren gerechneten Werten über die Leitung. Sie hier
 * zentral zu bilden ist wichtig: Snapshot und Differenz müssen byte-gleich
 * aufgebaut sein, sonst meldet der Vergleich bei jedem Tick eine Änderung —
 * oder schlimmer: das Tuning ändert die Werte und die Kachel gilt als
 * unverändert, weil die Rohdaten gleich aussehen. */
const autosDyn = t => t.autos ? t.autos.map(a => ({ ...a, werte: autoWerte(a),
  wert: Math.round(autoWert(a)), reparatur: reparaturKosten(a) })) : null;
const tileDyn = t => { const d = {}; for (const k of DYNAMIC_TILE_KEYS) d[k] = k === "autos" ? autosDyn(t) : (t[k] ?? null); return d; };
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
      .map(o => ({ firma: o.name, pct: o.equity[p.id] * 25, wert: blockPrice(o) * o.equity[p.id] }));
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
      eigenanteil: (p.equity[p.id] || 0) * 25,
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

function pushState() {
  const t0 = PERF ? process.hrtime.bigint() : 0n;
  const voll = snapshot();
  const delta = tileDelta();
  let schlank = null;
  if (delta !== null) { schlank = { ...voll, mapDelta: delta }; delete schlank.map; }
  for (const sock of io.sockets.sockets.values()) {
    /* Wer die Karte noch nie bekommen hat — frisch verbunden oder erster Push
     * überhaupt —, bekommt sie vollständig; alle anderen nur die Änderungen. */
    if (schlank && sock.data.gotMap) sock.emit("state", schlank);
    else { sock.emit("state", voll); sock.data.gotMap = true; }
  }
  for (const p of Object.values(G.players)) if (p.socketId) io.to(p.socketId).emit("me", privateState(p));
  if (PERF) { perf.pushes++; perf.snapMs += Number(process.hrtime.bigint() - t0) / 1e6; }
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
      questDefs: QUESTS, industry: p.industry, industries: INDUSTRIES, racingUnlock: RACING_UNLOCK_NW,
      tuning: TUNING, tuningMax: TUNING_MAX, raceStats: RACE_STATS, stats: STATS,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.name])),
      retailFlow: Object.fromEntries(Object.keys(GOODS).map(k => [k, +retailFlow(k).toFixed(3)])),
      dividendRate: DIVIDEND_RATE, dividendInterval: DIVIDEND_INTERVAL });
    pushState();
  });

  /* Lobby / Registrierung */
  socket.on("register", ({ name, color, winGoal, industry, bots, botLevel }, ack) => {
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
    io.emit("notice", { text: `${name} ist der Sitzung beigetreten.` + (Object.keys(G.players).length === 1 ? ` Rundenziel: ${WIN_NW.toLocaleString("de-DE")} $` : "") });
    ack?.({ ok: true, goods: GOODS, btypes: BTYPES, rooms: ROOMS, you: pid, winGoal: WIN_NW, questDefs: QUESTS, industry, industries: INDUSTRIES,
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
  socket.on("lobbySettings", ({ winGoal, bots, botLevel, mode }, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Das darf nur der Host" });
    if (G.started) return ack?.({ error: "Die Runde läuft schon" });
    if (mode === "sandbox" || mode === "plan") MODE = mode;
    if (WIN_CHOICES.includes(+winGoal)) WIN_NW = +winGoal;
    if (bots && typeof bots === "object") botAuswahl = bots;
    if (BOT_LEVELS[botLevel]) botLevelKey = botLevel;
    ack?.({ ok: true });
    pushState();
  });
  socket.on("startRound", (_payload, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Nur der Host startet die Runde" });
    if (G.started) return ack?.({ ok: true });
    G.started = true;
    /* Fahrerpool einmal je Runde würfeln — alle sehen dieselben Leute, wer
     * zuerst zugreift, hat sie. */
    if (!G.fahrer.length) G.fahrer = FAHRER_NAMEN.map((_, i) => fahrerBauen(i));
    startBots();
    if (MODE === "plan") {
      /* Eigene Spielfläche für die Planwirtschaft — Gebäude gibt es zu diesem
       * Zeitpunkt noch keine, der Tausch ist also verlustfrei. WICHTIG: Der
       * Kachel-Diff überträgt nur veränderliche Felder (owner, btype, …) —
       * nach einem Kartentausch muss deshalb jeder Client die Karte einmal
       * wieder vollständig bekommen, sonst behält er das alte Layout. */
      G.map = buildMap("plan");
      G.groupOrder = null;   // kein Stadt-Großauftrag im Plan-Modus
      lastTileSigs = null;
      for (const sock of io.sockets.sockets.values()) sock.data.gotMap = false;
      G.plan = { phase: 0, rest: 0, spieler: {}, markt: [] };
      planPhaseStarten();
      io.emit("notice", { text: `Planwirtschaft: Der Fünfjahresplan beginnt — ${PLAN_ZIEL} Planpunkte machen dich zum Helden der Arbeit.` });
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

  /* --- Karte: Bauen (schaltet gesperrte Kacheln atomar mit frei) / Abriss --- */
  socket.on("build", guard((p, { x, y, btype }, ack) => {
    const t = tileAt(x, y), bt = BTYPES[btype];
    if (!t || !bt) return ack?.({ error: "Ungültig" });
    if (t.water || t.road || t.park) return ack?.({ error: "Nicht bebaubar" });
    if (t.bank) return ack?.({ error: "Die Stadtbank gehört der Stadt" });
    if (t.news) return ack?.({ error: "Die Nachrichtenzentrale gehört der Stadt" });
    if (t.schwarz) return ack?.({ error: "Hier wird nur unter der Hand gehandelt" });
    if (t.owner) return ack?.({ error: "Kachel bereits belegt" });
    if (bt.zone !== t.zone) return ack?.({ error: `Nur in Zone ${bt.zone} baubar` });
    if (bt.industry && !(p.industries || [p.industry]).includes(bt.industry))
      return ack?.({ error: `Nur ${INDUSTRIES[bt.industry].name} kann das bauen` });
    /* Der Rennstall ist branchenfrei, aber auf einen je Firma begrenzt: Ohne
     * diese Grenze wäre "mehr Ställe" die beste Strategie, und der Wettpool
     * gehörte am Ende dem, der am meisten Kacheln hält. */
    if (bt.racing) {
      const nw = netWorth(p);
      if (nw < RACING_UNLOCK_NW)
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
    for (const [g, n] of Object.entries(mats)) p.inv[g] -= n;
    if (t.locked) { t.locked = false; gainXp(p, 30); questProg(p, "unlock"); }
    if (bt.out || bt.proc) questProg(p, "build");
    p.cash -= bt.cost + unlockCost; t.owner = p.id; t.btype = btype; t.level = 1; gainXp(p, 20);
    p.stats.gebaut++; p.stats.ausgaben += bt.cost + unlockCost;
    if (bt.retail) t.shop = Array.from({ length: bt.retail.slots }, () => null);
    logTx(p, "Bau", `${bt.name} gebaut${unlockCost ? " (inkl. Freischaltung)" : ""}`, -(bt.cost + unlockCost));
    ack?.({ ok: true });
  }));

  /* --- Gebäude mit Elektronik aufleveln: +30 % Produktion je Stufe (max. Stufe 5) --- */
  socket.on("upgradeBuilding", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    /* Der Rennstall produziert nichts, wird aber ausgebaut — jede Stufe ist
     * ein zusätzlicher Stellplatz statt +30 % Ausstoß. */
    if (!t || t.owner !== p.id || !(bt?.out || bt?.proc || bt?.racing))
      return ack?.({ error: "Kein eigenes Produktions- oder Rennstallgebäude" });
    const level = t.level || 1;
    if (level >= LEVEL_MAX) return ack?.({ error: `Bereits auf Höchststufe ${LEVEL_MAX}` });
    const cost = upgradeCost(bt, level);
    if (p.inv.elektronik < cost.elektronik) return ack?.({ error: `Zu wenig Elektronik (${cost.elektronik} nötig)` });
    if (p.cash < cost.cash) return ack?.({ error: "Zu wenig Kapital" });
    p.inv.elektronik -= cost.elektronik; p.cash -= cost.cash; t.level = level + 1; gainXp(p, 25);
    p.stats.aufgelevelt++; p.stats.ausgaben += cost.cash;
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
      km: 0, kaufpreis, tuningAusgaben: 0,
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
    logTx(p, "Motorsport", `${GOODS[a.good].name} #${a.nr}: ${T.name} auf Stufe ${stufe}`, -k.cash);
    ack?.({ ok: true, stufe, werte: autoWerte(a) });
  }));

  /* --- Fahrzeug instand setzen --- */
  socket.on("stallReparieren", guard((p, { x, y, autoId }, ack) => {
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
    logTx(p, "Motorsport", `${GOODS[a.good].name} #${a.nr} instand gesetzt (${vorher} % → 100 %)`, -k.cash);
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
    if (!a.fahrerId) return ack?.({ error: "Ohne Fahrer kein Start — erst zuweisen" });
    if (a.zustand < 25) return ack?.({ error: "Der Wagen ist zu verschlissen (unter 25 %)" });
    if (r.teilnehmer.some(x2 => x2.autoId === a.id)) return ack?.({ error: "Schon angemeldet" });
    if (r.teilnehmer.length >= 8) return ack?.({ error: "Das Startfeld ist voll (8 Wagen)" });
    if (p.cash < RENN_NENNGELD) return ack?.({ error: `Nenngeld fehlt (${RENN_NENNGELD.toLocaleString("de-DE")} $)` });
    p.cash -= RENN_NENNGELD;
    const f = G.fahrer.find(x2 => x2.id === a.fahrerId);
    /* Jede Startnummer bekommt eine eindeutige Lackierung — Teamfarben
     * kollidieren sonst (zwei blaue Teams = zwei ununterscheidbare Wagen). */
    const LIVREEN = ["#e74c3c", "#f5c542", "#2ecc71", "#3b9cf6", "#e67e22", "#b07cf7", "#1abc9c", "#eef2f7"];
    const livree = LIVREEN.find(c => !r.teilnehmer.some(x2 => x2.livree === c)) || p.color;
    r.teilnehmer.push({ autoId: a.id, fahrerId: a.fahrerId, ownerId: p.id, team: p.name, farbe: p.color, livree,
      name: `${GOODS[a.good].name} #${a.nr}`, fahrer: f?.name || "?", dist: 0, ausgefallen: false });
    logTx(p, "Motorsport", `Zum Rennen gemeldet: ${GOODS[a.good].name} #${a.nr}`, -RENN_NENNGELD);
    io.emit("notice", { text: `${p.name} meldet ${GOODS[a.good].name} #${a.nr} (Fahrer: ${f?.name || "?"}) zum Rennen.` });
    ack?.({ ok: true });
  }));
  socket.on("wetteSetzen", guard((p, { autoId, betrag }, ack) => {
    const r = G.rennen;
    if (!r || r.phase !== "anmeldung") return ack?.({ error: "Wetten nur vor dem Start" });
    betrag = Math.floor(+betrag);
    if (!(betrag >= 100) || betrag > 20000) return ack?.({ error: "Einsatz zwischen 100 und 20.000 $" });
    const teil = r.teilnehmer.find(x2 => x2.autoId === autoId);
    if (!teil) return ack?.({ error: "Dieser Wagen ist nicht gemeldet" });
    if (teil.ownerId === p.id) return ack?.({ error: "Auf den eigenen Stall wettet man nicht" });
    if (p.cash < betrag) return ack?.({ error: "Zu wenig Geld" });
    p.cash -= betrag;
    r.wetten.push({ playerId: p.id, autoId, betrag });
    logTx(p, "Motorsport", `Wette: ${betrag.toLocaleString("de-DE")} $ auf ${teil.name}`, -betrag);
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
    logTx(p, "Motorsport", `${f.name} sitzt jetzt in ${GOODS[a.good].name} #${a.nr}`, 0);
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
    t.owner = null; t.btype = null; t.shop = undefined;
    ack?.({ ok: true });
  }));

  /* --- Börse: reine Spieler-Orders --- */
  socket.on("placeOrder", guard((p, { side, good, qty, price }, ack) => {
    /* Planwirtschaft: freien Handel gibt es offiziell nicht. */
    if (MODE === "plan") return ack?.({ error: "In der Planwirtschaft gibt es keine freie Börse — nutze die Zuteilung oder den Schwarzmarkt im Planbüro." });
    qty = Math.floor(+qty); price = Math.round(+price * 100) / 100;
    if (!GOODS[good] || !["sell", "buy"].includes(side)) return ack?.({ error: "Ungültig" });
    if (!(qty > 0) || !(price > 0)) return ack?.({ error: "Menge/Preis > 0 nötig" });
    if (side === "sell" && p.inv[good] < qty) return ack?.({ error: "Nicht genug Ware im Lager" });
    if (side === "buy" && p.cash < qty * price) return ack?.({ error: "Zu wenig Kapital" });
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
    if (!(slot >= 0 && slot < bt.retail.slots)) return ack?.({ error: "Slot ungültig" });
    if (good === null) { t.shop[slot] = null; return ack?.({ ok: true }); }   // Slot leeren
    price = Math.round(+price * 100) / 100;
    if (!bt.retail.goods.includes(good)) return ack?.({ error: "Ware hier nicht verkäuflich" });
    if (!(price > 0)) return ack?.({ error: "Preis > 0 nötig" });
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
  socket.on("listShares", guard((p, { companyId, count, price, toId }, ack) => {
    companyId = companyId || p.id;   // ohne Angabe: eigene Anteile emittieren (Rückwärtskompatibilität)
    count = Math.floor(+count); price = +price; toId = toId || null;
    const company = G.players[companyId];
    if (!company) return ack?.({ error: "Firma unbekannt" });
    if (!(count >= 1 && count <= 4)) return ack?.({ error: "1–4 Anteile (je 25 %)" });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    /* Verkaufen darf jeder, der die Anteile hält — die Firma ihre eigenen (Emission)
     * genauso wie ein Aktionär seine zugekauften (Weiterverkauf). */
    if ((company.equity[p.id] || 0) < count)
      return ack?.({ error: `So viele Anteile an ${company.name} hältst du nicht` });
    if (toId && (toId === p.id || !G.players[toId])) return ack?.({ error: "Ungültiger Empfänger" });
    company.equity[p.id] -= count;   // in Verwahrung, bis gekauft oder zurückgezogen
    const listing = { id: id(), companyId, sellerId: p.id, count, price, ts: Date.now(), toId };
    G.shareListings.push(listing);
    const what = companyId === p.id ? "eigene Anteile" : `Anteile an ${company.name}`;
    if (toId) {
      emitTo(toId, "shareOffer", { ...listing, from: p.name, company: company.name });
      logTx(p, "Aktien", `${count * 25}% ${what} an ${G.players[toId].name} angeboten`, 0);
    } else {
      logTx(p, "Aktien", `${count * 25}% ${what} an der Bank angeboten`, 0);
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
    if (!(count >= 1 && count <= 4)) return ack?.({ error: "1–4 Anteile (je 25 %)" });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    if (p.cash < price) return ack?.({ error: "So viel Kapital hast du nicht" });
    if ((company.equity[companyId] || 0) < count)
      return ack?.({ error: `${company.name} hält selbst nur noch ${(company.equity[companyId] || 0) * 25} %` });
    if (G.shareBids.some(b => b.companyId === companyId && b.bidderId === p.id))
      return ack?.({ error: "Du hast dieser Firma bereits eine Anfrage geschickt" });
    const bid = { id: id(), companyId, bidderId: p.id, count, price, ttl: SHARE_BID_TTL };
    G.shareBids.push(bid);
    emitTo(companyId, "notice", { text: `${p.name} bietet ${Math.round(price)} $ für ${count * 25} % deiner Firma — an der Stadtbank entscheiden.` });
    logTx(p, "Aktien", `Kaufanfrage über ${count * 25}% an ${company.name}`, 0);
    ack?.({ ok: true });
  }));

  socket.on("acceptShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.companyId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    const bid = G.shareBids[i];
    const bidder = G.players[bid.bidderId];
    if (!bidder) { G.shareBids.splice(i, 1); return ack?.({ error: "Bieter ist nicht mehr im Spiel" }); }
    if (bidder.cash < bid.price) return ack?.({ error: `${bidder.name} hat nicht mehr genug Kapital` });
    if ((p.equity[p.id] || 0) < bid.count)
      return ack?.({ error: "Du hältst nicht mehr genug eigene Anteile" });
    bidder.cash -= bid.price;
    p.cash += bid.price;                    // Verkauf eigener Anteile = frisches Firmenkapital
    p.equity[p.id] -= bid.count;
    merkeEinstand(bidder, p, bid.count, bid.price);
    p.equity[bidder.id] = (p.equity[bidder.id] || 0) + bid.count;
    G.shareBids.splice(i, 1);
    logTx(p, "Aktien", `${bid.count * 25}% eigene Anteile an ${bidder.name} verkauft`, bid.price);
    logTx(bidder, "Aktien", `${bid.count * 25}% an ${p.name} gekauft`, -bid.price);
    bidder.stats.anteileGekauft += bid.count; p.stats.anteileVerkauft += bid.count;
    questProg(bidder, "shares");
    emitTo(bidder.id, "notice", { text: `${p.name} nimmt deine Kaufanfrage an — du hältst jetzt ${p.equity[bidder.id] * 25} % an ${p.name}.` });
    io.emit("notice", { text: `${bidder.name} übernimmt ${bid.count * 25} % von ${p.name} für ${Math.round(bid.price)} $` });
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

  socket.on("cancelShareListing", guard((p, { listingId }, ack) => {
    const i = G.shareListings.findIndex(l => l.id === listingId && (l.sellerId ?? l.companyId) === p.id);
    if (i < 0) return ack?.({ error: "Angebot nicht gefunden" });
    returnListingToSeller(G.shareListings[i]);
    G.shareListings.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("buyShares", guard((p, { listingId }, ack) => {
    const l = G.shareListings.find(l => l.id === listingId);
    if (!l) return ack?.({ error: "Angebot nicht mehr verfügbar" });
    const sellerId = l.sellerId ?? l.companyId;
    if (sellerId === p.id) return ack?.({ error: "Das ist dein eigenes Angebot" });
    if (l.toId && l.toId !== p.id) return ack?.({ error: "Dieses Angebot ist an jemand anderen gerichtet" });
    if (p.cash < l.price) return ack?.({ error: "Zu wenig Kapital" });
    const company = G.players[l.companyId];
    if (!company) { G.shareListings.splice(G.shareListings.indexOf(l), 1); return ack?.({ error: "Firma existiert nicht mehr" }); }
    const seller = G.players[sellerId];
    p.cash -= l.price;
    merkeEinstand(p, company, l.count, l.price);   // vor dem Erhöhen: braucht den alten Stand
    company.equity[p.id] = (company.equity[p.id] || 0) + l.count;
    G.shareListings.splice(G.shareListings.indexOf(l), 1);
    logTx(p, "Aktien", `${l.count * 25}% an ${company.name} gekauft`, -l.price);
    p.stats.anteileGekauft += l.count;
    questProg(p, "shares");
    if (sellerId === l.companyId) {
      /* Emission: die Firma gibt eigene Anteile aus, das Geld ist frisches
       * Firmenkapital. Es zählt NICHT als Umsatz — sonst würde eine Firma sich
       * über den Verkauf eigener Anteile selbst hochbewerten. */
      company.cash += l.price;
      logTx(company, "Aktien", `${l.count * 25}% eigene Anteile an ${p.name} ausgegeben`, l.price);
    } else if (seller) {
      /* Weiterverkauf: der Erlös geht an den Aktionär — hier entsteht der
       * Kursgewinn oder -verlust aus dem Anteilshandel. */
      seller.cash += l.price;
      logTx(seller, "Aktien", `${l.count * 25}% an ${company.name} an ${p.name} verkauft`, l.price);
      emitTo(sellerId, "notice", { text: `${p.name} hat deine ${l.count * 25}% an ${company.name} für ${Math.round(l.price)} $ gekauft.` });
    }
    io.emit("notice", { text: `${p.name} kauft ${l.count * 25}% von ${company.name} für ${Math.round(l.price)} $` });
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
    for (const sock of io.sockets.sockets.values()) sock.data.gotMap = false;
    G.players = {}; G.socketToPid = {};
    G.orders = []; G.bonds = []; G.auctions = []; G.contracts = [];
    G.shareListings = []; G.shareBids = [];
    G.lastTrade = {};
    G.chat = Object.fromEntries(ROOMS.map(r => [r, []]));
    G.tick = 0; G.winner = null; G.report = null; G.plan = null;
    G.rennen = null; G.naechstesRennenIn = RENN_INTERVALL;
    G.started = false; G.hostId = null;   // neue Runde beginnt wieder im Warteraum
    G.groupOrder = null; G.nextGroupIn = 20;
    G.nextDividendIn = DIVIDEND_INTERVAL;
    /* Preisanker zurücksetzen — sonst startet die neue Runde mit den
     * verzerrten Kursen der alten (z. B. dauerhaft gedrücktem Ölpreis). */
    for (const k of Object.keys(GOODS)) Object.assign(MM[k], { price: BASEP[k], anchor: BASEP[k], sold: 0 });
    G.priceHist = {}; G.firmHist = {}; G.news = [];
    /* Alle Clients bekommen die Karte danach wieder vollständig */
    lastTileSigs = null;
    for (const sock of io.sockets.sockets.values()) sock.data.gotMap = false;
    io.emit("roundReset", {});
    ack?.({ ok: true });
    pushState();
  });

  /* --- Kampagne buchen ---
   * Nur mit eigener Werbeagentur. Reichweite ist bei 100 gedeckelt; wer
   * nachlegt, bevor der Vorrat leer ist, hält den Aufschlag oben. */
  socket.on("bookAd", guard((p, { paket }, ack) => {
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
    if ((target.equity[p.id] || 0) < 4) return ack?.({ error: "Du brauchst 100 % der Anteile für eine Fusion" });
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
    /* Falls die aufgelöste Firma selbst Anteile an DRITTEN Firmen hielt, gehen
     * die mit auf die übernehmende Firma über — sonst blieben sie verwaist. */
    for (const other of Object.values(G.players)) {
      if (other.id === targetId || !other.equity[targetId]) continue;
      other.equity[p.id] = (other.equity[p.id] || 0) + other.equity[targetId];
      delete other.equity[targetId];
    }
    /* Zielfirma auflösen: bestehende Verbindung trennen (falls online) und entfernen */
    if (target.socketId) { const ts = io.sockets.sockets.get(target.socketId); if (ts) ts.disconnect(true); delete G.socketToPid[target.socketId]; }
    delete G.players[targetId];
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
  /* --- Renntage (nur Marktwirtschaft) --- */
  if (MODE !== "plan" && !G.winner) {
    if (!G.rennen) {
      if (--G.naechstesRennenIn <= 0) {
        G.naechstesRennenIn = RENN_INTERVALL;
        if (autosImSpiel().some(({ a }) => a.fahrerId)) rennAnkuendigen();
      }
    } else {
      const r = G.rennen;
      r.rest--;
      if (r.phase === "anmeldung" && r.rest <= 0) rennStarten();
      else if (r.phase === "laeuft") { rennTick(); if (r.rest <= 0) rennBeenden(); }
      else if (r.phase === "ergebnis" && r.rest <= 0) { G.rennen = null; G.naechstesRennenIn = RENN_INTERVALL; }
    }
  }
  /* Stromabschaltung (Planwirtschaft): Wurde das Volkswirtschaftsziel der
   * Vorphase verfehlt, läuft jede Produktion nur mit halber Kraft. */
  const SPERR = (MODE === "plan" && G.plan?.stromsperre) ? 0.5 : 1;
  /* Produktion: Enabler-Rohstoffe im Lager boosten (und werden verbraucht) */
  for (const t of G.map) {
    if (!t.btype || !t.owner) continue;
    const p = G.players[t.owner], bt = BTYPES[t.btype];
    if (!p) continue;
    if (bt.retail) {   // Shop: verkauft konfigurierte Ware zum selbstgesetzten Preis
      if (t.paused) continue;
      t.shop?.forEach((slot, i) => {
        if (!slot?.good || !(slot.price > 0)) return;
        /* Werbung hebt den Bezugspreis: derselbe Verkaufspreis wirkt dadurch
         * günstiger und bremst das Tempo weniger. */
        let q = Math.min(p.inv[slot.good], bt.retail.base * retailFlow(slot.good) * shopSpeed(slot.good, slot.price, MM[slot.good].price * adBoost(p)));
        if (slot.qty != null) q = Math.min(q, slot.qty);   // begrenzte Verkaufsmenge
        if (q <= 0) return;
        p.inv[slot.good] -= q;
        p.cash += q * slot.price; addRevenue(p, q * slot.price);
        const r = salesRec(p, slot.good); r.botQty += q; r.botRev += q * slot.price;
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
  if (MODE !== "plan" && G.tick > 60 && G.tick % NEWS_INTERVAL === 0) sendeMarktbericht();
  /* Aktien: Dividendenausschüttung alle 10 min */
  if (--G.nextDividendIn <= 0) { distributeDividends(); G.nextDividendIn = DIVIDEND_INTERVAL; }
  /* Fahrergehälter: eine laufende Verpflichtung, kein Einmalkauf. Wer nicht
   * zahlen kann, verliert den Fahrer — er geht zurück in den Pool und steht
   * den Mitbewerbern offen. Genau deshalb ist ein Spitzenfahrer eine Wette
   * auf das eigene Preisgeld und nicht einfach eine Ausgabe. */
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
  if (MODE !== "plan" && !G.winner) for (const p of Object.values(G.players)) {
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
};

/* Genau zwei Bots je Branche — der Startbildschirm lässt je Branche 0, 1 oder 2
 * davon zu. `plan` ist hier nur noch die ZWEITE Phase (nach vollständiger
 * Produktabdeckung): Shops, Werbung, welches Produkt zuerst verdoppelt wird.
 * Die beiden einer Branche unterscheiden sich weiterhin bewusst darin. */
const BOT_CFGS = [
  { name: "AgrarGenossen",   industry: "agrar",     color: "#34d399",
    plan: ["markt", "farm", "werbeagentur", "kontor"], needs: ["wasser", "strom"], rennstall: true },
  { name: "Grünhof & Söhne", industry: "agrar",     color: "#6fae4e",
    plan: ["kontor", "plantage", "werbeagentur", "markt"], needs: ["wasser", "strom"] },

  /* Zweites Stahlwerk gleich nach der Abdeckung. Über eine ganze Runde von
   * 78 Minuten gab es im Spiel nur EIN Stahlwerk, und Stahl war durchgehend
   * nicht käuflich: Angebot 0 bei Nachfrage 98, der Kurs stand zehn Minuten
   * unbewegt auf 137,25 $ — ein Preis, zu dem kein einziger Handel zustande
   * kam. Das legte gleich zwei Produktlinien still (das fertig ausgebaute
   * Benzin-Autowerk eines Spielers und die komplette Rüstungskette). Stahl ist
   * die Zutat mit der breitesten Abhängigkeit im Spiel, sie darf nicht an
   * einem einzigen Gebäude hängen. */
  { name: "Montan & Bau AG", industry: "rohstoff",  color: "#fbbf24",
    plan: ["stahlwerk", "reifenwerk", "bauhandel", "werbeagentur", "kontor"], needs: ["strom", "oel", "wasser"] },
  { name: "Felswerk",        industry: "rohstoff",  color: "#f97316",
    plan: ["stahlwerk", "kontor", "mine", "werbeagentur", "bauhandel"], needs: ["strom", "oel", "wasser"], rennstall: true },

  { name: "Stadtwerke",      industry: "versorger", color: "#38bdf8",
    plan: ["kontor", "wasserwerk", "werbeagentur", "windpark"], needs: [],
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
    plan: ["bauhandel", "rennlabor", "siliziummine", "werbeagentur", "kontor"], needs: ["strom", "stahl", "oel"] },
  { name: "Volt & Silicon",  industry: "tech",      color: "#e879f9",
    plan: ["kontor", "siliziummine", "werbeagentur", "autohaus"], needs: ["strom", "stahl"], rennstall: true },

  /* Touristik: kauft Wasser und Strom zu und verkauft Übernachtungen über ein
   * eigenes Kontor. Bewusst nur einer — die Branche ist neu und soll den Markt
   * erst einmal nicht dominieren. */
  { name: "Küstenperle",     industry: "touristik", color: "#2dd4bf",
    plan: ["campingplatz", "kontor", "strandhotel", "werbeagentur"], maxGebaeude: 4,
    needs: ["wasser", "strom"], alwaysSell: ["uebernachtung"], rennstall: true },

  /* Rüstung: baut erst die billige Munitionsfabrik, damit früh Geld reinkommt,
   * und kauft Stahl, Elektronik und Diesel für die teureren Stufen zu. */
  { name: "Stahlfaust",      industry: "ruestung",  color: "#f43f5e",
    plan: ["kontor", "munitionsfabrik", "waffenhandel", "werbeagentur"], maxGebaeude: 5, rennstall: true,
    /* Bewusst nur die Zutaten der ersten Stufen: Jede Ware in dieser Liste
     * bindet beim Einkauf bis zu 25 Stück Kapital. Mit Stahl (115 $) und
     * Elektronik (98 $) gleichzeitig war der Bot sofort klamm und kam über
     * die Munitionsfabrik nie hinaus — gemessen: Bargeld 2001 → 1136 bei
     * einem einzigen Gebäude. */
    needs: ["erze", "oel", "stahl"], alwaysSell: ["munition"] },
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
  const genommen = {};
  const liste = BOT_CFGS.filter(cfg => {
    genommen[cfg.industry] = (genommen[cfg.industry] || 0) + 1;
    return genommen[cfg.industry] <= (gewuenscht[cfg.industry] || 0);
  });
  if (!liste.length) { botsStarted = false; return; }   // ohne Bots gar nicht erst hochfahren
  const gen = ++botGen;
  console.log(`Bots: ${liste.map(c => c.name).join(", ") || "keine"} — Stufe ${lvl.name}`);
  liste.forEach((cfg, i) => setTimeout(() => { if (gen === botGen && botsStarted) spawnBot(cfg, lvl); }, 8000 + i * 5000));
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
  s.on("me", m => me = m);
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
    st = botMap ? { ...x, map: botMap } : x;
  });
  let botMeta = null;   // Registrierungsdaten (Tuning-Tabelle, Schwellen) für die Rennlogik
  s.on("connect", () => s.emit("register", { name: cfg.name, color: cfg.color, industry: cfg.industry },
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
      /* --- Motorsport: Bots bestücken ihren Stall, tunen, melden, wetten
       * und sponsern — alles nur, wenn die Kasse es hergibt. --- */
      if (st.mode !== "plan" && lvl.rennen) {
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
            await em("wetteSetzen", { autoId: tipp.autoId, betrag: 200 + Math.floor(Math.random() * 12) * 100 });
          }
          /* … und reiche Bots sponsern gelegentlich ein Team. */
          if (fremde.length && me.cash > 15000 && Math.random() < 0.15) {
            const team = fremde[Math.floor(Math.random() * fremde.length)];
            await em("sponsern", { teamId: team.ownerId, betrag: 1000 + Math.floor(Math.random() * 4) * 500 });
          }
        }
      }
      /* Shops konfigurieren: eigene Hauptware zum Ø-Kurs, unbegrenzt */
      for (const t of st.map) {
        if (t.owner !== myId || !t.shop) continue;
        const goods = (BTYPES[t.btype]?.retail?.goods || []).filter(g => me.inv[g] > 5);
        t.shop.forEach((sl, i) => {
          if (!sl && goods[0]) em("configureShop", { x: t.x, y: t.y, slot: i, good: goods[0],
            price: Math.round(st.avg[goods[0]] * 100) / 100 });
        });
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
      const meinBlock = st.players[myId]?.blockPrice || 0;
      const eigeneOffen = st.shareListings.some(l => l.sellerId === myId);
      if (me.cash < 1500 && !eigeneOffen) {
        const depot = (me.portfolio || []).filter(h => h.count > 0);
        if (depot.length) {
          /* Beteiligung abstoßen — leicht unter Marktwert, damit sie zügig weggeht */
          const h = depot.sort((a, b) => b.value - a.value)[0];
          await em("listShares", { companyId: h.id, count: 1, price: Math.max(200, Math.round(h.blockPrice * 0.95)) });
        } else if ((st.players[myId]?.ownPct ?? 0) > 50 && meinBlock > 0) {
          /* Notverkauf eigener Anteile: 10 % Abschlag auf den Marktwert, nicht mehr.
           * Untergrenze 50 %: Vorher stand hier nur "> 0", ein dauerhaft klammer
           * Bot verkaufte sich damit Block für Block bis auf null herunter.
           * Gemessen an Stahlfaust am Rundenende: Nettovermögen 0 bei 8.300 $
           * Umsatz und Bonität D — netWorth summiert ausschliesslich GEHALTENE
           * Anteile, und er hielt keinen einzigen mehr an sich selbst. Die
           * Anzeige war korrekt, die Firma hatte sich selbst aufgelöst. */
          await em("listShares", { count: 1, price: Math.max(400, Math.round(meinBlock * 0.9)) });
        }
      } else if (me.cash > 6000) {
        /* Günstige fremde Anteile aufsammeln: nur unter Marktwert zugreifen */
        const guenstig = (st.shareListings || [])
          .filter(l => l.sellerId !== myId && !l.toId && l.price <= me.cash * 0.3)
          .find(l => { const co = st.players[l.companyId]; return co && l.price < co.blockPrice * l.count * 0.95; });
        if (guenstig) await em("buyShares", { listingId: guenstig.id });
        else if (lvl.leveln && Math.random() < 0.25) {
          /* Ab "Mittel" auch von sich aus Kaufanfragen stellen — sonst bleibt der
           * Handelsplatz tot, wenn gerade niemand etwas eingestellt hat. */
          const ziel = Object.values(st.players).find(pp =>
            pp.id !== myId && pp.ownPct > 0 && pp.blockPrice > 0 &&
            pp.blockPrice < me.cash * 0.3 && !(st.shareBids || []).some(b => b.bidderId === myId && b.companyId === pp.id));
          if (ziel) await em("bidShares", { companyId: ziel.id, count: 1, price: Math.round(ziel.blockPrice * 1.05) });
        }
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
      const baueRennstall = !!cfg.rennstall && lvl.rennen && !cfg.planLoop
        && meinNW >= (botMeta?.racingUnlock ?? 200000);
      const gesamtplan = cfg.planLoop ? cfg.plan
        : [...(INDUSTRY_COVERAGE[cfg.industry] || []), ...(baueRennstall ? ["rennstall"] : []), ...cfg.plan];
      const built = st.map.filter(t => t.owner === myId && t.btype).length;
      /* planLoop: der Bot arbeitet seinen Plan nicht einmal ab, sondern beginnt
       * danach wieder von vorn — für Spezialisten wie den Ölförderer. Die
       * Obergrenze kommt aus der Schwierigkeitsstufe, ein Bot kann sie zusätzlich
       * nach unten deckeln (cfg.maxGebaeude). */
      const rennBonus = baueRennstall ? 1 : 0;
      const maxGeb = Math.min(lvl.maxGebaeude + rennBonus, (cfg.maxGebaeude ?? Infinity) + rennBonus,
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
          const frei = t => t.zone === bt.zone && !t.road && !t.water && !t.park && !t.bank && !t.news;
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
        const block = st.players[myId]?.blockPrice || 0;
        const fair = block * b.count;
        const klamm = me.cash < 1500;
        const verlangt = fair * (klamm ? 1 : 1 + 0.08 * b.count);
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
        if (me.inv[g] >= 25) continue;
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
        const preis = Math.max(0.05, Math.round(st.avg[g] * (lvl.kaufAufschlag + 0.03) * 100) / 100);
        /* Bis zur eigenen Obergrenze auffüllen statt pauschal 10 Stück. Eine
         * Chipfabrik verbrennt 36 Strom/Minute; mit 10 Stück je Zyklus (Takt
         * 26 s) kamen höchstens 23 an — sie lief also selbst bei perfekt
         * gefüllten Orders dauerhaft am Limit und stand die meiste Zeit still. */
        const wunsch = Math.max(10, Math.ceil(25 - (me.inv[g] || 0)));
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
        const bookQty = st.orders.filter(o => o.side === "sell" && o.good === g).reduce((s, o) => s + o.qty, 0);
        if (bookQty >= 15) continue;   // Spieler-Angebot hat Vorrang
        if (st.orders.some(o => o.playerId === myId && o.side === "sell" && o.good === g)) continue;
        await em("placeOrder", { side: "sell", good: g, qty: Math.min(10, Math.floor(me.inv[g] - 8)),
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
