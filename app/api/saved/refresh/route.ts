/**
 * POST /api/saved/refresh — อัปเดตสถานะของพัสดุที่ยังไม่ถึงปลายทาง
 *
 * แถวในตาราง saved_trackings เป็น snapshot ที่เขียนไว้ตอนกดบันทึก แล้วไม่มีอะไร
 * อัปเดตมันอีกเลย ผู้ใช้จึงเห็นสถานะค้าง (เจอจริง: หน้าประวัติโชว์
 * "อยู่ระหว่างขนส่ง" แต่กดเข้าไปดูเป็น "ส่งถึงแล้ว")
 *
 * ------------------------------------------------------------------
 * ⚠️ **ผู้ใช้ต้องกดเองเท่านั้น ห้ามเรียกอัตโนมัติ**
 *
 * เดิมหน้าประวัติเรียกให้เองตอนเปิดหน้า ซึ่งแปลว่าการเปิดหน้าหนึ่งครั้งอาจ
 * จุดชนวนการยิง API หลายสิบครั้งโดยที่ผู้ใช้ไม่ได้ขอ — ตัดสินใจใหม่แล้วว่า
 * ไม่เอาแบบนั้นเลยแม้แต่จุดเดียว เพื่อประหยัดโควตาให้มากที่สุด (โมเดลเดียวกับ
 * ThaiEMS ที่ผู้ใช้กดค้นเองทุกครั้ง)
 *
 * ถ้าวันหนึ่งมีคนอยากเอา auto กลับมา ให้ดูตัวเลขก่อน: โควตา Track123 คิดต่อ
 * เลขพัสดุต่อรอบบิล และรอบล่าสุดใช้ไป 277/300 ก่อนสิ้นรอบ
 * ------------------------------------------------------------------
 *
 * ------------------------------------------------------------------
 * สิ่งที่ทำให้เรื่องนี้ไม่เผาโควตา — สามชั้นซ้อนกัน เรียงจากถูกไปแพง
 *
 *   0. ผู้ใช้เลือกเองว่าจะรีเฟรชใบไหน (ids) หรือทั้งหมด — ด่านที่ถูกที่สุด
 *      เพราะไม่มีอะไรเกิดขึ้นเลยจนกว่าจะมีคนกด
 *   1. คัดเฉพาะใบที่ยังไม่จบ (ดู lib/saved-refresh.ts) พัสดุที่ถึงมือแล้ว
 *      ไม่มีทางเปลี่ยนสถานะอีก ใช้ค่าที่บันทึกไว้ได้เลย ไม่ต้องยิงถาม
 *   2. cache สองชั้นเดิม — resolveTracking() อ่าน cache ก่อนเสมอ ใบที่ยัง
 *      ไม่หมดอายุตอบจาก memory/Supabase โดยไม่ยิง API เลยสักครั้ง
 *   3. หรี่ความพร้อมกันไว้ที่ REFRESH_CONCURRENCY กัน 19 ใบยิงพรวดเดียว
 *      จนชนเพดาน 5 req/s ของ Track123
 *
 * และ **ห้ามไปขอที่อยู่สาขาระหว่างนี้** (skipProbe) เพราะนั่นคือการยิง
 * ETrackings เพิ่มต่อสาขาที่ยังไม่รู้พิกัด ซึ่งเป็นของแพงที่สุดในระบบ
 * การเปิดหน้าประวัติหนึ่งครั้งต้องไม่จุดชนวนแบบนั้น
 * ------------------------------------------------------------------
 *
 * ห้ามตอบ error ให้ทั้งหน้าพัง — การรีเฟรชเป็นของเสริม ใบที่ยิงไม่สำเร็จจะ
 * ไม่ถูกส่งกลับมา แล้วหน้าเว็บก็แสดงค่าเดิมของใบนั้นต่อไปตามปกติ
 */

import { NextResponse } from "next/server";

import { resolveTracking } from "@/lib/carriers/resolve";
import {
  SAVED_TRACKING_COLUMNS,
  toSavedTracking,
  type SavedTracking,
} from "@/lib/saved-trackings";
import {
  REFRESH_CONCURRENCY,
  mapWithConcurrency,
  pickForRefresh,
} from "@/lib/saved-refresh";
import { buildSavedSnapshot, type SavedSnapshot } from "@/lib/saved-snapshot";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** ต้องรันบน Node.js runtime เพราะเส้นทางนี้อ่าน API key จาก process.env */
export const runtime = "nodejs";

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false as const, error: { code } }, { status });
}

/** ค่าที่เขียนลงแถวเปลี่ยนไปจากเดิมจริงไหม — ไม่เปลี่ยนก็ไม่ต้องเขียน */
function changed(before: SavedTracking, after: SavedSnapshot): boolean {
  return (
    before.lastStatus !== after.last_status ||
    before.lastStatusText !== after.last_status_text ||
    before.lastLocationText !== after.last_location_text ||
    before.lastLat !== after.last_lat ||
    before.lastLng !== after.last_lng ||
    before.lastLocationAccuracy !== after.last_location_accuracy ||
    before.lastUpdatedAt !== after.last_updated_at ||
    before.carrierName !== after.carrier_name
  );
}

