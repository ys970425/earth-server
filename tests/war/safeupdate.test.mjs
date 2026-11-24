// 정적 검사: WHERE 없는 DELETE/UPDATE 가 supabase/war 에 없는지 (Supabase의 pg_safeupdate 는 API로 부른 세션에서 이런 문장을 막아요:
// "DELETE requires a WHERE clause". 가짜 DB(PGlite)에는 그 확장이 없어서 다른 시험이 못 잡아요.)
// 모든 행을 바꾸거나 지우려면 「where true」 를 붙여요. 실행: npm run test:war:safeupdate
import { readFileSync, readdirSync } from 'node:fs';
import { findUnsafeDml } from '../../tools/war/find-unsafe-dml.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const n = sql => findUnsafeDml(sql, 't').length;

console.log('— 검사기 자체 시험 (나쁜 문장은 잡고, 괜찮은 문장은 놔둬야 해요)');
ok(n('delete from war.a;') === 1, 'where 없는 delete 를 잡음');
ok(n('update war.a set x = 1;') === 1, 'where 없는 update 를 잡음');
ok(n('update war.a set\n  x = 1,\n  y = 2;') === 1, '여러 줄 update 도 잡음');
ok(n('if x then delete from war.a; end if;') === 1, 'if 안의 delete 도 잡음');
ok(n('update war.a set x = (select 1 from war.b where b.id = 1);') === 1, '서브쿼리 안의 where 는 인정하지 않음');
ok(n('delete from war.a where true;') === 0, 'where true 는 통과');
ok(n('delete from war.a where id = 1;') === 0, '조건이 있는 delete 는 통과');
ok(n('update war.a set x = 1 where id = 2;') === 0, '조건이 있는 update 는 통과');
ok(n('update war.a set\n  x = 1\n where id = 2;') === 0, '여러 줄 + where 는 통과');
ok(n('delete from war.a using war.b where a.id = b.id;') === 0, 'delete using … where 는 통과');
ok(n('insert into war.a values (1) on conflict (id) do update set x = 2;') === 0, 'on conflict do update set 은 통과 (WHERE 문장이 아님)');
ok(n('select * from war.a for update;') === 0, 'select … for update 는 통과');
ok(n("-- delete from war.a;\n/* update war.a set x = 1; */ select 1;") === 0, '주석 속 문장은 무시');
ok(n("select 'delete from war.a'; ") === 1, '문자열 속에 든 동적 SQL(delete)도 잡음');
ok(n("execute 'delete from war.a where true';") === 0, '동적 SQL 에 where 가 있으면 통과');

console.log('— supabase/war 실제 SQL');
for (const f of readdirSync(new URL('../../supabase/war/', import.meta.url)).filter(x => x.endsWith('.sql'))) {
  const bad = findUnsafeDml(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'), f);
  ok(bad.length === 0, `${f}: WHERE 없는 DELETE/UPDATE ${bad.length}개` + (bad.length ? ' — ' + bad.map(b => `${b.line}줄 ${b.text.slice(0, 50)}`).join(' | ') : ''));
}

console.log(fails ? `실패 ${fails}개` : '전체 통과');
process.exit(fails ? 1 : 0);
