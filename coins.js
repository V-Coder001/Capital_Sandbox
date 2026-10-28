/* ============================================================
 * Krypto-Börse: Coins der Software-Firmen (Umsetzungsplan Schritt 1 bis 7)
 * ------------------------------------------------------------
 * Ein Coin ist ungedeckt. Sein Wert ist das Fundament, und das kommt allein
 * aus Börsengebühren. Die Gebühr legt jede Börse selbst fest.
 *
 *  Fundament    Fc = Gebührenstock / COIN.UMLAUF (fest)
 *  Kurs         C(t+1) = C·(1 + β·Druck) + α·(Fc − C), Druck = Netto-Volumen / Umlauf
 *  Tagesgrenze  C bleibt je Markttag im Band ±TAGESGRENZE um den Tagesanfang
 *  Nettovermögen Coins zählen zum Fundament (Buchwert), nicht zum Kurs
 *
 * Konten: Ein Konto gilt für eine Börse. Geld und Coins liegen im Konto der
 * Börse, bei der der Auftrag eingestellt wurde. Der Käufer zahlt die Gebühr an
 * seine Börse. Fremde Coins gibt es nur mit Vertrag; die Börse bekommt dann
 * VERTRAG_ANTEIL der Gebühr, der Rest geht an die Firma des Coins.
 * Alle Funktionen arbeiten auf dem Zustand G, damit sie sich einzeln testen lassen.
 * ============================================================ */

export const COIN = {
  UMLAUF: 100,            // Stück je Coin, die ausgegeben werden dürfen
  COINS_JE_FIRMA: 5,      // so viele verschiedene Coins darf eine Firma auflegen
  GEBUEHR_MAX: 0.05,      // höchste Gebühr, die eine Börse einstellen darf (5 %)
  GEBUEHR_MIN: 0,         // 0 ist erlaubt, dann verdient die Börse nichts
  VERTRAG_ANTEIL: 0.30,   // Anteil der Börse an der Gebühr fremder Coins
  BETA: 0.35,             // Kursreaktion pro Handel (Aktien: 0,5)
  ALPHA: 0.25,            // Rückkehr zum Fundament je Tick (1 Tick = 1 s)
  TAGESGRENZE: 0.50,      // ±50 % je Markttag (vorher 15 %; Tempo des Anstiegs, nicht die Höhe)
  TAG: 60,                // Ticks je Markttag (wie MARKT.TAG)
  ZERFALL: 0.999,         // Gebührenstock fällt je Tick — ohne Handel sinkt der Wert von allein
  HEBEL: 3000,             // Gebühren zählen vielfach: das Fundament ist die kapitalisierte Einnahme,
                          // nicht die Summe der Gebühren. Mit ZERFALL ergibt das ein Gleichgewicht —
                          // ein lebhaft gehandelter Coin trägt sich und steigt, ein toter fällt.
  BUERGER: "buerger",     // Kennung der Bewohner-Konten; die Gruppen heißen buerger1 … buerger4
  BUERGER_GRUPPEN: [      // Vier Sorten Bewohner, damit sie auch untereinander handeln
    { id: "buerger1", gier: 0.95, basis: 0.35 },   // Trendläufer: springt auf jede Bewegung auf
    { id: "buerger2", gier: 0.15, basis: 0.20 },   // Rechner: schaut aufs Fundament
    { id: "buerger3", gier: -0.5, basis: 0.15 },   // Gegenwetter: verkauft in den Hype hinein
    { id: "buerger4", gier: 0.5, basis: 0.30 },    // Mitläufer
  ],
  BUERGER_TAKT: 5,        // alle 5 Ticks überlegen die Stadtbewohner neu
  BUERGER_ZUFLUSS: 30,    // $ je Takt und Börse, die aus der Stadt in den Coin-Handel fließen
  BUERGER_KASSE_MAX: 6000,// mehr Geld hält die Stadt nicht im Coin-Handel
  BUERGER_LUST: 0.55,     // wie oft ein Takt überhaupt zu einem Auftrag führt
  BUERGER_MENGE: 4,       // größte Stückzahl je Auftrag
  BUERGER_GIER: 0.6,      // Gewicht des Trends gegenüber der Bewertung
  BUERGER_BASIS: 0.3,     // Grundneugier: ein neuer Coin wird erst einmal gekauft
  BUERGER_GEBUEHR_SCHEU: 6, // eine teure Börse schreckt die Bewohner ab — die Gebühr ist kein Selbstläufer
  BUERGER_SAETTIGUNG: 25, // ab so vielen Coins im Bestand lässt die Kauflust nach
  KURS_START: 10,         // Startkurs einer frischen Ausgabe; zugleich Startfundament

  /* Bekanntheit: Wer für seinen Coin nichts tut, wird vergessen. Der Wert läuft
   * je Tick gegen HYPE_BODEN, steigt durch Werbung und durch Handel, und geht
   * direkt in die Kauflust der Bewohner ein. */
  HYPE_START: 0.25,       // frisch aufgelegt redet die Stadt kurz darüber
  HYPE_BODEN: -0.35,      // ohne Zutun rutscht ein Coin ins Vergessen
  HYPE_TRAEGHEIT: 0.994,  // wie schnell er dorthin rutscht (je Tick)
  HYPE_JE_HANDEL: 0.004,  // jeder Abschluss bringt ein wenig Gerede
  HYPE_MAX: 1.2,
  HYPE_TREND: 0.55,       // ab hier gilt ein Coin als Trend-Coin
  HYPE_WERT: 0.6,         // wie stark Bekanntheit den Wert eines ungedeckten Coins trägt
  BETA_BUCH: 0.06,        // offene Nachfrage im Buch hebt den Kurs auch ohne Abschluss
  WERBUNG_KOSTEN: 450,    // $ je Kampagne
  WERBUNG_HYPE: 0.45,     // so viel Aufmerksamkeit bringt sie
  WERBUNG_PAUSE: 90,      // Ticks, bis die nächste Kampagne möglich ist
  WERBUNG_REICHWEITE: 0.5,// zusätzlicher Anteil, den eine starke Website beisteuert
};

