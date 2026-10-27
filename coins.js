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
  UMLAUF: 100,            // Coins je Firma, die ausgegeben werden dürfen
  GEBUEHR_MAX: 0.05,      // höchste Gebühr, die eine Börse einstellen darf (5 %)
  GEBUEHR_MIN: 0,         // 0 ist erlaubt, dann verdient die Börse nichts
  VERTRAG_ANTEIL: 0.30,   // Anteil der Börse an der Gebühr fremder Coins
  BETA: 0.35,             // Kursreaktion pro Handel (Aktien: 0,5)
  ALPHA: 0.25,            // Rückkehr zum Fundament je Tick (1 Tick = 1 s)
  TAGESGRENZE: 0.15,      // ±15 % je Markttag
  TAG: 60,                // Ticks je Markttag (wie MARKT.TAG)
  ZERFALL: 0.998,         // Gebührenstock fällt je Tick auf diesen Anteil zurück (gewollt: ohne Handel sinkt der Wert)
  KURS_START: 10,         // Startkurs einer frischen Ausgabe; zugleich Startfundament
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
  G.boersen[firma.id] = { firmaId: firma.id, gebuehr: g, aktiv: true, konten: {} };
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
export function coinAusgeben(G, firma, menge) {
  coinsInit(G);
  const b = G.boersen[firma.id];
  if (!b?.aktiv) return { error: "Erst eine Börse eröffnen" };
  const m = Math.floor(+menge);
  if (!(m > 0)) return { error: "Menge > 0 nötig" };
  let c = G.coins[firma.id];
  if (!c) {
    c = G.coins[firma.id] = {
      firmaId: firma.id, kurs: COIN.KURS_START, fundament: COIN.KURS_START,
      feeStock: COIN.KURS_START * COIN.UMLAUF, netVol: 0, minted: 0, tagStart: COIN.KURS_START, tagTick: 0,
    };
  }
  if (c.minted + m > COIN.UMLAUF) return { error: `Höchstens ${COIN.UMLAUF - c.minted} Coins mehr ausgeben` };
  if (!konto(b, firma.id)) b.konten[firma.id] = { cash: 0, coins: {} };
  c.minted += m;
  b.konten[firma.id].coins[firma.id] = (b.konten[firma.id].coins[firma.id] || 0) + m;
  return { ok: true };
}

/* Coins im Umlauf: ausgegeben, ohne was die Firma selbst im Konto hält. */
export function umlauf(G, c) {
  const eigen = konto(G.boersen[c.firmaId], c.firmaId)?.coins?.[c.firmaId] || 0;
  return Math.max(1, c.minted - eigen);
}

/* Führt die Börse diesen Coin? Eigener Coin immer, fremder nur mit Vertrag. */
export function listet(G, boerseId, coinId) {
  if (!G.boersen?.[boerseId]?.aktiv || !G.coins?.[coinId]) return false;
  if (boerseId === coinId) return true;
  return (G.coinVertraege || []).some(v => v.boerseId === boerseId && v.coinId === coinId && v.aktiv);
}

/* Vertrag: Börse bietet den Coin einer anderen Firma an. */
export function vertragSchliessen(G, boerseId, coinId) {
  coinsInit(G);
  if (boerseId === coinId) return { error: "Der eigene Coin braucht keinen Vertrag" };
  if (!G.boersen[boerseId]?.aktiv) return { error: "Erst eine Börse eröffnen" };
  if (!G.coins[coinId]) return { error: "Der Coin existiert nicht" };
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
    kk.coins[c.firmaId] = (kk.coins[c.firmaId] || 0) + menge;
  }
  /* Verkäufer bekommt den Wert im Konto seiner Börse. */
  verkauf.reserviert -= menge;
  const vk = konto(G.boersen[verkauf.boerseId], verkauf.playerId);
  if (vk) vk.cash += wert;
  /* Gebühr verteilen */
  if (bk.firmaId === c.firmaId) gutschreiben(G, bk.firmaId, gebuehr);
  else {
    const an = gebuehr * COIN.VERTRAG_ANTEIL;
    gutschreiben(G, bk.firmaId, an);
    gutschreiben(G, c.firmaId, gebuehr - an);
  }
  c.netVol += menge;
  c.feeStock += gebuehr;
}
/* Gebühren fließen in die Spielerkasse der Firma (nicht in ein Börsenkonto). */
const gutschreiben = (G, pid, betrag) => { if (G.players[pid]) G.players[pid].cash += betrag; };

/* Jeden Tick: Kurs nachführen, Tagesgrenze und Gebührenstock. */
export function coinTick(G, tick) {
  for (const c of Object.values(G.coins || {})) {
    if (tick - c.tagTick >= COIN.TAG) { c.tagTick = tick; c.tagStart = c.kurs; }
    c.feeStock *= COIN.ZERFALL;
    c.fundament = Math.max(0.01, c.feeStock / COIN.UMLAUF);
    const druck = c.netVol / umlauf(G, c);
    c.netVol = 0;
    let k = c.kurs * (1 + COIN.BETA * druck);
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
