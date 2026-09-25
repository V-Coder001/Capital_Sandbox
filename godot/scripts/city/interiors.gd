class_name Interiors
## Begehbare Ladeninnenräume (Low Poly Interior Pack). Jeder Laden hat einen festen Raum abseits
## der Stadt; E am Eingang teleportiert hinein. Drinnen: Kasse (Verwaltung), Ausgang und ein
## Hinterzimmer, dessen Einrichtung den illegalen Betrieb zeigt. Räume werden erst beim ersten
## Betreten gebaut und sind auf allen Peers identisch (reine Funktion von id/Typ).

const PACK := "res://assets/interior_pack/"
const ZONE_X := 420.0
const ZONE_Z := -200.0
const SPACING := 26.0
const W := 10.0          # Raumbreite (x)
const D := 8.0           # Raumtiefe (z); Eingang bei +z
const H := 3.0
const COUNTER := Vector3(-2.6, 0, -0.9)
const EXIT := Vector3(0, 0, 3.3)

static var wall_materials: Array = []

## Einrichtung je Branche: [Datei, Position (lokal), Drehung in Grad]
const LAYOUTS := {
	"restaurant": [["WoodenDinnerTable", Vector3(1.5, 0, 0.3), 0], ["WoodenChair", Vector3(1.0, 0, 1.2), 180], ["WoodenChair", Vector3(2.0, 0, 1.2), 180],
		["WoodenChair", Vector3(1.0, 0, -0.6), 0], ["WoodenChair", Vector3(2.0, 0, -0.6), 0],
		["WoodenDinnerTable", Vector3(-1.5, 0, 2.2), 0], ["WoodenChair", Vector3(-2.0, 0, 3.1), 180], ["WoodenChair", Vector3(-1.0, 0, 1.3), 0],
		["WoodenDinnerTable", Vector3(3.6, 0, 2.6), 90], ["CookerUnit", Vector3(-4.4, 0, -3.4), 0], ["AmericanFridge", Vector3(-3.2, 0, -3.5), 0],
		["KitchenShelves2", Vector3(-1.4, 0, -3.8), 0], ["PlantPot1", Vector3(4.4, 0, 0.2), 0], ["VaseFlowers1", Vector3(1.5, 1.04, 0.3), 0]],
	"bar": [["KitchenShelves2", Vector3(-4.3, 0, -3.8), 0], ["KitchenShelves2", Vector3(-3.1, 0, -3.8), 0], ["WoodenStool", Vector3(-3.4, 0.74, 0.0), 0],
		["WoodenStool", Vector3(-2.6, 0.74, 0.0), 0], ["WoodenStool", Vector3(-1.8, 0.74, 0.0), 0], ["WideSofa", Vector3(3.5, 0, 3.4), 180],
		["ModernCoffeeTable", Vector3(3.5, 0, 2.3), 0], ["Armchair2", Vector3(1.6, 0, 2.3), 90], ["StandingTV", Vector3(3.5, 0, -1.2), 0],
		["Rug", Vector3(3.5, 0, 1.6), 90], ["Mug", Vector3(-2.2, 1.0, -0.9), 0], ["PlantPot2", Vector3(-4.4, 0, 3.4), 0]],
	"waschsalon": [["WashingMachine", Vector3(-4.4, 0, 2.8), 90], ["WashingMachine", Vector3(-4.4, 0, 1.9), 90], ["WashingMachine", Vector3(-4.4, 0, 1.0), 90],
		["WashingMachine", Vector3(4.4, 0, 3.2), -90], ["WashingMachine", Vector3(4.4, 0, 2.3), -90], ["WashingMachine", Vector3(4.4, 0, 1.4), -90],
		["WashingMachine", Vector3(4.4, 0, 0.5), -90], ["WoodenChair", Vector3(1.0, 0, 0.8), 0], ["WoodenChair", Vector3(1.8, 0, 0.8), 0],
		["Bin", Vector3(-1.0, 0, 3.4), 0], ["PlantPot1", Vector3(-4.3, 0, -3.3), 0], ["WallMountedTV", Vector3(0, 2.2, -3.85), 0]],
	"baeckerei": [["KitchenShelves2", Vector3(-4.3, 0, -3.8), 0], ["KitchenShelves1", Vector3(-3.3, 0, -3.8), 0], ["Toaster", Vector3(-4.1, 0.87, -3.6), 0],
		["Microwave", Vector3(-3.3, 0.87, -3.6), 0], ["Kettle", Vector3(-1.9, 1.0, -0.9), 0], ["WoodenDinnerTable", Vector3(2.4, 0, 1.6), 0],
		["WoodenChair", Vector3(1.9, 0, 2.5), 180], ["WoodenChair", Vector3(2.9, 0, 2.5), 180], ["WoodenChair", Vector3(2.4, 0, 0.7), 0],
		["Bowl", Vector3(2.4, 1.04, 1.6), 0], ["PlantPot2", Vector3(4.4, 0, 3.4), 0]],
	"friseur": [["MakeupMirror", Vector3(-4.6, 1.0, 2.6), 90], ["Armchair1", Vector3(-3.9, 0, 2.6), -90], ["MakeupMirror", Vector3(-4.6, 1.0, 1.1), 90],
		["Armchair1", Vector3(-3.9, 0, 1.1), -90], ["BathroomSink", Vector3(4.9, 0, 2.6), -90], ["BathroomSink", Vector3(4.9, 0, 1.8), -90],
		["WoodenChair", Vector3(2.0, 0, 3.3), 180], ["WoodenChair", Vector3(1.2, 0, 3.3), 180], ["PlantPot1", Vector3(4.4, 0, 0.4), 0],
		["Cabinet1", Vector3(-1.3, 0, -3.5), 0], ["LargeVase", Vector3(0.4, 0, -3.6), 0]],
	"kiosk": [["Bookshelf", Vector3(-4.0, 0, -3.7), 0], ["Bookshelf", Vector3(-1.8, 0, -3.7), 0], ["ModernBookshelves", Vector3(4.8, 0, 2.0), -90],
		["SingleBookshelf", Vector3(1.5, 0.6, 1.8), 0], ["Bin", Vector3(-1.0, 0, 3.4), 0], ["Microwave", Vector3(-3.4, 1.0, -0.9), 0],
		["Cactus", Vector3(-1.8, 1.0, -0.9), 0], ["StandingLamp", Vector3(4.4, 0, 3.3), 0]],
	"pfandleihe": [["Cabinet1", Vector3(-4.1, 0, -3.5), 0], ["Cabinet1", Vector3(-2.4, 0, -3.5), 0], ["ModernBookshelves", Vector3(4.8, 0, 2.0), -90],
		["LargeVase", Vector3(4.5, 1.2, 2.4), 0], ["Vase1", Vector3(4.5, 1.2, 1.6), 0], ["StandingTV", Vector3(2.0, 0, 3.6), 180],
		["RockingChair", Vector3(1.3, 0, 1.0), 0], ["GameBoard", Vector3(-2.0, 1.0, -0.9), 0], ["Lamp1", Vector3(-3.6, 1.0, -0.9), 0]],
	"werkstatt": [["Cabinet1", Vector3(-4.1, 0, -3.5), 0], ["KitchenShelves2", Vector3(-2.5, 0, -3.8), 0], ["Plane", Vector3(2.8, 0, 1.2), 30],
		["WoodenStool", Vector3(1.0, 0.74, 2.8), 0], ["Bin", Vector3(4.5, 0, 3.4), 0], ["Bin", Vector3(-4.5, 0, 3.4), 0],
		["Laptop", Vector3(-2.0, 1.0, -0.9), 0], ["StandingLamp", Vector3(4.4, 0, -0.6), 0]],
	"nachtclub": [["WideSofa", Vector3(-3.4, 0, 3.4), 180], ["WideSofa", Vector3(3.4, 0, 3.4), 180], ["ModernCoffeeTable", Vector3(-3.4, 0, 2.2), 0],
		["ModernCoffeeTable", Vector3(3.4, 0, 2.2), 0], ["Armchair2", Vector3(1.5, 0, 1.2), 90], ["Armchair1", Vector3(-1.5, 0, 1.2), -90],
		["Rug", Vector3(0, 0, 1.2), 90], ["StandingLamp", Vector3(4.5, 0, -0.8), 0], ["WallMountedTV", Vector3(-2.6, 2.2, -3.85), 0],
		["KitchenShelves2", Vector3(-4.3, 0, -3.8), 0], ["Mug", Vector3(-3.4, 0.4, 2.2), 0], ["Mug", Vector3(3.3, 0.4, 2.1), 0]],
	"blumen": [["PlantPot1", Vector3(-4.3, 0, 3.3), 0], ["PlantPot2", Vector3(-4.3, 0, 2.4), 0], ["PlantPot1", Vector3(-4.3, 0, 1.5), 0],
		["PlantPot2", Vector3(4.3, 0, 3.3), 0], ["PlantPot1", Vector3(4.3, 0, 2.4), 0], ["WoodenDinnerTable", Vector3(1.8, 0, 1.4), 0],
		["VaseFlowers1", Vector3(1.3, 1.04, 1.4), 0], ["VaseFlowers1", Vector3(2.3, 1.04, 1.4), 0], ["Cactus", Vector3(1.8, 1.04, 1.2), 0],
		["LargeVase", Vector3(-1.2, 0, 3.4), 0], ["VaseFlowers1", Vector3(-2.2, 1.0, -0.9), 0], ["KitchenShelves2", Vector3(-4.3, 0, -3.8), 0]],
}

