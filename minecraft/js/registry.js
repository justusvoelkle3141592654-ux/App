// registry.js — SINGLE SOURCE OF TRUTH for blocks and items. Do not change ids.
// Block ids 0..255 (also usable as item ids). Non-block items start at 256.

export const B = {
  AIR:0, STONE:1, GRASS:2, DIRT:3, COBBLE:4, PLANKS:5, BEDROCK:6, WATER:7, LAVA:8, SAND:9, GRAVEL:10,
  GOLD_ORE:11, IRON_ORE:12, COAL_ORE:13, LOG:14, LEAVES:15, GLASS:16, DIAMOND_ORE:17, REDSTONE_ORE:18,
  CRAFTING_TABLE:19, FURNACE:20, FURNACE_LIT:21, TORCH:22, TALL_GRASS:23, FLOWER_RED:24, FLOWER_YELLOW:25,
  SNOW:26, ICE:27, CACTUS:28, SANDSTONE:29, BRICKS:30, TNT:31, OBSIDIAN:32, NETHERRACK:33, SOUL_SAND:34,
  GLOWSTONE:35, QUARTZ_ORE:36, NETHER_BRICK:37, NETHER_PORTAL:38, FIRE:39, END_STONE:40,
  END_PORTAL_FRAME:41, END_PORTAL:42, LOG_BIRCH:43, LEAVES_BIRCH:44, LOG_SPRUCE:45, LEAVES_SPRUCE:46,
  CHEST:47, IRON_BLOCK:48, GOLD_BLOCK:49, DIAMOND_BLOCK:50, COAL_BLOCK:51, WOOL:52, STONE_BRICKS:53, CLAY:54,
  BEDROCK_END_EXIT:55, // end exit portal fountain base (unbreakable, uses bedrock tile)
  DRAGON_EGG:56,
};

// Non-block items
export const I = {
  STICK:256, COAL:257, CHARCOAL:258, IRON_INGOT:259, GOLD_INGOT:260, DIAMOND:261, REDSTONE:262, FLINT:263,
  STRING:264, FEATHER:265, GUNPOWDER:266, BONE:267, LEATHER:268, BLAZE_ROD:269, BLAZE_POWDER:270,
  ENDER_PEARL:271, EYE_OF_ENDER:272, QUARTZ:273, APPLE:274, BREAD:275, RAW_BEEF:276, STEAK:277,
  RAW_PORKCHOP:278, COOKED_PORKCHOP:279, ROTTEN_FLESH:280, BUCKET:281, WATER_BUCKET:282, LAVA_BUCKET:283,
  FLINT_AND_STEEL:284, BOW:285, ARROW:286, WHEAT_SEEDS:287, WHEAT:288, GLOWSTONE_DUST:289,
  // tools: 300 + tierIndex*10 + kind ; tier: wood0 stone1 iron2 gold3 diamond4 ; kind: pickaxe0 axe1 shovel2 sword3 hoe4
  // armor: 400 + material*10 + slot ; material leather0 gold1 iron2 diamond3 ; slot helmet0 chest1 legs2 boots3
};
export const TIERS = ['wood','stone','iron','gold','diamond'];
export const TOOL_KINDS = ['pickaxe','axe','shovel','sword','hoe'];
export const ARMOR_MATS = ['leather','gold','iron','diamond'];
export const ARMOR_SLOTS = ['helmet','chestplate','leggings','boots'];
export function toolId(tier, kind){ return 300 + tier*10 + kind; }
export function armorId(mat, slot){ return 400 + mat*10 + slot; }

