/* Wirtschaftssystem v2 — Simulation ohne Oberfläche.
 *
 * Bildet einen Markttag genau in der Reihenfolge aus Abschnitt 13 ab, mit den
 * sechs Akteuren aus Abschnitt 2 als echten Konten. Jede Geldbewegung läuft
 * über zahle(); Geld entsteht nur bei Kreditvergabe und verschwindet nur bei
 * Tilgung oder Abschreibung. Am Ende jedes Tages prüft geldsummenCheck().
 *
 * Die Simulation ist bewusst klein (vier Waren, automatisch spielende Firmen),
 * damit die Abnahmetests aus Abschnitt 16 schnell laufen. Sie ist zugleich die
 * Referenz für den Einbau in server.js. */
import { KONFIG as K } from "./konfiguration.js";
import * as R from "./regeln.js";

/* ---- Waren und Gebäude der Simulation ----
 * gruppe: Warengruppe des Bedarfsprofils. stufe: Lohnstufe aus vorschlag.lohnJeArbeitsplatz. */
export const SIM_WAREN = {
  getreide: { basep: 7,  gruppe: "lebensmittel" },
  strom:    { basep: 1.8, gruppe: "energie" },
  brot:     { basep: 60, gruppe: "lebensmittel" },
  ziegel:   { basep: 34, gruppe: "baustoffe" },
};
export const SIM_GEBAEUDE = {
  farm:       { out: "getreide", rate: 20, bauwert: 2000, art: "farm",   stufe: "rohstoff", boosts: ["strom"] },
  kraftwerk:  { out: "strom",    rate: 100, bauwert: 2500, art: "mine",   stufe: "rohstoff" },
  baeckerei:  { out: "brot",     rate: 5, bauwert: 3000, art: "fabrik", stufe: "veredelung", in: { getreide: 2, strom: 2 } },
  ziegelei:   { out: "ziegel",   rate: 15, bauwert: 3000, art: "mine",   stufe: "rohstoff" },
};
/* Bedarfsprofil der Simulation, aus vorschlag.bedarfsprofil auf die vier Waren umgelegt. */
const SIM_PROFIL = { brot: 0.45, getreide: 0.10, strom: 0.25, ziegel: 0.20 };

const r2 = x => Math.round(x * 100) / 100;

