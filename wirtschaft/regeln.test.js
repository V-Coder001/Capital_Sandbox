/* Abnahmetests aus Abschnitt 16 (die ohne volle Simulation prüfbar sind). */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "./regeln.js";
import { KONFIG as K } from "./konfiguration.js";

const nah = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test("Steuerbeispiel (Abschnitt 7): 212 $ Stadt, 96 $ Anleger, 192 $ Firma", () => {
  const { ust, erloes } = R.umsatzAufteilen(1100);
  nah(ust, 100, 1e-9); nah(erloes, 1000, 1e-9);
  const gew = erloes - 600;                       // 400
  const gs = R.gewinnSteuer(gew, 0);
  nah(gs.steuer, 80, 1e-9);
  const nach = gew - gs.steuer;                   // 320
  const div = R.ausschuettung(nach, 1e9);
  nah(div.brutto, 128, 1e-9); nah(div.kest, 32, 1e-9); nah(div.netto, 96, 1e-9);
  const stadt = ust + gs.steuer + div.kest;
  nah(stadt, 212, 1e-9);
  nah(nach - div.brutto, 192, 1e-9);
});

test("Firmenwert (Abschnitt 6): 21.111 $ und 211 $ je Aktie bei 100 Anteilen", () => {
  const f = R.fairerWert(10000, 1000, 0.04);
  nah(f, 21111, 1);
  nah(f / 100, 211, 0.2);
});

test("Verlust: keine Gewinnsteuer, keine Dividende, Verlust mindert spätere Steuer", () => {
  const v = R.gewinnSteuer(-300, 0);
  assert.equal(v.steuer, 0);
  assert.equal(v.verlustVortrag, 300);
  assert.equal(R.ausschuettung(-300, 1000).brutto, 0);
  const spaeter = R.gewinnSteuer(500, v.verlustVortrag);   // 500 − 300 = 200 steuerpflichtig
  nah(spaeter.steuer, 40, 1e-9);
  assert.equal(spaeter.verlustVortrag, 0);
});

test("Preis: leeres Lager +5 %/Tag, doppeltes Ziel −5 %/Tag, Untergrenze nie unterschritten", () => {
  nah(R.preisNeu(100, 0, 10, 0), 105, 1e-9);
  nah(R.preisNeu(100, 20, 10, 0), 95, 1e-9);
  let p = 100;
  for (let t = 0; t < 500; t++) p = R.preisNeu(p, 1000, 10, 60);   // Stückkosten 60 → Untergrenze 48
  assert.ok(p >= 0.8 * 60 - 1e-9);
  assert.equal(p, 0.8 * 60);
});

test("Leitzins: 3 % Inflation bleibt bei 4 %; 7 % Inflation steigt in 0,5-Schritten auf 10 %", () => {
  assert.equal(R.zielzins(0.03), 0.04);
  let l = 0.04; const schritte = [];
  for (let t = 0; t < 30; t++) { l = R.leitzinsSchritt(l, R.zielzins(0.07)); schritte.push(l); }
  nah(schritte[0], 0.045, 1e-12);
  assert.equal(l, 0.10);
  for (let i = 1; i < schritte.length; i++) assert.ok(schritte[i] - schritte[i - 1] <= 0.005 + 1e-12);
});

test("Kurs: ohne Orders nähert er sich dem fairen Wert; +6 Orders pendeln bei rund 43 % darüber", () => {
  let k = 50; const f = 100;
  for (let t = 0; t < 200; t++) k = R.kursNeu(k, f, 0, 100);
  nah(k, 100, 0.01);
  let k2 = 100;
  for (let t = 0; t < 500; t++) k2 = R.kursNeu(k2, 100, 6, 100);
  nah(k2 / 100, 1.4286, 0.005);     // K = 1,4286 · F
});

test("Übernahme: 30 % lösen das Pflichtangebot aus; Stufen korrekt", () => {
  assert.ok(R.stimmrechtsStufen(0.30).includes("Pflichtangebot"));
  assert.ok(!R.stimmrechtsStufen(0.20).includes("Pflichtangebot"));
  assert.ok(R.stimmrechtsStufen(0.75).includes("Fusion"));
  assert.equal(R.pflichtangebotPreis([10, 30, 20]), 30);
  assert.ok(R.fondsNimmtAn(115, 100));
  assert.ok(!R.fondsNimmtAn(114, 100));
});

test("Fusion (Abschnitt 11): Ziel 20.000 / Käufer 60.000 → 1 neue Aktie für 3 alte; Kartellamt über 60 %", () => {
  nah(R.fusionsVerhaeltnis(20000, 60000), 1 / 3, 1e-12);
  assert.ok(R.kartellErlaubt(0.60));
  assert.ok(!R.kartellErlaubt(0.61));
});

test("Geld-Erhaltung: zahle() verschiebt nur, lehnt ohne Deckung ab; Check hält", () => {
  const konten = new Map([["spieler", 100], ["stadt", 0]]);
  const buch = [];
  assert.equal(R.zahle(konten, buch, "spieler", "stadt", 40, "Steuer").ok, true);
  assert.equal(R.zahle(konten, buch, "spieler", "stadt", 500, "zu viel").ok, false);
  assert.equal(R.geldsummenCheck(konten, 100, 0).ok, true);
});

test("Sparquote und Bürgerdepot folgen dem Leitzins", () => {
  nah(R.sparquote(0.04), 0.30, 1e-12);
  nah(R.sparquote(0.10), 0.36, 1e-12);
  nah(R.sparquote(0.20), 0.40, 1e-12);
  nah(R.sparquote(0.01), 0.27, 1e-12);
  const d = R.buergerdepotVerteilung(0.04);
  nah(d.fonds, 0.60, 1e-12); nah(d.anleihen, 0.20, 1e-12); nah(d.sparkonto, 0.20, 1e-12);
  nah(R.buergerdepotVerteilung(0.05).fonds, 0.55, 1e-12);
  assert.equal(K.zeit.periodeTage, 10);
});
