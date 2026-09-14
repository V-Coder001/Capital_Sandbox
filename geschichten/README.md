# Geschichten

Kleine private Seite: du nimmst eine Hörgeschichte auf (oder lädst eine fertige
Datei hoch), deine Freundin ruft die Seite auf und hört sie sich an. Kein
WhatsApp mehr.

Läuft auf Netlify — Seite, Function und Speicher, alles dort, kein zweiter
Dienst nötig.

## Seiten

- `/` — alle Geschichten mit Player. Neue tragen ein „neu"-Abzeichen, das
  verschwindet, sobald sie abgespielt wurden (pro Gerät gemerkt).
- `/aufnehmen` — direkt im Browser über das Mikrofon aufnehmen oder eine Datei
  wählen, Titel und Notiz dazu, hochladen. Darunter die Liste des bereits
  Hochgeladenen zum Löschen.

## Auf Netlify stellen

1. Im Netlify-Dashboard eine neue Site aus diesem GitHub-Repo anlegen.
2. Unter *Site configuration → Build & deploy → Build settings* als
   **Base directory** `geschichten` eintragen. Den Rest liest Netlify aus
   `netlify.toml` (Publish `public`, Functions `netlify/functions`).
3. Deploy starten. Netlify Blobs ist ohne Einrichtung dabei.

Lokal ausprobieren geht mit `npx netlify dev` in diesem Ordner — das startet
Seite und Function zusammen samt nachgebautem Blob-Speicher.

## Kein Passwort

Die Seite ist offen: wer die Adresse hat, hört alles und kann hochladen. Das
war so gewollt. Zwei Dinge dazu, die du wissen solltest:

- Die Adresse ist damit das einzige Geheimnis. Sie steht in deiner Netlify-
  Übersicht und in der Browser-Historie von euch beiden — gib sie nicht
  weiter und häng sie nirgends öffentlich hin.
- Suchmaschinen halte ich mit `noindex` und `robots.txt` fern. Das hilft gegen
  zufällige Funde, ist aber kein Schutz gegen jemanden, der die Adresse kennt.

Wenn dir das später zu offen wird, ist ein Passwort schnell nachgerüstet —
sag Bescheid.

## Wie die großen Dateien durchkommen

Netlify-Functions dürfen pro Aufruf nur rund 6 MB annehmen oder zurückgeben,
eine Geschichte ist schnell größer. Deshalb schneidet der Browser die Aufnahme
beim Hochladen in 3-MB-Häppchen, und beim Abspielen setzt die Function genau
den Bereich zusammen, den der Player gerade anfragt (Range-Requests). Für dich
und sie ist davon nichts zu merken — Spulen funktioniert normal.

Eine Geschichte taucht in der Liste erst auf, wenn alle Häppchen angekommen
sind. Bricht ein Upload ab, ist nichts halb veröffentlicht; einfach nochmal.

Obergrenze pro Geschichte: 500 MB. Das sind grob 15 Stunden Sprachaufnahme.
