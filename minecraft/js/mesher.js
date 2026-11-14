// mesher.js — chunk mesher + item/block mesh builders (used by render.js)
//
// Exports:
//   setDefaultAtlases(block, item)            default atlases for makeItemMesh/makeBlockMesh (set by Renderer)
//   makeBlockMesh(blockId, atlas?)  -> THREE.Mesh   1x1x1 cube centred on origin, per-face tiles, vanilla side shading
//   makeItemMesh(itemId, atlases?)  -> THREE.Object3D  centred on origin, ~1 unit big. Blocks = cube,
//                                      items/sprites = extruded 16x16 sprite (1/16 thick). atlases = {block, item}
//   createChunkMaterials(atlasTexture, shared) / meshChunk(chunk, nbrFn, maxY?) / setMesherAtlas(atlas)
//   Vertex format of chunk meshes: position, uv, light(Uint8x4 normalized: sky, block, shade, 0)
import * as THREE from 'three';
import { BLOCKS, B, faceTile, getItem } from './registry.js';

// ------------------------------------------------------------------ tables
const PW = 18, PH = 130, LAYER = PW * PW, PSIZE = PW * PH * PW;
const pb = new Uint8Array(PSIZE), pm = new Uint8Array(PSIZE), ps = new Uint8Array(PSIZE), pl = new Uint8Array(PSIZE);
for (let i = 0; i < LAYER; i++) pb[i] = B.BEDROCK;          // y = -1
for (let i = (PH - 1) * LAYER; i < PSIZE; i++) ps[i] = 15;  // y = 128 (open sky)

const SH = { cube: 0, cross: 1, torch: 2, cactus: 3, portal: 4, fire: 5, liquid: 6, frame: 7, chest: 8 };
const SHAPE = new Uint8Array(256), OPQ = new Uint8Array(256), SOL = new Uint8Array(256),
  GRP = new Uint8Array(256), GLUE = new Uint8Array(256), HASBLK = new Uint8Array(256);
for (const b of BLOCKS) {
  if (!b) continue;
  SHAPE[b.id] = SH[b.shape] ?? 0;
  OPQ[b.id] = b.opaque ? 1 : 0;
  SOL[b.id] = b.solid ? 1 : 0;
  let g = b.alpha ? 1 : 0;
  if ((b.shape === 'liquid' || b.shape === 'portal') && b.alpha) g = 2;
  if (b.id === B.ICE) g = 2;
  GRP[b.id] = g;
  if (b.id === B.GLASS || b.id === B.ICE) GLUE[b.id] = 1;
}
OPQ[0] = 0;

const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FV = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FOFF = [1, -1, LAYER, -LAYER, PW, -PW];
const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AOF = [0.5, 0.7, 0.85, 1.0];
// per face/vertex: index offsets of side1, side2, corner (relative to the block's own index)
const FD = new Int32Array(6 * 4 * 3);
(function () {
  for (let f = 0; f < 6; f++) {
    const n = FACE_N[f];
    const a = n[0] ? 0 : n[1] ? 1 : 2;
    const t = [0, 1, 2].filter(v => v !== a);
    for (let k = 0; k < 4; k++) {
      const p = FV[f][k];
      const s = [0, 0, 0]; s[t[0]] = p[t[0]] * 2 - 1;
      const s2 = [0, 0, 0]; s2[t[1]] = p[t[1]] * 2 - 1;
      const off = (v) => v[0] + v[1] * LAYER + v[2] * PW;
      const base = n;
      const v1 = [base[0] + s[0], base[1] + s[1], base[2] + s[2]];
      const v2 = [base[0] + s2[0], base[1] + s2[1], base[2] + s2[2]];
      const vc = [base[0] + s[0] + s2[0], base[1] + s[1] + s2[1], base[2] + s[2] + s2[2]];
      const o = (f * 4 + k) * 3;
      FD[o] = off(v1); FD[o + 1] = off(v2); FD[o + 2] = off(vc);
    }
  }
})();

// face uv fractions from block-space coordinates
function faceU(f, px, pz) { return f === 0 ? 1 - pz : f === 1 ? pz : f === 5 ? 1 - px : px; }
function faceV(f, py, pz) { return f === 2 ? 1 - pz : f === 3 ? pz : py; }

