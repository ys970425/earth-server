-- =====================================================================
-- 지구 서버: 문명의 시대 (무역 게임) — Supabase 설치 스크립트
-- 신발 게임과 다른 "새 Supabase 프로젝트"의 SQL Editor에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 진행 중인 게임 기록은 지워지지 않고, 규칙 숫자와 함수만 최신으로 바뀝니다.
-- 이 파일은 node tools/trade/build-sql.mjs 로 만들어집니다. 직접 고치지 마세요.
-- =====================================================================

create schema if not exists priv;
revoke all on schema priv from public;

-- 규칙 숫자 (app/trade/js/rules.js 에서 생성)
create table if not exists priv.config (id int primary key default 1 check (id = 1), data jsonb not null);

create table if not exists public.game (
  id               int primary key default 1 check (id = 1),
  phase            int not null default 0,
  turn             int not null default 0,
  turn_end         timestamptz,
  auto_turn        int not null default 0,
  market_open      boolean not null default false,
  diplomacy_open   boolean not null default false,
  crisis           boolean not null default false,
  fair_cap         boolean not null default true,
  tariff           numeric not null default 0,
  banned           jsonb not null default '{}'::jsonb,
  cold_snap        int,
  world_first      int,
  base_vol         int not null default 24,
  locked           boolean not null default false,
  require_approval boolean not null default false,
  timer_end        timestamptz,
  timer_label      text,
  ver              bigint not null default 0,
  updated_at       timestamptz not null default now()
);
insert into public.game(id) values (1) on conflict do nothing;

