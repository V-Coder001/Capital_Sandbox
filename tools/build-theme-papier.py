#!/usr/bin/env python3
"""Erzeugt public/theme-papier.css aus public/index.html samt app.css und app.js.

Das Stylesheet des Spiels ist über Jahre dunkel gewachsen und enthält rund 600
fest eingetragene Farben. Für das helle Kartenpapier-Thema wird jede Regel mit
Farbangaben dupliziert, unter html[data-theme="papier"] gestellt und ihre
Farben werden übersetzt:

  - dunkle Flächen      → Papiertöne
  - helle Schrift       → Tinte
  - graue Schrift       → gedämpfte Tinte
  - Akzentfarben        → dunklere Varianten mit genug Kontrast auf Papier
  - helle Schleier      → Tinte-Schleier (rgba(255,255,255,a) → rgba(31,26,20,a))

Hand-Feinschliff für die wichtigsten Bausteine steht danach in theme.css und
gewinnt, weil es später geladen wird.

Aufruf (nach Änderungen an index.html, app.css oder app.js erneut ausführen):
  python3 tools/build-theme-papier.py
"""
import colorsys, os, re, sys

HIER = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HIER, "..", "public", "index.html")
APP_CSS = os.path.join(HIER, "..", "public", "app.css")
APP_JS = os.path.join(HIER, "..", "public", "app.js")
ZIEL = os.path.join(HIER, "..", "public", "theme-papier.css")
SCOPE = 'html[data-theme="papier"]'

INK = (31, 26, 20)
PAPER = (248, 244, 234)
PAPER2 = (239, 232, 218)
PAPER3 = (229, 220, 202)
DIM = (74, 65, 52)

# Akzentfarben nach Farbton: (Hue-Bereich in Grad) → Ersatz auf Papier
AKZENTE = [
    ((185, 215), (156, 59, 31)),    # Cyan/Himmelblau (Akzent des Spiels) → Terrakotta
    ((215, 250), (43, 108, 176)),   # Blau → Tintenblau
    ((250, 300), (91, 63, 158)),    # Violett
    ((300, 345), (163, 50, 28)),    # Pink/Rose (Verlust) → Ziegelrot
    ((345, 361), (163, 50, 28)),
    ((0, 20), (163, 50, 28)),       # Rot
    ((20, 50), (156, 90, 10)),      # Orange/Bernstein
    ((50, 70), (138, 106, 0)),      # Gelb → Ocker
    ((70, 165), (47, 125, 79)),     # Grün (Gewinn)
    ((165, 185), (31, 111, 99)),    # Türkis
]

FARB_PROPS = re.compile(r"^(color|background|background-color|background-image|border|border-[a-z-]*|outline|outline-color|"
                        r"box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration-color|column-rule|--[a-z0-9-]+)$")
FARBE = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)")


