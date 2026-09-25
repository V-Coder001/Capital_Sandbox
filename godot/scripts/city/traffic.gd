class_name Traffic
extends Node3D
## Umgebungsverkehr auf dem Straßenraster: Autos fahren von Kreuzung zu Kreuzung (Rechtsverkehr),
## biegen zufällig ab, halten an roten Ampeln und bremsen für Autos und Spieler vor ihnen.
## Läuft lokal auf jedem Client (reine Kulisse, wird nicht synchronisiert).

const CAR_COUNT := 20
const POLICE_COUNT := 4
const LANE := 1.5
const STOP_BACK := 3.4
const CRUISE := 9.0
const TURN_SPEED := 4.5
const LIGHT_PERIOD := 14.0

var players_root: Node3D
var _cars: Array = []
var _rng := RandomNumberGenerator.new()
var _alarm := false
var _blink := 0.0


func _ready() -> void:
	_rng.randomize()
	for k in CAR_COUNT + POLICE_COUNT:
		_spawn_car(k < POLICE_COUNT)


func set_alarm(on: bool) -> void:
	_alarm = on


func _spawn_car(police: bool) -> void:
	var body := AnimatableBody3D.new()
	body.sync_to_physics = false
	body.collision_layer = 4
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.8, 1.5, 4.7)
	shape.shape = box
	shape.position.y = 0.8
	body.add_child(shape)
	var model: Node3D = load(CityBuilder.PACK + ("Vehicles/PoliceCar_01.fbx" if police else "Vehicles/Car_01.fbx")).instantiate()
	model.position.y = 1.06 if police else 1.03
	model.rotation.y = PI     # Modell-Front zeigt nach +Z
	body.add_child(model)
	var wheels: Array = []
	_find_wheels(model, wheels)
	var lights: Array = []
	if police:
		for s in 2:
			var bar := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(0.45, 0.14, 0.25)
			bar.mesh = bm
			var m := StandardMaterial3D.new()
			m.albedo_color = Color(0.9, 0.1, 0.1) if s == 0 else Color(0.1, 0.3, 1.0)
			m.emission_enabled = true
			m.emission = m.albedo_color
			m.emission_energy_multiplier = 0.0
			bar.material_override = m
			bar.position = Vector3(-0.25 + s * 0.5, 2.18, 0.1)
			body.add_child(bar)
			lights.append(m)
	add_child(body)
	var a := Vector2i(_rng.randi_range(0, CityBuilder.BLOCKS), _rng.randi_range(0, CityBuilder.BLOCKS))
	var b := _random_neighbor(a, Vector2i(-99, -99))
	var car := {"body": body, "a": a, "b": b, "pts": PackedVector3Array(), "s": _rng.randf_range(0.0, 20.0),
		"speed": 0.0, "wheels": wheels, "lights": lights, "pos": Vector3.ZERO, "fwd": Vector3.FORWARD}
	_plan(car)
	var res := _sample(car.pts, car.s)
	car.pos = res[0]
	car.fwd = res[1]
	_cars.append(car)


func _find_wheels(n: Node, out: Array) -> void:
	if n is VehicleWheel3D:
		out.append(n)
	for c in n.get_children():
		_find_wheels(c, out)


func _random_neighbor(p: Vector2i, avoid: Vector2i) -> Vector2i:
	var opts: Array = []
	for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
		var q: Vector2i = p + d
		if q.x < 0 or q.y < 0 or q.x > CityBuilder.BLOCKS or q.y > CityBuilder.BLOCKS or q == avoid:
			continue
		opts.append(q)
	return opts[_rng.randi() % opts.size()] if not opts.is_empty() else avoid


static func _dir(a: Vector2i, b: Vector2i) -> Vector3:
	return Vector3(b.x - a.x, 0, b.y - a.y)


