-- พิกัดสาขาของขนส่ง + ทะเบียนสาขาที่ยังไม่รู้พิกัด + cache ผลการหาพิกัด
--
-- ปัญหาที่แก้: ข้อความสถานที่จากขนส่งจำนวนมากเป็น "รหัสสาขาภายใน" ไม่ใช่ที่อยู่
-- เช่น "ACRAI-B - เมืองเชียงราย" เดิมเราส่งข้อความทั้งก้อนนี้ให้ Google Geocoding
-- ซึ่งไม่มีทางรู้จักรหัสพวกนี้ Google จึงเดาเอาจากคำที่พอเดาได้ ("เชียงราย")
-- แล้วคืนหมุดกลางเมืองมา ผู้ใช้เห็นแล้วเข้าใจว่าพัสดุอยู่ตรงนั้นจริง ทั้งที่ไม่ใช่
--
-- หลักการใหม่: **ถ้าไม่รู้ว่าอยู่ไหนจริงๆ ห้ามปักหมุด** แสดงชื่อสาขาเป็นข้อความ
-- แทน แล้วบันทึกไว้ว่าเจอสาขานี้กี่ครั้ง เพื่อให้แอดมินไล่เติมพิกัดตามลำดับ
-- ความถี่ได้ (หน้า /admin/branches)
--
-- ------------------------------------------------------------------ --
-- ⚠️ ทั้งสามตารางเป็นของกลางฝั่งเซิร์ฟเวอร์ ไม่ผูกกับผู้ใช้คนใด
--
-- ตั้งใจไม่มีคอลัมน์ user_id และห้ามเพิ่ม — เหตุผลเดียวกับ tracking_cache
-- (ดู 0003) ถ้าเก็บว่าใครค้นแล้วเจอสาขาไหน จะกลายเป็นบันทึกพฤติกรรมผู้ใช้ทันที
--
-- สิทธิ์ล็อกแบบเดียวกับ tracking_cache: revoke ทิ้งให้หมด + เปิด RLS โดยไม่มี
-- policy เลย เข้าถึงได้ทางเดียวคือ service role ฝั่งเซิร์ฟเวอร์
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. พิกัดสาขาที่รู้แล้ว — แอดมินเป็นคนกรอก
-- ------------------------------------------------------------------ --

create table if not exists public.carrier_branches (
  -- รหัสขนส่งตาม TrackingResult.carrierCode เช่น "flash-express"
  carrier_code text not null,

  -- รหัสสาขาที่ normalize แล้ว (ตัวพิมพ์ใหญ่ ตัดช่องว่างหัวท้าย)
  -- ตรงกับ parseLocationText() ใน lib/branch-location.ts
  branch_code text not null,

  -- ชื่อที่คนอ่านรู้เรื่อง เช่น "เมืองเชียงราย" — แสดงแทนแผนที่เมื่อยังไม่มีพิกัด
  branch_name text,

  lat double precision not null,
  lng double precision not null,

  -- บันทึกช่วยจำของแอดมิน เช่น "ยืนยันจากหน้าเว็บของขนส่งแล้ว"
  note text,

  -- อีเมลแอดมินที่แก้ล่าสุด ไว้ตามกลับได้ว่าใครใส่พิกัดผิด
  updated_by text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (carrier_code, branch_code),

  -- ด่านสุดท้ายของการตรวจพิกัด ฝั่งแอปตรวจให้ก่อนแล้ว (lib/coordinates.ts)
  -- แต่ฐานข้อมูลต้องกันเองด้วย เผื่อวันหนึ่งมีคนเขียนตรงผ่าน SQL editor
  constraint carrier_branches_lat_check check (lat >= -90 and lat <= 90),
  constraint carrier_branches_lng_check check (lng >= -180 and lng <= 180)
);

-- ------------------------------------------------------------------ --
-- 2. สาขาที่เจอแล้วแต่ยังไม่รู้พิกัด — ระบบเป็นคนบันทึกเอง
--
-- hit_count คือหัวใจของตารางนี้ หน้าแอดมินเรียงตามค่านี้จากมากไปน้อย
-- แอดมินจะได้เติมพิกัดของสาขาที่ผู้ใช้เจอบ่อยที่สุดก่อน
-- ------------------------------------------------------------------ --

create table if not exists public.unknown_branches (
  carrier_code text not null,
  branch_code text not null,
  branch_name text,

  -- เจอสาขานี้มากี่ครั้งแล้ว
  hit_count bigint not null default 1,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  primary key (carrier_code, branch_code)
);

-- หน้าแอดมินเรียงด้วยสองคอลัมน์นี้เสมอ
create index if not exists unknown_branches_priority_idx
  on public.unknown_branches (hit_count desc, last_seen_at desc);

