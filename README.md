# Capital Sandbox — Localhost-Multiplayer

Isometrische Wirtschaftssimulation als reines Spieler-Ökosystem: keine NPCs,
keine künstlichen Preise. Server = Single Source of Truth.

## Setup (Host)

Ein Befehl — findet/lädt Node automatisch, installiert Abhängigkeiten,
räumt alte Server weg, startet und öffnet den Browser:

```bash
./start.sh
```

Varianten: `./start.sh --share` (öffentlicher Link), `BOT=0 ./start.sh` (ohne KI-Mitspieler).

Alternativ klassisch (Node ≥ 18 vorausgesetzt, `brew install node`):

```bash
npm install
npm start
```

Danach im Browser: `http://localhost:3000`.

**Mitspieler einladen:** Der Join-Screen zeigt einen kopierbaren Einladungslink
(die LAN-Adresse des Hosts, funktioniert für alle im selben WLAN).
Für einen öffentlichen Link, der auch außerhalb des Netzwerks funktioniert:

```bash
npm run share
```

Das öffnet einen localtunnel und zeigt die `https://…`-URL im Terminal und
im Join-Screen an. Hinweis: localtunnel ist ein Fremd-Dienst — für private
Runden okay, für mehr Kontrolle eigenen Reverse-Proxy/Tailscale nutzen.

## Architektur

```
game/
├── server.js          Autoritativer Game-Server (Node + Socket.io, Port 3000)
│                       · Registrierung, Map-Belegung, Produktion (1s-Tick)
│                       · Orderbuch-Matching-Engine (Preis-Zeit-Priorität, Escrow)
│                       · P2P-Anleihen, dynamische Ratings, Pfändung + Auktion
│                       · Chat-Broadcast, Direktverträge
└── public/index.html  Client (Canvas-Isometrie + Socket-Layer + Observable-Store)
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

- Kein Reconnect-Token: bei Disconnect verfallen offene Orders (mit Erstattung),
  Gebäude bleiben verwaist auf der Karte.
- Kein Persistieren des Spielstands (alles in-memory).
- Snapshot wird komplett gesendet (bei 26×26 und wenigen Spielern unkritisch);
  ab größeren Karten auf Delta-Updates umstellen.
