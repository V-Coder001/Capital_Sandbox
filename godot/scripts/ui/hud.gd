extends CanvasLayer
## Komplettes Spiel-UI im Big-Ambitions-Stil, im Code gebaut:
## Kopfleiste (Avatar, Gesundheit, Fahndung, sauberes/schwarzes Geld, Tag, Uhrzeit),
## Meldungen, Interaktionshinweis, Laden-/Polizei-/Waffen-Panel, Karte (M) mit Filtern und
## Bezirksdaten, Imperium-Übersicht (Tab), Hilfe (F1).

var world: Node
var local_player: Player

var _root: Control
var _avatar: Label
var _avatar_box: PanelContainer
var _hp: ProgressBar
var _heat: ProgressBar
var _clean: Label
var _dirty: Label
var _day: Label
var _time: Label
var _location: Label
var _prompt: Label
var _toasts: VBoxContainer
var _panel: PanelContainer
var _panel_body: VBoxContainer
var _panel_target := {}         # {"kind": "biz"/"police"/"guns", "id": ...}
var _panel_remote := false
var _map_filter: PanelContainer
var _map_info: PanelContainer
var _map_info_body: VBoxContainer
var _map_district := 0
var _filters := {}
var _empire: PanelContainer
var _empire_body: VBoxContainer
var _help: PanelContainer
var _nearest := {}


func setup(w: Node) -> void:
	world = w
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.theme = UiKit.theme()
	add_child(_root)
	_build_topbar()
	_build_bottom()
	_toasts = VBoxContainer.new()
	_toasts.custom_minimum_size = Vector2(410, 0)
	_place(_toasts, Control.PRESET_TOP_RIGHT, Vector2(-430, 92))
	_toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toasts.add_theme_constant_override("separation", 6)
	_panel = _make_window(Vector2(430, 0))
	_place(_panel, Control.PRESET_TOP_LEFT, Vector2(24, 92))
	_panel_body = _panel.get_child(0)
	_build_map_ui()
	_empire = _make_window(Vector2(640, 0))
	_place(_empire, Control.PRESET_CENTER_TOP, Vector2(-320, 110))
	_empire_body = _empire.get_child(0)
	_build_help()
	GameState.state_changed.connect(_on_state)
	GameState.notified.connect(toast)


func set_local_player(p: Player) -> void:
	local_player = p
	_on_state()


# ============================================================ Aufbau

func _place(c: Control, preset: Control.LayoutPreset, offset: Vector2) -> void:
	## Anker an einen Bildschirmpunkt, obere linke Ecke um `offset` versetzt, wächst nach rechts/unten.
	if c.get_parent() == null:
		_root.add_child(c)
	c.set_anchors_preset(preset)
	c.grow_horizontal = Control.GROW_DIRECTION_END
	c.grow_vertical = Control.GROW_DIRECTION_END
	c.offset_left = offset.x
	c.offset_top = offset.y
	c.offset_right = offset.x
	c.offset_bottom = offset.y


func _make_window(min_size: Vector2) -> PanelContainer:
	var pc := PanelContainer.new()
	pc.custom_minimum_size = min_size
	pc.visible = false
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	pc.add_child(v)
	_root.add_child(pc)
	return pc


