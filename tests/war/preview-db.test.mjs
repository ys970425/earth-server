import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');
const meta = JSON.parse(readFileSync(new URL('../../app/war/preview/db.json', import.meta.url), 'utf8'));
assert.deepEqual(Object.keys(meta).sort(), ['admin_uid', 'students']);
for (const student of meta.students) assert.deepEqual(Object.keys(student).sort(), ['country', 'id', 'uid']);
console.log('  ✓ 메타에 이름·닉네임 키 없음');
const db = new PGlite({ loadDataDir: new Blob([readFileSync(new URL('../../app/war/preview/db.tar.gz', import.meta.url))]) });
try {
  const student = meta.students.find(s => s.country === 1);
  await db.query("select set_config('request.uid', $1, false)", [student.uid]);
  const rpc = async (name, values = []) => (await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) r`, values)).rows[0].r;
  assert.equal((await rpc('war_me')).role, null);
  await rpc('war_choose_role', ['army']);
  const me = await rpc('war_me');
  assert.equal(me.role, 'army');
  assert.ok(me.menus.length > 0);
  console.log('  ✓ 역할 선택 뒤 army와 메뉴 표시');
  const units = (await db.query('select * from war.units order by id')).rows;
  const enemy = units.find(u => u.country !== 1 && u.commander === 'army');
  const navy = units.find(u => u.country === 1 && u.commander === 'navy');
  await assert.rejects(rpc('war_move', [enemy.id, [enemy.tile_id]]), /NOT_MINE:/);
  await assert.rejects(rpc('war_move', [navy.id, [navy.tile_id]]), /ROLE_ONLY:/);
  console.log('  ✓ 다른 나라 NOT_MINE / 우리 해군 ROLE_ONLY');
  const step = (await db.query(`select u.id, t.id as destination from war.units u join war.tiles t on priv.tdist(u.tile_id, t.id) = 1
    where u.country = 1 and u.commander = 'army' and u.kind = 'spear' and u.moves_left > 0
    and t.terrain = 'plains' and (t.owner is null or t.owner = 1)
    and not exists (select 1 from war.units x where x.tile_id = t.id)
    and not exists (select 1 from war.cities c where c.tile_id = t.id)
    and not exists (select 1 from war.markets m where m.tile_id = t.id) limit 1`)).rows[0];
  assert.ok(step, '자기 육군 옆 빈칸');
  assert.equal((await rpc('war_move', [step.id, [step.destination]])).ok, true);
  console.log('  ✓ 자기 육군 빈칸 이동 성공');
} finally { await db.close(); }

// Exercise the browser adapter with local fetch/CDN substitutes; SQL stays unchanged.
const adapterUrl = new URL('../../app/war/js/war-preview-db.js', import.meta.url);
const adapterSource = readFileSync(adapterUrl, 'utf8')
  .replace('https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.15/dist/index.js', import.meta.resolve(process.env.PGLITE_PATH || '@electric-sql/pglite'))
  .replaceAll('import.meta.url', JSON.stringify(adapterUrl.href));
const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;
try {
  for (const [search, pathname, expectedRole, expectedSize] of [
    ['?preview=1', '/war/index.html', null, 5],
    ['?preview=1&as=1:army&size=4', '/war/index.html', 'army', 4],
    ['?preview=real&as=2', '/war/index.html', null, 4],
    ['?preview=1', '/war/admin.html', 'admin', null]
  ]) {
    globalThis.location = { search, pathname };
    globalThis.fetch = async url => {
      const file = new URL(url).pathname.split('/').pop();
      const expected = search.includes('preview=real') ? 'db-real' : 'db';
      assert.ok(file === `${expected}.json` || file === `${expected}.tar.gz`);
      return new Response(file.endsWith('.json') ? JSON.stringify(meta) : readFileSync(new URL('../../app/war/preview/db.tar.gz', import.meta.url)));
    };
    const module = await import('data:text/javascript;base64,' + Buffer.from(adapterSource + `\n// ${search}${pathname}\nexport async function closeForTest() { await (await ready).close(); }`).toString('base64'));
    try {
      if (expectedRole === 'admin') {
        assert.ok(Array.isArray((await module.rpc('war_admin_roles')).roles));
      } else {
        const me = await module.rpc('war_me');
        assert.equal(me.role, expectedRole);
        assert.equal(me.country.size, expectedSize);
        if (!expectedRole) {
          await module.rpc('war_choose_role', { p_role: 'army' });
          assert.ok((await module.rpc('war_me')).menus.length > 0);
        }
        assert.ok((await module.rpc('war_poll', { p_known: {} })).units.length > 0);
      }
    } finally { await module.closeForTest(); }
  }
  console.log('  ✓ 브라우저 어댑터: 역할 선택·직접 역할·4명·real 경로·교사·이름 붙인 인자');
} finally {
  globalThis.fetch = originalFetch;
  globalThis.location = originalLocation;
}
console.log('전체 통과');
