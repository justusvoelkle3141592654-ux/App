// worldgen.js — deterministic chunk generators for overworld / nether / end.
// Writes straight into chunk.blocks / chunk.meta (Uint8Array(16*128*16), index (y*16+z)*16+x). No allocation in hot loops.
import { B } from './registry.js';
import { Noise, hash3 } from './noise.js';

export const HEIGHT = 128, SEA = 62;

// ---- exported structure locations -------------------------------------------------
// STRONGHOLD = center of the 3x3 portal interior (frame level). Mutated in place when a World is built (seed dependent).
export const STRONGHOLD = { x: 180, y: 30, z: 0 };
export function configureStronghold(seed) {
  const a = (hash3(seed | 0, 1337, 7, 42) / 4294967296) * Math.PI * 2;
  const d = 150 + (hash3(seed | 0, 99, 1, 2) % 1000) / 10;      // 150..250
  STRONGHOLD.x = Math.round(Math.cos(a) * d);
  STRONGHOLD.z = Math.round(Math.sin(a) * d);
  STRONGHOLD.y = 30;
}
configureStronghold(0);

// End pillars: obsidian from y .. y+h-1, bedrock cap at y+h, fire at y+h+1 (crystal sits there). r = radius.
export const END_PILLARS = [];
export const END_EXIT = { x: 0, y: 65, z: 0, r: 3 };       // portal blocks go at y=65 for dx^2+dz^2<=6 (excluding centre pillar)
export const END_SPAWN = { x: 24, y: 65, z: 0 };           // 5x5 obsidian platform (y=64) — safe arrival point
(function () {
  const tops = [76, 79, 82, 85, 88, 91, 94, 97, 100, 103];
  // fixed shuffle
  const order = [3, 8, 0, 6, 9, 2, 5, 1, 7, 4];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    END_PILLARS.push({
      x: Math.round(Math.cos(a) * 40), y: 64, z: Math.round(Math.sin(a) * 40),
      h: tops[order[i]] - 64, r: 2 + (i % 3),
    });
  }
})();

const AIR = B.AIR, STONE = B.STONE, GRASS = B.GRASS, DIRT = B.DIRT, BEDROCK = B.BEDROCK, WATER = B.WATER, LAVA = B.LAVA,
  SAND = B.SAND, GRAVEL = B.GRAVEL, SNOW = B.SNOW, ICE = B.ICE, SANDSTONE = B.SANDSTONE, CLAY = B.CLAY,
  TALL_GRASS = B.TALL_GRASS, FLOWER_RED = B.FLOWER_RED, FLOWER_YELLOW = B.FLOWER_YELLOW,
  LOG = B.LOG, LEAVES = B.LEAVES, LOG_BIRCH = B.LOG_BIRCH, LEAVES_BIRCH = B.LEAVES_BIRCH,
  LOG_SPRUCE = B.LOG_SPRUCE, LEAVES_SPRUCE = B.LEAVES_SPRUCE, CACTUS = B.CACTUS;

// biome ids
export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TAIGA: 5, MOUNTAINS: 6 };

// ---- tiny global RNG (no allocation) ---------------------------------------------
let _rs = 1;
function rseed(s) { _rs = (s >>> 0) || 1; }
function rnd() {
  _rs = (_rs + 0x6D2B79F5) >>> 0;
  let t = _rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(n) { return (rnd() * n) | 0; }

// ---- per-chunk write context -----------------------------------------------------
let CB = null, CM = null, OX = 0, OZ = 0;

// mode 0: only into air/plants (leaves) ; 1: air/leaves/plants (logs) ; 2: force
function put(wx, wy, wz, id, meta, mode) {
  const lx = wx - OX, lz = wz - OZ;
  if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy >= 128) return;
  const i = (wy << 8) | (lz << 4) | lx;
  if (mode !== 2) {
    const cur = CB[i];
    if (cur !== AIR && cur !== TALL_GRASS && cur !== FLOWER_RED && cur !== FLOWER_YELLOW) {
      if (!(mode === 1 && (cur === LEAVES || cur === LEAVES_BIRCH || cur === LEAVES_SPRUCE))) return;
    }
  }
  CB[i] = id; CM[i] = meta;
}

