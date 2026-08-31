import { NextResponse } from "next/server";

import {
  isUnknownCourierFailure,
  normalizeTrackingNumber,
  resolveTracking,
} from "@/lib/carriers/resolve";
import {
  CarrierError,
  type TrackingErrorCode,
  type TrackingResult,
} from "@/lib/carriers/types";
import { canRevealProof } from "@/lib/proof-access";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { recordSearchEvent } from "@/lib/supabase/search-events";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logTracking } from "@/lib/track-log";
import { trackingShape } from "@/lib/tracking-shape";
import { withoutSensitive } from "@/lib/tracking-cache";

/** ต้องรันบน Node.js runtime เพราะอ่าน process.env ที่เก็บ API key */
export const runtime = "nodejs";

/** แปลงสาเหตุของ error เป็น HTTP status ที่สื่อความหมาย */
const ERROR_HTTP_STATUS: Record<TrackingErrorCode, number> = {
  invalid_tracking_number: 400,
  not_found: 404,
  auth_failed: 502,
  rate_limited: 429,
  network_error: 504,
  upstream_error: 502,
  config_error: 500,
};

/**
 * เวลาที่ผู้ใช้คนนี้กดบันทึกเลขนี้ไว้ — null เมื่อยังไม่ล็อกอินหรือไม่เคยบันทึก
 *
 * ใช้ session ของผู้ใช้จริง ไม่ใช่ service role — RLS ของ saved_trackings จึง
 * กรองให้เหลือแต่แถวของเจ้าตัวโดยอัตโนมัติ ต่อให้มีคนแก้ query ผิดในอนาคต
 * ก็ยังอ่านของคนอื่นไม่ได้
 *
 * ห้ามโยน error — สิทธิ์ดูรูปเป็นของเสริม พังแล้วต้องกลายเป็น "ไม่มีสิทธิ์"
 * ไม่ใช่ทำให้การค้นหาทั้งครั้งล้ม
 */
