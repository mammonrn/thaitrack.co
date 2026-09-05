-- ------------------------------------------------------------------ --
-- ตัวเลขของปุ่ม "ลองอีกครั้ง" สำหรับหน้าสถิติ
--
-- returns jsonb การเพิ่ม key จึงไม่เปลี่ยนลายเซ็นของฟังก์ชัน โค้ดเก่าที่ยัง
-- ไม่รู้จัก key ใหม่อ่านผ่านไปเฉยๆ (toCount คืน 0 ให้ key ที่ไม่มี)
--
-- ── สามตัวเลขที่ต้องอ่านคู่กันเสมอ ────────────────────────────────
--   retry_shown     ปุ่มถูกแสดงกี่ครั้ง = จำนวน upstream_error
--   retry_clicked   กดกี่ครั้ง
--   retry_recovered กดแล้วได้คำตอบกี่ครั้ง
--
-- ถ้า clicked ต่ำเทียบกับ shown → ปุ่มไม่ชวนให้กด (ถ้อยคำหรือตำแหน่งมีปัญหา)
-- ถ้า recovered ต่ำเทียบกับ clicked → เรากำลังให้ความหวังลมๆ แล้งๆ ต้องหาทางอื่น
--
-- ⚠️ ตัวเลขพวกนี้คือสิ่งเดียวที่จะบอกได้ว่าควรเก็บปุ่มไว้ ปรับ หรือถอดทิ้ง
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
    'not_found_cached',
      count(*) filter (
        where outcome = 'not_found' and source in ('memory', 'supabase')
      ),
    'error',      count(*) filter (where outcome = 'error'),
    'from_cache', count(*) filter (where source in ('memory', 'supabase')),
    'from_api',   count(*) filter (where source = 'api'),
    'stale',      count(*) filter (where stale),

    -- ปุ่ม "ลองอีกครั้ง" — แสดง / กด / สำเร็จ
    'retry_shown',     count(*) filter (where reason = 'upstream_error'),
    'retry_clicked',   count(*) filter (where retried),
    'retry_recovered', count(*) filter (where retried and outcome = 'found')
  )
  from public.search_events
  where p_days <= 0
     or occurred_at >= now() - make_interval(days => p_days);
$$;

revoke all on function public.admin_search_overview(integer)
  from public, anon, authenticated;

grant execute on function public.admin_search_overview(integer) to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_search_overview(7);
--
-- ต้องมี key ใหม่สามตัว และต้องเป็นจริงเสมอว่า
--   retry_recovered <= retry_clicked
--
-- ก่อน deploy โค้ดใหม่ retry_clicked ต้องเป็น 0 พอดี เพราะยังไม่มีปุ่มให้กด
-- — ใช้ข้อนี้ยืนยันว่าปุ่มเริ่มถูกใช้เมื่อไร
-- ------------------------------------------------------------------ --
