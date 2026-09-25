extends Node3D
## Die Spielwelt. Wird vom Server instanziiert und per MultiplayerSpawner (in main.gd) an alle
## Clients repliziert. Enthält Stadt, Spieler-/Geld-Spawner, Kampf-RPCs und den Tag-Nacht-Zyklus.

var city: CityBuilder
var players: Node3D
var drops: Node3D
var player_spawner: MultiplayerSpawner
var drop_spawner: MultiplayerSpawner
var camera_rig: CameraRig
var hud: Node
var traffic: Traffic
var local_player: Player

var _sun: DirectionalLight3D
var _env: Environment
var _sky: ProceduralSkyMaterial
var _last_shot := {}      # Server: pid -> Zeitstempel (Feuerraten-Prüfung)
var _drop_seq := 0
var rooms := {}           # biz id -> Innenraum (lazy gebaut)
var interiors_root: Node3D


func _ready() -> void:
	city = CityBuilder.new()
	city.name = "City"
	add_child(city)
	city.build()
	GameState.businesses = city.businesses
	GameState.pois = city.pois
	GameState.world = self

	interiors_root = Node3D.new()
	interiors_root.name = "Interiors"
	add_child(interiors_root)
	var void_floor := MeshInstance3D.new()
	var vm := PlaneMesh.new()
	vm.size = Vector2(Interiors.SPACING * 10, Interiors.SPACING * 10)
	void_floor.mesh = vm
	void_floor.material_override = CityBuilder.flat_material(Color(0.03, 0.03, 0.04))
	void_floor.position = Vector3(Interiors.ZONE_X + Interiors.SPACING * 3.5, -0.3, Interiors.ZONE_Z + Interiors.SPACING * 3.5)
	interiors_root.add_child(void_floor)

	players = Node3D.new()
	players.name = "Players"
	add_child(players)
	drops = Node3D.new()
	drops.name = "Drops"
	add_child(drops)
	player_spawner = MultiplayerSpawner.new()
	player_spawner.name = "PlayerSpawner"
	player_spawner.spawn_path = NodePath("../Players")
	player_spawner.spawn_function = _spawn_player_node
	add_child(player_spawner)
	drop_spawner = MultiplayerSpawner.new()
	drop_spawner.name = "DropSpawner"
	drop_spawner.spawn_path = NodePath("../Drops")
	drop_spawner.spawn_function = _spawn_drop_node
	add_child(drop_spawner)

	if DisplayServer.get_name() != "headless":
		_setup_environment()
		traffic = Traffic.new()
		traffic.name = "Traffic"
		traffic.players_root = players
		add_child(traffic)
		camera_rig = CameraRig.new()
		camera_rig.name = "CameraRig"
		add_child(camera_rig)
		hud = load("res://scripts/ui/hud.gd").new()
		hud.name = "HUD"
		add_child(hud)
		hud.setup(self)
		GameState.state_changed.connect(_refresh_markers)

	if multiplayer.is_server():
		GameState.server_setup()
		Net.world_ready()


# ============================================================ Spieler

func spawn_player(pid: int, p: Dictionary) -> void:
	var pts: Array = city.spawn_points
	var pos: Vector3 = pts[randi() % pts.size()] if not pts.is_empty() else Vector3(0, 1, 0)
	player_spawner.spawn({"id": pid, "name": p.name, "skin": p.skin,
		"color": Catalog.PLAYER_COLORS[p.color % Catalog.PLAYER_COLORS.size()], "pos": pos})


func despawn_player(pid: int) -> void:
	var n := players.get_node_or_null(str(pid))
	if n:
		n.queue_free()


func _spawn_player_node(data: Variant) -> Node:
	var p := Player.create(data)
	if multiplayer.get_unique_id() == int(data.id):
		p.ready.connect(_on_local_player_ready.bind(p), CONNECT_ONE_SHOT)
	return p


func _on_local_player_ready(p: Player) -> void:
	local_player = p
	if camera_rig:
		camera_rig.target = p
		camera_rig.snap()
		p.camera_rig = camera_rig
	if hud:
		hud.set_local_player(p)


# ============================================================ Innenräume

func ensure_room(id: int) -> Node3D:
	if not rooms.has(id):
		var b: Dictionary = GameState.businesses[id]
		rooms[id] = Interiors.build(id, b.type, b.name, interiors_root)
		city.building_materials.append_array(Interiors.wall_materials)
		Interiors.wall_materials.clear()
	var d: Dictionary = GameState.biz_dyn(id)
	Interiors.set_backroom(rooms[id], d.get("op", ""))
	return rooms[id]


func enter_business(id: int) -> void:
	if local_player == null:
		return
	ensure_room(id)
	local_player.teleport(Interiors.spawn_world(id))
	local_player.look_yaw = 0.0
	if camera_rig:
		camera_rig.snap()


