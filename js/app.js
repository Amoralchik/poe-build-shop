import { hydrate } from './site.js'; // renders the shared header first
import { decodePobCode, parseXml, listLoadouts, parseBuild, slotGroup } from './pob.js';
import {
  PriceBook, formatPrice, loadStats, buildFilters,
  uniqueTradeUrl, gemTradeUrl, rareTradeUrl, defaultMin as defaultMinValue,
} from './market.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(k, d) { try { const v = localStorage.getItem('bs:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bs:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  leagues: [],
  book: null,
  entries: [],
  open: new Set(),
  manual: store.get('manual', {}), // key -> chaos
  opts: { usePseudo: true, tolerance: 0.9 },
};

const GROUPS = [
  ['gear', 'Equipment'],
  ['jewel', 'Jewels'],
  ['flask', 'Flasks'],
  ['gem', 'Gems'],
  ['swap', 'Weapon swap'],
];

// ------------------------------------------------------------------ boot

init();

async function init() {
  $('#target').value = store.get('target', '');
  $('#current').value = store.get('current', '');
  try {
    const [idx] = await Promise.all([fetchJSON('data/leagues.json'), loadStats('data/stats.json')]);
    state.leagues = idx.leagues;
    const saved = store.get('league');
    $('#league').innerHTML = idx.leagues.map((l) => `<option value="${esc(l.file)}">${esc(l.name)}</option>`).join('');
    if (saved && idx.leagues.some((l) => l.file === saved)) $('#league').value = saved;
    await loadLeague();
  } catch (e) {
    setStatus('Could not load market data: ' + e.message, true);
  }
  $('#league').addEventListener('change', async () => {
    store.set('league', $('#league').value);
    await loadLeague();
    if (state.entries.length) { reprice(); render(); }
  });
  $('#go').addEventListener('click', analyze);
  $('#target-loadout').addEventListener('change', () => state.docs && compute());
  $('#current-loadout').addEventListener('change', () => state.docs && compute());
  $('#target').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze(); });
  $('#opt-pseudo').addEventListener('change', (e) => { state.opts.usePseudo = e.target.checked; rebuildFilters(); render(); });
  $('#opt-tol').addEventListener('change', (e) => { state.opts.tolerance = +e.target.value; rebuildFilters(); render(); });
  $('#list').addEventListener('click', onListClick);
  $('#list').addEventListener('change', onListChange);
  $('#list').addEventListener('input', onListInput);
  if ($('#target').value.trim()) analyze();
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function loadLeague() {
  const file = $('#league').value;
  state.book = new PriceBook(await fetchJSON(`data/prices/${file}`));
  hydrate(document, { league: state.leagues.find((l) => l.file === file), categories: {}, get: () => null });
  const mins = Math.round((Date.now() - new Date(state.book.updated)) / 60000);
  const ago = mins < 90 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
  $('#freshness').textContent = `Prices updated ${ago} · 1 div = ${Math.round(state.book.divine)}c`;
}

function setStatus(msg, error = false) {
  $('#status').textContent = msg;
  $('#status').classList.toggle('error', error);
}

// ------------------------------------------------------------------ analyze

async function analyze() {
  const targetCode = $('#target').value;
  const currentCode = $('#current').value;
  store.set('target', targetCode);
  store.set('current', currentCode);
  if (!targetCode.trim()) return setStatus('Paste the target build’s PoB code first.', true);
  if (!state.book) return setStatus('Market data is still loading…', true);
  setStatus('Reading build…');
  try {
    state.docs = { target: await readDoc('target', targetCode), current: null };
  } catch (e) {
    return setStatus('Target build: ' + e.message, true);
  }
  if (currentCode.trim()) {
    try { state.docs.current = await readDoc('current', currentCode); }
    catch (e) { return setStatus('Current build: ' + e.message, true); }
  } else {
    fillLoadouts('current', null);
  }
  compute();
}

