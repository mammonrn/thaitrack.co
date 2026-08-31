-- โควตาที่ใช้ของแต่ละผู้ให้บริการ + กลไกกันเผาโควตาตอนไปถามที่อยู่สาขา
--
-- มาคู่กับการเปลี่ยนจาก "ETrackings เป็นเจ้าสำรอง" เป็น "ใช้สองเจ้าสลับกัน
-- ตามความถนัด" (ดู lib/carriers/resolve.ts) ซึ่งต้องการสองอย่างที่ของเดิมไม่มี:
--
--   1. ตัวนับโควตาที่ **รอด restart และใช้ร่วมกันทุก instance**
--      ของเดิมนับใน memory ของโปรเซสเดียว (usage ใน lib/carriers/etrackings.ts)
--      ตัวเลขจึงหายทุกครั้งที่ deploy และนับแยกกันถ้ามีหลาย instance
--      ใช้ตัดสินใจว่า "เจ้าไหนใกล้เพดานแล้ว" ไม่ได้เลย และหน้าสถิติของแอดมิน
--      ก็อ่านอะไรไม่ได้ด้วย
--
--   2. ทะเบียนว่า "สาขานี้เคยไปถามที่อยู่มาแล้วเมื่อไร"
--      การเติมพิกัดสาขาอัตโนมัติต้องยิง ETrackings หนึ่งครั้งต่อหนึ่งสาขา
--      ถ้าไม่จำว่าเคยถามไปแล้ว สาขาที่หาที่อยู่ไม่ได้จะถูกถามซ้ำทุกครั้งที่มี
--      ผู้ใช้ผ่านจุดนั้น = เผาโควตาทิ้งไปเรื่อยๆ โดยไม่ได้อะไรกลับมา
--
-- ------------------------------------------------------------------ --
-- ⚠️ ทั้งสองอย่างเป็นข้อมูล "ของกลาง" ไม่ผูกกับผู้ใช้คนใด
--
-- ตั้งใจไม่มีคอลัมน์ user_id และห้ามเพิ่ม — เหตุผลเดียวกับ tracking_cache
-- (ดู 0003) และ carrier_branches (ดู 0004)
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
-- 1. โควตาที่ใช้ไปของแต่ละผู้ให้บริการ แยกตามเดือน
--
-- month เก็บเป็นข้อความ "YYYY-MM" ตามเวลาไทย ไม่ใช่ date หรือ timestamp
-- เพราะรอบบิลของผู้ให้บริการไทยนับตามเดือนไทย การเก็บเป็นข้อความที่ฝั่งแอป
-- คำนวณมาแล้ว (currentMonth() ใน lib/provider-usage.ts) ทำให้ไม่มีทางเพี้ยน
-- เพราะ timezone ของเซิร์ฟเวอร์ฐานข้อมูล
--
-- นับเป็น "จำนวน request ที่ยิงออกไปจริง" ไม่ใช่จำนวนเลขพัสดุ
-- ⚠️ Track123 คิดโควตาเป็นจำนวน "เลขพัสดุ" ต่อรอบบิล (ดู 0003) ตัวเลขในตารางนี้
-- จึงสูงกว่ายอดที่เขาคิดเงินเสมอ ใช้เป็นสัญญาณเตือน ไม่ใช่ยอดบิล
-- ------------------------------------------------------------------ --

create table if not exists public.provider_usage (
  -- "track123" | "etrackings" — ตรงกับ PROVIDER_IDS ใน lib/provider-usage.ts
  provider text not null,

  -- "2026-08" ตามเวลาไทย
  month text not null,

  call_count bigint not null default 0,

  first_call_at timestamptz not null default now(),
  last_call_at timestamptz not null default now(),

  primary key (provider, month),

  constraint provider_usage_month_check check (month ~ '^\d{4}-\d{2}$'),
  constraint provider_usage_count_check check (call_count >= 0)
);

-- หน้าสถิติอ่านทั้งเดือนล่าสุดของทุกเจ้า จึงเรียงตามเดือนจากใหม่ไปเก่า
create index if not exists provider_usage_month_idx
  on public.provider_usage (month desc, provider);

