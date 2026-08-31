/**
 * POST /api/saved — บันทึกหรืออัปเดตรายการในประวัติ
 *
 * ต้องทำฝั่ง server เพราะ:
 *  1. การหาพิกัดใช้ GOOGLE_MAPS_API_KEY ที่ต้องไม่หลุดไปถึงเบราว์เซอร์
 *  2. สถานะที่บันทึกต้องอ่านจากระบบขนส่งเอง ไม่ใช่เชื่อค่าที่ client ส่งมา
 */

import { NextResponse } from "next/server";

import { normalizeTrackingNumber, resolveTracking } from "@/lib/carriers/resolve";
import { CarrierError } from "@/lib/carriers/types";
import { resolveLocation } from "@/lib/location-resolve";
import { NICKNAME_MAX_LENGTH, SAVED_TRACKING_COLUMNS } from "@/lib/saved-trackings";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logTracking } from "@/lib/track-log";

/** ต้องรันบน Node.js runtime เพราะอ่าน API key จาก process.env */
export const runtime = "nodejs";

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false as const, error: { code } }, { status });
}

/** หาสถานที่ล่าสุดที่ระบุมาจริง — เหตุการณ์ใหม่สุดบางอันไม่ได้บอกสถานที่มาด้วย */
function latestLocation(events: { location: string }[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const location = events[index].location.trim();
    if (location !== "") return location;
  }
  return "";
}

/**
 * GET /api/saved?trackingNumber=... — เลขนี้เคยบันทึกไว้แล้วหรือยัง
 *
 * หน้าผลลัพธ์ใช้ตัดสินว่าจะขึ้นปุ่ม "บันทึก" หรือ "บันทึกแล้ว" ตั้งแต่แรกเห็น
 * โดยไม่ต้องดึงประวัติทั้งหมดมาแล้วค้นเอง
 */
export async function GET(request: Request) {
  const trackingNumber = new URL(request.url).searchParams
    .get("trackingNumber")
    ?.trim();

  if (trackingNumber === undefined || trackingNumber === "") {
    return errorResponse("invalid_request", 400);
  }

  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) return errorResponse("unavailable", 503);
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) return errorResponse("unauthenticated", 401);

  // RLS กรองให้เหลือเฉพาะแถวของเจ้าตัวอยู่แล้ว
  const { data, error } = await supabase
    .from("saved_trackings")
    .select(SAVED_TRACKING_COLUMNS)
    .eq("tracking_number", normalizeTrackingNumber(trackingNumber))
    .maybeSingle();

  if (error !== null) {
    console.error(`[api/saved] อ่านรายการไม่สำเร็จ: ${error.message}`);
    return errorResponse("unknown", 500);
  }

  // ไม่เคยบันทึกไว้ไม่ใช่ความผิดพลาด ตอบ null ไปตามปกติ
  return NextResponse.json({ ok: true as const, data });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", 400);
  }

  const { trackingNumber, nickname } = (body ?? {}) as {
    trackingNumber?: unknown;
    nickname?: unknown;
  };

  if (typeof trackingNumber !== "string" || trackingNumber.trim() === "") {
    return errorResponse("invalid_request", 400);
  }

  // ชื่อเล่นไม่บังคับ เว้นว่างแล้วหน้าประวัติจะใช้เลขพัสดุแทน
  const cleanNickname =
    typeof nickname === "string"
      ? nickname.trim().slice(0, NICKNAME_MAX_LENGTH)
      : "";

  let supabase;
  try {
    supabase = await createServerSupabaseClient();
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      console.error(`[api/saved] ${error.message}`);
      return errorResponse("unavailable", 503);
    }
    throw error;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS กันอยู่แล้วอีกชั้น แต่ตอบ 401 ตรงนี้เลยเพื่อให้ client แสดงข้อความที่ตรง
  if (user === null) return errorResponse("unauthenticated", 401);

  // อ่านสถานะล่าสุดเอง แทนที่จะเชื่อค่าที่ client ส่งมา
  // ปกติจะได้จาก cache เพราะผู้ใช้เพิ่งค้นหาเลขนี้ไปเมื่อครู่
  const resolveStartedAt = Date.now();
  const trackNo = normalizeTrackingNumber(trackingNumber);

  let result;
  try {
    const resolved = await resolveTracking(trackingNumber);
    result = resolved.result;

    logTracking({
      ts: resolveStartedAt,
      trackNo,
      route: "saved",
      source: resolved.source,
      provider: resolved.provider,
      stale: resolved.stale,
      shared: resolved.shared,
      tookMs: Date.now() - resolveStartedAt,
    });
  } catch (error) {
    logTracking({
      ts: resolveStartedAt,
      trackNo,
      route: "saved",
      source: "error",
      provider: "none",
      stale: false,
      shared: false,
      tookMs: Date.now() - resolveStartedAt,
      reason: error instanceof CarrierError ? error.code : "unknown",
    });

    if (error instanceof CarrierError) {
      console.error(`[api/saved] ${error.code}: ${error.message}`);
      return errorResponse(error.code === "not_found" ? "not_found" : "unknown", 502);
    }
    throw error;
  }

  const rawLocationText = latestLocation(result.events);

  // หาพิกัดตามลำดับที่ไม่มีทางปักหมุดมั่ว: ตารางพิกัดสาขา → geocode เฉพาะข้อความ
  // ที่ดูเหมือนที่อยู่จริง → ไม่รู้ก็ไม่ปัก (ดู lib/location-resolve.ts)
  // หาไม่ได้ต้องไม่ทำให้การบันทึกล้มเหลว — เก็บ null แล้วไปต่อ
  const location =
    rawLocationText === ""
      ? null
      : await resolveLocation(rawLocationText, result.carrierCode);

  const coordinates = location?.coordinates ?? null;

  // เก็บข้อความที่อ่านรู้เรื่อง (ชื่อสาขา) แทนข้อความดิบที่มีรหัสภายในปนมา
  const locationText = location?.displayText ?? rawLocationText;

  const { data, error } = await supabase
    .from("saved_trackings")
    .upsert(
      {
        user_id: user.id,
        tracking_number: result.trackingNumber,
        carrier_name: result.carrierName,
        nickname: cleanNickname === "" ? null : cleanNickname,
        last_status: result.status,
        last_status_text: result.statusText,
        last_location_text: locationText === "" ? null : locationText,
        last_lat: coordinates?.lat ?? null,
        last_lng: coordinates?.lng ?? null,
        last_updated_at: result.lastUpdated,
      },
      // บันทึกเลขเดิมซ้ำต้องอัปเดตแถวเดิม ไม่ใช่สร้างแถวใหม่
      { onConflict: "user_id,tracking_number" },
    )
    .select(SAVED_TRACKING_COLUMNS)
    .single();

  if (error !== null) {
    console.error(`[api/saved] บันทึกไม่สำเร็จ: ${error.message}`);
    return errorResponse("unknown", 500);
  }

  return NextResponse.json({ ok: true as const, data });
}
