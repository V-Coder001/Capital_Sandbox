class_name Catalog
## Statische Spieldaten: Bezirke, Geschäftstypen, illegale Betriebe, Waffen.
## Alles hier ist auf allen Peers identisch und wird nie übers Netz geschickt.

const SEED := 1931            # fester Seed → jede Instanz baut exakt dieselbe Stadt
const START_CLEAN := 25000
const MINUTES_PER_SECOND := 2.0   # 1 Echtsekunde = 2 Spielminuten → Stundentick alle 30 s
const INTERACT_RANGE := 6.0
const LAUNDER_FEE := 0.15         # 15 % bleiben bei der Wäsche hängen
const SELL_FACTOR := 0.7

const WEEKDAYS := ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]

## Vier Bezirke = vier Quadranten des Stadtgitters.
const DISTRICTS := [
	{"name": "Garment District", "color": Color(0.25, 0.8, 0.35), "price": 0.8,
		"working": 70, "middle": 22, "upper": 8, "height": Vector2i(2, 6)},
	{"name": "Hell's Kitchen", "color": Color(0.25, 0.45, 0.95), "price": 0.9,
		"working": 58, "middle": 32, "upper": 10, "height": Vector2i(2, 7)},
	{"name": "Midtown", "color": Color(0.98, 0.65, 0.1), "price": 1.4,
		"working": 25, "middle": 45, "upper": 30, "height": Vector2i(5, 14)},
	{"name": "Murray Hill", "color": Color(0.9, 0.15, 0.3), "price": 1.1,
		"working": 38, "middle": 44, "upper": 18, "height": Vector2i(3, 9)},
]

## Legale Geschäfte = Fassaden (Fronts). Preis/Einnahmen werden mit dem Bezirksfaktor skaliert.
## income = saubere Einnahmen pro Spielstunde, launder = Waschkapazität pro Stunde.
const BUSINESS_TYPES := {
	"restaurant": {"label": "Restaurant", "price": 18000, "income": 260, "launder": 900,
		"color": Color(0.75, 0.15, 0.15), "icon": "R", "names": ["Trattoria %s", "Ristorante %s", "Diner %s"]},
	"waschsalon": {"label": "Waschsalon", "price": 9000, "income": 120, "launder": 1600,
		"color": Color(0.2, 0.55, 0.85), "icon": "W", "names": ["Waschsalon %s", "Blitzblank %s", "%s Laundry"]},
	"bar": {"label": "Bar", "price": 14000, "income": 220, "launder": 800,
		"color": Color(0.55, 0.3, 0.12), "icon": "B", "names": ["%s's Bar", "Taverne %s", "Lounge %s"]},
	"baeckerei": {"label": "Bäckerei", "price": 8000, "income": 110, "launder": 400,
		"color": Color(0.85, 0.65, 0.3), "icon": "Bä", "names": ["Bäckerei %s", "Panificio %s"]},
	"friseur": {"label": "Friseursalon", "price": 7000, "income": 90, "launder": 500,
		"color": Color(0.8, 0.4, 0.7), "icon": "F", "names": ["Salon %s", "Barbiere %s"]},
	"kiosk": {"label": "Kiosk", "price": 5000, "income": 70, "launder": 300,
		"color": Color(0.9, 0.8, 0.2), "icon": "K", "names": ["Kiosk %s", "%s News"]},
	"pfandleihe": {"label": "Pfandleihe", "price": 12000, "income": 150, "launder": 1200,
		"color": Color(0.6, 0.6, 0.2), "icon": "P", "names": ["Pfandhaus %s", "%s Pawn"]},
	"werkstatt": {"label": "Autowerkstatt", "price": 16000, "income": 200, "launder": 1000,
		"color": Color(0.4, 0.4, 0.45), "icon": "A", "names": ["Garage %s", "%s Motors"]},
	"nachtclub": {"label": "Nachtclub", "price": 30000, "income": 420, "launder": 1800,
		"color": Color(0.55, 0.15, 0.75), "icon": "N", "names": ["Club %s", "Velvet %s"]},
	"blumen": {"label": "Blumenladen", "price": 6000, "income": 80, "launder": 350,
		"color": Color(0.35, 0.7, 0.3), "icon": "Bl", "names": ["Fiori %s", "Blumen %s"]},
}

