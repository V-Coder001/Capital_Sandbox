/* ============================================================
 * Capital Sandbox — autoritativer Game-Server (localhost:3000)
 * Single Source of Truth: Map, Orderbuch, Anleihen, Pfändung.
 * Keine NPCs — alle Orders, Bonds und Preise kommen von Spielern.
 * ============================================================ */
import express from "express";
import http from "http";
import os from "os";
import crypto from "crypto";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
/* Vom Standort dieser Datei aus, nicht vom Arbeitsverzeichnis: Sonst liefert
 * der Server stillschweigend nichts aus, sobald er von woanders gestartet wird
 * — genau das ist beim Dev-Server passiert. */
app.use(express.static(path.join(__dirname, "public")));

/* Einladungslink: LAN-IP ermitteln, optional öffentlicher Tunnel (npm run share) */
let publicUrl = null;
function lanUrls(port) {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const i of ifaces || [])
      if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
  return urls;
}
/* Kennung dieses Serverlaufs. Der Client merkt sich die zuletzt gesehene und
 * spielt das Intro nur, wenn sie sich geändert hat — also genau einmal je
 * "sh start.sh", nicht bei jedem Neuladen des Tabs. */
const BOOT_ID = crypto.randomUUID();
app.get("/api/invite", (_req, res) => {
  res.json({ urls: [ ...(publicUrl ? [publicUrl] : []), ...lanUrls(PORT) ], bootId: BOOT_ID });
});
const httpServer = http.createServer(app);
const io = new Server(httpServer);

/* ---------- Stammdaten ---------- */
/* Produktionsschema:
 *  Enabler erzeugen Strom/Wasser/Öl → landen im Lager, sind börsenhandelbar.
 *  Produktionsgebäude haben eine Basisrate; jeder passende Boost-Rohstoff,
 *  der im Lager liegt, wird 1×/s verbraucht und boostet die Produktion.
 *  Vertriebsbüro: Bot-Kaufangebote über Erzeugnisse — farmen oder an der
 *  Börse kaufen, dann erfüllen. */
export const GOODS = {
  strom:    { name: "Strom",    cat: "Enabler" },
  wasser:   { name: "Wasser",   cat: "Enabler" },
  oel:      { name: "Öl",       cat: "Enabler" },
  obst:     { name: "Obst",     cat: "Erzeugnisse" },
  erze:     { name: "Erze",     cat: "Erzeugnisse" },
  kannabis: { name: "Kannabis", cat: "Erzeugnisse" },
  honig:    { name: "Honig",    cat: "Erzeugnisse" },
  silizium: { name: "Silizium", cat: "Erzeugnisse" },
  saft:     { name: "Saft",        cat: "Verarbeitet" },
  stahl:    { name: "Stahl",       cat: "Verarbeitet" },
  medizin:  { name: "Medikamente", cat: "Verarbeitet" },
  gebaeck:  { name: "Gebäck",      cat: "Verarbeitet" },
  diesel:   { name: "Diesel",      cat: "Verarbeitet" },
  uebernachtung: { name: "Übernachtung", cat: "Verarbeitet" },
  munition: { name: "Munition",  cat: "Verarbeitet" },
  pistole:  { name: "Pistole",   cat: "Rüstung" },
  panzer:   { name: "Panzer",    cat: "Rüstung" },
  ziegel:   { name: "Ziegel",      cat: "Baumaterial" },
  beton:    { name: "Beton",       cat: "Baumaterial" },
  elektronik: { name: "Elektronik", cat: "Baumaterial" },
  benzinauto: { name: "Benzin-Auto",  cat: "Fahrzeuge" },
  dieselauto: { name: "Diesel-Auto",  cat: "Fahrzeuge" },
  eauto:      { name: "Elektro-Auto", cat: "Fahrzeuge" },
};
/* Fahrzeuge sind Endprodukte: hoher Stückwert, dafür langsame Fertigung und ein
 * eigener Absatzweg (Autohaus). Am Handelskontor wären sie mit dessen hoher
 * Grundrate ein Gelddrucker, deshalb sind sie dort ausgenommen. */
const VEHICLES = ["benzinauto", "dieselauto", "eauto"];
/* Rüstungsgüter laufen wie Fahrzeuge über einen eigenen Absatzweg. Am
 * Handelskontor mit seiner hohen Grundrate wäre ein Panzer zu 640 $ ein
 * Gelddrucker — derselbe Grund, aus dem Autos dort ausgenommen sind. */
const WEAPONS = ["pistole", "panzer"];
/* Preise so gesetzt, dass jede Veredelungsstufe echten Mehrwert schafft. Vorher
 * waren Ziegel (20) billiger als das Erz, aus dem sie entstehen (1,8 Erz = 28,8 $)
 * — Verarbeiten hat Wert VERNICHTET, und die Rohstoffindustrie, deren ganzes
 * Geschäft das Verarbeiten ist, konnte nicht gewinnen. */
const BASEP = { strom: 1.8, wasser: 1.4, oel: 8, obst: 7, erze: 16, kannabis: 45, honig: 14, silizium: 20,
                saft: 46, stahl: 115, medizin: 140, gebaeck: 70, diesel: 42, uebernachtung: 38, ziegel: 34, beton: 82, elektronik: 98,
                benzinauto: 300, dieselauto: 360, eauto: 440,
                munition: 26, pistole: 110, panzer: 420 };

/* Industrien: jeder Spieler wählt beim Beitritt EINE — nur deren Gebäude sind
 * baubar (Shops kann jeder). Erzwingt Handel: Agrar braucht Wasser/Strom von
 * den Versorgern, alle brauchen Ziegel/Beton der Bauindustrie, Bau braucht
 * Erze der Rohstoffindustrie usw. */
const INDUSTRIES = {
  agrar:     { name: "Agrarwirtschaft" },
  rohstoff:  { name: "Rohstoff- & Bauindustrie" },
  versorger: { name: "Grundbedürfnisse (Wasser, Energie, Öl)" },
  tech:      { name: "Technologie & Elektronik" },
  touristik: { name: "Touristik" },
  ruestung:  { name: "Rüstungsindustrie" },
};
/* Baumaterial-Bedarf jedes Gebäudes: Ziegel immer, Beton ab $4.000. Elektronik
 * wird NICHT zum Bauen gebraucht, sondern zum Aufleveln bestehender Gebäude
 * (siehe upgradeCost / "upgradeBuilding"-Handler weiter unten). */
const matCost = bt => {
  const m = { ziegel: Math.ceil(bt.cost / 400) };
  /* Ausnahme Betonwerk: es selbst mit Beton zu verlangen wäre ein Henne-Ei-Problem
   * (ohne ein erstes Werk kann niemand je das Material haben, um eins zu bauen). */
  if (bt.cost >= 4000 && bt.proc?.out !== "beton") m.beton = Math.ceil(bt.cost / 2000);
  return m;
};
/* Market-Maker mit Angebots-/Nachfrage-Anker:
 * `sold` sammelt, was Spieler an Bot-Senken verkaufen (Börsen-Bot, Vertrieb,
 * Gruppenaufträge) und zerfällt langsam (~2 min Halbwertszeit). Viel Verkauf
 * drückt den Preisanker bis auf 50 % des Basispreises, Knappheit hebt ihn bis
 * 130 %. Um den Anker schwankt der Kurs weiter im kurzfristigen Band (max ±$5).
 * Folge: Monokultur (z. B. nur Plantagen) ruiniert sich ihren eigenen Preis. */
const MM = Object.fromEntries(Object.keys(GOODS).map(k =>
  [k, { price: BASEP[k], anchor: BASEP[k], sold: 0, band: Math.min(5, BASEP[k] * 0.5) }]));
const soldPressure = k => MM[k].sold * BASEP[k] / 4000;   // verkaufter Wert / $4000 = 1 Druckpunkt
function noteSold(k, qty) { MM[k].sold = Math.max(-200 / BASEP[k], MM[k].sold + qty); }

const BOOST_MULT = 0.75;   // je verfügbarem Boost-Rohstoff: +75 % Produktion

/* Gebäude-Level: Elektronik der Technologie-Industrie levelt bestehende
 * Produktions-/Verarbeitungsgebäude auf (nicht Shops) — jede Stufe +30 %
 * Ausstoß. Kosten steigen mit Stufe UND Gebäudepreis, damit teure Gebäude
 * (und hohe Stufen) spürbar mehr Elektronik verschlingen. */
const LEVEL_MAX = 5;
const levelMult = level => 1 + 0.3 * ((level || 1) - 1);
const upgradeCost = (bt, level) => ({
  elektronik: Math.ceil(bt.cost / 2500 * level),
  cash: Math.round(bt.cost * 0.35 * level),
});
const BTYPES = {
  /* Grundbedürfnisse (Versorger) */
  ewerk:      { name: "Elektrizitätswerk", cost: 2000, out: "strom",    rate: 5,    zone: "industrie", industry: "versorger" },
  wasserwerk: { name: "Wasserwerk",        cost: 1800, out: "wasser",   rate: 5,    zone: "industrie", industry: "versorger" },
  oelpumpe:   { name: "Ölpumpe",           cost: 2500, out: "oel",      rate: 1.2,  zone: "kueste",    industry: "versorger" },
  /* ---- Touristik ----
   * Die erste Branche, die vor allem VERBRAUCHT statt zu produzieren. Ein
   * Strandhotel zieht 150 Wasser und 75 Strom pro Minute — zwei davon binden
   * ein komplettes Wasserwerk. Genau das fehlte: Grundversorgung staute sich
   * bisher ungenutzt an, weil es zu wenige Abnehmer gab. Nebenbei bekommt die
   * Küstenzone endlich einen Zweck; bislang durften dort nur Ölpumpe und
   * Windpark stehen. Werte auf 2,2x Wertschöpfung gerechnet, also auf dem
   * Niveau von Ziegelei, Stahlwerk und Chipfabrik. */
  /* Campingplatz bewusst aufs freie Agrarland statt an die Küste: Dort kostet
   * jede Kachel 700 $ Freischaltung. Der Einstiegsbetrieb muss ohne Vorkasse
   * erreichbar sein — sonst steckt die Branche in einem Teufelskreis fest
   * (gemessen: der Bot verbaute sein ganzes Startkapital in Freischaltungen,
   * konnte danach keinen Strom mehr kaufen, das Hotel stand still und ohne
   * Produktion kam auch kein Geld nach). Die Küste bleibt dem Hotel. */
  campingplatz: { name: "Campingplatz", cost: 1500, out: "uebernachtung", rate: 10/60, zone: "agrar", industry: "touristik" },
  strandhotel:  { name: "Strandhotel",  cost: 2400, out: null, rate: 0, zone: "kueste", industry: "touristik",
                  proc: { in: { wasser: 2.5, strom: 1.25 }, out: "uebernachtung", rate: 10/30 } },
  brunnen:    { name: "Brunnen",           cost: 800,  out: "wasser",   rate: 2.5,  zone: "agrar",     industry: "versorger" },
  windpark:   { name: "Windpark",          cost: 2200, out: "strom",    rate: 5,    zone: "kueste",    industry: "versorger" },
  /* Agrarwirtschaft */
  farm:       { name: "Farm",              cost: 1200, out: "obst",     rate: 0.62, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  plantage:   { name: "Plantage",          cost: 2200, out: "kannabis", rate: 0.22, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  imkerei:    { name: "Imkerei",           cost: 1400, out: "honig",    rate: 0.42, zone: "agrar",     industry: "agrar", boosts: ["strom", "wasser"] },
  /* Technologie & Elektronik: liefert Elektronik — ab $5.000 Baukosten für ALLE
   * Industrien Pflicht, analog zu Ziegel/Beton der Bauindustrie. */
  siliziummine: { name: "Siliziummine",    cost: 1400, out: "silizium", rate: 10/30, zone: "industrie", industry: "tech", boosts: ["strom"] },
  /* Rohstoff- & Bauindustrie: fördert Erze und macht daraus das Baumaterial für ALLE */
  mine:       { name: "Mine",              cost: 1400, out: "erze",     rate: 0.383, zone: "industrie", industry: "rohstoff", boosts: ["strom", "oel"] },
  /* Ziegel und Elektronik waren die beiden unattraktivsten Waren der Wirtschaft
   * (Wertschöpfung 1,63x bzw. 1,71x) — obwohl JEDES Gebäude Ziegel und JEDES
   * Upgrade Elektronik braucht. Wer sich dagegen selbst versorgen konnte, verdiente
   * am besten: Medikamente 2,59x ganz ohne fremde Branche. Das Spiel belohnte damit
   * genau das Gegenteil dessen, wofür es gebaut ist. Entschärfte Rezepturen bringen
   * beide auf ~2,2x, also auf Augenhöhe mit Stahl (2,18x). Bewusst über den
   * Materialbedarf statt über den Verkaufspreis: So wird Herstellen lohnender,
   * ohne dass Bauen für alle anderen teurer wird. */
  ziegelei:   { name: "Ziegelei",          cost: 1500, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 0.3, wasser: 0.3 }, out: "ziegel", rate: 10/30 } },
  betonwerk:  { name: "Betonwerk",         cost: 4000, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 0.8, oel: 0.2 },    out: "beton",  rate: 10/30 } },
  /* Verkaufsgebäude (Shops): Ware + Stückpreis selbst festlegen; verkauft
   * dann passiv. Tempo hängt vom Preis ab: bei Ø-Kurs = volle Rate, teurer
   * = langsamer (Kundschaft überlegt), billiger = schneller (max. ×2). */
  /* Verarbeitung (gehört zur jeweiligen Industrie) */
  saftpresse: { name: "Saftpresse",  cost: 2600, out: null, rate: 0, zone: "agrar",     industry: "agrar",    proc: { in: { obst: 1.1 },            out: "saft",    rate: 10/30 } },
  pharma:     { name: "Pharma-Labor",cost: 8000, out: null, rate: 0, zone: "zentrum",   industry: "agrar",    proc: { in: { kannabis: 0.4 },        out: "medizin", rate: 10/30 } },
  baeckerei:  { name: "Bäckerei",    cost: 3400, out: null, rate: 0, zone: "zentrum",   industry: "agrar",    proc: { in: { obst: 1.1, honig: 0.35 }, out: "gebaeck", rate: 10/30 } },
  stahlwerk:  { name: "Stahlwerk",   cost: 6000, out: null, rate: 0, zone: "industrie", industry: "rohstoff", proc: { in: { erze: 1.0, oel: 0.2 },  out: "stahl",   rate: 10/30 } },
  raffinerie: { name: "Raffinerie",  cost: 4200, out: null, rate: 0, zone: "industrie", industry: "versorger", proc: { in: { oel: 0.5 },             out: "diesel",  rate: 10/30 } },
  chipfabrik: { name: "Chipfabrik",  cost: 3200, out: null, rate: 0, zone: "industrie", industry: "tech",      proc: { in: { silizium: 0.7, strom: 0.5 }, out: "elektronik", rate: 10/30 } },
  /* Fahrzeugbau der Technologie-Industrie: drei Antriebsarten, die jeweils eine
   * andere Industrie mitversorgen — Benzin zieht Öl, Diesel zieht die Raffinerie,
   * Elektro zieht Strom und viel Elektronik. Stahl braucht jedes davon. */
  autowerk:   { name: "Autowerk (Benzin)",  cost: 6500, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.04, stahl: 0.07, oel: 0.2 },   out: "benzinauto", rate: 10/95 } },
  dieselwerk: { name: "Autowerk (Diesel)",  cost: 7000, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.04, stahl: 0.07, diesel: 0.1 }, out: "dieselauto", rate: 10/95 } },
  eautowerk:  { name: "Autowerk (Elektro)", cost: 8500, out: null, rate: 0, zone: "industrie", industry: "tech", proc: { in: { elektronik: 0.1, stahl: 0.07, strom: 1.0 },  out: "eauto",      rate: 10/95 } },
  /* (Hinweis: Rohstoff & Bau sind EINE Industrie — Erzförderung und Baumaterial aus einer Hand) */
  /* Verkauf: darf JEDE Industrie bauen (industry: null) */
  markt:      { name: "Marktstand",        cost: 1000, out: null, rate: 0, zone: "zentrum",   retail: { slots: 1, base: 0.5, goods: ["obst", "saft", "honig", "gebaeck"] } },
  bauhandel:  { name: "Baustoffhandel",    cost: 2800, out: null, rate: 0, zone: "industrie", retail: { slots: 1, base: 0.8, goods: ["erze", "oel", "stahl", "ziegel", "beton", "diesel", "silizium", "elektronik"] } },
  laden:      { name: "Grüner Laden",      cost: 4500, out: null, rate: 0, zone: "zentrum",   retail: { slots: 1, base: 0.3, goods: ["kannabis", "medizin"] } },
  kontor:     { name: "Handelskontor",     cost: 3500, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.7, goods: Object.keys(GOODS).filter(g => !VEHICLES.includes(g) && !WEAPONS.includes(g)) } },
  autohaus:   { name: "Autohaus",           cost: 5000, out: null, rate: 0, zone: "zentrum",   retail: { slots: 2, base: 0.30, goods: VEHICLES } },
  /* ---- Rüstungsindustrie ----
   * Die Branche am Ende der Kette: Sie verarbeitet, was Rohstoff und
   * Technologie liefern, und erzeugt die wertvollsten Güter im Spiel. Ihre
   * Werte sind auf 2,2x Wertschöpfung und rund fünf Minuten Amortisation
   * gerechnet, also auf dem Niveau von Stahlwerk und Chipfabrik. Der Einstieg
   * über die Munitionsfabrik ist billig und braucht nur Erze und Öl; wer
   * Panzer bauen will, hängt dagegen an drei fremden Branchen gleichzeitig. */
  munitionsfabrik: { name: "Munitionsfabrik", cost: 1400, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { erze: 0.18, oel: 0.13 }, out: "munition", rate: 10/30 } },
  waffenschmiede:  { name: "Waffenschmiede",  cost: 4000, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { stahl: 0.055, elektronik: 0.030, munition: 0.075 }, out: "pistole", rate: 10/45 } },
  panzerwerk:      { name: "Panzerwerk",      cost: 8000, out: null, rate: 0, zone: "industrie", industry: "ruestung",
                     proc: { in: { stahl: 0.105, elektronik: 0.055, diesel: 0.070 }, out: "panzer", rate: 10/95 } },
  waffenhandel:    { name: "Waffenhandel",    cost: 5200, out: null, rate: 0, zone: "zentrum",
                     retail: { slots: 2, base: 0.30, goods: WEAPONS } },
  /* Werbeagentur: produziert nichts und verkauft nichts. Sie schaltet
   * Kampagnen frei, die den Preis anheben, den die Kundschaft in den EIGENEN
   * Läden ohne Tempoverlust akzeptiert. Darf jede Industrie bauen. */
  werbeagentur: { name: "Werbeagentur",     cost: 3500, out: null, rate: 0, zone: "zentrum",   ad: true },
};
/* Verkaufstempo eines Shops: (Ø-Kurs / eigener Preis)² — gedeckelt bei ×2 */
/* Verkaufstempo eines Shops: (Ø-Kurs / eigener Preis)² — gedeckelt bei ×2.
 * Mit `ref` lässt sich der Bezugspreis anheben: genau das macht Werbung. */
const shopSpeed = (good, price, ref = MM[good].price) => Math.min(2, Math.pow(ref / price, 2));

/* Ein Laden-Slot bewegte bisher gleich viele STÜCK pro Sekunde, egal ob Strom
 * für 1,80 $ oder ein Auto für 300 $. Dadurch hätte ein Elektrizitätswerk mit
 * 5 Strom/s über sieben Slots gebraucht, um seinen Ausstoß überhaupt loszuwerden
 * (bei 1,30 $/s je Slot), während ein Autowerk mit 0,15 Slots auskam. Der
 * Durchsatz wird deshalb am Stückwert skaliert: billige Massenware fließt
 * schneller durch den Laden als teure Einzelstücke. Der Exponent unter 1 dämpft
 * das, damit teure Ware je Slot weiterhin mehr einbringt — sie ist ja auch
 * aufwendiger herzustellen. Bezug ist der Basispreis, nicht der Tageskurs:
 * sonst entstünde eine Rückkopplung (Preis fällt -> mehr Durchsatz -> Preis
 * fällt weiter). */
const RETAIL_REF = 30, RETAIL_K = 0.75;
const retailFlow = good => Math.min(10, Math.max(0.30, Math.pow(RETAIL_REF / BASEP[good], RETAIL_K)));

/* ---------- Werbung ----------
 * Reichweite ist ein Vorrat, der laufend zerfällt: gebuchte Kampagnen füllen ihn
 * auf, ohne Nachschub ist er nach gut zwei Minuten praktisch weg und die Preise
 * fallen auf den Ø-Kurs zurück. Wie hoch der Aufschlag maximal reichen kann,
 * hängt an der Zahl der eigenen Werbeagenturen — ohne Agentur wirkt gar nichts. */
const AD_DECAY = 0.988;          // je Tick, entspricht ~1,2 %/s (Halbwertszeit ~57 s)
/* Preise gegen den tatsächlichen Nutzen gerechnet: eine volle Reichweite wirkt
 * wegen des Zerfalls wie rund 83 Sekunden Vollaufschlag. Bei 20 % Aufschlag
 * bringt sie also etwa 16,6 Sekunden Ladenumsatz zusätzlich. Zu den alten
 * Preisen hätte sich eine Kampagne erst ab 300–480 $/s Ladenumsatz gelohnt —
 * das schafft kein Laden im Spiel, Werbung war schlicht eine Geldfalle.
 * Jetzt liegt der Break-even bei rund 55 $/s — ein gut beliefertes Handelskontor
 * trägt eine Kampagne also gerade so, zwei Läden lohnen sich deutlich. Wer die
 * Reichweite dauerhaft oben hält, zahlt rund 11 $/s Unterhalt. */
