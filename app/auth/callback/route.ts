/**
 * ปลายทางที่ Google ส่งผู้ใช้กลับมาหลังกดยินยอม
 *
 * Supabase ใช้ PKCE flow: ขากลับจะได้ `code` มาใน query string แล้วต้องเอา code
 * นั้นไปแลกเป็น session ฝั่ง server เพื่อให้ cookie ถูกตั้งแบบที่ server อ่านได้
 */

import { NextResponse } from "next/server";

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
      return failureUrl("oauth_failed");
    }
  } catch (error) {
    // ส่วนใหญ่คือ SupabaseConfigError — ตั้งค่า env บน production ไม่ครบ
    console.error(
      `[auth/callback] ${error instanceof Error ? error.message : String(error)}`,
    );
    return failureUrl("config_missing");
  }

  return NextResponse.redirect(baseUrl);
}
