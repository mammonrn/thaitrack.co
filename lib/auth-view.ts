/**
 * ตัวกลางระหว่างปุ่มเข้าสู่ระบบกับ Supabase Auth
 *
 * แยกออกมาด้วยเหตุผลเดียวกับ tracking-view.ts คือให้ component เหลือแค่การ
 * แสดงผล และให้ทุกทางที่ล้มเหลว "มีปลายทางเป็นข้อความไทยเสมอ" ไม่มีเส้นทางไหน
 * ที่จบลงโดยผู้ใช้ไม่เห็นอะไรเลย ซึ่งเป็นอาการเดิมของปุ่มนี้ก่อนหน้านี้
 */

import { getBrowserClient } from "./supabase/client";
import { SupabaseConfigError } from "./supabase/env";
import type { UserFacingError } from "./tracking-view";

export type AuthErrorCode =
  | "config_missing"
  | "oauth_failed"
  | "network_error"
  | "signout_failed"
  | "unknown";

/** ข้อความบอก "เกิดอะไรขึ้น + ทำอะไรต่อได้" ไม่มีศัพท์เทคนิค ไม่มีรหัส error */
export const AUTH_ERROR_MESSAGE: Record<AuthErrorCode, UserFacingError> = {
  config_missing: {
    title: "ระบบสมาชิกยังไม่พร้อมใช้งาน",
    detail:
      "ไม่ใช่ความผิดของคุณ ทีมงานยังตั้งค่าระบบไม่เสร็จ ระหว่างนี้ยังค้นหาพัสดุได้ตามปกติโดยไม่ต้องเข้าสู่ระบบ",
  },
  oauth_failed: {
    title: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ",
    detail:
      "อาจกดยกเลิกระหว่างทาง หรือ Google ไม่อนุญาตในครั้งนี้ ลองกดเข้าสู่ระบบอีกครั้ง",
  },
  network_error: {
    title: "เชื่อมต่อไม่สำเร็จ",
    detail: "ตรวจสัญญาณอินเทอร์เน็ตหรือ Wi-Fi ของคุณ แล้วลองอีกครั้ง",
  },
  signout_failed: {
    title: "ออกจากระบบไม่สำเร็จ",
    detail: "ลองกดอีกครั้ง ถ้ายังไม่ได้ ให้ปิดแท็บนี้แล้วเปิดเว็บใหม่",
  },
  unknown: {
    title: "เกิดปัญหาที่เราไม่รู้จัก",
    detail: "ลองกดอีกครั้ง ถ้ายังไม่ได้ ลองใหม่ในอีกสักครู่",
  },
};

export type AuthOutcome = { ok: true } | { ok: false; error: UserFacingError };

function fail(code: AuthErrorCode): AuthOutcome {
  return { ok: false, error: AUTH_ERROR_MESSAGE[code] };
}

/**
 * แปลง error ที่ดักได้เป็นรหัสที่เรารู้จัก พร้อม log รายละเอียดจริงไว้ที่ console
 * เพื่อให้ยังตามปัญหาต่อได้ โดยที่ผู้ใช้เห็นแค่ข้อความที่อ่านรู้เรื่อง
 */
function classify(context: string, error: unknown): AuthErrorCode {
  console.error(
    `[auth] ${context}: ${error instanceof Error ? error.message : String(error)}`,
  );

  if (error instanceof SupabaseConfigError) return "config_missing";
  if (error instanceof TypeError) return "network_error";

  return "unknown";
}

/**
 * พาผู้ใช้ไปหน้ายินยอมของ Google
 *
 * เมื่อสำเร็จเบราว์เซอร์จะถูกพาออกจากหน้านี้ทันที โค้ดหลัง await จึงมักไม่ได้รัน
 * ผู้เรียกยังต้องดัก { ok: false } ไว้เสมอ เพราะกรณีตั้งค่าไม่ครบจะคืนค่ากลับมา
 */
export async function signInWithGoogle(): Promise<AuthOutcome> {
  try {
    const supabase = getBrowserClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      console.error(`[auth] signInWithOAuth: ${error.message}`);
      return fail("oauth_failed");
    }

    return { ok: true };
  } catch (error) {
    return fail(classify("signInWithGoogle", error));
  }
}

export async function signOut(): Promise<AuthOutcome> {
  try {
    const supabase = getBrowserClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error(`[auth] signOut: ${error.message}`);
      return fail("signout_failed");
    }

    return { ok: true };
  } catch (error) {
    return fail(classify("signOut", error));
  }
}

/**
 * แปลงค่า ?auth_error= ที่ callback route ส่งกลับมาเป็นข้อความไทย
 * คืน null เมื่อไม่มีรหัสหรือรหัสไม่รู้จัก เพื่อไม่ให้ URL ที่ใครก็แก้ได้
 * ทำให้เว็บขึ้น error มั่วๆ
 */
export function authErrorFromCode(code: string | null): UserFacingError | null {
  if (code === null) return null;
  if (!Object.hasOwn(AUTH_ERROR_MESSAGE, code)) return null;

  return AUTH_ERROR_MESSAGE[code as AuthErrorCode];
}

/** ชื่อที่เอาไว้แสดงบนหัวเว็บ — ถ้าไม่มีชื่อก็ใช้ส่วนหน้าของอีเมลแทน */
export function displayNameOf(user: {
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}): string {
  const metadata = user.user_metadata ?? {};
  const fullName = metadata.full_name ?? metadata.name;
  if (typeof fullName === "string" && fullName.trim() !== "") {
    return fullName.trim();
  }

  const email = user.email ?? "";
  const localPart = email.split("@")[0];

  return localPart !== "" ? localPart : "ผู้ใช้";
}
