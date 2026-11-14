// mobs.js — Mob-Modelle (Box-Glieder + prozedurale Skins), Animation und KI.
// Vanilla-1.12-Stil: Zombie, Skeleton, Creeper, Spider, Enderman, Zombie Pigman, Blaze,
// Pig, Cow, Sheep, Chicken, Ender Dragon, End Crystal.
import * as THREE from 'three';
import { B, I, BLOCKS } from './registry.js';

const S16 = 1 / 16, TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * clamp(t, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);
const css = (c, k = 1) => `rgb(${clamp(c[0] * k | 0, 0, 255)},${clamp(c[1] * k | 0, 0, 255)},${clamp(c[2] * k | 0, 0, 255)})`;
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- Tageslicht (0..24000, Vanilla: 0 = Morgen, Nacht ~13000..23000)
export function dayFactor(t) {
  t = ((t % 24000) + 24000) % 24000;
  if (t < 12000) return 1;
  if (t < 13500) return 1 - (t - 12000) / 1500 * 0.73;
  if (t < 22500) return 0.27;
  return 0.27 + (t - 22500) / 1500 * 0.73;
}

// ---------------------------------------------------------------- Mob-Definitionen
export const MOB_DEFS = {
  zombie:   { name: 'Zombie', w: 0.6, h: 1.95, hp: 20, speed: 3.4, kind: 'hostile', xp: 5, burnDay: true },
  skeleton: { name: 'Skeleton', w: 0.6, h: 1.95, hp: 20, speed: 3.2, kind: 'hostile', xp: 5, burnDay: true },
  creeper:  { name: 'Creeper', w: 0.6, h: 1.7, hp: 20, speed: 3.0, kind: 'hostile', xp: 5 },
  spider:   { name: 'Spider', w: 1.4, h: 0.9, hp: 16, speed: 4.6, kind: 'hostile', xp: 5 },
  enderman: { name: 'Enderman', w: 0.6, h: 2.9, hp: 40, speed: 6.0, kind: 'neutral', xp: 5 },
  pigman:   { name: 'Zombie Pigman', w: 0.6, h: 1.95, hp: 20, speed: 3.6, kind: 'neutral', xp: 5 },
  blaze:    { name: 'Blaze', w: 0.6, h: 1.8, hp: 20, speed: 3.0, kind: 'hostile', xp: 10, flying: true },
  pig:      { name: 'Pig', w: 0.9, h: 0.9, hp: 10, speed: 1.7, kind: 'passive', xp: 2 },
  cow:      { name: 'Cow', w: 0.9, h: 1.4, hp: 10, speed: 1.6, kind: 'passive', xp: 2 },
  sheep:    { name: 'Sheep', w: 0.9, h: 1.3, hp: 8, speed: 1.7, kind: 'passive', xp: 2 },
  chicken:  { name: 'Chicken', w: 0.4, h: 0.7, hp: 4, speed: 1.5, kind: 'passive', xp: 2 },
  dragon:   { name: 'Ender Dragon', w: 8, h: 4, hp: 200, speed: 15, kind: 'boss', xp: 12000, flying: true, centerOrigin: true },
  crystal:  { name: 'End Crystal', w: 2, h: 2, hp: 1, speed: 0, kind: 'crystal', xp: 0, flying: true },
};
const ALIASES = {
  zombiepigman: 'pigman', zombifiedpiglin: 'pigman', pigzombie: 'pigman', zombiepig: 'pigman', pigmen: 'pigman',
  enderdragon: 'dragon', endcrystal: 'crystal', endercrystal: 'crystal', mooshroom: 'cow', creepers: 'creeper',
};
export function normalizeMobType(t) {
  const k = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  return MOB_DEFS[k] ? k : (ALIASES[k] || null);
}

// ---------------------------------------------------------------- Skin-/Modell-Baukasten
function faceRects(u, v, w, h, d) {
  return {
    right: { x: u, y: v + d, w: d, h }, front: { x: u + d, y: v + d, w, h },
    left: { x: u + d + w, y: v + d, w: d, h }, back: { x: u + 2 * d + w, y: v + d, w, h },
    top: { x: u + d, y: v, w, h: d }, bottom: { x: u + d + w, y: v, w, h: d },
  };
}
const px = (c, r, x, y, w, h, col) => { c.fillStyle = css(col); c.fillRect(r.x + x, r.y + y, w, h); };
function fillNoise(c, r, base, noise, rnd, k0 = 1) {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const k = k0 * (1 + (rnd() - 0.5) * noise / 50);
    c.fillStyle = css(base, k); c.fillRect(r.x + x, r.y + y, 1, 1);
  }
}
function palettePix(c, r, pal, rnd) {
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { c.fillStyle = css(pal[(rnd() * pal.length) | 0]); c.fillRect(r.x + x, r.y + y, 1, 1); }
}
function blotch(c, r, col, rnd, cell = 3, thr = 0.5) {
  const cw = Math.ceil(r.w / cell) + 1, ch = Math.ceil(r.h / cell) + 1, g = [];
  for (let i = 0; i < cw * ch; i++) g.push(rnd());
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const v = g[((y / cell) | 0) * cw + ((x / cell) | 0)] + (rnd() - 0.5) * 0.25;
    if (v > thr) { c.fillStyle = css(col, 1 + (rnd() - 0.5) * 0.12); c.fillRect(r.x + x, r.y + y, 1, 1); }
  }
}
function P(n, size, pivot, off, base, o = {}) { return Object.assign({ n, size, pivot, off, base, noise: 10 }, o); }
const allFaces = ['front', 'back', 'left', 'right', 'top', 'bottom'];

// ---- Humanoide
function humanoid(o) {
  const thin = !!o.thin, aw = thin ? 2 : 4, ao = thin ? -1 : -2;
  const arm = (n, x) => P(n, [aw, 12, aw], [x * (thin ? 5 : 6), 22, 0], [ao, -10, ao], o.skin, { fx: o.armFx });
  const leg = (n, x) => P(n, [aw, 12, aw], [x * 2, 12, 0], [ao, -12, ao], o.pants, { fx: o.legFx });
  const parts = [
    P('head', [8, 8, 8], [0, 24, 0], [-4, 0, -4], o.skin, { fx: o.headFx, glow: o.headGlow }),
    P('body', [8, 12, 4], [0, 24, 0], [-4, -12, -2], o.shirt, { fx: o.bodyFx }),
    arm('armR', -1), arm('armL', 1), leg('legR', -1), leg('legL', 1),
  ];
  return parts;
}

