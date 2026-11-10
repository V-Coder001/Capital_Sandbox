/* Abnahmetests aus Abschnitt 16, die die ganze Simulation ohne Oberfläche brauchen. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { neueSimulation, laufe, markttag, insolvenz, fusioniere, stimmanteil } from "./simulation.js";
import { KONFIG as K } from "./konfiguration.js";

test("Geldsumme: 500 Markttage mit 4 automatischen Firmen, kein einziger Fehltag", () => {
  for (const seed of [1, 2, 3]) {
    const S = laufe(neueSimulation({ firmen: 4, seed }), 500);
    assert.equal(S.fehler.length, 0, `Seed ${seed}: ${JSON.stringify(S.fehler[0])}`);
    assert.equal(S.tag, 500);
  }
});

test("Insolvenz: überschuldete Firma wird nach 3 Tagen abgewickelt, Geldsumme stimmt danach", () => {
  const S = laufe(neueSimulation({ seed: 7 }), 30);
  const f = S.firmen[0];
  /* Überschulden: Kredit bis zum Limit, dann das ganze Geld als Sonderzahlung an die Haushalte. */
  f.eigenkapital = 1e9; S.konten.set(f.id, S.konten.get(f.id) + 0);   // Limit kurz öffnen
  const limit = 200000; S.konten.set(f.id, S.konten.get(f.id) + limit); f.kredit += limit; S.offeneKredite += limit;
  const alles = S.konten.get(f.id);
  S.konten.set(f.id, 0); S.konten.set("haushalte", S.konten.get("haushalte") + alles);
  f.eigenkapital = 0; f.keinAusbau = true;
  const start = S.tag;
  for (let i = 0; i < 6 && !f.insolvent; i++) markttag(S);
  assert.ok(f.insolvent, "Firma ist insolvent");
  const tagInsolvenz = S.log.find(l => l.art === "insolvenz" && l.firma === f.id).tag;
  assert.equal(tagInsolvenz - start, K.bank.insolvenzTage);
  assert.equal(f.kredit, 0, "Kredit getilgt oder abgeschrieben");
  assert.equal(f.anteileGesamt, 0, "Aktien verfallen");
  laufe(S, 20);
  assert.equal(S.fehler.length, 0);
});

test("Stabilität: Inflation je Periode zwischen −5 % und +15 % nach der Anlaufphase, Stadt nie über 30 Tage am Deckel", () => {
  for (const seed of [1, 2, 3, 4]) {
    const S = laufe(neueSimulation({ seed }), 500);
    const nachAnlauf = S.inflationPerioden.slice(8);   // Anlaufphase: die ersten 80 Markttage
    for (const i of nachAnlauf) assert.ok(i >= -0.05 && i <= 0.15, `Seed ${seed}: Inflation ${(i * 100).toFixed(1)} %`);
    assert.ok(S.stadt.maxTageAmDeckel <= 30, `Seed ${seed}: ${S.stadt.maxTageAmDeckel} Tage am Schuldendeckel`);
  }
});

test("Übernahme: 75 % und unter 60 % Marktanteil → Fusion gelingt, über 60 % abgelehnt", () => {
  const mach = () => {
    const S = laufe(neueSimulation({ seed: 3 }), 40);
    const [a, b] = S.firmen;
    /* Käufer (Spieler von a) übernimmt 75 % der Anteile von b. */
    const ges = b.anteileGesamt;
    b.anteile = { [a.spieler]: Math.ceil(ges * 0.75), [b.spieler]: ges - Math.ceil(ges * 0.75) };
    return { S, a, b };
  };
  let { S, a, b } = mach();
  assert.ok(stimmanteil(b, a.spieler) >= 0.75);
  const vorher = S.konten.get(a.id) + S.konten.get(b.id);
  const ok = fusioniere(S, a, b, { marktanteil: 0.5 });
  assert.equal(ok.ok, true);
  assert.ok(b.fusioniert && b.gebaeude.length === 0 && a.gebaeude.length >= 4);
  assert.ok(Math.abs(S.konten.get(a.id) + S.konten.get(b.id) - vorher) < 1000);   // Bruchteile bar an Restaktionäre
  markttag(S); assert.equal(S.fehler.length, 0);
  ({ S, a, b } = mach());
  const nein = fusioniere(S, a, b, { marktanteil: 0.61 });
  assert.equal(nein.ok, false);
  assert.match(nein.grund, /Kartellamt/);
  b.anteile = { [a.spieler]: 70, [b.spieler]: 30 }; b.anteileGesamt = 100;
  assert.equal(fusioniere(S, a, b, { marktanteil: 0.3 }).ok, false);   // unter 75 %
});