async function readSavedAt(trackingNumber: string): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user === null) return null;

    const { data, error } = await supabase
      .from("saved_trackings")
      .select("created_at")
      .eq("tracking_number", trackingNumber)
      .maybeSingle();

    if (error !== null) {
      console.warn(`[api/track] อ่านเวลาที่บันทึกไม่สำเร็จ: ${error.message}`);
      return null;
    }
    return typeof data?.created_at === "string" ? data.created_at : null;
  } catch (cause) {
    if (!(cause instanceof SupabaseConfigError)) {
      console.warn(
        `[api/track] ตรวจสิทธิ์ดูรูปไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return null;
  }
}

/**
 * หา URL รูปถ่ายตอนนำจ่ายให้คนที่มีสิทธิ์ — null เมื่อไม่มีสิทธิ์หรือไม่มีรูป
 *
 * ตรวจสถานะก่อนทุกอย่างโดยตั้งใจ: พัสดุที่ยังไม่ถึงมือไม่มีรูปอยู่แล้ว การ
 * ลัดออกตรงนี้ทำให้การค้นหาส่วนใหญ่ไม่ต้องแตะ Supabase auth เลยสักครั้ง
 *
 * ⚠️ ข้อมูลอ่อนไหวไม่เคยอยู่ใน cache (ดู rememberTracking) ผลที่มาจาก cache จึง
 * ไม่มี URL ติดมาด้วย ต้องยิงสดใหม่ ซึ่งยอมจ่ายเพราะเกิดเฉพาะกับคนที่มีสิทธิ์
 * และเฉพาะพัสดุที่ถึงมือแล้ว (ซึ่งเป็นสถานะสุดท้าย ไม่มีใครเปิดดูบ่อย)
 */
async function readProofPhotos(
  trackingNumber: string,
  resolved: { result: TrackingResult; source: string },
): Promise<string[]> {
  if (resolved.result.status !== "delivered") return [];

  const savedAt = await readSavedAt(trackingNumber);
  const allowed = canRevealProof({
    status: resolved.result.status,
    lastUpdated: resolved.result.lastUpdated,
    savedAt,
  });
  if (!allowed) return [];

  if (resolved.source === "api") {
    return resolved.result.sensitive?.proofPhotoUrls ?? [];
  }

  try {
    const fresh = await resolveTracking(trackingNumber, { skipCache: true });
    return fresh.result.sensitive?.proofPhotoUrls ?? [];
  } catch (cause) {
    console.warn(
      `[api/track] ดึงรูปนำจ่ายไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return [];
  }
}

function errorResponse(code: TrackingErrorCode, message: string) {
  return NextResponse.json(
    { ok: false as const, error: { code, message } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

/**
 * POST /api/track
 *
 * body: { "trackingNumber": "EY145587896TH" }
 *
 * ตอบกลับ:
 *   สำเร็จ  → { ok: true, data: TrackingResult }
 *   ล้มเหลว → { ok: false, error: { code, message } }  (message เป็นภาษาไทย แสดงให้ผู้ใช้ได้เลย)
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_tracking_number", "รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง");
  }

  const trackingNumber =
    typeof body === "object" && body !== null && "trackingNumber" in body
      ? (body as { trackingNumber?: unknown }).trackingNumber
      : undefined;

  if (typeof trackingNumber !== "string" || trackingNumber.trim() === "") {
    return errorResponse("invalid_tracking_number", "กรุณากรอกเลขพัสดุ");
  }

  const startedAt = Date.now();
  const trackNo = normalizeTrackingNumber(trackingNumber);

  // รูปแบบของเลข ไม่ใช่ตัวเลข — แปลงตรงนี้ครั้งเดียวเพื่อให้เห็นชัดว่าค่าที่
  // ไหลต่อไปยังสถิติผ่านการแปลงมาแล้ว ไม่ใช่เลขดิบ (ดู lib/tracking-shape.ts)
  const shape = trackingShape(trackNo);

  try {
    const resolved = await resolveTracking(trackingNumber);

    logTracking({
      ts: startedAt,
      trackNo,
      route: "track",
      source: resolved.source,
      provider: resolved.provider,
      stale: resolved.stale,
      shared: resolved.shared,
      tookMs: Date.now() - startedAt,
    });

    // สถิติรวมสำหรับหน้าแอดมิน — ไม่ผูกกับผู้ใช้ และไม่มีเลขพัสดุ
    // (ดูข้อบังคับด้านความเป็นส่วนตัวใน lib/supabase/search-events.ts)
    await recordSearchEvent({
      carrierCode: resolved.result.carrierCode,
      outcome: "found",
      source: resolved.source,
      provider: resolved.provider,
      stale: resolved.stale,
      tookMs: Date.now() - startedAt,
    });

    const proofPhotoUrls = await readProofPhotos(trackNo, resolved);

    // source / stale / fetchedAt ไม่ใช่ข้อมูลลับ — UI ใช้ตัดสินว่าจะขึ้นป้าย
    // "ข้อมูล ณ เวลานี้" หรือไม่ ส่วน shared ไว้ debug เรื่องการรวมคำขอซ้ำ
    return NextResponse.json({
      ok: true as const,
      // ตัดข้อมูลอ่อนไหวออกจาก data เสมอ ไม่ว่าผู้ขอจะมีสิทธิ์แค่ไหน — สิ่งที่
      // มีสิทธิ์เห็นถูกส่งไปเป็นฟิลด์แยกข้างล่าง จะได้ไม่มีทางที่ของอ่อนไหว
      // ติดไปกับก้อนข้อมูลหลักโดยไม่ได้ตั้งใจเมื่อมีคนเพิ่มฟิลด์ใหม่
      data: withoutSensitive(resolved.result),
      source: resolved.source,
      stale: resolved.stale,
      fetchedAt: resolved.fetchedAt,
      shared: resolved.shared,
      // มีค่าเฉพาะคนที่บันทึกพัสดุนี้ไว้ก่อนมันถึงมือผู้รับ (ดู lib/proof-access.ts)
      // คนที่ไม่มีสิทธิ์ได้รายการว่าง และไม่ได้รู้ด้วยซ้ำว่ามีรูปอยู่
      //
      // ⚠️ URL พวกนี้เป็น signed URL อายุ 24 ชม. จึงต้องมาจากการยิงสดเท่านั้น
      // (readProofPhotos ยิงใหม่ให้เองเมื่อคำตอบหลักมาจาก cache)
      proofPhotoUrls,
    });
  } catch (error) {
    const code = error instanceof CarrierError ? error.code : "upstream_error";

    logTracking({
      ts: startedAt,
      trackNo,
      route: "track",
      source: "error",
      provider: "none",
      stale: false,
      shared: false,
      tookMs: Date.now() - startedAt,
      reason: code,
    });

    await recordSearchEvent({
      carrierCode: null,
      outcome: code === "not_found" ? "not_found" : "error",
      source: "error",
      provider: "none",
      stale: false,
      // สาเหตุที่แท้จริงต้องอยู่บนหน้าสถิติ ไม่ใช่ต้องไปงมใน pm2 log
      reason: code,
      upstreamCode:
        error instanceof CarrierError ? (error.upstreamCode ?? null) : null,
      tookMs: Date.now() - startedAt,
      // ล้มตอนที่เหลือผู้ให้บริการเจ้าเดียวหรือเปล่า — ตัวเลขที่ต้องใช้ตัดสินใจ
      // ว่าจะทำกลไกเดาขนส่งตอนจนตรอกไหม (ดู lib/carriers/resolve.ts)
      unknownCourier: isUnknownCourierFailure(error),
      // เก็บเฉพาะตอนค้นไม่เจอ ซึ่งเป็นคำถามเดียวที่ค่านี้มีไว้ตอบ —
      // "ทรงไหนที่ระบบตามไม่ได้" ส่วนทรงที่ค้นเจอปกติไม่ต้องรู้
      trackingShape: code === "not_found" ? shape : null,
    });

    if (error instanceof CarrierError) {
      // log รายละเอียดไว้ฝั่ง server เท่านั้น (message อาจมีข้อมูลระบบ) ส่วน client ได้แค่ userMessage
      console.error(`[api/track] ${error.code}: ${error.message}`);
      return errorResponse(error.code, error.userMessage);
    }

    // error ที่ไม่ได้คาดไว้ — ตอบกลางๆ ไม่เปิดเผยรายละเอียดภายใน
    console.error("[api/track] unexpected error", error);
    return errorResponse(
      "upstream_error",
      "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
    );
  }
}
