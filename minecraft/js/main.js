// main.js — game loop, input, block interaction, dimensions; wires all modules together.
import * as THREE from 'three';
import { B, I, BLOCKS, ITEMS, getItem, breakTime, canHarvest } from './registry.js';
import { Player, PLAYER_H, HW } from './player.js';
import { GameAudio } from './audio.js';
import { runCommand } from './commands.js';

const params = new URLSearchParams(location.search);
const MODS = {};
async function loadMods() {
  for (const n of ['textures', 'world', 'render', 'inventory', 'ui', 'entities']) {
    try { MODS[n] = await import(`./${n}.js`); } catch (e) { console.error('[main] failed to load module ' + n, e); MODS[n] = null; }
  }
}

// ------------------------------------------------------------------ state
const game = {
  world: null, renderer: null, entities: null, ui: null, player: null, inventory: null,
  settings: { renderDistance: 6, fov: 70, sensitivity: 1.0, volume: 0.5 },
  dimension: 'overworld', time: 1000, gamemode: 'survival', textures: null, audio: null,
  seed: 0, spawn: { x: 0, y: 80, z: 0 }, stronghold: null, worlds: {},
  started: false, paused: false, dead: false, consoleOpen: false, showDebug: false,
  input: { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false },
  mouse: { left: false, right: false },
  say: null, setDimension: null, onDragonDead: null,
};
window.__mc = game;
window.__THREE = THREE;

const rootEl = () => document.getElementById('ui');
const canvas = document.getElementById('game') || (() => { const c = document.createElement('canvas'); c.id = 'game'; document.body.prepend(c); return c; })();

const tmpEye = new THREE.Vector3(), tmpDir = new THREE.Vector3(), camPos = new THREE.Vector3();
const camProxy = { pos: camPos, yaw: 0, pitch: 0 };
let locked = false, noLock = params.get('nolock') === '1' || !canvas.requestPointerLock;
let acc = 0, alpha = 0, lastT = 0, fps = 60, fpsAcc = 0, fpsN = 0;
let texAcc = 0, spawnAcc = 0, furnAcc = 0;
let wasUiOpen = false;
let portalTime = 0, portalLock = false, portalOverlay = null;
let lastSpaceTap = -1, lastWTap = -1, sprintLatch = false, ctrlHeld = false;
let hitBlock = null, hitEntity = null, hitEntityDist = 0, lastSel = '';
const brk = { x: 0, y: 0, z: 0, id: 0, progress: 0, active: false, cd: 0, sndT: 0, stage: -1 };
let attackCd = 0, placeCd = 0, swing = 0, swingActive = false;
const use = { type: null, t: 0, eatSnd: 0, slot: -1 };
const projectiles = []; // ender pearls & eyes
const fuses = [];       // lit TNT
const fuseKeys = new Set();
let noTnt = 0;

const REPLACEABLE = new Set([B.TALL_GRASS, B.FIRE, B.WATER, B.LAVA]);
const NOSUPPORT_ABOVE = new Set([B.TORCH, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.FIRE, B.CACTUS]);
const SOLID = new Uint8Array(256); for (let i = 0; i < 256; i++) SOLID[i] = BLOCKS[i]?.solid ? 1 : 0;
const isCreative = () => game.gamemode === 'creative';

// ------------------------------------------------------------------ helpers
function say(text) {
  if (game.ui?.showChat) game.ui.showChat(text);
  else {
    let el = document.getElementById('mc-chat');
    if (!el) { el = document.createElement('div'); el.id = 'mc-chat'; el.style.cssText = 'position:fixed;left:8px;bottom:60px;color:#fff;font:16px monospace;text-shadow:1px 1px #000;z-index:50;pointer-events:none'; document.body.appendChild(el); }
    const d = document.createElement('div'); d.textContent = text; el.appendChild(d); setTimeout(() => d.remove(), 6000);
  }
  console.log('[chat]', text);
}
game.say = say;

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
const sel = () => game.inventory.getSelected();
const selDef = () => { const s = game.inventory.getSelected(); return s ? getItem(s.id) : null; };
const entPos = (e) => e.pos || e.position || e.mesh?.position || e;

function lockPointer() {
  if (noLock || locked) return;
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { noLock = true; });
  } catch (e) { noLock = true; }
}
function unlockPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* */ } }
const uiOpen = () => !!game.ui?.isOpen?.();
const canPlay = () => game.started && !game.paused && !game.dead && !game.consoleOpen && !uiOpen();
const canAct = () => canPlay() && (locked || noLock);

// ------------------------------------------------------------------ world / dimensions
function getWorld(dim) {
  if (!game.worlds[dim]) {
    const w = new MODS.world.World(game.seed, dim);
    game.worlds[dim] = w;
    w.onChange?.((x, y, z, oldId, newId) => {
      if (oldId === B.TNT && newId === 0 && !noTnt && w === game.world) igniteTnt(x, y, z, 0.4 + Math.random() * 0.9);
    });
  }
  return game.worlds[dim];
}

async function ensureAround(w, x, z, r, onProgress) {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  const list = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) list.push([dx, dz, dx * dx + dz * dz]);
  list.sort((a, b) => a[2] - b[2]);
  let last = performance.now();
  for (let i = 0; i < list.length; i++) {
    w.ensureChunk(cx + list[i][0], cz + list[i][1]);
    if (onProgress && performance.now() - last > 14) { onProgress((i + 1) / list.length); await nextFrame(); last = performance.now(); }
  }
  onProgress?.(1);
}
function ensureAroundSync(w, x, z, r) {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) w.ensureChunk(cx + dx, cz + dz);
}

function findSafeSpot(w, x, z, y0, y1, ascending) {
  for (let r = 0; r <= 24; r += 1) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const px = Math.floor(x) + dx, pz = Math.floor(z) + dz;
      const ys = [];
      if (ascending) for (let y = y0; y <= y1; y++) ys.push(y); else for (let y = y1; y >= y0; y--) ys.push(y);
      for (const y of ys) {
        const below = w.getBlock(px, y - 1, pz), a = w.getBlock(px, y, pz), b = w.getBlock(px, y + 1, pz);
        if (SOLID[below] && !BLOCKS[below].liquid && below !== B.CACTUS && !SOLID[a] && !SOLID[b] && !BLOCKS[a].liquid && !BLOCKS[b].liquid && a !== B.FIRE) return { x: px + 0.5, y, z: pz + 0.5 };
      }
    }
  }
  return null;
}
function buildPlatform(w, x, y, z, mat, hole = true) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    w.setBlock(x + dx, y - 1, z + dz, mat, 0, { silent: true });
    for (let dy = 0; dy < 3; dy++) w.setBlock(x + dx, y + dy, z + dz, 0, 0, { silent: true });
  }
  void hole;
}

