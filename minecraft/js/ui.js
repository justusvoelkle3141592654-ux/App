// ui.js — Vanilla-1.12-style GUI: HUD, inventory/crafting/furnace/chest/creative screens, menus, chat, debug.
// Everything is drawn pixel-perfect on <canvas> with an own 5x7 bitmap font; DOM is only used as a container.
//
// ======================= PUBLIC API (read this, Game agent) =======================
// import { UI, drawText, textWidth } from './ui.js';
// const ui = new UI(rootElement, game, textures);   // textures = { drawItemIcon, getTileCanvas }; game = duck-typed game object
//   Creates its own canvases inside `rootElement` (position:absolute full size, pointer-events only while a screen is open).
//   Reads from game: game.player, game.inventory (Inventory), game.settings {renderDistance,fov,sensitivity,volume}, game.gamemode ('survival'|'creative'),
//   game.renderer (optional: setFov(), renderDistance), game.audio (optional: click()).
//   game.settings: sensitivity is a MULTIPLIER (1.0 = 100%, slider 0.1..2.0), volume 0..1, fov degrees 30..110, renderDistance chunks 2..12.
//   Player fields read (all optional, defensive): health|hp (0..20), hunger|food|foodLevel (0..20), air (+maxAir; max is auto-detected if absent),
//   headInWater|underwater|eyeInWater (bool), xpLevel|level, xpProgress|xpFrac (0..1) or xp (total points), score (death screen), regenerating (bool).
//   Player.addXp(n) is called (if it exists) when furnace XP is collected.
//
// --- per frame ---
// ui.update(dt)                       call every frame (seconds): draws HUD + current screen. Also call game loop's ui.tickFurnaces(dt).
// ui.debug(lines|null)                F3 overlay (array of strings, top-left); pass null/[] to hide
// ui.showChat(text) / ui.toast(text, seconds=2)   chat line bottom-left (fades after 10 s) / centered action-bar text above hotbar
// ui.openChat(onSubmit(text), prefill='')   opens the chat input line (T => prefill '', '/' => prefill '/'); Enter submits+closes, Esc closes; keeps pointer lock
// --- screens (all call document.exitPointerLock() except chat; ui.isOpen() becomes true) ---
// ui.openInventory()                  survival: 2x2 crafting + armor + player; creative (game.gamemode==='creative'): searchable creative item browser
// ui.openCreative()                   force the creative browser
// ui.openCrafting()                   3x3 crafting table
// ui.openFurnace(pos)                 pos = {x,y,z} | [x,y,z]; per-position furnace state is created on demand
// ui.openChest(pos)                   27-slot chest, per-position contents
// ui.closeScreen()                    closes any screen (crafting grid + cursor items go back to the inventory, rest via onDrop)
// ui.openMainMenu(onPlay)             title screen (logo, splash, Singleplayer/Options/Quit); onPlay() called on Singleplayer
// ui.openPause(onResume, onOptions?, onQuit?)   "Game Menu"; Esc resumes; onOptions optional (UI has its own options screen), onQuit() for "Save and Quit to Title"
//                                     (default: shows the main menu with the last onPlay)
// ui.openOptions(onDone?)             options screen (render distance, FOV, sensitivity, volume). Writes game.settings live, calls ui.onSettings cb
// ui.openDeath(onRespawn, score|onTitle?, onTitle?)   red "You died!" screen with score (number arg, else player.score) + Respawn / Title Screen
// --- callbacks / state ---
// ui.onDrop(cb)                       cb(ItemStack) when the player throws items out of an open screen (click outside panel / Q); spawn an item entity
// ui.onClose(cb)                      cb(kind) after any screen closed (use to re-request pointer lock)
// ui.onSettings(cb)                   cb(settings) after the options screen changed something
// ui.onFurnaceLit(cb)                 cb(x,y,z,lit:boolean) when a furnace starts/stops burning (swap B.FURNACE <-> B.FURNACE_LIT)
// ui.isOpen() -> bool                 any screen open (inventory, menu, chat...) => game must ignore movement input
// ui.screenKind() -> string|null      'inventory','crafting','furnace','chest','creative','main','pause','options','death','chat'
// ui.tickFurnaces(dt)                 advance all placed furnaces (fuel/cook), also while their screen is closed
// ui.getFurnaceLit(x,y,z) -> bool
// ui.breakContainer(x,y,z) -> ItemStack[]   remove furnace/chest state at that position and return its contents (to drop when the block is broken)
// ui.saveContainers() / ui.loadContainers(obj)   JSON-serialisable furnace+chest state
// ui.setHudVisible(bool)              hide/show the HUD (auto-hidden in main menu)
// ui.clearIconCache()                 call after the texture atlas changed
// ui.getCursorStack()                 ItemStack currently held by the mouse cursor in a screen (or null)
// Keys handled by UI while a screen is open (stopImmediatePropagation): Esc (close/resume/back), E (close inventory-type screens), 1-9 (swap hovered slot with hotbar), Q (drop hovered).
// ==================================================================================

import { BLOCKS, ITEMS, getItem, itemName, I } from './registry.js';
import { ItemStack, Inventory, maxStackOf, maxDamageOf } from './inventory.js';
import { matchCraft, SMELTING, FUEL } from './recipes.js';

// ------------------------------------------------------------------ bitmap font (5x7, ASCII 32..126)
const FONT_ROWS = [
'0000000','4444404','aaa0000','aavavaa','4fke5u4','op248j3','cik8lid','4480000','2488842','8422248','04lel40','044v440','0000c48','000v000','00000cc','01248g0',
'ehjlphe','4c4444e','eh1248v','v2421he','26aiv22','vgu11he','68guhhe','v124888','ehhehhe','ehhf12c','0cc0cc0','0cc0c48','248g842','00v0v00','8421248','eh12404','eh1dlle',
'ehhvhhh','uhhuhhu','ehggghe','sihhhis','vgguggv','vgguggg','ehgnhhf','hhhvhhh','e44444e','72222ic','hikokih','ggggggv','hrllhhh','hhpljhh','ehhhhhe','uhhuggg','ehhhlid','uhhukih',
'fgge11u','v444444','hhhhhhe','hhhhha4','hhhllrh','hha4ahh','hha4444','v1248gv','e88888e','0g84210','e22222e','4ah0000','000000v','8420000',
'00e1fhf','ggmphhu','00egghe','11djhhf','00ehvge','698s888','0fhhf1e','ggmphhh','40c444e','20622ic','ggikoki','c44444e','00qllhh','00mphhh','00ehhhe','0uhuggg','0fhf111','00mpggg','00fge1u',
'88s8896','00hhhjd','00hhha4','00hhlla','00ha4ah','0hhf1he','00v248v','2448442','4444444','8442448','008l200'];
const GLYPH = FONT_ROWS.map(s => Array.from(s, ch => parseInt(ch, 32)));

const textCache = new Map();
export function textWidth(text) { return text.length ? text.length * 6 - 1 : 0; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
// draws text with the pixel font; 1 font pixel = `scale` units of the current transform. shadow: color or false.
export function drawText(ctx, text, x, y, scale = 1, color = '#ffffff', shadow = '#3f3f3f') {
  text = String(text); if (!text) return;
  const key = color + '|' + shadow + '|' + text;
  let c = textCache.get(key);
  if (!c) {
    if (textCache.size > 600) textCache.clear();
    const tw = textWidth(text);
    c = mkCanvas(tw + 1, 8);
    const g = c.getContext('2d');
    const pass = (col, ox, oy) => {
      g.fillStyle = col;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i) - 32;
        const gl = GLYPH[code >= 0 && code < 95 ? code : 31];
        for (let r = 0; r < 7; r++) { const row = gl[r]; if (!row) continue;
          for (let col2 = 0; col2 < 5; col2++) if (row & (16 >> col2)) g.fillRect(i * 6 + col2 + ox, r + oy, 1, 1); }
      }
    };
    if (shadow) pass(shadow, 1, 1);
    pass(color, 0, 0);
    textCache.set(key, c);
  }
  const sm = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.floor(x), Math.floor(y), c.width * scale, c.height * scale);
  ctx.imageSmoothingEnabled = sm;
}
function drawTextC(g, text, cx, y, scale = 1, color = '#fff', shadow = '#3f3f3f') { drawText(g, text, cx - textWidth(text) * scale / 2, y, scale, color, shadow); }
function drawTextOutlined(g, text, cx, y, color, outline = '#000') {
  const x = cx - textWidth(text) / 2;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) drawText(g, text, x + dx, y + dy, 1, outline, false);
  drawText(g, text, x, y, 1, color, false);
}