// Decode a code, list its loadouts and fill that input's picker.
async function readDoc(which, code) {
  const doc = parseXml(await decodePobCode(code));
  const info = listLoadouts(doc);
  fillLoadouts(which, info);
  return { doc, ...info };
}

function fillLoadouts(which, info) {
  const sel = $(`#${which}-loadout`);
  sel.parentElement.hidden = !info || info.loadouts.length < 2;
  if (!info) return (sel.innerHTML = '');
  sel.innerHTML = info.loadouts.map((l, i) => `<option value="${i}">${esc(l.name || `Loadout ${i + 1}`)}</option>`).join('');
  sel.value = String(info.defaultIndex);
}

function compute() {
  const pick = (which) => {
    const d = state.docs[which];
    return d && parseBuild(d.doc, d.loadouts[+$(`#${which}-loadout`).value] || d.loadouts[d.defaultIndex]);
  };
  let target, current;
  try {
    target = pick('target');
    current = pick('current');
  } catch (e) {
    return setStatus(e.message, true);
  }
  state.target = target;
  state.current = current;
  state.entries = makeEntries(target, current);
  state.open.clear();
  reprice();
  render();
  const who = [target.ascendancy || target.className, target.level && `level ${target.level}`].filter(Boolean).join(', ');
  setStatus(`${who} · ${target.items.length} items, ${state.entries.filter((e) => e.type === 'gem').length} gems`);
  $('#results').hidden = false;
}

function itemKey(it) { return `${it.slot}|${it.name}|${it.baseType}`; }

function makeEntries(target, current) {
  const entries = [];
  const curUniques = new Set((current?.items || []).filter((i) => i.rarity === 'UNIQUE').map((i) => i.name.toLowerCase()));
  const curBySlot = new Map((current?.items || []).map((i) => [i.slot, i]));
  const curGems = new Map();
  for (const g of current?.gems || []) {
    const k = g.name.toLowerCase();
    if (!curGems.has(k) || curGems.get(k).level < g.level) curGems.set(k, g);
  }

  for (const it of target.items) {
    const group = slotGroup(it.slot);
    const same = curBySlot.get(it.slot);
    const owned = it.rarity === 'UNIQUE'
      ? curUniques.has(it.name.toLowerCase())
      : !!same && same.name === it.name && same.baseType === it.baseType; // the very same rare
    entries.push({
      key: itemKey(it),
      type: 'item',
      group,
      item: it,
      owned,
      include: !owned && group !== 'swap',
      have: curBySlot.get(it.slot) || null,
      variant: 0,
      exactBase: !/^(Helmet|Body Armour|Gloves|Boots|Amulet|Ring|Belt|Jewel|Flask)/.test(it.slot) || /Abyssal/.test(it.slot),
      links: false,
      rows: it.rarity !== 'UNIQUE' ? buildFilters(it, state.opts) : null,
    });
  }

  // gems: one entry per gem name, highest level/quality wins
  const gems = new Map();
  for (const g of target.gems) {
    if (!g.enabled) continue;
    const k = g.name.toLowerCase();
    const prev = gems.get(k);
    if (!prev || g.level > prev.level || (g.level === prev.level && g.quality > prev.quality)) gems.set(k, g);
  }
  for (const [k, g] of gems) {
    const have = curGems.get(k);
    const owned = !!have && have.level >= Math.min(g.level, 20);
    entries.push({ key: 'gem|' + k, type: 'gem', group: 'gem', gem: g, owned, include: !owned, have: have || null });
  }
  return entries;
}

function rebuildFilters() {
  for (const e of state.entries) if (e.rows) e.rows = buildFilters(e.item, state.opts);
}

