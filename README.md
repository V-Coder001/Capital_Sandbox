# Capital Sandbox — Localhost-Multiplayer

Isometrische Wirtschaftssimulation als reines Spieler-Ökosystem: keine NPCs,
keine künstlichen Preise. Server = Single Source of Truth.

## Setup (Host)

Ein Befehl — findet/lädt Node automatisch, installiert Abhängigkeiten,
räumt alte Server weg, startet und öffnet den Browser:

```bash
./start.sh
```

Variante: `BOT=0 ./start.sh` (ohne KI-Mitspieler).

Alternativ klassisch (Node ≥ 18 vorausgesetzt, `brew install node`):

```bash
npm install
npm start
```

Danach im Browser: `http://localhost:3000`.

**Mitspieler einladen:** Der Join-Screen zeigt einen kopierbaren Einladungslink
(die LAN-Adresse des Hosts, funktioniert für alle im selben WLAN). Wer von
außerhalb mitspielen soll, verbindet sich über eine öffentlich erreichbare
Instanz — siehe Gateway-Modus weiter unten.

Das frühere `npm run share` gibt es nicht mehr: Es hing an `localtunnel`, das
zwei hochbewertete Sicherheitslücken mitbrachte und seit dem Gateway hinter
einer eigenen Domain überflüssig ist.

## Mehrere gleichzeitige Runden (Gateway-Modus, für einen echten Server)

`server.js` selbst kann pro Prozess immer nur EINE Runde halten — sein
kompletter Zustand (Karte, Firmen, Börse, Bots) liegt in modulweiten
Variablen. Für `./start.sh`/`npm start` ist das genau richtig (eine Gruppe,
ein Rechner, eine Runde). Soll dasselbe Deployment mehreren Gruppen
GLEICHZEITIG unabhängige Runden anbieten (z. B. auf einem gemieteten Server),
gibt es dafür `gateway.js` als Alternative zu `server.js`:

```bash
npm run gateway
```

Jeder Klick auf „Neue Runde starten" lässt das Gateway einen frischen,
komplett isolierten `server.js`-Kindprozess auf einem internen Port
hochfahren und vergibt einen 5-stelligen Code. Mitspieler geben diesen Code
unter „Einer Runde beitreten" ein (oder öffnen einen Link mit `?code=…`) und
werden transparent — inklusive WebSocket — zur richtigen Runde durchgereicht.
Eine Runde wird beendet, sobald `ROOM_IDLE_MIN` Minuten lang niemand mehr
verbunden war. Der Sieg selbst beendet den Prozess nicht — die Abschlusstafel
bleibt stehen, bis der letzte Spieler gegangen ist.

`server.js` selbst bleibt dabei unverändert — die Isolation kommt allein
daher, dass jede Runde ein eigener echter Betriebssystemprozess ist, kein
gemeinsam genutzter In-Memory-Zustand. `public/index.html` erkennt beim Laden
selbst, ob es hinter `server.js` (Einzelrunde, WebRTC-Beitritt) oder
`gateway.js` (mehrere Runden) läuft, und passt Join-Screen und
Verbindungsaufbau entsprechend an.

Umgebungsvariablen: `PORT` (öffentlicher Port), `MAX_ROOMS` (Höchstzahl
gleichzeitiger Runden, Standard 20), `ROOM_IDLE_MIN` (Leerlauf-Grenze in
Minuten, Standard 20).

## Desktop-App (Download-Fassung)

Dieselbe Idee wie im Gateway: `server.js` bleibt unverändert und bekommt einen
eigenen Node-Prozess — nur startet den hier nicht ein Server für fremde
Gruppen, sondern eine Electron-Hülle auf dem Rechner des Spielers, auf einem
freien Port, der nur auf `127.0.0.1` hört. Kein Internet nötig, kein Cold
Start, keine Paketgrößen-Grenze der Portale.

```bash
npm install          # einmalig, holt auch Electron
npm run desktop      # App zum Entwickeln starten
npm run desktop:dir  # ungepackter Probebau in dist/desktop/
npm run desktop:build # .dmg / .exe / AppImage in dist/desktop/
```

```
desktop/
├── main.js      Hülle: freien Port suchen, server.js als Kindprozess starten,
│                 warten bis er antwortet, Fenster darauf laden. Fenstergröße,
│                 Menü, externe Links in den Systembrowser.
└── preload.cjs  Die einzige Brücke ins Spiel: window.CS_DESKTOP
                  (Version, Plattform, Adresse für spätere Online-Runden).
```

Zwei Dinge, die das möglich machen:

- `ELECTRON_RUN_AS_NODE=1` beim `spawn` — `process.execPath` ist die
  Electron-Binary; ohne die Variable öffnete sie ein zweites Fenster, statt
  `server.js` als reines Node-Programm auszuführen.
