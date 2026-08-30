/**
 * Supabase client สำหรับฝั่งเบราว์เซอร์
 *
 * ใช้ createBrowserClient ของ @supabase/ssr (ไม่ใช่ createClient ของ supabase-js)
 * เพราะต้องเก็บ session ไว้ใน cookie ให้ฝั่ง server อ่านได้ด้วย
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readSupabaseEnv, SupabaseConfigError } from "./env";

/**
 * สร้าง client สำหรับเบราว์เซอร์
 *
 * โยน SupabaseConfigError เมื่อตั้งค่า environment variable ไม่ครบ
 * ผู้เรียกต้องดักไว้เสมอ (ดู lib/auth-view.ts) ห้ามปล่อยให้หลุดไปเงียบๆ
 */
export function getBrowserClient(): SupabaseClient {
  const result = readSupabaseEnv();
  if (!result.ok) throw new SupabaseConfigError(result.missing);

  // createBrowserClient เป็น singleton อยู่แล้ว เรียกซ้ำได้ไม่สิ้นเปลือง
  return createBrowserClient(result.env.url, result.env.anonKey);
}
