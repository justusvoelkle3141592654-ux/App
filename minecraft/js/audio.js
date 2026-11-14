// audio.js — tiny WebAudio synthesizer. No external files; every sound is generated.
import { B, BLOCKS } from './registry.js';

// Material class of a block id -> 'stone' | 'grass' | 'wood' | 'sand' | 'glass' | 'cloth' | 'metal'
const MAT = new Array(256).fill('stone');
(function initMat() {
  const set = (m, ...ids) => ids.forEach((i) => { MAT[i] = m; });
  set('grass', B.GRASS, B.DIRT, B.LEAVES, B.LEAVES_BIRCH, B.LEAVES_SPRUCE, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW,
    B.SOUL_SAND, B.CLAY, B.CACTUS, B.SNOW);
  set('wood', B.PLANKS, B.LOG, B.LOG_BIRCH, B.LOG_SPRUCE, B.CRAFTING_TABLE, B.CHEST, B.TORCH);
  set('sand', B.SAND, B.GRAVEL);
  set('glass', B.GLASS, B.ICE);
  set('cloth', B.WOOL);
  set('metal', B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B.COAL_BLOCK);
})();
export function materialOf(blockId) { return MAT[blockId] || 'stone'; }

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.nbuf = null;
    this.volume = 0.5;
    this._last = Object.create(null);
    this._portalT = 0;
  }

  // call from a user gesture (click / keydown)
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._vol();
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
        // 1 second of white noise
        const n = this.ctx.sampleRate;
        this.nbuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.nbuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }
  _vol() { const v = this.game?.settings?.volume; return Math.max(0, Math.min(1, v == null ? this.volume : v)); }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this._vol(); }
  _ok(key, minGap) { // rate limit
    const t = performance.now();
    if (t - (this._last[key] || 0) < minGap) return false;
    this._last[key] = t; return true;
  }
  _c() {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const v = this._vol();
    if (this.master.gain.value !== v) this.master.gain.value = v;
    return v > 0 ? this.ctx : null;
  }

  // filtered noise burst
  noise(dur, o = {}) {
    const c = this._c(); if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const src = c.createBufferSource(); src.buffer = this.nbuf;
    const f = c.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    f.Q.value = o.q || 0.7;
    const g = c.createGain();
    const gain = (o.gain == null ? 0.3 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 0.5, dur + 0.05);
  }
  // simple oscillator tone with optional pitch slide
  tone(freq, dur, o = {}) {
    const c = this._c(); if (!c) return;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.slide), t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain == null ? 0.2 : o.gain, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (o.vib) { // vibrato
      const lfo = c.createOscillator(); lfo.frequency.value = o.vib; const lg = c.createGain(); lg.gain.value = freq * 0.05;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  // ---- material based sounds
  _mat(mat, kind) { // kind: 'break' | 'place' | 'step'
    const k = kind === 'step' ? 0.35 : kind === 'place' ? 0.7 : 1;
    const pitch = kind === 'place' ? 1.15 : kind === 'step' ? 0.95 : 1;
    const dur = kind === 'step' ? 0.07 : kind === 'place' ? 0.1 : 0.16;
    const r = 0.9 + Math.random() * 0.25;
    switch (mat) {
      case 'grass':
        this.noise(dur * 1.2, { type: 'bandpass', f0: 900 * pitch * r, f1: 500, q: 0.8, gain: 0.34 * k }); break;
      case 'wood':
        this.tone(190 * pitch * r, dur, { type: 'triangle', slide: 120, gain: 0.3 * k });
        this.noise(dur, { type: 'bandpass', f0: 700 * r, q: 1.2, gain: 0.2 * k }); break;
      case 'sand':
        this.noise(dur * 1.5, { type: 'bandpass', f0: 2600 * pitch * r, f1: 1500, q: 0.6, gain: 0.3 * k }); break;
      case 'glass':
        this.tone(2400 * r, dur * 0.8, { type: 'square', gain: 0.07 * k });
        this.tone(3300 * r, dur * 0.8, { type: 'square', gain: 0.05 * k, delay: 0.015 });
        this.noise(dur, { type: 'highpass', f0: 3500, gain: 0.2 * k }); break;
      case 'cloth':
        this.noise(dur * 1.3, { type: 'lowpass', f0: 500 * r, f1: 250, gain: 0.35 * k }); break;
      case 'metal':
        this.tone(900 * r * pitch, dur * 1.6, { type: 'sine', gain: 0.18 * k });
        this.tone(1350 * r, dur * 1.6, { type: 'sine', gain: 0.1 * k });
        this.noise(dur, { type: 'bandpass', f0: 1800, q: 1.5, gain: 0.15 * k }); break;
      default: // stone
        this.noise(dur, { type: 'lowpass', f0: 1900 * pitch * r, f1: 500, q: 0.9, gain: 0.5 * k });
        this.tone(130 * pitch * r, dur, { type: 'sine', slide: 70, gain: 0.25 * k });
    }
  }
  breakBlock(id) { if (this._ok('brk', 30)) this._mat(materialOf(id), 'break'); }
  place(id) { if (this._ok('plc', 30)) this._mat(materialOf(id), 'place'); }
  step(id) { if (this._ok('stp', 90)) this._mat(materialOf(id), 'step'); }
  dig(id) { if (this._ok('dig', 120)) this._mat(materialOf(id), 'step'); } // while mining

  // ---- misc
  hit() { this.noise(0.09, { type: 'bandpass', f0: 500, q: 0.8, gain: 0.45 }); this.tone(220, 0.08, { type: 'square', slide: 110, gain: 0.12 }); }
  crit() { this.hit(); this.tone(1400, 0.12, { type: 'triangle', slide: 2400, gain: 0.1 }); }
  hurt() {
    if (!this._ok('hurt', 150)) return;
    this.tone(330, 0.26, { type: 'sawtooth', slide: 130, gain: 0.2 });
    this.noise(0.15, { type: 'lowpass', f0: 900, gain: 0.25 });
  }
  explosion() {
    this.noise(1.3, { type: 'lowpass', f0: 700, f1: 50, q: 0.5, gain: 0.9, attack: 0.01 });
    this.tone(70, 0.9, { type: 'sine', slide: 30, gain: 0.5 });
    this.noise(0.4, { type: 'bandpass', f0: 2500, f1: 300, gain: 0.4 });
  }
  fuse() { if (this._ok('fuse', 400)) this.noise(0.5, { type: 'highpass', f0: 5000, gain: 0.12 }); }
  eat() {
    if (!this._ok('eat', 120)) return;
    this.noise(0.06, { type: 'bandpass', f0: 1400, q: 1.5, gain: 0.35 });
    this.noise(0.06, { type: 'bandpass', f0: 1000, q: 1.5, gain: 0.3, delay: 0.09 });
  }
  burp() { this.tone(110, 0.3, { type: 'sawtooth', slide: 70, gain: 0.2 }); }
  click() { this.tone(1100, 0.025, { type: 'square', gain: 0.08 }); }
  pickup() { if (this._ok('pop', 60)) this.tone(550 + Math.random() * 300, 0.09, { type: 'sine', slide: 1500, gain: 0.12 }); }
  levelup() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.08 })); }
  bow() { this.tone(200, 0.12, { type: 'triangle', slide: 90, gain: 0.25 }); this.noise(0.1, { type: 'highpass', f0: 2500, gain: 0.15 }); }
  splash() { this.noise(0.35, { type: 'bandpass', f0: 1200, f1: 400, q: 0.5, gain: 0.4 }); }
  teleport() { this.tone(300, 0.4, { type: 'sine', slide: 1200, gain: 0.2, vib: 14 }); this.tone(900, 0.4, { type: 'sine', slide: 200, gain: 0.1, delay: 0.1 }); }
  bucket() { this.noise(0.25, { type: 'lowpass', f0: 1500, f1: 500, gain: 0.3 }); }
  ignite() { this.noise(0.12, { type: 'highpass', f0: 3000, gain: 0.3 }); this.tone(1800, 0.05, { type: 'square', gain: 0.05 }); }
  death() { this.tone(260, 0.8, { type: 'sawtooth', slide: 55, gain: 0.25 }); }
  // portal ambience: call every frame while standing in a portal; it self rate limits
  portal() {
    if (!this._ok('portal', 1500)) return;
    this.tone(150, 1.6, { type: 'sine', slide: 260, gain: 0.12, vib: 5, attack: 0.3 });
    this.tone(225, 1.6, { type: 'triangle', slide: 130, gain: 0.05, vib: 7, attack: 0.4 });
    this.noise(1.5, { type: 'bandpass', f0: 500, f1: 1400, q: 2, gain: 0.07, attack: 0.5 });
  }

  // generic dispatcher so other modules can call game.audio.play('hurt'), play('break', blockId) ...
  play(name, arg) {
    switch (name) {
      case 'break': case 'dig_break': return this.breakBlock(arg);
      case 'place': return this.place(arg);
      case 'step': return this.step(arg);
      case 'dig': return this.dig(arg);
      case 'explode': case 'explosion': return this.explosion();
      default: { const f = this[name]; if (typeof f === 'function') return f.call(this, arg); }
    }
  }
}
export default GameAudio;
