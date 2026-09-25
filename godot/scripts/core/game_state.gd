extends Node
## Autoritativer Wirtschafts-Zustand. Der Server rechnet (Uhr, Einnahmen, Schutzgeld, Wäsche,
## Razzien, Einfluss) und verteilt Snapshots. Clients schicken nur Wünsche (request_action).

signal state_changed
signal notified(text: String, kind: String)

var businesses: Array = []    # statisch aus CityBuilder, Index = id
var pois: Array = []
var state := {"clock": 8.0 * 60.0, "players": {}, "biz": {}}
var world: Node = null        # World-Knoten (für Positionen/Spawns)

var _dirty := false
var _sync_timer := 0.0
var _hour_accum := 0.0
var _rng := RandomNumberGenerator.new()


func is_server() -> bool:
	return multiplayer.has_multiplayer_peer() and multiplayer.is_server()


func my_id() -> int:
	return multiplayer.get_unique_id() if multiplayer.has_multiplayer_peer() else 0


func me() -> Dictionary:
	return state.players.get(my_id(), {})


func reset() -> void:
	businesses = []
	pois = []
	state = {"clock": 8.0 * 60.0, "players": {}, "biz": {}}
	world = null
	_dirty = false


# ============================================================ Abfragen (alle Peers)

func owner_name(id: int) -> String:
	if id == 0:
		return "—"
	if id < 0:
		return Catalog.AI_FAMILIES[id].name
	var p: Dictionary = state.players.get(id, {})
	return p.get("name", "Unbekannt")


func owner_color(id: int) -> Color:
	if id < 0:
		return Catalog.AI_FAMILIES[id].color
	var p: Dictionary = state.players.get(id, {})
	return Catalog.PLAYER_COLORS[p.get("color", 0) % Catalog.PLAYER_COLORS.size()] if not p.is_empty() else Color.WHITE


func biz_dyn(id: int) -> Dictionary:
	return state.biz.get(id, {})


func influence() -> Array:
	## Einfluss je Bezirk: {besitzer_id: punkte}. Wird aus dem Zustand abgeleitet, nie übertragen.
	var out: Array = [{}, {}, {}, {}]
	for b in businesses:
		var d: Dictionary = state.biz.get(b.id, {})
		if d.is_empty():
			continue
		var infl: Dictionary = out[b.district]
		if d.owner != 0:
			infl[d.owner] = infl.get(d.owner, 0) + 10 + (6 if d.op != "" else 0)
		if d.ext_by != 0:
			infl[d.ext_by] = infl.get(d.ext_by, 0) + 4 * d.ext_lvl
	return out


func share(infl: Array, district: int, who: int) -> float:
	var total := 0
	for v in infl[district].values():
		total += v
	return float(infl[district].get(who, 0)) / float(maxi(total, 1))


func district_boss(infl: Array, district: int) -> int:
	var best := 0
	var best_v := 0
	var total := 0
	for k in infl[district]:
		total += infl[district][k]
		if infl[district][k] > best_v:
			best_v = infl[district][k]
			best = k
	return best if best_v >= 40 and best_v * 2 >= total else 0


func hourly_forecast(pid: int) -> Dictionary:
	## Erwartete Einnahmen pro Stunde (für HUD/Imperium-Übersicht).
	var infl := influence()
	var clean := 0.0
	var dirty := 0.0
	var wash := 0.0
	for b in businesses:
		var d: Dictionary = state.biz.get(b.id, {})
		if d.is_empty():
			continue
		var inc := Catalog.business_income(b.type, b.district)
		var mult := 1.0 + 0.5 * share(infl, b.district, pid)
		if d.owner == pid:
			clean += inc * mult
			if d.op != "":
				dirty += Catalog.OPS[d.op].dirty * mult
			if d.launder:
				wash += Catalog.BUSINESS_TYPES[b.type].launder * mult
		elif d.ext_by == pid:
			dirty += inc * Catalog.EXTORTION[d.ext_lvl].share
	return {"clean": clean, "dirty": dirty, "wash": wash}


