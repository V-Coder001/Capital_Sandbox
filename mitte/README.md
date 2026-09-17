# Mitte

Eine ruhige Tracking-App für Menschen mit wiederkehrenden Bauchschmerzen.
Kein Diagnose-Tool, sondern ein **Tagebuch mit Mustern**: wo und wie stark es wehtut,
was gegessen und getrunken wurde – und was nach einer Woche auffällt.

Ein Eintrag dauert unter 30 Sekunden. Sonntags gibt es ein klares Bild.

> Mitte ist ein Tagebuch zur Selbstbeobachtung und ersetzt keine ärztliche Beratung.
> Die App stellt keine Diagnosen und empfiehlt keine Behandlungen.

## Loslegen

```bash
npm install
npm start          # Expo Dev Server, QR-Code mit Expo Go scannen
npm run android    # oder ios / web
npm test           # Logik-Tests (Node, kein Gerät nötig)
npm run typecheck
```

## Was drin ist

| Bereich | Stand |
|---|---|
| Schnell-Eintrag (Bauchkarte, Art, VAS, Dauer, Notiz) | fertig |
| Essen & Trinken mit Wasser-Zähler und eigenen Kacheln | fertig |
| Tages-Empfehlungen aus Regeln, abhakbar | fertig |
| Home mit Tagesring, 7-Tage-Linie, Wochen-Heatmap | fertig |
| Verlauf mit Filter, Eintrag bearbeiten und löschen | fertig |
| Wochenzusammenfassung inkl. Korrelationen | fertig |
| Erinnerungen (täglich + sonntags) | fertig |
| PDF-Export für den Arzttermin | fertig |
| Auslöser-Tags, Bristol-Skala, Eliminationsexperimente | offen (V2) |
| Apple Health / Google Fit, Widgets, Watch | offen (V2) |

## Aufbau

```
app/                 Screens (expo-router)
  (tabs)/            Heute · Verlauf · Woche · Profil
  eintrag.tsx        Schnell-Eintrag (Modal)
  eintrag/[id].tsx   Eintrag bearbeiten
  essen.tsx          Essen & Trinken (Modal)
  onboarding.tsx     3 Seiten inkl. Einwilligung
components/          BellyMap, VasSlider, Charts, UI-Bausteine
src/
  analysis.ts        reine Auswertung (Korrelationen, Wochenkennzahlen)
  rules.ts           Regel-Engine, wertet rules.json aus
  rules.json         die Empfehlungsregeln – erweiterbar ohne App-Update
  recommendations.ts verbindet Regeln mit der Datenbank
  stats.ts           lädt Tage aus der DB und baut die Wochenübersicht
  db.ts              SQLite (expo-sqlite), rein lokal
  pdf.ts             Wochen-PDF
  notifications.ts   geplante lokale Benachrichtigungen
  theme.ts           Farben, Radien, VAS-Farbverlauf
tests/logic.test.js  Tests der reinen Logik
```

Die Trennung ist bewusst: `analysis.ts`, `rules.ts` und `dates.ts` kennen weder
Datenbank noch Expo und laufen darum in Node – dort liegt die Logik, die falsch
sein könnte, ohne dass man ein Gerät braucht.

## Empfehlungsregeln erweitern

`src/rules.json` ist Daten, kein Code. Eine Regel besteht aus `id`, `priority`,
einer Bedingung und dem Text:

```json
{
  "id": "carbonated_today",
  "priority": 35,
  "when": { "all": [
    { "fact": "drinksToday", "includes": "carbonated" },
    { "fact": "typesToday", "includes": "bloating" }
  ]},
  "text": "Kohlensäure und Völlegefühl gehen oft zusammen – probier heute stilles Wasser."
}
```

Operatoren: `lt`, `lte`, `gt`, `gte`, `eq`, `includes`, `isTrue`. Ein Schwellwert darf
statt einer Zahl auch der Name eines anderen Facts sein (`"gt": "avgVasYesterday"`).
Pro Tag werden die drei Regeln mit der höchsten Priorität gezeigt.

Verfügbare Facts stehen in `src/rules.ts` (`type Facts`).

## Sicherheitsnetz

Ab einem Wert von 9,0 oder bei Stichwörtern wie „Blut", „Fieber", „Erbrechen" in der
Notiz erscheint beim Speichern ein ruhiger Hinweis, ärztlich abzuklären. Er lässt sich
nicht wegwischen, nur bestätigen. Schwelle und Stichwörter stehen in `rules.json`.

## Datenschutz

Alle Daten liegen ausschließlich lokal in SQLite auf dem Gerät. Kein Konto, kein Server,
keine Analyse-SDKs. Die Einwilligung wird im Onboarding eingeholt, das vollständige
Löschen liegt im Profil.

## Zurückhaltung bei Aussagen

Korrelationen werden erst gezeigt, wenn je Gruppe mindestens 3 Tage vorliegen und der
Unterschied mindestens 1,5 Punkte beträgt (`MIN_DAYS_PER_GROUP`, `MIN_DELTA` in
`src/analysis.ts`). Formuliert wird immer als „fällt auf", nie als „verursacht".

## Bekannte Baustellen

- Keine App-Icons und kein Splash-Screen – Expo-Defaults.
- Die Bauchkarte ist ein 3×3-Raster, noch keine Illustration.
- Auf einem echten Gerät ist die App noch nicht gelaufen; geprüft sind Typecheck,
  Logik-Tests und ein vollständiger Metro-Bundle-Durchlauf.