const SKIN = [92, 150, 90];
const SPECS = {
  zombie() {
    const eye = [14, 22, 44];
    return {
      W: 64, scale: 0.975,
      parts: humanoid({
        skin: SKIN, shirt: [10, 150, 165], pants: [58, 52, 150],
        headFx(c, R, rn) {
          fillNoise(c, R.top, [64, 108, 64], 14, rn);
          const f = R.front; px(c, f, 1, 3, 2, 1, eye); px(c, f, 5, 3, 2, 1, eye); px(c, f, 1, 2, 2, 1, [70, 120, 70]); px(c, f, 5, 2, 2, 1, [70, 120, 70]);
          px(c, f, 3, 4, 2, 1, [66, 112, 70]); px(c, f, 2, 6, 4, 1, [48, 86, 54]); px(c, f, 3, 7, 2, 1, [44, 80, 50]);
        },
        armFx(c, R, rn) { for (const k of allFaces) { if (k === 'top' || k === 'bottom') continue; const r = R[k]; px(c, r, 0, 0, r.w, 4, [10, 150, 165]); px(c, r, 0, 3, r.w, 1, [6, 120, 135]); } },
        bodyFx(c, R) { px(c, R.front, 2, 8, 3, 1, [8, 125, 140]); px(c, R.front, 5, 4, 2, 1, [8, 125, 140]); },
        legFx(c, R) { for (const k of ['front', 'back', 'left', 'right']) px(c, R[k], 0, 10, R[k].w, 2, [60, 60, 70]); },
      }),
    };
  },
  skeleton() {
    const bone = [210, 210, 206], dk = [48, 48, 50];
    const ps = humanoid({
      thin: true, skin: bone, shirt: bone, pants: bone,
      headFx(c, R) { const f = R.front; px(c, f, 1, 3, 2, 2, dk); px(c, f, 5, 3, 2, 2, dk); px(c, f, 3, 5, 2, 1, [120, 120, 118]); for (let x = 1; x < 7; x++) px(c, f, x, 6, 1, 2, x % 2 ? dk : [225, 225, 222]); },
      bodyFx(c, R) { const f = R.front; px(c, f, 3, 0, 2, 12, [150, 150, 146]); for (const y of [1, 4, 7]) { px(c, f, 0, y, 3, 2, dk); px(c, f, 5, y, 3, 2, dk); } px(c, R.back, 3, 0, 2, 12, [150, 150, 146]); for (const y of [1, 4, 7]) px(c, R.back, 0, y, 8, 1, [120, 120, 116]); },
      armFx(c, R) { for (const k of ['front', 'back', 'left', 'right']) { px(c, R[k], 0, 5, R[k].w, 1, [120, 120, 116]); } },
      legFx(c, R) { for (const k of ['front', 'back', 'left', 'right']) { px(c, R[k], 0, 5, R[k].w, 1, [120, 120, 116]); } },
    });
    ps.push(P('bow', [1, 2, 14], [0, -9, 0], [0, -1, -7], [112, 80, 42], { parent: 'armR', fx(c, R) { px(c, R.top, 0, 0, 1, 14, [220, 220, 210]); } }));
    return { W: 64, scale: 1, parts: ps };
  },
  creeper() {
    const pal = [[50, 160, 50], [78, 190, 66], [34, 128, 40], [108, 202, 90], [60, 140, 46], [24, 106, 34]];
    const blot = (c, R, rn) => { for (const k of allFaces) palettePix(c, R[k], pal, rn); };
    return {
      W: 64, scale: 1,
      parts: [
        P('head', [8, 8, 8], [0, 18, 0], [-4, 0, -4], pal[0], { fx(c, R, rn) { blot(c, R, rn); const f = R.front, k = [14, 30, 14]; px(c, f, 1, 2, 2, 2, k); px(c, f, 5, 2, 2, 2, k); px(c, f, 3, 4, 2, 1, k); px(c, f, 2, 5, 4, 2, k); px(c, f, 2, 7, 1, 1, k); px(c, f, 5, 7, 1, 1, k); } }),
        P('body', [8, 12, 4], [0, 18, 0], [-4, -12, -2], pal[0], { fx: blot }),
        P('legFR', [4, 6, 4], [-2, 6, 4], [-2, -6, -2], pal[0], { fx: blot }),
        P('legFL', [4, 6, 4], [2, 6, 4], [-2, -6, -2], pal[0], { like: 'legFR' }),
        P('legBR', [4, 6, 4], [-2, 6, -4], [-2, -6, -2], pal[0], { like: 'legFR' }),
        P('legBL', [4, 6, 4], [2, 6, -4], [-2, -6, -2], pal[0], { like: 'legFR' }),
      ],
    };
  },
  pig() {
    const pk = [236, 152, 154];
    const legFx = (c, R) => { for (const k of ['front', 'back', 'left', 'right']) px(c, R[k], 0, 5, R[k].w, 1, [200, 120, 124]); };
    return {
      W: 64, scale: 1,
      parts: [
        P('body', [10, 8, 16], [0, 10, 0], [-5, -4, -8], pk, { noise: 8, fx(c, R) { px(c, R.top, 4, 0, 2, 16, [226, 140, 144]); } }),
        P('head', [8, 8, 8], [0, 11, 8], [-4, -4, -2], pk, { fx(c, R) { const f = R.front; px(c, f, 1, 2, 2, 1, [255, 255, 255]); px(c, f, 5, 2, 2, 1, [255, 255, 255]); px(c, f, 2, 2, 1, 1, [40, 30, 60]); px(c, f, 5, 2, 1, 1, [40, 30, 60]); px(c, R.left, 0, 0, 8, 1, [210, 130, 136]); } }),
        P('snout', [4, 3, 1], [0, 0, 0], [-2, -3, 6], [214, 120, 126], { parent: 'head', noise: 6, fx(c, R) { px(c, R.front, 1, 1, 1, 1, [128, 62, 72]); px(c, R.front, 2, 1, 1, 1, [128, 62, 72]); } }),
        P('legFR', [4, 6, 4], [-3, 6, 5], [-2, -6, -2], pk, { fx: legFx }),
        P('legFL', [4, 6, 4], [3, 6, 5], [-2, -6, -2], pk, { like: 'legFR' }),
        P('legBR', [4, 6, 4], [-3, 6, -5], [-2, -6, -2], pk, { like: 'legFR' }),
        P('legBL', [4, 6, 4], [3, 6, -5], [-2, -6, -2], pk, { like: 'legFR' }),
      ],
    };
  },
  cow() {
    const br = [96, 62, 38], wh = [236, 232, 224];
    const patch = (c, R, rn) => { for (const k of allFaces) { blotch(c, R[k], wh, rn, 3, 0.62); } };
    return {
      W: 128, scale: 1,
      parts: [
        P('body', [12, 10, 18], [0, 17, 0], [-6, -5, -9], br, { noise: 12, fx: patch }),
        P('head', [8, 8, 6], [0, 20, 9], [-4, -4, -1], br, { fx(c, R, rn) {
          const f = R.front; px(c, f, 0, 5, 8, 3, [226, 206, 196]); px(c, f, 2, 6, 1, 1, [120, 90, 84]); px(c, f, 5, 6, 1, 1, [120, 90, 84]);
          px(c, f, 0, 2, 2, 2, [255, 255, 255]); px(c, f, 6, 2, 2, 2, [255, 255, 255]); px(c, f, 1, 3, 1, 1, [30, 24, 24]); px(c, f, 6, 3, 1, 1, [30, 24, 24]); px(c, f, 3, 1, 2, 2, wh);
        } }),
        P('hornR', [1, 3, 1], [-4, 3, 2], [-1, 0, 0], [232, 226, 200], { parent: 'head', noise: 4 }),
        P('hornL', [1, 3, 1], [4, 3, 2], [0, 0, 0], [232, 226, 200], { parent: 'head', noise: 4, like: 'hornR' }),
        P('udder', [4, 2, 4], [0, 12, -3], [-2, -2, -2], [232, 164, 164], { noise: 6 }),
        P('legFR', [4, 12, 4], [-4, 12, 6], [-2, -12, -2], br, { fx(c, R, rn) { for (const k of ['front', 'back', 'left', 'right']) { blotch(c, R[k], wh, rn, 3, 0.7); px(c, R[k], 0, 10, R[k].w, 2, [58, 40, 30]); } } }),
        P('legFL', [4, 12, 4], [4, 12, 6], [-2, -12, -2], br, { like: 'legFR' }),
        P('legBR', [4, 12, 4], [-4, 12, -6], [-2, -12, -2], br, { like: 'legFR' }),
        P('legBL', [4, 12, 4], [4, 12, -6], [-2, -12, -2], br, { like: 'legFR' }),
      ],
    };
  },
  sheep() {
    const wool = [238, 238, 236], sk = [196, 170, 150];
    const wfx = (c, R, rn) => { for (const k of allFaces) { const r = R[k]; for (let i = 0; i < r.w * r.h / 5; i++) px(c, r, (rn() * r.w) | 0, (rn() * r.h) | 0, 1, 1, [212, 212, 210]); } };
    const legFx = (c, R) => { for (const k of ['front', 'back', 'left', 'right']) { px(c, R[k], 0, 0, R[k].w, 4, wool); px(c, R[k], 0, 9, R[k].w, 3, [92, 80, 74]); } };
    return {
      W: 64, scale: 1,
      parts: [
        P('body', [10, 9, 18], [0, 12, 0], [-5, 0, -9], wool, { noise: 6, fx: wfx }),
        P('head', [6, 6, 8], [0, 18, 9], [-3, -3, -1], sk, { fx(c, R) { const f = R.front; px(c, f, 0, 1, 1, 2, [60, 52, 50]); px(c, f, 5, 1, 1, 2, [60, 52, 50]); px(c, f, 2, 4, 2, 1, [150, 120, 110]); px(c, R.top, 0, 0, 6, 2, wool); } }),
        P('cap', [8, 2, 6], [0, 0, 0], [-4, 2, -2], wool, { parent: 'head', noise: 6, fx: wfx }),
        P('legFR', [4, 12, 4], [-3, 12, 6], [-2, -12, -2], sk, { fx: legFx }),
        P('legFL', [4, 12, 4], [3, 12, 6], [-2, -12, -2], sk, { like: 'legFR' }),
        P('legBR', [4, 12, 4], [-3, 12, -6], [-2, -12, -2], sk, { like: 'legFR' }),
        P('legBL', [4, 12, 4], [3, 12, -6], [-2, -12, -2], sk, { like: 'legFR' }),
      ],
    };
  },
  chicken() {
    const wh = [244, 244, 240], yl = [240, 180, 40];
    return {
      W: 64, scale: 1,
      parts: [
        P('body', [6, 6, 8], [0, 5, 0], [-3, 0, -4], wh, { noise: 8, fx(c, R) { px(c, R.top, 0, 0, 6, 8, [236, 236, 232]); } }),
        P('head', [4, 6, 3], [0, 9, 4], [-2, 0, -1], wh, { fx(c, R) { px(c, R.front, 0, 2, 1, 1, [20, 20, 20]); px(c, R.front, 3, 2, 1, 1, [20, 20, 20]); px(c, R.left, 1, 2, 1, 1, [20, 20, 20]); px(c, R.right, 1, 2, 1, 1, [20, 20, 20]); } }),
        P('beak', [4, 2, 2], [0, 0, 0], [-2, 2, 2], [238, 160, 40], { parent: 'head', noise: 4 }),
        P('wattle', [2, 2, 1], [0, 0, 0], [-1, 0, 2], [210, 40, 40], { parent: 'head', noise: 4 }),
        P('legR', [1, 5, 1], [-2, 5, 0], [0, -5, 0], yl, { noise: 6 }),
        P('legL', [1, 5, 1], [2, 5, 0], [0, -5, 0], yl, { noise: 6, like: 'legR' }),
        P('wingR', [1, 4, 6], [-3, 10, 0], [-1, -4, -3], [236, 236, 232], { noise: 8 }),
        P('wingL', [1, 4, 6], [3, 10, 0], [0, -4, -3], [236, 236, 232], { noise: 8, like: 'wingR' }),
        P('tail', [4, 4, 2], [0, 9, -4], [-2, 0, -2], wh, { noise: 8 }),
      ],
    };
  },
  spider() {
    const dk = [44, 34, 32], br = [76, 54, 44];
    const red = [210, 20, 20];
    const parts = [
      P('thorax', [6, 6, 6], [0, 8, 0], [-3, -2, -3], dk, { noise: 14 }),
      P('head', [8, 8, 8], [0, 8, 8], [-4, -3, -4], dk, { noise: 14, fx(c, R) { px(c, R.front, 0, 6, 8, 2, [30, 24, 22]); px(c, R.front, 1, 7, 1, 1, [150, 150, 140]); px(c, R.front, 6, 7, 1, 1, [150, 150, 140]); }, glow(c, R) { const f = R.front; px(c, f, 1, 2, 2, 2, red); px(c, f, 5, 2, 2, 2, red); px(c, f, 3, 1, 1, 1, [150, 0, 0]); px(c, f, 4, 1, 1, 1, [150, 0, 0]); px(c, f, 3, 4, 1, 1, [150, 0, 0]); px(c, f, 4, 4, 1, 1, [150, 0, 0]); } }),
      P('abdomen', [10, 8, 12], [0, 8, -7], [-5, -3, -6], dk, { noise: 14, fx(c, R, rn) { blotch(c, R.top, br, rn, 2, 0.55); blotch(c, R.back, br, rn, 2, 0.6); px(c, R.top, 4, 2, 2, 8, [92, 40, 36]); } }),
    ];
    const zs = [2, 1, -1, -2];
    for (let i = 0; i < 4; i++) {
      parts.push(P('lR' + i, [14, 2, 2], [-3, 8, zs[i]], [-14, -1, -1], [34, 28, 28], { noise: 12, like: i ? 'lR0' : undefined, fx: i ? undefined : (c, R) => { for (const k of ['front', 'back', 'top', 'bottom']) for (let x = 3; x < R[k].w; x += 5) px(c, R[k], x, 0, 1, R[k].h, [64, 48, 44]); } }));
      parts.push(P('lL' + i, [14, 2, 2], [3, 8, zs[i]], [0, -1, -1], [34, 28, 28], { noise: 12, like: 'lR0' }));
    }
    return { W: 128, scale: 1, parts };
  },
  enderman() {
    const k = [24, 24, 26], eyeA = [236, 170, 255], eyeB = [176, 60, 226];
    return {
      W: 64, scale: 0.97,
      parts: [
        P('legR', [2, 28, 2], [-2, 28, 0], [-1, -28, -1], k, { noise: 6 }),
        P('legL', [2, 28, 2], [2, 28, 0], [-1, -28, -1], k, { noise: 6, like: 'legR' }),
        P('body', [8, 12, 4], [0, 28, 0], [-4, 0, -2], k, { noise: 6 }),
        P('armR', [2, 28, 2], [-5, 38, 0], [-1, -26, -1], k, { noise: 6 }),
        P('armL', [2, 28, 2], [5, 38, 0], [-1, -26, -1], k, { noise: 6, like: 'armR' }),
        P('head', [8, 8, 8], [0, 40, 0], [-4, 0, -4], k, { noise: 6, fx(c, R) { px(c, R.front, 0, 6, 8, 1, [8, 8, 8]); }, glow(c, R) { const f = R.front; for (const x of [0, 5]) { px(c, f, x, 4, 3, 1, eyeA); px(c, f, x, 5, 3, 1, eyeB); } } }),
      ],
    };
  },
  pigman() {
    const sk = [214, 146, 130];
    const ps = humanoid({
      skin: sk, shirt: [190, 120, 104], pants: [158, 98, 84],
      headFx(c, R) { const f = R.front; px(c, f, 1, 3, 2, 1, [250, 250, 250]); px(c, f, 5, 3, 2, 1, [250, 250, 250]); px(c, f, 2, 3, 1, 1, [150, 30, 30]); px(c, f, 5, 3, 1, 1, [150, 30, 30]); px(c, f, 2, 6, 4, 1, [120, 60, 60]); fillNoise(c, R.top, [150, 98, 90], 10, mulberry(5)); },
      bodyFx(c, R) { px(c, R.front, 0, 9, 8, 3, [96, 70, 50]); px(c, R.back, 0, 9, 8, 3, [96, 70, 50]); px(c, R.left, 0, 9, 4, 3, [96, 70, 50]); px(c, R.right, 0, 9, 4, 3, [96, 70, 50]); },
      armFx(c, R) { for (const k of ['front', 'back', 'left', 'right']) px(c, R[k], 0, 0, R[k].w, 3, [190, 120, 104]); },
      legFx(c, R) { for (const k of ['front', 'back', 'left', 'right']) px(c, R[k], 0, 10, R[k].w, 2, [96, 70, 50]); },
    });
    ps.push(P('snout', [4, 3, 1], [0, 0, 0], [-2, -1, 4], [226, 150, 140], { parent: 'head', noise: 6, fx(c, R) { px(c, R.front, 1, 1, 1, 1, [120, 56, 60]); px(c, R.front, 2, 1, 1, 1, [120, 56, 60]); } }));
    ps.push(P('sword', [1, 14, 2], [0, -8, 0], [0, -14, -1], [244, 214, 70], { parent: 'armR', noise: 8, fx(c, R) { px(c, R.front, 0, 11, 1, 3, [110, 80, 40]); px(c, R.left, 0, 11, 2, 3, [110, 80, 40]); } }));
    return { W: 64, scale: 0.975, parts: ps };
  },
  blaze() {
    const y = [244, 196, 56], o = [232, 130, 24];
    const rodFx = (c, R, rn) => { for (const k of ['front', 'back', 'left', 'right']) { for (let yy = 0; yy < R[k].h; yy += 2) px(c, R[k], 0, yy, R[k].w, 1, o); } };
    const parts = [P('head', [8, 8, 8], [0, 20, 0], [-4, 0, -4], y, { noise: 10, fx(c, R) { const f = R.front, d = [70, 40, 8]; px(c, f, 1, 3, 2, 1, d); px(c, f, 5, 3, 2, 1, d); px(c, f, 2, 5, 4, 2, d); px(c, f, 3, 6, 2, 1, [250, 220, 90]); } })];
    const rings = [[4, 9, 14], [4, 7, 8], [4, 5, 2]];
    rings.forEach(([n, r, yy], ri) => {
      parts.push(P('ring' + ri, null, [0, 0, 0], [0, 0, 0], y));
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + ri * 0.5;
        parts.push(P(`rod${ri}_${i}`, [2, 8, 2], [Math.cos(a) * r, yy, Math.sin(a) * r], [-1, 0, -1], y, { parent: 'ring' + ri, noise: 10, fx: (ri || i) ? undefined : rodFx, like: (ri || i) ? 'rod0_0' : undefined }));
      }
    });
    return { W: 64, scale: 1, parts, glowAll: true };
  },
  dragon() {
    const k = [26, 22, 30], pur = [60, 30, 84], red = [255, 40, 40];
    const parts = [
      P('body', [24, 24, 64], [0, 0, 0], [-12, -12, -32], k, { noise: 14, fx(c, R, rn) { for (const f of allFaces) blotch(c, R[f], [38, 28, 50], rn, 4, 0.55); px(c, R.top, 10, 0, 4, 64, [42, 30, 56]); } }),
    ];
    for (let i = 0; i < 5; i++) parts.push(P('neck' + i, [10, 10, 10], [0, 3 + i * 2, 34 + i * 9], [-5, -5, -5], k, { noise: 14, like: i ? 'neck0' : undefined, fx: i ? undefined : (c, R, rn) => { for (const f of allFaces) blotch(c, R[f], [42, 30, 56], rn, 3, 0.55); } }));
    parts.push(P('head', [16, 16, 12], [0, 12, 80], [-8, -8, -2], k, { noise: 14,
      fx(c, R, rn) { blotch(c, R.top, [44, 30, 58], rn, 3, 0.55); px(c, R.front, 4, 6, 8, 2, [20, 14, 24]); },
      glow(c, R) { for (const s of ['left', 'right']) { px(c, R[s], 2, 4, 3, 2, red); } } }));
    parts.push(P('snout', [12, 6, 14], [0, 0, 0], [-6, -3, 10], k, { parent: 'head', noise: 12, fx(c, R) { px(c, R.top, 2, 12, 2, 2, [14, 8, 18]); px(c, R.top, 8, 12, 2, 2, [14, 8, 18]); } }));
    parts.push(P('jaw', [12, 3, 14], [0, -3, 10], [-6, -3, 0], [34, 24, 40], { parent: 'head', noise: 12, fx(c, R) { for (let x = 1; x < 12; x += 3) px(c, R.top, x, 10, 1, 4, [210, 200, 210]); } }));
    parts.push(P('hornR', [2, 5, 2], [-6, 8, 4], [-1, 0, -1], [60, 50, 70], { parent: 'head', noise: 8 }));
    parts.push(P('hornL', [2, 5, 2], [6, 8, 4], [-1, 0, -1], [60, 50, 70], { parent: 'head', noise: 8, like: 'hornR' }));
    for (let i = 0; i < 12; i++) parts.push(P('tail' + i, [10, 10, 10], [0, 0, -36 - i * 9], [-5, -5, -5], k, { noise: 14, like: 'neck0' }));
    for (const s of [-1, 1]) {
      const nm = s < 0 ? 'R' : 'L';
      parts.push(P('wing' + nm, [56, 8, 8], [s * 12, 10, 8], [s < 0 ? -56 : 0, -4, -4], k, { noise: 12, like: s > 0 ? 'wingR' : undefined,
        fx: s < 0 ? (c, R, rn) => { for (const f of allFaces) blotch(c, R[f], [44, 30, 58], rn, 4, 0.55); } : undefined }));
      parts.push(P('wmem' + nm, [56, 1, 30], [0, 0, 0], [s < 0 ? -56 : 0, -1, -34], pur, { parent: 'wing' + nm, noise: 20, like: s > 0 ? 'wmemR' : undefined,
        fx: s < 0 ? (c, R, rn) => { for (const f of ['top', 'bottom']) blotch(c, R[f], [30, 14, 48], rn, 5, 0.5); } : undefined }));
      parts.push(P('wtip' + nm, [56, 4, 6], [s * 56, 0, 0], [s < 0 ? -56 : 0, -2, -3], k, { parent: 'wing' + nm, noise: 12, like: s > 0 ? 'wtipR' : undefined }));
      parts.push(P('wtmem' + nm, [56, 1, 26], [0, 0, 0], [s < 0 ? -56 : 0, -1, -29], pur, { parent: 'wtip' + nm, noise: 20, like: s > 0 ? 'wtmemR' : undefined }));
      parts.push(P('legF' + nm, [8, 20, 8], [s * 14, -8, 18], [-4, -20, -4], k, { noise: 12, like: s > 0 ? 'legFR' : undefined }));
      parts.push(P('legB' + nm, [10, 22, 10], [s * 14, -6, -22], [-5, -22, -5], k, { noise: 12, like: s > 0 ? 'legBR' : undefined }));
    }
    return { W: 256, scale: 1 / 1.0, parts, glowAll: false };
  },
};

