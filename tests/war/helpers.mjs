// 전쟁 버전 테스트 틀 (W0): PGlite에 무역 게임을 설치하고 학생 상태를 만든다
// tests/trade/db.test.mjs와 같은 방식: PGlite → 가짜 auth → trade_setup.sql → 관리자 비밀번호
// PGLITE_PATH=... node tests/war/db.test.mjs
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');

// PGlite 생성 → 무역 SQL 설치 → 관리자 비밀번호 설정. 검사 도우미(ok·fail·rpc·one·summary)를 함께 돌려준다
export async function createDb() {
  const db = new PGlite();
  await db.exec(`create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;`);
  const SQL = readFileSync(new URL('../../supabase/trade_setup.sql', import.meta.url), 'utf8');
  await db.exec(SQL);
  await db.exec(SQL); // 두 번 실행해도 안전
  await db.query(`select priv.set_admin_password('test-pw')`);

  let fails = 0;
  const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
  async function rpc(uid, fn, ...args) {
    await db.query(`select set_config('request.uid', $1, false)`, [uid || '']);
    const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
    const r = await db.query(`select public.${fn}(${ph}) as r`, args.map(a => a !== null && typeof a === 'object' && !Array.isArray(a) ? JSON.stringify(a) : a));
    return r.rows[0].r;
  }
  async function fail(p, code) { try { await p; return false; } catch (e) { return !code || e.message.includes(code); } }
  const one = async q => (await db.query(q)).rows[0];
  function summary() { console.log(fails ? `실패 ${fails}개` : '전체 통과'); process.exit(fails ? 1 : 0); }
  return { db, rpc, one, ok, fail, summary };
}

