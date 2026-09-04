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
import { NICKNAME_MAX_LENGTH, SAVED_TRACKING_COLUMNS } from "@/lib/saved-trackings";
import { buildSavedSnapshot } from "@/lib/saved-snapshot";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logTracking } from "@/lib/track-log";

/** ต้องรันบน Node.js runtime เพราะอ่าน API key จาก process.env */
export const runtime = "nodejs";

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false as const, error: { code } }, { status });
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

  const { trackingNumber, nickname, lookup } = (body ?? {}) as {
    trackingNumber?: unknown;
    nickname?: unknown;
    lookup?: unknown;
  };

  /**
   * บันทึกโดยไม่ยิงถามขนส่งเลย — ปุ่ม "บันทึกไว้" ที่หน้าแรก
   *
   * ------------------------------------------------------------------
   * ทำไมต้องมีทางนี้แยกจากทางปกติ
   *
   * ทางปกติ (lookup ไม่ใช่ false) อ่านสถานะล่าสุดจาก resolveTracking ก่อนบันทึก
   * ซึ่งเกือบทุกครั้งตอบจาก cache เพราะผู้ใช้เพิ่งค้นไปเมื่อครู่ (ยืนยันจาก log
   * จริง: route=saved source=memory ทุกครั้ง) จึงไม่ได้แพงในทางปฏิบัติ
   *
   * แต่ปุ่ม "บันทึกไว้" ที่หน้าแรกเป็นคนละเรื่อง — ผู้ใช้ยังไม่ได้ค้นอะไรเลย
   * cache จึงว่างแน่นอน และการบันทึกหนึ่งครั้งจะกลายเป็นการยิงจริงหนึ่งครั้ง
   * ซึ่งขัดกับเจตนาของปุ่มนั้นทั้งหมด (เก็บเลขไว้ก่อน ค่อยค้นทีหลังเมื่ออยากรู้)
   *
   * ⚠️ ไม่กระทบปุ่ม "ค้นหาพัสดุ" ที่หน้าแรกเลยแม้แต่น้อย — อันนั้นคือคำสัญญา
   * หลักของสินค้า ("พิมพ์เลขพัสดุครั้งเดียว เราไล่ถามให้ทุกขนส่ง") และไม่ได้
   * ผ่านเส้นทางนี้ด้วยซ้ำ มันยิง /api/track ตรงๆ
   * ------------------------------------------------------------------
   */
  const skipLookup = lookup === false;

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

  const trackNo = normalizeTrackingNumber(trackingNumber);

  if (skipLookup) {
    // เลขต้องอ่านออกก่อน ไม่งั้นจะเก็บขยะไว้ในประวัติที่ค้นยังไงก็ไม่เจอ
    // ใช้เกณฑ์เดียวกับ resolveTracking เพื่อให้สิ่งที่บันทึกได้กับสิ่งที่ค้นได้
    // เป็นชุดเดียวกันเสมอ
    if (!/^[A-Z0-9]{6,40}$/.test(trackNo)) {
      return errorResponse("invalid_request", 400);
    }

    // เขียนเฉพาะสามคอลัมน์นี้โดยตั้งใจ — ถ้าเลขนี้เคยบันทึกไว้แล้วพร้อมสถานะ
    // การกด "บันทึกไว้" ซ้ำต้องไม่ไปล้างสถานะที่มีอยู่ทิ้ง (upsert อัปเดต
    // เฉพาะคอลัมน์ที่ส่งไป คอลัมน์ที่ไม่ได้ส่งคงค่าเดิม)
    const { data: savedRow, error: saveError } = await supabase
      .from("saved_trackings")
      .upsert(
        {
          user_id: user.id,
          tracking_number: trackNo,
          nickname: cleanNickname === "" ? null : cleanNickname,
        },
        { onConflict: "user_id,tracking_number" },
      )
      .select(SAVED_TRACKING_COLUMNS)
      .single();

    if (saveError !== null) {
      console.error(`[api/saved] บันทึกแบบไม่ค้นหาไม่สำเร็จ: ${saveError.message}`);
      return errorResponse("unknown", 500);
    }

    console.info("[api/saved] บันทึกโดยไม่ยิงถามขนส่ง");

    return NextResponse.json({ ok: true as const, data: savedRow });
  }

  // อ่านสถานะล่าสุดเอง แทนที่จะเชื่อค่าที่ client ส่งมา
  // ปกติจะได้จาก cache เพราะผู้ใช้เพิ่งค้นหาเลขนี้ไปเมื่อครู่
  const resolveStartedAt = Date.now();

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

  // ประกอบค่าคอลัมน์ด้วยตัวเดียวกับที่เส้นทางรีเฟรชใช้ (ดู lib/saved-snapshot.ts)
  // ไม่ใส่ skipProbe ตรงนี้ — ตอนกดบันทึกคือจังหวะที่ยอมจ่ายเพื่อไปขอที่อยู่
  // ของสาขาที่ยังไม่รู้พิกัดมาเติม (มีด่านกันเผาโควตาสี่ชั้น — ดู
  // lib/branch-harvest.ts) ต่างจากตอนเปิดหน้าประวัติที่เกิดพร้อมกันหลายใบ
  const snapshot = await buildSavedSnapshot(result);

  const { data, error } = await supabase
    .from("saved_trackings")
    .upsert(
      {
        user_id: user.id,
        tracking_number: result.trackingNumber,
        nickname: cleanNickname === "" ? null : cleanNickname,
        ...snapshot,
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
