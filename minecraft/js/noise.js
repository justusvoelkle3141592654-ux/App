// noise.js — seeded gradient noise (2D/3D), hashing and a tiny RNG. No allocation in hot paths.

export function hash3(s, x, y, z) {
  let h = (s | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

export function mulberry(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function g3(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function g2(h, x, z) {
  switch (h & 7) {
    case 0: return x + z;
    case 1: return -x + z;
    case 2: return x - z;
    case 3: return -x - z;
    case 4: return x * 1.4;
    case 5: return -x * 1.4;
    case 6: return z * 1.4;
    default: return -z * 1.4;
  }
}

export class Noise {
  constructor(seed) {
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    const r = mulberry((seed | 0) ^ 0x5bd1e995);
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    this.p = p;
  }

  // ~[-1,1]
  n2(x, z) {
    const p = this.p;
    const X = Math.floor(x), Z = Math.floor(z);
    const xi = X & 255, zi = Z & 255;
    const fx = x - X, fz = z - Z;
    const u = fade(fx), v = fade(fz);
    const a = p[xi] + zi, b = p[xi + 1] + zi;
    const aa = p[a], ab = p[a + 1], ba = p[b], bb = p[b + 1];
    const x1 = g2(aa, fx, fz), x2 = g2(ba, fx - 1, fz);
    const x3 = g2(ab, fx, fz - 1), x4 = g2(bb, fx - 1, fz - 1);
    const l1 = x1 + (x2 - x1) * u, l2 = x3 + (x4 - x3) * u;
    return (l1 + (l2 - l1) * v) * 0.8;
  }

  n3(x, y, z) {
    const p = this.p;
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const fx = x - X, fy = y - Y, fz = z - Z;
    const u = fade(fx), v = fade(fy), w = fade(fz);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const a1 = g3(p[AA], fx, fy, fz), a2 = g3(p[BA], fx - 1, fy, fz);
    const a3 = g3(p[AB], fx, fy - 1, fz), a4 = g3(p[BB], fx - 1, fy - 1, fz);
    const a5 = g3(p[AA + 1], fx, fy, fz - 1), a6 = g3(p[BA + 1], fx - 1, fy, fz - 1);
    const a7 = g3(p[AB + 1], fx, fy - 1, fz - 1), a8 = g3(p[BB + 1], fx - 1, fy - 1, fz - 1);
    const b1 = a1 + (a2 - a1) * u, b2 = a3 + (a4 - a3) * u;
    const b3 = a5 + (a6 - a5) * u, b4 = a7 + (a8 - a7) * u;
    const c1 = b1 + (b2 - b1) * v, c2 = b3 + (b4 - b3) * v;
    return c1 + (c2 - c1) * w;
  }

  // fractal, normalised to ~[-1,1]
  f2(x, z, oct) {
    let a = 1, f = 1, s = 0, t = 0;
    for (let i = 0; i < oct; i++) {
      s += this.n2(x * f, z * f) * a; t += a; a *= 0.5; f *= 2;
    }
    return s / t;
  }
}
