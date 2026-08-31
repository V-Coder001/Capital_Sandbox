# Capital Sandbox veröffentlichen — wie Website und Spiel zusammenspielen

## Die Architektur in einem Satz

Capital Sandbox ist **Client + Server**: Der Browser lädt die Spieloberfläche
(`public/index.html`) und redet dann per Socket.io **live mit einem
Node-Server**, der die einzige Wahrheit über die Runde hält (Karte, Börse,
Rennen). Ohne laufenden Server gibt es kein Spiel — nur eine tote Seite.

## Was das für itch.io bedeutet

itch.io hostet bei "HTML-Spielen" **nur statische Dateien** — es kann keinen
Node-Prozess für uns betreiben. Es gibt deshalb zwei gangbare Wege:

### Weg A (empfohlen): eigener Server + itch als Schaufenster

1. Das **Gateway** (`node gateway.js`) läuft dauerhaft auf einem eigenen
   Server hinter einer Domain (z. B. play.capitalsandbox.io) — es startet für
   jede Runde einen eigenen server.js-Prozess, vergibt Runden-Codes und räumt
   verwaiste Runden nach 20 min Leerlauf ab. Hoster: jeder Node-fähige Dienst
   (Hetzner-VM, Railway, Fly.io; bei Render die bekannten Fallstricke
   beachten). Wichtig: WebSocket-Unterstützung und genug RAM — jede Runde ist
   ein eigener Prozess (~60–100 MB), MAX_ROOMS entsprechend setzen.
2. Auf itch.io wird das Spiel als Seite mit **Button/Link zur eigenen Domain**
   eingestellt ("This game is played in the browser on our site") oder als
   itch-"HTML-Spiel", das nur eine kleine Weiterleitungsseite enthält.
3. Vorteil: itch und Spiel müssen **gar nicht miteinander kommunizieren** —
   itch ist reine Werbung, alles Spielrelevante läuft über die eigene Domain.
   Updates gehen live, ohne dass man bei itch neu hochladen muss.

### Weg B: Client auf itch, Server bei uns (mehr Aufwand)

Man KÖNNTE den reinen Client als ZIP bei itch hochladen und ihn sich zu
unserem Gateway verbinden lassen. Dafür müsste der Client eine konfigurierbare
Server-Adresse bekommen (heute verbindet er sich immer zu seiner eigenen
Herkunft), und der Server bräuchte CORS-Freigaben plus HTTPS/WSS — itch bettet
Spiele in einen HTTPS-iframe ein, unverschlüsselte WebSockets sind dort
blockiert. Machbar, aber Weg A liefert dasselbe Ergebnis ohne diesen Umbau.

### Und die heruntergeladene Datei?

Wer sich das Repo/ZIP herunterlädt, spielt **lokal**: `sh start.sh` startet
den eigenen Server auf dem eigenen Rechner, Mitspieler kommen übers gleiche
WLAN (LAN-Link) oder per Online-Code (WebRTC über den PeerJS-Vermittler).
Diese lokale Variante und der öffentliche Gateway-Server sind unabhängig —
beide nutzen denselben Code, teilen aber keine Runden und keine Bestenliste.

## Checkliste bis zum itch-Launch

- [x] Gateway mit Mehrrunden-Betrieb, Runden-Codes, Leerlauf-Aufräumen, Adminpanel
- [x] Englische Fassung: Startbildschirm, Anleitung, Motorsport-/Renn-UI
- [x] Impressum + Datenschutz aktuell (Bestenliste, Bugreports)
- [x] Marketing-Texte (itch-seite.md), Screenshots, Trailer-GIF (marketing/)
- [ ] Domain + Hosting für das Gateway einrichten (Betreiber-Entscheidung)
- [ ] itch-Seite anlegen, Texte/Screenshots einpflegen, auf die Domain verlinken
- [ ] Einen öffentlichen Probelauf mit ein paar Runden machen (MAX_ROOMS testen)
