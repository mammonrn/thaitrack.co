/**
 * GET /auth/callback — ปลายทางที่ Google (ผ่าน Supabase) ส่งผู้ใช้กลับมาหลังยืนยันตัวตน
 *
 * หน้าที่เดียวของ route นี้คือเอา `code` ที่ติดมากับ URL ไปแลกเป็น session
 * แล้วเขียน session ลง cookie ก่อนพาผู้ใช้กลับไปหน้าเดิม
 *
 * ทำไมต้องแลกฝั่ง server: createBrowserClient เก็บ PKCE code verifier ไว้ใน cookie
 * (ดู lib/supabase/client.ts) route นี้จึงอ่าน verifier ตัวเดียวกันได้
 * และ session ที่ได้จะถูกเขียนกลับเป็น cookie ที่ทั้ง server และ browser อ่านตรงกัน
 *
 * cookie ที่ @supabase/ssr สั่งเขียนถูกพักไว้ในตัวแปรก่อน แล้วค่อยยกลง response
 * ตอนท้าย เพราะปลายทางของ redirect ขึ้นกับว่าแลก code สำเร็จหรือไม่ —
 * สำเร็จถึงจะติดธงทักทายกลับไป
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { WELCOME_PARAM } from "@/lib/auth-view";

/** ที่ที่จะพาผู้ใช้กลับไปเมื่อไม่ได้ระบุ หรือระบุมาแบบที่ไว้ใจไม่ได้ */
const DEFAULT_REDIRECT = "/";

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * รับเฉพาะ path ภายในเว็บเราเท่านั้น เพื่อกันไม่ให้ใครยัด URL ภายนอกมาใน ?next=
 * แล้วใช้หน้า login ของเราเป็นทางผ่านไปเว็บหลอกลวง (open redirect)
 *
 * "//evil.com" ต้องถูกปฏิเสธด้วย เพราะเบราว์เซอร์อ่านว่าเป็น protocol-relative URL
 */
function safeRedirectPath(next: string | null): string {
  if (!next) return DEFAULT_REDIRECT;
  if (!next.startsWith("/") || next.startsWith("//")) return DEFAULT_REDIRECT;
  return next;
}

function readSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = safeRedirectPath(requestUrl.searchParams.get("next"));

  /** สร้าง redirect กลับหน้าเว็บ — `welcome` เอาไว้บอกว่า "เพิ่งล็อกอินเสร็จ" */
  const redirectHome = (welcome: boolean) => {
    const target = new URL(next, requestUrl.origin);
    if (welcome) target.searchParams.set(WELCOME_PARAM, "1");
    return NextResponse.redirect(target);
  };

  // ผู้ใช้กดยกเลิกที่หน้า Google หรือ Supabase ปฏิเสธคำขอ — ไม่มีอะไรให้แลก
  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    console.error(
      `[auth/callback] ผู้ให้บริการปฏิเสธการเข้าสู่ระบบ: ${oauthError} — ${requestUrl.searchParams.get("error_description") ?? "ไม่มีรายละเอียด"}`,
    );
    return redirectHome(false);
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    console.error("[auth/callback] ถูกเรียกโดยไม่มีพารามิเตอร์ code");
    return redirectHome(false);
  }

  const env = readSupabaseEnv();
  if (!env) {
    console.error(
      "[auth/callback] ไม่พบ environment variable NEXT_PUBLIC_SUPABASE_URL หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    return redirectHome(false);
  }

  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        pendingCookies.push(...cookiesToSet);
        // response ที่ตั้ง auth cookie ต้องไม่ถูก CDN หรือ proxy เก็บ cache ไว้
        // ไม่งั้น session ของคนหนึ่งจะถูกส่งให้อีกคน — @supabase/ssr ส่ง header
        // ชุดกัน cache มาให้ทางพารามิเตอร์ตัวนี้
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  // ถ้ามีหลาย PKCE flow ค้างพร้อมกัน sb_flow_id บอกว่าให้ใช้ verifier ตัวไหน
  // (พารามิเตอร์นี้จะติดมาก็ต่อเมื่อเปิด experimental.appendPkceFlowIdToRedirects
  //  ไม่มีก็ไม่เป็นไร — auth-js จะใช้ verifier ที่เก็บล่าสุดแทน)
  const flowId = requestUrl.searchParams.get("sb_flow_id");

  const { error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );

  if (error) {
    // log ไว้ฝั่ง server เท่านั้น แล้วพากลับหน้าเดิมในสถานะยังไม่ได้ล็อกอิน
    console.error(`[auth/callback] แลก code เป็น session ไม่สำเร็จ: ${error.message}`);
  }

  // ยกทุกอย่างที่ @supabase/ssr สั่งเขียนลง response จริง
  // (ต้องทำแม้ตอน error เพราะอาจมีคำสั่งลบ verifier ที่ใช้ไปแล้วปนมาด้วย)
  const response = redirectHome(!error);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(pendingHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}
