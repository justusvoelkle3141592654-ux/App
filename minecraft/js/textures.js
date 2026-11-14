// textures.js — procedural 16x16 texture generation (Vanilla 1.12 look), atlases, GUI icons.
// No external assets: every pixel is generated from seeded noise / hand-placed patterns.
import * as THREE from 'three';
import { BLOCKS, ITEMS, allBlockTiles, allItemTiles, faceTile, getItem, TIERS, TOOL_KINDS, ARMOR_MATS, ARMOR_SLOTS } from './registry.js';

// ------------------------------------------------------------------ utils
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const _hc = {};
function C(h) {
  if (Array.isArray(h)) return h;
  return _hc[h] || (_hc[h] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
}
const mul = (c, f) => c.length > 3 ? [c[0] * f, c[1] * f, c[2] * f, c[3]] : [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pick = (pal, r) => C(pal[Math.min(pal.length - 1, Math.max(0, Math.floor(r * pal.length)))]);

function hash(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// tileable smooth value noise: lattice of `per` cells over 16px
function vnoise(x, y, per, seed) {
  const s = 16 / per, fx = x / s, fy = y / s;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const h = (i, j) => hash(((i % per) + per) % per, ((j % per) + per) % per, seed);
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  return (h(x0, y0) * (1 - u) + h(x0 + 1, y0) * u) * (1 - v) + (h(x0, y0 + 1) * (1 - u) + h(x0 + 1, y0 + 1) * u) * v;
}
// pixel noise blended with blotchy low-frequency noise, 0..1
function nz(x, y, seed, blot = 0.5, per = 4) {
  return clamp01(0.5 + (hash(x, y, seed) - 0.5) * (1 - blot) + (vnoise(x, y, per, seed + 101) - 0.5) * blot * 2.2);
}
// tileable Worley (cells) -> {d1,d2,id}
function worley(x, y, n, seed) {
  let d1 = 99, d2 = 99, id = 0; const cs = 16 / n;
  const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
    const wi = ((i % n) + n) % n, wj = ((j % n) + n) % n;
    const px = (i + 0.15 + 0.7 * hash(wi, wj, seed)) * cs, py = (j + 0.15 + 0.7 * hash(wi, wj, seed + 7)) * cs;
    const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
    if (d < d1) { d2 = d1; d1 = d; id = wi * 31 + wj; } else if (d < d2) d2 = d;
  }
  return { d1, d2, id };
}

class Pix {
  constructor() { this.d = new Uint8ClampedArray(1024); }
  set(x, y, c) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x > 15 || y > 15 || !c) return;
    const i = (y * 16 + x) * 4, d = this.d; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
  }
  a(x, y) { return (x < 0 || y < 0 || x > 15 || y > 15) ? 0 : this.d[(y * 16 + x) * 4 + 3]; }
  get(x, y) { const i = (y * 16 + x) * 4, d = this.d; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
  fill(fn) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, fn(x, y)); return this; }
}
function line(p, x0, y0, x1, y1, c) {
  const pts = []; let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
  for (;;) { pts.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  if (c) for (const [x, y] of pts) p.set(x, y, typeof c === 'function' ? c(x, y) : c);
  return pts;
}
function rect(p, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, typeof c === 'function' ? c(x, y) : c); }
function spans(p, sp, fn) { for (const y in sp) { const a = sp[y]; for (let x = a[0]; x <= a[1]; x++) p.set(x, +y, fn(x, +y)); } }
function disc(p, cx, cy, r, fn) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= r) p.set(x, y, fn(x, y, d)); } }
function outline(p, col) {
  const q = new Uint8ClampedArray(p.d);
  const al = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15) ? 0 : q[(y * 16 + x) * 4 + 3];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!al(x, y) && (al(x - 1, y) > 0 || al(x + 1, y) > 0 || al(x, y - 1) > 0 || al(x, y + 1) > 0)) p.set(x, y, col);
}
function ascii(p, rows, pal, ox = 0, oy = 0) {
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const ch = r[x]; if (ch !== '.' && ch !== ' ' && pal[ch]) p.set(x + ox, y + oy, C(pal[ch])); } });
}

// ------------------------------------------------------------------ block tile generators
const GEN = {};
const stoneFill = (p, seed, base = '#7d7d7d', amp = 0.24) => { const b = C(base); p.fill((x, y) => mul(b, 0.88 + nz(x, y, seed, 0.45) * amp)); };
const palFill = (p, pal, seed, blot = 0.5, per = 4) => p.fill((x, y) => pick(pal, nz(x, y, seed, blot, per)));

