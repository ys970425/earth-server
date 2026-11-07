import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDb } from '../../tests/war/helpers.mjs';
import { stateFromWar } from './state-from-war.mjs';

export async function convert(exportData) {
  const { db, rpc } = await createDb();
  try {
    for (const f of ['schema.sql', 'config.sql', 'functions.sql']) {
      await db.exec(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'));
    }
    const admin = randomUUID();
    await rpc(admin, 'admin_login', 'test-pw');
    const cities = new Map((await db.query('select id, tile_id from priv.cities')).rows.map(c => [c.id, c.tile_id]));
    const tiles = new Set((await db.query('select id from priv.tiles')).rows.map(t => t.id));
    for (const c of exportData.cities ?? []) {
      if (!cities.has(c.id) || cities.get(c.id) !== c.tile_id) {
        throw new Error(`지도 버전이 달라요: 도시 ${c.id}`);
      }
    }
    for (const [id] of exportData.tiles ?? []) {
      if (!tiles.has(id)) throw new Error(`지도 버전이 달라요: 칸 ${id}`);
    }
    for (const table of ['countries', 'cities', 'units', 'inventory', 'factories', 'advanced']) {
      await db.exec(`delete from priv.${table}`);
      await db.query(`insert into priv.${table} select * from jsonb_populate_recordset(null::priv.${table}, $1::jsonb)`,
        [JSON.stringify(exportData[table] ?? [])]);
    }
    await db.exec('update priv.tiles set owner = null, imp = null');
    await db.query(`update priv.tiles t set owner = (b.row->>1)::int, imp = b.row->>2
      from jsonb_array_elements($1::jsonb) b(row) where t.id = (b.row->>0)::int`,
    [JSON.stringify(exportData.tiles ?? [])]);
    await db.query('update public.game set turn = $1, phase = $2', [exportData.game.turn, exportData.game.phase]);
    await rpc(admin, 'war_admin_import', '초기화');
    return await stateFromWar(db);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let file = process.argv[2];
    if (!file) {
      const dir = new URL('../../private/', import.meta.url);
      const files = readdirSync(dir, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.json'))
        .map(f => ({ url: new URL(f.name, dir), time: statSync(new URL(f.name, dir)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      if (!files.length) throw new Error('private 폴더에 무역 백업 파일을 넣어 주세요');
      file = files[0].url;
    }
    const state = await convert(JSON.parse(readFileSync(file, 'utf8')));
    mkdirSync(new URL('../../app/war/preview/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../../app/war/preview/state-real.json', import.meta.url), JSON.stringify(state, null, 1));
    console.log(`state-real.json 저장: 나라 ${state.countries.length} · 칸 ${state.tiles.length} · 도시 ${state.cities.length} · 병력 ${state.units.length} (턴 ${state.game.turn})`);
  } catch (e) {
    console.error(e.code === 'ENOENT' && !process.argv[2] ? 'private 폴더에 무역 백업 파일을 넣어 주세요' : e.message);
    process.exitCode = 1;
  }
}
