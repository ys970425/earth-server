// 나라별 「항구·해군 가능 도시」 표 (해군 참모총장이 수업에서 할 일이 있는지 확인)
// 실제 학생 데이터 미리보기 DB(app/war/preview/db-real.tar.gz, 로컬 전용·깃허브에 없음)를 읽기만 해요.
// 실행: node tools/war/harbor-report.mjs [--md]   (--md 면 docs/war-harbor.md 로도 저장. 나라 번호·유형만 적고 학생이 지은 이름은 적지 않아요)
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_PATH || '@electric-sql/pglite');

const file = new URL('../../app/war/preview/db-real.tar.gz', import.meta.url);
if (!existsSync(file)) { console.error('db-real.tar.gz 가 없어요. 먼저 npm run war:preview:real 을 실행하세요 (private/ 백업 필요).'); process.exit(1); }
const db = new PGlite({ loadDataDir: new Blob([readFileSync(file)]) });
await db.waitReady;
const q = async (sql, ...a) => (await db.query(sql, a)).rows;

const W = (await q(`select max(c)+1 w from war.tiles`))[0].w;
const countries = await q(`select id, type from war.countries order by id`);
const rows = [];
for (const { id, type } of countries) {
  const cities = await q(`select ci.id, ci.kind, ci.sea, ci.buildings, ci.tile_id from war.cities ci where ci.country = $1`, id);
  const hasTech = (await q(`select coalesce(priv.has_tech($1,'shipbuilding'), false) ok`, id))[0].ok;
  const harbor = cities.filter(c => (c.buildings || []).includes('harbor'));
  // war_produce 의 자리 규칙: 도시 칸이 비었거나, 이웃 바다·해안 칸 중 비어 있고 시장이 아닌 곳이 있어야 배를 놓을 수 있어요
  let shipReady = 0;
  for (const c of harbor) {
    const free = (await q(`
      select (not exists (select 1 from war.units u where u.tile_id = $1 and u.kind not in ('worker','scout'))
              or exists (select 1 from war.tiles t where t.id = any(war.neighbors((select c from war.tiles where id = $1), (select r from war.tiles where id = $1), $2))
                 and t.terrain in ('ocean','coast')
                 and not exists (select 1 from war.units u where u.tile_id = t.id and u.kind not in ('worker','scout'))
                 and not exists (select 1 from war.markets m where m.tile_id = t.id))) ok`, c.tile_id, W))[0].ok;
    if (free) shipReady++;
  }
  const canBuild = cities.filter(c => c.sea && !(c.buildings || []).includes('harbor')).length;
  const shipsNow = (await q(`select count(*)::int n from war.units where country = $1 and commander = 'navy'`, id))[0].n;
  rows.push({ id, type, cities: cities.length, sea: cities.filter(c => c.sea).length, harbor: harbor.length, harborCap: harbor.some(c => c.kind === 'capital'), shipReady, canBuild, hasTech, shipsNow });
}
const verdict = r => r.shipReady > 0 ? '✅ 바로 배를 만들 수 있어요' : r.harbor > 0 ? '⚠ 항구는 있는데 배를 놓을 빈 칸이 없어요 (칸을 비워야 해요)' : r.canBuild > 0 ? (r.hasTech ? '⚠ 항구를 지어야 해요 (건설 가능)' : '⚠ 항구를 지으려면 「조선」 기술이 먼저예요') : '❌ 항구도 없고 지을 해안 도시도 없어요 — 해군 할 일이 없어요';
const lines = [
  '# 나라별 항구·해군 가능 도시 (실제 학생 데이터 기준)',
  '',
  `- 만든 때: ${new Date().toISOString().slice(0, 10)} · 기준: 무역 게임 백업을 가져온 직후 상태(app/war/preview/db-real)`,
  '- 「배를 만들 수 있는 항구」 = 항구가 있고, 도시 칸이 비었거나 이웃 바다·해안 칸이 비어 있는 도시',
  '- 「항구 건설 가능」 = 해안(sea) 도시인데 항구가 아직 없는 도시. 짓는 데 「조선」 기술이 필요해요',
  '',
];
for (const r of rows) {
  lines.push(`## ${r.id}번 나라 (${r.type})`,
    `- 도시 ${r.cities}개 · 해안 도시 ${r.sea}개 · 항구 ${r.harbor}개${r.harborCap ? ' (수도 포함)' : ''}`,
    `- 배를 바로 만들 수 있는 항구: ${r.shipReady}개 · 항구 건설 가능한 해안 도시: ${r.canBuild}개 · 조선 기술 ${r.hasTech ? '있음' : '없음'} · 지금 해군 병력 ${r.shipsNow}개`,
    `- 판정: ${verdict(r)}`, '');
}
const out = lines.join('\n');
console.log(out);
if (process.argv.includes('--md')) { writeFileSync(new URL('../../docs/war-harbor.md', import.meta.url), out + '\n'); console.log('→ docs/war-harbor.md 저장'); }
process.exit(0);