// ---------------------------------------------------------------- Template-Bau (Geometrie + Canvas-Textur, pro Typ gecacht)
const TPL = {};
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
function makeCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return { width: w, height: h, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) };
}
function makeTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeBoxGeo(size, off, rect, W, H) {
  const [w, h, d] = size, g = new THREE.BoxGeometry(w, h, d);
  g.translate(off[0] + w / 2, off[1] + h / 2, off[2] + d / 2);
  const uv = g.attributes.uv, eps = 0.02;
  const faces = [rect.left, rect.right, rect.top, rect.bottom, rect.front, rect.back];
  const col = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) {
    const r = faces[f], u0 = (r.x + eps) / W, u1 = (r.x + r.w - eps) / W, v1 = 1 - (r.y + eps) / H, v0 = 1 - (r.y + r.h - eps) / H;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k; uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = FACE_SHADE[f];
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function getTemplate(type) {
  if (TPL[type]) return TPL[type];
  const spec = SPECS[type](), parts = spec.parts, W = spec.W;
  const byName = {};
  let cx = 0, cy = 0, rowH = 0;
  for (const p of parts) {
    byName[p.n] = p;
    if (!p.size) continue;
    const [w, h, d] = p.size;
    if (p.like && byName[p.like]) { p.u = byName[p.like].u; p.v = byName[p.like].v; continue; }
    const bw = 2 * (d + w), bh = d + h;
    if (cx + bw > W) { cx = 0; cy += rowH; rowH = 0; }
    p.u = cx; p.v = cy; cx += bw; rowH = Math.max(rowH, bh);
  }
  let H = 16; while (H < cy + rowH) H *= 2;
  const canvas = makeCanvas(W, H), ctx = canvas.getContext('2d');
  let glowCanvas = null, gctx = null;
  const anyGlow = spec.glowAll || parts.some((p) => p.glow);
  if (anyGlow) { glowCanvas = makeCanvas(W, H); gctx = glowCanvas.getContext('2d'); }
  const rn = mulberry(type.length * 7919 + type.charCodeAt(0));
  for (const p of parts) {
    if (!p.size) continue;
    const [w, h, d] = p.size, R = faceRects(p.u, p.v, w, h, d);
    p.rect = R;
    if (!(p.like && byName[p.like])) {
      for (const k of allFaces) fillNoise(ctx, R[k], p.base, p.noise, rn, k === 'top' ? 1.08 : k === 'bottom' ? 0.8 : 1);
      if (p.fx) p.fx(ctx, R, rn);
      if (p.glow && gctx) p.glow(gctx, R, rn);
      if (spec.glowAll && gctx) for (const k of allFaces) { gctx.fillStyle = 'rgb(255,255,255)'; gctx.fillRect(R[k].x, R[k].y, R[k].w, R[k].h); }
    }
    p.geo = makeBoxGeo(p.size, p.off, R, W, H);
  }
  const tpl = { parts, tex: makeTex(canvas), canvas, scale: spec.scale || 1, glowTex: null, glowAll: !!spec.glowAll, W, H };
  if (glowCanvas) { tpl.glowTex = makeTex(glowCanvas); tpl.glowCanvas = glowCanvas; }
  TPL[type] = tpl;
  return tpl;
}
let glowMatCache = {};
function instantiate(tpl, mat, type) {
  const root = new THREE.Group(), model = new THREE.Group();
  model.scale.setScalar(S16 * tpl.scale); root.add(model);
  const parts = {};
  let glowMat = null;
  if (tpl.glowTex) {
    glowMat = glowMatCache[type] || (glowMatCache[type] = new THREE.MeshBasicMaterial({ map: tpl.glowTex, transparent: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }
  for (const p of tpl.parts) {
    const g = new THREE.Group(); g.position.set(p.pivot[0], p.pivot[1], p.pivot[2]); g.rotation.order = 'YXZ';
    g.userData.base = g.position.clone();
    if (p.geo) {
      const m = new THREE.Mesh(p.geo, mat); m.frustumCulled = false; g.add(m);
      if (glowMat && (p.glow || tpl.glowAll)) { const m2 = new THREE.Mesh(p.geo, glowMat); m2.frustumCulled = false; g.add(m2); }
    }
    (p.parent ? parts[p.parent] : model).add(g);
    parts[p.n] = g;
  }
  return { root, model, parts };
}

// ---------------------------------------------------------------- Hilfsfunktionen
const _v = new THREE.Vector3();
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.min.x, b.min.y, b.min.z], mx = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; }
    else { let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i]; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return -1; }
  }
  return tmin;
}