// ------------------------------------------------------------------ atlas uv table
const TUV = new Float32Array(256 * 6 * 4);
let curAtlas = null;
export function setMesherAtlas(atlas) {
  curAtlas = atlas;
  TUV.fill(0);
  for (const b of BLOCKS) {
    if (!b || !b.tex) continue;
    for (let f = 0; f < 6; f++) {
      const name = faceTile(b.id, f);
      let uv = null;
      try { uv = name ? atlas.uv(name) : null; } catch (e) { uv = null; }
      if (uv) { const o = (b.id * 6 + f) * 4; TUV[o] = uv[0]; TUV[o + 1] = uv[1]; TUV[o + 2] = uv[2]; TUV[o + 3] = uv[3]; }
    }
  }
}
function safeUV(atlas, name, fallback) {
  if (atlas.names && !atlas.names.includes(name) && name !== '__missing') { if (fallback) return safeUV(atlas, fallback); }
  try { const u = atlas.uv(name); if (u) return u; } catch (e) { /* ignore */ }
  if (fallback) return safeUV(atlas, fallback);
  return [0, 0, 1, 1];
}

// ------------------------------------------------------------------ geometry group (growable typed arrays)
class Group {
  constructor() {
    this.cap = 8192; this.nv = 0; this.ni = 0;
    this.pos = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2);
    this.lt = new Uint8Array(this.cap * 4); this.idx = new Uint32Array(this.cap * 3 / 2 + 6);
  }
  reset() { this.nv = 0; this.ni = 0; }
  grow() {
    const c = this.cap * 2;
    const p = new Float32Array(c * 3); p.set(this.pos); this.pos = p;
    const u = new Float32Array(c * 2); u.set(this.uv); this.uv = u;
    const l = new Uint8Array(c * 4); l.set(this.lt); this.lt = l;
    const i = new Uint32Array(c * 3 / 2 + 6); i.set(this.idx); this.idx = i;
    this.cap = c;
  }
  v(x, y, z, u, v, sky, blk, shade) {
    if (this.nv + 4 > this.cap) this.grow();
    const n = this.nv++;
    let o = n * 3; const P = this.pos; P[o] = x; P[o + 1] = y; P[o + 2] = z;
    o = n * 2; this.uv[o] = u; this.uv[o + 1] = v;
    o = n * 4; const L = this.lt;
    L[o] = (sky * 17 + 0.5) | 0; L[o + 1] = (blk * 17 + 0.5) | 0; L[o + 2] = (shade * 255 + 0.5) | 0; L[o + 3] = 0;
  }
  quad(flip) {
    const b = this.nv - 4, I = this.idx; let n = this.ni;
    if (!flip) { I[n++] = b; I[n++] = b + 1; I[n++] = b + 2; I[n++] = b; I[n++] = b + 2; I[n++] = b + 3; }
    else { I[n++] = b + 1; I[n++] = b + 2; I[n++] = b + 3; I[n++] = b + 1; I[n++] = b + 3; I[n++] = b; }
    this.ni = n;
  }
  toGeometry(cx, cy, cz, r) {
    if (this.nv === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
    g.setAttribute('light', new THREE.BufferAttribute(this.lt.slice(0, this.nv * 4), 4, true));
    const idx = this.nv < 65535 ? new Uint16Array(this.ni) : new Uint32Array(this.ni);
    for (let i = 0; i < this.ni; i++) idx[i] = this.idx[i];
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    return g;
  }
}
const GR = [new Group(), new Group(), new Group()];

