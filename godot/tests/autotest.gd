extends Node
## Rauchtest: ./godot -- --host --autotest   (oder mit --join=… gegen einen laufenden Server)
## Spielt Kaufen, Hinterzimmer, Wäsche, Schutzgeld, Karte, Panels und Schießen durch,
## speichert Screenshots nach user://autotest/ und beendet sich mit Exit-Code 0/1.

var _fails := 0
var _others := {}          # andere Spieler -> [Startposition, max. Abstand]
var _shots_dir := "user://autotest/"


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(_shots_dir)
	_run.call_deferred()


func _process(_delta: float) -> void:
	for p in _others:
		if is_instance_valid(p) and (p as Node).is_inside_tree():
			_others[p][1] = maxf(_others[p][1], (p as Player).global_position.distance_to(_others[p][0]))


func _check(cond: bool, what: String) -> void:
	print(("  OK   " if cond else "  FAIL ") + what)
	if not cond:
		_fails += 1


func _wait(sec: float) -> void:
	await get_tree().create_timer(sec).timeout


func _shot(name: String) -> void:
	if DisplayServer.get_name() == "headless":
		return
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(_shots_dir + name + ".png")
	print("  screenshot ", ProjectSettings.globalize_path(_shots_dir + name + ".png"))


func _world() -> Node:
	return GameState.world


