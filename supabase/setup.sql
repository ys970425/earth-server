-- =====================================================================
-- 지구 서버: 신발 기업 경영 시뮬레이터 — Supabase 설치 스크립트
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 데이터는 지워지지 않고 함수만 최신으로 바뀝니다.
-- =====================================================================

create schema if not exists priv;
revoke all on schema priv from public;

-- ---------------------------------------------------------------------
-- 1. 설정값 (게임 숫자)
-- ---------------------------------------------------------------------
create table if not exists priv.settings (
  key   text primary key,
  value numeric not null,
  note  text
);

insert into priv.settings(key, value, note) values
  ('initial_wallet',   600, '기업 초기 자본'),
  ('vote_income',      100, '1표당 판매 수입'),
  ('env_mult',          15, '환경점수 환산 배율'),
  ('grant_env',        500, '7단계 환경 전환 지원금'),
  ('eco_cap',          250, '친환경 소비 보너스 기업당 상한'),
  ('star1_bonus',       30, '★ 신발 1표당 구매자 기업 보너스'),
  ('star2_bonus',       50, '★★ 신발 1표당 구매자 기업 보너스'),
  ('gauge_coef',      0.07, '지구 게이지 = 100 + 계수 × 전체 환경점수'),
  ('gauge_threshold',   60, '공동 보너스 기준 게이지(%)'),
  ('common_bonus',     150, '공동 보너스'),
  ('votes_r1',           3, '1차 투표권'),
  ('votes_r2',           4, '2차 투표권'),
  ('votes_r3',           5, '3차 투표권'),
  ('max_per_group',      2, '학생 1명이 한 기업에 줄 수 있는 최대 표'),
  ('cost_research',    500, '신소재 연구 비용'),
  ('env_research',     -10, '신소재 연구 환경효과'),
  ('cost_factory',     600, '공장 확장 비용'),
  ('env_factory',      -15, '공장 확장 환경효과'),
  ('cost_eco_research',300, '친환경 소재 연구 비용'),
  ('env_eco_research',   0, '친환경 소재 연구 환경효과'),
  ('cost_purifier',    300, '공장 정화장치 비용'),
  ('env_purifier',      30, '공장 정화장치 환경효과'),
  ('slots_base',         2, '기본 전시 칸'),
  ('slots_factory',      4, '공장 확장 후 전시 칸'),
  ('lock_seconds',     180, '신발 편집 잠금 시간(초)')
on conflict (key) do nothing;
-- 초기 자본 조정(900 → 600): 이미 만든 DB도 바뀌게
update priv.settings set value = 600 where key = 'initial_wallet' and value = 900;

-- ---------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------
create table if not exists public.game (
  id               int primary key default 1 check (id = 1),
  phase            int not null default 0,
  env_revealed     boolean not null default false,
  fast_travel      boolean not null default false,
  require_approval boolean not null default false,
  ver              bigint not null default 0,
  updated_at       timestamptz not null default now()
);
insert into public.game(id) values (1) on conflict do nothing;