// ------------------------------------------------------------------ small drawing helpers
const rect = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
function hash2(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

function panel(g, x, y, w, h) { // Vanilla GUI background
  rect(g, '#000', x + 2, y, w - 4, h); rect(g, '#000', x, y + 2, w, h - 4); rect(g, '#000', x + 1, y + 1, w - 2, h - 2);
  rect(g, '#c6c6c6', x + 1, y + 1, w - 2, h - 2);
  rect(g, '#fff', x + 1, y + 1, w - 4, 2); rect(g, '#fff', x + 1, y + 1, 2, h - 4);
  rect(g, '#555', x + 3, y + h - 3, w - 4, 2); rect(g, '#555', x + w - 3, y + 3, 2, h - 4);
  rect(g, '#c6c6c6', x + w - 3, y + 1, 2, 2); rect(g, '#c6c6c6', x + 1, y + h - 3, 2, 2);
}
function slotBg(g, x, y, big = false) { // x,y = item origin
  if (big) { const bx = x - 5, by = y - 5; rect(g, '#373737', bx, by, 26, 26); rect(g, '#fff', bx + 1, by + 25, 25, 1); rect(g, '#fff', bx + 25, by + 1, 1, 25); rect(g, '#8b8b8b', bx + 1, by + 1, 24, 24); rect(g, '#373737', bx + 1, by + 1, 24, 1); rect(g, '#373737', bx + 1, by + 1, 1, 24); return; }
  rect(g, '#373737', x - 1, y - 1, 18, 18); rect(g, '#fff', x, y + 16, 17, 1); rect(g, '#fff', x + 16, y, 1, 17);
  rect(g, '#8b8b8b', x, y, 16, 16);
}
function bevelButton(g, x, y, w, h, st) { // st: 0 normal 1 hover 2 disabled
  rect(g, '#000', x, y, w, h);
  const fill = st === 1 ? '#7a82a0' : st === 2 ? '#4b4b4b' : '#6f6f6f';
  const hi = st === 1 ? '#b8c1e0' : st === 2 ? '#6a6a6a' : '#a0a0a0';
  const sh = st === 1 ? '#3b4262' : st === 2 ? '#2e2e2e' : '#3c3c3c';
  rect(g, fill, x + 1, y + 1, w - 2, h - 2);
  rect(g, hi, x + 1, y + 1, w - 2, 1); rect(g, hi, x + 1, y + 1, 1, h - 2);
  rect(g, sh, x + 1, y + h - 3, w - 2, 2); rect(g, sh, x + w - 2, y + 1, 1, h - 2);
  rect(g, fill, x + w - 2, y + 1, 1, 1);
}
function iconFromMask(rows, col, hiPx = []) {
  const c = mkCanvas(9, 9), g = c.getContext('2d');
  const m = (x, y) => rows[y]?.[x] === 'X';
  const inter = (x, y) => m(x, y) && m(x - 1, y) && m(x + 1, y) && m(x, y - 1) && m(x, y + 1);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    if (!m(x, y)) continue;
    let k = col.out;
    if (inter(x, y)) { k = col.fill; if (col.shade && ((m(x + 1, y) && !inter(x + 1, y)) || (m(x, y + 1) && !inter(x, y + 1)))) k = col.shade; }
    g.fillStyle = k; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = col.hi || col.fill; for (const [x, y] of hiPx) if (inter(x, y) && col.hi) g.fillRect(x, y, 1, 1);
  return c;
}
function iconFromMap(rows, pal) {
  const c = mkCanvas(9, 9), g = c.getContext('2d');
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < 9; x++) { const k = pal[rows[y][x]]; if (k) { g.fillStyle = k; g.fillRect(x, y, 1, 1); } }
  return c;
}
const HEART = ['.XXX.XXX.', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
const ARMOR = ['XXX...XXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.', '.XXXXXXX.'];
const BUBBLE = ['..XXXXX..', '.XXXXXXX.', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..'];
const FOOD = ['.....kkk.', '...kkbhhk', '..kbbbhbk', '..kbbbbbk', '..kbbbbdk', '..kkbbddk', '.kwk.kkk.', 'kwgk.....', '.kk......'];
const FLAME = ['......X.......', '.....XX.X.....', '.....XXXX.....', '....XXXXXX....', '....XXXXXXX...', '...XXXXXXXXX..', '...XXXXXXXXX..', '..XXXXXXXXXXX.', '..XXXXXXXXXXX.', '..XXXXXXXXXXX.', '..XXXXXXXXXXX.', '..XXXXXXXXXXX.', '...XXXXXXXXX..', '....XXXXXXX...'];

let SPR = null;
function sprites() {
  if (SPR) return SPR;
  const heartFull = iconFromMask(HEART, { out: '#000', fill: '#ff1313', shade: '#b30909', hi: '#ff9d9d' }, [[1, 1], [2, 1], [1, 2]]);
  const heartEmpty = iconFromMask(HEART, { out: '#000', fill: '#3b0b0b' }, []);
  const heartBlink = iconFromMask(HEART, { out: '#fff', fill: '#7a1a1a' }, []);
  const armorFull = iconFromMask(ARMOR, { out: '#000', fill: '#e6e6e6', shade: '#8f8f8f', hi: '#fff' }, [[1, 1], [2, 1]]);
  const armorEmpty = iconFromMask(ARMOR, { out: '#000', fill: '#444' }, []);
  const bubble = iconFromMask(BUBBLE, { out: '#1b3a9c', fill: '#4f86e8', shade: '#3a6ad0', hi: '#d6e8ff' }, [[2, 2], [3, 2], [2, 3]]);
  const pal = { k: '#2b1204', b: '#c06c1d', h: '#e8a24c', d: '#8b4513', w: '#f4f4f4', g: '#b0b0b0' };
  const palE = { k: '#1a1a1a', b: '#2a2a2a', h: '#333', d: '#222', w: '#4a4a4a', g: '#3a3a3a' };
  SPR = { heartFull, heartEmpty, heartBlink, armorFull, armorEmpty, bubble, foodFull: iconFromMap(FOOD, pal), foodEmpty: iconFromMap(FOOD, palE) };
  return SPR;
}
function drawHalf(g, empty, full, x, y) { g.drawImage(empty, x, y); g.drawImage(full, 0, 0, 5, 9, x, y, 5, 9); }

// ------------------------------------------------------------------ misc data
const SPLASHES = ['Also try Terraria!', 'Made of blocks!', 'Pixel perfect!', '100% pure JavaScript!', 'Now with three.js!', 'Creeper? Aw man!', 'Don\'t dig straight down!', 'Diamonds!', 'Check out the stronghold!', 'Sssssss...', 'Nether portal ready!', 'Ender dragon inside!', 'Punch trees!', 'Not Notch-approved!', 'Cubism is the new ism!', 'Blocky!', 'Redstone not included!', 'Browser edition!'];
const LOGO_LETTERS = {
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X', 'X...X', 'X...X'], I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  N: ['X...X', 'XX..X', 'XX..X', 'X.X.X', 'X..XX', 'X..XX', 'X...X'], E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  C: ['.XXXX', 'X....', 'X....', 'X....', 'X....', 'X....', '.XXXX'], R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'], F: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'X....'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
};
const ARMOR_TINT = ['#a06540', '#fcee4b', '#d8d8d8', '#33ebcb'];
const key3 = (p) => Array.isArray(p) ? p.map(Math.floor).join(',') : [p.x, p.y, p.z].map(Math.floor).join(',');
const posOf = (p) => Array.isArray(p) ? p.map(Math.floor) : [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function xpNeeded(l) { return l < 16 ? 2 * l + 7 : l < 31 ? 5 * l - 38 : 9 * l - 158; }
function xpFromTotal(x) { let l = 0; x = Math.max(0, x); while (x >= xpNeeded(l)) { x -= xpNeeded(l); l++; } return { level: l, progress: x / xpNeeded(l) }; }

// ================================================================== UI
export class UI {
  constructor(root, game, textures) {
    this.root = root; this.game = game; this.tex = textures || {};
    if (!game.inventory) game.inventory = new Inventory();
    if (!game.settings) game.settings = { renderDistance: 6, fov: 70, sensitivity: 1, volume: 1 };
    const S = game.settings;
    if (S.sensitivity == null) S.sensitivity = 1; if (S.volume == null) S.volume = 1; if (S.fov == null) S.fov = 70; if (S.renderDistance == null) S.renderDistance = 6;
    root.classList.add('mc-ui');
    Object.assign(root.style, { position: root.style.position || 'absolute', inset: '0', pointerEvents: 'none', userSelect: 'none', overflow: 'hidden' });
    const mk = (cls, extra = {}) => { const c = document.createElement('canvas'); c.className = cls;
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', imageRendering: 'pixelated', pointerEvents: 'none' }, extra); root.appendChild(c); return c; };
    this.hudC = mk('mc-hud'); this.xhC = mk('mc-xhair', { mixBlendMode: 'difference' }); this.scrC = mk('mc-screen');
    this.hud = this.hudC.getContext('2d'); this.xh = this.xhC.getContext('2d'); this.sg = this.scrC.getContext('2d');
    this.scale = 3; this.gw = 320; this.gh = 240;
    this.time = 0; this.cursor = null; this.screen = null; this.mx = 0; this.my = 0;
    this.furnaces = new Map(); this.chests = new Map();
    this.chat = []; this.toastT = 0; this.toastText = ''; this.debugLines = null;
    this.iconCache = new Map(); this.hudVisible = true;
    this.cb = {}; this.lastHealth = null; this.blink = 0; this.shake = []; this.shakeT = 0;
    this.nameT = 0; this.lastSel = -1; this.lastSelId = -1; this.maxAirSeen = 1; this.lastClick = { t: 0, key: '' };
    this.playCb = null; this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0]; this.logoCanvas = null; this.dirtPattern = null;
    this._resize = () => this.resize(); window.addEventListener('resize', this._resize); this.resize();
    const sc = this.scrC;
    sc.addEventListener('mousedown', (e) => this._mouse(e, 'down'));
    window.addEventListener('mouseup', (e) => this.screen && this._mouse(e, 'up'));
    window.addEventListener('mousemove', (e) => this.screen && this._mouse(e, 'move'));
    sc.addEventListener('contextmenu', (e) => e.preventDefault());
    sc.addEventListener('wheel', (e) => { if (this.screen?.kind === 'creative') { this._scrollCreative(Math.sign(e.deltaY)); e.preventDefault(); } }, { passive: false });
    window.addEventListener('keydown', (e) => this._key(e), true);
  }

  // ---------------------------------------------------------------- setup
  resize() {
    const W = this.root.clientWidth || window.innerWidth, H = this.root.clientHeight || window.innerHeight;
    for (const c of [this.hudC, this.xhC, this.scrC]) { c.width = W; c.height = H; }
    const sc = clamp(Math.floor(Math.min(W / 320, H / 240)), 1, 4);
    if (sc !== this.scale) this.iconCache.clear();
    this.scale = sc; this.gw = W / sc; this.gh = H / sc; this.W = W; this.H = H;
  }
  _begin(g) { g.setTransform(this.scale, 0, 0, this.scale, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, this.gw + 1, this.gh + 1); }
  clearIconCache() { this.iconCache.clear(); }
  setHudVisible(v) { this.hudVisible = !!v; }
  isOpen() { return !!this.screen; }
  screenKind() { return this.screen ? this.screen.kind : null; }
  getCursorStack() { return this.cursor; }
  onDrop(cb) { this.cb.drop = cb; } onClose(cb) { this.cb.close = cb; } onSettings(cb) { this.cb.settings = cb; } onFurnaceLit(cb) { this.cb.lit = cb; }
  get inv() { return this.game.inventory; }
  get creative() { return this.game.gamemode === 'creative'; }
  _click() { try { this.game.audio?.click?.(); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------------- icons
  drawIcon(g, id, x, y) {
    let ic = this.iconCache.get(id);
    if (!ic) {
      const s = this.scale; ic = mkCanvas(16 * s, 16 * s); const c = ic.getContext('2d'); c.imageSmoothingEnabled = false;
      try { if (!this.tex.drawItemIcon) throw 0; this.tex.drawItemIcon(c, id, 0, 0, 16 * s); }
      catch (e) { const h = (id * 53) % 360; c.fillStyle = `hsl(${h},50%,50%)`; c.fillRect(2 * s, 2 * s, 12 * s, 12 * s); c.fillStyle = '#000'; c.fillRect(2 * s, 2 * s, 12 * s, s); }
      this.iconCache.set(id, ic);
    }
    g.drawImage(ic, Math.floor(x), Math.floor(y), 16, 16);
  }
  drawStack(g, st, x, y, noCount = false) {
    if (!st) return;
    this.drawIcon(g, st.id, x, y);
    const max = maxDamageOf(st.id);
    if (max && st.damage > 0) {
      const f = 1 - st.damage / max, w = Math.max(1, Math.round(13 * f));
      rect(g, '#000', x + 2, y + 13, 13, 2); rect(g, `hsl(${Math.round(f * 120)},100%,50%)`, x + 2, y + 13, w, 1);
    }
    if (st.count > 1 && !noCount) { const t = String(st.count); drawText(g, t, x + 17 - textWidth(t), y + 9, 1, '#fff'); }
  }

  // ---------------------------------------------------------------- player stat helpers
  _stats() {
    const p = this.game.player || {};
    const health = p.health ?? p.hp ?? 20, hunger = p.hunger ?? p.food ?? p.foodLevel ?? 20;
    let level = p.xpLevel ?? p.level, prog = p.xpProgress ?? p.xpFrac;
    if (level == null) { const t = xpFromTotal(p.xp ?? p.experience ?? 0); level = t.level; if (prog == null) prog = t.progress; }
    const air = p.air; if (air != null) this.maxAirSeen = Math.max(this.maxAirSeen, p.maxAir ?? 0, air);
    const maxAir = p.maxAir ?? this.maxAirSeen;
    const inWater = p.headInWater ?? p.underwater ?? p.eyeInWater ?? false;
    return { health, hunger, level, prog: prog || 0, air, maxAir, inWater, regen: !!p.regenerating };
  }

  // ---------------------------------------------------------------- HUD
  update(dt) {
    dt = Math.min(dt || 0, 0.1); this.time += dt;
    this._tickHud(dt);
    this._drawHud();
    this._drawScreen();
  }
  _tickHud(dt) {
    const st = this._stats();
    if (this.lastHealth != null && st.health < this.lastHealth) this.blink = 0.5;
    this.lastHealth = st.health; this.blink = Math.max(0, this.blink - dt);
    this.shakeT -= dt; if (this.shakeT <= 0) { this.shakeT = 0.05; for (let i = 0; i < 10; i++) this.shake[i] = (Math.random() * 2) | 0; }
    const inv = this.inv, sel = inv.getSelected();
    if (inv.selected !== this.lastSel || (sel ? sel.id : -1) !== this.lastSelId) { if (sel && (inv.selected !== this.lastSel || this.lastSelId === -1 || sel.id !== this.lastSelId)) this.nameT = 2; this.lastSel = inv.selected; this.lastSelId = sel ? sel.id : -1; }
    this.nameT = Math.max(0, this.nameT - dt); this.toastT = Math.max(0, this.toastT - dt);
  }
  _drawHud() {
    const g = this.hud; this._begin(g);
    const x = this.xh; this._begin(x);
    const gw = this.gw, gh = this.gh;
    const show = this.hudVisible && this.screen?.kind !== 'main' && this.screen?.kind !== 'death';
    if (show) {
      const creative = this.creative, st = this._stats(), S = sprites();
      const hx = Math.floor(gw / 2 - 91), hy = Math.floor(gh - 22);
      // crosshair (separate canvas, mix-blend difference => inverts like vanilla)
      if (!this.screen || this.screen.kind === 'chat') { const cx = Math.floor(gw / 2), cy = Math.floor(gh / 2); x.fillStyle = '#fff'; x.fillRect(cx - 7, cy, 15, 1); x.fillRect(cx, cy - 7, 1, 7); x.fillRect(cx, cy + 1, 1, 7); }
      // hotbar frame
      rect(g, 'rgba(24,24,24,0.82)', hx, hy, 182, 22);
      rect(g, '#9a9a9a', hx, hy, 182, 1); rect(g, '#9a9a9a', hx, hy, 1, 22); rect(g, '#161616', hx, hy + 21, 182, 1); rect(g, '#161616', hx + 181, hy, 1, 22);
      for (let i = 0; i < 9; i++) {
        const cx = hx + 1 + i * 20;
        rect(g, '#2a2a2a', cx, hy + 1, 20, 1); rect(g, '#2a2a2a', cx, hy + 1, 1, 20);
        rect(g, '#7d7d7d', cx, hy + 20, 20, 1); rect(g, '#7d7d7d', cx + 19, hy + 1, 1, 20);
        rect(g, 'rgba(60,60,60,0.55)', cx + 1, hy + 2, 18, 18);
      }
      const sel = this.inv.selected;
      const sx = hx - 1 + sel * 20, sy = hy - 1;
      rect(g, '#fff', sx, sy, 24, 2); rect(g, '#fff', sx, sy + 22, 24, 2); rect(g, '#fff', sx, sy + 2, 2, 20); rect(g, '#fff', sx + 22, sy + 2, 2, 20);
      rect(g, '#000', sx + 2, sy + 2, 20, 1); rect(g, '#000', sx + 2, sy + 21, 20, 1); rect(g, '#000', sx + 2, sy + 3, 1, 18); rect(g, '#000', sx + 21, sy + 3, 1, 18);
      for (let i = 0; i < 9; i++) this.drawStack(g, this.inv.slots[i], hx + 3 + i * 20, hy + 3);
      // item name
      const cur = this.inv.getSelected();
      if (cur && this.nameT > 0 && !this.screen) { const a = Math.min(1, this.nameT / 0.5); g.globalAlpha = a; drawTextC(g, itemName(cur.id), gw / 2, gh - (creative ? 45 : 59), 1, '#fff'); g.globalAlpha = 1; }
      if (this.toastT > 0) { g.globalAlpha = Math.min(1, this.toastT / 0.5); drawTextC(g, this.toastText, gw / 2, gh - (creative ? 45 : 68), 1, '#fff'); g.globalAlpha = 1; }
      if (!creative) {
        // xp bar
        const by = hy - 7; rect(g, '#000', hx, by, 182, 5); rect(g, '#3a3a3a', hx + 1, by + 1, 180, 3); rect(g, '#222', hx + 1, by + 1, 180, 1);
        const w = Math.round(180 * clamp(st.prog, 0, 1));
        if (w > 0) { rect(g, '#6bc41c', hx + 1, by + 1, w, 3); rect(g, '#a8ff3a', hx + 1, by + 1, w, 1); rect(g, '#3d8a0e', hx + 1, by + 3, w, 1); }
        if (st.level > 0) drawTextOutlined(g, String(st.level), gw / 2, hy - 15 - 4 + 0, '#80ff20');
        // hearts
        const ey = hy - 17, blink = this.blink > 0 && Math.floor(this.blink * 12) % 2 === 0;
        const hp = clamp(Math.ceil(st.health), 0, 20), low = st.health <= 4, wave = Math.floor(this.time * 20) % 25;
        for (let i = 0; i < 10; i++) {
          let yy = ey; if (low) yy += this.shake[i] || 0; if (st.regen && i === wave) yy -= 2;
          const xx = hx + i * 8;
          g.drawImage(blink ? S.heartBlink : S.heartEmpty, xx, yy);
          const v = hp - i * 2; if (v >= 2) g.drawImage(S.heartFull, xx, yy); else if (v === 1) drawHalf(g, blink ? S.heartBlink : S.heartEmpty, S.heartFull, xx, yy);
        }
        // armor
        const ap = this.inv.armorPoints();
        if (ap > 0) for (let i = 0; i < 10; i++) { const xx = hx + i * 8, v = ap - i * 2; g.drawImage(S.armorEmpty, xx, ey - 10); if (v >= 2) g.drawImage(S.armorFull, xx, ey - 10); else if (v === 1) drawHalf(g, S.armorEmpty, S.armorFull, xx, ey - 10); }
        // hunger (right to left)
        const hu = clamp(Math.ceil(st.hunger), 0, 20);
        for (let i = 0; i < 10; i++) {
          const xx = hx + 182 - 9 - i * 8, v = hu - i * 2; let yy = ey; if (st.hunger <= 0 && (Math.floor(this.time * 8) + i) % 2) yy += 1;
          g.drawImage(S.foodEmpty, xx, yy);
          if (v >= 2) g.drawImage(S.foodFull, xx, yy); else if (v === 1) drawHalf(g, S.foodEmpty, S.foodFull, xx, yy);
        }
        // bubbles
        if (st.air != null && (st.inWater || st.air < st.maxAir - 0.001)) {
          const tot = clamp(st.air / st.maxAir, 0, 1) * 10, full = Math.floor(tot + 1e-6);
          for (let i = 0; i < 10; i++) {
            const xx = hx + 182 - 9 - i * 8, yy = ey - 10;
            if (i < full) g.drawImage(S.bubble, xx, yy);
            else if (i === full && tot - full > 0.001) { g.globalAlpha = 0.6; g.drawImage(S.bubble, 2, 2, 5, 5, xx + 2, yy + 2, 5, 5); g.globalAlpha = 1; }
          }
        }
      }
    }
    this._drawChatHud(g);
    if (this.debugLines && this.debugLines.length) {
      this.debugLines.forEach((l, i) => { const w = textWidth(l); rect(g, 'rgba(80,80,80,0.5)', 1, 1 + i * 10, w + 3, 10); drawText(g, l, 2, 2 + i * 10, 1, '#e0e0e0'); });
    }
  }
  debug(lines) { this.debugLines = lines; }

  // ---------------------------------------------------------------- chat
  showChat(text) {
    const maxc = Math.max(20, Math.floor((this.gw - 12) / 6));
    String(text).split('\n').forEach((line) => { while (line.length > maxc) { this.chat.push({ text: line.slice(0, maxc), t: this.time }); line = line.slice(maxc); } this.chat.push({ text: line, t: this.time }); });
    if (this.chat.length > 100) this.chat.splice(0, this.chat.length - 100);
  }
  toast(text, seconds = 2) { this.toastText = String(text); this.toastT = seconds; }
  _drawChatHud(g) {
    const open = this.screen?.kind === 'chat', gh = this.gh;
    const baseY = gh - 62, maxLines = open ? 20 : 10;
    let n = 0;
    for (let i = this.chat.length - 1; i >= 0 && n < maxLines; i--) {
      const l = this.chat[i], age = this.time - l.t;
      if (!open && age > 10) break;
      const a = open ? 1 : clamp(1 - (age - 9) / 1, 0, 1) * 1;
      if (a <= 0) break;
      const y = baseY - n * 9; g.globalAlpha = a;
      rect(g, 'rgba(0,0,0,0.45)', 2, y, textWidth(l.text) + 4, 9); drawText(g, l.text, 4, y + 1, 1, '#fff');
      g.globalAlpha = 1; n++;
    }
    if (open) {
      const c = this.screen, y = gh - 14;
      rect(g, 'rgba(0,0,0,0.6)', 2, y, this.gw - 4, 12);
      const txt = c.text + (Math.floor(this.time * 2) % 2 ? '' : '_');
      const maxc = Math.floor((this.gw - 14) / 6), shown = txt.length > maxc ? txt.slice(txt.length - maxc) : txt;
      drawText(g, '> ' + shown, 4, y + 2, 1, '#e0e0e0');
    }
  }
  openChat(onSubmit, prefill = '') {
    this._closeQuiet();
    this.screen = { kind: 'chat', text: prefill, onSubmit, hist: -1 };
    this.chatHist = this.chatHist || [];
  }

  // ---------------------------------------------------------------- screen lifecycle
  _closeQuiet() {
    const s = this.screen; if (!s) return null;
    if (s.grid) { for (let i = 0; i < s.grid.length; i++) { const st = s.grid[i]; if (st) this._giveBack(st); s.grid[i] = null; } }
    if (this.cursor) { this._giveBack(this.cursor); this.cursor = null; }
    this.screen = null; this.scrC.style.pointerEvents = 'none'; this.sg.clearRect(0, 0, this.scrC.width, this.scrC.height);
    return s;
  }
  _giveBack(st) {
    if (this.screen?.kind === 'creative') return; // creative cursor items are just discarded
    const left = this.inv.add(st.id, st.count, st.damage);
    if (left > 0) this._drop(new ItemStack(st.id, left, st.damage));
  }
  _drop(st) { if (this.cb.drop) this.cb.drop(st); else this.inv.add(st.id, st.count, st.damage); }
  closeScreen() {
    if (this.screen?.kind === 'options') { this._optionsBack(); return; }
    const s = this._closeQuiet(); if (!s) return;
    if (s.kind === 'pause') s.onResume?.();
    this.cb.close?.(s.kind);
  }
  _enter(scr) {
    this._closeQuiet(); this.screen = scr; this.hover = null;
    this.scrC.style.pointerEvents = 'auto';
    if (scr.kind !== 'chat') { try { document.exitPointerLock?.(); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------- container screens
  _invSlot(i, x, y, group) {
    return { x, y, group, role: 'normal', get: () => this.inv.slots[i] || null, set: (s) => { this.inv.slots[i] = s && s.count > 0 ? s : null; } };
  }
  _playerSlots(scr, mainY, hotY) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) { const s = this._invSlot(9 + r * 9 + c, 8 + c * 18, mainY + r * 18, 'main'); scr.slots.push(s); scr.g.main.push(s); }
    for (let c = 0; c < 9; c++) { const s = this._invSlot(c, 8 + c * 18, hotY, 'hotbar'); scr.slots.push(s); scr.g.hotbar.push(s); }
  }
  _newScr(kind, W, H) { return { kind, container: true, W, H, slots: [], g: { main: [], hotbar: [], armor: [], craft: [], input: [], fuel: [], output: [], chest: [], result: [] } }; }
  _gridSlots(scr, n, w, ox, oy) {
    scr.grid = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = { x: ox + (i % w) * 18, y: oy + Math.floor(i / w) * 18, group: 'craft', role: 'normal', get: () => scr.grid[i], set: (v) => { scr.grid[i] = v && v.count > 0 ? v : null; } };
      scr.slots.push(s); scr.g.craft.push(s);
    }
    scr.gw = w;
  }
  _resultSlot(scr, x, y, big) {
    const s = { x, y, group: 'result', role: 'result', big, get: () => scr.resultStack || null, set: () => {}, accept: () => false,
      onTake: () => { for (let i = 0; i < scr.grid.length; i++) { const g = scr.grid[i]; if (g) { g.count--; if (g.count <= 0) scr.grid[i] = null; } } } };
    scr.slots.push(s); scr.g.result.push(s);
    scr.updateResult = () => { const r = matchCraft(scr.grid, scr.gw); scr.resultStack = r ? new ItemStack(r.id, r.count) : null; };
  }
  openInventory() { if (this.creative) return this.openCreative(); this._openPlayerInv(); }
  _openPlayerInv() {
    const scr = this._newScr('inventory', 176, 166);
    for (let i = 0; i < 4; i++) { const s = { x: 8, y: 8 + i * 18, group: 'armor', role: 'normal', armorSlot: i, get: () => this.inv.slots[36 + i] || null, set: (v) => { this.inv.slots[36 + i] = v && v.count > 0 ? v : null; }, accept: (st) => getItem(st.id)?.armor?.slot === i }; scr.slots.push(s); scr.g.armor.push(s); }
    this._gridSlots(scr, 4, 2, 88, 26); this._resultSlot(scr, 144, 36, false);
    this._playerSlots(scr, 84, 142);
    scr.drawBg = (g) => { drawText(g, 'Crafting', 86, 16, 1, '#404040', false); this._playerModel(g, 51, 76); this._arrow(g, 118, 37, false); };
    this._enter(scr);
  }
  openCrafting() {
    const scr = this._newScr('crafting', 176, 166);
    this._gridSlots(scr, 9, 3, 30, 17); this._resultSlot(scr, 124, 35, true); this._playerSlots(scr, 84, 142);
    scr.drawBg = (g) => { drawText(g, 'Crafting', 28, 6, 1, '#404040', false); drawText(g, 'Inventory', 8, 72, 1, '#404040', false); this._arrow(g, 90, 36, true); };
    this._enter(scr);
  }
  _furnaceData(pos) {
    const k = key3(pos); let d = this.furnaces.get(k);
    if (!d) { d = { pos: posOf(pos), input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0, xp: 0, lit: false }; this.furnaces.set(k, d); }
    return d;
  }
  openFurnace(pos) {
    const d = this._furnaceData(pos), scr = this._newScr('furnace', 176, 166);
    const mk = (x, y, group, f, extra = {}) => { const s = Object.assign({ x, y, group, role: 'normal', get: () => d[f] || null, set: (v) => { d[f] = v && v.count > 0 ? v : null; } }, extra); scr.slots.push(s); scr.g[group].push(s); return s; };
    mk(56, 17, 'input', 'input'); mk(56, 53, 'fuel', 'fuel', { accept: (st) => FUEL.has(st.id) });
    mk(116, 35, 'output', 'output', { role: 'output', big: true, accept: () => false });
    this._playerSlots(scr, 84, 142); scr.furnace = d;
    scr.drawBg = (g) => {
      drawTextC(g, 'Furnace', 88, 6, 1, '#404040', false); drawText(g, 'Inventory', 8, 72, 1, '#404040', false);
      // flame
      const frac = d.burnMax > 0 ? clamp(d.burn / d.burnMax, 0, 1) : 0, rows = Math.ceil(14 * frac);
      for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (FLAME[y][x] === 'X') {
        const lit = y >= 14 - rows; g.fillStyle = lit ? (y > 9 ? '#ffcf3a' : y > 5 ? '#f08a1c' : '#e0551a') : '#7a7a7a'; g.fillRect(56 + x, 36 + y, 1, 1);
      }
      this._arrow(g, 79, 34, true, d.cook / 10);
    };
    this._enter(scr);
  }
  _chestData(pos) { const k = key3(pos); let d = this.chests.get(k); if (!d) { d = new Array(27).fill(null); this.chests.set(k, d); } return d; }
  openChest(pos) {
    const d = this._chestData(pos), scr = this._newScr('chest', 176, 168);
    for (let i = 0; i < 27; i++) { const s = { x: 8 + (i % 9) * 18, y: 18 + Math.floor(i / 9) * 18, group: 'chest', role: 'normal', get: () => d[i] || null, set: (v) => { d[i] = v && v.count > 0 ? v : null; } }; scr.slots.push(s); scr.g.chest.push(s); }
    this._playerSlots(scr, 86, 144);
    scr.drawBg = (g) => { drawText(g, 'Chest', 8, 6, 1, '#404040', false); drawText(g, 'Inventory', 8, 74, 1, '#404040', false); };
    this._enter(scr);
  }
  _arrow(g, x, y, big, prog = 0) {
    // 24x17 arrow: gray background, white progress from left
    const shape = (col, w) => { g.fillStyle = col; g.fillRect(x, y + 5, Math.min(w, 16), 7); for (let i = 0; i < 8; i++) { const cx = x + 16 + i; if (cx - x < w) g.fillRect(cx, y + i, 1, 17 - 2 * i); } };
    shape('#8b8b8b', 24); if (prog > 0) shape('#ffffff', Math.round(24 * clamp(prog, 0, 1)));
  }
  _playerModel(g, cx, feet) {
    const sk = '#c68e68', skd = '#a87250', hair = '#3a2412', shirt = '#2a9db0', shirtd = '#1f7f90', pants = '#3b3a8d', shoe = '#6b6b6b';
    const head = { x: cx - 8, y: feet - 64 }, body = { x: cx - 8, y: feet - 48 };
    const slots = this.inv.slots, mat = (i) => { const s = slots[36 + i]; return s ? clamp(Math.floor((s.id - 400) / 10), 0, 3) : -1; };
    // legs
    rect(g, pants, cx - 8, feet - 24, 8, 24); rect(g, pants, cx, feet - 24, 8, 24); rect(g, '#2d2c6c', cx - 1, feet - 24, 2, 24); rect(g, shoe, cx - 8, feet - 6, 8, 6); rect(g, shoe, cx, feet - 6, 8, 6);
    // arms
    rect(g, sk, cx - 16, body.y, 8, 24); rect(g, sk, cx + 8, body.y, 8, 24); rect(g, skd, cx - 16, body.y + 20, 8, 4); rect(g, skd, cx + 8, body.y + 20, 8, 4);
    rect(g, shirt, cx - 16, body.y, 8, 8); rect(g, shirt, cx + 8, body.y, 8, 8);
    // body
    rect(g, shirt, body.x, body.y, 16, 24); rect(g, shirtd, body.x, body.y + 20, 16, 4); rect(g, shirtd, body.x + 7, body.y, 2, 12);
    // head
    rect(g, sk, head.x, head.y, 16, 16); rect(g, hair, head.x, head.y, 16, 5); rect(g, hair, head.x, head.y + 5, 2, 4); rect(g, hair, head.x + 14, head.y + 5, 2, 4);
    const dx = clamp(Math.round((this.mx - (this.screen ? (this.gw - 176) / 2 + cx : cx)) / 30), -1, 1);
    rect(g, '#fff', head.x + 2, head.y + 8, 4, 2); rect(g, '#fff', head.x + 10, head.y + 8, 4, 2);
    rect(g, '#4a3c9e', head.x + 4 + dx, head.y + 8, 2, 2); rect(g, '#4a3c9e', head.x + 10 + dx, head.y + 8, 2, 2);
    rect(g, '#8a5a3c', head.x + 6, head.y + 11, 4, 1); rect(g, '#7a4a30', head.x + 5, head.y + 13, 6, 1);
    // armor overlay
    const t = (i) => ARMOR_TINT[mat(i)];
    if (mat(0) >= 0) { rect(g, t(0), head.x - 1, head.y - 1, 18, 7); rect(g, t(0), head.x - 1, head.y + 5, 2, 4); rect(g, t(0), head.x + 15, head.y + 5, 2, 4); rect(g, 'rgba(0,0,0,0.25)', head.x - 1, head.y + 5, 18, 1); }
    if (mat(1) >= 0) { rect(g, t(1), body.x, body.y, 16, 24); rect(g, t(1), cx - 17, body.y, 9, 10); rect(g, t(1), cx + 8, body.y, 9, 10); rect(g, 'rgba(0,0,0,0.2)', body.x + 7, body.y, 2, 24); rect(g, 'rgba(0,0,0,0.25)', body.x, body.y + 20, 16, 4); }
    if (mat(2) >= 0) { rect(g, t(2), cx - 8, feet - 24, 16, 12); rect(g, t(2), cx - 8, feet - 12, 8, 6); rect(g, t(2), cx, feet - 12, 8, 6); rect(g, 'rgba(0,0,0,0.25)', cx - 1, feet - 24, 2, 18); }
    if (mat(3) >= 0) { rect(g, t(3), cx - 9, feet - 7, 9, 7); rect(g, t(3), cx, feet - 7, 9, 7); rect(g, 'rgba(0,0,0,0.3)', cx - 9, feet - 1, 18, 1); }
    // soft outline
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx - 16, feet, 32, 1);
  }

  // ---------------------------------------------------------------- creative browser
  openCreative() {
    const scr = this._newScr('creative', 195, 136);
    this.cursor = null;
    scr.items = [...ITEMS.values()].map(it => it.id); scr.filtered = scr.items; scr.scroll = 0; scr.search = { focused: false, text: '' };
    scr.hot = [];
    for (let c = 0; c < 9; c++) { const s = this._invSlot(c, 9 + c * 18, 112, 'hotbar'); scr.slots.push(s); scr.g.hotbar.push(s); }
    scr.drawBg = (g) => this._drawCreativeBg(g, scr);
    this._enter(scr);
  }
  _applyFilter(scr) {
    const q = scr.search.text.trim().toLowerCase();
    scr.filtered = q ? scr.items.filter(id => { const it = getItem(id); return it && (it.display.toLowerCase().includes(q) || it.name.toLowerCase().includes(q)); }) : scr.items;
    scr.scroll = 0;
  }
  _creativeMax(scr) { return Math.max(0, Math.ceil(scr.filtered.length / 9) - 5); }
  _scrollCreative(d) { const s = this.screen; s.scroll = clamp(s.scroll + d, 0, this._creativeMax(s)); }
  _creativeGridAt(scr, lx, ly) {
    if (lx < 8 || ly < 17 || lx >= 8 + 162 || ly >= 17 + 90) return -1;
    const c = Math.floor((lx - 8) / 18), r = Math.floor((ly - 17) / 18), i = (scr.scroll + r) * 9 + c;
    return i < scr.filtered.length ? i : -2;
  }
  _drawCreativeBg(g, scr) {
    drawText(g, 'Search Items', 8, 6, 1, '#404040', false);
    // search field
    rect(g, scr.search.focused ? '#fff' : '#a0a0a0', 82, 5, 89, 11); rect(g, '#000', 83, 6, 87, 9);
    const t = scr.search.text + (scr.search.focused && Math.floor(this.time * 2) % 2 === 0 ? '_' : ''); const maxc = 14;
    drawText(g, t.length > maxc ? t.slice(t.length - maxc) : t, 85, 7, 1, '#e0e0e0');
    // grid slots
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) slotBg(g, 9 + c * 18, 18 + r * 18);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) { const i = (scr.scroll + r) * 9 + c; if (i < scr.filtered.length) this.drawIcon(g, scr.filtered[i], 9 + c * 18, 18 + r * 18); }
    // scrollbar
    rect(g, '#373737', 174, 17, 14, 92); rect(g, '#8b8b8b', 175, 18, 12, 90); rect(g, '#555', 175, 18, 12, 1);
    const max = this._creativeMax(scr), ty = 18 + (max ? Math.round(scr.scroll / max * 75) : 0);
    rect(g, '#000', 175, ty, 12, 15); rect(g, max ? '#e0e0e0' : '#a0a0a0', 176, ty + 1, 10, 13); rect(g, '#fff', 176, ty + 1, 10, 1); rect(g, '#7a7a7a', 176, ty + 13, 10, 1);
  }

  // ---------------------------------------------------------------- slot interaction
  _max(st) { return maxStackOf(st.id); }
  _same(a, b) { return a && b && a.id === b.id && a.damage === b.damage; }
  _insert(targets, st) {
    // merge into existing stacks first, then empty slots; mutates st.count, returns remaining
    const max = this._max(st);
    if (max > 1) for (const t of targets) {
      if (st.count <= 0) break; const c = t.get();
      if (c && this._same(c, st) && c.count < max && (!t.accept || t.accept(st))) { const mv = Math.min(max - c.count, st.count); c.count += mv; st.count -= mv; t.set(c); }
    }
    for (const t of targets) {
      if (st.count <= 0) break;
      if (!t.get() && (!t.accept || t.accept(st))) { const mv = Math.min(max, st.count); t.set(new ItemStack(st.id, mv, st.damage)); st.count -= mv; }
    }
    return st.count;
  }
  _clickSlot(slot, button, shift) {
    const scr = this.screen; scr.updateResult?.(); const cur = this.cursor, s = slot.get();
    if (slot.role === 'result' || slot.role === 'output') {
      if (!s) return;
      if (shift) { if (slot.role === 'result') this._craftAll(); else this._quickMove(slot); return; }
      if (cur && !(this._same(cur, s) && cur.count + s.count <= this._max(s))) return;
      if (cur) cur.count += s.count; else this.cursor = new ItemStack(s.id, s.count, s.damage);
      if (slot.role === 'result') { slot.onTake(); } else { slot.set(null); this._giveFurnaceXp(scr.furnace); }
      return;
    }
    if (shift && s) { this._quickMove(slot); return; }
    if (button === 0) {
      if (!cur) { if (s) { this.cursor = s; slot.set(null); } return; }
      if (slot.accept && !slot.accept(cur)) return;
      if (!s) { slot.set(cur); this.cursor = null; return; }
      if (this._same(s, cur) && this._max(s) > 1) { const mv = Math.min(this._max(s) - s.count, cur.count); s.count += mv; cur.count -= mv; if (cur.count <= 0) this.cursor = null; slot.set(s); }
      else { slot.set(cur); this.cursor = s; }
    } else if (button === 2) {
      if (!cur) { if (s) { const take = Math.ceil(s.count / 2); this.cursor = new ItemStack(s.id, take, s.damage); s.count -= take; slot.set(s.count > 0 ? s : null); } return; }
      if (slot.accept && !slot.accept(cur)) return;
      if (!s) { slot.set(new ItemStack(cur.id, 1, cur.damage)); cur.count--; if (cur.count <= 0) this.cursor = null; return; }
      if (this._same(s, cur) && s.count < this._max(s)) { s.count++; cur.count--; if (cur.count <= 0) this.cursor = null; slot.set(s); }
      else { slot.set(cur); this.cursor = s; }
    }
  }
  _giveFurnaceXp(d) { if (!d || d.xp < 1) return; const n = Math.floor(d.xp); d.xp -= n; try { this.game.player?.addXp?.(n); } catch (e) { /* ignore */ } }
  _quickMove(slot) {
    const scr = this.screen, G = scr.g, s = slot.get(); if (!s) return;
    let targets;
    if (['armor', 'craft', 'input', 'fuel', 'output', 'chest', 'result'].includes(slot.group)) targets = [...G.hotbar, ...G.main];
    else if (G.chest.length) targets = G.chest;
    else if (scr.kind === 'furnace') targets = SMELTING.has(s.id) ? G.input : FUEL.has(s.id) ? G.fuel : (slot.group === 'main' ? G.hotbar : G.main);
    else {
      const ar = getItem(s.id)?.armor;
      if (scr.kind === 'inventory' && ar && !G.armor[ar.slot].get()) targets = [G.armor[ar.slot]];
      else targets = slot.group === 'main' ? G.hotbar : G.main;
    }
    this._insert(targets, s); slot.set(s.count > 0 ? s : null);
    if (slot.group === 'output') this._giveFurnaceXp(scr.furnace);
  }
  _craftAll() {
    const scr = this.screen, G = scr.g, targets = [...G.hotbar, ...G.main];
    for (let n = 0; n < 64; n++) {
      scr.updateResult(); const r = scr.resultStack; if (!r) break;
      const t = new ItemStack(r.id, r.count);
      // capacity check
      let room = 0; const max = this._max(t); for (const x of targets) { const c = x.get(); room += !c ? max : (this._same(c, t) ? max - c.count : 0); }
      if (room < t.count) break;
      this._insert(targets, t); G.result[0].onTake();
    }
    scr.updateResult();
  }
  _gather(slot) {
    const scr = this.screen, cur = this.cursor; if (!cur) return; const max = this._max(cur);
    for (let pass = 0; pass < 2; pass++) for (const s of scr.slots) {
      if (cur.count >= max) return; if (s === slot || s.role === 'result' || s.role === 'output') continue;
      const c = s.get(); if (!c || !this._same(c, cur)) continue;
      if (pass === 0 && c.count >= this._max(c)) continue;
      const mv = Math.min(max - cur.count, c.count); cur.count += mv; c.count -= mv; s.set(c.count > 0 ? c : null);
    }
  }
  _slotAt(lx, ly) {
    const scr = this.screen; if (!scr?.slots) return null;
    for (const s of scr.slots) { const b = s.big ? 5 : 1; if (lx >= s.x - b && lx < s.x + 16 + b && ly >= s.y - b && ly < s.y + 16 + b) return s; }
    return null;
  }
  _origin() { const s = this.screen; return { px: Math.floor((this.gw - s.W) / 2), py: Math.floor((this.gh - s.H) / 2) }; }
  _swapHotbar(slot, n) {
    const hot = this.inv.slots[n]; const s = slot.get();
    if (slot.role === 'result' || slot.role === 'output') { if (s && !hot) { this.inv.slots[n] = new ItemStack(s.id, s.count, s.damage); if (slot.role === 'result') slot.onTake(); else { slot.set(null); this._giveFurnaceXp(this.screen.furnace); } } return; }
    if (slot.group === 'hotbar' && slot.get() === hot) return;
    if (hot && slot.accept && !slot.accept(hot)) return;
    if (s && slot.group !== 'hotbar' && false) return;
    slot.set(hot); this.inv.slots[n] = s || null;
  }

  // ---------------------------------------------------------------- input
  _mouse(e, type) {
    const r = this.scrC.getBoundingClientRect();
    this.mx = (e.clientX - r.left) / this.scale; this.my = (e.clientY - r.top) / this.scale;
    const scr = this.screen; if (!scr) return;
    if (type === 'move') { if (this.drag) this._dragMove(); return; }
    if (type === 'up') { this.drag = null; this.activeSlider = null; return; }
    if (scr.kind === 'chat') return;
    e.preventDefault();
    if (!scr.container) { this._menuMouse(e); return; }
    const { px, py } = this._origin(), lx = this.mx - px, ly = this.my - py;
    const btn = e.button === 2 ? 2 : e.button === 0 ? 0 : -1; if (btn < 0) return;
    if (scr.kind === 'creative') { this._creativeMouse(scr, lx, ly, btn, e.shiftKey); return; }
    const slot = this._slotAt(lx, ly);
    if (slot) {
      const key = scr.kind + this.screen.slots.indexOf(slot), now = performance.now();
      if (btn === 0 && this.cursor && this.lastClick.key === key && now - this.lastClick.t < 400 && !e.shiftKey) { this._gather(slot); this.lastClick.t = 0; return; }
      this.lastClick = { t: now, key };
      this._clickSlot(slot, btn, e.shiftKey); return;
    }
    if (lx < 0 || ly < 0 || lx >= scr.W || ly >= scr.H) { // outside the panel: throw
      if (this.cursor) { if (btn === 0) { this._drop(this.cursor); this.cursor = null; } else { this._drop(new ItemStack(this.cursor.id, 1, this.cursor.damage)); this.cursor.count--; if (this.cursor.count <= 0) this.cursor = null; } }
    }
  }
  _creativeMouse(scr, lx, ly, btn, shift) {
    if (lx >= 82 && lx < 171 && ly >= 5 && ly < 16) { scr.search.focused = true; return; }
    scr.search.focused = false;
    if (lx >= 174 && lx < 188 && ly >= 17 && ly < 109) { this.drag = 'creativeScroll'; this._dragMove(); return; }
    const gi = this._creativeGridAt(scr, lx, ly);
    if (gi >= 0) {
      const id = scr.filtered[gi], max = maxStackOf(id);
      if (shift) { this.inv.add(id, max); return; }
      if (this.cursor && this.cursor.id === id && btn === 0) { this.cursor.count = Math.min(max, this.cursor.count + 1); return; }
      this.cursor = new ItemStack(id, btn === 2 ? 1 : max); return;
    }
    const slot = this._slotAt(lx, ly);
    if (slot) { this._clickSlot(slot, btn, shift); return; }
    if (lx >= 0 && ly >= 0 && lx < scr.W && ly < scr.H) { if (this.cursor && ly < 109) this.cursor = null; return; }
    if (this.cursor) { this._drop(this.cursor); this.cursor = null; }
  }
  _dragMove() {
    const scr = this.screen; if (!scr) return;
    if (this.drag === 'creativeScroll') { const { py } = this._origin(), t = clamp((this.my - py - 18 - 7) / 75, 0, 1); scr.scroll = Math.round(t * this._creativeMax(scr)); }
    else if (this.drag === 'slider' && this.activeSlider) this._setSlider(this.activeSlider);
  }
  _key(e) {
    const s = this.screen; if (!s) return;
    const k = e.key, eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (s.kind === 'chat') {
      eat();
      if (k === 'Escape') { this.closeScreen(); }
      else if (k === 'Enter') { const t = s.text.trim(); const cb = s.onSubmit; if (t) { this.chatHist.push(t); } this.closeScreen(); if (t) cb?.(t); }
      else if (k === 'Backspace') s.text = s.text.slice(0, -1);
      else if (k === 'ArrowUp') { if (this.chatHist.length) { s.hist = s.hist < 0 ? this.chatHist.length - 1 : Math.max(0, s.hist - 1); s.text = this.chatHist[s.hist]; } }
      else if (k === 'ArrowDown') { if (s.hist >= 0) { s.hist++; s.text = s.hist >= this.chatHist.length ? (s.hist = -1, '') : this.chatHist[s.hist]; } }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && s.text.length < 200) s.text += k;
      return;
    }
    if (s.container) {
      if (s.kind === 'creative' && s.search.focused) {
        if (k === 'Escape') { eat(); this.closeScreen(); return; }
        if (k === 'Enter') { eat(); s.search.focused = false; return; }
        if (k === 'Backspace') { eat(); s.search.text = s.search.text.slice(0, -1); this._applyFilter(s); return; }
        if (k.length === 1 && !e.ctrlKey && !e.metaKey) { eat(); if (s.search.text.length < 30) s.search.text += k; this._applyFilter(s); return; }
        return;
      }
      if (k === 'Escape' || k === 'e' || k === 'E') { eat(); this.closeScreen(); return; }
      if (s.kind === 'creative' && k.length === 1 && /[a-z]/i.test(k) && !e.ctrlKey && !e.metaKey && !'qQ'.includes(k)) { eat(); s.search.focused = true; s.search.text += k; this._applyFilter(s); return; }
      if (k >= '1' && k <= '9') {
        eat(); const n = +k - 1, { px, py } = this._origin();
        if (s.kind === 'creative') { const gi = this._creativeGridAt(s, this.mx - px, this.my - py); if (gi >= 0) { const id = s.filtered[gi]; this.inv.slots[n] = new ItemStack(id, maxStackOf(id)); return; } }
        const slot = this._slotAt(this.mx - px, this.my - py); if (slot) this._swapHotbar(slot, n); return;
      }
      if (k === 'q' || k === 'Q') {
        eat(); const { px, py } = this._origin(), slot = this._slotAt(this.mx - px, this.my - py), st = slot?.get();
        if (st && slot.role !== 'result') { const all = e.ctrlKey; const out = new ItemStack(st.id, all ? st.count : 1, st.damage); st.count -= out.count; slot.set(st.count > 0 ? st : null); this._drop(out); }
        return;
      }
      return;
    }
    // menus
    if (k === 'Escape') {
      if (s.kind === 'pause') { eat(); this.closeScreen(); }
      else if (s.kind === 'options') { eat(); this._optionsBack(); }
    }
  }

  // ---------------------------------------------------------------- furnaces
  tickFurnaces(dt) {
    for (const d of this.furnaces.values()) {
      const canSmelt = () => { if (!d.input) return false; const r = SMELTING.get(d.input.id); if (!r) return false; return !d.output || (d.output.id === r.out && d.output.count < maxStackOf(r.out)); };
      if (d.burn <= 0 && canSmelt() && d.fuel && FUEL.has(d.fuel.id)) {
        d.burn = d.burnMax = FUEL.get(d.fuel.id);
        if (d.fuel.id === I.LAVA_BUCKET) d.fuel = new ItemStack(I.BUCKET, 1); else { d.fuel.count--; if (d.fuel.count <= 0) d.fuel = null; }
      }
      if (d.burn > 0) {
        d.burn = Math.max(0, d.burn - dt);
        if (canSmelt()) {
          d.cook += dt;
          if (d.cook >= 10) {
            d.cook = 0; const r = SMELTING.get(d.input.id);
            if (d.output) d.output.count++; else d.output = new ItemStack(r.out, 1);
            d.xp += r.xp; d.input.count--; if (d.input.count <= 0) d.input = null;
          }
        } else d.cook = Math.max(0, d.cook - dt * 2);
      } else if (d.cook > 0) d.cook = Math.max(0, d.cook - dt * 2);
      const lit = d.burn > 0; if (lit !== d.lit) { d.lit = lit; this.cb.lit?.(d.pos[0], d.pos[1], d.pos[2], lit); }
    }
  }
  getFurnaceLit(x, y, z) { const d = this.furnaces.get(key3([x, y, z])); return !!d && d.burn > 0; }
  breakContainer(x, y, z) {
    const k = key3([x, y, z]), out = [];
    const f = this.furnaces.get(k); if (f) { for (const s of [f.input, f.fuel, f.output]) if (s) out.push(s); this.furnaces.delete(k); }
    const c = this.chests.get(k); if (c) { for (const s of c) if (s) out.push(s); this.chests.delete(k); }
    if (this.screen && ((this.screen.furnace && this.screen.furnace === f) || false)) this.closeScreen();
    return out;
  }
  saveContainers() {
    const ser = (s) => s ? [s.id, s.count, s.damage] : null;
    return { furnaces: [...this.furnaces].map(([k, d]) => [k, { pos: d.pos, input: ser(d.input), fuel: ser(d.fuel), output: ser(d.output), burn: d.burn, burnMax: d.burnMax, cook: d.cook, xp: d.xp }]), chests: [...this.chests].map(([k, c]) => [k, c.map(ser)]) };
  }
  loadContainers(o) {
    this.furnaces.clear(); this.chests.clear(); if (!o) return;
    const de = (a) => a ? new ItemStack(a[0], a[1], a[2] || 0) : null;
    for (const [k, d] of o.furnaces || []) this.furnaces.set(k, { pos: d.pos, input: de(d.input), fuel: de(d.fuel), output: de(d.output), burn: d.burn || 0, burnMax: d.burnMax || 0, cook: d.cook || 0, xp: d.xp || 0, lit: (d.burn || 0) > 0 });
    for (const [k, c] of o.chests || []) this.chests.set(k, c.map(de));
  }

  // ---------------------------------------------------------------- menus (widgets)
  _optionsBack() { const cb = this.screen?.onDone, from = this.optFrom; this._closeQuiet(); if (cb) cb(); else if (from?.kind === 'pause') this.openPause(from.onResume, from.onOptions, from.onQuit); else if (from?.kind === 'main') this.openMainMenu(this.playCb); else this.cb.close?.('options'); }
  openMainMenu(onPlay) {
    this.playCb = onPlay || this.playCb; this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0];
    this._enter({ kind: 'main', menu: true, widgets: [] });
  }
  openPause(onResume, onOptions, onQuit) {
    this._enter({ kind: 'pause', menu: true, onResume, onOptions, onQuit, widgets: [] });
  }
  openOptions(onDone) {
    const prev = this.screen; this.optFrom = prev && (prev.kind === 'pause' || prev.kind === 'main') ? prev : null;
    this._enter({ kind: 'options', menu: true, onDone, widgets: [] });
  }
  openDeath(onRespawn, scoreOrTitle, onTitle) {
    const score = typeof scoreOrTitle === 'number' ? scoreOrTitle : undefined;
    this._enter({ kind: 'death', menu: true, onRespawn, onTitle: typeof scoreOrTitle === 'function' ? scoreOrTitle : onTitle, score, widgets: [] });
  }
  _buildWidgets(scr) {
    const gw = this.gw, gh = this.gh, cx = Math.floor(gw / 2), W = [];
    const btn = (x, y, w, text, onClick, disabled = false) => W.push({ t: 'btn', x, y, w, h: 20, text, onClick, disabled });
    if (scr.kind === 'main') {
      const y0 = Math.floor(gh / 4) + 48;
      btn(cx - 100, y0, 200, 'Singleplayer', () => { this._closeQuiet(); this.cb.close?.('main'); this.playCb?.(); });
      btn(cx - 100, y0 + 24, 200, 'Multiplayer', null, true);
      btn(cx - 100, y0 + 48 + 12, 98, 'Options...', () => this.openOptions());
      btn(cx + 2, y0 + 48 + 12, 98, 'Quit Game', () => { try { this.game.quit ? this.game.quit() : window.close(); } catch (e) { /* ignore */ } });
    } else if (scr.kind === 'pause') {
      const y0 = Math.floor(gh / 4) + 24;
      btn(cx - 100, y0, 200, 'Back to Game', () => this.closeScreen());
      btn(cx - 100, y0 + 48, 98, 'Advancements', null, true); btn(cx + 2, y0 + 48, 98, 'Statistics', null, true);
      btn(cx - 100, y0 + 72, 200, 'Options...', () => { if (scr.onOptions) { scr.onOptions(); } else this.openOptions(); });
      btn(cx - 100, y0 + 96, 200, 'Save and Quit to Title', () => { const q = scr.onQuit; this._closeQuiet(); if (q) q(); else this.openMainMenu(this.playCb); });
    } else if (scr.kind === 'death') {
      const y0 = Math.floor(gh / 4) + 72;
      btn(cx - 100, y0, 200, 'Respawn', () => { const cb = scr.onRespawn; this._closeQuiet(); this.cb.close?.('death'); cb?.(); });
      btn(cx - 100, y0 + 24, 200, 'Title Screen', () => { const cb = scr.onTitle; this._closeQuiet(); if (cb) cb(); else this.openMainMenu(this.playCb); });
    } else if (scr.kind === 'options') {
      const x1 = cx - 100, x2 = cx - 100, y0 = 40, dy = 24;
      W.push({ t: 'slider', x: x1, y: y0, w: 200, h: 20, key: 'renderDistance', label: 'Render Distance', min: 2, max: 12, step: 1, fmt: (v) => v + ' chunks' });
      W.push({ t: 'slider', x: x2, y: y0 + dy, w: 200, h: 20, key: 'fov', label: 'FOV', min: 30, max: 110, step: 1, fmt: (v) => v === 70 ? 'Normal' : v === 110 ? 'Quake Pro' : String(v) });
      W.push({ t: 'slider', x: x1, y: y0 + dy * 2, w: 200, h: 20, key: 'sensitivity', label: 'Sensitivity', min: 0.1, max: 2, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' });
      W.push({ t: 'slider', x: x2, y: y0 + dy * 3, w: 200, h: 20, key: 'volume', label: 'Master Volume', min: 0, max: 1, step: 0.01, fmt: (v) => v <= 0 ? 'OFF' : Math.round(v * 100) + '%' });
      btn(cx - 100, y0 + dy * 4 + 12, 200, 'Done', () => this._optionsBack());
    }
    return W;
  }
  _sliderVal(w) { return this.game.settings[w.key]; }
  _setSlider(w) {
    const { x, w: ww } = w, t = clamp((this.mx - x - 4) / (ww - 8), 0, 1);
    let v = w.min + t * (w.max - w.min); v = Math.round(v / w.step) * w.step; v = +clamp(v, w.min, w.max).toFixed(4);
    const S = this.game.settings; S[w.key] = v;
    if (w.key === 'fov') this.game.renderer?.setFov?.(v);
    if (w.key === 'renderDistance' && this.game.renderer) this.game.renderer.renderDistance = v;
    this.cb.settings?.(S);
  }
  _menuMouse(e) {
    if (e.button !== 0) return;
    for (const w of this.screen.widgets) {
      if (this.mx >= w.x && this.mx < w.x + w.w && this.my >= w.y && this.my < w.y + w.h) {
        if (w.t === 'btn') { if (!w.disabled) { this._click(); w.onClick?.(); } }
        else { this.drag = 'slider'; this.activeSlider = w; this._setSlider(w); }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- screen drawing
  _drawScreen() {
    const g = this.sg, scr = this.screen; this._begin(g);
    if (!scr || scr.kind === 'chat') return;
    const gw = this.gw, gh = this.gh;
    if (scr.container) {
      const grd = g.createLinearGradient(0, 0, 0, gh); grd.addColorStop(0, 'rgba(16,16,16,0.75)'); grd.addColorStop(1, 'rgba(16,16,16,0.82)'); g.fillStyle = grd; g.fillRect(0, 0, gw, gh);
      const { px, py } = this._origin(), lx = this.mx - px, ly = this.my - py;
      if (scr.updateResult) scr.updateResult();
      g.save(); g.translate(px, py);
      panel(g, 0, 0, scr.W, scr.H);
      scr.drawBg?.(g);
      for (const s of scr.slots) slotBg(g, s.x, s.y, s.big);
      for (const s of scr.slots) { const st = s.get(); if (st) this.drawStack(g, st, s.x, s.y); }
      let tip = null;
      const slot = this._slotAt(lx, ly);
      if (slot) { rect(g, 'rgba(255,255,255,0.5)', slot.x, slot.y, 16, 16); if (!this.cursor) tip = slot.get(); }
      else if (scr.kind === 'creative') { const gi = this._creativeGridAt(scr, lx, ly); if (gi >= 0) { const c = (gi - scr.scroll * 9) % 9, r = Math.floor((gi - scr.scroll * 9) / 9); rect(g, 'rgba(255,255,255,0.5)', 9 + c * 18, 18 + r * 18, 16, 16); if (!this.cursor) tip = new ItemStack(scr.filtered[gi], 1); } }
      g.restore();
      if (this.cursor) this.drawStack(g, this.cursor, this.mx - 8, this.my - 8);
      else if (tip) this._tooltip(g, tip, this.mx, this.my);
      return;
    }
    // menus
    const bgDirt = scr.kind === 'main' || (scr.kind === 'options' && !this.optFrom?.kind?.startsWith?.('pause') && this.optFrom?.kind !== 'pause');
    if (scr.kind === 'death') { const grd = g.createLinearGradient(0, 0, 0, gh); grd.addColorStop(0, 'rgba(80,0,0,0.38)'); grd.addColorStop(1, 'rgba(128,48,48,0.63)'); g.fillStyle = grd; g.fillRect(0, 0, gw, gh); }
    else if (bgDirt) this._drawDirt(g);
    else { const grd = g.createLinearGradient(0, 0, 0, gh); grd.addColorStop(0, 'rgba(16,16,16,0.75)'); grd.addColorStop(1, 'rgba(16,16,16,0.82)'); g.fillStyle = grd; g.fillRect(0, 0, gw, gh); }
    scr.widgets = this._buildWidgets(scr);
    const cx = Math.floor(gw / 2);
    if (scr.kind === 'main') this._drawLogo(g);
    if (scr.kind === 'pause') drawTextC(g, 'Game Menu', cx, 40, 1, '#fff');
    if (scr.kind === 'options') drawTextC(g, 'Options', cx, 15, 1, '#fff');
    if (scr.kind === 'death') {
      g.save(); g.translate(cx, 30); g.scale(2, 2); drawTextC(g, 'You died!', 0, 0, 1, '#fff'); g.restore();
      const p = this.game.player || {}, score = scr.score ?? p.score ?? p.xpTotal ?? p.xp ?? 0, a = 'Score: ', b = String(Math.floor(score)), tw = textWidth(a) + 1 + textWidth(b), x0 = cx - tw / 2;
      drawText(g, a, x0, 100, 1, '#fff'); drawText(g, b, x0 + textWidth(a) + 1, 100, 1, '#ffff55');
    }
    for (const w of scr.widgets) {
      const hov = this.mx >= w.x && this.mx < w.x + w.w && this.my >= w.y && this.my < w.y + w.h;
      if (w.t === 'btn') {
        bevelButton(g, w.x, w.y, w.w, w.h, w.disabled ? 2 : hov ? 1 : 0);
        drawTextC(g, w.text, w.x + w.w / 2, w.y + 6, 1, w.disabled ? '#a0a0a0' : hov ? '#ffffa0' : '#e0e0e0');
      } else {
        const v = this._sliderVal(w), t = clamp((v - w.min) / (w.max - w.min), 0, 1);
        rect(g, '#000', w.x, w.y, w.w, w.h); rect(g, '#8b8b8b', w.x + 1, w.y + 1, w.w - 2, w.h - 2); rect(g, '#373737', w.x + 1, w.y + 1, w.w - 2, 1); rect(g, '#373737', w.x + 1, w.y + 1, 1, w.h - 2); rect(g, '#fff', w.x + 1, w.y + w.h - 2, w.w - 2, 1); rect(g, '#fff', w.x + w.w - 2, w.y + 1, 1, w.h - 2);
        rect(g, '#000', w.x + 1, w.y + 1, w.w - 2, w.h - 2); rect(g, '#3a3a3a', w.x + 2, w.y + 2, w.w - 4, w.h - 4);
        const hx = Math.round(w.x + t * (w.w - 8)); bevelButton(g, hx, w.y, 8, w.h, hov || this.activeSlider === w ? 1 : 0);
        drawTextC(g, `${w.label}: ${w.fmt(v)}`, w.x + w.w / 2, w.y + 6, 1, hov ? '#ffffa0' : '#e0e0e0');
      }
    }
  }
  _tooltip(g, st, mx, my) {
    const it = getItem(st.id); const lines = [{ t: itemName(st.id), c: '#fff' }];
    const max = maxDamageOf(st.id); if (max && st.damage > 0) lines.push({ t: `Durability: ${max - st.damage} / ${max}`, c: '#aaaaaa' });
    if (it?.armor) lines.push({ t: `Armor: +${it.armor.points}`, c: '#5555ff' });
    if (it?.tool?.damage && it.tool.type === 'sword') lines.push({ t: `Attack Damage: ${it.tool.damage}`, c: '#5555ff' });
    let w = 0; for (const l of lines) w = Math.max(w, textWidth(l.t));
    const h = lines.length * 10 - 2;
    let x = mx + 12, y = my - 12; if (x + w + 6 > this.gw) x = mx - 18 - w; if (y + h + 6 > this.gh) y = this.gh - h - 6; if (y < 4) y = 4;
    rect(g, '#100010', x - 3, y - 4, w + 6, h + 8);
    rect(g, '#100010', x - 4, y - 3, w + 8, h + 6);
    rect(g, '#2d0a63', x - 3, y - 3, w + 6, 1); rect(g, '#2d0a63', x - 3, y + h + 2, w + 6, 1); rect(g, '#2d0a63', x - 3, y - 3, 1, h + 6); rect(g, '#2d0a63', x + w + 2, y - 3, 1, h + 6);
    g.save(); g.globalAlpha = 1;
    lines.forEach((l, i) => drawText(g, l.t, x, y + i * 10, 1, l.c));
    g.restore();
  }
  _drawDirt(g) {
    if (!this.dirtPattern) {
      const tile = (() => { try { return this.tex.getTileCanvas?.('dirt') || this.tex.getTileCanvas?.('cobblestone'); } catch (e) { return null; } })();
      const c = mkCanvas(32, 32), t = c.getContext('2d'); t.imageSmoothingEnabled = false;
      if (tile) t.drawImage(tile, 0, 0, 32, 32); else { t.fillStyle = '#7a5a3a'; t.fillRect(0, 0, 32, 32); for (let i = 0; i < 90; i++) { t.fillStyle = hash2(i, 3) > 0.5 ? '#6a4a2c' : '#8b6a45'; t.fillRect((hash2(i, 1) * 16 | 0) * 2, (hash2(i, 2) * 16 | 0) * 2, 2, 2); } }
      t.fillStyle = 'rgba(0,0,0,0.62)'; t.fillRect(0, 0, 32, 32);
      this.dirtPattern = g.createPattern(c, 'repeat');
    }
    g.fillStyle = this.dirtPattern; g.fillRect(0, 0, this.gw, this.gh);
    const grd = g.createLinearGradient(0, 0, 0, this.gh); grd.addColorStop(0, 'rgba(0,0,0,0.35)'); grd.addColorStop(0.5, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)'); g.fillStyle = grd; g.fillRect(0, 0, this.gw, this.gh);
  }
  _buildLogo() {
    const cell = 5, gap = 4, word = 'MINECRAFT', depth = 4, pad = 4;
    const W = word.length * (5 * cell) + (word.length - 1) * gap + pad * 2 + depth, H = 7 * cell + pad * 2 + depth;
    const c = mkCanvas(W, H), g = c.getContext('2d');
    const cells = [];
    for (let li = 0; li < word.length; li++) { const rows = LOGO_LETTERS[word[li]]; for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (rows[y][x] === 'X') cells.push({ gx: li * 5 + x + 0, x: pad + li * (5 * cell + gap) + x * cell, y: pad + y * cell, key: `${li}:${x}:${y}`, lx: x, ly: y, rows }); }
    const has = (cl, dx, dy) => { const nx = cl.lx + dx, ny = cl.ly + dy; return nx >= 0 && ny >= 0 && nx < 5 && ny < 7 && cl.rows[ny][nx] === 'X'; };
    // extrusion (3D edge)
    for (let d = depth; d >= 1; d--) for (const cl of cells) rect(g, d > 2 ? '#222' : '#383838', cl.x + d, cl.y + d, cell, cell);
    for (const cl of cells) rect(g, '#000', cl.x - 1, cl.y - 1, cell + 2, cell + 2);
    for (const cl of cells) {
      for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
        const r = hash2(cl.x + px, cl.y + py, 7), v = r < 0.2 ? 0x6f : r < 0.55 ? 0x80 : r < 0.85 ? 0x8f : 0x9d;
        g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(cl.x + px, cl.y + py, 1, 1);
      }
      if (!has(cl, 0, -1)) rect(g, '#c4c4c4', cl.x, cl.y, cell, 1);
      if (!has(cl, -1, 0)) rect(g, '#b0b0b0', cl.x, cl.y, 1, cell);
      if (!has(cl, 0, 1)) rect(g, '#4a4a4a', cl.x, cl.y + cell - 1, cell, 1);
      if (!has(cl, 1, 0)) rect(g, '#5a5a5a', cl.x + cell - 1, cl.y, 1, cell);
    }
    return c;
  }
  _drawLogo(g) {
    if (!this.logoCanvas) this.logoCanvas = this._buildLogo();
    const L = this.logoCanvas, cx = Math.floor(this.gw / 2), y = Math.floor(this.gh / 4) - 38 + 8;
    g.imageSmoothingEnabled = false; g.drawImage(L, Math.floor(cx - L.width / 2), Math.max(6, y));
    const ly = Math.max(6, y) + L.height - 8;
    drawText(g, 'Browser Edition', Math.floor(cx - L.width / 2 + 8), ly + 2, 1, '#e0e0e0');
    // splash
    const p = Math.abs(Math.sin((this.time % 1) * Math.PI * 2)) * 0.1, sz = 1.8 - p, k = sz * 100 / (textWidth(this.splash) + 32) * 0.9;
    g.save(); g.translate(Math.floor(cx + L.width / 2 - 28), Math.max(6, y) + L.height - 6); g.rotate(-20 * Math.PI / 180); g.scale(k, k);
    drawTextC(g, this.splash, 0, -4, 1, '#ffff00', '#3f3f00'); g.restore();
    drawText(g, 'Minecraft 1.12 style', 2, this.gh - 10, 1, '#fff');
    const cp = 'Not affiliated with Mojang AB'; drawText(g, cp, this.gw - textWidth(cp) - 2, this.gh - 10, 1, '#fff');
  }
}