// random-walk vein inside this chunk, replacing only `replace`
function vein(id, size, ymin, ymax, tries, replace) {
  for (let t = 0; t < tries; t++) {
    let x = rint(16), y = ymin + rint(ymax - ymin + 1), z = rint(16);
    const steps = size + (size >> 1);
    let placed = 0;
    for (let k = 0; k < steps && placed < size; k++) {
      const i = (y << 8) | (z << 4) | x;
      if (CB[i] === replace) { CB[i] = id; placed++; }
      x += rint(3) - 1; y += rint(3) - 1; z += rint(3) - 1;
      if (x < 0) x = 0; else if (x > 15) x = 15;
      if (z < 0) z = 0; else if (z > 15) z = 15;
      if (y < ymin) y = ymin; else if (y > ymax) y = ymax;
    }
  }
}

function oak(x, y, z, birch) {
  const th = birch ? 5 + rint(3) : 4 + rint(3);
  const lg = birch ? LOG_BIRCH : LOG, lv = birch ? LEAVES_BIRCH : LEAVES;
  const top = y + th;
  for (let yy = top - 2; yy <= top + 1; yy++) {
    const rr = yy >= top ? 1 : 2;
    for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx === 0 && dz === 0 && yy <= top) continue;
      if (dx !== 0 && dz !== 0 && Math.abs(dx) === rr && Math.abs(dz) === rr) {
        if (yy > top || rnd() < 0.5) continue;
      }
      put(x + dx, yy, z + dz, lv, 1, 0);
    }
  }
  for (let i = 1; i <= th; i++) put(x, y + i, z, lg, 0, 1);
}

function spruce(x, y, z) {
  const th = 6 + rint(4);
  for (let i = 1; i <= th; i++) put(x, y + i, z, LOG_SPRUCE, 0, 1);
  const top = y + th + 1;
  put(x, top, z, LEAVES_SPRUCE, 1, 0);
  const maxr = 2 + rint(2);
  let rr = 1;
  for (let yy = top - 1; yy >= y + 3; yy--) {
    for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx === 0 && dz === 0 && yy < top) continue;
      if (rr > 1 && Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
      put(x + dx, yy, z + dz, LEAVES_SPRUCE, 1, 0);
    }
    rr++; if (rr > maxr) rr = 1;
  }
  for (let i = th - 1; i <= th; i++) put(x, y + i, z, LOG_SPRUCE, 0, 1);
}

// =====================================================================================
// OVERWORLD
// =====================================================================================
const CG = 19; // cave grid vertical samples (y = 0..72 step 4)