// ---------------------------------------------------------------- blocks
export const BLOCKS = new Array(256).fill(null);
// face order everywhere: 0:+x 1:-x 2:+y(top) 3:-y(bottom) 4:+z 5:-z
// tex: string = same tile on all faces | {top,bottom,side} | {top,bottom,px,nx,pz,nz}
function def(id, name, display, o = {}) {
  BLOCKS[id] = Object.assign({
    id, name, display,
    solid: true,        // collides with player/mobs
    opaque: true,       // hides neighbouring faces / blocks light fully
    shape: 'cube',      // 'cube' | 'cross' | 'torch' | 'cactus' | 'portal' | 'fire' | 'liquid' | 'frame'(end portal frame 13/16 high) | 'chest'(inset 1px, 14/16 high)
    hardness: 1, tool: null, minTier: 0, needsTool: false,
    light: 0,           // emitted block light 0..15
    liquid: false, gravity: false, flammable: false,
    tex: name, drop: id, dropCount: 1, alpha: false,  // alpha: tile has transparent pixels (leaves/glass/cross) -> use alpha test
    breakable: true,
  }, o);
}
def(B.AIR,'air','Air',{solid:false,opaque:false,hardness:0,drop:0,breakable:false,tex:null});
def(B.STONE,'stone','Stone',{hardness:1.5,tool:'pickaxe',needsTool:true,drop:B.COBBLE});
def(B.GRASS,'grass','Grass Block',{hardness:0.6,tool:'shovel',tex:{top:'grass_top',bottom:'dirt',side:'grass_side'},drop:B.DIRT});
def(B.DIRT,'dirt','Dirt',{hardness:0.5,tool:'shovel'});
def(B.COBBLE,'cobblestone','Cobblestone',{hardness:2,tool:'pickaxe',needsTool:true});
def(B.PLANKS,'planks_oak','Oak Wood Planks',{hardness:2,tool:'axe',flammable:true});
def(B.BEDROCK,'bedrock','Bedrock',{hardness:-1,breakable:false});
def(B.WATER,'water','Water',{solid:false,opaque:false,shape:'liquid',liquid:true,hardness:100,drop:0,alpha:true,breakable:false,tex:'water'});
def(B.LAVA,'lava','Lava',{solid:false,opaque:false,shape:'liquid',liquid:true,hardness:100,drop:0,light:15,breakable:false,tex:'lava'});
def(B.SAND,'sand','Sand',{hardness:0.5,tool:'shovel',gravity:true});
def(B.GRAVEL,'gravel','Gravel',{hardness:0.6,tool:'shovel',gravity:true,drop:I.FLINT?I.FLINT:B.GRAVEL});
def(B.GOLD_ORE,'gold_ore','Gold Ore',{hardness:3,tool:'pickaxe',minTier:2,needsTool:true});
def(B.IRON_ORE,'iron_ore','Iron Ore',{hardness:3,tool:'pickaxe',minTier:1,needsTool:true});
def(B.COAL_ORE,'coal_ore','Coal Ore',{hardness:3,tool:'pickaxe',needsTool:true,drop:I.COAL});
def(B.LOG,'log_oak','Oak Wood',{hardness:2,tool:'axe',tex:{top:'log_oak_top',bottom:'log_oak_top',side:'log_oak'},flammable:true});
def(B.LEAVES,'leaves_oak','Oak Leaves',{opaque:false,alpha:true,hardness:0.2,flammable:true,drop:0});
def(B.GLASS,'glass','Glass',{opaque:false,alpha:true,hardness:0.3,drop:0});
def(B.DIAMOND_ORE,'diamond_ore','Diamond Ore',{hardness:3,tool:'pickaxe',minTier:2,needsTool:true,drop:I.DIAMOND});
def(B.REDSTONE_ORE,'redstone_ore','Redstone Ore',{hardness:3,tool:'pickaxe',minTier:2,needsTool:true,drop:I.REDSTONE,dropCount:4});
def(B.CRAFTING_TABLE,'crafting_table','Crafting Table',{hardness:2.5,tool:'axe',tex:{top:'crafting_table_top',bottom:'planks_oak',px:'crafting_table_side',nx:'crafting_table_side',pz:'crafting_table_front',nz:'crafting_table_front'}});
def(B.FURNACE,'furnace','Furnace',{hardness:3.5,tool:'pickaxe',needsTool:true,drop:B.FURNACE,tex:{top:'furnace_top',bottom:'furnace_top',px:'furnace_side',nx:'furnace_side',pz:'furnace_front',nz:'furnace_side'}});
def(B.FURNACE_LIT,'furnace_lit','Furnace',{hardness:3.5,tool:'pickaxe',needsTool:true,drop:B.FURNACE,light:13,tex:{top:'furnace_top',bottom:'furnace_top',px:'furnace_side',nx:'furnace_side',pz:'furnace_front_lit',nz:'furnace_side'}});
def(B.TORCH,'torch','Torch',{solid:false,opaque:false,shape:'torch',hardness:0,light:14,alpha:true,tex:'torch'});
def(B.TALL_GRASS,'tallgrass','Grass',{solid:false,opaque:false,shape:'cross',hardness:0,alpha:true,drop:I.WHEAT_SEEDS,tex:'tallgrass'});
def(B.FLOWER_RED,'flower_rose','Poppy',{solid:false,opaque:false,shape:'cross',hardness:0,alpha:true,tex:'flower_rose'});
def(B.FLOWER_YELLOW,'flower_dandelion','Dandelion',{solid:false,opaque:false,shape:'cross',hardness:0,alpha:true,tex:'flower_dandelion'});
def(B.SNOW,'snow','Snow',{hardness:0.2,tool:'shovel',drop:0});
def(B.ICE,'ice','Ice',{opaque:false,alpha:true,hardness:0.5,tool:'pickaxe',drop:0});
def(B.CACTUS,'cactus','Cactus',{shape:'cactus',opaque:false,hardness:0.4,tex:{top:'cactus_top',bottom:'cactus_bottom',side:'cactus_side'}});
def(B.SANDSTONE,'sandstone','Sandstone',{hardness:0.8,tool:'pickaxe',needsTool:true,tex:{top:'sandstone_top',bottom:'sandstone_bottom',side:'sandstone'}});
def(B.BRICKS,'brick','Bricks',{hardness:2,tool:'pickaxe',needsTool:true});
def(B.TNT,'tnt','TNT',{hardness:0,tex:{top:'tnt_top',bottom:'tnt_bottom',side:'tnt_side'}});
def(B.OBSIDIAN,'obsidian','Obsidian',{hardness:50,tool:'pickaxe',minTier:3,needsTool:true});
def(B.NETHERRACK,'netherrack','Netherrack',{hardness:0.4,tool:'pickaxe',needsTool:true,flammable:true});
def(B.SOUL_SAND,'soul_sand','Soul Sand',{hardness:0.5,tool:'shovel'});
def(B.GLOWSTONE,'glowstone','Glowstone',{hardness:0.3,light:15,drop:I.GLOWSTONE_DUST,dropCount:3});
def(B.QUARTZ_ORE,'quartz_ore','Nether Quartz Ore',{hardness:3,tool:'pickaxe',needsTool:true,drop:I.QUARTZ});
def(B.NETHER_BRICK,'nether_brick','Nether Bricks',{hardness:2,tool:'pickaxe',needsTool:true});
def(B.NETHER_PORTAL,'portal','Nether Portal',{solid:false,opaque:false,shape:'portal',hardness:-1,light:11,alpha:true,breakable:false,drop:0,tex:'portal'});
def(B.FIRE,'fire','Fire',{solid:false,opaque:false,shape:'fire',hardness:0,light:15,alpha:true,drop:0,tex:'fire'});
def(B.END_STONE,'end_stone','End Stone',{hardness:3,tool:'pickaxe',needsTool:true});
def(B.END_PORTAL_FRAME,'endframe','End Portal Frame',{shape:'frame',opaque:false,hardness:-1,breakable:false,light:1,tex:{top:'endframe_top',bottom:'end_stone',side:'endframe_side'}}); // meta bit 0x4 = has eye
def(B.END_PORTAL,'end_portal','End Portal',{solid:false,opaque:false,shape:'portal',hardness:-1,breakable:false,light:15,alpha:false,drop:0,tex:'end_portal'});
def(B.LOG_BIRCH,'log_birch','Birch Wood',{hardness:2,tool:'axe',tex:{top:'log_birch_top',bottom:'log_birch_top',side:'log_birch'},flammable:true});
def(B.LEAVES_BIRCH,'leaves_birch','Birch Leaves',{opaque:false,alpha:true,hardness:0.2,drop:0,flammable:true});
def(B.LOG_SPRUCE,'log_spruce','Spruce Wood',{hardness:2,tool:'axe',tex:{top:'log_spruce_top',bottom:'log_spruce_top',side:'log_spruce'},flammable:true});
def(B.LEAVES_SPRUCE,'leaves_spruce','Spruce Leaves',{opaque:false,alpha:true,hardness:0.2,drop:0,flammable:true});
def(B.CHEST,'chest','Chest',{shape:'chest',opaque:false,hardness:2.5,tool:'axe',tex:{top:'chest_top',bottom:'chest_top',px:'chest_side',nx:'chest_side',pz:'chest_front',nz:'chest_side'}});
def(B.IRON_BLOCK,'iron_block','Block of Iron',{hardness:5,tool:'pickaxe',minTier:1,needsTool:true});
def(B.GOLD_BLOCK,'gold_block','Block of Gold',{hardness:3,tool:'pickaxe',minTier:2,needsTool:true});
def(B.DIAMOND_BLOCK,'diamond_block','Block of Diamond',{hardness:5,tool:'pickaxe',minTier:2,needsTool:true});
def(B.COAL_BLOCK,'coal_block','Block of Coal',{hardness:5,tool:'pickaxe',needsTool:true});
def(B.WOOL,'wool_white','White Wool',{hardness:0.8});
def(B.STONE_BRICKS,'stonebrick','Stone Bricks',{hardness:1.5,tool:'pickaxe',needsTool:true});
def(B.CLAY,'clay','Clay',{hardness:0.6,tool:'shovel',drop:B.CLAY});
def(B.BEDROCK_END_EXIT,'bedrock','Bedrock',{hardness:-1,breakable:false,tex:'bedrock'});
def(B.DRAGON_EGG,'dragon_egg','Dragon Egg',{opaque:false,hardness:3,tex:'dragon_egg'});
BLOCKS[B.GRAVEL].drop = B.GRAVEL; // (flint drop chance handled by game: 10% flint)

