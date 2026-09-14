// Geschichten — kleiner Server zum Hochladen und Anhören von Hörgeschichten.
// Bewusst ohne Abhängigkeiten: nur Node-Standardbibliothek, läuft mit `node server.js`.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const WURZEL = path.dirname(fileURLToPath(import.meta.url));
const DATEN = path.join(WURZEL, 'daten');
const AUDIO = path.join(DATEN, 'audio');
const INDEX = path.join(DATEN, 'geschichten.json');
const OEFFENTLICH = path.join(WURZEL, 'public');

const PORT = Number(process.env.PORT || 3100);
// Wer hochladen darf (du). Wer nur zuhört, braucht das Hörer-Passwort.
const ADMIN_PASSWORT = process.env.ADMIN_PASSWORT || 'erzaehler';
const HOER_PASSWORT = process.env.HOER_PASSWORT || 'gutenacht';
// Ohne gesetztes Geheimnis würden alle Logins nach jedem Neustart ungültig.
const GEHEIMNIS = process.env.SESSION_GEHEIMNIS || crypto.randomBytes(32).toString('hex');
const MAX_BYTES = Number(process.env.MAX_MB || 200) * 1024 * 1024;

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac',
};
const AUDIO_ENDUNGEN = new Set(['.webm', '.mp3', '.m4a', '.mp4', '.ogg', '.wav', '.aac']);

await fsp.mkdir(AUDIO, { recursive: true });

// ---------- Index (kleine JSON-Datei statt Datenbank) ----------
let geschichten = [];
try {
  geschichten = JSON.parse(await fsp.readFile(INDEX, 'utf8'));
} catch { geschichten = []; }

let schreibt = Promise.resolve();
function indexSichern() {
  // Serialisiert, damit zwei Uploads sich nicht gegenseitig überschreiben.
  schreibt = schreibt.then(async () => {
    const tmp = INDEX + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(geschichten, null, 2));
    await fsp.rename(tmp, INDEX);
  }).catch((e) => console.error('Index konnte nicht gespeichert werden:', e));
  return schreibt;
}