// ------------------------------------------------------------------ emit helpers
function emitBox(g, id, bx, by, bz, x0, y0, z0, x1, y1, z1, mask, sky, blk, topVShift) {
  for (let f = 0; f < 6; f++) {
    if (!((mask >> f) & 1)) continue;
    const o = (id * 6 + f) * 4;
    const U0 = TUV[o], V0 = TUV[o + 1], U1 = TUV[o + 2], V1 = TUV[o + 3];
    const fv = FV[f], sh = SHADE[f];
    for (let k = 0; k < 4; k++) {
      const p = fv[k];
      const px = p[0] ? x1 : x0, py = p[1] ? y1 : y0, pz = p[2] ? z1 : z0;
      let vf = faceV(f, py, pz); if (f === 2 && topVShift) vf += topVShift;
      g.v(bx + px, by + py, bz + pz, U0 + (U1 - U0) * faceU(f, px, pz), V0 + (V1 - V0) * vf, sky, blk, sh);
    }
    g.quad(false);
  }
}
function emitVQuad(g, id, bx, by, bz, ax, az, cx, cz, y0, y1, sky, blk, shade) {
  const o = (id * 6) * 4;
  const U0 = TUV[o], V0 = TUV[o + 1], U1 = TUV[o + 2], V1 = TUV[o + 3];
  g.v(bx + ax, by + y0, bz + az, U0, V0, sky, blk, shade);
  g.v(bx + cx, by + y0, bz + cz, U1, V0, sky, blk, shade);
  g.v(bx + cx, by + y1, bz + cz, U1, V1, sky, blk, shade);
  g.v(bx + ax, by + y1, bz + az, U0, V1, sky, blk, shade);
  g.quad(false);
}
function hash2(x, z) { let h = (x * 374761393 + z * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

function liquidH(i) {
  const m = pm[i];
  if (m & 8) return 1;
  const h = (14 / 16) * (8 - (m & 7)) / 8;
  return h < 2 / 16 ? 2 / 16 : h;
}
function cornerH(base, cx, cz, id) {
  let sum = 0, w = 0;
  for (let dz = cz - 1; dz <= cz; dz++) for (let dx = cx - 1; dx <= cx; dx++) {
    const ni = base + dz * PW + dx, nid = pb[ni];
    if (nid === id) {
      if (pb[ni + LAYER] === id) return 1;
      const h = liquidH(ni), wt = h >= 0.8 ? 10 : 1;
      sum += h * wt; w += wt;
    } else if (!SOL[nid]) w += 1;
  }
  return w ? sum / w : 0.875;
}

function emitCube(g, id, x, y, z, base) {
  for (let f = 0; f < 6; f++) {
    const nb = base + FOFF[f], nid = pb[nb];
    if (OPQ[nid]) continue;
    if (nid === id && GLUE[id]) continue;
    const o = (id * 6 + f) * 4;
    const U0 = TUV[o], V0 = TUV[o + 1], U1 = TUV[o + 2], V1 = TUV[o + 3];
    const fv = FV[f], sh = SHADE[f];
    const sky0 = ps[nb], blk0 = pl[nb];
    const ao0 = 0;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let k = 0; k < 4; k++) {
      const d = (f * 4 + k) * 3;
      const i1 = base + FD[d], i2 = base + FD[d + 1], ic = base + FD[d + 2];
      const o1 = OPQ[pb[i1]], o2 = OPQ[pb[i2]], oc = OPQ[pb[ic]];
      const ao = (o1 && o2) ? 0 : 3 - (o1 + o2 + oc);
      const both = (o1 && o2) || oc;
      const sky = (sky0 + (o1 ? sky0 : ps[i1]) + (o2 ? sky0 : ps[i2]) + (both ? sky0 : ps[ic])) * 0.25;
      const blk = (blk0 + (o1 ? blk0 : pl[i1]) + (o2 ? blk0 : pl[i2]) + (both ? blk0 : pl[ic])) * 0.25;
      if (k === 0) a0 = ao; else if (k === 1) a1 = ao; else if (k === 2) a2 = ao; else a3 = ao;
      const p = fv[k];
      g.v(x + p[0], y + p[1], z + p[2], U0 + (U1 - U0) * faceU(f, p[0], p[2]), V0 + (V1 - V0) * faceV(f, p[1], p[2]), sky, blk, sh * AOF[ao]);
    }
    g.quad(a0 + a2 < a1 + a3);
  }
}

function emitLiquid(g, id, x, y, z, base) {
  const sky = ps[base], blk = pl[base];
  const o = (id * 6) * 4;
  const U0 = TUV[o], V0 = TUV[o + 1], U1 = TUV[o + 2], V1 = TUV[o + 3];
  const above = pb[base + LAYER];
  const h00 = cornerH(base, 0, 0, id), h10 = cornerH(base, 1, 0, id), h01 = cornerH(base, 0, 1, id), h11 = cornerH(base, 1, 1, id);
  const H = [[h00, h01], [h10, h11]]; // H[cx][cz]
  if (above !== id && !OPQ[above]) {
    g.v(x, y + h01, z + 1, U0, V0, sky, blk, 1);
    g.v(x + 1, y + h11, z + 1, U1, V0, sky, blk, 1);
    g.v(x + 1, y + h10, z, U1, V1, sky, blk, 1);
    g.v(x, y + h00, z, U0, V1, sky, blk, 1);
    g.quad(false);
  }
  const below = pb[base - LAYER];
  if (below !== id && !OPQ[below]) {
    g.v(x, y, z, U0, V0, sky, blk, 0.5); g.v(x + 1, y, z, U1, V0, sky, blk, 0.5);
    g.v(x + 1, y, z + 1, U1, V1, sky, blk, 0.5); g.v(x, y, z + 1, U0, V1, sky, blk, 0.5);
    g.quad(false);
  }
  for (const f of [0, 1, 4, 5]) {
    const nid = pb[base + FOFF[f]];
    if (nid === id || OPQ[nid]) continue;
    const fv = FV[f], sh = SHADE[f];
    for (let k = 0; k < 4; k++) {
      const p = fv[k];
      const hh = p[1] ? H[p[0]][p[2]] : 0;
      g.v(x + p[0], y + hh, z + p[2], U0 + (U1 - U0) * faceU(f, p[0], p[2]), V0 + (V1 - V0) * hh, sky, blk, sh);
    }
    g.quad(false);
  }
}

// ------------------------------------------------------------------ chunk meshing
function loadPad(ch, dx, dz) {
  const px0 = dx < 0 ? 0 : dx > 0 ? 17 : 1, px1 = dx < 0 ? 0 : dx > 0 ? 17 : 16;
  const pz0 = dz < 0 ? 0 : dz > 0 ? 17 : 1, pz1 = dz < 0 ? 0 : dz > 0 ? 17 : 16;
  const lx0 = dx < 0 ? 15 : 0;
  const cnt = px1 - px0 + 1;
  let maxY = -1;
  for (let y = 0; y < 128; y++) {
    for (let pz = pz0; pz <= pz1; pz++) {
      const lz = pz - 1 - dz * 16;
      const dst = ((y + 1) * PW + pz) * PW + px0;
      if (ch) {
        const src = (y * 16 + lz) * 16 + lx0;
        const B_ = ch.blocks, M_ = ch.meta, S_ = ch.sky, L_ = ch.blk;
        for (let k = 0; k < cnt; k++) {
          const id = B_[src + k];
          pb[dst + k] = id; pm[dst + k] = M_[src + k]; ps[dst + k] = S_[src + k]; pl[dst + k] = L_[src + k];
          if (id && dx === 0 && dz === 0) maxY = y;
        }
      } else {
        for (let k = 0; k < cnt; k++) { pb[dst + k] = 1; pm[dst + k] = 0; ps[dst + k] = 0; pl[dst + k] = 0; }
      }
    }
  }
  return maxY;
}

// nbr(dx,dz) -> Chunk|null ; returns {opaque, alpha, trans} BufferGeometry|null, plus maxY
export function meshChunk(chunk, nbr) {
  let maxY = -1;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ch = (dx === 0 && dz === 0) ? chunk : nbr(dx, dz);
    const m = loadPad(ch, dx, dz);
    if (dx === 0 && dz === 0) maxY = m;
  }
  GR[0].reset(); GR[1].reset(); GR[2].reset();
  const top = Math.min(127, maxY + 1);
  const wx = 0, wz = 0;
  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < 16; z++) {
      let base = ((y + 1) * PW + (z + 1)) * PW + 1;
      for (let x = 0; x < 16; x++, base++) {
        const id = pb[base];
        if (id === 0) continue;
        const shape = SHAPE[id];
        const g = GR[GRP[id]];
        switch (shape) {
          case 0: emitCube(g, id, x, y, z, base); break;
          case 1: { // cross
            const sky = ps[base], blk = pl[base];
            const ox = (hash2(x + chunk.cx * 16, z + chunk.cz * 16) - 0.5) * 0.25, oz = (hash2(z + chunk.cz * 16 + 7, x + chunk.cx * 16 + 3) - 0.5) * 0.25;
            emitVQuad(g, id, x + ox, y, z + oz, 0.1, 0.1, 0.9, 0.9, 0, 1, sky, blk, 1);
            emitVQuad(g, id, x + ox, y, z + oz, 0.1, 0.9, 0.9, 0.1, 0, 1, sky, blk, 1);
            break;
          }
          case 2: // torch
            emitBox(g, id, x, y, z, 0.4375, 0, 0.4375, 0.5625, 0.6875, 0.5625, 0b111111, ps[base], pl[base], 0.125);
            break;
          case 3: { // cactus
            const sky = ps[base], blk = pl[base];
            const up = pb[base + LAYER], dn = pb[base - LAYER];
            let m = 0;
            if (!OPQ[up] && up !== id) m |= 4;
            if (!OPQ[dn] && dn !== id) m |= 8;
            if (m) emitBox(g, id, x, y, z, 0, 0, 0, 1, 1, 1, m, sky, blk, 0);
            emitBox(g, id, x, y, z, 1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16, 0b110011, sky, blk, 0);
            break;
          }
          case 4: { // portal
            const sky = ps[base], blk = pl[base];
            if (id === B.END_PORTAL) {
              const o = (id * 6 + 2) * 4;
              const U0 = TUV[o], V0 = TUV[o + 1], U1 = TUV[o + 2], V1 = TUV[o + 3];
              const yy = y + 0.75;
              g.v(x, yy, z + 1, U0, V0, sky, blk, 1); g.v(x + 1, yy, z + 1, U1, V0, sky, blk, 1);
              g.v(x + 1, yy, z, U1, V1, sky, blk, 1); g.v(x, yy, z, U0, V1, sky, blk, 1);
              g.quad(false);
            } else if (pm[base] & 1) emitVQuad(g, id, x, y, z, 0.5, 0, 0.5, 1, 0, 1, sky, blk, 1);
            else emitVQuad(g, id, x, y, z, 0, 0.5, 1, 0.5, 0, 1, sky, blk, 1);
            break;
          }
          case 5: { // fire
            const sky = 0, blk = 15;
            emitVQuad(g, id, x, y, z, 0, 0, 1, 1, 0, 1.0, sky, blk, 1);
            emitVQuad(g, id, x, y, z, 0, 1, 1, 0, 0, 1.0, sky, blk, 1);
            emitVQuad(g, id, x, y, z, 0.1, 0, 0.1, 1, 0, 1.0, sky, blk, 1);
            emitVQuad(g, id, x, y, z, 0.9, 0, 0.9, 1, 0, 1.0, sky, blk, 1);
            emitVQuad(g, id, x, y, z, 0, 0.1, 1, 0.1, 0, 1.0, sky, blk, 1);
            emitVQuad(g, id, x, y, z, 0, 0.9, 1, 0.9, 0, 1.0, sky, blk, 1);
            break;
          }
          case 6: emitLiquid(g, id, x, y, z, base); break;
          case 7: { // end portal frame
            const sky = ps[base], blk = pl[base];
            emitBox(g, id, x, y, z, 0, 0, 0, 1, 13 / 16, 1, 0b111111 & ~(OPQ[pb[base - LAYER]] ? 8 : 0), sky, blk, 0);
            if (pm[base] & 4) {
              // eye: small block on top
              const ho = (id * 6 + 2) * 4; // use top tile tinted by choosing eye tile if present
              emitBox(g, EYE_ID, x, y, z, 0.25, 13 / 16, 0.25, 0.75, 1, 0.75, 0b111111, sky, blk, 0);
            }
            break;
          }
          case 8: { // chest
            const sky = ps[base], blk = pl[base];
            emitBox(g, id, x, y, z, 1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16, 0b111111, sky, blk, 0);
            break;
          }
        }
      }
    }
  }
  const cy = (top + 1) * 0.5, r = Math.sqrt(8 * 8 + 8 * 8 + cy * cy) + 1;
  return {
    opaque: GR[0].toGeometry(8, cy, 8, r), alpha: GR[1].toGeometry(8, cy, 8, r), trans: GR[2].toGeometry(8, cy, 8, r), maxY,
  };
}
const EYE_ID = 255; // virtual id slot for the eye tile in TUV (block 255 is unused)
export function setEyeTile(atlas) {
  const uv = safeUV(atlas, 'endframe_eye', 'endframe_top');
  for (let f = 0; f < 6; f++) { const o = (EYE_ID * 6 + f) * 4; TUV[o] = uv[0]; TUV[o + 1] = uv[1]; TUV[o + 2] = uv[2]; TUV[o + 3] = uv[3]; }
}