## Hinterzimmer (x 1..5, z -4..-1.5) je illegalem Betrieb
const BACKROOMS := {
	"": [["Cabinet1", Vector3(4.1, 0, -3.5), 0], ["Bin", Vector3(1.6, 0, -3.5), 0]],
	"speakeasy": [["WoodenDinnerTable", Vector3(3.0, 0, -2.8), 0], ["WoodenStool", Vector3(2.4, 0.74, -2.0), 0], ["WoodenStool", Vector3(3.6, 0.74, -2.0), 0],
		["Mug", Vector3(2.8, 1.04, -2.8), 0], ["Mug", Vector3(3.3, 1.04, -2.7), 0], ["KitchenShelves1", Vector3(4.6, 0, -3.9), 0]],
	"hehlerei": [["StandingTV", Vector3(2.0, 0, -3.8), 0], ["Laptop", Vector3(3.6, 0.87, -3.7), 0], ["KitchenShelves2", Vector3(3.4, 0, -3.9), 0],
		["Cabinet1", Vector3(4.4, 0, -2.4), -90], ["LargeVase", Vector3(1.6, 0, -2.0), 0]],
	"spielhoelle": [["WoodenDinnerTable", Vector3(3.0, 0, -2.8), 0], ["GameBoard", Vector3(3.0, 1.04, -2.8), 0], ["WoodenChair", Vector3(2.4, 0, -2.0), 180],
		["WoodenChair", Vector3(3.6, 0, -2.0), 180], ["WoodenChair", Vector3(3.0, 0, -3.7), 0], ["Lamp1", Vector3(3.6, 1.04, -3.0), 0]],
	"drogenkueche": [["CookerUnit", Vector3(2.0, 0, -3.5), 0], ["WoodenDinnerTable", Vector3(3.8, 0, -2.9), 90], ["Kettle", Vector3(3.8, 1.04, -3.3), 0],
		["Bowl", Vector3(3.8, 1.04, -2.6), 0], ["Microwave", Vector3(3.8, 1.04, -2.1), 0], ["Bin", Vector3(1.5, 0, -2.0), 0]],
}


