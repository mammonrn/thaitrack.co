-- รายละเอียดเพิ่มเติมสำหรับหน้าสถิติ — สาเหตุข้อผิดพลาด ความเร็ว และการติดตั้งแอพ
--
-- ปัญหาที่แก้: หน้าสถิติบอกได้แค่ "ระบบขัดข้อง 2 ครั้ง" ซึ่งไม่พอจะทำอะไรต่อ
-- วันที่ API key ของไปรษณีย์ไทยเพี้ยน เราต้องไปงมใน pm2 log กว่าจะรู้ว่าเป็น
-- auth_failed ทั้งที่ตัวเลขนั้นควรอยู่บนหน้าสถิติตั้งแต่แรก
--
-- ------------------------------------------------------------------ --
-- ⚠️ ข้อบังคับด้านความเป็นส่วนตัวยังเหมือนเดิมทุกประการ (ดู 0007)
--
-- ทุกอย่างที่เพิ่มในไฟล์นี้เป็น **คุณสมบัติของคำขอ** ไม่ใช่ของคน:
--   reason / upstream_code  สาเหตุที่ระบบตอบไม่ได้
--   took_ms                 ใช้เวลากี่มิลลิวินาที
--   install_events          มีคนติดตั้งแอพกี่ครั้ง (ไม่รู้ว่าใคร)
--
-- ยังไม่มี user_id ไม่มีอีเมล ไม่มีเลขพัสดุ ทุกฟังก์ชันคืนได้แค่ตัวเลขรวม
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. รายละเอียดของแต่ละคำขอ
-- ------------------------------------------------------------------ --

alter table public.search_events
  add column if not exists reason text;

alter table public.search_events
  add column if not exists upstream_code text;

alter table public.search_events
  add column if not exists took_ms integer;

do $$
begin
  alter table public.search_events
    add constraint search_events_took_ms_check
    check (took_ms is null or took_ms >= 0);
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------ --
-- 2. การติดตั้งแอพ (PWA)
--
-- หนึ่งแถวต่อหนึ่งครั้งที่เบราว์เซอร์ยิง event `appinstalled` — เป็นสัญญาณเดียว
-- ที่บอกได้ว่ามีคนติดตั้งจริง (การเช็ค display-mode: standalone ตอนเปิดหน้าจะนับ
-- ซ้ำทุกครั้งที่เปิดแอพ ไม่ใช่จำนวนการติดตั้ง)
--
-- ⚠️ endpoint ที่เขียนตารางนี้ไม่ต้องล็อกอิน จึงยิงปลอมได้ ตัวเลขนี้เป็น
-- "อย่างมากเท่านี้" ไม่ใช่ยอดที่เอาไปอ้างอิงแบบเป็นทางการได้ ยอมรับได้เพราะ
-- มันเป็นตัวเลขสำหรับตัดสินใจภายใน ไม่ใช่ตัวเลขที่มีใครได้ประโยชน์จากการปลอม
--
-- ตั้งใจไม่เก็บ IP หรือ user agent เต็ม — platform เก็บแค่คำกว้างๆ ที่ฝั่งแอป
-- แปลงมาให้แล้ว (android / ios / desktop / unknown) ซึ่งไม่ช่วยระบุตัวใครได้
-- ------------------------------------------------------------------ --

create table if not exists public.install_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  platform text not null default 'unknown',

  constraint install_events_platform_check check (
    platform in ('android', 'ios', 'desktop', 'unknown')
  )
);

create index if not exists install_events_occurred_idx
  on public.install_events (occurred_at desc);

-- ------------------------------------------------------------------ --
-- 3. ฟังก์ชันสรุป — คืนได้เฉพาะตัวเลขรวมเท่านั้น
-- ------------------------------------------------------------------ --

/* สาเหตุที่ระบบตอบไม่ได้ แยกตามชนิด เรียงจากที่เจอบ่อยสุด */
create or replace function public.admin_error_breakdown(p_days integer)
returns table (reason text, upstream_code text, total bigint)
language sql
stable
as $$
  select
    coalesce(reason, 'unknown') as reason,
    upstream_code,
    count(*) as total
  from public.search_events
  where outcome in ('error', 'not_found')
    and (p_days <= 0 or occurred_at >= now() - make_interval(days => p_days))
  group by 1, 2
  order by count(*) desc, 1
  limit 20;
$$;

