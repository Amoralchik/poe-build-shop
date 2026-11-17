// Path of Building code -> build object (items per slot + gems).
// A PoB code is URL-safe base64 of zlib-deflated XML.

import { magicBase } from './market.js';

export async function decodePobCode(input) {
  const raw = input.trim();
  if (!raw) throw new Error('Empty code');
  if (raw.startsWith('<')) return raw; // already XML
  if (/^https?:\/\//i.test(raw)) {
    throw new Error('Links (pobb.in, pastebin) cannot be read from the browser. Open the link, copy the PoB code itself and paste it here.');
  }
  let bytes;
  try {
    const b64 = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    throw new Error('That does not look like a Path of Building code.');
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).text();
  } catch {
    throw new Error('Could not unpack the code. Make sure you copied the whole thing.');
  }
}

const SLOT_ORDER = [
  'Weapon 1', 'Weapon 2', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Ring 3', 'Belt',
  'Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5', 'Weapon 1 Swap', 'Weapon 2 Swap',
];

export function slotGroup(slot) {
  if (/^Flask/.test(slot)) return 'flask';
  if (/Swap/.test(slot)) return 'swap';
  if (/Jewel|Abyssal/.test(slot)) return 'jewel';
  return 'gear';
}

export function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('PathOfBuilding, PathOfBuilding2')) {
    throw new Error('The code unpacked, but it is not a Path of Building build.');
  }
  if (doc.querySelector('PathOfBuilding2')) {
    throw new Error('This is a Path of Exile 2 build. Only PoE 1 builds are supported for now.');
  }
  return doc;
}

