/**
 * Supabase client สำหรับฝั่ง server (Route Handler และ Server Component)
 *
 * ต้องสร้างใหม่ทุก request ห้ามแชร์ข้าม request เพราะ client ผูกกับ cookie
 * ของผู้ใช้คนนั้น การแชร์จะทำให้ session ของคนหนึ่งหลุดไปหาอีกคน
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { readSupabaseEnv, SupabaseConfigError } from "./env";
import { createTimeoutFetch } from "./fetch";

/**
 * cookies() ของ Next 15 ขึ้นไปเป็น async function จึงต้อง await
 * และทำให้ฟังก์ชันนี้เป็น async ตามไปด้วย
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const result = readSupabaseEnv();
  if (!result.ok) throw new SupabaseConfigError(result.missing);

  const cookieStore = await cookies();

  return createServerClient(result.env.url, result.env.anonKey, {
    global: { fetch: createTimeoutFetch() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component เขียน cookie ไม่ได้ (เขียนได้เฉพาะใน Route Handler
          // กับ Server Function) กรณีนั้น proxy.ts รีเฟรช session ให้อยู่แล้ว
        }
      },
    },
  });
}