export class OverworldGen {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nCont = new Noise(s + 1); this.nTemp = new Noise(s + 2); this.nHum = new Noise(s + 3);
    this.nMount = new Noise(s + 4); this.nRough = new Noise(s + 5); this.nHill = new Noise(s + 6);
    this.nDet = new Noise(s + 7); this.nSurf = new Noise(s + 8); this.nEnt = new Noise(s + 9);
    this.nCa = new Noise(s + 10); this.nCb = new Noise(s + 11); this.nCc = new Noise(s + 12);
    this.h = 0; this.b = 0; this.t = 0;
    this.hArr = new Int16Array(256); this.bArr = new Uint8Array(256); this.tArr = new Float32Array(256);
    this.ga = new Float32Array(25 * CG); this.gb = new Float32Array(25 * CG); this.gc = new Float32Array(25 * CG);
    this.pa = new Float32Array(CG + 1); this.pb = new Float32Array(CG + 1); this.pc = new Float32Array(CG + 1);
  }

  // terrain height (top solid block y), biome, temperature for a world column. Results in this.h/this.b/this.t
  column(x, z) {
    const cont = this.nCont.f2(x * 0.0028, z * 0.0028, 3) * 1.7;
    const temp = this.nTemp.f2(x * 0.0022, z * 0.0022, 2) * 1.7;
    const hum = this.nHum.f2(x * 0.0026, z * 0.0026, 2) * 1.7;
    const mt = this.nMount.f2(x * 0.005, z * 0.005, 3) * 1.7;
    let rough = this.nRough.n2(x * 0.004, z * 0.004) * 0.6 + 0.5; if (rough < 0) rough = 0; else if (rough > 1) rough = 1;
    const hill = this.nHill.f2(x * 0.022, z * 0.022, 3);
    const det = this.nDet.n2(x * 0.11, z * 0.11);
    let coast = (cont + 0.2) / 0.25; coast = coast < 0 ? 0 : coast > 1 ? 1 : coast * coast * (3 - 2 * coast);
    const base = cont < -0.2 ? (cont + 0.2) * 45 : (cont + 0.2) * 14;
    const amp = 1.5 + 6 * rough * rough;
    const mount = mt > 0.22 ? (mt - 0.22) * 60 * coast : 0;
    let h = Math.round(SEA + base + hill * amp * (0.35 + 0.65 * coast) + det * (0.4 + 0.6 * coast) + mount);
    if (h < 28) h = 28; else if (h > 118) h = 118;
    let b;
    if (cont < -0.2) b = BIOME.OCEAN;
    else if (mount > 6) b = BIOME.MOUNTAINS;
    else if (temp > 0.28 && hum < 0.25) b = BIOME.DESERT;
    else if (temp < -0.3) b = BIOME.TAIGA;
    else if (hum > 0.15) b = BIOME.FOREST;
    else b = BIOME.PLAINS;
    if (b === BIOME.OCEAN) { if (h >= SEA - 1) b = BIOME.BEACH; }
    else if (h <= SEA + 1 && b !== BIOME.DESERT) b = BIOME.BEACH;
    this.h = h; this.b = b; this.t = temp;
  }

  caveGrid() {
    const ga = this.ga, gb = this.gb, gc = this.gc;
    for (let gx = 0; gx < 5; gx++) {
      const wx = OX + gx * 4;
      for (let gz = 0; gz < 5; gz++) {
        const wz = OZ + gz * 4;
        const base = (gx * 5 + gz) * CG;
        for (let gy = 0; gy < CG; gy++) {
          const wy = gy * 4;
          ga[base + gy] = this.nCa.n3(wx * 0.03, wy * 0.05, wz * 0.03);
          gb[base + gy] = this.nCb.n3(wx * 0.03, wy * 0.05, wz * 0.03);
          gc[base + gy] = this.nCc.n3(wx * 0.014, wy * 0.035, wz * 0.014);
        }
      }
    }
  }

  gen(c) {
    OX = c.cx << 4; OZ = c.cz << 4; CB = c.blocks; CM = c.meta;
    const seed = this.seed;
    rseed(hash3(seed, c.cx, 11, c.cz));
    const hArr = this.hArr, bArr = this.bArr, tArr = this.tArr;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      this.column(OX + lx, OZ + lz);
      const k = (lz << 4) | lx;
      hArr[k] = this.h; bArr[k] = this.b; tArr[k] = this.t;
    }
    this.caveGrid();
    const ga = this.ga, gb = this.gb, gc = this.gc, pa = this.pa, pb = this.pb, pc = this.pc;

    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const k = (lz << 4) | lx, base = k;
      const h = hArr[k], b = bArr[k];
      const wx = OX + lx, wz = OZ + lz;
      for (let y = 0; y <= h; y++) CB[base + (y << 8)] = STONE;
      // surface layers
      const sd = this.nSurf.n2(wx * 0.08, wz * 0.08);
      switch (b) {
        case BIOME.DESERT:
          for (let y = h; y > h - 4; y--) CB[base + (y << 8)] = SAND;
          for (let y = h - 4; y > h - 7; y--) CB[base + (y << 8)] = SANDSTONE;
          break;
        case BIOME.OCEAN: case BIOME.BEACH: {
          let top = SAND, d = 3;
          if (h < SEA - 1 && sd > 0.45) top = GRAVEL;
          else if (h < SEA - 1 && h > SEA - 8 && sd < -0.5) { top = CLAY; d = 2; }
          for (let y = h; y > h - d; y--) CB[base + (y << 8)] = top;
          break;
        }
        case BIOME.MOUNTAINS:
          if (h > 100) CB[base + (h << 8)] = SNOW;
          else if (h <= 88) {
            CB[base + (h << 8)] = GRASS;
            for (let y = h - 1; y > h - 4; y--) CB[base + (y << 8)] = DIRT;
          }
          break;
        case BIOME.TAIGA: {
          CB[base + (h << 8)] = SNOW;
          for (let y = h - 1; y > h - 4; y--) CB[base + (y << 8)] = DIRT;
          break;
        }
        default: {
          CB[base + (h << 8)] = GRASS;
          const dd = 3 + (sd > 0 ? 1 : 0);
          for (let y = h - 1; y > h - 1 - dd; y--) CB[base + (y << 8)] = DIRT;
        }
      }
      // water
      if (h < SEA) {
        for (let y = h + 1; y <= SEA; y++) CB[base + (y << 8)] = WATER;
        if (tArr[k] < -0.3) CB[base + (SEA << 8)] = ICE;
      }
      // bedrock
      CB[base] = BEDROCK;
      for (let y = 1; y < 5; y++) if (rnd() * 5 > y) CB[base + (y << 8)] = BEDROCK;
      // caves
      let ymax = h - 3;
      if (h > SEA + 1 && this.nEnt.n2(wx * 0.03, wz * 0.03) > 0.52) ymax = h;
      if (ymax > 72) ymax = 72;
      if (ymax >= 5) {
        const gx = lx >> 2, gz = lz >> 2, fx = (lx & 3) * 0.25, fz = (lz & 3) * 0.25;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
        const i00 = (gx * 5 + gz) * CG, i10 = ((gx + 1) * 5 + gz) * CG, i01 = (gx * 5 + gz + 1) * CG, i11 = ((gx + 1) * 5 + gz + 1) * CG;
        const km = (ymax >> 2) + 1;
        for (let q = 0; q <= km; q++) {
          pa[q] = ga[i00 + q] * w00 + ga[i10 + q] * w10 + ga[i01 + q] * w01 + ga[i11 + q] * w11;
          pb[q] = gb[i00 + q] * w00 + gb[i10 + q] * w10 + gb[i01 + q] * w01 + gb[i11 + q] * w11;
          pc[q] = gc[i00 + q] * w00 + gc[i10 + q] * w10 + gc[i01 + q] * w01 + gc[i11 + q] * w11;
        }
        for (let y = 5; y <= ymax; y++) {
          const q = y >> 2, t = (y & 3) * 0.25;
          const a = pa[q] + (pa[q + 1] - pa[q]) * t;
          const bb = pb[q] + (pb[q + 1] - pb[q]) * t;
          let carve = a * a + bb * bb < 0.0075;
          if (!carve) {
            const cc = pc[q] + (pc[q + 1] - pc[q]) * t;
            carve = cc > 0.62 + (y > 40 ? (y - 40) * 0.01 : 0);
          }
          if (carve) {
            const i = base + (y << 8);
            const cur = CB[i];
            if (cur !== WATER && cur !== BEDROCK) CB[i] = y <= 10 ? LAVA : AIR;
          }
        }
      }
    }

    // ores (vanilla-ish counts per chunk)
    vein(DIRT, 24, 5, 80, 8, STONE);
    vein(GRAVEL, 22, 5, 60, 6, STONE);
    vein(B.COAL_ORE, 14, 5, 120, 20, STONE);
    vein(B.IRON_ORE, 8, 5, 63, 20, STONE);
    vein(B.GOLD_ORE, 8, 5, 31, 2, STONE);
    vein(B.REDSTONE_ORE, 7, 5, 15, 8, STONE);
    vein(B.DIAMOND_ORE, 7, 5, 15, 1, STONE);

    this.stronghold();
    this.plants();
    this.trees();
  }

  stronghold() {
    const sx = STRONGHOLD.x, sy = STRONGHOLD.y, sz = STRONGHOLD.z;
    if (OX > sx + 7 || OX + 15 < sx - 7 || OZ > sz + 7 || OZ + 15 < sz - 7) return;
    const SB = B.STONE_BRICKS;
    for (let y = sy - 3; y <= sy + 6; y++) {
      for (let z = sz - 7; z <= sz + 7; z++) for (let x = sx - 7; x <= sx + 7; x++) {
        const dx = x - sx, dz = z - sz;
        let id = AIR;
        if (dx === 7 || dx === -7 || dz === 7 || dz === -7 || y === sy - 3 || y === sy + 6) id = SB;
        else if (y === sy - 2) id = (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) ? LAVA : SB;
        else if (y === sy - 1) id = (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) ? LAVA : SB;
        else if ((dx === 4 || dx === -4) && (dz === 4 || dz === -4)) id = SB; // pillars
        put(x, y, z, id, 0, 2);
      }
    }
    // 12 frames: 5x5 ring without corners. meta = facing (0 south,1 west,2 north,3 east) inward, bit 4 = eye (not set)
    for (let i = -1; i <= 1; i++) {
      put(sx + i, sy, sz - 2, B.END_PORTAL_FRAME, 0, 2); // north side faces south
      put(sx + i, sy, sz + 2, B.END_PORTAL_FRAME, 2, 2); // south side faces north
      put(sx - 2, sy, sz + i, B.END_PORTAL_FRAME, 3, 2); // west side faces east
      put(sx + 2, sy, sz + i, B.END_PORTAL_FRAME, 1, 2); // east side faces west
    }
    put(sx - 6, sy, sz - 6, B.TORCH, 0, 2); put(sx + 6, sy, sz - 6, B.TORCH, 0, 2);
    put(sx - 6, sy, sz + 6, B.TORCH, 0, 2); put(sx + 6, sy, sz + 6, B.TORCH, 0, 2);
  }

  plants() {
    const hArr = this.hArr, bArr = this.bArr;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const k = (lz << 4) | lx, h = hArr[k], b = bArr[k];
      if (h <= SEA || h > 90 || h >= 126) continue;
      const i = (h << 8) | k;
      if (CB[i] !== GRASS || CB[i + 256] !== AIR) continue;
      const r = rnd();
      let tg = 0, fl = 0;
      if (b === BIOME.PLAINS) { tg = 0.14; fl = 0.02; }
      else if (b === BIOME.FOREST) { tg = 0.07; fl = 0.008; }
      else if (b === BIOME.MOUNTAINS) { tg = 0.03; }
      else continue;
      if (r < tg) CB[i + 256] = TALL_GRASS;
      else if (r < tg + fl) CB[i + 256] = rnd() < 0.5 ? FLOWER_RED : FLOWER_YELLOW;
    }
  }

  trees() {
    const x0 = OX - 3, x1 = OX + 18, z0 = OZ - 3, z1 = OZ + 18, seed = this.seed;
    const ci0 = Math.floor(x0 / 5), ci1 = Math.floor(x1 / 5), cj0 = Math.floor(z0 / 5), cj1 = Math.floor(z1 / 5);
    for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
      const hh = hash3(seed, ci, cj, 31);
      const tx = ci * 5 + (hh % 5), tz = cj * 5 + ((hh >>> 8) % 5);
      if (tx < x0 || tx > x1 || tz < z0 || tz > z1) continue;
      const roll = ((hh >>> 16) & 1023) / 1024;
      this.column(tx, tz);
      const h = this.h, b = this.b;
      if (h <= SEA + 1 || h > 88) continue;
      let p = 0;
      switch (b) {
        case BIOME.FOREST: p = 0.85; break;
        case BIOME.PLAINS: p = 0.04; break;
        case BIOME.TAIGA: p = 0.6; break;
        case BIOME.MOUNTAINS: p = 0.18; break;
        case BIOME.DESERT: p = 0.14; break;
        default: p = 0;
      }
      if (roll >= p) continue;
      if (this.nEnt.n2(tx * 0.03, tz * 0.03) > 0.45) continue;
      rseed(hash3(seed, tx, tz, 77));
      if (b === BIOME.DESERT) {
        const ch = 1 + rint(3);
        for (let i = 1; i <= ch; i++) put(tx, h + i, tz, CACTUS, 0, 0);
      } else if (b === BIOME.TAIGA || (b === BIOME.MOUNTAINS && h > 70)) {
        spruce(tx, h, tz);
      } else if (b === BIOME.FOREST) {
        oak(tx, h, tz, rnd() < 0.4);
      } else oak(tx, h, tz, false);
    }
  }
}

