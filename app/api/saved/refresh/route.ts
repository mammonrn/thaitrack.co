/**
 * POST /api/saved/refresh — อัปเดตสถานะของพัสดุที่ยังไม่ถึงปลายทาง
 *
 * หน้าประวัติเรียกตอนเปิดหน้า เพราะแถวในตาราง saved_trackings เป็น snapshot
 * ที่เขียนไว้ตอนกดบันทึก แล้วไม่มีอะไรอัปเดตมันอีกเลย ผู้ใช้จึงเห็นสถานะค้าง
 * (เจอจริง: หน้าประวัติโชว์ "อยู่ระหว่างขนส่ง" แต่กดเข้าไปดูเป็น "ส่งถึงแล้ว")
 *
 * ------------------------------------------------------------------
 * สิ่งที่ทำให้เรื่องนี้ไม่เผาโควตา — สามชั้นซ้อนกัน เรียงจากถูกไปแพง
 *
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

export async function POST() {
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
  const targets = pickForRefresh(saved);

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

      return toSavedTracking(updated);
    },
  );

  const updatedRows = outcomes.filter(
    (row): row is SavedTracking => row !== null,
  );

  console.info(
    `[api/saved/refresh] ทั้งหมด=${saved.length} ต้องรีเฟรช=${targets.length}` +
      ` เปลี่ยนจริง=${updatedRows.length}`,
  );

  // คืนเฉพาะแถวที่เปลี่ยนจริง หน้าเว็บเอาไปทับของเดิมทีละใบ
  return NextResponse.json({ ok: true as const, data: updatedRows });
}
