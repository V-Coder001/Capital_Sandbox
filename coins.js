/* ============================================================
 * Krypto-Börse: Coins der Software-Firmen (Umsetzungsplan Schritt 1 bis 6)
 * ------------------------------------------------------------
 * Ein Coin ist ungedeckt. Sein Wert ist das Fundament, und das kommt allein
 * aus Börsengebühren. Die Gebühr legt jede Börse selbst fest.
 *
 *  Fundament   Fc = Gebührenstock / Coins je Firma (fest)
 *  Kurs        C(t+1) = C·(1 + β·Druck) + α·(Fc − C), Druck = Netto-Volumen / Umlauf
 *  Tagesgrenze  C bleibt je Markttag im Band ±TAGESGRENZE um den Tagesanfang
 *  Nettovermögen Coins zählen zum Fundament (Buchwert), nicht zum Kurs
 *
 * Eine Börse gehört einer Software-Firma mit eigener Website. Ein Konto gilt
 * nur für eine Börse. Fremde Coins gibt es nur mit Vertrag; die Börse bekommt
 * dann VERTRAG_ANTEIL der Gebühr, der Rest geht an die Firma des Coins.
 * Alle Funktionen arbeiten auf dem Zustand G und haben keine Seiteneffekte
 * außerhalb davon, damit sie sich einzeln testen lassen.
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

/* Zustand: G.boersen[firmaId] = Börse, G.coins[firmaId] = Coin, G.coinVertraege = Verträge */
export function coinsInit(G) {
  G.boersen ??= {};
  G.coins ??= {};
  G.coinVertraege ??= [];
  G.coinOrders ??= [];
}

/* Die Börse einer Firma eröffnen. Voraussetzung prüft der Aufrufer (Website online). */
export function boerseEroeffnen(G, firma, gebuehr) {
  coinsInit(G);
  if (G.boersen[firma.id]) return { error: "Die Firma hat schon eine Börse" };
  const g = Number(gebuehr);
  if (!Number.isFinite(g) || g < COIN.GEBUEHR_MIN || g > COIN.GEBUEHR_MAX)
    return { error: `Die Gebühr muss zwischen ${COIN.GEBUEHR_MIN * 100} % und ${COIN.GEBUEHR_MAX * 100} % liegen` };
  G.boersen[firma.id] = { id: firma.id, firmaId: firma.id, gebuehr: g, aktiv: true };
  return { ok: true };
}

/* Gebühr einer bestehenden Börse ändern. Wirkt nur auf neue Handel. */
export function gebuehrSetzen(G, firmaId, gebuehr) {
  const b = G.boersen?.[firmaId];
  if (!b) return { error: "Keine Börse" };
  const g = Number(gebuehr);
  if (!Number.isFinite(g) || g < COIN.GEBUEHR_MIN || g > COIN.GEBUEHR_MAX)
    return { error: `Die Gebühr muss zwischen ${COIN.GEBUEHR_MIN * 100} % und ${COIN.GEBUEHR_MAX * 100} % liegen` };
  b.gebuehr = g;
  return { ok: true };
}

/* Coin einer Firma ausgeben: Die Coins liegen zunächst im Eigenbesitz der Firma. */
export function coinAusgeben(G, firma, menge) {
  coinsInit(G);
  if (!G.boersen[firma.id]?.aktiv) return { error: "Erst eine Börse eröffnen" };
  const m = Math.floor(+menge);
  if (!(m > 0)) return { error: "Menge > 0 nötig" };
  let c = G.coins[firma.id];
  if (!c) {
    c = G.coins[firma.id] = {
      firmaId: firma.id, kurs: COIN.KURS_START, fundament: COIN.KURS_START,
      feeStock: COIN.KURS_START * COIN.UMLAUF, netVol: 0, minted: 0, holdings: {}, tagStart: COIN.KURS_START, tagTick: 0,
    };
  }
  if (c.minted + m > COIN.UMLAUF) return { error: `Höchstens ${COIN.UMLAUF - c.minted} Coins mehr ausgeben` };
  c.minted += m;
  c.holdings[firma.id] = (c.holdings[firma.id] || 0) + m;
  return { ok: true };
}

/* Umlauf = ausgegebene Coins ohne den Eigenbestand der Firma. */
export function umlauf(c) {
  return Math.max(1, c.minted - (c.holdings[c.firmaId] || 0));
}

/* Darf die Börse diesen Coin handeln? Eigener Coin immer, fremder nur mit Vertrag. */
export function listet(G, boerseId, coinId) {
  if (!G.boersen?.[boerseId]?.aktiv || !G.coins?.[coinId]) return false;
  if (boerseId === coinId) return true;
  return (G.coinVertraege || []).some(v => v.boerseId === boerseId && v.coinId === coinId && v.aktiv);
}

/* Vertrag: Börse bietet den Coin einer anderen Firma an. Ohne Kündigungsfrist. */
export function vertragSchliessen(G, boerseId, coinId) {
  coinsInit(G);
  if (boerseId === coinId) return { error: "Der eigene Coin braucht keinen Vertrag" };
  if (!G.boersen[boerseId]?.aktiv) return { error: "Erst eine Börse eröffnen" };
  if (!G.coins[coinId]) return { error: "Der Coin existiert nicht" };
  if (listet(G, boerseId, coinId)) return { error: "Der Vertrag besteht schon" };
  G.coinVertraege.push({ id: `cv_${boerseId}_${coinId}`, boerseId, coinId, aktiv: true });
  return { ok: true };
}

/* Kündigung: Der Vertrag endet sofort. Offene Aufträge dieser Börse auf dem Coin
 * werden storniert, die Sperre geht an den Besitzer zurück. */
