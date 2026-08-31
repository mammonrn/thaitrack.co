-- ความจำว่า "เลขพัสดุนี้เป็นของขนส่งเจ้าไหน" — ข้อเท็จจริงถาวร ไม่มีวันหมดอายุ
--
-- ปัญหาที่แก้: courier hint เคยอ่านจาก tracking_cache.courier_code ซึ่งอยู่แถว
-- เดียวกับผลลัพธ์ที่มี TTL พอแถวถูกลบ ความจำเรื่องขนส่งหายตามไปด้วย
--
--   [resolve] no=TH269980283785V order=fallback courier=-(none)
--
-- เลขนี้เพิ่งค้นสำเร็จด้วย shopee-xpress-th มาหยกๆ แต่พอลบแถวออกจาก
-- tracking_cache แล้วค้นใหม่ ระบบไม่มีความจำเรื่องขนส่งเลย
--
-- ------------------------------------------------------------------ --
-- ทำไมต้องเป็นตารางแยก ไม่ใช่กติกา "ห้ามลบแถว tracking_cache"
--
-- 1. **อายุของข้อมูลสองอย่างนี้ต่างกันโดยธรรมชาติ** สถานะพัสดุเปลี่ยนทุกชั่วโมง
--    และเก่าแล้วไร้ค่า ส่วน "เลขนี้เป็นของ SPX" เป็นจริงตลอดกาล การเก็บไว้ใน
--    แถวเดียวกันแปลว่าต้องเลือกอายุเดียวให้ของสองอย่างที่ไม่เหมือนกันเลย
--
-- 2. **README เขียนคำสั่งกวาดของเก่าของ tracking_cache ไว้อยู่แล้ว** ใครรันตามนั้น
--    ความจำเรื่องขนส่งของทั้งระบบหายเกลี้ยงในคำสั่งเดียวโดยไม่มีใครรู้ว่าเพิ่งทำ
--    อะไรลงไป กติกา "ห้ามลบ" ที่ต้องอาศัยให้คนถัดไปจำได้ คือกับดัก ไม่ใช่การป้องกัน
--
-- 3. **ขนาด** แถวนี้ประมาณ 60 ไบต์ ส่วนแถวของ tracking_cache มี result เป็น
--    jsonb ก้อนใหญ่ การเก็บ jsonb ไว้ตลอดกาลเพื่อจำแค่รหัสขนส่งไม่คุ้มเลย
--
-- ------------------------------------------------------------------ --
-- ⚠️ ตารางนี้เป็นของกลาง **ตั้งใจไม่มี user_id และห้ามเพิ่ม**
--
-- "เลขพัสดุนี้เป็นของขนส่งเจ้าไหน" เป็นข้อเท็จจริงของตัวพัสดุ ไม่ใช่ข้อมูลของ
-- คนที่ค้น ถ้าเก็บว่าใครเป็นคนทำให้เรารู้ ตารางนี้จะกลายเป็นบันทึกว่าใครค้นเลข
-- อะไรทันที ซึ่งเป็นสิ่งเดียวที่ทั้งระบบสัญญาว่าจะไม่เก็บ (ดู 0007)
--
-- ⚠️ **ห้ามเพิ่มคอลัมน์ที่บอกสถานะพัสดุลงตารางนี้** ไม่งั้นจะกลายเป็น cache
-- อีกอันที่ไม่มีวันหมดอายุ ซึ่งแย่กว่าไม่มี cache
-- ------------------------------------------------------------------ --

create table if not exists public.tracking_couriers (
  -- เลขพัสดุที่ normalize แล้ว ตรงกับ normalizeTrackingNumber()
  tracking_number text primary key,

  -- รหัสขนส่งที่ normalize แล้ว ตรงกับ normalizeCourierCode()
  -- (ดู lib/carriers/courier-code.ts — เก็บรูปเดียวเสมอ จะได้ไม่เจอปัญหา
  --  flashexpress กับ flash-express เทียบกันไม่ติดซ้ำอีก)
  courier_code text not null,

  -- ใครเป็นคนยืนยัน: primary | fallback | backup — ไว้ไล่ดูตอนข้อมูลดูแปลก
  confirmed_by text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  constraint tracking_couriers_code_check check (courier_code ~ '^[a-z0-9]+$')
);

/*
 * จำว่าเลขนี้เป็นของขนส่งเจ้าไหน — เขียนทับได้เมื่อผลใหม่ต่างจากเดิม
 *
 * ทำไมยอมให้ทับ: พัสดุข้ามประเทศเปลี่ยนมือให้ขนส่งเจ้าอื่นเดินช่วงสุดท้ายได้
 * ผลล่าสุดจึงตรงกับความจริงมากกว่าผลแรก และการทับก็ยังคง first_seen_at ไว้
 * ให้เห็นว่าเลขนี้อยู่ในระบบมานานแค่ไหน
 *
 * security invoker (ค่าเริ่มต้น) เหมือนฟังก์ชันอื่นของตารางของกลาง
 */
create or replace function public.remember_tracking_courier(
  p_tracking_number text,
  p_courier_code text,
  p_confirmed_by text
) returns void
language sql
as $$
  insert into public.tracking_couriers (tracking_number, courier_code, confirmed_by)
  values (p_tracking_number, p_courier_code, p_confirmed_by)
  on conflict (tracking_number) do update
    set courier_code = excluded.courier_code,
        confirmed_by = coalesce(excluded.confirmed_by, public.tracking_couriers.confirmed_by),
        last_seen_at = now();
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับตารางของกลางอื่นทุกประการ
-- ------------------------------------------------------------------ --

revoke all on table public.tracking_couriers from anon, authenticated;
revoke all on function public.remember_tracking_courier(text, text, text)
  from anon, authenticated, public;

grant select, insert, update, delete on table public.tracking_couriers to service_role;
grant execute on function public.remember_tracking_courier(text, text, text) to service_role;

alter table public.tracking_couriers enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select courier_code, count(*) from public.tracking_couriers group by 1 order by 2 desc;
--
-- ตารางนี้ตอบได้ในอนาคตว่ารูปเลขแบบ TH+ตัวเลข+ตัวอักษร เป็นของ SPX ล้วนหรือ
-- ปนกับ Flash จริง ซึ่งเป็นข้อมูลที่ต้องมีก่อนจะกล้าเติมแถวลงตาราง prefix:
--
--   select courier_code, count(*)
--   from public.tracking_couriers
--   where tracking_number ~ '^TH[0-9]'
--   group by 1 order by 2 desc;
--
-- การกวาดของเก่า: **ไม่ต้องกวาด** แถวเล็กมากและข้อมูลไม่มีวันเก่า
-- ------------------------------------------------------------------ --