// ---------- Anmeldung ----------
function tokenBauen(rolle) {
  const koerper = `${rolle}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', GEHEIMNIS).update(koerper).digest('base64url');
  return `${koerper}.${sig}`;
}
function rolleLesen(req) {
  const keks = /(?:^|;\s*)sitzung=([^;]+)/.exec(req.headers.cookie || '');
  if (!keks) return null;
  const wert = decodeURIComponent(keks[1]);
  const teile = wert.split('.');
  if (teile.length !== 3) return null;
  const koerper = `${teile[0]}.${teile[1]}`;
  const erwartet = crypto.createHmac('sha256', GEHEIMNIS).update(koerper).digest('base64url');
  const a = Buffer.from(teile[2]);
  const b = Buffer.from(erwartet);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return teile[0] === 'admin' || teile[0] === 'hoerer' ? teile[0] : null;
}
function gleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// ---------- Hilfen ----------
function json(res, code, daten) {
  const koerper = JSON.stringify(daten);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(koerper);
}
function koerperLesen(req, max) {
  return new Promise((erfuellen, ablehnen) => {
    const stuecke = [];
    let laenge = 0;
    req.on('data', (s) => {
      laenge += s.length;
      if (laenge > max) { ablehnen(new Error('zu groß')); req.destroy(); return; }
      stuecke.push(s);
    });
    req.on('end', () => erfuellen(Buffer.concat(stuecke)));
    req.on('error', ablehnen);
  });
}
function saeubern(text, max = 120) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------- Statische Dateien ----------
async function statisch(res, name) {
  const datei = path.join(OEFFENTLICH, name);
  if (!datei.startsWith(OEFFENTLICH + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const inhalt = await fsp.readFile(datei);
    res.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
    res.end(inhalt);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

// ---------- Audio ausliefern (mit Range, sonst kann man nicht spulen) ----------
async function audioSenden(req, res, eintrag) {
  const datei = path.join(AUDIO, eintrag.datei);
  if (!datei.startsWith(AUDIO + path.sep)) { res.writeHead(403).end(); return; }
  let stat;
  try { stat = await fsp.stat(datei); } catch { res.writeHead(404).end('Datei fehlt'); return; }

  const typ = TYPEN[path.extname(datei)] || 'application/octet-stream';
  const bereich = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (bereich) {
    let von = bereich[1] === '' ? null : Number(bereich[1]);
    let bis = bereich[2] === '' ? null : Number(bereich[2]);
    if (von === null) { // Suffix-Range: die letzten N Bytes
      von = Math.max(0, stat.size - (bis ?? 0));
      bis = stat.size - 1;
    }
    if (bis === null || bis >= stat.size) bis = stat.size - 1;
    if (von >= stat.size || von > bis) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'content-type': typ,
      'content-length': bis - von + 1,
      'content-range': `bytes ${von}-${bis}/${stat.size}`,
      'accept-ranges': 'bytes',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(datei, { start: von, end: bis }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': typ, 'content-length': stat.size, 'accept-ranges': 'bytes' });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(datei).pipe(res);
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pfad = url.pathname;
  const rolle = rolleLesen(req);

  try {
    // Anmeldung
    if (pfad === '/api/anmelden' && req.method === 'POST') {
      const { passwort } = JSON.parse((await koerperLesen(req, 4096)).toString('utf8') || '{}');
      let neu = null;
      if (gleich(passwort, ADMIN_PASSWORT)) neu = 'admin';
      else if (gleich(passwort, HOER_PASSWORT)) neu = 'hoerer';
      if (!neu) { json(res, 401, { fehler: 'Passwort stimmt nicht.' }); return; }
      res.setHeader('set-cookie',
        `sitzung=${encodeURIComponent(tokenBauen(neu))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`);
      json(res, 200, { rolle: neu });
      return;
    }
    if (pfad === '/api/abmelden' && req.method === 'POST') {
      res.setHeader('set-cookie', 'sitzung=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      json(res, 200, { ok: true });
      return;
    }
    if (pfad === '/api/ich') { json(res, 200, { rolle }); return; }

    // Ab hier: angemeldet sein
    if (pfad.startsWith('/api/') || pfad.startsWith('/audio/')) {
      if (!rolle) { json(res, 401, { fehler: 'Bitte anmelden.' }); return; }
    }

    if (pfad === '/api/geschichten' && req.method === 'GET') {
      json(res, 200, geschichten.map(({ datei, ...rest }) => rest));
      return;
    }

    // Hochladen: roher Datei-Inhalt im Body, Metadaten in der Query.
    if (pfad === '/api/hochladen' && req.method === 'POST') {
      if (rolle !== 'admin') { json(res, 403, { fehler: 'Nur der Erzähler darf hochladen.' }); return; }
      const endung = '.' + String(url.searchParams.get('endung') || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!AUDIO_ENDUNGEN.has(endung)) { json(res, 400, { fehler: 'Dieses Audioformat kenne ich nicht.' }); return; }
      let daten;
      try { daten = await koerperLesen(req, MAX_BYTES); }
      catch { json(res, 413, { fehler: `Zu groß (max. ${Math.round(MAX_BYTES / 1024 / 1024)} MB).` }); return; }
      if (!daten.length) { json(res, 400, { fehler: 'Keine Audiodaten angekommen.' }); return; }

      const id = crypto.randomUUID();
      const dateiname = id + endung;
      await fsp.writeFile(path.join(AUDIO, dateiname), daten);
      const eintrag = {
        id,
        titel: saeubern(url.searchParams.get('titel')) || 'Ohne Titel',
        notiz: saeubern(url.searchParams.get('notiz'), 500),
        sekunden: Math.max(0, Math.round(Number(url.searchParams.get('sekunden')) || 0)),
        bytes: daten.length,
        datum: new Date().toISOString(),
        datei: dateiname,
      };
      geschichten.unshift(eintrag);
      await indexSichern();
      const { datei, ...oeffentlich } = eintrag;
      json(res, 201, oeffentlich);
      return;
    }

    if (pfad.startsWith('/api/geschichten/') && req.method === 'DELETE') {
      if (rolle !== 'admin') { json(res, 403, { fehler: 'Nur der Erzähler darf löschen.' }); return; }
      const id = pfad.slice('/api/geschichten/'.length);
      const i = geschichten.findIndex((g) => g.id === id);
      if (i === -1) { json(res, 404, { fehler: 'Gibt es nicht.' }); return; }
      const [weg] = geschichten.splice(i, 1);
      await indexSichern();
      await fsp.rm(path.join(AUDIO, weg.datei), { force: true });
      json(res, 200, { ok: true });
      return;
    }

    if (pfad.startsWith('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const eintrag = geschichten.find((g) => g.id === pfad.slice('/audio/'.length));
      if (!eintrag) { res.writeHead(404).end('Nicht gefunden'); return; }
      await audioSenden(req, res, eintrag);
      return;
    }

    if (pfad === '/' || pfad === '/index.html') { await statisch(res, 'index.html'); return; }
    if (pfad === '/aufnehmen' || pfad === '/aufnehmen.html') { await statisch(res, 'aufnehmen.html'); return; }
    if (/^\/[a-zA-Z0-9._-]+$/.test(pfad)) { await statisch(res, pfad.slice(1)); return; }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { fehler: 'Serverfehler.' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Geschichten laufen auf http://localhost:${PORT}`);
  if (!process.env.SESSION_GEHEIMNIS) {
    console.log('Hinweis: SESSION_GEHEIMNIS ist nicht gesetzt — nach jedem Neustart muss man sich neu anmelden.');
  }
});