create table if not exists public.notices (
  id         bigserial primary key,
  kind       text not null default 'info',
  message    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_ticks (
  group_id int primary key,
  ver      bigint not null default 0
);

create table if not exists priv.groups (
  id               int primary key,
  label            text not null,
  company_name     text,
  logo_url         text,
  bg_url           text,
  bg_preset        int not null default 0,
  stands           jsonb not null default '[]'::jsonb,
  slot_count       int not null default 2,
  has_research     boolean not null default false,
  has_factory      boolean not null default false,
  has_eco_research boolean not null default false,
  has_purifier     boolean not null default false,
  updated_at       timestamptz not null default now()
);
insert into priv.groups(id, label)
  select g, g || '모둠' from generate_series(1, 6) g
on conflict do nothing;
insert into public.group_ticks(group_id)
  select g from generate_series(1, 6) g
on conflict do nothing;

create table if not exists priv.students (
  id         serial primary key,
  group_id   int not null references priv.groups(id),
  no         int,
  name       text not null,
  avatar     text,
  is_leader  boolean not null default false,
  uid        uuid unique,
  bound_at   timestamptz,
  last_seen  timestamptz
);

create table if not exists priv.pairing_requests (
  id         serial primary key,
  student_id int not null references priv.students(id) on delete cascade,
  uid        uuid not null,
  avatar     text,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists priv.materials (
  id      text primary key,
  part    text not null,   -- sole | body | insole | lace
  tier    text not null,   -- cheap | normal | eco | premium | eco_premium
  name    text not null,
  price   int  not null,
  env     int  not null,
  unlock  text not null default 'none', -- none | research | eco_research
  texture text not null,
  descr   text,
  sort    int  not null default 0
);

insert into priv.materials(id, part, tier, name, price, env, unlock, texture, descr, sort) values
 ('M01','sole','cheap','저가 플라스틱 밑창',40,-2,'none','dull','싸고 가볍지만 금방 닳아요',1),
 ('M02','sole','normal','일반 고무 밑창',70,-1,'none','flat','무난하고 튼튼해요',2),
 ('M03','sole','eco','재활용 고무 밑창',120,1,'none','speckle','버려진 타이어로 만들었어요',3),
 ('M04','sole','premium','쿠션 합성 밑창',130,-3,'research','sparkle','푹신하고 멋진 최신 밑창이에요',4),
 ('M05','sole','eco_premium','식물성 바이오 밑창',160,2,'eco_research','knit','식물에서 얻은 원료로 만들었어요',5),
 ('M06','body','cheap','저가 비닐 몸체',40,-2,'none','dull','반짝이지만 쉽게 찢어져요',1),
 ('M07','body','normal','일반 합성섬유 몸체',70,-1,'none','flat','가장 흔한 신발 소재예요',2),
 ('M08','body','eco','재활용 섬유 몸체',120,1,'none','speckle','페트병을 녹여 만든 실이에요',3),
 ('M09','body','premium','반짝이 합성 몸체',130,-3,'research','sparkle','눈에 확 띄는 화려한 소재예요',4),
 ('M10','body','eco_premium','친환경 니트 몸체',160,2,'eco_research','knit','부드럽고 통기성 좋은 니트예요',5),
 ('M11','insole','cheap','저가 스펀지 깔창',40,-2,'none','dull','금방 납작해져요',1),
 ('M12','insole','normal','일반 깔창',70,-1,'none','flat','기본 깔창이에요',2),
 ('M13','insole','eco','재활용 깔창',120,1,'none','speckle','남은 천 조각을 모아 만들었어요',3),
 ('M14','insole','premium','기능성 젤 깔창',130,-3,'research','sparkle','오래 걸어도 편안해요',4),
 ('M15','insole','eco_premium','코르크 깔창',160,2,'eco_research','knit','나무껍질로 만든 가벼운 깔창이에요',5),
 ('M16','lace','cheap','저가 끈',40,-2,'none','dull','자주 풀려요',1),
 ('M17','lace','normal','일반 끈',70,-1,'none','flat','기본 신발 끈이에요',2),
 ('M18','lace','eco','재활용 끈',120,1,'none','speckle','버려진 실을 다시 꼬았어요',3),
 ('M19','lace','premium','형광 끈',130,-3,'research','sparkle','어둠 속에서도 빛나요',4),
 ('M20','lace','eco_premium','유기농 면 끈',160,2,'eco_research','knit','농약 없이 기른 면이에요',5)
on conflict (id) do nothing;

create table if not exists priv.products (
  id         serial primary key,
  group_id   int not null references priv.groups(id),
  slot       int not null,
  shape      text not null,
  colors     jsonb not null default '{}'::jsonb,
  parts      jsonb not null,           -- {"sole":"M02","body":"M07","insole":"M12","lace":"M17"}
  cost       int not null default 0,   -- 이 신발에 지금까지 쓴 돈
  status     text not null default 'draft', -- draft | listed | retired | cancelled
  version    int not null default 1,
  created_by int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_active_slot
  on priv.products(group_id, slot) where status in ('draft', 'listed');

create table if not exists priv.slot_locks (
  group_id   int not null,
  slot       int not null,
  student_id int not null,
  until      timestamptz not null,
  primary key (group_id, slot)
);

create table if not exists priv.snapshots (
  round      int not null,
  product_id int not null references priv.products(id),
  group_id   int not null,
  slot       int not null,
  shape      text not null,
  colors     jsonb not null,
  parts      jsonb not null,
  env        int not null,
  primary key (round, product_id)
);

create table if not exists priv.ledger (
  id         bigserial primary key,
  txn_key    text unique not null,
  group_id   int not null,
  round      int,
  kind       text not null,  -- design | swap | refund | invest | sale | grant | admin_grant
  amount     int not null,   -- + 들어옴 / - 나감
  perf       boolean not null default true, -- 경영 성과에 포함하는지 (지원금은 false)
  env        int not null default 0,        -- 투자의 환경효과
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists priv.vote_submissions (
  round        int not null,
  student_id   int not null references priv.students(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (round, student_id)
);

create table if not exists priv.events (
  id          serial primary key,
  kind        text not null,
  round       int,
  product_id  int,
  qty         int not null default 0,
  gauge_delta numeric not null default 0,
  message     text,
  status      text not null default 'active', -- active | undone
  created_at  timestamptz not null default now()
);

create table if not exists priv.votes (
  id         bigserial primary key,
  round      int not null,
  product_id int not null,
  qty        int not null check (qty > 0),
  source     text not null, -- student | event
  student_id int references priv.students(id) on delete set null,
  event_id   int references priv.events(id),
  created_at timestamptz not null default now()
);

create table if not exists priv.round_results (
  round      int not null,
  group_id   int not null,
  votes      int not null,
  revenue    int not null,
  env_sales  int not null,
  eco_bonus  int not null default 0,
  settled_at timestamptz not null default now(),
  primary key (round, group_id)
);

create table if not exists priv.principles (
  id         serial primary key,
  group_id   int not null,
  student_id int,
  kind       text not null, -- company | personal
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists priv.admins (
  uid        uuid primary key,
  created_at timestamptz not null default now()
);
create table if not exists priv.admin_secret (
  id   int primary key default 1 check (id = 1),
  salt text not null,
  hash text not null
);
create table if not exists priv.admin_attempts (
  id  bigserial primary key,
  uid uuid,
  ok  boolean not null,
  at  timestamptz not null default now()
);

-- 공개 테이블: 실시간 알림용 (비밀 정보 없음)
alter table public.game        enable row level security;
alter table public.notices     enable row level security;
alter table public.group_ticks enable row level security;
drop policy if exists game_read on public.game;
create policy game_read on public.game for select using (true);
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select using (true);
drop policy if exists ticks_read on public.group_ticks;
create policy ticks_read on public.group_ticks for select using (true);
revoke insert, update, delete on public.game, public.notices, public.group_ticks from public;
do $$ begin
  execute 'revoke insert, update, delete on public.game, public.notices, public.group_ticks from anon, authenticated';
exception when others then null; end $$;

-- 실시간 구독 등록
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.game'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.notices'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.group_ticks'; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 함수 (priv 스키마: 학생 화면에서 호출 불가)
-- ---------------------------------------------------------------------
create or replace function priv.s(k text) returns numeric
language sql stable as $$ select value from priv.settings where key = k $$;

create or replace function priv.err(code text, msg text) returns void
language plpgsql as $$ begin raise exception '%: %', code, msg; end $$;

create or replace function priv.phase() returns int
language sql stable as $$ select phase from public.game where id = 1 $$;

create or replace function priv.market_round(p int) returns int
language sql immutable as $$ select case p when 2 then 1 when 5 then 2 when 9 then 3 else null end $$;

-- 지금 단계가 속한 경영 차수
create or replace function priv.work_round(p int) returns int
language sql immutable as $$ select case when p <= 2 then 1 when p <= 5 then 2 else 3 end $$;

create or replace function priv.revealed() returns boolean
language sql stable as $$ select env_revealed from public.game where id = 1 $$;

create or replace function priv.me() returns priv.students
language plpgsql stable as $$
declare r priv.students;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  select * into r from priv.students where uid = auth.uid();
  if not found then perform priv.err('NOT_JOINED', '아직 모둠에 입장하지 않았어요.'); end if;
  return r;
end $$;

create or replace function priv.is_admin() returns boolean
language sql stable as $$ select exists(select 1 from priv.admins where uid = auth.uid()) $$;

create or replace function priv.need_admin() returns void
language plpgsql stable as $$
begin
  if not priv.is_admin() then perform priv.err('NOT_ADMIN', '교사 로그인이 필요해요.'); end if;
end $$;

create or replace function priv.bump(g int) returns void
language sql as $$ update public.group_ticks set ver = ver + 1 where group_id = g $$;

create or replace function priv.bump_game() returns void
language sql as $$ update public.game set ver = ver + 1, updated_at = now() where id = 1 $$;

create or replace function priv.notice(msg text, k text default 'info') returns void
language sql as $$ insert into public.notices(kind, message) values (k, msg) $$;

create or replace function priv.wallet(g int) returns int
language sql stable as $$
  select (priv.s('initial_wallet') + coalesce((select sum(amount) from priv.ledger where group_id = g), 0))::int
$$;

create or replace function priv.perf(g int) returns int
language sql stable as $$
  select coalesce((select sum(amount) from priv.ledger where group_id = g and perf), 0)::int
$$;

create or replace function priv.env_total(g int) returns int
language sql stable as $$
  select (coalesce((select sum(env_sales) from priv.round_results where group_id = g), 0)
        + coalesce((select sum(env) from priv.ledger where group_id = g), 0))::int
$$;

create or replace function priv.eco_bonus(g int) returns int
language sql stable as $$
  select least(priv.s('eco_cap'), coalesce((select sum(eco_bonus) from priv.round_results where group_id = g), 0))::int
$$;

create or replace function priv.gauge() returns numeric
language sql stable as $$
  select greatest(0, least(100,
      100 + priv.s('gauge_coef') * coalesce((select sum(priv.env_total(id)) from priv.groups), 0)
          + coalesce((select sum(gauge_delta) from priv.events where status = 'active'), 0)
  ))
$$;

create or replace function priv.common_bonus() returns int
language sql stable as $$
  select case when priv.phase() >= 10 and priv.gauge() >= priv.s('gauge_threshold')
              then priv.s('common_bonus')::int else 0 end
$$;

create or replace function priv.score(g int) returns int
language sql stable as $$
  select (priv.perf(g) + priv.env_total(g) * priv.s('env_mult') + priv.eco_bonus(g) + priv.common_bonus())::int
$$;

create or replace function priv.shoe_env(parts jsonb) returns int
language sql stable as $$
  select coalesce(sum(m.env), 0)::int from priv.materials m
  where m.id in (parts->>'sole', parts->>'body', parts->>'insole', parts->>'lace')
$$;

create or replace function priv.stars(env int) returns int
language sql immutable as $$ select case when env >= 5 then 2 when env >= 1 then 1 else 0 end $$;

-- 신발 부품 검사: 올바른 부품인지, 해금됐는지. 부품별 가격 합 반환
create or replace function priv.check_parts(g int, parts jsonb) returns int
language plpgsql stable as $$
declare
  k text; mid text; m priv.materials; gr priv.groups; total int := 0;
begin
  select * into gr from priv.groups where id = g;
  foreach k in array array['sole','body','insole','lace'] loop
    mid := parts->>k;
    if mid is null then perform priv.err('BAD_PARTS', '부품을 모두 골라 주세요.'); end if;
    select * into m from priv.materials where id = mid;
    if not found or m.part <> k then perform priv.err('BAD_PARTS', '잘못된 재료예요.'); end if;
    if m.unlock = 'research' and not gr.has_research then
      perform priv.err('LOCKED_MATERIAL', m.name || '은(는) 신소재 연구 후에 쓸 수 있어요.'); end if;
    if m.unlock = 'eco_research' and not gr.has_eco_research then
      perform priv.err('LOCKED_MATERIAL', m.name || '은(는) 친환경 소재 연구 후에 쓸 수 있어요.'); end if;
    total := total + m.price;
  end loop;
  return total;
end $$;

-- 신발 칸 편집 잠금 확인 (없으면 내가 잡음)
create or replace function priv.take_lock(g int, sl int, sid int) returns void
language plpgsql as $$
declare l priv.slot_locks;
begin
  select * into l from priv.slot_locks where group_id = g and slot = sl for update;
  if found and l.student_id <> sid and l.until > now() then
    perform priv.err('LOCKED', (select name from priv.students where id = l.student_id) || ' 학생이 이 신발을 고치는 중이에요.');
  end if;
  insert into priv.slot_locks(group_id, slot, student_id, until)
  values (g, sl, sid, now() + make_interval(secs => priv.s('lock_seconds')::int))
  on conflict (group_id, slot) do update set student_id = excluded.student_id, until = excluded.until;
end $$;

-- 시장 개장: 판매할 신발 사진 찍기
create or replace function priv.open_market(r int) returns void
language plpgsql as $$
begin
  insert into priv.snapshots(round, product_id, group_id, slot, shape, colors, parts, env)
  select r, p.id, p.group_id, p.slot, p.shape, p.colors, p.parts, priv.shoe_env(p.parts)
  from priv.products p where p.status in ('draft', 'listed')
  on conflict do nothing;
  update priv.products set status = 'listed', updated_at = now() where status = 'draft';
  delete from priv.slot_locks where true;
end $$;

-- 정산: 차수별 결과를 한 번만 기록
create or replace function priv.settle(r int) returns void
language plpgsql as $$
declare g int; v int; env_s int; eco int; inc numeric := priv.s('vote_income');
begin
  for g in select id from priv.groups order by id loop
    if exists(select 1 from priv.round_results where round = r and group_id = g) then continue; end if;
    select coalesce(sum(v2.qty), 0), coalesce(sum(v2.qty * s.env), 0) into v, env_s
      from priv.votes v2 join priv.snapshots s on s.round = v2.round and s.product_id = v2.product_id
      where v2.round = r and s.group_id = g;
    eco := 0;
    if r = 3 then
      select coalesce(sum(v3.qty * case priv.stars(s.env)
                                    when 2 then priv.s('star2_bonus')
                                    when 1 then priv.s('star1_bonus') else 0 end), 0)::int into eco
        from priv.votes v3
        join priv.snapshots s on s.round = v3.round and s.product_id = v3.product_id
        join priv.students st on st.id = v3.student_id
        where v3.round = r and v3.source = 'student' and st.group_id = g;
    end if;
    insert into priv.round_results(round, group_id, votes, revenue, env_sales, eco_bonus)
      values (r, g, v, (v * inc)::int, env_s, eco);
    insert into priv.ledger(txn_key, group_id, round, kind, amount, perf, note)
      values ('sale:r' || r || ':g' || g, g, r, 'sale', (v * inc)::int, true, r || '차 판매 수입')
      on conflict (txn_key) do nothing;
  end loop;
end $$;

create or replace function priv.set_admin_password(pw text) returns void
language plpgsql as $$
declare sa text := md5(random()::text || clock_timestamp()::text);
begin
  insert into priv.admin_secret(id, salt, hash) values (1, sa, encode(sha256(convert_to(sa || pw, 'UTF8')), 'hex'))
  on conflict (id) do update set salt = excluded.salt, hash = excluded.hash;
  delete from priv.admins where true;
end $$;

-- =====================================================================
-- 4. 학생/공용 함수 (화면에서 supabase.rpc 로 호출)
-- =====================================================================

-- 첫 화면: 모둠 목록과 게임 상태
create or replace function public.get_public() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'phase', g.phase, 'fast_travel', g.fast_travel, 'require_approval', g.require_approval,
    'groups', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', gr.id, 'label', gr.label, 'company_name', gr.company_name, 'logo_url', gr.logo_url) order by gr.id), '[]')
      from priv.groups gr))
  from public.game g where g.id = 1
$$;

-- 모둠 명단 (이름 고르기용)
create or replace function public.get_roster(p_group int) returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'no', s.no, 'name', s.name, 'taken', s.uid is not null) order by s.no, s.id), '[]')
  from priv.students s where s.group_id = p_group
$$;

-- 입장: 이 브라우저를 학생에게 연결
create or replace function public.join_student(p_student int, p_avatar text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; mine priv.students; appr boolean;
begin
  if auth.uid() is null then perform priv.err('NO_AUTH', '접속 정보가 없어요. 새로고침해 주세요.'); end if;
  if p_avatar not in ('boy', 'girl') then p_avatar := 'boy'; end if;
  select * into mine from priv.students where uid = auth.uid();
  if found then
    if mine.id = p_student then return jsonb_build_object('status', 'joined'); end if;
    perform priv.err('DEVICE_TAKEN', '이 기기는 이미 ' || mine.name || ' 학생으로 연결되어 있어요. 선생님께 말해 주세요.');
  end if;
  select * into s from priv.students where id = p_student for update;
  if not found then perform priv.err('NO_STUDENT', '학생을 찾을 수 없어요.'); end if;
  select require_approval into appr from public.game where id = 1;
  if s.uid is null and not appr then
    update priv.students set uid = auth.uid(), avatar = p_avatar, bound_at = now(), last_seen = now() where id = s.id;
    perform priv.bump(s.group_id);
    return jsonb_build_object('status', 'joined');
  end if;
  if s.uid is not null and not appr then
    perform priv.err('NAME_TAKEN', s.name || ' 학생은 이미 다른 기기로 들어와 있어요. 선생님께 말해 주세요.');
  end if;
  -- 승인 모드: 요청만 남김
  delete from priv.pairing_requests where uid = auth.uid() and status = 'pending';
  insert into priv.pairing_requests(student_id, uid, avatar) values (s.id, auth.uid(), p_avatar);
  perform priv.bump_game();
  return jsonb_build_object('status', 'pending');
end $$;

-- 내가 누구인지 (자동 재입장용)
create or replace function public.get_me() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare s priv.students; pend boolean;
begin
  if auth.uid() is null then return jsonb_build_object('status', 'none'); end if;
  select * into s from priv.students where uid = auth.uid();
  if found then
    update priv.students set last_seen = now() where id = s.id;
    return jsonb_build_object('status', 'joined', 'student_id', s.id, 'group_id', s.group_id,
      'name', s.name, 'no', s.no, 'avatar', s.avatar, 'is_leader', s.is_leader);
  end if;
  select exists(select 1 from priv.pairing_requests where uid = auth.uid() and status = 'pending') into pend;
  return jsonb_build_object('status', case when pend then 'pending' else 'none' end);
end $$;

-- 재료 목록 (환경점수는 공개 후에만)
create or replace function priv.materials_json() returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'part', m.part, 'tier', m.tier, 'name', m.name, 'price', m.price,
      'unlock', m.unlock, 'texture', m.texture, 'descr', m.descr,
      'env', case when priv.revealed() then m.env else null end) order by m.part, m.sort), '[]')
  from priv.materials m