function endSpawn(w) {
  ensureAroundSync(w, 0, -30, 2);
  let h = w.heightAt?.(0, -30) || 0;
  if (h > 20 && h < 120 && SOLID[w.getBlock(0, h - 1, -30)]) return { x: 0.5, y: h, z: -29.5 };
  const s = findSafeSpot(w, 0, -30, 40, 110, false);
  if (s) return s;
  buildPlatform(w, 0, 60, -30, B.OBSIDIAN);
  return { x: 0.5, y: 60, z: -29.5 };
}

function setDimension(dim, pos, opts = {}) {
  const prev = game.dimension;
  const w = getWorld(dim);
  let p = pos;
  if (!p) {
    if (dim === 'overworld') p = { ...game.spawn };
    else if (dim === 'end') { p = endSpawn(w); }
    else {
      ensureAroundSync(w, 0, 0, 2);
      p = findSafeSpot(w, 0, 0, 34, 110, true);
      if (!p) { buildPlatform(w, 0, 70, 0, B.NETHERRACK); p = { x: 0.5, y: 70, z: 0.5 }; }
    }
  } else {
    ensureAroundSync(w, p.x, p.z, 1);
    if (dim === 'end' && !opts.exact) { const s = endSpawn(w); p = s; }
  }
  game.dimension = dim; game.world = w;
  game.player.setWorld(w);
  game.renderer?.setWorld?.(w);
  game.entities?.setDimension?.(dim);
  game.player.teleport(p.x, p.y, p.z);
  clearProjectiles();
  fuses.length = 0; fuseKeys.clear();
  brk.active = false; brk.progress = 0; game.renderer?.setBreakProgress?.(null, 0); lastSel = '';
  game.audio?.teleport?.();
  if (prev !== dim) say('Entered the ' + (dim === 'overworld' ? 'Overworld' : dim === 'nether' ? 'Nether' : 'End'));
}
game.setDimension = setDimension;
game.teleportTo = (x, y, z) => {
  ensureAroundSync(game.world, x, z, 1);
  game.player.teleport(x, y, z);
};
game.setGamemode = (m) => {
  game.gamemode = m;
  game.player.flying = false;
  if (m === 'creative') { game.player.fireTicks = 0; }
};

function portalTravel(toDim) {
  const w0 = game.world, p = game.player.pos;
  const w = getWorld(toDim);
  const f = toDim === 'nether' ? 1 / 8 : 8;
  const tx = Math.floor(p.x * f), tz = Math.floor(p.z * f);
  let ty = Math.max(12, Math.min(110, Math.floor(p.y)));
  ensureAroundSync(w, tx, tz, 2);
  let dest = null;
  try { dest = MODS.world.findOrCreatePortal(w, tx, ty, tz); } catch (e) { console.error('findOrCreatePortal', e); }
  if (!dest) dest = { x: tx, y: ty, z: tz };
  void w0;
  setDimension(toDim, { x: dest.x + 0.5, y: dest.y, z: dest.z + 0.5 }, { exact: true });
  portalLock = true; portalTime = 0;
}
function endTravelToOverworld() {
  setDimension('overworld', { ...game.spawn });
  portalLock = true;
}

// ------------------------------------------------------------------ dragon / end
game.onDragonDead = () => {
  const w = game.worlds.end || game.world;
  say('The Ender Dragon has been defeated!');
  game.player.addXp(12000);
  let cnt = {};
  for (let y = 40; y < 100; y++) for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    if (w.getBlock(x, y, z) === B.BEDROCK_END_EXIT) cnt[y] = (cnt[y] || 0) + 1;
  }
  let L = null, best = 0;
  for (const k in cnt) if (cnt[k] > best) { best = cnt[k]; L = +k; }
  if (L === null) { // no fountain present: build a little one
    const h = w.heightAt?.(0, 0) || 64;
    L = h;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.hypot(x, z) <= 3.2 && Math.hypot(x, z) > 2.2) w.setBlock(x, L, z, B.BEDROCK_END_EXIT, 0);
    for (let y = 1; y <= 4; y++) w.setBlock(0, L + y - 1 + 0, 0, B.BEDROCK_END_EXIT, 0);
  }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (x * x + z * z <= 6.5 && w.getBlock(x, L, z) !== B.BEDROCK_END_EXIT) w.setBlock(x, L, z, B.END_PORTAL, 0);
  }
  let top = L; while (w.getBlock(0, top + 1, 0) === B.BEDROCK_END_EXIT) top++;
  if (w.getBlock(0, top, 0) !== B.BEDROCK_END_EXIT) top = L - 1;
  w.setBlock(0, top + 1, 0, B.DRAGON_EGG, 0);
};

// ------------------------------------------------------------------ explosions / TNT
function igniteTnt(x, y, z, t = 4) {
  const key = x + ',' + y + ',' + z;
  if (fuseKeys.has(key)) return;
  fuseKeys.add(key);
  fuses.push({ x, y, z, t });
  game.audio?.fuse();
}
function updateFuses(dt) {
  for (let i = fuses.length - 1; i >= 0; i--) {
    const f = fuses[i];
    f.t -= dt;
    if (((f.t * 6) | 0) !== (((f.t + dt) * 6) | 0)) game.renderer?.addParticles?.('smoke', f.x + 0.5, f.y + 1.1, f.z + 0.5, 0, 2);
    if (f.t <= 0) {
      fuses.splice(i, 1); fuseKeys.delete(f.x + ',' + f.y + ',' + f.z);
      noTnt++;
      if (game.world.getBlock(f.x, f.y, f.z) === B.TNT) game.world.setBlock(f.x, f.y, f.z, 0, 0);
      noTnt--;
      noTnt++;
      game.entities?.explode?.(f.x + 0.5, f.y + 0.5, f.z + 0.5, 4, { fire: false });
      noTnt--;
      game.audio?.explosion();
    }
  }
}

// ------------------------------------------------------------------ block breaking
function dropAt(id, count, x, y, z) {
  if (!id || count <= 0) return;
  const v = new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random(), (Math.random() - 0.5) * 2);
  game.entities?.addItem?.(id, count, x, y, z, v);
}

