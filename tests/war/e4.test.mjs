// PGlite는 연결 하나라 동시 공격은 시험 못 함. 설치 후 두 연결로 확인해야 한다.
import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';
const ctx=await createDb(); const {db,ok}=ctx;
const seed=await seedTradeState(ctx);
const safeFail=async(p,code)=>{try{await p;return false;}catch(e){await db.exec('rollback to savepoint expected');return e.message.includes(code);}};
const expected=async(fn,code)=>{await db.exec('savepoint expected');const result=await safeFail(fn(),code);await db.exec('release savepoint expected');return result;};
for(const f of ['schema','config','functions']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`,import.meta.url),'utf8'));
await ctx.rpc(seed.ADMIN,'war_admin_import','초기화');
ok((await db.query(`select bool_and(def=20 and hp=200 and max_hp=200) valid from war.cities where kind='capital'`)).rows[0].valid,'???? ?? 20/200/200');
const s=seed.students.find(s=>s.country_id===1);
await db.query(`insert into war.roles(student,country,role) values ($1,1,'chief')`,[s.id]);
await db.exec(`update war.game set turn=10; update war.countries set shield_until=0;
 insert into war.diplomacy(a,b,status) values (1,2,'war') on conflict(a,b) do update set status='war';
 delete from war.units; delete from war.cities; delete from war.markets; update war.tiles set owner=null,terrain='plains',imp=null,imp_ruined=false;
 insert into war.units(id,country,kind,tile_id,hp,commander) values (9001,1,'spear',400,100,'army'),(9002,2,'spear',401,100,'army');`);
const q=async(sql,...p)=>(await db.query(sql,p)).rows[0];
const atk=()=>ctx.rpc(s.uid,'war_attack',9001,401);
const prev=()=>ctx.rpc(s.uid,'war_attack_preview',9001,401);
async function test(name,fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');} }
await test('peace',async()=>{await db.query(`update war.diplomacy set status=$1`,['peace']);ok(await expected(atk,'NOT_AT_WAR'),'peace 공격 거절');const p=await prev();ok(!p.can_attack&&p.reason.includes('전쟁 중'),'peace 미리보기 거절');});
await test('ally',async()=>{await db.query(`update war.diplomacy set status=$1`,['ally']);ok(await expected(atk,'ALLY'),'ally 공격 거절');const p=await prev();ok(!p.can_attack&&p.reason.includes('동맹'),'ally 미리보기 거절');});
for(const [sql,code] of [[`update war.countries set shield_until=10 where id=2`,'SHIELD'],[`update war.units set attacked_turn=10 where id=9001`,'ATTACKED'],[`update war.units set tile_id=1 where id=9001`,'TOO_FAR'],[`update war.units set kind='worker' where id=9001`,'NOT_MILITARY'],[`update war.units set kind='worker' where id=9002`,'NO_TARGET']]) await test(code,async()=>{await db.exec(sql);ok(await expected(atk,code),code);});
await test('preview',async()=>{const before=await q(`select jsonb_agg(u) data from war.units u`);const p=await prev();ok(JSON.stringify(before)===JSON.stringify(await q(`select jsonb_agg(u) data from war.units u`)),'미리보기 읽기만');const a=await atk();ok(p.can_attack&&p.damage===a.damage&&p.counter===a.counter,'미리보기 = 실제');ok(await expected(atk,'ATTACKED'),'같은 턴 두 번째 공격');});
await test('kill',async()=>{await db.exec(`update war.units set hp=1 where id=9002`);const a=await atk();ok(a.killed&&!(await q(`select id from war.units where id=9002`)),'체력 0 삭제');});
await test('attacker death',async()=>{await db.exec(`update war.units set hp=1 where id=9001`);const a=await atk();ok(a.attacker_killed&&!(await q(`select id from war.units where id=9001`)),'?? ?? 0 ?? ?? ??');});
await test('terrain',async()=>{const a=await prev();await db.exec(`update war.tiles set terrain='hills' where id=401`);ok((await prev()).damage<a.damage,'언덕 방어');});
await test('ranged',async()=>{await db.exec(`update war.units set kind='catapult' where id=9001`);const a=await prev();const far=await q(`select id from war.tiles where priv.tdist(id,401)=2 limit 1`);await db.query(`update war.units set tile_id=$1 where id=9001`,[far.id]);ok((await prev()).counter===Math.round(a.counter*.25),'원거리 반격 25%');});
const boss=await q(`select key from jsonb_each(priv.cfg()->'UNITS') where value ? 'boss' limit 1`);
await test('boss',async()=>{await db.query(`update war.units set kind=$1 where id=9001`,[boss.key]);await db.exec(`update war.units set hp=1 where id=9002`);ok((await atk()).damage<=60,'특수 부대 상한');});
async function city(kind='city'){await db.exec(`delete from war.units where id=9002;
 insert into war.cities(id,tile_id,kind,type,name,def,sea,country,buildings,tier,hp,max_hp) values ('E4',401,'${kind}','K','시험',1,false,2,'{}',1,1,100);`);}
await test('capital',async()=>{await city('capital');const a=await atk();ok(a.besieged&&!a.captured&&(await q(`select country from war.cities where id='E4'`)).country===2,'수도 포위, 점령 안 됨');});
await test('capture',async()=>{await city();await db.exec(`insert into war.city_facilities(city,kind,class) values ('E4','test','factory'),('E4','advanced','advanced'),('E4','specialty','factory');`);
 const ns=(await db.query(`select id from war.tiles where priv.tdist(id,401)=1 order by id`)).rows;
 for(let i=0;i<ns.length;i++) await db.query(`update war.tiles set imp=$1 where id=$2`,[['mine','oilwell','plantation','farm','lumber','quarry'][i],ns[i].id]);
 const a=await atk();const c=await q(`select * from war.cities where id='E4'`);ok(a.captured&&c.country===1&&c.hp===50,'근접 점령, 소유권·절반 체력');ok((await q(`select tile_id from war.units where id=9001`)).tile_id===401,'병력 도시 진입');
 ok((await q(`select count(*)::int n from war.tiles where priv.tdist(id,401)<=1 and owner=1`)).n===7,'주변 땅');
 ok((await q(`select count(*)::int n from war.tiles where imp in ('mine','oilwell','plantation') and imp_ruined`)).n===3,'광산·유정·농원 파괴');ok(!(await q(`select imp_ruined from war.tiles where imp='farm'`)).imp_ruined,'농장 유지');ok((await q(`select bool_and(ruined) r from war.city_facilities where city='E4'`)).r,'시설 파괴');const country=await q(`select * from war.countries where id=2`);ok(country.cities_lost===1&&country.shield_until===13,'상실 수·보호막 3턴');
 ok((await q(`select count(*)::int n from war.tiles where owner=1 and ver=0`)).n===0,'지도 ver 갱신');});
for(const kind of ['catapult','fighter']) await test(kind,async()=>{await city();await db.query(`update war.units set kind=$1 where id=9001`,[kind]);const a=await atk();ok(!a.captured&&a.need_melee,kind+' 점령 안 됨');});
for(const coastal of [false,true]) await test('ship',async()=>{await city();await db.exec(`update war.units set kind='trireme' where id=9001`);if(coastal)await db.exec(`update war.tiles set terrain='coast' where id=402`);const a=await atk();ok(a.captured===coastal,'배 점령 해안 여부 '+coastal);});
await test('garrison',async()=>{await city();await db.exec(`insert into war.units(id,country,kind,tile_id,hp,commander) values(9002,2,'spear',401,100,'army')`);const a=await atk();ok(!a.captured&&a.defender_hp===0&&(await q(`select hp from war.units where id=9002`)).hp===100,'?? ?? ??, ?? ?? ??? ?? ??');});
await test('unowned city',async()=>{await city();await db.exec(`update war.cities set country=null where id='E4'`);ok(await expected(atk,'NO_TARGET'),'?? ?? ???? ?? ??');});
await test('market',async()=>{await db.exec(`insert into war.markets values(1,401,'test','??')`);ok(await expected(atk,'NO_TARGET'),'?? ?? ??');});
await test('loss floor',async()=>{await city();await db.exec(`update war.countries set cities_lost=2 where id=2`);const a=await atk();ok(a.defender_hp===1&&!a.captured,'2곳 상실 멸망 방지');});
for(const count of [3,4,6]) await test('merge',async()=>{await db.query(`update war.tiles set owner=1 where id in (select id from war.tiles where priv.tdist(id,500)=1 order by id limit $1)`,[count]);await db.exec(`select war.merge_empty_tiles()`);ok((await q(`select owner from war.tiles where id=500`)).owner===(count>=4?1:null),'병합 이웃 '+count);});
await test('3:3',async()=>{await db.exec(`update war.tiles set owner=case when id in(select id from war.tiles where priv.tdist(id,500)=1 order by id limit 3) then 1 else 2 end where priv.tdist(id,500)=1; select war.merge_empty_tiles();`);ok((await q(`select owner from war.tiles where id=500`)).owner===null,'3:3 유지');});
for(const terrain of ['ocean','coast'])await test(terrain,async()=>{await db.query(`update war.tiles set terrain=$1 where id=500`,[terrain]);await db.exec(`update war.tiles set owner=1 where priv.tdist(id,500)=1; select war.merge_empty_tiles();`);ok((await q(`select owner from war.tiles where id=500`)).owner===null,terrain+' 제외');});
for(const type of ['city','market'])await test(type,async()=>{if(type==='city')await db.exec(`insert into war.cities(id,tile_id,kind,type,name,def,sea,country,buildings,tier,hp,max_hp) values ('M',500,'city','K','시험',1,false,null,'{}',1,100,100)`);else await db.exec(`insert into war.markets values(1,500,'test','시험')`);await db.exec(`update war.tiles set owner=1 where priv.tdist(id,500)=1; select war.merge_empty_tiles();`);ok((await q(`select owner from war.tiles where id=500`)).owner===null,type+' 제외');});
await test('one layer',async()=>{const pair=await q(`select a.id a,b.id b from war.tiles a join war.tiles b on priv.tdist(a.id,b.id)=1 where a.id=500 limit 1`);const neighbors=(await db.query(`select id from war.tiles where priv.tdist(id,$1)=1 and id<>$2 order by case when priv.tdist(id,$2)=1 then 0 else 1 end,id`,[pair.b,pair.a])).rows.slice(0,3).map(x=>x.id);await db.query(`update war.tiles set owner=1 where id=any($1::int[]) or (priv.tdist(id,$2)=1 and id<>$3)`,[neighbors,pair.a,pair.b]);const initial=await q(`select count(*)::int n from war.tiles where owner=1 and priv.tdist(id,$1)=1`,pair.b);if(initial.n===3){await db.exec(`select war.merge_empty_tiles()`);ok((await q(`select owner from war.tiles where id=$1`,pair.a)).owner===1&&(await q(`select owner from war.tiles where id=$1`,pair.b)).owner===null,'한 번에 한 겹');}else throw Error('one layer fixture');});
// Keep the original implementation as an independent result/performance oracle.
await db.exec(`create function war.e4_legacy_merge_empty_tiles() returns int language plpgsql as $$
declare ids int[]; owners int[]; n int;
begin
 select array_agg(id order by id), array_agg(owner order by id) into ids, owners from (
  select t.id, nb.owner from war.tiles t join war.tiles nb on priv.tdist(t.id,nb.id)=1
  where t.owner is null and t.terrain not in ('ocean','coast') and nb.owner is not null
   and not exists(select 1 from war.cities where tile_id=t.id)
   and not exists(select 1 from war.markets where tile_id=t.id)
  group by t.id,nb.owner having count(*)>=4
 ) s;
 n:=coalesce(cardinality(ids),0);
 if n>0 then
  perform war.bump('map');
  update war.tiles t set owner=s.owner,ver=(select ver from war.versions where area='map' and country=0)
   from unnest(ids,owners) s(id,owner) where t.id=s.id;
 end if;
 return n;
end $$;`);
await test('all tile neighbors',async()=>{
 const {width}=await q(`select (priv.cfg()->>'W')::int width`);
 const mismatch=await q(`select count(*)::int n from war.tiles t where
   (select array_agg(nb.id order by nb.id) from war.tiles nb where nb.id=any(war.neighbors(t.c,t.r,$1)))
   is distinct from
   (select array_agg(nb.id order by nb.id) from war.tiles nb where priv.tdist(t.id,nb.id)=1)`,width);
 ok(mismatch.n===0,'all tile neighbors = tdist (both parities, corners and edges)');
});
const timings=[];
for(const shape of ['dense','stripes','holes','edges']) await test('equivalence '+shape,async()=>{
 await db.exec(`update war.tiles set owner=case
   when '${shape}'='dense' then case when (c*7+r*11)%10<8 then 1+(c+r)%2 end
   when '${shape}'='stripes' then case when c%7<>3 then 1+(r/4)%2 end
   when '${shape}'='holes' then case when (c+r)%3<>0 then 1 end
   when '${shape}'='edges' then case when c<3 or c>=37 or r<3 or r>=25 then 1 end end,
   terrain=case when id%31=0 then 'ocean' when id%29=0 then 'coast' when id%23=0 then 'mountain' else 'plains' end;
   insert into war.cities(id,tile_id,kind,type,name,def,sea,country,buildings,tier,hp,max_hp)
   values ('oracle',500,'city','K','oracle',1,false,null,'{}',1,100,100);
   insert into war.markets values(1,501,'oracle','oracle');`);
 const snapshot=()=>q(`select jsonb_agg(jsonb_build_array(id,owner,ver) order by id) data from war.tiles`);
 await db.exec('savepoint oracle');
 let start=performance.now();
 const legacy=await q('select war.e4_legacy_merge_empty_tiles() n');
 const beforeMs=performance.now()-start;
 const expectedState=await snapshot();
 await db.exec('rollback to savepoint oracle');
 start=performance.now();
 const actual=await q('select war.merge_empty_tiles() n');
 const afterMs=performance.now()-start;
 timings.push({shape,beforeMs,afterMs});
 ok(actual.n===legacy.n&&JSON.stringify(await snapshot())===JSON.stringify(expectedState),shape+' merge owners, count and ver = tdist');
 ok(afterMs<=200,shape+' merge_empty_tiles <= 200ms ('+afterMs.toFixed(1)+'ms)');
});
for(const t of timings) console.log(`merge ${t.shape}: tdist ${t.beforeMs.toFixed(1)}ms -> neighbors ${t.afterMs.toFixed(1)}ms`);
await db.close();ctx.summary();
