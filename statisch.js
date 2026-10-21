/* ============================================================
 * Auslieferung der Spieldateien — gemeinsam für server.js und gateway.js.
 *
 * Text (HTML, JS, CSS, JSON, SVG) wird einmal komprimiert und im Speicher
 * gehalten — Brotli, sonst Gzip, beides bringt Node mit. index.html, app.js
 * und app.css sind zusammen gut 700 KB; komprimiert ist es ein Bruchteil.
 *
 * Zwischenspeichern: Text bekommt "no-cache" plus ETag. Der Browser fragt bei
 * jedem Laden kurz nach und erhält "304 — unverändert" ohne Inhalt, solange
 * nichts deployt wurde; nach einem Update sofort die neue Fassung. Ein langes
 * max-age ginge hier schief: neues HTML mit altem Skript = kaputtes Spiel.
 *
 * In index.html steht "?v=__V__" hinter app.js/app.css. Das wird hier durch
 * einen Stand-Schlüssel ersetzt, damit auch Zwischenstationen (Proxys, CDN)
 * nach einem Deploy garantiert die neue Datei holen. Ohne diesen Server — etwa
 * in der Portal-Fassung — bleibt "__V__" stehen und stört nicht.
 *
 * Bilder, Ton, Video und Schriften ändern sich praktisch nie → 7 Tage.
 * ============================================================ */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

const TEXT = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8",
};
const MEDIEN = /\.(png|jpe?g|webp|gif|avif|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf)$/i;

/* Für express.static: Medien lange cachen, alles andere nachfragen lassen. */
export function cacheKoepfe(res, datei) {
  res.setHeader("Cache-Control", MEDIEN.test(datei) ? "public, max-age=604800" : "no-cache");
}

export function statisch(wurzel) {
  wurzel = path.resolve(wurzel);
  const vorrat = new Map();   // Datei → { schluessel, roh, br, gz, etag, typ }

  /* Stand-Schlüssel aus den Änderungszeiten der Skripte und Stile im Wurzelordner. */
  const stand = () => {
    let s = "";
    for (const n of fs.readdirSync(wurzel)) if (/\.(js|css)$/.test(n)) {
      try { s += n + fs.statSync(path.join(wurzel, n)).mtimeMs; } catch {}
    }
    return crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
  };

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith("/")) rel += "index.html";
    const ext = path.extname(rel).toLowerCase(), typ = TEXT[ext];
    if (!typ) return next();
    const datei = path.join(wurzel, rel);
    if (!datei.startsWith(wurzel + path.sep)) return next();   // kein Ausbruch aus public/
    let info;
    try { info = fs.statSync(datei); } catch { return next(); }
    if (!info.isFile()) return next();

    const v = ext === ".html" ? stand() : "";
    const schluessel = info.mtimeMs + "|" + v;
    let e = vorrat.get(datei);
    if (!e || e.schluessel !== schluessel) {
      let roh = fs.readFileSync(datei);
      if (v) roh = Buffer.from(roh.toString("utf8").replaceAll("__V__", v));
      e = { schluessel, roh, typ, etag: '"' + crypto.createHash("sha1").update(roh).digest("hex").slice(0, 16) + '"' };
      if (roh.length > 1024) {
        e.br = zlib.brotliCompressSync(roh, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: roh.length } });
        e.gz = zlib.gzipSync(roh, { level: 9 });
      }
      vorrat.set(datei, e);
    }

    res.setHeader("Content-Type", e.typ);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", e.etag);
    res.setHeader("Vary", "Accept-Encoding");
    if (req.headers["if-none-match"] === e.etag) { res.statusCode = 304; return res.end(); }
    const annahme = String(req.headers["accept-encoding"] || "");
    let inhalt = e.roh;
    if (e.br && /\bbr\b/.test(annahme)) { inhalt = e.br; res.setHeader("Content-Encoding", "br"); }
    else if (e.gz && /\bgzip\b/.test(annahme)) { inhalt = e.gz; res.setHeader("Content-Encoding", "gzip"); }
    res.setHeader("Content-Length", inhalt.length);
    res.end(req.method === "HEAD" ? undefined : inhalt);
  };
}