function breakBlock(x, y, z, byPlayer = true) {
  const w = game.world;
  const id = w.getBlock(x, y, z);
  if (!id) return false;
  const def = BLOCKS[id];
  if (!def || !def.breakable) return false;
  const meta = w.getMeta?.(x, y, z) || 0;
  const tool = selDef();
  const creative = isCreative();
  noTnt++;
  w.setBlock(x, y, z, 0, 0);
  noTnt--;
  game.renderer?.addParticles?.('break', x + 0.5, y + 0.5, z + 0.5, id, 14);
  game.audio?.breakBlock(id);
  // drops
  if (!creative && byPlayer !== 'nodrop' && canHarvest(id, tool)) {
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    if (id === B.GRAVEL) dropAt(Math.random() < 0.1 ? I.FLINT : B.GRAVEL, 1, cx, cy, cz);
    else if (id === B.LEAVES || id === B.LEAVES_BIRCH || id === B.LEAVES_SPRUCE) { if (Math.random() < 0.05) dropAt(I.APPLE, 1, cx, cy, cz); }
    else if (id === B.TALL_GRASS) { if (Math.random() < 0.125) dropAt(I.WHEAT_SEEDS, 1, cx, cy, cz); }
    else if (id === B.SNOW || id === B.ICE || id === B.GLASS) { /* nothing */ }
    else if (id === B.CHEST || id === B.FURNACE || id === B.FURNACE_LIT) {
      dropAt(def.drop, def.dropCount, cx, cy, cz);
      const items = game.ui?.removeContainer?.(x, y, z) || game.ui?.takeContents?.(x, y, z);
      if (Array.isArray(items)) for (const s of items) if (s) dropAt(s.id, s.count, cx, cy, cz);
    } else {
      let n = def.dropCount || 1;
      if (id === B.REDSTONE_ORE) n = 4 + (Math.random() * 2 | 0);
      if (id === B.GLOWSTONE) n = 2 + (Math.random() * 3 | 0);
      dropAt(def.drop, n, cx, cy, cz);
    }
  }
  if (!creative) {
    // xp for ores
    const xp = { [B.COAL_ORE]: 1, [B.DIAMOND_ORE]: 4, [B.REDSTONE_ORE]: 2, [B.QUARTZ_ORE]: 3 }[id];
    if (xp && canHarvest(id, tool)) game.player.addXp(xp);
    if (def.hardness > 0 && tool?.tool) {
      if (game.inventory.damageSelected(tool.tool.type === 'sword' ? 2 : 1)) game.audio?.breakBlock(B.PLANKS);
    }
    game.player.addExhaustion(0.025);
  }
  void meta;
  checkSupport(x, y, z);
  return true;
}

// remove blocks that lost their support after (x,y,z) changed
function checkSupport(x, y, z) {
  const w = game.world;
  const above = w.getBlock(x, y + 1, z);
  if (NOSUPPORT_ABOVE.has(above) && above !== B.FIRE) {
    const ok = SOLID[w.getBlock(x, y, z)];
    if (!ok) { w.setBlock(x, y + 1, z, 0, 0); if (above !== B.TALL_GRASS) dropAt(BLOCKS[above].drop, 1, x + 0.5, y + 1.5, z + 0.5); checkSupport(x, y + 1, z); }
  }
  const sides = [[1, 0, 1], [-1, 0, 2], [0, 1, 3], [0, -1, 4]]; // neighbor offset -> torch meta that attaches to us
  for (const [dx, dz, m] of [[1, 0, 2], [-1, 0, 1], [0, 1, 4], [0, -1, 3]]) {
    const nx = x + dx, nz = z + dz;
    if (w.getBlock(nx, y, nz) === B.TORCH && (w.getMeta(nx, y, nz) | 0) === m && !SOLID[w.getBlock(x, y, z)]) {
      w.setBlock(nx, y, nz, 0, 0); dropAt(B.TORCH, 1, nx + 0.5, y + 0.5, nz + 0.5);
    }
  }
  void sides;
  // fire without fuel is handled by world.tick
}

function updateBreaking(dt) {
  brk.cd = Math.max(0, brk.cd - dt);
  if (!canAct() || !game.mouse.left || !hitBlock || hitEntity) {
    if (brk.active) { brk.active = false; brk.progress = 0; brk.stage = -1; game.renderer?.setBreakProgress?.(null, 0); }
    return;
  }
  const h = hitBlock;
  if (!brk.active || brk.x !== h.x || brk.y !== h.y || brk.z !== h.z || brk.id !== h.id) {
    brk.active = true; brk.x = h.x; brk.y = h.y; brk.z = h.z; brk.id = h.id; brk.progress = 0; brk.stage = -1; brk.sndT = 0;
  }
  const def = BLOCKS[h.id];
  if (!def || !def.breakable) { return; }
  const t = isCreative() ? 0 : breakTime(h.id, selDef());
  if (brk.cd > 0) return;
  if (t === 0) {
    startSwing(); breakBlock(h.x, h.y, h.z); brk.cd = isCreative() ? 0.2 : 0.25; brk.active = false; brk.progress = 0;
    return;
  }
  brk.progress += dt / t;
  brk.sndT -= dt;
  if (brk.sndT <= 0) { brk.sndT = 0.25; game.audio?.dig(h.id); game.renderer?.addParticles?.('break', h.x + 0.5, h.y + 0.5, h.z + 0.5, h.id, 3); startSwing(); }
  const stage = Math.min(9, Math.floor(brk.progress * 10));
  if (stage !== brk.stage) { brk.stage = stage; game.renderer?.setBreakProgress?.(h, Math.min(1, brk.progress)); }
  if (brk.progress >= 1) {
    breakBlock(h.x, h.y, h.z);
    brk.active = false; brk.progress = 0; brk.stage = -1; brk.cd = 0.25;
    game.renderer?.setBreakProgress?.(null, 0);
  }
}

// ------------------------------------------------------------------ combat
function startSwing() { swing = 0; swingActive = true; }

function attackEntity() {
  const e = hitEntity; if (!e) return;
  const def = selDef(), p = game.player;
  let dmg = def?.tool?.damage ?? 1;
  const crit = !p.onGround && p.vel.y < 0 && !p.inWater && !p.flying && !p.sneaking;
  if (crit) dmg *= 1.5;
  const ep = entPos(e);
  let dx = ep.x - p.pos.x, dz = ep.z - p.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const kb = p.sprinting ? 1.8 : 1;
  game.entities.damageMob(e, dmg, new THREE.Vector3(dx * kb, 0.3, dz * kb));
  startSwing();
  if (crit) { game.audio?.crit(); game.renderer?.addParticles?.('explosion', ep.x, ep.y + 1, ep.z, 0, 4); } else game.audio?.hit();
  if (!isCreative()) {
    if (def?.tool) game.inventory.damageSelected(def.tool.type === 'sword' ? 1 : 2);
    p.addExhaustion(0.1);
  }
  if (p.sprinting) { p.sprinting = false; sprintLatch = false; }
  attackCd = 0.5;
}

// ------------------------------------------------------------------ right click: place / use
function playerOverlaps(px, py, pz) {
  const p = game.player.pos;
  return p.x + HW > px && p.x - HW < px + 1 && p.y + PLAYER_H > py && p.y < py + 1 && p.z + HW > pz && p.z - HW < pz + 1;
}

function consumeHeld() { if (!isCreative()) game.inventory.consumeSelected(1); }
function replaceHeld(id) {
  if (isCreative()) return;
  const s = sel(), inv = game.inventory;
  if (s && s.count > 1) { inv.consumeSelected(1); if (inv.add(id, 1)) dropAt(id, 1, game.player.pos.x, game.player.pos.y + 1, game.player.pos.z); }
  else inv.slots[inv.selected] = new MODS.inventory.ItemStack(id, 1);
}

