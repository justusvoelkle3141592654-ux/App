// commands.js — console commands (/gamemode, /tp, /time, /give, /dimension, /seed, /kill, /summon, /locate, /help ...)
import { B, BLOCKS, ITEMS, getItem } from './registry.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** find an item id by numeric id, registry name or display name (exact, then prefix, then substring) */
export function findItem(q) {
  if (q == null || q === '') return null;
  if (/^\d+$/.test(q)) { const id = +q; return ITEMS.has(id) ? id : null; }
  const n = norm(q.replace(/^minecraft:/, ''));
  if (!n) return null;
  let exact = null, prefix = null, sub = null;
  for (const it of ITEMS.values()) {
    const a = norm(it.name), b = norm(it.display);
    if (a === n || b === n) { exact = it.id; break; }
    if (!prefix && (a.startsWith(n) || b.startsWith(n))) prefix = it.id;
    if (!sub && (a.includes(n) || b.includes(n))) sub = it.id;
  }
  return exact ?? prefix ?? sub;
}

const MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'pig', 'cow', 'sheep', 'chicken', 'enderman', 'zombie_pigman', 'blaze', 'ender_dragon', 'ghast', 'magma_cube'];
const HELP = [
  '/gamemode <survival|creative>',
  '/tp <x> <y> <z>   (~ = relative)',
  '/time set <day|noon|night|midnight|ticks>   /time add <ticks>',
  '/give <item name|id> [count]',
  '/dimension <overworld|nether|end>',
  '/seed   /kill   /summon <mob>   /locate stronghold',
  '/heal  /xp <n>  /clear  /setblock <x> <y> <z> <block>  /fly',
];

function coord(tok, cur) {
  if (tok == null) return NaN;
  if (tok[0] === '~') { const off = tok.length > 1 ? parseFloat(tok.slice(1)) : 0; return cur + (isNaN(off) ? 0 : off); }
  return parseFloat(tok);
}