GEN.stone = () => { const p = new Pix(); stoneFill(p, 1); return p; };
GEN.dirt = () => {
  const p = new Pix();
  palFill(p, ['#5e4129', '#6b4a30', '#79553a', '#866043', '#94704f'], 11, 0.55, 4);
  for (let i = 0; i < 7; i++) p.set(Math.floor(hash(i, 1, 3) * 16), Math.floor(hash(i, 2, 3) * 16), C(i % 2 ? '#a08060' : '#4f3622'));
  return p;
};
GEN.grass_top = () => { const p = new Pix(); palFill(p, ['#5ea845', '#6fb552', '#79c05a', '#84c862', '#8fd069'], 21, 0.5, 4); return p; };
GEN.grass_side = () => {
  const p = GEN.dirt(); const g = ['#5ea845', '#6fb552', '#79c05a', '#84c862'];
  for (let x = 0; x < 16; x++) {
    const h = 2 + Math.floor(hash(x, 5, 31) * 3) + (hash(x, 6, 31) > 0.7 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, pick(g, hash(x, y, 33)));
    if (hash(x, 7, 31) > 0.55) p.set(x, h, mul(C('#5ea845'), 0.85));
  }
  return p;
};
GEN.cobblestone = () => {
  const p = new Pix();
  p.fill((x, y) => { const w = worley(x, y, 3, 5); if (w.d2 - w.d1 < 1.1) return mul(C('#555555'), 0.9 + hash(x, y, 2) * 0.2);
    const base = 100 + hash(w.id, 9, 4) * 38; const v = base + (hash(x, y, 6) - 0.5) * 16 - (w.d1 > 3.2 ? 6 : 0); return [v, v, v]; });
  return p;
};
const plankPal = { L: '#b8945f', M: '#9c7f4e', D: '#6b5530' };
function planks(p, seed, tone = 1) {
  const base = C(plankPal.M), jx = [5, 11, 2, 9];
  for (let b = 0; b < 4; b++) {
    const bs = 0.92 + hash(b, 1, seed) * 0.16;
    for (let r = 0; r < 4; r++) for (let x = 0; x < 16; x++) {
      const y = b * 4 + r; let f = bs;
      if (r === 3) f *= 0.7;
      else { f *= 0.93 + hash(Math.floor((x + b * 3) / 3), y, seed + 2) * 0.12; if (x === jx[b] && r < 3) f *= 0.72; if (r === 0) f *= 1.04; }
      p.set(x, y, mul(base, f * tone));
    }
  }
}
GEN.planks_oak = () => { const p = new Pix(); planks(p, 41); return p; };
GEN.bedrock = () => { const p = new Pix(); palFill(p, ['#1d1d1d', '#303030', '#434343', '#585858', '#6e6e6e'], 51, 0.6, 8); return p; };
GEN.sand = () => { const p = new Pix(); palFill(p, ['#cfc690', '#d6cd99', '#dbd3a0', '#e2dbad', '#e8e2bb'], 61, 0.35, 8); return p; };
GEN.gravel = () => { const p = new Pix(); palFill(p, ['#5a5654', '#6e6a67', '#7d7873', '#8b8682', '#9b9692', '#aaa49e'], 71, 0.75, 8); return p; };
GEN.clay = () => { const p = new Pix(); palFill(p, ['#979cab', '#a0a6b5', '#a6acbb', '#adb3c1'], 81, 0.3, 4); return p; };
GEN.snow = () => { const p = new Pix(); palFill(p, ['#e3ecee', '#eef4f6', '#f6fafb', '#ffffff'], 91, 0.2, 4); return p; };
GEN.wool_white = () => { const p = new Pix(); p.fill((x, y) => mul(C('#e8e8e8'), 0.88 + hash(x >> 1, y, 95) * 0.1 + hash(x, y, 96) * 0.08)); return p; };
GEN.netherrack = () => {
  const p = new Pix(); palFill(p, ['#4a2020', '#5c2a2a', '#6f3636', '#7d3c3c', '#8b4545'], 101, 0.6, 4);
  for (let i = 0; i < 6; i++) p.set(Math.floor(hash(i, 1, 9) * 16), Math.floor(hash(i, 2, 9) * 16), C('#a85a5a'));
  return p;
};
GEN.soul_sand = () => {
  const p = new Pix(); palFill(p, ['#3d2c20', '#4d3a2c', '#5a4536', '#66503f'], 111, 0.6, 4);
  for (const [x, y] of [[3, 3], [10, 2], [6, 8], [12, 10], [2, 12], [9, 13]]) { p.set(x, y, C('#2a1d14')); p.set(x + 1, y, C('#2a1d14')); p.set(x, y + 1, C('#33241a')); }
  return p;
};
GEN.glowstone = () => {
  const p = new Pix(); const pal = ['#a86f2a', '#d99f45', '#e8bc66', '#f6d68b', '#fceba8'];
  p.fill((x, y) => { const w = worley(x, y, 4, 12); const e = w.d2 - w.d1 < 1.0; const c = pick(pal, hash(w.id, 3, 5) * 0.8 + hash(x, y, 8) * 0.2); return e ? mul(C('#a9712d'), 0.9 + hash(x, y, 4) * 0.2) : c; });
  return p;
};
GEN.end_stone = () => { const p = new Pix(); palFill(p, ['#bfc28a', '#cfd29a', '#dcdfa6', '#e6e8b3'], 121, 0.55, 4); return p; };
GEN.obsidian = () => {
  const p = new Pix(); palFill(p, ['#0c0914', '#120e1f', '#1b1429', '#241a38'], 131, 0.55, 4);
  for (let i = 0; i < 18; i++) p.set(Math.floor(hash(i, 1, 13) * 16), Math.floor(hash(i, 2, 13) * 16), C(i % 3 ? '#2e2449' : '#3d2f63'));
  return p;
};
GEN.ice = () => {
  const p = new Pix(); p.fill((x, y) => { const v = nz(x, y, 141, 0.5, 4); const c = mix(C('#6f9bf0'), C('#a9c8ff'), v); return [c[0], c[1], c[2], 210]; });
  for (const [x, y] of [[3, 2], [4, 3], [5, 4], [10, 9], [11, 10], [12, 11]]) p.set(x, y, [220, 235, 255, 230]);
  return p;
};
GEN.glass = () => {
  const p = new Pix();
  for (let i = 0; i < 16; i++) { const c = [182, 214, 226, 255]; p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); }
  for (const [x, y] of [[2, 2], [3, 3], [4, 4], [3, 2], [2, 3], [5, 2], [2, 5], [12, 12], [11, 13], [13, 11]]) p.set(x, y, [240, 250, 255, 230]);
  return p;
};
GEN.leaves_oak = () => leaves(['#256b14', '#2f7a1c', '#3a8a24', '#4a9a2e', '#1c5a0e'], 151);
GEN.leaves_birch = () => leaves(['#5a8a30', '#6a9f3a', '#7ab048', '#88bc52', '#4c7a28'], 152);
GEN.leaves_spruce = () => leaves(['#1f3f1f', '#2a4f2a', '#335a33', '#3d683d', '#183318'], 153);
function leaves(pal, seed) {
  const p = new Pix();
  p.fill((x, y) => { const n = nz(x, y, seed + 40, 0.65, 4); if (n < 0.22 && hash(x, y, seed) < 0.8) return [0, 0, 0, 0]; return pick(pal, nz(x, y, seed, 0.4, 4)); });
  return p;
}
// logs
function barkSide(pal, seed) {
  const p = new Pix();
  p.fill((x, y) => { const r = clamp01(hash(x, 0, seed) * 0.55 + hash(x, y >> 2, seed + 1) * 0.25 + hash(x, y, seed + 2) * 0.2); return pick(pal, r); });
  return p;
}
function logTop(bark, inner, seed) {
  const p = new Pix();
  p.fill((x, y) => {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5), d = Math.max(dx, dy);
    if (d > 5.5) return mul(C(bark), 0.8 + hash(x, y, seed) * 0.4);
    const ring = Math.floor(d); const f = (ring % 2 ? 0.88 : 1.0) * (0.95 + hash(x, y, seed + 1) * 0.1);
    return mul(C(inner), d < 1.5 ? 0.9 : f);
  });
  return p;
}
GEN.log_oak = () => barkSide(['#4d3a20', '#5a4527', '#675131', '#745c38'], 161);
GEN.log_oak_top = () => logTop('#675131', '#a98b5a', 162);
GEN.log_spruce = () => barkSide(['#2a1c0c', '#35240f', '#3f2b14', '#4b341a'], 163);
GEN.log_spruce_top = () => logTop('#3f2b14', '#7a5a35', 164);
GEN.log_birch = () => {
  const p = new Pix(); p.fill((x, y) => mul(C('#d6d6ce'), 0.9 + hash(x, y >> 1, 171) * 0.14 + hash(x, y, 172) * 0.04));
  for (let i = 0; i < 9; i++) { const x = Math.floor(hash(i, 1, 17) * 12), y = Math.floor(hash(i, 2, 17) * 15), w = 2 + Math.floor(hash(i, 3, 17) * 3);
    for (let k = 0; k < w; k++) p.set(x + k, y, C(k % 2 ? '#3a3a38' : '#222222')); if (hash(i, 4, 17) > 0.5) p.set(x, y + 1, C('#4a4a46')); }
  return p;
};
GEN.log_birch_top = () => logTop('#d0d0c6', '#c8b77a', 173);
// ores
const ORE_BLOBS = [[[2, 2], [3, 2], [3, 3]], [[9, 3], [10, 3], [10, 4], [11, 4]], [[5, 7], [6, 7], [5, 8], [6, 8]], [[11, 9], [12, 9], [12, 10]], [[2, 11], [3, 11], [3, 12], [4, 12]], [[8, 12], [9, 12], [9, 13]], [[13, 2], [13, 3]]];
function ore(seed, main, light, dark, base = 'stone') {
  const p = base === 'stone' ? GEN.stone() : GEN.netherrack();
  const m = C(main), l = C(light), d = C(dark);
  ORE_BLOBS.forEach((b, bi) => b.forEach(([x, y], i) => { const r = hash(x, y, seed + bi); p.set(x, y, i === 0 ? l : (r < 0.25 ? d : r > 0.8 ? l : m)); }));
  return p;
}
GEN.coal_ore = () => ore(1, '#1a1a1a', '#454545', '#000000');
GEN.iron_ore = () => ore(2, '#d8af93', '#efd2bd', '#b38465');
GEN.gold_ore = () => ore(3, '#fbe94a', '#fff9a8', '#c99c10');
GEN.diamond_ore = () => ore(4, '#4eddd0', '#a6fff6', '#26a09e');
GEN.redstone_ore = () => ore(5, '#e01010', '#ff5a5a', '#8a0000');
GEN.quartz_ore = () => ore(6, '#eee7dd', '#ffffff', '#c3baac', 'nether');
// bricks
function brickPattern(cols, mortar, seed, rows = 4) {
  const p = new Pix(); const rh = 16 / rows;
  p.fill((x, y) => {
    const r = Math.floor(y / rh), ry = y % rh; const off = (r % 2) * 4;
    const mortarH = ry === rh - 1, mortarV = ((x + off) % 8) === 7 && !mortarH;
    if (mortarH || mortarV) return mul(C(mortar), 0.92 + hash(x, y, seed + 3) * 0.16);
    const id = Math.floor((x + off) / 8) + r * 3;
    return mul(pick(cols, hash(id, 4, seed)), 0.93 + hash(x, y, seed) * 0.14);
  });
  return p;
}
GEN.brick = () => brickPattern(['#9c5a4a', '#8f4f40', '#a56252', '#8a4a3b'], '#b3a89c', 181);
GEN.nether_brick = () => brickPattern(['#2e171b', '#3a1d22', '#331a1e', '#42232a'], '#1d0e11', 182);
GEN.stonebrick = () => {
  const p = new Pix();
  p.fill((x, y) => {
    const r = y >> 3; const mh = (y % 8) === 7, mv = r === 0 ? x === 7 : (x === 3 || x === 11);
    if (mh || mv) return mul(C('#686868'), 0.92 + hash(x, y, 3) * 0.14);
    let v = 118 + (hash(x, y, 191) - 0.5) * 18 + (hash(r * 3 + (x > 7 ? 1 : 0), 9, 4) - 0.5) * 14; if (y % 8 === 0 || x === (r ? 4 : 8)) v += 8; return [v, v, v];
  });
  return p;
};
// metal/gem blocks
function metalBlock(light, mid, dark, seed, noise = 0.06) {
  const p = new Pix(); const L = C(light), M = C(mid), D = C(dark);
  p.fill((x, y) => {
    if (x === 0 || y === 0) return L; if (x === 15 || y === 15) return D;
    if (x === 1 || y === 1) return mix(L, M, 0.5); if (x === 14 || y === 14) return mix(D, M, 0.5);
    return mul(M, 1 - noise + hash(x, y, seed) * noise * 2);
  });
  return p;
}
GEN.iron_block = () => metalBlock('#f4f4f4', '#dcdcdc', '#a8a8a8', 201);
GEN.gold_block = () => metalBlock('#fff9a0', '#f9e04a', '#c99a14', 202);
GEN.diamond_block = () => { const p = metalBlock('#c2fff7', '#62ecdf', '#2fa8a2', 203, 0.1); for (const [x, y] of [[4, 4], [5, 5], [10, 9], [11, 10], [7, 12]]) p.set(x, y, C('#d8fffb')); return p; };
GEN.coal_block = () => { const p = new Pix(); palFill(p, ['#0a0a0a', '#141414', '#1c1c1c', '#262626'], 204, 0.5, 4); return p; };
GEN.dragon_egg = () => {
  const p = new Pix(); p.fill((x, y) => { const r = hash(x, y, 211); const c = mul(C('#0d0a14'), 0.8 + hash(x, y, 212) * 0.5); return r > 0.84 ? (r > 0.96 ? C('#8a4ac8') : C('#4b1f7a')) : c; });
  return p;
};
// crafting table
function ctBase(top) { const p = new Pix(); planks(p, 221, 0.92); rect(p, 0, 0, 15, top, (x, y) => mul(C('#7a5a2d'), 0.85 + hash(x, y, 5) * 0.15)); for (let x = 0; x < 16; x++) p.set(x, top + 1, C('#3f2a12')); return p; }
GEN.crafting_table_top = () => {
  const p = new Pix(); p.fill((x, y) => mul(C('#b08b55'), 0.9 + hash(x, y, 231) * 0.16));
  for (let i = 0; i < 16; i++) { const c = C('#4a3418'); p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); p.set(i, 7, c); p.set(i, 8, c); p.set(7, i, c); p.set(8, i, c); }
  for (let i = 1; i < 15; i++) { const c = C('#8a6a3a'); p.set(i, 1, c); p.set(1, i, c); p.set(i, 14, c); p.set(14, i, c); }
  for (let i = 0; i < 16; i++) { p.set(i, 7, C('#4a3418')); p.set(i, 8, C('#5d4422')); p.set(7, i, C('#4a3418')); p.set(8, i, C('#5d4422')); }
  return p;
};
function saw(p, x, y) { for (let k = 0; k < 8; k++) p.set(x, y + k, k % 2 ? C('#d0d0d0') : C('#9a9a9a')); p.set(x + 1, y + 1, C('#8a8a8a')); p.set(x + 1, y + 4, C('#8a8a8a')); rect(p, x - 1, y - 3, x + 1, y - 1, C('#6a4a22')); }
function hammer(p, x, y) { rect(p, x, y, x + 1, y + 9, C('#6a4a22')); rect(p, x - 2, y - 2, x + 3, y, C('#b0b0b0')); rect(p, x - 2, y - 2, x + 3, y - 2, C('#dcdcdc')); }
GEN.crafting_table_side = () => { const p = ctBase(2); saw(p, 3, 6); hammer(p, 10, 6); rect(p, 6, 8, 7, 12, C('#3a2a14')); return p; };
GEN.crafting_table_front = () => { const p = ctBase(2); hammer(p, 4, 6); saw(p, 11, 6); rect(p, 7, 9, 8, 12, C('#cfcfcf')); p.set(7, 8, C('#8a8a8a')); p.set(8, 8, C('#8a8a8a')); return p; };
// furnace
const furnBase = () => { const p = new Pix(); p.fill((x, y) => { const w = worley(x, y, 3, 25); if (w.d2 - w.d1 < 1.0) return mul(C('#5c5c5c'), 0.9 + hash(x, y, 2) * 0.2); const v = 118 + hash(w.id, 9, 4) * 26 + (hash(x, y, 6) - 0.5) * 14; return [v, v, v]; }); return p; };
GEN.furnace_side = () => furnBase();
GEN.furnace_top = () => { const p = furnBase(); for (let i = 0; i < 16; i++) { const c = C('#6a6a6a'); p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); } return p; };
function furnFront(lit) {
  const p = furnBase();
  rect(p, 3, 2, 12, 5, C('#2a2a2a')); rect(p, 3, 5, 12, 5, C('#6a6a6a')); rect(p, 3, 2, 12, 2, C('#1a1a1a'));
  rect(p, 2, 7, 13, 14, C('#0c0c0c')); rect(p, 2, 14, 13, 14, C('#707070')); rect(p, 2, 7, 13, 7, C('#3a3a3a'));
  if (lit) {
    for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) { const t = (y - 8) / 5; const n = hash(x, y, 33); const c = t > 0.6 ? mix(C('#ffd040'), C('#fff590'), n) : mix(C('#e85010'), C('#ffa020'), n * (1 - t) + 0.2); if (hash(x, y, 34) > 0.15 + t * 0.2) p.set(x, y, c); }
    rect(p, 4, 3, 11, 4, C('#8a2a08')); for (let x = 4; x < 12; x++) if (hash(x, 3, 35) > 0.4) p.set(x, 4, C('#ff8a20'));
  }
  return p;
}
GEN.furnace_front = () => furnFront(false);
GEN.furnace_front_lit = () => furnFront(true);
// torch / plants
GEN.torch = () => {
  const p = new Pix();
  for (let y = 6; y < 16; y++) { p.set(7, y, mul(C('#8a6a35'), 0.95 + hash(7, y, 3) * 0.12)); p.set(8, y, mul(C('#6d5128'), 0.95 + hash(8, y, 4) * 0.12)); }
  p.set(7, 5, C('#fff070')); p.set(8, 5, C('#f9c933')); p.set(7, 6, C('#ffc030')); p.set(8, 6, C('#e8901a'));
  return p;
};
GEN.tallgrass = () => {
  const p = new Pix(); const g = ['#4f9a38', '#5ea845', '#6fb552', '#7ec35c', '#8fd069'];
  const blades = [[1, 7], [2, 10], [3, 6], [4, 11], [5, 8], [6, 13], [7, 9], [8, 12], [9, 7], [10, 11], [11, 9], [12, 13], [13, 6], [14, 9]];
  blades.forEach(([x, h], i) => { for (let k = 0; k < h; k++) { const y = 15 - k; const lean = k > h * 0.6 ? (i % 2 ? 1 : -1) : 0; p.set(x + lean, y, mul(pick(g, hash(x, y, 7)), 0.8 + (k / h) * 0.3)); } });
  return p;
};
GEN.flower_rose = () => {
  const p = new Pix(); const st = C('#3a8a22');
  for (let y = 8; y < 16; y++) p.set(7, y, mul(st, 0.85 + hash(7, y, 2) * 0.2)); p.set(8, 12, st); p.set(9, 11, st); p.set(6, 13, st); p.set(5, 12, st);
  rect(p, 6, 4, 8, 7, C('#d8242c')); p.set(5, 5, C('#b01a20')); p.set(9, 5, C('#b01a20')); p.set(7, 3, C('#e8383c')); p.set(6, 4, C('#e8383c'));
  p.set(7, 5, C('#7a0e12')); p.set(8, 6, C('#a01820')); p.set(6, 7, C('#a01820'));
  return p;
};
GEN.flower_dandelion = () => {
  const p = new Pix(); const st = C('#3a8a22');
  for (let y = 8; y < 16; y++) p.set(7, y, mul(st, 0.85 + hash(7, y, 3) * 0.2)); p.set(8, 12, st); p.set(6, 13, st);
  rect(p, 5, 4, 9, 7, C('#f6e41a')); p.set(5, 4, [0, 0, 0, 0]); p.set(9, 4, [0, 0, 0, 0]); p.set(5, 7, [0, 0, 0, 0]); p.set(9, 7, [0, 0, 0, 0]);
  p.set(7, 3, C('#f9ec50')); p.set(6, 5, C('#e8a010')); p.set(7, 5, C('#f2b818')); p.set(7, 6, C('#fff070')); p.set(6, 6, C('#d8c010'));
  return p;
};
// cactus
GEN.cactus_side = () => {
  const p = new Pix(); p.fill((x, y) => { const stripe = (x % 4 === 1 || x % 4 === 2) ? 1.0 : 0.82; const edge = (x === 0 || x === 15) ? 0.62 : 1; return mul(C('#1a8a2a'), stripe * edge * (0.92 + hash(x, y, 241) * 0.16)); });
  for (const [x, y] of [[2, 2], [6, 4], [10, 2], [13, 5], [3, 8], [8, 9], [12, 11], [5, 13], [1, 11], [9, 14]]) { p.set(x, y, C('#dfffd0')); }
  return p;
};
GEN.cactus_top = () => {
  const p = new Pix(); p.fill((x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); if (d > 6.5) return mul(C('#0d5a1a'), 0.9 + hash(x, y, 1) * 0.2);
    if (d < 1.8) return C('#2fb040'); return mul(C('#1a8a2a'), 0.9 + hash(x, y, 242) * 0.2); });
  for (let i = 3; i < 13; i++) { p.set(i, 7, C('#2a9a3a')); p.set(7, i, C('#2a9a3a')); }
  return p;
};
GEN.cactus_bottom = () => { const p = new Pix(); p.fill((x, y) => mul(C('#0d6a1a'), 0.9 + hash(x, y, 243) * 0.2)); return p; };
// sandstone
GEN.sandstone = () => {
  const p = new Pix(); p.fill((x, y) => { let c = mul(C('#d9d0a0'), 0.94 + hash(x, y, 251) * 0.1 + (y > 12 ? -0.05 : 0)); if (y === 3) c = mul(C('#c2b884'), 0.95 + hash(x, y, 2) * 0.1); if (y === 4) c = mul(C('#e6dfb2'), 1); return c; });
  for (let x = 0; x < 16; x++) if (hash(x, 1, 8) > 0.6) p.set(x, 11, mul(C('#cfc590'), 1));
  return p;
};
GEN.sandstone_top = () => { const p = new Pix(); p.fill((x, y) => { const e = x === 0 || y === 0 || x === 15 || y === 15; return mul(C('#dbd2a2'), (e ? 0.93 : 1) * (0.95 + hash(x, y, 252) * 0.1)); }); return p; };
GEN.sandstone_bottom = () => { const p = new Pix(); p.fill((x, y) => mul(C('#c9bf8e'), 0.94 + hash(x, y, 253) * 0.1)); return p; };
// TNT
GEN.tnt_side = () => {
  const p = new Pix(); p.fill((x, y) => { let f = 0.92 + hash(x, y, 261) * 0.12; if (x % 4 === 3) f *= 0.78; if (y < 2) f *= 0.8; return mul(C('#c4282c'), f); });
  rect(p, 0, 5, 15, 10, (x, y) => mul(C('#d9d2c4'), 0.94 + hash(x, y, 262) * 0.1)); rect(p, 0, 5, 15, 5, C('#a8a094')); rect(p, 0, 10, 15, 10, C('#a8a094'));
  const T = ['111', '010', '010', '010', '010'], N = ['101', '111', '111', '101', '101'];
  const glyph = (g, x0) => g.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') p.set(x0 + rx, 6 + ry - 0, C('#2a1a18')); });
  glyph(T, 2); glyph(N, 6); glyph(T, 10);
  return p;
};
GEN.tnt_top = () => {
  const p = new Pix(); p.fill((x, y) => { const e = x === 0 || y === 0 || x === 15 || y === 15; return mul(C('#c4282c'), (e ? 0.8 : 1) * (0.92 + hash(x, y, 271) * 0.12)); });
  disc(p, 7.5, 7.5, 3.2, (x, y, d) => d < 1.2 ? C('#1a1210') : C('#cdbf9a'));
  return p;
};
GEN.tnt_bottom = () => { const p = new Pix(); p.fill((x, y) => { const e = x === 0 || y === 0 || x === 15 || y === 15; return mul(C('#b8332f'), (e ? 0.75 : 1) * (0.9 + hash(x, y, 272) * 0.14)); }); return p; };
// end portal frame / chest
GEN.endframe_top = () => {
  const p = new Pix(); p.fill((x, y) => { if (x === 0 || y === 0 || x === 15 || y === 15) return C('#254a3a'); return mul(C('#3f7358'), 0.9 + hash(x, y, 281) * 0.2); });
  rect(p, 4, 4, 11, 11, C('#143328')); rect(p, 5, 5, 10, 10, C('#0b1f18')); rect(p, 3, 3, 12, 3, C('#2a5442')); rect(p, 3, 12, 12, 12, C('#5a9a78')); rect(p, 3, 3, 3, 12, C('#2a5442')); rect(p, 12, 3, 12, 12, C('#5a9a78'));
  return p;
};
GEN.endframe_side = () => {
  const p = new Pix(); p.fill((x, y) => { if (y >= 11) return mul(C('#d6d99d'), 0.9 + hash(x, y, 282) * 0.2); return mul(C('#3f7358'), 0.88 + hash(x, y, 283) * 0.22); });
  for (let x = 0; x < 16; x++) { p.set(x, 0, C('#5a9a78')); p.set(x, 10, C('#254a3a')); }
  for (let y = 0; y < 11; y++) if (y % 4 === 2) for (let x = 0; x < 16; x++) if (x % 3 !== 0) p.set(x, y, mul(C('#3f7358'), 0.75));
  return p;
};
function chestBase(seed) {
  const p = new Pix(); p.fill((x, y) => { const g = 0.92 + hash(x, y >> 0, seed) * 0.1 + (y % 4 === 0 ? 0.04 : 0); return mul(C('#a0742b'), g); });
  for (let i = 0; i < 16; i++) { const c = C('#5a3a10'); p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); }
  for (let i = 1; i < 15; i++) { p.set(i, 1, C('#c09040')); p.set(1, i, C('#b88636')); p.set(14, i, C('#7a5016')); p.set(i, 14, C('#7a5016')); }
  return p;
}
GEN.chest_top = () => chestBase(291);
GEN.chest_side = () => { const p = chestBase(292); for (let x = 1; x < 15; x++) { p.set(x, 5, C('#3a2408')); p.set(x, 6, C('#c09040')); } return p; };
GEN.chest_front = () => { const p = GEN.chest_side(); rect(p, 7, 3, 8, 8, C('#cfcfcf')); p.set(7, 8, C('#6a6a6a')); p.set(8, 8, C('#6a6a6a')); p.set(7, 7, C('#2a2a2a')); p.set(8, 7, C('#9a9a9a')); return p; };