def parse(c):
    if c.startswith("#"):
        h = c[1:]
        if len(h) in (3, 4):
            h = "".join(ch * 2 for ch in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    zahlen = [float(x) for x in re.findall(r"[\d.]+", c)]
    return int(zahlen[0]), int(zahlen[1]), int(zahlen[2]), (zahlen[3] if len(zahlen) > 3 else 1.0)


def fmt(rgb, a):
    r, g, b = rgb
    return f"rgb({r},{g},{b})" if a >= 0.999 else f"rgba({r},{g},{b},{round(a, 3)})"


def akzent(h):
    deg = h * 360
    for (lo, hi), farbe in AKZENTE:
        if lo <= deg < hi:
            return farbe
    return INK


def umfaerben(c, rolle):
    r, g, b, a = parse(c)
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    bunt = s > 0.35 and 0.25 < l < 0.85
    if rolle == "text":
        if bunt:
            return fmt(akzent(h), a)
        if l > 0.62:
            return fmt(INK, a)
        if l > 0.35:
            return fmt(DIM, a)
        return fmt(PAPER, a)          # dunkle Schrift (z. B. auf Akzentknöpfen) → hell
    if rolle == "flaeche":
        if bunt:
            # farbige Schleier bleiben farbig, aber im Papier-Akzent
            return fmt(akzent(h), a if a < 1 else 0.9)
        if l > 0.85 and a < 0.5:
            return fmt(INK, a)        # heller Hauch auf Dunkel → Tinte-Hauch auf Papier
        if l > 0.8:
            return fmt(INK, a)        # helle Vollfläche (z. B. weißer Knopf) → Tinte
        if l < 0.07:
            return fmt(PAPER, a)
        if l < 0.13:
            return fmt(PAPER2, a)
        if l < 0.3:
            return fmt(PAPER3, a)
        return fmt(DIM, a)
    if rolle == "linie":
        if bunt:
            return fmt(akzent(h), max(a, 0.6))
        if l > 0.7:
            return fmt(INK, a)
        return fmt(INK, min(1.0, 0.25 + a * 0.4))
    if rolle == "schatten":
        if bunt:
            return fmt(akzent(h), a * 0.5)
        return fmt(INK, min(0.22, a * 0.35))
    return c


def rolle_fuer(prop):
    if prop in ("color", "caret-color", "fill", "text-decoration-color", "accent-color"):
        return "text"
    if prop.startswith("background"):
        return "flaeche"
    if prop in ("box-shadow", "text-shadow"):
        return "schatten"
    if prop == "stroke" or prop.startswith("border") or prop.startswith("outline") or prop == "column-rule":
        return "linie"
    return None


def deklarationen_umfaerben(block):
    aus = []
    for dekl in block.split(";"):
        if ":" not in dekl:
            continue
        prop, wert = dekl.split(":", 1)
        prop = prop.strip().lower()
        if not FARB_PROPS.match(prop) or not FARBE.search(wert):
            continue
        if prop.startswith("--"):
            continue                  # Variablen setzt theme.css von Hand
        rolle = rolle_fuer(prop)
        if not rolle:
            continue
        neu = FARBE.sub(lambda m: umfaerben(m.group(0), rolle), wert)
        aus.append(f"{prop}:{neu.strip()}")
    return ";".join(aus)


def scope(sel):
    teile = []
    for s in sel.split(","):
        s = s.strip()
        if not s:
            continue
        if s in (":root", "html"):
            teile.append(SCOPE)
        elif s.startswith("html"):
            teile.append(SCOPE + s[4:])
        else:
            teile.append(f"{SCOPE} {s}")
    return ",".join(teile)


def regeln(css):
    """Einfacher Parser: liefert (prelude, block) und verschachtelte @media."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    i, n, aus = 0, len(css), []
    while i < n:
        auf = css.find("{", i)
        if auf < 0:
            break
        prelude = css[i:auf].strip()
        tiefe, j = 1, auf + 1
        while j < n and tiefe:
            if css[j] == "{":
                tiefe += 1
            elif css[j] == "}":
                tiefe -= 1
            j += 1
        inhalt = css[auf + 1:j - 1]
        aus.append((prelude, inhalt))
        i = j
    return aus


def verarbeiten(css):
    out = []
    for prelude, inhalt in regeln(css):
        if prelude.startswith("@keyframes") or prelude.startswith("@font-face"):
            continue
        if prelude.startswith("@media") or prelude.startswith("@supports"):
            innen = verarbeiten(inhalt)
            if innen:
                out.append(f"{prelude}{{\n{innen}\n}}")
            continue
        if prelude.startswith("@"):
            continue
        neu = deklarationen_umfaerben(inhalt)
        if neu:
            out.append(f"{scope(prelude)}{{{neu}}}")
    return "\n".join(out)


def inline_regeln(html):
    """Inline-Stile (auch in JS-Templates): dunkle Hintergründe → Papier,
    helle Schrift → Tinte. Per Attribut-Selektor auf den exakten Wert."""
    aus, gesehen = [], set()
    for st in re.findall(r'style=\\?"([^"]*)"', html):
        for prop, wert in re.findall(r"(background(?:-color)?|color)\s*:\s*([^;]+)", st):
            for c in FARBE.findall(wert):
                r, g, b, a = parse(c)
                h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                schluessel = (prop, c)
                if schluessel in gesehen:
                    continue
                if prop.startswith("background") and l < .2:
                    neu = f"background:{fmt(PAPER2, max(a, .9))}!important;color:rgb(31,26,20)"
                elif prop == "color" and l > .75 and not (sat > .35 and l < .9):
                    neu = "color:rgb(31,26,20)!important"
                else:
                    continue
                gesehen.add(schluessel)
                aus.append(f'{SCOPE} [style*="{c}"]{{{neu}}}')
    return "\n".join(aus)


def main():
    html = open(INDEX, encoding="utf-8").read()
    # Seit dem Aufteilen stehen Hauptstile und Hauptskript in app.css/app.js.
    # Für die Auswertung wieder an ihre Stelle einsetzen — so bleibt auch die
    # Reihenfolge der Regeln wie vorher.
    html = re.sub(r'<link rel="stylesheet" href="app\.css[^"]*">', lambda m: "<style>" + open(APP_CSS, encoding="utf-8").read() + "</style>", html, count=1)
    html = re.sub(r'<script src="app\.js[^"]*"></script>', lambda m: "<script>" + open(APP_JS, encoding="utf-8").read() + "</script>", html, count=1)
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    kopf = ("/* AUTOMATISCH ERZEUGT von tools/build-theme-papier.py — nicht von Hand ändern.\n"
            " * Übersetzt die fest eingetragenen Farben aus index.html ins Kartenpapier-Thema.\n"
            " * Feinschliff steht in theme.css. */\n")
    open(ZIEL, "w", encoding="utf-8").write(kopf + verarbeiten(css) + "\n/* Inline-Stile */\n" + inline_regeln(html) + "\n")
    print("geschrieben:", ZIEL)


if __name__ == "__main__":
    sys.exit(main())