func _build_topbar() -> void:
	var bar := PanelContainer.new()
	bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	bar.offset_left = 16
	bar.offset_right = -16
	bar.offset_top = 12
	bar.add_theme_stylebox_override("panel", UiKit.box(Color(0.12, 0.13, 0.16, 0.9), 10, 14))
	_root.add_child(bar)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 18)
	bar.add_child(h)
	_avatar_box = PanelContainer.new()
	_avatar_box.custom_minimum_size = Vector2(46, 46)
	_avatar = UiKit.label("?", 24, Color.BLACK)
	_avatar.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_avatar.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_avatar_box.add_child(_avatar)
	h.add_child(_avatar_box)
	var bars := VBoxContainer.new()
	bars.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(bars)
	var r1 := HBoxContainer.new()
	r1.add_child(UiKit.label("♥", 14, UiKit.BAD))
	_hp = UiKit.bar(UiKit.BAD, 140)
	r1.add_child(_hp)
	bars.add_child(r1)
	var r2 := HBoxContainer.new()
	r2.add_child(UiKit.label("★", 14, Color(1, 0.6, 0.2)))
	_heat = UiKit.bar(Color(1, 0.55, 0.15), 140)
	r2.add_child(_heat)
	bars.add_child(r2)
	h.add_child(VSeparator.new())
	_clean = UiKit.label("$0", 22, UiKit.GOOD)
	_clean.tooltip_text = "Sauberes Geld"
	_clean.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(_clean)
	_dirty = UiKit.label("$0", 18, UiKit.DIRTY)
	_dirty.tooltip_text = "Schwarzgeld – muss gewaschen werden"
	_dirty.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(_dirty)
	h.add_child(VSeparator.new())
	_day = UiKit.label("", 18)
	h.add_child(_day)
	_time = UiKit.label("", 22, UiKit.GOLD)
	h.add_child(_time)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(spacer)
	h.add_child(UiKit.button("Karte [M]", toggle_map))
	h.add_child(UiKit.button("Imperium [Tab]", toggle_empire))
	h.add_child(UiKit.button("?", toggle_help))
	h.add_child(UiKit.button("Verlassen", func(): Net.leave("")))


func _build_bottom() -> void:
	_prompt = UiKit.label("", 18, UiKit.GOLD)
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.custom_minimum_size = Vector2(800, 0)
	_place(_prompt, Control.PRESET_CENTER_BOTTOM, Vector2(-400, -120))
	_prompt.add_theme_color_override("font_outline_color", Color.BLACK)
	_prompt.add_theme_constant_override("outline_size", 6)
	_location = UiKit.label("", 16)
	_location.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_location.custom_minimum_size = Vector2(600, 0)
	_place(_location, Control.PRESET_CENTER_BOTTOM, Vector2(-300, -62))
	_location.add_theme_color_override("font_outline_color", Color.BLACK)
	_location.add_theme_constant_override("outline_size", 6)


func _build_help() -> void:
	_help = _make_window(Vector2(560, 0))
	_place(_help, Control.PRESET_CENTER_TOP, Vector2(-280, 110))
	var v: VBoxContainer = _help.get_child(0)
	v.add_child(UiKit.label("So baust du dein Imperium", 22, UiKit.GOLD))
	var txt := UiKit.label("""• Läden kaufen (E am Eingangsring): legale Fassade mit sauberen Einnahmen.
• Hinterzimmer: Speakeasy, Hehlerei, Spielhölle oder Drogenküche einrichten → Schwarzgeld, aber Fahndung.
• Schutzgeld: fremde Läden „überzeugen“. Mehr Druck = mehr Geld, aber mehr Widerstand und Polizei.
• Geldwäsche: in eigenen Läden einschalten – Schwarzgeld wird stündlich (minus 15 %) sauber.
• Einfluss: Läden, Betriebe und Schutzgeld geben Punkte im Bezirk. Mehr Einfluss = höhere Einnahmen,
  und nur mit mehr Einfluss kannst du Rivalen (Spieler oder KI-Familien) Schutzgeld-Kunden abjagen.
• Fahndung über 35: Razzien beschlagnahmen Schwarzgeld und schließen Betriebe. Polizeirevier: bestechen.
• Waffenhändler: bessere Waffen (zahlbar mit Schwarzgeld). Wer stirbt, verliert 30 % Schwarzgeld als Beute.

WASD laufen · Shift rennen · Rechte Maus ziehen: Kamera drehen · Mausrad: Zoom
Linke Maus: schießen · E: interagieren · M: Karte · Tab: Imperium · Esc: Fenster schließen""", 14)
	v.add_child(txt)
	v.add_child(UiKit.button("Schließen", toggle_help))


