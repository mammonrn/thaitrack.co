-- บันทึกการค้นหาแบบ "ไม่ผูกกับผู้ใช้" + ฟังก์ชันสรุปตัวเลขให้หน้าสถิติแอดมิน
--
-- ------------------------------------------------------------------ --
-- ⚠️ ข้อบังคับด้านความเป็นส่วนตัวของตารางนี้ — อ่านก่อนแก้ไฟล์นี้ทุกครั้ง
--
-- ตารางนี้มีไว้ตอบคำถามแบบ "วันนี้มีคนค้นกี่ครั้ง" เท่านั้น
-- **ห้ามมีทางใดที่ทำให้ตอบได้ว่า "ผู้ใช้คนไหนค้นพัสดุอะไร"**
--
--   ห้ามเพิ่มคอลัมน์ user_id, email, ip, user_agent, session_id
--   ห้ามเพิ่มคอลัมน์ tracking_number — เลขพัสดุคือสิ่งที่ระบุตัวพัสดุของคนคนหนึ่ง
--   ห้ามสร้าง view หรือฟังก์ชันที่คืนแถวดิบออกไป — คืนได้เฉพาะตัวเลขรวม
--
-- เหตุผล: เลขพัสดุหนึ่งเลขผูกกับคนสองคนเสมอ (ผู้ส่งกับผู้รับ) ต่อให้ไม่เก็บ
-- ว่าใครค้น การเก็บเลขไว้พร้อมเวลาก็เอาไปเทียบกับ saved_trackings ได้
-- ตารางนี้จึงเก็บแค่ "ขนส่งอะไร ผลเป็นอย่างไร มาจากชั้นไหน เมื่อไร"
--
-- ประวัติการค้นที่ผูกกับผู้ใช้มีที่ของมันอยู่แล้วคือ public.saved_trackings
-- ซึ่งผู้ใช้กดบันทึกเอง เห็นได้เฉพาะเจ้าตัวผ่าน RLS และแอดมินก็ดูไม่ได้
-- ------------------------------------------------------------------ --

create table if not exists public.search_events (
  id bigint generated always as identity primary key,

  occurred_at timestamptz not null default now(),

  -- รหัสขนส่งของผลลัพธ์ เช่น "thailand-post" — null เมื่อค้นไม่เจอจึงไม่รู้ว่าเจ้าไหน
  carrier_code text,

  -- ผลของการค้นครั้งนี้
  outcome text not null,

  -- ชั้นที่ตอบ: memory | supabase | api | error (ตรงกับ ResolveSource ในโค้ด)
  source text not null,

  -- ผู้ให้บริการที่ตอบ: primary | fallback | backup | cache | none
  provider text not null,

  -- true = ข้อมูลหมดอายุแล้วแต่ถูกใช้เป็นคำตอบสำรองตอนขนส่งล่ม
  stale boolean not null default false,

  constraint search_events_outcome_check check (
    outcome in ('found', 'not_found', 'error')
  ),
  constraint search_events_source_check check (
    source in ('memory', 'supabase', 'api', 'error')
  ),
  constraint search_events_provider_check check (
    provider in ('primary', 'fallback', 'backup', 'cache', 'none')
  )
);

-- ทุก query ของหน้าสถิติกรองด้วยช่วงเวลาเสมอ
create index if not exists search_events_occurred_idx
  on public.search_events (occurred_at desc);

-- ------------------------------------------------------------------ --
-- ฟังก์ชันสรุป — คืนได้เฉพาะตัวเลขรวมเท่านั้น
--
-- ทุกตัวเป็น security invoker (ค่าเริ่มต้น) ยกเว้น admin_member_stats ที่ต้อง
-- อ่าน auth.users ซึ่งอธิบายเหตุผลไว้ตรงตัวมันเอง
--
-- p_days = 0 แปลว่า "ตั้งแต่ต้น" ไม่ใช่ "ศูนย์วัน" — หน้าสถิติต้องการทั้งยอด
-- สะสมทั้งหมดและยอดในช่วงล่าสุด การมีค่าพิเศษค่าเดียวดีกว่ามีสองฟังก์ชัน
-- ------------------------------------------------------------------ --

create or replace function public.admin_search_overview(p_days integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total',      count(*),
    'found',      count(*) filter (where outcome = 'found'),
    'not_found',  count(*) filter (where outcome = 'not_found'),
    'error',      count(*) filter (where outcome = 'error'),
    'from_cache', count(*) filter (where source in ('memory', 'supabase')),
    'from_api',   count(*) filter (where source = 'api'),
    'stale',      count(*) filter (where stale)
  )
  from public.search_events
  where p_days <= 0
     or occurred_at >= now() - make_interval(days => p_days);
