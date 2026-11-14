// world.js — voxel world: chunks, generation (see worldgen.js), lighting, fluids, ticks, raycast, portals.
import { B, BLOCKS } from './registry.js';
import { createGenerator, configureStronghold, STRONGHOLD, END_PILLARS, END_EXIT, END_SPAWN, BIOME } from './worldgen.js';

export const HEIGHT = 128, SEA = 62;
export { STRONGHOLD, END_PILLARS, END_EXIT, END_SPAWN, BIOME };

const AIR = B.AIR, WATER = B.WATER, LAVA = B.LAVA;

// ---------------------------------------------------------------- block property tables
const OPA = new Uint8Array(256);      // light opacity 0..15
const LIGHT = new Uint8Array(256);    // emitted block light
const SOLID = new Uint8Array(256);
const LIQ = new Uint8Array(256);
const NU = new Uint8Array(256);       // needs scheduled update: 1 water 2 lava 3 gravity 4 support 5 fire 6 portal
const RT = new Uint8Array(256);       // random-tick types
for (let id = 0; id < 256; id++) {
  const b = BLOCKS[id]; if (!b) continue;
  OPA[id] = b.opaque ? 15 : 0;
  LIGHT[id] = b.light | 0;
  SOLID[id] = b.solid ? 1 : 0;
  LIQ[id] = b.liquid ? 1 : 0;
  if (b.gravity) NU[id] = 3;
}
OPA[B.LEAVES] = OPA[B.LEAVES_BIRCH] = OPA[B.LEAVES_SPRUCE] = 1;
OPA[B.WATER] = 2; OPA[B.ICE] = 1;
NU[B.WATER] = 1; NU[B.LAVA] = 2; NU[B.FIRE] = 5; NU[B.NETHER_PORTAL] = 6;
for (const id of [B.TORCH, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.CACTUS]) NU[id] = 4;
RT[B.GRASS] = 1; RT[B.DIRT] = 2; RT[B.LEAVES] = 3; RT[B.LEAVES_BIRCH] = 3; RT[B.LEAVES_SPRUCE] = 3; RT[B.NETHER_PORTAL] = 4; RT[B.FIRE] = 5;

// ---------------------------------------------------------------- chunk
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = new Uint8Array(16 * 128 * 16);
    this.meta = new Uint8Array(16 * 128 * 16);
    this.sky = new Uint8Array(16 * 128 * 16);
    this.blk = new Uint8Array(16 * 128 * 16);
    this.dirty = true;
    this.version = 0;
    this.mesh = null;
    this.nbr = [null, null, null, null]; // +x -x +z -z (internal, for light propagation)
    this._st = 0;
    this._mods = null;
  }
}

// ---------------------------------------------------------------- light engine (module-level, no allocation)
const QCAP = 1 << 17, QM = QCAP - 1;
const QC = new Array(QCAP).fill(null), QI = new Int32Array(QCAP), QV = new Uint8Array(QCAP);
const RC = new Array(QCAP).fill(null), RI = new Int32Array(QCAP), RV = new Uint8Array(QCAP);
let qh = 0, qt = 0, rh = 0, rt = 0, stamp = 1, NI = 0;

function touch(c) { if (c._st !== stamp) { c._st = stamp; c.dirty = true; c.version++; } }
function qpush(c, i, v) { if (qt - qh < QCAP) { const k = qt & QM; QC[k] = c; QI[k] = i; QV[k] = v; qt++; } }
function rpush(c, i, v) { if (rt - rh < QCAP) { const k = rt & QM; RC[k] = c; RI[k] = i; RV[k] = v; rt++; } }

// neighbour cell: returns chunk (or null) and sets NI. d: 0 +x 1 -x 2 +z 3 -z 4 +y 5 -y
function nb(c, i, d) {
  switch (d) {
    case 0: if ((i & 15) < 15) { NI = i + 1; return c; } NI = i - 15; return c.nbr[0];
    case 1: if ((i & 15) > 0) { NI = i - 1; return c; } NI = i + 15; return c.nbr[1];
    case 2: if (((i >> 4) & 15) < 15) { NI = i + 16; return c; } NI = i - 240; return c.nbr[2];
    case 3: if (((i >> 4) & 15) > 0) { NI = i - 16; return c; } NI = i + 240; return c.nbr[3];
    case 4: if ((i >> 8) < 127) { NI = i + 256; return c; } return null;
    default: if ((i >> 8) > 0) { NI = i - 256; return c; } return null;
  }
}

function relax(nc, ni, v, sky, down) {
  const o = OPA[nc.blocks[ni]];
  if (o >= 15) return;
  const nv = (down && sky && v === 15 && o === 0) ? 15 : v - (o > 1 ? o : 1);
  if (nv <= 0) return;
  const arr = sky ? nc.sky : nc.blk;
  if (nv > arr[ni]) { arr[ni] = nv; touch(nc); qpush(nc, ni, nv); }
}

function bfsAdd(sky) {
  while (qh < qt) {
    const k = qh & QM; qh++;
    const c = QC[k], i = QI[k], v = QV[k];
    if (v <= 1) continue;
    if ((sky ? c.sky[i] : c.blk[i]) !== v) continue;
    for (let d = 0; d < 6; d++) {
      const nc = nb(c, i, d);
      if (nc) relax(nc, NI, v, sky, d === 5);
    }
  }
}

