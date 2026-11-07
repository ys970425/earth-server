// 전쟁 버전 미리보기 데이터 만들기 (W2): PGlite 가짜 DB에 무역+전쟁을 설치하고
// 가져오기(war_admin_import)까지 한 뒤, war 표를 읽어 app/war/preview/state.json에 저장해요
// 실행: npm run war:preview  (두 번 실행해도 같은 결과가 나와요)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../app/trade/js/rules.js');   // 규칙 숫자는 무역 앱 rules.js를 그대로 씀
import { createDb, seedTradeState } from '../../tests/war/helpers.mjs';

const ctx = await createDb();
const seed = await seedTradeState(ctx);
const { db, rpc } = ctx;
// 무역 SQL 다음에 전쟁 SQL 설치 → 교사 uid로 「무역 게임에서 가져오기」 (tests/war/import.test.mjs와 같은 방식)
for (const f of ['schema.sql', 'functions.sql']) {
  await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
}
await rpc(seed.ADMIN, 'war_admin_import', '초기화');

// war 표 → 학생 화면 「투명한 정찰병」(S.obs && S.world)이 지도에 넘기는 모양
// (app/trade/js/student.js의 updateMap(): tiles는 [id, terrain, res, owner, imp],
//  cities·units는 app/trade/js/hexmap.js가 그리는 필드 이름)
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

const state = { game: { turn }, tiles, cities, units, countries };
mkdirSync(new URL('../../app/war/preview/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../app/war/preview/state.json', import.meta.url), JSON.stringify(state, null, 1));
console.log(`app/war/preview/state.json 저장: 나라 ${countries.length} · 칸 ${tiles.length} · 도시 ${cities.length} · 병력 ${units.length} (턴 ${turn})`);
