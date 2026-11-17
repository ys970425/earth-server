// 실제 설치용 SQL 묶음 만들기 (E13): war 스키마만 설치하고, 무역 스키마(priv·public의 무역 표·함수)는 건드리지 않아요.
// 실행: node tools/war/build-install-sql.mjs            → dist/war-install/ 에 파일 생성 (읽기 전용 점검 SQL 포함)
//       node tools/war/build-install-sql.mjs --verify   → 가짜 DB(PGlite)에서 두 번·세 번 설치해 「무역 무변경·반복 안전」을 증명
// 만든 파일은 supabase/war/*.sql을 이어 붙인 것뿐이에요 (supabase/war는 읽기만 해요).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDb, seedTradeState } from '../../tests/war/helpers.mjs';

const ROOT = new URL('../../', import.meta.url);
const OUT = new URL('dist/war-install/', ROOT);
const PARTS = ['schema.sql', 'config.sql', 'functions.sql'];
const read = rel => readFileSync(new URL(rel, ROOT), 'utf8');
const verify = process.argv.includes('--verify');
const warnings = [];

// ---------- 1. 이어 붙이기 + 안전 검사 ----------
const sources = PARTS.map(f => ({ f, sql: read('supabase/war/' + f) }));
for (const rule of [['app/war/js/war-rules.js', 'supabase/war/config.sql']]) {
  if (statSync(new URL(rule[0], ROOT)).mtimeMs > statSync(new URL(rule[1], ROOT)).mtimeMs + 1000)
    warnings.push('config.sql이 war-rules.js보다 오래됐어요. 먼저 npm run war:config 를 실행하세요.');
}
const all = sources.map(s => s.sql).join('\n');
// 주석·문자열을 빼고 위험한 문장이 있는지 훑어요 (함수 본문 안의 일반 insert/update는 허용, 무역 구조를 바꾸는 문장만 막아요)
const stripped = all.replace(/\$cfg\$[\s\S]*?\$cfg\$/g, "''").replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
const BAD = [
  [/\bdrop\s+(table|schema|type|view|index|trigger|extension)\b/i, 'drop 문'],
  [/\balter\s+(table|schema|type|view)\s+(if\s+exists\s+)?(only\s+)?(priv|public)\./i, 'priv/public 표 구조 변경'],
  [/\bcreate\s+(or\s+replace\s+)?(table|view|trigger|type)\s+(if\s+not\s+exists\s+)?(priv|public)\./i, 'priv/public 표·뷰 만들기'],
  [/\bcreate\s+or\s+replace\s+function\s+priv\./i, '무역 priv 함수 덮어쓰기'],
  [/\bcreate\s+or\s+replace\s+function\s+public\.(?!war_)/i, '무역 public 함수 덮어쓰기 (war_ 로 시작하지 않음)'],
  [/\bdrop\s+function\s+(?!(?:if\s+exists\s+)?war\.)/i, 'war. 가 아닌 함수 drop'],
  [/\balter\s+(role|database|system)\b/i, 'alter role/database'],
  [/\bcreate\s+extension\b/i, 'create extension'],
];
const problems = BAD.filter(([re]) => re.test(stripped)).map(([, why]) => why);
// truncate는 war. 표만 허용 (문장 하나씩 잘라서 모든 대상이 war. 로 시작하는지 봐요)
for (const m of stripped.matchAll(/\btruncate\s+(?:table\s+)?([^;]*);/gi))
  if (m[1].split(',').some(t => !/^\s*(only\s+)?war\./i.test(t))) problems.push('war 밖의 표 truncate');
if (problems.length) { console.error('❌ 설치 SQL에 위험한 문장이 있어요: ' + problems.join(', ')); process.exit(1); }

const fnNames = [...new Set([...all.matchAll(/create\s+or\s+replace\s+function\s+public\.(war_[a-z0-9_]+)/gi)].map(m => m[1]))].sort();
const sha = createHash('sha256').update(all).digest('hex').slice(0, 12);
const header = `-- ============================================================================
-- 지구 서버: 전쟁의 시간 — 실제 설치 (war 스키마 전용)
-- 만든 때: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 지문 ${sha} · 함수 ${fnNames.length}개
-- 무역 게임의 표·함수는 건드리지 않아요 (새 war 스키마와 public.war_* 함수만 만들어요).
-- 여러 번 실행해도 안전해요 (있으면 그대로 두고, 빠진 것만 더해요). 한 번에 전부 성공하거나 전부 취소돼요.
-- ============================================================================
begin;
`;
const bundle = header + sources.map(s => `\n-- ===== ${s.f} =====\n${s.sql.trim()}\n`).join('') + '\ncommit;\n';

