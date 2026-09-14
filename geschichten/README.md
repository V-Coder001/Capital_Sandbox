# Geschichten

Kleine private Seite: du lädst (oder nimmst direkt auf) Hörgeschichten hoch,
deine Freundin ruft die Seite auf und hört sie sich an. Kein WhatsApp mehr.

Läuft ohne Abhängigkeiten — nur Node ≥ 18 und die Standardbibliothek.

## Starten

```bash
cd geschichten
ADMIN_PASSWORT=… HOER_PASSWORT=… SESSION_GEHEIMNIS=$(openssl rand -hex 32) node server.js
```

Dann `http://localhost:3100`.

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `ADMIN_PASSWORT` | Passwort für dich: hochladen, löschen | `erzaehler` |
| `HOER_PASSWORT` | Passwort für sie: nur hören | `gutenacht` |
| `SESSION_GEHEIMNIS` | signiert das Login-Cookie; ohne das muss man sich nach jedem Neustart neu anmelden | zufällig |
| `PORT` | Port | `3100` |
| `MAX_MB` | maximale Dateigröße pro Geschichte | `200` |

**Setz die Passwörter, bevor die Seite öffentlich erreichbar ist.** Die Vorgaben
stehen in dieser Datei und sind damit kein Schutz.

## Seiten

- `/` — Liste aller Geschichten mit Player. Neue sind mit „neu" markiert; die
  Markierung verschwindet, sobald sie abgespielt wurden (pro Gerät gemerkt).
- `/aufnehmen` — nur mit Erzähler-Passwort: direkt im Browser aufnehmen
  (Mikrofon) oder eine fertige Audiodatei wählen, Titel + Notiz dazu, hochladen.

## Wo liegen die Daten

In `geschichten/daten/` — die Audiodateien unter `daten/audio/`, der Index in
`daten/geschichten.json`. Der Ordner ist per `.gitignore` ausgenommen; für ein
Backup reicht es, ihn zu kopieren.

## Ins Internet stellen

Der Server spricht reines HTTP. Damit Aufnahme im Browser funktioniert und die
Passwörter nicht im Klartext über die Leitung gehen, muss er hinter HTTPS
stehen — also hinter einem Reverse Proxy (Caddy, nginx) mit Zertifikat, auf
einem kleinen Server mit eigener Domain. Ohne HTTPS erlauben Browser den
Mikrofonzugriff nur auf `localhost`.