function remNb(nc, ni, v, sky, down) {
  const arr = sky ? nc.sky : nc.blk;
  const nv = arr[ni];
  if (nv === 0) return;
  if (!sky && LIGHT[nc.blocks[ni]] >= nv) { qpush(nc, ni, nv); return; }   // self-emitting source
  if (nv < v || (sky && down && v === 15 && nv === 15)) {
    arr[ni] = 0; touch(nc); rpush(nc, ni, nv);
  } else qpush(nc, ni, nv);
}

function bfsRemove(sky) {
  while (rh < rt) {
    const k = rh & QM; rh++;
    const c = RC[k], i = RI[k], v = RV[k];
    for (let d = 0; d < 6; d++) {
      const nc = nb(c, i, d);
      if (nc) remNb(nc, NI, v, sky, d === 5);
    }
  }
}

// seed neighbours' border light into a fresh chunk
function pullBorders(c, sky) {
  const arrC = sky ? c.sky : c.blk;
  for (let d = 0; d < 4; d++) {
    const n = c.nbr[d]; if (!n) continue;
    const arrN = sky ? n.sky : n.blk;
    for (let t = 0; t < 16; t++) for (let y = 0; y < 128; y++) {
      const i = d === 0 ? (y << 8) | (t << 4) | 15 : d === 1 ? (y << 8) | (t << 4) : d === 2 ? (y << 8) | (15 << 4) | t : (y << 8) | t;
      const ni = d === 0 ? i - 15 : d === 1 ? i + 15 : d === 2 ? i - 240 : i + 240;
      const s = arrN[ni]; if (s < 2) continue;
      const o = OPA[c.blocks[i]]; if (o >= 15) continue;
      if (s - (o > 1 ? o : 1) > arrC[i]) qpush(n, ni, s);
    }
  }
}

function initLight(c, hasSky) {
  stamp++; qh = qt = rh = rt = 0;
  const bl = c.blocks;
  if (hasSky) {
    const sky = c.sky; let maxTop = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let lvl = 15; const base = (z << 4) | x;
      for (let y = 127; y >= 0; y--) {
        const i = base + (y << 8), o = OPA[bl[i]];
        if (o) { lvl = lvl > o ? lvl - o : 0; if (y > maxTop) maxTop = y; }
        sky[i] = lvl;
      }
    }
    const lim = maxTop < 127 ? maxTop : 127;
    for (let y = 0; y <= lim; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = (y << 8) | (z << 4) | x, s = sky[i];
      if (s < 2) continue;
      for (let d = 0; d < 6; d++) {
        if (d === 4) continue;
        const nc = nb(c, i, d); if (!nc) continue;
        const ni = NI, o = OPA[nc.blocks[ni]]; if (o >= 15) continue;
        const nv = (d === 5 && s === 15 && o === 0) ? 15 : s - (o > 1 ? o : 1);
        if (nv > nc.sky[ni]) { qpush(c, i, s); break; }
      }
    }
    // border cells above the terrain: neighbours may have terrain/caves there
    for (let y = lim + 1; y < 128; y++) for (let t = 0; t < 16; t++) {
      for (let e = 0; e < 4; e++) {
        if (!c.nbr[e]) continue;
        const i = e === 0 ? (y << 8) | (t << 4) | 15 : e === 1 ? (y << 8) | (t << 4) : e === 2 ? (y << 8) | (15 << 4) | t : (y << 8) | t;
        const nc = nb(c, i, e), ni = NI;
        if (sky[i] >= 2 && OPA[nc.blocks[ni]] < 15 && sky[i] - 1 > nc.sky[ni]) qpush(c, i, sky[i]);
      }
    }
    pullBorders(c, true);
    bfsAdd(true);
  }
  // block light
  qh = qt = 0;
  const blk = c.blk;
  for (let i = 0; i < 32768; i++) {
    const l = LIGHT[bl[i]];
    if (l) { blk[i] = l; qpush(c, i, l); }
  }
  pullBorders(c, false);
  bfsAdd(false);
}

// incremental light update after a block change at chunk c, index i
function updateLightAt(c, i, oldId, newId, hasSky) {
  stamp++; qh = qt = rh = rt = 0;
  const oldO = OPA[oldId], newO = OPA[newId];
  // -- block light
  const oldBl = c.blk[i], newEm = LIGHT[newId];
  if (oldBl > 0 && (newO > oldO || LIGHT[oldId] > newEm)) {
    c.blk[i] = 0; touch(c); rpush(c, i, oldBl); bfsRemove(false);
  }
  if (newEm > 0 && c.blk[i] < newEm) { c.blk[i] = newEm; touch(c); qpush(c, i, newEm); }
  if (newO < 15) {
    for (let d = 0; d < 6; d++) { const nc = nb(c, i, d); if (nc) { const nv = nc.blk[NI]; if (nv > 1) qpush(nc, NI, nv); } }
  }
  bfsAdd(false);
  // -- sky light
  if (!hasSky) return;
  qh = qt = rh = rt = 0;
  const oldSky = c.sky[i];
  if (oldSky > 0 && newO > oldO) { c.sky[i] = 0; touch(c); rpush(c, i, oldSky); bfsRemove(true); }
  if (newO < 15) {
    let best = 0; const dn = newO > 1 ? newO : 1;
    for (let d = 0; d < 6; d++) {
      const nc = nb(c, i, d); let nv;
      if (d === 4) {
        const u = nc ? nc.sky[NI] : 15;
        nv = (u === 15 && newO === 0) ? 15 : u - dn;
      } else if (nc) nv = nc.sky[NI] - dn; else continue;
      if (nv > best) best = nv;
    }
    if (best > c.sky[i]) { c.sky[i] = best; touch(c); qpush(c, i, best); }
    else if (c.sky[i] > 0) qpush(c, i, c.sky[i]);
  }
  bfsAdd(true);
}