$$;

create or replace function priv.product_json(p priv.products) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'slot', p.slot, 'shape', p.shape, 'colors', p.colors,
    'parts', p.parts, 'status', p.status, 'cost', p.cost, 'version', p.version,
    'env', case when priv.revealed() then priv.shoe_env(p.parts) else null end,
    'stars', case when priv.phase() >= 8 then priv.stars(priv.shoe_env(p.parts)) else null end)
$$;

create or replace function priv.lobby_json(g int) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', gr.id, 'label', gr.label, 'company_name', gr.company_name,
    'logo_url', gr.logo_url, 'bg_url', gr.bg_url, 'bg_preset', gr.bg_preset, 'stands', gr.stands,
    'slot_count', gr.slot_count)
  from priv.groups gr where gr.id = g
$$;

-- 우리 모둠 전체 상태
create or replace function public.my_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; gr priv.groups; ph int; rv boolean; mr int; res jsonb;
begin
  me := priv.me();
  update priv.students set last_seen = now() where id = me.id;
  select * into gr from priv.groups where id = me.group_id;
  ph := priv.phase(); rv := priv.revealed(); mr := priv.market_round(ph);
  res := jsonb_build_object(
    'phase', ph, 'revealed', rv, 'work_round', priv.work_round(ph), 'market_round', mr,
    'fast_travel', (select fast_travel from public.game where id = 1),
    'me', jsonb_build_object('id', me.id, 'name', me.name, 'no', me.no, 'avatar', me.avatar, 'is_leader', me.is_leader),
    'group', priv.lobby_json(me.group_id),
    'wallet', priv.wallet(me.group_id),
    'score', case when rv then priv.score(me.group_id) else null end,
    'gauge', case when rv then round(priv.gauge(), 1) else null end,
    'invest', jsonb_build_object(
      'research', gr.has_research, 'factory', gr.has_factory,
      'eco_research', gr.has_eco_research, 'purifier', gr.has_purifier,
      'cost_research', priv.s('cost_research'), 'cost_factory', priv.s('cost_factory'),
      'cost_eco_research', priv.s('cost_eco_research'), 'cost_purifier', priv.s('cost_purifier'),
      'env_research', case when rv then priv.s('env_research') end,
      'env_factory', case when rv then priv.s('env_factory') end,
      'env_eco_research', case when rv then priv.s('env_eco_research') end,
      'env_purifier', case when rv then priv.s('env_purifier') end),
    'products', (select coalesce(jsonb_agg(priv.product_json(p) || jsonb_build_object(
          'locked_by', (select st.name from priv.slot_locks l join priv.students st on st.id = l.student_id
                        where l.group_id = p.group_id and l.slot = p.slot and l.until > now() and l.student_id <> me.id))
        order by p.slot), '[]')
      from priv.products p where p.group_id = me.group_id and p.status in ('draft', 'listed')),
    'locks', (select coalesce(jsonb_agg(jsonb_build_object('slot', l.slot, 'name', st.name, 'mine', l.student_id = me.id)), '[]')
      from priv.slot_locks l join priv.students st on st.id = l.student_id
      where l.group_id = me.group_id and l.until > now()),
    'materials', priv.materials_json(),
    'votes_total', case mr when 1 then priv.s('votes_r1') when 2 then priv.s('votes_r2') when 3 then priv.s('votes_r3') end,
    'max_per_group', priv.s('max_per_group'),
    'voted', case when mr is null then null
                  else exists(select 1 from priv.vote_submissions where round = mr and student_id = me.id) end,
    'team', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'no', s.no, 'is_leader', s.is_leader,
              'avatar', s.avatar, 'online', s.last_seen > now() - interval '60 seconds') order by s.no), '[]')
             from priv.students s where s.group_id = me.group_id and s.uid is not null)
  );
  return res;