func _build_map_ui() -> void:
	_map_filter = _make_window(Vector2(300, 0))
	_place(_map_filter, Control.PRESET_TOP_RIGHT, Vector2(-324, 92))
	var v: VBoxContainer = _map_filter.get_child(0)
	v.add_child(UiKit.label("KARTENFILTER", 16, UiKit.MUTED))
	v.add_child(UiKit.label("STADTTEILE", 13, UiKit.GOLD))
	for d in 4:
		_add_filter(v, "district_%d" % d, Catalog.DISTRICTS[d].name, Catalog.DISTRICTS[d].color)
	v.add_child(UiKit.label("GESCHÄFTE", 13, UiKit.GOLD))
	_add_filter(v, "free", "Freie Geschäfte", Color.WHITE)
	_add_filter(v, "mine", "Meine Geschäfte", UiKit.GOLD)
	_add_filter(v, "extort", "Mein Schutzgeld", UiKit.DIRTY)
	_add_filter(v, "rival", "Rivalen & Familien", UiKit.BAD)
	v.add_child(UiKit.label("ORTE", 13, UiKit.GOLD))
	_add_filter(v, "police", "Polizeirevier", Color(0.3, 0.5, 1.0))
	_add_filter(v, "guns", "Waffenhändler", Color(1.0, 0.45, 0.2))
	_add_filter(v, "streets", "Straßennamen", UiKit.MUTED)
	v.add_child(UiKit.label("Klick auf einen Pin: Details\nWASD verschieben · Rad zoomen", 12, UiKit.MUTED))
	v.add_child(UiKit.button("Karte schließen [M]", toggle_map))
	_map_info = _make_window(Vector2(340, 0))
	_place(_map_info, Control.PRESET_TOP_LEFT, Vector2(24, 92))
	_map_info_body = _map_info.get_child(0)


func _add_filter(parent: Container, key: String, text: String, color: Color) -> void:
	var cb := CheckButton.new()
	cb.text = text
	cb.button_pressed = true
	cb.add_theme_color_override("font_color", color)
	cb.toggled.connect(func(_on): apply_map_filters())
	parent.add_child(cb)
	_filters[key] = cb


# ============================================================ Eingabe

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("map"):
		toggle_map()
	elif event.is_action_pressed("empire"):
		toggle_empire()
	elif event.is_action_pressed("help"):
		toggle_help()
	elif event.is_action_pressed("interact"):
		if _panel.visible:
			_close_panel()
		elif not _nearest.is_empty():
			_open_panel(_nearest, false)
	elif event.is_action_pressed("ui_cancel"):
		if _panel.visible: _close_panel()
		elif _empire.visible: toggle_empire()
		elif _help.visible: toggle_help()
		elif world.camera_rig.map_mode: toggle_map()
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed \
			and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT and world.camera_rig.map_mode:
		_pick_pin((event as InputEventMouseButton).position)
	else:
		return
	get_viewport().set_input_as_handled()


func toggle_map() -> void:
	var on: bool = not world.camera_rig.map_mode
	world.camera_rig.set_map_mode(on)
	world.city.map_layer.visible = on
	_map_filter.visible = on
	_map_info.visible = on
	if on:
		if local_player:
			_map_district = CityBuilder.district_at(local_player.global_position)
		_refresh_map_info()
		apply_map_filters()
	elif _panel_remote:
		_close_panel()


func toggle_empire() -> void:
	_empire.visible = not _empire.visible
	if _empire.visible:
		_refresh_empire()


func toggle_help() -> void:
	_help.visible = not _help.visible


func _pick_pin(screen_pos: Vector2) -> void:
	var cam: Camera3D = world.camera_rig.camera
	var best := {}
	var best_d := 28.0
	for key in world.city.pins:
		var pin: Node3D = world.city.pins[key]
		if not pin.visible:
			continue
		var head := pin.global_position + Vector3(0, 9.5, 0)
		if cam.is_position_behind(head):
			continue
		var d := cam.unproject_position(head).distance_to(screen_pos)
		if d < best_d:
			best_d = d
			best = {"kind": "biz", "id": key} if key is int else {"kind": str(key).trim_prefix("poi_"), "id": key}
	if not best.is_empty():
		_open_panel(best, true)
		if best.kind == "biz":
			_map_district = GameState.businesses[best.id].district
			_refresh_map_info()