/* G.boersen[firmaId]   = Börse { firmaId, gebuehr, aktiv, konten: { pid: { cash, coins: { coinId: n } } } }
 * G.coins[firmaId]     = Coin  { firmaId, kurs, fundament, feeStock, netVol, minted, tagStart, tagTick }
 * G.coinVertraege      = [{ id, boerseId, coinId, aktiv }]
 * G.coinOrders         = offene Aufträge { id, boerseId, coinId, side, qty, price, playerId, reserviert } */
export function coinsInit(G) {
  G.boersen ??= {};
  G.coins ??= {};
  G.coinVertraege ??= [];
  G.coinOrders ??= [];
}

const konto = (b, pid) => b.konten?.[pid] || null;

/* Die Börse einer Firma eröffnen. Die Website-Voraussetzung prüft der Aufrufer. */
export function boerseEroeffnen(G, firma, gebuehr) {
  coinsInit(G);
  if (G.boersen[firma.id]) return { error: "Die Firma hat schon eine Börse" };
  const g = Number(gebuehr);
  if (!Number.isFinite(g) || g < COIN.GEBUEHR_MIN || g > COIN.GEBUEHR_MAX)
    return { error: `Die Gebühr muss zwischen ${COIN.GEBUEHR_MIN * 100} % und ${COIN.GEBUEHR_MAX * 100} % liegen` };
  G.boersen[firma.id] = { firmaId: firma.id, gebuehr: g, aktiv: true, konten: {}, einnahmen: 0, volumen: 0 };
  return { ok: true };
}

/* Gebühr einer bestehenden Börse ändern. Wirkt nur auf neue Abschlüsse. */
export function gebuehrSetzen(G, firmaId, gebuehr) {
  const b = G.boersen?.[firmaId];
  if (!b) return { error: "Keine Börse" };
  const g = Number(gebuehr);
  if (!Number.isFinite(g) || g < COIN.GEBUEHR_MIN || g > COIN.GEBUEHR_MAX)
    return { error: `Die Gebühr muss zwischen ${COIN.GEBUEHR_MIN * 100} % und ${COIN.GEBUEHR_MAX * 100} % liegen` };
  b.gebuehr = g;
  return { ok: true };
}

/* Konto bei einer Börse eröffnen (ein Konto je Spieler und Börse). */
export function kontoEroeffnen(G, boerseId, p) {
  coinsInit(G);
  const b = G.boersen[boerseId];
  if (!b?.aktiv) return { error: "Diese Börse gibt es nicht" };
  if (!konto(b, p.id)) b.konten[p.id] = { cash: 0, coins: {} };
  return { ok: true };
}