/**
 * อ่านรายการ id ที่ขอมา — undefined เมื่อไม่ได้ระบุ (แปลว่า "ทั้งหมดที่ยังไม่จบ")
 *
 * คืน null เมื่อรูปแบบผิด เพื่อให้ผู้เรียกแยกออกจาก "ไม่ได้ระบุ" ได้ — สองอย่าง
 * นี้ต้องไม่ปนกัน ไม่งั้น body ที่พิมพ์ผิดจะกลายเป็นการรีเฟรชทั้งหมดโดยไม่ตั้งใจ
 * ซึ่งตรงข้ามกับเจตนาของคนที่กดปุ่มใบเดียว
 */
function readIds(body: unknown): string[] | null | undefined {
  if (body === null || typeof body !== "object") return undefined;

  const { ids } = body as { ids?: unknown };
  if (ids === undefined) return undefined;

  if (!Array.isArray(ids)) return null;
  if (ids.some((id) => typeof id !== "string" || id.trim() === "")) return null;

  return ids as string[];
}

export async function POST(request: Request) {
  // body ไม่บังคับ — ไม่มี body = รีเฟรชทุกใบที่ยังไม่ถึงปลายทาง
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // ไม่มี body หรือ body ว่าง ถือว่าไม่ได้ระบุ ids
  }

  const ids = readIds(body);
  if (ids === null) return errorResponse("invalid_request", 400);

  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`[api/saved/refresh] ${error.message}`);
      return errorResponse("unavailable", 503);
    }
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) return errorResponse("unauthenticated", 401);

  // RLS กรองให้เหลือเฉพาะแถวของเจ้าตัวอยู่แล้ว
  const { data, error } = await supabase
    .from("saved_trackings")
    .select(SAVED_TRACKING_COLUMNS);

  if (error !== null) {
    console.error(`[api/saved/refresh] อ่านประวัติไม่สำเร็จ: ${error.message}`);
    return errorResponse("unknown", 500);
  }

  const saved = (data ?? []).map(toSavedTracking);

  // กรองตามที่ผู้ใช้เลือกก่อน แล้วค่อยคัดใบที่ยังไม่จบ — ลำดับนี้สำคัญ:
  // ถ้าผู้ใช้กดใบที่ถึงปลายทางแล้ว เราต้องไม่ยิง ไม่ใช่ยิงเพราะเขาขอ
  // (RLS กรองให้เหลือแต่แถวของเจ้าตัวไปแล้ว id ที่ไม่ใช่ของเขาจึงหาไม่เจอเอง)
  const chosen =
    ids === undefined ? saved : saved.filter((item) => ids.includes(item.id));

  const targets = pickForRefresh(chosen);

  const outcomes = await mapWithConcurrency(
    targets,
    REFRESH_CONCURRENCY,
    async (item) => {
      // ไม่ข้าม cache — ใบที่ยังไม่หมดอายุต้องตอบจาก cache ไม่ใช่ยิง API ใหม่
      const resolved = await resolveTracking(item.trackingNumber);

      const snapshot = await buildSavedSnapshot(resolved.result, {
        skipProbe: true,
      });

      if (!changed(item, snapshot)) return null;

      const { data: updated, error: updateError } = await supabase
        .from("saved_trackings")
        .update(snapshot)
        .eq("id", item.id)
        .select(SAVED_TRACKING_COLUMNS)
        .single();

      if (updateError !== null) {
        console.warn(
          `[api/saved/refresh] อัปเดตแถวไม่สำเร็จ: ${updateError.message}`,
        );
        return null;
      }

      // ⚠️ คืน **แถวดิบ** จากฐานข้อมูล ไม่ใช่ผลของ toSavedTracking()
      //
      // ฝั่งเบราว์เซอร์เป็นคนแปลงเอง (ดู refreshSavedTrackings ใน
      // lib/saved-trackings.ts) ถ้าแปลงที่นี่ด้วยจะกลายเป็นการแปลงสองรอบ —
      // รอบที่สองไปอ่าน tracking_number จากออบเจ็กต์ที่เป็น camelCase ไปแล้ว
      // จึงได้ undefined ทุกฟิลด์ แล้วการ์ดในหน้าประวัติจะโชว์ UNDEFINED
      // และลิงก์กลายเป็น /?track=undefined (บั๊กจริงที่เจอหลัง #28)
      //
      // ทุก endpoint ของ /api/saved ต้องคืนแถวดิบเหมือนกันหมด เพื่อให้ฝั่ง
      // เบราว์เซอร์มีกติกาเดียว: "ได้อะไรมาก็แปลงหนึ่งรอบเสมอ"
      return updated;
    },
  );

  const updatedRows = outcomes.filter((row) => row !== null);

  console.info(
    `[api/saved/refresh] ทั้งหมด=${saved.length} ที่ขอมา=${ids === undefined ? "ทุกใบ" : ids.length}` +
      ` ต้องรีเฟรช=${targets.length} เปลี่ยนจริง=${updatedRows.length}`,
  );

  // คืนเฉพาะแถวที่เปลี่ยนจริง หน้าเว็บเอาไปทับของเดิมทีละใบ
  return NextResponse.json({ ok: true as const, data: updatedRows });
}
