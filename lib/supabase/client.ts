/**
 * Supabase client ฝั่ง browser — ใช้ทำ login/logout และอ่านสถานะผู้ใช้ปัจจุบัน
 *
 * ใช้ createBrowserClient ของ @supabase/ssr แทน createClient ของ @supabase/supabase-js
 * เพราะตัวนี้เก็บ session (และ PKCE code verifier) ไว้ใน "cookie" ไม่ใช่ localStorage
 * ซึ่งจำเป็นสำหรับให้ app/auth/callback/route.ts ที่รันฝั่ง server
 * อ่าน verifier เดียวกันไปแลก code เป็น session ต่อได้
 * (ถ้าเก็บใน localStorage ฝั่ง server จะมองไม่เห็น แล้ว callback จะแลกไม่สำเร็จ)
 *
 * createBrowserClient คืน instance เดิมแบบ singleton เมื่ออยู่ใน browser
 * จึงเรียกฟังก์ชันนี้ซ้ำได้โดยไม่สร้าง client ใหม่ทุกครั้ง
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ต้องเขียน process.env.NEXT_PUBLIC_... เต็มๆ ตรงนี้ ห้ามอ่านผ่านตัวแปรกลาง
 * เพราะ Next แทนค่าตอน build เฉพาะรูปแบบที่เขียนตรงๆ เท่านั้น
 * (ดู node_modules/next/dist/docs/01-app/02-guides/environment-variables.md)
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * สร้าง (หรือคืนตัวเดิม) Supabase client สำหรับใช้ใน component ฝั่ง client
 *
 * โยน Error เมื่อยังไม่ได้ตั้งค่า env — ผู้เรียกต้องดักไว้แล้วปิดปุ่มเข้าสู่ระบบ
 * แทนที่จะปล่อยให้ผู้ใช้กดแล้วเงียบไปเฉยๆ
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "ไม่พบ environment variable NEXT_PUBLIC_SUPABASE_URL หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