// Resolve per-face tile names for a block (face 0..5, order +x -x +y -y +z -z)
export function faceTile(blockId, face) {
  const t = BLOCKS[blockId]?.tex; if (!t) return null;
  if (typeof t === 'string') return t;
  if (face === 2) return t.top; if (face === 3) return t.bottom;
  const k = ['px','nx',0,0,'pz','nz'][face];
  return t[k] ?? t.side;
}
// All distinct block tile names the texture atlas MUST provide
export function allBlockTiles() {
  const s = new Set();
  for (const b of BLOCKS) { if (!b || !b.tex) continue;
    for (let f = 0; f < 6; f++) { const n = faceTile(b.id, f); if (n) s.add(n); } }
  return [...s];
}

// ---------------------------------------------------------------- items
export const ITEMS = new Map(); // id -> def
function idef(id, name, display, o = {}) {
  ITEMS.set(id, Object.assign({ id, name, display, stack: 64, tex: 'item_' + name, block: 0 }, o));
}
// every block is also an item (placeable); tex=null means "render block icon"
for (const b of BLOCKS) { if (!b || b.id === 0 || b.liquid || b.id === B.NETHER_PORTAL || b.id === B.END_PORTAL || b.id === B.FIRE || b.id === B.FURNACE_LIT || b.id === B.BEDROCK_END_EXIT) continue;
  ITEMS.set(b.id, { id: b.id, name: b.name, display: b.display, stack: 64, tex: null, block: b.id }); }
