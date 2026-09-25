class_name CameraRig
extends Node3D
## Big-Ambitions-Kamera: schräg von oben, folgt dem Spieler gedämpft (lerp).
## Rechte Maustaste ziehen = drehen, Mausrad = zoomen. Kartenmodus (M) = Draufsicht mit Pan.

const PITCH_MIN := deg_to_rad(-78.0)
const PITCH_MAX := deg_to_rad(-28.0)

var target: Node3D
var yaw := deg_to_rad(35.0)
var pitch := deg_to_rad(-50.0)
var distance := 17.0
var map_mode := false
var map_focus := Vector3.ZERO
var map_distance := 185.0

var camera: Camera3D
var _cur_pitch := pitch
var _cur_distance := distance
var _rotating := false


func _ready() -> void:
	camera = Camera3D.new()
	camera.fov = 50.0
	camera.far = 900.0
	add_child(camera)
	camera.current = true


func set_map_mode(on: bool) -> void:
	map_mode = on
	if on and target:
		map_focus = Vector3(target.global_position.x * 0.5, 0, target.global_position.z * 0.5)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_rotating = mb.pressed
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			if map_mode: map_distance = maxf(70.0, map_distance * 0.88)
			else: distance = maxf(6.0, distance * 0.9)
		elif mb.pressed and mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if map_mode: map_distance = minf(330.0, map_distance * 1.12)
			else: distance = minf(45.0, distance * 1.1)
	elif event is InputEventMouseMotion and _rotating:
		var mm := event as InputEventMouseMotion
		yaw -= mm.relative.x * 0.006
		if not map_mode:
			pitch = clampf(pitch - mm.relative.y * 0.004, PITCH_MIN, PITCH_MAX)


func _process(delta: float) -> void:
	var goal := Vector3.ZERO
	var goal_pitch := pitch
	var goal_dist := distance
	if map_mode:
		var pan := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
		map_focus += Basis(Vector3.UP, yaw) * Vector3(pan.x, 0, pan.y) * delta * map_distance * 0.8
		var lim := CityBuilder.HALF
		map_focus = map_focus.clamp(Vector3(-lim, 0, -lim), Vector3(lim, 0, lim))
		goal = map_focus
		goal_pitch = deg_to_rad(-72.0)
		goal_dist = map_distance
	elif is_instance_valid(target):
		goal = target.global_position + Vector3(0, 1.0, 0)
	var k := 1.0 - exp(-delta * 7.0)
	global_position = global_position.lerp(goal, k)
	_cur_pitch = lerpf(_cur_pitch, goal_pitch, k)
	_cur_distance = lerpf(_cur_distance, goal_dist, 1.0 - exp(-delta * 5.0))
	basis = Basis.from_euler(Vector3(_cur_pitch, yaw, 0.0))
	camera.position = Vector3(0, 0, _cur_distance)


func snap() -> void:
	if is_instance_valid(target):
		global_position = target.global_position
	_cur_distance = distance
	_cur_pitch = pitch


func mouse_to_plane(height: float) -> Variant:
	## Schnittpunkt des Mausstrahls mit der Ebene y = height (Zielpunkt fürs Schießen).
	var mp := get_viewport().get_mouse_position()
	var from := camera.project_ray_origin(mp)
	var dir := camera.project_ray_normal(mp)
	return Plane(Vector3.UP, height).intersects_ray(from, dir)


func forward_flat() -> Vector3:
	return Basis(Vector3.UP, yaw) * Vector3.FORWARD