func apply_map_filters() -> void:
	if world == null or _filters.is_empty():
		return
	for d in 4:
		world.city.district_overlays[d].visible = _filters["district_%d" % d].button_pressed
	for key in world.city.pins:
		var pin: Node3D = world.city.pins[key]
		if key is int:
			pin.visible = _filters[pin.get_meta("category", "free")].button_pressed
		else:
			pin.visible = _filters[str(key).trim_prefix("poi_")].button_pressed
	for lbl in world.city.street_labels:
		lbl.visible = _filters.streets.button_pressed


# ============================================================ Laufende Updates

func _process(_delta: float) -> void:
	var clock := Catalog.clock_text(GameState.state.clock)
	_day.text = clock.day
	_time.text = clock.time
	if local_player == null:
		return
	var pos := local_player.global_position
	_location.text = "%s\n%s" % [CityBuilder.location_text(pos), Catalog.DISTRICTS[CityBuilder.district_at(pos)].name]
	_nearest = _find_nearest(pos)
	if world.camera_rig.map_mode or _panel.visible:
		_prompt.text = ""
	elif not _nearest.is_empty():
		_prompt.text = "[E]  " + _target_title(_nearest)
	else:
		_prompt.text = ""
	if _panel.visible and not _panel_remote and _panel_target_pos().distance_to(pos) > Catalog.INTERACT_RANGE + 2.0:
		_close_panel()


func _find_nearest(pos: Vector3) -> Dictionary:
	var best := {}
	var best_d := 3.2
	for b in GameState.businesses:
		var d: float = (b.pos as Vector3).distance_to(pos)
		if d < best_d:
			best_d = d
			best = {"kind": "biz", "id": b.id}
	for p in GameState.pois:
		var d2: float = (p.pos as Vector3).distance_to(pos)
		if d2 < best_d:
			best_d = d2
			best = {"kind": p.kind, "id": p.id}
	return best


func _target_title(t: Dictionary) -> String:
	if t.kind == "biz":
		var b: Dictionary = GameState.businesses[t.id]
		return "%s · %s" % [b.name, Catalog.BUSINESS_TYPES[b.type].label]
	return "Polizeirevier 7 – mit dem Revierleiter reden" if t.kind == "police" else "Sal's Sport & Waffen – Hinterzimmer"


func _panel_target_pos() -> Vector3:
	if _panel_target.kind == "biz":
		return GameState.businesses[_panel_target.id].pos
	for p in GameState.pois:
		if p.id == _panel_target.id:
			return p.pos
	return Vector3.ZERO


func _on_state() -> void:
	var me := GameState.me()
	if me.is_empty():
		return
	var col: Color = Catalog.PLAYER_COLORS[me.color % Catalog.PLAYER_COLORS.size()]
	_avatar_box.add_theme_stylebox_override("panel", UiKit.box(col, 23, 0))
	_avatar.text = (me.name as String).left(1).to_upper()
	_hp.value = me.hp
	_heat.value = me.heat
	_heat.tooltip_text = "Fahndung %d/100 – ab 35 drohen Razzien" % int(me.heat)
	_clean.text = Catalog.money(me.clean)
	_dirty.text = "Schwarz " + Catalog.money(me.dirty)
	if _panel.visible:
		_refresh_panel()
	if _empire.visible:
		_refresh_empire()
	if _map_info.visible:
		_refresh_map_info()