end $$;

-- 로비 꾸미기
create or replace function public.lobby_update(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  if (p ? 'company_name' or p ? 'logo_url') and not me.is_leader then
    perform priv.err('LEADER_ONLY', '기업 이름과 로고는 모둠장만 바꿀 수 있어요.');
  end if;
  if p ? 'company_name' and length(coalesce(p->>'company_name', '')) > 20 then
    perform priv.err('TOO_LONG', '기업 이름은 20자까지예요.');
  end if;
  update priv.groups set
    company_name = case when p ? 'company_name' then nullif(trim(p->>'company_name'), '') else company_name end,
    logo_url     = case when p ? 'logo_url' then p->>'logo_url' else logo_url end,
    bg_url       = case when p ? 'bg_url' then p->>'bg_url' else bg_url end,
    bg_preset    = case when p ? 'bg_preset' then (p->>'bg_preset')::int else bg_preset end,
    stands       = case when p ? 'stands' and jsonb_typeof(p->'stands') = 'array' then p->'stands' else stands end,
    updated_at   = now()
  where id = me.group_id;
  perform priv.bump(me.group_id);
  return priv.lobby_json(me.group_id);
end $$;

-- 신발 칸 편집 시작/연장, 끝내기
create or replace function public.slot_lock(p_slot int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  perform priv.take_lock(me.group_id, p_slot, me.id);
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.slot_unlock(p_slot int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  delete from priv.slot_locks where group_id = me.group_id and slot = p_slot and student_id = me.id;
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true);
end $$;

-- 신발 저장 (새로 만들기 / 판매 전 수정 / 3차 재료 교체)
create or replace function public.product_save(p_slot int, p_shape text, p_colors jsonb, p_parts jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare
  me priv.students; gr priv.groups; ph int; cur priv.products; price int; pay int := 0; k text; m priv.materials;
  newid int;
begin
  me := priv.me();
  select * into gr from priv.groups where id = me.group_id for update;
  ph := priv.phase();
  if (p_shape is null and ph <> 8) or p_shape not in ('lowtop', 'hightop', 'clog', 'oxford') then perform priv.err('BAD_SHAPE', '신발 모양을 골라 주세요.'); end if;
  if p_slot < 1 or p_slot > gr.slot_count then perform priv.err('BAD_SLOT', '사용할 수 없는 전시 칸이에요.'); end if;
  perform priv.take_lock(me.group_id, p_slot, me.id);
  price := priv.check_parts(me.group_id, p_parts);
  select * into cur from priv.products where group_id = me.group_id and slot = p_slot and status in ('draft', 'listed');

  if ph in (1, 4) then
    if cur.id is null then
      pay := price;
      if priv.wallet(me.group_id) < pay then perform priv.err('NO_MONEY', '돈이 부족해요. (필요 ' || pay || ', 지갑 ' || priv.wallet(me.group_id) || ')'); end if;
      insert into priv.products(group_id, slot, shape, colors, parts, cost, created_by)
        values (me.group_id, p_slot, p_shape, coalesce(p_colors, '{}'), p_parts, price, me.id) returning id into newid;
      insert into priv.ledger(txn_key, group_id, round, kind, amount, note)
        values ('design:p' || newid || ':v1', me.group_id, priv.work_round(ph), 'design', -pay, me.name || ' 신발 제작');
    elsif cur.status = 'draft' then
      pay := price - cur.cost;
      if pay > 0 and priv.wallet(me.group_id) < pay then perform priv.err('NO_MONEY', '돈이 부족해요. (추가 ' || pay || ', 지갑 ' || priv.wallet(me.group_id) || ')'); end if;
      update priv.products set shape = p_shape, colors = coalesce(p_colors, '{}'), parts = p_parts, cost = price,
        version = version + 1, updated_at = now() where id = cur.id;
      if pay <> 0 then
        insert into priv.ledger(txn_key, group_id, round, kind, amount, note)
          values ('design:p' || cur.id || ':v' || (cur.version + 1), me.group_id, priv.work_round(ph), 'design', -pay, me.name || ' 신발 수정');
      end if;
      newid := cur.id;
    else
      perform priv.err('ALREADY_SOLD', '이미 판매한 신발은 고칠 수 없어요. 단종하고 새로 만들어 주세요.');
    end if;
  elsif ph = 8 then
    if cur.id is null or cur.status <> 'listed' then perform priv.err('PHASE', '3차에는 이미 만든 신발의 재료만 바꿀 수 있어요.'); end if;
    foreach k in array array['sole','body','insole','lace'] loop
      if (p_parts->>k) <> (cur.parts->>k) then
        select * into m from priv.materials where id = p_parts->>k;
        pay := pay + m.price;
      end if;
    end loop;
    if pay > 0 and priv.wallet(me.group_id) < pay then perform priv.err('NO_MONEY', '돈이 부족해요. (필요 ' || pay || ', 지갑 ' || priv.wallet(me.group_id) || ')'); end if;
    update priv.products set shape = coalesce(p_shape, cur.shape), colors = coalesce(p_colors, cur.colors), parts = p_parts, cost = cost + pay,
      version = version + 1, updated_at = now() where id = cur.id;
    if pay > 0 then
      insert into priv.ledger(txn_key, group_id, round, kind, amount, note)
        values ('swap:p' || cur.id || ':v' || (cur.version + 1), me.group_id, 3, 'swap', -pay, me.name || ' 재료 교체');
    end if;
    newid := cur.id;
  else
    perform priv.err('PHASE', '지금은 신발을 만들 수 없는 시간이에요.');
  end if;
  delete from priv.slot_locks where group_id = me.group_id and slot = p_slot;
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true, 'product_id', newid, 'paid', pay, 'wallet', priv.wallet(me.group_id));
end $$;

-- 판매 전 신발 취소(환불)
create or replace function public.product_cancel(p_slot int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; cur priv.products;
begin
  me := priv.me();
  perform 1 from priv.groups where id = me.group_id for update;
  if priv.phase() not in (1, 4) then perform priv.err('PHASE', '지금은 취소할 수 없어요.'); end if;
  perform priv.take_lock(me.group_id, p_slot, me.id);
  select * into cur from priv.products where group_id = me.group_id and slot = p_slot and status = 'draft';
  if not found then perform priv.err('NOT_DRAFT', '판매 전 신발만 취소할 수 있어요.'); end if;
  update priv.products set status = 'cancelled', updated_at = now() where id = cur.id;
  insert into priv.ledger(txn_key, group_id, round, kind, amount, note)
    values ('refund:p' || cur.id, me.group_id, priv.work_round(priv.phase()), 'refund', cur.cost, me.name || ' 신발 취소 환불');
  delete from priv.slot_locks where group_id = me.group_id and slot = p_slot;
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true, 'wallet', priv.wallet(me.group_id));
end $$;

-- 2차 경영: 이미 판 신발 단종 (환불 없음, 칸 비우기)
create or replace function public.product_retire(p_slot int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  if priv.phase() <> 4 then perform priv.err('PHASE', '단종은 2차 경영 시간에만 할 수 있어요.'); end if;
  perform priv.take_lock(me.group_id, p_slot, me.id);
  update priv.products set status = 'retired', updated_at = now()
    where group_id = me.group_id and slot = p_slot and status = 'listed';
  if not found then perform priv.err('NOT_LISTED', '단종할 신발이 없어요.'); end if;
  delete from priv.slot_locks where group_id = me.group_id and slot = p_slot;
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true);
end $$;

-- 투자 (모둠장)
create or replace function public.invest(p_kind text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; gr priv.groups; ph int; cost int; envv int; label text;
begin
  me := priv.me();
  if not me.is_leader then perform priv.err('LEADER_ONLY', '투자는 모둠장만 할 수 있어요.'); end if;
  select * into gr from priv.groups where id = me.group_id for update;
  ph := priv.phase();
  if p_kind in ('research', 'factory') then
    if ph not in (4, 8) then perform priv.err('PHASE', '지금은 투자할 수 없어요.'); end if;
  elsif p_kind in ('eco_research', 'purifier') then
    if ph <> 8 then perform priv.err('PHASE', '아직 열리지 않은 투자예요.'); end if;
  else
    perform priv.err('BAD_KIND', '알 수 없는 투자예요.');
  end if;
  if (p_kind = 'research' and gr.has_research) or (p_kind = 'factory' and gr.has_factory)
     or (p_kind = 'eco_research' and gr.has_eco_research) or (p_kind = 'purifier' and gr.has_purifier) then
    perform priv.err('ALREADY', '이미 한 투자예요.');
  end if;
  cost := priv.s('cost_' || p_kind)::int; envv := priv.s('env_' || p_kind)::int;
  label := case p_kind when 'research' then '신소재 연구' when 'factory' then '공장 확장'
           when 'eco_research' then '친환경 소재 연구' else '공장 정화장치' end;
  if priv.wallet(me.group_id) < cost then perform priv.err('NO_MONEY', '돈이 부족해요. (필요 ' || cost || ', 지갑 ' || priv.wallet(me.group_id) || ')'); end if;
  insert into priv.ledger(txn_key, group_id, round, kind, amount, env, note)
    values ('invest:' || p_kind || ':g' || me.group_id, me.group_id, priv.work_round(ph), 'invest', -cost, envv, label);
  update priv.groups set
    has_research     = has_research or p_kind = 'research',
    has_factory      = has_factory or p_kind = 'factory',
    has_eco_research = has_eco_research or p_kind = 'eco_research',
    has_purifier     = has_purifier or p_kind = 'purifier',
    slot_count       = case when p_kind = 'factory' then priv.s('slots_factory')::int else slot_count end,
    updated_at = now()
  where id = me.group_id;
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true, 'wallet', priv.wallet(me.group_id));
end $$;

-- 마을/시장: 모든 모둠 로비와 판매 중인 신발
create or replace function public.market() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; ph int; mr int;
begin
  me := priv.me();
  ph := priv.phase(); mr := priv.market_round(ph);
  return jsonb_build_object(
    'phase', ph, 'market_round', mr, 'my_group', me.group_id,
    'fast_travel', (select fast_travel from public.game where id = 1),
    'votes_total', case mr when 1 then priv.s('votes_r1') when 2 then priv.s('votes_r2') when 3 then priv.s('votes_r3') end,
    'max_per_group', priv.s('max_per_group'),
    'voted', case when mr is null then null else exists(select 1 from priv.vote_submissions where round = mr and student_id = me.id) end,
    'groups', (select coalesce(jsonb_agg(priv.lobby_json(gr.id) || jsonb_build_object(
        'products', case when mr is not null then
            (select coalesce(jsonb_agg(jsonb_build_object('id', s.product_id, 'slot', s.slot, 'shape', s.shape,
                'colors', s.colors, 'parts', s.parts,
                'stars', case when mr = 3 then priv.stars(s.env) else null end) order by s.slot), '[]')
             from priv.snapshots s where s.round = mr and s.group_id = gr.id)
          else
            (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'slot', p.slot, 'shape', p.shape,
                'colors', p.colors, 'parts', p.parts,
                'stars', case when ph >= 8 then priv.stars(priv.shoe_env(p.parts)) else null end) order by p.slot), '[]')
             from priv.products p where p.group_id = gr.id and p.status = 'listed')
          end) order by gr.id), '[]')
      from priv.groups gr),
    'materials', priv.materials_json()
  );
