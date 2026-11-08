-- 전쟁 데이터는 무역 표와 독립적으로 보관한다.
create schema if not exists war;
revoke all on schema war from public;

create table if not exists war.game (
  id int primary key default 1 check (id = 1),
  turn int not null default 0,
  war_enabled boolean not null default false,
  imported_at timestamptz not null default now()
);
create table if not exists war.countries (
  id int primary key, type text not null, name text, flag_url text, emblem_url text,
  coin int not null, happy int not null, techs text[] not null,
  discovered int[] not null, explored int[] not null
);
create table if not exists war.inventory (
  country int not null, item text not null, qty int not null,
  primary key (country, item)
);
create table if not exists war.tiles (
  id int primary key, c int not null, r int not null, zone text,
  terrain text not null, res text, owner int, imp text
);
create table if not exists war.cities (
  id text primary key, tile_id int not null, kind text not null, type text not null,
  name text not null, def int not null, sea boolean not null, tech text, country int,
  buildings text[] not null, tier int not null, hp int not null, max_hp int not null,
  boss boolean not null default false, final boolean not null default false,
  rebel boolean not null default false
);
create table if not exists war.units (
  id int primary key, country int not null, kind text not null,
  tile_id int, hp int not null default 100,
  acted_turn int not null default -1, moves_turn int not null default -1,
  moves_left int not null default 0, attacked_turn int not null default -1
);
create table if not exists war.factories (
  country int not null, kind text not null, primary key (country, kind)
);
create table if not exists war.advanced (
  country int not null, kind text not null, primary key (country, kind)
);
revoke all on all tables in schema war from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema war from %I', role_name);
      execute format('revoke all on all tables in schema war from %I', role_name);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- E1 (H1): 역할·지갑·도시 시설·외교·시장·바뀜 번호 표
-- ---------------------------------------------------------------------
alter table war.game add column if not exists turn_seconds int not null default 180;
alter table war.game add column if not exists turn_end timestamptz;
alter table war.game add column if not exists paused boolean not null default false;
alter table war.game add column if not exists combat_on boolean not null default true;

-- 역할: 학생 한 명이 하나. 한 나라에서 한 역할은 한 명 (결석 대행은 합동참모의장, 설계 2장)
create table if not exists war.roles (
  student int primary key,
  country int not null,
  role    text not null,
  absent  boolean not null default false,
  unique (country, role)
);
-- 지갑: 공병사령관·참모총장 각자의 예산. 국고는 war.countries.coin + war.inventory (설계 2장)
create table if not exists war.wallets (
  country int not null,
  role    text not null,
  item    text not null,
  qty     int not null default 0,
  primary key (country, role, item)
);
-- 도시에 배치된 공장·고등 건물 (설계 3-2). 원래 나라: 특산 공장 수리 확인용
create table if not exists war.city_facilities (
  city           text not null,
  kind           text not null,
  class          text not null,          -- factory | advanced
  ruined         boolean not null default false,
  origin_country int,
  primary key (city, kind)
);
alter table war.tiles add column if not exists imp_ruined boolean not null default false;
-- 지도 바뀜 번호 (E2 규칙): 칸을 바꾸는 함수는 war.bump('map')을 부른 뒤, 바꾼 칸의 ver을 새 map 번호로 맞춘다.
-- (지금은 칸을 바꾸는 함수가 없고, 가져오기는 모든 칸 ver = 0)
alter table war.tiles add column if not exists ver int not null default 0;
alter table war.units add column if not exists commander text;   -- army | navy | air | engineer
alter table war.cities add column if not exists besieged boolean not null default false;
alter table war.countries add column if not exists shield_until int not null default 0;
alter table war.countries add column if not exists cities_lost int not null default 0;

-- 외교: 나라 쌍 (a < b). peace | war | ally
create table if not exists war.diplomacy (
  a            int not null,
  b            int not null,
  status       text not null default 'peace',
  changed_turn int not null default 0,
  no_war_until int not null default 0,
  primary key (a, b),
  check (a < b)
);
-- 제안: 동맹(ally)·평화(peace)·무역(trade)
create table if not exists war.offers (
  id     bigserial primary key,
  kind   text not null,
  from_c int not null,
  to_c   int not null,
  data   jsonb not null default '{}',
  status text not null default 'pending',
  turn   int not null
);
-- 도시국가 물물교환 시장 3곳 (설계 7장)
create table if not exists war.markets (
  id      int primary key check (id between 1 and 3),
  tile_id int not null,
  art     text not null,
  name    text not null
);
create table if not exists war.market_stock (
  market int not null,
  item   text not null,
  qty    int not null default 0,
  primary key (market, item)
);
-- 영역별 바뀜 번호 (화면이 「바뀐 것이 있는지」 묻을 때 씀, 설계 1-3). 번호를 올리는 함수는 별도 단계에서 만듦
create table if not exists war.versions (
  area    text not null,
  country int not null default 0,
  ver     bigint not null default 0,
  primary key (area, country)
);
-- 병과 최소 지급 결과 (설계 3-3, 관제실 지급 결과 표)
create table if not exists war.grants (
  country int not null,
  branch  text not null,
  kind    text not null,
  unit_id int,
  result  text not null,                 -- given | skipped
  reason  text,
  primary key (country, branch)
);

revoke all on war.roles, war.wallets, war.city_facilities, war.diplomacy, war.offers,
  war.markets, war.market_stock, war.versions, war.grants from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on war.roles, war.wallets, war.city_facilities, war.diplomacy, war.offers,
        war.markets, war.market_stock, war.versions, war.grants from %I', role_name);
    end if;
  end loop;
end $$;

-- 한 칸에 군사 유닛 하나, 민간 유닛(노동자·정찰병) 하나 (설계 4-4). 동시에 들어오면 늦은 쪽이 막힘
create unique index if not exists war_units_one_military on war.units (tile_id)
  where tile_id is not null and kind not in ('worker', 'scout');
create unique index if not exists war_units_one_civil on war.units (tile_id)
  where tile_id is not null and kind in ('worker', 'scout');

-- 미션 완료 기록 (2026-11-08 결정: 학생별로 서버에 기록). 가져올 때 비운다
create table if not exists war.mission_done (
  student int not null,
  mission text not null,
  done_at timestamptz not null default now(),
  primary key (student, mission)
);
revoke all on war.mission_done from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on war.mission_done from %I', role_name);
    end if;
  end loop;
end $$;