const AD_PACKAGES = {
  klein:  { name: "Aushänge & Flyer",    cost:  280, reach: 30 },
  mittel: { name: "Radio & Lokalpresse", cost:  620, reach: 70 },
  gross:  { name: "Stadtweite Kampagne", cost:  950, reach: 100 },
};
const adAgenturen = p => G.map.filter(t => t.owner === p.id && BTYPES[t.btype]?.ad).length;
const adCap = n => n <= 0 ? 0 : Math.min(0.40, 0.20 + 0.10 * (n - 1));
/* Preisaufschlag, den die Kundschaft ohne Tempoverlust mitgeht (1 = keine Werbung) */
const adBoost = p => 1 + adCap(adAgenturen(p)) * Math.min(100, p.adReach || 0) / 100;
const PRODUCTS = Object.keys(GOODS);   // was Städte in Großaufträgen nachfragen — mittlerweile alle Waren

/* Gruppenaufträge: eine Stadt braucht Waren, alle zahlen gemeinsam ein.
 * Bei Abschluss erhält jeder Einzahler Ø-Kurs × 2 je geliefertem Stück. */
const CITIES = ["Hamcity", "Bergstadt", "Neuhafen", "Ostbrück", "Klarwald", "Südport"];
const GROUP_PAYOUT_MULT = 2;
const GROUP_TTL = 300;                                          // Laufzeit eines Großauftrags: 5 Minuten
const GROUP_GAP = () => 15 + Math.floor(Math.random() * 30);    // Pause danach: 15–45 s
const GROUP_VALUE = +process.env.GROUP_VALUE || 0;   // Testgröße überschreibbar

/* Aktien: jede Firma startet mit 4 Anteilen (= 25 %-Schritten) im Eigenbesitz.
 * Reicht das Kapital nicht, können eigene Anteile an der Börse verkauft werden —
 * Käufer bekommen dafür alle 10 min einen Anteil vom laufenden Erlös (Dividende). */
const BANK_POS = [7, 6];         // feste Position der Stadtbank im Zentrum
const NEWS_POS = [10, 6];        // Nachrichtenzentrale, ebenfalls im Zentrum
const SHARE_BID_TTL = 180;       // Kaufanfragen verfallen nach 3 Minuten
const CONTRACT_TTL = 120;        // Direktangebote verfallen nach 2 Minuten
const REV_WINDOW_MIN = 10;       // Umsatzfenster der Firmenbewertung: 10 Minuten
const DIVIDEND_INTERVAL = 600;   // Ticks (1×/s) = 10 min
const DIVIDEND_RATE = 0.25;      // Anteil des seit der letzten Ausschüttung erzielten Erlöses

/* Reconnect: Verbindung weg ≠ sofort raus — erst nach dieser Gnadenfrist ohne
 * Rückkehr wird der Spieler endgültig entfernt (siehe rejoin-Handler & runTick). */
const RECONNECT_GRACE_MS = 5 * 60 * 1000;   // 5 Minuten

/* $7.000 Start: deckt die Tutorial-Gebäude Farm+Plantage+Vertriebsbüro ($5.900) plus Puffer */
/* Siegziel $250k ≈ 1–2 h Partie (Playtest: ~$1k/min Anfangswachstum, skaliert später).
 * Überschreibbar: WIN_NW=1000000 npm start */
/* $8.500 deckt in jeder Industrie 2 Grundgebäude + 1 Verarbeitungsgebäude:
 * Agrar 2×Farm+Saftpresse=$5.600, Rohstoff 2×Mine+Betonwerk=$8.000,
 * Versorger Brunnen+Wasserwerk+Ölpumpe=$5.100, Tech 2×Siliziummine+Chipfabrik=$6.000
 * (Zonen-Freischaltung kommt on top, dafür gibt's die Starter-Aufgabe +$1.000). */
const START_CASH = +process.env.START_CASH || 9500, MAP_W = 26, MAP_H = 26;

/* Spielergesteuerte Texte — Firmenname und Chatnachricht — landen im Client an
 * rund einem Dutzend Stellen in innerHTML: Kopfleiste, Kurstafel, Orderbuch,
 * Anleihenliste, Verträge, Chat und jetzt auch im Marktbericht. Eine einzige
 * dieser Stellen ohne Maskierung genügt, damit ein Mitspieler fremden Code in
 * den Browsern aller anderen ausführt. Statt jede Ausgabestelle einzeln
 * abzusichern — und dabei eine zu übersehen — wird hier an der Quelle
 * maskiert: Was gespeichert wird, ist bereits unschädlich.
 * Vergleiche bleiben stimmig, weil beide Seiten dieselbe Form sehen. */
const sicherText = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Die Firmenfarbe wurde ungeprüft übernommen und landet im Client in
 * Stil-Attributen (style="background:${p.color}"). Ein Wert wie
 * '#fff" onmouseover="…' bricht dort aus dem Attribut aus und hängt einen
 * Ereignis-Handler an — Maskieren allein hilft nicht, weil eine Farbe
 * ohnehin nur aus Ziffern und Buchstaben bestehen darf. Deshalb hart
 * geprüft statt entschärft: Was nicht wie eine Hex-Farbe aussieht, wird
 * durch die Vorgabe ersetzt. */
const STANDARDFARBE = "#e8b544";
const sichereFarbe = c => /^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c) : STANDARDFARBE;
/* Rundenziel: Default $250k ≈ 1–2 h; der ERSTE Spieler der Runde legt es beim
 * Beitreten fest (Auswahl im Join-Screen). Env-Override: WIN_NW=... npm start */
let WIN_NW = +process.env.WIN_NW || 250_000;
const WIN_CHOICES = [100_000, 250_000, 500_000, 1_000_000, 10_000_000];
/* Freischaltung von Zonen: bewusst als Formalität, nicht als Kapitalgrab.
 * Die Agrarzone ist frei, Industrie und Küste nicht — bei 900/2.500 $ je Kachel
 * steckte ein Versorger 40 % seines Startkapitals in reinen Landzutritt, der
 * nichts produziert, ein Agrarspieler dagegen 0 %. Bei gleicher Rendite je
 * Dollar entscheidet aber genau das, wer schneller wächst. Mit 300/700 $ bleibt
 * die Zone eine bewusste Entscheidung, ohne die Branche auszubremsen. */
const UNLOCK = { industrie: 300, kueste: 700 };
const ROOMS = ["[Game]", "[Sales]", "[DE] Spielthemen", "[DE] Handel", "[DE] Plauderecke"];

/* ---------- Karte (deterministisch, damit alle Clients identisch rendern) ---------- */
function buildMap() {
  /* Deterministisches Pseudo-Rauschen → organische Küste, identisch auf allen Clients */
  const noise = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  /* Wasserfeld zuerst berechnen, dann 2× Mehrheits-Glättung gegen Sprenkel */
  let wat = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    /* schmaler Küstenstreifen (Wasser nur ~3 Randreihen) — Land ist wertvoller */
    const coastDepth = (y - (MAP_H - 3.2)) + Math.max(0, (x - (MAP_W - 6)) * 0.4 + (y - (MAP_H - 8)) * 0.3) * ((x > MAP_W - 7 && y > MAP_H - 9) ? 1 : 0);
    wat.push(coastDepth + (noise(x, y) - 0.5) * 1.4 > 0);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = [...wat];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      let n = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) { n += (yy >= MAP_H) ? 1 : 0; c++; continue; }
        n += wat[yy * MAP_W + xx] ? 1 : 0; c++;
      }
      next[y * MAP_W + x] = n > c / 2;
    }
    wat = next;
  }
  /* Große Inseln in der Bucht: bebaubares Küsten-Land statt leerem Wasser */
  const ISLANDS = [[5, MAP_H - 1.6, 2.1], [14, MAP_H - 1.9, 2.6], [22, MAP_H - 2.2, 1.9]];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (ISLANDS.some(([ix, iy, r]) => Math.hypot(x - ix, y - iy) < r)) wat[y * MAP_W + x] = false;
  }
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const water = wat[y * MAP_W + x];
    const road = !water && (x % 6 === 3 || y % 6 === 3);
    /* Zonen: rundes Zentrum, Industrie-Band rechts, Küstenstreifen am Wasser */
    let zone = "agrar";
    if (water) zone = "wasser";
    else if (Math.hypot(x - 7, y - 6) < 8.5) zone = "zentrum";
    else if (y >= MAP_H - 9) zone = "kueste";
    else if (x >= MAP_W - 9) zone = "industrie";
    const park = !water && !road && (x * 7 + y * 13) % 17 === 0;   // Parks/Palmen vor Sperrzonen
    const field = !water && !road && !park && zone === "agrar" && (x * 5 + y * 11) % 13 === 0; // Deko-Felder (bebaubar)
    const locked = !water && !road && !park && (zone === "industrie" || zone === "kueste");
    tiles.push({ x, y, zone, road, water, locked, unlockCost: UNLOCK[zone] || 0,
      park, field, owner: null, btype: null, lien: false });
  }
  /* Nachbarschafts-Pass: Strand am Wasserrand, Tiefwasser, Felsen im Meer */
  const at = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : tiles[y * MAP_W + x];
  for (const t of tiles) {
    const nb = [at(t.x+1,t.y), at(t.x-1,t.y), at(t.x,t.y+1), at(t.x,t.y-1)];
    if (!t.water && nb.some(n => n?.water)) t.sand = true;                        // Strandsaum
    if (t.water && !nb.some(n => n && !n.water)) t.deep = true;                   // offenes Meer
    if (t.water && (t.x * 3 + t.y * 17) % 19 === 0) t.rock = true;                // Felsen
  }
  /* Die Stadtbank steht fest im Zentrum und gehört niemandem: hier handeln alle
   * Spieler Firmenanteile. Kein Bauplatz, kein Besitzer, nicht freischaltbar. */
  const bank = tiles.find(t => t.x === BANK_POS[0] && t.y === BANK_POS[1] && !t.water)
            || tiles.find(t => t.zone === "zentrum" && !t.water && !t.road && !t.park);
  if (bank) Object.assign(bank, { bank: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
  /* Nachrichtenzentrale: gehört wie die Bank der Stadt und ist unbebaubar. */
  const news = tiles.find(t => t.x === NEWS_POS[0] && t.y === NEWS_POS[1] && !t.water)
    || tiles.find(t => t.zone === "zentrum" && !t.water && !t.bank && !t.road);
  if (news) Object.assign(news, { news: true, road: false, park: false, field: false, locked: false, unlockCost: 0 });
  return tiles;
}

/* ---------- Spielzustand ---------- */
const G = {
  map: buildMap(),
  players: {},          // persistente Spieler-ID (Reconnect-Token) -> Player
  socketToPid: {},       // aktuelle socket.id -> persistente Spieler-ID
  orders: [],           // {id, side:'sell'|'buy', good, qty, price, playerId, ts}
  bonds: [],            // {id, issuerId, holderId|null, principal, rate, termLeft, strikes}
  auctions: [],         // {id, tileIdx, btype, minBid, bestBid, bestBidder, tLeft}
  lastTrade: {},        // good -> Preis des letzten echten Trades (Ticker)
  priceHist: {},        // good -> Kursverlauf, alle 10 s ein Punkt (Chart)
  news: [],             // Marktberichte der Nachrichtenzentrale, neueste zuerst
  firmHist: {},         // pid  -> Firmenwert-Verlauf, gleiche Taktung
  chat: Object.fromEntries(ROOMS.map(r => [r, []])),
  contracts: [],        // {id, fromId, toId, good, qty, price, status}
  tick: 0, winner: null, report: null,
  /* Warteraum: die Runde läuft erst, wenn der Host sie startet — bis dahin
   * sammeln sich die Mitspieler, ohne dass Produktion oder Bots anlaufen. */
  started: false, hostId: null,
  groupOrder: null, nextGroupIn: 20,   // erster Stadt-Auftrag nach 20 s
  shareListings: [],     // {id, companyId, sellerId, count(1-4 = 25%-Schritte), price, ts, toId}
  shareBids: [],         // Kaufanfragen an eine Firma: {id, companyId, bidderId, count, price, ttl}
  nextDividendIn: DIVIDEND_INTERVAL,
};
let nextId = 1;
const id = () => nextId++;

const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) ? null : G.map[y * MAP_W + x];

function newPlayer(pid, name, color, industry, socketId) {
  const inv = Object.fromEntries(Object.keys(GOODS).map(k => [k, 0]));
  inv.ziegel = 22;   // reicht für 2 Grundgebäude + 1 Verarbeitungsgebäude (max. 21 nötig), danach Börse
  /* Beton von Anfang an: alles ab 4.000 $ Baukosten verlangt welchen, hergestellt
   * wird er aber ausschließlich im Betonwerk der Rohstoffindustrie. Spielt niemand
   * diese Industrie, wäre sonst der gesamte zweite Bauabschnitt für alle gesperrt.
   * 6 Stück decken genau ein Gebäude bis 12.000 $ ab — danach führt der Weg über
   * die Börse. */
  inv.beton = 6;
  return { id: pid, name, color, industry, industries: [industry], cash: START_CASH, xp: 0, lvl: 1,
    inv,
    equityAvg: {},     // companyId -> Ø-Einstand je 25-%-Block (Durchschnittsmethode)
    quests: {},        // Starter-Aufgaben: {id: {n, done}}
    tx: [],            // Transaktions-Log: {t, cat, text, amt}
    sales: {},         // je Ware: {botQty, botRev, playerQty, playerRev, buyQty, buyCost}
    /* Laufende Summen für die Rundenauswertung. p.revenue taugt dafür nicht —
     * das wird bei jeder Dividende auf 0 gesetzt, und revBuckets deckt nur die
     * letzten 10 Minuten ab. */
    stats: { produziert: {}, umsatz: 0, ausgaben: 0, gebaut: 0, abgerissen: 0,
             grossauftraege: 0, besterHandel: null, dividendeRein: 0, dividendeRaus: 0,
             werbung: 0, anteileGekauft: 0, anteileVerkauft: 0, fusionen: 0,
             zinsErtrag: 0, zinsAufwand: 0, aufgelevelt: 0 },
    fin: { zinsErtrag: 0, zinsAufwand: 0 },
    nwHist: [],        // Nettovermögens-Verlauf für den Chart
    equity: { [pid]: 4 },   // Cap-Table: holderId -> Anzahl 25%-Anteile (Summe immer 4)
    adReach: 0,        // Werbe-Reichweite 0–100, zerfällt laufend (siehe AD_DECAY)
    revenue: 0,        // Erlös seit letzter Dividendenausschüttung (Handel/Shop/Großaufträge)
    /* Rollendes Umsatzfenster: ein Eimer je Minute, für die Firmenbewertung an
     * der Bank. p.revenue allein taugt dafür nicht — das wird alle 10 min auf 0
     * gesetzt und sähe an der Börse aus wie ein Umsatzeinbruch. */
    revBuckets: new Array(REV_WINDOW_MIN).fill(0),
    socketId,          // aktuell aktive Socket-Verbindung, null = getrennt
    disconnected: false, disconnectedAt: null };
}
/* Private Events an die AKTUELLE Verbindung eines Spielers schicken — pid bleibt über
 * Reconnects stabil, socketId wechselt bei jeder neuen Verbindung. */
function emitTo(pid, event, payload) {
  const sid = G.players[pid]?.socketId;
  if (sid) io.to(sid).emit(event, payload);
}

/* ---------- Bewertung ----------
 * Zwei Ebenen, bewusst getrennt:
 *   substance(firma)  = was die Firma selbst besitzt (Bargeld, Lager, Gebäude,
 *                       Anleihen abzüglich Schulden). Das ist der Firmenwert.
 *   netWorth(spieler) = die Summe seiner Beteiligungen, jeweils prozentual auf
 *                       die Substanz der jeweiligen Firma — auch auf die eigene.
 * Dadurch ist ein gekaufter Anteil ein echter Vermögenswert, und Anteilshandel
 * bläht das Gesamtvermögen im Spiel nicht künstlich auf: was der Käufer an
 * Beteiligung gewinnt, gibt der Verkäufer ab. */
let bldCache = { tick: -1, byOwner: null };
function buildingValueOf(pid) {
  /* Gebäudewerte einmal je Tick über die ganze Karte summieren statt für jede
   * Bewertung erneut — netWorth ruft substance() sonst für jeden Spieler auf
   * und läuft dabei jedes Mal über alle 676 Kacheln. */
  if (bldCache.tick !== G.tick) {
    const by = {};
    for (const t of G.map) if (t.owner && t.btype) by[t.owner] = (by[t.owner] || 0) + BTYPES[t.btype].cost * 0.7;
    bldCache = { tick: G.tick, byOwner: by };
  }
  return bldCache.byOwner[pid] || 0;
}
function substance(p) {
  let v = p.cash + buildingValueOf(p.id);
  for (const k in p.inv) v += p.inv[k] * MM[k].price;
  for (const b of G.bonds) {
    if (b.holderId === p.id) v += b.principal;
    if (b.issuerId === p.id && b.holderId) v -= b.principal;
  }
  return v;
}
function netWorth(p) {
  let nw = 0;
  for (const o of Object.values(G.players)) {
    const blocks = o.equity[p.id] || 0;
    if (blocks > 0) nw += substance(o) * (blocks / 4);
  }
  /* Anteile, die gerade zum Verkauf angeboten sind, liegen in Verwahrung und
   * fehlen in der Cap-Table — sie gehören aber weiter dem Anbieter. */
  for (const l of G.shareListings) {
    const co = G.players[l.companyId];
    if (co && (l.sellerId ?? l.companyId) === p.id) nw += substance(co) * (l.count / 4);
  }
  return nw;
}
/* Jeder Erlös läuft hierüber, damit er sowohl in die Dividende als auch in das
 * rollende Umsatzfenster der Firmenbewertung eingeht. */
function addRevenue(p, amt) {
  if (!(amt > 0)) return;
  p.stats.umsatz += amt;
  p.revenue += amt;
  p.revBuckets[0] += amt;
  questProg(p, "revenue", amt);   // zählt jeden Erlös, egal aus welcher Industrie
}
const rev10 = p => p.revBuckets.reduce((a, b) => a + b, 0);
/* Marktwert einer Firma ist schlicht ihre Substanz — ein 25 %-Block kostet ein
 * Viertel davon. Der Handelsgewinn entsteht dadurch, dass die Firma wächst:
 * früh gekauft, später zu einem höheren Nettovermögen verkauft. Der Umsatz der
 * letzten 10 Minuten fließt NICHT in den Preis ein, sondern wird nur angezeigt —
 * er ist der Hinweis darauf, wie schnell diese Substanz gerade wächst.
 * Nach unten begrenzt, damit auch eine überschuldete Firma handelbar bleibt. */
const companyValue = p => Math.max(500, substance(p));
const blockPrice = p => Math.round(companyValue(p) / 4);   // Preis für 25 %
/* Ein zurückgezogenes oder hinfälliges Angebot gibt die verwahrten Anteile an
 * den Verkäufer zurück — sonst verschwänden sie aus der Cap-Table und die Summe
 * der Anteile einer Firma wäre nicht mehr 100 %. */
function returnListingToSeller(l) {
  const company = G.players[l.companyId];
  const sellerId = l.sellerId ?? l.companyId;
  if (!company || !G.players[sellerId]) return;
  company.equity[sellerId] = (company.equity[sellerId] || 0) + l.count;
}
function debtOf(p) {
  return G.bonds.filter(b => b.issuerId === p.id && b.holderId).reduce((s, b) => s + b.principal, 0);
}
// Rating rein aus Nettovermögen & Verschuldungsgrad des Spielers — keine Fantasiewerte
function rating(p) {
  const nw = netWorth(p), debt = debtOf(p);
  if (nw <= 0) return "D";
  const lever = debt / Math.max(1, nw + debt);
  const steps = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
  let i = Math.min(6, Math.floor(lever * 8));
  if (nw < 2000) i = Math.min(6, i + 2);       // kleine Firmen = riskanter
  else if (nw > 100000) i = Math.max(0, i - 1);
  return steps[i];
}

/* ---------- Matching-Engine (reines P2P) ----------
 * Sell-Orders und Buy-Orders liegen im selben Buch. Beim Einstellen einer
 * Order wird sofort gegen die Gegenseite gematcht (Preis-Zeit-Priorität);
 * der Rest bleibt als Limit-Order stehen. Trades setzen den Tickerpreis. */
function escrowForOrder(p, o) {           // Sell: Ware sperren, Buy: Geld sperren
  if (o.side === "sell") { p.inv[o.good] -= o.qty; }
  else { p.cash -= o.qty * o.price; }
}
function refundOrder(o) {
  const p = G.players[o.playerId];
  if (!p) return;
  if (o.side === "sell") p.inv[o.good] += o.qty;
  else p.cash += o.qty * o.price;
}
function settleTrade(good, qty, price, buyerId, sellerId) {
  const buyer = G.players[buyerId], seller = G.players[sellerId];
  const gname = GOODS[good].name;
  if (buyer) { buyer.inv[good] += qty; gainXp(buyer, 2);
    const r = salesRec(buyer, good); r.buyQty += qty; r.buyCost += qty * price;
    buyer.stats.ausgaben += qty * price;
    logTx(buyer, "Kauf", `Kauf ${qty}× ${gname} von ${seller?.name ?? "?"}`, -qty * price); }
  if (seller) { seller.cash += qty * price; addRevenue(seller, qty * price); gainXp(seller, 2);
    const r = salesRec(seller, good); r.playerQty += qty; r.playerRev += qty * price;
    const summe = qty * price;
    if (!seller.stats.besterHandel || summe > seller.stats.besterHandel.summe)
      seller.stats.besterHandel = { good, qty, price, summe, partner: buyer?.name ?? "?" };
    logTx(seller, "Verkauf", `Verkauf ${qty}× ${gname} an ${buyer?.name ?? "?"}`, qty * price); }
  G.lastTrade[good] = price;
  io.emit("trade", { good, qty, price, buyer: buyer?.name, seller: seller?.name });
}
function matchOrder(order) {
  const opp = order.side === "sell" ? "buy" : "sell";
  const book = G.orders
    .filter(o => o.good === order.good && o.side === opp && o.playerId !== order.playerId)
    .sort((a, b) => (opp === "buy" ? b.price - a.price : a.price - b.price) || a.ts - b.ts);
  for (const o of book) {
    if (order.qty <= 0) break;
    const crosses = order.side === "sell" ? o.price >= order.price : o.price <= order.price;
    if (!crosses) break;
    const qty = Math.min(order.qty, o.qty);
    const price = o.price;                        // Preis der liegenden Order gilt
    const buyerId  = order.side === "buy"  ? order.playerId : o.playerId;
    const sellerId = order.side === "sell" ? order.playerId : o.playerId;
    // Escrow-Ausgleich: Buy-Order hat ggf. mehr Geld gesperrt als der Ausführungspreis
    if (order.side === "buy" && order.price > price) G.players[buyerId].cash += qty * (order.price - price);
    settleTrade(order.good, qty, price, buyerId, sellerId);
    order.qty -= qty; o.qty -= qty;
    if (o.qty <= 0) G.orders.splice(G.orders.indexOf(o), 1);
  }
  if (order.qty > 0) G.orders.push(order);
}

