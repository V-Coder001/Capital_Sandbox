"use strict";
/* ================================================================
 * Client-Store & Socket-Layer
 * Muster: Server sendet "state" (öffentlich) + "me" (privat).
 * Der Store ist ein simples Observable — 1:1 austauschbar gegen
 * Zustand/Redux: subscribe() ≙ useStore, set() ≙ dispatch.
 * ================================================================ */
const store = (() => {
  const s = { state: null, me: null, meta: null, myId: null, room: "[DE] Handel", chat: {} };
  const subs = new Set();
  let flushPending = false;
  /* Mehrere set()-Aufrufe im selben Frame (z. B. Bursts über die WebRTC-Bridge)
   * werden zu einem einzigen render()-Aufruf zusammengefasst — sonst flackert
   * die UI, weil DOM-Panels mehrfach pro Frame neu aufgebaut werden. */
  function flush() { flushPending = false; subs.forEach(fn => fn(s)); }
  return {
    get: () => s,
    set(patch) { Object.assign(s, patch); if (!flushPending) { flushPending = true; requestAnimationFrame(flush); } },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();

/* Kursverlauf je Ware und Wertverlauf je Firma, vom Server alle 10 s im
 * Ereignis "kurse" geliefert. 60 Punkte = 10 Minuten Rückblick. */
let priceHist = {}, firmHist = {};

/* Dividende je Aktie und Ausschüttung. Die Firma legt ihre Ausschüttung
 * selbst fest: automatisch DIVIDEND_RATE des Umsatzes oder ein fester Betrag.
 * Die Sätze kommen aus der Anmeldung mit, statt hier fest eingetippt zu sein. */
const AKTIEN_JE_FIRMA = () => store.get().state?.marktCfg?.aktien || 100;
function aktienDividende(p) {
  const satz = store.get().meta?.dividendRate;
  if (p.ausschuettung != null) return p.ausschuettung / AKTIEN_JE_FIRMA();
  return satz == null ? null : (p.rev10 || 0) * satz / AKTIEN_JE_FIRMA();
}
/* Rendite je Ausschüttungsintervall, gemessen am Kurs */
function aktienRendite(p) {
  const d = aktienDividende(p), kurs = p.kurs || 0;
  return d == null || kurs <= 0 ? null : d / kurs * 100;
}
/* Kurs mit Cent, ab 100 $ ohne */
const fk = v => v >= 100 ? fmt(v) : "$" + (Math.round((v || 0) * 100) / 100).toLocaleString(SPRACHE === "en" ? "en-US" : "de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* Lücke zwischen Fundament und Kurs als farbiger Hinweis */
const lueckeHtml = g => g == null ? "" : `<span style="color:${g > 0.1 ? "var(--up)" : g < -0.1 ? "var(--down)" : "var(--dim)"}">${g > 0 ? "unter" : "über"} Wert ${Math.abs(Math.round(g * 100))} %</span>`;
/* Einordnung der Rendite. Die Schwellen orientieren sich am Ausschüttungstakt
 * von 10 Minuten: 8 % je 10 min holt den Kaufpreis in gut zwei Stunden
 * Spielzeit wieder herein, 1 % praktisch nie. */
function renditeUrteil(r) {
  if (r == null) return null;
  if (r >= 8) return { text: "stark",   farbe: "var(--up)" };
  if (r >= 4) return { text: "solide",  farbe: "var(--up)" };
  if (r >= 1) return { text: "schwach", farbe: "var(--dim)" };
  return { text: "kaum Ertrag", farbe: "var(--down)" };
}

/* Prozentuale Veränderung über den gesamten vorliegenden Verlauf. */
function kursTrend(g) {
  const h = priceHist[g];
  if (!h || h.length < 2 || !h[0]) return null;
  return (h[h.length - 1] / h[0] - 1) * 100;
}
/* Angebot gegen Nachfrage je Ware. In einer vollen Runde standen 500 Stueck
 * Silizium ohne einen einzigen Interessenten im Buch, waehrend Stahl bei
 * Nachfrage 98 gar nicht lieferbar war — beides sah man nur, wenn man das
 * Orderbuch Zeile fuer Zeile durchging. Die Zahlen liegen ohnehin vor. */
function saettigung(g, state) {
  let angebot = 0, nachfrage = 0;
  for (const o of state.orders) {
    if (o.good !== g) continue;
    if (o.side === "sell") angebot += o.qty; else nachfrage += o.qty;
  }
  if (!angebot && !nachfrage) return "";
  /* Nur faerben, wenn eine Seite die andere klar dominiert — sonst ist es
   * Rauschen und lenkt vom Kurs ab. */
  const farbe = angebot > nachfrage * 3 ? "var(--down)"
              : nachfrage > angebot * 3 ? "var(--up)" : "var(--dim)";
  return `<span style="color:${farbe};font-size:11px" title="Angebot ${angebot} · Nachfrage ${nachfrage}">${angebot}/${nachfrage}</span>`;
}
/* Prozentwert als farbiges Kuerzel. Unter 0,5 % wird nichts angezeigt —
 * das Rauschen der Kursdrift soll nicht als Trend erscheinen. */
function trendLabel(g) {
  const t = kursTrend(g);
  if (t == null || Math.abs(t) < 0.5) return "";
  const farbe = t > 0 ? "var(--up)" : "var(--down)";
  return `<span style="color:${farbe};font-size:11px">${t > 0 ? "+" : ""}${t.toFixed(0)} %</span>`;
}
/* Sparkline als Inline-SVG. Bewusst ohne Achsen: Die Linie soll die FORM des
 * Verlaufs zeigen (steigt, fällt, springt), der genaue Wert steht daneben
 * ohnehin als Ø-Preis. Skaliert auf das eigene Min/Max, damit auch kleine
 * Ausschläge sichtbar bleiben — bei Waren um 1 $ wäre eine Nulllinien-Skala
 * eine gerade Linie. */
function sparklineVon(h, breite = 62, hoehe = 18) {
  if (!h || h.length < 2) return `<span style="display:inline-block;width:${breite}px"></span>`;
  const min = Math.min(...h), max = Math.max(...h), spanne = (max - min) || 1;
  const pts = h.map((v, i) =>
    `${(1 + i / (h.length - 1) * (breite - 2)).toFixed(1)},${(hoehe - 1 - (v - min) / spanne * (hoehe - 2)).toFixed(1)}`).join(" ");
  const trend = h[0] ? (h[h.length - 1] / h[0] - 1) * 100 : null;
  const farbe = trend == null || Math.abs(trend) < 0.5 ? "var(--dim)" : trend > 0 ? "var(--up)" : "var(--down)";
  return `<svg width="${breite}" height="${hoehe}" viewBox="0 0 ${breite} ${hoehe}" style="vertical-align:middle;overflow:visible">
    <polyline points="${pts}" fill="none" stroke="${farbe}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const sparkline = (g, breite = 62, hoehe = 18) => sparklineVon(priceHist[g], breite, hoehe);
/* Welche Firmen in der Kurstafel gerade aufgeklappt sind. Muss ausserhalb des
 * Renderns leben: die Tafel wird jede Sekunde neu gebaut, ein Zustand im DOM
 * waere danach jedes Mal weg. */
const firmenAuf = new Set();

/* Firmenlogos der Bots. Menschliche Mitspieler haben keins — überall, wo ein
 * Logo stehen kann, muss der farbige Namenszug weiterhin greifen.
 * Bewusst NUR dort eingesetzt, wo genug Breite ist: In der Kopfleiste sitzen
 * bis zu acht Spielerchips à 26 px nebeneinander, und auf dieser Größe ist von
 * einer Wortmarke nichts mehr zu erkennen — dort bleibt der Buchstabe. */
const LOGOS = {
  "AgrarGenossen": "agrargenossen", "Grünhof & Söhne": "gruenhof",
  "Montan & Bau AG": "montan",      "Felswerk": "felswerk",
  "Stadtwerke": "stadtwerke",       "Nordsee Öl": "nordseeoel",
  "ChipWerke": "chipwerke",         "Volt & Silicon": "voltsilicon",
  "Küstenperle": "kuestenperle",    "Stahlfaust": "stahlfaust",
};
const logoUrl = name => LOGOS[name] ? `assets/logos/${LOGOS[name]}.png` : null;
/* Logo mit Namen darunter — fällt ohne Logo auf den reinen Namenszug zurück. */
function firmenMarke(name, farbe, hoehe = 30) {
  const u = logoUrl(name);
  return u ? `<img class="firmlogo" src="${u}" alt="${name}" title="${name}" style="height:${hoehe}px">`
           : `<b style="color:${farbe}">${name}</b>`;
}
/* Grosser Verlaufs-Chart. Nimmt bewusst eine nackte Zahlenreihe entgegen statt
 * eines Warenschluessels — dieselbe Darstellung traegt den Kursverlauf einer
 * Ware an der Boerse UND den Wertverlauf einer Firma in der Kurstafel. Mit
 * Hoch/Tief-Linien, damit man Ausschlaege einordnen kann statt nur die
 * Richtung zu sehen. */
function verlaufChart(h, titel, geldFormat = fp, breite = 300, hoehe = 90) {
  if (!h || h.length < 2) return `<div class="meta" style="padding:10px 0">${titel} wird gesammelt — der erste Punkt kommt nach 10 Sekunden.</div>`;
  const min = Math.min(...h), max = Math.max(...h), spanne = (max - min) || 1;
  const X = i => (2 + i / (h.length - 1) * (breite - 4));
  const Y = v => (hoehe - 12 - (v - min) / spanne * (hoehe - 24));
  const pts = h.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const trend = h[0] ? (h[h.length - 1] / h[0] - 1) * 100 : null;
  const farbe = trend == null || Math.abs(trend) < 0.5 ? "var(--dim)" : trend > 0 ? "var(--up)" : "var(--down)";
  const minuten = Math.max(1, Math.round(h.length * 10 / 60));
  return `<div class="vChart" style="background:rgba(12,18,28,.5);border:1px solid rgba(36,48,68,.7);border-radius:8px;padding:8px 10px;margin:6px 0">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
      <span class="meta">${titel} · letzte ${minuten} min</span>
      <span style="font-family:var(--mono);font-size:12px;color:${farbe}">${trend == null ? "" : (trend > 0 ? "+" : "") + trend.toFixed(1) + " %"}</span>
    </div>
    <svg width="100%" height="${hoehe}" viewBox="0 0 ${breite} ${hoehe}" preserveAspectRatio="none">
      <line x1="2" y1="${Y(max).toFixed(1)}" x2="${breite - 2}" y2="${Y(max).toFixed(1)}" stroke="rgba(134,149,171,.25)" stroke-dasharray="3 3"/>
      <line x1="2" y1="${Y(min).toFixed(1)}" x2="${breite - 2}" y2="${Y(min).toFixed(1)}" stroke="rgba(134,149,171,.25)" stroke-dasharray="3 3"/>
      <polyline points="${pts}" fill="none" stroke="${farbe}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--dim)">
      <span>Tief ${geldFormat(min)}</span><span>Hoch ${geldFormat(max)}</span></div>
  </div>`;
}
const kursChart = g => verlaufChart(priceHist[g], "Kursverlauf");

const fmt = n => "$" + Math.round(n).toLocaleString("de-DE");
const fp = n => n < 10 ? "$" + (+n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt(n);   // Preise: Cents bei billigen Waren
const TOAST_MAX = 4;   // mehr passen ohne Überdecken der Karte nicht übereinander
/* Firmennamen kommen vom Server maskiert an (&amp; …). Als textContent ist das
 * ohnehin sicher — also zurückverwandeln, sonst stand „Montan &amp; Bau“ da. */
const TOAST_ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const toast = (msg, err) => { const d = document.createElement("div");
  d.className = "toast" + (err ? " err" : ""); d.textContent = String(msg ?? "").replace(/&(?:amp|lt|gt|quot|#39);/g, e => TOAST_ENT[e]);
  const box = document.getElementById("toasts");
  box.append(d);
  /* Gedeckelt, weil jede Meldung 4 s stehen bleibt: Treffen mehrere Ereignisse
   * zusammen (Quest, Dividende, Großauftrag), wuchs der Stapel sonst über den
   * halben Bildschirm. Die ältesten weichen den neuen. */
  while (box.children.length > TOAST_MAX) box.firstElementChild.remove();
  setTimeout(() => d.remove(), 4000); };
/* Jede Aktion läuft über ack — Server-Fehler landen als Toast beim Spieler.
 * Der passende Klang kommt erst mit der Bestätigung: eine abgelehnte Order
 * soll nicht nach gelungenem Geschäft klingen. */
const act = (ev, payload) => socket.emit(ev, payload, res => {
  if (res?.error) { toast(res.error, true); return; }
  const klang = SFX_AKTION[ev];
  if (klang) SFX.spiel(klang);
});

/* ---- Transport ----
 * Normalfall: socket.io direkt zum eigenen lokalen Server (LAN/localhost).
 * "Mit Code beitreten": derselbe socket.io-Vertrag (emit/on mit Ack), aber über
 * eine WebRTC-Datenverbindung (PeerJS) zum Server-Tab des Hosts getunnelt — der
 * Host bleibt Single Source of Truth, es gibt keine zweite Simulation. */
/* ---------- Adresse des Spielservers ----------
 * LEER = gleiche Herkunft, wie bisher. Genau das ist der lokale Betrieb
 * (./start.sh): Der Browser laedt die Seite vom Server und redet mit
 * demselben Server zurueck.
 *
 * GESETZT = feste Adresse. Das braucht jede Fassung, die NICHT vom Spielserver
 * selbst ausgeliefert wird — auf einem Spieleportal liegen die Dateien auf
 * deren CDN, die eigene Herkunft waere also das Portal und nicht der Server.
 *
 * Bewusst eine einzige Stelle fuer Socket UND die /api-Aufrufe: Waere die
 * Adresse an neun Stellen verteilt, wuerde beim naechsten Hosterwechsel genau
 * eine davon vergessen — und die faellt erst im Betrieb auf. */
const SERVER = "";
/* Alle Serverpfade laufen hierueber. Bei leerem SERVER kommt exakt der
 * bisherige relative Pfad heraus. */
const api = pfad => SERVER + pfad;
let socket = io(SERVER || undefined);
/* Lokaler Kachel-Cache: die Karte hat pro Kachel viele Felder, die sich nach der
 * Generierung NIE mehr ändern (x, y, zone, road, water, park, field, sand, deep,
 * rock, unlockCost) — nur wenige tun es (locked, owner, btype, lien, shop, paused).
 * Über die WebRTC-Bridge (s. startHosting) kommt die volle Karte genau einmal;
 * danach nur noch `mapDelta` — eine Liste der Kacheln, an denen sich seit dem
 * letzten Update wirklich etwas geändert hat (meist keine einzige, oder genau
 * die eine, auf die gerade jemand gebaut hat). Die werden direkt im Cache
 * überschrieben; alle anderen Kachel-Objekte bleiben unangetastet, es wird also
 * pro Update weder die Karte neu übertragen noch clientseitig neu aufgebaut.
 * Für die normale socket.io-Verbindung ist state.map immer vollständig, der
 * Cache wird dann einfach nur aufgefrischt (kein Verhaltensunterschied). */
let cachedFullMap = null;
let letzterStand = null;
function mergeState(state) {
  /* Teil-Stand: nur die geänderten Felder — über den letzten vollen legen. */
  if (state.teil) {
    if (!letzterStand) return letzterStand;   // ohne Grundlage nicht anwendbar (kommt nicht vor: erster Push ist voll)
    const { teil, ...rest } = state;
    state = { ...letzterStand, ...rest };
  }
  letzterStand = state;
  if (state.mapDelta) {                 // Online-Bridge: nur die geänderten Kacheln
    if (!cachedFullMap) return state;   // sollte nicht vorkommen (erster Snapshot ist immer voll)
    for (const d of state.mapDelta) {
      const t = cachedFullMap[d.i];
      if (!t) continue;
      for (const k in d) if (k !== "i") t[k] = d[k];
    }
    const { mapDelta, ...ohne } = state;
    return letzterStand = { ...ohne, map: cachedFullMap };
  }
  if (!state.map?.length) return state;
  cachedFullMap = state.map;
  return state;
}
/* Persistente Spieler-ID. socket.io verbindet sich nach einem Aussetzer (WLAN,
 * Laptop-Schlaf, gedrosselter Hintergrund-Tab) automatisch neu — aber mit einer
 * NEUEN Socket-ID, unter der der Server niemanden mehr kennt. Ohne erneutes
 * "rejoin" wird man dabei zum Geist: man sieht das Spiel weiter, jede Aktion
 * scheitert aber mit "Nicht registriert". Darum hier merken und bei jedem
 * Wiederverbinden automatisch erneut anmelden. */
let myToken = null;
function reidentify(s) {
  if (!myToken) return;   // noch nie registriert — nichts wiederherzustellen
  s.emit("rejoin", { token: myToken }, res => {
    if (res?.error) { toast("Sitzung abgelaufen — bitte Seite neu laden.", true); return; }
    /* Der Ack liefert die vollständigen Spieldaten mit. Die zu verwerfen war ein
     * Fehler: wurde der Server zwischenzeitlich um Waren oder Gebäude erweitert,
     * blieb der Client auf dem Stand des Seitenaufrufs stehen und zeigte für
     * alles Neue "undefined" an. */
    enterGame(res);
    toast("Verbindung wiederhergestellt.");
  });
}
/* Wächter gegen einen stillen Ausfall: Der Server schickt "me" (Bargeld, Lager)
 * mindestens einmal pro Sekunde. Bleibt es trotz stehender Verbindung lange aus,
 * kennt der Server unsere aktuelle Verbindung nicht mehr — dann stünden Bargeld
 * und Lager wortlos eingefroren da. Ein erneutes rejoin richtet das sofort. */
let letztesMe = 0;
setInterval(() => {
  if (!myToken || !socket?.connected) return;
  if (!store.get().meta) return;                  // noch nicht im Spiel
  if (Date.now() - letztesMe < 15000) return;
  letztesMe = Date.now();                         // nicht im Sekundentakt erneut versuchen
  socket.emit("rejoin", { token: myToken }, () => {});
}, 5000);
/* ---- Ambient-Sounds (echte Aufnahmen aus assets/ambient/) ----
 * Drei leise Dauerschleifen, deren Lautstärke der Kameraposition folgt:
 * Brandung + Möwen, wenn Wasser im Bild ist, Marktgemurmel nahe der Piazza
 * (nur Kartellmodus, nur tagsüber). Sanfte Rampen statt harter Sprünge;
 * der Stummschalter der Musik gilt auch hier. Start erst nach der ersten
 * Nutzer-Geste (Autoplay-Regel) — und nur, wenn eine Runde läuft. */
const AMBIENTE = (() => {
  const mk = (datei, maxVol) => {
    const a = new Audio(`assets/ambient/${datei}`);
    a.loop = true; a.volume = 0; a.preload = "auto";
    return { a, maxVol, ziel: 0, laeuft: false };
  };
  const quellen = {
    brandung: mk("brandung.mp3", .30),
    moewen:   mk("moewen.mp3",   .22),
    markt:    mk("markt.mp3",    .28),
  };
  let bereit = false;
  addEventListener("pointerdown", () => { bereit = true; }, { once: true });
  setInterval(() => {
    const st = store.get().state;
    const stumm = !bereit || !st?.map || !st.started || document.hidden ||
      (typeof MUSIC !== "undefined" && MUSIC.istStumm());
    if (!stumm) {
      /* Sichtbaren Wasser-Anteil zählen (eine Schleife pro Halbsekunde) */
      let sichtbar = 0, wasser = 0;
      for (const t of st.map) {
        const sx = innerWidth / 2 + cam.x + (t.x - t.y) * (TW / 2) * cam.z;
        const sy = 120 + cam.y + (t.x + t.y) * (TH / 2) * cam.z;
        if (sx < -40 || sx > innerWidth + 40 || sy < -40 || sy > innerHeight + 40) continue;
        sichtbar++;
        if (t.water) wasser++;
      }
      const wAnteil = sichtbar ? wasser / sichtbar : 0;
      quellen.brandung.ziel = Math.min(1, wAnteil * 4);
      quellen.moewen.ziel = wAnteil > .03 ? Math.min(1, .3 + wAnteil * 2.5) : 0;
      /* Markt: Nähe zur Piazza (13,12), nur Kartell, nachts schläft der Markt */
      let markt = 0;
      if (st.mode === "kartell" && LICHT > .35) {
        const px2 = innerWidth / 2 + cam.x + (13 - 12) * (TW / 2) * cam.z;
        const py2 = 120 + cam.y + (13 + 12) * (TH / 2) * cam.z;
        const dist = Math.hypot(px2 - innerWidth / 2, py2 - innerHeight / 2);
        markt = Math.max(0, 1 - dist / (innerHeight * .7));
      }
      quellen.markt.ziel = markt;
    }
    for (const q of Object.values(quellen)) {
      const zielVol = stumm ? 0 : q.ziel * q.maxVol;
      /* weiche Rampe: je Tick ein Drittel des Weges */
      q.a.volume += (zielVol - q.a.volume) / 3;
      if (q.a.volume < .004) {
        q.a.volume = 0;
        if (q.laeuft) { q.a.pause(); q.laeuft = false; }
      } else if (!q.laeuft) {
        q.laeuft = true;
        q.a.play().catch(() => { q.laeuft = false; });
      }
    }
  }, 500);
  return { quellen };
})();

/* ---- Casino Municipale: das Spielhaus an der Piazza ----
 * Ein Modal statt Panel: Man steht ja „vor dem Gebäude". Fünf Spiele für
 * Gäste; wer die Piazza hält, sieht stattdessen die Betreiber-Werkzeuge
 * (Quoten, Ausbau, Schwarzverkauf). Aktualisiert sich mit jedem State-Push,
 * solange es offen ist — außer man tippt gerade den Einsatz ein. */
let gcasinoOffen = false;
function gcasinoOeffnen() { gcasinoOffen = true; gcasinoRender(); }
function gcasinoSchliessen() { gcasinoOffen = false; document.getElementById("gcasinoModal").style.display = "none"; }
function gcasinoRender() {
  const el = document.getElementById("gcasinoModal");
  if (!gcasinoOffen) return;
  const st = store.get().state, me = store.get().me, myId = store.get().myId;
  const gc = st?.gcasino;
  if (!gc) { gcasinoSchliessen(); return; }
  if (el.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName)) return;
  const meineFam = st.players?.[myId]?.familie;
  const herr = gc.herrscher ? st.familien?.find(f => f.id === gc.herrscher) : null;
  const binHerr = meineFam && meineFam === gc.herrscher;
  const sterne = "★".repeat(gc.stufe) + "☆".repeat(5 - gc.stufe);
  const quoteName = gc.quote === "fair" ? "fair" : gc.quote === "gierig" ? "gierig" : "großzügig";
  const umsatz = (gc.quote === "gierig" ? 170 : gc.quote === "fair" ? 100 : 50) * gc.stufe;
  const illegale = Object.entries(GOODS()).filter(([, g]) => g.cat === "Illegal").map(([g2]) => g2);
  el.style.display = "grid";
  el.querySelector(".gcInhalt").innerHTML = `
    <div class="gcKopf">
      <div class="orna">✦ ✦ ✦</div>
      <h3>„${gc.stil}“</h3>
      <div class="gcSterne">${sterne}</div>
      <div class="gcStats">
        <div class="gcStat"><b style="color:${herr ? herr.farbe : "var(--dim)"}">${herr ? herr.name : "geschlossen"}</b><span>führt das Haus</span></div>
        <div class="gcStat"><b>${quoteName}</b><span>Quoten</span></div>
        <div class="gcStat"><b style="color:#e8c268">${herr ? fmt(umsatz) : "—"}</b><span>Bürger-Umsatz / 30 s</span></div>
      </div>
      <div class="gcAusbau"><span>AUSBAU</span>
        <div class="balken"><i style="width:${gc.stufe * 20}%"></i></div>
        <b style="color:#e8c268;font-size:11px">${gc.stufe}/5</b></div>
    </div>
    ${!herr ? `<div class="gcZu"><div class="tuer">🚪</div>
      <div style="color:#e8c268;font-weight:800;letter-spacing:2px;font-size:12px;margin:6px 0 4px">CHIUSO</div>
      <p class="note" style="margin:0">Niemand hält die Piazza Grande. Wer sie kontrolliert, führt dieses Haus:
      Bürger-Umsatz jede halbe Minute, Quoten, Ausbau — und Schwarzverkauf am Hehler und am Paten vorbei.</p></div>` : `
    <div class="gcTrenn">Spieltische</div>
    <p class="note" style="margin:2px 0 0;text-align:center">Gewinne zahlt <b style="color:${herr.farbe}">${herr.name}</b>${binHerr ? " — ihr spielt am eigenen Tisch, die Kasse bleibt in der Familie" : ""}.</p>
      ${[
        { k: "roulette", icon: "🎡", name: "Roulette", live: true,
          info: "Alle setzen zusammen, ein Rad entscheidet · Rot/Schwarz ×2 · Volle Zahl ×36" },
        { k: "blackjack", icon: "🃏", name: "Blackjack", live: true,
          info: "4 Plätze · näher an 21 als der Dealer · ×2, Blackjack ×2.5 · Verdoppeln & Splitten" },
        { k: "poker", icon: "🂡", name: "Poker", live: true,
          info: "2–4 Spieler gegeneinander · Hold’em light · das Haus nimmt 5 % vom Pot" },
        { k: "wuerfel", icon: "🎲", name: "Hohe Neun",
          info: `Zwei Würfel, ab 9 gewinnt · ${(gc.spiele.wuerfel.chance * 100).toFixed(1)} % Chance · zahlt ×${gc.spiele.wuerfel.faktor}` },
        { k: "slots", icon: "🎰", name: "Slots „La Fortuna“",
          info: `Drei Walzen, drei Gleiche · ${(gc.spiele.slots.chance * 100).toFixed(1)} % Chance · zahlt ×${gc.spiele.slots.faktor}` },
        { k: "baccara", icon: "🎴", name: "Baccara",
          info: `Deine Hand gegen die Bank · ${(gc.spiele.baccara.chance * 100).toFixed(1)} % Chance · zahlt ×${gc.spiele.baccara.faktor}` },
      ].map(r => `
        <div class="gcReihe">
          <div class="gcIkone">${r.icon}</div>
          <span style="flex:1;min-width:0"><b>${r.name}</b>${r.live ? `<span class="gcLive"><i></i>LIVE</span>` : ""}
            <span class="meta" style="display:block;font-family:var(--mono);margin-top:1px">${r.info}</span></span>
          <button class="bknopf gcGold" data-gcfenster="${r.k}" style="flex:none">Spielen</button>
        </div>`).join("")}
    ${binHerr ? `
    <div class="gcTrenn">Ihr führt das Haus</div>
      <div class="lbl" style="margin-top:7px">Quoten <span class="meta" style="text-transform:none;letter-spacing:0">— gierig: +Umsatz, +Fahndung · großzügig: +Respekt</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:5px 0 9px">
        ${["fair", "gierig", "grosszuegig"].map(q => `<button class="mini ${gc.quote === q ? "gcGold" : ""}" data-gcquote="${q}">${q === "grosszuegig" ? "großzügig" : q}</button>`).join("")}
      </div>
      ${gc.upgradeKosten
        ? `<button class="bknopf gcGold" data-gcupgrade style="width:100%">✨ Ausbau: „${["Spelunke","Salon Rosso","Belle Époque","Art déco","La Dorata"][gc.stufe]}“ — ${fmt(gc.upgradeKosten)}</button>
           <p class="note" style="margin:5px 0 0">Der Ausbau bleibt dem Haus — auch wenn die Piazza den Herrn wechselt.</p>`
        : `<p class="note" style="margin:0;text-align:center;color:#e8c268">„La Dorata“ — prunkvoller geht es nicht. ✦</p>`}
      <div class="lbl" style="margin-top:10px">Unterm Tisch ans Volk <span class="meta" style="text-transform:none;letter-spacing:0">— 130 % Hehlerpreis, keine Paten-Abgabe, +2 Fahndung</span></div>
      ${illegale.filter(g => Math.floor(me.inv?.[g] || 0) > 0).map(g =>
        `<div class="gcReihe" style="padding:6px 9px">
          <span style="flex:1">${gname(g)} <span class="meta">· ${Math.floor(me.inv[g])} Stück</span></span>
          <button class="bknopf verkauf" data-gcverkauf="${g}">Verkaufen</button></div>`).join("")
        || `<p class="note" style="margin:6px 0 0">Keine heiße Ware im Lager.</p>`}` : ""}`}`;
}
document.addEventListener("click", e => {
  const q = e.target.closest("button[data-gcquote]");
  if (q) { socket.emit("gcasinoQuote", { quote: q.dataset.gcquote }, res => { if (res?.error) toast(res.error, true); gcasinoRender(); }); return; }
  if (e.target.closest("button[data-gcupgrade]")) {
    socket.emit("gcasinoUpgrade", {}, res => { if (res?.error) toast(res.error, true); gcasinoRender(); });
    return;
  }
  const v = e.target.closest("button[data-gcverkauf]");
  if (v) { socket.emit("gcasinoVerkauf", { good: v.dataset.gcverkauf }, res => {
    toast(res?.error || `Das Volk zahlt ${fmt(res.erloes)} — kein Wort zum Paten.`, !!res?.error); gcasinoRender(); }); return; }
});

/* ================= Spieltische: eigene Fenster mit echtem Spiel =================
 * Roulette und Blackjack sind Live-Tische (der Server führt die Runde, alle
 * Spieler sitzen am selben Tisch), Würfel/Slots/Baccara laufen solo — der
 * Server entscheidet, das Fenster animiert genau das Ergebnis. */
let GC_SPIEL = null;
const GC_RAD = { winkel: 0, raf: 0, ziel: null, laeuft: false };
const GC_RAD_ORD = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const GC_ROT = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const GC_TITEL = { roulette: "🎡 Roulette — Live-Tisch", blackjack: "🃏 Blackjack — Live-Tisch",
  poker: "🂡 Poker — Live-Tisch",
  wuerfel: "🎲 Hohe Neun", slots: "🎰 Slots „La Fortuna“", baccara: "🎴 Baccara" };
const karteHtml = k => `<span style="display:inline-block;min-width:32px;padding:6px 4px;margin:2px;border-radius:5px;background:#f4f0e6;color:${k.rot ? "#c0392b" : "#1c2430"};font-family:var(--mono);font-weight:800;font-size:15px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.45)">${k.txt}</span>`;
const karteKlein = (k, i) => `<span class="gcKS ${i % 2 ? "rk2" : "rk"}" style="color:${k.rot ? "#c0392b" : "#1c2430"}">${k.txt}</span>`;
const rueckKlein = () => `<span class="gcRueckS"></span>`;
const gcAvatar = (farbe, name) => `<span class="gcAvatar" style="background:${farbe}">${(name || "?")[0].toUpperCase()}</span>`;
const GC_SITZE_BJ = [[16, 66], [38, 84], [62, 84], [84, 66]];
const GC_SITZE_POKER = [[50, 88], [11, 46], [50, 13], [89, 46]];
const gcChips = ziel => [100, 500, 1000, 2000].map(v =>
  `<button class="mini" data-gcchip="${ziel}" data-wert="${v}">${v >= 1000 ? (v / 1000) + "k" : v}</button>`).join("");
const gcEinsatzZeile = id => `
  <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 9px">
    <span class="meta">Einsatz</span>
    <input id="${id}" type="number" min="50" max="2000" value="200" style="width:84px">
    ${gcChips(id)}
  </div>`;

function gcSpielOeffnen(art) {
  GC_SPIEL = art;
  document.getElementById("gcSpielTitel").innerHTML = GC_TITEL[art] || "Spieltisch";
  const el = document.getElementById("gcSpielModal");
  el.style.display = "grid";
  gcSpielBauen();
  gcSpielTick();
}
function gcSpielSchliessen() {
  GC_SPIEL = null;
  if (GC_RAD.raf) cancelAnimationFrame(GC_RAD.raf);
  GC_RAD.raf = 0; GC_RAD.laeuft = false; GC_RAD.ziel = null;
  document.getElementById("gcSpielModal").style.display = "none";
}

function gcSpielBauen() {
  const el = document.querySelector("#gcSpielModal .gcSpielInhalt");
  if (GC_SPIEL === "roulette") {
    el.innerHTML = `
      <div id="gcRadStatus" class="lbl" style="text-align:center;min-height:16px"></div>
      <canvas id="gcRadCanvas" style="display:block;margin:6px auto 2px;width:264px;height:264px;max-width:100%"></canvas>
      <div id="gcRadLetzte" class="meta" style="text-align:center;font-family:var(--mono);min-height:18px"></div>
      ${gcEinsatzZeile("gcRadEinsatz")}
      <div style="display:flex;gap:6px;margin-bottom:7px">
        <button class="bknopf" data-gcrad="rot" style="flex:1;background:linear-gradient(135deg,#7e1f1f,#a12a2a);border-color:#c0392b;color:#ffd8d0">ROT ×2</button>
        <button class="bknopf" data-gcrad="schwarz" style="flex:1;background:linear-gradient(135deg,#14181f,#232a36);border-color:#4a5568;color:#dfe6f0">SCHWARZ ×2</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:9px">
        <input id="gcRadZahl" type="number" min="0" max="36" value="17" style="width:64px">
        <button class="bknopf kauf" data-gcrad="zahl" style="flex:1">VOLLE ZAHL ×36</button>
      </div>
      <div class="lbl">Einsätze am Tisch</div>
      <div id="gcRadWetten" class="meta" style="font-family:var(--mono)"></div>`;
    gcRadMalen();
  } else if (GC_SPIEL === "blackjack") {
    el.innerHTML = `<div id="gcBjTisch"></div>`;
  } else if (GC_SPIEL === "poker") {
    el.innerHTML = `<div id="gcPokerTisch"></div>`;
  } else {
    /* Solo-Tische: Würfel, Slots, Baccara */
    if (GC_SPIEL === "slots") {
      el.innerHTML = `
        <div class="gcSlot">
          <div class="gcSlotTitel">✦ LA FORTUNA ✦</div>
          <div class="gcWalzen">${[0, 1, 2].map(i => `<span id="gcWalze${i}" class="gcWalzeN">❓</span>`).join("")}</div>
          <div id="gcSoloErgebnis" style="min-height:24px;margin-top:9px;text-align:center;font-weight:700;font-family:var(--mono)"></div>
        </div>
        ${gcEinsatzZeile("gcSoloEinsatz")}
        <button class="gcSpin" data-gcsolo="slots">🎰 SPIN</button>`;
      return;
    }
    const knopf = { wuerfel: "🎲 Würfeln", baccara: "🎴 Karten geben" }[GC_SPIEL];
    const buehne = GC_SPIEL === "wuerfel"
      ? `<div class="gcFilzPad" style="text-align:center">
           <div id="gcWuerfelFeld" style="font-size:64px;color:#f4f0e6;text-shadow:0 4px 10px rgba(0,0,0,.5);letter-spacing:12px">⚀⚀</div>
           <div id="gcWuerfelSumme" style="font:700 11px var(--mono);color:#e8c268;min-height:18px;margin-top:4px">Ziel: 9 oder mehr mit zwei Würfeln</div>
         </div>`
      : `<div class="gcFilzPad">
           <div style="font:800 9px system-ui;letter-spacing:2px;color:rgba(255,255,255,.55)">DEINE HAND</div>
           <div id="gcBacSpieler" style="min-height:42px"></div>
           <div style="font:800 9px system-ui;letter-spacing:2px;color:rgba(255,255,255,.55);margin-top:6px;text-align:right">DIE BANK</div>
           <div id="gcBacBank" style="min-height:42px;text-align:right"></div>
         </div>
         <p class="note" style="margin:0 0 6px;text-align:center">Punkte zählen modulo 10 — die höhere Hand gewinnt.</p>`;
    el.innerHTML = `${buehne}${gcEinsatzZeile("gcSoloEinsatz")}
      <button class="bknopf gcGold" data-gcsolo="${GC_SPIEL}" style="width:100%">${knopf}</button>
      <div id="gcSoloErgebnis" style="min-height:24px;margin-top:8px;text-align:center;font-weight:700;font-family:var(--mono)"></div>`;
  }
}

/* ---- Roulette: Rad malen & drehen ---- */
/* Der Kessel: Holz-und-Gold-Rand, satte Faecher, Kugel, Gewinner-Glut.
 * Gezeichnet in Retina-Aufloesung, damit nichts verwaschen wirkt. */
function gcRadMalen() {
  const c = document.getElementById("gcRadCanvas");
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), CSSW = 264;
  if (c.width !== CSSW * dpr) { c.width = c.height = CSSW * dpr; }
  const cx = c.getContext("2d");
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx.clearRect(0, 0, CSSW, CSSW);
  const M = CSSW / 2, R = 118, seg = Math.PI * 2 / 37;
  cx.save(); cx.translate(M, M);

  /* Aeusserer Rand: dunkles Holz mit Goldkante */
  let g = cx.createRadialGradient(0, 0, R - 4, 0, 0, R + 12);
  g.addColorStop(0, "#3a2417"); g.addColorStop(.55, "#57351d"); g.addColorStop(1, "#2a1a10");
  cx.beginPath(); cx.arc(0, 0, R + 12, 0, Math.PI * 2); cx.fillStyle = g; cx.fill();
  cx.beginPath(); cx.arc(0, 0, R + 12, 0, Math.PI * 2); cx.strokeStyle = "#c9a04e"; cx.lineWidth = 2; cx.stroke();
  cx.beginPath(); cx.arc(0, 0, R + 2, 0, Math.PI * 2); cx.strokeStyle = "#e8c26866"; cx.lineWidth = 1; cx.stroke();

  cx.rotate(GC_RAD.winkel);
  const idxSieger = GC_RAD.anzeige != null && GC_RAD.anzeige !== "…" ? GC_RAD_ORD.indexOf(GC_RAD.anzeige) : -1;
  for (let i = 0; i < 37; i++) {
    const z = GC_RAD_ORD[i];
    const a0 = i * seg - Math.PI / 2 - seg / 2, a1 = a0 + seg;
    /* Fach mit leichtem Radialverlauf */
    const basis = z === 0 ? ["#1f8b4d", "#0f5c30"] : GC_ROT.has(z) ? ["#c22f36", "#7e1b21"] : ["#262c38", "#101319"];
    g = cx.createRadialGradient(0, 0, 58, 0, 0, R);
    g.addColorStop(0, basis[1]); g.addColorStop(1, basis[0]);
    cx.beginPath(); cx.moveTo(0, 0); cx.arc(0, 0, R, a0, a1); cx.closePath();
    cx.fillStyle = g; cx.fill();
    /* Gewinnerfach gluehen lassen */
    if (i === idxSieger && !GC_RAD.laeuft) {
      cx.save(); cx.globalAlpha = .55 + .35 * Math.sin(performance.now() / 220);
      cx.beginPath(); cx.moveTo(0, 0); cx.arc(0, 0, R, a0, a1); cx.closePath();
      cx.fillStyle = "#e8c268"; cx.fill(); cx.restore();
    }
    /* Goldsteg zwischen den Faechern */
    cx.save(); cx.rotate(a0);
    cx.beginPath(); cx.moveTo(62, 0); cx.lineTo(R, 0);
    cx.strokeStyle = "#c9a04e88"; cx.lineWidth = 1.2; cx.stroke(); cx.restore();
    /* Zahl */
    cx.save(); cx.rotate(i * seg - Math.PI / 2);
    cx.fillStyle = i === idxSieger && !GC_RAD.laeuft ? "#10131a" : "#f2e8d2";
    cx.font = "800 10px ui-monospace,monospace"; cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.shadowColor = "rgba(0,0,0,.6)"; cx.shadowBlur = 2;
    cx.fillText(z, 0, -R + 12);
    cx.restore();
  }
  /* Innenring */
  cx.beginPath(); cx.arc(0, 0, 62, 0, Math.PI * 2); cx.strokeStyle = "#c9a04e"; cx.lineWidth = 2.5; cx.stroke();
  cx.rotate(-GC_RAD.winkel);

  /* Nabe: dunkler Samt mit Goldring und grosser Zahl */
  g = cx.createRadialGradient(-14, -18, 6, 0, 0, 58);
  g.addColorStop(0, "#1c2536"); g.addColorStop(1, "#0a0e17");
  cx.beginPath(); cx.arc(0, 0, 58, 0, Math.PI * 2); cx.fillStyle = g; cx.fill();
  cx.beginPath(); cx.arc(0, 0, 50, 0, Math.PI * 2); cx.strokeStyle = "#c9a04e44"; cx.lineWidth = 1; cx.stroke();
  const st2 = store.get().state;
  const anz = GC_RAD.anzeige ?? (st2?.groulette?.letzteZahl ?? "–");
  const anzFarbe = anz === "…" || anz === "–" ? "#8fa0b8"
    : anz === 0 ? "#37c977" : GC_ROT.has(anz) ? "#ff6b6b" : "#dfe6f0";
  cx.fillStyle = anzFarbe; cx.font = "900 30px ui-monospace,monospace";
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.shadowColor = "rgba(232,194,104,.4)"; cx.shadowBlur = anz === "…" ? 0 : 14;
  cx.fillText(anz, 0, 1);
  cx.shadowBlur = 0;

  /* Kugel: rollt beim Drehen gegenlaeufig aussen, faellt dann ins Fach */
  if (GC_RAD.kugelWinkel != null) {
    const kr = GC_RAD.kugelR ?? R - 10;
    const kx = Math.cos(GC_RAD.kugelWinkel) * kr, ky = Math.sin(GC_RAD.kugelWinkel) * kr;
    g = cx.createRadialGradient(kx - 2, ky - 2, .5, kx, ky, 5.5);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#9aa4b5");
    cx.beginPath(); cx.arc(kx, ky, 5, 0, Math.PI * 2); cx.fillStyle = g; cx.fill();
    cx.beginPath(); cx.arc(kx, ky, 5, 0, Math.PI * 2); cx.strokeStyle = "rgba(0,0,0,.35)"; cx.lineWidth = 1; cx.stroke();
  }
  cx.restore();

  /* Zeiger oben, mit Goldschliff */
  cx.beginPath(); cx.moveTo(M - 9, 2); cx.lineTo(M + 9, 2); cx.lineTo(M, 22); cx.closePath();
  g = cx.createLinearGradient(M, 2, M, 22);
  g.addColorStop(0, "#f2dda2"); g.addColorStop(1, "#b9903f");
  cx.fillStyle = g; cx.fill();
  cx.strokeStyle = "#7d6023"; cx.lineWidth = 1; cx.stroke();
}
function gcRadDrehen(zahl) {
  if (GC_RAD.laeuft && GC_RAD.ziel === zahl) return;
  GC_RAD.laeuft = true; GC_RAD.ziel = zahl; GC_RAD.anzeige = "…";
  const idx = GC_RAD_ORD.indexOf(zahl), seg = Math.PI * 2 / 37;
  const start = GC_RAD.winkel % (Math.PI * 2);
  const zielWinkel = -idx * seg + Math.PI * 2 * 6;   // 6 Extradrehungen, Segment landet am Zeiger
  const R = 118;
  const t0 = performance.now(), dauer = 6000;
  const kugelStart = -Math.PI / 2 + Math.random() * Math.PI * 2;
  let letztesSeg = -1;
  const schritt = t => {
    const f = Math.min(1, (t - t0) / dauer), e = 1 - Math.pow(1 - f, 3);
    GC_RAD.winkel = start + (zielWinkel - start) * e;
    /* Kugel: laeuft gegen die Drehrichtung, wird langsamer, sinkt nach innen
     * und liegt am Ende exakt im Zeigerfach (oben). */
    const kugelUmlaeufe = 8 * (1 - Math.pow(1 - f, 2.2));
    GC_RAD.kugelWinkel = f < .92
      ? kugelStart + kugelUmlaeufe * Math.PI * 2
      : -Math.PI / 2;                     // eingerastet im Fach am Zeiger
    GC_RAD.kugelR = R - 10 - 34 * Math.pow(f, 3);
    const seg2 = Math.floor(GC_RAD.winkel / (Math.PI * 2 / 37));
    if (seg2 !== letztesSeg && f < .96) { KTON.tick(); letztesSeg = seg2; }
    gcRadMalen();
    if (f < 1 && GC_SPIEL === "roulette") GC_RAD.raf = requestAnimationFrame(schritt);
    else {
      GC_RAD.laeuft = false; GC_RAD.anzeige = zahl;
      /* Gewinner-Glut noch kurz pulsieren lassen */
      const t1 = performance.now();
      const glut = () => {
        if (GC_SPIEL !== "roulette") return;
        gcRadMalen();
        if (performance.now() - t1 < 2600) GC_RAD.raf = requestAnimationFrame(glut);
        else { GC_RAD.kugelWinkel = null; GC_RAD.kugelR = null; gcRadMalen(); }
      };
      GC_RAD.raf = requestAnimationFrame(glut);
    }
  };
  GC_RAD.raf = requestAnimationFrame(schritt);
}
function gcRouletteTick() {
  const st = store.get().state, R = st?.groulette;
  if (!R) return;
  const status = document.getElementById("gcRadStatus");
  if (status) status.innerHTML = R.phase === "setzen"
    ? `Einsätze offen — die Kugel fällt in <b style="color:#e8c268">${R.rest}s</b>`
    : R.phase === "drehen" ? `<b style="color:#e8c268">Rien ne va plus — das Rad dreht sich…</b>`
    : "Setz einen Einsatz — das eröffnet die Runde für alle (20 s).";
  const letzte = document.getElementById("gcRadLetzte");
  if (letzte) letzte.textContent = R.letzteZahl == null ? "" :
    `Letzte Zahl: ${R.letzteZahl} (${R.letzteZahl === 0 ? "Zero" : GC_ROT.has(R.letzteZahl) ? "Rot" : "Schwarz"})`;
  const wetten = document.getElementById("gcRadWetten");
  if (wetten) wetten.innerHTML = R.einsaetze.length ? R.einsaetze.map(e =>
    `<div style="display:flex;gap:8px;padding:2px 0"><span style="color:${e.farbe}">●</span>
     <span style="flex:1">${e.name}</span>
     <span>${e.art === "zahl" ? "Zahl " + e.zahl : e.art === "rot" ? "Rot" : "Schwarz"}</span>
     <b>${fmt(e.einsatz)}</b></div>`).join("")
    : `<p class="note" style="margin:3px 0 0">Noch keine Einsätze — der Croupier wartet.</p>`;
  if (R.phase === "drehen" && R.zahl != null) gcRadDrehen(R.zahl);
  if (R.phase !== "drehen" && !GC_RAD.laeuft) { GC_RAD.ziel = null; gcRadMalen(); }
}

/* ---- Blackjack ---- */
function gcBlackjackTick() {
  const st = store.get().state, myId = store.get().myId, me = store.get().me, B = st?.gblackjack;
  const el = document.getElementById("gcBjTisch");
  if (!B || !el) return;
  if (el.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName)) return;
  const ich = B.spieler.find(s => s.pid === myId);
  const dranS = B.spieler[B.dran];
  const binDran = B.phase === "ziehen" && dranS && dranS.pid === myId;
  const status = B.phase === "warten" ? "Der Tisch ist frei — nimm Platz, dann läuft die Uhr (12 s) für Mitspieler."
    : B.phase === "setzen" ? `Karten kommen in <b style="color:#e8c268">${B.rest}s</b> — noch ${4 - B.spieler.length} Plätze frei.`
    : B.phase === "ziehen" ? (binDran ? `<b style="color:#e8c268">Du bist dran — ${B.rest}s</b>` : `${dranS ? dranS.name : "…"} überlegt (${B.rest}s)…`)
    : "Runde vorbei — der Tisch wird gleich neu eröffnet.";
  if (B.phase === "vorbei" && ich?.ergebnis && gcBlackjackTick._erg !== ich.ergebnis) {
    gcBlackjackTick._erg = ich.ergebnis;
    if (/Gewonnen|Blackjack/.test(ich.ergebnis)) { KTON.win(/Blackjack/.test(ich.ergebnis)); gcKonfetti(); }
    else if (!/Push/.test(ich.ergebnis)) KTON.lose();
  }
  if (B.phase !== "vorbei") gcBlackjackTick._erg = null;
  const ergFarbe = e => e === "Verloren" || e === "Überkauft" ? "var(--down)" : e === "Push" ? "var(--dim)" : "var(--up)";
  el.innerHTML = `
    <div class="lbl" style="text-align:center;min-height:16px">${status}</div>
    <div class="gcTischWrap">
      <div class="gcOval"><span class="linie"></span><span class="marke">Blackjack</span></div>
      <div class="gcSitz" style="left:50%;top:20%">
        ${gcAvatar("#c9a04e", "D")}<br>
        <span class="gcSName">Dealer${B.dealerSumme != null && B.phase !== "ziehen" && B.phase !== "setzen" ? ` · ${B.dealerSumme}${B.dealerSumme > 21 ? " 💥" : ""}` : ""}</span>
        <div>${B.dealer.map(karteKlein).join("")}${B.phase === "ziehen" ? rueckKlein() : ""}</div>
      </div>
      ${B.spieler.map((s, i) => `
        <div class="gcSitz ${B.phase === "ziehen" && i === B.dran ? "dran" : ""}" style="left:${GC_SITZE_BJ[i][0]}%;top:${GC_SITZE_BJ[i][1]}%">
          <div>${s.karten.map(karteKlein).join("")}${s.karten2 ? `<span class="meta">✂</span>${s.karten2.map(karteKlein).join("")}` : ""}</div>
          ${gcAvatar(s.farbe, s.name)}<br>
          <span class="gcSName">${s.name}${s.pid === myId ? " (du)" : ""}</span>
          <div class="gcSInfo">${s.ergebnis
            ? `<b style="color:${ergFarbe(s.ergebnis.split(" / ")[0])}">${s.ergebnis}</b>`
            : `<span class="gcChip"></span>${fmt(s.einsatz + (s.einsatz2 || 0))}${s.karten.length ? ` · ${s.summe}${s.karten2 ? " | " + s.summe2 : ""}` : ""}${s.karten2 && B.phase === "ziehen" && i === B.dran ? ` · Hand ${s.aktiv}` : ""}`}</div>
        </div>`).join("")}
    </div>
    ${binDran ? (() => {
        const hand = ich.aktiv === 2 ? ich.karten2 : ich.karten;
        const grund = ich.aktiv === 2 ? ich.einsatz2 : ich.einsatz;
        const kannDouble = hand.length === 2 && (me?.cash ?? 0) >= grund;
        const kannSplit = ich.aktiv === 1 && !ich.karten2 && ich.karten.length === 2 &&
          ich.karten[0].txt.slice(0, -1) === ich.karten[1].txt.slice(0, -1) && (me?.cash ?? 0) >= ich.einsatz;
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="bknopf kauf" data-gcbjzug="hit" style="flex:1;min-width:100px">🃏 Karte</button>
        <button class="bknopf" data-gcbjzug="stand" style="flex:1;min-width:100px;border-color:#c9a04e;color:#e8c268">✋ Halten</button>
        ${kannDouble ? `<button class="bknopf" data-gcbjzug="double" style="flex:1;min-width:100px;border-color:#7ec8ff;color:#aadcff">×2 Verdoppeln</button>` : ""}
        ${kannSplit ? `<button class="bknopf" data-gcbjzug="split" style="flex:1;min-width:100px;border-color:#d98cff;color:#e8b8ff">✂ Splitten</button>` : ""}</div>`;
      })()
      : !ich && (B.phase === "warten" || B.phase === "setzen") ? `
        ${gcEinsatzZeile("gcBjEinsatz")}
        <button class="bknopf gcGold" data-gcbjsitz style="width:100%">🃏 Platz nehmen</button>`
      : ich && !ich.fertig && B.phase === "ziehen" ? `<p class="note" style="margin:0;text-align:center">Gleich bist du an der Reihe…</p>`
      : ""}`;
}

/* ---- Poker ---- */
function gcPokerTick() {
  const st = store.get().state, myId = store.get().myId, me = store.get().me, P = st?.gpoker;
  const el = document.getElementById("gcPokerTisch");
  if (!P || !el) return;
  const meinErg = P.spieler.find(s => s.pid === myId)?.ergebnis;
  if (P.phase === "vorbei" && meinErg && gcPokerTick._erg !== meinErg) {
    gcPokerTick._erg = meinErg;
    if (meinErg.startsWith("+")) { KTON.win(true); gcKonfetti(); }
    else if (meinErg !== "Gefoldet") KTON.lose();
  }
  if (P.phase !== "vorbei") gcPokerTick._erg = null;
  if (el.contains(document.activeElement) && /INPUT/.test(document.activeElement.tagName)) return;
  const ich = P.spieler.find(s => s.pid === myId);
  const dranS = P.spieler[P.dran];
  const binDran = P.phase === "wetten" && dranS && dranS.pid === myId;
  const kosten = ich ? P.aktBet - ich.gesetzt : 0;
  const STRASSEN = ["Preflop", "Flop", "Turn", "River"];
  const status = P.phase === "warten" ? "Der Tisch ist frei — wer eröffnet, bestimmt den Grundeinsatz."
    : P.phase === "setzen" ? `Karten kommen in <b style="color:#e8c268">${P.rest}s</b> — Grundeinsatz ${fmt(P.einsatz)}, noch ${4 - P.spieler.length} Plätze.`
    : P.phase === "wetten" ? (binDran ? `<b style="color:#e8c268">Du bist dran (${STRASSEN[P.strasse]}) — ${P.rest}s</b>` : `${dranS ? dranS.name : "…"} überlegt (${STRASSEN[P.strasse]}, ${P.rest}s)…`)
    : "Showdown — gleich wird neu gemischt.";
  const ruecken = `<span style="display:inline-block;min-width:32px;padding:6px 4px;margin:2px;border-radius:5px;background:repeating-linear-gradient(45deg,#28406e,#28406e 4px,#1c2f52 4px,#1c2f52 8px);color:transparent">?</span>`;
  const meinIdx = ich ? P.spieler.indexOf(ich) : 0;
  const posVon = i => GC_SITZE_POKER[((i - meinIdx) + P.spieler.length * 2) % 4];
  el.innerHTML = `
    <div class="lbl" style="text-align:center;min-height:16px">${status}</div>
    <div class="gcTischWrap">
      <div class="gcOval gruen"><span class="linie"></span><span class="marke">Poker</span></div>
      <span class="gcPot"><span class="gcChip" style="background:radial-gradient(circle at 35% 30%,#5ac47a,#1d6b3a)"></span>Pot ${fmt(P.pot)}</span>
      <div class="gcBoard">${P.board.map(karteKlein).join("") || `<span class="meta" style="font-size:9px">— Karten kommen —</span>`}</div>
      ${P.spieler.map((s, i) => `
        <div class="gcSitz ${P.phase === "wetten" && i === P.dran ? "dran" : ""} ${s.gefoldet ? "foldd" : ""}" style="left:${posVon(i)[0]}%;top:${posVon(i)[1]}%">
          <div>${s.karten ? s.karten.map(karteKlein).join("")
            : s.pid === myId && me?.gpokerKarten ? me.gpokerKarten.map(karteKlein).join("")
            : P.phase === "wetten" || P.phase === "setzen" ? rueckKlein() + rueckKlein() : ""}</div>
          ${gcAvatar(s.farbe, s.name)}<br>
          <span class="gcSName">${s.name}${s.pid === myId ? " (du)" : ""}</span>
          <div class="gcSInfo">${s.ergebnis
            ? `<b style="color:${s.ergebnis.startsWith("+") ? "var(--up)" : "var(--dim)"}">${s.ergebnis}</b>`
            : s.gefoldet ? "Fold"
            : s.gesetzt ? `<span class="gcChip"></span>${fmt(s.gesetzt)}` : ""}</div>
        </div>`).join("")}
    </div>
    ${binDran ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="bknopf verkauf" data-gcpoker="fold" style="flex:1;min-width:90px">Fold</button>
        <button class="bknopf kauf" data-gcpoker="${kosten > 0 ? "call" : "check"}" style="flex:1;min-width:90px">${kosten > 0 ? `Call ${fmt(kosten)}` : "Check"}</button>
        ${P.raises < 3 ? `<button class="bknopf" data-gcpoker="raise" style="flex:1;min-width:90px;border-color:#c9a04e;color:#e8c268">Raise +${fmt(P.einsatz)}</button>` : ""}</div>`
      : !ich && (P.phase === "warten" || P.phase === "setzen") ? `
        ${P.phase === "warten" ? gcEinsatzZeile("gcPokerEinsatz") : `<p class="note" style="margin:4px 0">Grundeinsatz dieses Tisches: ${fmt(P.einsatz)} — du brauchst ${fmt(P.einsatz * 6)} Reserve.</p>`}
        <button class="bknopf gcGold" data-gcpokersitz style="width:100%">🂡 Platz nehmen</button>`
      : ""}
    <p class="note" style="margin:6px 0 0">Gespielt wird gegeneinander — das Haus nimmt 5 % vom Pot.</p>`;
}

function gcSpielTick() {
  const st = store.get().state;
  /* Wechselt die Piazza mitten in der Runde den Herrn, bleibt das Fenster
   * offen: Laufende Haende werden zu Ende gespielt, nur neue Einsaetze
   * weist der Server ab. */
  if (GC_SPIEL === "roulette") gcRouletteTick();
  else if (GC_SPIEL === "blackjack") gcBlackjackTick();
  else if (GC_SPIEL === "poker") gcPokerTick();
  gcTischSounds();
}

/* ---- Casino-Sounds: kurze Klänge über den vorhandenen rennTon-Synth ---- */
const KTON = {
  chip()  { rennTon(660, .05, "square", .05); setTimeout(() => rennTon(880, .05, "square", .04), 45); },
  karte() { rennTon(1400, .03, "square", .035); },
  tick()  { rennTon(1900, .015, "square", .03); },
  win(gross) {
    rennTon(523, .12, "triangle", .1); setTimeout(() => rennTon(659, .12, "triangle", .1), 110);
    setTimeout(() => rennTon(784, .2, "triangle", .12), 220);
    if (gross) setTimeout(() => rennTon(1047, .3, "triangle", .13), 330);
  },
  lose() { rennTon(180, .22, "sine", .07, 120); },
};

/* Karten-Sounds aus Zustandswechseln ableiten (Geben am Live-Tisch) */
let GC_SND = { bj: 0, poker: 0, board: 0, radPhase: null, radBet: false };
function gcTischSounds() {
  const st = store.get().state, myId = store.get().myId;
  if (!st) return;
  const bjK = (st.gblackjack?.spieler || []).reduce((a, s) => a + s.karten.length + (s.karten2?.length || 0), 0)
    + (st.gblackjack?.dealer?.length || 0);
  if (bjK > GC_SND.bj && GC_SPIEL === "blackjack") KTON.karte();
  GC_SND.bj = bjK;
  const brd = st.gpoker?.board?.length || 0;
  if (brd > GC_SND.board && GC_SPIEL === "poker") KTON.karte();
  GC_SND.board = brd;
  /* Roulette: Runde vorbei -> Gewinn-Fanfare oder Seufzer, plus Konfetti */
  const R = st.groulette;
  if (R) {
    if (R.phase !== "warten") GC_SND.radBet = GC_SND.radBet || R.einsaetze.some(e => e.name === st.players?.[myId]?.name);
    if (GC_SND.radPhase === "drehen" && R.phase === "warten" && GC_SND.radBet) {
      const meinName = st.players?.[myId]?.name;
      if ((R.letzteGewinner || []).includes(meinName)) { KTON.win(); gcKonfetti(); }
      else KTON.lose();
      GC_SND.radBet = false;
    }
    GC_SND.radPhase = R.phase;
  }
}

/* ---- Konfetti im Spielfenster ---- */
function gcKonfetti() {
  const kandidaten = ["gcSpielModal", "wzModal"]
    .map(id => document.getElementById(id))
    .filter(m => m && m.style.display !== "none")
    .map(m => m.querySelector(".gcPanel"));
  const ziel = kandidaten[0];
  if (!ziel || document.getElementById("gcKonfetti")) return;
  const box = document.createElement("div");
  box.id = "gcKonfetti";
  box.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5";
  ziel.style.position = "relative";
  const TEILE = ["🪙", "✨", "💰", "🎉"];
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("span");
    s.textContent = TEILE[Math.floor(Math.random() * TEILE.length)];
    s.style.cssText = `position:absolute;top:-30px;left:${Math.random() * 96}%;font-size:${13 + Math.random() * 14}px;transition:transform ${1 + Math.random() * .8}s cubic-bezier(.3,.7,.6,1),opacity 1.6s;opacity:1`;
    box.appendChild(s);
    requestAnimationFrame(() => { s.style.transform = `translateY(${360 + Math.random() * 200}px) rotate(${(Math.random() - .5) * 540}deg)`; s.style.opacity = "0"; });
  }
  ziel.appendChild(box);
  setTimeout(() => box.remove(), 2100);
}

/* ---- Bank gesprengt / Großgewinn: goldenes Vollbild-Banner ---- */
function gcasinoBanner(d) {
  let el = document.getElementById("gcBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "gcBanner";
    el.style.cssText = "position:fixed;inset:0;z-index:9999;display:none;place-items:center;pointer-events:none;background:radial-gradient(ellipse at center,rgba(201,160,78,.22),rgba(6,9,15,.55))";
    el.innerHTML = `<div id="gcBannerBox" style="text-align:center;transform:scale(.8);transition:transform .35s cubic-bezier(.2,1.6,.4,1)">
      <div id="gcBannerTitel" style="font-size:min(8vw,52px);font-weight:900;letter-spacing:2px;color:#e8c268;text-shadow:0 3px 24px rgba(201,160,78,.6)"></div>
      <div id="gcBannerText" style="font-size:min(4vw,20px);color:#f3ead2;margin-top:8px"></div></div>`;
    document.body.appendChild(el);
  }
  document.getElementById("gcBannerTitel").textContent = d.art === "gesprengt" ? "💥 BANK GESPRENGT!" : "🎰 GROSSER ABEND!";
  document.getElementById("gcBannerText").textContent = `${d.name} räumt ${fmt(d.betrag)} ab`;
  el.style.display = "grid";
  requestAnimationFrame(() => document.getElementById("gcBannerBox").style.transform = "scale(1)");
  KTON.win(true);
  if (d.art === "gesprengt") setTimeout(() => rennTon(1319, .4, "triangle", .12), 440);
  gcKonfetti();
  clearTimeout(gcasinoBanner._t);
  gcasinoBanner._t = setTimeout(() => {
    document.getElementById("gcBannerBox").style.transform = "scale(.8)";
    el.style.display = "none";
  }, 3200);
}
socket.on("gcasinoEreignis", d => gcasinoBanner(d));

/* ---- Wege zur Macht: vier Siegwege mit Fortschritt aller Familien ---- */
function siegwegeHtml(state) {
  if (state.mode !== "kartell" || !state.familien) return "";
  const gc = state.gcasino;
  const bezirke = {};
  for (const b of state.bezirke || []) if (b.kontrolle) bezirke[b.kontrolle] = (bezirke[b.kontrolle] || 0) + 1;
  const balken = (wert, ziel, farbe) => `
    <div style="flex:1;height:6px;border-radius:3px;background:rgba(201,160,78,.12);overflow:hidden">
      <i style="display:block;height:100%;width:${Math.min(100, (wert / ziel) * 100)}%;background:${farbe};box-shadow:0 0 5px ${farbe}"></i>
    </div>`;
  const zeile = (f, icon, wert, ziel, text) => `
    <div style="display:flex;align-items:center;gap:7px;margin:3px 0">
      <span style="width:14px;text-align:center">${icon}</span>
      <span style="color:${f.farbe};min-width:86px;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</span>
      ${balken(wert, ziel, f.farbe)}
      <b style="font-family:var(--mono);font-size:10px;min-width:38px;text-align:right">${text}</b>
    </div>`;
  const wege = [
    { icon: "\u{1F3D9}", name: "Herrschaft", ziel: "6 von 9 Bezirken",
      wert: f => bezirke[f.id] || 0, max: 6, text: f => `${bezirke[f.id] || 0}/6` },
    { icon: "\u{1F451}", name: "Dynastie", ziel: "3 Patenwahlen gewinnen",
      wert: f => f.wahlSiege || 0, max: 3, text: f => `${f.wahlSiege || 0}/3` },
    { icon: "\u2694", name: "Vendetta", ziel: "10 Bezirke erobern",
      wert: f => f.kampfSiege || 0, max: 10, text: f => `${f.kampfSiege || 0}/10` },
    { icon: "\u{1F3B0}", name: "Imperium", ziel: "La Dorata + Piazza + 100k Kasse",
      wert: f => gc?.herrscher !== f.id ? 0
        : gc?.stufe >= 5 ? Math.min(100000, f.kasse)
        : 15000 + (gc?.stufe || 0) * 7000,
      max: 100000, text: f => gc?.herrscher === f.id && gc?.stufe >= 5 ? `${Math.round(f.kasse / 1000)}k/100k` : `${gc?.herrscher === f.id ? "\u2713" : "\u2717"} ${gc?.stufe || 0}/5\u2605` },
  ];
  return `
    <div class="joinbox" style="margin-bottom:12px;border-color:#c9a04e44">
      <div class="lbl" style="color:#e8c268">\u{1F3C6} Wege zur Macht <span class="meta" style="text-transform:none;letter-spacing:0">— der erste Weg, den eine Familie vollendet, gewinnt die Runde</span></div>
      ${wege.map(w => `
        <div style="margin-top:8px">
          <div style="display:flex;gap:6px;align-items:baseline">
            <b style="font-size:11px">${w.icon} ${w.name}</b>
            <span class="meta" style="font-size:9px">${w.ziel}</span>
          </div>
          ${state.familien.map(f => zeile(f, "", w.wert(f), w.max, w.text(f))).join("")}
        </div>`).join("")}
    </div>`;
}

/* ================= Familienhaus: Rangordnung, Kasse, Soldaten ================= */
let FAM_OFFEN = null;
function famOeffnen(fid) {
  FAM_OFFEN = fid;
  let el = document.getElementById("famModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "famModal";
    el.style.cssText = "position:fixed;inset:0;z-index:53;display:none;place-items:center;background:rgba(6,9,15,.55);backdrop-filter:blur(2px)";
    el.addEventListener("click", e => { if (e.target === el) famSchliessen(); });
    el.innerHTML = `<div class="panel gcPanel" style="position:static;display:flex;width:min(440px,94vw);max-height:86vh;border-color:#c9a04e55">
      <div class="phead" style="background:linear-gradient(135deg,rgba(201,160,78,.16),transparent)">
        <h2 id="famTitel">Familienhaus</h2><button class="x" onclick="famSchliessen()">✕</button></div>
      <div class="pbody famInhalt"></div></div>`;
    document.body.appendChild(el);
  }
  el.style.display = "grid";
  famRender();
}
function famSchliessen() {
  FAM_OFFEN = null;
  const el = document.getElementById("famModal");
  if (el) el.style.display = "none";
}
const FAM_RANG_ICON = { oberhaupt: "\u{1F451}", capo: "\u{1F396}", rekrut: "\u{1FAA6}" };
const FAM_RANG_NAME = { oberhaupt: "Oberhaupt", capo: "Capo", rekrut: "Rekrut" };
function famRender() {
  if (!FAM_OFFEN) return;
  const el = document.querySelector("#famModal .famInhalt");
  const st = store.get().state, myId = store.get().myId, me = store.get().me;
  const fam = st?.familien?.find(f => f.id === FAM_OFFEN);
  if (!el || !fam) return;
  document.getElementById("famTitel").innerHTML = `\u{1F3E0} Casa ${fam.name.replace(/^(La |Das |Die )/, "")}`;
  const meinRang = fam.raenge?.find(r => r.pid === myId)?.rang;
  const binBoss = fam.bossPid === myId;
  const binMitglied = !!meinRang;
  const ordnung = { oberhaupt: 0, capo: 1, rekrut: 2 };
  const raenge = [...(fam.raenge || [])].sort((a, b) => ordnung[a.rang] - ordnung[b.rang]);
  el.innerHTML = `
    <div class="gcKopf" style="border-color:${fam.farbe}55">
      <div class="orna" style="color:${fam.farbe}aa">✦ ✦ ✦</div>
      <h3 style="color:${fam.farbe}">${fam.name}</h3>
      <div class="gcStats">
        <div class="gcStat"><b style="color:#e8c268">${fmt(fam.kasse)}</b><span>Familienkasse</span></div>
        <div class="gcStat"><b>${Math.round(fam.tribut * 100)} %</b><span>Tribut / min</span></div>
        <div class="gcStat"><b>${"\u{1FA96}".repeat(fam.soldaten) || "—"}</b><span>Soldaten (${fam.soldaten}/5)</span></div>
      </div>
      <p class="note" style="margin:7px 0 0">Mitglieder & Soldaten geben Startpunkte in Revierkämpfen. Tribut zahlen alle außer dem Oberhaupt — nur das Oberhaupt verfügt über die Kasse und darf zur Patenwahl antreten.</p>
    </div>
    <div class="gcTrenn">Rangordnung</div>
    ${raenge.map(r => `
      <div class="gcReihe" style="padding:6px 9px">
        <span style="font-size:16px;flex:none">${FAM_RANG_ICON[r.rang]}</span>
        <span style="flex:1;min-width:0"><b>${r.name}${r.pid === myId ? " (du)" : ""}</b>
          <span class="meta" style="display:block">${FAM_RANG_NAME[r.rang]}${r.bot ? " · KI" : ""}</span></span>
        ${binBoss && r.pid !== myId ? `
          <button class="mini" data-famrang="capo" data-pid="${r.pid}" ${r.rang === "capo" ? "disabled" : ""}>Capo</button>
          <button class="mini" data-famrang="rekrut" data-pid="${r.pid}" ${r.rang === "rekrut" ? "disabled" : ""}>Rekrut</button>
          <button class="mini gcGold" data-famrang="oberhaupt" data-pid="${r.pid}" title="Führung übergeben">\u{1F451}</button>` : ""}
      </div>`).join("")}
    ${binMitglied ? `
    <div class="gcTrenn">Kasse & Soldaten</div>
    ${binBoss ? `
      <div class="lbl" style="margin-top:6px">Tribut <span class="meta" style="text-transform:none;letter-spacing:0">— zahlen Capos & Rekruten jede Minute vom Bargeld</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:5px 0 9px">
        ${[0, .05, .10, .15].map(s2 => `<button class="mini ${Math.abs(fam.tribut - s2) < .001 ? "gcGold" : ""}" data-famtribut="${s2}">${Math.round(s2 * 100)} %</button>`).join("")}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="bknopf gcGold" data-famkasse="soldat" style="flex:1;min-width:46%;font-size:11px">\u{1FA96} Soldat (600 $)</button>
        <button class="bknopf gcGold" data-famkasse="einzahlen" style="flex:1;min-width:46%;font-size:11px">\u{1F4B0} 1.000 $ einzahlen</button>
        <button class="bknopf kauf" data-famkasse="ausschuetten" style="flex:1;min-width:46%;font-size:11px">Kasse ausschütten</button>
        <button class="bknopf verkauf" data-famkasse="einsacken" style="flex:1;min-width:46%;font-size:11px" title="Alles in die eigene Tasche (−2 Respekt)">\u{1F911} Einsacken</button>
      </div>` : `
      <p class="note" style="margin:4px 0 8px">Du zahlst als ${FAM_RANG_NAME[meinRang]} jede Minute ${Math.round(fam.tribut * 100)} % Tribut. Freiwillig geht immer:</p>
      <button class="bknopf gcGold" data-famkasse="einzahlen" style="width:100%">\u{1F4B0} 1.000 $ in die Kasse einzahlen</button>`}
    <div id="famErgebnis" style="min-height:22px;margin-top:8px;text-align:center;font-weight:700;font-family:var(--mono)">${window.FAM_LETZTES || ""}</div>` : `
    <p class="note" style="margin:8px 0 0;text-align:center">Du gehörst nicht zu dieser Familie — hier gibt es für dich nichts zu holen.</p>`}`;
}
document.addEventListener("click", e => {
  const rg = e.target.closest("button[data-famrang]");
  if (rg) {
    socket.emit("famRang", { pid: rg.dataset.pid, rang: rg.dataset.famrang },
      res => { if (res?.error) toast(res.error, true); else { KTON.chip(); famRender(); } });
    return;
  }
  const tr = e.target.closest("button[data-famtribut]");
  if (tr) {
    socket.emit("famTribut", { satz: +tr.dataset.famtribut },
      res => { if (res?.error) toast(res.error, true); else { KTON.chip(); famRender(); } });
    return;
  }
  const ka = e.target.closest("button[data-famkasse]");
  if (ka) {
    socket.emit("famKasse", { aktion: ka.dataset.famkasse }, res => {
      if (res?.error) return toast(res.error, true);
      KTON.chip();
      window.FAM_LETZTES = `<span style="color:var(--up)">${res.text || "Erledigt."}</span>`;
      famRender();
      setTimeout(() => { window.FAM_LETZTES = ""; }, 6000);
    });
    return;
  }
});

/* ---- Patenwahl: alle 20 Minuten stimmt die Stadt ab ---- */
socket.on("pateGewaehlt", d => {
  gcasinoBanner({ art: "pate", name: d.name, betrag: 0 });
  const t2 = document.getElementById("gcBannerTitel"), x2 = document.getElementById("gcBannerText");
  if (t2) t2.textContent = "\u{1F451} NEUER PATE";
  if (x2) { x2.textContent = `${d.name} übernimmt die Stadt`; x2.style.color = d.farbe || "#f3ead2"; }
});
function pateWahlWidget() {
  const st = store.get().state, myId = store.get().myId;
  const W = st?.pateWahl;
  let box = document.getElementById("pateWahlBox");
  if (!W?.phase || !st.familien) { if (box) box.style.display = "none"; return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "pateWahlBox";
    box.style.cssText = "position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:46;width:min(350px,92vw);" +
      "background:linear-gradient(168deg,#171320,#0f0c14);border:1px solid #c9a04e88;border-radius:12px;padding:10px 12px;" +
      "box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 22px rgba(201,160,78,.18)";
    document.body.appendChild(box);
  }
  const famVon = fid => st.familien.find(f => f.id === fid);
  const meineFam = st.players?.[myId]?.familie;
  const binPolizei = meineFam === "polizei";
  const binKandidat = W.kandidaten.some(k => k.pid === myId);
  const dekrete = W.dekrete || {};
  const TITEL = { kandidatur: "\u{1F3A9} PATENWAHL · KANDIDATUR", versprechen: "\u{1F4DC} PATENWAHL · VERSPRECHEN",
    wahl: "\u{1F5F3} PATENWAHL · ABSTIMMUNG", stichwahl: "\u2694 STICHWAHL" };
  const zaehl = {};
  for (const kid of Object.values(W.stimmen || {})) zaehl[kid] = (zaehl[kid] || 0) + 1;
  const max = Math.max(1, ...Object.values(zaehl));
  const meineStimme = W.stimmen?.[myId];
  const wahlbar = W.stich ? W.kandidaten.filter(k => W.stich.includes(k.pid)) : W.kandidaten;
  let inhalt = "";
  if (W.phase === "kandidatur") {
    inhalt = `
      ${W.kandidaten.length ? W.kandidaten.map(k => `
        <div style="display:flex;gap:7px;align-items:center;margin:4px 0">
          <span style="color:${famVon(k.familie)?.farbe}">\u25CF</span>
          <b style="flex:1">${k.name}</b>
          <span class="meta">${famVon(k.familie)?.name || ""}</span>
        </div>`).join("") : `<p class="note" style="margin:4px 0;text-align:center">Noch wirft niemand den Hut in den Ring…</p>`}
      ${!binPolizei && !binKandidat ? `<button class="bknopf gcGold" data-patekandidat style="width:100%;margin-top:6px">\u{1F3A9} Ich kandidiere!</button>`
        : binKandidat ? `<p class="note" style="margin:6px 0 0;text-align:center;color:#e8c268">Du stehst auf der Liste — gleich zählen Versprechen.</p>` : ""}`;
  } else if (W.phase === "versprechen") {
    inhalt = `
      ${W.kandidaten.map(k => `
        <div style="display:flex;gap:7px;align-items:center;margin:4px 0">
          <span style="color:${famVon(k.familie)?.farbe}">\u25CF</span>
          <b style="flex:1">${k.name}${k.pid === myId ? " (du)" : ""}</b>
          <span class="meta" style="font-style:italic">${k.versprechen ? "\u201E" + (dekrete[k.versprechen]?.name || k.versprechen) + "\u201C" : "überlegt noch…"}</span>
        </div>`).join("")}
      ${binKandidat ? `
        <div class="lbl" style="margin-top:7px">Dein Versprechen <span class="meta" style="text-transform:none;letter-spacing:0">— gilt bei Sieg als Dekret</span></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px">
          ${Object.entries(dekrete).map(([id2, d]) => `<button class="mini ${W.kandidaten.find(k => k.pid === myId)?.versprechen === id2 ? "gcGold" : ""}" data-pateversprechen="${id2}" title="${d.text}">${d.name}</button>`).join("")}
        </div>` : `<p class="note" style="margin:6px 0 0;text-align:center">Das Versprechen des Siegers gilt 20 Minuten als Dekret.</p>`}`;
  } else {
    inhalt = `
      ${wahlbar.map(k => `
        <div style="display:flex;align-items:center;gap:7px;margin:5px 0">
          <button class="mini ${meineStimme === k.pid ? "gcGold" : ""}" data-patenstimme="${k.pid}" ${binPolizei ? "disabled" : ""}
            style="min-width:118px;text-align:left;color:${famVon(k.familie)?.farbe}">${meineStimme === k.pid ? "\u2713 " : ""}${k.name}</button>
          <div style="flex:1;min-width:0">
            <div style="height:7px;border-radius:4px;background:rgba(201,160,78,.12);overflow:hidden">
              <i style="display:block;height:100%;width:${((zaehl[k.pid] || 0) / max) * 100}%;background:${famVon(k.familie)?.farbe};box-shadow:0 0 6px ${famVon(k.familie)?.farbe}"></i>
            </div>
            <span class="meta" style="font-size:8.5px;font-style:italic">${k.versprechen ? "\u201E" + (dekrete[k.versprechen]?.name || "") + "\u201C" : ""}</span>
          </div>
          <b style="font-family:var(--mono);min-width:14px;text-align:right">${zaehl[k.pid] || 0}</b>
        </div>`).join("")}
      <p class="note" style="margin:5px 0 0;text-align:center">${binPolizei ? "Die Questura schaut nur zu." : W.phase === "stichwahl" ? "Nur noch zwei — alle Stimmen wurden zurückgesetzt." : "Offenes Votum — der Sieger regiert 20 Minuten mit seinem Dekret."}</p>`;
  }
  box.style.display = "block";
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <b style="color:#e8c268;letter-spacing:1.2px;font-size:11px">${TITEL[W.phase] || "PATENWAHL"}</b>
      <span style="flex:1"></span>
      <b style="font-family:var(--mono);color:${W.rest <= 10 ? "var(--down)" : "#e8c268"}">${W.rest}s</b>
    </div>${inhalt}`;
}
document.addEventListener("click", e => {
  const kand = e.target.closest("button[data-patekandidat]");
  if (kand) {
    socket.emit("pateKandidieren", {}, res => { if (res?.error) toast(res.error, true); else { KTON.chip(); pateWahlWidget(); } });
    return;
  }
  const ver = e.target.closest("button[data-pateversprechen]");
  if (ver) {
    socket.emit("pateVersprechen", { art: ver.dataset.pateversprechen }, res => { if (res?.error) toast(res.error, true); else { KTON.chip(); pateWahlWidget(); } });
    return;
  }
  const b = e.target.closest("button[data-patenstimme]");
  if (!b) return;
  socket.emit("patenStimme", { kandidat: b.dataset.patenstimme }, res => {
    if (res?.error) toast(res.error, true); else { KTON.chip(); pateWahlWidget(); }
  });
});

/* ================= Wahrzeichen: ein interaktives Gebäude je Bezirk ================= */
const WZ_CLIENT = {
  kathedrale: { icon: "⛪", name: "Cattedrale", bezirk: 0,
    text: "Eine Spende beruhigt die Questura und poliert den Ruf — 20 % gehen als Kollekte an die Familie des Bezirks." },
  depot:      { icon: "🚂", name: "Frachtdepot", bezirk: 1,
    text: "Expressfracht: saubere Ware sofort ins Lager, 20 % Aufschlag — die Marge kassiert die Familie des Bezirks." },
  werft:      { icon: "🏗", name: "Alte Werft", bezirk: 2,
    text: "Für 500 $ schlachten die Jungs einen Kahn aus: Ziegel und Beton fürs nächste Bauprojekt." },
  markthalle: { icon: "🏛", name: "Markthalle", bezirk: 3,
    text: "Großmarkt-Deal: legale Ware zu 115 % verkaufen, 5 % Standgebühr an die Familie des Bezirks." },
  villa:      { icon: "🏰", name: "Villa del Capo", bezirk: 5,
    text: "800 $ Tribut: Läuft ein Revierkampf deiner Familie, schickt der Capo zwei Schränke (+2 Punkte) — sonst +3 Respekt." },
  kai:        { icon: "⚓", name: "Schmuggelkai", bezirk: 6,
    text: "Nachtschmuggel: heiße Ware zu 140 % — ohne Paten-Abgabe, 10 % Zoll, aber +3 Fahndung." },
  yacht:      { icon: "⛵", name: "Yachtclub", bezirk: 7,
    text: "Regatta: Setz auf eine von drei Yachten — die Siegerin zahlt ×2.7. Buchmacher ist die Familie des Bezirks." },
  brunnen:    { icon: "⛲", name: "Wunschbrunnen", bezirk: 8,
    text: "Wirf eine Münze in den Pot. Mit etwas Glück (7 %) fischst du 70 % des ganzen Brunnens heraus." },
};
let WZ_OFFEN = null;
function wzOeffnen(art) {
  WZ_OFFEN = art;
  let el = document.getElementById("wzModal");
  if (!el) {
    el = document.createElement("div");
    el.id = "wzModal";
    el.style.cssText = "position:fixed;inset:0;z-index:53;display:none;place-items:center;background:rgba(6,9,15,.55);backdrop-filter:blur(2px)";
    el.addEventListener("click", e => { if (e.target === el) wzSchliessen(); });
    el.innerHTML = `<div class="panel gcPanel" style="position:static;display:flex;width:min(430px,94vw);max-height:84vh;border-color:#c9a04e55">
      <div class="phead" style="background:linear-gradient(135deg,rgba(201,160,78,.16),transparent)">
        <h2 id="wzTitel">Wahrzeichen</h2><button class="x" onclick="wzSchliessen()">✕</button></div>
      <div class="pbody wzInhalt"></div></div>`;
    document.body.appendChild(el);
  }
  el.style.display = "grid";
  wzRender();
}
function wzSchliessen() {
  WZ_OFFEN = null;
  const el = document.getElementById("wzModal");
  if (el) el.style.display = "none";
}
function wzRender() {
  if (!WZ_OFFEN || window.WZ_RENNEN) return;
  const el = document.querySelector("#wzModal .wzInhalt");
  const w = WZ_CLIENT[WZ_OFFEN];
  if (!el || !w) return;
  if (el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const st = store.get().state, me = store.get().me;
  document.getElementById("wzTitel").textContent = `${w.icon} ${w.name}`;
  const herrId = st?.wzInfo?.herren?.[WZ_OFFEN];
  const herr = herrId ? st.familien?.find(f => f.id === herrId) : null;
  const bezName = st?.bezirke?.[w.bezirk]?.name || "";
  const legale = Object.entries(GOODS()).filter(([, g]) => g.cat !== "Illegal").map(([g2]) => g2);
  const illegale = Object.entries(GOODS()).filter(([, g]) => g.cat === "Illegal").map(([g2]) => g2);
  let aktion = "";
  if (WZ_OFFEN === "kathedrale") aktion = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
      <span class="meta">Spende</span>
      <input id="wzBetrag" type="number" min="100" max="2000" value="500" style="width:84px">
      ${[100, 500, 1000, 2000].map(v => `<button class="mini" data-gcchip="wzBetrag" data-wert="${v}">${v >= 1000 ? (v / 1000) + "k" : v}</button>`).join("")}
    </div>
    <button class="bknopf gcGold" data-wzgo="kathedrale" style="width:100%">🕯 Kerze anzünden & spenden</button>`;
  else if (WZ_OFFEN === "depot") aktion = `
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
      <select id="wzGood" style="flex:1">${legale.map(g => `<option value="${g}">${gname(g)}</option>`).join("")}</select>
      <input id="wzQty" type="number" min="1" max="50" value="10" style="width:64px">
    </div>
    <button class="bknopf gcGold" data-wzgo="depot" style="width:100%">🚂 Expressfracht bestellen (+20 %)</button>`;
  else if (WZ_OFFEN === "werft") aktion = `
    <button class="bknopf gcGold" data-wzgo="werft" style="width:100%">🔧 Schrott ausschlachten — 500 $</button>`;
  else if (WZ_OFFEN === "markthalle") aktion = legale.filter(g => Math.floor(me?.inv?.[g] || 0) > 0).map(g => `
    <div class="gcReihe" style="padding:6px 9px">
      <span style="flex:1">${gname(g)} <span class="meta">· ${Math.floor(me.inv[g])} Stück</span></span>
      <button class="bknopf kauf" data-wzgo="markthalle" data-good="${g}">Verkaufen +15 %</button>
    </div>`).join("") || `<p class="note">Keine legale Ware im Lager.</p>`;
  else if (WZ_OFFEN === "villa") aktion = `
    <button class="bknopf gcGold" data-wzgo="villa" style="width:100%">🤝 Gefallen erbitten — 800 $ Tribut</button>`;
  else if (WZ_OFFEN === "kai") aktion = illegale.filter(g => Math.floor(me?.inv?.[g] || 0) > 0).map(g => `
    <div class="gcReihe" style="padding:6px 9px">
      <span style="flex:1">${gname(g)} <span class="meta">· ${Math.floor(me.inv[g])} Stück</span></span>
      <button class="bknopf verkauf" data-wzgo="kai" data-good="${g}">Verschiffen +40 %</button>
    </div>`).join("") || `<p class="note">Keine heiße Ware im Lager — das Boot wartet.</p>`;
  else if (WZ_OFFEN === "yacht") aktion = `
    <div id="wzRegatta" style="position:relative;border-radius:11px;overflow:hidden;border:3px solid #57351d;box-shadow:0 0 0 2px #c9a04e,0 8px 20px rgba(0,0,0,.4),inset 0 0 22px rgba(0,0,0,.4);margin:4px 0 9px">
      <div class="wzKopfleiste">⚑ Regatta di Marina ⚑</div>
      <div style="position:relative">
        ${[1, 2, 3].map(y => `
          <div class="wzBahn b${y}" id="wzBahn${y}">
            <span class="nr">${y}</span>
            <span class="wzGischt" id="wzGischt${y}">≋≋</span>
            <span class="wzBoot" id="wzBoot${y}">⛵</span>
          </div>`).join("")}
        <div class="wzZiel"></div>
        <span style="position:absolute;right:2%;top:4px;font-size:14px;z-index:2">🏁</span>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
      <span class="meta">Einsatz</span>
      <input id="wzBetrag" type="number" min="100" max="1000" value="200" style="width:84px">
      ${[100, 300, 500, 1000].map(v => `<button class="mini" data-gcchip="wzBetrag" data-wert="${v}">${v >= 1000 ? "1k" : v}</button>`).join("")}
    </div>
    <div style="display:flex;gap:6px">
      ${[1, 2, 3].map(y => `<button class="bknopf gcGold" data-wzgo="yacht" data-yacht="${y}" style="flex:1">⛵ Yacht ${y}</button>`).join("")}
    </div>`;
  else if (WZ_OFFEN === "brunnen") aktion = `
    <div style="text-align:center;margin:2px 0 8px">
      <span class="gcLive" style="font-size:10px;padding:3px 10px"><i></i>POT ${fmt(st?.wzInfo?.brunnenPot || 0)}</span>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0 8px">
      <span class="meta">Münze</span>
      <input id="wzBetrag" type="number" min="50" max="500" value="100" style="width:84px">
      ${[50, 100, 250, 500].map(v => `<button class="mini" data-gcchip="wzBetrag" data-wert="${v}">${v}</button>`).join("")}
    </div>
    <button class="bknopf gcGold" data-wzgo="brunnen" style="width:100%">🪙 Münze werfen</button>`;
  el.innerHTML = `
    <div class="gcKopf">
      <div class="orna">✦ ✦ ✦</div>
      <h3>${w.icon} ${w.name}</h3>
      <div class="gcStats">
        <div class="gcStat"><b>${bezName}</b><span>Bezirk</span></div>
        <div class="gcStat"><b style="color:${herr ? herr.farbe : "var(--dim)"}">${herr ? herr.name : "niemand"}</b><span>kassiert hier</span></div>
      </div>
    </div>
    <p class="note" style="margin:8px 0 10px">${w.text}</p>
    ${aktion}
    <div id="wzErgebnis" style="min-height:24px;margin-top:8px;text-align:center;font-weight:700;font-family:var(--mono)">${window.WZ_LETZTES || ""}</div>`;
}
/* Die Regatta: Der Server hat die Siegerin schon gezogen — hier segeln die
 * drei Boote sichtbar um die Wette, mit Wellen-Gewackel und Fotofinish. */
function wzRegattaStart(res, wahl) {
  const boote = [1, 2, 3].map(y => document.getElementById("wzBoot" + y));
  const gischt = [1, 2, 3].map(y => document.getElementById("wzGischt" + y));
  const erg = document.getElementById("wzErgebnis");
  if (boote.some(b => !b)) { wzRegattaErgebnis(res, erg); return; }
  window.WZ_RENNEN = true;
  boote.forEach(b => { b.textContent = "⛵"; });
  [1, 2, 3].forEach(y => document.getElementById("wzBahn" + y)?.classList.toggle("wahl", y === wahl));
  document.querySelectorAll("button[data-wzgo=yacht]").forEach(b => b.disabled = true);
  if (erg) erg.innerHTML = `<span style="color:#e8c268">⚓ Und sie sind unterwegs…</span>`;
  /* Ziel bei 86 % Bahnbreite; Verliererinnen stranden bei 62-80 % */
  const ziele = [1, 2, 3].map(y => y === res.sieger ? 86 : 62 + Math.random() * 18);
  const phasen = [0, 1, 2].map(() => Math.random() * Math.PI * 2);
  const tempo = [0, 1, 2].map(() => .75 + Math.random() * .5);
  const t0 = performance.now(), dauer = 4600;
  let letzterTick = 0;
  const schritt = t => {
    const f = Math.min(1, (t - t0) / dauer);
    const e2 = 1 - Math.pow(1 - f, 2.2);
    boote.forEach((b, i) => {
      if (!b) return;
      /* Zwischenspurts: Sinus-Wobble laesst die Fuehrung wechseln, erst auf
       * den letzten Metern setzt sich die echte Siegerin ab. */
      const wobble = Math.sin(f * 7 + phasen[i]) * 7 * (1 - f) * tempo[i];
      const x = 4 + (ziele[i] - 4) * e2 + wobble * (f < .8 ? 1 : (1 - f) * 5);
      b.style.left = Math.max(4, x) + "%";
      b.style.top = (5 + Math.sin(t / 150 + i * 2) * 2.5) + "px";
      b.style.transform = `rotate(${Math.sin(t / 200 + i) * 4}deg)`;
      const g2 = gischt[i];
      if (g2) { g2.style.left = Math.max(0, x - 4) + "%"; g2.style.opacity = (f < .97 ? .35 + .3 * Math.abs(Math.sin(f * 7 + phasen[i])) : 0).toFixed(2); }
    });
    if (t - letzterTick > 380) { KTON.tick(); letzterTick = t; }
    if (f < 1 && WZ_OFFEN === "yacht") requestAnimationFrame(schritt);
    else {
      /* Die Siegerpose kurz stehen lassen, bevor der Sekundentakt neu malt */
      setTimeout(() => { window.WZ_RENNEN = false; }, 3500);
      const siegerBoot = boote[res.sieger - 1];
      if (siegerBoot) { siegerBoot.style.left = "88%"; siegerBoot.style.transform = "none"; siegerBoot.textContent = "⛵🏆"; }
      gischt.forEach(g2 => { if (g2) g2.style.opacity = 0; });
      wzRegattaErgebnis(res, document.getElementById("wzErgebnis"));
      document.querySelectorAll("button[data-wzgo=yacht]").forEach(b => b.disabled = false);
    }
  };
  requestAnimationFrame(schritt);
}
function wzRegattaErgebnis(res, erg) {
  const text = res.gewonnen
    ? `<span style="color:var(--up)">🏆 Yacht ${res.sieger} siegt — +${fmt(res.betrag)}!</span>`
    : `<span style="color:var(--down)">Yacht ${res.sieger} siegt — Einsatz versenkt.</span>`;
  if (res.gewonnen) { KTON.win(res.betrag >= 1000); gcKonfetti(); } else KTON.lose();
  window.WZ_LETZTES = text;
  if (erg) erg.innerHTML = text;
  setTimeout(() => { window.WZ_LETZTES = ""; }, 6000);
}

document.addEventListener("click", e => {
  const go = e.target.closest("button[data-wzgo]");
  if (!go) return;
  const art = go.dataset.wzgo;
  const payload = { art,
    betrag: +document.getElementById("wzBetrag")?.value || 0,
    good: go.dataset.good || document.getElementById("wzGood")?.value,
    qty: +document.getElementById("wzQty")?.value || 0,
    yacht: +go.dataset.yacht || 0 };
  socket.emit("wahrzeichen", payload, res => {
    if (res?.error) { toast(res.error, true); return; }
    KTON.chip();
    let text;
    if (art === "yacht") { wzRegattaStart(res, payload.yacht); return; }
    if (art === "brunnen") {
      text = res.jackpot
        ? `<span style="color:var(--up)">🎉 Der Brunnen erhört dich — +${fmt(res.jackpot)}!</span>`
        : `<span class="meta">Platsch. Der Pot wächst auf ${fmt(res.pot)}.</span>`;
      if (res.jackpot) { KTON.win(true); gcKonfetti(); }
    } else text = `<span style="color:var(--up)">${res.text || "Erledigt."}</span>`;
    window.WZ_LETZTES = text;
    wzRender();
    setTimeout(() => { window.WZ_LETZTES = ""; }, 6000);
  });
});

/* ---- Solo-Animationen ---- */
const GC_AUGEN = ["⚀","⚁","⚂","⚃","⚄","⚅"];
function gcSoloSpielen(art) {
  const einsatz = +document.getElementById("gcSoloEinsatz")?.value || 100;
  socket.emit("gcasinoSpielen", { spiel: art, einsatz }, res => {
    if (res?.error) return toast(res.error, true);
    const erg = document.getElementById("gcSoloErgebnis");
    const fertigText = () => {
      if (erg) erg.innerHTML = res.gewonnen
        ? `<span style="color:var(--up)">🎉 Gewonnen · +${fmt(res.betrag)}</span>`
        : `<span style="color:var(--down)">✗ Verloren · −${fmt(res.betrag)}</span>`;
      if (res.gewonnen) { KTON.win(res.betrag >= 1000); gcKonfetti(); } else KTON.lose();
    };
    if (erg) erg.innerHTML = "";
    if (art === "wuerfel" && res.detail?.wuerfel) {
      const feld = document.getElementById("gcWuerfelFeld"), summe = document.getElementById("gcWuerfelSumme");
      let n = 0;
      const iv = setInterval(() => {
        n++;
        if (!feld || GC_SPIEL !== "wuerfel") return clearInterval(iv);
        if (n < 12) { feld.textContent = GC_AUGEN[Math.floor(Math.random() * 6)] + " " + GC_AUGEN[Math.floor(Math.random() * 6)]; if (n % 3 === 0) KTON.tick(); }
        else {
          clearInterval(iv);
          const [a, b] = res.detail.wuerfel;
          feld.textContent = GC_AUGEN[a - 1] + " " + GC_AUGEN[b - 1];
          if (summe) summe.textContent = `${a} + ${b} = ${a + b} — ${a + b >= 9 ? "Hohe Neun!" : "zu wenig"}`;
          fertigText();
        }
      }, 95);
    } else if (art === "slots" && res.detail?.walzen) {
      const SYM = ["🍋","🍒","🔔","⭐","🍇","7️⃣"];
      [0, 1, 2].forEach(i => {
        const w = document.getElementById("gcWalze" + i);
        const iv = setInterval(() => { if (w) w.textContent = SYM[Math.floor(Math.random() * SYM.length)]; }, 70);
        setTimeout(() => { clearInterval(iv); if (w) w.textContent = res.detail.walzen[i]; KTON.chip(); if (i === 2) fertigText(); }, 800 + i * 550);
      });
    } else if (art === "baccara" && res.detail) {
      const sEl = document.getElementById("gcBacSpieler"), bEl = document.getElementById("gcBacBank");
      if (sEl) sEl.innerHTML = ""; if (bEl) bEl.innerHTML = "";
      const alle = [...res.detail.spieler.map(k => [sEl, k]), ...res.detail.bank.map(k => [bEl, k])];
      alle.forEach(([el2, k], i) => setTimeout(() => { if (el2) el2.innerHTML += karteHtml(k); KTON.karte(); }, 280 * i));
      setTimeout(() => {
        if (sEl) sEl.innerHTML += ` <b style="font-family:var(--mono)">= ${res.detail.ps}</b>`;
        if (bEl) bEl.innerHTML += ` <b style="font-family:var(--mono)">= ${res.detail.bs}</b>`;
        fertigText();
      }, 280 * alle.length + 150);
    } else fertigText();
  });
}

document.addEventListener("click", e => {
  const fenster = e.target.closest("button[data-gcfenster]");
  if (fenster) { gcSpielOeffnen(fenster.dataset.gcfenster); return; }
  const chip = e.target.closest("button[data-gcchip]");
  if (chip) { const f = document.getElementById(chip.dataset.gcchip); if (f) f.value = chip.dataset.wert; KTON.chip(); return; }
  if (e.target.closest("button[data-gcpokersitz]")) {
    socket.emit("gpokerBeitreten", { einsatz: +document.getElementById("gcPokerEinsatz")?.value || 100 },
      res => { if (res?.error) toast(res.error, true); else KTON.chip(); });
    return;
  }
  const pz = e.target.closest("button[data-gcpoker]");
  if (pz) {
    socket.emit("gpokerZug", { aktion: pz.dataset.gcpoker },
      res => { if (res?.error) toast(res.error, true); else if (pz.dataset.gcpoker === "raise" || pz.dataset.gcpoker === "call") KTON.chip(); });
    return;
  }
  const rad = e.target.closest("button[data-gcrad]");
  if (rad) {
    const art = rad.dataset.gcrad;
    socket.emit("grouletteSetzen", { art, zahl: +document.getElementById("gcRadZahl")?.value || 0,
      einsatz: +document.getElementById("gcRadEinsatz")?.value || 100 },
      res => { if (res?.error) toast(res.error, true); else { KTON.chip(); gcRouletteTick(); } });
    return;
  }
  if (e.target.closest("button[data-gcbjsitz]")) {
    socket.emit("gblackjackBeitreten", { einsatz: +document.getElementById("gcBjEinsatz")?.value || 100 },
      res => { if (res?.error) toast(res.error, true); else KTON.chip(); });
    return;
  }
  const zug = e.target.closest("button[data-gcbjzug]");
  if (zug) { socket.emit("gblackjackZug", { aktion: zug.dataset.gcbjzug }, res => { if (res?.error) toast(res.error, true); }); return; }
  const solo = e.target.closest("button[data-gcsolo]");
  if (solo) { gcSoloSpielen(solo.dataset.gcsolo); return; }
});

/* ---- Revierkampf-Inszenierung: Beben, Schüsse, Sieges-Banner ---- */
let KAMPF_SHAKE = 0;
function kampfSchuesse() {
  /* Drei kurze Salven aus geformtem Rauschen — klingt nach Straßenschlacht,
   * braucht keine Datei. Nutzt denselben Stummschalter wie alles andere. */
  try {
    if (typeof MUSIC !== "undefined" && MUSIC.istStumm()) return;
    const ctx = rennAudio.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 3; i++) {
      const t0 = ctx.currentTime + i * .22 + Math.random() * .05;
      const puffer = ctx.createBuffer(1, ctx.sampleRate * .12, ctx.sampleRate);
      const d = puffer.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / d.length, 3);
      const q = ctx.createBufferSource(), g2 = ctx.createGain(), f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 900;
      q.buffer = puffer; g2.gain.value = .25;
      q.connect(f); f.connect(g2); g2.connect(ctx.destination);
      q.start(t0);
    }
  } catch {}
}
function kampfBanner(d) {
  const st = store.get().state;
  const fam = (st?.familien || []).find(f => f.id === d.sieger);
  const box = document.getElementById("kampfBanner");
  document.getElementById("kampfBannerEmoji").textContent = d.art === "erobert" ? "⚔️" : "🛡️";
  const titel = document.getElementById("kampfBannerTitel");
  titel.textContent = d.art === "erobert"
    ? `${(fam?.name || d.sieger).toUpperCase()} ÜBERNIMMT ${d.name.toUpperCase()}`
    : `${(fam?.name || d.sieger).toUpperCase()} HÄLT ${d.name.toUpperCase()}`;
  titel.style.color = fam?.farbe || "#e8b544";
  document.getElementById("kampfBannerSub").textContent = d.art === "erobert"
    ? `Tauziehen ${d.pa}:${d.pv} · ${d.beute} $ geplündert · ${Math.round((d.dauer || 300) / 60)} min Besatzung`
    : `Tauziehen ${d.pv}:${d.pa} — der Angriff verpufft`;
  box.style.display = "grid";
  requestAnimationFrame(() => document.getElementById("kampfBannerBox").style.transform = "scale(1)");
  KAMPF_SHAKE = Math.max(KAMPF_SHAKE, .6);
  try {   // kleiner Jingle: Sieg = aufsteigend, Verteidigung = zwei feste Töne
    if (d.art === "erobert") { rennTon(392, .18, "triangle", .12); setTimeout(() => rennTon(523, .18, "triangle", .12), 160); setTimeout(() => rennTon(659, .3, "triangle", .14), 320); }
    else { rennTon(330, .2, "triangle", .12); setTimeout(() => rennTon(330, .28, "triangle", .12), 220); }
  } catch {}
  clearTimeout(kampfBanner._t);
  kampfBanner._t = setTimeout(() => {
    document.getElementById("kampfBannerBox").style.transform = "scale(.8)";
    box.style.display = "none";
  }, 4500);
}
function bindSocketEvents(s) {
  s.on("connect", () => reidentify(s));        // direkte socket.io-Verbindung
  s.on("reconnected", () => reidentify(s));    // über die WebRTC-Bridge gemeldet
  s.on("state", state => store.set({ state: mergeState(state) }));
  s.on("me", me => {
    letztesMe = Date.now();
    /* Teil-Paket: nur geänderte Felder — über das letzte "me" legen. */
    if (me.teil) { const { teil, ...f } = me; const alt = store.get().me; if (!alt) return; me = { ...alt, ...f }; }
    store.set({ me });
  });
  s.on("kurse", k => { priceHist = k?.waren || {}; firmHist = k?.firmen || {}; });
  s.on("notice", ({ text }) => toast(text));
  /* Revierkampf-Inszenierung: Kamera bebt, Schüsse knallen, am Ende Banner */
  s.on("kampfStart", () => { KAMPF_SHAKE = 1; kampfSchuesse(); });
  s.on("revierErgebnis", d => kampfBanner(d));
  /* Kein Toast mehr je Handel: Das Ereignis feuert bei JEDEM Abschluss im
   * Spiel, auch zwischen zwei Bots, an denen man selbst gar nicht beteiligt
   * ist. Bei sechs handelnden Bots stapelten sich die Meldungen bis in die
   * Bildschirmmitte und verdeckten die Karte. Eigene Abschlüsse stehen
   * weiterhin im Kontoauszug unter "Firma". */
  s.on("chat", ({ room, msg }) => {
    /* Wie serverseitig bei 100 gedeckelt: der Chatverlauf wuchs hier sonst über
     * die ganze Spielzeit unbegrenzt weiter, und das Chat-Panel baut bei jedem
     * Update die komplette Liste neu auf. */
    const c = store.get().chat;
    const liste = (c[room] ??= []);
    liste.push(msg);
    if (liste.length > 100) liste.splice(0, liste.length - 100);
    store.set({ chat: c });
    /* Nur fremde Nachrichten melden — die eigene hat man gerade selbst
     * abgeschickt, ein Klang darauf wäre reine Bestätigung des Offensichtlichen. */
    const meinName = store.get().state?.players?.[store.get().myId]?.name;
    if (msg?.who && msg.who !== meinName) SFX.spiel("hinweis");
  });
  s.on("contractOffer", c =>
    toast(`${c.from} bietet dir ${c.qty}× ${gname(c.good)} für ${fmt(c.price)}/Stk — annehmen im Finanz-Panel? Chat-Panel → Verträge`));
  s.on("shareOffer", o =>
    toast(`${o.from} bietet dir ${o.count*25}% seiner Firma für ${fmt(o.price)} an — annehmen im Finanzen-Panel.`));
  s.on("roundReset", () => { TUT_GESEHEN.clear(); backToLobby(); });
  s.on("disconnect", () => toast("Verbindung zum Server verloren", true));
}
/* Zurück in die Lobby nach dem Rundenende. Wichtig ist, dabei wirklich ALLES
 * zurückzusetzen, was sich auf die alte Runde bezieht — sonst zeichnet die neue
 * Runde mit den Straßenverläufen der alten Karte (ROUTES), führt Kachel-Diffs
 * auf dem alten Kartencache aus oder versucht, sich mit einem toten Token
 * wieder anzumelden. */
/* Abschlusstafel: Tabelle aller Firmen plus Auszeichnungen. Der Server liefert
 * die Zahlen fertig mit (state.report), sobald die Runde entschieden ist. */
let auswertungGezeigt = false;
function zeigeAuswertung(state) {
  if (auswertungGezeigt) return;          // einmal aufbauen, nicht im Sekundentakt neu
  const r = state.report;
  /* Das Einsteiger-Tutorial endet ueber denselben Weg wie ein Sieg, aber nicht
   * aus demselben Grund — hier stand sonst "100.000 $ erreicht" bei jemandem
   * mit 6.000 $ auf dem Konto. */
  document.getElementById("winname").parentElement.lastChild.textContent =
    state.tutorialEnde ? " hat es geschafft!" : " gewinnt!";
  document.getElementById("winsub").textContent = state.tutorialEnde
    ? (r ? `Einsteiger-Tutorial abgeschlossen — nach ${r.dauerMin} Minuten.`
         : "Einsteiger-Tutorial abgeschlossen.")
    : state.winGrund ? `${state.winGrund}${r ? ` — nach ${r.dauerMin} Minuten.` : "."}`
    : r ? `${fmt(state.winGoal)} Nettovermögen erreicht — nach ${r.dauerMin} Minuten.`
        : `${fmt(state.winGoal)} Nettovermögen wurde erreicht.`;
  if (!r) return;
  auswertungGezeigt = true;
  const myId = store.get().myId;
  document.getElementById("winKicker").textContent = state.tutorialEnde ? "Tutorial geschafft" : `Runde beendet · ${r.dauerMin} min`;
  const marke = (z, gr) => { const u = logoUrl(z.name);
    return u ? `<span class="winMarke logo" style="--g:${gr}px"><img src="${u}" alt=""></span>`
             : `<span class="winMarke" style="--g:${gr}px;--f:${z.color}">${z.name[0].toUpperCase()}</span>`; };
  /* Podest: Platz 2 – 1 – 3 */
  const top = r.zeilen.slice(0, 3);
  const reihenfolge = [top[1], top[0], top[2]].filter(Boolean);
  document.getElementById("winPodest").innerHTML = reihenfolge.map(z => {
    const platz = r.zeilen.indexOf(z) + 1;
    return `<div class="podPlatz p${platz}${z.id === myId ? " ich" : ""}">
      ${platz === 1 ? `<svg class="krone" width="30" height="22" viewBox="0 0 30 22" aria-hidden="true"><path d="M2 20h26L26 6l-6 6-5-10-5 10-6-6z" fill="currentColor"/></svg>` : ""}
      ${marke(z, platz === 1 ? 64 : 48)}
      <b>${z.name}</b><span class="nw">${fmt(z.netWorth)}</span>
      <div class="sockel"><span>${platz}</span></div></div>`; }).join("");
  /* Eigenes Ergebnis */
  const ichIdx = r.zeilen.findIndex(z => z.id === myId), ich = r.zeilen[ichIdx];
  document.getElementById("winMein").innerHTML = ich ? `<div class="winMeinBox${ich.sieger ? " sieg" : ""}">
      <span class="winMeinPlatz">${ichIdx + 1}.</span>
      <div><b>${ich.sieger ? "Glückwunsch — du hast gewonnen!" : `Dein Platz: ${ichIdx + 1} von ${r.zeilen.length}`}</b>
        <span class="meta">${fmt(ich.netWorth)} Nettovermögen · ${fmt(ich.umsatz)} Umsatz · ${ich.gebaeude} Gebäude${r.stadt ? ` · ${ich.arbeiter} Arbeiter` : ""}</span></div></div>` : "";
  if (r.stadt) document.getElementById("winMein").innerHTML += `<div class="winStadt"><b>${r.stadt.einwohner.toLocaleString("de-DE")}</b>
      <span>${t("Einwohner — die Stadt ist in dieser Runde von")} ${r.stadt.start} ${t("auf")} ${r.stadt.einwohner.toLocaleString("de-DE")} ${t("gewachsen")}
      · ${r.stadt.bloecke.map((n, i) => n ? `${n}× ${t(r.stadt.stufen[i])}` : "").filter(Boolean).join(", ")}</span></div>`;
  /* Endstand: Balken relativ zum Sieger */
  const maxNw = Math.max(1, ...r.zeilen.map(z => z.netWorth));
  document.getElementById("wintable").innerHTML = r.zeilen.map((z, i) => `
    <div class="winZeile${z.sieger ? " sieger" : ""}${z.id === myId ? " ich" : ""}">
      <span class="rang">${i + 1}</span>${marke(z, 30)}
      <div class="winName"><b>${z.name}${z.id === myId ? ` <em>du</em>` : ""}</b>
        <div class="winBalken"><i style="width:${Math.max(2, z.netWorth / maxNw * 100).toFixed(1)}%;background:${z.color}"></i></div>
        <span class="meta">Umsatz ${fmt(z.umsatz)} · ${z.produziertStk.toLocaleString("de-DE")} Stück · ${z.gebaeude} Gebäude${z.stufen ? ` ★${z.stufen}` : ""}${z.grossauftraege ? ` · ${z.grossauftraege} Großaufträge` : ""}${z.beteiligungswert ? ` · Beteiligungen ${fmt(z.beteiligungswert)}` : ""}</span></div>
      <span class="winNw">${fmt(z.netWorth)}</span></div>`).join("");
  document.getElementById("winAwardsBox").hidden = !r.auszeichnungen.length;
  document.getElementById("winawards").innerHTML = r.auszeichnungen.map(a => `
    <div class="award" style="--f:${a.color}"><div class="t">${a.titel}</div>
      <div class="n">${a.name}</div>
      <div class="v">${a.wert}</div>
      ${a.zusatz ? `<div class="z">${a.zusatz}</div>` : ""}</div>`).join("");
}
let WIN_ZU = false;
document.getElementById("winKarte").addEventListener("click", () => {
  WIN_ZU = true; document.getElementById("win").style.display = "none"; document.getElementById("winWieder").hidden = false; });
document.getElementById("winWieder").addEventListener("click", () => {
  WIN_ZU = false; document.getElementById("winWieder").hidden = true; document.getElementById("win").style.display = "grid"; });

function backToLobby() {
  cachedFullMap = null;
  letzterStand = null;
  ROUTES = null;
  calmAvg = null; calmPrev = null; calmAt = 0;
  pendingMerge = null;
  myToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  store.set({ state: null, me: null, meta: null, myId: null, chat: {} });
  auswertungGezeigt = false; WIN_ZU = false;
  document.getElementById("win").style.display = "none";
  document.getElementById("winWieder").hidden = true;
  document.getElementById("joinErr").textContent = "";
  openPanel("karte", true);   // Rückkehr in die Lobby ist kein Panel-Klick
  tutDone();
  document.getElementById("join").style.display = "";
  toast("Neue Runde — wähle deine Firma.");
}
bindSocketEvents(socket);

/* Bridge: verpackt eine PeerJS-DataConnection als socket.io-kompatibles Objekt
 * ({emit(ev,payload,ack), on(ev,fn)}) — der Rest des Clients merkt den Unterschied nicht. */
function makeBridge(conn) {
  const listeners = {}, pending = {};
  let reqId = 0;
  conn.on("data", msg => {
    if (msg.t === "ack") { const cb = pending[msg.id]; delete pending[msg.id]; if (cb) cb(msg.res); }
    else if (msg.t === "event") (listeners[msg.ev] || []).forEach(fn => fn(msg.payload));
  });
  conn.on("close", () => (listeners["disconnect"] || []).forEach(fn => fn()));
  return {
    emit(ev, payload, ack) { const id = ++reqId; if (ack) pending[id] = ack; conn.send({ t: "req", id, ev, payload }); },
    on(ev, fn) { (listeners[ev] ??= []).push(fn); },
  };
}
/* Host: nimmt eingehende WebRTC-Verbindungen an und spiegelt jede in eine eigene,
 * ganz normale socket.io-Verbindung zum eigenen lokalen Server — für den Server
 * sieht ein Fern-Mitspieler genauso aus wie ein zusätzlicher Browser-Tab. */
let hostPeer = null, hostVersuch = 0, hostTimer = null;
/* Der Online-Code entsteht über einen öffentlichen Vermittlungsdienst (PeerJS).
 * Der ist gelegentlich kurz nicht erreichbar. Vorher gab ein einziger solcher
 * Aussetzer dauerhaft auf — der Code stand dann bis zum Neuladen der Seite auf
 * "nicht verfügbar", obwohl beim nächsten Versuch alles geklappt hätte.
 * Jetzt wird mit wachsendem Abstand mehrfach neu versucht, ein Abriss im
 * laufenden Betrieb automatisch wieder aufgebaut, und als letzte Möglichkeit
 * lässt sich der Code per Klick von Hand neu anfordern. */
function hostCodeText(t, klickbar = false) {
  const el = document.getElementById("hostCode");
  el.textContent = t;
  el.style.cursor = klickbar ? "pointer" : "";
  el.style.fontSize = t.length > 8 ? "13px" : "";
  el.style.letterSpacing = t.length > 8 ? "0" : "";
  el.onclick = klickbar ? () => { hostVersuch = 0; startHosting(); } : null;
}
function startHosting(retriesLeft = 2) {
  if (hostTimer) { clearTimeout(hostTimer); hostTimer = null; }
  if (hostPeer) { try { hostPeer.destroy(); } catch {} }
  hostCodeText("verbinde …");
  const code = "cs-" + Math.random().toString(36).slice(2, 7);
  hostPeer = new Peer(code, { debug: 0 });
  hostPeer.on("open", id => {
    hostVersuch = 0;
    hostCodeText(id.replace(/^cs-/, "").toUpperCase());
  });
  /* Bricht die Verbindung zum Vermittler später ab, bleibt der Code gültig —
   * PeerJS kann dieselbe Kennung wieder anmelden. */
  hostPeer.on("disconnected", () => { try { hostPeer.reconnect(); } catch {} });
  hostPeer.on("error", err => {
    const typ = err?.type || "";
    if (typ === "unavailable-id" && retriesLeft > 0) { startHosting(retriesLeft - 1); return; }
    /* Netz- oder Serverfehler: nach kurzer Pause erneut versuchen, bis zu 4-mal
     * (2 s, 4 s, 8 s, 16 s). "peer-unavailable" betrifft nur eine einzelne
     * Gegenstelle und ist hier kein Grund, alles neu aufzubauen. */
    if (typ === "peer-unavailable") return;
    if (hostVersuch < 4) {
      const wartezeit = 2000 * 2 ** hostVersuch++;
      hostCodeText(`neuer Versuch in ${wartezeit / 1000} s …`);
      hostTimer = setTimeout(() => startHosting(2), wartezeit);
      return;
    }
    hostCodeText("Code anfordern ↻", true);
  });
  hostPeer.on("connection", conn => {
    conn.on("open", () => {
      const relay = io({ forceNew: true });   // eigene, unabhängige Verbindung — keine Mehrfachnutzung des Host-Sockets
      /* Verliert dieses Relay die Verbindung und baut sie neu auf, kennt der Server
       * die neue Socket-ID nicht mehr — der Fern-Mitspieler müsste sich sonst
       * stumm als Geist wiederfinden. Also Bescheid geben, damit er sich erneut
       * anmeldet. Die Karte schickt der Server der neuen Verbindung ohnehin
       * wieder vollständig, nur die noch gepufferten Einzeländerungen aus der
       * alten Verbindung sind dann hinfällig. */
      let relayWasConnected = false;
      relay.on("connect", () => {
        if (relayWasConnected) { pendingTiles.clear(); pendingFull = null; akku = null; conn.send({ t: "event", ev: "reconnected" }); }
        relayWasConnected = true;
      });
      conn.on("data", msg => { if (msg.t === "req") relay.emit(msg.ev, msg.payload, res => conn.send({ t: "ack", id: msg.id, res })); });
      /* "state" feuert bei jeder Spieler-/Bot-Aktion, oft mehrmals pro Sekunde.
       * Die Karte kommt vom Server inzwischen schon als Diff (siehe pushState),
       * hier bleibt nur noch die Drosselung auf höchstens 4×/s.
       * Wichtig dabei: Diffs dürfen NICHT einfach verworfen werden wie früher
       * die vollen Snapshots. Jeder Diff trägt eine eigene Änderung — wer beim
       * Drosseln den vorletzten wegwirft, verliert das Gebäude darin für immer.
       * Darum werden die Kachel-Änderungen im Fenster gesammelt und gebündelt
       * weitergereicht. */
      let stateTimer = null, latestState = null, pendingTiles = new Map(), pendingFull = null;
      /* Seit der Server nur noch geänderte Felder schickt (teil: true), werden
       * die im Fenster gesammelt (akku) und gebündelt als EIN Teil-Stand
       * weitergereicht. latestState hält den vollständigen Stand, falls eine
       * volle Karte ansteht. */
      let akku = null;
      relay.on("state", payload => {
        if (payload.map) {
          pendingFull = payload; pendingTiles.clear(); akku = null;
          latestState = { ...payload };
        } else {
          const { mapDelta, teil, ...felder } = payload;
          latestState = { ...(latestState || {}), ...felder };
          akku = { ...(akku || {}), ...felder };
          if (mapDelta) for (const d of mapDelta) pendingTiles.set(d.i, d);
        }
        if (stateTimer) return;
        stateTimer = setTimeout(() => {
          let out;
          if (pendingFull) {
            /* Volle Karte steht an: die seither gesammelten Änderungen direkt
             * einarbeiten, dann als eine vollständige Karte rausgeben. */
            const map = pendingFull.map;
            for (const d of pendingTiles.values()) {
              const t = map[d.i];
              if (t) for (const k in d) if (k !== "i") t[k] = d[k];
            }
            out = { ...latestState, map };
            delete out.mapDelta; delete out.teil;
            pendingFull = null;
          } else {
            out = { ...(akku || {}), teil: true, mapDelta: [...pendingTiles.values()] };
          }
          akku = null;
          pendingTiles.clear();
          conn.send({ t: "event", ev: "state", payload: out });
          stateTimer = null;
        }, 250);
      });
      ["me", "notice", "chat", "contractOffer", "shareOffer", "kurse"].forEach(ev => relay.on(ev, payload => conn.send({ t: "event", ev, payload })));
      conn.on("close", () => { relay.disconnect(); if (stateTimer) clearTimeout(stateTimer); });
    });
  });
}
/* ---- Mehrere gleichzeitige Runden (Gateway-Modus) ----
 * Läuft dieses Deployment hinter gateway.js statt direkt hinter server.js,
 * teilen sich mehrere unabhängige Runden dieselbe Adresse — jede über einen
 * eigenen 5-stelligen Code unter /r/<CODE>/socket.io/. Erkennung: /api/mode
 * gibt es nur beim Gateway, nicht bei einem pur lokal gestarteten server.js.
 * Läuft stattdessen direkt server.js (lokal, LAN, start.sh), bleibt alles wie
 * gehabt — inklusive des WebRTC-Beitritts weiter unten, den es im
 * Gateway-Modus gar nicht braucht (alle erreichen ja denselben Server). */
let MULTIROOM = false, GATEWAY_BOOT_ID = null, myRoomCode = null;
const multiroomReady = fetch(api("/api/mode")).then(r => r.ok ? r.json() : { multiroom: false })
  .then(d => { MULTIROOM = !!d.multiroom; GATEWAY_BOOT_ID = d.bootId || null; })
  .catch(() => { MULTIROOM = false; });
/* Wechselt die aktive Verbindung auf eine bestimmte Runde. Genau wie beim
 * WebRTC-Beitritt weiter unten: alte Verbindung sauber kappen, Kartencache
 * verwerfen (die neue Runde hat eine andere Karte), neu binden. */
function connectToRoom(code) {
  try { socket.disconnect?.(); } catch {}
  cachedFullMap = null;
  /* Auch hier ueber SERVER: Im Portalbetrieb liegt die Runde nicht bei der
   * Seite, sondern beim eigenen Server. Ohne diese Angabe suchte der Client die
   * Runde beim Portal — und faende sie nie. */
  socket = io(SERVER || undefined, { path: `/r/${code}/socket.io` });
  bindSocketEvents(socket);
  return socket;
}
/* Im Gateway-Modus gibt es auf dem Startbildschirm nichts einzuladen: den
 * Rundencode vergibt das Gateway erst beim Erstellen, und gezeigt wird er dann
 * im Warteraum. Früher stand hier eine Box mit "erscheint beim Start" — ein
 * Platzhalter, der Platz beanspruchte, ohne etwas zu sagen. Also ausblenden.
 * Im Einzelrunden-Modus bleibt die Box: dort ist der LAN-Link sofort gültig. */
function renderInviteMultiroom() {
  if (!MULTIROOM) return;
  const box = document.getElementById("invite");
  const label = document.getElementById("netstep");
  if (box) box.style.display = "none";
  /* Die Überschrift verschwindet nur beim Erstellen mit. Beim Beitreten
   * beschriftet sie weiterhin das Code-Eingabefeld darunter. */
  if (label) label.style.display = (netMode === "join") ? "" : "none";
}
multiroomReady.then(() => {
  if (!MULTIROOM) { startHosting(); return; }   // im Hintergrund — stört das lokale LAN/Solo-Spiel nicht, falls kein Internet da ist
  /* Öffnet man einen geteilten Link mit ?code=XXXXX, direkt den Beitritts-Tab
   * mit vorausgefülltem Code zeigen — die Adresse danach wieder aufräumen.
   * Läuft absichtlich erst hier (nach multiroomReady): die Netmode-Knöpfe
   * bekommen ihren Klick-Handler erst weiter unten im Skript, ein Klick
   * direkt an dieser Stelle liefe noch ins Leere. Da jedes .then() erst nach
   * dem kompletten synchronen Skriptdurchlauf feuert, ist das hier garantiert
   * schon passiert. */
  const code = new URLSearchParams(location.search).get("code");
  if (code) {
    document.querySelectorAll("#netmode .netopt")[1]?.click();
    const inp = document.getElementById("jcode");
    if (inp) inp.value = code.toUpperCase();
    history.replaceState(null, "", location.pathname);
  }
});

const GOODS = () => store.get().meta?.goods || {};
const BTYPES = () => store.get().meta?.btypes || {};
/* Warenname mit Rückfallebene. Kennt der Client eine Ware (noch) nicht — etwa
 * weil der Server seit dem Seitenaufruf um neue Waren erweitert wurde —, stand
 * hier vorher wörtlich "undefined" in der Oberfläche. Lieber der rohe Schlüssel
 * als ein kaputt aussehender Text. */
/* ---------- Sprache ----------
 * Die Oberfläche ist auf Deutsch gewachsen. Statt jede Zeichenkette gegen einen
 * Schlüssel zu tauschen — rund 450 Stellen, ein Umbau mit hohem Risiko direkt
 * nach dem Beta-Start — steht der deutsche Text weiterhin im Quelltext und
 * dient zugleich als Schlüssel. t("Neue Runde starten") liefert auf Englisch
 * die Übersetzung und auf Deutsch den Text selbst. Fehlt ein Eintrag, erscheint
 * der deutsche Wortlaut statt einer leeren Stelle oder eines Schlüsselnamens.
 * Namen von Waren, Gebäuden und Branchen liefert der Server zweisprachig mit. */
let SPRACHE = "de";
try { const g = localStorage.getItem("cs_lang"); if (g === "en" || g === "de") SPRACHE = g; } catch {}
const EN = {
  /* Startbildschirm */
  "Neue Runde starten": "Start a new round", "Einer Runde beitreten": "Join a round",
  "Tutorial spielen": "Play the tutorial", "Runde erstellen": "Create round",
  "Spielanleitung lesen": "Read the manual", "Lieber ausprobieren": "Rather try it out",
  "Vorlesen": "Read aloud", "Stopp": "Stop", "Spielanleitung": "Manual",
  "Neuer Spielmodus": "New game mode",
  "🏆 Bestenliste dieses Servers": "🏆 Server leaderboard",
  "Startfeld": "Grid",
  /* Renntag-Overlay */
  "🏁 Renntag — Anmeldung & Wetten": "🏁 Race day — entries & betting",
  "🏁 Das Rennen läuft": "🏁 The race is on",
  "🏁 Siegerehrung": "🏁 Podium ceremony",
  "🏁 Renntag": "🏁 Race day",
  "RENNEN LÄUFT": "RACE LIVE",
  "Siegerehrung": "Podium", "Rennen": "Race", "Anmeldung": "Entries",
  "Wettschein": "Betting slip", "Sponsorgesuche": "Sponsorship requests",
  "Sponsoren an Bord": "Sponsors on board", "Boxenfunk": "Pit radio", "Zwischenstand": "Standings",
  "Sieg": "Win", "Podium (Top 3)": "Podium (top 3)", "Ausfall": "DNF",
  "Wette platzieren": "Place bet", "Sponsoren suchen": "Find sponsors",
  "Erfüllen": "Fulfil", "zu wenig": "not enough", "Werksteam": "Works team",
  "dein Stall": "your stable", "gemeldet": "entered", "startet": "racing",
  "Erstes Rennen": "First race", "Wagen": "cars", "Preistopf": "Prize pot",
  "Wettpool": "Betting pool", "Sieg-Pool": "Win pool", "Podium-Pool": "Podium pool",
  "Ausfall-Pool": "DNF pool", "Auszahlung nach Zieldurchfahrt": "Paid out after the finish",
  "Einsatz $": "Stake $", "Menge": "Amount", "Geld": "Money",
  "🔧 BOX! Boxenstopp jetzt": "🔧 BOX! Pit stop now",
  "🔧 In der Box …": "🔧 In the pits …",
  "✓ Frische Technik": "✓ Fresh machinery",
  "Reifen, Technik, raus hier!": "Tyres, wrenches, go go go!",
  "Boxengasse zu — Schlussphase.": "Pit lane closed — final phase.",
  "Kostet ~5 s Stillstand, bringt Frische: mehr Tempo, weniger Ausfallrisiko.":
    "Costs ~5 s standing still, buys freshness: more pace, lower DNF risk.",
  "…Funk knistert…": "…radio static…",
  "Wagen links in der Liste anklicken": "Click a car in the list on the left",
  "Dein Gesuch": "Your request", "Noch keins aufgegeben": "None posted yet",
  "Zurzeit sucht kein anderes Team einen Sponsor.": "No other team is looking for a sponsor right now.",
  "Keine fremden Wagen zum Wetten gemeldet.": "No rival cars entered to bet on.",
  "Noch kein Wagen gemeldet — Rennställe melden im Motorsport-Panel.":
    "No cars entered yet — racing stables enter via the motorsport panel.",
  "Fahrzeugakte": "Vehicle record", "Verlauf": "History",
  "Zum Rennen melden": "Enter the race",
  "✓ Zum Rennen gemeldet": "✓ Entered in the race",
  "Nicht startklar (Fahrer + Zustand ≥ 25 % nötig)": "Not race-ready (driver + condition ≥ 25 % required)",
  /* Bugreport */
  "Fehler melden": "Report a bug",
  "Beschreibe kurz, was schiefgelaufen ist — je genauer, desto schneller lässt es sich beheben.":
    "Briefly describe what went wrong — the more precise, the faster it can be fixed.",
  "Was ist passiert? Was hättest du erwartet?": "What happened? What did you expect?",
  "Screenshot der Karte anhängen": "Attach a screenshot of the map",
  "Eigenes Bild stattdessen:": "Or upload your own image:",
  "Abbrechen": "Cancel", "Melden": "Report",
  "SCHWARZMARKT": "BLACK MARKET",
  "Runde beitreten": "Join round", "Runde starten": "Start round", "Kopieren": "Copy",
  "Firmenname": "Company name", "Mitspieler einladen": "Invite players",
  "Gleiches Netzwerk": "Same network", "Von woanders": "From elsewhere",
  "Deine Branche": "Your industry", "Rundenziel": "Round goal", "Bots": "Bots",
  "Einfach": "Easy", "Mittel": "Medium", "Schwer": "Hard", "Warteraum": "Waiting room",
  "Datenschutz": "Privacy", "Impressum": "Legal notice", "Überspringen": "Skip",
  "Ton einschalten": "Turn on sound", "Bitte Rundencode eingeben": "Please enter a round code",
  "Bauen": "Build", "Handeln": "Trade", "Gewinnen": "Win",
  "Kurswetten": "Stock bets", "Wette setzen": "Place bet", "Firmenwert steigt": "Value rises", "Firmenwert fällt": "Value falls",
  "Markt": "Market", "Depot": "Portfolio",
  /* Leiste unten und Panels */
  "Karte": "Map", "Lager": "Storage", "Börse": "Exchange", "Finanzen": "Finance",
  "Firma": "Company", "Lexikon": "Encyclopedia", "Chat": "Chat",
  "Warenbörse (P2P)": "Commodity exchange (P2P)", "Stadtbank — Aktienhandel": "City bank — share trading",
  "Nachrichtenzentrale": "News centre", "Anleihen": "Bonds",
  /* Börse */
  "Alle Waren": "All goods", "Anzeigen:": "Show:", "Verkauf": "Sell", "Kauf": "Buy",
  "Menge": "Amount", "Preis $": "Price $", "Order platzieren": "Place order",
  "Meine Orders": "My orders", "Storno": "Cancel", "Beliefern": "Supply", "Kaufen": "Buy",
  "Gesuch": "Wanted", "Angebot": "Offer",
  /* Startbildschirm: Branchenliste, Ablauf und Warteraum. Die Branchen stehen
   * dort als fester Text im Markup — im Spiel kommen sie dagegen vom Server
   * und waren deshalb laengst uebersetzt. */
  "Landwirtschaft": "Agriculture", "Rohstoff & Bau": "Raw materials & construction",
  "Wasser, Strom & Öl": "Water, power & oil", "Technologie": "Technology",
  "Touristik": "Tourism", "Rüstung": "Armament", "Gewählt": "Selected",
  "Obst, Kannabis, Saft und Medikamente — der einfachste Einstieg.":
    "Fruit, cannabis, juice and medicine — the easiest start.",
  "Erze, Stahl, Ziegel und Beton. Ohne dich baut hier niemand.":
    "Ore, steel, bricks and concrete. Without you nobody builds here.",
  "Läuft schnell und ununterbrochen — jeder braucht es dauernd.":
    "Fast and constant — everyone needs it all the time.",
  "Silizium und Elektronik — damit leveln alle ihre Fabriken hoch.":
    "Silicon and electronics — everyone upgrades their factories with it.",
  "Verwandelt Wasser und Strom in Gäste — die Branche, die kauft statt zu horten.":
    "Turns water and power into guests — the industry that buys instead of hoarding.",
  "Munition, Pistolen und Panzer — die wertvollsten Güter, aber am Ende jeder Lieferkette.":
    "Ammunition, pistols and tanks — the most valuable goods, but at the end of every supply chain.",
  "Bau dir eine Firma auf, versorge die Stadt, handle mit den anderen — und wenn du genug Anteile hast, kaufst du sie einfach auf.":
    "Build a company, supply the city, trade with the others — and once you hold enough shares, simply buy them out.",
  "Du baust nur Gebäude deiner Branche — alles andere kaufst du bei den anderen ein.":
    "You only build your own industry's sites — everything else you buy from the others.",
  "Kachel freischalten, Betrieb hochziehen, Rohstoffe verarbeiten.":
    "Unlock a tile, raise a plant, process raw materials.",
  "Im eigenen Laden, an der Börse mit den anderen oder für die Stadt.":
    "In your own shop, on the exchange with the others, or for the city.",
  "Wer zuerst das Vermögensziel knackt, gewinnt die Runde.":
    "Whoever reaches the wealth target first wins the round.",
  "Code deines Hosts": "Your host's code", "Zurück": "Back",
  "Öffentliche Runden": "Public rounds", "Runde öffentlich zeigen": "List round publicly",
  "Sie steht dann für alle auf dem Startbildschirm und ist ohne Code zu betreten.":
    "It then appears on everyone's start screen and can be joined without a code.",
  "Gerade ist keine öffentliche Runde offen — erstelle selbst eine.":
    "No public round is open right now — start one yourself.",
  "Noch niemand da": "Nobody here yet", "gerade eröffnet": "just opened",
  "Warteraum": "Lobby", "läuft": "running", "voll": "full", "beendet": "finished",
  "Noch in Entwicklung — Fehler sind wahrscheinlich, und mit jeder Aktualisierung gehen laufende Runden verloren. Meldungen gern über":
    "Still in development — expect bugs, and every update ends any round in progress. Reports welcome via",
  "unten rechts im Spiel.": "at the bottom right in game.",
  "z. B. Nordwerk & Co.": "e.g. Northworks & Co.",
  "Funktioniert für alle im selben WLAN. Für einen öffentlichen Link: npm run share":
    "Works for everyone on the same Wi-Fi. For a public link: npm run share",
  "Öffentlicher Link — funktioniert auch außerhalb deines Netzwerks.":
    "Public link — works outside your network too.",
  "Ziel und Bots stellst du gleich im Warteraum ein.": "You set target and bots in the lobby next.",
  "Sobald alle da sind, startet der Host die Runde.": "Once everyone is here, the host starts the round.",
  "Der Host startet die Runde, sobald alle da sind.": "The host starts the round once everyone is here.",
  "Rundencode für deine Mitspieler": "Round code for your fellow players",
  "Einstellungen": "Settings", "Modus": "Mode", "Ziel": "Target",
  "Planwirtschaft (DDR)": "Planned economy (GDR)",
  /* Bildunterschriften der Modus-Plakate. Die Plakate selbst sind auf Deutsch
     beschriftet — die Unterschrift ist damit der einzige Teil, der uebersetzt
     werden kann. */
  "Planwirtschaft": "Planned economy", "Einsteiger": "Beginner", "Kartell": "Cartel",
  "Kartellwirtschaft": "Cartel economy",
  "Agrar": "Agriculture", "Rohstoff": "Raw materials", "Versorger": "Utilities", "Technik": "Technology",
  "$100.000 · etwa 1 Stunde": "$100,000 · about 1 hour",
  "$250.000 · etwa 2 Stunden": "$250,000 · about 2 hours",
  "$500.000 · langer Abend": "$500,000 · a long evening",
  "$1 Mio. · für Ausdauernde": "$1M · for the persistent",
  "$10 Mio. · Marathon": "$10M · marathon",
  "jemand kauft, du lieferst": "someone is buying, you supply",
  "jemand verkauft, du kaufst": "someone is selling, you buy",
  "Kursverlauf": "Price history", "Tief": "Low", "Hoch": "High",
  "Orderbuch leer — platziere die erste Order.": "Order book is empty — place the first order.",
  "Keine fremden Orders für diese Ware.": "No other players' orders for this good.",
  /* Stadtbank */
  "gehört dir": "you own", "je 25 %-Block": "per 25% block", "Marktwert": "Market value",
  "Aktien": "Shares", "Aktien gehören dir": "shares are yours", "Kurs je Aktie": "Price per share",
  "Wert je Aktie (F)": "Value per share (F)", "Gebot gesamt $": "Total bid $", "Preis gesamt $": "Total price $",
  "Aktien abgeben": "Sell shares", "Deine Aktie": "Your stock", "Kurs": "Price", "Eigene Aktien": "Own shares",
  "Wert F je Aktie": "Value F per share", "Automatisch": "Automatic", "Festlegen": "Set",
  "Marktgeschehen": "Market activity", "Wert je Aktie (Fundament F)": "Value per share (fundamental F)",
  "Buchwert der Firma": "Book value of the company", "Dividende je Aktie": "Dividend per share",
  "Dividendenrendite zum Kurs": "Dividend yield at price", "Branchen-ETFs": "Industry ETFs", "Aktien des Finanzamts": "Tax office shares",
  "Umsatz 10 min": "Revenue 10 min", "Anteile abgeben": "Sell shares",
  "Anteile übernehmen": "Acquire shares", "Anbieten": "Offer", "Anfragen": "Request",
  "Kurstafel": "Price board", "Offene Angebote": "Open offers", "Dein Depot": "Your portfolio",
  "Offener Markt (alle)": "Open market (everyone)", "Portfoliowert": "Portfolio value",
  "Einstand": "Cost basis", "Wert": "Value", "Annehmen": "Accept", "Ablehnen": "Decline",
  "Fusionieren": "Merge", "Anfragen an dich": "Requests to you",
  "Dividende je 25 %-Block": "Dividend per 25% block", "Rendite auf den Blockpreis": "Yield on block price",
  "Umsatz der letzten 10 min": "Revenue, last 10 min", "Firmenwert": "Company value",
  "stark": "strong", "solide": "solid", "schwach": "weak", "kaum Ertrag": "little return",
  /* Nachrichtenzentrale */
  "Marktbericht": "Market report", "neu": "new", "Minute": "Minute",
  /* Allgemein */
  "Nettovermögen": "Net worth", "Bargeld": "Cash", "Rating": "Rating", "Level": "Level",
  "Stufe": "Level", "Abreißen": "Demolish", "Aufleveln": "Upgrade", "Pausieren": "Pause",
  "Freischalten": "Unlock", "Musik an/aus": "Music on/off", "Lautstärke": "Volume",
  "Rundencode kopieren": "Copy round code", "stumm": "muted",
  "Tutorial erneut ansehen": "Show tutorial again", "Weiter": "Next", "Fertig": "Done",
  "Los geht's!": "Let's go!", "Tutorial überspringen": "Skip tutorial",
  "Starter-Aufgaben": "Starter tasks", "STARTER-AUFGABEN": "STARTER TASKS",
  "Du hast noch keine Gebäude gebaut.": "You haven't built anything yet.",
  "Zu meinen Gebäuden springen (Taste F)": "Jump to my buildings (key F)",
  "BANK": "BANK", "NACHRICHTEN": "NEWS", "FINANZAMT": "TAX OFFICE", "Finanzamt": "Tax office",
  "Der Marktbericht erscheint alle zwei Minuten und vergleicht mit der Lage von vor zwei Minuten.":
    "The market report appears every two minutes, comparing against the situation two minutes earlier.",
  /* Lager, Firma, Finanzen */
  "Warenlager": "Inventory", "Gruppenauftrag": "Group order", "Beitragen": "Contribute",
  "Kontoauszug": "Account statement", "Rangliste": "Leaderboard", "Verträge": "Contracts",
  "Anleihe ausgeben": "Issue bond", "Betrag": "Amount", "Zins": "Interest", "Laufzeit": "Term",
  "Ausgeben": "Issue", "Zeichnen": "Subscribe", "Auktionen": "Auctions", "Bieten": "Bid",
  "Werbung": "Advertising", "Kampagne buchen": "Book campaign", "Reichweite": "Reach",
  "Du hältst keine fremden Anteile.": "You hold no shares in other companies.",
  "Gerade keine Angebote.": "No offers right now.",
  "Keine offenen Anleihen.": "No open bonds.",
  /* Kachelmenü */
  "Besitzer": "Owner", "Du": "You", "Produziert": "Produces", "Verarbeitet": "Processes",
  "Pfandrecht aktiv": "Lien active", "Pausiert": "Paused", "Bauen hier": "Build here",
  /* Finanzamt: dynamische Steuerlage (2026-10-21d) */
  "Steuerlage der Stadt": "City tax situation",
  "Ab 20.000 $ gelten die normalen Sätze. Darunter steigen sie: bis 3.000 $ um 10 %, darunter um 25 % (Notstand). Die 20.000 $ Grundstock fasst die Stadt nie an — die Lage sinkt nur, wenn die Bank bei Kurswetten verliert. Geprüft wird jede Minute.":
    "From 20,000 $ the normal rates apply. Below that they rise: by 10 % down to 3,000 $, by 25 % below (emergency). The city never touches its 20,000 $ base fund — the situation only drops when the bank loses on stock bets. Checked every minute.",
  "Börsengebühr": "Exchange fee",
  /* Stadtwachstum (2026-10-24) */
  "Die Stadt": "The city", "baut Wohnungen aus der Stadtkasse, Bewohner ziehen zu": "builds housing from the city treasury, residents move in",
  "Einwohner": "Residents", "Wohnungen": "Homes", "frei": "free", "Zufriedenheit": "Satisfaction",
  "Wegzug letzte Minute": "moved out last minute", "Zuzug letzte Minute": "moved in last minute",
  "Bewohner ziehen weg": "Residents are leaving", "bremst oder beschleunigt den Zuzug": "slows or speeds up new arrivals",
  "Einwohnerverlauf": "Population history", "Einwohner im Verlauf der Runde": "Residents over the round",
  "Siedlungshaus": "House", "Mietblock": "Apartment block", "Wohnturm": "Residential tower",
  "Stadtbild": "Cityscape", "Versorgung": "Supply", "Steuerlage": "Tax situation",
  "Noch kein Stadtprojekt fertig": "No city project finished yet", "Schonfrist zum Rundenstart": "Grace period at round start",
  "Strom, Wasser und Lebensmittel zu kaufen": "Power, water and food for sale",
  "Wohnbau": "Housing", "Baustelle läuft": "construction site active", "Baustellen laufen": "construction sites active",
  "Wartet auf Geld": "Waiting for money", "Kasse bleibt über": "treasury stays above",
  "Genug freie Wohnungen": "Enough free homes", "Kein Bauland mehr frei": "No building land left",
  "Miete an die Stadt": "Rent to the city", "je Einwohner und Minute": "per resident and minute",
  "Belegschaft": "Staff", "pausiert — Arbeiter frei": "paused — workers released", "steht still (unter 25 %)": "stopped (below 25 %)", "Leistung": "output",
  "Zu wenig Arbeiter": "Not enough workers",
  "Die Stadt hat gerade nicht genug Leute. Höhere Löhne (Firma-Panel) holen sie von anderen Firmen — oder warte, bis neue Bewohner zuziehen.": "The city is short of people right now. Higher wages (company panel) draw them from other companies — or wait for new residents.",
  "Löhne": "Wages", "Arbeiter": "workers", "Sparlohn": "Low wage", "Tariflohn": "Standard wage", "Spitzenlohn": "Top wage", "je Arbeiter/min": "per worker/min",
  "Lohnkosten": "Wage costs", "Insgesamt gezahlt": "Paid in total", "Senkung auf": "Cut to", "in": "in", "Kündigungsfrist": "notice period",
  "Löhne nicht voll bezahlt — du bekommst zuletzt Arbeiter, bis du wieder zahlst.": "Wages not paid in full — you get workers last until you pay again.",
  "Sind Arbeiter knapp, gehen sie zuerst zur Firma mit dem höchsten Lohn. Vom Lohn gehen 30 % als Steuer und Miete an die Stadt — damit baut sie Wohnungen.": "When workers are scarce they go to the company paying most. 30 % of wages go to the city as tax and rent — it builds housing with that.",
  "Arbeitsmarkt": "Labour market", "der Einwohner arbeiten": "of residents work", "Beschäftigt / Stellen": "Employed / jobs", "beschäftigt": "employed", "Stellen offen": "jobs open",
  "arbeitslos": "unemployed", "Stellen": "jobs", "Löhne aller Firmen": "Wages of all companies", "Lohnsteuer + Miete an die Stadt": "Wage tax + rent to the city", "der Löhne": "of wages",
  "Stütze für Arbeitslose": "Benefits for the unemployed", "Arbeit": "Work",
  "Rüstungsaufträge": "Arms contracts", "Ausschreibung": "Tender", "Lieferung": "Delivery", "Lieferruf": "Delivery reputation",
  "Polizei": "Police", "Stadtwache": "City guard", "Schützenverein": "Shooting club", "Grenzschutz": "Border guard",
  "Gebote noch": "Bids for", "Gebote": "bids", "Dein Gebot": "Your bid", "Bieten": "Bid", "Gebot ändern": "Change bid",
  "% vom Listenpreis": "% of list price", "Zuschlag an": "Awarded to", "Frist noch": "Deadline in",
  "Nächste Ausschreibung in": "Next tender in", "dich": "you",
  "Das günstigste Gebot gewinnt, gewichtet mit dem Lieferruf. Wer nicht rechtzeitig liefert, zahlt 20 % des fehlenden Werts als Strafe und verliert Ruf.":
    "The cheapest bid wins, weighted by delivery reputation. If you miss the deadline you pay 20 % of the missing value as a penalty and lose reputation.",
  "Einwohner — die Stadt ist in dieser Runde von": "residents — this round the city grew from", "auf": "to", "gewachsen": "",
  "Fachkräfte": "Skilled workers", "der Arbeitenden, mehr durch die Stadtbibliothek": "of the workforce, more via the city library",
  "Stadtanleihen": "City bonds", "gezeichnet, an der Stadtbank": "subscribed, at the city bank",
  "Baumaterial für die Stadt": "Building materials for the city", "15 % über Kurs, bezahlt sofort": "15 % above market, paid at once",
  "noch": "", "danach kauft die Stadt den Rest anderswo": "s left, then the city buys the rest elsewhere", "Lager": "Stock", "Menge": "Qty", "Liefern": "Deliver",
  "die Hälfte der Stellen hier verlangt Fachkräfte. Mehr bildet die Stadtbibliothek aus (Stadtprojekt).": "half the jobs here need skilled workers. The city library (city project) trains more.",
  "Steuerungssoftware spart hier ein Viertel der Arbeiter.": "Control software saves a quarter of the workers here.",
  "Stadt & Arbeit": "City & work", "Wohnblöcke der Stadt": "City housing", "Stufe": "Level", "Plätze": "Homes", "Kosten": "Cost", "ab Einwohnern": "from residents",
  "Rund 1 Arbeiter je 250 $ Baukosten (2 bis 30), +50 % je Ausbaustufe. Leistung = Besetzung, unter 25 % Stillstand. Labor, Studio und Chipfabrik: die Hälfte Fachkräfte. Steuerungssoftware: −25 %.": "About 1 worker per $250 building cost (2 to 30), +50 % per upgrade. Output = staffing, below 25 % it stops. Lab, studio and chip factory: half skilled workers. Control software: −25 %.",
  "30 % der Löhne gehen als Lohnsteuer und Miete an die Stadt, 20 % ins Bürgerdepot.": "30 % of wages go to the city as wage tax and rent, 20 % into the citizens' depot.",
  "höchstens": "at most", "Schulden": "debt", "Bürger-Apps und Jobbörse": "Citizen apps and job board",
  "Bürger-App: bis 85 % der Einwohner zahlen ein Abo je Minute, 200 Nutzer je Rechenzentrums-Stufe des Anbieters. Jobbörse: Vorrang wie +0,3 bis +0,7 Lohnstufen gegen eine Gebühr je Arbeiter, 3 Abos je Rechenzentrums-Stufe.": "Citizen app: up to 85 % of residents pay a subscription per minute, 200 users per data-centre level of the provider. Job board: priority like +0.3 to +0.7 wage levels for a fee per worker, 3 subscriptions per data-centre level.",
  /* Stadtkurier */
  "Anleihenmarkt": "Bond market",
  "Geld leihen und verleihen — mit Zins je Minute": "Borrow and lend money — with interest per minute",
  "am Markt": "on the market",
  "angelegt": "invested",
  "Schulden": "debt",
  "Stadtanleihe für den Wohnbau": "City bond for housing",
  "Firmenanleihe": "Corporate bond",
  "Nennwert": "Face value",
  "Zins": "Interest",
  "Laufzeit": "Term",
  "Zinsen bis zum Ende": "Interest until maturity",
  "im Verzug": "in default",
  "noch nicht verkauft": "not sold yet",
  "Verzug": "default",
  "Anleihen am Markt": "Bonds on the market",
  "Stadtanleihen zuerst, dann nach Zins": "city bonds first, then by interest",
  "Gerade wird keine Anleihe angeboten. Ratings entstehen aus Vermögen und Schulden der Firmen.": "No bond is on offer right now. Ratings come from companies' assets and debt.",
  "Vertragsangebote an dich": "Contract offers to you",
  "Annehmen": "Accept",
  "Ablehnen": "Decline",
  "Zwangsversteigerungen": "Foreclosure auctions",
  "gepfändete Gebäude von Firmen im Verzug": "seized buildings of defaulting companies",
  "Mindestgebot": "Minimum bid",
  "Höchstgebot": "Highest bid",
  "Bieten": "Bid",
  "Keine laufenden Auktionen.": "No running auctions.",
  "Anleihe ausgeben": "Issue bond",
  "Du bekommst den Nennwert sofort und zahlst jede Minute Zins. Am Ende zahlst du den Nennwert zurück — bei Verzug wird gepfändet.": "You receive the face value at once and pay interest every minute. At maturity you repay the face value — default leads to seizure.",
  "Nennwert $": "Face value $",
  "Zins % je Minute": "Interest % per minute",
  "Laufzeit in Minuten": "Term in minutes",
  "Zins je Minute": "Interest per minute",
  "Zinsen gesamt": "Total interest",
  "Rückzahlung am Ende": "Repayment at maturity",
  "Deine Anlagen": "Your investments",
  "Du hältst keine Anleihen.": "You hold no bonds.",
  "Deine Schulden": "Your debts",
  "Keine eigenen Anleihen offen.": "No own bonds outstanding.",
  "Der Anleihenmarkt wird von der Stadt betrieben · Firmenanteile handelst du auf bank.cs": "The bond market is run by the city · trade company shares on bank.cs",
  "Nennwert, Zins und Laufzeit eingeben": "Enter face value, interest and term",
  "Kurse, Fonds und Aktien der Stadt": "Prices, funds and shares of the city",
  "Marktübersicht": "Market overview",
  "Aktien": "Shares",
  "Handeln & Depot": "Trading & portfolio",
  "Aktie suchen": "Search share",
  "Aktie suchen …": "Search share …",
  "Stadtindex": "City index",
  "Fonds": "fund",
  "Veränderung in 2 Minuten": "Change over 2 minutes",
  "steigt": "rising",
  "gleich": "flat",
  "fällt": "falling",
  "Zur Aktie": "To share",
  "Fonds kaufen": "Buy funds",
  "Alle Aktien": "All shares",
  "Analysen und Nachrichten": "Analyses and news",
  "Noch keine Analysen.": "No analyses yet.",
  "Website besuchen": "Visit website",
  "Hier könnte Ihre Firma stehen": "Your company could be here",
  "Anzeigen buchen Firmen über das Werbenetz der Software-Firmen.": "Companies book ads via the software companies' ad network.",
  "du hältst": "you hold",
  "Marktwert": "Market value",
  "Wert je Aktie (F)": "Value per share (F)",
  "Umsatz 10 min": "Revenue 10 min",
  "Dividendenrendite": "Dividend yield",
  "Angebote ansehen und kaufen": "offers — view and buy",
  "Handeln: Kaufanfrage stellen": "Trade: place a bid",
  "Website der Firma": "Company website",
  "Suche": "Search",
  "nach Marktwert": "by market value",
  "Firma": "Company",
  "Kurs": "Price",
  "10 min": "10 min",
  "Keine Aktie gefunden.": "No share found.",
  "Der Verlauf erscheint nach den ersten Minuten.": "The chart appears after the first minutes.",
  "Verlauf": "Chart",
  "Start": "Start",
  "jetzt": "now",
  "Stadtbank": "City bank",
  "Aktienhandel, Übernahmen, Kurswetten und Depot": "Share trading, takeovers, stock bets and portfolio",
  "Firmen an der Börse": "listed companies",
  "Aktien, Übernahmen, Kurswetten": "Shares, takeovers, stock bets",
  "Die Stadtbank wird von der Stadt betrieben · das Gebäude im Zentrum führt hierher": "The city bank is run by the city · the building in the centre leads here",
  "für Verkäufer": "for sellers",
  "Versorgung": "Utilities",
  "Rohwaren": "Raw goods",
  "Verarbeitet": "Processed",
  "Baumaterial": "Building materials",
  "Fahrzeuge": "Vehicles",
  "Motorsport": "Motorsport",
  "Ø · Trend · Orders": "avg · trend · orders",
  "Ø-Kurs": "avg price",
  "Bestes Angebot": "Best offer",
  "Bestes Gesuch": "Best bid",
  "verfügbar": "available",
  "niemand verkauft": "no one is selling",
  "gesucht": "wanted",
  "niemand sucht": "no one is buying",
  "Dein Lager": "Your stock",
  "Wert": "Value",
  "Kaufen": "Buy",
  "Verkaufen": "Sell",
  "Preis je Stück": "Price per unit",
  "Kauforder platzieren": "Place buy order",
  "Verkaufsorder platzieren": "Place sell order",
  "Liegt ein Angebot zu diesem Preis oder billiger, wird sofort gekauft. Sonst bleibt die Order stehen; das Geld liegt so lange treuhänderisch fest.": "If an offer at this price or cheaper exists, you buy at once. Otherwise the order stays; the money is held in escrow meanwhile.",
  "Liegt ein Gesuch zu diesem Preis oder teurer, wird sofort verkauft. Sonst bleibt die Order stehen.": "If a bid at this price or higher exists, you sell at once. Otherwise the order stays.",
  "Angebote": "Offers",
  "Gesuche": "Bids",
  "jemand verkauft — du kaufst": "someone sells — you buy",
  "jemand kauft — du lieferst": "someone buys — you deliver",
  "Keine Angebote": "No offers",
  "Keine Gesuche": "No bids",
  "Kauf": "Buy",
  "Verkauf": "Sell",
  "Menge und Preis eingeben": "Enter quantity and price",
  "Order platziert": "Order placed",
  "Warenbörse": "Goods exchange",
  "Orders von Firmen und dem Stadtnetz": "Orders from companies and the city grid",
  "offene Orders": "open orders",
  "Börsengebühr": "Exchange fee",
  "Kurse": "Prices",
  "Die Warenbörse wird von der Stadt betrieben · Ware und Geld liegen bis zum Handel treuhänderisch fest": "The goods exchange is run by the city · goods and money are held in escrow until traded",
  "Nachrichten alle zwei Minuten": "news every two minutes",
  " und ": " and ",
  "AKTION LÄUFT": "CAMPAIGN ON",
  "ANZEIGE": "AD",
  "Alle": "All",
  "Alle Nachrichten": "All news",
  "Alles, was die Stadt online anbietet": "Everything the city offers online",
  "Archiv": "Archive",
  "Aufträge suchen Baumaterial": "orders need building materials",
  "Ausgabe": "Issue",
  "Beliebte Seiten": "Popular sites",
  "Besuchen": "Visit",
  "Den Zuschlag hat": "The contract went to",
  "Die Frist läuft noch": "Time left:",
  "Die Stadt hat jetzt": "The city now has",
  "Direkt kaufen, sofort im Lager.": "Buy directly, instantly in stock.",
  "EILMELDUNG": "BREAKING",
  "Eilmeldung": "Breaking",
  "Einwohner, die Zufriedenheit liegt bei": "residents, satisfaction is at",
  "Erste Ausgabe nach zwei Minuten": "First issue after two minutes",
  "Firma, Ware oder Branche — z. B. Obst, Strom, Hotel": "Company, goods or industry — e.g. fruit, power, hotel",
  "Großauftrag aus": "Group order from",
  "Hotels und Camping — Zimmer direkt buchen.": "Hotels and camping — book rooms directly.",
  "Im Topf liegen rund": "The pot holds about",
  "In diesem Ressort gibt es noch nichts Neues.": "Nothing new in this section yet.",
  "Jede Firma kann einzahlen; abgerechnet wird zum doppelten Ø-Kurs.": "Any company can contribute; paid at twice the average price.",
  "Kurse in 2 Minuten": "Prices over 2 minutes",
  "Minuten lang kommen mehr Gäste in die Stadt; alle Hotels profitieren, der Veranstalter am meisten.": "minutes more guests come to the city; all hotels benefit, the organiser most.",
  "Neu im Stadtnetz": "New in the city network",
  "Nichts gefunden. Versuch es mit einer Ware wie „Strom“ oder „Obst“.": "Nothing found. Try a good like “power” or “fruit”.",
  "Noch": "For another",
  "Noch gibt es nichts zu berichten.": "Nothing to report yet.",
  "Noch zu früh — die Kurse vergleicht der Kurier nach zwei Minuten.": "Too early — the courier compares prices after two minutes.",
  "Rüstungsfirmen geben jetzt ein verdecktes Gebot zwischen 80 und 140 % des Listenpreises ab. Mit Ausschreibungsportal zählen Gebote 5 % günstiger.": "Defence companies now place a sealed bid between 80 and 140 % of list price. With a tender portal bids count 5 % cheaper.",
  "Stadtkurier": "City Courier",
  "Stadtkurier · erscheint alle zwei Minuten · Anzeigen aus dem Werbenetz": "City Courier · published every two minutes · ads from the ad network",
  "Treffer": "results",
  "Wirtschaft": "Economy",
  "Zu den Ausschreibungen": "To the tenders",
  "Zum Artikel": "Read article",
  "Zum Großauftrag": "To the group order",
  "Zur Buchungsseite": "To the booking page",
  "Zur Börse": "To the exchange",
  "Zur Stadt": "To the city",
  "Zur Stadtbank": "To the city bank",
  "Zur Website": "To the website",
  "Zurück zur Übersicht": "Back to overview",
  "bekommen.": ".",
  "betrieben von der Stadt": "run by the city",
  "braucht": "needs",
  "gerade eben": "just now",
  "im Topf, noch": "in the pot,",
  "lädt zum": "invites to the",
  "schreibt aus": "tenders",
  "sortiert nach Besuchern": "sorted by visitors",
  "zu": "at",
  /* Stadtnetz (Etappe 8) */
  "Ab Website-Modul „Aktionen“ (v3): 5 Minuten +25 % Reichweite.": "From website module “Campaigns” (v3): +25 % reach for 5 minutes.",
  "Aktie an der Stadtbank": "Shares at the city bank",
  "Aktion starten": "Start campaign",
  "Alle Websites der Stadt": "All websites in the city",
  "Anbieter vergleichen": "Compare providers",
  "Anzeige": "Ad",
  "Ausschreibungen": "Tenders",
  "Ausschreibungsportal": "Tender portal",
  "Baustoff-Portal": "Building-materials portal",
  "Baustoff-Woche": "Building-materials week",
  "Besucher/min": "visitors/min",
  "Bieten und liefern im Firma-Panel": "Bid and deliver in the company panel",
  "Das Stadtnetz": "The city network",
  "Das Stadtnetz wird von der Stadt betrieben": "The city network is run by the city",
  "Dein Angebot": "Your offer",
  "Deine Firma ist im Stadtnetz nicht zu finden — ohne Website sehen dich Kunden nicht.": "Your company can't be found in the city network — without a website customers don't see you.",
  "Deine Website: So sehen Kunden und Mitspieler deine Firma im Stadtnetz.": "Your website: this is how customers and other players see your company in the city network.",
  "Du hast noch keine Website. Software-Firmen bauen sie dir — oder das Stadtportal die Grundseite.": "You have no website yet. Software companies build one for you — or the city portal builds the basic site.",
  "Einwohner online": "residents online",
  "Erntefest-Rabatt": "Harvest-festival sale",
  "Firma oder Ware suchen …": "Search company or goods …",
  "Firmen": "Companies",
  "Frühbucher-Aktion": "Early-bird offer",
  "Gebote offen": "bids open",
  "Gerade kein offener Auftrag.": "No open order right now.",
  "Gratis-Monat": "Free month",
  "Großhandel": "Wholesale",
  "Grundseite vom Stadtportal": "Basic site from the city portal",
  "Hofladen": "Farm shop",
  "Im Stadtnetz (Knopf unten) stehen alle Firmen mit Website. Mit einem Branchenportal kaufst du dort direkt ein — zum Beispiel Obst im Hofladen oder Strom im Kundenportal.": "The city network (button at the bottom) lists every company with a website. With an industry portal you buy directly there — for example fruit in the farm shop or power in the customer portal.",
  "Im Stadtnetz stehen alle Firmen mit Website, sortiert nach Besuchern. Branchenportal: Direktkauf zum Ø-Kurs plus 5 % (Hofladen, Großhandel, Baustoff-Portal, Kundenportal), Rohstoff +5 % auf Wohnbau-Lieferungen, Rüstung 5 % günstigere Gebote, +15 % je Lieferung und häufigere Ausschreibungen. Aktionen: 600 $, 5 Minuten +25 % Reichweite, danach 15 Minuten Pause.": "The city network lists every company with a website, sorted by visitors. Industry portal: direct purchase at average price plus 5 % (farm shop, wholesale, building-materials portal, customer portal), raw materials +5 % on housing deliveries, defence 5 % cheaper bids, +15 % per delivery and more frequent tenders. Campaigns: 600 $, +25 % reach for 5 minutes, then a 15-minute break.",
  "Kundenportal": "Customer portal",
  "Liefern im Stadt-Panel": "Deliver in the city panel",
  "Läuft": "Running",
  "Läuft gerade": "Happening now",
  "Messeauftritt": "Trade-fair appearance",
  "Mit dem Modul „Branchenportal“ wird deine Website zum Laden: Mitspieler kaufen direkt bei dir, Rohstoff und Rüstung bekommen Auftrags-Boni.": "With the “Industry portal” module your website becomes a shop: other players buy directly from you, raw materials and defence get order bonuses.",
  "Modul wechseln bei": "Switch module at",
  "Nichts gefunden.": "Nothing found.",
  "Noch hat keine Firma eine Website.": "No company has a website yet.",
  "Noch keine eigene Ware.": "No own goods yet.",
  "Noch nichts gebaut.": "Nothing built yet.",
  "Nächste Aktion in": "Next campaign in",
  "Nächste Ausschreibung kommt bald.": "Next tender coming soon.",
  "Produkt-Launch": "Product launch",
  "Rechenzentren und Software": "Data centres and software",
  "Seiten": "pages",
  "Stadtnetz": "City network",
  "Stadtnetz und Branchenportale": "City network and industry portals",
  "Suchen": "Search",
  "Unsere Betriebe": "Our venues",
  "Website von": "Website by",
  "Wechselprämie": "Switching bonus",
  "Wohnbau-Aufträge der Stadt": "City housing orders",
  "Wohnbau-Aufträge suchen Baumaterial": "housing orders need building materials",
  "Zum Online-Shop": "To the online shop",
  "Zurück zum Stadtnetz": "Back to the city network",
  "Zuschlag": "Awarded",
  "gekauft": "bought",
  "hat noch keine Website.": "has no website yet.",
  "je Stück": "per unit",
  "keine Website": "no website",
  "mehr Reichweite für": "more reach for",
  "mit Portal +5 % auf jede Lieferung": "with portal +5 % on every delivery",
  "mit Portal: Gebote zählen 5 % günstiger, Lieferungen +15 %, Ausschreibungen häufiger": "with portal: bids count 5 % cheaper, deliveries +15 %, more frequent tenders",
  "nach Besuchern": "by visitors",
  "sofort verfügbar": "available now",
  /* Rechenzentren und Websites (Etappe 7) */
  "200 Strom kaufen": "Buy 200 power",
  "Aktionen": "Campaigns",
  "Ansehen": "View",
  "Auf Stufe": "To level",
  "Ausbau, Preise, Platzverteilung, Websites": "Expansion, prices, capacity split, websites",
  "Ausfall – Strom fehlte": "Outage – no power",
  "Ausfälle": "outages",
  "Ausfall": "outage",
  "Ausgebucht — dem Anbieter fehlen Plätze im Rechenzentrum.": "Fully booked — the provider lacks data-centre slots.",
  "Bezahlen im Online-Marktplatz": "Payments in the online marketplace",
  "Branchenportal": "Industry portal",
  "Buchungsseite, Baustoff-Portal, Kundenportal oder Ausschreibungen — je nach Branche.": "Booking page, building-materials portal, customer portal or tenders — depending on industry.",
  "Bürger-App-Nutzer": "Citizen-app users",
  "Dein Preis": "Your price",
  "Deine Statusseite: So sehen Kunden und Mitspieler deine Rechenzentren. Ausbau, Preise und Platzverteilung stellst du hier direkt ein.": "Your status page: this is how customers and other players see your data centres. Set expansion, prices and capacity split right here.",
  "Deine Website läuft hier": "Your website runs here",
  "Diese Seite läuft mit": "This page runs on",
  "Du hast keinen Online-Marktplatz": "You have no online marketplace",
  "Einnahmen aus Websites": "Website income",
  "Einrichtung": "Setup",
  "Firmen-Website": "Company website",
  "Gebaut von": "Built by",
  "Gebäude gesteuert": "buildings controlled",
  "Gemüsekisten-Abo, Launch-Events, Feste online buchen.": "Veg-box subscriptions, launch events, book festivals online.",
  "Grundseite": "Basic site",
  "Grundseite beim Stadtportal": "Basic site from the city portal",
  "Grundseite beim Stadtportal bestellt": "Basic site ordered from the city portal",
  "Hosting & Preise": "Hosting & prices",
  "Hosting für Shops, Apps und Websites": "Hosting for shops, apps and websites",
  "Kauforder": "Buy order",
  "Kein passender Anbieter?": "No suitable provider?",
  "Keine Ausfälle": "No outages",
  "Keine passende Fabrik — ": "No suitable factory — ",
  "Leitstand für Fabriken": "Control room for factories",
  "Logo, Häuser oder Produkte, Bewertungen und Kontakt.": "Logo, venues or products, reviews and contact.",
  "Mehr Ausstoß oder weniger Rohstoffe, je nach Branchenbaum": "More output or fewer inputs, depending on the industry tree",
  "Mehr Reichweite: Läden, Gäste und Grundbedarf": "More reach: shops, guests and basic needs",
  "Mehr für Websites heißt weniger für Shops und Apps": "More for websites means less for shops and apps",
  "Minuten Vorrat. Fällt er aus, gehen Shops, Apps und Websites deiner Kunden offline.": "minutes of supply left. If it runs out, your customers' shops, apps and websites go offline.",
  "Name deines Baukastens": "Name of your builder",
  "Noch kein Rechenzentrum gebaut.": "No data centre built yet.",
  "Noch kein Shop-System fertig": "No shop system finished yet",
  "Noch kein System": "No system yet",
  "Noch keine Kunden.": "No customers yet.",
  "Noch keine Software-Firma mit Rechenzentrum.": "No software company with a data centre yet.",
  "Noch keine volle Minute gemessen.": "No full minute measured yet.",
  "Platzverteilung": "Capacity split",
  "Plätze frei": "slots free",
  "Rechenzentren": "Data centres",
  "Rechenzentren und Websites": "Data centres and websites",
  "Rechenzentrum": "Data centre",
  "Rechenzentrum ausgebaut": "Data centre upgraded",
  "Shop-Systeme und Steuerungen": "Shop systems and controls",
  "Shops und Steuerungen": "Shops and controls",
  "Software-Baukasten öffnen": "Open software builder",
  "Software-Firmen entwickeln einen Website-Baukasten (Grundseite, Branchenportal, Aktionen). Andere Firmen zahlen 400 $ Einrichtung und ein Abo je Minute und bekommen +5 / +10 / +15 % Reichweite: schneller verkaufen, mehr Gäste, mehr Grundbedarf. Je Rechenzentrums-Stufe 2 Websites; der Anbieter verteilt seine Plätze selbst. Ohne Anbieter: Stadtportal-Grundseite für 600 $ und 45 $/min.": "Software companies develop a website builder (basic site, industry portal, campaigns). Other companies pay 400 $ setup plus a subscription per minute and get +5 / +10 / +15 % reach: faster sales, more guests, more basic needs. 2 websites per data-centre level; the provider splits its capacity. Without a provider: city-portal basic site for 600 $ and 45 $/min.",
  "Stadtportal": "City portal",
  "Status": "Status",
  "Statusseite": "Status page",
  "Statusseite öffnen": "Open status page",
  "Steuern": "Control",
  "Steuerung": "Control",
  "Strom fehlte": "no power",
  "Strom wird knapp": "Power running low",
  "Strom/min": "power/min",
  "Verfügbarkeit": "Availability",
  "Verfügbarkeit, Hosting, Websites bestellen": "Availability, hosting, order websites",
  "Was hier läuft": "What runs here",
  "Website": "Website",
  "Website ansehen und bestellen": "View and order website",
  "Website bestellt": "Website ordered",
  "Website gekündigt": "Website cancelled",
  "Website kündigen": "Cancel website",
  "Website-Baukasten": "Website builder",
  "Website-Baukasten angelegt": "Website builder created",
  "Website-Baukasten anlegen": "Create website builder",
  "Websites": "Websites",
  "Websites und Rechenzentren": "Websites and data centres",
  "Zum Baukasten": "To the builder",
  "am Netz": "online",
  "aus – Strom fehlt": "off – no power",
  "ausbauen": "upgrade",
  "ausgelastet": "utilised",
  "bei": "at",
  "bestellen": "order",
  "braucht einen Baum für deine Branche": "needs a tree for your industry",
  "deine Website": "your website",
  "du hast noch keine Website": "you have no website yet",
  "hat noch keinen Website-Baukasten.": "has no website builder yet.",
  "in 10 Minuten": "in 10 minutes",
  "installieren": "install",
  "je Minute ab Grundseite": "per minute from basic site",
  "je Minute und Gebäude": "per minute and building",
  "je Verkauf": "per sale",
  "letzte": "last",
  "läuft hier": "runs here",
  "mehr": "more",
  "online": "online",
  "vor": "",
  "wechseln": "switch",
  "weniger": "less",
  "wird eingerichtet": "being set up",
  "wird installiert": "is being installed",
  "Eine Website für deine Firma": "A website for your company",
  "Software-Firmen bauen jetzt Websites. Eine eigene Website bringt mehr Reichweite: Deine Läden verkaufen schneller, Hotels bekommen mehr Gäste. Bestellen kannst du sie auf der Statusseite eines Rechenzentrums.": "Software companies now build websites. Your own website brings more reach: your shops sell faster, hotels get more guests. Order one on a data centre's status page.",
  /* Touristik (Etappe 6) */
  "Auf der Karte zeigen": "Show on map",
  "Ausgebucht — wir mussten woanders schlafen.": "Fully booked — we had to sleep elsewhere.",
  "Buchen": "Book",
  "Buchungsseite": "Booking page",
  "Buchungsseite öffnen": "Open booking page",
  "Campingplatz · fest 1 Stern": "Campground · fixed 1 star",
  "Deine Buchungsseite öffnen": "Open your booking page",
  "Deine Buchungsseite: So sehen Gäste und Mitspieler deine Häuser. Preis, Renovierung und Feste stellst du hier direkt ein.": "Your booking page: this is how guests and other players see your venues. Set price, renovation and festivals right here.",
  "Frühstück inklusive": "Breakfast included",
  "Frühstück? Fehlanzeige. Für so viele Sterne enttäuschend.": "Breakfast? None. Disappointing for so many stars.",
  "Gebucht über das Stadtportal": "Booked via the city portal",
  "Gäste diese Minute": "guests this minute",
  "Gäste kommen gerade je Minute in die Stadt": "guests are arriving in the city per minute",
  "Gästebewertungen": "Guest reviews",
  "Haus": "venue",
  "Hotels & Camping": "Hotels & camping",
  "Häuser": "venues",
  "Häuser, Preis, Renovieren und Feste wie auf einer Website": "Venues, price, renovation and festivals like a website",
  "Häuser, Preise und Bewertungen": "Venues, prices and reviews",
  "Höchste Stufe erreicht": "Top level reached",
  "Küste": "coast",
  "Minuten": "minutes",
  "Noch kein Haus fertig.": "No venue finished yet.",
  "Noch keine Gäste.": "No guests yet.",
  "Ordentlich für eine Nacht.": "Fine for one night.",
  "Preis übernehmen": "Apply price",
  "Preis, Renovieren, Feste": "Price, renovation, festivals",
  "Richtwert bei deiner Bewertung": "Guide price at your rating",
  "Sauber, freundlich, gutes Frühstück.": "Clean, friendly, good breakfast.",
  "Schön, aber für das Gebotene ganz schön teuer.": "Nice, but pricey for what you get.",
  "Stadt": "City",
  "Stadtfest buchen": "Book a city festival",
  "Stern": "star",
  "Traumhafter Blick aufs Meer, das Personal war super.": "Dreamy sea view, the staff were great.",
  "Unschlagbarer Preis, wir kommen wieder!": "Unbeatable price, we'll be back!",
  "Wegen des Stadtfests hier — tolle Stimmung in der Stadt!": "Here for the city festival — great atmosphere in town!",
  "Zelten direkt im Grünen, einfach aber herzlich.": "Camping in the green, simple but warm.",
  "Das Frühstücksbuffet allein ist die Reise wert.": "The breakfast buffet alone is worth the trip.",
  "Gerne wieder, nur der Pool war voll.": "Happy to return, only the pool was crowded.",
  "Die Duschen könnten neuer sein.": "The showers could be newer.",
  "Zentral gelegen, nette Leute.": "Central location, nice people.",
  "Etwas in die Jahre gekommen.": "A bit dated.",
  "Zimmerpreis je Nacht": "Room price per night",
  "ab": "from",
  "im Grünen": "in the green",
  "in der Stadt": "in town",
  "ohne Zimmer": "without a room",
  "renovieren": "renovate",
  "seit Rundenbeginn": "since round start",
  "veranstaltet von": "hosted by",
  "veranstaltet von uns!": "hosted by us!",
  "Auf": "To",
  "Bewertung": "Rating",
  "Deine Betriebe": "Your venues",
  "Deine Touristik": "Your tourism",
  "Die Sterne über 2 zählen nur anteilig. Kauf Obst, Honig, Saft oder Gebäck an der Börse.": "Stars above 2 only count partly. Buy fruit, honey, juice or pastries at the exchange.",
  "Festival": "Festival",
  "Frühstück fehlt": "Breakfast missing",
  "Frühstück je Minute": "Breakfast per minute",
  "Gäste": "Guests",
  "Gäste der Stadt": "Guests in the city",
  "Gäste für deine Hotels": "Guests for your hotels",
  "Gäste je Minute": "guests per minute",
  "Gäste kommen nur in eine wachsende Stadt (Sandkasten).": "Guests only come to a growing city (sandbox).",
  "Gäste und Hotels": "Guests and hotels",
  "Gäste wollten zu dir, aber dein Lager war leer. Mehr Übernachtungen produzieren — oder den Preis anheben.": "guests wanted to stay with you, but your stock was empty. Produce more lodging — or raise the price.",
  "Gäste wählen nach Bewertung und Preis. Bei deiner Bewertung bringt etwa": "Guests choose by rating and price. At your rating, about",
  "Gäste übernachten bei Touristik-Firmen auf Campingplätzen und in Strandhotels.": "Guests stay with tourism companies at campgrounds and beach hotels.",
  "Hotels der Stadt": "Hotels in the city",
  "Höchste Stufe": "Top level",
  "Jede Minute 10 Gäste plus 4 je 100 Einwohner, mal Zufriedenheit. Sie wählen nach Bewertung und Zimmerpreis; wer zu teuer ist, verliert Gäste an andere Urlaubsorte. Strandhotel 2 bis 5 Sterne (Renovieren 1.500 / 3.000 / 5.000 $), ab 3 Sternen Frühstück für 3 / 5 / 8 $ je Gast. Stadtfeste: +60 bis +150 % Gäste für 5 bis 8 Minuten.": "Every minute 10 guests plus 4 per 100 residents, times satisfaction. They choose by rating and room price; too expensive loses guests to other destinations. Beach hotel 2 to 5 stars (renovation 1,500 / 3,000 / 5,000 $), from 3 stars breakfast worth 3 / 5 / 8 $ per guest. City festivals: +60 to +150 % guests for 5 to 8 minutes.",
  "Jede Minute kommen Gäste in die Stadt und wählen ein Hotel nach Bewertung und Zimmerpreis. Renovierte Strandhotels bekommen mehr Sterne (ab 3 Sternen mit Frühstück), und ein Stadtfest lockt viele Gäste auf einmal.": "Every minute guests come to the city and pick a hotel by rating and room price. Renovated beach hotels get more stars (breakfast from 3 stars), and a city festival brings many guests at once.",
  "Konzert": "Concert",
  "Lebensmittel für": "food worth",
  "Noch kein Hotel fertig.": "No hotel finished yet.",
  "Renovieren bringt Sterne, ab 3 Sternen gibt es Frühstück": "renovating adds stars, breakfast from 3 stars",
  "Renoviert": "Renovated",
  "Restzeit": "time left",
  "Stadtfest veranstalten": "Host a city festival",
  "Sterne": "stars",
  "Sterne renovieren": "stars — renovate",
  "Strandfest": "Beach party",
  "Touristik-Panel öffnen": "Open tourism panel",
  "Zimmer je Minute": "rooms per minute",
  "Zimmerpreis": "Room price",
  "Zimmerpreis $ je Gast": "Room price $ per guest",
  "Zimmerpreis, Gäste, Stadtfeste": "Room price, guests, city festivals",
  "am meisten ein, solange genug Zimmer da sind. Zu teuer: Gäste fahren woanders hin.": "earns the most while you have enough rooms. Too expensive: guests go elsewhere.",
  "fest 1 Stern": "fixed 1 star",
  "finden kein Zimmer": "find no room",
  "gerade läuft eins": "one is running",
  "im Bau": "under construction",
  "im Lager": "in stock",
  "in den Läden": "in shops",
  "je Minute": "per minute",
  "je Nacht": "per night",
  "kommen": "arrive",
  "lockt Gäste für alle Hotels, du bekommst mehr davon": "draws guests for all hotels, you get more of them",
  "mit Frühstück": "with breakfast",
  "nächstes in": "next in",
  "zu teuer — fahren woanders hin": "too expensive — go elsewhere",
  "übernachten": "stay overnight",
  "Markt": "Market", "Mein System": "My system", "Entwicklung": "Development", "Design": "Design", "Produkte": "Products",
  "Shop-System": "Shop system", "Bürger-App": "Citizen app", "Bürger-Apps": "Citizen apps", "Jobbörse": "Job board", "Jobbörsen": "Job boards", "Börsen-App": "Stock app", "Malprogramm": "Paint program",
  "fehlt": "missing", "Nutzer": "users", "Abos": "subscriptions", "verkauft": "sold", "EP-Vorrat": "EP stock", "ein Studio: 1 EP/s": "one studio: 1 EP/s",
  "Software für die Einwohner": "software for residents", "Software gegen Arbeitermangel": "software against labour shortage", "Ab Shop-System v": "From shop system v",
  "bis": "up to", "der Einwohner nutzen Apps": "of residents use apps", "Qualität": "quality",
  "Einwohner zahlen ein Abo je Minute. Sie wählen nach Qualität und Preis. Je Rechenzentrums-Stufe bedienst du": "Residents pay a subscription per minute and choose by quality and price. Each data-centre level serves",
  "Version": "Version", "Nutzer / Kapazität": "users / capacity", "würden sie nutzen": "would use it", "Einnahmen 10 min": "income 10 min",
  "Nutzer finden keinen Platz — ein weiteres Rechenzentrum oder ein Ausbau hilft.": "users find no room — another data centre or an upgrade helps.",
  "Name": "Name", "Abo $ je Nutzer und Minute": "Subscription $ per user and minute", "Übernehmen": "Apply", "Bürger-App anlegen": "Create citizen app",
  "in Arbeit": "in progress", "entwickeln": "develop", "Voll ausgebaut": "Fully developed", "Vorrang wie": "priority like", "Lohnstufen": "wage levels",
  "Firmen abonnieren sie und bekommen bei knappen Arbeitern Vorrang. Sie zahlen dir eine Gebühr je beschäftigtem Arbeiter und Minute. Für dich selbst wirkt sie kostenlos. Je Rechenzentrums-Stufe": "Companies subscribe and get priority when workers are scarce. They pay you a fee per employed worker and minute. For you it works for free. Per data-centre level",
  "Abos / Plätze": "subscriptions / slots", "Vorrang": "priority", "Gebühr $ je Arbeiter und Minute": "Fee $ per worker and minute", "Jobbörse anlegen": "Create job board",
  "Bürger-Apps der Stadt": "Citizen apps in the city", "von": "of", "Einwohnern nutzen eine": "residents use one",
  "Noch keine Bürger-App fertig — Software-Firmen entwickeln sie im Reiter „Produkte“.": "No citizen app yet — software companies develop them in the “Products” tab.",
  "Vorrang bei knappen Arbeitern": "priority when workers are scarce", "deine": "yours", "Kündigen": "Cancel", "Abonnieren": "Subscribe", "Noch keine Jobbörse fertig.": "No job board yet.",
  "eigene": "own", "Vorrang ohne höheren Lohn": "priority without higher wages", "kein Abo": "no subscription", "kündigen": "cancel",
  "ab der Hälfte der Einwohner: Digitale Stadt +5 %": "from half the residents: digital city +5 %", "Digitale Stadt": "Digital city",
  "Bürger-App gespeichert": "Citizen app saved", "Jobbörse gespeichert": "Job board saved", "Entwicklung gestartet": "Development started",
  "Erst brauchst du ein eigenes Shop-System — lege es im Reiter „Mein System“ an.": "First you need your own shop system — create it in the “My system” tab.",
  "Glas-Effekt": "Glass effect", "Unschärfe hinter Leisten und Fenstern — kostet viel Grafikleistung": "Blur behind bars and windows — costs a lot of graphics power",
  "Automatisch anpassen": "Adjust automatically", "Ruckelt das Spiel, schaltet es die Grafik stufenweise herunter": "If the game stutters, graphics are lowered step by step",
  "Bildrate anzeigen": "Show frame rate", "Kleine Anzeige unten links: Bilder pro Sekunde": "Small display bottom left: frames per second",
  "— vorerst wird nur der Sandkasten gespielt": "— for now only sandbox is played", "Freies Wirtschaften mit wachsender Stadt": "Free economy with a growing city",
  "Planwirtschaft · gesperrt": "Planned economy · locked", "Einsteiger · gesperrt": "Beginner · locked", "Race Day · gesperrt": "Race Day · locked", "Kartell · gesperrt": "Cartel · locked",
  "Zeitlimit": "Time limit", "kein Zeitlimit": "no time limit", "30 Minuten": "30 minutes", "45 Minuten": "45 minutes", "60 Minuten": "60 minutes", "90 Minuten": "90 minutes",
  "$100.000 · etwa 30–40 Minuten": "$100,000 · about 30–40 minutes", "$250.000 · etwa 1 Stunde": "$250,000 · about 1 hour", "$500.000 · etwa 2 Stunden": "$500,000 · about 2 hours",
  "Die Stadt wächst mit": "The city grows with you", "Stadtübersicht": "City overview", "Dir fehlen Arbeiter": "You are short of workers", "Firma-Panel": "Company panel",
  "Oben neben deinem Geld steht, wie viele Einwohner die Stadt hat. Sie wohnen im Wohngebiet, arbeiten in euren Gebäuden und kaufen in euren Läden. Ein Klick auf die Einwohnerzahl öffnet die Stadtübersicht.": "Next to your money at the top you see how many residents the city has. They live in the residential ring, work in your buildings and buy in your shops. Click the population for the city overview.",
  "Deine Gebäude sind nicht voll besetzt und stellen weniger her. Ein höherer Lohn holt Leute von anderen Firmen — günstiger ist oft eine Jobbörse. Beides findest du im Firma-Panel.": "Your buildings are not fully staffed and produce less. Higher wages draw people from other companies — a job board is often cheaper. Both are in the company panel.",
  "Jede Minute zahlst du deinen Arbeitern Lohn. 30 % davon gehen als Steuer und Miete an die Stadt — damit baut sie neue Wohnungen, und es ziehen mehr Leute zu.": "Every minute you pay your workers. 30 % goes to the city as tax and rent — it builds new homes with that, and more people move in.",
  "Die Stadt kauft Baumaterial": "The city buys building materials",
  "Für neue Wohnblöcke bestellt die Stadt Ziegel, Beton, Stahl oder Elektronik und zahlt 15 % über Kurs. Liefern kannst du in der Stadtübersicht.": "For new housing the city orders bricks, concrete, steel or electronics and pays 15 % above market. Deliver in the city overview.",
  "Der Stadt fehlt etwas": "The city is missing something",
  "In keinem Online-Marktplatz gibt es gerade Strom, Wasser oder Lebensmittel. Dann ziehen weniger Leute zu. Wer das ins Regal stellt, hat sichere Kundschaft.": "No online marketplace currently sells power, water or food. Fewer people move in then. Whoever stocks it has guaranteed customers.",
  "Das Finanzamt": "The tax office", "Finanzamt": "Tax office",
  "Alle 10 Minuten zahlst du Gewinnsteuer. Bauen und Ausbauen senken den Gewinn nach und nach (Abschreibung). Die Steuer geht an die Stadt.": "Every 10 minutes you pay profit tax. Building and upgrading lower your profit over time (depreciation). The tax goes to the city.",
  "Die Stadt leiht sich Geld": "The city borrows money", "Stadtbank": "City bank",
  "Für neue Wohnungen gibt die Stadt eine Anleihe aus. Wer sie zeichnet, bekommt jede Minute Zinsen und das Geld nach 15 Minuten zurück — zu finden an der Stadtbank.": "For new homes the city issues a bond. Whoever buys it gets interest every minute and the money back after 15 minutes — at the city bank.",
  "Dein Software-Panel": "Your software panel", "Software": "Software",
  "Als Software-Firma baust du Shop-Systeme, Bürger-Apps und Jobbörsen für die anderen. Alles liegt im Software-Panel in Reitern: Markt, Mein System, Entwicklung, Design und Produkte.": "As a software company you build shop systems, citizen apps and job boards for the others. Everything is in the software panel's tabs: Market, My system, Development, Design and Products.",
  "Aktien und Übernahmen": "Shares and takeovers",
  "Jede Firma hat 100 Aktien. An der Stadtbank kaufst du Anteile anderer Firmen und kassierst Dividende — oder übernimmst eine Firma ganz. Behalte die Mehrheit an deiner eigenen.": "Every company has 100 shares. At the city bank you buy stakes in other companies and collect dividends — or take one over. Keep the majority of your own.",
  "Auf dem Weg zum Ziel": "On the way to the goal",
  "Es gewinnt, wer zuerst das Vermögensziel erreicht (oben links). Vermögen sind Geld, Lager, Gebäude und Beteiligungen — Ausbauen lohnt sich also, auch wenn dabei Geld aus der Kasse geht.": "Whoever first reaches the net-worth goal wins (top left). Net worth is cash, stock, buildings and holdings — so upgrading pays off even though cash goes down.",
  "Verstanden": "Got it", "Keine Hinweise mehr": "No more hints", "Schließen": "Close", "Hinweise im Spiel": "In-game hints",
  "Kurze Erklärung, wenn ein System zum ersten Mal wichtig wird": "Short explanation when a system first matters",
  "Grafik automatisch reduziert": "Graphics reduced automatically", "Glas-Effekt aus": "glass effect off", "Auflösung 75 %": "resolution 75 %",
  "Wolken aus": "clouds off", "animierter Hintergrund aus": "animated background off", "Auflösung 50 %": "resolution 50 %",
  "Ändern unter Einstellungen → Grafik.": "Change under Settings → Graphics.",
  "Nachfrage in den Läden": "Demand in shops", "wächst mit der Einwohnerzahl": "grows with the population", "Einw.": "res.",
  "der Verkäufer gibt sie vom Erlös ans Finanzamt ab": "the seller pays it from sale proceeds to the tax office",
  /* Website-Generator und Software-Cockpit */
  "Website-Generator": "Website generator",
  "Website für": "Website for",
  "Honorar": "Fee",
  "Mehr Abschnitte (bis 4), ein Slogan und ein Text „Über uns“ heben die Qualität — und damit die Reichweite deines Kunden.": "More sections (up to 4), a slogan and an “About us” text raise the quality — and with it your client's reach.",
  "Vorlage": "Template",
  "Klar": "Clean",
  "Elegant": "Elegant",
  "Bunt": "Colourful",
  "Farbe": "Colour",
  "Titel": "Title",
  "Slogan": "Slogan",
  "z. B. Frisch vom Hof in die Stadt": "e.g. Fresh from the farm to the city",
  "Abschnitte": "Sections",
  "nach oben": "move up",
  "nach unten": "move down",
  "entfernen": "remove",
  "Noch kein Abschnitt — füg unten einen hinzu.": "No section yet — add one below.",
  "Über uns": "About us",
  "Wer seid ihr, was macht euch besonders?": "Who are you, what makes you special?",
  "Website ausliefern": "Deliver website",
  "Änderungen veröffentlichen": "Publish changes",
  "Website ausgeliefert": "Website delivered",
  "Betriebe": "Facilities",
  "Direktkauf": "Direct purchase",
  "Bewertungen": "Reviews",
  "Aktie": "Share",
  "Galerie": "Gallery",
  "Waren mit Ø-Kurs und Link zum Shop": "Goods with average price and shop link",
  "Alle Gebäude der Firma": "All of the company's buildings",
  "Hofladen, Großhandel … (ab Branchenportal)": "Farm shop, wholesale … (from industry portal)",
  "Stimmen von Kunden": "What customers say",
  "Eigener Text über die Firma": "Your own text about the company",
  "Kurs und Verlauf der Aktie": "Share price and chart",
  "Große Bilder der Gebäude": "Large pictures of the buildings",
  "Unsere Aktie": "Our share",
  "An der Stadtbank": "At the city bank",
  "Hier steht der Text über die Firma.": "The text about the company goes here.",
  "Erscheint, sobald die Firma das Modul „Branchenportal“ hat.": "Appears once the company has the “Industry portal” module.",
  "gestaltet diese Website gerade": "is designing this website right now",
  "Diese Website wird gerade gestaltet": "This website is being designed right now",
  "Übersicht": "Overview",
  "Kunden gesamt": "Total customers",
  "keine Entwicklung": "no development",
  "keins": "none",
  "Strom": "power",
  "Website-Aufträge": "Website orders",
  "noch kein Website-Baukasten": "no website builder yet",
  "Gestalten": "Design",
  "Website überarbeiten": "Revise website",
  "Läuft die Frist ab, geht die Standard-Vorlage online und du bekommst nur das halbe Honorar.": "If the deadline passes, the standard template goes online and you only get half the fee.",
  "Gerade kein offener Auftrag. Neue Bestellungen erscheinen hier — mit Frist und Honorar.": "No open order right now. New orders appear here — with deadline and fee.",
  "Mit einem Website-Baukasten (auf deiner Statusseite) bestellen Firmen bei dir Websites, die du selbst gestaltest.": "With a website builder (on your status page), companies order websites from you that you design yourself.",
  "noch nicht": "not yet",
  "anlegen →": "create →",
  "später": "later",
  "Was jetzt?": "What now?",
  "Meine Statusseite": "My status page",
  "Leg dein Shop-System an — damit fängt alles an.": "Create your shop system — that's where it all starts.",
  "Bau ein Rechenzentrum: Ohne Plätze kann niemand dein System, deine App oder Websites nutzen.": "Build a data center: without slots nobody can use your system, your app or websites.",
  "Fällt er aus, gehen alle Kunden offline.": "If it runs out, all customers go offline.",
  "Firma wartet auf ihre Website.": "company is waiting for its website.",
  "Firmen warten auf ihre Website.": "companies are waiting for their website.",
  "Dein Shop-System ist voll — mehr Plätze gibt es mit einem Rechenzentrums-Ausbau.": "Your shop system is full — upgrade a data center for more slots.",
  "Gerade läuft keine Entwicklung — deine EP sammeln sich nur an.": "No development running — your DP are just piling up.",
  "Leg einen Website-Baukasten an: Firmen bestellen Websites, du gestaltest sie und kassierst das Honorar.": "Create a website builder: companies order websites, you design them and collect the fee.",
  "wird gestaltet": "being designed",
  "Überrasch mich": "Surprise me", "Feinschliff": "Fine-tuning", "Schrift, Kopf, Ecken, Muster": "font, header, corners, pattern", "Schrift": "Font", "Kopf": "Header", "Ecken": "Corners", "Muster": "Pattern",
  "Dunkel": "Dark", "Retro": "Retro", "Natur": "Nature", "Modern": "Modern", "Serif": "Serif", "Rund": "Round", "Kraftvoll": "Bold", "Handschrift": "Handwriting", "Pixel": "Pixel",
  "Verlauf": "Gradient", "Flach": "Flat", "Zentriert": "Centered", "Groß": "Large", "Eckig": "Square", "Normal": "Normal", "Ohne": "None", "Punkte": "Dots", "Streifen": "Stripes", "Wellen": "Waves", "Raster": "Grid",
  "Zahlen": "Numbers", "Team": "Team", "Kontakt": "Contact", "Fragen": "FAQ", "Neuigkeiten": "News", "In Zahlen": "In numbers", "Unser Team": "Our team", "Häufige Fragen": "Frequently asked questions",
  "Adresse": "Address", "Öffnungszeiten": "Opening hours", "E-Mail": "Email", "Block": "Block", "Noch keine Meldungen.": "No news yet.", "Aktienkurs": "Share price", "Waren": "Goods",
  "Große Kennzahlen: Betriebe, Waren, Besucher": "Big numbers: facilities, goods, visitors", "Die Menschen hinter der Firma": "The people behind the company", "Adresse, Öffnungszeiten, E-Mail": "Address, opening hours, email",
  "Häufige Fragen zum Aufklappen": "Expandable FAQ", "Meldungen aus dem Stadtkurier": "Reports from the City Courier",
  "Liefert ihr in die ganze Stadt?": "Do you deliver across the whole city?", "Ja — über den Markt und unseren Online-Shop erreichen wir jeden Block.": "Yes — through the market and our online shop we reach every block.",
  "Wie kommen die Preise zustande?": "How are prices set?", "Wir orientieren uns am Ø-Kurs der Börse und geben gute Ernten und Großaufträge weiter.": "We follow the average exchange price and pass on good harvests and big orders.",
  "Kann man bei euch Aktien kaufen?": "Can I buy your shares?", "Ja, an der Stadtbank. Bei Gewinn schütten wir regelmäßig aus.": "Yes, at the city bank. When we make a profit we pay dividends regularly.",
  "Hofleitung": "Farm management", "Ernte & Lager": "Harvest & storage", "Hofladen": "Farm shop", "Bauleitung": "Site management", "Steinbruch": "Quarry", "Logistik": "Logistics", "Netzleitung": "Grid control", "Kraftwerk": "Power plant", "Kundendienst": "Customer service",
  "Geschäftsführung": "Management", "Fertigung": "Production", "Vertrieb": "Sales", "Direktion": "Management", "Rezeption": "Reception", "Küche": "Kitchen", "Gründung": "Founders", "Entwicklung": "Development", "Support": "Support", "Behörden": "Government relations",
  "Mo–Sa 6–18 Uhr": "Mon–Sat 6am–6pm", "Mo–Fr 7–17 Uhr": "Mon–Fri 7am–5pm", "rund um die Uhr": "around the clock", "Mo–Fr 8–18 Uhr": "Mon–Fri 8am–6pm", "Rezeption 24 h": "Reception 24 h", "Mo–Fr 9–19 Uhr": "Mon–Fri 9am–7pm", "nach Vereinbarung": "by appointment", "Mo–Fr 9–17 Uhr": "Mon–Fri 9am–5pm",
  "Die Website ist gerade offline — dem Rechenzentrum des Anbieters fehlt Strom oder Platz.": "The website is offline right now — the provider's data center lacks power or space.",
  "Die Software-Firma gestaltet deine Startseite individuell — Vorlage, Farben, Abschnitte. Die Einrichtung bekommt sie erst bei Lieferung.": "The software company designs your homepage individually — template, colours, sections. It only receives the setup fee on delivery."
};
const t = de => SPRACHE === "en" ? (EN[de] ?? de) : de;
/* Gleiche Funktion unter anderem Namen — für Stellen, an denen eine Kachel-
 * Variable `t` die Übersetzung verdeckt (Gebäudekarte). */
const tUe = t;
/* Feste Beschriftungen im Markup übersetzen. Sie stehen als deutscher Text
 * zwischen den Tags — genau die Form, die auch als Schlüssel dient. Ein Lauf
 * über die Textknoten spart es, 166 Stellen einzeln mit einem Attribut zu
 * versehen; der ursprüngliche Wortlaut wird gemerkt, damit das Zurückschalten
 * nicht aus dem Englischen zurückübersetzen muss. */
const urText = new WeakMap();
function seiteUebersetzen() {
  const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const knoten = [];
  while (lauf.nextNode()) knoten.push(lauf.currentNode);
  for (const n of knoten) {
    const eltern = n.parentElement;
    if (!eltern || eltern.closest("script,style")) continue;
    if (!urText.has(n)) {
      const roh = n.nodeValue.trim().replace(/\s+/g, " ");
      if (!roh || !(roh in EN)) continue;      // nur bekannte Beschriftungen anfassen
      urText.set(n, n.nodeValue);
    }
    const ur = urText.get(n), roh = ur.trim().replace(/\s+/g, " ");
    n.nodeValue = SPRACHE === "en" && EN[roh] ? ur.replace(ur.trim(), EN[roh]) : ur;
  }
  /* Auch Kurzhinweise und Platzhalter — sie sind oft das Einzige, was eine
   * Schaltfläche mit Symbol überhaupt erklärt. */
  for (const el of document.querySelectorAll("[title],[placeholder],[aria-label]")) {
    for (const attr of ["title", "placeholder", "aria-label"]) {
      const wert = el.getAttribute(attr);
      if (wert == null) continue;
      const schluessel = attr + ":" + wert;
      if (!urText.has(el)) urText.set(el, {});
      const merk = urText.get(el);
      if (typeof merk !== "object") continue;
      if (!(attr in merk)) { if (!(wert in EN)) continue; merk[attr] = wert; }
      el.setAttribute(attr, SPRACHE === "en" ? (EN[merk[attr]] ?? merk[attr]) : merk[attr]);
    }
  }
}
function spracheSetzen(neu) {
  SPRACHE = neu;
  try { localStorage.setItem("cs_lang", neu); } catch {}
  document.documentElement.lang = neu;
  document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === neu));
  seiteUebersetzen();
  const st = store.get();
  /* Die Warenlisten der Auswahlfelder entstehen einmal beim Beitritt. Ohne
   * Neuaufbau bleiben sie in der Sprache von damals — im Kursband stand
   * "Electricity", im Orderformular daneben weiter "Strom". */
  if (st.meta?.goods) { try { initSelects(); } catch {} }
  window.lernbuchNeuZeichnen?.();
  if (st.state && st.me) render(st);      // dynamische Panels neu aufbauen
}

const gname = g => { const w = GOODS()[g]; return (SPRACHE === "en" ? w?.en : w?.name) ?? w?.name ?? g; };
const bname = b => { const x = BTYPES()[b]; return (SPRACHE === "en" ? x?.en : x?.name) ?? x?.name ?? b; };
const catname = g => { const w = GOODS()[g]; return (SPRACHE === "en" ? w?.catEn : w?.cat) ?? w?.cat ?? ""; };
const iname = i => { const x = store.get().meta?.industries?.[i]; return (SPRACHE === "en" ? x?.en : x?.name) ?? x?.name ?? i; };

/* ---- Join / Lobby ---- */
const COLORS = ["#38bdf8","#a78bfa","#34d399","#fb7185","#fbbf24","#f97316","#e879f9","#64748b"];
let myColor = COLORS[0];
const jc = document.getElementById("jcolors");
COLORS.forEach((c, i) => { const b = document.createElement("button"); b.style.background = c;
  if (!i) b.classList.add("on");
  b.addEventListener("click", () => { myColor = c; jc.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); });
  jc.append(b); });
let myIndustry = "agrar";
/* Die Branche wird nicht mehr am Startbildschirm gewaehlt, sondern im
 * Warteraum — dort sehen alle, wer was nimmt, und koennen sich absprechen,
 * bevor es losgeht. Statt das Markup zu doppeln, wandert der vorhandene Block
 * beim Laden hinueber: Stile und Klick-Logik bleiben damit unveraendert. */
(() => {
  const block = document.getElementById("jind");
  const slot = document.getElementById("lwBrancheSlot");
  if (!block || !slot) return;
  const spalte = block.closest(".col"), trenner = spalte?.previousElementSibling;
  slot.append(block);
  /* Die Karte war zweispaltig, rechts stand die Branchenwahl. Ohne sie blieben
   * eine leere Spalte und die Trennlinie stehen — beides weg, und der Rumpf
   * wird einspaltig, sonst klafft rechts die halbe Karte leer. */
  if (spalte && !spalte.children.length) {
    trenner?.classList.contains("divider") && trenner.remove();
    spalte.remove();
    const rumpf = document.querySelector("#join .body");
    if (rumpf) rumpf.style.gridTemplateColumns = "1fr";
  }
})();
document.querySelectorAll(".indopt:not(.netopt)").forEach(b => b.addEventListener("click", () => {
  myIndustry = b.dataset.ind;
  document.querySelectorAll(".indopt:not(.netopt)").forEach(x => x.classList.toggle("on", x === b));
  /* Im Warteraum ist man bereits angemeldet — der Wechsel muss zum Server. */
  if (store.get().state && !store.get().state.started)
    socket.emit("brancheWaehlen", { industry: myIndustry },
      res => { if (res?.error) toast(res.error, true); });
}));
/* Host vs. Beitreten-per-Code umschalten */
let netMode = "host", remoteConn = null;
document.querySelectorAll(".netopt").forEach(b => b.addEventListener("click", () => {
  netMode = b.dataset.net;
  document.querySelectorAll(".netopt").forEach(x => x.classList.toggle("on", x === b));
  document.getElementById("invite").style.display = netMode === "host" ? "" : "none";
  document.getElementById("joinCodeRow").style.display = netMode === "join" ? "" : "none";
  /* Der Schalter gilt nur beim Erstellen und nur mit Gateway — ohne Gateway
   * gibt es gar keine Rundenliste, in der etwas oeffentlich sein koennte. */
  document.getElementById("oeffentlichRow").style.display =
    (netMode === "host" && MULTIROOM) ? "" : "none";
  if (netMode === "join" && MULTIROOM) oeffentlicheLaden();
  /* Kurz halten — die Beschriftung steht jetzt in Versalien im Feldkopf */
  document.getElementById("netstep").textContent = netMode === "join" ? "Runde beitreten" : "Mitspieler einladen";
  /* Beim Beitreten wird die eigene Vermittlung abgebaut (man hostet ja nicht).
   * Schaltet man zurück, muss sie neu aufgebaut werden — sonst bleibt das
   * Code-Feld auf dem alten, längst ungültigen Wert stehen. Im Gateway-Modus
   * gibt es gar keine WebRTC-Vermittlung — dort zeigt die Box stattdessen den
   * vom Gateway vergebenen Rundencode (siehe renderInviteMultiroom). */
  if (MULTIROOM) renderInviteMultiroom();
  else if (netMode === "host" && (!hostPeer || hostPeer.destroyed)) { hostVersuch = 0; startHosting(); }
  document.getElementById("jgo").textContent = netMode === "join" ? "Runde beitreten" : "Runde erstellen";
  document.getElementById("foothint").textContent = netMode === "join"
    ? "Ziel und Bots legt der Host der Runde fest."
    : "Ziel und Bots stellst du gleich im Warteraum ein.";
}));
/* Auf dem Startbildschirm bleibt es still: Die Kulisse gehoert zur Stadt, nicht
 * zum Formular davor. Sie setzt erst mit dem Betreten der Runde ein — der Klick
 * auf "Runde erstellen" ist zugleich die Nutzergeste, welche die Autoplay-Sperre
 * der Browser verlangt. */
/* Session-Token: übersteht Tab-Reload/WLAN-Aussetzer — beim nächsten Laden wird
 * automatisch versucht, nahtlos an den bestehenden Spielstand anzuknüpfen. */
const TOKEN_KEY = "capitalSandboxToken";
function enterGame(res) {
  store.set({ meta: res, myId: res.you });
  document.getElementById("join").style.display = "none";
  initSelects();
  MUSIC.start();
  updateRoomCodeTop();
}
/* Der Rundencode wird sonst nur auf dem Join-Screen gezeigt — sobald man den
 * einmal verlassen hat, gibt es keine Möglichkeit mehr, weitere Mitspieler
 * einzuladen. Diese Kopfzeilen-Schaltfläche hält ihn während der ganzen
 * Runde erreichbar. */
function updateRoomCodeTop() {
  const btn = document.getElementById("roomCodeTop");
  if (!btn) return;
  if (!MULTIROOM || !myRoomCode) { btn.style.display = "none"; return; }
  btn.style.display = "";
  btn.textContent = myRoomCode;
}
document.getElementById("roomCodeTop").addEventListener("click", async () => {
  const btn = document.getElementById("roomCodeTop");
  if (!myRoomCode) return;
  try { await navigator.clipboard.writeText(myRoomCode); } catch {}
  const orig = myRoomCode;
  btn.textContent = "Kopiert";
  setTimeout(() => { btn.textContent = orig; }, 1600);
});

/* ---------- Warteraum ----------
 * Zwischen Anmeldung und Rundenstart: alle sehen, wer schon da ist, der Host
 * stellt Ziel und Bots ein und startet die Runde, wenn es losgehen soll. */
const lwEl = document.getElementById("lobbyWait");
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let lwBotLevel = "mittel", lwBots = { agrar: 1, rohstoff: 1, versorger: 1, tech: 1, touristik: 1, ruestung: 1, software: 1 };
let lwEigeneAenderung = 0;   // kurz nach eigener Änderung nicht vom Server überschreiben lassen

/* Kurznamen der Branchen fuer die Warteraumliste — die vollen Namen aus dem
 * Auswahlblock waeren dort zu lang. */
const BRANCHE_NAME = { agrar: "Landwirtschaft", rohstoff: "Rohstoff & Bau", versorger: "Versorger",
                       tech: "Technologie", touristik: "Touristik", ruestung: "Rüstung", software: "Software",
                       rennclub: "Race Club", rennindustrie: "Rennindustrie" };
function lobbyWaitZeichnen() {
  const { state, myId } = store.get();
  if (!state || !myId) return;
  if (state.started) { lwEl.classList.remove("on"); return; }
  lwEl.classList.add("on");

  const istHost = state.hostId === myId;
  document.getElementById("lwCodeBox").style.display = (MULTIROOM && myRoomCode) ? "" : "none";
  document.getElementById("lwCode").textContent = myRoomCode || "—";

  const spieler = Object.values(state.players || {});
  /* Kartellmodus für Gäste am Server-Stand erkennen, beim Host an der
   * eigenen (sofort gespiegelten) Auswahl. */
  /* Der Server-Stand ist die Wahrheit — die lokale Host-Variable ist nach
   * einem Reload wieder auf dem Standard und würde hier lügen. */
  const kartellAktiv = (state.lobby?.mode || lwMode) === "kartell";
  const FAM_LOBBY = { famiglia: ["La Famiglia", "#e74c3c"], syndikat: ["Das Syndikat", "#a78bfa"],
    bratwa: ["Die Bratwa", "#f5c542"], triade: ["Die Triade", "#2ecc71"], polizei: ["🚔 Polizei", "#4a90d9"] };
  document.getElementById("lwFamilieRow").style.display = kartellAktiv ? "" : "none";
  document.getElementById("lwFamilieHint").style.display = kartellAktiv ? "" : "none";
  /* Im Kartell gibt es keine Branchen — jeder baut alles. Die Box verschwindet
   * komplett, die Familienwahl ist die einzige Entscheidung. */
  const brancheBox = document.getElementById("lwBrancheBox");
  if (brancheBox) brancheBox.style.display = kartellAktiv ? "none" : "";
  if (kartellAktiv) {
    document.querySelectorAll("#lwFamilie button").forEach(b => {
      const fid = b.dataset.familie;
      const n = spieler.filter(p2 => p2.familie === fid).length;
      b.textContent = `${FAM_LOBBY[fid]?.[0] || fid} · ${n}/2`;
      b.classList.toggle("on", state.players?.[myId]?.familie === fid);
    });
  }
  document.getElementById("lwCount").textContent = spieler.length;
  document.getElementById("lwPlayers").innerHTML = spieler.map(p => `
    <div class="pl">
      <span class="dot" style="background:${p.color};color:${p.color}"></span>
      <span>${escapeHtml(rohText(p.name))}</span>
      ${p.id === state.hostId ? '<span class="tag">Host</span>' : ""}
      ${p.id === myId ? '<span class="tag">du</span>' : ""}
      <!-- Im Kartell zählt die Familie, sonst die Branche — man sieht, was
           besetzt ist, und kann sich absprechen. -->
      <span class="tag" style="margin-left:auto${kartellAktiv && p.familie ? `;color:${FAM_LOBBY[p.familie]?.[1]}` : ""}">${
        kartellAktiv ? escapeHtml(FAM_LOBBY[p.familie]?.[0] || "wählt noch…")
                     : escapeHtml(BRANCHE_NAME[p.industry] || p.industry || "—")}</span>
    </div>`).join("") || '<div class="leer">Noch niemand da.</div>';

  /* Solange man allein wartet, ist das Teilen des Codes der nächste Schritt —
   * das soll der Screen auch sagen, statt neutral "wartet" anzuzeigen. */
  const allein = spieler.length <= 1;
  document.getElementById("lwPulseText").textContent =
    allein ? "wartet auf Mitspieler" : `${spieler.length} bereit`;
  document.getElementById("lwSub").textContent = istHost
    ? (allein && MULTIROOM
        ? "Schick deinen Mitspielern den Code — oder starte allein gegen die Bots."
        : "Du bist Host: stell ein, was du willst, und starte, wenn alle da sind.")
    : "Sobald alle da sind, startet der Host die Runde.";

  document.getElementById("lwSettings").classList.toggle("hide", !istHost);
  document.getElementById("lwStart").style.display = istHost ? "" : "none";
  document.getElementById("lwHint").textContent = istHost
    ? "Mit dem Start laufen Produktion und Bots an — die Einstellungen sind dann fest."
    : "Der Host startet die Runde, sobald alle da sind.";

  /* Nicht-Host sieht die Einstellungen des Hosts live mitlaufen; beim Host
   * selbst würde ein Überschreiben kurz nach dem eigenen Klick zurückspringen. */
  if (state.lobby && Date.now() - lwEigeneAenderung > 1500) {
    document.getElementById("lwGoal").value = String(state.lobby.winGoal);
    if (state.lobby.zeitLimit != null) document.getElementById("lwZeit").value = String(state.lobby.zeitLimit);
    if (state.lobby.botLevel) lwBotLevel = state.lobby.botLevel;
    if (state.lobby.bots) lwBots = { ...lwBots, ...state.lobby.bots };
    if (state.lobby.mode) { lwMode = state.lobby.mode; lwModeSpiegeln(); }
    lwPickerSpiegeln();
  }
}
const LW_LEVEL_TEXT = {
  einfach: "bauen gemächlich, halten sich an der Börse zurück",
  mittel:  "bauen zügig aus, leveln Gebäude auf, bieten bei Auktionen mit",
  schwer:  "expandieren aggressiv, unterbieten dich und kaufen Anteile auf",
};
function lwPickerSpiegeln() {
  document.querySelectorAll("#lwBotLevel button").forEach(b =>
    b.classList.toggle("on", b.dataset.lvl === lwBotLevel));
  document.querySelectorAll("#lwBotCounts .botrow").forEach(row => {
    const n = lwBots[row.dataset.b] ?? 1;
    row.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.n === n));
  });
  /* Die vier Zahlenreihen allein sagen nicht, worauf man sich einlässt —
   * diese Zeile fasst Anzahl und Spielweise in einem Satz zusammen. */
  const summe = Object.values(lwBots).reduce((a, b) => a + b, 0);
  /* Im Renntag gibt es die sechs Branchen nicht — dort zaehlt nur, wie viele
   * Bots mitspielen; die Rollen verteilt der Server abwechselnd. Ohne diesen
   * Hinweis stellt man Agrar und Touristik ein und bekommt Rennstaelle. */
  document.getElementById("lwBotSum").innerHTML = summe === 0
    ? "<b>Keine Bots</b> · ihr spielt die Runde nur untereinander"
    : lwMode === "renntag"
      ? `<b>${summe} ${summe === 1 ? "Bot" : "Bots"}</b> · ${LW_LEVEL_TEXT[lwBotLevel] || ""} — im Race Day zählt nur die Anzahl: der Server besetzt abwechselnd Race Clubs und Rennindustrie`
      : `<b>${summe} ${summe === 1 ? "Bot" : "Bots"}</b> · ${LW_LEVEL_TEXT[lwBotLevel] || ""}`;
}
function lwSettingsSenden() {
  lwEigeneAenderung = Date.now();
  socket.emit("lobbySettings", {
    winGoal: +document.getElementById("lwGoal").value,
    zeitLimit: +document.getElementById("lwZeit").value,
    saison: +document.getElementById("lwSaison").value,
    bots: lwBots, botLevel: lwBotLevel, mode: lwMode,
  });
}
document.getElementById("lwGoal").addEventListener("change", lwSettingsSenden);
document.getElementById("lwZeit").addEventListener("change", lwSettingsSenden);
document.getElementById("lwSaison").addEventListener("change", lwSettingsSenden);
let lwMode = "sandbox";
function lwModeSpiegeln() {
  document.querySelectorAll("#lwMode button").forEach(b => b.classList.toggle("on", b.dataset.mode === lwMode));
  /* In der Planwirtschaft gibt es kein Vermögensziel — die Zeile ausblenden. */
  document.getElementById("lwGoalRow").style.display =
    (lwMode === "plan" || lwMode === "einsteiger" || lwMode === "renntag") ? "none" : "";
  document.getElementById("lwModeHint").style.display = lwMode === "plan" ? "" : "none";
  document.getElementById("lwEinsteigerHint").style.display = lwMode === "einsteiger" ? "" : "none";
  document.getElementById("lwRenntagHint").style.display = lwMode === "renntag" ? "" : "none";
  /* Die Kartellwirtschaft behält das Vermögensziel — hier wird nur erklärt,
   * was zusätzlich erlaubt ist. */
  document.getElementById("lwKartellHint").style.display = lwMode === "kartell" ? "" : "none";
  document.getElementById("lwFamilieRow").style.display = lwMode === "kartell" ? "" : "none";
  document.getElementById("lwFamilieHint").style.display = lwMode === "kartell" ? "" : "none";
  /* Im Renntag entscheidet die Meisterschaft — das Vermoegensziel waere dort
   * eine Angabe ohne Wirkung. */
  document.getElementById("lwSaisonRow").style.display = lwMode === "renntag" ? "" : "none";
  /* Im Renntag gibt es keine Branchen, sondern zwei Rollen. Beim Umschalten
   * auch die Auswahl mitziehen — sonst bliebe man mit einer Branche zurueck,
   * die es im Modus gar nicht gibt. */
  const renn = lwMode === "renntag";
  document.querySelectorAll(".indopt.rennrolle").forEach(b => b.style.display = renn ? "" : "none");
  document.querySelectorAll(".indopt:not(.rennrolle):not(.netopt)").forEach(b => b.style.display = renn ? "none" : "");
  const gueltig = renn ? ["rennclub", "rennindustrie"].includes(myIndustry)
                       : !["rennclub", "rennindustrie"].includes(myIndustry);
  if (!gueltig) {
    const ziel = document.querySelector(`.indopt[data-ind="${renn ? "rennclub" : "agrar"}"]`);
    ziel?.click();
  }
}
document.getElementById("lwMode").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  lwMode = b.dataset.mode; lwModeSpiegeln(); lwSettingsSenden();
});
document.getElementById("lwBotLevel").addEventListener("click", e => {
  const b = e.target.closest("button[data-lvl]"); if (!b) return;
  lwBotLevel = b.dataset.lvl; lwPickerSpiegeln(); lwSettingsSenden();
});
/* Die Familienwahl gehört ALLEN Spielern, nicht nur dem Host: raus aus dem
 * (für Gäste versteckten) Settings-Block, direkt über die Einstellungen. */
{
  const s = document.getElementById("lwSettings");
  const row = document.getElementById("lwFamilieRow");
  const hint = document.getElementById("lwFamilieHint");
  if (s && row && hint) { s.parentNode.insertBefore(row, s); s.parentNode.insertBefore(hint, s); }
}
document.getElementById("lwFamilie").addEventListener("click", e => {
  const b = e.target.closest("button[data-familie]"); if (!b) return;
  socket.emit("familieWaehlen", { fid: b.dataset.familie }, res => {
    if (res?.error) { toast(res.error, true); return; }
    document.querySelectorAll("#lwFamilie button").forEach(o => o.classList.toggle("on", o === b));
  });
});
document.getElementById("lwBotCounts").addEventListener("click", e => {
  const b = e.target.closest("button[data-n]"); if (!b) return;
  lwBots[b.closest(".botrow").dataset.b] = +b.dataset.n;
  lwPickerSpiegeln(); lwSettingsSenden();
});
document.getElementById("lwCodeCopy").addEventListener("click", async () => {
  const btn = document.getElementById("lwCodeCopy");
  if (!myRoomCode) return;
  try { await navigator.clipboard.writeText(myRoomCode); } catch {}
  btn.textContent = "Kopiert"; btn.classList.add("done");
  setTimeout(() => { btn.textContent = "Kopieren"; btn.classList.remove("done"); }, 1600);
});
document.getElementById("lwStart").addEventListener("click", () => {
  const btn = document.getElementById("lwStart");
  btn.disabled = true; btn.textContent = "Startet …";
  socket.emit("startRound", {}, res => {
    btn.disabled = false; btn.textContent = "Runde starten";
    if (res?.error) toast(res.error, true);
  });
});
store.subscribe(lobbyWaitZeichnen);
function doRegister(name) {
  /* Ziel und Bots werden hier bewusst nicht mehr mitgeschickt: der Host stellt
   * beides im Warteraum ein, wo alle es live mitsehen. Der Server bleibt so
   * lange bei seinen Vorgaben. */
  socket.emit("register", { name, color: myColor, industry: myIndustry }, res => {
    if (res?.error) { document.getElementById("joinErr").textContent = res.error; return; }
    myToken = res.you;
    /* Im Gateway-Modus gehört zum Token auch der Rundencode — ohne den weiß ein
     * späteres attemptRejoin() nicht, mit welcher der vielen gleichzeitigen
     * Runden es sich überhaupt verbinden soll. */
    try { localStorage.setItem(TOKEN_KEY, MULTIROOM ? JSON.stringify({ code: myRoomCode, token: res.you }) : res.you); } catch {}
    enterGame(res);
    TUT = buildTut(res.industry || "agrar");   // Tutorial passend zur gewählten Industrie
    tutErstBeiRundenstart();
  });
}
/* Das Tutorial führt durchs Bauen — im Warteraum ginge das ins Leere, weil
 * noch nichts produziert wird. Also erst zeigen, wenn die Runde wirklich läuft. */
function tutErstBeiRundenstart() {
  /* Im Einsteiger-Modus fuehrt die lange Strecke durch das ganze Spiel statt
   * der kurzen Einfuehrung zur gewaehlten Branche.
   *
   * Dabei muss TUT_GESEHEN geleert werden: Die vier Lese-Schritte (Boerse,
   * Lager, Nachrichten, Finanzen) haken sich am Oeffnen des Panels ab. Ohne
   * Leeren traegt eine zweite Runde im selben Seitenaufruf die Panels der
   * ersten noch im Gedaechtnis — und ueberspringt vier von fuenfzehn
   * Schritten, ohne dass der Lernende sie je gesehen hat. */
  const vorbereiten = () => {
    TUT_GESEHEN.clear();
    if (store.get().state?.mode === "einsteiger") TUT = TUT_EINSTEIGER;
  };
  if (store.get().state?.started) { vorbereiten(); tutShow(0); return; }
  const ab = store.subscribe(() => {
    if (!store.get().state?.started) return;
    ab?.();
    vorbereiten();
    tutShow(0);
  });
}
/* Beim Laden automatisch versuchen, mit gespeichertem Token wieder beizutreten.
 * "Mit Code beitreten" (WebRTC/Legacy) ist immer ein bewusster, expliziter
 * Vorgang und lädt sich kein fremdes Token — im Gateway-Modus dagegen ist JEDE
 * Verbindung (ob Host oder Beitreten) eine ganz normale Socket.io-Verbindung
 * zur eigenen Runde, ein automatisches Wiederverbinden ist also für beide
 * gleichermaßen sinnvoll. Wartet erst auf multiroomReady, weil sich sonst
 * nicht entscheiden lässt, wie der gespeicherte Wert zu lesen ist (nackter
 * Token vs. {code,token}-Objekt). */
async function attemptRejoin() {
  await multiroomReady;
  let raw; try { raw = localStorage.getItem(TOKEN_KEY); } catch { raw = null; }
  if (!raw) return;
  let token = raw;
  if (MULTIROOM) {
    let code = null;
    try { ({ code, token } = JSON.parse(raw)); } catch { code = null; }
    if (!code || !token) { try { localStorage.removeItem(TOKEN_KEY); } catch {} return; }
    myRoomCode = code;
    connectToRoom(code);
    renderInviteMultiroom();
  }
  socket.emit("rejoin", { token }, res => {
    if (res?.error) { try { localStorage.removeItem(TOKEN_KEY); } catch {} return; }
    myToken = token;
    enterGame(res);
  });
}
attemptRejoin();
/* ---- Übungsrunde starten ----
 * Legt eine eigene Runde an, tritt ihr bei, startet sie sofort und schaltet
 * die geführten Schritte ein. Bewusst dieselben Wege wie beim normalen
 * Rundenstart — die Übungsrunde ist keine Attrappe, sondern eine echte Partie
 * mit Bots und laufendem Markt. */
async function uebungsrundeStarten() {
  const btn = document.getElementById("tutBuchAuf");
  const alterText = btn.textContent;
  btn.disabled = true; btn.textContent = "Runde wird vorbereitet …";
  const fehler = (m) => {
    btn.disabled = false; btn.textContent = alterText;
    toast(m || "Die Übungsrunde konnte nicht gestartet werden.", true);
  };
  try {
    await multiroomReady;
    myIndustry = "agrar";               // einfachste Branche für den Einstieg
    if (MULTIROOM) {
      const r = await fetch(api("/api/rooms"), { method: "POST" });
      const data = await r.json();
      if (!r.ok || data.error) return fehler(data.error);
      myRoomCode = data.code;
      connectToRoom(myRoomCode);
      renderInviteMultiroom();
    }
    socket.emit("register", { name: "Übungsfirma", color: myColor, industry: "agrar" }, res => {
      if (res?.error) return fehler(res.error);
      myToken = res.you;
      try { localStorage.setItem(TOKEN_KEY, MULTIROOM ? JSON.stringify({ code: myRoomCode, token: res.you }) : res.you); } catch {}
      enterGame(res);
      /* Direkt starten statt über den Warteraum: Hier wartet niemand auf
       * Mitspieler, und die geführten Schritte brauchen eine laufende Runde. */
      socket.emit("startRound", {}, r2 => {
        if (r2?.error) return fehler(r2.error);
        TUT = TUT_SPIEL;
        tutShow(0);
      });
    });
  } catch (e) { fehler(e.message); }
}

document.getElementById("jgo").addEventListener("click", async () => {
  const name = document.getElementById("jname").value.trim();
  document.getElementById("joinErr").textContent = "";
  await multiroomReady;

  if (MULTIROOM) {
    const jgoBtn = document.getElementById("jgo");
    if (netMode === "host") {
      /* Neue, komplett eigene Runde beim Gateway anfordern — das startet dort
       * einen frischen, isolierten server.js-Prozess und liefert den Code, mit
       * dem andere gezielt zu GENAU dieser Runde finden (statt zu irgendeiner). */
      jgoBtn.disabled = true;
      try {
        const r = await fetch(api("/api/rooms"), { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oeffentlich: document.getElementById("oeffentlich").checked }) });
        const data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error || "Runde konnte nicht erstellt werden.");
        myRoomCode = data.code;
        connectToRoom(myRoomCode);
        renderInviteMultiroom();
        doRegister(name);
      } catch (e) {
        document.getElementById("joinErr").textContent = e.message;
      } finally {
        jgoBtn.disabled = false;
      }
      return;
    }
    /* Beitreten: im Gateway-Modus einfach eine ganz normale Socket.io-Verbindung
     * zum Pfad der gewünschten Runde — kein WebRTC nötig, alle landen ja
     * ohnehin auf demselben öffentlichen Server. */
    const code = document.getElementById("jcode").value.trim().toUpperCase();
    if (!code) { document.getElementById("joinErr").textContent = "Bitte Rundencode eingeben"; return; }
    const status = document.getElementById("joinCodeStatus");
    status.textContent = "Verbinde …";
    try {
      const r = await fetch(api("/api/rooms/" + encodeURIComponent(code)));
      const data = await r.json();
      if (!data.exists) { status.textContent = "Diese Runde gibt es nicht (mehr) — Code prüfen."; return; }
      myRoomCode = code;
      connectToRoom(code);
      status.textContent = "Verbunden ✓";
      doRegister(name);
    } catch {
      status.textContent = "Verbindung fehlgeschlagen.";
    }
    return;
  }

  /* --- Ab hier: Legacy-Modus (server.js direkt, ohne Gateway) — unverändert --- */
  if (netMode === "host") { doRegister(name); return; }
  /* Beitreten per Code: erst per WebRTC zum Host verbinden, dann wie gewohnt registrieren */
  const code = document.getElementById("jcode").value.trim().toLowerCase();
  if (!code) { document.getElementById("joinErr").textContent = "Bitte Online-Code eingeben"; return; }
  const status = document.getElementById("joinCodeStatus");
  status.textContent = "Verbinde …";
  if (hostPeer) { hostPeer.destroy(); hostPeer = null; }   // eigenes Hosting nicht nötig, wenn wir selbst beitreten
  const localSocket = socket;
  const myPeer = new Peer({ debug: 0 });
  myPeer.on("open", () => {
    remoteConn = myPeer.connect("cs-" + code, { reliable: true });
    remoteConn.on("open", () => {
      status.textContent = "Verbunden ✓";
      /* Wichtig: die Verbindung zum EIGENEN lokalen Server kappen. Sie liefert
       * sonst weiter volle Snapshots einer ganz anderen Spielwelt (eigener Server,
       * eigene Bots, eigene Karte) — die würden sich mit den Daten des Hosts
       * abwechseln (Flackern) und den Kartencache bei jedem Tick komplett
       * überschreiben, sodass die Delta-Updates ins Leere laufen. */
      try { localSocket.disconnect(); } catch {}
      cachedFullMap = null;   // Karte des eigenen Servers verwerfen — der Host schickt gleich seine
      socket = makeBridge(remoteConn);
      bindSocketEvents(socket);
      doRegister(name);
    });
    remoteConn.on("error", () => { status.textContent = "Verbindung fehlgeschlagen — Code prüfen."; });
  });
  myPeer.on("error", () => { status.textContent = "Verbindung fehlgeschlagen — Code prüfen."; });
});
document.getElementById("jname").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("jgo").click(); });

/* ---- Öffentliche Runden ----
 * Wer keinen Code hat, soll trotzdem mitspielen können. Die Liste zeigt, was
 * gerade offen ist; ein Klick trägt den Code ein und verbindet. */
let oeffTimer = null;
async function oeffentlicheLaden() {
  const box = document.getElementById("oeffListe");
  if (!box || !MULTIROOM) return;
  clearTimeout(oeffTimer);
  let runden = [];
  try { runden = await (await fetch(api("/api/rooms/public"))).json(); } catch {}
  const dauer = ms => { const m = Math.floor(ms / 60000); return m < 1 ? t("gerade eröffnet") : `${m} min`; };
  box.innerHTML = `<div class="kopf">${t("Öffentliche Runden")}</div>` + (runden.length
    ? runden.map(r => {
        const voll = r.spieler >= r.max, zu = voll || r.beendet;
        const lage = r.beendet ? t("beendet") : voll ? t("voll") : r.gestartet ? t("läuft") : t("Warteraum");
        return `<button type="button" class="oeffRunde" data-code="${r.code}" ${zu ? "disabled" : ""}>
            <span class="wer"><b>${r.host ? rohText(r.host) : t("Noch niemand da")}</b>
              <span>${r.code} · ${dauer(r.alter)}</span></span>
            <span class="zahl">${r.spieler}/${r.max}${r.bots ? `<span class="bots">+${r.bots} ${t("Bots")}</span>` : ""}</span>
            <span class="lage${!zu && !r.gestartet ? " offen" : ""}">${lage}</span>
          </button>`;
      }).join("")
    : `<div class="leer">${t("Gerade ist keine öffentliche Runde offen — erstelle selbst eine.")}</div>`);
  box.querySelectorAll("[data-code]").forEach(b => b.addEventListener("click", () => {
    document.getElementById("jcode").value = b.dataset.code;
    document.getElementById("jgo").click();
  }));
  /* Nur weiterlaufen, solange der Beitritts-Tab wirklich sichtbar ist. */
  if (netMode === "join" && document.getElementById("join").style.display !== "none")
    oeffTimer = setTimeout(oeffentlicheLaden, 4000);
}

/* ---- Werbeplakate neben dem Startbildschirm ----
 * Drei Plakate auf zwei Plätzen: sie wechseln langsam durch, sodass man beim
 * Warten auf Mitspieler nach und nach alle sieht. Links und rechts zeigen nie
 * dasselbe Motiv. Auf schmalen Fenstern blendet CSS sie ganz aus; der Timer
 * läuft dann trotzdem, kostet aber praktisch nichts (ein Wechsel alle 9 s). */
(function plakate() {
  const MOTIVE = ["bank", "kontor", "mine", "autowerk", "oelpumpe", "wasserwerk", "windpark"];
  const links = document.getElementById("posterL"), rechts = document.getElementById("posterR");
  if (!links || !rechts) return;
  const url = n => `assets/poster/${MOTIVE[((n % MOTIVE.length) + MOTIVE.length) % MOTIVE.length]}.jpg`;

  /* Zufälliger Einstieg, damit nicht bei jedem Seitenaufruf dieselben zwei
   * Motive begrüßen — bei sieben Plakaten lohnt sich das. */
  let i = Math.floor(Math.random() * MOTIVE.length);
  const setzen = (el, n) => { el.style.backgroundImage = `url("${url(n)}")`; el.classList.add("da"); };
  setzen(links, i);
  setzen(rechts, i + 1);

  /* Nur die beiden sichtbaren laden sofort; der Rest erst, wenn der Browser
   * ohnehin nichts Wichtigeres zu tun hat. Alle sieben auf einmal (740 KB)
   * würden sonst mit dem eigentlichen Seitenaufbau konkurrieren. */
  const nachladen = () => MOTIVE.forEach((_, n) => { new Image().src = url(n); });
  (window.requestIdleCallback || (f => setTimeout(f, 2500)))(nachladen);

  setInterval(() => {
    /* Immer nur eine Seite tauschen — beide gleichzeitig wirkt unruhig.
     * Die andere Seite hält dabei stets das vorherige Motiv, links und rechts
     * zeigen dadurch nie dasselbe. */
    const el = (i % 2 === 0) ? links : rechts;
    el.classList.remove("da");
    setTimeout(() => setzen(el, i + 2), 1100);   // erst nach dem Ausblenden wechseln
    i++;
  }, 9000);
})();

/* ---- Startbildschirm: Partikelfeld und Statuszeile ----
 * Das Partikelfeld ist reine Deko und läuft nur, solange die Lobby sichtbar ist —
 * im Spiel selbst würde es sonst dauerhaft Rechenzeit neben der Karte fressen. */
(function joinAmbience() {
  if (window.startTopo) {
    const joinEl = document.getElementById("join"), lobbyEl = document.getElementById("lobbyWait");
    const startOderWarteraum = () => joinEl.style.display !== "none" || lobbyEl.classList.contains("on");
    startTopo(document.body, document.getElementById("bgTopo"), {
      seed: 26, interactiveWhen: startOderWarteraum, calmSpeed: 0.5, calmFrameMs: 66,
      /* Während die Karte bewegt wird, steht der Hintergrund still — spart die
       * Rechenzeit fürs Spiel, gerade beim Scrollen. */
      pausiertWenn: () => !EINST.hintergrund || performance.now() - (window.KAMERA_BEWEGT || 0) < 450,
    });
    const ebeneSetzen = () => document.body.classList.toggle("topoVorn", startOderWarteraum());
    ebeneSetzen(); setInterval(ebeneSetzen, 200);
  }
  const cv = document.getElementById("joinParticles"), join = document.getElementById("join");
  const cx = cv.getContext("2d");
  let raf = null, teilchen = [];
  const anpassen = () => {
    cv.width = cv.offsetWidth; cv.height = cv.offsetHeight;
    if (teilchen.length) return;
    for (let i = 0; i < 55; i++) teilchen.push({
      x: Math.random() * cv.width, y: Math.random() * cv.height,
      vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
      a: Math.random() * 0.35 + 0.05, r: Math.random() * 1.2 + 0.4,
    });
  };
  function zeichnen() {
    cx.clearRect(0, 0, cv.width, cv.height);
    for (const p of teilchen) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = cv.width; if (p.x > cv.width) p.x = 0;
      if (p.y < 0) p.y = cv.height; if (p.y > cv.height) p.y = 0;
      cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      cx.fillStyle = `rgba(56,189,248,${p.a})`; cx.fill();
    }
    raf = requestAnimationFrame(zeichnen);
  }
  const start = () => { if (raf) return; anpassen(); zeichnen(); };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = null; };
  addEventListener("resize", () => { if (raf) { teilchen = []; anpassen(); } });
  /* Sichtbarkeit der Lobby beobachten, statt den Zustand an zwei Stellen zu pflegen */
  new MutationObserver(() => join.style.display === "none" ? stop() : start())
    .observe(join, { attributes: true, attributeFilter: ["style"] });
  start();

  /* Statuszeile mit echten Werten: Verbindungszustand und wer schon in der Runde
   * ist. Der Server sendet seinen Zustand an jede Verbindung, auch an noch nicht
   * angemeldete — die Zahl stimmt also schon vor dem Beitritt. */
  const MAX = 8;
  const slots = document.getElementById("joinSlots");
  slots.innerHTML = Array.from({ length: MAX }, () => `<span class="slot"></span>`).join("")
    + `<span class="count">0/${MAX}</span>`;
  /* Im Gateway-Modus sagen Verbindungsampel und Spielerzahl vor dem Beitritt
   * nichts aus: Man hängt an gar keiner Runde, "keine Verbindung" wäre bloß ein
   * Fehlalarm, und "0/8" zählt Mitspieler einer Runde, die es noch nicht gibt.
   * Dort stehen deshalb die Code-Suche und die Zahl der laufenden Runden. */
  const rundenZahl = document.getElementById("rundenZahl");
  /* Bestenliste auf dem Startbildschirm: Top-Nettovermögen bisheriger Runden.
   * Vor dem Beitritt gibt es noch keinen Spielzustand — die Liste kommt
   * deshalb über /api/invite, das der Startbildschirm ohnehin lädt. */
  let hofSig = "", hofDaten = null;
  (async function hofLaden() {
    try {
      const antwort = await fetch(api("/api/invite"));
      hofDaten = (await antwort.json()).hof || [];
      hofZeichnen();
    } catch {}
  })();
  function hofZeichnen() {
    const hof = hofDaten || store.get().state?.hof;
    const box = document.getElementById("hofBox");
    if (!box) return;
    if (!hof?.length) { box.style.display = "none"; return; }
    const sig = JSON.stringify(hof);
    if (sig === hofSig) { box.style.display = ""; return; }
    hofSig = sig;
    box.style.display = "";
    const modusName = { sandbox: "Sandbox", plan: "Planwirtschaft", renntag: "Race Day", einsteiger: "Einsteiger", kartell: "Kartellwirtschaft" };
    document.getElementById("hofListe").innerHTML = hof.slice(0, 5).map((e, i) => `
      <div class="hofzeile">
        <span class="hofplatz p${i + 1}">${i + 1}</span>
        <span class="hofname"><b>${e.name}</b>${e.sieger ? " 👑" : ""}
          <span class="meta">${modusName[e.modus] || e.modus} · ${e.datum}</span></span>
        <span class="hofwert"><b>${fmt(e.nw)}</b><span class="meta">in ${e.minuten} min${e.einwohner ? ` · ${e.einwohner.toLocaleString("de-DE")} ${t("Einw.")}` : ""}</span></span>
      </div>`).join("");
  }
  function statusZeichnen() {
    if (join.style.display === "none") return;
    hofZeichnen();
    const mehrrunden = MULTIROOM;
    document.getElementById("joinPulse").style.display = mehrrunden ? "none" : "";
    document.getElementById("joinStatusText").style.display = mehrrunden ? "none" : "";
    slots.style.display = mehrrunden ? "none" : "";
    rundenZahl.style.display = mehrrunden ? "" : "none";
    if (mehrrunden) return;   // Rest gilt nur für die Einzelrunde

    const verbunden = socket.connected !== false;
    const txt = document.getElementById("joinStatusText");
    txt.textContent = verbunden ? "Server online" : "Keine Verbindung";
    txt.style.color = verbunden ? "var(--up)" : "var(--down)";
    document.getElementById("joinPulse").querySelectorAll("i,b").forEach(e =>
      e.style.background = verbunden ? "var(--up)" : "var(--down)");
    const n = Math.min(MAX, Object.keys(store.get().state?.players || {}).length);
    slots.querySelectorAll(".slot").forEach((e, i) => e.classList.toggle("on", i < n));
    slots.querySelector(".count").textContent = `${n}/${MAX}`;
    document.getElementById("joinWaiting").textContent =
      n === 0 ? "Runde ist leer" : n === 1 ? "1 Firma in der Runde" : `${n} Firmen in der Runde`;
  }

  /* Zahl der gleichzeitig laufenden Runden — nur im Gateway-Modus vorhanden.
   * Läuft weiter, solange der Startbildschirm sichtbar ist. */
  async function rundenZaehlen() {
    if (!MULTIROOM || join.style.display === "none") return;
    try {
      const d = await (await fetch(api("/api/stats"))).json();
      rundenZahl.textContent = d.rooms === 0 ? "keine Runde aktiv"
        : d.rooms === 1 ? "1 Runde läuft" : `${d.rooms} Runden laufen`;
      document.getElementById("joinWaiting").textContent =
        d.rooms === 0 ? "noch keine Runde" : `${d.rooms} von ${d.maxRooms} Plätzen belegt`;
    } catch { rundenZahl.textContent = "—"; }
  }
  multiroomReady.then(() => { rundenZaehlen(); setInterval(rundenZaehlen, 5000); });

  setInterval(statusZeichnen, 1000);
  store.subscribe(statusZeichnen);
  statusZeichnen();
})();
/* Nach dem Sieg: Runde serverseitig neu aufsetzen. Der Server schickt daraufhin
 * allen Verbundenen ein "roundReset", also auch uns selbst — der Rücksprung in
 * die Lobby passiert dort und damit für alle gleichzeitig. */
document.getElementById("winNew").addEventListener("click", () => act("newRound", {}));

/* Einladungslink vom Server holen (öffentlicher Tunnel-Link zuerst, sonst LAN-IP).
 * Dieselbe Antwort liefert die Kennung des Serverlaufs für das Intro mit.
 * Läuft NUR im Legacy-Modus: das Gateway kennt /api/invite nicht (LAN-Link und
 * Server-Tunnel ergeben bei einer zentral gehosteten Runde keinen Sinn mehr —
 * dort übernimmt renderInviteMultiroom() dieselbe Stelle im Markup). Wartet
 * bewusst auf multiroomReady, damit dieser Codepfad im Gateway-Modus gar nicht
 * erst versucht, ein längst durch renderInviteMultiroom() ersetztes
 * #inviteUrl-Element zu befüllen. */
multiroomReady.then(() => {
  if (MULTIROOM) {
    renderInviteMultiroom();   // sonst zeigt die Box bis zum ersten Klick noch die alte LAN/WebRTC-Ansicht
    introVielleichtZeigen(GATEWAY_BOOT_ID);
    return;
  }
  fetch(api("/api/invite")).then(r => r.json()).then(({ urls, bootId }) => {
    const url = urls[0] || location.href;
    document.getElementById("inviteUrl").value = url;
    document.getElementById("inviteHint").textContent = t(url.startsWith("https")
      ? "Öffentlicher Link — funktioniert auch außerhalb deines Netzwerks."
      : "Funktioniert für alle im selben WLAN. Für einen öffentlichen Link: npm run share");
    introVielleichtZeigen(bootId);
  }).catch(() => { document.getElementById("inviteUrl").value = location.href; });
});

/* ---- Intro-Video ----
 * Soll genau einmal je Serverstart laufen: der Server würfelt beim Hochfahren
 * eine Kennung aus, der Browser merkt sich die zuletzt gesehene. Sind beide
 * gleich, war das Intro in diesem Serverlauf schon dran — also überspringen.
 * Damit kommt es nach jedem "sh start.sh" wieder, aber nicht bei jedem Reload. */
const BOOT_KEY = "cs_intro_boot";
function introVielleichtZeigen(bootId) {
  if (!bootId) return;
  let gesehen = null;
  try { gesehen = localStorage.getItem(BOOT_KEY); } catch {}
  if (gesehen === bootId) return;
  const merken = () => { try { localStorage.setItem(BOOT_KEY, bootId); } catch {} };

  const box = document.getElementById("intro");
  const video = document.getElementById("introVideo");
  const tonBtn = document.getElementById("introSound");
  const skipBtn = document.getElementById("introSkip");
  let beendet = false;
  const beenden = () => {
    if (beendet) return;
    beendet = true;
    merken();
    video.pause();
    box.hidden = true;
    removeEventListener("keydown", aufTaste);
  };
  const aufTaste = e => { if (e.key === "Escape" || e.key === " " || e.key === "Enter") beenden(); };

  box.hidden = false;
  video.src = "assets/video/intro.mp4";
  video.addEventListener("ended", beenden);
  video.addEventListener("error", beenden);   // fehlt die Datei, nicht im Schwarzbild hängen bleiben
  skipBtn.addEventListener("click", beenden);
  addEventListener("keydown", aufTaste);
  tonBtn.addEventListener("click", () => { video.muted = false; video.volume = 1; tonBtn.hidden = true; });

  /* Browser blocken Ton ohne vorherige Nutzerinteraktion. Erst mit Ton
   * versuchen; wird das abgelehnt, stumm weiterlaufen lassen und einen Knopf
   * zum Einschalten anbieten — statt das Intro ganz ausfallen zu lassen. */
  video.play().catch(() => {
    video.muted = true;
    tonBtn.hidden = false;
    video.play().catch(beenden);
  });
}
document.getElementById("inviteCopy").addEventListener("click", async () => {
  const inp = document.getElementById("inviteUrl");
  try { await navigator.clipboard.writeText(inp.value); }
  catch { inp.select(); document.execCommand("copy"); }
  const btn = document.getElementById("inviteCopy");
  btn.textContent = "Kopiert"; btn.classList.add("done");
  setTimeout(() => { btn.textContent = "Kopieren"; btn.classList.remove("done"); }, 1600);
});
document.getElementById("hostCodeCopy").addEventListener("click", async () => {
  const code = document.getElementById("hostCode").textContent;
  try { await navigator.clipboard.writeText(code); } catch {}
  const btn = document.getElementById("hostCodeCopy");
  btn.textContent = "Kopiert"; btn.classList.add("done");
  setTimeout(() => { btn.textContent = "Kopieren"; btn.classList.remove("done"); }, 1600);
});

/* ---- Karte (Canvas, rendert nur den Server-State) ---- */
const cv = document.getElementById("cv"), cx = cv.getContext("2d");
const TW = 64, TH = 32; let cam = { x: 0, y: -120, z: 1 }, drag = null;
/* DDR-Optik: Im Planwirtschafts-Modus bekommt die Karte einen gedeckten,
 * entsättigten Look — wird pro Frame aus dem Spielzustand gesetzt. */
let PLAN_LOOK = false;
/* Kartellmodus: die alte italienische Küstenstadt — warme Terrakotta-Töne,
 * sandsteinfarbene Straßen, türkiseres Meer. Reiner Farb-Schleier über den
 * fertigen Kachel-Texturen, keine eigenen Sprites nötig. */
let ITALIA_LOOK = false;
/* Pixeldichte auf 2 gedeckelt — auf 3x-Displays wären es sonst 2,25x so viele
 * Pixel je Bild, ohne sichtbaren Gewinn bei einer bewegten Karte. */
const DPR = () => Math.min(2, window.devicePixelRatio || 1) * (EINST.aufloesung || 1);
document.addEventListener("einstellung", e => { if (e.detail === "aufloesung" || e.detail === "qualitaet") resize(); });
function resize(){ cv.width = innerWidth * DPR(); cv.height = innerHeight * DPR();
  cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
  /* Ein Resize setzt den Kontext zurück — die Glättungsqualität danach neu setzen. */
  cx.imageSmoothingQuality = "high"; }
addEventListener("resize", resize); resize();
const iso = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2];
const ZCOL = { zentrum:"#1e6fd9", industrie:"#3a3226", agrar:"#22371f", kueste:"#173b45", wasser:"#0e2f44" };
/* Boden-Kacheln (Kenney Isometric Roads + Water Works, CC0) — ersetzen die reine
 * Flächenfarbe durch echte Isometrie-Sprites; die Zonenfarbe bleibt als transparenter
 * Farbwasch obendrauf für die Wiedererkennbarkeit der Zonen erhalten. */
/* ---- Bodenkacheln ----
 * Der Boden kommt jetzt aus flachen, kachelbaren Texturen (64x64) statt aus
 * fertigen Isometrie-Sprites. Damit sie nicht wie aufgeklebte Quadrate wirken,
 * wird jede Textur EINMAL beim Laden in eine Raute geschert und zwischengelagert
 * — danach kostet das Zeichnen pro Bild genauso viel wie vorher.
 * Die Straßen bleiben unverändert die Kenney-Sprites; sie werden nur in dieselbe
 * Rautenform vorgerendert, pixelgenau mit demselben Zuschnitt wie bisher. */
const TILE_SCALE = 4;          // Vorrendern in vierfacher Auflösung, damit es beim Hineinzoomen scharf bleibt
const TILEIMG = {};            // Schlüssel -> vorgerenderte Raute (Canvas)
function makeDiamond(zeichne) {
  const c = document.createElement("canvas");
  c.width = TW * TILE_SCALE; c.height = TH * TILE_SCALE;
  const g = c.getContext("2d");
  g.scale(TILE_SCALE, TILE_SCALE);
  /* Rautenpfad, minimal überzeichnet — sonst blitzen zwischen den Kacheln
   * haarfeine Lücken durch die Kantenglättung. */
  const o = 0.5;
  g.beginPath();
  g.moveTo(TW/2, -o); g.lineTo(TW+o, TH/2); g.lineTo(TW/2, TH+o); g.lineTo(-o, TH/2);
  g.closePath(); g.clip();
  zeichne(g);
  return c;
}
/* Flache Textur isometrisch auf die Raute scheren: die vier Ecken des
 * Texturquadrats landen auf den vier Rautenspitzen. */
function groundDiamond(img) {
  const ts = img.naturalWidth || img.width;
  return makeDiamond(g => {
    g.transform(TW/2/ts, TH/2/ts, -TW/2/ts, TH/2/ts, TW/2, 0);
    g.drawImage(img, 0, 0, ts, ts);
  });
}
/* Kenney-Straßenblock: nur die flache Deckfläche (obere Bildhälfte) übernehmen —
 * exakt derselbe Zuschnitt wie zuvor beim Zeichnen pro Bild. */
function roadDiamond(img) {
  return makeDiamond(g => g.drawImage(img, 0, 0, img.naturalWidth, img.naturalWidth / 2, 0, 0, TW, TH));
}
/* ---- Strassen nach Nachbarschaft ----
 * Vorher waehlte tileSprite() die Strassenkachel ueber "t.x % 6 === 3" — also
 * ueber die Annahme, dass Strassen auf festen Rasterlinien liegen. Das gilt nur
 * fuer die prozedurale Sandkasten-Flaeche; auf jeder anderen Karte kam ein
 * Flickenteppich heraus. Jetzt entscheidet die tatsaechliche Nachbarschaft.
 *
 * Das Kenney-Strassenpack liefert Randstuecke und grosse Kurven, aber kein
 * Autotile fuer ein netzfoermiges Strassennetz mit einer Kachel Breite. Die
 * Flaeche kommt deshalb aus dem Pack (gleichmaessiger Asphalt), die 16
 * Nachbarschaftsfaelle zeichne ich darauf — in derselben flachen Optik.
 *
 * Achsen: groundDiamond bildet Textur-x auf Welt-+x ab und Textur-y auf Welt-+y.
 * Bit 1 = Norden (-y), 2 = Osten (+x), 4 = Sueden (+y), 8 = Westen (-x). */
const ROADIMG = [];
function strassenTextur(mask, asphalt) {
  const S = 64, C = S / 2, K = 3;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  g.drawImage(asphalt, 0, 0, S, S);
  /* Bordstein an jeder Seite ohne Anschluss — das ist die Kante, an der die
   * Strasse ans Gruen stoesst. */
  g.fillStyle = "#cfd6dd";
  if (!(mask & 1)) g.fillRect(0, 0, S, K);
  if (!(mask & 2)) g.fillRect(S - K, 0, K, S);
  if (!(mask & 4)) g.fillRect(0, S - K, S, K);
  if (!(mask & 8)) g.fillRect(0, 0, K, S);
  const an = [mask & 1, mask & 2, mask & 4, mask & 8].map(Boolean);
  const zahl = an.filter(Boolean).length;
  g.strokeStyle = "#eef3f8"; g.lineWidth = 2.4; g.lineCap = "butt";
  const gerade = zahl === 2 && ((an[0] && an[2]) || (an[1] && an[3]));
  const kurve  = zahl === 2 && !gerade;
  if (gerade) {
    g.setLineDash([8, 8]);
    g.beginPath();
    if (an[0]) { g.moveTo(C, 0); g.lineTo(C, S); } else { g.moveTo(0, C); g.lineTo(S, C); }
    g.stroke();
  } else if (kurve) {
    /* Viertelkreis von der einen offenen Seite zur anderen. */
    g.setLineDash([7, 7]);
    const mx = an[3] ? 0 : S, my = an[0] ? 0 : S;
    g.beginPath(); g.arc(mx, my, C, 0, Math.PI * 2); g.stroke();
  } else if (zahl >= 3) {
    /* Kreuzung und Einmuendung: Mitte frei lassen, sonst laeuft die
     * Mittellinie quer durch den Knoten. Stattdessen Haltebalken. */
    g.setLineDash([]);
    g.lineWidth = 2;
    const D = 16, a1 = K + 2, a2 = S - K - 2;   // Abstand des Balkens von der Mitte
    if (an[0]) { g.beginPath(); g.moveTo(a1, C - D); g.lineTo(a2, C - D); g.stroke(); }
    if (an[2]) { g.beginPath(); g.moveTo(a1, C + D); g.lineTo(a2, C + D); g.stroke(); }
    if (an[1]) { g.beginPath(); g.moveTo(C + D, a1); g.lineTo(C + D, a2); g.stroke(); }
    if (an[3]) { g.beginPath(); g.moveTo(C - D, a1); g.lineTo(C - D, a2); g.stroke(); }
  } else if (zahl === 1) {
    g.setLineDash([8, 8]);
    g.beginPath();
    if (an[0]) { g.moveTo(C, 0); g.lineTo(C, C + 6); }
    else if (an[2]) { g.moveTo(C, S); g.lineTo(C, C - 6); }
    else if (an[1]) { g.moveTo(S, C); g.lineTo(C - 6, C); }
    else { g.moveTo(0, C); g.lineTo(C + 6, C); }
    g.stroke();
  }
  g.setLineDash([]);
  return c;
}
/* Welche Kacheln Strasse sind — einmal je Karte, danach nur noch nachgeschlagen. */
let ROADSET = null;
function roadMask(t) {
  if (!ROADSET) {
    ROADSET = new Set();
    for (const q of (store.get()?.state?.map || [])) if (q.road) ROADSET.add(q.x + "," + q.y);
  }
  const R = (x, y) => ROADSET.has(x + "," + y) ? 1 : 0;
  return R(t.x, t.y - 1) | (R(t.x + 1, t.y) << 1) | (R(t.x, t.y + 1) << 2) | (R(t.x - 1, t.y) << 3);
}

for (const [key, pfad, art] of [
  ["gras",      "assets/ground/gras.png",      groundDiamond],
  ["stadt",     "assets/ground/stadt.png",     groundDiamond],
  ["industrie", "assets/ground/industrie.png", groundDiamond],
  ["kueste",    "assets/ground/kueste.png",    groundDiamond],
  ["sand",      "assets/ground/sand.png",      groundDiamond],
  ["meer",      "assets/ground/meer.png",      groundDiamond],
  ["road",      "assets/kenney/tiles/road.png",      roadDiamond],
  ["roadNS",    "assets/kenney/tiles/roadNS.png",    roadDiamond],
  ["roadEW",    "assets/kenney/tiles/roadEW.png",    roadDiamond],
  ["crossroad", "assets/kenney/tiles/crossroad.png", roadDiamond],
]) {
  const img = new Image();
  img.onload = () => TILEIMG[key] = art(img);
  img.src = pfad;
}
{
  /* Asphalt aus dem Kenney-Strassenpack (CC0) — daraus einmal alle 16
   * Nachbarschaftsfaelle vorrendern. */
  const asphalt = new Image();
  asphalt.onload = () => {
    for (let m = 0; m < 16; m++) ROADIMG[m] = groundDiamond(strassenTextur(m, asphalt));
  };
  asphalt.src = "assets/ground/asphalt.png";
}
const tileSprite = t => {
  if (t.water) return TILEIMG.meer;
  if (t.road) return ROADIMG[roadMask(t)] || TILEIMG.road;
  if (t.sand) return TILEIMG.sand;
  if (t.zone === "industrie") return TILEIMG.industrie;
  if (t.zone === "kueste") return TILEIMG.kueste;
  if (t.zone === "zentrum") return TILEIMG.stadt;
  return TILEIMG.gras;
};

/* ---- Mittelmeer-Deko (Kartellmodus), einmal vorgerendert ----
 * Punkt (a,b) in Kachel-Koordinaten [0..1]² → Pixel im 64×32-Diamant. */
const MEDIT = (() => {
  const P = (a, b) => [(a - b) * 32 + 32, (a + b) * 16];
  const mk = fn => { const c = document.createElement("canvas"); c.width = 64; c.height = 32; fn(c.getContext("2d")); return c; };
  /* Weinberg: vier Rebzeilen entlang der Kachelachse, mit Erdstreifen */
  const weinberg = mk(g => {
    for (let r = 0; r < 4; r++) {
      const b = .2 + r * .21;
      g.strokeStyle = "rgba(101,74,48,.5)"; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(...P(.12, b)); g.lineTo(...P(.88, b)); g.stroke();
      for (let i = 0; i < 6; i++) {
        const [x, y] = P(.16 + i * .14, b);
        g.fillStyle = i % 2 ? "#3f6428" : "#4a7230";
        g.beginPath(); g.arc(x, y - 1.5, 2.4, 0, Math.PI * 2); g.fill();
      }
    }
  });
  /* Olivenhain: lockeres Raster silbergrüner Kronen */
  const oliven = mk(g => {
    for (const a of [.25, .5, .75]) for (const b of [.25, .5, .75]) {
      const [x, y] = P(a + (a * b * 7 % .1) - .05, b);
      g.fillStyle = "rgba(0,0,0,.18)";
      g.beginPath(); g.ellipse(x + 1, y + 1, 3.4, 1.8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = (a + b) % .5 < .25 ? "#7d8f5a" : "#6e8150";
      g.beginPath(); g.arc(x, y - 1.5, 3, 0, Math.PI * 2); g.fill();
    }
  });
  /* Fischerboot (Draufsicht): Rumpf mit Bug, Sitzbank */
  const boot = document.createElement("canvas"); boot.width = 28; boot.height = 14;
  { const g = boot.getContext("2d");
    g.fillStyle = "#7a4f2c";
    g.beginPath(); g.moveTo(2, 7); g.quadraticCurveTo(6, 1, 16, 1.5); g.quadraticCurveTo(26, 3, 27, 7);
    g.quadraticCurveTo(26, 11, 16, 12.5); g.quadraticCurveTo(6, 13, 2, 7); g.closePath(); g.fill();
    g.strokeStyle = "#553517"; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = "#9c6b3d"; g.fillRect(10, 3.5, 3, 7); g.fillRect(18, 3.5, 3, 7); }
  /* Sonnenschirm (Draufsicht): Kreis mit Farbsegmenten */
  const schirm = (c1) => { const s = document.createElement("canvas"); s.width = 20; s.height = 20;
    const g = s.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.2)"; g.beginPath(); g.ellipse(11, 12, 8, 4.5, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#f2ede2" : c1;
      g.beginPath(); g.moveTo(10, 10);
      g.arc(10, 10, 8.5, i * Math.PI / 4, (i + 1) * Math.PI / 4); g.closePath(); g.fill();
    }
    g.fillStyle = "#fff"; g.beginPath(); g.arc(10, 10, 1.3, 0, Math.PI * 2); g.fill();
    return s; };
  /* Zypresse: schlanke, dunkle Säule — das Ausrufezeichen der Toskana */
  const zypresse = document.createElement("canvas"); zypresse.width = 14; zypresse.height = 40;
  { const g = zypresse.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.22)";
    g.beginPath(); g.ellipse(7, 37, 5.5, 2.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#5d4426"; g.fillRect(6.2, 32, 1.6, 5);
    for (const [w2, h2, col] of [[4.6, 30, "#274a22"], [3.4, 26, "#2f5a29"], [2.2, 20, "#3a6a31"]]) {
      g.fillStyle = col;
      g.beginPath(); g.ellipse(7, 18 + (30 - h2) / 2, w2, h2 / 2, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "#43763a"; g.beginPath(); g.ellipse(7, 4.5, 1.2, 3, 0, 0, Math.PI * 2); g.fill(); }
  /* Gaslaterne: schmiedeeiserner Mast mit Lampenkopf */
  const laterne = document.createElement("canvas"); laterne.width = 12; laterne.height = 34;
  { const g = laterne.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.25)"; g.beginPath(); g.ellipse(6, 31.5, 4, 1.8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#23282e"; g.fillRect(5.1, 8, 1.8, 24);
    g.fillRect(3.5, 30, 5, 2);
    g.fillStyle = "#2c333b"; g.fillRect(3.8, 4, 4.4, 5.5);      // Lampengehäuse
    g.fillStyle = "#ffd884"; g.fillRect(4.6, 5, 2.8, 3.6);      // Glas (warm, auch tags)
    g.fillStyle = "#23282e"; g.beginPath(); g.moveTo(3, 4.4); g.lineTo(9, 4.4); g.lineTo(6, 1); g.closePath(); g.fill(); }
  /* Altstadt-Häuser: schmale Palazzi in Terrakotta, Ocker & Rosé — je Variante
   * eine Tag- und eine Nachtfassung (erleuchtete Fenster). */
  const casaFarben = [["#c98a5a", "#a96e44"], ["#d9b07a", "#b8935f"], ["#e0cba8", "#bfa987"],
                     ["#b7746b", "#985a52"], ["#a8b090", "#8a9274"], ["#cf9d7e", "#ad7f62"]];
  const mkCasa = (seed, nacht) => {
    const c = document.createElement("canvas"); c.width = 48; c.height = 66;
    const g = c.getContext("2d");
    const [colR, colL] = casaFarben[seed % casaFarben.length];
    const fw = 13 + (seed % 3) * 2, hh = 24 + (seed * 7) % 14, bx = 24, by = 62;
    g.fillStyle = colL;                                          // linke Wand (im Schatten)
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - fw, by - fw / 2);
    g.lineTo(bx - fw, by - fw / 2 - hh); g.lineTo(bx, by - hh); g.closePath(); g.fill();
    g.fillStyle = colR;                                          // rechte Wand (Sonnenseite)
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + fw, by - fw / 2);
    g.lineTo(bx + fw, by - fw / 2 - hh); g.lineTo(bx, by - hh); g.closePath(); g.fill();
    const ry = by - hh - fw * .8;                                // Ziegeldach mit First
    g.fillStyle = "#a14f38";
    g.beginPath(); g.moveTo(bx, by - hh); g.lineTo(bx + fw, by - fw / 2 - hh); g.lineTo(bx, ry); g.closePath(); g.fill();
    g.fillStyle = "#8a4230";
    g.beginPath(); g.moveTo(bx, by - hh); g.lineTo(bx - fw, by - fw / 2 - hh); g.lineTo(bx, ry); g.closePath(); g.fill();
    g.strokeStyle = "#6e3526"; g.beginPath(); g.moveTo(bx, by - hh); g.lineTo(bx, ry); g.stroke();
    /* Fenster mit Läden auf der Sonnenseite, Tür auf der Schattenseite */
    for (let r = 0; r < (hh > 32 ? 3 : 2); r++) for (let col2 = 0; col2 < 2; col2++) {
      const wx = bx + 3 + col2 * 6.5, wy = by - hh + 5 + r * 10 + (3 + col2 * 6.5) * .5 * .5;
      g.fillStyle = nacht && (seed + r * 2 + col2) % 3 ? "#ffd27a" : "#31302e";
      g.fillRect(wx, wy, 3.6, 5);
      g.fillStyle = "#5c7248"; g.fillRect(wx - 1.2, wy, 1, 5); g.fillRect(wx + 3.8, wy, 1, 5);
    }
    g.fillStyle = "#4a382a"; g.fillRect(bx - fw + 3, by - fw / 2 - 9 + 1.5, 4.5, 9);   // Tür
    if (nacht) { g.fillStyle = "rgba(255,210,120,.28)"; g.fillRect(bx - fw + 2, by - fw / 2 - 10, 6.5, 11); }
    return c;
  };
  const casas = Array.from({ length: 6 }, (_, i) => ({ tag: mkCasa(i, false), nacht: mkCasa(i, true) }));
  /* Marktstand: Theke mit gestreifter Markise — die Piazza soll nach
   * Wochenmarkt aussehen, nicht nach leerem Parkplatz. */
  const stand = (farbe) => {
    const c = document.createElement("canvas"); c.width = 30; c.height = 26;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.22)"; g.beginPath(); g.ellipse(15, 23, 11, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#6b4d2e"; g.fillRect(4, 12, 22, 9);                     // Theke
    g.fillStyle = "#573d24"; g.fillRect(4, 12, 22, 2);
    g.fillStyle = "#3f2d1a"; g.fillRect(5, 21, 2, 3); g.fillRect(23, 21, 2, 3);
    for (let i = 0; i < 6; i++) {                                          // Markise
      g.fillStyle = i % 2 ? "#f2ede2" : farbe;
      g.beginPath(); g.moveTo(2 + i * 4.4, 6); g.lineTo(6.4 + i * 4.4, 6);
      g.lineTo(6.4 + i * 4.4, 10); g.quadraticCurveTo(4.2 + i * 4.4, 12, 2 + i * 4.4, 10);
      g.closePath(); g.fill();
    }
    g.fillStyle = "#8a6a45"; g.fillRect(3, 6, 1.6, 16); g.fillRect(25.4, 6, 1.6, 16);   // Pfosten
    g.fillStyle = farbe; g.fillRect(2, 4, 26, 2.5);                        // Markisenkante
    /* Ware auf der Theke */
    for (let i = 0; i < 4; i++) { g.fillStyle = ["#c94f3d", "#e3c078", "#7fb44d", "#e08a3c"][i];
      g.beginPath(); g.arc(8 + i * 5, 12.5, 1.8, 0, Math.PI * 2); g.fill(); }
    return c;
  };
  const staende = [stand("#c94f3d"), stand("#3d7ac9"), stand("#4a9a55")];
  return { weinberg, oliven, boot, zypresse, laterne, casas, staende,
    schirme: [schirm("#c94f3d"), schirm("#3d7ac9"), schirm("#4a9a55")],
    waescheFarben: ["#e8e4d8", "#c94f3d", "#7fb4d9", "#e3c078", "#9fc98a"] };
})();
/* Retro-Italien-Häuser (eigene Pixel-Tiles): die Geschäfte der Stadt, aus
 * denen das Schutzgeld kommt. 18 Varianten, geladen aus assets/casa/ —
 * bis sie da sind, springen die prozeduralen Häuschen ein. */
const CASA_IMGS = [];
/* Einige der Tiles kommen mit weißem Hintergrund statt Alpha. Beim Laden wird
 * das Weiß per Flutfüllung von den Bildrändern her ausgestanzt — nur der
 * zusammenhängende Randbereich, weiße Details im Motiv bleiben unberührt. */
function casaFreistellen(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), px = d.data;
  const weiss = i => px[i + 3] > 0 && px[i] >= 232 && px[i + 1] >= 232 && px[i + 2] >= 232;
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { stack.push(y * w, w - 1 + y * w); }
  const gesehen = new Uint8Array(w * h);
  while (stack.length) {
    const p = stack.pop();
    if (gesehen[p]) continue;
    gesehen[p] = 1;
    if (!weiss(p * 4)) continue;
    px[p * 4 + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  g.putImageData(d, 0, 0);
  return c;
}
for (let i = 0; i < 18; i++) {
  const img = new Image();
  img.onload = () => CASA_IMGS[i] = casaFreistellen(img);
  img.src = `assets/casa/casa-${i}.png`;
}
/* Wo die Altstadt-Häuser stehen: freie Kacheln mit Straßenanschluss (einmal
 * je Karte berechnet, deterministisch — alle Clients sehen dieselbe Stadt). */
let CASAS = null;
function buildCasas(map) {
  const W = map.reduce((m, t) => Math.max(m, t.x), 0) + 1;
  const at3 = (x, y) => map[y * W + x];
  const res = new Map();
  for (const t of map) {
    if (t.water || t.road || t.sand || t.park || t.field || t.piazza || t.pier ||
        t.leuchtturm || t.bank || t.news || t.schwarz || t.deko || t.zone === "industrie") continue;
    const anStrasse = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const n = t.x + dx >= 0 && t.x + dx < W && t.y + dy >= 0 ? at3(t.x + dx, t.y + dy) : null;
      return n?.road;
    });
    if (anStrasse && (t.x * 7 + t.y * 13) % 5 < 2)
      res.set(t.x + "," + t.y, (t.x * 3 + t.y * 11) % 97);
  }
  return res;
}
/* Gebäude-Sprites (Kenney City Kits, CC0) — public/assets/<btype>-<n>.png.
 * Mehrere Varianten je Typ; die Kachelposition wählt deterministisch eine aus,
 * damit alle Clients dasselbe Stadtbild sehen. Fallback: farbige Blöcke. */
/* ---- Sprites hochrechnen (Scale2x, zweimal = 4x) ----
 * Die Gebäude-Sprites liegen nur in 64x64 vor; beim Hineinzoomen (bis 2,2x
 * mal Retina-Faktor) wurden daraus sichtbar grobe Pixel. Scale2x glättet
 * Treppenkanten, ohne die Fläche zu verwaschen — einmal beim Laden gerechnet,
 * danach kostet das Zeichnen nichts extra. */
function scale2x(src) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const sc = document.createElement("canvas"); sc.width = w; sc.height = h;
  const sg = sc.getContext("2d", { willReadFrequently: true });
  sg.drawImage(src, 0, 0);
  const sd = sg.getImageData(0, 0, w, h).data;
  const out = document.createElement("canvas"); out.width = w * 2; out.height = h * 2;
  const og = out.getContext("2d");
  const od = og.createImageData(w * 2, h * 2), dd = od.data;
  const px = (x, y) => (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
  const eq = (a, b) => sd[a] === sd[b] && sd[a+1] === sd[b+1] && sd[a+2] === sd[b+2] && sd[a+3] === sd[b+3];
  const set = (x, y, s) => { const o = (y * w * 2 + x) * 4;
    dd[o] = sd[s]; dd[o+1] = sd[s+1]; dd[o+2] = sd[s+2]; dd[o+3] = sd[s+3]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const E = px(x, y), B = px(x, y - 1), D = px(x - 1, y), F = px(x + 1, y), H = px(x, y + 1);
    let e0 = E, e1 = E, e2 = E, e3 = E;
    if (!eq(B, H) && !eq(D, F)) {
      if (eq(D, B)) e0 = D;
      if (eq(B, F)) e1 = F;
      if (eq(D, H)) e2 = D;
      if (eq(H, F)) e3 = F;
    }
    set(x*2, y*2, e0); set(x*2+1, y*2, e1); set(x*2, y*2+1, e2); set(x*2+1, y*2+1, e3);
  }
  og.putImageData(od, 0, 0);
  return out;
}
const spriteHiRes = img => { try { return scale2x(scale2x(img)); } catch { return img; } };
/* Stadtbank — eigenes Sprite unter assets/bank.png. Solange es fehlt, springt
 * der Zeichencode auf das Handelskontor als Platzhalter zurück. */
let BANKSPR = null;
const BANKIMG = new Image(); BANKIMG.onload = () => BANKSPR = spriteHiRes(BANKIMG);
BANKIMG.src = "assets/bank.png";
/* Nachrichtenzentrale — sendet alle zwei Minuten den Marktbericht in den Chat. */
let NEWSSPR = null;
const NEWSIMG = new Image(); NEWSIMG.onload = () => NEWSSPR = spriteHiRes(NEWSIMG);
NEWSIMG.src = "assets/newstower.png";
/* Finanzamt und fertige Stadtprojekte: städtische Gebäude aus vorhandenen Sprites */
const STADT_SPR = {};
for (const [k, f] of Object.entries({ finanzamt: "buero-2", stadion: "hotel-0", krankenhaus: "pharma-0", hafen: "kontor-0",
                                       bibliothek: "buero-1", messe: "markt-0", bahnhof: "autohaus-0" })) {
  const im = new Image(); im.onload = () => STADT_SPR[k] = spriteHiRes(im); im.src = `assets/${f}.png`;
}
/* Vier Hochhaeuser als Kulisse im Zentrum. Sie gehoeren der Stadt, sind nicht
 * bebaubar und haben keinen Besitzer — reine Skyline. Der Server setzt das Feld
 * deko (1..4) auf ein paar zentrale Kacheln. */
const DEKOSPR = [];
for (let i = 1; i <= 4; i++) {
  const img = new Image();
  img.onload = () => DEKOSPR[i - 1] = spriteHiRes(img);
  img.src = `assets/deko/hochhaus-${i}.png`;
}
const dekoSprite = t => DEKOSPR[(t.deko - 1) % 4] || null;

/* ---- Wohnblöcke der Stadt (Sandkasten) ----
 * Prozedural wie die Altstadt-Häuser im Kartellmodus: drei Stufen
 * (Siedlungshaus, Mietblock, Wohnturm), vier Fassadenfarben, je eine Tag-
 * und eine Nachtfassung mit erleuchteten Fenstern. In doppelter Auflösung
 * gezeichnet, damit sie auf Retina-Displays nicht verschwimmen. */
const WOHN_FARBEN = [["#dcc7a8", "#b9a283"], ["#cbd5da", "#a5b2b9"], ["#e3c4b5", "#c09f90"], ["#d0d9c0", "#aab79a"]];
const WOHN_GEO = [null, { fw: 15, hh: 13, reihen: 1, spalten: 2 }, { fw: 21, hh: 32, reihen: 3, spalten: 3 }, { fw: 19, hh: 66, reihen: 7, spalten: 3 }];
const WOHN_W = 56, WOHN_H = 100, WOHN_BX = 28, WOHN_BY = 96;
function mkWohn(stufe, v, nacht) {
  const geo = WOHN_GEO[stufe], S = 2, c = document.createElement("canvas");
  c.width = WOHN_W * S; c.height = WOHN_H * S;
  const g = c.getContext("2d"); g.scale(S, S);
  const [hell, dunkel] = WOHN_FARBEN[v % WOHN_FARBEN.length], { fw, hh } = geo, bx = WOHN_BX, by = WOHN_BY;
  const poly = (...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); };
  g.fillStyle = dunkel; poly(bx, by, bx - fw, by - fw / 2, bx - fw, by - fw / 2 - hh, bx, by - hh);
  g.fillStyle = hell;   poly(bx, by, bx + fw, by - fw / 2, bx + fw, by - fw / 2 - hh, bx, by - hh);
  if (stufe === 1) {                                   // Satteldach
    const ry = by - hh - fw * .75;
    g.fillStyle = "#a8674f"; poly(bx, by - hh, bx + fw, by - fw / 2 - hh, bx, ry);
    g.fillStyle = "#8a5241"; poly(bx, by - hh, bx - fw, by - fw / 2 - hh, bx, ry);
  } else {                                             // Flachdach mit Attika
    g.fillStyle = "#8d949c"; poly(bx, by - hh, bx + fw, by - fw / 2 - hh, bx, by - fw - hh, bx - fw, by - fw / 2 - hh);
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = .8; g.stroke();
    if (stufe === 3) {                                 // Technikaufbau auf dem Turm
      const k = 6, top = by - fw - hh + fw / 2;
      g.fillStyle = "#6f767e"; poly(bx - k, top - k / 2 + 4, bx, top + 4, bx, top - 4, bx - k, top - k / 2 - 4);
      g.fillStyle = "#9aa1a8"; poly(bx, top + 4, bx + k, top - k / 2 + 4, bx + k, top - k / 2 - 4, bx, top - 4);
    }
  }
  /* Fenster: je Wand Spalten × Geschosse, nachts zufällig erleuchtet */
  const fh = (hh - 4) / geo.reihen, wh = Math.min(5, fh * .55);
  for (const seite of [1, -1]) for (let k = 0; k < geo.spalten; k++) for (let r = 0; r < geo.reihen; r++) {
    if (stufe === 1 && seite < 0 && k === 0) continue;      // dort ist die Haustür
    const u = (k + .5) / geo.spalten * fw, x = bx + seite * u, y = by - u / 2 - hh + 3 + r * fh;
    const an = nacht && (v * 7 + stufe * 3 + k * 5 + r * 11 + (seite > 0 ? 1 : 0)) % 3 !== 0;
    g.fillStyle = an ? "#ffd27a" : seite > 0 ? "#45505e" : "#353e4a";
    g.fillRect(x - 1.3, y, 2.6, wh);
    if (stufe === 2 && seite > 0) { g.fillStyle = "rgba(255,255,255,.45)"; g.fillRect(x - 2.2, y + wh + .6, 4.4, .8); }
  }
  if (stufe === 1) {
    g.fillStyle = "#5a4636"; g.fillRect(bx - fw * .25 - 1.6, by - fw * .125 - 8, 3.2, 7);
    if (nacht) { g.fillStyle = "rgba(255,210,120,.3)"; g.fillRect(bx - fw * .25 - 3, by - fw * .125 - 9, 6, 9); }
  }
  c.anker = by - fw / 2;
  return c;
}
const WOHNSPR = {};
const wohnSprite = (stufe, v, nacht) => WOHNSPR[stufe + ":" + v + ":" + nacht] ??= mkWohn(stufe, v, nacht);
/* Wohnblock auf seine Kachel: fertig als Haus, im Bau mit Gerüst und Kran.
 * Bei einem Ausbau bleibt das alte Haus stehen, bis der neue Block fertig ist. */
function wohnMalen(t, sx, sy, st) {
  const wb = t.wohnblock, v = (t.x * 7 + t.y * 13) % WOHN_FARBEN.length, nacht = LICHT < .5;
  const bau = (wb.bis && st.tick < wb.bis) || wb.auftrag, zeige = bau ? (wb.alt || 0) : wb.stufe;
  if (zeige) {
    const img = wohnSprite(zeige, v, nacht), oy = sy + TH / 2 - img.anker;
    schattenMalen(img, sx, sy + TH / 2 + 2, oy, WOHN_W, false, .35);
    cx.drawImage(img, sx - WOHN_BX, oy, WOHN_W, WOHN_H);
  }
  if (!bau) return;
  if (wb.auftrag) {
    /* Wartet auf Baumaterial: abgesteckter Bauplatz mit Ziegelpalette */
    const { fw } = WOHN_GEO[wb.stufe], fy = sy + TH / 2 + fw / 2;
    cx.save();
    cx.strokeStyle = "rgba(251,191,36,.8)"; cx.lineWidth = 1; cx.setLineDash([2, 3]);
    cx.beginPath(); cx.moveTo(sx, fy); cx.lineTo(sx + fw, fy - fw / 2); cx.lineTo(sx, fy - fw); cx.lineTo(sx - fw, fy - fw / 2); cx.closePath(); cx.stroke();
    cx.setLineDash([]);
    if (!wb.alt) {
      cx.fillStyle = "#a8674f"; cx.fillRect(sx - 6, sy + TH / 2 - 4, 12, 5);
      cx.fillStyle = "#c7825f"; cx.fillRect(sx - 4, sy + TH / 2 - 8, 8, 4);
    }
    cx.restore();
    return;
  }
  const { fw, hh } = WOHN_GEO[wb.stufe], fy = sy + TH / 2 + fw / 2;   // fy = vordere Ecke der Grundfläche
  cx.save();
  cx.strokeStyle = "rgba(251,191,36,.75)"; cx.lineWidth = 1; cx.setLineDash([3, 2]);
  cx.beginPath();
  for (const [x, y] of [[sx, fy], [sx + fw, fy - fw / 2], [sx - fw, fy - fw / 2]]) { cx.moveTo(x, y); cx.lineTo(x, y - hh); }
  cx.moveTo(sx - fw, fy - fw / 2 - hh); cx.lineTo(sx, fy - hh); cx.lineTo(sx + fw, fy - fw / 2 - hh);
  cx.moveTo(sx - fw, fy - fw / 2); cx.lineTo(sx, fy); cx.lineTo(sx + fw, fy - fw / 2);
  cx.stroke(); cx.setLineDash([]);
  /* Kran: Mast hinten rechts, Ausleger nach links, schwingender Haken */
  const mx = sx + fw - 3, mfuss = fy - fw / 2 - 4, mtop = mfuss - hh - 22;
  cx.strokeStyle = "#f59e0b"; cx.lineWidth = 1.6;
  cx.beginPath(); cx.moveTo(mx, mfuss); cx.lineTo(mx, mtop); cx.moveTo(mx + 6, mtop + 2); cx.lineTo(mx - fw * 1.6, mtop + 2); cx.stroke();
  const hx = mx - fw * (1 + .25 * Math.sin(performance.now() / 900 + t.x));
  cx.lineWidth = .8; cx.strokeStyle = "rgba(255,255,255,.7)";
  cx.beginPath(); cx.moveTo(hx, mtop + 2); cx.lineTo(hx, mtop + 18); cx.stroke();
  cx.restore();
  const dauer = st.stadt?.bauDauer || 60, anteil = Math.max(0, Math.min(1, 1 - (wb.bis - st.tick) / dauer));
  cx.fillStyle = "rgba(7,11,16,.7)"; cx.fillRect(sx - 14, sy + TH - 3, 28, 4);
  cx.fillStyle = "#fbbf24"; cx.fillRect(sx - 14, sy + TH - 3, 28 * anteil, 4);
}
/* Wie breit der Sockel eines Sprites ist — die breiteste sichtbare Zeile im
 * untersten Fuenftel. spriteGeo() misst die Gesamtbreite, und die taeuscht bei
 * einem Turm mit schmalem Fuss und ausladendem Aufbau: hochhaus-3 ist unten 37
 * Pixel breit, insgesamt aber 57. Nach Gesamtbreite skaliert stuende es
 * sichtbar ueber die Kachel hinaus. */
const sockelCache = new WeakMap();
function sockelBreite(img) {
  let v = sockelCache.get(img);
  if (v) return v;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const q = c.getContext("2d", { willReadFrequently: true });
  q.drawImage(img, 0, 0);
  try {
    const d = q.getImageData(0, 0, w, h).data;
    const zeile = [];
    for (let y = 0; y < h; y++) {
      let x0 = -1, x1 = -1;
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x0 < 0) x0 = x; x1 = x; }
      zeile[y] = x0 < 0 ? null : [x0, x1];
    }
    const sicht = zeile.map((r, y) => r ? y : -1).filter(y => y >= 0);
    const y0 = sicht[0], y1 = sicht[sicht.length - 1];
    let b = 2;
    for (let y = Math.floor(y1 - (y1 - y0) * 0.18); y <= y1; y++)
      if (zeile[y]) b = Math.max(b, zeile[y][1] - zeile[y][0] + 1);
    v = b;
  } catch { v = (img.naturalWidth || img.width) * 0.55; }
  sockelCache.set(img, v);
  return v;
}
/* Malgroesse, damit die Grundflaeche genauso breit aufsetzt wie bei der
 * Stadtbank (36 px bei 64 px Kachelbreite). Damit stehen alle vier Tuerme auf
 * genau einer Kachel, unabhaengig davon, wie schlank oder breit sie gezeichnet
 * sind — der schlanke Turm wird dadurch hoeher, nicht schmaler. */
const DEKO_SOCKEL = 36;
const dekoGroesse = img => DEKO_SOCKEL * (img.naturalWidth || img.width) / sockelBreite(img);

const SPRITE_VARIANTS = { farm:3, plantage:2, mine:3, ewerk:3, wasserwerk:2, oelpumpe:2, buero:3, brunnen:1, markt:1, kontor:1, laden:1, bauhandel:1, saftpresse:1, stahlwerk:1, pharma:1, ziegelei:1, betonwerk:1, imkerei:1, baeckerei:1, windpark:1, raffinerie:1, siliziummine:1, chipfabrik:1,
  autowerk:1, dieselwerk:1, eautowerk:1, autohaus:1, werbeagentur:1,
  campingplatz:1, strandhotel:1,
  munitionsfabrik:1, waffenschmiede:1, panzerwerk:1, waffenhandel:1,
  reifenwerk:1, rennlabor:1, rennstall:1 };
/* Reifenwerk und Rennlabor haben noch keine eigene Grafik und leihen sich
 * deshalb eine vorhandene. Ohne Sprite liefert spriteFor() null, und der
 * Zeichenzweig haengt an "if (spr)" — das Gebaeude waere sonst auf der Karte
 * unsichtbar, samt Besitzerfaerbung. Der Rennstall hat seit rennstall-0.png
 * sein eigenes Sprite und steht deshalb nicht mehr in dieser Liste. */
const SPRITE_ALIAS = { reifenwerk: "betonwerk", rennlabor: "chipfabrik" };
const SPRITES = {};
for (const [b, n] of Object.entries(SPRITE_VARIANTS)) {
  SPRITES[b] = [];
  for (let i = 0; i < n; i++) {
    const img = new Image();
    img.onload = () => SPRITES[b][i] = spriteHiRes(img);
    img.src = `assets/${SPRITE_ALIAS[b] || b}-${i}.png`;
  }
}
/* Gegenstueck zur Maskierung auf dem Server: Fuer Text-Zuweisungen
 * (textContent, value, title) muss sie wieder aufgeloest werden. Bewusst ueber
 * eine feste Tabelle statt ueber innerHTML eines Hilfselements — Letzteres
 * waere genau der Umweg, den die Maskierung verhindern soll. */
const ENTITAETEN = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const rohText = v => String(v ?? "").replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITAETEN[e]);

/* Gebaeude ohne eigenes Sprite leihen sich eins. Der Fan-Hub ist ein
 * Vermarktungsgebaeude wie die Werbeagentur und sieht auch so aus. */
const SPRITE_LEIHE = { fanhub: "werbeagentur",
  /* Software: Studio im Bürohaus, Rechenzentrum wie eine Chipfabrik, der
   * Online-Marktplatz übernimmt das Haus der Werbeagentur (er ersetzt sie). */
  entwicklerstudio: "buero", rechenzentrum: "chipfabrik", onlinemarkt: "werbeagentur",
  /* Kartellmodus: die Familien-Betriebe und das Casino tarnen sich als
   * unauffaellige Geschaefte — bis eigene Sprites da sind, passt das sogar
   * inhaltlich: illegale Betriebe SOLLEN aussehen wie legale. */
  destille: "saftpresse", druckerei: "chipfabrik", goldschmelze: "stahlwerk",
  schmuggellager: "bauhandel", casino: "autohaus" };
/* Bild-URL zum Sprite — fürs Kachelmenü (die geladenen Sprites sind Canvas). */
const spriteUrl = (btype, x, y) => {
  const b = SPRITE_VARIANTS[btype] ? btype : SPRITE_LEIHE[btype];
  const n = SPRITE_VARIANTS[b];
  return n ? `assets/${SPRITE_ALIAS[b] || b}-${(x * 7 + y * 13) % n}.png` : null;
};
const spriteFor = (btype, x, y) => {
  const arr = SPRITES[btype] || SPRITES[SPRITE_LEIHE[btype]];
  return arr?.length ? arr[(x * 7 + y * 13) % arr.length] : null;
};
/* Natur-Deko (Kenney Nature Kit, CC0): Bäume, Palmen, Felsen, Getreidefelder */
const DECO = { tree: [], palm: [], rock: [], field: [] };
/* Deko sass exakt auf dem Kachelmittelpunkt — ein perfektes Gitter, das in der
 * Isometrie als Streifen zu sehen war. Jetzt wird jedes Stueck innerhalb seiner
 * Kachel versetzt und in der Groesse variiert.
 *
 * Deterministisch aus der Kachelkoordinate, nicht per Math.random(): Die Karte
 * wird jedes Bild neu gezeichnet, ein Zufallswert je Bild liesse die Baeume
 * zappeln — und alle Clients muessen ohnehin dasselbe sehen.
 *
 * Der Versatz wird in Kachelkoordinaten gewuerfelt und erst dann isometrisch
 * abgebildet. In Bildschirmkoordinaten gestreut waeren die Baeume ueber die
 * Rautenkante auf die Strasse gewandert. */
const streu = (x, y, k) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return n - Math.floor(n);
};
function streuVersatz(t, weite = .5) {
  const du = (streu(t.x, t.y, 1) - .5) * weite, dv = (streu(t.x, t.y, 2) - .5) * weite;
  return [(du - dv) * TW / 2, (du + dv) * TH / 2];
}
for (const [d, n] of [["tree", 5], ["palm", 2], ["rock", 3], ["field", 3]]) for (let i = 0; i < n; i++) {
  const img = new Image();
  img.onload = () => DECO[d][i] = img;
  img.src = `assets/deco/${d}-${i}.png`;
}
const decoFor = (t) => {
  const arr = t.zone === "kueste" ? DECO.palm : DECO.tree;
  return arr.length ? arr[(t.x * 11 + t.y * 5) % arr.length] : null;
};
/* Wo auf einer Parkkachel Baeume stehen — Anzahl, Versatz, Groesse und Sprite.
 *
 * Genau ein Baum je Kachel sah gepflanzt aus, egal wie stark man ihn versetzt:
 * die Anzahl selbst verraet das Raster. Deshalb traegt eine Kachel keinen,
 * einen oder zwei Baeume — das gibt Luecken und Gruppen.
 *
 * Deterministisch aus der Kachelkoordinate: Der Schattendurchgang und der
 * Zeichendurchgang muessen dieselben Stellen benutzen, die Karte wird jedes
 * Bild neu gezeichnet, und alle Clients sollen dasselbe sehen. */
function dekoStellen(t) {
  const arr = t.zone === "kueste" ? DECO.palm : DECO.tree;
  if (!arr.length) return [];
  const dichte = streu(t.x, t.y, 5);
  const anzahl = dichte < .20 ? 0 : dichte < .74 ? 1 : 2;
  const out = [];
  for (let i = 0; i < anzahl; i++) {
    const du = (streu(t.x, t.y, 10 + i * 4) - .5) * .8;
    const dv = (streu(t.x, t.y, 11 + i * 4) - .5) * .8;
    const img = arr[Math.floor(streu(t.x, t.y, 12 + i * 4) * arr.length) % arr.length];
    if (!img) continue;
    out.push({ img, ox: (du - dv) * TW / 2, oy: (du + dv) * TH / 2,
               gr: 72 + streu(t.x, t.y, 13 + i * 4) * 32 });
  }
  return out;
}
function shade(hex, amt){ const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v));
  return `rgb(${c((n>>16)+amt)},${c(((n>>8)&255)+amt)},${c((n&255)+amt)})`; }

/* Himmel-Hintergrund (Kenney Skyboxes, CC0) — nur ein leichter Ausschnitt (115 KB statt 1 MB Panorama) */
/* (Himmelsbild entfällt — siehe draw(): Hintergrund ist jetzt #bgTopo) */

/* Ambient-Deko (Kenney Car-Kit / Mini-Characters, CC0): rein kosmetische, clientseitige
 * Bewegung entlang der Straßen — Position ist reine Funktion der Wanduhrzeit, braucht
 * keinen Server-Zustand. */
const AMBIENT = { cars: [], people: [] };
const AMBIENT_FILES = {
  cars: ["taxi", "sedan", "suv", "delivery", "police"],
  people: ["character-male-a", "character-male-c", "character-male-e", "character-female-a", "character-female-c", "character-female-e"],
};
for (const [cat, files] of Object.entries(AMBIENT_FILES)) for (const f of files) {
  const img = new Image();
  /* Wie bei Gebaeuden und LKW hochrechnen: die Kenney-Sprites liegen klein vor
   * und wurden beim Hineinzoomen sichtbar grob. */
  img.onload = () => AMBIENT[cat].push(spriteHiRes(img));
  img.src = `assets/kenney/${cat}/${f}.png`;
}
/* Bewegungspfade werden einmal aus der (statischen) Karte abgeleitet und gecacht. */
let ROUTES = null;
function buildRoutes(map) {
  const cols = {}, rows = {};
  for (const t of map) {
    if (!t.road) continue;
    (cols[t.x] ??= []).push(t);
    (rows[t.y] ??= []).push(t);
  }
  /* Nur ZUSAMMENHÄNGENDE Straßenzüge werden Fahrspuren: Auf der Kartell-Karte
   * liegen in einer Spalte mehrere getrennte Gassen-Stücke — als eine Linie
   * verkettet fuhren die Autos schnurgerade über die Wiese dazwischen. Deshalb
   * an jeder Lücke trennen und nur lange Stücke behalten (kurze Gassen haben
   * keinen Durchgangsverkehr). */
  const stuecke = (tiles, koord) => {
    const runs = []; let run = [];
    for (const t of tiles) {
      if (run.length && t[koord] - run[run.length - 1][koord] !== 1) {
        if (run.length > 10) runs.push(run);
        run = [];
      }
      run.push(t);
    }
    if (run.length > 10) runs.push(run);
    return runs;
  };
  /* Spalten- und Zeilenstraßen abwechselnd einreihen — vorher kamen erst alle
   * Spalten, und die ersten vier Züge (die Autos) fuhren dadurch alle in
   * dieselbe Bildschirmrichtung. */
  const colLines = [], rowLines = [];
  for (const k in cols) colLines.push(...stuecke(cols[k].sort((a, b) => a.y - b.y), "y"));
  for (const k in rows) rowLines.push(...stuecke(rows[k].sort((a, b) => a.x - b.x), "x"));
  const carLines = [];
  for (let i = 0; i < Math.max(colLines.length, rowLines.length); i++) {
    if (colLines[i]) carLines.push(colLines[i]);
    if (rowLines[i]) carLines.push(rowLines[i]);
  }
  return { carLines };
}
/* Position (in Kachel-Koordinaten) auf einer Punktfolge bei "Wegposition" u — pendelt vor & zurück. */
function tilePosAtU(tiles, u) {
  const n = tiles.length; if (n < 2) return null;
  const period = (n - 1) * 2;
  u = ((u % period) + period) % period;
  const p = u < n - 1 ? u : period - u;
  const i = Math.floor(p), f = p - i, a = tiles[i], b = tiles[Math.min(i + 1, n - 1)];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
/* ---- Verkehr in der Tiefensortierung ----
 * Autos, Fussgaenger und LKW wurden bisher NACH der kompletten Kachelschleife
 * gezeichnet und lagen dadurch ueber allem: Ein Fahrzeug weit hinten fuhr
 * sichtbar ueber ein Gebaeude im Vordergrund. Jetzt wird jedes Fahrzeug der
 * Kachel zugeordnet, auf der es gerade steht, und zusammen mit dieser Kachel
 * gemalt — damit gilt fuer den Verkehr dieselbe Reihenfolge wie fuer alles
 * andere auf der Karte. */
const VERKEHR = new Map();
function verkehrMerken(tx, ty, fn) {
  if (!EINST.verkehr) return;
  const k = Math.round(tx) + "," + Math.round(ty);
  let l = VERKEHR.get(k);
  if (!l) VERKEHR.set(k, l = []);
  l.push(fn);
}
function verkehrZeichnen(tx, ty) {
  const l = VERKEHR.get(tx + "," + ty);
  if (!l) return;
  for (const fn of l) fn();
  VERKEHR.delete(tx + "," + ty);
}
/* Was ausserhalb der sichtbaren Kacheln landet, wuerde sonst nie gezeichnet
 * und die Sammlung immer weiter wachsen. */
function verkehrRest() { for (const l of VERKEHR.values()) for (const fn of l) fn(); VERKEHR.clear(); }

/* ---- Scheinwerfer ----
 * Nachts fuhren die Autos unbeleuchtet durch eine Stadt, in der jedes Gebaeude
 * Fensterlicht zeigt. Ein erster Versuch mit dem runden Fensterlicht-Fleck sah
 * falsch aus: eine Kugel, die neben dem Fahrzeug in der Luft schwebte. Licht
 * gehoert auf die Strasse — also eine flache Pfuetze in der Isometrie-Ebene
 * (doppelt so breit wie hoch, wie jede Grundflaeche hier), vor das Fahrzeug in
 * Fahrtrichtung gelegt. Nur der Kegel, keine Lampen und kein Ruecklicht: bei
 * 28 px Fahrzeuggroesse wurden daraus bloss Punkte, die auf der Karosserie
 * klebten, statt nach Leuchten auszusehen.
 * Alle Strassen laufen entlang der Weltachsen, ein Fahrzeug bewegt sich auf dem
 * Bildschirm also immer im Verhaeltnis 2:1 nach unten — daher der feste
 * Richtungsvektor. */
const LICHTPFUETZE = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,224,150,.66)");
  grad.addColorStop(.45, "rgba(255,203,110,.30)");
  grad.addColorStop(1, "rgba(255,190,90,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return c;
})();
function scheinwerfer(sx, bodenY, dirX, groesse) {
  if (LICHT >= .55) return;
  const a = Math.min(1, (.55 - LICHT) * 1.8);
  /* Fahrtrichtung auf dem Bildschirm: 2:1 nach unten, dirX gibt die Seite an. */
  const d = groesse * .62, ox = dirX * d * .894, oy = d * .447;
  cx.save();
  cx.globalCompositeOperation = "lighter";   // Licht addiert sich auf den Asphalt, statt ihn zu ueberdecken
  cx.globalAlpha = a * .9;
  cx.translate(sx + ox, bodenY + oy);
  /* In Fahrtrichtung gestreckt, quer dazu schmal — sonst liegt da ein runder
   * Fleck statt eines Lichtkegels. Gedreht um den Winkel der 2:1-Achse. */
  cx.rotate(Math.atan2(.447, dirX * .894));
  cx.scale(1.4, .5);
  const r = groesse * .8;
  cx.drawImage(LICHTPFUETZE, -r, -r, r * 2, r * 2);
  cx.restore();
}
function drawAmbient(now) {
  VERKEHR.clear();
  if (!ROUTES) return;
  /* Fussgaenger sind zu klein fuer einen geworfenen Schatten — sie behalten
   * ihren Fleck, der aber jetzt mit der Sonne verschwindet statt nachts
   * unveraendert stehen zu bleiben. */
  const shadow = (sx, sy, rx, ry) => { const st = sonnenStaerke(); if (st <= 0) return;
    cx.globalAlpha = st; cx.fillStyle = "rgba(0,0,0,.22)";
    cx.beginPath(); cx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; };
  /* Autos wie auf einem Laufband: jedes fährt vom einen Kartenrand zum
   * anderen und wird dort entfernt; nach einer kurzen Lücke spawnt am
   * Startrand ein anderes Modell. Das frühere Hin- und Herpendeln sah aus,
   * als führe das Auto die halbe Zeit rückwärts. Jede zweite Straße fährt
   * in Gegenrichtung, und das Sprite wird zur Fahrtrichtung gespiegelt. */
  /* Kartellmodus: die Stadt lebt — mehr Straßenzüge mit Verkehr und drei
   * statt zwei Autos je Zug. Zwischen den Familien ist immer Betrieb. */
  const kartellStadt = store.get().state?.mode === "kartell";
  ROUTES.carLines.slice(0, kartellStadt ? 14 : 8).forEach((line, i) => {
    if (!AMBIENT.cars.length || line.length < 2) return;
    const n = line.length;
    /* DDR-Optik: der Verkehr zuckelt — Trabi-Tempo statt Berufsverkehr. */
    const speed = (0.35 + i * 0.04) * (PLAN_LOOK ? .55 : 1);
    const luecke = 5;                       // Abstand zwischen Despawn und neuem Spawn
    const period = n - 1 + luecke;
    /* Zwei versetzte Autos pro Straßenzug — dichterer Verkehr. */
    for (let j = 0; j < (kartellStadt ? 3 : 2); j++) {
    const total = now / 1000 * speed + i * 7 + j * period / 2;
    const u = total % period;
    if (u > n - 1) continue;                // Auto hat den Rand erreicht und ist entfernt
    /* Pro Durchlauf ein anderes Modell — so wirkt es wie neuer Verkehr. */
    const lap = Math.floor(total / period);
    const spr = AMBIENT.cars[(i * 3 + j * 2 + lap) % AMBIENT.cars.length];
    if (!spr) continue;
    /* Die Kenney-Sprites sind Isometrie-Ansichten mit Blick nach unten-links;
     * eine Rückansicht gibt es nicht. Deshalb fahren alle Autos abwärts —
     * oben am Rand gespawnt, unten wieder entfernt. Die Zeilen sind nach
     * aufsteigender Koordinate sortiert, Index 0 liegt also immer oben.
     * Für Fahrten nach unten-rechts wird das Sprite gespiegelt. */
    const idx = Math.max(0, Math.min(Math.floor(u), n - 2)), f = u - idx;
    const a = line[idx], b = line[idx + 1];
    const [sx, sy] = iso(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    const [ax] = iso(a.x, a.y), [bx] = iso(b.x, b.y);
    const tx = a.x + (b.x - a.x) * f, ty = a.y + (b.y - a.y) * f;
    const nachLinks = !(bx > ax);
    verkehrMerken(tx, ty, () => {
    /* Derselbe Schattenwurf wie bei den Gebaeuden statt der frueheren festen
     * Ellipse — die lag auch nachts noch unter dem Auto, obwohl keine Sonne
     * schien, und zeigte in keine Richtung. */
    schattenMalen(spr, sx, sy + TH / 2 + 3, sy + TH / 2 - 20, 28, !nachLinks, .42);
    /* DDR-Optik: Blechfarben statt Buntlack, dazu eine Zweitakt-Abgasfahne. */
    if (PLAN_LOOK) {
      cx.filter = "saturate(.35) sepia(.25) brightness(.92)";
      cx.fillStyle = "#8d919b";
      for (let a2 = 0; a2 < 2; a2++) {
        const k2 = ((now / 400 + a2 * .5 + i) % 1 + 1) % 1;
        cx.globalAlpha = (1 - k2) * .3;
        cx.beginPath();
        cx.arc(sx + (bx > ax ? -13 : 13) - (bx > ax ? 1 : -1) * k2 * 9, sy + TH / 2 - 6 - k2 * 5, 2 + k2 * 3, 0, Math.PI * 2);
        cx.fill();
      }
      cx.globalAlpha = 1;
    }
    if (bx > ax) {                          // Fahrt nach unten-rechts → spiegeln
      cx.save(); cx.translate(sx, 0); cx.scale(-1, 1);
      cx.drawImage(spr, -14, sy + TH / 2 - 20, 28, 28);
      cx.restore();
    } else {
      cx.drawImage(spr, sx - 14, sy + TH / 2 - 20, 28, 28);
    }
    cx.filter = "none";
    scheinwerfer(sx, sy + TH / 2, nachLinks ? -1 : 1, 28);
    });
    }
  });
  /* Fußgänger: kleine Pendelwege auf den Straßenzügen (Bürgersteig-Ersatz).
   * Im Sandkasten wächst ihre Zahl mit der Einwohnerzahl (Pendler) — tagsüber
   * eine Figur je 120 Einwohner, höchstens 18; nachts bleibt es bei den sechs. */
  const stadtJetzt = store.get().state?.stadt;
  const pendler = stadtJetzt && LICHT > .35 ? Math.min(18, Math.floor(stadtJetzt.einwohner / 120)) : 0;
  const nPers = Math.max(AMBIENT.people.length, pendler);
  ROUTES.carLines.slice(4, 4 + nPers).forEach((line, i) => {
    const spr = AMBIENT.people[i % AMBIENT.people.length]; if (!spr || line.length < 2) return;
    const pos = tilePosAtU(line, now / 1000 * (0.18 + i * 0.03) + i * 3); if (!pos) return;
    const [sx, sy] = iso(pos.x, pos.y);
    verkehrMerken(pos.x, pos.y, () => {
      shadow(sx, sy + TH / 2 + 2, 6, 3);
      cx.drawImage(spr, sx - 9, sy + TH / 2 - 16, 18, 18);
    });
  });
}

/* ---- Wolken & Luftbild-Stimmung ----
 * Weiche, prozedural erzeugte Wolken ziehen langsam über die Stadt: ihr
 * Schatten liegt auf dem Boden, die Wolke selbst schwebt mit leichtem
 * Parallax-Versatz darüber — beim Verschieben der Kamera wandert sie etwas
 * schneller mit und wirkt dadurch näher an der Kamera als die Karte.
 * Dazu ein dezenter Höhendunst und eine Vignette in Bildschirmkoordinaten,
 * wie beim Blick aus dem Flugzeugfenster. Alles rein kosmetisch und
 * clientseitig; die Positionen sind reine Funktionen der Wanduhrzeit. */
function makeCloud(seed) {
  const c = document.createElement("canvas"); c.width = 560; c.height = 280;
  const g = c.getContext("2d");
  let r = seed;
  const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  g.filter = "blur(10px)";
  const n = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const x = 110 + rnd() * 340, y = 105 + rnd() * 70, rad = 34 + rnd() * 52;
    const grad = g.createRadialGradient(x, y, rad * .15, x, y, rad);
    grad.addColorStop(0, "rgba(255,255,255,.9)");
    grad.addColorStop(.7, "rgba(248,250,253,.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  /* Schattenvariante: gleiche Silhouette, aber dunkel eingefärbt. */
  const s = document.createElement("canvas"); s.width = c.width; s.height = c.height;
  const sg = s.getContext("2d");
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = "source-in";
  sg.fillStyle = "#0b1524"; sg.fillRect(0, 0, s.width, s.height);
  return { puff: c, schatten: s };
}
const CLOUD_SPAN = 1700;                   // Welt-Ausdehnung, in der die Wolken kreisen
const CLOUDS = [];
for (let i = 0; i < 7; i++) {
  const { puff, schatten } = makeCloud(37 + i * 101);
  CLOUDS.push({
    puff, schatten,
    x: -CLOUD_SPAN + (i * 2 * CLOUD_SPAN) / 7 + (i % 3) * 130,
    y: -140 + ((i * 379) % 900),
    w: 300 + (i % 4) * 90,
    speed: 7 + (i % 3) * 3.5,              // Weltpixel pro Sekunde — gemächlicher Wind
    alpha: .5 + (i % 3) * .12
  });
}
const wrapX = v => ((v + CLOUD_SPAN) % (2 * CLOUD_SPAN) + 2 * CLOUD_SPAN) % (2 * CLOUD_SPAN) - CLOUD_SPAN;
/* Wird innerhalb der Welt-Transformation aufgerufen: Schatten direkt auf die
 * Stadt, danach die Wolken mit Parallax-Versatz gegen die Kameraposition. */
function drawClouds(now) {
  if (!EINST.wolken) return;
  for (const cl of CLOUDS) {
    const wx = wrapX(cl.x + now / 1000 * cl.speed), wy = cl.y;
    const h = cl.w / 2;
    cx.globalAlpha = .12;
    cx.drawImage(cl.schatten, wx - cl.w / 2 + 26, wy - h / 2 + 34, cl.w, h);
    cx.globalAlpha = 1;
  }
  for (const cl of CLOUDS) {
    const wx = wrapX(cl.x + now / 1000 * cl.speed), wy = cl.y;
    /* Parallax: näher an der Kamera als der Boden — wandert beim Schwenken mit. */
    const pxo = cam.x * .22 / cam.z, pyo = cam.y * .22 / cam.z;
    const h = cl.w / 2;
    /* DDR-Optik: graue, tiefer hängende Wolkendecke statt Schäfchenwolken. */
    if (PLAN_LOOK) cx.filter = "brightness(.7) saturate(.4)";
    cx.globalAlpha = PLAN_LOOK ? Math.min(1, cl.alpha + .18) : cl.alpha;
    cx.drawImage(cl.puff, wx - cl.w / 2 + pxo, wy - h / 2 + pyo, cl.w, h);
    cx.filter = "none";
    cx.globalAlpha = 1;
  }
}
/* Bildschirmraum: Höhendunst (oben heller, bläulich) und Vignette an den
 * Rändern. Die Verläufe werden pro Fenstergröße einmal gebaut. */
let ATMO = null, ATMO_KEY = "";
/* Die Spielkarte liegt auf durchsichtigem Grund über der Höhenlinien-Karte
 * (#bgTopo). Die Atmosphäre-Pässe unten sind Vollbild-Fills — sie dürfen nur
 * auf der Insel landen, sonst deckt v. a. der Multiply-Tint den Hintergrund zu.
 * Früher per Pixelmaske (zwei Vollbild-Kopien je Bild — der größte Bremsklotz
 * beim Scrollen). Jetzt: einfacher Umriss der Insel (konvexe Hülle aller
 * Kachelecken, nach oben um Gebäudehöhe erweitert) als Clip. */
let HUELLE = null, HUELLE_KEY = "";
/* Exakter Umriss aller Kacheln, zusammengefasst zu Streifen: je Reihe werden
 * aufeinanderfolgende Kacheln zu EINEM Parallelogramm — bei der 30x30-Insel
 * 30 statt 900 Teilflächen. Kein Überstand, also auch kein Schleier über
 * leerem Hintergrund. */
function inselHuelle(map) {
  const key = map.length + ":" + (map[0]?.x ?? 0) + ":" + (map[map.length - 1]?.y ?? 0);
  if (HUELLE && HUELLE_KEY === key) return HUELLE;
  const reihen = new Map();
  for (const t of map) { if (!reihen.has(t.y)) reihen.set(t.y, []); reihen.get(t.y).push(t.x); }
  HUELLE = new Path2D();
  for (const [y, xs] of reihen) {
    xs.sort((a, b) => a - b);
    let a = xs[0];
    for (let k = 1; k <= xs.length; k++) {
      if (k < xs.length && xs[k] === xs[k - 1] + 1) continue;
      const b = xs[k - 1];
      const [ax, ay] = iso(a, y), [bx, by] = iso(b, y);
      HUELLE.moveTo(ax, ay - 1);                       // Spitze der ersten Kachel
      HUELLE.lineTo(bx + TW / 2 + 1, by + TH / 2);     // rechte Ecke der letzten
      HUELLE.lineTo(bx, by + TH + 1);                  // untere Ecke der letzten
      HUELLE.lineTo(ax - TW / 2 - 1, ay + TH / 2);     // linke Ecke der ersten
      HUELLE.closePath();
      if (k < xs.length) a = xs[k];
    }
  }
  HUELLE_KEY = key;
  return HUELLE;
}
function drawAtmosphere() {
  if (!EINST.licht) return;
  const st = store.get().state;
  cx.save();
  if (st?.map?.length && draw.welt) { cx.setTransform(draw.welt); cx.clip(inselHuelle(st.map)); }
  atmosphaereMalen();
  cx.restore();
  cx.setTransform(DPR(), 0, 0, DPR(), 0, 0);
}
function atmosphaereMalen() {
  cx.setTransform(DPR(), 0, 0, DPR(), 0, 0);
  const key = innerWidth + "x" + innerHeight;
  if (ATMO_KEY !== key) {
    const haze = cx.createLinearGradient(0, 0, 0, innerHeight);
    haze.addColorStop(0, "rgba(190,214,240,.16)");
    haze.addColorStop(.4, "rgba(190,214,240,.05)");
    haze.addColorStop(1, "rgba(190,214,240,0)");
    const r = Math.hypot(innerWidth, innerHeight) / 2;
    const vig = cx.createRadialGradient(innerWidth / 2, innerHeight / 2, r * .55, innerWidth / 2, innerHeight / 2, r);
    vig.addColorStop(0, "rgba(4,8,16,0)");
    vig.addColorStop(1, "rgba(4,8,16,.32)");
    ATMO = { haze, vig }; ATMO_KEY = key;
  }
  /* DDR-Optik: kräftig entsättigen (Saturation-Blend erhält die Helligkeit)
   * plus ein graubrauner Schleier — Ostberliner November statt Südsee. */
  if (PLAN_LOOK) {
    cx.globalCompositeOperation = "saturation";
    cx.globalAlpha = .55;
    cx.fillStyle = "hsl(220,10%,60%)";
    cx.fillRect(0, 0, innerWidth, innerHeight);
    cx.globalCompositeOperation = "source-over";
    cx.globalAlpha = 1;
    cx.fillStyle = "rgba(122,116,102,.10)";
    cx.fillRect(0, 0, innerWidth, innerHeight);
  }
  cx.fillStyle = ATMO.haze; cx.fillRect(0, 0, innerWidth, innerHeight);
  cx.fillStyle = ATMO.vig;  cx.fillRect(0, 0, innerWidth, innerHeight);
  /* ---- Farb-Grading („Shader") ----
   * Früher: flacher Orange- bzw. Dunkel-Schleier — das wusch die Szene milchig
   * aus. Jetzt drei abgestimmte Pässe, alle nur Vollbild-Fills:
   *  1) MULTIPLY-Farbton = Farbtemperatur des Tages (erhält Kontraste:
   *     Mittag fast neutral, goldene Stunde warm, Nacht kühles Blau)
   *  2) Dämmerung als HIMMELSVERLAUF von oben statt flacher Fläche
   *  3) nachts ein zarter MONDLICHT-Glanz (screen) von oben + Rest-Dunkel
   * Verläufe werden je Fenstergröße gecacht; der Tint ist ein billiger Fill. */
  const lerp3 = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  let tint;
  if (LICHT > .55)      tint = lerp3([255, 246, 232], [255, 253, 250], (LICHT - .55) / .45);  // Tag: Hauch warm
  else if (LICHT > .28) tint = lerp3([255, 208, 162], [255, 246, 232], (LICHT - .28) / .27);  // goldene Stunde
  else                  tint = lerp3([76, 90, 146], [255, 208, 162], LICHT / .28);            // Nacht: kühles Blau
  /* Kartenpapier: Die Karte soll wie gedruckt wirken — Tageszeit nur angedeutet,
   * sonst wird das helle Papier nachts zu einem schmutzigen Violett. */
  const PAPIER = document.documentElement.dataset.theme === "papier";
  if (PAPIER) tint = tint.map(v => Math.round(v + (255 - v) * .8));
  cx.globalCompositeOperation = "multiply";
  cx.fillStyle = `rgb(${tint.join(",")})`;
  cx.fillRect(0, 0, innerWidth, innerHeight);
  cx.globalCompositeOperation = "source-over";
  if (DAEMMERUNG > .01 && !PAPIER) {
    /* Der Himmel brennt oben, der Boden bleibt ruhig */
    const d = Math.round(DAEMMERUNG * 100);
    if (!ATMO.daemmer || ATMO.daemmerKey !== d) {
      const g = cx.createLinearGradient(0, 0, 0, innerHeight);
      g.addColorStop(0,  `rgba(255,132,58,${(DAEMMERUNG * .30).toFixed(3)})`);
      g.addColorStop(.45, `rgba(255,96,96,${(DAEMMERUNG * .10).toFixed(3)})`);
      g.addColorStop(1,  "rgba(255,132,58,0)");
      ATMO.daemmer = g; ATMO.daemmerKey = d;
    }
    cx.fillStyle = ATMO.daemmer;
    cx.fillRect(0, 0, innerWidth, innerHeight);
  }
  const nacht = 1 - LICHT;
  if (nacht > .02 && !PAPIER) {
    /* Rest-Dunkel deutlich schwächer als früher (das Multiply-Blau trägt
     * die Nacht) — dafür oben ein kühler Glanz, als stünde der Mond hoch. */
    cx.fillStyle = `rgba(7,11,30,${(nacht * .34).toFixed(3)})`;
    cx.fillRect(0, 0, innerWidth, innerHeight);
    const m = Math.round(nacht * 100);
    if (!ATMO.mond || ATMO.mondKey !== m) {
      const g = cx.createRadialGradient(innerWidth * .5, -innerHeight * .15, 0,
                                        innerWidth * .5, -innerHeight * .15, innerHeight * .95);
      g.addColorStop(0, `rgba(150,178,232,${(nacht * .14).toFixed(3)})`);
      g.addColorStop(1, "rgba(150,178,232,0)");
      ATMO.mond = g; ATMO.mondKey = m;
    }
    cx.globalCompositeOperation = "screen";
    cx.fillStyle = ATMO.mond;
    cx.fillRect(0, 0, innerWidth, innerHeight);
    cx.globalCompositeOperation = "source-over";
  }
}

/* ---- Liefer-LKWs ----
 * Rein kosmetischer Wirtschaftsverkehr: Ein LKW spawnt am oberen Kartenrand,
 * fährt seinen Straßenzug hinunter bis zur Kachel, die einem zufällig
 * gewählten Gebäude am nächsten liegt, hält dort kurz zum Anliefern (eine
 * kleine Kiste hüpft), und fährt dann weiter bis zum unteren Rand, wo er
 * verschwindet. Anders als die Pendler brauchen LKWs echten Zustand
 * (anhalten und weiterfahren), deshalb keine reine Uhrzeit-Funktion. */
const TRUCKIMG = new Image(); let TRUCKSPR = null;
TRUCKIMG.onload = () => TRUCKSPR = spriteHiRes(TRUCKIMG);
TRUCKIMG.src = "assets/kenney/cars/delivery.png";
const TRUCKS = [];
let naechsterTruck = 0;
function trucksAktualisieren(st, now, dt) {
  if (!ROUTES || !TRUCKSPR) return;
  if (TRUCKS.length < 3 && now >= naechsterTruck) {
    naechsterTruck = now + 8000 + Math.random() * 7000;
    const gebaeude = st.map.filter(t => t.btype);
    if (gebaeude.length) {
      const ziel = gebaeude[Math.floor(Math.random() * gebaeude.length)];
      /* Straßenzug und Haltepunkt mit dem geringsten Abstand zum Ziel. */
      let best = null;
      for (const line of ROUTES.carLines) for (let i = 0; i < line.length; i++) {
        const d = Math.hypot(line[i].x - ziel.x, line[i].y - ziel.y);
        if (!best || d < best.d) best = { line, i, d };
      }
      if (best && best.d <= 3 && best.i > 0) {
        TRUCKS.push({ line: best.line, halt: best.i, u: 0, phase: "hin", wartenBis: 0 });
      }
    }
  }
  for (let i = TRUCKS.length - 1; i >= 0; i--) {
    const lkw = TRUCKS[i];
    if (lkw.phase === "laden") {
      if (now >= lkw.wartenBis) lkw.phase = "weiter";
      continue;
    }
    lkw.u += dt * .5;
    if (lkw.phase === "hin" && lkw.u >= lkw.halt) {
      lkw.u = lkw.halt; lkw.phase = "laden"; lkw.wartenBis = now + 3500;
    }
    if (lkw.u >= lkw.line.length - 1) TRUCKS.splice(i, 1);
  }
}
function drawTrucks(now) {
  if (!EINST.verkehr) return;
  if (!TRUCKSPR) return;
  for (const lkw of TRUCKS) {
    const n = lkw.line.length;
    const idx = Math.max(0, Math.min(Math.floor(lkw.u), n - 2)), f = lkw.u - idx;
    const a = lkw.line[idx], b = lkw.line[idx + 1];
    const [sx, sy] = iso(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    const [ax] = iso(a.x, a.y), [bx] = iso(b.x, b.y);
    verkehrMerken(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, () => {
    schattenMalen(TRUCKSPR, sx, sy + TH / 2 + 3, sy + TH / 2 - 22, 30, bx > ax, .42);
    if (PLAN_LOOK) cx.filter = "saturate(.35) sepia(.25) brightness(.92)";
    if (bx > ax) {
      cx.save(); cx.translate(sx, 0); cx.scale(-1, 1);
      cx.drawImage(TRUCKSPR, -15, sy + TH / 2 - 22, 30, 30);
      cx.restore();
    } else {
      cx.drawImage(TRUCKSPR, sx - 15, sy + TH / 2 - 22, 30, 30);
    }
    cx.filter = "none";
    scheinwerfer(sx, sy + TH / 2, bx > ax ? 1 : -1, 30);
    if (lkw.phase === "laden") {
      /* Anlieferung: eine kleine Kiste hüpft neben dem LKW. */
      const hop = Math.abs(Math.sin(now / 220)) * 5;
      cx.fillStyle = "#b0793f";
      cx.fillRect(sx + 11, sy + TH / 2 - 12 - hop, 7, 6);
      cx.strokeStyle = "#7a5228"; cx.strokeRect(sx + 11, sy + TH / 2 - 12 - hop, 7, 6);
    }
    });
  }
  /* ---- Kartellmodus: Werttransporte und Straßensperren ----
   * Die Transporte kommen als Serverposition im Sekundentakt — der Client
   * gleitet sanft hinterher, statt zu springen. Ein goldener Puls-Ring
   * signalisiert: anklicken heißt überfallen. */
  const stM = store.get().state;
  if (stM?.mode === "kartell") {
    const schatten = (sx, sy, rx, ry) => { const s2 = sonnenStaerke(); if (s2 <= 0) return;
      cx.globalAlpha = s2; cx.fillStyle = "rgba(0,0,0,.22)";
      cx.beginPath(); cx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; };
    for (const tr of stM.transporte || []) {
      let an = TRANSPORT_ANIM.get(tr.id);
      if (!an) { an = { x: tr.x, y: tr.y }; TRANSPORT_ANIM.set(tr.id, an); }
      an.x += (tr.x - an.x) * .08; an.y += (tr.y - an.y) * .08;
      const [sx, sy] = iso(an.x, an.y);
      verkehrMerken(an.x, an.y, () => {
        const puls = 1 + Math.sin(now / 250) * .12;
        cx.strokeStyle = tr.gestoppt ? "rgba(255,120,90,.85)" : "rgba(245,197,66,.7)";
        cx.lineWidth = 2;
        cx.beginPath(); cx.ellipse(sx, sy + TH / 2, 17 * puls, 9 * puls, 0, 0, Math.PI * 2); cx.stroke();
        schatten(sx, sy + TH / 2 + 2, 13, 5);
        cx.fillStyle = "#2c3444"; cx.fillRect(sx - 12, sy + TH / 2 - 18, 24, 15);
        cx.fillStyle = "#3d4a61"; cx.fillRect(sx - 12, sy + TH / 2 - 18, 24, 4);
        cx.fillStyle = "#f5c542"; cx.fillRect(sx - 12, sy + TH / 2 - 9, 24, 2);
        cx.fillStyle = "#141a26"; cx.fillRect(sx - 9, sy + TH / 2 - 3, 5, 3); cx.fillRect(sx + 4, sy + TH / 2 - 3, 5, 3);
        cx.font = "11px sans-serif"; cx.textAlign = "center";
        cx.fillText(tr.art === "geld" ? "💰" : tr.art === "waffen" ? "🔫" : "🪙", sx, sy + TH / 2 - 22);
      });
    }
    for (const alt of [...TRANSPORT_ANIM.keys()])
      if (!(stM.transporte || []).some(t2 => t2.id === alt)) TRANSPORT_ANIM.delete(alt);
    /* Straßensperren: rot-weiße Barke, Wimpel in Familienfarbe. */
    const famFarbe2 = Object.fromEntries((stM.familien || []).map(f => [f.id, f.farbe]));
    for (const t of stM.map) {
      if (!t.sperre) continue;
      const [sx, sy] = iso(t.x, t.y);
      verkehrMerken(t.x, t.y, () => {
        schatten(sx, sy + TH / 2 + 1, 14, 4);
        cx.fillStyle = "#7a4a28"; cx.fillRect(sx - 15, sy + TH / 2 - 7, 4, 8); cx.fillRect(sx + 11, sy + TH / 2 - 7, 4, 8);
        for (let i = 0; i < 6; i++) { cx.fillStyle = i % 2 ? "#e8e2d8" : "#d9463b"; cx.fillRect(sx - 13 + i * 4.4, sy + TH / 2 - 11, 4.4, 4.5); }
        cx.strokeStyle = "rgba(20,16,10,.6)"; cx.strokeRect(sx - 13, sy + TH / 2 - 11, 26.4, 4.5);
        const fc = famFarbe2[t.sperre.familie] || "#888";
        cx.fillStyle = "#4a4038"; cx.fillRect(sx + 13, sy + TH / 2 - 24, 2, 17);
        cx.fillStyle = fc;
        cx.beginPath(); cx.moveTo(sx + 15, sy + TH / 2 - 24); cx.lineTo(sx + 25, sy + TH / 2 - 21); cx.lineTo(sx + 15, sy + TH / 2 - 18); cx.closePath(); cx.fill();
      });
    }
  }
}
/* Gleit-Animationen der Werttransporte, je Transport-Id die letzte Position. */
const TRANSPORT_ANIM = new Map();

/* ---- Tag-Nacht-Zyklus ----
 * Ein voller Tag dauert 8 Minuten und hängt nur an der Wanduhrzeit — alle
 * Clients sehen also ungefähr dieselbe Tageszeit. Nachts legt sich ein
 * dunkelblauer Schleier übers Bild und die Gebäude bekommen warmes
 * Fensterlicht; zu Sonnenauf- und -untergang ein kurzer Orangeton. */
const TAG_ZYKLUS = 480;
let LICHT = 1, DAEMMERUNG = 0;
function lichtBerechnen(now) {
  const p = (now / 1000 % TAG_ZYKLUS) / TAG_ZYKLUS;
  LICHT = (Math.cos(p * 2 * Math.PI) + 1) / 2;           // 1 = Mittag, 0 = Mitternacht
  DAEMMERUNG = Math.pow(Math.sin(p * 2 * Math.PI), 6);   // schmale Spitzen an den Übergängen
}
/* Warmes Fensterlicht als vorgerenderter Lichtfleck. */
const GLOW = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 3, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,196,110,.85)"); grad.addColorStop(1, "rgba(255,196,110,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return c;
})();

/* ---- Fabrikrauch ----
 * Aktive Industriegebäude stoßen kleine, aufsteigende Rauchwölkchen aus —
 * pausierte nicht. So sieht man den Betriebszustand direkt auf der Karte. */
const RAUCHER = new Set(["mine", "stahlwerk", "raffinerie", "ewerk", "ziegelei", "betonwerk",
  "chipfabrik", "dieselwerk", "autowerk", "munitionsfabrik", "panzerwerk", "waffenschmiede", "oelpumpe",
  "reifenwerk"]);
function drawRauch(sx, topY, seed, now) {
  /* DDR-Optik: dichterer, dunklerer Qualm — Braunkohle statt Fernwärme. */
  const n = PLAN_LOOK ? 5 : 3, deck = PLAN_LOOK ? .45 : .3;
  cx.fillStyle = PLAN_LOOK ? "#6f747d" : "#c3c9d4";
  for (let j = 0; j < n; j++) {
    const k = ((now / 1000 * .45 + seed * .37 + j / n) % 1 + 1) % 1;
    cx.globalAlpha = (1 - k) * deck;
    cx.beginPath();
    cx.arc(sx + 8 + Math.sin(seed + j + k * 4) * 3, topY + 8 - k * (PLAN_LOOK ? 38 : 30), 2.5 + k * (PLAN_LOOK ? 8 : 6), 0, Math.PI * 2);
    cx.fill();
  }
  cx.globalAlpha = 1;
}

/* ---- Bau-, Abriss- und Freischalt-Effekte ----
 * Gebäude ploppten bisher kommentarlos auf die Karte. Der Client vergleicht
 * jede Kachel mit ihrem letzten Zustand: neues/abgerissenes Gebäude gibt eine
 * Staubwolke, eine freigeschaltete Kachel einen expandierenden Lichtring. */
const EFFEKTE = [];
let PREV_TILES = null;
function effekteErkennen(map, now) {
  if (!PREV_TILES) {
    PREV_TILES = new Map(map.map(t => [t.x + "," + t.y, { b: t.btype || null, l: !!t.locked }]));
    return;
  }
  for (const t of map) {
    const key = t.x + "," + t.y, prev = PREV_TILES.get(key);
    if (!prev) { PREV_TILES.set(key, { b: t.btype || null, l: !!t.locked }); continue; }
    const b = t.btype || null;
    if (b !== prev.b) EFFEKTE.push({ art: "staub", x: t.x, y: t.y, start: now, dauer: 1 });
    if (prev.l && !t.locked) EFFEKTE.push({ art: "puls", x: t.x, y: t.y, start: now, dauer: .9 });
    prev.b = b; prev.l = !!t.locked;
  }
}
function drawEffekte(now) {
  for (let i = EFFEKTE.length - 1; i >= 0; i--) {
    const e = EFFEKTE[i], k = (now - e.start) / 1000 / e.dauer;
    if (k >= 1) { EFFEKTE.splice(i, 1); continue; }
    const [sx, sy] = iso(e.x, e.y);
    if (e.art === "staub") {
      cx.fillStyle = "#cfc7b8";
      for (let j = 0; j < 6; j++) {
        const w = j / 6 * Math.PI * 2, r = 5 + k * 20;
        cx.globalAlpha = (1 - k) * .4;
        cx.beginPath();
        cx.arc(sx + Math.cos(w) * r, sy + TH / 2 + Math.sin(w) * r * .5 - k * 8, 4 + k * 6, 0, Math.PI * 2);
        cx.fill();
      }
    } else {
      const s = 1 + k * 1.6;
      cx.globalAlpha = (1 - k) * .8;
      cx.strokeStyle = "#7dd3fc"; cx.lineWidth = 2.5;
      cx.beginPath();
      cx.moveTo(sx, sy + TH / 2 - TH / 2 * s); cx.lineTo(sx + TW / 2 * s, sy + TH / 2);
      cx.lineTo(sx, sy + TH / 2 + TH / 2 * s); cx.lineTo(sx - TW / 2 * s, sy + TH / 2);
      cx.closePath(); cx.stroke();
    }
    cx.globalAlpha = 1; cx.lineWidth = 1;
  }
}

/* ---- Uferkanten ----
 * Wasser- und Landkacheln stießen hart aneinander. Einmalig wird ermittelt,
 * welche Kanten jeder Wasserkachel an Land grenzen; dort schimmert eine
 * weiche, leicht atmende Gischtlinie. */
let SHORE = null;
function buildShore(map) {
  const wasser = new Set(), alle = new Set();
  for (const t of map) { alle.add(t.x + "," + t.y); if (t.water) wasser.add(t.x + "," + t.y); }
  const land = (x, y) => alle.has(x + "," + y) && !wasser.has(x + "," + y);
  const s = new Map();
  for (const t of map) {
    if (!t.water) continue;
    const dirs = [];
    if (land(t.x, t.y - 1)) dirs.push(0);   // Kante oben-rechts
    if (land(t.x + 1, t.y)) dirs.push(1);   // Kante unten-rechts
    if (land(t.x, t.y + 1)) dirs.push(2);   // Kante unten-links
    if (land(t.x - 1, t.y)) dirs.push(3);   // Kante oben-links
    if (dirs.length) s.set(t.x + "," + t.y, dirs);
  }
  return s;
}

/* Karten-Symbole als Vektoren (statt Emoji): Schloss für gesperrte Kacheln,
 * Warndreieck bei Pfandrecht, Pausenbalken bei angehaltener Produktion. */
/* Gesperrte Kacheln sind auf der Startkarte die grosse Mehrheit — bei voller
 * Akzentfarbe erschlugen dutzende Schloesser alles andere, und die eigenen
 * Gebaeude gingen darin unter. Sie sind eine Randinformation ("hier muesstest
 * du erst freischalten"), also treten sie zurueck. */
function drawLock(cxp, cyp) {
  cx.globalAlpha = 0.42;
  cx.fillStyle = "#7d97b5"; cx.strokeStyle = "#7d97b5"; cx.lineWidth = 1.4;
  cx.beginPath(); cx.arc(cxp, cyp - 2.6, 2.4, Math.PI, 0); cx.stroke();
  cx.fillRect(cxp - 3.6, cyp - 2.4, 7.2, 5.4);
  cx.lineWidth = 1; cx.globalAlpha = 1;
}
function drawWarn(cxp, cyp) {
  cx.fillStyle = "#fb7185";
  cx.beginPath(); cx.moveTo(cxp, cyp - 5); cx.lineTo(cxp + 5, cyp + 4); cx.lineTo(cxp - 5, cyp + 4);
  cx.closePath(); cx.fill();
  cx.fillStyle = "#0a0e15"; cx.fillRect(cxp - .7, cyp - 2, 1.4, 4);
}
function drawPause(cxp, cyp) {
  cx.fillStyle = "#e3e9f4";
  cx.fillRect(cxp - 3.4, cyp - 4, 2.4, 8); cx.fillRect(cxp + 1, cyp - 4, 2.4, 8);
}
/* ---- Sprites richtig aufsetzen ----
 * Die Gebäude-Sprites haben unter dem Gebäude noch Leerraum (bei den Kenney-
 * Kacheln genau 12 px). Bisher wurde dieser Fußpunkt auf die KACHELMITTE
 * gesetzt — dadurch schwebte jedes Gebäude über seiner Kachel. Richtig ist:
 * die Grundfläche des Gebäudes liegt mittig auf der Kachel, ihre vordere Ecke
 * also unterhalb der Kachelmitte. Jedes Sprite wird deshalb beim ersten
 * Zeichnen einmal vermessen und daraus berechnet, wie weit es nach unten gehört. */
const spriteGeoCache = new WeakMap();
function spriteGeo(img) {
  let g = spriteGeoCache.get(img);
  if (g) return g;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const q = c.getContext("2d", { willReadFrequently: true });
  q.drawImage(img, 0, 0);
  let x0 = w, x1 = -1, y1 = -1;
  try {
    const d = q.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    }
  } catch { x0 = 0; x1 = w - 1; y1 = h - 1; }
  /* footY: unterste sichtbare Zeile. halbBasis: halbe Höhe der Grundraute —
   * eine isometrische Grundfläche ist doppelt so breit wie hoch, also Breite/4. */
  g = { footY: y1 + 1, halbBasis: Math.max(2, (x1 - x0 + 1) / 4) };
  spriteGeoCache.set(img, g);
  return g;
}
/* y-Position, damit die Grundfläche des Sprites mittig auf der Kachel sitzt. */
function standY(sy, img, size) {
  const g = spriteGeo(img), sk = size / (img.naturalWidth || img.width);
  return sy + TH / 2 + (g.halbBasis - g.footY) * sk;
}
/* Punktförmige Deko (Bäume, Felsen, Felder) hat keine eigene Grundfläche —
 * ihr Fuß gehört schlicht auf die Kachelmitte. */
function decoY(sy, img, size) {
  const g = spriteGeo(img);
  return sy + TH / 2 - g.footY * (size / (img.naturalWidth || img.width));
}

/* ---- Schattenwurf ----
 * Bisher standen die Gebaeude ohne Schatten auf der Karte und wirkten dadurch
 * aufgeklebt statt aufgestellt. Der Schatten entsteht aus der Silhouette des
 * Sprites selbst — einmal je Sprite gerechnet und zwischengelagert, danach ist
 * er ein einziges drawImage.
 *
 * Richtung: die Sonne steht links oben, der Schatten faellt entlang der
 * Weltachse +x, auf dem Bildschirm also nach rechts unten. Weil iso() einen
 * Schritt in +x auf (TW/2, TH/2) = (32, 16) abbildet, muss das Verhaeltnis von
 * Scherung zu Stauchung 2:1 sein, sonst liegt der Schatten nicht in der
 * Bodenebene. */
const SCHER = -0.95, STAUCH = -0.475;  // 0.95 : 0.475 = 2 : 1
const SCHATTEN_RAND = 10;              // Rand im Sprite, damit die Weichzeichnung Platz hat
const schattenCache = new WeakMap();
function schattenBild(img) {
  let s = schattenCache.get(img);
  if (s) return s;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const P = SCHATTEN_RAND;
  /* Erst die reine Silhouette: das Sprite zeichnen und ueber "source-in" alles
   * Sichtbare durch Schwarz ersetzen. So bleibt die Form erhalten, die Farben
   * verschwinden. */
  const a = document.createElement("canvas");
  a.width = w + 2 * P; a.height = h + 2 * P;
  const ag = a.getContext("2d");
  ag.drawImage(img, P, P, w, h);
  ag.globalCompositeOperation = "source-in";
  ag.fillStyle = "#000"; ag.fillRect(0, 0, a.width, a.height);
  /* Dann weichzeichnen. Ein harter Schatten sieht nach ausgeschnittenem Papier
   * aus; der Rand oben sorgt dafuer, dass die Unschaerfe nicht abgeschnitten
   * wird. Der Filter laeuft genau einmal je Sprite, nicht je Bild. */
  const b = document.createElement("canvas");
  b.width = a.width; b.height = a.height;
  const bg = b.getContext("2d");
  try { bg.filter = `blur(${Math.max(2, w / 64)}px)`; } catch {}
  bg.drawImage(a, 0, 0);
  schattenCache.set(img, b);
  return b;
}
/* Schatten fuer ein Sprite, das mit (sx - gr/2, standY(...)) in der Groesse gr
 * gezeichnet wird. Angelpunkt ist die Kachelmitte: dort steht das Gebaeude, und
 * dort bleibt der Schatten beim Scheren liegen. */
/* Wie stark die Sonne gerade scheint: 1 am Mittag, 0 sobald es dunkel wird.
 * Nachts gibt es keinen Schlagschatten. */
const sonnenStaerke = () => Math.min(1, Math.max(0, (LICHT - .18) / .5));
/* Kern: legt die Silhouette in die Bodenebene. "oben" ist die Bildschirm-Y, an
 * der das Sprite selbst gezeichnet wird, "ankerY" der Punkt, an dem es den
 * Boden beruehrt — dort bleibt der Schatten beim Scheren stehen. "spiegeln"
 * fuer Sprites, die zur Fahrtrichtung gespiegelt werden: gespiegelt wird die
 * Form, nicht die Lichtrichtung. */
function schattenMalen(img, ankerX, ankerY, oben, gr, spiegeln, deckkraft) {
  const staerke = sonnenStaerke();
  if (!img || staerke <= 0) return;
  const w = img.naturalWidth || img.width, sk = gr / w;
  const sch = schattenBild(img), P = SCHATTEN_RAND;
  cx.save();
  cx.translate(ankerX, ankerY);
  cx.transform(1, 0, SCHER, STAUCH, 0, 0);
  if (spiegeln) cx.scale(-1, 1);
  cx.globalAlpha = deckkraft * staerke;
  cx.drawImage(sch, -gr / 2 - P * sk, oben - ankerY - P * sk, sch.width * sk, sch.height * sk);
  cx.restore();
  cx.globalAlpha = 1;
}
/* Gebaeude: Fusspunkt ist die Kachelmitte, Hoehe ueber standY(). */
function drawSchatten(img, sx, sy, gr) {
  if (!img) return;
  const g = spriteGeo(img), sk = gr / (img.naturalWidth || img.width);
  schattenMalen(img, sx, sy + TH / 2, sy + TH / 2 + (g.halbBasis - g.footY) * sk, gr, false, .5);
}

/* Tastatursteuerung der Karte: gedrückte Tasten merken, in draw() bewegen. */
const TASTEN = new Set();
addEventListener("keydown", e => {
  if (!EINST.tastatur || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    if (k.startsWith("arrow") && document.getElementById("tutBuch")?.classList.contains("auf")) return;
    TASTEN.add(k); if (k.startsWith("arrow")) e.preventDefault();
  }
  if (k === "+" || k === "=") cam.z = Math.min(2.2, cam.z * 1.12);
  if (k === "-" || k === "_") cam.z = Math.max(.5, cam.z / 1.12);
});
addEventListener("keyup", e => TASTEN.delete(e.key.toLowerCase()));
addEventListener("blur", () => TASTEN.clear());
/* ---- Bildrate: Anzeige und automatische Anpassung ----
 * Misst die Abstände zwischen den Bildern. Mit „Automatisch anpassen“ schaltet
 * das Spiel bei anhaltendem Ruckeln (unter ~40 Bilder/s) stufenweise herunter:
 * erst den Glas-Effekt, dann die Auflösung, dann Wolken und Hintergrund. Nur
 * bei sichtbarem Tab, laufender Runde und Ziel „Maximal“ — im 30er-Modus wäre
 * jedes Bild „langsam“. */
const LEISTUNG = { abst: [], letzt: 0, anzeigeT: 0, pruefT: 0, ruheBis: 0 };
const AUTO_STUFEN = [["glas", false, "Glas-Effekt aus"], ["aufloesung", .75, "Auflösung 75 %"], ["wolken", false, "Wolken aus"],
                     ["hintergrund", false, "animierter Hintergrund aus"], ["aufloesung", .5, "Auflösung 50 %"]];
document.addEventListener("einstellung", () => { LEISTUNG.ruheBis = performance.now() + 4000; LEISTUNG.abst.length = 0; });
addEventListener("resize", () => { LEISTUNG.ruheBis = performance.now() + 4000; LEISTUNG.abst.length = 0; });
function leistungMessen(jetzt) {
  const L = LEISTUNG;
  /* Pausen über 250 ms sind kein Ruckeln, sondern ein gedrosseltes oder
   * verdecktes Fenster (dort laufen 1–2 Bilder/s) — sie zählen nicht. */
  if (L.letzt && jetzt - L.letzt < 250) { L.abst.push(jetzt - L.letzt); if (L.abst.length > 240) L.abst.shift(); }
  L.letzt = jetzt;
  const med = () => { const a = [...L.abst].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] || 16.7; };
  if (EINST.fpsAnzeige && jetzt - L.anzeigeT > 500) {
    L.anzeigeT = jetzt;
    let el = document.getElementById("fpsAnzeige");
    if (!el) { el = document.createElement("div"); el.id = "fpsAnzeige"; document.body.append(el); }
    const letzte = L.abst.slice(-60), ruckler = letzte.filter(x => x > 50).length;
    el.textContent = `${Math.round(1000 / med())} Bilder/s${ruckler ? ` · ${ruckler} Hänger` : ""}\n${EINST.qualitaet} · ${Math.round(DPR() * 100) / 100}× · ${EINST.glas ? "Glas an" : "Glas aus"}`;
  } else if (!EINST.fpsAnzeige) document.getElementById("fpsAnzeige")?.remove();
  if (!EINST.autoQualitaet || EINST.fps !== 60 || document.visibilityState !== "visible" || !store.get().state?.started) return;
  if (jetzt < L.ruheBis || jetzt - L.pruefT < 3000 || L.abst.length < 90) return;
  L.pruefT = jetzt;
  if (med() <= 25) return;
  const stufe = AUTO_STUFEN.find(([k, v]) => k === "aufloesung" ? (EINST.aufloesung || 1) > v : EINST[k] !== v);
  if (!stufe) return;
  EINST.setzen(stufe[0], stufe[1]);
  L.ruheBis = jetzt + 8000;
  toast(`${t("Grafik automatisch reduziert")}: ${t(stufe[2])}. ${t("Ändern unter Einstellungen → Grafik.")}`);
}
function draw() {
  requestAnimationFrame(draw);
  /* Bildrate begrenzen (Einstellung „30 Bilder/s") — spart Akku und Lüfter. */
  const pnow = performance.now();
  if (EINST.fps === 30 && pnow - (draw.lastT || 0) < 31) return;
  if (TASTEN.size) {
    const v = Math.min(.05, (pnow - (draw.lastT || pnow)) / 1000) * 700;
    if (TASTEN.has("w") || TASTEN.has("arrowup")) cam.y += v;
    if (TASTEN.has("s") || TASTEN.has("arrowdown")) cam.y -= v;
    if (TASTEN.has("a") || TASTEN.has("arrowleft")) cam.x += v;
    if (TASTEN.has("d") || TASTEN.has("arrowright")) cam.x -= v;
  }
  draw.lastT = pnow;
  const st = store.get().state, now = Date.now();
  cx.setTransform(DPR(),0,0,DPR(),0,0);
  /* Kein Himmelsbild mehr: die Karte wird auf durchsichtigem Grund gezeichnet,
   * dahinter läuft dieselbe Höhenlinien-Karte wie auf dem Startbildschirm
   * (#bgTopo, public/topo.js) — ein durchgehender Look für Spiel und Website. */
  cx.clearRect(0, 0, innerWidth, innerHeight);
  if (!st) return;
  /* Moduswechsel bringt eine neue Spielfläche mit — Straßen- und Ufer-Cache
   * müssen dann neu aufgebaut werden. */
  PLAN_LOOK = st.mode === "plan";
  ITALIA_LOOK = st.mode === "kartell";
  const mapKey = st.mode + ":" + st.started;
  if (draw.mapKey !== mapKey) { draw.mapKey = mapKey; ROUTES = null; SHORE = null; ROADSET = null; }
  if (!ROUTES) {
    /* Gebackene Karten bringen ihre Fahrspuren mit: die echten Strassenzuege
     * laufen diagonal, aus geraden Gitterzeilen entstuende dort kein Verkehr.
     * tilePosAtU interpoliert ohnehin zwischen den Stuetzpunkten, die muessen
     * also nicht auf Achsen liegen. */
    ROUTES = st.routes?.length
      ? { carLines: st.routes.map(l => l.map(([x, y]) => ({ x, y }))) }
      : buildRoutes(st.map);
    SHORE = buildShore(st.map);
    CASAS = ITALIA_LOOK ? buildCasas(st.map) : null;
  }
  lichtBerechnen(now);
  effekteErkennen(st.map, now);
  const dt = Math.min(.1, (now - (draw.letzt || now)) / 1000); draw.letzt = now;
  trucksAktualisieren(st, now, dt);
  /* Kamera-Beben bei Revierkämpfen: klingt schnell ab, respektiert Ruhe danach */
  let bebenX = 0, bebenY = 0;
  if (KAMPF_SHAKE > .01) {
    bebenX = (Math.random() - .5) * 14 * KAMPF_SHAKE;
    bebenY = (Math.random() - .5) * 10 * KAMPF_SHAKE;
    KAMPF_SHAKE *= .93;
  } else KAMPF_SHAKE = 0;
  cx.translate(innerWidth/2 + cam.x + bebenX, 120 + cam.y + bebenY); cx.scale(cam.z, cam.z);
  /* Neue Spielfläche (public/flaeche.js): Geländemodell mit Sockel, ruhigen
   * Zonenfarben, Höhenlinien, Bezirksgrenzen. Planwirtschaft und Kartell
   * behalten ihren eigenen Look. */
  const FL = !!window.FLAECHE && !ITALIA_LOOK && !PLAN_LOOK;
  draw.welt = cx.getTransform();   // für den Atmosphären-Clip
  /* Nur Sichtbares zeichnen: Kacheln außerhalb des Bildausschnitts (plus Rand
   * für hohe Gebäude, die nach oben ins Bild ragen) überspringen. Bei
   * hineingezoomter Karte fällt so der Großteil der 900 Kacheln weg. */
  const kz = cam.z, SICHT = { x0: -(innerWidth / 2 + cam.x) / kz - 90, x1: (innerWidth / 2 - cam.x) / kz + 90,
                              y0: -(120 + cam.y) / kz - 90, y1: (innerHeight - 120 - cam.y) / kz + 170 };
  const imBild = t => { const sx = (t.x - t.y) * TW / 2, sy = (t.x + t.y) * TH / 2;
    return sx >= SICHT.x0 && sx <= SICHT.x1 && sy >= SICHT.y0 && sy <= SICHT.y1; };
  /* Kamera bewegt? Dann pausiert der Topo-Hintergrund kurz (siehe startTopo). */
  const camSig = cam.x + "|" + cam.y + "|" + cam.z;
  if (draw.camSig !== camSig) { draw.camSig = camSig; window.KAMERA_BEWEGT = performance.now(); }
  if (FL) FLAECHE.boden(cx, st.map);   // Sockel, Kacheln, Schlösser, Linien — ein Bild
  for (const t of st.map) {
    if (FL) break;                     // im gebackenen Boden enthalten
    const [sx, sy] = iso(t.x, t.y);
    cx.beginPath(); cx.moveTo(sx,sy); cx.lineTo(sx+TW/2,sy+TH/2); cx.lineTo(sx,sy+TH); cx.lineTo(sx-TW/2,sy+TH/2); cx.closePath();
    const img = FL ? FLAECHE.tile(t) : tileSprite(t);
    /* Die Rauten sind beim Laden fertig vorgerendert — hier nur noch platzieren. */
    if (img) cx.drawImage(img, sx - TW / 2, sy, TW, TH);
    else { cx.fillStyle = t.park ? "#2f4a2a" : t.road ? "#1c2430" : t.sand ? "#4d4632" : t.deep ? "#092536" : ZCOL[t.zone]; cx.fill(); }
    if (!FL) { cx.strokeStyle = "rgba(255,255,255,.05)"; cx.stroke(); }
    /* Der frühere Zonen-Farbwasch entfällt: jede Zone hat jetzt ihre eigene
     * Textur, ein Farbschleier darüber würde sie nur trüben. Nur das offene
     * Meer bekommt weiterhin einen Dunkel-Ton, damit sich Tiefe abhebt. */
    if (t.water && t.deep && !FL) { cx.globalAlpha = 0.35; cx.fillStyle = "#092536"; cx.fill(); cx.globalAlpha = 1; }
    /* Italien-Schleier: Pflaster statt Asphalt, Olivgrün statt Rasen,
     * warmes Zentrum, türkises Mittelmeer. */
    if (ITALIA_LOOK) {
      cx.globalAlpha = t.road ? .42 : t.water ? .26 : t.sand ? .34 : t.zone === "zentrum" ? .30 : .24;
      cx.fillStyle = t.road ? "#c29a63" : t.water ? "#1a96a3" : t.sand ? "#e3c078"
        : t.zone === "zentrum" ? "#cd9058" : t.park ? "#5a7035" : "#96a14b";
      cx.fill(); cx.globalAlpha = 1;
    }
    /* Piazza: warmes Kopfsteinpflaster — deutlich heller als die Straßen,
     * damit der Platz als Platz lesbar ist. Fugenlinien deuten Pflaster an. */
    if (t.piazza) {
      cx.globalAlpha = .62; cx.fillStyle = "#c9a06b"; cx.fill();
      cx.globalAlpha = .25; cx.strokeStyle = "#7a5a38";
      for (const f of [.33, .66]) {
        cx.beginPath();
        cx.moveTo(sx - TW / 2 + f * TW / 2, sy + TH / 2 - f * TH / 2);
        cx.lineTo(sx + f * TW / 2, sy + TH - f * TH / 2);
        cx.moveTo(sx + TW / 2 - f * TW / 2, sy + TH / 2 - f * TH / 2);
        cx.lineTo(sx - f * TW / 2, sy + TH - f * TH / 2);
        cx.stroke();
      }
      cx.globalAlpha = 1;
    }
    /* Hafenmole: Holzdeck mit Planken über dem Wasser, Pfähle an den Ecken. */
    if (t.pier) {
      const w = TW * .44, h = TH * .44, mx = sx, my = sy + TH / 2;
      cx.beginPath();
      cx.moveTo(mx, my - h); cx.lineTo(mx + w, my); cx.lineTo(mx, my + h); cx.lineTo(mx - w, my); cx.closePath();
      cx.fillStyle = "#8a6a45"; cx.fill();
      cx.strokeStyle = "#5f4830"; cx.lineWidth = 1.2; cx.stroke(); cx.lineWidth = 1;
      cx.strokeStyle = "rgba(58,42,26,.55)";
      for (const f of [.25, .5, .75]) {   // Planken quer zur Mole
        cx.beginPath();
        cx.moveTo(mx - w + f * w, my - f * h);
        cx.lineTo(mx + f * w, my + h - f * h);
        cx.stroke();
      }
      cx.fillStyle = "#4e3a24";           // Pfähle
      for (const [px2, py2] of [[mx - w * .82, my], [mx + w * .82, my]]) {
        cx.beginPath(); cx.ellipse(px2, py2, 2.4, 1.6, 0, 0, Math.PI * 2); cx.fill();
      }
    }
    /* Weinberge & Olivenhaine: flache Bodendeko, direkt auf die Kachel gelegt */
    if (ITALIA_LOOK && t.field && !t.btype)
      cx.drawImage((t.x * 5 + t.y * 3) % 3 ? MEDIT.weinberg : MEDIT.oliven, sx - TW / 2, sy, TW, TH);
    /* Gesperrte Flaechen sind 40 % der Karte (Kueste und Industrieband
     * zusammen 270 von 676 Kacheln). Mit 45 % Schwarz darueber wirkten sie
     * wie tote Flaeche statt wie Bauland, das man kaufen kann — und da nur
     * gut ein Viertel der Karte sofort bebaubar ist, sieht man beim
     * Herumfahren ueberwiegend genau diese Flaeche. Jetzt so weit
     * abgedunkelt, dass der Unterschied klar bleibt, die Textur darunter
     * aber sichtbar ist. */
    if (t.locked) { cx.fillStyle = FL ? FLAECHE.gesperrt() : "rgba(4,10,18,.26)"; cx.fill();
      drawLock(sx, sy + TH / 2 - 1); }
  }
  if (FL) FLAECHE.ueber(cx, st.map);
  /* Territorium (Kartellmodus): Kacheln kontrollierter Bezirke bekommen einen
   * hauchdünnen Schleier in Familienfarbe, dazu ein Label je Bezirk. */
  if (st.mode === "kartell" && st.bezirke && st.familien) {
    const famFarbe = Object.fromEntries(st.familien.map(f => [f.id, f.farbe]));
    const bezirkVonC = (x, y) => Math.min(2, Math.floor(x / 9)) + 3 * Math.min(2, Math.floor(y / 9));
    for (const t of st.map) {
      if (t.water) continue;
      const b = st.bezirke[bezirkVonC(t.x, t.y)];
      const [sx, sy] = iso(t.x, t.y);
      /* Tauziehen: roter Puls-Schleier über dem ganzen umkämpften Bezirk */
      if (b?.kampf) {
        cx.globalAlpha = .1 + ((Math.sin(now / 260) + 1) / 2) * .12;
        cx.fillStyle = "#e74c3c";
        cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + TW / 2, sy + TH / 2); cx.lineTo(sx, sy + TH); cx.lineTo(sx - TW / 2, sy + TH / 2); cx.closePath(); cx.fill();
        cx.globalAlpha = 1;
        continue;
      }
      if (!b?.kontrolle) continue;
      cx.globalAlpha = .09;
      cx.fillStyle = famFarbe[b.kontrolle] || "#888";
      cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + TW / 2, sy + TH / 2); cx.lineTo(sx, sy + TH); cx.lineTo(sx - TW / 2, sy + TH / 2); cx.closePath(); cx.fill();
      cx.globalAlpha = 1;
    }
    /* Straßenschlacht-Effekte: Mündungsblitze und Rauch im umkämpften Bezirk */
    for (const b of st.bezirke) {
      if (!b.kampf) continue;
      const bx0 = (b.id % 3) * 9, by0 = Math.floor(b.id / 3) * 9;
      for (let k = 0; k < 3; k++) {
        const seed = Math.floor(now / 160) * 7 + k * 13 + b.id;
        const rx = bx0 + (seed * 31 % 9), ry = by0 + (seed * 17 % 9);
        const [fx, fy] = iso(rx, ry);
        if ((seed % 3) === 0) {   // Mündungsblitz
          cx.fillStyle = "rgba(255,236,160," + (.5 + (seed % 5) * .1) + ")";
          cx.beginPath(); cx.arc(fx + (seed % 11) - 5, fy + TH / 2 - 6, 2.4 + (seed % 3), 0, Math.PI * 2); cx.fill();
        }
        const rauchT = ((now / 1200 + k * .37 + b.id * .21) % 1);   // aufsteigender Rauch
        cx.globalAlpha = (1 - rauchT) * .28;
        cx.fillStyle = "#6a6f78";
        cx.beginPath(); cx.arc(fx + Math.sin(rauchT * 5 + k) * 5, fy + TH / 2 - 10 - rauchT * 34, 4 + rauchT * 9, 0, Math.PI * 2); cx.fill();
        cx.globalAlpha = 1;
      }
    }
    for (const b of st.bezirke) {
      const zx = (b.id % 3) * 9 + 4, zy = Math.floor(b.id / 3) * 9 + 4;
      const [sx, sy] = iso(zx, zy);
      cx.font = "700 11px sans-serif"; cx.textAlign = "center";
      cx.fillStyle = "rgba(8,12,20,.55)";
      cx.fillText(b.name, sx + 1, sy + 1);
      cx.fillStyle = b.kontrolle ? famFarbe[b.kontrolle] : "rgba(220,228,240,.5)";
      cx.fillText(b.name, sx, sy);
      if (b.kontrolle) {
        const fam = st.familien.find(f => f.id === b.kontrolle);
        cx.font = "600 9px sans-serif";
        cx.fillStyle = "rgba(220,228,240,.65)";
        cx.fillText(fam?.name || "", sx, sy + 12);
        if (b.besatzung) {
          cx.fillStyle = "rgba(231,76,60,.9)";
          cx.fillText(`🏴 besetzt · noch ${b.besatzung.rest} s`, sx, sy + 23);
        }
      }
      /* Tauziehen-Balken + Countdown direkt am Bezirk */
      if (b.kampf) {
        const gesamt = Math.max(1, b.kampf.pa + b.kampf.pv);
        const w = 88, h = 8, bx2 = sx - w / 2, by2 = sy + 16;
        const fa = famFarbe[b.kampf.angreifer] || "#e74c3c";
        const fv = famFarbe[b.kampf.verteidiger] || "#4a90d9";
        cx.fillStyle = "rgba(8,12,20,.75)";
        cx.fillRect(bx2 - 2, by2 - 2, w + 4, h + 4);
        cx.fillStyle = fa; cx.fillRect(bx2, by2, w * (b.kampf.pa / gesamt), h);
        cx.fillStyle = fv; cx.fillRect(bx2 + w * (b.kampf.pa / gesamt), by2, w * (b.kampf.pv / gesamt), h);
        cx.fillStyle = "#fff";
        cx.fillRect(bx2 + w * (b.kampf.pa / gesamt) - 1, by2 - 1, 2, h + 2);
        cx.font = "800 13px sans-serif";
        cx.fillStyle = "#ffd7d0";
        cx.fillText(`⚔️ ${b.kampf.pa} : ${b.kampf.pv} · ${b.kampf.rest}s`, sx, by2 + 24);
      }
    }
  }
  /* Wasser-Effekte in einem eigenen Durchgang — direkt beim Kachelzeichnen
   * würden die danach gemalten Nachbarrauten sie sofort wieder übermalen. */
  for (const t of st.map) {
    if (!t.water || !imBild(t)) continue;
    const [sx, sy] = iso(t.x, t.y);
    /* Wandernde Lichtglanzpunkte, damit die Fläche lebt. */
    const h = (t.x * 31 + t.y * 17) % 97;
    const a = Math.sin(now / 650 + h) * .16 + .12;
    if (a > 0) {
      cx.globalAlpha = a; cx.fillStyle = "#e6f7ff";
      cx.beginPath(); cx.ellipse(sx + (h % 13) - 6, sy + TH / 2 + (h % 7) - 3, 4.5, 1.5, 0, 0, Math.PI * 2); cx.fill();
      cx.beginPath(); cx.ellipse(sx - (h % 9) + 4, sy + TH / 2 - (h % 5) + 2, 3, 1.1, 0, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = 1;
    }
    /* Gischtlinie an Kanten, die an Land grenzen. */
    const kueste = SHORE?.get(t.x + "," + t.y);
    if (kueste) {
      const V = [[sx, sy], [sx + TW / 2, sy + TH / 2], [sx, sy + TH], [sx - TW / 2, sy + TH / 2]];
      cx.globalAlpha = .34 + .18 * Math.sin(now / 900 + t.x * 2 + t.y);
      cx.strokeStyle = "#e8f6ff"; cx.lineWidth = 2.4; cx.lineCap = "round";
      for (const d of kueste) {
        const a1 = V[d], b1 = V[(d + 1) % 4];
        cx.beginPath(); cx.moveTo(a1[0], a1[1]); cx.lineTo(b1[0], b1[1]); cx.stroke();
      }
      cx.globalAlpha = 1; cx.lineWidth = 1; cx.lineCap = "butt";
    }
  }
  /* Schatten-Durchgang: eigener Lauf zwischen Boden und Gebaeuden. Direkt beim
   * Gebaeude gezeichnet waere er wertlos — er faellt nach rechts unten ueber die
   * Kachelkante hinaus, und dort liegt eine Kachel, die spaeter an die Reihe
   * kommt und ihn wieder uebermalen wuerde. Nach dem vollstaendigen Boden
   * gezeichnet, bleibt er liegen. */
  for (const t of st.map) {
    if (!imBild(t)) continue;
    const spr = t.bank    ? (BANKSPR || spriteFor("kontor", t.x, t.y))
              : t.news    ? (NEWSSPR || spriteFor("buero", t.x, t.y))
              : t.finanzamt ? (STADT_SPR.finanzamt || spriteFor("buero", t.x, t.y))
              : t.denkmal ? (STADT_SPR[t.denkmal] || spriteFor("kontor", t.x, t.y))
              : t.deko    ? dekoSprite(t)
              : t.schwarz ? (spriteFor("markt", t.x, t.y) || spriteFor("kontor", t.x, t.y))
              : t.btype   ? spriteFor(t.btype, t.x, t.y)
              : null;
    if (!spr) continue;
    const [sx, sy] = iso(t.x, t.y);
    drawSchatten(spr, sx, sy, t.deko ? dekoGroesse(spr) : t.btype ? 64 : 72);
  }
  for (const t of st.map) {
    if (!t.park || t.btype || !imBild(t)) continue;
    const [sx, sy] = iso(t.x, t.y);
    for (const b of dekoStellen(t)) drawSchatten(b.img, sx + b.ox, sy + b.oy, b.gr);
  }
  /* 2. Durchgang: Gebäude & Deko — nach Boden, damit Sprites nicht überdeckt werden */
  /* Die Kachel-Variable t verdeckt hier die Übersetzungsfunktion t() —
   * daher vorab eine Referenz sichern, sonst bricht draw() an der Bank ab
   * und alle danach gezeichneten Kacheln bleiben ohne Gebäude. */
  const uebers = t;
  /* Verkehr einsammeln, BEVOR die Gebaeude gezeichnet werden — gemalt wird er
   * dann je Kachel innerhalb der Schleife. */
  drawAmbient(now);
  drawTrucks(now);
  for (const t of st.map) {
    if (!imBild(t)) continue;   // Verkehr dieser Kachel zeichnet verkehrRest() am Ende
    const [sx, sy] = iso(t.x, t.y);
    if (t.park && !t.btype) {
      /* Der fruehere dunkle Ellipsenfleck unter jedem Baum ist weg: einer je
       * Kachel ergab ein Gitter aus dunklen Flecken, das staerker ins Auge fiel
       * als die Baumpositionen selbst. Baeume werfen jetzt denselben Schatten
       * wie Gebaeude und Fahrzeuge — gezeichnet im Schattendurchgang weiter
       * oben, damit ihn die naechste Kachel nicht uebermalt. */
      for (const b of dekoStellen(t))
        cx.drawImage(b.img, sx + b.ox - b.gr / 2, decoY(sy + b.oy, b.img, b.gr), b.gr, b.gr);
    }
    if (t.rock && DECO.rock.length) {
      const d = DECO.rock[(t.x * 7 + t.y * 3) % DECO.rock.length];
      if (d) {
        const [ox, oy] = streuVersatz(t, .4);
        const gr = 52 + streu(t.x, t.y, 4) * 16;
        cx.drawImage(d, sx + ox - gr / 2, decoY(sy + oy, d, gr), gr, gr);
      }
    }
    if (t.field && !t.btype && DECO.field.length && !ITALIA_LOOK) {
      const d = DECO.field[(t.x * 3 + t.y * 7) % DECO.field.length];
      if (d) {
        const [ox, oy] = streuVersatz(t, .34);   // enger als im Park: Aecker sind angelegt
        const gr = 70 + streu(t.x, t.y, 6) * 14;
        cx.drawImage(d, sx + ox - gr / 2, decoY(sy + oy, d, gr), gr, gr);
      }
    }
    /* --- Mittelmeer-Leben (Kartellmodus) --- */
    if (ITALIA_LOOK) {
      /* Fontana auf der Piazza: Steinbecken, Wasser, pulsierende Gischt */
      if (t.fontana) {
        const fx = sx, fy = sy + TH / 2;
        cx.fillStyle = "#a8926e";
        cx.beginPath(); cx.ellipse(fx, fy, 15, 8.5, 0, 0, Math.PI * 2); cx.fill();
        cx.strokeStyle = "#7a6448"; cx.stroke();
        cx.fillStyle = "#2f8fa8";
        cx.beginPath(); cx.ellipse(fx, fy, 11, 6, 0, 0, Math.PI * 2); cx.fill();
        const puls = (Math.sin(now / 420) + 1) / 2;
        cx.globalAlpha = .35 + puls * .3; cx.fillStyle = "#bfe8f2";
        cx.beginPath(); cx.ellipse(fx, fy, 4 + puls * 3.5, 2.2 + puls * 2, 0, 0, Math.PI * 2); cx.fill();
        cx.globalAlpha = 1; cx.fillStyle = "#e9f6fa";
        cx.beginPath(); cx.ellipse(fx, fy - 3 - puls * 2, 1.6, 2.6, 0, 0, Math.PI * 2); cx.fill();
      }
      /* Wochenmarkt auf der Piazza: je Kachel ein Stand, versetzt zur Fontana */
      if (t.piazza && !t.fontana && !t.btype) {
        const sIdx = (t.x * 3 + t.y * 7) % MEDIT.staende.length;
        const ox2 = ((t.x * 13 + t.y * 5) % 11) - 5, oy2 = ((t.x * 7 + t.y * 11) % 7) - 3;
        cx.drawImage(MEDIT.staende[sIdx], sx - 15 + ox2, sy + TH / 2 - 20 + oy2, 30, 26);
      }
      /* Die Questura: Sitz der Polizei — blaugraues Amtsgebäude mit Schild,
       * das Blaulicht über der Tür rotiert nachts wie am Tag. */
      if (t.questura) {
        const bx2 = sx, by2 = sy + TH / 2;
        cx.fillStyle = "rgba(0,0,0,.28)";
        cx.beginPath(); cx.ellipse(bx2 + 2, by2 + 4, 20, 7, 0, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#5e6b7c";                                          // Seitenwand
        cx.beginPath(); cx.moveTo(bx2, by2 + 8); cx.lineTo(bx2 - 19, by2 - 1); cx.lineTo(bx2 - 19, by2 - 34); cx.lineTo(bx2, by2 - 25); cx.closePath(); cx.fill();
        cx.fillStyle = "#77879c";                                          // Front
        cx.beginPath(); cx.moveTo(bx2, by2 + 8); cx.lineTo(bx2 + 19, by2 - 1); cx.lineTo(bx2 + 19, by2 - 34); cx.lineTo(bx2, by2 - 25); cx.closePath(); cx.fill();
        cx.fillStyle = "#46536b";                                          // Dach
        cx.beginPath(); cx.moveTo(bx2, by2 - 25); cx.lineTo(bx2 + 19, by2 - 34); cx.lineTo(bx2, by2 - 43); cx.lineTo(bx2 - 19, by2 - 34); cx.closePath(); cx.fill();
        cx.fillStyle = "#2e3646";                                          // Tür + Fenster
        cx.fillRect(bx2 + 6, by2 - 12, 6, 12);
        for (const [fx2, fy2] of [[bx2 + 4, by2 - 24], [bx2 + 12, by2 - 21], [bx2 - 8, by2 - 26], [bx2 - 14, by2 - 24]]) {
          cx.fillStyle = LICHT < .5 ? "#ffd27a" : "#2e3646"; cx.fillRect(fx2, fy2, 3.6, 5);
        }
        cx.fillStyle = "#e8edf5"; cx.font = "700 6.5px sans-serif"; cx.textAlign = "center";
        cx.fillText("QUESTURA", bx2 + 9.5, by2 - 14.5);
        /* rotierendes Blaulicht über der Tür */
        const bl = (Math.sin(now / 180) + 1) / 2;
        cx.fillStyle = `rgba(74,144,226,${(.35 + bl * .65).toFixed(2)})`;
        cx.beginPath(); cx.arc(bx2 + 9, by2 - 27.5, 2.2, 0, Math.PI * 2); cx.fill();
        if (LICHT < .6) {
          cx.globalCompositeOperation = "lighter"; cx.globalAlpha = bl * .35;
          cx.beginPath(); cx.arc(bx2 + 9, by2 - 27.5, 9 + bl * 5, 0, Math.PI * 2);
          cx.fillStyle = "#4a90e2"; cx.fill();
          cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
        }
      }
      /* Casino Municipale: Goldfassade, rotes Neon, nachts Lichterkette —
       * das Gebäude soll schreien: Hier fließt das Geld der Stadt. */
      if (t.gcasino) {
        const bx2 = sx, by2 = sy + TH / 2;
        cx.fillStyle = "rgba(0,0,0,.3)";
        cx.beginPath(); cx.ellipse(bx2 + 2, by2 + 4, 21, 7.5, 0, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#8a6a3a";   // Seitenwand (dunkles Gold)
        cx.beginPath(); cx.moveTo(bx2, by2 + 8); cx.lineTo(bx2 - 20, by2 - 2); cx.lineTo(bx2 - 20, by2 - 30); cx.lineTo(bx2, by2 - 20); cx.closePath(); cx.fill();
        cx.fillStyle = "#c9a04e";   // Front (Gold)
        cx.beginPath(); cx.moveTo(bx2, by2 + 8); cx.lineTo(bx2 + 20, by2 - 2); cx.lineTo(bx2 + 20, by2 - 30); cx.lineTo(bx2, by2 - 20); cx.closePath(); cx.fill();
        cx.fillStyle = "#6e2f2f";   // rotes Walmdach
        cx.beginPath(); cx.moveTo(bx2, by2 - 20); cx.lineTo(bx2 + 20, by2 - 30); cx.lineTo(bx2, by2 - 40); cx.lineTo(bx2 - 20, by2 - 30); cx.closePath(); cx.fill();
        cx.fillStyle = "#3a2a18";   // Portal
        cx.fillRect(bx2 + 6, by2 - 11, 7, 12);
        for (const [fx2, fy2] of [[bx2 + 3, by2 - 22], [bx2 + 13, by2 - 19], [bx2 - 9, by2 - 24], [bx2 - 15, by2 - 22]]) {
          cx.fillStyle = LICHT < .6 ? "#ffdf8a" : "#4a3a22"; cx.fillRect(fx2, fy2, 3.6, 5);
        }
        const neonPuls = .55 + ((Math.sin(now / 300) + 1) / 2) * .45;
        cx.fillStyle = `rgba(255,72,72,${neonPuls.toFixed(2)})`;   // Neon-Schriftzug
        cx.font = "800 7px sans-serif"; cx.textAlign = "center";
        cx.fillText("CASINO", bx2 + 9.5, by2 - 12.5);
        /* Lichterkette an der Traufe: Lauflicht */
        for (let i = 0; i < 8; i++) {
          const an = (Math.floor(now / 180) + i) % 3 === 0;
          cx.fillStyle = an ? "#ffd75e" : "rgba(255,215,94,.25)";
          cx.beginPath(); cx.arc(bx2 + 2 + i * 2.4, by2 - 21 + i * 1.2, 1.1, 0, Math.PI * 2); cx.fill();
          cx.beginPath(); cx.arc(bx2 - 2 - i * 2.4, by2 - 21 + i * 1.2, 1.1, 0, Math.PI * 2); cx.fill();
        }
        if (LICHT < .6) {   // goldener Schein aufs Pflaster
          cx.globalCompositeOperation = "lighter"; cx.globalAlpha = .22 * neonPuls;
          cx.beginPath(); cx.ellipse(bx2, by2 + 6, 26, 10, 0, 0, Math.PI * 2);
          cx.fillStyle = "#ffca55"; cx.fill();
          cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
        }
      }
      /* Familienhaus: Stammsitz mit Dach und Fahne in Familienfarbe */
      if (t.famhaus && st.familien) {
        const fam = st.familien.find(f2 => f2.id === t.famhaus);
        if (fam) {
          const bx2 = sx, by2 = sy + TH / 2;
          cx.fillStyle = "rgba(0,0,0,.3)";
          cx.beginPath(); cx.ellipse(bx2 + 1, by2 + 4, 18, 6.5, 0, 0, Math.PI * 2); cx.fill();
          cx.fillStyle = "#4a3b2a";
          cx.beginPath(); cx.moveTo(bx2, by2 + 7); cx.lineTo(bx2 - 17, by2 - 1); cx.lineTo(bx2 - 17, by2 - 22); cx.lineTo(bx2, by2 - 14); cx.closePath(); cx.fill();
          cx.fillStyle = "#6b563b";
          cx.beginPath(); cx.moveTo(bx2, by2 + 7); cx.lineTo(bx2 + 17, by2 - 1); cx.lineTo(bx2 + 17, by2 - 22); cx.lineTo(bx2, by2 - 14); cx.closePath(); cx.fill();
          cx.fillStyle = fam.farbe;
          cx.beginPath(); cx.moveTo(bx2, by2 - 14); cx.lineTo(bx2 + 17, by2 - 22); cx.lineTo(bx2, by2 - 31); cx.lineTo(bx2 - 17, by2 - 22); cx.closePath(); cx.fill();
          cx.strokeStyle = "rgba(0,0,0,.35)"; cx.lineWidth = 1; cx.stroke();
          /* Fahne */
          cx.strokeStyle = "#2a2118"; cx.lineWidth = 1.5;
          cx.beginPath(); cx.moveTo(bx2, by2 - 31); cx.lineTo(bx2, by2 - 42); cx.stroke();
          cx.fillStyle = fam.farbe;
          const weh = Math.sin(now / 300 + t.x) * 1.5;
          cx.beginPath(); cx.moveTo(bx2, by2 - 42); cx.lineTo(bx2 + 10, by2 - 39 + weh); cx.lineTo(bx2, by2 - 36); cx.closePath(); cx.fill();
          cx.font = "700 6.5px sans-serif"; cx.textAlign = "center";
          cx.fillStyle = "rgba(9,13,20,.85)";
          const bw2 = cx.measureText(fam.name).width + 8;
          cx.fillRect(bx2 - bw2 / 2, by2 + 8, bw2, 9);
          cx.fillStyle = fam.farbe;
          cx.fillText(fam.name, bx2, by2 + 14.5);
        }
      }
      /* Wahrzeichen: goldener Sockel, großes Sinnbild, kleines Schild —
       * ein Blick auf die Karte verrät, wo es etwas zu holen gibt. */
      if (t.wz && typeof WZ_CLIENT !== "undefined" && WZ_CLIENT[t.wz]) {
        const w = WZ_CLIENT[t.wz], bx2 = sx, by2 = sy + TH / 2;
        cx.fillStyle = "rgba(0,0,0,.3)";
        cx.beginPath(); cx.ellipse(bx2 + 1, by2 + 4, 17, 6.5, 0, 0, Math.PI * 2); cx.fill();
        /* Sockel als flache Raute */
        cx.fillStyle = "#b99253";
        cx.beginPath(); cx.moveTo(bx2, by2 + 7); cx.lineTo(bx2 + 15, by2); cx.lineTo(bx2, by2 - 7); cx.lineTo(bx2 - 15, by2); cx.closePath(); cx.fill();
        cx.strokeStyle = "#7d6023"; cx.lineWidth = 1; cx.stroke();
        cx.font = "22px sans-serif"; cx.textAlign = "center"; cx.textBaseline = "alphabetic";
        cx.fillText(w.icon, bx2, by2 - 4);
        cx.font = "700 6.5px sans-serif";
        cx.fillStyle = "rgba(9,13,20,.85)";
        const bw = cx.measureText(w.name).width + 8;
        cx.fillRect(bx2 - bw / 2, by2 + 8, bw, 9);
        cx.fillStyle = "#e8c268";
        cx.fillText(w.name, bx2, by2 + 14.5);
        if (LICHT < .6) {
          cx.globalCompositeOperation = "lighter"; cx.globalAlpha = .16;
          cx.beginPath(); cx.ellipse(bx2, by2, 20, 9, 0, 0, Math.PI * 2);
          cx.fillStyle = "#ffca55"; cx.fill();
          cx.globalAlpha = 1; cx.globalCompositeOperation = "source-over";
        }
      }
      /* Fischerboote an den Molen: sanft dümpelnd, jede zweite Kachel eins */
      if (t.pier && t.y % 2 === 0) {
        const bob = Math.sin(now / 700 + t.x * 2 + t.y) * 1.4;
        cx.globalAlpha = .95;
        cx.drawImage(MEDIT.boot, sx + TW * .3 - 14, sy + TH / 2 - 7 + bob, 28, 14);
        cx.globalAlpha = 1;
      }
      /* Strand: vereinzelte Sonnenschirme und ein gezogenes Ruderboot */
      if (t.sand && !t.btype) {
        const h2 = (t.x * 13 + t.y * 7) % 11;
        if (h2 === 0) {
          const s = MEDIT.schirme[(t.x + t.y) % MEDIT.schirme.length];
          cx.drawImage(s, sx - 10 + ((t.x * 3) % 9) - 4, sy + TH / 2 - 12 + ((t.y * 5) % 7) - 3, 20, 20);
        } else if (h2 === 5) {
          cx.save(); cx.translate(sx, sy + TH / 2); cx.rotate(((t.x + t.y) % 5 - 2) * .3);
          cx.drawImage(MEDIT.boot, -12, -6, 24, 12); cx.restore();
        }
      }
      /* Zypressen-Alleen: freie Kacheln direkt an den Corsi bekommen die
       * schlanken Säulen — jede zweite, leicht versetzt, wie gepflanzt. */
      if (!t.water && !t.road && !t.btype && !t.field && !t.park && !t.sand && !t.piazza &&
          ([7, 9, 16, 18].includes(t.x) || [7, 9, 16, 18].includes(t.y)) &&
          (t.x + t.y) % 2 === 0) {
        const richtungX = t.x === 7 ? .3 : t.x === 9 ? -.3 : 0;   // zur Straße rücken
        const richtungY = t.y === 7 ? .3 : t.y === 9 ? -.3 : 0;
        const ox = (richtungX - richtungY) * TW / 2, oy = (richtungX + richtungY) * TH / 2;
        cx.drawImage(MEDIT.zypresse, sx + ox - 7, sy + TH / 2 + oy - 34, 14, 40);
      }
      /* Altstadt-Häuser: schmale Palazzi füllen die Viertel an den Straßen.
       * Rein dekorativ — wer dort baut, ersetzt das Haus (so ist die Mafia). */
      if (!t.btype && CASAS) {
        const seed = CASAS.get(t.x + "," + t.y);
        if (seed != null) {
          const haus = CASA_IMGS[seed % 18];
          if (haus) {
            /* Die Retro-Tiles bringen Bodenplatte und Beleuchtung selbst mit.
             * Anker: Unterkante der Bodenplatte auf die Kachel-Unterspitze —
             * vorher hingen die Häuser ~5 px über dem Boden und „flogen". */
            schattenMalen(haus, sx, sy + TH - 2, sy + TH - 50, 50, false, .3);
            cx.drawImage(haus, sx - 28, sy + TH - 54, 56, 56);
            /* Territorial-Stolz: Im kontrollierten Bezirk hängt die Familie
             * ihre Fahne an die Häuser — man sieht im Vorbeiscrollen, wem
             * die Straße gehört. Weht sacht im Seewind. */
            const bezC = st.bezirke?.[Math.min(2, Math.floor(t.x / 9)) + 3 * Math.min(2, Math.floor(t.y / 9))];
            const famC = bezC?.kontrolle && (st.familien || []).find(f => f.id === bezC.kontrolle);
            if (famC && (t.x + t.y) % 3 === 0) {
              const fxp = sx + 16, fyp = sy + TH - 52;
              cx.strokeStyle = "#3a3430"; cx.lineWidth = 1.2;
              cx.beginPath(); cx.moveTo(fxp, fyp); cx.lineTo(fxp, fyp + 14); cx.stroke(); cx.lineWidth = 1;
              const weh = Math.sin(now / 500 + t.x) * 1.5;
              cx.fillStyle = famC.farbe;
              cx.beginPath(); cx.moveTo(fxp, fyp);
              cx.quadraticCurveTo(fxp + 5, fyp + 1 + weh * .3, fxp + 9, fyp + 2 + weh);
              cx.lineTo(fxp + 8, fyp + 5 + weh); cx.quadraticCurveTo(fxp + 4, fyp + 5, fxp, fyp + 6);
              cx.closePath(); cx.fill();
            }
          } else {
            const set = MEDIT.casas[seed % MEDIT.casas.length];
            const img = LICHT < .5 ? set.nacht : set.tag;
            schattenMalen(img, sx, sy + TH / 2 + 2, sy + TH / 2 - 50, 40, false, .38);
            cx.drawImage(img, sx - 20, sy + TH / 2 - 51, 40, 55);
          }
        }
      }
      /* Gaslaternen in den Gassen: abwechselnd links und rechts, nachts mit
       * warmem Schein und Lichtpfütze auf dem Pflaster. */
      if (t.road && ![8, 17].includes(t.x) && ![8, 17].includes(t.y) && t.y !== 21 &&
          t.zone !== "kueste" && (t.x * 11 + t.y * 5) % 4 === 2) {
        const horiz = t.y % 9 === 4;
        const seite = (t.x + t.y) % 2 ? 1 : -1;
        const lx = sx + (horiz ? -1 : 1) * seite * 9.5;
        const ly = sy + TH / 2 + seite * 4.6;
        cx.drawImage(MEDIT.laterne, lx - 5, ly - 31, 10, 32);
        if (LICHT < .55) {
          const a = Math.min(1, (.55 - LICHT) * 1.8);
          cx.save(); cx.globalCompositeOperation = "lighter"; cx.globalAlpha = a * .8;
          cx.translate(lx, ly); cx.scale(1, .5);
          cx.drawImage(LICHTPFUETZE, -22, -22, 44, 44);         // Pfütze auf dem Pflaster
          cx.restore();
          cx.globalAlpha = a;
          cx.fillStyle = "rgba(255,214,130,.75)";
          cx.beginPath(); cx.arc(lx, ly - 26.5, 2.6, 0, Math.PI * 2); cx.fill();
          cx.globalAlpha = 1;
        }
      }
      /* Wäscheleinen über den Altstadt-Gassen: durchhängende Leine mit
       * bunter Wäsche, die sacht im Seewind schwingt. */
      if (t.road && ![8, 17].includes(t.x) && ![8, 17].includes(t.y) && t.y !== 21 &&
          (t.x * 11 + t.y * 5) % 4 === 0 && t.zone !== "kueste") {
        const sway = Math.sin(now / 900 + t.x * 1.7 + t.y) * 1.6;
        const y0 = sy + TH / 2 - 15;
        const p1 = [sx - TW * .32, y0], p2 = [sx + TW * .32, y0], mid = [sx + sway * .4, y0 + 5];
        cx.strokeStyle = "rgba(60,50,40,.65)"; cx.lineWidth = 1;
        cx.beginPath(); cx.moveTo(...p1); cx.quadraticCurveTo(...mid, ...p2); cx.stroke();
        for (let i = 0; i < 3; i++) {
          const u = .28 + i * .22;
          const lx = (1-u)*(1-u)*p1[0] + 2*(1-u)*u*mid[0] + u*u*p2[0];
          const ly = (1-u)*(1-u)*p1[1] + 2*(1-u)*u*mid[1] + u*u*p2[1];
          cx.fillStyle = MEDIT.waescheFarben[(t.x + t.y + i) % MEDIT.waescheFarben.length];
          cx.save(); cx.translate(lx, ly); cx.rotate(sway * .06);
          cx.fillRect(-2.4, 0, 4.8, 6); cx.restore();
        }
      }
      /* Leuchtturm auf der Schmuggler-Insel: weißer Turm mit roten Bändern,
       * nachts kreist das Leuchtfeuer über der Bucht. */
      if (t.leuchtturm) {
        const bx2 = sx, by2 = sy + TH / 2;
        cx.fillStyle = "rgba(0,0,0,.25)";
        cx.beginPath(); cx.ellipse(bx2 + 3, by2 + 3, 10, 4.5, 0, 0, Math.PI * 2); cx.fill();
        for (let seg = 0; seg < 4; seg++) {   // konischer Turm, rot-weiß gebändert
          const w2 = 9 - seg * 1.6, yTop = by2 - 8 - seg * 9;
          cx.fillStyle = seg % 2 ? "#c9473a" : "#f2ede2";
          cx.beginPath();
          cx.moveTo(bx2 - w2, yTop + 9); cx.lineTo(bx2 + w2, yTop + 9);
          cx.lineTo(bx2 + w2 - .8, yTop); cx.lineTo(bx2 - w2 + .8, yTop); cx.closePath(); cx.fill();
        }
        cx.fillStyle = "#2b3440"; cx.fillRect(bx2 - 4.5, by2 - 49, 9, 5);      // Galerie
        const blitz = (Math.sin(now / 500) + 1) / 2;
        cx.fillStyle = `rgba(255,235,150,${.5 + blitz * .5})`;
        cx.beginPath(); cx.arc(bx2, by2 - 46.5, 2.6, 0, Math.PI * 2); cx.fill();
        cx.fillStyle = "#8a2f26";
        cx.beginPath(); cx.moveTo(bx2 - 5, by2 - 49); cx.lineTo(bx2 + 5, by2 - 49);
        cx.lineTo(bx2, by2 - 56); cx.closePath(); cx.fill();                    // Dachhaube
        if (LICHT < .75) {   // nachts: kreisender Lichtkegel
          const ang = now / 1400;
          cx.save(); cx.translate(bx2, by2 - 46.5);
          cx.globalAlpha = (.75 - LICHT) * .9;
          for (const a of [ang, ang + Math.PI]) {
            const grad = cx.createLinearGradient(0, 0, Math.cos(a) * 85, Math.sin(a) * 42);
            grad.addColorStop(0, "rgba(255,240,170,.55)"); grad.addColorStop(1, "rgba(255,240,170,0)");
            cx.fillStyle = grad;
            cx.beginPath(); cx.moveTo(0, 0);
            cx.lineTo(Math.cos(a - .16) * 85, Math.sin(a - .16) * 42);
            cx.lineTo(Math.cos(a + .16) * 85, Math.sin(a + .16) * 42);
            cx.closePath(); cx.fill();
          }
          cx.restore(); cx.globalAlpha = 1;
        }
      }
      /* Möwen: kreisen über der äußeren Molenspitze, Flügelschlag inklusive */
      if (t.pier && t.y % 2 === 1) {
        for (let m = 0; m < 3; m++) {
          const ph = now / 1600 + m * 2.1 + t.x;
          const gx = sx + Math.cos(ph) * (26 + m * 7);
          const gy = sy - 26 - m * 6 + Math.sin(ph) * 9;
          const flap = Math.sin(now / 140 + m * 3) * 3;
          cx.strokeStyle = "rgba(245,245,240,.9)"; cx.lineWidth = 1.4;
          cx.beginPath();
          cx.moveTo(gx - 5, gy - flap); cx.quadraticCurveTo(gx - 2, gy + 1.5, gx, gy);
          cx.quadraticCurveTo(gx + 2, gy + 1.5, gx + 5, gy - flap);
          cx.stroke(); cx.lineWidth = 1;
        }
      }
    }
    if (t.deko) {
      /* Bewusst ohne Sockel und ohne Beschriftung: Bank und Nachrichtenzentrale
       * sind Orte, die man anklickt — diese Tuerme sind nur Stadtbild und
       * sollen sich nicht als bedienbar ausgeben. */
      const dimg = dekoSprite(t);
      if (dimg) {
        const gr = dekoGroesse(dimg);
        cx.drawImage(dimg, sx - gr / 2, standY(sy, dimg, gr), gr, gr);
      }
    }
    if (t.wohnblock) wohnMalen(t, sx, sy, st);
    if (t.bank) {
      /* Bank: goldener Sockel, damit sie sich als städtisches Gebäude von den
       * Spielergebäuden abhebt, plus Beschriftung. */
      cx.fillStyle = "rgba(56,189,248,.28)";
      cx.beginPath(); cx.moveTo(sx,sy); cx.lineTo(sx+TW/2,sy+TH/2); cx.lineTo(sx,sy+TH); cx.lineTo(sx-TW/2,sy+TH/2); cx.closePath(); cx.fill();
      cx.strokeStyle = "#38bdf8"; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1;
      const bimg = BANKSPR || spriteFor("kontor", t.x, t.y);
      if (bimg) cx.drawImage(bimg, sx-36, standY(sy, bimg, 72), 72, 72);
      cx.font = "bold 10px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#38bdf8";
      cx.fillText(uebers("BANK"), sx, sy + TH / 2 + 16);
    }
    if (t.news) {
      const nimg = NEWSSPR || spriteFor("buero", t.x, t.y);
      if (nimg) cx.drawImage(nimg, sx-36, standY(sy, nimg, 72), 72, 72);
      cx.font = "bold 10px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#fbbf24";
      cx.fillText(uebers("NACHRICHTEN"), sx, sy + TH / 2 + 16);
    }
    if (t.finanzamt) {
      /* Finanzamt: violetter Sockel wie die Bank, damit es als städtischer Ort lesbar ist */
      cx.fillStyle = "rgba(167,139,250,.26)";
      cx.beginPath(); cx.moveTo(sx,sy); cx.lineTo(sx+TW/2,sy+TH/2); cx.lineTo(sx,sy+TH); cx.lineTo(sx-TW/2,sy+TH/2); cx.closePath(); cx.fill();
      cx.strokeStyle = "#a78bfa"; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1;
      const fimg = STADT_SPR.finanzamt || spriteFor("buero", t.x, t.y);
      if (fimg) cx.drawImage(fimg, sx-36, standY(sy, fimg, 72), 72, 72);
      cx.font = "bold 10px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#a78bfa";
      cx.fillText(uebers("FINANZAMT"), sx, sy + TH / 2 + 16);
    }
    if (t.denkmal) {
      const dimg2 = STADT_SPR[t.denkmal] || spriteFor("kontor", t.x, t.y);
      if (dimg2) cx.drawImage(dimg2, sx-36, standY(sy, dimg2, 72), 72, 72);
      cx.font = "bold 10px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#fbbf24";
      cx.fillText(String(t.denkmalName || "").toUpperCase(), sx, sy + TH / 2 + 16);
    }
    if (t.schwarz) {
      /* Schwarzmarkt-Baracke: rot markiert, bewusst unscheinbarer als die Bank. */
      cx.fillStyle = "rgba(244,63,94,.22)";
      cx.beginPath(); cx.moveTo(sx,sy); cx.lineTo(sx+TW/2,sy+TH/2); cx.lineTo(sx,sy+TH); cx.lineTo(sx-TW/2,sy+TH/2); cx.closePath(); cx.fill();
      cx.strokeStyle = "#f43f5e"; cx.lineWidth = 1.6; cx.stroke(); cx.lineWidth = 1;
      const simg = spriteFor("markt", t.x, t.y) || spriteFor("kontor", t.x, t.y);
      if (simg) cx.drawImage(simg, sx-36, standY(sy, simg, 72), 72, 72);
      cx.font = "bold 10px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#f43f5e";
      cx.fillText(uebers("SCHWARZMARKT"), sx, sy + TH / 2 + 16);
    }
    if (t.btype) {
      const owner = st.players[t.owner];
      const col = owner?.color || "#666";
      const spr = spriteFor(t.btype, t.x, t.y);
      /* Eigene Gebaeude deutlich staerker markieren als fremde. Vorher sahen
       * alle gleich aus — dieselbe Kachelfaerbung mit 33 % Deckkraft, dieselbe
       * duenne Linie, nur in anderer Farbe. Auf einer Karte voller Symbole
       * findet man seine eigenen Betriebe so nicht wieder. */
      const meins = t.owner === store.get().myId;
      if (spr) {
        // Besitzer-Markierung: eingefärbte Kachel unter dem Sprite
        cx.fillStyle = col + (meins ? "88" : "44");
        cx.beginPath(); cx.moveTo(sx,sy); cx.lineTo(sx+TW/2,sy+TH/2); cx.lineTo(sx,sy+TH); cx.lineTo(sx-TW/2,sy+TH/2); cx.closePath(); cx.fill();
        cx.strokeStyle = col; cx.lineWidth = meins ? 2.6 : 1.2;
        if (meins) { cx.shadowColor = col; cx.shadowBlur = 9; }
        cx.stroke();
        cx.shadowBlur = 0; cx.lineWidth = 1;
        // Sprite direkt auf die Kachel — Grundfläche mittig, ohne Bodenschatten
        const oben = standY(sy, spr, 64);
        cx.drawImage(spr, sx-32, oben, 64, 64);
        /* Firmenschild: das selbst gemalte Logo des Besitzers am Gebäude */
        const schild = st.logoV?.[t.owner] != null && FLOGO[t.owner]?.canvas;
        if (schild) {
          const gx = sx + 12, gy = oben + 10;
          cx.fillStyle = "#fff"; cx.fillRect(gx - 1.5, gy - 1.5, 19, 19);
          cx.strokeStyle = col; cx.lineWidth = 1; cx.strokeRect(gx - 1.5, gy - 1.5, 19, 19);
          const glatt = cx.imageSmoothingEnabled; cx.imageSmoothingEnabled = false;
          cx.drawImage(schild, gx, gy, 16, 16); cx.imageSmoothingEnabled = glatt;
        }
        /* Aktive Industrie raucht; pausierte nicht. */
        if (RAUCHER.has(t.btype) && !t.paused) drawRauch(sx, oben, t.x * 5 + t.y, now);
        /* Nachts warmes Fensterlicht über dem Gebäude. */
        if (LICHT < .55) {
          cx.globalAlpha = (.55 - LICHT) * .9;
          cx.drawImage(GLOW, sx - 24, sy + TH / 2 - 30, 48, 48);
          cx.globalAlpha = 1;
        }
      } else {
        const h = 14 + (BTYPES()[t.btype]?.cost || 1000) / 1500;
        cx.fillStyle = col;
        cx.beginPath(); cx.moveTo(sx,sy+TH-h); cx.lineTo(sx+TW/2-6,sy+TH/2+3-h); cx.lineTo(sx+TW/2-6,sy+TH/2+3); cx.lineTo(sx,sy+TH); cx.closePath(); cx.fill();
        cx.fillStyle = shade(col,-40);
        cx.beginPath(); cx.moveTo(sx,sy+TH-h); cx.lineTo(sx-TW/2+6,sy+TH/2+3-h); cx.lineTo(sx-TW/2+6,sy+TH/2+3); cx.lineTo(sx,sy+TH); cx.closePath(); cx.fill();
        cx.fillStyle = shade(col,30);
        cx.beginPath(); cx.moveTo(sx,sy+TH-h); cx.lineTo(sx+TW/2-6,sy+TH/2+3-h); cx.lineTo(sx,sy+6-h); cx.lineTo(sx-TW/2+6,sy+TH/2+3-h); cx.closePath(); cx.fill();
      }
      if (t.lien) drawWarn(sx, sy - 42);
      if (t.paused) drawPause(sx + (t.lien ? 13 : 0), sy - 42);
      /* Anlage in Arbeit: Baubalken über dem Gebäude, bis es produziert */
      if (t.bauBis && st.tick < t.bauBis) {
        const dauer = st.marktCfg?.bauDauer || 30, rest = t.bauBis - st.tick;
        const k = Math.max(0, Math.min(1, 1 - rest / dauer)), w = 30;
        cx.fillStyle = "rgba(10,14,21,.75)"; cx.fillRect(sx - w / 2 - 1, sy - 37, w + 2, 6);
        cx.fillStyle = "#f59e0b"; cx.fillRect(sx - w / 2, sy - 36, w * k, 4);
        cx.font = "bold 9px sans-serif"; cx.textAlign = "center"; cx.fillStyle = "#f59e0b";
        cx.fillText(`im Bau ${rest}s`, sx, sy - 40);
      }
      if (t.level > 1) { cx.font="bold 10px sans-serif"; cx.textAlign="center"; cx.fillStyle="#38bdf8";
        cx.fillText(`★${t.level}`, sx, sy - 48); }
    }
    /* Fahrzeuge auf dieser Kachel — nach ihrem Gebaeude, aber vor allen
     * Kacheln, die weiter vorne liegen. */
    verkehrZeichnen(t.x, t.y);
  }
  verkehrRest();          // was ausserhalb der Karte liegt, nicht verschlucken
  if (FL) FLAECHE.schilder(cx, st.map);
  drawEffekte(now);
  drawClouds(now);
  drawAtmosphere();
  rennStreckeZeichnen();
  leistungMessen(pnow);
}
requestAnimationFrame(draw);

cv.addEventListener("mousedown", e => { drag = { x:e.clientX, y:e.clientY, cx:cam.x, cy:cam.y, moved:false }; cv.classList.add("drag"); });
addEventListener("mousemove", e => { if (!drag) return;
  const dx = e.clientX-drag.x, dy = e.clientY-drag.y;
  if (Math.abs(dx)+Math.abs(dy) > 4) drag.moved = true;
  cam.x = drag.cx+dx; cam.y = drag.cy+dy; });
addEventListener("mouseup", e => { if (drag && !drag.moved) clickTile(e); drag = null; cv.classList.remove("drag"); });
/* ---- Mausrad und Trackpad ----
 * Vorher zoomte JEDES Rad-Ereignis um feste 10 % zur Bildschirmmitte. Ein
 * Trackpad feuert pro Geste Dutzende Ereignisse — die Karte sprang. Jetzt:
 *  - Zoom proportional zur Drehung und zum Mauszeiger hin (der Punkt unter
 *    dem Zeiger bleibt stehen)
 *  - Zwei-Finger-Wischen auf dem Trackpad verschiebt die Karte
 *  - Kneifen (Pinch, kommt als Rad + Strg) zoomt */
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const zeilen = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  const dx = e.deltaX * zeilen, dy = e.deltaY * zeilen;
  const trackpadWisch = EINST.trackpadSchiebt && !e.ctrlKey && e.deltaMode === 0 && (Math.abs(dx) > 0 || Math.abs(dy) < 40);
  if (trackpadWisch) { cam.x -= dx; cam.y -= dy; return; }
  const faktor = Math.exp(-dy * (e.ctrlKey ? .01 : .0018) * (EINST.radEmpf || 1));
  const z2 = Math.max(.5, Math.min(2.2, cam.z * faktor));
  // Weltpunkt unter dem Zeiger festhalten (abschaltbar: dann zur Bildmitte)
  const ax = EINST.zoomZumZeiger ? e.clientX - innerWidth / 2 - cam.x : -cam.x;
  const ay = EINST.zoomZumZeiger ? e.clientY - 120 - cam.y : innerHeight / 2 - 120 - cam.y;
  cam.x -= ax * (z2 / cam.z - 1); cam.y -= ay * (z2 / cam.z - 1);
  cam.z = z2;
}, { passive:false });

const tm = document.getElementById("tilemenu");
function pickTile(mx, my) {
  const st = store.get().state; if (!st) return null;
  const wx = (mx-innerWidth/2-cam.x)/cam.z, wy = (my-120-cam.y)/cam.z - TH/2;
  const fx = (wx/(TW/2)+wy/(TH/2))/2, fy = (wy/(TH/2)-wx/(TW/2))/2;
  const x = Math.round(fx), y = Math.round(fy);
  return st.map.find(t => t.x===x && t.y===y) || null;
}
/* ---- Illegales Casino: 17+4 gegen die Kasse des Besitzers ----
 * Der Server hält die Hand; hier wird nur angezeigt und geklickt. Jede
 * Antwort (ack) trägt den kompletten Spielstand — kein eigener State. */
function casinoUi(t, res) {
  const st = store.get().state, owner = st.players[t.owner]?.name ?? "—";
  const karten = h => (h || []).map(k =>
    `<span style="display:inline-block;min-width:26px;padding:5px 4px;margin:0 3px;background:#f5f1e6;color:#1a1410;border-radius:5px;font-weight:700;text-align:center;box-shadow:0 2px 4px rgba(0,0,0,.4)">${k.n}</span>`).join("");
  let inhalt;
  if (!res) {
    inhalt = `<p class="note" style="margin:6px 0">17+4 gegen die Bank von <b>${owner}</b>.
        Ziel sind 21 Punkte — wer drüber liegt, verliert; die Bank zieht bis 17 und gewinnt den Gleichstand.
        Gewinn zahlt die Kasse des Besitzers, Verlust geht an ihn. Zwei Asse sind das „Feuer“ — sofort gewonnen.</p>
      <div style="display:flex;gap:6px;margin-top:8px">
        <input id="casinoEinsatz" type="number" min="50" max="2000" value="200" style="flex:1" title="Einsatz $">
        <button class="buyb" id="casinoGeben">Karten geben</button>
      </div>`;
  } else if (res.error) {
    inhalt = `<p class="note" style="margin:6px 0;color:var(--warn,#f5a742)">${res.error}</p>`;
  } else if (res.status === "offen") {
    inhalt = `<div style="margin:8px 0">${karten(res.hand)} <b style="margin-left:6px">= ${res.wert}</b></div>
      <div style="display:flex;gap:6px">
        <button class="buyb" id="casinoZiehen" style="flex:1">Karte ziehen</button>
        <button class="buyb" id="casinoHalten" style="flex:1">Halten (${res.wert})</button>
      </div>
      <p class="note" style="margin:6px 0 0">Einsatz: ${fmt(res.einsatz)}</p>`;
  } else {
    const titel = res.status === "gewonnen" ? `🎉 Gewonnen — die Kasse zahlt ${fmt(res.einsatz + res.auszahlung)}`
      : res.status === "push" ? "Unentschieden — Einsatz zurück"
      : "Das Haus gewinnt";
    inhalt = `<div style="margin:8px 0">Du: ${karten(res.hand)} <b>= ${res.wert}</b></div>
      ${res.bank?.length ? `<div style="margin:8px 0">Bank: ${karten(res.bank)} <b>= ${res.bankWert}</b></div>` : ""}
      <p style="margin:6px 0;font-weight:600;color:${res.status === "gewonnen" ? "var(--accent2,#2ecc71)" : res.status === "push" ? "var(--muted,#9aa7bd)" : "#e74c3c"}">${titel}</p>
      <button class="buyb" id="casinoNochmal">Noch eine Runde</button>`;
  }
  tm.style.display = "block";
  tm.innerHTML = `<h3>🎰 Illegales Casino</h3>` + inhalt;
  const geben = einsatz => socket.emit("casinoStart", { x: t.x, y: t.y, einsatz }, r => casinoUi(t, r));
  document.getElementById("casinoGeben")?.addEventListener("click", () =>
    geben(+document.getElementById("casinoEinsatz").value));
  document.getElementById("casinoNochmal")?.addEventListener("click", () => casinoUi(t));
  document.getElementById("casinoZiehen")?.addEventListener("click", () =>
    socket.emit("casinoZiehen", {}, r => casinoUi(t, r)));
  document.getElementById("casinoHalten")?.addEventListener("click", () =>
    socket.emit("casinoHalten", {}, r => casinoUi(t, r)));
}
function clickTile(e) {
  const t = pickTile(e.clientX, e.clientY); tm.style.display = "none";
  const me = store.get().me, myId = store.get().myId;
  /* Die Stadtbank ist kein Bauplatz, sondern der Handelsplatz für Firmenanteile */
  if (t?.schwarz && me) { openPanel("schwarz"); return; }
  if (t?.bank && me) { openPanel("bank"); return; }
  if (t?.news && me) { openPanel("news"); return; }
  /* Wohngebiet: dort baut nur die Stadt — der Klick zeigt die Stadtübersicht im Finanzamt */
  if ((t?.finanzamt || t?.denkmal || t?.wohnblock || (t?.zone === "wohnen" && !t.road)) && me) { openPanel("finanzamt"); return; }
  if (t?.gcasino && me) { gcasinoOeffnen(); return; }
  if (t?.wz && me) { wzOeffnen(t.wz); return; }
  if (t?.famhaus && me) { famOeffnen(t.famhaus); return; }
  /* Die Deko-Hochhaeuser sind reines Stadtbild. Ohne diese Zeile ginge beim
   * Klick das Baumenue auf und boete Gebaeude an, die der Server anschliessend
   * ablehnt — ein Versprechen, das nicht eingeloest werden kann. */
  if (t?.deko) return;
  /* Kartellmodus: Klick auf einen Werttransport = Überfallversuch. */
  const stK = store.get().state;
  if (stK?.mode === "kartell" && stK.transporte?.length && me) {
    const wx = (e.clientX - innerWidth / 2 - cam.x) / cam.z,
          wy = (e.clientY - 120 - cam.y) / cam.z;
    for (const tr of stK.transporte) {
      const [tx2, ty2] = iso(tr.x, tr.y);
      if (Math.hypot(wx - tx2, wy - (ty2 + TH / 2 - 8)) < 26) {
        socket.emit("ueberfall", { transportId: tr.id }, r => {
          if (r?.error) toast(r.error);
          else if (r?.beute) toast(`💥 Überfall geglückt — Beute: ${r.beute}`);
        });
        return;
      }
    }
  }
  /* Kartellmodus: Straßen sind anklickbar — hier errichtet man Sperren. */
  if (stK?.mode === "kartell" && t?.road && me && stK.players?.[myId]?.familie) {
    if (t.sperre) { toast("Hier steht schon eine Straßensperre"); return; }
    tm.style.display = "block";
    tm.style.left = Math.min(innerWidth - 275, e.clientX + 10) + "px";
    tm.style.top = Math.min(innerHeight - 330, e.clientY - 10) + "px";
    tm.innerHTML = `<h4>🚧 Straße</h4>
      <button class="opt" id="sperreBtn">Straßensperre errichten <small>800 $ · hält 3 min · zählt wie 2 Gebäude im Bezirk und stoppt Werttransporte</small></button>`;
    document.getElementById("sperreBtn").onclick = () => {
      tm.style.display = "none";
      socket.emit("sperreBauen", { x: t.x, y: t.y }, r => { if (r?.error) toast(r.error); });
    };
    return;
  }
  if (!t || t.water || t.road || t.park || !me) return;
  tm.style.display = "block";
  tm.style.left = Math.min(innerWidth-275, e.clientX+10)+"px";
  tm.style.top  = Math.min(innerHeight-330, e.clientY-10)+"px";
  /* Fremdes Casino: kein Baumenü, sondern der Spieltisch. */
  if (t.btype === "casino" && t.owner !== myId) { casinoUi(t); return; }
  if (t.btype) {
    const bt = BTYPES()[t.btype], mine = t.owner === myId;
    const ownerName = store.get().state.players[t.owner]?.name ?? "—";
    const avg = store.get().state.avg || {};
    let shopHtml = "";
    if (bt.retail && mine) {
      shopHtml = (t.shop || []).map((s, i) => {
        const goodOpts = bt.retail.goods.map(g =>
          `<option value="${g}" ${s?.good === g ? "selected" : ""}>${gname(g)}</option>`).join("");
        const info = s ? (() => {
          /* Werbung hebt den Bezugspreis — dasselbe Preisschild bremst dann weniger */
          const speed = Math.min(2, Math.pow((avg[s.good] ?? 1) * (me.ad?.boost || 1) / s.price, 2));
          /* Der Durchsatz hängt zusätzlich am Stückwert: billige Massenware
           * fließt schneller durch den Laden als teure Einzelstücke. */
          const rate = bt.retail.base * (store.get().meta?.retailFlow?.[s.good] ?? 1) * speed;
          const rest = s.qty != null ? ` · noch ${Math.ceil(s.qty)} Stk (~${Math.ceil(s.qty / Math.max(0.001, rate))} s)` : " · unbegrenzt";
          return `verkauft ~${rate.toFixed(2)}/s ≈ ${fp(rate * s.price)}/s${rest}`;
        })() : "Slot inaktiv — Ware, Menge &amp; Preis wählen";
        return `<div class="tmSlot">
          <div class="tmSlotZeile">
            <label><span>Ware</span><select id="sg-${i}">${goodOpts}</select></label>
            <label><span>Menge</span><input id="sq-${i}" type="number" min="1" value="${s?.qty != null ? Math.ceil(s.qty) : ""}" placeholder="∞" title="Menge (leer = unbegrenzt)"></label>
            <label><span>Preis $</span><input id="sp-${i}" type="number" min="0.01" step="0.01" value="${s?.price ?? (avg[bt.retail.goods[0]] ?? 1).toFixed(2)}" title="Stückpreis $"></label>
            <button class="mini tmOk" data-slot="${i}" aria-label="Regal ${i + 1} übernehmen">✓</button>
          </div>
          <div class="tmSlotInfo">${info}</div></div>`;
      }).join("") + (bt.online ? `<div class="tmSlotInfo" style="margin-top:4px">Strom und Elektronik kauft die Stadt nur langsam — beides brauchen die Firmen. An der Börse wirst du es schneller los.</div>` : "");
    }
    const lvl = t.level || 1;
    const canLevel = !!(bt.out || bt.proc || bt.racing || bt.studio || bt.rz || bt.online);
    const lvlMult = 1 + 0.3 * (lvl - 1);
    let upgradeHtml = "";
    if (canLevel && mine) {
      if (lvl >= 5) {
        upgradeHtml = `<div class="tmHinweis">Höchststufe erreicht</div>`;
      } else {
        const ec = Math.ceil(bt.cost / 2500 * lvl), cc = Math.round(bt.cost * 0.35 * lvl);
        const afford = me.inv.elektronik >= ec && me.cash >= cc;
        const nutzen = bt.racing ? `${lvl + 1} Stellplätze statt ${lvl}` : bt.online ? `${(t.shop || []).length + 1} Regale statt ${(t.shop || []).length}` : bt.rz ? `${(lvl + 1) * bt.rz.plaetze} Kunden statt ${lvl * bt.rz.plaetze}` : bt.studio ? "+30 % Entwicklungspunkte" : "+30 % Ausstoß";
        const fehlt = [me.inv.elektronik < ec ? `${ec - (me.inv.elektronik || 0)} Elektronik` : "",
                       me.cash < cc ? fmt(cc - me.cash) : ""].filter(Boolean).join(" + ");
        upgradeHtml = `<button class="tmHaupt" id="upgrade" ${afford ? "" : "disabled"}>
            <span>Auf Stufe ${lvl + 1} ausbauen</span>
            <small>${nutzen} · ${ec} Elektronik · ${fmt(cc)}</small></button>`
          + (afford ? "" : `<div class="tmHinweis">Dir fehlen ${fehlt}</div>`);
      }
    }
    /* Rennstall: die Garage. Ein Fahrzeug, das hier steht, ist keine Ware mehr —
     * deshalb steht die Warnung direkt am Knopf und nicht im Kleingedruckten. */
    let stallHtml = "";
    if (bt.racing) {
      const autos = t.autos || [], kap = lvl;
      const karte = a => `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px">
          <b>${gname(a.good)} #${a.nr}</b>
          <div class="note" style="margin:4px 0 0">
            Speed <b>${a.werte?.speed ?? "—"}</b> · Beschleunigung <b>${a.werte?.beschl ?? "—"}</b> · Handling <b>${a.werte?.handling ?? "—"}</b>
            · Effizienz <b>${a.werte?.effizienz ?? "—"}</b> · Standfestigkeit <b>${a.werte?.standfest ?? "—"}</b>
            <br>Zustand ${a.zustand} % · ${a.rennen} Rennen · ${a.siege} Siege
          </div></div>`;
      const liste = autos.length ? autos.map(karte).join("")
        : `<div class="note" style="margin:0 0 6px">Noch kein Fahrzeug eingestellt.</div>`;
      let aktion = "";
      if (mine) {
        const imLager = ["eauto", "dieselauto", "benzinauto"].filter(g => (me.inv[g] || 0) >= 1);
        aktion = autos.length >= kap
          ? `<div class="note" style="margin:0">Alle ${kap} Stellplätze belegt — ein Ausbau schafft einen weiteren.</div>`
          : imLager.length
            ? imLager.map(g => `<button class="opt" data-auto="${g}">${gname(g)} einstellen
                <small>${me.inv[g]} im Lager · verlässt das Lager endgültig</small></button>`).join("")
            : `<div class="note" style="margin:0">Kein Fahrzeug im Lager — an der Börse kaufen.</div>`;
      }
      stallHtml = `<div class="note" style="margin-top:6px"><b>Garage ${autos.length}/${kap} Stellplätze</b>
        <br>Eingestellte Fahrzeuge sind keine handelbare Ware mehr. Zu Geld machen lässt sich
        danach nur der ganze Stall — über die Versteigerung an der Stadtbank.</div>` + liste + aktion;
    }
    /* Werbeagentur: Kampagnen buchen. Reichweite zerfällt laufend, deshalb steht
     * daneben, was der Aufschlag gerade wert ist und wie lange er noch trägt. */
    let adHtml = "";
    if (bt.ad && mine) {
      const ad = me.ad || {};
      const pakete = Object.entries(ad.pakete || {}).map(([k, pk]) =>
        `<button class="opt" data-ad="${k}" ${me.cash >= pk.cost ? "" : "disabled"}>${pk.name}
           <small>${fmt(pk.cost)} · +${pk.reach} Reichweite</small></button>`).join("");
      const pct = Math.round((ad.boost - 1) * 100);
      adHtml = `<div class="note" style="margin-top:6px">
          Reichweite <b>${ad.reach}/100</b> · Preisaufschlag <b style="color:var(--accent2)">+${pct} %</b>
          (Höchstwert +${Math.round((ad.cap || 0) * 100)} % bei ${ad.agenturen} Agentur${ad.agenturen === 1 ? "" : "en"})
          <br>Deine Läden verkaufen damit ${pct > 0 ? `bis zu ${pct} % über Ø-Kurs, ohne langsamer zu werden` : "zum Ø-Kurs"}.
          Ohne neue Kampagne ist die Reichweite in gut zwei Minuten aufgebraucht.
        </div>` + pakete;
    }
    /* Software: Shop-System auf dem Online-Marktplatz, Studio, Rechenzentrum */
    let swHtml = "";
    const swListe = store.get().state.software || [];
    const swTick = store.get().state.tick;
    const swName = id => swListe.find(x => x.id === id);
    const swChips = x => Object.entries(x.module || {}).filter(([m, an]) => an && !m.includes(":"))
      .map(([m]) => store.get().state.swModule?.[m]?.name || m).join(", ") || "keine Extras";
    if (bt.online) {
      const sys = t.system, akt = sys ? swName(sys.produktId) : null;
      const rest = sys ? sys.bis - swTick : 0;
      const offen = akt && rest <= 0;
      const shopKnopf = offen ? `<button class="tmHaupt" id="shopAuf"><span>🛒 Online-Shop öffnen</span><small>${mine ? "So sehen deine Kunden den Shop" : `Einkaufen, bezahlt mit ${akt.name}`}</small></button>` : "";
      if (!mine) {
        swHtml = shopKnopf + `<div class="tmHinweis">${akt ? `Läuft mit <b>${akt.name}</b> von ${akt.anbieter}.` : "Noch kein Shop-System installiert — der Shop ist geschlossen."}</div>`;
      } else {
        const status = !sys ? `<div class="tmSwStatus zu">Kein System — der Marktplatz verkauft noch nichts.</div>`
          : rest > 0 ? `<div class="tmSwStatus warn">${akt?.name ?? "System"} wird installiert · noch ${rest}s</div>`
          : `<div class="tmSwStatus an">${akt?.name ?? "System"} v${akt?.version ?? "?"} läuft${akt?.faktor < 1 ? ` · <b>überlastet (${Math.round(akt.faktor * 100)} %)</b>` : ""}</div>`;
        const werbung = akt?.module?.werbung && rest <= 0
          ? `<button class="opt" id="swWerbung" data-an="${sys.werbung ? 0 : 1}">${sys.werbung ? "Werbemodul ausschalten" : "Werbemodul einschalten"}
              <small>${fmt(akt.werbeAbo)}/min je Marktplatz · bis +${Math.round((store.get().state.swCfg?.werbeBoost || .2) * 100)} % über Ø-Kurs ohne Tempoverlust</small></button>` : "";
        const meineBranche = store.get().state.players[myId]?.industry;
        const wertFuer = x => x.wertJe?.[meineBranche] ?? x.wert;
        const baumTxt = x => (x.branchen || []).map(br => `${store.get().state.swBaeume?.[br]?.name || br} ${"●".repeat(x.stufen?.[br] || 0)}${"○".repeat(3 - (x.stufen?.[br] || 0))}`).join(" · ");
        const optionen = swListe.filter(x => x.version >= 1).sort((a, b) => wertFuer(b) - wertFuer(a)).map(x => {
          const voll = !x.portal && x.plaetze != null && x.kunden >= x.plaetze && x.id !== sys?.produktId;
          const aus = !x.portal && x.plaetze === 0;
          const jetzt = x.id === sys?.produktId;
          return `<button class="opt tmSwOpt${jetzt ? " jetzt" : ""}" data-sys="${x.id}" ${jetzt || voll || me.cash < x.einrichtung ? "disabled" : ""}>
            <span><i style="background:${x.farbe}"></i>${x.name} v${x.version}<em>${x.anbieter}</em></span>
            <small>${x.einrichtung ? fmt(x.einrichtung) + " einmalig" : "keine Einrichtung"} · ${String(x.gebuehr).replace(".", ",")} % je Verkauf · ${swChips(x)}${baumTxt(x) ? ` · <b>${baumTxt(x)}</b>` : ""}${x.portal ? "" : ` · Ruf ${x.ruf}`}${aus ? " · <b>fällt gerade aus</b>" : voll ? " · <b>voll</b>" : jetzt ? " · <b>aktiv</b>" : ""}</small></button>`;
        }).join("");
        swHtml = status + shopKnopf + werbung + `<div class="tmHinweis" style="margin:8px 2px 6px">${sys ? "Wechseln" : "Installieren"} (dauert ${store.get().state.swCfg?.install ?? 45} s, Stadtportal ${store.get().state.swCfg?.portalInstall ?? 90} s):</div>`
          + optionen + `<button class="tmKlein" id="swPanel" style="margin-top:4px">Alle Systeme vergleichen</button>`;
      }
    }
    if (bt.studio || bt.rz) {
      const meins = swListe.find(x => x.ownerId === t.owner && !x.portal);
      const zeilen = [];
      if (bt.rz) zeilen.push(`Rechenzentrum ${t.rzAktiv ? "<b style=\"color:var(--up)\">am Netz</b>" : "<b style=\"color:var(--down)\">aus — Strom fehlt</b>"}`,
        meins ? `${meins.name}: <b>${meins.kunden}</b> Kunden auf <b>${meins.plaetze ?? 0}</b> Plätzen` : "Noch kein Shop-System");
      if (bt.studio) zeilen.push(meins?.entwicklung ? `Entwickelt ${meins.name} v${meins.entwicklung.version}: <b>${meins.entwicklung.ep}/${meins.entwicklung.ziel} EP</b>`
        : meins ? `${meins.name} v${meins.version} · ${swChips(meins)}` : "Noch kein Shop-System angelegt");
      swHtml = `<div class="tmHinweis">${zeilen.join("<br>")}</div>`
        + (bt.rz && store.get().state.stadt ? `<button class="tmHaupt" id="rzAuf"><span>🌐 ${tUe("Statusseite öffnen")}</span><small>${mine ? tUe("Ausbau, Preise, Platzverteilung, Websites") : tUe("Verfügbarkeit, Hosting, Websites bestellen")}</small></button>` : "")
        + (mine ? `<button class="${bt.rz && store.get().state.stadt ? "tmKlein" : "tmHaupt"}" id="swPanel" style="margin-top:4px">${bt.rz && store.get().state.stadt ? tUe("Software-Baukasten öffnen") : "<span>Software-Baukasten öffnen</span><small>Name, Preise, neue Versionen</small>"}</button>` : "");
    }
    /* Steuerungssoftware auf Produktionsgebäuden: Systeme mit einem Baum für
     * die Branche dieses Gebäudes, Wirkung je nach Stufe, Abo je Minute. */
    let steuerHtml = "";
    const stCfg = store.get().state.steuerung || {}, stDef = stCfg[bt.industry];
    if (mine && stDef && (bt.proc || bt.out) && !bt.retail && !bt.studio && !bt.rz) {
      const stufeAnteil = store.get().state.steuerStufe || [0, .5, .8, 1];
      const tick = store.get().state.tick;
      const art = stDef.art === "in" && bt.proc ? "weniger Rohstoffe" : "mehr Ausstoß";
      const wirkung = x => Math.round(stDef.wert * stufeAnteil[x.stufen?.[bt.industry] || 0] * 100);
      const akt = t.steuerung ? swListe.find(x => x.id === t.steuerung.produktId) : null;
      const rest = t.steuerung ? Math.max(0, t.steuerung.bis - tick) : 0;
      const status = !akt ? `<div class="tmSwStatus zu">Keine Steuerung — ${stDef.name}-Software bringt bis zu ${Math.round(stDef.wert * 100)} % ${art}.</div>`
        : rest > 0 ? `<div class="tmSwStatus warn">${akt.name} wird installiert · noch ${rest}s</div>`
        : `<div class="tmSwStatus an">${stDef.name} von ${akt.name}: <b>${Math.round(wirkung(akt) * Math.min(1, akt.faktor ?? 1))} % ${art}</b>${akt.faktor < 1 ? ` · überlastet (${Math.round(akt.faktor * 100)} %)` : ""}</div>`;
      const optionen = swListe.filter(x => !x.portal && x.version >= 1 && (x.stufen?.[bt.industry] || 0) >= 1).sort((a, b) => wirkung(b) - wirkung(a) || a.steuerAbo - b.steuerAbo).map(x => {
        const jetzt = x.id === t.steuerung?.produktId, voll = x.plaetze != null && x.kunden >= x.plaetze && !jetzt;
        const abo = x.ownerId === myId ? 0 : x.steuerAbo;
        return `<button class="opt tmSwOpt${jetzt ? " jetzt" : ""}" data-steuer="${x.id}" ${jetzt || voll || me.cash < abo ? "disabled" : ""}>
          <span><i style="background:${x.farbe}"></i>${x.name} v${x.version}<em>${x.anbieter}</em></span>
          <small>${wirkung(x)} % ${art} · ${abo ? fmt(abo) + "/min" : "eigenes System, kein Abo"}${voll ? " · <b>voll</b>" : jetzt ? " · <b>aktiv</b>" : ""}</small></button>`;
      }).join("");
      steuerHtml = status + (optionen
        ? `<div class="tmHinweis" style="margin:8px 2px 6px">${akt ? "Wechseln" : "Installieren"} (dauert ${store.get().state.swCfg?.install ?? 45} s, keine Einrichtung):</div>` + optionen
        : `<div class="tmHinweis">Noch kein Shop-System hat einen Baum für ${store.get().state.swBaeume?.[bt.industry]?.name ?? "diese Branche"}.</div>`)
        + (akt ? `<button class="tmHaupt" id="leitAuf" style="margin-top:6px"><span>🎛 Leitstand öffnen</span><small>Anzeigen${akt.version >= (store.get().state.leitFunktion?.turbo ?? 2) ? ", Turbo" : ""}${akt.version >= (store.get().state.leitFunktion?.nachkauf ?? 3) ? ", Nachkauf" : ""} — im Design von ${akt.anbieter}</small></button>`
          + `<button class="tmKlein" id="steuerAus" style="margin-top:4px">Steuerung abschalten</button>` : "");
    }
    /* Touristik (Etappe 6): Sterne, Renovieren, Weg ins Touristik-Panel */
    let tourHtml = "";
    const tCfg = store.get().state.touristikCfg;
    if (store.get().state.touristik && tCfg && (t.btype === "campingplatz" || t.btype === "strandhotel")) {
      const s = t.btype === "campingplatz" ? 1 : (t.sterne || tCfg.START_STERNE), kosten = tCfg.RENOVIEREN[s];
      const firma = store.get().state.touristik.firmen.find(f => f.id === t.owner);
      tourHtml = `<div class="tmHinweis">${sterneHtml(s)} ${s} ${tUe("Sterne")}${s >= 3 ? ` · ${tUe("mit Frühstück")}` : ""}${firma ? `<br>${tUe("Firma")}: ${firma.gaeste} ${tUe("Gäste je Minute")} · ${fmt(firma.preis)} ${tUe("je Nacht")}` : ""}</div>`
        + (mine && t.btype === "strandhotel" && s < tCfg.MAX_STERNE ? `<button class="tmKlein" id="renov" style="margin-top:4px" ${me.cash < kosten ? "disabled" : ""}>${tUe("Auf")} ${s + 1} ${tUe("Sterne renovieren")} · ${fmt(kosten)}</button>` : "")
        + `<button class="tmHaupt" id="hotelAuf" style="margin-top:6px"><span>🌐 ${tUe("Buchungsseite öffnen")}</span><small>${mine ? tUe("Preis, Renovieren, Feste") : tUe("Häuser, Preise und Bewertungen")}</small></button>`
        + (mine ? `<button class="tmKlein" id="tourPanel" style="margin-top:4px">🏨 ${tUe("Touristik-Panel öffnen")}</button>` : "");
    }
    /* Übersichtliche Gebäudekarte: Kopf (Bild, Name, Stufe, Besitzer, Status),
     * zwei bis drei Kennzahlen, EIN Hauptknopf, kleine Nebenknöpfe. Die
     * Erklärtexte stehen eingeklappt unter „Mehr erfahren". */
    const ownerCol = store.get().state.players[t.owner]?.color || "#666";
    const sprSrc = spriteUrl(t.btype, t.x, t.y);
    const imBauNoch = t.bauBis && store.get().state.tick < t.bauBis ? t.bauBis - store.get().state.tick : 0;
    const status = imBauNoch ? ["warn", `Im Bau · noch ${imBauNoch}s`] : t.lien ? ["warn", "Pfandrecht"] : t.paused ? ["aus", "Pausiert"]
      : (bt.online && !(t.system && store.get().state.tick >= t.system.bis)) ? ["warn", "Kein System"]
      : (bt.rz && !t.rzAktiv) ? ["warn", "Kein Strom"]
      : (bt.out || bt.proc || bt.retail || bt.studio || bt.rz) ? ["an", "Läuft"] : null;
    const kennzahlen = [];
    if (bt.out) kennzahlen.push(["Produziert", `${(bt.rate * lvlMult).toFixed(2)}/s`, gname(bt.out)]);
    if (bt.proc) kennzahlen.push(
      ["Stellt her", `${(bt.proc.rate * lvlMult).toFixed(2)}/s`, gname(bt.proc.out)],
      ["Verbraucht", Object.entries(bt.proc.in).map(([g, n]) => `${(n * lvlMult).toFixed(2)} ${gname(g)}`).join(" + "), "pro Sekunde"]);
    if (bt.racing) kennzahlen.push(["Garage", `${(t.autos || []).length}/${lvl}`, "Stellplätze"]);
    if (bt.studio) kennzahlen.push(["Entwickelt", `${(bt.studio.ep * lvlMult).toFixed(2)} EP/s`, "Entwicklungspunkte"],
      ["Verbraucht", Object.entries(bt.studio.in).map(([g, n]) => `${(n * lvlMult).toFixed(2)} ${gname(g)}`).join(" + "), "pro Sekunde"]);
    if (bt.rz) kennzahlen.push(["Plätze", `${bt.rz.plaetze * lvl}`, "Marktplätze + Steuerungen"], ["Verbraucht", `${(bt.rz.in.strom * lvlMult).toFixed(2)} ${gname("strom")}`, "pro Sekunde"]);
    /* Belegschaft (Sandkasten): mit 3 von 5 Arbeitern läuft das Gebäude zu 60 % */
    const belegt = store.get().state.stadt && t.arbeiterSoll ? { ist: t.arbeiter ?? t.arbeiterSoll, soll: t.arbeiterSoll } : null;
    const mehr0 = [];
    if (belegt) {
      const q = belegt.ist / belegt.soll;
      if (t.fachSoll) mehr0.push(`<b>${tUe("Fachkräfte")}:</b> ${t.fach ?? 0} / ${t.fachSoll} — ${tUe("die Hälfte der Stellen hier verlangt Fachkräfte. Mehr bildet die Stadtbibliothek aus (Stadtprojekt).")}`);
      kennzahlen.push([tUe("Belegschaft"), `${belegt.ist}/${belegt.soll}`, t.paused ? tUe("pausiert — Arbeiter frei") : q < .25 ? tUe("steht still (unter 25 %)") : `${Math.round(Math.min(1, q) * 100)} % ${tUe("Leistung")}`]);
    }
    const mehr = [];
    if (bt.out && lvl > 1) mehr.push(`Basisrate ${bt.rate}/s × ${lvlMult.toFixed(1)} durch Stufe ${lvl}.`);
    if (bt.boosts) mehr.push(`<b>Boost:</b> ${bt.boosts.map(r => gname(r)).join(" + ")} im Lager bringen je +75 % Tempo und werden dabei verbraucht.`);
    if (bt.retail) mehr.push(`Dein Preis bestimmt das Tempo: Ø-Kurs = volle Rate, teurer = langsamer, billiger = schneller (max. ×2).`
      + ((me.ad?.boost || 1) > 1.001 ? ` <b style="color:var(--accent2)">Werbung aktiv: bis ${Math.round((me.ad.boost - 1) * 100)} % über Ø-Kurs ohne Tempoverlust.</b>` : ""));
    if (t.lien) mehr.push("Auf dem Gebäude liegt ein Pfandrecht — Abreißen ist gesperrt, bis die Anleihe bedient ist.");
    mehr.push(...mehr0);
    if (t.steuerung && belegt) mehr.push(tUe("Steuerungssoftware spart hier ein Viertel der Arbeiter."));
    if (belegt && belegt.ist < belegt.soll && mine && !t.paused)
      mehr.push(`<b>${tUe("Zu wenig Arbeiter")}:</b> ${tUe("Die Stadt hat gerade nicht genug Leute. Höhere Löhne (Firma-Panel) holen sie von anderen Firmen — oder warte, bis neue Bewohner zuziehen.")}`);
    if (imBauNoch) mehr.push(`Anlage in Arbeit: Das Gebäude produziert erst nach der Bauzeit. Sein Wert zählt aber schon jetzt voll zum Firmenwert — Bauen senkt den Wert deiner Firma nicht.`);
    const nebenKnoepfe = [
      (bt.retail || bt.proc) && mine ? `<button class="tmKlein" id="pause">${t.paused ? "▶ Fortsetzen" : "❚❚ Pausieren"}</button>` : "",
      mine && !t.lien ? `<button class="tmKlein gefahr" id="dem" data-preis="${fmt(bt.cost * .5)}">Abreißen</button>` : "",
    ].filter(Boolean).join("");
    tm.innerHTML = `
      <div class="tmKopf">
        ${sprSrc ? `<img class="tmBild" src="${sprSrc}" alt="">` : ""}
        <div class="tmTitel">
          <b>${bname(t.btype)}</b>
          <span class="tmBesitzer"><i style="background:${ownerCol}"></i>${mine ? "Deine Firma" : ownerName}</span>
        </div>
        <button class="tmZu" type="button" aria-label="Schließen">×</button>
      </div>
      <div class="tmChips">
        ${canLevel ? `<span class="tmStufe" title="Stufe ${lvl} von 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= lvl ? "on" : ""}"></i>`).join("")}<em>Stufe ${lvl}</em></span>` : ""}
        ${status ? `<span class="tmStatus ${status[0]}">${status[1]}</span>` : ""}
      </div>
      ${kennzahlen.length ? `<div class="tmZahlen">${kennzahlen.map(([k, v, u]) => `<div><span>${k}</span><b class="${String(v).length > 10 ? "lang" : ""}">${v}</b><small>${u}</small></div>`).join("")}</div>` : ""}
      ${swHtml ? `<div class="tmAbschnitt">${bt.online ? "Shop-System" : "Software"}</div>${swHtml}` : ""}
      ${steuerHtml ? `<div class="tmAbschnitt">Steuerungssoftware</div>${steuerHtml}` : ""}
      ${tourHtml ? `<div class="tmAbschnitt">${tUe("Gäste")}</div>${tourHtml}` : ""}
      ${shopHtml ? `<div class="tmAbschnitt">Regale</div>${shopHtml}` : ""}
      ${stallHtml ? `<div class="tmAbschnitt">Garage</div>${stallHtml}` : ""}
      ${adHtml ? `<div class="tmAbschnitt">Werbung</div>${adHtml}` : ""}
      ${mine ? upgradeHtml : ""}
      ${nebenKnoepfe ? `<div class="tmNeben">${nebenKnoepfe}</div>` : ""}
      ${mehr.length ? `<details class="tmMehr"><summary>Mehr erfahren</summary>${mehr.map(x => `<p>${x}</p>`).join("")}</details>` : ""}`;
    tm.querySelector(".tmZu").addEventListener("click", () => { tm.style.display = "none"; });
    tmPlatzieren(e);
    tm.querySelectorAll("[data-ad]").forEach(b => b.addEventListener("click", () => {
      act("bookAd", { paket: b.dataset.ad }); tm.style.display = "none";
    }));
    tm.querySelector("#pause")?.addEventListener("click", () => { act("togglePause", { x: t.x, y: t.y }); tm.style.display = "none"; });
    tm.querySelectorAll("[data-sys]").forEach(b => b.addEventListener("click", () => {
      act("installSystem", { x: t.x, y: t.y, produktId: b.dataset.sys }); tm.style.display = "none";
    }));
    tm.querySelectorAll("[data-steuer]").forEach(b => b.addEventListener("click", () => {
      act("installSteuerung", { x: t.x, y: t.y, produktId: b.dataset.steuer }); tm.style.display = "none";
    }));
    tm.querySelector("#steuerAus")?.addEventListener("click", () => { act("entferneSteuerung", { x: t.x, y: t.y }); tm.style.display = "none"; });
    tm.querySelector("#leitAuf")?.addEventListener("click", () => { tm.style.display = "none"; leitOeffnen(t.x, t.y); });
    tm.querySelector("#swWerbung")?.addEventListener("click", ev => {
      act("systemWerbung", { x: t.x, y: t.y, an: ev.currentTarget.dataset.an === "1" }); tm.style.display = "none";
    });
    tm.querySelector("#swPanel")?.addEventListener("click", () => { tm.style.display = "none"; openPanel("software"); });
    tm.querySelector("#tourPanel")?.addEventListener("click", () => { tm.style.display = "none"; openPanel("touristik"); });
    tm.querySelector("#hotelAuf")?.addEventListener("click", () => { tm.style.display = "none"; hotelOeffnen(t.owner); });
    tm.querySelector("#rzAuf")?.addEventListener("click", () => { tm.style.display = "none"; rzOeffnen(t.owner); });
    tm.querySelector("#renov")?.addEventListener("click", () => { act("renovieren", { x: t.x, y: t.y }); tm.style.display = "none"; });
    tm.querySelector("#shopAuf")?.addEventListener("click", () => { tm.style.display = "none"; shopOeffnen(t.x, t.y); });
    tm.querySelector("#upgrade")?.addEventListener("click", () => { act("upgradeBuilding", { x: t.x, y: t.y }); tm.style.display = "none"; });
    tm.querySelectorAll("[data-slot]").forEach(b => b.addEventListener("click", () => {
      const i = +b.dataset.slot;
      act("configureShop", { x: t.x, y: t.y, slot: i,
        good: document.getElementById("sg-" + i).value,
        qty: document.getElementById("sq-" + i).value,
        price: document.getElementById("sp-" + i).value });
      tm.style.display = "none";
    }));
    tm.querySelectorAll("[data-auto]").forEach(b => b.addEventListener("click", () => {
      act("stallEinstellen", { x: t.x, y: t.y, good: b.dataset.auto }); tm.style.display = "none";
    }));
    /* Abreißen ist endgültig — erster Klick fragt nach, zweiter führt aus. */
    tm.querySelector("#dem")?.addEventListener("click", ev => {
      const b = ev.currentTarget;
      if (!b.classList.contains("sicher")) { b.classList.add("sicher"); b.textContent = `Wirklich abreißen? +${b.dataset.preis}`; return; }
      act("demolish", { x:t.x, y:t.y }); tm.style.display = "none";
    });
    return;
  }
  const myInds = store.get().state?.players?.[myId]?.industries || [store.get().meta?.industry];
  /* Im Renntag entscheidet die Rolle, nicht die Branche — und kein Gebaeude
   * traegt "rennclub" oder "rennindustrie" als industry. Ohne diesen Zweig
   * fiele die Liste fuer beide Rollen leer aus: der Server erlaubt den Bau,
   * das Menue bietet ihn nur nicht an. Dieselbe Regel wie serverseitig, damit
   * beide Seiten dasselbe sagen. */
  const RENNTAG_BAUTEN = {
    rennclub: ["rennstall", "werbeagentur", "fanhub"],
    rennindustrie: ["reifenwerk", "rennlabor", "oelpumpe", "mine", "stahlwerk",
                    "siliziummine", "chipfabrik", "ewerk", "windpark", "werbeagentur"],
  };
  const rolleErlaubt = RENNTAG_BAUTEN[store.get().state?.players?.[store.get().myId]?.industry] || [];
  /* In der Kartellwirtschaft gibt es keine Renntage — der Rennstall fliegt hier
   * ganz aus dem Menü, statt gesperrt dazustehen. Ein Knopf, dessen Sperre man
   * nie aufheben kann, erklärt nichts; er sieht nur nach einem Ziel aus. */
  const kartellModus = store.get().state?.mode === "kartell";
  const meineFamilie = store.get().state?.players?.[store.get().myId]?.familie;
  const opts = Object.entries(BTYPES()).filter(([bid, b]) => b.zone === t.zone
    && !(kartellModus && b.racing)
    /* Familien-Gebäude: nur das der eigenen Familie, und nur im Kartellmodus */
    && !(b.familie && (!kartellModus || b.familie !== meineFamilie))
    && !(b.casino && !kartellModus)
    /* Regel 2: im Sandbox-Modus kommt Werbung aus dem Werbemodul der Shop-Systeme */
    && !(b.ad && store.get().state?.mode === "sandbox")
    /* Verkauft wird nur noch über den Online-Marktplatz */
    && !(b.retail && !b.online) && (
    store.get().state?.mode === "renntag"
      ? rolleErlaubt.includes(bid)
      /* Kartellmodus: Familien bauen ALLES — Bezirkskontrolle zählt Gebäude,
       * eine Branchen-Sperre aus dem Normalmodus hätte hier keinen Sinn. */
      : (kartellModus || !b.industry || myInds.includes(b.industry))));
  const mats = b => { if (kartellModus) return {};   // Kartell: die Mafia zahlt bar, kein Baumaterial
    const m = { ziegel: Math.ceil(b.cost / 400) };
    if (b.cost >= 4000 && b.proc?.out !== "beton") m.beton = Math.ceil(b.cost / 2000);
    return m; };
  const matName = { ziegel: "Ziegel", beton: "Beton" };
  const matTxt = b => Object.entries(mats(b)).map(([g, n]) => `${n} ${matName[g] || g}`).join(" + ");
  const totalCost = b => b.cost + (t.locked ? t.unlockCost : 0);
  /* Motorsport ist Spätspiel-Inhalt. Der Rennstall bleibt im Menü sichtbar,
   * aber gesperrt — sonst sucht man ihn im Lexikon und findet ihn im Bau-Dialog
   * nirgends, ohne je zu erfahren, woran es liegt. */
  const nwSchwelle = store.get().meta?.racingUnlock ?? 200000;
  const meinNW = store.get().state?.players?.[store.get().myId]?.netWorth ?? 0;
  /* Im Renntag ist Motorsport kein Spaetspiel-Inhalt, sondern der Zweck des
   * Modus — dort entfaellt die Schwelle. Der Server sieht das genauso; ohne
   * diese Zeile blieb der Knopf aber gesperrt und nannte einen Grund, den es
   * gar nicht mehr gab. */
  const rennModus = store.get().state?.mode === "renntag";
  /* Mehr als einen Rennstall je Firma laesst der Server nicht zu — im Renntag
   * hat man ihn von Anfang an. Ohne diese Zeile stuende dort ein ausgegrauter
   * "Rennstall $30.000" mit dem Preis als einzigem Hinweis, und der Grund
   * fuer die Sperre bliebe im Dunkeln. */
  const hatStall = (store.get().state?.map || [])
    .some(q => q.owner === store.get().myId && BTYPES()[q.btype]?.racing);
  const gesperrt = b => !!b.racing && (hatStall || (!rennModus && meinNW < nwSchwelle));
  const canAfford = b => !gesperrt(b) && me.cash >= totalCost(b) && Object.entries(mats(b)).every(([g, n]) => me.inv[g] >= n);
  const lockNote = t.locked ? ` (inkl. ${fmt(t.unlockCost)} Freischaltung)` : "";
  /* Kartellmodus: Auf der Kachel steht eines der Geschäfte der Stadt — aus
   * ihnen kommt das Schutzgeld. Wer hier baut, reißt es ab. */
  const casaNote = kartellModus && CASAS?.has(t.x + "," + t.y)
    ? `<div class="note" style="border-left:3px solid var(--accent);padding-left:7px">🏠 Hier steht ein <b>Geschäft des Viertels</b> — solche Läden zahlen das <b>Schutzgeld</b> (Kartell-Panel → Bezirke). Baust du hier, weicht es deinem Betrieb.</div>`
    : "";
  /* Baumenü als Kacheln: Bild, Name, was es herstellt, Preis. Wer etwas nicht
   * bauen kann, sieht in einer Zeile, warum — statt nur einen grauen Knopf. */
  const ZONENNAME = { agrar: "Agrar", zentrum: "Zentrum", industrie: "Industrie", kueste: "Küste" };
  const liefert = b => b.out ? `→ ${gname(b.out)}` : b.proc ? `→ ${gname(b.proc.out)}` : b.retail ? "Laden" : b.racing ? "Motorsport" : b.ad ? "Werbung" : "";
  const warumNicht = b => {
    if (gesperrt(b)) return hatStall && b.racing ? "Nur ein Rennstall erlaubt" : `Ab ${fmt(nwSchwelle)} Vermögen`;
    const fehlt = Object.entries(mats(b)).filter(([g, n]) => (me.inv[g] || 0) < n).map(([g, n]) => `${n - (me.inv[g] || 0)} ${matName[g] || g}`);
    if (me.cash < totalCost(b)) fehlt.unshift(fmt(totalCost(b) - me.cash));
    return fehlt.length ? "Fehlt: " + fehlt.join(" + ") : "";
  };
  tm.innerHTML = `
    <div class="tmKopf">
      <div class="tmTitel"><b>Bauplatz</b><span class="tmBesitzer">${ZONENNAME[t.zone] || t.zone}${t.locked ? ` · gesperrt, Freischaltung ${fmt(t.unlockCost)}` : ""}</span></div>
      <button class="tmZu" type="button" aria-label="Schließen">×</button>
    </div>` + casaNote
    + (opts.length
      ? `<div class="tmBauGrid">` + opts.map(([bid, b]) => {
          const ok = canAfford(b), src = spriteUrl(bid, t.x, t.y), grund = ok ? "" : warumNicht(b);
          return `<button class="opt tmBau" data-b="${bid}" ${ok ? "" : "disabled"}>
            ${src ? `<img src="${src}" alt="">` : `<span class="tmBauLeer"></span>`}
            <b>${bname(bid)}</b>
            <span class="tmLiefert">${liefert(b)}</span>
            <span class="tmPreis">${gesperrt(b) ? "—" : fmt(totalCost(b))}${!gesperrt(b) && matTxt(b) ? `<small>${matTxt(b)}</small>` : ""}</span>
            ${grund ? `<span class="tmGrund">${grund}</span>` : ""}
          </button>`; }).join("") + `</div>`
        + `<div class="tmFuss">${kartellModus ? "Bezahlt wird bar." : "Ziegel und Beton gibt es an der Börse."}${lockNote}</div>`
      : `<div class="tmHinweis">${store.get().state?.mode === "renntag"
          ? "Deine Rolle baut hier nichts — Teile und Rohstoffe gehen über die Börse."
          : "Deine Industrie kann hier nichts bauen — handle stattdessen an der Börse."}</div>`);
  tm.querySelector(".tmZu").addEventListener("click", () => { tm.style.display = "none"; });
  tmPlatzieren(e);
  tm.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => {
    act("build", { x:t.x, y:t.y, btype: btn.dataset.b }); tm.style.display = "none"; }));
}
addEventListener("keydown", e => { if (e.key === "Escape") tm.style.display = "none"; });
/* Menü neben den Klickpunkt legen, aber immer ganz im Bild — gemessen nach
 * dem Befüllen, weil Gebäudekarte und Baumenü unterschiedlich groß sind. */
function tmPlatzieren(e) {
  const r = tm.getBoundingClientRect(), rand = 12;
  let x = e.clientX + 14, y = e.clientY - 20;
  if (x + r.width > innerWidth - rand) x = e.clientX - r.width - 14;
  x = Math.max(rand, Math.min(x, innerWidth - r.width - rand));
  y = Math.max(rand + 90, Math.min(y, innerHeight - r.height - 96));
  tm.style.left = x + "px"; tm.style.top = y + "px";
}

/* ---- Preistafel auf-/zuklappen ----
 * Der Zustand wird gemerkt: Wer die Tafel offen haben will, soll sie nicht
 * nach jedem Neuladen erneut aufziehen müssen. */
const tickerEl = document.getElementById("ticker");
const tickerBtn = document.getElementById("tickerToggle");
function tickerAufklappen(auf) {
  tickerEl.classList.toggle("auf", auf);
  tickerBtn.setAttribute("aria-expanded", String(auf));
  tickerBtn.title = auf ? "Preise einklappen" : "Alle Preise anzeigen";
  tickerBtn.textContent = auf ? "⌃" : "⌄";
  try { localStorage.setItem("cs_ticker_auf", auf ? "1" : "0"); } catch {}
}
tickerBtn.addEventListener("click", () => {
  SFX.spiel("klick");
  tickerAufklappen(!tickerEl.classList.contains("auf"));
});
try { if (localStorage.getItem("cs_ticker_auf") === "1") tickerAufklappen(true); } catch {}

/* ---- Sprung zu den eigenen Gebäuden ----
 * Die Karte hat 676 Kacheln, davon nur gut ein Viertel sofort bebaubar, und die
 * eigenen Betriebe liegen verstreut. Wer einmal weggescrollt ist, sucht sie
 * ohne Hilfe lange — bis hin zu dem Eindruck, sie seien gar nicht da.
 * Mehrfaches Drücken geht sie der Reihe nach durch. */
let findIdx = 0;
function zuMeinenGebaeuden() {
  const s = store.get(), st = s.state;
  if (!st || !s.myId) return;
  const meine = st.map.filter(t => t.owner === s.myId && t.btype);
  if (!meine.length) { toast(t("Du hast noch keine Gebäude gebaut.")); return; }
  const ziel = meine[findIdx++ % meine.length];
  /* Umkehrung von iso(): Bildmitte auf die Kachel legen. */
  cam.z = Math.max(cam.z, 1.2);
  cam.x = -(ziel.x - ziel.y) * TW / 2 * cam.z;
  cam.y = -(ziel.x + ziel.y) * TH / 2 * cam.z + innerHeight / 2 - 120;
  toast(`${bname(ziel.btype)} — ${findIdx % meine.length || meine.length}/${meine.length}`);
}
document.getElementById("findBtn").addEventListener("click", zuMeinenGebaeuden);

/* ---------- Bugreport ---------- */
const bugDialog = document.getElementById("bugDialog");
const bugStatus = document.getElementById("bugStatus");
document.getElementById("bugBtn").addEventListener("click", () => {
  bugDialog.hidden = false;
  bugStatus.textContent = "";
  document.getElementById("bugText").focus();
});
document.getElementById("bugAbbr").addEventListener("click", () => bugDialog.hidden = true);
bugDialog.addEventListener("click", e => { if (e.target === bugDialog) bugDialog.hidden = true; });
document.getElementById("bugSend").addEventListener("click", async () => {
  const text = document.getElementById("bugText").value.trim();
  if (!text) { bugStatus.textContent = "Bitte beschreibe den Fehler kurz."; return; }
  const knopf = document.getElementById("bugSend");
  knopf.disabled = true; bugStatus.textContent = "Sende …";
  let image = null;
  try {
    const datei = document.getElementById("bugFile").files[0];
    if (datei && datei.size < 6_000_000) {
      image = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(datei);
      });
    } else if (document.getElementById("bugShot").checked) {
      /* Screenshot der Spielkarte direkt vom Canvas — kein Browser-Dialog nötig. */
      image = cv.toDataURL("image/jpeg", .7);
    }
  } catch { image = null; }
  try {
    const name = store.get()?.state?.players?.[store.get()?.myId]?.name || "";
    const antwort = await fetch(api("/api/bugreport"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, image, name })
    });
    if (!antwort.ok) throw new Error();
    bugDialog.hidden = true;
    document.getElementById("bugText").value = "";
    document.getElementById("bugFile").value = "";
    toast("Danke! Dein Fehlerbericht wurde übermittelt.");
  } catch {
    bugStatus.textContent = "Senden fehlgeschlagen — bitte später erneut versuchen.";
  }
  knopf.disabled = false;
});
addEventListener("keydown", e => {
  if (e.key !== "f" && e.key !== "F") return;
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  zuMeinenGebaeuden();
});

/* ---- Dock & Panels ---- */
const DOCK = [["karte","Karte"],["plan","Planbüro"],["kartell","Kartell"],["lager","Lager"],["boerse","Börse"],["bonds","Finanzen"],["firma","Firma"],["netz","Stadtnetz"],["touristik","Touristik"],["motorsport","Motorsport"],["lexikon","Lexikon"],["chat","Chat"]];
const dock = document.getElementById("dock");
DOCK.forEach(([pid, label]) => { const b = document.createElement("button");
  b.className = "dockbtn"; b.dataset.p = pid; b.textContent = label;
  /* Das Planbüro gibt es nur im Planwirtschafts-Modus — render() blendet es ein. */
  if (pid === "plan") { b.id = "dockPlan"; b.style.display = "none"; }
  /* Dasselbe für das Kartell: nur in der Kartellwirtschaft. */
  if (pid === "kartell") { b.id = "dockKartell"; b.style.display = "none"; }
  /* Die Börse hat im Kartellmodus nichts verloren — dort läuft alles über
   * Hehler, Markthalle und Frachtdepot. render() blendet sie aus. */
  if (pid === "boerse") b.id = "dockBoerse";
  /* Motorsport erscheint erst mit dem ersten eigenen Rennstall — vorher wäre
   * es ein Knopf, hinter dem nichts steht. */
  if (pid === "motorsport") { b.id = "dockMotor"; b.style.display = "none"; }
  /* Touristik: erst mit eigenem Campingplatz oder Strandhotel (Etappe 6) */
  if (pid === "touristik") { b.id = "dockTour"; b.style.display = "none"; }
  /* Stadtnetz (Etappe 8): kein Panel, sondern ein Browserfenster — nur mit wachsender Stadt */
  if (pid === "netz") { b.id = "dockNetz"; b.style.display = "none"; b.addEventListener("click", () => netzOeffnen(null)); dock.append(b); return; }
  b.addEventListener("click", () => openPanel(pid)); dock.append(b); });
/* stumm=true nur für den Aufruf beim Seitenaufbau: dort gibt es weder eine
 * Nutzergeste noch schon ein SFX-Modul (das entsteht erst weiter unten). */
/* Welche Panels der Spieler schon geoeffnet hat. Das Einsteiger-Tutorial
 * fuehrt auch durch Dinge, die man nicht "tut", sondern liest — Kursticker,
 * Nachrichten, Lexikon. Fuer die ist das Oeffnen die Handlung. */
const TUT_GESEHEN = new Set();
function openPanel(pid, stumm = false) {
  if (pid === "boerse" && store.get()?.state?.mode === "kartell") {
    toast("Im Kartell gibt es keine Börse — gehandelt wird über Hehler, Markthalle und Frachtdepot.");
    return;
  }
  /* Im Sandkasten sind Warenbörse und Stadtbank Websites im Stadtnetz */
  if (pid === "boerse" && store.get()?.state?.stadt) return netzOeffnen("boerse");
  if (pid === "bank" && store.get()?.state?.stadt) return netzOeffnen("bank");
  if (pid === "bonds" && store.get()?.state?.stadt) return netzOeffnen("anleihen");
  TUT_GESEHEN.add(pid);
  if (!stumm) SFX.spiel("klick");
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("open"));
  document.querySelectorAll(".dockbtn").forEach(b => b.classList.toggle("on", b.dataset.p === pid));
  if (pid !== "karte") document.getElementById("p-"+pid)?.classList.add("open");
  render(store.get());
}
document.querySelectorAll("[data-close]").forEach(x => x.addEventListener("click", () => {
  SFX.spiel("klick");
  x.closest(".panel").classList.remove("open");
  document.querySelectorAll(".dockbtn").forEach(b => b.classList.toggle("on", b.dataset.p === "karte")); }));
let pendingMerge = null;   // Firma, für die gerade die Fusions-Rückfrage offen ist
/* Stückzahl je Angebot, die der Spieler gerade eingetippt hat (Teilkauf) */
const shMenge = {};
let shKursSel = 0;          // Kurs je Aktie der im Verkaufsformular gewählten Firma
document.addEventListener("input", e => {
  const n = e.target.closest?.("[data-shn]");
  if (n) shMenge[n.dataset.shn] = Math.max(1, Math.floor(+n.value) || 1);
});
/* Eingabefeld + Kaufen-Knopf für ein Angebot; Stückzahl bis zur Angebotsgröße */
const shKaufZeile = l => {
  const v = Math.min(l.count, shMenge[l.id] ?? 1);
  return `<span class="shKauf"><input type="number" class="shN" data-shn="${l.id}" min="1" max="${l.count}" step="1" value="${v}" title="Aktien aus diesem Angebot (1–${l.count})">
    <button class="buyb" data-shbuy="${l.id}">Kaufen</button></span>`;
};
openPanel("karte", true);

function initSelects() {
  const goodOpts = Object.entries(GOODS()).map(([k]) => `<option value="${k}">${gname(k)}</option>`).join("");
  /* Getroffene Auswahl über den Neuaufbau retten. initSelects() läuft nicht nur
   * beim Beitritt, sondern über enterGame() bei JEDEM Wiederverbinden — ein
   * kurzer WLAN-Aussetzer setzte den Börsenfilter bisher stillschweigend auf
   * "Alle Waren" zurück und warf einen damit aus dem Kursverlauf, den man
   * gerade beobachtet hat. */
  for (const [id, opts] of [["oGood", goodOpts], ["cGood", goodOpts],
                            ["exFilter", `<option value="">${t("Alle Waren")}</option>` + goodOpts]]) {
    const el = document.getElementById(id), vorher = el.value;
    el.innerHTML = opts;
    if ([...el.options].some(o => o.value === vorher)) el.value = vorher;
  }
  const roomsEl = document.getElementById("rooms");
  roomsEl.innerHTML = "";
  (store.get().meta.rooms).forEach(r => { const b = document.createElement("button");
    b.className = "room" + (r === store.get().room ? " on" : ""); b.textContent = r;
    b.addEventListener("click", () => { store.set({ room: r });
      roomsEl.querySelectorAll(".room").forEach(x => x.classList.toggle("on", x === b)); });
    roomsEl.append(b); });
}

/* ---- Aktionen (Orders, Bonds, Chat, Verträge) ---- */
document.getElementById("exFilter").addEventListener("change", () => render(store.get()));
document.getElementById("oPlace").addEventListener("click", () => act("placeOrder", {
  side: document.getElementById("oSide").value, good: document.getElementById("oGood").value,
  qty: document.getElementById("oQty").value, price: document.getElementById("oPrice").value }));
document.getElementById("bIssue").addEventListener("click", () => act("issueBond", {
  principal: document.getElementById("bPrin").value,
  rate: document.getElementById("bRate").value / 100, term: document.getElementById("bTerm").value }));
/* Alle Knöpfe der Bank laufen über EINEN delegierten Handler am Panel statt über
 * Listener, die render() bei jedem State-Update neu an frische DOM-Knoten hängt.
 * Sonst kann ein Zustandsupdate zwischen Maus-runter und Maus-hoch den Knopf
 * austauschen — dann entsteht gar kein click-Event und der Klick verpufft. */
let BANK_REITER = "markt";
function bankReiterZeigen() {
  document.querySelectorAll("#p-bank [data-breiter]").forEach(b => b.classList.toggle("on", b.dataset.breiter === BANK_REITER));
  document.querySelectorAll("#p-bank [data-bseite]").forEach(sx => sx.hidden = sx.dataset.bseite !== BANK_REITER);
}
document.getElementById("p-bank").addEventListener("click", e => {
  const reiter = e.target.closest("[data-breiter]");
  if (reiter) { BANK_REITER = reiter.dataset.breiter; bankReiterZeigen(); SFX.spiel("klick"); return; }
  const wr = e.target.closest("[data-wrichtung]");
  if (wr) { W_RICHTUNG = wr.dataset.wrichtung; kurswettenRendern(); SFX.spiel("klick"); return; }
  const wa = e.target.closest("[data-wanteil]");
  if (wa) { const max = store.get().me?.wettMax || 0;
    document.getElementById("wEinsatz").value = Math.max(100, Math.floor(max * +wa.dataset.wanteil / 100) * 100); kurswettenRendern(); return; }
  const wf = e.target.closest("[data-wfirma]");
  if (wf) { document.getElementById("wFirma").value = wf.dataset.wfirma; kurswettenRendern(); SFX.spiel("klick"); return; }
  const zuHandeln = e.target.closest("[data-zu-handeln]");
  if (zuHandeln) { BANK_REITER = "handeln"; bankReiterZeigen();
    const sel = document.getElementById("bidCompany"); if ([...sel.options].some(o => o.value === zuHandeln.dataset.zuHandeln)) sel.value = zuHandeln.dataset.zuHandeln;
    return; }
  const yes = e.target.closest("[data-merge-yes]");
  if (yes) { act("mergeCompany", { targetId: yes.dataset.mergeYes }); pendingMerge = null; render(store.get()); return; }
  if (e.target.closest("[data-merge-no]")) { pendingMerge = null; render(store.get()); return; }
  const ask = e.target.closest("[data-merge]");
  if (ask) { pendingMerge = ask.dataset.merge; render(store.get()); return; }
  const buy = e.target.closest("[data-shbuy]");
  if (buy) {
    const menge = document.querySelector(`[data-shn="${buy.dataset.shbuy}"]`);
    act("buyShares", { listingId: +buy.dataset.shbuy, count: menge ? Math.floor(+menge.value) || 1 : undefined });
    return;
  }
  const cancel = e.target.closest("[data-shcancel]");
  if (cancel) { act("cancelShareListing", { listingId: +cancel.dataset.shcancel }); return; }
  const bidOk = e.target.closest("[data-bidok]");
  if (bidOk) { act("acceptShareBid", { bidId: +bidOk.dataset.bidok }); return; }
  const bidNo = e.target.closest("[data-bidno]");
  if (bidNo) { act("declineShareBid", { bidId: +bidNo.dataset.bidno }); return; }
  const bidCancel = e.target.closest("[data-bidcancel]");
  if (bidCancel) { act("cancelShareBid", { bidId: +bidCancel.dataset.bidcancel }); return; }
});
/* ---------- Finanzamt-Panel ---------- */
/* ---------- Software-Panel ----------
 * Oben der Vergleich aller Shop-Systeme (so, wie auch die Bots rechnen),
 * darunter für Software-Firmen der Baukasten: Name, Farbe, Preise sofort,
 * neue Funktionen über eine neue Version. Eingaben leben in swEntwurf, damit
 * das sekündliche Neuzeichnen sie nicht verwirft. */
const swEntwurf = {};
const SW_BAEUME_NAME = (state, br) => state.swBaeume?.[br] ? `für ${state.swBaeume[br].name}` : "allgemein";
const swModulWahl = new Set();
const swDesignEntwurf = {};
/* Website-Baukasten: Optionen je Kategorie, Gesperrtes mit Mindestversion,
 * daneben eine Live-Vorschau mit Beispielwaren — so sieht jede Kunden-Website
 * aus, die mit diesem System läuft. */
function swDesignHtml(state, eigene) {
  const OPT = state.swDesign || {}, AB = state.swDesignAb || {};
  const v = Math.max(1, eigene.version || 0);
  const d = { ...(eigene.design || {}), ...swDesignEntwurf };
  const farbe = swEntwurf.farbe || eigene.farbe;
  const titel = { schrift: "Schrift", thema: "Thema", ecken: "Ecken", kopf: "Kopfzeile", karten: "Produktkarten", motiv: "Bezahlkarte", effekt: "Effekt" };
  const reihen = Object.entries(titel).map(([k, t]) => `<div class="swDesignReihe"><span>${t}</span><div class="swDesignWahl">
    ${Object.entries(OPT[k] || {}).map(([id, o]) => `<button type="button" data-swdes="${k}" data-wert="${id}" class="${d[k] === id ? "an" : ""}" ${o.ab > v ? "disabled" : ""}>${o.name}${o.ab > v ? `<em>🔒 v${o.ab}</em>` : ""}</button>`).join("")}
  </div></div>`).join("");
  const gesperrt = (k) => v < (AB[k] || 1);
  const texte = `<div class="swDesignTexte">
    <label>Slogan${gesperrt("slogan") ? ` 🔒 v${AB.slogan}` : ""}<input id="swdSlogan" maxlength="40" value="${escapeHtml(rohText(d.slogan || ""))}" placeholder="z. B. Einkaufen in Sekunden" ${gesperrt("slogan") ? "disabled" : ""}></label>
    <label>Banner${gesperrt("banner") ? ` 🔒 v${AB.banner}` : ""}<input id="swdBanner" maxlength="70" value="${escapeHtml(rohText(d.banner || ""))}" placeholder="z. B. Heute Lieferung gratis!" ${gesperrt("banner") ? "disabled" : ""}></label>
    <label>Zweitfarbe${gesperrt("akzent") ? ` 🔒 v${AB.akzent}` : ""}<input id="swdAkzent" type="color" value="${d.akzent || "#1f2937"}" ${gesperrt("akzent") ? "disabled" : ""}></label>
  </div>`;
  const ware = [["obst", 7.4, 128], ["honig", 15.2, 46]];
  const vorschau = `<div class="sfBrowser sfMini" ${sfDesignAttr(d, farbe)}>
    <div class="sfLeiste"><span class="sfPunkte"><i></i><i></i><i></i></span><span class="sfUrl">🔒 ${shopSlug(eigene.name)}.cs/deine-kunden</span></div>
    <header class="sfKopf"><div class="sfMarke"><span class="sfLogo" style="background:#16a34a">A</span><div><b>Apfelhof</b><small>Online-Shop · 2 Produkte</small></div></div>
      <span class="sfBadge">💳 Bezahlt mit <b>${escapeHtml(rohText(eigene.name))}</b> v${v}${d.slogan ? `<span class="sfSlogan">${escapeHtml(rohText(d.slogan))}</span>` : ""}</span></header>
    ${d.banner ? `<div class="sfBanner"><b>✦</b><span>${escapeHtml(rohText(d.banner))}</span></div>` : ""}
    <div class="sfInhalt"><div class="sfGrid">${ware.map(([g, pr, n]) => `<article class="sfProdukt">${eigene.module?.werbung ? `<span class="sfBand">Empfohlen</span>` : ""}
      <div class="sfBild"><span>${WAREN_ICON[g]}</span></div><h5>${gname(g)}</h5><div class="sfPreis"><b>${fp(pr)}</b><span>je Stück</span></div>
      <div class="sfInfo">${n} auf Lager</div><button type="button" class="sfKaufen" tabindex="-1">Kaufen</button></article>`).join("")}</div>
      <div class="sfKarte"><div class="sfKarteOben"><b>${escapeHtml(rohText(eigene.name))}</b><span class="sfChip"></span></div><div class="sfKarteNr">•••• •••• •••• 4821</div><div class="sfKarteUnten"><span>Kunde</span><span>08/29</span></div></div></div>
    <footer class="sfFuss">${logoHtml(eigene.ownerId, "sfFussLogo", farbe)}<span>Diese Website läuft mit <b>${escapeHtml(rohText(eigene.name))}</b> v${v} · entwickelt von <b>${escapeHtml(rohText(eigene.anbieter))}</b></span></footer>
  </div>`;
  const geaendert = Object.keys(swDesignEntwurf).length > 0;
  return `<div class="sec" style="margin-top:16px">Website-Design · so sehen alle Shops mit deinem System aus</div>
    <div class="note" style="margin:0 0 8px">Jede neue Version schaltet weitere Schriften, Themen und Effekte frei. Speichern kostet nichts.</div>
    <div class="swDesign">${reihen}${texte}${vorschau}
      <button class="buyb" id="swDesignSpeichern" ${geaendert ? "" : "disabled"}>${geaendert ? "Design übernehmen" : "Design ist aktuell"}</button></div>`;
}
/* Bürgerdepot: die Sparer der Stadt als Anleger (siehe depotTag im Server) */
function depotKarte(d) {
  if (!d) return "";
  const voll = d.deckel > 0 ? Math.min(100, d.wert / d.deckel * 100) : 0;
  const posten = [...(d.fonds || []).map(f => `${f.name}-Fonds ${fmt(f.wert)}`), ...(d.aktien || []).map(a => `${a.aktien} ${a.firma}`)];
  return `<div class="sec bTafelKopf"><span>Bürgerdepot</span><span class="meta">die Sparer der Stadt</span></div>
    <div class="bond depotKarte"><div style="min-width:0;flex:1">
      <div class="swZahlen">
        <div><b>${fmt(d.wert)}</b><span>Depotwert</span></div>
        <div><b>${fmt(d.kasse)}</b><span>noch anzulegen</span></div>
        <div><b>${d.appAnteil} %</b><span>über Börsen-Apps</span></div>
        <div><b>${d.konsumBoost ? "+" + String(d.konsumBoost).replace(".", ",") + " %" : "—"}</b><span>Konsum in Shops</span></div></div>
      <div class="swBalken" title="Obergrenze ${fmt(d.deckel)}"><i style="width:${voll.toFixed(1)}%"></i></div>
      <div class="meta" style="padding-top:4px">Je 1 $ Einkauf in den Online-Shops sparen die Bewohner ${Math.round(d.sparquote * 100)} ct. Ohne Börsen-App kommt nur ${Math.round(d.sparkasseAnteil * 100)} % davon über die Stadtsparkasse an die Börse. Angelegt wird einmal je Markttag — überwiegend in Fonds, der Rest in günstige Aktien mit guter Dividende. Bei Panik oder Überbewertung verkauft das Depot. Höchstens bis ${fmt(d.deckel)} (Balken).</div>
      ${posten.length ? `<div class="meta" style="padding-top:4px">Hält: ${posten.join(" · ")}</div>` : ""}
    </div>${(d.verlauf || []).length > 1 ? sparklineVon(d.verlauf, 52, 16) : ""}</div>`;
}
const boerseEntwurf = {};
/* Börsen-App: drittes Produkt einer Software-Firma (Vermittler). Über die
 * Apps legen die Sparer der Stadt an (Bürgerdepot); jeder Lizenznehmer bringt
 * die App unter seine Kunden und erhöht die Reichweite. */
function boerseAppHtml(state, me, eigene) {
  const cfg = state.boerseAppCfg || {}, STUFEN = cfg.stufen || [];
  const ba = (state.boerseApp || []).find(x => x.ownerId === eigene.ownerId);
  const kopf = `<div class="sec" style="margin-top:16px">Börsen-App · dein drittes Produkt</div>`;
  if ((eigene.version || 0) < (cfg.abSystem || 2))
    return kopf + `<div class="note">Ab Shop-System v${cfg.abSystem || 2} kannst du eine Börsen-App entwickeln. Über Börsen-Apps legen die Sparer der Stadt ihr Geld an — ohne App kommt nur die Hälfte über die Stadtsparkasse an die Börse. Du verdienst Provision auf alles, was über deine App läuft.</div>`;
  const e = { name: ba?.name ?? "", preis: ba?.preis ?? 900, ...boerseEntwurf };
  const stufeText = st => `${st.bewohner} Bewohner je Nutzer · ${String(st.provision).replace(".", ",")} % Provision`;
  const laeden = ba?.laeden || state.map.filter(t => t.owner === eigene.ownerId && t.btype === "onlinemarkt").map(t => ({ x: t.x, y: t.y, offen: false }));
  const offen = laeden.filter(l => l.offen);
  const naechste = STUFEN[(ba?.version || 0)];
  const dev = ba?.entwicklung;
  return kopf + `<div class="note" style="margin:0 0 8px">Die Sparer der Stadt legen ihr Geld über Börsen-Apps an. Je mehr Bewohner deine App erreicht, desto mehr läuft über dich — und du bekommst Provision darauf. Firmen kaufen eine Lizenz in <b>deinem eigenen Online-Shop</b> und bringen die App unter ihre Kunden: Das erhöht deine Reichweite, und sie bekommen die Hälfte der Provision, die über sie kommt.</div>
    ${ba ? `<div class="swZahlen">
      <div><b>${ba.version >= 1 ? "v" + ba.version : "—"}</b><span>Version</span></div>
      <div><b>${ba.verkauft}</b><span>Lizenzen verkauft</span></div>
      <div><b>${ba.reichweite || 0}</b><span>Reichweite (Bewohner)</span></div>
      <div><b style="color:var(--up)">${fmt(ba.einnahmen10 || 0)}</b><span>Provision 10 min</span></div></div>
      ${state.depot ? `<div class="note" style="margin:4px 0 8px">${state.depot.appAnteil} % der Sparer handeln über Börsen-Apps · Lizenzpreis ${fmt(ba.preis)}</div>` : ""}` : ""}
    ${ba?.version >= 1 && !offen.length ? `<div class="mpWarn">⚠ ${laeden.length ? "Dein Online-Marktplatz ist noch nicht offen — installiere ein Shop-System (z. B. dein eigenes)." : "Du hast keinen eigenen Online-Marktplatz. Ohne ihn kann niemand deine Börsen-App kaufen — bau einen im Zentrum und installiere dein System."}</div>` : ""}
    <div class="swForm">
      <label class="breit"><span>Name</span><input id="baName" maxlength="20" value="${escapeHtml(rohText(e.name))}" placeholder="z. B. TradeBot Pro"></label>
      <label><span>Lizenzpreis $</span><input id="baPreis" type="number" min="${cfg.preisMin ?? 100}" max="${cfg.preisMax ?? 6000}" step="50" value="${e.preis}"></label>
      <button class="buyb" id="baSpeichern">${ba ? "Übernehmen" : "Börsen-App anlegen"}</button>
    </div>
    ${ba ? (dev ? `<div class="swDev"><div class="swDevKopf"><span>${escapeHtml(rohText(ba.name))} v${dev.version} in Arbeit</span><b class="mono">${dev.ep} / ${dev.ziel} EP</b></div>
        <div class="swBalken"><i style="width:${Math.min(100, dev.ep / dev.ziel * 100).toFixed(1)}%"></i></div>
        <div class="note" style="margin:4px 0 0">Neu: ${stufeText(STUFEN[dev.version - 1])}${eigene.entwicklung ? " · teilt sich das Studio mit dem Shop-System" : ""}</div></div>`
      : naechste ? `<button class="tmHaupt" id="baEntwickeln"><span>${escapeHtml(rohText(ba.name))} v${(ba.version || 0) + 1} entwickeln</span><small>${naechste.ep} EP · ${stufeText(naechste)}${eigene.entwicklung ? " · teilt sich das Studio mit dem Shop-System" : ""}</small></button>`
      : `<div class="note">Voll ausgebaut: ${stufeText(STUFEN[STUFEN.length - 1])}.</div>`) : ""}`;
}
const paintEntwurf = {};
/* Malprogramm: das zweite Produkt einer Software-Firma, verkauft als Lizenz
 * im eigenen Online-Shop. */
function paintHtml(state, me, eigene) {
  const cfg = state.paintCfg || {}, STUFEN = cfg.stufen || [];
  const mp = (state.paint || []).find(x => x.ownerId === eigene.ownerId);
  const kopf = `<div class="sec" style="margin-top:16px">Malprogramm · dein zweites Produkt</div>`;
  if ((eigene.version || 0) < (cfg.abSystem || 2))
    return kopf + `<div class="note">Ab Shop-System v${cfg.abSystem || 2} kannst du ein Malprogramm entwickeln. Firmen kaufen eine Lizenz in deinem Online-Shop und malen damit ihr Logo — es erscheint im Shop, an der Börse und als Schild an ihren Gebäuden.</div>`;
  const e = { name: mp?.name ?? "", preis: mp?.preis ?? 900, ...paintEntwurf };
  const stufeText = st => `${st.groesse}×${st.groesse} Pixel · ${st.farben ? `${st.farben} Farben` : "freie Farben"} · ${st.werkzeuge.map(w => ({ stift: "Stift", radierer: "Radierer", fuellen: "Füllen", spiegeln: "Spiegeln" })[w]).join(", ")}`;
  const laeden = mp?.laeden || state.map.filter(t => t.owner === eigene.ownerId && t.btype === "onlinemarkt").map(t => ({ x: t.x, y: t.y, offen: false }));
  const offen = laeden.filter(l => l.offen);
  const naechste = STUFEN[(mp?.version || 0)];
  const dev = mp?.entwicklung;
  return kopf + `<div class="note" style="margin:0 0 8px">Firmen kaufen eine Lizenz in <b>deinem eigenen Online-Shop</b> und malen damit ihr Firmenlogo. Updates bekommen sie gratis — jede Version kann mehr.</div>
    ${mp ? `<div class="swZahlen">
      <div><b>${mp.version >= 1 ? "v" + mp.version : "—"}</b><span>Version</span></div>
      <div><b>${mp.verkauft}</b><span>Lizenzen verkauft</span></div>
      <div><b>${fmt(mp.preis)}</b><span>Lizenzpreis</span></div>
      <div><b style="color:var(--up)">${fmt(mp.einnahmen10 || 0)}</b><span>Einnahmen 10 min</span></div></div>` : ""}
    ${mp?.version >= 1 && !offen.length ? `<div class="mpWarn">⚠ ${laeden.length ? "Dein Online-Marktplatz ist noch nicht offen — installiere ein Shop-System (z. B. dein eigenes)." : "Du hast keinen eigenen Online-Marktplatz. Ohne ihn kann niemand dein Programm kaufen — bau einen im Zentrum und installiere dein System."}</div>` : ""}
    <div class="swForm">
      <label class="breit"><span>Name</span><input id="mpName" maxlength="16" value="${escapeHtml(rohText(e.name))}" placeholder="z. B. PixelPinsel"></label>
      <label><span>Lizenzpreis $</span><input id="mpPreis" type="number" min="${cfg.preisMin ?? 100}" max="${cfg.preisMax ?? 6000}" step="50" value="${e.preis}"></label>
      <button class="buyb" id="mpSpeichern">${mp ? "Übernehmen" : "Malprogramm anlegen"}</button>
    </div>
    ${mp ? (dev ? `<div class="swDev"><div class="swDevKopf"><span>${escapeHtml(rohText(mp.name))} v${dev.version} in Arbeit</span><b class="mono">${dev.ep} / ${dev.ziel} EP</b></div>
        <div class="swBalken"><i style="width:${Math.min(100, dev.ep / dev.ziel * 100).toFixed(1)}%"></i></div>
        <div class="note" style="margin:4px 0 0">Neu: ${stufeText(STUFEN[dev.version - 1])}${eigene.entwicklung ? " · wartet, bis das Shop-System fertig ist" : ""}</div></div>`
      : naechste ? `<button class="tmHaupt" id="mpEntwickeln"><span>${escapeHtml(rohText(mp.name))} v${(mp.version || 0) + 1} entwickeln</span><small>${naechste.ep} EP · ${stufeText(naechste)}${eigene.entwicklung ? " · startet nach dem Shop-System" : ""}</small></button>`
      : `<div class="note">Voll ausgebaut: ${stufeText(STUFEN[STUFEN.length - 1])}.</div>`) : ""}
    ${mp?.version >= 1 ? `<div class="mpZeile"><button class="mini" id="mpMalen">🎨 Eigenes Logo malen</button>${offen[0] ? `<button class="mini" data-shopauf="${offen[0].x},${offen[0].y}">🛒 Deinen Shop ansehen</button>` : ""}</div>` : ""}`;
}
/* ---- Touristik-Panel (Etappe 6): Gäste, Zimmerpreis, Sterne, Stadtfeste ---- */
const tourEntwurf = {};
const sterneHtml = (n, max = 5) => `<span class="tourSterne" title="${String(Math.round(n * 10) / 10).replace(".", ",")} ${t("Sterne")}">${[1, 2, 3, 4, 5].slice(0, max).map(i => `<i class="${n >= i - .25 ? "on" : n >= i - .75 ? "halb" : ""}">★</i>`).join("")}</span>`;
const tourQualiC = (cfg, s) => { const i = Math.max(0, Math.min(cfg.QUALI.length - 1, s - 1)), lo = Math.floor(i); return cfg.QUALI[lo] + ((cfg.QUALI[lo + 1] ?? cfg.QUALI[lo]) - cfg.QUALI[lo]) * (i - lo); };
function touristikRendern(state, me, myId) {
  const T = state.touristik, cfg = state.touristikCfg;
  const betriebe = (state.map || []).filter(x => x.owner === myId && (x.btype === "campingplatz" || x.btype === "strandhotel"));
  const knopf = document.getElementById("dockTour");
  if (knopf) knopf.style.display = T && betriebe.length ? "" : "none";
  const body = document.getElementById("tourbody");
  if (!body || !document.getElementById("p-touristik").classList.contains("open")) return;
  if (!T || !cfg) { body.innerHTML = `<div class="note">${t("Gäste kommen nur in eine wachsende Stadt (Sandkasten).")}</div>`; return; }
  const meine = T.firmen.find(f => f.id === myId), fest = T.fest, tick = state.tick;
  const festBanner = fest ? `<div class="tourFest">🎉 <b>${t(fest.name)}</b> ${t("von")} ${escapeHtml(rohText(fest.veranstalter))} · ${t("Restzeit")} ${Math.floor(fest.rest / 60)}:${String(fest.rest % 60).padStart(2, "0")} · +${Math.round(cfg.FESTE[fest.typ].gaeste * 100)} % ${t("Gäste")}</div>` : "";
  const stadt = `<div class="sec">${t("Gäste der Stadt")} <span class="meta">· ${t("je Minute")}</span></div>
    <div class="swZahlen">
      <div><b>${T.gaeste}</b><span>${t("kommen")}</span></div>
      <div><b style="color:var(--up)">${T.bedient}</b><span>${t("übernachten")}</span></div>
      <div><b>${T.woanders}</b><span>${t("zu teuer — fahren woanders hin")}</span></div>
      <div><b style="color:${T.abgewiesen ? "var(--down)" : "inherit"}">${T.abgewiesen}</b><span>${t("finden kein Zimmer")}</span></div></div>`;
  let eigen = "";
  if (betriebe.length) {
    const preis = tourEntwurf.preis ?? meine?.preis ?? cfg.PREIS_REF;
    const richt = Math.round(cfg.PREIS_REF * Math.sqrt(2 * tourQualiC(cfg, meine?.bewertung || 1)));
    const pause = T.pause?.[myId] || 0;
    const zeilen = betriebe.map(x => {
      const s = x.btype === "campingplatz" ? 1 : (x.sterne || cfg.START_STERNE), imBau = x.bauBis && tick < x.bauBis;
      const kosten = cfg.RENOVIEREN[s];
      const aktion = x.btype !== "strandhotel" ? `<span class="meta">${t("fest 1 Stern")}</span>`
        : s >= cfg.MAX_STERNE ? `<span class="meta">${t("Höchste Stufe")}</span>`
        : `<button class="mini" data-renov="${x.x},${x.y}" ${imBau || me.cash < kosten ? "disabled" : ""}>${t("Auf")} ${s + 1} ★ · ${fmt(kosten)}</button>`;
      return `<div class="swListeZeile"><span class="swName"><i style="background:${state.players?.[myId]?.color || "var(--accent)"}"></i><span><b>${bname(x.btype)}</b><small>${imBau ? t("im Bau") : `${t("Stufe")} ${x.level || 1}${s >= 3 ? ` · ${t("mit Frühstück")}` : ""}`}</small></span></span>
        ${sterneHtml(s)}<span></span>${aktion}</div>`;
    }).join("");
    const lager = cfg.FRUEH_WAREN.map(g => `${gname(g)} ${Math.floor(me.inv?.[g] || 0)}`).join(" · ");
    const festKnoepfe = Object.entries(cfg.FESTE).map(([k, f]) => {
      const gesperrt = !!fest || pause > 0 || me.cash < f.kosten || !meine?.zimmer;
      return `<button class="tourFestKnopf" data-fest="${k}" ${gesperrt ? "disabled" : ""}><b>${t(f.name)}</b><span>${fmt(f.kosten)} · ${f.dauer / 60} min</span>
        <small>+${Math.round(f.gaeste * 100)} % ${t("Gäste")} · +${Math.round(f.zufr * 100)} % ${t("Zufriedenheit")}${f.laeden ? ` · +${Math.round(f.laeden * 100)} % ${t("in den Läden")}` : ""}</small></button>`;
    }).join("");
    eigen = `<div class="sec" style="margin-top:16px">${t("Deine Touristik")}</div>
      <button type="button" class="tmHaupt" data-hotelauf="${myId}" style="margin:0 0 12px"><span>🌐 ${t("Deine Buchungsseite öffnen")}</span><small>${t("Häuser, Preis, Renovieren und Feste wie auf einer Website")}</small></button>
      <div class="swZahlen">
        <div><b>${meine?.gaeste ?? 0}</b><span>${t("Gäste je Minute")}</span></div>
        <div><b>${sterneHtml(meine?.bewertung || 0)}</b><span>${t("Bewertung")} ${String(meine?.bewertung ?? 0).replace(".", ",")}</span></div>
        <div><b>${meine?.zimmer ?? 0}</b><span>${t("Zimmer je Minute")} · ${t("Lager")} ${Math.floor(me.inv?.uebernachtung || 0)}</span></div>
        <div><b style="color:var(--up)">${fmt(meine?.einnahmen10 || 0)}</b><span>${t("Einnahmen 10 min")}</span></div></div>
      ${meine?.abgewiesen ? `<div class="mpWarn">⚠ ${meine.abgewiesen} ${t("Gäste wollten zu dir, aber dein Lager war leer. Mehr Übernachtungen produzieren — oder den Preis anheben.")}</div>` : ""}
      ${meine && meine.fruehOk < .95 && meine.fruehSoll ? `<div class="mpWarn">⚠ ${t("Frühstück fehlt")} (${Math.round(meine.fruehOk * 100)} %): ${t("Die Sterne über 2 zählen nur anteilig. Kauf Obst, Honig, Saft oder Gebäck an der Börse.")}</div>` : ""}
      <div class="swForm">
        <label><span>${t("Zimmerpreis $ je Gast")}</span><input id="tourPreis" type="number" min="${cfg.PREIS_MIN}" max="${cfg.PREIS_MAX}" step="1" value="${preis}"></label>
        <button class="buyb" id="tourPreisSpeichern" style="align-self:end">${t("Übernehmen")}</button>
      </div>
      <div class="note" style="margin:-4px 0 10px">${t("Gäste wählen nach Bewertung und Preis. Bei deiner Bewertung bringt etwa")} <b>${fmt(richt)}</b> ${t("am meisten ein, solange genug Zimmer da sind. Zu teuer: Gäste fahren woanders hin.")}</div>
      <div class="sec">${t("Deine Betriebe")} <span class="meta">· ${t("Renovieren bringt Sterne, ab 3 Sternen gibt es Frühstück")}</span></div>
      <div class="swListe">${zeilen}</div>
      ${meine?.fruehSoll ? `<div class="note" style="margin:6px 0 0">${t("Frühstück je Minute")}: ${t("Lebensmittel für")} ${fmt(meine.fruehSoll)} · ${t("im Lager")}: ${lager}</div>` : ""}
      <div class="sec" style="margin-top:16px">${t("Stadtfest veranstalten")} <span class="meta">· ${fest ? t("gerade läuft eins") : pause > 0 ? `${t("nächstes in")} ${Math.ceil(pause / 60)} min` : t("lockt Gäste für alle Hotels, du bekommst mehr davon")}</span></div>
      <div class="tourFeste">${festKnoepfe}</div>`;
  } else eigen = `<div class="note" style="margin-top:12px">${t("Gäste übernachten bei Touristik-Firmen auf Campingplätzen und in Strandhotels.")}</div>`;
  const rang = T.firmen.filter(f => f.zimmer > 0).sort((a, b) => b.gaeste - a.gaeste);
  const liste = `<div class="sec" style="margin-top:16px">${t("Hotels der Stadt")}</div>
    ${rang.length ? `<div class="swListe">${rang.map(f => `<button type="button" class="swListeZeile tourHotel${f.id === myId ? " meins" : ""}" data-hotelauf="${f.id}" title="${t("Buchungsseite öffnen")}">
      <span class="swName"><i style="background:${f.farbe}"></i><span><b>${escapeHtml(rohText(f.name))}</b><small>${f.zimmer} ${t("Zimmer je Minute")} · 🌐 ${t("Buchungsseite")}</small></span></span>
      ${sterneHtml(f.bewertung)}<span class="mono">${fmt(f.preis)}</span><span class="mono">${f.gaeste} ${t("Gäste")}</span></button>`).join("")}</div>`
      : `<div class="note">${t("Noch kein Hotel fertig.")}</div>`}`;
  const html = festBanner + stadt + eigen + liste;
  if (body._sig !== html) { body._sig = html; body.innerHTML = html; }
}
document.getElementById("p-touristik").addEventListener("input", e => { if (e.target.id === "tourPreis") tourEntwurf.preis = e.target.value; });
document.getElementById("p-touristik").addEventListener("click", e => {
  if (e.target.closest("#tourPreisSpeichern")) return socket.emit("zimmerpreis", { preis: +document.getElementById("tourPreis")?.value }, r => {
    if (r?.error) return toast(r.error, true);
    delete tourEntwurf.preis; toast(`${t("Zimmerpreis")}: ${fmt(r.preis)}`); render(store.get());
  });
  const rv = e.target.closest("[data-renov]");
  if (rv) { const [x, y] = rv.dataset.renov.split(",").map(Number); return socket.emit("renovieren", { x, y }, r => { if (r?.error) return toast(r.error, true); toast(`${t("Renoviert")}: ${r.sterne} ★`); render(store.get()); }); }
  const ha = e.target.closest("[data-hotelauf]");
  if (ha) return hotelOeffnen(ha.dataset.hotelauf);
  const fe = e.target.closest("[data-fest]");
  if (fe) return socket.emit("festStarten", { typ: fe.dataset.fest }, r => { if (r?.error) return toast(r.error, true); render(store.get()); });
});
/* ---- Buchungsseite einer Touristik-Firma: wie die Shop-Seiten ein Browserfenster ----
 * Jede Firma mit Campingplatz oder Strandhotel hat eine Seite: ihre Häuser als
 * Karten, Zimmerpreis, Gästebewertungen. Auf der eigenen Seite stellt man Preis,
 * Renovierung und Stadtfeste direkt ein. Geöffnet aus dem Touristik-Panel und
 * über die Gebäudekarte. */
const HOTEL = { offen: false, pid: null, sig: {} };
const HOTEL_ICON = { campingplatz: "🏕️", strandhotel: "🏖️" };
const HOTEL_GAESTE = ["Lena aus Bergstadt", "Familie Okafor", "Jonas, 34", "Mira & Tom", "Herr Brandt", "Aylin", "Reisegruppe Nord", "Pia mit Hund", "Kenji", "Oma Hilde"];
function hotelOeffnen(pid) {
  Object.assign(HOTEL, { offen: true, pid, sig: {} });
  const el = document.getElementById("hotelFenster");
  el.hidden = false;
  el.innerHTML = `<div class="sfBrowser hfBrowser" role="dialog" aria-label="${t("Buchungsseite")}">
    <div class="sfLeiste"><span class="sfPunkte"><i></i><i></i><i></i></span>
      <span class="sfUrl"></span><button type="button" class="sfZu" data-hfzu aria-label="${t("Schließen")}">✕</button></div>
    <header class="sfKopf"></header>
    <div class="sfBanner" hidden></div>
    <div class="sfHinweis" hidden></div>
    <div class="sfInhalt"><div class="hfHaupt"></div>
      <aside class="sfFeed"><h4><span class="sfLive"></span>${t("Gästebewertungen")}</h4><ul class="hfBewertungen"></ul></aside></div>
    <footer class="sfFuss"></footer>
  </div>`;
  SFX.spiel("klick");
  hotelZeichnen();
}
function hotelSchliessen() {
  HOTEL.offen = false;
  const el = document.getElementById("hotelFenster");
  el.hidden = true; el.innerHTML = "";
}
const hotelSetze = (sel, html, key) => {
  if (HOTEL.sig[key] === html) return;
  HOTEL.sig[key] = html;
  const el = document.querySelector("#hotelFenster " + sel); if (el) el.innerHTML = html;
};
/* Drei Bewertungen, abgeleitet aus Lage, Preis und Frühstück; sie wechseln jede Spielminute */
function hotelBewertungen(f, cfg, fest, richt, nurCamping) {
  const pool = [];
  if (f.abgewiesen > 0) pool.push([1, "Ausgebucht — wir mussten woanders schlafen."]);
  if (f.fruehSoll && f.fruehOk < .95) pool.push([2, "Frühstück? Fehlanzeige. Für so viele Sterne enttäuschend."]);
  if (f.preis > richt * 1.2) pool.push([3, "Schön, aber für das Gebotene ganz schön teuer."]);
  if (f.preis < richt * .8) pool.push([5, "Unschlagbarer Preis, wir kommen wieder!"]);
  if (fest) pool.push([5, "Wegen des Stadtfests hier — tolle Stimmung in der Stadt!"]);
  if (f.bewertung >= 4) pool.push([5, "Traumhafter Blick aufs Meer, das Personal war super."], [5, "Das Frühstücksbuffet allein ist die Reise wert."]);
  else if (f.bewertung >= 3) pool.push([4, "Sauber, freundlich, gutes Frühstück."], [4, "Gerne wieder, nur der Pool war voll."]);
  else if (nurCamping) pool.push([4, "Zelten direkt im Grünen, einfach aber herzlich."], [3, "Die Duschen könnten neuer sein."]);
  else pool.push([3, "Ordentlich für eine Nacht."], [4, "Zentral gelegen, nette Leute."], [3, "Etwas in die Jahre gekommen."]);
  const seed = Math.floor((store.get().state.tick || 0) / 60) + rohText(f.name).length;
  const out = [];
  for (let i = 0; i < Math.min(3, pool.length); i++) out.push([...pool[(seed + i) % pool.length], HOTEL_GAESTE[(seed * 3 + i * 7) % HOTEL_GAESTE.length]]);
  return out;
}
function hotelZeichnen() {
  const { state, me, myId } = store.get();
  const T = state?.touristik, cfg = state?.touristikCfg;
  const f = T?.firmen.find(x => x.id === HOTEL.pid), owner = state?.players?.[HOTEL.pid];
  if (!T || !cfg || !owner) return hotelSchliessen();
  const fenster = document.getElementById("hotelFenster"), meins = HOTEL.pid === myId, fest = T.fest, tick = state.tick;
  const farbe = owner.color || "#0ea5e9";
  fenster.querySelector(".sfBrowser").style.setProperty("--sys", farbe);
  const haeuser = state.map.filter(x => x.owner === HOTEL.pid && HOTEL_ICON[x.btype]);
  const richt = Math.round(cfg.PREIS_REF * Math.sqrt(2 * tourQualiC(cfg, f?.bewertung || 1)));
  const schnitt = T.firmen.filter(x => x.zimmer > 0);
  const stadtPreis = schnitt.length ? schnitt.reduce((a, x) => a + x.preis, 0) / schnitt.length : cfg.PREIS_REF;
  hotelSetze(".sfUrl", `🔒 buchen.cs/${shopSlug(owner.name || "hotel")}`, "url");
  hotelSetze(".sfKopf", `<div class="sfMarke">${logoHtml(HOTEL.pid, "sfLogo", farbe)}
      <div><b>${escapeHtml(rohText(owner.name))}</b><small>${t("Hotels & Camping")} · ${haeuser.length} ${haeuser.length === 1 ? t("Haus") : t("Häuser")}${f?.zimmer ? ` · ${f.zimmer} ${t("Zimmer je Minute")}` : ""}</small></div></div>
    <span class="sfBadge">${sterneHtml(f?.bewertung || 0)} ${String(f?.bewertung ?? 0).replace(".", ",")} · ${t("ab")} <b>${fmt(f?.preis ?? cfg.PREIS_REF)}</b> ${t("je Nacht")}</span>`, "kopf" + (logoBild(HOTEL.pid) || "").length);
  const banner = fenster.querySelector(".sfBanner");
  banner.hidden = !fest;
  hotelSetze(".sfBanner", fest ? `<b>🎉</b><span>${t(fest.name)} ${t("in der Stadt")} — ${t("Restzeit")} ${Math.floor(fest.rest / 60)}:${String(fest.rest % 60).padStart(2, "0")} · ${fest.ownerId === HOTEL.pid ? t("veranstaltet von uns!") : `${t("veranstaltet von")} ${escapeHtml(rohText(fest.veranstalter))}`}</span>` : "", "banner");
  fenster.querySelector(".sfHinweis").hidden = !meins;
  hotelSetze(".sfHinweis", t("Deine Buchungsseite: So sehen Gäste und Mitspieler deine Häuser. Preis, Renovierung und Feste stellst du hier direkt ein."), "hinweis");
  const karten = haeuser.map(x => {
    const s = x.btype === "campingplatz" ? 1 : (x.sterne || cfg.START_STERNE), imBau = x.bauBis && tick < x.bauBis;
    const bt = BTYPES()[x.btype], zimmer = Math.round((bt.proc ? bt.proc.rate : bt.rate) * (1 + 0.3 * ((x.level || 1) - 1)) * 60);
    const kosten = cfg.RENOVIEREN[s], bild = spriteUrl(x.btype, x.x, x.y);
    const aktion = meins && x.btype === "strandhotel" && s < cfg.MAX_STERNE
      ? `<button type="button" class="sfKaufen" data-hfrenov="${x.x},${x.y}" ${imBau || me.cash < kosten ? "disabled" : ""}>${t("Auf")} ${s + 1} ★ ${t("renovieren")} · ${fmt(kosten)}</button>`
      : meins ? `<div class="sfEigen">${x.btype === "campingplatz" ? t("Campingplatz · fest 1 Stern") : t("Höchste Stufe erreicht")}</div>` : "";
    return `<article class="sfProdukt">
      ${imBau ? `<span class="sfBand grau">${t("im Bau")}</span>` : s >= 3 ? `<span class="sfBand">☕ ${t("Frühstück inklusive")}</span>` : ""}
      <div class="sfBild">${bild ? `<img src="${bild}" alt="" class="hfBild">` : `<span>${HOTEL_ICON[x.btype]}</span>`}</div>
      <h5>${bname(x.btype)}</h5>
      <div class="sfSterne">${"★".repeat(s)}${"☆".repeat(5 - s)}<em>${s} ${s === 1 ? t("Stern") : t("Sterne")}</em></div>
      <div class="sfPreis"><b>${fmt(f?.preis ?? cfg.PREIS_REF)}</b><span>${t("je Nacht")} · ${t("Stadt")} Ø ${fmt(stadtPreis)}</span></div>
      <div class="sfInfo">🛏️ ${zimmer} ${t("Zimmer je Minute")} · ${t("Stufe")} ${x.level || 1}${x.btype === "strandhotel" ? " · 🌊 " + t("Küste") : " · 🌳 " + t("im Grünen")}</div>
      <div class="sfKauf">${aktion}<button type="button" class="hfKarte" data-hfkarte="${x.x},${x.y}">📍 ${t("Auf der Karte zeigen")}</button></div>
    </article>`;
  }).join("");
  const zahlen = `<div class="hfZahlen">
      <div><b>${f?.gaeste ?? 0}</b><span>${t("Gäste diese Minute")}</span></div>
      <div><b>${f?.abgewiesen ?? 0}</b><span>${t("ohne Zimmer")}</span></div>
      <div><b>${fmt(f?.einnahmen10 || 0)}</b><span>${t("Einnahmen 10 min")}</span></div>
      <div><b>${fmt(f?.gesamt || 0)}</b><span>${t("seit Rundenbeginn")}</span></div></div>`;
  let verwalten = "";
  if (meins) {
    const pause = T.pause?.[myId] || 0;
    const preis = tourEntwurf.preis ?? f?.preis ?? cfg.PREIS_REF;
    verwalten = `<div class="hfVerwalten">
      <div class="hfPreis"><label><span>${t("Zimmerpreis je Nacht")}</span>
        <span class="sfMenge"><button type="button" data-hfpm="-5">−</button><input type="number" id="hfPreis" min="${cfg.PREIS_MIN}" max="${cfg.PREIS_MAX}" step="1" value="${preis}"><button type="button" data-hfpm="5">+</button></span></label>
        <button type="button" class="sfKaufen" data-hfpreis>${t("Preis übernehmen")}</button>
        <small>${t("Richtwert bei deiner Bewertung")}: <b>${fmt(richt)}</b> · ${t("Stadt")} Ø ${fmt(stadtPreis)}</small></div>
      <h4 class="hfTitel">🎪 ${t("Stadtfest buchen")} <small>${fest ? t("gerade läuft eins") : pause > 0 ? `${t("nächstes in")} ${Math.ceil(pause / 60)} min` : t("lockt Gäste für alle Hotels, du bekommst mehr davon")}</small></h4>
      <div class="sfGrid hfFeste">${Object.entries(cfg.FESTE).map(([k, fd]) => `<article class="sfProdukt">
        <div class="sfBild"><span>${{ strandfest: "🏐", konzert: "🎸", festival: "🎡" }[k] || "🎉"}</span></div>
        <h5>${t(fd.name)}</h5>
        <div class="sfPreis"><b>${fmt(fd.kosten)}</b><span>${fd.dauer / 60} ${t("Minuten")}</span></div>
        <div class="sfInfo">+${Math.round(fd.gaeste * 100)} % ${t("Gäste")} · +${Math.round(fd.zufr * 100)} % ${t("Zufriedenheit")}${fd.laeden ? ` · +${Math.round(fd.laeden * 100)} % ${t("in den Läden")}` : ""}</div>
        <div class="sfKauf"><button type="button" class="sfKaufen" data-hffest="${k}" ${fest || pause > 0 || me.cash < fd.kosten || !f?.zimmer ? "disabled" : ""}>${t("Buchen")} · ${fmt(fd.kosten)}</button></div>
      </article>`).join("")}</div></div>`;
  }
  hotelSetze(".hfHaupt", zahlen + `<div class="sfGrid">${karten || `<div class="sfLeer">${t("Noch kein Haus fertig.")}</div>`}</div>` + verwalten, "haupt");
  const bew = f ? hotelBewertungen(f, cfg, fest, richt, haeuser.every(x => x.btype === "campingplatz")) : [];
  hotelSetze(".hfBewertungen", bew.map(([n, text, wer]) => `<li><span class="sfFeedIcon">${n >= 4 ? "😊" : n === 3 ? "🙂" : "😕"}</span>
      <span><b class="hfSterneKlein">${"★".repeat(n)}${"☆".repeat(5 - n)}</b><small>„${t(text)}“ — ${wer}</small></span><span></span></li>`).join("")
    || `<li class="sfLeerFeed">${t("Noch keine Gäste.")}</li>`, "bew");
  hotelSetze(".sfFuss", `<span class="sfFussLogo">🏨</span><span>${t("Gebucht über das Stadtportal")} · ${T.gaeste} ${t("Gäste kommen gerade je Minute in die Stadt")}</span>`, "fuss");
}
document.getElementById("hotelFenster").addEventListener("input", e => { if (e.target.id === "hfPreis") tourEntwurf.preis = e.target.value; });
document.getElementById("hotelFenster").addEventListener("click", e => {
  if (e.target.closest("[data-hfzu]") || e.target.id === "hotelFenster") return hotelSchliessen();
  const pm = e.target.closest("[data-hfpm]");
  if (pm) { const inp = document.getElementById("hfPreis"); inp.value = Math.max(+inp.min, Math.min(+inp.max, (+inp.value || 0) + +pm.dataset.hfpm)); tourEntwurf.preis = inp.value; return; }
  if (e.target.closest("[data-hfpreis]")) return socket.emit("zimmerpreis", { preis: +document.getElementById("hfPreis")?.value }, r => {
    if (r?.error) return toast(r.error, true);
    delete tourEntwurf.preis; toast(`${t("Zimmerpreis")}: ${fmt(r.preis)}`); render(store.get());
  });
  const rv = e.target.closest("[data-hfrenov]");
  if (rv) { const [x, y] = rv.dataset.hfrenov.split(",").map(Number); return socket.emit("renovieren", { x, y }, r => { if (r?.error) return toast(r.error, true); toast(`${t("Renoviert")}: ${r.sterne} ★`); render(store.get()); }); }
  const fe = e.target.closest("[data-hffest]");
  if (fe) return socket.emit("festStarten", { typ: fe.dataset.hffest }, r => { if (r?.error) return toast(r.error, true); render(store.get()); });
  const ka = e.target.closest("[data-hfkarte]");
  if (ka) {
    const [x, y] = ka.dataset.hfkarte.split(",").map(Number);
    hotelSchliessen(); openPanel("karte");
    cam.z = Math.max(cam.z, 1.2);
    cam.x = -(x - y) * TW / 2 * cam.z;
    cam.y = -(x + y) * TH / 2 * cam.z + innerHeight / 2 - 120;
  }
});
/* ---- Statusseite einer Software-Firma (Etappe 7): Rechenzentren, Hosting, Website-Baukasten ----
 * Ein Browserfenster wie Shop- und Buchungsseite, mit drei Reitern. Besucher
 * installieren Shop-System und Steuerung direkt und bestellen Websites; der
 * Inhaber baut aus, stellt Preise ein und verteilt seine Plätze. */
const RZW = { offen: false, pid: null, reiter: "status", modul: "grund", sig: {} };
const rzLvl = l => 1 + 0.3 * ((l || 1) - 1);
function rzOeffnen(pid, reiter) {
  TUT_GESEHEN.add("rz");
  Object.assign(RZW, { offen: true, pid, reiter: reiter || "status", sig: {} });
  const el = document.getElementById("rzFenster");
  el.hidden = false;
  el.innerHTML = `<div class="sfBrowser hfBrowser rzBrowser" role="dialog" aria-label="${t("Statusseite")}">
    <div class="sfLeiste"><span class="sfPunkte"><i></i><i></i><i></i></span>
      <span class="sfUrl"></span><button type="button" class="sfZu" data-rzzu aria-label="${t("Schließen")}">✕</button></div>
    <header class="sfKopf"></header>
    <nav class="rzReiter"></nav>
    <div class="sfHinweis" hidden></div>
    <div class="rzWarn" hidden></div>
    <div class="rzInhalt"></div>
    <footer class="sfFuss"></footer>
  </div>`;
  SFX.spiel("klick");
  rzZeichnen();
}
function rzSchliessen() {
  RZW.offen = false;
  const el = document.getElementById("rzFenster");
  el.hidden = true; el.innerHTML = "";
}
const rzSetze = (sel, html, key) => {
  if (RZW.sig[key] === html) return;
  RZW.sig[key] = html;
  const el = document.querySelector("#rzFenster " + sel); if (el) el.innerHTML = html;
};
function rzZeichnen() {
  const { state, me, myId } = store.get();
  const owner = state?.players?.[RZW.pid];
  if (!state?.stadt || !owner) return rzSchliessen();
  const fenster = document.getElementById("rzFenster"), meins = RZW.pid === myId, tick = state.tick;
  const sys = (state.software || []).find(x => x.ownerId === RZW.pid && !x.portal);
  const app = (state.buergerApp || []).find(x => x.ownerId === RZW.pid);
  const web = (state.website || []).find(x => x.ownerId === RZW.pid), wcfg = state.websiteCfg;
  const rz = state.rechenzentren?.firmen?.[RZW.pid] || { uptime: [], verteilung: state.rzVerteilungStd || { shops: 50, apps: 30, web: 20 } };
  const B = BTYPES(), farbe = sys?.farbe || owner.color || "#1d4ed8";
  fenster.querySelector(".sfBrowser").style.setProperty("--sys", farbe);
  const racks = state.map.filter(x => x.owner === RZW.pid && B[x.btype]?.rz);
  const up = rz.uptime || [], upQuote = up.length ? Math.round(up.reduce((a, b) => a + b, 0) / up.length * 100) : 100;
  const belegt = { shops: sys?.kunden || 0, apps: app?.nutzer || 0, web: web?.kunden || 0 };
  const kap = { shops: sys?.plaetze || 0, apps: app?.kapazitaet || 0, web: web?.plaetze || 0 };
  const frei = Math.max(0, kap.shops - belegt.shops) + Math.max(0, kap.web - belegt.web);
  rzSetze(".sfUrl", `🔒 status.cs/${shopSlug(owner.name || "rz")}${RZW.reiter === "status" ? "" : RZW.reiter === "hosting" ? "/hosting" : "/websites"}`, "url");
  rzSetze(".sfKopf", `<div class="sfMarke">${logoHtml(RZW.pid, "sfLogo", farbe)}
      <div><b>${escapeHtml(rohText(owner.name))} ${t("Rechenzentren")}</b><small>${t("Hosting für Shops, Apps und Websites")}${sys?.version ? ` · ${escapeHtml(rohText(sys.name))} v${sys.version}` : ""}</small></div></div>
    <span class="rzBadges"><span class="sfBadge">${upQuote} % ${t("online")} · ${up.length || 0} min</span><span class="sfBadge">${frei} ${t("Plätze frei")}</span></span>`, "kopf" + (logoBild(RZW.pid) || "").length);
  rzSetze(".rzReiter", [["status", "Status"], ["hosting", "Hosting & Preise"], ["websites", "Website-Baukasten"]].map(([k, n]) =>
    `<button type="button" data-rzreiter="${k}" class="${RZW.reiter === k ? "on" : ""}">${t(n)}</button>`).join(""), "reiter" + RZW.reiter);
  fenster.querySelector(".sfHinweis").hidden = !meins;
  rzSetze(".sfHinweis", t("Deine Statusseite: So sehen Kunden und Mitspieler deine Rechenzentren. Ausbau, Preise und Platzverteilung stellst du hier direkt ein."), "hinweis");
  /* Strom: nur der Inhaber sieht, wie lange der Vorrat für die Rechenzentren reicht */
  const stromJeMin = racks.filter(x => !(x.bauBis > tick)).reduce((a, x) => a + B[x.btype].rz.in.strom * rzLvl(x.level) * 60, 0);
  const stromMin = stromJeMin ? Math.floor((me.inv?.strom || 0) / stromJeMin) : Infinity;
  const warn = fenster.querySelector(".rzWarn");
  warn.hidden = !(meins && stromMin < 6);
  rzSetze(".rzWarn", meins && stromMin < 6 ? `<span><b>${t("Strom wird knapp")}:</b> ${t("noch")} ${stromMin} ${t("Minuten Vorrat. Fällt er aus, gehen Shops, Apps und Websites deiner Kunden offline.")}</span>
    <button type="button" class="sfKaufen" data-rzstrom>${t("200 Strom kaufen")}</button>` : "", "warn" + stromMin);
  let html = "";
  if (RZW.reiter === "status") {
    const n = Math.max(up.length, 1);
    const balken = up.length ? up.map((u, i) => `<span class="rzUp ${u ? "an" : "aus"}" title="${t("vor")} ${up.length - i} min: ${u ? t("online") : t("Ausfall – Strom fehlte")}"></span>`).join("") : `<span class="meta">${t("Noch keine volle Minute gemessen.")}</span>`;
    const ausfaelle = up.filter(u => !u).length;
    const karten = racks.map(x => {
      const lvl = x.level || 1, imBau = x.bauBis && tick < x.bauBis, an = x.rzAktiv && !imBau;
      const plaetze = B[x.btype].rz.plaetze * lvl, ausl = kap.shops ? Math.min(100, Math.round(belegt.shops / Math.max(1, kap.shops) * 100)) : 0;
      const kosten = { el: Math.ceil(B[x.btype].cost / 2500 * lvl), cash: Math.round(B[x.btype].cost * 0.35 * lvl) };
      return `<article class="rzKarte">
        <div class="rzKarteKopf"><b>${t("Rechenzentrum")} ${x.x}·${x.y}</b><span class="rzStatus ${an ? "an" : "aus"}">${imBau ? t("im Bau") : an ? t("am Netz") : t("aus – Strom fehlt")}</span></div>
        <small>${t("Stufe")} ${lvl} · ${plaetze} ${t("Plätze")} · ${Math.round(B[x.btype].rz.in.strom * rzLvl(lvl) * 60)} ${t("Strom/min")}</small>
        <div class="rzBalken"><i style="width:${an ? ausl : 0}%"></i></div>
        <small class="mono">${an ? ausl : 0} % ${t("ausgelastet")}</small>
        ${meins && lvl < 5 ? `<button type="button" class="sfKaufen" data-rzausbau="${x.x},${x.y}" ${imBau || me.cash < kosten.cash || (me.inv?.elektronik || 0) < kosten.el ? "disabled" : ""}>${t("Auf Stufe")} ${lvl + 1} ${t("ausbauen")} · ${fmt(kosten.cash)} + ${kosten.el} ${gname("elektronik")}</button>` : ""}
        <button type="button" class="hfKarte" data-rzkarte="${x.x},${x.y}">📍 ${t("Auf der Karte zeigen")}</button>
      </article>`;
    }).join("");
    const zeile = (name, b, k) => `<div class="rzZeile"><span>${name}</span><div class="rzBalken"><i style="width:${k ? Math.min(100, Math.round(b / k * 100)) : 0}%"></i></div><b class="mono">${b} / ${k}</b></div>`;
    html = `<section class="rzBox"><div class="rzBoxKopf"><b>${t("Verfügbarkeit")} · ${t("letzte")} ${RZ_UPTIME_ANZ} ${t("Minuten")}</b><span class="mono">${upQuote} %</span></div>
        <div class="rzUptime" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${balken}</div>
        <small>${ausfaelle ? `${ausfaelle} ${ausfaelle === 1 ? t("Ausfall") : t("Ausfälle")}: ${t("Strom fehlte")}` : t("Keine Ausfälle")}</small></section>
      <div class="sfGrid rzKarten">${karten || `<div class="sfLeer">${t("Noch kein Rechenzentrum gebaut.")}</div>`}</div>
      <section class="rzBox"><b>${t("Was hier läuft")}</b>
        ${zeile(t("Shop-Systeme und Steuerungen"), belegt.shops, kap.shops)}
        ${zeile(t("Bürger-App-Nutzer"), belegt.apps, kap.apps)}
        ${zeile(t("Websites"), belegt.web, kap.web)}</section>`;
  } else if (RZW.reiter === "hosting") {
    const pm = (key, minus, plus) => meins ? `<div class="rzPreisZeile"><span>${t("Dein Preis")}</span><span class="sfMenge"><button type="button" data-rzpreis="${key}" data-d="-1" aria-label="${t("weniger")}">−</button><b class="mono">${minus}</b><button type="button" data-rzpreis="${key}" data-d="1" aria-label="${t("mehr")}">+</button></span></div>` : "";
    /* Besucher: direkt auf den eigenen Gebäuden installieren */
    const laeden = state.map.filter(x => x.owner === myId && B[x.btype]?.online);
    const fabriken = sys ? state.map.filter(x => x.owner === myId && state.steuerung?.[B[x.btype]?.industry] && (B[x.btype]?.proc || B[x.btype]?.out) && !B[x.btype]?.retail && !B[x.btype]?.studio && !B[x.btype]?.rz && (sys.stufen?.[B[x.btype].industry] || 0) >= 1) : [];
    const sysKnoepfe = !sys?.version ? `<div class="sfEigen">${t("Noch kein Shop-System fertig")}</div>`
      : meins ? "" : laeden.length ? laeden.map(x => x.system?.produktId === sys.id ? `<div class="sfEigen">${bname(x.btype)} ${x.x}·${x.y}: ${t("läuft hier")}</div>`
        : `<button type="button" class="sfKaufen" data-rzsys="${x.x},${x.y}" ${me.cash < sys.einrichtung || (sys.plaetze != null && sys.kunden >= sys.plaetze) ? "disabled" : ""}>${t("Auf")} ${bname(x.btype)} ${x.x}·${x.y} ${t("installieren")}</button>`).join("")
        : `<div class="sfEigen">${t("Du hast keinen Online-Marktplatz")}</div>`;
    const stKnoepfe = !sys?.version ? "" : meins ? "" : fabriken.length ? fabriken.slice(0, 4).map(x => x.steuerung?.produktId === sys.id ? `<div class="sfEigen">${bname(x.btype)}: ${t("läuft hier")}</div>`
        : `<button type="button" class="sfKaufen" data-rzsteuer="${x.x},${x.y}" ${me.cash < (sys.steuerAbo || 0) || (sys.plaetze != null && sys.kunden >= sys.plaetze) ? "disabled" : ""}>${t("Steuern")}: ${bname(x.btype)}</button>`).join("")
        : `<div class="sfEigen">${t("Keine passende Fabrik — ")}${escapeHtml(rohText(sys?.name || ""))} ${t("braucht einen Baum für deine Branche")}</div>`;
    const v = rz.verteilung;
    const vZeile = (k, name) => `<div class="rzZeile rzVert"><span>${name}</span><div class="rzBalken"><i style="width:${v[k]}%"></i></div><b class="mono">${v[k]} % · ${kap[k]}</b>
      <span class="rzPM"><button type="button" data-rzvert="${k}" data-d="-5" aria-label="${t("weniger")}">−</button><button type="button" data-rzvert="${k}" data-d="5" aria-label="${t("mehr")}">+</button></span></div>`;
    html = `<div class="sfGrid rzAngebote">
        <article class="sfProdukt"><span class="sfBand">${t("Shop-System")}</span><div class="sfBild"><span>🛒</span></div>
          <h5>${sys ? `${escapeHtml(rohText(sys.name))} v${sys.version || 0}` : t("Noch kein System")}</h5>
          <div class="sfPreis"><b>${sys ? String(sys.gebuehr).replace(".", ",") + " %" : "—"}</b><span>${t("je Verkauf")} · ${t("Einrichtung")} ${fmt(sys?.einrichtung || 0)}</span></div>
          <div class="sfInfo">${t("Bezahlen im Online-Marktplatz")} · ${sys?.plaetze != null ? Math.max(0, sys.plaetze - sys.kunden) : 0} ${t("Plätze frei")}</div>
          ${meins && sys ? pm("gebuehr", String(sys.gebuehr).replace(".", ",") + " %") + pm("einrichtung", fmt(sys.einrichtung)) : ""}
          <div class="sfKauf">${sysKnoepfe}</div></article>
        <article class="sfProdukt"><span class="sfBand">${t("Steuerung")}</span><div class="sfBild"><span>🎛️</span></div>
          <h5>${t("Leitstand für Fabriken")}</h5>
          <div class="sfPreis"><b>${fmt(sys?.steuerAbo || 0)}</b><span>${t("je Minute und Gebäude")}</span></div>
          <div class="sfInfo">${t("Mehr Ausstoß oder weniger Rohstoffe, je nach Branchenbaum")}${sys ? ` · ${sys.steuerKunden || 0} ${t("Gebäude gesteuert")}` : ""}</div>
          ${meins && sys ? pm("steuerAbo", fmt(sys.steuerAbo || 0)) : ""}
          <div class="sfKauf">${stKnoepfe}</div></article>
        <article class="sfProdukt"><span class="sfBand">${t("Website")}</span><div class="sfBild"><span>🌐</span></div>
          <h5>${web ? escapeHtml(rohText(web.name)) : t("Firmen-Website")}</h5>
          <div class="sfPreis"><b>${web ? fmt(web.preis) : "—"}</b><span>${t("je Minute ab Grundseite")} · ${t("Einrichtung")} ${fmt(wcfg?.EINRICHTUNG || 400)}</span></div>
          <div class="sfInfo">${t("Mehr Reichweite: Läden, Gäste und Grundbedarf")} · ${web ? Math.max(0, web.plaetze - web.kunden) : 0} ${t("Plätze frei")}</div>
          ${meins && web ? pm("web", fmt(web.preis)) : ""}
          <div class="sfKauf"><button type="button" class="sfKaufen" data-rzreiter="websites">${meins ? t("Zum Baukasten") : t("Website ansehen und bestellen")}</button></div></article>
      </div>
      ${meins ? `<section class="rzBox"><div class="rzBoxKopf"><b>${t("Platzverteilung")}</b><small>${t("Mehr für Websites heißt weniger für Shops und Apps")}</small></div>
        ${vZeile("shops", t("Shops und Steuerungen"))}${vZeile("apps", t("Bürger-Apps"))}${vZeile("web", t("Websites"))}</section>` : ""}`;
  } else {
    const meineSeite = state.rechenzentren?.websites?.[myId];
    const ver = web?.version || 0;
    const module = wcfg ? Object.entries(wcfg.MODULE).map(([k, m]) => {
      const offen = ver >= m.ab, preis = web ? Math.round(web.preis * m.faktor * 100) / 100 : 0;
      return `<button type="button" class="rzModul${RZW.modul === k ? " on" : ""}${offen ? "" : " zu"}" data-rzmodul="${k}" ${offen ? "" : "disabled"}>
        <span class="rzModulKopf"><b>${t(m.name)}</b><span class="mono">${web ? fmt(preis) + "/min" : "—"}</span></span>
        <small>${t({ grund: "Logo, Häuser oder Produkte, Bewertungen und Kontakt.", portal: "Buchungsseite, Baustoff-Portal, Kundenportal oder Ausschreibungen — je nach Branche.", aktion: "Gemüsekisten-Abo, Launch-Events, Feste online buchen." }[k])}</small>
        <em>${offen ? `+${Math.round(m.bonus * 100)} % ${t("Reichweite")}` : `${t("ab")} v${m.ab}`}</em></button>`;
    }).join("") : "";
    const gew = wcfg?.MODULE[RZW.modul];
    let bestellen = "";
    if (!meins && web?.version >= 1) {
      const laeuft = meineSeite?.anbieter === web.id;
      bestellen = laeuft && meineSeite.modul === RZW.modul
        ? `<div class="sfEigen">${t("Deine Website läuft hier")}: ${t(wcfg.MODULE[meineSeite.modul].name)}${meineSeite.online ? "" : ` · ${t("wird eingerichtet")}`} · +${Math.round((meineSeite.bonus || 0) * 100)} % ${t("Reichweite")}</div>
           <button type="button" class="hfKarte" data-rzkuendigen>${t("Website kündigen")}</button>`
        : `<button type="button" class="sfKaufen" data-rzbestellen ${ver < (gew?.ab || 9) || (!laeuft && web.kunden >= web.plaetze) ? "disabled" : ""}>${t(gew.name)} ${laeuft ? t("wechseln") : t("bestellen")} · ${fmt(Math.round(web.preis * gew.faktor))}/min${laeuft ? "" : ` + ${fmt(wcfg.EINRICHTUNG)} ${t("Einrichtung")}`}</button>
           ${!laeuft && web.kunden >= web.plaetze ? `<small>${t("Ausgebucht — dem Anbieter fehlen Plätze im Rechenzentrum.")}</small>` : ""}
           ${!laeuft ? `<small>${t("Die Software-Firma gestaltet deine Startseite individuell — Vorlage, Farben, Abschnitte. Die Einrichtung bekommt sie erst bei Lieferung.")}</small>` : ""}`;
    }
    const entw = meins ? (web ? (web.entwicklung
        ? `<div class="sfEigen">v${web.entwicklung.version} ${t("in Arbeit")}: ${web.entwicklung.ep} / ${web.entwicklung.ziel} EP</div>`
        : ver < (wcfg?.STUFEN.length || 3) ? `<button type="button" class="sfKaufen" data-rzwebdev>${escapeHtml(rohText(web.name))} v${ver + 1} ${t("entwickeln")} · ${wcfg.STUFEN[ver].ep} EP</button>`
        : `<div class="sfEigen">${t("Voll ausgebaut")}</div>`)
      : (sys?.version || 0) >= (wcfg?.AB_SYSTEM || 2)
        ? `<label class="rzNeu"><span>${t("Name deines Baukastens")}</span><input id="rzWebName" maxlength="20" placeholder="z. B. ${escapeHtml(rohText(owner.name)).slice(0, 12)} Web"></label><button type="button" class="sfKaufen" data-rzwebneu>${t("Website-Baukasten anlegen")}</button>`
        : `<div class="sfEigen">${t("Ab Shop-System v")}${wcfg?.AB_SYSTEM || 2}</div>`) : "";
    const kunden = (web?.liste || []).map(k => {
      const hat = (state.touristik?.firmen || []).some(f => f.id === k.id && f.zimmer > 0);
      return `<div class="rzKunde"><i class="${k.online ? "an" : "aus"}"></i><span><b>${escapeHtml(rohText(k.name))}</b><small class="mono">${shopSlug(k.name)}.cs · ${t(wcfg.MODULE[k.modul]?.name || "")}</small></span>
        ${meins && k.auftrag === "offen" ? `<button type="button" class="sfKaufen" data-genauf="${k.id}">🛠 ${t("Gestalten")} · ${Math.floor(k.rest / 60)}:${String(k.rest % 60).padStart(2, "0")}</button>`
          : k.auftrag === "offen" ? `<span class="rzOn aus">${t("wird gestaltet")}</span>`
          : meins ? `<button type="button" class="hfKarte" data-genauf="${k.id}" title="${t("Website überarbeiten")}">✎ ${Math.round((k.qualitaet || 0) * 100)} %</button>`
          : hat ? `<button type="button" class="hfKarte" data-hotelauf="${k.id}">${t("Ansehen")}</button>` : `<span class="rzOn ${k.online ? "an" : "aus"}">${k.online ? t("online") : t("wird eingerichtet")}</span>`}</div>`;
    }).join("");
    html = `<div class="rzZwei">
      <section class="rzBox"><b>${t("Website-Baukasten")}${web ? ` · ${escapeHtml(rohText(web.name))} v${ver}` : ""}</b>
        ${web || !meins ? (web ? module : `<div class="sfLeer">${escapeHtml(rohText(owner.name))} ${t("hat noch keinen Website-Baukasten.")}</div>`) : ""}
        ${bestellen}${entw}</section>
      <section class="rzBox"><b>${t("Gebaut von")} ${escapeHtml(rohText(owner.name))}</b>
        ${kunden || `<div class="sfLeer">${t("Noch keine Kunden.")}</div>`}
        ${meins && web ? `<small>${t("Einnahmen aus Websites")}: <b class="mono">${fmt(web.einnahmen10 || 0)}</b> ${t("in 10 Minuten")}</small>` : ""}</section>
    </div>
    ${!meins && !meineSeite ? `<div class="rzPortal">${t("Kein passender Anbieter?")} <button type="button" class="hfKarte" data-rzportal>${t("Grundseite beim Stadtportal")} · ${fmt(wcfg?.STADTPORTAL.einrichtung || 600)} + ${fmt(wcfg?.STADTPORTAL.preis || 45)}/min</button></div>` : ""}`;
  }
  rzSetze(".rzInhalt", html, "inhalt");
  rzSetze(".sfFuss", `${sys && !sys.portal ? logoHtml(sys.ownerId, "sfFussLogo", sys.farbe) : `<span class="sfFussLogo">🏛</span>`}<span>${t("Diese Seite läuft mit")} <b>${sys ? escapeHtml(rohText(sys.name)) : t("Stadtportal")}</b>${sys?.version ? ` v${sys.version}` : ""}</span>`, "fuss");
}
const RZ_UPTIME_ANZ = 30;
document.getElementById("rzFenster").addEventListener("click", e => {
  if (e.target.closest("[data-rzzu]") || e.target.id === "rzFenster") return rzSchliessen();
  const { state, me, myId } = store.get();
  const em = (ev, d, ok) => socket.emit(ev, d, r => { if (r?.error) return toast(r.error, true); if (ok) toast(typeof ok === "function" ? ok(r) : ok); render(store.get()); });
  const rt = e.target.closest("[data-rzreiter]");
  if (rt) { RZW.reiter = rt.dataset.rzreiter; RZW.sig = {}; return rzZeichnen(); }
  const md = e.target.closest("[data-rzmodul]");
  if (md) { RZW.modul = md.dataset.rzmodul; RZW.sig.inhalt = null; return rzZeichnen(); }
  const sys = (state.software || []).find(x => x.ownerId === RZW.pid && !x.portal), web = (state.website || []).find(x => x.ownerId === RZW.pid);
  const xy = v => v.split(",").map(Number);
  const a = e.target.closest("[data-rzausbau]");
  if (a) { const [x, y] = xy(a.dataset.rzausbau); return em("upgradeBuilding", { x, y }, t("Rechenzentrum ausgebaut")); }
  const k = e.target.closest("[data-rzkarte]");
  if (k) { const [x, y] = xy(k.dataset.rzkarte); rzSchliessen(); openPanel("karte"); cam.z = Math.max(cam.z, 1.2); cam.x = -(x - y) * TW / 2 * cam.z; cam.y = -(x + y) * TH / 2 * cam.z + innerHeight / 2 - 120; return; }
  if (e.target.closest("[data-rzstrom]")) {
    const ask = (state.orders || []).filter(o => o.good === "strom" && o.side === "sell" && o.playerId !== myId).reduce((m, o) => Math.min(m, o.price), Infinity);
    const preis = Number.isFinite(ask) ? ask : Math.round((state.avg?.strom || 2) * 1.1 * 100) / 100;
    return em("placeOrder", { side: "buy", good: "strom", qty: 200, price: preis }, `${t("Kauforder")}: 200 ${gname("strom")} · ${fp(preis)}`);
  }
  const s = e.target.closest("[data-rzsys]");
  if (s && sys) { const [x, y] = xy(s.dataset.rzsys); return em("installSystem", { x, y, produktId: sys.id }, `${sys.name} ${t("wird installiert")}`); }
  const st = e.target.closest("[data-rzsteuer]");
  if (st && sys) { const [x, y] = xy(st.dataset.rzsteuer); return em("installSteuerung", { x, y, produktId: sys.id }, `${t("Steuerung")} ${sys.name} ${t("wird installiert")}`); }
  const pr = e.target.closest("[data-rzpreis]");
  if (pr) {
    const d = +pr.dataset.d, key = pr.dataset.rzpreis;
    if (key === "web" && web) return em("webEinstellen", { name: web.name, preis: web.preis + d * 5 });
    if (!sys) return;
    const neu = { gebuehr: sys.gebuehr + d * 0.5, einrichtung: sys.einrichtung + d * 50, steuerAbo: (sys.steuerAbo || 0) + d * 2 }[key];
    return em("softwareEinstellen", { name: sys.name, [key]: Math.max(0, neu) });
  }
  const vt = e.target.closest("[data-rzvert]");
  if (vt) {
    const v = { ...(state.rechenzentren?.firmen?.[myId]?.verteilung || state.rzVerteilungStd) }, key = vt.dataset.rzvert, d = +vt.dataset.d;
    if (v[key] + d < 0 || v[key] + d > 100) return;
    const ziel = Object.keys(v).filter(x => x !== key).sort((p1, p2) => d > 0 ? v[p2] - v[p1] : v[p1] - v[p2])[0];
    if (v[ziel] - d < 0) return;
    v[key] += d; v[ziel] -= d;
    return em("rzVerteilung", v);
  }
  if (e.target.closest("[data-rzbestellen]") && web) return em("websiteBestellen", { anbieter: web.id, modul: RZW.modul }, r => `${t("Website bestellt")}${r.dauer ? ` · ${r.dauer} s ${t("Einrichtung")}` : ""}`);
  if (e.target.closest("[data-rzportal]")) return em("websiteBestellen", { anbieter: "stadtportal", modul: "grund" }, t("Grundseite beim Stadtportal bestellt"));
  if (e.target.closest("[data-rzkuendigen]")) return em("websiteKuendigen", {}, t("Website gekündigt"));
  if (e.target.closest("[data-rzwebdev]")) return em("webEntwickeln", {}, r => `${t("Entwicklung gestartet")}: ${r.ep} EP`);
  if (e.target.closest("[data-rzwebneu]")) return em("webEinstellen", { name: document.getElementById("rzWebName")?.value, preis: state.websiteCfg?.PREIS_START || 25 }, t("Website-Baukasten angelegt"));
  const ha = e.target.closest("[data-hotelauf]");
  if (ha) { rzSchliessen(); return hotelOeffnen(ha.dataset.hotelauf); }
  const ga = e.target.closest("[data-genauf]");
  if (ga) { rzSchliessen(); return genOeffnen(ga.dataset.genauf); }
});
/* Großer Verlauf für bank.cs: Fläche, gestrichelte Startlinie, Achse rechts */
function bankChart(h, fmtW) {
  if (!h || h.length < 2) return `<div class="bankChartLeer">${t("Der Verlauf erscheint nach den ersten Minuten.")}</div>`;
  const W = 330, H = 230, min = Math.min(...h), max = Math.max(...h), span = max - min || 1;   // schmal, damit die Schrift lesbar bleibt
  const x = i => i / (h.length - 1) * W, y = v => 10 + (1 - (v - min) / span) * (H - 20);
  const auf = h[h.length - 1] >= h[0], c = auf ? "#16a34a" : "#dc2626";
  const linie = h.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const minuten = Math.round(h.length * 10 / 60);
  return `<div class="bankChart"><svg viewBox="0 0 ${W + 78} ${H + 24}" role="img" aria-label="${t("Verlauf")}">
    <defs><linearGradient id="bankVerlauf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".35"></stop><stop offset="1" stop-color="${c}" stop-opacity=".02"></stop></linearGradient></defs>
    ${[0, .5, 1].map(f => `<line x1="0" x2="${W}" y1="${10 + f * (H - 20)}" y2="${10 + f * (H - 20)}" stroke="#e5e7eb"></line><text x="${W + 6}" y="${14 + f * (H - 20)}" font-size="13" fill="#4b5563">${fmtW(max - f * span)}</text>`).join("")}
    <line x1="0" x2="${W}" y1="${y(h[0])}" y2="${y(h[0])}" stroke="#374151" stroke-dasharray="4 4"></line>
    <text x="6" y="${y(h[0]) - 6}" font-size="13" fill="#374151">${t("Start")}: ${fmtW(h[0])}</text>
    <path d="${linie} L${W} ${H} L0 ${H} Z" fill="url(#bankVerlauf)"></path>
    <path d="${linie}" fill="none" stroke="${c}" stroke-width="2"></path>
    <text x="0" y="${H + 20}" font-size="13" fill="#4b5563">${t("vor")} ${minuten} min</text><text x="${W}" y="${H + 20}" font-size="13" fill="#4b5563" text-anchor="end">${t("jetzt")}</text>
  </svg></div>`;
}
/* ---- Firmen-Website nach Design (Website-Generator) ----
 * Rendert die Website einer Firma so, wie ihre Software-Firma sie gestaltet
 * hat: Vorlage (klar/elegant/bunt), Farbe, Titel, Slogan und die Abschnitte in
 * gewählter Reihenfolge. Das Stadtnetz zeigt sie, der Generator nutzt sie als
 * Live-Vorschau (vorschau = true: Knöpfe ohne Wirkung). */
const FW_ABSCHNITT = { produkte: "Produkte", betriebe: "Betriebe", angebot: "Direktkauf", bewertungen: "Bewertungen", ueber: "Über uns", aktie: "Aktie", galerie: "Galerie",
  zahlen: "Zahlen", team: "Team", kontakt: "Kontakt", faq: "Fragen", news: "Neuigkeiten" };
const FW_BESCHREIBUNG = { produkte: "Waren mit Ø-Kurs und Link zum Shop", betriebe: "Alle Gebäude der Firma", angebot: "Hofladen, Großhandel … (ab Branchenportal)",
  bewertungen: "Stimmen von Kunden", ueber: "Eigener Text über die Firma", aktie: "Kurs und Verlauf der Aktie", galerie: "Große Bilder der Gebäude",
  zahlen: "Große Kennzahlen: Betriebe, Waren, Besucher", team: "Die Menschen hinter der Firma", kontakt: "Adresse, Öffnungszeiten, E-Mail",
  faq: "Häufige Fragen zum Aufklappen", news: "Meldungen aus dem Stadtkurier" };
/* Feinschliff im Generator: "" = wie die Vorlage */
const FW_OPTIONEN = {
  schrift: { "": "Vorlage", modern: "Modern", serif: "Serif", rund: "Rund", kraft: "Kraftvoll", hand: "Handschrift", pixel: "Pixel" },
  kopf: { "": "Vorlage", verlauf: "Verlauf", flach: "Flach", zentriert: "Zentriert", gross: "Groß" },
  ecken: { "": "Vorlage", eckig: "Eckig", normal: "Normal", rund: "Rund" },
  muster: { "": "Ohne", punkte: "Punkte", streifen: "Streifen", wellen: "Wellen", raster: "Raster" },
};
const FW_VORLAGE = { klar: "Klar", elegant: "Elegant", bunt: "Bunt", dunkel: "Dunkel", retro: "Retro", natur: "Natur", modern: "Modern" };
const FW_TEAM = { agrar: ["Hofleitung", "Ernte & Lager", "Hofladen"], rohstoff: ["Bauleitung", "Steinbruch", "Logistik"], versorger: ["Netzleitung", "Kraftwerk", "Kundendienst"],
  tech: ["Geschäftsführung", "Fertigung", "Vertrieb"], touristik: ["Direktion", "Rezeption", "Küche"], software: ["Gründung", "Entwicklung", "Support"], ruestung: ["Geschäftsführung", "Fertigung", "Behörden"] };
const FW_ZEITEN = { agrar: "Mo–Sa 6–18 Uhr", rohstoff: "Mo–Fr 7–17 Uhr", versorger: "rund um die Uhr", tech: "Mo–Fr 8–18 Uhr", touristik: "Rezeption 24 h", software: "Mo–Fr 9–19 Uhr", ruestung: "nach Vereinbarung" };
const FW_FAQ = [["Liefert ihr in die ganze Stadt?", "Ja — über den Markt und unseren Online-Shop erreichen wir jeden Block."],
  ["Wie kommen die Preise zustande?", "Wir orientieren uns am Ø-Kurs der Börse und geben gute Ernten und Großaufträge weiter."],
  ["Kann man bei euch Aktien kaufen?", "Ja, an der Stadtbank. Bei Gewinn schütten wir regelmäßig aus."]];
const FW_STIMMEN = {
  agrar: ["Das Obst schmeckt wie früher.", "Bester Honig der Stadt!", "Pünktlich geliefert, frisch wie versprochen."],
  rohstoff: ["Ziegel in Top-Qualität, schnell da.", "Unser Wohnblock steht dank euch.", "Fairer Preis für Beton."],
  versorger: ["Nie wieder Stromausfall.", "Wasser immer verfügbar — danke!", "Zuverlässig wie ein Uhrwerk."],
  tech: ["Die Elektronik hat unseren Ausbau gerettet.", "Schnell, sauber, günstig.", "Bester Chip-Lieferant weit und breit."],
  touristik: ["Traumhafter Blick aufs Meer.", "Das Frühstück war ein Gedicht.", "Wir kommen nächstes Jahr wieder!"],
  software: ["Das Shop-System läuft wie geschmiert.", "Support antwortet sofort.", "Endlich eine App, die man versteht."],
  ruestung: ["Zuverlässig und termingerecht geliefert.", "Die Stadtwache ist zufrieden.", "Präzise Arbeit."],
};
const FW_NAMEN = ["Lena B.", "Familie Okafor", "Jonas K.", "Mira S.", "Herr Brandt", "Aylin T.", "Kenji M.", "Oma Hilde"];
function firmenSeiteHtml(state, me, myId, pid, design, vorschau = false) {
  const p = state.players[pid], w = state.rechenzentren?.websites?.[pid], B = BTYPES(), ind = p?.industry, meins = pid === myId;
  if (!p) return "";
  const d = design || w?.design || { vorlage: "klar", farbe: p.color, titel: p.name, slogan: "", abschnitte: ["produkte", "betriebe"], ueber: "" };
  const geb = {};
  for (const x of state.map) if (x.owner === pid && x.btype) geb[x.btype] = (geb[x.btype] || 0) + 1;
  const waren = [...new Set(Object.keys(geb).map(b => B[b]?.proc?.out || B[b]?.out).filter(Boolean))];
  const shop = state.map.find(x => x.owner === pid && B[x.btype]?.online && x.system);
  const knopf = (attr, text, cls = "fwKnopf") => vorschau ? `<span class="${cls}">${text}</span>` : `<button type="button" class="${cls}" ${attr}>${text}</button>`;
  const titel = escapeHtml(rohText(d.titel || p.name)), slogan = d.slogan ? escapeHtml(rohText(d.slogan)) : "";
  const hero = `<section class="fwHero"><div class="fwHeroMarke">${logoHtml(pid, "fwLogo", d.farbe)}<div><h1>${titel}</h1>${slogan ? `<p>${slogan}</p>` : ""}</div></div>
    <div class="fwHeroLeiste"><span>${t(BRANCHE_NAME[ind] || "")}</span>${w ? `<span>${w.besucher} ${t("Besucher/min")}</span>` : ""}${shop ? knopf(`data-shopauf="${shop.x},${shop.y}"`, `🛒 ${t("Zum Online-Shop")}`, "fwKnopf hell") : ""}</div></section>`;
  const abschnitt = typ => {
    if (typ === "produkte") return `<section class="fwAbschnitt"><h2>${t("Produkte")}</h2><div class="fwProdukte">${waren.map(g => `<div class="fwProdukt"><span>${WAREN_ICON[g] || "📦"}</span><b>${gname(g)}</b><small>Ø ${fp(state.avg?.[g] || 0)}</small></div>`).join("") || `<small>${t("Noch keine eigene Ware.")}</small>`}</div></section>`;
    if (typ === "betriebe") return `<section class="fwAbschnitt"><h2>${t("Unsere Betriebe")}</h2><div class="fwBetriebe">${Object.entries(geb).map(([b, n]) => `<div class="fwBetrieb">${spriteUrl(b, 0, 0) ? `<img src="${spriteUrl(b, 0, 0)}" alt="">` : ""}<span><b>${n}×</b> ${bname(b)}</span></div>`).join("") || `<small>${t("Noch nichts gebaut.")}</small>`}</div></section>`;
    if (typ === "galerie") return `<section class="fwAbschnitt"><h2>${t("Galerie")}</h2><div class="fwGalerie">${Object.keys(geb).slice(0, 6).map(b => `<figure>${spriteUrl(b, 0, 0) ? `<img src="${spriteUrl(b, 0, 0)}" alt="">` : ""}<figcaption>${bname(b)}</figcaption></figure>`).join("") || `<small>${t("Noch nichts gebaut.")}</small>`}</div></section>`;
    if (typ === "ueber") return `<section class="fwAbschnitt fwUeber"><h2>${t("Über uns")}</h2><p>${d.ueber ? escapeHtml(rohText(d.ueber)) : `<i>${t("Hier steht der Text über die Firma.")}</i>`}</p></section>`;
    if (typ === "bewertungen") { const st = FW_STIMMEN[ind] || FW_STIMMEN.agrar, n0 = rohText(p.name).length;
      return `<section class="fwAbschnitt"><h2>${t("Bewertungen")}</h2><div class="fwStimmen">${st.map((x, i) => `<blockquote><span>${"★".repeat(i === 2 ? 4 : 5)}${i === 2 ? "☆" : ""}</span><p>„${t(x)}“</p><cite>${FW_NAMEN[(n0 + i * 3) % FW_NAMEN.length]}</cite></blockquote>`).join("")}</div></section>`; }
    if (typ === "aktie") { const h = firmHist[pid] || [], dd = h.length > 1 && h[0] ? (h[h.length - 1] / h[0] - 1) * 100 : 0;
      return `<section class="fwAbschnitt"><h2>${t("Unsere Aktie")}</h2><div class="fwAktie"><b class="mono">${fk(p.kurs || 0)}</b><em class="${dd >= 0 ? "auf" : "ab"}">${dd >= 0 ? "+" : "−"}${Math.abs(dd).toFixed(1).replace(".", ",")} %</em>${h.length > 1 ? sparklineVon(h, 120, 32) : ""}${knopf(`data-netzaktie="${pid}"`, t("An der Stadtbank"))}</div></section>`; }
    if (typ === "zahlen") { const anz = Object.values(geb).reduce((a, n) => a + n, 0);
      return `<section class="fwAbschnitt"><h2>${t("In Zahlen")}</h2><div class="fwZahlen"><div><b>${anz}</b><span>${t("Betriebe")}</span></div><div><b>${waren.length}</b><span>${t("Waren")}</span></div><div><b>${w?.besucher || 0}</b><span>${t("Besucher/min")}</span></div><div><b>${fk(p.kurs || 0)}</b><span>${t("Aktienkurs")}</span></div></div></section>`; }
    if (typ === "team") { const n0 = rohText(p.name).length, rollen = FW_TEAM[ind] || FW_TEAM.tech, gesichter = ["👩‍🌾", "👨‍🔧", "👩‍💼", "🧑‍🍳", "👨‍💻", "👩‍🔬", "🧔", "👵"];
      return `<section class="fwAbschnitt"><h2>${t("Unser Team")}</h2><div class="fwTeam">${rollen.map((r, i) => `<div><span>${gesichter[(n0 + i * 3) % gesichter.length]}</span><b>${FW_NAMEN[(n0 + i * 5 + 1) % FW_NAMEN.length]}</b><small>${t(r)}</small></div>`).join("")}</div></section>`; }
    if (typ === "kontakt") { const g = state.map.find(x => x.owner === pid && x.btype), slug = shopSlug(p.name);
      return `<section class="fwAbschnitt"><h2>${t("Kontakt")}</h2><div class="fwKontakt"><div><span>📍</span><b>${t("Adresse")}</b><small>${g ? `${t("Block")} ${g.x}·${g.y}` : t("Capital City")}</small></div><div><span>🕘</span><b>${t("Öffnungszeiten")}</b><small>${t(FW_ZEITEN[ind] || "Mo–Fr 9–17 Uhr")}</small></div><div><span>✉️</span><b>${t("E-Mail")}</b><small class="mono">info@${slug}.cs</small></div></div></section>`; }
    if (typ === "faq") return `<section class="fwAbschnitt"><h2>${t("Häufige Fragen")}</h2><div class="fwFaq">${FW_FAQ.map(([f, a]) => `<details><summary>${t(f)}</summary><p>${t(a)}</p></details>`).join("")}</div></section>`;
    if (typ === "news") { const name = rohText(p.name), alle = typeof kurierArtikel === "function" ? kurierArtikel(state) : [];
      const eigene = alle.filter(a => rohText(a.titel).includes(name)), liste = (eigene.length ? eigene : alle).slice(0, 3);
      return `<section class="fwAbschnitt"><h2>${t("Neuigkeiten")}</h2><div class="fwNews">${liste.map(a => `<div><small>${t(a.ressort)}</small><b>${escapeHtml(rohText(a.titel))}</b></div>`).join("") || `<small>${t("Noch keine Meldungen.")}</small>`}</div></section>`; }
    if (typ === "angebot") {
      const name = state.rechenzentren?.portale?.[ind]?.name || "Branchenportal";
      if (!(w?.stufe >= 2)) return vorschau || meins ? `<section class="fwAbschnitt"><h2>${t(name)}</h2><small class="fwHinweis">${t("Erscheint, sobald die Firma das Modul „Branchenportal“ hat.")}</small></section>` : "";
      const angebot = (w.angebot || []).map(a => { const n = Math.max(1, Math.min(NETZ.menge[a.g] || 10, a.menge || 1));
        return `<article class="fwAngebot"><span class="fwAngebotIcon">${WAREN_ICON[a.g] || "📦"}</span><b>${gname(a.g)}</b><span class="mono">${fp(a.preis)}</span><small>${a.menge} ${t("sofort verfügbar")}</small>
          ${meins || vorschau ? `<span class="fwEigen">${t(meins ? "Dein Angebot" : "Kaufen")}</span>` : `<div class="sfMenge"><button type="button" data-netzm="${a.g}" data-d="-10" aria-label="${t("weniger")}">−</button><input type="number" min="1" max="${a.menge || 1}" value="${n}" data-netzn="${a.g}" aria-label="${t("Menge")}"><button type="button" data-netzm="${a.g}" data-d="10" aria-label="${t("mehr")}">+</button></div>
          <button type="button" class="fwKnopf" data-netzkauf="${a.g}" ${a.menge < 1 || me.cash < a.preis ? "disabled" : ""}>${t("Kaufen")} · ${fmt(n * a.preis)}</button>`}</article>`; }).join("");
      let extra = "";
      if (ind === "rohstoff") extra = `<div class="fwListe"><b>${t("Wohnbau-Aufträge der Stadt")}</b>${(state.stadt?.auftraege || []).map(a => `<span>${escapeHtml(a.name)} · ${Object.entries(a.needs).map(([g, n]) => `${n.have}/${n.req} ${gname(g)}`).join(" · ")}</span>`).join("") || `<small>${t("Gerade kein offener Auftrag.")}</small>`}</div>`;
      if (ind === "ruestung") extra = `<div class="fwListe"><b>${t("Ausschreibungen")}</b>${(state.stadt?.ruest?.auftraege || []).map(a => `<span>${a.name} · ${Object.entries(a.needs).map(([g, n]) => `${n.have}/${n.req} ${gname(g)}`).join(" · ")}</span>`).join("") || `<small>${t("Nächste Ausschreibung kommt bald.")}</small>`}</div>`;
      return `<section class="fwAbschnitt"><h2>${t(name)}</h2>${angebot ? `<div class="fwAngebote">${angebot}</div>` : ""}${extra}</section>`;
    }
    return "";
  };
  const extra = ["schrift", "kopf", "ecken", "muster"].filter(k => d[k]).map(k => ` fw${k[0].toUpperCase()}-${d[k]}`).join("");
  return `<div class="fw fw-${d.vorlage || "klar"}${extra}" style="--fw:${d.farbe || p.color || "#0f766e"}">${hero}${(d.abschnitte || []).map(abschnitt).join("")}</div>`;
}
/* ---- Website-Generator (Software-Firmen) ----
 * Bestellt eine Firma eine Website, gestaltet die Software-Firma sie hier:
 * Vorlage, Farbe, Titel, Slogan, Abschnitte (hinzufügen, verschieben,
 * entfernen) und ein Text „Über uns“. Rechts läuft die Vorschau mit
 * firmenSeiteHtml. Die Qualität (wie beim Server) bestimmt die Wirkung. */
const GEN = { offen: false, kunde: null, e: null };
const genQualitaet = d => Math.min(1, 0.7 + 0.05 * Math.min(4, d.abschnitte.length) + (d.slogan ? 0.05 : 0) + (d.abschnitte.includes("ueber") && (d.ueber || "").length >= 40 ? 0.05 : 0));
function genOeffnen(kundeId) {
  const st = store.get().state, k = st.players[kundeId], w = st.rechenzentren?.websites?.[kundeId];
  if (!k) return;
  const d = w?.design;
  GEN.offen = true; GEN.kunde = kundeId;
  GEN.e = d ? { ...d, titel: rohText(d.titel || k.name), slogan: rohText(d.slogan || ""), ueber: rohText(d.ueber || ""), abschnitte: [...(d.abschnitte || [])] }
    : { vorlage: "klar", farbe: (st.rechenzentren?.design?.FARBEN || [])[0] || "#0f766e", titel: rohText(k.name), slogan: "", ueber: "", abschnitte: ["produkte", "betriebe"] };
  const el = document.getElementById("genFenster");
  el.hidden = false;
  el.innerHTML = `<div class="genRahmen" role="dialog" aria-label="${t("Website-Generator")}">
    <aside class="genEditor"></aside>
    <div class="genVorschau"><div class="sfLeiste"><span class="sfPunkte"><i></i><i></i><i></i></span><span class="sfUrl">🔒 ${shopSlug(k.name)}.cs</span><button type="button" class="sfZu" data-genzu aria-label="${t("Schließen")}">✕</button></div><div class="genSeite"></div></div>
  </div>`;
  sfSchriftenLaden();
  genEditor(); genVorschau();
}
function genSchliessen() { GEN.offen = false; const el = document.getElementById("genFenster"); el.hidden = true; el.innerHTML = ""; }
function genEditor() {
  const st = store.get().state, k = st.players[GEN.kunde], w = st.rechenzentren?.websites?.[GEN.kunde], D = st.rechenzentren?.design, e = GEN.e;
  if (!k || !D) return genSchliessen();
  const q = genQualitaet(e), auftrag = w?.auftrag?.status === "offen" ? w.auftrag : null;
  const frei = D.ABSCHNITTE.filter(a => !e.abschnitte.includes(a));
  document.querySelector("#genFenster .genEditor").innerHTML = `
    <div class="genKopf"><b>${t("Website für")} ${escapeHtml(rohText(k.name))}</b><small>${t(BRANCHE_NAME[k.industry] || "")} · ${t(st.websiteCfg?.MODULE[w?.modul]?.name || "")}${auftrag ? ` · ${t("Honorar")} ${fmt(auftrag.honorar)} · ${t("noch")} <span class="genFrist">${Math.floor(auftrag.rest / 60)}:${String(auftrag.rest % 60).padStart(2, "0")}</span>` : ""}</small></div>
    <div class="genQualitaet"><span>${t("Qualität")}</span><div class="genBalken"><i style="width:${Math.round(q * 100)}%"></i></div><b class="mono">${Math.round(q * 100)} %</b></div>
    <small class="genTipp">${t("Mehr Abschnitte (bis 4), ein Slogan und ein Text „Über uns“ heben die Qualität — und damit die Reichweite deines Kunden.")}</small>
    <button type="button" class="genZufall" data-genzufall>🎲 ${t("Überrasch mich")}</button>
    <div class="genGruppe"><span>${t("Vorlage")}</span><div class="genVorlagen viele">${D.VORLAGEN.map(v => `<button type="button" class="${e.vorlage === v ? "on" : ""}" data-genvorlage="${v}">${t(FW_VORLAGE[v] || v)}</button>`).join("")}</div></div>
    <div class="genGruppe"><span>${t("Farbe")}</span><div class="genFarben">${D.FARBEN.map(f => `<button type="button" class="${e.farbe === f ? "on" : ""}" style="background:${f}" data-genfarbe="${f}" aria-label="${f}"></button>`).join("")}</div></div>
    <details class="genMehr" ${GEN.mehr ? "open" : ""}><summary>${t("Feinschliff")} · ${t("Schrift, Kopf, Ecken, Muster")}</summary>
      ${[["schrift", "Schrift", D.SCHRIFTEN], ["kopf", "Kopf", D.KOEPFE], ["ecken", "Ecken", D.ECKEN], ["muster", "Muster", D.MUSTER]].filter(([, , l]) => l).map(([k, n, l]) =>
        `<div class="genGruppe"><span>${t(n)}</span><div class="genChips">${l.map(v => `<button type="button" class="${(e[k] || "") === v ? "on" : ""}" data-gens="${k}:${v}">${t(FW_OPTIONEN[k][v] || v)}</button>`).join("")}</div></div>`).join("")}
    </details>
    <label class="genFeld"><span>${t("Titel")}</span><input id="genTitel" maxlength="30" value="${escapeHtml(e.titel)}"></label>
    <label class="genFeld"><span>${t("Slogan")}</span><input id="genSlogan" maxlength="60" placeholder="${t("z. B. Frisch vom Hof in die Stadt")}" value="${escapeHtml(e.slogan)}"></label>
    <div class="genGruppe"><span>${t("Abschnitte")} (${e.abschnitte.length}/${D.MAX_ABSCHNITTE})</span>
      <ol class="genAbschnitte">${e.abschnitte.map((a, i) => `<li><b>${t(FW_ABSCHNITT[a])}</b><span class="genPfeile"><button type="button" data-genhoch="${i}" ${i ? "" : "disabled"} aria-label="${t("nach oben")}">↑</button><button type="button" data-genrunter="${i}" ${i < e.abschnitte.length - 1 ? "" : "disabled"} aria-label="${t("nach unten")}">↓</button><button type="button" data-genweg="${i}" aria-label="${t("entfernen")}">✕</button></span></li>`).join("") || `<small>${t("Noch kein Abschnitt — füg unten einen hinzu.")}</small>`}</ol>
      ${frei.length && e.abschnitte.length < D.MAX_ABSCHNITTE ? `<div class="genNeu">${frei.map(a => `<button type="button" data-genneu="${a}" title="${t(FW_BESCHREIBUNG[a])}">+ ${t(FW_ABSCHNITT[a])}</button>`).join("")}</div>` : ""}</div>
    ${e.abschnitte.includes("ueber") ? `<label class="genFeld"><span>${t("Über uns")} <small>(${e.ueber.length}/220)</small></span><textarea id="genUeber" maxlength="220" rows="3" placeholder="${t("Wer seid ihr, was macht euch besonders?")}">${escapeHtml(e.ueber)}</textarea></label>` : ""}
    <button type="button" class="sfKaufen genSenden" data-gensenden ${e.abschnitte.length ? "" : "disabled"}>${auftrag ? `${t("Website ausliefern")} · +${fmt(auftrag.honorar)}` : t("Änderungen veröffentlichen")}</button>`;
}
function genVorschau() {
  const { state, me, myId } = store.get();
  const el = document.querySelector("#genFenster .genSeite"); if (!el) return;
  el.innerHTML = firmenSeiteHtml(state, me, myId, GEN.kunde, { ...GEN.e, titel: GEN.e.titel, slogan: GEN.e.slogan, ueber: GEN.e.ueber }, true);
}
document.getElementById("genFenster").addEventListener("input", e => {
  if (!GEN.offen) return;
  if (e.target.id === "genTitel") GEN.e.titel = e.target.value;
  if (e.target.id === "genSlogan") GEN.e.slogan = e.target.value;
  if (e.target.id === "genUeber") { GEN.e.ueber = e.target.value; const z = e.target.closest("label")?.querySelector("small"); if (z) z.textContent = `(${e.target.value.length}/220)`; }
  const q = genQualitaet(GEN.e), b = document.querySelector("#genFenster .genQualitaet");
  if (b) { b.querySelector("i").style.width = Math.round(q * 100) + "%"; b.querySelector("b").textContent = Math.round(q * 100) + " %"; }
  genVorschau();
});
document.getElementById("genFenster").addEventListener("toggle", e => { if (e.target.classList?.contains("genMehr")) GEN.mehr = e.target.open; }, true);
document.getElementById("genFenster").addEventListener("click", e => {
  if (e.target.closest("[data-genzu]") || e.target.id === "genFenster") return genSchliessen();
  const E = GEN.e; let neu = true;
  const v = e.target.closest("[data-genvorlage]"), f = e.target.closest("[data-genfarbe]"), h = e.target.closest("[data-genhoch]"), r = e.target.closest("[data-genrunter]"), w = e.target.closest("[data-genweg]"), n = e.target.closest("[data-genneu]");
  if (v) E.vorlage = v.dataset.genvorlage;
  else if (f) E.farbe = f.dataset.genfarbe;
  else if (h) { const i = +h.dataset.genhoch; [E.abschnitte[i - 1], E.abschnitte[i]] = [E.abschnitte[i], E.abschnitte[i - 1]]; }
  else if (r) { const i = +r.dataset.genrunter; [E.abschnitte[i + 1], E.abschnitte[i]] = [E.abschnitte[i], E.abschnitte[i + 1]]; }
  else if (w) E.abschnitte.splice(+w.dataset.genweg, 1);
  else if (n) E.abschnitte.push(n.dataset.genneu);
  else if (e.target.closest("[data-gens]")) { const [k, v] = e.target.closest("[data-gens]").dataset.gens.split(":"); E[k] = v; }
  else if (e.target.closest("[data-genzufall]")) {
    const D = store.get().state.rechenzentren?.design, z = l => l[Math.floor(Math.random() * l.length)];
    Object.assign(E, { vorlage: z(D.VORLAGEN), farbe: z(D.FARBEN), schrift: z(D.SCHRIFTEN || [""]), kopf: z(D.KOEPFE || [""]), ecken: z(D.ECKEN || [""]), muster: z(D.MUSTER || [""]) });
  }
  else neu = false;
  if (neu) { SFX.spiel("klick"); genEditor(); genVorschau(); return; }
  if (e.target.closest("[data-gensenden]")) socket.emit("websiteGestalten", { kundeId: GEN.kunde, design: E }, res => {
    if (res?.error) return toast(res.error, true);
    toast(`${t("Website ausgeliefert")} · ${t("Qualität")} ${Math.round(res.qualitaet * 100)} %`); SFX.spiel("kasse"); genSchliessen(); render(store.get());
  });
});
/* ---- Stadtkurier (ersetzt die Nachrichtenzentrale im Sandkasten) ----
 * Die Artikel stellt der Client aus dem zusammen, was der Spielstand ohnehin
 * kennt: Marktberichte (Wirtschaft), Aktienkäufe und Ausschüttungen (Börse),
 * das Stadt-Log (Stadt), Software-Neuheiten, Bauten, Feste und Ausschreibungen
 * (Firmen). Großauftrag und offene Ausschreibung laufen als Eilmeldung. */
const KURIER = { gelesen: 0, kurse: [],
  nr: st => Math.max(1, Math.floor((st.news?.[0]?.min || 0) / 2)),
  /* Kurse: alle zwei Spielminuten einen Schnappschuss merken und damit vergleichen */
  merken(st) {
    const l = this.kurse[this.kurse.length - 1];
    if (!st?.avg || (l && st.tick - l.tick < 120 && st.tick >= l.tick)) return;
    if (l && st.tick < l.tick) this.kurse = [];
    this.kurse.push({ tick: st.tick, avg: { ...st.avg } }); if (this.kurse.length > 3) this.kurse.shift();
  },
  veraenderung(st) {
    const alt = this.kurse.length >= 2 ? this.kurse[this.kurse.length - 2] : null;
    if (!alt) return [];
    return Object.keys(st.avg || {}).map(g => ({ g, d: alt.avg[g] ? Math.round((st.avg[g] / alt.avg[g] - 1) * 100) : 0 }))
      .filter(x => x.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6).sort((a, b) => b.d - a.d);
  } };
function kurierArtikel(st) {
  const out = [], vor = tick => { const m = Math.max(0, Math.round((st.tick - tick) / 60)); return m < 1 ? t("gerade eben") : `${t("vor")} ${m} min`; };
  const go = st.groupOrder;
  if (go) { const txt = Object.entries(go.needs).map(([g, n]) => `${n.req}× ${gname(g)}`).join(t(" und "));
    const topf = Object.values(go.needs).reduce((a, n) => a + n.req * (n.pay || 0), 0);
    out.push({ id: "grossauftrag-" + go.id, ressort: "Eilmeldung", eil: true, titel: `${t("Großauftrag aus")} ${go.city}: ${txt}`, zusatz: `${fmt(topf)} ${t("im Topf, noch")} ${Math.floor(go.ttl / 60)}:${String(go.ttl % 60).padStart(2, "0")}`,
      absaetze: [`${go.city} ${t("braucht")} ${txt}. ${t("Jede Firma kann einzahlen; abgerechnet wird zum doppelten Ø-Kurs.")}`, `${t("Im Topf liegen rund")} ${fmt(topf)}. ${t("Die Frist läuft noch")} ${Math.ceil(go.ttl / 60)} min.`],
      link: ["panel", "lager", "Zum Großauftrag"], tick: st.tick + 1 }); }
  for (const a of st.stadt?.ruest?.auftraege || []) {
    const txt = Object.entries(a.needs).map(([g, n]) => `${n.req}× ${gname(g)}`).join(t(" und "));
    out.push({ id: "ruest-" + a.id, ressort: a.phase === "bieten" ? "Eilmeldung" : "Firmen", eil: a.phase === "bieten", titel: `${a.name} ${t("schreibt aus")}: ${txt}`,
      zusatz: a.phase === "bieten" ? `${t("Gebote noch")} ${Math.max(0, a.bisBieten - st.tick)} s` : "",
      absaetze: [a.phase === "bieten" ? `${t("Rüstungsfirmen geben jetzt ein verdecktes Gebot zwischen 80 und 140 % des Listenpreises ab. Mit Ausschreibungsportal zählen Gebote 5 % günstiger.")}` : `${t("Den Zuschlag hat")} ${rohText(a.gewinnerName || "—")} ${t("zu")} ${a.prozent} % ${t("bekommen.")}`],
      link: ["panel", "firma", "Zu den Ausschreibungen"], tick: st.tick }); }
  if (st.touristik?.fest) { const f = st.touristik.fest;
    out.push({ id: "fest", ressort: "Firmen", titel: `${rohText(f.veranstalter)} ${t("lädt zum")} ${t(f.name)}`, absaetze: [`${t("Noch")} ${Math.ceil(f.rest / 60)} ${t("Minuten lang kommen mehr Gäste in die Stadt; alle Hotels profitieren, der Veranstalter am meisten.")}`],
      link: ["hotel", f.ownerId, "Zur Buchungsseite"], tick: st.tick - 1 }); }
  for (const b0 of st.news || []) { const b = (SPRACHE === "en" && b0.en) ? { ...b0.en, min: b0.min } : b0;
    out.push({ id: "markt-" + b.min, ressort: "Wirtschaft", titel: b.schlagzeile, absaetze: b.absaetze, tick: b.min * 60, link: ["panel", "boerse", "Zur Börse"] }); }
  const boerse = ["kauf", "verkauf", "ausschuettung", "panik"], firma = ["software", "bau", "flaute"];
  for (const e of st.marktLog || []) {
    if (!boerse.includes(e.art) && !firma.includes(e.art)) continue;
    const w = e.firmaId && st.rechenzentren?.websites?.[e.firmaId]?.stufe;
    out.push({ id: `log-${e.tick}-${e.art}-${(e.text || "").length}`, ressort: boerse.includes(e.art) ? "Börse" : "Firmen", titel: e.text, absaetze: [e.text],
      link: boerse.includes(e.art) ? ["panel", "bank", "Zur Stadtbank"] : w ? ["firma", e.firmaId, "Zur Website"] : null, tick: e.tick });
  }
  for (const e of st.stadt?.log || []) out.push({ id: `stadt-${e.tick}-${(e.text || "").length}`, ressort: "Stadt", titel: e.text, absaetze: [e.text, `${t("Die Stadt hat jetzt")} ${st.stadt.einwohner.toLocaleString("de-DE")} ${t("Einwohner, die Zufriedenheit liegt bei")} ${Math.round((st.stadt.zufr || 1) * 100)} %.`],
    link: ["panel", "finanzamt", "Zur Stadt"], tick: e.tick });
  return out.sort((a, b) => b.tick - a.tick).slice(0, 40).map(a => ({ ...a, zeit: a.eil ? t("Eilmeldung") : vor(a.tick), anriss: (a.absaetze.find(x => x && x !== a.titel) || "").slice(0, 160) }));
}
/* Kasten mit den drei neuesten Schlagzeilen auf der Startseite */
function kurierKasten(artikel) {
  const drei = artikel.filter(a => !a.eil).slice(0, 3);
  return `<section class="netzKurier"><div class="netzKurierKopf"><span><b>${t("Stadtkurier")}</b><small>${drei[0] ? drei[0].zeit : t("Erste Ausgabe nach zwei Minuten")}</small></span><button type="button" data-kurierauf="">${t("Alle Nachrichten")} →</button></div>
    ${drei.length ? `<div class="netzKurierSchlag">${drei.map(a => `<button type="button" data-kurierauf="${a.id}"><span class="kurierRessort r-${a.ressort === "Börse" ? "boerse" : a.ressort.toLowerCase()}">${t(a.ressort)}</span><b>${escapeHtml(rohText(a.titel))}</b><small>${a.zeit}</small></button>`).join("")}</div>` : `<div class="netzLeer">${t("Noch gibt es nichts zu berichten.")}</div>`}</section>`;
}
/* ---- Stadtnetz und Firmen-Websites (Etappe 8) ----
 * Startseite mit allen Websites der Stadt, sortiert nach Besuchern, und je
 * Firma eine eigene Seite: Grundseite für alle, Branchenportal mit Direktkauf
 * (Hofladen, Großhandel, Baustoff-Portal, Kundenportal) oder Ausschreibungen,
 * Aktionen ab Modul v3. Touristik öffnet die Buchungsseite, Software die Statusseite. */
const NETZ = { offen: false, seite: null, suche: "", menge: {}, sig: {}, kat: "alle", ressort: "alle", artikel: null };
function netzOeffnen(pid = null) {
  const st = store.get().state;
  if (pid && st.players?.[pid]?.industry === "touristik") return hotelOeffnen(pid);
  if (pid && st.players?.[pid]?.industry === "software" && !st.rechenzentren?.websites?.[pid]) return rzOeffnen(pid);
  const el = document.getElementById("netzFenster");
  if (!NETZ.offen) {
    el.hidden = false;
    el.innerHTML = `<div class="sfBrowser hfBrowser netzBrowser" role="dialog" aria-label="${t("Stadtnetz")}">
      <div class="sfLeiste"><button type="button" class="sfZu" data-netzzurueck aria-label="${t("Zurück zum Stadtnetz")}">←</button>
        <span class="sfUrl"></span><button type="button" class="sfZu" data-netzzu aria-label="${t("Schließen")}">✕</button></div>
      <div class="netzEil" hidden></div>
      <header class="sfKopf"></header>
      <div class="sfBanner" hidden></div>
      <div class="sfHinweis" hidden></div>
      <div class="rzInhalt netzInhalt"></div>
      <footer class="sfFuss"></footer>
    </div>`;
    SFX.spiel("klick");
  }
  if (pid === "kurier") TUT_GESEHEN.add("kurier");
  if (!pid) TUT_GESEHEN.add("netz");
  if (pid === "boerse") TUT_GESEHEN.add("boerse");
  if (pid !== "boerse") boerseHeimholen();
  if (pid !== "bank") bankHeimholen();
  if (pid === "bank") TUT_GESEHEN.add("bank");
  if (pid === "anleihen") TUT_GESEHEN.add("bonds");
  Object.assign(NETZ, { offen: true, seite: pid, sig: {}, artikel: pid === "kurier" ? NETZ.artikel : null });
  netzZeichnen();
}
/* Warenbörse als Website: Formular und Orderbuch des bisherigen Panels werden
 * in das Stadtnetz-Fenster gehängt — alle IDs und Klick-Handler bleiben gleich. */
const BOERSE_BODY = document.querySelector("#p-boerse .pbody");
function boerseHeimholen() { const p = document.getElementById("p-boerse"); if (BOERSE_BODY.parentElement !== p) p.appendChild(BOERSE_BODY); }
/* Stadtbank als Website: Das ganze Bank-Panel wird in das Stadtnetz-Fenster
 * gehängt — seine Klick-Handler hängen am Panel selbst, Reiter, Formulare und
 * Kurswetten funktionieren dadurch unverändert. Beim Verlassen kehrt es zurück. */
const BANK_EL = document.getElementById("p-bank");
const BANK_HEIM = { parent: BANK_EL.parentElement, next: BANK_EL.nextSibling };
function bankHeimholen() {
  if (BANK_EL.parentElement === BANK_HEIM.parent) return;
  BANK_HEIM.parent.insertBefore(BANK_EL, BANK_HEIM.next);
  BANK_EL.classList.remove("imNetz", "open");
}
function netzSchliessen() {
  boerseHeimholen();
  bankHeimholen();
  NETZ.offen = false;
  const el = document.getElementById("netzFenster");
  el.hidden = true; el.innerHTML = "";
}
const netzSetze = (sel, html, key) => {
  if (NETZ.sig[key] === html) return;
  NETZ.sig[key] = html;
  const el = document.querySelector("#netzFenster " + sel); if (el) el.innerHTML = html;
};
function netzZeichnen() {
  const { state, me, myId } = store.get();
  if (!state?.stadt) return netzSchliessen();
  const fenster = document.getElementById("netzFenster");
  const W = state.rechenzentren?.websites || {}, cfg = state.websiteCfg;
  fenster.querySelector("[data-netzzurueck]").style.visibility = NETZ.seite ? "visible" : "hidden";
  const kopfEl = fenster.querySelector(".sfKopf");
  kopfEl.style.display = "";
  kopfEl.classList.toggle("netzHero", !NETZ.seite);
  kopfEl.classList.toggle("netzZeitung", NETZ.seite === "kurier");
  /* Eilmeldung oben im Stadtnetz: Großauftrag oder offene Ausschreibung */
  const artikel = kurierArtikel(state);
  const eil = artikel.find(a => a.eil);
  const eilEl = fenster.querySelector(".netzEil");
  eilEl.hidden = !eil;
  netzSetze(".netzEil", eil ? `<button type="button" data-kurierauf="${eil.id}"><span class="netzEilMarke">${t("EILMELDUNG")}</span><span class="netzEilText">${escapeHtml(rohText(eil.titel))}${eil.zusatz ? ` — ${escapeHtml(rohText(eil.zusatz))}` : ""}</span><span class="netzEilLink">${t("Zum Artikel")} →</span></button>` : "", "eil");
  if (!NETZ.seite) {
    fenster.querySelector(".sfBrowser").style.setProperty("--sys", "#0f766e");
    netzSetze(".sfUrl", "🔒 stadtnetz.cs", "url");
    /* Kopf einmal aufbauen; Suchfeld, Zahlen und Treffer werden einzeln
     * nachgezogen, sonst verlöre das Suchfeld bei jedem Tick den Fokus. */
    netzSetze(".sfKopf", `<svg class="netzSkyline" width="520" height="220" viewBox="0 0 520 220" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2" aria-hidden="true"><rect x="20" y="120" width="60" height="100"></rect><rect x="90" y="70" width="70" height="150"></rect><rect x="170" y="100" width="50" height="120"></rect><rect x="230" y="40" width="80" height="180"></rect><rect x="320" y="90" width="60" height="130"></rect><rect x="390" y="60" width="70" height="160"></rect><path d="M0 219 H520"></path></svg>
      <div class="netzMarke"><span class="netzMarkeS">S</span><div><b>${t("Stadtnetz")}</b><small>${t("Alles, was die Stadt online anbietet")}</small></div></div>
      <label class="netzSuchfeld"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4b5563" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
        <span class="sr">${t("Suchen")}</span><input id="netzSuche" type="search" placeholder="${t("Firma, Ware oder Branche — z. B. Obst, Strom, Hotel")}"><span class="netzTreffer"></span></label>
      <div class="netzStats"></div>`, "kopfStart");
    const inp = document.getElementById("netzSuche");
    if (inp && inp.value !== NETZ.suche && document.activeElement !== inp) inp.value = NETZ.suche;
    const S = state.stadt, T = state.touristik;
    const mitSeite = Object.entries(W).filter(([pid, w]) => state.players[pid] && w.stufe > 0);
    netzSetze(".netzStats", `<span><b>${S.einwohner.toLocaleString("de-DE")}</b> ${t("Einwohner online")}</span><span><b>${mitSeite.length}</b> ${t("Websites")}</span><span><b>${Math.round((S.zufr || 1) * 100)} %</b> ${t("Zufriedenheit")}</span>${T ? `<span><b>${T.gaeste}</b> ${t("Gäste je Minute")}</span>` : ""}`, "stats");
    fenster.querySelector(".sfBanner").hidden = true;
    fenster.querySelector(".sfHinweis").hidden = !!W[myId]?.stufe || state.players?.[myId]?.industry === "software";
    netzSetze(".sfHinweis", `${t("Deine Firma ist im Stadtnetz nicht zu finden — ohne Website sehen dich Kunden nicht.")} <button type="button" class="hfKarte" data-netzanbieter>${t("Anbieter vergleichen")}</button>`, "hinweisStart");
    /* Firmen: Suche und Branchen-Filter */
    const q = NETZ.suche.trim().toLowerCase();
    const waren = pid => [...new Set(state.map.filter(x => x.owner === pid && x.btype).map(x => BTYPES()[x.btype]?.proc?.out || BTYPES()[x.btype]?.out).filter(Boolean))];
    const passt = (pid, w) => { if (!q) return true; const p = state.players[pid];
      return [rohText(p.name), BRANCHE_NAME[p.industry] || "", w.portal || "", ...waren(pid).map(gname), ...(p.industry === "touristik" ? ["hotel", "zimmer", "übernachtung"] : [])].join(" ").toLowerCase().includes(q); };
    const branchen = [...new Set(mitSeite.map(([pid]) => state.players[pid].industry))];
    if (NETZ.kat !== "alle" && !branchen.includes(NETZ.kat)) NETZ.kat = "alle";
    const firmen = mitSeite.filter(([pid, w]) => (NETZ.kat === "alle" || state.players[pid].industry === NETZ.kat) && passt(pid, w)).sort((a, b) => b[1].besucher - a[1].besucher);
    netzSetze(".netzTreffer", `${firmen.length} ${t("Treffer")}`, "treffer");
    const chips = [["alle", t("Alle")], ...branchen.map(b => [b, t(BRANCHE_NAME[b] || b)])].map(([k, n]) => `<button type="button" class="netzKat${NETZ.kat === k ? " on" : ""}" data-netzkat="${k}">${n}</button>`).join("");
    const bew = (pid, w) => state.players[pid].industry === "touristik" ? (T?.firmen || []).find(f => f.id === pid)?.bewertung || 0 : null;
    const karte = ([pid, w]) => { const p = state.players[pid], b = bew(pid, w), tags = [];
      if (w.stufe >= 2 && w.portal) tags.push(t(w.portal));
      for (const g of waren(pid).slice(0, 3)) tags.push(gname(g));
      const text = p.industry === "touristik" ? t("Hotels und Camping — Zimmer direkt buchen.") : w.stufe >= 2 && w.angebot?.some(a => a.menge > 0) ? t("Direkt kaufen, sofort im Lager.") : `${t(BRANCHE_NAME[p.industry] || "")} · ${t(cfg?.MODULE[w.modul]?.name || "")}`;
      return `<button type="button" class="netzKarte" data-netzauf="${pid}">
        <span class="netzKarteBand" style="background:${p.color}">${logoHtml(pid, "netzKarteLogo", p.color)}${w.aktion ? `<em>${t("AKTION LÄUFT")}</em>` : ""}</span>
        <span class="netzKarteInhalt">
          <span class="netzKarteName"><b>${escapeHtml(rohText(p.name))}</b>${b ? `<i>${"★".repeat(Math.round(b))}${"☆".repeat(5 - Math.round(b))}</i>` : ""}</span>
          <small class="mono">${shopSlug(p.name)}.cs</small>
          <span class="netzKarteText">${text}</span>
          <span class="netzTags">${tags.map(x => `<span>${x}</span>`).join("")}</span>
          <span class="netzKarteFuss"><span class="mono">${w.besucher} ${t("Besucher/min")}</span><span>${t("Besuchen")} →</span></span>
        </span></button>`; };
    /* Seitenleiste */
    const laeuft = [];
    if (T?.fest) laeuft.push(["F", "#0d9488", t(T.fest.name), `${escapeHtml(rohText(T.fest.veranstalter))} · ${t("noch")} ${Math.floor(T.fest.rest / 60)}:${String(T.fest.rest % 60).padStart(2, "0")}`, T.fest.ownerId]);
    for (const a of S.ruest?.auftraege || []) laeuft.push(["A", "#e11d48", `${t("Ausschreibung")} ${a.name}`, a.phase === "bieten" ? t("Gebote offen") : `${t("Zuschlag")}: ${escapeHtml(rohText(a.gewinnerName || ""))}`, null]);
    if (S.auftraege?.length) laeuft.push(["W", "#b45309", t("Wohnbau"), `${S.auftraege.length} ${t("Aufträge suchen Baumaterial")}`, null]);
    for (const [pid, w] of mitSeite) if (w.aktion) laeuft.push(["⚡", "#d97706", t(w.aktion.name), escapeHtml(rohText(state.players[pid].name)), pid]);
    const neu = mitSeite.slice().sort((a, b) => (b[1].seit || 0) - (a[1].seit || 0)).slice(0, 3);
    const rz = Object.entries(state.rechenzentren?.firmen || {}).filter(([pid]) => state.players[pid]);
    const anz = (state.anzeigen || [])[0];
    netzSetze(".netzInhalt", `<div class="netzKats">${chips}</div>
      <div class="netzSpalten"><div class="netzHaupt">
        <div class="netzDienste">
          <button type="button" class="netzDienst" data-kurierauf=""><span class="netzDienstIcon" style="background:#111827">📰</span><span><b>${t("Stadtkurier")}</b><small>kurier.cs · ${t("Nachrichten alle zwei Minuten")}</small></span></button>
          <button type="button" class="netzDienst" data-netzauf="boerse"><span class="netzDienstIcon" style="background:#1d4ed8">📈</span><span><b>${t("Warenbörse")}</b><small>boerse.cs · ${state.orders.length} ${t("offene Orders")}</small></span></button>
          <button type="button" class="netzDienst" data-netzauf="anleihen"><span class="netzDienstIcon" style="background:#7c3aed">%</span><span><b>${t("Anleihenmarkt")}</b><small>anleihen.cs · ${(state.bonds || []).filter(b => !b.holderId).length} ${t("am Markt")}</small></span></button>
          <button type="button" class="netzDienst" data-netzauf="bank"><span class="netzDienstIcon" style="background:#0e7490">🏦</span><span><b>${t("Stadtbank")}</b><small>bank.cs · ${t("Aktien, Übernahmen, Kurswetten")}</small></span></button>
        </div>
        ${kurierKasten(artikel)}
        <section class="netzAbschnitt"><div class="netzAbschnittKopf"><b>${NETZ.kat === "alle" ? t("Beliebte Seiten") : t(BRANCHE_NAME[NETZ.kat] || "")}</b><small>${t("sortiert nach Besuchern")}</small></div>
          ${firmen.length ? `<div class="netzKarten">${firmen.map(karte).join("")}</div>` : `<div class="netzLeer">${q ? t("Nichts gefunden. Versuch es mit einer Ware wie „Strom“ oder „Obst“.") : t("Noch hat keine Firma eine Website.")}</div>`}</section>
      </div><aside class="netzSeite">
        ${laeuft.length ? `<section class="netzBox"><b>${t("Läuft gerade")}</b>${laeuft.map(([k, c, ti, tx, pid]) => `<${pid ? `button type="button" data-netzauf="${pid}"` : "div"} class="netzLaeuft"><span style="background:${c}">${k}</span><span><b>${ti}</b><small>${tx}</small></span></${pid ? "button" : "div"}>`).join("")}</section>` : ""}
        ${neu.length ? `<section class="netzBox"><b>${t("Neu im Stadtnetz")}</b>${neu.map(([pid, w]) => `<button type="button" class="netzNeu" data-netzauf="${pid}"><span>${escapeHtml(rohText(state.players[pid].name))} · ${t(w.stufe >= 2 && w.portal ? w.portal : cfg?.MODULE[w.modul]?.name || "")}</span><small>${t("vor")} ${Math.max(0, Math.round((state.tick - (w.seit || 0)) / 60))} min</small></button>`).join("")}</section>` : ""}
        ${rz.length ? `<section class="netzBox"><b>${t("Rechenzentren")}</b>${rz.map(([pid, f]) => { const up = f.uptime || [], qu = up.length ? Math.round(up.reduce((a, b) => a + b, 0) / up.length * 100) : 100, web = (state.website || []).find(x => x.ownerId === pid);
          return `<button type="button" class="netzRz" data-rzauf="${pid}"><span class="netzRzKopf"><span>${escapeHtml(rohText(state.players[pid].name))}</span><b class="mono">${qu} % ${t("online")}</b></span><span class="netzRzBalken"><i style="width:${web?.plaetze ? Math.min(100, Math.round(web.kunden / web.plaetze * 100)) : 0}%"></i></span></button>`; }).join("")}</section>` : ""}
        ${anz ? `<button type="button" class="netzBox netzAnzeige" data-netzauf="${anz.firmaId}"><small>${t("ANZEIGE")}</small><b>${escapeHtml(rohText(anz.firma))}</b><span>${escapeHtml(rohText(anz.text))}</span></button>` : ""}
      </aside></div>`, "inhaltStart");
    netzSetze(".sfFuss", `<span class="sfFussLogo">🏛</span><span>${t("Das Stadtnetz wird von der Stadt betrieben")} · ${mitSeite.length + rz.length + 1} ${t("Seiten")}</span>`, "fussStart");
    return;
  }
  /* ---- Warenbörse (boerse.cs) ----
   * Übersichtlich in drei Teilen: links die Kursliste nach Warengruppen, oben
   * die gewählte Ware mit Kurs, Verlauf und bestem Angebot/Gesuch, darunter
   * Formular und Orderbuch NUR dieser Ware in zwei Spalten. */
  if (NETZ.seite === "boerse") {
    fenster.querySelector(".sfBrowser").style.setProperty("--sys", "#1d4ed8");
    const F = state.finanzamt, avg = state.avg || {}, G0 = GOODS();
    const waren = Object.keys(avg).filter(g => G0[g]);
    if (!NETZ.ware || !waren.includes(NETZ.ware)) NETZ.ware = waren.slice().sort((x, y) => state.orders.filter(o => o.good === y).length - state.orders.filter(o => o.good === x).length)[0] || waren[0];
    const g = NETZ.ware;
    netzSetze(".sfUrl", `🔒 boerse.cs/${shopSlug(gname(g))}`, "url" + g);
    netzSetze(".sfKopf", `<div class="sfMarke"><span class="sfLogo" style="background:#1e40af">B</span><div><b>${t("Warenbörse")}</b><small>${state.orders.length} ${t("offene Orders")}${F?.aktiv && F.boerse > 0 ? ` · ${t("Börsengebühr")} ${Math.round(F.boerse * 1000) / 10} % ${t("für Verkäufer")}` : ""}</small></div></div>`, "kopfBoerse" + state.orders.length);
    fenster.querySelector(".sfBanner").hidden = true;
    fenster.querySelector(".sfHinweis").hidden = true;
    /* Kursliste nach Gruppen */
    const GRUPPEN = [["Enabler", "Versorgung"], ["Erzeugnisse", "Rohwaren"], ["Verarbeitet", "Verarbeitet"], ["Baumaterial", "Baumaterial"], ["Fahrzeuge", "Fahrzeuge"], ["Rüstung", "Rüstung"], ["Motorsport", "Motorsport"]];
    const anz = x => state.orders.filter(o => o.good === x && o.playerId !== myId).length;
    const liste = GRUPPEN.map(([cat, name]) => { const ws = waren.filter(x => G0[x].cat === cat); if (!ws.length) return "";
      return `<div class="bwGruppe">${t(name)}</div>` + ws.map(x => `<button type="button" class="bwZeile${x === g ? " on" : ""}" data-boersewahl="${x}"><span class="bwName">${gname(x)}</span><b class="mono">${fp(avg[x])}</b><span class="bwTrend">${trendLabel(x)}</span><span class="bwAnz">${anz(x) || ""}</span></button>`).join(""); }).join("");
    /* Gewählte Ware */
    const fremd = state.orders.filter(o => o.good === g && o.playerId !== myId);
    const angebote = fremd.filter(o => o.side === "sell").sort((x, y) => x.price - y.price);
    const gesuche = fremd.filter(o => o.side === "buy").sort((x, y) => y.price - x.price);
    const meine = state.orders.filter(o => o.playerId === myId);
    const lager = Math.floor(me.inv?.[g] || 0);
    const seite = NETZ.bwSeite || "buy";
    /* Kaufen/Beliefern nimmt die Menge aus dem Formular (Standard 10) — vorher
     * das ganze Angebot: ein Klick kaufte 3.356 Strom für rund 8.000 $. */
    const menge = NETZ.bwMenge || 10;
    const zeile = (o, art) => { const n = Math.min(o.qty, art === "liefer" ? Math.min(menge, lager) : menge);
      return `<div class="bwOrder"><span class="mono"><b>${o.qty}×</b> ${fp(o.price)}</span><span class="bwWer">${escapeHtml(rohText(o.player || ""))}</span>
      <button type="button" class="${art === "kauf" ? "buyb" : "sellb"}" data-bwtake="${o.id}" data-bwn="${n}" ${n < 1 || (art === "kauf" && me.cash < o.price) ? "disabled" : ""}>${art === "kauf" ? t("Kaufen") : t("Beliefern")} ${n}× · ${fmt(n * o.price)}</button></div>`; };
    const ruhig = document.activeElement && fenster.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    netzSetze(".netzInhalt", `<div class="bwLayout"><aside class="bwListe"><div class="bwListeKopf"><b>${t("Kurse")}</b><small>${t("Ø · Trend · Orders")}</small></div><div class="bwListeInhalt"></div></aside><div class="bwHaupt"></div></div>`, "inhaltBoerse");
    { const el = fenster.querySelector(".bwListeInhalt"), y = el?.scrollTop || 0;   // Scrollposition über Kurs-Updates halten
      netzSetze(".bwListeInhalt", liste, "liste" + g + state.orders.length + JSON.stringify(avg)); if (el) el.scrollTop = y; }
    if (!ruhig) netzSetze(".bwHaupt", `<section class="bwDetail">
        <div class="bwDetailKopf"><div><span class="bwKat">${t((GRUPPEN.find(x => x[0] === G0[g].cat) || [])[1] || "")}</span><h3>${gname(g)}</h3></div>
          <div class="bwPreis"><b class="mono">${fp(avg[g])}</b><span>${t("Ø-Kurs")} ${trendLabel(g)}</span></div></div>
        <div class="bwKennzahlen">
          <div><small>${t("Bestes Angebot")}</small><b class="mono">${angebote[0] ? fp(angebote[0].price) : "—"}</b><span>${angebote[0] ? `${angebote[0].qty}× ${t("verfügbar")}` : t("niemand verkauft")}</span></div>
          <div><small>${t("Bestes Gesuch")}</small><b class="mono">${gesuche[0] ? fp(gesuche[0].price) : "—"}</b><span>${gesuche[0] ? `${gesuche[0].qty}× ${t("gesucht")}` : t("niemand sucht")}</span></div>
          <div><small>${t("Dein Lager")}</small><b class="mono">${lager}</b><span>${t("Wert")} ${fmt(lager * (avg[g] || 0))}</span></div>
        </div>
        <div class="bwChart">${kursChart(g)}</div>
      </section>
      <section class="bwForm">
        <div class="bwSeiten"><button type="button" class="${seite === "buy" ? "on kauf" : ""}" data-bwseite="buy">${t("Kaufen")}</button><button type="button" class="${seite === "sell" ? "on verkauf" : ""}" data-bwseite="sell">${t("Verkaufen")}</button></div>
        <label><span>${t("Menge")}</span><input id="bwMenge" type="number" min="1" step="1" value="${NETZ.bwMenge || 10}"></label>
        <label><span>${t("Preis je Stück")}</span><input id="bwPreis" type="number" min="0.01" step="0.01" value="${NETZ.bwPreis ?? (Math.round((avg[g] || 1) * 100) / 100)}"></label>
        <button type="button" class="${seite === "buy" ? "buyb" : "sellb"} bwSenden" data-bwsenden>${seite === "buy" ? t("Kauforder platzieren") : t("Verkaufsorder platzieren")}</button>
        <small>${seite === "buy" ? t("Liegt ein Angebot zu diesem Preis oder billiger, wird sofort gekauft. Sonst bleibt die Order stehen; das Geld liegt so lange treuhänderisch fest.") : `${t("Liegt ein Gesuch zu diesem Preis oder teurer, wird sofort verkauft. Sonst bleibt die Order stehen.")}${F?.aktiv && F.boerse > 0 ? ` ${t("Börsengebühr")} ${Math.round(F.boerse * 1000) / 10} %.` : ""}`}</small>
      </section>
      <div class="bwBuch">
        <section><div class="bwBuchKopf verkauf"><b>${t("Angebote")}</b><small>${t("jemand verkauft — du kaufst")}</small></div>${angebote.map(o => zeile(o, "kauf")).join("") || `<div class="bwLeer">${t("Keine Angebote")}</div>`}</section>
        <section><div class="bwBuchKopf kauf"><b>${t("Gesuche")}</b><small>${t("jemand kauft — du lieferst")}</small></div>${gesuche.map(o => zeile(o, "liefer")).join("") || `<div class="bwLeer">${t("Keine Gesuche")}</div>`}</section>
      </div>
      ${meine.length ? `<section class="bwMeine"><b>${t("Meine Orders")}</b>${meine.map(o => `<div class="bwOrder"><span class="${o.side === "buy" ? "bwK" : "bwV"}">${o.side === "buy" ? t("Kauf") : t("Verkauf")}</span><span class="mono"><b>${o.qty}×</b> ${gname(o.good)} · ${fp(o.price)}</span><button type="button" class="mini" data-bwstorno="${o.id}">${t("Storno")}</button></div>`).join("")}</section>` : ""}`, "haupt");
    netzSetze(".sfFuss", `<span class="sfFussLogo">📈</span><span>${t("Die Warenbörse wird von der Stadt betrieben · Ware und Geld liegen bis zum Handel treuhänderisch fest")}</span>`, "fussBoerse");
    return;
  }
  /* ---- Stadtbank (bank.cs) als Finanzportal ----
   * Marktübersicht mit Kacheln (grün/rot nach Veränderung über 10 Minuten),
   * großer Verlauf der gewählten Kachel, Anzeige aus dem Werbenetz, Analysen
   * aus dem Kurier; Aktien mit Suche und Detailseite; Handeln & Depot ist die
   * bisherige Bank, eingebettet wie ein Terminal. */
  if (NETZ.seite === "bank") {
    fenster.querySelector(".sfBrowser").style.setProperty("--sys", "#0e7490");
    const tab = NETZ.bankTab || "markt";
    netzSetze(".sfUrl", `🔒 bank.cs${tab === "markt" ? "" : tab === "aktien" ? (NETZ.bankAktie ? "/aktie/" + shopSlug(state.players[NETZ.bankAktie]?.name || "") : "/aktien") : "/handeln"}`, "url" + tab + (NETZ.bankAktie || ""));
    netzSetze(".sfKopf", `<div class="sfMarke"><span class="sfLogo" style="background:#155e75">€</span><div><b>${t("Stadtbank")}</b><small>${t("Kurse, Fonds und Aktien der Stadt")}</small></div></div>
      <nav class="bankNav"><button type="button" data-banktab="markt">${t("Marktübersicht")}</button><button type="button" data-banktab="aktien">${t("Aktien")}</button><button type="button" data-banktab="handeln">${t("Handeln & Depot")}</button>
        <label class="bankSuche"><span class="sr">${t("Aktie suchen")}</span><input id="bankSuche" type="search" placeholder="${t("Aktie suchen …")}"></label></nav>`, "kopfBank");
    fenster.querySelectorAll(".bankNav [data-banktab]").forEach(b => b.classList.toggle("on", b.dataset.banktab === tab));
    const si = document.getElementById("bankSuche"); if (si && document.activeElement !== si && si.value !== (NETZ.bankSuche || "")) si.value = NETZ.bankSuche || "";
    fenster.querySelector(".sfBanner").hidden = true;
    fenster.querySelector(".sfHinweis").hidden = true;
    netzSetze(".sfFuss", `<span class="sfFussLogo">🏦</span><span>${t("Die Stadtbank wird von der Stadt betrieben · das Gebäude im Zentrum führt hierher")}</span>`, "fussBank");
    if (tab === "handeln") {
      netzSetze(".netzInhalt", `<div class="bankSlot"></div>`, "inhaltBankHandeln");
      const slot = fenster.querySelector(".bankSlot");
      if (slot && BANK_EL.parentElement !== slot) { slot.appendChild(BANK_EL); BANK_EL.classList.add("imNetz", "open"); render(store.get()); }
      return;
    }
    bankHeimholen();
    const firmen = Object.values(state.players || {});
    const aend = h => h && h.length > 1 && h[0] ? (h[h.length - 1] / h[0] - 1) * 100 : 0;
    /* Kacheln: Veränderung über 2 Minuten (12 Punkte à 10 s) — über 10 Minuten
     * war am Rundenanfang jede Kachel tiefgrün */
    const aend2 = h => { if (!h || h.length < 2) return 0; const a = h[Math.max(0, h.length - 13)]; return a ? (h[h.length - 1] / a - 1) * 100 : 0; };
    const KURZ = { agrar: "Agrar", rohstoff: "Rohstoff", versorger: "Versorger", tech: "Technik", touristik: "Touristik", ruestung: "Rüstung", software: "Software" };
    /* Stadtindex: Summe aller Firmenwerte, Punkt für Punkt von hinten ausgerichtet */
    const laenge = Math.max(0, ...firmen.map(p => (firmHist[p.id] || []).length));
    const index = Array.from({ length: laenge }, (_, i) => firmen.reduce((a, p) => { const h = firmHist[p.id] || []; const j = h.length - laenge + i; return a + (j >= 0 ? h[j] : (h[0] || 0)); }, 0));
    const etfs = state.etf || [];
    const kacheln = [
      { id: "index", name: t("Stadtindex"), wert: index[index.length - 1] || 0, h: index, fmtW: v => Math.round(v).toLocaleString("de-DE") },
      ...etfs.map(e => ({ id: "etf:" + e.branche, name: `${t("Fonds")} ${t(KURZ[e.branche] || e.name)}`, wert: e.preis || 0, h: e.verlauf || [], fmtW: v => v.toFixed(1).replace(".", ",") })),
      ...firmen.slice().sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0)).slice(0, 8).map(p => ({ id: "firma:" + p.id, name: rohText(p.name), wert: p.kurs || 0, h: firmHist[p.id] || [], fmtW: v => fk(v), firma: p.id })),
    ];
    if (!NETZ.bankWahl || !kacheln.some(k => k.id === NETZ.bankWahl)) NETZ.bankWahl = "index";
    const farbe = d => d >= 2 ? "k-stark-auf" : d > 0.05 ? "k-auf" : d <= -2 ? "k-stark-ab" : d < -0.05 ? "k-ab" : "k-null";
    const pz = d => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2).replace(".", ",")} %`;
    const wahl = kacheln.find(k => k.id === NETZ.bankWahl), dW = aend(wahl.h);
    const chart = bankChart(wahl.h, wahl.fmtW);
    /* Anzeige: Werbenetz, sonst Hinweis für Firmen */
    const anz = (state.anzeigen || [])[Math.floor(state.tick / 20) % Math.max(1, (state.anzeigen || []).length)];
    const anzFirma = anz && state.players[anz.firmaId];
    const anzeige = anz ? `<button type="button" class="bankAnzeige" data-netzauf="${anz.firmaId}" style="--af:${anzFirma?.color || "#0e7490"}"><small>${t("ANZEIGE")}</small>${logoHtml(anz.firmaId, "bankAnzLogo", anzFirma?.color)}<b>${escapeHtml(rohText(anz.firma))}</b><span>${escapeHtml(rohText(anz.text))}</span><em>${t("Website besuchen")}</em></button>`
      : `<div class="bankAnzeige leer"><small>${t("ANZEIGE")}</small><b>${t("Hier könnte Ihre Firma stehen")}</b><span>${t("Anzeigen buchen Firmen über das Werbenetz der Software-Firmen.")}</span></div>`;
    if (tab === "markt") {
      const analysen = kurierArtikel(state).filter(a => a.ressort === "Börse" || a.ressort === "Wirtschaft").slice(0, 3);
      netzSetze(".netzInhalt", `<div class="bankPortal">
        <div class="bankHaupt">
          <div class="bankOben">
            <section class="bankKarte"><div class="bankKarteKopf"><b>${t("Marktübersicht")}</b><small>${t("Veränderung in 2 Minuten")}</small></div>
              <div class="bankKacheln">${kacheln.map(k => { const d = aend2(k.h); return `<button type="button" class="bankKachel ${farbe(d)}${k.id === NETZ.bankWahl ? " on" : ""}" data-bankwahl="${k.id}"><span>${escapeHtml(k.name)}</span><span class="bankKachelZahl"><b>${k.fmtW(k.wert)}</b><em>${pz(d)}</em></span></button>`; }).join("")}</div>
              <div class="bankLegende"><span class="k-stark-auf"></span>+2 %<span class="k-auf"></span>${t("steigt")}<span class="k-null"></span>${t("gleich")}<span class="k-ab"></span>${t("fällt")}<span class="k-stark-ab"></span>−2 %</div></section>
            <section class="bankKarte bankChartKarte"><div class="bankChartKopf"><div><b>${escapeHtml(wahl.name)}</b><span class="bankChartWert">${wahl.fmtW(wahl.wert)}</span></div><em class="${dW >= 0 ? "auf" : "ab"}">${pz(dW)}</em></div>
              ${chart}
              ${wahl.firma ? `<button type="button" class="bankLink" data-bankaktie="${wahl.firma}">${t("Zur Aktie")} ${escapeHtml(wahl.name)} ›</button>` : wahl.id.startsWith("etf:") ? `<button type="button" class="bankLink" data-banktab="handeln">${t("Fonds kaufen")} ›</button>` : `<button type="button" class="bankLink" data-banktab="aktien">${t("Alle Aktien")} ›</button>`}</section>
          </div>
          <section class="bankAnalysen"><h3>${t("Analysen und Nachrichten")}</h3><div class="bankAnalyseKarten">${analysen.map(a => `<button type="button" class="bankAnalyse" data-kurierauf="${a.id}"><span class="bankAnalyseBild r-${a.ressort === "Börse" ? "boerse" : "wirtschaft"}"><svg width="70" height="44" viewBox="0 0 96 64" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 56 L28 30 L44 42 L66 14 L90 30"></path></svg></span><span class="bankAnalyseText"><span class="kurierRessort r-${a.ressort === "Börse" ? "boerse" : "wirtschaft"}">${t(a.ressort)}</span><b>${escapeHtml(rohText(a.titel))}</b><small>${t("Stadtkurier")} · ${a.zeit}</small></span></button>`).join("") || `<div class="netzLeer">${t("Noch keine Analysen.")}</div>`}</div></section>
        </div>
        <aside class="bankRand">${anzeige}</aside></div>`, "inhaltMarkt");
      return;
    }
    /* ---- Aktien: Suche, Liste, Detailseite ---- */
    const q = (NETZ.bankSuche || "").trim().toLowerCase();
    if (NETZ.bankAktie && state.players[NETZ.bankAktie]) {
      const p = state.players[NETZ.bankAktie], h = firmHist[p.id] || [], d = aend(h), div = aktienDividende(p), rend = aktienRendite(p);
      const held = p.id === myId ? (me.ownPct ?? 0) : ((me.portfolio || []).find(x => x.id === p.id)?.pct || 0);
      const angebote = (state.shareListings || []).filter(l => l.companyId === p.id && l.sellerId !== myId && (!l.toId || l.toId === myId));
      netzSetze(".netzInhalt", `<div class="bankPortal"><div class="bankHaupt">
        <button type="button" class="bankLink zurueck" data-bankaktie="">‹ ${t("Alle Aktien")}</button>
        <section class="bankKarte bankDetail"><div class="bankChartKopf"><div class="bankDetailName">${logoHtml(p.id, "bankDetailLogo", p.color)}<span><b>${escapeHtml(rohText(p.name))}</b><small>${t(BRANCHE_NAME[p.industry] || "")}${held ? ` · ${t("du hältst")} ${held} %` : ""}</small></span></div>
          <div class="bankDetailKurs"><b class="mono">${fk(p.kurs || 0)}</b><em class="${d >= 0 ? "auf" : "ab"}">${pz(d)}</em></div></div>
          ${bankChart(h, v => fmt(v))}
          <div class="bankKennzahlen">
            <div><small>${t("Marktwert")}</small><b>${fmt(p.marketValue || 0)}</b></div>
            <div><small>${t("Wert je Aktie (F)")}</small><b>${fk(p.fundament || 0)}</b></div>
            <div><small>${t("Umsatz 10 min")}</small><b>${fmt(p.rev10 || 0)}</b></div>
            <div><small>${t("Dividendenrendite")}</small><b>${rend == null ? "—" : rend.toFixed(1).replace(".", ",") + " %"}</b></div>
          </div>
          <div class="bankDetailKnoepfe"><button type="button" class="sfKaufen" data-bankhandeln="${p.id}">${angebote.length ? `${angebote.length} ${t("Angebote ansehen und kaufen")}` : t("Handeln: Kaufanfrage stellen")}</button>${state.rechenzentren?.websites?.[p.id]?.stufe ? `<button type="button" class="hfKarte" data-netzauf="${p.id}">🌐 ${t("Website der Firma")}</button>` : ""}</div>
        </section></div><aside class="bankRand">${anzeige}</aside></div>`, "inhaltAktie" + p.id);
      return;
    }
    const liste = firmen.filter(p => !q || rohText(p.name).toLowerCase().includes(q) || (BRANCHE_NAME[p.industry] || "").toLowerCase().includes(q))
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
    netzSetze(".netzInhalt", `<div class="bankPortal"><div class="bankHaupt"><section class="bankKarte"><div class="bankKarteKopf"><b>${q ? `${t("Suche")}: „${escapeHtml(NETZ.bankSuche)}“` : t("Alle Aktien")}</b><small>${liste.length} ${t("Firmen")} · ${t("nach Marktwert")}</small></div>
      <div class="bankTabelle"><div class="bankZeile kopf"><span>${t("Firma")}</span><span>${t("Kurs")}</span><span>${t("10 min")}</span><span>${t("Marktwert")}</span><span></span></div>
      ${liste.map(p => { const d = aend(firmHist[p.id]); return `<button type="button" class="bankZeile" data-bankaktie="${p.id}"><span class="bankZeileName">${logoHtml(p.id, "bankZeileLogo", p.color)}<span><b>${escapeHtml(rohText(p.name))}</b><small>${t(BRANCHE_NAME[p.industry] || "")}</small></span></span><b class="mono">${fk(p.kurs || 0)}</b><em class="${d >= 0 ? "auf" : "ab"}">${pz(d)}</em><span class="mono">${fmt(p.marketValue || 0)}</span><span>${firmHist[p.id] ? sparklineVon(firmHist[p.id], 60, 18) : ""}</span></button>`; }).join("") || `<div class="netzLeer">${t("Keine Aktie gefunden.")}</div>`}</div></section></div>
      <aside class="bankRand">${anzeige}</aside></div>`, "inhaltAktien" + q);
    return;
  }
  /* ---- Anleihenmarkt (anleihen.cs) ----
   * Eigene Website statt des dunklen Finanzen-Panels: Anleihen am Markt als
   * Karten (mit Zinsen bis zum Ende), eigene Anleihen und Schulden, ein
   * Formular mit Vorschau, Zwangsversteigerungen und Vertragsangebote. */
  if (NETZ.seite === "anleihen") {
    fenster.querySelector(".sfBrowser").style.setProperty("--sys", "#7c3aed");
    netzSetze(".sfUrl", "🔒 anleihen.cs", "url");
    const bonds = state.bonds || [], meinName = state.players[myId]?.name;
    const markt = bonds.filter(b => !b.holderId && b.issuerId !== myId).sort((a, b) => (b.issuerId === "__stadt") - (a.issuerId === "__stadt") || b.rate - a.rate);
    const meine = bonds.filter(b => b.holderId === myId), schulden = bonds.filter(b => b.issuerId === myId);
    const zinsen = b => Math.round(b.principal * b.rate * b.termLeft / 60);
    const summe = arr => arr.reduce((a, b) => a + b.principal, 0);
    netzSetze(".sfKopf", `<div class="sfMarke"><span class="sfLogo" style="background:#6d28d9">%</span><div><b>${t("Anleihenmarkt")}</b><small>${t("Geld leihen und verleihen — mit Zins je Minute")}</small></div></div>
      <span class="rzBadges"><span class="sfBadge">${markt.length} ${t("am Markt")}</span><span class="sfBadge">${t("angelegt")} ${fmt(summe(meine))}</span><span class="sfBadge">${t("Schulden")} ${fmt(summe(schulden))}</span></span>`, "kopfAnl" + markt.length + summe(meine) + summe(schulden));
    fenster.querySelector(".sfBanner").hidden = true;
    fenster.querySelector(".sfHinweis").hidden = true;
    const badge = r => `<span class="anlRating" style="background:${RCOL[r]}22;color:${RCOL[r]}">${r}</span>`;
    const karte = b => { const stadt = b.issuerId === "__stadt";
      return `<article class="anlKarte${stadt ? " stadt" : ""}"><div class="anlKarteKopf">${stadt ? `<span class="anlStadt">🏛</span>` : logoHtml(b.issuerId, "anlLogo", state.players[b.issuerId]?.color)}<span><b>${escapeHtml(rohText(b.issuer))}</b><small>${stadt ? t("Stadtanleihe für den Wohnbau") : t("Firmenanleihe")}</small></span>${badge(b.issuerRating)}</div>
        <div class="anlZahlen"><div><small>${t("Nennwert")}</small><b>${fmt(b.principal)}</b></div><div><small>${t("Zins")}</small><b>${(b.rate * 100).toFixed(1).replace(".", ",")} %/min</b></div><div><small>${t("Laufzeit")}</small><b>${Math.ceil(b.termLeft / 60)} min</b></div></div>
        <div class="anlErtrag">${t("Zinsen bis zum Ende")} ≈ <b>${fmt(zinsen(b))}</b>${b.strikes > 0 ? ` · <em>${t("im Verzug")}</em>` : ""}</div>
        <button type="button" class="sfKaufen" data-anlkauf="${b.id}" ${me.cash < b.principal ? "disabled" : ""}>${t("Kaufen")} · ${fmt(b.principal)}</button></article>`; };
    const zeile = (b, art) => `<div class="anlZeile"><span><b>${escapeHtml(rohText(art === "meine" ? b.issuer : (b.holder || t("noch nicht verkauft"))))}</b><small>${fmt(b.principal)} · ${(b.rate * 100).toFixed(1).replace(".", ",")} %/min · ${t("noch")} ${Math.ceil(b.termLeft / 60)} min</small></span><span class="mono ${art === "meine" ? "auf" : "ab"}">${art === "meine" ? "+" : "−"}${fmt(Math.round(b.principal * b.rate))}/min</span>${b.strikes > 0 ? `<em class="anlVerzug">${t("Verzug")}</em>` : ""}</div>`;
    const verträge = (state.contracts || []).filter(c => c.toId === myId);
    const auktionen = state.auctions || [];
    const ruhig = document.activeElement && fenster.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    const nw = NETZ.anlNenn ?? 3000, zs = NETZ.anlZins ?? 8, lz = NETZ.anlLauf ?? 3;
    if (!ruhig) netzSetze(".netzInhalt", `<div class="anlLayout"><div class="anlHaupt">
        <section class="anlBox"><div class="anlBoxKopf"><b>${t("Anleihen am Markt")}</b><small>${t("Stadtanleihen zuerst, dann nach Zins")}</small></div>
          ${markt.length ? `<div class="anlKarten">${markt.map(karte).join("")}</div>` : `<div class="netzLeer">${t("Gerade wird keine Anleihe angeboten. Ratings entstehen aus Vermögen und Schulden der Firmen.")}</div>`}</section>
        ${verträge.length ? `<section class="anlBox"><div class="anlBoxKopf"><b>${t("Vertragsangebote an dich")}</b></div>${verträge.map(c => `<div class="anlZeile"><span><b>${escapeHtml(rohText(c.from))}</b><small>${c.qty}× ${gname(c.good)} · ${fmt(c.price)}/Stk = ${fmt(c.qty * c.price)}</small></span><span class="anlKnoepfe"><button type="button" class="buyb" data-anlvertrag="${c.id}">${t("Annehmen")}</button><button type="button" class="mini" data-anlablehnen="${c.id}">${t("Ablehnen")}</button></span></div>`).join("")}</section>` : ""}
        <section class="anlBox"><div class="anlBoxKopf"><b>${t("Zwangsversteigerungen")}</b><small>${t("gepfändete Gebäude von Firmen im Verzug")}</small></div>
          ${auktionen.length ? auktionen.map(a => `<div class="anlZeile"><span><b>${bname(a.btype)}</b><small>${t("Mindestgebot")} ${fmt(a.minBid)} · ${t("Höchstgebot")} ${a.bestBid ? fmt(a.bestBid) : "—"} · ${a.tLeft}s</small></span><span class="anlKnoepfe"><input type="number" id="anlGebot-${a.id}" placeholder="${Math.max(a.minBid, (a.bestBid || 0) + 1)}"><button type="button" class="buyb" data-anlbieten="${a.id}">${t("Bieten")}</button></span></div>`).join("") : `<small class="anlLeer">${t("Keine laufenden Auktionen.")}</small>`}</section>
      </div><aside class="anlSeite">
        <section class="anlBox anlForm"><b>${t("Anleihe ausgeben")}</b><small>${t("Du bekommst den Nennwert sofort und zahlst jede Minute Zins. Am Ende zahlst du den Nennwert zurück — bei Verzug wird gepfändet.")}</small>
          <label><span>${t("Nennwert $")}</span><input id="anlNenn" type="number" min="100" step="100" value="${nw}"></label>
          <label><span>${t("Zins % je Minute")}</span><input id="anlZins" type="number" min="1" max="50" step="0.5" value="${zs}"></label>
          <label><span>${t("Laufzeit in Minuten")}</span><input id="anlLauf" type="number" min="1" step="1" value="${lz}"></label>
          <div class="anlVorschau"><span>${t("Zins je Minute")}<b>${fmt(nw * zs / 100)}</b></span><span>${t("Zinsen gesamt")}<b>${fmt(nw * zs / 100 * lz)}</b></span><span>${t("Rückzahlung am Ende")}<b>${fmt(nw)}</b></span></div>
          <button type="button" class="sfKaufen" data-anlausgeben>${t("Anleihe ausgeben")}</button></section>
        <section class="anlBox"><b>${t("Deine Anlagen")}</b>${meine.map(b => zeile(b, "meine")).join("") || `<small class="anlLeer">${t("Du hältst keine Anleihen.")}</small>`}</section>
        <section class="anlBox"><b>${t("Deine Schulden")}</b>${schulden.map(b => zeile(b, "schuld")).join("") || `<small class="anlLeer">${t("Keine eigenen Anleihen offen.")}</small>`}</section>
      </aside></div>`, "inhaltAnl");
    netzSetze(".sfFuss", `<span class="sfFussLogo">%</span><span>${t("Der Anleihenmarkt wird von der Stadt betrieben · Firmenanteile handelst du auf bank.cs")}</span>`, "fussAnl");
    return;
  }
  /* ---- Stadtkurier ---- */
  if (NETZ.seite === "kurier") {
    KURIER.gelesen = Math.max(KURIER.gelesen, (state.news || [])[0]?.ts || 0);
    fenster.querySelector(".sfBrowser").style.setProperty("--sys", "#111827");
    const offen = NETZ.artikel && artikel.find(a => a.id === NETZ.artikel);
    netzSetze(".sfUrl", `🔒 kurier.cs${offen ? "/" + offen.id : ""}`, "url");
    const ausgabe = (state.news || []).length ? `${t("Ausgabe")} ${KURIER.nr(state)} · ${t("Minute")} ${state.news[0].min}` : t("Erste Ausgabe nach zwei Minuten");
    netzSetze(".sfKopf", `<b class="netzZeitungTitel">${t("Stadtkurier")}</b><small>${ausgabe} · ${t("betrieben von der Stadt")} · ${state.stadt.einwohner.toLocaleString("de-DE")} ${t("Einwohner")}</small>`, "kopfKurier" + ausgabe);
    fenster.querySelector(".sfBanner").hidden = true;
    fenster.querySelector(".sfHinweis").hidden = true;
    const sicht = artikel.filter(a => NETZ.ressort === "alle" || a.ressort === NETZ.ressort || (NETZ.ressort === "Firmen" && a.ressort === "Eilmeldung"));
    const reiter = [["alle", "Alle"], ["Wirtschaft", "Wirtschaft"], ["Börse", "Börse"], ["Stadt", "Stadt"], ["Firmen", "Firmen"]]
      .map(([k, n]) => `<button type="button" class="${NETZ.ressort === k ? "on" : ""}" data-kurierressort="${k}">${t(n)}</button>`).join("");
    const marke = a => `<span class="kurierRessort r-${a.ressort === "Börse" ? "boerse" : a.ressort.toLowerCase()}">${t(a.ressort)}</span>`;
    const link = a => a.link ? `<button type="button" class="sfKaufen" data-kurierlink="${a.link[0]}:${a.link[1] ?? ""}">${t(a.link[2])}</button>` : "";
    let haupt;
    if (offen) haupt = `<article class="kurierArtikel">${marke(offen)}<h2>${escapeHtml(rohText(offen.titel))}</h2><small>${offen.zeit}</small>
        ${offen.absaetze.map(x => `<p>${escapeHtml(rohText(x))}</p>`).join("")}
        <div class="kurierKnoepfe">${link(offen)}<button type="button" class="hfKarte" data-kurierauf="">${t("Zurück zur Übersicht")}</button></div></article>`;
    else if (!sicht.length) haupt = `<div class="netzLeer">${t("In diesem Ressort gibt es noch nichts Neues.")}</div>`;
    else { const auf = sicht.find(a => a.ressort === "Wirtschaft") || sicht[0], rest = sicht.filter(a => a !== auf);   // Aufmacher: der aktuelle Marktbericht
      haupt = `<button type="button" class="kurierAufmacher" data-kurierauf="${auf.id}"><span class="kurierBild r-${auf.ressort === "Börse" ? "boerse" : auf.ressort.toLowerCase()}"><svg width="96" height="64" viewBox="0 0 96 64" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 56 L28 30 L44 42 L66 14 L90 30"></path><path d="M78 14 H90 V26"></path></svg></span>
          <span class="kurierAufText">${marke(auf)}<b>${escapeHtml(rohText(auf.titel))}</b><span>${escapeHtml(rohText(auf.anriss))}</span><small>${auf.zeit}</small></span></button>
        <div class="kurierListe">${rest.slice(0, 12).map(a => `<button type="button" class="kurierKarte" data-kurierauf="${a.id}">${marke(a)}<b>${escapeHtml(rohText(a.titel))}</b><span>${escapeHtml(rohText(a.anriss))}</span><small>${a.zeit}</small></button>`).join("")}</div>`; }
    const kurse = KURIER.veraenderung(state);
    const anz = (state.anzeigen || [])[0];
    const archiv = (state.news || []).map((b, i) => `<button type="button" class="kurierArchiv" data-kurierauf="markt-${b.min}"><span>${t("Ausgabe")} ${KURIER.nr(state) - i}</span><small class="mono">${t("Minute")} ${b.min}</small></button>`).join("");
    netzSetze(".netzInhalt", `<nav class="kurierReiter">${reiter}</nav>
      <div class="netzSpalten"><div class="netzHaupt">${haupt}</div><aside class="netzSeite">
        <section class="netzBox"><b>${t("Kurse in 2 Minuten")}</b>${kurse.length ? kurse.map(k => `<span class="kurierKurs"><span>${gname(k.g)}</span><b class="mono ${k.d >= 0 ? "auf" : "ab"}">${k.d >= 0 ? "+" : "−"}${Math.abs(k.d)} %</b></span>`).join("") : `<small>${t("Noch zu früh — die Kurse vergleicht der Kurier nach zwei Minuten.")}</small>`}</section>
        ${anz ? `<button type="button" class="netzBox netzAnzeige" data-netzauf="${anz.firmaId}"><small>${t("ANZEIGE")}</small><b>${escapeHtml(rohText(anz.firma))}</b><span>${escapeHtml(rohText(anz.text))}</span></button>` : ""}
        ${archiv ? `<section class="netzBox"><b>${t("Archiv")}</b>${archiv}</section>` : ""}
      </aside></div>`, "inhaltKurier");
    netzSetze(".sfFuss", `<span class="sfFussLogo">📰</span><span>${t("Stadtkurier · erscheint alle zwei Minuten · Anzeigen aus dem Werbenetz")}</span>`, "fussKurier");
    return;
  }
  /* ---- Seite einer Firma ---- */
  const pid = NETZ.seite, p = state.players[pid], w = W[pid];
  if (!p) return netzOeffnen(null);
  const meins = pid === myId, B = BTYPES(), ind = p.industry;
  const anbieter = w && (w.anbieter === "stadtportal" ? null : (state.website || []).find(x => x.id === w.anbieter));
  fenster.querySelector(".sfBrowser").style.setProperty("--sys", p.color || "#0f766e");
  netzSetze(".sfUrl", `🔒 ${shopSlug(p.name)}.cs`, "url" + pid);
  kopfEl.style.display = w?.stufe ? "none" : "";   // mit Website zeigt der Hero der Seite Name und Logo
  if (w?.design) sfSchriftenLaden();   // Vorlagen und Schriften brauchen die Shop-Schriften
  netzSetze(".sfKopf", `<div class="sfMarke">${logoHtml(pid, "sfLogo", p.color)}<div><b>${escapeHtml(rohText(p.name))}</b><small>${t(BRANCHE_NAME[ind] || "")}${w ? ` · ${t(cfg?.MODULE[w.modul]?.name || "")}` : ""}</small></div></div>
    <span class="rzBadges">${w ? `<span class="sfBadge">${w.besucher} ${t("Besucher/min")}</span><span class="sfBadge">+${Math.round((w.bonus || 0) * 100)} % ${t("Reichweite")}</span>` : `<span class="sfBadge">${t("keine Website")}</span>`}</span>`, "kopf" + pid + (logoBild(pid) || "").length);
  const banner = fenster.querySelector(".sfBanner");
  banner.hidden = !w?.aktion;
  netzSetze(".sfBanner", w?.aktion ? `<b>⚡</b><span>${t(w.aktion.name)} — ${t("noch")} ${Math.floor(w.aktion.rest / 60)}:${String(w.aktion.rest % 60).padStart(2, "0")} · +${Math.round((state.rechenzentren.aktion?.boost || .25) * 100)} % ${t("Reichweite")}</span>` : "", "banner" + pid);
  fenster.querySelector(".sfHinweis").hidden = !meins;
  netzSetze(".sfHinweis", t("Deine Website: So sehen Kunden und Mitspieler deine Firma im Stadtnetz."), "hinweis");
  if (!w?.stufe) {
    netzSetze(".netzInhalt", `<div class="sfLeer">${w ? `⚠ ${t("Die Website ist gerade offline — dem Rechenzentrum des Anbieters fehlt Strom oder Platz.")}` : meins ? t("Du hast noch keine Website. Software-Firmen bauen sie dir — oder das Stadtportal die Grundseite.") : `${escapeHtml(rohText(p.name))} ${t("hat noch keine Website.")}`}</div>
      ${meins && !w ? `<div class="netzMitte"><button type="button" class="sfKaufen" data-netzanbieter>${t("Anbieter vergleichen")}</button></div>` : ""}`, "leer" + pid + !!w);
    netzSetze(".sfFuss", "", "fuss" + pid);
    return;
  }
  /* Inhalt nach dem Design der Software-Firma (firmenSeiteHtml) */
  const auftrag = w.auftrag?.status === "offen" ? w.auftrag : null;
  let eigenes = "";
  if (meins && w.stufe < 2) eigenes += `<section class="rzBox"><b>${t(state.rechenzentren?.portale?.[ind]?.name || "Branchenportal")}</b><small>${t("Mit dem Modul „Branchenportal“ wird deine Website zum Laden: Mitspieler kaufen direkt bei dir, Rohstoff und Rüstung bekommen Auftrags-Boni.")}</small>
      ${anbieter ? `<button type="button" class="sfKaufen" data-rzauf="${anbieter.ownerId}" data-rzreiterziel="websites">${t("Modul wechseln bei")} ${escapeHtml(rohText(anbieter.name))}</button>` : `<button type="button" class="sfKaufen" data-netzanbieter>${t("Anbieter vergleichen")}</button>`}</section>`;
  const A = state.rechenzentren?.aktion;
  if (meins) eigenes += w.stufe >= 3 ? `<section class="rzBox"><div class="rzBoxKopf"><b>⚡ ${t(A?.namen?.[ind] || "Aktion")}</b><small>${Math.round((A?.boost || .25) * 100)} % ${t("mehr Reichweite für")} ${(A?.dauer || 300) / 60} min · ${fmt(A?.kosten || 600)}</small></div>
      ${w.aktion ? `<div class="sfEigen">${t("Läuft")} · ${t("noch")} ${Math.ceil(w.aktion.rest / 60)} min</div>` : w.aktionPause ? `<div class="sfEigen">${t("Nächste Aktion in")} ${Math.ceil(w.aktionPause / 60)} min</div>`
        : `<button type="button" class="sfKaufen" data-netzaktion ${me.cash < (A?.kosten || 600) ? "disabled" : ""}>${t("Aktion starten")} · ${fmt(A?.kosten || 600)}</button>`}</section>`
    : `<section class="rzBox"><b>⚡ ${t("Aktionen")}</b><small>${t("Ab Website-Modul „Aktionen“ (v3): 5 Minuten +25 % Reichweite.")}</small></section>`;
  netzSetze(".netzInhalt", `${auftrag ? `<div class="fwBau">🛠 ${anbieter ? `${escapeHtml(rohText(anbieter.anbieter))} ${t("gestaltet diese Website gerade")}` : t("Diese Website wird gerade gestaltet")} · ${t("noch")} ${Math.floor(auftrag.rest / 60)}:${String(auftrag.rest % 60).padStart(2, "0")}</div>` : ""}
    ${firmenSeiteHtml(state, me, myId, pid, null)}${eigenes ? `<div class="fwEigenes">${eigenes}</div>` : ""}`, "inhalt" + pid);
  netzSetze(".sfFuss", anbieter ? `${logoHtml(anbieter.ownerId, "sfFussLogo", anbieter.farbe)}<span>${t("Website von")} <b>${escapeHtml(rohText(anbieter.name))}</b> · ${escapeHtml(rohText(anbieter.anbieter))}</span>` : `<span class="sfFussLogo">🏛</span><span>${t("Grundseite vom Stadtportal")}</span>`, "fuss" + pid);
}
document.getElementById("netzFenster").addEventListener("input", e => {
  if (e.target.id === "netzSuche") { NETZ.suche = e.target.value; netzZeichnen(); }
  if (["anlNenn", "anlZins", "anlLauf"].includes(e.target.id)) { const k = { anlNenn: "anlNenn", anlZins: "anlZins", anlLauf: "anlLauf" }[e.target.id]; NETZ[k] = +e.target.value || 0;
    const v = document.querySelector("#netzFenster .anlVorschau"); if (v) { const nw = NETZ.anlNenn ?? 3000, zs = NETZ.anlZins ?? 8, lz = NETZ.anlLauf ?? 3; const b = v.querySelectorAll("b"); b[0].textContent = fmt(nw * zs / 100); b[1].textContent = fmt(nw * zs / 100 * lz); b[2].textContent = fmt(nw); } }
  if (e.target.id === "bankSuche") { NETZ.bankSuche = e.target.value; NETZ.bankTab = "aktien"; NETZ.bankAktie = null; netzZeichnen(); }
  if (e.target.id === "bwMenge") { NETZ.bwMenge = Math.max(1, Math.floor(+e.target.value) || 1); NETZ.sig.haupt = null; }
  if (e.target.id === "bwPreis") NETZ.bwPreis = +e.target.value || null;
  const n = e.target.closest?.("[data-netzn]"); if (n) NETZ.menge[n.dataset.netzn] = Math.max(1, Math.floor(+n.value) || 1);
});
document.getElementById("netzFenster").addEventListener("click", e => {
  if (e.target.closest("[data-netzzu]") || e.target.id === "netzFenster") return netzSchliessen();
  if (e.target.closest("[data-netzzurueck]")) { if (NETZ.seite === "kurier" && NETZ.artikel) { NETZ.artikel = null; NETZ.sig = {}; return netzZeichnen(); } return netzOeffnen(null); }
  /* Anleihenmarkt */
  const ak = e.target.closest("[data-anlkauf]");
  if (ak) return act("buyBond", { bondId: +ak.dataset.anlkauf });
  const av = e.target.closest("[data-anlvertrag]");
  if (av) return act("acceptContract", { contractId: +av.dataset.anlvertrag });
  const aa = e.target.closest("[data-anlablehnen]");
  if (aa) return act("declineContract", { contractId: +aa.dataset.anlablehnen });
  const ab = e.target.closest("[data-anlbieten]");
  if (ab) return act("bid", { auctionId: +ab.dataset.anlbieten, amount: document.getElementById("anlGebot-" + ab.dataset.anlbieten)?.value });
  if (e.target.closest("[data-anlausgeben]")) {
    const nenn = +document.getElementById("anlNenn")?.value, zins = +document.getElementById("anlZins")?.value, lauf = +document.getElementById("anlLauf")?.value;
    if (!(nenn > 0 && zins > 0 && lauf > 0)) return toast(t("Nennwert, Zins und Laufzeit eingeben"), true);
    return act("issueBond", { principal: nenn, rate: zins / 100, term: Math.round(lauf * 60) });
  }
  /* Stadtbank-Portal */
  const btab = e.target.closest("[data-banktab]");
  if (btab) { NETZ.bankTab = btab.dataset.banktab; if (NETZ.bankTab === "aktien") NETZ.bankAktie = null; NETZ.sig = {}; return netzZeichnen(); }
  const bwahl = e.target.closest("[data-bankwahl]");
  if (bwahl) { NETZ.bankWahl = bwahl.dataset.bankwahl; return netzZeichnen(); }
  const bak = e.target.closest("[data-bankaktie]");
  if (bak) { NETZ.bankTab = "aktien"; NETZ.bankAktie = bak.dataset.bankaktie || null; NETZ.sig = {}; return netzZeichnen(); }
  const bh = e.target.closest("[data-bankhandeln]");
  if (bh) { firmenAuf.add(bh.dataset.bankhandeln); BANK_REITER = "markt"; bankReiterZeigen(); NETZ.bankTab = "handeln"; NETZ.sig = {}; return netzZeichnen(); }
  const na = e.target.closest("[data-netzaktie]");
  if (na) { NETZ.bankTab = "aktien"; NETZ.bankAktie = na.dataset.netzaktie; return netzOeffnen("bank"); }
  const bw = e.target.closest("[data-boersewahl]");
  if (bw) { NETZ.ware = bw.dataset.boersewahl; NETZ.bwPreis = null; return netzZeichnen(); }
  const bs = e.target.closest("[data-bwseite]");
  if (bs) { NETZ.bwSeite = bs.dataset.bwseite; return netzZeichnen(); }
  const bt = e.target.closest("[data-bwtake]");
  if (bt) return socket.emit("takeOrder", { orderId: +bt.dataset.bwtake, qty: +bt.dataset.bwn || 10 }, r => { if (r?.error) return toast(r.error, true); SFX.spiel("kasse"); render(store.get()); });
  const bst = e.target.closest("[data-bwstorno]");
  if (bst) return act("cancelOrder", { orderId: +bst.dataset.bwstorno });
  if (e.target.closest("[data-bwsenden]")) {
    const qty = Math.floor(+document.getElementById("bwMenge")?.value || 0), price = +document.getElementById("bwPreis")?.value || 0;
    if (!(qty > 0) || !(price > 0)) return toast(t("Menge und Preis eingeben"), true);
    return socket.emit("placeOrder", { side: NETZ.bwSeite || "buy", good: NETZ.ware, qty, price }, r => { if (r?.error) return toast(r.error, true); toast(t("Order platziert")); NETZ.bwPreis = null; render(store.get()); });
  }
  const kat = e.target.closest("[data-netzkat]");
  if (kat) { NETZ.kat = kat.dataset.netzkat; return netzZeichnen(); }
  const ka = e.target.closest("[data-kurierauf]");
  if (ka) { NETZ.artikel = ka.dataset.kurierauf || null; if (NETZ.seite !== "kurier") return netzOeffnen("kurier"); NETZ.sig = {}; return netzZeichnen(); }
  const kr = e.target.closest("[data-kurierressort]");
  if (kr) { NETZ.ressort = kr.dataset.kurierressort; NETZ.artikel = null; return netzZeichnen(); }
  const kl = e.target.closest("[data-kurierlink]");
  if (kl) { const [art, wert] = kl.dataset.kurierlink.split(":");
    if (art === "firma") return netzOeffnen(wert);
    netzSchliessen();
    if (art === "hotel") return hotelOeffnen(wert);
    if (art === "panel") return openPanel(wert);
    return; }
  const auf = e.target.closest("[data-netzauf]");
  if (auf) { const pid = auf.dataset.netzauf, ind = store.get().state.players?.[pid]?.industry; if (ind === "touristik" || (ind === "software" && !store.get().state.rechenzentren?.websites?.[pid])) netzSchliessen(); return netzOeffnen(pid); }
  const rz = e.target.closest("[data-rzauf]");
  if (rz) { netzSchliessen(); return rzOeffnen(rz.dataset.rzauf, rz.dataset.rzreiterziel); }
  if (e.target.closest("[data-netzanbieter]")) { netzSchliessen(); SW_REITER = "markt"; return openPanel("software"); }
  const pn = e.target.closest("[data-netzpanel]");
  if (pn) { netzSchliessen(); return openPanel(pn.dataset.netzpanel); }
  /* Online-Shop direkt öffnen — der Handler für data-shopauf hängt nur am Firma-Panel */
  const sa = e.target.closest("[data-shopauf]");
  if (sa) { const [x, y] = sa.dataset.shopauf.split(",").map(Number); netzSchliessen(); return shopOeffnen(x, y); }
  const m = e.target.closest("[data-netzm]");
  if (m) { const g = m.dataset.netzm, inp = document.querySelector(`#netzFenster [data-netzn="${g}"]`); const v = Math.max(1, Math.min(+inp.max || 1, (+inp.value || 1) + +m.dataset.d)); inp.value = v; NETZ.menge[g] = v; NETZ.sig.inhalt = null; return netzZeichnen(); }
  const k = e.target.closest("[data-netzkauf]");
  if (k) { const g = k.dataset.netzkauf, qty = NETZ.menge[g] || +document.querySelector(`#netzFenster [data-netzn="${g}"]`)?.value || 10;
    return socket.emit("direktKaufen", { firmaId: NETZ.seite, good: g, qty }, r => { if (r?.error) return toast(r.error, true); toast(`${r.qty}× ${gname(g)} ${t("gekauft")} · ${fmt(r.summe)}`); render(store.get()); }); }
  if (e.target.closest("[data-netzaktion]")) return socket.emit("webAktionStarten", {}, r => { if (r?.error) return toast(r.error, true); toast(`⚡ ${t(r.name)} ${t("läuft")}`); render(store.get()); });
});
/* ---- Software-Panel: Reiter, Überblick, Bürger-App und Jobbörse (Etappe 5) ---- */
let SW_REITER = (() => { try { return localStorage.getItem("cs_swReiter") || "uebersicht"; } catch { return "uebersicht"; } })();
const appEntwurf = {}, jobEntwurf = {};
/* Einnahmen aller eigenen Produkte auf einen Blick, über den Reitern */
/* Cockpit für Software-Firmen: alles Wichtige auf einen Blick — wie im
 * Touristik-Panel. Kennzahlen, offene Website-Aufträge mit Frist, je Produkt
 * Stand und der nächste Schritt, dazu Hinweise, was gerade fehlt. */
function swCockpit(state, me, myId, eigene) {
  const eig = arr => (arr || []).find(x => x.ownerId === myId);
  const app = eig(state.buergerApp), job = eig(state.jobboerse), ba = eig(state.boerseApp), mp = eig(state.paint), web = eig(state.website);
  const B = BTYPES(), racks = state.map.filter(x => x.owner === myId && B[x.btype]?.rz);
  const am = racks.filter(x => !(x.bauBis > state.tick));
  const stromJeMin = am.reduce((a, x) => a + B[x.btype].rz.in.strom * rzLvl(x.level) * 60, 0);
  const stromMin = stromJeMin ? Math.floor((me.inv?.strom || 0) / stromJeMin) : Infinity;
  const summe = [eigene, app, job, ba, web].reduce((a, x) => a + (x?.einnahmen10 || 0), 0);
  const kunden = (eigene?.kunden || 0) + (app?.nutzer || 0) + (job?.abonnenten || 0) + (web?.kunden || 0);
  const dev = [eigene, app, job, ba, web, mp].find(x => x?.entwicklung);
  const auftraege = (web?.liste || []).filter(k => k.auftrag === "offen").sort((a, b) => a.rest - b.rest);
  const zeit = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  /* Was jetzt? — die dringendsten Punkte zuerst */
  const tipps = [];
  if (!eigene) tipps.push(["🚀", t("Leg dein Shop-System an — damit fängt alles an."), "system", t("Mein System")]);
  if (state.stadt && !racks.length) tipps.push(["🏢", t("Bau ein Rechenzentrum: Ohne Plätze kann niemand dein System, deine App oder Websites nutzen."), null, null]);
  if (racks.length && stromMin < 6) tipps.push(["⚡", `${t("Strom wird knapp")}: ${t("noch")} ${stromMin} min. ${t("Fällt er aus, gehen alle Kunden offline.")}`, "rz", t("Statusseite")]);
  if (auftraege.length) tipps.push(["🛠", `${auftraege.length} ${t(auftraege.length === 1 ? "Firma wartet auf ihre Website." : "Firmen warten auf ihre Website.")}`, null, null]);
  if (eigene?.version >= 1 && eigene.plaetze && eigene.kunden >= eigene.plaetze) tipps.push(["📦", t("Dein Shop-System ist voll — mehr Plätze gibt es mit einem Rechenzentrums-Ausbau."), "rz", t("Statusseite")]);
  if (eigene && !dev) tipps.push(["🧪", t("Gerade läuft keine Entwicklung — deine EP sammeln sich nur an."), "entwicklung", t("Entwicklung")]);
  if (eigene?.version >= 1 && !web) tipps.push(["🌐", t("Leg einen Website-Baukasten an: Firmen bestellen Websites, du gestaltest sie und kassierst das Honorar."), "rz", t("Statusseite")]);
  /* Produkt-Kacheln: Stand, Kennzahl, nächster Schritt */
  const produkt = (icon, name, x, zahl, ziel, ab = true) => `<button type="button" class="swcProdukt${x?.version >= 1 ? " an" : ""}" ${ziel === "rz" ? `data-rzauf="${myId}"` : `data-swreiter="${ziel}"`} ${ab ? "" : "disabled"}>
    <span class="swcIcon">${icon}</span><b>${t(name)}</b><em>${x ? (x.version >= 1 ? "v" + x.version : t("in Arbeit")) : t("noch nicht")}</em><small>${x ? zahl : t(ab ? "anlegen →" : "später")}</small></button>`;
  return `<div class="swCockpit">
    <div class="swcZahlen">
      <div><span>${t("Einnahmen 10 min")}</span><b style="color:var(--up)">${fmt(summe)}</b></div>
      <div><span>${t("Kunden gesamt")}</span><b>${kunden}</b></div>
      <div><span>${t("EP-Vorrat")}</span><b>${me.swEp || 0}</b><small>${dev ? `${escapeHtml(rohText(dev.name))} v${dev.entwicklung.version}: ${Math.round(dev.entwicklung.ep / dev.entwicklung.ziel * 100)} %` : t("keine Entwicklung")}</small></div>
      ${state.stadt ? `<div><span>${t("Rechenzentren")}</span><b>${am.length}${racks.length > am.length ? ` <small>+${racks.length - am.length} ${t("im Bau")}</small>` : ""}</b><small class="${stromMin < 6 ? "swcWarn" : ""}">${racks.length ? (stromMin === Infinity ? "—" : `⚡ ${stromMin} min ${t("Strom")}`) : t("keins")}</small></div>` : ""}
    </div>
    ${state.stadt ? `<section class="swcBox"><div class="swcBoxKopf"><b>🛠 ${t("Website-Aufträge")}</b><small>${web ? `${escapeHtml(rohText(web.name))} v${web.version} · ${web.kunden}/${web.plaetze} ${t("Kunden")}` : t("noch kein Website-Baukasten")}</small></div>
      ${auftraege.length ? `<div class="swcAuftraege">${auftraege.map(k => { const p = state.players[k.id];
        return `<div class="swcAuftrag"><span class="swName"><i style="background:${p?.color || "#64748b"}"></i><span><b>${escapeHtml(rohText(k.name))}</b><small>${t(BRANCHE_NAME[p?.industry] || "")} · ${t(state.websiteCfg?.MODULE[k.modul]?.name || "")}</small></span></span>
          <span class="mono swcFrist${k.rest < 60 ? " knapp" : ""}">⏱ ${zeit(k.rest)}</span><b class="mono">+${fmt(k.honorar)}</b><button type="button" class="buyb" data-genauf="${k.id}">${t("Gestalten")}</button></div>`; }).join("")}</div>
        <small class="swcFuss">${t("Läuft die Frist ab, geht die Standard-Vorlage online und du bekommst nur das halbe Honorar.")}</small>`
      : `<small class="swcLeer">${web ? t("Gerade kein offener Auftrag. Neue Bestellungen erscheinen hier — mit Frist und Honorar.") : t("Mit einem Website-Baukasten (auf deiner Statusseite) bestellen Firmen bei dir Websites, die du selbst gestaltest.")}</small>`}
      ${(web?.liste || []).some(k => k.auftrag !== "offen") ? `<div class="swcKunden">${web.liste.filter(k => k.auftrag !== "offen").map(k => `<button type="button" data-genauf="${k.id}" title="${t("Website überarbeiten")}">${escapeHtml(rohText(k.name))} <span class="mono">${Math.round((k.qualitaet || 0) * 100)} %</span></button>`).join("")}</div>` : ""}
    </section>` : ""}
    <div class="swcProdukte">
      ${produkt("🛒", "Shop-System", eigene, `${eigene?.kunden || 0}/${eigene?.plaetze ?? 0} ${t("Kunden")} · ${fmt(eigene?.einnahmen10 || 0)}`, eigene ? "system" : "system")}
      ${state.stadt ? produkt("🌐", "Website-Baukasten", web, `${web?.kunden || 0} ${t("Kunden")} · ${fmt(web?.einnahmen10 || 0)}`, "rz", !!eigene) : ""}
      ${state.stadt ? produkt("📱", "Bürger-App", app, `${app?.nutzer || 0} ${t("Nutzer")} · ${fmt(app?.einnahmen10 || 0)}`, "produkte", !!eigene) : ""}
      ${state.stadt ? produkt("👷", "Jobbörse", job, `${job?.abonnenten || 0} ${t("Abos")} · ${fmt(job?.einnahmen10 || 0)}`, "produkte", !!eigene) : ""}
      ${produkt("📈", "Börsen-App", ba, fmt(ba?.einnahmen10 || 0), "produkte", !!eigene)}
      ${produkt("🎨", "Malprogramm", mp, `${mp?.verkauft ?? 0} ${t("verkauft")}`, "produkte", !!eigene)}
    </div>
    ${tipps.length ? `<section class="swcBox"><div class="swcBoxKopf"><b>💡 ${t("Was jetzt?")}</b></div><div class="swcTipps">${tipps.slice(0, 4).map(([i, txt, ziel, knopf]) => `<div class="swcTipp"><span>${i}</span><p>${txt}</p>${ziel ? `<button type="button" class="swcKnopf" ${ziel === "rz" ? `data-rzauf="${myId}"` : `data-swreiter="${ziel}"`}>${knopf} →</button>` : ""}</div>`).join("")}</div></section>` : ""}
    ${state.stadt ? `<div class="swcLinks"><button type="button" class="swcKnopf" data-rzauf="${myId}">🌐 ${t("Meine Statusseite")}</button><button type="button" class="swcKnopf" data-swnetz>🔎 ${t("Stadtnetz")}</button></div>` : ""}
  </div>`;
}
function swUeberblick(state, me, myId, eigene) {
  const eig = arr => (arr || []).find(x => x.ownerId === myId);
  const app = eig(state.buergerApp), job = eig(state.jobboerse), ba = eig(state.boerseApp), mp = eig(state.paint);
  const kachel = (name, x, wert) => `<div title="${name}"><span>${name}</span><b>${x ? (x.version >= 1 ? "v" + x.version : "in Arbeit") : "—"}</b><small>${x ? wert : t("fehlt")}</small></div>`;
  return `<div class="swUeberblick">
    ${kachel(t("Shop-System"), eigene, `${fmt(eigene?.einnahmen10 || 0)} / 10 min`)}
    ${state.stadt ? kachel(t("Bürger-App"), app, `${app?.nutzer || 0} ${t("Nutzer")} · ${fmt(app?.einnahmen10 || 0)}`) : ""}
    ${state.stadt ? kachel(t("Jobbörse"), job, `${job?.abonnenten || 0} ${t("Abos")} · ${fmt(job?.einnahmen10 || 0)}`) : ""}
    ${kachel(t("Börsen-App"), ba, fmt(ba?.einnahmen10 || 0))}
    ${kachel(t("Malprogramm"), mp, `${mp?.verkauft ?? 0} ${t("verkauft")}`)}
    <div><span>${t("EP-Vorrat")}</span><b>${me.swEp || 0}</b><small>${t("ein Studio: 1 EP/s")}</small></div>
  </div>`;
}
/* Eigene Bürger-App anlegen, bepreisen, entwickeln */
function buergerAppHtml(state, me, eigene) {
  const cfg = state.buergerAppCfg, app = (state.buergerApp || []).find(x => x.ownerId === eigene.ownerId);
  if (!state.stadt || !cfg) return "";
  const kopf = `<div class="sec">${t("Bürger-App")} · ${t("Software für die Einwohner")}</div>`;
  if ((eigene.version || 0) < cfg.AB_SYSTEM) return kopf + `<div class="note">${t("Ab Shop-System v")}${cfg.AB_SYSTEM}.</div>`;
  const e = { name: app?.name ?? "", preis: app?.preis ?? cfg.PREIS_START, ...appEntwurf };
  const st = v => cfg.STUFEN[v - 1], text = s2 => `${t("bis")} ${Math.round(s2.quote * 100)} % ${t("der Einwohner nutzen Apps")} · ${t("Qualität")} ×${String(s2.quali).replace(".", ",")}`;
  const dev = app?.entwicklung, naechste = st((app?.version || 0) + 1);
  return kopf + `<div class="note" style="margin:0 0 8px">${t("Einwohner zahlen ein Abo je Minute. Sie wählen nach Qualität und Preis. Je Rechenzentrums-Stufe bedienst du")} ${cfg.NUTZER_JE_STUFE} ${t("Nutzer")}.</div>
    ${app ? `<div class="swZahlen">
      <div><b>${app.version >= 1 ? "v" + app.version : "—"}</b><span>${t("Version")}</span></div>
      <div><b>${app.nutzer} / ${app.kapazitaet}</b><span>${t("Nutzer / Kapazität")}</span></div>
      <div><b>${app.wunsch}</b><span>${t("würden sie nutzen")}</span></div>
      <div><b style="color:var(--up)">${fmt(app.einnahmen10)}</b><span>${t("Einnahmen 10 min")}</span></div></div>
      ${app.version >= 1 && app.wunsch > app.kapazitaet ? `<div class="mpWarn">⚠ ${app.wunsch - app.kapazitaet} ${t("Nutzer finden keinen Platz — ein weiteres Rechenzentrum oder ein Ausbau hilft.")}</div>` : ""}` : ""}
    <div class="swForm">
      <label class="breit"><span>${t("Name")}</span><input id="appName" maxlength="20" value="${escapeHtml(rohText(e.name))}" placeholder="z. B. StadtChat"></label>
      <label><span>${t("Abo $ je Nutzer und Minute")}</span><input id="appPreis" type="number" min="${cfg.PREIS_MIN}" max="${cfg.PREIS_MAX}" step="0.01" value="${e.preis}"></label>
      <button class="buyb" id="appSpeichern">${app ? t("Übernehmen") : t("Bürger-App anlegen")}</button>
    </div>
    ${app ? (dev ? `<div class="swDev"><div class="swDevKopf"><span>${escapeHtml(rohText(app.name))} v${dev.version} ${t("in Arbeit")}</span><b class="mono">${dev.ep} / ${dev.ziel} EP</b></div>
        <div class="swBalken"><i style="width:${Math.min(100, dev.ep / dev.ziel * 100).toFixed(1)}%"></i></div></div>`
      : naechste ? `<button class="tmHaupt" id="appEntwickeln"><span>${escapeHtml(rohText(app.name))} v${(app.version || 0) + 1} ${t("entwickeln")}</span><small>${naechste.ep} EP · ${text(naechste)}</small></button>`
      : `<div class="note">${t("Voll ausgebaut")}: ${text(st(cfg.STUFEN.length))}.</div>`) : ""}`;
}
/* Eigene Jobbörse anlegen, bepreisen, entwickeln */
function jobboerseHtml(state, me, eigene) {
  const cfg = state.jobboerseCfg, job = (state.jobboerse || []).find(x => x.ownerId === eigene.ownerId);
  if (!state.stadt || !cfg) return "";
  const kopf = `<div class="sec" style="margin-top:16px">${t("Jobbörse")} · ${t("Software gegen Arbeitermangel")}</div>`;
  if ((eigene.version || 0) < cfg.AB_SYSTEM) return kopf + `<div class="note">${t("Ab Shop-System v")}${cfg.AB_SYSTEM}.</div>`;
  const e = { name: job?.name ?? "", gebuehr: job?.gebuehr ?? cfg.GEB_START, ...jobEntwurf };
  const text = s2 => `${t("Vorrang wie")} +${String(s2.vorrang).replace(".", ",")} ${t("Lohnstufen")}`;
  const dev = job?.entwicklung, naechste = cfg.STUFEN[(job?.version || 0)];
  return kopf + `<div class="note" style="margin:0 0 8px">${t("Firmen abonnieren sie und bekommen bei knappen Arbeitern Vorrang. Sie zahlen dir eine Gebühr je beschäftigtem Arbeiter und Minute. Für dich selbst wirkt sie kostenlos. Je Rechenzentrums-Stufe")} ${cfg.ABOS_JE_STUFE} ${t("Abos")}.</div>
    ${job ? `<div class="swZahlen">
      <div><b>${job.version >= 1 ? "v" + job.version : "—"}</b><span>${t("Version")}</span></div>
      <div><b>${job.abonnenten} / ${job.plaetze}</b><span>${t("Abos / Plätze")}</span></div>
      <div><b>+${String(job.vorrang).replace(".", ",")}</b><span>${t("Vorrang")}</span></div>
      <div><b style="color:var(--up)">${fmt(job.einnahmen10)}</b><span>${t("Einnahmen 10 min")}</span></div></div>` : ""}
    <div class="swForm">
      <label class="breit"><span>${t("Name")}</span><input id="jobName" maxlength="20" value="${escapeHtml(rohText(e.name))}" placeholder="z. B. StadtJobs"></label>
      <label><span>${t("Gebühr $ je Arbeiter und Minute")}</span><input id="jobGeb" type="number" min="${cfg.GEB_MIN}" max="${cfg.GEB_MAX}" step="0.05" value="${e.gebuehr}"></label>
      <button class="buyb" id="jobSpeichern">${job ? t("Übernehmen") : t("Jobbörse anlegen")}</button>
    </div>
    ${job ? (dev ? `<div class="swDev"><div class="swDevKopf"><span>${escapeHtml(rohText(job.name))} v${dev.version} ${t("in Arbeit")}</span><b class="mono">${dev.ep} / ${dev.ziel} EP</b></div>
        <div class="swBalken"><i style="width:${Math.min(100, dev.ep / dev.ziel * 100).toFixed(1)}%"></i></div></div>`
      : naechste ? `<button class="tmHaupt" id="jobEntwickeln"><span>${escapeHtml(rohText(job.name))} v${(job.version || 0) + 1} ${t("entwickeln")}</span><small>${naechste.ep} EP · ${text(naechste)}</small></button>`
      : `<div class="note">${t("Voll ausgebaut")}: ${text(cfg.STUFEN[cfg.STUFEN.length - 1])}.</div>`) : ""}`;
}
/* Markt-Reiter: alle Bürger-Apps und Jobbörsen der Stadt, Jobbörse abonnieren */
/* Rechenzentren der Stadt und die eigene Website (Etappe 7) */
function rzMarktHtml(state, myId) {
  const firmen = Object.entries(state.rechenzentren?.firmen || {}).filter(([pid]) => state.players?.[pid]);
  const meine = state.rechenzentren?.websites?.[myId], cfg = state.websiteCfg;
  const anbieter = meine && (meine.anbieter === "stadtportal" ? t("Stadtportal") : (state.website || []).find(w => w.id === meine.anbieter)?.name);
  return `<div class="sec" style="margin-top:16px">${t("Rechenzentren und Websites")} <span class="meta">· ${meine ? `${t("deine Website")}: ${t(cfg?.MODULE[meine.modul]?.name || "")} ${t("bei")} ${escapeHtml(rohText(anbieter || "—"))}, +${Math.round((meine.bonus || 0) * 100)} % ${t("Reichweite")}` : t("du hast noch keine Website")}</span></div>
    ${firmen.length ? `<div class="swListe">${firmen.map(([pid, f]) => {
      const p = state.players[pid], w = (state.website || []).find(x => x.ownerId === pid), up = f.uptime || [];
      const q = up.length ? Math.round(up.reduce((a, b) => a + b, 0) / up.length * 100) : 100;
      return `<button type="button" class="swListeZeile tourHotel${pid === myId ? " meins" : ""}" data-rzauf="${pid}">
        <span class="swName"><i style="background:${p.color}"></i><span><b>${escapeHtml(rohText(p.name))}</b><small>🌐 status.cs/${shopSlug(p.name)}</small></span></span>
        <span class="mono">${q} % ${t("online")}</span><span class="mono">${w?.version ? `${t("Websites")} v${w.version}` : "—"}</span><span class="mono">${w ? `${w.kunden}/${w.plaetze}` : ""}</span></button>`; }).join("")}</div>`
      : `<div class="note">${t("Noch keine Software-Firma mit Rechenzentrum.")}</div>`}`;
}
function stadtSoftwareMarktHtml(state, me, myId) {
  if (!state.stadt) return "";
  const apps = (state.buergerApp || []).filter(a => a.version >= 1), jobs = (state.jobboerse || []).filter(j => j.version >= 1);
  const abo = me.lohn?.jobAbo;
  return `<div class="sec" style="margin-top:16px">${t("Bürger-Apps der Stadt")} <span class="meta">· ${state.stadt.appNutzer || 0} ${t("von")} ${state.stadt.einwohner} ${t("Einwohnern nutzen eine")}</span></div>
    ${apps.length ? `<div class="swListe">${apps.sort((a, b) => b.nutzer - a.nutzer).map(a => `<div class="swListeZeile${a.ownerId === myId ? " meins" : ""}">
      <span class="swName"><i style="background:${a.farbe}"></i><span><b>${a.name} <em>v${a.version}</em></b><small>${a.anbieter}</small></span></span>
      <span class="mono">${fp(a.preis)}/min</span><span class="mono">${a.nutzer} ${t("Nutzer")}</span></div>`).join("")}</div>`
      : `<div class="note">${t("Noch keine Bürger-App fertig — Software-Firmen entwickeln sie im Reiter „Produkte“.")}</div>`}
    <div class="sec" style="margin-top:16px">${t("Jobbörsen")} <span class="meta">· ${t("Vorrang bei knappen Arbeitern")}</span></div>
    ${jobs.length ? `<div class="swListe">${jobs.map(j => `<div class="swListeZeile${j.ownerId === myId ? " meins" : ""}">
      <span class="swName"><i style="background:${j.farbe}"></i><span><b>${j.name} <em>v${j.version}</em></b><small>${j.anbieter} · ${j.abonnenten}/${j.plaetze} ${t("Abos")}</small></span></span>
      <span class="mono">+${String(j.vorrang).replace(".", ",")}</span><span class="mono">${fp(j.gebuehr)}/${t("Arbeiter")}</span>
      ${j.ownerId === myId ? `<span class="meta">${t("deine")}</span>` : abo === j.id ? `<button class="mini" data-jobabo="">${t("Kündigen")}</button>`
        : `<button class="mini" data-jobabo="${j.id}" ${j.abonnenten >= j.plaetze ? "disabled" : ""}>${t("Abonnieren")}</button>`}</div>`).join("")}</div>`
      : `<div class="note">${t("Noch keine Jobbörse fertig.")}</div>`}`;
}
function softwareRendern(state, me, myId) {
  const liste = state.software || [];
  const MOD = state.swModule || {}, cfg = state.swCfg || {};
  const eigene = liste.find(x => x.ownerId === myId && !x.portal);
  const binSoftware = (state.players?.[myId]?.industries || [state.players?.[myId]?.industry]).includes("software");
  const meineBr = state.players?.[myId]?.industry;
  const wertFuer = x => x.wertJe?.[meineBr] ?? x.wert;
  const fertig = liste.filter(x => x.version >= 1).sort((a, b) => wertFuer(b) - wertFuer(a));
  const portal = liste.find(x => x.portal);
  const chips = x => Object.entries(x.module || {}).filter(([m, an]) => an && !m.includes(":")).map(([m]) => `<span class="swChip">${MOD[m]?.name || m}</span>`).join("") || `<span class="swChip leer">keine Extras</span>`;
  const proz = v => String(v).replace(".", ",") + " %";
  const tabelle = `<div class="sec">Shop-Systeme der Stadt</div>
    <div class="swTab">
      <div class="swKopf"><span>System</span><span>Gebühr</span><span>Einrichtung</span><span>Kunden</span><span>Wert</span></div>
      ${fertig.map((x, i) => `<div class="swZeile${x.ownerId === myId ? " meins" : ""}">
        <span class="swName"><i style="background:${x.farbe}"></i><span><b>${x.name} <em>v${x.version}</em></b><small>${x.anbieter}${x.portal ? " · Notlösung" : ` · Ruf ${x.ruf}`}</small><span class="swChips">${chips(x)}${(x.branchen || []).map(br => `<span class="swChip baum">${state.swBaeume?.[br]?.name || br} ${"●".repeat(x.stufen?.[br] || 0)}${"○".repeat(3 - (x.stufen?.[br] || 0))}</span>`).join("")}</span></span></span>
        <span class="mono">${proz(x.gebuehr)}</span>
        <span class="mono">${x.einrichtung ? fmt(x.einrichtung) : "—"}</span>
        <span class="mono">${x.portal ? x.kunden : `${x.kunden}/${x.plaetze ?? 0}`}${x.steuerKunden ? `<small title="davon Produktionsgebäude mit Steuerung (${fmt(x.steuerAbo)}/min)">⚙ ${x.steuerKunden}</small>` : ""}${!x.portal && x.plaetze === 0 ? ` <b class="swWarn">aus</b>` : x.faktor < 1 ? ` <b class="swWarn">überlastet</b>` : ""}</span>
        <span class="mono">${portal?.wert ? `${wertFuer(x) >= wertFuer(portal) ? "+" : ""}${Math.round((wertFuer(x) / wertFuer(portal) - 1) * 100)} %` : "—"}${i === 0 && fertig.length > 1 ? ` <b class="swBest">beste Wahl</b>` : ""}</span>
      </div>`).join("")}
    </div>
    <div class="note" style="margin-top:6px">„Wert“ ist ${SW_BAEUME_NAME(state, meineBr)} gerechnet und mit dem Stadtportal verglichen: Tempo der Module für deine Waren × (1 − Gebühr), Preisspielraum, Werbemodul, Ruf und Einrichtung. Genau so entscheiden auch die Bots — jeder aus Sicht seiner Branche — und wechseln ab 5 % Vorsprung.</div>`;
  let bau = null;
  if (binSoftware) {
    const e = { name: eigene?.name ?? "", farbe: eigene?.farbe ?? (state.players?.[myId]?.color || "#60a5fa"),
      einrichtung: eigene?.einrichtung ?? 400, gebuehr: eigene?.gebuehr ?? 2, werbeAbo: eigene?.werbeAbo ?? 150, steuerAbo: eigene?.steuerAbo ?? (state.steuerAboCfg?.START ?? 40), anzeigenPreis: eigene?.anzeigenPreis ?? 80, ...swEntwurf };
    const felder = `<div class="swForm">
        <label class="breit"><span>Name</span><input id="swName" maxlength="16" value="${escapeHtml(rohText(e.name))}" placeholder="z. B. KassenKlick"></label>
        <label><span>Farbe</span><input id="swFarbe" type="color" value="${e.farbe}"></label>
        <label><span>Einrichtung $</span><input id="swEinr" type="number" min="0" max="${cfg.einrMax ?? 1500}" step="50" value="${e.einrichtung}"></label>
        <label><span>Gebühr %</span><input id="swGeb" type="number" min="${cfg.gebMin ?? .5}" max="${cfg.gebMax ?? 4}" step="0.1" value="${e.gebuehr}"></label>
        <label><span>Werbe-Abo $/min je Marktplatz</span><input id="swAbo" type="number" min="${cfg.aboMin ?? 60}" max="${cfg.aboMax ?? 400}" step="10" value="${e.werbeAbo}"></label>
        <label><span>Anzeigen $/min je Werbeplatz</span><input id="swAnzPreis" type="number" min="${state.anzeigeCfg?.preisMin ?? 20}" max="${state.anzeigeCfg?.preisMax ?? 500}" step="10" value="${e.anzeigenPreis}"></label>
        <label><span>Steuerungs-Abo $/min je Gebäude</span><input id="swSteuerAbo" type="number" min="${state.steuerAboCfg?.MIN ?? 10}" max="${state.steuerAboCfg?.MAX ?? 300}" step="5" value="${e.steuerAbo}"></label>
        <button class="buyb breit" id="swSpeichern">${eigene ? "Preise und Aussehen übernehmen" : "Shop-System anlegen"}</button>
      </div>`;
    let entw = "";
    if (eigene) {
      const dev = eigene.entwicklung;
      const BAUM = state.swBaeume || {}, STUFE = state.swStufe || [], AUS = state.swAusbau || [], EFF = state.swBaumEffekt || {};
      const version = (eigene.version || 0) + 1;
      const besitzt = m => !!eigene.module?.[m];
      const gewaehlt = m => swModulWahl.has(m);
      const eigeneBr = eigene.branchen || [];
      /* Dieselbe Rechnung wie auf dem Server: Basis, allgemeine Module,
       * Baumstufen mit dem Faktor ihrer Branche, Lizenz für eine neue Branche. */
      const neueBr = [...new Set([...swModulWahl].filter(m => m.includes(":")).map(m => m.split(":")[0]).filter(br => !eigeneBr.includes(br)))];
      const brIndex = br => eigeneBr.includes(br) ? eigeneBr.indexOf(br) : eigeneBr.length;
      let epSumme = eigene.version >= 1 ? (cfg.versionEp ?? 60) : (MOD.basis?.ep ?? 150), lizenz = 0;
      for (const m of swModulWahl) {
        if (besitzt(m)) continue;
        if (MOD[m]) { epSumme += MOD[m].ep; continue; }
        const [br, k] = m.split(":");
        epSumme += Math.round((STUFE[k - 1]?.ep || 0) * (AUS[brIndex(br)]?.epFaktor || 1));
      }
      if (neueBr.length) lizenz = AUS[eigeneBr.length]?.cash || 0;
      const knoten = (m, titel, text, frei, sperre) => {
        const drin = besitzt(m), an = drin || gewaehlt(m);
        return `<button type="button" class="swKnoten${drin ? " drin" : an ? " an" : ""}${!drin && !frei ? " zu" : ""}" data-swmod="${m}" ${drin || (!frei && !an) ? "disabled" : ""} title="${!drin && !frei ? sperre : ""}">
          <b>${titel}</b><span>${text}</span><em>${drin ? "✓ drin" : !frei ? `🔒 ${sperre}` : ""}</em></button>`;
      };
      const allgemein = ["werbung", "bewertungen", "lieferung"].map(m => knoten(m, MOD[m]?.name,
        m === "werbung" ? `bis +${Math.round((cfg.werbeBoost || .2) * 100)} % Preis, Abo an dich · ${MOD[m]?.ep} EP` : `+${Math.round((MOD[m]?.tempo || 0) * 100)} % Tempo, alle Waren · ${MOD[m]?.ep} EP`, true, "")).join("");
      const reihen = Object.keys(BAUM).sort((x, y) => (eigeneBr.includes(x) ? eigeneBr.indexOf(x) : 9) - (eigeneBr.includes(y) ? eigeneBr.indexOf(y) : 9)).map(br => {
        const idx = brIndex(br), aus = AUS[idx] || {}, istEigen = eigeneBr.includes(br);
        const andereNeu = neueBr.some(x => x !== br);
        const zuFrueh = !istEigen && version < (aus.abVersion || 1);
        const etikett = istEigen ? (idx === 0 ? "Schwerpunkt" : `${idx + 1}. Branche`)
          : idx === 0 ? "frei wählbar" : `${idx + 1}. Branche · ab v${aus.abVersion} · ${aus.epFaktor}× EP · ${fmt(aus.cash)}`;
        const stufen = [1, 2, 3].map(k => {
          const m = `${br}:${k}`, st = { ...(STUFE[k - 1] || {}), ...(((EFF[br] || [])[k - 1]) || {}) };
          const vorher = k === 1 || besitzt(`${br}:${k - 1}`) || gewaehlt(`${br}:${k - 1}`);
          const frei = vorher && !zuFrueh && !(andereNeu && !istEigen);
          const sperre = zuFrueh ? `ab v${aus.abVersion}` : !vorher ? `erst Stufe ${k - 1}` : "nur eine neue Branche je Version";
          const ep = Math.round((st.ep || 0) * (aus.epFaktor || 1));
          return (k > 1 ? `<i class="swLinie${besitzt(m) ? " an" : ""}"></i>` : "") +
            knoten(m, BAUM[br].module[k - 1], `${st.tempo ? `+${Math.round(st.tempo * 100)} % Tempo` : `+${Math.round((st.preis || 0) * 100)} % Preis`} · ${ep} EP`, frei, sperre);
        }).join("");
        return `<div class="swBaum${istEigen ? " eigen" : ""}${zuFrueh ? " fern" : ""}"><div class="swBaumKopf"><b>${BAUM[br].name}</b><span>${etikett}</span></div><div class="swStufen">${stufen}</div></div>`;
      }).join("");
      const nichtsNeu = eigene.version >= 1 && ![...swModulWahl].some(m => !besitzt(m));
      entw = dev
        ? `<div class="swDev"><div class="swDevKopf"><span>Version ${dev.version} in Arbeit</span><b class="mono">${dev.ep} / ${dev.ziel} EP</b></div>
            <div class="swBalken"><i style="width:${Math.min(100, dev.ep / dev.ziel * 100).toFixed(1)}%"></i></div>
            <div class="note" style="margin:4px 0 0">Neu: ${Object.keys(dev.module).filter(m => dev.module[m] && !besitzt(m)).map(m => MOD[m]?.name || BAUM[m.split(":")[0]]?.module[+m.split(":")[1] - 1] || m).join(", ") || "Grundsystem"}</div></div>`
        : `<div class="sec" style="margin-top:6px">Allgemein · wirkt auf alle Waren</div><div class="swStufen allg">${allgemein}</div>
           <div class="sec" style="margin-top:12px">Skill-Tree je Branche · wirkt nur auf Waren dieser Branche</div>
           <div class="note" style="margin:0 0 8px">Die erste Branche ist dein Schwerpunkt. Jede weitere geht erst ab einer höheren Version und kostet mehr EP und eine Lizenz — Spezialisieren lohnt sich, alles können wird teuer.</div>
           <div class="swBaeume">${reihen}</div>
           <button class="tmHaupt" id="swEntwickeln" ${nichtsNeu ? "disabled" : ""}>
             <span>Version ${version} entwickeln</span><small>${epSumme} EP${lizenz ? ` · Lizenz ${fmt(lizenz)}` : ""} · Vorrat ${me.swEp || 0} EP · ein Studio schafft 1 EP/s</small></button>`;
    }
    const kennzahlen = `<div class="sec">Dein Shop-System</div>
      ${eigene ? `<div class="swZahlen">
          <div><b>${eigene.version >= 1 ? "v" + eigene.version : "—"}</b><span>Version</span></div>
          <div><b>${eigene.kunden}/${eigene.plaetze ?? 0}</b><span>Kunden / Plätze</span></div>
          <div><b>${eigene.ruf}</b><span>Ruf</span></div>
          <div><b style="color:var(--up)">${fmt(eigene.einnahmen10 || 0)}</b><span>Einnahmen 10 min</span></div>
        </div>
        <div class="note" style="margin:-4px 0 10px">Markenwert <b>${fmt(eigene.markenwert || 0)}</b> — zählt zum Firmenwert und Aktienkurs (Einnahmen der letzten 10 min × ${cfg.markenwert ?? 2}).</div>` : `<div class="note">Lege Name und Preise fest, dann entwickelst du Version 1 im Entwicklerstudio.</div>`}`;
    const hinweisErst = `<div class="note">Erst brauchst du ein eigenes Shop-System — lege es im Reiter „Mein System“ an.</div>`;
    bau = {
      system: kennzahlen + felder,
      entwicklung: eigene ? entw : hinweisErst,
      design: eigene ? swDesignHtml(state, eigene) + leitDesignHtml(state, eigene) : hinweisErst,
      produkte: eigene ? buergerAppHtml(state, me, eigene) + jobboerseHtml(state, me, eigene) + boerseAppHtml(state, me, eigene) + paintHtml(state, me, eigene) : hinweisErst,
    };
    if (eigene && SW_REITER === "design") sfSchriftenLaden();
  }
  /* Nur neu setzen, wenn sich etwas geändert hat — sonst liefen Holo- und
   * Glanz-Animation der Vorschau jede Sekunde von vorn. */
  /* Reiter: Markt für alle; für Software-Firmen zusätzlich die eigenen Werkzeuge.
   * Vorher stand alles untereinander auf einer sehr langen Seite. */
  const reiter = [...(bau ? [["uebersicht", "Übersicht"]] : []), ["markt", "Markt"], ...(bau ? [["system", "Mein System"], ["entwicklung", "Entwicklung"], ["design", "Design"], ["produkte", "Produkte"]] : [])];
  if (!reiter.some(([k]) => k === SW_REITER)) SW_REITER = reiter[0][0];
  const leiste = reiter.length > 1 ? `<div class="swReiterLeiste" role="tablist">${reiter.map(([k, n]) =>
    `<button type="button" role="tab" class="${k === SW_REITER ? "on" : ""}" data-swreiter="${k}" aria-selected="${k === SW_REITER}">${t(n)}${k === "entwicklung" && eigene?.entwicklung ? " ●" : ""}</button>`).join("")}</div>` : "";
  const ueberblick = bau && SW_REITER !== "uebersicht" ? swUeberblick(state, me, myId, eigene) : "";
  const inhalt = SW_REITER === "uebersicht" ? swCockpit(state, me, myId, eigene)
    : SW_REITER === "markt"
    ? tabelle + rzMarktHtml(state, myId) + stadtSoftwareMarktHtml(state, me, myId) + werbenetzHtml(state, myId, binSoftware)
    : bau[SW_REITER];
  const body = document.getElementById("softwarebody"), html = ueberblick + leiste + `<div class="swReiterInhalt">${inhalt}</div>`;
  if (body._sig !== html) { body._sig = html; body.innerHTML = html; }
}
document.getElementById("p-software").addEventListener("input", e => {
  const map = { swName: "name", swFarbe: "farbe", swEinr: "einrichtung", swGeb: "gebuehr", swAbo: "werbeAbo", swSteuerAbo: "steuerAbo", swAnzPreis: "anzeigenPreis" };
  if (map[e.target.id]) swEntwurf[map[e.target.id]] = e.target.value;
  if (e.target.id === "mpName") paintEntwurf.name = e.target.value;
  if (e.target.id === "mpPreis") paintEntwurf.preis = e.target.value;
  if (e.target.id === "baName") boerseEntwurf.name = e.target.value;
  if (e.target.id === "baPreis") boerseEntwurf.preis = e.target.value;
  if (e.target.id === "anzText") anzEntwurf.text = e.target.value;
  const lmap = { ldTitel: "titel", ldMeldung: "meldung", ldAkzent: "akzent" };
  if (lmap[e.target.id]) {
    leitEntwurf[lmap[e.target.id]] = e.target.value;
    const mini = document.querySelector("#p-software .lgMini");
    if (mini && e.target.id === "ldAkzent") mini.style.setProperty("--akz", e.target.value);
    if (mini && e.target.id === "ldTitel") { const b = mini.querySelector("[data-ldtitel]"); if (b) b.textContent = e.target.value || b.textContent; }
    if (mini && e.target.id === "ldMeldung") {
      let tk = mini.querySelector(".lgTicker");
      if (!tk) { tk = document.createElement("div"); tk.className = "lgTicker"; tk.innerHTML = "<span data-ldmeldung></span>"; mini.querySelector(".lgKopf").after(tk); }
      tk.querySelector("span").textContent = e.target.value; tk.hidden = !e.target.value;
    }
    const knopf = document.getElementById("leitDesignSpeichern"); if (knopf) { knopf.disabled = false; knopf.textContent = "Leitstand übernehmen"; }
  }
  const dmap = { swdSlogan: "slogan", swdBanner: "banner", swdAkzent: "akzent" };
  if (dmap[e.target.id]) {
    swDesignEntwurf[dmap[e.target.id]] = e.target.value;
    /* Vorschau sofort mitziehen, ohne das Panel neu zu bauen (Fokus bleibt) */
    const mini = document.querySelector("#p-software .sfMini");
    if (mini && e.target.id === "swdAkzent") mini.style.setProperty("--akz", e.target.value);
    if (mini && e.target.id === "swdSlogan") { const b = mini.querySelector(".sfBadge"); let sl = b?.querySelector(".sfSlogan"); if (b && !sl) { sl = document.createElement("span"); sl.className = "sfSlogan"; b.appendChild(sl); } if (sl) sl.textContent = e.target.value; }
    if (mini && e.target.id === "swdBanner") { let bn = mini.querySelector(".sfBanner"); if (!bn) { bn = document.createElement("div"); bn.className = "sfBanner"; mini.querySelector(".sfKopf").after(bn); } bn.innerHTML = `<b>✦</b><span></span>`; bn.querySelector("span").textContent = e.target.value; bn.hidden = !e.target.value; }
    const knopf = document.getElementById("swDesignSpeichern"); if (knopf) { knopf.disabled = false; knopf.textContent = "Design übernehmen"; }
  }
});
document.getElementById("p-software").addEventListener("click", e => {
  const rt = e.target.closest("[data-swreiter]");
  if (rt) { SW_REITER = rt.dataset.swreiter; try { localStorage.setItem("cs_swReiter", SW_REITER); } catch {} const S = store.get(); softwareRendern(S.state, S.me, S.myId); return; }
  const ja = e.target.closest("[data-jobabo]");
  if (ja) return act("jobAbo", { id: ja.dataset.jobabo || null });
  const ra = e.target.closest("[data-rzauf]");
  if (ra) return rzOeffnen(ra.dataset.rzauf);
  const ga = e.target.closest("[data-genauf]");
  if (ga) return genOeffnen(ga.dataset.genauf);
  if (e.target.closest("[data-swnetz]")) return netzOeffnen(null);
  for (const [knopf, ev, felder, entwurf, ok] of [
    ["#appSpeichern", "appEinstellen", () => ({ name: document.getElementById("appName")?.value, preis: +document.getElementById("appPreis")?.value }), appEntwurf, "Bürger-App gespeichert"],
    ["#jobSpeichern", "jobEinstellen", () => ({ name: document.getElementById("jobName")?.value, gebuehr: +document.getElementById("jobGeb")?.value }), jobEntwurf, "Jobbörse gespeichert"]])
    if (e.target.closest(knopf)) return socket.emit(ev, felder(), r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(entwurf)) delete entwurf[k];
      toast(t(ok)); render(store.get());
    });
  for (const [knopf, ev] of [["#appEntwickeln", "appEntwickeln"], ["#jobEntwickeln", "jobEntwickeln"]])
    if (e.target.closest(knopf)) return socket.emit(ev, {}, r => { if (r?.error) return toast(r.error, true); toast(`${t("Entwicklung gestartet")}: ${r.ep} EP`); render(store.get()); });
  if (e.target.closest("#mpSpeichern")) {
    socket.emit("paintEinstellen", { name: document.getElementById("mpName")?.value, preis: document.getElementById("mpPreis")?.value }, r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(paintEntwurf)) delete paintEntwurf[k];
      toast("Malprogramm gespeichert"); render(store.get());
    });
    return;
  }
  if (e.target.closest("#mpEntwickeln")) {
    socket.emit("paintEntwickeln", {}, r => { if (r?.error) return toast(r.error, true); toast(`Entwicklung gestartet: ${r.ep} EP`); render(store.get()); });
    return;
  }
  /* --- Börsen-App --- */
  if (e.target.closest("#baSpeichern")) {
    socket.emit("boerseEinstellen", { name: document.getElementById("baName")?.value, preis: document.getElementById("baPreis")?.value }, r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(boerseEntwurf)) delete boerseEntwurf[k];
      toast("Börsen-App gespeichert"); render(store.get());
    });
    return;
  }
  if (e.target.closest("#baEntwickeln")) {
    socket.emit("boerseEntwickeln", {}, r => { if (r?.error) return toast(r.error, true); toast(`Entwicklung gestartet: ${r.ep} EP`); render(store.get()); });
    return;
  }
  if (e.target.closest("#mpMalen")) return malOeffnen();
  const sa = e.target.closest("[data-shopauf]");
  if (sa) { const [x, y] = sa.dataset.shopauf.split(",").map(Number); return shopOeffnen(x, y); }
  const ab = e.target.closest("[data-anzbuch]");
  if (ab) {
    socket.emit("anzeigeBuchen", { produktId: ab.dataset.anzbuch, minuten: +ab.dataset.min, text: document.getElementById("anzText")?.value }, r => {
      if (r?.error) return toast(r.error, true);
      toast(`Anzeige gebucht (${fmt(r.preis)}) — +${r.wirkung} % Preisspielraum in deinen Shops`); SFX.spiel("kasse"); render(store.get());
    });
    return;
  }
  const ld = e.target.closest("[data-leitdes]");
  if (ld && !ld.disabled) { leitEntwurf[ld.dataset.leitdes] = ld.dataset.wert; SFX.spiel("klick"); render(store.get()); return; }
  if (e.target.closest("#leitDesignSpeichern")) {
    socket.emit("leitDesign", { ...leitEntwurf }, r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(leitEntwurf)) delete leitEntwurf[k];
      toast("Leitstand übernommen — alle Kunden mit deiner Steuerung sehen ihn jetzt so"); render(store.get());
    });
    return;
  }
  const dz = e.target.closest("[data-swdes]");
  if (dz && !dz.disabled) { swDesignEntwurf[dz.dataset.swdes] = dz.dataset.wert; SFX.spiel("klick"); render(store.get()); return; }
  if (e.target.closest("#swDesignSpeichern")) {
    socket.emit("softwareDesign", { ...swDesignEntwurf }, r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(swDesignEntwurf)) delete swDesignEntwurf[k];
      toast("Website-Design übernommen — alle Shops mit deinem System sehen jetzt so aus"); render(store.get());
    });
    return;
  }
  const m = e.target.closest("[data-swmod]");
  if (m) {
    const id = m.dataset.swmod;
    if (swModulWahl.has(id)) {
      swModulWahl.delete(id);
      const [br, k] = id.split(":");
      if (k) for (let k2 = +k + 1; k2 <= 3; k2++) swModulWahl.delete(`${br}:${k2}`);
    } else swModulWahl.add(id);
    SFX.spiel("klick"); render(store.get()); return;
  }
  if (e.target.closest("#swSpeichern")) {
    const v = id => document.getElementById(id)?.value;
    socket.emit("softwareEinstellen", { name: v("swName"), farbe: v("swFarbe"), einrichtung: v("swEinr"), gebuehr: v("swGeb"), werbeAbo: v("swAbo"), steuerAbo: v("swSteuerAbo"), anzeigenPreis: v("swAnzPreis") }, r => {
      if (r?.error) return toast(r.error, true);
      for (const k of Object.keys(swEntwurf)) delete swEntwurf[k];
      toast("Shop-System gespeichert"); render(store.get());
    });
    return;
  }
  if (e.target.closest("#swEntwickeln")) {
    const module = Object.fromEntries([...swModulWahl].map(x => [x, true]));
    socket.emit("softwareEntwickeln", { module }, r => {
      if (r?.error) return toast(r.error, true);
      swModulWahl.clear(); toast(`Entwicklung gestartet: ${r.ep} EP`); render(store.get());
    });
  }
});

/* ---------- Online-Shop-Fenster ----------
 * Das Schaufenster eines Online-Marktplatzes, wie ein Browserfenster: oben die
 * Adresse des Shop-Systems, die Produkte aus den Regalen mit Lager und Preis,
 * rechts die Bestellungen der letzten Sekunden. Fremde Spieler kaufen hier
 * ein; bezahlt wird mit einer Karte im Design des installierten Systems. */
const WAREN_ICON = { strom: "⚡", wasser: "💧", oel: "🛢️", obst: "🍎", erze: "⛏️", kannabis: "🌿", honig: "🍯", silizium: "🔷",
  saft: "🧃", stahl: "🔩", medizin: "💊", gebaeck: "🥐", diesel: "⛽", uebernachtung: "🛏️", ziegel: "🧱", beton: "🏗️",
  elektronik: "🔌", munition: "🎯", rennreifen: "🛞", rennsoftware: "💾" };
const SHOP = { offen: false, x: 0, y: 0, kasse: null, menge: {}, gesehen: new Set() };
/* Website-Design des Shop-Systems: Schriften erst laden, wenn eine Shop-Seite
 * oder der Design-Baukasten zum ersten Mal zu sehen ist. */
let sfSchriftenGeladen = false;
function sfSchriftenLaden() {
  if (sfSchriftenGeladen) return; sfSchriftenGeladen = true;
  const l = document.createElement("link"); l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Caveat:wght@600;700&family=DM+Serif+Display&family=Fredoka:wght@500;700&family=Playfair+Display:wght@700;800&family=Press+Start+2P&display=swap";
  document.head.appendChild(l);
}
/* Design auf ein .sfBrowser-Element anwenden (Shop-Fenster und Vorschau) */
function sfDesignSetzen(el, design, farbe) {
  const d = design || {};
  for (const k of ["schrift", "thema", "ecken", "kopf", "karten", "motiv", "effekt"]) el.dataset[k] = d[k] || "";
  el.style.setProperty("--sys", farbe || "#64748b");
  if (d.akzent) el.style.setProperty("--akz", d.akzent); else el.style.removeProperty("--akz");
}
const sfDesignAttr = (design, farbe) => {
  const d = design || {};
  return ["schrift", "thema", "ecken", "kopf", "karten", "motiv", "effekt"].map(k => `data-${k}="${d[k] || ""}"`).join(" ")
    + ` style="--sys:${farbe || "#64748b"};${d.akzent ? `--akz:${d.akzent}` : ""}"`;
};
/* Firmenlogo (gemalt mit einem Malprogramm) oder Anfangsbuchstabe */
function logoHtml(pid, cls = "sfLogo", farbe) {
  const st = store.get().state, p = st.players?.[pid];
  const bild = logoBild(pid);
  if (bild) return `<img class="${cls} hatBild" src="${bild}" alt="Logo ${escapeHtml(rohText(p?.name || ""))}">`;
  return `<span class="${cls}" style="background:${farbe || p?.color || "#64748b"}">${rohText(p?.name || "?").slice(0, 1)}</span>`;
}
const shopSlug = s => rohText(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function shopOeffnen(x, y) {
  Object.assign(SHOP, { offen: true, x, y, kasse: null, menge: {}, gesehen: new Set(), sig: {} });
  const el = document.getElementById("shopFenster");
  el.hidden = false;
  /* Gerüst einmal bauen; danach tauscht shopZeichnen nur die Teile aus, die
   * sich geändert haben. Würde jedes Spiel-Update das ganze Fenster neu
   * setzen, begänne die Einblendung immer wieder von vorn, und Klicks
   * gingen zwischen Drücken und Loslassen verloren. */
  el.innerHTML = `<div class="sfBrowser" role="dialog" aria-label="Online-Shop">
    <div class="sfLeiste"><span class="sfPunkte"><i></i><i></i><i></i></span>
      <span class="sfUrl"></span><button type="button" class="sfZu" data-sfzu aria-label="Schließen">✕</button></div>
    <header class="sfKopf"></header>
    <div class="sfBanner" hidden></div>
    <div class="sfAnzeigen" hidden></div>
    <div class="sfHinweis" hidden></div>
    <div class="sfInhalt"><div class="sfGrid"></div>
      <aside class="sfFeed"><h4><span class="sfLive"></span>Bestellungen</h4><ul></ul></aside></div>
    <footer class="sfFuss"></footer>
    <div class="sfKasse" hidden></div>
  </div>`;
  SFX.spiel("klick");
  sfSchriftenLaden();
  shopZeichnen(true);
}
function shopSchliessen() {
  SHOP.offen = false; SHOP.kasse = null;
  const el = document.getElementById("shopFenster");
  el.hidden = true; el.innerHTML = "";
}
function shopDaten() {
  const { state, me, myId } = store.get();
  const t = state.map.find(k => k.x === SHOP.x && k.y === SHOP.y);
  if (!t || t.btype !== "onlinemarkt") return null;
  const sys = (state.software || []).find(x => x.id === t.system?.produktId);
  return { state, me, myId, t, sys, owner: state.players[t.owner], meins: t.owner === myId, offen: !!sys && state.tick >= (t.system?.bis || 0) };
}
/* Sternwertung je Produkt: nur mit Modul "Kundenbewertungen", aus Ware und
 * Kachel abgeleitet, damit sie stabil bleibt. */
const shopSterne = (g, t) => 3.9 + ((g.length * 7 + t.x * 3 + t.y * 5) % 11) / 10;
/* Teil nur austauschen, wenn sich sein Inhalt geändert hat */
const shopSetze = (sel, html, key) => {
  if (SHOP.sig[key] === html) return;
  SHOP.sig[key] = html;
  const el = document.querySelector("#shopFenster " + sel); if (el) el.innerHTML = html;
};
function shopZeichnen(neu = false) {
  const d = shopDaten();
  if (!d) return shopSchliessen();
  const { state, me, t, sys, owner, meins, offen } = d;
  const fenster = document.getElementById("shopFenster");
  const farbe = sys?.farbe || "#64748b", avg = state.avg || {};
  sfDesignSetzen(fenster.querySelector(".sfBrowser"), sys?.design, farbe);
  const dsg = sys?.design || {};
  const regale = (t.shop || []).map((sl, i) => ({ sl, i })).filter(({ sl }) => sl?.good && sl.price > 0);
  shopSetze(".sfUrl", `🔒 ${shopSlug(sys?.name || "shop")}.cs/${shopSlug(owner?.name || "firma")}`, "url");
  shopSetze(".sfKopf", `<div class="sfMarke">${logoHtml(t.owner, "sfLogo", owner?.color || farbe)}
      <div><b>${owner?.name || "—"}</b><small>Online-Shop · ${regale.length} Produkt${regale.length === 1 ? "" : "e"}${sys?.module?.lieferung ? " · Lieferung sofort" : ""}</small></div></div>
    <span class="sfBadge">${offen ? `💳 Bezahlt mit <b>${sys.name}</b> v${sys.version}${dsg.slogan ? `<span class="sfSlogan">${dsg.slogan}</span>` : ""}` : "Shop geschlossen"}</span>`, "kopf" + (logoBild(t.owner) || "").length);
  const banner = fenster.querySelector(".sfBanner");
  banner.hidden = !(offen && dsg.banner);
  shopSetze(".sfBanner", dsg.banner ? `<b>✦</b><span>${dsg.banner}</span>` : "", "banner");
  /* Werbenetz: Anzeigen anderer Firmen, gebucht bei diesem System */
  const anz = sys && !sys.portal ? (state.anzeigen || []).filter(a => a.produktId === sys.id) : [];
  fenster.querySelector(".sfAnzeigen").hidden = !(offen && anz.length);
  shopSetze(".sfAnzeigen", anz.map(a => `<span class="sfAnz"><small>Anzeige</small>${logoHtml(a.firmaId, "sfAnzLogo", a.farbe)}<b>${escapeHtml(rohText(a.firma))}</b> ${escapeHtml(rohText(a.text))}</span>`).join(""), "anz");
  shopSetze(".sfFuss", sys ? `${sys.portal ? `<span class="sfFussLogo">🏛</span>` : logoHtml(sys.ownerId, "sfFussLogo", sys.farbe)}<span>Diese Website läuft mit <b>${sys.name}</b>${sys.portal ? " — dem Notportal der Stadt" : ` v${sys.version} · entwickelt von <b>${sys.anbieter}</b>`}</span>` : "", "fuss" + (sys && !sys.portal ? (logoBild(sys.ownerId) || "").length : 0));
  const hinweis = fenster.querySelector(".sfHinweis");
  hinweis.hidden = !meins;
  shopSetze(".sfHinweis", "Vorschau: So sehen andere Spieler deinen Shop. Stadtkunden kaufen hier automatisch, Mitspieler können direkt bestellen.", "hinweis");
  const werbung = !!t.system?.werbung && sys?.module?.werbung;
  const karten = regale.map(({ sl, i }) => {
    const vorrat = meins ? Math.floor(Math.min(me.inv[sl.good] || 0, sl.qty ?? Infinity)) : (t.vorrat?.[i] ?? null);
    const rabatt = avg[sl.good] ? Math.round((1 - sl.price / avg[sl.good]) * 100) : 0;
    const n = Math.max(1, Math.min(SHOP.menge[i] || 10, vorrat || 1));
    const sterne = sys?.module?.bewertungen ? shopSterne(sl.good, t) : null;
    const leer = vorrat != null && vorrat < 1;
    return `<article class="sfProdukt${leer ? " leer" : ""}">
      ${leer ? `<span class="sfBand grau">Ausverkauft</span>` : werbung && rabatt > 0 ? `<span class="sfBand">−${rabatt} % unter Ø</span>` : werbung ? `<span class="sfBand">Empfohlen</span>` : ""}
      <div class="sfBild"><span>${WAREN_ICON[sl.good] || "📦"}</span></div>
      <h5>${gname(sl.good)}</h5>
      ${sterne ? `<div class="sfSterne" title="${sterne.toFixed(1)} von 5">${"★".repeat(Math.round(sterne))}${"☆".repeat(5 - Math.round(sterne))}<em>${sterne.toFixed(1).replace(".", ",")}</em></div>` : ""}
      <div class="sfPreis"><b>${fp(sl.price)}</b><span>je Stück · Ø ${fp(avg[sl.good] || 0)}</span></div>
      <div class="sfInfo">${sys?.module?.lieferung ? "🚚 Sofort im Lager" : "📦 Abholung im Lager"} · ${vorrat == null ? "—" : leer ? "nichts mehr da" : `${vorrat} auf Lager`}</div>
      ${meins ? `<div class="sfEigen">Dein Angebot</div>` : `<div class="sfKauf">
        <div class="sfMenge"><button type="button" data-sfm="${i}" data-d="-1" aria-label="weniger">−</button><input type="number" min="1" max="${vorrat || 1}" step="1" value="${n}" data-sfn="${i}" aria-label="Menge"><button type="button" data-sfm="${i}" data-d="1" aria-label="mehr">+</button></div>
        <button type="button" class="sfKaufen" data-sfkauf="${i}" ${offen && !leer ? "" : "disabled"}>Kaufen · ${fmt(n * sl.price)}</button></div>`}
    </article>`; }).join("");
  /* Malprogramm der Software-Firma: Lizenz als eigenes Produkt im Shop */
  const mp = (state.paint || []).find(x => x.ownerId === t.owner && x.version >= 1);
  const lizenzKarte = mp ? (() => {
    const hat = me.paintLizenz === mp.id, st = mp.stufe || {};
    return `<article class="sfProdukt sfLizenz"><span class="sfBand">Software</span>
      <div class="sfBild"><span>🎨</span></div>
      <h5>${mp.name} <small>v${mp.version}</small></h5>
      <div class="sfPreis"><b>${fmt(mp.preis)}</b><span>Lizenz · Updates gratis</span></div>
      <div class="sfInfo">🖌️ Malprogramm fürs Firmenlogo · ${st.groesse}×${st.groesse} Pixel · ${st.farben ? `${st.farben} Farben` : "freie Farben"}</div>
      ${meins ? `<div class="sfEigen">Dein Programm · ${mp.verkauft} verkauft</div>`
        : hat ? `<div class="sfKauf"><button type="button" class="sfKaufen" data-sfmalen>🎨 Logo malen</button></div>`
        : `<div class="sfKauf"><button type="button" class="sfKaufen" data-sflizenz ${offen ? "" : "disabled"}>Lizenz kaufen · ${fmt(mp.preis)}</button></div>`}
    </article>`; })() : "";
  /* Börsen-App der Software-Firma: Lizenz als eigenes Produkt im Shop */
  const ba = (state.boerseApp || []).find(x => x.ownerId === t.owner && x.version >= 1);
  const baKarte = ba ? (() => {
    const hat = me.boerseLizenz === ba.id, bst = ba.stufe || {};
    return `<article class="sfProdukt sfLizenz"><span class="sfBand">Software</span>
      <div class="sfBild"><span>📈</span></div>
      <h5>${ba.name} <small>v${ba.version}</small></h5>
      <div class="sfPreis"><b>${fmt(ba.preis)}</b><span>Lizenz · Updates gratis</span></div>
      <div class="sfInfo">📊 Börsen-App · bring sie unter ${bst.bewohner} deiner Kunden · du bekommst die Hälfte der Provision auf ihre Anlagen</div>
      ${meins ? `<div class="sfEigen">Dein Programm · ${ba.verkauft} verkauft</div>`
        : hat ? `<div class="sfKauf"><button type="button" class="sfKaufen" disabled>Lizenz aktiv ✓</button></div>`
        : `<div class="sfKauf"><button type="button" class="sfKaufen" data-sfboerselizenz ${offen ? "" : "disabled"}>Lizenz kaufen · ${fmt(ba.preis)}</button></div>`}
    </article>`; })() : "";
  shopSetze(".sfGrid", (baKarte + lizenzKarte + karten) || `<div class="sfLeer">Gerade keine Ware im Regal.</div>`, "grid");
  /* Feed: neu aufbauen nur bei neuen Bestellungen — die Zeitangaben werden
   * an Ort und Stelle aktualisiert. Sonst entstünden jede Sekunde neue
   * Elemente, und die Einflug-Animation liefe ständig von vorn. */
  const bestellungen = t.bestellungen || [];
  const vorTxt = b => { const vor = Math.max(0, state.tick - b.t); return vor < 5 ? "gerade eben" : vor < 60 ? `vor ${vor} s` : `vor ${Math.floor(vor / 60)} min`; };
  const feedSig = bestellungen.map(b => b.id).join("|") + farbe;
  if (SHOP.sig.feed !== feedSig) {
    SHOP.sig.feed = feedSig;
    const ul = document.querySelector("#shopFenster .sfFeed ul");
    ul.innerHTML = bestellungen.map(b => `<li data-bid="${b.id}"><span class="sfFeedIcon">${b.g === "lizenz" ? "🎨" : b.g === "boerse-lizenz" ? "📈" : WAREN_ICON[b.g] || "📦"}</span>
      <span><b>${b.g === "lizenz" || b.g === "boerse-lizenz" ? `Lizenz ${b.name || ""}` : `${b.n}× ${gname(b.g)}`}</b><small><span>${b.von}</span> · <span class="sfVor">${vorTxt(b)}</span></small></span>
      <span class="sfFeedBetrag">${fmt(b.b)}<i style="background:${farbe}">${sys?.name ? rohText(sys.name).slice(0, 1) : "$"}</i></span></li>`).join("")
      || `<li class="sfLeerFeed">Noch keine Bestellung — sie erscheinen hier live.</li>`;
    ul.querySelectorAll("li[data-bid]").forEach(li => {
      if (!SHOP.gesehen.has(li.dataset.bid)) { SHOP.gesehen.add(li.dataset.bid); if (!neu) li.classList.add("neu"); }
    });
  } else {
    const spans = document.querySelectorAll("#shopFenster .sfFeed .sfVor");
    bestellungen.forEach((b, i) => { if (spans[i]) spans[i].textContent = vorTxt(b); });
  }
}
/* Bezahlvorgang: Karte im Design des Systems fährt ins Terminal, Kontaktlos-
 * Wellen, dann die Antwort des Servers — Haken oder Kreuz, und ein Beleg. */
function shopBezahlen(slot) {
  const d = shopDaten(); if (!d) return;
  const { t, sys, me, owner, state, myId } = d;
  const lizenz = slot === "lizenz";
  const boerseLiz = slot === "boerseLizenz";
  const mp = lizenz ? (state.paint || []).find(x => x.ownerId === t.owner && x.version >= 1) : null;
  const ba = boerseLiz ? (state.boerseApp || []).find(x => x.ownerId === t.owner && x.version >= 1) : null;
  if (lizenz && !mp) return;
  if (boerseLiz && !ba) return;
  const sl = (lizenz || boerseLiz) ? { good: boerseLiz ? "boerse-lizenz" : "lizenz", price: (mp || ba).preis } : t.shop?.[slot]; if (!sl) return;
  const feld = (lizenz || boerseLiz) ? null : document.querySelector(`#shopFenster [data-sfn="${slot}"]`);
  const n = (lizenz || boerseLiz) ? 1 : Math.max(1, Math.floor(+feld?.value || SHOP.menge[slot] || 10));
  const summe = n * sl.price;
  const artikel = lizenz ? `Lizenz ${mp.name} v${mp.version}` : boerseLiz ? `Lizenz ${ba.name} v${ba.version}` : `${n}× ${gname(sl.good)}`;
  const farbe = sys?.farbe || "#64748b";
  const ich = state.players[myId];
  const kasse = document.querySelector("#shopFenster .sfKasse");
  SHOP.kasse = { slot, n };
  kasse.hidden = false;
  kasse.innerHTML = `<div class="sfKasseBox" style="--sys:${farbe}">
    <div class="sfKasseKopf"><b>Kasse</b><span>${artikel} · ${fmt(summe)}</span></div>
    <div class="sfBuehne">
      <div class="sfKarte">
        <div class="sfKarteOben"><b>${sys?.name || "Karte"}</b><span class="sfChip"></span></div>
        <div class="sfKarteNr">•••• •••• •••• ${String(4000 + (rohText(ich?.name || "").length * 137) % 6000).padStart(4, "0")}</div>
        <div class="sfKarteUnten"><span>${ich?.name || ""}</span><span>${String((state.tick % 12) + 1).padStart(2, "0")}/29</span></div>
      </div>
      <div class="sfTerminal"><div class="sfDisplay"><span class="sfBetrag">${fmt(summe)}</span><span class="sfStatus">Karte auflegen</span></div>
        <div class="sfWellen"><i></i><i></i><i></i></div></div>
    </div>
    <div class="sfBeleg" hidden></div>
  </div>`;
  const box = kasse.firstElementChild, status = kasse.querySelector(".sfStatus");
  SFX.spiel("klick");
  requestAnimationFrame(() => box.classList.add("auflegen"));
  setTimeout(() => { box.classList.add("funkt"); status.textContent = "Zahlung wird geprüft …"; }, 900);
  setTimeout(() => {
    const cmd = lizenz ? "lizenzKaufen" : boerseLiz ? "boerseLizenzKaufen" : "shopKaufen";
    socket.emit(cmd, (lizenz || boerseLiz) ? { x: t.x, y: t.y } : { x: t.x, y: t.y, slot, qty: n }, r => {
      const beleg = kasse.querySelector(".sfBeleg");
      box.classList.remove("funkt");
      if (r?.error) {
        box.classList.add("fehler"); status.textContent = "Abgelehnt";
        beleg.hidden = false;
        beleg.innerHTML = `<div class="sfErgebnis"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M17 17l18 18M35 17L17 35"/></svg><b>Zahlung abgelehnt</b><span>${r.error}</span></div>
          <button type="button" class="sfWeiter" data-sfweiter>Zurück zum Shop</button>`;
        SFX.spiel("hinweis");
        return;
      }
      box.classList.add("ok"); status.textContent = "Bezahlt ✓";
      SFX.spiel("geld");
      if (sys?.design?.effekt === "konfetti") sfKonfetti(kasse, farbe, sys.design.akzent);
      beleg.hidden = false;
      beleg.innerHTML = `<div class="sfErgebnis"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg><b>Zahlung erfolgreich</b></div>
        <dl class="sfBon">
          <div><dt>${lizenz ? `Lizenz ${r.programm} v${r.version}` : `${r.n}× ${gname(sl.good)} à ${fp(sl.price)}`}</dt><dd>${fmt(r.summe)}</dd></div>
          <div><dt>Händler</dt><dd>${owner?.name || ""}</dd></div>
          <div><dt>Zahlungsdienst</dt><dd>${r.system}</dd></div>
          ${lizenz && !r.gebuehr ? "" : `<div class="klein"><dt>Gebühr ${String(sys?.gebuehr ?? "").replace(".", ",")} % an ${r.system} (zahlt der Händler)</dt><dd>${fp(r.gebuehr)}</dd></div>`}
          <div class="klein"><dt>Handelssteuer ${String(r.steuerSatz ?? "").replace(".", ",")} % an die Stadt (zahlt der Händler)</dt><dd>${fp(r.steuer || 0)}</dd></div>
        </dl>
        ${lizenz ? `<div class="sfBonFuss">Die Lizenz gehört dir — Updates von ${r.programm} bekommst du gratis.</div>
        <div class="mpZeile"><button type="button" class="sfWeiter" data-sfmalen>🎨 Jetzt Logo malen</button><button type="button" class="sfWeiter hell" data-sfweiter>Zurück zum Shop</button></div>`
        : `<div class="sfBonFuss">${r.n}× ${gname(sl.good)} liegen jetzt in deinem Lager.</div>
        <button type="button" class="sfWeiter" data-sfweiter>Weiter einkaufen</button>`}`;
    });
  }, 1900);
}
function sfKonfetti(ziel, f1, f2) {
  const box = document.createElement("div"); box.className = "sfKonfetti";
  const farben = [f1, f2 || "#fbbf24", "#f472b6", "#60a5fa", "#34d399"];
  box.innerHTML = Array.from({ length: 46 }, (_, i) => `<i style="left:${(i * 37) % 100}%;background:${farben[i % farben.length]};animation-delay:${(i % 9) * 0.05}s;transform:rotate(${i * 23}deg)"></i>`).join("");
  ziel.appendChild(box); setTimeout(() => box.remove(), 2200);
}
document.getElementById("shopFenster").addEventListener("click", e => {
  if (e.target.closest("[data-sfzu]") || e.target.id === "shopFenster") return shopSchliessen();
  const m = e.target.closest("[data-sfm]");
  if (m) { const i = +m.dataset.sfm; SHOP.menge[i] = Math.max(1, (SHOP.menge[i] || 10) + (+m.dataset.d) * ((SHOP.menge[i] || 10) >= 20 ? 5 : 1)); return shopZeichnen(); }
  if (e.target.closest(".sfKasse") && !e.target.closest(".sfKasseBox")) return;
  const k = e.target.closest("[data-sfkauf]");
  if (k) return shopBezahlen(+k.dataset.sfkauf);
  if (e.target.closest("[data-sflizenz]:not(:disabled)")) return shopBezahlen("lizenz");
  if (e.target.closest("[data-sfboerselizenz]:not(:disabled)")) return shopBezahlen("boerseLizenz");
  if (e.target.closest("[data-sfmalen]")) { shopSchliessen(); return malOeffnen(); }
  if (e.target.closest("[data-sfweiter]")) {
    SHOP.kasse = null; SHOP.sig = {};
    const k2 = document.querySelector("#shopFenster .sfKasse"); k2.hidden = true; k2.innerHTML = "";
    shopZeichnen();
  }
});
document.getElementById("shopFenster").addEventListener("input", e => {
  const n = e.target.closest("[data-sfn]");
  if (n) { SHOP.menge[+n.dataset.sfn] = Math.max(1, Math.floor(+n.value) || 1);
    const b = document.querySelector(`[data-sfkauf="${n.dataset.sfn}"]`); const d = shopDaten(); const sl = d?.t.shop?.[+n.dataset.sfn];
    if (b && sl) b.textContent = `Kaufen · ${fmt(SHOP.menge[+n.dataset.sfn] * sl.price)}`; }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && SHOP.offen) shopSchliessen(); });

/* ---------- Leitstand: Oberfläche der Steuerungssoftware ----------
 * Jedes gesteuerte Gebäude hat einen Leitstand im Design der Software-Firma
 * (Thema, Anzeigen, Schrift, Effekt, Titel, Laufschrift). Funktionen je nach
 * Version: Live-Anzeigen und Alarm, Turbo, Nachkauf, Auto-Turbo.
 * Das Gerüst wird nur neu gebaut, wenn sich Aufbau oder Design ändern; die
 * Werte wandern sonst über data-lw / --f an Ort und Stelle — so gehen Klicks
 * zwischen zwei Updates nicht verloren. */
const LEIT = { offen: false, x: 0, y: 0, sig: "" };
const leitEntwurf = {};
/* Eine Anzeige in vier Bauarten; die Füllung steuert allein --f (0…1) */
function leitAnzeige(art, key, titel, f, text, unter = "") {
  const inner = art === "zeiger"
    ? `<svg viewBox="0 0 100 56" class="lgZeiger" aria-hidden="true"><path d="M8 50 A42 42 0 0 1 92 50" class="lgSpur"/><path d="M8 50 A42 42 0 0 1 92 50" class="lgFill" pathLength="100"/><line x1="50" y1="50" x2="50" y2="14" class="lgNadel"/><circle cx="50" cy="50" r="4" class="lgNabe"/></svg>`
    : art === "ringe"
    ? `<svg viewBox="0 0 60 60" class="lgRing" aria-hidden="true"><circle cx="30" cy="30" r="24" class="lgSpur"/><circle cx="30" cy="30" r="24" class="lgFill" pathLength="100"/></svg>`
    : art === "ziffern" ? `<div class="lgSegment"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>`
    : `<div class="lgBalken"><i></i></div>`;
  return `<div class="lgAnz" data-lf="${key}" style="--f:${Math.max(0, Math.min(1, f || 0)).toFixed(3)}">
    <span class="lgTitel">${titel}</span>${inner}<b class="lgWert" data-lw="${key}">${text}</b><small data-lw="${key}_u">${unter}</small></div>`;
}
/* Daten eines gesteuerten Gebäudes für den Leitstand (aus dem Spielstand) */
function leitDaten(state, me, t) {
  const bt = BTYPES()[t.btype], sys = (state.software || []).find(x => x.id === t.steuerung?.produktId);
  if (!bt || !sys) return null;
  const def = state.steuerung?.[bt.industry] || {}, T = state.turbo || { DAUER: 60, PAUSE: 120, OUT: .3, IN: .5 }, FN = state.leitFunktion || {};
  const stufe = sys.stufen?.[bt.industry] || 0, faktor = Math.min(1, sys.faktor ?? 1);
  const w = (def.wert || 0) * (state.steuerStufe || [0, .5, .8, 1])[stufe] * faktor;
  const tick = state.tick, offen = tick >= (t.steuerung.bis || 0);
  const turboAn = offen && sys.version >= FN.turbo && (t.steuerung.turboBis || 0) > tick && faktor > 0;
  const lvl = 1 + 0.3 * ((t.level || 1) - 1);
  const inArt = def.art === "in" && !!bt.proc;
  const plus = (inArt ? 0 : w) + (turboAn ? T.OUT : 0);
  const sparen = (1 - (inArt ? w : 0)) * (turboAn ? 1 + T.IN : 1);
  const out = bt.proc ? bt.proc.out : bt.out;
  const rate = (bt.proc ? bt.proc.rate : bt.rate) * lvl * (offen ? 1 + plus : 1) * 60;
  const roh = bt.proc ? Object.entries(bt.proc.in).map(([g, n]) => ({ g, je: n * lvl * (offen ? sparen : 1) }))
    : [{ g: "strom", je: bt.rate * lvl * T.IN, nurTurbo: true }];
  return { bt, sys, def, T, FN, stufe, w, offen, turboAn, inArt, out, rate, roh, lvl, tick,
    rest: Math.max(0, (t.steuerung.bis || 0) - tick), turboRest: Math.max(0, (t.steuerung.turboBis || 0) - tick),
    pauseRest: Math.max(0, (t.steuerung.pauseBis || 0) - tick), lager: me?.inv?.[out] || 0, inv: me?.inv || {} };
}
const leitZeit = sek => sek >= 3600 ? "> 60 min" : `${Math.floor(sek / 60)}:${String(Math.floor(sek % 60)).padStart(2, "0")} min`;
/* Gerüst und Werte. vorschau: Musterdaten fürs Design-Panel. */
function leitstandHtml(d, design, kopf, vorschau = false) {
  const g = design || {}, art = g.anzeige || "balken", v = d.sys.version || 0;
  const titel = g.titel || `${d.sys.name} Leitstand`;
  const anzeigen = [
    leitAnzeige(art, "rate", "Ausstoß", (d.rate / 60) / ((d.bt.proc ? d.bt.proc.rate : d.bt.rate) * d.lvl * (1 + (d.def.wert || 0) + d.T.OUT)), `${(d.rate).toFixed(1)}/min`, gname(d.out)),
    leitAnzeige(art, "bonus", d.inArt ? "Ersparnis" : "Bonus", (d.def.wert ? (d.inArt ? d.w : d.w + (d.turboAn ? d.T.OUT : 0)) / ((d.def.wert || 0) + d.T.OUT) : 0),
      `${d.offen ? "+" + Math.round((d.inArt ? d.w : d.w + (d.turboAn ? d.T.OUT : 0)) * 100) : 0} %`, d.inArt ? "weniger Rohstoffe" : d.def.name || ""),
    leitAnzeige(art, "lager", "Lager", Math.min(1, d.lager / Math.max(1, d.rate * 10)), `${Math.floor(d.lager)}`, gname(d.out)),
  ].join("");
  const roh = d.roh.map(r => {
    const sek = r.je > 0 ? (d.inv[r.g] || 0) / r.je : Infinity;
    return `<div class="lgRoh" data-lf="roh_${r.g}" style="--f:${Math.min(1, sek / 300).toFixed(3)}"><span>${WAREN_ICON[r.g] || "📦"} ${gname(r.g)}${r.nurTurbo ? " <em>(Turbo)</em>" : ""}</span>
      <div class="lgBalken"><i></i></div><b data-lw="roh_${r.g}">${Number.isFinite(sek) ? leitZeit(sek) : "—"}</b></div>`;
  }).join("");
  const turboFrei = v >= (d.FN.turbo || 2), autoFrei = v >= (d.FN.autoTurbo || 4), kaufFrei = v >= (d.FN.nachkauf || 3);
  const turbo = `<div class="lgTurbo" data-lf="turbo" style="--f:${vorschau && d.turboAn ? .7 : 0}">
      <button type="button" class="lgKnopf lgTurboKnopf" data-leit="turbo" ${turboFrei && !vorschau ? "" : "disabled"}>🚀 <span data-lw="turbo">${!turboFrei ? `Turbo ab v${d.FN.turbo}` : vorschau ? `Turbo läuft · ${d.turboRest} s` : "Turbo"}</span></button>
      <div class="lgBalken"><i></i></div>
      <small>+${Math.round(d.T.OUT * 100)} % Ausstoß für ${d.T.DAUER} s · +${Math.round(d.T.IN * 100)} % ${d.bt.proc ? "Rohstoffe" : "Strom"} · ${d.T.PAUSE} s Pause</small></div>
    <div class="lgReihe">
      <button type="button" class="lgKnopf" data-leit="auto" ${autoFrei && !vorschau ? "" : "disabled"}><span data-lw="auto">${autoFrei ? "Auto-Turbo" : `Auto-Turbo ab v${d.FN.autoTurbo}`}</span></button>
      ${d.bt.proc ? `<button type="button" class="lgKnopf" data-leit="nachkauf" ${kaufFrei && !vorschau ? "" : "disabled"}>${kaufFrei ? "🛒 Rohstoffe für 3 min nachkaufen" : `Nachkauf ab v${d.FN.nachkauf}`}</button>` : ""}
    </div>`;
  /* Laufschrift: Meldung der Software-Firma, dazu die Anzeigen aus ihrem Werbenetz */
  const anz = vorschau ? [] : (store.get().state.anzeigen || []).filter(a => a.produktId === d.sys.id);
  const lauf = [g.meldung ? escapeHtml(rohText(g.meldung)) : "", ...anz.map(a => `📣 Anzeige · <b>${escapeHtml(rohText(a.firma))}</b>: ${escapeHtml(rohText(a.text))}`)].filter(Boolean);
  const meldung = lauf.length ? `<div class="lgTicker"><span data-ldmeldung>${lauf.join("   ✦   ")}</span></div>` : "";
  return `<div class="lgKopf">${logoHtml(d.sys.ownerId, "lgLogo", d.sys.farbe)}
      <div class="lgName"><b data-ldtitel>${escapeHtml(rohText(titel))}</b><small>${kopf}</small></div>
      <span class="lgStatus" data-lw="status" data-zustand="an">${vorschau ? (d.turboAn ? "Turbo" : "Online") : ""}</span>${vorschau ? "" : `<button type="button" class="lgZu" data-leitzu aria-label="Schließen">✕</button>`}</div>
    ${meldung}
    <div class="lgAnzeigen">${anzeigen}</div>
    <div class="lgAbschnitt">Rohstoff-Reichweite</div><div class="lgRohListe">${roh}</div>
    <div class="lgAbschnitt">Steuerung</div>${turbo}
    <div class="lgFuss"><span data-lw="mehr">${vorschau ? `Mehr produziert: +128 ${gname(d.out)} · 3× Turbo` : ""}</span><span>${escapeHtml(rohText(d.sys.name))} v${v} · von ${escapeHtml(rohText(d.sys.anbieter))}</span></div>`;
}
/* Werte, die sich jede Sekunde ändern */
function leitWerte(el, d, t) {
  const setze = (k, txt) => el.querySelectorAll(`[data-lw="${k}"]`).forEach(x => { if (x.textContent !== txt) x.textContent = txt; });
  const fuell = (k, f) => { const x = el.querySelector(`[data-lf="${k}"]`); if (x) x.style.setProperty("--f", Math.max(0, Math.min(1, f)).toFixed(3)); };
  const maxPlus = (d.def.wert || 0) + d.T.OUT;
  const plusJetzt = d.offen ? (d.inArt ? d.w : d.w + (d.turboAn ? d.T.OUT : 0)) : 0;
  fuell("rate", (d.rate / 60) / ((d.bt.proc ? d.bt.proc.rate : d.bt.rate) * d.lvl * (1 + maxPlus))); setze("rate", `${d.rate.toFixed(1)}/min`);
  fuell("bonus", maxPlus ? plusJetzt / maxPlus : 0); setze("bonus", `+${Math.round(plusJetzt * 100)} %`);
  fuell("lager", d.lager / Math.max(1, d.rate * 10)); setze("lager", `${Math.floor(d.lager)}`);
  for (const r of d.roh) {
    const sek = r.je > 0 ? (d.inv[r.g] || 0) / r.je : Infinity;
    fuell("roh_" + r.g, sek / 300); setze("roh_" + r.g, (d.inv[r.g] || 0) < 0.5 ? "leer" : Number.isFinite(sek) ? leitZeit(sek) : "—");
  }
  const turboFrei = d.sys.version >= (d.FN.turbo || 2);
  fuell("turbo", d.turboAn ? d.turboRest / d.T.DAUER : d.pauseRest ? 1 - d.pauseRest / d.T.PAUSE : turboFrei ? 1 : 0);
  setze("turbo", !turboFrei ? `Turbo ab v${d.FN.turbo}` : d.turboAn ? `Turbo läuft · ${d.turboRest} s` : d.pauseRest ? `Kühlt ab · ${d.pauseRest} s` : "Turbo zünden");
  setze("auto", d.sys.version >= (d.FN.autoTurbo || 4) ? (t.steuerung.auto ? "Auto-Turbo: an" : "Auto-Turbo: aus") : `Auto-Turbo ab v${d.FN.autoTurbo}`);
  const knopf = el.querySelector('[data-leit="turbo"]');
  if (knopf) knopf.disabled = !turboFrei || !d.offen || d.turboAn || d.pauseRest > 0;
  el.querySelector('[data-leit="auto"]')?.classList.toggle("an", !!t.steuerung.auto);
  el.classList.toggle("turboAn", d.turboAn);
  setze("status", !d.offen ? `Installation · ${d.rest} s` : (d.sys.faktor ?? 1) <= 0 ? "Ausfall — Rechenzentrum aus" : (d.sys.faktor ?? 1) < 1 ? `Überlastet (${Math.round(d.sys.faktor * 100)} %)` : d.turboAn ? "Turbo" : "Online");
  el.querySelector(".lgStatus")?.setAttribute("data-zustand", !d.offen ? "warn" : (d.sys.faktor ?? 1) < 1 ? "warn" : "an");
  const st = t.steuerung;
  setze("mehr", d.inArt ? `Gespart seit Installation: ${fmt(st.gespart || 0)}${st.mehr ? ` · +${Math.round(st.mehr)} ${gname(d.out)} im Turbo` : ""}` : `Mehr produziert: +${Math.round(st.mehr || 0)} ${gname(d.out)}${st.turbos ? ` · ${st.turbos}× Turbo` : ""}`);
}
const leitDesignAttr = (g, farbe) => {
  const d = g || {};
  return ["thema", "anzeige", "schrift", "effekt"].map(k => `data-${k}="${d[k] || ""}"`).join(" ") + ` style="--sys:${farbe || "#64748b"};${d.akzent ? `--akz:${d.akzent}` : ""}"`;
};
function leitOeffnen(x, y) {
  Object.assign(LEIT, { offen: true, x, y, sig: "" });
  document.getElementById("leitFenster").hidden = false;
  sfSchriftenLaden(); SFX.spiel("klick");
  leitZeichnen();
}
function leitSchliessen() {
  LEIT.offen = false;
  const el = document.getElementById("leitFenster"); el.hidden = true; el.innerHTML = "";
}
function leitZeichnen() {
  const { state, me, myId } = store.get();
  const t = state.map.find(k => k.x === LEIT.x && k.y === LEIT.y);
  if (!t || t.owner !== myId || !t.steuerung) return leitSchliessen();
  const d = leitDaten(state, me, t); if (!d) return leitSchliessen();
  const fenster = document.getElementById("leitFenster");
  const design = d.sys.leitDesign || {};
  const sig = JSON.stringify([design, d.sys.version, d.sys.id, t.btype, t.level, d.roh.map(r => r.g), !!d.offen,
    (state.anzeigen || []).filter(a => a.produktId === d.sys.id).map(a => a.id + a.text)]);
  if (sig !== LEIT.sig) {
    LEIT.sig = sig;
    fenster.innerHTML = `<div class="leitstand" role="dialog" aria-label="Leitstand" ${leitDesignAttr(design, d.sys.farbe)}>${leitstandHtml(d, design, `${bname(t.btype)} · ${escapeHtml(rohText(state.players[myId]?.name || ""))}`)}</div>`;
  }
  leitWerte(fenster.querySelector(".leitstand"), d, t);
}
document.getElementById("leitFenster").addEventListener("click", e => {
  if (e.target.closest("[data-leitzu]") || e.target.id === "leitFenster") return leitSchliessen();
  const k = e.target.closest("[data-leit]"); if (!k || k.disabled) return;
  const { state, me } = store.get();
  const t = state.map.find(q => q.x === LEIT.x && q.y === LEIT.y); if (!t?.steuerung) return;
  if (k.dataset.leit === "turbo") { SFX.spiel("klick"); return act("steuerTurbo", { x: t.x, y: t.y }); }
  if (k.dataset.leit === "auto") return act("steuerAuto", { x: t.x, y: t.y, an: !t.steuerung.auto });
  if (k.dataset.leit === "nachkauf") {
    /* Fehlende Rohstoffe für 3 Minuten als Kaufgebote knapp über dem Ø-Kurs */
    const d = leitDaten(state, me, t); if (!d) return;
    let n = 0;
    for (const r of d.roh) {
      const fehlt = Math.ceil(r.je * 180 - (me.inv[r.g] || 0));
      if (fehlt < 1) continue;
      act("placeOrder", { side: "buy", good: r.g, qty: fehlt, price: Math.round((state.avg?.[r.g] || 1) * 1.05 * 100) / 100 }); n++;
    }
    toast(n ? `Leitstand: ${n} Kaufgebot${n > 1 ? "e" : ""} an der Börse eingestellt` : "Die Rohstoffe reichen schon für 3 Minuten");
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && LEIT.offen) leitSchliessen(); });
/* Werbenetz: Anzeigen bei Software-Firmen buchen. Reichweite = Kunden des
 * Systems (Online-Marktplätze + gesteuerte Gebäude). */
const anzEntwurf = { text: "" };
function werbenetzHtml(state, myId, binSoftware) {
  const cfg = state.anzeigeCfg; if (!cfg) return "";
  const systeme = (state.software || []).filter(x => !x.portal && x.version >= 1).sort((a, b) => b.anzeigeWirkung - a.anzeigeWirkung);
  const alle = state.anzeigen || [];
  const meine = alle.filter(a => a.firmaId === myId);
  const meinSys = binSoftware ? systeme.find(x => x.ownerId === myId) : null;
  const beiMir = meinSys ? alle.filter(a => a.produktId === meinSys.id) : [];
  const zeile = x => {
    const eigen = x.ownerId === myId, laeuft = meine.find(a => a.produktId === x.id);
    const voll = !laeuft && x.anzeigenFrei <= 0;
    return `<div class="anzZeile">
      <span class="swName"><i style="background:${x.farbe}"></i><span><b>${escapeHtml(rohText(x.name))} <em>v${x.version}</em></b><small>${escapeHtml(rohText(x.anbieter))} · ${x.kunden} Kunden · ${x.anzeigenPlaetze - x.anzeigenFrei}/${x.anzeigenPlaetze} Plätze belegt</small></span></span>
      <span class="mono">+${String(x.anzeigeWirkung).replace(".", ",")} %<small>Preisspielraum</small></span>
      <span class="mono">${fmt(x.anzeigenPreis)}<small>je Minute</small></span>
      <span class="anzKnoepfe">${eigen ? `<small class="meta">dein System</small>` : voll ? `<small class="meta">voll</small>`
        : (cfg.dauer || [3, 5, 10]).map(m => `<button type="button" class="mini" data-anzbuch="${x.id}" data-min="${m}">${m} min · ${fmt(x.anzeigenPreis * m)}</button>`).join("")}</span>
    </div>`;
  };
  return `<div class="sec" style="margin-top:16px">Werbenetz · Anzeigen bei Software-Firmen</div>
    <div class="note" style="margin:0 0 8px">Deine Anzeige läuft in allen Online-Shops und Leitständen mit diesem System. Je Kunde des Systems bekommst du ${String(Math.round(1.2 * 10) / 10).replace(".", ",")} % mehr Preisspielraum in deinen eigenen Shops (höchstens ${Math.round(cfg.maxJe * 100)} % je Anzeige, ${Math.round(cfg.max * 100)} % insgesamt). Bezahlt wird vorab; das Geld geht an die Software-Firma.</div>
    ${meine.length ? `<div class="anzMeine">${meine.map(a => `<span class="anzChip">📣 ${escapeHtml(rohText(a.text))} <em>${(systeme.find(x => x.id === a.produktId)?.name) ?? ""} · noch ${Math.ceil(a.rest / 60)} min</em></span>`).join("")}</div>` : ""}
    <label class="anzText"><span>Anzeigentext</span><input id="anzText" maxlength="${cfg.text}" value="${escapeHtml(rohText(anzEntwurf.text))}" placeholder="z. B. Frisches Obst — heute 10 % günstiger"></label>
    <div class="anzTab">${systeme.length ? systeme.map(zeile).join("") : `<div class="meta">Noch hat keine Software-Firma ein System veröffentlicht.</div>`}</div>
    ${meinSys ? `<div class="note" style="margin-top:6px">In deinem System laufen ${beiMir.length} von ${meinSys.anzeigenPlaetze} Anzeigen${beiMir.length ? ": " + beiMir.map(a => `${escapeHtml(rohText(a.firma))} (${Math.ceil(a.rest / 60)} min)`).join(", ") : ""}. Jede neue Version bringt einen Werbeplatz mehr (höchstens 3).</div>` : ""}`;
}
/* Baukasten im Software-Panel: Leitstand-Design mit Vorschau an einer Chipfabrik */
function leitDesignHtml(state, eigene) {
  const OPT = state.leitDesign || {}, AB = state.leitDesignAb || {};
  const v = Math.max(1, eigene.version || 0);
  const g = { ...(eigene.leitDesign || {}), ...leitEntwurf };
  const farbe = swEntwurf.farbe || eigene.farbe;
  const titel = { thema: "Thema", anzeige: "Anzeigen", schrift: "Schrift", effekt: "Effekt" };
  const reihen = Object.entries(titel).map(([k, tt]) => `<div class="swDesignReihe"><span>${tt}</span><div class="swDesignWahl">
    ${Object.entries(OPT[k] || {}).map(([id, o]) => `<button type="button" data-leitdes="${k}" data-wert="${id}" class="${g[k] === id ? "an" : ""}" ${o.ab > v ? "disabled" : ""}>${o.name}${o.ab > v ? `<em>🔒 v${o.ab}</em>` : ""}</button>`).join("")}
  </div></div>`).join("");
  const zu = k => v < (AB[k] || 1);
  const texte = `<div class="swDesignTexte">
    <label>Titel${zu("titel") ? ` 🔒 v${AB.titel}` : ""}<input id="ldTitel" maxlength="24" value="${escapeHtml(rohText(g.titel || ""))}" placeholder="${escapeHtml(rohText(eigene.name))} Leitstand" ${zu("titel") ? "disabled" : ""}></label>
    <label>Laufschrift${zu("meldung") ? ` 🔒 v${AB.meldung}` : ""}<input id="ldMeldung" maxlength="70" value="${escapeHtml(rohText(g.meldung || ""))}" placeholder="z. B. Support rund um die Uhr" ${zu("meldung") ? "disabled" : ""}></label>
    <label>Leuchtfarbe${zu("akzent") ? ` 🔒 v${AB.akzent}` : ""}<input id="ldAkzent" type="color" value="${g.akzent || farbe || "#60a5fa"}" ${zu("akzent") ? "disabled" : ""}></label>
  </div>`;
  /* Musterdaten: Chipfabrik mit Technologie-Steuerung, Turbo gerade aktiv */
  const bt = BTYPES().chipfabrik || { proc: { in: { silizium: .7, strom: .5 }, out: "elektronik", rate: .5 }, industry: "tech" };
  const def = state.steuerung?.tech || { name: "Fertigungsstraße", art: "out", wert: .12 };
  const T = state.turbo || { DAUER: 60, PAUSE: 120, OUT: .3, IN: .5 };
  const d = { bt, sys: { ...eigene, version: v, faktor: 1 }, def, T, FN: state.leitFunktion || {}, stufe: 3, w: def.wert, offen: true, turboAn: v >= (state.leitFunktion?.turbo || 2),
    inArt: false, out: bt.proc.out, rate: bt.proc.rate * 60 * (1 + def.wert + T.OUT), lvl: 1, tick: 0, rest: 0, turboRest: 42, pauseRest: 0, lager: 64,
    roh: Object.entries(bt.proc.in).map(([gg, n]) => ({ gg, g: gg, je: n * (1 + T.IN) })), inv: { silizium: 160, strom: 40 } };
  const vorschau = `<div class="leitstand lgMini${d.turboAn ? " turboAn" : ""}" ${leitDesignAttr(g, farbe)}>${leitstandHtml(d, g, "Chipfabrik · Musterkunde", true)}</div>`;
  const geaendert = Object.keys(leitEntwurf).length > 0;
  return `<div class="sec" style="margin-top:16px">Leitstand-Design · so sieht die Steuerung bei deinen Kunden aus</div>
    <div class="note" style="margin:0 0 8px">Jeder Kunde öffnet den Leitstand auf seinen gesteuerten Gebäuden. Neue Versionen schalten Themen, Anzeigen und Effekte frei — und Funktionen: Turbo ab v${state.leitFunktion?.turbo ?? 2}, Nachkauf ab v${state.leitFunktion?.nachkauf ?? 3}, Auto-Turbo ab v${state.leitFunktion?.autoTurbo ?? 4}.</div>
    <div class="swDesign">${reihen}${texte}${vorschau}
      <button class="buyb" id="leitDesignSpeichern" ${geaendert ? "" : "disabled"}>${geaendert ? "Leitstand übernehmen" : "Leitstand ist aktuell"}</button></div>`;
}

/* ---------- Firmenlogos (gemalt mit einem Malprogramm) ----------
 * Der Server schickt nur Versionsnummern (state.logoV); fehlende oder neuere
 * Logos holt der Client gesammelt nach und rendert sie einmal als Canvas. */
const FLOGO = {};
let logoHolenLaeuft = false;
function logoZuCanvas(l) {
  const c = document.createElement("canvas"); c.width = c.height = l.g;
  const cx = c.getContext("2d");
  for (let i = 0; i < l.px.length; i++) {
    const ch = l.px[i]; if (ch === ".") continue;
    cx.fillStyle = l.pal[parseInt(ch, 16)] || "#000"; cx.fillRect(i % l.g, Math.floor(i / l.g), 1, 1);
  }
  return c;
}
function logosAbgleichen(state) {
  const v = state.logoV || {};
  for (const pid of Object.keys(FLOGO)) if (!(pid in v)) delete FLOGO[pid];
  const fehlt = Object.entries(v).filter(([pid, n]) => FLOGO[pid]?.v !== n).map(([pid]) => pid);
  if (!fehlt.length || logoHolenLaeuft) return;
  logoHolenLaeuft = true;
  socket.emit("logoHolen", fehlt, res => {
    logoHolenLaeuft = false;
    for (const [pid, l] of Object.entries(res || {})) {
      if (!l) continue;
      const c = logoZuCanvas(l);
      /* Für die Anzeige hochskaliert ohne Weichzeichnen — Pixel bleiben scharf */
      const gross = document.createElement("canvas"); gross.width = gross.height = 128;
      const gx = gross.getContext("2d"); gx.imageSmoothingEnabled = false; gx.drawImage(c, 0, 0, 128, 128);
      FLOGO[pid] = { v: l.v, roh: l, canvas: c, url: gross.toDataURL() };
    }
    if (SHOP.offen) { SHOP.sig = {}; shopZeichnen(); }
    render(store.get());
  });
}
const logoBild = pid => (store.get().state?.logoV?.[pid] != null && FLOGO[pid]?.url) || null;

/* ---------- Malprogramm: Logo-Editor ---------- */
const MAL = { offen: false, g: 16, px: [], pal: [], farbe: 0, werkzeug: "stift", spiegeln: false, verlauf: [], malt: false };
function malOeffnen(versuch = 0) {
  const { state, me, myId } = store.get();
  const st = me.paintStufe;
  /* Direkt nach dem Lizenzkauf kann das nächste Update noch unterwegs sein */
  if (!st && versuch < 2) return setTimeout(() => malOeffnen(versuch + 1), 800);
  if (!st) return toast("Du brauchst ein Malprogramm — Lizenzen gibt es im Online-Shop einer Software-Firma.", true);
  const PAL = state.paintCfg?.palette || [];
  const alt = FLOGO[myId]?.roh;
  MAL.pal = st.farben ? PAL.slice(0, st.farben) : (alt?.pal?.length ? [...alt.pal, ...PAL].slice(0, 16) : PAL.slice(0, 16));
  MAL.g = alt ? Math.min(alt.g, st.groesse) : st.groesse;
  MAL.px = new Array(MAL.g * MAL.g).fill(-1);
  if (alt && alt.g === MAL.g) for (let i = 0; i < alt.px.length; i++) {
    if (alt.px[i] === ".") continue;
    const farbe = alt.pal[parseInt(alt.px[i], 16)], idx = MAL.pal.indexOf(farbe);
    MAL.px[i] = idx >= 0 ? idx : 0;
  }
  Object.assign(MAL, { offen: true, farbe: Math.min(2, MAL.pal.length - 1), werkzeug: "stift", spiegeln: false, verlauf: [] });
  let el = document.getElementById("malFenster");
  if (!el) { el = document.createElement("div"); el.id = "malFenster"; document.body.appendChild(el); el.addEventListener("click", malKlick); el.addEventListener("input", malEingabe); }
  el.hidden = false;
  malAufbauen();
}
function malSchliessen() { MAL.offen = false; const el = document.getElementById("malFenster"); if (el) { el.hidden = true; el.innerHTML = ""; } }
function malAufbauen() {
  const { me, state } = store.get(), st = me.paintStufe, my = state.players[store.get().myId];
  const groessen = [16, 24, 32].filter(n => n <= st.groesse);
  const w = st.werkzeuge || [];
  document.getElementById("malFenster").innerHTML = `<div class="malBox" role="dialog" aria-label="Logo malen">
    <header class="malKopf"><div><b>🎨 ${escapeHtml(rohText(st.programm))} <em>v${st.version}</em></b><small>Firmenlogo für ${escapeHtml(rohText(my?.name || ""))} — erscheint im Shop, an der Börse und an deinen Gebäuden</small></div>
      <button type="button" class="malZu" data-malzu aria-label="Schließen">✕</button></header>
    <div class="malHaupt">
      <div class="malLeinwandRahmen"><canvas id="malLeinwand" width="${MAL.g * 16}" height="${MAL.g * 16}"></canvas></div>
      <aside class="malSeite">
        <div class="malGruppe"><span>Werkzeug</span><div class="malWerkzeuge">
          ${[["stift", "✏️ Stift"], ["radierer", "🧽 Radierer"], ["fuellen", "🪣 Füllen"]].map(([id, t]) => `<button type="button" data-malw="${id}" class="${MAL.werkzeug === id ? "an" : ""}" ${w.includes(id) ? "" : "disabled"}>${t}${w.includes(id) ? "" : " <em>🔒</em>"}</button>`).join("")}
          <button type="button" data-malspiegel class="${MAL.spiegeln ? "an" : ""}" ${w.includes("spiegeln") ? "" : "disabled"}>🪞 Spiegeln${w.includes("spiegeln") ? "" : " <em>🔒</em>"}</button>
        </div></div>
        <div class="malGruppe"><span>Größe</span><div class="malWerkzeuge">${[16, 24, 32].map(n => `<button type="button" data-malg="${n}" class="${MAL.g === n ? "an" : ""}" ${groessen.includes(n) ? "" : "disabled"}>${n}×${n}${groessen.includes(n) ? "" : " <em>🔒</em>"}</button>`).join("")}</div></div>
        <div class="malGruppe"><span>Farben${st.farben ? ` · ${st.farben} Grundfarben` : " · frei wählbar — gewählte Farbe nochmal antippen"}</span><div class="malPalette">
          ${MAL.pal.map((c, i) => `<button type="button" data-malf="${i}" class="${MAL.farbe === i ? "an" : ""}" style="background:${c}" aria-label="Farbe ${i + 1}">${st.farben ? "" : `<input type="color" value="${c}" data-malfarbe="${i}" tabindex="-1">`}</button>`).join("")}
        </div></div>
        <div class="malGruppe"><span>Vorschau</span><div class="malVorschau"><canvas id="malKlein" width="${MAL.g}" height="${MAL.g}"></canvas><div class="malKopfProbe" style="background:${my?.color || "#64748b"}"><canvas id="malMittel" width="${MAL.g}" height="${MAL.g}"></canvas><b>${escapeHtml(rohText(my?.name || ""))}</b></div></div></div>
        <div class="malKnoepfe"><button type="button" data-malzurueck>↶ Rückgängig</button><button type="button" data-malleeren>Leeren</button></div>
        <button type="button" class="buyb" data-malspeichern>Logo speichern</button>
        ${st.version < 3 ? `<div class="note" style="margin:0">Mit einem Update deines Programms kommen ${st.version < 2 ? "24×24 Pixel, 16 Farben und Füllen" : "32×32 Pixel, freie Farben und Spiegeln"} dazu — gratis.</div>` : ""}
      </aside>
    </div></div>`;
  malZeichnen();
}
function malZeichnen() {
  const c = document.getElementById("malLeinwand"); if (!c) return;
  const cx = c.getContext("2d"), z = c.width / MAL.g;
  for (let y = 0; y < MAL.g; y++) for (let x = 0; x < MAL.g; x++) {
    const v = MAL.px[y * MAL.g + x];
    cx.fillStyle = v >= 0 ? MAL.pal[v] : ((x + y) % 2 ? "#e5e7eb" : "#f9fafb");
    cx.fillRect(x * z, y * z, z, z);
  }
  cx.strokeStyle = "rgba(0,0,0,.08)"; cx.lineWidth = 1;
  for (let i = 0; i <= MAL.g; i++) { cx.beginPath(); cx.moveTo(i * z + .5, 0); cx.lineTo(i * z + .5, c.height); cx.moveTo(0, i * z + .5); cx.lineTo(c.width, i * z + .5); cx.stroke(); }
  if (MAL.spiegeln) { cx.strokeStyle = "rgba(239,68,68,.6)"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(c.width / 2, 0); cx.lineTo(c.width / 2, c.height); cx.stroke(); }
  for (const id of ["malKlein", "malMittel"]) {
    const k = document.getElementById(id); if (!k) continue;
    const kx = k.getContext("2d"); kx.clearRect(0, 0, k.width, k.height);
    for (let i = 0; i < MAL.px.length; i++) if (MAL.px[i] >= 0) { kx.fillStyle = MAL.pal[MAL.px[i]]; kx.fillRect(i % MAL.g, Math.floor(i / MAL.g), 1, 1); }
  }
}
function malSetze(x, y, wert) {
  if (x < 0 || y < 0 || x >= MAL.g || y >= MAL.g) return;
  MAL.px[y * MAL.g + x] = wert;
  if (MAL.spiegeln) MAL.px[y * MAL.g + (MAL.g - 1 - x)] = wert;
}
function malFuellen(x, y, wert) {
  const ziel = MAL.px[y * MAL.g + x]; if (ziel === wert) return;
  const stapel = [[x, y]];
  while (stapel.length) {
    const [a, b] = stapel.pop();
    if (a < 0 || b < 0 || a >= MAL.g || b >= MAL.g || MAL.px[b * MAL.g + a] !== ziel) continue;
    MAL.px[b * MAL.g + a] = wert;
    stapel.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
  }
}
function malPunkt(e) {
  const c = document.getElementById("malLeinwand"), r = c.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / r.width * MAL.g), Math.floor((e.clientY - r.top) / r.height * MAL.g)];
}
function malAnwenden(e, neu) {
  const [x, y] = malPunkt(e);
  if (neu) { MAL.verlauf.push(MAL.px.slice()); if (MAL.verlauf.length > 40) MAL.verlauf.shift(); MAL.letzt = null; }
  if (MAL.werkzeug === "fuellen") { if (neu) { malFuellen(x, y, MAL.farbe); if (MAL.spiegeln) malFuellen(MAL.g - 1 - x, y, MAL.farbe); } }
  else {
    /* Lückenlos: von der letzten Zelle zur aktuellen eine Linie ziehen —
     * bei schnellen Bewegungen springt der Zeiger sonst über Zellen hinweg. */
    const wert = MAL.werkzeug === "radierer" ? -1 : MAL.farbe;
    const [x0, y0] = MAL.letzt || [x, y];
    const n = Math.max(Math.abs(x - x0), Math.abs(y - y0), 1);
    for (let i = 0; i <= n; i++) malSetze(Math.round(x0 + (x - x0) * i / n), Math.round(y0 + (y - y0) * i / n), wert);
    MAL.letzt = [x, y];
  }
  malZeichnen();
}
document.addEventListener("pointerdown", e => { if (e.target.id === "malLeinwand") { MAL.malt = true; e.target.setPointerCapture?.(e.pointerId); malAnwenden(e, true); e.preventDefault(); } });
document.addEventListener("pointermove", e => { if (MAL.malt && e.target.id === "malLeinwand" && MAL.werkzeug !== "fuellen") malAnwenden(e, false); });
document.addEventListener("pointerup", () => { MAL.malt = false; });
function malKlick(e) {
  if (e.target.id === "malFenster" || e.target.closest("[data-malzu]")) return malSchliessen();
  const w = e.target.closest("[data-malw]"); if (w && !w.disabled) { MAL.werkzeug = w.dataset.malw; return malAufbauen(); }
  if (e.target.closest("[data-malspiegel]:not(:disabled)")) { MAL.spiegeln = !MAL.spiegeln; return malAufbauen(); }
  const f = e.target.closest("[data-malf]"); if (f && !e.target.matches("input")) { MAL.farbe = +f.dataset.malf; if (MAL.werkzeug === "radierer") MAL.werkzeug = "stift"; return malAufbauen(); }
  const g = e.target.closest("[data-malg]");
  if (g && !g.disabled) {
    const neu = +g.dataset.malg, alt = MAL.g, altPx = MAL.px;
    MAL.verlauf.push({ g: alt, px: altPx.slice() });
    MAL.g = neu; MAL.px = Array.from({ length: neu * neu }, (_, i) => altPx[Math.floor(Math.floor(i / neu) * alt / neu) * alt + Math.floor((i % neu) * alt / neu)]);
    return malAufbauen();
  }
  if (e.target.closest("[data-malzurueck]")) {
    const v = MAL.verlauf.pop(); if (!v) return;
    if (Array.isArray(v)) MAL.px = v; else { MAL.g = v.g; MAL.px = v.px; return malAufbauen(); }
    return malZeichnen();
  }
  if (e.target.closest("[data-malleeren]")) { MAL.verlauf.push(MAL.px.slice()); MAL.px.fill(-1); return malZeichnen(); }
  if (e.target.closest("[data-malspeichern]")) {
    if (!MAL.px.some(v => v >= 0)) return toast("Das Logo ist noch leer", true);
    const logo = { g: MAL.g, pal: MAL.pal, px: MAL.px.map(v => v < 0 ? "." : v.toString(16)).join("") };
    socket.emit("logoSpeichern", { logo }, r => {
      if (r?.error) return toast(r.error, true);
      SFX.spiel("geld"); toast("Logo gespeichert — es erscheint jetzt überall bei deiner Firma");
      malSchliessen();
    });
  }
}
function malEingabe(e) {
  const i = e.target.dataset?.malfarbe;
  if (i != null) { MAL.pal[+i] = e.target.value; e.target.parentElement.style.background = e.target.value; MAL.farbe = +i; malZeichnen(); }
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && MAL.offen) malSchliessen(); });

/* Löhne (Sandkasten, Etappe 2): drei Stufen, höher gibt Vorrang bei knappen
 * Arbeitern. Eine Senkung greift erst nach der Kündigungsfrist. */
/* Jobbörse im Firma-Panel: eigenes Abo und die Angebote der Stadt */
function jobAboHtml(me, state) {
  const jobs = (state.jobboerse || []).filter(j => j.version >= 1 && j.ownerId !== store.get().myId);
  const abo = jobs.find(j => j.id === me.lohn?.jobAbo);
  if (me.lohn?.vorrang && !abo) return `<div class="kzrow"><span>${t("Jobbörse")}</span><b>${t("eigene")} · +${String(me.lohn.vorrang).replace(".", ",")} ${t("Vorrang")}</b></div>`;
  if (!jobs.length) return "";
  return `<div class="kzrow"><span>${t("Jobbörse")} <span class="meta">· ${t("Vorrang ohne höheren Lohn")}</span></span><b>${abo ? `${abo.name} · +${String(me.lohn.vorrang).replace(".", ",")}` : t("kein Abo")}</b></div>
    <div class="fJobs">${jobs.map(j => `<button class="${abo?.id === j.id ? "on" : ""}" data-jobabo="${abo?.id === j.id ? "" : j.id}" ${abo?.id !== j.id && j.abonnenten >= j.plaetze ? "disabled" : ""}>
      <b>${j.name} v${j.version}</b><span>+${String(j.vorrang).replace(".", ",")} · ${fp(j.gebuehr)}/${t("Arbeiter")}${abo?.id === j.id ? ` · ${t("kündigen")}` : ""}</span></button>`).join("")}</div>`;
}
function lohnHtml(me, state) {
  const L = me.lohn, S = state.stadt;
  if (!L || !S) return "";
  const stufen = Object.entries(S.loehne);
  const kosten = L.arbeiter * S.loehne[L.stufe].lohn, rest = L.ab ? Math.max(0, L.ab - state.tick) : 0;
  return `<div class="sec">${t("Löhne")} <span class="meta">· ${L.arbeiter} / ${L.soll} ${t("Arbeiter")}</span></div>
    <div class="fLohn">${stufen.map(([k, v]) => `<button class="${k === L.stufe ? "on" : ""}${k === L.wunsch ? " bald" : ""}" data-lohn="${k}">
      <b>${t(v.name)}</b><span>${v.lohn} $ ${t("je Arbeiter/min")}</span></button>`).join("")}</div>
    <div class="kzrow"><span>${t("Lohnkosten")}</span><b>${fmt(kosten)}/min</b></div>
    ${jobAboHtml(me, state)}
    <div class="kzrow"><span>${t("Insgesamt gezahlt")}</span><b>${fmt(L.gesamt)}</b></div>
    ${L.wunsch ? `<div class="meta">${t("Senkung auf")} ${t(S.loehne[L.wunsch].name)} ${t("in")} ${rest} s (${t("Kündigungsfrist")}).</div>` : ""}
    ${L.verzug ? `<div class="meta stMinus">${t("Löhne nicht voll bezahlt — du bekommst zuletzt Arbeiter, bis du wieder zahlst.")}</div>` : ""}
    <div class="meta" style="padding-bottom:8px">${t("Sind Arbeiter knapp, gehen sie zuerst zur Firma mit dem höchsten Lohn. Vom Lohn gehen 30 % als Steuer und Miete an die Stadt — damit baut sie Wohnungen.")}</div>`;
}
/* Rüstungsaufträge (nur Rüstungsfirmen im Sandkasten): verdeckt bieten in
 * Prozent des Listenpreises, als Gewinner innerhalb der Frist liefern. */
function ruestHtml(me, state, my) {
  const R = state.stadt?.ruest;
  if (!R || !(my?.industries || [my?.industry]).includes("ruestung")) return "";
  const tick = state.tick || 0, myId = store.get().myId, regel = R.regeln;
  const auftrag = a => {
    const liste = Object.entries(a.needs);
    if (a.phase === "bieten") {
      const mein = me.ruestGebote?.[a.id];
      return `<div class="stAuftrag"><div class="faPKopf"><b>${t("Ausschreibung")}: ${t(a.name)}</b><span class="meta">${t("Gebote noch")} ${Math.max(0, a.bisBieten - tick)} s · ${a.gebote} ${t("Gebote")}</span></div>
        <div class="meta">${liste.map(([g, n]) => `${n.req}× ${gname(g)} (${t("Lager")} ${Math.floor(me.inv?.[g] || 0)})`).join(" · ")}</div>
        <div class="faPFuss"><span class="meta">${mein ? `${t("Dein Gebot")}: ${mein} %` : `${regel.min}–${regel.max} ${t("% vom Listenpreis")}`}</span>
          <input type="number" min="${regel.min}" max="${regel.max}" id="rg-${a.id}" value="${mein || 105}">
          <button class="buyb" data-rgebot="${a.id}">${t(mein ? "Gebot ändern" : "Bieten")}</button></div></div>`;
    }
    const meins = a.gewinner === myId;
    return `<div class="stAuftrag"><div class="faPKopf"><b>${t("Lieferung")}: ${t(a.name)}</b><span class="meta">${t("Zuschlag an")} ${meins ? t("dich") : a.gewinnerName} · ${a.prozent} % · ${t("Frist noch")} ${Math.max(0, a.frist - tick)} s</span></div>
      ${liste.map(([g, n]) => `<div class="faProjekt">
        <div class="faPKopf"><b>${gname(g)}</b><span class="meta">${n.have} / ${n.req} · ${fp(a.preise[g])}/Stk</span></div>
        <div class="faBalken"><i style="width:${Math.min(100, n.have / n.req * 100).toFixed(1)}%"></i></div>
        ${meins ? `<div class="faPFuss"><span class="meta">${t("Lager")}: ${Math.floor(me.inv?.[g] || 0)}</span>
          <button class="buyb" data-rliefer="${a.id}" data-rlg="${g}" ${(me.inv?.[g] || 0) < 1 || n.have >= n.req ? "disabled" : ""}>${t("Liefern")}</button></div>` : ""}</div>`).join("")}</div>`;
  };
  return `<div class="sec">${t("Rüstungsaufträge")} <span class="meta">· ${t("Lieferruf")} ${R.ruf?.[myId] ?? 100}</span></div>
    ${R.auftraege.length ? R.auftraege.map(auftrag).join("") : `<div class="kzrow"><span>${t("Nächste Ausschreibung in")}</span><b>${Math.max(0, (R.naechste || tick) - tick)} s</b></div>`}
    <div class="meta" style="padding:4px 0 6px">${t("Das günstigste Gebot gewinnt, gewichtet mit dem Lieferruf. Wer nicht rechtzeitig liefert, zahlt 20 % des fehlenden Werts als Strafe und verliert Ruf.")}</div>
    ${(R.log || []).length ? `<div class="stLog">${R.log.slice(0, 4).map(l => `<div class="meta">Min ${Math.floor(l.tick / 60)} · ${l.text}</div>`).join("")}</div>` : ""}`;
}
/* Lexikon-Gruppe „Stadt & Arbeit“ (nur wenn die Stadt in diesem Modus wächst) */
function stadtLexikon() {
  const S = store.get().state?.stadt;
  if (!S) return "";
  return `<details class="lexGruppe" data-lex="lex-stadt" ${LEX_OFFEN.has("lex-stadt") ? "open" : ""}><summary>${t("Stadt & Arbeit")}<span>8</span></summary>
    <div class="sec">${t("Wohnblöcke der Stadt")}</div>
    <table><tr><th>${t("Stufe")}</th><th>${t("Plätze")}</th><th>${t("Kosten")}</th><th>${t("ab Einwohnern")}</th></tr>
    ${S.stufen.map(x => `<tr><td>${t(x.name)}</td><td>${x.plaetze}</td><td>${fmt(x.kosten)}</td><td>${x.ab || "—"}</td></tr>`).join("")}</table>
    <div class="sec">${t("Arbeiter")}</div>
    <p class="meta">${t("Rund 1 Arbeiter je 250 $ Baukosten (2 bis 30), +50 % je Ausbaustufe. Leistung = Besetzung, unter 25 % Stillstand. Labor, Studio und Chipfabrik: die Hälfte Fachkräfte. Steuerungssoftware: −25 %.")}</p>
    <div class="sec">${t("Löhne")}</div>
    <table>${Object.values(S.loehne).map(l => `<tr><td>${t(l.name)}</td><td style="text-align:right">${l.lohn} $ ${t("je Arbeiter/min")}</td></tr>`).join("")}</table>
    <p class="meta">${t("30 % der Löhne gehen als Lohnsteuer und Miete an die Stadt, 20 % ins Bürgerdepot.")}</p>
    <div class="sec">${t("Bürger-Apps und Jobbörse")}</div>
    <p class="meta">${t("Bürger-App: bis 85 % der Einwohner zahlen ein Abo je Minute, 200 Nutzer je Rechenzentrums-Stufe des Anbieters. Jobbörse: Vorrang wie +0,3 bis +0,7 Lohnstufen gegen eine Gebühr je Arbeiter, 3 Abos je Rechenzentrums-Stufe.")}</p>
    <div class="sec">${t("Gäste und Hotels")}</div>
    <p class="meta">${t("Jede Minute 10 Gäste plus 4 je 100 Einwohner, mal Zufriedenheit. Sie wählen nach Bewertung und Zimmerpreis; wer zu teuer ist, verliert Gäste an andere Urlaubsorte. Strandhotel 2 bis 5 Sterne (Renovieren 1.500 / 3.000 / 5.000 $), ab 3 Sternen Frühstück für 3 / 5 / 8 $ je Gast. Stadtfeste: +60 bis +150 % Gäste für 5 bis 8 Minuten.")}</p>
    <div class="sec">${t("Websites und Rechenzentren")}</div>
    <p class="meta">${t("Software-Firmen entwickeln einen Website-Baukasten (Grundseite, Branchenportal, Aktionen). Andere Firmen zahlen 400 $ Einrichtung und ein Abo je Minute und bekommen +5 / +10 / +15 % Reichweite: schneller verkaufen, mehr Gäste, mehr Grundbedarf. Je Rechenzentrums-Stufe 2 Websites; der Anbieter verteilt seine Plätze selbst. Ohne Anbieter: Stadtportal-Grundseite für 600 $ und 45 $/min.")}</p>
    <div class="sec">${t("Stadtnetz und Branchenportale")}</div>
    <p class="meta">${t("Im Stadtnetz stehen alle Firmen mit Website, sortiert nach Besuchern. Branchenportal: Direktkauf zum Ø-Kurs plus 5 % (Hofladen, Großhandel, Baustoff-Portal, Kundenportal), Rohstoff +5 % auf Wohnbau-Lieferungen, Rüstung 5 % günstigere Gebote, +15 % je Lieferung und häufigere Ausschreibungen. Aktionen: 600 $, 5 Minuten +25 % Reichweite, danach 15 Minuten Pause.")}</p>
    <div class="sec">${t("Stadtanleihen")}</div>
    <p class="meta">${fmt(S.anleihe.betrag)} · ${String(S.anleihe.zins * 100).replace(".", ",")} %/min · ${S.anleihe.laufzeit / 60} min · ${t("höchstens")} ${fmt(S.anleihe.max)} ${t("Schulden")}</p>
  </details>`;
}
/* Wohnbau-Aufträge der Stadt (Etappe 3): Baumaterial liefern, die Stadt zahlt
 * 15 % über Kurs. Nach Ablauf der Frist kauft sie den Rest teurer anderswo. */
function wohnAuftraegeHtml(S, me) {
  if (!S.auftraege?.length) return "";
  const tick = store.get().state?.tick || 0;
  return `<div class="sec">${t("Baumaterial für die Stadt")} <span class="meta">· ${t("15 % über Kurs, bezahlt sofort")}</span></div>` + S.auftraege.map(a => `
    <div class="stAuftrag"><div class="faPKopf"><b>${t(a.name)}</b><span class="meta">${t("noch")} ${Math.max(0, a.frist - tick)} s · ${t("danach kauft die Stadt den Rest anderswo")}</span></div>
    ${Object.entries(a.needs).map(([g, n]) => `<div class="faProjekt">
      <div class="faPKopf"><b>${gname(g)}</b><span class="meta">${n.have} / ${n.req} · ${fp(n.pay)}/Stk</span></div>
      <div class="faBalken"><i style="width:${Math.min(100, n.have / n.req * 100).toFixed(1)}%"></i></div>
      <div class="faPFuss"><span class="meta">${t("Lager")}: ${Math.floor(me.inv?.[g] || 0)}</span>
        <input type="number" min="1" id="wb-${a.id}-${g}" placeholder="${t("Menge")}">
        <button class="buyb" data-wb="${a.id}" data-wbg="${g}" ${(me.inv?.[g] || 0) < 1 || n.have >= n.req ? "disabled" : ""}>${t("Liefern")}</button></div></div>`).join("")}
    ${Object.keys(a.contrib).length ? `<div class="faLieferanten">${Object.values(a.contrib).map(c => `<span style="--f:${c.color || "#888"}">${c.name}</span>`).join("")}</div>` : ""}</div>`).join("");
}
/* Stadtübersicht (nur Sandkasten): Einwohner, Wohnungen, Zufriedenheit und
 * was die Stadt gerade baut. Steht oben im Finanzamt, weil die Stadtkasse den
 * Wohnbau bezahlt. */
function stadtHtml(S, F, me = {}) {
  if (!S) return "";
  const vz = n => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(Math.round(n * 100)) + " %";
  const A = S.arbeit;
  const bewegung = S.wegzug ? `−${S.wegzug} ${t("Wegzug letzte Minute")}` : `+${S.zuzug} ${t("Zuzug letzte Minute")}`;
  const v = S.verlauf || [], emax = Math.max(...v.map(p => p.e), 1), emin = Math.min(...v.map(p => p.e), emax);
  const spanne = Math.max(1, emax - emin), lin = v.length > 1
    ? v.map((p, i) => `${(i / (v.length - 1) * 300).toFixed(1)},${(52 - (p.e - emin) / spanne * 44).toFixed(1)}`).join(" ") : "";
  const status = S.baustellen ? `${S.baustellen} ${t(S.baustellen === 1 ? "Baustelle läuft" : "Baustellen laufen")}`
    : S.wartetAufGeld ? `${t("Wartet auf Geld")}: ${fmt(S.wartetAufGeld)}`
    : S.frei > 0 ? t("Genug freie Wohnungen") : t("Kein Bauland mehr frei");
  return `
    <div class="sec">${t("Die Stadt")} <span class="meta">· ${t("baut Wohnungen aus der Stadtkasse, Bewohner ziehen zu")}</span></div>
    <div class="faKonten stKonten">
      <div class="faKonto"><span>${t("Einwohner")}</span><b>${S.einwohner.toLocaleString("de-DE")}</b><em>${bewegung}</em></div>
      <div class="faKonto"><span>${t("Wohnungen")}</span><b>${(S.kapazitaet - S.frei).toLocaleString("de-DE")} / ${S.kapazitaet.toLocaleString("de-DE")}</b><em>${S.frei} ${t("frei")} · ${S.bloecke.map((n, i) => n ? `${n}× ${t(S.stufen[i].name)}` : "").filter(Boolean).join(", ")}</em>
        <div class="faBalken"><i style="width:${Math.min(100, (S.kapazitaet - S.frei) / Math.max(1, S.kapazitaet) * 100).toFixed(1)}%"></i></div></div>
      <div class="faKonto"><span>${t("Zufriedenheit")}</span><b>×${S.zufr.toFixed(2).replace(".", ",")}</b><em>${S.zufr < 0.7 ? t("Bewohner ziehen weg") : t("bremst oder beschleunigt den Zuzug")}</em></div>
    </div>
    ${lin ? `<svg class="stVerlauf" viewBox="0 0 300 56" preserveAspectRatio="none" aria-label="${t("Einwohnerverlauf")}"><polyline points="${lin}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="meta stAchse"><span>${emin.toLocaleString("de-DE")}</span><span>${t("Einwohner im Verlauf der Runde")}</span><span>${emax.toLocaleString("de-DE")}</span></div>` : ""}
    <div class="stTeile">${(S.teile || []).map(x => `<div class="kzrow"><span>${t(x.name)} <span class="meta">· ${t(x.text)}</span></span><b class="${x.wirkung < 0 ? "stMinus" : x.wirkung > 0 ? "stPlus" : "meta"}">${vz(x.wirkung)}</b></div>`).join("")}</div>
    <div class="kzrow"><span>${t("Wohnbau")} <span class="meta">· ${t("Kasse bleibt über")} ${fmt(S.kasseMin)}</span></span><b class="meta">${status}</b></div>
    <div class="sec">${t("Arbeitsmarkt")} <span class="meta">· ${Math.round(S.quote * 100)} % ${t("der Einwohner arbeiten")}</span></div>
    <div class="stArbeit"><div class="stArbeitBalken" title="${t("Beschäftigt / Stellen")}"><i style="width:${Math.min(100, A.beschaeftigt / Math.max(1, A.bedarf, A.faehig) * 100).toFixed(1)}%"></i>${A.bedarf > A.faehig ? `<em style="left:${(A.faehig / A.bedarf * 100).toFixed(1)}%"></em>` : ""}</div>
      <div class="meta stAchse"><span>${A.beschaeftigt.toLocaleString("de-DE")} ${t("beschäftigt")}</span><span>${A.offen ? `${A.offen} ${t("Stellen offen")}` : `${A.arbeitslos} ${t("arbeitslos")}`}</span><span>${A.bedarf.toLocaleString("de-DE")} ${t("Stellen")}</span></div></div>
    <div class="kzrow"><span>${t("Löhne aller Firmen")}</span><b>${fmt(A.lohnsumme)}/min</b></div>
    <div class="kzrow"><span>${t("Lohnsteuer + Miete an die Stadt")} <span class="meta">· ${Math.round((S.anteile.steuer + S.anteile.miete) * 100)} % ${t("der Löhne")}</span></span><b>${fmt(A.lohnsteuer + A.miete)}/min</b></div>
    ${A.stuetze ? `<div class="kzrow"><span>${t("Stütze für Arbeitslose")}</span><b class="stMinus">−${fmt(A.stuetze)}/min</b></div>` : ""}
    ${S.appNutzer ? `<div class="kzrow"><span>${t("Bürger-Apps")} <span class="meta">· ${t("ab der Hälfte der Einwohner: Digitale Stadt +5 %")}</span></span><b>${S.appNutzer} ${t("Nutzer")}</b></div>` : ""}
    ${S.fach ? `<div class="kzrow"><span>${t("Fachkräfte")} <span class="meta">· ${Math.round(S.fach.quote * 100)} % ${t("der Arbeitenden, mehr durch die Stadtbibliothek")}</span></span><b>${S.fach.besetzt} / ${S.fach.bedarf} ${t("Stellen")}</b></div>` : ""}
    ${S.schulden ? `<div class="kzrow"><span>${t("Stadtanleihen")} <span class="meta">· ${t("gezeichnet, an der Stadtbank")}</span></span><b class="stMinus">${fmt(S.schulden)}</b></div>` : ""}
    ${wohnAuftraegeHtml(S, me)}
    <div class="kzrow"><span>${t("Nachfrage in den Läden")} <span class="meta">· ${t("wächst mit der Einwohnerzahl")}</span></span><b>×${String(S.nachfrage).replace(".", ",")}</b></div>
    ${(S.log || []).length ? `<div class="stLog">${S.log.slice(0, 4).map(l => `<div class="meta">Min ${Math.floor(l.tick / 60)} · ${l.text}</div>`).join("")}</div>` : ""}`;
}
function finanzamtRendern(state, me, myId) {
  const F = state.finanzamt, el = document.getElementById("finanzamtbody");
  if (!F?.aktiv) { el.innerHTML = `<div class="meta">In diesem Modus gibt es kein Finanzamt.</div>`; return; }
  /* Perf: Nur rendern wenn sich was ändert (Stadtkasse, Finanzamt-Sätze, etc.) */
  const PP = state.stadtprojekt;
  const sig = JSON.stringify([F, state.stadt, ["ziegel", "beton", "stahl", "elektronik"].map(g => Math.floor(me.inv?.[g] || 0)), me.steuer, PP, PP ? Object.keys(PP.needs).map(g => Math.floor(me.inv[g] || 0)) : 0, SPRACHE]);
  if (finanzamtRendern.lastSig === sig) return;
  finanzamtRendern.lastSig = sig;
  const uhr = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
  const st = me.steuer || {};
  const P = state.stadtprojekt;
  const pct = n => Math.min(100, n.have / n.req * 100);
  el.innerHTML = `${stadtHtml(state.stadt, F, me)}
    <div class="faKonten">
      <div class="faKonto"><span>Stadtkasse</span><b>${fmt(F.stadtkasse)}</b><em>${P ? "Projekt läuft" : F.stadtkasse >= F.schwelle ? "Projekt kommt gleich" : `Stadtprojekt ab ${fmt(F.schwelle)}`}</em>
        <div class="faBalken"><i style="width:${Math.min(100, F.stadtkasse / F.schwelle * 100).toFixed(1)}%"></i></div></div>
      <div class="faKonto"><span>Bankreserve</span><b>${fmt(F.reserve)}</b><em>Gegenpartei der Kurswetten</em></div>
    </div>
    <div class="sec">Steuerlage der Stadt <span class="meta">· Kasse + Bankreserve über Start: ${fmt(F.lage)}</span></div>
    <div class="faLage">${F.stufen.map(s => `<div class="faStufe${s.key === F.stufe ? " on" : ""}" data-stufe="${s.key}">
        <b>${s.faktor === 1 ? "±0" : (s.faktor > 1 ? "+" : "−") + Math.round(Math.abs(s.faktor - 1) * 100)} %</b><span>${s.name}</span></div>`).join("")}</div>
    <div class="meta faLageText">Ab 20.000 $ gelten die normalen Sätze. Darunter steigen sie: bis 3.000 $ um 10 %, darunter um 25 % (Notstand). Die 20.000 $ Grundstock fasst die Stadt nie an — die Lage sinkt nur, wenn die Bank bei Kurswetten verliert. Geprüft wird jede Minute.</div>
    <div class="sec">Dein Steuerbescheid <span class="meta">· nächster in ${uhr(F.naechsterIn)}</span></div>
    <div class="faBescheid">
      <div class="kzrow"><span>Gewinn seit dem letzten Bescheid</span><b>${fmt(st.gewinn || 0)}</b></div>
      <div class="kzrow"><span>Freibetrag</span><b>−${fmt(F.frei)}</b></div>
      <div class="kzrow"><span>Voraussichtliche Steuer (${Math.round(F.satz * 1000) / 10} %)</span><b class="faSteuer">${fmt(st.steuer || 0)}</b></div>
      ${st.schuld ? `<div class="kzrow"><span>davon gestundet aus dem letzten Bescheid</span><b>${fmt(st.schuld)}</b></div>` : ""}
      <div class="meta" style="padding-top:6px">Einkauf und Werbung senken den Gewinn sofort, Bau und Ausbau verteilt über ${Math.round((store.get().state?.marktCfg?.afaDauer || 1800) / 60)} min (Abschreibung). Zuletzt gezahlt: ${st.letzter ? fmt(st.letzter.steuer) : "—"} · insgesamt ${fmt(st.gezahlt || 0)}.</div>
    </div>
    ${P ? `<div class="sec">Stadtprojekt: ${P.name} <span class="meta">· Budget ${fmt(P.budget)} · noch ${uhr(P.ttl)}</span></div>
      ${Object.entries(P.needs).map(([g, n]) => {
        const meins = P.contrib[myId]?.goods?.[g] || 0;
        return `<div class="faProjekt">
          <div class="faPKopf"><b>${gname(g)}</b><span class="meta">${n.have} / ${n.req}${meins ? ` · von dir ${meins}` : ""} · ${fp(n.pay)}/Stk</span></div>
          <div class="faBalken"><i style="width:${pct(n).toFixed(1)}%"></i></div>
          <div class="faPFuss"><span class="meta">Lager: ${Math.floor(me.inv[g] || 0)}</span>
            <input type="number" min="1" id="sp-${g}" placeholder="Menge">
            <button class="buyb" data-sp="${g}" ${(me.inv[g] || 0) < 1 || n.have >= n.req ? "disabled" : ""}>Liefern</button></div></div>`; }).join("")}
      <div class="faLieferanten">${Object.values(P.contrib).map(c => `<span style="--f:${c.color || "#888"}">${c.name}${c.bot ? " · Bot" : ""}</span>`).join("") || `<span class="meta">Noch keine Lieferungen — Spieler und Bots liefern gemeinsam.</span>`}</div>` : ""}
    <div class="sec">Portfolio des Finanzamts <span class="meta">· nur Branchenfonds</span></div>
    ${(F.portfolio || []).length ? `<div class="faPortfolio">${F.portfolio.map(f => `<div class="kzrow"><span>${f.fonds}-Fonds <span class="meta">· ${f.anteile} Anteile</span></span><b>${fmt(f.wert)} <span class="meta">Buchwert ${fmt(f.buchwert)}</span></b></div>`).join("")}</div>`
      : `<div class="meta">Noch keine Fondsanteile.</div>`}
    <div class="meta faLageText">Das Finanzamt kauft keine einzelnen Aktien, nur Anteile der Branchenfonds. Sobald Geld übrig ist, investiert es — verteilt auf alle Branchen, unterbewertete bekommen mehr. Der Fonds kauft damit echte Aktien und hebt die Kurse der Branche. Liegen sie mehr als ${Math.round((F.theta ?? 0.1) * 100)} % darüber, gibt es Anteile zurück. Bezahlt wird nur mit Geld über der Projektschwelle — Stadtprojekte gehen vor.</div>
    <div class="sec">So arbeitet das Finanzamt</div>
    <div class="faRegeln">
      <div><b>${Math.round(F.satz * 1000) / 10} %</b><span>Gewinnsteuer alle 10 min, die ersten ${fmt(F.frei)} frei</span></div>
      <div><b>${Math.round(F.boerse * 1000) / 10} %</b><span>Börsengebühr vom Erlös jedes Verkaufs an der Warenbörse</span></div>
      <div><b>${Math.round(F.wettSteuer * 1000) / 10} %</b><span>auf Gewinne aus Kurswetten</span></div>
      <div><b>${Math.round(F.reserveAnteil * 100)} / ${Math.round(100 - F.reserveAnteil * 100)}</b><span>Bankreserve / Stadtkasse</span></div>
      <div><b>${Math.round(F.praemieAnteil * 100)} %</b><span>des Geldes über dem Grundstock als Prämie je Großauftrag${F.praemieMax ? `, höchstens ${fmt(F.praemieMax)}` : ""}</span></div>
    </div>
    ${F.fertig.length ? `<div class="sec">Gebaute Stadtprojekte</div>${F.fertig.map(f => `<div class="kzrow"><span>${f.name}</span><b class="meta">${f.lieferanten.join(", ")}</b></div>`).join("")}` : ""}
    <div class="meta" style="padding-top:10px">Insgesamt eingenommen: ${fmt(F.gesamt)} — alle Firmen zahlen, auch die Bots.</div>`;
}
document.getElementById("einw").addEventListener("click", () => openPanel("finanzamt"));
document.getElementById("finanzamtbody").addEventListener("click", e => {
  const wb = e.target.closest("[data-wb]");
  if (wb) {
    const g = wb.dataset.wbg, me = store.get().me;
    return act("wohnbauLiefern", { id: +wb.dataset.wb, good: g, qty: +document.getElementById(`wb-${wb.dataset.wb}-${g}`).value || Math.floor(me.inv[g] || 0) });
  }
  const b = e.target.closest("[data-sp]");
  if (!b) return;
  const g = b.dataset.sp, me = store.get().me;
  act("projektLiefern", { good: g, qty: +document.getElementById("sp-" + g).value || Math.floor(me.inv[g] || 0) });
});
/* ---------- Kurswetten ----------
 * Long = man setzt auf steigenden Firmenwert, Short auf fallenden. Der Server
 * friert die Werte beim Ende der Annahme ein und rechnet nach der Laufzeit ab.
 * Verlierer zahlen Einsatz × min(1, |Änderung| × Hebel) an die Gewinnerseite. */
let W_RICHTUNG = "long";
const zeitFmt = s => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
function kurswettenRendern() {
  const S = store.get(), state = S.state, me = S.me || {}, myId = S.myId;
  const R = state?.wettrunde;
  if (!R || !document.getElementById("wKopf")) return;
  const annahme = R.phase === "annahme";
  const meine = me.meineWetten || [];
  document.getElementById("bReiterWetten").textContent = meine.length ? meine.length : "";
  const anteil = 1 - R.rest / R.dauer;
  document.getElementById("wKopf").innerHTML = `<div class="wPhase ${annahme ? "offen" : "laeuft"}">
      <div class="wPhaseText"><span class="wPunkt"></span><b>Runde ${R.nr} · ${annahme ? "Annahme offen" : "Läuft — Kurse eingefroren"}</b>
        <span class="wUhr">${zeitFmt(R.rest)}</span></div>
      <div class="wBalken"><i style="width:${(anteil * 100).toFixed(1)}%"></i></div>
      <div class="meta">${annahme ? "Wetten setzen bis zum Ende der Annahme, danach 5 min Laufzeit." : "Abrechnung, wenn die Uhr abläuft. Neue Wetten ab der nächsten Annahme."}
        Hebel ×${R.hebel}: bei ${Math.round(100 / R.hebel)} % Bewegung ist der ganze Einsatz im Spiel · ${Math.round(R.gebuehr * 100)} % Bankgebühr.</div>
      <div class="wReserve"><span>Bank als Gegenpartei</span><b>${fmt(R.reserve ?? 0)}</b><em>Reserve — füllt beim Einfrieren die kleinere Seite auf</em></div></div>`;

  /* Formular: nur Firmen, auf die man wetten darf */
  const sel = document.getElementById("wFirma"), vorher = sel.value;
  const meinName = state.players[myId]?.name;
  const erlaubt = R.firmen.filter(f => f.id !== myId && (state.players[f.id]?.equity?.[meinName] || 0) < 50);
  const opts = erlaubt.map(f => `<option value="${f.id}">${f.name}</option>`).join("") || `<option value="">Keine Firma verfügbar</option>`;
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  if (erlaubt.some(f => f.id === vorher)) sel.value = vorher;
  const ziel = R.firmen.find(f => f.id === sel.value);
  const eigene = meine.find(w => w.firmaId === sel.value);
  if (eigene) W_RICHTUNG = eigene.richtung;
  document.querySelectorAll("[data-wrichtung]").forEach(b => {
    b.classList.toggle("on", b.dataset.wrichtung === W_RICHTUNG);
    b.disabled = !!eigene && b.dataset.wrichtung !== eigene.richtung; });
  const einsatz = +document.getElementById("wEinsatz").value || 0;
  document.getElementById("wForm").hidden = !annahme;
  const knopf = document.getElementById("wSetzen");
  knopf.disabled = !annahme || !ziel;
  knopf.textContent = !annahme ? `Annahme wieder in ${zeitFmt(R.rest)}` : eigene ? "Einsatz erhöhen" : "Wette setzen";
  knopf.classList.toggle("kauf", W_RICHTUNG === "long"); knopf.classList.toggle("verkauf", W_RICHTUNG === "short");
  /* Vorschau: was bei ±5 % Bewegung herauskäme — mit den aktuellen Töpfen */
  let vorschau = "";
  if (ziel && einsatz > 0) {
    const eigen = (W_RICHTUNG === "long" ? ziel.long : ziel.short) + einsatz;
    /* Die Bank füllt beim Einfrieren die kleinere Seite auf (max. 25 % ihrer Reserve) */
    const gegenSpieler = W_RICHTUNG === "long" ? ziel.short : ziel.long;
    const gegen = gegenSpieler + Math.max(0, Math.min(eigen - gegenSpieler, (R.reserve || 0) * 0.25));
    const bew = 0.05, teil = Math.min(1, bew * R.hebel);
    const plus = gegen * teil * (1 - R.gebuehr) * einsatz / eigen;
    vorschau = gegen
      ? `<span>Bei 5 % ${W_RICHTUNG === "long" ? "Anstieg" : "Rückgang"}</span><b class="plus">+${fmt(plus)}</b>
         <span>Bei 5 % Gegenbewegung</span><b class="minus">−${fmt(einsatz * teil)}</b>`
      : `<span class="meta" style="grid-column:1/-1">Die Bankreserve ist leer — ohne Gegenwette gibt es den Einsatz zurück.</span>`;
    if (gegen > gegenSpieler + 1) vorschau += `<span class="meta" style="grid-column:1/-1">inkl. ${fmt(gegen - gegenSpieler)} von der Bank auf der Gegenseite</span>`;
    vorschau += `<span>Dein Rahmen</span><b>${fmt(me.wettMax || 0)}</b>`;
  }
  document.getElementById("wVorschau").innerHTML = vorschau;

  /* Firmenliste mit Töpfen */
  const firmen = [...R.firmen].sort((a, b) => (b.long + b.short) - (a.long + a.short) || b.jetzt - a.jetzt);
  document.getElementById("wFirmen").innerHTML = `<div class="sec bTafelKopf"><span>Firmen</span><span class="meta">${annahme ? "Long gegen Short — antippen zum Auswählen" : "Änderung seit Rundenstart"}</span></div>` +
    firmen.map(f => {
      const sum = f.long + f.short, lp = sum ? f.long / sum * 100 : 50;
      const aend = f.start ? (f.jetzt - f.start) / f.start * 100 : null;
      const mw = meine.find(w => w.firmaId === f.id);
      const gesperrt = f.id === myId || (state.players[f.id]?.equity?.[meinName] || 0) >= 50;
      return `<div class="wFirma${f.id === sel.value ? " gewaehlt" : ""}${gesperrt ? " gesperrt" : ""}" ${gesperrt ? "" : `data-wfirma="${f.id}"`}>
        <div class="wFKopf">${firmenMarke(f.name, f.farbe, 28)}${f.id === myId ? ` <span class="meta">(du)</span>` : ""}
          <span class="wWert">${fmt(f.jetzt)}${aend != null ? ` <em class="${aend >= 0 ? "plus" : "minus"}">${aend >= 0 ? "+" : ""}${aend.toFixed(1)} %</em>` : ""}</span></div>
        <div class="wPool"><span class="l">▲ ${fmt(f.long)}</span><div class="wPoolBar${sum ? "" : " leer"}"><i style="width:${lp}%"></i></div><span class="s">${fmt(f.short)} ▼</span></div>
        ${f.bank ? `<div class="wBank">Bank hält ${f.bank.richtung === "long" ? "▲ Long" : "▼ Short"} · ${fmt(f.bank.einsatz)}</div>` : ""}
        ${mw ? `<div class="wMein ${mw.richtung}">Deine Wette: ${mw.richtung === "long" ? "▲ Long" : "▼ Short"} · ${fmt(mw.einsatz)}</div>` : ""}
      </div>`; }).join("");

  /* Ergebnisse */
  const log = me.wettLog || [];
  const letzte = (R.letzte || []).filter(e => e.gewinner);
  document.getElementById("wMeine").innerHTML =
    (log.length ? `<div class="sec">Deine Ergebnisse</div>` + log.map(e => {
      const d = e.auszahlung - e.einsatz;
      return `<div class="wErg"><span>R${e.runde} · ${e.firma} · ${e.richtung === "long" ? "▲ Long" : "▼ Short"} · ${fmt(e.einsatz)}</span>
        <b class="${d > 0 ? "plus" : d < 0 ? "minus" : ""}">${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt(Math.abs(d))}</b></div>`; }).join("") : "") +
    (letzte.length ? `<div class="sec">Letzte Runde</div>` + letzte.map(e => `<div class="wErg"><span>${e.name} · ${e.aenderung >= 0 ? "+" : ""}${(e.aenderung * 100).toFixed(1)} %</span>
        <b>${e.gewinner === "long" ? "▲ Long gewinnt" : "▼ Short gewinnt"} · ${fmt(e.topf)}</b></div>`).join("") : "");
}
document.getElementById("wFirma").addEventListener("change", kurswettenRendern);
document.getElementById("wEinsatz").addEventListener("input", kurswettenRendern);
document.getElementById("wSetzen").addEventListener("click", () => act("kurswetteSetzen", {
  firmaId: document.getElementById("wFirma").value, richtung: W_RICHTUNG,
  einsatz: +document.getElementById("wEinsatz").value }));
document.getElementById("bidSend").addEventListener("click", () => act("bidShares", {
  companyId: document.getElementById("bidCompany").value,
  count: document.getElementById("bidCount").value,
  price: document.getElementById("bidPrice").value }));
document.getElementById("shKurs").addEventListener("click", () => {
  const n = Math.max(1, Math.floor(+document.getElementById("shCount").value) || 1);
  if (!shKursSel) return toast("Erst eine Firma mit Aktien wählen", true);
  document.getElementById("shPrice").value = Math.max(1, Math.round(shKursSel * n));
  document.getElementById("shHint").textContent = `Kurs ${fk(shKursSel)} je Aktie → ${n} Aktien ≈ ${fmt(shKursSel * n)}. Angeboten zum Kurs.`;
  SFX.spiel("klick");
});
document.getElementById("shList").addEventListener("click", () => act("listShares", {
  companyId: document.getElementById("shCompany").value || null,
  count: document.getElementById("shCount").value, price: document.getElementById("shPrice").value,
  toId: document.getElementById("shTo").value || null }));
document.getElementById("chatform").addEventListener("submit", e => {
  e.preventDefault(); const inp = document.getElementById("chatin");
  if (inp.value.trim()) act("chat", { room: store.get().room, text: inp.value });
  inp.value = ""; });
document.getElementById("cSend").addEventListener("click", () => act("offerContract", {
  toId: document.getElementById("cTo").value, good: document.getElementById("cGood").value,
  qty: document.getElementById("cQty").value, price: document.getElementById("cPrice").value }));

/* ================================================================
 * Hintergrundmusik: 3 Tracks in zufälliger Reihenfolge, Endlosschleife.
 * Start beim Beitreten (Klick = erlaubte User-Geste für Autoplay).
 * ================================================================ */
const MUSIC = (() => {
  /* Eine durchgehende Naturkulisse statt wechselnder Musikstuecke. Sie laeuft
   * in Schleife; ein Titelwechsel gibt es nicht mehr. Als AAC statt MP3, weil
   * die Vorlage als 256-kbit-MP3 18 MB gross war — jeder Mitspieler laedt die
   * Datei, und fuer Naturambiente sind 128 kbit reichlich. */
  const AMBIENTE = "assets/music/ambience.m4a";
  let started = false;
  const audio = new Audio();
  /* Ohne gespeicherten Wert liefert getItem null — und +null ist 0, was die
   * Bereichsprüfung anstandslos passiert hat. Jeder neue Besucher startete
   * dadurch auf Lautstärke 0 statt auf den gedachten 22, also komplett stumm.
   * Deshalb erst auf "gar nichts gespeichert" prüfen. */
  let vol = 22;
  try {
    const roh = localStorage.getItem("cs_vol");
    if (roh !== null && roh !== "") { const v = +roh; if (Number.isFinite(v) && v >= 0 && v <= 100) vol = v; }
  } catch {}
  audio.volume = vol / 100;
  let muted = false; try { muted = localStorage.getItem("cs_muted") === "1"; } catch {}
  const btn = document.getElementById("music");
  const volSlider = document.getElementById("musicVol");
  const pill = document.getElementById("tonPill");
  const wertEl = document.getElementById("tonWert");
  volSlider.value = vol;
  /* Fuellstand und Zahlenwert nachziehen. Der Balken kann seinen Stand nicht
   * von selbst kennen — die CSS-Variable traegt ihn. */
  const reglerMalen = () => {
    volSlider.style.setProperty("--fuell", (muted ? 0 : vol) + "%");
    wertEl.textContent = muted ? "stumm" : vol + " %";
    pill.classList.toggle("stumm", muted || vol === 0);
  };
  /* Waehrend des Ziehens den Wert eingeblendet lassen, auch wenn der Zeiger
   * die schmale Leiste kurz verlaesst. */
  ["pointerdown", "touchstart"].forEach(e => volSlider.addEventListener(e, () => pill.classList.add("zieht")));
  ["pointerup", "touchend", "pointercancel"].forEach(e =>
    window.addEventListener(e, () => pill.classList.remove("zieht")));
  /* Lautsprecher als schlankes Inline-SVG — Wellen je nach Lautstärke, durchgestrichen bei stumm */
  const icon = state => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" fill="currentColor" stroke="none"/>
      ${state === "off" ? `<path d="M16 9.5l5 5m0-5l-5 5"/>`
        : state === "low" ? `<path d="M16 9.6a3.4 3.4 0 010 4.8"/>`
        : `<path d="M16 9.6a3.4 3.4 0 010 4.8"/><path d="M18.6 7a7 7 0 010 10"/>`}
    </svg>`;
  const paint = () => { btn.innerHTML = icon(muted || vol === 0 ? "off" : vol < 50 ? "low" : "high"); reglerMalen(); };
  paint();
  const next = () => { if (audio.src.indexOf(AMBIENTE) < 0) audio.src = AMBIENTE;
    if (!muted) audio.play().catch(() => {}); };
  audio.loop = true;
  btn.addEventListener("click", () => {
    muted = !muted; try { localStorage.setItem("cs_muted", muted ? "1" : "0"); } catch {}
    paint();
    if (muted) audio.pause();
    else { if (!audio.src) next(); else audio.play().catch(() => {}); }
  });
  volSlider.addEventListener("input", () => {
    vol = +volSlider.value; audio.volume = vol / 100;
    try { localStorage.setItem("cs_vol", vol); } catch {}
    if (muted && vol > 0) { muted = false; try { localStorage.setItem("cs_muted", "0"); } catch {}
      if (!audio.src) next(); else audio.play().catch(() => {}); }
    paint();
  });
  /* Für das Einstellungsfenster: gleiche Wirkung wie Knopf und Regler oben. */
  const setStumm = an => { if (an !== muted) btn.click(); };
  const setVol = v => { volSlider.value = v; volSlider.dispatchEvent(new Event("input")); };
  return {
    setStumm, setVol, istAus: () => muted, vol: () => vol,
    start() { if (started) return; started = true; if (!muted) next(); },
    /* Die Soundeffekte hängen an derselben Stummschaltung und demselben Regler —
     * zwei getrennte Regler für ein Spiel dieser Größe wären Überbau. */
    istStumm: () => muted || vol === 0,
    lautstaerke: () => vol / 100,
  };
})();

/* ================================================================
 * Soundeffekte: Klick, Bauen, Geld.
 * ================================================================
 * Drei kurze Klänge, die an den Ausgang echter Aktionen gekoppelt sind —
 * gespielt wird erst, wenn der Server bestätigt hat, nie schon beim Klick.
 * Eine fehlgeschlagene Order soll nicht nach Erfolg klingen. */
const SFX = (() => {
  const DATEIEN = { klick: "klick", bau: "bau", geld: "geld", hinweis: "hinweis" };
  /* Je Klang mehrere Audio-Objekte im Wechsel: sonst schneidet ein schneller
   * zweiter Klick den ersten ab, weil dasselbe Element neu gestartet wird. */
  const POOL = 3, pools = {}, zeiger = {};
  for (const [name, datei] of Object.entries(DATEIEN)) {
    pools[name] = Array.from({ length: POOL }, () => {
      const a = new Audio(`assets/sfx/${datei}.mp3`);
      a.preload = "auto";
      return a;
    });
    zeiger[name] = 0;
  }
  /* Effekte dürfen die Musik nicht übertönen, gehen bei leiser Musik aber auch
   * nicht unter — daher angehoben und gedeckelt statt 1:1 übernommen. */
  /* Effekte haben jetzt eine eigene Lautstärke (Einstellungen → Sound). */
  const pegel = () => Math.min(1, (EINST.effekteVol ?? 60) / 100);
  let letzte = 0;
  return {
    spiel(name) {
      if (!EINST.effekte || !(EINST.effekteVol > 0) || !pools[name]) return;
      /* Sammelaktionen (z. B. mehrere Orders auf einmal) würden sonst eine
       * Salve identischer Klänge auslösen. */
      const jetzt = performance.now();
      if (jetzt - letzte < 60) return;
      letzte = jetzt;
      const a = pools[name][zeiger[name]++ % POOL];
      try { a.currentTime = 0; a.volume = pegel(); a.play().catch(() => {}); } catch {}
    },
  };
})();
/* Welche Aktion wie klingt. Alles, was nicht aufgeführt ist, bleibt still —
 * ein Klang auf wirklich jeden Handgriff würde schnell nerven. */
const SFX_AKTION = {
  build: "bau", upgradeBuilding: "bau", demolish: "bau", unlockTile: "bau", stallEinstellen: "bau",
  placeOrder: "geld", takeOrder: "geld", buyShares: "geld", bidShares: "geld", kurswetteSetzen: "geld", projektLiefern: "geld",
  acceptShareBid: "geld", listShares: "geld", buyBond: "geld", issueBond: "geld",
  bid: "geld", acceptContract: "geld", contribute: "geld", mergeCompany: "geld",
  bookAd: "geld", configureShop: "klick", togglePause: "klick",
  offerContract: "klick", cancelOrder: "klick", cancelShareBid: "klick",
  cancelShareListing: "klick", declineContract: "klick", declineShareBid: "klick",
};

/* ================================================================
 * Tutorial: läuft nach dem ersten Beitritt (localStorage merkt sich
 * den Abschluss). Bau-Schritte erkennen automatisch, wenn das
 * geforderte Gebäude auf der Karte steht.
 * ================================================================ */
/* Tutorial je Industrie: gemeinsamer Rahmen + spezifische Bau-Schritte */
/* ---- Branchen-Tutorials (Sandkasten) ----
 * Jede Branche hat ihren eigenen Rundgang: erst bauen, dann verkaufen, dann
 * das, was nur diese Branche ausmacht (Gäste und Sterne, Ausschreibungen,
 * Grundbedarf, Bürger-Apps …). Fast jeder Schritt wartet auf die echte
 * Handlung und hakt sich dann selbst ab; „auslassen“ hilft, wenn etwas gerade
 * nicht geht. Gemeinsam für alle: Stadt und Arbeiter, Stadtnetz, Vermögensziel. */
const tutHat = (st, id, ...bts) => st.map.some(t => t.owner === id && bts.includes(t.btype) && !(t.bauBis > st.tick));
const tutShop = (st, id) => st.map.some(t => t.owner === id && t.btype === "onlinemarkt" && t.system);
const tutRegal = (st, id, gs) => st.map.some(t => t.owner === id && (t.shop || []).some(sl => sl?.good && (!gs || gs.includes(sl.good))));
const tutGekauft = (st, me, id, gs) => gs.some(g => (me.sales?.[g]?.buyQty || 0) > 0 || st.orders.some(o => o.playerId === id && o.side === "buy" && o.good === g));
const tutVerkauft = (st, me, id, gs) => gs.some(g => ((me.sales?.[g]?.botQty || 0) + (me.sales?.[g]?.playerQty || 0)) > 0
  || st.orders.some(o => o.playerId === id && o.side === "sell" && o.good === g)) || tutRegal(st, id, gs);
const TUT_IND = {
  agrar: [
    { t: "Bau deine erste Farm", build: "farm", wartetext: "Warte auf die Farm …",
      p: `Klick eine freie <em>grüne Agrar-Kachel</em> an und bau eine <b>Farm</b>. Sie erntet <b>Obst</b> — Sekunde für Sekunde, direkt in dein Lager.<br><br>Obst ist das Grundnahrungsmittel der Stadt: Bewohner kaufen es im Laden, Bäckereien und Saftpressen verarbeiten es weiter.` },
    { t: "Bau deinen Laden", build: "onlinemarkt", wartetext: "Warte auf den Online-Marktplatz …",
      p: `Ware im Lager ist noch kein Geld. Bau im <em>Zentrum</em> einen <b>Online-Marktplatz</b> — das ist der einzige Laden der Stadt, jede Branche darf ihn bauen.` },
    { t: "Installier ein Shop-System", warte: (st, me, id) => tutShop(st, id), wartetext: "Warte auf das Shop-System …",
      p: `Klick deinen Marktplatz an und wähl ein <b>Shop-System</b>. Ohne System verkauft er nichts.<br><br>Das <b>Stadtportal</b> ist immer da, nimmt aber 8 % je Verkauf. Systeme der Software-Firmen sind meist günstiger und verkaufen schneller.` },
    { t: "Leg Obst ins Regal", warte: (st, me, id) => tutRegal(st, id, ["obst", "honig", "saft", "gebaeck", "kannabis", "medizin"]), wartetext: "Warte auf ein belegtes Regal …",
      p: `Belege im Marktplatz ein <b>Regal</b> mit Obst. Den Preis bestimmst du.<br><br>Faustregel: nah am <b>Ø-Kurs</b> (steht oben im Ticker). Billiger macht kaum schneller, kostet aber bei jedem Stück Geld.` },
    { t: "Hol dir den Boost", warte: (st, me, id) => tutGekauft(st, me, id, ["wasser", "strom"]), wartetext: "Warte auf Wasser oder Strom …",
      p: `Liegen <b>Wasser</b> und <b>Strom</b> im Lager, wächst deine Farm bis zu <b>150 % schneller</b>. Beides verkaufen die Versorger.<br><br>Öffne das <b>Stadtnetz</b> (Knopf unten) → <b>Warenbörse</b>, wähl Wasser oder Strom und kauf ein paar Stück.` },
    { t: "Veredle deine Ernte", warte: (st, me, id) => tutHat(st, id, "imkerei", "saftpresse", "plantage", "baeckerei"), wartetext: "Warte auf eine Imkerei, Saftpresse oder Plantage …",
      p: `Rohes Obst bringt wenig. Mehr verdienst du mit Veredelung: Die <b>Imkerei</b> liefert Honig, die <b>Saftpresse</b> macht aus Obst Saft, die <b>Plantage</b> Kannabis für das Pharma-Labor. Später backt die <b>Bäckerei</b> aus Obst und Honig Gebäck — das teuerste Lebensmittel.` },
    { t: "Deine Kunden in der Stadt",
      p: `Drei Abnehmer solltest du kennen:<br>· Die <b>Bewohner</b> brauchen Lebensmittel im Laden — fehlen sie, sinkt die Zufriedenheit der Stadt.<br>· <b>Hotels ab 3 Sternen</b> kaufen Frühstück: Obst, Honig, Saft, Gebäck.<br>· Mit dem Website-Modul <b>Branchenportal</b> wird deine Website zum <b>Hofladen</b>: Mitspieler kaufen dort direkt bei dir.` },
  ],
  rohstoff: [
    { t: "Bau eine Mine", build: "mine", wartetext: "Warte auf die Mine …",
      p: `Deine Gebäude stehen in der <em>braunen Industrie-Zone</em>. Klick eine gesperrte Kachel an, schalte sie frei und bau eine <b>Mine</b>. Sie fördert <b>Erze</b> — den Grundstoff für Ziegel, Beton und Stahl.` },
    { t: "Bau eine Ziegelei", build: "ziegelei", wartetext: "Warte auf die Ziegelei …",
      p: `Die <b>Ziegelei</b> macht aus Erzen und Wasser <b>Ziegel</b>. Und Ziegel braucht <b>jede Firma für jedes Gebäude</b> — und die Stadt für jeden Wohnblock. Du sitzt an der Quelle des ganzen Wachstums.` },
    { t: "Wasser, Strom und Öl", warte: (st, me, id) => tutGekauft(st, me, id, ["wasser", "strom", "oel"]), wartetext: "Warte auf einen Einkauf …",
      p: `Die Ziegelei braucht <b>Wasser</b>, die Mine läuft mit <b>Strom und Öl</b> bis zu 150 % schneller. Kauf beides bei den Versorgern: <b>Stadtnetz</b> → <b>Warenbörse</b>.` },
    { t: "Verkauf deine Ziegel", warte: (st, me, id) => tutVerkauft(st, me, id, ["ziegel", "erze", "beton", "stahl"]), wartetext: "Warte auf ein Angebot …",
      p: `Ziegel verkaufst du am besten an der <b>Warenbörse</b>: Dort suchen andere Firmen laufend welche. Stell eine <b>Verkaufsorder</b> zum Ø-Kurs ein — oder bau einen Online-Marktplatz und leg sie ins Regal.` },
    { t: "Liefer an die Stadt", warte: () => TUT_GESEHEN.has("finanzamt"), wartetext: "Warte, bis du die Stadtübersicht öffnest …",
      p: `Die Stadt baut Wohnblöcke und bestellt das Baumaterial bei euch — <b>15 % über Kurs</b>, sofort bezahlt. Klick oben auf die <b>Einwohnerzahl</b>: In der Stadtübersicht stehen die offenen <b>Wohnbau-Aufträge</b>, dort lieferst du direkt.` },
    { t: "Dein Weg nach oben",
      p: `Sobald Geld da ist: <b>Betonwerk</b> (Erze und Öl → Beton) und <b>Stahlwerk</b> (Erze und Öl → Stahl). Beton brauchen große Gebäude und Wohnblöcke, Stahl die Autowerke und die Rüstung.<br><br>Mit dem Website-Modul <b>Branchenportal</b> wird deine Seite zum <b>Baustoff-Portal</b>: +5 % auf jede Wohnbau-Lieferung.` },
  ],
  versorger: [
    { t: "Bau einen Brunnen", build: "brunnen", wartetext: "Warte auf den Brunnen …",
      p: `Starte günstig: Bau auf einer <em>grünen Agrar-Kachel</em> einen <b>Brunnen</b>. Er fördert <b>Wasser</b> — das brauchen Farmen, Ziegeleien, Hotels und jeder Haushalt der Stadt.` },
    { t: "Bau ein E-Werk", build: "ewerk", wartetext: "Warte auf das E-Werk …",
      p: `Schalte in der <em>braunen Industrie-Zone</em> eine Kachel frei und bau ein <b>E-Werk</b>. <b>Strom</b> braucht fast jede Branche: Chipfabriken, Rechenzentren, Hotels, Minen für den Boost.` },
    { t: "Verkauf an der Börse", warte: (st, me, id) => tutVerkauft(st, me, id, ["strom", "wasser", "oel", "diesel"]), wartetext: "Warte auf ein Angebot …",
      p: `Deine Kunden sind die anderen Firmen. Stell an der <b>Warenbörse</b> (Stadtnetz) eine <b>Verkaufsorder</b> für Strom oder Wasser zum Ø-Kurs ein. Liegt ein passendes Gesuch im Buch, verkaufst du sofort.` },
    { t: "Die Stadt kauft bei dir", warte: () => TUT_GESEHEN.has("finanzamt"), wartetext: "Warte, bis du die Stadtübersicht öffnest …",
      p: `Jede Minute kauft die Stadt für ihre Haushalte <b>Strom und Wasser</b> — direkt aus den Lagern der Firmen, zu mindestens 70 % des Grundpreises. Je mehr du auf Lager hast, desto mehr geht an dich.<br><br>Klick oben auf die <b>Einwohnerzahl</b>: Unter „Grundbedarf“ siehst du, was die Stadt braucht.` },
    { t: "Dein Ausbau",
      p: `Mit Kapital: <b>Wasserwerk</b> für mehr Wasser, an der Küste <b>Windpark</b> und <b>Ölpumpe</b>, dazu die <b>Raffinerie</b> (Öl → Diesel für Autowerke und Panzer).<br><br>Mit dem Website-Modul <b>Branchenportal</b> wird deine Seite zum <b>Kundenportal</b>: Rechenzentren und Hotels kaufen dort Strom und Wasser direkt bei dir.` },
  ],
  tech: [
    { t: "Bau eine Siliziummine", build: "siliziummine", wartetext: "Warte auf die Siliziummine …",
      p: `Schalte in der <em>braunen Industrie-Zone</em> eine Kachel frei und bau die <b>Siliziummine</b>. Sie fördert <b>Silizium</b>, deinen Rohstoff.` },
    { t: "Bau eine Chipfabrik", build: "chipfabrik", wartetext: "Warte auf die Chipfabrik …",
      p: `Die <b>Chipfabrik</b> macht aus Silizium und Strom <b>Elektronik</b>. Elektronik braucht <b>jede Firma</b>, um ihre Gebäude auszubauen — je größer die Stadt, desto größer die Nachfrage.` },
    { t: "Strom für die Fabrik", warte: (st, me, id) => tutGekauft(st, me, id, ["strom"]), wartetext: "Warte auf Strom …",
      p: `Ohne <b>Strom</b> steht die Chipfabrik still. Kauf ihn bei den Versorgern: <b>Stadtnetz</b> → <b>Warenbörse</b> → Strom.` },
    { t: "Verkauf deine Elektronik", warte: (st, me, id) => tutVerkauft(st, me, id, ["elektronik", "silizium"]), wartetext: "Warte auf ein Angebot …",
      p: `Stell an der <b>Warenbörse</b> eine Verkaufsorder für Elektronik ein — oder leg sie in einem Online-Marktplatz ins Regal. Elektronik ist teuer (rund 100 $), schon kleine Mengen bringen viel.` },
    { t: "Bau selbst aus", warte: (st, me, id) => st.map.some(t => t.owner === id && (t.level || 1) >= 2), wartetext: "Warte auf einen Ausbau …",
      p: `Klick eines deiner Gebäude an und bau es auf <b>Stufe 2</b> aus. Jede Stufe bringt 30 % mehr Ausstoß auf derselben Kachel — und du hast die Elektronik dafür selbst.` },
    { t: "Dein Weg nach oben",
      p: `Später: <b>Autowerke</b> (Elektronik, Stahl und Öl, Diesel oder Strom → Autos, über 300 $ das Stück) und das <b>Renn-Softwarelabor</b>.<br><br>Mit dem Website-Modul <b>Branchenportal</b> wird deine Seite zum <b>Großhandel</b>: Mitspieler kaufen Elektronik direkt bei dir.` },
  ],
  touristik: [
    { t: "Bau einen Campingplatz", build: "campingplatz", wartetext: "Warte auf den Campingplatz …",
      p: `Bau auf einer freien <em>grünen Agrar-Kachel</em> einen <b>Campingplatz</b>. Er braucht keine Zutaten und liefert sofort <b>Zimmer</b> (Übernachtungen) — dein Einstieg ohne Handelspartner.` },
    { t: "Dein Touristik-Panel", warte: () => TUT_GESEHEN.has("touristik"), wartetext: "Warte, bis du das Touristik-Panel öffnest …",
      p: `Unten erscheint jetzt der Knopf <b>Touristik</b>. Öffne ihn.<br><br>Jede Minute kommen <b>Gäste</b> in die Stadt — mehr, je größer und zufriedener sie ist. Sie wählen ein Hotel nach <b>Bewertung</b> und <b>Zimmerpreis</b> und zahlen direkt an dich. Den Preis stellst du dort ein.` },
    { t: "Bau ein Strandhotel", build: "strandhotel", wartetext: "Warte auf das Strandhotel …",
      p: `Das eigentliche Geschäft: das <b>Strandhotel</b> an der <em>Küste</em> (Kachel freischalten). Es macht aus Wasser und Strom viel mehr Zimmer als der Campingplatz und startet mit <b>2 Sternen</b>.` },
    { t: "Wasser und Strom fürs Hotel", warte: (st, me, id) => tutGekauft(st, me, id, ["wasser", "strom"]), wartetext: "Warte auf Wasser oder Strom …",
      p: `Ohne Nachschub steht das Hotel still. Kauf <b>Wasser und Strom</b> an der <b>Warenbörse</b> im Stadtnetz — beides liegt dort meist reichlich.` },
    { t: "Renovier auf 3 Sterne", warte: (st, me, id) => st.map.some(t => t.owner === id && t.btype === "strandhotel" && (t.sterne || 2) >= 3), wartetext: "Warte auf die Renovierung …",
      p: `Mehr Sterne = bessere Bewertung = mehr Gäste oder höhere Preise. Klick dein Strandhotel an und <b>renovier auf 3 Sterne</b> (1.500 $).` },
    { t: "Frühstück einkaufen", warte: (st, me, id) => ["obst", "honig", "saft", "gebaeck"].some(g => (me.inv?.[g] || 0) >= 1) || tutGekauft(st, me, id, ["obst", "honig", "saft", "gebaeck"]), wartetext: "Warte auf Lebensmittel im Lager …",
      p: `Ab 3 Sternen erwarten deine Gäste <b>Frühstück</b>: Obst, Honig, Saft oder Gebäck aus deinem Lager. Fehlt es, sinkt die Bewertung. Kauf <b>Obst</b> an der Warenbörse — oder direkt im <b>Hofladen</b> einer Agrar-Firma im Stadtnetz.` },
    { t: "Feste und deine Buchungsseite",
      p: `Im Touristik-Panel veranstaltest du <b>Stadtfeste</b>: Strandfest, Konzert oder Festival locken für einige Minuten viel mehr Gäste in die Stadt — du bekommst den größten Teil. Halte vorher genug Zimmer auf Lager.<br><br>Deine <b>Buchungsseite</b> zeigt allen deine Häuser, Preise und Gästebewertungen.` },
  ],
  software: [
    { t: "Bau ein Entwicklerstudio", build: "entwicklerstudio", wartetext: "Warte auf das Entwicklerstudio …",
      p: `Bau im <em>Zentrum</em> ein <b>Entwicklerstudio</b>. Es macht aus Strom <b>Entwicklungspunkte</b> (EP) — mit etwas Elektronik doppelt so schnell. Damit entwickelst du alle deine Programme.` },
    { t: "Leg dein Shop-System an", warte: (st, me, id) => (st.software || []).some(x => x.ownerId === id && !x.portal), wartetext: "Warte auf dein Shop-System …",
      p: `Klick das Studio an → <b>Software-Baukasten öffnen</b>. Im Reiter „Mein System“ legst du Name, Farbe und Gebühr deines <b>Shop-Systems</b> fest, unter „Entwicklung“ startest du Version 1.<br><br>Jede Firma braucht ein Shop-System für ihren Laden — und soll deins nehmen statt des teuren Stadtportals.` },
    { t: "Bau ein Rechenzentrum", build: "rechenzentrum", wartetext: "Warte auf das Rechenzentrum …",
      p: `Deine Kunden laufen auf deinem <b>Rechenzentrum</b> (Zentrum): je Stufe 5 Shops, dazu Plätze für Apps und Websites. Es braucht dauernd <b>Strom</b> — ohne ihn fallen alle Kunden aus.` },
    { t: "Version 1 fertigstellen", warte: (st, me, id) => (st.software || []).some(x => x.ownerId === id && x.version >= 1), wartetext: "Warte auf Version 1 …",
      p: `Die Entwicklung dauert ein paar Minuten. Sorg dafür, dass Studio und Rechenzentrum <b>Strom</b> haben: <b>Stadtnetz</b> → <b>Warenbörse</b> → Strom kaufen. Sobald Version 1 fertig ist, wechseln die Bots zu dir, wenn du besser bist als die Konkurrenz.` },
    { t: "Deine Statusseite", warte: () => TUT_GESEHEN.has("rz"), wartetext: "Warte, bis du die Statusseite öffnest …",
      p: `Klick dein Rechenzentrum an → <b>Statusseite öffnen</b>. Dort siehst du Verfügbarkeit, Auslastung und Strom, stellst Preise ein und verteilst deine Plätze auf Shops, Apps und Websites. Kunden sehen dieselbe Seite und bestellen dort.` },
    { t: "Eine Bürger-App", warte: (st, me, id) => (st.buergerApp || []).some(x => x.ownerId === id), wartetext: "Warte auf deine Bürger-App …",
      p: `Im Baukasten, Reiter <b>Produkte</b>, legst du eine <b>Bürger-App</b> an. Die Einwohner zahlen ein Abo je Minute — je größer die Stadt, desto mehr. Entwickeln, Preis setzen, fertig.` },
    { t: "Was noch geht",
      p: `· <b>Jobbörse</b>: Firmen abonnieren sie und bekommen bei knappen Arbeitern Vorrang.<br>· <b>Website-Baukasten</b> (ab Shop-System v2): Andere Firmen bestellen ihre Website bei dir.<br>· <b>Malprogramm</b> und <b>Börsen-App</b>: Lizenzen in deinem eigenen Online-Shop.<br><br>Behalte Strom und Rechenzentren im Blick — Ausfälle sieht jeder auf deiner Statusseite.` },
  ],
  ruestung: [
    { t: "Bau eine Munitionsfabrik", build: "munitionsfabrik", wartetext: "Warte auf die Munitionsfabrik …",
      p: `Schalte in der <em>braunen Industrie-Zone</em> eine Kachel frei und bau die <b>Munitionsfabrik</b>. Sie macht aus Erzen und Öl <b>Munition</b> — billig im Bau, damit früh Geld hereinkommt.` },
    { t: "Erze und Öl einkaufen", warte: (st, me, id) => tutGekauft(st, me, id, ["erze", "oel"]), wartetext: "Warte auf Erze oder Öl …",
      p: `Du stellst nichts aus dem Nichts her: <b>Erze</b> kommen von der Rohstoff-Industrie, <b>Öl</b> von den Versorgern. Kauf beides an der <b>Warenbörse</b> im Stadtnetz.` },
    { t: "Dein Laden mit Shop-System", warte: (st, me, id) => tutShop(st, id), wartetext: "Warte auf Laden und Shop-System …",
      p: `Bau im Zentrum einen <b>Online-Marktplatz</b> und installier ein Shop-System — am besten eins mit <b>Rüstungs-Baum</b>, es verkauft Waffen schneller.` },
    { t: "Verkauf deine Munition", warte: (st, me, id) => tutVerkauft(st, me, id, ["munition", "pistole", "panzer"]), wartetext: "Warte auf ein Angebot …",
      p: `Leg <b>Munition</b> ins Regal oder stell eine Verkaufsorder an der Börse ein. Polizei, Stadtwache und Schützenverein kaufen in der Stadt.` },
    { t: "Ausschreibungen", warte: () => TUT_GESEHEN.has("firma"), wartetext: "Warte, bis du das Firma-Panel öffnest …",
      p: `Dein größtes Geschäft: <b>Ausschreibungen</b> der Stadt. Polizei, Stadtwache oder Grenzschutz suchen größere Mengen; du gibst 60 Sekunden lang ein verdecktes Gebot ab (80–140 % des Listenpreises). Wer liefert, steigert seinen Lieferruf. Geboten wird im <b>Firma</b>-Panel — öffne es einmal.` },
    { t: "Bau die Waffenschmiede", build: "waffenschmiede", wartetext: "Warte auf die Waffenschmiede …",
      p: `Die <b>Waffenschmiede</b> macht Pistolen aus Stahl, Elektronik und Munition. Stahl kaufst du bei der Rohstoff-, Elektronik bei der Technik-Branche. Kauf die Vorprodukte früh, bevor andere sie wegkaufen.` },
    { t: "Dein Weg nach oben",
      p: `Ganz oben steht das <b>Panzerwerk</b> (Stahl, Elektronik, Diesel) — Panzer bringen über 400 $ das Stück.<br><br>Mit dem Website-Modul <b>Branchenportal</b> bekommst du das <b>Ausschreibungsportal</b>: Deine Gebote zählen 5 % günstiger, jede Lieferung bringt 15 % mehr, und Ausschreibungen kommen häufiger.` },
  ],
};
function buildTut(ind) {
  const IND_NAME = { agrar: "Agrarwirtschaft", rohstoff: "Rohstoff- & Bauindustrie", versorger: "Grundversorgung", tech: "Technologie & Elektronik", touristik: "Touristik", ruestung: "Rüstungsindustrie", software: "Software-Branche" };
  const ROLLE = {
    agrar: "Du ernährst die Stadt: Obst, Honig, Saft und Gebäck für Bewohner, Bäckereien und Hotels.",
    rohstoff: "Ohne dich wird nichts gebaut: Ziegel, Beton und Stahl braucht jede Firma und die Stadt selbst.",
    versorger: "Du hältst die Stadt am Laufen: Strom und Wasser für Firmen und Haushalte.",
    tech: "Du lieferst die Elektronik, mit der alle anderen ihre Gebäude ausbauen.",
    touristik: "Du holst Gäste in die Stadt: Zimmer, Sterne, Frühstück und Stadtfeste.",
    software: "Du baust die digitale Stadt: Shop-Systeme, Apps, Websites und Rechenzentren für alle anderen.",
    ruestung: "Du belieferst Polizei, Stadtwache und Grenzschutz — mit Ausschreibungen als großem Geschäft.",
  };
  return [
    { t: "Willkommen bei Capital Sandbox",
      p: `Ich habe diese Stadt dreißig Jahre lang als CEO geführt — jetzt zeige ich <b>dir</b>, wie man in der <b>${IND_NAME[ind] || ind}</b> groß wird.<br><br>${ROLLE[ind] || ""}<br><br>Dein Ziel: als Erster das <b>Vermögensziel</b> erreichen (oben links). Ganz oben läuft der <b>Kursticker</b> mit den Ø-Kursen aller Waren.` },
    { t: "Die Stadt und deine Leute",
      p: `Die Stadt wächst mit euch: Oben neben deinem Geld steht die <b>Einwohnerzahl</b>. Die Bewohner arbeiten in euren Gebäuden und kaufen in euren Läden.<br><br>Jedes Gebäude braucht <b>Arbeiter</b>. Sind sie knapp, gehen sie zur Firma mit dem besseren Lohn — den stellst du im <b>Firma</b>-Panel ein. Du baust nur Gebäude <b>deiner</b> Branche; alles andere kaufst du von den anderen.` },
    ...(TUT_IND[ind] || TUT_IND.agrar),
    { t: "Das Stadtnetz", warte: () => TUT_GESEHEN.has("netz"), wartetext: "Warte, bis du das Stadtnetz öffnest …",
      p: `Unten findest du das <b>Stadtnetz</b> — das Internet der Stadt. Öffne es.<br><br>Dort sind der <b>Stadtkurier</b> (Nachrichten alle zwei Minuten), die <b>Warenbörse</b>, die <b>Stadtbank</b> (Aktien und Fonds), der <b>Anleihenmarkt</b> und die Websites aller Firmen. Eine eigene <b>Website</b> bringt dir Reichweite — bestellen kannst du sie bei einer Software-Firma.` },
    { t: "Bring dein Vermögen auf 16.000 $", warte: (st, me, id) => (st.players[id]?.netWorth || 0) >= 16000, wartetext: "Warte, bis dein Nettovermögen 16.000 $ erreicht …",
      p: `Jetzt läuft alles zusammen: produzieren, verkaufen, nachkaufen, ausbauen.<br><br>Dein <b>Nettovermögen</b> (oben links) ist Bargeld plus Lager plus Gebäude minus Schulden. Bring es von 9.500 $ auf <b>16.000 $</b> — mit einem zweiten Gebäude, Preisen nah am Ø-Kurs und vollem Lager bei den Zutaten.` },
    { t: "Jetzt gehört die Stadt dir",
      p: `Das war der Rundgang. Was dir im Spiel noch begegnet, erklären kurze <b>Hinweise</b> genau dann, wenn es wichtig wird. Im <b>Lexikon</b> steht jede Regel nach.<br><br>Mein letzter Rat: Schau regelmäßig in den <b>Stadtkurier</b>. Wer zuerst weiß, welche Ware knapp wird, verdient am meisten.` },
  ];
}
/* Kartellmodus: eigenes Tutorial — hier gelten andere Regeln (keine Branchen,
 * kein Baumaterial, dafür Familien, Bezirke, Waffen und Fahndung). */
function buildKartellTut() {
  return [
    { t: "Willkommen in der Kartellwirtschaft",
      p: `Vergiss die Börsenregeln von nebenan — hier zählt die <b>Familie</b>. Jeder Spieler gehört einer von vier Familien an; gemeinsam sammelt ihr <b>Respekt</b>. Das Ziel: <b>6 der 9 Bezirke</b> kontrollieren — dann gehört die Stadt eurer Familie. Deine Aufträge links (<b>Mafia-Aufträge</b>) sind der rote Faden für den Einstieg.` },
    { t: "Betrieb & Hehler: dein Geld",
      p: `Bauen kostet hier <b>nur Bargeld</b> — kein Baumaterial, keine Branchen-Grenzen: Jede Familie baut alles. Dein wichtigstes Gebäude ist der <b>Betrieb deiner Familie</b> (nur ihr könnt ihn bauen): Er produziert eure <b>heiße Ware</b>, die ausschließlich der <b>Hehler</b> ankauft (Kartell-Panel) — jeder Verkauf bringt <b>1 Respekt je 100 $</b>.` },
    { t: "Bezirke: Kontrolle, Schutzgeld, Erpressung",
      p: `Wer in einem Bezirk die <b>meisten Gebäude</b> hat (mind. 2), kontrolliert ihn: <b>200 $ Schutzgeld pro Minute</b> für die Familie. Zusätzlich kannst du selbst durch die Läden ziehen: <b>Erpressen</b> (Kartell-Panel, alle 3 min je Bezirk) bringt Sofort-Geld — im eigenen Revier das 1,5-fache. Aber Vorsicht: Alles Illegale heizt die <b>Fahndung</b> an. Bei 100 kommt die <b>Razzia</b> — Bestechung (2.000 $) kühlt ab.` },
    { t: "Revierkampf: Waffen & Tauziehen",
      p: `Fremde Bezirke nimmst du mit <b>Waffen</b>: Pistolen erbeutest du bei <b>Überfällen auf Werttransporte</b> (goldener Ring auf der Karte — anklicken!). Mit 3+ Pistolen startest du den <b>Revierkampf</b>: 2 Minuten <b>Tauziehen</b> um den Kontroll-Balken — Bauten +2, Sperren +2, Erpressung +1, <b>Verstärkung</b> ($300) +1. Der Sieger <b>plündert die Kassen</b> und hält den Bezirk 5 Minuten als Besatzung.` },
    { t: "Die Polizei spielt mit",
      p: `Eine Seite spielt GEGEN alle Familien: die <b>Polizei</b> (wählbar wie eine Familie, sonst übernimmt ein KI-Kommissar). Sie <b>kontrolliert Werttransporte</b> und führt <b>Razzien</b> gegen kontrollierte Bezirke — je höher eure <b>Fahndung</b>, desto sicherer ihr Zugriff. Sammelt sie <b>${25} Einsatzpunkte</b>, gewinnt das Gesetz die Runde. Haltet die Fahndung niedrig (Bestechung!) und lasst euch nicht erwischen.` },
    { t: "Die Straße gehört euch",
      p: `Noch drei Werkzeuge: <b>Straßensperren</b> (Straße anklicken, 800 $) zählen wie 2 Gebäude und stoppen Werttransporte. Das <b>Illegale Casino</b> lässt Mitspieler gegen deine Kasse zocken. Und behalte die <b>Familien-Rangliste</b> im Kartell-Panel im Blick — die meisten Bezirke machen den <b>Paten</b>, der bei allen anderen mitkassiert. Und nun: Die Stadt wartet, Capo. 🤌` },
  ];
}
/* ---------- Übungsrunde ----------
 * Der Knopf "Tutorial spielen" öffnete bisher ein Lesebuch. Wer ein
 * Wirtschaftsspiel verstehen will, muss aber einmal selbst gebaut, verkauft
 * und eingekauft haben — also startet er jetzt eine echte, eigene Runde auf
 * der Karte und führt Schritt für Schritt durch die ersten Handlungen. Jeder
 * Schritt wartet auf die Handlung selbst, keiner lässt sich wegklicken. */
const TUT_SPIEL = [
  { t: "Deine Übungsrunde läuft",
    p: `Das hier ist eine <b>echte Runde</b>, ganz für dich allein — mit richtigem Markt und Bot-Firmen, die handeln. Du kannst nichts kaputtmachen: Schließe einfach die Seite, wenn du fertig bist.<br><br>Ich führe dich durch die ersten Schritte. Jeder Schritt wartet, bis du ihn wirklich gemacht hast.` },

  { t: "Schritt 1 — Baue eine Farm", build: "farm",
    p: `Klicke auf eine freie <em>grüne Agrar-Kachel</em> und wähle <b>Farm</b> ($1.200 + 3 Ziegel).<br><br>Sie produziert von allein <b>Obst</b>, Sekunde für Sekunde. Achte oben links auf dein Bargeld — Bauen kostet sofort, verdient wird erst später.` },

  { t: "Schritt 2 — Baue einen Online-Marktplatz", build: "onlinemarkt",
    p: `Obst im Lager bringt noch kein Geld. Du brauchst einen Laden — und den gibt es nur noch online.<br><br>Baue im <em>blauen Zentrum</em> einen <b>Online-Marktplatz</b> ($3.000 + 8 Ziegel). Den darf jede Branche bauen — nur Produktionsgebäude sind an deine Branche gebunden.` },

  { t: "Schritt 3 — Installiere ein Shop-System",
    warte: (st, me, id) => st.map.some(t => t.owner === id && t.btype === "onlinemarkt" && t.system),
    p: `Ein Online-Marktplatz verkauft erst mit einem <b>Shop-System</b>. Klicke ihn an und wähle eins: von einer Software-Firma (günstiger, schneller) oder das <b>Stadtportal</b> (kostet 8 % je Verkauf, ist aber immer da).<br><br>Tipp: Ein System mit <b>Agrar-Baum</b> verkauft dein Obst schneller als ein Allrounder.` },

  { t: "Schritt 4 — Stelle dein Obst zum Verkauf",
    warte: (st, me, id) => st.map.some(t => t.owner === id && t.btype === "onlinemarkt" && (t.shop || []).some(sl => sl && sl.good)),
    p: `Klicke deinen <b>Online-Marktplatz</b> an und belege ein Regal mit <b>Obst</b>.<br><br>Den <b>Preis bestimmst du selbst</b>. Und Achtung, das ist die Stelle, an der sich die meisten verrechnen: Billiger ist nicht besser. Das Verkaufstempo ist gedeckelt — unter etwa <b>70 % des Ø-Kurses</b> wirst du nicht mehr schneller, verschenkst aber Geld bei jedem Stück.` },

  { t: "Schritt 5 — Kaufe Wasser und Strom",
    /* Zwei Fallen umgangen, beide im Test aufgetreten:
     * 1. Nicht am Lagerbestand messen — der Boost verbraucht Wasser und Strom
     *    laufend, im Test stand Wasser Sekunden nach dem Kauf wieder auf null.
     *    Wer nacheinander einkauft, hielte nie beides gleichzeitig.
     * 2. Eine offene Kauforder zählt genauso wie ein Abschluss. Im Test lag das
     *    Stromangebot bei 0 — der Lernende hätte am Schritt festgehangen, ohne
     *    etwas falsch gemacht zu haben. Ob gerade jemand verkauft, liegt nicht
     *    in seiner Hand; gelernt werden soll die Handlung, nicht das Glück. */
    warte: (st, me, id) => {
      const hat = g => (me.sales?.[g]?.buyQty || 0) > 0
        || st.orders.some(o => o.playerId === id && o.side === "buy" && o.good === g);
      return hat("wasser") && hat("strom");
    },
    p: `Öffne die <b>Börse</b> unten und besorge dir <b>Wasser</b> und <b>Strom</b> — entweder direkt aus einem Angebot oder über eine eigene Kauforder, falls gerade nichts im Buch steht.<br><br>Liegen beide im Lager, läuft deine Farm mit bis zu <b>+150 % Tempo</b> — sie werden dabei verbraucht. Das ist der größte Hebel im frühen Spiel und kostet fast nichts.` },

  { t: "Zwischenstopp — Deine Leute",
    p: `Jedes Gebäude braucht <b>Arbeiter</b> aus der Stadt. Klick eins deiner Gebäude an: Unter <b>Belegschaft</b> siehst du, wie viele da sind — mit 3 von 5 läuft es zu 60 %.<br><br>Sind Leute knapp, gehen sie zur Firma mit dem besten Lohn. Den stellst du im <b>Firma</b>-Panel ein. Wie viele Einwohner die Stadt hat, steht oben neben deinem Bargeld.` },

  { t: "Schritt 6 — Stelle eine eigene Order ein",
    warte: (st, me, id) => st.orders.some(o => o.playerId === id),
    p: `Bisher hast du aus dem Buch gekauft. Jetzt umgekehrt: Stelle an der Börse eine <b>eigene Order</b> ein — verkaufe Obst oder suche eine Ware, die du brauchst.<br><br>Deine Order bleibt stehen, bis jemand sie bedient. Ware und Geld liegen so lange treuhänderisch fest, niemand kann dich hängen lassen.` },

  { t: "Schritt 7 — Bring dein Vermögen auf 16.000 $",
    /* Deutlich über dem Startkapital von 9.500 $. Mit 12.000 war das Ziel im
     * Test schon nach dem ersten Verkauf erreicht (13.199 $), ohne dass man
     * dafür etwas verstanden haben musste. */
    warte: (st, me, id) => (st.players[id]?.netWorth || 0) >= 16000,
    p: `Jetzt läuft alles zusammen: Produzieren, verkaufen, nachkaufen.<br><br>Dein <b>Nettovermögen</b> steht oben links — Bargeld plus Lager plus Gebäude minus Schulden. Bring es von 9.500 $ auf <b>16.000 $</b>. Baue eine zweite Farm, halte den Boost am Laufen oder setz den Ladenpreis geschickter.` },

  { t: "Das war alles Wesentliche",
    p: `Du hast gebaut, produziert, verkauft, eingekauft und gehandelt — mehr braucht es im Kern nicht.<br><br>Was jetzt noch dazukommt, findest du im Spiel selbst: <b>Anteile</b> und <b>Anleihen</b> in der Stadtbank, <b>Großaufträge</b> im Lager, <b>Werbung</b> für bessere Preise. Im <b>Lexikon</b> steht alles nach.<br><br>Spiel ruhig weiter — oder lade die Seite neu und starte eine echte Runde mit Freunden.` },
];

/* ---------- Einsteiger-Modus: der ganze Rundgang ----------
 * Die Uebungsrunde (TUT_SPIEL) zeigt den Kern in sechs Schritten und hoert
 * dann auf. Der Einsteiger-Modus soll das ganze Spiel zeigen — also auch
 * Kursticker, Nachrichten, Lager, Stadtbank, Anleihen und Ausbau.
 *
 * Die Bau-Schritte fragen nicht nach einem bestimmten Gebaeudetyp: Im
 * Einsteiger-Modus waehlt man seine Branche selbst, und "baue eine Farm" ginge
 * fuer einen Versorger ins Leere. Unterschieden wird nur zwischen Produktion
 * und Laden — Laeden tragen ein shop-Feld, Produktionsgebaeude nicht. */
const istLaden = t => Array.isArray(t.shop);
const TUT_EINSTEIGER = [
  { t: "Willkommen im Einsteiger-Modus",
    p: `Ich gehe mit dir einmal durch <b>alles</b> — bauen, produzieren, verkaufen, handeln, Anteile, Anleihen, Ausbau.<br><br>Das hier ist eine echte Runde mit echten Bot-Firmen. Nichts ist gesperrt, du kannst nichts kaputtmachen. Jeder Schritt wartet, bis du ihn wirklich gemacht hast.` },

  { t: "Erst der Blick auf die Stadt",
    p: `Drei Dinge, die immer da sind:<br><br>Ganz <b>oben</b> läuft der Kursticker mit den Ø-Kursen aller Waren. <b>Oben links</b> stehen dein Bargeld und dein Nettovermögen. <b>Unten</b> liegt die Leiste mit allen Panels — Karte, Lager, Börse, Finanzen, Firma, Lexikon.<br><br>Die Karte selbst: grün ist Agrarland, grau die Innenstadt, braun die Hafenindustrie, dazu Küste und Bucht.` },

  { t: "Schritt 1 — Bau dein erstes Produktionsgebäude",
    warte: (st, me, id) => st.map.some(t => t.owner === id && t.btype && !istLaden(t)),
    p: `Klick eine freie Kachel an und bau ein Gebäude <b>deiner Branche</b>.<br><br>Es produziert von allein, Sekunde für Sekunde, ins Lager. Bauen kostet sofort — verdient wird erst später. Das ist der Grundrhythmus des ganzen Spiels.` },

  { t: "Zwischenstopp — Deine Leute",
    p: `Jedes Gebäude braucht <b>Arbeiter</b> aus der Stadt. Klick eins deiner Gebäude an: Unter <b>Belegschaft</b> siehst du, wie viele da sind — mit 3 von 5 läuft es zu 60 %.<br><br>Sind Leute knapp, gehen sie zur Firma mit dem besten Lohn. Den stellst du im <b>Firma</b>-Panel ein. Wie viele Einwohner die Stadt hat, steht oben neben deinem Bargeld.` },

  { t: "Schritt 2 — Bau einen Laden",
    warte: (st, me, id) => st.map.some(t => t.owner === id && istLaden(t)),
    p: `Ware im Lager ist noch kein Geld. Du brauchst einen <b>Online-Marktplatz</b> mit Shop-System — das ist der einzige Laden der Stadt.<br><br>Den darf <b>jede</b> Branche bauen. Nur Produktionsgebäude sind an deine Branche gebunden.` },

  { t: "Schritt 3 — Leg eine Ware in den Verkauf",
    warte: (st, me, id) => st.map.some(t => t.owner === id && (t.shop || []).some(sl => sl && sl.good)),
    p: `Klick deinen Laden an und belege einen <b>Verkaufsslot</b>.<br><br>Den Preis bestimmst du. Und hier verrechnen sich die meisten: <b>billiger ist nicht besser</b>. Das Verkaufstempo ist gedeckelt — unter etwa 70 % des Ø-Kurses wirst du nicht schneller, verschenkst aber bei jedem Stück Geld.` },

  { t: "Schritt 4 — Lies den Kursticker",
    warte: () => TUT_GESEHEN.has("boerse"),
    p: `Öffne die <b>Börse</b> — im Sandkasten die Website <b>boerse.cs</b> im Stadtnetz (Knopf unten).<br><br>Oben im Ticker steht zu jeder Ware ein Ø-Kurs mit Trendpfeil. Der Wert steht bewusst <b>30 Sekunden still</b>, bevor er nachzieht — eine Zahl, die im Sekundentakt zappelt, taugt nicht, um den eigenen Preis danach zu setzen. Der Pfeil vergleicht deshalb 30 Sekunden gegen 30 Sekunden.` },

  { t: "Schritt 5 — Kauf etwas an der Börse",
    /* Nur Wasser oder Strom zaehlen, nicht "irgendein Einkauf": Ziegel kauft
     * man ohnehin zum Bauen, damit haette sich der Schritt selbst erledigt,
     * ohne dass die Lektion je zu sehen war. Eine offene Kauforder zaehlt mit —
     * ob gerade jemand verkauft, liegt nicht in der Hand des Lernenden. */
    warte: (st, me, id) => {
      const hat = g => (me.sales?.[g]?.buyQty || 0) > 0
        || st.orders.some(o => o.playerId === id && o.side === "buy" && o.good === g);
      return hat("wasser") || hat("strom");
    },
    p: `Kauf dir <b>Wasser</b> oder <b>Strom</b> — direkt aus einem Angebot, oder über eine eigene Kauforder, falls das Buch gerade leer ist.<br><br>Liegen beide im Lager, läuft deine Produktion mit bis zu <b>+150 % Tempo</b>. Sie werden dabei verbraucht. Das ist der größte Hebel im frühen Spiel und kostet fast nichts.` },

  { t: "Schritt 6 — Stell eine eigene Order ein",
    warte: (st, me, id) => st.orders.some(o => o.playerId === id),
    p: `Bisher hast du aus dem Buch gekauft. Jetzt andersherum: Stell eine <b>eigene Order</b> ein — verkauf deine Ware oder such etwas, das du brauchst.<br><br>Sie bleibt stehen, bis jemand sie bedient. Ware und Geld liegen so lange treuhänderisch fest; niemand kann dich hängen lassen.` },

  { t: "Schritt 7 — Schau ins Lager",
    warte: () => TUT_GESEHEN.has("lager"),
    p: `Öffne das <b>Lager</b>.<br><br>Hier steht jede Ware mit Bestand — und hier findest du die <b>Großaufträge</b> der Städte: feste Mengen zum doppelten Ø-Kurs, an denen sich alle Spieler gemeinsam beteiligen. Der Preis ist bei Auftragsvergabe fixiert, egal wohin der Markt danach läuft.` },

  { t: "Schritt 8 — Lies die Nachrichten",
    warte: () => TUT_GESEHEN.has("news") || TUT_GESEHEN.has("kurier"),
    p: `Öffne die <b>Nachrichten</b> — im Sandkasten den <b>Stadtkurier</b> im Stadtnetz (Knopf unten).<br><br>Dort laufen Marktberichte und Ereignisse: welche Ware knapp wird, wo Preise anziehen, was die anderen Firmen treiben. Wer den Bericht liest, bevor er den Ladenpreis setzt, verdient schlicht mehr.` },

  { t: "Schritt 9 — Kauf Anteile an einer Firma",
    warte: (st, me, id) => (me.portfolio || []).length > 0 || (me.balance?.holdings || 0) > 0,
    p: `Geh zur <b>Stadtbank</b> — im Sandkasten die Website <b>bank.cs</b> im Stadtnetz; das Bankgebäude mitten im Zentrum führt auch dorthin.<br><br>Dort handelst du <b>Anteile</b> anderer Firmen. Wächst eine Firma, wächst dein Anteil mit, ohne dass du selbst baust. Kauf dir ein Paket von irgendjemandem.` },

  { t: "Schritt 10 — Wirf einen Blick auf die Finanzen",
    warte: () => TUT_GESEHEN.has("bonds"),
    p: `Öffne <b>Finanzen</b> — im Sandkasten die Website <b>anleihen.cs</b> im Stadtnetz.<br><br>Hier gibst du <b>Anleihen</b> aus: Geld sofort, Rückzahlung mit Zins über die Laufzeit. Nützlich, um schneller zu wachsen — aber bei Verzug wird gepfändet. Ich sage nicht, dass du eine aufnehmen sollst. Du sollst nur wissen, dass es sie gibt.` },

  { t: "Schritt 11 — Bau ein Gebäude aus",
    warte: (st, me, id) => st.map.some(t => t.owner === id && (t.level || 1) >= 2),
    p: `Klick eines deiner Gebäude an und <b>levele es auf</b>.<br><br>Höhere Stufen produzieren deutlich mehr auf derselben Kachel. Ab Stufe 2 brauchst du dafür Elektronik — die kaufst du an der Börse. Ausbauen schlägt fast immer neu bauen.` },

  { t: "Schritt 12 — Bring dein Vermögen auf 20.000 $",
    warte: (st, me, id) => (st.players[id]?.netWorth || 0) >= 20000,
    p: `Jetzt läuft alles zusammen: produzieren, verkaufen, nachkaufen, ausbauen.<br><br>Dein <b>Nettovermögen</b> oben links ist Bargeld plus Lager plus Gebäude plus Beteiligungen minus Schulden. Bring es auf <b>20.000 $</b>. Halt den Boost am Laufen, setz den Ladenpreis dicht am Ø-Kurs und bau eine zweite Produktion.` },

  { t: "Geschafft — du kennst jetzt das ganze Spiel",
    fertig: true,
    p: `Gebaut, produziert, verkauft, gehandelt, beteiligt, ausgebaut. Mehr Werkzeuge gibt es nicht — alles Weitere ist Übung.<br><br>Im <b>Lexikon</b> steht jede Regel nach, auch die Feinheiten: Werbung, Fusionen, Verträge, Motorsport.<br><br>Spiel diese Runde ruhig weiter, oder starte eine richtige mit Freunden.` },
];

let TUT = buildTut("agrar");
let tutIdx = -1;
const tutEl = document.getElementById("tut");
function tutShow(i) {
  /* Beim Start entscheidet der MODUS, welches Tutorial gilt: Die Kartellstadt
   * hat eigene Regeln — das Industrie-Tutorial würde dort Falsches erzählen. */
  if (i === 0 && store.get().state?.mode === "kartell") TUT = buildKartellTut();
  else if (i === 0 && store.get().state?.mode !== "kartell" && TUT.length && TUT[0].t === "Willkommen in der Kartellwirtschaft")
    TUT = buildTut(store.get().meta?.industry || "agrar");
  tutIdx = i;
  if (i < 0 || i >= TUT.length) { tutEl.style.display = "none"; return; }
  const s = TUT[i];
  tutEl.style.display = "block";
  document.getElementById("tutStep").textContent = `Tutorial ${i + 1}/${TUT.length}`;
  document.getElementById("tutTitle").textContent = s.t;
  document.getElementById("tutText").innerHTML = s.p;
  document.getElementById("tutDots").innerHTML = TUT.map((_, j) => `<span class="${j <= i ? "on" : ""}"></span>`).join("");
  const wartet = !!(s.build || s.warte);
  document.getElementById("tutNext").style.display = wartet ? "none" : "";
  const tw = document.getElementById("tutWait");
  tw.style.display = wartet ? "flex" : "none";
  /* Worauf der Schritt wartet, plus „auslassen“ — sonst hinge man fest, wenn
   * etwas gerade nicht geht (kein Angebot an der Börse, zu wenig Geld …) */
  if (wartet) tw.innerHTML = `<span>${s.wartetext || t("Warte auf Bau …")}</span><button type="button" id="tutAuslassen">${t("auslassen")}</button>`;
  /* Beschriftung immer setzen, nicht nur beim letzten Schritt: sonst traegt der
   * Knopf in einer zweiten Runde ab Schritt 1 noch das "Los geht's!" der
   * vorigen. */
  document.getElementById("tutNext").textContent = t(i === TUT.length - 1 ? "Los geht's!" : "Weiter");
}
function tutDone() { tutIdx = -1; tutEl.style.display = "none"; try { localStorage.setItem("cs_tut_done", "1"); } catch {} }
document.getElementById("tutNext").addEventListener("click", () => {
  if (tutIdx < TUT.length - 1) return tutShow(tutIdx + 1);
  /* Im Einsteiger-Modus endet die Runde mit dem Tutorial — sonst bleibt sie
   * einfach weiter laufen. */
  if (TUT[tutIdx]?.fertig && store.get().state?.mode === "einsteiger") socket.emit("tutorialFertig");
  tutDone();
});
document.getElementById("tutSkip").addEventListener("click", tutDone);
tutEl.addEventListener("click", e => { if (e.target.closest("#tutAuslassen")) tutShow(tutIdx + 1); });
document.getElementById("help").addEventListener("click", () => tutShow(0));
/* Schritte haken sich selbst ab, sobald die Handlung wirklich passiert ist.
 * `build` war der einzige Auslöser — damit liess sich nur Bauen üben. `warte`
 * nimmt eine beliebige Bedingung entgegen, also auch Verkaufen, Einkaufen oder
 * eine Order an der Börse. Erst damit wird aus dem Tutorial ein Spiel statt
 * einer Textfolge, durch die man klickt. */
function tutCheck(state, myId) {
  /* Das Tutorial erklärt Börse und Stadtbank — in der Planwirtschaft
   * führt es in die Irre, dort bleibt es aus. */
  if (state?.mode === "plan") { document.getElementById("tut").style.display = "none"; return; }
  if (tutIdx < 0 || !state) return;
  const s = TUT[tutIdx];
  if (!s) return;
  const me = store.get().me;
  let fertig = false;
  if (s.build) fertig = state.map.some(t => t.owner === myId && t.btype === s.build);
  else if (s.warte) { try { fertig = !!s.warte(state, me || { inv: {} }, myId); } catch { fertig = false; } }
  if (fertig) tutShow(tutIdx + 1);
}

/* ---- Render (auf jede Store-Änderung) ---- */
const RCOL = { AAA:"#34d399", AA:"#6ecf90", A:"#a9c96a", BBB:"#e3c05a", BB:"#e79b5a", B:"#ef7f66", CCC:"#fb7185", D:"#8695ab" };
/* Referenzkurse ("Ø") halten 30 Sekunden still, bevor der nächste Stand
 * übernommen wird. Der echte Handelspreis läuft im Hintergrund weiter live mit —
 * hier geht es allein um die Orientierung: eine Zahl, die im Sekundentakt
 * zappelt, taugt nicht als Anhaltspunkt, um den eigenen Verkaufspreis danach zu
 * setzen. Der Trendpfeil vergleicht dadurch auch 30 s gegen 30 s statt Sekunde
 * gegen Sekunde und zeigt endlich eine Richtung statt Rauschen. */
const CALM_MS = 30000;
let calmAvg = null, calmPrev = null, calmAt = 0;
function refAvg(live) {
  if (!live) return calmAvg || {};
  const now = Date.now();
  if (!calmAvg) { calmAvg = { ...live }; calmPrev = { ...live }; calmAt = now; }
  else if (now - calmAt >= CALM_MS) { calmPrev = calmAvg; calmAvg = { ...live }; calmAt = now; }
  return calmAvg;
}
/* ---- Hinweis auf neue Angebote am Kapitalmarkt ----
 * Anleihen und Aktienangebote kommen nicht als eigenes Ereignis herein, sie
 * tauchen einfach im Zustand auf. Wer gerade auf der Karte baut, übersieht sie
 * deshalb — und ein Angebot, das niemand bemerkt, ist so gut wie keines.
 * Gemeldet wird nur, was FREMD und noch zu haben ist: die eigene Emission hat
 * man selbst ausgelöst, ein bereits gezeichnetes Papier kann man nicht mehr
 * nehmen. Beim ersten Zustand nach dem Beitritt wird nur der Ausgangsstand
 * gemerkt, sonst käme eine Salve für alles, was ohnehin schon dalag. */
let bekannteAngebote = null;
/* ---- Hinweise im Spielverlauf ----
 * Der Sandkasten hat viele Systeme. Statt alles im Tutorial vorab zu erklären,
 * erscheint je System ein kurzer Hinweis genau dann, wenn es zum ersten Mal
 * wichtig wird — einmal, höchstens einer je 45 s, nie während des Tutorials.
 * Abschaltbar unter Einstellungen → Steuerung („Hinweise im Spiel“). */
const HINWEISE = [
  { id: "stadt", wann: st => st.stadt && st.tick > 90, titel: "Die Stadt wächst mit",
    text: "Oben neben deinem Geld steht, wie viele Einwohner die Stadt hat. Sie wohnen im Wohngebiet, arbeiten in euren Gebäuden und kaufen in euren Läden. Ein Klick auf die Einwohnerzahl öffnet die Stadtübersicht.", panel: ["finanzamt", "Stadtübersicht"] },
  { id: "arbeiter", wann: (st, me) => me.lohn?.soll > 0 && me.lohn.arbeiter < me.lohn.soll, titel: "Dir fehlen Arbeiter",
    text: "Deine Gebäude sind nicht voll besetzt und stellen weniger her. Ein höherer Lohn holt Leute von anderen Firmen — günstiger ist oft eine Jobbörse. Beides findest du im Firma-Panel.", panel: ["firma", "Firma-Panel"] },
  { id: "loehne", wann: (st, me) => me.lohn?.letzt?.zahl > 0, titel: "Löhne",
    text: "Jede Minute zahlst du deinen Arbeitern Lohn. 30 % davon gehen als Steuer und Miete an die Stadt — damit baut sie neue Wohnungen, und es ziehen mehr Leute zu.", panel: ["firma", "Firma-Panel"] },
  { id: "baumaterial", wann: st => st.stadt?.auftraege?.length > 0, titel: "Die Stadt kauft Baumaterial",
    text: "Für neue Wohnblöcke bestellt die Stadt Ziegel, Beton, Stahl oder Elektronik und zahlt 15 % über Kurs. Liefern kannst du in der Stadtübersicht.", panel: ["finanzamt", "Stadtübersicht"] },
  { id: "versorgung", wann: st => st.stadt?.teile?.some(x => x.key === "versorgung" && x.wirkung < 0), titel: "Der Stadt fehlt etwas",
    text: "In keinem Online-Marktplatz gibt es gerade Strom, Wasser oder Lebensmittel. Dann ziehen weniger Leute zu. Wer das ins Regal stellt, hat sichere Kundschaft.", panel: ["finanzamt", "Stadtübersicht"] },
  { id: "steuer", wann: (st, me) => (me.steuer?.steuer || 0) > 0, titel: "Das Finanzamt",
    text: "Alle 10 Minuten zahlst du Gewinnsteuer. Bauen und Ausbauen senken den Gewinn nach und nach (Abschreibung). Die Steuer geht an die Stadt.", panel: ["finanzamt", "Finanzamt"] },
  { id: "stadtanleihe", wann: st => (st.bonds || []).some(b => !b.holderId && String(b.issuer).startsWith("Stadt")), titel: "Die Stadt leiht sich Geld",
    text: "Für neue Wohnungen gibt die Stadt eine Anleihe aus. Wer sie zeichnet, bekommt jede Minute Zinsen und das Geld nach 15 Minuten zurück — zu finden auf anleihen.cs im Stadtnetz.", panel: ["bonds", "Anleihenmarkt"] },
  { id: "software", wann: (st, me, id) => st.players?.[id]?.industry === "software" && st.tick > 30, titel: "Dein Software-Panel",
    text: "Als Software-Firma baust du Shop-Systeme, Bürger-Apps und Jobbörsen für die anderen. Alles liegt im Software-Panel in Reitern: Markt, Mein System, Entwicklung, Design und Produkte.", panel: ["software", "Software"] },
  { id: "touristik", wann: (st, me, id) => !!st.touristik && (st.map || []).some(x => x.owner === id && (x.btype === "campingplatz" || x.btype === "strandhotel") && !(x.bauBis > st.tick)), titel: "Gäste für deine Hotels",
    text: "Jede Minute kommen Gäste in die Stadt und wählen ein Hotel nach Bewertung und Zimmerpreis. Renovierte Strandhotels bekommen mehr Sterne (ab 3 Sternen mit Frühstück), und ein Stadtfest lockt viele Gäste auf einmal.", panel: ["touristik", "Touristik"] },
  { id: "website", wann: (st, me, id) => (st.website || []).some(w => w.version >= 1 && w.ownerId !== id) && !st.rechenzentren?.websites?.[id], titel: "Eine Website für deine Firma",
    text: "Software-Firmen bauen jetzt Websites. Eine eigene Website bringt mehr Reichweite: Deine Läden verkaufen schneller, Hotels bekommen mehr Gäste. Bestellen kannst du sie auf der Statusseite eines Rechenzentrums.", panel: ["software", "Software"] },
  { id: "stadtnetz", wann: st => Object.values(st.rechenzentren?.websites || {}).filter(w => w.stufe > 0).length >= 2, titel: "Das Stadtnetz",
    text: "Im Stadtnetz (Knopf unten) stehen alle Firmen mit Website. Mit einem Branchenportal kaufst du dort direkt ein — zum Beispiel Obst im Hofladen oder Strom im Kundenportal.", panel: null },
  { id: "aktien", wann: st => st.tick > 900, titel: "Aktien und Übernahmen",
    text: "Jede Firma hat 100 Aktien. An der Stadtbank kaufst du Anteile anderer Firmen und kassierst Dividende — oder übernimmst eine Firma ganz. Behalte die Mehrheit an deiner eigenen.", panel: ["bank", "Stadtbank"] },
  { id: "ziel", wann: st => st.tick > 1500, titel: "Auf dem Weg zum Ziel",
    text: "Es gewinnt, wer zuerst das Vermögensziel erreicht (oben links). Vermögen sind Geld, Lager, Gebäude und Beteiligungen — Ausbauen lohnt sich also, auch wenn dabei Geld aus der Kasse geht." },
];
const HINWEIS = { gesehen: (() => { try { return new Set(JSON.parse(localStorage.getItem("cs_hinweise") || "[]")); } catch { return new Set(); } })(), zuletzt: -Infinity, offen: null };
function spielHinweise(state, me, myId) {
  if (EINST.hinweise === false || tutIdx >= 0 || !state?.started || state.winner || !me) return;
  if (HINWEIS.offen || performance.now() - HINWEIS.zuletzt < 45000) return;
  const h = HINWEISE.find(x => !HINWEIS.gesehen.has(x.id) && (() => { try { return x.wann(state, me, myId); } catch { return false; } })());
  if (!h) return;
  HINWEIS.gesehen.add(h.id); HINWEIS.offen = h;
  try { localStorage.setItem("cs_hinweise", JSON.stringify([...HINWEIS.gesehen])); } catch {}
  let el = document.getElementById("spielHinweis");
  if (!el) { el = document.createElement("div"); el.id = "spielHinweis"; el.setAttribute("role", "status"); document.body.append(el); }
  el.innerHTML = `<div class="shKopf"><b>💡 ${t(h.titel)}</b><button type="button" data-sh="zu" aria-label="${t("Schließen")}">×</button></div>
    <p>${t(h.text)}</p>
    <div class="shFuss">${h.panel ? `<button type="button" class="buyb" data-sh="panel">${t(h.panel[1])}</button>` : ""}
      <button type="button" class="mini" data-sh="zu">${t("Verstanden")}</button>
      <button type="button" class="shAus" data-sh="aus">${t("Keine Hinweise mehr")}</button></div>`;
  el.hidden = false;
  SFX.spiel?.("hinweis");
}
document.addEventListener("click", e => {
  const b = e.target.closest("#spielHinweis [data-sh]"); if (!b) return;
  const h = HINWEIS.offen;
  if (b.dataset.sh === "panel" && h?.panel) openPanel(h.panel[0]);
  if (b.dataset.sh === "aus") EINST.setzen("hinweise", false);
  document.getElementById("spielHinweis").hidden = true;
  HINWEIS.offen = null; HINWEIS.zuletzt = performance.now();
});
function kapitalmarktHinweis(state, myId) {
  const offen = new Set();
  for (const b of state.bonds || [])
    if (!b.holderId && b.issuerId !== myId) offen.add("A" + b.id);
  for (const l of state.shareListings || [])
    if ((l.sellerId ?? l.companyId) !== myId && (!l.toId || l.toId === myId)) offen.add("S" + l.id);
  if (bekannteAngebote === null) { bekannteAngebote = offen; return; }
  for (const k of offen) if (!bekannteAngebote.has(k)) { SFX.spiel("hinweis"); break; }
  bekannteAngebote = offen;
}


/* ---------- Motorsport ----------
 * Garage, Fahrzeugentwicklung und Fahrer in einem Panel. Der Wagen wird als
 * Draufsicht gezeichnet und verändert sich mit dem Tuning: Der Heckflügel
 * wächst mit der Aerodynamik, die Reifen mit dem Reifentuning, ein Streifen
 * markiert den Antrieb. So sieht man die Investition, statt sie nur zu lesen. */
const STAT_LABEL = { speed: "Speed", beschl: "Beschleunigung", handling: "Handling",
                     effizienz: "Effizienz", standfest: "Standfestigkeit" };
/* Kurzformen fuer die Wirkungs-Kuerzel — ausgeschrieben passen sechs Werte
 * nicht nebeneinander, ohne dass die Karte umbricht. */
const STAT_KURZ = { speed: "Speed", beschl: "Beschl.", handling: "Handling",
                    effizienz: "Effizienz", standfest: "Standfest." };
/* Ein Piktogramm je Bereich: Man erkennt die Karte, bevor man den Namen liest. */
const TUNE_ICON = {
  antrieb:     `<path d="M2 8h3M11 8h3M8 2v3M8 11v3" /><circle cx="8" cy="8" r="3"/>`,
  batterie:    `<rect x="2" y="5" width="10" height="6" rx="1.5"/><path d="M14 7v2"/><path d="M5 8h4"/>`,
  reifen:      `<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>`,
  fahrwerk:    `<path d="M4 3v2M4 11v2M4 5l4 1-4 1 4 1-4 1"/><circle cx="12" cy="8" r="2.5"/><path d="M12 3v2.5M12 10.5V13"/>`,
  aerodynamik: `<path d="M2 6h12M3.5 9.5h9"/><path d="M2 12h5"/><path d="M11 3.5l3 2.5-3 2.5"/>`,
  software:    `<rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5h2.5M1.5 9.5h2.5M12 6.5h2.5M12 9.5h2.5"/>`,
};
const tuneIcon = k => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
  stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TUNE_ICON[k] || ""}</svg>`;
const STAT_MAXW = 130;

function rennwagenSvg(a, farbe) {
  const t = a.tuning || {}, id = a.id;
  /* Jede Ausbaustufe ist am Wagen abzulesen: Flügel wachsen mit der
   * Aerodynamik, die Walzen mit dem Reifentuning, die Querlenker treten mit
   * dem Fahrwerk hervor, ein Mittelstreifen kommt mit dem Antrieb, der Lack
   * wird mit der Rennsoftware glänzender und die Batterie legt einen Schimmer
   * unter das Auto. So sieht man die Investition, statt sie nur zu lesen. */
  const aero = t.aerodynamik || 0, reif = t.reifen || 0, fahr = t.fahrwerk || 0;
  const fw = 30 + aero * 4.5;            // halbe Frontflügelbreite
  const rw = 24 + aero * 4.5;            // halbe Heckflügelbreite
  const rad = 9 + reif * 1.7;            // Reifenbreite
  const arm = 1 + fahr * 0.7;            // Stärke der Querlenker
  const armFarbe = fahr ? farbe : "#4a5a6a";
  const glanz = (t.software || 0) > 0 ? 0.5 : 0;
  const akku = (t.batterie || 0) > 0;
  const streifen = (t.antrieb || 0) > 0;
  return `<svg viewBox="0 0 100 172" width="84" height="145" aria-hidden="true">
    <defs>
      <linearGradient id="lk${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${farbe}" stop-opacity=".95"/>
        <stop offset=".55" stop-color="${farbe}" stop-opacity=".62"/>
        <stop offset="1" stop-color="${farbe}" stop-opacity=".42"/>
      </linearGradient>
      <radialGradient id="gl${id}" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="${farbe}" stop-opacity=".55"/>
        <stop offset="1" stop-color="${farbe}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${akku ? `<ellipse cx="50" cy="96" rx="34" ry="52" fill="url(#gl${id})"/>` : ""}

    <g stroke="${armFarbe}" stroke-width="${arm}" stroke-linecap="round" opacity=".9">
      <path d="M44 52 L26 50 M44 60 L26 62 M56 52 L74 50 M56 60 L74 62"/>
      <path d="M40 110 L24 108 M40 119 L24 121 M60 110 L76 108 M60 119 L76 121"/>
    </g>

    <g fill="#0d1219">
      <rect x="${20 - rad / 2}" y="45" width="${rad}" height="24" rx="3.5"/>
      <rect x="${80 - rad / 2}" y="45" width="${rad}" height="24" rx="3.5"/>
      <rect x="${18 - rad / 2}" y="103" width="${rad + 3}" height="29" rx="4"/>
      <rect x="${82 - rad / 2 - 3}" y="103" width="${rad + 3}" height="29" rx="4"/>
    </g>
    <g stroke="#2b3646" stroke-width="1" opacity=".8">
      <path d="M20 49v16 M80 49v16 M${19.5} 108v19 M${80.5} 108v19"/>
    </g>

    <rect x="${50 - fw}" y="8" width="${fw * 2}" height="9" rx="2.5" fill="${farbe}" opacity=".9"/>
    <rect x="${50 - fw}" y="6" width="4" height="15" rx="1.5" fill="#0d1219"/>
    <rect x="${50 + fw - 4}" y="6" width="4" height="15" rx="1.5" fill="#0d1219"/>

    <path d="M50 16 L55 42 L59 64 L63 84 L63 108 L58 124 L57 140 L43 140 L42 124 L37 108 L37 84 L41 64 L45 42 Z"
          fill="url(#lk${id})" stroke="${farbe}" stroke-width="1.6" stroke-linejoin="round"/>
    ${streifen ? `<path d="M50 18 L50 138" stroke="#fff" stroke-width="3.5" opacity=".5" stroke-linecap="round"/>` : ""}
    ${glanz ? `<path d="M45 24 L41 66 L45 66 L49 24 Z" fill="#fff" opacity="${glanz}"/>` : ""}

    <path d="M43 74 q7 -5 14 0 l1 14 q-8 5 -16 0 Z" fill="#0b0f14" opacity=".85"/>
    <circle cx="50" cy="80" r="5.4" fill="#0d1219" stroke="${farbe}" stroke-width="1.1"/>
    <path d="M41 78 q9 -11 18 0" fill="none" stroke="#e3e9f4" stroke-width="1.6" opacity=".55"/>
    <path d="M44 96 q6 -4 12 0 l2 20 q-8 4 -16 0 Z" fill="#0b0f14" opacity=".45"/>

    <rect x="${50 - rw}" y="142" width="${rw * 2}" height="10" rx="2.5" fill="${farbe}" opacity=".92"/>
    <rect x="${50 - rw}" y="139" width="4" height="17" rx="1.5" fill="#0d1219"/>
    <rect x="${50 + rw - 4}" y="139" width="4" height="17" rx="1.5" fill="#0d1219"/>
    <rect x="${50 - rw + 6}" y="152" width="${rw * 2 - 12}" height="4" rx="1.5" fill="${farbe}" opacity=".55"/>

    <text x="50" y="124" text-anchor="middle" font-size="14" font-weight="800"
          fill="#fff" opacity=".9" font-family="var(--font)">${a.nr}</text>
  </svg>`;
}

function statBalken(basis, jetzt) {
  const b = Math.max(0, Math.min(100, basis / STAT_MAXW * 100));
  const j = Math.max(0, Math.min(100, jetzt / STAT_MAXW * 100));
  const runter = jetzt < basis;
  return `<div style="position:relative;height:7px;background:var(--panel2);border-radius:4px;overflow:hidden">
      <div style="position:absolute;inset:0 auto 0 0;width:${Math.min(b, j)}%;background:var(--line2,#4a5a6a)"></div>
      <div style="position:absolute;inset:0 auto 0 ${Math.min(b, j)}%;width:${Math.abs(j - b)}%;background:${runter ? "var(--bad,#e05a5a)" : "var(--accent)"}"></div>
    </div>`;
}

function motorsportRendern(state, me, myId) {
  const knopf = document.getElementById("dockMotor");
  const meta = store.get().meta || {};
  const staelle = (state.map || []).filter(t => t.owner === myId && (BTYPES()[t.btype] || {}).racing);
  if (knopf) knopf.style.display = staelle.length ? "" : "none";
  const box = document.getElementById("motorbody");
  if (!box || !document.getElementById("p-motorsport").classList.contains("open")) return;
  /* Nicht neu bauen, waehrend jemand ein Bedienelement benutzt. Das Panel baut
   * sich im Sekundentakt komplett neu auf — wer die Fahrerauswahl aufklappt,
   * dem wurde das Auswahlfeld unter der Hand ersetzt, es klappte zu, und der
   * Fahrer liess sich nicht zuweisen. Die anderen Panels haben denselben
   * Schutz; hier fehlte er. */
  if (box.contains(document.activeElement)
      && /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (!staelle.length) { box.innerHTML = `<div class="note">Du betreibst keinen Rennstall.</div>`; return; }

  const farbe = state.players[myId]?.color || "#7ad";
  /* Aufgeklappte Fahrzeugakten über den Sekunden-Rerender retten. */
  const akteOffen = new Set([...box.querySelectorAll("details[data-akte][open]")].map(d => d.dataset.akte));
  const TUN = meta.tuning || {}, TMAX = meta.tuningMax || 3;
  const RAW = meta.raceStats || {};
  const fahrer = state.fahrer || [];
  const meine = fahrer.filter(f => f.teamId === myId);
  const alleAutos = staelle.flatMap(t => (t.autos || []).map(a => ({ ...a, x: t.x, y: t.y })));

  const autoKarte = a => {
    const w = a.werte || {}, basis = RAW[a.good] || {};
    const f = fahrer.find(f => f.id === a.fahrerId);
    const balken = Object.keys(STAT_LABEL).map(k => `
      <div style="margin-bottom:5px">
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.75">
          <span>${STAT_LABEL[k]}</span>
          <span><b style="color:var(--text)">${w[k]}</b>${w[k] !== basis[k] ? ` <span style="opacity:.6">(${basis[k]})</span>` : ""}</span>
        </div>${statBalken(basis[k] ?? 0, w[k] ?? 0)}
      </div>`).join("");
    const stufenGesamt = Object.values(a.tuning || {}).reduce((x, y) => x + y, 0);
    const stufenMax = Object.keys(TUN).length * TMAX;
    const tuningKnoepfe = `<div class="tunestand">
        <span>Entwicklungsstand</span>
        <span class="bar"><i style="width:${Math.round(stufenGesamt / stufenMax * 100)}%"></i></span>
        <span><b style="color:var(--text)">${stufenGesamt}</b>/${stufenMax}</span>
      </div><div class="tunegrid">` +
      Object.entries(TUN).map(([key, T]) => {
        const stufe = (a.tuning || {})[key] || 0;
        const naechste = stufe + 1;
        const voll = naechste > TMAX;
        const cash = Math.round(T.cash * naechste);
        /* Teile mit Bestand: "2/3 Rennreifen" sagt sofort, woran es hakt —
         * vorher stand dort nur die geforderte Menge und man musste im Lager
         * nachsehen, warum der Knopf grau ist. */
        const teile = Object.entries(T.teile).map(([g, n]) => {
          const brauch = n * naechste, habe = Math.floor(me.inv[g] || 0);
          return { g, brauch, habe, fehlt: habe < brauch };
        });
        const geldFehlt = me.cash < cash;
        const reicht = !voll && !geldFehlt && teile.every(t => !t.fehlt);
        const pips = Array.from({ length: TMAX }, (_, i) => `<span class="pip${i < stufe ? " on" : ""}"></span>`).join("");
        const chips = [...Object.entries(T.plus).map(([k, v]) => `<span class="chip up">+${v} ${STAT_KURZ[k]}</span>`),
                       ...Object.entries(T.minus).map(([k, v]) => `<span class="chip dn">−${v} ${STAT_KURZ[k]}</span>`)].join("");
        const fuss = voll
          ? `<span class="tunefertig">✓ Höchststufe erreicht</span>`
          : `<span class="geld${geldFehlt ? " tunehint" : ""}">${fmt(cash)}</span>` +
            teile.map(t => `<span class="teil${t.fehlt ? " fehlt" : ""}">${t.habe}/${t.brauch} ${gname(t.g)}</span>`).join("");
        return `<button class="tunecard${voll ? " fertig" : ""}" data-tune="${key}" data-auto="${a.id}"
            data-x="${a.x}" data-y="${a.y}" ${reicht ? "" : "disabled"}
            title="${voll ? "Höchststufe" : `Stufe ${naechste} von ${TMAX}`}">
            <span class="tunehead">${tuneIcon(key)}<b>${T.name}</b><span class="pips">${pips}</span></span>
            <span class="chips">${chips}</span>
            <span class="tunecost">${fuss}</span>
          </button>`;
      }).join("") + `</div>`;
    const fahrerWahl = meine.length
      ? `<select data-setfahrer="${a.id}" style="width:100%;margin-top:4px">
           <option value="">— kein Fahrer —</option>
           ${meine.map(x => `<option value="${x.id}" ${x.autoId === a.id ? "selected" : ""}>${x.name} (${x.speed}/${x.handling}/${x.reaktion})</option>`).join("")}
         </select>`
      : `<div class="note" style="margin:4px 0 0">Noch kein Fahrer unter Vertrag.</div>`;
    return `<div style="background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="display:flex;gap:12px">
          <div style="flex:none;text-align:center">${rennwagenSvg(a, farbe)}
            <div style="font-size:11px;margin-top:3px;color:${
              a.zustand < 25 ? "var(--down)" : a.zustand < 55 ? "#fbbf24" : "var(--dim)"}">Zustand ${a.zustand} %</div>
            <div style="height:4px;border-radius:2px;background:var(--line);overflow:hidden;margin-top:3px">
              <i style="display:block;height:100%;width:${a.zustand}%;background:${
                a.zustand < 25 ? "var(--down)" : a.zustand < 55 ? "#fbbf24" : "var(--up)"}"></i></div></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
              <input class="autoname" data-rename="${a.id}" data-x="${a.x}" data-y="${a.y}"
                     maxlength="24" value="${escapeHtml(a.name || "")}"
                     placeholder="${escapeHtml(gname(a.good) + " #" + a.nr)}"
                     title="Eigener Name — leer lassen für die Vorgabe">
              <span style="font-size:11px;opacity:.7;flex:none">Wert ${fmt(a.wert || 0)}</span>
            </div>
            <div style="font-size:11px;opacity:.7;margin-bottom:6px">
              ${a.rennen} Rennen · ${a.siege} Siege${f ? ` · am Steuer: <b style="color:var(--accent)">${f.name}</b>` : ""}</div>
            ${balken}${fahrerWahl}
          </div>
        </div>
        <div class="sec" style="margin-top:8px">Entwicklung</div>${tuningKnoepfe}
        <div class="sec" style="margin-top:8px">${t("Fahrzeugakte")}</div>
        <div style="font-size:11.5px;opacity:.85;display:flex;gap:14px;flex-wrap:wrap">
          <span><b>${(a.km || 0).toLocaleString("de-DE")}</b> km</span>
          <span>Kauf: <b>${fmt(a.kaufpreis || 0)}</b></span>
          <span>Tuning: <b>${fmt(a.tuningAusgaben || 0)}</b></span>
          <span>Investiert: <b>${fmt((a.kaufpreis || 0) + (a.tuningAusgaben || 0))}</b></span>
        </div>
        <details data-akte="${a.id}" ${akteOffen.has(String(a.id)) ? "open" : ""} style="margin-top:5px">
          <summary class="note" style="cursor:pointer">${t("Verlauf")} (${(a.historie || []).length})</summary>
          ${(a.historie || []).slice().reverse().map(h =>
            `<div style="display:flex;justify-content:space-between;font-size:11px;opacity:.8;padding:2px 0">
               <span>${h.text}</span><span>${h.amt ? fmt(h.amt) : ""}</span></div>`).join("")}
        </details>
        ${(() => {
          /* Instandsetzung. Ohne sie ist Verschleiss eine Einbahnstrasse: Unter
           * 25 % ist der Wagen nicht mehr startklar, und ausmustern oder
           * verkaufen kann man ihn nicht — er blockiert dann für immer einen
           * Stellplatz. */
          const rep = a.reparatur;
          if (!rep || !rep.fehlend) return "";
          const teile = Object.entries(rep.teile || {});
          const fehltTeil = teile.some(([g, n]) => (me.inv[g] || 0) < n);
          const fehltGeld = me.cash < rep.cash;
          const gemeldet2 = state.rennen && state.rennen.phase !== "vorbei"
            && (state.rennen.teilnehmer || []).some(x2 => x2.autoId === a.id);
          const grund = gemeldet2 ? "Wagen ist zum Rennen gemeldet"
            : fehltGeld ? "Kapital fehlt"
            : fehltTeil ? "Teile fehlen — an der Börse kaufen" : "";
          return `<button class="fbtn" style="margin-top:8px;width:100%;${
              a.zustand < 25 ? "background:var(--down);color:#fff" : ""}"
              data-reparieren="${a.id}" data-x="${a.x}" data-y="${a.y}"
              ${grund ? "disabled" : ""}>
              Instand setzen auf 100 % · ${fmt(rep.cash)} + ${teile.map(([g, n]) =>
                `${me.inv[g] >= n ? "" : "⚠ "}${n}× ${gname(g)}`).join(" + ")}${grund ? ` — ${grund}` : ""}</button>`;
        })()}
        ${state.rennen?.phase === "anmeldung" ? (() => {
          const gemeldet = state.rennen.teilnehmer.some(x2 => x2.autoId === a.id);
          const startklar = a.fahrerId && a.zustand >= 25;
          return `<button class="buyb" style="margin-top:8px;width:100%" data-anmelden="${a.id}" data-x="${a.x}" data-y="${a.y}"
            ${gemeldet || !startklar ? "disabled" : ""}>
            ${gemeldet ? t("✓ Zum Rennen gemeldet") : startklar ? `${t("Zum Rennen melden")} (${fmt(state.rennen.nenngeld || 1500)})` : t("Nicht startklar (Fahrer + Zustand ≥ 25 % nötig)")}</button>`;
        })() : ""}
      </div>`;
  };

  /* Gesamtnote aus den fünf Rennwerten. Erfahrung bleibt draußen: Sie läuft
   * von 0 bis 40 und würde jeden Fahrer künstlich nach unten ziehen — sie
   * steht deshalb als eigener Wert daneben. */
  const fGesamt = f => Math.round((f.speed + f.handling + f.reaktion + f.strategie + f.konstanz) / 5);
  const helmSvg = (f, farbe) => `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <path d="M17 4c7 0 11 4.6 11 11v6c0 4-3 6-6.5 6h-9C8 27 5 24.4 5 20v-5C5 8.6 9.6 4 17 4Z"
            fill="${farbe}" opacity=".9"/>
      <path d="M8.5 14.5c1.8-3.4 5-5 8.5-5s6.7 1.6 8.5 5c.6 1.1.2 2.2-1 2.4-5 .9-10.5.9-15 0-1.2-.2-1.6-1.3-1-2.4Z"
            fill="#0b0f14" opacity=".85"/>
      <path d="M17 27h5c2.2 0 3.6-1 4.4-2.6" fill="none" stroke="#0b0f14" stroke-width="1.4" opacity=".5"/>
      <text x="17" y="25" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" opacity=".85">${f.nr}</text>
    </svg>`;
  const fStat = (name, wert, max) => `<span class="fstat"><span>${name}</span>
      <i><b style="width:${Math.round(Math.min(100, wert / max * 100))}%"></b></i><u>${wert}</u></span>`;

  const fahrerKarte = f => {
    const meiner = f.teamId === myId, fremd = f.teamId && !meiner;
    const auto = meiner && f.autoId ? alleAutos.find(a => a.id === f.autoId) : null;
    const helmFarbe = meiner ? farbe : fremd ? (state.players[f.teamId]?.color || "#6b7a8d") : "#59687c";
    const platzFrei = alleAutos.length > 0;
    return `<div class="fcard${meiner ? " mein" : fremd ? " fremd" : ""}">
        <div class="fhead">
          ${helmSvg(f, helmFarbe)}
          <span class="fname"><b>${f.name}</b><span>${f.land} · Startnummer ${f.nr}</span></span>
          <span class="fovr"><b>${fGesamt(f)}</b><span>Gesamt</span></span>
        </div>
        <div class="fstats">
          ${fStat("Speed", f.speed, 100)}${fStat("Strategie", f.strategie, 100)}
          ${fStat("Handling", f.handling, 100)}${fStat("Konstanz", f.konstanz, 100)}
          ${fStat("Reaktion", f.reaktion, 100)}${fStat("Erfahrung", f.erfahrung, 40)}
        </div>
        ${meiner ? `<div class="fsitz${auto ? "" : " leer"}">${auto
            ? `Am Steuer: ${gname(auto.good)} #${auto.nr}`
            : platzFrei ? "Ohne Cockpit — unten am Fahrzeug zuweisen" : "Ohne Cockpit — noch kein Fahrzeug im Stall"}</div>` : ""}
        <div class="ffoot">
          <span class="fgehalt">${fremd
            ? `Unter Vertrag bei <b>${state.players[f.teamId]?.name ?? "einem anderen Team"}</b>`
            : `<b>${fmt(f.gehalt)}</b> je Minute`}</span>
          ${meiner ? `<button class="fbtn weg" data-feuer="${f.id}">Vertrag lösen</button>`
            : fremd ? `<button class="fbtn" disabled>Vergeben</button>`
            : `<button class="fbtn" data-heuer="${f.id}" ${me.cash >= f.gehalt * 2 ? "" : "disabled"}
                 title="${fmt(f.gehalt)} Handgeld sofort, danach ${fmt(f.gehalt)} je Minute">Verpflichten</button>`}
        </div>
      </div>`;
  };

  /* Countdown und Tabelle nach oben: Wer den Rennstall oeffnet, will wissen,
   * wie viel Zeit zum Vorbereiten bleibt und wo er in der Meisterschaft steht.
   * Vorher sah man erst bei der Ankuendigung, dass ueberhaupt etwas ansteht. */
  const sek = state.naechstesRennen;
  const countdown = state.rennen
    ? `<div class="sec">Renntag läuft — ${state.rennen.phase === "anmeldung" ? "Anmeldung offen" : state.rennen.phase === "laeuft" ? "Rennen läuft" : "Siegerehrung"}</div>`
    : sek == null ? ""
    : `<div class="sec">Nächster Renntag in ${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, "0")}</div>
       <div class="note" style="margin-top:-2px">Zeit für Reparatur, Tuning und Fahrerwechsel — gemeldet wird erst, wenn die Anmeldung offen ist.</div>`;
  /* Fanbasis sichtbar machen: Sie ist im Renntag eine laufende Einnahme, und
   * ohne Anzeige waere nicht erkennbar, dass sie zwischen den Rennen zerfaellt. */
  const fanZeile = state.mode === "renntag" ? (() => {
    const fans = me.fans || 0, hubs = me.fanHubs || 0;
    if (!fans && !hubs) return "";
    const proMin = Math.round(fans * 0.01 * 60 * (hubs ? Math.min(1.5, 1 + .25 * (hubs - 1)) : 0));
    return `<div class="sec">Fanbasis</div>
      <div class="rennteil"><span style="flex:1"><b>${fans.toLocaleString("de-DE")}</b> Fans${
        hubs ? ` · ${hubs} Fan-Hub${hubs > 1 ? "s" : ""}` : ""}</span>
        <span class="quote">${hubs ? `${fmt(proMin)}/min` : "kein Hub"}</span></div>
      <div class="note" style="margin-top:-2px">${hubs
        ? "Zahlt alle 30 Sekunden aus. Die Basis zerfällt langsam — wer nicht fährt, verliert sie."
        : "Bau einen Fan-Hub im Zentrum, um die Fans zu Geld zu machen."}</div>`;
  })() : "";
  const wm = state.wm && state.saison ? (() => {
    const rang = Object.entries(state.wm).sort((a2, b2) => b2[1] - a2[1]);
    return `<div class="sec">Meisterschaft · Renntag ${state.saison.gefahren} von ${state.saison.gesamt}</div>`
      + (rang.length
        ? rang.map(([pid, pkt], i) => `<div class="rennteil">
             <b style="width:20px">${i + 1}.</b>
             <span style="flex:1">${escapeHtml(state.players[pid]?.name || "—")}${pid === myId ? ` <span class="meta" style="color:var(--accent)">· du</span>` : ""}</span>
             <span class="quote">${pkt}</span></div>`).join("")
        : `<div class="note">Noch keine Punkte vergeben. 10 für den Sieg, dann 6, 4, 3, 2, 1.</div>`);
  })() : "";
  box.innerHTML = countdown + fanZeile + wm +
    `<div class="note">Fahrzeuge im Rennstall sind keine handelbare Ware mehr. Teile fürs Tuning
       kaufst du an der Börse — Rennreifen und Rennsoftware stellen andere Firmen her.</div>
     <div class="sec">Garage (${alleAutos.length})</div>` +
    (alleAutos.length ? alleAutos.map(autoKarte).join("")
      : `<div class="note">Noch kein Fahrzeug eingestellt. Kaufe ein Auto an der Börse und stelle es am Rennstall ein.</div>`) +
    /* Nach Zugehörigkeit gruppiert und innerhalb der freien nach Gesamtnote:
     * Wer einen Fahrer sucht, will die besten zuerst sehen, nicht die
     * Reihenfolge, in der der Server sie gewürfelt hat. */
    (() => {
      const frei = fahrer.filter(f => !f.teamId).sort((a, b) => fGesamt(b) - fGesamt(a));
      const andere = fahrer.filter(f => f.teamId && f.teamId !== myId);
      const block = (titel, liste) => liste.length
        ? `<div class="sec">${titel}</div><div class="fgrid">${liste.map(fahrerKarte).join("")}</div>` : "";
      return block(`Dein Team — ${meine.length} unter Vertrag`, meine)
           + block(`Frei verfügbar — ${frei.length}`, frei)
           + block("Bei anderen Teams", andere);
    })();

  box.querySelectorAll("[data-reparieren]").forEach(b => b.addEventListener("click", () =>
    act("stallReparieren", { x: +b.dataset.x, y: +b.dataset.y, autoId: +b.dataset.reparieren })));
  box.querySelectorAll("[data-tune]").forEach(b => b.addEventListener("click", () =>
    act("stallTunen", { x: +b.dataset.x, y: +b.dataset.y, autoId: +b.dataset.auto, bereich: b.dataset.tune })));
  box.querySelectorAll("[data-anmelden]").forEach(b => b.addEventListener("click", () =>
    act("rennenAnmelden", { x: +b.dataset.x, y: +b.dataset.y, autoId: +b.dataset.anmelden })));
  box.querySelectorAll("[data-heuer]").forEach(b => b.addEventListener("click", () =>
    act("fahrerAnheuern", { fahrerId: +b.dataset.heuer })));
  box.querySelectorAll("[data-feuer]").forEach(b => b.addEventListener("click", () =>
    act("fahrerEntlassen", { fahrerId: +b.dataset.feuer })));
  /* Wagenname: Enter oder Verlassen speichert. Leeres Feld setzt auf die
   * Vorgabe zurueck — der Platzhalter zeigt sie dann wieder an. */
  box.querySelectorAll("[data-rename]").forEach(inp => {
    const senden = () => {
      const neu = inp.value.trim();
      if (neu === (inp.dataset.stand ?? "")) return;      // nichts geaendert
      inp.dataset.stand = neu;
      act("autoUmbenennen", { x: +inp.dataset.x, y: +inp.dataset.y,
                              autoId: +inp.dataset.rename, name: neu });
    };
    inp.dataset.stand = inp.value.trim();
    inp.addEventListener("blur", senden);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
  });
  box.querySelectorAll("[data-setfahrer]").forEach(sel => sel.addEventListener("change", () => {
    const autoId = +sel.dataset.setfahrer;
    if (sel.value) return act("fahrerZuweisen", { fahrerId: +sel.value, autoId });
    /* "kein Fahrer": Der Server kennt keinen Fahrer 0 — also den bisher
     * zugewiesenen suchen und DESSEN Zuweisung lösen. */
    const bisher = meine.find(f => f.autoId === autoId);
    if (bisher) act("fahrerZuweisen", { fahrerId: bisher.id, autoId: null });
  }));
}

/* ---------- Renntag ----------
 * Ein Overlay für alle: Anmeldung/Wetten/Sponsoring, dann das Live-Rennen
 * mit animierter Strecke, dann die Siegerehrung. Der Server schickt jede
 * Sekunde neue Distanzen; die Streckengrafik interpoliert dazwischen, damit
 * die Wagen flüssig fahren statt zu springen. */
let rennMinimiert = false;
const RENN_ANIM = new Map();     // autoId -> { shown, ziel }
/* ---- Renn-Sounds (WebAudio, synthetisch — keine Dateien nötig) ----
 * Respektiert den Stummschalter der Musik. Kurzer Piep je Ampellicht,
 * Motor-Anlass-Sweep beim Start, Jubel (geformtes Rauschen) im Ziel. */
const rennAudio = {};
function rennTon(freq, dauer, typ = "sine", vol = .1, sweepZu = null) {
  try {
    if (typeof MUSIC !== "undefined" && MUSIC.istStumm()) return;
    const ctx = rennAudio.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g2 = ctx.createGain();
    o.type = typ; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepZu) o.frequency.exponentialRampToValueAtTime(sweepZu, ctx.currentTime + dauer);
    g2.gain.setValueAtTime(vol, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + dauer);
    o.connect(g2); g2.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dauer);
  } catch {}
}
function rennJubel() {
  try {
    if (typeof MUSIC !== "undefined" && MUSIC.istStumm()) return;
    const ctx = rennAudio.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    const puffer = ctx.createBuffer(1, ctx.sampleRate * 1.6, ctx.sampleRate);
    const d = puffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.4);
    const q = ctx.createBufferSource(); q.buffer = puffer;
    const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 1100; filter.Q.value = .6;
    const g2 = ctx.createGain(); g2.gain.value = .16;
    q.connect(filter); filter.connect(g2); g2.connect(ctx.destination);
    q.start();
    [523, 659, 784].forEach((f2, i) => setTimeout(() => rennTon(f2, .35, "triangle", .07), 120 + i * 140));
  } catch {}
}
/* Kleine Wagen-Silhouette (Seitenansicht) für Listen — Livree-Farbe rein. */
function wagenChipHtml(farbe, kaputt = false) {
  return `<svg width="30" height="16" viewBox="0 0 30 16" style="flex:none;${kaputt ? "filter:grayscale(.8)" : ""}">
    <rect x="3" y="2" width="4" height="4" rx="1.4" fill="#0c0f14"/><rect x="3" y="10" width="4" height="4" rx="1.4" fill="#0c0f14"/>
    <rect x="21" y="2" width="4" height="4" rx="1.4" fill="#0c0f14"/><rect x="21" y="10" width="4" height="4" rx="1.4" fill="#0c0f14"/>
    <path d="M2 8c0-3 2-5.5 7-5.5h12c4 0 7 2.5 7 5.5s-3 5.5-7 5.5H9C4 13.5 2 11 2 8Z" fill="${farbe}" stroke="rgba(0,0,0,.35)"/>
    <ellipse cx="14" cy="8" rx="4" ry="2.6" fill="#0e1420"/>
    <rect x="1" y="4.6" width="2.6" height="6.8" rx="1" fill="#12161d"/>
  </svg>`;
}
/* Ampel: in den letzten 5 Sekunden der Anmeldung geht je Sekunde ein rotes
 * Licht an; mit dem Start springen alle auf Grün ("lights out and away we go"). */
function rennAmpelRendern(r) {
  const ampel = document.getElementById("rennAmpel");
  if (!ampel) return;
  const countdown = r && r.phase === "anmeldung" && r.rest <= 5;
  const gestartet = r && r.phase === "laeuft" && (RENN_ANIM.gruenBis || 0) > performance.now();
  if (r && r.phase === "laeuft" && rennAmpelRendern.warCountdown) {
    /* Übergang Anmeldung -> Rennen: grüne Phase 2,5 s zeigen + Motorsound */
    RENN_ANIM.gruenBis = performance.now() + 2500;
    rennTon(90, 1.4, "sawtooth", .12, 480);
    rennTon(60, 1.4, "square", .06, 240);
    rennAmpelRendern.warCountdown = false;
  }
  if (countdown) {
    rennAmpelRendern.warCountdown = true;
    const an = Math.max(0, Math.min(5, 6 - r.rest));
    if (rennAmpelRendern.stufe !== an) {
      rennAmpelRendern.stufe = an;
      rennTon(440, .12, "square", .08);
    }
    ampel.hidden = false;
    ampel.innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<span class="licht${i < an ? " rot" : ""}"></span>`).join("");
  } else if (gestartet) {
    ampel.hidden = false;
    ampel.innerHTML = Array.from({ length: 5 }, () => `<span class="licht gruen"></span>`).join("") +
      `<span class="go">GO!</span>`;
  } else {
    ampel.hidden = true;
    if (!r || r.phase !== "anmeldung") rennAmpelRendern.stufe = -1;
  }
}
function rennenRendern(state, myId) {
  /* Die Sponsorgesuche brauchen den eigenen Bestand (Bargeld und Teile), um zu
   * zeigen, was man erfuellen kann. Die Funktion bekommt kein me uebergeben —
   * also hier aus dem Store holen, statt die Signatur aller Aufrufer zu
   * aendern. */
  const me = store.get().me || { inv: {}, cash: 0 };
  const ov = document.getElementById("rennOverlay"), chip = document.getElementById("rennChip");
  const r = state.rennen;
  if (!r) {
    if (!ov.hidden) ov.hidden = true;
    chip.hidden = true; rennMinimiert = false; RENN_ANIM.clear();
    rennenRendern.phase = null;
    return;
  }
  /* Bei jedem Phasenwechsel wieder aufklappen — den Start will niemand verpassen. */
  if (rennenRendern.phase !== r.phase) {
    if (r.phase === "ergebnis" && rennenRendern.phase === "laeuft") rennJubel();
    rennenRendern.phase = r.phase; rennMinimiert = false; rennenRendern.sig = "";
  }
  ov.hidden = rennMinimiert;
  chip.hidden = !rennMinimiert;
  rennAmpelRendern(r);
  document.getElementById("rennChipText").textContent =
    r.phase === "anmeldung" ? `${t("Anmeldung")} ${r.rest}s` : r.phase === "laeuft" ? t("RENNEN LÄUFT") : t("Siegerehrung");
  if (rennMinimiert) return;
  document.getElementById("rennTitel").textContent =
    r.phase === "anmeldung" ? t("🏁 Renntag — Anmeldung & Wetten") :
    r.phase === "laeuft" ? t("🏁 Das Rennen läuft") : t("🏁 Siegerehrung");
  document.getElementById("rennUhr").textContent =
    r.phase === "ergebnis" ? "ZIEL" : `${Math.floor(r.rest / 60)}:${String(r.rest % 60).padStart(2, "0")}`;
  const body = document.getElementById("rennBody");

  if (r.phase === "anmeldung") {
    /* Nur neu bauen, wenn sich strukturell etwas ändert und niemand tippt —
     * sonst frisst der Sekunden-Rerender die Eingaben. */
    const sig = "a" + r.teilnehmer.map(t2 => t2.autoId).join(",") + ":" + r.pool + ":" + r.sponsoren.length
      /* Nicht nur die Anzahl der Gesuche: Wer sein eigenes ersetzt, aendert
       * nichts an der Zahl — die Anzeige bliebe sonst auf dem alten stehen. */
      + ":" + (r.gesuche || []).map(g => g.id + "/" + (g.betrag ?? g.menge)).join(",")
      + ":" + JSON.stringify(r.quoten);
    const tippt = body.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement?.tagName);
    if (rennenRendern.sig !== sig && !tippt) {
      rennenRendern.sig = sig;
      /* Werkswagen haben keinen Besitzer — sie lassen sich weder sponsern noch
       * in der Teamauswahl anzeigen. */
      const wettbar = r.teilnehmer.filter(t2 => t2.ownerId !== myId);
      /* Getroffene Wahl ueber den Neuaufbau retten — das Panel baut sich bei
       * jeder fremden Wette neu auf, und dabei soll die Auswahl stehen
       * bleiben. Ist der Wagen inzwischen weg (Werkswagen weicht einem
       * gemeldeten Stall), faellt sie auf den ersten zurueck. */
      if (!wettbar.some(t2 => t2.autoId === rennenRendern.wahl))
        rennenRendern.wahl = wettbar[0]?.autoId ?? null;
      /* Countdown-Balken: wie viel der Anmeldephase schon verstrichen ist. */
      const phaseProz = Math.round((1 - r.rest / 75) * 100);
      const gewaehlter = r.teilnehmer.find(t2 => t2.autoId === rennenRendern.wahl);
      const artWahl = rennenRendern.wettArt || "sieg";
      body.innerHTML = `
        <div class="phasenkopf">
          <div class="phasenbalken"><i id="phasenFuell" style="width:${phaseProz}%"></i></div>
          <div class="rennstat" style="margin-top:8px">
            <span class="chip2">🏆 ${t("Preistopf")} <b>${fmt(r.topf)}</b></span>
            <span class="chip2">${t("Sieg-Pool")} <b>${fmt(r.pools?.sieg || 0)}</b></span>
            <span class="chip2">${t("Podium-Pool")} <b>${fmt(r.pools?.podium || 0)}</b></span>
            <span class="chip2">${t("Ausfall-Pool")} <b>${fmt(r.pools?.ausfall || 0)}</b></span>
          </div>
        </div>
        <div class="renngrid">
          <div class="rennbox">
            <div class="lbl">${t("Startfeld")} · ${r.teilnehmer.length}/8 ${t("Wagen")}</div>
            ${r.teilnehmer.map((t2, i) => {
              const eigen = t2.ownerId === myId;
              const gewaehlt = !eigen && t2.autoId === rennenRendern.wahl;
              const marke = eigen ? `<span class="herkunft selbst">${t("dein Stall")}</span>`
                          : t2.bot ? `<span class="herkunft">${t("Werksteam")}</span>`
                                   : `<span class="herkunft spieler">${t("gemeldet")}</span>`;
              const L = t2.letztes;
              const letztes = L
                ? `Zuletzt: ${L.aus ? "ausgefallen" : `${L.platz}. von ${L.feld}`}`
                : t("Erstes Rennen");
              return `<div class="startzeile${eigen ? " selbst" : " wettbar rennteil"}${gewaehlt ? " gewaehlt" : ""}"${eigen ? "" : ` data-auto="${t2.autoId}"`}>
                <span class="startnr">${i + 1}</span>
                ${wagenChipHtml(t2.farbe)}
                <span class="wer" style="flex:1;min-width:0">
                  <b>${escapeHtml(t2.name)}</b> ${marke}
                  <span class="meta" style="display:block">${escapeHtml(t2.team)} · ${escapeHtml(t2.fahrer)} · ${letztes}</span>
                </span>
                ${eigen ? `<span class="quotepill selbstpill">${t("startet")}</span>`
                        : `<span class="quotepill${gewaehlt ? " an" : ""}">${r.quoten[t2.autoId] ? r.quoten[t2.autoId].toFixed(2) : "—"}</span>`}
              </div>`;
            }).join("") || `<p class="note">${t("Noch kein Wagen gemeldet — Rennställe melden im Motorsport-Panel.")}</p>`}
          </div>
          <div class="rennbox">
            ${wettbar.length ? `
            <div class="lbl">${t("Wettschein")}</div>
            <div class="wettschein">
              <div class="wettwahl">
                ${gewaehlter ? `${wagenChipHtml(gewaehlter.farbe)}<span><b>${escapeHtml(gewaehlter.name)}</b>
                    <span class="meta" style="display:block">${escapeHtml(gewaehlter.team)} · ${escapeHtml(gewaehlter.fahrer)}</span></span>`
                  : `<span class="note">${t("Wagen links in der Liste anklicken")}</span>`}
              </div>
              <div class="artwahl">
                ${[["sieg", "Sieg"], ["podium", "Podium"], ["ausfall", "Ausfall"]].map(([k2, l2]) =>
                  `<button type="button" data-wettart="${k2}" class="${artWahl === k2 ? "an" : ""}">${t(l2)}</button>`).join("")}
              </div>
              <div class="rennform" style="margin-top:8px">
                <input id="wettBetrag" type="number" min="100" max="20000" placeholder="${t("Einsatz $")}">
                ${[500, 1000, 5000].map(b2 => `<button type="button" class="schnell" data-einsatz="${b2}">${b2 >= 1000 ? (b2 / 1000) + "k" : b2}</button>`).join("")}
              </div>
              <p class="note" id="wettVorschau" style="margin:7px 0"></p>
              <button id="wettSenden" class="wettknopf">${t("Wette platzieren")}</button>
              <p class="note" style="margin-top:7px"><b>Sieg</b>: Quote live · <b>Podium</b>: zahlt für Top 3 ·
                <b>Ausfall</b>: zahlt bei Defekt. Je Markt ein Totalisator-Pool (−10 % in den Preistopf);
                ohne Gewinner gibt es den Einsatz zurück.</p>
            </div>` : `<div class="lbl">${t("Wettschein")}</div><p class="note">${t("Keine fremden Wagen zum Wetten gemeldet.")}</p>`}
            <div class="lbl" style="margin-top:14px">${t("Sponsorgesuche")}</div>
            ${(() => {
              const alle = r.gesuche || [];
              const offen = alle.filter(g => g.teamId !== myId);
              const meins = alle.find(g => g.teamId === myId);
              const binGemeldet = r.teilnehmer.some(t2 => t2.ownerId === myId);
              const zeile = g => {
                const geld = g.art === "geld";
                const braucht = geld ? fmt(g.betrag) : `${g.menge}× ${gname(g.art)}`;
                const habe = geld ? me.cash : (me.inv?.[g.art] || 0);
                const reicht = habe >= (geld ? g.betrag : g.menge);
                return `<div class="gesuch${reicht ? " kann" : ""}">
                  <span class="was"><b>${escapeHtml(g.team)}</b> sucht <span class="bedarf">${braucht}</span>
                    <br><span class="meta">${geld ? `du hast ${fmt(me.cash)}` : `du hast ${habe}×`} · Gegenwert ${fmt(g.wert)}</span></span>
                  <button data-gesuch="${g.id}" ${reicht ? "" : "disabled"}>${reicht ? t("Erfüllen") : t("zu wenig")}</button>
                </div>`;
              };
              const eigenes = !binGemeldet ? "" : `
                <div class="gesuch eigenesGesuch">
                  <span class="was"><b>${t("Dein Gesuch")}</b>
                    <br><span class="meta">${meins
                      ? (meins.art === "geld" ? `Du suchst ${fmt(meins.betrag)}` : `Du suchst ${meins.menge}× ${gname(meins.art)}`)
                      : t("Noch keins aufgegeben")}</span></span>
                </div>
                <div class="rennform">
                  <select id="gesuchArt">
                    <option value="geld">Geld</option>
                    <option value="rennsoftware">Rennsoftware</option>
                    <option value="rennreifen">Rennreifen</option>
                  </select>
                  <input id="gesuchMenge" type="number" min="1" placeholder="Menge">
                  <button id="gesuchSenden">${t("Sponsoren suchen")}</button>
                </div>
                <p class="note" style="margin:4px 0 10px">Bei Geld der Betrag (1.000–20.000 $), bei Teilen die Stückzahl (1–10). Ein neues Gesuch ersetzt dein altes.</p>`;
              const fremd = offen.length
                ? offen.map(zeile).join("") + `<p class="note" style="margin-top:6px">Dafür bekommst du bis zu 50 % des Preisgeldes dieses Teams (pro rata mit anderen Sponsoren). Teile werden zum Ø-Kurs bewertet.</p>`
                : `<p class="note">${t("Zurzeit sucht kein anderes Team einen Sponsor.")}</p>`;
              return eigenes + fremd;
            })()}
            ${r.sponsoren.length ? `<div class="lbl" style="margin-top:12px">${t("Sponsoren an Bord")}</div>` +
              r.sponsoren.map(s => `<div class="gesuch" style="padding:6px 10px"><span class="was">${escapeHtml(s.name)} → <b>${escapeHtml(rohText(s.team || "?"))}</b>${
                s.was ? `<br><span class="meta">${escapeHtml(s.was)}</span>` : ""}</span><span class="quotepill">${fmt(s.betrag)}</span></div>`).join("") : ""}
          </div>
        </div>
`;
      /* Wagen wählen: Markierung + Wettschein-Kopf ohne kompletten Neuaufbau
       * nachziehen, sonst ginge die Eingabe im Einsatzfeld verloren. */
      body.querySelectorAll(".startzeile.wettbar").forEach(el => el.addEventListener("click", () => {
        rennenRendern.wahl = Number(el.dataset.auto);
        rennenRendern.sig = "";           // beim nächsten Zustands-Push neu aufbauen
        body.querySelectorAll(".startzeile.wettbar").forEach(o => {
          o.classList.toggle("gewaehlt", o === el);
          o.querySelector(".quotepill")?.classList.toggle("an", o === el);
        });
        aktualisiereVorschau();
      }));
      const aktualisiereVorschau = () => {
        const v = document.getElementById("wettVorschau");
        if (!v) return;
        const art2 = rennenRendern.wettArt || "sieg";
        const einsatz = +document.getElementById("wettBetrag")?.value || 0;
        const q2 = rennenRendern.wahl != null ? r.quoten[rennenRendern.wahl] : null;
        if (art2 === "sieg" && q2 && einsatz) v.innerHTML = `Mögliche Auszahlung: <b>${fmt(Math.round(einsatz * q2))}</b> (Quote ${q2.toFixed(2)}, ändert sich bis zum Start)`;
        else if (art2 === "sieg") v.textContent = "Quote erscheint, sobald jemand auf diesen Wagen setzt.";
        else v.textContent = "Die Quote dieses Markts steht erst mit der Zielflagge fest.";
      };
      body.querySelectorAll("[data-wettart]").forEach(b => b.addEventListener("click", () => {
        rennenRendern.wettArt = b.dataset.wettart;
        body.querySelectorAll("[data-wettart]").forEach(o => o.classList.toggle("an", o === b));
        aktualisiereVorschau();
      }));
      body.querySelectorAll("[data-einsatz]").forEach(b => b.addEventListener("click", () => {
        const feld = document.getElementById("wettBetrag");
        if (feld) { feld.value = b.dataset.einsatz; aktualisiereVorschau(); }
      }));
      document.getElementById("wettBetrag")?.addEventListener("input", aktualisiereVorschau);
      aktualisiereVorschau();
      document.getElementById("wettSenden")?.addEventListener("click", () => {
        if (rennenRendern.wahl == null) return toast("Erst einen Wagen in der Liste anklicken.", true);
        const name = r.teilnehmer.find(t2 => t2.autoId === rennenRendern.wahl)?.name || "Wagen";
        socket.emit("wetteSetzen", { autoId: rennenRendern.wahl, betrag: +document.getElementById("wettBetrag").value,
            art: rennenRendern.wettArt || "sieg" },
          res => toast(res?.error || `Wette steht: ${fmt(+document.getElementById("wettBetrag")?.value || 0)} auf ${name}`, !!res?.error));
      });
      document.getElementById("gesuchSenden")?.addEventListener("click", () => {
        socket.emit("gesuchAufgeben", { art: document.getElementById("gesuchArt").value,
                                        menge: +document.getElementById("gesuchMenge").value },
          res => toast(res?.error || "Sponsorgesuch steht.", !!res?.error));
      });
      body.querySelectorAll("[data-gesuch]").forEach(b => b.addEventListener("click", () => {
        socket.emit("gesuchErfuellen", { gesuchId: +b.dataset.gesuch },
          res => toast(res?.error || "Sponsorvertrag steht!", !!res?.error));
      }));
    }
    /* Der Countdown-Balken läuft auch ohne Neuaufbau jede Sekunde weiter. */
    const fuell = document.getElementById("phasenFuell");
    if (fuell) fuell.style.width = Math.round((1 - r.rest / 75) * 100) + "%";
  } else if (r.phase === "laeuft") {
    if (rennenRendern.sig !== "live") {
      rennenRendern.sig = "live";
      body.innerHTML = `
        <canvas id="rennStrecke" width="740" height="320"></canvas>
        <div id="boxBar" hidden>
          <button id="boxKnopf" type="button">${t("🔧 BOX! Boxenstopp jetzt")}</button>
          <span id="boxInfo" class="note"></span>
        </div>
        <div class="rennbox" id="rennFunkBox" style="margin-top:10px">
          <div class="lbl">${t("Boxenfunk")}</div>
          <div id="rennTicker"><p class="note">${t("…Funk knistert…")}</p></div>
        </div>
        <div class="rennbox" style="margin-top:10px">
          <div class="lbl">${t("Zwischenstand")}</div>
          <div id="rennStand"></div>
          <div class="rennstat">
            <span class="chip2">🏆 ${t("Preistopf")} <b>${fmt(r.topf)}</b></span>
            <span class="chip2">💰 ${t("Wettpool")} <b>${fmt(r.pool)}</b></span>
            <span class="chip2" style="margin-left:auto">${t("Auszahlung nach Zieldurchfahrt")}</span>
          </div>
        </div>`;
    }
    /* Box-Knopf: nur sichtbar, wenn der eigene Wagen fährt. Zustände:
     * bereit -> in der Box (Countdown) -> frische Technik. */
    const boxBar = document.getElementById("boxBar");
    if (boxBar) {
      const meinTeil = r.teilnehmer.find(t2 => t2.ownerId === myId && !t2.bot);
      if (!meinTeil || meinTeil.ausgefallen) boxBar.hidden = true;
      else {
        boxBar.hidden = false;
        const knopf = document.getElementById("boxKnopf"), info = document.getElementById("boxInfo");
        if (meinTeil.boxe) {
          knopf.disabled = true; knopf.textContent = t("🔧 In der Box …");
          info.textContent = t("Reifen, Technik, raus hier!");
        } else if (meinTeil.frisch) {
          knopf.disabled = true; knopf.textContent = t("✓ Frische Technik");
          info.textContent = `Stopp erledigt — mehr Tempo-Substanz und weniger Ausfallrisiko (${meinTeil.stopps}/2).`;
        } else {
          const zu = r.rest <= 8;
          knopf.disabled = zu || meinTeil.stopps >= 2;
          knopf.textContent = t("🔧 BOX! Boxenstopp jetzt");
          info.textContent = zu ? t("Boxengasse zu — Schlussphase.") :
            t("Kostet ~5 s Stillstand, bringt Frische: mehr Tempo, weniger Ausfallrisiko.");
        }
      }
    }
    /* Boxenfunk aktualisieren — neueste Meldung oben, leicht verblassend. */
    if (r.ticker?.length) {
      document.getElementById("rennTicker").innerHTML = r.ticker.slice(0, 4).map((m, i) =>
        `<div class="funkzeile" style="opacity:${1 - i * .22}">${m.text}</div>`).join("");
    }
    for (const t2 of r.teilnehmer) {
      /* Dead-Reckoning-Daten: Aus zwei Server-Ständen die Geschwindigkeit
       * schätzen — die Grafik fährt damit gleichmäßig weiter, statt jede
       * Sekunde zu springen. */
      const anim = RENN_ANIM.get(t2.autoId) || { shown: t2.dist, ziel: t2.dist, speed: 0, seit: performance.now() };
      anim.speed = Math.max(0, t2.dist - anim.ziel);   // Distanz je Sekunde
      anim.ziel = t2.dist;
      anim.seit = performance.now();
      RENN_ANIM.set(t2.autoId, anim);
    }
    const stand = [...r.teilnehmer].sort((a2, b2) => (a2.ausgefallen - b2.ausgefallen) || (b2.dist - a2.dist));
    const spitze = stand[0]?.dist || 0;
    const wagenChip = (farbe, kaputt) => `<svg width="30" height="16" viewBox="0 0 30 16" style="${kaputt ? "filter:grayscale(.8)" : ""}">
      <rect x="3" y="2" width="4" height="4" rx="1.4" fill="#0c0f14"/><rect x="3" y="10" width="4" height="4" rx="1.4" fill="#0c0f14"/>
      <rect x="21" y="2" width="4" height="4" rx="1.4" fill="#0c0f14"/><rect x="21" y="10" width="4" height="4" rx="1.4" fill="#0c0f14"/>
      <path d="M2 8c0-3 2-5.5 7-5.5h12c4 0 7 2.5 7 5.5s-3 5.5-7 5.5H9C4 13.5 2 11 2 8Z" fill="${farbe}" stroke="rgba(0,0,0,.35)"/>
      <ellipse cx="14" cy="8" rx="4" ry="2.6" fill="#0e1420"/>
      <rect x="1" y="4.6" width="2.6" height="6.8" rx="1" fill="#12161d"/>
    </svg>`;
    document.getElementById("rennStand").innerHTML = stand.map((t2, i) => {
      const rueckstand = i === 0 ? "" : `+${spitze - t2.dist} m`;
      const rundeProz = Math.round((t2.dist % r.runde) / r.runde * 100);
      const meins2 = t2.ownerId === myId;
      return `
      <div class="rennstand${i === 0 && !t2.ausgefallen ? " fuehrt" : ""}${meins2 ? " meins" : ""}" style="${t2.ausgefallen ? "opacity:.45" : ""}">
        <span class="platzbadge p${i + 1}">${i + 1}</span>
        ${wagenChip(t2.farbe, t2.ausgefallen)}
        <span class="wer"><b>${escapeHtml(t2.name)}</b>${t2.ausgefallen ? " 💥" : t2.boxe ? " 🔧" : t2.frisch ? " ✓" : ""}${meins2 ? ` <span class="meta" style="color:var(--accent)">· dein Stall</span>` : ""}
          <span class="meta">${escapeHtml(t2.team)} · ${escapeHtml(t2.fahrer)}</span></span>
        <span class="fortschritt">
          <span class="zeile"><span>R${Math.floor(t2.dist / r.runde) + 1} · ${t2.dist} m</span><span>${t2.ausgefallen ? "DNF" : rueckstand}</span></span>
          <span class="balken"><i style="width:${rundeProz}%;background:${t2.ausgefallen ? "#5a616b" : t2.farbe}"></i></span>
        </span>
      </div>`;
    }).join("");
  } else if (r.phase === "ergebnis" && r.ergebnis) {
    if (rennenRendern.sig !== "ende") {
      rennenRendern.sig = "ende";
      const medaille = ["🥇", "🥈", "🥉"];
      const podium = r.ergebnis.slice(0, 3);
      const reihenfolge = podium.length >= 3 ? [1, 0, 2] : podium.map((_, i) => i);
      body.innerHTML = `
        <div class="rennpodium">${reihenfolge.map(i => { const e = podium[i]; if (!e) return "";
          /* Hoehe nach PLATZ, nicht nach Schleifenindex: reihenfolge ist
           * [1,0,2], damit der Sieger in der Mitte steht — mit dem Index als
           * Schluessel bekam bisher der Zweite den hoechsten Sockel. */
          const hoehe = { 1: 140, 2: 104, 3: 84 }[e.platz] || 84;
          /* Im Renntag zeigt das Podest gleich mit, was der Platz an
           * Meisterschaftspunkten wert war — sonst muesste man dafuer in den
           * Rennstall wechseln. */
          const wmp = state.mode === "renntag" ? [10, 6, 4, 3, 2, 1][e.platz - 1] : 0;
          return `<div class="stufe p${e.platz}">
            <div class="krone">${medaille[e.platz - 1] || ""}</div>
            <div class="wer2"><b>${escapeHtml(e.name)}</b><br><span class="meta">${escapeHtml(rohText(e.team))} · ${escapeHtml(e.fahrer)}</span>${
              wmp && !e.ausgefallen ? `<br><span class="wmdelta">+${wmp} Punkte</span>` : ""}</div>
            <div class="sockel" style="height:${hoehe}px;--liv:${e.farbe}"><span class="nr">${e.platz}</span></div>
          </div>`; }).join("")}</div>
        <div class="rennbox">
          <div class="lbl">Endstand · Preistopf ${fmt(r.topf)}</div>
          ${r.ergebnis.map(e => `<div class="rennstand" style="${e.ausgefallen ? "opacity:.5" : ""}">
            <b style="width:20px">${e.platz}.</b>
            <span class="rennfarb" style="background:${e.farbe}"></span>
            <span>${e.name} · <span class="meta">${e.team} / ${e.fahrer}</span>${e.ausgefallen ? " 💥 ausgefallen" : ""}</span>
            <span class="dist">${e.dist} m</span>
          </div>`).join("")}
          <p class="note" style="margin:8px 0 0">Preisgelder, Sponsoranteile und Wettgewinne sind ausgezahlt — Details im Finanzlog.</p>
        </div>` + (state.wm && state.saison ? (() => {
          /* Nach dem Rennen gleich die Tabelle: Im Renntag entscheidet sie die
           * Runde, und ohne sie muesste man dafuer in den Rennstall wechseln. */
          const rang = Object.entries(state.wm).sort((a2, b2) => b2[1] - a2[1]);
          const rest = state.saison.gesamt - state.saison.gefahren;
          return `<div class="rennbox" style="margin-top:10px">
            <div class="lbl">Meisterschaft · Renntag ${state.saison.gefahren} von ${state.saison.gesamt}${
              rest > 0 ? ` · noch ${rest}` : " · Finale"}</div>
            ${rang.length ? rang.map(([pid, pkt], i) => `<div class="rennstand"${
                pid === myId ? ' style="box-shadow:inset 3px 0 0 var(--accent)"' : ""}>
                <b style="width:20px">${i + 1}.</b>
                <span class="rennfarb" style="background:${state.players[pid]?.color || "#7ad"}"></span>
                <span>${escapeHtml(state.players[pid]?.name || "—")}${pid === myId ? ` <span class="meta" style="color:var(--accent)">· du</span>` : ""}</span>
                <span class="dist"><b style="color:#fbbf24">${pkt}</b> Punkte</span>
              </div>`).join("")
              : `<p class="note">Noch keine Punkte vergeben.</p>`}
          </div>`;
        })() : "");
    }
  }
}
/* Streckengrafik: Oval mit Start-Ziel-Linie; läuft im Haupt-rAF-Loop und
 * interpoliert die Distanzen zwischen zwei Server-Updates. */
/* Draufsicht-Rennwagen: Karosserie mit Nase, Cockpit, vier Rädern und
 * Heckflügel — gezeichnet in Fahrtrichtung (+y = vorwärts vor der Rotation). */
function rennwagenZeichnen(g, farbe, kaputt) {
  if (kaputt) g.globalAlpha = .35;
  /* Schatten */
  g.fillStyle = "rgba(0,0,0,.45)";
  g.beginPath(); g.ellipse(1.5, 2, 8, 14, 0, 0, Math.PI * 2); g.fill();
  /* Räder */
  g.fillStyle = "#0c0f14";
  for (const [wx2, wy2] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
    g.beginPath(); g.roundRect(wx2 - 2.2, wy2 - 3.6, 4.4, 7.2, 1.6); g.fill();
  }
  /* Karosserie: vorn spitz zulaufend */
  g.beginPath();
  g.moveTo(0, -14);
  g.bezierCurveTo(5.5, -13, 6.5, -6, 6.5, 0);
  g.bezierCurveTo(6.5, 7, 5.5, 11, 4, 12);
  g.lineTo(-4, 12);
  g.bezierCurveTo(-5.5, 11, -6.5, 7, -6.5, 0);
  g.bezierCurveTo(-6.5, -6, -5.5, -13, 0, -14);
  g.closePath();
  g.fillStyle = farbe; g.fill();
  g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 1; g.stroke();
  /* Lichtkante auf der Haube */
  const glanz = g.createLinearGradient(-6, 0, 6, 0);
  glanz.addColorStop(0, "rgba(255,255,255,.28)"); glanz.addColorStop(.5, "rgba(255,255,255,0)"); glanz.addColorStop(1, "rgba(0,0,0,.18)");
  g.fillStyle = glanz; g.fill();
  /* Cockpit */
  g.fillStyle = "#0e1420";
  g.beginPath(); g.ellipse(0, 1, 3.4, 5.2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(140,190,240,.35)";
  g.beginPath(); g.ellipse(0, -.8, 2.6, 2.6, 0, 0, Math.PI * 2); g.fill();
  /* Heckflügel */
  g.fillStyle = "#12161d";
  g.beginPath(); g.roundRect(-7.5, 11, 15, 3, 1.4); g.fill();
  g.globalAlpha = 1;
}
/* ---- Der Kurs ----
 * Kein Oval mehr, sondern ein richtiger Grand-Prix-Kurs: eine geschlossene
 * Catmull-Rom-Kurve durch handgesetzte Kontrollpunkte — lange Zielgerade,
 * weite Bögen, eine Haarnadel und eine Schikane. Die Kurve wird einmal fein
 * abgetastet (Position, Tangente, Krümmung, Bogenlänge); Wagen fahren exakt
 * auf der Kurve, Randsteine liegen nur in den Kurven. */
const RENN_KURS_PUNKTE = [
  [150, 262], [86, 232], [58, 170], [82, 104], [160, 64], [252, 76], [312, 118],
  [368, 96], [420, 56], [500, 44], [576, 62], [640, 108], [676, 168],
  [652, 224], [584, 250], [520, 226], [462, 246], [400, 226], [330, 252], [240, 268],
];
let KURS = null, KURS_BG = null;
function kursBauen() {
  const P = RENN_KURS_PUNKTE, n = P.length, pts = [];
  const cm = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let i = 0; i < n; i++) for (let s2 = 0; s2 < 26; s2++) {
    const t = s2 / 26;
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    pts.push({ x: cm(p0[0], p1[0], p2[0], p3[0], t), y: cm(p0[1], p1[1], p2[1], p3[1], t) });
  }
  let laenge = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    a.len = laenge; a.seg = Math.hypot(b.x - a.x, b.y - a.y); laenge += a.seg;
  }
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const dx = next.x - prev.x, dy = next.y - prev.y, l = Math.hypot(dx, dy) || 1;
    pts[i].tx = dx / l; pts[i].ty = dy / l;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 7 + pts.length) % pts.length], b = pts[(i + 7) % pts.length];
    let dw = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
    while (dw > Math.PI) dw -= 2 * Math.PI;
    while (dw < -Math.PI) dw += 2 * Math.PI;
    pts[i].kruemmung = Math.abs(dw);
  }
  KURS = { pts, laenge };
}
function kursPunkt(d) {
  const pts = KURS.pts;
  d = ((d % KURS.laenge) + KURS.laenge) % KURS.laenge;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid].len <= d) lo = mid; else hi = mid - 1; }
  const a = pts[lo], b = pts[(lo + 1) % pts.length], f = a.seg ? (d - a.len) / a.seg : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: a.tx, ty: a.ty };
}
/* Die Kulisse ändert sich nie — einmal in einen Offscreen-Puffer rendern
 * (Rasen, Kies, Randsteine, Bahn, Tribünen, Bäume, Startportal) und danach
 * pro Frame nur noch kopieren. */
function kursKulisseBauen(dpr) {
  if (!KURS) kursBauen();
  const c = document.createElement("canvas");
  c.width = 740 * dpr; c.height = 320 * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const pts = KURS.pts;
  const pfad = () => { g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) g.lineTo(p.x, p.y); g.closePath(); };
  /* Rasen mit Flecken */
  const gras = g.createRadialGradient(370, 160, 40, 370, 160, 460);
  gras.addColorStop(0, "#17371f"); gras.addColorStop(1, "#0b2012");
  g.fillStyle = gras; g.fillRect(0, 0, 740, 320);
  for (let i = 0; i < 90; i++) {
    const fx = (i * 137.5) % 740, fy = (i * 89.7) % 320;
    g.fillStyle = i % 2 ? "rgba(255,255,255,.02)" : "rgba(0,0,0,.05)";
    g.beginPath(); g.arc(fx, fy, 9 + (i % 4) * 5, 0, Math.PI * 2); g.fill();
  }
  /* Kiesbetten: nur außen an den wirklich scharfen Ecken, dezent */
  for (let i = 0; i < pts.length; i += 5) {
    const p = pts[i];
    if (p.kruemmung < .5) continue;
    g.fillStyle = "rgba(96,86,58,.8)";
    g.beginPath(); g.arc(p.x - p.ty * 24, p.y + p.tx * 24, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,.05)";
    g.beginPath(); g.arc(p.x - p.ty * 24 - 2, p.y + p.tx * 24 - 2, 8, 0, Math.PI * 2); g.fill();
  }
  /* Bahnschulter + Asphalt */
  g.lineJoin = "round"; g.lineCap = "round";
  pfad(); g.strokeStyle = "#3a4048"; g.lineWidth = 40; g.stroke();
  pfad(); g.strokeStyle = "#23272e"; g.lineWidth = 34; g.stroke();
  /* Fahrbahn-Textur: hauchfeine dunkle Fahrspur und heller Schleier */
  pfad(); g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 12; g.stroke();
  pfad(); g.strokeStyle = "rgba(255,255,255,.03)"; g.lineWidth = 26; g.stroke();
  /* Randsteine: rot-weiße Ticks quer zur Bahn, nur wo die Kurve eng ist */
  for (let i = 0; i < pts.length; i += 3) {
    const p = pts[i];
    if (p.kruemmung < .27) continue;
    g.strokeStyle = (i / 3) % 2 ? "#d43a31" : "#e9edf4";
    g.lineWidth = 4.6;
    for (const seite of [1, -1]) {
      const ax = p.x - p.ty * seite * 15.5, ay = p.y + p.tx * seite * 15.5;
      g.beginPath();
      g.moveTo(ax - p.tx * 3.4, ay - p.ty * 3.4);
      g.lineTo(ax + p.tx * 3.4, ay + p.ty * 3.4);
      g.stroke();
    }
  }
  /* weiße Begrenzungslinien */
  for (const seite of [1, -1]) {
    g.beginPath();
    for (let i = 0; i <= pts.length; i++) {
      const p = pts[i % pts.length];
      const x2 = p.x - p.ty * seite * 15.5, y2 = p.y + p.tx * seite * 15.5;
      i ? g.lineTo(x2, y2) : g.moveTo(x2, y2);
    }
    g.strokeStyle = "rgba(235,240,248,.4)"; g.lineWidth = 1.2; g.stroke();
  }
  /* Start-Ziel: Zielflaggen-Band und Portal quer über die Bahn */
  const s0 = kursPunkt(0);
  g.save();
  g.translate(s0.x, s0.y); g.rotate(Math.atan2(s0.ty, s0.tx));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
    g.fillStyle = (i + j) % 2 ? "#e9edf4" : "#14171d";
    g.fillRect(-7 + i * 5, -15 + j * 5, 5, 5);
  }
  /* Portal: zwei Pfeiler + Balken mit Schriftzug */
  g.fillStyle = "#1b2330";
  g.fillRect(-3, -26, 6, 9); g.fillRect(-3, 17, 6, 9);
  g.fillStyle = "rgba(20,28,42,.92)"; g.fillRect(-11, -24, 8, 48);
  g.fillStyle = "#fbbf24"; g.font = "800 5.5px sans-serif"; g.textAlign = "center";
  g.save(); g.translate(-7, 0); g.rotate(-Math.PI / 2); g.fillText("START · FINISH", 0, 2); g.restore();
  g.restore();
  /* Tribünen mit Publikum */
  const tribuene = (tx2, ty2, w2, drehung) => {
    g.save(); g.translate(tx2, ty2); g.rotate(drehung);
    g.fillStyle = "#1a2434"; g.fillRect(-w2 / 2, 0, w2, 18);
    g.fillStyle = "#26344a"; g.fillRect(-w2 / 2, 0, w2, 4);
    const farben = ["#e0b17c", "#c9d4e4", "#e78d8d", "#9ad0a8", "#b7a3e0"];
    for (let rj = 0; rj < 3; rj++) for (let ci = 0; ci < Math.floor(w2 / 5); ci++) {
      g.fillStyle = farben[(rj * 7 + ci * 3) % farben.length];
      g.globalAlpha = .8;
      g.beginPath(); g.arc(-w2 / 2 + 3 + ci * 5, 7 + rj * 4.4, 1.5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  };
  /* Positionen mit Abstand zur Bahn: unten an der Boxengasse, oben in der
   * Lücke zwischen den beiden Bögen. */
  tribuene(200, 296, 170, 0);
  tribuene(448, 2, 110, 0);
  /* Bäume rund um den Platz — nie auf der Bahn */
  for (let i = 0; i < 26; i++) {
    const bx = (i * 251.3) % 740, by = (i * 157.9) % 320;
    let frei = true;
    for (let k2 = 0; k2 < pts.length; k2 += 10) {
      if (Math.hypot(pts[k2].x - bx, pts[k2].y - by) < 34) { frei = false; break; }
    }
    if (!frei) continue;
    g.fillStyle = "rgba(0,0,0,.3)";
    g.beginPath(); g.ellipse(bx + 2, by + 3, 6, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = i % 3 ? "#1d4a28" : "#25562f";
    g.beginPath(); g.arc(bx, by, 5 + (i % 3) * 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,.10)";
    g.beginPath(); g.arc(bx - 2, by - 2, 2.5, 0, Math.PI * 2); g.fill();
  }
  return c;
}
function rennStreckeZeichnen() {
  const cvR = document.getElementById("rennStrecke");
  if (!cvR || document.getElementById("rennOverlay").hidden) return;
  const st = store.get()?.state, r = st?.rennen;
  if (!r || r.phase !== "laeuft") return;
  /* Scharf auf Retina: intern in Geräteauflösung zeichnen, per CSS skalieren. */
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (+cvR.dataset.dpr !== dpr) {
    cvR.dataset.dpr = dpr;
    cvR.width = 740 * dpr; cvR.height = 320 * dpr;
    cvR.style.width = "100%"; cvR.style.aspectRatio = "740/320";
    KURS_BG = null;
  }
  if (!KURS) kursBauen();
  if (!KURS_BG) KURS_BG = kursKulisseBauen(dpr);
  const g = cvR.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const jetzt = performance.now();
  g.drawImage(KURS_BG, 0, 0, 740, 320);
  /* Mittellinie wandert mit — verkauft Tempo auch ohne Bezugspunkt */
  g.beginPath();
  g.moveTo(KURS.pts[0].x, KURS.pts[0].y);
  for (const p of KURS.pts) g.lineTo(p.x, p.y);
  g.closePath();
  g.setLineDash([8, 14]); g.lineDashOffset = -(jetzt / 40) % 22;
  g.strokeStyle = "rgba(255,255,255,.28)"; g.lineWidth = 1.6; g.stroke();
  g.setLineDash([]); g.lineDashOffset = 0;
  /* Wagen: Dead Reckoning — mit der geschätzten Geschwindigkeit weiterfahren
   * und sanft auf den echten Serverstand einschwenken. */
  const teil = r.teilnehmer;
  teil.forEach((t2, i) => {
    const anim = RENN_ANIM.get(t2.autoId) || { shown: t2.dist, ziel: t2.dist, speed: 0, seit: jetzt };
    const zielJetzt = t2.ausgefallen ? anim.ziel : anim.ziel + anim.speed * Math.min(1.2, (jetzt - anim.seit) / 1000);
    anim.shown += (zielJetzt - anim.shown) * .12;
    RENN_ANIM.set(t2.autoId, anim);
    /* Meter der Runde auf die Kursbogenlänge abbilden */
    const u = ((anim.shown % r.runde) + r.runde) % r.runde / r.runde;
    const kp = kursPunkt(u * KURS.laenge);
    /* Spurversatz quer zur Fahrtrichtung — eng genug für die Bahnbreite */
    const abstand = Math.min(11, 26 / Math.max(1, teil.length - 1));
    const spur = (i - (teil.length - 1) / 2) * abstand;
    const px2 = kp.x - kp.ty * spur;
    const py2 = kp.y + kp.tx * spur;
    const heading = Math.atan2(kp.ty, kp.tx);
    g.save();
    g.translate(px2, py2);
    g.rotate(heading + Math.PI / 2);
    g.scale(.82, .82);   /* Wagen etwas kleiner — die Bahn ist schmaler als das alte Oval */
    rennwagenZeichnen(g, t2.farbe, t2.ausgefallen);
    g.restore();
    /* Rauch beim Ausfall */
    if (t2.ausgefallen) {
      g.fillStyle = "rgba(160,165,175,.35)";
      for (let s2 = 0; s2 < 3; s2++) {
        const k2 = ((jetzt / 900 + s2 / 3) % 1);
        g.globalAlpha = (1 - k2) * .35;
        g.beginPath(); g.arc(px2 + s2 * 2 - 2, py2 - 8 - k2 * 14, 3 + k2 * 5, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    /* Boxenstopp: Schraubenschlüssel über dem stehenden Wagen */
    if (t2.boxe) {
      g.font = "12px sans-serif"; g.textAlign = "center";
      g.fillText("🔧", px2, py2 - 24);
    }
    g.font = "700 10px sans-serif"; g.textAlign = "center";
    g.fillStyle = "rgba(10,14,20,.65)";
    const label = "#" + (t2.name.match(/#(\d+)/)?.[1] || i + 1);
    g.fillText(label, px2 + 1, py2 - 17);
    g.fillStyle = "rgba(235,242,252,.95)";
    g.fillText(label, px2, py2 - 18);
  });
  /* Rundenanzeige des Führenden */
  const erster = [...teil].sort((a2, b2) => b2.dist - a2.dist)[0];
  if (erster) {
    g.font = "700 13px sans-serif"; g.textAlign = "left"; g.fillStyle = "#fbbf24";
    g.fillText(`Runde ${Math.floor(erster.dist / r.runde) + 1}`, 14, 22);
  }
}
document.getElementById("rennOverlay").addEventListener("click", e => {
  if (e.target.id !== "boxKnopf") return;
  socket.emit("boxenstopp", {}, res => { if (res?.error) toast(res.error, true); else rennTon(300, .25, "square", .09); });
});
document.getElementById("rennMini").addEventListener("click", () => { rennMinimiert = true; render(store.get()); });
document.getElementById("rennChip").addEventListener("click", () => { rennMinimiert = false; rennenRendern.sig = ""; render(store.get()); });

/* ---------- Planbüro (Planwirtschafts-Modus) ---------- */
function planRendern(state, myId) {
  const knopf = document.getElementById("dockPlan");
  if (knopf) knopf.style.display = state.mode === "plan" ? "" : "none";
  /* Die freie Börse, der Kapitalmarkt (Finanzen), die privaten Verträge und
   * die Starter-Aufgaben sind Marktinstrumente — in der Planwirtschaft weg. */
  const planAktiv = state.mode === "plan";
  const boerseKnopf = document.querySelector('.dockbtn[data-p="boerse"]');
  if (boerseKnopf) boerseKnopf.style.display = planAktiv || state.stadt ? "none" : "";   // Sandkasten: Börse im Stadtnetz
  const bondsKnopf = document.querySelector('.dockbtn[data-p="bonds"]');
  if (bondsKnopf) bondsKnopf.style.display = planAktiv || state.stadt ? "none" : "";   // Sandkasten: Anleihen im Stadtnetz
  const ctrbar = document.getElementById("ctrbar");
  if (ctrbar) ctrbar.style.display = planAktiv ? "none" : "";
  if (planAktiv) document.getElementById("quests").style.display = "none";
  const nw = document.getElementById("networth");
  if (state.mode !== "plan" || !state.plan) {
    if (nw) nw.style.display = "";
    document.getElementById("planHud")?.remove();
    return;
  }
  const plan = state.plan;
  /* HUD: statt Nettovermögen zählt hier die Planerfüllung — eigenes Element
   * daneben, damit die Kinder der Vermögensanzeige (nwv/goalv) intakt bleiben. */
  if (nw) {
    nw.style.display = "none";
    let hud = document.getElementById("planHud");
    if (!hud) { hud = document.createElement("span"); hud.id = "planHud"; nw.after(hud); }
    hud.innerHTML = `Planpunkte <b>${plan.spieler?.[myId]?.punkte ?? 0}</b> / 1.000`;
  }
  const min = Math.floor((plan.rest || 0) / 60), sek = (plan.rest || 0) % 60;
  const volk = plan.volk;
  const volkProz = volk ? Math.min(100, volk.geliefert / volk.menge * 100) : 0;
  document.getElementById("planPhase").innerHTML =
    `Phase <b>${plan.phase}/5</b> · Restzeit <b>${min}:${String(sek).padStart(2, "0")}</b> min` +
    (plan.stromsperre ? `<div style="margin-top:6px;padding:6px 9px;border:1px solid rgba(251,113,133,.5);border-radius:8px;color:#fb7185;font-weight:600">⚡ STROMABSCHALTUNG — Volksziel verfehlt, alle Betriebe laufen diese Phase mit halber Kraft.</div>` : "") +
    (volk ? `<div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between"><span>Volkswirtschaftsziel: <b>${gname(volk.good)}</b></span>
        <span class="meta">${Math.round(volk.geliefert)}/${volk.menge}</span></div>
      <div style="height:6px;background:#0b1220;border-radius:4px;overflow:hidden;margin-top:4px">
        <div style="width:${volkProz}%;height:100%;background:${volkProz >= 100 ? "#34d399" : "#fbbf24"}"></div></div>
      <div class="note" style="margin-top:3px">Gemeinsames Soll aller Betriebe — geschafft: +25 Punkte für alle; verfehlt: Stromabschaltung. ${gname(volk.good)} kann jeder abliefern, auch ohne eigenes Soll (halber Punktesatz).</div>
    </div>` : "") +
    `<div class="note" style="margin-top:6px">Liefere dein Soll ans Planbüro — fester Ankaufspreis, Punkte je Warenwert. 1.000 Punkte oder die beste Bilanz nach 5 Phasen gewinnen.</div>`;
  const meins = plan.spieler?.[myId];
  const lager = store.get()?.me?.inv || {};
  document.getElementById("planSoll").innerHTML = meins?.soll?.length ? meins.soll.map(z => {
    const voll = z.geliefert >= z.menge;
    const proz = Math.min(100, z.geliefert / z.menge * 100);
    return `<div style="display:flex;align-items:center;gap:10px;margin:7px 0">
      <span style="flex:1">${gname(z.good)}</span>
      <span class="meta">${Math.round(z.geliefert)}/${z.menge} · Lager ${Math.floor(lager[z.good] || 0)}</span>
      <div style="width:90px;height:6px;background:#0b1220;border-radius:4px;overflow:hidden">
        <div style="width:${proz}%;height:100%;background:${voll ? "#34d399" : "#38bdf8"}"></div></div>
      <button class="buyb" data-plandeliver="${z.good}" ${voll || !(lager[z.good] > 0) ? "disabled" : ""}>Abliefern</button>
    </div>`;
  }).join("") : `<p class="note">Kein Soll — die nächste Planphase teilt dir eines zu.</p>`;
  /* Volksziel-Ware ohne eigenes Soll: eigene Abliefer-Zeile anbieten. */
  if (volk && !(meins?.soll || []).some(z => z.good === volk.good)) {
    document.getElementById("planSoll").innerHTML +=
      `<div style="display:flex;align-items:center;gap:10px;margin:7px 0;border-top:1px dashed var(--line);padding-top:7px">
        <span style="flex:1">${gname(volk.good)} <span class="meta">(Volksziel, halber Punktesatz)</span></span>
        <span class="meta">Lager ${Math.floor(lager[volk.good] || 0)}</span>
        <button class="buyb" data-plandeliver="${volk.good}" ${!(lager[volk.good] > 0) ? "disabled" : ""}>Abliefern</button>
      </div>`;
  }
  /* Materialzuteilung: Budget & Priorität anzeigen, Warenlisten einmal füllen */
  const warenOpts = () => Object.keys(GOODS()).map(k => `<option value="${k}">${gname(k)}</option>`).join("");
  for (const sid of ["planGood", "smGebeGood", "smWillGood"]) {
    const sel = document.getElementById(sid);
    if (sel && !sel.options.length) sel.innerHTML = warenOpts();
  }
  if (meins) {
    document.getElementById("planBudget").textContent = fmt(meins.budget ?? 0);
    const prio = meins.prio ?? 1;
    document.getElementById("planPrio").textContent =
      prio >= 1.2 ? "hoch" : prio >= .9 ? "normal" : "niedrig";
    document.getElementById("planAkte").innerHTML = (meins.akte || 0) > 0
      ? `Deine Kaderakte: <b style="color:#fb7185">${meins.akte}/3 Einträge</b>.` : "Deine Kaderakte ist sauber.";
  }
  /* Schwarzmarkt-Angebote */
  document.getElementById("smAngebote").innerHTML = (plan.markt || []).map(o => {
    const von = state.players[o.von];
    const meins2 = o.von === myId;
    return `<div style="display:flex;align-items:center;gap:9px;margin:5px 0">
      <span style="width:10px;height:10px;border-radius:3px;background:${von?.color || "#666"}"></span>
      <span style="flex:1">${von?.name || "—"}: gibt <b>${o.gebeQty}× ${gname(o.gebeGood)}</b> für <b>${o.willQty}× ${gname(o.willGood)}</b></span>
      ${meins2
        ? `<button data-smcancel="${o.id}">Zurückziehen</button>`
        : `<button class="buyb" data-smaccept="${o.id}">Tauschen</button>`}
    </div>`;
  }).join("") || `<p class="note">Keine Angebote — unter der Hand ist gerade Ruhe.</p>`;
  const rang = Object.entries(plan.spieler || {})
    .map(([pid, ps]) => ({ name: state.players[pid]?.name || "—", farbe: state.players[pid]?.color || "#666", punkte: ps.punkte, akte: ps.akte || 0 }))
    .sort((a, b) => b.punkte - a.punkte);
  document.getElementById("planRang").innerHTML = rang.map((r, i) =>
    `<div style="display:flex;gap:9px;align-items:center;margin:5px 0">
      <span class="meta">${i + 1}.</span>
      <span style="width:10px;height:10px;border-radius:3px;background:${r.farbe}"></span>
      <span style="flex:1">${r.name}${i === 0 && r.punkte > 0 ? " ★" : ""}${r.akte ? ` <span class="meta" style="color:#fb7185">Akte ${r.akte}/3</span>` : ""}</span>
      <b>${r.punkte} P.</b></div>`).join("") || "—";
}
document.getElementById("p-plan").addEventListener("click", e => {
  const b = e.target.closest("button[data-plandeliver]");
  if (!b) return;
  act("planDeliver", { good: b.dataset.plandeliver });
});

/* ---------- Kartell (Kartellmodus) ----------
 * Ein Panel, drei Zustände — kein Kartell, Einladung offen, Mitglied. Getrennte
 * Panels dafür wären dreimal dieselbe Mitgliederliste; der Zustand wechselt hier
 * ohnehin höchstens zweimal pro Runde.
 *
 * Der Verdachtsbalken steht bewusst NUR hier drin und nicht in der Kopfzeile:
 * Er kommt aus dem privaten Zustand, und ein Mitspieler, der einem über die
 * Schulter schaut, soll ihn nicht nebenbei mitlesen. */
function kartellRendern(state, me, myId) {
  const knopf = document.getElementById("dockKartell");
  const aktiv = state.mode === "kartell";
  if (knopf) knopf.style.display = aktiv ? "" : "none";
  const boerseKnopf = document.getElementById("dockBoerse");
  if (boerseKnopf) boerseKnopf.style.display = aktiv ? "none" : "";
  if (aktiv) document.getElementById("p-boerse")?.classList.remove("open");
  /* HUD-Chip: Familie und Respekt neben dem Nettovermögen. */
  const alterHud = document.getElementById("mafiaHud");
  if (!aktiv) { alterHud?.remove(); return; }
  const hudFam = (state.familien || []).find(f => f.id === state.players[myId]?.familie);
  const nwEl = document.getElementById("networth");
  /* Im Kartellmodus zählt die Straße, nicht das Konto: Die Vermögensanzeige
   * weicht dem Familienstand — Respekt-Rang und Bezirke bis zum Stadtsieg.
   * Nur ausgeblendet, nie umgebaut (die Kinder nwv/goalv braucht render()). */
  /* Lobby: Familien-Buttons zeigen die Belegung (max 2) */
  if (state.mode === "kartell") {
    const zaehl = {};
    for (const sp of Object.values(state.players || {})) if (sp.familie) zaehl[sp.familie] = (zaehl[sp.familie] || 0) + 1;
    document.querySelectorAll("#lwFamilie button").forEach(b => {
      const fid = b.dataset.familie;
      const basis = b.textContent.replace(/\s*\d\/\d$/, "");
      b.textContent = `${basis} ${zaehl[fid] || 0}/2`;
      b.disabled = (zaehl[fid] || 0) >= 2 && state.players?.[myId]?.familie !== fid;
    });
  }
  const binPolizei = state.mode === "kartell" && state.players?.[myId]?.familie === "polizei";
  if (gcasinoOffen) gcasinoRender();
  if (GC_SPIEL) gcSpielTick();
  if (WZ_OFFEN) wzRender();
  if (FAM_OFFEN) famRender();
  pateWahlWidget();
  if (nwEl) nwEl.style.display = hudFam ? "none" : "";
  if (nwEl && binPolizei && state.polizei) {
    nwEl.style.display = "none";
    let hud = alterHud;
    if (!hud) { hud = document.createElement("span"); hud.id = "mafiaHud"; nwEl.after(hud); }
    hud.innerHTML = `<b style="color:${state.polizei.farbe}">🚔 Die Polizei</b>
      <span class="meta"> · Einsätze <b>${state.polizei.punkte}/${state.polizei.ziel}</b> · Sold 150 $/min</span>`;
  } else if (nwEl && hudFam) {
    let hud = alterHud;
    if (!hud) { hud = document.createElement("span"); hud.id = "mafiaHud"; nwEl.after(hud); }
    const sortiert = [...state.familien].sort((a, b) => b.respekt - a.respekt);
    const rang = sortiert.findIndex(f => f.id === hudFam.id) + 1;
    const bezirke = (state.bezirke || []).filter(b => b.kontrolle === hudFam.id).length;
    hud.innerHTML = `<b style="color:${hudFam.farbe}">${state.pate === hudFam.id ? "👑 " : ""}${hudFam.name}</b>
      <span class="meta"> · ${hudFam.respekt} Respekt · Rang ${rang}/4 · Bezirke <b style="color:${bezirke >= 4 ? "var(--accent2)" : "inherit"}">${bezirke}/6</b></span>`;
  } else alterHud?.remove();
  const k = me.kartell;
  const inhalt = document.getElementById("kartellInhalt");
  /* Nicht neu zeichnen, während jemand in einem Feld tippt — sonst wäre der
   * Kartellname nach dem ersten Buchstaben wieder weg (1×/s State-Push). */
  if (inhalt.contains(document.activeElement) &&
      /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  /* Spieler- und Kartellnamen kommen bereits vom Server entschärft (sicherText)
   * und werden hier deshalb unverändert eingesetzt. Kein rohText(): das dekodiert
   * die Entitäten wieder und machte aus der Absicherung ein Einfallstor. */

  /* --- Die vier Familien: Rangliste nach Respekt + Hehler für heiße Ware --- */
  const meineFamilieId = state.players[myId]?.familie;
  const meineFam = (state.familien || []).find(f => f.id === meineFamilieId);
  const illegale = Object.entries(GOODS()).filter(([, g]) => g.cat === "Illegal").map(([g2]) => g2);
  const hehlerZeilen = illegale
    .filter(g => Math.floor(me.inv?.[g] || 0) > 0)
    .map(g => `<div style="display:flex;gap:9px;align-items:center;margin:5px 0">
        <span style="flex:1">${gname(g)}</span>
        <span class="meta">${Math.floor(me.inv[g])} Stück · ${fmt(state.avg?.[g] || 0)}/Stk</span>
        <button class="buyb" data-hehler="${g}">Alles verkaufen</button>
      </div>`).join("");
  const bezirksZaehler = {};
  for (const b of state.bezirke || []) if (b.kontrolle) bezirksZaehler[b.kontrolle] = (bezirksZaehler[b.kontrolle] || 0) + 1;
  const familienHtml = !state.familien ? "" : `
    <div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Die vier Familien${state.pate ? ` · 👑 Pate: ${state.familien.find(f => f.id === state.pate)?.name}` : ""}</div>
      ${[...state.familien].sort((a, b) => b.respekt - a.respekt).map((f, i) => `
        <div style="display:flex;gap:9px;align-items:center;margin:6px 0">
          <span class="meta">${i + 1}.</span>
          <span style="width:10px;height:10px;border-radius:3px;background:${f.farbe};flex:none"></span>
          <span style="flex:1;${f.id === meineFamilieId ? "font-weight:600" : ""}">${f.name}${f.id === state.pate ? " 👑" : ""}${f.id === meineFamilieId ? ` <span class="meta" style="color:var(--accent)">· deine Familie</span>` : ""}
            <span class="meta" style="display:block">${f.mitglieder.join(", ") || "—"} · Ware: ${gname(f.produkt)} · Bezirke: ${bezirksZaehler[f.id] || 0}</span></span>
          <b>${f.respekt} R</b>
        </div>`).join("")}
      ${state.pate ? `<p class="note" style="margin:6px 0 0">Der Pate kassiert 10 % aller fremden Hehler-Erlöse als Abgabe.</p>` : ""}
      ${state.polizei ? `<div style="display:flex;gap:9px;align-items:center;margin:8px 0 0;padding-top:7px;border-top:1px solid var(--line)">
        <span style="width:10px;height:10px;border-radius:3px;background:${state.polizei.farbe};flex:none"></span>
        <span style="flex:1;${meineFamilieId === "polizei" ? "font-weight:600" : ""}">🚔 Die Polizei${meineFamilieId === "polizei" ? ` <span class="meta" style="color:var(--accent)">· deine Seite</span>` : ""}
          <span class="meta" style="display:block">${state.polizei.mitglieder.join(", ") || "—"} · räumt Bezirke per Razzia</span></span>
        <b>${state.polizei.punkte}/${state.polizei.ziel} 🚨</b>
      </div>` : ""}
    </div>
    <div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Fahndungsdruck · bei 100 kommt die Razzia</div>
      <p class="note" style="margin:0 0 8px">Überfälle, Sperren und heiße Geschäfte heizen die Fahndung an.
        Erreicht sie 100, beschlagnahmt die Polizei alle illegale Ware der Familie (−10 Respekt, 1.000 $ Strafe je Mitglied).
        Bestechung kühlt sie um 25 ab.</p>
      ${[...state.familien].sort((a, b) => b.fahndung - a.fahndung).map(f => `
        <div style="display:flex;gap:9px;align-items:center;margin:5px 0">
          <span style="width:10px;height:10px;border-radius:3px;background:${f.farbe};flex:none"></span>
          <span style="flex:1;font-size:11.5px;${f.id === meineFamilieId ? "font-weight:600" : ""}">${f.name}</span>
          <div style="flex:2;height:7px;background:#0b1322;border-radius:4px;overflow:hidden">
            <div style="width:${Math.min(100, f.fahndung || 0)}%;height:100%;background:${(f.fahndung || 0) >= 70 ? "#e74c3c" : (f.fahndung || 0) >= 40 ? "#f5a742" : "#4a90d9"}"></div>
          </div>
          <b style="width:26px;text-align:right;font-size:11.5px">${f.fahndung || 0}</b>
        </div>`).join("")}
      ${meineFam && (meineFam.fahndung || 0) > 0 ? `<button class="buyb" data-bestechen style="margin-top:6px">Beamte bestechen <small>2.000 $ · Fahndung −25</small></button>` : ""}
    </div>
    <div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Straße &amp; Überfall</div>
      <p class="note" style="margin:0">🚚 Auf den Hauptstraßen rollen <b>Werttransporte</b> (goldener Ring auf der Karte) —
        anklicken heißt überfallen: Erfolg bringt Bargeld, Pistolen oder Goldbarren plus 5 Respekt, Misserfolg 500 $ Kaution.
        Pistolen im Lager erhöhen die Chance (+6 % je Stück, max +30 %).<br><br>
        🚧 Klicke eine <b>Straße</b> an, um für 800 $ eine <b>Straßensperre</b> zu errichten (max 2 je Familie):
        Sie zählt 3 Minuten lang wie zwei Gebäude für die Bezirkskontrolle — und Transporte, die in sie hineinfahren,
        bleiben stehen (+25 % Überfall-Chance).<br><br>
        🎰 Baue ein <b>Illegales Casino</b> (6.000 $, Zentrum): Mitspieler zocken dort 17+4
        gegen deine Kasse — das Haus gewinnt den Gleichstand, jedes Spiel heizt aber die Fahndung an.
        Fremde Casinos einfach anklicken und mitspielen (Einsatz 50–2.000 $).</p>
    </div>
    ${state.bezirke ? `<div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Bezirke · Kontrolle bringt Schutzgeld</div>
      <p class="note" style="margin:0 0 8px">Wer in einem Bezirk die meisten Gebäude hat (mindestens zwei),
        kontrolliert ihn: ${200} $ Schutzgeld je Minute für die Familie plus Respekt. Die meisten Bezirke machen den Paten.
        <b>Wer 6 von 9 Bezirken hält, gewinnt die Runde — die Stadt gehört dann seiner Familie.</b><br><br>
        💰 <b>Schutzgelderpressung:</b> Zieh selbst durch die Läden eines Bezirks (alle 3 min je Bezirk):
        250–450 $ sofort, im <b>eigenen Revier das 1,5-fache</b> — aber jede Tour heizt die Fahndung an (+6).
        Im Revier einer fremden Familie riskierst du ihre Schläger: Rauswurf, −2 Respekt, +10 Fahndung.<br><br>
        ⚔️ <b>Revierkampf:</b> Geclaimte Bezirke nimmst du mit <b>Waffen</b>: mind. 3 Pistolen
        (Waffentransporte überfallen!), bis zu 6 werden eingesetzt. Gelingt der Sturm, beginnt ein
        <b>2-Minuten-Tauziehen</b> um das Viertel — der Kontroll-Balken zeigt, wer vorn liegt.
        Alles zählt: Gebäude bauen +2, Sperre +2, Erpressung +1, <b>🥊 Verstärkung schicken</b> ($300) +1.
        Wer bei Ablauf führt, gewinnt (Gleichstand: Verteidiger). Der Eroberer <b>plündert die Kassen des
        Viertels</b> und hält es <b>5 Minuten als Besatzung 🏴</b> — Zeit, sich die Gebäudemehrheit zu sichern.
        Misslungener Sturm: Waffen weg, 500 $ Kaution, Fahndung +12.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        ${state.bezirke.map(b => {
          const fam = b.kontrolle ? state.familien.find(f => f.id === b.kontrolle) : null;
          const eigene = (state.players[myId]?.familie && b.staerken?.[state.players[myId].familie]) || 0;
          const cd = me.erpress?.[b.id];
          const eigenesRevier = b.kontrolle && b.kontrolle === meineFamilieId;
          const fremdesRevier = b.kontrolle && b.kontrolle !== meineFamilieId;
          const pistolen = Math.floor(me.inv?.pistole || 0);
          const kampfBereit = fremdesRevier && !me.kampfCd && pistolen >= 3;
          const binPolizeiPanel = meineFamilieId === "polizei";
          const kampfHtml = b.kampf ? (() => {
            const gesamt = Math.max(1, b.kampf.pa + b.kampf.pv);
            const fA = state.familien.find(f => f.id === b.kampf.angreifer);
            const fV = state.familien.find(f => f.id === b.kampf.verteidiger);
            const dabei = meineFamilieId === b.kampf.angreifer || meineFamilieId === b.kampf.verteidiger;
            return `<div style="display:flex;height:9px;border-radius:5px;overflow:hidden;margin-top:5px;border:1px solid #0006">
                <div style="width:${b.kampf.pa / gesamt * 100}%;background:${fA?.farbe || "#e74c3c"}"></div>
                <div style="flex:1;background:${fV?.farbe || "#4a90d9"}"></div></div>
              <div class="meta" style="font-size:10px;margin-top:2px">⚔️ ${b.kampf.pa} : ${b.kampf.pv} · noch ${b.kampf.rest} s</div>
              ${dabei ? `<button class="mini" data-verst="${b.id}" ${me.verstCd ? "disabled" : ""}
                style="margin-top:4px;width:100%;font-size:10.5px;border-color:#e74c3c">
                ${me.verstCd ? `🥊 unterwegs · ${me.verstCd} s` : "🥊 Verstärkung schicken ($300 · +1)"}</button>` : ""}`;
          })() : "";
          return `<div style="background:#0b1322;border:1px solid ${b.kampf ? "#e74c3c" : fam ? fam.farbe + "66" : "var(--line)"};border-radius:9px;padding:7px 8px">
            <div style="font-size:11.5px;font-weight:600">${b.name}${b.kampf ? " ⚔️" : b.besatzung ? " 🏴" : ""}</div>
            <div class="meta" style="font-size:10.5px">${b.kampf ? `<span style="color:#e74c3c">REVIERKAMPF!</span>` : fam ? `<span style="color:${fam.farbe}">${fam.name}${b.besatzung ? ` · besetzt ${b.besatzung.rest} s` : ""}</span>` : "frei — niemand hat die Mehrheit"}${eigene ? ` · du: ${eigene}` : ""}</div>
            ${kampfHtml}
            ${b.gesichert ? `<div class="meta" style="color:#4a90d9;font-size:10px;margin-top:3px">🚨 polizeilich gesichert · ${b.gesichert} s</div>` : ""}
            ${binPolizeiPanel ? (b.kontrolle ? `<button class="mini" data-razzia="${b.id}" ${me.razziaCd ? "disabled" : ""}
              style="margin-top:5px;width:100%;font-size:10.5px;border-color:#4a90d9"
              title="Erfolgschance steigt mit der Fahndung der Familie">
              ${me.razziaCd ? `🚨 Einsatz in ${Math.floor(me.razziaCd / 60)}:${String(me.razziaCd % 60).padStart(2, "0")}` : "🚨 Razzia"}</button>` : "") : `<button class="mini" data-erpress="${b.id}" ${cd ? "disabled" : ""}
              style="margin-top:5px;width:100%;font-size:10.5px${eigenesRevier ? ";border-color:var(--accent)" : ""}"
              title="${eigenesRevier ? "Euer Revier: 1,5-facher Betrag, keiner mault" : fam ? "Fremdes Revier: 30 % Rauswurf-Risiko" : "Freier Bezirk"}">
              ${cd ? `gezahlt · ${Math.floor(cd / 60)}:${String(cd % 60).padStart(2, "0")}` : "💰 Erpressen"}</button>`}
            ${!binPolizeiPanel && fremdesRevier ? `<button class="mini" data-kampf="${b.id}" ${kampfBereit ? "" : "disabled"}
              style="margin-top:4px;width:100%;font-size:10.5px;border-color:#e74c3c66"
              title="${pistolen < 3 ? "Mind. 3 Pistolen nötig — Waffentransporte überfallen" : me.kampfCd ? "Deine Leute brauchen noch " + me.kampfCd + " s" : "Setzt bis zu 6 Pistolen ein"}">
              ${me.kampfCd ? `⚔️ bereit in ${Math.floor(me.kampfCd / 60)}:${String(me.kampfCd % 60).padStart(2, "0")}` : `⚔️ Revierkampf (${Math.min(6, pistolen)}🔫)`}</button>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>` : ""}
    ${meineFamilieId === "polizei" ? "" : `<div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Hehler · heiße Ware zu Geld machen</div>
      ${meineFam ? `<p class="note" style="margin:0 0 8px">Deine Familie stellt <b>${gname(meineFam.produkt)}</b> her —
        baue dafür die <b>${BTYPES()[meineFam.gebaeude]?.name || meineFam.gebaeude}</b> (kann nur deine Familie).
        Der Hehler zahlt bar; jeder Verkauf bringt <b>1 Respekt je 100 $</b>.</p>` : ""}
      ${hehlerZeilen || `<p class="note">Noch keine heiße Ware im Lager.</p>`}
    </div>`}`;

  if (k) {
    const binKopf = k.kopfId === myId;
    const absprachen = Object.entries(k.minPreise || {});
    const warenOpts = Object.keys(GOODS()).map(g => `<option value="${g}">${gname(g)}</option>`).join("");
    /* Wen man noch einladen kann: alle, die weder im eigenen Kartell sind noch
     * schon eingeladen wurden. Ob jemand in einem FREMDEN Kartell sitzt, weiß
     * der Client aus state.cartels — das ist öffentlich. */
    const drin = new Set((state.cartels || []).flatMap(c => c.mitglieder.map(m => m.id)));
    const eingeladen = new Set((k.einladungen || []).map(e => e.id));
    const frei = Object.values(state.players)
      .filter(p => p.id !== myId && !drin.has(p.id) && !eingeladen.has(p.id));
    inhalt.innerHTML = siegwegeHtml(state) + familienHtml + `
      <div class="joinbox" style="margin-bottom:12px">
        <div class="lbl">Dein Kartell</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:8px">${k.name}</div>
        ${k.mitglieder.map(m => `<div style="display:flex;gap:9px;align-items:center;margin:5px 0">
          <span style="width:10px;height:10px;border-radius:3px;background:${state.players[m.id]?.color || "#666"}"></span>
          <span style="flex:1">${m.name}${m.id === k.kopfId ? ` <span class="meta">· Kopf</span>` : ""}${m.id === myId ? ` <span class="meta">· du</span>` : ""}</span>
        </div>`).join("")}
        ${(k.einladungen || []).length ? `<div class="note" style="margin-top:7px">Eingeladen, noch nicht entschieden: ${k.einladungen.map(e => e.name).join(", ")}</div>` : ""}
        <div style="margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px">
            <span>Verdacht des Kartellamts</span><span class="meta">${k.verdacht} %</span></div>
          <div style="height:6px;background:#0b1220;border-radius:4px;overflow:hidden;margin-top:4px">
            <div style="width:${Math.min(100, k.verdacht)}%;height:100%;background:${k.verdacht >= 66 ? "#fb7185" : k.verdacht >= 33 ? "#fbbf24" : "#34d399"}"></div></div>
          <div class="note" style="margin-top:3px">Nur ihr seht diesen Wert — von außen ist er nicht ablesbar.
            Er steigt, solange mehrere von euch dieselbe Ware sichtbar zum abgesprochenen Preis anbieten,
            und faellt wieder, sobald die Absprache weg ist.</div>
          ${k.ermittlung ? `<div style="margin-top:9px;padding:8px 10px;border:1px solid rgba(251,113,133,.5);border-radius:8px;color:#fb7185">
            <b>Ermittlung laeuft</b> — Bescheid in ${Math.floor(k.ermittlung.rest / 60)}:${String(k.ermittlung.rest % 60).padStart(2, "0")} min.
            <div class="note" style="color:#fb7185;margin-top:2px">Die ganze Stadt weiss davon. Was ihr bis dahin
              noch unter der Absprache verdient, erhoeht das Bussgeld.</div>
          </div>` : ""}
          <div style="display:flex;justify-content:space-between;margin-top:9px;font-size:12px">
            <span>Umsatz unter Absprache</span><b>${fp(k.umsatz || 0)}</b></div>
          <div style="display:flex;justify-content:space-between;font-size:12px">
            <span class="meta">Bussgeld bei einem Bescheid</span>
            <b style="color:${(k.risiko || 0) > 0 ? "#fb7185" : "var(--dim)"}">${fp(k.risiko || 0)}</b></div>
        </div>
      </div>
      <div class="joinbox" style="margin-bottom:12px">
        <div class="lbl">Preisabsprachen</div>
        <p class="note" style="margin:0 0 8px">Unter diesen Preisen verkauft kein Mitglied — weder an der
          Börse noch per Direktvertrag noch im eigenen Laden.</p>
        ${absprachen.length ? absprachen.map(([g, preis]) => `
          <div style="display:flex;gap:9px;align-items:center;margin:5px 0">
            <span style="flex:1">${gname(g)}</span>
            <b>${preis} $</b>
            ${binKopf ? `<button class="mini" data-kartellpreisweg="${g}">Aufheben</button>` : ""}
          </div>`).join("") : `<p class="note">Noch keine Absprache — jeder verkauft, wie er will.</p>`}
        ${binKopf ? `<div class="formrow" style="margin-top:9px">
          <select id="kartellGood">${warenOpts}</select>
          <input id="kartellPreis" type="number" min="0" step="0.01" placeholder="Mindestpreis" style="width:110px">
          <button class="buyb" id="kartellPreisBtn">Festlegen</button>
        </div>
        <p id="kartellPreisStatus" class="note" style="margin:6px 0 0"></p>`
        : `<p class="note" style="margin-top:8px">Absprachen ändert nur der Kopf des Kartells.</p>`}
      </div>
      ${binKopf ? `<div class="joinbox" style="margin-bottom:12px">
        <div class="lbl">Einladen</div>
        ${frei.length ? `<div class="formrow">
          <select id="kartellZiel">${frei.map(p => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
          <button class="buyb" id="kartellEinladenBtn">Einladen</button>
        </div><p id="kartellEinladenStatus" class="note" style="margin:6px 0 0"></p>`
        : `<p class="note">Niemand mehr frei — alle sind schon in einem Kartell oder eingeladen.</p>`}
      </div>` : ""}
      ${absprachen.length ? `<div class="joinbox" style="margin-bottom:12px;border-color:rgba(251,113,133,.35)">
        <div class="lbl" style="color:#fb7185">Kronzeugenregelung</div>
        <p class="note" style="margin:0 0 8px">Zeigst du „${k.name}" an, zahlst du <b>nichts</b> und behältst,
          was du unter der Absprache verdient hast. Die anderen zahlen den höheren Satz — und erfahren,
          dass du es warst. Du verlässt das Kartell damit.</p>
        <button class="mini" id="kartellPetzen" style="border-color:rgba(251,113,133,.5);color:#fb7185">Kartell anzeigen</button>
        <span id="kartellPetzFrage" style="display:none;margin-left:8px;font-size:12px">
          Sicher? <button class="mini" id="kartellPetzJa" style="border-color:rgba(251,113,133,.5);color:#fb7185">Ja, anzeigen</button>
          <button class="mini" id="kartellPetzNein">Abbrechen</button></span>
      </div>` : ""}
      <button class="mini" id="kartellRaus">Kartell verlassen</button>`;
    return;
  }

  const offene = me.kartellEinladungen || [];
  inhalt.innerHTML = siegwegeHtml(state) + familienHtml + `
    ${offene.length ? `<div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Einladungen an dich</div>
      ${offene.map(e => `<div style="display:flex;gap:9px;align-items:center;margin:6px 0">
        <span style="flex:1">${e.name} <span class="meta">· ${e.mitglieder.map(m => m.name).join(", ")}</span></span>
        <button class="buyb" data-kartellja="${e.id}">Beitreten</button>
        <button class="mini" data-kartellnein="${e.id}">Ablehnen</button>
      </div>`).join("")}
    </div>` : ""}
    <div class="joinbox">
      <div class="lbl">Eigenes Kartell gründen</div>
      <p class="note" style="margin:0 0 8px">Bis zu vier Firmen sprechen Mindestpreise ab und hören auf,
        sich gegenseitig zu unterbieten. Wer beitritt, entscheidest du — aber jedes Mitglied kann
        jederzeit wieder gehen.</p>
      <div class="formrow">
        <input id="kartellName" maxlength="28" placeholder="Name des Kartells" style="flex:1">
        <button class="buyb" id="kartellGruendenBtn">Gründen</button>
      </div>
      <p id="kartellGruendenStatus" class="note" style="margin:6px 0 0"></p>
    </div>`;
}
/* Die fremden Kartelle stehen außerhalb von kartellInhalt, damit sie auch
 * sichtbar bleiben, während man im eigenen Panel gerade tippt. */
function kartellFremdeRendern(state, myId) {
  if (state.mode !== "kartell") return;
  const meins = (state.cartels || []).find(c => c.mitglieder.some(m => m.id === myId));
  const fremde = (state.cartels || []).filter(c => c !== meins);
  document.getElementById("kartellFremde").innerHTML = fremde.length ? fremde.map(c =>
    `<div style="margin:6px 0">
      <div style="font-weight:600">${c.name}${c.ermittlung
        ? ` <span style="color:#fb7185;font-weight:600">· Kartellamt ermittelt</span>` : ""}</div>
      <div class="meta">${c.mitglieder.map(m => m.name).join(", ")}</div>
    </div>`).join("")
    : `<p class="note">Sonst hat sich niemand zusammengetan${meins ? "" : " — noch ist der Markt frei"}.</p>`;
}

document.getElementById("p-kartell").addEventListener("click", e => {
  const status = t => { const s = document.getElementById(t); return s || { textContent: "" }; };
  /* Hehler: kompletten Bestand einer illegalen Ware zu Geld machen. */
  const hehler = e.target.closest("button[data-hehler]");
  if (hehler) {
    socket.emit("hehlerVerkauf", { good: hehler.dataset.hehler },
      res => toast(res?.error || `Der Hehler zahlt ${fmt(res.erloes)} — ohne Fragen.`, !!res?.error));
    return;
  }
  /* Schutzgelderpressung: durch die Läden eines Bezirks ziehen. */
  const erp = e.target.closest("button[data-erpress]");
  if (erp) {
    socket.emit("erpressen", { bezirk: +erp.dataset.erpress }, res =>
      toast(res?.error || `Die Läden zahlen ${fmt(res.betrag)} Schutzgeld.`, !!res?.error));
    return;
  }
  /* Razzia: die Polizei räumt einen kontrollierten Bezirk. */
  const razzia = e.target.closest("button[data-razzia]");
  if (razzia) {
    socket.emit("razziaBezirk", { bezirk: +razzia.dataset.razzia }, res =>
      toast(res?.error || `🚨 Zugriff! ${res.beschlagnahmt}× Ware beschlagnahmt, ${fmt(res.strafe)} Bußgeld kassiert.`, !!res?.error));
    return;
  }
  /* Verstärkung: Schläger ins laufende Tauziehen schicken. */
  const verst = e.target.closest("button[data-verst]");
  if (verst) {
    socket.emit("verstaerkung", { bezirk: +verst.dataset.verst }, res =>
      toast(res?.error || `🥊 Deine Schläger sind unterwegs — ${JSON.stringify(res.punkte).replace(/[{}"]/g, "").replace(/,/g, " · ")}`, !!res?.error));
    return;
  }
  /* Revierkampf: einen fremd kontrollierten Bezirk mit Waffen angreifen. */
  const kampf = e.target.closest("button[data-kampf]");
  if (kampf) {
    socket.emit("revierkampf", { bezirk: +kampf.dataset.kampf }, res =>
      toast(res?.error || `⚔️ Revier gestürmt — ${res.dauer} s lang ist der Bezirk offen: bau dich jetzt zur Mehrheit!`, !!res?.error));
    return;
  }
  /* Bestechung: die Fahndung der eigenen Familie abkühlen. */
  if (e.target.closest("button[data-bestechen]")) {
    socket.emit("bestechen", {}, res =>
      toast(res?.error || `Die Beamten schauen weg — Fahndung jetzt bei ${res.fahndung}.`, !!res?.error));
    return;
  }
  const gruenden = e.target.closest("#kartellGruendenBtn");
  if (gruenden) {
    const name = document.getElementById("kartellName").value.trim();
    return socket.emit("kartellGruenden", { name }, res => {
      status("kartellGruendenStatus").textContent = res?.error || "";
    });
  }
  const preis = e.target.closest("#kartellPreisBtn");
  if (preis) {
    const good = document.getElementById("kartellGood").value;
    const p = +document.getElementById("kartellPreis").value;
    if (!(p > 0)) { status("kartellPreisStatus").textContent = "Bitte einen Preis über 0 eingeben."; return; }
    return socket.emit("kartellPreisSetzen", { good, price: p }, res => {
      status("kartellPreisStatus").textContent = res?.error || "";
      if (!res?.error) document.getElementById("kartellPreis").value = "";
    });
  }
  const einladen = e.target.closest("#kartellEinladenBtn");
  if (einladen) {
    const toId = document.getElementById("kartellZiel").value;
    return socket.emit("kartellEinladen", { toId }, res => {
      status("kartellEinladenStatus").textContent = res?.error || "Einladung ist raus.";
    });
  }
  const weg = e.target.closest("button[data-kartellpreisweg]");
  if (weg) return act("kartellPreisAufheben", { good: weg.dataset.kartellpreisweg });
  const ja = e.target.closest("button[data-kartellja]");
  if (ja) return act("kartellBeitreten", { kartellId: +ja.dataset.kartellja });
  const nein = e.target.closest("button[data-kartellnein]");
  if (nein) return act("kartellAblehnen", { kartellId: +nein.dataset.kartellnein });
  /* Zweistufig, weil der Zug endgueltig ist und die Runde fuer alle anderen
   * spuerbar veraendert — ein Fehlklick waere nicht zurueckzunehmen. */
  if (e.target.closest("#kartellPetzen")) {
    document.getElementById("kartellPetzen").style.display = "none";
    document.getElementById("kartellPetzFrage").style.display = "";
    return;
  }
  if (e.target.closest("#kartellPetzNein")) {
    document.getElementById("kartellPetzFrage").style.display = "none";
    document.getElementById("kartellPetzen").style.display = "";
    return;
  }
  if (e.target.closest("#kartellPetzJa")) return act("kartellAnzeigen", {});
  if (e.target.closest("#kartellRaus")) return act("kartellVerlassen", {});
});

/* ---------- Adminpanel im Spiel ----------
 * Der Wirt einer Runde soll eingreifen koennen, ohne den Browser zu wechseln:
 * nachsehen, wer mitspielt, und jemandem aushelfen, der festhaengt.
 *
 * Versteckt statt gesperrt: Es gibt keinen Knopf im Dock und keinen Link. Man
 * kommt nur hinein, wenn man die Geste kennt — fuenfmal aufs eigene Firmenlogo
 * oben links. Das ist absichtlich nichts, worauf man beim Herumklicken stoesst,
 * aber auch nichts, was man sich aufschreiben muss.
 *
 * Die Geste allein oeffnet nur das Schluesselfeld. Alles Weitere haengt an der
 * Anmeldung, und die prueft der Server bei JEDEM Ereignis neu — die Geste ist
 * Bequemlichkeit, nicht die Absicherung. Wer sie kennt, aber den Schluessel
 * nicht hat, sieht genau so viel wie jeder andere: nichts. */
let adminAn = false, adminDaten = null, adminPoll = null, adminRunden = null;

const adminGeste = (() => {
  let zaehler = 0, letzter = 0;
  return () => {
    const jetzt = Date.now();
    /* Die Klicks muessen zusammenhaengen. Ohne dieses Fenster wuerde sich die
     * Geste ueber eine ganze Runde hinweg aus zufaelligen Logo-Klicks von
     * selbst zusammensetzen. */
    zaehler = jetzt - letzter < 1500 ? zaehler + 1 : 1;
    letzter = jetzt;
    if (zaehler >= 5) { zaehler = 0; adminOeffnen(); }
  };
})();
/* Zwei Stellen, eine Geste: im Spiel das Firmenlogo, im Warteraum die
 * Ueberschrift. Der Warteraum ist ein eigener Bildschirm ohne Logo — ohne
 * diesen zweiten Anker waere das Panel genau dann unerreichbar, wenn man am
 * ehesten nachsehen will, wer eigentlich alles da ist. */
for (const id of ["mylogo", "lwTitel"])
  document.getElementById(id)?.addEventListener("click", adminGeste);

function adminOeffnen() {
  openPanel("admin");
  adminRendern();
  /* Angemeldet bleibt die Uebersicht aktuell, solange das Panel offen ist —
   * Bargeld und Vermoegen bewegen sich schliesslich weiter, waehrend man
   * hinschaut. Zu bleibt der Zeitgeber stehen; niemand braucht Abfragen fuer
   * ein Panel, das keiner sieht. */
  clearInterval(adminPoll);
  adminPoll = setInterval(() => {
    if (!document.getElementById("p-admin").classList.contains("open") || !adminAn) return;
    socket.emit("adminUebersicht", {}, r => { if (r?.ok) { adminDaten = r; adminRendern(); } });
  }, 2000);
}

function adminAbfragen() {
  socket.emit("adminUebersicht", {}, r => {
    if (r?.error) { adminAn = false; adminRendern(r.error); return; }
    adminDaten = r; adminRendern();
  });
  /* Andere Runden gibt es nur hinter dem Gateway — im Einzelbetrieb haelt der
   * Prozess genau eine, und die steht ohnehin schon vollstaendig da. */
  if (MULTIROOM) fetch(api("/api/rooms/public")).then(r => r.json())
    .then(d => { adminRunden = d; adminRendern(); }).catch(() => {});
}

function adminRendern(fehler) {
  const el = document.getElementById("adminInhalt");
  if (!el) return;
  const tippt = el.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName);
  if (tippt) return;   // nicht unter den Fingern neu zeichnen

  if (!adminAn) {
    el.innerHTML = `
      <div class="joinbox">
        <div class="lbl">Anmeldung</div>
        <p class="note" style="margin:0 0 8px">Der Schlüssel steht im Serverprotokoll beim Start
          (<code>Bugreports (Admin)</code>) und in <code>bugreports/.key</code>.</p>
        <div class="formrow">
          <input id="adminKey" type="password" placeholder="Schlüssel" autocomplete="off" style="flex:1">
          <button class="buyb" id="adminLoginBtn">Anmelden</button>
        </div>
        ${fehler ? `<p class="note" style="margin:6px 0 0;color:var(--down)">${fehler}</p>` : ""}
      </div>`;
    return;
  }
  if (!adminDaten) { el.innerHTML = `<p class="note">Lade …</p>`; return; }

  const { runde, spieler, waren } = adminDaten;
  const geld = n => "$" + Math.round(n).toLocaleString("de-DE");
  const min = Math.floor(runde.tick / 60), sek = runde.tick % 60;
  const warenOpts = waren.map(w => `<option value="${w.k}">${w.name}</option>`).join("");

  el.innerHTML = `
    <div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Diese Runde</div>
      <div style="font-size:12.5px;line-height:1.7">
        <span class="pill">${runde.gestartet ? "läuft" : "Warteraum"}</span>
        <span class="pill">Modus ${runde.modus}</span>
        <span class="pill">${min}:${String(sek).padStart(2, "0")} min</span>
        <span class="pill">Ziel ${geld(runde.ziel)}</span>
        <span class="pill">${spieler.length} Firmen</span>
        ${runde.sieger ? `<span class="pill" style="color:var(--up)">beendet · ${runde.sieger}</span>` : ""}
      </div>
    </div>

    <div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Firmen</div>
      <p class="note" style="margin:0 0 8px">Beträge dürfen negativ sein — dann wird abgezogen.
        Jeder Eingriff steht im Kontobuch der Firma.</p>
      ${spieler.map(p => `
        <div class="adminZeile">
          <div class="adminWer">
            <span style="width:10px;height:10px;border-radius:3px;background:${p.farbe};flex:none"></span>
            <div style="min-width:0">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
              <div class="meta">${p.branche} · ${p.gebaeude} Geb. · ${p.rating}
                ${p.bot ? '· <span style="color:var(--dim)">Bot</span>'
                        : p.online ? '· <span style="color:var(--up)">verbunden</span>'
                                   : '· <span style="color:var(--down)">offline</span>'}</div>
            </div>
          </div>
          <div class="adminZahlen">
            <div>${geld(p.cash)}<div class="meta">Bargeld</div></div>
            <div>${geld(p.nw)}<div class="meta">Vermögen</div></div>
          </div>
          <div class="adminTun">
            <div class="formrow" style="margin:0">
              <input type="number" step="1000" value="10000" data-geldfeld="${p.id}" style="width:88px">
              <button class="mini" data-geld="${p.id}">Geld</button>
            </div>
            <div class="formrow" style="margin:0">
              <select data-warefeld="${p.id}">${warenOpts}</select>
              <input type="number" step="1" value="10" data-mengefeld="${p.id}" style="width:60px">
              <button class="mini" data-ware="${p.id}">Ware</button>
            </div>
          </div>
        </div>`).join("") || `<p class="note">Noch niemand in dieser Runde.</p>`}
      <p id="adminStatus" class="note" style="margin:8px 0 0"></p>
    </div>

    ${MULTIROOM ? `<div class="joinbox" style="margin-bottom:12px">
      <div class="lbl">Andere Runden auf diesem Server</div>
      ${adminRunden === null ? `<p class="note">Lade …</p>`
        : adminRunden.length ? adminRunden.map(r => `
          <div style="display:flex;gap:9px;align-items:center;margin:5px 0;font-size:12.5px">
            <b style="font-family:var(--mono);letter-spacing:.08em">${r.code}</b>
            <span style="flex:1">${r.host || "—"} <span class="meta">${(r.namen || []).join(", ")}</span></span>
            <span class="meta">${r.spieler}/${r.max}${r.bots ? ` +${r.bots} Bots` : ""} ·
              ${r.beendet ? "beendet" : r.gestartet ? "läuft" : "Warteraum"}</span>
          </div>`).join("")
        : `<p class="note">Keine weiteren öffentlichen Runden.</p>`}
      <p class="note" style="margin:8px 0 0">Eingreifen kannst du nur in deiner eigenen Runde —
        jede andere läuft in einem eigenen Prozess.</p>
    </div>` : ""}

    <button class="mini" id="adminLogoutBtn">Abmelden</button>`;
}

document.getElementById("p-admin").addEventListener("click", e => {
  const status = t => { const s = document.getElementById("adminStatus"); if (s) s.textContent = t; };

  if (e.target.closest("#adminLoginBtn")) {
    const feld = document.getElementById("adminKey");
    return socket.emit("adminLogin", { key: feld.value }, r => {
      if (r?.error) { feld.value = ""; adminRendern(r.error); return; }
      adminAn = true; adminRendern(); adminAbfragen();
    });
  }
  if (e.target.closest("#adminLogoutBtn")) {
    return socket.emit("adminLogout", {}, () => {
      adminAn = false; adminDaten = null; adminRendern();
    });
  }
  const g = e.target.closest("button[data-geld]");
  if (g) {
    const pid = g.dataset.geld;
    const betrag = +document.querySelector(`[data-geldfeld="${pid}"]`).value;
    if (!betrag) return status("Bitte einen Betrag ungleich 0 eingeben.");
    return socket.emit("adminEingriff", { pid, art: "geld", betrag }, r => {
      if (r?.error) return status(r.error);
      adminDaten = r; adminRendern(); status("");
    });
  }
  const w = e.target.closest("button[data-ware]");
  if (w) {
    const pid = w.dataset.ware;
    const good = document.querySelector(`[data-warefeld="${pid}"]`).value;
    const menge = +document.querySelector(`[data-mengefeld="${pid}"]`).value;
    if (!menge) return status("Bitte eine Menge ungleich 0 eingeben.");
    return socket.emit("adminEingriff", { pid, art: "ware", good, menge }, r => {
      if (r?.error) return status(r.error);
      adminDaten = r; adminRendern(); status("");
    });
  }
});

document.getElementById("p-schwarz").addEventListener("click", e => {
  const acceptBtn = e.target.closest("button[data-smaccept]");
  const cancelBtn = e.target.closest("button[data-smcancel]");
  const status = document.getElementById("smStatus");
  if (acceptBtn) socket.emit("planOfferAccept", { offerId: acceptBtn.dataset.smaccept },
    res => { if (res?.error) status.textContent = res.error; else status.textContent = "Tausch abgewickelt — hoffentlich hat niemand zugesehen."; });
  if (cancelBtn) socket.emit("planOfferCancel", { offerId: cancelBtn.dataset.smcancel },
    res => { status.textContent = res?.error || "Angebot zurückgezogen."; });
});
document.getElementById("smAnbieten").addEventListener("click", () => {
  const status = document.getElementById("smStatus");
  const daten = {
    gebeGood: document.getElementById("smGebeGood").value,
    gebeQty: +document.getElementById("smGebeQty").value,
    willGood: document.getElementById("smWillGood").value,
    willQty: +document.getElementById("smWillQty").value,
  };
  if (!(daten.gebeQty > 0) || !(daten.willQty > 0)) { status.textContent = "Bitte beide Mengen eingeben."; return; }
  socket.emit("planOfferCreate", daten, res => {
    if (res?.error) { status.textContent = res.error; return; }
    status.textContent = "Angebot hängt jetzt am schwarzen Brett.";
    document.getElementById("smGebeQty").value = ""; document.getElementById("smWillQty").value = "";
  });
});
document.getElementById("planRequestBtn").addEventListener("click", () => {
  const good = document.getElementById("planGood").value;
  const qty = +document.getElementById("planQty").value;
  const status = document.getElementById("planReqStatus");
  if (!(qty > 0)) { status.textContent = "Bitte eine Menge eingeben."; return; }
  socket.emit("planRequest", { good, qty }, res => {
    if (res?.error) { status.textContent = res.error; return; }
    status.textContent = `Zuteilung erhalten: ${qty}× ${gname(good)}.`;
    document.getElementById("planQty").value = "";
  });
});

/* Lexikon/Firma: welche Aufklapp-Gruppen offen sind, und der Suchtext.
 * render() baut die Panels bei jedem Update neu — ohne Merker klappten sie
 * jede Sekunde wieder zu. */
const LEX_OFFEN = new Set(); let LEX_SUCHE = "";
document.addEventListener("toggle", e => {
  const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.lex) return;
  if (d.open) LEX_OFFEN.add(d.dataset.lex); else LEX_OFFEN.delete(d.dataset.lex);
}, true);
document.addEventListener("click", e => {
  if (!e.target.closest("[data-tx-alle]")) return;
  try { sessionStorage.setItem("cs_tx_alle", sessionStorage.getItem("cs_tx_alle") === "1" ? "0" : "1"); } catch {}
  store.set({});
});
function render({ state, me, myId, chat, room }) {
  if (state?.logoV) logosAbgleichen(state);
  if (!state || !me) return;
  tutCheck(state, myId);
  kapitalmarktHinweis(state, myId);
  spielHinweise(state, me, myId);
  planRendern(state, myId);
  kartellRendern(state, me, myId);
  kartellFremdeRendern(state, myId);
  rennenRendern(state, myId);
  motorsportRendern(state, me, myId);
  /* Tipp-Schutz: Panel nicht neu rendern, während man in einem seiner Felder tippt */
  const typingIn = el => el && el.contains(document.activeElement) &&
    /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  const my = state.players[myId];
  document.getElementById("cash").textContent = fmt(me.cash);
  { const eb = document.getElementById("einw"), S = state.stadt;
    eb.hidden = !S;
    if (S) eb.textContent = `${S.einwohner.toLocaleString("de-DE")} ${t("Einw.")}`; }
  document.getElementById("lvl").textContent = me.lvl;
  document.getElementById("xpfill").style.width = (me.xp / (me.lvl*100) * 100) + "%";
  if (my) { document.getElementById("nwv").textContent = fmt(my.netWorth);
    document.getElementById("myrat").textContent = my.rating;
    document.getElementById("coname").textContent = rohText(my.name);
    const ml = document.getElementById("mylogo"), mb = logoBild(myId);
    ml.style.background = mb ? `#fff url(${mb}) center/cover` : my.color;
    ml.style.imageRendering = mb ? "pixelated" : "";
    ml.textContent = mb ? "" : rohText(my.name)[0].toUpperCase(); }
  if (state.winGoal) {
    /* Mit Zeitlimit läuft die Restzeit neben dem Ziel mit */
    const rest = state.zeitLimit && !state.winner ? Math.max(0, state.zeitLimit * 60 - state.tick) : null;
    document.getElementById("goalv").textContent = fmt(state.winGoal) + (rest != null ? ` · ⏱ ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}` : "");
  }

  /* Starter-Aufgaben-Widget: offene Aufgaben mit Fortschritt, fertig = ausgeblendet */
  const qdefs = state.questDefs || store.get().meta?.questDefs || [];
  const open = qdefs.filter(d => !me.quests?.[d.id]?.done);
  const qEl = document.getElementById("quests");
  /* Im Kartellmodus heißen die Aufgaben, was sie sind. */
  const polizeiWidget = state.mode === "kartell" && state.players?.[myId]?.familie === "polizei";
  qEl.firstElementChild.textContent = polizeiWidget
    ? (SPRACHE === "en" ? "POLICE DUTY" : "Einsatzbefehl")
    : state.mode === "kartell"
    ? (SPRACHE === "en" ? "MOB CONTRACTS" : "Mafia-Aufträge")
    : (SPRACHE === "en" ? "STARTER TASKS" : "Starter-Aufgaben");
  if (polizeiWidget) {
    qEl.style.display = "block";
    document.getElementById("questlist").innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:8px"><span>Einsatzpunkte sammeln</span>
        <b style="color:var(--accent)">${state.polizei?.punkte || 0}/${state.polizei?.ziel || 25}</b></div>
      <div class="meta" style="margin-top:5px;line-height:1.5">🚚 Transporte anklicken = Kontrolle (+1)<br>
      🚨 Razzia auf kontrollierte Bezirke (+2, Kartell-Panel)<br>
      Je höher die Fahndung einer Familie, desto sicherer der Zugriff.</div>`;
  }
  /* Die Starter-Aufgaben führen zu Börse und Stadtbank — beides gibt es in
   * der Planwirtschaft nicht, dort bleibt das Widget aus. */
  if (!polizeiWidget && open.length && !state.winner && state.mode !== "plan") {
    qEl.style.display = "block";
    /* Übersicht statt Liste: Fortschritt, die NÄCHSTE Aufgabe groß, der Rest
     * nur auf Wunsch (Zustand wird gemerkt). */
    const fertig = qdefs.length - open.length;
    let alle = false; try { alle = localStorage.getItem("cs_quests_alle") === "1"; } catch {}
    const zeile = (d, gross) => {
      const n = Math.min(d.target, Math.floor(me.quests?.[d.id]?.n || 0));
      return `<div class="qZeile${gross ? " gross" : ""}">
        <span>${SPRACHE === "en" ? (d.en ?? d.text) : d.text}</span>
        <span class="qWert">${d.target > 1 ? `${n}/${d.target} · ` : ""}<b>+$${d.reward}</b></span>
        ${gross && d.target > 1 ? `<i class="qBalken"><i style="width:${Math.round(n / d.target * 100)}%"></i></i>` : ""}</div>`;
    };
    document.getElementById("questlist").innerHTML = `
      <div class="qStand"><span>${fertig} von ${qdefs.length} erledigt</span><i class="qBalken"><i style="width:${Math.round(fertig / Math.max(1, qdefs.length) * 100)}%"></i></i></div>
      ${zeile(open[0], true)}
      ${open.length > 1 ? `${alle ? open.slice(1).map(d => zeile(d, false)).join("") : ""}
        <button type="button" class="qMehr" data-quests-toggle>${alle ? "Weniger anzeigen" : `+ ${open.length - 1} weitere`}</button>` : ""}`;
  } else if (!polizeiWidget) qEl.style.display = "none";
  document.getElementById("players").innerHTML = Object.values(state.players)
    /* Chips oben: Logo statt Buchstabe, wo eines vorliegt. Entscheidend ist das
     * SEITENVERHÄLTNIS — quadratisch gequetscht war jede Wortmarke unlesbar.
     * Mit fester Höhe und freier Breite bleiben die Logos schmal (die meisten
     * sind nahezu quadratisch, nur AgrarGenossen ist breit) und die ganze
     * Reihe passt weiterhin in die Kopfleiste. */
    .map(p => { const t = `${p.name} · ${fmt(p.netWorth)} · ${p.rating}`, gemalt = logoBild(p.id);
      /* Selbst gemaltes Logo (Malprogramm) geht vor */
      if (gemalt) return `<img class="plLogo gemalt" src="${gemalt}" alt="${p.name}" title="${t}">`;
      const u = logoUrl(p.name);
      return u ? `<img class="plLogo" src="${u}" alt="${p.name}" title="${t}">`
               : `<span class="pl" style="background:${p.color}" title="${t}">${p.name[0].toUpperCase()}</span>`; }).join("");
  if (state.winner) { document.getElementById("win").style.display = WIN_ZU ? "none" : "grid";
    document.getElementById("winWieder").hidden = !WIN_ZU;
    document.getElementById("winname").textContent = state.winner;
    zeigeAuswertung(state);
  }

  /* Ticker: ruhiger Ø-Kurs je Ware mit Trendpfeil + letztem echten Trade */
  const avg = refAvg(state.avg);
  const tickerHtml = Object.entries(avg).map(([k, p]) => {
    const prev = calmPrev?.[k];
    const dir = prev == null || p === prev ? "" : p > prev ? "▲" : "▼";
    const cls = dir === "▲" ? "u" : dir === "▼" ? "d" : "";
    const dec = p < 10 ? 2 : 0;
    /* Die Sparkline steckt in jedem Chip, wird zugeklappt aber per CSS
     * ausgeblendet — so muss beim Auf- und Zuklappen nichts neu gebaut werden.
     * Der letzte echte Trade steht bewusst NICHT hier: er kostete die Breite
     * von zwei weiteren Waren und drueckte den Preis in die Ellipse. Wer ihn
     * braucht, findet ihn an der Boerse. */
    return `<span class="tk"><span class="nm">${gname(k)} Ø<b>$${p.toLocaleString("de-DE",{minimumFractionDigits:dec,maximumFractionDigits:dec})}</b><span class="${cls}">${dir}</span></span>${sparkline(k, 46, 14)}</span>`;
  }).join("");
  /* Nur neu schreiben, wenn sich wirklich etwas geändert hat — sonst baut der
   * Ticker sekündlich denselben Inhalt neu auf und flimmert dabei. */
  const trackEl = document.getElementById("tickerTrack");
  if (trackEl.dataset.sig !== tickerHtml) { trackEl.innerHTML = tickerHtml; trackEl.dataset.sig = tickerHtml; }

  /* Börse: je Ware eine Karte mit getrennten Kauf-/Verkaufsspalten */
  if (document.getElementById("p-boerse").classList.contains("open") &&
      !typingIn(document.getElementById("p-boerse"))) {
    const filt = document.getElementById("exFilter").value;
    const mine = state.orders.filter(o => o.playerId === myId);
    const byGood = {};
    for (const o of state.orders) {
      if (filt && o.good !== filt) continue;
      if (o.playerId === myId) continue;
      (byGood[o.good] ??= { buy: [], sell: [] })[o.side].push(o);
    }
    /* Eine Order = eine volle Zeile statt zwei enger Spalten. Vorher standen
     * "GESUCHE" und "ANGEBOTE" als Ueberschrift ueber JEDER der bis zu 14
     * Waren — dieselben zwei Zeilen 28-mal — und im 440 px breiten Panel
     * blieben je Spalte rund 200 px, zu wenig fuer Menge, Preis, Firmenname
     * und Knopf: der Name rutschte auf eine eigene Zeile. Jetzt traegt ein
     * Richtungspfeil die Information, die Legende steht einmal oben. */
    const row = (o, gesuch) => `
      <div class="obrow">
        <span style="color:${gesuch ? "var(--up)" : "var(--down)"}">${gesuch ? "▲" : "▼"}</span>
        <span class="omono">${o.qty}× <b>${fp(o.price)}</b></span>
        <span class="meta oname">${o.player}</span>
        <button class="${gesuch ? "sellb" : "buyb"}" data-take="${o.id}">${gesuch ? t("Beliefern") : t("Kaufen")}</button>
      </div>`;
    { const F = state.finanzamt, gb = document.getElementById("oGebuehr");
      gb.hidden = !(F?.aktiv && F.boerse > 0);
      if (!gb.hidden) gb.innerHTML = `<span class="faStufeMini" data-stufe="${F.stufe}">${F.stufeName}</span>
        Börsengebühr <b>${Math.round(F.boerse * 1000) / 10} %</b> — der Verkäufer gibt sie vom Erlös ans Finanzamt ab.`; }
    document.getElementById("exbook").innerHTML =
      /* Auf eine Ware gefiltert: grosser Kursverlauf statt nur der Sparkline.
       * Genau das fehlte bisher — dass Stahl von 115 auf 137 gelaufen war, sah
       * man am Oe-Preis allein nicht. */
      (filt ? kursChart(filt) : "") +
      (mine.length ? `<div class="sec">${t("Meine Orders")}</div>` + mine.map(o => `
        <div class="obrow">
          <span style="color:${o.side === "sell" ? "var(--down)" : "var(--up)"}">${o.side === "sell" ? "▼" : "▲"}</span>
          <span class="omono">${o.qty}× <b>${fp(o.price)}</b></span>
          <span class="meta oname">${gname(o.good)}</span>
          <button class="mini" data-cancel="${o.id}">${t("Storno")}</button></div>`).join("") : "") +
      (Object.keys(byGood).length ? `<div class="oblegend">
          <span><b style="color:var(--up)">▲ ${t("Gesuch")}</b> — ${t("jemand kauft, du lieferst")}</span>
          <span><b style="color:var(--down)">▼ ${t("Angebot")}</b> — ${t("jemand verkauft, du kaufst")}</span>
        </div>` + Object.entries(byGood).map(([g, { buy, sell }]) => `
        <div class="sec" style="display:flex;justify-content:space-between;align-items:center"><span>${gname(g)}</span>
          <span style="display:flex;align-items:center;gap:7px;font-family:var(--mono);text-transform:none;letter-spacing:0">
            ${sparkline(g)}${trendLabel(g)}${saettigung(g, state)}Ø ${fp(avg[g] ?? 0)}</span></div>
        ${buy.sort((a, b) => b.price - a.price).map(o => row(o, true)).join("")}
        ${sell.sort((a, b) => a.price - b.price).map(o => row(o, false)).join("")}`).join("")
      : `<div class="meta" style="margin-top:8px">${filt ? t("Keine fremden Orders für diese Ware.") : t("Orderbuch leer — platziere die erste Order.")}</div>`);
    document.querySelectorAll("[data-take]").forEach(b => b.addEventListener("click", () => act("takeOrder", { orderId:+b.dataset.take })));
    document.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", () => act("cancelOrder", { orderId:+b.dataset.cancel })));
  }

  /* Finanzamt */
  if (document.getElementById("p-finanzamt").classList.contains("open") &&
      !typingIn(document.getElementById("p-finanzamt"))) finanzamtRendern(state, me, myId);

  /* Lager + Gruppenauftrag */
  if (document.getElementById("p-lager").classList.contains("open") &&
      !typingIn(document.getElementById("invgrid"))) {
    const rows = Object.entries(me.inv).filter(([,q]) => q >= 0.5);
    /* Gruppenauftrag der Stadt */
    const go = state.groupOrder;
    const myName = state.players[myId]?.name;
    const goVol = go ? Object.values(go.needs).reduce((s, n) => s + n.req * n.pay, 0) : 0;
    const goMult = go?.praemie ? 2 * (1 + go.praemie / goVol) : 2;
    const goHtml = go ? `<div class="sec" style="grid-column:1/-1">Großauftrag: ${go.city} <span class="meta">· Gesamttopf ${fmt(goVol + (go.praemie || 0))} · noch ${Math.floor(go.ttl/60)}:${String(go.ttl%60).padStart(2,"0")} min · ${go.praemie ? `inkl. ${fmt(go.praemie)} Prämie der Stadtkasse (≈ Ø×${goMult.toFixed(1).replace(".", ",")})` : "Stückpreise fixiert (Ø×2)"}</span></div>` +
      Object.entries(go.needs).map(([g, n]) => {
        const pct = Math.min(100, n.have / n.req * 100).toFixed(0);
        const mine = go.contrib[myName]?.[g] || 0;
        return `<div class="contract" style="grid-column:1/-1;flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between"><b>${gname(g)}</b>
            <span class="meta">${n.have} / ${n.req}${mine ? ` · von dir: ${mine}` : ""} · zahlt fix ${fp(n.pay)}/Stk</span></div>
          <div style="height:7px;background:var(--panel2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent2)"></div></div>
          <div style="display:flex;gap:6px;justify-content:flex-end;align-items:center">
            <span class="meta">Lager: ${Math.floor(me.inv[g])}</span>
            <input type="number" min="1" id="go-${g}" placeholder="Menge" style="width:70px">
            <button class="buyb" data-go="${g}" ${me.inv[g] < 1 || n.have >= n.req ? "disabled" : ""}>Einzahlen</button>
          </div></div>`;
      }).join("") : "";
    document.getElementById("invgrid").innerHTML = goHtml +
      (rows.length ? rows.map(([k,q]) =>
        `<div class="invtile"><h4>${gname(k)}</h4><div class="qty">${Math.floor(q).toLocaleString("de-DE")}</div>
         <div class="val">Ø ${fp(avg[k] ?? 0)} · Wert ${fmt(q * (avg[k] ?? 0))}</div></div>`).join("")
      : `<span class="meta" style="grid-column:1/-1">Lager leer — baue Produktion oder kaufe an der Börse.</span>`);
    document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
      const g = b.dataset.go;
      const qty = +document.getElementById("go-" + g).value || Math.floor(me.inv[g]);
      act("contribute", { good: g, qty });
    }));
  }

  /* Bonds + Auktionen + Verträge */
  if (document.getElementById("p-bonds").classList.contains("open") &&
      !typingIn(document.getElementById("p-bonds"))) {
    const badge = r => `<span class="rbadge" style="background:${RCOL[r]}22;color:${RCOL[r]}">${r}</span>`;
    const myContracts = state.contracts.filter(c => c.toId === myId);
    document.getElementById("bondlist").innerHTML =
      (myContracts.length ? `<div class="sec">Vertragsangebote an dich</div>` + myContracts.map(c =>
        `<div class="contract"><div><b>${c.from}</b><div class="meta">${c.qty}× ${gname(c.good)} @ ${fmt(c.price)}/Stk = ${fmt(c.qty*c.price)}</div></div>
         <div><button class="buyb" data-acc="${c.id}">Annehmen</button> <button class="mini" data-dec="${c.id}">Ablehnen</button></div></div>`).join("") : "") +
      `<div class="sec">Anleihen-Markt (nur Spieler-Emissionen)</div>` +
      (state.bonds.length ? state.bonds.map(b => `<div class="bond">
        <div><b>${b.issuer}</b> ${badge(b.issuerRating)}<div class="meta">${fmt(b.principal)} · ${(b.rate*100).toFixed(1)} %/min · Rest ${b.termLeft}s${b.holder ? " · Gläubiger: "+b.holder : ""}${b.strikes>0 ? " · Verzug" : ""}</div></div>
        ${!b.holder && b.issuerId!==myId ? `<button class="buyb" data-bond="${b.id}">Kaufen</button>` : ""}</div>`).join("")
      : `<span class="meta">Keine Emissionen. Ratings entstehen aus Nettovermögen & Schulden der Spieler.</span>`);
    document.getElementById("auctionlist").innerHTML = state.auctions.length ? state.auctions.map(a =>
      `<div class="auction"><div><b>${BTYPES()[a.btype]?.name}</b>
        <div class="meta">Mindestgebot ${fmt(a.minBid)} · Höchstgebot ${a.bestBid ? fmt(a.bestBid) : "—"} · ${a.tLeft}s</div></div>
       <div style="display:flex;gap:5px"><input type="number" style="width:80px" id="bid-${a.id}" placeholder="${Math.max(a.minBid, a.bestBid+1)}">
       <button class="buyb" data-auc="${a.id}">Bieten</button></div></div>`).join("")
      : `<span class="meta">Keine laufenden Auktionen.</span>`;
    document.querySelectorAll("[data-bond]").forEach(b => b.addEventListener("click", () => act("buyBond", { bondId:+b.dataset.bond })));
    document.querySelectorAll("[data-auc]").forEach(b => b.addEventListener("click", () =>
      act("bid", { auctionId:+b.dataset.auc, amount: document.getElementById("bid-"+b.dataset.auc).value })));
    document.querySelectorAll("[data-acc]").forEach(b => b.addEventListener("click", () => act("acceptContract", { contractId:+b.dataset.acc })));
    document.querySelectorAll("[data-dec]").forEach(b => b.addEventListener("click", () => act("declineContract", { contractId:+b.dataset.dec })));
  }

  /* Nachrichtenzentrale: Marktberichte, neuester zuoberst */
  if (document.getElementById("p-news").classList.contains("open")) {
    const berichte = state.news || [];
    /* Zahlen und Namen aus dem Fliesstext hervorheben. Der Server liefert
     * fertige Saetze — die Auszeichnung passiert hier, weil nur der Client die
     * Firmenfarben kennt. Reihenfolge ist wichtig: erst Prozente und Betraege,
     * dann Namen, sonst zerschneidet eine Ersetzung die andere. */
    const firmenFarben = Object.values(state.players)
      .map(p => ({ name: p.name, farbe: p.color }))
      .sort((a, b) => b.name.length - a.name.length);   // laengste zuerst, sonst trifft ein Teilname
    const hervor = txt => {
      let h = txt
        .replace(/([+−-]\d+(?:,\d+)? Prozent)/g, m =>
          `<b class="nwproz ${m.startsWith("+") ? "auf" : "ab"}">${m}</b>`)
        .replace(/(\d[\d.]*(?:,\d+)? \$)/g, '<b class="nwgeld">$1</b>')
        .replace(/(\d+ (?:gesucht|Einheiten))/g, '<b class="nwmenge">$1</b>');
      for (const f of firmenFarben) {
        if (!f.name) continue;
        /* Nur ausserhalb bereits erzeugter Auszeichnungen ersetzen — ein
         * Firmenname kann sonst mitten in einem eingefuegten Attribut landen. */
        h = h.split(/(<[^>]*>)/).map(teil => teil.startsWith("<") ? teil
          : teil.split(f.name).join(`<span class="nwfirma" style="color:${f.farbe}">${f.name}</span>`)).join("");
      }
      return h;
    };
    document.getElementById("newsliste").innerHTML = berichte.length
      ? berichte.map((b0, i) => {
          /* Der Server liefert beide Sprachen mit — hier nur auswaehlen. */
          const b = (SPRACHE === "en" && b0.en) ? { ...b0.en, min: b0.min } : b0;
          return `
        <article class="nwkarte${i === 0 ? " neu" : ""}">
          <div class="nwkopf"><span class="nwressort">${t("Marktbericht")}</span><span class="nwzeit">${t("Minute")} ${b.min}</span>${i === 0 ? `<span class="nwmarke">${t("neu")}</span>` : ""}</div>
          <h3 class="nwschlag">${hervor(b.schlagzeile)}</h3>
          ${b.absaetze.map((x, j) => `<p class="nwtext${j === 0 ? " lead" : ""}">${hervor(x)}</p>`).join("")}
        </article>`; }).join("")
      : `<div class="meta" style="margin-top:10px">Die erste Ausgabe erscheint nach zwei Minuten Spielzeit.</div>`;
  }

  /* Online-Shop-Fenster live halten (Lager, Bestellungen) — außer während
   * der Bezahlanimation und solange eine Menge eingetippt wird. */
  if (LEIT.offen) leitZeichnen();
  if (SHOP.offen && !SHOP.kasse && !(document.activeElement && document.getElementById("shopFenster").contains(document.activeElement) && document.activeElement.tagName === "INPUT")) shopZeichnen();

  /* Software: Systemvergleich für alle, Baukasten für Software-Firmen */
  if (document.getElementById("p-software").classList.contains("open") &&
      !typingIn(document.getElementById("p-software"))) softwareRendern(state, me, myId);
  /* Touristik: Dock-Knopf immer, das Panel nur offen und ohne Eingabe */
  if (!typingIn(document.getElementById("p-touristik"))) touristikRendern(state, me, myId);
  if (HOTEL.offen && !typingIn(document.getElementById("hotelFenster"))) hotelZeichnen();
  if (RZW.offen && !typingIn(document.getElementById("rzFenster"))) rzZeichnen();
  { const dn = document.getElementById("dockNetz"); if (dn) { dn.style.display = state.stadt ? "" : "none"; dn.classList.toggle("neu", ((state.news || [])[0]?.ts || 0) > KURIER.gelesen); }
    const db = document.getElementById("dockBoerse"); if (db && state.stadt) db.style.display = "none"; }   // Börse steht im Stadtnetz
  if (state.stadt) KURIER.merken(state);
  if (NETZ.offen && !(document.activeElement && document.getElementById("netzFenster").contains(document.activeElement) && document.activeElement.tagName === "INPUT" && document.activeElement.type === "number")) netzZeichnen();
  if (GEN.offen) { const a = state?.rechenzentren?.websites?.[GEN.kunde]?.auftrag, f = document.querySelector("#genFenster .genFrist");
    if (f && a?.status === "offen") f.textContent = `${Math.floor(a.rest / 60)}:${String(a.rest % 60).padStart(2, "0")}`; }

  /* Stadtbank: Kurstafel, Angebote und Depot — der gesamte Anteilshandel */
  if (document.getElementById("p-bank").classList.contains("open") &&
      !typingIn(document.getElementById("p-bank"))) {
    /* Kopfzeile: eigene Lage in vier Zahlen plus Dividendenuhr. Wer Anteile
     * abgeben will, muss wissen, was ein Block wert ist und wie viel er noch
     * hält — beides stand vorher nirgends im Panel, man musste es sich aus der
     * Kurstafel heraussuchen. */
    const restSek = state.nextDividendIn ?? 600;
    const dm = Math.floor(restSek / 60), ds = restSek % 60;
    const takt = store.get().meta?.dividendInterval ?? 600;
    const fortschritt = Math.max(0, Math.min(1, 1 - restSek / takt));
    const meinAnteil = me.ownPct ?? 0;
    const kopfZahl = (wert, label, farbe) =>
      `<div class="bkz"><b style="color:${farbe || "var(--text)"}">${wert}</b><span>${label}</span></div>`;
    document.getElementById("bankKopf").innerHTML = `
      <div class="bkopf-oben">
        <span class="bkopf-name">${firmenMarke(my?.name || "Deine Firma", my?.color || "var(--text)", 24)}</span>
        <span class="bkopf-rating" style="color:${RCOL[my?.rating] || "var(--dim)"}">${my?.rating || "—"}</span>
      </div>
      <div class="bkopf-zahlen">
        ${kopfZahl(`${me.ownAktien ?? 0}<small>/${AKTIEN_JE_FIRMA()}</small>`, "Aktien gehören dir", meinAnteil >= 50 ? "var(--up)" : "var(--down)")}
        ${kopfZahl(fk(me.kurs ?? 0), "Kurs je Aktie", "var(--accent)")}
        ${kopfZahl(fk(me.fundament ?? 0), "Wert je Aktie (F)")}
        ${kopfZahl(fmt(my?.marketValue ?? 0), "Marktwert")}
      </div>
      <div class="bkopf-uhr">
        <div class="bkopf-balken"><i style="width:${(fortschritt * 100).toFixed(1)}%"></i></div>
        <span>Nächste Dividende in <b id="divCountdown">${dm}:${String(ds).padStart(2,"0")}</b></span>
      </div>`;

    /* Verkaufen kann man eigene Anteile (Emission) und zugekaufte fremde (Weiterverkauf) */
    const sellable = [{ id: myId, name: "Eigene Firma", aktien: me.ownAktien ?? 0, kurs: me.kurs ?? 0 }]
      .concat((me.portfolio || []).map(h => ({ id: h.id, name: h.company, aktien: h.count, kurs: h.kurs })))
      .filter(o => o.aktien > 0);
    const shCo = document.getElementById("shCompany"), shCoPrev = shCo.value;
    shCo.innerHTML = sellable.map(o =>
      `<option value="${o.id}">${o.name} (${o.aktien} Aktien)</option>`).join("")
      || `<option value="">Keine Aktien</option>`;
    if (sellable.some(o => o.id === shCoPrev)) shCo.value = shCoPrev;
    const sel = sellable.find(o => o.id === shCo.value);
    const shN = Math.max(1, Math.min(sel?.aktien || 1, +document.getElementById("shCount").value || 1));
    document.getElementById("shCount").max = sel?.aktien || 1;
    shKursSel = sel?.kurs || 0;
    document.getElementById("shHint").textContent = sel
      ? `Kurs ${fk(sel.kurs)} je Aktie → ${shN} Aktien ≈ ${fmt(sel.kurs * shN)}. Du hältst ${sel.aktien}.`
      : "Du hältst gerade keine Aktien zum Verkauf.";

    const shToSel = document.getElementById("shTo"), shToPrev = shToSel.value;
    shToSel.innerHTML = `<option value="">Offener Markt (alle)</option>` + Object.values(state.players)
      .filter(p => p.id !== myId).map(p => `<option value="${p.id}">Nur an ${p.name}</option>`).join("");
    shToSel.value = shToPrev;

    /* Kurstafel: jede Firma aufklappbar — Wertverlauf, Dividende je Block und
     * die daraus gerechnete Rendite. Der Blockpreis allein sagt naemlich nicht,
     * ob ein Kauf sich lohnt: eine teure Firma ohne Umsatz schuettet nichts
     * aus, eine billige mit hohem Umsatz holt den Kaufpreis schnell herein. */
    document.getElementById("bankboard").innerHTML = Object.values(state.players)
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
      .map(p => {
        const held = p.id === myId ? (me.ownPct ?? 0)
          : ((me.portfolio || []).find(h => h.id === p.id)?.pct || 0);
        const auf = firmenAuf.has(p.id);
        const div = aktienDividende(p), rend = aktienRendite(p), urteil = renditeUrteil(rend);
        const takt = Math.round((store.get().meta?.dividendInterval ?? 600) / 60);
        const angebote = state.shareListings.filter(l => l.companyId === p.id && l.sellerId !== myId && (!l.toId || l.toId === myId))
          .sort((a, b) => a.price / a.count - b.price / b.count);
        const guenstig = angebote[0];
        return `<div class="bond firmrow" data-firm="${p.id}" style="cursor:pointer">
          <div style="min-width:0;flex:1">${firmenMarke(p.name, p.color, 42)}${p.id === myId ? ` <span class="meta">(du)</span>` : ""}
            <div class="meta">Marktwert ${fmt(p.marketValue || 0)}${held ? ` · <b style="color:var(--accent)">du: ${held} %</b>` : ""}
              ${angebote.length ? ` · <span class="bAngebotChip">${angebote.length} Angebot${angebote.length > 1 ? "e" : ""} ab ${fk(guenstig.price / guenstig.count)}/Aktie</span>` : ""}
              · ${lueckeHtml(p.luecke)}</div></div>
          <span style="display:flex;align-items:center;gap:8px">
            ${firmHist[p.id] ? sparklineVon(firmHist[p.id], 52, 16) : ""}
            <span class="fpreis">${fk(p.kurs || 0)}<span class="meta"> /Aktie</span></span>
            <span class="meta" style="width:9px;text-align:center">${auf ? "⌃" : "⌄"}</span>
          </span>
        </div>` + (auf ? `<div class="firmdetail">
          ${verlaufChart(firmHist[p.id], "Marktwert (Kurs × Aktien)", fmt)}
          <div class="kzrow"><span>Kurs je Aktie</span><b>${fk(p.kurs || 0)}</b></div>
          <div class="kzrow"><span>Wert je Aktie (Fundament F)</span><b>${fk(p.fundament || 0)} <span class="meta">· ${lueckeHtml(p.luecke)}</span></b></div>
          <div class="kzrow"><span>Buchwert der Firma</span><b>${fmt(p.buchwert || 0)}</b></div>
          <div class="kzrow"><span>Umsatz der letzten 10 min</span><b>${fmt(p.rev10 || 0)}</b></div>
          <div class="kzrow"><span>Dividende je Aktie</span><b>${div == null ? "—" : fk(div)} <span class="meta">/${takt} min${p.ausschuettung != null ? " · fest" : ""}</span></b></div>
          <div class="kzrow"><span>Dividendenrendite zum Kurs</span><b style="color:${urteil?.farbe || "var(--dim)"}">${rend == null ? "—" : rend.toFixed(1) + " %"}${urteil ? ` <span style="font-weight:400">· ${urteil.text}</span>` : ""}</b></div>
          ${angebote.length ? `<div class="bAngebote"><div class="bAngKopf">Angebote</div>${angebote.map(l => {
              const fair = (p.kurs || 0) * l.count, diff = fair ? Math.round((l.price / fair - 1) * 100) : 0;
              return `<div class="bAng"><span>${l.count} Aktien · ${l.isIssue ? "Emission" : `von ${l.seller}`}${l.toId ? " · <b>nur für dich</b>" : ""}
                <em class="${diff <= 0 ? "plus" : diff > 25 ? "minus" : ""}">${diff > 0 ? "+" : ""}${diff} % zum Kurs</em></span>
                <b>${fmt(l.price)}<span class="meta"> · ${fk(l.price / l.count)} je Aktie</span></b>${shKaufZeile(l)}</div>`; }).join("")}</div>` : ""}
          ${p.id !== myId && (p.ownPct ?? 0) > 0 ? `<button type="button" class="mini bAnfrage" data-zu-handeln="${p.id}">Kaufanfrage an ${p.name} stellen</button>` : ""}
          <div class="meta" style="padding-top:4px">${p.ausschuettung != null ? `${p.name} schüttet fest ${fmt(p.ausschuettung)}` : `Ausgeschüttet werden ${Math.round((store.get().meta?.dividendRate ?? 0) * 100)} % des Umsatzes`} je ${takt} Minuten, verteilt auf ${AKTIEN_JE_FIRMA()} Aktien. Der Kurs folgt dem Wert F mit Verzögerung.</div>
        </div>` : "");
      }).join("");
    document.querySelectorAll("[data-firm]").forEach(el => el.addEventListener("click", () => {
      const id = el.dataset.firm;
      firmenAuf.has(id) ? firmenAuf.delete(id) : firmenAuf.add(id);
      SFX.spiel("klick");
      render(store.get());
    }));

    /* Angebote */
    const mine = state.shareListings.filter(l => l.sellerId === myId);
    const toMe = state.shareListings.filter(l => l.sellerId !== myId && l.toId === myId);
    const open = state.shareListings.filter(l => l.sellerId !== myId && !l.toId);
    const priceTag = l => {
      const co = state.players[l.companyId];
      const fair = co ? (co.kurs || 0) * l.count : 0;
      if (!fair) return "";
      const diff = Math.round((l.price / fair - 1) * 100);
      const col = diff <= 0 ? "var(--up)" : diff > 25 ? "var(--down)" : "var(--dim)";
      return ` · <span style="color:${col}">${diff > 0 ? "+" : ""}${diff} % zum Kurs</span>`;
    };
    const offerRow = l => `<div class="bond">
      <div><b>${l.company}</b><div class="meta">${l.count} Aktien · ${l.isIssue ? "Emission der Firma" : `von ${l.seller}`}${priceTag(l)}</div></div>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--mono)">${fmt(l.price)}<span class="meta"> · ${fk(l.price / l.count)} je Aktie</span></span>
      ${shKaufZeile(l)}</div></div>`;
    document.getElementById("sharelist").innerHTML =
      (mine.length ? `<div class="sec">Deine Angebote</div>` + mine.map(l =>
        `<div class="bond"><div><b>${l.company}</b><div class="meta">${l.count} Aktien für ${fmt(l.price)}${l.toId ? ` · nur für ${l.toName}` : " · offener Markt"}</div></div>
         <button class="mini" data-shcancel="${l.id}">${t("Storno")}</button></div>`).join("") : "") +
      (toMe.length ? `<div class="sec">Nur für dich</div>` + toMe.map(offerRow).join("") : "") +
      `<div class="sec bTafelKopf"><span>Kurstafel</span><span class="meta">${open.length ? `${open.length} offene Angebote — Firma antippen` : "keine offenen Angebote"}</span></div>`;
    /* Branchen-ETFs: Index je Branche (Kurse gewichtet nach Wert F, Start 100) */
    const etfs = state.etf || [];
    document.getElementById("etfboard").innerHTML = etfs.length ? `<div class="sec bTafelKopf"><span>Branchen-ETFs</span><span class="meta">ein Kauf streut über alle Firmen der Branche</span></div>` +
      etfs.map(e => {
        const h = e.verlauf || [], seit = h.length > 1 ? (h[h.length - 1] / h[0] - 1) * 100 : null;
        const meins = (me.etf || []).find(x => x.branche === e.branche);
        return `<div class="bond etfrow">
          <div style="min-width:0;flex:1"><b>${e.name}-Fonds</b>
            <div class="meta">Fondswert ${fmt(e.wert || 0)} · davon flüssig ${fmt(e.kasse || 0)}${e.ausschuettung ? ` · <span style="color:var(--up)">zuletzt ${fmt(e.ausschuettung)} ausgeschüttet</span>` : ""}${(e.aktien || []).length ? ` · hält ${e.aktien.map(a => `${a.aktien} ${a.firma}`).join(", ")}` : " · noch keine Aktien"}${meins ? ` · <b style="color:var(--accent)">du: ${fmt(meins.wert)}</b>` : ""}</div></div>
          <span style="display:flex;align-items:center;gap:8px">
            ${h.length > 1 ? sparklineVon(h, 52, 16) : ""}
            <span class="fpreis">${(e.preis || 0).toFixed(1)}${seit == null ? "" : ` <em class="${seit >= 0 ? "plus" : "minus"}" style="font-size:11px">${seit >= 0 ? "+" : ""}${seit.toFixed(1)} %</em>`}</span>
            <input type="number" class="etfBetrag" data-etf-betrag="${e.branche}" min="100" step="100" placeholder="$" style="width:84px">
            <button class="buyb" data-etf-kauf="${e.branche}">Kaufen</button>
          </span></div>`; }).join("") +
      `<div class="meta" style="padding-top:4px">Jede Branche hat einen Fonds. Dein Geld kauft echte Aktien der Firmen dieser Branche (gewichtet nach Wert F) — das hebt ihre Kurse. Anteilspreis = Fondswert ÷ Anteile, Start 100. Auszahlen kann der Fonds nur aus seiner Kasse; ist sie knapp, bietet er Aktien an. ${Math.round((store.get().meta?.fondsAusschuettung ?? 0.8) * 100)} % der Dividenden seiner Aktien schüttet er alle 10 Minuten an die Anteilseigner aus. 1 % Gebühr je Kauf und Verkauf.</div>` : "";
    document.getElementById("depotboard").innerHTML = depotKarte(state.depot);
    /* Marktgeschehen: Käufe, Verkäufe, Ausschüttungen, Bauten, Flauten, Panik */
    const mlog = (state.marktLog || []).slice(0, 8);
    document.getElementById("marktlog").innerHTML = mlog.length
      ? `<div class="sec">Marktgeschehen</div>` + mlog.map(e => `<div class="mlog ${e.art}"><span class="meta">min ${Math.floor(e.tick / 60)}</span> ${e.text}</div>`).join("")
      : "";

    /* Kaufanfragen: Zielauswahl, eingegangene Anfragen, eigene laufende Anfragen */
    const bidCo = document.getElementById("bidCompany"), bidCoPrev = bidCo.value;
    const targets = Object.values(state.players).filter(p => p.id !== myId && p.ownPct > 0);
    bidCo.innerHTML = targets.map(p => `<option value="${p.id}">${p.name} (hält ${Math.round(p.ownPct * AKTIEN_JE_FIRMA() / 100)} eigene Aktien)</option>`).join("")
      || `<option value="">Keine Firma hält noch eigene Aktien</option>`;
    if (targets.some(p => p.id === bidCoPrev)) bidCo.value = bidCoPrev;
    const bidTarget = targets.find(p => p.id === bidCo.value);
    const bidCount = +document.getElementById("bidCount").value || 1;
    document.getElementById("bidHint").textContent = bidTarget
      ? `Kurs ${fk(bidTarget.kurs || 0)} je Aktie → ${bidCount} Aktien ≈ ${fmt((bidTarget.kurs || 0) * bidCount)}. Darunter lehnen die meisten ab.`
      : "Alle Firmen haben ihre eigenen Aktien bereits vollständig abgegeben.";

    const bids = state.shareBids || [];
    const bidsToMe = bids.filter(b => b.companyId === myId);
    const myBids = bids.filter(b => b.bidderId === myId);
    document.getElementById("bidlist").innerHTML =
      (bidsToMe.length ? `<div class="sec">Anfragen an dich</div>` + bidsToMe.map(b => `<div class="bond">
        <div><b>${b.bidder}</b><div class="meta">will ${b.count} Aktien deiner Firma · zum Kurs ${fmt((me.kurs || 0) * b.count)} · noch ${b.ttl}s</div></div>
        <div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--mono)">${fmt(b.price)}</span>
        <button class="buyb" data-bidok="${b.id}">Annehmen</button>
        <button class="mini" data-bidno="${b.id}">Ablehnen</button></div></div>`).join("") : "") +
      (myBids.length ? `<div class="sec">Deine Anfragen</div>` + myBids.map(b => `<div class="bond">
        <div><b>${b.company}</b><div class="meta">${b.count} Aktien für ${fmt(b.price)} · wartet auf Antwort · noch ${b.ttl}s</div></div>
        <button class="mini" data-bidcancel="${b.id}">Zurückziehen</button></div>`).join("") : "");

    document.getElementById("bReiterHandeln").textContent = bidsToMe.length ? bidsToMe.length : "";
    document.getElementById("bReiterDepot").textContent = me.portfolio?.length ? me.portfolio.length : "";
    kurswettenRendern();
    bankReiterZeigen();
    /* Depot: was man an fremden Firmen hält, mit aktuellem Wert */
    document.getElementById("bankdepot").innerHTML = me.portfolio?.length
      ? me.portfolio.map(h => {
          const mergeUi = h.pct < 100 ? ""
            : pendingMerge === h.id
              ? `<span class="meta" style="align-self:center">Gebäude, Kapital und Lager gehen an dich über.</span>
                 <button class="buyb" data-merge-yes="${h.id}">Ja, übernehmen</button>
                 <button class="mini" data-merge-no="1">Abbrechen</button>`
              : `<button class="buyb" data-merge="${h.id}">Fusionieren</button>`;
          /* Gewinn/Verlust gegen den Einstand. Der aktuelle Wert allein sagt
           * nicht, ob sich die Beteiligung gelohnt hat — genau das ist aber
           * die Frage beim Verkaufen. */
          const gv = h.einstand > 0 ? h.value - h.einstand : null;
          const gvFarbe = gv == null ? "var(--dim)" : gv >= 0 ? "var(--up)" : "var(--down)";
          const gvProz = h.einstand > 0 ? (h.value / h.einstand - 1) * 100 : null;
          return `<div class="bond">
            <div style="min-width:0">${firmenMarke(h.company, "var(--text)", 38)}${h.pct >= 100 ? ` <b style="color:var(--accent)">· bereit zur Fusion</b>` : ""}
              <div class="depotzahlen">
                <span>${h.count} Aktien (${h.pct} %)</span>
                <span>Einstand <b>${h.einstand > 0 ? fmt(h.einstand) : "—"}</b></span>
                <span>zum Kurs <b>${fmt(h.value)}</b></span>
                <span class="meta">Buchwert ${fmt(h.buchwert || 0)}</span>
                ${gv == null ? "" : `<span style="color:${gvFarbe}">${gv >= 0 ? "+" : "−"}${fmt(Math.abs(gv))} (${gvProz >= 0 ? "+" : ""}${gvProz.toFixed(0)} %)</span>`}
              </div></div>
            <div style="display:flex;gap:5px">${mergeUi}</div></div>`;
        }).join("") + (() => {
          /* Depotsumme: Einzelposten sagen nichts darueber, wie das Depot als
           * Ganzes steht — und das ist die Zahl, die man mit dem Bargeld
           * vergleicht. */
          const einst = me.portfolio.reduce((a, h) => a + (h.einstand || 0), 0);
          const wert  = me.portfolio.reduce((a, h) => a + (h.value || 0), 0);
          const gv = einst > 0 ? wert - einst : null;
          return `<div class="depotsumme">
            <span>Portfoliowert</span>
            <span><b>${fmt(wert)}</b>${einst > 0 ? ` <span class="meta">Einstand ${fmt(einst)}</span>` : ""}
              ${gv == null ? "" : `<b style="color:${gv >= 0 ? "var(--up)" : "var(--down)"}">${gv >= 0 ? "+" : "−"}${fmt(Math.abs(gv))}</b>`}</span></div>`;
        })()
      : `<span class="meta">Du hältst keine fremden Aktien. Kauf welche — liegt der Kurs unter dem Wert F, holt er meist auf, und du kannst teurer weiterverkaufen.</span>`;
    /* ETF-Bestände */
    if ((me.etf || []).length) document.getElementById("bankdepot").insertAdjacentHTML("beforeend",
      `<div class="sec">Branchen-ETFs</div>` + me.etf.map(x => {
        const gv = x.einstand > 0 ? x.wert - x.einstand : null;
        return `<div class="bond"><div><b>${x.name}-Fonds</b><div class="depotzahlen"><span>${x.anteile} Anteile</span>
          <span>Einstand <b>${fmt(x.einstand)}</b></span><span>zum Kurs <b>${fmt(x.wert)}</b></span><span class="meta">Buchwert ${fmt(x.buchwert || 0)}</span>
          ${gv == null ? "" : `<span style="color:${gv >= 0 ? "var(--up)" : "var(--down)"}">${gv >= 0 ? "+" : "−"}${fmt(Math.abs(gv))}</span>`}</div></div>
          <div style="display:flex;gap:5px"><button class="mini" data-etf-verkauf="${x.branche}" data-anteil="0.5">Hälfte</button><button class="buyb" data-etf-verkauf="${x.branche}" data-anteil="1">Verkaufen</button></div></div>`; }).join(""));
  }

  /* Firmen-Dashboard: Kennzahlen oben, Verlauf, Bilanz; Details eingeklappt.
   * Fehlende Werte (z. B. vor dem ersten Server-Update) zeigen „—" statt $NaN. */
  if (document.getElementById("p-firma").classList.contains("open") && !typingIn(document.getElementById("p-firma"))) {
    const bal = me.balance || {};
    const geld = v => (v == null || isNaN(v)) ? "—" : fmt(v);
    const nRank = my?.rank ?? "—", nPlayers = Object.keys(state.players).length;
    const h = me.nwHist?.length > 1 ? me.nwHist : [bal.total || 0, bal.total || 0];
    const min = Math.min(...h), max = Math.max(...h), span = Math.max(1, max - min);
    const pts = h.map((v, i) => `${(i / (h.length - 1) * 380).toFixed(1)},${(60 - (v - min) / span * 52 + 4).toFixed(1)}`).join(" ");
    const zeile = (label, val, neg, cls = "") => `<tr class="${cls}"><td>${label}</td><td class="betrag${neg ? " minus" : ""}">${neg && val ? "− " : ""}${geld(val == null ? val : Math.abs(val))}</td></tr>`;
    const sales = Object.entries(me.sales || {});
    const tx = me.tx || [];
    let alleTx = false; try { alleTx = sessionStorage.getItem("cs_tx_alle") === "1"; } catch {}
    const offen = id => LEX_OFFEN.has(id) ? "open" : "";
    const eigenesBild = logoBild(myId);
    const programme = (state.paint || []).filter(x => x.version >= 1 && x.ownerId !== myId);
    const logoBox = `<div class="fLogo">
      ${eigenesBild ? `<img src="${eigenesBild}" alt="Dein Logo">` : `<span class="fLogoLeer" style="background:${my?.color || "#64748b"}">${rohText(my?.name || "?").slice(0, 1)}</span>`}
      <div><b>Firmenlogo</b>
        ${me.paintStufe ? `<small>Mit ${escapeHtml(rohText(me.paintStufe.programm))} v${me.paintStufe.version} · bis ${me.paintStufe.groesse}×${me.paintStufe.groesse} Pixel</small>
          <button class="mini" data-malen>🎨 ${eigenesBild ? "Logo bearbeiten" : "Logo malen"}</button>`
        : `<small>${programme.length ? "Kaufe eine Malprogramm-Lizenz im Online-Shop einer Software-Firma, dann malst du dein Logo selbst." : "Noch bietet keine Software-Firma ein Malprogramm an."}</small>
          <span class="mpZeile">${programme.map(x => { const l = x.laeden.find(l2 => l2.offen); return l ? `<button class="mini" data-shopauf="${l.x},${l.y}">🛒 ${x.name} · ${fmt(x.preis)}</button>` : `<span class="meta">${x.name} — Shop zu</span>`; }).join("")}</span>`}
      </div></div>`;
    document.getElementById("firmabody").innerHTML = logoBox + `
      <div class="fKennzahlen">
        <div><span>Rang</span><b>#${nRank}</b><small>von ${nPlayers}</small></div>
        <div class="haupt"><span>Nettovermögen</span><b>${geld(bal.total)}</b><small>Ziel ${geld(state.winGoal)}</small></div>
        <div><span>Rating</span><b>${my?.rating ?? "—"}</b><small>Level ${me.lvl ?? me.level ?? "—"}</small></div>
      </div>
      <div class="fVerlauf">
        <svg viewBox="0 0 380 64" preserveAspectRatio="none" role="img" aria-label="Verlauf des Unternehmenswerts">
          <polyline points="${pts}" fill="none" stroke="var(--up)" stroke-width="2"/>
          <polyline points="${pts} 380,64 0,64" fill="rgba(79,195,106,.12)" stroke="none"/>
        </svg>
        <div class="meta fAchse"><span>${geld(min)}</span><span>Unternehmenswert · 20 min</span><span>${geld(max)}</span></div>
      </div>
      <div class="sec">Bilanz</div>
      <table class="fBilanz">
        ${zeile("Bargeld", bal.cash)}
        ${zeile("Warenlager (Marktwert)", bal.invVal)}
        ${zeile("Gebäude", bal.bldVal)}
        ${bal.markenwert ? zeile("Markenwert (Software)", bal.markenwert) : ""}
        ${bal.bondVal ? zeile("Anleihen", bal.bondVal) : ""}
        ${bal.debtVal ? zeile("Verbindlichkeiten", bal.debtVal, true) : ""}
        ${zeile("Firmenwert", bal.firmVal, false, "summe")}
        ${(bal.ownShare ?? 1) < 1 ? zeile(`davon dein Anteil (${Math.round((bal.ownShare ?? 1) * 100)} %)`, (bal.firmVal || 0) * (bal.ownShare ?? 1)) : ""}
        ${bal.holdings ? zeile("Beteiligungen (Buchwert)", bal.holdings) : ""}
        ${zeile("Nettovermögen", bal.total, false, "gesamt")}
      </table>
      <div class="fZinsen">
        <div><span>Zinserträge</span><b class="plus">${geld(me.fin?.zinsErtrag || 0)}</b></div>
        <div><span>Zinsausgaben</span><b class="${me.fin?.zinsAufwand ? "minus" : ""}">${me.fin?.zinsAufwand ? "− " : ""}${geld(me.fin?.zinsAufwand || 0)}</b></div>
      </div>
      ${lohnHtml(me, state)}
      ${ruestHtml(me, state, my)}
      <div class="sec">Deine Aktie</div>
      <div class="fAktie">
        <div><span>Kurs</span><b>${fk(me.kurs ?? 0)}</b></div>
        <div><span>Wert F je Aktie</span><b>${fk(me.fundament ?? 0)}</b></div>
        <div><span>Eigene Aktien</span><b>${me.ownAktien ?? 0}<small>/${me.aktien ?? 100}</small></b></div>
      </div>
      <div class="meta" style="padding:2px 0 8px">${lueckeHtml(me.luecke)} — der Kurs folgt dem Wert F mit ein paar Minuten Verzögerung. F = Buchwert + Ertrag der letzten 10 min.</div>
      <div class="fAusschuettung">
        <div class="meta">Ausschüttung je ${Math.round((store.get().meta?.dividendInterval ?? 600) / 60)} min:
          <b>${me.ausschuettung == null ? `automatisch ${Math.round((store.get().meta?.dividendRate ?? 0) * 100)} % des Umsatzes` : me.ausschuettung ? `fest ${fmt(me.ausschuettung)}` : "ausgesetzt"}</b>.
          Gezahlt wird an alle Aktionäre nach Anteil — was auf deine eigenen Aktien entfiele, bleibt in der Firma. Jede Ausschüttung senkt den Wert F um genau den Betrag.</div>
        <div class="fAusZeile">
          <button type="button" class="mini${me.ausschuettung == null ? " on" : ""}" data-aus-auto>Automatisch</button>
          <input type="number" id="ausBetrag" min="0" step="100" placeholder="Betrag $" value="${me.ausschuettung ?? ""}">
          <button type="button" class="buyb" data-aus-setzen>Festlegen</button>
        </div>
      </div>
      <details class="fMehr" data-lex="f-verkauf" ${offen("f-verkauf")}><summary>Verkäufe je Ware <span>${sales.length}</span></summary>
      ${sales.length ? `<table><tr><th>Ware</th><th>an Stadt</th><th>an Spieler</th><th>Einkäufe</th></tr>` +
        sales.map(([g, s]) => `<tr><td>${gname(g)}</td>
          <td>${s.botQty || 0}× · ${fmt(s.botRev || 0)}</td>
          <td>${s.playerQty || 0}× · ${fmt(s.playerRev || 0)}</td>
          <td>${s.buyQty || 0}× · ${fmt(s.buyCost || 0)}</td></tr>`).join("") + "</table>"
        : `<p class="meta">Noch keine Verkäufe.</p>`}
      </details>
      <details class="fMehr" data-lex="f-tx" ${offen("f-tx")}><summary>Bewegungen <span>${tx.length}</span></summary>
      ${tx.length ? `<table>` + (alleTx ? tx : tx.slice(0, 8)).map(x => `<tr>
          <td><span class="meta">${x.cat}</span> ${x.text}</td>
          <td class="betrag ${x.amt >= 0 ? "plus" : "minus"}">${x.amt >= 0 ? "+" : "−"} ${fmt(Math.abs(x.amt))}</td>
        </tr>`).join("") + "</table>"
        + (tx.length > 8 ? `<button type="button" class="qMehr" data-tx-alle>${alleTx ? "Weniger anzeigen" : `Alle ${tx.length} anzeigen`}</button>` : "")
        : `<p class="meta">Noch keine Bewegungen — baue, handle oder erfülle Vertriebsaufträge.</p>`}
      </details>`;
  }

  /* Lexikon: Suche + einklappbare Gruppen (eigene Branche offen) + kompakte
   * Gebäudekarten. Offene Gruppen bleiben über Aktualisierungen hinweg offen. */
  if (document.getElementById("p-lexikon").classList.contains("open")) {
    const B = BTYPES(), avg = state.avg || {};
    const ZNAME = { agrar: "Agrar", zentrum: "Zentrum", industrie: "Industrie · $2.500/Kachel", kueste: "Küste · $12.000/Kachel" };
    const INAME = { agrar: "Agrar", rohstoff: "Rohstoff & Bau", versorger: "Versorger", tech: "Technologie", touristik: "Touristik", ruestung: "Rüstung", software: "Software" };
    const kartell = store.get().state?.mode === "kartell";
    const suche = (LEX_SUCHE || "").trim().toLowerCase();
    const r2 = n => (+(+n).toFixed(2)).toLocaleString("de-DE");   // 0.333333 → 0,33
    const bcard = (bid) => {
      const b = B[bid]; if (!b) return "";
      if (suche && !(`${b.name} ${b.out ? gname(b.out) : ""} ${b.proc ? gname(b.proc.out) + " " + Object.keys(b.proc.in).map(gname).join(" ") : ""}`.toLowerCase().includes(suche))) return "";
      let was = "", mehr = "";
      if (b.out) { was = `→ <b>${gname(b.out)}</b> ${r2(b.rate)}/s`;
        if (b.boosts) mehr = `Boost: je 1 ${b.boosts.map(r => gname(r)).join(" / ")}/s aus dem Lager → +75 % (beides = ×2,5).`; }
      else if (b.proc) { was = `${Object.entries(b.proc.in).map(([g, n]) => `${r2(n)} ${gname(g)}`).join(" + ")} → <b>${r2(b.proc.rate)} ${gname(b.proc.out)}</b>/s`;
        mehr = "Läuft automatisch, solange die Zutaten im Lager sind."; }
      else if (b.ad) { was = "<b>Werbekampagnen</b>";
        mehr = "Reichweite hebt den Preis, den deine Läden ohne Tempoverlust verlangen können — bis +20 % mit einer Agentur, je weitere +10 % (max. +40 %). Ohne neue Kampagne nach gut zwei Minuten wieder beim Ø-Kurs."; }
      else if (b.online) { was = `<b>${b.retail.slots} Regale</b> · alles außer Fahrzeugen und Waffen`;
        mehr = "Verkauft erst, wenn ein Shop-System installiert ist — von einer Software-Firma oder das Stadtportal (8 % je Verkauf). Das System bestimmt Tempo, Gebühr und ob es ein Werbemodul gibt."; }
      else if (b.retail) { was = `<b>${b.retail.slots} Regal${b.retail.slots > 1 ? "e" : ""}</b> · ${b.retail.goods.map(g => gname(g)).join(", ")}`;
        mehr = "Du setzt den Preis: Ø-Kurs = volle Rate, teurer verkauft langsamer, billiger schneller (max. ×2). Einrichten per Klick aufs Gebäude."; }
      else if (b.racing) { was = "<b>Motorsport</b> · Garage für Rennwagen"; }
      else if (b.studio) { was = `${Object.entries(b.studio.in).map(([g, n]) => `${r2(n)} ${gname(g)}`).join(" + ")} → <b>${r2(b.studio.ep)} EP</b>/s`;
        mehr = "Entwicklungspunkte für dein Shop-System: Version 1 kostet 150 EP plus Module, jede weitere 60 EP plus neue Module."; }
      else if (b.rz) { was = `${r2(b.rz.in.strom)} ${gname("strom")}/s → <b>${b.rz.plaetze} Kunden</b> je Stufe`;
        mehr = "Trägt die Online-Marktplätze, die dein System nutzen. Mehr Kunden als Plätze bremst alle; ohne Strom fällt das System aus."; }
      const chips = [
        ZNAME[b.zone] || b.zone,
        kartell ? "bar bezahlt" : `${Math.ceil(b.cost / 400)} Ziegel${b.cost >= 4000 && b.proc?.out !== "beton" ? ` + ${Math.ceil(b.cost / 2000)} Beton` : ""}`,
        (b.out || b.proc) ? "auflevelbar" : "",
        !kartell && b.industry ? `nur ${INAME[b.industry] || b.industry}` : "",
      ].filter(Boolean);
      return `<div class="lexKarte">
        <img src="${spriteUrl(bid, 0, 0) || `assets/${bid}-0.png`}" alt="">
        <div class="lexText">
          <div class="lexKopf"><b>${bname(bid)}</b><span class="lexPreis">${fmt(b.cost)}</span></div>
          ${was ? `<div class="lexWas">${was}</div>` : ""}
          <div class="lexChips">${chips.map(c => `<span>${c}</span>`).join("")}</div>
          ${mehr ? `<div class="lexMehr">${mehr} Abriss erstattet ${fmt(b.cost * .5)}.</div>` : ""}
        </div></div>`;
    };
    const meineInd = store.get().state?.players?.[myId]?.industry;
    const GRUPPEN = [
      ["agrar", "Agrarwirtschaft", ["farm","plantage","imkerei","saftpresse","pharma","baeckerei"]],
      ["rohstoff", "Rohstoff & Bau", ["mine","ziegelei","stahlwerk","betonwerk","reifenwerk"]],
      ["versorger", "Versorger: Wasser, Strom & Öl", ["brunnen","wasserwerk","ewerk","windpark","oelpumpe","raffinerie"]],
      ["tech", "Technologie & Elektronik", ["siliziummine","chipfabrik","autowerk","dieselwerk","eautowerk","rennlabor"]],
      ["touristik", "Touristik", ["campingplatz","strandhotel"]],
      ["ruestung", "Rüstung", ["munitionsfabrik","waffenschmiede","panzerwerk"]],
      ["software", "Software & Digitales", ["entwicklerstudio","rechenzentrum"]],
      ["laden", "Verkauf (jede Branche)", ["onlinemarkt", ...(state.mode === "sandbox" ? [] : ["werbeagentur"])]],
      ["renn", "Motorsport", ["rennstall"]],
    ];
    const gruppe = ([id, titel, ids]) => {
      const karten = ids.map(bcard).join("");
      if (!karten) return "";
      const auf = suche || LEX_OFFEN.has("lex-" + id) || (!LEX_OFFEN.size && id === meineInd);
      return `<details class="lexGruppe" data-lex="lex-${id}" ${auf ? "open" : ""}><summary>${titel}<span>${ids.filter(i => B[i]).length}</span></summary>${karten}</details>`;
    };
    const suchFeld = document.getElementById("lexSuche");
    if (!suchFeld) {
      document.getElementById("lexbody").insertAdjacentHTML("beforebegin",
        `<div class="lexSucheZeile"><input id="lexSuche" type="search" placeholder="Gebäude oder Ware suchen …" aria-label="Lexikon durchsuchen"></div>`);
      document.getElementById("lexSuche").addEventListener("input", e => { LEX_SUCHE = e.target.value; store.set({}); });
    }
    document.getElementById("lexbody").innerHTML = GRUPPEN.map(gruppe).join("")
      + (suche ? "" : `
      <details class="lexGruppe" data-lex="lex-waren" ${LEX_OFFEN.has("lex-waren") ? "open" : ""}><summary>Waren & aktuelle Ø-Kurse<span>${Object.keys(GOODS()).length}</span></summary>
      <div class="sec">Waren &amp; aktuelle Ø-Kurse</div>
      <table><tr><th>Ware</th><th>Kategorie</th><th>Ø-Kurs</th></tr>
      ${Object.entries(GOODS()).map(([k]) => `<tr><td>${gname(k)}</td><td>${catname(k)}</td><td>${fmt(avg[k] ?? 0)}</td></tr>`).join("")}</table>
      <p class="meta">Kurse regeln sich selbst: Überangebot drückt den Anker bis −50 %, Knappheit hebt ihn bis +30 %. Kurzfristige Schwankung max. ±$5.</p>
      </details>
      ${stadtLexikon()}
      <details class="lexGruppe" data-lex="lex-regeln" ${LEX_OFFEN.has("lex-regeln") ? "open" : ""}><summary>Regeln kompakt<span>2</span></summary>
      <div class="sec">Geld verdienen — die Rangfolge</div>
      <table>
        <tr><td>Großauftrag</td><td style="text-align:right">Ø-Kurs <b style="color:var(--accent)">×2 fixiert</b></td></tr>
        <tr><td>Verarbeiten &amp; verkaufen</td><td style="text-align:right">Wertschöpfung (z. B. Obst → Saft)</td></tr>
        <tr><td>Shops (eigener Preis)</td><td style="text-align:right">dein Preis, Tempo folgt</td></tr>
        <tr><td>Markt-Bot (Börse)</td><td style="text-align:right">≈ Ø-Kurs, sofort</td></tr>
        <tr><td>P2P-Börse &amp; Direktverträge</td><td style="text-align:right">Verhandlungssache</td></tr>
        <tr><td>Anleihen &amp; Auktionen</td><td style="text-align:right">Zinsen / Schnäppchen</td></tr>
      </table>
      <div class="sec">Finanzen kompakt</div>
      <div class="meta" style="line-height:1.6">Anleihen: selbst emittieren bringt Sofort-Kapital; Kupon läuft pro Sekunde. <b style="color:var(--down)">3 verpasste Zahlungen → Pfandrecht, 15 → Zwangsversteigerung</b> (Erlös an den Gläubiger, Startgebot 30 % des Neuwerts). Rating AAA–D entsteht aus Verschuldungsgrad und Firmengröße. Sieg: Rundenziel-Nettovermögen = Cash + Lager (Ø-Kurs) + 70 % Gebäudewert + Anleihen − Schulden.</div>
      </details>`);
  }

  /* Chat */
  if (document.getElementById("p-chat").classList.contains("open")) {
    const log = document.getElementById("chatlog");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = (chat[room] || []).map(m =>
      `<div class="msg"><span class="who" style="color:${m.color}">${m.who}</span>${m.text}</div>`).join("")
      || `<span class="meta">Noch keine Nachrichten in ${room}.</span>`;
    if (atBottom) log.scrollTop = log.scrollHeight;
    document.getElementById("cTo").innerHTML = Object.values(state.players)
      .filter(p => p.id !== myId).map(p => `<option value="${p.id}">${p.name}</option>`).join("")
      || `<option disabled>Keine Mitspieler</option>`;
  }
}
store.subscribe(render);

/* ================================================================
 * Ausführliches Tutorial (Startbildschirm)
 * ================================================================
 * Bewusst getrennt vom kurzen Tutorial in der laufenden Partie: Das dort führt
 * Schritt für Schritt durchs erste Bauen, das hier erklärt die Systeme dahinter
 * und ist auch ohne Runde lesbar. Die Zahlen entsprechen den Werten in
 * server.js — das Lexikon im Spiel zeigt sie zusätzlich live. */
const TUT_BUCH = [
  { t: "Worum es geht", lead: "Das Ziel in einem Satz",
    html: `
      <p>Du führst eine Firma in einer gemeinsamen Stadt. Du baust Betriebe, stellst Waren
      her und verkaufst sie — an die Stadt, an eure Läden oder direkt an die Mitspieler.
      Wer als Erster das <b>Rundenziel</b> beim Nettovermögen erreicht, gewinnt.</p>
      <div class="kasten"><div class="t">Nettovermögen</div>
      Bargeld + Warenlager (zum aktuellen Kurs) + Gebäude (70 % vom Baupreis)
      + gehaltene Anteile − Schulden. Oben links siehst du deinen Stand.</div>
      <p>Es gibt <b>keine künstlichen Preise</b>. Jeder Kurs entsteht aus echten
      Geschäften zwischen euch. Wenn alle dasselbe verkaufen, fällt der Preis — und
      wenn eine Ware knapp wird, steigt er.</p>
      <div class="merk">Der Host stellt Rundenziel und Bots im Warteraum ein.
      Von 100.000 $ (etwa eine Stunde) bis 10 Mio. $ (Marathon).</div>`,
    en: { t: "What it's about", lead: "The goal in one sentence", html: `
      <p>You run a company in a shared city. You build plants, make goods and sell them —
      to the city, through your own shops, or directly to the other players.
      Whoever reaches the <b>round target</b> in net worth first wins.</p>
      <div class="kasten"><div class="t">Net worth</div>
      Cash + inventory (at the current rate) + buildings (70 % of build cost)
      + shares held − debt. You can see yours at the top left.</div>
      <p>There are <b>no artificial prices</b>. Every rate comes out of real deals between
      you. If everyone sells the same thing the price falls — and when a good gets scarce
      it rises.</p>
      <div class="merk">The host sets the round target and the bots in the lobby.
      From $100,000 (about an hour) up to $10M (a marathon).</div>` } },

  { t: "Deine Branche", lead: "Warum du nicht alles selbst bauen kannst",
    html: `
      <p>Beim Beitritt wählst du <b>eine Branche</b>. Du kannst nur deren
      Betriebe bauen — alles andere musst du einkaufen. Das ist der Kern des Spiels:
      Ihr seid aufeinander angewiesen.</p>
      <ul>
        <li><b>Landwirtschaft</b> — Obst, Kannabis, Honig; daraus Saft, Gebäck und Medikamente</li>
        <li><b>Rohstoff &amp; Bau</b> — Erze; daraus Ziegel, Beton und Stahl</li>
        <li><b>Wasser, Strom &amp; Öl</b> — die Grundversorgung, die jeder ständig braucht</li>
        <li><b>Technologie</b> — Silizium, Elektronik und die drei Autowerke</li>
        <li><b>Touristik</b> — macht aus Wasser und Strom Übernachtungen</li>
        <li><b>Rüstung</b> — Munition, Pistolen und Panzer am Ende jeder Kette</li>
      </ul>
      <div class="merk">Läden darf jede Branche bauen — verkaufen kann also jeder.</div>
      <p>Ohne die Bauindustrie stehen alle still: <b>Jedes Gebäude kostet Ziegel</b>,
      teure zusätzlich Beton. Und ohne Technologie gibt es keine Elektronik, ohne die
      niemand seine Betriebe hochstufen kann.</p>`,
    en: { t: "Your industry", lead: "Why you cannot build everything yourself", html: `
      <p>When you join you pick <b>one industry</b>. You can only build its plants —
      everything else you have to buy. That is the heart of the game:
      you depend on each other.</p>
      <ul>
        <li><b>Agriculture</b> — fruit, cannabis, honey; from those juice, pastry and medicine</li>
        <li><b>Raw materials &amp; construction</b> — ore; from it bricks, concrete and steel</li>
        <li><b>Water, power &amp; oil</b> — the basics everyone needs all the time</li>
        <li><b>Technology</b> — silicon, electronics and the three car plants</li>
        <li><b>Tourism</b> — turns water and power into lodging</li>
        <li><b>Armament</b> — ammunition, pistols and tanks, at the end of every chain</li>
      </ul>
      <div class="merk">Shops may be built by any industry — so everyone can sell.</div>
      <p>Without the construction industry everyone stalls: <b>every building costs
      bricks</b>, expensive ones also concrete. And without technology there are no
      electronics, without which nobody can upgrade their plants.</p>` } },

  { t: "Bauen &amp; Zonen", lead: "Wo was hindarf",
    html: `
      <p>Die Karte hat vier Zonen, erkennbar an der Farbe. Jeder Betrieb gehört in eine
      bestimmte: Farmen aufs Grüne, Fabriken ins Industriegebiet, Läden ins Zentrum,
      Ölpumpen an die Küste.</p>
      <div class="kasten"><div class="t">Sperrzonen</div>
      Industrie und Küste sind anfangs gesperrt. Eine Kachel dort freizuschalten kostet
      extra — das wird beim Bauen automatisch mitbezahlt. Das Zentrum und die Agrarflächen
      sind frei bebaubar.</div>
      <p>Zum Bauen klickst du eine freie Kachel an und wählst den Betrieb. Du brauchst
      genug Bargeld <b>und</b> das Baumaterial im Lager. Fehlen Ziegel, kauf sie an der
      Börse — die Bauindustrie stellt sie dort ein.</p>
      <p>Ein Abriss erstattet dir <b>die Hälfte</b> des Baupreises zurück.</p>`,
    en: { t: "Building &amp; zones", lead: "What goes where", html: `
      <p>The map has four zones, told apart by colour. Every plant belongs in a specific
      one: farms on the green, factories in the industrial area, shops in the centre,
      oil pumps on the coast.</p>
      <div class="kasten"><div class="t">Locked zones</div>
      Industry and coast start out locked. Unlocking a tile there costs extra — it is
      billed together with the build. The centre and the farmland are open from the
      start.</div>
      <p>To build, click a free tile and pick the plant. You need enough cash <b>and</b>
      the material in your inventory. If bricks are missing, buy them on the exchange —
      the construction industry puts them up there.</p>
      <p>Demolishing refunds <b>half</b> the build cost.</p>` } },

  { t: "Freischalten &amp; Ausbauen", lead: "Mehr Fläche, mehr Ausstoß",
    html: `
      <p>Nicht jede Kachel ist von Anfang an bebaubar. Gesperrte Flächen liegen dunkler
      auf der Karte und kosten eine einmalige <b>Freischaltgebühr</b>, die dir beim Bauen
      gleich mitberechnet wird — du zahlst also Gebäude und Freischaltung in einem Zug.</p>
      <p>Jedes Produktionsgebäude lässt sich mit <b>Elektronik</b> auf bis zu
      <b>Stufe 5</b> ausbauen. Jede Stufe bringt <b>+30 % Ausstoß</b> — und verbraucht
      entsprechend mehr Zutaten, denn auch der Verbrauch steigt mit.</p>
      <div class="kasten"><div class="t">Was ein Ausbau kostet</div>
      Elektronik und Bargeld, beides steigt mit der erreichten Stufe. Ein billiges
      Gebäude auf Stufe 2 ist schnell bezahlt, Stufe 5 an einem teuren Werk ist eine
      Investition wie ein zweites Gebäude.</div>
      <p>Elektronik stellst du nicht selbst her, wenn du nicht in der Technologiebranche
      bist. Sie kommt über die Börse — und weil jeder sie zum Ausbauen braucht, ist sie
      eine der zuverlässigsten Einnahmequellen für Techniker.</p>
      <div class="merk">Faustregel: Erst jedes Produkt deiner Branche einmal abdecken,
      dann ausbauen. Ein fünffach ausgebautes Gebäude nützt wenig, wenn die Zutat dafür
      im Spiel gar nicht hergestellt wird.</div>`,
    en: { t: "Unlocking &amp; upgrading", lead: "More space, more output", html: `
      <p>Not every tile is buildable from the start. Locked areas look darker on the map
      and cost a one-off <b>unlock fee</b>, which is billed together with the build — so
      you pay for building and unlocking in one go.</p>
      <p>Every production building can be upgraded with <b>electronics</b> up to
      <b>level 5</b>. Each level adds <b>+30 % output</b> — and consumes proportionally
      more inputs, because consumption scales with it.</p>
      <div class="kasten"><div class="t">What an upgrade costs</div>
      Electronics and cash, both rising with the level reached. A cheap building at level 2
      is paid off quickly; level 5 on an expensive plant is an investment on the scale of a
      second building.</div>
      <p>You do not make electronics yourself unless you are in technology. It comes over
      the exchange — and because everyone needs it to upgrade, it is one of the most
      reliable sources of income for technologists.</p>
      <div class="merk">Rule of thumb: first cover every product of your industry once,
      then upgrade. A five-times-upgraded building is worth little if its input is not
      being produced anywhere in the game.</div>` } },

  { t: "Produktion &amp; Boost", lead: "Wie deine Betriebe arbeiten",
    html: `
      <p>Betriebe produzieren automatisch, jede Sekunde ein Stück weit. Du musst nichts
      anklicken — nur dafür sorgen, dass die Zutaten da sind.</p>
      <div class="kasten"><div class="t">Der Boost</div>
      Manche Betriebe laufen schneller, wenn ihr Betriebsstoff im Lager liegt: Eine Farm
      mit <b>Strom und Wasser</b> produziert bis zu <b>zweieinhalbmal</b> so viel. Der
      Verbrauch richtet sich nach der Größe des Betriebs und läuft automatisch, solange
      Vorrat da ist.</div>
      <p>Betriebe lassen sich mit <b>Elektronik</b> hochstufen: je Stufe rund
      <b>+30 % Ausstoß</b>. Das ist der stärkste Hebel im späteren Spiel — und der Grund,
      warum Elektronik immer gefragt ist.</p>
      <div class="merk">Verarbeitende Betriebe rechnen mit der knappsten Zutat. Fehlt
      auch nur eine, steht die Fabrik still — egal wie voll das Lager sonst ist.</div>`,
    en: { t: "Production &amp; boost", lead: "How your plants work", html: `
      <p>Plants produce automatically, a little every second. You do not have to click
      anything — just make sure the inputs are there.</p>
      <div class="kasten"><div class="t">The boost</div>
      Some plants run faster when their supplies are in stock: a farm with
      <b>power and water</b> produces up to <b>two and a half times</b> as much. Consumption
      depends on the size of the plant and runs automatically as long as there is
      stock.</div>
      <p>Plants can be upgraded with <b>electronics</b>: roughly <b>+30 % output</b> per
      level. That is the strongest lever in the later game — and the reason electronics
      are always in demand.</p>
      <div class="merk">Processing plants run on the scarcest input. If even one is
      missing the factory stands still — no matter how full the rest of the store is.</div>` } },

  { t: "Verarbeitungsketten", lead: "Aus billig wird wertvoll",
    html: `
      <p>Rohstoffe bringen wenig. Das Geld liegt in der Veredelung — jede Stufe
      vervielfacht den Wert.</p>
      <div class="kasten"><div class="t">Landwirtschaft</div><div class="kette">
        Obst <b>→</b> Saft (Saftpresse)<br>
        Obst + Honig <b>→</b> Gebäck (Bäckerei)<br>
        Kannabis <b>→</b> Medikamente (Pharma-Labor)
      </div></div>
      <div class="kasten"><div class="t">Rohstoff &amp; Bau</div><div class="kette">
        Erze + Wasser <b>→</b> Ziegel (Ziegelei)<br>
        Erze + Öl <b>→</b> Beton (Betonwerk)<br>
        Erze + Öl <b>→</b> Stahl (Stahlwerk)
      </div></div>
      <div class="kasten"><div class="t">Versorger &amp; Technologie</div><div class="kette">
        Öl <b>→</b> Diesel (Raffinerie)<br>
        Silizium + Strom <b>→</b> Elektronik (Chipfabrik)<br>
        Elektronik + Stahl + Öl <b>→</b> Benzin-Auto<br>
        Elektronik + Stahl + Diesel <b>→</b> Diesel-Auto<br>
        Elektronik + Stahl + Strom <b>→</b> Elektro-Auto
      </div></div>
      <p>Autos sind die wertvollsten Waren im Spiel — sie brauchen aber Zulieferungen aus
      <b>drei fremden Branchen</b>. Wer sie bauen will, muss vorher Handelsbeziehungen
      aufbauen.</p>`,
    en: { t: "Processing chains", lead: "Cheap becomes valuable", html: `
      <p>Raw materials pay little. The money is in refining — every step multiplies the
      value.</p>
      <div class="kasten"><div class="t">Agriculture</div><div class="kette">
        Fruit <b>→</b> juice (juice press)<br>
        Fruit + honey <b>→</b> pastry (bakery)<br>
        Cannabis <b>→</b> medicine (pharma lab)
      </div></div>
      <div class="kasten"><div class="t">Raw materials &amp; construction</div><div class="kette">
        Ore + water <b>→</b> bricks (brickworks)<br>
        Ore + oil <b>→</b> concrete (concrete plant)<br>
        Ore + oil <b>→</b> steel (steel mill)
      </div></div>
      <div class="kasten"><div class="t">Utilities &amp; technology</div><div class="kette">
        Oil <b>→</b> diesel (refinery)<br>
        Silicon + power <b>→</b> electronics (chip factory)<br>
        Electronics + steel + oil <b>→</b> petrol car<br>
        Electronics + steel + diesel <b>→</b> diesel car<br>
        Electronics + steel + power <b>→</b> electric car
      </div></div>
      <p>Cars are the most valuable goods in the game — but they need supplies from
      <b>three other industries</b>. Anyone who wants to build them has to establish trade
      relations first.</p>` } },

  { t: "Lager", lead: "Was du besitzt und was es wert ist",
    html: `
      <p>Im Lager siehst du jede Ware mit Menge, aktuellem Ø-Kurs und Gesamtwert. Es hat
      <b>keine Obergrenze</b> — horten ist erlaubt.</p>
      <p>Aber: Lagerbestand ist totes Kapital. Er zählt zwar zum Nettovermögen, arbeitet
      aber nicht für dich. Und wenn der Kurs fällt, schrumpft dein Vermögen, ohne dass du
      etwas falsch gemacht hast.</p>
      <div class="merk">Faustregel: Betriebsstoffe wie Strom und Wasser bevorraten,
      Endprodukte zügig verkaufen.</div>`,
    en: { t: "Storage", lead: "What you own and what it is worth", html: `
      <p>Storage shows every good with quantity, current average rate and total value. It
      has <b>no upper limit</b> — hoarding is allowed.</p>
      <p>But stock is dead capital. It counts towards net worth, yet it does not work for
      you. And if the rate falls, your wealth shrinks without you having done anything
      wrong.</p>
      <div class="merk">Rule of thumb: stock up on supplies like power and water, sell
      finished products promptly.</div>` } },

  { t: "Eigene Läden", lead: "An die Stadt verkaufen",
    html: `
      <p>Läden verkaufen laufend an die Stadtbevölkerung — ohne dass ein Mitspieler
      kaufen muss. Du baust einen Laden, klickst ihn an und legst je Verkaufsslot fest:
      <b>welche Ware, zu welchem Preis</b>, optional eine Höchstmenge.</p>
      <div class="kasten"><div class="t">Preis steuert das Tempo</div>
      Zum Ø-Kurs verkaufst du mit voller Geschwindigkeit. Teurer heißt langsamer,
      billiger heißt schneller — bis zum doppelten Tempo. Du entscheidest zwischen
      Marge und Umschlag.</div>
      <ul>
        <li>Der einzige Laden ist der <b>Online-Marktplatz</b>: 3 Regale für alle Waren, jede Ausbaustufe bringt eins dazu.</li>
        <li>Er verkauft erst mit einem <b>Shop-System</b> — von einer Software-Firma oder das Stadtportal (8 % je Verkauf).</li>
        <li>Systeme mit dem <b>Baum deiner Branche</b> verkaufen deine Waren schneller.</li>
      </ul>
      <div class="merk">Mitspieler können in deinem Online-Shop direkt einkaufen. Dafür
      fällt die halbe Börsengebühr als Handelssteuer an — immer noch günstiger als die Börse.</div>`,
    en: { t: "Your own shops", lead: "Selling to the city", html: `
      <p>Shops sell continuously to the city's population — no other player has to buy.
      You build a shop, click it and set per sales slot:
      <b>which good, at what price</b>, optionally a maximum quantity.</p>
      <div class="kasten"><div class="t">Price sets the pace</div>
      At the average rate you sell at full speed. Dearer means slower, cheaper means
      faster — up to double the pace. You decide between margin and turnover.</div>
      <ul>
        <li>The only shop is the <b>online marketplace</b>: 3 shelves for every good, each upgrade adds one.</li>
        <li>It only sells with a <b>shop system</b> installed — from a software company or the city portal (8 % per sale).</li>
        <li>Systems with your <b>industry's tree</b> sell your goods faster.</li>
      </ul>
      <div class="merk">Other players can buy directly in your online shop. Half the exchange
      fee applies as trade tax — still cheaper than the exchange.</div>` } },

  { t: "Börse", lead: "Handel unter Spielern",
    html: `
      <p>Die Börse ist ein echtes <b>Orderbuch</b>. Du stellst ein Angebot ein („verkaufe
      50 Ziegel zu 34 $") oder ein Gebot („kaufe 20 Öl zu 9 $"). Passen zwei Seiten
      zusammen, wird sofort ausgeführt.</p>
      <div class="kasten"><div class="t">Dein Einsatz wird gesperrt</div>
      Beim Verkaufsangebot wandert die Ware ins Depot, beim Kaufgebot das Geld. So kann
      niemand dasselbe zweimal ausgeben. Stornierst du, bekommst du alles zurück.</div>
      <p>Ausgeführt wird immer zum Preis der <b>bereits liegenden</b> Order. Bietest du
      mehr als nötig, bekommst du die Differenz zurück — du zahlst nie mehr als den
      tatsächlichen Marktpreis.</p>
      <p>Der Ticker oben zeigt nur <b>echte Abschlüsse</b>. Steigt dort ein Preis, hat
      wirklich jemand so viel bezahlt.</p>`,
    en: { t: "Exchange", lead: "Trading between players", html: `
      <p>The exchange is a real <b>order book</b>. You post an offer ("selling 50 bricks at
      $34") or a bid ("buying 20 oil at $9"). When two sides match, it executes at
      once.</p>
      <div class="kasten"><div class="t">Your stake is held</div>
      On a sell offer the goods go into escrow, on a buy bid the money does. That way
      nobody can spend the same thing twice. Cancel and you get everything back.</div>
      <p>Execution always happens at the price of the order that was <b>already
      standing</b>. Bid more than necessary and you get the difference back — you never
      pay more than the actual market price.</p>
      <p>The ticker at the top shows <b>real trades only</b>. If a price rises there,
      somebody genuinely paid that much.</p>` } },

  { t: "Bürgerdepot &amp; Fonds", lead: "Wer an der Aktienbörse kauft",
    html: `
      <p>Die Bewohner der Stadt <b>sparen</b>: Für jeden Dollar, den sie in den
      Online-Shops ausgeben, legen sie 40 Cent zurück. Dieses Geld kauft einmal je
      Markttag Aktien — das ist frisches Geld für die Börse.</p>
      <ul>
        <li>Rund 70 % gehen in <b>Branchenfonds</b>, der Rest in einzelne Aktien aus dem
        Orderbuch. Bevorzugt werden unterbewertete Firmen mit guter Dividende.</li>
        <li>Bei einer <b>Panik</b> oder wenn Kurse deutlich über dem Wert liegen,
        verkauft das Depot einen Teil.</li>
        <li>Ohne <b>Börsen-App</b> kommt nur die Hälfte der Ersparnisse über die
        Stadtsparkasse an die Börse. Mit Apps der Software-Firmen kommt alles an — gegen
        Provision.</li>
      </ul>
      <div class="kasten"><div class="t">Fonds schütten aus</div>
      Ein Branchenfonds hält echte Aktien. 80 % der Dividenden, die er dafür bekommt,
      reicht er alle 10 Minuten an seine Anteilseigner weiter.</div>
      <div class="merk">Wer Dividende zahlt, zieht die Sparer an — das stützt den Kurs.</div>`,
    en: { t: "Citizens' depot &amp; funds", lead: "Who buys on the stock exchange", html: `
      <p>The city's residents <b>save</b>: for every dollar they spend in online shops
      they put aside 40 cents. Once per market day this money buys shares — fresh
      money for the exchange.</p>
      <ul>
        <li>About 70 % goes into <b>sector funds</b>, the rest into single shares from the
        order book, preferring undervalued companies with good dividends.</li>
        <li>In a <b>panic</b> or when prices run well above value, the depot sells part
        of its holdings.</li>
        <li>Without a <b>stock app</b> only half the savings reach the exchange via the
        city savings bank. With apps from software companies all of it does — for a
        commission.</li>
      </ul>
      <div class="kasten"><div class="t">Funds pay out</div>
      A sector fund holds real shares. 80 % of the dividends it receives go to its unit
      holders every 10 minutes.</div>
      <div class="merk">Paying dividends attracts the savers — that supports the price.</div>` } },

  { t: "Steuerungssoftware", lead: "Software für Produktionsgebäude",
    html: `
      <p>Das System einer Software-Firma läuft nicht nur im Online-Marktplatz, sondern
      auch auf <b>Produktionsgebäuden</b>: Farm, Mine, E-Werk, Chipfabrik, Hotel …</p>
      <ul>
        <li>Jede Branche hat ihre eigene Steuerung, z. B. Ernteplaner (Agrar, mehr Ernte)
        oder Förderleitstand (Rohstoff &amp; Bau, weniger Rohstoffe je Stück).</li>
        <li>Die Wirkung kommt aus dem <b>Branchenbaum</b> des Systems: Stufe 1 bringt die
        Hälfte, Stufe 2 80 %, Stufe 3 die volle Wirkung. Ohne Baum keine Steuerung.</li>
        <li>Jedes gesteuerte Gebäude belegt einen Platz im <b>Rechenzentrum</b> des
        Anbieters und kostet ein Abo je Minute. Fällt das Rechenzentrum aus, fehlt der
        Bonus bei allen Kunden.</li>
      </ul>
      <div class="merk">Lohnt sich vor allem bei teuren Waren: Chipfabrik, Autowerk, Stahlwerk.</div>`,
    en: { t: "Control software", lead: "Software for production buildings", html: `
      <p>A software company's system does not only run your online marketplace but also
      <b>production buildings</b>: farm, mine, power plant, chip factory, hotel …</p>
      <ul>
        <li>Every industry has its own control software, e.g. harvest planner (farming,
        more output) or mining control (raw materials, fewer inputs per unit).</li>
        <li>The effect comes from the system's <b>industry tree</b>: level 1 gives half,
        level 2 80 %, level 3 the full effect. No tree, no control software.</li>
        <li>Every controlled building takes a slot in the provider's <b>data centre</b> and
        costs a subscription per minute. If the data centre fails, all customers lose the
        bonus.</li>
      </ul>
      <div class="merk">Pays off most for valuable goods: chip factory, car plant, steel mill.</div>` } },

  { t: "Preise &amp; Ankerkurs", lead: "Warum dein Angebot den Kurs bewegt",
    html: `
      <p>Es gibt keinen Händler, der zu Festpreisen abnimmt. <b>Jeder Preis im Spiel
      entsteht aus Geschäften zwischen Firmen</b> — auch der Ø-Kurs, den du oben in der
      Leiste siehst.</p>
      <div class="kasten"><div class="t">Verkaufsdruck senkt den Anker</div>
      Jede Ware hat einen Grundwert. Je mehr davon verkauft wird, desto weiter sinkt ihr
      <b>Ankerpreis</b> — bis auf die Hälfte des Grundwerts. Wer als Einziger produziert,
      kann bis auf das <b>1,3-fache</b> steigen.</div>
      <p>Daraus folgt das Wichtigste an diesem Spiel: <b>Monokultur ruiniert den eigenen
      Markt.</b> Fünf Farmen sind nicht fünfmal so gut wie eine — sie drücken den Obstpreis,
      bis sich das Bauen nicht mehr lohnt. Breite schlägt Tiefe, solange die Nachfrage nicht
      mitwächst.</p>
      <p>Umgekehrt gilt: Eine Ware, die niemand herstellt, driftet nach oben. Wer als Erster
      eine Lücke im Markt füllt, verkauft zum besten Kurs, den es für dieses Gut gibt.</p>
      <div class="merk">Wenn ein Kurs über Minuten unbewegt steht, heißt das nicht, dass er
      stabil ist — meist heißt es, dass zu diesem Preis niemand kauft.</div>`,
    en: { t: "Prices &amp; anchor rate", lead: "Why your supply moves the rate", html: `
      <p>There is no dealer buying at fixed prices. <b>Every price in the game comes out of
      deals between companies</b> — including the average rate you see in the bar at the
      top.</p>
      <div class="kasten"><div class="t">Selling pressure lowers the anchor</div>
      Every good has a base value. The more of it gets sold, the further its <b>anchor
      price</b> falls — down to half the base value. Produce it alone and it can rise to
      <b>1.3 times</b>.</div>
      <p>From that follows the most important thing about this game: <b>monoculture ruins
      your own market.</b> Five farms are not five times as good as one — they push the
      fruit price down until building stops paying. Breadth beats depth, as long as demand
      does not grow with you.</p>
      <p>The reverse holds too: a good nobody produces drifts upwards. Whoever fills a gap
      in the market first sells at the best rate that good will ever see.</p>
      <div class="merk">When a rate sits unmoved for minutes, that does not mean it is
      stable — usually it means nobody is buying at that price.</div>` } },

  { t: "Direkthandel &amp; Chat", lead: "Geschäfte von Firma zu Firma",
    html: `
      <p>Neben der offenen Börse gibt es den <b>Direktvertrag</b>: Du bietest einer
      bestimmten Firma eine bestimmte Menge zu einem ausgehandelten Preis an. Sie nimmt an
      oder lehnt ab. Angebote verfallen nach zwei Minuten.</p>
      <div class="kasten"><div class="t">Treuhand statt Vertrauen</div>
      Ware und Geld liegen bis zum Abschluss fest. Niemand kann verkaufen, was er nicht hat,
      und niemand kann annehmen, was er nicht bezahlen kann — auch nicht in einem
      Direktvertrag. Betrug ist damit technisch ausgeschlossen.</div>
      <p>Der <b>Chat</b> hat mehrere Räume und ist der Ort, an dem Preise wirklich gemacht
      werden: Wer Stahl sucht, fragt danach, statt zu hoffen, dass zufällig eine Order im
      Buch steht.</p>
      <div class="merk">Direktverträge sind das Mittel gegen die Börse, wenn ein Dritter dir
      sonst die Ware vor der Nase wegkauft.</div>`,
    en: { t: "Direct trade &amp; chat", lead: "Deals from company to company", html: `
      <p>Besides the open exchange there is the <b>direct contract</b>: you offer a
      specific company a specific quantity at a negotiated price. They accept or decline.
      Offers expire after two minutes.</p>
      <div class="kasten"><div class="t">Escrow instead of trust</div>
      Goods and money are held until the deal closes. Nobody can sell what they do not
      have, and nobody can accept what they cannot pay for — not even in a direct
      contract. Fraud is therefore technically impossible.</div>
      <p>The <b>chat</b> has several rooms and is where prices are really made: if you need
      steel, ask for it instead of hoping an order happens to be sitting in the book.</p>
      <div class="merk">Direct contracts are the answer to the exchange when a third party
      would otherwise snap up the goods in front of you.</div>` } },

  { t: "Großaufträge", lead: "Die Stadt zahlt Festpreise",
    html: `
      <p>Von Zeit zu Zeit schreibt eine Stadt einen <b>Großauftrag</b> aus: Sie braucht
      eine bestimmte Menge einer Ware und zahlt dafür einen <b>fest zugesagten Preis</b>,
      meist deutlich über dem Marktwert.</p>
      <div class="kasten"><div class="t">So läuft es</div>
      Der Auftrag steht im Lager-Panel mit Ware, Restmenge und Frist. Du zahlst deine
      Ware ein und bekommst sofort den Festpreis. Mehrere Spieler können sich denselben
      Auftrag teilen — wer zuerst liefert, verdient.</div>
      <p>Läuft die Frist ab, ohne dass die Menge zusammenkommt, gehen die eingezahlten
      Waren an ihre Einzahler zurück. Du riskierst also nichts außer Zeit.</p>
      <div class="merk">Großaufträge sind der beste Weg, große Mengen loszuwerden, ohne
      den Kurs kaputtzumachen.</div>`,
    en: { t: "Bulk orders", lead: "The city pays fixed prices", html: `
      <p>From time to time a city puts out a <b>bulk order</b>: it needs a certain quantity
      of a good and pays a <b>guaranteed price</b> for it, usually well above market
      value.</p>
      <div class="kasten"><div class="t">How it works</div>
      The order appears in the storage panel with the good, the remaining quantity and a
      deadline. You pay in your goods and receive the fixed price immediately. Several
      players can share the same order — whoever delivers first earns.</div>
      <p>If the deadline passes without the quantity coming together, the goods paid in go
      back to those who contributed them. You risk nothing but time.</p>
      <div class="merk">Bulk orders are the best way to move large quantities without
      wrecking the rate.</div>` } },

  { t: "Die Stadt wächst", lead: "Einwohner, Arbeiter und Löhne",
    html: `
      <p>Im Sandkasten und in der Einsteiger-Runde hat die Stadt <b>Einwohner</b>. Sie wohnen
      im <b>Wohngebiet</b> rund ums Zentrum — dort baut allein die Stadt, aus der Stadtkasse.</p>
      <div class="kasten"><div class="t">Wohnblöcke</div>
      Siedlungshaus (40 Plätze), ab 800 Einwohnern Mietblock (120), ab 2.500 Wohnturm (300).
      Das Baumaterial kauft die Stadt bei euch: In der Stadtübersicht (Finanzamt) steht, was sie
      braucht — sie zahlt 15 % über Kurs. Liefert niemand, kauft sie nach 90 s teurer anderswo.</div>
      <p><b>Jedes Gebäude braucht Arbeiter</b> — rund einen je 250 $ Baukosten, jede Ausbaustufe 50 %
      mehr. Mit 3 von 5 Arbeitern läuft es zu 60 %, unter 25 % steht es still. Labor, Studio und
      Chipfabrik brauchen zur Hälfte <b>Fachkräfte</b>; die Stadtbibliothek bildet mehr aus.
      Steuerungssoftware spart ein Viertel der Arbeiter.</p>
      <div class="kasten"><div class="t">Löhne</div>
      Im Firma-Panel wählst du Spar-, Tarif- oder Spitzenlohn (4/6/9 $ je Arbeiter und Minute).
      Sind Leute knapp, gehen sie zuerst zum besten Lohn. Eine Senkung greift erst nach 60 s.
      Vom Lohn gehen 30 % als Steuer und Miete an die Stadt — damit baut sie neue Wohnungen.</div>
      <p>Neue Bewohner ziehen nur zu, wenn es <b>freie Stellen</b> und freie Wohnungen gibt — und wenn
      Strom, Wasser und Lebensmittel zu kaufen sind. Fehlt der Stadt Geld, gibt sie
      <b>Stadtanleihen</b> aus, die du an der Stadtbank zeichnen kannst.</p>
      <div class="kasten"><div class="t">Software für die Stadt</div>
      Software-Firmen entwickeln <b>Bürger-Apps</b> (die Einwohner zahlen ein Abo je Minute) und
      <b>Jobbörsen</b>. Eine Jobbörse abonnierst du im Firma-Panel: Sie gibt dir bei knappen
      Arbeitern Vorrang, günstiger als ein höherer Lohn.</div>
      <div class="merk">Mehr Einwohner heißt mehr Kundschaft: Die Nachfrage in den Läden wächst mit
      der Stadt, bis ×1,6.</div>`,
    en: { t: "The city grows", lead: "Residents, workers and wages", html: `
      <p>In sandbox and beginner rounds the city has <b>residents</b>. They live in the
      <b>residential ring</b> around the centre — only the city builds there, from its treasury.</p>
      <div class="kasten"><div class="t">Housing</div>
      House (40 homes), apartment block from 800 residents (120), tower from 2,500 (300).
      The city buys its building materials from you: the city overview (tax office) lists what it
      needs — it pays 15 % above market. If nobody delivers, it buys elsewhere at a higher price after 90 s.</div>
      <p><b>Every building needs workers</b> — about one per $250 of building cost, 50 % more per
      upgrade. With 3 of 5 workers it runs at 60 %, below 25 % it stops. Lab, studio and chip
      factory need half <b>skilled workers</b>; the city library trains more. Control software
      saves a quarter of the workers.</p>
      <div class="kasten"><div class="t">Wages</div>
      In the company panel you pick low, standard or top wage (4/6/9 $ per worker and minute).
      When people are scarce they go to the best payer first. A cut only takes effect after 60 s.
      30 % of wages go to the city as tax and rent — it builds new housing with that.</div>
      <p>New residents only move in when there are <b>open jobs</b> and free homes — and when power,
      water and food are for sale. If the city runs short of money it issues <b>city bonds</b>
      you can buy at the city bank.</p>
      <div class="kasten"><div class="t">Software for the city</div>
      Software companies develop <b>citizen apps</b> (residents pay a subscription per minute) and
      <b>job boards</b>. You subscribe to a job board in the company panel: it gives you priority when
      workers are scarce, cheaper than higher wages.</div>
      <div class="merk">More residents means more customers: shop demand grows with the city, up to ×1.6.</div>` } },

  { t: "Werbeagentur", lead: "Höhere Preise ohne Tempoverlust",
    html: `
      <p>Normalerweise gilt: Wer teurer verkauft, verkauft langsamer. Die Werbeagentur
      hebelt genau das aus.</p>
      <div class="merk">Im Sandbox-Modus gibt es keine Werbeagentur mehr: Werbung kommt dort aus dem
      <b>Werbemodul</b> eines Shop-Systems — ein Abo je Online-Marktplatz und Minute, das an die
      Software-Firma geht. Die Wirkung ist dieselbe wie eine volle Kampagne (+20 %).</div>
      <div class="kasten"><div class="t">Reichweite</div>
      Du buchst eine Kampagne und baust <b>Reichweite</b> auf. Solange sie hoch ist,
      akzeptiert die Kundschaft in <b>deinen eigenen Läden</b> einen höheren Preis, ohne
      dass der Absatz einbricht — mit einer Agentur bis +20 %, mit weiteren bis +40 %.</div>
      <p>Die Reichweite <b>zerfällt laufend</b>. Ohne Nachschub bist du nach gut zwei
      Minuten wieder beim normalen Kurs. Werbung lohnt sich also nur, wenn du viel über
      eigene Läden verkaufst — nicht für reine Börsenhändler.</p>`,
    en: { t: "Ad agency", lead: "Higher prices without losing pace", html: `
      <p>Normally, selling dearer means selling slower. The ad agency is what defeats
      exactly that.</p>
      <div class="kasten"><div class="t">Reach</div>
      You book a campaign and build up <b>reach</b>. While it is high, customers in
      <b>your own shops</b> accept a higher price without sales collapsing — up to +20 %
      with one agency, up to +40 % with more.</div>
      <p>Reach <b>decays continuously</b>. Without a top-up you are back at the normal rate
      after a good two minutes. Advertising therefore only pays if you sell a lot through
      your own shops — not for pure exchange traders.</p>` } },

  { t: "Stadtbank &amp; Aktien", lead: "Kurs, Wert, Dividende, Übernahme",
    html: `
      <p>Jede Firma hat <b>100 Aktien</b>. Zu Beginn hältst du alle selbst. An der
      Stadtbank kaufst du Aktien fremder Firmen — oder verkaufst eigene, um an frisches
      Kapital zu kommen.</p>
      <div class="kasten"><div class="t">Wert F und Kurs</div>
      <b>F</b> ist, was eine Firma wirklich wert ist: Kasse, Lager, Anlagen (auch die noch
      im Bau) und der Ertrag der letzten 10 Minuten. Der <b>Kurs</b> folgt F mit einigen
      Minuten Verzögerung, schwankt etwas und kann bei Flauten oder Panik fallen. Liegt der
      Kurs unter F, ist die Aktie günstig — meist holt er auf. Jeder Kauf hebt den Kurs ein
      Stück, jeder Verkauf senkt ihn.</div>
      <p><b>Kaufanfrage:</b> Du bietest einer Firma einen Preis für eine Anzahl Aktien. Sie
      entscheidet, ob sie annimmt. Der Erlös geht an die Firma.</p>
      <p><b>Dividenden:</b> Jede Firma legt im Firmen-Panel fest, wie viel sie je Periode
      ausschüttet — automatisch einen Teil des Umsatzes oder einen festen Betrag. Verteilt
      wird nach Aktien. Eine Ausschüttung senkt F um genau ihren Betrag.</p>
      <p><b>Nettovermögen:</b> Beteiligungen zählen zum Buchwert der Firma, nicht zum Kurs —
      Kursschwankungen machen niemanden reicher oder ärmer, solange er nicht verkauft.</p>
      <p><b>Übernahme:</b> Hältst du <b>alle 100 Aktien</b>, kannst du die Firma
      fusionieren. Ihr Bargeld, Lager und alle Gebäude gehen auf dich über.</p>`,
    en: { t: "City bank &amp; stock", lead: "Price, value, dividends, takeover", html: `
      <p>Every company has <b>100 shares</b>. At the start you hold them all. At the city
      bank you buy shares in other companies — or sell your own to raise fresh capital.</p>
      <div class="kasten"><div class="t">Value F and price</div>
      <b>F</b> is what a company is really worth: cash, stock, assets (including those
      still under construction) and the earnings of the last 10 minutes. The <b>price</b>
      follows F with a few minutes' delay, wobbles a bit and can drop in slumps or a panic.
      If the price is below F the share is cheap — it usually catches up. Every purchase
      lifts the price a little, every sale lowers it.</div>
      <p><b>Purchase request:</b> you offer a company a price for a number of shares. It
      decides whether to accept. The proceeds go to the company.</p>
      <p><b>Dividends:</b> each company sets in its company panel how much it pays out per
      period — automatically a share of revenue or a fixed amount. It is split by shares.
      A payout lowers F by exactly its amount.</p>
      <p><b>Net worth:</b> holdings count at the company's book value, not its price —
      price swings make nobody richer or poorer unless they sell.</p>
      <p><b>Takeover:</b> hold <b>all 100 shares</b> and you can merge the company. Its
      cash, stock and every building pass to you.</p>` } },

  { t: "Anleihen", lead: "Geld leihen und verleihen",
    html: `
      <p>Brauchst du Kapital, ohne Anteile abzugeben, gibst du eine <b>Anleihe</b> aus:
      Du legst Betrag, Zinssatz und Laufzeit fest. Kauft ein Mitspieler sie, bekommst du
      sofort das Geld und zahlst ihm dafür laufend Zinsen.</p>
      <div class="kasten"><div class="t">Wenn du nicht zahlen kannst</div>
      Verpasst du Zinszahlungen, wird zuerst ein <b>Pfandrecht</b> auf eines deiner
      Gebäude eingetragen. Zahlst du weiter nicht, wird es <b>enteignet und versteigert</b>
      — der Erlös geht an den Gläubiger.</div>
      <p>Dein <b>Rating</b> (AAA bis D) ergibt sich aus deiner Verschuldung und Größe.
      Es ist öffentlich sichtbar und beeinflusst, ob dir jemand Geld leiht.</p>
      <div class="merk">Auf der anderen Seite: Fremde Anleihen zu kaufen ist eine ruhige
      Einnahmequelle — vorausgesetzt, der Schuldner bleibt zahlungsfähig.</div>`,
    en: { t: "Bonds", lead: "Borrowing and lending", html: `
      <p>If you need capital without giving up shares, you issue a <b>bond</b>: you set the
      amount, the interest rate and the term. If another player buys it you get the money
      immediately and pay them interest for it.</p>
      <div class="kasten"><div class="t">If you cannot pay</div>
      Miss interest payments and a <b>lien</b> is registered against one of your buildings
      first. Keep not paying and it is <b>seized and auctioned</b> — the proceeds go to the
      creditor.</div>
      <p>Your <b>rating</b> (AAA down to D) follows from your debt and your size. It is
      publicly visible and influences whether anyone will lend to you.</p>
      <div class="merk">From the other side: buying other people's bonds is a quiet source
      of income — provided the debtor stays solvent.</div>` } },

  { t: "Zwangsversteigerung", lead: "Wenn Schulden fällig werden",
    html: `
      <p>Zahlt eine Firma ihre Zinsen nicht, sammelt sie Verwarnungen. Nach der dritten
      wird ein <b>Pfandrecht</b> auf eines ihrer Gebäude eingetragen — verkaufen und
      abreißen sind ab da gesperrt.</p>
      <p>Bleibt sie weiter säumig, wird das Gebäude <b>enteignet und versteigert</b>. Die
      Auktion läuft <b>30 Sekunden</b>, das Mindestgebot liegt bei rund einem Drittel der
      Baukosten. Wer den Zuschlag bekommt, übernimmt die Kachel samt Gebäude — und samt
      allem, was darin steht.</p>
      <div class="kasten"><div class="t">Auch für dich eine Gelegenheit</div>
      Ein fertig ausgebautes Werk für ein Drittel des Neupreises ist der günstigste Weg an
      Produktionskapazität. Bots bieten ab der mittleren Schwierigkeit mit — auf ein gutes
      Los bleibst du selten allein.</div>
      <p>Der Erlös geht an den Gläubiger, nicht an die Stadt. Wer Anleihen zeichnet, ist
      also nicht schutzlos, wenn der Schuldner zusammenbricht.</p>`,
    en: { t: "Forced auction", lead: "When debts fall due", html: `
      <p>If a company does not pay its interest, it collects warnings. After the third a
      <b>lien</b> is registered against one of its buildings — selling and demolishing are
      blocked from then on.</p>
      <p>Stay in arrears and the building is <b>seized and auctioned</b>. The auction runs
      for <b>30 seconds</b>, the minimum bid is around a third of the build cost. Whoever
      wins takes over the tile with the building — and with everything inside it.</p>
      <div class="kasten"><div class="t">An opportunity for you too</div>
      A fully upgraded plant for a third of its new price is the cheapest route to
      production capacity. Bots bid from medium difficulty upwards — on a good lot you are
      rarely alone.</div>
      <p>The proceeds go to the creditor, not to the city. So anyone underwriting bonds is
      not defenceless when the debtor collapses.</p>` } },

  { t: "Motorsport", lead: "Ein Kreislauf für das späte Spiel",
    html: `
      <p>Ab <b>200.000 $ Nettovermögen</b> darf jede Firma einen <b>Rennstall</b> bauen —
      unabhängig von der Branche, wie die Verkaufsgebäude. Genau einen, für 30.000 $.</p>
      <p>Der Rennstall stellt nichts her. Er ist reiner <b>Abnehmer</b>: Du kaufst ein
      fertiges Auto bei der Firma, die Autos baut, und stellst es ein. Die Stellplätze
      hängen an der Ausbaustufe — Stufe 1 ein Wagen, Stufe 5 fünf.</p>
      <div class="kasten"><div class="t">Ein eingestelltes Auto ist keine Ware mehr</div>
      Es verlässt dein Lager endgültig und gehört ab da zum Gebäude. Zu Geld machen lässt
      es sich nur noch, indem der <b>ganze Rennstall</b> über die Stadtbank versteigert wird
      — samt Fahrzeugen, deren Wert im Mindestgebot steckt. Abreißen ist gesperrt, solange
      Autos darin stehen.</div>
      <p>Im Motorsport-Panel entwickelst du den Wagen in sechs Bereichen weiter: Antrieb,
      Batterie, Reifen, Fahrwerk, Aerodynamik und Rennsoftware, je drei Stufen. <b>Jeder
      Bereich hebt zwei Werte und senkt andere</b> — es gibt bewusst kein Setup, das alles
      verbessert. Die Teile dafür (<b>Rennreifen</b> und <b>Rennsoftware</b>) stellen andere
      Firmen her; du kaufst sie an der Börse.</p>
      <p><b>Fahrer</b> stehen in einem Pool, den alle sehen — wer zuerst zugreift, hat ihn.
      Ein Fahrer kostet Handgeld und danach <b>Gehalt pro Minute</b>. Wer nicht zahlt,
      verliert ihn zurück an den Pool.</p>
      <p><b>Renntag:</b> In festem Takt wird ein Rennen ausgeschrieben. Wer einen
      startklaren Wagen samt Fahrer hat, meldet gegen Nenngeld; danach laufen Wettphase
      und Rennen. Preisgeld gibt es für die ersten drei, gewettet wird über einen
      gemeinsamen Topf — die Quote ergibt sich aus den Einsätzen, nicht aus einem
      Buchmacher. Sponsoren können ein gemeldetes Team unterstützen und werden am
      Preisgeld beteiligt.</p>
      <div class="merk">Jedes Rennen kostet Zustand. Unter 25 % ist ein Wagen nicht mehr
      startklar — dann hilft nur Instandsetzung, und die kostet Geld und Rennreifen.</div>`,
    en: { t: "Motorsport", lead: "A cycle for the late game", html: `
      <p>From <b>$200,000 in net worth</b> any company may build a <b>racing stable</b> —
      regardless of industry, like the sales buildings. Exactly one, for $30,000.</p>
      <p>The stable produces nothing. It is a pure <b>buyer</b>: you buy a finished car
      from the company that builds cars and move it in. The number of bays follows the
      upgrade level — level 1 one car, level 5 five.</p>
      <div class="kasten"><div class="t">A car that has moved in is no longer a good</div>
      It leaves your storage for good and belongs to the building from then on. The only
      way to turn it back into money is to have the <b>whole stable</b> auctioned at the
      city bank — vehicles included, with their value inside the minimum bid. Demolishing
      is blocked while cars are inside.</div>
      <p>In the motorsport panel you develop the car in six areas: drivetrain, battery,
      tyres, chassis, aerodynamics and race software, three levels each. <b>Every area
      raises two values and lowers others</b> — there is deliberately no setup that
      improves everything. The parts for it (<b>racing tyres</b> and <b>racing
      software</b>) are made by other companies; you buy them on the exchange.</p>
      <p><b>Drivers</b> sit in a pool everyone can see — first to sign gets them. A driver
      costs a signing fee and then a <b>salary per minute</b>. Fail to pay and they go back
      to the pool.</p>
      <p><b>Race day:</b> a race is called at a fixed interval. Anyone with a race-ready car
      and a driver enters against an entry fee; then come the betting phase and the race.
      Prize money goes to the first three, and betting runs through a shared pool — the
      odds come from the stakes, not from a bookmaker. Sponsors can back an entered team
      and share in its prize money.</p>
      <div class="merk">Every race costs condition. Below 25 % a car is no longer
      race-ready — then only repair helps, and that costs money and racing tyres.</div>` } },

  { t: "Planwirtschaft", lead: "Der zweite Spielmodus",
    html: `
      <p>Statt eines Vermögensziels gibt hier das <b>Planbüro</b> die Richtung vor. Es gibt
      keine freie Börse — wer trotzdem handelt, tut das unter der Hand.</p>
      <p>Die Runde läuft in <b>fünf Planphasen zu je acht Minuten</b>. Zu Beginn jeder Phase
      verkündet das Planbüro dein <b>Plansoll</b>: bestimmte Waren in bestimmter Menge, die
      du zu festen staatlichen Preisen ablieferst. Dafür gibt es <b>Planpunkte</b>. Wer
      1.000 Punkte erreicht, gewinnt vorzeitig.</p>
      <div class="kasten"><div class="t">Zuteilung statt Einkauf</div>
      Material bekommst du nicht am Markt, sondern über <b>Bezugsscheine</b>. Wer sein Soll
      übererfüllt hat, bekommt beim nächsten Mal mehr — wer zurückliegt, weniger. Das Soll
      selbst wächst mit dem Erfolg mit: Gute Leistung wird mit höheren Forderungen belohnt.</div>
      <p>Was offiziell nicht zu bekommen ist, gibt es am <b>Schwarzmarkt</b> — dort, wo sonst
      die Stadtbank steht. Das ist schnell, aber riskant: Wer erwischt wird, bekommt einen
      Eintrag in die <b>Kaderakte</b> und <b>40 Planpunkte</b> Abzug. Beim dritten Eintrag
      wird die nächste Zuteilung halbiert.</p>
      <div class="merk">Derselbe Produktionsapparat, völlig andere Frage: nicht „was bringt
      am meisten ein", sondern „was verlangt der Plan".</div>`,
    en: { t: "Planned economy", lead: "The second game mode", html: `
      <p>Instead of a wealth target, the <b>planning office</b> sets the direction here.
      There is no open exchange — anyone trading anyway does so under the counter.</p>
      <p>The round runs in <b>five plan phases of eight minutes each</b>. At the start of
      every phase the planning office announces your <b>quota</b>: certain goods in certain
      quantities, which you deliver at fixed state prices. That earns <b>plan points</b>.
      Reach 1,000 points and you win early.</p>
      <div class="kasten"><div class="t">Allocation instead of purchase</div>
      You do not get materials on a market but through <b>ration coupons</b>. Exceed your
      quota and you get more next time — fall behind and you get less. The quota itself
      grows with success: good performance is rewarded with higher demands.</div>
      <p>What is officially unobtainable can be had on the <b>black market</b> — where the
      city bank normally stands. That is fast but risky: get caught and you receive an
      entry in your <b>cadre file</b> and <b>40 plan points</b> deducted. On the third entry
      your next allocation is halved.</p>
      <div class="merk">The same production apparatus, an entirely different question: not
      "what earns the most", but "what does the plan demand".</div>` } },

  { t: "Mitspieler &amp; Bots", lead: "Allein, zu zweit oder zu acht",
    html: `
      <p>Bis zu <b>acht Firmen</b> spielen eine Runde. Mitspieler im selben WLAN bekommen
      einfach den Link; von außerhalb funktioniert der fünfstellige Code im Warteraum.</p>
      <p>Dazu kommen bis zu zehn <b>Bot-Firmen</b>, zwei je Branche. Sie spielen über
      dieselbe Schnittstelle wie du: <b>kein Extrakapital, keine höhere Produktion, keine
      verborgenen Preise</b>. Sie bauen, kaufen Vorprodukte, verkaufen, nehmen Kredite auf
      und bieten bei Versteigerungen mit.</p>
      <div class="kasten"><div class="t">Drei Schwierigkeitsstufen</div>
      <ul style="margin:0 0 0 16px">
        <li><b>Einfach</b> — bauen langsam, höchstens drei Gebäude, keine Ausbauten, keine Auktionen</li>
        <li><b>Mittel</b> — bauen zügiger, leveln ihre Betriebe, bieten mit</li>
        <li><b>Schwer</b> — bis zu acht Gebäude, boosten ihre Produktion, greifen überall zu</li>
      </ul></div>
      <p>Auch allein ist der Markt dadurch lebendig: Die Bots sind deine Lieferanten und
      deine Konkurrenz zugleich.</p>`,
    en: { t: "Players &amp; bots", lead: "Alone, in pairs or eight-handed", html: `
      <p>Up to <b>eight companies</b> play a round. Players on the same Wi-Fi simply get the
      link; from elsewhere the five-character code in the lobby works.</p>
      <p>On top of that come up to ten <b>bot companies</b>, two per industry. They play
      through the same interface you do: <b>no extra capital, no higher output, no hidden
      prices</b>. They build, buy inputs, sell, take out loans and bid at auctions.</p>
      <div class="kasten"><div class="t">Three difficulty levels</div>
      <ul style="margin:0 0 0 16px">
        <li><b>Easy</b> — build slowly, three buildings at most, no upgrades, no auctions</li>
        <li><b>Medium</b> — build faster, upgrade their plants, join the bidding</li>
        <li><b>Hard</b> — up to eight buildings, boost their output, take part in everything</li>
      </ul></div>
      <p>That keeps the market alive even on your own: the bots are your suppliers and your
      competition at the same time.</p>` } },

  { t: "Aufgaben &amp; Fortschritt", lead: "Wobei dich das Spiel begleitet",
    html: `
      <p>Links oben stehen die <b>Starter-Aufgaben</b>. Sie führen einmal durch jedes System
      — bauen, einen Verkaufsslot einrichten, eine Order platzieren, ein Gebäude ausbauen,
      Anteile kaufen — und zahlen dafür Prämien. Erledigte Aufgaben verschwinden.</p>
      <p>Jede Handlung bringt <b>Erfahrung</b>. Mit steigendem Level wächst nichts an deiner
      Produktion, es ist ein Fortschrittsmaß, kein Vorteil — die Wirtschaft soll durch
      Entscheidungen gewonnen werden, nicht durch Spielzeit.</p>
      <div class="kasten"><div class="t">Der Stadtkurier</div>
      Die Nachrichten der Stadt stehen im <b>Stadtnetz</b> (Knopf unten): Alle zwei Minuten
      erscheint ein <b>Marktbericht</b> — welche Ware knapp ist, welche im Überfluss liegt —,
      dazu Börse, Stadt und Firmen. Großaufträge und Ausschreibungen laufen als Eilmeldung.</div>
      <p>Fällt dir etwas auf, das nicht stimmt, gibt es unten den Knopf <b>Fehler melden</b>
      — die Meldung landet direkt beim Server, mitsamt dem, was gerade auf dem Bildschirm
      war.</p>`,
    en: { t: "Tasks &amp; progress", lead: "What the game walks you through", html: `
      <p>Top left are the <b>starter tasks</b>. They take you once through every system —
      building, setting up a sales slot, placing an order, upgrading a building, buying
      shares — and pay a bonus for it. Completed tasks disappear.</p>
      <p>Every action earns <b>experience</b>. Nothing about your production grows with your
      level; it is a measure of progress, not an advantage — the economy is meant to be won
      through decisions, not through time spent.</p>
      <div class="kasten"><div class="t">The news tower</div>
      It stands in the centre of the map and regularly sends a <b>market report</b> into the
      chat: which good is scarce, which is in surplus. If you are not constantly watching
      the ticker, this is where you learn where something is to be had.</div>
      <p>If you notice something wrong, there is a <b>Report a bug</b> button at the bottom
      — the report goes straight to the server, along with whatever was on screen at the
      time.</p>` } },

  { t: "Gewinnen", lead: "Die letzte Runde zählt",
    html: `
      <p>Sobald jemand das Rundenziel beim Nettovermögen erreicht, endet die Partie und
      es erscheint die <b>Abschlusstafel</b>: Wer hat am meisten produziert, den besten
      Einzelhandel gemacht, die meisten Anteile gehalten.</p>
      <div class="kasten"><div class="t">Drei Wege zum Ziel</div>
      <ul style="margin:0 0 0 16px">
        <li><b>Produktion</b> — viele Betriebe, hochgestuft, dauerhaft versorgt</li>
        <li><b>Handel</b> — knappe Waren früh erkennen und Spannen abschöpfen</li>
        <li><b>Beteiligung</b> — an fremden Firmen mitverdienen und übernehmen</li>
      </ul></div>
      <p>Meist gewinnt eine Mischung. Reine Produktion ist langsam, reiner Handel braucht
      Mitspieler mit Ware, reine Übernahme braucht sehr viel Kapital.</p>
      <div class="merk">Viel Erfolg — und denk dran: Jeder Preis, den du siehst, hat ein
      Mitspieler gemacht.</div>`,
    en: { t: "Winning", lead: "The last round counts", html: `
      <p>As soon as somebody reaches the round target in net worth, the game ends and the
      <b>final table</b> appears: who produced the most, ran the best retail, held the most
      shares.</p>
      <div class="kasten"><div class="t">Three routes to the target</div>
      <ul style="margin:0 0 0 16px">
        <li><b>Production</b> — many plants, upgraded, permanently supplied</li>
        <li><b>Trade</b> — spot scarce goods early and skim the spread</li>
        <li><b>Ownership</b> — earn alongside other companies and take them over</li>
      </ul></div>
      <p>Usually a mixture wins. Pure production is slow, pure trading needs players with
      goods, pure takeover needs a great deal of capital.</p>
      <div class="merk">Good luck — and remember: every price you see was made by another
      player.</div>` } },
];

/* Jedes Kapitel traegt seine englische Fassung als Feld `en` direkt bei sich —
 * nicht in einer zweiten Liste. So kann sie beim Hinzufuegen eines Kapitels
 * nicht vergessen werden, und fehlt sie doch, faellt die Anzeige auf Deutsch
 * zurueck statt leer zu bleiben. */
const kap = k => (SPRACHE === "en" && k.en) ? { ...k, ...k.en } : k;

(function tutorialBuch() {
  const el = document.getElementById("tutBuch");
  const nav = document.getElementById("tbNav");
  const inhalt = document.getElementById("tbInhalt");
  const punkte = document.getElementById("tbPunkte");
  const fortschritt = document.getElementById("tbFortschritt");
  const zurueck = document.getElementById("tbZurueck");
  const weiter = document.getElementById("tbWeiter");
  let i = 0;

  const navFuellen = () => nav.innerHTML = TUT_BUCH.map((k, n) =>
    `<button type="button" data-k="${n}"><span class="num">${String(n + 1).padStart(2, "0")}</span>${kap(k).t}</button>`).join("");
  navFuellen();
  punkte.innerHTML = TUT_BUCH.map(() => "<i></i>").join("");

  function zeichnen() {
    const k = kap(TUT_BUCH[i]);
    navFuellen();                      // Kapitelnamen folgen der Sprache
    inhalt.innerHTML = `<h3>${k.t}</h3><div class="lead">${k.lead}</div>${k.html}`;
    inhalt.scrollTop = 0;
    nav.querySelectorAll("button").forEach((b, n) => b.classList.toggle("on", n === i));
    punkte.querySelectorAll("i").forEach((p, n) => p.classList.toggle("on", n <= i));
    fortschritt.textContent = SPRACHE === "en"
      ? `Chapter ${i + 1} of ${TUT_BUCH.length}` : `Kapitel ${i + 1} von ${TUT_BUCH.length}`;
    zurueck.disabled = i === 0;
    weiter.textContent = t(i === TUT_BUCH.length - 1 ? "Fertig" : "Weiter");
    /* Das gewählte Kapitel auch in der Seitenspalte sichtbar halten — sonst
     * verliert man auf schmalen Fenstern beim Blättern den Bezug. */
    nav.querySelectorAll("button")[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const auf = () => { el.classList.add("auf"); el.setAttribute("aria-hidden", "false"); zeichnen(); };
  const zu = () => { el.classList.remove("auf"); el.setAttribute("aria-hidden", "true");
    if (typeof lesenStoppen === "function") lesenStoppen(); };

  /* "Tutorial spielen" heisst jetzt auch spielen: Der Knopf startet eine echte
   * eigene Runde und führt darin durch die ersten Handlungen. Das Lesebuch
   * bleibt als Nachschlagewerk erhalten — es öffnet sich über das Lexikon im
   * Spiel und über den kleinen Verweis im letzten Schritt. */
  window.lernbuchOeffnen = auf;
  window.lernbuchNeuZeichnen = () => { if (el.classList.contains("auf")) zeichnen(); };
  /* Der Knopf im Warteraum öffnet wieder die geschriebene Anleitung. Die
   * geführte Übungsrunde bleibt erhalten und ist aus dem Buch heraus zu
   * starten — wer lesen will, liest; wer lieber macht, klickt unten links. */
  document.getElementById("tutBuchAuf").addEventListener("click", auf);
  document.getElementById("tbUeben").addEventListener("click", () => { lesenStoppen(); zu(); uebungsrundeStarten(); });

  /* ---------- Vorlesen ----------
   * Web Speech API. Sie ist nicht überall vorhanden, deshalb verschwindet der
   * Knopf ersatzlos, statt eine Fehlermeldung zu erzeugen. */
  const laut = document.getElementById("tbVorlesen");
  const wahl = document.getElementById("tbStimme");
  const stimme = window.speechSynthesis;
  let liest = false, leseTeile = [], leseIdx = 0;
  if (!stimme || typeof SpeechSynthesisUtterance === "undefined") { laut.style.display = "none"; wahl.style.display = "none"; }

  /* ---- Stimmenwahl ----
   * Voreinstellung ist die Systemstimme — auf einem deutschen Mac also "Anna".
   * Bewusst KEINE eigene Rangfolge: Welche Stimme angenehm ist, entscheidet
   * der Geschmack, nicht das Programm. Wer eine andere will, nimmt sie aus
   * der Liste daneben; die Wahl wird gemerkt. */
  const stimmenFuer = () => {
    const praefix = SPRACHE === "en" ? "en" : "de";
    const alle = stimme.getVoices();
    const passend = alle.filter(v => v.lang.toLowerCase().startsWith(praefix));
    return passend.length ? passend : alle;
  };
  function stimmeBestimmen() {
    const liste = stimmenFuer();
    if (!liste.length) return null;
    const gemerkt = (() => { try { return localStorage.getItem("cs_tts_stimme"); } catch { return null; } })();
    return liste.find(v => v.name === gemerkt) || liste.find(v => v.default) || liste[0];
  }
  function stimmenlisteFuellen() {
    const liste = stimmenFuer();
    if (!liste.length) { wahl.style.display = "none"; return; }
    wahl.style.display = "";
    const gewaehlt = stimmeBestimmen();
    /* Systemstimme oben, der Rest alphabetisch. */
    const sortiert = [...liste].sort((a, b) =>
      (b.default ? 1 : 0) - (a.default ? 1 : 0) || a.name.localeCompare(b.name, "de"));
    wahl.innerHTML = sortiert.map(v => `<option value="${v.name.replace(/"/g, "&quot;")}"${
        v.name === gewaehlt?.name ? " selected" : ""}>${v.name.replace(/\s*\(.*?\)\s*$/, "")}</option>`).join("");
  }
  wahl.addEventListener("change", () => {
    try { localStorage.setItem("cs_tts_stimme", wahl.value); } catch {}
    if (liest) { lesenStoppen(); setTimeout(lesenStarten, 120); }
  });
  stimmenlisteFuellen();
  /* Die Stimmenliste steht auf manchen Systemen erst nach einem Rundlauf
   * bereit — dann kommt dieses Ereignis. */
  stimme?.addEventListener?.("voiceschanged", stimmenlisteFuellen);

  /* Aus dem Kapitel-HTML wird gesprochener Text: Blöcke bekommen eine Pause,
   * Aufzählungspunkte einen Satzschluss — sonst laufen die Stichworte
   * atemlos ineinander. */
  function kapitelText(roh) {
    const k = kap(roh);
    const d = document.createElement("div");
    d.innerHTML = `<p>${k.t}.</p><p>${k.lead}.</p>` + k.html;
    d.querySelectorAll("li").forEach(li => {
      if (!/[.!?:]\s*$/.test(li.textContent)) li.append(".");
    });
    d.querySelectorAll("p, li, div, h3, h4").forEach(e => e.append(" "));
    return d.textContent.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  }
  /* Lange Äußerungen brechen auf manchen Systemen mitten im Satz ab. Deshalb
   * an Satzgrenzen in Häppchen von rund 200 Zeichen zerlegen. */
  function haeppchen(text) {
    const saetze = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    const raus = []; let puffer = "";
    for (const satz of saetze) {
      if (puffer && (puffer + satz).length > 220) { raus.push(puffer.trim()); puffer = ""; }
      puffer += satz;
    }
    if (puffer.trim()) raus.push(puffer.trim());
    return raus;
  }
  function lautBeschriften() {
    laut.querySelector("span").textContent = liest
      ? (SPRACHE === "en" ? "Stop" : "Stopp")
      : (SPRACHE === "en" ? "Read aloud" : "Vorlesen");
    laut.classList.toggle("an", liest);
    laut.setAttribute("aria-pressed", liest ? "true" : "false");
  }
  function lesenStoppen() {
    if (!stimme) return;
    liest = false; leseTeile = []; leseIdx = 0;
    try { stimme.cancel(); } catch {}
    lautBeschriften();
  }
  function lesenWeiter() {
    if (!liest) return;
    if (leseIdx >= leseTeile.length) {
      /* Kapitelende: automatisch weiterblättern, bis das Buch durch ist. */
      if (i + 1 >= TUT_BUCH.length) return lesenStoppen();
      i++; zeichnen();
      leseTeile = haeppchen(kapitelText(TUT_BUCH[i])); leseIdx = 0;
      if (!leseTeile.length) return lesenStoppen();
    }
    const u = new SpeechSynthesisUtterance(leseTeile[leseIdx++]);
    const v = stimmeBestimmen();
    if (v) { u.voice = v; u.lang = v.lang; }
    else u.lang = SPRACHE === "en" ? "en-US" : "de-DE";
    u.rate = 1; u.pitch = 1;
    u.onend = lesenWeiter;
    /* "interrupted" und "canceled" sind KEINE Fehler: Sie entstehen jedes Mal,
     * wenn wir selbst abbrechen oder die Stimme wechseln. Wer darauf stoppt,
     * beendet das Vorlesen direkt nach dem ersten Häppchen — genau das ist
     * beim ersten Versuch passiert. */
    u.onerror = e => { if (!["interrupted", "canceled"].includes(e?.error)) lesenStoppen(); };
    stimme.speak(u);
  }
  function lesenStarten() {
    if (!stimme) return;
    liest = true; leseTeile = haeppchen(kapitelText(TUT_BUCH[i])); leseIdx = 0;
    lautBeschriften();
    /* cancel() wirkt asynchron. Ein unmittelbar folgendes speak() wird davon
     * noch mitgerissen, deshalb nur abbrechen, wenn wirklich etwas läuft —
     * und dann kurz warten. */
    if (stimme.speaking || stimme.pending) { try { stimme.cancel(); } catch {} setTimeout(lesenWeiter, 140); }
    else lesenWeiter();
  }
  laut.addEventListener("click", () => liest ? lesenStoppen() : lesenStarten());
  lautBeschriften();
  /* Wer die Seite verlässt oder das Buch schließt, soll nicht weiter beschallt
   * werden — die Sprachausgabe lebt sonst ausserhalb der Seite weiter. */
  addEventListener("beforeunload", lesenStoppen);
  /* Sprachumschalter verdrahten — Startbildschirm und Kopfleiste. */
  document.querySelectorAll("[data-lang]").forEach(b =>
    b.addEventListener("click", () => spracheSetzen(b.dataset.lang)));
  const langBtn = document.getElementById("langBtn");
  langBtn.addEventListener("click", () => {
    spracheSetzen(SPRACHE === "de" ? "en" : "de");
    langBtn.textContent = SPRACHE.toUpperCase();
  });
  langBtn.textContent = SPRACHE.toUpperCase();
  document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("on", b.dataset.lang === SPRACHE));
  document.documentElement.lang = SPRACHE;
  seiteUebersetzen();
  document.getElementById("tbZu").addEventListener("click", zu);
  el.addEventListener("click", e => { if (e.target === el) zu(); });   // Klick daneben schließt
  /* Wer selbst blättert, will nicht, dass die Stimme im alten Kapitel
   * weiterredet. Das automatische Weiterblättern beim Vorlesen ruft zeichnen()
   * direkt auf und ist davon nicht betroffen. */
  const blaettern = ziel => { lesenStoppen(); i = ziel; zeichnen(); };
  nav.addEventListener("click", e => {
    const b = e.target.closest("button[data-k]");
    if (b) blaettern(+b.dataset.k);
  });
  zurueck.addEventListener("click", () => { if (i > 0) blaettern(i - 1); });
  weiter.addEventListener("click", () => {
    if (i < TUT_BUCH.length - 1) blaettern(i + 1); else zu();
  });
  document.addEventListener("keydown", e => {
    if (!el.classList.contains("auf")) return;
    if (e.key === "Escape") zu();
    else if (e.key === "ArrowRight" && i < TUT_BUCH.length - 1) blaettern(i + 1);
    else if (e.key === "ArrowLeft" && i > 0) blaettern(i - 1);
  });
})();

/* Ausschüttung im Firmen-Panel festlegen */
document.getElementById("firmabody").addEventListener("click", e => {
  const lb = e.target.closest("[data-lohn]");
  if (lb) return act("lohnStufe", { stufe: lb.dataset.lohn });
  const jb = e.target.closest("[data-jobabo]");
  if (jb) return act("jobAbo", { id: jb.dataset.jobabo || null });
  const rg = e.target.closest("[data-rgebot]");
  if (rg) return act("ruestBieten", { id: +rg.dataset.rgebot, prozent: +document.getElementById(`rg-${rg.dataset.rgebot}`).value });
  const rl = e.target.closest("[data-rliefer]");
  if (rl) return act("ruestLiefern", { id: +rl.dataset.rliefer, good: rl.dataset.rlg });
  if (e.target.closest("[data-malen]")) return malOeffnen();
  const sa = e.target.closest("[data-shopauf]");
  if (sa) { const [x, y] = sa.dataset.shopauf.split(",").map(Number); return shopOeffnen(x, y); }
  if (e.target.closest("[data-aus-auto]")) { act("setAusschuettung", { betrag: "auto" }); return; }
  if (e.target.closest("[data-aus-setzen]")) {
    const v = document.getElementById("ausBetrag").value;
    if (v === "") return toast("Betrag eingeben — 0 setzt die Ausschüttung aus", true);
    act("setAusschuettung", { betrag: +v });
  }
});

/* Branchen-ETFs kaufen und verkaufen */
document.getElementById("p-bank").addEventListener("click", e => {
  const k = e.target.closest("[data-etf-kauf]");
  if (k) {
    const feld = document.querySelector(`[data-etf-betrag="${k.dataset.etfKauf}"]`);
    const betrag = +feld?.value || 0;
    if (betrag < 100) return toast("Betrag eingeben — mindestens 100 $", true);
    act("etfKaufen", { branche: k.dataset.etfKauf, betrag }); if (feld) feld.value = "";
    return;
  }
  const v = e.target.closest("[data-etf-verkauf]");
  if (v) act("etfVerkaufen", { branche: v.dataset.etfVerkauf, anteil: +v.dataset.anteil });
});