create table if not exists public.notices (
  id         bigserial primary key,
  country    int,               -- null이면 모두에게
  kind       text not null default 'info',
  message    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.country_ticks (
  country_id int primary key,
  ver        bigint not null default 0
);
insert into public.country_ticks(country_id) select g from generate_series(1, 6) g on conflict do nothing;

create table if not exists priv.countries (
  id            int primary key,
  type          text not null,
  name          text,
  flag_url      text,
  emblem_url    text,
  coin          int not null default 0,
  happy         int not null default 55,
  glory         int[] not null default '{}',
  techs         text[] not null default '{}',
  discovered    int[] not null default '{}',
  explored      int[] not null default '{}',
  title         text,
  lux_types     int not null default 0,
  income        int not null default 0,
  short         text[] not null default '{}',
  tariff_turn   int not null default 0,
  attacked_turn int not null default -1,
  updated_at    timestamptz not null default now()
);
insert into priv.countries(id, type) values (1, 'K'), (2, 'J'), (3, 'C'), (4, 'A'), (5, 'N'), (6, 'T') on conflict do nothing;

create table if not exists priv.students (
  id         serial primary key,
  country_id int not null references priv.countries(id),
  no         int,
  name       text not null,
  role       text,
  is_leader  boolean not null default false,
  uid        uuid unique,
  bound_at   timestamptz,
  last_seen  timestamptz
);

alter table priv.students add column if not exists roles text[] not null default '{}';


create table if not exists priv.pairing_requests (
  id         serial primary key,
  student_id int not null references priv.students(id) on delete cascade,
  uid        uuid not null,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists priv.tiles (
  id      int primary key,
  c       int not null,
  r       int not null,
  zone    text,
  terrain text not null,
  res     text,
  owner   int,
  imp     text
);

create table if not exists priv.cities (
  id           text primary key,
  tile_id      int not null,
  kind         text not null,          -- capital | cs
  type         text not null,          -- 수도: 나라 유형 / 도시국가: 확장 대상 나라 유형
  name         text not null,
  def          int not null default 0,
  sea          boolean not null default false,
  tech         text,
  country      int,
  buildings    text[] not null default '{}',
  built_turn   int not null default -1,
  trained_turn int not null default -1,
  unrest       boolean not null default false,
  taken_turn   int,
  def_help     int not null default 0
);

create table if not exists priv.units (
  id         serial primary key,
  country    int not null,
  kind       text not null,             -- worker | scout | spear | catapult | ballista | cannon
  tile_id    int not null,
  acted_turn int not null default -1,
  moves_turn int not null default -1,
  moves_left int not null default 0
);

create table if not exists priv.inventory (
  country int not null,
  item    text not null,
  qty     int not null default 0,
  primary key (country, item)
);

create table if not exists priv.factories (country int not null, kind text not null, primary key (country, kind));
create table if not exists priv.advanced  (country int not null, kind text not null, primary key (country, kind));

create table if not exists priv.offers (
  id         serial primary key,
  turn       int not null,
  from_c     int not null,
  to_c       int not null,
  give_item  text not null,
  give_qty   int not null,
  get_item   text not null,
  get_qty    int not null,
  status     text not null default 'pending',   -- pending | accepted | declined | cancelled | expired
  by_student int,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists priv.trades (
  id         serial primary key,
  turn       int not null,
  phase      int not null,
  from_c     int,           -- 판 나라 (null이면 중립 상인)
  to_c       int,           -- 산 나라 (null이면 중립 상인)
  item       text not null,
  qty        int not null,
  price      int,           -- 1개 값 (물물교환이면 null)
  value      int not null,  -- 거래 가치(코인)
  tariff     int not null default 0,
  broker     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists priv.events (
  id         serial primary key,
  turn       int,
  kind       text not null,
  message    text,
  data       jsonb,
  created_at timestamptz not null default now()
);

create table if not exists priv.treaties (
  country    int primary key,
  focus      text,
  problem    text,
  promise    text,
  reason     text,
  agreed     int[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists priv.reflections (
  student_id int primary key,
  body       text not null,
  updated_at timestamptz not null default now()
);

create table if not exists priv.snapshots (
  turn    int not null,
  country int not null,
  data    jsonb not null,
  primary key (turn, country)
);

create table if not exists priv.admins (uid uuid primary key, at timestamptz not null default now());
alter table priv.admins add column if not exists control int;

-- v2: 병력 이동·전투, 도시국가 체력, 기술 연구, 턴 준비, 선생님 체험 조작
alter table priv.cities add column if not exists tier int not null default 0;
alter table priv.cities add column if not exists hp int not null default 0;
alter table priv.cities add column if not exists max_hp int not null default 0;
alter table priv.cities add column if not exists bonus int not null default 0;
alter table priv.cities add column if not exists tutorial boolean not null default false;
alter table priv.cities add column if not exists boss boolean not null default false;
alter table priv.units add column if not exists hp int not null default 100;
alter table priv.units add column if not exists attacked_turn int not null default -1;
alter table priv.countries add column if not exists ready_turn int not null default 0;
alter table priv.countries add column if not exists research_turn int not null default -1;
alter table priv.countries add column if not exists crisis boolean not null default false;
alter table priv.cities add column if not exists trained_count int not null default 0;
alter table priv.students add column if not exists nickname text;
alter table public.game add column if not exists test_mode boolean not null default true;
-- v4
alter table priv.cities add column if not exists final boolean not null default false;
alter table priv.cities add column if not exists built_count int not null default 0;
alter table priv.countries add column if not exists research_count int not null default 0;
alter table priv.countries add column if not exists happy_detail jsonb not null default '[]';
alter table priv.countries add column if not exists lux_used text[] not null default '{}';
-- v6: 17차시 무역 위기(관세·수출 제한·재건), 관리자 지원 팝업
alter table public.game add column if not exists tariffs jsonb not null default '{}'::jsonb;
alter table priv.countries add column if not exists rebuilt boolean not null default false;
alter table public.notices add column if not exists data jsonb;
create table if not exists priv.trade_fails (
  id serial primary key, turn int, phase int, buyer int, seller int, item text, qty int,
  reason text,                 -- ban(수출 제한) | tariff(관세 낼 코인 부족)
  created_at timestamptz not null default now()
);
-- v7: 잊힌 제국 (반란 도시)·무역 동맹
alter table priv.cities add column if not exists rebel boolean not null default false;
alter table public.game add column if not exists alliance boolean not null default false;
-- v8: 단계 줄이기 (예전 4~7 무역 라운드·공급 차질·가격 경쟁·실제 나라 비교 삭제, 예전 8~11 → 4~7). 한 번만 옮겨요
alter table public.game add column if not exists phase_v int not null default 1;
do $$ begin
  if (select phase_v from public.game where id = 1) < 2 then
    update public.game set phase = case when phase between 4 and 7 then 3 when phase >= 8 then phase - 4 else phase end,
      locked = (phase = 10), phase_v = 2 where id = 1;
    update priv.trades set phase = case when phase between 4 and 7 then 3 when phase >= 8 then phase - 4 else phase end;
    update priv.trade_fails set phase = case when phase between 4 and 7 then 3 when phase >= 8 then phase - 4 else phase end;
  end if;
end $$;
-- v9: 활동 2·3, 국가 정상화, 영상, 정리
alter table public.game add column if not exists meet_step int not null default 2;
alter table public.game add column if not exists video_url text;
alter table public.game add column if not exists video_seq int not null default 0;
alter table public.game add column if not exists normalized boolean not null default false;
create table if not exists priv.expert_notes (
  student_id int primary key, country int not null, role text not null, body text not null, updated_at timestamptz not null default now()
);
-- v10: 무역로 공격으로 수입 사치품 공급 중단 (수입 행복도 효과 멈춤 → 동맹 뒤 수입하면 다시)
alter table priv.countries add column if not exists import_cut boolean not null default false;
create table if not exists priv.admin_secret (id int primary key default 1 check (id = 1), salt text not null, hash text not null);
create table if not exists priv.admin_attempts (id bigserial primary key, uid uuid, ok boolean not null, at timestamptz not null default now());

-- 공개 테이블: 실시간 알림용 (비밀 정보 없음)
alter table public.game          enable row level security;
alter table public.notices       enable row level security;
alter table public.country_ticks enable row level security;
drop policy if exists game_read on public.game;
create policy game_read on public.game for select using (true);
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select using (true);
drop policy if exists ticks_read on public.country_ticks;
create policy ticks_read on public.country_ticks for select using (true);
revoke insert, update, delete on public.game, public.notices, public.country_ticks from public;
do $$ begin
  execute 'revoke insert, update, delete on public.game, public.notices, public.country_ticks from anon, authenticated';
exception when others then null; end $$;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.game'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.notices'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.country_ticks'; exception when others then null; end;
end $$;


-- ---------------------------------------------------------------------

-- 규칙 숫자와 지도 (자동 생성)

-- ---------------------------------------------------------------------

insert into priv.config(id, data) values (1, $cfg${"W":40,"H":28,"START":{"coin":200,"food":6,"wood":6,"iron":2},"START_BONUS":{"K":{"wood":8},"J":{"wood":4}},"ITEMS":{"food":{"name":"식량","kind":"basic","ref":5},"wood":{"name":"목재","kind":"basic","ref":4},"iron":{"name":"철광석","kind":"ore","ref":8},"copper":{"name":"구리","kind":"ore","ref":8},"aluminum":{"name":"알루미늄","kind":"ore","ref":12},"uranium":{"name":"우라늄","kind":"ore","ref":15},"rare":{"name":"희토류","kind":"ore","ref":15,"desc":"강한 자석과 정밀 장치에 쓰이는 광물 — 첨단 항공기의 정밀 장치를 만드는 데 필요해요"},"gold":{"name":"금","kind":"lux","ref":12},"oil":{"name":"석유","kind":"oil","ref":10},"cotton":{"name":"목화","kind":"lux","ref":6},"rubber":{"name":"고무","kind":"plant","ref":8},"spice":{"name":"향신료","kind":"lux","ref":10},"wine":{"name":"와인","kind":"lux","ref":10},"steel":{"name":"강철","kind":"product","ref":15},"fuel":{"name":"연료","kind":"product","ref":15},"chip":{"name":"반도체","kind":"product","ref":25},"clothes":{"name":"옷","kind":"lux","ref":15},"tire":{"name":"타이어","kind":"product","ref":15},"jewelry":{"name":"장신구","kind":"lux","ref":25},"engine":{"name":"항공 엔진","kind":"product","ref":30}},"LUX":["gold","cotton","spice","wine","clothes","jewelry"],"FAIR_CAP":2,"ERAS":["고대","중세","르네상스","산업","현대"],"ANCIENT":["농업","목축","채광","도기","궁술","청동기","기초 항해","역법","문자","바퀴"],"TECH_TREE":{"engineering":{"name":"공학","era":1,"row":0,"req":[],"cost":{"coin":30,"food":2},"unlock":"투석기 · 곡물 창고"},"chivalry":{"name":"기사도","era":1,"row":1,"req":[],"cost":{"coin":30,"food":2},"unlock":"기사 (빠른 기병)"},"shipbuilding":{"name":"조선","era":1,"row":2,"req":[],"cost":{"coin":35,"wood":2},"unlock":"항구 · 삼단노선"},"economics":{"name":"경제학","era":2,"row":0,"req":["engineering"],"cost":{"coin":60,"food":3},"unlock":"시장 코인 +6 · 섬유 공장 · 금 세공소 · 고무 공장 · 정글 개발비 절반"},"gunpowder":{"name":"화약","era":2,"row":1,"req":["engineering","chivalry"],"cost":{"coin":60,"iron":1},"unlock":"대포 · 머스킷 보병"},"navigation":{"name":"항해술","era":2,"row":2,"req":["shipbuilding"],"cost":{"coin":60,"wood":3},"unlock":"프리깃 · 정찰병 바다 이동 +2"},"refining":{"name":"석유","era":3,"row":0,"req":["economics"],"cost":{"coin":90,"wood":3},"unlock":"유정 · 정유소"},"steelmaking":{"name":"제철","era":3,"row":1,"req":["gunpowder"],"cost":{"coin":90,"iron":2},"unlock":"제철소 · 보병 · 포병 · 군수 공장"},"warship":{"name":"강철 군함","era":3,"row":2,"req":["navigation","steelmaking"],"cost":{"coin":110,"steel":1},"unlock":"전함"},"combustion":{"name":"내연 기관","era":4,"row":0,"req":["refining","steelmaking"],"cost":{"coin":150,"fuel":1},"unlock":"탱크"},"chipmaking":{"name":"전자공학","era":4,"row":1,"req":["steelmaking"],"cost":{"coin":150,"copper":2},"unlock":"반도체 공장 · 전자 상가 · 원자력 발전소"},"radar":{"name":"레이더·통신","era":4,"row":2,"req":["chipmaking"],"cost":{"coin":170,"aluminum":1},"unlock":"통신탑 · 방송국 · 인터넷 센터 · 인공위성 센터 (근미래)"},"missile":{"name":"유도 미사일","era":4,"row":3,"req":["radar","warship"],"cost":{"coin":200,"chip":1},"unlock":"미사일 순양함"}},"TECH_ALIAS":{"textile":"economics","metalcraft":"economics","rubberwork":"economics","woodwork":"economics","jungle":"economics","oil_drill":"refining","munitions":"steelmaking","electricity":"chipmaking","internet":"radar","satellite":"radar","nuclear":"chipmaking"},"TECHS":{"engineering":"공학","chivalry":"기사도","shipbuilding":"조선","economics":"경제학","gunpowder":"화약","navigation":"항해술","refining":"석유","steelmaking":"제철","warship":"강철 군함","combustion":"내연 기관","chipmaking":"전자공학","radar":"레이더·통신","missile":"유도 미사일"},"TERRAIN":{"plains":"평원","hills":"언덕","mountain":"산","forest":"숲","jungle":"정글","tundra":"툰드라","snow":"설원","desert":"사막","coast":"해안","ocean":"바다"},"IMPROVE":{"farm":{"name":"농장","on":["plains","tundra","desert"],"cost":{"coin":10,"wood":1},"item":"food","yield":2},"lumber":{"name":"벌목장","on":["forest","jungle"],"cost":{"coin":10},"item":"wood","yield":2},"mine":{"name":"광산","res":["iron","copper","aluminum","gold","uranium","rare"],"cost":{"coin":15,"wood":1},"yield":2},"quarry":{"name":"채석장","on":["hills"],"noRes":true,"cost":{"coin":15,"wood":1},"coin":10,"yield":0},"plantation":{"name":"농원","res":["cotton","spice","wine","rubber"],"cost":{"coin":15,"wood":1},"yield":2},"oilwell":{"name":"유정","res":["oil"],"tech":"refining","cost":{"coin":20,"wood":1},"yield":2}},"JUNGLE_MULT":2,"DEMOLISH_COST":{"coin":15},"QUARRY_COIN":10,"TUNDRA_FOOD":1,"BUILDINGS":{"market":{"name":"도시 시장","cost":{"coin":40,"wood":3},"effect":"매 턴 코인 +12 (우리 도시 안의 시장)"},"barracks":{"name":"병영","cost":{"coin":30,"wood":2,"iron":1},"effect":"이 도시에서 병력 훈련 (한 턴에 1부대)"},"granary":{"name":"곡물 창고","cost":{"coin":25,"wood":2},"tech":"engineering","effect":"매 턴 식량 +2"},"plaza":{"name":"광장","cost":{"coin":30,"wood":2},"effect":"행복도 +6"},"harbor":{"name":"항구","cost":{"coin":50,"wood":4},"tech":"shipbuilding","coastal":true,"effect":"배 만들기, 매 턴 코인 +5"}},"FACTORIES":{"steelworks":{"name":"제철소","tech":"steelmaking","input":"iron","output":"steel","build":{"coin":50,"wood":2},"perTurn":2},"refinery":{"name":"정유소","tech":"refining","input":"oil","output":"fuel","build":{"coin":50,"wood":2},"perTurn":2},"chipfab":{"name":"반도체 공장","tech":"chipmaking","input":"copper","output":"chip","build":{"coin":150,"aluminum":4,"copper":3},"perTurn":2},"textilemill":{"name":"섬유 공장","tech":"economics","input":"cotton","output":"clothes","build":{"coin":50,"wood":2},"perTurn":2},"rubberplant":{"name":"고무 공장","tech":"economics","input":"rubber","output":"tire","build":{"coin":50,"wood":2},"perTurn":2},"workshop":{"name":"금 세공소","tech":"economics","input":"gold","output":"jewelry","build":{"coin":50,"wood":2},"perTurn":2},"aircraft":{"name":"항공기 공장","tech":"engineering","input":"aluminum","output":"engine","build":{"coin":150,"steel":3},"perTurn":2}},"SPECIALTY":{"K":{"factory":"chipfab","why":"기술이 뛰어나 원료가 없어도 반도체를 만들어요 (실제 한국의 1위 수출품)"},"J":{"factory":"rubberplant","why":"기술이 좋아 튼튼한 타이어를 만들어요 (실제 일본은 타이어·자동차를 많이 수출)"},"C":{"factory":"steelworks","why":"큰 제철소가 많아 강철을 많이 만들어요 (실제 중국은 세계 1위 철강 생산국)"},"A":{"factory":"aircraft","why":"과학 기술로 항공 엔진을 만들어요 (실제 미국은 비행기·엔진을 많이 수출)"},"N":{"factory":"refinery","why":"석유가 많아 연료를 넉넉히 만들어요 (실제 러시아는 석유·가스를 많이 수출)"},"T":{"factory":null,"res":"rubber","why":"정글에 고무나무가 많아 고무 농원에서 고무가 많이 나요 (실제 동남아시아는 천연고무를 많이 수출)"}},"SPECIALTY_BUILD":{"coin":40,"wood":2,"food":2},"FACTORY_BUILD":{"chipfab":{"J":{"coin":90,"aluminum":2,"copper":2},"K":{"coin":40,"wood":2,"food":2}},"rubberplant":{"J":{"coin":40,"wood":2,"food":2}},"steelworks":{"C":{"coin":40,"wood":2,"food":2}},"aircraft":{"A":{"coin":40,"wood":2,"food":2}},"refinery":{"N":{"coin":40,"wood":2,"food":2}}},"FACTORY_FREE":{"K":{"chipfab":true},"J":{"rubberplant":true},"C":{"steelworks":true},"A":{"aircraft":true},"N":{"refinery":true}},"PROC_COST":{"K":{"chip":5,"steel":4},"J":{"tire":4},"C":{"steel":4},"A":{"engine":6,"fuel":6},"N":{"fuel":3},"T":{}},"ADVANCED":{"industrial":{"name":"공장 지대","cost":{"coin":40,"steel":2,"tire":1},"econ":12,"coinPerTurn":15},"electronics":{"name":"전자 상가","tech":"chipmaking","cost":{"coin":40,"chip":2},"econ":12,"coinPerTurn":15},"theater":{"name":"극장","cost":{"coin":30,"wood":2},"culture":10,"happy":6},"netcenter":{"name":"인터넷 센터","tech":"radar","cost":{"coin":40,"chip":2},"culture":15},"satcenter":{"name":"인공위성 센터","tech":"radar","cost":{"coin":60,"aluminum":2,"chip":2},"culture":20},"arsenal":{"name":"군수 공장","tech":"steelmaking","cost":{"coin":60,"steel":2},"unlock":"tank"},"commtower":{"name":"통신탑","tech":"radar","cost":{"coin":80,"aluminum":2,"copper":2},"happy":14,"culture":10},"broadcast":{"name":"방송국","tech":"radar","cost":{"coin":90,"chip":2,"aluminum":1},"happy":18,"culture":15},"nuclearplant":{"name":"원자력 발전소","tech":"chipmaking","cost":{"coin":100,"uranium":2,"steel":2},"econ":15,"coinPerTurn":25}},"HIRE_WORKER":{"coin":25,"food":2},"UNITS":{"spear":{"name":"창병","era":0,"str":14,"move":3,"cost":{"coin":20,"food":1},"img":"spear"},"catapult":{"name":"투석기","era":1,"str":16,"move":2,"range":2,"tech":"engineering","cost":{"coin":30,"wood":2},"img":"catapult"},"knight":{"name":"기사","era":1,"str":20,"move":4,"tech":"chivalry","cost":{"coin":40,"food":2,"iron":1},"img":"knight"},"musket":{"name":"머스킷 보병","era":2,"str":26,"move":3,"tech":"gunpowder","cost":{"coin":50,"iron":1},"img":"swordsman"},"cannon":{"name":"대포","era":2,"str":32,"move":2,"range":2,"tech":"gunpowder","cost":{"coin":60,"iron":2,"wood":2},"img":"cannon"},"infantry":{"name":"보병","era":3,"str":36,"move":3,"tech":"steelmaking","cost":{"coin":70,"steel":1,"food":2},"img":"infantry"},"artillery":{"name":"포병","era":3,"str":48,"move":2,"range":3,"tech":"steelmaking","cost":{"coin":90,"steel":2},"img":"artillery"},"tank":{"name":"탱크","era":4,"str":75,"move":5,"tech":"combustion","cost":{"coin":130,"steel":2,"fuel":2,"tire":1},"img":"tank"},"trireme":{"name":"삼단노선","era":1,"str":10,"move":4,"sea":true,"tech":"shipbuilding","cost":{"coin":30,"wood":3},"img":"trireme"},"frigate":{"name":"프리깃","era":2,"str":24,"move":5,"range":2,"sea":true,"tech":"navigation","cost":{"coin":60,"wood":3,"iron":1},"img":"frigate"},"battleship":{"name":"전함","era":3,"str":55,"move":5,"range":2,"sea":true,"tech":"warship","cost":{"coin":110,"steel":3,"fuel":1},"img":"warship"},"k_missile":{"name":"장거리 미사일 부대","boss":"K","era":4,"str":300,"move":5,"range":3,"fly":true,"cost":{"coin":80,"uranium":2},"img":"boss_K"},"j_patrol":{"name":"해상 초계기","boss":"J","era":4,"str":300,"move":6,"range":3,"fly":true,"cost":{"coin":80,"rubber":2},"img":"boss_J"},"c_jet":{"name":"대형 전투기 편대","boss":"C","era":4,"str":300,"move":6,"range":3,"fly":true,"cost":{"coin":80,"engine":2},"img":"boss_C"},"a_stealth":{"name":"스텔스 폭격기","boss":"A","era":4,"str":300,"move":6,"range":3,"fly":true,"cost":{"coin":80,"rare":2},"img":"boss_A"},"n_hyper":{"name":"극초음속 미사일","boss":"N","era":4,"str":300,"move":5,"range":3,"fly":true,"cost":{"coin":80,"chip":2},"img":"boss_N"},"t_marine":{"name":"상륙 기갑부대","boss":"T","era":4,"str":300,"move":5,"range":2,"fly":true,"cost":{"coin":80,"tire":2},"img":"boss_T"},"cruiser":{"name":"미사일 순양함","era":4,"str":90,"move":6,"range":3,"sea":true,"tech":"missile","cost":{"coin":160,"steel":2,"fuel":2,"chip":2},"img":"cruiser"}},"UNIT_UPKEEP":1,"TECH_ICON":{"engineering":"engineering","economics":"economics","gunpowder":"gunpowder","navigation":"astronomy","shipbuilding":"shipbuilding","steelmaking":"steelmaking","refining":"oil","chipmaking":"chipmaking","radar":"radar","missile":"missile","combustion":"steam","warship":"munitions","chivalry":"chivalry"},"START_UNITS":["worker","scout","scout","scout","spear","spear","catapult"],"COMBAT":{"base":30,"counter":0.6,"min":3,"max":100,"rangedCounter":0.25,"healField":15,"healHome":25,"unhappyMult":0.7},"BUILD_PER_TURN":2,"RESEARCH_PER_TURN":2,"TRAIN_PER_TURN":3,"CS_TIERS":[{"name":"마을","def":5,"hp":50,"coin":100,"heal":5},{"name":"도시","def":8,"hp":80,"coin":50,"heal":8},{"name":"성곽 도시","def":13,"hp":110,"coin":70,"heal":12},{"name":"요새","def":20,"hp":150,"coin":90,"heal":16},{"name":"철옹성","def":40,"hp":220,"coin":150,"heal":25},{"name":"잊힌 제국","def":110,"hp":1200,"coin":500,"heal":80}],"FINAL_CS":{"name":"최종 도전","def":70,"hp":100,"coin":300,"heal":0,"glory":40},"STRAT_OF":{"K":"chip","N":"uranium","J":"tire","T":"rubber","C":"rare","A":"engine"},"PARTNER":{"K":"N","N":"K","J":"T","T":"J","C":"A","A":"C"},"LUX_OF":{"K":"clothes","J":"jewelry","A":"wine","N":"gold","T":"spice","C":"cotton"},"LUX_TEAM":{"K":["J","A"],"J":["K","A"],"A":["K","J"],"N":["T","C"],"T":["N","C"],"C":["N","T"]},"LUX_PER_TURN":2,"BOSS_UNIT":{"K":{"unit":"k_missile","needs":["uranium"]},"J":{"unit":"j_patrol","needs":["rubber"]},"C":{"unit":"c_jet","needs":["engine"]},"A":{"unit":"a_stealth","needs":["rare"]},"N":{"unit":"n_hyper","needs":["chip"]},"T":{"unit":"t_marine","needs":["tire"]}},"SOURCES":{"chip":["K"],"uranium":["N"],"tire":["J"],"rubber":["T"],"rare":["C"],"engine":["A"],"clothes":["K"],"jewelry":["J"],"wine":["A"],"gold":["N"],"spice":["T"],"cotton":["C"],"fuel":["N","A"],"oil":["N","A"],"aluminum":["N","A"],"steel":["C","K"],"iron":["C","K","A"],"copper":["C","T","J"],"food":["A","C","T"]},"EXPAND_CS":3,"BANNED_STRAT":["chip","uranium","tire","rubber","rare","engine"],"REBEL":{"def":200,"hp":1000,"weakDef":40,"weakHp":150,"terror":15,"terrorWeak":5,"boredom":10,"glory":40,"coin":200},"CRISIS":{"tariffPerUnit":30,"merchantMult":2},"EXPERT_FRAME":"올바른 무역을 위해 (                    ).","CLAUSE_FRAME":"우리가 제안한 조약은 (                    )입니다.","ROLE_TALK":{"국가 대표":{"q":"여러 나라가 서로 믿고 거래하려면 무엇이 가장 중요할까요?","ex":["한 번 맺은 거래 약속은 어려운 상황에서도 지켜야 한다","거래 조건을 바꿀 때는 미리 알리고 함께 의논해야 한다"]},"국방부 장관":{"q":"잊힌 제국처럼 무역을 방해하는 세력이 나타나면 어떻게 해야 할까요?","ex":["무역로가 공격받으면 여러 나라가 함께 지켜야 한다","다른 나라를 협박해 무역을 망치는 행동에 함께 맞서야 한다"]},"국토부 장관":{"q":"꼭 필요한 자원을 한 나라만 가지고 있을 때 어떤 약속이 필요할까요?","ex":["전략 자원의 올바른 거래를 위해 한 나라가 자원을 독점해서는 안 된다","서로에게 꼭 필요한 자원은 갑자기 끊지 않아야 한다"]},"기획부 장관":{"q":"관세나 물건값이 갑자기 크게 오르면 어떤 문제가 생길까요? 어떻게 막을까요?","ex":["관세를 한꺼번에 크게 올려서는 안 된다","물건값은 서로 공평하게 정해야 한다"]},"과학기술부 장관":{"q":"거래 정보가 감춰지거나 갑자기 바뀌면 왜 문제일까요?","ex":["가격과 거래 조건을 모든 나라가 알 수 있게 공개해야 한다","기술과 정보를 나누면 함께 발전할 수 있다"]}},"SUPPORT_GROUPS":[{"k":"basic","name":"기본 자원","items":["coin","food","wood","iron"]},{"k":"lux","name":"사치 자원","items":["gold","cotton","spice","wine","clothes","jewelry"]},{"k":"strategic","name":"전략 자원","items":["copper","aluminum","uranium","rare","oil","rubber","steel","fuel","chip","tire","engine"]}],"SCOUT_MOVE":5,"WORKER_MOVE":0,"SCOUT_SIGHT":2,"CITY_SIGHT":2,"INCOME":{"capital":20,"city":6,"market":12,"harbor":5,"capitalFood":3,"cityFood":1,"workerFood":1},"PRODUCTIVITY":{"K":{"market":18,"harbor":8},"J":{"market":18,"harbor":8}},"HAPPY":{"base":0,"perLuxType":10,"ownLux":10,"importLux":[0,20,50,80],"paralysis":-20,"rebelOpen":-15,"perPlaza":5,"glory":20,"gloryDecay":5,"perCity":-3,"pressurePerTurn":5,"pressureMax":30,"hunger":-10,"tariffPer":8,"golden":30,"unhappy":0,"unrest":-20,"revolt":-40},"TYPES":{"K":{"name":"반도의 용","color":"#2F6FE0","techs":["shipbuilding","steelmaking","chipmaking"],"like":"한국","desc":"땅이 좁고 산이 많아요. 자원은 적지만 기술이 뛰어나요."},"J":{"name":"파도의 섬왕국","color":"#E0463C","techs":["shipbuilding","navigation","economics"],"like":"일본","desc":"바다로 둘러싸인 섬나라예요. 소재·부품 기술이 좋아요."},"C":{"name":"대륙의 제국","color":"#F29A2E","techs":["engineering","economics","steelmaking"],"like":"중국","desc":"넓은 땅에 철광석·목화·구리가 많고, 많이 만드는 공장이 있어요."},"A":{"name":"신대륙의 강국","color":"#8A4FD8","techs":["engineering","refining","radar"],"like":"미국","desc":"넓은 땅에 석유·곡물이 많고 과학 기술이 앞서요."},"N":{"name":"북방의 대국","color":"#22A36A","techs":["chivalry","refining","economics"],"like":"러시아","desc":"가장 넓지만 얼어붙은 땅이 많아요. 석유와 금이 나요."},"T":{"name":"열대 해양국","color":"#EC5C9A","techs":["shipbuilding","economics","navigation"],"like":"동남아시아 여러 나라","desc":"정글과 섬의 나라예요. 고무·향신료가 많고 일손이 많아요."}},"CITY_ART":{"K":"capital_peninsula","J":"capital_island","C":"capital_continental","A":"capital_newworld","N":"capital_northern","T":"capital_tropical","village":"neutral_village","fortress":"neutral_fortress","harbor":"neutral_harbor","boss":"boss","final":"final_fortress"},"CITY_ANCHOR":0.83,"DEFAULT_TYPES":{"1":"K","2":"J","3":"C","4":"A","5":"N","6":"T"},"ROLES":["국가 대표","국방부 장관","기획부 장관","국토부 장관","과학기술부 장관"],"ROLE_INFO":{"국가 대표":{"icon":"leader","now":"모든 장관의 일 + 나라 이름·국기, 모둠 회의, 「턴 끝내기」","later":"무역 제안 최종 승인, 조약 서명"},"국방부 장관":{"icon":"spear","now":"병력 훈련·이동, 도시국가 공격","later":"무역 사절: 다른 나라에 거래 제안 보내기"},"기획부 장관":{"icon":"market","now":"도시 건물·공장·근미래 건물 짓기","later":"공장 가동, 무엇을 만들어 팔지 정하기"},"국토부 장관":{"icon":"worker","now":"노동자로 땅 개발(농장·광산·채석장…), 노동자 고용","later":"창고 관리, 모자란 자원 찾아 수입 요청"},"과학기술부 장관":{"icon":"scout","now":"기술 연구, 정찰병으로 세계 탐험","later":"시장 조사: 기준가·생산비 비교"}},"ROLE_KEY":{"leader":"국가 대표","army":"국방부 장관","build":"기획부 장관","land":"국토부 장관","explore":"과학기술부 장관"},"GROWTH_LIMIT":{"K":4,"J":4,"C":5,"A":5,"N":5,"T":5},"PHASES":[{"n":0,"name":"건국","desc":"나라 이름을 정하고 지도를 살펴봐요."},{"n":1,"name":"나라 키우기","desc":"노동자로 땅을 개발하고, 건물을 짓고, 도시국가를 차지해요."},{"n":2,"name":"성장의 한계","desc":"시민들이 더 다양한 물건을 원해요."},{"n":3,"name":"세계 시장 개방","desc":"다른 나라와 거래해서 특수 부대 재료와 사치품을 모아요."},{"n":4,"name":"잊힌 제국 등장","desc":"잊힌 제국이 우리 도시를 빼앗고 테러를 벌여요. 행복도가 떨어져요."},{"n":5,"name":"무역 파괴","desc":"잊힌 제국의 협박으로 관세가 치솟고, 사치품과 핵심 전략 자원은 거래할 수 없어요."},{"n":6,"name":"세계 무역 회의","desc":"활동 2 전문가 회의 → 활동 3 모둠 회의: 우리 나라 무역 조항을 만들어요."},{"n":7,"name":"무역 동맹","desc":"무역 동맹 체결! 잊힌 제국의 영향력이 크게 줄었어요. 우리 반란 도시를 되찾아요."},{"n":8,"name":"정리","desc":"무역을 할 때 필요한 노력을 적어 봅시다."}]}$cfg$::jsonb)
  on conflict (id) do update set data = excluded.data;

insert into priv.tiles(id, c, r, zone, terrain, res) values
(0,0,0,null,'ocean',null),
(1,1,0,null,'ocean',null),
(2,2,0,null,'coast',null),
(3,3,0,null,'coast',null),
(4,4,0,'N','tundra',null),
(5,5,0,'N','tundra',null),
(6,6,0,'N','forest','gold'),
(7,7,0,'N','hills',null),
(8,8,0,'N','tundra',null),
(9,9,0,'N','snow',null),
(10,10,0,'N','tundra',null),
(11,11,0,'N','tundra',null),
(12,12,0,'N','tundra',null),
(13,13,0,'N','hills',null),
(14,14,0,'N','hills',null),
(15,15,0,'N','forest',null),
(16,16,0,'N','tundra',null),
(17,17,0,'N','forest',null),
(18,18,0,'N','forest',null),
(19,19,0,'N','tundra',null),
(20,20,0,'N','forest',null),
(21,21,0,'N','tundra',null),
(22,22,0,'N','tundra',null),
(23,23,0,'N','tundra',null),
(24,24,0,'N','tundra',null),
(25,25,0,'N','tundra',null),
(26,26,0,'N','tundra',null),
(27,27,0,'N','forest',null),
(28,28,0,'N','snow',null),
(29,29,0,'N','tundra',null),
(30,30,0,null,'coast',null),
(31,31,0,null,'coast',null),
(32,32,0,null,'coast',null),
(33,33,0,null,'ocean',null),
(34,34,0,null,'ocean',null),
(35,35,0,null,'ocean',null),
(36,36,0,null,'ocean',null),
(37,37,0,null,'ocean',null),
(38,38,0,null,'ocean',null),
(39,39,0,null,'ocean',null),
(40,0,1,null,'ocean',null),
(41,1,1,null,'coast',null),
(42,2,1,'N','tundra',null),
(43,3,1,'N','hills',null),
(44,4,1,'N','tundra',null),
(45,5,1,'N','tundra',null),
(46,6,1,'N','tundra',null),
(47,7,1,'N','tundra',null),
(48,8,1,'N','tundra',null),
(49,9,1,'N','tundra',null),
(50,10,1,'N','forest',null),
(51,11,1,'N','tundra',null),
(52,12,1,'N','forest',null),
(53,13,1,'N','hills',null),
(54,14,1,'N','tundra',null),
(55,15,1,'N','tundra',null),
(56,16,1,'N','forest',null),
(57,17,1,'N','tundra','oil'),
(58,18,1,'N','forest',null),
(59,19,1,'N','forest','gold'),
(60,20,1,'N','tundra',null),
(61,21,1,'N','tundra',null),
(62,22,1,'N','snow','oil'),
(63,23,1,'N','forest',null),
(64,24,1,'N','tundra',null),
(65,25,1,'N','hills',null),
(66,26,1,'N','tundra',null),
(67,27,1,'N','tundra',null),
(68,28,1,'N','tundra',null),
(69,29,1,'N','tundra',null),
(70,30,1,'N','forest',null),
(71,31,1,'N','tundra',null),
(72,32,1,null,'coast',null),
(73,33,1,null,'ocean',null),
(74,34,1,null,'ocean',null),
(75,35,1,null,'ocean',null),
(76,36,1,null,'ocean',null),
(77,37,1,null,'ocean',null),
(78,38,1,null,'ocean',null),
(79,39,1,null,'ocean',null),
(80,0,2,null,'ocean',null),
(81,1,2,null,'coast',null),
(82,2,2,'N','tundra',null),
(83,3,2,'N','tundra',null),
(84,4,2,'N','tundra',null),
(85,5,2,'N','tundra',null),
(86,6,2,'N','forest',null),
(87,7,2,'N','forest',null),
(88,8,2,'N','tundra',null),
(89,9,2,'N','forest','aluminum'),
(90,10,2,'N','forest',null),
(91,11,2,'N','snow',null),
(92,12,2,'N','tundra',null),
(93,13,2,'N','tundra',null),
(94,14,2,'N','forest',null),
(95,15,2,'N','hills','uranium'),
(96,16,2,'N','plains',null),
(97,17,2,'N','tundra',null),
(98,18,2,'N','forest',null),
(99,19,2,'N','hills',null),
(100,20,2,'N','tundra',null),
(101,21,2,'N','snow',null),
(102,22,2,'N','tundra',null),
(103,23,2,'N','tundra',null),
(104,24,2,'N','hills',null),
(105,25,2,'N','forest',null),
(106,26,2,'N','tundra',null),
(107,27,2,'N','tundra',null),
(108,28,2,'N','tundra',null),
(109,29,2,'N','snow',null),
(110,30,2,'N','forest',null),
(111,31,2,'X','hills',null),
(112,32,2,'X','plains',null),
(113,33,2,null,'coast',null),
(114,34,2,null,'coast',null),
(115,35,2,null,'ocean',null),
(116,36,2,null,'ocean',null),
(117,37,2,null,'ocean',null),
(118,38,2,null,'ocean',null),
(119,39,2,null,'ocean',null),
(120,0,3,null,'ocean',null),
(121,1,3,null,'coast',null),
(122,2,3,'N','forest',null),
(123,3,3,'N','tundra',null),
(124,4,3,'N','tundra',null),
(125,5,3,'N','tundra',null),
(126,6,3,'N','tundra',null),
(127,7,3,'N','snow',null),
(128,8,3,'N','tundra',null),
(129,9,3,'N','forest',null),
(130,10,3,'N','forest',null),
(131,11,3,'N','tundra',null),
(132,12,3,'N','tundra',null),
(133,13,3,'N','forest',null),
(134,14,3,'N','tundra',null),
(135,15,3,'N','tundra',null),
(136,16,3,'N','tundra',null),
(137,17,3,'N','tundra',null),
(138,18,3,'N','forest',null),
(139,19,3,'N','snow',null),
(140,20,3,'N','forest',null),
(141,21,3,'N','tundra',null),
(142,22,3,'N','forest',null),
(143,23,3,'N','forest',null),
(144,24,3,'N','tundra',null),
(145,25,3,'N','forest',null),
(146,26,3,'N','snow',null),
(147,27,3,'N','forest',null),
(148,28,3,'N','snow',null),
(149,29,3,'N','tundra',null),
(150,30,3,'X','forest',null),
(151,31,3,'X','plains',null),
(152,32,3,'X','mountain','aluminum'),
(153,33,3,'X','mountain',null),
(154,34,3,null,'coast',null),
(155,35,3,null,'ocean',null),
(156,36,3,null,'ocean',null),
(157,37,3,null,'ocean',null),
(158,38,3,null,'ocean',null),
(159,39,3,null,'ocean',null),
(160,0,4,null,'ocean',null),
(161,1,4,null,'ocean',null),
(162,2,4,null,'coast',null),
(163,3,4,'N','tundra',null),
(164,4,4,'N','tundra',null),
(165,5,4,'N','snow',null),
(166,6,4,'N','snow',null),
(167,7,4,'N','hills',null),
(168,8,4,'N','hills',null),
(169,9,4,'N','tundra',null),
(170,10,4,'N','snow',null),
(171,11,4,'N','tundra',null),
(172,12,4,'N','hills',null),
(173,13,4,'N','tundra',null),
(174,14,4,'N','hills',null),
(175,15,4,'N','snow',null),
(176,16,4,'N','forest',null),
(177,17,4,'N','forest',null),
(178,18,4,'N','tundra',null),
(179,19,4,'N','tundra',null),
(180,20,4,'N','tundra',null),
(181,21,4,'N','tundra',null),
(182,22,4,'N','tundra',null),
(183,23,4,'N','forest',null),
(184,24,4,'N','tundra',null),
(185,25,4,'N','tundra',null),
(186,26,4,'N','tundra',null),
(187,27,4,'N','hills',null),
(188,28,4,'N','tundra',null),
(189,29,4,'N','forest',null),
(190,30,4,'X','plains',null),
(191,31,4,'X','hills','aluminum'),
(192,32,4,'X','plains',null),
(193,33,4,'X','hills',null),
(194,34,4,null,'coast',null),
(195,35,4,null,'coast',null),
(196,36,4,null,'coast',null),
(197,37,4,null,'coast',null),
(198,38,4,null,'ocean',null),
(199,39,4,null,'ocean',null),
(200,0,5,null,'ocean',null),
(201,1,5,null,'ocean',null),
(202,2,5,null,'coast',null),
(203,3,5,null,'coast',null),
(204,4,5,null,'coast',null),
(205,5,5,null,'coast',null),
(206,6,5,null,'coast',null),
(207,7,5,'N','forest',null),
(208,8,5,'N','tundra',null),
(209,9,5,'N','hills','aluminum'),
(210,10,5,'N','tundra',null),
(211,11,5,'N','forest',null),
(212,12,5,'N','forest',null),
(213,13,5,'N','tundra',null),
(214,14,5,'N','tundra',null),
(215,15,5,'N','snow',null),
(216,16,5,'N','tundra',null),
(217,17,5,'N','forest',null),
(218,18,5,'N','tundra',null),
(219,19,5,'N','snow',null),
(220,20,5,'N','tundra',null),
(221,21,5,'N','forest',null),
(222,22,5,'N','tundra',null),
(223,23,5,'N','hills','uranium'),
(224,24,5,'N','tundra',null),
(225,25,5,'N','forest',null),
(226,26,5,'N','tundra',null),
(227,27,5,null,'coast',null),
(228,28,5,null,'coast',null),
(229,29,5,null,'coast',null),
(230,30,5,null,'coast',null),
(231,31,5,'X','hills',null),
(232,32,5,'X','forest',null),
(233,33,5,null,'coast',null),
(234,34,5,'A','desert',null),
(235,35,5,'A','desert',null),
(236,36,5,'A','forest',null),
(237,37,5,null,'coast',null),
(238,38,5,null,'ocean',null),
(239,39,5,null,'ocean',null),
(240,0,6,null,'ocean',null),
(241,1,6,null,'ocean',null),
(242,2,6,null,'ocean',null),
(243,3,6,null,'ocean',null),
(244,4,6,null,'ocean',null),
(245,5,6,null,'ocean',null),
(246,6,6,null,'ocean',null),
(247,7,6,null,'coast',null),
(248,8,6,null,'coast',null),
(249,9,6,null,'coast',null),
(250,10,6,null,'coast',null),
(251,11,6,null,'coast',null),
(252,12,6,'C','hills',null),
(253,13,6,'C','hills','iron'),
(254,14,6,'C','plains',null),
(255,15,6,'C','desert',null),
(256,16,6,'C','mountain',null),
(257,17,6,'C','plains',null),
(258,18,6,null,'coast',null),
(259,19,6,null,'coast',null),
(260,20,6,null,'coast',null),
(261,21,6,null,'coast',null),
(262,22,6,null,'coast',null),
(263,23,6,null,'coast',null),
(264,24,6,null,'coast',null),
(265,25,6,null,'coast',null),
(266,26,6,null,'coast',null),
(267,27,6,null,'coast',null),
(268,28,6,null,'ocean',null),
(269,29,6,null,'ocean',null),
(270,30,6,null,'ocean',null),
(271,31,6,null,'coast',null),
(272,32,6,null,'coast',null),
(273,33,6,'A','plains',null),
(274,34,6,'A','desert',null),
(275,35,6,'A','plains',null),
(276,36,6,'A','desert',null),
(277,37,6,'A','hills',null),
(278,38,6,null,'coast',null),
(279,39,6,null,'ocean',null),
(280,0,7,null,'ocean',null),
(281,1,7,null,'ocean',null),
(282,2,7,null,'ocean',null),
(283,3,7,null,'ocean',null),
(284,4,7,null,'ocean',null),
(285,5,7,null,'ocean',null),
(286,6,7,null,'coast',null),
(287,7,7,null,'coast',null),
(288,8,7,null,'coast',null),
(289,9,7,null,'coast',null),
(290,10,7,null,'coast',null),
(291,11,7,null,'coast',null),
(292,12,7,'C','hills',null),
(293,13,7,'C','desert',null),
(294,14,7,'C','plains',null),
(295,15,7,'C','desert',null),
(296,16,7,'K','hills',null),
(297,17,7,'K','hills',null),
(298,18,7,null,'coast',null),
(299,19,7,null,'coast',null),
(300,20,7,null,'coast',null),
(301,21,7,null,'coast',null),
(302,22,7,null,'ocean',null),
(303,23,7,null,'ocean',null),
(304,24,7,null,'ocean',null),
(305,25,7,null,'coast',null),
(306,26,7,null,'coast',null),
(307,27,7,null,'coast',null),
(308,28,7,null,'ocean',null),
(309,29,7,null,'ocean',null),
(310,30,7,null,'ocean',null),
(311,31,7,null,'coast',null),
(312,32,7,null,'coast',null),
(313,33,7,'A','hills',null),
(314,34,7,'A','plains',null),
(315,35,7,'A','plains',null),
(316,36,7,'A','hills',null),
(317,37,7,'A','plains',null),
(318,38,7,null,'coast',null),
(319,39,7,null,'ocean',null),
(320,0,8,null,'ocean',null),
(321,1,8,null,'ocean',null),
(322,2,8,null,'ocean',null),
(323,3,8,null,'ocean',null),
(324,4,8,null,'ocean',null),
(325,5,8,null,'coast',null),
(326,6,8,null,'coast',null),
(327,7,8,'C','plains',null),
(328,8,8,'C','plains',null),
(329,9,8,'C','hills',null),
(330,10,8,'C','plains',null),
(331,11,8,'C','forest',null),
(332,12,8,'C','desert',null),
(333,13,8,'C','hills',null),
(334,14,8,'C','plains',null),
(335,15,8,'C','desert',null),
(336,16,8,'C','hills',null),
(337,17,8,'C','plains',null),
(338,18,8,'K','plains',null),
(339,19,8,'K','forest',null),
(340,20,8,'K','hills',null),
(341,21,8,'K','hills',null),
(342,22,8,null,'coast',null),
(343,23,8,null,'ocean',null),
(344,24,8,null,'ocean',null),
(345,25,8,null,'coast',null),
(346,26,8,'J','forest',null),
(347,27,8,'J','plains',null),
(348,28,8,null,'coast',null),
(349,29,8,null,'ocean',null),
(350,30,8,null,'ocean',null),
(351,31,8,null,'coast',null),
(352,32,8,'A','hills',null),
(353,33,8,'A','hills','aluminum'),
(354,34,8,'A','plains',null),
(355,35,8,'A','plains',null),
(356,36,8,'A','plains',null),
(357,37,8,'A','hills',null),
(358,38,8,'A','desert',null),
(359,39,8,null,'coast',null),
(360,0,9,null,'ocean',null),
(361,1,9,null,'ocean',null),
(362,2,9,null,'ocean',null),
(363,3,9,null,'coast',null),
(364,4,9,null,'coast',null),
(365,5,9,'C','mountain',null),
(366,6,9,'C','forest',null),
(367,7,9,'C','mountain',null),
(368,8,9,'C','plains',null),
(369,9,9,'C','forest',null),
(370,10,9,'C','plains',null),
(371,11,9,'C','plains',null),
(372,12,9,'C','desert',null),
(373,13,9,'C','hills',null),
(374,14,9,'C','plains',null),
(375,15,9,null,'coast',null),
(376,16,9,null,'coast',null),
(377,17,9,null,'coast',null),
(378,18,9,'K','forest',null),
(379,19,9,'K','forest',null),
(380,20,9,'K','plains',null),
(381,21,9,'K','mountain',null),
(382,22,9,null,'coast',null),
(383,23,9,null,'ocean',null),
(384,24,9,null,'coast',null),
(385,25,9,null,'coast',null),
(386,26,9,'J','forest','copper'),
(387,27,9,'J','hills','copper'),
(388,28,9,null,'coast',null),
(389,29,9,null,'ocean',null),
(390,30,9,null,'ocean',null),
(391,31,9,null,'coast',null),
(392,32,9,'A','hills',null),
(393,33,9,'A','forest',null),
(394,34,9,'A','plains',null),
(395,35,9,'A','mountain',null),
(396,36,9,'A','plains',null),
(397,37,9,'A','mountain',null),
(398,38,9,'A','plains','wine'),
(399,39,9,null,'coast',null),
(400,0,10,null,'ocean',null),
(401,1,10,null,'ocean',null),
(402,2,10,null,'ocean',null),
(403,3,10,null,'coast',null),
(404,4,10,'C','hills',null),
(405,5,10,'C','desert',null),
(406,6,10,'C','hills','copper'),
(407,7,10,'C','forest',null),
(408,8,10,'C','mountain',null),
(409,9,10,'C','desert',null),
(410,10,10,'C','hills',null),
(411,11,10,'C','plains',null),
(412,12,10,'C','plains',null),
(413,13,10,'C','plains',null),
(414,14,10,'C','plains',null),
(415,15,10,'C','forest',null),
(416,16,10,null,'coast',null),
(417,17,10,null,'coast',null),
(418,18,10,null,'coast',null),
(419,19,10,'K','forest','iron'),
(420,20,10,'K','plains',null),
(421,21,10,'K','forest',null),
(422,22,10,null,'coast',null),
(423,23,10,null,'ocean',null),
(424,24,10,null,'coast',null),
(425,25,10,'J','plains',null),
(426,26,10,'J','plains',null),
(427,27,10,'J','forest',null),
(428,28,10,'J','plains',null),
(429,29,10,null,'coast',null),
(430,30,10,null,'ocean',null),
(431,31,10,null,'coast',null),
(432,32,10,'A','plains',null),
(433,33,10,'A','hills',null),
(434,34,10,'A','forest',null),
(435,35,10,'A','desert','wine'),
(436,36,10,'A','plains',null),
(437,37,10,'A','plains',null),
(438,38,10,'A','plains',null),
(439,39,10,null,'coast',null),
(440,0,11,null,'ocean',null),
(441,1,11,null,'coast',null),
(442,2,11,null,'coast',null),
(443,3,11,'C','plains',null),
(444,4,11,'C','hills',null),
(445,5,11,'C','plains',null),
(446,6,11,'C','forest',null),
(447,7,11,'C','plains',null),
(448,8,11,'C','hills','rare'),
(449,9,11,'C','desert',null),
(450,10,11,'C','forest',null),
(451,11,11,'C','hills','iron'),
(452,12,11,'C','forest',null),
(453,13,11,'C','desert',null),
(454,14,11,'C','plains',null),
(455,15,11,'C','mountain',null),
(456,16,11,'C','plains',null),
(457,17,11,null,'coast',null),
(458,18,11,null,'coast',null),
(459,19,11,'K','plains',null),
(460,20,11,'K','plains',null),
(461,21,11,'K','forest',null),
(462,22,11,null,'coast',null),
(463,23,11,null,'ocean',null),
(464,24,11,null,'coast',null),
(465,25,11,'J','plains',null),
(466,26,11,'J','plains',null),
(467,27,11,'J','forest',null),
(468,28,11,'J','forest',null),
(469,29,11,null,'coast',null),
(470,30,11,null,'ocean',null),
(471,31,11,null,'coast',null),
(472,32,11,'A','desert',null),
(473,33,11,'A','forest',null),
(474,34,11,'A','plains',null),
(475,35,11,'A','forest',null),
(476,36,11,'A','plains',null),
(477,37,11,'A','desert',null),
(478,38,11,'A','desert',null),
(479,39,11,null,'coast',null),
(480,0,12,null,'ocean',null),
(481,1,12,null,'coast',null),
(482,2,12,'C','forest',null),
(483,3,12,'C','plains',null),
(484,4,12,'C','plains',null),
(485,5,12,'C','hills',null),
(486,6,12,'C','desert',null),
(487,7,12,'C','desert',null),
(488,8,12,'C','plains',null),
(489,9,12,'C','hills',null),
(490,10,12,'C','plains',null),
(491,11,12,'C','forest',null),
(492,12,12,'C','forest',null),
(493,13,12,'C','desert',null),
(494,14,12,'C','desert',null),
(495,15,12,'C','hills',null),
(496,16,12,'C','hills','copper'),
(497,17,12,'C','plains',null),
(498,18,12,null,'coast',null),
(499,19,12,'K','plains',null),
(500,20,12,'K','plains',null),
(501,21,12,'K','hills',null),
(502,22,12,null,'coast',null),
(503,23,12,null,'ocean',null),
(504,24,12,null,'coast',null),
(505,25,12,'J','hills',null),
(506,26,12,'J','plains',null),
(507,27,12,'J','mountain',null),
(508,28,12,'J','hills',null),
(509,29,12,null,'coast',null),
(510,30,12,null,'ocean',null),
(511,31,12,null,'coast',null),
(512,32,12,'A','desert',null),
(513,33,12,'A','plains',null),
(514,34,12,'A','plains',null),
(515,35,12,'A','plains',null),
(516,36,12,'A','forest',null),
(517,37,12,'A','plains',null),
(518,38,12,'A','mountain',null),
(519,39,12,null,'coast',null),
(520,0,13,null,'ocean',null),
(521,1,13,null,'coast',null),
(522,2,13,'C','plains',null),
(523,3,13,'C','plains',null),
(524,4,13,'C','mountain',null),
(525,5,13,'C','hills',null),
(526,6,13,'C','plains',null),
(527,7,13,'C','forest',null),
(528,8,13,'C','mountain',null),
(529,9,13,'C','plains',null),
(530,10,13,'C','plains',null),
(531,11,13,'C','mountain',null),
(532,12,13,'C','hills',null),
(533,13,13,'C','plains',null),
(534,14,13,'C','plains',null),
(535,15,13,'C','desert',null),
(536,16,13,'C','mountain',null),
(537,17,13,'C','plains',null),
(538,18,13,null,'coast',null),
(539,19,13,'K','hills','iron'),
(540,20,13,'K','hills',null),
(541,21,13,'K','forest',null),
(542,22,13,null,'coast',null),
(543,23,13,null,'ocean',null),
(544,24,13,null,'coast',null),
(545,25,13,'J','plains',null),
(546,26,13,'J','hills',null),
(547,27,13,'J','hills',null),
(548,28,13,'J','hills',null),
(549,29,13,null,'coast',null),
(550,30,13,null,'ocean',null),
(551,31,13,null,'coast',null),
(552,32,13,'A','hills','aluminum'),
(553,33,13,'A','plains',null),
(554,34,13,'A','plains',null),
(555,35,13,'A','plains',null),
(556,36,13,'A','plains',null),
(557,37,13,'A','desert',null),
(558,38,13,'A','desert',null),
(559,39,13,null,'coast',null),
(560,0,14,null,'ocean',null),
(561,1,14,null,'coast',null),
(562,2,14,'C','hills',null),
(563,3,14,'C','desert',null),
(564,4,14,'C','plains',null),
(565,5,14,'C','plains',null),
(566,6,14,'C','hills',null),
(567,7,14,'C','plains',null),
(568,8,14,'C','desert',null),
(569,9,14,'C','desert',null),
(570,10,14,'C','hills','cotton'),
(571,11,14,'C','plains',null),
(572,12,14,'C','plains',null),
(573,13,14,'C','desert',null),
(574,14,14,'C','desert',null),
(575,15,14,'C','plains',null),
(576,16,14,'C','hills',null),
(577,17,14,'C','forest',null),
(578,18,14,null,'coast',null),
(579,19,14,'K','hills',null),
(580,20,14,'K','hills','iron'),
(581,21,14,'K','plains',null),
(582,22,14,null,'coast',null),
(583,23,14,null,'ocean',null),
(584,24,14,null,'ocean',null),
(585,25,14,null,'coast',null),
(586,26,14,'J','forest',null),
(587,27,14,'J','mountain',null),
(588,28,14,null,'coast',null),
(589,29,14,null,'coast',null),
(590,30,14,null,'ocean',null),
(591,31,14,null,'coast',null),
(592,32,14,'A','plains',null),
(593,33,14,'A','plains',null),
(594,34,14,'A','forest',null),
(595,35,14,'A','hills',null),
(596,36,14,'A','plains',null),
(597,37,14,'A','forest',null),
(598,38,14,'A','desert',null),
(599,39,14,null,'coast',null),
(600,0,15,null,'ocean',null),
(601,1,15,null,'coast',null),
(602,2,15,'C','plains',null),
(603,3,15,'C','hills',null),
(604,4,15,'C','desert',null),
(605,5,15,'C','plains',null),
(606,6,15,'C','plains',null),
(607,7,15,'C','plains','cotton'),
(608,8,15,'C','mountain',null),
(609,9,15,'C','hills',null),
(610,10,15,'C','plains',null),
(611,11,15,'C','forest',null),
(612,12,15,'C','desert',null),
(613,13,15,'C','plains',null),
(614,14,15,'C','desert',null),
(615,15,15,'C','plains',null),
(616,16,15,'C','plains',null),
(617,17,15,'C','plains',null),
(618,18,15,null,'coast',null),
(619,19,15,null,'coast',null),
(620,20,15,null,'coast',null),
(621,21,15,null,'coast',null),
(622,22,15,null,'ocean',null),
(623,23,15,null,'ocean',null),
(624,24,15,null,'ocean',null),
(625,25,15,null,'coast',null),
(626,26,15,'J','forest','copper'),
(627,27,15,'J','forest',null),
(628,28,15,null,'coast',null),
(629,29,15,null,'ocean',null),
(630,30,15,null,'ocean',null),
(631,31,15,null,'coast',null),
(632,32,15,'A','desert',null),
(633,33,15,'A','plains',null),
(634,34,15,'A','plains','oil'),
(635,35,15,'A','plains',null),
(636,36,15,'A','forest',null),
(637,37,15,'A','plains',null),
(638,38,15,'A','mountain',null),
(639,39,15,null,'coast',null),
(640,0,16,null,'ocean',null),
(641,1,16,null,'ocean',null),
(642,2,16,null,'coast',null),
(643,3,16,'C','hills',null),
(644,4,16,'C','plains',null),
(645,5,16,'C','hills',null),
(646,6,16,'C','hills',null),
(647,7,16,'C','forest',null),
(648,8,16,'C','plains',null),
(649,9,16,'C','hills',null),
(650,10,16,'C','plains',null),
(651,11,16,'C','plains',null),
(652,12,16,'C','forest',null),
(653,13,16,'C','forest',null),
(654,14,16,'C','plains',null),
(655,15,16,'C','mountain','rare'),
(656,16,16,'C','plains',null),
(657,17,16,null,'coast',null),
(658,18,16,null,'coast',null),
(659,19,16,null,'ocean',null),
(660,20,16,null,'ocean',null),
(661,21,16,null,'ocean',null),
(662,22,16,null,'ocean',null),
(663,23,16,null,'coast',null),
(664,24,16,null,'coast',null),
(665,25,16,null,'ocean',null),
(666,26,16,null,'coast',null),
(667,27,16,null,'coast',null),
(668,28,16,null,'coast',null),
(669,29,16,null,'ocean',null),
(670,30,16,null,'coast',null),
(671,31,16,null,'coast',null),
(672,32,16,'A','plains',null),
(673,33,16,'A','plains',null),
(674,34,16,'A','plains',null),
(675,35,16,'A','plains',null),
(676,36,16,'A','plains',null),
(677,37,16,'A','plains',null),
(678,38,16,'A','hills',null),
(679,39,16,null,'coast',null),
(680,0,17,null,'ocean',null),
(681,1,17,null,'ocean',null),
(682,2,17,null,'coast',null),
(683,3,17,null,'coast',null),
(684,4,17,'C','mountain',null),
(685,5,17,'C','plains',null),
(686,6,17,'C','forest',null),
(687,7,17,'C','desert',null),
(688,8,17,'C','plains',null),
(689,9,17,'C','plains',null),
(690,10,17,'C','forest',null),
(691,11,17,'C','plains',null),
(692,12,17,'C','plains',null),
(693,13,17,'C','desert',null),
(694,14,17,'C','forest',null),
(695,15,17,'C','plains',null),
(696,16,17,null,'coast',null),
(697,17,17,null,'ocean',null),
(698,18,17,null,'ocean',null),
(699,19,17,null,'ocean',null),
(700,20,17,null,'ocean',null),
(701,21,17,null,'ocean',null),
(702,22,17,null,'coast',null),
(703,23,17,'K','forest',null),
(704,24,17,null,'coast',null),
(705,25,17,null,'ocean',null),
(706,26,17,null,'ocean',null),
(707,27,17,null,'ocean',null),
(708,28,17,null,'ocean',null),
(709,29,17,null,'coast',null),
(710,30,17,'J','forest',null),
(711,31,17,null,'coast',null),
(712,32,17,'A','hills',null),
(713,33,17,'A','forest',null),
(714,34,17,'A','plains',null),
(715,35,17,'A','forest',null),
(716,36,17,'A','desert','oil'),
(717,37,17,'A','forest',null),
(718,38,17,'A','forest',null),
(719,39,17,null,'coast',null),
(720,0,18,null,'ocean',null),
(721,1,18,null,'ocean',null),
(722,2,18,null,'ocean',null),
(723,3,18,null,'ocean',null),
(724,4,18,null,'coast',null),
(725,5,18,'C','desert',null),
(726,6,18,'C','forest',null),
(727,7,18,'C','mountain',null),
(728,8,18,'C','plains',null),
(729,9,18,'C','plains',null),
(730,10,18,'C','plains',null),
(731,11,18,'C','plains',null),
(732,12,18,'C','desert',null),
(733,13,18,'C','desert',null),
(734,14,18,'C','mountain',null),
(735,15,18,null,'coast',null),
(736,16,18,null,'coast',null),
(737,17,18,null,'ocean',null),
(738,18,18,null,'ocean',null),
(739,19,18,null,'ocean',null),
(740,20,18,null,'ocean',null),
(741,21,18,null,'ocean',null),
(742,22,18,null,'ocean',null),
(743,23,18,null,'coast',null),
(744,24,18,null,'coast',null),
(745,25,18,null,'ocean',null),
(746,26,18,null,'ocean',null),
(747,27,18,null,'ocean',null),
(748,28,18,null,'ocean',null),
(749,29,18,null,'ocean',null),
(750,30,18,null,'coast',null),
(751,31,18,null,'coast',null),
(752,32,18,'A','desert',null),
(753,33,18,'A','hills',null),
(754,34,18,'A','desert',null),
(755,35,18,'A','plains',null),
(756,36,18,'A','plains',null),
(757,37,18,'A','plains',null),
(758,38,18,'A','plains',null),
(759,39,18,null,'coast',null),
(760,0,19,null,'ocean',null),
(761,1,19,null,'ocean',null),
(762,2,19,null,'ocean',null),
(763,3,19,null,'ocean',null),
(764,4,19,null,'coast',null),
(765,5,19,null,'coast',null),
(766,6,19,null,'coast',null),
(767,7,19,'C','mountain',null),
(768,8,19,'C','mountain','iron'),
(769,9,19,'C','desert',null),
(770,10,19,'C','desert',null),
(771,11,19,'C','desert',null),
(772,12,19,'C','hills',null),
(773,13,19,null,'coast',null),
(774,14,19,null,'coast',null),
(775,15,19,null,'coast',null),
(776,16,19,null,'coast',null),
(777,17,19,null,'coast',null),
(778,18,19,null,'coast',null),
(779,19,19,null,'ocean',null),
(780,20,19,null,'ocean',null),
(781,21,19,null,'ocean',null),
(782,22,19,null,'ocean',null),
(783,23,19,null,'ocean',null),
(784,24,19,null,'ocean',null),
(785,25,19,null,'ocean',null),
(786,26,19,null,'ocean',null),
(787,27,19,null,'ocean',null),
(788,28,19,null,'ocean',null),
(789,29,19,null,'ocean',null),
(790,30,19,null,'ocean',null),
(791,31,19,null,'coast',null),
(792,32,19,'A','plains',null),
(793,33,19,'A','desert',null),
(794,34,19,'A','forest',null),
(795,35,19,'A','plains',null),
(796,36,19,'A','desert',null),
(797,37,19,'A','plains',null),
(798,38,19,'A','hills',null),
(799,39,19,null,'coast',null),
(800,0,20,null,'ocean',null),
(801,1,20,null,'ocean',null),
(802,2,20,null,'ocean',null),
(803,3,20,null,'ocean',null),
(804,4,20,null,'ocean',null),
(805,5,20,null,'ocean',null),
(806,6,20,null,'ocean',null),
(807,7,20,null,'coast',null),
(808,8,20,null,'coast',null),
(809,9,20,null,'coast',null),
(810,10,20,'T','jungle',null),
(811,11,20,'T','plains',null),
(812,12,20,'T','hills',null),
(813,13,20,'T','jungle','spice'),
(814,14,20,'T','jungle',null),
(815,15,20,'T','plains',null),
(816,16,20,'T','forest',null),
(817,17,20,'T','plains','rubber'),
(818,18,20,'T','plains',null),
(819,19,20,null,'coast',null),
(820,20,20,null,'coast',null),
(821,21,20,null,'ocean',null),
(822,22,20,null,'ocean',null),
(823,23,20,null,'ocean',null),
(824,24,20,null,'ocean',null),
(825,25,20,null,'ocean',null),
(826,26,20,null,'ocean',null),
(827,27,20,null,'ocean',null),
(828,28,20,null,'ocean',null),
(829,29,20,null,'ocean',null),
(830,30,20,null,'ocean',null),
(831,31,20,null,'ocean',null),
(832,32,20,null,'coast',null),
(833,33,20,'A','plains',null),
(834,34,20,'A','plains',null),
(835,35,20,'A','hills','iron'),
(836,36,20,'A','plains',null),
(837,37,20,'A','desert','oil'),
(838,38,20,null,'coast',null),
(839,39,20,null,'coast',null),
(840,0,21,null,'ocean',null),
(841,1,21,null,'ocean',null),
(842,2,21,null,'ocean',null),
(843,3,21,null,'ocean',null),
(844,4,21,null,'ocean',null),
(845,5,21,null,'ocean',null),
(846,6,21,null,'ocean',null),
(847,7,21,null,'coast',null),
(848,8,21,null,'coast',null),
(849,9,21,'T','jungle',null),
(850,10,21,'T','jungle',null),
(851,11,21,'T','jungle',null),
(852,12,21,'T','jungle',null),
(853,13,21,'T','plains',null),
(854,14,21,'T','jungle',null),
(855,15,21,'T','jungle',null),
(856,16,21,'T','jungle',null),
(857,17,21,'T','plains',null),
(858,18,21,'T','jungle',null),
(859,19,21,'T','jungle',null),
(860,20,21,null,'coast',null),
(861,21,21,null,'ocean',null),
(862,22,21,null,'ocean',null),
(863,23,21,null,'coast',null),
(864,24,21,null,'coast',null),
(865,25,21,null,'coast',null),
(866,26,21,null,'coast',null),
(867,27,21,null,'coast',null),
(868,28,21,null,'ocean',null),
(869,29,21,null,'ocean',null),
(870,30,21,null,'ocean',null),
(871,31,21,null,'ocean',null),
(872,32,21,null,'coast',null),
(873,33,21,'A','plains',null),
(874,34,21,'A','hills',null),
(875,35,21,'A','forest',null),
(876,36,21,'A','plains',null),
(877,37,21,'A','plains',null),
(878,38,21,null,'coast',null),
(879,39,21,null,'ocean',null),
(880,0,22,null,'ocean',null),
(881,1,22,null,'ocean',null),
(882,2,22,null,'coast',null),
(883,3,22,null,'coast',null),
(884,4,22,null,'coast',null),
(885,5,22,null,'coast',null),
(886,6,22,null,'ocean',null),
(887,7,22,null,'coast',null),
(888,8,22,'T','jungle',null),
(889,9,22,'T','hills',null),
(890,10,22,'T','forest',null),
(891,11,22,'T','jungle',null),
(892,12,22,'T','hills',null),
(893,13,22,'T','plains','rubber'),
(894,14,22,'T','plains',null),
(895,15,22,'T','plains',null),
(896,16,22,'T','plains',null),
(897,17,22,'T','jungle',null),
(898,18,22,'T','jungle',null),
(899,19,22,'T','plains',null),
(900,20,22,'T','jungle',null),
(901,21,22,null,'coast',null),
(902,22,22,null,'ocean',null),
(903,23,22,null,'coast',null),
(904,24,22,'X','mountain',null),
(905,25,22,'X','hills','aluminum'),
(906,26,22,'X','plains',null),
(907,27,22,'X','hills',null),
(908,28,22,null,'coast',null),
(909,29,22,null,'coast',null),
(910,30,22,null,'ocean',null),
(911,31,22,null,'ocean',null),
(912,32,22,null,'ocean',null),
(913,33,22,null,'coast',null),
(914,34,22,'A','plains',null),
(915,35,22,'A','hills',null),
(916,36,22,'A','desert',null),
(917,37,22,null,'coast',null),
(918,38,22,null,'coast',null),
(919,39,22,null,'ocean',null),
(920,0,23,null,'coast',null),
(921,1,23,null,'coast',null),
(922,2,23,'X','hills','iron'),
(923,3,23,'X','hills',null),
(924,4,23,'X','hills',null),
(925,5,23,null,'coast',null),
(926,6,23,null,'ocean',null),
(927,7,23,null,'coast',null),
(928,8,23,'T','plains',null),
(929,9,23,'T','forest','rubber'),
(930,10,23,'T','forest',null),
(931,11,23,'T','plains',null),
(932,12,23,'T','forest',null),
(933,13,23,'T','jungle',null),
(934,14,23,'T','jungle',null),
(935,15,23,'T','hills',null),
(936,16,23,'T','jungle',null),
(937,17,23,'T','jungle',null),
(938,18,23,'T','plains',null),
(939,19,23,'T','plains',null),
(940,20,23,'T','plains',null),
(941,21,23,null,'coast',null),
(942,22,23,null,'coast',null),
(943,23,23,'X','forest',null),
(944,24,23,'X','hills',null),
(945,25,23,'X','plains',null),
(946,26,23,'X','hills',null),
(947,27,23,'X','plains',null),
(948,28,23,'X','plains',null),
(949,29,23,null,'coast',null),
(950,30,23,null,'ocean',null),
(951,31,23,null,'ocean',null),
(952,32,23,null,'ocean',null),
(953,33,23,null,'coast',null),
(954,34,23,null,'coast',null),
(955,35,23,null,'coast',null),
(956,36,23,null,'coast',null),
(957,37,23,null,'ocean',null),
(958,38,23,null,'ocean',null),
(959,39,23,null,'ocean',null),
(960,0,24,null,'coast',null),
(961,1,24,'X','plains',null),
(962,2,24,'X','forest',null),
(963,3,24,'X','hills',null),
(964,4,24,'X','hills',null),
(965,5,24,null,'coast',null),
(966,6,24,null,'ocean',null),
(967,7,24,null,'ocean',null),
(968,8,24,null,'coast',null),
(969,9,24,'T','hills',null),
(970,10,24,'T','forest',null),
(971,11,24,'T','jungle',null),
(972,12,24,'T','plains',null),
(973,13,24,'T','hills','copper'),
(974,14,24,'T','jungle',null),
(975,15,24,'T','jungle',null),
(976,16,24,'T','hills',null),
(977,17,24,'T','plains',null),
(978,18,24,'T','hills','copper'),
(979,19,24,'T','jungle',null),
(980,20,24,'T','hills',null),
(981,21,24,null,'coast',null),
(982,22,24,null,'ocean',null),
(983,23,24,null,'coast',null),
(984,24,24,'X','plains',null),
(985,25,24,'X','hills',null),
(986,26,24,'X','hills',null),
(987,27,24,'X','hills',null),
(988,28,24,null,'coast',null),
(989,29,24,null,'coast',null),
(990,30,24,null,'ocean',null),
(991,31,24,null,'ocean',null),
(992,32,24,null,'ocean',null),
(993,33,24,null,'ocean',null),
(994,34,24,null,'ocean',null),
(995,35,24,null,'ocean',null),
(996,36,24,null,'ocean',null),
(997,37,24,null,'ocean',null),
(998,38,24,null,'ocean',null),
(999,39,24,null,'ocean',null),
(1000,0,25,null,'coast',null),
(1001,1,25,null,'coast',null),
(1002,2,25,'X','forest',null),
(1003,3,25,'X','hills',null),
(1004,4,25,'X','forest',null),
(1005,5,25,null,'coast',null),
(1006,6,25,null,'ocean',null),
(1007,7,25,null,'ocean',null),
(1008,8,25,null,'coast',null),
(1009,9,25,null,'coast',null),
(1010,10,25,'T','jungle',null),
(1011,11,25,'T','plains',null),
(1012,12,25,'T','forest',null),
(1013,13,25,'T','plains',null),
(1014,14,25,'T','forest',null),
(1015,15,25,'T','forest',null),
(1016,16,25,'T','jungle',null),
(1017,17,25,'T','jungle','spice'),
(1018,18,25,'T','hills',null),
(1019,19,25,'T','jungle',null),
(1020,20,25,'T','jungle',null),
(1021,21,25,null,'coast',null),
(1022,22,25,null,'ocean',null),
(1023,23,25,null,'coast',null),
(1024,24,25,null,'coast',null),
(1025,25,25,null,'coast',null),
(1026,26,25,null,'coast',null),
(1027,27,25,null,'coast',null),
(1028,28,25,null,'ocean',null),
(1029,29,25,null,'ocean',null),
(1030,30,25,null,'ocean',null),
(1031,31,25,null,'ocean',null),
(1032,32,25,null,'ocean',null),
(1033,33,25,null,'ocean',null),
(1034,34,25,null,'ocean',null),
(1035,35,25,null,'ocean',null),
(1036,36,25,null,'ocean',null),
(1037,37,25,null,'ocean',null),
(1038,38,25,null,'ocean',null),
(1039,39,25,null,'ocean',null),
(1040,0,26,null,'ocean',null),
(1041,1,26,null,'ocean',null),
(1042,2,26,null,'coast',null),
(1043,3,26,null,'coast',null),
(1044,4,26,null,'coast',null),
(1045,5,26,null,'coast',null),
(1046,6,26,null,'ocean',null),
(1047,7,26,null,'ocean',null),
(1048,8,26,null,'ocean',null),
(1049,9,26,null,'ocean',null),
(1050,10,26,null,'coast',null),
(1051,11,26,null,'coast',null),
(1052,12,26,null,'coast',null),
(1053,13,26,null,'coast',null),
(1054,14,26,null,'coast',null),
(1055,15,26,null,'coast',null),
(1056,16,26,null,'coast',null),
(1057,17,26,null,'coast',null),
(1058,18,26,null,'coast',null),
(1059,19,26,null,'coast',null),
(1060,20,26,null,'coast',null),
(1061,21,26,null,'coast',null),
(1062,22,26,null,'ocean',null),
(1063,23,26,null,'ocean',null),
(1064,24,26,null,'ocean',null),
(1065,25,26,null,'ocean',null),
(1066,26,26,null,'ocean',null),
(1067,27,26,null,'ocean',null),
(1068,28,26,null,'ocean',null),
(1069,29,26,null,'ocean',null),
(1070,30,26,null,'ocean',null),
(1071,31,26,null,'ocean',null),
(1072,32,26,null,'ocean',null),
(1073,33,26,null,'ocean',null),
(1074,34,26,null,'ocean',null),
(1075,35,26,null,'ocean',null),
(1076,36,26,null,'ocean',null),
(1077,37,26,null,'ocean',null),
(1078,38,26,null,'ocean',null),
(1079,39,26,null,'ocean',null),
(1080,0,27,null,'ocean',null),
(1081,1,27,null,'ocean',null),
(1082,2,27,null,'ocean',null),
(1083,3,27,null,'ocean',null),
(1084,4,27,null,'ocean',null),
(1085,5,27,null,'ocean',null),
(1086,6,27,null,'ocean',null),
(1087,7,27,null,'ocean',null),
(1088,8,27,null,'ocean',null),
(1089,9,27,null,'ocean',null),
(1090,10,27,null,'ocean',null),
(1091,11,27,null,'ocean',null),
(1092,12,27,null,'ocean',null),
(1093,13,27,null,'ocean',null),
(1094,14,27,null,'ocean',null),
(1095,15,27,null,'ocean',null),
(1096,16,27,null,'ocean',null),
(1097,17,27,null,'ocean',null),
(1098,18,27,null,'ocean',null),
(1099,19,27,null,'ocean',null),
(1100,20,27,null,'ocean',null),
(1101,21,27,null,'ocean',null),
(1102,22,27,null,'ocean',null),
(1103,23,27,null,'ocean',null),
(1104,24,27,null,'ocean',null),
(1105,25,27,null,'ocean',null),
(1106,26,27,null,'ocean',null),
(1107,27,27,null,'ocean',null),
(1108,28,27,null,'ocean',null),
(1109,29,27,null,'ocean',null),
(1110,30,27,null,'ocean',null),
(1111,31,27,null,'ocean',null),
(1112,32,27,null,'ocean',null),
(1113,33,27,null,'ocean',null),
(1114,34,27,null,'ocean',null),
(1115,35,27,null,'ocean',null),
(1116,36,27,null,'ocean',null),
(1117,37,27,null,'ocean',null),
(1118,38,27,null,'ocean',null),
(1119,39,27,null,'ocean',null)
  on conflict (id) do update set c = excluded.c, r = excluded.r, zone = excluded.zone, terrain = excluded.terrain, res = excluded.res;

delete from priv.cities where id not in ('K','J','C','A','N','T','K1','K2','K3','K4','K5','J1','J2','J3','J4','J5','C1','C2','C3','C4','C5','C6','C7','C8','A1','A2','A3','A4','A5','A6','A7','A8','N1','N2','N3','N4','N5','N6','N7','N8','T1','T2','T3','T4','T5','T6','T7','X1','X2','X3','X4','X5');

delete from priv.tiles where id >= 1120;

insert into priv.cities(id, tile_id, kind, type, name, def, sea, tech, tier, max_hp, bonus, tutorial, boss, final) values
('K',460,'capital','K','수도',0,false,null,0,0,0,false,false,false),
('J',466,'capital','J','수도',0,false,null,0,0,0,false,false,false),
('C',530,'capital','C','수도',0,false,null,0,0,0,false,false,false),
('A',555,'capital','A','수도',0,false,null,0,0,0,false,false,false),
('N',96,'capital','N','수도',0,false,null,0,0,0,false,false,false),
('T',894,'capital','T','수도',0,false,null,0,0,0,false,false,false),
('K1',379,'cs','K','소나무골',5,false,'shipbuilding,steelmaking,chipmaking',0,50,100,true,false,false),
('K2',581,'cs','K','푸른나루',8,false,null,1,80,50,false,false,false),
('K3',579,'cs','K','솔바람재',13,false,'navigation',2,110,70,false,false,false),
('K4',703,'cs','K','물새섬',20,true,'economics',3,150,90,false,false,false),
('K5',296,'cs','K','단풍고개',70,false,null,4,100,300,false,false,true),
('J1',546,'cs','J','안개곶',5,false,'shipbuilding,navigation,economics',0,50,100,true,false,false),
('J2',346,'cs','J','붉은항',8,false,null,1,80,50,false,false,false),
('J3',548,'cs','J','벚꽃마을',13,false,'navigation',2,110,70,false,false,false),
('J4',627,'cs','J','등대섬',20,false,'economics',3,150,90,false,false,false),
('J5',710,'cs','J','파도곶',70,true,null,4,100,300,false,false,true),
('C1',449,'cs','C','황토성',5,false,'engineering,economics,steelmaking',0,50,100,true,false,false),
('C2',495,'cs','C','붉은강',8,false,'engineering',1,80,50,false,false,false),
('C3',647,'cs','C','비단마을',8,false,null,1,80,50,false,false,false),
('C4',769,'cs','C','철산성',13,false,'gunpowder',2,110,70,false,false,false),
('C5',694,'cs','C','모래성',13,false,null,2,110,70,false,false,false),
('C6',405,'cs','C','옥수마을',20,false,'economics',3,150,90,false,false,false),
('C7',252,'cs','C','대나무성',20,false,null,3,150,90,false,false,false),
('C8',602,'cs','C','황하나루',70,false,'chipmaking',4,100,300,false,false,true),
('A1',474,'cs','A','들판마을',5,false,'engineering,refining,radar',0,50,100,true,false,false),
('A2',717,'cs','A','큰강나루',8,false,'engineering',1,80,50,false,false,false),
('A3',592,'cs','A','검은샘',8,false,null,1,80,50,false,false,false),
('A4',358,'cs','A','포도골',13,false,'chipmaking',2,110,70,false,false,false),
('A5',794,'cs','A','바위성',13,false,null,2,110,70,false,false,false),
('A6',352,'cs','A','은빛고원',20,false,'combustion',3,150,90,false,false,false),
('A7',877,'cs','A','독수리봉',20,false,null,3,150,90,false,false,false),
('A8',234,'cs','A','황금평원',70,false,null,4,100,300,false,false,true),
('N1',54,'cs','N','눈꽃마을',5,false,'chivalry,refining,economics',0,50,100,true,false,false),
('N2',19,'cs','N','얼음항',8,false,'chivalry',1,80,50,false,false,false),
('N3',49,'cs','N','금빛골',8,false,null,1,80,50,false,false,false),
('N4',23,'cs','N','자작나무골',13,false,'steelmaking',2,110,70,false,false,false),
('N5',222,'cs','N','서리성',13,false,null,2,110,70,false,false,false),
('N6',208,'cs','N','북극성',20,false,'chipmaking',3,150,90,false,false,false),
('N7',5,'cs','N','오로라성',20,false,null,3,150,90,false,false,false),
('N8',69,'cs','N','늑대고개',70,false,null,4,100,300,false,false,true),
('T1',852,'cs','T','야자마을',5,false,'shipbuilding,economics,navigation',0,50,100,true,false,false),
('T2',1013,'cs','T','고무나무골',8,false,'navigation',1,80,50,false,false,false),
('T3',1016,'cs','T','향기섬',8,false,null,1,80,50,false,false,false),
('T4',818,'cs','T','구리곶',13,false,'economics',2,110,70,false,false,false),
('T5',938,'cs','T','산호섬',13,false,null,2,110,70,false,false,false),
('T6',969,'cs','T','망고나루',20,false,'economics',3,150,90,false,false,false),
('T7',1020,'cs','T','코코넛만',70,false,null,4,100,300,false,false,true),
('X1',945,'cs','X','고대 성채 아르카',40,true,null,4,220,150,false,false,false),
('X2',907,'cs','X','수호자의 탑',40,true,null,4,220,150,false,false,false),
('X3',151,'cs','X','폭풍섬',20,true,null,3,150,90,false,false,false),
('X4',193,'cs','X','천둥 요새',40,true,null,4,220,150,false,false,false),
('X5',962,'cs','X','해적만',20,true,null,3,150,90,false,false,false)
  on conflict (id) do update set tile_id = excluded.tile_id, kind = excluded.kind, type = excluded.type, name = excluded.name, def = excluded.def, sea = excluded.sea, tech = excluded.tech, tier = excluded.tier, max_hp = excluded.max_hp, bonus = excluded.bonus, tutorial = excluded.tutorial, boss = excluded.boss, final = excluded.final;

-- ---------------------------------------------------------------------
-- 내부 도우미 (priv: 화면에서 직접 호출 불가)
-- ---------------------------------------------------------------------
create or replace function priv.cfg() returns jsonb
language sql stable as $$ select data from priv.config where id = 1 $$;

create or replace function priv.err(code text, msg text) returns void
language plpgsql as $$ begin raise exception '%: %', code, msg; end $$;

create or replace function priv.turn() returns int
language sql stable as $$ select turn from public.game where id = 1 $$;

create or replace function priv.phase() returns int
language sql stable as $$ select phase from public.game where id = 1 $$;

create or replace function priv.me() returns priv.students
language plpgsql stable as $$
declare r priv.students; obs text := current_setting('trade.observe', true);
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  -- 선생님 관전: admin_observe 안에서만 잠깐 그 나라 학생처럼 보기 (아무것도 바꿀 수 없음)
  if obs is not null and obs <> '' and exists(select 1 from priv.admins where uid = auth.uid()) then
    r.id := 0; r.country_id := obs::int; r.name := '선생님 관전'; r.is_leader := false; r.roles := '{}'; return r;
  end if;
  select * into r from priv.students where uid = auth.uid();
  if not found then
    -- 선생님 체험 모드: 관제실에서 고른 나라의 모든 역할로 직접 조작
    select control into obs from priv.admins where uid = auth.uid() and control is not null;
    if found then
      r.id := 0; r.country_id := obs::int; r.name := '선생님'; r.is_leader := true;
      r.roles := array(select jsonb_array_elements_text(priv.cfg()->'ROLES')); return r;
    end if;
    perform priv.err('NOT_JOINED', '아직 나라에 입장하지 않았어요.');
  end if;
  return r;
end $$;

create or replace function priv.is_admin() returns boolean
language sql stable as $$ select exists(select 1 from priv.admins where uid = auth.uid()) $$;

create or replace function priv.need_admin() returns void
language plpgsql stable as $$
begin
  if not priv.is_admin() then perform priv.err('NOT_ADMIN', '교사 로그인이 필요해요.'); end if;
end $$;

create or replace function priv.bump(c int) returns void
language sql as $$ update public.country_ticks set ver = ver + 1 where country_id = c $$;

create or replace function priv.bump_all() returns void
language sql as $$ update public.country_ticks set ver = ver + 1 where true $$;

create or replace function priv.bump_game() returns void
language sql as $$ update public.game set ver = ver + 1, updated_at = now() where id = 1 $$;

create or replace function priv.notice(msg text, k text default 'info', c int default null) returns void
language sql as $$ insert into public.notices(country, kind, message) values (c, k, msg) $$;

create or replace function priv.notice_d(msg text, k text, c int, d jsonb) returns void
language sql as $$ insert into public.notices(country, kind, message, data) values (c, k, msg, d) $$;

create or replace function priv.event(k text, msg text, d jsonb default null) returns void
language sql as $$ insert into priv.events(turn, kind, message, data) values (priv.turn(), k, msg, d) $$;

create or replace function priv.ctype(c int) returns text
language sql stable as $$ select type from priv.countries where id = c $$;

create or replace function priv.cname(c int) returns text
language sql stable as $$
  select coalesce(nullif(trim(name), ''), priv.cfg()->'TYPES'->type->>'name') from priv.countries where id = c
$$;

create or replace function priv.iname(item text) returns text
language sql stable as $$ select case when item = 'coin' then '코인' else coalesce(priv.cfg()->'ITEMS'->item->>'name', item) end $$;

-- 육각 거리 (odd-r 오프셋 → 큐브)
-- 도시 그림 종류: 수도는 나라 유형(K·J…), 도시국가는 harbor(바다) / fortress(방어 13 이상) / village
-- 물건 목록 글자로: {"gold":2,"coin":50} → 금 2개 · 코인 50
create or replace function priv.items_text(p jsonb) returns text
language sql stable as $$
  select coalesce(string_agg(case when key = 'coin' then '코인 ' || value else priv.iname(key) || ' ' || value || '개' end, ' · '), '')
  from jsonb_each_text(coalesce(p, '{}'::jsonb))
$$;

create or replace function priv.city_art(p_id text) returns text
language sql stable as $$
  select case when c.boss or c.rebel then 'boss' when c.final then 'final' when c.kind = 'capital' then coalesce((select type from priv.countries where id = c.country), c.type)
              when c.tier >= 3 then 'fortress' when c.sea then 'harbor' else 'village' end
  from priv.cities c where c.id = p_id
$$;

create or replace function priv.hdist(c1 int, r1 int, c2 int, r2 int) returns int
language sql immutable as $$
  select greatest(abs(q1 - q2), abs(r1 - r2), abs((-q1 - r1) - (-q2 - r2)))
  from (select c1 - (r1 - (r1 & 1)) / 2 as q1, c2 - (r2 - (r2 & 1)) / 2 as q2) x
$$;

create or replace function priv.within(center int, rad int) returns int[]
language sql stable as $$
  select coalesce(array_agg(t.id), '{}') from priv.tiles t, priv.tiles o
  where o.id = center and t.r between o.r - rad and o.r + rad and priv.hdist(t.c, t.r, o.c, o.r) <= rad
$$;

create or replace function priv.tdist(a int, b int) returns int
language sql stable as $$ select priv.hdist(x.c, x.r, y.c, y.r) from priv.tiles x, priv.tiles y where x.id = a and y.id = b $$;

create or replace function priv.inv(c int, it text) returns int
language sql stable as $$ select coalesce((select qty from priv.inventory where country = c and item = it), 0) $$;

create or replace function priv.coin(c int) returns int
language sql stable as $$ select coalesce((select coin from priv.countries where id = c), 0) $$;

create or replace function priv.add(c int, it text, n int) returns void
language plpgsql as $$
begin
  if it = 'coin' then update priv.countries set coin = coin + n where id = c; return; end if;
  insert into priv.inventory(country, item, qty) values (c, it, n)
    on conflict (country, item) do update set qty = priv.inventory.qty + excluded.qty;
end $$;

-- 비용이 모자라면 무엇이 모자란지 문장으로 (충분하면 null)
create or replace function priv.cost_short(c int, cost jsonb, mult numeric default 1) returns text
language plpgsql stable as $$
declare k text; v numeric; have int; msg text := '';
begin
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(cost, '{}'::jsonb)) loop
    v := ceil(v * mult);
    if k = 'coin' then select coin into have from priv.countries where id = c; else have := priv.inv(c, k); end if;
    if have < v then msg := msg || case when msg = '' then '' else ', ' end || priv.iname(k) || ' ' || (v - have)::int; end if;
  end loop;
  return case when msg = '' then null else msg || '이(가) 모자라요.' end;
end $$;

create or replace function priv.pay(c int, cost jsonb, mult numeric default 1) returns void
language plpgsql as $$
declare k text; v numeric; s text;
begin
  s := priv.cost_short(c, cost, mult);
  if s is not null then perform priv.err('NO_MONEY', s); end if;
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(cost, '{}'::jsonb)) loop
    perform priv.add(c, k, -ceil(v * mult)::int);
  end loop;
end $$;

create or replace function priv.has_tech(c int, t text) returns boolean
language sql stable as $$ select t = any(techs) from priv.countries where id = c $$;

create or replace function priv.military(c int) returns int
language sql stable as $$ select count(*)::int from priv.units where country = c and kind not in ('worker', 'scout') $$;

create or replace function priv.strength(c int, t int) returns int
language sql stable as $$
  select coalesce(sum((priv.cfg()->'UNITS'->kind->>'str')::int), 0)::int
  from priv.units where country = c and kind not in ('worker', 'scout') and attacked_turn < t
$$;

-- 시야 넓히기 + 발견 확인
create or replace function priv.reveal(c int, ids int[]) returns void
language sql as $$
  update priv.countries set explored = (select array_agg(distinct x) from unnest(explored || ids) x) where id = c
$$;

create or replace function priv.check_discovery() returns void
language plpgsql as $$
declare me record; x record; g public.game; cnt int;
begin
  for me in select * from priv.countries order by id loop
    for x in select * from priv.countries where id <> me.id and not (id = any(me.discovered)) loop
      if exists(select 1 from priv.tiles t where t.owner = x.id and t.id = any(me.explored)) then
        update priv.countries set discovered = discovered || x.id where id = me.id;
        perform priv.notice(priv.cname(x.id) || '을(를) 발견했어요! 국경 너머에 다른 나라가 있어요.', 'discover', me.id);
        perform priv.bump(me.id);
      end if;
    end loop;
  end loop;
  select * into g from public.game where id = 1;
  if g.world_first is null then
    for me in select * from priv.countries where coalesce(array_length(discovered, 1), 0) >= 5 order by id limit 1 loop
      update public.game set world_first = me.id, diplomacy_open = true where id = 1;
      update priv.countries set title = '세계 탐험가', coin = coin + 30 where id = me.id;
      perform priv.notice(priv.cname(me.id) || '의 정찰대가 세계의 모든 나라를 발견했습니다! 세계 외교의 시대가 열립니다.', 'world');
      perform priv.event('world_first', priv.cname(me.id) || ' 세계 발견', jsonb_build_object('country', me.id));
      perform priv.bump_game(); perform priv.bump_all();
    end loop;
  end if;
end $$;

-- 영토 넓히기 (같은 유형 땅, 주인 없는 육지)
create or replace function priv.claim(p_country int, p_center int, p_rad int) returns void
language plpgsql as $$
declare tp text := priv.ctype(p_country); sight int := (priv.cfg()->>'CITY_SIGHT')::int;
begin
  update priv.tiles set owner = p_country
   where id = any(priv.within(p_center, p_rad)) and zone = tp and owner is null and terrain not in ('ocean', 'coast');
  perform priv.reveal(p_country, priv.within(p_center, greatest(p_rad, sight)));
end $$;

-- 게임판 처음 상태로 (명단·기기 연결·나라 이름과 국기는 그대로)
create or replace function priv.init_world() returns void
language plpgsql as $$
declare cfg jsonb := priv.cfg(); co record; cap priv.cities; k text; v text;
begin
  update priv.tiles set owner = null, imp = null where true;
  -- 반란 도시였던 튜토리얼 도시국가는 원래 성벽으로
  update priv.cities set rebel = false, def = (cfg->'CS_TIERS'->tier->>'def')::int, max_hp = (cfg->'CS_TIERS'->tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->tier->>'coin')::int
   where rebel or (tutorial and not final);
  update priv.cities set country = null, buildings = '{}', built_turn = -1, trained_turn = -1, trained_count = 0, built_count = 0, unrest = false, taken_turn = null, def_help = 0, hp = max_hp where true;
  delete from priv.units where true;
  delete from priv.inventory where true;
  delete from priv.factories where true;
  delete from priv.advanced where true;
  delete from priv.offers where true;
  delete from priv.trades where true;
  delete from priv.events where true;
  delete from priv.treaties where true;
  delete from priv.reflections where true;
  delete from priv.snapshots where true;
  delete from priv.trade_fails where true;
  delete from priv.expert_notes where true;
  delete from public.notices where true;
  update public.game set phase = 0, turn = 0, turn_end = null, market_open = false, diplomacy_open = false, crisis = false,
    fair_cap = true, tariff = 0, tariffs = '{}'::jsonb, banned = '{}'::jsonb, alliance = false, normalized = false, meet_step = 2, cold_snap = null, world_first = null, locked = false, timer_end = null where id = 1;
  for co in select * from priv.countries order by id loop
    update priv.countries set coin = (cfg->'START'->>'coin')::int, happy = (cfg->'HAPPY'->>'base')::int, glory = '{}', happy_detail = '[]', research_count = 0, lux_used = '{}',
      techs = '{}',
      discovered = '{}', explored = '{}', title = null, lux_types = 0, income = 0, short = '{}', tariff_turn = 0, attacked_turn = -1,
      ready_turn = 0, research_turn = -1, crisis = false, rebuilt = false, import_cut = false
     where id = co.id;
    for k, v in select key, value from jsonb_each_text(cfg->'START') loop
      if k <> 'coin' then perform priv.add(co.id, k, v::int); end if;
    end loop;
    for k, v in select key, value from jsonb_each_text(coalesce(cfg->'START_BONUS'->co.type, '{}'::jsonb)) loop
      perform priv.add(co.id, k, v::int);
    end loop;
    perform priv.add(co.id, cfg->'LUX_OF'->>co.type, 4);   -- 우리 나라 사치품 4개로 시작
    select * into cap from priv.cities where kind = 'capital' and type = co.type;
    update priv.cities set country = co.id, taken_turn = 0 where id = cap.id;
    perform priv.claim(co.id, cap.tile_id, 2);
    -- 도시국가와 그 바로 옆 칸은 처음 국경에서 뺌 (아직 차지하지 않은 중립 도시가 국경 안에 들어가지 않게)
    update priv.tiles t set owner = null
     where t.owner = co.id and priv.tdist(t.id, cap.tile_id) >= 2
       and exists(select 1 from priv.cities c2 where c2.kind = 'cs' and priv.tdist(t.id, c2.tile_id) <= 1);
    -- 우리 나라 쪽 도시국가는 처음부터 지도에 보임 (확장 목표)
    perform priv.reveal(co.id, coalesce((select array_agg(x) from priv.cities c2, unnest(priv.within(c2.tile_id, 1)) x
      where c2.kind = 'cs' and c2.type = co.type), '{}'));
    -- 시작 병력 (노동자·정찰병·창병 2·투석기)
    insert into priv.units(country, kind, tile_id) select co.id, su.kind, cap.tile_id from jsonb_array_elements_text(cfg->'START_UNITS') as su(kind);
  end loop;
  perform priv.check_discovery();
  perform priv.bump_game(); perform priv.bump_all();
end $$;

-- 행복도 계산에 쓰는 이번 턴 사치품 종류 (소비 전)
create or replace function priv.lux_types_now(c int) returns int
language sql stable as $$
  select count(*)::int from priv.inventory i
  where i.country = c and i.qty >= 1 and i.item in (select jsonb_array_elements_text(priv.cfg()->'LUX'))
$$;

-- 지구 서버 안정도: 0.4 평균 행복도 + 0.2 경제력 + 0.2 문화력 + 0.2 거래량
create or replace function priv.world_power() returns jsonb
language sql stable as $$
  with cfg as (select priv.cfg() d),
  e as (select coalesce(sum(c.income), 0) + coalesce((select sum((cfg.d->'ADVANCED'->a.kind->>'econ')::int) from priv.advanced a, cfg), 0) econ,
               coalesce(sum(c.lux_types * 5), 0) + coalesce((select sum(coalesce((cfg.d->'ADVANCED'->a.kind->>'culture')::int, 0)) from priv.advanced a, cfg), 0) culture,
               coalesce(avg(c.happy), 0) happy
        from priv.countries c)
  select jsonb_build_object('econ', econ, 'culture', culture, 'happy', round(happy)) from e
$$;

create or replace function priv.trade_volume(t int) returns int
language sql stable as $$ select coalesce(sum(qty), 0)::int from priv.trades where turn = t and not broker $$;

create or replace function priv.gauge() returns int
language sql stable as $$
  with w as (select priv.world_power() p), g as (select turn, base_vol, banned from public.game where id = 1)
  select round(0.4 * least(100, greatest(0, (w.p->>'happy')::numeric + 50))
             + 0.2 * least(100, (w.p->>'econ')::numeric / 4.2)
             + 0.2 * least(100, (w.p->>'culture')::numeric / 1.5)
             + 0.2 * least(100, priv.trade_volume(g.turn - 1) * 100.0 / greatest(1, g.base_vol))
             - case when g.banned <> '{}'::jsonb then 15 else 0 end
             - 3 * (select count(*) from priv.cities where rebel))::int
  from w, g
$$;

-- ---------------------------------------------------------------------
-- 턴 끝 처리: 생산 → 공장 → 사치품 → 행복도 → 불안 → 기록
-- ---------------------------------------------------------------------
-- 행복도 계산 (턴이 끝날 때 + 무역·점령·건설 직후 바로). 사치품은 이번 턴에 즐긴 것 + 창고에 있는 것
create or replace function priv.refresh_happy(p_c int, p_turn int default null) returns int
language plpgsql as $$
declare cfg jsonb := priv.cfg(); h jsonb := cfg->'HAPPY'; co priv.countries; g public.game; tn int; types int; own text; ownv int; nimp int; impv int; plz int; adv int; gl int; press int; ncity int; cityv int; tarv int; bore int; hung int; v int;
begin
  select * into co from priv.countries where id = p_c;
  tn := coalesce(p_turn, priv.turn());
  own := cfg->'LUX_OF'->>co.type;
  ownv := case when own = any(co.lux_used) or priv.inv(p_c, own) >= 1 then (h->>'ownLux')::int else 0 end;
  select count(*) into nimp from jsonb_array_elements_text(cfg->'LUX') x where x <> own and (x = any(co.lux_used) or priv.inv(p_c, x) >= 1);
  impv := case when co.import_cut then 0 else (h->'importLux'->>least(nimp, 3))::int end;   -- 무역로가 끊기면 수입 효과가 멈춰요
  types := nimp + case when ownv > 0 then 1 else 0 end;
  select count(*) into ncity from priv.cities where country = p_c;
  plz := (select count(*) from priv.cities where country = p_c and 'plaza' = any(buildings))::int * (h->>'perPlaza')::int;
  adv := coalesce((select sum(coalesce((cfg->'ADVANCED'->kind->>'happy')::int, 0)) from priv.advanced where country = p_c), 0)::int;
  gl := coalesce((select sum(x) from unnest(co.glory) x), 0)::int;
  press := least((h->>'pressureMax')::int, greatest(0, tn - 1) * (h->>'pressurePerTurn')::int);
  cityv := greatest(0, ncity - 1) * (h->>'perCity')::int;
  select * into g from public.game where id = 1;
  -- 17차시: 잊힌 제국의 테러 (우리 반란 도시가 남아 있는 동안) · 인터넷으로 사치품에 싫증
  tarv := case when exists(select 1 from priv.cities where rebel and type = co.type)
               then (cfg->'REBEL'->>(case when g.alliance then 'terrorWeak' else 'terror' end))::int else 0 end;
  bore := case when g.phase >= 4 then (cfg->'REBEL'->>'boredom')::int else 0 end;
  hung := case when '식량' = any(co.short) then (h->>'hunger')::int else 0 end;
  v := greatest(-100, least(100, (h->>'base')::int + ownv + impv + plz + adv + gl - press + cityv - tarv - bore + hung));
  update priv.countries set happy = v, happy_detail = jsonb_build_array(
      jsonb_build_object('k', '우리 사치품', 'v', ownv, 'tip', '우리 나라 사치품(' || priv.iname(own) || ')은 수도에서 매 턴 ' || (cfg->>'LUX_PER_TURN') || '개씩 생겨요 +' || (h->>'ownLux')),
      jsonb_build_object('k', '수입 사치품 ' || nimp || '종' || case when co.import_cut then ' (공급 끊김)' else '' end, 'v', impv,
        'tip', case when co.import_cut then '잊힌 제국의 무역로 공격으로 수입 사치품 공급이 끊겼어요. 무역 동맹 뒤 사치품을 한 번 수입하면 다시 이어져요.'
          else '다른 나라 사치품을 수입할수록 크게 올라요: 1종 +' || (h->'importLux'->>1) || ' · 2종 +' || (h->'importLux'->>2) || ' (목표!) · 3종 +' || (h->'importLux'->>3) || ' (다른 팀과도 거래하면 보너스) · 사치품은 2턴에 1개씩 써요' end),
      jsonb_build_object('k', '광장', 'v', plz, 'tip', '광장이 있는 도시마다 +' || (h->>'perPlaza')),
      jsonb_build_object('k', '특별 건물', 'v', adv, 'tip', '극장·통신탑·방송국'),
      jsonb_build_object('k', '점령 환호', 'v', gl, 'tip', '도시국가를 차지하면 +' || (h->>'glory') || ', 매 턴 ' || (h->>'gloryDecay') || '씩 줄어요'),
      jsonb_build_object('k', '인구 증가', 'v', -press, 'tip', '턴마다 사람이 늘어 물건이 더 필요해요 (턴마다 -' || (h->>'pressurePerTurn') || ', 최대 -' || (h->>'pressureMax') || ')'),
      jsonb_build_object('k', '도시 관리', 'v', cityv, 'tip', '수도 말고 도시마다 ' || (h->>'perCity')),
      jsonb_build_object('k', '잊힌 제국의 테러', 'v', -tarv, 'tip', '반란 도시를 되찾으면 사라져요 (무역 동맹을 맺으면 줄어요)'),
      jsonb_build_object('k', '사치품에 싫증', 'v', -bore, 'tip', '인터넷으로 다른 나라 물건을 보게 되어 사람들이 더 다양한 사치품을 원해요'),
      jsonb_build_object('k', '식량 부족', 'v', hung, 'tip', '식량이 모자라면 ' || (h->>'hunger')))
   where id = p_c;
  update priv.countries set lux_types = types where id = p_c;
  -- 행정 마비: 행복도가 -20보다 낮으면 모든 도시가 붉게 (병력 훈련·건물 짓기 멈춤, 생산은 그대로)
  update priv.cities set unrest = (v < (h->>'paralysis')::int) where country = p_c;
  if v < (h->>'paralysis')::int and co.happy >= (h->>'paralysis')::int then
    perform priv.notice('행정 마비! 행복도가 ' || (h->>'paralysis') || '보다 낮아져 병력 훈련과 건물 짓기가 멈췄어요. 사치품으로 행복도를 올려요.', 'alert', p_c);
  elsif v >= (h->>'paralysis')::int and co.happy < (h->>'paralysis')::int then
    perform priv.notice('행정이 다시 돌아가요! 병력 훈련과 건물 짓기를 할 수 있어요.', 'info', p_c);
  end if;
  if v < (h->>'unhappy')::int and co.happy >= (h->>'unhappy')::int then
    perform priv.notice('나라가 불행해져서 병사들이 약해졌어요! (공격력 -30%) 사치품을 구해 행복도를 0 위로 올려요.', 'alert', p_c);
  elsif v >= (h->>'unhappy')::int and co.happy < (h->>'unhappy')::int then
    perform priv.notice('행복도가 회복됐어요! 병사들이 다시 힘을 냈어요.', 'info', p_c);
  end if;
  return v;
end $$;

create or replace function priv.end_turn() returns void
language plpgsql as $$
declare
  cfg jsonb := priv.cfg(); g public.game; co record; ci record; t record; f record;
  inc jsonb; gross int; upkeep int; ncity int; food int; v int; types int; h jsonb; cr jsonb;
  n int; cost int; it text; y int; shortl text[]; recent record; mil int; usedl text[];
begin
  select * into g from public.game where id = 1;
  h := cfg->'HAPPY'; cr := h->'crisis';
  for co in select * from priv.countries order by id loop
    inc := (cfg->'INCOME') || coalesce(cfg->'PRODUCTIVITY'->co.type, '{}'::jsonb);
    select count(*) into ncity from priv.cities where country = co.id;
    -- 코인
    gross := (inc->>'capital')::int + (ncity - 1) * (inc->>'city')::int;
    for ci in select * from priv.cities where country = co.id loop
      if 'market' = any(ci.buildings) then gross := gross + (inc->>'market')::int; end if;
      if 'harbor' = any(ci.buildings) then gross := gross + (inc->>'harbor')::int; end if;
    end loop;
    gross := gross + coalesce((select sum(coalesce((cfg->'ADVANCED'->kind->>'coinPerTurn')::int, 0)) from priv.advanced where country = co.id), 0);
    if co.happy >= (h->>'golden')::int then gross := round(gross * 1.25);
    elsif co.happy < (h->>'unhappy')::int then gross := round(gross * 0.8); end if;
    mil := priv.military(co.id);
    upkeep := mil * (cfg->>'UNIT_UPKEEP')::int;
    update priv.countries set coin = coin + gross - upkeep, income = gross - upkeep where id = co.id;
    -- 식량
    food := (inc->>'capitalFood')::int - ncity * (inc->>'cityFood')::int
          - (select count(*) from priv.units where country = co.id and kind = 'worker')::int * (inc->>'workerFood')::int
          + (select count(*) from priv.cities where country = co.id and 'granary' = any(buildings))::int * 2;
    -- 개발한 칸 생산 (불안한 도시 옆 칸은 멈춤)
    for t in select tl.* from priv.tiles tl where tl.owner = co.id and tl.imp is not null loop
      if t.imp = 'farm' then food := food + case when t.terrain = 'tundra' then (cfg->>'TUNDRA_FOOD')::int else 2 end;
      elsif t.imp = 'lumber' then perform priv.add(co.id, 'wood', 2);
      elsif t.imp = 'quarry' then gross := gross + (cfg->>'QUARRY_COIN')::int; update priv.countries set coin = coin + (cfg->>'QUARRY_COIN')::int, income = income + (cfg->>'QUARRY_COIN')::int where id = co.id;
      elsif t.res is not null then
        y := (cfg->'IMPROVE'->t.imp->>'yield')::int;
        if t.res = 'oil' and g.cold_snap = co.id then y := y / 2; end if;
        perform priv.add(co.id, t.res, y);
      end if;
    end loop;
    perform priv.add(co.id, 'food', food);
    shortl := '{}';
    if priv.inv(co.id, 'food') < 0 then
      update priv.inventory set qty = 0 where country = co.id and item = 'food';
      shortl := shortl || '식량'::text;
    end if;
    -- 가공 공장 (원료 1 → 제품 1, 가공비)
    if true then
      for f in select * from priv.factories where country = co.id loop
        it := cfg->'FACTORIES'->f.kind->>'input';
        cost := (cfg->'PROC_COST'->co.type->>(cfg->'FACTORIES'->f.kind->>'output'))::int;
        select coin into v from priv.countries where id = co.id;
        -- 특산 공장은 원료 없이
        n := least((cfg->'FACTORIES'->f.kind->>'perTurn')::int,
                   case when (cfg->'FACTORY_FREE'->co.type->>f.kind)::boolean is true then 99 else priv.inv(co.id, it) end,
                   case when cost > 0 then v / cost else 99 end);
        if n > 0 then
          if (cfg->'FACTORY_FREE'->co.type->>f.kind)::boolean is not true then perform priv.add(co.id, it, -n); end if;
          perform priv.add(co.id, 'coin', -n * cost);
          perform priv.add(co.id, cfg->'FACTORIES'->f.kind->>'output', n);
        end if;
      end loop;
    end if;
    -- 우리 나라 사치품: 수도에서 매 턴 저절로
    perform priv.add(co.id, cfg->'LUX_OF'->>co.type, (cfg->>'LUX_PER_TURN')::int);
    -- 사치품은 2턴에 한 번, 종류마다 1개씩 써요 (그동안은 즐긴 것으로 쳐요)
    if g.turn % 2 = 0 then
      usedl := '{}';
      for it in select jsonb_array_elements_text(cfg->'LUX') loop
        if priv.inv(co.id, it) >= 1 then perform priv.add(co.id, it, -1); usedl := usedl || it; end if;
      end loop;
      update priv.countries set lux_used = usedl where id = co.id;
    end if;
    update priv.countries set short = shortl where id = co.id;
    -- 행복도: 다음 턴 기준으로 다시 계산 (계산식은 priv.refresh_happy 하나로)
    v := priv.refresh_happy(co.id, g.turn + 1);
    if least((h->>'pressureMax')::int, g.turn * (h->>'pressurePerTurn')::int) < (h->>'pressureMax')::int then
      perform priv.notice('인구가 늘어 물건이 더 필요해요! 인구 증가 불행 -' || least((h->>'pressureMax')::int, g.turn * (h->>'pressurePerTurn')::int) || ' (매 턴 -' || (h->>'pressurePerTurn') || '씩 커져요). 사치품을 구해요.', 'short', co.id);
    end if;
    update priv.countries set tariff_turn = 0,
      glory = array(select x - (h->>'gloryDecay')::int from unnest(glory) x where x - (h->>'gloryDecay')::int > 0)
     where id = co.id;
    if array_length(shortl, 1) > 0 then
      perform priv.notice('부족해요: ' || array_to_string(shortl, ', ') || ' → 행복도가 떨어졌어요.', 'short', co.id);
    end if;
    -- 병력 회복: 우리 땅 +20, 밖 +10
    update priv.units u set hp = least(100, hp + case when exists(select 1 from priv.tiles tt where tt.id = u.tile_id and tt.owner = co.id)
        then (cfg->'COMBAT'->>'healHome')::int else (cfg->'COMBAT'->>'healField')::int end)
     where u.country = co.id and u.hp < 100;
    insert into priv.snapshots(turn, country, data)
      select g.turn, co.id, jsonb_build_object('coin', c.coin, 'happy', c.happy, 'income', c.income, 'lux', c.lux_types,
        'cities', ncity, 'short', c.short,
        'inv', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = co.id))
      from priv.countries c where c.id = co.id
      on conflict (turn, country) do update set data = excluded.data;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 학생: 입장
-- ---------------------------------------------------------------------
create or replace function public.get_public() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'phase', g.phase, 'turn', g.turn, 'require_approval', g.require_approval,
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'name', priv.cname(c.id),
        'flag_url', c.flag_url, 'emblem_url', c.emblem_url) order by c.id), '[]') from priv.countries c))
  from public.game g where g.id = 1