/* Geld zwischen Spielerkasse und Börsenkonto verschieben. */
export function einzahlen(G, boerseId, p, betrag) {
  const k = konto(G.boersen?.[boerseId], p.id);
  const m = Math.floor(+betrag * 100) / 100;
  if (!k) return { error: "Erst ein Konto bei dieser Börse eröffnen" };
  if (!(m > 0) || p.cash < m) return { error: "Zu wenig Bargeld" };
  p.cash -= m; k.cash += m;
  return { ok: true };
}
export function auszahlen(G, boerseId, p, betrag) {
  const k = konto(G.boersen?.[boerseId], p.id);
  const m = Math.floor(+betrag * 100) / 100;
  if (!k) return { error: "Kein Konto bei dieser Börse" };
  if (!(m > 0) || k.cash < m) return { error: "Zu wenig Guthaben auf dem Konto" };
  k.cash -= m; p.cash += m;
  return { ok: true };
}

/* Coin einer Firma ausgeben. Die Coins liegen im Konto der Firma bei der eigenen Börse. */
/* Coins einer Firma. Eine Firma darf mehrere auflegen, jeder mit eigenem Namen. */
export const coinsVon = (G, firmaId) => Object.values(G.coins || {}).filter(c => c.firmaId === firmaId);

/* Coins ausgeben. Ohne coinId entsteht ein neuer Coin unter dem Namen,
 * mit coinId werden weitere Stück eines bestehenden Coins ausgegeben. */
export function coinAusgeben(G, firma, menge, name, coinId) {
  coinsInit(G);
  const b = G.boersen[firma.id];
  if (!b?.aktiv) return { error: "Erst eine Börse eröffnen" };
  const m = Math.floor(+menge);
  if (!(m > 0)) return { error: "Menge > 0 nötig" };

  let c = coinId ? G.coins[coinId] : null;
  if (coinId && (!c || c.firmaId !== firma.id)) return { error: "Das ist nicht dein Coin" };
  if (!c) {
    const sauber = String(name || "").trim().slice(0, 16);
    if (!sauber) return { error: "Der Coin braucht einen Namen" };
    if (coinsVon(G, firma.id).length >= COIN.COINS_JE_FIRMA)
      return { error: `Höchstens ${COIN.COINS_JE_FIRMA} Coins je Firma` };
    if (Object.values(G.coins).some(x => x.name.toLowerCase() === sauber.toLowerCase()))
      return { error: "Den Namen gibt es schon" };
    const id = `cn_${firma.id}_${coinsVon(G, firma.id).length + 1}`;
    c = G.coins[id] = {
      id, firmaId: firma.id, name: sauber, kurs: COIN.KURS_START, fundament: COIN.KURS_START,
      feeStock: COIN.KURS_START * COIN.UMLAUF, netVol: 0, minted: 0, tagStart: COIN.KURS_START, tagTick: 0,
      hype: COIN.HYPE_START, werbungTick: -COIN.WERBUNG_PAUSE, kampagnen: 0,
    };
  }
  if (c.minted + m > COIN.UMLAUF) return { error: `Höchstens ${COIN.UMLAUF - c.minted} Stück mehr ausgeben` };
  if (!konto(b, firma.id)) b.konten[firma.id] = { cash: 0, coins: {} };
  c.minted += m;
  b.konten[firma.id].coins[c.id] = (b.konten[firma.id].coins[c.id] || 0) + m;
  /* Ausgegebene Stück gehen an die Börse, nicht ins eigene Depot: Sie stehen
   * sofort als Angebot im Buch. Zurückkaufen darf die Firma sie jederzeit. */
  const preis = Math.max(0.01, Math.round(c.kurs * 100) / 100);
  const r = coinOrder(G, firma, { boerseId: b.firmaId, coinId: c.id, side: "sell", qty: m, price: preis });
  return { ok: true, coinId: c.id, angeboten: !r.error, preis };
}

/* Coins im Umlauf: ausgegeben, ohne was die Firma selbst im Konto hält. */
export function umlauf(G, c) {
  const eigen = konto(G.boersen[c.firmaId], c.firmaId)?.coins?.[c.id] || 0;
  return Math.max(1, c.minted - eigen);
}