// ------------------------------------------------------------------ animated tiles (frame -> Pix)
const ANIM = {};
ANIM.water = (t) => {
  const p = new Pix(); const T = Math.PI * 2 / 16;
  p.fill((x, y) => {
    const v = 0.5 + 0.22 * Math.sin(T * (x + 2 * y) + t * 0.5) + 0.16 * Math.sin(T * (2 * x - y) - t * 0.7) + (vnoise(x + t * 0.15, y + t * 0.25, 4, 301) - 0.5) * 0.5;
    const c = mix(C('#2540c8'), C('#4a7cee'), clamp01(v)); return [c[0], c[1], c[2], 178];
  });
  return p;
};
ANIM.lava = (t) => {
  const p = new Pix(); const st = [[0, '#8a1a04'], [0.3, '#c83a08'], [0.5, '#f26a10'], [0.72, '#fc9a20'], [1, '#ffe05a']];
  p.fill((x, y) => {
    const v = clamp01(0.15 + vnoise(x, y - t * 0.12, 4, 311) * 0.55 + vnoise(x + 3, y - t * 0.25 + 5, 8, 312) * 0.45 * 0.9);
    for (let i = 1; i < st.length; i++) if (v <= st[i][0]) { const a = st[i - 1], b = st[i]; return mix(C(a[1]), C(b[1]), (v - a[0]) / (b[0] - a[0])); }
    return C(st[st.length - 1][1]);
  });
  return p;
};
ANIM.portal = (t) => {
  const p = new Pix(); const T = Math.PI * 2 / 16;
  p.fill((x, y) => {
    const v = clamp01(0.5 + 0.3 * Math.sin(T * (x + y) + t * 0.45) + 0.2 * Math.sin(T * (2 * x - y * 2) - t * 0.6) + (vnoise(x, y + t * 0.2, 4, 321) - 0.5) * 0.6);
    const c = mix(C('#3a0a8a'), C('#c070ff'), v); return [c[0], c[1], c[2], 150 + v * 90];
  });
  return p;
};
ANIM.fire = (t) => {
  const p = new Pix();
  for (let x = 0; x < 16; x++) {
    const h = 6 + 8 * vnoise(x + 0.5, t * 0.35, 8, 331) + 3 * vnoise(x * 2, t * 0.9 + 3, 8, 332);
    for (let k = 0; k < 16; k++) {
      const y = 15 - k; const r = k / h; if (r > 1) break;
      const n = hash(x, y, 333 + Math.floor(t)) * 0.35; if (r + n * r > 1) continue;
      const c = r < 0.3 ? mix(C('#fff7a0'), C('#ffd040'), r / 0.3) : r < 0.7 ? mix(C('#ffd040'), C('#ff7a10'), (r - 0.3) / 0.4) : mix(C('#ff7a10'), C('#c82a08'), (r - 0.7) / 0.3);
      p.set(x, y, [c[0], c[1], c[2], 255]);
    }
  }
  return p;
};
ANIM.end_portal = (t) => {
  const p = new Pix(); const cols = ['#3dd6c8', '#2fa8ff', '#9a6aff', '#5af0a0'];
  p.fill((x, y) => { const v = vnoise(x, y + t * 0.1, 4, 341) * vnoise(x + t * 0.08, y, 8, 342); return [3 + v * 14, 6 + v * 34, 10 + v * 36]; });
  for (let l = 0; l < 3; l++) for (let i = 0; i < 10; i++) {
    const sx = Math.floor(hash(i, l, 343) * 16), sy = Math.floor(hash(i, l, 344) * 16);
    const x = (sx + Math.floor(t * (0.12 + l * 0.07) * (l % 2 ? 1 : -1)) + 160) % 16, y = (sy + Math.floor(t * (0.1 + l * 0.05)) + 160) % 16;
    const tw = 0.55 + 0.45 * Math.sin(t * 0.5 + i * 1.7 + l);
    p.set(x, y, mul(C(cols[(i + l) % 4]), 0.45 + 0.65 * tw));
  }
  return p;
};
export const animatedTiles = { water: true, lava: true, portal: true, fire: true, end_portal: true };