$$;

create or replace function public.get_roster(p_country int) returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nick', s.nickname, 'taken', s.uid is not null) order by s.no, s.id), '[]')
  from priv.students s where s.country_id = p_country
$$;

-- 닉네임 검사: 2~8글자, 비속어 거르기 (실명 대신 닉네임으로 게임에 보여요)
create or replace function priv.check_nick(p text) returns text
language plpgsql as $$
declare n text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')); bad text; flat text;
begin
  if char_length(n) < 2 or char_length(n) > 8 then perform priv.err('NICK_LEN', '닉네임은 2~8글자로 지어요.'); end if;
  flat := lower(regexp_replace(n, '[^가-힣a-zA-Z0-9ㄱ-ㅎ]', '', 'g'));
  foreach bad in array array['시발','씨발','ㅅㅂ','ㅆㅂ','병신','ㅂㅅ','개새','새끼','ㅅㄲ','미친','ㅁㅊ','존나','ㅈㄴ','좆','썅','니미','느금','엠창','애미','애비','꺼져','닥쳐','지랄','ㅈㄹ','등신','멍청','바보','찐따','fuck','shit','bitch','sex','섹스','자살','죽어'] loop
    if position(bad in flat) > 0 then perform priv.err('NICK_BAD', '그 닉네임은 쓸 수 없어요. 친구가 기분 좋을 이름으로 지어요.'); end if;
  end loop;
  return n;
