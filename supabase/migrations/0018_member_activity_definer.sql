-- แก้ "permission denied for table saved_trackings" ของ admin_member_activity()
--
-- อาการ: การ์ด "การกลับมาใช้ซ้ำ" บน /admin/stats โชว์ 0 มาตลอด และ log ขึ้น
--
--   [search-events] อ่านการใช้งานของสมาชิก ล้มเหลว:
--   permission denied for table saved_trackings
--
-- สาเหตุ: admin_member_activity() (เพิ่มใน 0011) เป็นฟังก์ชันธรรมดา จึงรันด้วย
-- สิทธิ์ของ **ผู้เรียก** ซึ่งคือ service_role แต่ service_role ไม่เคยถูก grant
-- สิทธิ์บน public.saved_trackings เลย — ตารางนั้นถูกสร้างใน 0001 พร้อม RLS
-- สำหรับผู้ใช้ที่ล็อกอิน และไม่เคยอยู่ในรายการ grant ของ 0005 ที่ไล่ให้สิทธิ์
-- service_role กับ "ตารางของกลาง" (tracking_cache, carrier_branches,
-- unknown_branches, geocode_cache) เพราะ saved_trackings ไม่ใช่ของกลาง
--
-- ------------------------------------------------------------------ --
-- ⚠️ ทำไมถึงเลือก security definer แทนการ grant select ให้ service_role
--
-- grant จะได้ผลเหมือนกัน แต่เปิดกว้างเกินความจำเป็นอย่างมาก:
-- saved_trackings เป็นตารางเดียวในระบบที่เก็บ "ใครบันทึกพัสดุเลขอะไรไว้บ้าง"
-- ถ้า service_role อ่านทั้งตารางได้ โค้ดฝั่งเซิร์ฟเวอร์ทุกเส้นทางในอนาคตจะ
-- อ่านพัสดุของผู้ใช้ทุกคนได้ทันทีโดยไม่มีอะไรกั้น
--
-- ทั้งระบบตั้งใจเลี่ยงเรื่องนี้มาตลอด — /api/track อ่านตารางนี้ด้วย **session
-- ของผู้ใช้จริง** ไม่ใช่ service role เพื่อให้ RLS กรองเหลือแต่แถวของเจ้าตัว
-- (ดูคอมเมนต์ของ readSavedAt ใน app/api/track/route.ts) การ grant ตรงนี้จะ
-- ทำให้ด่านนั้นไม่มีความหมาย เพราะมีทางลัดเปิดอยู่ข้างๆ
--
-- definer ทำให้ฟังก์ชันเป็น "ประตูแคบ" ที่ยอมให้ผ่านเฉพาะตัวเลขนับ
-- service_role ยังอ่านตารางตรงๆ ไม่ได้เหมือนเดิม
--
-- ความเสี่ยงของ definer ถูกปิดสามชั้น เหมือน admin_member_stats() ใน 0007:
--   1. คืนได้แค่ count(*) — ไม่มีทางดึงแถว, user_id หรือเลขพัสดุออกมาได้เลย
--      ต่อให้ผู้เรียกเป็นใครก็ตาม
--   2. set search_path = '' และเขียนชื่อเต็มทุกที่ กัน schema ปลอมมาสวมทับ
--   3. revoke execute จาก public/anon/authenticated แล้ว grant ให้ service_role
--      เท่านั้น (ท้ายไฟล์)
--
-- 📝 คอมเมนต์ใน 0007 ที่เขียนว่า admin_member_stats เป็น "ฟังก์ชันเดียวใน
-- โปรเจกต์ที่เป็น security definer" ใช้ไม่ได้แล้วตั้งแต่ไฟล์นี้ — ตอนนี้มีสองตัว
-- และทั้งคู่อยู่ใต้กติกาสามชั้นเดียวกัน
-- ------------------------------------------------------------------ --

-- เนื้อในเหมือน 0011 ทุกบรรทัด เปลี่ยนแค่ security definer + search_path
-- (ชื่อตารางเขียนเต็มอยู่แล้วตั้งแต่ 0011 จึงไม่ต้องแก้อะไรในตัว query)
create or replace function public.admin_member_activity()
returns jsonb
language sql
stable
security definer
set search_path = ''
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
-- สิทธิ์ — ต้องรันซ้ำหลัง create or replace เสมอ
--
-- create or replace ไม่ได้ล้างสิทธิ์เดิมทิ้งก็จริง แต่เขียนย้ำไว้ให้ไฟล์นี้
-- อ่านจบแล้วรู้สถานะสุดท้ายได้เลย โดยไม่ต้องไปไล่ย้อน 0011
--
-- ⚠️ ห้าม grant สิทธิ์บนตาราง saved_trackings ให้ service_role เด็ดขาด —
-- นั่นคือสิ่งที่ไฟล์นี้ตั้งใจเลี่ยง (ดูเหตุผลข้างบน)
-- ------------------------------------------------------------------ --

revoke all on function public.admin_member_activity() from public, anon, authenticated;

grant execute on function public.admin_member_activity() to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
-- 1. ฟังก์ชันต้องทำงานได้แล้ว (เดิมจะได้ permission denied)
--
--      select public.admin_member_activity();
--
--    ควรได้ jsonb 4 คีย์ เช่น
--      {"active_7d": 1, "active_prev_7d": 0, "returned": 0, "saves_7d": 19}
--
-- 2. ยืนยันว่าเป็น definer จริง และ search_path ถูกล็อกไว้
--
--      select p.proname, p.prosecdef, p.proconfig
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'admin_member_activity';
--
--    prosecdef ต้องเป็น t และ proconfig ต้องมี search_path=
--
-- 3. ยืนยันว่า **ไม่ได้** เผลอเปิดตารางให้ service_role
--
--      select grantee, privilege_type
--      from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'saved_trackings';
--
--    ต้องไม่มีแถวของ service_role เลย (ผลลัพธ์ว่างคือถูกต้อง)
--
-- 4. เปิด /admin/stats แล้วดูการ์ด "การกลับมาใช้ซ้ำ" ว่าไม่เป็น 0 ทั้งแถบแล้ว
--    และ log ต้องไม่มี "[search-events] อ่านการใช้งานของสมาชิก ล้มเหลว" อีก
-- ------------------------------------------------------------------ --