function placeBlockItem(h, it) {
  const w = game.world, id = it.block, def = BLOCKS[id];
  let px = h.x + h.face[0], py = h.y + h.face[1], pz = h.z + h.face[2];
  if (REPLACEABLE.has(h.id) && !BLOCKS[h.id].liquid) { px = h.x; py = h.y; pz = h.z; }
  if (py < 0 || py >= 127) return false;
  const cur = w.getBlock(px, py, pz);
  if (cur !== 0 && !REPLACEABLE.has(cur)) return false;
  let meta = 0;
  if (def.solid && playerOverlaps(px, py, pz)) return false;
  if (id === B.TORCH) {
    if (h.face[1] === -1) return false;
    const sx = px - h.face[0], sy = py - h.face[1], sz = pz - h.face[2];
    if (!SOLID[w.getBlock(sx, sy, sz)] || !BLOCKS[w.getBlock(sx, sy, sz)].opaque && w.getBlock(sx, sy, sz) !== B.GLASS) { if (!SOLID[w.getBlock(sx, sy, sz)]) return false; }
    meta = h.face[1] === 1 ? 0 : h.face[0] === 1 ? 1 : h.face[0] === -1 ? 2 : h.face[2] === 1 ? 3 : 4;
  } else if (def.shape === 'cross') {
    const below = w.getBlock(px, py - 1, pz);
    if (below !== B.GRASS && below !== B.DIRT) return false;
  } else if (id === B.CACTUS) {
    const below = w.getBlock(px, py - 1, pz);
    if (below !== B.SAND && below !== B.CACTUS) return false;
  }
  w.setBlock(px, py, pz, id, meta);
  game.audio?.place(id);
  consumeHeld();
  startSwing();
  return true;
}

function useBucket(it, eye, dir) {
  const w = game.world;
  if (it.id === I.BUCKET) {
    const h = w.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, { liquids: true });
    if (!h || !BLOCKS[h.id]?.liquid) return false;
    const meta = w.getMeta?.(h.x, h.y, h.z) | 0;
    if (meta !== 0) return false; // only source blocks
    w.setBlock(h.x, h.y, h.z, 0, 0);
    replaceHeld(h.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET);
    game.audio?.bucket(); startSwing();
    return true;
  }
  // filled bucket
  const h = w.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, { liquids: false });
  if (!h) return false;
  const fluid = it.id === I.WATER_BUCKET ? B.WATER : B.LAVA;
  let px = h.x + h.face[0], py = h.y + h.face[1], pz = h.z + h.face[2];
  if (BLOCKS[h.id]?.shape === 'cross') { px = h.x; py = h.y; pz = h.z; }
  const cur = w.getBlock(px, py, pz);
  if (cur !== 0 && !REPLACEABLE.has(cur)) return false;
  if (fluid === B.WATER && game.dimension === 'nether') {
    game.renderer?.addParticles?.('smoke', px + 0.5, py + 0.5, pz + 0.5, 0, 8); game.audio?.fuse();
  } else {
    w.setBlock(px, py, pz, fluid, 0);
    game.audio?.bucket();
  }
  if (!isCreative()) game.inventory.slots[game.inventory.selected] = new MODS.inventory.ItemStack(I.BUCKET, 1);
  startSwing();
  return true;
}

function useFlint(h) {
  const w = game.world;
  if (h.id === B.TNT) { igniteTnt(h.x, h.y, h.z, 4); }
  else {
    const px = h.x + h.face[0], py = h.y + h.face[1], pz = h.z + h.face[2];
    if (w.getBlock(px, py, pz) !== 0) return false;
    if (h.id === B.OBSIDIAN || true) {
      w.setBlock(px, py, pz, B.FIRE, 0);
      if (h.id === B.OBSIDIAN || game.dimension !== 'end') {
        try { if (MODS.world.tryLightNetherPortal(w, px, py, pz)) { game.audio?.portal?.(); } } catch (e) { console.error(e); }
      }
    }
  }
  game.audio?.ignite();
  if (!isCreative()) game.inventory.damageSelected(1);
  startSwing();
  return true;
}

function newProjectile(kind) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  const mat = new THREE.MeshBasicMaterial({ color: kind === 'pearl' ? 0x1b6b5a : 0x7fe08a });
  const mesh = new THREE.Mesh(geo, mat);
  game.renderer?.scene?.add(mesh);
  return mesh;
}
function clearProjectiles() {
  for (const p of projectiles) { p.mesh.removeFromParent(); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
  projectiles.length = 0;
}

function throwPearl(eye, dir) {
  const pr = { kind: 'pearl', pos: eye.clone().addScaledVector(dir, 0.4), vel: dir.clone().multiplyScalar(1.5), mesh: newProjectile('pearl'), t: 0 };
  projectiles.push(pr);
  consumeHeld(); startSwing(); game.audio?.bow();
}
function throwEye(eye, dir) {
  const s = game.stronghold;
  if (game.dimension !== 'overworld' || !s) return false;
  let dx = s.x - eye.x, dz = s.z - eye.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const reach = Math.min(12, l);
  const pr = { kind: 'eye', pos: eye.clone(), start: eye.clone(), dx, dz, reach, mesh: newProjectile('eye'), t: 0 };
  projectiles.push(pr);
  consumeHeld(); startSwing(); game.audio?.bow();
  return true;
}
function updateProjectiles(dt) {
  const w = game.world, k = dt * 20;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.t += dt;
    if (pr.kind === 'eye') {
      const u = Math.min(1, pr.t / 1.4);
      pr.pos.x = pr.start.x + pr.dx * pr.reach * u;
      pr.pos.z = pr.start.z + pr.dz * pr.reach * u;
      pr.pos.y = pr.start.y + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 2.2;
      game.renderer?.addParticles?.('portal', pr.pos.x, pr.pos.y, pr.pos.z, 0, 1);
      pr.mesh.position.copy(pr.pos);
      if (u >= 1) {
        if (Math.random() < 0.2) { game.renderer?.addParticles?.('smoke', pr.pos.x, pr.pos.y, pr.pos.z, 0, 10); game.audio?.breakBlock(B.GLASS); }
        else dropAt(I.EYE_OF_ENDER, 1, pr.pos.x, pr.pos.y, pr.pos.z);
        removeProjectile(i);
      }
      continue;
    }
    // pearl: sub-stepped ballistic
    const steps = Math.max(1, Math.ceil(k * pr.vel.length() / 0.4));
    const sdt = k / steps;
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      const nx = pr.pos.x + pr.vel.x * sdt, ny = pr.pos.y + pr.vel.y * sdt, nz = pr.pos.z + pr.vel.z * sdt;
      if (SOLID[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))]) hit = true;
      else pr.pos.set(nx, ny, nz);
      pr.vel.multiplyScalar(Math.pow(0.99, sdt)); pr.vel.y -= 0.03 * sdt;
    }
    pr.mesh.position.copy(pr.pos);
    game.renderer?.addParticles?.('portal', pr.pos.x, pr.pos.y, pr.pos.z, 0, 1);
    if (hit || pr.pos.y < -20 || pr.t > 15) {
      if (hit) {
        const p = game.player;
        game.renderer?.addParticles?.('portal', pr.pos.x, pr.pos.y, pr.pos.z, 0, 24);
        // find free spot for feet
        let tx = pr.pos.x, ty = pr.pos.y, tz = pr.pos.z;
        for (let u = 0; u < 4 && p.collidesAt(tx, ty, tz); u++) ty += 1;
        if (!p.collidesAt(tx, ty, tz)) {
          p.teleport(tx, ty, tz);
          if (!isCreative()) p.hurt(5, { type: 'fall', ignoreInvuln: true });
          game.audio?.teleport();
        }
      }
      removeProjectile(i);
    }
  }
}
function removeProjectile(i) {
  const pr = projectiles[i]; pr.mesh.removeFromParent(); pr.mesh.geometry.dispose(); pr.mesh.material.dispose(); projectiles.splice(i, 1);
}

