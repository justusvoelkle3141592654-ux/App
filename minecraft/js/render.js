// render.js — three.js renderer for the Minecraft clone (Agent RENDER)
//
// Public API (see SPEC.md):
//   new Renderer(canvas, atlasBlock, atlasItem)
//     .setWorld(world)  .update(dt, player, timeOfDay)  .render()
//     .setSelection(block|null)  .setBreakProgress(block|null, 0..1)
//     .addParticles(kind, x,y,z, blockId?, count?)   kind: break|smoke|flame|portal|splash|explosion
//     .setHeldItem(itemId|0, swingT 0..1, bobT)  .setUnderwater(b)  .setDamageFlash(0..1)  .setFov(deg)
//     .renderDistance (2..12)  .scene  .camera  .resize()  .stats
//   Camera convention: camera.rotation(order YXZ) = (pitch, yaw, 0): yaw 0 looks toward -z, +yaw turns left (CCW seen from above),
//   +pitch looks up. player.pos = eye position (THREE.Vector3).
//   Colours are NOT colour-managed (ColorManagement off, linear output) so canvas textures look exactly as drawn.
// Extra exports (for entities.js etc.):
//   makeItemMesh(itemId, atlases?)  -> THREE.Object3D, centred on origin, ~1 unit wide. Block ids = cube with per-face tiles,
//        other items = extruded 16x16 sprite (1/16 thick). atlases = {block, item}; omitted -> atlases of the Renderer.
//        Mesh uses MeshBasicMaterial(vertexColors) — scale it (e.g. 0.25) and tint via mesh.material.color if needed (shared material!
//        clone it first if you want per-instance tint).
//   makeBlockMesh(blockId, atlas?)  -> THREE.Mesh, 1x1x1 cube centred on origin with per-face tiles.
import * as THREE from 'three';
import { BLOCKS, B, getItem } from './registry.js';
import {
  setMesherAtlas, setEyeTile, meshChunk, createChunkMaterials,
  setDefaultAtlases, makeItemMesh, makeBlockMesh, itemGeometry, itemBasicMaterial,
} from './mesher.js';
export { makeItemMesh, makeBlockMesh };

THREE.ColorManagement.enabled = false;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const DEG = Math.PI / 180;
const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