func toast(text: String, kind: String) -> void:
	var colors := {"good": UiKit.GOOD, "warn": Color(1, 0.7, 0.3), "error": UiKit.BAD, "raid": Color(1, 0.3, 0.3),
		"news": Color(0.55, 0.75, 1.0), "tick": UiKit.MUTED, "info": UiKit.TEXT}
	var pc := PanelContainer.new()
	var c: Color = colors.get(kind, UiKit.TEXT)
	pc.add_theme_stylebox_override("panel", UiKit.box(Color(0.08, 0.09, 0.11, 0.9), 8, 12, c.darkened(0.3)))
	pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := UiKit.label(text, 14, c)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.custom_minimum_size = Vector2(380, 0)
	pc.add_child(l)
	_toasts.add_child(pc)
	while _toasts.get_child_count() > 6:
		_toasts.get_child(0).queue_free()
		_toasts.remove_child(_toasts.get_child(0))
	var tw := create_tween()
	tw.tween_interval(7.0 if kind in ["raid", "warn", "error"] else 5.0)
	tw.tween_property(pc, "modulate:a", 0.0, 0.6)
	tw.tween_callback(pc.queue_free)


# ============================================================ Panels

func _open_panel(target: Dictionary, remote: bool) -> void:
	_panel_target = target
	_panel_remote = remote
	_panel.visible = true
	_refresh_panel()


func _close_panel() -> void:
	_panel.visible = false
	_panel_target = {}


func _in_range() -> bool:
	return local_player != null and _panel_target_pos().distance_to(local_player.global_position) <= Catalog.INTERACT_RANGE


func _refresh_panel() -> void:
	UiKit.clear(_panel_body)
	match _panel_target.get("kind", ""):
		"biz": _panel_business(_panel_target.id)
		"police": _panel_police()
		"guns": _panel_guns()
	_panel_body.add_child(UiKit.sep())
	_panel_body.add_child(UiKit.button("Schließen [E]", _close_panel))


func _row(label_text: String, value: String, color := UiKit.TEXT) -> void:
	var h := HBoxContainer.new()
	var l := UiKit.label(label_text, 14, UiKit.MUTED)
	l.custom_minimum_size.x = 150
	h.add_child(l)
	var v := UiKit.label(value, 14, color)
	v.autowrap_mode = TextServer.AUTOWRAP_WORD
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(v)
	_panel_body.add_child(h)


func _act(action: String, args: Dictionary) -> Callable:
	return func(): GameState.action(action, args)


