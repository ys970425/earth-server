import { readFileSync } from 'node:fs';
import { createDb, seedTradeState } from './helpers.mjs';
const ctx = await createDb();
const { db, rpc, ok, fail, one } = ctx;
const seed = await seedTradeState(ctx);
for (const f of ['schema', 'config', 'functions']) await db.exec(readFileSync(new URL(`../../supabase/war/${f}.sql`, import.meta.url), 'utf8'));
await rpc(seed.ADMIN, 'war_admin_import', '초기화');
const chiefs = [1, 2].map(c => seed.students.find(s => s.country_id === c));
for (const s of chiefs) await db.query(`insert into war.roles(student,country,role) values ($1,$2,'chief')`, [s.id, s.country_id]);
const army = seed.students.filter(s => s.country_id === 1)[1];
await db.query(`insert into war.roles(student,country,role) values ($1,1,'army')`, [army.id]);
await db.exec(`update war.game set turn=10,paused=false;`);
ok(chiefs.length === 2, '준비: DB 설치 + 역할 배정');
const relation = () => one('select * from war.diplomacy where a=1 and b=2');
async function reset(status = 'peace', ban = 0) {
  await db.exec(`delete from war.offers; update war.diplomacy set status='peace',no_war_until=0;`);
  await db.query('update war.diplomacy set status=$1,no_war_until=$2 where a=1 and b=2', [status, ban]);
}
await reset();
ok((await rpc(chiefs[0].uid, 'war_declare', 2)).ok && (await relation()).status === 'war', '선전포고_성공');
await reset('war');
ok(await fail(rpc(chiefs[0].uid, 'war_declare', 2), 'ALREADY_AT_WAR'), '선전포고_중복');
await reset('war');
let offer = await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
ok(offer.ok && (await one('select * from war.offers')).status === 'pending', '평화_제안_성공');
await reset('war');
offer = await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
const accepted = await rpc(chiefs[0].uid, 'war_accept_offer', offer.offer_id);
ok(accepted.ok && (await relation()).status === 'peace' && (await relation()).no_war_until === 13, '평화_수락_성공');
await reset('peace', 13);
ok(await fail(rpc(chiefs[0].uid, 'war_declare', 2), 'NO_WAR_BAN'), '평화_기간_선포_금지');
await reset();
ok(await fail(rpc(army.uid, 'war_declare', 2), 'ROLE_ONLY'), '비합동참모의장_선전포고_거절');
await reset('war');
await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
const ceasefire = await rpc(seed.ADMIN, 'war_admin_ceasefire', 1, 2);
ok(ceasefire.ok && ceasefire.ceasefire_count === 1 && (await relation()).status === 'peace' && (await one('select * from war.offers')).status === 'cancelled', '강제_휴전');
await reset('war');
offer = await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
const poll = await rpc(chiefs[0].uid, 'war_poll', {});
ok(poll.diplomacy.length === 15 && poll.offers.length === 1 && poll.offers[0].id === offer.offer_id, 'poll_외교_포함');
ok((await rpc(chiefs[1].uid, 'war_poll', {})).offers.length === 0, 'poll_다른_나라_제안_비공개');
ok((await rpc(seed.ADMIN, 'war_poll', {})).diplomacy.length === 15, '교사_poll_외교');
await reset('war');
await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
await db.exec(`insert into war.offers(kind,from_c,to_c,turn) values ('peace',3,4,10),('peace',1,3,10);
  update war.diplomacy set status='war' where a=1 and b=3;`);
const all = await rpc(seed.ADMIN, 'war_admin_ceasefire', 1, null);
ok(all.ceasefire_count === 2 && (await one(`select count(*)::int n from war.offers where status='pending'`)).n === 1 &&
  (await one(`select status from war.offers where from_c=3 and to_c=4`)).status === 'pending', '나라_전체_휴전_제안_취소_범위');
await reset('peace', 10);
ok((await rpc(chiefs[0].uid, 'war_declare', 2)).ok, '평화_금지_만료_턴_선포');
ok(await fail(rpc(army.uid, 'war_admin_ceasefire', 1, 2), 'NOT_ADMIN'), '학생_강제_휴전_거절');
await reset('war');
offer = await rpc(chiefs[1].uid, 'war_propose', 1, 'peace');
ok(await fail(rpc(chiefs[1].uid, 'war_accept_offer', offer.offer_id), 'NOT_FOR_ME'), '보낸_제안_직접_수락_거절');