// ------------------------------------------------------------------ chunk materials
const VERT = `
uniform float dayFactor; uniform float ambient; uniform vec3 skyTint;
attribute vec4 light;
varying vec2 vUv; varying vec3 vCol; varying float vDist;
void main(){
  vUv = uv;
  float sky = light.x * dayFactor;
  float bs = pow(0.8, 15.0 * (1.0 - sky));
  float bb = pow(0.8, 15.0 * (1.0 - light.y));
  vec3 c = max(vec3(bs) * skyTint, vec3(bb) * vec3(1.0, 0.9, 0.76));
  c = max(c, vec3(ambient));
  vCol = c * light.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float alphaCut; uniform float opaqueOut;
varying vec2 vUv; varying vec3 vCol; varying float vDist;
void main(){
  vec4 t = texture2D(map, vUv);
  if (t.a < alphaCut) discard;
  vec3 col = t.rgb * vCol;
  float f = clamp((vDist - fogNear) / max(fogFar - fogNear, 0.001), 0.0, 1.0);
  col = mix(col, fogColor, f);
  gl_FragColor = vec4(col, mix(t.a, 1.0, opaqueOut));
}`;
export function createChunkMaterials(texture, shared) {
  const mk = (alphaCut, opaqueOut, extra) => new THREE.ShaderMaterial(Object.assign({
    uniforms: Object.assign({}, shared, { map: { value: texture }, alphaCut: { value: alphaCut }, opaqueOut: { value: opaqueOut } }),
    vertexShader: VERT, fragmentShader: FRAG,
  }, extra));
  return {
    opaque: mk(0, 1, {}),
    alpha: mk(0.5, 1, { side: THREE.DoubleSide }),
    trans: mk(0.02, 0, { transparent: true, side: THREE.DoubleSide, depthWrite: true }),
  };
}