// PoB "loadouts": a passive tree, an item set and a skill set that share a
// name (or the same "{n}" tag) belong together, e.g. "LvL 81 - 4th Lab".
export function listLoadouts(doc) {
  const itemsEl = doc.querySelector('Items');
  const skillsEl = doc.querySelector('Skills');
  const treeEl = doc.querySelector('Tree');
  const itemSets = [...doc.querySelectorAll('Items > ItemSet')].map((e) => ({ id: e.getAttribute('id'), title: e.getAttribute('title') || '' }));
  const skillSets = [...doc.querySelectorAll('Skills > SkillSet')].map((e) => ({ id: e.getAttribute('id'), title: e.getAttribute('title') || '' }));
  const specs = [...doc.querySelectorAll('Tree > Spec')].map((e, i) => ({ id: String(i + 1), title: e.getAttribute('title') || '' }));
  const active = {
    item: itemsEl?.getAttribute('activeItemSet') || itemSets[0]?.id,
    skill: skillsEl?.getAttribute('activeSkillSet') || skillSets[0]?.id,
    spec: treeEl?.getAttribute('activeSpec') || '1',
  };
  const key = (t) => {
    const m = /\{(\d+)\}/.exec(t);
    return m ? 'id:' + m[1] : t.trim() ? 'name:' + t.trim().toLowerCase() : '';
  };
  const clean = (t) => t.replace(/\{\d+\}/g, '').trim();

  const loadouts = [];
  const seen = new Set();
  for (const s of [...specs, ...itemSets, ...skillSets]) {
    const k = key(s.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const find = (list) => list.find((x) => key(x.title) === k)?.id;
    loadouts.push({ name: clean(s.title), item: find(itemSets), skill: find(skillSets), spec: find(specs) });
  }
  // keep only real loadouts (named sets that pair up); otherwise one "current setup"
  const real = loadouts.filter((l) => [l.item, l.skill, l.spec].filter(Boolean).length >= 2);
  const list = real.length ? real : [];
  const fill = (l) => ({ ...l, item: l.item || active.item, skill: l.skill || active.skill, spec: l.spec || active.spec });
  const result = list.map(fill);
  const activeIdx = result.findIndex((l) => l.item === active.item && l.spec === active.spec);
  if (activeIdx < 0) result.unshift({ name: 'As saved in PoB', ...active });
  return { loadouts: result, defaultIndex: Math.max(0, activeIdx) };
}

export function parseBuild(xml, loadout) {
  const doc = typeof xml === 'string' ? parseXml(xml) : xml;
  if (!loadout) {
    const { loadouts, defaultIndex } = listLoadouts(doc);
    loadout = loadouts[defaultIndex];
  }
  const b = doc.querySelector('Build');
  const build = {
    className: b?.getAttribute('className') || '',
    ascendancy: b?.getAttribute('ascendClassName') || '',
    level: +(b?.getAttribute('level') || 0),
    items: [],
    gems: [],
  };

  // ---- items ----
  const itemsEl = doc.querySelector('Items');
  const byId = new Map();
  for (const el of doc.querySelectorAll('Items > Item')) {
    const ranges = [...el.querySelectorAll('ModRange')].reduce((m, r) => (m[r.getAttribute('id')] = +r.getAttribute('range'), m), {});
    byId.set(el.getAttribute('id'), { text: textOf(el), ranges });
  }
  const activeSet = loadout.item;
  const set = (activeSet && doc.querySelector(`ItemSet[id="${activeSet}"]`)) || doc.querySelector('ItemSet');
  const slotEls = set ? [...set.querySelectorAll('Slot')] : [...(itemsEl?.querySelectorAll(':scope > Slot') || [])];
  const seen = new Set();
  for (const s of slotEls) {
    const id = s.getAttribute('itemId');
    const name = s.getAttribute('name');
    if (!id || id === '0' || !byId.has(id)) continue;
    const src = byId.get(id);
    build.items.push({ slot: name, ...parseItem(src.text, src.ranges) });
    seen.add(id);
  }
  // jewels socketed in the passive tree
  const tree = doc.querySelector('Tree');
  const activeSpec = loadout.spec;
  const specs = tree ? [...tree.querySelectorAll('Spec')] : [];
  const spec = specs[(+activeSpec || 1) - 1] || specs[0];
  let j = 0;
  for (const s of spec?.querySelectorAll('Sockets > Socket') || []) {
    const id = s.getAttribute('itemId');
    if (!id || id === '0' || !byId.has(id) || seen.has(id)) continue;
    const src = byId.get(id);
    build.items.push({ slot: `Jewel ${++j}`, ...parseItem(src.text, src.ranges) });
    seen.add(id);
  }
  build.items.sort((a, b) => rank(a.slot) - rank(b.slot));

  // ---- gems (active skill set only) ----
  const skills = doc.querySelector('Skills');
  const activeSkillSet = loadout.skill;
  const skillSet = (activeSkillSet && skills?.querySelector(`SkillSet[id="${activeSkillSet}"]`)) || skills;
  for (const sk of skillSet?.querySelectorAll('Skill') || []) {
    if (sk.getAttribute('source')) continue; // granted by an item
    const groupEnabled = sk.getAttribute('enabled') !== 'false';
    for (const g of sk.querySelectorAll('Gem')) {
      const name = g.getAttribute('nameSpec') || '';
      const gemId = g.getAttribute('gemId') || '';
      if (!name || !gemId) continue;
      build.gems.push({
        name,
        gemId,
        level: +(g.getAttribute('level') || 1),
        quality: +(g.getAttribute('quality') || 0),
        enabled: groupEnabled && g.getAttribute('enabled') !== 'false',
        support: /Support/.test(gemId),
        slot: sk.getAttribute('slot') || '',
      });
    }
  }
  return build;
}

function rank(slot) {
  const i = SLOT_ORDER.indexOf(slot);
  if (i >= 0) return i;
  if (/Abyssal/.test(slot)) return 100;
  if (/Jewel/.test(slot)) return 200 + (+slot.replace(/\D/g, '') || 0);
  return 50;
}

function textOf(el) {
  let t = '';
  for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
  return t;
}

// ---------------------------------------------------------------------------
// PoB item text parser

const INFLUENCES = {
  'Shaper Item': 'shaper', 'Elder Item': 'elder', 'Crusader Item': 'crusader', 'Redeemer Item': 'redeemer',
  'Hunter Item': 'hunter', 'Warlord Item': 'warlord', 'Searing Exarch Item': 'exarch', 'Eater of Worlds Item': 'eater',
};
const FLAG_LINES = new Set(['Corrupted', 'Mirrored', 'Split', 'Synthesised Item', 'Fractured Item', 'Unidentified', 'Foulborn', ...Object.keys(INFLUENCES)]);
const HEADER_RE = /^[A-Za-z][A-Za-z ]*:\s*/;

export function parseItem(text, ranges = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const item = {
    rarity: 'NORMAL', name: '', baseType: '', itemLevel: 0, quality: 0, sockets: '', links: 0,
    corrupted: false, influences: [], mods: [], raw: text.trim(),
  };
  let i = 0;
  const m0 = /^Rarity:\s*(\w+)/i.exec(lines[0] || '');
  if (m0) { item.rarity = m0[1].toUpperCase(); i = 1; }
  item.name = lines[i++] || '';
  if (item.rarity === 'RARE' || item.rarity === 'UNIQUE' || item.rarity === 'RELIC') {
    const next = lines[i] || '';
    if (!HEADER_RE.test(next) || /^[^:]+$/.test(next)) { item.baseType = next; i++; }
  } else {
    item.baseType = magicBase(item.name); // normal / magic: base is embedded in the name
  }

  let implicitCount = 0;
  let selectedVariant = null;
  let modStart = -1;
  let firstNonHeader = -1;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (FLAG_LINES.has(l)) { applyFlag(item, l); continue; }
    const h = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(l);
    if (!h) { if (firstNonHeader < 0) firstNonHeader = i; continue; }
    const [, key, val] = h;
    if (key === 'Item Level') item.itemLevel = +val;
    else if (key === 'Quality') item.quality = parseInt(val, 10) || 0;
    else if (key === 'Sockets') { item.sockets = val; item.links = maxLinks(val); }
    else if (key === 'Selected Variant') selectedVariant = +val;
    else if (key === 'Implicits') { implicitCount = +val; modStart = i + 1; break; }
  }
  if (modStart < 0) modStart = firstNonHeader; // very old exports without "Implicits:"
  if (modStart < 0) return item;

  let modIndex = 0;
  for (let k = modStart; k < lines.length; k++) {
    const l = lines[k];
    if (FLAG_LINES.has(l)) { applyFlag(item, l); continue; }
    modIndex++;
    const tags = {};
    let body = l.replace(/^(\{[^}]*\})+/, (all) => {
      for (const t of all.match(/\{[^}]*\}/g)) {
        const [k2, v] = t.slice(1, -1).split(/:(.*)/);
        tags[k2] = v ?? true;
      }
      return '';
    });
    if (tags.variant && selectedVariant != null && !String(tags.variant).split(',').map(Number).includes(selectedVariant)) continue;
    const range = tags.range != null ? +tags.range : ranges[modIndex] ?? 0.5;
    body = resolveRanges(body, range);
    let kind = modIndex <= implicitCount ? 'implicit' : 'explicit';
    if (tags.enchant) kind = 'enchant';
    else if (tags.crafted) kind = 'crafted';
    else if (tags.fractured) kind = 'fractured';
    else if (tags.implicit) kind = 'implicit';
    item.mods.push({ text: body, kind });
  }
  return item;
}

function applyFlag(item, l) {
  if (l === 'Corrupted') item.corrupted = true;
  else if (INFLUENCES[l]) item.influences.push(INFLUENCES[l]);
}

function maxLinks(s) {
  return Math.max(0, ...s.split(/\s+/).map((g) => g.split('-').length));
}

export function resolveRanges(text, r) {
  return text.replace(/\((-?[\d.]+)-(-?[\d.]+)\)/g, (_, a, b) => {
    const lo = +a, hi = +b;
    const dec = Math.max(decimals(a), decimals(b));
    const v = lo + (hi - lo) * r;
    return dec ? v.toFixed(dec) : String(Math.round(v));
  });
}
const decimals = (s) => (s.split('.')[1] || '').length;
