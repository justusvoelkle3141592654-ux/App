// entities.js — EntityManager: Item-Entities, Mobs, Projektile, Explosionen, Spawning, Ender Dragon.
import * as THREE from 'three';
import { B, I, BLOCKS, ITEMS, getItem, faceTile } from './registry.js';
import { createMob, normalizeMobType, MOB_DEFS, rayBox, dayFactor, endPillarsFallback, clamp } from './mobs.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const _col = new THREE.Color();

// ---------------------------------------------------------------- Item-Meshes (eigene Fallback-Implementierung ueber getTileCanvas)
const texCache = new Map(), spriteGeoCache = new Map();
function tileTexture(name, canvas) {
  let t = texCache.get(name);
  if (!t) {
    t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(name, t);
  }
  return t;
}
function spriteGeometry(name, canvas) {
  let g = spriteGeoCache.get(name); if (g) return g;
  const ctx = canvas.getContext('2d'), N = canvas.width || 16, img = ctx.getImageData(0, 0, N, N).data;
  const pos = [], col = [], idx = [], T = 2 / N, op = (x, y) => x >= 0 && y >= 0 && x < N && y < N && img[(y * N + x) * 4 + 3] > 40;
  const quad = (a, b, c, d, k, rgb) => {
    const o = pos.length / 3; for (const q of [a, b, c, d]) { pos.push(q[0], q[1], q[2]); col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k); }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!op(x, y)) continue;
    const i = (y * N + x) * 4; _col.setRGB(img[i] / 255, img[i + 1] / 255, img[i + 2] / 255, THREE.SRGBColorSpace);
    const rgb = [_col.r, _col.g, _col.b];
    const x0 = x / N - 0.5, x1 = (x + 1) / N - 0.5, y1 = (N - y) / N - 0.5, y0 = (N - y - 1) / N - 0.5, z0 = -T / 2, z1 = T / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1, rgb);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0.8, rgb);
    if (!op(x + 1, y)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0.7, rgb);
    if (!op(x - 1, y)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0.7, rgb);
    if (!op(x, y - 1)) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0.9, rgb);
    if (!op(x, y + 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.6, rgb);
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  spriteGeoCache.set(name, g); return g;
}

// ================================================================= EntityManager
export class EntityManager {
  constructor(game) {
    this.game = game;
    this.mobs = []; this.items = []; this.projectiles = []; this.tnts = []; this.crystals = []; this.pending = [];
    this.dragon = null; this.dim = game.dimension || 'overworld'; this._lastDim = null;
    this.timeOfDay = game.time ?? 6000; this.spawnT = 0; this.passiveT = 0; this.boost = 8; this._extSpawnAt = -1e9; this._clock = 0;
    this._pendingCrystals = []; this.mergeT = 0; this._errLogged = false;
    this._getTile = null; this._pillars = null;
    import('./textures.js').then((m) => { this._getTile = m.getTileCanvas || null; }).catch(() => {});
    this._worldMod = import('./world.js').then((m) => { this._pillars = m.END_PILLARS || null; return m; }).catch(() => null);
  }
  get world() { return this.game.world; }
  get scene() { return this.game.renderer?.scene; }
  tile(name) { const f = this.game.textures?.getTileCanvas || this._getTile; if (!f || !name) return null; try { return f(name); } catch (e) { return null; } }

  // ---------------- Spieler-Helfer
  playerPos() { return this.game.player?.pos || new THREE.Vector3(0, -999, 0); }
  playerEye() {
    const p = this.game.player; if (!p) return new THREE.Vector3(0, -999, 0);
    const e = typeof p.eye === 'function' ? p.eye() : p.eye;
    if (e && e.isVector3) return e.clone();
    return new THREE.Vector3(p.pos.x, p.pos.y + (p.eyeHeight ?? 1.62), p.pos.z);
  }
  playerAlive() { const p = this.game.player; return !!p && !p.dead && (p.health === undefined || p.health > 0); }
  playerTargetable() { return this.playerAlive() && this.game.gamemode !== 'creative' && this.game.gamemode !== 'spectator'; }
  damagePlayer(amount, src, kbStrength = 0) {
    const p = this.game.player; if (!p || !this.playerAlive()) return;
    if (p.hurt) p.hurt(amount, { type: 'mob', from: src ? { x: src.x, z: src.z } : undefined, knockback: kbStrength || 1 });
    else p.damage?.(amount, src);
  }
  audio(name, vol) {
    const MAP = { explode: 'explosion', shoot: 'bow', fireball: 'ignite', hurt: null, death: null, dragon_death: 'explosion', dragon_growl: null, hit: 'hit' };
    const n = name in MAP ? MAP[name] : name; if (!n) return;
    try { this.game.audio?.play?.(n, vol); } catch (e) { /* ignore */ }
  }
  pushPlayer(x, y, z) { const p = this.game.player; if (!p) return; if (p.addVelocity) p.addVelocity(x / 20, y / 20, z / 20); else if (p.vel) { p.vel.x += x / 20; p.vel.y += y / 20; p.vel.z += z / 20; } }
  giveXP(n) { if (n <= 0) return; const g = this.game; try { if (g.player?.addXp) g.player.addXp(n); else if (g.addXP) g.addXP(n); else if (g.player?.addXP) g.player.addXP(n); } catch (e) { /* ignore */ } }
  brightnessAt(x, y, z, full) {
    if (full) return 1;
    const w = this.world, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const sky = (w.getSky?.(ix, iy, iz) ?? 15) * (this.dim === 'overworld' ? dayFactor(this.timeOfDay) : 1);
    const blk = w.getBlockLight?.(ix, iy, iz) ?? 0;
    const l = Math.max(sky, blk), floor = this.dim === 'overworld' ? 0.1 : this.dim === 'nether' ? 0.4 : 0.65;
    return Math.max(floor, Math.pow(0.8, 15 - l));
  }
  chunkLoaded(x, z) { const w = this.world; return !w.getChunk || !!w.getChunk(Math.floor(x / 16), Math.floor(z / 16)); }
  solidBox(x, y, z, hw, h) {
    const w = this.world, e = 1e-3;
    for (let ix = Math.floor(x - hw); ix <= Math.floor(x + hw); ix++) for (let iz = Math.floor(z - hw); iz <= Math.floor(z + hw); iz++) for (let iy = Math.floor(y + e); iy <= Math.floor(y + h - e); iy++) if (w.isSolid(ix, iy, iz)) return true;
    return false;
  }

