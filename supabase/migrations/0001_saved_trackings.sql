-- ประวัติการค้นหาที่ผู้ใช้กด "บันทึกไว้"
--
-- เก็บ snapshot ของสถานะล่าสุดไว้ในแถวเลย ไม่ต้องยิงถาม API ขนส่งใหม่ตอนเปิด
-- หน้าประวัติ ส่วนพิกัดก็เก็บผลจาก geocode ไว้ครั้งเดียวตอนบันทึก จะได้ไม่ต้อง
-- เรียก Google Geocoding ซ้ำทุกครั้งที่แสดงผล

create table if not exists public.saved_trackings (
  id uuid primary key default gen_random_uuid(),

  -- ลบผู้ใช้แล้วประวัติต้องหายตามไปด้วย
  user_id uuid not null references auth.users (id) on delete cascade,

  tracking_number text not null,
  carrier_name text,

  -- ชื่อเล่นที่ผู้ใช้ตั้งเอง เว้นว่างได้ (UI จะใช้เลขพัสดุแทน)
  nickname text,

  -- snapshot สถานะล่าสุดตอนที่กดบันทึก
  last_status text,
  last_status_text text,

  -- ข้อความสถานที่จาก event ล่าสุด และพิกัดที่ geocode ได้จากข้อความนั้น
  -- พิกัดเป็น null ได้ เพราะข้อความสถานที่บางอันคลุมเครือเกินกว่าจะหาพิกัดได้
  last_location_text text,
  last_lat double precision,
  last_lng double precision,

  last_updated_at timestamptz,
  created_at timestamptz not null default now(),

  -- ต้องตรงกับ TrackingStatus ใน lib/carriers/types.ts
  constraint saved_trackings_last_status_check check (
    last_status is null
    or last_status in (
      'pending',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'exception'
    )
  ),

  -- บันทึกเลขเดิมซ้ำต้องเป็นการอัปเดตแถวเดิม ไม่ใช่สร้างแถวใหม่
  constraint saved_trackings_user_tracking_key unique (user_id, tracking_number)
);

-- หน้าประวัติเรียงจากอัปเดตล่าสุดก่อนเสมอ และกรองด้วย user_id ทุกครั้ง
create index if not exists saved_trackings_user_updated_idx
  on public.saved_trackings (user_id, last_updated_at desc nulls last);

-- ------------------------------------------------------------------ --
-- Row Level Security
--
-- ทุก policy ผูกกับ auth.uid() = user_id เพื่อให้ผู้ใช้แตะได้เฉพาะแถวของตัวเอง
-- ถ้าไม่เปิด RLS ผู้ใช้ที่ล็อกอินอยู่คนไหนก็อ่านประวัติของคนอื่นได้ทั้งหมด
-- เพราะ client ใช้ anon key ยิงเข้า PostgREST ตรงๆ ได้
-- ------------------------------------------------------------------ --

alter table public.saved_trackings enable row level security;

-- ชื่อ policy ใช้อักษรอังกฤษ เพราะ identifier ของ Postgres จำกัดที่ 63 ไบต์
-- ไม่ใช่ 63 ตัวอักษร ภาษาไทยตัวละ 3 ไบต์จึงถูกตัดกลางคันและเพี้ยน
drop policy if exists saved_trackings_select_own on public.saved_trackings;
create policy saved_trackings_select_own
  on public.saved_trackings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists saved_trackings_insert_own on public.saved_trackings;
create policy saved_trackings_insert_own
  on public.saved_trackings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ต้องมีทั้ง using และ with check: using คุมว่าแก้แถวไหนได้
-- ส่วน with check กันไม่ให้ย้ายแถวของตัวเองไปเป็นของคนอื่นด้วยการแก้ user_id
drop policy if exists saved_trackings_update_own on public.saved_trackings;
create policy saved_trackings_update_own
  on public.saved_trackings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists saved_trackings_delete_own on public.saved_trackings;
create policy saved_trackings_delete_own
  on public.saved_trackings
  for delete
  to authenticated
  using (auth.uid() = user_id);
