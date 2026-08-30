#!/usr/bin/env python3
"""Backt den topoexport-DXF von San Francisco zu einer Spielkarte.

Laeuft einmal von Hand; das Ergebnis (maps/sanfrancisco.json) liegt im
Repository, damit der Server weder Python noch ezdxf braucht.

    python3 -m venv .venv && .venv/bin/pip install ezdxf
    .venv/bin/python tools/build-sf-map.py <pfad-zur.dxf>

Warum 64x64: der Ausschnitt ist 1167 m breit, das ergibt 18,2 m je Kachel.
Damit ist eine Strasse eine Kachel breit und ein Block drei bis vier — bei den
26x26 des Sandkastens waeren es 45 m und damit 68 % Strassenanteil, also Brei.

Datenquelle: topoexport.com, Geometrie aus Overture Maps (ODbL) und USGS.
Die Namensnennung gehoert ins Spiel, siehe maps/ATTRIBUTION.md.
"""
import sys, json, math, collections

N = 64                      # Kantenlaenge des Kachelgitters
ROUTE_MIN_LEN = 14.0        # kuerzere Strassenzuege taugen nicht als Fahrspur
ROUTE_MAX = 14              # so viele Fahrspuren wandern in die Karte

def main(pfad):
    import ezdxf
    doc = ezdxf.readfile(pfad)
    msp = doc.modelspace()
    xs, ys = [], []
    for e in msp.query('LWPOLYLINE'):
        for p in e.get_points():
            xs.append(p[0]); ys.append(p[1])
    x0, y0 = min(xs), min(ys)
    span = max(max(xs) - x0, max(ys) - y0)
    def g(x, y):                       # Weltmeter -> Kachelkoordinate (float)
        return (x - x0) / span * N, (y - y0) / span * N

    road  = [[0] * N for _ in range(N)]
    water = [[False] * N for _ in range(N)]
    park  = [[False] * N for _ in range(N)]
    dichte = [[0] * N for _ in range(N)]
    hoehe  = [[0.0] * N for _ in range(N)]

    # --- Strassenachsen rastern ---
    achsen = []
    for e in msp.query('LWPOLYLINE[layer=="TPX_ROADS_AXES"]'):
        pts = [(p[0], p[1]) for p in e.get_points()]
        if len(pts) < 2: continue
        achsen.append(pts)
        for a, b in zip(pts, pts[1:]):
            schritte = max(2, int(math.dist(a, b) / 3))
            for i in range(schritte + 1):
                t = i / schritte
                gx, gy = g(a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)
                if 0 <= gx < N and 0 <= gy < N: road[int(gy)][int(gx)] += 1

    # --- Flaechen (Wasser, Gruen) ueber Punkt-in-Polygon der Kachelmitte ---
    def flaeche(layer, ziel):
        for e in msp.query(f'LWPOLYLINE[layer=="{layer}"]'):
            pts = [(p[0], p[1]) for p in e.get_points()]
            if len(pts) < 3: continue
            gxs = [g(*p)[0] for p in pts]; gys = [g(*p)[1] for p in pts]
            for cy in range(max(0,int(min(gys))), min(N, int(max(gys))+1)):
                for cx in range(max(0,int(min(gxs))), min(N, int(max(gxs))+1)):
                    px, py = cx + .5, cy + .5
                    drin = False; j = len(pts) - 1
                    for i in range(len(pts)):
                        if (gys[i] > py) != (gys[j] > py):
                            xin = (gxs[j]-gxs[i]) * (py-gys[i]) / (gys[j]-gys[i]+1e-12) + gxs[i]
                            if px < xin: drin = not drin
                        j = i
                    if drin: ziel[cy][cx] = True
    flaeche("TPX_WATERWAYS", water)
    flaeche("TPX_VEGETATION_GREEN_SPACES", park)

    # --- Gebaeudedichte und mittlere Hoehe je Kachel (fuer die Zonen) ---
    hsum = [[0.0] * N for _ in range(N)]
    for e in msp.query('LWPOLYLINE[layer=="TPX_BUILDINGS"]'):
        pts = [(p[0], p[1]) for p in e.get_points()]
        gx, gy = g(sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts))
        if 0 <= gx < N and 0 <= gy < N: dichte[int(gy)][int(gx)] += 1
    # Der Text lautet "H 3.7 m" — die Zahl herausziehen, nicht bloss "m" streichen.
    import re as _re
    for t in msp.query('TEXT[layer=="TPX_BUILDING_HEIGHTS_TEXT"]'):
        m = _re.search(r"[\d.]+", str(t.dxf.text))
        if not m: continue
        h = float(m.group())
        gx, gy = g(t.dxf.insert[0], t.dxf.insert[1])
        if 0 <= gx < N and 0 <= gy < N: hsum[int(gy)][int(gx)] += h
    for y in range(N):
        for x in range(N):
            if dichte[y][x]: hoehe[y][x] = hsum[y][x] / dichte[y][x]

    # --- Baeume zaehlen (Deko) ---
    baum = [[0] * N for _ in range(N)]
    for e in msp.query('INSERT[layer=="TPX_VEGETATION_TREES_INDIVIDUAL"]'):
        gx, gy = g(e.dxf.insert[0], e.dxf.insert[1])
        if 0 <= gx < N and 0 <= gy < N: baum[int(gy)][int(gx)] += 1

    # --- Fahrspuren: echte Strassenzuege statt Gitterzeilen ---
    # Der Client interpoliert entlang der Stuetzpunkte, die Punkte muessen also
    # nicht auf Achsen liegen. Jede Spur wird nach unten orientiert (wachsendes
    # x+y), weil die Kenney-Sprites nur eine Vorderansicht haben.
    spuren = []
    for pts in achsen:
        gp = [g(*p) for p in pts]
        laenge = sum(math.dist(a, b) for a, b in zip(gp, gp[1:]))
        if laenge < ROUTE_MIN_LEN: continue
        if (gp[0][0] + gp[0][1]) > (gp[-1][0] + gp[-1][1]): gp.reverse()
        if not all(0 <= x < N and 0 <= y < N for x, y in gp): continue
        # Gleichmaessig abtasten: der Client zaehlt Stuetzpunkte, nicht Strecke.
        # Mit den rohen DXF-Vertices (Spruenge von 0,5 bis 7 Kacheln) raste ein
        # Auto ueber lange Abschnitte und kroeche ueber kurze.
        fein, rest = [gp[0]], 0.0
        for a2, b2 in zip(gp, gp[1:]):
            d2 = math.dist(a2, b2)
            if d2 < 1e-9: continue
            pos = rest
            while pos < d2:
                t = pos / d2
                fein.append((a2[0] + (b2[0]-a2[0])*t, a2[1] + (b2[1]-a2[1])*t))
                pos += 1.0
            rest = pos - d2
        if math.dist(fein[-1], gp[-1]) > 0.3: fein.append(gp[-1])
        # Doppelte Punkte raus: an denen stuende das Auto einen Schritt still.
        fein = [q for i, q in enumerate(fein) if i == 0 or math.dist(q, fein[i-1]) > 0.05]
        spuren.append((laenge, [[round(x, 2), round(y, 2)] for x, y in fein]))
    spuren.sort(key=lambda s: -s[0])
    routes = [p for _, p in spuren[:ROUTE_MAX]]

    # --- Zonen ueber die geglaettete Bebauungsintensitaet ---
    # Feste Schwellen ("ueber 25 m ist Innenstadt") taugen nicht: dieser
    # Ausschnitt ist flach bebaut, dort waere alles Agrarland. Stattdessen die
    # Summe aus Anzahl x Hoehe ueber ein 3x3-Fenster und danach Perzentile —
    # das trifft die dichteste Ecke unabhaengig vom gewaehlten Ausschnitt.
    intens = [[0.0] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            v = 0.0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= xx < N and 0 <= yy < N:
                        v += dichte[yy][xx] * max(hoehe[yy][xx], 1.0)
            intens[y][x] = v
    bebaut = sorted(v for r in intens for v in r if v > 0)
    def perz(q): return bebaut[int(len(bebaut) * q)] if bebaut else 0
    gZentrum, gIndustrie = perz(.92), perz(.55)
    zonen = []
    for y in range(N):
        z = ""
        for x in range(N):
            if water[y][x]: z += "~"
            elif intens[y][x] >= gZentrum: z += "Z"
            elif intens[y][x] >= gIndustrie: z += ":"
            else: z += "."
        zonen.append(z)

    # --- Kacheln als Zeilenstrings: . frei, # Strasse, ~ Wasser, " Park ---
    zeilen = []
    for y in range(N):
        z = ""
        for x in range(N):
            if water[y][x]:      z += "~"
            elif road[y][x] > 0: z += "#"
            elif park[y][x]:     z += '"'
            else:                z += "."
        zeilen.append(z)

    karte = {
        "name": "San Francisco",
        "quelle": "topoexport.com — Overture Maps (ODbL), USGS 3DEP",
        "w": N, "h": N,
        "meterProKachel": round(span / N, 2),
        "tiles": zeilen,
        "zonen": zonen,
        "dichte": ["".join(str(min(9, dichte[y][x])) for x in range(N)) for y in range(N)],
        "hoehe":  [[round(hoehe[y][x], 1) for x in range(N)] for y in range(N)],
        "baeume": ["".join(str(min(9, baum[y][x])) for x in range(N)) for y in range(N)],
        "routes": routes,
    }
    ziel = "maps/sanfrancisco.json"
    with open(ziel, "w") as f: json.dump(karte, f, separators=(",", ":"))
    strassen = sum(z.count("#") for z in zeilen)
    print(f"{ziel} geschrieben — {N}x{N}, {span/N:.1f} m je Kachel")
    print(f"  Strasse {strassen} Kacheln ({strassen/(N*N)*100:.0f}%), "
          f"Wasser {sum(z.count('~') for z in zeilen)}, Park {sum(z.count(chr(34)) for z in zeilen)}")
    print(f"  {len(routes)} Fahrspuren, laengste {spuren[0][0]:.0f} Kacheln")
    print(f"  Zonen: Zentrum {sum(z.count('Z') for z in zonen)}, "
          f"Industrie {sum(z.count(':') for z in zonen)}, "
          f"Agrar {sum(z.count('.') for z in zonen)}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else
         "/Users/vincentbiesdorf/Downloads/topoexport-7996C0/topoexport_2D_vectorial.dxf")