function reprice() {
  const book = state.book;
  for (const e of state.entries) {
    e.manual = state.manual[e.key] ?? null;
    if (e.type === 'gem') {
      const hit = book.gem(e.gem);
      e.price = hit ? hit.chaos : null;
      e.priceNote = hit ? `${hit.level}/${hit.quality}${hit.corrupted ? ' corrupted' : ''} · ${hit.listings} listed` : 'not on poe.ninja';
      e.lowConfidence = hit && hit.listings < 5;
    } else if (e.item.rarity === 'UNIQUE') {
      e.options = book.uniqueOptions(e.item);
      const o = e.options[e.variant] || e.options[0];
      e.price = o ? o.chaos : null;
      e.icon = o?.icon;
      e.priceNote = o ? `${o.listings} listed${o.variant ? ' · ' + o.variant : ''}${o.links ? ' · ' + o.links + 'L' : ''}` : 'not on poe.ninja';
      e.lowConfidence = o && o.listings < 5;
    } else {
      e.price = null;
      e.priceNote = 'check trade';
    }
  }
}

const effectivePrice = (e) => (e.manual != null ? e.manual : e.price);

// ------------------------------------------------------------------ render

function render() {
  renderSummary();
  const book = state.book;
  let html = '';
  for (const [g, title] of GROUPS) {
    const list = state.entries.filter((e) => e.group === g);
    if (!list.length) continue;
    const sum = list.filter((e) => e.include).reduce((s, e) => s + (effectivePrice(e) || 0), 0);
    html += `<h2 class="group-title">${title}<span class="muted">${formatPrice(sum, book)}</span></h2>`;
    html += list.map(renderEntry).join('');
  }
  $('#list').innerHTML = html;
}

function renderSummary() {
  const book = state.book;
  const inc = state.entries.filter((e) => e.include);
  const total = inc.reduce((s, e) => s + (effectivePrice(e) || 0), 0);
  const unpriced = inc.filter((e) => effectivePrice(e) == null);
  const owned = state.entries.filter((e) => e.owned).length;
  const by = (g) => inc.filter((e) => e.group === g).reduce((s, e) => s + (effectivePrice(e) || 0), 0);
  const chaosNote = book.divine && total >= book.divine ? `${Math.round(total).toLocaleString()} chaos` : '';
  $('#summary').innerHTML = `
    <div class="total"><div class="k">Estimated cost</div><div class="v">${formatPrice(total, book)}</div>
      <div class="sub">${chaosNote}${unpriced.length ? `${chaosNote ? ' · ' : ''}+ ${unpriced.length} item${unpriced.length > 1 ? 's' : ''} without a price` : ''}</div></div>
    <div><div class="k">Equipment</div><div class="v">${formatPrice(by('gear'), book)}</div></div>
    <div><div class="k">Jewels & flasks</div><div class="v">${formatPrice(by('jewel') + by('flask'), book)}</div></div>
    <div><div class="k">Gems</div><div class="v">${formatPrice(by('gem'), book)}</div></div>
    <div><div class="k">Already owned</div><div class="v">${state.current ? owned : '—'}</div>
      <div class="sub">${state.current ? 'skipped from total' : 'add your build to compare'}</div></div>`;
}