/* ---------- Gruppenaufträge ---------- */
function spawnGroupOrder() {
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const nGoods = Math.random() < 0.5 ? 1 : 2;
  const goods = [...PRODUCTS].sort(() => Math.random() - 0.5).slice(0, nGoods);
  const needs = {};
  /* Zielwert je Ware, skaliert mit der Spielerzahl — die mit Abstand
   * bestvergütete Absatzquelle (Ø×2 vs. Vertrieb ×1,2–1,6), aber nur gemeinsam
   * schaffbar. Die Menge ist auf die kurze Laufzeit von 5 Minuten ausgelegt:
   * lieber viele kleine Aufträge in Folge als ein riesiger, der halb liegen
   * bleibt. Über die Zeit kommt dadurch mehr zusammen, nicht weniger. */
  const playerScale = Math.max(1, 0.5 + Object.keys(G.players).length * 0.5);
  for (const g of goods) {
    const targetVal = GROUP_VALUE || (700 + Math.random() * 900) * playerScale;
    needs[g] = { req: Math.max(3, Math.round(targetVal / MM[g].price)), have: 0,
      pay: Math.round(MM[g].price * GROUP_PAYOUT_MULT * 100) / 100 };   // Stückpreis beim Spawn fixiert
  }
  G.groupOrder = { id: id(), city, needs, contrib: {}, ttl: GROUP_TTL };
  const txt = Object.entries(needs).map(([g, n]) => `${n.req}× ${GOODS[g].name}`).join(" und ");
  const vol = Object.entries(needs).reduce((s, [g, n]) => s + n.req * n.pay, 0);
  io.emit("notice", { text: `GROSSAUFTRAG: ${city} braucht ${txt} — Gesamttopf ~${Math.round(vol).toLocaleString("de-DE")} $ (Ø×${GROUP_PAYOUT_MULT}, beste Vergütung im Spiel)! ${GROUP_TTL / 60} Minuten Zeit.` });
}
function finishGroupOrder() {
  const o = G.groupOrder;
  for (const [pid, goods] of Object.entries(o.contrib)) {
    const p = G.players[pid];
    if (!p) continue;
    let sum = 0;
    for (const [g, qty] of Object.entries(goods)) sum += qty * o.needs[g].pay;   // fixierter Stückpreis
    p.cash += sum; addRevenue(p, sum); gainXp(p, 40); p.stats.grossauftraege++;
    logTx(p, "Gruppenauftrag", `${o.city} beliefert (Ø×${GROUP_PAYOUT_MULT})`, sum);
    emitTo(pid, "notice", { text: `${o.city} abgeschlossen — deine Auszahlung: ${Math.round(sum)} $` });
  }
  io.emit("notice", { text: `Gruppenauftrag für ${o.city} erfüllt! Alle Einzahler wurden ausgezahlt.` });
  G.groupOrder = null; G.nextGroupIn = GROUP_GAP();
}

/* ---------- Aktien: Dividendenausschüttung alle 10 min ----------
 * Ein Anteil (DIVIDEND_RATE) des seit der letzten Ausschüttung erzielten
 * Erlöses wird proportional zu den verkauften 25%-Anteilen an deren Halter
 * ausgezahlt (Eigenbesitz braucht nicht bewegt zu werden — bleibt einfach
 * im Firmen-Cash). Der Rest-Erlös verbleibt vollständig bei der Firma. */
/* Einstandswert einer Beteiligung mitführen. Ohne ihn zeigt das Depot zwar den
 * aktuellen Wert, aber nicht, ob die Beteiligung im Plus oder im Minus steht —
 * und genau das ist die Frage beim Verkaufen.
 * Durchschnittsmethode: Der Ø-Preis JE BLOCK ändert sich nur beim Zukauf, ein
 * Verkauf lässt ihn unberührt. Das spart die fehleranfällige Fortschreibung an
 * jedem Abgang. Bereits zum Verkauf eingestellte Blöcke liegen in Verwahrung
 * (equity ist dann schon reduziert) und werden mitgezählt — sonst würde ein
 * Zukauf während eines offenen Angebots den Schnitt verfälschen. */
function merkeEinstand(kaeufer, company, count, preis) {
  const verwahrt = G.shareListings
    .filter(l => l.companyId === company.id && (l.sellerId ?? l.companyId) === kaeufer.id)
    .reduce((a, l) => a + l.count, 0);
  const vorher = (company.equity[kaeufer.id] || 0) + verwahrt;   // vor dem Zukauf aufrufen
  const alt = kaeufer.equityAvg[company.id] || 0;
  const nachher = vorher + count;
  if (nachher > 0) kaeufer.equityAvg[company.id] = (alt * vorher + preis) / nachher;
}

/* ---------- Nachrichtenzentrale ----------
 * Alle zwei Minuten ein Marktbericht in den Chat. Die Lage im Spiel ist zwar
 * vollständig sichtbar, aber über acht Panels verteilt: Wer gerade baut,
 * bemerkt weder einen einbrechenden Kurs noch einen Konkurrenten, der
 * davonzieht. Der Bericht fasst genau das zusammen, was sonst niemand
 * nachschlägt — und nutzt dieselben Verläufe, die auch die Charts speisen. */
const NEWS_INTERVAL = 120;   // Ticks (1x/s) = 2 min
const NEWS_FENSTER = 12;     // Verlaufspunkte à 10 s = ebenfalls 2 min

function veraenderung(reihe, fenster) {
  if (!reihe || reihe.length < 2) return null;
  const von = reihe[Math.max(0, reihe.length - 1 - fenster)], bis = reihe[reihe.length - 1];
  if (!von) return null;
  return (bis / von - 1) * 100;
}

/* Aufzählung in Fließtext: „A, B und C". Verben werden im Text immer auf die
 * LÄNGE der Liste bezogen formuliert, nie auf das Geschlecht der Ware — sonst
 * müsste jedes Gut einen Genus-Eintrag bekommen, nur damit „Erze klettert"
 * nicht falsch dasteht. */
function liste(teile) {
  if (teile.length <= 1) return teile[0] || "";
  return teile.slice(0, -1).join(", ") + " und " + teile[teile.length - 1];
}
const proz = v => (v > 0 ? "+" : "−") + Math.abs(v).toFixed(0) + " Prozent";
const geld = v => v.toFixed(2).replace(".", ",") + " $";
const wucht = v => Math.abs(v) >= 25 ? "sprunghaft" : Math.abs(v) >= 12 ? "deutlich" : "leicht";

function marktbericht() {
  const wandel = k => veraenderung(G.priceHist[k], NEWS_FENSTER);
  const waren = Object.keys(GOODS)
    .map(k => ({ k, name: GOODS[k].name, v: wandel(k), kurs: MM[k].price }))
    .filter(x => x.v != null && Math.abs(x.v) >= 2)
    .sort((a, b) => b.v - a.v);
  const hoch = waren.filter(x => x.v > 0).slice(0, 3);
  const tief = waren.filter(x => x.v < 0).slice(-3).reverse();

  const knapp = Object.keys(GOODS).map(k => {
    const angebot = G.orders.filter(o => o.good === k && o.side === "sell").reduce((a, o) => a + o.qty, 0);
    const nachfrage = G.orders.filter(o => o.good === k && o.side === "buy").reduce((a, o) => a + o.qty, 0);
    return { k, name: GOODS[k].name, nachfrage, leer: angebot === 0 && nachfrage >= 10 };
  }).filter(x => x.leer).sort((a, b) => b.nachfrage - a.nachfrage);

  const firmen = Object.values(G.players)
    .map(p => ({ p, v: veraenderung(G.firmHist[p.id], NEWS_FENSTER) }))
    .filter(x => x.v != null && x.v >= 1).sort((a, b) => b.v - a.v);
  const rang = Object.values(G.players).sort((a, b) => netWorth(b) - netWorth(a));

  /* ---- Schlagzeile: die auffälligste Entwicklung zuerst ---- */
  let schlagzeile;
  if (knapp.length && knapp[0].nachfrage >= 40)
    schlagzeile = `${knapp[0].name} ausverkauft — ${knapp[0].nachfrage} Einheiten gesucht, keine im Angebot`;
  else if (hoch.length && hoch[0].v >= 20)
    schlagzeile = `${hoch[0].name} zieht kräftig an: ${proz(hoch[0].v)} auf ${geld(hoch[0].kurs)}`;
  else if (tief.length && tief[0].v <= -15)
    schlagzeile = `${tief[0].name} bricht ein: ${proz(tief[0].v)} auf ${geld(tief[0].kurs)}`;
  else if (firmen.length && firmen[0].v >= 10)
    schlagzeile = `${firmen[0].p.name} zieht davon — Firmenwert ${proz(firmen[0].v)}`;
  else if (knapp.length)
    schlagzeile = `${knapp[0].name} bleibt Mangelware`;
  else
    schlagzeile = "Ruhiger Handel, keine großen Ausschläge";

  /* ---- Absätze ---- */
  const absaetze = [];
  if (hoch.length || tief.length) {
    const teile = [];
    if (hoch.length) teile.push(
      `Am kräftigsten ${hoch.length > 1 ? "legten" : "legte"} ` +
      liste(hoch.map(x => `${x.name} (${proz(x.v)} auf ${geld(x.kurs)})`)) + " zu");
    if (tief.length) {
      /* Einleitung getrennt bilden: verschachtelt in der Zeichenkette stand die
       * innere Ersetzung als roher Text im Bericht. */
      const auftakt = hoch.length
        ? "Nach unten ging es dagegen für "
        : (tief.length > 1 ? "Nachgegeben haben " : "Nachgegeben hat ");
      teile.push(auftakt + liste(tief.map(x => `${x.name} (${proz(x.v)} auf ${geld(x.kurs)})`)));
    }
    absaetze.push(teile.join(". ") + ".");
  }

  if (knapp.length) {
    const erste = knapp[0];
    let t = `Nicht lieferbar ${knapp.length > 1 ? "sind derzeit" : "ist derzeit"} ` +
      liste(knapp.slice(0, 4).map(x => `${x.name} (${x.nachfrage} gesucht)`)) + ". ";
    t += erste.nachfrage >= 60
      ? `Vor allem bei ${erste.name} klafft eine große Lücke — wer jetzt produziert, kann seinen Preis selbst bestimmen.`
      : `Wer diese Waren herstellt, findet gerade mühelos Abnehmer.`;
    absaetze.push(t);
  } else if (waren.length) {
    absaetze.push("Lieferengpässe gibt es derzeit keine — alle nachgefragten Waren sind am Markt zu haben.");
  }

  if (firmen.length) {
    const spitze = firmen.slice(0, 3);
    absaetze.push(
      `An der Börse ${spitze.length > 1 ? "gewannen" : "gewann"} ` +
      liste(spitze.map(x => `${x.p.name} ${proz(x.v)}`)) +
      ` an Wert. Ein 25-Prozent-Block an ${spitze[0].p.name} kostet inzwischen ` +
      `${blockPrice(spitze[0].p).toLocaleString("de-DE")} $.`);
  }

  if (rang.length) {
    const f = rang[0], zweiter = rang[1];
    let t = `An der Spitze steht ${f.name} mit ${Math.round(netWorth(f)).toLocaleString("de-DE")} $ Nettovermögen`;
    if (zweiter) {
      const abstand = Math.round(netWorth(f) - netWorth(zweiter));
      t += abstand < netWorth(f) * 0.05
        ? `, dicht gefolgt von ${zweiter.name} — nur ${abstand.toLocaleString("de-DE")} $ trennen die beiden.`
        : `, mit ${abstand.toLocaleString("de-DE")} $ Vorsprung auf ${zweiter.name}.`;
    } else t += ".";
    absaetze.push(t);
  }

  return absaetze.length ? { schlagzeile, absaetze } : null;
}

function sendeMarktbericht() {
  const bericht = marktbericht();
  if (!bericht) return;   // in den ersten Minuten gibt es schlicht nichts zu melden
  /* Die Berichte sammeln sich in der Nachrichtenzentrale, statt im Chat
   * vorbeizuziehen: Dort geht ein Bericht zwischen den Nachrichten der
   * Mitspieler unter, und wer später dazukommt, sieht ihn nie. Im Panel steht
   * die Entwicklung der letzten Viertelstunde am Stück. */
  G.news.unshift({ ...bericht, min: Math.round(G.tick / 60), ts: Date.now() });
  if (G.news.length > 8) G.news.pop();
  io.emit("notice", { text: "Neuer Marktbericht der Nachrichtenzentrale" });
  pushState();
}

function distributeDividends() {
  for (const p of Object.values(G.players)) {
    const revenue = p.revenue;
    if (revenue > 0) {
      const pool = Math.min(revenue * DIVIDEND_RATE, Math.max(0, p.cash));
      let paidOut = 0;
      if (pool > 0.01) {
        for (const [holderId, count] of Object.entries(p.equity)) {
          if (holderId === p.id || !(count > 0)) continue;
          const holder = G.players[holderId];
          if (!holder) continue;
          const share = pool * (count / 4);
          p.cash -= share; holder.cash += share; paidOut += share;
          holder.stats.dividendeRein += share; p.stats.dividendeRaus += share;
          logTx(holder, "Dividende", `${count * 25}% Anteil an ${p.name}`, share);
          emitTo(holderId, "notice", { text: `Dividende von ${p.name}: +${Math.round(share)} $ (${count * 25}% Anteil)` });
        }
        /* Nur loggen, wenn wirklich Geld an externe Aktionäre floss — bei 100 %
         * Eigenbesitz bleibt das Geld komplett in der Firma, keine Ausschüttung. */
        if (paidOut > 0.01) logTx(p, "Dividende", "Dividenden an Aktionäre ausgeschüttet", -paidOut);
      }
    }
    p.revenue = 0;
  }
}

/* ---------- Pfändung & Versteigerung ---------- */
function seizeAndAuction(debtor, bond) {
  const tiles = G.map.filter(t => t.owner === debtor.id && t.btype);
  const target = tiles.find(t => t.lien) || tiles[0];
  if (!target) { // nichts pfändbar → Bond wertlos, Gläubiger geht leer aus
    G.bonds.splice(G.bonds.indexOf(bond), 1);
    io.emit("notice", { text: `${debtor.name} ist zahlungsunfähig — Anleihe ausgefallen.` });
    return;
  }
  const btype = target.btype;
  target.owner = null; target.btype = null; target.lien = false;
  G.auctions.push({ id: id(), tileIdx: G.map.indexOf(target), btype,
    minBid: Math.round(BTYPES[btype].cost * 0.3), bestBid: 0, bestBidder: null,
    creditorId: bond.holderId, tLeft: 30 });
  G.bonds.splice(G.bonds.indexOf(bond), 1);
  io.emit("notice", { text: `${BTYPES[btype].name} von ${debtor.name} gepfändet — Versteigerung läuft (30 s)!` });
}

/* ---------- Starter-Aufgaben ---------- */
/* Starter-Aufgaben: bewusst so formuliert, dass JEDE Industrie sie erfüllen kann.
 * "Verkaufe 20 Obst" ging früher nur mit einer Farm — ein Techniker konnte die
 * Aufgabe gar nicht abschließen. Stattdessen zählt jetzt der Umsatz, egal womit
 * er entsteht, und jeder Schritt führt an ein Spielsystem heran: bauen,
 * verkaufen, handeln, freischalten, aufleveln, Anteile kaufen. */
const QUESTS = [
  { id: "build",   text: "Baue dein erstes Produktionsgebäude",           target: 1,    reward: 800 },
  { id: "shop",    text: "Richte einen Verkaufsslot ein",                 target: 1,    reward: 1000 },
  { id: "order",   text: "Platziere eine Order an der Börse",             target: 1,    reward: 600 },
  { id: "revenue", text: "Erwirtschafte 3.000 $ Umsatz",                  target: 3000, reward: 1500 },
  { id: "unlock",  text: "Schalte eine Kachel in einer Sperrzone frei",   target: 1,    reward:  500 },
  { id: "upgrade", text: "Level ein Gebäude mit Elektronik auf Stufe 2",  target: 1,    reward: 1500 },
  { id: "shares",  text: "Kaufe an der Stadtbank Anteile einer Firma",    target: 1,    reward: 1800 },
];
function questProg(p, id, n = 1) {
  const def = QUESTS.find(q => q.id === id);
  const q = p.quests[id] ??= { n: 0, done: false };
  if (!def || q.done) return;
  q.n += n;
  if (q.n >= def.target) {
    q.done = true; p.cash += def.reward;
    logTx(p, "Aufgabe", `Aufgabe erfüllt: ${def.text}`, def.reward);
    emitTo(p.id, "notice", { text: `Aufgabe erfüllt: „${def.text}" — +${def.reward} $` });
  }
}

/* ---------- XP & Statistik ---------- */
function gainXp(p, n) {
  p.xp += n;
  while (p.xp >= p.lvl * 100) {
    p.xp -= p.lvl * 100; p.lvl++;
    const bonus = 250 * p.lvl;                       // Level-Belohnung: +$250 × neues Level
    p.cash += bonus;
    logTx(p, "Level", `Level ${p.lvl} erreicht`, bonus);
    emitTo(p.id, "notice", { text: `Level ${p.lvl}! Bonus: +${bonus} $` });
  }
}
function logTx(p, cat, text, amt) {
  p.tx.unshift({ t: G.tick, cat, text, amt: Math.round(amt * 100) / 100 });
  if (p.tx.length > 60) p.tx.pop();
}
function salesRec(p, good) {
  return p.sales[good] ??= { botQty: 0, botRev: 0, playerQty: 0, playerRev: 0, buyQty: 0, buyCost: 0 };
}

/* ---------- Snapshot für Clients ---------- */
function snapshot() {
  // Rangliste nach Nettovermögen
  const ranked = Object.values(G.players).map(p => [p.id, netWorth(p)]).sort((a, b) => b[1] - a[1]);
  const rankOf = Object.fromEntries(ranked.map(([pid], i) => [pid, i + 1]));
  return {
    tick: G.tick, winner: G.winner, winGoal: WIN_NW, report: G.report || null,
    started: G.started, hostId: G.hostId,
    lobby: G.started ? null : { winGoal: WIN_NW, bots: botAuswahl, botLevel: botLevelKey },
    map: G.map.map(t => ({ x: t.x, y: t.y, zone: t.zone, road: t.road, water: t.water,
      park: t.park, field: t.field, sand: t.sand, deep: t.deep, rock: t.rock,
      bank: t.bank, news: t.news, locked: t.locked, unlockCost: t.unlockCost, owner: t.owner, btype: t.btype, lien: t.lien, shop: t.shop, paused: t.paused, level: t.level })),
    players: Object.fromEntries(Object.entries(G.players).map(([sid, p]) =>
      [sid, { id: sid, name: p.name, color: p.color, lvl: p.lvl, xp: p.xp, industry: p.industry, industries: p.industries,
              netWorth: Math.round(netWorth(p)), rating: rating(p), rank: rankOf[sid],
              /* Kennzahlen für den Aktienhandel an der Bank */
              marketValue: Math.round(companyValue(p)), blockPrice: blockPrice(p), rev10: Math.round(rev10(p)),
              ownPct: (p.equity[sid] || 0) * 25,
              equity: Object.fromEntries(Object.entries(p.equity).filter(([, c]) => c > 0)
                .map(([hid, c]) => [G.players[hid]?.name ?? "—", c * 25])) }])),
    orders: G.orders,
    bonds: G.bonds.map(b => ({ ...b, issuer: G.players[b.issuerId]?.name ?? "—",
      holder: b.holderId ? (G.players[b.holderId]?.name ?? "—") : null,
      issuerRating: G.players[b.issuerId] ? rating(G.players[b.issuerId]) : "D" })),
    shareBids: G.shareBids.map(b => ({ ...b,
      company: G.players[b.companyId]?.name ?? "—",
      bidder: G.players[b.bidderId]?.name ?? "—" })),
    shareListings: G.shareListings.map(l => ({ ...l,
      sellerId: l.sellerId ?? l.companyId,
      company: G.players[l.companyId]?.name ?? "—",
      seller: G.players[l.sellerId ?? l.companyId]?.name ?? "—",
      isIssue: (l.sellerId ?? l.companyId) === l.companyId,   // Emission der Firma statt Weiterverkauf
      toName: l.toId ? (G.players[l.toId]?.name ?? "—") : null })),
    nextDividendIn: G.nextDividendIn,
    auctions: G.auctions,
    lastTrade: G.lastTrade,
    news: G.news,
    avg: Object.fromEntries(Object.keys(GOODS).map(k => [k, MM[k].price])),
    groupOrder: G.groupOrder ? { id: G.groupOrder.id, city: G.groupOrder.city, ttl: G.groupOrder.ttl,
      needs: G.groupOrder.needs,
      contrib: Object.fromEntries(Object.entries(G.groupOrder.contrib).map(([pid, goods]) =>
        [G.players[pid]?.name ?? "—", goods])) } : null,
    contracts: G.contracts.filter(c => c.status === "open"),
  };
}
function privateState(p) {
  /* Vermögensaufstellung wie im Dashboard: Bargeld, Inventar, Gebäude, Anleihen, Schulden */
  let invVal = 0; for (const k in p.inv) invVal += p.inv[k] * MM[k].price;
  let bldVal = 0; for (const t of G.map) if (t.owner === p.id && t.btype) bldVal += BTYPES[t.btype].cost * 0.7;
  let bondVal = 0, debtVal = 0;
  for (const b of G.bonds) {
    if (b.holderId === p.id) bondVal += b.principal;
    if (b.issuerId === p.id && b.holderId) debtVal += b.principal;
  }
  /* Depot: was man an FREMDEN Firmen hält — mit aktueller Bewertung, damit man
   * an der Bank sieht, ob sich ein Weiterverkauf gerade lohnt. */
  const portfolio = Object.values(G.players)
    .filter(other => other.id !== p.id && (other.equity[p.id] || 0) > 0)
    .map(other => ({ id: other.id, company: other.name, industry: other.industry,
      count: other.equity[p.id], pct: other.equity[p.id] * 25,
      blockPrice: blockPrice(other), value: blockPrice(other) * other.equity[p.id],
      einstand: Math.round((p.equityAvg[other.id] || 0) * other.equity[p.id]),
      marketValue: Math.round(companyValue(other)), rev10: Math.round(rev10(other)) }));
  return { cash: p.cash, inv: p.inv, xp: p.xp, lvl: p.lvl,
    quests: p.quests,
    tx: p.tx, sales: p.sales, fin: p.fin, nwHist: p.nwHist,
    ad: { reach: Math.round(p.adReach || 0), boost: +adBoost(p).toFixed(3),
          agenturen: adAgenturen(p), cap: adCap(adAgenturen(p)), pakete: AD_PACKAGES },
    ownPct: (p.equity[p.id] || 0) * 25, portfolio, revenue: Math.round(p.revenue),
    marketValue: Math.round(companyValue(p)), blockPrice: blockPrice(p), rev10: Math.round(rev10(p)),
    /* Bilanz: erst die Substanz der eigenen Firma, dann der Anteil daran, den man
     * selbst noch hält, plus die Beteiligungen an fremden Firmen. Nur so passt
     * die Summe zum Nettovermögen in der Kopfzeile. */
    balance: { cash: Math.round(p.cash), invVal: Math.round(invVal), bldVal: Math.round(bldVal),
               bondVal, debtVal,
               firmVal: Math.round(substance(p)),
               ownShare: (p.equity[p.id] || 0) / 4,
               holdings: Math.round(portfolio.reduce((sum, h) => sum + h.value, 0)),
               total: Math.round(netWorth(p)) } };
}
/* Diagnose: mit DEBUG_PERF=1 alle 30 s eine Kennzahlenzeile ins Log. Damit lässt
 * sich belegen statt vermuten, ob und was über die Spielzeit wächst. */
