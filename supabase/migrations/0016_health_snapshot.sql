-- สรุปสถานะระบบในช่วงสั้นๆ สำหรับ endpoint ที่ uptime monitor ยิงถาม
--
-- ปัญหาที่แก้: monitor ที่มีอยู่จับได้แค่ "เว็บล่ม" แต่จับ "เว็บทำงานแต่ตอบ
-- ไม่ได้" ไม่ได้เลย — วันที่ API key ของขนส่งเพี้ยน เว็บยังตอบ 200 ทุกหน้า
-- แต่ค้นอะไรก็ไม่เจอ ซึ่งเป็นสถานการณ์ที่ควรปลุกเราที่สุดกลับเงียบที่สุด
--
-- ------------------------------------------------------------------ --
-- ⚠️ ความเป็นส่วนตัวเหมือนเดิมทุกประการ (ดู 0007)
--
-- ฟังก์ชันนี้คืนแค่ตัวนับรวมของช่วงเวลา ไม่มี user_id ไม่มีเลขพัสดุ
-- และ endpoint ที่เรียกมันก็ไม่ส่งตัวเลขพวกนี้ออกไปให้ใครเห็น (ดู
-- app/api/health/tracking/route.ts) — ตัวเลขถูกใช้ตัดสิน 200/503 เท่านั้น
-- ------------------------------------------------------------------ --

/*
 * ยอดรวมของคำค้นในกี่นาทีล่าสุด
 *
 * p_minutes เป็นพารามิเตอร์เพราะหน้าต่างที่เหมาะสมขึ้นกับปริมาณคนใช้จริง
 * ซึ่งจะเปลี่ยนไปเรื่อยๆ — ตั้งจากฝั่งแอปผ่าน env ได้โดยไม่ต้องแก้ฟังก์ชัน
 */
create or replace function public.admin_health_snapshot(p_minutes integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total',     count(*),
    'found',     count(*) filter (where outcome = 'found'),
    'not_found', count(*) filter (where outcome = 'not_found'),
    'error',     count(*) filter (where outcome = 'error')
  )
  from public.search_events
  where occurred_at >= now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 1));
$$;

revoke all on function public.admin_health_snapshot(integer) from anon, authenticated, public;

grant execute on function public.admin_health_snapshot(integer) to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_health_snapshot(30);
-- ------------------------------------------------------------------ --