const LOOT = {
  zombie: [[I.ROTTEN_FLESH, 0, 2, 1], [I.IRON_INGOT, 1, 1, 0.025]],
  skeleton: [[I.BONE, 0, 2, 1], [I.ARROW, 0, 2, 1]],
  creeper: [[I.GUNPOWDER, 0, 2, 1]],
  spider: [[I.STRING, 0, 2, 1]],
  pig: [[I.RAW_PORKCHOP, 1, 3, 1]],
  cow: [[I.RAW_BEEF, 1, 3, 1], [I.LEATHER, 0, 2, 1]],
  chicken: [[I.FEATHER, 0, 2, 1]],
  sheep: [[B.WOOL, 1, 1, 1]],
  blaze: [[I.BLAZE_ROD, 1, 1, 0.6]],
  enderman: [[I.ENDER_PEARL, 1, 1, 0.8]],
  pigman: [[I.ROTTEN_FLESH, 0, 1, 1], [I.GOLD_INGOT, 1, 1, 0.22]],
};

// ================================================================= Mob
export class Mob {
  constructor(mgr, type, x, y, z) {
    this.mgr = mgr; this.game = mgr.game; this.type = type;
    const def = this.def = MOB_DEFS[type];
    this.isMob = true; this.persist = false;
    this.pos = new THREE.Vector3(x, y, z); this.vel = new THREE.Vector3();
    this.yaw = Math.random() * TAU; this.desiredYaw = this.yaw;
    this.health = this.maxHealth = def.hp;
    this.dead = false; this.deadT = 0; this.hurtT = 0; this.invulnT = 0; this.lastDmg = 0;
    this.onGround = false; this.moveX = 0; this.moveZ = 0; this.moveSpeed = 0; this.moveY = 0;
    this.walkPhase = Math.random() * 10; this.walkAmt = 0; this.attackT = 0; this.attackCd = 0.5; this.burn = 0; this.age = 0;
    this.wT = rand(0.5, 3); this.wMoving = false; this.wd = [0, 1];
    this.fleeT = 0; this.angry = 0; this.provoked = 0; this.avoidT = 0; this.avoidSide = 1;
    this.sightT = rand(0, 0.5); this.vis = false; this.lightT = 0; this.bright = 1; this.flash = false;
    this.fuse = 0; this.fusing = false; this.shootCd = rand(1, 2.5); this.aimT = 0; this.strafeSide = 1; this.strafeT = 0;
    this.leapCd = 0; this.teleCd = rand(2, 6); this.fireCd = rand(2, 4); this.fireBurst = 0; this.hoverY = 0;
    this._box = new THREE.Box3(); this.pi = { hd: 99, dy: 0, dist: 99, dx: 0, dz: 0 };
    this._buildModel();
  }
  _buildModel() {
    const tpl = getTemplate(this.type);
    this.tpl = tpl;
    this.mat = new THREE.MeshBasicMaterial({ map: tpl.tex, vertexColors: true });
    const inst = instantiate(tpl, this.mat, this.type);
    this.group = inst.root; this.model = inst.model; this.parts = inst.parts; this.mesh = this.group;
    this.mgr.scene?.add(this.group);
    this._syncGroup();
  }
  get world() { return this.mgr.world; }
  get aabb() {
    const hw = this.def.w / 2, h = this.def.h, p = this.pos, y0 = this.def.centerOrigin ? p.y - h / 2 : p.y;
    return this._box.set(_v.set(p.x - hw, y0, p.z - hw).clone(), _v.set(p.x + hw, y0 + h, p.z + hw).clone());
  }
  hitBoxes() { return [this.aabb]; }
  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.def.h * 0.85, this.pos.z); }
  _syncGroup() { this.group.position.copy(this.pos); this.group.rotation.y = this.yaw; }

  // ---------------- Kollision
  collides(x, y, z) {
    const w = this.world, hw = this.def.w / 2 - 0.001, h = this.def.h, e = 1e-3;
    const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw), z0 = Math.floor(z - hw), z1 = Math.floor(z + hw), y0 = Math.floor(y + e), y1 = Math.floor(y + h - e);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) if (w.isSolid(ix, iy, iz)) return true;
    return false;
  }
  chunkOK() { const w = this.world; return !w.getChunk || !!w.getChunk(Math.floor(this.pos.x / 16), Math.floor(this.pos.z / 16)); }
  inLiquid(off = 0.4) { const p = this.pos; return !!this.world.isLiquid(Math.floor(p.x), Math.floor(p.y + off), Math.floor(p.z)); }
  inLava() { const p = this.pos; return this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z)) === B.LAVA; }
  unsafeAhead(dx, dz) {
    const w = this.world, hw = this.def.w / 2, p = this.pos, ax = Math.floor(p.x + dx * (hw + 0.5)), az = Math.floor(p.z + dz * (hw + 0.5)), fy = Math.floor(p.y + 0.05);
    if (w.isSolid(ax, fy, az)) return false;
    for (let yy = fy; yy >= fy - 3; yy--) {
      if (w.isSolid(ax, yy, az)) return false;
      const id = w.getBlock(ax, yy, az);
      if (id === B.LAVA) return true;
      if (w.isLiquid(ax, yy, az)) return !(this.type === 'zombie' || this.def.kind === 'passive') ? true : yy < fy - 1;
    }
    return true;
  }
  physics(dt) {
    if (!this.chunkOK()) { this.vel.set(0, 0, 0); return; }
    const def = this.def, v = this.vel, p = this.pos, h = def.h;
    const inW = !this.flying && this.inLiquid();
    let tx = this.moveX * this.moveSpeed, tz = this.moveZ * this.moveSpeed;
    if (this.onGround && !this.flying && !inW && (tx || tz)) {
      const l = Math.hypot(tx, tz);
      if (this.unsafeAhead(tx / l, tz / l)) { tx = tz = 0; this.avoidT = 0.7; this.avoidSide = Math.random() < 0.5 ? -1 : 1; }
    }
    const k = Math.min(1, (this.onGround ? 10 : (this.flying ? 4 : 2)) * dt);
    v.x += (tx - v.x) * k; v.z += (tz - v.z) * k;
    if (this.flying) { v.y += (this.moveY - v.y) * Math.min(1, 3 * dt); }
    else if (inW) { v.y += (2.2 - v.y) * Math.min(1, 4 * dt); v.x *= 1 - 0.5 * dt; v.z *= 1 - 0.5 * dt; }
    else { v.y -= 32 * dt; if (v.y < -50) v.y = -50; }
    if (this.inLava() && !this.flying) { v.y = Math.max(v.y, 1.5); this.burn = Math.max(this.burn, 6); if (!this.dead) this.lavaHurt = (this.lavaHurt || 0) + dt; }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt / 0.4)), sdt = dt / steps;
    let bx = false, bz = false; this.onGround = false;
    for (let s = 0; s < steps; s++) {
      let ny = p.y + v.y * sdt;
      if (this.collides(p.x, ny, p.z)) {
        if (v.y < 0) { const sy = Math.floor(ny) + 1; if (!this.collides(p.x, sy, p.z)) { p.y = sy; this.onGround = true; } }
        else { const sy = Math.floor(ny + h) - h - 0.001; if (!this.collides(p.x, sy, p.z)) p.y = sy; }
        v.y = 0;
      } else p.y = ny;
      const nx = p.x + v.x * sdt;
      if (this.collides(nx, p.y, p.z)) { bx = true; v.x = 0; } else p.x = nx;
      const nz = p.z + v.z * sdt;
      if (this.collides(p.x, p.y, nz)) { bz = true; v.z = 0; } else p.z = nz;
    }
    if (this.onGround && (bx || bz) && (this.moveX || this.moveZ) && !this.flying) {
      const dx = Math.sign(this.moveX) * 0.6, dz = Math.sign(this.moveZ) * 0.6;
      if (!this.collides(p.x + dx * (bx ? 1 : 0), p.y + 1.1, p.z + dz * (bz ? 1 : 0))) { v.y = 8.8; this.onGround = false; }
      else { this.avoidT = 0.8; this.avoidSide = Math.random() < 0.5 ? -1 : 1; }
    } else if ((bx || bz) && this.flying) { this.avoidT = 0.6; this.avoidSide = Math.random() < 0.5 ? -1 : 1; }
    if (inW && (bx || bz)) v.y = Math.max(v.y, 5);
  }

  // ---------------- Spieler-Infos
  updateInfo(dt) {
    const m = this.mgr, pp = m.playerPos(), i = this.pi;
    i.dx = pp.x - this.pos.x; i.dz = pp.z - this.pos.z; i.dy = pp.y - this.pos.y;
    i.hd = Math.hypot(i.dx, i.dz); i.dist = Math.hypot(i.hd, i.dy);
    this.sightT -= dt;
    if (this.sightT <= 0) {
      this.sightT = 0.4 + Math.random() * 0.2;
      this.vis = false;
      if (m.playerTargetable() && i.dist < 40) {
        const e = this.eyePos, pe = m.playerEye(), dx = pe.x - e.x, dy = pe.y - e.y, dz = pe.z - e.z, l = Math.hypot(dx, dy, dz) || 1;
        const hit = this.world.raycast?.(e.x, e.y, e.z, dx / l, dy / l, dz / l, Math.max(0.1, l - 0.4));
        this.vis = !hit;
      }
    }
  }
  steer(dx, dz) {
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (this.avoidT > 0) { const a = this.avoidSide * 1.15, c = Math.cos(a), s = Math.sin(a); const rx = dx * c - dz * s, rz = dx * s + dz * c; dx = rx; dz = rz; }
    this.moveX = dx; this.moveZ = dz;
  }
  stop() { this.moveX = this.moveZ = 0; this.moveSpeed = 0; }
  wander(dt, f = 1) {
    this.wT -= dt;
    if (this.wT <= 0) {
      if (this.wMoving || Math.random() < 0.45) { this.wMoving = false; this.wT = rand(1.5, 4.5); }
      else { this.wMoving = true; const a = Math.random() * TAU; this.wd = [Math.sin(a), Math.cos(a)]; this.wT = rand(1.5, 4); }
    }
    if (this.wMoving) { this.steer(this.wd[0], this.wd[1]); this.moveSpeed = this.def.speed * 0.55 * f; this.desiredYaw = Math.atan2(this.moveX, this.moveZ); }
    else this.stop();
  }
  chaseTo(tx, tz, speedMul = 1) {
    this.steer(tx, tz); this.moveSpeed = this.def.speed * speedMul;
    this.desiredYaw = Math.atan2(tx, tz);
  }
  faceTo(dx, dz) { this.desiredYaw = Math.atan2(dx, dz); }
  meleeAttack(dmg, reach = 1.5) {
    const i = this.pi;
    if (this.attackCd <= 0 && i.hd < reach && Math.abs(i.dy) < 1.9) {
      this.attackCd = 1.0; this.attackT = 0.35;
      this.mgr.damagePlayer(dmg, this.pos);
      return true;
    }
    return false;
  }
  isDaylit() {
    if (this.mgr.dim !== 'overworld') return false;
    const f = dayFactor(this.mgr.timeOfDay);
    if (f < 0.8) return false;
    const p = this.pos, w = this.world;
    return (w.getSky?.(Math.floor(p.x), Math.floor(p.y + this.def.h), Math.floor(p.z)) ?? 0) >= 14 && !this.inLiquid();
  }

  // ---------------- KI
  think(dt) {
    const i = this.pi, m = this.mgr, targ = m.playerTargetable();
    this.attackCd -= dt; this.attackT = Math.max(0, this.attackT - dt); this.avoidT = Math.max(0, this.avoidT - dt);
    switch (this.type) {
      case 'zombie': case 'pigman': {
        const pig = this.type === 'pigman';
        this.angry = Math.max(0, this.angry - dt);
        const chase = targ && (pig ? this.angry > 0 : (i.hd < 32 && (this.vis || i.hd < 9)));
        if (chase) { this.chaseTo(i.dx, i.dz, pig ? 1.25 : 1); this.meleeAttack(pig ? 5 : 3); }
        else this.wander(dt);
        break;
      }
      case 'skeleton': {
        const chase = targ && i.hd < 22 && (this.vis || i.hd < 8);
        this.aimT = Math.max(0, this.aimT - dt);
        if (chase) {
          this.faceTo(i.dx, i.dz); this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeT = rand(1.2, 3); this.strafeSide = Math.random() < 0.5 ? -1 : 1; }
          const nx = i.dx / (i.hd || 1), nz = i.dz / (i.hd || 1);
          if (i.hd < 5) { this.steer(-nx, -nz); this.moveSpeed = this.def.speed * 0.9; }
          else if (i.hd > 11) { this.steer(nx, nz); this.moveSpeed = this.def.speed; }
          else { this.steer(-nz * this.strafeSide, nx * this.strafeSide); this.moveSpeed = this.def.speed * 0.6; }
          this.desiredYaw = Math.atan2(i.dx, i.dz);
          this.shootCd -= dt;
          if (this.shootCd <= 0 && this.vis && i.hd < 20) {
            this.shootCd = rand(1.4, 2.4); this.aimT = 0.5;
            const e = this.eyePos, pe = m.playerEye(); pe.y -= 0.25;
            const dx = pe.x - e.x, dy = pe.y - e.y, dz = pe.z - e.z, l = Math.hypot(dx, dy, dz) || 1;
            const lift = 0.025 * l; // Fall kompensieren
            m.shootArrow(e.x + dx / l * 0.5, e.y + dy / l * 0.5, e.z + dz / l * 0.5, dx / l + rand(-0.04, 0.04), dy / l + lift / l * 2 + rand(-0.03, 0.03), dz / l + rand(-0.04, 0.04), 26, { owner: 'mob', damage: rand(2, 4.5), source: this });
            m.audio('shoot');
          }
        } else this.wander(dt);
        break;
      }
      case 'creeper': {
        const near = targ && (this.vis || i.hd < 8) && i.hd < 20;
        if (this.fusing) {
          this.fuse += dt; this.stop(); this.faceTo(i.dx, i.dz);
          if (!targ || i.hd > 7.5 || this.fuse < 0) { this.fusing = false; this.fuse = Math.max(0, this.fuse - 0.2); }
          else if (this.fuse >= 1.5) { this.explodeSelf(); return; }
        } else {
          this.fuse = Math.max(0, this.fuse - dt * 1.5);
          if (near) { this.chaseTo(i.dx, i.dz); if (i.hd < 3 && Math.abs(i.dy) < 2) { this.fusing = true; m.audio('fuse'); } }
          else this.wander(dt);
        }
        break;
      }
      case 'spider': {
        this.provoked = Math.max(0, this.provoked - dt); this.leapCd -= dt;
        const aggr = targ && (this.provoked > 0 || !this.isDaylit()) && i.hd < 24 && (this.vis || i.hd < 8);
        if (aggr) {
          this.chaseTo(i.dx, i.dz);
          if (this.onGround && this.leapCd <= 0 && i.hd > 2.2 && i.hd < 4.5 && this.vis) {
            this.leapCd = 1.4; const n = 1 / (i.hd || 1); this.vel.set(i.dx * n * 7, 6, i.dz * n * 7);
          }
          this.meleeAttack(2, 1.7);
        } else this.wander(dt);
        break;
      }
      case 'enderman': {
        this.provoked = Math.max(0, this.provoked - dt); this.teleCd -= dt;
        if (targ && !this.angry && i.dist < 48 && this.beingStaredAt()) this.angry = 1;
        if (this.angry && targ) {
          this.chaseTo(i.dx, i.dz); this.meleeAttack(4.5, 1.7);
          if (this.teleCd <= 0 && i.hd > 6) { this.teleCd = rand(4, 8); this.teleportNear(i.hd > 12); }
        } else {
          if (!targ) this.angry = 0;
          this.wander(dt, 0.8);
          if (this.teleCd <= 0) { this.teleCd = rand(10, 30); if (Math.random() < 0.4) this.teleportRandom(); }
        }
        break;
      }
      case 'blaze': {
        const chase = targ && i.hd < 32;
        const pp = m.playerPos(); this.hoverY = pp.y + 2.4 + Math.sin(this.age * 0.8) * 1.2;
        this.moveY = clamp((this.hoverY - this.pos.y) * 1.4, -3, 3);
        if (chase) {
          this.faceTo(i.dx, i.dz); const nx = i.dx / (i.hd || 1), nz = i.dz / (i.hd || 1);
          if (i.hd > 11) { this.steer(nx, nz); this.moveSpeed = this.def.speed; }
          else if (i.hd < 5) { this.steer(-nx, -nz); this.moveSpeed = this.def.speed; }
          else { this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(1.5, 3); this.strafeSide = -this.strafeSide || 1; } this.steer(-nz * this.strafeSide, nx * this.strafeSide); this.moveSpeed = this.def.speed * 0.5; }
          this.desiredYaw = Math.atan2(i.dx, i.dz);
          this.fireCd -= dt;
          if (this.fireBurst > 0) {
            this.fireT = (this.fireT || 0) - dt;
            if (this.fireT <= 0 && this.vis) { this.fireT = 0.3; this.fireBurst--; this.shootFire(); }
          } else if (this.fireCd <= 0 && this.vis) { this.fireCd = rand(3, 4.5); this.fireBurst = 3; this.fireT = 0; }
        } else { this.stop(); this.moveY *= 0.5; }
        break;
      }
      default: { // passive
        if (this.fleeT > 0) {
          this.fleeT -= dt; const pp = m.playerPos();
          this.chaseTo(this.pos.x - pp.x, this.pos.z - pp.z, 1.9);
        } else this.wander(dt);
      }
    }
  }
  shootFire() {
    const m = this.mgr, i = this.pi, e = this.eyePos, pe = m.playerEye();
    const dx = pe.x - e.x, dy = pe.y - e.y - 0.3, dz = pe.z - e.z, l = Math.hypot(dx, dy, dz) || 1;
    m.shootFireball(e.x, e.y, e.z, dx / l + rand(-0.04, 0.04), dy / l + rand(-0.03, 0.03), dz / l + rand(-0.04, 0.04), 16, { damage: 5, fire: true });
    m.audio('fireball'); this.attackT = 0.3;
  }
  beingStaredAt() {
    const cam = this.game.renderer?.camera; if (!cam) return false;
    const head = this.eyePos; cam.getWorldPosition(_v); const cp = _v.clone();
    const to = new THREE.Vector3(head.x - cp.x, head.y - cp.y, head.z - cp.z), l = to.length(); if (l < 0.01) return false; to.divideScalar(l);
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    if (dir.dot(to) < 0.975) return false;
    return !this.world.raycast?.(cp.x, cp.y, cp.z, to.x, to.y, to.z, Math.max(0.1, l - 0.5));
  }
  standableAt(x, y, z) {
    const w = this.world;
    return !w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z) && !w.isSolid(x, y + 2, z) && !w.isLiquid(x, y, z) && w.isSolid(x, y - 1, z) && !w.isLiquid(x, y - 1, z);
  }
  teleportTo(x, z, y0) {
    const w = this.world;
    for (let dy = 12; dy >= -16; dy--) {
      const y = Math.floor(y0) + dy;
      if (y < 1 || y > 126) continue;
      if (this.standableAt(Math.floor(x), y, Math.floor(z))) {
        const r = this.mgr.game.renderer;
        r?.addParticles?.('portal', this.pos.x, this.pos.y + 1, this.pos.z, 0, 20);
        this.pos.set(Math.floor(x) + 0.5, y, Math.floor(z) + 0.5); this.vel.set(0, 0, 0);
        r?.addParticles?.('portal', this.pos.x, this.pos.y + 1, this.pos.z, 0, 20);
        this.mgr.audio('teleport'); return true;
      }
    }
    return false;
  }
  teleportRandom() { for (let k = 0; k < 8; k++) { const a = Math.random() * TAU, d = rand(6, 22); if (this.teleportTo(this.pos.x + Math.cos(a) * d, this.pos.z + Math.sin(a) * d, this.pos.y)) return true; } return false; }
  teleportNear(far) {
    const pp = this.mgr.playerPos();
    for (let k = 0; k < 8; k++) { const a = Math.random() * TAU, d = far ? rand(3, 5) : rand(6, 12); if (this.teleportTo(pp.x + Math.cos(a) * d, pp.z + Math.sin(a) * d, pp.y)) return true; }
    return false;
  }
  explodeSelf() {
    this.dead = true; this.noLoot = true;
    this.mgr.explode(this.pos.x, this.pos.y + 0.8, this.pos.z, 3, { source: this });
    this.mgr.removeMob(this);
  }

  // ---------------- Schaden / Tod
  hurt(amount, kb) {
    if (this.dead) return false;
    if (this.invulnT > 0 && amount <= this.lastDmg) return false;
    this.lastDmg = amount; this.invulnT = 0.45; this.hurtT = 0.45;
    this.health -= amount;
    const m = this.mgr, pp = m.playerPos();
    let kx = 0, kz = 0;
    if (kb) { kx = kb.x ?? kb[0] ?? 0; kz = kb.z ?? kb[2] ?? 0; const l = Math.hypot(kx, kz); if (l > 1e-4) { kx /= l; kz /= l; } else kx = kz = 0; }
    if (!kb) { kx = this.pos.x - pp.x; kz = this.pos.z - pp.z; const l = Math.hypot(kx, kz) || 1; kx /= l; kz /= l; }
    if (!this.flying || this.type === 'blaze') { this.vel.x += kx * 6.5; this.vel.z += kz * 6.5; if (this.type !== 'blaze') this.vel.y = Math.max(this.vel.y, 5.2); this.onGround = false; }
    const k = this.def.kind;
    if (k === 'passive') this.fleeT = rand(3, 5);
    if (this.type === 'pigman') { this.angry = 25; m.angerPigmen(this); }
    if (this.type === 'spider') this.provoked = 20;
    if (this.type === 'enderman') { this.angry = 1; this.provoked = 20; if (Math.random() < 0.55) this.teleCd = 0.15; }
    if (this.type === 'zombie' || this.type === 'skeleton' || this.type === 'creeper') { /* zielen sofort */ this.vis = true; }
    m.audio(this.health <= 0 ? 'death' : 'hurt');
    if (this.health <= 0) this.die();
    return true;
  }
  die() {
    if (this.dead && this.deadT > 0) return;
    this.dead = true; this.deadT = 0.0001; this.health = Math.min(this.health, 0);
    this.stop(); this.fusing = false;
    const m = this.mgr, def = this.def;
    if (!this.noLoot) {
      const tab = LOOT[this.type] || [];
      for (const [id0, a, b, ch] of tab) {
        if (Math.random() > ch) continue;
        let id = id0;
        if (this.burn > 0) { if (id === I.RAW_PORKCHOP) id = I.COOKED_PORKCHOP; else if (id === I.RAW_BEEF) id = I.STEAK; }
        const n = a + Math.floor(Math.random() * (b - a + 1));
        if (n > 0) m.addItem(id, n, this.pos.x, this.pos.y + def.h * 0.6, this.pos.z);
      }
      m.giveXP(def.xp);
    }
  }
  setFire(t) { if (this.type === 'blaze') return; this.burn = Math.max(this.burn, t); }

  // ---------------- Update / Animation
  update(dt) {
    this.age += dt;
    if (this.dead) {
      this.deadT += dt;
      this.vel.x *= 0.9; this.vel.z *= 0.9; this.moveX = this.moveZ = 0; this.moveSpeed = 0; this.moveY = 0;
      this.physics(dt);
      this.hurtT = 1; this._anim(dt); this._applyColor();
      const k = clamp(this.deadT / 0.25, 0, 1); this.group.rotation.z = k * Math.PI / 2;
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      if (this.deadT > 1) this.mgr.removeMob(this);
      return;
    }
    this.hurtT = Math.max(0, this.hurtT - dt); this.invulnT = Math.max(0, this.invulnT - dt);
    if (!this.chunkOK()) { this._syncGroup(); return; }
    this.updateInfo(dt);
    this.think(dt);
    if (this.dead) return;
    this.yaw = lerpAngle(this.yaw, this.desiredYaw, 8 * dt);
    this.physics(dt);
    // Feuer
    if (this.def.burnDay && this.isDaylit()) this.burn = Math.max(this.burn, 5);
    if (this.burn > 0) {
      if (this.inLiquid(0.5)) this.burn = 0;
      else {
        this.burn -= dt; this.burnT = (this.burnT || 0) + dt;
        if (this.burnT >= 1) { this.burnT = 0; this.hurt(1, null); this.invulnT = 0; }
        if (Math.random() < dt * 8) this.mgr.game.renderer?.addParticles?.('flame', this.pos.x + rand(-0.3, 0.3), this.pos.y + rand(0, this.def.h), this.pos.z + rand(-0.3, 0.3), 0, 1);
      }
    }
    if (this.lavaHurt > 0.5) { this.lavaHurt = 0; this.hurt(4, null); this.invulnT = 0; }
    this._anim(dt);
    this.lightT -= dt; if (this.lightT <= 0) { this.lightT = 0.3; this.bright = this.mgr.brightnessAt(this.pos.x, this.pos.y + this.def.h * 0.5, this.pos.z, this.tpl.glowAll); }
    if (this.fusing) { const f = this.fuse / 1.5; this.flash = Math.floor(this.fuse * 8) % 2 === 0; const s = 1 + Math.sin(f * Math.PI / 2 * 1.0) * 0.28 + (f > 0.2 ? 0.0 : 0); this.model.scale.set(S16 * (1 + f * 0.25) * (1 + Math.sin(this.age * 40) * 0.02 * f), S16 * (1 + f * 0.35), S16 * (1 + f * 0.25)); }
    else { this.flash = false; if (this.type === 'creeper') this.model.scale.setScalar(S16); }
    this._applyColor();
    this._syncGroup();
    // Despawn
    const i = this.pi;
    if (!this.persist) {
      if (i.dist > 110) this.mgr.removeMob(this);
      else if (i.dist > 48 && this.def.kind !== 'passive' && Math.random() < dt * 0.03) this.mgr.removeMob(this);
    }
  }
  _applyColor() {
    const b = this.bright, c = this.mat.color;
    if (this.flash) { c.setRGB(2, 2, 2); return; }
    let r = b, g = b, bl = b;
    if (this.burn > 0 && !this.dead) { g *= 0.8; bl *= 0.55; }
    const h = clamp(this.hurtT / 0.45, 0, 1);
    if (h > 0) { g *= 1 - 0.7 * h; bl *= 1 - 0.7 * h; r = Math.min(1, r * (1 + 0.5 * h) + 0.25 * h); }
    c.setRGB(r, g, bl);
  }
  _anim(dt) {
    const p = this.parts, v = this.vel, sp = Math.hypot(v.x, v.z);
    this.walkAmt += (clamp(sp / 3, 0, 1) - this.walkAmt) * Math.min(1, 10 * dt);
    this.walkPhase += sp * dt * (this.def.kind === 'passive' ? 4.5 : 3.2);
    const sw = Math.sin(this.walkPhase) * this.walkAmt;
    const t = this.age;
    // Kopf zum Spieler
    const head = p.head;
    if (head && !this.dead) {
      const i = this.pi, near = i.dist < (this.def.kind === 'passive' ? 7 : 20) && this.mgr.playerAlive();
      let ty = 0, tp = 0;
      if (near) { ty = clamp(wrapAngle(Math.atan2(i.dx, i.dz) - this.yaw), -1.0, 1.0); tp = clamp(Math.atan2(i.dy + 1.5 - this.def.h * 0.85, Math.max(0.5, i.hd)), -0.6, 0.6); }
      else ty = Math.sin(t * 0.7 + this.walkPhase * 0.0) * 0.12;
      head.rotation.y += (ty - head.rotation.y) * Math.min(1, 8 * dt);
      head.rotation.x += (-tp - head.rotation.x) * Math.min(1, 8 * dt);
    }
    const atk = this.attackT > 0 ? Math.sin(this.attackT / 0.35 * Math.PI) : 0;
    switch (this.type) {
      case 'zombie': case 'pigman': {
        p.legR.rotation.x = sw * 0.95; p.legL.rotation.x = -sw * 0.95;
        const base = -1.5 + Math.sin(t * 1.4) * 0.05;
        p.armR.rotation.x = base + sw * 0.18 - atk * 0.7; p.armL.rotation.x = base - sw * 0.18 - atk * 0.7;
        p.armR.rotation.z = 0.04 + Math.sin(t * 1.1) * 0.03; p.armL.rotation.z = -0.04;
        break;
      }
      case 'skeleton': {
        p.legR.rotation.x = sw * 0.95; p.legL.rotation.x = -sw * 0.95;
        const up = this.aimT > 0 || (this.vis && this.pi.hd < 22 && this.mgr.playerTargetable());
        const ar = up ? -1.45 : sw * 0.7, al = up ? -1.45 : -sw * 0.7;
        p.armR.rotation.x += (ar - p.armR.rotation.x) * Math.min(1, 12 * dt); p.armL.rotation.x += (al - p.armL.rotation.x) * Math.min(1, 12 * dt);
        if (up) { p.armR.rotation.y = -0.1; p.armL.rotation.y = 0.35; } else { p.armR.rotation.y = 0; p.armL.rotation.y = 0; }
        break;
      }
      case 'enderman': {
        p.legR.rotation.x = sw * 0.8; p.legL.rotation.x = -sw * 0.8;
        p.armR.rotation.x = -sw * 0.9 - atk * 0.8 + (this.angry ? -0.5 : 0); p.armL.rotation.x = sw * 0.9 - atk * 0.8 + (this.angry ? -0.5 : 0);
        if (this.angry) { p.head.rotation.x -= 0.15; }
        break;
      }
      case 'creeper': case 'pig': case 'cow': case 'sheep': {
        const a = sw * 1.0;
        p.legFR.rotation.x = a; p.legBL.rotation.x = a; p.legFL.rotation.x = -a; p.legBR.rotation.x = -a;
        break;
      }
      case 'chicken': {
        p.legR.rotation.x = sw * 1.0; p.legL.rotation.x = -sw * 1.0;
        const fl = !this.onGround ? Math.sin(t * 40) * 0.9 + 0.8 : 0;
        p.wingR.rotation.z = fl; p.wingL.rotation.z = -fl;
        if (!this.onGround && this.vel.y < 0 && !this.dead) this.vel.y = Math.max(this.vel.y, -3);
        break;
      }
      case 'spider': {
        const zs = [0.8, 0.4, -0.4, -0.8];
        for (let k = 0; k < 4; k++) {
          const ph = this.walkPhase * 1.0 + k * 1.6, a = Math.sin(ph) * 0.45 * this.walkAmt, b = Math.max(0, Math.cos(ph)) * 0.28 * this.walkAmt;
          p['lR' + k].rotation.y = zs[k] + a; p['lL' + k].rotation.y = -zs[k] + a * 1;
          p['lR' + k].rotation.z = 0.6 - b; p['lL' + k].rotation.z = -0.6 + b;
        }
        p.abdomen.position.y = 8 + Math.sin(t * 2) * 0.2;
        break;
      }
      case 'blaze': {
        for (let r = 0; r < 3; r++) {
          const g = p['ring' + r]; g.rotation.y = t * (2.2 - r * 0.5) * (r % 2 ? -1 : 1);
          g.children.forEach((c, k) => { c.position.y = g.userData.base.y + 0 + Math.sin(t * 2 + k + r) * 0.0; });
        }
        p.ring0.position.y = Math.sin(t * 2.0) * 1.0; p.ring1.position.y = Math.sin(t * 2.3 + 1) * 1.0; p.ring2.position.y = Math.sin(t * 2.6 + 2) * 1.0;
        break;
      }
    }
  }
  dispose() {
    this.mgr.scene?.remove(this.group);
    this.mat.dispose();
  }
}