end $$;

drop function if exists public.join_student(int);
create or replace function public.join_student(p_student int, p_nick text default null) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; mine priv.students; appr boolean; nick text;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select * into mine from priv.students where uid = auth.uid();
  if found then
    if mine.id = p_student then return jsonb_build_object('status', 'joined'); end if;
    perform priv.err('DEVICE_TAKEN', '이 기기는 이미 「' || coalesce(mine.nickname, '다른 자리') || '」(으)로 연결되어 있어요. 선생님께 말해 주세요.');
  end if;
  select * into s from priv.students where id = p_student for update;
  if not found then perform priv.err('NO_STUDENT', '자리를 찾을 수 없어요.'); end if;
  if s.uid is null then
    nick := priv.check_nick(p_nick);
    if exists(select 1 from priv.students where country_id = s.country_id and nickname = nick and id <> s.id) then
      perform priv.err('NICK_DUP', '우리 나라에 같은 닉네임이 있어요. 다른 닉네임으로 지어요.'); end if;
    update priv.students set nickname = nick where id = s.id;
  end if;
  select require_approval into appr from public.game where id = 1;
  if s.uid is null and not appr then
    update priv.students set uid = auth.uid(), bound_at = now(), last_seen = now() where id = s.id;
    perform priv.bump(s.country_id);
    return jsonb_build_object('status', 'joined');
  end if;
  if s.uid is not null and not appr then
    perform priv.err('NAME_TAKEN', '이 자리는 이미 다른 기기로 들어와 있어요. 선생님께 말해 주세요.');
  end if;
  delete from priv.pairing_requests where uid = auth.uid() and status = 'pending';
  insert into priv.pairing_requests(student_id, uid) values (s.id, auth.uid());
  perform priv.bump_game();
  return jsonb_build_object('status', 'pending');
