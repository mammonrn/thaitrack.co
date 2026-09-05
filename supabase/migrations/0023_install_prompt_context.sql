-- ------------------------------------------------------------------ --
-- แยกให้เห็นว่าการ์ดชวนติดตั้งขึ้นตอนผู้ใช้ค้นเจอ หรือตอนค้นไม่เจอ
--
-- ── ทำไมต้องแยก ──────────────────────────────────────────────────
-- เดิมการ์ดขึ้นเฉพาะตอนค้นเจอ ตอนนี้ขึ้นตอนค้นไม่เจอด้วย เพราะคนที่เลขยังไม่
-- ขึ้นระบบขนส่ง **ต้องกลับมาค้นเลขเดิมอีกครั้งใน 1–2 ชั่วโมงแน่นอน** ซึ่งเป็น
-- สถานการณ์ที่การเปิดจากหน้าจอหลักช่วยได้ตรงตัวกว่าตอนค้นเจอเสียอีก
--
-- แต่ถ้านับรวมกัน เราจะไม่มีทางรู้ว่าจังหวะไหนได้ผลกว่ากัน และถ้าอัตราการกด
-- ตกลงหลังเพิ่มจังหวะใหม่ เราจะแยกไม่ออกว่าเป็นเพราะจังหวะใหม่ห่วย หรือเพราะ
-- จำนวนคนที่เห็นเพิ่มขึ้นเฉยๆ — ตัวเลขรวมตัวเดียวตอบสองคำถามนี้ไม่ได้
--
-- ⚠️ ข้อบังคับความเป็นส่วนตัวเหมือนเดิมทุกประการ (ดู 0007 และ 0013)
-- คอลัมน์นี้มีค่าได้แค่สองค่าที่บอกว่า "การค้นครั้งนั้นได้คำตอบแบบไหน" ซึ่งเป็น
-- คุณสมบัติของคำขอ ไม่ได้บอกอะไรเกี่ยวกับคนที่ค้น และไม่ผูกกับคำขออื่นของเขา
--
-- ⚠️ default 'found' ไม่ใช่ null โดยตั้งใจ — แถวเก่าทั้งหมดเกิดในยุคที่การ์ด
-- ขึ้นได้เฉพาะตอนค้นเจอเท่านั้น 'found' จึงเป็นค่าที่ถูกต้องจริงๆ ของแถวเหล่านั้น
-- ไม่ใช่การเดา · และเบราว์เซอร์ที่ยัง cache โค้ดเก่าไว้ก็ยังส่งของที่นับรวมได้
-- ------------------------------------------------------------------ --

alter table public.install_prompt_events
  add column if not exists context text not null default 'found';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'install_prompt_events_context_check'
  ) then
    alter table public.install_prompt_events
      add constraint install_prompt_events_context_check
      check (context in ('found', 'not_found'));
  end if;
end $$;

comment on column public.install_prompt_events.context is
  'ผู้ใช้เพิ่งค้นเจอ (found) หรือค้นไม่เจอ (not_found) ก่อนการ์ดจะขึ้น · แถวก่อน 2026-09 เป็น found ทั้งหมดตามพฤติกรรมเดิม';

-- ------------------------------------------------------------------ --
-- funnel เดิม + แยกตามบริบท
--
-- returns jsonb เหมือนเดิม การเพิ่ม key จึงไม่เปลี่ยนลายเซ็น และโค้ดเก่าที่ยัง
-- ไม่รู้จัก key ใหม่อ่านผ่านไปเฉยๆ (toCount คืน 0 ให้ key ที่ไม่มี)
-- ------------------------------------------------------------------ --

create or replace function public.admin_install_prompt_stats(p_days integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'shown',     count(*) filter (where action = 'shown'),
    'dismissed', count(*) filter (where action = 'dismissed'),
    'clicked',   count(*) filter (where action = 'clicked'),

    -- ตอนค้นเจอ
    'shown_found',       count(*) filter (where action = 'shown'     and context = 'found'),
    'clicked_found',     count(*) filter (where action = 'clicked'   and context = 'found'),
    'dismissed_found',   count(*) filter (where action = 'dismissed' and context = 'found'),

    -- ตอนค้นไม่เจอ — จังหวะใหม่ที่เพิ่งเพิ่ม
    'shown_not_found',     count(*) filter (where action = 'shown'     and context = 'not_found'),
    'clicked_not_found',   count(*) filter (where action = 'clicked'   and context = 'not_found'),
    'dismissed_not_found', count(*) filter (where action = 'dismissed' and context = 'not_found')
  )
  from public.install_prompt_events
  where p_days <= 0
     or occurred_at >= now() - make_interval(days => p_days);
$$;

revoke all on function public.admin_install_prompt_stats(integer)
  from public, anon, authenticated;

grant execute on function public.admin_install_prompt_stats(integer) to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_install_prompt_stats(30);
--
-- ต้องเป็นจริงเสมอว่า shown = shown_found + shown_not_found
-- และก่อน deploy โค้ดใหม่ shown_not_found ต้องเป็น 0 พอดี
-- ------------------------------------------------------------------ --
