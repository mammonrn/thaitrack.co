/**
 * รวมขนส่งหลายเจ้าเข้าด้วยกันแบบ hybrid พร้อม cache
 *
 * ลำดับการทำงาน:
 *   0. เช็ค cache ก่อนเสมอ — ถ้ามีและยังไม่หมดอายุ คืนเลยโดยไม่ยิง API ใดๆ
 *   1. ถามไปรษณีย์ไทยก่อน — ฟรีและไม่จำกัดจำนวนครั้ง
 *   2. ถ้าไปรษณีย์ไทยตอบว่า "ไม่พบเลขนี้" (not_found) ค่อยถาม Track123 ต่อ
 *      เผื่อเป็นพัสดุของขนส่งเจ้าอื่น (ให้ Track123 ตรวจจับขนส่งเอง)
 *   3. ถ้า Track123 ตรวจจับเองแล้วยังไม่พบ ค่อยยิงซ้ำโดยระบุขนส่งเจาะจงจาก
 *      รายชื่อที่รู้ว่าการตรวจจับอัตโนมัติมักเดาผิด
 *   4. ถ้าไปรษณีย์ไทยพังด้วยสาเหตุอื่น (ระบบล่ม, timeout, ยิงถี่เกินไป ฯลฯ)
 *      จะไม่ fallback — คืน error ไปเลย เพื่อไม่ให้เปลือง quota ของ Track123
 *
 * เก็บลง cache เฉพาะผลที่ค้นเจอ — ไม่ cache error เพราะพัสดุที่วันนี้ยังไม่พบ
 * พรุ่งนี้อาจเข้าระบบแล้ว
 *
 * แยกออกมาจาก API route เพื่อให้ทดสอบได้โดยไม่ต้องเปิดเซิร์ฟเวอร์
 * (pattern เดียวกับที่แยก lib/tracking-view.ts ออกจาก page.tsx)
 */

import { getCached, setCached } from "../cache";
import { thailandPost } from "./thailand-post";
import { track123 } from "./track123";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingResult,
} from "./types";

/** สาเหตุเดียวที่ทำให้ยอมถามขนส่งเจ้าที่สอง */
const FALLBACK_TRIGGER = "not_found";

/**
 * เพดานจำนวนขนส่งที่ยอมลองระบุเจาะจงต่อการค้นหาหนึ่งครั้ง
 *
 * แต่ละครั้งที่ลองคือการยิง Track123 เพิ่มอีก 1 ครั้ง ถ้าปล่อยให้ไล่ทั้งรายการ
 * การค้นหาเลขที่ไม่มีอยู่จริงหนึ่งครั้งจะกิน quota เท่ากับความยาวของรายการ
 * จึงจำกัดไว้ ต่อให้ในอนาคตรายการจะยาวขึ้นก็ตาม
 */
const MAX_COURIER_RETRIES = 3;

export interface ResolveOptions {
  /** ขนส่งที่ถามก่อน (ค่าเริ่มต้น: ไปรษณีย์ไทย) */
  primary?: CarrierAdapter;
  /** ขนส่งสำรองที่ถามต่อเมื่อเจ้าแรกไม่พบ (ค่าเริ่มต้น: Track123) */
  fallback?: CarrierAdapter;
  /** true = ข้าม cache แล้วยิง API สดๆ (ยังบันทึกผลลง cache ตามปกติ) */
  skipCache?: boolean;
}

export interface ResolvedTracking {
  result: TrackingResult;
  /** true = ได้จาก cache, false = เพิ่งยิง API จริง — ไว้ debug */
  fromCache: boolean;
}