// ------------------------------------------------------------------ item sprites
const MATS = {
  wood: { L: '#b8945f', M: '#9c7f4e', D: '#6b5530' }, stone: { L: '#a8a8a8', M: '#818181', D: '#585858' },
  iron: { L: '#f4f4f4', M: '#cdcdcd', D: '#8c8c8c' }, gold: { L: '#fff58a', M: '#f5cf3a', D: '#c4901a' },
  diamond: { L: '#b0fff4', M: '#4fe3d2', D: '#1fa5a0' }, leather: { L: '#c68a5a', M: '#a06540', D: '#6f4326' },
};
const STK = { L: '#a58650', M: '#8a6a38', D: '#5c4524' };
function stick(p, x0, y0, x1, y1) { const pts = line(p, x0, y0, x1, y1); pts.forEach(([x, y], i) => p.set(x, y, C(i % 2 ? STK.L : STK.M))); }
function toolSprite(tier, kind) {
  const p = new Pix(); const m = MATS[tier]; const L = C(m.L), M = C(m.M), D = C(m.D);
  const ol = mul(D, 0.42);
  if (kind === 'pickaxe') {
    stick(p, 2, 14, 10, 6);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 6, dy = 10 - y, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx) * 180 / Math.PI;
      if (r >= 5.2 && r <= 7.1 && th >= -22 && th <= 115) p.set(x, y, r > 6.3 ? L : r < 5.8 ? D : M);
    }
  } else if (kind === 'axe') {
    stick(p, 2, 14, 11, 5);
    spans(p, { 1: [8, 10], 2: [6, 12], 3: [5, 12], 4: [5, 10], 5: [6, 9] }, (x, y) => y <= 2 ? L : (y >= 5 || x >= 11) ? D : M);
    stick(p, 10, 6, 11, 5);
  } else if (kind === 'shovel') {
    stick(p, 2, 14, 10, 6);
    disc(p, 11.5, 4.5, 3.4, (x, y) => (x + y < 14.5) ? L : (x + y > 16.5) ? D : M);
  } else if (kind === 'hoe') {
    stick(p, 2, 14, 11, 5);
    spans(p, { 2: [7, 12], 3: [7, 12], 4: [7, 8], 5: [7, 8] }, (x, y) => y === 2 ? L : (x >= 11 || y >= 4) ? D : M);
    stick(p, 10, 6, 11, 5);
  } else if (kind === 'sword') {
    const wood = [C(STK.L), C(STK.M), C(STK.D)];
    for (let i = 1; i <= 9; i++) p.set(5 + i, 11 - i, D);
    for (let i = 1; i <= 10; i++) p.set(4 + i, 11 - i, L);
    line(p, 2, 9, 6, 13, (x, y) => wood[(x + y) % 3 === 0 ? 0 : 1]); line(p, 4, 12, 1, 15, (x, y) => wood[(x + y) % 2]);
    p.set(1, 15, C(STK.D));
  }
  outline(p, kind === 'sword' ? [26, 20, 14] : [ol[0], ol[1], ol[2]]);
  return p;
}
function armorSprite(mat, slot) {
  const p = new Pix(); const m = MATS[mat]; const L = C(m.L), M = C(m.M), D = C(m.D);
  const R = { helmet: [[3, 3, 12, 7], [4, 2, 11, 2], [3, 8, 5, 10], [10, 8, 12, 10]], chestplate: [[4, 2, 11, 13], [1, 3, 3, 8], [12, 3, 14, 8], [3, 3, 4, 7], [11, 3, 12, 7]], leggings: [[3, 2, 12, 6], [3, 7, 7, 14], [8, 7, 12, 14]], boots: [[2, 7, 6, 12], [2, 12, 7, 13], [9, 7, 13, 12], [9, 12, 14, 13]] }[slot];
  const inS = (x, y) => R.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
  const cut = slot === 'chestplate' ? ((x, y) => x >= 6 && x <= 9 && y <= 3) : slot === 'leggings' ? ((x, y) => x === 7 && y > 6 && false) : () => false;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!inS(x, y) || cut(x, y)) continue;
    let c = M; const r = hash(x, y, 400 + slot.length);
    if (!inS(x - 1, y) || !inS(x, y - 1) || cut(x - 1, y) || cut(x, y - 1)) c = L; else if (!inS(x + 1, y) || !inS(x, y + 1)) c = D; else c = mul(M, 0.93 + r * 0.14);
    p.set(x, y, c);
  }
  if (slot === 'leggings') for (let y = 7; y < 14; y++) { p.set(7, y, p.a(7, y) ? D : null); p.set(8, y, p.a(8, y) ? L : null); }
  if (slot === 'chestplate') { for (let y = 4; y < 13; y++) { p.set(7, y, mul(M, 0.85)); p.set(8, y, mul(M, 0.85)); } }
  if (mat === 'leather' && slot !== 'boots') for (let x = 4; x < 12; x++) if (x % 2 === 0) p.set(x, slot === 'helmet' ? 7 : slot === 'chestplate' ? 12 : 6, D);
  outline(p, mul(D, 0.4));
  return p;
}
function lump(p, cx, cy, r, L, M, D) {
  disc(p, cx, cy, r + 1.6, (x, y, d) => { const rr = r + (hash(x, y, 7) - 0.5) * 2.4; if (d > rr) return null; const s = (x - cx) + (y - cy); return s < -2 ? L : s > 2 ? D : M; });
}
function pile(p, pal, seed, cx = 8, cy = 10, rx = 6, ry = 3.5) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (d <= 1 && hash(x, y, seed) < 0.9 - d * 0.35) p.set(x, y, pick(pal, hash(x, y, seed + 1))); }
}
function ellipseRot(p, cx, cy, a, b, ang, fn) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = x - cx, dy = y - cy; const u = dx * ca + dy * sa, v = -dx * sa + dy * ca; const d = (u / a) ** 2 + (v / b) ** 2; if (d <= 1) p.set(x, y, fn(x, y, u, v, d)); }
}
function meat(base, hi, lo, bone) {
  const p = new Pix(); const B = C(base), H = C(hi), Lo = C(lo);
  ellipseRot(p, 8.5, 8, 6.3, 4.2, -0.6, (x, y, u, v, d) => d > 0.72 ? Lo : (hash(x, y, 9) > 0.8 ? H : (v < -1.5 ? mix(B, H, 0.4) : B)));
  if (bone) { disc(p, 3.5, 11.5, 1.6, () => C('#efe9d8')); p.set(3, 12, C('#bdb59c')); }
  outline(p, mul(Lo, 0.45)); return p;
}
function bucket(content) {
  const p = new Pix(); const L = C('#d8d8d8'), M = C('#a8a8a8'), D = C('#6a6a6a');
  spans(p, { 3: [3, 12], 4: [3, 12], 5: [4, 11], 6: [4, 11], 7: [4, 11], 8: [4, 11], 9: [4, 11], 10: [5, 10], 11: [5, 10], 12: [5, 10] }, (x, y) => x <= 4 ? L : x >= 10 ? D : M);
  rect(p, 3, 3, 12, 3, L); rect(p, 4, 4, 11, 4, (x, y) => content ? content : C('#3a3a3a'));
  if (content) rect(p, 4, 5, 11, 5, mul(content, 0.85));
  outline(p, [30, 30, 36]); return p;
}
GEN.item_stick = () => { const p = new Pix(); stick(p, 3, 13, 12, 4); line(p, 4, 13, 12, 5); outline(p, [40, 28, 14]); return p; };
GEN.item_coal = () => { const p = new Pix(); lump(p, 8, 8.5, 4.4, C('#4a4a4a'), C('#242424'), C('#0c0c0c')); outline(p, [8, 8, 8]); return p; };
GEN.item_charcoal = () => { const p = new Pix(); lump(p, 8, 8.5, 4.4, C('#5e5046'), C('#3a2f28'), C('#1e1814')); outline(p, [14, 10, 8]); return p; };
function ingot(L, M, D) {
  const p = new Pix(); const l = C(L), m = C(M), d = C(D);
  spans(p, { 5: [6, 13], 6: [5, 12], 7: [4, 11] }, () => l); spans(p, { 8: [4, 11], 9: [4, 11], 10: [4, 11] }, (x, y) => y === 10 ? mul(m, 0.8) : m);
  spans(p, { 6: [13, 13], 7: [12, 13], 8: [12, 13], 9: [12, 12], 10: [] }, () => d); p.set(12, 10, d);
  for (let x = 4; x < 12; x++) p.set(x, 7, mul(l, 0.93));
  outline(p, mul(d, 0.4)); return p;
}
GEN.item_iron_ingot = () => ingot('#f4f0ea', '#cfcbc4', '#8e8a84');
GEN.item_gold_ingot = () => ingot('#fff58a', '#f5cf3a', '#c4901a');
GEN.item_diamond = () => {
  const p = new Pix();
  spans(p, { 3: [5, 10], 4: [4, 11], 5: [3, 12], 6: [2, 13], 7: [3, 12], 8: [4, 11], 9: [5, 10], 10: [6, 9], 11: [7, 8] }, (x, y) => {
    if (y <= 5) return x < 8 ? C('#b8fff6') : C('#6fefe0'); if (y === 6) return x < 8 ? C('#6fefe0') : C('#3fd0c4');
    return x < 8 ? C('#4fe3d2') : C('#27aaa6'); });
  p.set(6, 4, C('#ffffff')); p.set(7, 4, C('#e8fffc')); p.set(5, 5, C('#e8fffc')); p.set(4, 6, C('#d8fffa'));
  for (let x = 3; x < 13; x++) p.set(x, 6, mul(p.get(x, 6), 0.9)); p.set(8, 7, C('#1f8f8f')); p.set(8, 8, C('#1f8f8f'));
  outline(p, [10, 70, 74]); return p;
};
GEN.item_redstone = () => { const p = new Pix(); pile(p, ['#8a0808', '#c81414', '#e01c1c', '#ff4a4a'], 410); outline(p, [60, 4, 4]); return p; };
GEN.item_glowstone_dust = () => { const p = new Pix(); pile(p, ['#c47a1a', '#e8a838', '#fcd060', '#fff0a0'], 411); outline(p, [100, 60, 10]); return p; };
GEN.item_blaze_powder = () => { const p = new Pix(); pile(p, ['#c46a08', '#f5a31a', '#ffd23a', '#fff070'], 412); outline(p, [110, 50, 4]); return p; };
GEN.item_gunpowder = () => { const p = new Pix(); pile(p, ['#3a3a3a', '#555555', '#6e6e6e', '#8a8a8a'], 413); outline(p, [20, 20, 20]); return p; };
GEN.item_flint = () => {
  const p = new Pix(); spans(p, { 4: [8, 10], 5: [6, 11], 6: [5, 12], 7: [4, 12], 8: [4, 11], 9: [5, 10], 10: [6, 9] }, (x, y) => { const s = x + y; return s < 11 ? C('#6b6b6b') : s > 17 ? C('#1c1c1c') : C('#3b3b3b'); });
  p.set(7, 5, C('#8a8a8a')); outline(p, [10, 10, 10]); return p;
};
GEN.item_string = () => {
  const p = new Pix(); for (let i = 0; i < 12; i++) { const x = 2 + i, y = 13 - i + (i % 4 === 1 ? 1 : i % 4 === 3 ? -1 : 0); p.set(x, y, C(i % 2 ? '#e8e8e8' : '#b0b0b0')); p.set(x + 1, y, C('#9a9a9a')); }
  outline(p, [50, 50, 50]); return p;
};
GEN.item_feather = () => {
  const p = new Pix(); const pts = line(p, 2, 14, 13, 3); pts.forEach(([x, y], i) => { const t = i / (pts.length - 1); const w = Math.round(3.4 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (t > 0.2 ? 1 : 0);
    for (let k = 1; k <= w; k++) { p.set(x - k, y, k === w ? C('#cfcfcf') : C('#f4f4f4')); p.set(x, y + k, k === w ? C('#b0b0b0') : C('#e6e6e6')); } });
  pts.forEach(([x, y], i) => p.set(x, y, i < 4 ? C('#8a8a8a') : C('#bdbdbd'))); outline(p, [60, 60, 66]); return p;
};
GEN.item_bone = () => {
  const p = new Pix(); line(p, 3, 12, 12, 3, (x, y) => C((x + y) % 2 ? '#e9e4d0' : '#cfc9b2'));
  for (const [x, y] of [[2, 12], [3, 13], [2, 13], [4, 13], [12, 2], [13, 3], [13, 2], [11, 2]]) p.set(x, y, C('#f2eede'));
  p.set(2, 14, C('#b8b09a')); p.set(14, 2, C('#b8b09a')); outline(p, [70, 66, 54]); return p;
};
GEN.item_leather = () => {
  const p = new Pix(); spans(p, { 3: [4, 11], 4: [3, 12], 5: [2, 13], 6: [3, 12], 7: [3, 12], 8: [3, 12], 9: [3, 12], 10: [2, 13], 11: [3, 12], 12: [4, 11] }, (x, y) => mul(C('#a06a38'), 0.85 + hash(x, y, 420) * 0.3));
  for (const [x, y] of [[2, 5], [13, 5], [2, 10], [13, 10]]) p.set(x, y, [0, 0, 0, 0]);
  for (let y = 5; y < 11; y++) if (y % 2) { p.set(7, y, C('#d0a070')); p.set(8, y, C('#d0a070')); } outline(p, [60, 36, 16]); return p;
};
GEN.item_blaze_rod = () => {
  const p = new Pix(); const pts = line(p, 3, 14, 12, 5); pts.forEach(([x, y], i) => { const c = C(['#f9d23a', '#e8a020', '#c47a10'][i % 3]); p.set(x, y, c); p.set(x + 1, y, mul(c, 0.8)); p.set(x, y - 1, mul(c, 1.1)); });
  outline(p, [100, 50, 6]); return p;
};
GEN.item_ender_pearl = () => {
  const p = new Pix(); disc(p, 8, 8, 5.4, (x, y, d) => { const s = (x - 8) + (y - 8); return s < -3 ? C('#2fa88a') : s > 3 ? C('#0a4a3c') : C('#117a62'); });
  p.set(6, 6, C('#9ff5d8')); p.set(7, 5, C('#6fe0bc')); p.set(5, 7, C('#6fe0bc')); outline(p, [4, 40, 32]); return p;
};
GEN.item_eye_of_ender = () => {
  const p = new Pix(); disc(p, 8, 8, 5.6, (x, y, d) => d < 1.9 ? C('#0a100c') : d < 3.9 ? C('#44d8a2') : C('#1c7a5e'));
  p.set(7, 7, C('#d8ff90')); p.set(8, 7, C('#a8f070')); p.set(5, 5, C('#5ef0b8')); p.set(10, 10, C('#145a44')); outline(p, [4, 40, 32]); return p;
};
GEN.item_quartz = () => {
  const p = new Pix(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const t = ((x - 3) + (13 - y)) / 16; const n = ((x - 3) - (13 - y)) / 1.4142; // along / perpendicular
    if (t < 0 || t > 0.78 || Math.abs(n) > 2.3 - (t > 0.6 ? (t - 0.6) * 9 : 0)) continue;
    p.set(x, y, n < -0.8 ? C('#f6f1ea') : n > 0.8 ? C('#aaa196') : C('#d9d1c6'));
  }
  p.set(8, 8, C('#ffffff')); p.set(7, 9, C('#ffffff')); outline(p, [90, 84, 76]); return p;
};
GEN.item_apple = () => {
  const p = new Pix(); disc(p, 8, 9, 5, (x, y, d) => { const s = (x - 8) + (y - 9); return s < -3 ? C('#f04040') : s > 3 ? C('#8f1010') : C('#d02020'); });
  p.set(8, 4, [0, 0, 0, 0]); p.set(6, 7, C('#ff9a9a')); p.set(6, 8, C('#ff7a7a')); p.set(8, 3, C('#5a3a1a')); p.set(8, 2, C('#5a3a1a')); p.set(9, 3, C('#3a8a22')); p.set(10, 3, C('#4aa030')); p.set(10, 2, C('#3a8a22'));
  outline(p, [60, 10, 10]); return p;
};
GEN.item_bread = () => {
  const p = new Pix(); ellipseRot(p, 8, 9, 6.3, 3.6, 0, (x, y, u, v) => v < -1.3 ? C('#e8b45a') : v > 1.4 ? C('#8c5a24') : C('#c88a3c'));
  for (const x of [5, 8, 11]) { p.set(x, 7, C('#a86a28')); p.set(x + 1, 8, C('#a86a28')); } outline(p, [70, 40, 14]); return p;
};
GEN.item_beef_raw = () => meat('#c8403c', '#f0a0a0', '#8a2424', false);
GEN.item_beef_cooked = () => meat('#7a3a1e', '#a65a2c', '#4a200e', false);
GEN.item_porkchop_raw = () => meat('#e89a94', '#f8c8c4', '#b86a64', true);
GEN.item_porkchop_cooked = () => meat('#b97a45', '#d89a5a', '#7a4a22', true);
GEN.item_rotten_flesh = () => {
  const p = new Pix(); ellipseRot(p, 8, 8.5, 6, 4.2, 0.5, (x, y) => pick(['#5a4a28', '#7a6a3a', '#8c7a44', '#6a7a3a'], hash(x, y, 430)));
  for (const [x, y] of [[6, 8], [10, 7], [8, 10], [11, 10]]) p.set(x, y, [0, 0, 0, 0]); outline(p, [40, 30, 14]); return p;
};
GEN.item_bucket_empty = () => bucket(null);
GEN.item_bucket_water = () => bucket(C('#3a60e0'));
GEN.item_bucket_lava = () => bucket(C('#f26a10'));
GEN.item_flint_and_steel = () => {
  const p = new Pix(); spans(p, { 8: [9, 12], 9: [8, 12], 10: [7, 11], 11: [7, 10], 6: [11, 13], 7: [10, 13] }, (x, y) => C((x + y) % 3 ? '#4a4a4a' : '#2a2a2a'));
  for (let i = 0; i < 6; i++) { p.set(2 + i, 9, C('#c8c8c8')); p.set(2 + i, 14, C('#8a8a8a')); } for (let y = 9; y <= 14; y++) { p.set(2, y, C('#dcdcdc')); p.set(7, y, C('#8a8a8a')); }
  p.set(8, 9, C('#d0d0d0')); p.set(9, 9, [0, 0, 0, 0]); p.set(12, 3, C('#ffcf40')); p.set(14, 5, C('#ff9a20')); p.set(11, 4, C('#fff090')); outline(p, [30, 30, 30]); return p;
};
GEN.item_bow = () => {
  const p = new Pix();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = Math.hypot(x - 14, y - 14); if (r >= 10.6 && r <= 12.2 && x <= 13 && y <= 13) p.set(x, y, C(((x + y) % 3) ? '#8a6a38' : '#a58650')); }
  line(p, 13, 3, 3, 13, C('#d8d8d8')); rect(p, 5, 6, 6, 9, C('#6b4a22')); outline(p, [40, 28, 14]); return p;
};
GEN.item_arrow = () => {
  const p = new Pix(); line(p, 3, 13, 12, 4, (x, y) => C((x + y) % 2 ? '#a58650' : '#8a6a38'));
  for (const [x, y] of [[13, 3], [12, 2], [14, 4], [14, 2], [15, 1], [13, 2], [14, 3], [12, 3], [13, 4]]) p.set(x, y, C((x + y) % 2 ? '#c8c8c8' : '#8a8a8a'));
  for (const [x, y] of [[1, 13], [2, 12], [3, 14], [1, 15], [2, 15], [1, 14], [3, 12], [2, 13]]) p.set(x, y, C((x + y) % 2 ? '#f0f0f0' : '#bcbcbc'));
  outline(p, [40, 40, 40]); return p;
};
GEN.item_seeds_wheat = () => {
  const p = new Pix(); for (const [x, y] of [[4, 11], [8, 12], [11, 10], [6, 8], [10, 6], [3, 7], [7, 4]]) { p.set(x, y, C('#6b8f2a')); p.set(x + 1, y, C('#4a6a1a')); p.set(x, y + 1, C('#8aaa3a')); } outline(p, [30, 46, 10]); return p;
};
GEN.item_wheat = () => {
  const p = new Pix(); for (const o of [-3, 0, 3]) { for (let i = 0; i < 10; i++) { const x = 8 + o + Math.round(i * o / 9 * 0.8), y = 14 - i; p.set(x, y, C(i < 3 ? '#8fa83c' : '#d4b43c')); }
    for (let i = 4; i < 10; i++) { const x = 8 + o + Math.round(i * o / 9 * 0.8), y = 14 - i; p.set(x - 1, y, C('#b8922a')); if (i % 2) p.set(x + 1, y, C('#e8cc54')); } }
  for (let x = 5; x < 12; x++) p.set(x, 13, C('#7a5a1a')); outline(p, [70, 50, 10]); return p;
};
// tools & armor
TIERS.forEach((t) => TOOL_KINDS.forEach((k) => { GEN[`item_${t}_${k}`] = () => toolSprite(t, k); }));
ARMOR_MATS.forEach((m) => ARMOR_SLOTS.forEach((s) => { GEN[`item_${m}_${s}`] = () => armorSprite(m, s); }));