// ---------- 2. 무역 쪽에서 war가 읽는 것들 (설치 전 점검용) ----------
const tradeRefs = (() => {
  const body = all.replace(/--[^\n]*/g, '');
  const tables = new Set(), funcs = new Set();
  for (const m of body.matchAll(/\b(priv|public)\.([a-z_][a-z0-9_]*)\s*(\()?/gi)) {
    const [, schema, name, paren] = m;
    if (schema === 'public' && name.startsWith('war_')) continue;
    (paren ? funcs : tables).add(schema + '.' + name);
  }
  return { tables: [...tables].sort(), funcs: [...funcs].sort() };
})();

// 저장소의 무역 SQL을 가짜 DB에 깔아 「표마다 열 목록」을 뽑아요 → 실제 Supabase의 무역 설치가 같은 모양인지 비교하는 기준
const ctx = await createDb();
const { db } = ctx;
// 함수 호출로 잡힌 이름이 실제로는 표(예: public.game)일 수도 있어서 카탈로그로 다시 분류해요
const kindOf = async full => {
  const [s, n] = full.split('.');
  const t = (await db.query(`select 1 from information_schema.tables where table_schema=$1 and table_name=$2`, [s, n])).rows.length;
  const f = (await db.query(`select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname=$1 and p.proname=$2`, [s, n])).rows.length;
  return t ? 'table' : f ? 'function' : 'unknown';
};
const tables = [], funcs = [], unknown = [];
for (const full of [...tradeRefs.tables, ...tradeRefs.funcs]) {
  const k = await kindOf(full);
  (k === 'table' ? tables : k === 'function' ? funcs : unknown).push(full);
}
const cols = [];
for (const t of tables) {
  const [s, n] = t.split('.');
  for (const r of (await db.query(`select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position`, [s, n])).rows)
    cols.push([s, n, r.column_name]);
}
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const values = [
  ...tables.map(t => `('table', ${q(t.split('.')[0])}, ${q(t.split('.')[1])}, null)`),
  ...funcs.map(t => `('function', ${q(t.split('.')[0])}, ${q(t.split('.')[1])}, null)`),
  ...cols.map(([s, n, c]) => `('column', ${q(s)}, ${q(n)}, ${q(c)})`),
];
const preflight = `-- 설치 전 점검 (읽기만 해요. 아무것도 바꾸지 않아요)
-- 실제 Supabase의 무역 설치에 war가 필요로 하는 표·열·함수가 다 있는지 봐요.
-- 결과 한 줄의 result 가 ✅ 이면 설치해도 돼요. ❌ 이면 missing 칸을 복사해서 알려 주세요.
with need(kind, sch, name, col) as (values
${values.join(',\n')}
), missing as (
  select * from need n where
    (kind = 'table'    and not exists (select 1 from information_schema.tables t where t.table_schema = n.sch and t.table_name = n.name))
 or (kind = 'function' and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = n.sch and p.proname = n.name))
 or (kind = 'column'   and not exists (select 1 from information_schema.columns c where c.table_schema = n.sch and c.table_name = n.name and c.column_name = n.col))
)
select case when count(*) = 0 then '✅ 준비 완료 — 설치해도 돼요' else '❌ 무역 설치에 빠진 것이 ' || count(*) || '개 있어요 — 설치하지 말고 알려 주세요' end as result,
       coalesce(string_agg(kind || ' ' || sch || '.' || name || coalesce('.' || col, ''), ', ' order by kind, sch, name, col), '') as missing
from missing;
`;
const postcheck = `-- 설치 뒤 점검 (읽기만 해요)
-- ✅ 한 줄이면 성공이에요. ❌ 이면 problems 칸을 복사해서 알려 주세요.
with expected(fn) as (values ${fnNames.map(f => `(${q(f)})`).join(', ')}),
probs as (
  select 'war 스키마 없음' as p where not exists (select 1 from information_schema.schemata where schema_name = 'war')
  union all select 'war.config 비어 있음' where not exists (select 1 from information_schema.tables where table_schema = 'war' and table_name = 'config')
     or (select count(*) from war.config) <> 1
  union all select '함수 없음: ' || e.fn from expected e
    where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = e.fn)
  union all select '학생(authenticated) 실행 권한 없음: ' || e.fn from expected e
    join pg_proc p on p.proname = e.fn join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where exists (select 1 from pg_roles where rolname = 'authenticated') and not has_function_privilege('authenticated', p.oid, 'execute')
  union all select 'war 표를 일반 사용자가 직접 읽을 수 있음: ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'war' and c.relkind = 'r' and exists (select 1 from pg_roles where rolname = 'anon') and has_table_privilege('anon', c.oid, 'select')
)
select case when count(*) = 0 then '✅ 설치 성공 — war 함수 ${fnNames.length}개, 권한 정상' else '❌ 문제 ' || count(*) || '개' end as result,
       coalesce(string_agg(p, ' / '), '') as problems from probs;
`;
const ops = {
  'status.sql': `-- 지금 게임 상태 (읽기만): 턴·타이머·일시정지·전투 잠금·역할 배정 수
select g.turn as 턴, g.turn_seconds as 턴_초, g.turn_end as 턴_끝나는_때, g.paused as 일시정지, g.combat_on as 전투_가능,
  (select count(*) from war.roles) as 역할_배정_수, (select count(*) from war.roles where absent) as 결석_수,
  (select count(*) from war.units) as 병력_수
from war.game g where g.id = 1;
`,
  'combat-off.sql': `-- 전투 잠금 켜기 (공격·점령이 모두 「싸울 수 없는 시간이에요」로 막혀요. 이동·생산·예산 연습은 그대로)
update war.game set combat_on = false where id = 1;
select war.bump('game');
select combat_on as 전투_가능 from war.game where id = 1;   -- false 이면 잠긴 거예요
`,
  'combat-on.sql': `-- 전투 잠금 풀기 (연습 턴이 끝나면 실행)
update war.game set combat_on = true where id = 1;
select war.bump('game');
select combat_on as 전투_가능 from war.game where id = 1;   -- true 이면 풀린 거예요
`,
  'turn-seconds.sql': `-- 턴 시간 바꾸기: 아래 숫자(초)만 고쳐서 실행. 다음에 「다음 턴」을 누를 때부터 적용돼요. (60~600)
--   연습 턴 5분 = 300, 본 게임 3분 = 180, 4분 = 240
update war.game set turn_seconds = 180 where id = 1;
select war.bump('game');
select turn_seconds as 턴_초 from war.game where id = 1;
`,
};
mkdirSync(new URL('ops/', OUT), { recursive: true });
writeFileSync(new URL('00-preflight.sql', OUT), preflight);
writeFileSync(new URL('01-war-install.sql', OUT), bundle);
writeFileSync(new URL('02-postcheck.sql', OUT), postcheck);
for (const [name, sql] of Object.entries(ops)) writeFileSync(new URL('ops/' + name, OUT), sql);
console.log(`dist/war-install/ 저장: 01-war-install.sql ${(bundle.length / 1024).toFixed(0)}KB · war_ 함수 ${fnNames.length}개 · 점검 대상 표 ${tables.length}·열 ${cols.length}·함수 ${funcs.length}${unknown.length ? ' · 분류 못 한 이름 ' + unknown.join(',') : ''}`);
for (const w of warnings) console.warn('⚠ ' + w);

// ---------- 3. 증명 (--verify) ----------
async function tradeSnapshot() {
  const out = {};
  const t = (await db.query(`select table_schema s, table_name n from information_schema.tables
    where table_schema in ('priv','public') and table_type = 'BASE TABLE' order by 1,2`)).rows;
  for (const { s, n } of t) {
    out[`data ${s}.${n}`] = (await db.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h, count(*)::int c from ${s}.${n} x`)).rows[0];
  }
  out.columns = (await db.query(`select md5(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable, '|' order by 1)) h
    from information_schema.columns where table_schema in ('priv','public')`)).rows[0].h;
  out.functions = (await db.query(`select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid::regprocedure::text)) h, count(*)::int c
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('priv','public') and p.prokind = 'f' and p.proname not like 'war\\_%'`)).rows[0];
  out.acl = (await db.query(`select md5(coalesce(string_agg(n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,''), '|' order by n.nspname, c.relname), '')) h
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('priv','public')`)).rows[0].h;
  out.fnacl = (await db.query(`select md5(coalesce(string_agg(p.oid::regprocedure::text||':'||coalesce(p.proacl::text,''), '|' order by p.oid::regprocedure::text), '')) h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('priv','public') and p.proname not like 'war\\_%'`)).rows[0].h;
  return out;
}
async function warSnapshot() {
  const out = {};
  const t = (await db.query(`select table_name n from information_schema.tables where table_schema = 'war' and table_type = 'BASE TABLE' order by 1`)).rows;
  for (const { n } of t) out['data war.' + n] = (await db.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h, count(*)::int c from war.${n} x`)).rows[0];
  out.functions = (await db.query(`select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid::regprocedure::text)) h, count(*)::int c
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prokind = 'f' and (n.nspname = 'war' or (n.nspname = 'public' and p.proname like 'war\\_%'))`)).rows[0];
  return out;
}
function diff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