# ============================================================ Netzwerk-Eingänge

@rpc("any_peer", "reliable")
func request_register(info: Dictionary) -> void:
	if not is_server():
		return
	server_register(multiplayer.get_remote_sender_id(), info)


@rpc("any_peer", "reliable")
func request_action(action: String, args: Dictionary) -> void:
	if not is_server():
		return
	var pid := multiplayer.get_remote_sender_id()
	if pid == 0:
		pid = 1
	var err := _do_action(pid, action, args)
	if err != "":
		notify(pid, err, "error")
	_dirty = true


func action(name: String, args := {}) -> void:
	## Vom lokalen UI aufrufen – landet immer beim Server (auch wenn wir selbst Host sind).
	if is_server():
		var err := _do_action(1, name, args)
		if err != "":
			notify(1, err, "error")
		_dirty = true
	else:
		request_action.rpc_id(1, name, args)


@rpc("authority", "reliable")
func receive_state(s: Dictionary) -> void:
	state = s
	state_changed.emit()


@rpc("authority", "reliable", "call_local")
func _notify_rpc(text: String, kind: String) -> void:
	notified.emit(text, kind)


func notify(pid: int, text: String, kind := "info") -> void:
	if pid <= 0:
		return
	if pid == my_id():
		notified.emit(text, kind)
	elif multiplayer.get_peers().has(pid):
		_notify_rpc.rpc_id(pid, text, kind)


func broadcast(text: String, kind := "news") -> void:
	_notify_rpc.rpc(text, kind)


# ============================================================ Server

func server_setup() -> void:
	_rng.seed = Time.get_ticks_usec()
	state.biz = {}
	for b in businesses:
		state.biz[b.id] = {"owner": 0, "op": "", "launder": false, "ext_by": 0, "ext_lvl": 0, "cooldown": 0.0}
	# KI-Familien starten mit ein paar Schutzgeld-Kunden in ihrem Heimatbezirk
	for fam in Catalog.AI_FAMILIES:
		var home: int = Catalog.AI_FAMILIES[fam].home
		var n := 0
		for b in businesses:
			if b.district == home and n < 4 and state.biz[b.id].ext_by == 0:
				state.biz[b.id].ext_by = fam
				state.biz[b.id].ext_lvl = 2
				n += 1
	_dirty = true


func server_register(pid: int, info: Dictionary) -> void:
	var pname := str(info.get("name", "")).strip_edges().left(18)
	if pname == "":
		pname = "Gangster %d" % (pid % 1000)
	# Rückkehrer mit gleichem Namen übernehmen ihr altes Imperium
	for old_id in state.players.keys():
		var old: Dictionary = state.players[old_id]
		if old.name == pname and not old.online:
			state.players.erase(old_id)
			old.online = true
			old.hp = 100
			state.players[pid] = old
			for d in state.biz.values():
				if d.owner == old_id: d.owner = pid
				if d.ext_by == old_id: d.ext_by = pid
			_spawn(pid, old)
			broadcast("%s ist zurück in der Stadt." % pname)
			_dirty = true
			return
		if old.name == pname:
			pname += " %d" % (pid % 100)
	var used := {}
	for p in state.players.values():
		used[p.color] = true
	var color := int(info.get("color", 0)) % Catalog.PLAYER_COLORS.size()
	while used.has(color) and used.size() < Catalog.PLAYER_COLORS.size():
		color = (color + 1) % Catalog.PLAYER_COLORS.size()
	var skin: String = info.get("skin", Catalog.SKINS[0])
	if not skin in Catalog.SKINS:
		skin = Catalog.SKINS[0]
	var p := {"name": pname, "color": color, "skin": skin, "online": true,
		"clean": float(Catalog.START_CLEAN), "dirty": 0.0, "heat": 0.0, "hp": 100,
		"weapons": ["pistol"], "weapon": "pistol", "kills": 0, "deaths": 0}
	state.players[pid] = p
	_spawn(pid, p)
	broadcast("%s ist der Stadt beigetreten." % pname)
	notify(pid, "Willkommen! Kauf Läden als Fassade, fordere Schutzgeld und wasch dein Schwarzgeld. [F1] Hilfe", "info")
	_dirty = true


