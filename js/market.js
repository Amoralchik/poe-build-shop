// Price lookup (poe.ninja snapshot) and trade-site search links.

const TRADE = 'https://www.pathofexile.com/trade/search/';

// ---------------------------------------------------------------- prices

export class PriceBook {
  constructor(data) {
    this.league = data.league;
    this.updated = data.updated;
    this.currency = data.currency;
    this.divine = data.currency['Divine Orb'] || 0;
    this.uniques = new Map();
    for (const [name, baseType, variant, links, chaos, listings, icon] of data.uniques) {
      const k = name.toLowerCase();
      if (!this.uniques.has(k)) this.uniques.set(k, []);
      this.uniques.get(k).push({ name, baseType, variant, links, chaos, listings, icon });
    }
    this.gems = new Map();
    for (const [name, level, quality, corrupted, chaos, listings] of data.gems) {
      const k = name.toLowerCase();
      if (!this.gems.has(k)) this.gems.set(k, []);
      this.gems.get(k).push({ name, level, quality, corrupted: !!corrupted, chaos, listings });
    }
  }

  // All poe.ninja variants of a unique, best guess first.
  uniqueOptions(item) {
    const list = this.uniques.get(item.name.toLowerCase());
    if (!list) return [];
    const wantLinks = item.links >= 5 ? item.links : 0;
    const scored = list.map((e) => {
      let s = 0;
      if (e.links === wantLinks) s += 100;
      else if (e.links) s -= 100;
      if (item.baseType && e.baseType && e.baseType !== item.baseType) s -= 50;
      s += Math.min(e.listings, 50) / 10;
      return { ...e, score: s };
    });
    return scored.sort((a, b) => b.score - a.score);
  }

  gem(g) {
    const names = [g.name, `${g.name} Support`];
    let list;
    for (const n of names) if ((list = this.gems.get(n.toLowerCase()))) break;
    if (!list) return null;
    const wantCorrupt = g.level > 20 || g.quality > 20;
    const pool = list.filter((e) => e.corrupted === wantCorrupt || (!wantCorrupt && !e.corrupted));
    const usable = (pool.length ? pool : list).filter((e) => e.listings >= 3);
    const cands = usable.length ? usable : pool.length ? pool : list;
    // cheapest entry that is at least as good (gems below 20 level up by themselves,
    // so any level counts for them); otherwise the closest one
    const good = cands
      .filter((e) => (g.level < 20 || e.level >= g.level) && e.quality >= g.quality)
      .sort((a, b) => a.chaos - b.chaos);
    if (good.length) return good[0];
    return cands.slice().sort((a, b) => dist(a, g) - dist(b, g))[0];
  }
}
const dist = (e, g) => Math.abs(e.level - g.level) * 10 + Math.abs(e.quality - g.quality);

export function formatPrice(chaos, book, { short = false } = {}) {
  if (chaos == null || !isFinite(chaos)) return '—';
  const d = book.divine;
  if (d && chaos >= d * 0.9) {
    const v = chaos / d;
    return `${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} div`;
  }
  return `${chaos >= 10 ? Math.round(chaos) : +chaos.toFixed(1)}${short ? 'c' : ' chaos'}`;
}

// ---------------------------------------------------------------- stats

let STATS = null; // template -> [{id, group}]

export async function loadStats(url) {
  const data = await (await fetch(url)).json();
  STATS = new Map();
  for (const [group, entries] of Object.entries(data)) {
    for (const [id, text, option] of entries) {
      if (option) continue;
      const k = norm(text);
      if (!STATS.has(k)) STATS.set(k, []);
      STATS.get(k).push({ id, group, text });
    }
  }
}

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const NUM = /[+-]?\d+(?:\.\d+)?/g;
const LOCAL_SLOTS = /^(Weapon|Helmet|Body Armour|Gloves|Boots)/;