function nearest(tex) {
  if (!tex) return;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
}
function canvasTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  nearest(t); return t;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// -------------------------------------------------------------------- particle texture (own, procedural)
function makeFxCanvas() {
  const cv = document.createElement('canvas'); cv.width = 80; cv.height = 16;
  const ctx = cv.getContext('2d'); const R = rng(77);
  const blob = (tile, rad, f) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d + (R() - 0.5) * 3 > rad) continue;
      const c = f(d / rad); ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${c[3] ?? 1})`;
      ctx.fillRect(tile * 16 + x, y, 1, 1);
    }
  };
  blob(0, 7, (k) => { const g = 120 + (R() * 70 | 0) + (1 - k) * 30; return [g, g, g, 1]; });                       // smoke
  blob(1, 6.5, (k) => [255, 150 + (R() * 80 | 0) - (k * 60 | 0), 20 + (R() * 40 | 0)]);                          // flame
  blob(2, 5.5, (k) => [130 + (R() * 60 | 0), 20 + (R() * 30 | 0), 200 + (R() * 55 | 0)]);                         // portal
  blob(3, 4, (k) => [200 + (R() * 55 | 0), 225 + (R() * 30 | 0), 255]);                                           // splash
  blob(4, 7.5, (k) => { const g = 200 + (R() * 55 | 0) - (k * 70 | 0); return [g, g, g]; });                      // explosion
  return cv;
}
const FX = { smoke: 0, flame: 1, portal: 2, splash: 3, explosion: 4 };

// -------------------------------------------------------------------- particle system (pooled, single mesh)
class Particles {
  constructor(max, texture, transparent) {
    this.max = max; this.n = 0;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.size = f(); this.grav = f(); this.drag = f();
    this.u0 = f(); this.v0 = f(); this.u1 = f(); this.v1 = f(); this.r = f(); this.g = f(); this.b = f();
    this.fade = new Uint8Array(max); this.shrink = new Uint8Array(max); this.col = new Uint8Array(max);
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12); this.uv = new Float32Array(max * 8); this.cl = new Float32Array(max * 16);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) { const o = i * 4; idx.set([o, o + 1, o + 2, o, o + 2, o + 3], i * 6); }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.cl, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent, alphaTest: transparent ? 0.02 : 0.3, depthWrite: !transparent, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
  spawn(x, y, z, vx, vy, vz, life, size, grav, drag, uv, r, g, b, fade, shrink, collide) {
    let i;
    if (this.n < this.max) i = this.n++; else i = (Math.random() * this.max) | 0;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grav[i] = grav; this.drag[i] = drag;
    this.u0[i] = uv[0]; this.v0[i] = uv[1]; this.u1[i] = uv[2]; this.v1[i] = uv[3];
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.fade[i] = fade; this.shrink[i] = shrink; this.col[i] = collide;
  }
  copy(d, s) {
    this.px[d] = this.px[s]; this.py[d] = this.py[s]; this.pz[d] = this.pz[s]; this.vx[d] = this.vx[s]; this.vy[d] = this.vy[s]; this.vz[d] = this.vz[s];
    this.life[d] = this.life[s]; this.maxLife[d] = this.maxLife[s]; this.size[d] = this.size[s]; this.grav[d] = this.grav[s]; this.drag[d] = this.drag[s];
    this.u0[d] = this.u0[s]; this.v0[d] = this.v0[s]; this.u1[d] = this.u1[s]; this.v1[d] = this.v1[s];
    this.r[d] = this.r[s]; this.g[d] = this.g[s]; this.b[d] = this.b[s];
    this.fade[d] = this.fade[s]; this.shrink[d] = this.shrink[s]; this.col[d] = this.col[s];
  }
  update(dt, rx, ry, rz, ux, uy, uz, world) {
    let i = 0;
    const dr = Math.pow(0.98, dt * 20);
    while (i < this.n) {
      let l = this.life[i] - dt;
      if (l <= 0) { this.n--; if (i < this.n) this.copy(i, this.n); continue; }
      this.life[i] = l;
      const d = this.drag[i] ? Math.pow(this.drag[i], dt * 20) : dr;
      this.vy[i] -= this.grav[i] * dt;
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      let nx = this.px[i] + this.vx[i] * dt, ny = this.py[i] + this.vy[i] * dt, nz = this.pz[i] + this.vz[i] * dt;
      if (this.col[i] && world) {
        let solid = false;
        try { solid = world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz)); } catch (e) { solid = false; }
        if (solid) {
          // try to keep horizontal motion, stop vertical
          let s2 = false;
          try { s2 = world.isSolid(Math.floor(nx), Math.floor(this.py[i]), Math.floor(nz)); } catch (e) { s2 = false; }
          if (s2) { nx = this.px[i]; nz = this.pz[i]; this.vx[i] = this.vz[i] = 0; }
          ny = this.py[i]; if (this.vy[i] < 0) { this.vx[i] *= 0.7; this.vz[i] *= 0.7; } this.vy[i] = 0;
        }
      }
      this.px[i] = nx; this.py[i] = ny; this.pz[i] = nz;
      i++;
    }
    const n = this.n, P = this.pos, U = this.uv, C = this.cl;
    for (let k = 0; k < n; k++) {
      const t = this.life[k] / this.maxLife[k];
      let s = this.size[k] * 0.5; if (this.shrink[k]) s *= (0.4 + 0.6 * t);
      const ax = (rx * s), ay = (ry * s), az = (rz * s), bx = (ux * s), by = (uy * s), bz = (uz * s);
      const x = this.px[k], y = this.py[k], z = this.pz[k];
      let o = k * 12;
      P[o] = x - ax - bx; P[o + 1] = y - ay - by; P[o + 2] = z - az - bz;
      P[o + 3] = x + ax - bx; P[o + 4] = y + ay - by; P[o + 5] = z + az - bz;
      P[o + 6] = x + ax + bx; P[o + 7] = y + ay + by; P[o + 8] = z + az + bz;
      P[o + 9] = x - ax + bx; P[o + 10] = y - ay + by; P[o + 11] = z - az + bz;
      o = k * 8;
      U[o] = this.u0[k]; U[o + 1] = this.v0[k]; U[o + 2] = this.u1[k]; U[o + 3] = this.v0[k];
      U[o + 4] = this.u1[k]; U[o + 5] = this.v1[k]; U[o + 6] = this.u0[k]; U[o + 7] = this.v1[k];
      o = k * 16;
      const a = this.fade[k] ? Math.min(1, t * 1.6) : 1;
      for (let q = 0; q < 4; q++) { C[o + q * 4] = this.r[k]; C[o + q * 4 + 1] = this.g[k]; C[o + q * 4 + 2] = this.b[k]; C[o + q * 4 + 3] = a; }
    }
    this.geo.setDrawRange(0, n * 6);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
}

// -------------------------------------------------------------------- crack fallback
function fallbackCrack(stage) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 16; const ctx = cv.getContext('2d');
  const R = rng(1234 + stage);
  const cnt = 6 + stage * 14;
  for (let i = 0; i < cnt; i++) {
    let x = 8 + ((R() - 0.5) * (4 + stage * 1.3)) | 0, y = 8 + ((R() - 0.5) * (4 + stage * 1.3)) | 0;
    ctx.fillStyle = `rgba(0,0,0,${0.35 + R() * 0.35})`; ctx.fillRect(clamp(x, 0, 15), clamp(y, 0, 15), 1, 1);
  }
  return cv;
}

// -------------------------------------------------------------------- Renderer
export class Renderer {
  constructor(canvas, atlasBlock, atlasItem) {
    this.canvas = canvas; this.atlasBlock = atlasBlock; this.atlasItem = atlasItem;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.fov = 70; this.renderDistance = 6; this._rd = 6;
    this.world = null; this.dim = 'overworld';
    this.entries = new Map(); this.offs = []; this._offsKey = ''; this._pcx = 1e9; this._pcz = 1e9;
    this.time = 0; this.tod = 6000; this.underwater = false; this.damage = 0;
    this._unloadT = 0; this._texT = 0; this._cloudDrift = 0;
    this.stats = { chunks: 0, triangles: 0, particles: 0 };
    this.autoTickTextures = false; // main.js ticks textures itself

    nearest(atlasBlock.texture); nearest(atlasItem?.texture);
    setMesherAtlas(atlasBlock); setEyeTile(atlasBlock);
    setDefaultAtlases(atlasBlock, atlasItem);

    // shared uniforms for chunk shaders
    this.U = {
      dayFactor: { value: 1 }, ambient: { value: 0.035 }, skyTint: { value: new THREE.Vector3(1, 1, 1) },
      fogColor: { value: new THREE.Color(0xc0d8ff) }, fogNear: { value: 50 }, fogFar: { value: 90 },
    };
    this.mats = createChunkMaterials(atlasBlock.texture, this.U);
    this.mats.opaque.name = 'chunk-opaque';
    this.scene.fog = new THREE.Fog(0xc0d8ff, 50, 90);
    this.scene.background = new THREE.Color(0xc0d8ff);

    // lights for entity models (mobs use lambert/standard materials, basic ones ignore them)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7); this.scene.add(this.ambientLight);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.6); this.sunLight.position.set(0.3, 1, 0.5);
    this.scene.add(this.sunLight); this.scene.add(this.sunLight.target);

    this._buildSky();
    this._buildClouds();
    this._buildSelection();
    this._buildCrack();
    this._buildHand();
    this._buildOverlay();

    this.fxTex = canvasTex(makeFxCanvas());
    this.pBlock = new Particles(900, atlasBlock.texture, false);
    this.pFx = new Particles(1400, this.fxTex, true);
    this.scene.add(this.pBlock.mesh); this.scene.add(this.pFx.mesh);

    // optional texture module hooks (animated tiles, crack canvases)
    this.texMod = null;
    import('./textures.js').then(m => { this.texMod = m; this._crackTex = []; }).catch(() => { this.texMod = null; });

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
  }
  setFov(deg) { this.fov = deg; this.camera.fov = deg; this.camera.updateProjectionMatrix(); }
  setUnderwater(b) { this.underwater = !!b; }
  setDamageFlash(v) { this.damage = clamp(v, 0, 1); }

  // ---------------------------------------------------------------- sky, stars, sun/moon, clouds
  _buildSky() {
    this.skyUniforms = {
      zenith: { value: new THREE.Color(0x78a7ff) }, horizon: { value: new THREE.Color(0xc0d8ff) },
      glowColor: { value: new THREE.Color(1, 0.5, 0.2) }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, glow: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glowColor; uniform vec3 sunDir; uniform float glow; varying vec3 vDir;
        void main(){ float h = vDir.y; float t = pow(clamp(h,0.0,1.0), 0.6); vec3 c = mix(horizon, zenith, t);
          vec2 a = normalize(vDir.xz + 1e-5); vec2 s = normalize(sunDir.xz + 1e-5);
          float g = glow * pow(max(dot(a,s),0.0), 3.0) * exp(-abs(h) * 4.0);
          c = mix(c, glowColor, clamp(g,0.0,1.0) * 0.85); gl_FragColor = vec4(c,1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(80, 24, 12), mat);
    this.dome.renderOrder = -100; this.dome.frustumCulled = false; this.scene.add(this.dome);

    this.celestial = new THREE.Group(); this.celestial.renderOrder = -90; this.scene.add(this.celestial);
    const mkTex = (draw) => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; draw(cv.getContext('2d')); return canvasTex(cv); };
    const sunTex = mkTex((c) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, 32, 32);
      c.fillStyle = 'rgb(70,50,10)'; c.fillRect(6, 6, 20, 20);
      c.fillStyle = 'rgb(200,160,50)'; c.fillRect(8, 8, 16, 16);
      c.fillStyle = 'rgb(255,230,120)'; c.fillRect(10, 10, 12, 12);
      c.fillStyle = 'rgb(255,255,235)'; c.fillRect(12, 12, 8, 8);
    });
    const moonTex = mkTex((c) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, 32, 32);
      c.fillStyle = 'rgb(205,210,225)'; c.fillRect(4, 4, 24, 24);
      c.fillStyle = 'rgb(160,165,185)';
      for (const [x, y, w, h] of [[8, 7, 4, 4], [18, 12, 5, 5], [10, 19, 6, 4], [21, 21, 3, 3], [15, 6, 3, 2]]) c.fillRect(x, y, w, h);
    });
    const mk = (tex, size, x, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
        map: tex, blending: THREE.AdditiveBlending, transparent: false, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
      }));
      m.position.set(x, 0, 0); m.rotation.y = ry; m.renderOrder = -90; m.frustumCulled = false; return m;
    };
    this.sun = mk(sunTex, 62, 100, -Math.PI / 2); this.moon = mk(moonTex, 40, -100, Math.PI / 2);
    this.celestial.add(this.sun); this.celestial.add(this.moon);

    const N = 1300, sp = new Float32Array(N * 3), R = rng(4242);
    for (let i = 0; i < N; i++) {
      const u = R() * 2 - 1, th = R() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(th) * 95; sp[i * 3 + 1] = u * 95; sp[i * 3 + 2] = r * Math.sin(th) * 95;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2, sizeAttenuation: false, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: false,
      depthTest: false, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.renderOrder = -95; this.stars.frustumCulled = false;
    this.celestial.add(this.stars);
  }

  _buildClouds() {
    const G = 24, CS = 12, REP = 2, N = G * REP, R = rng(9001);
    const f = []; for (let i = 0; i < G * G; i++) f.push(R());
    const sm = new Float32Array(G * G);
    for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
      let s = 0, w = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const ww = 3 - Math.max(Math.abs(dx), Math.abs(dz)) * 0.8; s += f[((z + dz + G) % G) * G + ((x + dx + G) % G)] * ww; w += ww;
      }
      sm[z * G + x] = s / w;
    }
    const has = (x, z) => sm[(((z % G) + G) % G) * G + (((x % G) + G) % G)] > 0.51;
    const pos = [], col = [], idx = [];
    const Y0 = 0, Y1 = 4;
    const quad = (p, c) => { const b = pos.length / 3; for (const v of p) { pos.push(v[0], v[1], v[2]); col.push(c, c, c); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      if (!has(x, z)) continue;
      const x0 = (x - N / 2) * CS, x1 = x0 + CS, z0 = (z - N / 2) * CS, z1 = z0 + CS;
      quad([[x0, Y1, z1], [x1, Y1, z1], [x1, Y1, z0], [x0, Y1, z0]], 1.0);
      quad([[x0, Y0, z0], [x1, Y0, z0], [x1, Y0, z1], [x0, Y0, z1]], 0.7);
      if (!has(x + 1, z)) quad([[x1, Y0, z1], [x1, Y0, z0], [x1, Y1, z0], [x1, Y1, z1]], 0.85);
      if (!has(x - 1, z)) quad([[x0, Y0, z0], [x0, Y0, z1], [x0, Y1, z1], [x0, Y1, z0]], 0.85);
      if (!has(x, z + 1)) quad([[x0, Y0, z1], [x1, Y0, z1], [x1, Y1, z1], [x0, Y1, z1]], 0.8);
      if (!has(x, z - 1)) quad([[x1, Y0, z0], [x0, Y0, z0], [x0, Y1, z0], [x1, Y1, z0]], 0.8);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false, fog: true });
    this.clouds = new THREE.Mesh(g, this.cloudMat);
    this.clouds.frustumCulled = false; this.clouds.renderOrder = 3;
    this.cloudPeriod = G * CS; this.cloudY = 108;
    this.scene.add(this.clouds);
  }

  // ---------------------------------------------------------------- selection + crack overlay
  _buildSelection() {
    this.selGeo = new THREE.BufferGeometry();
    this.selPos = new Float32Array(24 * 3);
    this.selGeo.setAttribute('position', new THREE.BufferAttribute(this.selPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.selLines = new THREE.LineSegments(this.selGeo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.65, fog: false }));
    this.selLines.frustumCulled = false; this.selLines.visible = false; this.selLines.renderOrder = 6;
    this.scene.add(this.selLines);
  }
  _bounds(id, out) {
    const b = BLOCKS[id]; const sh = b ? b.shape : 'cube';
    let x0 = 0, y0 = 0, z0 = 0, x1 = 1, y1 = 1, z1 = 1;
    switch (sh) {
      case 'cross': x0 = z0 = 0.1; x1 = z1 = 0.9; y1 = 0.8; break;
      case 'torch': x0 = z0 = 0.4375; x1 = z1 = 0.5625; y1 = 0.6875; break;
      case 'cactus': x0 = z0 = 1 / 16; x1 = z1 = 15 / 16; break;
      case 'frame': y1 = 13 / 16; break;
      case 'chest': x0 = z0 = 1 / 16; x1 = z1 = 15 / 16; y1 = 14 / 16; break;
      case 'liquid': y1 = 14 / 16; break;
      case 'fire': y1 = 1; break;
      case 'portal': if (id === B.END_PORTAL) y1 = 0.75; break;
    }
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = x1; out[4] = y1; out[5] = z1;
  }
  setSelection(block) {
    if (!block) { this.selLines.visible = false; return; }
    if (!this._bb) this._bb = new Array(6);
    const bb = this._bb; this._bounds(block.id ?? this.world?.getBlock(block.x, block.y, block.z) ?? 1, bb);
    const e = 0.003, x0 = block.x + bb[0] - e, y0 = block.y + bb[1] - e, z0 = block.z + bb[2] - e, x1 = block.x + bb[3] + e, y1 = block.y + bb[4] + e, z1 = block.z + bb[5] + e;
    const P = this.selPos;
    const C = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    for (let i = 0; i < 24; i++) { const c = C[E[i]]; P[i * 3] = c[0]; P[i * 3 + 1] = c[1]; P[i * 3 + 2] = c[2]; }
    this.selGeo.attributes.position.needsUpdate = true; this.selLines.visible = true;
  }
  _buildCrack() {
    this.crackTex = [];
    this.crackMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.crackMat);
    this.crackMesh.visible = false; this.crackMesh.renderOrder = 4; this.scene.add(this.crackMesh);
  }
  _getCrack(stage) {
    if (this.crackTex[stage]) return this.crackTex[stage];
    let cv = null;
    if (this.texMod && typeof this.texMod.getCrackCanvas === 'function') { try { cv = this.texMod.getCrackCanvas(stage); } catch (e) { cv = null; } }
    const usedReal = !!cv;
    if (!cv) cv = fallbackCrack(stage);
    const t = canvasTex(cv);
    if (usedReal) this.crackTex[stage] = t;  // fallback re-tried until texture module is ready
    return t;
  }
  setBreakProgress(block, p) {
    if (!block || !(p > 0)) { this.crackMesh.visible = false; return; }
    const stage = clamp(Math.floor(p * 10), 0, 9);
    if (this._crackStage !== stage || !this.crackMat.map) { this.crackMat.map = this._getCrack(stage); this.crackMat.needsUpdate = true; this._crackStage = stage; }
    if (!this._bb) this._bb = new Array(6);
    const bb = this._bb; this._bounds(block.id ?? 1, bb);
    const e = 0.004;
    this.crackMesh.scale.set(bb[3] - bb[0] + e * 2, bb[4] - bb[1] + e * 2, bb[5] - bb[2] + e * 2);
    this.crackMesh.position.set(block.x + (bb[0] + bb[3]) / 2, block.y + (bb[1] + bb[4]) / 2, block.z + (bb[2] + bb[5]) / 2);
    this.crackMesh.visible = true;
  }

  // ---------------------------------------------------------------- overlays (damage / underwater)
  _buildOverlay() {
    this.ovScene = new THREE.Scene(); this.ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mk = (color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })); m.visible = false; this.ovScene.add(m); return m; };
    this.ovWater = mk(0x1a4a9a); this.ovDamage = mk(0xff0000);
  }

  // ---------------------------------------------------------------- held item
  _buildHand() {
    this.handScene = new THREE.Scene(); this.handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handRoot = new THREE.Group(); this.handRoot.matrixAutoUpdate = false; this.handScene.add(this.handRoot);
    this.handTune = { ry: -15, rz: 38, tx: 0.12, ty: 0.05, tz: 0, s: 0.55 };
    this.hand = { id: -1, want: 0, swing: 0, bob: 0, obj: null, kind: 'none', mat: null, equip: 0, state: 'idle', speed: 0, phase: 0 };
    this._hm = new THREE.Matrix4(); this._t = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._lastPos = new THREE.Vector3(); this._havePos = false;
    // arm geometry
    const mkBox = (w, h, d, c) => {
      const g = new THREE.BoxGeometry(w, h, d); const n = g.attributes.position.count; const col = new Float32Array(n * 3);
      const sh = [0.6, 0.6, 1, 0.5, 0.8, 0.8];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const o = (f * 4 + k) * 3; col[o] = c[0] * sh[f]; col[o + 1] = c[1] * sh[f]; col[o + 2] = c[2] * sh[f]; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
    };
    this.armMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.armObj = new THREE.Group();
    const skin = new THREE.Mesh(mkBox(0.26, 0.26, 0.5, [0.78, 0.56, 0.42]), this.armMat); skin.position.z = -0.25;
    const sleeve = new THREE.Mesh(mkBox(0.27, 0.27, 0.55, [0.2, 0.62, 0.68]), this.armMat); sleeve.position.z = 0.27;
    this.armObj.add(skin); this.armObj.add(sleeve);
  }
  setHeldItem(itemId, swingT, bobT) {
    const h = this.hand; h.want = itemId | 0; h.swing = swingT || 0; h.bob = bobT || 0;
  }
  _mountHeld(id) {
    const h = this.hand;
    if (h.obj) { this.handRoot.remove(h.obj); h.obj = null; }
    h.id = id; h.kind = 'none';
    if (!id) { h.obj = this.armObj; h.kind = 'arm'; this.handRoot.add(h.obj); return; }
    const r = itemGeometry(id, { block: this.atlasBlock, item: this.atlasItem });
    if (!r) { h.obj = this.armObj; h.kind = 'arm'; this.handRoot.add(h.obj); return; }
    if (!h.mat) h.mat = {};
    const key = r.atlas.texture.uuid;
    let m = h.mat[key];
    if (!m) { m = new THREE.MeshBasicMaterial({ map: r.atlas.texture, vertexColors: true, alphaTest: 0.1 }); h.mat[key] = m; }
    h.curMat = m;
    h.obj = new THREE.Mesh(r.geometry, m); h.kind = r.kind;
    this.handRoot.add(h.obj);
  }
  _lightAt(x, y, z) {
    const w = this.world; if (!w) return 1;
    let sky = 15, blk = 0;
    try { sky = w.getSky(x, y, z); blk = w.getBlockLight(x, y, z); } catch (e) { /* ignore */ }
    const bs = Math.pow(0.8, 15 * (1 - (sky / 15) * this.U.dayFactor.value)), bb = Math.pow(0.8, 15 * (1 - blk / 15));
    return Math.max(bs, bb, this.U.ambient.value);
  }
  _updateHand(dt, player) {
    const h = this.hand;
    // movement speed for bobbing
    if (player && player.pos) {
      if (this._havePos) {
        const dx = player.pos.x - this._lastPos.x, dz = player.pos.z - this._lastPos.z;
        const sp = Math.sqrt(dx * dx + dz * dz) / Math.max(dt, 1e-4);
        h.speed += (clamp(sp / 4.3, 0, 1.4) - h.speed) * Math.min(1, dt * 8);
      }
      this._lastPos.copy(player.pos); this._havePos = true;
    }
    // equip animation: lower old, swap, raise new
    if (h.state === 'idle' && h.want !== h.id) h.state = 'down';
    if (h.state === 'down') { h.equip += dt * 7; if (h.equip >= 1) { h.equip = 1; this._mountHeld(h.want); h.state = 'up'; } }
    else if (h.state === 'up') { h.equip -= dt * 7; if (h.equip <= 0) { h.equip = 0; h.state = 'idle'; } }
    if (!h.obj) this._mountHeld(h.want);
    const e = h.equip * h.equip * (3 - 2 * h.equip);
    // light tint
    let b = 1;
    if (player && player.pos) b = this._lightAt(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z));
    b = clamp(b * 1.05, 0.12, 1);
    if (h.curMat) h.curMat.color.setScalar(b);
    this.armMat.color.setScalar(b);

    const s = clamp(h.swing, 0, 1);
    const f1 = Math.sin(Math.sqrt(s) * Math.PI), f = Math.sin(s * Math.PI), f2 = Math.sin(s * s * Math.PI);
    const M = this._hm.identity(), T = this._t, Rm = this._r;
    // walking bob
    const amp = h.speed * 0.045, ph = h.bob * Math.PI;
    M.multiply(T.makeTranslation(Math.sin(ph) * amp * 0.9, -Math.abs(Math.cos(ph)) * amp * 1.3, 0));
    M.multiply(Rm.makeRotationZ(Math.sin(ph) * amp * 0.4));
    M.multiply(T.makeTranslation(-f1 * 0.4, Math.sin(Math.sqrt(s) * Math.PI * 2) * 0.2, -f * 0.2));
    if (h.kind === 'arm') {
      M.multiply(T.makeTranslation(0.52, -0.5 - e * 0.6, -0.5));
      M.multiply(Rm.makeRotationY((24 - f2 * 20) * DEG));
      M.multiply(Rm.makeRotationX((18 + f1 * 40) * DEG));
      M.multiply(Rm.makeRotationZ(f1 * -15 * DEG));
    } else {
      M.multiply(T.makeTranslation(0.56, -0.52 - e * 0.6, -0.72));
      M.multiply(Rm.makeRotationY((45 - f2 * 20) * DEG));
      M.multiply(Rm.makeRotationZ(f1 * -20 * DEG));
      M.multiply(Rm.makeRotationX(f1 * -80 * DEG));
      M.multiply(Rm.makeRotationY(-45 * DEG));
      if (h.kind === 'block') {
        M.multiply(Rm.makeRotationY(45 * DEG)); M.multiply(T.makeScale(0.4, 0.4, 0.4));
      } else {
        const ht = this.handTune;
        M.multiply(Rm.makeRotationY(ht.ry * DEG)); M.multiply(Rm.makeRotationZ(ht.rz * DEG)); M.multiply(T.makeTranslation(ht.tx, ht.ty, ht.tz)); M.multiply(T.makeScale(ht.s, ht.s, ht.s));
      }
    }
    this.handRoot.matrix.copy(M); this.handRoot.matrixWorldNeedsUpdate = true;
  }

  // ---------------------------------------------------------------- world / chunks
  setWorld(world, dim) {
    this._disposeAll();
    this.world = world;
    this.dim = dim || world?.dim || world?.dimension || 'overworld';
    this._pcx = 1e9; this._offsKey = '';
    this.pBlock.clear(); this.pFx.clear();
    const od = this.dim === 'overworld';
    this.dome.visible = od || this.dim === 'end'; this.celestial.visible = od || this.dim === 'end';
    this.sun.visible = this.moon.visible = od; this.clouds.visible = od;
    this.stars.visible = od || this.dim === 'end';
    this.U.ambient.value = this.dim === 'nether' ? 0.13 : this.dim === 'end' ? 0.07 : 0.035;
    this._applySky();
  }
  _disposeEntry(e) {
    for (const k of ['opaque', 'alpha', 'trans']) {
      const m = e[k]; if (m) { this.scene.remove(m); m.geometry.dispose(); e[k] = null; }
    }
    if (e.chunk && e.chunk.mesh === e) e.chunk.mesh = null;
  }
  _disposeAll() { for (const e of this.entries.values()) this._disposeEntry(e); this.entries.clear(); }

  _buildOffsets() {
    const rd = this.renderDistance, R = rd + 1.5, list = [];
    const r = Math.ceil(R);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dz * dz; if (d2 > R * R) continue;
      list.push({ dx, dz, d2, mesh: d2 <= (rd + 0.5) * (rd + 0.5) });
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.offs = list; this._offsKey = rd;
  }
  _nbrFn(entry) {
    return (dx, dz) => {
      const e = this.entries.get(ckey(entry.cx + dx, entry.cz + dz));
      if (e) return e.chunk;
      return this.world.getChunk(entry.cx + dx, entry.cz + dz) || null;
    };
  }
  _buildEntry(e) {
    const t = meshChunk(e.chunk, this._nbrFn(e));
    const old = { opaque: e.opaque, alpha: e.alpha, trans: e.trans };
    const mk = (geo, mat, ro) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat); m.position.set(e.cx * 16, 0, e.cz * 16);
      m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = ro; this.scene.add(m); return m;
    };
    e.opaque = mk(t.opaque, this.mats.opaque, 0);
    e.alpha = mk(t.alpha, this.mats.alpha, 1);
    e.trans = mk(t.trans, this.mats.trans, 2);
    for (const k in old) if (old[k]) { this.scene.remove(old[k]); old[k].geometry.dispose(); }
    e.chunk.dirty = false; e.version = e.chunk.version;
    e.chunk.mesh = e;
  }
  _manageChunks(player) {
    const w = this.world; if (!w) return;
    const rd = clamp(Math.round(this.renderDistance), 2, 12);
    if (rd !== this._rd || this._offsKey !== rd) { this._rd = rd; this.renderDistance = rd; this._buildOffsets(); this._pcx = 1e9; }
    const pcx = Math.floor(player.pos.x / 16), pcz = Math.floor(player.pos.z / 16);
    this._pcx = pcx; this._pcz = pcz;
    const t0 = performance.now();
    const loading = this.entries.size < 30;
    const genBudget = loading ? 6 : 2, meshBudget = loading ? 4 : 2, timeCap = loading ? 30 : 12;
    let gen = 0, built = 0;
    const offs = this.offs;
    for (let i = 0; i < offs.length; i++) {
      const o = offs[i], cx = pcx + o.dx, cz = pcz + o.dz;
      let e = this.entries.get(ckey(cx, cz));
      if (!e) {
        let ch = w.getChunk(cx, cz);
        if (!ch) {
          if (gen >= genBudget || performance.now() - t0 > timeCap) continue;
          ch = w.ensureChunk(cx, cz); gen++;
          if (!ch) continue;
        }
        e = { chunk: ch, cx, cz, version: -1, opaque: null, alpha: null, trans: null, built: false };
        this.entries.set(ckey(cx, cz), e);
      }
      if (!o.mesh) continue;
      if ((!e.built || e.chunk.dirty) && built < meshBudget && performance.now() - t0 < timeCap) {
        // all 4 neighbours must exist
        let ok = true;
        for (let k = 0; k < 4; k++) {
          const ncx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ncz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (!this.entries.has(ckey(ncx, ncz)) && !w.getChunk(ncx, ncz)) { ok = false; break; }
        }
        if (!ok) continue;
        this._buildEntry(e); e.built = true; built++;
      }
    }
    // unload far chunks
    this._unloadT -= 1;
    if (this._unloadT <= 0) {
      this._unloadT = 30;
      const lim = rd + 2;
      for (const [k, e] of this.entries) {
        if (Math.abs(e.cx - pcx) > lim || Math.abs(e.cz - pcz) > lim) { this._disposeEntry(e); this.entries.delete(k); }
      }
    }
  }

  // ---------------------------------------------------------------- per frame
  _applySky() {
    const t = this.tod, a = (t / 24000) * Math.PI * 2, s = Math.sin(a);
    const U = this.U, dim = this.dim;
    const sc = this.skyUniforms;
    let fog = this._fogC || (this._fogC = new THREE.Color());
    let dl = 1;
    if (dim === 'overworld') {
      dl = clamp(0.5 + 2 * s, 0, 1);
      U.dayFactor.value = 4 / 15 + (11 / 15) * dl;
      const nz = [0.012, 0.014, 0.04], nh = [0.03, 0.035, 0.08], dz = [0.47, 0.65, 1.0], dh = [0.753, 0.847, 1.0];
      const k = clamp((s + 0.12) / 0.4, 0, 1);
      sc.zenith.value.setRGB(nz[0] + (dz[0] - nz[0]) * k, nz[1] + (dz[1] - nz[1]) * k, nz[2] + (dz[2] - nz[2]) * k);
      sc.horizon.value.setRGB(nh[0] + (dh[0] - nh[0]) * k, nh[1] + (dh[1] - nh[1]) * k, nh[2] + (dh[2] - nh[2]) * k);
      const glow = clamp(1 - Math.abs(s) / 0.3, 0, 1);
      sc.glow.value = glow;
      sc.sunDir.value.set(Math.cos(a), s, 0);
      fog.copy(sc.horizon.value);
      // warm fog at sunrise/sunset
      fog.r += (0.95 - fog.r) * glow * 0.25; fog.g += (0.55 - fog.g) * glow * 0.25; fog.b += (0.35 - fog.b) * glow * 0.25;
      U.skyTint.value.set(1 - (1 - dl) * 0.25, 1 - (1 - dl) * 0.2, 1);
      this.celestial.rotation.z = a;
      this.starMat.color.setScalar(clamp((-s - 0.02) * 4, 0, 1) * 0.9);
      this.stars.visible = this.starMat.color.r > 0.01;
      this.sunLight.position.set(Math.cos(a), Math.max(s, 0.15) + 0.2, 0.3);
      this.sunLight.intensity = 0.15 + 0.55 * dl;
      this.ambientLight.intensity = 0.38 + 0.4 * dl;
      this.cloudMat.color.setScalar(0.25 + 0.75 * dl);
    } else if (dim === 'nether') {
      U.dayFactor.value = 1; U.skyTint.value.set(1, 1, 1);
      fog.setRGB(0.2, 0.03, 0.03); this.ambientLight.intensity = 0.75; this.sunLight.intensity = 0.2;
    } else {
      U.dayFactor.value = 1; U.skyTint.value.set(0.95, 0.9, 1);
      fog.setRGB(0.11, 0.07, 0.16);
      sc.zenith.value.setRGB(0.05, 0.03, 0.09); sc.horizon.value.setRGB(0.13, 0.09, 0.19); sc.glow.value = 0;
      this.starMat.color.setScalar(0.7); this.stars.visible = true; this.celestial.rotation.z = 0.5;
      this.ambientLight.intensity = 0.55; this.sunLight.intensity = 0.35;
    }
    // fog distances
    const far = Math.max(24, this.renderDistance * 16 - 6);
    let near, farD;
    if (this.underwater) { fog.setRGB(0.05, 0.13, 0.32 + 0.1 * dl); U.dayFactor.value = Math.max(U.dayFactor.value, 0.6); near = 0.2; farD = 20; }
    else if (dim === 'nether') { near = far * 0.02; farD = Math.min(far, 110) * 0.85; }
    else if (dim === 'end') { near = far * 0.4; farD = far; }
    else { near = far * 0.62; farD = far; }
    U.fogColor.value.copy(fog); U.fogNear.value = near; U.fogFar.value = farD;
    this.scene.fog.color.copy(fog); this.scene.fog.near = near; this.scene.fog.far = farD;
    this.scene.background.copy(fog);
    this._tmpHorizon = fog;
  }

  update(dt, player, timeOfDay) {
    dt = Math.min(dt, 0.25);
    this.time += dt;
    this.tod = timeOfDay ?? this.tod;
    const cam = this.camera;
    cam.position.copy(player.pos);
    cam.rotation.set(player.pitch || 0, player.yaw || 0, 0, 'YXZ');
    const farPlane = Math.max(400, this.renderDistance * 16 + 220);
    if (cam.far !== farPlane) { cam.far = farPlane; cam.updateProjectionMatrix(); }
    this._applySky();

    // sky objects follow camera
    this.dome.position.copy(cam.position); this.celestial.position.copy(cam.position);
    // clouds
    this._cloudDrift = (this._cloudDrift + dt * 1.4) % this.cloudPeriod;
    const px = cam.position.x - this._cloudDrift, pz = cam.position.z;
    this.clouds.position.set(Math.round(px / this.cloudPeriod) * this.cloudPeriod + this._cloudDrift, this.cloudY, Math.round(pz / this.cloudPeriod) * this.cloudPeriod);

    this._manageChunks(player);

    // particles
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    this.pBlock.update(dt, e[0], e[1], e[2], e[4], e[5], e[6], this.world);
    this.pFx.update(dt, e[0], e[1], e[2], e[4], e[5], e[6], this.world);

    this._updateHand(dt, player);

    // overlays
    const wv = this.ovWater, dv = this.ovDamage;
    wv.visible = this.underwater; wv.material.opacity = this.underwater ? 0.38 : 0;
    dv.visible = this.damage > 0.01; dv.material.opacity = this.damage * 0.5;

    // animated textures
    if (this.autoTickTextures && this.texMod && typeof this.texMod.tickTextures === 'function') {
      this._texT -= dt;
      if (this._texT <= 0) { this._texT = 0.1; try { this.texMod.tickTextures(this.time); } catch (err) { /* ignore */ } }
    }
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.setViewport(0, 0, this.canvas.width, this.canvas.height);
    r.autoClear = true;
    r.render(this.scene, this.camera);
    r.autoClear = false;
    r.clearDepth();
    r.render(this.handScene, this.handCam);
    if (this.ovWater.visible || this.ovDamage.visible) r.render(this.ovScene, this.ovCam);
    this.stats.particles = this.pBlock.n + this.pFx.n;
    this.stats.chunks = this.entries.size;
    this.stats.triangles = r.info.render.triangles;
  }

  // ---------------------------------------------------------------- particles
  _pBrightness(x, y, z) { return this._lightAt(Math.floor(x), Math.floor(y), Math.floor(z)); }
  addParticles(kind, x, y, z, blockId, count) {
    const R = Math.random;
    const fx = (name) => { const t = FX[name]; return [t / 5 + 0.002, 0.002, (t + 1) / 5 - 0.002, 0.998]; };
    switch (kind) {
      case 'break': {
        const n = count ?? 22, id = blockId || 1;
        const b = BLOCKS[id]; const A = this.atlasBlock;
        const br = clamp(this._pBrightness(x, y + 0.5, z) * 1.1, 0.25, 1);
        for (let i = 0; i < n; i++) {
          const f = (R() * 6) | 0; let name = null;
          name = this._faceTileName(id, f === 3 ? 2 : f);
          let uv = null; try { uv = name ? A.uv(name) : null; } catch (e) { uv = null; }
          if (!uv) uv = [0, 0, 1, 1];
          const q = 0.25, ou = ((R() * 3) | 0) * q, ov = ((R() * 3) | 0) * q;
          const du = uv[2] - uv[0], dv = uv[3] - uv[1];
          const sub = [uv[0] + du * ou, uv[1] + dv * ov, uv[0] + du * (ou + q), uv[1] + dv * (ov + q)];
          const px = x + 0.5 + (R() - 0.5) * 0.9, py = y + 0.5 + (R() - 0.5) * 0.9, pz = z + 0.5 + (R() - 0.5) * 0.9;
          const vx = (px - x - 0.5) * 3.2 + (R() - 0.5) * 1.5, vy = (py - y - 0.5) * 3 + R() * 2.2, vz = (pz - z - 0.5) * 3.2 + (R() - 0.5) * 1.5;
          const sh = (0.6 + R() * 0.4) * br;
          this.pBlock.spawn(px, py, pz, vx, vy, vz, 0.4 + R() * 0.9, 0.09 + R() * 0.1, 16, 0, sub, sh, sh, sh, 0, 0, 1);
        }
        break;
      }
      case 'smoke': {
        const n = count ?? 3;
        for (let i = 0; i < n; i++) {
          const g = 0.25 + R() * 0.25;
          this.pFx.spawn(x + (R() - 0.5) * 0.3, y + R() * 0.2, z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.25, 0.5 + R() * 0.6, (R() - 0.5) * 0.25, 0.8 + R() * 1.0, 0.22 + R() * 0.22, -0.2, 0.985, fx('smoke'), g, g, g, 1, 0, 0);
        }
        break;
      }
      case 'flame': {
        const n = count ?? 2;
        for (let i = 0; i < n; i++)
          this.pFx.spawn(x + (R() - 0.5) * 0.25, y + R() * 0.1, z + (R() - 0.5) * 0.25, (R() - 0.5) * 0.1, 0.35 + R() * 0.4, (R() - 0.5) * 0.1, 0.3 + R() * 0.4, 0.12 + R() * 0.1, 0, 0.98, fx('flame'), 1, 1, 1, 1, 1, 0);
        break;
      }
      case 'portal': {
        const n = count ?? 3;
        for (let i = 0; i < n; i++) {
          const a = R() * 6.283, sp = 0.4 + R() * 0.6, g = 0.6 + R() * 0.4;
          this.pFx.spawn(x + (R() - 0.5) * 0.8, y + R() * 1.5, z + (R() - 0.5) * 0.8, Math.cos(a) * sp * 0.4, (R() - 0.5) * 0.8, Math.sin(a) * sp * 0.4, 0.8 + R() * 0.8, 0.1 + R() * 0.12, 0, 0.97, fx('portal'), g, g * 0.6, 1, 1, 1, 0);
        }
        break;
      }
      case 'splash': {
        const n = count ?? 10;
        for (let i = 0; i < n; i++) {
          const a = R() * 6.283, sp = 0.5 + R() * 1.5;
          this.pFx.spawn(x + (R() - 0.5) * 0.5, y, z + (R() - 0.5) * 0.5, Math.cos(a) * sp, 2 + R() * 2.5, Math.sin(a) * sp, 0.5 + R() * 0.5, 0.07 + R() * 0.08, 14, 0, fx('splash'), 1, 1, 1, 1, 0, 0);
        }
        break;
      }
      case 'explosion': {
        const n = count ?? 14;
        for (let i = 0; i < n; i++) {
          const a = R() * 6.283, b = (R() - 0.5) * 3, sp = 0.5 + R() * 3.2;
          const g = 0.75 + R() * 0.25;
          this.pFx.spawn(x + (R() - 0.5) * 1.8, y + (R() - 0.3) * 1.6, z + (R() - 0.5) * 1.8, Math.cos(a) * sp * 0.6, b * 0.6, Math.sin(a) * sp * 0.6, 0.5 + R() * 0.7, 1.3 + R() * 2.2, 0, 0.93, fx('explosion'), g, g, g, 1, 1, 0);
        }
        for (let i = 0; i < n * 2; i++) {
          const g = 0.2 + R() * 0.25;
          this.pFx.spawn(x + (R() - 0.5) * 2, y + R() * 1.5, z + (R() - 0.5) * 2, (R() - 0.5) * 2, 0.5 + R() * 1.5, (R() - 0.5) * 2, 0.8 + R() * 1.2, 0.5 + R() * 0.6, -0.3, 0.97, fx('smoke'), g, g, g, 1, 0, 0);
        }
        break;
      }
    }
  }
  _faceTileName(id, f) {
    const b = BLOCKS[id]; if (!b || !b.tex) return null;
    const t = b.tex; if (typeof t === 'string') return t;
    if (f === 2) return t.top; if (f === 3) return t.bottom;
    const k = ['px', 'nx', 0, 0, 'pz', 'nz'][f];
    return t[k] ?? t.side;
  }
}
