-- นับ funnel ของการ์ดชวนติดตั้งแอป: แสดงกี่ครั้ง → กดปิดกี่ครั้ง → กดติดตั้งกี่ครั้ง
--
-- ปัญหาที่แก้: ตอนนี้เรารู้แค่ว่า "มีคนติดตั้งแอพกี่ครั้ง" (install_events) แต่ไม่รู้
-- ว่าคนเห็นคำชวนกี่ครั้ง จึงคำนวณ conversion rate ไม่ได้เลย และตัดสินไม่ได้ว่า
-- ควรปรับถ้อยคำ ปรับจังหวะที่แสดง หรือเลิกทำไปเลย
--
-- ------------------------------------------------------------------ --
-- ⚠️ ทำไมเป็นตารางใหม่ ไม่ใช่คอลัมน์เพิ่มใน install_events
--
-- install_events มีนิยามชัดว่า "หนึ่งแถวต่อหนึ่งครั้งที่เบราว์เซอร์ยิง appinstalled"
-- และ admin_install_stats() นับ count(*) ของทั้งตารางตรงๆ ถ้าเอา event ชนิดอื่น
-- มาปนในตารางเดียวกัน ตัวเลข "จำนวนการติดตั้ง" ที่ใช้อยู่แล้วจะพองขึ้นทันทีโดย
-- ไม่มีใครทันสังเกต — ตัวเลขที่ความหมายเปลี่ยนเงียบๆ แย่กว่าตัวเลขที่หายไป
--
-- ⚠️ ข้อบังคับด้านความเป็นส่วนตัวเหมือนเดิมทุกประการ (ดู 0007)
--
-- เก็บแค่ "เกิดอะไรขึ้น เมื่อไร บนแพลตฟอร์มกว้างๆ อะไร" — ไม่มี user id
-- ไม่มี IP ไม่มี user agent เต็ม ไม่มีเลขพัสดุ ฟังก์ชันคืนได้แค่ตัวเลขรวม
--
-- endpoint ที่เขียนตารางนี้ไม่ต้องล็อกอิน จึงยิงปลอมได้เหมือน install_events
-- ตัวเลขนี้จึงเป็น "อย่างมากเท่านี้" ใช้ตัดสินใจภายในเท่านั้น
-- ------------------------------------------------------------------ --

create table if not exists public.install_prompt_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),

  -- shown     การ์ดโผล่ให้เห็นจริง (นับครั้งเดียวต่อเซสชัน)
  -- dismissed ผู้ใช้กดกากบาทปิด
  -- clicked   ผู้ใช้กดปุ่มติดตั้ง (คนละเรื่องกับติดตั้งสำเร็จ ซึ่งอยู่ใน install_events)
  action text not null,

  platform text not null default 'unknown',

  constraint install_prompt_events_action_check check (
    action in ('shown', 'dismissed', 'clicked')
  ),
  constraint install_prompt_events_platform_check check (
    platform in ('android', 'ios', 'desktop', 'unknown')
  )
);

create index if not exists install_prompt_events_occurred_idx
  on public.install_prompt_events (occurred_at desc);

/*
 * funnel ของการ์ดชวนติดตั้ง
 *
 * ⚠️ ตัวเลขสามตัวนี้ไม่ได้มาจากคนกลุ่มเดียวกันเป๊ะๆ — "shown" นับครั้งเดียวต่อ
 * เซสชัน ส่วน "clicked" กับ "dismissed" นับทุกครั้งที่กด (ซึ่งในทางปฏิบัติเกิด
 * ได้ครั้งเดียวต่อเซสชันอยู่แล้ว เพราะกดแล้วการ์ดหายไป) จึงเทียบกันได้ในระดับ
 * "พอบอกทิศทาง" ไม่ใช่ตัวเลขบัญชี
 */
create or replace function public.admin_install_prompt_stats(p_days integer)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'shown',     count(*) filter (where action = 'shown'),
    'dismissed', count(*) filter (where action = 'dismissed'),
    'clicked',   count(*) filter (where action = 'clicked')
  )
  from public.install_prompt_events
  where p_days <= 0
     or occurred_at >= now() - make_interval(days => p_days);
$$;

-- ------------------------------------------------------------------ --
-- สิทธิ์ — กติกาเดียวกับตารางของกลางอื่นทุกประการ
-- ------------------------------------------------------------------ --

revoke all on table public.install_prompt_events from anon, authenticated;

revoke all on function public.admin_install_prompt_stats(integer) from anon, authenticated, public;

grant select, insert on table public.install_prompt_events to service_role;

grant execute on function public.admin_install_prompt_stats(integer) to service_role;

alter table public.install_prompt_events enable row level security;

-- ไม่มี create policy ที่นี่โดยตั้งใจ (เหตุผลเดียวกับ 0004)

-- ------------------------------------------------------------------ --
-- ตรวจผลหลังรัน
--
--   select public.admin_install_prompt_stats(30);
--
-- การกวาดของเก่า (ถ้าวันหนึ่งอยากตัดทิ้ง หน้าสถิติมองย้อนแค่ 30 วัน):
--
--   delete from public.install_prompt_events
--   where occurred_at < now() - interval '1 year';
-- ------------------------------------------------------------------ --