/*
 * นับหนึ่งครั้ง แล้วคืนยอดสะสมของเดือนนั้น
 *
 * ต้องเป็นฟังก์ชันใน Postgres ด้วยเหตุผลเดียวกับ record_unknown_branch:
 * upsert ของ supabase-js เขียนค่าคงที่ได้อย่างเดียว สั่งบวกไม่ได้ และการอ่าน
 * มาบวกแล้วเขียนกลับฝั่งแอปจะนับหายเมื่อสองคำขอมาพร้อมกัน
 *
 * คืนยอดใหม่กลับไปด้วย เพื่อให้ฝั่งแอปอัปเดตตัวนับใน memory ให้ตรงกับความจริง
 * ข้าม instance ได้โดยไม่ต้องอ่านซ้ำอีกรอบ
 *
 * security invoker (ค่าเริ่มต้น) โดยตั้งใจ — เหตุผลเดียวกับ 0004
 */
create or replace function public.bump_provider_usage(
  p_provider text,
  p_month text
) returns bigint
language sql
as $$
  insert into public.provider_usage (provider, month, call_count)
  values (p_provider, p_month, 1)
  on conflict (provider, month) do update
    set call_count = public.provider_usage.call_count + 1,
        last_call_at = now()
  returning call_count;
$$;

-- ------------------------------------------------------------------ --
-- 2. ทะเบียนสาขาที่ยังไม่รู้พิกัด — เพิ่มสามคอลัมน์
--
--   kind           สิ่งที่จดไว้เป็นอะไร ('branch' รหัสสาขา / 'address'
--                  ข้อความที่ดูเหมือนที่อยู่แต่หาพิกัดไม่เจอ / 'unknown' อ่านไม่ออก)
--                  เดิมจดเฉพาะรหัสสาขา ทำให้กรณีที่จบด้วย "ไม่มีแผนที่"
--                  อีกสองแบบหายไปเงียบๆ แอดมินจึงไม่มีทางรู้ว่าต้องเติมอะไรบ้าง
--
--   last_probe_at  ครั้งล่าสุดที่ระบบไปถาม ETrackings เพื่อขอที่อยู่ของสาขานี้
--   probe_count    ถามไปแล้วกี่ครั้ง — ไว้ดูว่าเผาโควตาไปเท่าไรกับสาขาที่หาไม่เจอ
-- ------------------------------------------------------------------ --

alter table public.unknown_branches
  add column if not exists kind text not null default 'branch';

alter table public.unknown_branches
  add column if not exists last_probe_at timestamptz;

alter table public.unknown_branches
  add column if not exists probe_count integer not null default 0;

do $$
begin
  alter table public.unknown_branches
    add constraint unknown_branches_kind_check
    check (kind in ('branch', 'address', 'unknown'));
exception
  when duplicate_object then null;
end;
$$;

/*
 * บันทึกว่าเจอสาขา/สถานที่ที่ยังไม่รู้พิกัดอีกครั้ง
 *
 * เปลี่ยนลายเซ็นจาก 3 เป็น 4 พารามิเตอร์ (เพิ่ม p_kind) จึงต้อง drop ตัวเดิม
 * ก่อน ไม่งั้นจะมีสองฟังก์ชันชื่อเดียวกันอยู่พร้อมกัน แล้วการเรียกด้วย 3
 * พารามิเตอร์จะกำกวมจน Postgres ปฏิเสธ
 */
drop function if exists public.record_unknown_branch(text, text, text);

create or replace function public.record_unknown_branch(
  p_carrier_code text,
  p_branch_code text,
  p_branch_name text,
  p_kind text
) returns void
language sql
as $$
  insert into public.unknown_branches (carrier_code, branch_code, branch_name, kind)
  values (
    p_carrier_code,
    p_branch_code,
    p_branch_name,
    coalesce(nullif(p_kind, ''), 'branch')
  )
  on conflict (carrier_code, branch_code) do update
    set hit_count = public.unknown_branches.hit_count + 1,
        last_seen_at = now(),
        -- ชื่อที่เพิ่งเจออาจว่าง อย่าไปทับของเดิมที่มีอยู่แล้ว
        branch_name = coalesce(
          excluded.branch_name,
          public.unknown_branches.branch_name
        );
$$;