// ---------------------------------------------------------------- world
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let SEQ = 0;

export class World {
  constructor(seed, dim = 'overworld') {
    this.seed = (seed | 0);
    this.dim = dim;
    this.hasSky = dim !== 'nether';
    this.chunks = new Map();
    this.cm = new Map();
    this.listeners = [];
    this.mods = new Map();      // "cx,cz" -> Map(localIdx -> id | meta<<8)  (diff for saveData)
    this.sched = new Map();
    this._due = [];
    this.tickNo = 0; this.acc = 0;
    this._lx = 1e9; this._lz = 1e9; this._lc = null;
    this._rs = (this.seed ^ 0x9e3779b9) >>> 0 || 1;
    configureStronghold(this.seed);
    this.gen = createGenerator(this.seed, dim);
    this.genMs = 0; this.genCount = 0;
  }

  // ---- chunk access
  _c(cx, cz) {
    if (cx === this._lx && cz === this._lz) return this._lc;
    const c = this.cm.get((cx + 32768) * 65536 + (cz + 32768));
    if (c) { this._lx = cx; this._lz = cz; this._lc = c; }
    return c;
  }
  getChunk(cx, cz) { return this._c(cx, cz); }
  ensureChunk(cx, cz) {
    const c0 = this._c(cx, cz);
    if (c0) return c0;
    const t0 = performance.now();
    const c = new Chunk(cx, cz);
    this.gen.gen(c);
    const key = cx + ',' + cz;
    const m = this.mods.get(key);
    if (m) { for (const [idx, v] of m) { c.blocks[idx] = v & 255; c.meta[idx] = v >> 8; } c._mods = m; }
    this.chunks.set(key, c);
    this.cm.set((cx + 32768) * 65536 + (cz + 32768), c);
    const n0 = this._c(cx + 1, cz), n1 = this._c(cx - 1, cz), n2 = this._c(cx, cz + 1), n3 = this._c(cx, cz - 1);
    if (n0) { c.nbr[0] = n0; n0.nbr[1] = c; }
    if (n1) { c.nbr[1] = n1; n1.nbr[0] = c; }
    if (n2) { c.nbr[2] = n2; n2.nbr[3] = c; }
    if (n3) { c.nbr[3] = n3; n3.nbr[2] = c; }
    initLight(c, this.hasSky);
    for (let d = 0; d < 4; d++) { const n = c.nbr[d]; if (n) { n.dirty = true; n.version++; } }
    c.dirty = true; c.version++;
    this.genMs += performance.now() - t0; this.genCount++;
    return c;
  }
  // drop far chunks from memory (edits are kept in the diff map and re-applied on regeneration)
  unloadChunk(cx, cz) {
    const c = this._c(cx, cz); if (!c) return false;
    for (let d = 0; d < 4; d++) { const n = c.nbr[d]; if (n) n.nbr[d ^ 1] = null; }
    this.chunks.delete(cx + ',' + cz); this.cm.delete((cx + 32768) * 65536 + (cz + 32768));
    this._lx = 1e9; this._lc = null;
    return true;
  }

