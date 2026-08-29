/**
 * ตัวกลางระหว่างหน้าเว็บกับ POST /api/track
 *
 * แยกออกมาจาก page.tsx เพื่อให้หน้าเว็บเหลือแค่การแสดงผล และให้ logic
 * การเรียก API / แปลงข้อความ error ทดสอบได้ด้วย mock โดยไม่ต้องเปิดเบราว์เซอร์
 */

import type { TrackingErrorCode, TrackingResult } from "./carriers/types";

/**
 * ข้อความ error ที่ผู้ใช้ทั่วไปเข้าใจได้ แยกตามสาเหตุ
 * ไม่ยกข้อความดิบจากระบบขนส่งปลายทางมาแสดงตรงๆ
 */
export const ERROR_MESSAGE: Record<TrackingErrorCode, string> = {
  invalid_tracking_number:
    "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบให้ครบถ้วนแล้วลองใหม่",
  not_found:
    "ไม่พบเลขพัสดุนี้ในระบบ อาจเพราะเพิ่งส่งและยังไม่เข้าระบบ หรือกรอกเลขผิด",
  auth_failed:
    "ระบบเชื่อมต่อขนส่งขัดข้อง ทีมงานกำลังตรวจสอบ กรุณาลองใหม่ภายหลัง",
  rate_limited: "มีการค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
  network_error:
    "เชื่อมต่อระบบขนส่งไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
  upstream_error: "ระบบของขนส่งขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  config_error: "ระบบยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง",
};

export const EMPTY_INPUT_MESSAGE = "กรุณากรอกเลขพัสดุ";
const FALLBACK_ERROR = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

export type TrackingOutcome =
  | { ok: true; result: TrackingResult }
  | { ok: false; message: string };

/** ตรวจรูปร่างข้อมูลก่อนเชื่อ — ไม่ cast ทื่อๆ เผื่อ API ตอบอะไรแปลกๆ กลับมา */
export function isSuccessPayload(
  payload: unknown,
): payload is { ok: true; data: TrackingResult } {
  if (typeof payload !== "object" || payload === null) return false;

  const { ok, data } = payload as { ok?: unknown; data?: unknown };
  if (ok !== true || typeof data !== "object" || data === null) return false;

  const { status, statusText, events } = data as {
    status?: unknown;
    statusText?: unknown;
    events?: unknown;
  };
  return (
    typeof status === "string" &&
    typeof statusText === "string" &&
    Array.isArray(events)
  );
}

/** เลือกข้อความ error จาก code ที่รู้จัก ไม่ยกข้อความดิบจากระบบภายนอกมาแสดง */
export function toUserMessage(payload: unknown): string {
  const code =
    typeof payload === "object" && payload !== null
      ? (payload as { error?: { code?: unknown } }).error?.code
      : undefined;

  if (typeof code === "string" && code in ERROR_MESSAGE) {
    return ERROR_MESSAGE[code as TrackingErrorCode];
  }
  return FALLBACK_ERROR;
}

/** แปลง ISO 8601 เป็นวันเวลาแบบไทย เช่น "16 มิ.ย. 2569 18:43" */
export function formatThaiDateTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;

  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(timestamp);
}

/**
 * ยิง POST /api/track แล้วคืนผลลัพธ์ที่พร้อมแสดงผล
 * ไม่ throw ออกไปเลย — ทุกความผิดพลาดถูกแปลงเป็นข้อความไทยให้แล้ว
 *
 * รับ fetchImpl เข้ามาได้เพื่อให้ทดสอบด้วย mock ได้โดยไม่ต้องยิงเน็ตจริง
 */
export async function requestTracking(
  trackingNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TrackingOutcome> {
  const value = trackingNumber.trim();
  if (value === "") {
    return { ok: false, message: EMPTY_INPUT_MESSAGE };
  }

  try {
    const response = await fetchImpl("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingNumber: value }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (response.ok && isSuccessPayload(payload)) {
      return { ok: true, result: payload.data };
    }

    return { ok: false, message: toUserMessage(payload) };
  } catch {
    // fetch ล้มเหลวเอง เช่น เน็ตหลุด หรือเซิร์ฟเวอร์ไม่ตอบ
    return { ok: false, message: ERROR_MESSAGE.network_error };
  }
}