$$;

/*
 * จำนวนการค้นหาแยกตามวัน (เวลาไทย) เรียงจากเก่าไปใหม่
 *
 * ตัดวันตาม Asia/Bangkok ไม่ใช่ UTC — ไม่งั้นการค้นตอนตีหนึ่งของไทยจะไปนับ
 * เป็นของเมื่อวาน ซึ่งทำให้กราฟไม่ตรงกับที่คนดูเข้าใจ
 */
create or replace function public.admin_search_daily(p_days integer)
returns table (day date, total bigint, found bigint)
language sql
stable
as $$
  select
    (occurred_at at time zone 'Asia/Bangkok')::date as day,
    count(*) as total,
    count(*) filter (where outcome = 'found') as found
  from public.search_events
  where occurred_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1
  order by 1;
$$;

/* ขนส่งที่ถูกค้นเจอบ่อยที่สุด — นับเฉพาะครั้งที่รู้ว่าเป็นเจ้าไหน */
create or replace function public.admin_top_carriers(
  p_days integer,
  p_limit integer
) returns table (carrier_code text, total bigint)
language sql
stable
as $$
  select carrier_code, count(*) as total
  from public.search_events
  where carrier_code is not null
    and (p_days <= 0 or occurred_at >= now() - make_interval(days => p_days))
  group by carrier_code
  order by count(*) desc, carrier_code
  limit greatest(coalesce(p_limit, 10), 1);
$$;

/*
 * จำนวนสมาชิก — ตัวเลขรวมล้วน
 *
 * ⚠️ ฟังก์ชันเดียวในโปรเจกต์ที่เป็น security definer
 *
 * จำเป็นเพราะ auth.users อยู่นอก schema public ที่ PostgREST เปิดให้ และสิทธิ์
 * ของ service_role บน schema auth ต่างกันไปตามการตั้งค่าของแต่ละโปรเจกต์
 * (เจอมาแล้วกับ permission denied ใน 0005) definer ทำให้ไม่ต้องพึ่งค่าที่
 * มองไม่เห็นจากในโค้ด
 *
 * ความเสี่ยงของ definer ถูกปิดสามชั้น:
 *   1. คืนได้แค่ count(*) — ไม่มีทางดึงแถว อีเมล หรือ id ของใครออกมาได้เลย
 *      ต่อให้ผู้เรียกเป็นใครก็ตาม
 *   2. set search_path = '' และเขียนชื่อเต็มทุกที่ กัน schema ปลอมมาสวมทับ
 *   3. revoke execute จาก public/anon/authenticated แล้ว grant ให้ service_role
 *      เท่านั้น (ท้ายไฟล์)
 */
create or replace function public.admin_member_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',   count(*),
    'new_7d',  count(*) filter (where created_at >= now() - interval '7 days'),
    'new_30d', count(*) filter (where created_at >= now() - interval '30 days')
  )
  from auth.users;
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับตารางของกลางอื่นทุกประการ
-- ------------------------------------------------------------------ --

revoke all on table public.search_events from anon, authenticated;

revoke all on function public.admin_search_overview(integer) from anon, authenticated, public;
revoke all on function public.admin_search_daily(integer) from anon, authenticated, public;
revoke all on function public.admin_top_carriers(integer, integer) from anon, authenticated, public;
revoke all on function public.admin_member_stats() from anon, authenticated, public;

-- ไม่ต้องให้สิทธิ์ delete — ไม่มีเส้นทางไหนในแอปที่ลบแถวของตารางนี้
grant select, insert on table public.search_events to service_role;

grant execute on function public.admin_search_overview(integer) to service_role;
grant execute on function public.admin_search_daily(integer) to service_role;
grant execute on function public.admin_top_carriers(integer, integer) to service_role;
grant execute on function public.admin_member_stats() to service_role;

alter table public.search_events enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- การกวาดของเก่า
--
-- ตารางนี้โตตามจำนวนการค้นหา จึงโตเร็วที่สุดในบรรดาตารางของกลาง หนึ่งแถว
-- กินไม่ถึง 100 ไบต์ แต่ถ้าวันหนึ่งอยากตัดของเก่าทิ้ง สถิติที่หน้าแอดมินใช้
-- ย้อนหลังแค่ 30 วัน (ยกเว้นยอดสะสมทั้งหมด) ตัดที่หนึ่งปีจึงปลอดภัย:
--
--   delete from public.search_events
--   where occurred_at < now() - interval '1 year';
-- ------------------------------------------------------------------ --
