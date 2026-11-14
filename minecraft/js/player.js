// player.js — vanilla style player physics (20 Hz fixed tick), survival stats, damage.
import * as THREE from 'three';
import { B, BLOCKS, getItem } from './registry.js';

const SOLID = new Uint8Array(256);
for (let i = 0; i < 256; i++) SOLID[i] = BLOCKS[i]?.solid ? 1 : 0;

export const HW = 0.3;          // half width
export const PLAYER_H = 1.8;
const EPS = 1e-7;

export class Player {
  constructor(game) {
    this.game = game;
    this.world = null;
    this.pos = new THREE.Vector3(0, 80, 0);   // feet position
    this.prev = new THREE.Vector3(0, 80, 0);  // position at previous tick (render interpolation)
    this.v = new THREE.Vector3();             // blocks / tick (internal)
    const vv = this.v;                        // public `vel` is exposed in blocks / SECOND (m/s) for other modules
    this.vel = { get x() { return vv.x * 20; }, set x(a) { vv.x = a / 20; }, get y() { return vv.y * 20; }, set y(a) { vv.y = a / 20; },
      get z() { return vv.z * 20; }, set z(a) { vv.z = a / 20; }, set(x, y, z) { vv.set(x / 20, y / 20, z / 20); return this; } };
    this.yaw = 0;                             // 0 = looking toward -z
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false; this.inLava = false; this.headInWater = false;
    this.hCollide = false;
    this.eyeH = 1.62; this.prevEyeH = 1.62;
    this.fallDistance = 0;
    this.jumpDelay = 0;
    this.stepDist = 0;
    this.walkDist = 0;       // for held item bobbing
    this.moveAmount = 0;     // 0..1 horizontal speed factor for bob
    // stats
    this.maxHealth = 20;
    this.health = 20;
    this.hunger = 20; this.saturation = 5; this.exhaustion = 0; this.foodTick = 0;
    this.maxAir = 300; this.air = 300;
    this.fireTicks = 0;
    this.hurtCooldown = 0; this.lastHurt = 0; this.hurtFlash = 0;
    this.dead = false;
    this.xpTotal = 0; this.xpLevel = 0; this.xpProgress = 0; this.score = 0;
    this._burnTick = 0; this._lavaTick = 0; this._drownTick = 0;
    this.onDeath = null;
    this.tickCount = 0;
    this._box = { hit: false };
    this._wasInWater = false;
  }

  // ------------------------------------------------------------ aliases for other modules
  get food() { return this.hunger; } set food(v) { this.hunger = v; }
  get foodLevel() { return this.hunger; }
  get level() { return this.xpLevel; }
  get xp() { return this.xpTotal; } set xp(v) { if (v > this.xpTotal) this.addXp(v - this.xpTotal); }
  get position() { return this.pos; }
  get isDead() { return this.dead; }
  get creative() { return this.game.gamemode === 'creative'; }
  eyeY(alpha = 1) { return this.prev.y + (this.pos.y - this.prev.y) * alpha + this.prevEyeH + (this.eyeH - this.prevEyeH) * alpha; }
  /** interpolated eye position written into target */
  getEye(target, alpha = 1) {
    target.set(this.prev.x + (this.pos.x - this.prev.x) * alpha, this.eyeY(alpha), this.prev.z + (this.pos.z - this.prev.z) * alpha);
    return target;
  }
  get eye() { return this.getEye(this._eyeTmp || (this._eyeTmp = new THREE.Vector3()), 1); }
  // look direction (unit)
  getDir(t) {
    const cp = Math.cos(this.pitch);
    return t.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  get aabb() { return { minX: this.pos.x - HW, minY: this.pos.y, minZ: this.pos.z - HW, maxX: this.pos.x + HW, maxY: this.pos.y + PLAYER_H, maxZ: this.pos.z + HW }; }

  setWorld(w) { this.world = w; }
  teleport(x, y, z) {
    this.pos.set(x, y, z); this.prev.copy(this.pos); this.v.set(0, 0, 0);
    this.fallDistance = 0; this.onGround = false;
  }

  // ------------------------------------------------------------ world queries
  blk(x, y, z) { return this.world.getBlock(x, y, z); }
  _overlapsSolid(x0, y0, z0, x1, y1, z1) {
    const w = this.world;
    const ix0 = Math.floor(x0 + EPS), ix1 = Math.floor(x1 - EPS);
    const iy0 = Math.floor(y0 + EPS), iy1 = Math.floor(y1 - EPS);
    const iz0 = Math.floor(z0 + EPS), iz1 = Math.floor(z1 - EPS);
    for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) for (let z = iz0; z <= iz1; z++) {
      if (SOLID[w.getBlock(x, y, z)]) return true;
    }
    return false;
  }
  /** true if the player's box at the given feet position intersects a solid block */
  collidesAt(x, y, z) { return this._overlapsSolid(x - HW, y, z - HW, x + HW, y + PLAYER_H, z + HW); }

