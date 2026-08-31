/**
 * POST /api/admin/branches — บันทึกหรือแก้พิกัดของสาขาหนึ่ง
 *
 * ⚠️ ทุก request ต้องผ่าน requireAdmin() ก่อนแตะข้อมูลใดๆ ทั้งสิ้น
 *
 * การที่หน้า /admin/branches ตรวจสิทธิ์แล้วไม่ได้ช่วยอะไรตรงนี้เลย — คนที่เปิด
 * devtools แล้วยิง fetch มาที่ URL นี้ตรงๆ ไม่เคยผ่านหน้านั้น การซ่อนปุ่มกันได้
 * แค่คนที่ใช้เว็บตามปกติเท่านั้น
 */

import { NextResponse } from "next/server";

import type { AdminDenyReason } from "@/lib/admin";
import { normalizeBranchCode } from "@/lib/branch-location";
import {
  COORDINATE_ERROR_TEXT,
  OUTSIDE_THAILAND_WARNING,
  checkCoordinates,
} from "@/lib/coordinates";
import { requireAdmin } from "@/lib/supabase/admin-guard";
import { upsertBranch } from "@/lib/supabase/locations";

/** ต้องรันบน Node.js runtime เพราะอ่าน env และ cookie */
export const runtime = "nodejs";

/** ความยาวสูงสุดของช่องข้อความ กันไม่ให้ยัดข้อมูลก้อนใหญ่เข้าฐานข้อมูล */
const MAX_TEXT_LENGTH = 200;

/**
 * เหตุผลที่ถูกปฏิเสธ → HTTP status
 *
 * ทั้งสามกรณีตอบ 403 เหมือนกันโดยตั้งใจ ไม่แยกเป็น 401 สำหรับ "ยังไม่ล็อกอิน"
 * เพราะการแยกจะบอกคนที่ยิงมาว่า "ถ้าล็อกอินแล้วจะเข้าได้" ซึ่งเป็นข้อมูลที่
 * ไม่จำเป็นต้องให้
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

/** อ่านช่องข้อความที่เว้นว่างได้ — คืน null เมื่อว่าง */
function readOptionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_TEXT_LENGTH) return undefined;
  return trimmed;
}

export async function POST(request: Request) {
  // ---- ด่านที่ 1: สิทธิ์ ต้องมาก่อนทุกอย่าง ----
  const admin = await requireAdmin();
  if (!admin.ok) {
    console.warn(`[admin] ปฏิเสธคำขอเขียนพิกัดสาขา: ${admin.reason}`);
    return fail(DENY_MESSAGE[admin.reason], DENY_STATUS);
  }

  // ---- ด่านที่ 2: รูปร่างของข้อมูล ----
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }

  if (typeof body !== "object" || body === null) {
    return fail("รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง", 400);
  }

  const { carrierCode, branchCode, branchName, note, lat, lng } = body as
    Record<string, unknown>;

  if (typeof carrierCode !== "string" || carrierCode.trim() === "") {
    return fail("ต้องระบุขนส่ง", 400);
  }
  if (typeof branchCode !== "string" || branchCode.trim() === "") {
    return fail("ต้องระบุรหัสสาขา", 400);
  }
  if (
    carrierCode.trim().length > MAX_TEXT_LENGTH ||
    branchCode.trim().length > MAX_TEXT_LENGTH
  ) {
    return fail("ข้อความยาวเกินไป", 400);
  }

  const name = readOptionalText(branchName);
  const branchNote = readOptionalText(note);
  if (name === undefined || branchNote === undefined) {
    return fail("ชื่อสาขาหรือบันทึกยาวเกินไป", 400);
  }

  // ---- ด่านที่ 3: ความสมเหตุสมผลของพิกัด ----
  // ตรวจฝั่งเซิร์ฟเวอร์เองเสมอ ไม่เชื่อว่าฟอร์มตรวจมาแล้ว
  const coordinates = checkCoordinates(lat, lng);
  if (!coordinates.ok) {
    return fail(COORDINATE_ERROR_TEXT[coordinates.reason], 400);
  }

  const saved = await upsertBranch({
    carrierCode: carrierCode.trim(),
    branchCode: normalizeBranchCode(branchCode),
    branchName: name,
    lat: coordinates.lat,
    lng: coordinates.lng,
    note: branchNote,
    updatedBy: admin.email,
  });

  if (!saved.ok) return fail(saved.message, 502);

  return NextResponse.json({
    ok: true as const,
    // พิกัดนอกไทยบันทึกได้ (พัสดุระหว่างประเทศมีจุดพักในต่างประเทศจริง)
    // แต่ต้องเตือน เพราะสาเหตุที่พบบ่อยที่สุดคือสลับละติจูดกับลองจิจูดกัน
    warning: coordinates.outsideThailand ? OUTSIDE_THAILAND_WARNING : null,
  });
}