end $$;

create or replace function public.leave_student() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students;
begin
  if auth.uid() is null then return jsonb_build_object('ok', true); end if;
  select * into s from priv.students where uid = auth.uid();
  if found then update priv.students set uid = null where id = s.id; perform priv.bump(s.country_id); end if;
  delete from priv.pairing_requests where uid = auth.uid() and status = 'pending';
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_me() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; pend boolean;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'none'); end if;
  select * into s from priv.students where uid = auth.uid();
  if found then
    update priv.students set last_seen = now() where id = s.id;
    return jsonb_build_object('status', 'joined', 'student_id', s.id, 'country_id', s.country_id, 'name', coalesce(s.nickname, '이름 없음'),
      'role', s.role, 'is_leader', s.is_leader);
  end if;
  select exists(select 1 from priv.pairing_requests where uid = auth.uid() and status = 'pending') into pend;
  return jsonb_build_object('status', case when pend then 'pending' else 'none' end);
end $$;

create or replace function public.set_role(p_role text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); who text; lead text := (priv.cfg()->'ROLES'->>0);
begin
  if not (p_role = any(array(select jsonb_array_elements_text(priv.cfg()->'ROLES')))) then perform priv.err('BAD_ROLE', '없는 역할이에요.'); end if;
  if p_role = any(me.roles) then   -- 다시 누르면 내려놓기
    update priv.students set roles = array_remove(roles, p_role), is_leader = case when p_role = lead then false else is_leader end where id = me.id;
  else
    if cardinality(me.roles) >= 3 then perform priv.err('ROLE_MAX', '역할은 3개까지 맡을 수 있어요.'); end if;
    if p_role = lead then
      select coalesce(nickname, '다른') into who from priv.students where country_id = me.country_id and id <> me.id and (is_leader or lead = any(roles)) limit 1;
      if who is not null then perform priv.err('LEADER_TAKEN', who || ' 친구가 이미 국가 대표예요.'); end if;
    end if;
    update priv.students set roles = roles || p_role, is_leader = case when p_role = lead then true else is_leader end where id = me.id;
  end if;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 나라 이름·국기·문장 (국가 대표만)
create or replace function public.country_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '나라 이름과 국기는 국가 대표만 바꿀 수 있어요.'); end if;
  update priv.countries set
    name = case when p ? 'name' then left(nullif(trim(p->>'name'), ''), 16) else name end,
    flag_url = case when p ? 'flag_url' then p->>'flag_url' else flag_url end,
    emblem_url = case when p ? 'emblem_url' then p->>'emblem_url' else emblem_url end,
    updated_at = now()
   where id = me.country_id;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 학생: 화면 데이터
-- ---------------------------------------------------------------------
create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); co priv.countries; g public.game; known int[];
begin
  update priv.students set last_seen = now() where id = me.id;
  select * into co from priv.countries where id = me.country_id;
  select * into g from public.game where id = 1;
  known := case when g.diplomacy_open then array(select id from priv.countries) else co.discovered || co.id end;
  return jsonb_build_object(
    'now', now(),
    'game', jsonb_build_object('phase', g.phase, 'turn', g.turn, 'turn_end', g.turn_end, 'market_open', g.market_open,
      'diplomacy_open', g.diplomacy_open, 'crisis', g.crisis, 'fair_cap', g.fair_cap, 'tariff', g.tariff, 'tariffs', g.tariffs, 'banned', g.banned,
      'world_first', g.world_first, 'locked', g.locked, 'timer_end', g.timer_end, 'timer_label', g.timer_label, 'test_mode', g.test_mode,
      'meet_step', g.meet_step, 'normalized', g.normalized),
    'me', jsonb_build_object('id', me.id, 'name', coalesce(me.nickname, me.name), 'roles', me.roles, 'is_leader', me.is_leader),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(s.nickname, '(아직 안 들어옴)'), 'roles', s.roles, 'is_leader', s.is_leader, 'bound', s.uid is not null,
        'online', s.last_seen > now() - interval '60 seconds') order by s.no, s.id), '[]') from priv.students s where s.country_id = co.id),
    'country', jsonb_build_object('id', co.id, 'type', co.type, 'name', priv.cname(co.id), 'flag_url', co.flag_url, 'emblem_url', co.emblem_url,
      'coin', co.coin, 'happy', co.happy, 'income', co.income, 'lux_types', co.lux_types, 'short', co.short, 'techs', co.techs,
      'title', co.title, 'glory', coalesce((select sum(x) from unnest(co.glory) x), 0), 'attacked', co.attacked_turn >= g.turn,
      'ready', co.ready_turn = g.turn, 'researched', co.research_turn >= g.turn and co.research_count >= (priv.cfg()->>'RESEARCH_PER_TURN')::int, 'research_n', case when co.research_turn >= g.turn then co.research_count else 0 end, 'happy_detail', co.happy_detail, 'crisis', co.crisis, 'rebuilt', co.rebuilt, 'import_cut', co.import_cut,
      'discovered', co.discovered, 'explored_count', coalesce(array_length(co.explored, 1), 0)),
    'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = co.id and qty <> 0),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'buildings', c.buildings, 'built', c.built_turn >= g.turn and c.built_count >= (priv.cfg()->>'BUILD_PER_TURN')::int, 'built_n', case when c.built_turn >= g.turn then c.built_count else 0 end, 'trained', c.trained_turn >= g.turn and c.trained_count >= (priv.cfg()->>'TRAIN_PER_TURN')::int,
        'trained_n', case when c.trained_turn >= g.turn then c.trained_count else 0 end, 'unrest', c.unrest,
        'coastal', exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1))
        order by c.kind, c.taken_turn), '[]') from priv.cities c where c.country = co.id),
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'name', c.name, 'art', priv.city_art(c.id), 'def', greatest(1, c.def - c.def_help),
        'sea', c.sea, 'tech', c.tech, 'taken', c.country is not null, 'mine', c.type = co.type, 'owner', c.country,
        'tier', c.tier, 'hp', c.hp, 'max_hp', c.max_hp, 'bonus', c.bonus, 'tutorial', c.tutorial, 'boss', c.boss, 'final', c.final, 'rebel', c.rebel,
        'res', (select coalesce(jsonb_agg(t.res), '[]') from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.res is not null and priv.hdist(t.c, t.r, ct.c, ct.r) <= 1))
        order by c.tier, c.id), '[]') from priv.cities c where c.kind = 'cs' and (c.type = co.type or c.tile_id = any(co.explored))),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'tile', u.tile_id, 'acted', u.acted_turn >= g.turn,
        'hp', u.hp, 'attacked', u.attacked_turn >= g.turn, 'moves', priv.unit_moves_left(u), 'max_moves', priv.unit_max_moves(u)) order by u.id), '[]')
        from priv.units u where u.country = co.id),
    'strength', 0,
    'factories', (select coalesce(jsonb_agg(kind), '[]') from priv.factories where country = co.id),
    'advanced', (select coalesce(jsonb_agg(kind), '[]') from priv.advanced where country = co.id),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'title', c.title,
        'known', c.id = any(known), 'happy', case when c.id = any(known) then c.happy end, 'ready', c.ready_turn = g.turn) order by c.id), '[]') from priv.countries c),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id desc), '[]') from priv.offers o
        where (o.from_c = co.id or o.to_c = co.id) and (o.status = 'pending' or o.turn >= g.turn - 1)),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades
        where from_c = co.id or to_c = co.id order by id desc limit 60) t),
    'notices', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id desc), '[]') from (select * from public.notices
        where country is null or country = co.id order by id desc limit 30) n),
    'treaty', (select to_jsonb(t) from priv.treaties t where t.country = co.id),
    'treaties', case when g.phase >= 6 then (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t) end,
    'report', case when g.phase >= 4 then priv.crisis_report(co.id) end,
    'alliance', g.alliance,
    'experts', case when g.phase >= 6 then (select coalesce(jsonb_agg(jsonb_build_object('nick', coalesce(s.nickname, s.name), 'role', e.role, 'body', e.body, 'me', s.id = me.id) order by e.role, s.id), '[]')
      from priv.expert_notes e join priv.students s on s.id = e.student_id where e.country = co.id) end,
    'gauge', priv.gauge()
  );
end $$;

-- 지도: 우리 나라가 본 칸만. 다른 나라 땅은 국경(주인)만 보임
create or replace function public.map_view() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); co priv.countries;
begin
  select * into co from priv.countries where id = me.country_id;
  return jsonb_build_object(
    'tiles', (select coalesce(jsonb_agg(jsonb_build_array(t.id, t.terrain,
        case when t.owner is null or t.owner = co.id then t.res end, t.owner,
        case when t.owner = co.id then t.imp end) order by t.id), '[]')
      from priv.tiles t where t.id = any(co.explored)),
    -- 아직 못 본 다른 나라 국경 칸: 정찰병이 갈 수 없는 곳만 알려 줌 (가까운 곳만)
    'blocked', (select coalesce(jsonb_agg(t.id), '[]') from priv.tiles t
      where t.owner is not null and t.owner <> co.id and not (t.id = any(co.explored)) and t.terrain not in ('ocean', 'coast')
        and exists(select 1 from priv.units u, priv.tiles ut where u.country = co.id and ut.id = u.tile_id and priv.hdist(ut.c, ut.r, t.c, t.r) <= 8)),
    'cities', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'country', c.country, 'mine', c.type = co.type, 'buildings', case when c.country = co.id then c.buildings end,
        'unrest', case when c.country = co.id then c.unrest end,
        'def', case when c.kind = 'cs' and c.country is null then greatest(1, c.def - c.def_help) end,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end, 'max_hp', c.max_hp, 'tier', c.tier, 'boss', c.boss, 'final', c.final, 'tutorial', c.tutorial, 'rebel', c.rebel)), '[]')
      from priv.cities c where c.tile_id = any(co.explored))
  );
end $$;

-- ---------------------------------------------------------------------
-- 학생: 행동 (모두 나라 단위로 잠그고 검사)
-- ---------------------------------------------------------------------
-- 역할: 맡은 친구가 있으면 그 친구만, 아무도 안 맡았으면 누구나 (결석·빈 역할 대비)
create or replace function priv.need_role(me priv.students, p_role text) returns void
language plpgsql stable as $$
begin
  if p_role is null or p_role = any(me.roles) or me.is_leader then return; end if;
  perform priv.err('ROLE_ONLY', '「' || p_role || '」이(가) 하는 일이에요. 우리 나라 사람들 탭에서 역할을 확인해요.');
end $$;

drop function if exists priv.act_start(int);
create or replace function priv.act_start(need_phase int default 1, need_role text default null) returns priv.students
language plpgsql as $$
declare me priv.students := priv.me(); g public.game;
begin
  perform priv.need_role(me, need_role);
  select * into g from public.game where id = 1;
  if g.phase < need_phase or g.turn < 1 then perform priv.err('PHASE', '아직 시작 전이에요. 선생님 신호를 기다려 주세요.'); end if;
  if g.locked then perform priv.err('LOCKED', '지금은 회의 시간이라 게임 조작이 멈춰 있어요.'); end if;
  perform 1 from priv.countries where id = me.country_id for update;
  return me;
end $$;

create or replace function public.worker_build(p_tile int, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); cfg jsonb := priv.cfg(); t priv.tiles; imp jsonb; u priv.units; mult numeric := 1; tn int := priv.turn();
begin
  select * into t from priv.tiles where id = p_tile;
  if not found or t.owner is distinct from me.country_id then perform priv.err('NOT_MINE', '우리 나라 땅에만 개발할 수 있어요.'); end if;
  if t.imp is not null then perform priv.err('DONE', '이미 개발한 칸이에요.'); end if;
  if exists(select 1 from priv.cities where tile_id = p_tile) then perform priv.err('CITY', '도시가 있는 칸이에요. 도시를 눌러 건물을 지어 보세요.'); end if;
  imp := cfg->'IMPROVE'->p_kind;
  if imp is null then perform priv.err('BAD_KIND', '없는 시설이에요.'); end if;
  if imp ? 'res' then
    if t.res is null or not (imp->'res' ? t.res) then perform priv.err('NO_RES', imp->>'name' || '은(는) 알맞은 자원이 있는 칸에만 지을 수 있어요.'); end if;
  elsif not (imp->'on' ? t.terrain) then perform priv.err('BAD_TERRAIN', imp->>'name' || '은(는) 이 지형에 지을 수 없어요.');
  elsif t.res is not null and exists(select 1 from jsonb_each(cfg->'IMPROVE') x where x.value->'res' ? t.res) then
    perform priv.err('HAS_RES', '「' || (cfg->'ITEMS'->t.res->>'name') || '」이(가) 있는 칸이에요. 자원 시설(광산·농원·유정)을 지어요.'); end if;
  if imp ? 'tech' and not priv.has_tech(me.country_id, imp->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(imp->>'tech')) || '」 기술이 있어야 해요.'); end if;
  select * into u from priv.units where country = me.country_id and kind = 'worker' and acted_turn < tn order by priv.tdist(tile_id, p_tile), id limit 1;
  if not found then perform priv.err('NO_WORKER', '이번 턴에 일할 수 있는 노동자가 없어요. 노동자를 더 고용하거나 다음 턴을 기다려요.'); end if;
  if t.terrain = 'jungle' and not priv.has_tech(me.country_id, 'economics') then mult := (cfg->>'JUNGLE_MULT')::numeric; end if;
  perform priv.pay(me.country_id, imp->'cost', mult);
  update priv.tiles set imp = p_kind where id = p_tile;
  update priv.units set acted_turn = tn, tile_id = p_tile where id = u.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'unit', u.id, 'from', u.tile_id, 'to', p_tile);
end $$;

-- 잘못 지은 시설 해체 (자원이 있는 칸만): 노동자 한 명과 해체 비용이 들어요
create or replace function public.worker_demolish(p_tile int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); cfg jsonb := priv.cfg(); t priv.tiles; u priv.units; tn int := priv.turn();
begin
  select * into t from priv.tiles where id = p_tile;
  if not found or t.owner is distinct from me.country_id then perform priv.err('NOT_MINE', '우리 나라 땅이 아니에요.'); end if;
  if t.imp is null then perform priv.err('NO_IMP', '해체할 시설이 없어요.'); end if;
  if t.res is null or (cfg->'IMPROVE'->t.imp ? 'res') then perform priv.err('NO_NEED', '자원 칸에 잘못 지은 시설만 해체할 수 있어요.'); end if;
  select * into u from priv.units where country = me.country_id and kind = 'worker' and acted_turn < tn order by priv.tdist(tile_id, p_tile), id limit 1;
  if not found then perform priv.err('NO_WORKER', '이번 턴에 일할 수 있는 노동자가 없어요.'); end if;
  perform priv.pay(me.country_id, cfg->'DEMOLISH_COST');
  update priv.tiles set imp = null where id = p_tile;
  update priv.units set acted_turn = tn, tile_id = p_tile where id = u.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'unit', u.id, 'to', p_tile);
end $$;

