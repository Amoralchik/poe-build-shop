// Fetches market prices (poe.ninja) and trade stat ids (pathofexile.com)
// and writes compact static JSON into /data so the site can stay 100% static.
// poe.ninja and the trade API do not send CORS headers, so the browser
// cannot call them directly from GitHub Pages — this script runs in a
// scheduled GitHub Action instead.  Node 18+, no dependencies.

import { writeFile, mkdir } from 'node:fs/promises';

const UA = 'poe-build-shop (github pages price snapshot)';
const NINJA = 'https://poe.ninja/poe1/api';
const OUT = new URL('../data/', import.meta.url);

const ITEM_TYPES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'SkillGem'];
const STAT_GROUPS = ['pseudo', 'explicit', 'implicit', 'crafted', 'fractured', 'enchant'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await sleep(1500 * i);
    }
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function fetchLeague(league) {
  const out = { league, updated: new Date().toISOString(), currency: {}, uniques: [], gems: [] };

  const cur = await getJSON(`${NINJA}/economy/stash/current/currency/overview?league=${encodeURIComponent(league)}&type=Currency`);
  for (const l of cur.lines) if (l.chaosEquivalent) out.currency[l.currencyTypeName] = l.chaosEquivalent;
  out.currency['Chaos Orb'] = 1;

  for (const type of ITEM_TYPES) {
    await sleep(400);
    const d = await getJSON(`${NINJA}/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${type}`);
    for (const l of d.lines) {
      if (type === 'SkillGem') {
        // [name, level, quality, corrupted(0/1), chaos, listings]
        out.gems.push([l.name, l.gemLevel ?? 1, l.gemQuality ?? 0, l.corrupted ? 1 : 0, l.chaosValue, l.listingCount ?? l.count ?? 0]);
      } else {
        // [name, baseType, variant, links, chaos, listings, icon]
        out.uniques.push([l.name, l.baseType ?? '', l.variant ?? '', l.links ?? 0, l.chaosValue, l.listingCount ?? l.count ?? 0, l.icon ?? '']);
      }
    }
  }
  return out;
}

// Bulk-traded items (currency, essences, oils...) for the Market page and the
// live price chips in the guides.  [name, chaos, volume (chaos/day), change7d %, icon]
const EXCHANGE_TYPES = ['Currency', 'Fragment', 'Essence', 'Fossil', 'Resonator', 'Oil', 'DeliriumOrb', 'Scarab', 'Omen', 'Tattoo', 'Artifact', 'Catalyst', 'DivinationCard'];

async function fetchMarket(league) {
  const out = { league, updated: new Date().toISOString(), categories: {} };
  for (const type of EXCHANGE_TYPES) {
    await sleep(400);
    try {
      const d = await getJSON(`${NINJA}/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`);
      const items = new Map(d.items.map((i) => [i.id, i]));
      const rows = d.lines
        .map((l) => {
          const it = items.get(l.id);
          if (!it || l.primaryValue == null) return null;
          const change = l.sparkline?.totalChange;
          return [it.name, +l.primaryValue.toFixed(2), Math.round(l.volumePrimaryValue || 0), change == null ? null : +change.toFixed(1), it.image || ''];
        })
        .filter(Boolean)
        .sort((a, b) => b[1] - a[1]);
      if (rows.length) out.categories[type] = rows;
    } catch (e) {
      console.error(`  market ${type}: ${e.message}`);
    }
  }
  return out;
}

async function fetchStats() {
  const d = await getJSON('https://www.pathofexile.com/api/trade/data/stats');
  const out = {};
  for (const g of d.result) {
    if (!STAT_GROUPS.includes(g.id)) continue;
    out[g.id] = g.entries.map((e) => (e.option ? [e.id, e.text, 1] : [e.id, e.text]));
  }
  return out;
}

async function main() {
  await mkdir(new URL('prices/', OUT), { recursive: true });
  await mkdir(new URL('market/', OUT), { recursive: true });

  const idx = await getJSON(`${NINJA}/data/index-state`);
  const leagueInfo = idx.economyLeagues.filter((l) => !l.isPrivate);
  const leagues = leagueInfo.map((l) => l.name);
  const ninjaSlug = Object.fromEntries(leagueInfo.map((l) => [l.name, l.url]));
  const written = [];
  for (const league of leagues) {
    try {
      const data = await fetchLeague(league);
      const file = `${slug(league)}.json`;
      await writeFile(new URL(`prices/${file}`, OUT), JSON.stringify(data));
      const market = await fetchMarket(league);
      await writeFile(new URL(`market/${file}`, OUT), JSON.stringify(market));
      written.push({ name: league, file, ninja: ninjaSlug[league], updated: data.updated });
      console.log(`✓ ${league}: ${data.uniques.length} uniques, ${data.gems.length} gems`);
    } catch (e) {
      console.error(`✗ ${league}: ${e.message}`);
    }
  }
  if (!written.length) throw new Error('No league data fetched');
  await writeFile(new URL('leagues.json', OUT), JSON.stringify({ updated: new Date().toISOString(), leagues: written }, null, 1));

  try {
    const stats = await fetchStats();
    await writeFile(new URL('stats.json', OUT), JSON.stringify(stats));
    console.log('✓ trade stats');
  } catch (e) {
    console.error(`✗ trade stats (keeping previous file): ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
