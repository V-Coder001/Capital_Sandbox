class_name CityBuilder
extends Node3D
## Baut die komplette Stadt deterministisch aus Catalog.SEED:
## Straßen und Gehwege als GridMap (Tiles aus dem Mafia-LowPoly-Pack), prozedurale Gebäude,
## Läden mit Schaufenstern, Parks, Straßenmöbel (MultiMesh) und die Kartenebene (Taste M).
## Server und alle Clients erzeugen dieselbe Stadt, übertragen wird nur der dynamische Zustand.

const TILE := 3.0
const BLOCKS := 6
const P := 10                     # Rasterweite eines Blocks in Tiles: 2 Straße + 8 Block
const N := BLOCKS * P + 2         # +2 für die abschließende Straße am Rand
const HALF := N * TILE * 0.5
const PACK := "res://assets/mafia_pack/"

const PARKS := [Vector2i(1, 4), Vector2i(4, 1)]
const POLICE_BLOCK := Vector2i(1, 1)
const GUNS_BLOCK := Vector2i(2, 4)

enum { ROAD_PLAIN, ROAD_LANE, SIDEWALK, SIDEWALK_EDGE, SIDEWALK_CORNER }

var businesses: Array = []        # statisch: {id, name, type, district, pos, normal, street}
var pois: Array = []              # {id, kind, name, pos, normal}
var spawn_points: Array = []
var storefront_nodes := {}        # biz id -> {ring: MeshInstance3D, ring_mat, pin_mat, pin: Node3D}
var map_layer: Node3D
var district_overlays: Array = []
var pins := {}                    # key (biz id oder "poi_x") -> Node3D
var street_labels: Array = []
var building_materials: Array = []
var glass_material: StandardMaterial3D
var lamp_material: StandardMaterial3D

var _rng := RandomNumberGenerator.new()
var _world_body: StaticBody3D
var _multimesh_xforms := {}       # prop path -> Array[Transform3D]
var _reserved := {}               # Vector2i tile -> true (Ladeneingänge, keine Deko)


func build() -> void:
	_rng.seed = Catalog.SEED
	_world_body = StaticBody3D.new()
	_world_body.name = "WorldCollision"
	_world_body.collision_layer = 1
	_world_body.collision_mask = 0
	add_child(_world_body)
	map_layer = Node3D.new()
	map_layer.name = "MapLayer"
	map_layer.visible = false
	add_child(map_layer)
	_make_materials()
	_build_ground()
	_build_gridmap()
	_build_crosswalks()
	for bz in BLOCKS:
		for bx in BLOCKS:
			_build_block(bx, bz)
	_build_street_props()
	_flush_multimeshes()
	_build_map_layer()


# ---------------------------------------------------------------- Koordinaten

static func tile_center(i: int, j: int) -> Vector3:
	return Vector3((i + 0.5) * TILE - HALF, 0.0, (j + 0.5) * TILE - HALF)


static func district_at(pos: Vector3) -> int:
	return (0 if pos.x < 0.0 else 1) + (0 if pos.z > 0.0 else 2)


static func node_pos(ix: int, iz: int) -> Vector3:
	## Mittelpunkt der Kreuzung ix/iz (0..BLOCKS) – Knoten des Verkehrsnetzes.
	return Vector3((ix * P + 1) * TILE - HALF, 0.0, (iz * P + 1) * TILE - HALF)


static func ordinal(n: int) -> String:
	var suffix := "th"
	if n % 100 < 11 or n % 100 > 13:
		match n % 10:
			1: suffix = "st"
			2: suffix = "nd"
			3: suffix = "rd"
	return "%d%s" % [n, suffix]


static func avenue_name(ix: int) -> String:
	return "%s Avenue" % ordinal(ix + 1)


static func street_name(iz: int) -> String:
	return "%s Street" % ordinal(BLOCKS - iz + 10)


static func location_text(pos: Vector3) -> String:
	var ix := clampi(roundi((pos.x + HALF - TILE) / (P * TILE)), 0, BLOCKS)
	var iz := clampi(roundi((pos.z + HALF - TILE) / (P * TILE)), 0, BLOCKS)
	return "%s / %s" % [avenue_name(ix), street_name(iz)]


# ---------------------------------------------------------------- Materialien