const PERF = !!process.env.DEBUG_PERF;
const perf = { pushes: 0, snapMs: 0, maxTickMs: 0 };
/* Erledigte Verträge sofort aus der Liste nehmen. Sie blieben früher mit
 * geändertem Status für immer stehen — bei jedem Snapshot mitgefiltert und im
 * Speicher mitgeschleppt, obwohl niemand sie je wieder braucht. */
function dropContract(c) {
  const i = G.contracts.indexOf(c);
  if (i >= 0) G.contracts.splice(i, 1);
}
/* ---------- Kartendiff ----------
 * Die Karte macht 99 % des Zustands aus (676 Kacheln, ~104 KB) und ändert sich
 * fast nie — nur wenn jemand baut, freischaltet, pausiert oder auflevelt. Sie
 * trotzdem jede Sekunde vollständig zu senden hieß, dass jeder Browser rund
 * 366 MB pro Spielstunde einliest und wieder wegräumen muss. Genau daran wurde
 * ein Tab nach längerer Spielzeit zäh und blieb schließlich stehen.
 * Jetzt geht die volle Karte einmal je Verbindung raus, danach nur noch die
 * Kacheln, an denen sich wirklich etwas geändert hat. */
const DYNAMIC_TILE_KEYS = ["locked", "owner", "btype", "lien", "shop", "paused", "level"];
/* undefined wird zu null normalisiert, damit auch "Feld gelöscht" (z. B. der
 * Abriss räumt t.shop weg) beim Empfänger sicher ankommt. */
const tileDyn = t => { const d = {}; for (const k of DYNAMIC_TILE_KEYS) d[k] = t[k] ?? null; return d; };
let lastTileSigs = null;
function tileDelta() {
  const sigs = new Array(G.map.length);
  const delta = [];
  for (let i = 0; i < G.map.length; i++) {
    const d = tileDyn(G.map[i]);
    /* Vergleich über JSON, nicht über eine Feld-Verkettung: `shop` ist ein
     * verschachteltes Slot-Array — ein String-Join würde Preis- und Warenwechsel
     * darin nicht bemerken und das Kachel-Update verschlucken. */
    const sig = JSON.stringify(d);
    sigs[i] = sig;
    if (lastTileSigs && lastTileSigs[i] !== sig) { d.i = i; delta.push(d); }
  }
  const ersterLauf = !lastTileSigs;
  lastTileSigs = sigs;
  return ersterLauf ? null : delta;
}
/* ---------- Rundenauswertung ----------
 * Wird einmal beim Sieg erstellt: eine Tabelle aller Firmen plus Auszeichnungen.
 * Die Zahlen stammen aus den laufenden Zählern (p.stats), nicht aus einer
 * nachträglichen Schätzung. */
function buildReport(siegerId) {
  const wertProduziert = st => Object.entries(st.produziert).reduce((sum, [g, n]) => sum + n * BASEP[g], 0);
  const zeilen = Object.values(G.players).map(p => {
    const st = p.stats;
    const geb = G.map.filter(t => t.owner === p.id && t.btype);
    const beteiligungen = Object.values(G.players)
      .filter(o => o.id !== p.id && (o.equity[p.id] || 0) > 0)
      .map(o => ({ firma: o.name, pct: o.equity[p.id] * 25, wert: blockPrice(o) * o.equity[p.id] }));
    return {
      id: p.id, name: p.name, color: p.color, industrien: p.industries || [p.industry],
      sieger: p.id === siegerId,
      netWorth: Math.round(netWorth(p)),
      umsatz: Math.round(st.umsatz), ausgaben: Math.round(st.ausgaben),
      gebaeude: geb.length, stufen: geb.reduce((a, t) => a + ((t.level || 1) - 1), 0),
      produziertStk: Math.round(Object.values(st.produziert).reduce((a, b) => a + b, 0)),
      produziertWert: Math.round(wertProduziert(st)),
      grossauftraege: st.grossauftraege,
      besterHandel: st.besterHandel && { ...st.besterHandel, summe: Math.round(st.besterHandel.summe) },
      dividendeRein: Math.round(st.dividendeRein), dividendeRaus: Math.round(st.dividendeRaus),
      zinsErtrag: Math.round(st.zinsErtrag), zinsAufwand: Math.round(st.zinsAufwand),
      werbung: Math.round(st.werbung), fusionen: st.fusionen,
      anteileGekauft: st.anteileGekauft, anteileVerkauft: st.anteileVerkauft,
      beteiligungen, beteiligungswert: Math.round(beteiligungen.reduce((a, b) => a + b.wert, 0)),
      eigenanteil: (p.equity[p.id] || 0) * 25,
    };
  }).sort((a, b) => b.netWorth - a.netWorth);

  /* Auszeichnungen: nur vergeben, wenn überhaupt jemand etwas vorzuweisen hat */
  const beste = (titel, feld, format, zusatz) => {
    const top = zeilen.filter(z => (typeof feld === "function" ? feld(z) : z[feld]) > 0)
      .sort((a, b) => (typeof feld === "function" ? feld(b) - feld(a) : b[feld] - a[feld]))[0];
    return top ? { titel, name: top.name, color: top.color, wert: format(top), zusatz: zusatz?.(top) } : null;
  };
  const auszeichnungen = [
    beste("Größter Produzent", "produziertWert", z => `${z.produziertStk.toLocaleString("de-DE")} Stück`,
          z => `im Wert von ${Math.round(z.produziertWert).toLocaleString("de-DE")} $`),
    beste("Höchster Umsatz", "umsatz", z => `${z.umsatz.toLocaleString("de-DE")} $`),
    beste("Bester Einzelhandel", z => z.besterHandel?.summe || 0,
          z => `${z.besterHandel.summe.toLocaleString("de-DE")} $`,
          z => `${z.besterHandel.qty}× ${GOODS[z.besterHandel.good]?.name} an ${z.besterHandel.partner}`),
    beste("Größter Bauherr", "gebaeude", z => `${z.gebaeude} Gebäude`,
          z => z.stufen ? `${z.stufen} Ausbaustufen` : null),
    beste("Größter Aktionär", "beteiligungswert", z => `${z.beteiligungswert.toLocaleString("de-DE")} $`,
          z => z.beteiligungen.map(b => `${b.pct} % ${b.firma}`).join(", ")),
    beste("Stütze der Stadt", "grossauftraege", z => `${z.grossauftraege} Großaufträge`),
    beste("Größter Werbeetat", "werbung", z => `${z.werbung.toLocaleString("de-DE")} $`),
    beste("Meiste Dividende kassiert", "dividendeRein", z => `${z.dividendeRein.toLocaleString("de-DE")} $`),
  ].filter(Boolean);

  return { zeilen, auszeichnungen, dauerMin: Math.round(G.tick / 60), ziel: WIN_NW };
}

function pushState() {
  const t0 = PERF ? process.hrtime.bigint() : 0n;
  const voll = snapshot();
  const delta = tileDelta();
  let schlank = null;
  if (delta !== null) { schlank = { ...voll, mapDelta: delta }; delete schlank.map; }
  for (const sock of io.sockets.sockets.values()) {
    /* Wer die Karte noch nie bekommen hat — frisch verbunden oder erster Push
     * überhaupt —, bekommt sie vollständig; alle anderen nur die Änderungen. */
    if (schlank && sock.data.gotMap) sock.emit("state", schlank);
    else { sock.emit("state", voll); sock.data.gotMap = true; }
  }
  for (const p of Object.values(G.players)) if (p.socketId) io.to(p.socketId).emit("me", privateState(p));
  if (PERF) { perf.pushes++; perf.snapMs += Number(process.hrtime.bigint() - t0) / 1e6; }
}
if (PERF) setInterval(() => {
  const mb = (process.memoryUsage().heapUsed / 1048576).toFixed(1);
  console.log(`[perf] t=${Math.round(G.tick / 60)}min pushes/s=${(perf.pushes / 30).toFixed(1)} `
    + `broadcastMs/s=${(perf.snapMs / 30).toFixed(1)} tickMaxMs=${perf.maxTickMs.toFixed(1)} heap=${mb}MB `
    + `| spieler=${Object.keys(G.players).length} orders=${G.orders.length} contracts=${G.contracts.length} `
    + `bonds=${G.bonds.length} auktionen=${G.auctions.length} angebote=${G.shareListings.length} `
    + `anfragen=${G.shareBids.length} tx=${Object.values(G.players).reduce((a, p) => a + p.tx.length, 0)}`);
  perf.pushes = 0; perf.snapMs = 0; perf.maxTickMs = 0;
}, 30000);