/*
 * ขอสิทธิ์ไปถามที่อยู่ของสาขานี้ — คืน true เมื่อได้สิทธิ์เท่านั้น
 *
 * นี่คือด่านกันเผาโควตาที่แข็งที่สุดในสามด่าน (อีกสองด่านอยู่ฝั่งแอป:
 * เพดานต่อวันของโปรเซส และการเอียงหนีเมื่อโควตาใกล้เต็ม) เพราะมันเป็น atomic
 * ในฐานข้อมูล — สองคำขอที่มาพร้อมกันจะมีแค่คำขอเดียวที่ได้ true ต่อให้มาจาก
 * คนละ instance ก็ตาม
 *
 * update ... where last_probe_at is null or last_probe_at < ตัดเวลาไปแล้ว
 * ทำหน้าที่ทั้งเช็คและจองในคำสั่งเดียว จึงไม่มีช่องว่างระหว่าง "อ่านว่าว่าง"
 * กับ "จอง" ให้คำขออื่นแทรกเข้ามาได้
 *
 * สาขาที่หาที่อยู่ไม่เจอจะถูกถามซ้ำอีกทีเมื่อพ้น cooldown (ค่าเริ่มต้น 7 วัน)
 * ไม่ใช่ห้ามถามตลอดกาล เพราะขนส่งอาจเริ่มส่งที่อยู่มาในภายหลัง
 */
create or replace function public.claim_branch_probe(
  p_carrier_code text,
  p_branch_code text,
  p_cooldown_hours integer
) returns boolean
language plpgsql
as $$
declare
  v_claimed boolean;
begin
  update public.unknown_branches
     set last_probe_at = now(),
         probe_count = probe_count + 1
   where carrier_code = p_carrier_code
     and branch_code = p_branch_code
     and (
       last_probe_at is null
       or last_probe_at < now() - make_interval(hours => greatest(p_cooldown_hours, 0))
     )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

-- ------------------------------------------------------------------ --
-- 3. cache ผลหาพิกัด — เพิ่มความละเอียดของผลลัพธ์
--
-- Google บอกมาอยู่แล้วว่าพิกัดที่คืนมาเป็น "ตรงตัวอาคาร" หรือ "กลางพื้นที่"
-- (geometry.location_type) แต่เดิมเราทิ้งค่านั้นไป
--
-- ตอนนี้จำเป็นต้องเก็บ เพราะเส้นทางเติมพิกัดสาขาอัตโนมัติเขียนลง
-- carrier_branches ซึ่งเป็นตารางที่ทั้งระบบเชื่อว่า "ถูกต้องแน่นอน" การปล่อย
-- ให้หมุดกลางอำเภอเข้าไปนั่งในนั้นคือการทำบั๊กเดิมกลับมาแบบถาวรและมองไม่เห็น
-- (ดู lib/geocode.ts และ lib/branch-harvest.ts)
--
-- null = แถวเก่าที่บันทึกไว้ก่อนมีคอลัมน์นี้ ถือว่า "ไม่รู้ความละเอียด"
-- เส้นทางเติมพิกัดอัตโนมัติจะไม่ใช้แถวเหล่านั้น ส่วนการแสดงผลปกติใช้ได้เหมือนเดิม
-- ------------------------------------------------------------------ --

alter table public.geocode_cache
  add column if not exists precision text;

do $$
begin
  alter table public.geocode_cache
    add constraint geocode_cache_precision_check
    check (
      precision is null
      or precision in ('rooftop', 'range', 'center', 'approximate')
    );
exception
  when duplicate_object then null;
end;
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับ 0004/0005 ทุกประการ
--
-- anon กับ authenticated ไม่มีสิทธิ์อะไรทั้งสิ้น เข้าถึงได้ทางเดียวคือ
-- service role ฝั่งเซิร์ฟเวอร์ และ RLS เปิดไว้โดยไม่มี policy ใดๆ
-- ------------------------------------------------------------------ --

revoke all on table public.provider_usage from anon, authenticated;

revoke all on function public.bump_provider_usage(text, text) from anon, authenticated, public;
revoke all on function public.record_unknown_branch(text, text, text, text) from anon, authenticated, public;
revoke all on function public.claim_branch_probe(text, text, integer) from anon, authenticated, public;

grant select, insert, update, delete on table public.provider_usage to service_role;

grant execute on function public.bump_provider_usage(text, text) to service_role;
grant execute on function public.record_unknown_branch(text, text, text, text) to service_role;
grant execute on function public.claim_branch_probe(text, text, integer) to service_role;

alter table public.provider_usage enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select provider, month, call_count from public.provider_usage order by month desc;
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'unknown_branches';
--   -- ต้องเห็น kind, last_probe_at, probe_count
--
--   select has_function_privilege(
--     'service_role',
--     'public.record_unknown_branch(text, text, text, text)',
--     'execute'
--   );   -- ต้องได้ true
-- ------------------------------------------------------------------ --