create or replace function public.hire_worker(p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국토부 장관'); c priv.cities;
begin
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시에서만 고용할 수 있어요.'); end if;
  perform priv.pay(me.country_id, priv.cfg()->'HIRE_WORKER');
  insert into priv.units(country, kind, tile_id) values (me.country_id, 'worker', c.tile_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 행정 마비: 행복도가 너무 낮으면 병력 훈련·건물 짓기 불가
create or replace function priv.need_order(p_c int) returns void
language plpgsql stable as $$
begin
  if (select happy from priv.countries where id = p_c) < (priv.cfg()->'HAPPY'->>'paralysis')::int then
    perform priv.err('PARALYSIS', '행정 마비! 행복도가 ' || (priv.cfg()->'HAPPY'->>'paralysis') || '보다 낮아서 병력 훈련과 건물 짓기를 할 수 없어요. 사치품을 구해 행복도를 올려요.'); end if;
end $$;
-- 확장 건설(공장·발전 건물): 도시국가를 3곳 이상 차지해야 열려요 (우리 특산 공장은 처음부터)
create or replace function priv.need_expand(p_c int) returns void
language plpgsql stable as $$
begin
  if (select count(*) from priv.cities where country = p_c and kind = 'cs') < (priv.cfg()->>'EXPAND_CS')::int then
    perform priv.err('EXPAND', '확장 건설은 도시국가를 ' || (priv.cfg()->>'EXPAND_CS') || '곳 이상 차지하면 열려요.'); end if;
end $$;

create or replace function public.city_build(p_city text, p_building text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '기획부 장관'); cfg jsonb := priv.cfg(); c priv.cities; b jsonb; tn int := priv.turn();
begin
  perform priv.need_order(me.country_id);
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  b := cfg->'BUILDINGS'->p_building;
  if b is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  if p_building = any(c.buildings) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if c.built_turn >= tn and c.built_count >= (cfg->>'BUILD_PER_TURN')::int then perform priv.err('BUSY', '이 도시는 이번 턴에 건물을 ' || (cfg->>'BUILD_PER_TURN') || '개 지었어요. 다음 턴에 지어요.'); end if;
  if b ? 'tech' and not priv.has_tech(me.country_id, b->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(b->>'tech')) || '」 기술이 있어야 해요.'); end if;
  if (b->>'coastal')::boolean and not exists(select 1 from priv.tiles t, priv.tiles ct where ct.id = c.tile_id and t.terrain in ('ocean', 'coast') and priv.hdist(t.c, t.r, ct.c, ct.r) = 1) then
    perform priv.err('NOT_COAST', '바닷가 도시에만 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, b->'cost');
  update priv.cities set buildings = buildings || p_building, built_count = case when built_turn >= tn then built_count + 1 else 1 end, built_turn = tn where id = c.id;
  perform priv.refresh_happy(me.country_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.train_unit(p_city text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국방부 장관'); cfg jsonb := priv.cfg(); c priv.cities; u jsonb; tn int := priv.turn();
begin
  perform priv.need_order(me.country_id);
  select * into c from priv.cities where id = p_city and country = me.country_id;
  if not found then perform priv.err('NOT_MINE', '우리 도시가 아니에요.'); end if;
  if c.trained_turn >= tn and c.trained_count >= (cfg->>'TRAIN_PER_TURN')::int then
    perform priv.err('BUSY', '이 도시는 이번 턴에 ' || (cfg->>'TRAIN_PER_TURN') || '부대를 다 훈련했어요.'); end if;
  u := cfg->'UNITS'->p_kind;
  if u is null then perform priv.err('BAD_KIND', '없는 병력이에요.'); end if;
  if (u->>'sea')::boolean is true then
    if not ('harbor' = any(c.buildings)) then perform priv.err('NO_HARBOR', '배는 항구가 있는 도시에서 만들어요.'); end if;
  elsif not ('barracks' = any(c.buildings)) then perform priv.err('NO_BARRACKS', '병영이 있는 도시에서만 훈련할 수 있어요.'); end if;
  if u ? 'tech' and not priv.has_tech(me.country_id, u->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(u->>'tech')) || '」 기술이 있어야 해요.'); end if;
  if u ? 'needs' and not exists(select 1 from priv.advanced where country = me.country_id and kind = u->>'needs') then
    perform priv.err('LOCKED', '「' || (cfg->'ADVANCED'->(u->>'needs')->>'name') || '」을(를) 먼저 지어야 해요.'); end if;
  if u ? 'boss' and u->>'boss' <> priv.ctype(me.country_id) then perform priv.err('NOT_OURS', '다른 나라의 특수 부대예요.'); end if;
  perform priv.pay(me.country_id, u->'cost');
  insert into priv.units(country, kind, tile_id) values (me.country_id, p_kind,
    case when (u->>'sea')::boolean is true then coalesce((select t.id from priv.tiles t where t.id = any(priv.within(c.tile_id, 1)) and t.terrain in ('coast', 'ocean') order by t.id limit 1), c.tile_id)
         else c.tile_id end);
  update priv.cities set trained_count = case when trained_turn >= tn then trained_count + 1 else 1 end, trained_turn = tn where id = c.id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 병력·정찰병 이동: 화면에서 계산한 길(칸 번호 목록)을 받아 한 칸씩 검사
create or replace function priv.unit_max_moves(u priv.units) returns int
language sql stable as $$
  select case when u.kind = 'scout' then (priv.cfg()->>'SCOUT_MOVE')::int + case when priv.has_tech(u.country, 'navigation') then 2 else 0 end
              else coalesce((priv.cfg()->'UNITS'->u.kind->>'move')::int, 0) end
$$;
create or replace function priv.unit_moves_left(u priv.units) returns int
language sql stable as $$
  select case when u.attacked_turn >= priv.turn() then 0 when u.moves_turn >= priv.turn() then u.moves_left else priv.unit_max_moves(u) end
$$;

create or replace function public.unit_move(p_unit int, p_path int[]) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1); cfg jsonb := priv.cfg(); u priv.units; tn int := priv.turn();
  left_ int; prev int; step int; t priv.tiles; before int; seen int[] := '{}'; disc_before int[]; disc_after int[];
  sea boolean; water boolean; sight int; fly boolean;
begin
  select * into u from priv.units where id = p_unit and country = me.country_id for update;
  if not found or u.kind = 'worker' then perform priv.err('NO_UNIT', '움직일 수 있는 우리 병력이 아니에요.'); end if;
  perform priv.need_role(me, case when u.kind = 'scout' then cfg->'ROLE_KEY'->>'explore' else cfg->'ROLE_KEY'->>'army' end);
  left_ := priv.unit_moves_left(u);
  sea := (cfg->'UNITS'->u.kind->>'sea')::boolean is true;
  fly := (cfg->'UNITS'->u.kind->>'fly')::boolean is true;
  sight := case when u.kind = 'scout' then (cfg->>'SCOUT_SIGHT')::int else 1 end;
  if coalesce(array_length(p_path, 1), 0) = 0 then perform priv.err('NO_PATH', '갈 곳을 골라 주세요.'); end if;
  if left_ <= 0 then perform priv.err('NO_MOVES', '이번 턴에는 더 움직일 수 없어요.'); end if;
  if array_length(p_path, 1) > left_ then perform priv.err('TOO_FAR', '이번 턴에는 ' || left_ || '칸까지만 갈 수 있어요.'); end if;
  prev := u.tile_id;
  foreach step in array p_path loop
    select * into t from priv.tiles where id = step;
    if not found or priv.tdist(prev, step) <> 1 then perform priv.err('BAD_PATH', '이어지지 않는 길이에요.'); end if;
    water := t.terrain in ('ocean', 'coast');
    if u.kind <> 'scout' and not fly and sea and not water then perform priv.err('LAND', '배는 바다로만 다녀요.'); end if;
    if u.kind <> 'scout' and not fly and not sea and water then perform priv.err('WATER', '육군은 바다를 건널 수 없어요. 배가 필요해요.'); end if;
    if not water and t.owner is not null and t.owner <> me.country_id then
      perform priv.err('BORDER', '다른 나라 국경 안으로는 들어갈 수 없어요.'); end if;
    if exists(select 1 from priv.cities c where c.tile_id = step and c.country is distinct from me.country_id) then
      perform priv.err('CITY', '도시국가 안으로는 들어갈 수 없어요. 바로 옆에서 공격해요.'); end if;
    seen := seen || priv.within(step, sight);
    prev := step;
  end loop;
  select coalesce(array_length(explored, 1), 0), discovered into before, disc_before from priv.countries where id = me.country_id;
  perform priv.reveal(me.country_id, seen);
  update priv.units set tile_id = prev, moves_turn = tn, moves_left = left_ - array_length(p_path, 1) where id = u.id;
  perform priv.check_discovery();
  select discovered into disc_after from priv.countries where id = me.country_id;
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true, 'to', prev, 'left', left_ - array_length(p_path, 1),
    'new_tiles', (select coalesce(array_length(explored, 1), 0) from priv.countries where id = me.country_id) - before,
    'discovered', (select coalesce(jsonb_agg(x), '[]') from unnest(disc_after) x where not (x = any(disc_before))));
end $$;

-- 예전 이름 (정찰병)
create or replace function public.scout_move(p_unit int, p_path int[]) returns jsonb
language sql security definer set search_path = public, priv as $$ select public.unit_move(p_unit, p_path) $$;

-- 전투 미리보기 (화면과 서버가 같은 식): 피해 = 30 × 공격힘/방어력
create or replace function priv.combat(p_str int, p_hp int, p_def int, p_ranged boolean) returns int[]
language plpgsql stable as $$
declare cb jsonb := priv.cfg()->'COMBAT'; a numeric; ratio numeric; dc int; du int;
begin
  a := p_str * (0.5 + 0.5 * p_hp / 100.0);
  ratio := a / greatest(1, p_def);
  dc := greatest((cb->>'min')::int, least((cb->>'max')::int, round((cb->>'base')::int * ratio)::int));
  du := greatest(1, least(150, round((cb->>'base')::int * coalesce((cb->>'counter')::numeric, 1) / ratio)::int));
  if p_ranged then du := round(du * (cb->>'rangedCounter')::numeric)::int; end if;
  return array[dc, du];
end $$;

-- 공격: 도시국가 바로 옆(원거리 병력은 사거리 안)에서. 도시가 반격해서 우리 병력도 다쳐요
create or replace function public.unit_attack(p_unit int, p_city text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국방부 장관'); cfg jsonb := priv.cfg(); u priv.units; c priv.cities; co priv.countries;
  tn int := priv.turn(); ud jsonb; d int; rng int; ranged boolean; dmg int[]; def int; chp int; uhp int;
  captured boolean := false; died boolean := false; got text[] := '{}'; tk text; res jsonb := '[]'; bonus int := 0;
begin
  select * into co from priv.countries where id = me.country_id;
  select * into u from priv.units where id = p_unit and country = co.id for update;
  if not found or u.kind in ('worker', 'scout') then perform priv.err('NO_UNIT', '공격할 수 있는 우리 병력이 아니에요.'); end if;
  if u.attacked_turn >= tn then perform priv.err('BUSY', '이 병력은 이번 턴에 이미 공격했어요.'); end if;
  select * into c from priv.cities where id = p_city for update;
  if not found or c.kind <> 'cs' then perform priv.err('BAD_CITY', '공격할 수 있는 도시국가가 아니에요.'); end if;
  if c.country is not null then perform priv.err('TAKEN', '이미 ' || priv.cname(c.country) || '의 도시예요.'); end if;
  if c.rebel and c.type <> co.type then perform priv.err('PROTECTED', c.name || '은(는) ' || (select priv.cname(id) from priv.countries where type = c.type limit 1) || '의 반란 도시예요. 우리 나라 반란 도시를 되찾아요!'); end if;
  if c.tutorial and c.type <> co.type then perform priv.err('PROTECTED', '각 나라의 첫 도시국가는 그 나라만 차지할 수 있어요.'); end if;
  ud := cfg->'UNITS'->u.kind;
  if c.final and ud->>'boss' is distinct from c.type then
    perform priv.err('NEED_SPECIAL', c.name || '은(는) 평범한 병력으로는 꿈쩍도 하지 않아요. 「' || (cfg->'UNITS'->(cfg->'BOSS_UNIT'->c.type->>'unit')->>'name') || '」이(가) 필요해요.'); end if;
  if c.boss and not (ud ? 'boss') then
    perform priv.err('NEED_SPECIAL', c.name || '은(는) 여러 나라의 특수 부대가 힘을 합쳐야 무너뜨릴 수 있어요.'); end if;
  ranged := ud ? 'range';
  rng := coalesce((ud->>'range')::int, 1);
  d := priv.tdist(u.tile_id, c.tile_id);
  if d > rng then perform priv.err('FAR', case when ranged then '사거리 ' || rng || '칸 안까지 다가가야 해요.' else '도시국가 바로 옆 칸까지 움직여야 공격할 수 있어요.' end); end if;
  def := greatest(1, c.def - c.def_help);
  -- 나라가 불행하면 병사들이 약해져요
  dmg := priv.combat(round((ud->>'str')::int * case when co.happy < (cfg->'HAPPY'->>'unhappy')::int then (cfg->'COMBAT'->>'unhappyMult')::numeric else 1 end)::int, u.hp, def, ranged and d > 1);
  chp := greatest(0, c.hp - dmg[1]);
  uhp := u.hp - dmg[2];
  update priv.cities set hp = chp where id = c.id;
  if uhp <= 0 then
    died := true; delete from priv.units where id = u.id;
    -- 쓰러진 병력이 쓰던 물자(코인 빼고)는 창고로 돌아와요
    for tk in select key from jsonb_each(ud->'cost') where key <> 'coin' loop
      perform priv.add(co.id, tk, (ud->'cost'->>tk)::int);
    end loop;
    perform priv.notice((ud->>'name') || '이(가) ' || c.name || '의 반격에 쓰러졌어요. 쓰던 물자는 창고로 돌아왔어요.', 'alert', co.id);
  else
    update priv.units set hp = uhp, attacked_turn = tn, moves_turn = tn, moves_left = 0 where id = u.id;
  end if;
  if chp = 0 then
    captured := true;
    update priv.cities set country = co.id, taken_turn = tn, hp = max_hp where id = c.id;
    if c.rebel then   -- 잊힌 제국 격퇴: 원래 도시로
      update priv.cities set rebel = false, def = (cfg->'CS_TIERS'->c.tier->>'def')::int, max_hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int,
        hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->c.tier->>'coin')::int where id = c.id;
    end if;
    -- 주변 땅 (주인 없는 땅이면 어느 지역이든)
    update priv.tiles set owner = co.id where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
    perform priv.reveal(co.id, priv.within(c.tile_id, (cfg->>'CITY_SIGHT')::int));
    update priv.countries set glory = glory || (case when c.final then (cfg->'FINAL_CS'->>'glory')::int when c.rebel then (cfg->'REBEL'->>'glory')::int else (cfg->'HAPPY'->>'glory')::int end), coin = coin + c.bonus,
      title = case when c.final then '최종 도전 성공' else title end where id = co.id;
    perform priv.refresh_happy(co.id);
    if c.final then perform priv.notice(priv.cname(co.id) || '이(가) 무역으로 모은 자원으로 특수 부대를 만들어 최종 도전 「' || c.name || '」을(를) 무너뜨렸어요!', 'world'); end if;
    bonus := c.bonus;
    if c.tech is not null then
      foreach tk in array string_to_array(c.tech, ',') loop
        if not priv.has_tech(co.id, tk) then update priv.countries set techs = techs || tk where id = co.id; got := got || (cfg->'TECHS'->>tk); end if;
      end loop;
    end if;
    select coalesce(jsonb_agg(t.res), '[]') into res from priv.tiles t where t.id = any(priv.within(c.tile_id, 1)) and t.owner = co.id and t.res is not null;
    perform priv.check_discovery();
    perform priv.notice(c.name || '을(를) 차지했어요! 시민들이 환호합니다.' || case when bonus > 0 then ' (코인 +' || bonus || ')' else '' end, 'capture', co.id);
    if array_length(got, 1) > 0 then
      perform priv.notice(c.name || '의 기술자들이 합류해 「' || array_to_string(got, '」·「') || '」 기술을 얻었어요.', 'tech', co.id);
    end if;
    if c.boss then perform priv.notice(priv.cname(co.id) || '이(가) 최종 보스 「' || c.name || '」을(를) 무너뜨렸어요!', 'world'); end if;
    if c.rebel then
      perform priv.notice(priv.cname(co.id) || '이(가) 잊힌 제국을 몰아내고 「' || c.name || '」을(를) 되찾았어요!', 'world');
      perform priv.event('rebel_down', priv.cname(co.id) || ' 반란 도시 탈환', jsonb_build_object('country', co.id, 'city', c.id));
      perform priv.normal_done();
    end if;
    perform priv.event('capture', priv.cname(co.id) || ' → ' || c.name, jsonb_build_object('country', co.id, 'city', c.id));
  end if;
  perform priv.bump(co.id); perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'city', c.id, 'name', c.name, 'tile', c.tile_id, 'from', u.tile_id,
    'city_dmg', dmg[1], 'unit_dmg', dmg[2], 'city_hp', chp, 'max_hp', c.max_hp, 'unit_hp', greatest(0, uhp), 'ranged', ranged and d > 1,
    'captured', captured, 'died', died, 'techs', to_jsonb(got), 'coin', bonus, 'res', res);
end $$;

-- [테스트용] 최종 성장 모드: 모든 나라가 연구·개발을 끝낸 상태로 (나라마다 가장 강한 도시국가 하나만 남김) → 무역 시험
create or replace function public.test_endgame() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); g public.game; co record; c record; t record; keep text; k text; ik text; n int := 0;
begin
  select * into g from public.game where id = 1 for update;
  if not g.test_mode and not priv.is_admin() then perform priv.err('OFF', '테스트 버튼이 꺼져 있어요.'); end if;
  if g.turn < 1 then update public.game set turn = 1, phase = greatest(phase, 1) where id = 1; end if;
  for co in select * from priv.countries order by id loop
    -- 모든 기술
    update priv.countries set techs = array(select jsonb_object_keys(cfg->'TECH_TREE')), coin = coin + 300 where id = co.id;
    -- 가장 강한 도시국가 하나만 남기고 차지
    select id into keep from priv.cities where kind = 'cs' and type = co.type and country is null order by final desc, tier desc, def desc, id limit 1;
    for c in select * from priv.cities where kind = 'cs' and type = co.type and country is null and id <> keep loop
      update priv.cities set country = co.id, taken_turn = greatest(g.turn, 1), hp = max_hp where id = c.id;
      update priv.tiles set owner = co.id where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
      if c.tech is not null then
        foreach k in array string_to_array(c.tech, ',') loop
          if not priv.has_tech(co.id, k) then update priv.countries set techs = techs || k where id = co.id; end if;
        end loop;
      end if;
      n := n + 1;
    end loop;
    -- 우리 땅 모두 개발
    for t in select * from priv.tiles where owner = co.id and imp is null and id not in (select tile_id from priv.cities) loop
      ik := case
        when t.res = 'oil' then 'oilwell'
        when t.res in ('iron', 'copper', 'aluminum', 'gold', 'uranium') then 'mine'
        when t.res in ('cotton', 'spice', 'wine', 'rubber') then 'plantation'
        when t.terrain in ('plains', 'tundra', 'desert') then 'farm'
        when t.terrain in ('forest', 'jungle') then 'lumber'
        when t.terrain = 'hills' then 'quarry' end;
      if ik is not null then update priv.tiles set imp = ik where id = t.id; end if;
    end loop;
    -- 모든 도시에 기본 건물 (항구는 바닷가만)
    update priv.cities ci set buildings = array(select distinct x from unnest(ci.buildings || array['market', 'barracks', 'granary', 'plaza'] ||
        case when exists(select 1 from priv.tiles tt, priv.tiles ct where ct.id = ci.tile_id and tt.terrain in ('ocean', 'coast') and priv.hdist(tt.c, tt.r, ct.c, ct.r) = 1)
             then array['harbor'] else '{}'::text[] end) x)
     where country = co.id;
    -- 우리 나라가 만들 수 있는 공장 모두
    insert into priv.factories(country, kind)
      select co.id, f.key from jsonb_each(cfg->'FACTORIES') f where cfg->'PROC_COST'->co.type ? (f.value->>'output')
      on conflict do nothing;
  end loop;
  -- 모두 서로 발견, 세계 지도 공개, 외교·시장 열기
  update priv.countries set discovered = array(select id from priv.countries x where x.id <> priv.countries.id),
    explored = array(select id from priv.tiles) where true;
  update public.game set phase = greatest(phase, 3), market_open = true, diplomacy_open = true, crisis = true,
    world_first = coalesce(world_first, 1) where id = 1;
  perform priv.advance_turn();   -- 한 턴 정산해서 창고 채우기
  perform priv.notice('[테스트] 최종 성장 모드! 모든 나라가 연구·개발을 마쳤어요. 이제 무역으로 모자란 자원을 구해 보세요.', 'world');
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'captured', n);
end $$;

-- 기술 연구 (별빛 탐험가): 먼저 배울 기술을 다 알아야 하고, 한 턴에 하나
create or replace function public.research_tech(p_tech text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '과학기술부 장관'); cfg jsonb := priv.cfg(); t jsonb; co priv.countries; q text; tn int := priv.turn();
begin
  select * into co from priv.countries where id = me.country_id;
  t := cfg->'TECH_TREE'->p_tech;
  if t is null then perform priv.err('BAD_TECH', '없는 기술이에요.'); end if;
  if p_tech = any(co.techs) then perform priv.err('HAVE', '이미 아는 기술이에요.'); end if;
  if co.research_turn >= tn and co.research_count >= (cfg->>'RESEARCH_PER_TURN')::int then perform priv.err('BUSY', '이번 턴에는 기술을 ' || (cfg->>'RESEARCH_PER_TURN') || '개 연구했어요. 다음 턴에 또 연구해요.'); end if;
  for q in select jsonb_array_elements_text(t->'req') loop
    if not (q = any(co.techs)) then perform priv.err('NEED', '「' || (cfg->'TECHS'->>q) || '」을(를) 먼저 연구해야 해요.'); end if;
  end loop;
  perform priv.pay(co.id, t->'cost');
  update priv.countries set techs = techs || p_tech, research_count = case when research_turn >= tn then research_count + 1 else 1 end, research_turn = tn where id = co.id;
  perform priv.notice('「' || (t->>'name') || '」 연구 완료! ' || (t->>'unlock'), 'tech', co.id);
  perform priv.bump(co.id);
  return jsonb_build_object('ok', true, 'tech', p_tech);
end $$;