  // ---- block access
  _gb(x, y, z) {
    if (y < 0 || y >= 128) return 0;
    const c = this._c(x >> 4, z >> 4);
    return c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  _gm(x, y, z) {
    if (y < 0 || y >= 128) return 0;
    const c = this._c(x >> 4, z >> 4);
    return c ? c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  getBlock(x, y, z) { return this._gb(Math.floor(x), Math.floor(y), Math.floor(z)); }
  getMeta(x, y, z) { return this._gm(Math.floor(x), Math.floor(y), Math.floor(z)); }
  getSky(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y >= 128) return this.hasSky ? 15 : 0;
    if (y < 0) return 0;
    const c = this._c(x >> 4, z >> 4);
    if (!c) return this.hasSky ? 15 : 0;
    return c.sky[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }
  getBlockLight(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= 128) return 0;
    const c = this._c(x >> 4, z >> 4);
    return c ? c.blk[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  isSolid(x, y, z) { return SOLID[this.getBlock(x, y, z)] === 1; }
  isLiquid(x, y, z) { return LIQ[this.getBlock(x, y, z)] === 1; }
  onChange(fn) { this.listeners.push(fn); }

  _markNb(cx, cz) { const n = this._c(cx, cz); if (n) { n.dirty = true; n.version++; } }

  setBlock(x, y, z, id, meta = 0, opts) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= 128) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this._c(cx, cz) || this.ensureChunk(cx, cz);
    const lx = x & 15, lz = z & 15, i = (y << 8) | (lz << 4) | lx;
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return false;
    c.blocks[i] = id; c.meta[i] = meta;
    // diff for save
    let m = c._mods;
    if (!m) { const key = cx + ',' + cz; m = this.mods.get(key); if (!m) { m = new Map(); this.mods.set(key, m); } c._mods = m; }
    m.set(i, id | (meta << 8));
    c.dirty = true; c.version++;
    const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0, ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (ex) this._markNb(cx + ex, cz);
    if (ez) this._markNb(cx, cz + ez);
    if (ex && ez) this._markNb(cx + ex, cz + ez);
    if (old !== id) updateLightAt(c, i, old, id, this.hasSky);
    if (!(opts && opts.silent)) {
      for (let k = 0; k < this.listeners.length; k++) this.listeners[k](x, y, z, old, id);
      this._schAround(x, y, z);
    }
    return true;
  }

  // ---- queries
  heightAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.ensureChunk(x >> 4, z >> 4);
    const base = ((z & 15) << 4) | (x & 15);
    for (let y = 127; y >= 0; y--) if (SOLID[c.blocks[base + (y << 8)]]) return y + 1;
    return 0;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist = 6, opts) {
    const len = Math.hypot(dx, dy, dz); if (len === 0) return null;
    dx /= len; dy /= len; dz /= len;
    const liquids = !!(opts && opts.liquids);
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    const hit = (id) => id !== 0 && id !== B.NETHER_PORTAL && id !== B.END_PORTAL && (liquids || !LIQ[id]);
    let id = this._gb(x, y, z);
    if (hit(id)) {
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      const f = ax >= ay && ax >= az ? [-sx, 0, 0] : ay >= az ? [0, -sy, 0] : [0, 0, -sz];
      return { x, y, z, face: f, id, dist: 0 };
    }
    let t = 0, fx = 0, fy = 0, fz = 0;
    for (;;) {
      if (tmx < tmy && tmx < tmz) { t = tmx; if (t > maxDist) return null; x += sx; tmx += tdx; fx = -sx; fy = 0; fz = 0; }
      else if (tmy < tmz) { t = tmy; if (t > maxDist) return null; y += sy; tmy += tdy; fx = 0; fy = -sy; fz = 0; }
      else { t = tmz; if (t > maxDist) return null; z += sz; tmz += tdz; fx = 0; fy = 0; fz = -sz; }
      if (y < 0 && sy < 0) return null;
      if (y >= 128 && sy > 0) return null;
      id = this._gb(x, y, z);
      if (hit(id)) return { x, y, z, face: [fx, fy, fz], id, dist: t };
    }
  }

  // terrain-ish ground block (not trees / plants / liquids)
  _isGround(id) { return id === B.GRASS || id === B.SAND || id === B.SNOW || id === B.DIRT || id === B.STONE || id === B.NETHERRACK || id === B.END_STONE || id === B.SANDSTONE || id === B.OBSIDIAN; }

