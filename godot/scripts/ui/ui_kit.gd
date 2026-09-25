class_name UiKit
## Gemeinsamer Look (dunkle Panels, Gold-Akzent) und kleine Bauhelfer für die Code-UI.

const GOLD := Color(0.93, 0.74, 0.3)
const PANEL := Color(0.09, 0.1, 0.13, 0.93)
const TEXT := Color(0.92, 0.9, 0.86)
const MUTED := Color(0.62, 0.64, 0.68)
const GOOD := Color(0.45, 0.85, 0.45)
const BAD := Color(0.95, 0.35, 0.3)
const DIRTY := Color(0.72, 0.78, 0.62)


static func theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 15
	t.set_stylebox("panel", "PanelContainer", box(PANEL, 10))
	t.set_stylebox("panel", "Panel", box(PANEL, 10))
	t.set_stylebox("normal", "Button", box(Color(0.2, 0.22, 0.27), 6, 10))
	t.set_stylebox("hover", "Button", box(Color(0.28, 0.3, 0.36), 6, 10))
	t.set_stylebox("pressed", "Button", box(GOLD.darkened(0.35), 6, 10))
	t.set_stylebox("disabled", "Button", box(Color(0.15, 0.16, 0.18), 6, 10))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", TEXT)
	t.set_color("font_disabled_color", "Button", Color(0.45, 0.46, 0.5))
	t.set_color("font_color", "Label", TEXT)
	t.set_stylebox("normal", "LineEdit", box(Color(0.14, 0.15, 0.19), 6, 8))
	t.set_stylebox("focus", "LineEdit", box(Color(0.17, 0.18, 0.23), 6, 8, GOLD))
	t.set_stylebox("normal", "OptionButton", box(Color(0.2, 0.22, 0.27), 6, 10))
	t.set_stylebox("hover", "OptionButton", box(Color(0.28, 0.3, 0.36), 6, 10))
	t.set_stylebox("background", "ProgressBar", box(Color(0.2, 0.2, 0.22), 4, 0))
	return t


static func box(c: Color, radius := 8, pad := 12, border := Color.TRANSPARENT) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = c
	s.set_corner_radius_all(radius)
	s.content_margin_left = pad
	s.content_margin_right = pad
	s.content_margin_top = pad * 0.6
	s.content_margin_bottom = pad * 0.6
	if border.a > 0.0:
		s.set_border_width_all(2)
		s.border_color = border
	return s


static func label(text: String, size := 15, color := TEXT) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func button(text: String, cb: Callable, enabled := true) -> Button:
	var b := Button.new()
	b.text = text
	b.disabled = not enabled
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


static func bar(color: Color, width := 110) -> ProgressBar:
	var pb := ProgressBar.new()
	pb.custom_minimum_size = Vector2(width, 12)
	pb.show_percentage = false
	pb.max_value = 100
	pb.add_theme_stylebox_override("fill", box(color, 4, 0))
	pb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	return pb


static func sep() -> HSeparator:
	var s := HSeparator.new()
	s.add_theme_constant_override("separation", 10)
	return s


static func clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()