create or replace function public.factory_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '기획부 장관'); cfg jsonb := priv.cfg(); f jsonb; tp text;
begin
  tp := priv.ctype(me.country_id);
  f := cfg->'FACTORIES'->p_kind;
  if f is null then perform priv.err('BAD_KIND', '없는 공장이에요.'); end if;
  perform priv.need_order(me.country_id);
  if p_kind is distinct from cfg->'SPECIALTY'->tp->>'factory' then perform priv.need_expand(me.country_id); end if;
  if exists(select 1 from priv.factories where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 공장이에요.'); end if;
  if not priv.has_tech(me.country_id, f->>'tech') or (cfg->'PROC_COST'->tp->(f->>'output')) is null then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(f->>'tech')) || '」 기술이 있어야 지을 수 있어요.'); end if;
  perform priv.pay(me.country_id, coalesce(cfg->'FACTORY_BUILD'->p_kind->tp, f->'build'));
  insert into priv.factories(country, kind) values (me.country_id, p_kind);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.advanced_build(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(2, '기획부 장관'); cfg jsonb := priv.cfg(); a jsonb;
begin
  a := cfg->'ADVANCED'->p_kind;
  if a is null then perform priv.err('BAD_KIND', '없는 건물이에요.'); end if;
  perform priv.need_order(me.country_id);
  perform priv.need_expand(me.country_id);
  if exists(select 1 from priv.advanced where country = me.country_id and kind = p_kind) then perform priv.err('DONE', '이미 지은 건물이에요.'); end if;
  if a ? 'tech' and not priv.has_tech(me.country_id, a->>'tech') then
    perform priv.err('NO_TECH', '「' || (cfg->'TECHS'->>(a->>'tech')) || '」 기술이 있어야 해요.'); end if;
  perform priv.pay(me.country_id, a->'cost');
  insert into priv.advanced(country, kind) values (me.country_id, p_kind);
  perform priv.refresh_happy(me.country_id);
  perform priv.notice((a->>'name') || '을(를) 지었어요!', 'build', me.country_id);
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 무역: 제안 → 수락 (세계 시장 개방 후)
-- 한쪽은 물건, 다른 쪽은 물건 또는 코인
-- ---------------------------------------------------------------------
create or replace function priv.trade_check(seller int, item text, qty int, coin int) returns void
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg(); cap int;
begin
  select * into g from public.game where id = 1;
  if item = 'coin' then return; end if;
  if g.banned ? seller::text and (g.banned->seller::text) ? item then
    perform priv.err('BANNED', priv.cname(seller) || '은(는) 지금 ' || priv.iname(item) || ' 수출을 멈췄어요.'); end if;
  if coin is not null and g.fair_cap then
    cap := (cfg->'ITEMS'->item->>'ref')::int * (cfg->>'FAIR_CAP')::int * qty;
    if coin > cap then perform priv.err('FAIR', '지구 서버 공정 거래 규칙: ' || priv.iname(item) || ' ' || qty || '개는 ' || cap || '코인까지만 받을 수 있어요.'); end if;
  end if;
end $$;

create or replace function public.offer_create(p_to int, p_give_item text, p_give_qty int, p_get_item text, p_get_qty int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(3); g public.game; cfg jsonb := priv.cfg(); co priv.countries; id_ int;
begin
  select * into g from public.game where id = 1;
  select * into co from priv.countries where id = me.country_id;
  if not g.market_open then perform priv.err('CLOSED', '세계 시장이 아직 열리지 않았어요.'); end if;
  if p_to = me.country_id or not exists(select 1 from priv.countries where id = p_to) then perform priv.err('BAD_TO', '거래할 나라를 골라 주세요.'); end if;
  if not g.diplomacy_open and not (p_to = any(co.discovered)) then perform priv.err('UNKNOWN', '아직 발견하지 못한 나라예요.'); end if;
  if coalesce(p_give_qty, 0) <= 0 or coalesce(p_get_qty, 0) <= 0 then perform priv.err('BAD_QTY', '개수를 1 이상으로 정해 주세요.'); end if;
  if p_give_item = p_get_item then perform priv.err('SAME', '같은 물건끼리는 바꿀 수 없어요.'); end if;
  if p_give_item <> 'coin' and cfg->'ITEMS'->p_give_item is null or p_get_item <> 'coin' and cfg->'ITEMS'->p_get_item is null then
    perform priv.err('BAD_ITEM', '없는 물건이에요.'); end if;
  if p_give_item = 'coin' and p_get_item = 'coin' then perform priv.err('BAD_ITEM', '코인끼리는 바꿀 수 없어요.'); end if;
  if priv.cost_short(me.country_id, jsonb_build_object(p_give_item, p_give_qty)) is not null then
    perform priv.err('NO_MONEY', '줄 물건이 모자라요: ' || priv.cost_short(me.country_id, jsonb_build_object(p_give_item, p_give_qty))); end if;
  if priv.is_banned(me.country_id, p_give_item) then
    perform priv.fail(p_to, me.country_id, p_give_item, p_give_qty, 'ban');
    perform priv.bump(me.country_id);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', true, 'item', p_give_item, 'seller', me.country_id,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(p_give_item) || '」은(는) 지금 실어 보낼 수 없어요.');
  end if;
  if priv.is_banned(p_to, p_get_item) then
    perform priv.fail(me.country_id, p_to, p_get_item, p_get_qty, 'ban');
    perform priv.notice(priv.cname(me.country_id) || '이(가) 우리 ' || priv.iname(p_get_item) || '을(를) 사려고 했지만, 잊힌 제국의 무역로 공격 때문에 막혔어요.', 'alert', p_to);
    perform priv.bump(me.country_id); perform priv.bump(p_to);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', false, 'item', p_get_item, 'seller', p_to,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(p_get_item) || '」을(를) 실어 올 수 없어요!');
  end if;
  perform priv.trade_check(me.country_id, p_give_item, p_give_qty, case when p_get_item = 'coin' then p_get_qty end);
  perform priv.trade_check(p_to, p_get_item, p_get_qty, case when p_give_item = 'coin' then p_give_qty end);
  insert into priv.offers(turn, from_c, to_c, give_item, give_qty, get_item, get_qty, by_student)
    values (g.turn, me.country_id, p_to, p_give_item, p_give_qty, p_get_item, p_get_qty, me.id) returning id into id_;
  perform priv.notice(priv.cname(me.country_id) || '이(가) 거래를 제안했어요: ' || priv.iname(p_give_item) || ' ' || p_give_qty
    || ' ↔ ' || priv.iname(p_get_item) || ' ' || p_get_qty, 'offer', p_to);
  perform priv.bump(me.country_id); perform priv.bump(p_to);
  return jsonb_build_object('ok', true, 'id', id_, 'tariff', priv.tariff_of(p_get_item, p_get_qty));
end $$;

create or replace function public.offer_cancel(p_offer int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); o priv.offers;
begin
  update priv.offers set status = 'cancelled', decided_at = now() where id = p_offer and from_c = me.country_id and status = 'pending' returning * into o;
  if found then perform priv.bump(o.from_c); perform priv.bump(o.to_c); end if;
  return jsonb_build_object('ok', true);
end $$;

-- 관세: 관세가 붙은 물건을 수입하면 1개마다 (기준가 × 관세율, 올림) 코인을 더 내요
create or replace function priv.tariff_of(p_item text, p_qty int) returns int
language sql stable as $$
  select case when p_item <> 'coin' and g.tariffs ? p_item then ((g.tariffs->>p_item)::numeric * p_qty)::int else 0 end
  from public.game g where g.id = 1
$$;

-- 수출 제한인지 (판 나라가 그 물건 수출을 막았나)
create or replace function priv.is_banned(p_seller int, p_item text) returns boolean
language sql stable as $$
  select p_item <> 'coin' and g.banned ? p_seller::text and (g.banned->p_seller::text) ? p_item from public.game g where g.id = 1
$$;

-- 막힌 거래 기록 (피해 보고서에 그대로 씀)
create or replace function priv.fail(p_buyer int, p_seller int, p_item text, p_qty int, p_reason text) returns void
language sql as $$
  insert into priv.trade_fails(turn, phase, buyer, seller, item, qty, reason)
  select g.turn, g.phase, p_buyer, p_seller, p_item, p_qty, p_reason from public.game g where g.id = 1
$$;

-- 한 방향 기록 (판 나라 → 산 나라)
drop function if exists priv.record_trade(int, int, text, int, int, boolean);
create or replace function priv.record_trade(seller int, buyer int, item text, qty int, coin int, broker boolean default false, tar int default 0) returns int
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg(); val int;
begin
  select * into g from public.game where id = 1;
  val := coalesce(coin, (cfg->'ITEMS'->item->>'ref')::int * qty);
  insert into priv.trades(turn, phase, from_c, to_c, item, qty, price, value, tariff, broker)
    values (g.turn, g.phase, seller, buyer, item, qty, case when coin is not null then round(coin::numeric / qty) end, val, tar, broker);
  -- 무역 동맹 뒤 사치품을 수입하면 공급이 다시 이어져요
  if buyer is not null and (cfg->'LUX') ? item and g.alliance then
    update priv.countries set import_cut = false where id = buyer and import_cut;
    if found then
      perform priv.notice_d('수입 사치품 공급이 다시 이어졌어요! 무역이 돌아오자 수입 사치품 행복도가 되살아났어요.', 'market', buyer, jsonb_build_object('mode', 'resupply'));
      perform priv.event('resupply', priv.cname(buyer) || ' 사치품 공급 재개', jsonb_build_object('country', buyer));
    end if;
  end if;
  return tar;
end $$;

create or replace function public.offer_respond(p_offer int, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(3); o priv.offers; g public.game; s text; tar int := 0; tar_to int; tar_from int; bs int; bb int; bi text; bq int;
begin
  select * into g from public.game where id = 1;
  select * into o from priv.offers where id = p_offer and to_c = me.country_id for update;
  if not found then perform priv.err('NO_OFFER', '제안을 찾을 수 없어요.'); end if;
  if o.status <> 'pending' then perform priv.err('DONE', '이미 끝난 제안이에요.'); end if;
  if not p_accept then
    update priv.offers set status = 'declined', decided_at = now() where id = o.id;
    perform priv.notice(priv.cname(me.country_id) || '이(가) 거래 제안을 거절했어요.', 'offer', o.from_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  if not g.market_open then perform priv.err('CLOSED', '세계 시장이 닫혀 있어요.'); end if;
  -- 두 나라를 번호 순서로 잠금 (교착 방지)
  perform 1 from priv.countries where id in (o.from_c, o.to_c) order by id for update;
  -- 수출 제한 (제안을 보낸 뒤에 협정이 끝났을 수도 있어요)
  if priv.is_banned(o.from_c, o.give_item) or priv.is_banned(o.to_c, o.get_item) then
    if priv.is_banned(o.from_c, o.give_item) then bs := o.from_c; bb := o.to_c; bi := o.give_item; bq := o.give_qty;
    else bs := o.to_c; bb := o.from_c; bi := o.get_item; bq := o.get_qty; end if;
    perform priv.fail(bb, bs, bi, bq, 'ban');
    update priv.offers set status = 'blocked', decided_at = now() where id = o.id;
    perform priv.notice('무역로 공격! 잊힌 제국 때문에 ' || priv.iname(bi) || '을(를) 실어 나를 수 없어 거래가 막혔어요.', 'alert', o.from_c);
    perform priv.notice('무역로 공격! 잊힌 제국 때문에 ' || priv.iname(bi) || '을(를) 실어 나를 수 없어 거래가 막혔어요.', 'alert', o.to_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'ban', 'own', bs = me.country_id, 'item', bi, 'seller', bs,
      'message', '잊힌 제국이 무역선과 수송기를 공격하고 있어서 「' || priv.iname(bi) || '」을(를) 실어 나를 수 없어요!');
  end if;
  s := priv.cost_short(o.from_c, jsonb_build_object(o.give_item, o.give_qty));
  if s is not null then perform priv.err('NO_MONEY', priv.cname(o.from_c) || '의 물건이 모자라 거래할 수 없어요: ' || s); end if;
  s := priv.cost_short(o.to_c, jsonb_build_object(o.get_item, o.get_qty));
  if s is not null then perform priv.err('NO_MONEY', '우리 나라가 줄 것이 모자라요: ' || s); end if;
  perform priv.trade_check(o.from_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end);
  perform priv.trade_check(o.to_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end);
  -- 관세: 수입한 나라가 코인으로 더 내요. 코인이 모자라면 거래가 막혀요
  tar_to := priv.tariff_of(o.give_item, o.give_qty);     -- 받는 나라(o.to_c)가 냄
  tar_from := priv.tariff_of(o.get_item, o.get_qty);     -- 제안한 나라(o.from_c)가 냄
  if tar_to > 0 and priv.coin(o.to_c) < tar_to + (case when o.get_item = 'coin' then o.get_qty else 0 end) then
    perform priv.fail(o.to_c, o.from_c, o.give_item, o.give_qty, 'tariff');
    perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'tariff', 'item', o.give_item, 'tariff', tar_to,
      'message', '관세 폭탄! 관세 ' || tar_to || '코인을 낼 코인이 모자라 거래하지 못했어요.');
  end if;
  if tar_from > 0 and priv.coin(o.from_c) < tar_from + (case when o.give_item = 'coin' then o.give_qty else 0 end) then
    perform priv.fail(o.from_c, o.to_c, o.get_item, o.get_qty, 'tariff');
    update priv.offers set status = 'blocked', decided_at = now() where id = o.id;
    perform priv.notice(priv.cname(o.from_c) || '은(는) 관세 ' || tar_from || '코인을 낼 코인이 모자라 거래가 막혔어요.', 'alert', o.from_c);
    perform priv.bump(o.from_c); perform priv.bump(o.to_c);
    return jsonb_build_object('ok', false, 'blocked', 'tariff', 'item', o.get_item, 'tariff', tar_from,
      'message', priv.cname(o.from_c) || '이(가) 관세 ' || tar_from || '코인을 낼 코인이 모자라 거래하지 못했어요.');
  end if;
  perform priv.add(o.from_c, o.give_item, -o.give_qty); perform priv.add(o.to_c, o.give_item, o.give_qty);
  perform priv.add(o.to_c, o.get_item, -o.get_qty);     perform priv.add(o.from_c, o.get_item, o.get_qty);
  if tar_to > 0 then perform priv.add(o.to_c, 'coin', -tar_to); end if;
  if tar_from > 0 then perform priv.add(o.from_c, 'coin', -tar_from); end if;
  tar := tar_to + tar_from;
  if o.give_item <> 'coin' then perform priv.record_trade(o.from_c, o.to_c, o.give_item, o.give_qty, case when o.get_item = 'coin' then o.get_qty end, false, tar_to); end if;
  if o.get_item <> 'coin' then perform priv.record_trade(o.to_c, o.from_c, o.get_item, o.get_qty, case when o.give_item = 'coin' then o.give_qty end, false, tar_from); end if;
  perform priv.refresh_happy(o.from_c); perform priv.refresh_happy(o.to_c);   -- 사치품이 오면 행복도가 바로 올라요
  update priv.offers set status = 'accepted', decided_at = now() where id = o.id;
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.from_c);
  perform priv.notice('거래 성사! ' || priv.cname(o.from_c) || ' ↔ ' || priv.cname(o.to_c) || ': '
    || priv.iname(o.give_item) || ' ' || o.give_qty || ' ↔ ' || priv.iname(o.get_item) || ' ' || o.get_qty, 'trade', o.to_c);
  perform priv.bump(o.from_c); perform priv.bump(o.to_c); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'accepted', true, 'tariff', tar, 'tariff_me', case when me.country_id = o.to_c then tar_to else tar_from end);
end $$;

drop function if exists public.city_rebuild();
-- 우리 나라가 겪은 일 (실제 거래 기록으로만): 세계 무역 회의 화면에 한 줄 요약
create or replace function priv.crisis_report(p_c int) returns jsonb
language plpgsql stable as $$
declare ct int;
begin
  select min(turn) into ct from priv.events where kind = 'expire';
  return jsonb_build_object(
    'crisis_turn', ct,
    'fails', (select coalesce(jsonb_agg(jsonb_build_object('turn', f.turn, 'buyer', f.buyer, 'seller', f.seller, 'item', f.item, 'qty', f.qty, 'reason', f.reason) order by f.id), '[]')
      from priv.trade_fails f where f.buyer = p_c or f.seller = p_c),
    'tariff_paid', (select coalesce(sum(tariff), 0) from priv.trades where to_c = p_c and phase >= 5),
    'trades_before', (select count(*) from priv.trades where (from_c = p_c or to_c = p_c) and not broker and ct is not null and turn between ct - 2 and ct - 1),
    'trades_after', (select count(*) from priv.trades where (from_c = p_c or to_c = p_c) and not broker and phase between 5 and 6),
    'rebel', (select jsonb_build_object('id', c.id, 'name', c.name, 'hp', c.hp, 'max_hp', c.max_hp, 'def', c.def) from priv.cities c, priv.countries co
              where co.id = p_c and c.rebel and c.type = co.type limit 1)
  );
end $$;

-- 무역 동맹: 무역이 되살아나고 잊힌 제국이 크게 약해져요
create or replace function priv.alliance() returns void
language plpgsql as $$
declare cfg jsonb := priv.cfg(); co record;
begin
  update public.game set alliance = true, locked = false, banned = '{}'::jsonb, tariffs = '{}'::jsonb, fair_cap = true, phase = greatest(phase, 7) where id = 1;
  update priv.cities set def = (cfg->'REBEL'->>'weakDef')::int, max_hp = (cfg->'REBEL'->>'weakHp')::int, hp = least(hp, (cfg->'REBEL'->>'weakHp')::int) where rebel;
  for co in select id from priv.countries loop perform priv.refresh_happy(co.id); end loop;
  perform priv.notice('무역 동맹 체결! 여섯 나라가 함께 약속하자 잊힌 제국의 협박이 더는 통하지 않아요. 잊힌 제국의 영향력이 크게 줄고, 무역로가 다시 열렸어요 — 우리 반란 도시를 되찾아요!', 'market');
  perform priv.event('alliance', '무역 동맹 체결');
end $$;

-- 활동 2 전문가 회의: 같은 역할끼리 정한 문장 (학생마다 자기 화면에 저장 → 활동 3에서 모둠이 함께 봐요)
create or replace function public.expert_submit(p_role text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if priv.phase() < 6 then perform priv.err('PHASE', '세계 무역 회의 시간에 쓸 수 있어요.'); end if;
  if not (p_role = any(me.roles) or (me.is_leader and p_role = '국가 대표')) then perform priv.err('ROLE_ONLY', '내가 맡은 역할의 문장만 쓸 수 있어요.'); end if;
  if length(regexp_replace(coalesce(p_body, ''), '올바른 무역을 위해|[()（） .\s]', '', 'g')) < 8 then
    perform priv.err('SHORT', '괄호 안에 우리 모임이 정한 내용을 직접 써 주세요. (8글자 이상)'); end if;
  insert into priv.expert_notes(student_id, country, role, body, updated_at) values (me.id, me.country_id, p_role, left(trim(p_body), 120), now())
    on conflict (student_id) do update set role = excluded.role, body = excluded.body, updated_at = now();
  perform priv.bump(me.country_id);
  return jsonb_build_object('ok', true);
end $$;

-- 국가 정상화: 반란 도시가 모두 돌아오면 (직접 되찾거나, 시간이 없으면 선생님 버튼으로)
create or replace function priv.normal_done() returns void
language plpgsql as $$
begin
  if exists(select 1 from priv.cities where rebel) or (select normalized from public.game where id = 1) then return; end if;
  update public.game set normalized = true, video_seq = video_seq + 1 where id = 1;
  update priv.countries set import_cut = false where import_cut;   -- 무역이 정상으로: 수입 사치품 공급도 다시
  perform priv.refresh_happy(id) from priv.countries;
  perform priv.notice('국가 정상화 성공! 잊힌 제국의 영향력이 사라지고 무역이 정상으로 돌아왔어요. 축하합니다!', 'world');
  perform priv.event('normal', '국가 정상화');
end $$;

create or replace function public.admin_normalize() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); c record;
begin
  perform priv.need_admin();
  if not (select alliance from public.game where id = 1) then perform priv.alliance(); end if;
  for c in select ci.*, co.id cid from priv.cities ci join priv.countries co on co.type = ci.type where ci.rebel loop
    update priv.cities set rebel = false, country = c.cid, taken_turn = priv.turn(), def = (cfg->'CS_TIERS'->c.tier->>'def')::int,
      max_hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, hp = (cfg->'CS_TIERS'->c.tier->>'hp')::int, bonus = (cfg->'CS_TIERS'->c.tier->>'coin')::int where id = c.id;
    update priv.tiles set owner = c.cid where id = any(priv.within(c.tile_id, 1)) and owner is null and terrain not in ('ocean', 'coast');
    update priv.countries set glory = glory || (cfg->'REBEL'->>'glory')::int where id = c.cid;
  end loop;
  for c in select id from priv.countries loop perform priv.refresh_happy(c.id); end loop;
  perform priv.normal_done();
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_video() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set video_seq = video_seq + 1 where id = 1;
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- 세계 무역 회의: 모둠이 고른 무역 규칙 1개 (국가 대표가 입력). 6나라가 다 입력하면 무역 동맹!
create or replace function public.treaty_submit(p_focus text, p_problem text, p_promise text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me(); n int; ally boolean := false;
begin
  if not me.is_leader and not exists(select 1 from priv.admins where uid = auth.uid() and control = me.country_id) then perform priv.err('LEADER_ONLY', '규칙 입력은 국가 대표가 해요.'); end if;
  if priv.phase() < 6 then perform priv.err('PHASE', '세계 무역 회의 시간에 입력할 수 있어요.'); end if;
  if length(regexp_replace(coalesce(p_promise, ''), '우리가 제안한 조약은|입니다|[()（）「」 .\s]', '', 'g')) < 8 then
    perform priv.err('SHORT', '괄호 안에 우리 나라 무역 조항을 직접 써 주세요. (8글자 이상)'); end if;
  insert into priv.treaties(country, focus, problem, promise, reason, agreed, updated_at)
    values (me.country_id, p_focus, left(trim(coalesce(p_problem, '')), 120), left(trim(p_promise), 120), left(trim(coalesce(p_reason, '')), 120), '{}', now())
    on conflict (country) do update set focus = excluded.focus, problem = excluded.problem, promise = excluded.promise,
      reason = excluded.reason, updated_at = now();
  select count(*) into n from priv.treaties;
  perform priv.notice(priv.cname(me.country_id) || '이(가) 무역 조항을 등록했어요: ' || left(trim(p_promise), 70) || ' (' || n || '/6)', 'world');
  if n >= 6 and priv.phase() = 6 then perform priv.alliance(); ally := true; end if;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true, 'count', n, 'alliance', ally);
end $$;

create or replace function public.treaty_agree() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if not me.is_leader then perform priv.err('LEADER_ONLY', '공동 약속 동의는 국가 대표가 해요.'); end if;
  if priv.phase() < 6 then perform priv.err('PHASE', '조약 회의 시간에 동의할 수 있어요.'); end if;
  update priv.treaties set agreed = array(select distinct x from unnest(agreed || me.country_id) x) where true;
  perform priv.bump_all(); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.reflection_submit(p_body text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.me();
begin
  if coalesce(trim(p_body), '') = '' then perform priv.err('EMPTY', '문장을 써 주세요.'); end if;
  insert into priv.reflections(student_id, body) values (me.id, left(trim(p_body), 200))
    on conflict (student_id) do update set body = excluded.body, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 전자칠판 (전체 지도, 읽기 전용)
-- ---------------------------------------------------------------------
create or replace function public.get_board() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'now', now(),
    'game', (select jsonb_build_object('phase', phase, 'turn', turn, 'turn_end', turn_end, 'market_open', market_open,
      'diplomacy_open', diplomacy_open, 'world_first', world_first, 'timer_end', timer_end, 'timer_label', timer_label, 'banned', banned, 'tariffs', tariffs, 'alliance', alliance,
      'meet_step', meet_step, 'video_url', video_url, 'video_seq', video_seq, 'normalized', normalized) from public.game where id = 1),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'emblem_url', c.emblem_url, 'happy', c.happy, 'title', c.title,
        'cities', (select count(*) from priv.cities where country = c.id), 'discovered', coalesce(array_length(c.discovered, 1), 0),
        'exports', (select coalesce(sum(qty), 0) from priv.trades where from_c = c.id and not broker),
        'imports', (select coalesce(sum(qty), 0) from priv.trades where to_c = c.id and not broker),
        'coin', c.coin, 'military', priv.military(c.id), 'units', (select count(*) from priv.units u where u.country = c.id and u.kind not in ('worker', 'scout')),
        'rebel', exists(select 1 from priv.cities r where r.rebel and r.type = c.type), 'final_done', exists(select 1 from priv.cities f where f.final and f.type = c.type and f.country = c.id),
        'fails', (select count(*) from priv.trade_fails f where f.buyer = c.id or f.seller = c.id),
        'tariff_paid', (select coalesce(sum(tariff), 0) from priv.trades where to_c = c.id and phase >= 5)) order by c.id), '[]') from priv.countries c),
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.terrain, t.res, t.owner, t.imp) order by t.id) from priv.tiles t),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'country', c.country, 'art', priv.city_art(c.id),
        'buildings', c.buildings, 'unrest', c.unrest, 'tier', c.tier, 'boss', c.boss, 'max_hp', c.max_hp,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end)) from priv.cities c),
    'volume', (select coalesce(jsonb_agg(jsonb_build_object('turn', t, 'qty', priv.trade_volume(t)) order by t), '[]')
        from generate_series(greatest(1, (select turn from public.game where id = 1) - 12), (select turn from public.game where id = 1)) t),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from priv.events order by id desc limit 10) e),
    'treaties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t),
    'gauge', priv.gauge()
  )
$$;

-- ---------------------------------------------------------------------
-- 교사
-- ---------------------------------------------------------------------
create or replace function priv.set_admin_password(pw text) returns void
language plpgsql as $$
declare sa text := md5(random()::text || clock_timestamp()::text);
begin
  insert into priv.admin_secret(id, salt, hash) values (1, sa, encode(sha256(convert_to(sa || pw, 'UTF8')), 'hex'))
  on conflict (id) do update set salt = excluded.salt, hash = excluded.hash;
  delete from priv.admins where true;
end $$;

create or replace function public.admin_login(p_pw text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare sec priv.admin_secret; fails int;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select count(*) into fails from priv.admin_attempts where not ok and at > now() - interval '10 minutes';
  if fails >= 20 then perform priv.err('TOO_MANY', '비밀번호를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요.'); end if;
  select * into sec from priv.admin_secret where id = 1;
  if not found then perform priv.err('NO_PASSWORD', '교사 비밀번호가 아직 설정되지 않았어요.'); end if;
  if encode(sha256(convert_to(sec.salt || coalesce(p_pw, ''), 'UTF8')), 'hex') <> sec.hash then
    insert into priv.admin_attempts(uid, ok) values (auth.uid(), false);
    perform priv.err('WRONG', '비밀번호가 틀렸어요.');
  end if;
  insert into priv.admin_attempts(uid, ok) values (auth.uid(), true);
  insert into priv.admins(uid) values (auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_check() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object('admin', priv.is_admin(), 'control', (select control from priv.admins where uid = auth.uid())) $$;

-- 선생님 체험 모드: 고른 나라를 모든 역할로 직접 조작 (null이면 끄기)
create or replace function public.admin_control(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_country is not null and not exists(select 1 from priv.countries where id = p_country) then perform priv.err('BAD_COUNTRY', '없는 나라예요.'); end if;
  update priv.admins set control = p_country where uid = auth.uid();
  return jsonb_build_object('ok', true, 'control', p_country);
end $$;

-- 선생님 관전 모드 (투명한 무적 정찰병): 고른 나라의 화면 + 온 세상 지도와 모든 병력
create or replace function public.admin_observe(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare st jsonb; mv jsonb;
begin
  perform priv.need_admin();
  if not exists(select 1 from priv.countries where id = p_country) then perform priv.err('BAD_COUNTRY', '없는 나라예요.'); end if;
  perform set_config('trade.observe', p_country::text, true);
  st := public.my_state(); mv := public.map_view();
  perform set_config('trade.observe', '', true);
  return jsonb_build_object('state', st, 'map', mv, 'world', jsonb_build_object(
    'tiles', (select jsonb_agg(jsonb_build_array(t.id, t.terrain, t.res, t.owner, t.imp) order by t.id) from priv.tiles t),
    'cities', (select jsonb_agg(jsonb_build_object('id', c.id, 'tile', c.tile_id, 'kind', c.kind, 'name', c.name, 'art', priv.city_art(c.id),
        'country', c.country, 'buildings', c.buildings, 'unrest', c.unrest,
        'def', case when c.kind = 'cs' and c.country is null then greatest(1, c.def - c.def_help) end,
        'hp', case when c.kind = 'cs' and c.country is null then c.hp end, 'max_hp', c.max_hp, 'tier', c.tier, 'boss', c.boss)) from priv.cities c),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'country', u.country, 'kind', u.kind, 'tile', u.tile_id, 'hp', u.hp) order by u.id), '[]') from priv.units u),
    'countries', (select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'name', priv.cname(c.id), 'flag_url', c.flag_url,
        'happy', c.happy, 'coin', c.coin, 'discovered', coalesce(array_length(c.discovered, 1), 0)) order by c.id) from priv.countries c)));
end $$;

create or replace function public.admin_logout() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin delete from priv.admins where uid = auth.uid(); return jsonb_build_object('ok', true); end $$;

