-- ความละเอียดของพิกัด — เก็บเป็นตัวเลข แล้วบอกผู้ใช้ตรงๆ เมื่อไม่ใช่จุดเป๊ะ
--
-- ปัญหาที่แก้: เกณฑ์เดิมใน 0006 ใช้ geometry.location_type ของ Google เป็นตัว
-- ตัดสิน แล้วรับเฉพาะ ROOFTOP กับ RANGE_INTERPOLATED ผลจากการใช้จริงคือ
-- **ไม่เคยผ่านเลยสักครั้ง** เพราะที่อยู่ไทยแบบ "639 หมู่ที่1 ตำบลบ้านดู่ ..."
-- Google คืน GEOMETRIC_CENTER หรือ APPROXIMATE ให้เสมอ การเก็บพิกัดสาขา
-- อัตโนมัติจึงตายสนิท
--
-- ------------------------------------------------------------------ --
-- ทำไมถึงผ่อนเกณฑ์ด้วยการ "วัดขนาด" แทนการรับ location_type เพิ่ม
--
-- location_type บอกแค่ *วิธี* ที่ Google ได้พิกัดมา ไม่ได้บอก *ขนาด* ของสิ่งที่
-- มันจับได้ GEOMETRIC_CENTER เป็นได้ทั้ง "กลางถนนซอยหนึ่ง" (ดีมาก) และ
-- "กลางตำบล" (พอรับได้) ส่วน APPROXIMATE เป็นได้ทั้งตำบลและทั้งจังหวัด
-- การผ่อนให้รับสองค่านั้นเฉยๆ จึงเท่ากับเปิดประตูให้หมุดกลางจังหวัดเข้ามา
-- ซึ่งคือบั๊กที่ migration 0004 ตั้งใจแก้ตั้งแต่ต้น
--
-- สิ่งที่บอกขนาดได้จริงมีอยู่ใน response อยู่แล้ว เราแค่เคยทิ้งไป:
--
--   geometry.viewport  ครึ่งเส้นทแยงมุมเป็นเมตร = "รัศมีความคลาดเคลื่อน"
--                      บ้านเลขที่ ~100 ม. · ตำบล ~3-8 กม. · อำเภอ 15-40 กม.
--   types[]            เจอ administrative_area_level_1/2 หรือ country
--                      = เขตปกครองระดับอำเภอขึ้นไป ปฏิเสธไม่ว่าขนาดจะเท่าไร
--   partial_match      Google บอกเองว่าจับได้ไม่ครบ ต้องเดา
--
-- สองอย่างหลังรวมกันเป็นคอลัมน์ area_only ส่วนอย่างแรกเป็น accuracy_meters
--
-- ------------------------------------------------------------------ --
-- เก็บ "ค่าที่วัดได้" ไม่ใช่ "คำตัดสิน" โดยตั้งใจ
--
-- ชั้นความละเอียด (exact / approximate / area) ถูกคำนวณสดจากสองคอลัมน์นี้ทุก
-- ครั้งที่อ่าน (classifyAccuracy ใน lib/geocode.ts) การปรับเพดานผ่าน env จึงมี
-- ผลกับแถวที่ cache ไว้แล้วทันที ไม่ต้องล้าง cache และไม่ต้องยิงถาม Google ใหม่
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. cache ผลหาพิกัด — เก็บผลการวัด
--
-- null ทั้งคู่ = แถวเก่าที่บันทึกไว้ก่อนมีคอลัมน์นี้ ถือว่า "ไม่รู้ความละเอียด"
-- เส้นทางแสดงผลจะยังปักหมุดให้พร้อมป้าย "ตำแหน่งโดยประมาณ" (บอกตรงๆ ว่าไม่
-- ยืนยันความแม่น) ส่วนเส้นทางเติมพิกัดสาขาอัตโนมัติจะไม่แตะแถวเหล่านั้นเลย
-- เพราะตารางสาขาเป็นของที่ทั้งระบบเชื่อว่าถูก ของที่ไม่รู้ที่มาไม่ควรเข้าไป
-- ------------------------------------------------------------------ --

alter table public.geocode_cache
  add column if not exists accuracy_meters double precision;

