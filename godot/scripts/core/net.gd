extends Node
## Verbindungsaufbau (ENet). Host = autoritativer Server + lokaler Spieler.
## Dedizierter Server: godot --headless -- --server [--port=24565]

const DEFAULT_PORT := 24565
const MAX_PLAYERS := 16

var main: Node
var local_info := {}
var dedicated := false
var port := DEFAULT_PORT


func _ready() -> void:
	_setup_input()
	var args := OS.get_cmdline_user_args()
	dedicated = "--server" in args
	for a in args:
		if a.begins_with("--port="):
			port = int(a.get_slice("=", 1))
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected)
	multiplayer.connection_failed.connect(_fail.bind("Verbindung fehlgeschlagen."))
	multiplayer.server_disconnected.connect(_fail.bind("Verbindung zum Server verloren."))


func host(p: int, info: Dictionary) -> String:
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(p, MAX_PLAYERS)
	if err != OK:
		return "Server konnte nicht starten (Port %d belegt?)." % p
	multiplayer.multiplayer_peer = peer
	local_info = info
	port = p
	main.start_world()
	return ""


func join(address: String, p: int, info: Dictionary) -> String:
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_client(address, p)
	if err != OK:
		return "Ungültige Adresse."
	multiplayer.multiplayer_peer = peer
	local_info = info
	return ""


func world_ready() -> void:
	## Server: Welt steht → Host-Spieler anmelden (nicht beim dedizierten Server).
	if not dedicated:
		GameState.server_register(1, local_info)
	else:
		print("Dedizierter Server läuft auf Port %d" % port)


func _on_connected() -> void:
	GameState.request_register.rpc_id(1, local_info)


func _on_peer_disconnected(id: int) -> void:
	if multiplayer.is_server():
		GameState.server_remove_player(id)


func leave(message := "") -> void:
	if multiplayer.multiplayer_peer:
		multiplayer.multiplayer_peer.close()
	multiplayer.multiplayer_peer = null
	if main:
		main.back_to_menu(message)


func _fail(message: String) -> void:
	leave(message)


func _setup_input() -> void:
	var keys := {
		"move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN],
		"move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT],
		"sprint": [KEY_SHIFT], "interact": [KEY_E], "map": [KEY_M],
		"empire": [KEY_TAB], "help": [KEY_F1],
	}
	for action in keys:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for k in keys[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
	if not InputMap.has_action("fire"):
		InputMap.add_action("fire")
		var mb := InputEventMouseButton.new()
		mb.button_index = MOUSE_BUTTON_LEFT
		InputMap.action_add_event("fire", mb)