// =====================================================================================
// NETHER
// =====================================================================================
export class NetherGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.n1 = new Noise(seed + 21); this.n2 = new Noise(seed + 22); this.n3 = new Noise(seed + 23);
    this.grid = new Float32Array(5 * 17 * 5);
    this.prof = new Float32Array(17);
  }

  gen(c) {
    OX = c.cx << 4; OZ = c.cz << 4; CB = c.blocks; CM = c.meta;
    const seed = this.seed;
    rseed(hash3(seed, c.cx, 21, c.cz));
    const grid = this.grid, prof = this.prof;
    for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 5; gz++) {
      const wx = OX + gx * 4, wz = OZ + gz * 4;
      for (let gy = 0; gy < 17; gy++) {
        const wy = gy * 8;
        let d = this.n1.n3(wx * 0.012, wy * 0.022, wz * 0.012) * 0.65 + this.n2.n3(wx * 0.035, wy * 0.055, wz * 0.035) * 0.35;
        if (wy < 14) d += (14 - wy) / 14 * 2.0;
        if (wy > 104) d += (wy - 104) / 24 * 2.2;
        grid[(gx * 5 + gz) * 17 + gy] = d;
      }
    }
    const thr = 0.1;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const gx = lx >> 2, gz = lz >> 2, fx = (lx & 3) * 0.25, fz = (lz & 3) * 0.25;
      const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
      const i00 = (gx * 5 + gz) * 17, i10 = ((gx + 1) * 5 + gz) * 17, i01 = (gx * 5 + gz + 1) * 17, i11 = ((gx + 1) * 5 + gz + 1) * 17;
      for (let q = 0; q < 17; q++) prof[q] = grid[i00 + q] * w00 + grid[i10 + q] * w10 + grid[i01 + q] * w01 + grid[i11 + q] * w11;
      const base = (lz << 4) | lx;
      for (let y = 0; y < 128; y++) {
        const q = y >> 3, t = (y & 7) * 0.125;
        const d = q < 16 ? prof[q] + (prof[q + 1] - prof[q]) * t : prof[16];
        const i = base + (y << 8);
        if (y <= 2 || y >= 125 || d > thr) CB[i] = B.NETHERRACK;
        else CB[i] = y <= 31 ? LAVA : AIR;
      }
      // bedrock
      CB[base] = BEDROCK; CB[base + (127 << 8)] = BEDROCK;
      for (let y = 1; y < 5; y++) if (rnd() * 5 > y) CB[base + (y << 8)] = BEDROCK;
      for (let y = 123; y < 127; y++) if (rnd() * 5 > (127 - y)) CB[base + (y << 8)] = BEDROCK;
    }
    // soul sand patches on floors
    for (let n = 0; n < 5; n++) {
      const px = rint(16), pz = rint(16);
      const fy = this.floorAt(px, pz, 100, 33);
      if (fy < 0) continue;
      const rad = 2 + rint(3);
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dz * dz > rad * rad * (0.6 + rnd() * 0.5)) continue;
        const x = px + dx, z = pz + dz; if (x < 0 || x > 15 || z < 0 || z > 15) continue;
        for (let dy = -2; dy <= 2; dy++) {
          const y = fy + dy; if (y < 33 || y > 120) continue;
          const i = (y << 8) | (z << 4) | x;
          if (CB[i] === B.NETHERRACK && CB[i + 256] === AIR) { CB[i] = B.SOUL_SAND; break; }
        }
      }
    }
    // glowstone clusters hanging from ceilings
    for (let n = 0; n < 5; n++) {
      const px = rint(16), pz = rint(16);
      let cy = -1;
      for (let y = 118; y > 40; y--) {
        const i = (y << 8) | (pz << 4) | px;
        if (CB[i] === AIR && CB[i + 256] === B.NETHERRACK) { cy = y; break; }
      }
      if (cy < 0) continue;
      let x = px, y = cy + 1, z = pz;
      const cnt = 10 + rint(14);
      for (let k = 0; k < cnt; k++) {
        if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < 127) {
          const i = (y << 8) | (z << 4) | x;
          if (CB[i] === AIR || CB[i] === B.NETHERRACK) CB[i] = B.GLOWSTONE;
        }
        x += rint(3) - 1; z += rint(3) - 1; y += rint(3) - 1 - (rnd() < 0.5 ? 1 : 0);
        if (y > cy + 1) y = cy + 1;
      }
    }
    vein(B.QUARTZ_ORE, 10, 10, 117, 16, B.NETHERRACK);
    // scattered fire on netherrack
    for (let n = 0; n < 5; n++) {
      const px = rint(16), pz = rint(16);
      const fy = this.floorAt(px, pz, 110, 33);
      if (fy < 0) continue;
      CB[((fy + 1) << 8) | (pz << 4) | px] = B.FIRE;
    }
    this.fortress(c);
  }

  // y of netherrack with air above, scanning down from ymax to ymin; -1 if none
  floorAt(x, z, ymax, ymin) {
    for (let y = ymax; y >= ymin; y--) {
      const i = (y << 8) | (z << 4) | x;
      if (CB[i] === B.NETHERRACK && CB[i + 256] === AIR && (CB[i + 512] === AIR)) return y;
    }
    return -1;
  }

  fortress(c) {
    const seed = this.seed, cx = c.cx, cz = c.cz;
    if (hash3(seed, cz, 5, 0) % 4 !== 0) return;
    if (hash3(seed, cx >> 2, cz, 6) % 3 === 0) return;
    const fy = 50 + (hash3(seed, cz, 9, 0) % 10);
    const NB = B.NETHER_BRICK;
    const W = (lx, y, lz, id) => { CB[(y << 8) | (lz << 4) | lx] = id; CM[(y << 8) | (lz << 4) | lx] = 0; };
    // clear tunnel
    for (let x = 0; x < 16; x++) for (let z = 4; z <= 11; z++) for (let y = fy + 1; y <= fy + 5; y++) W(x, y, z, AIR);
    // floor + rails
    for (let x = 0; x < 16; x++) {
      for (let z = 5; z <= 10; z++) W(x, fy, z, NB);
      W(x, fy + 1, 5, NB); W(x, fy + 1, 10, NB);
    }
    // pillars below
    for (const px of [3, 11]) for (const pz of [7, 8]) {
      for (let y = fy - 1; y > 1; y--) {
        const i = (y << 8) | (pz << 4) | px;
        if (CB[i] === B.NETHERRACK || CB[i] === BEDROCK) break;
        CB[i] = NB;
      }
    }
    // room every 4th chunk
    if (((cx % 4) + 4) % 4 === 1) {
      for (let y = fy; y <= fy + 6; y++) for (let z = 2; z <= 13; z++) for (let x = 2; x <= 13; x++) {
        const edge = x === 2 || x === 13 || z === 2 || z === 13;
        if (y === fy || y === fy + 6) W(x, y, z, NB);
        else if (edge) {
          const door = (x === 2 || x === 13) && z >= 6 && z <= 9;
          W(x, y, z, door && y <= fy + 4 ? AIR : NB);
        } else W(x, y, z, AIR);
      }
      W(7, fy + 1, 7, B.NETHERRACK); W(8, fy + 1, 8, B.NETHERRACK);
    }
  }
}

