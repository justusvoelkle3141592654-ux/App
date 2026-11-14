// recipes.js — crafting recipes (shaped incl. mirrored + shapeless), smelting, fuel
import { B, I, toolId, armorId } from './registry.js';

export const RECIPES = [];
const arr = (v) => Array.isArray(v) ? v : [v];
const LOGS = [B.LOG, B.LOG_BIRCH, B.LOG_SPRUCE];

function shaped(rows, key, out, count = 1) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const cells = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const ch = rows[r][c] || ' ';
    cells.push(ch === ' ' ? null : arr(key[ch]));
  }
  RECIPES.push({ shaped: true, w, h, cells, out: { id: out, count } });
}
function shapeless(items, out, count = 1) {
  RECIPES.push({ shaped: false, items: items.map(arr), out: { id: out, count } });
}

// --- basics
shapeless([LOGS], B.PLANKS, 4);
shaped(['P', 'P'], { P: B.PLANKS }, I.STICK, 4);
shaped(['PP', 'PP'], { P: B.PLANKS }, B.CRAFTING_TABLE);
shaped(['CCC', 'C C', 'CCC'], { C: B.COBBLE }, B.FURNACE);
shaped(['PPP', 'P P', 'PPP'], { P: B.PLANKS }, B.CHEST);
shaped(['C', 'S'], { C: [I.COAL, I.CHARCOAL], S: I.STICK }, B.TORCH, 4);

// --- tools
const MATS = [B.PLANKS, B.COBBLE, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND];
MATS.forEach((m, t) => {
  const k = { M: m, S: I.STICK };
  shaped(['MMM', ' S ', ' S '], k, toolId(t, 0));
  shaped(['MM', 'MS', ' S'], k, toolId(t, 1));
  shaped(['M', 'S', 'S'], k, toolId(t, 2));
  shaped(['M', 'M', 'S'], k, toolId(t, 3));
  shaped(['MM', ' S', ' S'], k, toolId(t, 4));
});

// --- armor: leather, gold, iron, diamond
[I.LEATHER, I.GOLD_INGOT, I.IRON_INGOT, I.DIAMOND].forEach((m, a) => {
  const k = { M: m };
  shaped(['MMM', 'M M'], k, armorId(a, 0));
  shaped(['M M', 'MMM', 'MMM'], k, armorId(a, 1));
  shaped(['MMM', 'M M', 'M M'], k, armorId(a, 2));
  shaped(['M M', 'M M'], k, armorId(a, 3));
});

// --- misc items
shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET);
shapeless([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
shaped([' ST', 'S T', ' ST'], { S: I.STICK, T: I.STRING }, I.BOW);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shapeless([I.ENDER_PEARL, I.BLAZE_POWDER], I.EYE_OF_ENDER);
shapeless([I.BLAZE_ROD], I.BLAZE_POWDER, 2);
shaped(['WWW'], { W: I.WHEAT }, I.BREAD);

// --- blocks
shaped(['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
shaped(['SS', 'SS'], { S: B.SAND }, B.SANDSTONE);
shaped(['SS', 'SS'], { S: I.STRING }, B.WOOL);
shaped(['SS', 'SS'], { S: I.GLOWSTONE_DUST }, B.GLOWSTONE);
shaped(['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT);

// compression blocks and back
[[I.IRON_INGOT, B.IRON_BLOCK], [I.GOLD_INGOT, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK], [I.COAL, B.COAL_BLOCK]].forEach(([item, block]) => {
  shaped(['III', 'III', 'III'], { I: item }, block);
  shapeless([block], item, 9);
});

// ----------------------------------------------------------------- matching
function cellOk(options, stack) { return options === null ? !stack : (!!stack && options.includes(stack.id)); }

function matchShaped(r, grid, w) {
  let minX = w, minY = w, maxX = -1, maxY = -1;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if (grid[y * w + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return false;
  if (maxX - minX + 1 !== r.w || maxY - minY + 1 !== r.h) return false;
  for (let mirror = 0; mirror < 2; mirror++) {
    let ok = true;
    for (let y = 0; y < r.h && ok; y++) for (let x = 0; x < r.w; x++) {
      const rx = mirror ? r.w - 1 - x : x;
      if (!cellOk(r.cells[y * r.w + rx], grid[(minY + y) * w + minX + x])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function matchShapeless(r, grid) {
  const items = grid.filter(Boolean);
  if (items.length !== r.items.length) return false;
  const used = new Array(items.length).fill(false);
  const go = (i) => {
    if (i === r.items.length) return true;
    for (let j = 0; j < items.length; j++) {
      if (!used[j] && r.items[i].includes(items[j].id)) { used[j] = true; if (go(i + 1)) return true; used[j] = false; }
    }
    return false;
  };
  return go(0);
}

// grid: array (w*w) of ItemStack|null, w = 2 or 3 -> {id,count} | null
export function matchCraft(grid, w) {
  for (const r of RECIPES) {
    if (r.shaped ? matchShaped(r, grid, w) : matchShapeless(r, grid)) return { id: r.out.id, count: r.out.count };
  }
  return null;
}

// ----------------------------------------------------------------- smelting / fuel
export const SMELTING = new Map();
const sm = (inp, out, xp) => SMELTING.set(inp, { out, xp });
sm(B.IRON_ORE, I.IRON_INGOT, 0.7); sm(B.GOLD_ORE, I.GOLD_INGOT, 1.0);
sm(B.SAND, B.GLASS, 0.1); sm(B.COBBLE, B.STONE, 0.1);
for (const l of LOGS) sm(l, I.CHARCOAL, 0.15);
sm(I.RAW_BEEF, I.STEAK, 0.35); sm(I.RAW_PORKCHOP, I.COOKED_PORKCHOP, 0.35);
sm(B.CLAY, B.BRICKS, 0.3);
sm(B.COAL_ORE, I.COAL, 0.1); sm(B.DIAMOND_ORE, I.DIAMOND, 1.0); sm(B.REDSTONE_ORE, I.REDSTONE, 0.7);
sm(B.QUARTZ_ORE, I.QUARTZ, 0.2);

export const FUEL = new Map(); // itemId -> burn seconds (vanilla: 1 item smelts in 10 s)
const fu = (id, s) => FUEL.set(id, s);
fu(I.COAL, 80); fu(I.CHARCOAL, 80); fu(B.COAL_BLOCK, 800);
for (const l of LOGS) fu(l, 15);
fu(B.PLANKS, 15); fu(B.CRAFTING_TABLE, 15); fu(B.CHEST, 15);
fu(I.STICK, 5); fu(I.BLAZE_ROD, 120); fu(I.LAVA_BUCKET, 1000); fu(I.BOW, 15);
for (let k = 0; k < 5; k++) fu(toolId(0, k), 10); // wooden tools
