/**
 * Supabase client ที่ใช้ service role key — ฝั่งเซิร์ฟเวอร์เท่านั้น
 *
 * ต่างจาก createServerSupabaseClient() ใน ./server.ts สองข้อ:
 *   1. ไม่ผูกกับ cookie หรือ session ของผู้ใช้คนไหนเลย จึงแชร์ข้าม request ได้
 *      และสร้างครั้งเดียวพอ (ตัวที่ผูก session ห้ามแชร์เด็ดขาด)
 *   2. ข้าม Row Level Security ได้ทุกตาราง
 *
 * ⚠️ ข้อ 2 คือเหตุผลที่ไฟล์นี้อันตรายที่สุดในโปรเจกต์ ใช้กับตารางที่ตั้งใจให้
 * เป็นของกลางฝั่งเซิร์ฟเวอร์เท่านั้น (ตอนนี้คือ public.tracking_cache)
 * ห้ามใช้แตะข้อมูลที่ผูกกับผู้ใช้ — ตารางพวกนั้นต้องผ่าน client ที่ถือ session
 * ของผู้ใช้จริง เพื่อให้ RLS ทำงานตามที่ออกแบบไว้
 *
 * ถ้าไม่ได้ตั้ง SUPABASE_SERVICE_ROLE_KEY ไว้ ฟังก์ชันนี้คืน null เฉยๆ ไม่ throw
 * เพราะฟีเจอร์ที่ใช้มันเป็นของเสริมที่ขาดได้ — ระบบต้องยังค้นพัสดุได้ตามปกติ
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  SUPABASE_SERVICE_ROLE_KEY_VAR,
  readSupabaseEnv,
  readSupabaseServiceRoleKey,
} from "./env";
import { createTimeoutFetch } from "./fetch";
import { describeKeyProblem, readKeyRole } from "./key-role";

/** สร้างครั้งเดียวต่อโปรเซส — ไม่มี state ของผู้ใช้จึงแชร์ได้ */
let cached: SupabaseClient | null = null;

/** เตือนแค่ครั้งเดียวตอนเริ่ม ไม่ใช่ทุก request */
let warned = false;

/**
 * client ที่พร้อมใช้ หรือ null เมื่อยังตั้งค่าไม่ครบ
 *
 * ผู้เรียกต้องรับมือกับ null ได้เสมอ — อย่าใช้ `!` หรือ throw ต่อ
 */
export function getServiceSupabaseClient(): SupabaseClient | null {
  if (cached !== null) return cached;

  // ด่านสุดท้ายกันความผิดพลาด: ค่าที่ไม่ขึ้นต้นด้วย NEXT_PUBLIC_ ไม่ถูกฝังลง
  // bundle ฝั่งเบราว์เซอร์อยู่แล้ว แต่ถ้าวันหนึ่งมีใครเผลอ import ไฟล์นี้เข้า
  // client component ให้พังดังๆ ตรงนี้ ดีกว่าปล่อยให้ไปพังแบบเงียบทีหลัง
  if (typeof window !== "undefined") {
    throw new Error(
      "lib/supabase/service.ts ถูกเรียกจากฝั่ง client — ไฟล์นี้ใช้ได้เฉพาะฝั่งเซิร์ฟเวอร์",
    );
  }

  const env = readSupabaseEnv();
  const serviceRoleKey = readSupabaseServiceRoleKey();

  if (!env.ok || serviceRoleKey === "") {
    if (!warned) {
      warned = true;
      console.warn(
        `[supabase] ยังไม่ได้ตั้ง ${SUPABASE_SERVICE_ROLE_KEY_VAR} — cache ถาวรถูกปิด ใช้ cache ใน memory อย่างเดียว`,
      );
    }
    return null;
  }

  /* ---- ตรวจว่า key ที่ได้มาเป็นของ service_role จริงหรือไม่ ----
   *
   * key ของ anon กับ service_role หน้าตาเหมือนกันทุกประการ ต่างกันแค่ claim
   * ข้างใน การวางสลับช่องจึงเกิดได้ง่ายและไม่มีอะไรเตือน ระบบจะดูเหมือน
   * ตั้งค่าครบแต่ทุก request โดน permission denied — ซึ่งเกิดขึ้นจริงมาแล้ว
   * บน production หลัง deploy #13
   *
   * ตรวจตรงนี้ทำให้รู้ตั้งแต่ครั้งแรกที่ใช้งาน แทนที่จะต้องไปเจอ error
   * รายคำขอแล้วค่อยไล่หาสาเหตุ
   */
  const keyRole = readKeyRole(serviceRoleKey);
  const problem = describeKeyProblem(serviceRoleKey, SUPABASE_SERVICE_ROLE_KEY_VAR);

  if (keyRole.kind === "client_role") {
    // รู้แน่ว่าผิด → ไม่สร้าง client เลย ดีกว่าปล่อยให้ยิงแล้วโดนปฏิเสธทุกครั้ง
    // ผลคือระบบตกไปใช้ cache ใน memory ซึ่งยังทำงานได้ ไม่ใช่พังทั้งเว็บ
    if (!warned) {
      warned = true;
      console.error(`[supabase] ${problem}`);
    }
    return null;
  }

  if (!warned) {
    warned = true;
    // อ่าน role ไม่ออกไม่ใช่ความผิดพลาดเสมอไป (key รูปแบบใหม่อาจไม่ใช่ JWT)
    // จึงแค่บอกไว้แล้วใช้งานต่อ ไม่ปฏิเสธ
    if (problem !== null) console.warn(`[supabase] ${problem}`);
    else {
      console.info(
        `[supabase] service client พร้อมใช้งาน role=${keyRole.role} — cache ถาวรและตารางของกลางใช้ได้`,
      );
    }
  }

  cached = createClient(env.env.url, serviceRoleKey, {
    // ไม่มีผู้ใช้ให้จำ และห้ามเขียน session ลงที่ไหนทั้งนั้น
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    // เหตุผลเดียวกับ ./server.ts — supabase-js ไม่มี timeout มาให้
    global: { fetch: createTimeoutFetch() },
  });

  return cached;
}

/** ล้าง client ที่จำไว้ — ใช้ในเทสต์เท่านั้น */
export function resetServiceSupabaseClient(): void {
  cached = null;
  warned = false;
}
