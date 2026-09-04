/**
 * POST /api/admin/settings — เปิด/ปิดสวิตช์ฟีเจอร์หนึ่งตัว
 *
 * ⚠️ ทุก request ต้องผ่าน requireAdmin() ก่อนแตะข้อมูลใดๆ ทั้งสิ้น
 *
 * เหตุผลเดียวกับ /api/admin/branches: การที่หน้า /admin/stats ตรวจสิทธิ์แล้ว
 * ไม่ได้ช่วยอะไรตรงนี้เลย คนที่เปิด devtools แล้วยิง fetch มาที่ URL นี้ตรงๆ
 * ไม่เคยผ่านหน้านั้น การซ่อนปุ่มกันได้แค่คนที่ใช้เว็บตามปกติ
 *
 * ⚠️ สวิตช์นี้ควบคุมสิ่งที่ผู้ใช้ทุกคนเห็น การปล่อยให้คนนอกกดได้ = ปิดแผนที่
 * ของทั้งเว็บได้จากเบราว์เซอร์ตัวเอง
 */

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import type { AdminDenyReason } from "@/lib/admin";
import { isSettingKey } from "@/lib/app-settings";
import { SETTINGS_CACHE_TAG } from "@/lib/settings-cache";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { writeSetting } from "@/lib/supabase/app-settings";

/** ต้องรันบน Node.js runtime เพราะอ่าน env และ cookie */
export const runtime = "nodejs";

/**
 * ทั้งสามกรณีตอบ 403 เหมือนกันโดยตั้งใจ — ชุดเดียวกับ /api/admin/branches
 * ไม่แยกเป็น 401 เพราะการแยกจะบอกคนที่ยิงมาว่า "ถ้าล็อกอินแล้วจะเข้าได้"
 */
const DENY_STATUS = 403;

const DENY_MESSAGE: Record<AdminDenyReason, string> = {
  unauthenticated: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  not_admin: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  not_configured: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
};

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false as const, message }, { status });
}

export async function POST(request: Request) {
  // ---- ด่านที่ 1: สิทธิ์ ต้องมาก่อนทุกอย่าง ----
  const admin = await requireAdmin();
  if (!admin.ok) {
    console.warn(`[admin] ปฏิเสธคำขอเปลี่ยนสวิตช์: ${admin.reason}`);
    return fail(DENY_MESSAGE[admin.reason], DENY_STATUS);
  }

  // ---- ด่านที่ 2: รูปร่างของข้อมูล ----
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }

  const { key, value } = (body ?? {}) as { key?: unknown; value?: unknown };

  // คีย์นอกชุดปิดถูกปฏิเสธตั้งแต่ตอนเขียน ไม่ใช่ปล่อยเข้าไปแล้วค่อยข้ามตอนอ่าน
  // — ตารางที่มีขยะอยู่ข้างในทำให้คนที่มาอ่านทีหลังไม่รู้ว่าอะไรคือของจริง
  if (!isSettingKey(key)) {
    return fail("ไม่รู้จักสวิตช์ตัวนี้", 400);
  }

  if (typeof value !== "boolean") {
    return fail("ค่าของสวิตช์ต้องเป็น true หรือ false เท่านั้น", 400);
  }

  // ---- ด่านที่ 3: บันทึก ----
  const saved = await writeSetting(key, value);
  if (!saved) {
    // เหตุผลจริงอยู่ใน log ฝั่งเซิร์ฟเวอร์แล้ว (อาจเป็นเรื่องสิทธิ์ของ DB
    // ซึ่งไม่ควรบอกผู้ใช้) ตรงนี้บอกแค่ว่าให้ลองใหม่
    return fail("บันทึกไม่สำเร็จ ลองอีกครั้ง", 500);
  }

  // ล้าง cache ทันทีเพื่อให้ผลของการกดปุ่มเห็นเดี๋ยวนั้น ไม่ต้องรอครบ 60 วินาที
  // (ดู lib/settings-cache.ts — ตัวเลขนั้นเป็นตาข่ายรับ ไม่ใช่ทางหลัก)
  //
  // ⚠️ expire: 0 โดยตั้งใจ ไม่ใช่ profile "max" ที่คู่มือแนะนำเป็นค่าทั่วไป
  // "max" จะเสิร์ฟของเก่าต่อไปเรื่อยๆ ระหว่างที่ค่อยๆ โหลดของใหม่เบื้องหลัง
  // ซึ่งเหมาะกับบทความหรือแคตตาล็อกสินค้า แต่ไม่เหมาะกับสวิตช์ฉุกเฉิน —
  // คนกดปิดแผนที่เพราะโควตา Google หมด ต้องการให้มันปิดเดี๋ยวนี้ ไม่ใช่ปิด
  // "เมื่อ cache ตัวถัดไปหมุนครบ" · expire: 0 ทำให้ request ถัดไปรออ่านค่าจริง
  //
  // (updateTag ที่คู่มือแนะนำใช้ได้เฉพาะใน Server Action — ที่นี่เป็น
  // Route Handler จึงต้องใช้ revalidateTag พร้อมระบุ expire เอง)
  revalidateTag(SETTINGS_CACHE_TAG, { expire: 0 });

  console.info(`[admin] เปลี่ยนสวิตช์ ${key} = ${value} โดย ${admin.email}`);

  return NextResponse.json({ ok: true as const, key, value });
}
