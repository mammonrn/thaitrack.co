-- Cache ผลการติดตามพัสดุแบบถาวร ใช้ร่วมกันทั้งเว็บ
--
-- ทำไมต้องมี: cache เดิมอยู่ใน memory ของ process เดียว จึงหายทุกครั้งที่
-- deploy หรือ pm2 restart หลัง deploy ทุกรอบผู้ใช้กลุ่มแรกต้องรอยิง API ใหม่
-- ทั้งหมด และถ้าวันไหน Track123 ล่มพร้อมกับที่เราเพิ่ง restart ก็ไม่เหลืออะไร
-- ให้แสดงเลย ตารางนี้ทำให้ข้อมูลรอด restart และใช้ร่วมกันได้ทุก instance
--
-- โควตาของ Track123 นับเป็น "จำนวนเลขพัสดุ" ต่อรอบบิล ไม่ใช่จำนวน request
-- (ยืนยันจาก dashboard จริง) เป้าหมายของตารางนี้จึงไม่ใช่การประหยัดโควตา
-- แต่คือลดจำนวน request ที่ต้องยิงจริง (เพดาน 5 req/s) ลดเวลารอของผู้ใช้
-- และมีของสำรองไว้แสดงในวันที่ระบบขนส่งล่ม
--
-- ------------------------------------------------------------------ --
-- ⚠️ ข้อมูลในตารางนี้เป็น "ของกลาง" ไม่ผูกกับผู้ใช้คนใดทั้งสิ้น
--
-- ตั้งใจไม่มีคอลัมน์ user_id และห้ามเพิ่มเด็ดขาด — ถ้าเก็บว่าใครค้นเลขอะไร
-- ตารางนี้จะกลายเป็นบันทึกพฤติกรรมผู้ใช้ทันที ซึ่งไม่ใช่สิ่งที่เราจะเก็บ
-- ประวัติการค้นที่ผูกกับผู้ใช้มีที่ของมันอยู่แล้วคือ public.saved_trackings
-- ซึ่งผู้ใช้เป็นคนกดบันทึกเอง
-- ------------------------------------------------------------------ --

create table if not exists public.tracking_cache (
  -- เลขพัสดุที่ normalize แล้ว (ตัดช่องว่าง/ขีด และทำเป็นตัวพิมพ์ใหญ่)
  -- ตรงกับ normalizeTrackingNumber() ใน lib/carriers/resolve.ts
  tracking_number text primary key,

  -- TrackingResult ทั้งก้อนตามรูปแบบใน lib/carriers/types.ts
  -- เก็บทั้งก้อนเพราะ UI ต้องการ timeline ครบ ไม่ใช่แค่สถานะล่าสุด
  result jsonb not null,

  -- คัดบางฟิลด์ออกมาเป็นคอลัมน์แยก เพื่อให้ query ดูภาพรวมได้โดยไม่ต้องแกะ jsonb
  -- (เช่น "ตอนนี้มีพัสดุที่ส่งถึงแล้วกี่เลข", "ขนส่งเจ้าไหนถูกค้นบ่อยสุด")
  -- ตัวที่ใช้แสดงผลจริงคือ result เสมอ สองคอลัมน์นี้มีไว้ดูเฉยๆ
  courier_code text,
  courier_name text,
  status text,

  -- เวลาที่ขนส่งอัปเดตสถานะล่าสุด (มาจาก result.lastUpdated)
  last_updated_at timestamptz,

  -- เวลาที่ "เราดึงข้อมูลชุดนี้มาจากขนส่ง" — ไม่ใช่เวลาที่ขนส่งอัปเดต
  -- ใช้บอกผู้ใช้ตอนต้องแสดงข้อมูลเก่าว่าเป็นข้อมูล ณ เวลาใด
  fetched_at timestamptz not null default now(),

  -- หมดอายุเมื่อไร คำนวณจาก TTL ตามสถานะ (ดู TTL_MS ใน lib/cache.ts)
  -- เก็บเป็นคอลัมน์แทนการคำนวณตอนอ่าน เพื่อให้ SQL กวาดของเก่าได้ตรงๆ
  expires_at timestamptz not null,

  -- ต้องตรงกับ TrackingStatus ใน lib/carriers/types.ts
  constraint tracking_cache_status_check check (
    status is null
    or status in (
      'pending',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'exception'
    )
  )
);