  findSpawn() {
    if (this.dim === 'end') return { x: END_SPAWN.x + 0.5, y: END_SPAWN.y, z: END_SPAWN.z + 0.5 };
    if (this.dim === 'nether') {
      for (let r = 0; r < 48; r += 2) for (let a = 0; a < (r === 0 ? 1 : 8); a++) {
        const ang = a / 8 * Math.PI * 2, x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        this.ensureChunk(x >> 4, z >> 4);
        for (let y = 100; y > 33; y--) {
          if (this._gb(x, y, z) === AIR && this._gb(x, y + 1, z) === AIR && SOLID[this._gb(x, y - 1, z)] && !LIQ[this._gb(x, y - 1, z)]) return { x: x + 0.5, y, z: z + 0.5 };
        }
      }
      return { x: 0.5, y: 70, z: 0.5 };
    }
    for (let r = 0; r <= 160; r += 3) {
      const n = r === 0 ? 1 : Math.max(8, Math.floor(r * 0.9));
      for (let a = 0; a < n; a++) {
        const ang = a / n * Math.PI * 2, x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const c = this.ensureChunk(x >> 4, z >> 4);
        const base = ((z & 15) << 4) | (x & 15);
        let y = 127;
        while (y > 0 && c.blocks[base + (y << 8)] === AIR) y--;
        const id = c.blocks[base + (y << 8)];
        if (y > SEA + 1 && (id === B.GRASS || id === B.SAND || id === B.SNOW)) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: this.heightAt(0, 0) + 1, z: 0.5 };
  }

  // ---- saving
  saveData() {
    const blocks = [];
    for (const [ck, m] of this.mods) {
      const p = ck.split(','), cx = +p[0], cz = +p[1];
      for (const [idx, v] of m) blocks.push([cx * 16 + (idx & 15), idx >> 8, cz * 16 + ((idx >> 4) & 15), v & 255, v >> 8]);
    }
    return { seed: this.seed, dim: this.dim, blocks };
  }
  loadData(o) {
    if (!o || !Array.isArray(o.blocks)) return;
    for (const e of o.blocks) {
      const x = e[0], y = e[1], z = e[2], id = e[3], meta = e[4] | 0;
      const cx = x >> 4, cz = z >> 4;
      if (this._c(cx, cz)) this.setBlock(x, y, z, id, meta, { silent: true });
      else {
        const key = cx + ',' + cz; let m = this.mods.get(key); if (!m) { m = new Map(); this.mods.set(key, m); }
        m.set((y << 8) | ((z & 15) << 4) | (x & 15), id | (meta << 8));
      }
    }
  }

  // ====================================================================== ticking
  _rand() { let s = this._rs; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; this._rs = s; return s; }
  _ri(n) { return this._rand() % n; }

  _key(x, y, z) { return ((x + 1048576) * 2097152 + (z + 1048576)) * 128 + y; }
  _sch(x, y, z, delay) {
    if (y < 0 || y >= 128) return;
    const k = this._key(x, y, z), due = this.tickNo + delay, cur = this.sched.get(k);
    if (cur === undefined || due < cur) this.sched.set(k, due);
  }
  _schCell(x, y, z) {
    const id = this._gb(x, y, z), f = NU[id];
    if (!f) return;
    switch (f) {
      case 1: this._sch(x, y, z, 5); break;
      case 2: this._sch(x, y, z, this.dim === 'nether' ? 10 : 30); break;
      case 3: this._sch(x, y, z, 2); break;
      case 4: this._sch(x, y, z, 1); break;
      case 5: this._sch(x, y, z, 20 + this._ri(10)); break;
      case 6: this._sch(x, y, z, 1); break;
    }
  }
  _schAround(x, y, z) {
    this._schCell(x, y, z);
    this._schCell(x + 1, y, z); this._schCell(x - 1, y, z);
    this._schCell(x, y + 1, z); this._schCell(x, y - 1, z);
    this._schCell(x, y, z + 1); this._schCell(x, y, z - 1);
  }

  tick(dt, px = 0, pz = 0) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 0.05 && steps < 4) {
      this.acc -= 0.05; steps++; this.tickNo++;
      if (this.sched.size) this._runScheduled();
      this._randomTicks(px, pz);
    }
    if (this.acc > 0.2) this.acc = 0.2;
  }

  _runScheduled() {
    const due = this._due; due.length = 0;
    let n = 0;
    for (const [k, t] of this.sched) { if (t <= this.tickNo) { due.push(k); if (++n >= 400) break; } }
    for (let i = 0; i < due.length; i++) this.sched.delete(due[i]);
    for (let i = 0; i < due.length; i++) {
      const k = due[i];
      const y = k % 128; const r = (k - y) / 128; const zr = r % 2097152; const z = zr - 1048576; const x = (r - zr) / 2097152 - 1048576;
      const id = this._gb(x, y, z);
      switch (NU[id]) {
        case 1: case 2: this._fluid(x, y, z); break;
        case 3: this._gravity(x, y, z); break;
        case 4: this._support(x, y, z); break;
        case 5: this._fire(x, y, z); break;
        case 6: this._portalCheck(x, y, z); break;
      }
    }
  }

  _flowable(id) { return id === AIR || id === B.TALL_GRASS || id === B.FLOWER_RED || id === B.FLOWER_YELLOW || id === B.TORCH || id === B.FIRE; }

  _fluid(x, y, z) {
    const id = this._gb(x, y, z);
    const isW = id === WATER;
    if (!isW && id !== LAVA) return;
    const L = this._gm(x, y, z) & 7;
    const step = isW ? 1 : (this.dim === 'nether' ? 1 : 2);
    const other = isW ? LAVA : WATER;
    if (!isW) {
      if (this._gb(x + 1, y, z) === WATER || this._gb(x - 1, y, z) === WATER || this._gb(x, y, z + 1) === WATER || this._gb(x, y, z - 1) === WATER || this._gb(x, y + 1, z) === WATER) {
        this.setBlock(x, y, z, L === 0 ? B.OBSIDIAN : B.COBBLE); return;
      }
    }
    if (L > 0) {
      let best = 99;
      if (this._gb(x, y + 1, z) === id) best = 1;
      let srcs = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS4[d][0], nz = z + DIRS4[d][1];
        if (this._gb(nx, y, nz) !== id) continue;
        const nl = this._gm(nx, y, nz) & 7;
        if (nl === 0) srcs++;
        const nbl = this._gb(nx, y - 1, nz);
        if (this._flowable(nbl)) continue;
        if (!(nl === 0 || SOLID[nbl])) continue;
        const eff = this._gb(nx, y + 1, nz) === id ? 0 : nl;
        const cand = eff + step; if (cand < best) best = cand;
      }
      if (isW && srcs >= 2) {
        const below = this._gb(x, y - 1, z);
        if (SOLID[below] || (below === WATER && (this._gm(x, y - 1, z) & 7) === 0)) { this.setBlock(x, y, z, WATER, 0); return; }
      }
      if (best > 7) {
        const nl = L + step;
        if (nl > 7) this.setBlock(x, y, z, AIR); else this.setBlock(x, y, z, id, nl);
        return;
      }
      if (best !== L) { this.setBlock(x, y, z, id, best); return; }
    }
    const below = this._gb(x, y - 1, z);
    if (y > 0 && this._flowable(below)) { this.setBlock(x, y - 1, z, id, 1); return; }
    if (y > 0 && below === other) {
      if (!isW) { this.setBlock(x, y - 1, z, B.STONE); return; }
      // water above lava: the lava cell reacts on its own update
      this._sch(x, y - 1, z, 1);
    }
    if (L === 0 || SOLID[below]) {
      const eff = this._gb(x, y + 1, z) === id ? 0 : L;
      const cand = eff + step;
      if (cand > 7) return;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS4[d][0], nz = z + DIRS4[d][1];
        const nid = this._gb(nx, y, nz);
        if (this._flowable(nid)) this.setBlock(nx, y, nz, id, cand);
        else if (nid === id) { if ((this._gm(nx, y, nz) & 7) > cand) this.setBlock(nx, y, nz, id, cand); }
        else if (nid === other) {
          if (isW) this.setBlock(nx, y, nz, (this._gm(nx, y, nz) & 7) === 0 ? B.OBSIDIAN : B.COBBLE);
          else this.setBlock(nx, y, nz, B.COBBLE);
        }
      }
    }
  }

  _gravity(x, y, z) {
    const id = this._gb(x, y, z);
    if (!BLOCKS[id] || !BLOCKS[id].gravity) return;
    if (y === 0) { this.setBlock(x, y, z, AIR); return; }
    const b = this._gb(x, y - 1, z);
    if (b === AIR || LIQ[b] || this._flowable(b)) {
      const m = this._gm(x, y, z);
      this.setBlock(x, y, z, AIR);
      this.setBlock(x, y - 1, z, id, m);
    }
  }

  _support(x, y, z) {
    const id = this._gb(x, y, z), below = this._gb(x, y - 1, z);
    if (id === B.TORCH) {
      if (SOLID[below] || SOLID[this._gb(x + 1, y, z)] || SOLID[this._gb(x - 1, y, z)] || SOLID[this._gb(x, y, z + 1)] || SOLID[this._gb(x, y, z - 1)]) return;
      this.setBlock(x, y, z, AIR);
    } else if (id === B.CACTUS) {
      if (below !== B.SAND && below !== B.CACTUS) this.setBlock(x, y, z, AIR);
    } else if (id === B.TALL_GRASS || id === B.FLOWER_RED || id === B.FLOWER_YELLOW) {
      if (below !== B.GRASS && below !== B.DIRT) this.setBlock(x, y, z, AIR);
    }
  }

  _burnable(id) { return id !== B.NETHERRACK && BLOCKS[id] && BLOCKS[id].flammable; }

  _fire(x, y, z) {
    if (this._gb(x, y, z) !== B.FIRE) return;
    const age = this._gm(x, y, z);
    const below = this._gb(x, y - 1, z);
    const nx = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    let anyFlam = false;
    for (let d = 0; d < 6; d++) if (this._burnable(this._gb(x + nx[d][0], y + nx[d][1], z + nx[d][2]))) { anyFlam = true; break; }
    const perm = below === B.NETHERRACK;
    if (!SOLID[below] && !anyFlam) { this.setBlock(x, y, z, AIR); return; }
    if (!perm && !anyFlam && (age > 3 || this._ri(4) === 0)) { this.setBlock(x, y, z, AIR); return; }
    if (!perm && age >= 15 && !this._burnable(below) && this._ri(4) === 0) { this.setBlock(x, y, z, AIR); return; }
    // burn neighbours
    for (let d = 0; d < 6; d++) {
      const bx = x + nx[d][0], by = y + nx[d][1], bz = z + nx[d][2];
      const nid = this._gb(bx, by, bz);
      if (!this._burnable(nid)) continue;
      const leaf = nid === B.LEAVES || nid === B.LEAVES_BIRCH || nid === B.LEAVES_SPRUCE;
      if (this._ri(100) < (leaf ? 30 : 12)) {
        if (this._ri(3) === 0) this.setBlock(bx, by, bz, AIR); else this.setBlock(bx, by, bz, B.FIRE, 0);
      }
    }
    // spread into nearby air that has fuel next to it
    if (this._ri(3) === 0) {
      const sx = x + this._ri(3) - 1, sy = y + this._ri(3) - 1, sz = z + this._ri(3) - 1;
      if (this._gb(sx, sy, sz) === AIR) {
        let fuel = false;
        for (let d = 0; d < 6; d++) if (this._burnable(this._gb(sx + nx[d][0], sy + nx[d][1], sz + nx[d][2]))) { fuel = true; break; }
        if (fuel) this.setBlock(sx, sy, sz, B.FIRE, 0);
      }
    }
    const na = age < 15 ? age + (this._ri(3) === 0 ? 1 : 0) : 15;
    if (na !== age) this.setBlock(x, y, z, B.FIRE, na);
    this._sch(x, y, z, 20 + this._ri(10));
  }

  _portalCheck(x, y, z) {
    if (this._gb(x, y, z) !== B.NETHER_PORTAL) return;
    const axisX = (this._gm(x, y, z) & 1) === 0;
    const ok = (id) => id === B.OBSIDIAN || id === B.NETHER_PORTAL;
    const dx = axisX ? 1 : 0, dz = axisX ? 0 : 1;
    if (!ok(this._gb(x, y - 1, z)) || !ok(this._gb(x, y + 1, z)) || !ok(this._gb(x + dx, y, z + dz)) || !ok(this._gb(x - dx, y, z - dz))) {
      this.setBlock(x, y, z, AIR);
    }
  }

  _randomTicks(px, pz) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4, R = 3;
    for (let cx = pcx - R; cx <= pcx + R; cx++) for (let cz = pcz - R; cz <= pcz + R; cz++) {
      const c = this._c(cx, cz); if (!c) continue;
      for (let n = 0; n < 10; n++) {
        const r = this._rand();
        const lx = r & 15, lz = (r >>> 4) & 15, y = 30 + ((r >>> 8) % 98);
        const id = c.blocks[(y << 8) | (lz << 4) | lx];
        const f = RT[id];
        if (f) this._randomTick(f, cx * 16 + lx, y, cz * 16 + lz, id);
      }
    }
  }

  _randomTick(f, x, y, z, id) {
    switch (f) {
      case 1: { // grass dies under opaque blocks / water
        const a = this._gb(x, y + 1, z);
        if (OPA[a] >= 15 || a === WATER) this.setBlock(x, y, z, B.DIRT);
        break;
      }
      case 2: { // dirt: grass spreads
        if (this.dim !== 'overworld') break;
        const a = this._gb(x, y + 1, z);
        if (OPA[a] !== 0 || this.getSky(x, y + 1, z) < 9) break;
        const sx = x + this._ri(3) - 1, sy = y + this._ri(3) - 1, sz = z + this._ri(3) - 1;
        if (this._gb(sx, sy, sz) === B.GRASS) this.setBlock(x, y, z, B.GRASS);
        break;
      }
      case 3: { // natural leaves decay without wood nearby
        if ((this._gm(x, y, z) & 1) === 0) break;
        for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
          const t = this._gb(x + dx, y + dy, z + dz);
          if (t === B.LOG || t === B.LOG_BIRCH || t === B.LOG_SPRUCE) return;
        }
        this.setBlock(x, y, z, AIR);
        break;
      }
      case 4: this._portalCheck(x, y, z); break;
      case 5: this._sch(x, y, z, 1); break;
    }
  }
}

