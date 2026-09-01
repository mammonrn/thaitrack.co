-- นับ "ช่องทางที่มา" ของผู้เข้าชมแบบรวม เพื่อรู้ว่าควรลงแรงที่ช่องทางไหน
--
-- ------------------------------------------------------------------ --
-- ⚠️ ข้อบังคับด้านความเป็นส่วนตัวเหมือนเดิมทุกประการ (ดู 0007)
--
-- ตารางนี้เก็บแค่ "วันไหน ช่องทางไหน กี่ครั้ง" — สามคอลัมน์เท่านั้น
--   ไม่มี user_id  ไม่มี IP  ไม่มี user agent  ไม่มี referrer เต็ม
--
-- "referrer เต็ม" เป็นข้อมูลที่ล่อใจเพราะมีประโยชน์กว่า แต่มันคือการรู้ว่า
-- คนคนหนึ่งเพิ่งอ่านอะไรอยู่ก่อนมาถึงเรา ซึ่งไม่ใช่เรื่องของเรา — ฝั่งเบราว์เซอร์
-- จำแนกเป็นคำเดียวก่อนส่ง (ดู lib/referrer-channel.ts) เซิร์ฟเวอร์จึงไม่เคย
-- เห็น URL ต้นทางเลยแม้แต่ครั้งเดียว
--
-- เป็นตัวนับรวมต่อวัน ไม่ใช่หนึ่งแถวต่อหนึ่งครั้ง เพราะแถวรายครั้งพร้อม
-- timestamp ละเอียดเอาไปเทียบกับตารางอื่นได้ ส่วนตัวนับรายวันทำไม่ได้
-- ------------------------------------------------------------------ --

create table if not exists public.referrer_daily (
  -- วันตามเวลาไทย — เซิร์ฟเวอร์เป็นคนกำหนด ไม่ใช่รับจากฝั่งเบราว์เซอร์
  day date not null,

  channel text not null,

  visits bigint not null default 0,

  primary key (day, channel),

  constraint referrer_daily_channel_check check (
    channel in ('google', 'facebook', 'tiktok', 'line', 'instagram', 'direct', 'other')
  ),
  constraint referrer_daily_visits_check check (visits >= 0)
);

create index if not exists referrer_daily_day_idx
  on public.referrer_daily (day desc, channel);

/*
 * นับหนึ่งครั้ง
 *
 * วันถูกคำนวณในฐานข้อมูลด้วยเวลาไทย ไม่ได้รับมาจากฝั่งเบราว์เซอร์ — นาฬิกา
 * ของเครื่องผู้ใช้ตั้งผิดได้ และค่าที่รับมาจากภายนอกไม่ควรกลายเป็น key ของตาราง
 *
 * ต้องเป็นฟังก์ชันด้วยเหตุผลเดียวกับ bump_provider_usage: upsert ของ supabase-js
 * สั่งบวกไม่ได้ และการอ่านมาบวกแล้วเขียนกลับจะนับหายเมื่อสองคำขอมาพร้อมกัน
 */
create or replace function public.bump_referrer_visit(p_channel text)
returns void
language sql
as $$
  insert into public.referrer_daily (day, channel, visits)
  values ((now() at time zone 'Asia/Bangkok')::date, p_channel, 1)
  on conflict (day, channel) do update
    set visits = public.referrer_daily.visits + 1;
$$;

/* ยอดรวมแยกตามช่องทางในกี่วันล่าสุด — เรียงจากที่มากที่สุด */
create or replace function public.admin_referrer_channels(p_days integer)
returns table (channel text, total bigint)
language sql
stable
as $$
  select channel, sum(visits)::bigint as total
  from public.referrer_daily
  where p_days <= 0
     or day >= ((now() at time zone 'Asia/Bangkok')::date - (p_days - 1))
  group by channel
  order by sum(visits) desc, channel;
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับตารางของกลางอื่นทุกประการ
-- ------------------------------------------------------------------ --

revoke all on table public.referrer_daily from anon, authenticated;

revoke all on function public.bump_referrer_visit(text) from anon, authenticated, public;
revoke all on function public.admin_referrer_channels(integer) from anon, authenticated, public;

grant select, insert, update on table public.referrer_daily to service_role;

grant execute on function public.bump_referrer_visit(text) to service_role;
grant execute on function public.admin_referrer_channels(integer) to service_role;

alter table public.referrer_daily enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select * from public.admin_referrer_channels(30);
--   select * from public.referrer_daily order by day desc limit 20;
-- ------------------------------------------------------------------ --