func _plan(car: Dictionary) -> void:
	## Polyline: gerade Strecke a→b, dann Kurve (quadratische Bezier) in die Folgestrecke b→c.
	var a: Vector2i = car.a
	var b: Vector2i = car.b
	var c := _random_neighbor(b, a)
	car["c"] = c
	var d_in := _dir(a, b)
	var d_out := _dir(b, c)
	var r_in := d_in.cross(Vector3.UP) * LANE
	var r_out := d_out.cross(Vector3.UP) * LANE
	var pa := CityBuilder.node_pos(a.x, a.y)
	var pb := CityBuilder.node_pos(b.x, b.y)
	var start := pa + d_in * STOP_BACK + r_in
	var stop := pb - d_in * STOP_BACK + r_in
	var next := pb + d_out * STOP_BACK + r_out
	var ctrl := (stop + next) * 0.5 if d_in.is_equal_approx(d_out) else pb + r_in + r_out
	var pts := PackedVector3Array([start, stop])
	for k in range(1, 7):
		var t := k / 6.0
		pts.append(stop.lerp(ctrl, t).lerp(ctrl.lerp(next, t), t))
	car.pts = pts
	car["stop_s"] = start.distance_to(stop)


func _sample(pts: PackedVector3Array, s: float) -> Array:
	var acc := 0.0
	for k in pts.size() - 1:
		var seg := pts[k].distance_to(pts[k + 1])
		if acc + seg >= s:
			var t := (s - acc) / maxf(seg, 0.001)
			return [pts[k].lerp(pts[k + 1], t), (pts[k + 1] - pts[k]).normalized(), false]
		acc += seg
	return [pts[pts.size() - 1], (pts[pts.size() - 1] - pts[pts.size() - 2]).normalized(), true]


func _green_for(dir: Vector3) -> bool:
	var phase := int(Time.get_unix_time_from_system() / LIGHT_PERIOD) % 2
	return (absf(dir.x) > 0.5) == (phase == 0)


func _physics_process(delta: float) -> void:
	_blink += delta
	var player_pos: Array = []
	if players_root:
		for p in players_root.get_children():
			if p is Node3D:
				player_pos.append((p as Node3D).global_position)
	for car in _cars:
		var s: float = car.s
		var fwd: Vector3 = car.fwd
		var pos: Vector3 = car.pos
		var limit := CRUISE if s < car.stop_s - 4.0 else TURN_SPEED
		# Ampel: vor der Haltelinie stehen bleiben, wenn die eigene Achse Rot hat
		var to_stop: float = car.stop_s - s
		if to_stop > 0.2 and to_stop < 9.0 and not _green_for(_dir(car.a, car.b)):
			limit = minf(limit, maxf(0.0, (to_stop - 0.5) * 1.4))
		# Hindernisse voraus (andere Autos, Spieler)
		for other in _cars:
			if other == car:
				continue
			var rel: Vector3 = other.pos - pos
			var ahead := rel.dot(fwd)
			if ahead > 0.5 and ahead < 11.0 and (rel - fwd * ahead).length() < 1.6:
				limit = minf(limit, maxf(0.0, (ahead - 5.5) * 1.5))
		for pp in player_pos:
			var rel2: Vector3 = (pp as Vector3) - pos
			var ahead2 := rel2.dot(fwd)
			if ahead2 > 0.0 and ahead2 < 8.0 and (rel2 - fwd * ahead2).length() < 1.9 and absf(rel2.y) < 2.0:
				limit = minf(limit, maxf(0.0, (ahead2 - 3.2) * 1.5))
		var accel := 6.0 if car.speed < limit else 14.0
		car.speed = move_toward(car.speed, limit, accel * delta)
		s += car.speed * delta
		var res := _sample(car.pts, s)
		if res[2]:
			# Kurve fertig → nächste Strecke b→c
			var over := s - _polyline_len(car.pts)
			car.a = car.b
			car.b = car.c
			_plan(car)
			s = over
			res = _sample(car.pts, s)
		car.s = s
		car.pos = res[0]
		if (res[1] as Vector3).length() > 0.1:
			car.fwd = (car.fwd as Vector3).lerp(res[1], minf(1.0, delta * 10.0)).normalized()
		var body: AnimatableBody3D = car.body
		body.global_transform = Transform3D(Basis.looking_at(car.fwd), car.pos)
		for w in car.wheels:
			(w as Node3D).rotate_object_local(Vector3.RIGHT, car.speed * delta / 0.38)
		for k in car.lights.size():
			var on: bool = _alarm and int(_blink * 6.0) % 2 == k
			(car.lights[k] as StandardMaterial3D).emission_energy_multiplier = 4.0 if on else 0.0


func _polyline_len(pts: PackedVector3Array) -> float:
	var l := 0.0
	for k in pts.size() - 1:
		l += pts[k].distance_to(pts[k + 1])
	return l
