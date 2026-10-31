// supabase/trade_setup.sql 만들기: 스키마 + 규칙·지도 데이터 + 함수
// node tools/trade/build-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildMap, CITYSTATES, COUNTRIES, key } from './map.mjs';
const require = createRequire(import.meta.url);
const RULES = require('../../app/trade/js/rules.js');
const root = new URL('../../', import.meta.url).pathname;

const tiles = buildMap(7);
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const lines = [];
lines.push('-- ---------------------------------------------------------------------');
lines.push('-- 규칙 숫자와 지도 (자동 생성)');
lines.push('-- ---------------------------------------------------------------------');
lines.push(`insert into priv.config(id, data) values (1, $cfg$${JSON.stringify(RULES)}$cfg$::jsonb)
  on conflict (id) do update set data = excluded.data;`);
const tv = Object.values(tiles).map(t => `(${t.r * RULES.W + t.c},${t.c},${t.r},${q(t.zone)},${q(t.terrain)},${q(t.res)})`);
lines.push(`insert into priv.tiles(id, c, r, zone, terrain, res) values\n${tv.join(',\n')}\n  on conflict (id) do update set c = excluded.c, r = excluded.r, zone = excluded.zone, terrain = excluded.terrain, res = excluded.res;`);
const cv = [];
const T = RULES.CS_TIERS;
for (const [t, co] of Object.entries(COUNTRIES)) cv.push(`(${q(t)},${co.capital[1] * RULES.W + co.capital[0]},'capital',${q(t)},'수도',0,false,null,0,0,0,false,false)`);
for (const cs of CITYSTATES) {
  const tr = T[cs.tier];
  // 튜토리얼 도시국가: 그 나라 핵심 기술자들이 기다리고 있어요
  const tech = cs.tutorial ? (RULES.TYPES[cs.owner].techs || []).join(',') : (cs.tech || null);
  cv.push(`(${q(cs.id)},${cs.at[1] * RULES.W + cs.at[0]},'cs',${q(cs.owner)},${q(cs.name)},${tr.def},${cs.island ? 'true' : 'false'},${q(tech)},${cs.tier},${tr.hp},${tr.coin},${cs.tutorial ? 'true' : 'false'},${cs.boss ? 'true' : 'false'})`);
}
lines.push(`delete from priv.cities where id not in (${cv.map(v => v.slice(1, v.indexOf(','))).join(',')});`);
lines.push(`delete from priv.tiles where id >= ${RULES.W * RULES.H};`);
lines.push(`insert into priv.cities(id, tile_id, kind, type, name, def, sea, tech, tier, max_hp, bonus, tutorial, boss) values\n${cv.join(',\n')}\n  on conflict (id) do update set tile_id = excluded.tile_id, kind = excluded.kind, type = excluded.type, name = excluded.name, def = excluded.def, sea = excluded.sea, tech = excluded.tech, tier = excluded.tier, max_hp = excluded.max_hp, bonus = excluded.bonus, tutorial = excluded.tutorial, boss = excluded.boss;`);

const out = [readFileSync(root + 'supabase/trade/schema.sql', 'utf8'), lines.join('\n\n'), readFileSync(root + 'supabase/trade/functions.sql', 'utf8')].join('\n\n');
writeFileSync(root + 'supabase/trade_setup.sql', out);
// 화면용 지도 데이터 (지형·자원·도시 위치는 공개 정보가 아니므로 서버에서 받음. 여기선 크기만)
console.log('written supabase/trade_setup.sql', (out.length / 1024).toFixed(0) + 'KB', Object.keys(tiles).length, 'tiles', cv.length, 'cities');