/* ---------- Socket-Handling ---------- */
io.on("connection", socket => {
  /* Kursverlauf sofort mitgeben. Er wird sonst nur alle 10 s gesendet — wer
   * mitten im Intervall beitritt, säße bis dahin vor leeren Charts. */
  socket.emit("kurse", { waren: G.priceHist, firmen: G.firmHist });
  /* Reconnect: Browser hat noch ein Token aus einer früheren Verbindung (Tab zu,
   * WLAN-Aussetzer, versehentlich verlassen) — Spielstand bleibt komplett erhalten. */
  socket.on("rejoin", ({ token }, ack) => {
    const p = G.players[token];
    if (!p) return ack?.({ error: "Sitzung abgelaufen oder unbekannt" });
    G.socketToPid[socket.id] = token;
    p.socketId = socket.id; p.disconnected = false; p.disconnectedAt = null;
    socket.data.registered = true;
    io.emit("notice", { text: `${p.name} ist wieder da.` });
    ack?.({ ok: true, goods: GOODS, btypes: BTYPES, rooms: ROOMS, you: token, winGoal: WIN_NW,
      questDefs: QUESTS, industry: p.industry, industries: INDUSTRIES,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.name])),
      retailFlow: Object.fromEntries(Object.keys(GOODS).map(k => [k, +retailFlow(k).toFixed(3)])),
      dividendRate: DIVIDEND_RATE, dividendInterval: DIVIDEND_INTERVAL });
    pushState();
  });

  /* Lobby / Registrierung */
  socket.on("register", ({ name, color, winGoal, industry, bots, botLevel }, ack) => {
    name = sicherText(String(name || "").trim().slice(0, 20));
    if (!name) return ack?.({ error: "Name fehlt" });
    if (Object.values(G.players).some(p => p.name === name)) return ack?.({ error: "Name vergeben" });
    if (!INDUSTRIES[industry]) return ack?.({ error: "Bitte eine Industrie wählen" });
    /* Der erste Spieler wird Host: seine Angaben vom Startbildschirm sind die
     * Voreinstellung des Warteraums, die er dort bis zum Start noch ändern kann. */
    if (Object.keys(G.players).length === 0 && WIN_CHOICES.includes(+winGoal)) WIN_NW = +winGoal;
    if (Object.keys(G.players).length === 0) {
      if (bots && typeof bots === "object") botAuswahl = bots;
      if (BOT_LEVELS[botLevel]) botLevelKey = botLevel;
    }
    const pid = crypto.randomUUID();
    const istErster = Object.keys(G.players).length === 0;
    G.players[pid] = newPlayer(pid, name, sichereFarbe(color), industry, socket.id);
    G.socketToPid[socket.id] = pid;
    socket.data.registered = true;
    if (istErster) G.hostId = pid;   // Host: darf im Warteraum einstellen und die Runde starten
    io.emit("notice", { text: `${name} ist der Sitzung beigetreten.` + (Object.keys(G.players).length === 1 ? ` Rundenziel: ${WIN_NW.toLocaleString("de-DE")} $` : "") });
    ack?.({ ok: true, goods: GOODS, btypes: BTYPES, rooms: ROOMS, you: pid, winGoal: WIN_NW, questDefs: QUESTS, industry, industries: INDUSTRIES,
      botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([k, v]) => [k, v.name])),
      retailFlow: Object.fromEntries(Object.keys(GOODS).map(k => [k, +retailFlow(k).toFixed(3)])),
      dividendRate: DIVIDEND_RATE, dividendInterval: DIVIDEND_INTERVAL });
    pushState();
  });

  /* ---------- Warteraum ----------
   * Solange die Runde nicht gestartet ist, darf der Host Ziel und Bots noch
   * ändern — anders als früher, wo beides beim Registrieren festgenagelt war
   * und Mitspieler, die später dazukamen, nichts mehr davon mitbekamen. */
  socket.on("lobbySettings", ({ winGoal, bots, botLevel }, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Das darf nur der Host" });
    if (G.started) return ack?.({ error: "Die Runde läuft schon" });
    if (WIN_CHOICES.includes(+winGoal)) WIN_NW = +winGoal;
    if (bots && typeof bots === "object") botAuswahl = bots;
    if (BOT_LEVELS[botLevel]) botLevelKey = botLevel;
    ack?.({ ok: true });
    pushState();
  });
  socket.on("startRound", (_payload, ack) => {
    const pid = G.socketToPid[socket.id];
    if (!pid || pid !== G.hostId) return ack?.({ error: "Nur der Host startet die Runde" });
    if (G.started) return ack?.({ ok: true });
    G.started = true;
    startBots();
    io.emit("notice", { text: `Die Runde läuft — Ziel: ${WIN_NW.toLocaleString("de-DE")} $` });
    ack?.({ ok: true });
    pushState();
  });

  const me = () => G.players[G.socketToPid[socket.id]];
  const guard = fn => (payload, ack) => {
    const p = me();
    if (!p || G.winner) return ack?.({ error: G.winner ? "Spiel beendet" : "Nicht registriert" });
    try { fn(p, payload || {}, ack); } catch (e) { ack?.({ error: e.message }); }
    pushState();
  };

  /* --- Karte: Bauen (schaltet gesperrte Kacheln atomar mit frei) / Abriss --- */
  socket.on("build", guard((p, { x, y, btype }, ack) => {
    const t = tileAt(x, y), bt = BTYPES[btype];
    if (!t || !bt) return ack?.({ error: "Ungültig" });
    if (t.water || t.road || t.park) return ack?.({ error: "Nicht bebaubar" });
    if (t.bank) return ack?.({ error: "Die Stadtbank gehört der Stadt" });
    if (t.news) return ack?.({ error: "Die Nachrichtenzentrale gehört der Stadt" });
    if (t.owner) return ack?.({ error: "Kachel bereits belegt" });
    if (bt.zone !== t.zone) return ack?.({ error: `Nur in Zone ${bt.zone} baubar` });
    if (bt.industry && !(p.industries || [p.industry]).includes(bt.industry))
      return ack?.({ error: `Nur ${INDUSTRIES[bt.industry].name} kann das bauen` });
    /* Freischalten + Bauen in einem atomaren Schritt (kein Zeitfenster,
     * in dem eine gesperrte Kachel für andere sichtbar frei würde). */
    const unlockCost = t.locked ? t.unlockCost : 0;
    if (p.cash < bt.cost + unlockCost) return ack?.({ error: "Zu wenig Kapital" });
    /* Baumaterial prüfen & verbrauchen (kommt von der Bauindustrie via Börse) */
    const mats = matCost(bt);
    const missing = Object.entries(mats).filter(([g, n]) => p.inv[g] < n);
    if (missing.length) return ack?.({ error: "Baumaterial fehlt: " +
      missing.map(([g, n]) => `${Math.ceil(n - p.inv[g])}× ${GOODS[g].name}`).join(", ") + " — an der Börse kaufen" });
    for (const [g, n] of Object.entries(mats)) p.inv[g] -= n;
    if (t.locked) { t.locked = false; gainXp(p, 30); questProg(p, "unlock"); }
    if (bt.out || bt.proc) questProg(p, "build");
    p.cash -= bt.cost + unlockCost; t.owner = p.id; t.btype = btype; t.level = 1; gainXp(p, 20);
    p.stats.gebaut++; p.stats.ausgaben += bt.cost + unlockCost;
    if (bt.retail) t.shop = Array.from({ length: bt.retail.slots }, () => null);
    logTx(p, "Bau", `${bt.name} gebaut${unlockCost ? " (inkl. Freischaltung)" : ""}`, -(bt.cost + unlockCost));
    ack?.({ ok: true });
  }));

  /* --- Gebäude mit Elektronik aufleveln: +30 % Produktion je Stufe (max. Stufe 5) --- */
  socket.on("upgradeBuilding", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y), bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !(bt?.out || bt?.proc)) return ack?.({ error: "Kein eigenes Produktionsgebäude" });
    const level = t.level || 1;
    if (level >= LEVEL_MAX) return ack?.({ error: `Bereits auf Höchststufe ${LEVEL_MAX}` });
    const cost = upgradeCost(bt, level);
    if (p.inv.elektronik < cost.elektronik) return ack?.({ error: `Zu wenig Elektronik (${cost.elektronik} nötig)` });
    if (p.cash < cost.cash) return ack?.({ error: "Zu wenig Kapital" });
    p.inv.elektronik -= cost.elektronik; p.cash -= cost.cash; t.level = level + 1; gainXp(p, 25);
    p.stats.aufgelevelt++; p.stats.ausgaben += cost.cash;
    questProg(p, "upgrade");
    logTx(p, "Ausbau", `${bt.name} auf Stufe ${t.level} aufgelevelt`, -cost.cash);
    ack?.({ ok: true, level: t.level });
  }));

  socket.on("demolish", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y);
    if (!t || t.owner !== p.id) return ack?.({ error: "Nicht dein Gebäude" });
    if (t.lien) return ack?.({ error: "Pfandrecht aktiv — Verkauf gesperrt" });
    p.cash += BTYPES[t.btype].cost * 0.5;
    logTx(p, "Bau", `Abriss ${BTYPES[t.btype].name}`, BTYPES[t.btype].cost * 0.5);
    p.stats.abgerissen++;
    t.owner = null; t.btype = null; t.shop = undefined;
    ack?.({ ok: true });
  }));

  /* --- Börse: reine Spieler-Orders --- */
  socket.on("placeOrder", guard((p, { side, good, qty, price }, ack) => {
    qty = Math.floor(+qty); price = Math.round(+price * 100) / 100;
    if (!GOODS[good] || !["sell", "buy"].includes(side)) return ack?.({ error: "Ungültig" });
    if (!(qty > 0) || !(price > 0)) return ack?.({ error: "Menge/Preis > 0 nötig" });
    if (side === "sell" && p.inv[good] < qty) return ack?.({ error: "Nicht genug Ware im Lager" });
    if (side === "buy" && p.cash < qty * price) return ack?.({ error: "Zu wenig Kapital" });
    const order = { id: id(), side, good, qty, price, playerId: p.id, player: p.name, ts: Date.now() };
    escrowForOrder(p, order);
    questProg(p, "order");
    matchOrder(order);
    ack?.({ ok: true });
  }));

  socket.on("cancelOrder", guard((p, { orderId }, ack) => {
    const o = G.orders.find(o => o.id === orderId && o.playerId === p.id);
    if (!o) return ack?.({ error: "Order nicht gefunden" });
    refundOrder(o); G.orders.splice(G.orders.indexOf(o), 1);
    ack?.({ ok: true });
  }));

  // Direkt eine liegende Order (teilweise) ausführen — "aus dem Buch kaufen"
  socket.on("takeOrder", guard((p, { orderId, qty }, ack) => {
    const o = G.orders.find(o => o.id === orderId);
    if (!o) return ack?.({ error: "Order weg — schon gehandelt?" });
    if (o.playerId === p.id) return ack?.({ error: "Eigene Order — nutze Stornieren" });
    qty = Math.min(Math.floor(+qty) || o.qty, o.qty);
    if (qty <= 0) return ack?.({ error: "Menge ungültig" });
    if (o.side === "sell") {
      if (p.cash < qty * o.price) return ack?.({ error: "Zu wenig Kapital" });
      p.cash -= qty * o.price;
      settleTrade(o.good, qty, o.price, p.id, o.playerId);
    } else {
      if (p.inv[o.good] < qty) return ack?.({ error: "Nicht genug Ware" });
      p.inv[o.good] -= qty;
      settleTrade(o.good, qty, o.price, o.playerId, p.id);
    }
    o.qty -= qty;
    if (o.qty <= 0) G.orders.splice(G.orders.indexOf(o), 1);
    ack?.({ ok: true });
  }));

  /* --- Shop konfigurieren: Ware + eigener Stückpreis je Verkaufsslot --- */
  socket.on("configureShop", guard((p, { x, y, slot, good, price, qty }, ack) => {
    const t = tileAt(x, y);
    const bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !bt?.retail) return ack?.({ error: "Kein eigenes Verkaufsgebäude" });
    slot = Math.floor(+slot);
    if (!(slot >= 0 && slot < bt.retail.slots)) return ack?.({ error: "Slot ungültig" });
    if (good === null) { t.shop[slot] = null; return ack?.({ ok: true }); }   // Slot leeren
    price = Math.round(+price * 100) / 100;
    if (!bt.retail.goods.includes(good)) return ack?.({ error: "Ware hier nicht verkäuflich" });
    if (!(price > 0)) return ack?.({ error: "Preis > 0 nötig" });
    qty = Math.floor(+qty);
    if (qty <= 0 || !Number.isFinite(qty)) qty = null;   // leer = unbegrenzt verkaufen
    t.shop[slot] = { good, price, qty };
    questProg(p, "shop");
    ack?.({ ok: true });
  }));

  /* --- Verkauf (Shop) bzw. Weiterverarbeitung (proc) an einem Gebäude pausieren --- */
  socket.on("togglePause", guard((p, { x, y }, ack) => {
    const t = tileAt(x, y);
    const bt = t?.btype ? BTYPES[t.btype] : null;
    if (!t || t.owner !== p.id || !(bt?.retail || bt?.proc)) return ack?.({ error: "Kein eigenes Verkaufs-/Verarbeitungsgebäude" });
    t.paused = !t.paused;
    ack?.({ ok: true, paused: t.paused });
  }));

  /* --- Gruppenauftrag: Waren einzahlen --- */
  socket.on("contribute", guard((p, { good, qty }, ack) => {
    const o = G.groupOrder;
    if (!o) return ack?.({ error: "Kein aktiver Gruppenauftrag" });
    const need = o.needs[good];
    if (!need) return ack?.({ error: "Diese Ware wird nicht gebraucht" });
    qty = Math.min(Math.floor(+qty), need.req - need.have);
    if (!(qty > 0)) return ack?.({ error: "Menge ungültig oder Bedarf gedeckt" });
    if (p.inv[good] < qty) return ack?.({ error: `Nicht genug ${GOODS[good].name} im Lager` });
    p.inv[good] -= qty;
    need.have += qty;
    /* bewusst KEIN noteSold: der Großauftrag soll den Marktkurs nicht drücken */
    (o.contrib[p.id] ??= {})[good] = (o.contrib[p.id][good] || 0) + qty;
    logTx(p, "Gruppenauftrag", `${qty}× ${GOODS[good].name} an ${o.city} eingezahlt`, 0);
    if (Object.values(o.needs).every(n => n.have >= n.req)) finishGroupOrder();
    ack?.({ ok: true });
  }));

  /* --- Anleihen: nur Spieler emittieren & kaufen --- */
  socket.on("issueBond", guard((p, { principal, rate, term }, ack) => {
    principal = Math.floor(+principal); rate = +rate; term = Math.floor(+term);
    if (!(principal >= 100) || !(rate > 0 && rate <= 0.5) || !(term >= 30))
      return ack?.({ error: "Min. $100, Zins 0–50 %, Laufzeit ≥ 30 s" });
    G.bonds.push({ id: id(), issuerId: p.id, holderId: null, principal, rate, termLeft: term, strikes: 0 });
    ack?.({ ok: true });
  }));

  socket.on("buyBond", guard((p, { bondId }, ack) => {
    const b = G.bonds.find(b => b.id === bondId && !b.holderId);
    if (!b) return ack?.({ error: "Anleihe nicht verfügbar" });
    if (b.issuerId === p.id) return ack?.({ error: "Eigene Anleihe" });
    if (p.cash < b.principal) return ack?.({ error: "Zu wenig Kapital" });
    const issuer = G.players[b.issuerId];
    p.cash -= b.principal;
    if (issuer) issuer.cash += b.principal;   // Kapitalzufluss beim Emittenten
    b.holderId = p.id;
    logTx(p, "Anleihen", `Anleihe von ${issuer?.name ?? "?"} gekauft`, -b.principal);
    if (issuer) logTx(issuer, "Anleihen", `Anleihe platziert bei ${p.name}`, b.principal);
    io.emit("notice", { text: `${p.name} finanziert ${issuer?.name ?? "?"} mit ${b.principal} $ (${(b.rate * 100).toFixed(1)} %)` });
    ack?.({ ok: true });
  }));

  /* --- Aktien: eigene 25%-Anteile verkaufen, um Kapital zu bekommen.
   * Käufer erhalten dafür alle 10 min eine Dividende vom laufenden Erlös
   * der Firma (siehe distributeDividends im Server-Tick). --- */
  socket.on("listShares", guard((p, { companyId, count, price, toId }, ack) => {
    companyId = companyId || p.id;   // ohne Angabe: eigene Anteile emittieren (Rückwärtskompatibilität)
    count = Math.floor(+count); price = +price; toId = toId || null;
    const company = G.players[companyId];
    if (!company) return ack?.({ error: "Firma unbekannt" });
    if (!(count >= 1 && count <= 4)) return ack?.({ error: "1–4 Anteile (je 25 %)" });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    /* Verkaufen darf jeder, der die Anteile hält — die Firma ihre eigenen (Emission)
     * genauso wie ein Aktionär seine zugekauften (Weiterverkauf). */
    if ((company.equity[p.id] || 0) < count)
      return ack?.({ error: `So viele Anteile an ${company.name} hältst du nicht` });
    if (toId && (toId === p.id || !G.players[toId])) return ack?.({ error: "Ungültiger Empfänger" });
    company.equity[p.id] -= count;   // in Verwahrung, bis gekauft oder zurückgezogen
    const listing = { id: id(), companyId, sellerId: p.id, count, price, ts: Date.now(), toId };
    G.shareListings.push(listing);
    const what = companyId === p.id ? "eigene Anteile" : `Anteile an ${company.name}`;
    if (toId) {
      emitTo(toId, "shareOffer", { ...listing, from: p.name, company: company.name });
      logTx(p, "Aktien", `${count * 25}% ${what} an ${G.players[toId].name} angeboten`, 0);
    } else {
      logTx(p, "Aktien", `${count * 25}% ${what} an der Bank angeboten`, 0);
    }
    ack?.({ ok: true });
  }));

  /* --- Kaufanfragen: jeder kann einer beliebigen Firma ein Angebot für einen
   * Anteil machen. Die Firma entscheidet dann selbst — Spieler per Knopf,
   * Bots nach ihrer eigenen Bewertung (siehe spawnBot). Es wird nichts
   * hinterlegt; die Deckung wird erst beim Annehmen geprüft, wie bei Verträgen. --- */
  socket.on("bidShares", guard((p, { companyId, count, price }, ack) => {
    count = Math.floor(+count); price = +price;
    const company = G.players[companyId];
    if (!company) return ack?.({ error: "Firma unbekannt" });
    if (companyId === p.id) return ack?.({ error: "Das ist deine eigene Firma" });
    if (!(count >= 1 && count <= 4)) return ack?.({ error: "1–4 Anteile (je 25 %)" });
    if (!(price > 0)) return ack?.({ error: "Ungültiger Preis" });
    if (p.cash < price) return ack?.({ error: "So viel Kapital hast du nicht" });
    if ((company.equity[companyId] || 0) < count)
      return ack?.({ error: `${company.name} hält selbst nur noch ${(company.equity[companyId] || 0) * 25} %` });
    if (G.shareBids.some(b => b.companyId === companyId && b.bidderId === p.id))
      return ack?.({ error: "Du hast dieser Firma bereits eine Anfrage geschickt" });
    const bid = { id: id(), companyId, bidderId: p.id, count, price, ttl: SHARE_BID_TTL };
    G.shareBids.push(bid);
    emitTo(companyId, "notice", { text: `${p.name} bietet ${Math.round(price)} $ für ${count * 25} % deiner Firma — an der Stadtbank entscheiden.` });
    logTx(p, "Aktien", `Kaufanfrage über ${count * 25}% an ${company.name}`, 0);
    ack?.({ ok: true });
  }));

  socket.on("acceptShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.companyId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    const bid = G.shareBids[i];
    const bidder = G.players[bid.bidderId];
    if (!bidder) { G.shareBids.splice(i, 1); return ack?.({ error: "Bieter ist nicht mehr im Spiel" }); }
    if (bidder.cash < bid.price) return ack?.({ error: `${bidder.name} hat nicht mehr genug Kapital` });
    if ((p.equity[p.id] || 0) < bid.count)
      return ack?.({ error: "Du hältst nicht mehr genug eigene Anteile" });
    bidder.cash -= bid.price;
    p.cash += bid.price;                    // Verkauf eigener Anteile = frisches Firmenkapital
    p.equity[p.id] -= bid.count;
    merkeEinstand(bidder, p, bid.count, bid.price);
    p.equity[bidder.id] = (p.equity[bidder.id] || 0) + bid.count;
    G.shareBids.splice(i, 1);
    logTx(p, "Aktien", `${bid.count * 25}% eigene Anteile an ${bidder.name} verkauft`, bid.price);
    logTx(bidder, "Aktien", `${bid.count * 25}% an ${p.name} gekauft`, -bid.price);
    bidder.stats.anteileGekauft += bid.count; p.stats.anteileVerkauft += bid.count;
    questProg(bidder, "shares");
    emitTo(bidder.id, "notice", { text: `${p.name} nimmt deine Kaufanfrage an — du hältst jetzt ${p.equity[bidder.id] * 25} % an ${p.name}.` });
    io.emit("notice", { text: `${bidder.name} übernimmt ${bid.count * 25} % von ${p.name} für ${Math.round(bid.price)} $` });
    ack?.({ ok: true });
  }));

  socket.on("declineShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.companyId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    emitTo(G.shareBids[i].bidderId, "notice", { text: `${p.name} lehnt deine Kaufanfrage ab.` });
    G.shareBids.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("cancelShareBid", guard((p, { bidId }, ack) => {
    const i = G.shareBids.findIndex(b => b.id === bidId && b.bidderId === p.id);
    if (i < 0) return ack?.({ error: "Anfrage nicht gefunden" });
    G.shareBids.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("cancelShareListing", guard((p, { listingId }, ack) => {
    const i = G.shareListings.findIndex(l => l.id === listingId && (l.sellerId ?? l.companyId) === p.id);
    if (i < 0) return ack?.({ error: "Angebot nicht gefunden" });
    returnListingToSeller(G.shareListings[i]);
    G.shareListings.splice(i, 1);
    ack?.({ ok: true });
  }));

  socket.on("buyShares", guard((p, { listingId }, ack) => {
    const l = G.shareListings.find(l => l.id === listingId);
    if (!l) return ack?.({ error: "Angebot nicht mehr verfügbar" });
    const sellerId = l.sellerId ?? l.companyId;
    if (sellerId === p.id) return ack?.({ error: "Das ist dein eigenes Angebot" });
    if (l.toId && l.toId !== p.id) return ack?.({ error: "Dieses Angebot ist an jemand anderen gerichtet" });
    if (p.cash < l.price) return ack?.({ error: "Zu wenig Kapital" });
    const company = G.players[l.companyId];
    if (!company) { G.shareListings.splice(G.shareListings.indexOf(l), 1); return ack?.({ error: "Firma existiert nicht mehr" }); }
    const seller = G.players[sellerId];
    p.cash -= l.price;
    merkeEinstand(p, company, l.count, l.price);   // vor dem Erhöhen: braucht den alten Stand
    company.equity[p.id] = (company.equity[p.id] || 0) + l.count;
    G.shareListings.splice(G.shareListings.indexOf(l), 1);
    logTx(p, "Aktien", `${l.count * 25}% an ${company.name} gekauft`, -l.price);
    p.stats.anteileGekauft += l.count;
    questProg(p, "shares");
    if (sellerId === l.companyId) {
      /* Emission: die Firma gibt eigene Anteile aus, das Geld ist frisches
       * Firmenkapital. Es zählt NICHT als Umsatz — sonst würde eine Firma sich
       * über den Verkauf eigener Anteile selbst hochbewerten. */
      company.cash += l.price;
      logTx(company, "Aktien", `${l.count * 25}% eigene Anteile an ${p.name} ausgegeben`, l.price);
    } else if (seller) {
      /* Weiterverkauf: der Erlös geht an den Aktionär — hier entsteht der
       * Kursgewinn oder -verlust aus dem Anteilshandel. */
      seller.cash += l.price;
      logTx(seller, "Aktien", `${l.count * 25}% an ${company.name} an ${p.name} verkauft`, l.price);
      emitTo(sellerId, "notice", { text: `${p.name} hat deine ${l.count * 25}% an ${company.name} für ${Math.round(l.price)} $ gekauft.` });
    }
    io.emit("notice", { text: `${p.name} kauft ${l.count * 25}% von ${company.name} für ${Math.round(l.price)} $` });
    ack?.({ ok: true });
  }));

  /* --- Firmenfusion: hältst du 100 % einer anderen Firma, kannst du sie
   * eingliedern — ihre Gebäude, Kapital, Lager und Industrie werden deine.
   * Funktioniert branchenübergreifend, z. B. Rohstoff + Grundbedürfnisse. --- */
  /* --- Neue Runde nach dem Sieg ---
   * Ein reiner Rücksprung zum Startbildschirm würde nicht reichen: solange
   * G.winner gesetzt ist, blockt guard() jede Aktion mit "Spiel beendet", und
   * die alte Karte samt aller Firmen stünde noch. Deshalb wird hier der gesamte
   * Rundenzustand neu aufgebaut und alle Verbundenen zurück in die Lobby
   * geschickt. Bewusst ohne Rechteprüfung ausser dem Rundenende — wer die Runde
   * zu Ende gespielt hat, darf sie auch neu starten. */
  socket.on("newRound", (_payload, ack) => {
    if (!G.winner) return ack?.({ error: "Die Runde läuft noch" });
    stopBots();
    botAuswahl = null; botLevelKey = BOT_LEVEL_DEFAULT;
    G.map = buildMap();
    G.players = {}; G.socketToPid = {};
    G.orders = []; G.bonds = []; G.auctions = []; G.contracts = [];
    G.shareListings = []; G.shareBids = [];
    G.lastTrade = {};
    G.chat = Object.fromEntries(ROOMS.map(r => [r, []]));
    G.tick = 0; G.winner = null; G.report = null;
    G.started = false; G.hostId = null;   // neue Runde beginnt wieder im Warteraum
    G.groupOrder = null; G.nextGroupIn = 20;
    G.nextDividendIn = DIVIDEND_INTERVAL;
    /* Preisanker zurücksetzen — sonst startet die neue Runde mit den
     * verzerrten Kursen der alten (z. B. dauerhaft gedrücktem Ölpreis). */
    for (const k of Object.keys(GOODS)) Object.assign(MM[k], { price: BASEP[k], anchor: BASEP[k], sold: 0 });
    G.priceHist = {}; G.firmHist = {}; G.news = [];
    /* Alle Clients bekommen die Karte danach wieder vollständig */
    lastTileSigs = null;
    for (const sock of io.sockets.sockets.values()) sock.data.gotMap = false;
    io.emit("roundReset", {});
    ack?.({ ok: true });
    pushState();
  });

  /* --- Kampagne buchen ---
   * Nur mit eigener Werbeagentur. Reichweite ist bei 100 gedeckelt; wer
   * nachlegt, bevor der Vorrat leer ist, hält den Aufschlag oben. */
  socket.on("bookAd", guard((p, { paket }, ack) => {
    const paketDef = AD_PACKAGES[paket];
    if (!paketDef) return ack?.({ error: "Unbekanntes Paket" });
    const n = adAgenturen(p);
    if (n < 1) return ack?.({ error: "Dafür brauchst du eine eigene Werbeagentur" });
    if (p.cash < paketDef.cost) return ack?.({ error: `${paketDef.name} kostet ${paketDef.cost.toLocaleString("de-DE")} $` });
    p.cash -= paketDef.cost;
    p.adReach = Math.min(100, (p.adReach || 0) + paketDef.reach);
    p.stats.werbung += paketDef.cost; p.stats.ausgaben += paketDef.cost;
    gainXp(p, 15);
    logTx(p, "Werbung", `${paketDef.name} gebucht (+${paketDef.reach} Reichweite)`, -paketDef.cost);
    ack?.({ ok: true, reach: Math.round(p.adReach), boost: adBoost(p) });
  }));

  socket.on("mergeCompany", guard((p, { targetId }, ack) => {
    const target = G.players[targetId];
    if (!target || targetId === p.id) return ack?.({ error: "Ungültige Zielfirma" });
    if ((target.equity[p.id] || 0) < 4) return ack?.({ error: "Du brauchst 100 % der Anteile für eine Fusion" });
    /* Vermögen zusammenlegen */
    p.cash += target.cash;
    for (const g of Object.keys(target.inv)) p.inv[g] = (p.inv[g] || 0) + target.inv[g];
    p.xp += target.xp;
    /* Gebäude & Anleihen auf die übernehmende Firma ummelden */
    for (const t of G.map) if (t.owner === targetId) t.owner = p.id;
    for (const b of G.bonds) {
      if (b.issuerId === targetId) b.issuerId = p.id;
      if (b.holderId === targetId) b.holderId = p.id;
    }
    /* Offene Direktverträge mit der aufgelösten Firma sind hinfällig */
    G.contracts = G.contracts.filter(c => c.fromId !== targetId && c.toId !== targetId);
    /* Aktienangebote aufräumen. Wichtig: verwahrte Anteile immer zurückgeben,
     * sonst fehlen sie in der Cap-Table und die Summe ist nicht mehr 100 %. */
    G.shareListings = G.shareListings.filter(l => {
      const sellerId = l.sellerId ?? l.companyId;
      if (l.companyId === targetId) return false;            // Firma verschwindet — Angebot hinfällig
      if (sellerId === targetId) {                            // Verkäufer wird übernommen — Anteile an den Käufer
        const company = G.players[l.companyId];
        if (company) company.equity[p.id] = (company.equity[p.id] || 0) + l.count;
        return false;
      }
      if (l.toId === targetId) { returnListingToSeller(l); return false; }   // Empfänger gibt es nicht mehr
      return true;
    });
    G.shareBids = G.shareBids.filter(b => b.companyId !== targetId && b.bidderId !== targetId);
    /* Neue Industrie(n) übernehmen (keine Duplikate) */
    p.stats.fusionen++;
    p.industries = [...new Set([...(p.industries || [p.industry]), ...(target.industries || [target.industry])])];
    logTx(p, "Fusion", `${target.name} übernommen (+${INDUSTRIES[target.industry]?.name ?? target.industry})`, target.cash);
    io.emit("notice", { text: `${p.name} fusioniert mit ${target.name} — jetzt auch in ${INDUSTRIES[target.industry]?.name ?? target.industry} tätig!` });
    /* Falls die aufgelöste Firma selbst Anteile an DRITTEN Firmen hielt, gehen
     * die mit auf die übernehmende Firma über — sonst blieben sie verwaist. */
    for (const other of Object.values(G.players)) {
      if (other.id === targetId || !other.equity[targetId]) continue;
      other.equity[p.id] = (other.equity[p.id] || 0) + other.equity[targetId];
      delete other.equity[targetId];
    }
    /* Zielfirma auflösen: bestehende Verbindung trennen (falls online) und entfernen */
    if (target.socketId) { const ts = io.sockets.sockets.get(target.socketId); if (ts) ts.disconnect(true); delete G.socketToPid[target.socketId]; }
    delete G.players[targetId];
    ack?.({ ok: true });
  }));

  socket.on("bid", guard((p, { auctionId, amount }, ack) => {
    const a = G.auctions.find(a => a.id === auctionId);
    amount = Math.floor(+amount);
    if (!a) return ack?.({ error: "Auktion beendet" });
    if (amount < Math.max(a.minBid, a.bestBid + 1)) return ack?.({ error: "Gebot zu niedrig" });
    if (p.cash < amount) return ack?.({ error: "Zu wenig Kapital" });
    if (a.bestBidder) G.players[a.bestBidder] && (G.players[a.bestBidder].cash += a.bestBid);
    p.cash -= amount; a.bestBid = amount; a.bestBidder = p.id;
    ack?.({ ok: true });
  }));

  /* --- Chat & Direktverträge --- */
  socket.on("chat", guard((p, { room, text }, ack) => {
    if (!ROOMS.includes(room)) return ack?.({ error: "Raum unbekannt" });
    text = sicherText(String(text || "").slice(0, 300));
    /* Auch dieser Fall muss quittiert werden. Ein blankes return ließ die
     * Ack-Funktion des Clients für immer offen: wer darauf wartet, hängt, und
     * socket.io hält den Rückruf bis zum Verbindungsende im Speicher. */
    if (!text.trim()) return ack?.({ error: "Leere Nachricht" });
    const msg = { who: p.name, color: p.color, text, ts: Date.now() };
    G.chat[room].push(msg); if (G.chat[room].length > 100) G.chat[room].shift();
    io.emit("chat", { room, msg });
    ack?.({ ok: true });
  }));

  socket.on("offerContract", guard((p, { toId, good, qty, price }, ack) => {
    const to = G.players[toId];
    qty = Math.floor(+qty); price = +price;
    if (!to || toId === p.id || !GOODS[good] || !(qty > 0) || !(price > 0)) return ack?.({ error: "Ungültig" });
    if (p.inv[good] < qty) return ack?.({ error: "Nicht genug Ware für dieses Angebot" });
    const c = { id: id(), fromId: p.id, from: p.name, toId, good, qty, price, status: "open", ttl: CONTRACT_TTL };
    G.contracts.push(c);
    emitTo(toId, "contractOffer", c);
    ack?.({ ok: true });
  }));

  socket.on("acceptContract", guard((p, { contractId }, ack) => {
    const c = G.contracts.find(c => c.id === contractId && c.toId === p.id && c.status === "open");
    if (!c) return ack?.({ error: "Vertrag nicht mehr offen" });
    const seller = G.players[c.fromId];
    if (!seller || seller.inv[c.good] < c.qty) { dropContract(c); return ack?.({ error: "Verkäufer kann nicht liefern" }); }
    if (p.cash < c.qty * c.price) return ack?.({ error: "Zu wenig Kapital" });
    p.cash -= c.qty * c.price; seller.inv[c.good] -= c.qty;
    settleTrade(c.good, c.qty, c.price, p.id, c.fromId);
    dropContract(c);
    ack?.({ ok: true });
  }));

  socket.on("declineContract", guard((p, { contractId }, ack) => {
    const c = G.contracts.find(c => c.id === contractId && c.toId === p.id);
    if (!c) return ack?.({ error: "Vertrag nicht gefunden" });
    emitTo(c.fromId, "notice", { text: `${p.name} lehnt dein Angebot über ${c.qty}× ${GOODS[c.good].name} ab.` });
    dropContract(c);
    ack?.({ ok: true });
  }));

  /* Verbindung weg (Tab zu, WLAN-Aussetzer, Reload) — Spieler bleibt mit vollem
   * Zustand erhalten; erst nach RECONNECT_GRACE_MS ohne Rückkehr räumt der
   * Tick-Loop endgültig auf (siehe runTick). Orders/Gebäude/Bonds bleiben so lange
   * unangetastet, ein rejoin mit dem gespeicherten Token setzt alles nahtlos fort. */
  socket.on("disconnect", () => {
    const pid = G.socketToPid[socket.id];
    delete G.socketToPid[socket.id];
    const p = G.players[pid];
    if (!p) return;
    /* Nach einem Verbindungsabriss meldet sich der Client sofort über eine neue
     * Verbindung zurück (rejoin), während das "disconnect" der alten oft erst
     * danach eintrifft. Ohne diese Prüfung setzte dieser Nachzügler socketId
     * wieder auf null — der Spieler blieb dann zwar handlungsfähig (Aktionen
     * laufen über socketToPid), bekam aber nie wieder ein "me": Bargeld und
     * Lager standen für den Rest der Runde eingefroren da, ohne Fehlermeldung. */
    if (p.socketId && p.socketId !== socket.id) return;
    p.disconnected = true; p.disconnectedAt = Date.now(); p.socketId = null;
    io.emit("notice", { text: `${p.name} hat die Verbindung verloren — kann wieder beitreten.` });
    /* Verlässt der Host den Warteraum, bevor die Runde läuft, könnte sonst
     * niemand mehr starten — die Wartenden säßen dauerhaft fest. */
    if (!G.started && pid === G.hostId) {
      const ersatz = Object.values(G.players).find(o => o.id !== pid && !o.disconnected);
      if (ersatz) {
        G.hostId = ersatz.id;
        io.emit("notice", { text: `${ersatz.name} übernimmt als Host.` });
      }
    }
    pushState();
  });
});

/* ---------- Server-Tick: 1×/s Produktion, Zinsen, Fristen, Auktionen ----------
 * Läuft komplett in try/catch: ein einzelner Bug in einem Tick darf niemals den
 * ganzen Prozess (und damit die Runde für alle Spieler) abschießen — Node killt
 * den Prozess sonst standardmäßig bei jeder unabgefangenen Exception im Timer. */
setInterval(() => {
  const _t0 = PERF ? process.hrtime.bigint() : 0n;
  try { runTick(); } catch (e) { console.error("Tick-Fehler (übersprungen):", e); }
  if (PERF) perf.maxTickMs = Math.max(perf.maxTickMs, Number(process.hrtime.bigint() - _t0) / 1e6);
}, 1000);
function runTick() {
  if (!G.started) return;   // Warteraum: nichts produzieren, keine Fristen laufen lassen
  G.tick++;
  /* Produktion: Enabler-Rohstoffe im Lager boosten (und werden verbraucht) */
  for (const t of G.map) {
    if (!t.btype || !t.owner) continue;
    const p = G.players[t.owner], bt = BTYPES[t.btype];
    if (!p) continue;
    if (bt.retail) {   // Shop: verkauft konfigurierte Ware zum selbstgesetzten Preis
      if (t.paused) continue;
      t.shop?.forEach((slot, i) => {
        if (!slot?.good || !(slot.price > 0)) return;
        /* Werbung hebt den Bezugspreis: derselbe Verkaufspreis wirkt dadurch
         * günstiger und bremst das Tempo weniger. */
        let q = Math.min(p.inv[slot.good], bt.retail.base * retailFlow(slot.good) * shopSpeed(slot.good, slot.price, MM[slot.good].price * adBoost(p)));
        if (slot.qty != null) q = Math.min(q, slot.qty);   // begrenzte Verkaufsmenge
        if (q <= 0) return;
        p.inv[slot.good] -= q;
        p.cash += q * slot.price; addRevenue(p, q * slot.price);
        const r = salesRec(p, slot.good); r.botQty += q; r.botRev += q * slot.price;
        noteSold(slot.good, q);
        if (slot.qty != null) {
          slot.qty -= q;
          if (slot.qty <= 0.001) {   // Auftrag komplett verkauft
            t.shop[i] = null;
            logTx(p, "Verkauf", `${bt.name}: Verkaufsauftrag ${GOODS[slot.good].name} @ ${slot.price} $ abgeschlossen`, 0);
            emitTo(p.id, "notice", { text: `${bt.name}: ${GOODS[slot.good].name}-Auftrag ausverkauft (@ ${slot.price} $/Stk).` });
          }
        }
      });
      continue;
    }
    if (bt.proc) {   // Verarbeitung: Inputs anteilig verbrauchen, Output erzeugen
      if (t.paused) continue;
      const lvl = levelMult(t.level);   // Elektronik-Upgrade: mehr Input rein, mehr Output raus
      let frac = 1;
      for (const [g, need] of Object.entries(bt.proc.in)) frac = Math.min(frac, (p.inv[g] || 0) / (need * lvl));
      if (frac > 0) {
        for (const [g, need] of Object.entries(bt.proc.in)) p.inv[g] -= need * lvl * frac;
        const menge = bt.proc.rate * lvl * frac;
        p.inv[bt.proc.out] += menge;
        p.stats.produziert[bt.proc.out] = (p.stats.produziert[bt.proc.out] || 0) + menge;
      }
      continue;
    }
    if (!bt.out) continue;
    const stufe = levelMult(t.level);
    let mult = 1;
    /* Boost-Verbrauch hängt an der Größe des Betriebs, nicht an einer festen
     * Stückzahl. Vorher verschlang jeder Betrieb 1 Einheit JE TICK — bei der
     * Mine also 60 Öl pro Minute, mehr als drei Viertel dessen, was eine ganze
     * Ölpumpe fördert. Öl fehlte dadurch überall sonst: Stahlwerk und
     * Raffinerie brauchen es zwingend, also gab es weder Stahl noch Diesel und
     * damit auch keine Fahrzeuge. Obendrein war der Handel für die Mine ein
     * sicheres Verlustgeschäft (8,80 $ Einsatz für 4,60 $ Mehrertrag) — sie tat
     * es trotzdem, weil der Verbrauch automatisch läuft. */
    for (const r of bt.boosts || []) {
      const bedarf = bt.rate * stufe * 0.5;
      if ((p.inv[r] || 0) >= bedarf) { p.inv[r] -= bedarf; mult += BOOST_MULT; }
    }
    const menge = bt.rate * mult * stufe;   // Elektronik-Upgrade: +30 %/Stufe
    p.inv[bt.out] += menge;
    p.stats.produziert[bt.out] = (p.stats.produziert[bt.out] || 0) + menge;
  }
  /* Referenzkurs (Ticker/Bewertung): Anker folgt Angebot/Nachfrage, Kurs driftet im Band.
   * Reine Preis-Simulation ohne Gegenpartei — die Börse selbst ist ausschließlich P2P,
   * es gibt keinen Bot mehr, der Spieler-Orders automatisch kauft oder verkauft. */
  for (const k of Object.keys(GOODS)) {
    const mm = MM[k];
    mm.sold *= 0.994;                                                   // Druck zerfällt (~2 min HWZ)
    const targetAnchor = BASEP[k] * Math.min(1.3, Math.max(0.5, 1.15 - 0.4 * soldPressure(k)));
    mm.anchor += (targetAnchor - mm.anchor) * 0.02;                     // Anker wandert langsam
    mm.price += (Math.random() - 0.5) * mm.band * 0.15;                 // Zufallsdrift
    if (G.lastTrade[k]) mm.price += (G.lastTrade[k] - mm.price) * 0.03; // echte Trades ziehen leicht
    mm.price = Math.min(mm.anchor + mm.band, Math.max(mm.anchor - mm.band, mm.price)); // Band um Anker
    mm.price = Math.round(mm.price * 100) / 100;
  }
  /* Anleihen: Kupon pro Sekunde = principal * rate / 60 (Zins „pro Minute") */
  for (const b of [...G.bonds]) {
    if (!b.holderId) continue;
    const debtor = G.players[b.issuerId], holder = G.players[b.holderId];
    const coupon = b.principal * b.rate / 60;
    if (debtor && debtor.cash >= coupon) {
      debtor.cash -= coupon; debtor.fin.zinsAufwand += coupon; debtor.stats.zinsAufwand += coupon;
      if (holder) { holder.cash += coupon; holder.fin.zinsErtrag += coupon; holder.stats.zinsErtrag += coupon; }
      b.strikes = 0;
      const lienTile = G.map.find(t => t.owner === b.issuerId && t.lien);
      if (lienTile && !G.bonds.some(x => x !== b && x.issuerId === b.issuerId && x.strikes > 0)) lienTile.lien = false;
    } else if (debtor) {
      b.strikes++;
      if (b.strikes === 3) {           // Pfandrecht setzen
        const t = G.map.find(t => t.owner === debtor.id && t.btype && !t.lien);
        if (t) { t.lien = true; io.emit("notice", { text: `Pfandrecht auf ${BTYPES[t.btype].name} von ${debtor.name}` }); }
      }
      if (b.strikes >= 15) seizeAndAuction(debtor, b);
    }
    b.termLeft--;
    if (b.termLeft <= 0 && G.bonds.includes(b)) {   // Tilgung fällig
      if (debtor && debtor.cash >= b.principal) {
        debtor.cash -= b.principal;
        logTx(debtor, "Anleihen", "Anleihe getilgt", -b.principal);
        if (holder) { holder.cash += b.principal; logTx(holder, "Anleihen", `Tilgung von ${debtor.name}`, b.principal); }
        G.bonds.splice(G.bonds.indexOf(b), 1);
        io.emit("notice", { text: `${debtor.name} hat eine Anleihe (${b.principal} $) getilgt.` });
      } else if (debtor) {
        b.termLeft = 30; b.strikes += 5;             // Verzug bei Tilgung eskaliert
      }
    }
  }
  /* Unverkaufte Emissionen nach Laufzeit vom Markt nehmen */
  G.bonds = G.bonds.filter(b => b.holderId || (--b.termLeft ?? 1) > -60);
  /* Auktionen */
  for (const a of [...G.auctions]) {
    a.tLeft--;
    if (a.tLeft > 0) continue;
    G.auctions.splice(G.auctions.indexOf(a), 1);
    const t = G.map[a.tileIdx];
    if (a.bestBidder && G.players[a.bestBidder]) {
      t.owner = a.bestBidder; t.btype = a.btype;
      logTx(G.players[a.bestBidder], "Auktion", `Zuschlag ${BTYPES[a.btype].name}`, -a.bestBid);
      const creditor = G.players[a.creditorId];
      if (creditor) { creditor.cash += a.bestBid;    // Erlös an den Gläubiger
        logTx(creditor, "Auktion", `Verwertungserlös ${BTYPES[a.btype].name}`, a.bestBid); }
      io.emit("notice", { text: `Zuschlag: ${BTYPES[a.btype].name} für ${a.bestBid} $ an ${G.players[a.bestBidder].name}` });
    } else {
      io.emit("notice", { text: `Auktion ohne Gebot beendet — ${BTYPES[a.btype].name} verfällt.` });
    }
  }
  /* Gruppenauftrag: spawnen bzw. Ablauf (Waren zurück an die Einzahler) */
  if (!G.groupOrder && --G.nextGroupIn <= 0) spawnGroupOrder();
  else if (G.groupOrder && --G.groupOrder.ttl <= 0) {
    for (const [pid, goods] of Object.entries(G.groupOrder.contrib)) {
      const p = G.players[pid];
      if (p) for (const [g, qty] of Object.entries(goods)) p.inv[g] += qty;
    }
    io.emit("notice", { text: `Gruppenauftrag für ${G.groupOrder.city} abgelaufen — Einzahlungen wurden zurückerstattet.` });
    G.groupOrder = null; G.nextGroupIn = GROUP_GAP();
  }
  /* Werbe-Reichweite zerfällt: wer aufhört zu werben, ist nach gut zwei Minuten
   * wieder beim Ø-Kurs. */
  for (const p of Object.values(G.players)) {
    if (p.adReach > 0) p.adReach = p.adReach < 0.5 ? 0 : p.adReach * AD_DECAY;
  }
  /* Umsatzfenster weiterdrehen: jede Minute rutscht ein neuer Eimer nach vorn,
   * der älteste fällt hinten raus. Damit misst rev10() immer die letzten 10 min. */
  if (G.tick % 60 === 0) for (const p of Object.values(G.players)) {
    p.revBuckets.unshift(0);
    p.revBuckets.length = REV_WINDOW_MIN;
  }
  /* Direktangebote verfallen, wenn der Empfänger nicht reagiert */
  for (let i = G.contracts.length - 1; i >= 0; i--) {
    const c = G.contracts[i];
    if (c.status !== "open" || --c.ttl > 0) continue;
    emitTo(c.fromId, "notice", { text: `Dein Angebot an ${G.players[c.toId]?.name ?? "einen Spieler"} ist abgelaufen.` });
    G.contracts.splice(i, 1);
  }
  /* Kaufanfragen verfallen, wenn niemand entscheidet */
  for (let i = G.shareBids.length - 1; i >= 0; i--) {
    if (--G.shareBids[i].ttl <= 0) {
      emitTo(G.shareBids[i].bidderId, "notice", { text: `Deine Kaufanfrage an ${G.players[G.shareBids[i].companyId]?.name ?? "eine Firma"} ist abgelaufen.` });
      G.shareBids.splice(i, 1);
    }
  }
  /* Nachrichtenzentrale: Marktbericht alle zwei Minuten. Bewusst versetzt zur
   * vollen Minute, damit er nicht mit der Dividendenmeldung zusammenfällt. */
  if (G.tick > 60 && G.tick % NEWS_INTERVAL === 0) sendeMarktbericht();
  /* Aktien: Dividendenausschüttung alle 10 min */
  if (--G.nextDividendIn <= 0) { distributeDividends(); G.nextDividendIn = DIVIDEND_INTERVAL; }
  /* Nettovermögens-Verlauf (alle 10 s ein Punkt, max. 120 Punkte = 20 min) */
  if (G.tick % 10 === 0) for (const p of Object.values(G.players)) {
    p.nwHist.push(Math.round(netWorth(p)));
    if (p.nwHist.length > 120) p.nwHist.shift();
  }
  /* Kursverlauf je Ware — Grundlage der Sparklines an der Börse.
   * Bewusst NICHT Teil des Zustands: der geht jede Sekunde an jeden Spieler,
   * die Historie ändert sich aber nur alle 10 s. Als eigenes Ereignis kostet
   * sie ein Zehntel der Daten (33 Waren × 60 Punkte wären sonst rund 20 KB
   * pro Sekunde und Spieler, nur damit sich neunmal von zehn nichts ändert). */
  if (G.tick % 10 === 0) {
    for (const k of Object.keys(GOODS)) {
      const h = (G.priceHist[k] ??= []);
      h.push(MM[k].price);
      if (h.length > 60) h.shift();          // 60 Punkte = 10 min Rückblick
    }
    /* Firmenwerte im selben Takt. p.nwHist gibt es zwar schon, das steckt aber
     * im PRIVATEN Zustand — man sähe damit nur die eigene Kurve, während die
     * Kurstafel gerade den Vergleich mit den anderen leisten soll. */
    for (const pl of Object.values(G.players)) {
      const h = (G.firmHist[pl.id] ??= []);
      h.push(Math.round(companyValue(pl)));
      if (h.length > 60) h.shift();
    }
    for (const pid of Object.keys(G.firmHist)) if (!G.players[pid]) delete G.firmHist[pid];
    /* Beides in einem Ereignis: zwei Sendungen im selben Takt wären eine
     * Rundreise mehr, ohne dass die Daten je getrennt gebraucht würden. */
    io.emit("kurse", { waren: G.priceHist, firmen: G.firmHist });
  }
  /* Siegbedingung */
  if (!G.winner) for (const p of Object.values(G.players)) {
    if (netWorth(p) >= WIN_NW) {
      G.winner = p.name;
      /* Auswertung genau einmal berechnen und in den Zustand legen — sie geht
       * dann mit dem nächsten Broadcast an alle. Sie jedes Mal mitzuschicken
       * wäre Verschwendung, sie ist nur am Rundenende interessant. */
      G.report = buildReport(p.id);
      io.emit("notice", { text: `${p.name} gewinnt mit ${WIN_NW.toLocaleString("de-DE")} $ Nettovermögen!` });
    }
  }
  /* Reconnect-Gnadenfrist abgelaufen → jetzt endgültig aufräumen (offene Orders
   * zurückerstatten, Spieler entfernen). Gebäude/Bonds/Anteile bleiben wie bei
   * jedem Ausscheiden verwaist bestehen, wie in den Design-Notizen dokumentiert. */
  for (const [pid, p] of Object.entries(G.players)) {
    if (p.disconnected && Date.now() - p.disconnectedAt > RECONNECT_GRACE_MS) {
      for (const o of G.orders.filter(o => o.playerId === pid)) refundOrder(o);
      G.orders = G.orders.filter(o => o.playerId !== pid);
      /* Aktienangebote auflösen, bevor der Spieler weg ist — verwahrte Anteile
       * gehen an ihre Verkäufer zurück, Angebote auf die eigene Firma verfallen. */
      G.shareListings = G.shareListings.filter(l => {
        const sellerId = l.sellerId ?? l.companyId;
        if (l.companyId === pid) return false;
        if (sellerId === pid || l.toId === pid) { returnListingToSeller(l); return sellerId !== pid; }
        return true;
      });
      G.shareBids = G.shareBids.filter(b => b.companyId !== pid && b.bidderId !== pid);
      /* Laufende Auktionen mitziehen. Das Gebot wurde beim Bieten bereits vom
       * Konto abgebucht; verschwindet der Bieter, war es bisher trotzdem noch
       * das Höchstgebot: Es blockierte günstigere Gebote, und am Ende griff
       * mangels Spieler der "verfällt"-Zweig — das Gebäude war weg und der
       * Gläubiger ging leer aus, obwohl ein gültiges Gebot vorlag. Jetzt wird
       * die Auktion wieder freigegeben, damit sie noch einen Käufer findet. */
      for (const a of G.auctions) {
        if (a.bestBidder === pid) { a.bestBidder = null; a.bestBid = 0; }
      }
      delete G.players[pid];
      io.emit("notice", { text: `${p.name} hat die Sitzung endgültig verlassen.` });
    }
  }
  pushState();
}

/* ============================================================
 * Vier Industrie-Bots — je einer pro Kategorie. Sie verbinden sich
 * als normale Clients über die öffentliche API (können nicht schummeln)
 * und halten den Markt am Laufen:
 *  - DECKEN BEDARF: stehende Kauforders für die Inputs ihrer Industrie
 *    (leicht unter Ø) → echte Spieler können jederzeit an sie verkaufen
 *  - BEFÜLLEN DIE BÖRSE: verkaufen ihre Outputs in kleinen Tranchen,
 *    aber NUR wenn das Orderbuch dünn ist (< 15 Stk) → kein Überschuss,
 *    Spieler-Orders haben immer Vorrang und Absatzchancen
 *  - bauen träge ihre eigene Kette auf (1 Gebäude / ~2 min)
 * Abschalten: BOT=0 npm start
 * ============================================================ */
/* ---------- Schwierigkeitsgrade ----------
 * Die Bots spielen auf allen Stufen über dieselbe öffentliche API wie Menschen —
 * sie bekommen keine Sonderrechte, kein Extrakapital und keine höhere
 * Produktionsrate. Unterschiedlich stark sind sie dadurch, wie schnell sie
 * ausbauen, wie oft sie überhaupt handeln, wie hart sie um Preise feilschen und
 * ob sie die teuren Optimierungen (Gebäude aufleveln, Produktion boosten)
 * überhaupt nutzen. */
const BOT_LEVELS = {
  /* Zu den Handelsfaktoren: ein Messlauf über 4 Minuten hat gezeigt, dass sie
   * anfangs verkehrt herum wirkten — der "schwere" Bot zahlte mehr für Material
   * UND verlangte mehr beim Verkauf, seine Orders wurden dadurch seltener
   * bedient, und er hatte am Ende WENIGER Gebäude als der leichte. Richtig ist:
   * der schwache Bot wirtschaftet schlecht (kauft teuer ein, verschleudert die
   * Ware unter Wert), der starke handelt sauber zum Marktpreis und zahlt beim
   * Einkauf nur den kleinen Aufschlag, der nötig ist, um wirklich zum Zug zu
   * kommen. Kein Bot bekommt Sonderrechte — alle laufen über dieselbe API. */
  einfach: { name: "Einfach", bauPause: 150_000, takt: 34_000, maxGebaeude: 3,
             kaufAufschlag: 1.08, verkaufKurs: 0.88, leveln: false, boosten: false, auktionen: false },
  mittel:  { name: "Mittel",  bauPause:  85_000, takt: 26_000, maxGebaeude: 5,
             kaufAufschlag: 1.00, verkaufKurs: 0.98, leveln: true,  boosten: false, auktionen: true },
  schwer:  { name: "Schwer",  bauPause:  40_000, takt: 17_000, maxGebaeude: 8,
             kaufAufschlag: 1.02, verkaufKurs: 1.00, leveln: true,  boosten: true,  auktionen: true },
};
const BOT_LEVEL_DEFAULT = "mittel";

/* ---------- Produktabdeckung ----------
 * Fehler, der das hier nötig gemacht hat: Montan & Bau AG lief mit dem Plan
 * ["mine","mine","bauhandel","ziegelei",...] — zwei Erzminen VOR der Ziegelei.
 * Bei kurzen Runden oder der niedrigen Baugrenze von "Einfach" (3 Gebäude) kam
 * die Ziegelei nie dran: die Firma produzierte am Ende nur Erz, kein einziges
 * Ziegel — obwohl "Rohstoff- & Bauindustrie" laut Auswahlbildschirm genau dafür
 * dasteht ("jeder braucht sie zum Bauen").
 *
 * Deshalb jetzt hart getrennt in zwei Phasen: ERST eine Kachel für JEDES
 * Produkt der eigenen Branche (kein zweites Gebäude, solange noch ein Produkt
 * fehlt), DANACH erst Shops, Werbung und Dopplungen zur Skalierung. Die
 * Reihenfolge innerhalb der Abdeckung ist so gewählt, dass ein Rohstoff, den
 * ein späterer Eintrag als Zutat braucht, immer schon vorher gebaut ist (z. B.
 * Mine vor Ziegelei — die Ziegelei verarbeitet Erz).
 * Bei niedrigen Baugrenzen (Stufe "Einfach": nur 3 Gebäude) deckt ein Bot dann
 * eben nur die ersten drei Produkte ab, statt eines davon doppelt zu bauen —
 * genau das war die Forderung: Abdeckung geht immer vor Dopplung. */
const INDUSTRY_COVERAGE = {
  agrar:     ["farm", "imkerei", "plantage", "saftpresse", "baeckerei", "pharma"],
  rohstoff:  ["mine", "ziegelei", "betonwerk", "stahlwerk"],
  versorger: ["brunnen", "ewerk", "oelpumpe", "raffinerie"],
  tech:      ["siliziummine", "chipfabrik", "autowerk", "dieselwerk", "eautowerk"],
  touristik: ["campingplatz", "strandhotel"],
  ruestung:  ["munitionsfabrik", "waffenschmiede", "panzerwerk"],
};

/* Genau zwei Bots je Branche — der Startbildschirm lässt je Branche 0, 1 oder 2
 * davon zu. `plan` ist hier nur noch die ZWEITE Phase (nach vollständiger
 * Produktabdeckung): Shops, Werbung, welches Produkt zuerst verdoppelt wird.
 * Die beiden einer Branche unterscheiden sich weiterhin bewusst darin. */
const BOT_CFGS = [
  { name: "AgrarGenossen",   industry: "agrar",     color: "#34d399",
    plan: ["markt", "farm", "werbeagentur", "kontor"], needs: ["wasser", "strom"] },
  { name: "Grünhof & Söhne", industry: "agrar",     color: "#6fae4e",
    plan: ["kontor", "plantage", "werbeagentur", "markt"], needs: ["wasser", "strom"] },

  /* Zweites Stahlwerk gleich nach der Abdeckung. Über eine ganze Runde von
   * 78 Minuten gab es im Spiel nur EIN Stahlwerk, und Stahl war durchgehend
   * nicht käuflich: Angebot 0 bei Nachfrage 98, der Kurs stand zehn Minuten
   * unbewegt auf 137,25 $ — ein Preis, zu dem kein einziger Handel zustande
   * kam. Das legte gleich zwei Produktlinien still (das fertig ausgebaute
   * Benzin-Autowerk eines Spielers und die komplette Rüstungskette). Stahl ist
   * die Zutat mit der breitesten Abhängigkeit im Spiel, sie darf nicht an
   * einem einzigen Gebäude hängen. */
  { name: "Montan & Bau AG", industry: "rohstoff",  color: "#fbbf24",
    plan: ["stahlwerk", "bauhandel", "werbeagentur", "kontor"], needs: ["strom", "oel", "wasser"] },
  { name: "Felswerk",        industry: "rohstoff",  color: "#f97316",
    plan: ["stahlwerk", "kontor", "mine", "werbeagentur", "bauhandel"], needs: ["strom", "oel", "wasser"] },

  { name: "Stadtwerke",      industry: "versorger", color: "#38bdf8",
    plan: ["kontor", "wasserwerk", "werbeagentur", "windpark"], needs: [],
    /* Öl gehört hier zwingend dazu. Der eigentliche Ölförderer "Nordsee Öl"
     * ist der ZWEITE Versorger-Bot und läuft bei der Voreinstellung von einem
     * Bot je Branche gar nicht mit. Stadtwerke baut zwar über die
     * Produktabdeckung eine Ölpumpe, verbrauchte das Öl aber still in der
     * eigenen Raffinerie — am Markt kam nie welches an. Ohne Öl steht das
     * Stahlwerk, ohne Stahl gibt es keine Fahrzeuge. */
    alwaysSell: ["wasser", "strom", "oel"] },
  /* Reiner Ölförderer: baut immer weiter Ölpumpen und stellt alles Geförderte
   * sofort in den Markt. Öl ist mit 8 $ das wertvollste Grundgut, deshalb bleibt
   * er auch auf "Schwer" bei höchstens vier Pumpen gedeckelt. Bewusste Ausnahme
   * von der Abdeckungsregel oben: er soll gar nicht die ganze Branche
   * abbilden, sondern gezielt nur den Ölnachschub sichern. */
  { name: "Nordsee Öl",      industry: "versorger", color: "#e5762f",
    plan: ["oelpumpe"], planLoop: true, maxGebaeude: 4, needs: [], alwaysSell: ["oel"] },

  { name: "ChipWerke",       industry: "tech",      color: "#a78bfa",
    plan: ["bauhandel", "siliziummine", "werbeagentur", "kontor"], needs: ["strom", "stahl", "oel"] },
  { name: "Volt & Silicon",  industry: "tech",      color: "#e879f9",
    plan: ["kontor", "siliziummine", "werbeagentur", "autohaus"], needs: ["strom", "stahl"] },

  /* Touristik: kauft Wasser und Strom zu und verkauft Übernachtungen über ein
   * eigenes Kontor. Bewusst nur einer — die Branche ist neu und soll den Markt
   * erst einmal nicht dominieren. */
  { name: "Küstenperle",     industry: "touristik", color: "#2dd4bf",
    plan: ["campingplatz", "kontor", "strandhotel", "werbeagentur"], maxGebaeude: 4,
    needs: ["wasser", "strom"], alwaysSell: ["uebernachtung"] },

  /* Rüstung: baut erst die billige Munitionsfabrik, damit früh Geld reinkommt,
   * und kauft Stahl, Elektronik und Diesel für die teureren Stufen zu. */
  { name: "Stahlfaust",      industry: "ruestung",  color: "#f43f5e",
    plan: ["kontor", "munitionsfabrik", "waffenhandel", "werbeagentur"], maxGebaeude: 5,
    /* Bewusst nur die Zutaten der ersten Stufen: Jede Ware in dieser Liste
     * bindet beim Einkauf bis zu 25 Stück Kapital. Mit Stahl (115 $) und
     * Elektronik (98 $) gleichzeitig war der Bot sofort klamm und kam über
     * die Munitionsfabrik nie hinaus — gemessen: Bargeld 2001 → 1136 bei
     * einem einzigen Gebäude. */
    needs: ["erze", "oel", "stahl"], alwaysSell: ["munition"] },
];
let botsStarted = false;
/* Vom ersten Spieler der Runde gewählt (siehe register): wie viele Bots je
 * Branche mitspielen und wie stark sie sind. */
let botAuswahl = null, botLevelKey = BOT_LEVEL_DEFAULT;
/* Laufende Bots festhalten: bei einem Rundenneustart müssen ihre Verbindungen
 * und Zeitgeber beendet werden, sonst laufen die alten Schleifen mit veralteten
 * Spieler-IDs weiter und die neue Runde bekommt die Bots doppelt. */
const botHandles = [];
/* Rundenzähler: die Bots starten zeitversetzt. Ohne diesen Zähler könnten noch
 * ausstehende Starts einer beendeten Runde in die neue hineinfeuern und die
 * Bots doppelt anlegen. */
let botGen = 0;
function startBots() {
  if (botsStarted || process.env.BOT === "0") return;
  botsStarted = true;
  const lvl = BOT_LEVELS[botLevelKey] || BOT_LEVELS[BOT_LEVEL_DEFAULT];
  /* Ohne Auswahl (z. B. alter Client) je Branche ein Bot. Sonst genau so viele,
   * wie im Startbildschirm eingestellt wurden — höchstens zwei je Branche. */
  const gewuenscht = {};
  for (const k of Object.keys(INDUSTRIES)) {
    const n = botAuswahl ? Math.max(0, Math.min(2, Math.floor(+botAuswahl[k] || 0))) : 1;
    gewuenscht[k] = n;
  }
  const genommen = {};
  const liste = BOT_CFGS.filter(cfg => {
    genommen[cfg.industry] = (genommen[cfg.industry] || 0) + 1;
    return genommen[cfg.industry] <= (gewuenscht[cfg.industry] || 0);
  });
  if (!liste.length) { botsStarted = false; return; }   // ohne Bots gar nicht erst hochfahren
  const gen = ++botGen;
  console.log(`Bots: ${liste.map(c => c.name).join(", ") || "keine"} — Stufe ${lvl.name}`);
  liste.forEach((cfg, i) => setTimeout(() => { if (gen === botGen && botsStarted) spawnBot(cfg, lvl); }, 8000 + i * 5000));
}
function stopBots() {
  botGen++;
  for (const h of botHandles) { clearInterval(h.timer); h.socket.close(); }
  botHandles.length = 0;
  botsStarted = false;
}
async function spawnBot(cfg, lvl = BOT_LEVELS[BOT_LEVEL_DEFAULT]) {
  const { io: ioClient } = await import("socket.io-client");
  const s = ioClient(`http://localhost:${PORT}`);
  let me = null, st = null, myId = null, lastBuild = 0;
  s.on("me", m => me = m);
  /* Auch die Bots bekommen die Karte nur noch als Diff — sie lesen st.map aber
   * direkt, also hier dieselbe Zusammenführung wie im Browser-Client. */
  let botMap = null;
  s.on("state", x => {
    if (x.map) botMap = x.map;
    else if (x.mapDelta && botMap) {
      for (const d of x.mapDelta) {
        const t = botMap[d.i];
        if (t) for (const k in d) if (k !== "i") t[k] = d[k];
      }
    }
    st = botMap ? { ...x, map: botMap } : x;
  });
  s.on("connect", () => s.emit("register", { name: cfg.name, color: cfg.color, industry: cfg.industry },
    res => { if (res?.ok) myId = res.you; }));
  /* Mit Zeitlimit: bleibt eine Bestätigung aus — etwa weil ein Handler sie
   * vergisst —, würde der Bot sonst an dieser Stelle für immer stehen bleiben
   * und den Rest seiner Runde nie erreichen. Lieber weitermachen. */
  const em = (ev, p) => new Promise(r => {
    const frist = setTimeout(() => r({ error: "keine Antwort" }), 8000);
    s.emit(ev, p, res => { clearTimeout(frist); r(res); });
  });
  /* Überlappungsschutz: der Rumpf ist asynchron und wird mit der Zeit länger
   * (mehr Gebäude, mehr Shops, mehr Angebote). Ohne diese Sperre startet der
   * Timer den nächsten Durchlauf, während der vorige noch läuft — die
   * Durchläufe stapeln sich dann auf und schaukeln sich gegenseitig hoch. */
  let laeuft = false;
  const timer = setInterval(async () => {
    if (laeuft || !me || !st || !myId || st.winner) return;
    laeuft = true;
    try {
      /* Shops konfigurieren: eigene Hauptware zum Ø-Kurs, unbegrenzt */
      for (const t of st.map) {
        if (t.owner !== myId || !t.shop) continue;
        const goods = (BTYPES[t.btype]?.retail?.goods || []).filter(g => me.inv[g] > 5);
        t.shop.forEach((sl, i) => {
          if (!sl && goods[0]) em("configureShop", { x: t.x, y: t.y, slot: i, good: goods[0],
            price: Math.round(st.avg[goods[0]] * 100) / 100 });
        });
      }
      /* Großauftrag: die Hälfte des Lagers beisteuern */
      if (st.groupOrder) for (const [g, n] of Object.entries(st.groupOrder.needs)) {
        const q = Math.min(Math.floor((me.inv[g] || 0) / 2), n.req - n.have);
        if (q > 0) await em("contribute", { good: g, qty: q });
      }
      /* Zwangsversteigerungen: bieten bis max. 70 % des Neuwerts (Schnäppchenjäger).
       * Auf der leichten Stufe halten sich die Bots hier ganz raus. */
      for (const a of (lvl.auktionen ? st.auctions || [] : [])) {
        const cap = Math.floor((BTYPES[a.btype]?.cost || 0) * 0.7);
        const next = Math.max(a.minBid, a.bestBid + Math.ceil(cap * 0.05));
        if (a.bestBidder !== myId && next <= cap && me.cash > next + 2500) {
          await em("bid", { auctionId: a.id, amount: next });
        }
      }
      /* --- Aktien ---
       * Reihenfolge wie in einer echten Firma: fehlt Kapital, wird zuerst
       * Beteiligung an FREMDEN Firmen zu Geld gemacht und erst danach die eigene
       * Firma verwässert. Preise richten sich nach dem Marktwert je 25 %-Block,
       * den der Server ohnehin mitliefert — vorher boten die Bots ihre eigene
       * Firma pauschal für 12 % des Nettovermögens an, also für rund die Hälfte
       * des fairen Preises. */
      const meinBlock = st.players[myId]?.blockPrice || 0;
      const eigeneOffen = st.shareListings.some(l => l.sellerId === myId);
      if (me.cash < 1500 && !eigeneOffen) {
        const depot = (me.portfolio || []).filter(h => h.count > 0);
        if (depot.length) {
          /* Beteiligung abstoßen — leicht unter Marktwert, damit sie zügig weggeht */
          const h = depot.sort((a, b) => b.value - a.value)[0];
          await em("listShares", { companyId: h.id, count: 1, price: Math.max(200, Math.round(h.blockPrice * 0.95)) });
        } else if ((st.players[myId]?.ownPct ?? 0) > 50 && meinBlock > 0) {
          /* Notverkauf eigener Anteile: 10 % Abschlag auf den Marktwert, nicht mehr.
           * Untergrenze 50 %: Vorher stand hier nur "> 0", ein dauerhaft klammer
           * Bot verkaufte sich damit Block für Block bis auf null herunter.
           * Gemessen an Stahlfaust am Rundenende: Nettovermögen 0 bei 8.300 $
           * Umsatz und Bonität D — netWorth summiert ausschliesslich GEHALTENE
           * Anteile, und er hielt keinen einzigen mehr an sich selbst. Die
           * Anzeige war korrekt, die Firma hatte sich selbst aufgelöst. */
          await em("listShares", { count: 1, price: Math.max(400, Math.round(meinBlock * 0.9)) });
        }
      } else if (me.cash > 6000) {
        /* Günstige fremde Anteile aufsammeln: nur unter Marktwert zugreifen */
        const guenstig = (st.shareListings || [])
          .filter(l => l.sellerId !== myId && !l.toId && l.price <= me.cash * 0.3)
          .find(l => { const co = st.players[l.companyId]; return co && l.price < co.blockPrice * l.count * 0.95; });
        if (guenstig) await em("buyShares", { listingId: guenstig.id });
        else if (lvl.leveln && Math.random() < 0.25) {
          /* Ab "Mittel" auch von sich aus Kaufanfragen stellen — sonst bleibt der
           * Handelsplatz tot, wenn gerade niemand etwas eingestellt hat. */
          const ziel = Object.values(st.players).find(pp =>
            pp.id !== myId && pp.ownPct > 0 && pp.blockPrice > 0 &&
            pp.blockPrice < me.cash * 0.3 && !(st.shareBids || []).some(b => b.bidderId === myId && b.companyId === pp.id));
          if (ziel) await em("bidShares", { companyId: ziel.id, count: 1, price: Math.round(ziel.blockPrice * 1.05) });
        }
      }
      /* Expansion: nächstes Gebäude, inkl. Zonen-Freischaltung + Materialkauf.
       * Reihenfolge IMMER: erst jedes Produkt der Branche einmal abdecken
       * (INDUSTRY_COVERAGE), erst danach in cfg.plan weiter (Shops, Werbung,
       * Dopplungen). planLoop-Spezialisten (Nordsee Öl) überspringen die
       * Abdeckung bewusst — die sollen ja nur ihr eines Produkt bauen. */
      const gesamtplan = cfg.planLoop ? cfg.plan : [...(INDUSTRY_COVERAGE[cfg.industry] || []), ...cfg.plan];
      const built = st.map.filter(t => t.owner === myId && t.btype).length;
      /* planLoop: der Bot arbeitet seinen Plan nicht einmal ab, sondern beginnt
       * danach wieder von vorn — für Spezialisten wie den Ölförderer. Die
       * Obergrenze kommt aus der Schwierigkeitsstufe, ein Bot kann sie zusätzlich
       * nach unten deckeln (cfg.maxGebaeude). */
      const maxGeb = Math.min(lvl.maxGebaeude, cfg.maxGebaeude ?? Infinity, cfg.planLoop ? Infinity : gesamtplan.length);
      const planFertig = built >= maxGeb;

      /* ---- Fremdkapital ----
       * Bisher rührte kein Bot das Anleihesystem an: `issueBond` und `buyBond`
       * kamen in der ganzen Bot-Schleife nicht vor. Der komplette
       * Fremdkapitalmarkt lief damit nur, wenn zufällig zwei Menschen
       * gleichzeitig spielten — in einer normalen Runde passierte dort nichts.
       *
       * AUFNEHMEN: Genau der Fall, der heute als Kapitalfalle aufgefallen ist —
       * Stahlfaust stand mit 1356 $ fest, konnte keine Zutaten mehr kaufen und
       * kam ohne Produktion nie wieder hoch. Wer Substanz hat, aber kein
       * Bargeld, leiht sich jetzt welches, statt zu erstarren.
       * Bedingungen bewusst eng: mindestens zwei Gebäude als Sicherheit, keine
       * zweite Anleihe parallel, und ein Nettovermögen, das die Tilgung
       * überhaupt tragen kann. */
      const meineAnleihen = (st.bonds || []).filter(b => b.issuerId === myId);
      const meinRating = st.players[myId]?.rating || "BBB";
      /* Schwelle bewusst tief. Bei 1500 $ emittierte binnen Minuten FAST JEDER
       * Bot — sie pendeln ohnehin dauernd um diesen Wert. In der Messung lagen
       * dadurch fünf Anleihen gleichzeitig unverkauft am Markt, während der
       * reichste Bot nur 3568 $ hatte. Eine Anleihe soll die Ausnahme für einen
       * wirklich festgefahrenen Bot sein, nicht der Normalzustand. */
      /* Hürde war zuvor zusätzlich `meinNw > 4000`. Beides zusammen schliesst
       * sich in der Praxis aus: Bots mit Substanz geht das Bargeld nicht aus,
       * und dem einen, dem es ausging, fehlte genau diese Substanz. Ergebnis
       * einer vollen Runde über 78 Minuten: NULL Anleihen, das Feature löste
       * kein einziges Mal aus. Sicherheit sind jetzt die Gebäude selbst — sie
       * haften bei Zahlungsverzug ohnehin über das Pfandrecht. */
      if (me.cash < 1000 && built >= 2 && !meineAnleihen.length) {
        /* Zins nach eigener Bonität — schlechtere Schuldner müssen mehr bieten,
         * sonst zeichnet niemand. Der Satz gilt PRO MINUTE (Kupon je Sekunde =
         * principal * rate / 60), über 300 s Laufzeit sind das also das
         * Fünffache an Gesamtzins. */
        const zinsNachBonitaet = { AAA: 0.015, AA: 0.02, A: 0.025, BBB: 0.03, BB: 0.04, B: 0.05, CCC: 0.065, D: 0.08 };
        /* Bewusst klein gestückelt. Ein erster Anlauf mit bis zu 3000 $ ließ
         * drei Anleihen vier Minuten lang unverkauft liegen: Wer zeichnen
         * könnte, hat selten so viel entbehrliches Bargeld gleichzeitig. */
        /* Klein halten: Ein 1800-$-Papier verlangt vom Zeichner rund 2600 $
         * frei — so viel hat in dieser Wirtschaft selten jemand gleichzeitig.
         * 1200 $ sind aus einer Kasse von 2000 $ darstellbar. */
        /* Höhe an den Gebäuden bemessen statt am Nettovermögen: Der Wert der
         * Gebäude ist das, was im Ernstfall gepfändet wird, und er bleibt auch
         * dann stehen, wenn die Firma ihre Anteile abgegeben hat. */
        const gebaeudeWert = st.map.filter(t => t.owner === myId && t.btype)
          .reduce((a, t) => a + (BTYPES[t.btype]?.cost || 0), 0);
        const betrag = Math.min(1200, Math.round(gebaeudeWert * 0.15 / 100) * 100);
        if (betrag >= 500) {
          await em("issueBond", { principal: betrag, rate: zinsNachBonitaet[meinRating] ?? 0.04, term: 300 });
        }
      }
      /* ZEICHNEN: Wer Kapital übrig hat, legt es an, statt es liegen zu lassen.
       * Erst ab "Mittel" — dieselbe Grenze wie beim Aktienhandel. Nur solide
       * Schuldner und höchstens ein Drittel der eigenen Kasse je Anleihe,
       * damit ein Ausfall den Zeichner nicht mitreißt. */
      if (lvl.leveln) {
        /* Entbehrlich ist nur, was nach dem nächsten Gebäude übrig bleibt —
         * ist der Bauplan fertig, liegt die ganze Kasse ohnehin ungenutzt da.
         * Die vorherige feste Schwelle von 6000 $ hat nie gegriffen: Bots
         * emittieren erst, wenn sie klamm sind, und zu diesem Zeitpunkt lag in
         * der Messung KEIN Bot mehr darüber. Drei Anleihen blieben vier
         * Minuten unverkauft liegen, während die Emittenten weiter ausbluteten
         * (Stahlfaust 1246 -> 302 $). */
        const naechsteKosten = planFertig ? 0 : (BTYPES[gesamtplan[built % gesamtplan.length]]?.cost || 0);
        /* Ein dickes Polster darf auch dann gezeichnet werden, wenn noch ein
         * Gebäude aussteht — die Anleihe zahlt Nennbetrag und Zins binnen 300 s
         * zurück, der Bau verzögert sich also höchstens kurz. */
        /* Die Polstergrenze lag mit 4500 $ knapp über dem, was ein Bot in
         * dieser Wirtschaft je hält: In der Messung pendelte der reichste
         * (ChipWerke) bei 3700–4400 und zeichnete deshalb nie, während eine
         * Anleihe drei Minuten unverkauft lag. Die reguläre Rechnung greift
         * bei ihm ohnehin nicht, weil sein nächstes Gebäude mehr kostet als
         * seine gesamte Kasse. */
        const entbehrlich = Math.max(me.cash - naechsteKosten - 800, me.cash > 3000 ? me.cash - 2000 : 0);
        const solide = ["AAA", "AA", "A", "BBB"];
        const kandidat = (st.bonds || [])
          .filter(b => !b.holderId && b.issuerId !== myId
                    && solide.includes(b.issuerRating)
                    && b.principal <= entbehrlich && b.principal <= me.cash * 0.5)
          .sort((a, b) => b.rate - a.rate)[0];   // bester Zins zuerst
        if (kandidat) await em("buyBond", { bondId: kandidat.id });
      }
      if (Date.now() - lastBuild > lvl.bauPause && !planFertig) {
        const btid = gesamtplan[built % gesamtplan.length], bt = BTYPES[btid];
        const mats = matCost(bt);
        const missingMat = Object.entries(mats).find(([g, n]) => me.inv[g] < n);
        if (missingMat && !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === missingMat[0])) {
          /* fehlendes Baumaterial an der Börse nachfragen (etwas über Ø) */
          if (me.cash > 2000) await em("placeOrder", { side: "buy", good: missingMat[0],
            qty: Math.ceil(missingMat[1] - me.inv[missingMat[0]]) + 4,
            price: Math.round(st.avg[missingMat[0]] * (lvl.kaufAufschlag + 0.03) * 100) / 100 });
        } else if (!missingMat) {
          /* Stadtgebäude ausschliessen. Die Suche nimmt die ERSTE passende Kachel,
           * und Bank wie Nachrichtenzentrale sehen wie freie Zentrumsflächen aus:
           * kein Besitzer, keine Strasse, nicht gesperrt. Trifft ein Bot eine
           * davon zuerst, scheitert sein Bau in jedem Zyklus erneut an derselben
           * Kachel — er käme in der Zone nie voran. Bei der Bank lag das seit
           * jeher latent vor, mit der zweiten Stadtkachel wird es wahrscheinlicher. */
          const frei = t => t.zone === bt.zone && !t.road && !t.water && !t.park && !t.bank && !t.news;
          let t = st.map.find(t => frei(t) && !t.locked && !t.owner);
          if (!t) {   // Zone gesperrt → passende Kachel wird beim Bauen mit-freigeschaltet
            const lt = st.map.find(t => frei(t) && t.locked);
            if (lt && me.cash > bt.cost + lt.unlockCost + 800) t = lt;
          }
          /* Die Tilgungsreserve ist auch fürs Bauen tabu — sonst steht das
           * Geld am Stichtag im Gebäude statt in der Kasse. */
          const tilgungSperre = (st.bonds || []).find(b => b.issuerId === myId && b.holderId && b.termLeft < 90)?.principal || 0;
          if (t && me.cash > bt.cost + (t.locked ? t.unlockCost : 0) + 800 + tilgungSperre) {
            const r = await em("build", { x: t.x, y: t.y, btype: btid });
            if (r?.ok) lastBuild = Date.now();
          }
        }
      }
      /* Direktangebote (P2P-Verträge) prüfen: annehmen, wenn der Preis fair ist
       * (≤ 110 % Ø-Kurs) und genug Kapital da ist — sonst ablehnen, damit das
       * Angebot beim Anbieter nicht ewig offen hängen bleibt. */
      for (const c of st.contracts.filter(c => c.toId === myId)) {
        const fair = st.avg[c.good] ? c.price <= st.avg[c.good] * 1.1 : true;
        if (fair && me.cash >= c.qty * c.price) await em("acceptContract", { contractId: c.id });
        else await em("declineContract", { contractId: c.id });
      }
      /* Kaufanfragen auf die eigene Firma bewerten. Maßstab ist der eigene
       * Marktwert je 25 %-Block; je größer der abgegebene Anteil, desto höher
       * der verlangte Aufschlag — Kontrolle gibt niemand zum Nennwert her.
       * Klemmt es beim Kapital, wird auch zum fairen Preis verkauft. */
      for (const b of (st.shareBids || []).filter(b => b.companyId === myId)) {
        const block = st.players[myId]?.blockPrice || 0;
        const fair = block * b.count;
        const klamm = me.cash < 1500;
        const verlangt = fair * (klamm ? 1 : 1 + 0.08 * b.count);
        if (block > 0 && b.price >= verlangt) await em("acceptShareBid", { bidId: b.id });
        else await em("declineShareBid", { bidId: b.id });
      }
      /* VERALTETE EIGENE ORDERS ZURÜCKZIEHEN.
       * Der Bot legt nur dann eine neue Order an, wenn für die Ware noch keine
       * eigene offen ist. Wandert der Kurs danach weg, bleibt die alte für immer
       * im Buch stehen — und blockiert die Ware, weil ja "schon eine da ist".
       * Gemessen beim Öl: Ø-Kurs 6,47, eigenes Angebot noch bei 7,42 aus einer
       * Zeit mit Ø 7,57, daneben 37 Stück Nachfrage bei 6,62–6,64. Beide Seiten
       * waren da, trafen sich aber nie. Deshalb: was deutlich neben dem Markt
       * liegt, wird storniert. Das passiert bewusst GANZ AM ANFANG des Durchlaufs:
       * Stand es am Ende, sah der Bot beim Prüfen seines Bedarfs noch die alte
       * Order, übersprang sie deshalb, und die frische kam erst einen Takt
       * später — bei 26 Sekunden Takt driftete der Kurs derweil weiter davon. */
      for (const o of st.orders.filter(o => o.playerId === myId)) {
        const kurs = st.avg[o.good];
        if (!kurs) continue;
        /* Eng gefasst, weil die Bots selbst nur in einem schmalen Band handeln:
         * Sie bieten zu Ø×1,03 und stellen zu Ø×0,98–1,02 an. Eine Toleranz von
         * ±10 % war dadurch wirkungslos — gemessen lagen Angebot bei Ø×1,069 und
         * Gebot bei Ø×0,989, also 8 % auseinander und trotzdem beide "in Ordnung".
         * Sie standen sich gegenüber, ohne sich je zu treffen. */
        const daneben = o.side === "sell" ? o.price > kurs * 1.05 : o.price < kurs * 1.00;
        if (daneben) await em("cancelOrder", { orderId: o.id });
      }
      /* BEDARF DECKEN: stehende Kauforders für die Inputs der eigenen Industrie.
       * Auf "Schwer" kommen die Boost-Rohstoffe der eigenen Gebäude dazu — Strom
       * und Wasser im Lager steigern die Produktion um bis zu 150 %, das ist der
       * größte Hebel, den ein Bot ohne Sonderrechte ziehen kann. */
      const bedarf = new Set(cfg.needs);
      /* Boost-Rohstoffe nur mit Kapitalpolster kaufen — sonst geht das Geld für
       * Strom und Wasser drauf, das eigentlich das nächste Gebäude finanzieren
       * sollte, und der starke Bot fällt hinter den schwachen zurück. */
      if (lvl.boosten && me.cash > 6000) {
        for (const t of st.map) {
          if (t.owner !== myId || !t.btype) continue;
          for (const g of BTYPES[t.btype]?.boosts || []) bedarf.add(g);
        }
      }
      /* Einkaufsbudget statt Mindestkasse. Vorher stand hier die Bedingung
       * `me.cash > 1500` — eine harte Sperre, die einen Bot dauerhaft lahmlegen
       * konnte: Gemessen an Stahlfaust, der nach dem Bau seiner Waffenschmiede
       * bei 1356 $ landete. Damit kaufte er GAR NICHTS mehr, auch kein Erz und
       * kein Öl für ein paar Dollar. Ohne Zutaten stand die Produktion, ohne
       * Produktion kam kein Umsatz, und ohne Umsatz kam er nie wieder über die
       * 1500 — sein Bargeld stand über 8 Minuten unverändert auf 1356.
       * Zweiter Fehler am selben Ort: pauschal auf 25 Stück auffüllen. Bei
       * Stahl (~115 $) ist das eine Order über 2875 $ — mehr, als der Bot
       * überhaupt besitzt; die Order kam nie zustande oder hätte die Kasse in
       * einem Zug geleert. Jetzt wird ein Budget je Zyklus verteilt und die
       * Menge daran angepasst: teure Zutaten kommen eben in kleineren
       * Portionen, statt dass gar nicht gehandelt wird. Die Reserve stellt
       * sicher, dass weiter Geld fürs Bauen übrig bleibt. */
      /* Anteil bewusst niedrig: Ein erster Anlauf mit 70 % des Bargelds hat die
       * Falle zwar geöffnet, dafür aber das Sparen abgewürgt — Montan & Bau AG
       * verplante bei 2248 $ je Zyklus 1364 $ für Zutaten und wuchs damit nie an
       * sein Stahlwerk (6000 $) heran. Mit höchstens einem Drittel bleibt beides
       * möglich: laufender Nachschub UND Rücklage fürs nächste Gebäude. */
      /* Vor Fälligkeit einer eigenen Anleihe Geld zurücklegen. Ohne das rollt
       * die Schuld ewig weiter: Der Bot gibt sein Bargeld laufend für Zutaten
       * aus und hat zum Stichtag nie den Nennbetrag am Stück. Der Server setzt
       * dann termLeft zurück auf 30 s und vergibt fünf Strikes — die der
       * nächste bezahlte Kupon aber sofort wieder auf 0 setzt (siehe
       * b.strikes = 0 im Kuponzweig). Gemessen an Stahlfaust: dieselbe Anleihe
       * stand über drei Stichproben hinweg unverändert bei rest=24s, str=0,
       * ohne je getilgt zu werden — eine ewige Rente für den Zeichner und eine
       * Dauerlast für den Schuldner. */
      const faellig = (st.bonds || []).find(b => b.issuerId === myId && b.holderId && b.termLeft < 90);
      const tilgungsReserve = faellig ? faellig.principal : 0;
      let einkaufsbudget = Math.max(0, Math.min(me.cash - 300 - tilgungsReserve, me.cash * 0.35));
      for (const g of bedarf) {
        if (me.inv[g] >= 25) continue;
        if (st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === g)) continue;
        /* Aufschlag statt Abschlag. Vorher wurde mit (kaufAufschlag - 0.03)
         * geboten, also auf Stufe "Mittel" zu Ø × 0,97 — während Verkäufer zu
         * Ø × 1,02 anboten. Die beiden Seiten kreuzten sich nie: die Ziegelei
         * bekam kein Wasser, die Chipfabrik keinen Strom. Beide brauchen ihre
         * Zutat zwingend (die Produktion rechnet mit dem Minimum über alle
         * Inputs), also entstanden NULL Ziegel und NULL Elektronik, während
         * sich Erz und Silizium ungenutzt stapelten. Da jedes Gebäude Ziegel
         * kostet und jedes Upgrade Elektronik, konnte danach niemand mehr
         * bauen oder aufleveln. */
        const preis = Math.max(0.05, Math.round(st.avg[g] * (lvl.kaufAufschlag + 0.03) * 100) / 100);
        /* Bis zur eigenen Obergrenze auffüllen statt pauschal 10 Stück. Eine
         * Chipfabrik verbrennt 36 Strom/Minute; mit 10 Stück je Zyklus (Takt
         * 26 s) kamen höchstens 23 an — sie lief also selbst bei perfekt
         * gefüllten Orders dauerhaft am Limit und stand die meiste Zeit still. */
        const wunsch = Math.max(10, Math.ceil(25 - (me.inv[g] || 0)));
        const qty = Math.min(wunsch, Math.floor(einkaufsbudget / preis));
        if (qty < 1) continue;
        einkaufsbudget -= qty * preis;
        await em("placeOrder", { side: "buy", good: g, qty, price: preis });
      }
      /* Grundversorger-Bots: definierte Waren laufend abstoßen statt zu horten,
       * damit der Markt für diese Güter nie trockenläuft (unabhängig davon, wie
       * dick das Orderbuch schon ist — anders als die generische Regel unten). */
      for (const g of cfg.alwaysSell || []) {
        if (me.inv[g] < 2) continue;
        const menge = Math.floor(me.inv[g] * 0.8);
        const offen = st.orders.find(o => o.playerId === myId && o.side === "sell" && o.good === g);
        if (offen) {
          /* Eine offene Order blockierte bisher jedes weitere Angebot — auch wenn
           * der Bestand danach um ein Vielfaches gewachsen war. Gemessen bei den
           * Stadtwerken: 411 Strom auf Lager, davon 10 am Markt, während die
           * Touristik händeringend welchen suchte. Ist inzwischen deutlich mehr
           * da, wird die alte Order durch eine größere ersetzt. */
          if (menge < offen.qty * 2) continue;
          await em("cancelOrder", { orderId: offen.id });
        }
        await em("placeOrder", { side: "sell", good: g, qty: menge,
          price: Math.max(0.05, Math.round(st.avg[g] * lvl.verkaufKurs * 100) / 100) });
      }
      /* Werbung: sobald eine eigene Agentur steht und die Reichweite absackt,
       * eine Kampagne nachlegen — aber nur mit Kapitalpolster, damit das Budget
       * fürs nächste Gebäude nicht draufgeht. Ab Stufe "Mittel". */
      if (lvl.leveln && me.ad?.agenturen > 0 && me.ad.reach < 40 && me.cash > 6000) {
        await em("bookAd", { paket: me.cash > 15000 ? "gross" : "mittel" });
      }
      /* Elektronik kaufen (alle außer der Tech-Industrie selbst, die produziert
       * es ja schon) und eigene Produktionsgebäude damit auflevel, sobald genug
       * da ist — hält die Nachfrage nach Elektronik am Laufen. */
      if (lvl.leveln && cfg.industry !== "tech" && me.inv.elektronik < 10 && me.cash > 2000 &&
          !st.orders.some(o => o.playerId === myId && o.side === "buy" && o.good === "elektronik")) {
        await em("placeOrder", { side: "buy", good: "elektronik", qty: 5,
          price: Math.round(st.avg.elektronik * 1.03 * 100) / 100 });
      }
      /* Aufleveln erst, wenn die Branche vollständig abgedeckt ist. Der Grundsatz
       * "Abdeckung geht vor Dopplung" galt bisher nur fürs Bauen — Aufleveln lief
       * daneben ungebremst weiter und war meist billiger als das nächste fehlende
       * Gebäude. Gemessen an Montan & Bau AG über 24 Minuten: mine St.5,
       * ziegelei St.3, betonwerk St.1 — und KEIN Stahlwerk, obwohl es das vierte
       * Produkt der Branche ist. Im ganzen Spiel gab es damit null Stahl bei
       * einer Nachfrage von 22 Stück. Eine Firma, die ihre Mine zum fünften Mal
       * ausbaut, während ihr Kernprodukt fehlt, wirtschaftet nicht plausibel. */
      const abdeckung = INDUSTRY_COVERAGE[cfg.industry] || [];
      const abdeckungFertig = cfg.planLoop || built >= abdeckung.length;
      const upgradable = lvl.leveln && abdeckungFertig && st.map.find(t => t.owner === myId && t.btype &&
        (BTYPES[t.btype].out || BTYPES[t.btype].proc) && (t.level || 1) < 5);
      if (upgradable) {
        const ubt = BTYPES[upgradable.btype], ulvl = upgradable.level || 1;
        const ec = Math.ceil(ubt.cost / 2500 * ulvl), cc = Math.round(ubt.cost * 0.35 * ulvl);
        if (me.inv.elektronik >= ec && me.cash > cc + 1000) {
          await em("upgradeBuilding", { x: upgradable.x, y: upgradable.y });
        }
      }
      /* ZUERST ECHTE NACHFRAGE BEDIENEN.
       * Die generische Regel darunter verlangt 18 Stück auf Lager. Verarbeitete
       * Waren erreichen diese Schwelle nie: Der Bot verbaut seine Ziegel selbst
       * und verbraucht seine Elektronik fürs Aufleveln, er pendelt also dauerhaft
       * darunter. Das Ergebnis war ein Markt, auf dem Ziegel und Elektronik
       * ständig nachgefragt, aber nie angeboten wurden — und in dem niemand mehr
       * bauen oder aufleveln konnte, sobald das Startmaterial aufgebraucht war.
       * Liegt ein fremdes Kaufgebot vor und ist mehr als die eigene Reserve da,
       * wird jetzt verkauft: höchstes Gebot zuerst. */
      /* Reserve gestaffelt: Von Baumaterial bleibt genug für das nächste eigene
       * Gebäude liegen (sonst verkauft der Bot seine Ziegel und muss sie gleich
       * darauf teurer zurückkaufen), von allem anderen nur ein kleiner Rest.
       * Elektronik pendelte in der Messung um 9 Stück — mit einer pauschalen
       * Reserve von 6 wären davon nur 3 je Zyklus in den Markt gegangen, zu
       * wenig, um die Nachfrage je einzuholen. */
      const reserveFuer = g => (g === "ziegel" || g === "beton") ? 12 : 3;
      const gesucht = st.orders
        .filter(o => o.side === "buy" && o.playerId !== myId &&
                     (me.inv[o.good] || 0) > reserveFuer(o.good) + 1)
        .sort((a, b) => b.price - a.price)[0];
      if (gesucht) {
        const menge = Math.min(gesucht.qty, Math.floor((me.inv[gesucht.good] || 0) - reserveFuer(gesucht.good)));
        if (menge >= 1) await em("takeOrder", { orderId: gesucht.id, qty: menge });
      }
      /* BÖRSE BEFÜLLEN ohne Überschuss: nur wenn das Buch dünn ist */
      for (const g of Object.keys(me.inv)) {
        if (me.inv[g] < 18) continue;
        const bookQty = st.orders.filter(o => o.side === "sell" && o.good === g).reduce((s, o) => s + o.qty, 0);
        if (bookQty >= 15) continue;   // Spieler-Angebot hat Vorrang
        if (st.orders.some(o => o.playerId === myId && o.side === "sell" && o.good === g)) continue;
        await em("placeOrder", { side: "sell", good: g, qty: Math.min(10, Math.floor(me.inv[g] - 8)),
          price: Math.round(st.avg[g] * (lvl.verkaufKurs + 0.04) * 100) / 100 });
        break;
      }
    } catch {} finally { laeuft = false; }
  }, lvl.takt + Math.random() * 8000);
  botHandles.push({ socket: s, timer });
}

/* Letztes Sicherheitsnetz: Server bleibt auch bei einem übersehenen Bug am Leben
 * (sonst beendet Node den Prozess standardmäßig bei jeder unabgefangenen Exception). */
process.on("uncaughtException", e => console.error("Unerwarteter Fehler (Server läuft weiter):", e));
process.on("unhandledRejection", e => console.error("Unerwarteter Promise-Fehler (Server läuft weiter):", e));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`Capital Sandbox Server → http://localhost:${PORT}`);
  for (const u of lanUrls(PORT)) console.log(`  Einladungslink (LAN): ${u}`);
  /* Früher spannte "--share" hier einen localtunnel auf. Das Paket ist raus:
   * es schleppte zwei hochbewertete Sicherheitslücken (axios) mit und wurde
   * überflüssig, seit es eine eigene öffentliche Adresse gibt. */
  if (process.argv.includes("--share")) {
    console.log("  Hinweis: --share gibt es nicht mehr. Für öffentliche Runden das Gateway");
    console.log("  hinter der eigenen Domain betreiben (npm run gateway), im Heimnetz genügt der LAN-Link.");
  }
});
