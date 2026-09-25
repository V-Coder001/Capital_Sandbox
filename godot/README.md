# Capital Sandbox – Cosa Nostra (Godot 4)

Mafia-Wirtschaftssimulation im Stil von *Big Ambitions*: 3D-Stadt mit Schrägsicht-Kamera,
Fassaden-Läden, Schutzgeld, Geldwäsche, Bezirks-Einfluss, Razzien, Schießereien, Multiplayer.

**Voraussetzung:** Godot **4.4+** (FBX-Import ist eingebaut). Ordner `godot/` im Projektmanager importieren, F5.

## Steuerung
WASD laufen · Shift rennen · rechte Maus ziehen = Kamera drehen · Mausrad = Zoom ·
linke Maus = schießen · E = interagieren (Ring vor dem Ladeneingang) · M = Karte · Tab = Imperium · F1 = Hilfe

## Multiplayer
* **Host:** im Menü „Spiel hosten“ (Port 24565, UDP freigeben). Der Host ist zugleich autoritativer Server.
* **Beitreten:** `IP:Port` eintragen → „Beitreten“.
* **Dedizierter Server:** `godot --headless --path godot -- --server --port=24565`
* Schnellstart ohne Menü: `-- --host` bzw. `-- --join=127.0.0.1:24565 --name=Vito`

Architektur: Der Server rechnet alles Wirtschaftliche (`scripts/core/game_state.gd`) und alle Treffer
(`world.gd`), Clients schicken nur Wünsche per RPC. Die Bewegung gehört dem jeweiligen Client und wird per
`MultiplayerSynchronizer` verteilt; Spieler und Geldtaschen entstehen über `MultiplayerSpawner`, die Welt selbst
über einen Spawner in `main.gd` (sauberer Late-Join). Die Stadt wird aus einem festen Seed auf jedem Peer
identisch generiert, übertragen wird nur der dynamische Zustand.

## Aufbau
| Datei | Inhalt |
|---|---|
| `scripts/core/catalog.gd` | Bezirke, Ladentypen, illegale Betriebe, Schutzgeld-Stufen, Waffen, Balancing |
| `scripts/core/game_state.gd` | Server-Wirtschaft: Uhr, Stundentick, Kauf, Schutzgeld, Wäsche, Einfluss, Razzien, KI-Familien |
| `scripts/core/world.gd` | Welt, Spawner, Kampf-RPCs, Geldtaschen, Tag/Nacht |
| `scripts/city/city_builder.gd` | Stadtgenerator: GridMap aus Pack-Straßen/Gehwegen, Gebäude, Läden, Parks, Kartenebene |
| `scripts/city/traffic.gd` | KI-Verkehr mit Ampelphasen (lokal, reine Kulisse) |
| `scripts/player/*` | Spieler, Kamera-Rig, Figuren-Rig (T-Pose-Modelle werden zur Laufzeit in Körper/Arme zerlegt) |
| `scripts/ui/*` | Menü und HUD, komplett im Code gebaut |
| `assets/mafia_pack/` | Mafia LowPoly Pack (FBX + Texturen) |

## Test
`godot --path godot -- --host --autotest` spielt Kaufen, Hinterzimmer, Wäsche, Schutzgeld, Schießen,
Karte und Panels durch und legt Screenshots unter `user://autotest/` ab. Mit einem dedizierten Server und
zwei Clients (`--join=… --autotest --expect-players=2`) werden zusätzlich Positions-Sync und PvP geprüft.
