class_name CharacterRig
extends Node3D
## Die Figuren im Pack sind statische T-Posen ohne Skelett. Beim Laden wird das Mesh in
## Körper + linken + rechten Arm zerlegt (Dreiecke seitlich der Schultern), die Arme hängen
## an Schulter-Pivots. Damit lassen sich Arme senken, beim Gehen schwingen und zum Zielen heben.

const SHOULDER_X := 0.2
const SHOULDER_Y := 1.35
const ARM_Y_MIN := 1.12
const ARM_Y_MAX := 1.56
const HANG := deg_to_rad(74.0)

static var _cache := {}

var _model: Node3D
var _left: Node3D
var _right: Node3D
var _gun_holder: Node3D
var _phase := 0.0
var _aim_blend := 0.0
var _weapon := ""


func setup(skin: String) -> void:
	var parts := _split(skin)
	_model = Node3D.new()
	_model.rotation.y = PI          # Pack-Modelle schauen nach +Z, Godot-Vorwärts ist -Z
	add_child(_model)
	var body := MeshInstance3D.new()
	body.mesh = parts.body
	_model.add_child(body)
	_left = _make_arm(parts.left, Vector3(SHOULDER_X, SHOULDER_Y, 0))
	_right = _make_arm(parts.right, Vector3(-SHOULDER_X, SHOULDER_Y, 0))
	_gun_holder = Node3D.new()
	_gun_holder.position = Vector3(-0.66, -0.02, 0.0)
	_gun_holder.rotation.y = -PI * 0.5   # Lauf (+Z der Waffe) zeigt entlang des Arms (-X)
	_right.add_child(_gun_holder)
	animate(0.0, 0.0, false)


func _make_arm(mesh: ArrayMesh, pivot: Vector3) -> Node3D:
	var p := Node3D.new()
	p.position = pivot
	_model.add_child(p)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = -pivot
	p.add_child(mi)
	return p


func set_weapon(id: String) -> void:
	if id == _weapon:
		return
	_weapon = id
	for c in _gun_holder.get_children():
		c.queue_free()
	if id == "" or not Catalog.WEAPONS.has(id):
		return
	var gun: Node3D = load("res://assets/mafia_pack/Weapons/%s.fbx" % Catalog.WEAPONS[id].model).instantiate()
	_gun_holder.add_child(gun)


func animate(delta: float, speed: float, aiming: bool) -> void:
	## speed in m/s – steuert Schrittfrequenz und Armschwung.
	var moving := clampf(speed / 5.0, 0.0, 1.6)
	_phase += delta * (4.0 + speed * 1.4) * (1.0 if speed > 0.2 else 0.0)
	var swing := sin(_phase) * 0.55 * minf(moving, 1.0)
	_aim_blend = move_toward(_aim_blend, 1.0 if aiming else 0.0, delta * 8.0)
	_left.basis = Basis(Vector3.RIGHT, swing) * Basis(Vector3.BACK, -HANG)
	var hang_r := Quaternion(Basis(Vector3.RIGHT, -swing) * Basis(Vector3.BACK, HANG))
	var aim_r := Quaternion(Basis(Vector3.UP, PI * 0.5 - 0.12))
	_right.basis = Basis(hang_r.slerp(aim_r, _aim_blend))
	_model.position.y = absf(sin(_phase)) * 0.06 * minf(moving, 1.0)
	_model.rotation.z = sin(_phase) * 0.03 * minf(moving, 1.0)


static func _split(skin: String) -> Dictionary:
	if _cache.has(skin):
		return _cache[skin]
	var src: Array = CityBuilder.mesh_parts("res://assets/mafia_pack/Characters/%s.fbx" % skin)[0]
	var mesh: Mesh = src[0]
	var arrays := mesh.surface_get_arrays(0)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	if idx.is_empty():
		idx.resize(verts.size())
		for k in verts.size():
			idx[k] = k
	var body := PackedInt32Array()
	var left := PackedInt32Array()
	var right := PackedInt32Array()
	for t in range(0, idx.size(), 3):
		var side := 0
		for q in 3:
			var v := verts[idx[t + q]]
			var s := 0
			if v.y > ARM_Y_MIN and v.y < ARM_Y_MAX:
				if v.x > SHOULDER_X: s = 1
				elif v.x < -SHOULDER_X: s = -1
			if q == 0:
				side = s
			elif s != side:
				side = 0
		if side == 1:
			left.append_array([idx[t], idx[t + 1], idx[t + 2]])
		elif side == -1:
			right.append_array([idx[t], idx[t + 1], idx[t + 2]])
		else:
			body.append_array([idx[t], idx[t + 1], idx[t + 2]])
	var mat := mesh.surface_get_material(0)
	var out := {}
	for key in ["body", "left", "right"]:
		var a := arrays.duplicate()
		for c in [Mesh.ARRAY_CUSTOM0, Mesh.ARRAY_CUSTOM1, Mesh.ARRAY_CUSTOM2, Mesh.ARRAY_CUSTOM3]:
			a[c] = null   # Zusatzkanäle aus dem FBX-Import bräuchten eigene Format-Flags; ungenutzt
		a[Mesh.ARRAY_INDEX] = {"body": body, "left": left, "right": right}[key]
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		am.surface_set_material(0, mat)
		out[key] = am
	_cache[skin] = out
	return out
