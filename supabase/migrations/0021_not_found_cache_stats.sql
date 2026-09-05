-- ------------------------------------------------------------------ --
-- แยกให้เห็นว่า "ไม่พบเลขนี้" มาจาก cache หรือจากการยิงขนส่งจริง
--
-- ตั้งแต่มี cache ของคำตอบ "ไม่พบ" (lib/not-found-cache.ts) การค้นเลขเดิมซ้ำ
-- ภายใน 10 นาทีจะถูกตอบจากความจำโดยไม่ยิงขนส่งเลย /api/track บันทึกกรณีนั้นเป็น
-- source = 'memory' + provider = 'cache' ซึ่งเป็นค่าชุดเดียวกับขาที่ค้นเจอแล้ว
-- ตอบจาก cache — จึงไม่ต้องแก้ CHECK constraint ของตารางเลย
--
-- แต่ถ้าไม่นับแยก เราจะวัดไม่ได้ว่า cache ตัวนี้ช่วยได้จริงแค่ไหน: ยอด not_found
-- รวมจะเท่าเดิมทุกประการไม่ว่า cache จะทำงานหรือไม่ ต่างกันแค่ตรงที่มันไปโผล่
-- ในช่อง from_cache แทน from_api ซึ่งอ่านแยกจากกันไม่ออก
--
-- ⚠️ ทำไมแก้ admin_search_overview ได้ตรงๆ ไม่เหมือน admin_search_efficiency
-- ตัวนี้ returns jsonb การเพิ่ม key ไม่ได้เปลี่ยนลายเซ็นของฟังก์ชัน create or
-- replace จึงทำได้ทันที และโค้ดเก่าที่ยังไม่รู้จัก key ใหม่ก็อ่านผ่านไปเฉยๆ
-- (ดู toCount ใน lib/supabase/search-events.ts ที่คืน 0 ให้ key ที่ไม่มี)
-- ลำดับ migration กับ deploy จึงสลับกันได้โดยไม่มีช่วงที่หน้าสถิติพัง
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
    -- ในจำนวน not_found ข้างบน มีกี่ครั้งที่ตอบจากความจำโดยไม่ยิงขนส่งเลย
    -- ส่วนที่เหลือ (not_found - not_found_cached) คือครั้งที่วิ่งครบทั้งสาย
    'not_found_cached',
      count(*) filter (
        where outcome = 'not_found' and source in ('memory', 'supabase')
      ),
    'error',      count(*) filter (where outcome = 'error'),
    'from_cache', count(*) filter (where source in ('memory', 'supabase')),
    'from_api',   count(*) filter (where source = 'api'),
    'stale',      count(*) filter (where stale)
  )
  from public.search_events
  where p_days <= 0
     or occurred_at >= now() - make_interval(days => p_days);
$$;

-- สิทธิ์ไม่เปลี่ยน — create or replace ไม่ล้าง grant ของเดิม แต่ประกาศซ้ำไว้
-- ให้ไฟล์นี้อ่านจบได้ในตัวเอง โดยไม่ต้องย้อนไปดู 0007
revoke all on function public.admin_search_overview(integer)
  from public, anon, authenticated;

grant execute on function public.admin_search_overview(integer) to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_search_overview(14);
--
-- ต้องมี key ชื่อ not_found_cached โผล่มา และต้องเป็นจริงเสมอว่า
--   not_found_cached <= not_found
--
-- ก่อน deploy โค้ดใหม่ ค่านี้ต้องเป็น 0 พอดี เพราะยังไม่มีอะไรเขียน
-- not_found ด้วย source = 'memory' — ใช้ข้อนี้ยืนยันว่า cache เริ่มทำงานเมื่อไร
-- ------------------------------------------------------------------ --
