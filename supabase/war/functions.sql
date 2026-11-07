create or replace function war.admin_import(p_confirm text) returns jsonb
language plpgsql security definer set search_path = war, priv, public as $$
declare
  cfg jsonb;
  u record;
  destination int;
  moved int := 0;
  converted int;
begin
  perform priv.need_admin();
  if p_confirm is distinct from '초기화' then
    raise exception '「초기화」라고 입력해야 가져와요';
  end if;
  -- 같은 표를 동시에 초기화하는 요청도 순서대로 처리한다.
  lock table war.game in exclusive mode;
  cfg := priv.cfg();
  truncate war.game, war.countries, war.inventory, war.tiles, war.cities,
    war.units, war.factories, war.advanced;
  insert into war.game(id, turn, imported_at)
    select id, turn, now() from public.game;
  insert into war.countries
    select id, type, name, flag_url, emblem_url, coin, happy, techs, discovered, explored
    from priv.countries;
  insert into war.inventory select country, item, qty from priv.inventory;
  insert into war.tiles select id, c, r, zone, terrain, res, owner, imp from priv.tiles;
  insert into war.cities
    select id, tile_id, kind, type, name, def, sea, tech, country, buildings,
      tier, hp, max_hp, boss, final, rebel
    from priv.cities where not rebel and (not (boss or final) or country is not null);
  update war.cities set tier = least(tier, 4), boss = false, final = false,
    def = (cfg->'CS_TIERS'->least(tier, 4)->>'def')::int,
    max_hp = (cfg->'CS_TIERS'->least(tier, 4)->>'hp')::int,
    hp = (cfg->'CS_TIERS'->least(tier, 4)->>'hp')::int
    where boss or final;
  get diagnostics converted = row_count;
  insert into war.factories select country, kind from priv.factories;
  insert into war.advanced select country, kind from priv.advanced;
  insert into war.units(id, country, kind, tile_id, hp)
    select id, country, kind, tile_id, 100 from priv.units;

  -- 원래 칸의 첫 유닛을 먼저 예약하고, 이동할 유닛의 자리를 모두 비운다.
  with ranked as (
    select id, row_number() over (
      partition by tile_id, (kind in ('worker', 'scout')) order by id) as n
    from war.units
  )
  update war.units w set tile_id = null
  from ranked x, war.tiles t
  where w.id = x.id and t.id = w.tile_id and (
    x.n > 1 or
    case when coalesce((cfg->'UNITS'->w.kind->>'sea')::boolean, false)
      then t.terrain not in ('ocean', 'coast')
      else t.terrain in ('ocean', 'coast', 'mountain') or exists (
        select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from w.country)
    end);
  for u in select w.*, s.tile_id as origin from war.units w
    join priv.units s on s.id = w.id where w.tile_id is null order by w.id loop
    select t.id into destination from war.tiles t
    where case when coalesce((cfg->'UNITS'->u.kind->>'sea')::boolean, false)
      then t.terrain in ('ocean', 'coast')
      else t.terrain not in ('ocean', 'coast', 'mountain') and not exists (
        select 1 from war.cities c where c.tile_id = t.id and c.country is distinct from u.country)
      end
      and not exists (select 1 from war.units occupied where occupied.tile_id = t.id
        and (occupied.kind in ('worker', 'scout')) = (u.kind in ('worker', 'scout')))
    order by priv.tdist(u.origin, t.id),
      case when t.owner = u.country then 0 else 1 end, t.id limit 1;
    if destination is null then
      raise exception '병력을 놓을 빈 칸이 없어요 (유닛 %)', u.id;
    end if;
    update war.units set tile_id = destination where id = u.id;
    moved := moved + 1;
  end loop;
  return jsonb_build_object(
    'countries', (select count(*) from war.countries),
    'tiles', (select count(*) from war.tiles),
    'cities', (select count(*) from war.cities),
    'units', (select count(*) from war.units),
    'moved_units', moved, 'converted_cities', converted);
end $$;
revoke all on function war.admin_import(text) from public;

create or replace function public.war_admin_import(p_confirm text) returns jsonb
language sql security definer set search_path = war, priv, public as $$
  select war.admin_import(p_confirm)
$$;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function public.war_admin_import(text) to %I', role_name);
    end if;
  end loop;
end $$;