-- ใช้ตอนกวาดของเก่าทิ้ง (ดูคำสั่งท้ายไฟล์) การอ่านปกติใช้ primary key อยู่แล้ว
create index if not exists tracking_cache_expires_idx
  on public.tracking_cache (expires_at);

-- ------------------------------------------------------------------ --
-- สิทธิ์ — ล็อกให้แน่นที่สุด
--
-- ตารางนี้ต้องเข้าถึงได้จากฝั่งเซิร์ฟเวอร์ด้วย service role key เท่านั้น
-- ไม่มีเหตุผลใดที่เบราว์เซอร์ต้องอ่านหรือเขียนตารางนี้โดยตรง
--
-- สองชั้นที่ซ้อนกัน เพราะชั้นเดียวพลาดได้:
--   1. revoke สิทธิ์จาก anon/authenticated ทิ้งให้หมด — ต่อให้ในอนาคตมีใครไป
--      เปิด auto-expose ของ PostgREST หรือรัน grant กว้างๆ ทับ ตารางนี้ก็ยัง
--      ไม่ถูกเปิดออกไป เพราะไม่เคยถูก grant
--   2. เปิด RLS ไว้โดย "ไม่สร้าง policy ใดเลย" — Postgres ปฏิเสธทุกแถวเป็น
--      ค่าเริ่มต้นเมื่อเปิด RLS แล้วไม่มี policy ที่ตรง ส่วน service role
--      ข้าม RLS ได้อยู่แล้วจึงทำงานได้ตามปกติ
--
-- ⚠️ service role key ข้าม RLS ได้ทุกตาราง ห้ามให้หลุดไปฝั่ง client เด็ดขาด
-- ใน .env ต้องตั้งชื่อว่า SUPABASE_SERVICE_ROLE_KEY เท่านั้น ห้ามขึ้นต้นด้วย
-- NEXT_PUBLIC_ เพราะ Next จะฝังค่าที่ขึ้นต้นแบบนั้นลงไฟล์ JS ที่ส่งให้เบราว์เซอร์
-- ------------------------------------------------------------------ --

revoke all on table public.tracking_cache from anon;
revoke all on table public.tracking_cache from authenticated;

alter table public.tracking_cache enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ — เพิ่ม policy เมื่อไรคือเปิดประตูเมื่อนั้น
-- ถ้าเจอ policy ของตารางนี้ในอนาคต แปลว่ามีคนเพิ่มโดยไม่ได้ตั้งใจ ให้ลบทิ้ง
drop policy if exists tracking_cache_select_all on public.tracking_cache;
drop policy if exists tracking_cache_insert_all on public.tracking_cache;

-- ------------------------------------------------------------------ --
-- การกวาดของเก่า
--
-- แถวที่หมดอายุแล้ว "ห้ามลบทันที" เพราะเป็นของสำรองที่เอาไว้แสดงในวันที่
-- ระบบขนส่งล่ม (ข้อมูลเก่าพร้อมป้ายบอกเวลา ดีกว่าหน้าจอ error)
-- จึงเก็บต่ออีก 90 วันหลังหมดอายุแล้วค่อยลบ
--
-- ยังไม่ตั้ง cron ให้ เพราะ pg_cron ต้องเปิดใน dashboard ก่อน ระหว่างนี้
-- รันมือเดือนละครั้งพอ (ตารางโตช้ามาก — หนึ่งแถวต่อหนึ่งเลขพัสดุเท่านั้น):
--
--   delete from public.tracking_cache
--   where expires_at < now() - interval '90 days';
--
-- ถ้าเปิด pg_cron แล้วค่อยตั้งเป็นงานรายเดือน:
--
--   select cron.schedule(
--     'tracking-cache-cleanup',
--     '0 3 1 * *',
--     $$delete from public.tracking_cache
--       where expires_at < now() - interval '90 days'$$
--   );
-- ------------------------------------------------------------------ --
