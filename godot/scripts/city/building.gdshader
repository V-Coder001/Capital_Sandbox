shader_type spatial;
// Fassade ohne Texturen: Fensterraster aus Weltkoordinaten, nachts zufällig beleuchtet.

uniform vec3 wall_color : source_color = vec3(0.6, 0.5, 0.45);
uniform vec3 trim_color : source_color = vec3(0.85, 0.82, 0.75);
uniform float night = 0.0;
uniform float seed = 0.0;
uniform float ground_floor = 3.8;
// Durchsicht: Fassaden zwischen Kamera und Spieler werden kegelförmig ausgeschnitten
uniform vec3 cut_center = vec3(0.0);
uniform vec3 cut_camera = vec3(0.0);
uniform float cut_radius = 0.0;

varying vec3 wpos;
varying vec3 wnorm;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 13.7) * 43758.5453);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	if (cut_radius > 0.0) {
		vec3 to_p = cut_center - cut_camera;
		float len_p = length(to_p);
		vec3 dir = to_p / max(len_p, 0.001);
		vec3 rel = wpos - cut_camera;
		float t = dot(rel, dir);
		if (t > 0.0 && t < len_p - 0.6) {
			float r = cut_radius * t / len_p;
			float d = length(rel - dir * t);
			if (d < r || (d < r * 1.18 && mod(floor(FRAGCOORD.x) + floor(FRAGCOORD.y), 2.0) < 1.0)) {
				discard;
			}
		}
	}
	vec3 col = wall_color;
	float rough = 0.92;
	float metal = 0.0;
	vec3 emi = vec3(0.0);
	if (wnorm.y > 0.5) {
		col = wall_color * 0.5 + vec3(0.05);
	} else if (wnorm.y > -0.5) {
		float h = abs(wnorm.x) > 0.5 ? wpos.z : wpos.x;
		float y = wpos.y;
		if (y > ground_floor) {
			float fl = 3.2;
			vec2 cell = vec2(floor(h / 3.0), floor((y - ground_floor) / fl));
			vec2 f = vec2(fract(h / 3.0), fract((y - ground_floor) / fl));
			bool win = abs(f.x - 0.5) < 0.23 && f.y > 0.22 && f.y < 0.8;
			bool sill = abs(f.x - 0.5) < 0.29 && f.y > 0.15 && f.y <= 0.22;
			if (win) {
				float lit = step(0.5, hash(cell + round(wnorm.xz) * 17.0));
				col = vec3(0.07, 0.09, 0.12);
				rough = 0.12;
				metal = 0.3;
				emi = vec3(1.0, 0.78, 0.42) * lit * night * 1.8;
				// Fensterkreuz
				if (abs(f.x - 0.5) < 0.012 || abs(f.y - 0.52) < 0.012) {
					col = trim_color * 0.7;
					emi = vec3(0.0);
				}
			} else if (sill) {
				col = trim_color;
			}
			if (f.y < 0.035) {
				col = mix(col, trim_color * 0.8, 0.7);
			}
		} else {
			col = wall_color * 0.72;
			if (y > ground_floor - 0.25) {
				col = trim_color * 0.85;
			}
		}
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = metal;
	EMISSION = emi;
}
