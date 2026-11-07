import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../app/trade/js/rules.js');

export async function stateFromWar(db) {
  const typeOf = Object.fromEntries((await db.query('select id, type from war.countries')).rows.map(c => [c.id, c.type]));
  // 도시 그림: 무역 앱 priv.city_art()와 같은 규칙 (war 표 기준으로 다시 계산)
  const artOf = c => c.rebel ? 'factory' : c.boss ? 'boss' : c.final ? 'final'
    : c.kind === 'capital' ? (typeOf[c.country] || c.type) : c.tier >= 3 ? 'fortress' : c.sea ? 'harbor' : 'village';

  const tiles = (await db.query('select id, terrain, res, owner, imp from war.tiles order by id')).rows
    .map(t => [t.id, t.terrain, t.res, t.owner, t.imp]);
  const cityRows = (await db.query('select * from war.cities order by id')).rows;
  const unitRows = (await db.query('select id, country, kind, tile_id, hp from war.units order by id')).rows;
  const cities = cityRows.map(c => ({
    id: c.id, tile: c.tile_id, kind: c.kind, name: c.name, art: artOf(c), country: c.country,
    buildings: c.buildings, def: c.def, hp: c.hp, max_hp: c.max_hp, tier: c.tier, sea: c.sea,
    boss: c.boss, final: c.final, rebel: c.rebel
  }));
  const units = unitRows.map(u => ({ id: u.id, country: u.country, kind: u.kind, tile: u.tile_id, hp: u.hp, done: false }));
  // 오른쪽 창에 쓸 나라별 정보: 코인, 창고, 병력 수, 도시 수
  const inventory = {};
  for (const r of (await db.query('select country, item, qty from war.inventory order by country, item')).rows) {
    (inventory[r.country] = inventory[r.country] || {})[r.item] = r.qty;
  }
  const countries = (await db.query('select id, type, name, flag_url, coin, happy from war.countries order by id')).rows.map(c => ({
    id: c.id, type: c.type, name: c.name || R.TYPES[c.type].name, flag_url: c.flag_url, color: R.TYPES[c.type].color,
    coin: c.coin, happy: c.happy, inventory: inventory[c.id] || {},
    units: unitRows.filter(u => u.country === c.id).length,
    cities: cityRows.filter(x => x.country === c.id).length
  }));
  const turn = (await db.query('select turn from war.game')).rows[0].turn;

  return { game: { turn }, tiles, cities, units, countries };
}
