/* Reine Formeln des Wirtschaftssystems v2 (Abschnitte 4–10, 13).
 * Keine Abhängigkeit von Server oder Socket — dadurch testbar. */
import { KONFIG as K } from "./konfiguration.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* ---- Geld-Erhaltung (Abschnitt 1) ---- */
/* Konten: Map von Kontoname -> Betrag. Jede Bewegung hat genau Absender und Empfänger. */
export function zahle(konten, buch, von, an, betrag, grund) {
  if (!(betrag > 0)) return { ok: false, grund: "Betrag muss positiv sein" };
  if (!konten.has(von) || !konten.has(an)) return { ok: false, grund: "Unbekanntes Konto" };
  if (konten.get(von) < betrag - 1e-9) return { ok: false, grund: "Keine Deckung", von, betrag };
  konten.set(von, konten.get(von) - betrag);
  konten.set(an, konten.get(an) + betrag);
  buch.push({ von, an, betrag, grund });
  return { ok: true };
}

/* Geldsummen-Check: Summe aller Konten = Startgeld + offene Kredite (Toleranz 0,01 $). */
export function geldsummenCheck(konten, startgeld, offeneKredite) {
  const summe = [...konten.values()].reduce((a, b) => a + b, 0);
  const soll = startgeld + offeneKredite;
  const abw = summe - soll;
  return { ok: Math.abs(abw) <= 0.01, summe, soll, abweichung: abw };
}

/* ---- Umsatz und Steuern (Abschnitt 7) ---- */
/* Der Kunde zahlt den Bruttopreis; 10/110 gehen als Umsatzsteuer an die Stadt. */
export function umsatzAufteilen(brutto) {
  const ust = brutto * K.steuern.umsatz / (1 + K.steuern.umsatz);
  return { ust, erloes: brutto - ust };
}

/* Gewinnsteuer mit Verlustvortrag. Verluste mindern spätere Gewinne, bevor Steuer anfällt. */
export function gewinnSteuer(gewinn, verlustVortrag) {
  if (gewinn <= 0) return { steuer: 0, verlustVortrag: verlustVortrag - gewinn };
  const verrechnet = Math.min(verlustVortrag, gewinn);
  const zuVersteuern = gewinn - verrechnet;
  return { steuer: zuVersteuern * K.steuern.gewinn, verlustVortrag: verlustVortrag - verrechnet };
}

/* Dividende: 40 % des Nachsteuergewinns (einstellbar 0–80 %), Kapitalertragsteuer 25 % darauf. */
export function ausschuettung(nachsteuerGewinn, cash, quote = K.firma.dividendenquote) {
  if (nachsteuerGewinn <= 0 || cash <= 0) return { brutto: 0, kest: 0, netto: 0 };
  const q = clamp(quote, 0, K.firma.dividendenMax);
  const brutto = Math.min(q * nachsteuerGewinn, cash);
  const kest = brutto * K.steuern.kapitalertrag;
  return { brutto, kest, netto: brutto - kest };
}

/* ---- Firmenwert (Abschnitt 6) ---- */
/* Multiple = 1 / (Leitzins + Risikoaufschlag). Negativer Gewinn wird nicht angerechnet. */
export function multiple(leitzins) {
  return 1 / (leitzins + K.firma.risikoaufschlag);
}
export function fairerWert(eigenkapital, gewinn10, leitzins) {
  return Math.max(0, eigenkapital + Math.max(0, gewinn10) * multiple(leitzins));
}

/* Gewinn eines Markttags (Abschnitt 6). Bau und Upgrades zählen nicht hier. */
export function gewinnTag({ erloesNetto, loehne, inputs, unterhalt, zinsen }) {
  return erloesNetto - loehne - inputs - unterhalt - zinsen;
}

/* ---- Preisbildung (Abschnitt 4) ---- */
/* Preis folgt dem Lagerbestand. Schritt höchstens ±5 % je Markttag, dann ±2 % Rauschen,
 * Untergrenze 0,8 × Stückkosten, keine Obergrenze. */
/* lagerGestern (optional): Mit der Dämpfung aus der Konfiguration zählt auch die
 * Lageränderung seit gestern. Die reine Formel aus der Spezifikation schwingt
 * sonst dauerhaft (siehe Simulation); ohne lagerGestern gilt sie unverändert. */
export function preisNeu(pAlt, lager, ziel, stueckkosten, rauschen = 0, lagerGestern = null) {
  let rel = ziel > 0 ? (ziel - lager) / ziel : 0;
  if (lagerGestern != null && ziel > 0) rel -= K.preis.daempfung * (lager - lagerGestern) / ziel;
  const faktor = clamp(1 + K.preis.anpassung * rel, 1 - K.preis.begrenzung, 1 + K.preis.begrenzung);
  const mitRauschen = pAlt * faktor * (1 + clamp(rauschen, -1, 1) * K.preis.rauschen);
  return Math.max(mitRauschen, K.preis.untergrenzeStueckkosten * stueckkosten);
}