/* Zufall mit Startwert, damit Testläufe reproduzierbar sind. */
function zufall(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ---- Aufbau ---- */
export function neueSimulation({ firmen = 4, seed = 1, branchen = ["farm", "kraftwerk", "baeckerei", "ziegelei"] } = {}) {
  const konten = new Map();
  const S = {
    tag: 0, konten, buch: [], offeneKredite: 0, rand: zufall(seed),
    leitzins: K.zentralbank.neutralzins, zielzins: K.zentralbank.neutralzins, inflation: 0,
    indexHist: [], fehler: [], log: [],
    preise: {}, lager: {}, ziel: {}, umsatzPeriode: {}, verbrauchPeriode: {},
    firmen: [], einwohner: 1000,
    haushalte: { budget: 0, einkommenHeute: 0 },
    stadt: { anleihen: [], steuernPeriode: 0, steuernLetztePeriode: 0, tageAmDeckel: 0, maxTageAmDeckel: 0, projekte: 0, projektFortschritt: 0 },
    bank: {},
    depot: { sparkonto: 0, anleihen: 0, fondsAnteile: {} },
    fonds: {},
    crash: { aktivBis: -1, pauseBis: -1 },
    kartellamt: { umsatzPeriode: {} },
  };
  const neu = (name, betrag) => konten.set(name, betrag);
  neu("haushalte", K.start.haushalte);
  neu("stadt", K.start.stadt);
  neu("bank", K.start.bank);
  neu("depot", 0);
  for (const [g, w] of Object.entries(SIM_WAREN)) {
    S.preise[g] = w.basep; S.lager[g] = []; S.umsatzPeriode[g] = 0; S.verbrauchPeriode[g] = 0;
  }
  for (let i = 0; i < firmen; i++) {
    const typ = branchen[i % branchen.length];
    const f = {
      id: `firma${i}`, spieler: `spieler${i}`, branche: typ,
      gebaeude: [{ typ, aktiv: true }, { typ, aktiv: true }],
      inv: Object.fromEntries(Object.keys(SIM_WAREN).map(g => [g, 0])),
      kredit: 0, verlustVortrag: 0, gewinnHist: [], gewinnPeriode: 0,
      ausfallTage: 0, insolvent: false, offeneLoehne: 0,
      anteile: { [`spieler${i}`]: K.boerse.anteileGruender }, anteileGesamt: K.boerse.anteileGruender,
      boersennotiert: false, kurs: null, fair: 0, eigenkapital: 0, nettoOrders: 0,
      dividendenquote: K.firma.dividendenquote, erhoehtInPeriode: 0, preisHist: [],
      tag: { erloes: 0, loehne: 0, inputs: 0, unterhalt: 0, zinsen: 0 },
    };
    S.firmen.push(f);
    neu(f.id, K.start.kapitalSpieler);
    neu(f.spieler, 0);
    if (!konten.has(`fonds:${typ}`)) { neu(`fonds:${typ}`, 0); S.fonds[typ] = { anteileAusgegeben: 0 }; }
  }
  S.startgeld = [...konten.values()].reduce((a, b) => a + b, 0);
  /* Ziel-Lager beim Start: Ausstoß von 3 Markttagen. */
  for (const g of Object.keys(SIM_WAREN)) S.ziel[g] = Math.max(1, ausstossProTag(S, g) * K.preis.zielTage);
  /* Startlager: Die Hersteller bringen je Ware das Ziel-Lager mit (Waren dürfen entstehen, Geld nicht). */
  for (const g of Object.keys(SIM_WAREN)) {
    const hersteller = S.firmen.filter(f => f.gebaeude.some(b => SIM_GEBAEUDE[b.typ].out === g));
    for (const f of hersteller) S.lager[g].push({ firma: f.id, menge: S.ziel[g] / hersteller.length });
  }
  return S;
}

function ausstossProTag(S, g) {
  let n = 0;
  for (const f of S.firmen) for (const b of f.gebaeude) if (SIM_GEBAEUDE[b.typ].out === g) n += SIM_GEBAEUDE[b.typ].rate;
  return n;
}

/* ---- Hilfen ---- */
const kontostand = (S, k) => S.konten.get(k) || 0;
function zahle(S, von, an, betrag, grund) {
  if (!(betrag > 0.0000001)) return true;
  const r = R.zahle(S.konten, S.buch, von, an, betrag, grund);
  if (S.buch.length > 2000) S.buch.splice(0, 1000);   // nur die letzten Buchungen behalten
  return r.ok;
}
/* Kredit: Geld entsteht. Firmenkonto und offene Kredite steigen gleich. */
function kreditVergeben(S, f, betrag) {
  const limit = R.kreditLimit(f.eigenkapital || kontostand(S, f.id));
  const frei = Math.max(0, limit - f.kredit);
  const x = Math.min(betrag, frei);
  if (!(x > 0)) return 0;
  S.konten.set(f.id, kontostand(S, f.id) + x);
  f.kredit += x; S.offeneKredite += x;
  return x;
}
/* Tilgung: Geld verschwindet. */
function kreditTilgen(S, f, betrag) {
  const x = Math.min(betrag, f.kredit, kontostand(S, f.id));
  if (!(x > 0)) return 0;
  S.konten.set(f.id, kontostand(S, f.id) - x);
  f.kredit -= x; S.offeneKredite -= x;
  return x;
}
const lohnVon = typ => K.vorschlag.lohnJeArbeitsplatz[SIM_GEBAEUDE[typ].stufe];
const plaetzeVon = typ => K.vorschlag.arbeitsplaetze[SIM_GEBAEUDE[typ].art];
/* Stückkosten: Inputs zum Marktpreis plus Lohnanteil laut Rezept. */
export function stueckkosten(S, g) {
  const typ = Object.keys(SIM_GEBAEUDE).find(t => SIM_GEBAEUDE[t].out === g);
  const b = SIM_GEBAEUDE[typ];
  let k = lohnVon(typ) * plaetzeVon(typ) / b.rate;
  for (const [i, n] of Object.entries(b.in || {})) k += n * S.preise[i];
  return k;
}
const lagerMenge = (S, g) => S.lager[g].reduce((a, e) => a + e.menge, 0);

/* Ware in den Stadtmarkt geben (Kommission: bleibt Eigentum der Firma, bis jemand kauft). */
function anMarkt(S, f, g, menge) {
  if (!(menge > 0)) return;
  f.inv[g] -= menge;
  const e = S.lager[g].find(x => x.firma === f.id);
  if (e) e.menge += menge; else S.lager[g].push({ firma: f.id, menge });
}
/* Kauf aus dem Stadtmarkt. Haushalte und Stadt zahlen brutto (Umsatzsteuer an die Stadt),
 * Firmen untereinander zahlen netto. Gibt die gekaufte Menge zurück. */
function ausMarkt(S, kaeufer, g, mengeWunsch, { brutto = false, kaeuferFirma = null } = {}) {
  let gekauft = 0;
  const preis = S.preise[g];
  for (const e of S.lager[g]) {
    if (gekauft >= mengeWunsch - 1e-9) break;
    if (kaeuferFirma && e.firma === kaeuferFirma.id) continue;   // eigene Ware nimmt man aus dem eigenen Lager
    const verk = S.firmen.find(x => x.id === e.firma);
    let menge = Math.min(e.menge, mengeWunsch - gekauft);
    const preisBrutto = brutto ? preis * (1 + K.steuern.umsatz) : preis;
    menge = Math.min(menge, kontostand(S, kaeufer) / preisBrutto);
    if (!(menge > 1e-9)) break;
    const betrag = menge * preisBrutto;
    if (brutto) {
      const { ust, erloes } = R.umsatzAufteilen(betrag);
      zahle(S, kaeufer, "stadt", ust, "Umsatzsteuer");
      zahle(S, kaeufer, verk.id, erloes, `Verkauf ${g}`);
      verk.tag.erloes += erloes;
      S.stadt.steuernPeriode += ust;
    } else {
      zahle(S, kaeufer, verk.id, betrag, `Verkauf ${g} (zwischen Firmen)`);
      verk.tag.erloes += betrag;
    }
    e.menge -= menge; gekauft += menge;
    S.kartellamt.umsatzPeriode[g] ??= {};
    S.kartellamt.umsatzPeriode[g][verk.id] = (S.kartellamt.umsatzPeriode[g][verk.id] || 0) + menge;
  }
  S.lager[g] = S.lager[g].filter(e => e.menge > 1e-9);
  S.verbrauchPeriode[g] += gekauft;
  return gekauft;
}

/* ---- Die elf Schritte eines Markttags ---- */

/* 1. Produktion: Engpass-Regel und abnehmender Boost. Inputs kauft die Firma aus dem Markt. */
function schrittProduktion(S) {
  for (const f of S.firmen) {
    if (f.insolvent) continue;
    for (const b of f.gebaeude) {
      b.stillstand = false;
      if (!b.aktiv) continue;
      const def = SIM_GEBAEUDE[b.typ];
      let anteil = 1;
      if (def.in) {
        for (const [g, n] of Object.entries(def.in)) {
          const bedarf = n * def.rate;
          if (f.inv[g] < bedarf) {
            const vorher = kontostand(S, f.id);
            ausMarkt(S, f.id, g, bedarf - f.inv[g], { kaeuferFirma: f }) ;
            const bezahlt = vorher - kontostand(S, f.id);
            f.tag.inputs += bezahlt;
            f.inv[g] += bezahlt / S.preise[g];
          }
          anteil = Math.min(anteil, f.inv[g] / bedarf);
        }
        for (const [g, n] of Object.entries(def.in)) f.inv[g] -= n * def.rate * anteil;
      }
      let mult = 1;
      (def.boosts || []).forEach((g, i) => {
        if (i < K.produktion.boost.length && f.inv[g] >= def.rate * 0.5) { f.inv[g] -= def.rate * 0.5; mult += K.produktion.boost[i]; }
      });
      if (anteil < 0.999) b.stillstand = true;
      f.inv[def.out] += def.rate * anteil * mult;
    }
    /* Alles Produzierte geht in den Stadtmarkt; das Lager zählt dort. Was die
     * Firma selbst als Input braucht, behält sie (höchstens einen Tagesbedarf). */
    for (const g of Object.keys(f.inv)) {
      let eigenbedarf = 0;
      for (const b of f.gebaeude) eigenbedarf += (SIM_GEBAEUDE[b.typ].in?.[g] || 0) * SIM_GEBAEUDE[b.typ].rate;
      const raus = f.inv[g] - eigenbedarf;
      if (raus > 0) anMarkt(S, f, g, raus);
    }
  }
}

/* 2. Löhne und Unterhalt. Stillstand: halber Lohn. Stillgelegt: nur Unterhalt. */
function schrittLoehne(S) {
  for (const f of S.firmen) {
    if (f.insolvent) continue;
    let lohn = 0, unterhalt = 0;
    for (const b of f.gebaeude) {
      const def = SIM_GEBAEUDE[b.typ];
      if (b.aktiv) lohn += lohnVon(b.typ) * plaetzeVon(b.typ) * (b.stillstand ? K.produktion.lohnStillstand : 1);
      unterhalt += def.bauwert * K.produktion.unterhaltTag * (f.fusionsVorteil?.[b.typ] ? 1 - K.uebernahme.fusionUnterhaltsvorteil : 1);
    }
    if (f.hauptsitz) lohn += K.vorschlag.lohnJeArbeitsplatz.hauptsitz * K.vorschlag.arbeitsplaetze.hauptsitz;
    /* Fehlt Geld, nimmt die Firma Kredit im Rahmen ihres Limits. */
    const bedarf = lohn + unterhalt + f.offeneLoehne;
    if (kontostand(S, f.id) < bedarf) kreditVergeben(S, f, bedarf - kontostand(S, f.id));
    const lohnGezahlt = Math.min(lohn + f.offeneLoehne, kontostand(S, f.id));
    zahle(S, f.id, "haushalte", lohnGezahlt, "Löhne");
    S.haushalte.einkommenHeute += lohnGezahlt;
    f.offeneLoehne = lohn + f.offeneLoehne - lohnGezahlt;
    f.tag.loehne += lohn;
    const u = Math.min(unterhalt, kontostand(S, f.id));
    zahle(S, f.id, "haushalte", u * K.bau.anteilHaushalte, "Unterhalt");
    zahle(S, f.id, "stadt", u * K.bau.anteilStadt, "Unterhalt");
    S.haushalte.einkommenHeute += u * K.bau.anteilHaushalte;
    f.tag.unterhalt += unterhalt;
    f.zahlungsausfall = f.offeneLoehne > 0.01;
  }
}

/* 3. Haushalte: Sparquote nach Leitzins, Erspartes ins Bürgerdepot, Rest wird Konsumbudget. */
function schrittHaushalte(S) {
  const quote = R.sparquote(S.leitzins);
  const ein = S.haushalte.einkommenHeute;
  const sparen = Math.min(ein * quote, kontostand(S, "haushalte"));
  zahle(S, "haushalte", "depot", sparen, "Sparen");
  S.depot.zuflussHeute = sparen;
  S.haushalte.budget += ein - sparen;
  /* Vermögen über dem Budget wird langsam aufgezehrt (Startgeld der Haushalte). */
  const ueber = kontostand(S, "haushalte") - S.haushalte.budget;
  if (ueber > 0) S.haushalte.budget += ueber * K.vorschlag.vermoegenVerzehrTag;
  S.haushalte.budget = Math.min(S.haushalte.budget, kontostand(S, "haushalte"));
  S.haushalte.einkommenHeute = 0;
}

/* 4. Verkauf an die Haushalte nach Bedarfsprofil. Nicht Ausgegebenes bleibt im Budget. */
function schrittVerkauf(S) {
  const budget = S.haushalte.budget * (S.einwohner / 1000 > 0 ? 1 : 0);
  let ausgegeben = 0;
  for (const [g, anteil] of Object.entries(SIM_PROFIL)) {
    const vorher = kontostand(S, "haushalte");
    const brutto = S.preise[g] * (1 + K.steuern.umsatz);
    ausMarkt(S, "haushalte", g, (budget * anteil) / brutto, { brutto: true });
    ausgegeben += vorher - kontostand(S, "haushalte");
  }
  S.haushalte.budget = Math.max(0, S.haushalte.budget - ausgegeben);
}

/* 5. Stadt: 10 % über der Reserve ausgeben (Bau, Einkäufe, Löhne), Anleihen ausgeben oder tilgen. */
function schrittStadt(S) {
  const st = S.stadt;
  /* Fällige Anleihen tilgen, Zinsen täglich zahlen. */
  for (const a of st.anleihen) {
    const zins = a.betrag * a.zins * K.zeit.zinsTagesanteil;
    if (zahle(S, "stadt", "depot", zins, "Anleihezins")) S.depot.zinsenHeute = (S.depot.zinsenHeute || 0) + zins;
    a.rest--;
  }
  for (const a of st.anleihen.filter(a => a.rest <= 0)) {
    if (kontostand(S, "stadt") >= a.betrag) {
      zahle(S, "stadt", "depot", a.betrag, "Anleihe getilgt");
      S.depot.anleihen -= a.betrag; a.getilgt = true;
    } else a.rest = 1;   // verschoben, bis Geld da ist
  }
  st.anleihen = st.anleihen.filter(a => !a.getilgt);
  const schulden = st.anleihen.reduce((x, a) => x + a.betrag, 0);
  const deckel = K.stadt.schuldendeckelFaktor * st.steuernLetztePeriode;
  const amDeckel = schulden >= deckel - 0.01 && S.tag > K.zeit.periodeTage;
  st.tageAmDeckel = amDeckel ? st.tageAmDeckel + 1 : 0;
  st.maxTageAmDeckel = Math.max(st.maxTageAmDeckel, st.tageAmDeckel);

  const ueber = kontostand(S, "stadt") - K.stadt.reserve;
  if (ueber > 0) {
    const budget = ueber * K.stadt.ausgabenquote;
    /* Bauprojekte nur, wenn der Schuldendeckel nicht erreicht ist. */
    if (!amDeckel) {
      const vorher = kontostand(S, "stadt");
      ausMarkt(S, "stadt", "ziegel", budget * K.stadt.anteilBau / (S.preise.ziegel * (1 + K.steuern.umsatz)), { brutto: true });
      st.projektFortschritt += vorher - kontostand(S, "stadt");
      if (st.projektFortschritt >= 2000) { st.projektFortschritt -= 2000; st.projekte++; S.einwohner += 50; }
    }
    for (const [g, anteil] of Object.entries(SIM_PROFIL))
      ausMarkt(S, "stadt", g, budget * K.stadt.anteilEinkauf * anteil / (S.preise[g] * (1 + K.steuern.umsatz)), { brutto: true });
    const loehne = budget * K.stadt.anteilLoehne;
    if (zahle(S, "stadt", "haushalte", loehne, "Stadtlöhne")) S.haushalte.einkommenHeute += loehne;
  } else if (!amDeckel) {
    /* Unter der Reserve: Anleihen ausgeben. Käufer ist das Bürgerdepot (Anleihen-Anteil). */
    const fehlt = -ueber;
    const frei = Math.min(fehlt, Math.max(0, deckel - schulden), depotFreiFuerAnleihen(S));
    if (frei > 1) {
      zahle(S, "depot", "stadt", frei, "Stadtanleihe gekauft");
      S.depot.anleihen += frei;
      st.anleihen.push({ betrag: frei, zins: R.anleihezins(S.leitzins), rest: K.stadt.anleiheLaufzeitTage });
    }
  }
}

/* Wie viel das Bürgerdepot in Anleihen stecken darf (Ziel-Anteil minus bisheriger Bestand). */
function depotVermoegen(S) {
  let v = kontostand(S, "depot");
  for (const [br, n] of Object.entries(S.depot.fondsAnteile)) v += n * fondsPreis(S, br);
  return v;
}
function depotFreiFuerAnleihen(S) {
  const ziel = R.buergerdepotVerteilung(S.leitzins).anleihen * depotVermoegen(S);
  return Math.max(0, Math.min(kontostand(S, "depot"), ziel - S.depot.anleihen + kontostand(S, "depot") * 0));
}

/* 6. Preise aus den Lagerbeständen. */
function schrittPreise(S) {
  for (const g of Object.keys(SIM_WAREN)) {
    if (!(ausstossProTag(S, g) > 0)) continue;   // ohne einen einzigen Hersteller gibt es keinen Markt und keinen Preis
    const L = lagerMenge(S, g);
    S.preise[g] = R.preisNeu(S.preise[g], L, S.ziel[g], stueckkosten(S, g), S.rand() * 2 - 1, S.lagerGestern?.[g] ?? null);
    (S.lagerGestern ??= {})[g] = L;
  }
}

/* 7. Bank: Kreditzinsen, Sparzinsen, Insolvenzen. */
function schrittBank(S) {
  const kz = R.kreditzins(S.leitzins) * K.zeit.zinsTagesanteil;
  for (const f of S.firmen) {
    if (f.insolvent || !(f.kredit > 0)) continue;
    const zins = f.kredit * kz;
    if (kontostand(S, f.id) < zins) kreditVergeben(S, f, zins - kontostand(S, f.id));
    if (zahle(S, f.id, "bank", zins, "Kreditzins")) f.tag.zinsen += zins;
    else f.zahlungsausfall = true;
  }
  /* Sparzins aufs Sparkonto des Bürgerdepots. */
  const sz = R.sparzins(S.leitzins) * K.zeit.zinsTagesanteil * S.depot.sparkonto;
  if (zahle(S, "bank", "depot", sz, "Sparzins")) S.depot.zinsenHeute = (S.depot.zinsenHeute || 0) + sz;
  /* Tilgung, wenn genug Geld da ist. */
  for (const f of S.firmen) if (!f.insolvent && f.kredit > 0 && kontostand(S, f.id) > 4000) kreditTilgen(S, f, kontostand(S, f.id) - 4000);
  for (const f of S.firmen) {
    if (f.insolvent) continue;
    f.ausfallTage = f.zahlungsausfall ? f.ausfallTage + 1 : 0;
    if (f.ausfallTage >= K.bank.insolvenzTage) insolvenz(S, f);
  }
}

/* Insolvenz nach Abschnitt 9. */
export function insolvenz(S, f) {
  f.insolvent = true; f.handelAusgesetzt = true;
  S.log.push({ tag: S.tag, art: "insolvenz", firma: f.id });
  /* Versteigerung: Gebäude zu 50 % des Bauwerts, Lager zu 50 % des Marktwerts. Bieter ist die Firma mit dem meisten Geld. */
  const bieter = () => S.firmen.filter(x => !x.insolvent).sort((a, b) => kontostand(S, b.id) - kontostand(S, a.id))[0];
  for (const b of [...f.gebaeude]) {
    const k = bieter(); const preis = SIM_GEBAEUDE[b.typ].bauwert * 0.5;
    if (k && kontostand(S, k.id) >= preis && zahle(S, k.id, f.id, preis, "Versteigerung Gebäude")) k.gebaeude.push(b);
  }
  f.gebaeude = [];
  for (const g of Object.keys(SIM_WAREN)) {
    const e = S.lager[g].find(x => x.firma === f.id);
    const menge = (e?.menge || 0) + (f.inv[g] || 0);
    const k = bieter(); const preis = menge * S.preise[g] * 0.5;
    if (k && menge > 0 && kontostand(S, k.id) >= preis && zahle(S, k.id, f.id, preis, "Versteigerung Lager")) {
      if (e) e.firma = k.id; k.inv[g] += f.inv[g] || 0;
    } else if (e) e.menge = 0;   // ohne Käufer verfällt die Ware (Waren dürfen verschwinden, Geld nicht)
    f.inv[g] = 0;
  }
  S.lager = Object.fromEntries(Object.entries(S.lager).map(([g, l]) => [g, l.filter(e => e.menge > 1e-9)]));
  /* Erlös: zuerst Kredit, dann offene Löhne, Rest an die Aktionäre. */
  kreditTilgen(S, f, f.kredit);
  if (f.kredit > 0) {
    /* Reicht es nicht: Bank schreibt ab (zahlt aus eigenem Konto), notfalls zahlt die Stadt nach. */
    const rest = f.kredit;
    const bankKann = kontostand(S, "bank");
    if (bankKann < rest) zahle(S, "stadt", "bank", Math.min(rest - bankKann, kontostand(S, "stadt")), "Stadt stützt die Bank");
    /* Was dann noch fehlt, trägt die Bank als negatives Eigenkapital. Das Geld
     * aus dem Kredit existiert ja weiter; verschwinden muss es auf ihrem Konto. */
    S.konten.set("bank", kontostand(S, "bank") - rest);
    f.kredit = 0; S.offeneKredite -= rest;
    S.log.push({ tag: S.tag, art: "abschreibung", betrag: rest, bankNegativ: kontostand(S, "bank") < 0 });
  }
  const lohn = Math.min(f.offeneLoehne, kontostand(S, f.id));
  zahle(S, f.id, "haushalte", lohn, "offene Löhne aus der Insolvenzmasse");
  f.offeneLoehne -= lohn;
  const rest = kontostand(S, f.id);
  if (rest > 0) {
    const gesamt = Object.values(f.anteile).reduce((a, b) => a + b, 0) || 1;
    for (const [h, n] of Object.entries(f.anteile)) zahle(S, f.id, halterKonto(h), rest * n / gesamt, "Restverteilung");
    const ueber = kontostand(S, f.id);
    if (ueber > 0) zahle(S, f.id, "stadt", ueber, "Rest der Insolvenzmasse");
  }
  f.anteile = {}; f.anteileGesamt = 0; f.kurs = 0;   // Aktien verfallen
}

const halterKonto = h => h === "depot" ? "depot" : h;

/* 8. Firmenabschluss: Gewinn, Gewinnsteuer mit Verlustvortrag, Eigenkapital, fairer Wert. */
function schrittAbschluss(S) {
  for (const f of S.firmen) {
    if (f.insolvent) { f.tag = { erloes: 0, loehne: 0, inputs: 0, unterhalt: 0, zinsen: 0 }; continue; }
    const gewinn = R.gewinnTag({ erloesNetto: f.tag.erloes, loehne: f.tag.loehne, inputs: f.tag.inputs, unterhalt: f.tag.unterhalt, zinsen: f.tag.zinsen });
    const gs = R.gewinnSteuer(gewinn, f.verlustVortrag);
    f.verlustVortrag = gs.verlustVortrag;
    let steuer = Math.min(gs.steuer, kontostand(S, f.id));
    zahle(S, f.id, "stadt", steuer, "Gewinnsteuer");
    S.stadt.steuernPeriode += steuer;
    const nach = gewinn - steuer;
    f.gewinnHist.push(nach); if (f.gewinnHist.length > K.zeit.periodeTage) f.gewinnHist.shift();
    f.gewinnPeriode += nach;
    let lagerWert = 0;
    for (const g of Object.keys(SIM_WAREN)) lagerWert += ((S.lager[g].find(e => e.firma === f.id)?.menge || 0) + f.inv[g]) * S.preise[g];
    const gebaeude = f.gebaeude.reduce((a, b) => a + SIM_GEBAEUDE[b.typ].bauwert, 0) + (f.hauptsitz ? K.firma.hauptsitz : 0);
    f.eigenkapital = kontostand(S, f.id) + lagerWert + gebaeude * K.firma.gebaeudeImEigenkapital - f.kredit;
    f.fair = R.fairerWert(f.eigenkapital, f.gewinnHist.reduce((a, b) => a + b, 0), S.leitzins);
    f.tag = { erloes: 0, loehne: 0, inputs: 0, unterhalt: 0, zinsen: 0 };
  }
}

/* 9. Börse: Fonds und Depot kaufen, Kurse nach der Kursformel, Crash-Auslöser. */
function fondsPreis(S, br) {
  const n = S.fonds[br]?.anteileAusgegeben || 0;
  if (!n) return 1;
  let v = kontostand(S, `fonds:${br}`);
  for (const f of S.firmen) if (f.anteile[`fonds:${br}`]) v += f.anteile[`fonds:${br}`] * (f.kurs || 0);
  return v / n;
}
function schrittBoerse(S) {
  const panik = S.tag <= S.crash.aktivBis;
  /* Bürgerdepot verteilt sein Geld nach Leitzins. */
  const vert = R.buergerdepotVerteilung(S.leitzins, S.stadt.anleihen.length > 0);
  const frei = kontostand(S, "depot") - S.depot.sparkonto;
  if (frei > 1 && !panik) {
    const fondsTeil = frei * vert.fonds;
    const brs = Object.keys(S.fonds);
    for (const br of brs) {
      const betrag = fondsTeil / brs.length, pr = fondsPreis(S, br);
      if (zahle(S, "depot", `fonds:${br}`, betrag, "Fondsanteile gekauft")) {
        const n = betrag / pr;
        S.depot.fondsAnteile[br] = (S.depot.fondsAnteile[br] || 0) + n;
        S.fonds[br].anteileAusgegeben += n;
      }
    }
    /* Der Anleihen-Anteil wartet als Barreserve auf neue Stadtanleihen; gibt es keine, geht er aufs Sparkonto. */
    S.depot.sparkonto += frei * (vert.sparkonto + vert.anleihen);
    S.depot.sparkonto = Math.min(S.depot.sparkonto, kontostand(S, "depot"));
  }
  /* Entsparen: Die Haushalte holen täglich einen Teil des Sparkontos zurück und geben ihn aus. */
  const entnahme = Math.min(S.depot.sparkonto * K.vorschlag.entsparenTag, kontostand(S, "depot"));
  if (zahle(S, "depot", "haushalte", entnahme, "Entnahme vom Sparkonto")) {
    S.depot.sparkonto -= entnahme; S.haushalte.budget += entnahme;
  }
  /* Gründer verkaufen Aktien an den Fonds, solange sie die Mehrheit behalten. */
  for (const f of S.firmen) {
    if (f.insolvent || !f.boersennotiert || panik) continue;
    const konto = `fonds:${f.branche}`;
    const halten = Math.ceil(f.anteileGesamt * 0.51);
    const n = Math.min((f.anteile[f.spieler] || 0) - halten, Math.floor(kontostand(S, konto) / (f.kurs * (1 + K.boerse.provision))));
    if (n > 0 && f.kurs <= f.fair / f.anteileGesamt * (1 + K.fonds.verkaufsschwelle)) {
      zahle(S, konto, f.spieler, n * f.kurs, "Aktienkauf vom Gründer");
      zahle(S, konto, "stadt", n * f.kurs * K.boerse.provision, "Börsenprovision");
      f.anteile[f.spieler] -= n; f.anteile[konto] = (f.anteile[konto] || 0) + n; f.nettoOrders += n;
    }
  }
  /* Börsengang beim Bau des Hauptsitzes: 40 neue Anteile zum fairen Wert. */
  for (const f of S.firmen) {
    /* Automatische Firmen bauen den Hauptsitz nach der ersten Periode, höchstens eine Firma je Periode. */
    if (f.insolvent || f.hauptsitz || kontostand(S, f.id) < K.firma.hauptsitz * 1.2) continue;
    if (f.gewinnHist.length < K.zeit.periodeTage || S.tag - (S.letzterHauptsitz ?? -Infinity) < K.zeit.periodeTage) continue;
    S.letzterHauptsitz = S.tag;
    const kosten = K.firma.hauptsitz;
    zahle(S, f.id, "haushalte", kosten * K.bau.anteilHaushalte, "Hauptsitz: Bauarbeiterlohn");
    zahle(S, f.id, "stadt", kosten * K.bau.anteilStadt, "Hauptsitz: Baugebühr");
    S.haushalte.einkommenHeute += kosten * K.bau.anteilHaushalte;
    f.hauptsitz = true; f.boersennotiert = true; f.anteileNeu = K.boerse.anteileBoersengang;
    f.kurs = Math.max(1, f.fair / (f.anteileGesamt + K.boerse.anteileBoersengang));
  }
  /* Fonds kaufen ihre Branche: neue Anteile aus Börsengang oder Kapitalerhöhung. */
  for (const [br] of Object.entries(S.fonds)) {
    const konto = `fonds:${br}`;
    if (panik) continue;
    for (const f of S.firmen.filter(x => x.branche === br && x.boersennotiert && !x.insolvent)) {
      let angebot = f.anteileNeu || 0, preis = f.kurs;
      if (!angebot && f.erhoehtInPeriode < f.anteileGesamt * K.boerse.kapitalerhoehungMax && f.kurs <= f.fair / f.anteileGesamt * (1 + K.fonds.verkaufsschwelle)) {
        angebot = Math.floor(f.anteileGesamt * K.boerse.kapitalerhoehungMax - f.erhoehtInPeriode);
        preis = f.kurs * (1 - K.boerse.kapitalerhoehungAbschlag);
      }
      if (!(angebot > 0) || !(preis > 0)) continue;
      const n = Math.min(angebot, Math.floor(kontostand(S, konto) / (preis * (1 + K.boerse.provision))));
      if (n <= 0) continue;
      zahle(S, konto, f.id, n * preis, "Neue Aktien");
      zahle(S, konto, "stadt", n * preis * K.boerse.provision, "Börsenprovision");
      f.anteile[konto] = (f.anteile[konto] || 0) + n; f.anteileGesamt += n;
      if (f.anteileNeu) f.anteileNeu -= n; else f.erhoehtInPeriode += n;
      f.nettoOrders += n;
    }
  }
  /* Panik: Fonds und Depot verkaufen täglich 4 % ihrer Aktien (Rückkauf durch die Firma, wenn sie kann). */
  if (panik) for (const f of S.firmen) for (const h of Object.keys(f.anteile).filter(h => h.startsWith("fonds:"))) {
    const n = Math.floor(f.anteile[h] * K.crash.verkaufAnteil);
    if (n > 0 && zahle(S, f.id, h, n * f.kurs, "Aktienrückkauf in der Panik")) { f.anteile[h] -= n; f.anteileGesamt -= n; f.nettoOrders -= n; }
  }
  /* Kurse. */
  for (const f of S.firmen) {
    if (f.insolvent || !f.boersennotiert) { f.nettoOrders = 0; continue; }
    const kFair = f.fair / f.anteileGesamt;
    f.kurs = Math.max(0.01, R.kursNeu(f.kurs, kFair, f.nettoOrders, f.anteileGesamt, { rauschen: S.rand() * 2 - 1 }));
    f.preisHist.push(f.kurs); if (f.preisHist.length > K.uebernahme.preisFensterTage) f.preisHist.shift();
    f.nettoOrders = 0;
  }
  /* Crash-Auslöser. */
  if (S.tag > S.crash.pauseBis && S.tag > S.crash.aktivBis) {
    const notiert = S.firmen.filter(f => f.boersennotiert && !f.insolvent);
    const markt = notiert.reduce((a, f) => a + f.kurs * f.anteileGesamt, 0);
    const fair = notiert.reduce((a, f) => a + f.fair, 0);
    const amLimit = S.firmen.filter(f => !f.insolvent && f.kredit > K.crash.kreditAnteil * R.kreditLimit(f.eigenkapital)).length;
    const ausloeser = (fair > 0 && markt > fair * (1 + K.crash.schwelleMarkt)) || amLimit > S.firmen.length * K.crash.schwelleKredit;
    if (ausloeser && S.rand() < K.crash.chance) {
      S.crash.aktivBis = S.tag + K.crash.dauerTage - 1;
      S.crash.pauseBis = S.crash.aktivBis + K.crash.pauseTage;
      S.log.push({ tag: S.tag, art: "panik" });
    }
  }
}

/* 10. Zentralbank: Preisindex, Inflation, Leitzins. */
export function preisIndex(S) {
  let i = 0;
  for (const [g, w] of Object.entries(SIM_PROFIL)) i += w * S.preise[g] / SIM_WAREN[g].basep;
  return i * 100;
}
function schrittZentralbank(S) {
  const idx = preisIndex(S);
  S.indexHist.push(idx);
  const vor = S.indexHist[Math.max(0, S.indexHist.length - 1 - K.zeit.periodeTage)];
  S.inflation = vor > 0 ? idx / vor - 1 : 0;
  if (S.tag <= K.zentralbank.fixTage) { S.leitzins = K.zentralbank.neutralzins; S.zielzins = S.leitzins; return; }
  S.zielzins = R.zielzins(S.inflation);
  S.leitzins = R.leitzinsSchritt(S.leitzins, S.zielzins);
}

/* Periodenende (jeder zehnte Tag, vor dem Geldsummen-Check). */
function periodenende(S) {
  /* Dividenden: 40 % des Nachsteuergewinns, Kapitalertragsteuer an die Stadt. */
  for (const f of S.firmen) {
    if (f.insolvent) continue;
    const d = R.ausschuettung(f.gewinnPeriode, kontostand(S, f.id), f.dividendenquote);
    if (d.brutto > 0) {
      const gesamt = f.anteileGesamt;
      for (const [h, n] of Object.entries(f.anteile)) {
        const brutto = d.brutto * n / gesamt, kest = brutto * K.steuern.kapitalertrag;
        zahle(S, f.id, "stadt", kest, "Kapitalertragsteuer");
        zahle(S, f.id, halterKonto(h), brutto - kest, "Dividende");
        S.stadt.steuernPeriode += kest;
        if (h.startsWith("fonds:")) S.fonds[h.slice(6)].divOffen = (S.fonds[h.slice(6)].divOffen || 0) + brutto - kest;
      }
    }
    f.gewinnPeriode = 0; f.erhoehtInPeriode = 0;
  }
  /* Fonds: Gebühr an die Bank, Dividenden an die Anleger (Bürgerdepot). */
  for (const [br, fo] of Object.entries(S.fonds)) {
    const konto = `fonds:${br}`;
    const wert = fondsPreis(S, br) * fo.anteileAusgegeben;
    zahle(S, konto, "bank", Math.min(kontostand(S, konto), wert * K.fonds.gebuehr), "Fondsgebühr");
    const aus = Math.min(fo.divOffen || 0, kontostand(S, konto));
    if (aus > 0) { zahle(S, konto, "depot", aus, "Fondsausschüttung"); S.depot.zinsenHeute = (S.depot.zinsenHeute || 0) + aus; }
    fo.divOffen = 0;
    /* Zu viel Bargeld im Fonds: Rücknahme von Anteilen des Depots zum Fondspreis. */
    const pr = fondsPreis(S, br), werte = pr * fo.anteileAusgegeben, bar = kontostand(S, konto);
    const ueber = bar - werte * K.vorschlag.fondsBarMax;
    if (ueber > 1 && pr > 0 && (S.depot.fondsAnteile[br] || 0) > 0) {
      const n = Math.min(S.depot.fondsAnteile[br], ueber / pr);
      if (zahle(S, konto, "depot", n * pr, "Rücknahme von Fondsanteilen")) {
        S.depot.fondsAnteile[br] -= n; fo.anteileAusgegeben -= n;
        S.depot.sparkonto += n * pr;
      }
    }
  }
  /* Bürgerdepot: Erträge der Periode fließen als Einkommen zurück aufs Haushaltskonto (nach Kapitalertragsteuer). */
  const ertrag = Math.min(S.depot.zinsenHeute || 0, kontostand(S, "depot") - 0);
  if (ertrag > 0) {
    const kest = ertrag * K.steuern.kapitalertrag;
    zahle(S, "depot", "stadt", kest, "Kapitalertragsteuer");
    zahle(S, "depot", "haushalte", ertrag - kest, "Ausschüttung Bürgerdepot");
    S.stadt.steuernPeriode += kest;
    S.haushalte.einkommenHeute += ertrag - kest;
    S.depot.sparkonto = Math.min(S.depot.sparkonto, kontostand(S, "depot"));
  }
  S.depot.zinsenHeute = 0;
  /* Bankgewinn an die Stadt. */
  const ueber = kontostand(S, "bank") - K.bank.eigenkapitalFuerStadt;
  if (ueber > 0) zahle(S, "bank", "stadt", ueber, "Gewinnabführung der Bank");
  /* Spieler legen ihre Dividenden in die eigene Firma ein. */
  for (const f of S.firmen) if (kontostand(S, f.spieler) > 0 && !f.insolvent) zahle(S, f.spieler, f.id, kontostand(S, f.spieler), "Einlage");
  /* Neue Ziel-Lagerbestände: Umsatz von 3 Markttagen. */
  for (const g of Object.keys(SIM_WAREN)) {
    /* Verbrauch und Produktion je Tag, gemittelt (Abschnitt 4). */
    const proTag = (S.verbrauchPeriode[g] / K.zeit.periodeTage + ausstossProTag(S, g)) / 2;
    S.ziel[g] = Math.max(1, proTag * K.preis.zielTage);
    S.verbrauchPeriode[g] = 0;
  }
  /* Monopolabgabe: über 60 % Marktanteil zahlt 10 % auf den Erlös dieser Ware. */
  for (const [g, anteile] of Object.entries(S.kartellamt.umsatzPeriode)) {
    const ges = Object.values(anteile).reduce((a, b) => a + b, 0);
    for (const [fid, m] of Object.entries(anteile)) {
      if (ges > 0 && m / ges > K.kartell.marktanteilGrenze && Object.keys(anteile).length > 1) {
        zahle(S, fid, "stadt", Math.min(kontostand(S, fid), m * S.preise[g] * K.kartell.monopolabgabe), "Monopolabgabe");
      }
    }
  }
  S.kartellamt.umsatzPeriode = {};
  S.stadt.steuernLetztePeriode = S.stadt.steuernPeriode; S.stadt.steuernPeriode = 0;
  S.inflationPerioden = S.inflationPerioden || [];
  S.inflationPerioden.push(S.inflation);
}

/* Automatische Spieler: bauen aus, wenn genug Geld da ist. */
function autoSpieler(S) {
  for (const f of S.firmen) {
    if (f.insolvent || f.keinAusbau) continue;
    const typ = f.branche, kosten = SIM_GEBAEUDE[typ].bauwert;
    const out = SIM_GEBAEUDE[typ].out;
    const lohnt = S.preise[out] >= stueckkosten(S, out) * 1.25 && f.gewinnHist.length >= K.zeit.periodeTage && f.gewinnHist.reduce((a, b) => a + b, 0) > 0;
    /* Automatische Firmen bauen höchstens ein Gebäude je Periode. Sonst bauen
     * alle am ersten Tag, und der Bauarbeiterlohn löst einen Konsumschub aus. */
    const baubar = S.tag - (f.letzterBau ?? -Infinity) >= K.zeit.periodeTage;
    if (f.gebaeude.length < 6 && kontostand(S, f.id) > kosten * 2.5 && lohnt && baubar) {
      f.letzterBau = S.tag;
      zahle(S, f.id, "haushalte", kosten * K.bau.anteilHaushalte, "Bau: Bauarbeiterlohn");
      zahle(S, f.id, "stadt", kosten * K.bau.anteilStadt, "Bau: Baugebühr");
      S.haushalte.einkommenHeute += kosten * K.bau.anteilHaushalte;
      f.gebaeude.push({ typ, aktiv: true });
    }
    /* Voll ausgebaut: höhere Dividendenquote, damit das Geld im Kreislauf bleibt. */
    f.dividendenquote = f.gebaeude.length >= 6 ? K.firma.dividendenMax : K.firma.dividendenquote;
  }
}

/* Ein kompletter Markttag. */
export function markttag(S) {
  S.tag++;
  schrittProduktion(S);
  schrittLoehne(S);
  schrittHaushalte(S);
  schrittVerkauf(S);
  schrittStadt(S);
  schrittPreise(S);
  schrittBank(S);
  schrittAbschluss(S);
  schrittBoerse(S);
  schrittZentralbank(S);
  autoSpieler(S);
  if (S.tag % K.zeit.periodeTage === 0) periodenende(S);
  const c = R.geldsummenCheck(S.konten, S.startgeld, S.offeneKredite);
  if (!c.ok) S.fehler.push({ tag: S.tag, ...c });
  return c;
}

export function laufe(S, tage) {
  for (let i = 0; i < tage; i++) markttag(S);
  return S;
}

/* ---- Übernahmen und Fusion (Abschnitt 11) ---- */
export function stimmanteil(f, halter) {
  return f.anteileGesamt > 0 ? (f.anteile[halter] || 0) / f.anteileGesamt : 0;
}
/* Marktanteil zweier Firmen an der Verkaufsmenge einer Ware. */
function gemeinsamerMarktanteil(S, a, b) {
  let max = 0;
  for (const anteile of Object.values(S.kartellamtLetzte || S.kartellamt.umsatzPeriode)) {
    const ges = Object.values(anteile).reduce((x, y) => x + y, 0);
    if (ges > 0) max = Math.max(max, ((anteile[a.id] || 0) + (anteile[b.id] || 0)) / ges);
  }
  return max;
}
/* Fusion: Käufer hält über seine Spielerperson Anteile am Ziel. */
export function fusioniere(S, kaeufer, ziel, { marktanteil } = {}) {
  const anteil = stimmanteil(ziel, kaeufer.spieler);
  if (anteil < K.uebernahme.schwellen.fusion) return { ok: false, grund: "Unter 75 % der Stimmen" };
  const ma = marktanteil ?? gemeinsamerMarktanteil(S, kaeufer, ziel);
  if (!R.kartellErlaubt(ma)) return { ok: false, grund: "Kartellamt: Marktanteil über 60 %" };
  /* Restaktionäre bekommen Aktien im Verhältnis der fairen Werte. */
  const verh = R.fusionsVerhaeltnis(ziel.fair, kaeufer.fair);
  for (const [h, n] of Object.entries(ziel.anteile)) {
    if (h === kaeufer.spieler) continue;
    const neu = n * verh, ganz = Math.floor(neu), bruch = neu - ganz;
    kaeufer.anteile[h] = (kaeufer.anteile[h] || 0) + ganz; kaeufer.anteileGesamt += ganz;
    if (bruch > 0) zahle(S, kaeufer.id, halterKonto(h), bruch * kaeufer.fair / kaeufer.anteileGesamt, "Bruchteil bar");
  }
  /* Zusammenlegen: Gebäude, Lager, Cash, Schulden, Verlustvortrag. Ein Hauptsitz bleibt. */
  for (const b of ziel.gebaeude) { kaeufer.gebaeude.push(b); (kaeufer.fusionsVorteil ??= {})[b.typ] = true; }
  for (const b of kaeufer.gebaeude) if (ziel.gebaeude.some(z => z.typ === b.typ)) (kaeufer.fusionsVorteil ??= {})[b.typ] = true;
  for (const g of Object.keys(SIM_WAREN)) {
    kaeufer.inv[g] += ziel.inv[g];
    for (const e of S.lager[g]) if (e.firma === ziel.id) e.firma = kaeufer.id;
  }
  zahle(S, ziel.id, kaeufer.id, kontostand(S, ziel.id), "Fusion: Kasse übertragen");
  kaeufer.kredit += ziel.kredit; ziel.kredit = 0;
  kaeufer.verlustVortrag += ziel.verlustVortrag;
  ziel.gebaeude = []; ziel.insolvent = true; ziel.fusioniert = true; ziel.anteile = {}; ziel.anteileGesamt = 0;
  return { ok: true, verhaeltnis: verh };
}