  // ---------------- Items
  addItem(id, count, x, y, z, vel) {
    if (!id || count <= 0) return null;
    const it = getItem(id), max = it?.stack ?? 64;
    if (!vel) for (const o of this.items) {
      if (o.id === id && o.count + count <= max && Math.abs(o.pos.x - x) < 0.9 && Math.abs(o.pos.y - y) < 0.9 && Math.abs(o.pos.z - z) < 0.9) { o.count += count; o.age = 0; o._rebuild = true; return o; }
    }
    const e = { id, count, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), age: 0, delay: vel ? 1.2 : 0.5, t: Math.random() * 10, mesh: null, bright: 1, lightT: 0, mat: [], _rebuild: false, onGround: false };
    if (vel) { e.vel.set(vel.x ?? vel[0] ?? 0, vel.y ?? vel[1] ?? 0, vel.z ?? vel[2] ?? 0); } else e.vel.set(rand(-1.4, 1.4), rand(3, 4.5), rand(-1.4, 1.4));
    this.items.push(e);
    return e;
  }
  _buildItemMesh(e) {
    const it = getItem(e.id); if (!it) return false;
    const grp = new THREE.Group(); const mats = [];
    const bdef = BLOCKS[it.block || 0];
    let ok = true;
    if (bdef && it.block && bdef.shape !== 'cross' && bdef.shape !== 'torch' && !it.sprite) {
      const mm = [];
      for (let f = 0; f < 6; f++) {
        const name = faceTile(e.id, f), cv = this.tile(name);
        if (!cv) { ok = false; break; }
        const m = new THREE.MeshBasicMaterial({ map: tileTexture(name, cv), alphaTest: bdef.alpha ? 0.5 : 0, transparent: false }); mm.push(m); mats.push(m);
      }
      if (!ok) return false;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mm); grp.add(mesh); e.size = 0.26;
    } else {
      const name = it.sprite || it.tex, cv = this.tile(name); if (!cv) return false;
      const geo = spriteGeometry(name, cv), m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }); mats.push(m);
      const mesh = new THREE.Mesh(geo, m); mesh.scale.setScalar(0.48); grp.add(mesh); e.size = 0.3;
    }
    const n = e.count > 32 ? 4 : e.count > 16 ? 3 : e.count > 1 ? 2 : 1;
    const base = grp.children[0];
    for (let k = 1; k < n; k++) { const c = new THREE.Mesh(base.geometry, base.material); c.scale.copy(base.scale); c.position.set(0.07 * k * (k % 2 ? 1 : -1), 0.02 * k, 0.05 * k); grp.add(c); }
    if (e.mesh) { this.scene?.remove(e.mesh); e.mat.forEach((m) => m.dispose()); }
    e.mesh = grp; e.mat = mats; e._n = n; this.scene?.add(grp); return true;
  }
  _removeItem(e) { this.scene?.remove(e.mesh); e.mat.forEach((m) => m.dispose()); const i = this.items.indexOf(e); if (i >= 0) this.items.splice(i, 1); }
  _updateItems(dt) {
    const w = this.world, pp = this.playerPos(), alive = this.playerAlive();
    this.mergeT -= dt; const doMerge = this.mergeT <= 0; if (doMerge) this.mergeT = 0.5;
    for (let n = this.items.length - 1; n >= 0; n--) {
      const e = this.items[n]; e.age += dt; e.delay -= dt; e.t += dt;
      if (e.age > 300 || e.pos.y < -20) { this._removeItem(e); continue; }
      if (!e.mesh || e._rebuild) { e._rebuild = false; if (!this._buildItemMesh(e)) continue; }
      const p = e.pos, v = e.vel;
      if (this.chunkLoaded(p.x, p.z)) {
        const inLiq = w.isLiquid(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z));
        if (inLiq && w.getBlock(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)) === B.LAVA) { this.game.renderer?.addParticles?.('smoke', p.x, p.y, p.z, 0, 6); this._removeItem(e); continue; }
        if (inLiq) { v.y += (1.5 - v.y) * Math.min(1, 3 * dt); v.x *= 1 - 3 * dt; v.z *= 1 - 3 * dt; } else v.y = Math.max(v.y - 20 * dt, -40);
        // magnet
        if (alive && e.delay <= 0) {
          const dx = pp.x - p.x, dy = pp.y + 0.8 - p.y, dz = pp.z - p.z, d = Math.hypot(dx, dy, dz);
          if (d < 1.0) { if (this._pickup(e)) continue; }
          else if (d < 2.0) { const k = (2.0 - d) * 9 * dt; v.x += dx / d * k * 6; v.y += dy / d * k * 6 + 8 * dt; v.z += dz / d * k * 6; }
        }
        const sub = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.3)), sdt = dt / sub, hw = 0.13, h = 0.26;
        e.onGround = false;
        for (let s = 0; s < sub; s++) {
          if (this.solidBox(p.x, p.y, p.z, hw, h)) { p.y += 4 * sdt; v.y = Math.max(v.y, 0); continue; }
          const ny = p.y + v.y * sdt;
          if (this.solidBox(p.x, ny, p.z, hw, h)) { if (v.y < 0) { e.onGround = true; p.y = Math.floor(ny) + 1; if (this.solidBox(p.x, p.y, p.z, hw, h)) p.y = ny + 0.0; } v.y *= v.y < -3 ? -0.25 : 0; if (Math.abs(v.y) < 0.8) v.y = 0; } else p.y = ny;
          const nx = p.x + v.x * sdt; if (this.solidBox(nx, p.y, p.z, hw, h)) v.x *= -0.3; else p.x = nx;
          const nz = p.z + v.z * sdt; if (this.solidBox(p.x, p.y, nz, hw, h)) v.z *= -0.3; else p.z = nz;
        }
        if (e.onGround) { const f = Math.exp(-10 * dt); v.x *= f; v.z *= f; }
      }
      // Merge
      if (doMerge) for (let m = n - 1; m >= 0; m--) {
        const o = this.items[m]; if (o.id !== e.id) continue;
        const max = getItem(e.id)?.stack ?? 64;
        if (o.count + e.count <= max && Math.abs(o.pos.x - p.x) < 0.7 && Math.abs(o.pos.y - p.y) < 0.7 && Math.abs(o.pos.z - p.z) < 0.7) { o.count += e.count; o.age = Math.min(o.age, e.age); o._rebuild = true; this._removeItem(e); break; }
      }
      if (!this.items.includes(e)) continue;
      if (e.mesh) {
        const bob = Math.sin(e.t * 2.4) * 0.05 + 0.18;
        e.mesh.position.set(p.x, p.y + bob, p.z); e.mesh.rotation.y = e.t * 1.6;
        e.lightT -= dt; if (e.lightT <= 0) { e.lightT = 0.5 + Math.random() * 0.2; e.bright = this.brightnessAt(p.x, p.y + 0.3, p.z); for (const m of e.mat) m.color.setScalar(e.bright); }
        if (e.age > 270 && Math.floor(e.age * 6) % 2 === 0) e.mesh.visible = false; else e.mesh.visible = true;
      }
    }
  }
  _pickup(e) {
    const inv = this.game.inventory; if (!inv) return false;
    const rest = inv.add(e.id, e.count, 0) ?? 0;
    if (rest >= e.count) { e.delay = 0.5; return false; }
    this.audio('pickup');
    if (rest <= 0) { this._removeItem(e); return true; }
    e.count = rest; e._rebuild = true; e.delay = 0.6; return false;
  }

  // ---------------- Mobs
  spawnMob(type, x, y, z, opts) {
    const t = normalizeMobType(type); if (!t) return null;
    if (t === 'dragon' && this.dragon) return this.dragon;
    const m = createMob(this, t, x, y, z);
    if (!opts || !opts.natural) m.persist = true;
    this.mobs.push(m);
    if (t === 'dragon') this.dragon = m;
    if (t === 'crystal') this.crystals.push(m);
    return m;
  }
  removeMob(m) {
    const i = this.mobs.indexOf(m); if (i >= 0) this.mobs.splice(i, 1);
    const j = this.crystals.indexOf(m); if (j >= 0) this.crystals.splice(j, 1);
    if (this.dragon === m && m.dead && !m.dying) this.dragon = null;
    m.dispose?.();
  }
  angerPigmen(src) { for (const m of this.mobs) if (m.type === 'pigman' && m.pos.distanceTo(src.pos) < 24) m.angry = 25; }
  raycastEntity(ox, oy, oz, dx, dy, dz, max = 4) {
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    let best = null, bd = max;
    for (const m of this.mobs) {
      if (m.dead) continue;
      for (const b of m.hitBoxes()) { const t = rayBox(ox, oy, oz, dx, dy, dz, b); if (t >= 0 && t <= bd) { bd = t; best = m; } }
    }
    return best ? { entity: best, dist: bd } : null;
  }
  damageMob(mob, amount, knockbackDir) { if (!mob || mob.dead) return false; return mob.hurt(amount, knockbackDir); }
  mobCounts() {
    let hostile = 0, passive = 0, nether = 0, ender = 0;
    for (const m of this.mobs) {
      if (m.dead || m.persist) continue; const t = m.type;
      if (t === 'pigman' || t === 'blaze') nether++; else if (t === 'enderman') ender++;
      else if (m.def.kind === 'passive') passive++; else if (m.def.kind === 'hostile') hostile++;
    }
    return { hostile, passive, nether, ender };
  }

  // ---------------- Projektile
  _mkArrowMesh() {
    const g = new THREE.Group(), mk = (w, h, d, c, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c })); m.position.z = z; g.add(m); return m; };
    mk(0.035, 0.035, 0.7, 0xb08a5a, 0); mk(0.08, 0.08, 0.12, 0x8a8a8a, 0.4);
    const f1 = mk(0.15, 0.01, 0.16, 0xeeeeee, -0.3), f2 = mk(0.01, 0.15, 0.16, 0xeeeeee, -0.3); void f1; void f2;
    return g;
  }
  shootArrow(ox, oy, oz, dx, dy, dz, speed = 30, opts = {}) {
    if (ox && ox.isVector3 !== undefined && typeof ox === 'object' && oy && typeof oy === 'object') { // (origin, dir, speed, opts)
      const o = ox, d = oy; opts = dz || {}; speed = dy ?? 30; ox = o.x; oy = o.y; oz = o.z; dx = d.x; dy = d.y; dz = d.z;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    const p = { kind: 'arrow', pos: new THREE.Vector3(ox, oy, oz), vel: new THREE.Vector3(dx / l * speed, dy / l * speed, dz / l * speed), owner: opts.owner || 'player', damage: opts.damage ?? Math.max(1, Math.round(speed * 0.15)), life: 0, stuck: false, stuckT: 0, mesh: this._mkArrowMesh(), source: opts.source || null, crit: !!opts.crit };
    p.mesh.position.copy(p.pos); this.scene?.add(p.mesh); this.projectiles.push(p); return p;
  }
  shootFireball(ox, oy, oz, dx, dy, dz, speed = 16, opts = {}) {
    const l = Math.hypot(dx, dy, dz) || 1;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), new THREE.MeshBasicMaterial({ color: 0xff8a1f })));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffe36a })));
    const p = { kind: 'fireball', pos: new THREE.Vector3(ox, oy, oz), vel: new THREE.Vector3(dx / l * speed, dy / l * speed, dz / l * speed), owner: 'mob', damage: opts.damage ?? 5, fire: opts.fire !== false, life: 0, mesh: g, trail: 0 };
    g.position.copy(p.pos); this.scene?.add(g); this.projectiles.push(p); return p;
  }
  throwPearl(ox, oy, oz, dx, dy, dz, speed = 26, opts = {}) {
    const l = Math.hypot(dx, dy, dz) || 1;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1d7a6a }));
    const p = { kind: 'pearl', pos: new THREE.Vector3(ox, oy, oz), vel: new THREE.Vector3(dx / l * speed, dy / l * speed, dz / l * speed), owner: 'player', life: 0, mesh: m, onLand: opts.onLand || null };
    m.position.copy(p.pos); this.scene?.add(m); this.projectiles.push(p); return p;
  }
  _removeProj(p) { this.scene?.remove(p.mesh); p.mesh.traverse?.((o) => { if (o.material) o.material.dispose?.(); if (o.geometry && p.kind !== 'sprite') o.geometry.dispose?.(); }); const i = this.projectiles.indexOf(p); if (i >= 0) this.projectiles.splice(i, 1); }
  _updateProjectiles(dt) {
    const w = this.world, pp = this.playerPos();
    for (let n = this.projectiles.length - 1; n >= 0; n--) {
      const p = this.projectiles[n]; p.life += dt;
      if (p.kind === 'arrow' && p.stuck) {
        p.stuckT += dt;
        if (p.stuckT > 60) { this._removeProj(p); continue; }
        if (p.owner === 'player' && this.playerAlive() && p.stuckT > 0.3 && Math.hypot(pp.x - p.pos.x, pp.y + 0.9 - p.pos.y, pp.z - p.pos.z) < 1.2) {
          const rest = this.game.inventory?.add(I.ARROW, 1) ?? 1; if (rest === 0) { this.audio('pickup'); this._removeProj(p); }
        }
        continue;
      }
      if (p.life > 30 || p.pos.y < -30) { this._removeProj(p); continue; }
      if (!this.chunkLoaded(p.pos.x, p.pos.z)) { this._removeProj(p); continue; }
      const grav = p.kind === 'fireball' ? 0 : p.kind === 'pearl' ? 22 : 20;
      p.vel.y -= grav * dt; if (p.kind === 'arrow') p.vel.multiplyScalar(1 - 0.2 * dt);
      const dist = p.vel.length() * dt, steps = Math.max(1, Math.ceil(dist / 0.25)), sdt = dt / steps;
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
        p.pos.addScaledVector(p.vel, sdt);
        const bx = Math.floor(p.pos.x), by = Math.floor(p.pos.y), bz = Math.floor(p.pos.z);
        if (w.isSolid(bx, by, bz)) { hit = true; this._projHitBlock(p, px, py, pz, bx, by, bz); break; }
        // Entities
        if (p.owner === 'mob') {
          if (this.playerAlive() && Math.abs(p.pos.x - pp.x) < 0.45 && Math.abs(p.pos.z - pp.z) < 0.45 && p.pos.y > pp.y - 0.1 && p.pos.y < pp.y + 1.9) {
            hit = true;
            if (this.game.gamemode !== 'creative') { this.damagePlayer(p.damage, p.source ? p.source.pos : { x: p.pos.x - p.vel.x, y: p.pos.y, z: p.pos.z - p.vel.z }, 0.6); if (p.kind === 'fireball') { this.game.player?.setOnFire?.(5); } }
            this._removeProj(p); break;
          }
        } else {
          for (const m of this.mobs) {
            if (m.dead) continue;
            if (m.type !== 'dragon' && m.type !== 'crystal' && (Math.abs(m.pos.x - p.pos.x) > 3 || Math.abs(m.pos.z - p.pos.z) > 3)) continue;
            let inside = false;
            for (const b of m.hitBoxes()) if (p.pos.x > b.min.x - 0.1 && p.pos.x < b.max.x + 0.1 && p.pos.y > b.min.y - 0.1 && p.pos.y < b.max.y + 0.1 && p.pos.z > b.min.z - 0.1 && p.pos.z < b.max.z + 0.1) inside = true;
            if (!inside) continue;
            hit = true;
            if (p.kind === 'arrow') { const l = p.vel.length() || 1; this.damageMob(m, p.damage, { x: p.vel.x / l, z: p.vel.z / l }); this.audio('hit'); this._removeProj(p); }
            else if (p.kind === 'pearl') this._pearlLand(p);
            break;
          }
        }
      }
      if (hit) continue;
      p.mesh.position.copy(p.pos);
      if (p.kind === 'arrow') p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      else if (p.kind === 'fireball') { p.mesh.rotation.x += dt * 5; p.mesh.rotation.y += dt * 7; p.trail -= dt; if (p.trail <= 0) { p.trail = 0.07; this.game.renderer?.addParticles?.('flame', p.pos.x, p.pos.y, p.pos.z, 0, 1); } }
    }
  }
  _projHitBlock(p, px, py, pz, bx, by, bz) {
    if (p.kind === 'arrow') {
      p.stuck = true; p.pos.set(px, py, pz); p.mesh.position.copy(p.pos); this.audio('hit'); p.vel.set(0, 0, 0);
      if (p.owner === 'mob') { this._removeProj(p); }
    } else if (p.kind === 'fireball') {
      const fx = Math.floor(px), fy = Math.floor(py), fz = Math.floor(pz);
      this.game.renderer?.addParticles?.('flame', px, py, pz, 0, 8);
      if (p.fire && this.world.getBlock(fx, fy, fz) === 0) { try { this.world.setBlock(fx, fy, fz, B.FIRE); } catch (e) { /* ignore */ } }
      this._removeProj(p);
    } else if (p.kind === 'pearl') { p.pos.set(px, py, pz); this._pearlLand(p); }
  }
  _pearlLand(p) {
    const w = this.world; let x = p.pos.x, y = p.pos.y, z = p.pos.z;
    const free = (a, b, c) => !w.isSolid(Math.floor(a), Math.floor(b), Math.floor(c)) && !w.isSolid(Math.floor(a), Math.floor(b) + 1, Math.floor(c));
    let ok = free(x, y, z);
    if (!ok) for (const [ax, ay, az] of [[0, 1, 0], [0, 2, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) if (free(x + ax, y + ay, z + az)) { x += ax; y += ay; z += az; ok = true; break; }
    const r = this.game.renderer, pl = this.game.player;
    if (ok) {
      r?.addParticles?.('portal', pl?.pos.x ?? x, (pl?.pos.y ?? y) + 1, pl?.pos.z ?? z, 0, 24);
      if (p.onLand) p.onLand({ x, y, z });
      else if (pl) { if (pl.teleport) pl.teleport(x, y, z); else pl.pos.set(x, y, z); if (pl.vel) pl.vel.set(0, 0, 0); if (this.game.gamemode !== 'creative') { if (pl.hurt) pl.hurt(5, { type: 'fall', ignoreInvuln: true }); else pl.damage?.(5); } }
      r?.addParticles?.('portal', x, y + 1, z, 0, 24); this.audio('teleport');
    }
    this._removeProj(p);
  }

  // ---------------- TNT / Explosionen
  primeTnt(x, y, z, fuse = 4, vel) {
    const w = this.world; if (w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.TNT) w.setBlock(Math.floor(x), Math.floor(y), Math.floor(z), 0);
    const e = { pos: new THREE.Vector3(Math.floor(x) + 0.5, Math.floor(y), Math.floor(z) + 0.5), vel: new THREE.Vector3(vel?.x ?? rand(-0.5, 0.5), vel?.y ?? 4, vel?.z ?? rand(-0.5, 0.5)), fuse, mesh: null, mats: [] };
    const mm = [];
    for (let f = 0; f < 6; f++) { const nm = faceTile(B.TNT, f), cv = this.tile(nm); mm.push(new THREE.MeshBasicMaterial(cv ? { map: tileTexture(nm, cv) } : { color: 0xdd3333 })); }
    e.mats = mm; e.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.98), mm); e.mesh.position.copy(e.pos); this.scene?.add(e.mesh);
    this.tnts.push(e); this.audio('fuse'); return e;
  }
  _updateTnts(dt) {
    for (let n = this.tnts.length - 1; n >= 0; n--) {
      const e = this.tnts[n]; e.fuse -= dt; const p = e.pos, v = e.vel;
      v.y -= 20 * dt; const ny = p.y + v.y * dt;
      if (this.solidBox(p.x, ny, p.z, 0.49, 0.98)) { if (v.y < 0) p.y = Math.floor(ny) + 1; v.y = 0; v.x *= 0.7; v.z *= 0.7; } else p.y = ny;
      const nx = p.x + v.x * dt; if (!this.solidBox(nx, p.y, p.z, 0.49, 0.98)) p.x = nx; else v.x = 0;
      const nz = p.z + v.z * dt; if (!this.solidBox(p.x, p.y, nz, 0.49, 0.98)) p.z = nz; else v.z = 0;
      e.mesh.position.set(p.x, p.y + 0.49, p.z);
      const flash = Math.floor(e.fuse * 5) % 2 === 0 && e.fuse < 3.5; const s = 1 + (e.fuse < 0.6 ? (0.6 - e.fuse) * 0.3 : 0);
      e.mesh.scale.setScalar(s); for (const m of e.mats) m.color.setScalar(flash ? 2.2 : 1);
      if (e.fuse <= 0) { this.scene?.remove(e.mesh); e.mats.forEach((m) => m.dispose()); this.tnts.splice(n, 1); this.explode(p.x, p.y + 0.5, p.z, 4); }
    }
  }
  _resist(id) {
    const b = BLOCKS[id]; if (!b) return 0;
    if (b.liquid) return 100;
    if (!b.breakable || b.hardness < 0) return 3600000;
    return b.hardness * 5;
  }
  explode(x, y, z, power = 3, opts = {}) {
    const w = this.world, destroyed = new Map(), rg = this.game.renderer;
    const N = 16;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      if (!(i === 0 || i === N - 1 || j === 0 || j === N - 1 || k === 0 || k === N - 1)) continue;
      let dx = i / (N - 1) * 2 - 1, dy = j / (N - 1) * 2 - 1, dz = k / (N - 1) * 2 - 1; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      let inten = power * (0.7 + Math.random() * 0.6), cx = x, cy = y, cz = z;
      while (inten > 0) {
        const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
        if (by < 0 || by > 127) break;
        const id = w.getBlock(bx, by, bz);
        if (id) { inten -= (this._resist(id) + 0.3) * 0.3; if (inten > 0) destroyed.set(bx + ',' + by + ',' + bz, [bx, by, bz, id]); }
        cx += dx * 0.3; cy += dy * 0.3; cz += dz * 0.3; inten -= 0.225;
      }
    }
    for (const [bx, by, bz, id] of destroyed.values()) {
      if (id === B.TNT) { this.pending.push({ t: rand(0.4, 1.0), x: bx + 0.5, y: by, z: bz + 0.5, tnt: true }); }
      const bd = BLOCKS[id];
      if (id !== B.TNT && bd && Math.random() < 0.3 && bd.drop) this.addItem(bd.drop, bd.dropCount || 1, bx + 0.5, by + 0.5, bz + 0.5, { x: rand(-1, 1), y: rand(2, 4), z: rand(-1, 1) });
      try { w.setBlock(bx, by, bz, 0); } catch (e) { /* ignore */ }
      if (Math.random() < 0.08) rg?.addParticles?.('break', bx + 0.5, by + 0.5, bz + 0.5, id, 2);
    }
    if (opts.fire) for (const [bx, by, bz] of destroyed.values()) if (Math.random() < 0.15 && w.getBlock(bx, by, bz) === 0 && w.isSolid(bx, by - 1, bz)) { try { w.setBlock(bx, by, bz, B.FIRE); } catch (e) { /* ignore */ } }
    rg?.addParticles?.('explosion', x, y, z, 0, Math.min(60, 12 + power * 8));
    rg?.addParticles?.('smoke', x, y + 0.5, z, 0, 14);
    this.audio('explode');
    // Schaden
    const R = power * 2, ents = [];
    const pl = this.game.player;
    if (pl && this.playerAlive() && opts.damage !== false) ents.push({ p: pl.pos, cy: pl.pos.y + 0.9, player: true });
    for (const m of this.mobs) if (!m.dead && m !== opts.source && m.type !== 'crystal' && m.type !== 'dragon') ents.push({ p: m.pos, cy: m.pos.y + m.def.h / 2, mob: m });
    for (const e of ents) {
      const dx = e.p.x - x, dy = e.cy - y, dz = e.p.z - z, d = Math.hypot(dx, dy, dz);
      if (d > R) continue;
      const ray = d > 0.5 ? w.raycast?.(x, y, z, dx / d, dy / d, dz / d, Math.max(0.1, d - 0.3)) : null;
      const exposure = ray ? 0.35 : 1, impact = (1 - d / R) * exposure, dmg = ((impact * impact + impact) / 2 * 7 * R + 1) * 0.5;
      const dl = d || 1;
      if (e.player) {
        if (this.game.gamemode !== 'creative') { if (pl.hurt) pl.hurt(dmg, { type: 'explosion', from: { x, z }, knockback: 0.5 + impact * 2 }); else pl.damage?.(dmg, { x, y, z }); this.pushPlayer(dx / dl * impact * 6, impact * 4, dz / dl * impact * 6); }
      } else { e.mob.hurt(dmg, { x: dx, z: dz }); e.mob.vel.y += impact * 4; }
    }
    // Item-Entities in der Naehe wegschleudern (nicht zerstoeren)
    for (const it of this.items) { const dx = it.pos.x - x, dz = it.pos.z - z, d = Math.hypot(dx, dz) + 0.1; if (d < R) { it.vel.x += dx / d * 5; it.vel.z += dz / d * 5; it.vel.y += 4; } }
  }

  // ---------------- Spawning
  _standable(x, y, z) { const w = this.world; return y > 0 && !w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z) && !w.isLiquid(x, y, z) && !w.isLiquid(x, y + 1, z) && w.isSolid(x, y - 1, z) && !w.isLiquid(x, y - 1, z); }
  _pickSpot(minD, maxD, mode) {
    const w = this.world, pp = this.playerPos(), a = Math.random() * TAU, d = rand(minD, maxD);
    const x = Math.floor(pp.x + Math.cos(a) * d), z = Math.floor(pp.z + Math.sin(a) * d);
    if (!this.chunkLoaded(x, z)) return null;
    if (mode === 'surface') { const y = w.heightAt(x, z); return y > 0 && this._standable(x, y, z) ? { x, y, z } : null; }
    const y0 = Math.floor(pp.y) + Math.floor(rand(-14, 10));
    for (let y = Math.min(y0, 126); y > Math.max(1, y0 - 20); y--) if (this._standable(x, y, z)) return { x, y, z };
    return null;
  }
  _level(x, y, z) {
    const w = this.world; const sky = (w.getSky?.(x, y, z) ?? 15) * (this.dim === 'overworld' ? dayFactor(this.timeOfDay) : 1);
    return Math.max(sky, w.getBlockLight?.(x, y, z) ?? 0);
  }
  tickSpawning(dt, dim, timeOfDay) {
    this._extSpawnAt = this._clock;
    if (dim) this.dim = dim; if (timeOfDay !== undefined) this.timeOfDay = timeOfDay;
    const w = this.world, pp = this.playerPos(); if (!w || !this.scene || !this.playerAlive()) return;
    this.boost = Math.max(0, this.boost - dt);
    this.spawnT -= dt; this.passiveT -= dt;
    const cnt = this.mobCounts(), df = dayFactor(this.timeOfDay);
    if (this.spawnT <= 0) {
      this.spawnT = this.boost > 0 ? 0.3 : 0.7;
      if (this.dim === 'overworld') {
        if (cnt.hostile < 20) for (let a = 0; a < 2; a++) {
          const surf = Math.random() < 0.5, s = this._pickSpot(surf ? 24 : 16, 46, surf ? 'surface' : 'cave'); if (!s) continue;
          if (this._level(s.x, s.y, s.z) > 7) continue;
          const below = w.getBlock(s.x, s.y - 1, s.z); if (below === B.LEAVES || below === B.CACTUS || below === B.ICE) continue;
          const r = Math.random(), t = r < 0.38 ? 'zombie' : r < 0.62 ? 'skeleton' : r < 0.82 ? 'creeper' : 'spider';
          this.spawnMob(t, s.x + 0.5, s.y, s.z + 0.5, { natural: true }); break;
        }
      } else if (this.dim === 'nether') {
        if (cnt.nether < 14) {
          const s = this._pickSpot(14, 44, 'cave');
          if (s) {
            const below = w.getBlock(s.x, s.y - 1, s.z);
            if (below === B.NETHERRACK || below === B.SOUL_SAND || below === B.NETHER_BRICK) {
              if (Math.random() < 0.15 && this.mobs.filter((m) => m.type === 'blaze' && !m.persist).length < 3) this.spawnMob('blaze', s.x + 0.5, s.y + 1, s.z + 0.5, { natural: true });
              else { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) { const y = this._columnY(s.x + Math.floor(rand(-2, 3)), s.y, s.z + Math.floor(rand(-2, 3))); if (y !== null) this.spawnMob('pigman', s.x + 0.5 + rand(-2, 2), y, s.z + 0.5 + rand(-2, 2), { natural: true }); } }
            }
          }
        }
      } else if (this.dim === 'end') {
        if (cnt.ender < 6) { const s = this._pickSpot(16, 40, 'cave'); if (s && w.getBlock(s.x, s.y - 1, s.z) === B.END_STONE) this.spawnMob('enderman', s.x + 0.5, s.y, s.z + 0.5, { natural: true }); }
      }
    }
    if (this.dim === 'overworld' && this.passiveT <= 0) {
      this.passiveT = this.boost > 0 ? 0.5 : 4;
      if (cnt.passive < 15 && df > 0.7) {
        const s = this._pickSpot(8, 42, 'surface');
        if (s && w.getBlock(s.x, s.y - 1, s.z) === B.GRASS && (w.getSky?.(s.x, s.y, s.z) ?? 15) >= 9) {
          const t = ['pig', 'cow', 'sheep', 'chicken'][Math.floor(Math.random() * 4)], n = t === 'chicken' ? 3 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) { const x = s.x + Math.floor(rand(-3, 4)), z = s.z + Math.floor(rand(-3, 4)), y = this._columnY(x, s.y, z); if (y !== null && w.getBlock(x, y - 1, z) === B.GRASS) this.spawnMob(t, x + 0.5, y, z + 0.5, { natural: true }); }
        }
      }
    }
  }
  _columnY(x, y0, z) { for (let y = y0 + 3; y >= y0 - 4; y--) if (this._standable(x, y, z)) return y; return null; }

  // ---------------- Dimension
  setDimension(dim) {
    this.dim = dim; this._lastDim = dim;
    for (const m of [...this.mobs]) { m.dispose?.(); } this.mobs.length = 0; this.crystals.length = 0; this.dragon = null;
    for (const e of [...this.items]) { this.scene?.remove(e.mesh); e.mat.forEach((m) => m.dispose()); } this.items.length = 0;
    for (const p of [...this.projectiles]) this._removeProj(p);
    for (const t of [...this.tnts]) { this.scene?.remove(t.mesh); } this.tnts.length = 0; this.pending.length = 0; this._pendingCrystals = [];
    this.boost = 8; this.spawnT = 0; this.passiveT = 0;
    this.game.ui?.setBossBar?.(null);
    if (dim === 'end') {
      const go = () => {
        if (this.dim !== 'end') return;
        this._pendingCrystals = (this._pillars || endPillarsFallback()).map((p) => ({ ...p }));
        if (!this.dragon) this.spawnMob('dragon', 0, 80, 40);
      };
      if (this._pillars) go(); else this._worldMod.then(go);
    }
  }
  _processPendingCrystals() {
    if (!this._pendingCrystals.length) return;
    const w = this.world; let budget = 1;
    for (let i = this._pendingCrystals.length - 1; i >= 0 && budget > 0; i--) {
      const p = this._pendingCrystals[i], cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16);
      if (w.getChunk && !w.getChunk(cx, cz)) { if (w.ensureChunk) { try { w.ensureChunk(cx, cz); } catch (e) { /* ignore */ } budget--; } else continue; }
      let y = w.heightAt?.(p.x, p.z);
      if (!y || y < 20) y = (p.y ?? 0) + (p.h ?? 1) + 1;
      this._pendingCrystals.splice(i, 1);
      this.spawnMob('crystal', p.x + 0.5, y, p.z + 0.5);
    }
  }

  // ---------------- Update
  update(dt) {
    dt = Math.min(dt, 0.1); this._clock += dt;
    const g = this.game; if (!g.world || !g.renderer) return;
    if (g.time !== undefined) this.timeOfDay = g.time;
    const gd = g.dimension || 'overworld';
    if (this._lastDim !== gd) this.setDimension(gd);
    if (this._clock - this._extSpawnAt > 2) this.tickSpawning(dt, gd, this.timeOfDay);
    this._processPendingCrystals();
    try { this._updateItems(dt); } catch (e) { this._err(e); }
    for (let i = this.mobs.length - 1; i >= 0; i--) { const m = this.mobs[i]; if (!m) continue; try { m.update(dt); } catch (e) { this._err(e); } }
    // Mob-Trennung
    const ms = this.mobs, n = ms.length;
    for (let i = 0; i < n; i++) {
      const a = ms[i]; if (a.dead || a.flying || a.def.kind === 'boss') continue;
      for (let j = i + 1; j < n; j++) {
        const b = ms[j]; if (b.dead || b.flying) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, min = (a.def.w + b.def.w) * 0.45;
        if (Math.abs(dx) < min && Math.abs(dz) < min && Math.abs(a.pos.y - b.pos.y) < 1.5) { const d = Math.hypot(dx, dz) || 0.01; if (d < min) { const k = (min - d) * 6 * dt / d; a.vel.x -= dx * k * 5; a.vel.z -= dz * k * 5; b.vel.x += dx * k * 5; b.vel.z += dz * k * 5; } }
      }
    }
    try { this._updateProjectiles(dt); } catch (e) { this._err(e); }
    try { this._updateTnts(dt); } catch (e) { this._err(e); }
    for (let i = this.pending.length - 1; i >= 0; i--) { const p = this.pending[i]; p.t -= dt; if (p.t <= 0) { this.pending.splice(i, 1); if (p.tnt) this.primeTnt(p.x, p.y, p.z, rand(0.3, 0.9), { x: rand(-2, 2), y: rand(3, 6), z: rand(-2, 2) }); } }
    if (!this.dragon) { /* Boss-Leiste wird vom Drachen selbst gesetzt */ }
  }
  _err(e) { if (!this._errLogged) { this._errLogged = true; console.error('[entities]', e); } }
  clear() { this.setDimension(this.dim); }
}

export { MOB_DEFS, normalizeMobType };
export default EntityManager;