end $$;

-- 구매 확정 (장바구니 한 번에 제출)
create or replace function public.votes_submit(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; mr int; total int := 0; cap int; maxg int; it jsonb; pg int; q int; pid int;
begin
  me := priv.me();
  mr := priv.market_round(priv.phase());
  if mr is null then perform priv.err('PHASE', '지금은 시장이 열려 있지 않아요.'); end if;
  cap := (case mr when 1 then priv.s('votes_r1') when 2 then priv.s('votes_r2') else priv.s('votes_r3') end)::int;
  maxg := priv.s('max_per_group')::int;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform priv.err('EMPTY', '장바구니가 비어 있어요.');
  end if;
  -- 중복 제출 방지 (같은 학생·같은 차수는 한 번만)
  begin
    insert into priv.vote_submissions(round, student_id) values (mr, me.id);
  exception when unique_violation then
    perform priv.err('ALREADY_VOTED', '이번 시장에서는 이미 구매를 확정했어요.');
  end;
  -- 장바구니 검사 (임시 테이블 없이)
  for it in select * from jsonb_array_elements(p_items) loop
    pid := (it->>'product_id')::int; q := (it->>'qty')::int;
    if q is null or q <= 0 then continue; end if;
    select group_id into pg from priv.snapshots where round = mr and product_id = pid;
    if not found then perform priv.err('BAD_PRODUCT', '지금 팔고 있지 않은 신발이 있어요.'); end if;
    if pg = me.group_id then perform priv.err('OWN_GROUP', '우리 회사 신발은 살 수 없어요.'); end if;
    total := total + q;
  end loop;
  if total = 0 then perform priv.err('EMPTY', '장바구니가 비어 있어요.'); end if;
  if total > cap then perform priv.err('TOO_MANY', '표는 ' || cap || '개까지 쓸 수 있어요.'); end if;
  if exists(
    select 1 from jsonb_array_elements(p_items) e
    join priv.snapshots s on s.round = mr and s.product_id = (e->>'product_id')::int
    where (e->>'qty')::int > 0
    group by s.group_id having sum((e->>'qty')::int) > maxg) then
    perform priv.err('GROUP_LIMIT', '한 회사에는 ' || maxg || '표까지만 줄 수 있어요.');
  end if;
  insert into priv.votes(round, product_id, qty, source, student_id)
    select mr, (e->>'product_id')::int, sum((e->>'qty')::int), 'student', me.id
    from jsonb_array_elements(p_items) e where (e->>'qty')::int > 0
    group by (e->>'product_id')::int;
  perform priv.bump_game();
  return jsonb_build_object('ok', true, 'used', total);
end $$;

-- 경영 보고서
create or replace function public.report() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students; g int; rv boolean;
begin
  me := priv.me(); g := me.group_id; rv := priv.revealed();
  return jsonb_build_object(
    'revealed', rv, 'phase', priv.phase(),
    'wallet', priv.wallet(g),
    'income', coalesce((select sum(amount) from priv.ledger where group_id = g and kind = 'sale'), 0),
    'spent', -coalesce((select sum(amount) from priv.ledger where group_id = g and kind in ('design','swap','refund','invest')), 0),
    'grants', coalesce((select sum(amount) from priv.ledger where group_id = g and kind in ('grant','admin_grant')), 0),
    'perf', priv.perf(g),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('round', r.round, 'votes', r.votes, 'revenue', r.revenue,
                 'env_sales', case when rv then r.env_sales end) order by r.round), '[]')
               from priv.round_results r where r.group_id = g),
    'env', case when rv then priv.env_total(g) end,
    'env_points', case when rv then priv.env_total(g) * priv.s('env_mult') end,
    'eco_bonus', case when rv then priv.eco_bonus(g) end,
    'common_bonus', case when rv then priv.common_bonus() end,
    'score', case when rv then priv.score(g) end,
    'gauge', case when rv then round(priv.gauge(), 1) end,
    'env_mult', case when rv then priv.s('env_mult') end,
    'detail', case when rv then (
      select coalesce(jsonb_agg(jsonb_build_object('round', s.round, 'slot', s.slot, 'shape', s.shape, 'colors', s.colors,
               'parts', s.parts, 'env', s.env,
               'votes', coalesce((select sum(qty) from priv.votes v where v.round = s.round and v.product_id = s.product_id), 0))
             order by s.round, s.slot), '[]')
      from priv.snapshots s join priv.round_results rr on rr.round = s.round and rr.group_id = s.group_id
      where s.group_id = g) end,
    'investments', case when rv then (
      select coalesce(jsonb_agg(jsonb_build_object('note', l.note, 'cost', -l.amount, 'env', l.env) order by l.id), '[]')
      from priv.ledger l where l.group_id = g and l.kind = 'invest') end
  );