const SURNAMES := ["Rossi", "Bianchi", "Moretti", "Gallo", "Costa", "O'Malley", "Kowalski",
	"Goldberg", "Schulz", "Romano", "Esposito", "Marino", "Greco", "Bruno", "Fontana", "Conti",
	"Ricci", "Lombardi", "Barbieri", "Ferrara", "Sullivan", "Novak", "Russo", "Caruso", "Vitale"]

## Illegale Betriebe im Hinterzimmer eines eigenen Geschäfts → Schwarzgeld + Fahndungsdruck.
const OPS := {
	"speakeasy": {"label": "Speakeasy", "cost": 5000, "dirty": 350, "heat": 1.0},
	"hehlerei": {"label": "Hehlerei", "cost": 6000, "dirty": 420, "heat": 1.3},
	"spielhoelle": {"label": "Spielhölle", "cost": 8000, "dirty": 520, "heat": 1.6},
	"drogenkueche": {"label": "Drogenküche", "cost": 12000, "dirty": 900, "heat": 3.2},
}

## Schutzgeld-Stufen: Anteil der Ladeneinnahmen, Ablehnungs-/Widerstandsrisiko, Hitze.
const EXTORTION := [
	{},
	{"label": "Freundliche Bitte", "share": 0.12, "refuse": 0.10, "resist": 0.02, "heat": 0.1},
	{"label": "Deutlicher Hinweis", "share": 0.28, "refuse": 0.25, "resist": 0.06, "heat": 0.35},
	{"label": "Knallharte Ansage", "share": 0.48, "refuse": 0.40, "resist": 0.14, "heat": 0.8},
]

const WEAPONS := {
	"pistol": {"label": "Pistole", "model": "Pistol_01", "price": 0, "damage": 20, "rate": 0.35, "pellets": 1, "spread": 0.02, "range": 40.0},
	"revolver": {"label": "Revolver", "model": "Revolver_01", "price": 1500, "damage": 38, "rate": 0.7, "pellets": 1, "spread": 0.01, "range": 45.0},
	"smg": {"label": "Tommy Gun", "model": "Submachine_Gun_01", "price": 4500, "damage": 11, "rate": 0.09, "pellets": 1, "spread": 0.06, "range": 35.0},
	"shotgun": {"label": "Schrotflinte", "model": "Shotgun_01", "price": 3000, "damage": 12, "rate": 0.9, "pellets": 6, "spread": 0.12, "range": 18.0},
}

## KI-Familien (negative Besitzer-IDs), damit die Stadt auch im Einzelspieler umkämpft ist.
const AI_FAMILIES := {
	-1: {"name": "Familie Tattaglia", "color": Color(0.55, 0.55, 0.6), "home": 1},
	-2: {"name": "Familie Barzini", "color": Color(0.35, 0.3, 0.25), "home": 3},
}

const SKINS := ["Boss_Mafia_01", "Mafiosi_01", "Mafiosi_02"]
const PLAYER_COLORS := [Color(0.95, 0.75, 0.2), Color(0.3, 0.8, 1.0), Color(0.95, 0.35, 0.35),
	Color(0.5, 0.95, 0.45), Color(0.85, 0.5, 1.0), Color(1.0, 0.55, 0.2), Color(0.95, 0.95, 0.95), Color(0.3, 0.95, 0.8)]


static func business_price(type_id: String, district: int) -> int:
	return int(round(BUSINESS_TYPES[type_id].price * DISTRICTS[district].price / 100.0) * 100)


static func business_income(type_id: String, district: int) -> float:
	return BUSINESS_TYPES[type_id].income * DISTRICTS[district].price


static func money(v: float) -> String:
	var n := int(round(v))
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if n < 0 else "") + "$" + s + out


static func clock_text(minutes: float) -> Dictionary:
	var m := int(minutes)
	var day := m / 1440
	return {"day": "%s (Tag %d)" % [WEEKDAYS[day % 7], day + 1],
		"time": "%02d:%02d" % [(m / 60) % 24, m % 60]}
