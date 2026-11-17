# Markt-API für die Daytrading-App

Ein read-only Endpunkt am Spiel, der die Marktdaten und Firmenwerte der
laufenden Runde als JSON ausgibt. Die Daytrading-App ruft ihn ab und handelt
nicht im Spiel selbst. Sie beobachtet nur.

## Endpunkt

| Betrieb | URL |
| --- | --- |
| Einzelrunde (`npm start`) | `http://localhost:3000/api/markt` |
| Gateway (mehrere Runden) | `/r/<CODE>/api/markt` |

Die Antwort enthält vier Blöcke:

- **runde**: Seed, Modus, Spielminute (`minute`), Gewinnziel und Panik-Tag.
- **waren**: je Ware `preis` (aktueller Kurs), `anker`, `grundpreis` und `band`.
- **firmen**: je Firma `kurs`, `firmenwert` (Kurs × Aktien), `substanz`
  (Buchwert) und `fundament`.
- **ereignisse**: die letzten 20 Einträge aus dem Marktlog (Flauten, Panik).
- **verlauf**: alle 10 Sekunden ein Punkt, also sechs je Markttag (60 Sekunden),
  mit Warenpreisen und Kursen je Firma. Gespeichert werden die letzten 1440 Punkte. Mit `?seit=<tick>` gibt es nur neuere Punkte.

## Jede Runde ist anders

Beim Start einer Runde wird ein Zufalls-Seed gezogen (`runde.seed`). Daraus
kommt ein kleiner, reproduzierbarer Zufallsgenerator (mulberry32). Er steuert
die rundenweiten Zufälle, zum Beispiel den Zeitpunkt des Panikschocks.
Die Kursschwankungen im Takt laufen weiter über den normalen Zufall. Der
Seed macht also die Rundenereignisse nachvollziehbar, nicht den gesamten Verlauf.

## Abgrenzung

- Nur GET. Die API verändert keinen Spielzustand.
- Die Daytrading-App ist ein eigenes Projekt und nicht Teil dieses Repos.