/*
 * บันทึกว่าเจอสาขาที่ไม่รู้จักอีกครั้ง — เพิ่ม hit_count แบบ atomic
 *
 * ต้องเป็นฟังก์ชันใน Postgres เพราะ upsert ของ supabase-js เขียนค่าคงที่ได้
 * อย่างเดียว สั่ง "hit_count = hit_count + 1" ไม่ได้ ถ้าไปอ่านมาบวกแล้วเขียนกลับ
 * ฝั่งแอป สองคำขอที่มาพร้อมกันจะนับหายไปหนึ่ง
 *
 * security invoker (ค่าเริ่มต้น) โดยตั้งใจ — ไม่ใช้ definer เพราะผู้เรียกคือ
 * service role ที่มีสิทธิ์อยู่แล้ว การใช้ definer มีแต่จะเปิดช่องให้ role อื่น
 * เรียกผ่านฟังก์ชันนี้เข้าไปแตะตารางได้ (และเรา revoke execute ทิ้งด้านล่างอีกชั้น)
 */
create or replace function public.record_unknown_branch(
  p_carrier_code text,
  p_branch_code text,
  p_branch_name text
) returns void
language sql
as $$
  insert into public.unknown_branches (carrier_code, branch_code, branch_name)
  values (p_carrier_code, p_branch_code, p_branch_name)
  on conflict (carrier_code, branch_code) do update
    set hit_count = public.unknown_branches.hit_count + 1,
        last_seen_at = now(),
        -- ชื่อที่เพิ่งเจออาจว่าง อย่าไปทับของเดิมที่มีอยู่แล้ว
        branch_name = coalesce(
          excluded.branch_name,
          public.unknown_branches.branch_name
        );
$$;

-- ------------------------------------------------------------------ --
-- 3. cache ผลการหาพิกัดจาก Google — เฉพาะข้อความที่ "ดูเหมือนที่อยู่จริง"
--
-- เก็บผลที่หาไม่เจอด้วย (found = false) เพราะถ้าไม่เก็บ ข้อความที่ Google
-- ไม่รู้จักจะถูกยิงถามซ้ำทุกครั้งที่มีคนบันทึกพัสดุที่ผ่านจุดนั้น
-- ------------------------------------------------------------------ --

create table if not exists public.geocode_cache (
  -- ข้อความที่ normalize แล้ว (ตัดช่องว่างซ้ำ ตัวพิมพ์เล็ก)
  query text primary key,

  -- null ทั้งคู่เมื่อ found = false
  lat double precision,
  lng double precision,

  -- false = เคยถาม Google แล้วแต่หาไม่เจอ อย่าถามซ้ำ
  found boolean not null,

  geocoded_at timestamptz not null default now(),

  constraint geocode_cache_found_check check (
    (found and lat is not null and lng is not null)
    or (not found and lat is null and lng is null)
  ),
  constraint geocode_cache_lat_check check (lat is null or (lat >= -90 and lat <= 90)),
  constraint geocode_cache_lng_check check (lng is null or (lng >= -180 and lng <= 180))
);

-- ------------------------------------------------------------------ --
-- สิทธิ์ — เหมือน tracking_cache ทุกประการ
--
-- สองชั้นที่ซ้อนกัน:
--   1. revoke สิทธิ์จาก anon/authenticated ทิ้งให้หมด
--   2. เปิด RLS โดยไม่สร้าง policy ใดเลย → Postgres ปฏิเสธทุกแถวเป็นค่าเริ่มต้น
--      service role ข้าม RLS ได้อยู่แล้วจึงทำงานตามปกติ
--
-- หน้า /admin/branches ไม่ได้ยิงเข้าตารางนี้ตรงๆ จากเบราว์เซอร์ — มันเรียก
-- API route ของเราที่ตรวจสิทธิ์แอดมินฝั่งเซิร์ฟเวอร์ก่อนเสมอ
-- ------------------------------------------------------------------ --

revoke all on table public.carrier_branches from anon;
revoke all on table public.carrier_branches from authenticated;
revoke all on table public.unknown_branches from anon;
revoke all on table public.unknown_branches from authenticated;
revoke all on table public.geocode_cache from anon;
revoke all on table public.geocode_cache from authenticated;

revoke all on function public.record_unknown_branch(text, text, text) from anon;
revoke all on function public.record_unknown_branch(text, text, text) from authenticated;
revoke all on function public.record_unknown_branch(text, text, text) from public;

alter table public.carrier_branches enable row level security;
alter table public.unknown_branches enable row level security;
alter table public.geocode_cache enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ — เพิ่ม policy เมื่อไรคือเปิดประตูเมื่อนั้น
-- ถ้าเจอ policy ของสามตารางนี้ในอนาคต แปลว่ามีคนเพิ่มโดยไม่ได้ตั้งใจ ให้ลบทิ้ง

-- ------------------------------------------------------------------ --
-- การกวาดของเก่า
--
-- carrier_branches กับ unknown_branches ไม่ต้องกวาด — โตตามจำนวนสาขาจริงของ
-- ขนส่ง ซึ่งมีจำกัดและเปลี่ยนช้ามาก
--
-- geocode_cache: แถวที่ found = false อาจกลายเป็นหาเจอได้ถ้า Google อัปเดต
-- ฐานข้อมูล จึงล้างของที่เก่ากว่าหนึ่งปีทิ้งเป็นครั้งคราว (รันมือปีละครั้งพอ):
--
--   delete from public.geocode_cache
--   where not found and geocoded_at < now() - interval '1 year';
-- ------------------------------------------------------------------ --