// ------------------------------------------------------------------ item / block meshes
const DEF = { block: null, item: null };
export function setDefaultAtlases(block, item) { DEF.block = block; DEF.item = item; }
function resolveAtlases(a) {
  if (!a) return DEF;
  if (a.uv && a.texture) return { block: DEF.block, item: a };
  return { block: a.block ?? a.atlasBlock ?? DEF.block, item: a.item ?? a.atlasItem ?? DEF.item };
}
const matCache = new WeakMap();
function basicMat(atlas) {
  let m = matCache.get(atlas.texture);
  if (!m) { m = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.1 }); matCache.set(atlas.texture, m); }
  return m;
}
const blockGeoCache = new Map(), spriteGeoCache = new Map(), pixCache = new Map();

export function blockGeometry(blockId, atlas) {
  const key = blockId;
  let c = blockGeoCache.get(atlas.texture);
  if (!c) { c = new Map(); blockGeoCache.set(atlas.texture, c); }
  let g = c.get(key); if (g) return g;
  const pos = [], uvs = [], cols = [], idx = [];
  const sx = 0, bdef = BLOCKS[blockId];
  const shape = bdef ? bdef.shape : 'cube';
  let x0 = 0, y0 = 0, z0 = 0, x1 = 1, y1 = 1, z1 = 1;
  if (shape === 'frame') y1 = 13 / 16; else if (shape === 'chest') { x0 = z0 = 1 / 16; x1 = z1 = 15 / 16; y1 = 14 / 16; }
  for (let f = 0; f < 6; f++) {
    const name = faceTile(blockId, f);
    const uv = name ? safeUV(atlas, name) : [0, 0, 1, 1];
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const p = FV[f][k];
      const px = p[0] ? x1 : x0, py = p[1] ? y1 : y0, pz = p[2] ? z1 : z0;
      pos.push(px - 0.5, py - 0.5, pz - 0.5);
      uvs.push(uv[0] + (uv[2] - uv[0]) * faceU(f, px, pz), uv[1] + (uv[3] - uv[1]) * faceV(f, py, pz));
      const s = SHADE[f]; cols.push(s, s, s);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  c.set(key, g);
  return g;
}
export function makeBlockMesh(blockId, atlas) {
  atlas = atlas || DEF.block;
  const m = new THREE.Mesh(blockGeometry(blockId, atlas), basicMat(atlas));
  m.userData.kind = 'block';
  return m;
}

function getPixels(atlas, name) {
  const key = atlas.texture.uuid + ':' + name;
  let d = pixCache.get(key); if (d) return d;
  const uv = safeUV(atlas, name);
  const cv = atlas.canvas, W = cv.width, H = cv.height;
  const x = Math.round(uv[0] * W), y = Math.round((1 - uv[3]) * H);
  const ts = Math.round((uv[2] - uv[0]) * W) || 16;
  let data = null;
  try { data = cv.getContext('2d').getImageData(x, y, ts, ts).data; } catch (e) { data = null; }
  d = { data, ts, uv };
  pixCache.set(key, d);
  return d;
}
export function spriteGeometry(name, atlas) {
  let c = spriteGeoCache.get(atlas.texture);
  if (!c) { c = new Map(); spriteGeoCache.set(atlas.texture, c); }
  let g = c.get(name); if (g) return g;
  const { data, ts, uv } = getPixels(atlas, name);
  const [u0, v0, u1, v1] = uv;
  const pos = [], uvs = [], cols = [], idx = [];
  const T = 1 / 16, h = T / 2;
  const quad = (pts, uvl, s) => {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) { pos.push(pts[k][0], pts[k][1], pts[k][2]); uvs.push(uvl[k][0], uvl[k][1]); cols.push(s, s, s); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad([[-.5, -.5, h], [.5, -.5, h], [.5, .5, h], [-.5, .5, h]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], 1);
  quad([[.5, -.5, -h], [-.5, -.5, -h], [-.5, .5, -h], [.5, .5, -h]], [[u1, v0], [u0, v0], [u0, v1], [u1, v1]], 1);
  const op = (px, py) => px >= 0 && py >= 0 && px < ts && py < ts && (!data || data[(py * ts + px) * 4 + 3] > 20);
  for (let py = 0; py < ts; py++) for (let px = 0; px < ts; px++) {
    if (!op(px, py)) continue;
    const xa = px / ts - .5, xb = (px + 1) / ts - .5, yt = .5 - py / ts, yb = .5 - (py + 1) / ts;
    const uc = u0 + (u1 - u0) * (px + .5) / ts, vc = v1 - (v1 - v0) * (py + .5) / ts, U = [[uc, vc], [uc, vc], [uc, vc], [uc, vc]];
    if (!op(px + 1, py)) quad([[xb, yb, h], [xb, yb, -h], [xb, yt, -h], [xb, yt, h]], U, 0.8);
    if (!op(px - 1, py)) quad([[xa, yb, -h], [xa, yb, h], [xa, yt, h], [xa, yt, -h]], U, 0.8);
    if (!op(px, py - 1)) quad([[xa, yt, h], [xb, yt, h], [xb, yt, -h], [xa, yt, -h]], U, 0.9);
    if (!op(px, py + 1)) quad([[xa, yb, -h], [xb, yb, -h], [xb, yb, h], [xa, yb, h]], U, 0.7);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  c.set(name, g);
  return g;
}

// returns {geometry, atlas, kind:'block'|'sprite'} or null
export function itemGeometry(itemId, atlases) {
  const A = resolveAtlases(atlases);
  const it = getItem(itemId);
  if (!it) return null;
  if (it.block && !it.sprite && A.block) return { geometry: blockGeometry(it.block, A.block), atlas: A.block, kind: 'block' };
  const name = it.sprite || it.tex;
  if (name && A.item) return { geometry: spriteGeometry(name, A.item), atlas: A.item, kind: 'sprite' };
  return null;
}
export function makeItemMesh(itemId, atlases) {
  const r = itemGeometry(itemId, atlases);
  if (!r) return new THREE.Group();
  const m = new THREE.Mesh(r.geometry, basicMat(r.atlas));
  m.userData.kind = r.kind;
  return m;
}
export { basicMat as itemBasicMaterial };