func _panel_business(id: int) -> void:
	var b: Dictionary = GameState.businesses[id]
	var d: Dictionary = GameState.biz_dyn(id)
	var t: Dictionary = Catalog.BUSINESS_TYPES[b.type]
	var me := GameState.my_id()
	var here := _in_range()
	var price := Catalog.business_price(b.type, b.district)
	var income := Catalog.business_income(b.type, b.district)
	_panel_body.add_child(UiKit.label(b.name, 22, UiKit.GOLD))
	_panel_body.add_child(UiKit.label("%s · %s\n%s" % [t.label, Catalog.DISTRICTS[b.district].name, b.street], 13, UiKit.MUTED))
	_panel_body.add_child(UiKit.sep())
	if d.is_empty():
		return
	var infl := GameState.influence()
	_row("Besitzer", "Privat (NPC)" if d.owner == 0 else GameState.owner_name(d.owner), GameState.owner_color(d.owner) if d.owner != 0 else UiKit.TEXT)
	_row("Einnahmen", "~%s / Stunde" % Catalog.money(income))
	_row("Waschkapazität", "%s / Stunde" % Catalog.money(t.launder))
	if not here:
		_panel_body.add_child(UiKit.label("Nur Ansicht – für Kauf und Schutzgeld musst du vor Ort sein.", 13, Color(1, 0.7, 0.3)))
	if d.owner == 0:
		_row("Kaufpreis", Catalog.money(price))
		var me_p := GameState.me()
		_panel_body.add_child(UiKit.button("Kaufen für %s (sauberes Geld)" % Catalog.money(price), _act("buy", {"id": id}),
			here and me_p.get("clean", 0.0) >= price))
		_panel_body.add_child(UiKit.sep())
		_panel_body.add_child(UiKit.label("Schutzgeld", 17, UiKit.GOLD))
		if d.ext_by == me:
			_row("Aktuell", "%s – ~%s schwarz / Stunde" % [Catalog.EXTORTION[d.ext_lvl].label, Catalog.money(income * Catalog.EXTORTION[d.ext_lvl].share)], UiKit.DIRTY)
		elif d.ext_by != 0:
			var mine: int = infl[b.district].get(me, 0)
			var theirs: int = infl[b.district].get(d.ext_by, 0)
			_row("Zahlt an", "%s (Einfluss hier: du %d / sie %d)" % [GameState.owner_name(d.ext_by), mine, theirs], UiKit.BAD)
		if GameState.state.clock < d.cooldown:
			_panel_body.add_child(UiKit.label("Der Besitzer ist gerade misstrauisch – später wiederkommen.", 13, UiKit.MUTED))
		for lvl in range(1, 4):
			var lv: Dictionary = Catalog.EXTORTION[lvl]
			var txt := "%s  (%d %% · Ablehnung %d %%)" % [lv.label, int(lv.share * 100), int(lv.refuse * 100)]
			if d.ext_by != 0 and d.ext_by != me:
				txt = "Übernehmen: " + lv.label
			var btn := UiKit.button(txt, _act("extort", {"id": id, "level": lvl}), here and not (d.ext_by == me and d.ext_lvl == lvl))
			_panel_body.add_child(btn)
		if d.ext_by == me:
			_panel_body.add_child(UiKit.button("In Ruhe lassen (Schutzgeld beenden)", _act("stop_extort", {"id": id})))
	elif d.owner == me:
		var mult := 1.0 + 0.5 * GameState.share(infl, b.district, me)
		_row("Einflussbonus", "×%.2f" % mult, UiKit.GOOD)
		_panel_body.add_child(UiKit.sep())
		_panel_body.add_child(UiKit.label("Hinterzimmer", 17, UiKit.GOLD))
		if d.op != "":
			var op: Dictionary = Catalog.OPS[d.op]
			_row("Läuft", "%s: +%s schwarz / h, +%.1f Fahndung / h" % [op.label, Catalog.money(op.dirty * mult), op.heat], UiKit.DIRTY)
			_panel_body.add_child(UiKit.button("%s schließen" % op.label, _act("remove_op", {"id": id})))
		else:
			for key in Catalog.OPS:
				var op2: Dictionary = Catalog.OPS[key]
				_panel_body.add_child(UiKit.button("%s einrichten – %s  (+%s/h, Fahndung +%.1f/h)" % [op2.label, Catalog.money(op2.cost), Catalog.money(op2.dirty), op2.heat],
					_act("install_op", {"id": id, "op": key}), here))
		_panel_body.add_child(UiKit.sep())
		var wash := UiKit.button("Geldwäsche: %s  (bis %s/h, 15 %% Gebühr)" % ["AN" if d.launder else "AUS", Catalog.money(t.launder * mult)], _act("toggle_launder", {"id": id}))
		if d.launder:
			wash.add_theme_color_override("font_color", UiKit.GOOD)
		_panel_body.add_child(wash)
		_panel_body.add_child(UiKit.button("Verkaufen für %s" % Catalog.money(price * Catalog.SELL_FACTOR), _act("sell", {"id": id})))
	else:
		_panel_body.add_child(UiKit.label("Gehört %s. Hier gibt es für dich nichts zu holen." % GameState.owner_name(d.owner), 14, UiKit.BAD))


func _panel_police() -> void:
	var me := GameState.me()
	_panel_body.add_child(UiKit.label("Polizeirevier 7", 22, Color(0.5, 0.7, 1.0)))
	_panel_body.add_child(UiKit.label("Revierleiter O'Hara schaut dich prüfend an.", 13, UiKit.MUTED))
	_panel_body.add_child(UiKit.sep())
	_row("Deine Fahndung", "%d / 100" % int(me.get("heat", 0)), Color(1, 0.6, 0.2))
	_row("Razzia-Risiko", "%d %% pro Stunde" % int(maxf(0.0, (me.get("heat", 0.0) - 35.0) / 160.0 * 100.0)))
	_panel_body.add_child(UiKit.button("Umschlag zustecken – $600 (Fahndung −12)", _act("bribe", {}), _in_range()))


