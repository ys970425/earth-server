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
for (const [t, co] of Object.entries(COUNTRIES)) cv.push(`(${q(t)},${co.capital[1] * RULES.W + co.capital[0]},'capital',${q(t)},'수도',0,false,null)`);
for (const cs of CITYSTATES) cv.push(`(${q(cs.id)},${cs.at[1] * RULES.W + cs.at[0]},'cs',${q(cs.owner)},${q(cs.name)},${cs.def},${cs.sea ? 'true' : 'false'},${q(cs.tech || null)})`);
lines.push(`insert into priv.cities(id, tile_id, kind, type, name, def, sea, tech) values\n${cv.join(',\n')}\n  on conflict (id) do update set tile_id = excluded.tile_id, kind = excluded.kind, type = excluded.type, name = excluded.name, def = excluded.def, sea = excluded.sea, tech = excluded.tech;`);

const out = [readFileSync(root + 'supabase/trade/schema.sql', 'utf8'), lines.join('\n\n'), readFileSync(root + 'supabase/trade/functions.sql', 'utf8')].join('\n\n');
writeFileSync(root + 'supabase/trade_setup.sql', out);
// 화면용 지도 데이터 (지형·자원·도시 위치는 공개 정보가 아니므로 서버에서 받음. 여기선 크기만)
console.log('written supabase/trade_setup.sql', (out.length / 1024).toFixed(0) + 'KB', Object.keys(tiles).length, 'tiles', cv.length, 'cities');
