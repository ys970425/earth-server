// PGlite는 연결이 하나라 진짜 동시 실행과 교착 방지는 시험할 수 없다.
// 실행: node tests/war/act.test.mjs
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createDb, seedTradeState, tradeFingerprint } from './helpers.mjs';

const ctx = await createDb();
try {
  const seed = await seedTradeState(ctx);
  const { db, rpc, one, ok, fail } = ctx;
  for (const file of ['schema.sql', 'config.sql', 'functions.sql']) {
    await db.exec(readFileSync(new URL('../../supabase/war/' + file, import.meta.url), 'utf8'));
  }
  await rpc(seed.ADMIN, 'war_admin_import', '초기화');
  const before = await tradeFingerprint(db);
  const of = c => seed.students.filter(s => s.country_id === c);
  const [chief, engineer, army, navy, air] = of(1);
  const [chief4, engineer4] = of(2);
  for (const [s, role] of [[chief, 'chief'], [engineer, 'engineer'], [army, 'army'],
    [navy, 'navy'], [air, 'air'], [chief4, 'chief'], [engineer4, 'engineer']]) {
    await db.query('insert into war.roles(student, country, role) values ($1, $2, $3)', [s.id, s.country_id, role]);
  }
  async function act(uid, role, combat = false) {
    await db.query("select set_config('request.uid', $1, false)", [uid || '']);
    return (await db.query('select war.act_start($1, $2) r', [role, combat])).rows[0].r;
  }
  let result = await act(army.uid, 'army');
  ok(result.student === army.id && result.country === 1 && result.role === 'army' && result.acting_as === null,
    '자기 역할 허용 및 학생·나라·역할 반환');
  ok(await fail(act(army.uid, 'engineer'), 'ROLE_ONLY: 이 일은 공병사령관이(가) 해요'),
    '다른 역할 거절 및 cfg의 한글 이름');
  ok(await fail(act(chief.uid, 'engineer'), 'ROLE_ONLY'), '5명 모둠 합참은 공병사령관이 있으면 거절');
  result = await act(chief4.uid, 'engineer');
  ok(result.role === 'chief' && result.acting_as === 'engineer' && result.country === 2,
    '4명 모둠 합참은 담당자가 있어도 공병 허용');
  await db.query('delete from war.roles where student = $1', [navy.id]);
  result = await act(chief.uid, 'navy');
  ok(result.role === 'chief' && result.acting_as === 'navy', '합참이 빈 역할 대행');
  await db.query('update war.roles set absent = true where student = $1', [air.id]);
  ok((await act(chief.uid, 'air')).acting_as === 'air', '합참이 absent 역할 대행');
  ok(await fail(act(army.uid, 'air'), 'ROLE_ONLY'), '참모총장은 결석 대행 불가');
  ok(await fail(act(chief.uid, 'unknown'), 'ROLE_ONLY'), '합참도 없는 역할은 거절');
  ok(await fail(act(chief.uid, null), 'ROLE_ONLY'), 'null 역할 거절');
  ok(await fail(act(of(3)[0].uid, 'army'), 'ROLE_ONLY'), '역할 미선택 학생 거절');

  await db.query('update war.game set paused = true');
  ok(await fail(act(army.uid, 'army'), 'PAUSED: 지금은 잠깐 멈춘 시간이에요'), '일시정지면 PAUSED');
  await db.query('update war.game set paused = false, combat_on = false');
  ok(await fail(act(army.uid, 'army', true), 'NO_COMBAT: 지금은 싸울 수 없는 시간이에요'), '전투 중지면 전투만 NO_COMBAT');
  ok((await act(army.uid, 'army')).student === army.id, '전투 중지 중 일반 행동 허용');
  ok(await fail(act(randomUUID(), 'army'), 'NO_AUTH: 접속 정보가 없어요. 새로고침해 주세요.'), '미등록 uid는 NO_AUTH');
  ok(await fail(act(null, 'army'), 'NO_AUTH'), '로그인 없는 uid는 NO_AUTH');

  await db.query("select war.bump('game')");
  await db.query("select war.bump('game')");
  ok((await one("select ver::int v from war.versions where area = 'game' and country = 0")).v === 2,
    '기본 나라 0에서 같은 영역 두 번 → 2');
  await db.query("select war.bump('country', 1), war.bump('country', 2)");
  await db.query("select war.bump('country', 1)");
  ok(JSON.stringify((await db.query("select country, ver::int v from war.versions where area = 'country' order by country")).rows)
    === JSON.stringify([{ country: 1, v: 2 }, { country: 2, v: 1 }]), '나라별 번호 독립');
  for (const section of ['map', 'units', 'cities', 'diplomacy', 'notice']) {
    await db.query('select war.bump($1)', [section]);
  }
  ok((await one("select ver::int v from war.versions where area = 'notice' and country = 0")).v === 1,
    'notice version increments');
  ok(await fail(db.query("select war.bump('notices')"), 'BAD_SECTION'), 'reject notices area');
  ok(await fail(db.query("select war.bump('unknown')"), 'BAD_SECTION'), '이상한 영역 오류');
  ok(await fail(db.query('select war.bump(null)'), 'BAD_SECTION'), 'null 영역 오류');
  await db.exec("begin; select war.bump('game'); rollback;");
  ok((await one("select ver::int v from war.versions where area = 'game' and country = 0")).v === 2,
    '행동 트랜잭션 취소 시 번호 증가도 취소');
  await db.query("select set_config('request.uid', $1, false)", [chief4.uid]);
  const chief5 = of(5)[0];
  await db.query("insert into war.roles(student, country, role) values ($1, 5, 'chief')", [chief5.id]);
  for (const [actor, other] of [[chief4, 5], [chief5, 2], [chief4, 2]]) {
    await db.query("select set_config('request.uid', $1, false)", [actor.uid]);
    await db.exec('begin');
    result = (await db.query("select war.act_start('chief', false, $1) r", [other])).rows[0].r;
    ok(result.country === actor.country_id && result.role === 'chief',
      'act_start p_other=' + other + ': country locks execute successfully');
    await db.exec('commit');
  }
  ok((await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
    lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'war' and p.proname in ('act_start', 'bump')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'`)).n === 0, '공통 함수 세 개의 PUBLIC 실행 권한 없음');
  ok(JSON.stringify(before) === JSON.stringify(await tradeFingerprint(db)), '무역 표에 쓰지 않음');
} catch (e) {
  ctx.ok(false, e.stack || e.message);
}
await ctx.db.close();
ctx.summary();