/* ---- Zentralbank (Abschnitt 8) ---- */
export function zielzins(inflation) {
  const z = K.zentralbank.neutralzins + K.zentralbank.reaktion * (inflation - K.zentralbank.inflationsziel);
  return clamp(z, K.zentralbank.zinsMin, K.zentralbank.zinsMax);
}
/* Leitzins bewegt sich je Markttag höchstens 0,5 Punkte auf den Zielzins zu. */
export function leitzinsSchritt(leitzins, ziel) {
  const d = clamp(ziel - leitzins, -K.zentralbank.schrittTag, K.zentralbank.schrittTag);
  return leitzins + d;
}
export const sparquote = leitzins => clamp(K.haushalte.sparquoteBasis + (leitzins - K.zentralbank.neutralzins), K.haushalte.sparquoteMin, K.haushalte.sparquoteMax);
export const kreditzins = leitzins => leitzins + K.bank.kreditAufschlag;
export const sparzins = leitzins => Math.max(0, leitzins - K.bank.sparAbschlag);
export const anleihezins = leitzins => leitzins + 0.01;

/* ---- Börse (Abschnitt 10) ---- */
/* Kursformel je Markttag. nettoOrders in Stück (Kauf minus Verkauf). rauschen in [-1, 1]. */
export function kursNeu(kAlt, kFair, nettoOrders, anteile, { einfluss = K.boerse.orderEinfluss, rauschen = 0 } = {}) {
  const rueck = 0.10 * (kFair - kAlt);
  /* Order-Wirkung je Tag auf ±5 % des Kurses begrenzt. Ohne Deckel gibt es
   * ab ~20 % gehandelter Aktien je Tag kein Gleichgewicht mehr gegen den
   * 10-%-Rückzug, und der Kurs wächst exponentiell (KI-Testfond, 10.11.2026). */
  const orders = clamp(kAlt * einfluss * nettoOrders * 100 / anteile, -0.05 * kAlt, 0.05 * kAlt);
  const roh = kAlt + rueck + orders;
  return roh * (1 + clamp(rauschen, -1, 1) * K.boerse.kursRauschen);
}

/* Bürgerdepot: Fondsanteil sinkt um 5 Punkte je Zinspunkt über 4 %, Rest hälftig auf Anleihen und Sparkonto. */
export function buergerdepotVerteilung(leitzins, anleihenVorhanden = true) {
  const punkte = (leitzins - K.zentralbank.neutralzins) / 0.01;
  const fonds = clamp(K.buergerdepot.fonds - 0.05 * punkte, K.buergerdepot.fondsMin, K.buergerdepot.fondsMax);
  const rest = 1 - fonds;
  if (!anleihenVorhanden) return { fonds, anleihen: 0, sparkonto: rest };
  return { fonds, anleihen: rest / 2, sparkonto: rest / 2 };
}

/* ---- Übernahmen (Abschnitt 11) ---- */
export function stimmrechtsStufen(anteil) {
  const s = K.uebernahme.schwellen;
  const stufen = [];
  if (anteil >= s.meldung) stufen.push("Meldeschwelle");
  if (anteil >= s.sperrminorität) stufen.push("Sperrminorität");
  if (anteil >= s.pflicht) stufen.push("Pflichtangebot");
  if (anteil > s.kontrolle) stufen.push("Kontrolle");
  if (anteil >= s.fusion) stufen.push("Fusion");
  if (anteil >= s.zwang) stufen.push("Zwangsabfindung");
  return stufen;
}
/* Pflichtangebot: Preis mindestens der höchste Preis der letzten 10 Markttage. */
export function pflichtangebotPreis(preisHistorie) {
  return Math.max(0, ...preisHistorie.slice(-K.uebernahme.preisFensterTage));
}
/* Fonds nehmen automatisch an, wenn der Preis mindestens 15 % über dem fairen Wert liegt. */
export const fondsNimmtAn = (preis, fair) => preis >= fair * (1 + K.uebernahme.fondsPraemie);
/* Zwangsabfindung: höherer Wert aus fairem Wert und letztem Angebotspreis. */
export const zwangsPreis = (fair, letztesAngebot) => Math.max(fair, letztesAngebot);

/* Fusion: Restaktionäre der Zielfirma erhalten neue Aktien im Verhältnis der fairen Werte. */
export function fusionsVerhaeltnis(fairZiel, fairKaeufer) {
  return fairKaeufer > 0 ? fairZiel / fairKaeufer : 0;
}
/* Kartellamt: gemeinsamer Marktanteil über 60 % lehnt die Fusion ab. */
export const kartellErlaubt = anteil => anteil <= K.kartell.marktanteilGrenze;

/* ---- Kredit (Abschnitt 9) ---- */
export const kreditLimit = eigenkapital => Math.max(0, eigenkapital) * K.bank.kreditlimitAnteil;