// --- E8 나머지: 동맹·나라 간 무역 ---
// 10. 동맹_제안_성공
await reset();
const allyOffer = await rpc(chiefs[0].uid, 'war_propose', 2, 'ally');
ok(allyOffer.ok && (await one(`select kind, status from war.offers where id = ${allyOffer.offer_id}`)).kind === 'ally' &&
  (await one(`select status from war.offers where id = ${allyOffer.offer_id}`)).status === 'pending', '동맹_제안_성공');
// 11. 동맹_수락_성공
const allyAccepted = await rpc(chiefs[1].uid, 'war_accept_offer', allyOffer.offer_id);
ok(allyAccepted.ok && allyAccepted.status === 'ally' && (await relation()).status === 'ally', '동맹_수락_성공');
// 12. 동맹_나라_공격_불가
const myUnit = await one(`select id from war.units where country = 1 and kind not in ('worker','scout') order by id limit 1`);
const targetTile = await one(`select coalesce((select u2.tile_id from war.units u2 where u2.country = 2 and u2.kind not in ('worker','scout') and u2.tile_id is not null order by u2.id limit 1),
  (select c.tile_id from war.cities c where c.country = 2 order by c.tile_id limit 1)) tile`);
ok(await fail(rpc(army.uid, 'war_attack', myUnit.id, targetTile.tile), 'ALLY'), '동맹_나라_공격_불가');
// 13. 동맹_중_선전포고: 동맹을 깨고 전쟁으로
const declared = await rpc(chiefs[0].uid, 'war_declare', 2);
ok(declared.ok && (await relation()).status === 'war', '동맹_중_선전포고');
// 14. 동맹_재제안_전쟁중_불가
ok(await fail(rpc(chiefs[0].uid, 'war_propose', 2, 'ally'), 'AT_WAR'), '동맹_재제안_전쟁중_불가');
// 15. 무역_제안_성공 (전쟁이 끝나야 하므로 관제실 강제 휴전 후)
await rpc(seed.ADMIN, 'war_admin_ceasefire', 1, 2);
await db.query(`insert into war.wallets(country, role, item, qty) values (1, 'chief', 'food', 10)
  on conflict (country, role, item) do update set qty = 10`);
await db.query(`insert into war.wallets(country, role, item, qty) values (2, 'chief', 'iron', 5)
  on conflict (country, role, item) do update set qty = 5`);
const tradeOffer = await rpc(chiefs[0].uid, 'war_trade_propose', 2, { food: 2 }, { iron: 1 });
ok(tradeOffer.ok && (await one(`select kind, status, to_c from war.offers where id = ${tradeOffer.offer_id}`)).kind === 'trade' &&
  (await one(`select status from war.offers where id = ${tradeOffer.offer_id}`)).status === 'pending', '무역_제안_성공');
// 16. 무역_수락_성공: 창고(지갑) 이전 확인
const walletBefore = {
  give: await one(`select qty from war.wallets where country = 1 and role = 'chief' and item = 'food'`),
  want: await one(`select coalesce((select qty from war.wallets where country = 1 and role = 'chief' and item = 'iron'), 0) n`),
};
const tradeAccepted = await rpc(chiefs[1].uid, 'war_trade_accept', tradeOffer.offer_id);
const walletAfter = {
  give: await one(`select qty from war.wallets where country = 1 and role = 'chief' and item = 'food'`),
  got: await one(`select qty from war.wallets where country = 1 and role = 'chief' and item = 'iron'`),
};
ok(tradeAccepted.ok && +walletBefore.give.qty - 2 === +walletAfter.give.qty &&
  +walletBefore.want.n + 1 === +walletAfter.got.qty, '무역_수락_성공');
// 17. 전쟁중_무역_불가
await reset('war');
ok(await fail(rpc(chiefs[0].uid, 'war_trade_propose', 2, { food: 2 }, { iron: 1 }), 'AT_WAR'), '전쟁중_무역_불가');

await db.close();
ctx.summary();