// flat-sprite block items (use their block tile as a sprite in GUI)
for (const id of [B.TORCH, B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW]) ITEMS.get(id).sprite = BLOCKS[id].tex;
ITEMS.get(B.LEAVES).stack = 64;

idef(I.STICK,'stick','Stick'); idef(I.COAL,'coal','Coal'); idef(I.CHARCOAL,'charcoal','Charcoal');
idef(I.IRON_INGOT,'iron_ingot','Iron Ingot'); idef(I.GOLD_INGOT,'gold_ingot','Gold Ingot');
idef(I.DIAMOND,'diamond','Diamond'); idef(I.REDSTONE,'redstone','Redstone'); idef(I.FLINT,'flint','Flint');
idef(I.STRING,'string','String'); idef(I.FEATHER,'feather','Feather'); idef(I.GUNPOWDER,'gunpowder','Gunpowder');
idef(I.BONE,'bone','Bone'); idef(I.LEATHER,'leather','Leather'); idef(I.BLAZE_ROD,'blaze_rod','Blaze Rod');
idef(I.BLAZE_POWDER,'blaze_powder','Blaze Powder'); idef(I.ENDER_PEARL,'ender_pearl','Ender Pearl',{stack:16});
idef(I.EYE_OF_ENDER,'eye_of_ender','Eye of Ender'); idef(I.QUARTZ,'quartz','Nether Quartz');
idef(I.APPLE,'apple','Apple',{food:{hunger:4,sat:2.4}}); idef(I.BREAD,'bread','Bread',{food:{hunger:5,sat:6}});
idef(I.RAW_BEEF,'beef_raw','Raw Beef',{food:{hunger:3,sat:1.8}}); idef(I.STEAK,'beef_cooked','Steak',{food:{hunger:8,sat:12.8}});
idef(I.RAW_PORKCHOP,'porkchop_raw','Raw Porkchop',{food:{hunger:3,sat:1.8}}); idef(I.COOKED_PORKCHOP,'porkchop_cooked','Cooked Porkchop',{food:{hunger:8,sat:12.8}});
idef(I.ROTTEN_FLESH,'rotten_flesh','Rotten Flesh',{food:{hunger:4,sat:0.8}});
idef(I.BUCKET,'bucket_empty','Bucket',{stack:16}); idef(I.WATER_BUCKET,'bucket_water','Water Bucket',{stack:1}); idef(I.LAVA_BUCKET,'bucket_lava','Lava Bucket',{stack:1});
idef(I.FLINT_AND_STEEL,'flint_and_steel','Flint and Steel',{stack:1,durability:64});
idef(I.BOW,'bow','Bow',{stack:1,durability:384}); idef(I.ARROW,'arrow','Arrow');
idef(I.WHEAT_SEEDS,'seeds_wheat','Seeds'); idef(I.WHEAT,'wheat','Wheat'); idef(I.GLOWSTONE_DUST,'glowstone_dust','Glowstone Dust');