// ================================================================= End Crystal
let crystalAssets = null;
function getCrystalAssets() {
  if (crystalAssets) return crystalAssets;
  const c = makeCanvas(16, 16), g = c.getContext('2d');
  g.fillStyle = 'rgba(230,120,255,0.38)'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = 'rgba(255,200,255,0.95)'; g.fillRect(0, 0, 16, 2); g.fillRect(0, 14, 16, 2); g.fillRect(0, 0, 2, 16); g.fillRect(14, 0, 2, 16);
  g.fillStyle = 'rgba(255,150,255,0.8)'; g.fillRect(7, 2, 2, 12); g.fillRect(2, 7, 12, 2);
  const tex = makeTex(c);
  const outer = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const inner = new THREE.MeshBasicMaterial({ color: 0xff77ff });
  const beam = new THREE.MeshBasicMaterial({ color: 0xff66ff, transparent: true, opacity: 0.75, depthWrite: false });
  crystalAssets = { outer, inner, beam, gOuter: new THREE.BoxGeometry(1.2, 1.2, 1.2), gInner: new THREE.BoxGeometry(0.62, 0.62, 0.62), gBeam: new THREE.BoxGeometry(0.2, 0.2, 1) };
  return crystalAssets;
}
export class Crystal extends Mob {
  constructor(mgr, x, y, z) {
    // kein Template (eigenes Modell)
    const keep = getTemplate; // eslint-disable-line
    super(mgr, 'crystal', x, y, z);
  }
  _buildModel() {
    const A = getCrystalAssets();
    this.tpl = { glowAll: true };
    this.mat = { color: new THREE.Color(), dispose() {} };
    this.group = new THREE.Group(); this.parts = {}; this.mesh = this.group;
    this.outerM = new THREE.Mesh(A.gOuter, A.outer); this.innerM = new THREE.Mesh(A.gInner, A.inner);
    this.pivot = new THREE.Group(); this.pivot.add(this.outerM, this.innerM); this.pivot.position.y = 1;
    this.group.add(this.pivot);
    this.beam = new THREE.Mesh(A.gBeam, A.beam); this.beam.visible = false; this.beam.frustumCulled = false;
    this.mgr.scene?.add(this.group); this.mgr.scene?.add(this.beam);
    this.persist = true; this.flying = true; this.noLoot = true;
    this._syncGroup();
  }
  hurt(amount) {
    if (this.dead) return false;
    this.health = 0; this.dead = true;
    this.mgr.removeMob(this);
    this.mgr.explode(this.pos.x, this.pos.y + 1, this.pos.z, 6, { fire: true, source: this });
    const d = this.mgr.dragon;
    if (d && !d.dead && d.pos.distanceTo(this.pos) < 14) d.hurt(10, null, true);
    return true;
  }
  update(dt) {
    this.age += dt;
    const t = this.age;
    this.pivot.rotation.y = t * 1.6; this.outerM.rotation.set(0.6, t * -0.8, 0.6); this.innerM.rotation.set(t * 0.7, t * 1.1, 0);
    this.pivot.position.y = 1.0 + Math.sin(t * 1.8) * 0.18;
    this.group.position.copy(this.pos);
    const d = this.mgr.dragon;
    if (d && !d.dead && !d.dying) {
      // nur der naechste Kristall zeigt den Strahl
      let best = null, bd = 1e9;
      for (const c of this.mgr.crystals) { const dd = c.pos.distanceToSquared(d.pos); if (dd < bd) { bd = dd; best = c; } }
      if (best === this && bd < 120 * 120) {
        const a = _v.set(this.pos.x, this.pos.y + 1.2, this.pos.z), b = d.beamTarget();
        const len = a.distanceTo(b);
        this.beam.visible = true; this.beam.position.copy(a).lerp(b, 0.5); this.beam.scale.set(1, 1, len); this.beam.lookAt(b);
      } else this.beam.visible = false;
    } else this.beam.visible = false;
  }
  dispose() { this.mgr.scene?.remove(this.group); this.mgr.scene?.remove(this.beam); }
}