  // sweep one axis; returns the allowed displacement
  _clip(axis, d) {
    if (d === 0) return 0;
    const w = this.world, p = this.pos;
    const x0 = p.x - HW, x1 = p.x + HW, y0 = p.y, y1 = p.y + PLAYER_H, z0 = p.z - HW, z1 = p.z + HW;
    let ax0 = Math.floor(x0 + EPS), ax1 = Math.floor(x1 - EPS);
    let ay0 = Math.floor(y0 + EPS), ay1 = Math.floor(y1 - EPS);
    let az0 = Math.floor(z0 + EPS), az1 = Math.floor(z1 - EPS);
    if (axis === 0) { if (d > 0) { ax0 = Math.ceil(x1 - EPS); ax1 = Math.floor(x1 + d); } else { ax0 = Math.floor(x0 + d); ax1 = Math.ceil(x0 + EPS) - 1; } }
    else if (axis === 1) { if (d > 0) { ay0 = Math.ceil(y1 - EPS); ay1 = Math.floor(y1 + d); } else { ay0 = Math.floor(y0 + d); ay1 = Math.ceil(y0 + EPS) - 1; } }
    else { if (d > 0) { az0 = Math.ceil(z1 - EPS); az1 = Math.floor(z1 + d); } else { az0 = Math.floor(z0 + d); az1 = Math.ceil(z0 + EPS) - 1; } }
    for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) for (let z = az0; z <= az1; z++) {
      if (!SOLID[w.getBlock(x, y, z)]) continue;
      if (axis === 0) { if (d > 0) { const c = x - x1; if (c < d) d = c < 0 ? 0 : c; } else { const c = x + 1 - x0; if (c > d) d = c > 0 ? 0 : c; } }
      else if (axis === 1) { if (d > 0) { const c = y - y1; if (c < d) d = c < 0 ? 0 : c; } else { const c = y + 1 - y0; if (c > d) d = c > 0 ? 0 : c; } }
      else { if (d > 0) { const c = z - z1; if (c < d) d = c < 0 ? 0 : c; } else { const c = z + 1 - z0; if (c > d) d = c > 0 ? 0 : c; } }
    }
    return d;
  }

  _move(dx, dy, dz) {
    const p = this.pos;
    // sneaking: do not walk off edges (vanilla algorithm)
    if (this.sneaking && this.onGround && !this.flying) {
      const inc = 0.05;
      while (dx !== 0 && !this._overlapsSolid(p.x + dx - HW, p.y - 0.6, p.z - HW, p.x + dx + HW, p.y - 0.6 + PLAYER_H, p.z + HW)) {
        if (dx < inc && dx >= -inc) dx = 0; else if (dx > 0) dx -= inc; else dx += inc;
      }
      while (dz !== 0 && !this._overlapsSolid(p.x - HW, p.y - 0.6, p.z + dz - HW, p.x + HW, p.y - 0.6 + PLAYER_H, p.z + dz + HW)) {
        if (dz < inc && dz >= -inc) dz = 0; else if (dz > 0) dz -= inc; else dz += inc;
      }
      while (dx !== 0 && dz !== 0 && !this._overlapsSolid(p.x + dx - HW, p.y - 0.6, p.z + dz - HW, p.x + dx + HW, p.y - 0.6 + PLAYER_H, p.z + dz + HW)) {
        if (dx < inc && dx >= -inc) dx = 0; else if (dx > 0) dx -= inc; else dx += inc;
        if (dz < inc && dz >= -inc) dz = 0; else if (dz > 0) dz -= inc; else dz += inc;
      }
    }
    const oy = dy, ox = dx, oz = dz;
    dy = this._clip(1, dy); p.y += dy;
    dx = this._clip(0, dx); p.x += dx;
    dz = this._clip(2, dz); p.z += dz;
    this.onGround = oy < 0 && dy !== oy;
    this.hCollide = dx !== ox || dz !== oz;
    if (dy !== oy) this.v.y = 0;
    if (dx !== ox) this.v.x = 0;
    if (dz !== oz) this.v.z = 0;
    return dy;
  }

  // ------------------------------------------------------------ tick
  /**
   * inp: {forward, back, left, right, jump, sneak, sprint}  (booleans)
   * Called at 20 Hz.
   */
  tick(inp) {
    const w = this.world; if (!w) return;
    const g = this.game;
    const creative = g.gamemode === 'creative';
    this.prev.copy(this.pos);
    this.prevEyeH = this.eyeH;
    if (!w.getChunk(Math.floor(this.pos.x / 16) | 0, Math.floor(this.pos.z / 16) | 0)) { // wait for chunk to exist
      w.ensureChunk(Math.floor(this.pos.x / 16), Math.floor(this.pos.z / 16));
      return;
    }
    this.tickCount++;
    const p = this.pos, v = this.v;

    // ---- liquid / environment state
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const fy = Math.floor(p.y + 0.02);
    const feet = w.getBlock(bx, fy, bz), mid = w.getBlock(bx, Math.floor(p.y + 0.9), bz);
    this.inWater = feet === B.WATER || mid === B.WATER;
    this.inLava = feet === B.LAVA || mid === B.LAVA;
    const eyeBlockY = Math.floor(p.y + this.eyeH);
    this.headInWater = w.getBlock(bx, eyeBlockY, bz) === B.WATER && (p.y + this.eyeH) < eyeBlockY + 0.875 + 0.01;
    if (this.inWater && !this._wasInWater) { g.audio?.splash(); g.renderer?.addParticles?.('splash', p.x, p.y + 0.5, p.z, 0, 8); }
    this._wasInWater = this.inWater;
    if (creative && this.flying === false && false) this.flying = false;
    if (!creative) this.flying = false;

    // ---- sneaking / sprinting
    this.sneaking = !!inp.sneak && !this.flying;
    let fwd = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
    let str = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    const hasInput = fwd !== 0 || str !== 0;
    if (!inp.forward || this.sneaking || this.hunger <= 6 && !creative && false) this.sprinting = false;
    if (inp.sprint && inp.forward && !this.sneaking && (this.hunger > 6 || creative)) this.sprinting = true;
    if (this.hCollide && !this.flying) this.sprinting = false;
    if (this.hunger <= 6 && !creative) this.sprinting = false;
    if (this.inWater && !this.headInWater && false) this.sprinting = false;
    if (!hasInput) this.sprinting = false;

    // eye height (smooth sneak)
    const eyeTarget = this.sneaking ? 1.54 : 1.62;
    this.eyeH += (eyeTarget - this.eyeH) * 0.5;
    if (Math.abs(eyeTarget - this.eyeH) < 0.005) this.eyeH = eyeTarget;

    // ---- input vector
    const mul = this.sneaking ? 0.3 : 1;
    str *= 0.98 * mul; fwd *= 0.98 * mul;
    let dist = Math.sqrt(str * str + fwd * fwd);
    if (dist < 0.01) { str = 0; fwd = 0; } else { dist = 1 / Math.max(dist, 1); str *= dist; fwd *= dist; }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const dirX = fwd * -sy + str * -cy;
    const dirZ = fwd * -cy + str * sy;

    if (this.jumpDelay > 0) this.jumpDelay--;
    const x0 = p.x, z0 = p.z;

    if (this.flying) {
      const sp = (inp.sprint ? 2 : 1) * 0.5445;
      const mulF = this.sneaking ? 1 : 1;
      let ty = 0; if (inp.jump) ty += 0.375 * (inp.sprint ? 1.6 : 1); if (inp.sneak) ty -= 0.375 * (inp.sprint ? 1.6 : 1);
      const hl = Math.hypot(dirX, dirZ) > 1e-4 ? 1 / Math.max(1, Math.hypot(dirX, dirZ)) : 0;
      v.x += (dirX * hl * sp * mulF - v.x) * 0.35;
      v.z += (dirZ * hl * sp * mulF - v.z) * 0.35;
      v.y += (ty - v.y) * 0.35;
      this._move(v.x, v.y, v.z);
      if (this.onGround && v.y <= 0 && !inp.jump) { this.flying = false; }
      this.fallDistance = 0;
    } else if (this.inWater || this.inLava) {
      const lava = this.inLava && !this.inWater;
      if (inp.jump) v.y += 0.04;
      v.x += dirX * 0.02; v.z += dirZ * 0.02;
      this._move(v.x, v.y, v.z);
      const drag = lava ? 0.5 : 0.8;
      v.x *= drag; v.y *= drag; v.z *= drag;
      v.y -= 0.02;
      if (this.hCollide && !this.collidesAt(p.x + v.x, p.y + v.y + 0.6 - 0.02, p.z + v.z)) v.y = 0.3;
      this.fallDistance = 0;
    } else {
      // ground / air
      let slip = 0.91;
      if (this.onGround) slip = (w.getBlock(bx, Math.floor(p.y - 0.5), bz) === B.ICE ? 0.98 : 0.6) * 0.91;
      const accel = this.onGround ? 0.1 * (this.sprinting ? 1.3 : 1) * 0.16277136 / (slip * slip * slip) : (this.sprinting ? 0.026 : 0.02);
      if (inp.jump && this.onGround && this.jumpDelay === 0) {
        v.y = 0.42; this.jumpDelay = 10;
        if (this.sprinting) { v.x += -sy * 0.2; v.z += -cy * 0.2; }
        this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      }
      v.x += dirX * accel; v.z += dirZ * accel;
      const wasGround = this.onGround;
      const dy = this._move(v.x, v.y, v.z);
      // fall tracking
      if (dy < 0 && !this.onGround) this.fallDistance -= dy;
      else if (dy < 0 && this.onGround) {
        const fd = this.fallDistance - dy;
        this._land(fd);
      }
      v.y -= 0.08; v.y *= 0.98;
      v.x *= slip; v.z *= slip;
      if (this.onGround) this.fallDistance = 0;
      void wasGround;
    }

    // ---- movement stats / footsteps
    const mdx = p.x - x0, mdz = p.z - z0;
    const hd = Math.sqrt(mdx * mdx + mdz * mdz);
    this.moveAmount += ((hd > 0.01 ? Math.min(1, hd / 0.22) : 0) - this.moveAmount) * 0.4;
    if (this.onGround && !this.flying) { this.walkDist += hd; this.stepDist += hd; } else if (this.inWater) this.walkDist += hd * 0.6;
    if (hd > 0 && !this.flying) this.addExhaustion((this.inWater ? 0.015 : this.sprinting ? 0.1 : 0) * hd);
    if (this.stepDist > (this.sprinting ? 2.2 : 1.7) && this.onGround && !this.sneaking) {
      this.stepDist = 0;
      g.audio?.step(w.getBlock(bx, Math.floor(p.y - 0.5), bz));
    }

    // ---- damage sources, survival rules
    if (this.hurtCooldown > 0) this.hurtCooldown--;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - 0.08);
    if (p.y < -64) { this.hurt(4, { type: 'void', ignoreInvuln: true }); }
    if (!creative) this._survivalTick(feet, mid, bx, bz);
    else { this.fireTicks = 0; this.air = this.maxAir; this.saturation = 5; this.hunger = 20; }
    if (!creative && this.inLava) { /* handled in survivalTick */ }
    if (this.fireTicks > 0) { if (this.inWater) this.fireTicks = 0; }
  }

  _land(fd) {
    const g = this.game;
    this.fallDistance = 0;
    if (this.creative) return;
    if (fd > 3) {
      const dmg = Math.ceil(fd - 3);
      this.hurt(dmg, { type: 'fall', ignoreInvuln: true });
    }
    if (fd > 0.8) g.audio?.step(this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z)));
  }

  _survivalTick(feet, mid, bx, bz) {
    const w = this.world, p = this.pos;
    // drowning
    if (this.headInWater) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, { type: 'drown', ignoreInvuln: true }); }
    } else if (this.air < this.maxAir) this.air = Math.min(this.maxAir, this.air + 4);
    // lava
    if (this.inLava) {
      this.fireTicks = 300;
      if (++this._lavaTick >= 10) { this._lavaTick = 0; this.hurt(4, { type: 'lava', ignoreInvuln: true }); }
    } else this._lavaTick = 9;
    // fire block contact
    if (feet === B.FIRE || mid === B.FIRE) { if (this.fireTicks < 160) this.fireTicks = 160; }
    // burning
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.fireTicks % 20 === 0) this.hurt(1, { type: 'fire', ignoreInvuln: true });
      if (this.fireTicks % 4 === 0) this.game.renderer?.addParticles?.('flame', p.x, p.y + 0.8, p.z, 0, 1);
    }
    // cactus
    if (this.tickCount % 10 === 0) {
      const y0 = Math.floor(p.y), r = HW + 0.06;
      for (let k = 0; k < 4; k++) {
        const cx = Math.floor(p.x + (k & 1 ? r : -r)), cz = Math.floor(p.z + (k & 2 ? r : -r));
        if (w.getBlock(cx, y0, cz) === B.CACTUS || w.getBlock(cx, y0 + 1, cz) === B.CACTUS) { this.hurt(1, { type: 'cactus', ignoreInvuln: true }); break; }
      }
    }
    // hunger
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    if (this.hunger >= 18 && this.health < this.maxHealth && this.health > 0) {
      if (this.hunger >= 20 && this.saturation > 0) {
        if (++this.foodTick >= 10) { this.foodTick = 0; const a = Math.min(this.saturation / 6, 1); this.health = Math.min(this.maxHealth, this.health + a); this.addExhaustion(a * 6 > 0 ? Math.min(6, this.saturation) : 0); }
      } else if (++this.foodTick >= 80) { this.foodTick = 0; this.health = Math.min(this.maxHealth, this.health + 1); this.addExhaustion(6); }
    } else if (this.hunger <= 0) {
      if (++this.foodTick >= 80) { this.foodTick = 0; this.hurt(1, { type: 'starve', ignoreInvuln: true }); }
    } else this.foodTick = 0;
  }

  addExhaustion(a) { if (!this.creative) this.exhaustion += a; }

  // ------------------------------------------------------------ damage
  /**
   * hurt(amount, {type:'mob'|'fall'|'fire'|..., from:{x,z}, knockback:number, ignoreArmor, ignoreInvuln})
   * Returns true if damage was applied.
   */
  hurt(amount, o = {}) {
    if (this.dead || amount <= 0) return false;
    const creative = this.creative;
    if (creative && o.type !== 'void' && o.type !== 'kill') return false;
    if (this.hurtCooldown > 0 && !o.ignoreInvuln && o.type !== 'void') {
      if (amount <= this.lastHurt) return false;
    }
    const type = o.type || 'mob';
    if (!o.ignoreArmor && type !== 'fall' && type !== 'drown' && type !== 'starve' && type !== 'void' && type !== 'kill') {
      const ap = this.game.inventory?.armorPoints?.() || 0;
      amount = amount * (25 - Math.min(20, ap)) / 25;
      this._damageArmor(Math.max(1, Math.floor(amount / 4)));
    }
    if (amount <= 0) return false;
    this.health -= amount;
    this.hurtCooldown = 10; this.lastHurt = amount; this.hurtFlash = 1;
    this.game.audio?.hurt();
    if (o.from) this.knockbackFrom(o.from.x, o.from.z, o.knockback == null ? 1 : o.knockback);
    if (this.health <= 0) { this.health = 0; this.die(o); }
    return true;
  }
  knockbackFrom(fx, fz, strength = 1) {
    let dx = this.pos.x - fx, dz = this.pos.z - fz;
    let l = Math.hypot(dx, dz);
    if (l < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; l = Math.hypot(dx, dz) || 1; }
    this.v.x = this.v.x / 2 + dx / l * 0.4 * strength;
    this.v.z = this.v.z / 2 + dz / l * 0.4 * strength;
    this.v.y = Math.min(0.4, this.v.y / 2 + 0.4);
    this.onGround = false;
  }
  addVelocity(x, y, z) { this.v.x += x / 20; this.v.y += y / 20; this.v.z += z / 20; this.onGround = false; }
  _damageArmor(n) {
    const inv = this.game.inventory; if (!inv) return;
    for (let i = 36; i < 40; i++) {
      const s = inv.slots[i]; if (!s) continue;
      s.damage = (s.damage || 0) + n;
      const dur = getItem(s.id)?.durability || 0;
      if (dur && s.damage >= dur) inv.slots[i] = null;
    }
  }
  // aliases used by other modules
  damage(amount, o) { if (o && o.x !== undefined && o.from === undefined && typeof o !== 'string') o = { from: o }; return this.hurt(amount, typeof o === 'object' ? o : {}); }
  takeDamage(a, o) { return this.damage(a, o); }
  attackedBy(a, o) { return this.damage(a, o); }

  heal(a) { this.health = Math.min(this.maxHealth, this.health + a); }
  setFire(sec) { this.setOnFire(sec); }
  addXP(n) { this.addXp(n); }
  setOnFire(sec) { if (!this.creative && this.fireTicks < sec * 20) this.fireTicks = sec * 20; }

  die(o = {}) {
    if (this.dead) return;
    this.dead = true; this.flying = false;
    this.game.audio?.death();
    this.onDeath?.(o);
  }

  respawn(x, y, z) {
    this.dead = false;
    this.health = this.maxHealth; this.hunger = 20; this.saturation = 5; this.exhaustion = 0;
    this.air = this.maxAir; this.fireTicks = 0; this.hurtCooldown = 20; this.hurtFlash = 0;
    this.xpTotal = 0; this.xpLevel = 0; this.xpProgress = 0;
    this.sprinting = false; this.flying = false;
    this.teleport(x, y, z);
  }

  // ------------------------------------------------------------ xp (simplified vanilla)
  static xpForLevel(l) { return l <= 15 ? 2 * l + 7 : l <= 30 ? 5 * l - 38 : 9 * l - 158; }
  addXp(n) {
    if (!(n > 0)) return;
    this.xpTotal += n; this.score += n;
    let prog = this.xpProgress * Player.xpForLevel(this.xpLevel) + n;
    const before = this.xpLevel;
    for (;;) {
      const need = Player.xpForLevel(this.xpLevel);
      if (prog >= need) { prog -= need; this.xpLevel++; } else break;
    }
    this.xpProgress = prog / Player.xpForLevel(this.xpLevel);
    if (this.xpLevel > before) this.game.audio?.levelup();
    else this.game.audio?.pickup();
  }
  addExperience(n) { this.addXp(n); }
}
export default Player;