const DUR = [59,131,250,32,1561], SPEED = [2,4,6,12,8];
const DMG = { pickaxe:[2,3,4,2,5], axe:[3,4,5,3,6], shovel:[1.5,2.5,3.5,1.5,4.5], sword:[4,5,6,4,7], hoe:[1,1,1,1,1] };
const TIERNAME = ['Wooden','Stone','Iron','Golden','Diamond'];
// tier index for harvest-level checks: wood0 stone1 iron2 gold0! diamond3  (gold harvests like wood)
const HARVEST = [0,1,2,0,3];
TIERS.forEach((t, ti) => TOOL_KINDS.forEach((k, ki) => {
  idef(toolId(ti, ki), `${t}_${k}`, `${TIERNAME[ti]} ${k[0].toUpperCase()+k.slice(1)}`,
    { stack: 1, durability: DUR[ti], tool: { type: k, tier: HARVEST[ti], speed: SPEED[ti], damage: DMG[k][ti] } });
}));
const AP = [[1,3,2,1],[2,5,3,1],[2,6,5,2],[3,8,6,3]], ADUR = [[55,80,75,65],[77,112,105,91],[165,240,225,195],[363,528,495,429]];
const MATN = ['Leather','Golden','Iron','Diamond'], SLOTN = ['Cap','Tunic','Pants','Boots'];
ARMOR_MATS.forEach((m, mi) => ARMOR_SLOTS.forEach((s, si) => {
  idef(armorId(mi, si), `${m}_${s}`, mi === 0 ? `${MATN[mi]} ${SLOTN[si]}` : `${MATN[mi]} ${['Helmet','Chestplate','Leggings','Boots'][si]}`,
    { stack: 1, durability: ADUR[mi][si], armor: { slot: si, points: AP[mi][si] } });
}));

export function getItem(id) { return ITEMS.get(id) || null; }
export function itemName(id) { return getItem(id)?.display ?? '???'; }
// All distinct ITEM tile names the item atlas MUST provide (non-block items + flat sprites)
export function allItemTiles() {
  const s = new Set();
  for (const it of ITEMS.values()) { if (it.tex) s.add(it.tex); }
  return [...s];
}

// Mining time in seconds (vanilla formula). tool = item def or null.
export function breakTime(blockId, tool) {
  const b = BLOCKS[blockId]; if (!b || !b.breakable || b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0;
  const t = tool?.tool;
  const right = !b.tool || (t && t.type === b.tool);
  const canHarvest = !b.needsTool || (right && t && t.tier >= b.minTier);
  let speed = 1;
  if (right && t && b.tool) speed = t.speed;
  if (b.id === B.LEAVES || b.id === B.LEAVES_BIRCH || b.id === B.LEAVES_SPRUCE) speed = Math.max(speed, 1);
  return b.hardness * (canHarvest ? 1.5 : 5) / speed;
}
// Whether breaking yields drops with this tool
export function canHarvest(blockId, tool) {
  const b = BLOCKS[blockId]; if (!b) return false;
  if (!b.needsTool) return true;
  const t = tool?.tool;
  return !!(t && t.type === b.tool && t.tier >= b.minTier);
}
export const isSolidId = (id) => !!BLOCKS[id]?.solid;
export const isOpaqueId = (id) => !!BLOCKS[id]?.opaque;