// Find the trade stat for one mod line.  Returns {id, text, min, max?} or null.
function matchStat(mod, slot) {
  const nums = (mod.text.match(NUM) || []).map(Number);
  let tpl = mod.text.replace(/\d+(?:\.\d+)?/g, '#');
  let sign = 1;
  const tries = [];
  const pushT = (t, s = 1) => tries.push([t, s]);
  pushT(tpl);
  if (/^-#/.test(tpl)) pushT(tpl.replace(/^-#/, '+#'), -1);
  if (/reduced/.test(tpl)) pushT(tpl.replace('reduced', 'increased'), -1);
  if (/less/.test(tpl)) pushT(tpl.replace(/\bless\b/, 'more'), -1);
  if (/^#/.test(tpl)) pushT('+' + tpl);
  if (/^\+#/.test(tpl)) pushT(tpl.slice(1));

  const groupFor = mod.kind; // implicit | explicit | crafted | fractured | enchant
  const preferLocal = LOCAL_SLOTS.test(slot);
  for (const [t, s] of tries) {
    const variants = preferLocal ? [t + ' (Local)', t] : [t, t + ' (Local)'];
    for (const v of variants) {
      const hits = STATS.get(norm(v));
      if (!hits) continue;
      const hit = hits.find((h) => h.group === groupFor) || hits.find((h) => h.group === 'explicit') || hits[0];
      sign = s;
      const val = nums.length ? (nums.length >= 2 && /# to #/.test(v) ? (Math.abs(nums[0]) + Math.abs(nums[1])) / 2 : Math.abs(nums[0])) : null;
      return { id: hit.id, text: hit.text, value: val == null ? null : val * sign };
    }
  }
  return null;
}

// Fold life / resistances / attributes into the trade site's pseudo totals,
// so "unticking" fire resistance means you no longer care about any fire res.
const PSEUDO = {
  life: ['pseudo.pseudo_total_life', '+# total maximum Life'],
  mana: ['pseudo.pseudo_total_mana', '+# total maximum Mana'],
  es: ['pseudo.pseudo_total_energy_shield', '+# total maximum Energy Shield'],
  fire: ['pseudo.pseudo_total_fire_resistance', '+#% total to Fire Resistance'],
  cold: ['pseudo.pseudo_total_cold_resistance', '+#% total to Cold Resistance'],
  lightning: ['pseudo.pseudo_total_lightning_resistance', '+#% total to Lightning Resistance'],
  chaos: ['pseudo.pseudo_total_chaos_resistance', '+#% total to Chaos Resistance'],
  strength: ['pseudo.pseudo_total_strength', '+# total to Strength'],
  dexterity: ['pseudo.pseudo_total_dexterity', '+# total to Dexterity'],
  intelligence: ['pseudo.pseudo_total_intelligence', '+# total to Intelligence'],
};
const ELE = ['fire', 'cold', 'lightning'];
const ATTR = ['strength', 'dexterity', 'intelligence'];

function pseudoParts(text, slot) {
  let m;
  if ((m = /^\+(\d+) to maximum (Life|Mana)$/.exec(text))) return { [m[2].toLowerCase()]: +m[1] };
  if (!LOCAL_SLOTS.test(slot) && (m = /^\+(\d+) to maximum Energy Shield$/.exec(text))) return { es: +m[1] };
  if ((m = /^\+(\d+)% to (Fire|Cold|Lightning|Chaos) Resistance$/.exec(text))) return { [m[2].toLowerCase()]: +m[1] };
  if ((m = /^\+(\d+)% to (Fire|Cold|Lightning|Chaos) and (Fire|Cold|Lightning|Chaos) Resistances$/.exec(text)))
    return { [m[2].toLowerCase()]: +m[1], [m[3].toLowerCase()]: +m[1] };
  if ((m = /^\+(\d+)% to all Elemental Resistances$/.exec(text))) return Object.fromEntries(ELE.map((e) => [e, +m[1]]));
  if ((m = /^\+(\d+) to (Strength|Dexterity|Intelligence)$/.exec(text))) return { [m[2].toLowerCase()]: +m[1] };
  if ((m = /^\+(\d+) to (Strength|Dexterity|Intelligence) and (Strength|Dexterity|Intelligence)$/.exec(text)))
    return { [m[2].toLowerCase()]: +m[1], [m[3].toLowerCase()]: +m[1] };
  if ((m = /^\+(\d+) to all Attributes$/.exec(text))) return Object.fromEntries(ATTR.map((a) => [a, +m[1]]));
  return null;
}

// Turn an item's mods into a list of searchable filter rows.
export function buildFilters(item, { usePseudo = true } = {}) {
  const rows = [];
  const totals = {};
  const sources = {};
  for (const mod of item.mods) {
    if (mod.kind === 'enchant') {
      rows.push({ label: mod.text, kind: mod.kind, stat: matchStat(mod, item.slot), on: false });
      continue;
    }
    const parts = usePseudo ? pseudoParts(mod.text, item.slot) : null;
    if (parts) {
      for (const [k, v] of Object.entries(parts)) {
        totals[k] = (totals[k] || 0) + v;
        (sources[k] ||= []).push(mod.text);
      }
      continue;
    }
    const stat = matchStat(mod, item.slot);
    const anoint = /^Allocates /.test(mod.text);
    rows.push({ label: mod.text, kind: anoint ? 'anoint' : mod.kind, stat, on: !!stat && mod.kind !== 'implicit' && !anoint });
  }
  const pseudoRows = Object.entries(totals).map(([k, v]) => ({
    label: PSEUDO[k][1].replace('#', v),
    kind: 'pseudo',
    title: sources[k].join('\n'),
    stat: { id: PSEUDO[k][0], value: v },
    on: true,
  }));
  return [...pseudoRows, ...rows];
}

// ---------------------------------------------------------------- trade links

const CATEGORY = {
  Helmet: 'armour.helmet', 'Body Armour': 'armour.chest', Gloves: 'armour.gloves', Boots: 'armour.boots',
  Amulet: 'accessory.amulet', Ring: 'accessory.ring', Belt: 'accessory.belt',
};
function categoryFor(item) {
  const s = item.slot.replace(/ \d+$/, '');
  if (CATEGORY[s]) return CATEGORY[s];
  if (/Abyssal/.test(item.slot) || /Eye Jewel$/.test(item.baseType)) return 'jewel.abyss';
  if (/Jewel/.test(item.slot)) return /Cluster/.test(item.baseType) ? 'jewel.cluster' : 'jewel.base';
  if (/^Flask/.test(item.slot)) return 'flask';
  return null; // weapons / offhands: search by exact base instead
}

const status = { option: 'online' };
const url = (league, q) => `${TRADE}${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(q))}`;

export function uniqueTradeUrl(item, league) {
  const query = { status, name: item.name, type: item.baseType || undefined, filters: {} };
  if (item.links >= 5) query.filters.socket_filters = { filters: { links: { min: item.links } } };
  return url(league, { query, sort: { price: 'asc' } });
}

export function gemTradeUrl(gem, league) {
  const misc = { gem_level: { min: gem.level } };
  if (gem.quality) misc.quality = { min: gem.quality };
  if (gem.level <= 20 && gem.quality <= 20) misc.corrupted = { option: 'false' };
  const name = /Support$/.test(gem.name) || !gem.support ? gem.name : `${gem.name} Support`;
  return url(league, { query: { status, type: name, filters: { misc_filters: { filters: misc } } }, sort: { price: 'asc' } });
}

// rows: output of buildFilters (with user edits: on, min)
export function rareTradeUrl(item, rows, league, { exactBase = false, tolerance = 0.9, links = false } = {}) {
  const filters = rows
    .filter((r) => r.on && r.stat)
    .map((r) => {
      const f = { id: r.stat.id };
      const min = r.min ?? defaultMin(r.stat.value, tolerance);
      if (min != null) f.value = { min };
      return f;
    });
  const query = { status, stats: [{ type: 'and', filters }], filters: {} };
  const cat = categoryFor(item);
  if (exactBase || !cat) query.type = item.baseType;
  else query.filters.type_filters = { filters: { category: { option: cat } } };
  if (links && item.links >= 5) query.filters.socket_filters = { filters: { links: { min: item.links } } };
  return url(league, { query, sort: { price: 'asc' } });
}

// Search minimum for a mod value: a bit below the target so near-equal items show up.
export function defaultMin(v, tolerance) {
  if (v == null) return null;
  const m = v > 0 ? v * tolerance : v / tolerance;
  if (!Number.isInteger(v)) return Math.floor(m * 10) / 10;
  return v > 0 ? Math.max(1, Math.floor(m)) : Math.floor(m);
}

// Magic items carry affixes in their name ("Divine Mana Flask of the Cure").
const FLASK_BASE = /\b((?:Small|Medium|Large|Greater|Grand|Giant|Colossal|Sacred|Hallowed|Sanctified|Divine|Eternal) (?:Life|Mana|Hybrid) Flask|(?:Quicksilver|Bismuth|Stibnite|Amethyst|Ruby|Sapphire|Topaz|Silver|Aquamarine|Granite|Jade|Quartz|Sulphur|Basalt|Diamond|Corundum|Gold|Iron) Flask)\b/;
export function magicBase(name) {
  const m = FLASK_BASE.exec(name);
  return m ? m[1] : name;
}

export function itemTradeUrl(item, league) {
  if (item.rarity === 'UNIQUE') return uniqueTradeUrl(item, league);
  return rareTradeUrl(item, buildFilters(item), league);
}
