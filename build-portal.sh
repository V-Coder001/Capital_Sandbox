#!/usr/bin/env bash
# Baut die Fassung fuer ein Spieleportal (CrazyGames & Co).
#
# Portale hosten nur die Dateien — der Spielserver bleibt unserer. Deshalb
# unterscheidet sich diese Fassung vom lokalen Betrieb in genau einer Zeile:
# der Serveradresse. Alles andere ist identisch, damit nicht zwei Staende
# auseinanderlaufen.
#
#   ./build-portal.sh https://capital-sandbox.onrender.com [--ohne-intro]
#
# Ergebnis: build/portal/  und  build/capital-sandbox-portal.zip
set -euo pipefail

SERVER="${1:-}"
if [ -z "$SERVER" ]; then
  echo "Fehlt: die oeffentliche Adresse des Spielservers." >&2
  echo "  Beispiel: ./build-portal.sh https://capital-sandbox.onrender.com" >&2
  exit 1
fi
case "$SERVER" in
  https://*) ;;
  http://localhost*|http://127.0.0.1*) echo "Hinweis: lokale Adresse — nur zum Testen brauchbar." >&2 ;;
  *) echo "Warnung: Portale laufen unter HTTPS. Eine http-Adresse wird vom Browser blockiert." >&2 ;;
esac
SERVER="${SERVER%/}"   # Schraegstrich am Ende wegnehmen, sonst entsteht '//api/...'

HIER="$(cd "$(dirname "$0")" && pwd)"
ZIEL="$HIER/build/portal"
rm -rf "$ZIEL"; mkdir -p "$ZIEL"
cp -R "$HIER/public/." "$ZIEL/"
# Auf der Webseite ist index.html die Download-Seite, das Spiel liegt in spiel.html.
# Im Portal ist das Spiel die Startseite.
mv "$ZIEL/spiel.html" "$ZIEL/index.html"

# Die eine Zeile, die diese Fassung ausmacht.
# Seit dem Aufteilen steht das Hauptskript in app.js, nicht mehr in index.html.
python3 - "$ZIEL/app.js" "$SERVER" <<'PY'
import sys
pfad, server = sys.argv[1], sys.argv[2]
s = open(pfad, encoding="utf-8").read()
alt = 'const SERVER_VORGABE = "";'
if alt not in s:
    sys.exit("const SERVER_VORGABE = \"\"; nicht gefunden — hat sich app.js geaendert?")
open(pfad, "w", encoding="utf-8").write(s.replace(alt, f'const SERVER = "{server}";', 1))
print(f"  Serveradresse gesetzt: {server}")
PY

# Das Intro ist mit Abstand die groesste Datei. Fuer die mobile Startseite
# gilt ein Erstdownload von 20 MB — ohne Intro bleibt man klar darunter.
if [ "${2:-}" = "--ohne-intro" ]; then
  rm -f "$ZIEL/assets/video/intro.mp4"
  echo "  Intro-Video entfernt"
fi

cd "$ZIEL"
ZIP="$HIER/build/capital-sandbox-portal.zip"
rm -f "$ZIP"
zip -qr "$ZIP" . -x '.DS_Store' -x '__MACOSX/*'

# Gegen die Grenzen von CrazyGames pruefen, statt sie im Kopf zu behalten.
DATEIEN=$(find . -type f ! -name '.DS_Store' | wc -l | tr -d ' ')
GESAMT_KB=$(du -sk . | cut -f1)
ZIP_KB=$(du -k "$ZIP" | cut -f1)
pruef() { # name wert grenze einheit
  if [ "$2" -le "$3" ]; then echo "  OK   $1: $2 $4 (Grenze $3)"; else echo "  FEHLT $1: $2 $4 — Grenze $3 ueberschritten"; fi
}
echo
echo "index.html im Wurzelverzeichnis: $([ -f index.html ] && echo ja || echo NEIN)"
pruef "Dateizahl      " "$DATEIEN" 1500 "Dateien"
pruef "Gesamtgroesse  " "$((GESAMT_KB/1024))" 250 "MB"
pruef "ZIP            " "$((ZIP_KB/1024))" 250 "MB"
echo
echo "Groesste Dateien:"
find . -type f -exec du -k {} + | sort -rn | head -5 | awk '{printf "  %6.1f MB  %s\n", $1/1024, $2}'
echo
echo "Fertig: $ZIP"
