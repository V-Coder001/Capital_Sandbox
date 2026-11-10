/* Wirtschaftssystem v2 — alle Zahlenwerte aus Abschnitt 14 der Spezifikation.
 * Im restlichen Code stehen keine festen Zahlen; alles kommt von hier.
 * Zinsen und Quoten sind Brüche (0,04 = 4 %). Geld in $. */
export const KONFIG = Object.freeze({
  zeit: { markttagSek: 60, periodeTage: 10, zinsTagesanteil: 0.1 },
  start: { kapitalSpieler: 9500, haushalte: 30000, stadt: 20000, bank: 10000 },
  produktion: {
    boost: [0.75, 0.40, 0.20],        // abnehmend, nur die ersten drei zählen
    unterhaltTag: 0.005,              // 0,5 % des Bauwerts je Markttag
    lohnStillstand: 0.5,
    stadtnetzAufschlag: 1.5,
  },
  bau: { anteilHaushalte: 0.70, anteilStadt: 0.30 },
  preis: {
    anpassung: 0.05, begrenzung: 0.05, rauschen: 0.02,
    untergrenzeStueckkosten: 0.8, zielTage: 3,
  },
  haushalte: { sparquoteBasis: 0.30, sparquoteMin: 0.20, sparquoteMax: 0.40 },
  firma: {
    gebaeudeImEigenkapital: 0.70, risikoaufschlag: 0.05,
    dividendenquote: 0.40, dividendenMax: 0.80, hauptsitz: 8000,
  },
  steuern: { umsatz: 0.10, gewinn: 0.20, kapitalertrag: 0.25 },
  stadt: {
    reserve: 5000, ausgabenquote: 0.10,
    anteilBau: 0.50, anteilEinkauf: 0.30, anteilLoehne: 0.20,
    anleiheLaufzeitTage: 20, schuldendeckelFaktor: 3,
  },
  zentralbank: {
    neutralzins: 0.04, inflationsziel: 0.03, reaktion: 1.5,
    zinsMin: 0.01, zinsMax: 0.15, schrittTag: 0.005, fixTage: 10,
  },
  bank: {
    kreditAufschlag: 0.03, sparAbschlag: 0.01, kreditlimitAnteil: 0.50,
    insolvenzTage: 3, eigenkapitalFuerStadt: 10000,
  },
  boerse: {
    anteileGruender: 60, anteileBoersengang: 40,
    rueckzug: 0.10, orderEinfluss: 0.005, kursRauschen: 0.01,
    provision: 0.01, kapitalerhoehungMax: 0.20, kapitalerhoehungAbschlag: 0.05,
    token: { serienMax: 5, erloesanteil: 0.05, risikoaufschlag: 0.15, orderEinfluss: 0.02 },
  },
  fonds: { gebuehr: 0.005, verkaufsschwelle: 0.30 },
  buergerdepot: { fonds: 0.60, anleihen: 0.20, sparkonto: 0.20, fondsMin: 0.30, fondsMax: 0.80 },
  crash: { schwelleMarkt: 0.40, schwelleKredit: 0.25, kreditAnteil: 0.90, chance: 0.10, dauerTage: 5, verkaufAnteil: 0.04, pauseTage: 20 },
  uebernahme: {
    schwellen: { meldung: 0.05, sperrminorität: 0.25, pflicht: 0.30, kontrolle: 0.50, fusion: 0.75, zwang: 0.90 },
    fondsPraemie: 0.15, fondsAngebotTage: 5, preisFensterTage: 10,
    fusionUnterhaltsvorteil: 0.10,
  },
  kartell: { marktanteilGrenze: 0.60, monopolabgabe: 0.10 },
  kartellModus: { waschverlust: 0.20, entdeckung: 0.05, strafe: 0.50 },
  insolvenzTage: 3,
  /* Vorschläge für die offenen Punkte aus Abschnitt 16 (noch nicht kalibriert,
   * die 500-Tage-Simulation steht aus). Lohn in $ je Arbeitsplatz und Markttag. */
  vorschlag: {
    lohnJeArbeitsplatz: { rohstoff: 8, veredelung: 14, hightech: 24, verkauf: 10, hauptsitz: 40 },
    arbeitsplaetze: { farm: 3, mine: 4, fabrik: 6, laden: 3, hauptsitz: 3 },
    bedarfsprofil: { lebensmittel: 0.35, energie: 0.20, baustoffe: 0.15, fahrzeuge: 0.10, elektronik: 0.10, freizeit: 0.10 },
  },
});
