// E1 (H2): 전쟁 규칙 숫자를 서버용 SQL로 만들기 -> supabase/war/config.sql
// app/war/js/war-rules.js와 app/trade/js/rules.js를 읽어 war.config(한 행, jsonb)에 넣는 문장을 만든다.
// tools/trade/build-sql.mjs가 priv.config를 만드는 방식을 따른다. 두 번 실행해도 같은 파일.
// 실행: npm run war:config
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../../app/trade/js/rules.js');
const W = require('../../app/war/js/war-rules.js');

// 서버는 함수를 받을 수 없어서 시장 관세 함수를 숫자로 바꿔 넣는다 (기준가 × 0.5, 버림)
const config = {
  ITEMS: R.ITEMS,
  ROLES: W.ROLES,
  BRANCH: W.BRANCH,
  EXTRA_UNITS: W.EXTRA_UNITS,
  BOSS: { str: W.BOSS.str(), damageMax: W.BOSS.damageMax },
  BUILDING_CLASS: W.BUILDING_CLASS,
  SPECIALTY: W.SPECIALTY,
  TILE_IMP: W.TILE_IMP,
  MARKET: {
    cities: W.MARKET.cities.map(m => ({ name: m.name, c: m.c, r: m.r, art: 'neutral_' + m.art })),
    stock: W.MARKET.stock,
    tariff: { mult: 0.5, floor: true },   // war-rules.js의 tariff(ref) 함수와 같은 규칙
    tariffNoSpecialtyMult: W.MARKET.tariffNoSpecialtyMult
  },
  SPECIALTY_ITEM: W.SPECIALTY_ITEM,
  MOVES: W.MOVES,
  MISSIONS: W.MISSIONS,
  OPEN_STAGES: W.OPEN_STAGES,
  TURN: W.TURN,
  POLL_MS: W.POLL_MS,
  CAPITAL: W.CAPITAL,
  REPAIR: W.REPAIR,
  SHIELD_TURNS: W.SHIELD_TURNS,
  MAX_CITY_LOSS: W.MAX_CITY_LOSS,
  PEACE_TURNS: W.PEACE_TURNS
};
if (config.BOSS.str !== 95) throw new Error(`특수 부대 힘이 95가 아니에요 (${config.BOSS.str})`);
if (!Number.isInteger(config.TURN.seconds) || config.TURN.seconds !== 180) throw new Error('턴 기본값이 180초가 아니에요');

const lines = [
  '-- 전쟁의 시간 규칙 숫자 (자동 생성): node tools/war/build-config.mjs',
  '-- 무역 앱 rules.js와 app/war/js/war-rules.js에서 계산한 값이에요. 이 파일을 손으로 고치지 마세요.',
  'create table if not exists war.config (id int primary key default 1 check (id = 1), data jsonb not null);',
  `insert into war.config(id, data) values (1, $cfg$${JSON.stringify(config)}$cfg$::jsonb)`,
  '  on conflict (id) do update set data = excluded.data;',
  '-- 규칙 숫자 읽기 (전쟁 함수들이 security definer로 부름)',
  'create or replace function war.cfg() returns jsonb',
  'language sql stable as $$ select data from war.config where id = 1 $$;',
  'revoke all on war.config from public;',
  'revoke execute on function war.cfg() from public;'
];
const out = lines.join('\n') + '\n';
writeFileSync(new URL('../../supabase/war/config.sql', import.meta.url), out);
console.log(`written supabase/war/config.sql ${(out.length / 1024).toFixed(1)}KB (특수 부대 힘 ${config.BOSS.str})`);