// ====================================================================== portals
function inner(id) { return id === AIR || id === B.FIRE; }

// frame interior (air/fire) containing (x,y,z) for width axis (0 = along x, 1 = along z)
function frameFor(world, x, y, z, axis) {
  const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
  const g = (a, b, c) => world.getBlock(a, b, c);
  if (!inner(g(x, y, z))) return null;
  let yy = y, n = 0;
  while (n < 22 && inner(g(x, yy - 1, z))) { yy--; n++; }
  if (g(x, yy - 1, z) !== B.OBSIDIAN) return null;
  const bottom = yy;
  let lo = 0; while (lo < 22 && inner(g(x - (lo + 1) * dx, bottom, z - (lo + 1) * dz))) lo++;
  if (g(x - (lo + 1) * dx, bottom, z - (lo + 1) * dz) !== B.OBSIDIAN) return null;
  let hi = 0; while (hi < 22 && inner(g(x + (hi + 1) * dx, bottom, z + (hi + 1) * dz))) hi++;
  if (g(x + (hi + 1) * dx, bottom, z + (hi + 1) * dz) !== B.OBSIDIAN) return null;
  const w = lo + hi + 1;
  if (w < 2 || w > 21) return null;
  const x0 = x - lo * dx, z0 = z - lo * dz;
  let h = 0; while (h < 22 && inner(g(x, bottom + h, z))) h++;
  if (h < 3 || h > 21 || g(x, bottom + h, z) !== B.OBSIDIAN) return null;
  for (let j = 0; j < h; j++) {
    if (g(x0 - dx, bottom + j, z0 - dz) !== B.OBSIDIAN) return null;
    if (g(x0 + w * dx, bottom + j, z0 + w * dz) !== B.OBSIDIAN) return null;
    for (let i = 0; i < w; i++) if (!inner(g(x0 + i * dx, bottom + j, z0 + i * dz))) return null;
  }
  for (let i = 0; i < w; i++) {
    if (g(x0 + i * dx, bottom - 1, z0 + i * dz) !== B.OBSIDIAN) return null;
    if (g(x0 + i * dx, bottom + h, z0 + i * dz) !== B.OBSIDIAN) return null;
  }
  return { x0, y0: bottom, z0, w, h, dx, dz, axis };
}