func _make_materials() -> void:
	var shader: Shader = load("res://scripts/city/building.gdshader")
	var palette := [
		[Color(0.55, 0.27, 0.2), Color(0.85, 0.8, 0.7)],    # Backstein
		[Color(0.45, 0.33, 0.25), Color(0.8, 0.75, 0.65)],  # Braunstein
		[Color(0.78, 0.7, 0.55), Color(0.95, 0.92, 0.85)],  # Sandstein
		[Color(0.5, 0.5, 0.52), Color(0.8, 0.8, 0.8)],      # Beton
		[Color(0.33, 0.35, 0.4), Color(0.7, 0.72, 0.75)],   # Schiefer
		[Color(0.7, 0.55, 0.42), Color(0.92, 0.88, 0.8)],   # Terrakotta
		[Color(0.62, 0.62, 0.55), Color(0.9, 0.9, 0.85)],   # Kalkstein
		[Color(0.42, 0.22, 0.2), Color(0.78, 0.72, 0.62)],  # dunkler Backstein
	]
	for k in palette.size():
		var m := ShaderMaterial.new()
		m.shader = shader
		m.set_shader_parameter("wall_color", palette[k][0])
		m.set_shader_parameter("trim_color", palette[k][1])
		m.set_shader_parameter("seed", float(k) * 3.1)
		building_materials.append(m)
	glass_material = StandardMaterial3D.new()
	glass_material.albedo_color = Color(0.12, 0.16, 0.2)
	glass_material.metallic = 0.6
	glass_material.roughness = 0.08
	glass_material.emission_enabled = true
	glass_material.emission = Color(1.0, 0.8, 0.5)
	glass_material.emission_energy_multiplier = 0.0
	lamp_material = StandardMaterial3D.new()
	lamp_material.albedo_color = Color(1, 0.95, 0.8)
	lamp_material.emission_enabled = true
	lamp_material.emission = Color(1.0, 0.85, 0.55)
	lamp_material.emission_energy_multiplier = 0.2


func set_cutout(center: Vector3, camera_pos: Vector3, radius: float) -> void:
	for m in building_materials:
		m.set_shader_parameter("cut_center", center)
		m.set_shader_parameter("cut_camera", camera_pos)
		m.set_shader_parameter("cut_radius", radius)


func set_night(amount: float) -> void:
	for m in building_materials:
		m.set_shader_parameter("night", amount)
	glass_material.emission_energy_multiplier = amount * 0.9
	lamp_material.emission_energy_multiplier = 0.2 + amount * 4.0