func _spawn(pid: int, p: Dictionary) -> void:
	if world:
		world.spawn_player(pid, p)


func server_remove_player(pid: int) -> void:
	if not state.players.has(pid):
		return
	state.players[pid].online = false
	broadcast("%s hat die Stadt verlassen." % state.players[pid].name)
	if world:
		world.despawn_player(pid)
	_dirty = true


func _process(delta: float) -> void:
	if not multiplayer.has_multiplayer_peer() or world == null:
		return
	state.clock += delta * Catalog.MINUTES_PER_SECOND   # Clients extrapolieren zwischen Snapshots
	if not is_server():
		return
	_hour_accum += delta * Catalog.MINUTES_PER_SECOND
	if _hour_accum >= 60.0:
		_hour_accum -= 60.0
		_hour_tick()
	_sync_timer -= delta
	if _dirty and _sync_timer <= 0.0:
		_dirty = false
		_sync_timer = 0.15
		receive_state.rpc(state)
		state_changed.emit()


func mark_dirty() -> void:
	_dirty = true


func _player_pos(pid: int) -> Variant:
	return world.player_position(pid) if world else null


func _in_range(pid: int, pos: Vector3) -> bool:
	var pp: Variant = _player_pos(pid)
	return pp != null and (pp as Vector3).distance_to(pos) <= Catalog.INTERACT_RANGE


func _pay(p: Dictionary, amount: float, allow_dirty: bool) -> bool:
	## Illegales darf mit Schwarzgeld bezahlt werden (zuerst), Legales nur sauber.
	var avail: float = p.clean + (p.dirty if allow_dirty else 0.0)
	if avail < amount:
		return false
	if allow_dirty:
		var from_dirty := minf(p.dirty, amount)
		p.dirty -= from_dirty
		amount -= from_dirty
	p.clean -= amount
	return true


func _do_action(pid: int, act: String, args: Dictionary) -> String:
	var p: Dictionary = state.players.get(pid, {})
	if p.is_empty():
		return "Unbekannter Spieler."
	if act in ["bribe", "buy_weapon"]:
		return _poi_action(pid, p, act, args)
	if act == "equip":
		if args.get("weapon", "") in p.weapons:
			p.weapon = args.weapon
			return ""
		return "Diese Waffe besitzt du nicht."
	var id := int(args.get("id", -1))
	if id < 0 or id >= businesses.size():
		return "Unbekanntes Geschäft."
	var b: Dictionary = businesses[id]
	var d: Dictionary = state.biz[id]
	var remote_ok := act in ["toggle_launder", "stop_extort", "sell"]
	if not remote_ok and not _in_range(pid, b.pos) and not _in_range(pid, Interiors.counter_world(id)):
		return "Dafür musst du vor Ort sein."
	match act:
		"buy":
			if d.owner != 0:
				return "Das Geschäft gehört bereits %s." % owner_name(d.owner)
			var price := Catalog.business_price(b.type, b.district)
			if not _pay(p, price, false):
				return "Nicht genug sauberes Geld (%s nötig)." % Catalog.money(price)
			if d.ext_by != 0 and d.ext_by != pid:
				notify(d.ext_by, "%s hat %s gekauft – dein Schutzgeld dort ist weg." % [p.name, b.name], "warn")
			d.owner = pid
			d.ext_by = 0
			d.ext_lvl = 0
			notify(pid, "Gekauft: %s für %s. Deine neue Fassade." % [b.name, Catalog.money(price)], "good")
		"sell":
			if d.owner != pid:
				return "Das gehört dir nicht."
			var back := Catalog.business_price(b.type, b.district) * Catalog.SELL_FACTOR
			p.clean += back
			d.owner = 0
			d.op = ""
			d.launder = false
			notify(pid, "%s verkauft für %s." % [b.name, Catalog.money(back)], "info")
		"install_op":
			var op: String = args.get("op", "")
			if d.owner != pid:
				return "Illegale Betriebe nur in eigenen Läden."
			if not Catalog.OPS.has(op):
				return "Unbekannter Betrieb."
			if d.op != "":
				return "Hier läuft schon: %s." % Catalog.OPS[d.op].label
			if not _pay(p, Catalog.OPS[op].cost, true):
				return "Zu wenig Geld für %s." % Catalog.OPS[op].label
			d.op = op
			p.heat = minf(100.0, p.heat + 3.0)
			notify(pid, "Im Hinterzimmer von %s läuft jetzt: %s." % [b.name, Catalog.OPS[op].label], "good")
		"remove_op":
			if d.owner != pid or d.op == "":
				return "Kein Betrieb zum Schließen."
			d.op = ""
			notify(pid, "Betrieb in %s geschlossen." % b.name, "info")
		"toggle_launder":
			if d.owner != pid:
				return "Waschen geht nur über eigene Läden."
			d.launder = not d.launder
		"extort":
			return _extort(pid, p, id, b, d, clampi(int(args.get("level", 1)), 1, 3))
		"stop_extort":
			if d.ext_by != pid:
				return "Du kassierst hier nicht."
			d.ext_by = 0
			d.ext_lvl = 0
			notify(pid, "Du lässt %s in Ruhe." % b.name, "info")
		_:
			return "Unbekannte Aktion."
	return ""


