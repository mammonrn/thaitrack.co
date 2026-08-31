-- ให้สิทธิ์ service_role กับตารางของกลางแบบ "เขียนไว้ชัดๆ" ไม่พึ่งค่าเริ่มต้น
--
-- ปัญหาที่แก้: หลัง deploy #13 บน production ทุกการเข้าถึงตารางของกลางถูกปฏิเสธ
--
--   [track-cache] อ่าน ... ล้มเหลว: permission denied for table tracking_cache
--   [locations] บันทึกสาขาที่ไม่รู้จัก ล้มเหลว: permission denied for function record_unknown_branch
--
-- ผลคือ cache ถาวรไม่เคยทำงานเลย (tracking_cache มี 0 แถว) หน้า /admin/branches
-- ว่างเปล่า และแผนที่ไม่ขึ้นเพราะอ่าน carrier_branches ไม่ได้
--
-- ------------------------------------------------------------------ --
-- ทำไมถึงเกิดขึ้นได้ทั้งที่ migration ก่อนหน้าไม่ได้ revoke สิทธิ์ service_role
--
-- เพราะ migration 0003/0004 ไม่เคย **grant** ให้ service_role เลยเหมือนกัน —
-- มันอาศัยว่า Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ตารางใหม่ทุกตารางใน
-- schema public ถูก grant ให้ service_role โดยอัตโนมัติ
--
-- ข้อสันนิษฐานนั้นไม่จริงเสมอไป โปรเจกต์นี้ปิด auto-expose ของ PostgREST ไว้
-- (ดูหมายเหตุใน 0002) โปรเจกต์ที่ตั้งค่าแบบรัดกุมแบบนี้มักถอด default
-- privileges ออกด้วย ตารางใหม่จึงไม่มีใครได้สิทธิ์เลย รวมถึง service_role
--
-- ส่วนฟังก์ชันมีปัญหาชัดกว่านั้นอีก: PostgreSQL ให้ EXECUTE กับ PUBLIC เป็น
-- ค่าเริ่มต้น ซึ่ง service_role ก็ได้สิทธิ์ผ่านทางนั้น พอ 0004 สั่ง
--   revoke all on function ... from public;
-- สิทธิ์ที่ service_role ได้มาทางอ้อมก็หายไปด้วย ถ้าไม่มี grant ตรงๆ มารองรับ
--
-- ไฟล์นี้จึงเขียน grant ให้ service_role ตรงๆ ไม่ฝากความหวังไว้กับค่าเริ่มต้น
-- ของ Supabase ที่เปลี่ยนได้และมองไม่เห็นจากในโค้ด
--
-- ⚠️ ไฟล์นี้ **ไม่ได้ผ่อนเกราะของ anon/authenticated เลยแม้แต่น้อย**
-- สองบทบาทนั้นยังถูก revoke เหมือนเดิม (และย้ำอีกครั้งท้ายไฟล์) ที่เพิ่มคือ
-- สิทธิ์ของ service_role ซึ่งเป็นบทบาทฝั่งเซิร์ฟเวอร์ที่ข้าม RLS ได้อยู่แล้ว
--
-- รันซ้ำได้ปลอดภัย ทุกคำสั่งเป็น idempotent
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. สิทธิ์บนตารางของกลางทั้งสี่
--
-- select/insert/update/delete ครบ เพราะทุกตารางถูกทั้งอ่านและเขียนจริง:
--   tracking_cache    อ่าน+upsert ทุกครั้งที่ค้นหา
--   carrier_branches  อ่านตอนหาพิกัด + upsert จากหน้าแอดมิน
--   unknown_branches  เขียนผ่านฟังก์ชัน + อ่าน/ลบจากหน้าแอดมิน
--   geocode_cache     อ่าน+upsert ตอนหาพิกัด
-- ------------------------------------------------------------------ --

grant select, insert, update, delete on table public.tracking_cache to service_role;
grant select, insert, update, delete on table public.carrier_branches to service_role;
grant select, insert, update, delete on table public.unknown_branches to service_role;
grant select, insert, update, delete on table public.geocode_cache to service_role;

-- ------------------------------------------------------------------ --
-- 2. สิทธิ์เรียกฟังก์ชันนับสาขาที่ไม่รู้จัก
--
-- ต้องมาหลัง revoke from public ของ 0004 เสมอ ไม่งั้นจะถูกถอนทิ้ง
-- ------------------------------------------------------------------ --

grant execute on function public.record_unknown_branch(text, text, text) to service_role;

-- ------------------------------------------------------------------ --
-- 3. ย้ำเกราะเดิม — anon กับ authenticated ยังต้องไม่มีสิทธิ์อะไรทั้งสิ้น
--
-- เขียนซ้ำที่นี่ด้วยสองเหตุผล: กันกรณีที่มีใครเผลอ grant กว้างๆ ทับไประหว่างทาง
-- และทำให้ไฟล์นี้อ่านจบแล้วเห็นภาพสิทธิ์ทั้งหมดโดยไม่ต้องเปิดไฟล์ก่อนหน้า
-- ------------------------------------------------------------------ --

revoke all on table public.tracking_cache from anon, authenticated;
revoke all on table public.carrier_branches from anon, authenticated;
revoke all on table public.unknown_branches from anon, authenticated;
revoke all on table public.geocode_cache from anon, authenticated;

revoke all on function public.record_unknown_branch(text, text, text) from anon, authenticated;

-- RLS ยังเปิดอยู่และยังไม่มี policy ใดๆ เหมือนเดิม (service_role ข้าม RLS ได้)
alter table public.tracking_cache enable row level security;
alter table public.carrier_branches enable row level security;
alter table public.unknown_branches enable row level security;
alter table public.geocode_cache enable row level security;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
-- ควรเห็น service_role ครบทั้งสี่ตาราง และไม่เห็น anon/authenticated เลย:
--
--   select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('tracking_cache','carrier_branches','unknown_branches','geocode_cache')
--     and grantee in ('anon','authenticated','service_role')
--   group by table_name, grantee
--   order by table_name, grantee;
--
-- และฟังก์ชันต้องเรียกได้ด้วย service_role:
--
--   select has_function_privilege(
--     'service_role',
--     'public.record_unknown_branch(text, text, text)',
--     'execute'
--   );   -- ต้องได้ true
-- ------------------------------------------------------------------ --