function fireBow(power) {
  const eye = game.player.getEye(tmpEye, 1), dir = game.player.getDir(tmpDir);
  const inv = game.inventory;
  const creative = isCreative();
  if (!creative && !inv.has(I.ARROW, 1)) return;
  if (!creative) inv.remove(I.ARROW, 1);
  const speed = power * 3.0; // blocks per tick
  const e = game.entities;
  if (e?.shootArrow) {
    try {
      e.shootArrow(eye.x, eye.y - 0.1, eye.z, dir.x, dir.y, dir.z, speed * 20, { owner: 'player', fromPlayer: true, damage: 2 + power * 7, power, crit: power >= 1 });
    } catch (err) { console.error('shootArrow', err); }
  }
  if (!creative) game.inventory.damageSelected(1);
  game.audio?.bow(); startSwing();
}

function rightClick(edge) {
  const w = game.world, p = game.player;
  const s = sel(), it = s ? getItem(s.id) : null;
  p.getEye(tmpEye, 1); p.getDir(tmpDir);
  const eye = tmpEye, dir = tmpDir;
  const h = hitBlock;
  // 1. interactive blocks
  if (edge && h && !p.sneaking) {
    const open = (fn, ...a) => { if (fn) { fn.apply(game.ui, a); unlockPointer(); return true; } return false; };
    if (h.id === B.CRAFTING_TABLE) { game.audio?.click(); if (open(game.ui?.openCrafting, { x: h.x, y: h.y, z: h.z })) return; }
    else if (h.id === B.FURNACE || h.id === B.FURNACE_LIT) { game.audio?.click(); if (open(game.ui?.openFurnace, { x: h.x, y: h.y, z: h.z })) return; }
    else if (h.id === B.CHEST) { game.audio?.click(); if (open(game.ui?.openChest, { x: h.x, y: h.y, z: h.z })) return; }
  }
  if (!it) return;
  // 2. items
  if (it.block) { if (h) { if (placeBlockItem(h, it)) placeCd = 0.25; } return; }
  if (!edge && it.id !== B.TORCH) return;
  if (it.id === I.BUCKET || it.id === I.WATER_BUCKET || it.id === I.LAVA_BUCKET) { if (edge) useBucket(it, eye, dir); return; }
  if (it.id === I.FLINT_AND_STEEL) { if (edge && h) useFlint(h); return; }
  if (it.id === I.EYE_OF_ENDER) {
    if (!edge) return;
    if (h && h.id === B.END_PORTAL_FRAME && !((w.getMeta(h.x, h.y, h.z) | 0) & 4)) {
      let ok = false; try { ok = MODS.world.tryInsertEye(w, h.x, h.y, h.z); } catch (e) { console.error(e); }
      if (ok) { consumeHeld(); startSwing(); game.audio?.place(B.OBSIDIAN); }
    } else throwEye(eye, dir);
    return;
  }
  if (it.id === I.ENDER_PEARL) { if (edge) throwPearl(eye, dir); return; }
  if (it.id === I.BOW) {
    if (edge && (isCreative() || game.inventory.has(I.ARROW, 1))) { use.type = 'bow'; use.t = 0; }
    return;
  }
  if (it.food && edge) {
    if (p.hunger < 20 || it.id === I.APPLE && false) { use.type = 'eat'; use.t = 0; use.eatSnd = 0; use.slot = game.inventory.selected; }
    return;
  }
}

function updateUse(dt) {
  if (!use.type) return;
  const p = game.player;
  if (!canAct() || !game.mouse.right) {
    if (use.type === 'bow' && use.t > 0.12 && canAct()) {
      let f = use.t; f = (f * f + 2 * f) / 3; if (f > 1) f = 1;
      if (f >= 0.1) fireBow(f);
    }
    use.type = null; use.t = 0; return;
  }
  const s = sel();
  if (use.type === 'eat') {
    if (!s || !getItem(s.id)?.food || game.inventory.selected !== use.slot) { use.type = null; return; }
    use.t += dt; use.eatSnd -= dt;
    if (use.eatSnd <= 0) { use.eatSnd = 0.25; game.audio?.eat(); game.renderer?.addParticles?.('break', p.pos.x - tmpDir.x * 0.0 + 0, p.pos.y + 1.3, p.pos.z, 0, 0); }
    if (use.t >= 1.6) {
      const f = getItem(s.id).food;
      p.hunger = Math.min(20, p.hunger + f.hunger);
      p.saturation = Math.min(p.hunger, p.saturation + f.sat);
      if (s.id === I.ROTTEN_FLESH && Math.random() < 0.8) { /* hunger effect omitted */ }
      consumeHeld(); game.audio?.burp();
      use.type = null; use.t = 0; game.mouse.right = false; // must release to eat again
    }
  } else if (use.type === 'bow') {
    if (!s || s.id !== I.BOW) { use.type = null; return; }
    use.t += dt;
  }
}

// ------------------------------------------------------------------ portals
function updatePortals(dt) {
  const w = game.world, p = game.player;
  const bx = Math.floor(p.pos.x), bz = Math.floor(p.pos.z);
  const a = w.getBlock(bx, Math.floor(p.pos.y + 0.1), bz), b = w.getBlock(bx, Math.floor(p.pos.y + 1.2), bz);
  const inNether = a === B.NETHER_PORTAL || b === B.NETHER_PORTAL;
  const inEnd = a === B.END_PORTAL || b === B.END_PORTAL;
  if (!inNether && !inEnd) { portalLock = false; }
  if (inNether && !portalLock) {
    portalTime += dt;
    game.audio?.portal();
    if (Math.random() < 0.4) game.renderer?.addParticles?.('portal', p.pos.x, p.pos.y + 1, p.pos.z, 0, 1);
    if (portalTime >= (isCreative() ? 0.1 : 4)) portalTravel(game.dimension === 'nether' ? 'overworld' : 'nether');
  } else portalTime = Math.max(0, portalTime - dt * 2);
  if (portalOverlay) portalOverlay.style.opacity = String(Math.min(0.85, portalTime / 4));
  if (inEnd && !portalLock) {
    if (game.dimension === 'end') endTravelToOverworld();
    else { setDimension('end', {x: 0, y: 64, z: -30}); portalLock = true; }
  }
}