func _extort(pid: int, p: Dictionary, id: int, b: Dictionary, d: Dictionary, lvl: int) -> String:
	if d.owner > 0:
		return "Gehört einem Spieler – der zahlt dir nichts."
	if state.clock < d.cooldown:
		return "Der Besitzer ist misstrauisch geworden. Versuch es später."
	var infl := influence()
	var my_share := share(infl, b.district, pid)
	var lv: Dictionary = Catalog.EXTORTION[lvl]
	if d.ext_by != 0 and d.ext_by != pid:
		# Revierkampf: Wer im Bezirk mehr Einfluss hat, übernimmt den Laden
		var mine: int = infl[b.district].get(pid, 0)
		var theirs: int = infl[b.district].get(d.ext_by, 0)
		p.heat = minf(100.0, p.heat + 4.0)
		if mine > theirs:
			var rival: int = d.ext_by
			notify(rival, "%s hat dir %s abgenommen!" % [p.name, b.name], "warn")
			d.ext_by = pid
			d.ext_lvl = lvl
			notify(pid, "Übernommen: %s zahlt jetzt dir statt %s." % [b.name, owner_name(rival)], "good")
			return ""
		notify(d.ext_by, "%s hat versucht, dir %s abzujagen." % [p.name, b.name], "warn")
		return "%s steht unter dem Schutz von %s – du hast im Bezirk zu wenig Einfluss (%d vs. %d)." % [b.name, owner_name(d.ext_by), mine, theirs]
	var raising: bool = d.ext_by != pid or lvl > d.ext_lvl
	if raising and _rng.randf() < lv.refuse * (1.0 - 0.7 * my_share):
		d.cooldown = state.clock + 180.0
		p.heat = minf(100.0, p.heat + 2.0 * lvl)
		if d.ext_by == pid:
			d.ext_by = 0
			d.ext_lvl = 0
		return "%s weigert sich zu zahlen und droht mit der Polizei. (+%d Fahndung)" % [b.name, 2 * lvl]
	d.ext_by = pid
	d.ext_lvl = lvl
	p.heat = minf(100.0, p.heat + lvl)
	var hourly: float = Catalog.business_income(b.type, b.district) * lv.share
	notify(pid, "%s zahlt: „%s“ – ca. %s Schwarzgeld pro Stunde." % [b.name, lv.label, Catalog.money(hourly)], "good")
	return ""