func _run() -> void:
	print("AUTOTEST start")
	if "--menushot" in OS.get_cmdline_user_args():
		await _wait(1.0)
		await _shot("00_menu")
		get_tree().quit()
		return
	var t := 0.0
	while (_world() == null or _world().local_player == null or GameState.me().is_empty()) and t < 20.0:
		await _wait(0.25)
		t += 0.25
	_check(_world() != null and _world().local_player != null, "Welt geladen, lokaler Spieler gespawnt")
	if _fails > 0:
		get_tree().quit(1)
		return
	var w := _world()
	var me := GameState.my_id()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--expect-players="):
			var want := int(a.get_slice("=", 1))
			var t2 := 0.0
			while w.players.get_child_count() < want and t2 < 15.0:
				await _wait(0.25)
				t2 += 0.25
			_check(w.players.get_child_count() == want, "%d Spieler in der Welt sichtbar" % w.players.get_child_count())
			_check(GameState.state.players.size() >= want, "Spielerdaten synchronisiert")
	for p in w.players.get_children():
		if p != w.local_player:
			_others[p] = [(p as Player).net_pos, 0.0]
	var player: Player = w.local_player
	_check(GameState.businesses.size() > 20, "%d Geschäfte generiert" % GameState.businesses.size())
	_check(GameState.me().clean == Catalog.START_CLEAN, "Startkapital")
	await _wait(1.5)
	await _shot("01_street")
	if w.camera_rig:
		var old_d: float = w.camera_rig.distance
		var old_p: float = w.camera_rig.pitch
		w.camera_rig.distance = 5.0
		w.camera_rig.pitch = deg_to_rad(-18.0)
		await _wait(1.2)
		await _shot("01b_character")
		player._fire_held = true
		await _wait(0.5)
		player._fire_held = false
		await _shot("01c_aiming")
		w.camera_rig.distance = old_d
		w.camera_rig.pitch = old_p

	# --- Laden kaufen: günstigster freier Laden
	var cands: Array = []
	for b in GameState.businesses:
		var d: Dictionary = GameState.biz_dyn(b.id)
		var price := Catalog.business_price(b.type, b.district)
		if d.owner == 0 and d.ext_by == 0 and price <= 12000:
			cands.append([price, b.id])
	cands.sort()
	var pick: Array = cands[(me % 7) % cands.size()]   # mehrere Testclients greifen nicht zum selben Laden
	var best: int = pick[0]
	var target: int = pick[1]
	var biz: Dictionary = GameState.businesses[target]
	player.teleport(biz.pos + biz.normal * 1.0)
	await _wait(0.6)
	w.enter_business(target)
	await _wait(0.8)
	_check(Interiors.room_of(player.global_position) == target, "Laden betreten (Innenraum)")
	player.teleport(Interiors.counter_world(target) + Vector3(0, 0.1, 0))
	await _wait(0.6)
	GameState.action("buy", {"id": target})
	await _wait(0.8)
	_check(GameState.biz_dyn(target).owner == me, "Laden gekauft: " + biz.name)
	_check(GameState.me().clean == Catalog.START_CLEAN - best, "Kaufpreis abgezogen")
	GameState.action("install_op", {"id": target, "op": "speakeasy"})
	GameState.action("toggle_launder", {"id": target})
	await _wait(0.8)
	_check(GameState.biz_dyn(target).op == "speakeasy", "Speakeasy eingerichtet")
	_check(GameState.biz_dyn(target).launder, "Geldwäsche an")
	if w.hud:
		await _wait(0.6)
		await _shot("02a_interior")
		w.hud._open_panel({"kind": "biz", "id": target}, false)
		await _wait(0.5)
		await _shot("02_business_panel")
		w.hud._close_panel()
	w.exit_business(target)
	await _wait(0.4)
	_check(Interiors.room_of(player.global_position) == -1, "Laden verlassen")
	# Innenräume aller Branchen fotografieren
	if w.hud and "--rooms" in OS.get_cmdline_user_args():
		var seen := {}
		for b in GameState.businesses:
			if seen.has(b.type):
				continue
			seen[b.type] = true
			w.enter_business(b.id)
			await _wait(1.0)
			await _shot("room_" + b.type)
		w.exit_business(target)

	# --- Schutzgeld bei einem freien Laden (mehrere Versuche, Ablehnung ist Zufall)
	var extorted := false
	for b in GameState.businesses:
		var d2: Dictionary = GameState.biz_dyn(b.id)
		if d2.owner != 0 or d2.ext_by != 0 or b.id == target:
			continue
		player.teleport(b.pos + b.normal * 1.0)
		await _wait(0.4)
		GameState.action("extort", {"id": b.id, "level": 1})
		await _wait(0.6)
		if GameState.biz_dyn(b.id).ext_by == me:
			extorted = true
			_check(true, "Schutzgeld von " + b.name)
			break
	_check(extorted, "mindestens ein Laden zahlt Schutzgeld")

	# --- Stundentick (nur als Host direkt auslösbar)
	if multiplayer.is_server():
		var before: float = GameState.me().clean
		var dirty_before: float = GameState.me().dirty
		GameState._hour_tick()
		await _wait(0.5)
		_check(GameState.me().clean > before, "Stundentick: saubere Einnahmen")
		_check(GameState.me().dirty >= 0.0 and GameState.me().heat > 0.0, "Stundentick: Schwarzgeld gewaschen/Fahndung (%s -> %s)" % [Catalog.money(dirty_before), Catalog.money(GameState.me().dirty)])

	# --- Unbezahlbares darf nicht gehen
	var clean_now: float = GameState.me().clean
	GameState.action("buy", {"id": (target + 1) % GameState.businesses.size()})
	await _wait(0.6)
	_check(GameState.me().clean == clean_now or GameState.biz_dyn((target + 1) % GameState.businesses.size()).owner == me, "Kauf aus der Ferne wird abgelehnt")

	# --- Schießen
	player.teleport(biz.pos + biz.normal * 2.0)
	await _wait(0.3)
	var heat_before: float = GameState.me().heat
	for k in 3:
		w.request_fire(player.global_position + Vector3(5, 1.2, 0.5 * k))
		await _wait(0.45)
	await _wait(0.4)
	_check(GameState.me().heat > heat_before, "Schüsse erhöhen die Fahndung")

	# --- Bewegung der anderen (die laufen parallel ihren eigenen Autotest)
	if not _others.is_empty():
		var moved := false
		for p in _others:
			moved = moved or _others[p][1] > 1.0
		_check(moved, "Bewegung anderer Spieler kommt an")

	# --- PvP: den anderen Spieler umlegen (Server entscheidet über Treffer und Tod)
	if not _others.is_empty():
		var victim: Player = null
		for p in _others:
			if is_instance_valid(p) and (p as Node).is_inside_tree():
				victim = p
		if victim and victim.peer_id < me:
			victim = null   # nur der Client mit der kleineren ID greift an, sonst schießen sich beide gegenseitig weg
		if victim:
			var vid := victim.peer_id
			var deaths_before: int = GameState.state.players[vid].deaths
			for k in 14:
				if not is_instance_valid(victim):
					break
				player.teleport(victim.global_position + Vector3(2.5, 0, 0))
				await _wait(0.15)
				if not is_instance_valid(victim):
					break
				w.request_fire(victim.global_position + Vector3(0, 1.2, 0))
				await _wait(0.3)
				if GameState.state.players[vid].deaths > deaths_before:
					break
			_check(GameState.state.players[vid].deaths > deaths_before, "Gegner umgelegt (serverseitige Treffer)")
			_check(GameState.me().kills >= 1, "Kill wird gezählt")

	# --- Karte & Imperium
	if w.hud:
		w.hud.toggle_map()
		await _wait(2.5)
		await _shot("03_map")
		w.hud.toggle_map()
		w.hud.toggle_empire()
		await _wait(0.5)
		await _shot("04_empire")
		w.hud.toggle_empire()
		GameState.state.clock = 22 * 60.0
		await _wait(1.0)
		await _shot("05_night")
	print("AUTOTEST %s (%d Fehler)" % ["BESTANDEN" if _fails == 0 else "FEHLGESCHLAGEN", _fails])
	get_tree().quit(0 if _fails == 0 else 1)