function renderEntry(e) {
  const book = state.book;
  const open = state.open.has(e.key);
  const price = effectivePrice(e);
  let icon, name, meta, url;
  if (e.type === 'gem') {
    const g = e.gem;
    icon = `<div class="icon ph">gem</div>`;
    name = `<div class="name GEM">${esc(g.name)}${g.support && !/Support$/.test(g.name) ? ' Support' : ''}</div>`;
    meta = `Level ${g.level}${g.quality ? ` · ${g.quality}% quality` : ''}`;
    url = gemTradeUrl(g, book.league);
  } else {
    const it = e.item;
    icon = e.icon ? `<img class="icon" src="${esc(e.icon)}" alt="" loading="lazy">` : `<div class="icon ph">${it.rarity === 'RARE' ? 'rare' : ''}</div>`;
    const title = it.rarity === 'UNIQUE' || it.rarity === 'RARE' ? it.name : it.baseType || it.name;
    name = `<div class="name ${esc(it.rarity)}">${esc(title)}</div>`;
    const bits = [it.slot];
    if (it.rarity !== 'MAGIC' && it.rarity !== 'NORMAL' && it.baseType) bits.unshift(it.baseType);
    if (it.links >= 5) bits.push(`${it.links}-link`);
    if (it.corrupted) bits.push('corrupted');
    meta = bits.map(esc).join(' · ');
    url = it.rarity === 'UNIQUE' ? uniqueTradeUrl(it, book.league) : rareTradeUrl(it, e.rows, book.league, { exactBase: e.exactBase, tolerance: state.opts.tolerance, links: e.links });
  }
  const badges = [
    e.owned ? '<span class="badge owned">owned</span>' : '',
    e.lowConfidence ? '<span class="badge warn" title="Few listings — price may be off">few listed</span>' : '',
    e.manual != null ? '<span class="badge">your price</span>' : '',
  ].join('');
  const priceHtml = price != null
    ? `${formatPrice(price, book)}<span class="muted">${esc(e.manual != null ? 'set by you' : e.priceNote)}</span>`
    : `<span class="muted">${esc(e.priceNote)}</span>`;

  return `
  <div class="row${e.include ? '' : ' off'}" data-key="${esc(e.key)}">
    <div class="row-main" data-act="toggle-open">
      <input type="checkbox" data-act="include" ${e.include ? 'checked' : ''} aria-label="Include in total">
      ${icon}
      <div>${name}<div class="meta">${meta}${badges}</div></div>
      <div class="price">${priceHtml}</div>
      <div class="row-actions">
        <a class="btn sm" data-act="open-trade" data-url="${esc(url)}" href="${esc(url)}" target="_blank" rel="noopener" title="Open trade search in a new tab">Trade ↗</a>
        <button class="btn sm" data-act="copy" data-url="${esc(url)}" title="Copy trade link">Copy</button>
      </div>
    </div>
    <div class="detail" ${open ? '' : 'hidden'}>${open ? renderDetail(e) : ''}</div>
  </div>`;
}

function renderDetail(e) {
  const book = state.book;
  if (e.type === 'gem') {
    const h = e.have;
    return `<div class="hint">Price is for the closest poe.ninja listing: ${esc(e.priceNote)}.</div>
      ${h ? `<div class="compare">You have <b>${esc(h.name)}</b> level ${h.level}${h.quality ? `, ${h.quality}% quality` : ''}.</div>` : ''}`;
  }
  const it = e.item;
  let html = '';
  if (it.rarity === 'UNIQUE') {
    if (e.options?.length > 1) {
      html += `<div class="detail-opts"><label>Variant
        <select data-act="variant">${e.options.map((o, i) => `<option value="${i}" ${i === e.variant ? 'selected' : ''}>${esc([o.variant || 'default', o.links ? o.links + 'L' : '', formatPrice(o.chaos, book), o.listings + ' listed'].filter(Boolean).join(' · '))}</option>`).join('')}</select></label></div>`;
    }
    html += `<div class="plain-mods">${it.mods.map((m) => `<div class="${m.kind === 'implicit' ? 'impl' : ''}">${esc(m.text)}</div>`).join('')}</div>`;
  } else {
    html += `<div class="hint">Tick the mods you need. Untick the ones you already cover elsewhere (like a resistance) to find cheaper items. The trade link updates as you go.</div>`;
    html += `<div class="mods">${e.rows.map((r, i) => {
      const val = r.min ?? defaultMin(r);
      return `<label class="mod${r.stat ? '' : ' nostat'}" ${r.title ? `title="${esc('From:\n' + r.title)}"` : ''}>
        <input type="checkbox" data-act="mod" data-i="${i}" ${r.on ? 'checked' : ''} ${r.stat ? '' : 'disabled'}>
        <span>${esc(r.label)}<span class="kind">${r.stat ? (r.kind === 'explicit' ? '' : r.kind) : 'not searchable'}</span></span>
        ${r.stat && r.stat.value != null ? `<input type="number" data-act="min" data-i="${i}" value="${val}" step="any" aria-label="Minimum value">` : '<span></span>'}
      </label>`;
    }).join('')}</div>`;
    html += `<div class="detail-opts">
      <label><input type="checkbox" data-act="exact" ${e.exactBase ? 'checked' : ''}> Only ${esc(it.baseType || 'this base')}</label>
      ${it.links >= 5 ? `<label><input type="checkbox" data-act="links" ${e.links ? 'checked' : ''}> ${it.links}-link only</label>` : ''}
      <label class="manual">My price
        <input type="number" min="0" step="any" data-act="manual" value="${e.manual != null ? +(e.manual / (book.divine || 1)).toFixed(2) : ''}" placeholder="0"> div
      </label>
    </div>`;
  }
  if (e.have && e.have.name !== it.name) {
    const h = e.have;
    html += `<div class="compare">In this slot you have <b class="name ${esc(h.rarity)}">${esc(h.name)}</b> ${h.baseType && h.baseType !== h.name ? esc(h.baseType) : ''}
      <div class="plain-mods">${h.mods.filter((m) => m.kind !== 'enchant').map((m) => `<div class="${m.kind === 'implicit' ? 'impl' : ''}">${esc(m.text)}</div>`).join('')}</div></div>`;
  }
  return html;
}