create or replace function public.admin_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1;
  return jsonb_build_object(
    'now', now(),
    'game', to_jsonb(g),
    'gauge', priv.gauge(),
    'countries', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'type_name', priv.cfg()->'TYPES'->c.type->>'name',
        'name', priv.cname(c.id), 'flag_url', c.flag_url, 'coin', c.coin, 'happy', c.happy, 'income', c.income, 'lux', c.lux_types,
        'short', c.short, 'title', c.title, 'techs', c.techs, 'discovered', coalesce(array_length(c.discovered, 1), 0),
        'cities', (select count(*) from priv.cities where country = c.id),
        'targets', (select count(*) from priv.cities where kind = 'cs' and type = c.type),
        'unrest', (select count(*) from priv.cities where country = c.id and unrest),
        'units', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from priv.units where country = c.id group by kind) u),
        'improved', (select count(*) from priv.tiles where owner = c.id and imp is not null),
        'inventory', (select coalesce(jsonb_object_agg(item, qty), '{}') from priv.inventory where country = c.id and qty <> 0),
        'factories', (select coalesce(jsonb_agg(kind), '[]') from priv.factories where country = c.id),
        'advanced', (select coalesce(jsonb_agg(kind), '[]') from priv.advanced where country = c.id),
        'exports', (select coalesce(sum(qty), 0) from priv.trades where from_c = c.id and not broker),
        'imports', (select coalesce(sum(qty), 0) from priv.trades where to_c = c.id and not broker),
        'online', (select count(*) from priv.students where country_id = c.id and last_seen > now() - interval '60 seconds'),
        'rebel', (select jsonb_build_object('name', r.name, 'hp', r.hp, 'max_hp', r.max_hp) from priv.cities r where r.rebel and r.type = c.type limit 1),
        'final', (select jsonb_build_object('id', f.id, 'name', f.name, 'hp', f.hp, 'max_hp', f.max_hp, 'taken', f.country = c.id, 'owner', f.country)
                  from priv.cities f where f.final and f.type = c.type limit 1),
        'report', case when g.phase >= 4 then priv.crisis_report(c.id) end
      ) order by c.id), '[]') from priv.countries c),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'country_id', s.country_id, 'no', s.no, 'name', s.name, 'nick', s.nickname,
        'roles', s.roles, 'is_leader', s.is_leader, 'bound', s.uid is not null, 'online', s.last_seen > now() - interval '60 seconds',
        'reflection', (select body from priv.reflections where student_id = s.id)) order by s.country_id, s.no, s.id), '[]') from priv.students s),
    'pairings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'student_id', r.student_id, 'name', s.name || coalesce(' (' || s.nickname || ')', ''), 'country_id', s.country_id,
        'created_at', r.created_at) order by r.id), '[]') from priv.pairing_requests r join priv.students s on s.id = r.student_id where r.status = 'pending'),
    'trades', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id desc), '[]') from (select * from priv.trades order by id desc limit 80) t),
    'offers_pending', (select count(*) from priv.offers where status = 'pending'),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from (select * from priv.events order by id desc limit 30) e),
    'treaties', (select coalesce(jsonb_agg(to_jsonb(t) order by t.country), '[]') from priv.treaties t),
    'experts', (select coalesce(jsonb_agg(jsonb_build_object('country', e.country, 'role', e.role, 'body', e.body, 'nick', coalesce(s.nickname, s.name)) order by e.country, e.role), '[]')
        from priv.expert_notes e join priv.students s on s.id = e.student_id),
    'volume', (select coalesce(jsonb_agg(jsonb_build_object('turn', t, 'qty', priv.trade_volume(t)) order by t), '[]')
        from generate_series(greatest(1, g.turn - 12), g.turn) t)
  );
end $$;

-- 단계 넘기기 (앞으로만)
create or replace function public.admin_set_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game; nxt int; cfg jsonb := priv.cfg(); co record; rb jsonb;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if p_target <= g.phase then perform priv.err('BACKWARD', '뒤로 가기는 「단계 강제 이동」으로만 할 수 있어요.'); end if;
  if p_target > 8 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  nxt := g.phase;
  while nxt < p_target loop
    nxt := nxt + 1;
    if nxt = 1 then
      update public.game set turn = 1, turn_end = case when auto_turn > 0 then now() + make_interval(secs => auto_turn) end where id = 1;
      perform priv.notice('나라 키우기가 시작됐어요! 노동자로 땅을 개발하고, 도시에 건물을 지어 보세요.', 'phase');
    elsif nxt = 2 then
      update public.game set crisis = true where id = 1;
      perform priv.notice('성장의 한계! 나라가 커지자 시민들이 더 다양한 물건을 원합니다. 사치품, 강철, 연료가 필요해요.', 'crisis');
      perform priv.event('crisis', '성장의 한계');
    elsif nxt = 3 then
      update public.game set market_open = true, diplomacy_open = true where id = 1;
      perform priv.notice('세계 시장이 열렸어요! 무역 탭에서 다른 나라에 거래를 제안해 보세요.', 'market');
      perform priv.event('market', '세계 시장 개방');
    elsif nxt = 4 then
      -- 잊힌 제국 등장: 각 나라가 처음 차지한 도시를 빼앗아 반란 도시로
      update public.game set phase = 4 where id = 1;   -- 행복도 계산(사치품 싫증)이 바로 반영되게
      for co in select c.*, p.id pid, (select tile_id from priv.cities where kind = 'capital' and type = c.type) cap
                from priv.cities c join priv.countries p on p.type = c.type where c.tutorial and not c.final loop
        update priv.units set tile_id = co.cap where tile_id = co.tile_id;
        update priv.cities set rebel = true, country = null, buildings = '{}', unrest = false,
          def = (cfg->'REBEL'->>'def')::int, max_hp = (cfg->'REBEL'->>'hp')::int, hp = (cfg->'REBEL'->>'hp')::int, bonus = (cfg->'REBEL'->>'coin')::int
         where id = co.id;
        perform priv.reveal(co.pid, priv.within(co.tile_id, 1));
        perform priv.notice_d('긴급속보! 잊힌 제국이 「' || co.name || '」을(를) 빼앗아 반란 도시로 만들었어요. 테러로 시민들이 불안해해요.', 'crisis', co.pid,
          jsonb_build_object('mode', 'rebel', 'city', co.name, 'tile', co.tile_id));
      end loop;
      for co in select id from priv.countries loop perform priv.refresh_happy(co.id); end loop;
      perform priv.notice('긴급속보: 잊힌 제국 등장! 여섯 나라의 첫 도시가 잊힌 제국에게 넘어갔어요. 인터넷으로 다른 나라 물건을 보게 된 시민들은 사치품에 싫증을 내기 시작했어요.', 'alert');
      perform priv.event('rebel', '잊힌 제국 등장');
    elsif nxt = 5 then
      -- 협정 만료: 잊힌 제국이 무역 규칙을 깨요 (사치품 거래 불가 · 나머지 관세 폭탄)
      update public.game set fair_cap = false,
        tariffs = (select coalesce(jsonb_object_agg(k, (cfg->'CRISIS'->>'tariffPerUnit')::int), '{}') from jsonb_object_keys(cfg->'ITEMS') k
                   where not (cfg->'LUX') ? k and not (cfg->'BANNED_STRAT') ? k),
        banned = (select coalesce(jsonb_object_agg(c.id::text, (cfg->'LUX') || (cfg->'BANNED_STRAT')), '{}') from priv.countries c)
       where id = 1;
      perform priv.notice('긴급속보: 국제 무역망 마비! 잊힌 제국이 "관세를 말도 안 되게 올리지 않으면 무역선을 공격하겠다"고 협박했어요. 겁먹은 나라들이 관세를 크게 올렸고(1개마다 +' || (cfg->'CRISIS'->>'tariffPerUnit') || '코인), 사치품과 핵심 전략 자원은 실어 나를 수 없어요. 외국 사치품 공급이 끊겨 시민들의 불만이 커지고 있어요.', 'alert');
      -- 수입 사치품 공급 중단: 창고의 물건은 그대로, 수입 행복도 효과만 멈춰요 (우리 사치품은 그대로)
      for co in select * from priv.countries order by id loop
        perform priv.notice_d('외국에서 들어오던 사치품 공급이 끊겼어요! 수입 사치품 행복도 ' ||
          coalesce((select (x->>'v')::int from jsonb_array_elements(co.happy_detail) x where x->>'k' like '수입 사치품%' limit 1), 0) || ' → 0', 'crisis', co.id,
          jsonb_build_object('mode', 'cut', 'before', coalesce((select (x->>'v')::int from jsonb_array_elements(co.happy_detail) x where x->>'k' like '수입 사치품%' limit 1), 0), 'happy', co.happy));
      end loop;
      update priv.countries set import_cut = true where true;
      update public.game set phase = 5 where id = 1;
      for co in select id from priv.countries loop perform priv.refresh_happy(co.id); end loop;
      perform priv.event('expire', '협정 만료: 잊힌 제국의 무역 파괴');
    elsif nxt = 6 then
      update public.game set locked = true where id = 1;
      perform priv.notice('세계 무역 회의 시간이에요! ① 같은 역할끼리 모이고 → ② 모둠 규칙 1개 → ③ 대표들이 세계 무역 헌장을 만들어요.', 'phase');
      perform priv.event('meeting', '세계 무역 회의');
    elsif nxt = 7 then
      perform priv.alliance();
    elsif nxt = 8 then
      update public.game set locked = true where id = 1;
      perform priv.notice('정리 시간이에요. 무역을 할 때 필요한 노력을 학습지에 적어 봅시다.', 'phase');
      perform priv.event('wrap', '정리');
    end if;
  end loop;
  update public.game set phase = p_target where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true, 'phase', p_target);
end $$;

create or replace function public.admin_force_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_target < 0 or p_target > 8 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  update public.game set phase = p_target, locked = (p_target in (6, 8)) where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

-- 다음 턴: 이번 턴 정산 후 턴 번호 +1
drop function if exists public.admin_next_turn();
-- 다음 턴 (관제실 버튼, 자동 넘김, 모든 나라 준비 완료가 같이 씀)
create or replace function priv.advance_turn() returns int
language plpgsql as $$
declare g public.game; cfg jsonb := priv.cfg();
begin
  select * into g from public.game where id = 1 for update;
  perform priv.end_turn();
  -- 도시국가 성벽 회복 (한 번에 못 무너뜨리면 다시 단단해져요)
  update priv.cities set hp = least(max_hp, hp + case when final then (cfg->'FINAL_CS'->>'heal')::int else coalesce((cfg->'CS_TIERS'->tier->>'heal')::int, 10) end)
   where kind = 'cs' and country is null and hp < max_hp and not rebel;
  if not g.alliance then update priv.cities set hp = max_hp where rebel; end if;   -- 잊힌 제국: 무역 동맹 전에는 매 턴 체력을 모두 회복
  update priv.offers set status = 'expired', decided_at = now() where status = 'pending';
  update public.game set turn = turn + 1, turn_end = case when auto_turn > 0 then now() + make_interval(secs => auto_turn) end,
    cold_snap = null where id = 1;
  perform priv.notice('턴 ' || (g.turn + 1) || ' 시작! 생산한 자원이 창고에 들어왔어요.', 'turn');
  perform priv.bump_game(); perform priv.bump_all();
  return g.turn + 1;
end $$;

create or replace function public.admin_next_turn(p_from int default null) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g public.game;
begin
  perform priv.need_admin();
  select * into g from public.game where id = 1 for update;
  if g.phase < 1 or g.turn < 1 then perform priv.err('PHASE', '먼저 1단계 「나라 키우기」를 시작해 주세요.'); end if;
  -- 자동 넘김이 두 번 겹치지 않게: 화면이 알던 턴과 다르면 그냥 둠
  if p_from is not null and p_from <> g.turn then return jsonb_build_object('ok', true, 'turn', g.turn, 'skipped', true); end if;
  return jsonb_build_object('ok', true, 'turn', priv.advance_turn());
end $$;

-- 턴 끝내기 (국가 대표): 학생이 있는 모든 나라가 누르면 바로 다음 턴. 다시 누르면 취소
create or replace function public.turn_ready() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students := priv.act_start(1, '국가 대표'); tn int := priv.turn(); waiting int; nt int;
begin
  update priv.countries set ready_turn = case when ready_turn = tn then 0 else tn end where id = me.country_id;
  select count(*) into waiting from priv.countries c
   where c.ready_turn <> tn and (exists(select 1 from priv.students s where s.country_id = c.id and s.uid is not null)
                                or exists(select 1 from priv.admins a where a.control = c.id));
  perform priv.bump_all();
  if waiting = 0 then
    nt := priv.advance_turn();
    return jsonb_build_object('ok', true, 'next', true, 'turn', nt);
  end if;
  return jsonb_build_object('ok', true, 'next', false, 'waiting', waiting,
    'ready', (select ready_turn = tn from priv.countries where id = me.country_id));
end $$;

create or replace function public.admin_auto_turn(p_seconds int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set auto_turn = greatest(0, coalesce(p_seconds, 0)),
    turn_end = case when coalesce(p_seconds, 0) > 0 and turn >= 1 then now() + make_interval(secs => p_seconds) end where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_timer(p_seconds int, p_label text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set timer_end = case when coalesce(p_seconds, 0) > 0 then now() + make_interval(secs => p_seconds) end,
    timer_label = case when coalesce(p_seconds, 0) > 0 then nullif(trim(coalesce(p_label, '')), '') end where id = 1;
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_flags(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set require_approval = coalesce((p->>'require_approval')::boolean, require_approval),
    test_mode = coalesce((p->>'test_mode')::boolean, test_mode),
    meet_step = coalesce((p->>'meet_step')::int, meet_step),
    video_url = case when p ? 'video_url' then nullif(trim(p->>'video_url'), '') else video_url end where id = 1;
  perform priv.bump_all();
  perform priv.bump_game();
  return (select to_jsonb(g) from public.game g where id = 1);
end $$;

-- 모둠 번호 ↔ 나라 유형 (건국 단계에서만)
create or replace function public.admin_set_type(p_country int, p_type text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare other int; old text;
begin
  perform priv.need_admin();
  if priv.phase() > 0 then perform priv.err('PHASE', '나라 유형은 건국 단계에서만 바꿀 수 있어요.'); end if;
  if priv.cfg()->'TYPES'->p_type is null then perform priv.err('BAD_TYPE', '없는 유형이에요.'); end if;
  select type into old from priv.countries where id = p_country;
  select id into other from priv.countries where type = p_type;
  update priv.countries set type = '_' where id = p_country;
  if other is not null then update priv.countries set type = old where id = other; end if;
  update priv.countries set type = p_type where id = p_country;
  perform priv.init_world();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_roster_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare n int;
begin
  perform priv.need_admin();
  delete from priv.pairing_requests where true;
  delete from priv.reflections where true;
  delete from priv.students where true;
  insert into priv.students(country_id, no, name)
    select (r->>'group')::int, nullif(r->>'no', '')::int, trim(r->>'name')
    from jsonb_array_elements(p_rows) r
    where coalesce(trim(r->>'name'), '') <> '' and (r->>'group')::int between 1 and 6;
  get diagnostics n = row_count;
  perform priv.bump_game();
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.admin_set_leader(p_student int, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c int;
begin
  perform priv.need_admin();
  select country_id into c from priv.students where id = p_student;
  if p_on then   -- 국가 대표는 한 나라에 한 명
    update priv.students set is_leader = false, roles = array_remove(roles, priv.cfg()->'ROLES'->>0) where country_id = c and id <> p_student;
    update priv.students set is_leader = true, roles = case when (priv.cfg()->'ROLES'->>0) = any(roles) then roles else (priv.cfg()->'ROLES'->>0) || roles end where id = p_student;
  else
    update priv.students set is_leader = false, roles = array_remove(roles, priv.cfg()->'ROLES'->>0) where id = p_student;
  end if;
  perform priv.bump(c);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_binding(p_student int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c int;
begin
  perform priv.need_admin();
  update priv.students set uid = null, bound_at = null where id = p_student returning country_id into c;
  perform priv.bump(c); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_approve(p_request int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r priv.pairing_requests; c int;
begin
  perform priv.need_admin();
  select * into r from priv.pairing_requests where id = p_request and status = 'pending' for update;
  if not found then perform priv.err('NO_REQUEST', '요청을 찾을 수 없어요.'); end if;
  update priv.students set uid = null where uid = r.uid and id <> r.student_id;
  update priv.students set uid = r.uid, bound_at = now() where id = r.student_id returning country_id into c;
  update priv.pairing_requests set status = case when id = p_request then 'approved' else 'replaced' end
    where status = 'pending' and (id = p_request or student_id = r.student_id or uid = r.uid);
  perform priv.bump(c); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_approve_group(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r record; n int := 0; skipped int := 0;
begin
  perform priv.need_admin();
  for r in
    select max(q.id) as id, q.student_id, count(*) as cnt
    from priv.pairing_requests q join priv.students s on s.id = q.student_id
    where q.status = 'pending' and (p_country is null or s.country_id = p_country)
    group by q.student_id
  loop
    if r.cnt > 1 then skipped := skipped + 1; else perform public.admin_approve(r.id); n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'approved', n, 'skipped', skipped);
end $$;

create or replace function public.admin_reject(p_request int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.pairing_requests set status = 'rejected' where id = p_request and status = 'pending';
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- 지원: 코인·물건 (p_country null이면 모든 나라)
create or replace function public.admin_grant(p_country int, p_items jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c record; k text; v text;
begin
  perform priv.need_admin();
  for c in select id from priv.countries where p_country is null or id = p_country loop
    for k, v in select key, value from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) loop
      perform priv.add(c.id, k, v::int);
    end loop;
    perform priv.refresh_happy(c.id);
    perform priv.notice_d('지구 서버 관리자의 지원: ' || priv.items_text(p_items) || coalesce(' (' || nullif(trim(p_reason), '') || ')', ''), 'grant', c.id,
      jsonb_build_object('mode', 'grant', 'items', p_items, 'reason', nullif(trim(p_reason), '')));
    perform priv.bump(c.id);
  end loop;
  perform priv.event('grant', coalesce(p_reason, ''), jsonb_build_object('country', p_country, 'items', p_items));
  return jsonb_build_object('ok', true);
end $$;

-- 긴급 중립 상인: 거래가 막혔을 때만. 기준가의 2배 코인을 받고 팔아요
create or replace function public.admin_merchant(p_country int, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); k text; v text; total int := 0; unit int;
begin
  perform priv.need_admin();
  for k, v in select key, value from jsonb_each_text(coalesce(p_items, '{}'::jsonb)) loop
    if k = 'coin' or cfg->'ITEMS'->k is null or v::int <= 0 then perform priv.err('BAD_ITEM', '팔 수 없는 물건이에요.'); end if;
    total := total + ceil((cfg->'ITEMS'->k->>'ref')::numeric * (cfg->'CRISIS'->>'merchantMult')::numeric)::int * v::int;
  end loop;
  if total = 0 then perform priv.err('BAD_ITEM', '물건을 골라 주세요.'); end if;
  if priv.coin(p_country) < total then perform priv.err('NO_MONEY', priv.cname(p_country) || '의 코인이 모자라요 (필요 ' || total || ', 있음 ' || priv.coin(p_country) || ')'); end if;
  for k, v in select key, value from jsonb_each_text(p_items) loop
    unit := ceil((cfg->'ITEMS'->k->>'ref')::numeric * (cfg->'CRISIS'->>'merchantMult')::numeric)::int;
    perform priv.add(p_country, k, v::int);
    perform priv.record_trade(null, p_country, k, v::int, unit * v::int, true);
  end loop;
  perform priv.add(p_country, 'coin', -total);
  perform priv.refresh_happy(p_country);
  perform priv.notice_d('긴급 중립 상인이 물건을 팔았어요: ' || priv.items_text(p_items) || ' (코인 -' || total || ')', 'grant', p_country,
    jsonb_build_object('mode', 'merchant', 'items', p_items, 'coin', total));
  perform priv.event('merchant', priv.cname(p_country) || ' 긴급 중립 상인', jsonb_build_object('country', p_country, 'items', p_items, 'coin', total));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true, 'coin', total);
end $$;

-- 특수 부대 지원 (17차시 정복 준비): 최종 도시국가에서 2칸 떨어진 곳에 그 나라 특수 부대 1대
create or replace function public.admin_boss_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare cfg jsonb := priv.cfg(); tp text := priv.ctype(p_country); uk text; f priv.cities; tl int;
begin
  perform priv.need_admin();
  uk := cfg->'BOSS_UNIT'->tp->>'unit';
  select * into f from priv.cities where final and type = tp limit 1;
  if not found then perform priv.err('NO_FINAL', '이 나라의 최종 도시국가가 없어요.'); end if;
  if f.country is not null then perform priv.err('TAKEN', '이미 최종 도시국가를 차지했어요.'); end if;
  select t.id into tl from priv.tiles t, priv.tiles ft where ft.id = f.tile_id and priv.hdist(t.c, t.r, ft.c, ft.r) = 2
   order by (t.terrain in ('ocean', 'coast')), (t.owner is not distinct from p_country) desc, t.id limit 1;
  insert into priv.units(country, kind, tile_id) values (p_country, uk, tl);
  perform priv.reveal(p_country, priv.within(tl, 2));
  perform priv.notice_d('지구 서버 관리자의 지원: 「' || (cfg->'UNITS'->uk->>'name') || '」이(가) ' || f.name || ' 근처에 도착했어요!', 'grant', p_country,
    jsonb_build_object('mode', 'boss', 'unit', uk, 'city', f.name));
  perform priv.event('boss_help', priv.cname(p_country) || ' 특수 부대 지원', jsonb_build_object('country', p_country));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true, 'tile', tl);
end $$;

-- 불안 진정: 행복도 +15 (점령 환호처럼 3턴에 걸쳐 줄어듦), 불안 도시 회복
create or replace function public.admin_relief(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.countries set glory = glory || 15, happy = least(100, happy + 15) where id = p_country;
  update priv.cities set unrest = false where country = p_country;
  perform priv.notice('지구 서버 관리자가 축제를 열어 시민들의 마음을 달랬어요. (행복도 +15)', 'grant', p_country);
  perform priv.event('relief', priv.cname(p_country), jsonb_build_object('country', p_country));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

-- 턴 지원: 다음 도시국가 방어력 -5, 코인 +40
create or replace function public.admin_turn_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare tp text := priv.ctype(p_country); nxt text;
begin
  perform priv.need_admin();
  select id into nxt from priv.cities where kind = 'cs' and type = tp and country is null order by def limit 1;
  if nxt is not null then update priv.cities set def_help = def_help + 5 where id = nxt; end if;
  update priv.countries set coin = coin + 40 where id = p_country;
  perform priv.notice('지구 서버 관리자 지원: 코인 40과 함께, 다음 도시국가의 성벽이 약해졌다는 소식이 들어왔어요.', 'grant', p_country);
  perform priv.event('turn_help', priv.cname(p_country), jsonb_build_object('country', p_country, 'city', nxt));
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

-- 탐험 지원: 바다(해안·바다) 칸 지도 공유. 발견은 정찰병이 직접 해야 함
create or replace function public.admin_explore_help(p_country int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare c record;
begin
  perform priv.need_admin();
  for c in select id from priv.countries where p_country is null or id = p_country loop
    perform priv.reveal(c.id, array(select id from priv.tiles where terrain in ('ocean', 'coast')));
    perform priv.notice('탐험대에 새 지도 정보가 전해졌어요. 바닷길이 모두 보여요!', 'grant', c.id);
    perform priv.bump(c.id);
  end loop;
  perform priv.check_discovery();
  perform priv.event('explore_help', '탐험 지원', jsonb_build_object('country', p_country));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_open_diplomacy() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set diplomacy_open = true where id = 1;
  perform priv.notice('지구 서버 관리자가 세계 지도를 전했어요. 외교 창에서 여섯 나라를 볼 수 있어요.', 'world');
  perform priv.event('diplomacy', '교사가 외교 열기');
  perform priv.bump_game(); perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

-- 중립 상인 보조 거래: p_qty > 0 이면 나라에 팔기(나라가 받음), < 0 이면 나라에서 사기
create or replace function public.admin_broker_trade(p_country int, p_item text, p_qty int, p_coin int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s text;
begin
  perform priv.need_admin();
  if p_qty > 0 then
    s := priv.cost_short(p_country, jsonb_build_object('coin', p_coin));
    if s is not null then perform priv.err('NO_MONEY', s); end if;
    perform priv.add(p_country, 'coin', -p_coin); perform priv.add(p_country, p_item, p_qty);
    perform priv.record_trade(null, p_country, p_item, p_qty, p_coin, true);
  else
    s := priv.cost_short(p_country, jsonb_build_object(p_item, -p_qty));
    if s is not null then perform priv.err('NO_MONEY', s); end if;
    perform priv.add(p_country, p_item, p_qty); perform priv.add(p_country, 'coin', p_coin);
    perform priv.record_trade(p_country, null, p_item, -p_qty, p_coin, true);
  end if;
  perform priv.notice('중립 상인과 거래했어요: ' || priv.iname(p_item) || ' ' || abs(p_qty) || '개', 'trade', p_country);
  perform priv.bump(p_country);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_notice(p_message text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  perform priv.notice(p_message, 'teacher');
  perform priv.bump_all();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_game(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  if p_confirm <> '초기화' then perform priv.err('CONFIRM', '「초기화」라고 입력해야 해요.'); end if;
  perform priv.init_world();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_export() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  return jsonb_build_object(
    'exported_at', now(),
    'game', (select to_jsonb(g) from public.game g),
    'countries', (select jsonb_agg(to_jsonb(x)) from priv.countries x),
    'students', (select jsonb_agg(to_jsonb(x) - 'uid') from priv.students x),
    'cities', (select jsonb_agg(to_jsonb(x)) from priv.cities x),
    'tiles', (select jsonb_agg(jsonb_build_array(id, owner, imp)) from priv.tiles where owner is not null),
    'units', (select jsonb_agg(to_jsonb(x)) from priv.units x),
    'inventory', (select jsonb_agg(to_jsonb(x)) from priv.inventory x),
    'factories', (select jsonb_agg(to_jsonb(x)) from priv.factories x),
    'advanced', (select jsonb_agg(to_jsonb(x)) from priv.advanced x),
    'offers', (select jsonb_agg(to_jsonb(x)) from priv.offers x),
    'trades', (select jsonb_agg(to_jsonb(x)) from priv.trades x),
    'events', (select jsonb_agg(to_jsonb(x)) from priv.events x),
    'treaties', (select jsonb_agg(to_jsonb(x)) from priv.treaties x),
    'reflections', (select jsonb_agg(to_jsonb(x)) from priv.reflections x),
    'snapshots', (select jsonb_agg(to_jsonb(x)) from priv.snapshots x));
end $$;

-- 처음 설치할 때 게임판 준비 (이미 시작한 게임은 건드리지 않음)
do $$ begin
  -- 아직 시작 전(0단계, 0턴)이면 새 지도·규칙으로 다시 준비 (명단·나라 이름·국기는 그대로)
  if (select phase = 0 and turn = 0 from public.game where id = 1) then
    perform priv.init_world();
  end if;
end $$;

-- =====================================================================
-- 권한: 화면에서는 public 함수만 호출 가능
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'priv' loop
    execute 'revoke all on function ' || f.sig || ' from public';
  end loop;
  begin execute 'revoke all on all tables in schema priv from anon, authenticated'; exception when others then null; end;
  begin execute 'grant select on public.game, public.notices, public.country_ticks to anon, authenticated'; exception when others then null; end;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef loop
    begin execute 'grant execute on function ' || f.sig || ' to anon, authenticated'; exception when others then null; end;
  end loop;
end $$;

-- 이미지 저장소 (국기·문장)
do $$ begin
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('images', 'images', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do nothing;
  execute 'drop policy if exists es_images_insert on storage.objects';
  execute $p$create policy es_images_insert on storage.objects for insert to authenticated with check (bucket_id = 'images')$p$;
  execute 'drop policy if exists es_images_read on storage.objects';
  execute $p$create policy es_images_read on storage.objects for select using (bucket_id = 'images')$p$;
exception when others then
  raise notice 'storage 설정 건너뜀: %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