/* Führt die Börse diesen Coin? Eigener Coin immer, fremder nur mit Vertrag. */
export function listet(G, boerseId, coinId) {
  if (!G.boersen?.[boerseId]?.aktiv || !G.coins?.[coinId]) return false;
  if (G.coins[coinId].firmaId === boerseId) return true;   // eigener Coin braucht keinen Vertrag
  return (G.coinVertraege || []).some(v => v.boerseId === boerseId && v.coinId === coinId && v.aktiv);
}

/* Vertrag: Börse bietet den Coin einer anderen Firma an. */
export function vertragSchliessen(G, boerseId, coinId) {
  coinsInit(G);
  if (!G.boersen[boerseId]?.aktiv) return { error: "Erst eine Börse eröffnen" };
  if (!G.coins[coinId]) return { error: "Der Coin existiert nicht" };
  if (G.coins[coinId].firmaId === boerseId) return { error: "Der eigene Coin braucht keinen Vertrag" };
  if (listet(G, boerseId, coinId)) return { error: "Der Vertrag besteht schon" };
  G.coinVertraege.push({ id: `cv_${boerseId}_${coinId}`, boerseId, coinId, aktiv: true });
  return { ok: true };
}

/* Kündigung ist sofort wirksam. Offene Aufträge dieser Börse auf dem Coin werden storniert. */
export function vertragKuendigen(G, boerseId, coinId) {
  const v = (G.coinVertraege || []).find(x => x.boerseId === boerseId && x.coinId === coinId && x.aktiv);
  if (!v) return { error: "Kein aktiver Vertrag" };
  v.aktiv = false;
  for (const o of G.coinOrders.filter(o => o.coinId === coinId && o.boerseId === boerseId)) coinStorno(G, o);
  return { ok: true };
}

/* Auftrag einstellen. Kauf sperrt Geld im Konto inklusive Gebühr, Verkauf sperrt Coins.
 * Passende Gegenaufträge werden sofort ausgeführt, der Rest steht im Buch. */