// ------------------------------------------------------------------ pix access / canvases
GEN.__missing = () => missingPix();
const PIXCACHE = new Map();
let _warned = new Set();
function missingPix() { const p = new Pix(); p.fill((x, y) => ((x >> 2) + (y >> 2)) % 2 ? [0, 0, 0] : [255, 0, 255]); return p; }
function getPix(name, frame = 0) {
  if (ANIM[name]) return ANIM[name](frame);
  let p = PIXCACHE.get(name);
  if (!p) {
    const g = GEN[name];
    if (!g) { if (!_warned.has(name)) { _warned.add(name); console.warn('[textures] missing tile', name); } p = missingPix(); } else p = g();
    PIXCACHE.set(name, p);
  }
  return p;
}
function pixToCanvas(p, c) {
  c = c || mkCanvas(16, 16); const g = c.getContext('2d'); const id = g.createImageData(16, 16); id.data.set(p.d); g.putImageData(id, 0, 0); return c;
}
const TILECANVAS = new Map();
export function getTileCanvas(name) {
  let c = TILECANVAS.get(name);
  if (!c) { c = pixToCanvas(getPix(name, 0)); TILECANVAS.set(name, c); }
  return c;
}

// ------------------------------------------------------------------ atlas
const PAD = 2, CELL = 16 + PAD * 2, PER_ROW = 16;
const _atlases = [];
let _frame = 0, _lastTick = 0;
function blitCell(ctx, cx, cy, p) {
  const id = ctx.createImageData(CELL, CELL), d = id.data, s = p.d;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx = Math.min(15, Math.max(0, x - PAD)), sy = Math.min(15, Math.max(0, y - PAD)), si = (sy * 16 + sx) * 4, di = (y * CELL + x) * 4;
    d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
  }
  ctx.putImageData(id, cx * CELL, cy * CELL);
}
function buildAtlas(names) {
  const rows = Math.ceil((names.length + 1) / PER_ROW), W = PER_ROW * CELL, H = rows * CELL;
  const canvas = mkCanvas(W, H), ctx = canvas.getContext('2d'), index = new Map();
  const all = names.concat(['__missing']);
  all.forEach((n, i) => { const cx = i % PER_ROW, cy = (i / PER_ROW) | 0; index.set(n, { cx, cy }); blitCell(ctx, cx, cy, getPix(n, 0)); });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.needsUpdate = true;
  const uv = (name) => {
    const c = index.get(name) || index.get('__missing');
    const u0 = (c.cx * CELL + PAD) / W, u1 = (c.cx * CELL + PAD + 16) / W;
    const v1 = 1 - (c.cy * CELL + PAD) / H, v0 = 1 - (c.cy * CELL + PAD + 16) / H;
    return [u0, v0, u1, v1];
  };
  const atlas = { canvas, texture, size: PER_ROW, tile: 16, uv, names: names.slice(), pad: PAD, cell: CELL };
  const anim = names.filter((n) => ANIM[n]).map((n) => ({ n, c: index.get(n) }));
  _atlases.push({ ctx, texture, anim });
  return atlas;
}
let _blockAtlas = null, _itemAtlas = null;
export function buildBlockAtlas() { return _blockAtlas || (_blockAtlas = buildAtlas(allBlockTiles())); }
export function buildItemAtlas() {
  if (_itemAtlas) return _itemAtlas;
  const s = new Set(allItemTiles()); for (const n of allBlockTiles()) s.add(n);   // item atlas also carries all block tiles (sprites for torch/flowers/etc.)
  return (_itemAtlas = buildAtlas([...s]));
}
// update animated tiles (water/lava/portal/fire/end_portal); call ~10x/s
export function tickTextures(t) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (now - _lastTick < 60) return; _lastTick = now; _frame++;
  const cache = {};
  for (const a of _atlases) {
    if (!a.anim.length) continue;
    for (const { n, c } of a.anim) { const p = cache[n] || (cache[n] = ANIM[n](_frame)); blitCell(a.ctx, c.cx, c.cy, p); }
    a.texture.needsUpdate = true;
  }
  for (const n in cache) { const tc = TILECANVAS.get(n); if (tc) pixToCanvas(cache[n], tc); }
}