func exit_business(id: int) -> void:
	if local_player == null:
		return
	var b: Dictionary = GameState.businesses[id]
	local_player.teleport(b.pos + (b.normal as Vector3) * 1.2 + Vector3(0, 0.1, 0))
	if camera_rig:
		camera_rig.snap()


func player_position(pid: int) -> Variant:
	var n := players.get_node_or_null(str(pid)) as Node3D
	return n.global_position if n else null


func get_player(pid: int) -> Player:
	return players.get_node_or_null(str(pid)) as Player


# ============================================================ Kampf

func request_fire(aim: Vector3) -> void:
	if multiplayer.is_server():
		_server_fire(multiplayer.get_unique_id(), aim)
	else:
		srv_fire.rpc_id(1, aim)


@rpc("any_peer", "unreliable_ordered")
func srv_fire(aim: Vector3) -> void:
	if multiplayer.is_server():
		_server_fire(multiplayer.get_remote_sender_id(), aim)


func _server_fire(pid: int, aim: Vector3) -> void:
	var shooter := get_player(pid)
	var pdata: Dictionary = GameState.state.players.get(pid, {})
	if shooter == null or pdata.is_empty():
		return
	var w: Dictionary = Catalog.WEAPONS[pdata.weapon]
	var now := Time.get_ticks_msec() / 1000.0
	if now - float(_last_shot.get(pid, -10.0)) < w.rate * 0.75:
		return
	_last_shot[pid] = now
	var origin := shooter.global_position + Vector3(0, 1.3, 0)
	var base_dir := aim - origin
	base_dir.y = 0.0
	if base_dir.length() < 0.1:
		return
	base_dir = base_dir.normalized()
	origin += base_dir * 0.6
	var space := get_world_3d().direct_space_state
	var ends: Array = []
	for k in int(w.pellets):
		var dir := base_dir.rotated(Vector3.UP, randf_range(-w.spread, w.spread))
		var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * float(w.range), 1 | 2 | 4, [shooter.get_rid()])
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			ends.append(origin + dir * float(w.range))
			continue
		ends.append(hit.position)
		if hit.collider is Player:
			GameState.server_damage((hit.collider as Player).peer_id, pid, int(w.damage))
	GameState.state.players[pid].heat = minf(100.0, GameState.state.players[pid].heat + 0.3)
	GameState.mark_dirty()
	fx_shot.rpc(origin, ends)


@rpc("authority", "call_local", "unreliable")
func fx_shot(origin: Vector3, ends: Array) -> void:
	if DisplayServer.get_name() == "headless":
		return
	var flash := OmniLight3D.new()
	flash.light_color = Color(1.0, 0.75, 0.3)
	flash.omni_range = 5.0
	flash.light_energy = 3.0
	flash.position = origin
	add_child(flash)
	get_tree().create_timer(0.05).timeout.connect(flash.queue_free)
	for e in ends:
		var end: Vector3 = e
		var len := origin.distance_to(end)
		if len < 0.1:
			continue
		var tracer := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.04, 0.04, len)
		tracer.mesh = bm
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(1.0, 0.85, 0.4, 0.9)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		tracer.material_override = m
		add_child(tracer)
		tracer.global_transform = Transform3D(Basis.looking_at(end - origin), (origin + end) * 0.5)
		var tw := create_tween()
		tw.tween_property(m, "albedo_color:a", 0.0, 0.12)
		tw.tween_callback(tracer.queue_free)


func server_player_died(victim: int, drop: float) -> void:
	var node := get_player(victim)
	if node == null:
		return
	if drop >= 1.0:
		_drop_seq += 1
		drop_spawner.spawn({"id": _drop_seq, "pos": node.global_position + Vector3(0, 0.2, 0), "amount": drop})
	var pts: Array = city.spawn_points
	var pos: Vector3 = pts[randi() % pts.size()]
	if victim == multiplayer.get_unique_id():
		client_respawn(pos)
	else:
		client_respawn.rpc_id(victim, pos)


@rpc("authority", "reliable")
func client_respawn(pos: Vector3) -> void:
	if local_player:
		local_player.teleport(pos)


# ============================================================ Geldtaschen

func _spawn_drop_node(data: Variant) -> Node:
	var bag := Node3D.new()
	bag.name = "Drop%d" % data.id
	bag.position = data.pos
	bag.set_meta("amount", data.amount)
	var parts := CityBuilder.mesh_parts(CityBuilder.PACK + "Props/Paper_Pile_01.fbx")
	for part in parts:
		var mi := MeshInstance3D.new()
		mi.mesh = part[0]
		mi.transform = Transform3D(Basis.IDENTITY.scaled(Vector3(2.5, 3, 2.5)), Vector3.ZERO) * part[1]
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.45, 0.75, 0.4)
		mi.material_override = m
		bag.add_child(mi)
	var lbl := Label3D.new()
	lbl.text = "$ " + Catalog.money(data.amount)
	lbl.font_size = 40
	lbl.pixel_size = 0.01
	lbl.outline_size = 8
	lbl.modulate = Color(0.5, 1.0, 0.5)
	lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	lbl.position.y = 0.9
	bag.add_child(lbl)
	return bag


