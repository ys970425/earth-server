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