func _poi_action(pid: int, p: Dictionary, act: String, args: Dictionary) -> String:
	var kind := "police" if act == "bribe" else "guns"
	var poi: Dictionary = {}
	for x in pois:
		if x.kind == kind:
			poi = x
	if poi.is_empty() or not _in_range(pid, poi.pos):
		return "Dafür musst du vor Ort sein."
	if act == "bribe":
		if p.heat < 1.0:
			return "Die Polizei interessiert sich gerade nicht für dich."
		var cost := 600.0
		if not _pay(p, cost, true):
			return "Zu wenig Geld für den Umschlag."
		p.heat = maxf(0.0, p.heat - 12.0)
		notify(pid, "Ein Umschlag wechselt den Besitzer. Fahndung −12.", "good")
		return ""
	var w: String = args.get("weapon", "")
	if not Catalog.WEAPONS.has(w):
		return "Gibt's hier nicht."
	if w in p.weapons:
		p.weapon = w
		return ""
	if not _pay(p, Catalog.WEAPONS[w].price, true):
		return "Zu wenig Geld."
	p.weapons.append(w)
	p.weapon = w
	notify(pid, "%s gekauft. Sal fragt nicht, woher das Geld kommt." % Catalog.WEAPONS[w].label, "good")
	return ""


func _hour_tick() -> void:
	var infl := influence()
	var earned := {}
	for b in businesses:
		var d: Dictionary = state.biz[b.id]
		var inc := Catalog.business_income(b.type, b.district)
		if d.owner > 0 and state.players.has(d.owner):
			var p: Dictionary = state.players[d.owner]
			var mult := 1.0 + 0.5 * share(infl, b.district, d.owner)
			p.clean += inc * mult
			_add(earned, d.owner, "clean", inc * mult)
			if d.op != "":
				p.dirty += Catalog.OPS[d.op].dirty * mult
				p.heat += Catalog.OPS[d.op].heat
				_add(earned, d.owner, "dirty", Catalog.OPS[d.op].dirty * mult)
		elif d.ext_by != 0:
			var lv: Dictionary = Catalog.EXTORTION[d.ext_lvl]
			if _rng.randf() < lv.resist * (1.0 - 0.6 * share(infl, b.district, d.ext_by)):
				if _rng.randf() < 0.5:
					if d.ext_by > 0:
						state.players[d.ext_by].heat += 6.0
						notify(d.ext_by, "%s hat sich an die Polizei gewandt und zahlt nicht mehr! (+6 Fahndung)" % b.name, "warn")
					d.ext_by = 0
					d.ext_lvl = 0
					d.cooldown = state.clock + 240.0
				elif d.ext_by > 0:
					notify(d.ext_by, "%s hat diese Stunde nicht gezahlt." % b.name, "warn")
			elif d.ext_by > 0 and state.players.has(d.ext_by):
				var p2: Dictionary = state.players[d.ext_by]
				p2.dirty += inc * lv.share
				p2.heat += lv.heat
				_add(earned, d.ext_by, "dirty", inc * lv.share)
	# Geldwäsche nach den Einnahmen
	for b in businesses:
		var d: Dictionary = state.biz[b.id]
		if d.owner > 0 and d.launder and state.players.has(d.owner):
			var p: Dictionary = state.players[d.owner]
			var cap: float = Catalog.BUSINESS_TYPES[b.type].launder * (1.0 + 0.5 * share(infl, b.district, d.owner))
			var amount := minf(p.dirty, cap)
			p.dirty -= amount
			p.clean += amount * (1.0 - Catalog.LAUNDER_FEE)
			_add(earned, d.owner, "washed", amount)
	for pid in state.players:
		var p: Dictionary = state.players[pid]
		p.heat = clampf(p.heat - 1.5, 0.0, 100.0)
		if p.online and p.heat > 35.0 and _rng.randf() < (p.heat - 35.0) / 160.0:
			_raid(pid, p)
		elif p.online and earned.has(pid):
			var e: Dictionary = earned[pid]
			var txt := "Stunde abgerechnet: +%s sauber" % Catalog.money(e.get("clean", 0.0))
			if e.get("dirty", 0.0) > 0.0: txt += ", +%s schwarz" % Catalog.money(e.dirty)
			if e.get("washed", 0.0) > 0.0: txt += ", %s gewaschen" % Catalog.money(e.washed)
			notify(pid, txt, "tick")
	if int(state.clock / 60.0) % 3 == 0:
		_ai_families(infl)
	_check_district_bosses(infl)
	_dirty = true


