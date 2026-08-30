/**
 * ปลายทางที่ Google ส่งผู้ใช้กลับมาหลังกดยินยอม
 *
 * Supabase ใช้ PKCE flow: ขากลับจะได้ `code` มาใน query string แล้วต้องเอา code
 * นั้นไปแลกเป็น session ฝั่ง server เพื่อให้ cookie ถูกตั้งแบบที่ server อ่านได้
 */

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** ต้องรันบน Node.js runtime เพราะอ่าน process.env และเขียน cookie ของ session */
export const runtime = "nodejs";

/**
 * หา URL จริงของเว็บ
 *
 * หลัง reverse proxy (เช่น Vercel) ค่า origin ใน request.url เป็นที่อยู่ภายใน
 * ถ้า redirect ด้วยค่านั้นผู้ใช้จะถูกส่งไปโดเมนที่เข้าไม่ได้ จึงต้องอ่านจาก
 * header ที่ proxy แนบมาก่อนเสมอ
 */
function resolveBaseUrl(request: Request, fallbackOrigin: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return fallbackOrigin;

  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const baseUrl = resolveBaseUrl(request, origin);

  const failureUrl = (code: string) =>
    NextResponse.redirect(`${baseUrl}/?auth_error=${code}`);

  // Google ปฏิเสธหรือผู้ใช้กดยกเลิก
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (oauthError !== null) {
    console.error(`[auth/callback] ${oauthError}`);
    return failureUrl("oauth_failed");
  }

  const code = searchParams.get("code");
  if (code === null) {
    console.error("[auth/callback] ไม่พบ code ใน query string");
    return failureUrl("oauth_failed");
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error(`[auth/callback] แลก code ไม่สำเร็จ: ${error.message}`);

      // ต่อไปหา Supabase ไม่ติด/หมดเวลารอ เป็นคนละเรื่องกับ code ที่ใช้ไม่ได้
      // ผู้ใช้ควรได้คำแนะนำให้ตรวจอินเทอร์เน็ต ไม่ใช่ให้กดล็อกอินใหม่ไปเรื่อยๆ
      if (isAuthRetryableFetchError(error)) return failureUrl("network_error");

      return failureUrl("oauth_failed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth/callback] ${message}`);

    // ตั้งค่า env ไม่ครบ เป็นคนละเรื่องกับต่อ Supabase ไม่ติด ผู้ใช้ควรได้คำแนะนำ
    // ที่ตรงกับสาเหตุจริง และผู้ดูแลระบบต้องแยกสองกรณีนี้ออกจากกันได้จาก log
    if (error instanceof SupabaseConfigError) return failureUrl("config_missing");

    return failureUrl("network_error");
  }

  return NextResponse.redirect(baseUrl);
}
