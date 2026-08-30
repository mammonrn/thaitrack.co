/**
 * ตัวกลางระหว่าง UI กับข้อมูลผู้ใช้ของ Supabase
 *
 * แยกออกมาจาก app/auth-button.tsx ด้วยเหตุผลเดียวกับ lib/tracking-view.ts —
 * ให้ logic การอ่านชื่อ/รูป และการตัดสินใจว่าจะทักทายหรือไม่
 * ทดสอบได้ด้วย mock โดยไม่ต้องเปิดเบราว์เซอร์
 */

import type { User, UserMetadata } from "@supabase/supabase-js";

/**
 * query param ที่ app/auth/callback/route.ts ติดกลับมาเมื่อแลก code สำเร็จ
 *
 * ต้องให้ฝั่ง server เป็นคนบอก เพราะการแลก code เกิดที่ server —
 * พอ redirect กลับมา หน้าเว็บโหลดใหม่ทั้งหน้า แล้ว Supabase client
 * จะอ่าน session จาก cookie แล้วยิงเหตุการณ์ INITIAL_SESSION ไม่ใช่ SIGNED_IN
 * ถ้าไปดักที่ SIGNED_IN จะไม่มีทางรู้ว่า "เพิ่งล็อกอินเสร็จ" หรือ "ล็อกอินค้างอยู่แต่เดิม"
 * (ยิ่งกว่านั้น เอกสาร auth-js ระบุว่า SIGNED_IN ยิงซ้ำได้ตอนสลับกลับมาที่แท็บด้วย)
 */
export const WELCOME_PARAM = "welcome";

/** ชื่อที่ใช้แทนคนที่ไม่มีทั้งชื่อและอีเมล (แทบไม่เกิด แต่ต้องไม่ปล่อยว่าง) */
const FALLBACK_NAME = "ผู้ใช้";

/**
 * อ่านค่าที่เป็นข้อความจาก user_metadata ซึ่ง Supabase ประกาศ type ไว้กว้างๆ
 * ไล่ตามลำดับ key ที่ให้มา แล้วคืนตัวแรกที่เป็นข้อความไม่ว่าง
 */
function readMetadataString(
  metadata: UserMetadata | undefined,
  ...keys: string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/** ชื่อที่เอาไว้แสดง — Google ส่ง full_name/name มา ถ้าไม่มีจริงๆ ใช้อีเมลแทน */
export function displayNameOf(user: User): string {
  return (
    readMetadataString(user.user_metadata, "full_name", "name") ??
    user.email?.trim() ??
    FALLBACK_NAME
  );
}

/** ลิงก์รูปโปรไฟล์ ถ้าผู้ให้บริการไม่ส่งมาก็คืน null ให้ UI ไปใช้ตัวอักษรย่อแทน */
export function avatarUrlOf(user: User): string | null {
  return readMetadataString(user.user_metadata, "avatar_url", "picture");
}

/**
 * ตัวอักษรย่อสำหรับวงกลมแทนรูปโปรไฟล์
 *
 * ใช้ Intl.Segmenter เพราะภาษาไทยมีสระและวรรณยุกต์ที่เป็นคนละ code point
 * กับพยัญชนะ — slice(0, 1) เฉยๆ จะได้พยัญชนะโดดๆ ที่อ่านแล้วแปลก
 * (เช่น "อุ๊" จะเหลือแค่ "อ")
 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") return "?";

  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next();
  const grapheme = first.done ? trimmed.slice(0, 1) : first.value.segment;

  return grapheme.toUpperCase();
}

/**
 * param ที่ Supabase ติดกลับมาเมื่อ OAuth ล้มเหลว
 *
 * ของพวกนี้ไม่ได้มาที่ /auth/callback แต่เด้งไป "Site URL" ที่ตั้งไว้ใน Supabase
 * (ปกติคือหน้าแรก) หน้าเว็บจึงต้องอ่านเองที่หน้าแรก ไม่งั้นผู้ใช้จะเจอแค่
 * "กดแล้วเด้งกลับมาเฉยๆ" โดยไม่รู้ว่าเกิดอะไรขึ้น
 */
const OAUTH_ERROR_PARAMS = ["error", "error_code", "error_description"] as const;

/**
 * แปลรหัสผิดพลาดที่เจอบ่อยเป็นภาษาคน
 *
 * ตั้งใจไม่เอา error_description จาก URL มาแสดงตรงๆ เพราะเป็นข้อความที่ใครก็ยัด
 * ใส่ query string มาให้ผู้ใช้อ่านได้ — รหัสที่ไม่รู้จักให้ใช้ข้อความกลางแทน
 */
const OAUTH_ERROR_MESSAGE: Record<string, string> = {
  bad_oauth_state: "การเข้าสู่ระบบหมดเวลา กรุณากดเข้าสู่ระบบใหม่อีกครั้ง",
  access_denied: "คุณยกเลิกการเข้าสู่ระบบที่หน้า Google",
  otp_expired: "ลิงก์เข้าสู่ระบบหมดอายุแล้ว กรุณาลองใหม่อีกครั้ง",
  provider_email_needs_verification:
    "อีเมลของบัญชี Google นี้ยังไม่ได้ยืนยัน กรุณายืนยันก่อนเข้าสู่ระบบ",
};

const GENERIC_OAUTH_ERROR = "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export interface AuthFlagsResult {
  /** true = เพิ่งกลับมาจาก /auth/callback ที่แลก code สำเร็จ */
  shouldGreet: boolean;
  /** ข้อความภาษาไทยเมื่อ OAuth ล้มเหลว, null = ไม่มีปัญหา */
  errorMessage: string | null;
  /** URL เดิมที่ตัด param ของระบบ login ออกแล้ว — เอาไปใส่ history.replaceState ต่อ */
  cleanedUrl: string;
}

/**
 * อ่านและถอด param ที่ระบบ login ใช้สื่อสารออกจาก URL
 *
 * ต้องถอดออกทันทีที่อ่าน เพื่อให้ reload แล้ว toast ไม่โผล่ซ้ำ
 * รับ/คืนเป็น string ล้วนๆ ไม่แตะ window เพื่อให้ทดสอบได้
 */
export function takeAuthFlags(href: string): AuthFlagsResult {
  const url = new URL(href);

  const shouldGreet = url.searchParams.get(WELCOME_PARAM) === "1";
  const errorCode =
    url.searchParams.get("error_code")?.trim() ||
    url.searchParams.get("error")?.trim() ||
    "";

  if (!shouldGreet && !errorCode) {
    return { shouldGreet: false, errorMessage: null, cleanedUrl: href };
  }

  url.searchParams.delete(WELCOME_PARAM);
  for (const param of OAUTH_ERROR_PARAMS) url.searchParams.delete(param);

  return {
    shouldGreet,
    errorMessage: errorCode
      ? (OAUTH_ERROR_MESSAGE[errorCode] ?? GENERIC_OAUTH_ERROR)
      : null,
    cleanedUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}