export function vertragKuendigen(G, boerseId, coinId) {
  const v = (G.coinVertraege || []).find(x => x.boerseId === boerseId && x.coinId === coinId && x.aktiv);
  if (!v) return { error: "Kein aktiver Vertrag" };
  v.aktiv = false;
  for (const o of G.coinOrders.filter(o => o.coinId === coinId && o.boerseId === boerseId)) coinStorno(G, o);
  return { ok: true };
}

/* Auftrag einstellen. Kauf sperrt Geld inklusive Gebühr der eigenen Börse,
 * Verkauf sperrt Coins. Passende Gegenaufträge werden sofort ausgeführt, der
 * Rest steht im Buch. Die Gebühr zahlt der Käufer an dessen Börse. */
export function coinOrder(G, p, { boerseId, coinId, side, qty, price }) {
  coinsInit(G);
  if (!listet(G, boerseId, coinId)) return { error: "Diese Börse führt den Coin nicht" };
  const c = G.coins[coinId], b = G.boersen[boerseId];
  const m = Math.floor(+qty), pr = Math.round(+price * 100) / 100;
  if (!(m > 0) || !(pr > 0)) return { error: "Menge und Preis > 0 nötig" };
  let reserviert;
  if (side === "buy") {
    reserviert = m * pr * (1 + b.gebuehr);
    if (p.cash < reserviert) return { error: "Zu wenig Kapital" };
    p.cash -= reserviert;
  } else {
    if ((c.holdings[p.id] || 0) < m) return { error: "Nicht genug Coins" };
    c.holdings[p.id] -= m;
    reserviert = m;
  }
  const o = { id: `co_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, boerseId, coinId, side, qty: m, price: pr, playerId: p.id, reserviert };
  matchen(G, o);
  if (o.qty > 0) G.coinOrders.push(o);
  return { ok: true, order: o };
}

/* Auftrag zurücknehmen: Geld oder Coins gehen zurück an den Einsteller. */
export function coinStorno(G, o) {
  const p = G.players[o.playerId];
  if (o.side === "buy") { if (p) p.cash += o.reserviert; }
  else { const c = G.coins[o.coinId]; if (c) c.holdings[o.playerId] = (c.holdings[o.playerId] || 0) + o.reserviert; }
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
    const menge = Math.min(o.qty, x.qty), preis = x.price;   // Ausführung zum Preis des Wartenden
    fuelle(G, c, kauf, verkauf, menge, preis);
    x.qty -= menge; o.qty -= menge;
  }
  G.coinOrders = G.coinOrders.filter(x => x.qty > 0);
}

/* Ein Abschluss: Coins wechseln den Besitzer, Geld fließt, Gebühr geht an die Börse
 * des Käufers (mit Vertragsanteil für die Firma des Coins). */
function fuelle(G, c, kauf, verkauf, menge, preis) {
  const wert = menge * preis, g = G.boersen[kauf.boerseId].gebuehr, gebuehr = wert * g;
  /* Käufer hat zum Limit gesperrt: Differenz zurück, Kosten abziehen. */
  kauf.reserviert -= menge * kauf.price * (1 + g);
  const kp = G.players[kauf.playerId];
  if (kp) kp.cash += menge * (kauf.price - preis) * (1 + g);
  /* Verkäufer bekommt den Wert, Coins gehen an den Käufer. */
  verkauf.reserviert -= menge;
  const vp = G.players[verkauf.playerId];
  if (vp) vp.cash += wert;
  c.holdings[kauf.playerId] = (c.holdings[kauf.playerId] || 0) + menge;
  /* Gebühr verteilen */
  const bId = kauf.boerseId ? G.boersen[kauf.boerseId].firmaId : null;
  if (bId === c.firmaId) addCash(G, bId, gebuehr);
  else {
    const an = gebuehr * COIN.VERTRAG_ANTEIL;
    addCash(G, bId, an);
    addCash(G, c.firmaId, gebuehr - an);
  }
  c.netVol += menge;
  c.feeStock += gebuehr;
  c.letzterPreis = preis;
}
const addCash = (G, pid, betrag) => { if (G.players[pid]) G.players[pid].cash += betrag; };

/* Jeden Tick: Kurs nachführen, Tagesgrenze und Gebührenstock. */
export function coinTick(G, tick) {
  for (const c of Object.values(G.coins || {})) {
    if (tick - c.tagTick >= COIN.TAG) { c.tagTick = tick; c.tagStart = c.kurs; }
    c.feeStock *= COIN.ZERFALL;
    c.fundament = Math.max(0.01, c.feeStock / COIN.UMLAUF);   // fester Nenner: Der Wert je Coin hängt nicht an der Streuung
    const druck = c.netVol / umlauf(c);
    c.netVol = 0;
    let k = c.kurs * (1 + COIN.BETA * druck);
    k += COIN.ALPHA * (c.fundament - k);
    const lo = c.tagStart * (1 - COIN.TAGESGRENZE), hi = c.tagStart * (1 + COIN.TAGESGRENZE);
    c.kurs = Math.max(0.01, Math.min(hi, Math.max(lo, k)));
  }
}

/* Buchwert der Coins eines Spielers (Fundament × Anzahl, auch Gesperrtes) */
export function coinsWert(G, pid) {
  let w = 0;
  for (const c of Object.values(G.coins || {})) w += (c.holdings[pid] || 0) * c.fundament;
  for (const o of G.coinOrders || []) if (o.playerId === pid && o.side === "sell") w += o.reserviert * (G.coins[o.coinId]?.fundament || 0);
  return w;
}