function lightFrame(world, x, y, z) {
  for (let axis = 0; axis < 2; axis++) {
    const f = frameFor(world, x, y, z, axis);
    if (!f) continue;
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++)
      world.setBlock(f.x0 + i * f.dx, f.y0 + j, f.z0 + i * f.dz, B.NETHER_PORTAL, axis);
    return true;
  }
  return false;
}

// Fire placed at / next to obsidian: validate frame (inner 2..21 x 3..21) and fill with portal blocks (meta 0 = x axis, 1 = z axis)
export function tryLightNetherPortal(world, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const id = world.getBlock(x, y, z);
  if (inner(id)) return lightFrame(world, x, y, z);
  if (id === B.OBSIDIAN) {
    const o = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    for (const d of o) if (lightFrame(world, x + d[0], y + d[1], z + d[2])) return true;
  }
  return false;
}

// Find a portal near (x,z) in this (destination) world or build one. Returns lowest interior portal block {x,y,z}.
export function findOrCreatePortal(world, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const R = 32;
  let best = null, bd = 1e18;
  for (let cx = (x - R) >> 4; cx <= (x + R) >> 4; cx++) for (let cz = (z - R) >> 4; cz <= (z + R) >> 4; cz++) {
    const c = world.ensureChunk(cx, cz);
    let from = 0, idx;
    while ((idx = c.blocks.indexOf(B.NETHER_PORTAL, from)) >= 0) {
      from = idx + 1;
      const wx = cx * 16 + (idx & 15), wz = cz * 16 + ((idx >> 4) & 15), wy = idx >> 8;
      const d = (wx - x) * (wx - x) + (wz - z) * (wz - z) + (wy - y) * (wy - y) * 0.25;
      if (Math.abs(wx - x) <= R && Math.abs(wz - z) <= R && d < bd) { bd = d; best = [wx, wy, wz]; }
    }
  }
  if (best) {
    let [bx, by, bz] = best;
    while (world.getBlock(bx, by - 1, bz) === B.NETHER_PORTAL) by--;
    return { x: bx, y: by, z: bz };
  }
  // build one
  const nether = world.dim === 'nether';
  let px = x, pz = z, py = -1;
  const fits = (ax, ay, az) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 2; dx++) {
      if (!SOLID[world.getBlock(ax + dx, ay - 1, az + dz)] || LIQ[world.getBlock(ax + dx, ay - 1, az + dz)]) return false;
      for (let dy = 0; dy < 4; dy++) if (world.getBlock(ax + dx, ay + dy, az + dz) !== AIR) return false;
    }
    return true;
  };
  if (nether) {
    outer: for (let r = 0; r <= 16; r += 2) for (let oz = -r; oz <= r; oz += 2) for (let ox = -r; ox <= r; ox += 2) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
      world.ensureChunk((x + ox) >> 4, (z + oz) >> 4);
      for (let yy = Math.min(115, Math.max(40, y + 20)); yy > 33; yy--) {
        if (fits(x + ox, yy, z + oz)) { px = x + ox; pz = z + oz; py = yy; break outer; }
      }
    }
    if (py < 0) py = Math.max(36, Math.min(100, y));
  } else {
    py = Math.max(world.heightAt(x, z), SEA + 1);
    // avoid placing into trees: use terrain top
    for (let yy = py - 1; yy > 40; yy--) {
      const id = world.getBlock(x, yy, z);
      if (id === B.GRASS || id === B.SAND || id === B.DIRT || id === B.STONE || id === B.SNOW || id === B.SANDSTONE || id === B.GRAVEL) { py = yy + 1; break; }
    }
    if (py < SEA + 1) py = SEA + 1;
  }
  // platform + clearing
  for (let dz = -2; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
    for (let dy = 0; dy < 4; dy++) world.setBlock(px + dx, py + dy, pz + dz, AIR);
    if (Math.abs(dz) <= 1) world.setBlock(px + dx, py - 1, pz + dz, B.OBSIDIAN);
  }
  for (let dy = -1; dy <= 3; dy++) {
    world.setBlock(px - 1, py + dy, pz, B.OBSIDIAN); world.setBlock(px + 2, py + dy, pz, B.OBSIDIAN);
  }
  for (let dx = 0; dx <= 1; dx++) { world.setBlock(px + dx, py - 1, pz, B.OBSIDIAN); world.setBlock(px + dx, py + 3, pz, B.OBSIDIAN); }
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx <= 1; dx++) world.setBlock(px + dx, py + dy, pz, B.NETHER_PORTAL, 0);
  return { x: px, y: py, z: pz };
}

