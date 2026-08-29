import { NextResponse } from "next/server";

import { thailandPost } from "@/lib/carriers/thailand-post";
import { CarrierError, type TrackingErrorCode } from "@/lib/carriers/types";

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

  try {
    const data = await thailandPost.track(trackingNumber);
    return NextResponse.json({ ok: true as const, data });
  } catch (error) {
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