// ------------------------------------------------------------------ death / respawn
function handleDeath() {
  game.dead = true;
  const p = game.player;
  game.mouse.left = game.mouse.right = false; use.type = null;
  if (!isCreative()) {
    for (const s of game.inventory.takeAll()) dropAt(s.id, s.count, p.pos.x, p.pos.y + 0.8, p.pos.z);
  }
  unlockPointer();
  if (game.ui?.openDeath) game.ui.openDeath(respawn, p.score | 0);
  else setTimeout(respawn, 1500);
}
function respawn() {
  game.dead = false;
  if (game.dimension !== 'overworld') setDimension('overworld', { ...game.spawn });
  const w = game.world;
  ensureAroundSync(w, game.spawn.x, game.spawn.z, 1);
  game.player.respawn(game.spawn.x, game.spawn.y, game.spawn.z);
  game.ui?.closeScreen?.();
  lockPointer();
}

// ------------------------------------------------------------------ input
function onKey(e, down) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  const k = e.code;
  const inp = game.input;
  const now = performance.now() / 1000;
  if (!game.started) return;
  if (k === 'ControlLeft' || k === 'ControlRight') { ctrlHeld = down; e.preventDefault?.(); }
  if (game.consoleOpen) return;
  if (down && !e.repeat) {
    if (k === 'F3') { e.preventDefault(); game.showDebug = !game.showDebug; if (!game.showDebug) game.ui?.debug?.([]); return; }
    if (k === 'Escape') {
      if (uiOpen()) { game.ui.closeScreen?.(); lockPointer(); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (!game.paused && !game.dead && (!locked)) { openPause(); }
      return;
    }
    if (k === 'KeyE') {
      if (game.dead || game.paused) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (uiOpen()) { game.ui.closeScreen?.(); lockPointer(); }
      else { game.ui?.openInventory?.(); unlockPointer(); }
      return;
    }
    if (!canPlay()) return;
    if (k === 'KeyT' || k === 'Slash') { e.preventDefault(); openConsole(k === 'Slash' ? '/' : ''); return; }
  }
  if (!canPlay() && down) return;
  switch (k) {
    case 'KeyW': case 'ArrowUp':
      if (down && !inp.forward) { if (lastWTap > 0 && now - lastWTap < 0.3) sprintLatch = true; lastWTap = now; }
      if (!down) sprintLatch = false;
      inp.forward = down; break;
    case 'KeyS': case 'ArrowDown': inp.back = down; break;
    case 'KeyA': case 'ArrowLeft': inp.left = down; break;
    case 'KeyD': case 'ArrowRight': inp.right = down; break;
    case 'Space':
      e.preventDefault();
      if (down && !e.repeat && isCreative()) {
        if (lastSpaceTap > 0 && now - lastSpaceTap < 0.3) { game.player.flying = !game.player.flying; game.player.vel.y = 0; lastSpaceTap = -1; }
        else lastSpaceTap = now;
      }
      inp.jump = down; break;
    case 'ShiftLeft': case 'ShiftRight': inp.sneak = down; break;
    case 'KeyR': if (down) sprintLatch = !sprintLatch; break;
    case 'KeyQ':
      if (down && !e.repeat) dropSelected(e.ctrlKey); break;
    default:
      if (down && k.startsWith('Digit')) { const n = +k.slice(5); if (n >= 1 && n <= 9) game.inventory.selected = n - 1; }
  }
  if (e.ctrlKey && down && ['KeyS', 'KeyD', 'KeyA', 'KeyF'].includes(k)) e.preventDefault();
}
function dropSelected(all) {
  const s = sel(); if (!s) return;
  const p = game.player; p.getEye(tmpEye, 1); p.getDir(tmpDir);
  const n = all ? s.count : 1;
  const id = s.id;
  game.inventory.consumeSelected(n);
  const v = new THREE.Vector3(tmpDir.x * 4, tmpDir.y * 4 + 2, tmpDir.z * 4);
  const ent = game.entities?.addItem?.(id, n, tmpEye.x + tmpDir.x * 0.5, tmpEye.y - 0.3, tmpEye.z + tmpDir.z * 0.5, v);
  if (ent && typeof ent === 'object') { if ('pickupDelay' in ent || true) ent.pickupDelay = 40; }
  if (s.count > 0 && false) void 0;
}

function openConsole(prefill) {
  game.consoleOpen = true; unlockPointer();
  let el = document.getElementById('mc-console');
  if (!el) {
    el = document.createElement('input'); el.id = 'mc-console'; el.autocomplete = 'off'; el.spellcheck = false;
    el.style.cssText = 'position:fixed;left:4px;right:4px;bottom:4px;height:28px;z-index:200;background:rgba(0,0,0,.6);color:#fff;border:1px solid #666;font:18px monospace;padding:0 6px;outline:none;box-sizing:border-box';
    document.body.appendChild(el);
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = el.value; closeConsole(); if (t) runCommand(game, t); }
      else if (e.key === 'Escape') closeConsole();
    });
  }
  el.style.display = 'block'; el.value = prefill || ''; el.focus();
  for (const k in game.input) game.input[k] = false;
}
function closeConsole() {
  const el = document.getElementById('mc-console');
  if (el) { el.style.display = 'none'; el.blur(); }
  game.consoleOpen = false; lockPointer();
}

function openPause() {
  if (game.paused) return;
  game.paused = true; unlockPointer();
  for (const k in game.input) game.input[k] = false;
  game.mouse.left = game.mouse.right = false;
  const resume = () => { game.paused = false; lockPointer(); };
  if (game.ui?.openPause) game.ui.openPause(resume, () => { game.ui.openOptions?.(() => { game.paused = false; openPause(); }); }, () => { game.paused = false; });
  else setTimeout(resume, 50);
}

function mouseScale() {
  const s = game.settings.sensitivity;
  return 0.0022 * (s > 5 ? s / 100 : s);
}

