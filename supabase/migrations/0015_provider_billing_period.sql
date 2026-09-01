-- นับโควตาตามรอบบิลจริงของแต่ละเจ้า แทนที่จะนับตามเดือนปฏิทินเหมือนกันหมด
--
-- ปัญหาที่แก้: รอบบิลของสามเจ้าไม่เหมือนกันเลยสักเจ้า
--
--   ไปรษณีย์ไทย  รายวัน (เที่ยงคืนเวลาไทย)
--   Track123     รายเดือนตามวันที่ซื้อ = วันที่ 29
--   ETrackings   ไม่รีเซ็ตเลย นับสะสมตลอดกาล (แผนฟรี)
--
-- ตัวนับเดิมใช้คอลัมน์ month (เดือนปฏิทิน) ผลคือวันที่ 1 ก.ย. หน้าสถิติแสดง
-- 0/300 และ 0/50 ทั้งที่ของจริงใช้ไป 38 และ 9 — **ตัวนับที่ผิดแย่กว่าไม่มี
-- ตัวนับ เพราะให้ความมั่นใจปลอม** และกลไกเกลี่ยโหลดก็ตัดสินใจผิดตามไปด้วย
--
-- ------------------------------------------------------------------ --
-- ⚠️ ลำดับการ deploy
--
-- รัน migration นี้ **ก่อน** deploy โค้ดใหม่ · ระหว่างสองจังหวะนั้น โค้ดเก่าที่
-- ยังรันอยู่จะเรียก bump_provider_usage ด้วยชื่อพารามิเตอร์เดิม (p_month) แล้ว
-- ไม่เจอฟังก์ชัน → ขึ้น warn ใน log แล้วตกไปใช้ตัวนับใน memory ต่อ
-- การค้นหาของผู้ใช้ไม่ได้รับผลกระทบ (ดูกติกา "ห้ามโยน error" ใน
-- lib/supabase/provider-usage.ts) เป็นช่วงสั้นๆ ที่ยอมรับได้
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. คอลัมน์ month → period
--
-- เปลี่ยนชื่อแทนที่จะเพิ่มคอลัมน์ใหม่ เพราะชื่อ "month" กลายเป็นคำโกหกทันที
-- ที่รู้ว่ามีรอบรายวันกับรอบที่ไม่รีเซ็ต การปล่อยชื่อผิดไว้คือการวางกับดัก
-- ให้คนที่มาอ่านทีหลัง
-- ------------------------------------------------------------------ --

alter table public.provider_usage
  rename column month to period;

-- รูปแบบคีย์ใหม่มีสามแบบ: "2026-09-01" (รายวัน), "2026-08-29" (รอบเริ่มวันนั้น)
-- และ "lifetime" — ข้อจำกัดเดิมรับแค่ "2026-08" จึงต้องผ่อนให้ครอบทั้งสามแบบ
-- โดยยังไม่รับข้อความมั่วๆ
alter table public.provider_usage
  drop constraint if exists provider_usage_month_check;

do $$
begin
  alter table public.provider_usage
    add constraint provider_usage_period_check
    check (period = 'lifetime' or period ~ '^\d{4}-\d{2}(-\d{2})?$');
exception
  when duplicate_object then null;
end;
$$;

alter index if exists public.provider_usage_month_idx
  rename to provider_usage_period_idx;

-- ------------------------------------------------------------------ --
-- 2. ฟังก์ชันนับ — ชื่อพารามิเตอร์ต้องเปลี่ยนตาม
--
-- ต้อง drop ก่อน เพราะ Postgres ไม่ยอมให้ create or replace เปลี่ยนชื่อ
-- พารามิเตอร์ของฟังก์ชันเดิมที่ชนิดเหมือนกัน (เหตุผลเดียวกับ
-- record_unknown_branch ใน 0006)
-- ------------------------------------------------------------------ --

drop function if exists public.bump_provider_usage(text, text);