alter table public.geocode_cache
  add column if not exists area_only boolean;

do $$
begin
  alter table public.geocode_cache
    add constraint geocode_cache_accuracy_meters_check
    check (accuracy_meters is null or accuracy_meters >= 0);
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------ --
-- 2. พิกัดสาขา — ชั้นความละเอียดของแถวนั้น
--
-- แถวที่มีอยู่แล้วทั้งหมดเป็นของที่แอดมินกรอกเอง ซึ่งคือจุดที่คนไปยืนยันมาแล้ว
-- จึงเป็น 'exact' โดยปริยาย ส่วนแถวที่ระบบเติมเองจะใส่ค่าตามที่วัดได้จริง
--
-- ตั้งใจไม่เก็บ accuracy_meters ซ้ำที่นี่ เพราะพิกัดที่แอดมินกรอกเองไม่มีค่านั้น
-- (ไม่ได้มาจาก Google) การมีคอลัมน์ที่ว่างครึ่งตารางมีแต่จะชวนให้เข้าใจผิด
-- ------------------------------------------------------------------ --

alter table public.carrier_branches
  add column if not exists accuracy text not null default 'exact';

do $$
begin
  alter table public.carrier_branches
    add constraint carrier_branches_accuracy_check
    check (accuracy in ('exact', 'approximate'));
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------ --
-- 3. ประวัติที่ผู้ใช้บันทึกไว้ — ชั้นความละเอียดของหมุดที่แสดง
--
-- หน้าประวัติอ่าน snapshot จากตารางนี้ตรงๆ ไม่ได้ join กับ carrier_branches
-- (ตั้งใจ — ดู 0001) จึงต้องมีคอลัมน์ของตัวเอง
--
-- null = แถวเก่าที่บันทึกก่อนมีคอลัมน์นี้ **ไม่ขึ้นป้าย** เพราะเราไม่รู้จริงๆ
-- ว่าหมุดนั้นแม่นแค่ไหน การเดาว่า "ไม่แม่น" แล้วติดป้ายให้ทุกแถวเก่าคือการ
-- บอกสิ่งที่เราไม่รู้ ไม่ต่างจากการเดาว่าแม่น แถวจะทยอยได้ค่าเองเมื่อผู้ใช้
-- กดบันทึกเลขนั้นซ้ำ
--
-- ⚠️ ตารางนี้เปิด RLS พร้อม policy ผูกกับ auth.uid() อยู่แล้ว (ดู 0001)
-- การเพิ่มคอลัมน์ไม่กระทบ policy เดิม และคอลัมน์นี้ไม่ได้เพิ่มข้อมูลเกี่ยวกับ
-- ตัวผู้ใช้แต่อย่างใด — มันเป็นคุณสมบัติของ "หมุด" ไม่ใช่ของ "คน"
-- ------------------------------------------------------------------ --

alter table public.saved_trackings
  add column if not exists last_location_accuracy text;

do $$
begin
  alter table public.saved_trackings
    add constraint saved_trackings_location_accuracy_check
    check (
      last_location_accuracy is null
      or last_location_accuracy in ('exact', 'approximate')
    );
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public'
--     and (table_name, column_name) in (
--       ('geocode_cache', 'accuracy_meters'),
--       ('geocode_cache', 'area_only'),
--       ('carrier_branches', 'accuracy'),
--       ('saved_trackings', 'last_location_accuracy')
--     );
--   -- ต้องได้ครบ 4 แถว
--
-- ดูว่าที่ผ่านมา Google ตอบละเอียดแค่ไหนกับที่อยู่ที่เราแยกได้
-- (ต้องรอให้มีการค้นหาใหม่หลัง deploy ก่อน แถวเก่าจะยังเป็น null):
--
--   select precision, area_only,
--          round(min(accuracy_meters)) as min_m,
--          round(percentile_cont(0.5) within group (order by accuracy_meters)) as median_m,
--          round(max(accuracy_meters)) as max_m,
--          count(*)
--   from public.geocode_cache
--   where accuracy_meters is not null
--   group by 1, 2 order by 1, 2;
-- ------------------------------------------------------------------ --