if (verify) {
  let fails = 0;
  const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
  const seed = await seedTradeState(ctx);
  const rpc = ctx.rpc;
  console.log('— 증명: 무역 스키마 무변경 · 반복 설치 안전');
  const before = await tradeSnapshot();
  ok(Object.keys(before).length > 10, `무역 표 ${Object.keys(before).filter(k => k.startsWith('data ')).length}개의 지문을 떴어요`);

  // 점검 SQL이 설치 전에 ✅ 를 내는지 (저장소의 무역 SQL은 갖춰져 있어야 해요)
  const pre = (await db.query(preflight)).rows[0];
  ok(pre.result.startsWith('✅'), '설치 전 점검 SQL: ' + pre.result + (pre.missing ? ' — ' + pre.missing : ''));

  await db.exec(bundle);
  const after1 = await tradeSnapshot();
  const d1 = diff(before, after1);
  ok(d1.length === 0, '설치 1회 뒤 무역 표 데이터·열·함수·권한 모두 그대로' + (d1.length ? ' — 달라진 것: ' + d1.join(', ') : ''));
  const war1 = await warSnapshot();
  const post = (await db.query(postcheck)).rows[0];
  ok(post.result.startsWith('✅'), '설치 뒤 점검 SQL: ' + post.result + (post.problems ? ' — ' + post.problems : ''));

  await db.exec(bundle);
  const after2 = await tradeSnapshot();
  ok(diff(before, after2).length === 0, '설치 2회 뒤에도 무역은 그대로');
  const war2 = await warSnapshot();
  const dw = diff(war1, war2);
  ok(dw.length === 0, '두 번 설치해도 war 표·함수가 같음' + (dw.length ? ' — 달라진 것: ' + dw.join(', ') : ''));

  // 이미 게임이 진행 중일 때 다시 실행해도 학생 진행이 지워지지 않는지: 가져오기 + 병력 이동 뒤 한 번 더 설치
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const some = (await db.query(`select id from war.units where kind not in ('worker','scout') order by id limit 1`)).rows[0];
  await db.query(`update war.units set hp = 77 where id = $1`, [some.id]);
  const tradeMid = await tradeSnapshot();
  const warMid = await warSnapshot();
  await db.exec(bundle);
  const warAfter = await warSnapshot();
  ok(diff(warMid, warAfter).length === 0, '게임이 진행 중일 때 다시 설치해도 war 진행 데이터(병력·도시·지갑·외교)가 그대로' + (diff(warMid, warAfter).length ? ' — ' + diff(warMid, warAfter).join(', ') : ''));
  ok(diff(tradeMid, await tradeSnapshot()).length === 0, '그때도 무역은 그대로');
  ok((await db.query(`select hp from war.units where id = $1`, [some.id])).rows[0].hp === 77, '고쳐 둔 병력 체력(77)이 살아 있음');

  // 가져오기 자체도 무역 표를 바꾸지 않는지 (읽기만)
  const tradeBeforeImport = await tradeSnapshot();
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  ok(diff(tradeBeforeImport, await tradeSnapshot()).length === 0, '「무역 게임에서 가져오기」도 무역 표를 바꾸지 않음');

  console.log(fails ? `실패 ${fails}개` : '전체 통과');
  await db.close();
  process.exit(fails ? 1 : 0);
}
await db.close();