end $$;

-- 경영 원칙 / 개인 한 문장
create or replace function public.principle_submit(p_kind text, p_text text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  if p_kind not in ('company', 'personal') then perform priv.err('BAD_KIND', '잘못된 종류예요.'); end if;
  if p_kind = 'company' and not me.is_leader then perform priv.err('LEADER_ONLY', '기업 원칙은 모둠장이 등록해요.'); end if;
  if length(trim(coalesce(p_text, ''))) = 0 or length(p_text) > 300 then perform priv.err('BAD_TEXT', '1~300자로 써 주세요.'); end if;
  if p_kind = 'company' then
    delete from priv.principles where group_id = me.group_id and kind = 'company';
  else
    delete from priv.principles where student_id = me.id and kind = 'personal';
  end if;
  insert into priv.principles(group_id, student_id, kind, body) values (me.group_id, me.id, p_kind, trim(p_text));
  perform priv.bump(me.group_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.my_principles() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare me priv.students;
begin
  me := priv.me();
  return jsonb_build_object(
    'company', (select body from priv.principles where group_id = me.group_id and kind = 'company' order by id desc limit 1),
    'personal', (select body from priv.principles where student_id = me.id and kind = 'personal' order by id desc limit 1));
end $$;

-- 전자칠판
create or replace function public.get_board() returns jsonb
language sql stable security definer set search_path = public, priv as $$
  select jsonb_build_object(
    'phase', priv.phase(), 'revealed', priv.revealed(),
    'gauge', case when priv.revealed() then round(priv.gauge(), 1) end,
    'threshold', priv.s('gauge_threshold'),
    'groups', (select coalesce(jsonb_agg(jsonb_build_object('id', gr.id, 'label', gr.label,
        'company_name', gr.company_name, 'logo_url', gr.logo_url,
        'score', case when priv.revealed() then priv.score(gr.id) end,
        'env', case when priv.revealed() then priv.env_total(gr.id) end) order by gr.id), '[]')
      from priv.groups gr),
    'voted', (select count(*) from priv.vote_submissions where round = priv.market_round(priv.phase())),
    'joined', (select count(*) from priv.students where uid is not null))
$$;

-- =====================================================================
-- 5. 교사 함수
-- =====================================================================

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
  select jsonb_build_object('admin', priv.is_admin())
$$;

-- 관제실 전체 데이터
create or replace function public.admin_state() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare ph int; mr int;
begin
  perform priv.need_admin();
  ph := priv.phase(); mr := priv.market_round(ph);
  return jsonb_build_object(
    'game', (select to_jsonb(g) from public.game g where id = 1),
    'market_round', mr, 'work_round', priv.work_round(ph),
    'gauge', round(priv.gauge(), 1),
    'gauge_adj', coalesce((select sum(gauge_delta) from priv.events where status = 'active'), 0),
    'common_bonus', priv.common_bonus(),
    'settings', (select jsonb_object_agg(key, value) from priv.settings),
    'groups', (select coalesce(jsonb_agg(priv.lobby_json(gr.id) || jsonb_build_object(
        'wallet', priv.wallet(gr.id), 'perf', priv.perf(gr.id), 'env', priv.env_total(gr.id),
        'eco_bonus', priv.eco_bonus(gr.id), 'score', priv.score(gr.id),
        'has_research', gr.has_research, 'has_factory', gr.has_factory,
        'has_eco_research', gr.has_eco_research, 'has_purifier', gr.has_purifier,
        'company_principle', (select body from priv.principles where group_id = gr.id and kind = 'company' order by id desc limit 1),
        'products', (select coalesce(jsonb_agg(priv.product_json(p) || jsonb_build_object(
              'env', priv.shoe_env(p.parts),
              'locked_by', (select st.name from priv.slot_locks l join priv.students st on st.id = l.student_id
                            where l.group_id = p.group_id and l.slot = p.slot and l.until > now())) order by p.slot), '[]')
            from priv.products p where p.group_id = gr.id and p.status in ('draft', 'listed'))
      ) order by gr.id), '[]') from priv.groups gr),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'group_id', s.group_id, 'no', s.no,
        'name', s.name, 'avatar', s.avatar, 'is_leader', s.is_leader, 'bound', s.uid is not null,
        'online', s.last_seen > now() - interval '60 seconds',
        'voted', case when mr is null then null else exists(select 1 from priv.vote_submissions v where v.round = mr and v.student_id = s.id) end,
        'personal', (select body from priv.principles pr where pr.student_id = s.id and pr.kind = 'personal' order by id desc limit 1)
      ) order by s.group_id, s.no, s.id), '[]') from priv.students s),
    'pairings', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'student_id', r.student_id,
        'name', s.name, 'group_id', s.group_id, 'created_at', r.created_at) order by r.id), '[]')
      from priv.pairing_requests r join priv.students s on s.id = r.student_id where r.status = 'pending'),
    'sales', (select coalesce(jsonb_agg(jsonb_build_object('round', sn.round, 'product_id', sn.product_id,
        'group_id', sn.group_id, 'slot', sn.slot, 'shape', sn.shape, 'colors', sn.colors, 'parts', sn.parts, 'env', sn.env,
        'student_votes', coalesce((select sum(qty) from priv.votes v where v.round = sn.round and v.product_id = sn.product_id and v.source = 'student'), 0),
        'event_votes', coalesce((select sum(qty) from priv.votes v where v.round = sn.round and v.product_id = sn.product_id and v.source = 'event'), 0)
      ) order by sn.round, sn.group_id, sn.slot), '[]') from priv.snapshots sn),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc), '[]') from priv.events e),
    'settled', (select coalesce(jsonb_agg(distinct round), '[]') from priv.round_results),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('group_id', l.group_id, 'kind', l.kind, 'amount', l.amount,
        'env', l.env, 'note', l.note, 'at', l.created_at) order by l.id desc), '[]')
      from (select * from priv.ledger order by id desc limit 200) l),
    'materials', (select jsonb_agg(to_jsonb(m) order by m.part, m.sort) from priv.materials m)
  );
