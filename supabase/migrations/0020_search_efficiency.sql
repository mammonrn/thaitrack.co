-- รายวัน: ค้นหากี่ครั้ง เทียบกับ "ยิง API จริง" กี่ครั้ง
--
-- ปัญหาที่แก้: หน้าสถิติตอบไม่ได้ว่า "ค้นหาเยอะขึ้นแล้วโควตาใช้คุ้มไหม"
-- admin_search_daily() คืนแค่ total กับ found ส่วนยอดโควตาใน provider_usage
-- ก็เทียบรายวันไม่ได้ เพราะแต่ละเจ้าใช้คีย์รอบบิลคนละแบบ (ดู 0015):
--
--   ไปรษณีย์ไทย  รายวัน      '2026-09-04'
--   Track123     รายเดือน    '2026-08-29'
--   ETrackings   ไม่รีเซ็ต   'lifetime'
--
-- Track123 กับ ETrackings จึงมีแต่ยอดสะสม ไม่มียอดรายวันให้เทียบ
--
-- ------------------------------------------------------------------ --
-- แหล่งข้อมูลที่ถูกต้องคือ search_events ไม่ใช่ provider_usage
--
-- search_events มีคอลัมน์ source อยู่แล้วตั้งแต่ 0007 ซึ่งบอกตรงๆ ว่าคำค้นนั้น
-- ถูกตอบด้วยอะไร:
--
--   memory / supabase  ตอบจาก cache — ไม่ได้ยิงใครเลย ไม่เสียโควตา
--   api                ยิงถามขนส่งจริง — เสียโควตา
--   error              ล้มก่อนได้คำตอบ
--
-- นับจากตรงนี้จึงได้ "โควตาที่ใช้จริงต่อวัน" ที่เทียบกับจำนวนค้นหาได้ตรงๆ
-- โดยไม่ต้องมีตารางใหม่และไม่ต้องเก็บอะไรเพิ่ม
--
-- ⚠️ ข้อบังคับความเป็นส่วนตัวเหมือนเดิมทุกประการ — ฟังก์ชันนี้คืนแต่ตัวเลขนับ
-- ต่อวัน ไม่มี user id ไม่มี IP ไม่มีเลขพัสดุ และ search_events เองก็ไม่เคย
-- เก็บสามอย่างนั้นอยู่แล้ว (ดูข้อบังคับใน 0007)
--
-- ⚠️ ทำไมเป็นฟังก์ชันชื่อใหม่ ไม่ใช่แก้ admin_search_daily
-- create or replace เปลี่ยน returns table ของฟังก์ชันเดิมไม่ได้ ต้อง drop ก่อน
-- ซึ่งจะทำให้หน้าสถิติพังในช่วงระหว่างรัน migration กับ deploy โค้ดใหม่
-- ฟังก์ชันเดิมยังถูกใช้อยู่และไม่ได้ถูกแตะเลย
-- ------------------------------------------------------------------ --

create or replace function public.admin_search_efficiency(p_days integer)
returns table (
  day date,
  total bigint,
  from_api bigint,
  from_cache bigint,
  failed bigint
)
language sql
stable
as $$
  select
    (occurred_at at time zone 'Asia/Bangkok')::date as day,
    count(*) as total,
    count(*) filter (where source = 'api') as from_api,
    count(*) filter (where source in ('memory', 'supabase')) as from_cache,
    count(*) filter (where source = 'error') as failed
  from public.search_events
  where occurred_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1
  order by 1;
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับฟังก์ชันสถิติตัวอื่นทุกตัว
-- ------------------------------------------------------------------ --

revoke all on function public.admin_search_efficiency(integer)
  from public, anon, authenticated;

grant execute on function public.admin_search_efficiency(integer) to service_role;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select * from public.admin_search_efficiency(30);
--
-- ควรได้หนึ่งแถวต่อวัน และทุกแถวต้องเป็นจริงว่า
--   total = from_api + from_cache + failed
--
-- ตรวจข้อนั้นด้วย query เดียว (ต้องได้ 0 แถว):
--
--   select * from public.admin_search_efficiency(30)
--   where total <> from_api + from_cache + failed;
-- ------------------------------------------------------------------ --