function setupInput() {
  window.addEventListener('keydown', (e) => { game.audio?.unlock(); onKey(e, true); }, true);
  window.addEventListener('keyup', (e) => onKey(e, false), true);
  window.addEventListener('blur', () => { for (const k in game.input) game.input[k] = false; game.mouse.left = game.mouse.right = false; });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && game.started && !game.paused && !game.dead && !uiOpen() && !game.consoleOpen) openPause();
  });
  document.addEventListener('pointerlockerror', () => { noLock = true; });
  document.addEventListener('mousemove', (e) => {
    if (!locked || !canPlay()) return;
    const sc = mouseScale();
    const p = game.player;
    p.yaw -= e.movementX * sc; p.pitch -= e.movementY * sc;
    if (p.pitch > 1.5707) p.pitch = 1.5707; if (p.pitch < -1.5707) p.pitch = -1.5707;
  });
  window.addEventListener('mousedown', (e) => {
    game.audio?.unlock();
    if (!game.started || game.paused || game.dead || game.consoleOpen || uiOpen()) return;
    if (!locked && !noLock) { lockPointer(); if (!noLock) return; }
    if (e.target && e.target !== canvas && e.target.closest?.('#ui > *') && e.target.id !== 'ui' && !e.target.classList?.contains('hud')) { /* ui element clicked */ }
    if (e.button === 0) { game.mouse.left = true; if (attackCd <= 0 && hitEntity) { attackEntity(); } }
    else if (e.button === 2) { game.mouse.right = true; rightClick(true); }
    else if (e.button === 1) { e.preventDefault(); pickBlock(); }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) game.mouse.left = false; else if (e.button === 2) game.mouse.right = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => {
    if (!canPlay()) return;
    const inv = game.inventory; const d = Math.sign(e.deltaY);
    if (d) inv.selected = (inv.selected + d + 9) % 9;
  }, { passive: true });
}

function pickBlock() {
  if (!hitBlock || !isCreative()) return;
  const id = hitBlock.id === B.FURNACE_LIT ? B.FURNACE : hitBlock.id;
  if (!ITEMS.has(id)) return;
  const inv = game.inventory;
  for (let i = 0; i < 9; i++) if (inv.slots[i]?.id === id) { inv.selected = i; return; }
  inv.slots[inv.selected] = new MODS.inventory.ItemStack(id, 64);
}

// ------------------------------------------------------------------ frame
function updateTarget() {
  hitBlock = null; hitEntity = null;
  if (!game.started || game.dead) { return; }
  const p = game.player, w = game.world;
  p.getEye(tmpEye, alpha); p.getDir(tmpDir);
  const h = w.raycast(tmpEye.x, tmpEye.y, tmpEye.z, tmpDir.x, tmpDir.y, tmpDir.z, 5, { liquids: false });
  hitBlock = h;
  let bd = Infinity;
  if (h) bd = Math.hypot(h.x + 0.5 - tmpEye.x, h.y + 0.5 - tmpEye.y, h.z + 0.5 - tmpEye.z) - 0.5;
  const r = game.entities?.raycastEntity?.(tmpEye.x, tmpEye.y, tmpEye.z, tmpDir.x, tmpDir.y, tmpDir.z, 3.0);
  if (r && r.entity && r.dist <= bd + 0.3) { hitEntity = r.entity; hitEntityDist = r.dist; }
  const key = hitBlock && !hitEntity && canPlay() ? hitBlock.x + ',' + hitBlock.y + ',' + hitBlock.z + ',' + hitBlock.id : '';
  if (key !== lastSel) { lastSel = key; game.renderer?.setSelection?.(key ? hitBlock : null); }
}

function syncFurnaces(dt) {
  furnAcc += dt;
  if (furnAcc < 0.5) return;
  furnAcc = 0;
  const ui = game.ui; const map = ui?.furnaces || ui?.furnaceData;
  if (!map || !map.forEach) return;
  const w = game.world;
  map.forEach((f, key) => {
    const [x, y, z] = String(key).split(',').map(Number);
    if (Number.isNaN(z)) return;
    const id = w.getBlock(x, y, z);
    const lit = !!(f && f.burn > 0);
    if (lit && id === B.FURNACE) w.setBlock(x, y, z, B.FURNACE_LIT, w.getMeta(x, y, z));
    else if (!lit && id === B.FURNACE_LIT) w.setBlock(x, y, z, B.FURNACE, w.getMeta(x, y, z));
  });
}

