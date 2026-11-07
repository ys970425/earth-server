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