// 학생 25명(1모둠 5명, 2~6모둠 4명) 등록·접속, 나라마다 대표 지정,
// 그리고 무역 게임을 조금 진행한 상태(1번 나라: 농장·건물·튜토리얼 도시국가 점령, 턴 넘김 2회)를 만든다
export async function seedTradeState(ctx) {
  const { db, rpc, one } = ctx;
  const ADMIN = randomUUID();
  await rpc(ADMIN, 'admin_login', 'test-pw');
  // 명단: 1모둠 5명, 2~6모둠 4명 = 25명
  const rows = []; let n = 1;
  for (let g = 1; g <= 6; g++) for (let i = 0; i < (g === 1 ? 5 : 4); i++) rows.push({ group: g, no: n, name: '학생' + n++ });
  ok_count((await rpc(ADMIN, 'admin_roster_import', rows)).count, 25);
  const st = await rpc(ADMIN, 'admin_state');
  const students = [];
  for (const s of st.students) { const uid = randomUUID(); await rpc(uid, 'join_student', s.id, '별' + s.id); students.push({ ...s, uid }); }
  const of = c => students.filter(s => s.country_id === c);
  for (let c = 1; c <= 6; c++) await rpc(ADMIN, 'admin_set_leader', of(c)[0].id, true);
  const leaderOf = c => of(c)[0].uid;
  const L = leaderOf;

  // 게임 시작: 1단계 「나라 키우기」, 턴 1
  await rpc(ADMIN, 'admin_set_phase', 1);

  // 1번 나라(반도)를 조금 진행한다. 역할 검사는 국가 대표가 모든 일을 할 수 있어서 대표 uid로 한다
  // ① 노동자 개발: 우리 땅 중 자원 없는 평원 한 칸에 농장
  const own = (await db.query(`select id from priv.tiles where owner = 1 and terrain = 'plains' and res is null
    and id not in (select tile_id from priv.cities) order by id`)).rows;
  if (!own.length) throw new Error('seed: 1번 나라의 개발할 평원 칸이 없어요');
  await rpc(L(1), 'worker_build', own[0].id, 'farm');
  // ② 도시 건물: 수도에 시장
  await rpc(L(1), 'city_build', 'K', 'market');
  // ③ 튜토리얼 도시국가 점령: 투석기는 수도에서 원거리 공격, 창병은 옆 칸까지 걸어가서 공격
  const T = Object.fromEntries((await db.query(`select id, c, r, terrain from priv.tiles`)).rows.map(t => [t.id, t]));
  function hd(a, b) { const q1 = a.c - (a.r - (a.r & 1)) / 2, q2 = b.c - (b.r - (b.r & 1)) / 2; return Math.max(Math.abs(q1 - q2), Math.abs(a.r - b.r), Math.abs(q1 + a.r - q2 - b.r)); }
  const cityTiles = new Set((await db.query(`select tile_id from priv.cities`)).rows.map(r => r.tile_id));
  const nb = t => Object.values(T).filter(x => Math.abs(x.r - t.r) <= 1 && Math.abs(x.c - t.c) <= 1 && x.id !== t.id && hd(x, t) === 1);
  const k1 = (await rpc(L(1), 'my_state')).targets.find(t => t.tutorial);
  if (!k1) throw new Error('seed: 1번 나라의 튜토리얼 도시국가가 없어요');
  const units1 = (await rpc(L(1), 'my_state')).units;
  const [spear1] = units1.filter(u => u.kind === 'spear');
  const [cat1] = units1.filter(u => u.kind === 'catapult');
  // 도시국가 바로 옆의 우리 땅·빈칸 (창병이 설 자리). 창병이 있는 칸에서 가장 가까운 것부터
  const ct = (await one(`select tile_id from priv.cities where id = '${k1.id}'`)).tile_id;
  const ownerOf = Object.fromEntries((await db.query(`select id, owner from priv.tiles`)).rows.map(r => [r.id, r.owner]));
  const nearK1 = nb(T[ct]).filter(x => !['ocean', 'coast'].includes(x.terrain) && !cityTiles.has(x.id) && (ownerOf[x.id] === null || ownerOf[x.id] === 1))
    .sort((a, b) => hd(a, T[spear1.tile]) - hd(b, T[spear1.tile]))[0].id;
  // 수도 → 옆 칸 길 (BFS): 바다·도시 칸은 못 지나감
  const pass = id => !['ocean', 'coast'].includes(T[id].terrain) && !cityTiles.has(id) && (ownerOf[id] === null || ownerOf[id] === 1);
  const prevOf = { [spear1.tile]: null }; const q = [spear1.tile];
  while (q.length) { const id = q.shift(); if (id === nearK1) break; for (const x of nb(T[id])) if (!(x.id in prevOf) && pass(x.id)) { prevOf[x.id] = id; q.push(x.id); } }
  const path = []; for (let p = nearK1; p !== spear1.tile; p = prevOf[p]) path.unshift(p);
  await rpc(L(1), 'unit_move', spear1.id, path);
  const ca = await rpc(L(1), 'unit_attack', cat1.id, k1.id);
  if (!ca.captured) {
    const sa = await rpc(L(1), 'unit_attack', spear1.id, k1.id);
    if (!sa.captured) throw new Error('seed: 튜토리얼 도시국가 점령 실패');
  }
  // ④ 턴 넘김 2회 (교사가 「다음 턴」 누름)
  await rpc(ADMIN, 'admin_next_turn');
  await rpc(ADMIN, 'admin_next_turn');

  // ⑤ 겹친 병력(검사 c, W1 「겹친 병력 펼치기」 시험용): 시작 병력은 모두 수도 칸이라 보통 자연히 생김.
  // 없으면 2번 나라 창병 하나를 다른 창병 칸으로 unit_move 해서 만든다
  const stack = await one(`select tile_id from priv.units where kind not in ('worker', 'scout') group by tile_id having count(*) >= 2 limit 1`);
  if (!stack) {
    const us2 = (await rpc(L(2), 'my_state')).units.filter(u => u.kind === 'spear');
    const cap2 = (await one(`select tile_id from priv.cities where id = 'J'`)).tile_id;
    const spot = nb(T[cap2]).filter(x => !['ocean', 'coast'].includes(x.terrain) && !cityTiles.has(x.id) && ownerOf[x.id] === null)[0];
    if (!spot || us2.length < 2) throw new Error('seed: 겹친 병력을 만들 자리가 없어요');
    await rpc(L(2), 'unit_move', us2[0].id, [spot.id]);
    await rpc(L(2), 'unit_move', us2[1].id, [spot.id]);
  }
  return { ADMIN, students, leaderOf };
}

// 스키마 priv와 public의 모든 표를 표 이름순으로, 각 표의 모든 행을 정해진 순서로
// 문자열로 만들어 md5로 요약한 값을 표별로 돌려준다 ({ 표이름: md5 }). war 스키마는 넣지 않는다
export async function tradeFingerprint(db) {
  const tables = (await db.query(`select table_schema, table_name from information_schema.tables
    where table_schema in ('priv', 'public') and table_type = 'BASE TABLE'
    order by table_name`)).rows;
  const fp = {};
  for (const { table_schema, table_name } of tables) {
    const r = await db.query(`select md5(coalesce(string_agg(row_text, chr(10) order by row_text), '')) h
      from (select to_jsonb(t)::text row_text from "${table_schema}"."${table_name}" t) s`);
    fp[table_name] = r.rows[0].h;
  }
  return fp;
}

// seed 안에서만 쓰는 조용한 확인 (검사 출력 없이 틀리면 멈춤)
function ok_count(got, want) { if (got !== want) throw new Error(`seed: ${want}명이어야 하는데 ${got}명이에요`); }
