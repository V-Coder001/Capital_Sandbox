extends Node
## Wurzel der Anwendung: Menü + Container, in den der Server die Welt setzt.
## Der WorldSpawner repliziert die Welt automatisch zu jedem Client, der beitritt.

const WORLD_SCENE := "res://scenes/world.tscn"

var world_container: Node
var world_spawner: MultiplayerSpawner
var menu: Control


func _ready() -> void:
	Net.main = self
	world_container = Node.new()
	world_container.name = "WorldContainer"
	add_child(world_container)
	world_container.child_entered_tree.connect(_on_world_entered)
	world_spawner = MultiplayerSpawner.new()
	world_spawner.name = "WorldSpawner"
	world_spawner.spawn_path = NodePath("../WorldContainer")
	world_spawner.add_spawnable_scene(WORLD_SCENE)
	add_child(world_spawner)
	menu = MainMenu.new()
	add_child(menu)
	var args := OS.get_cmdline_user_args()
	if "--autotest" in args:
		add_child(load("res://tests/autotest.gd").new())
	if Net.dedicated:
		var err := Net.host(Net.port, {})
		if err != "":
			printerr(err)
			get_tree().quit(1)
		return
	# Schnellstart ohne Menü: -- --host  bzw.  -- --join=127.0.0.1:24565  [--name=Vito]
	var info := {"name": "Don Test", "skin": Catalog.SKINS[0], "color": 0}
	for a in args:
		if a.begins_with("--name="):
			info.name = a.get_slice("=", 1)
		elif a.begins_with("--color="):
			info.color = int(a.get_slice("=", 1))
	for a in args:
		if a == "--host":
			Net.host(Net.port, info)
		elif a.begins_with("--join="):
			var addr := a.get_slice("=", 1)
			Net.join(addr.get_slice(":", 0), int(addr.get_slice(":", 1)) if addr.contains(":") else Net.DEFAULT_PORT, info)


func start_world() -> void:
	var w: Node = load(WORLD_SCENE).instantiate()
	w.name = "World"
	world_container.add_child(w, true)


func _on_world_entered(_n: Node) -> void:
	menu.hide()


func back_to_menu(message: String) -> void:
	for c in world_container.get_children():
		c.queue_free()
	GameState.reset()
	menu.show_menu(message)