static func origin(id: int) -> Vector3:
	return Vector3(ZONE_X + (id % 8) * SPACING, 0, ZONE_Z + (id / 8) * SPACING)


static func counter_world(id: int) -> Vector3:
	return origin(id) + COUNTER + Vector3(0, 0, 0.9)


static func exit_world(id: int) -> Vector3:
	return origin(id) + EXIT


static func spawn_world(id: int) -> Vector3:
	return origin(id) + Vector3(0, 0.1, 2.3)


static func is_inside(pos: Vector3) -> bool:
	return pos.x > ZONE_X - SPACING


static func room_of(pos: Vector3) -> int:
	if not is_inside(pos):
		return -1
	return roundi((pos.x - ZONE_X) / SPACING) + roundi((pos.z - ZONE_Z) / SPACING) * 8


static func _wall_mat(color: Color) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://scripts/city/building.gdshader")
	m.set_shader_parameter("wall_color", color)
	m.set_shader_parameter("trim_color", color.lightened(0.3))
	m.set_shader_parameter("ground_floor", 99.0)
	wall_materials.append(m)
	return m


static func build(id: int, type_id: String, name: String, parent: Node3D) -> Node3D:
	var room := Node3D.new()
	room.name = "Interior%d" % id
	room.position = origin(id)
	parent.add_child(room)
	var body := StaticBody3D.new()
	body.collision_layer = 1
	room.add_child(body)
	room.set_meta("body", body)
	var accent: Color = Catalog.BUSINESS_TYPES[type_id].color
	var wall := _wall_mat(Color(0.93, 0.89, 0.8))
	var floor_col := Color(0.55, 0.33, 0.2) if type_id in ["restaurant", "bar", "nachtclub", "pfandleihe"] else Color(0.72, 0.7, 0.66)
	if type_id == "werkstatt":
		floor_col = Color(0.42, 0.42, 0.44)
	_box(room, body, Vector3(0, -0.1, 0), Vector3(W + 0.4, 0.2, D + 0.4), CityBuilder.flat_material(floor_col), false)
	# Außenwände; Eingangswand (+z) mit Tür und Schaufenstern
	_box(room, body, Vector3(0, H * 0.5, -D * 0.5), Vector3(W + 0.4, H, 0.2), wall)
	_box(room, body, Vector3(-W * 0.5, H * 0.5, 0), Vector3(0.2, H, D), wall)
	_box(room, body, Vector3(W * 0.5, H * 0.5, 0), Vector3(0.2, H, D), wall)
	_box(room, body, Vector3(0, H * 0.5, D * 0.5), Vector3(W + 0.4, H, 0.2), wall)
	var glass := CityBuilder.flat_material(Color(0.55, 0.7, 0.8, 0.5))
	for sx in [-3.0, 3.0]:
		_box(room, null, Vector3(sx, 1.5, D * 0.5 - 0.12), Vector3(2.6, 1.7, 0.05), glass, false)
	_box(room, null, Vector3(0, 1.15, D * 0.5 - 0.13), Vector3(1.3, 2.3, 0.05), CityBuilder.flat_material(Color(0.25, 0.15, 0.08)), false)
	# Akzentstreifen in Branchenfarbe
	_box(room, null, Vector3(0, 2.75, -D * 0.5 + 0.12), Vector3(W - 0.2, 0.3, 0.04), CityBuilder.flat_material(accent), false)
	# Hinterzimmer: Trennwände mit Türöffnung
	_box(room, body, Vector3(1.0, H * 0.5, -2.75), Vector3(0.15, H, 2.5), wall)
	_box(room, body, Vector3(1.6, H * 0.5, -1.5), Vector3(1.2, H, 0.15), wall)
	_box(room, body, Vector3(4.1, H * 0.5, -1.5), Vector3(1.8, H, 0.15), wall)
	_box(room, null, Vector3(2.7, 2.6, -1.5), Vector3(1.0, 0.8, 0.15), wall, false)
	# Theke mit Kasse
	var counter := CityBuilder.flat_material(accent.darkened(0.35))
	_box(room, body, COUNTER + Vector3(0, 0.5, 0), Vector3(3.2, 1.0, 0.7), counter)
	_box(room, null, COUNTER + Vector3(0, 1.02, 0), Vector3(3.3, 0.05, 0.8), CityBuilder.flat_material(Color(0.2, 0.18, 0.16)), false)
	_prop(room, body, "Laptop", COUNTER + Vector3(0.9, 1.04, 0), 180)
	# Beschriftung
	var sign := Label3D.new()
	sign.text = name
	sign.font_size = 64
	sign.pixel_size = 0.006
	sign.outline_size = 10
	sign.position = Vector3(-1.6, 2.35, -D * 0.5 + 0.15)
	room.add_child(sign)
	var exit_lbl := Label3D.new()
	exit_lbl.text = "AUSGANG"
	exit_lbl.font_size = 40
	exit_lbl.pixel_size = 0.006
	exit_lbl.modulate = Color(0.4, 1.0, 0.5)
	exit_lbl.position = Vector3(0, 2.5, D * 0.5 - 0.2)
	exit_lbl.rotation.y = PI
	room.add_child(exit_lbl)
	for p in LAYOUTS.get(type_id, []):
		_prop(room, body, p[0], p[1], p[2])
	for lp in [Vector3(-2.5, H, 0.5), Vector3(2.5, H, 1.5)]:
		_prop(room, null, "CeilingLamp", lp, 0)
	var light := OmniLight3D.new()
	light.position = Vector3(0, 2.6, 0.8)
	light.omni_range = 9.0
	light.light_energy = 1.3
	light.light_color = Color(1.0, 0.9, 0.75)
	room.add_child(light)
	var back := Node3D.new()
	back.name = "Backroom"
	room.add_child(back)
	room.set_meta("op", "?")
	return room