static func flat_material(c: Color, unshaded := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.85
	if unshaded:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if c.a < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


# ---------------------------------------------------------------- Pack-Meshes

static var _mesh_cache := {}

static func mesh_parts(path: String) -> Array:
	## Liefert alle Meshes eines importierten FBX samt Transform relativ zur Wurzel.
	if _mesh_cache.has(path):
		return _mesh_cache[path]
	var parts: Array = []
	var inst: Node = load(path).instantiate()
	_collect_meshes(inst, Transform3D.IDENTITY, parts)
	inst.free()
	_mesh_cache[path] = parts
	return parts


static func _collect_meshes(n: Node, xf: Transform3D, out: Array) -> void:
	var t := xf
	if n is Node3D:
		t = xf * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out.append([(n as MeshInstance3D).mesh, t])
	for c in n.get_children():
		_collect_meshes(c, t, out)


func _prop(file: String, xf: Transform3D) -> void:
	var path := PACK + file + ".fbx"
	if not _multimesh_xforms.has(path):
		_multimesh_xforms[path] = []
	_multimesh_xforms[path].append(xf)


func _flush_multimeshes() -> void:
	for path in _multimesh_xforms:
		var xforms: Array = _multimesh_xforms[path]
		for part in mesh_parts(path):
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = part[0]
			mm.instance_count = xforms.size()
			for k in xforms.size():
				mm.set_instance_transform(k, xforms[k] * part[1])
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.name = path.get_file().get_basename()
			add_child(mmi)
	_multimesh_xforms.clear()


# ---------------------------------------------------------------- Boden & Straßen

func _build_ground() -> void:
	# Die Stadt ist eine Insel: Kaimauer-Sockel im Wasser
	var water := MeshInstance3D.new()
	var wm := PlaneMesh.new()
	wm.size = Vector2(2000, 2000)
	water.mesh = wm
	water.position.y = -1.2
	var water_mat := flat_material(Color(0.1, 0.2, 0.27))
	water_mat.roughness = 0.15
	water_mat.metallic = 0.3
	water.material_override = water_mat
	water.name = "Water"
	add_child(water)
	var ground := MeshInstance3D.new()
	var gb := BoxMesh.new()
	gb.size = Vector3(N * TILE + 8, 3.0, N * TILE + 8)
	ground.mesh = gb
	ground.position.y = -1.53
	ground.material_override = flat_material(Color(0.32, 0.31, 0.3))
	ground.name = "Ground"
	add_child(ground)
	var floor_shape := CollisionShape3D.new()
	floor_shape.shape = WorldBoundaryShape3D.new()
	_world_body.add_child(floor_shape)
	# unsichtbare Stadtgrenze
	for k in 4:
		var wall := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(N * TILE + 4, 20, 2) if k < 2 else Vector3(2, 20, N * TILE + 4)
		wall.shape = box
		var off := HALF + 1.0
		wall.position = [Vector3(0, 10, -off), Vector3(0, 10, off), Vector3(-off, 10, 0), Vector3(off, 10, 0)][k]
		_world_body.add_child(wall)


func _build_gridmap() -> void:
	var lib := MeshLibrary.new()
	var files := ["Environments/Road_01", "Environments/Road_02", "Environments/Sidewalk_01",
		"Environments/Sidewalk_02", "Environments/Sidewalk_Corner_01"]
	for id in files.size():
		var part: Array = mesh_parts(PACK + files[id] + ".fbx")[0]
		lib.create_item(id)
		lib.set_item_name(id, files[id].get_file())
		lib.set_item_mesh(id, part[0])
		lib.set_item_mesh_transform(id, part[1])
	var gm := GridMap.new()
	gm.name = "Streets"
	gm.mesh_library = lib
	gm.cell_size = Vector3(TILE, 1.0, TILE)
	gm.cell_center_y = false
	gm.collision_layer = 0
	gm.collision_mask = 0
	gm.position = Vector3(-HALF, 0, -HALF)
	add_child(gm)
	for j in N:
		for i in N:
			var a := i % P
			var b := j % P
			var road_x := a < 2
			var road_z := b < 2
			var item := -1
			var deg := 0.0
			if road_x and road_z:
				item = ROAD_PLAIN
			elif road_x:
				item = ROAD_LANE
				deg = 0.0 if a == 0 else 180.0
			elif road_z:
				item = ROAD_LANE
				deg = -90.0 if b == 0 else 90.0
			elif (a == 2 or a == 9) and (b == 2 or b == 9):
				item = SIDEWALK_CORNER
				if a == 2 and b == 2: deg = 0.0
				elif a == 9 and b == 2: deg = -90.0
				elif a == 9 and b == 9: deg = 180.0
				else: deg = 90.0
			elif a == 2 or a == 9 or b == 2 or b == 9:
				item = SIDEWALK_EDGE
				if a == 2: deg = 0.0
				elif a == 9: deg = 180.0
				elif b == 2: deg = -90.0
				else: deg = 90.0
			if item >= 0:
				var orient := gm.get_orthogonal_index_from_basis(Basis(Vector3.UP, deg_to_rad(deg)))
				gm.set_cell_item(Vector3i(i, 0, j), item, orient)


func _build_crosswalks() -> void:
	var xforms: Array = []
	for j in N:
		for i in N:
			var a := i % P
			var b := j % P
			var c := tile_center(i, j)
			if a < 2 and (b == 2 or b == 9):
				for k in 3:
					xforms.append(Transform3D(Basis.IDENTITY, c + Vector3(-1.0 + k, 0.012, 0)))
			elif b < 2 and (a == 2 or a == 9):
				for k in 3:
					xforms.append(Transform3D(Basis(Vector3.UP, PI * 0.5), c + Vector3(0, 0.012, -1.0 + k)))
	var box := BoxMesh.new()
	box.size = Vector3(0.45, 0.01, 2.3)
	box.material = flat_material(Color(0.86, 0.86, 0.82))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = box
	mm.instance_count = xforms.size()
	for k in xforms.size():
		mm.set_instance_transform(k, xforms[k])
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "Crosswalks"
	mmi.multimesh = mm
	add_child(mmi)


# ---------------------------------------------------------------- Blöcke

func _block_district(bx: int, bz: int) -> int:
	return (0 if bx < BLOCKS / 2 else 1) + (0 if bz >= BLOCKS / 2 else 2)


func _build_block(bx: int, bz: int) -> void:
	var cell := Vector2i(bx, bz)
	var district := _block_district(bx, bz)
	var outer := Vector3((bx * P + 2) * TILE - HALF, 0, (bz * P + 2) * TILE - HALF)
	# Gehweg-Plateau als Kollision (12 cm Bordstein – die Kapsel rutscht darüber)
	_add_box_collider(outer + Vector3(12, 0.06, 12), Vector3(24, 0.12, 24))
	var x0 := outer.x + TILE
	var z0 := outer.z + TILE
	if cell in PARKS:
		_build_park(x0, z0)
		return
	# Parzellen
	var lots: Array = []
	match _rng.randi() % 3:
		0:
			for q in 4:
				lots.append(Rect2(x0 + (q % 2) * 9.0, z0 + (q / 2) * 9.0, 9, 9))
		1:
			lots.append(Rect2(x0, z0, 9, 18))
			lots.append(Rect2(x0 + 9, z0, 9, 18))
		_:
			lots.append(Rect2(x0, z0, 18, 9))
			lots.append(Rect2(x0, z0 + 9, 9, 9))
			lots.append(Rect2(x0 + 9, z0 + 9, 9, 9))
	var special := ""
	if cell == POLICE_BLOCK:
		special = "police"
	elif cell == GUNS_BLOCK:
		special = "guns"
	var order := range(lots.size())
	_shuffle(order)
	var shop_lots := {}
	var shops := 1 if district == 2 else 2
	if special != "":
		shop_lots[order[0]] = special
		shops -= 1
	for k in range(1 if special != "" else 0, mini(order.size(), (1 if special != "" else 0) + shops)):
		shop_lots[order[k]] = "shop"
	for li in lots.size():
		var r: Rect2 = lots[li]
		var hr: Vector2i = Catalog.DISTRICTS[district].height
		var floors := _rng.randi_range(hr.x, hr.y)
		if special != "" and shop_lots.get(li, "") == special:
			floors = 3
		var h := floors * 3.2 + 0.8
		var mat: ShaderMaterial = building_materials[_rng.randi() % building_materials.size()]
		_add_building(r, h, mat)
		if shop_lots.has(li):
			var faces := _exterior_faces(r, x0, z0)
			var face: Dictionary = faces[_rng.randi() % faces.size()]
			_add_storefront(face, district, shop_lots[li])


func _exterior_faces(r: Rect2, x0: float, z0: float) -> Array:
	var faces: Array = []
	var cx := r.position.x + r.size.x * 0.5
	var cz := r.position.y + r.size.y * 0.5
	if is_equal_approx(r.position.x, x0):
		faces.append({"center": Vector3(r.position.x, 0, cz), "normal": Vector3.LEFT, "len": r.size.y})
	if is_equal_approx(r.end.x, x0 + 18.0):
		faces.append({"center": Vector3(r.end.x, 0, cz), "normal": Vector3.RIGHT, "len": r.size.y})
	if is_equal_approx(r.position.y, z0):
		faces.append({"center": Vector3(cx, 0, r.position.y), "normal": Vector3.FORWARD, "len": r.size.x})
	if is_equal_approx(r.end.y, z0 + 18.0):
		faces.append({"center": Vector3(cx, 0, r.end.y), "normal": Vector3.BACK, "len": r.size.x})
	return faces


func _add_building(r: Rect2, h: float, mat: ShaderMaterial) -> void:
	var inset := 0.15
	var size := Vector3(r.size.x - inset * 2, h, r.size.y - inset * 2)
	var center := Vector3(r.position.x + r.size.x * 0.5, h * 0.5, r.position.y + r.size.y * 0.5)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = center
	add_child(mi)
	_add_box_collider(center, size)
	# Gesims
	var trim := MeshInstance3D.new()
	var tm := BoxMesh.new()
	tm.size = Vector3(size.x + 0.3, 0.45, size.z + 0.3)
	trim.mesh = tm
	trim.material_override = flat_material((mat.get_shader_parameter("trim_color") as Color) * 0.85)
	trim.position = Vector3(center.x, h - 0.1, center.z)
	add_child(trim)
	# Dachaufbauten: Klimageräte und hin und wieder ein New-York-Wassertank
	var roof := flat_material(Color(0.35, 0.36, 0.38))
	for k in _rng.randi_range(1, 3):
		var ac := MeshInstance3D.new()
		var am := BoxMesh.new()
		am.size = Vector3(_rng.randf_range(1.0, 2.2), _rng.randf_range(0.6, 1.2), _rng.randf_range(1.0, 2.2))
		ac.mesh = am
		ac.material_override = roof
		ac.position = Vector3(center.x + _rng.randf_range(-2.5, 2.5), h + am.size.y * 0.5, center.z + _rng.randf_range(-2.5, 2.5))
		add_child(ac)
	if _rng.randf() < 0.3 and h > 10.0:
		var wood := flat_material(Color(0.42, 0.3, 0.2))
		var tank := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 1.3
		cyl.bottom_radius = 1.3
		cyl.height = 2.4
		cyl.radial_segments = 10
		tank.mesh = cyl
		tank.material_override = wood
		var tp := Vector3(center.x + _rng.randf_range(-2, 2), h + 2.6, center.z + _rng.randf_range(-2, 2))
		tank.position = tp
		add_child(tank)
		var cap := MeshInstance3D.new()
		var cone := CylinderMesh.new()
		cone.top_radius = 0.05
		cone.bottom_radius = 1.45
		cone.height = 0.9
		cone.radial_segments = 10
		cap.mesh = cone
		cap.material_override = flat_material(Color(0.25, 0.25, 0.27))
		cap.position = tp + Vector3(0, 1.65, 0)
		add_child(cap)
		for q in 4:
			var leg := MeshInstance3D.new()
			var lm := BoxMesh.new()
			lm.size = Vector3(0.15, 1.4, 0.15)
			leg.mesh = lm
			leg.material_override = roof
			leg.position = tp + Vector3((q % 2 - 0.5) * 1.8, -1.9, (q / 2 - 0.5) * 1.8)
			add_child(leg)


func _add_box_collider(center: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	cs.shape = box
	cs.position = center
	_world_body.add_child(cs)


func _add_storefront(face: Dictionary, district: int, kind: String) -> void:
	var n: Vector3 = face.normal
	var along := Vector3(-n.z, 0, n.x)
	var slide := 0.0
	if face.len > 10.0:
		slide = [-4.5, 4.5][_rng.randi() % 2]
	var base: Vector3 = face.center + along * slide
	var door: Vector3 = base + n * 1.7 + Vector3(0, 0.13, 0)
	var type_id := ""
	var name := ""
	var color := Color.WHITE
	if kind == "police":
		name = "Polizeirevier 7"
		color = Color(0.12, 0.2, 0.45)
	elif kind == "guns":
		name = "Sal's Sport & Waffen"
		color = Color(0.25, 0.3, 0.2)
	else:
		var keys: Array = Catalog.BUSINESS_TYPES.keys()
		type_id = keys[_rng.randi() % keys.size()]
		var t: Dictionary = Catalog.BUSINESS_TYPES[type_id]
		name = (t.names[_rng.randi() % t.names.size()] as String) % Catalog.SURNAMES[_rng.randi() % Catalog.SURNAMES.size()]
		color = t.color
	var root := Node3D.new()
	root.name = "Shop_" + name.validate_node_name()
	add_child(root)
	# Schaufenster
	var glass := MeshInstance3D.new()
	var gm := BoxMesh.new()
	gm.size = Vector3(6.2, 2.6, 0.08)
	glass.mesh = gm
	glass.material_override = glass_material
	_place_facing(glass, base + n * 0.12 + Vector3(0, 1.55, 0), n)
	root.add_child(glass)
	var frame := MeshInstance3D.new()
	var fm := BoxMesh.new()
	fm.size = Vector3(6.6, 0.25, 0.14)
	frame.mesh = fm
	frame.material_override = flat_material(Color(0.12, 0.12, 0.12))
	_place_facing(frame, base + n * 0.14 + Vector3(0, 2.9, 0), n)
	root.add_child(frame)
	var door_mi := MeshInstance3D.new()
	var dm := BoxMesh.new()
	dm.size = Vector3(1.3, 2.3, 0.1)
	door_mi.mesh = dm
	door_mi.material_override = flat_material(Color(0.2, 0.13, 0.08))
	_place_facing(door_mi, base + n * 0.18 + Vector3(0, 1.3, 0), n)
	root.add_child(door_mi)
	# Markise in Branchenfarbe
	var awning := MeshInstance3D.new()
	var am := BoxMesh.new()
	am.size = Vector3(6.8, 0.12, 1.5)
	awning.mesh = am
	awning.material_override = flat_material(color)
	_place_facing(awning, base + n * 0.75 + Vector3(0, 3.25, 0), n)
	awning.rotate_object_local(Vector3.RIGHT, deg_to_rad(14))
	root.add_child(awning)
	# Schild
	var sign := Label3D.new()
	sign.text = name
	sign.font_size = 72
	sign.pixel_size = 0.006
	sign.outline_size = 12
	sign.modulate = Color(1, 0.95, 0.85)
	sign.outline_modulate = Color(0, 0, 0, 0.8)
	_place_facing(sign, base + n * 0.2 + Vector3(0, 3.85, 0), n)
	root.add_child(sign)
	# Eingangsmarker auf dem Gehweg
	var ring := MeshInstance3D.new()
	var tor := TorusMesh.new()
	tor.inner_radius = 0.75
	tor.outer_radius = 0.95
	tor.rings = 24
	ring.mesh = tor
	ring.scale = Vector3(1, 0.15, 1)
	var ring_mat := flat_material(Color(1, 1, 1, 0.9), true)
	ring.material_override = ring_mat
	ring.position = door
	root.add_child(ring)
	_reserved[_tile_of(door)] = true
	var entry := {"name": name, "pos": door, "normal": n, "district": district,
		"street": location_text(door)}
	if kind == "shop":
		entry["id"] = businesses.size()
		entry["type"] = type_id
		businesses.append(entry)
		storefront_nodes[entry.id] = {"ring": ring, "ring_mat": ring_mat}
	else:
		entry["id"] = "poi_" + kind
		entry["kind"] = kind
		pois.append(entry)
		ring_mat.albedo_color = Color(0.3, 0.6, 1.0) if kind == "police" else Color(1.0, 0.4, 0.2)
		if kind == "police":
			_park_police_car(door + n * 2.6, along)


func _park_police_car(pos: Vector3, along: Vector3) -> void:
	var car: Node3D = load(PACK + "Vehicles/PoliceCar_01.fbx").instantiate()
	add_child(car)
	car.position = Vector3(pos.x, 1.06, pos.z)
	car.basis = Basis.looking_at(-along)
	_add_box_collider(Vector3(pos.x, 0.8, pos.z), Vector3(2.0, 1.6, 2.0) + along.abs() * 3.0)


func _place_facing(n3: Node3D, pos: Vector3, normal: Vector3) -> void:
	## Richtet +Z des Knotens entlang der Fassadennormalen aus (Label3D/Box schauen zur Straße).
	n3.position = pos
	n3.basis = Basis.looking_at(-normal, Vector3.UP)


func _tile_of(p: Vector3) -> Vector2i:
	return Vector2i(floori((p.x + HALF) / TILE), floori((p.z + HALF) / TILE))


func _shuffle(arr: Array) -> void:
	for k in range(arr.size() - 1, 0, -1):
		var r := _rng.randi() % (k + 1)
		var tmp = arr[k]
		arr[k] = arr[r]
		arr[r] = tmp


# ---------------------------------------------------------------- Parks

func _build_park(x0: float, z0: float) -> void:
	var grass := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(18, 18)
	grass.mesh = pm
	grass.material_override = flat_material(Color(0.16, 0.28, 0.11))
	grass.position = Vector3(x0 + 9, 0.125, z0 + 9)
	add_child(grass)
	var path_mat := flat_material(Color(0.62, 0.6, 0.55))
	for k in 2:
		var path := MeshInstance3D.new()
		var ppm := PlaneMesh.new()
		ppm.size = Vector2(18, 2.2) if k == 0 else Vector2(2.2, 18)
		path.mesh = ppm
		path.material_override = path_mat
		path.position = Vector3(x0 + 9, 0.135, z0 + 9)
		add_child(path)
	var trunk_mat := flat_material(Color(0.33, 0.22, 0.14))
	var leaf_mats := [flat_material(Color(0.2, 0.45, 0.18)), flat_material(Color(0.3, 0.52, 0.2)), flat_material(Color(0.18, 0.38, 0.22))]
	for k in 10:
		var p := Vector3(x0 + _rng.randf_range(1.5, 16.5), 0.12, z0 + _rng.randf_range(1.5, 16.5))
		if absf(p.x - x0 - 9) < 2.2 or absf(p.z - z0 - 9) < 2.2:
			continue
		var s := _rng.randf_range(0.8, 1.3)
		var trunk := MeshInstance3D.new()
		var tc := CylinderMesh.new()
		tc.top_radius = 0.15 * s
		tc.bottom_radius = 0.22 * s
		tc.height = 2.6 * s
		tc.radial_segments = 6
		trunk.mesh = tc
		trunk.material_override = trunk_mat
		trunk.position = p + Vector3(0, tc.height * 0.5, 0)
		add_child(trunk)
		var crown := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 1.6 * s
		sm.height = 2.8 * s
		sm.radial_segments = 8
		sm.rings = 4
		crown.mesh = sm
		crown.material_override = leaf_mats[k % leaf_mats.size()]
		crown.position = p + Vector3(0, tc.height + 0.9 * s, 0)
		add_child(crown)
		_add_box_collider(p + Vector3(0, 1.2, 0), Vector3(0.45, 2.4, 0.45))
		_prop("Environments/Leaves_0%d" % (1 + k % 3), Transform3D(Basis(Vector3.UP, _rng.randf() * TAU), p + Vector3(0, 0.02, 0)))
	for k in 4:
		var dir: Vector3 = [Vector3.RIGHT, Vector3.LEFT, Vector3.BACK, Vector3.FORWARD][k]
		var bp := Vector3(x0 + 9, 0.12 + 0.49, z0 + 9) + dir * 5.0 + Vector3(dir.z, 0, dir.x) * 1.7
		_prop("Props/Bench_01", Transform3D(Basis.looking_at(Vector3(dir.z, 0, dir.x)), bp))
		_prop("Props/TrashCan_01", Transform3D(Basis.IDENTITY, bp + dir * 1.6 + Vector3(0, -0.09, 0)))


# ---------------------------------------------------------------- Straßenmöbel

func _build_street_props() -> void:
	for j in N:
		for i in N:
			var a := i % P
			var b := j % P
			var c := tile_center(i, j)
			if a < 2 or b < 2:
				# Kanaldeckel auf den Fahrspuren
				if (a < 2) != (b < 2) and _rng.randf() < 0.04:
					_prop("Props/Manhole_01", Transform3D(Basis.IDENTITY, c + Vector3(0, 0.02, 0)))
				continue
			var ring := a == 2 or a == 9 or b == 2 or b == 9
			if not ring:
				continue
			var corner := (a == 2 or a == 9) and (b == 2 or b == 9)
			var t := Vector2i(i, j)
			if corner:
				if _rng.randf() < 0.5:
					var road_dir := Vector3(-1 if a == 2 else 1, 0, -1 if b == 2 else 1)
					_prop("Props/Hydrant_01", Transform3D(Basis.IDENTITY, c + road_dir * 0.9 + Vector3(0, 0.12, 0)))
				continue
			var out := Vector3.ZERO
			if a == 2: out = Vector3.LEFT
			elif a == 9: out = Vector3.RIGHT
			elif b == 2: out = Vector3.FORWARD
			else: out = Vector3.BACK
			var along := Vector3(-out.z, 0, out.x)
			var curb := c + out * 1.15 + Vector3(0, 0.12, 0)
			var idx := (i + j)
			if idx % 3 == 0 and not _reserved.has(t):
				# Laternenarm (+X im Modell) zeigt zur Fahrbahn
				_prop("Props/Light_Pole_01", Transform3D(Basis(Vector3.UP, atan2(-out.z, out.x)), curb))
				var bulb_pos := curb + out * 2.35 + Vector3(0, 5.55, 0)
				_add_lamp_glow(bulb_pos)
				continue
			if _reserved.has(t):
				continue
			var r := _rng.randf()
			if r < 0.06:
				_prop("Props/TrashCan_01", Transform3D(Basis.IDENTITY, curb + along * 0.6 + Vector3(0, 0.4, 0)))
			elif r < 0.1:
				_prop("Props/Mailbox_01", Transform3D(Basis.looking_at(-out), curb + Vector3(0, 0.5, 0)))
			elif r < 0.14:
				_prop("Props/Bench_01", Transform3D(Basis.looking_at(out), c - out * 0.3 + Vector3(0, 0.61, 0)))
			elif r < 0.19:
				_prop("Props/Newspaper_01", Transform3D(Basis(Vector3.UP, _rng.randf() * TAU), c + Vector3(_rng.randf_range(-1, 1), 0.14, _rng.randf_range(-1, 1))))
			elif r < 0.24:
				_prop("Props/Paper_0%d" % _rng.randi_range(1, 2), Transform3D(Basis(Vector3.UP, _rng.randf() * TAU), c + Vector3(_rng.randf_range(-1, 1), 0.13, _rng.randf_range(-1, 1))))
			elif r < 0.27:
				_prop("Environments/Leaves_0%d" % _rng.randi_range(1, 3), Transform3D(Basis(Vector3.UP, _rng.randf() * TAU), c + Vector3(0, 0.13, 0)))
			if r > 0.97 and spawn_points.size() < 24:
				spawn_points.append(c + Vector3(0, 0.3, 0))


func _add_lamp_glow(pos: Vector3) -> void:
	var glow := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.16
	sm.height = 0.32
	sm.radial_segments = 8
	sm.rings = 4
	glow.mesh = sm
	glow.material_override = lamp_material
	glow.position = pos
	add_child(glow)


# ---------------------------------------------------------------- Kartenebene

func _build_map_layer() -> void:
	var qsize := N * TILE * 0.5
	for d in 4:
		var overlay := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(qsize, qsize)
		overlay.mesh = pm
		var c: Color = Catalog.DISTRICTS[d].color
		var m := flat_material(Color(c.r, c.g, c.b, 0.3), true)
		m.no_depth_test = true
		m.render_priority = -1
		overlay.material_override = m
		overlay.position = Vector3((-0.5 if d % 2 == 0 else 0.5) * qsize, 0.5, (0.5 if d < 2 else -0.5) * qsize)
		map_layer.add_child(overlay)
		district_overlays.append(overlay)
		var title := _flat_label(Catalog.DISTRICTS[d].name.to_upper(), 110)
		title.modulate = Color(1, 1, 1, 0.85)
		title.position = Vector3(0, 0.7, 0)
		overlay.add_child(title)
	for ix in BLOCKS + 1:
		for k in [1, 4]:
			var lbl := _flat_label(avenue_name(ix).to_upper(), 64)
			lbl.position = node_pos(ix, 0) + Vector3(0, 0.8, (k + 0.5) * P * TILE)
			lbl.rotate_y(PI * 0.5)
			map_layer.add_child(lbl)
			street_labels.append(lbl)
	for iz in BLOCKS + 1:
		for k in [1, 4]:
			var lbl := _flat_label(street_name(iz).to_upper(), 64)
			lbl.position = node_pos(0, iz) + Vector3((k + 0.5) * P * TILE, 0.8, 0)
			map_layer.add_child(lbl)
			street_labels.append(lbl)
	for b in businesses:
		pins[b.id] = _make_pin(b.pos, Catalog.BUSINESS_TYPES[b.type].icon)
	for p in pois:
		var pin := _make_pin(p.pos, "POL" if p.kind == "police" else "WAF")
		(pin.get_meta("head_mat") as StandardMaterial3D).albedo_color = Color(0.2, 0.45, 0.95) if p.kind == "police" else Color(0.95, 0.4, 0.15)
		pins[p.id] = pin


func _flat_label(text: String, size: int) -> Label3D:
	var lbl := Label3D.new()
	lbl.text = text
	lbl.font_size = size
	lbl.pixel_size = 0.05
	lbl.outline_size = 0
	lbl.modulate = Color(1, 1, 1, 0.55)
	lbl.no_depth_test = true
	lbl.render_priority = 1
	lbl.rotation.x = -PI * 0.5
	return lbl


func _make_pin(pos: Vector3, icon: String) -> Node3D:
	var pin := Node3D.new()
	pin.position = pos
	map_layer.add_child(pin)
	var head_mat := flat_material(Color.WHITE, true)
	head_mat.no_depth_test = true
	head_mat.render_priority = 2
	var stick := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.5
	cm.bottom_radius = 0.05
	cm.height = 7.0
	cm.radial_segments = 6
	stick.mesh = cm
	stick.material_override = head_mat
	stick.position.y = 3.5
	pin.add_child(stick)
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 3.0
	sm.height = 6.0
	sm.radial_segments = 12
	sm.rings = 6
	head.mesh = sm
	head.material_override = head_mat
	head.position.y = 9.5
	pin.add_child(head)
	var lbl := Label3D.new()
	lbl.text = icon
	lbl.font_size = 96
	lbl.pixel_size = 0.03
	lbl.outline_size = 16
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.no_depth_test = true
	lbl.render_priority = 3
	lbl.position.y = 9.5
	pin.add_child(lbl)
	pin.set_meta("head_mat", head_mat)
	pin.set_meta("label", lbl)
	return pin