end $$;

-- 단계 넘기기 (한 단계씩 앞으로, 정산·스냅샷 자동)
create or replace function public.admin_set_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare ph int; nxt int; g int;
begin
  perform priv.need_admin();
  perform 1 from public.game where id = 1 for update;
  ph := priv.phase();
  if p_target <= ph then perform priv.err('BACKWARD', '뒤로 가기는 복구 모드(강제 이동)로만 할 수 있어요.'); end if;
  if p_target > 11 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  while ph < p_target loop
    nxt := ph + 1;
    if nxt = 2 then perform priv.open_market(1);
    elsif nxt = 3 then perform priv.settle(1);
    elsif nxt = 5 then perform priv.open_market(2);
    elsif nxt = 6 then perform priv.settle(2);
    elsif nxt = 7 then
      update public.game set env_revealed = true where id = 1;
      for g in select id from priv.groups loop
        insert into priv.ledger(txn_key, group_id, round, kind, amount, perf, note)
          values ('grant:env:g' || g, g, 3, 'grant', priv.s('grant_env')::int, false, '우주 운영진 환경 전환 지원금')
          on conflict (txn_key) do nothing;
      end loop;
      perform priv.notice('지구 서버 긴급 경보! 숨겨져 있던 환경점수가 공개되었습니다.', 'alert');
    elsif nxt = 9 then perform priv.open_market(3);
    elsif nxt = 10 then perform priv.settle(3);
    end if;
    update public.game set phase = nxt where id = 1;
    ph := nxt;
  end loop;
  perform priv.bump_game();
  for g in select id from priv.groups loop perform priv.bump(g); end loop;
  return jsonb_build_object('ok', true, 'phase', ph);
end $$;