/*
 * ความเร็วแยกตามชั้นที่ตอบ
 *
 * p95 สำคัญกว่า p50 มากสำหรับหน้านี้ — ค่ากลางบอกว่า "ปกติเร็วแค่ไหน" แต่ค่าที่
 * ผู้ใช้จำได้คือครั้งที่ช้า ซึ่งอยู่ที่หาง
 */
create or replace function public.admin_latency(p_days integer)
returns table (source text, p50_ms integer, p95_ms integer, total bigint)
language sql
stable
as $$
  select
    source,
    round(percentile_cont(0.5) within group (order by took_ms))::integer as p50_ms,
    round(percentile_cont(0.95) within group (order by took_ms))::integer as p95_ms,
    count(*) as total
  from public.search_events
  where took_ms is not null
    and (p_days <= 0 or occurred_at >= now() - make_interval(days => p_days))
  group by source
  order by count(*) desc;
$$;

/* จำนวนการติดตั้งแอพ */
create or replace function public.admin_install_stats()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total',   count(*),
    'last_7d', count(*) filter (where occurred_at >= now() - interval '7 days'),
    'last_30d', count(*) filter (where occurred_at >= now() - interval '30 days'),
    'android', count(*) filter (where platform = 'android'),
    'ios',     count(*) filter (where platform = 'ios'),
    'desktop', count(*) filter (where platform = 'desktop')
  )
  from public.install_events;
$$;

/*
 * การกลับมาใช้ซ้ำของสมาชิก — วัดจาก **การบันทึกพัสดุ** ไม่ใช่การค้นหา
 *
 * ⚠️ นี่คือข้อจำกัดที่ตั้งใจ ไม่ใช่ความมักง่าย
 *
 * search_events ตั้งใจไม่มี user_id (ดู 0007) จึงตอบไม่ได้ว่าใครกลับมาค้นซ้ำ
 * และเราจะไม่เพิ่ม user_id เข้าไปเพื่อตอบคำถามนี้ เพราะนั่นคือการยกเลิกคำสัญญา
 * ข้อเดียวที่ทั้งระบบยึดไว้
 *
 * สิ่งที่ตอบได้โดยไม่ผิดคำสัญญาคือการบันทึกพัสดุ ซึ่งเป็นการกระทำที่ผู้ใช้ตั้งใจ
 * ผูกกับบัญชีตัวเองอยู่แล้ว (saved_trackings มี user_id มาตั้งแต่ 0001 พร้อม RLS)
 * ตัวเลขที่ได้จึงต่ำกว่าความจริงเสมอ เพราะคนที่ค้นแล้วไม่บันทึกไม่ถูกนับ —
 * หน้าสถิติต้องเขียนกำกับไว้ให้ชัด ห้ามเรียกมันว่า "คนที่กลับมาค้นหา"
 *
 * คืนแต่ตัวเลขนับ ไม่มีทางดึง user_id ออกมาได้
 */
create or replace function public.admin_member_activity()
returns jsonb
language sql
stable
as $$
  with recent as (
    select distinct user_id
    from public.saved_trackings
    where created_at >= now() - interval '7 days'
  ),
  previous as (
    select distinct user_id
    from public.saved_trackings
    where created_at >= now() - interval '14 days'
      and created_at < now() - interval '7 days'
  )
  select jsonb_build_object(
    'active_7d',      (select count(*) from recent),
    'active_prev_7d', (select count(*) from previous),
    'returned',       (select count(*) from previous p
                       where exists (select 1 from recent r where r.user_id = p.user_id)),
    'saves_7d',       (select count(*) from public.saved_trackings
                       where created_at >= now() - interval '7 days')
  );
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับตารางของกลางอื่นทุกประการ
-- ------------------------------------------------------------------ --

revoke all on table public.install_events from anon, authenticated;

revoke all on function public.admin_error_breakdown(integer) from anon, authenticated, public;
revoke all on function public.admin_latency(integer) from anon, authenticated, public;
revoke all on function public.admin_install_stats() from anon, authenticated, public;
revoke all on function public.admin_member_activity() from anon, authenticated, public;

grant select, insert on table public.install_events to service_role;

grant execute on function public.admin_error_breakdown(integer) to service_role;
grant execute on function public.admin_latency(integer) to service_role;
grant execute on function public.admin_install_stats() to service_role;
grant execute on function public.admin_member_activity() to service_role;

alter table public.install_events enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_member_activity();
--   select * from public.admin_error_breakdown(30);
--   select * from public.admin_latency(30);
--   select public.admin_install_stats();
-- ------------------------------------------------------------------ --
