import { NextResponse } from "next/server";

import {
  isNotFoundFromCache,
  isUnknownCourierFailure,
  normalizeTrackingNumber,
  resolveTracking,
} from "@/lib/carriers/resolve";
import {
  CarrierError,
  type TrackingErrorCode,
  type TrackingResult,
} from "@/lib/carriers/types";
import { CARRIER_LANDINGS } from "@/lib/carriers/landing";
import { canRevealProof } from "@/lib/proof-access";
import { buildSavedSnapshot } from "@/lib/saved-snapshot";
import { SupabaseConfigError } from "@/lib/supabase/env";
import { newTrace, withTrace } from "@/lib/request-trace";
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
  // 504 เหมือน network_error — ทั้งคู่แปลว่า "ไม่ได้คำตอบภายในเวลา" ต่างกันแค่
  // ใครเป็นคนตัด ซึ่งเป็นรายละเอียดฝั่งเราที่ HTTP status ไม่ต้องรู้
  timeout: 504,
};

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
  savedAt: string | null,
): Promise<string[]> {
  if (resolved.result.status !== "delivered") return [];

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

/**
 * อัปเดตแถวในประวัติของผู้ใช้ ถ้าเขาบันทึกเลขนี้ไว้ — ของแถม ไม่ใช่หน้าที่หลัก
 *
 * ------------------------------------------------------------------
 * ปัญหาที่แก้: หน้าประวัติเก็บ snapshot ตอนกดบันทึก ผู้ใช้ที่แตะการ์ดแล้วมาค้น
 * ที่หน้าแรกจะเห็นสถานะใหม่ แต่พอกดกลับ การ์ดยังโชว์ของเก่าเหมือนเดิม —
 * เพราะการค้นหาไม่เคยเขียนอะไรกลับ (ตั้งแต่ #26 ถึง #30)
 *
 * ⚠️ **ห้ามทำให้การค้นหาล้มตามเด็ดขาด** การค้นหาคือคำสัญญาหลักของสินค้า
 * ส่วนการเขียนกลับคือของแถม ทุกทางที่พังจึงจบที่ log แล้วเงียบไป ไม่มี throw
 * ไม่มี error ที่ไหลขึ้นไปถึงผู้ใช้
 *
 * ⚠️ **ห้ามสร้างแถวใหม่** ใช้ update ไม่ใช่ upsert — ถ้าผู้ใช้ไม่เคยบันทึกเลขนี้
 * การค้นหาต้องไม่ไปแอบเพิ่มของเข้าประวัติเขาโดยไม่ได้ขอ
 *
 * ⚠️ **กรองด้วย user_id ตรงๆ ไม่พึ่ง RLS อย่างเดียว** RLS กรองให้อยู่แล้ว แต่
 * การเขียนที่พึ่งด่านเดียวคือการฝากความปลอดภัยไว้กับการตั้งค่าที่มองไม่เห็นจาก
 * ในโค้ด ถ้าวันหนึ่ง policy ถูกแก้ผิด การกรองซ้ำตรงนี้ยังกันไว้ได้อีกชั้น
 * ------------------------------------------------------------------
 */
async function syncSavedRow(
  trackingNumber: string,
  result: TrackingResult,
): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // ไม่ล็อกอิน = ไม่มีประวัติให้เขียน
    if (user === null) return null;

    // เช็คก่อนว่าเขาบันทึกเลขนี้ไว้จริงไหม — ถ้าไม่ ก็ไม่ต้องเสียเวลาไปหาพิกัด
    // ให้เปล่าๆ (การค้นหาส่วนใหญ่เป็นเลขที่ไม่ได้บันทึกไว้)
    const { data: existing, error: readError } = await supabase
      .from("saved_trackings")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("tracking_number", trackingNumber)
      .maybeSingle();

    if (readError !== null) {
      console.warn(`[api/track] อ่านแถวประวัติไม่สำเร็จ: ${readError.message}`);
      return null;
    }
    if (existing === null) return null;

    const savedAt =
      typeof existing.created_at === "string" ? existing.created_at : null;

    // ใช้ตัวประกอบ snapshot **ตัวเดียวกับ** /api/saved และ /api/saved/refresh
    // ห้ามเขียนโค้ดแปลงข้อมูลซ้ำที่นี่เด็ดขาด — นิยามที่ต่างกันระหว่างสองที่คือ
    // บั๊กแบบเดียวกับ #29 ที่ไม่มี type error ให้เห็นและหาไม่เจอจนกว่าจะมีคน
    // เทียบสองหน้าจอกัน (มีเทสต์เฝ้าที่ lib/saved-snapshot.test.ts)
    //
    // skipProbe เพราะนี่เป็นเส้นทางที่ผู้ใช้กำลังรอผลค้นหาอยู่ การไปขอที่อยู่
    // สาขาจากขนส่งเพิ่มจะยืดเวลารอโดยที่เขาไม่ได้ขอ
    const snapshot = await buildSavedSnapshot(result, { skipProbe: true });

    const { error: updateError } = await supabase
      .from("saved_trackings")
      .update(snapshot)
      .eq("user_id", user.id)
      .eq("tracking_number", trackingNumber);

    if (updateError !== null) {
      console.warn(`[api/track] อัปเดตประวัติไม่สำเร็จ: ${updateError.message}`);
      // ยังคืน savedAt เพราะสิทธิ์ดูรูปไม่ได้ขึ้นกับว่าเขียนสำเร็จไหม
      return savedAt;
    }

    console.info("[api/track] อัปเดตแถวประวัติให้ตรงกับผลค้นหาแล้ว");
    return savedAt;
  } catch (cause) {
    // SupabaseConfigError = ยังไม่ได้ตั้งค่าระบบสมาชิก ซึ่งเป็นสภาพปกติของ
    // เครื่องที่ยังไม่ได้ตั้งค่า ไม่ต้อง log ให้รก
    if (!(cause instanceof SupabaseConfigError)) {
      console.warn(
        `[api/track] เขียนกลับประวัติไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return null;
  }
}

/**
 * ขนส่งที่ยอมรับเป็น hint จากหน้า landing ได้ — ชุดปิด
 *
 * รับเฉพาะรหัสที่เรามีหน้า landing อยู่จริง ไม่ใช่ค่าอะไรก็ได้ที่ client ส่งมา
 * ถ้ารับดิบๆ ใครก็ตามที่ยิง API ตรงจะสั่งให้เราไปถามขนส่งเจ้าไหนก็ได้ ซึ่ง
 * กลายเป็นช่องให้เผาโควตาของเราด้วยคำขอที่รู้อยู่แล้วว่าไม่มีทางเจอ
 */
const ALLOWED_HINTS: ReadonlySet<string> = new Set(
  CARRIER_LANDINGS.map((carrier) => carrier.courierCode).filter(
    (code): code is string => code !== null,
  ),
);

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

  // ค่าที่ไม่อยู่ในชุดปิดถูกทิ้งเงียบๆ ไม่ใช่ตอบ error — มันเป็นแค่ตัวช่วยเดา
  // การค้นหาต้องทำงานได้เหมือนเดิมทุกประการแม้ไม่มีมัน
  const rawHint =
    typeof body === "object" && body !== null && "courierHint" in body
      ? (body as { courierHint?: unknown }).courierHint
      : undefined;
  const pageCourierHint =
    typeof rawHint === "string" && ALLOWED_HINTS.has(rawHint)
      ? rawHint
      : undefined;

  const startedAt = Date.now();
  const trackNo = normalizeTrackingNumber(trackingNumber);

  // ที่เก็บว่าคำขอนี้ยิงขนส่งไปกี่ครั้งและรอคิวไปกี่ ms — สร้างที่นี่เพราะ
  // "หนึ่งการค้นหาของผู้ใช้" คือขอบเขตที่ตัวเลขพวกนี้มีความหมาย และเพราะทั้ง
  // ขาที่สำเร็จและขาที่ล้มต้องอ่านค่าเดียวกันได้ (ดู lib/request-trace.ts)
  const trace = newTrace();

  // รูปแบบของเลข ไม่ใช่ตัวเลข — แปลงตรงนี้ครั้งเดียวเพื่อให้เห็นชัดว่าค่าที่
  // ไหลต่อไปยังสถิติผ่านการแปลงมาแล้ว ไม่ใช่เลขดิบ (ดู lib/tracking-shape.ts)
  const shape = trackingShape(trackNo);

  try {
    const resolved = await withTrace(trace, () =>
      resolveTracking(trackingNumber, { pageCourierHint }),
    );

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
      upstreamCalls: trace.upstreamCalls,
      queueMs: trace.queueMs,
    });

    // เขียนกลับก่อนตอบ เพื่อให้ผู้ใช้ที่กด back ไปหน้าประวัติเห็นของใหม่ทันที
    // ถ้ายิงทิ้งแบบไม่รอ จะแข่งกับการที่เขากดกลับ แล้วบางครั้งยังเห็นของเก่า
    // ถามสิทธิ์ผู้ใช้ครั้งเดียวแล้วใช้ต่อทั้งสองงาน — เดิม readProofPhotos
    // ไปถาม Supabase เองอีกรอบ ซึ่งกลายเป็นสองรอบต่อการค้นหาหนึ่งครั้ง
    const savedAt = await syncSavedRow(trackNo, resolved.result);

    const proofPhotoUrls = await readProofPhotos(trackNo, resolved, savedAt);

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

    // "ไม่พบ" ที่ตอบจากความจำ ไม่ได้ไปถามขนส่งเลยสักเจ้า — ต้องแยกให้ออกจาก
    // "ไม่พบ" ที่เพิ่งวิ่งครบทั้งสาย ไม่งั้นวัดไม่ได้ว่า cache ช่วยได้แค่ไหน
    // (ดู lib/not-found-cache.ts) · ใช้ค่า source/provider ชุดเดียวกับขาที่
    // ค้นเจอแล้วตอบจาก cache จึงไม่ต้องแก้ CHECK constraint ของตาราง
    const notFoundFromCache = isNotFoundFromCache(error);

    logTracking({
      ts: startedAt,
      trackNo,
      route: "track",
      source: notFoundFromCache ? "memory" : "error",
      provider: notFoundFromCache ? "cache" : "none",
      stale: false,
      shared: false,
      tookMs: Date.now() - startedAt,
      reason: code,
    });

    await recordSearchEvent({
      carrierCode: null,
      outcome: code === "not_found" ? "not_found" : "error",
      source: notFoundFromCache ? "memory" : "error",
      provider: notFoundFromCache ? "cache" : "none",
      stale: false,
      // สาเหตุที่แท้จริงต้องอยู่บนหน้าสถิติ ไม่ใช่ต้องไปงมใน pm2 log
      reason: code,
      upstreamCode:
        error instanceof CarrierError ? (error.upstreamCode ?? null) : null,
      tookMs: Date.now() - startedAt,
      // ล้มตอนที่เหลือผู้ให้บริการเจ้าเดียวหรือเปล่า — ตัวเลขที่ต้องใช้ตัดสินใจ
      // ว่าจะทำกลไกเดาขนส่งตอนจนตรอกไหม (ดู lib/carriers/resolve.ts)
      upstreamCalls: trace.upstreamCalls,
      queueMs: trace.queueMs,
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