-- 복구 모드: 단계 숫자만 바꿈 (정산·스냅샷 없음)
create or replace function public.admin_force_phase(p_target int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g int;
begin
  perform priv.need_admin();
  if p_target < 0 or p_target > 11 then perform priv.err('BAD_PHASE', '없는 단계예요.'); end if;
  update public.game set phase = p_target, env_revealed = (p_target >= 7) where id = 1;
  perform priv.bump_game();
  for g in select id from priv.groups loop perform priv.bump(g); end loop;
  return jsonb_build_object('ok', true, 'phase', p_target);
end $$;

create or replace function public.admin_flags(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update public.game set
    fast_travel      = coalesce((p->>'fast_travel')::boolean, fast_travel),
    require_approval = coalesce((p->>'require_approval')::boolean, require_approval)
  where id = 1;
  perform priv.bump_game();
  return (select to_jsonb(g) from public.game g where id = 1);
end $$;

-- 명단 넣기: [{"group":1,"no":3,"name":"민준"}, ...]  (기존 명단을 바꿈)
create or replace function public.admin_roster_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare n int;
begin
  perform priv.need_admin();
  if priv.phase() > 1 then perform priv.err('PHASE', '명단은 1차 시장이 열리기 전에만 바꿀 수 있어요.'); end if;
  delete from priv.pairing_requests where true;
  delete from priv.slot_locks where true;
  delete from priv.principles where student_id is not null;
  delete from priv.vote_submissions where true;
  delete from priv.students where true;
  insert into priv.students(group_id, no, name)
    select (r->>'group')::int, nullif(r->>'no', '')::int, trim(r->>'name')
    from jsonb_array_elements(p_rows) r
    where coalesce(trim(r->>'name'), '') <> '' and (r->>'group')::int between 1 and 6;
  get diagnostics n = row_count;
  perform priv.bump_game();
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.admin_set_label(p_group int, p_label text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  update priv.groups set label = trim(p_label) where id = p_group;
  perform priv.bump_game(); perform priv.bump(p_group);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_leader(p_student int, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g int;
begin
  perform priv.need_admin();
  update priv.students set is_leader = p_on where id = p_student returning group_id into g;
  perform priv.bump(g);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_binding(p_student int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g int;
begin
  perform priv.need_admin();
  update priv.students set uid = null, bound_at = null where id = p_student returning group_id into g;
  delete from priv.slot_locks where student_id = p_student;
  perform priv.bump(g); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_approve(p_request int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r priv.pairing_requests; g int;
begin
  perform priv.need_admin();
  select * into r from priv.pairing_requests where id = p_request and status = 'pending' for update;
  if not found then perform priv.err('NO_REQUEST', '요청을 찾을 수 없어요.'); end if;
  update priv.students set uid = null where uid = r.uid and id <> r.student_id;
  update priv.students set uid = r.uid, avatar = r.avatar, bound_at = now() where id = r.student_id returning group_id into g;
  update priv.pairing_requests set status = case when id = p_request then 'approved' else 'replaced' end
    where status = 'pending' and (id = p_request or student_id = r.student_id or uid = r.uid);
  perform priv.bump(g); perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

-- 모둠 일괄 승인 (p_group이 null이면 전체). 한 이름에 요청이 여러 개면 건너뜀(교사가 직접 확인)
create or replace function public.admin_approve_group(p_group int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare r record; n int := 0; skipped int := 0;
begin
  perform priv.need_admin();
  for r in
    select max(q.id) as id, q.student_id, count(*) as cnt
    from priv.pairing_requests q join priv.students s on s.id = q.student_id
    where q.status = 'pending' and (p_group is null or s.group_id = p_group)
    group by q.student_id
  loop
    if r.cnt > 1 then skipped := skipped + 1;
    else perform public.admin_approve(r.id); n := n + 1;
    end if;
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

-- 교사 시장 개입: 가상 주문 / 이벤트 / 게이지
create or replace function public.admin_event(p_kind text, p_product int, p_qty int, p_gauge numeric, p_message text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare mr int; eid int; g int;
begin
  perform priv.need_admin();
  mr := priv.market_round(priv.phase());
  if coalesce(p_qty, 0) > 0 then
    if mr is null then perform priv.err('PHASE', '가상 주문은 시장이 열려 있을 때만 넣을 수 있어요.'); end if;
    select group_id into g from priv.snapshots where round = mr and product_id = p_product;
    if not found then perform priv.err('BAD_PRODUCT', '이번 시장에서 팔고 있는 신발을 골라 주세요.'); end if;
  end if;
  insert into priv.events(kind, round, product_id, qty, gauge_delta, message)
    values (coalesce(p_kind, 'custom'), mr, p_product, coalesce(p_qty, 0), coalesce(p_gauge, 0), p_message)
    returning id into eid;
  if coalesce(p_qty, 0) > 0 then
    insert into priv.votes(round, product_id, qty, source, event_id) values (mr, p_product, p_qty, 'event', eid);
  end if;
  if coalesce(trim(p_message), '') <> '' then perform priv.notice(p_message, coalesce(p_kind, 'event')); end if;
  perform priv.bump_game();
  return jsonb_build_object('ok', true, 'event_id', eid);
end $$;

create or replace function public.admin_undo_event(p_event int) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare e priv.events;
begin
  perform priv.need_admin();
  select * into e from priv.events where id = p_event and status = 'active' for update;
  if not found then perform priv.err('NO_EVENT', '취소할 이벤트가 없어요.'); end if;
  if e.qty > 0 and exists(select 1 from priv.round_results where round = e.round) then
    perform priv.err('SETTLED', '이미 정산된 차수의 주문은 취소할 수 없어요.');
  end if;
  delete from priv.votes where event_id = e.id;
  update priv.events set status = 'undone' where id = e.id;
  perform priv.bump_game();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_grant(p_group int, p_amount int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g int;
begin
  perform priv.need_admin();
  for g in select id from priv.groups where p_group is null or id = p_group loop
    insert into priv.ledger(txn_key, group_id, round, kind, amount, perf, note)
      values ('admin:' || gen_random_uuid(), g, priv.work_round(priv.phase()), 'admin_grant', p_amount, false,
              coalesce(nullif(trim(p_reason), ''), '우주 운영진 지원금'));
    perform priv.bump(g);
  end loop;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_notice(p_message text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  perform priv.notice(p_message, 'info');
  return jsonb_build_object('ok', true);
end $$;

-- 리허설 후 게임 초기화 (명단은 유지, 기기 연결도 유지)
create or replace function public.admin_reset_game(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, priv as $$
declare g int;
begin
  perform priv.need_admin();
  if p_confirm <> '초기화' then perform priv.err('CONFIRM', '확인 문구가 달라요.'); end if;
  delete from priv.votes where true; delete from priv.vote_submissions where true; delete from priv.events where true;
  delete from priv.round_results where true; delete from priv.ledger where true; delete from priv.snapshots where true;
  delete from priv.slot_locks where true; delete from priv.products where true; delete from priv.principles where true;
  delete from public.notices where true;
  update priv.groups set company_name = null, logo_url = null, bg_url = null, bg_preset = 0, stands = '[]',
    slot_count = priv.s('slots_base')::int, has_research = false, has_factory = false,
    has_eco_research = false, has_purifier = false where true;
  update public.game set phase = 0, env_revealed = false, fast_travel = false where id = 1;
  perform priv.bump_game();
  for g in select id from priv.groups loop perform priv.bump(g); end loop;
  return jsonb_build_object('ok', true);
end $$;

-- 백업 내보내기 (전체 데이터 JSON)
create or replace function public.admin_export() returns jsonb
language plpgsql security definer set search_path = public, priv as $$
begin
  perform priv.need_admin();
  return jsonb_build_object(
    'exported_at', now(),
    'game', (select to_jsonb(g) from public.game g),
    'groups', (select jsonb_agg(to_jsonb(x)) from priv.groups x),
    'students', (select jsonb_agg(to_jsonb(x) - 'uid') from priv.students x),
    'products', (select jsonb_agg(to_jsonb(x)) from priv.products x),
    'snapshots', (select jsonb_agg(to_jsonb(x)) from priv.snapshots x),
    'ledger', (select jsonb_agg(to_jsonb(x)) from priv.ledger x),
    'votes', (select jsonb_agg(to_jsonb(x)) from priv.votes x),
    'events', (select jsonb_agg(to_jsonb(x)) from priv.events x),
    'round_results', (select jsonb_agg(to_jsonb(x)) from priv.round_results x),
    'principles', (select jsonb_agg(to_jsonb(x)) from priv.principles x));
end $$;

-- =====================================================================
-- 6. 권한: 화면에서는 public 함수만 호출 가능
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'priv' loop
    execute 'revoke all on function ' || f.sig || ' from public';
  end loop;
  begin execute 'revoke all on all tables in schema priv from anon, authenticated'; exception when others then null; end;
  begin execute 'grant select on public.game, public.notices, public.group_ticks to anon, authenticated'; exception when others then null; end;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'get_public','get_roster','join_student','get_me','my_state','lobby_update','slot_lock','slot_unlock',
             'product_save','product_cancel','product_retire','invest','market','votes_submit','report',
             'principle_submit','my_principles','get_board','admin_login','admin_check','admin_state','admin_set_phase',
             'admin_force_phase','admin_flags','admin_roster_import','admin_set_label','admin_set_leader',
             'admin_reset_binding','admin_approve','admin_approve_group','admin_reject','admin_event','admin_undo_event','admin_grant',
             'admin_notice','admin_reset_game','admin_export') loop
    begin execute 'grant execute on function ' || f.sig || ' to anon, authenticated'; exception when others then null; end;
  end loop;
end $$;

-- =====================================================================
-- 7. 이미지 저장소 (로고·판매홀 배경)
-- =====================================================================
do $$ begin
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('images', 'images', true, 3145728, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  on conflict (id) do nothing;
  execute 'drop policy if exists es_images_insert on storage.objects';
  execute $p$create policy es_images_insert on storage.objects for insert to authenticated
           with check (bucket_id = 'images')$p$;
  execute 'drop policy if exists es_images_read on storage.objects';
  execute $p$create policy es_images_read on storage.objects for select using (bucket_id = 'images')$p$;
exception when others then
  raise notice 'storage 설정 건너뜀: %', sqlerrm;
end $$;
