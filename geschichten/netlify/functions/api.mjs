// Ein Endpunkt für alles: Liste, Hochladen (in Häppchen) und Ausliefern.
//
// Warum Häppchen: Netlify-Functions dürfen pro Aufruf nur rund 6 MB Daten
// entgegennehmen oder zurückgeben. Eine Geschichte ist schnell größer. Also
// legt der Browser sie stückweise ab, und beim Abspielen setzen wir aus den
// Stücken genau den Bereich zusammen, den der Player gerade anfragt.
import { getStore } from '@netlify/blobs';

const STUECK = 3 * 1024 * 1024;        // Größe eines Häppchens beim Hochladen
const MAX_ANTWORT = 4 * 1024 * 1024;   // so viel geben wir höchstens auf einmal zurück
const MAX_GESAMT = 500 * 1024 * 1024;  // Obergrenze pro Geschichte

const TYPEN = {
  webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
  mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
};

const audio = () => getStore({ name: 'geschichten-audio', consistency: 'strong' });
const index = () => getStore({ name: 'geschichten-index', consistency: 'strong' });

function json(daten, code = 200) {
  return new Response(JSON.stringify(daten), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function saeubern(text, max = 120) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Der Index ist eine einzige kleine JSON-Datei — für ein paar hundert
// Geschichten völlig ausreichend und viel einfacher als eine Datenbank.
async function listeLesen() {
  return (await index().get('liste', { type: 'json' })) || [];
}
async function listeSchreiben(liste) {
  await index().setJSON('liste', liste);
}

async function hochladen(req, url) {
  const id = url.searchParams.get('id');
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return json({ fehler: 'Ungültige Kennung.' }, 400);
  const nummer = Number(url.searchParams.get('teil'));
  if (!Number.isInteger(nummer) || nummer < 0 || nummer > 5000) {
    return json({ fehler: 'Ungültige Teilnummer.' }, 400);
  }
  const daten = new Uint8Array(await req.arrayBuffer());
  if (!daten.length) return json({ fehler: 'Leeres Häppchen.' }, 400);
  if (daten.length > STUECK + 1024) return json({ fehler: 'Häppchen zu groß.' }, 413);
  await audio().set(`${id}/${nummer}`, daten);
  return json({ ok: true });
}

async function abschliessen(req) {
  const koerper = await req.json();
  const id = koerper.id;
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return json({ fehler: 'Ungültige Kennung.' }, 400);
  const endung = String(koerper.endung || 'webm').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!TYPEN[endung]) return json({ fehler: 'Dieses Audioformat kenne ich nicht.' }, 400);
  const bytes = Number(koerper.bytes);
  const teile = Number(koerper.teile);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_GESAMT) {
    return json({ fehler: 'Ungültige Größe.' }, 400);
  }
  if (!Number.isInteger(teile) || teile < 1 || teile !== Math.ceil(bytes / STUECK)) {
    return json({ fehler: 'Die Teile passen nicht zur Größe.' }, 400);
  }

  const eintrag = {
    id,
    titel: saeubern(koerper.titel) || 'Ohne Titel',
    notiz: saeubern(koerper.notiz, 500),
    sekunden: Math.max(0, Math.round(Number(koerper.sekunden) || 0)),
    bytes, teile, endung, stueck: STUECK,
    datum: new Date().toISOString(),
  };
  const liste = await listeLesen();
  // Erst jetzt taucht die Geschichte auf: halb hochgeladene sieht niemand.
  await listeSchreiben([eintrag, ...liste.filter((g) => g.id !== id)]);
  return json(eintrag, 201);
}

async function loeschen(id) {
  const liste = await listeLesen();
  const eintrag = liste.find((g) => g.id === id);
  if (!eintrag) return json({ fehler: 'Gibt es nicht.' }, 404);
  await listeSchreiben(liste.filter((g) => g.id !== id));
  const speicher = audio();
  for (let i = 0; i < eintrag.teile; i++) {
    await speicher.delete(`${eintrag.id}/${i}`).catch(() => {});
  }
  return json({ ok: true });
}

// Liefert einen Byte-Bereich aus den Häppchen. Der Player fragt beim Spulen
// genau so an; ohne das ließe sich nicht springen.
async function ausliefern(req, id) {
  const eintrag = (await listeLesen()).find((g) => g.id === id);
  if (!eintrag) return new Response('Nicht gefunden', { status: 404 });

  const groesse = eintrag.bytes;
  const typ = TYPEN[eintrag.endung] || 'application/octet-stream';
  const bereich = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');

  let von = 0;
  let bis = groesse - 1;
  let teilantwort = false;

  if (bereich) {
    teilantwort = true;
    if (bereich[1] === '') {
      const letzte = Number(bereich[2] || 0);
      von = Math.max(0, groesse - letzte);
    } else {
      von = Number(bereich[1]);
      if (bereich[2] !== '') bis = Math.min(bis, Number(bereich[2]));
    }
    if (von >= groesse || von > bis) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${groesse}` } });
    }
  }

  // Wir kürzen den Bereich notfalls. Ein 206 darf weniger liefern als gefragt —
  // der Player holt sich den Rest einfach mit der nächsten Anfrage.
  if (bis - von + 1 > MAX_ANTWORT) {
    bis = von + MAX_ANTWORT - 1;
    teilantwort = true;
  }

  const kopf = {
    'content-type': typ,
    'content-length': String(bis - von + 1),
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
  };
  if (teilantwort) kopf['content-range'] = `bytes ${von}-${bis}/${groesse}`;
  if (req.method === 'HEAD') {
    return new Response(null, { status: teilantwort ? 206 : 200, headers: kopf });
  }

  const speicher = audio();
  const stueck = eintrag.stueck || STUECK;
  const ergebnis = new Uint8Array(bis - von + 1);
  let geschrieben = 0;
  for (let n = Math.floor(von / stueck); n <= Math.floor(bis / stueck); n++) {
    const roh = await speicher.get(`${eintrag.id}/${n}`, { type: 'arrayBuffer' });
    if (!roh) return new Response('Häppchen fehlt', { status: 500 });
    const daten = new Uint8Array(roh);
    const anfang = n * stueck;
    const abSchnitt = Math.max(0, von - anfang);
    const bisSchnitt = Math.min(daten.length, bis - anfang + 1);
    if (bisSchnitt <= abSchnitt) continue;
    ergebnis.set(daten.subarray(abSchnitt, bisSchnitt), geschrieben);
    geschrieben += bisSchnitt - abSchnitt;
  }
  return new Response(ergebnis.subarray(0, geschrieben), {
    status: teilantwort ? 206 : 200,
    headers: kopf,
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const pfad = url.pathname;
  try {
    if (pfad === '/api/geschichten' && req.method === 'GET') return json(await listeLesen());
    if (pfad === '/api/hochladen' && req.method === 'PUT') return await hochladen(req, url);
    if (pfad === '/api/abschliessen' && req.method === 'POST') return await abschliessen(req);
    if (pfad.startsWith('/api/geschichten/') && req.method === 'DELETE') {
      return await loeschen(pfad.slice('/api/geschichten/'.length));
    }
    if (pfad.startsWith('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
      return await ausliefern(req, pfad.slice('/audio/'.length));
    }
    return json({ fehler: 'Unbekannter Aufruf.' }, 404);
  } catch (e) {
    console.error(e);
    return json({ fehler: 'Serverfehler.' }, 500);
  }
}

export const config = {
  path: ['/api/geschichten', '/api/geschichten/:id', '/api/hochladen', '/api/abschliessen', '/audio/:id'],
};
