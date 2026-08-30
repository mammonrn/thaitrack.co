/**
 * รีเฟรช session ของ Supabase ก่อนที่หน้าเว็บจะถูก render
 *
 * ตั้งแต่ Next.js 16 ไฟล์ middleware.ts ถูกเปลี่ยนชื่อเป็น proxy.ts และ export
 * ชื่อ `proxy` (ดู node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md)
 * เอกสารของ Supabase ยังเขียนเป็น middleware.ts อยู่ ถ้าทำตามนั้นไฟล์จะไม่ถูกเรียกเลย
 *
 * access token ของ Supabase อายุสั้น ถ้าไม่มีใครรีเฟรชให้ ผู้ใช้จะหลุด session
 * เองแบบสุ่ม ที่นี่จึงเรียก getUser() ทุก request เพื่อให้ token ที่ใกล้หมดอายุ
 * ถูกต่ออายุแล้วเขียนกลับลง cookie ของ response
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/supabase/env";

export async function proxy(request: NextRequest) {
  const result = readSupabaseEnv();

  // ยังไม่ได้ตั้งค่า Supabase → ปล่อยผ่าน ส่วนติดตามพัสดุยังใช้งานได้ตามปกติ
  if (!result.ok) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(result.env.url, result.env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }

        // header กัน CDN/reverse proxy แคช response ที่มี cookie ของ session
        // ไม่งั้น session ของคนหนึ่งอาจถูกเสิร์ฟให้อีกคน
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // ห้ามตัดบรรทัดนี้ทิ้ง — การเรียก getUser() คือสิ่งที่ทำให้ token ถูกรีเฟรช
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // ข้ามไฟล์ static และรูปภาพ เพราะไม่ต้องรีเฟรช session ให้
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
