-- เพิ่มชั้น 'coarse' ให้ชั้นความละเอียดของพิกัด
--
-- ปัญหาที่แก้: หลัง 0008 ใช้จริงแล้วพบว่าเพดาน 5 กม. แคบเกินไปมาก
--
--   query                                                        accuracy_meters
--   639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100      8299
--
-- ที่อยู่ที่ละเอียดถึงบ้านเลขที่ Google ยังคืนกรอบขนาด 8.3 กม. มาให้ เพราะมัน
-- resolve ได้แค่ระดับตำบล (บ้านดู่) แล้วคืนกรอบของตำบลทั้งตำบล ตำบลในต่างจังหวัด
-- ใหญ่ขนาดนั้นได้จริง การเก็บพิกัดสาขาอัตโนมัติจึงยังไม่ทำงานเลยแม้แต่ครั้งเดียว
--
-- ------------------------------------------------------------------ --
-- สองอย่างที่แก้พร้อมกัน
--
-- 1. **เพดานขยายเป็น 12 กม.** (ค่าเริ่มต้นใหม่ของ GEOCODE_MAX_ACCURACY_METERS)
--    ตัวที่กันหมุดกลางอำเภอ/จังหวัดจริงๆ คือด่าน types[] ไม่ใช่เพดานขนาด —
--    อำเภอกับจังหวัดถูกปฏิเสธด้วยชนิดของผลลัพธ์ไปแล้วไม่ว่ากรอบจะเล็กแค่ไหน
--    เพดานเป็นแค่ตาข่ายชั้นสองสำหรับผลลัพธ์ที่ไม่ใช่เขตปกครองแต่กรอบใหญ่ผิดปกติ
--    จึงกว้างได้โดยไม่เปิดบั๊กเดิมกลับมา
--
-- 2. **แยกชั้น 'approximate' เดิมออกเป็นสองชั้น** เพราะถ้อยคำเดียวกันใช้กับ
--    ความคลาดเคลื่อน 200 ม. กับ 8 กม. ไม่ได้ — ป้ายเดิมเขียนว่า "ระดับตำบล"
--    ซึ่งคนอ่านแล้วนึกถึงระยะไม่กี่ร้อยเมตร ไม่ตรงกับ 8 กม. ที่เป็นจริง
--
--      exact        ≤ 150 ม.    ไม่ขึ้นป้าย
--      approximate  ≤ 1 กม.     "คลาดเคลื่อนได้ราว 1 กม."
--      coarse       ≤ เพดาน     "คลาดเคลื่อนได้หลายกิโลเมตร"
--
-- ⚠️ ไม่ต้องเพิ่มคอลัมน์เก็บระยะทางที่หน้าเว็บ เพราะแต่ละชั้นมีขอบบนที่รู้อยู่แล้ว
-- ถ้อยคำจึงบอกความคลาดเคลื่อนได้ตรงจากชั้น ส่วนตัวเลขดิบยังอยู่ครบใน
-- geocode_cache.accuracy_meters สำหรับไล่ดูย้อนหลังและปรับเพดาน
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. ขยาย constraint ให้รับค่าใหม่ก่อน แล้วค่อยแก้ข้อมูล
--
-- ลำดับนี้สลับไม่ได้ — update ก่อนจะชน constraint เดิมทันที
-- ------------------------------------------------------------------ --

alter table public.carrier_branches
  drop constraint if exists carrier_branches_accuracy_check;

alter table public.carrier_branches
  add constraint carrier_branches_accuracy_check
  check (accuracy in ('exact', 'approximate', 'coarse'));

alter table public.saved_trackings
  drop constraint if exists saved_trackings_location_accuracy_check;

alter table public.saved_trackings
  add constraint saved_trackings_location_accuracy_check
  check (
    last_location_accuracy is null
    or last_location_accuracy in ('exact', 'approximate', 'coarse')
  );

-- ------------------------------------------------------------------ --
-- 2. แถวเดิมที่เป็น 'approximate' → 'coarse'
--
-- แถวพวกนั้นถูกจัดชั้นด้วยกติกาเก่าที่ 'approximate' กินตั้งแต่ 150 ม. ถึง 5 กม.
-- เราไม่รู้ว่าแต่ละแถวอยู่ตรงไหนของช่วงนั้น จึงเลือกชั้นที่ถ้อยคำคลุมเครือกว่า
-- — บอกว่า "คลาดเคลื่อนได้หลายกิโลเมตร" กับหมุดที่จริงๆ แม่น 300 ม. แค่ทำให้
-- ผู้ใช้ระวังเกินจำเป็น ส่วนการบอกว่า "ราว 1 กม." กับหมุดที่คลาด 5 กม. คือการ
-- ให้ข้อมูลผิด ซึ่งเป็นสิ่งเดียวที่ระบบนี้ทั้งระบบพยายามไม่ทำ
--
-- แถวที่เป็น 'exact' ไม่ต้องแตะ — ทั้งหมดเป็นพิกัดที่แอดมินกรอกเอง
-- ------------------------------------------------------------------ --

update public.carrier_branches
   set accuracy = 'coarse'
 where accuracy = 'approximate';

update public.saved_trackings
   set last_location_accuracy = 'coarse'
 where last_location_accuracy = 'approximate';

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select accuracy, count(*) from public.carrier_branches group by 1;
--   select last_location_accuracy, count(*) from public.saved_trackings group by 1;
--
-- ดูว่าเพดาน 12 กม. ตั้งถูกไหมจากข้อมูลจริง (รันหลังมีการค้นใหม่สักพัก):
--
--   select area_only,
--          round(min(accuracy_meters)) as min_m,
--          round(percentile_cont(0.5) within group (order by accuracy_meters)) as p50_m,
--          round(percentile_cont(0.9) within group (order by accuracy_meters)) as p90_m,
--          round(max(accuracy_meters)) as max_m,
--          count(*)
--   from public.geocode_cache
--   where accuracy_meters is not null
--   group by 1;
--
-- ถ้า p90 ของแถวที่ area_only = false ยังชนเพดานอยู่ ให้ขยาย
-- GEOCODE_MAX_ACCURACY_METERS ได้เลย มีผลกับของที่ cache ไว้แล้วทันที
-- ------------------------------------------------------------------ --