static func set_backroom(room: Node3D, op: String) -> void:
	if room.get_meta("op", "?") == op:
		return
	room.set_meta("op", op)
	var back: Node3D = room.get_node("Backroom")
	for c in back.get_children():
		c.queue_free()
	var body := StaticBody3D.new()
	body.collision_layer = 1
	back.add_child(body)
	for p in BACKROOMS.get(op, BACKROOMS[""]):
		_prop(back, body, p[0], p[1], p[2])
	if op == "drogenkueche":
		var glow := OmniLight3D.new()
		glow.light_color = Color(0.5, 1.0, 0.4)
		glow.position = Vector3(3.0, 2.0, -2.7)
		glow.omni_range = 3.5
		back.add_child(glow)


static func _box(room: Node3D, body: StaticBody3D, pos: Vector3, size: Vector3, mat: Material, collide := true) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	room.add_child(mi)
	if collide and body:
		var cs := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		cs.shape = shape
		cs.position = pos
		body.add_child(cs)


static func _prop(room: Node3D, body: StaticBody3D, file: String, pos: Vector3, deg: float) -> void:
	var xf := Transform3D(Basis(Vector3.UP, deg_to_rad(deg)), pos)
	var aabb := AABB()
	var first := true
	for part in CityBuilder.mesh_parts(PACK + file + ".fbx"):
		var mi := MeshInstance3D.new()
		mi.mesh = part[0]
		mi.transform = xf * (part[1] as Transform3D)
		room.add_child(mi)
		var b: AABB = (part[1] as Transform3D) * (part[0] as Mesh).get_aabb()
		aabb = b if first else aabb.merge(b)
		first = false
	# Große Möbel bekommen eine Kiste als Kollision
	if body and aabb.size.x * aabb.size.z > 0.3 and aabb.size.y > 0.35 and pos.y < 0.5:
		var cs := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = aabb.size
		cs.shape = shape
		cs.transform = xf * Transform3D(Basis.IDENTITY, aabb.get_center())
		body.add_child(cs)