function debugLines() {
  const p = game.player, w = game.world;
  const x = p.pos.x, y = p.pos.y, z = p.pos.z;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const yawDeg = ((((-p.yaw * 180 / Math.PI) % 360) + 360) % 360);
  const facing = ['south (+Z)', 'west (-X)', 'north (-Z)', 'east (+X)'][Math.round(yawDeg / 90) % 4];
  const hit = hitBlock ? `${hitBlock.x} ${hitBlock.y} ${hitBlock.z} (${BLOCKS[hitBlock.id]?.name})` : 'none';
  return [
    'Minecraft 1.12 (vanilla-style) (' + fps.toFixed(0) + ' fps)',
    `XYZ: ${x.toFixed(3)} / ${y.toFixed(3)} / ${z.toFixed(3)}`,
    `Block: ${bx} ${by} ${bz}   Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${bz >> 4}`,
    `Facing: ${facing} (${yawDeg.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
    `Light: ${w.getSky?.(bx, by, bz) ?? '?'} sky, ${w.getBlockLight?.(bx, by, bz) ?? '?'} block`,
    `Dimension: ${game.dimension}  Seed: ${game.seed}  Mode: ${game.gamemode}`,
    `Time: ${Math.floor(game.time)}  Chunks: ${w.chunks?.size ?? '?'}  Mobs: ${game.entities?.mobs?.length ?? '?'}`,
    `Looking at: ${hit}`,
    `Health ${p.health.toFixed(1)}  Food ${p.hunger} (sat ${p.saturation.toFixed(1)})  XP lvl ${p.xpLevel}`,
  ];
}

const IDLE = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
const stepInput = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };

function frame(t) {
  requestAnimationFrame(frame);
  let dt = (t - lastT) / 1000; lastT = t;
  if (!(dt > 0)) dt = 0.016; if (dt > 0.1) dt = 0.1;
  fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  const g = game, p = g.player;
  if (!g.started) return;
  // settings
  const st = g.settings;
  if (g.renderer) {
    if (g.renderer.renderDistance !== st.renderDistance) g.renderer.renderDistance = st.renderDistance;
  }
  const open = uiOpen();
  if (wasUiOpen && !open && !g.paused && !g.dead && !g.consoleOpen) lockPointer();
  wasUiOpen = open;
  if (!g.paused) {
    const playing = canPlay();
    // fixed 20 Hz physics
    acc += dt; let n = 0;
    while (acc >= 0.05 && n < 5) {
      if (!g.dead) {
        if (playing) { Object.assign(stepInput, g.input); stepInput.sprint = ctrlHeld || sprintLatch; p.tick(stepInput); }
        else p.tick(IDLE);
      }
      acc -= 0.05; n++;
    }
    if (n === 5) acc = 0;
    alpha = acc / 0.05;
    g.time = (g.time + dt * 20) % 24000;
    updateTarget();
    attackCd = Math.max(0, attackCd - dt); placeCd = Math.max(0, placeCd - dt);
    if (playing && (locked || noLock)) {
      if (g.mouse.left && attackCd <= 0 && hitEntity) attackEntity();
      updateBreaking(dt);
      if (g.mouse.right && !use.type && placeCd <= 0) rightClick(false);
    } else updateBreaking(dt);
    updateUse(dt);
    if (swingActive) { swing += dt / 0.28; if (swing >= 1) { if ((g.mouse.left && hitBlock) && playing) swing = 0; else { swingActive = false; swing = 0; } } }
    if (!g.dead) updatePortals(dt);
    updateProjectiles(dt);
    updateFuses(dt);
    g.world.tick?.(dt, p.pos.x, p.pos.z);
    g.entities?.update?.(dt);
    spawnAcc += dt;
    if (spawnAcc >= 0.5) { g.entities?.tickSpawning?.(spawnAcc, g.dimension, g.time); spawnAcc = 0; }
    g.ui?.tickFurnaces?.(dt);
    syncFurnaces(dt);
  } else { alpha = 1; }

  // texture animation ~10 Hz
  texAcc += dt; if (texAcc >= 0.1) { texAcc = 0; try { MODS.textures?.tickTextures?.(performance.now() / 1000); } catch (e) { /* */ } }

  // camera
  p.getEye(camPos, alpha);
  camProxy.yaw = p.yaw; camProxy.pitch = p.pitch;
  const r = g.renderer;
  if (r) {
    const targetFov = st.fov * (p.sprinting ? 1.12 : 1) * (p.flying && ctrlHeld ? 1.1 : 1);
    r._fov = (r._fov || st.fov) + (targetFov - (r._fov || st.fov)) * Math.min(1, dt * 10);
    r.setFov?.(r._fov);
    r.setUnderwater?.(p.headInWater);
    r.setDamageFlash?.(p.hurtFlash);
    const it = sel();
    r.setHeldItem?.(it ? it.id : 0, swingActive ? swing : 0, p.walkDist * 1.0);
    r.update(dt, camProxy, g.time);
    r.render();
  }
  if (g.showDebug) g.ui?.debug?.(debugLines());
  g.ui?.update?.(dt);
  g.audio && (g.audio.volume = st.volume);
}

// ------------------------------------------------------------------ boot
function makeLoading() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:300;background:#2b2013 repeating-linear-gradient(45deg,#33261a 0 8px,#2b2013 8px 16px);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font:bold 22px monospace;text-shadow:2px 2px #3f3f3f';
  d.innerHTML = '<div id="ld-t">Generating world...</div><div style="margin-top:16px;width:300px;height:10px;background:#555;border:2px solid #000"><div id="ld-b" style="height:100%;width:0;background:#7ad45a"></div></div>';
  document.body.appendChild(d);
  return { el: d, set(f) { const b = d.querySelector('#ld-b'); if (b) b.style.width = Math.round(f * 100) + '%'; }, text(t) { d.querySelector('#ld-t').textContent = t; }, remove() { d.remove(); } };
}

let starting = false;
async function startGame() {
  if (starting || game.started) return; starting = true;
  const ld = makeLoading();
  game.audio?.unlock();
  await nextFrame();
  const w = getWorld('overworld');
  game.world = w; game.player.setWorld(w);
  game.stronghold = MODS.world?.STRONGHOLD || null;
  let sp = { x: 0.5, y: 80, z: 0.5 };
  try {
    w.ensureChunk(0, 0);
    const s = w.findSpawn(); sp = { x: Math.floor(s.x) + 0.5, y: s.y, z: Math.floor(s.z) + 0.5 };
  } catch (e) { console.error('findSpawn', e); }
  game.spawn = sp;
  await ensureAround(w, sp.x, sp.z, 3, (f) => ld.set(f * 0.9));
  game.renderer?.setWorld?.(w);
  game.player.teleport(sp.x, sp.y, sp.z);
  ld.text('Building terrain...'); ld.set(0.95);
  await nextFrame();
  game.started = true;
  const mode = params.get('mode');
  if (mode === 'creative' || mode === 'survival') game.gamemode = mode;
  const dim = params.get('dim');
  if (dim === 'nether' || dim === 'end') setDimension(dim);
  if (game.gamemode === 'creative') {
    // give a few useful things in creative
    ['stone', 'planks', 'glass', 'torch', 'tnt', 'obsidian', 'flint_and_steel', 'diamond_pickaxe', 'water_bucket'].forEach((n) => { const id = [...ITEMS.values()].find((i) => i.name === n || i.name === n + '_oak')?.id; if (id) game.inventory.add(id, ITEMS.get(id).stack > 1 ? 64 : 1); });
  }
  lastT = performance.now();
  ld.set(1); ld.remove();
  say('Welcome to Minecraft. Press T for chat, F3 for debug.');
  lockPointer();
  starting = false;
}
game.start = startGame;

async function boot() {
  await loadMods();
  const seedParam = params.get('seed');
  game.seed = seedParam != null && seedParam !== '' ? (isNaN(+seedParam) ? hashStr(seedParam) : +seedParam | 0) : (Math.random() * 2147483647) | 0;
  game.settings.renderDistance = Math.max(2, Math.min(12, parseInt(params.get('rd') || '6', 10) || 6));

  // textures
  const T = MODS.textures;
  if (T) {
    game.textures = { drawItemIcon: T.drawItemIcon, getTileCanvas: T.getTileCanvas };
    try { game.atlasBlock = T.buildBlockAtlas(); game.atlasItem = T.buildItemAtlas(); } catch (e) { console.error('atlas', e); }
    game.textures.atlasBlock = game.atlasBlock; game.textures.atlasItem = game.atlasItem;
  }
  // inventory
  game.inventory = MODS.inventory ? new MODS.inventory.Inventory() : { slots: new Array(41).fill(null), selected: 0, getSelected() { return this.slots[this.selected]; }, consumeSelected() {}, damageSelected() {}, armorPoints() { return 0; }, add() { return 0; }, has() { return false; }, remove() { return 0; }, takeAll() { return []; } };
  game.audio = new GameAudio(game);
  game.player = new Player(game);
  game.player.onDeath = handleDeath;
  // world (needed before renderer / entities)
  const w0 = getWorld('overworld');
  game.world = w0; game.player.setWorld(w0);
  if (MODS.render) {
    try { game.renderer = new MODS.render.Renderer(canvas, game.atlasBlock, game.atlasItem); game.renderer.renderDistance = game.settings.renderDistance; game.renderer.setWorld(w0); }
    catch (e) { console.error('renderer', e); }
  }
  if (MODS.ui) {
    try { game.ui = new MODS.ui.UI(rootEl(), game, game.textures); } catch (e) { console.error('ui', e); }
  }
  if (MODS.entities) {
    try { game.entities = new MODS.entities.EntityManager(game); } catch (e) { console.error('entities', e); }
  }
  portalOverlay = document.createElement('div');
  portalOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle,rgba(120,40,200,.55),rgba(60,10,120,.9));z-index:40;mix-blend-mode:screen';
  document.body.appendChild(portalOverlay);
  setupInput();
  window.addEventListener('resize', () => { game.renderer?.resize?.(); });
  requestAnimationFrame(frame);

  if (params.get('autostart') === '1' || !game.ui?.openMainMenu) startGame();
  else game.ui.openMainMenu(() => { startGame(); });
}
function hashStr(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

boot().catch((e) => console.error('[main] boot failed', e));
