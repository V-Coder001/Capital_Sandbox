/* ============================================================
 * Synthetischer Sound (WebAudio) — keine Audiodateien nötig.
 * Im Vakuum wird alles über einen Tiefpass gedämpft: man hört nur noch,
 * was als Körperschall durch Anzug und Hände kommt.
 * ============================================================ */
export class Sfx {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.7;
    this.vacuum = this.ctx.createBiquadFilter(); this.vacuum.type = "lowpass"; this.vacuum.frequency.value = 18000;
    this.vacuum.connect(this.master); this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }
  get t() { return this.ctx.currentTime; }
  out() { return this.vacuum; }

  /** Atmosphäre vorhanden? Steuert den Tiefpass (Vakuum = dumpf). */
  setAir(hasAir) {
    if (!this.ctx) return;
    this.vacuum.frequency.setTargetAtTime(hasAir ? 18000 : 380, this.t, 0.25);
    this.humGain?.gain.setTargetAtTime(hasAir ? 0.05 : 0.012, this.t, 0.4);
  }

  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; return s; }

  env(node, a, peak, d, when = this.t) {
    node.gain.setValueAtTime(0.0001, when);
    node.gain.exponentialRampToValueAtTime(peak, when + a);
    node.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
  }

  /** Lautstärke/Panning nach Entfernung */
  spatial(vol, pan) {
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.out()); }
    else g.connect(this.out());
    return g;
  }

  shot(vol = 1, pan = 0) {
    if (!this.ctx) return;
    const out = this.spatial(vol, pan);
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = "bandpass"; f.frequency.setValueAtTime(2400, this.t); f.frequency.exponentialRampToValueAtTime(300, this.t + 0.12); f.Q.value = 0.8;
    n.connect(f); f.connect(g); g.connect(out);
    this.env(g, 0.002, 0.9, 0.16);
    n.start(); n.stop(this.t + 0.2);
    // Gauss-"Zing"
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(1800, this.t); o.frequency.exponentialRampToValueAtTime(140, this.t + 0.09);
    o.connect(og); og.connect(out); this.env(og, 0.001, 0.25, 0.09);
    o.start(); o.stop(this.t + 0.12);
    // Tiefer Rückstoß
    const k = this.ctx.createOscillator(), kg = this.ctx.createGain();
    k.frequency.setValueAtTime(120, this.t); k.frequency.exponentialRampToValueAtTime(40, this.t + 0.12);
    k.connect(kg); kg.connect(out); this.env(kg, 0.002, 0.7, 0.13);
    k.start(); k.stop(this.t + 0.16);
  }

  laser(vol = 1, pan = 0) {
    if (!this.ctx) return;
    const out = this.spatial(vol, pan);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "square"; o.frequency.setValueAtTime(2200, this.t); o.frequency.exponentialRampToValueAtTime(320, this.t + 0.22);
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 3000;
    o.connect(f); f.connect(g); g.connect(out); this.env(g, 0.003, 0.22, 0.22);
    o.start(); o.stop(this.t + 0.26);
  }

  impact(vol = 0.5, pan = 0, metal = true) {
    if (!this.ctx) return;
    const out = this.spatial(vol, pan);
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = "highpass"; f.frequency.value = metal ? 2500 : 800;
    n.connect(f); f.connect(g); g.connect(out); this.env(g, 0.001, 0.4, 0.06);
    n.start(); n.stop(this.t + 0.08);
    if (metal) {
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      o.frequency.value = 2800 + Math.random() * 1500; o.connect(og); og.connect(out); this.env(og, 0.001, 0.08, 0.25);
      o.start(); o.stop(this.t + 0.3);
    }
  }

  glass(vol = 0.6) {
    if (!this.ctx) return;
    const out = this.spatial(vol, 0);
    for (let i = 0; i < 6; i++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "sine"; o.frequency.value = 3000 + Math.random() * 5000;
      o.connect(g); g.connect(out); this.env(g, 0.001, 0.12, 0.08 + Math.random() * 0.2, this.t + i * 0.012);
      o.start(this.t + i * 0.012); o.stop(this.t + 0.4);
    }
  }

  explosion(vol = 1) {
    if (!this.ctx) return;
    const out = this.spatial(vol, 0);
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = "lowpass"; f.frequency.setValueAtTime(1800, this.t); f.frequency.exponentialRampToValueAtTime(90, this.t + 1.1);
    n.connect(f); f.connect(g); g.connect(out); this.env(g, 0.005, 1, 1.2);
    n.start(); n.stop(this.t + 1.3);
  }

  /** Heulender Sog am Leck: läuft, bis stop() aufgerufen wird */
  wind() {
    if (!this.ctx) return { stop() {}, set() {} };
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 1.4;
    n.connect(f); f.connect(g); g.connect(this.master);    // am Vakuumfilter vorbei: man spürt es im Anzug
    g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.9, this.t + 0.15);
    n.start();
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 0.7; lg.gain.value = 220; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    return {
      set: k => g.gain.setTargetAtTime(0.05 + k * 0.9, this.t, 0.1),
      stop: () => { g.gain.setTargetAtTime(0.0001, this.t, 0.4); setTimeout(() => { n.stop(); lfo.stop(); }, 2000); },
    };
  }

  alarm(on) {
    if (!this.ctx) return;
    if (on && !this.alarmNode) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      o.type = "triangle"; o.frequency.value = 760;
      lfo.type = "square"; lfo.frequency.value = 1.6; lg.gain.value = 180;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.06; o.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this.alarmNode = { o, lfo, g };
    } else if (!on && this.alarmNode) {
      const a = this.alarmNode; this.alarmNode = null;
      a.g.gain.setTargetAtTime(0.0001, this.t, 0.2);
      setTimeout(() => { a.o.stop(); a.lfo.stop(); }, 800);
    }
  }

  beep(freq = 880, dur = 0.08, vol = 0.15) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(this.master); this.env(g, 0.002, vol, dur);
    o.start(); o.stop(this.t + dur + 0.05);
  }

  /** Atemgeräusch im Helm — schneller und lauter bei Sauerstoffmangel */
  breath(stress) {
    if (!this.ctx) return;
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    f.type = "bandpass"; f.frequency.value = 900 + stress * 600; f.Q.value = 0.7;
    n.connect(f); f.connect(g); g.connect(this.master);
    const v = 0.03 + stress * 0.12;
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.exponentialRampToValueAtTime(v, this.t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + 1.1);
    n.start(); n.stop(this.t + 1.2);
  }

  footstep(vol = 0.18) {
    if (!this.ctx) return;
    const out = this.spatial(vol, 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(90, this.t); o.frequency.exponentialRampToValueAtTime(45, this.t + 0.08);
    o.connect(g); g.connect(out); this.env(g, 0.002, 0.5, 0.09);
    o.start(); o.stop(this.t + 0.12);
    const n = this.noiseSrc(), f = this.ctx.createBiquadFilter(), ng = this.ctx.createGain();
    f.type = "highpass"; f.frequency.value = 3000; n.connect(f); f.connect(ng); ng.connect(out); this.env(ng, 0.001, 0.08, 0.04);
    n.start(); n.stop(this.t + 0.06);
  }

  startAmbience() {
    // Tiefes Brummen der Lebenserhaltung
    const o1 = this.ctx.createOscillator(), o2 = this.ctx.createOscillator(), g = this.ctx.createGain();
    o1.frequency.value = 55; o2.frequency.value = 110.6; o2.type = "triangle";
    g.gain.value = 0.05;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 300;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.humGain = g;
    const n = this.noiseSrc(), nf = this.ctx.createBiquadFilter(), ng = this.ctx.createGain();
    nf.type = "lowpass"; nf.frequency.value = 500; ng.gain.value = 0.025;
    n.connect(nf); nf.connect(ng); ng.connect(this.vacuum); n.start();
  }
}
