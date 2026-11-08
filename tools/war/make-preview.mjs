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
