# Orbital Breach — Koop-Shooter im Browser

Sci-Fi-Ego-Shooter für 1–4 Spieler auf einer havarierten Raumstation im
erdnahen Orbit. Läuft komplett im Browser (Babylon.js, WebGPU oder WebGL2).
Alle Texturen, die Erde und alle Sounds werden prozedural erzeugt, es gibt
keine externen Assets.

## Starten

```bash
npm install          # einmalig (holt u. a. babylonjs)
npm run orbital      # Server auf http://localhost:3100
```

Ein anderer Port geht mit `PORT=4000 npm run orbital`.

**Mitspieler einladen:** Nach dem Beitritt steht in der Adresszeile
`?code=ABCD`. Diesen Link (mit der LAN-IP des Hosts statt `localhost`) an
bis zu drei Mitspieler schicken, oder sie tragen den Code in der Lobby ein.

## Einsatz

1. **Erkunden:** Von der Andockschleuse durch Beobachtungsdeck und den
   schwerelosen Zentralknoten bis zum Kommandomodul. Ab Korridor C gibt es
   keinen Luftdruck, der Anzug-Sauerstoff sinkt (≈ 60 s).
2. **Download:** Am Terminal mit `E` den Logbuch-Download starten. Er läuft
   nur weiter, solange jemand im Kommandomodul lebt. Drohnenwellen greifen an.
3. **Rückzug:** Alle Überlebenden zurück in die Andockschleuse.

Wenn das ganze Team gleichzeitig tot ist, ist der Einsatz gescheitert.
Einzelne Gefallene kommen nach 10 s in der Schleuse wieder.

## Mechaniken

| | |
|---|---|
| **Hüllenbruch** | Die großen Panoramafenster (Beobachtungsdeck, Knoten, Kommando) lassen sich zerschießen. Der Sog reißt Drohnen *und* Spieler ins All. Nach 7 s fällt ein Notschott, nach 40 s wird das Fenster ersetzt. `Strg` (geduckt am Boden) verringert den Sog. |
| **Schwerelosigkeit** | Im Zentralknoten gibt es keine Schwerkraft. `WASD` schiebt in Blickrichtung, `Leertaste`/`Strg` steuern hoch und runter. Der Impuls bleibt erhalten, und jeder Schuss erzeugt Rückstoß. |
| **Sauerstoff** | Im Vakuum leert sich die Anzugflasche, in Räumen mit Druck füllt sie sich wieder auf. Bei 0 % gibt es Schaden, Atemgeräusche und Tunnelblick. |
| **Vakuum-Akustik** | Ohne Atmosphäre klingt alles dumpf (Tiefpass), man hört nur den Körperschall. |

## Steuerung

`WASD` bewegen · `Maus` zielen · `Linksklick` schießen · `Rechtsklick` Visier ·
`Shift` sprinten · `Leertaste` springen/Schub hoch · `Strg`/`C` Schub runter ·
`R` nachladen · `E` interagieren · `T` Funk

## Grafik

- PBR-Materialien mit prozeduralen Albedo-, Normal- und ORM-Texturen (Paneele, Riffelblech, MLI-Thermodecke der Außenhülle, Solarzellen)
- Erde im Web-Worker generiert: Kontinente, Klimazonen, Polkappen, Ozeanglanz (Rauheit), Wolkenschicht und Atmosphärensaum
- Sonnenlicht fällt nur durch die Fenster (Shadow-Map mit der Außenhülle als Schattenwerfer)
- Volumetrische Lichtstrahlen, Linsenreflexe, SSAO, Bloom, ACES-Tonemapping, chromatische Aberration und Filmkorn
- Reflexionssonde für Umgebungsreflexionen (Visier, Glas, Metall)

Die Qualitätsstufe wird in der Lobby gewählt. **Ultra** nutzt WebGPU, wenn der
Browser es kann, und fällt sonst auf WebGL2 zurück.

## Architektur

```
orbital-breach/
├── server.js          Autoritativer Koop-Server (Socket.io, 20 Hz)
│                       · Drohnen-KI (Sichtlinie, Navigation über den Raumgraphen)
│                       · Fenster/Leck/Notschott, Lebenspunkte, Missionsphasen
├── shared/level.js    Levelgeometrie + Kollision, von Server UND Client importiert
└── public/
    ├── index.html     Lobby + HUD
    ├── game.js        Spieler-Physik, Waffe, Netz, Effekte, HUD
    ├── world.js       Station, Außenansicht, Licht, Postprocessing-Ziele
    ├── textures.js    Prozedurale PBR-Texturen + Erde (Web-Worker)
    └── audio.js       Synthetischer WebAudio-Sound
```

Die Bewegung rechnet jeder Client selbst und meldet sie dem Server. Das ist
für einen Koop-Prototyp ausreichend, aber nicht gegen Cheats gehärtet.
