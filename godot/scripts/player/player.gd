class_name Player
extends CharacterBody3D
## Spielfigur. Bewegung gehört dem jeweiligen Client (Authority = Peer-ID) und wird per
## MultiplayerSynchronizer verteilt. Alles Wirtschaftliche/Kampf entscheidet der Server.

const WALK := 4.6
const SPRINT := 8.2
const GRAVITY := 22.0

var peer_id := 1
var display_name := ""
var color := Color.WHITE
var skin := "Mafiosi_01"

# --- replizierte Werte (Synchronizer)
var net_pos := Vector3.ZERO
var look_yaw := 0.0
var anim_speed := 0.0
var aiming := false
var weapon := "pistol"

var camera_rig: CameraRig
var input_blocked := false
var rig: CharacterRig
var _name_label: Label3D
var _aim_timer := 0.0
var _fire_held := false
var _fire_cooldown := 0.0


static func create(data: Dictionary) -> Player:
	var p := Player.new()
	p.name = str(data.id)
	p.peer_id = data.id
	p.display_name = data.name
	p.color = data.color
	p.skin = data.skin
	p.position = data.pos
	p.net_pos = data.pos
	p._setup_sync()   # muss vor dem Betreten des Baums existieren (Spawn-Zustand)
	return p


func _enter_tree() -> void:
	set_multiplayer_authority(peer_id)


func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 2 | 4
	floor_snap_length = 0.3
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.35
	cap.height = 1.8
	shape.shape = cap
	shape.position.y = 0.9
	add_child(shape)
	rig = CharacterRig.new()
	add_child(rig)
	rig.setup(skin)
	rig.set_weapon(weapon)
	_name_label = Label3D.new()
	_name_label.text = display_name
	_name_label.font_size = 48
	_name_label.pixel_size = 0.006
	_name_label.outline_size = 10
	_name_label.modulate = color
	_name_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_name_label.no_depth_test = true
	_name_label.position.y = 2.25
	add_child(_name_label)
	# Farbiger Familienring unter den Füßen
	var ring := MeshInstance3D.new()
	var tor := TorusMesh.new()
	tor.inner_radius = 0.42
	tor.outer_radius = 0.55
	ring.mesh = tor
	ring.scale = Vector3(1, 0.1, 1)
	ring.position.y = 0.05
	ring.material_override = CityBuilder.flat_material(Color(color.r, color.g, color.b, 0.85), true)
	add_child(ring)


func _setup_sync() -> void:
	var sync := MultiplayerSynchronizer.new()
	sync.name = "Sync"
	sync.replication_interval = 0.05
	var cfg := SceneReplicationConfig.new()
	for prop in ["net_pos", "look_yaw", "anim_speed", "aiming", "weapon"]:
		var path := NodePath(".:" + prop)
		cfg.add_property(path)
		cfg.property_set_spawn(path, true)
		cfg.property_set_replication_mode(path, SceneReplicationConfig.REPLICATION_MODE_ALWAYS
			if prop in ["net_pos", "look_yaw", "anim_speed"] else SceneReplicationConfig.REPLICATION_MODE_ON_CHANGE)
	sync.replication_config = cfg
	add_child(sync)


func is_local() -> bool:
	return multiplayer.has_multiplayer_peer() and peer_id == multiplayer.get_unique_id()


func _unhandled_input(event: InputEvent) -> void:
	if not is_local():
		return
	if event.is_action_pressed("fire") and not input_blocked:
		_fire_held = true


func _input(event: InputEvent) -> void:
	if is_local() and event.is_action_released("fire"):
		_fire_held = false


func _physics_process(delta: float) -> void:
	if is_local():
		_local_control(delta)
	else:
		global_position = global_position.lerp(net_pos, 1.0 - exp(-delta * 14.0))
		rotation.y = lerp_angle(rotation.y, look_yaw, 1.0 - exp(-delta * 14.0))
	rig.set_weapon(weapon)
	rig.animate(delta, anim_speed, aiming)


func _local_control(delta: float) -> void:
	var input := Vector2.ZERO
	if not input_blocked and camera_rig and not camera_rig.map_mode:
		input = Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var yaw_basis := Basis(Vector3.UP, camera_rig.yaw if camera_rig else 0.0)
	var dir := yaw_basis * Vector3(input.x, 0, input.y)
	var speed := SPRINT if Input.is_action_pressed("sprint") else WALK
	var target_v := dir * speed
	velocity.x = move_toward(velocity.x, target_v.x, delta * 40.0)
	velocity.z = move_toward(velocity.z, target_v.z, delta * 40.0)
	velocity.y = 0.0 if is_on_floor() else velocity.y - GRAVITY * delta
	move_and_slide()
	if global_position.y < -5.0:
		global_position = Vector3(0, 1, 0)

	weapon = GameState.me().get("weapon", "pistol")   # Server entscheidet, der Client repliziert
	_fire_cooldown -= delta
	_aim_timer -= delta
	var aim_point: Variant = null
	if camera_rig and not camera_rig.map_mode:
		aim_point = camera_rig.mouse_to_plane(global_position.y + 1.2)
	if _fire_held and not input_blocked and aim_point != null:
		_aim_timer = 0.6
		if _fire_cooldown <= 0.0:
			_fire_cooldown = Catalog.WEAPONS[weapon].rate
			var world := get_parent().get_parent()
			if world.has_method("request_fire"):
				world.request_fire(aim_point)
	aiming = _aim_timer > 0.0
	if aiming and aim_point != null:
		var to: Vector3 = (aim_point as Vector3) - global_position
		look_yaw = atan2(-to.x, -to.z)
	elif dir.length() > 0.1:
		look_yaw = atan2(-dir.x, -dir.z)
	rotation.y = lerp_angle(rotation.y, look_yaw, 1.0 - exp(-delta * 16.0))
	anim_speed = Vector2(velocity.x, velocity.z).length()
	net_pos = global_position


func teleport(pos: Vector3) -> void:
	global_position = pos
	net_pos = pos
	velocity = Vector3.ZERO