/** ตัดช่องว่างกับขีด และทำเป็นตัวพิมพ์ใหญ่ ใช้เป็นรูปแบบมาตรฐานของทั้งระบบ */
export function normalizeTrackingNumber(input: string): string {
  return (input ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/** บันทึกผลที่เพิ่งยิงมาได้ลง cache แล้วคืนในรูปแบบมาตรฐาน */
function fresh(
  trackingNumber: string,
  result: TrackingResult,
): ResolvedTracking {
  setCached(trackingNumber, result);
  return { result, fromCache: false };
}

/** แปลง error ที่ไม่รู้จักให้เป็น CarrierError เสมอ เพื่อไม่ให้มี error ดิบหลุดขึ้นไป */
function toCarrierError(error: unknown): CarrierError {
  if (error instanceof CarrierError) return error;
  return new CarrierError(
    "upstream_error",
    "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง",
    { cause: error, debugMessage: "adapter โยน error ที่ไม่ใช่ CarrierError" },
  );
}

interface CourierRetryOutcome {
  /** ผลลัพธ์ที่หาเจอ — null คือลองครบแล้วยังไม่เจอ */
  result: TrackingResult | null;
  /** error ที่ไม่ใช่ "ไม่พบ" ซึ่งควรหยุดทันทีและส่งต่อขึ้นไป */
  error: CarrierError | null;
  /** จำนวนครั้งที่ยิงจริง ไว้ให้ผู้เรียกอธิบายใน log และไว้ติดตาม quota */
  attempts: number;
  /** รหัสขนส่งที่ลองไปแล้ว */
  codes: string[];
}

/**
 * ลองยิงซ้ำโดยระบุขนส่งเจาะจงทีละเจ้า จนกว่าจะเจอหรือครบเพดาน
 *
 * เจอ error ที่ไม่ใช่ "ไม่พบ" เมื่อไร หยุดทันที เพราะถ้าเป็นปัญหาสิทธิ์หรือ
 * ยิงถี่เกินไป การลองเจ้าที่เหลือก็จะพังเหมือนกันและเปลือง quota เปล่าๆ
 */
async function retryWithCourierCodes(
  trackingNumber: string,
  adapter: CarrierAdapter,
): Promise<CourierRetryOutcome> {
  const outcome: CourierRetryOutcome = {
    result: null,
    error: null,
    attempts: 0,
    codes: [],
  };

  const trackWithCourier = adapter.trackWithCourier;
  if (trackWithCourier === undefined) return outcome;

  const candidates = (adapter.retryCourierCodes ?? []).slice(
    0,
    MAX_COURIER_RETRIES,
  );

  for (const courierCode of candidates) {
    outcome.attempts += 1;
    outcome.codes.push(courierCode);

    try {
      outcome.result = await trackWithCourier.call(
        adapter,
        trackingNumber,
        courierCode,
      );
      return outcome;
    } catch (error) {
      const retryError = toCarrierError(error);
      if (retryError.code !== FALLBACK_TRIGGER) {
        outcome.error = retryError;
        return outcome;
      }
    }
  }

  return outcome;
}

/**
 * ค้นหาสถานะพัสดุจากขนส่งที่รองรับ โดยไล่ตามลำดับที่ประหยัดค่าใช้จ่ายที่สุด
 *
 * ทุกความผิดพลาดถูกโยนเป็น CarrierError — ไม่มี error ดิบหลุดออกไป
 */
export async function resolveTracking(
  trackingNumber: string,
  options: ResolveOptions = {},
): Promise<ResolvedTracking> {
  const primary = options.primary ?? thailandPost;
  const fallback = options.fallback ?? track123;

  const normalized = normalizeTrackingNumber(trackingNumber);

  if (!/^[A-Z0-9]{6,40}$/.test(normalized)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  if (!options.skipCache) {
    const cached = getCached(normalized);
    if (cached) {
      return { result: cached.result, fromCache: true };
    }
  }

  try {
    return fresh(normalized, await primary.track(normalized));
  } catch (error) {
    const primaryError = toCarrierError(error);

    // ไม่ใช่กรณี "ไม่พบ" → ไม่ต้องไปรบกวน (และเปลือง quota) ขนส่งเจ้าที่สอง
    if (primaryError.code !== FALLBACK_TRIGGER) {
      throw primaryError;
    }

    try {
      return fresh(normalized, await fallback.track(normalized));
    } catch (fallbackError) {
      const secondError = toCarrierError(fallbackError);

      if (secondError.code !== FALLBACK_TRIGGER) throw secondError;

      // ขั้นที่ 3 — การตรวจจับขนส่งอัตโนมัติเดาผิดได้ เช่นเลขของ Shopee Xpress
      // ที่ถูกเดาเป็น Flash Express แล้วตอบว่าไม่พบทั้งที่พัสดุมีอยู่จริง
      // จึงลองยิงซ้ำโดยระบุขนส่งเจาะจงจากรายชื่อที่รู้ว่ามีปัญหา
      const tried = await retryWithCourierCodes(normalized, fallback);
      if (tried.result !== null) return fresh(normalized, tried.result);

      // ระหว่างลองซ้ำเจอปัญหาจริง (สิทธิ์หมด, ยิงถี่เกินไป) ไม่ใช่แค่ไม่พบ
      if (tried.error !== null) throw tried.error;

      // ไม่พบจริงๆ ทุกทาง → บอกให้ชัดว่าค้นครบแล้ว
      throw new CarrierError(
        "not_found",
        "ไม่พบข้อมูลเลขพัสดุนี้ในระบบขนส่งที่รองรับ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
        {
          debugMessage:
            `ไม่พบเลข ${normalized} ทั้งที่ ${primary.carrierCode} และ ${fallback.carrierCode}` +
            (tried.attempts === 0
              ? ""
              : ` (ลองระบุขนส่งเจาะจงอีก ${tried.attempts} เจ้าแล้ว: ${tried.codes.join(", ")})`),
        },
      );
    }
  }
}