func _add(earned: Dictionary, pid: int, key: String, v: float) -> void:
	if not earned.has(pid):
		earned[pid] = {}
	earned[pid][key] = earned[pid].get(key, 0.0) + v


func _raid(pid: int, p: Dictionary) -> void:
	var lost: float = p.dirty * 0.4
	p.dirty -= lost
	p.heat = maxf(0.0, p.heat - 25.0)
	var closed := ""
	var ops: Array = []
	for b in businesses:
		if state.biz[b.id].owner == pid and state.biz[b.id].op != "":
			ops.append(b.id)
	if not ops.is_empty():
		var id: int = ops[_rng.randi() % ops.size()]
		closed = " %s in %s wurde dichtgemacht." % [Catalog.OPS[state.biz[id].op].label, businesses[id].name]
		state.biz[id].op = ""
	notify(pid, "RAZZIA! Die Polizei beschlagnahmt %s Schwarzgeld.%s" % [Catalog.money(lost), closed], "raid")
	broadcast("Polizei-Razzia bei %s!" % p.name, "news")


var _last_bosses := [0, 0, 0, 0]

func _check_district_bosses(infl: Array) -> void:
	for d in 4:
		var boss := district_boss(infl, d)
		if boss != _last_bosses[d]:
			_last_bosses[d] = boss
			if boss != 0:
				broadcast("%s kontrolliert jetzt %s!" % [owner_name(boss), Catalog.DISTRICTS[d].name], "news")


func _ai_families(infl: Array) -> void:
	for fam in Catalog.AI_FAMILIES:
		var home: int = Catalog.AI_FAMILIES[fam].home
		var candidates: Array = []
		var targets: Array = []
		for b in businesses:
			var d: Dictionary = state.biz[b.id]
			var near: bool = b.district == home or _rng.randf() < 0.25
			if not near or d.owner != 0:
				continue
			if d.ext_by == 0 and state.clock >= d.cooldown:
				candidates.append(b.id)
			elif d.ext_by > 0 and infl[b.district].get(fam, 0) > infl[b.district].get(d.ext_by, 0):
				targets.append(b.id)
		if not targets.is_empty() and _rng.randf() < 0.2:
			var id: int = targets[_rng.randi() % targets.size()]
			var victim: int = state.biz[id].ext_by
			state.biz[id].ext_by = fam
			notify(victim, "%s hat dir %s abgenommen!" % [Catalog.AI_FAMILIES[fam].name, businesses[id].name], "warn")
		elif not candidates.is_empty() and _rng.randf() < 0.6:
			var id2: int = candidates[_rng.randi() % candidates.size()]
			state.biz[id2].ext_by = fam
			state.biz[id2].ext_lvl = 1 + _rng.randi() % 3


func server_damage(victim: int, attacker: int, amount: int) -> void:
	var v: Dictionary = state.players.get(victim, {})
	if v.is_empty() or v.hp <= 0:
		return
	v.hp = maxi(0, v.hp - amount)
	if attacker > 0 and state.players.has(attacker):
		state.players[attacker].heat = minf(100.0, state.players[attacker].heat + 0.5)
	if v.hp == 0:
		v.deaths += 1
		var drop: float = floorf(v.dirty * 0.3)
		v.dirty -= drop
		v.hp = 100
		var killer := owner_name(attacker)
		if state.players.has(attacker):
			state.players[attacker].kills += 1
			state.players[attacker].heat = minf(100.0, state.players[attacker].heat + 15.0)
		broadcast("%s wurde von %s umgelegt." % [v.name, killer], "news")
		if world:
			world.server_player_died(victim, drop)
	_dirty = true