const RING = [];
for (let i = -1; i <= 1; i++) RING.push([i, -2], [i, 2], [-2, i], [2, i]);

// Insert an Eye of Ender into an End Portal Frame; when all 12 frames are filled the 3x3 interior becomes END_PORTAL
export function tryInsertEye(world, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  if (world.getBlock(x, y, z) !== B.END_PORTAL_FRAME) return false;
  const m = world.getMeta(x, y, z);
  if (m & 4) return false;
  world.setBlock(x, y, z, B.END_PORTAL_FRAME, m | 4);
  for (const [ox, oz] of RING) {
    const cx = x - ox, cz = z - oz;
    let all = true;
    for (const [rx, rz] of RING) {
      if (world.getBlock(cx + rx, y, cz + rz) !== B.END_PORTAL_FRAME || !(world.getMeta(cx + rx, y, cz + rz) & 4)) { all = false; break; }
    }
    if (all) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.setBlock(cx + dx, y, cz + dz, B.END_PORTAL, 0);
      break;
    }
  }
  return true;
}

// Fill the End exit fountain with portal blocks (call after dragon death)
export function fillEndExitPortal(world) {
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dz * dz <= 6 && !(dx === 0 && dz === 0)) world.setBlock(dx, END_EXIT.y, dz, B.END_PORTAL, 0);
  }
}