const defaultMin = (r) => defaultMinValue(r.stat.value, state.opts.tolerance);

// ------------------------------------------------------------------ events

const entryOf = (el) => state.entries.find((e) => e.key === el.closest('.row')?.dataset.key);

function onListClick(ev) {
  const act = ev.target.closest('[data-act]');
  if (!act) return;
  const e = entryOf(act);
  if (!e) return;
  switch (act.dataset.act) {
    case 'open-trade':
      ev.stopPropagation(); // let the link open its tab, but don't expand the row
      break;
    case 'copy':
      ev.stopPropagation();
      navigator.clipboard.writeText(act.dataset.url).then(() => {
        act.textContent = 'Copied';
        setTimeout(() => (act.textContent = 'Copy'), 1200);
      });
      break;
    case 'include':
      ev.stopPropagation();
      break;
    case 'toggle-open':
      if (ev.target.closest('.detail')) return;
      state.open.has(e.key) ? state.open.delete(e.key) : state.open.add(e.key);
      rerenderRow(e);
      break;
  }
}

function onListChange(ev) {
  const t = ev.target;
  const e = entryOf(t);
  if (!e) return;
  switch (t.dataset.act) {
    case 'include': e.include = t.checked; render(); break;
    case 'mod': e.rows[+t.dataset.i].on = t.checked; refreshLinks(e); break;
    case 'exact': e.exactBase = t.checked; refreshLinks(e); break;
    case 'links': e.links = t.checked; refreshLinks(e); break;
    case 'variant': e.variant = +t.value; reprice(); render(); break;
    case 'manual': {
      const v = parseFloat(t.value);
      if (isNaN(v)) delete state.manual[e.key];
      else state.manual[e.key] = v * (state.book.divine || 1);
      store.set('manual', state.manual);
      reprice();
      render();
      break;
    }
  }
}

function onListInput(ev) {
  const t = ev.target;
  if (t.dataset.act !== 'min') return;
  const e = entryOf(t);
  const v = parseFloat(t.value);
  e.rows[+t.dataset.i].min = isNaN(v) ? null : v;
  refreshLinks(e);
}

// Update only the trade links of one row (keeps focus in the inputs).
function refreshLinks(e) {
  const url = rareTradeUrl(e.item, e.rows, state.book.league, { exactBase: e.exactBase, tolerance: state.opts.tolerance, links: e.links });
  const row = document.querySelector(`.row[data-key="${CSS.escape(e.key)}"]`);
  row?.querySelectorAll('[data-url]').forEach((b) => {
    b.dataset.url = url;
    if (b.tagName === 'A') b.href = url;
  });
}

function rerenderRow(e) {
  const row = document.querySelector(`.row[data-key="${CSS.escape(e.key)}"]`);
  if (!row) return render();
  const tmp = document.createElement('div');
  tmp.innerHTML = renderEntry(e);
  row.replaceWith(tmp.firstElementChild);
}