// =====================================================================================
// END
// =====================================================================================
export class EndGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.n = new Noise(seed + 31); this.n3 = new Noise(seed + 32);
  }
  gen(c) {
    OX = c.cx << 4; OZ = c.cz << 4; CB = c.blocks; CM = c.meta;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const wx = OX + lx, wz = OZ + lz;
      const d = Math.sqrt(wx * wx + wz * wz);
      if (d > 50) continue;
      const t = 1 - d / 50;                     // 1 centre .. 0 edge
      const top = 64 + (d > 38 ? Math.floor(this.n.n2(wx * 0.15, wz * 0.15) * 1.6 * (d - 38) / 12) : 0);
      let depth = Math.floor(3 + 22 * Math.pow(t, 0.7) + this.n.n2(wx * 0.07, wz * 0.07) * 3);
      if (d > 45) depth = Math.floor(depth * (50 - d) / 5);
      if (depth < 1) continue;
      const base = (lz << 4) | lx;
      for (let y = top - depth; y <= top; y++) if (y > 0) CB[base + (y << 8)] = B.END_STONE;
    }
    // pillars
    for (const p of END_PILLARS) {
      const r = p.r;
      if (p.x + r < OX || p.x - r > OX + 15 || p.z + r < OZ || p.z - r > OZ + 15) continue;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        const x = p.x + dx, z = p.z + dz;
        for (let y = 58; y < p.y + p.h; y++) put(x, y, z, B.OBSIDIAN, 0, 2);
        put(x, p.y + p.h, z, BEDROCK, 0, 2);
      }
      put(p.x, p.y + p.h + 1, p.z, B.FIRE, 0, 2);
    }
    // exit fountain
    const e = END_EXIT;
    if (OX <= 4 && OX + 15 >= -4 && OZ <= 4 && OZ + 15 >= -4) {
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > 12.25) continue;
        put(dx, 64, dz, B.BEDROCK_END_EXIT, 0, 2);
        if (d2 > 6) put(dx, 65, dz, B.BEDROCK_END_EXIT, 0, 2);
      }
      for (let y = 65; y <= 67; y++) put(0, y, 0, B.BEDROCK_END_EXIT, 0, 2);
      put(3, 66, 0, B.TORCH, 0, 2); put(-3, 66, 0, B.TORCH, 0, 2); put(0, 66, 3, B.TORCH, 0, 2); put(0, 66, -3, B.TORCH, 0, 2);
      put(0, 68, 0, B.TORCH, 0, 2);
    }
    // arrival platform
    const s = END_SPAWN;
    if (OX <= s.x + 2 && OX + 15 >= s.x - 2 && OZ <= s.z + 2 && OZ + 15 >= s.z - 2) {
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        put(s.x + dx, 64, s.z + dz, B.OBSIDIAN, 0, 2);
        for (let y = 65; y <= 68; y++) put(s.x + dx, y, s.z + dz, AIR, 0, 2);
      }
    }
  }
}

export function createGenerator(seed, dim) {
  if (dim === 'nether') return new NetherGen(seed);
  if (dim === 'end') return new EndGen(seed);
  return new OverworldGen(seed);
}