- `CS_DATEN` — im App-Paket ist `__dirname` nur lesbar. Die Hülle gibt
  deshalb den Benutzerordner vor, in dem `bugreports/` und `leaderboard.json`
  landen (`~/Library/Application Support/Capital Sandbox` bzw. `%APPDATA%`).

Noch offen: ein App-Icon unter `desktop/build/icon.png` (1024×1024) — ohne das
bauen die Pakete mit dem Standard-Electron-Icon. Und die Builds sind
unsigniert: macOS meldet beim ersten Start „nicht verifizierter Entwickler"
(Rechtsklick → Öffnen), Windows zeigt den SmartScreen-Hinweis.

## Architektur

```
game/
├── server.js          Autoritativer Game-Server (Node + Socket.io, Port 3000)
│                       · Registrierung, Map-Belegung, Produktion (1s-Tick)
│                       · Orderbuch-Matching-Engine (Preis-Zeit-Priorität, Escrow)
│                       · P2P-Anleihen, dynamische Ratings, Pfändung + Auktion
│                       · Chat-Broadcast, Direktverträge
│                       · Push: voller Stand nur beim Verbinden, danach nur
│                         geänderte Felder (teil: true), Client führt zusammen
├── statisch.js        Dateiauslieferung für server.js und gateway.js
│                       (Brotli/Gzip, ETag, app.js?v=… wird beim Ausliefern gesetzt)
└── public/
    ├── index.html     Markup des Clients
    ├── app.js         Client-Logik (Canvas-Isometrie, Socket-Layer, Store)
    └── app.css        Hauptstile (theme.css / theme-papier.css darüber)
```

### Socket-Events (Client → Server, alle mit Ack `{ok}` / `{error}`)

| Event | Payload | Zweck |
|---|---|---|
| `register` | `{name, color}` | Lobby-Beitritt; Antwort enthält Stammdaten & eigene ID |
| `unlockTile` | `{x, y}` | Sperrzone freischalten |
| `build` / `demolish` | `{x, y, btype?}` | Bauen / Abriss (Server verhindert Doppelbelegung) |
| `placeOrder` | `{side, good, qty, price}` | Limit-Order; matcht sofort gegen Gegenseite |
| `takeOrder` / `cancelOrder` | `{orderId, qty?}` | Liegende Order ausführen / stornieren |
| `issueBond` / `buyBond` | `{principal, rate, term}` / `{bondId}` | Emission / Kauf |
| `bid` | `{auctionId, amount}` | Gebot in Zwangsversteigerung |
| `chat` | `{room, text}` | Chat in 5 Räumen |
| `offerContract` / `acceptContract` / `declineContract` | `{toId, good, qty, price}` | Direktverträge |

### Server → Client

| Event | Inhalt |
|---|---|
| `state` | Öffentlicher Snapshot (Map, Spieler, Orders, Bonds, Auktionen, letzte Trade-Preise) — 1×/s und nach jeder Aktion |
| `me` | Privater Zustand (Cash, Lager, XP) |
| `trade` | Ausgeführter Trade (füttert den Ticker) |
| `chat`, `notice`, `contractOffer` | Chat-Nachricht, System-Toast, Vertragsangebot |

### Design-Entscheidungen

- **Escrow:** Sell-Orders sperren Ware, Buy-Orders sperren Geld beim Platzieren —
  kein Doppel-Ausgeben möglich. Storno/Disconnect erstattet.
- **Preisbildung:** Ausschließlich `lastTrade` je Ware; der Ticker zeigt nur
  echte Transaktionspreise, das Orderbuch nur Spieler-Orders.
- **Rating:** dynamisch aus Verschuldungsgrad (Schulden / (NW+Schulden)) und
  Firmengröße, AAA→D. Serverseitig, nicht manipulierbar.
- **Pfändung:** 3 verpasste Kupons → Pfandrecht; 15 → Gebäude wird enteignet
  und 30 s versteigert, Erlös geht an den Gläubiger.
- **Store im Client:** minimales Observable (`store.subscribe/set`), bewusst
  1:1 austauschbar gegen Zustand/Redux (`subscribe` ≙ Hook, `set` ≙ dispatch).

### Bekannte Grenzen (Prototyp)

- Kein Persistieren des Spielstands (alles in-memory) — ein Neustart des
  Prozesses (oder im Gateway-Modus: das automatische Beenden einer leerlaufenden
  Runde) löscht die laufende Runde unwiderruflich. Für einen dauerhaften Betrieb
  bräuchte es ein periodisches Sichern von `G` auf die Platte.
- Der Gateway-Modus isoliert Runden über echte Betriebssystemprozesse, nicht
  über eine Datenbank — bei sehr vielen gleichzeitigen Runden (deutlich über
  `MAX_ROOMS`) skaliert das irgendwann nicht mehr beliebig weiter.