export function coinOrder(G, p, { boerseId, coinId, side, qty, price }) {
  coinsInit(G);
  if (!listet(G, boerseId, coinId)) return { error: "Diese Börse führt den Coin nicht" };
  const c = G.coins[coinId], b = G.boersen[boerseId], k = konto(b, p.id);
  if (!k) return { error: "Erst ein Konto bei dieser Börse eröffnen" };
  const m = Math.floor(+qty), pr = Math.round(+price * 100) / 100;
  if (!(m > 0) || !(pr > 0)) return { error: "Menge und Preis > 0 nötig" };
  let reserviert;
  if (side === "buy") {
    reserviert = m * pr * (1 + b.gebuehr);
    if (k.cash < reserviert) return { error: "Zu wenig Guthaben auf dem Konto" };
    k.cash -= reserviert;
  } else {
    if ((k.coins[coinId] || 0) < m) return { error: "Nicht genug Coins im Konto" };
    k.coins[coinId] -= m;
    reserviert = m;
  }
  const o = { id: `co_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, boerseId, coinId, side, qty: m, price: pr, playerId: p.id, reserviert };
  matchen(G, o);
  if (o.qty > 0) G.coinOrders.push(o);
  return { ok: true, order: o };
}

/* Auftrag zurücknehmen: Geld oder Coins gehen zurück ins Konto des Einstellers. */
export function coinStorno(G, o) {
  const k = konto(G.boersen[o.boerseId], o.playerId);
  if (k) {
    if (o.side === "buy") k.cash += o.reserviert;
    else k.coins[o.coinId] = (k.coins[o.coinId] || 0) + o.reserviert;
  }
  o.reserviert = 0;
  G.coinOrders = G.coinOrders.filter(x => x !== o);
}

/* Gegenaufträge abarbeiten. Ausführung zum Preis des wartenden Auftrags. */
function matchen(G, o) {
  const c = G.coins[o.coinId];
  const gegen = G.coinOrders
    .filter(x => x.coinId === o.coinId && x.side !== o.side && x.playerId !== o.playerId && x.qty > 0)
    .filter(x => o.side === "buy" ? x.price <= o.price : x.price >= o.price)
    .sort((a, b) => o.side === "buy" ? a.price - b.price : b.price - a.price);
  for (const x of gegen) {
    if (o.qty <= 0) break;
    const kauf = o.side === "buy" ? o : x, verkauf = o.side === "buy" ? x : o;
    const menge = Math.min(o.qty, x.qty), preis = x.price;
    fuelle(G, c, kauf, verkauf, menge, preis);
    x.qty -= menge; o.qty -= menge;
  }
  G.coinOrders = G.coinOrders.filter(x => x.qty > 0);
}

/* Ein Abschluss: Coins ins Konto des Käufers, Geld ins Konto des Verkäufers,
 * Gebühr an die Börse des Käufers (mit Vertragsanteil für die Firma des Coins). */
function fuelle(G, c, kauf, verkauf, menge, preis) {
  const wert = menge * preis, bk = G.boersen[kauf.boerseId], g = bk.gebuehr, gebuehr = wert * g;
  /* Käufer hat zum Limit gesperrt: Differenz zurück ins Konto. */
  kauf.reserviert -= menge * kauf.price * (1 + g);
  const kk = konto(bk, kauf.playerId);
  if (kk) {
    kk.cash += menge * (kauf.price - preis) * (1 + g);
    kk.coins[c.id] = (kk.coins[c.id] || 0) + menge;
  }
  /* Verkäufer bekommt den Wert im Konto seiner Börse. */
  verkauf.reserviert -= menge;
  const vk = konto(G.boersen[verkauf.boerseId], verkauf.playerId);
  if (vk) vk.cash += wert;
  /* Gebühr verteilen */
  if (bk.firmaId === c.firmaId) { gutschreiben(G, bk.firmaId, gebuehr); bk.einnahmen = (bk.einnahmen || 0) + gebuehr; }
  else {
    const an = gebuehr * COIN.VERTRAG_ANTEIL;
    gutschreiben(G, bk.firmaId, an);
    gutschreiben(G, c.firmaId, gebuehr - an);
    bk.einnahmen = (bk.einnahmen || 0) + an;                       // Anteil der gastgebenden Börse
    c.fremdErtrag = (c.fremdErtrag || 0) + (gebuehr - an);
  }
  /* Kennzahlen für das Dashboard der Firma */
  bk.volumen = (bk.volumen || 0) + wert;
  c.volumen = (c.volumen || 0) + wert;
  c.trades = (c.trades || 0) + 1;
  c.hype = Math.min(COIN.HYPE_MAX, (c.hype ?? COIN.HYPE_START) + COIN.HYPE_JE_HANDEL);
  c.netVol += menge;
  /* Das Fundament hängt am Umschlag in Stück, nicht am Geldwert: sonst trüge
   * ein hoher Kurs über die Gebühr seinen eigenen Wert und liefe davon. */
  c.feeStock += menge * g * COIN.HEBEL;
}
/* Gebühren fließen in die Spielerkasse der Firma (nicht in ein Börsenkonto). */
const gutschreiben = (G, pid, betrag) => { if (G.players[pid]) G.players[pid].cash += betrag; };

/* Jeden Tick: Kurs nachführen, Tagesgrenze und Gebührenstock. */
export function coinTick(G, tick) {
  for (const c of Object.values(G.coins || {})) {
    if (tick - c.tagTick >= COIN.TAG) { c.tagTick = tick; c.tagStart = c.kurs; }
    c.feeStock *= COIN.ZERFALL;
    /* Bekanntheit verfliegt: ohne Werbung und ohne Handel geht sie Richtung Boden. */
    c.hype = COIN.HYPE_BODEN + ((c.hype ?? COIN.HYPE_START) - COIN.HYPE_BODEN) * COIN.HYPE_TRAEGHEIT;
    /* Ein ungedeckter Coin ist wert, was er umsetzt — mal dem, was die Stadt
     * von ihm hält. Bekanntheit ist hier kein Beiwerk, sondern der halbe Wert. */
    c.fundament = Math.max(0.01, c.feeStock / COIN.UMLAUF) * Math.max(0.2, 1 + COIN.HYPE_WERT * (c.hype ?? 0));
    const druck = c.netVol / umlauf(G, c);
    c.netVol = 0;
    /* Auch unerfüllte Nachfrage bewegt: liegen mehr Gebote als Angebote im
     * Buch, zieht der Kurs an, ohne dass ein Abschluss zustande kommt. */
    let kaufOffen = 0, verkaufOffen = 0;
    for (const o of G.coinOrders || []) {
      if (o.coinId !== c.id) continue;
      if (o.side === "buy") kaufOffen += o.qty; else verkaufOffen += o.qty;
    }
    const buchDruck = (kaufOffen - verkaufOffen) / umlauf(G, c);
    let k = c.kurs * (1 + COIN.BETA * druck + COIN.BETA_BUCH * Math.max(-1, Math.min(1, buchDruck)));
    k += COIN.ALPHA * (c.fundament - k);
    const lo = c.tagStart * (1 - COIN.TAGESGRENZE), hi = c.tagStart * (1 + COIN.TAGESGRENZE);
    c.kurs = Math.max(0.01, Math.min(hi, Math.max(lo, k)));
  }
}

/* Buchwert der Coins eines Spielers: alle Konten, Coins zum Fundament. */
export function coinsWert(G, pid) {
  let w = 0;
  for (const b of Object.values(G.boersen || {})) {
    const k = b.konten?.[pid];
    if (!k) continue;
    for (const [coinId, n] of Object.entries(k.coins)) w += n * (G.coins[coinId]?.fundament || 0);
    w += k.cash;
  }
  for (const o of G.coinOrders || []) {
    if (o.playerId !== pid) continue;
    if (o.side === "sell") w += o.reserviert * (G.coins[o.coinId]?.fundament || 0);
    else w += o.reserviert;   // gesperrtes Geld gehört weiter dem Spieler
  }
  return w;
}

/* ============================================================
 * Stadtbewohner handeln Coins
 * ------------------------------------------------------------
 * Damit ein Coin überhaupt lebt, muss jemand ihn wollen. Das sind die
 * Stadtbewohner: Sie haben auf jeder Börse ein gemeinsames Konto und
 * kaufen oder verkaufen alle paar Sekunden ein paar Stück.
 *
 * Ihre Laune hat zwei Teile. Der Trend zieht sie mit — steigt der Kurs,
 * wollen alle rein, das ist der Hype. Die Bewertung zieht dagegen: Liegt
 * der Kurs weit über dem Fundament, trauen sie dem Frieden nicht. So kann
 * ein Coin steigen, ohne beliebig zu steigen, und ein gehandelter Coin
 * verdient über die Gebühren sein Fundament selbst.
 *
 * Das Geld dafür kommt in kleinen Schritten aus der Stadt in die
 * Börsenkasse und ist gedeckelt (BUERGER_KASSE_MAX je Börse).
 * ============================================================ */

export function coinBuerger(G, tick) {
  coinsInit(G);
  if (tick % COIN.BUERGER_TAKT) return;
  for (const b of Object.values(G.boersen)) {
    if (!b.aktiv) continue;
    /* Zufluss aus der Stadt, gedeckelt, gleichmäßig auf die Gruppen verteilt */
    const je = COIN.BUERGER_ZUFLUSS / COIN.BUERGER_GRUPPEN.length;
    for (const g of COIN.BUERGER_GRUPPEN) {
      const k = (b.konten[g.id] ??= { cash: 0, coins: {} });
      if (k.cash < COIN.BUERGER_KASSE_MAX) k.cash += je;
    }

    for (const c of Object.values(G.coins)) {
      if (!listet(G, b.firmaId, c.id) || !c.minted) continue;

      /* Trend: Kurs gegen den Stand von vor ein paar Takten */
      const h = (c.buergerHist ??= []);
      h.push(c.kurs); if (h.length > 12) h.shift();
      const frueher = h[0] || c.kurs;
      const trend = Math.max(-1, Math.min(1, (frueher > 0 ? c.kurs / frueher - 1 : 0) * 6));
      /* Bewertung: unter Fundament billig, weit darüber teuer */
      const bewertung = Math.max(-1, Math.min(1, (c.kurs > 0 ? c.fundament / c.kurs - 1 : 0) * 3));

      for (const g of COIN.BUERGER_GRUPPEN) {
        if (Math.random() > COIN.BUERGER_LUST) continue;
        const k = b.konten[g.id];
        const bestand = k.coins[c.id] || 0;
        /* Sättigung am freien Umlauf messen: Wer seinen Anteil schon hat, kauft
         * nicht weiter, und wer deutlich darüber liegt, nimmt Gewinne mit.
         * Ohne das hätte ein Trend-Coin irgendwann nur noch Käufer, der Handel
         * käme zum Erliegen und der Kurs wäre mangels Umsatz gefallen. */
        const anteil = bestand / Math.max(1, umlauf(G, c) / COIN.BUERGER_GRUPPEN.length);
        const satt = Math.min(1, anteil);
        /* Bekanntheit ist der stärkste Treiber: Wovon alle reden, das kaufen
         * sie. Was keiner kennt, geben sie ab. Der Rechner lässt sich davon
         * am wenigsten beeindrucken, der Trendläufer am meisten. */
        const hypeGewicht = 0.6 + 0.6 * Math.max(0, g.gier);
        const laune = g.basis * (1 - satt) + g.gier * trend + (1 - Math.abs(g.gier)) * bewertung
          + hypeGewicht * (c.hype ?? 0) * (1 - satt)
          - 0.8 * Math.max(0, anteil - 1)
          - b.gebuehr * COIN.BUERGER_GEBUEHR_SCHEU
          + (Math.random() - 0.5) * 0.5;

        const buch = G.coinOrders.filter(o => o.coinId === c.id && o.boerseId === b.firmaId && o.playerId !== g.id);
        const besteFrage = buch.filter(o => o.side === "sell").sort((x, y) => x.price - y.price)[0];
        const bestesGebot = buch.filter(o => o.side === "buy").sort((x, y) => y.price - x.price)[0];
        const menge = 1 + Math.floor(Math.random() * COIN.BUERGER_MENGE);

        if (laune > 0.12) {
          /* Kaufen: das günstigste Angebot nehmen, sonst knapp über dem Kurs bieten */
          const preis = Math.round((besteFrage ? besteFrage.price : c.kurs * (1 + 0.01 + Math.random() * 0.04)) * 100) / 100;
          if (k.cash >= menge * preis * (1 + b.gebuehr))
            coinOrder(G, { id: g.id }, { boerseId: b.firmaId, coinId: c.id, side: "buy", qty: menge, price: preis });
        } else if (laune < -0.12 && bestand > 0) {
          /* Verkaufen: ins beste Gesuch hinein, sonst knapp unter dem Kurs */
          const preis = Math.round((bestesGebot ? bestesGebot.price : c.kurs * (1 - 0.01 - Math.random() * 0.04)) * 100) / 100;
          coinOrder(G, { id: g.id }, { boerseId: b.firmaId, coinId: c.id, side: "sell", qty: Math.min(bestand, menge), price: Math.max(0.01, preis) });
        }
      }
    }

    /* Aufträge der Bewohner liegen nicht ewig im Buch */
    for (const o of G.coinOrders.filter(x => String(x.playerId).startsWith(COIN.BUERGER) && x.boerseId === b.firmaId)) {
      o.alter = (o.alter || 0) + 1;
      if (o.alter > 6) coinStorno(G, o);
    }
  }
}

/* Werbekampagne für einen Coin. Kostet die Firma Geld und bringt Aufmerksamkeit;
 * eine starke Website trägt die Botschaft weiter (reichweite 0 … 1). */
export function coinWerben(G, firma, coinId, tick, reichweite = 0) {
  coinsInit(G);
  const c = G.coins[coinId];
  if (!c) return { error: "Den Coin gibt es nicht" };
  if (c.firmaId !== firma.id) return { error: "Das ist nicht dein Coin" };
  if (tick - (c.werbungTick ?? -COIN.WERBUNG_PAUSE) < COIN.WERBUNG_PAUSE)
    return { error: `Die nächste Kampagne geht in ${COIN.WERBUNG_PAUSE - (tick - c.werbungTick)} s` };
  if ((firma.cash || 0) < COIN.WERBUNG_KOSTEN) return { error: `Dafür fehlen ${Math.ceil(COIN.WERBUNG_KOSTEN - firma.cash)} $` };
  firma.cash -= COIN.WERBUNG_KOSTEN;
  c.werbungTick = tick;
  c.kampagnen = (c.kampagnen || 0) + 1;
  const wirkung = COIN.WERBUNG_HYPE * (1 + COIN.WERBUNG_REICHWEITE * Math.max(0, Math.min(1, reichweite)));
  c.hype = Math.min(COIN.HYPE_MAX, (c.hype ?? COIN.HYPE_START) + wirkung);
  return { ok: true, hype: c.hype, trend: c.hype >= COIN.HYPE_TREND };
}

/* Der bekannteste Coin der Stadt, wenn er die Trendschwelle erreicht. */
export function trendCoin(G) {
  const alle = Object.values(G.coins || {}).filter(c => (c.hype ?? 0) >= COIN.HYPE_TREND);
  return alle.sort((a, b) => (b.hype || 0) - (a.hype || 0))[0] || null;
}