// ------------------------------------------------------------------ crack overlay
let _crackOrder = null;
function crackOrder() {
  if (_crackOrder) return _crackOrder;
  const seen = new Set(), order = [];
  const add = (x, y) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x > 15 || y > 15) return; const k = y * 16 + x; if (!seen.has(k)) { seen.add(k); order.push(k); } };
  const walkers = [];
  for (let i = 0; i < 9; i++) { const a = hash(i, 1, 501) * Math.PI * 2; walkers.push({ x: 7.5 + Math.cos(a) * 0.8, y: 7.5 + Math.sin(a) * 0.8, a, s: 0 }); }
  for (let step = 0; step < 14; step++) for (let i = 0; i < walkers.length; i++) {
    const w = walkers[i]; w.a += (hash(step, i, 502) - 0.5) * 1.1; w.x += Math.cos(w.a); w.y += Math.sin(w.a); add(w.x, w.y);
    if (hash(step, i, 503) > 0.78) add(w.x + (hash(step, i, 504) > 0.5 ? 1 : -1), w.y);
  }
  return (_crackOrder = order);
}
const _crack = [];
export function getCrackCanvas(stage) {
  stage = Math.max(0, Math.min(9, stage | 0));
  if (_crack[stage]) return _crack[stage];
  const order = crackOrder(), n = Math.min(order.length, Math.round(8 + (order.length - 8) * Math.pow((stage + 1) / 10, 1.15)));
  const p = new Pix();
  for (let i = 0; i < n; i++) { const k = order[i]; p.set(k % 16, (k / 16) | 0, [0, 0, 0, 120 + Math.floor(hash(k, stage, 505) * 70)]); }
  return (_crack[stage] = pixToCanvas(p));
}