func _panel_guns() -> void:
	var me := GameState.me()
	_panel_body.add_child(UiKit.label("Sal's Sport & Waffen", 22, Color(1.0, 0.55, 0.3)))
	_panel_body.add_child(UiKit.label("„Für die Jagd, versteht sich.“ – Sal nimmt auch Schwarzgeld.", 13, UiKit.MUTED))
	_panel_body.add_child(UiKit.sep())
	for key in Catalog.WEAPONS:
		var w: Dictionary = Catalog.WEAPONS[key]
		var owned: bool = key in me.get("weapons", [])
		var info := "%s – Schaden %d%s, %.1f Schuss/s" % [w.label, w.damage, " ×%d" % w.pellets if w.pellets > 1 else "", 1.0 / w.rate]
		if owned:
			var eq := UiKit.button(("✔ " if me.get("weapon") == key else "Ausrüsten: ") + info, _act("equip", {"weapon": key}), me.get("weapon") != key)
			_panel_body.add_child(eq)
		else:
			_panel_body.add_child(UiKit.button("Kaufen %s: %s" % [Catalog.money(w.price), info], _act("buy_weapon", {"weapon": key}), _in_range()))


# ============================================================ Karte: Bezirksdaten

func _refresh_map_info() -> void:
	UiKit.clear(_map_info_body)
	var tabs := HBoxContainer.new()
	for d in 4:
		var b := UiKit.button(Catalog.DISTRICTS[d].name, func(): _map_district = d; _refresh_map_info())
		if d == _map_district:
			b.add_theme_color_override("font_color", Catalog.DISTRICTS[d].color)
		b.add_theme_font_size_override("font_size", 12)
		tabs.add_child(b)
	_map_info_body.add_child(tabs)
	var dd: Dictionary = Catalog.DISTRICTS[_map_district]
	_map_info_body.add_child(UiKit.label(dd.name, 22, dd.color))
	_map_info_body.add_child(UiKit.label("BÜRGER", 13, UiKit.GOLD))
	for k in [["Arbeiterklasse", "working"], ["Mittelschicht", "middle"], ["Oberschicht", "upper"]]:
		_info_row(k[0], "%d %%" % dd[k[1]])
	var total := 0
	var free := 0
	var price_sum := 0
	for b in GameState.businesses:
		if b.district != _map_district:
			continue
		total += 1
		price_sum += Catalog.business_price(b.type, b.district)
		var d: Dictionary = GameState.biz_dyn(b.id)
		if not d.is_empty() and d.owner == 0 and d.ext_by == 0:
			free += 1
	_map_info_body.add_child(UiKit.label("GESCHÄFTE", 13, UiKit.GOLD))
	_info_row("Anzahl", str(total))
	_info_row("Unabhängig", str(free))
	_info_row("Ø Kaufpreis", Catalog.money(price_sum / maxf(total, 1)))
	_info_row("Preisniveau", "×%.1f" % dd.price)
	_map_info_body.add_child(UiKit.label("EINFLUSS", 13, UiKit.GOLD))
	var infl := GameState.influence()
	var rows: Array = []
	for who in infl[_map_district]:
		rows.append([who, infl[_map_district][who]])
	rows.sort_custom(func(a, b): return a[1] > b[1])
	if rows.is_empty():
		_map_info_body.add_child(UiKit.label("Noch niemand hat hier das Sagen.", 13, UiKit.MUTED))
	for r in rows:
		_info_row(GameState.owner_name(r[0]), "%d  (%d %%)" % [r[1], int(GameState.share(infl, _map_district, r[0]) * 100)], GameState.owner_color(r[0]))
	var boss := GameState.district_boss(infl, _map_district)
	_map_info_body.add_child(UiKit.label("Kontrolle: " + (GameState.owner_name(boss) if boss != 0 else "umkämpft"), 15, GameState.owner_color(boss) if boss != 0 else UiKit.MUTED))