// ================================================================= Ender Dragon
export class Dragon extends Mob {
  constructor(mgr, x, y, z) { super(mgr, 'dragon', x, y, z); }
  _buildModel() {
    super._buildModel();
    this.group.rotation.order = 'YXZ'; this.model.scale.setScalar(S16 * 1.0);
    this.state = 'circle'; this.t = 0; this.diveCd = rand(8, 14); this.hitCd = 0; this.stateT = 0;
    this.dying = false; this.deathT = 0; this.persist = true; this.flying = true;
    this.pitch = 0; this.roll = 0; this.vel.set(0, 0, 8); this.flap = 0; this.healAcc = 0; this.expT = 0; this.yawRate = 0;
    this.noLoot = true; this.bright = 0.75; this.fwd = new THREE.Vector3(0, 0, 1);
  }
  hitBoxes() {
    const p = this.pos, f = this.fwd, hp = this.headPos();
    return [
      new THREE.Box3(new THREE.Vector3(p.x - 4.2, p.y - 2.6, p.z - 4.2), new THREE.Vector3(p.x + 4.2, p.y + 2.6, p.z + 4.2)),
      new THREE.Box3(new THREE.Vector3(hp.x - 2.4, hp.y - 2.0, hp.z - 2.4), new THREE.Vector3(hp.x + 2.4, hp.y + 2.0, hp.z + 2.4)),
    ];
  }
  headPos() { const v = new THREE.Vector3(); this.parts.head.getWorldPosition(v); return v; }
  beamTarget() { const v = this.headPos(); v.y += 0.2; return v; }
  hurt(amount, kb, fromCrystal) {
    if (this.dead || this.dying) return false;
    if (!fromCrystal && this.invulnT > 0 && amount <= this.lastDmg) return false;
    this.lastDmg = amount; this.invulnT = 0.3; this.hurtT = 0.4; this.health -= amount;
    this.mgr.audio('hurt');
    if (this.health <= 0) { this.health = 0; this.startDying(); }
    return true;
  }
  startDying() { this.dying = true; this.dead = true; this.deathT = 0; this.mgr.audio('dragon_death'); this.mgr.game.ui?.setBossBar?.(null); }
  update(dt) {
    this.t += dt; this.age += dt; this.hurtT = Math.max(0, this.hurtT - dt); this.invulnT = Math.max(0, this.invulnT - dt); this.hitCd -= dt;
    const m = this.mgr, p = this.pos, v = this.vel, i = this.pi;
    this.updateInfo(dt);
    const targ = m.playerTargetable() || (m.playerAlive() && m.game.gamemode !== undefined);
    let tp = _v.set(0, 82, 0), speed = 15;
    if (this.dying) {
      this.deathT += dt; this.expT -= dt;
      tp.set(0, 88, 0); speed = 4;
      if (this.expT <= 0) {
        this.expT = 0.22; const r = m.game.renderer;
        r?.addParticles?.('explosion', p.x + rand(-6, 6), p.y + rand(-2, 3), p.z + rand(-6, 6), 0, 12); m.audio('explode');
      }
      if (this.deathT > 8) { this.finishDeath(); return; }
    } else {
      // Kristalle heilen
      if (m.crystals.length && this.health < this.maxHealth) { this.healAcc += dt; if (this.healAcc >= 0.5) { this.healAcc = 0; this.health = Math.min(this.maxHealth, this.health + 1); } }
      this.diveCd -= dt; this.stateT += dt;
      const pe = m.playerEye(), pp = m.playerPos();
      if (this.state === 'circle') {
        const ang = Math.atan2(p.z, p.x) + 0.5, R = 30 + Math.sin(this.t * 0.2) * 4;
        tp.set(Math.cos(ang) * R, 80 + Math.sin(this.t * 0.35) * 9, Math.sin(ang) * R); speed = 15;
        if (this.diveCd <= 0 && m.playerAlive() && Math.hypot(pp.x, pp.z) < 90) { this.state = 'dive'; this.stateT = 0; this.diveCd = rand(10, 18); m.audio('dragon_growl'); }
      } else if (this.state === 'dive') {
        const aboveY = Math.max(pe.y, 66) + (this.stateT < 1.6 ? 12 : 0);
        tp.set(pe.x, this.stateT < 1.6 ? aboveY : pe.y, pe.z); speed = this.stateT < 1.6 ? 17 : 24;
        const d3 = p.distanceTo(pe);
        if (this.stateT >= 1.6 && d3 < 7 && this.hitCd <= 0) { this.hitCd = 1.6; m.damagePlayer(6 + Math.random() * 4, p, 2.5); this.state = 'recover'; this.stateT = 0; }
        if (this.stateT > 6.5) { this.state = 'circle'; this.stateT = 0; }
      } else { // recover
        const dx = p.x - pp.x, dz = p.z - pp.z, l = Math.hypot(dx, dz) || 1;
        tp.set(pp.x + dx / l * 40, 85, pp.z + dz / l * 40); speed = 16;
        if (this.stateT > 3) { this.state = 'circle'; this.stateT = 0; }
      }
    }
    // Steuerung
    const dx = tp.x - p.x, dy = tp.y - p.y, dz = tp.z - p.z, l = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, (this.state === 'dive' && !this.dying ? 1.2 : 1.4) * dt);
    v.x += (dx / l * speed - v.x) * k; v.y += (dy / l * speed - v.y) * k; v.z += (dz / l * speed - v.z) * k;
    p.addScaledVector(v, dt);
    // Ausrichtung
    const hs = Math.hypot(v.x, v.z);
    if (hs > 0.5) { const ty = Math.atan2(v.x, v.z), nyaw = lerpAngle(this.yaw, ty, 2.2 * dt); this.yawRate = wrapAngle(nyaw - this.yaw) / Math.max(dt, 1e-4); this.yaw = nyaw; }
    const tpitch = clamp(Math.atan2(v.y, Math.max(hs, 1)), -0.9, 0.9);
    this.pitch += (tpitch - this.pitch) * Math.min(1, 3 * dt);
    this.roll += (clamp(-this.yawRate * 0.35, -0.6, 0.6) - this.roll) * Math.min(1, 3 * dt);
    this.fwd.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.group.position.copy(p); this.group.rotation.y = this.yaw; this.group.rotation.x = -this.pitch; this.group.rotation.z = this.roll;
    if (this.dying) { this.group.position.x += Math.sin(this.t * 40) * 0.08; this.group.position.y += Math.cos(this.t * 37) * 0.08; }
    this._animDragon(dt);
    this.lightT -= dt; if (this.lightT <= 0) { this.lightT = 0.4; this.bright = Math.max(0.7, this.mgr.brightnessAt(p.x, p.y, p.z)); }
    this._applyColor();
    if (!this.dying) m.game.ui?.setBossBar?.('Ender Dragon', this.health / this.maxHealth);
    // Fluegel schlagen Spieler/Mobs zur Seite - nicht implementiert
  }
  _animDragon(dt) {
    const p = this.parts, t = this.t;
    const rate = this.state === 'dive' ? 4.2 : 3.0;
    this.flap += dt * rate;
    const f = Math.sin(this.flap) * 0.55 + 0.1, f2 = Math.sin(this.flap - 0.9) * 0.45;
    p.wingL.rotation.z = f; p.wingR.rotation.z = -f; p.wtipL.rotation.z = f2 * 0.9; p.wtipR.rotation.z = -f2 * 0.9;
    p.wingL.rotation.x = p.wingR.rotation.x = 0.05;
    const bend = clamp(-this.pitch * 12, -10, 10), yawb = clamp(this.yawRate * 6, -10, 10);
    for (let k = 0; k < 5; k++) { const g = p['neck' + k]; g.position.set(yawb * (k + 1) * 0.3, 3 + k * 2.5 + bend * k * 0.25 + Math.sin(t * 1.2 + k * 0.5) * 0.6, 34 + k * 9); }
    const hy = 3 + 5 * 2.5 + bend * 5 * 0.25 + 2; p.head.position.set(yawb * 6 * 0.3, hy, 34 + 5 * 9 + 3);
    p.head.rotation.x = -0.15 + clamp(this.pitch * 0.5, -0.4, 0.4);
    p.jaw.rotation.x = (this.state === 'dive' ? 0.5 : 0.1 + Math.sin(t * 2) * 0.05) * 1.0;
    for (let k = 0; k < 12; k++) { const g = p['tail' + k]; g.position.set(Math.sin(t * 1.4 - k * 0.5) * k * 1.2 - yawb * k * 0.5, Math.cos(t * 1.1 - k * 0.45) * k * 0.8 + bend * -k * 0.2 - k * 0.4, -36 - k * 9); }
    const lr = 0.5 + Math.sin(t * 2) * 0.05;
    for (const s of ['L', 'R']) { p['legF' + s].rotation.x = -lr + 0.2; p['legB' + s].rotation.x = lr; }
  }
  finishDeath() {
    const m = this.mgr, p = this.pos;
    m.game.renderer?.addParticles?.('explosion', p.x, p.y, p.z, 0, 60); m.audio('explode');
    this.dead = true; m.removeMob(this); m.dragon = null;
    m.game.ui?.setBossBar?.(null);
    try { m.game.onDragonDead?.(); } catch (e) { console.error(e); } // Game gibt XP, fuellt Portal, setzt das Drachenei
  }
}

export function createMob(mgr, type, x, y, z) {
  if (type === 'dragon') return new Dragon(mgr, x, y, z);
  if (type === 'crystal') return new Crystal(mgr, x, y, z);
  return new Mob(mgr, type, x, y, z);
}
export function endPillarsFallback() {
  const r = [];
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; r.push({ x: Math.round(Math.cos(a) * 40), y: 64, z: Math.round(Math.sin(a) * 40), h: 76 + ((i * 7) % 5) * 7 }); }
  return r;
}