// ------------------------------------------------------------------ GUI icons
const _cube = new Map();
function cubeCanvas(blockId) {
  let c = _cube.get(blockId); if (c) return c;
  c = mkCanvas(32, 32); const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const A = [16, 0], B = [31, 8], Cc = [16, 16], D = [1, 8], H = 15;
  const face = (tile, o, u, v, shade) => {
    const path = () => { g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] + u[0], o[1] + u[1]); g.lineTo(o[0] + u[0] + v[0], o[1] + u[1] + v[1]); g.lineTo(o[0] + v[0], o[1] + v[1]); g.closePath(); };
    g.save(); path(); g.clip(); g.setTransform(u[0] / 16, u[1] / 16, v[0] / 16, v[1] / 16, o[0], o[1]); g.drawImage(getTileCanvas(tile), 0, 0); g.restore();
    if (shade > 0) { g.save(); path(); g.fillStyle = `rgba(0,0,0,${shade})`; g.fill(); g.restore(); }
  };
  const t = faceTile(blockId, 2) || faceTile(blockId, 4), l = faceTile(blockId, 4) || t, r = faceTile(blockId, 0) || l;
  face(l, D, [15, 8], [0, H], 0.2);
  face(r, Cc, [15, -8], [0, H], 0.4);
  face(t, A, [15, 8], [-15, 8], 0);
  _cube.set(blockId, c); return c;
}
const _unknown = (() => { let c = null; return () => c || (c = pixToCanvas(missingPix())); })();
export function drawItemIcon(ctx, itemId, x, y, size) {
  const it = getItem(itemId); const prev = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  let src;
  if (!it) src = _unknown();
  else if (it.sprite) src = getTileCanvas(it.sprite);
  else if (it.block && BLOCKS[it.block]?.tex) src = cubeCanvas(it.block);
  else if (it.tex) src = getTileCanvas(it.tex);
  else src = _unknown();
  ctx.drawImage(src, x, y, size, size);
  ctx.imageSmoothingEnabled = prev;
}