func _info_row(a: String, b: String, color := UiKit.TEXT) -> void:
	var h := HBoxContainer.new()
	var l := UiKit.label(a, 14, color if color != UiKit.TEXT else UiKit.MUTED)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(UiKit.label(b, 14, color))
	_map_info_body.add_child(h)


# ============================================================ Imperium

func _refresh_empire() -> void:
	UiKit.clear(_empire_body)
	var me_id := GameState.my_id()
	var me := GameState.me()
	if me.is_empty():
		return
	_empire_body.add_child(UiKit.label("Imperium von %s" % me.name, 24, UiKit.GOLD))
	var f := GameState.hourly_forecast(me_id)
	_empire_body.add_child(UiKit.label("Pro Stunde: +%s sauber · +%s schwarz · Wäsche bis %s" % [Catalog.money(f.clean), Catalog.money(f.dirty), Catalog.money(f.wash)], 15, UiKit.GOOD))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(600, 330)
	_empire_body.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	list.add_child(UiKit.label("GESCHÄFTE", 13, UiKit.MUTED))
	var any := false
	for b in GameState.businesses:
		var d: Dictionary = GameState.biz_dyn(b.id)
		if d.is_empty() or (d.owner != me_id and d.ext_by != me_id):
			continue
		any = true
		var h := HBoxContainer.new()
		var name := UiKit.label(b.name, 14)
		name.custom_minimum_size.x = 190
		h.add_child(name)
		var info := ""
		if d.owner == me_id:
			info = Catalog.BUSINESS_TYPES[b.type].label + ((" + " + Catalog.OPS[d.op].label) if d.op != "" else "")
		else:
			info = "Schutzgeld: " + Catalog.EXTORTION[d.ext_lvl].label
		var il := UiKit.label(info, 13, UiKit.DIRTY if d.owner != me_id or d.op != "" else UiKit.MUTED)
		il.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(il)
		if d.owner == me_id:
			h.add_child(UiKit.button("Wäsche " + ("AN" if d.launder else "AUS"), _act("toggle_launder", {"id": b.id})))
		else:
			h.add_child(UiKit.button("Beenden", _act("stop_extort", {"id": b.id})))
		list.add_child(h)
	if not any:
		list.add_child(UiKit.label("Noch nichts. Lauf zu einem Laden-Eingang (Ring auf dem Gehweg) und drück E.", 13, UiKit.MUTED))
	list.add_child(UiKit.sep())
	list.add_child(UiKit.label("WAFFEN", 13, UiKit.MUTED))
	var wr := HBoxContainer.new()
	for w in me.weapons:
		wr.add_child(UiKit.button(Catalog.WEAPONS[w].label, _act("equip", {"weapon": w}), me.weapon != w))
	list.add_child(wr)
	list.add_child(UiKit.sep())
	list.add_child(UiKit.label("DIE FAMILIEN DER STADT", 13, UiKit.MUTED))
	var rows: Array = []
	for pid in GameState.state.players:
		var p: Dictionary = GameState.state.players[pid]
		var n := 0
		for d2 in GameState.state.biz.values():
			if d2.owner == pid: n += 1
		rows.append([p.name + ("" if p.online else " (offline)"), p.clean + p.dirty, n, p.kills, GameState.owner_color(pid)])
	rows.sort_custom(func(a, b): return a[1] > b[1])
	for r in rows:
		var h2 := HBoxContainer.new()
		var nl := UiKit.label(r[0], 14, r[4])
		nl.custom_minimum_size.x = 220
		h2.add_child(nl)
		var vl := UiKit.label("Vermögen %s · %d Läden · %d Kills" % [Catalog.money(r[1]), r[2], r[3]], 13, UiKit.MUTED)
		h2.add_child(vl)
		list.add_child(h2)
	_empire_body.add_child(UiKit.button("Schließen [Tab]", toggle_empire))