func _physics_process(_delta: float) -> void:
	if not multiplayer.is_server():
		return
	for bag in drops.get_children():
		for p in players.get_children():
			if (p as Node3D).global_position.distance_to((bag as Node3D).global_position) < 1.4:
				var pid := (p as Player).peer_id
				if GameState.state.players.has(pid):
					var amount: float = bag.get_meta("amount")
					GameState.state.players[pid].dirty += amount
					GameState.notify(pid, "Geldtasche aufgesammelt: +%s Schwarzgeld." % Catalog.money(amount), "good")
					GameState.mark_dirty()
					bag.queue_free()
					break


# ============================================================ Darstellung

func _setup_environment() -> void:
	_sky = ProceduralSkyMaterial.new()
	_sky.ground_bottom_color = Color(0.1, 0.18, 0.24)
	_sky.ground_horizon_color = Color(0.55, 0.62, 0.68)
	var sky := Sky.new()
	sky.sky_material = _sky
	_env = Environment.new()
	_env.background_mode = Environment.BG_SKY
	_env.sky = sky
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	_env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	_env.glow_enabled = true
	_env.glow_bloom = 0.05
	_env.ssao_enabled = true
	var we := WorldEnvironment.new()
	we.environment = _env
	add_child(we)
	_sun = DirectionalLight3D.new()
	_sun.shadow_enabled = true
	_sun.directional_shadow_max_distance = 90.0
	add_child(_sun)


func _process(_delta: float) -> void:
	if _sun == null:
		return
	var hour := fmod(GameState.state.clock / 60.0, 24.0)
	var elev := sin((hour - 6.0) / 12.0 * PI)        # >0 tagsüber
	var night := 1.0 - smoothstep(-0.12, 0.22, elev)
	var day_dir := Basis.from_euler(Vector3(-maxf(absf(elev), 0.25) * 1.1, deg_to_rad(35.0) + hour / 24.0 * TAU * 0.25, 0))
	_sun.basis = day_dir
	_sun.light_color = Color(1.0, 0.95, 0.85).lerp(Color(0.55, 0.65, 1.0), night)
	_sun.light_energy = lerpf(1.25, 0.22, night)
	_env.ambient_light_energy = lerpf(0.9, 0.35, night)
	_sky.sky_top_color = Color(0.32, 0.5, 0.78).lerp(Color(0.02, 0.03, 0.08), night)
	_sky.sky_horizon_color = Color(0.72, 0.78, 0.85).lerp(Color(0.12, 0.1, 0.18), night)
	city.set_night(night)
	if camera_rig and local_player:
		var cut := 0.0 if camera_rig.map_mode else 3.4
		city.set_cutout(local_player.global_position + Vector3(0, 1.0, 0), camera_rig.camera.global_position, cut)
	for p in players.get_children():
		var r := Interiors.room_of((p as Node3D).global_position)
		if r >= 0 and r < city.businesses.size() and not rooms.has(r):
			ensure_room(r)
	if traffic and local_player:
		traffic.set_alarm(GameState.me().get("heat", 0.0) >= 50.0)


func _refresh_markers() -> void:
	## Eingangsringe und Karten-Pins in Besitzer-/Branchenfarbe einfärben.
	var me := GameState.my_id()
	for b in city.businesses:
		var d: Dictionary = GameState.biz_dyn(b.id)
		if d.is_empty():
			continue
		var nodes: Dictionary = city.storefront_nodes[b.id]
		var who: int = d.owner if d.owner != 0 else d.ext_by
		var col: Color = GameState.owner_color(who) if who != 0 else Color(1, 1, 1)
		(nodes.ring_mat as StandardMaterial3D).albedo_color = Color(col.r, col.g, col.b, 0.95 if d.owner != 0 else 0.6)
		var pin: Node3D = city.pins[b.id]
		var head: StandardMaterial3D = pin.get_meta("head_mat")
		head.albedo_color = col if who != 0 else Catalog.BUSINESS_TYPES[b.type].color.lightened(0.2)
		var lbl: Label3D = pin.get_meta("label")
		lbl.modulate = Color.BLACK if who != 0 else Color.WHITE
		lbl.outline_modulate = Color.WHITE if who != 0 else Color.BLACK
		var cat := "free"
		if d.owner == me: cat = "mine"
		elif d.ext_by == me: cat = "extort"
		elif who != 0: cat = "rival"
		pin.set_meta("category", cat)
	for id in rooms:
		Interiors.set_backroom(rooms[id], GameState.biz_dyn(id).get("op", ""))
	if hud:
		hud.apply_map_filters()