export function runCommand(game, line) {
  const say = (t) => game.say?.(t);
  line = (line || '').trim();
  if (!line) return;
  if (line[0] !== '/') { say('<Player> ' + line); return; }
  const parts = line.slice(1).split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const p = game.player;
  try {
    switch (cmd) {
      case 'help': case '?': HELP.forEach(say); break;
      case 'gamemode': case 'gm': {
        let m = (parts[0] || '').toLowerCase();
        if (m === 's' || m === '0' || m === 'survival') m = 'survival';
        else if (m === 'c' || m === '1' || m === 'creative') m = 'creative';
        else { say('Usage: /gamemode <survival|creative>'); break; }
        game.setGamemode(m);
        say('Set own game mode to ' + (m === 'creative' ? 'Creative Mode' : 'Survival Mode'));
        break;
      }
      case 'tp': case 'teleport': {
        if (parts.length < 3) { say('Usage: /tp <x> <y> <z>'); break; }
        const x = coord(parts[0], p.pos.x), y = coord(parts[1], p.pos.y), z = coord(parts[2], p.pos.z);
        if ([x, y, z].some(isNaN)) { say('Invalid coordinates'); break; }
        game.teleportTo(x, y, z);
        say(`Teleported to ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
        break;
      }
      case 'time': {
        const sub = (parts[0] || '').toLowerCase();
        if (sub === 'set') {
          const v = (parts[1] || '').toLowerCase();
          const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          let t = named[v] ?? parseInt(v, 10);
          if (isNaN(t)) { say('Usage: /time set <day|night|ticks>'); break; }
          game.time = ((t % 24000) + 24000) % 24000; say('Set the time to ' + Math.floor(game.time));
        } else if (sub === 'add') {
          const t = parseInt(parts[1], 10);
          if (isNaN(t)) { say('Usage: /time add <ticks>'); break; }
          game.time = (((game.time + t) % 24000) + 24000) % 24000; say('Set the time to ' + Math.floor(game.time));
        } else if (sub === 'query') say('The time is ' + Math.floor(game.time));
        else say('Usage: /time set <day|night|ticks>');
        break;
      }
      case 'give': {
        if (!parts.length) { say('Usage: /give <item> [count]'); break; }
        let count = 1;
        let nameParts = parts.slice();
        if (nameParts.length > 1 && /^\d+$/.test(nameParts[nameParts.length - 1])) count = Math.max(1, Math.min(2304, parseInt(nameParts.pop(), 10)));
        const id = findItem(nameParts.join(' '));
        if (id == null) { say('Unknown item: ' + nameParts.join(' ')); break; }
        const it = getItem(id);
        let left = count;
        while (left > 0) {
          const n = Math.min(left, it.stack || 64);
          const rest = game.inventory.add(id, n);
          const given = n - (rest || 0);
          left -= n;
          if (rest) { game.entities?.addItem?.(id, rest, p.pos.x, p.pos.y + 1, p.pos.z); }
          if (given < 0) break;
        }
        say(`Gave ${count} [${it.display}] to Player`);
        break;
      }
      case 'dimension': case 'dim': {
        const d = (parts[0] || '').toLowerCase();
        const map = { overworld: 'overworld', o: 'overworld', nether: 'nether', n: 'nether', end: 'end', e: 'end', the_end: 'end' };
        if (!map[d]) { say('Usage: /dimension <overworld|nether|end>'); break; }
        game.setDimension(map[d]); say('Entered ' + map[d]);
        break;
      }
      case 'seed': say('Seed: [' + game.seed + ']'); break;
      case 'kill': p.hurt(100000, { type: 'kill', ignoreInvuln: true }); say('Ouch. That looks like it hurt.'); break;
      case 'heal': p.health = p.maxHealth; p.hunger = 20; p.saturation = 20; say('Healed'); break;
      case 'xp': { const n = parseInt(parts[0], 10); if (isNaN(n)) { say('Usage: /xp <points>'); break; } p.addXp(n); say(`Gave ${n} experience points`); break; }
      case 'fly': if (p.creative) { p.flying = !p.flying; say(p.flying ? 'Flying on' : 'Flying off'); } else say('Only in creative mode'); break;
      case 'clear': for (let i = 0; i < 41; i++) game.inventory.slots[i] = null; say('Cleared inventory'); break;
      case 'summon': {
        const t = (parts[0] || '').toLowerCase().replace(/^minecraft:/, '');
        if (!t) { say('Usage: /summon <' + MOBS.slice(0, 8).join('|') + '|...>'); break; }
        const d = new (p.pos.constructor)();
        p.getDir(d);
        const x = p.pos.x + d.x * 3, z = p.pos.z + d.z * 3;
        let y = p.pos.y;
        const w = game.world;
        // lift to first free spot
        for (let k = 0; k < 6 && w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== 0; k++) y += 1;
        const m = game.entities?.spawnMob?.(t, x, y, z);
        say(m ? 'Summoned ' + t : 'Unknown entity: ' + t);
        break;
      }
      case 'locate': {
        if ((parts[0] || '').toLowerCase() !== 'stronghold') { say('Usage: /locate stronghold'); break; }
        const s = game.stronghold;
        if (!s) { say('Could not find a stronghold'); break; }
        const dist = Math.round(Math.hypot(s.x - p.pos.x, s.z - p.pos.z));
        say(`The nearest stronghold is at [${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}] (${dist} blocks away)`);
        break;
      }
      case 'setblock': {
        if (parts.length < 4) { say('Usage: /setblock <x> <y> <z> <block>'); break; }
        const x = Math.floor(coord(parts[0], p.pos.x)), y = Math.floor(coord(parts[1], p.pos.y)), z = Math.floor(coord(parts[2], p.pos.z));
        const id = findItem(parts.slice(3).join(' '));
        if (id == null || !BLOCKS[id]) { say('Unknown block'); break; }
        game.world.setBlock(x, y, z, id, 0); say('Block placed'); break;
      }
      default: say('Unknown command: /' + cmd + '. Type /help for a list of commands.');
    }
  } catch (e) {
    console.error(e); say('Command failed: ' + e.message);
  }
}
export default runCommand;
