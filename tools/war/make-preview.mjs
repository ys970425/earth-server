// 전쟁 버전 미리보기 데이터 만들기 (W2): PGlite 가짜 DB에 무역+전쟁을 설치하고
// 가져오기(war_admin_import)까지 한 뒤, war 표를 읽어 app/war/preview/state.json에 저장해요
// 실행: npm run war:preview  (두 번 실행해도 같은 결과가 나와요)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { stateFromWar } from './state-from-war.mjs';
import { createDb, seedTradeState } from '../../tests/war/helpers.mjs';

const ctx = await createDb();
const seed = await seedTradeState(ctx);
const { db, rpc } = ctx;
// 무역 SQL 다음에 전쟁 SQL 설치 → 교사 uid로 「무역 게임에서 가져오기」 (tests/war/import.test.mjs와 같은 방식)
for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
  await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
}
await rpc(seed.ADMIN, 'war_admin_import', '초기화');

// 추가 병력: 나라마다 구축함 1척, 창병 2개, 기갑 1개 추가
// war.units 표 직접 삽입 (tile_id: 빈 바다·땅 칸 중 각 나라 수도에서 가장 가까운 칸)
for (let c = 1; c <= 6; c++) {
  const cap = (await db.query(`select t.id from war.cities ci join war.tiles t on t.id = ci.tile_id where ci.country = ${c} and ci.kind = 'capital' limit 1`)).rows[0];
  if (!cap) continue;
  const capId = cap.id;

  // 구축함: 빈 바다 칸
  const seaTile = (await db.query(`
    select t.id from war.tiles t
    where t.terrain in ('ocean','coast')
      and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
    order by priv.tdist(t.id, ${capId}), t.id limit 1`)).rows[0];
  if (seaTile) {
    const nextId = (await db.query(`select coalesce(max(id),0)+1 as nid from war.units`)).rows[0].nid;
    await db.query(`insert into war.units(id,country,kind,tile_id,hp,commander) values (${nextId},${c},'destroyer',${seaTile.id},100,'navy')`);
  }

  // 추가 창병 2개, 기갑 1개: 빈 땅 칸
  for (const kind of ['spear', 'spear', 'tank']) {
    const landTile = (await db.query(`
      select t.id from war.tiles t
      where t.terrain not in ('ocean','coast','mountain')
        and not exists (select 1 from war.cities ci where ci.tile_id = t.id and ci.country is distinct from ${c})
        and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
      order by priv.tdist(t.id, ${capId}), case when t.owner = ${c} then 0 else 1 end, t.id limit 1`)).rows[0];
    if (landTile) {
      const nextId = (await db.query(`select coalesce(max(id),0)+1 as nid from war.units`)).rows[0].nid;
      await db.query(`insert into war.units(id,country,kind,tile_id,hp,commander) values (${nextId},${c},'${kind}',${landTile.id},100,'army')`);
    }
  }
}

// war 표 → 학생 화면 「투명한 정찰병」(S.obs && S.world)이 지도에 넘기는 모양
// (app/trade/js/student.js의 updateMap(): tiles는 [id, terrain, res, owner, imp],
//  cities·units는 app/trade/js/hexmap.js가 그리는 필드 이름)
const state = await stateFromWar(db);
const { countries, tiles, cities, units, game: { turn } } = state;
mkdirSync(new URL('../../app/war/preview/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../app/war/preview/state.json', import.meta.url), JSON.stringify(state, null, 1));
console.log(`app/war/preview/state.json 저장: 나라 ${countries.length} · 칸 ${tiles.length} · 도시 ${cities.length} · 병력 ${units.length} (턴 ${turn})`);

const meta = { admin_uid: seed.ADMIN, students: (await db.query('select id, country_id as country, uid from priv.students order by id')).rows };
writeFileSync(new URL('../../app/war/preview/db.json', import.meta.url), JSON.stringify(meta));
const dump = await db.dumpDataDir('gzip');
writeFileSync(new URL('../../app/war/preview/db.tar.gz', import.meta.url), Buffer.from(await dump.arrayBuffer()));
console.log(`db.tar.gz 저장: ${dump.size} bytes`);
await db.close();