create or replace function public.bump_provider_usage(
  p_provider text,
  p_period text
) returns bigint
language sql
as $$
  insert into public.provider_usage (provider, period, call_count)
  values (p_provider, p_period, 1)
  on conflict (provider, period) do update
    set call_count = public.provider_usage.call_count + 1,
        last_call_at = now()
  returning call_count;
$$;

revoke all on function public.bump_provider_usage(text, text) from anon, authenticated, public;
grant execute on function public.bump_provider_usage(text, text) to service_role;

-- ------------------------------------------------------------------ --
-- 3. ข้อมูลเก่าที่เก็บแบบเดือนปฏิทิน
--
-- ETrackings — **ย้าย** เพราะรอบของมันคือ "สะสมตลอดกาล" ยอดรวมของทุกเดือน
-- ที่ผ่านมาจึงเป็นยอดสะสมที่ถูกต้องพอดี ถ้าไม่ย้าย ตัวนับจะเริ่มจากศูนย์ทั้งที่
-- โควตาถูกใช้ไปแล้วจริง แล้วเพดาน 50 จะผิดไปตลอดกาล
--
-- อีกสองเจ้า — **ปล่อยไว้เป็นประวัติ** ไม่ย้ายและไม่ลบ เพราะยอดของเดือนปฏิทิน
-- แปลงเป็นยอดของรอบรายวันหรือรอบวันที่ 29 ไม่ได้เลยโดยไม่เดา (เรารู้แค่ยอดรวม
-- ทั้งเดือน ไม่รู้ว่าวันไหนเท่าไร) แถวเก่าจะไม่ตรงกับคีย์รอบใหม่ จึงไม่ถูกอ่าน
-- อีกและไม่กวนตัวเลขปัจจุบัน แต่ยังย้อนดูได้ว่าเคยใช้ไปเท่าไร
-- ------------------------------------------------------------------ --

insert into public.provider_usage (provider, period, call_count, first_call_at, last_call_at)
select
  'etrackings',
  'lifetime',
  sum(call_count),
  min(first_call_at),
  max(last_call_at)
from public.provider_usage
where provider = 'etrackings'
  and period <> 'lifetime'
having sum(call_count) > 0
on conflict (provider, period) do update
  set call_count = public.provider_usage.call_count + excluded.call_count,
      last_call_at = greatest(public.provider_usage.last_call_at, excluded.last_call_at);

-- แถวเดือนเก่าของ ETrackings ถูกยุบเข้า lifetime แล้ว ลบทิ้งเพื่อไม่ให้ใครรัน
-- migration ซ้ำแล้วนับซ้ำ (migration นี้จึงรันซ้ำได้อย่างปลอดภัย)
delete from public.provider_usage
where provider = 'etrackings'
  and period <> 'lifetime';

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select provider, period, call_count from public.provider_usage order by 1, 2;
--
-- ควรเห็น etrackings มีแถวเดียวคือ 'lifetime'
--
-- ------------------------------------------------------------------ --
-- (ทางเลือก) ตั้งยอดตั้งต้นให้ตรงกับ dashboard ของเจ้านั้น
--
-- ตัวนับของเราเริ่มจากศูนย์ในรอบปัจจุบันของ Track123 ทั้งที่ dashboard บอกว่า
-- ใช้ไปแล้ว 38 ถ้าอยากให้กลไกเกลี่ยโหลดรู้ความจริงตั้งแต่วันนี้ ให้รันคำสั่ง
-- ข้างล่างครั้งเดียว โดยแก้ตัวเลขกับคีย์รอบให้ตรงกับที่ dashboard แสดง
--
-- ⚠️ ยอดของสองฝั่งนับคนละหน่วย (เรานับ request ที่ยิงออก เขานับเลขพัสดุ) การ
-- ตั้งค่านี้จึงเป็นการ "เผื่อไว้ก่อน" ไม่ใช่การทำให้ตรงกัน — ซึ่งเป็นทิศที่
-- ปลอดภัยกว่าการเริ่มจากศูนย์
--
--   insert into public.provider_usage (provider, period, call_count)
--   values ('track123', '2026-08-29', 38)
--   on conflict (provider, period) do update set call_count = excluded.call_count;
-- ------------------------------------------------------------------ --
