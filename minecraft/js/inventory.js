// inventory.js — ItemStack + Inventory (Vanilla-style slot layout)
// Slots: 0..8 hotbar, 9..35 main, 36..39 armor (36 helmet, 37 chest, 38 legs, 39 boots), 40 offhand (unused)
import { getItem } from './registry.js';

export function maxStackOf(id) { return getItem(id)?.stack ?? 64; }
export function maxDamageOf(id) { return getItem(id)?.durability ?? 0; }

export class ItemStack {
  constructor(id, count = 1, damage = 0) { this.id = id; this.count = count; this.damage = damage; }
  clone() { return new ItemStack(this.id, this.count, this.damage); }
  get maxStack() { return maxStackOf(this.id); }
  get maxDamage() { return maxDamageOf(this.id); }
  sameAs(o) { return !!o && o.id === this.id && o.damage === this.damage; }
}

export const HOTBAR_SIZE = 9, MAIN_END = 36, ARMOR_START = 36;

export class Inventory {
  constructor() {
    this.slots = new Array(41).fill(null);
    this.selected = 0;
  }

  // Adds items: first stack onto existing stacks (hotbar first), then into empty slots (hotbar first).
  // Returns the number of items that did NOT fit.
  add(id, count = 1, damage = 0) {
    if (!id || count <= 0) return 0;
    const max = maxStackOf(id);
    if (max > 1) {
      for (let i = 0; i < MAIN_END && count > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.damage === damage && s.count < max) {
          const mv = Math.min(max - s.count, count);
          s.count += mv; count -= mv;
        }
      }
    }
    for (let i = 0; i < MAIN_END && count > 0; i++) {
      if (!this.slots[i]) {
        const mv = Math.min(max, count);
        this.slots[i] = new ItemStack(id, mv, damage);
        count -= mv;
      }
    }
    return count;
  }

  // would add(id,count) fully fit?
  canAdd(id, count = 1, damage = 0) {
    const max = maxStackOf(id); let room = 0;
    for (let i = 0; i < MAIN_END; i++) {
      const s = this.slots[i];
      if (!s) room += max;
      else if (max > 1 && s.id === id && s.damage === damage) room += max - s.count;
    }
    return room >= count;
  }

  getSelected() { return this.slots[this.selected] || null; }

  // Consumes n items of the selected slot. Returns true if there were enough.
  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s || s.count < n) return false;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    return true;
  }

  // Damages the selected item. Returns true if the item broke (slot emptied).
  damageSelected(amount = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    const max = maxDamageOf(s.id);
    if (!max) return false;
    s.damage += amount;
    if (s.damage >= max) { this.slots[this.selected] = null; return true; }
    return false;
  }

  armorPoints() {
    let p = 0;
    for (let i = ARMOR_START; i < ARMOR_START + 4; i++) {
      const s = this.slots[i];
      const a = s && getItem(s.id)?.armor;
      if (a) p += a.points;
    }
    return p;
  }

  count(id) {
    let c = 0;
    for (let i = 0; i < MAIN_END; i++) { const s = this.slots[i]; if (s && s.id === id) c += s.count; }
    return c;
  }
  has(id, count = 1) { return this.count(id) >= count; }

  // remove up to `count` items of id; returns number removed
  remove(id, count = 1) {
    let left = count;
    for (let i = MAIN_END - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const mv = Math.min(s.count, left);
        s.count -= mv; left -= mv;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }

  clear() { this.slots.fill(null); }

  // all non-null stacks (for drop-on-death); optionally empties the inventory
  takeAll() {
    const out = [];
    for (let i = 0; i < this.slots.length; i++) { if (this.slots[i]) { out.push(this.slots[i]); this.slots[i] = null; } }
    return out;
  }

  toJSON() { return { selected: this.selected, slots: this.slots.map(s => s ? [s.id, s.count, s.damage] : null) }; }
  fromJSON(o) {
    if (!o) return;
    this.selected = o.selected | 0;
    this.slots = new Array(41).fill(null);
    (o.slots || []).forEach((s, i) => { if (s && i < 41) this.slots[i] = new ItemStack(s[0], s[1], s[2] || 0); });
  }
}
