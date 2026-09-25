class_name MainMenu
extends Control
## Startbildschirm: Name, Figur, Farbe, Host/Beitreten. Einstellungen landen in user://settings.cfg.

const CFG := "user://settings.cfg"

var _name: LineEdit
var _skin: OptionButton
var _color := 0
var _color_row: HBoxContainer
var _port: LineEdit
var _address: LineEdit
var _status: Label


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	theme = UiKit.theme()
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.055, 0.07)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(520, 0)
	panel.add_theme_stylebox_override("panel", UiKit.box(UiKit.PANEL, 14, 28, UiKit.GOLD.darkened(0.4)))
	center.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	panel.add_child(v)
	v.add_child(UiKit.label("CAPITAL SANDBOX", 34, UiKit.GOLD))
	v.add_child(UiKit.label("Cosa Nostra – baue dein Imperium in der Stadt", 16, UiKit.MUTED))
	v.add_child(UiKit.sep())
	var cfg := ConfigFile.new()
	cfg.load(CFG)
	v.add_child(UiKit.label("Name", 13, UiKit.MUTED))
	_name = LineEdit.new()
	_name.max_length = 18
	_name.text = cfg.get_value("player", "name", "Don " + Catalog.SURNAMES[randi() % Catalog.SURNAMES.size()])
	v.add_child(_name)
	v.add_child(UiKit.label("Figur", 13, UiKit.MUTED))
	_skin = OptionButton.new()
	for s in ["Der Boss (Hut & Weste)", "Mafioso (Nadelstreifen)", "Mafioso (Schiebermütze)"]:
		_skin.add_item(s)
	_skin.selected = int(cfg.get_value("player", "skin", 0))
	v.add_child(_skin)
	v.add_child(UiKit.label("Familienfarbe", 13, UiKit.MUTED))
	_color = int(cfg.get_value("player", "color", 0))
	_color_row = HBoxContainer.new()
	v.add_child(_color_row)
	for k in Catalog.PLAYER_COLORS.size():
		var b := Button.new()
		b.custom_minimum_size = Vector2(40, 30)
		b.pressed.connect(_pick_color.bind(k))
		_color_row.add_child(b)
	_pick_color(_color)
	v.add_child(UiKit.sep())
	var host_row := HBoxContainer.new()
	v.add_child(host_row)
	_port = LineEdit.new()
	_port.text = str(cfg.get_value("net", "port", Net.DEFAULT_PORT))
	_port.custom_minimum_size.x = 90
	host_row.add_child(UiKit.label("Port", 14, UiKit.MUTED))
	host_row.add_child(_port)
	var hb := UiKit.button("Spiel hosten / Einzelspieler", _on_host)
	hb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	host_row.add_child(hb)
	var join_row := HBoxContainer.new()
	v.add_child(join_row)
	_address = LineEdit.new()
	_address.text = cfg.get_value("net", "address", "127.0.0.1:%d" % Net.DEFAULT_PORT)
	_address.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_address.placeholder_text = "IP:Port"
	join_row.add_child(_address)
	join_row.add_child(UiKit.button("Beitreten", _on_join))
	_status = UiKit.label("", 14, UiKit.BAD)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	v.add_child(_status)
	v.add_child(UiKit.label("WASD laufen · Shift rennen · Rechte Maus drehen · Rad zoomen · E interagieren\nLinke Maus schießen · M Karte · Tab Imperium · F1 Hilfe", 12, UiKit.MUTED))
	v.add_child(UiKit.button("Beenden", get_tree().quit))


func _pick_color(k: int) -> void:
	_color = k
	for i in _color_row.get_child_count():
		var b: Button = _color_row.get_child(i)
		var c: Color = Catalog.PLAYER_COLORS[i]
		b.add_theme_stylebox_override("normal", UiKit.box(c, 6, 4, Color.WHITE if i == k else Color.TRANSPARENT))
		b.add_theme_stylebox_override("hover", UiKit.box(c.lightened(0.2), 6, 4, Color.WHITE if i == k else Color.TRANSPARENT))


func _info() -> Dictionary:
	var cfg := ConfigFile.new()
	cfg.set_value("player", "name", _name.text)
	cfg.set_value("player", "skin", _skin.selected)
	cfg.set_value("player", "color", _color)
	cfg.set_value("net", "port", int(_port.text))
	cfg.set_value("net", "address", _address.text)
	cfg.save(CFG)
	return {"name": _name.text, "skin": Catalog.SKINS[_skin.selected], "color": _color}


func _on_host() -> void:
	var err := Net.host(int(_port.text) if _port.text.is_valid_int() else Net.DEFAULT_PORT, _info())
	_status.text = err


func _on_join() -> void:
	var addr := _address.text.strip_edges()
	var host := addr
	var p := Net.DEFAULT_PORT
	if addr.contains(":"):
		host = addr.get_slice(":", 0)
		p = int(addr.get_slice(":", 1))
	_status.add_theme_color_override("font_color", UiKit.MUTED)
	var err := Net.join(host if host != "" else "127.0.0.1", p, _info())
	_status.text = err if err != "" else "Verbinde mit %s:%d …" % [host, p]


func show_menu(message: String) -> void:
	show()
	_status.add_theme_color_override("font_color", UiKit.BAD)
	_status.text = message
