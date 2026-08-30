/**
 * รวมขนส่งหลายเจ้าเข้าด้วยกันแบบ hybrid พร้อม cache
 *
 * ลำดับการทำงาน:
 *   0. เช็ค cache ก่อนเสมอ — ถ้ามีและยังไม่หมดอายุ คืนเลยโดยไม่ยิง API ใดๆ
 *   0.5 เลขเดียวกันที่กำลังรอผลอยู่ ให้เกาะคำขอเดิมแทนที่จะยิงซ้ำ
 *   1. ถามไปรษณีย์ไทยก่อน — ฟรีและไม่จำกัดจำนวนครั้ง
 *   2. ถ้าไปรษณีย์ไทยตอบว่า "ไม่พบเลขนี้" (not_found) ค่อยถาม Track123 ต่อ
 *      เผื่อเป็นพัสดุของขนส่งเจ้าอื่น โดยถ้า prefix ของเลขบอกได้แน่ๆ ว่าเป็นเจ้าไหน
 *      (เช่น SPXTH → Shopee Xpress) ให้ระบุเจาะจงไปเลย ไม่ต้องเสีย call ให้
 *      การตรวจจับอัตโนมัติที่เดาผิดได้
 *   3. prefix ไม่รู้จัก หรือระบุแล้วยังไม่เจอ → ให้ Track123 ตรวจจับขนส่งเอง
 *   4. ตรวจจับเองแล้วยังไม่พบ ค่อยยิงซ้ำโดยระบุขนส่งเจาะจงจากรายชื่อที่รู้ว่า
 *      การตรวจจับอัตโนมัติมักเดาผิด (ข้ามเจ้าที่ลองไปแล้วในขั้นที่ 2)
 *   5. ถ้าไปรษณีย์ไทยพังด้วยสาเหตุอื่น (ระบบล่ม, timeout, ยิงถี่เกินไป ฯลฯ)
 *      จะไม่ fallback — คืน error ไปเลย เพื่อไม่ให้เปลือง quota ของ Track123
 *
 * เก็บลง cache เฉพาะผลที่ค้นเจอ — ไม่ cache error เพราะพัสดุที่วันนี้ยังไม่พบ
 * พรุ่งนี้อาจเข้าระบบแล้ว
 *
 * แยกออกมาจาก API route เพื่อให้ทดสอบได้โดยไม่ต้องเปิดเซิร์ฟเวอร์
 * (pattern เดียวกับที่แยก lib/tracking-view.ts ออกจาก page.tsx)
 */

import { getCached, setCached } from "../cache";
import { InflightMap } from "../inflight";
import { courierFromPrefix } from "./courier-prefix";
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

/**
 * ทะเบียนคำขอที่กำลังรอผลอยู่ แยกตามเลขพัสดุที่ normalize แล้ว
 *
 * ใช้ร่วมกันทั้งโปรเซส เพราะเป้าหมายคือกันการยิงซ้ำข้าม request ของ Next
 * ไม่ใช่กันซ้ำภายใน request เดียว
 */
const inflightResolves = new InflightMap<TrackingResult>();

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
  /**
   * true = ไปเกาะคำขอของเลขเดียวกันที่กำลังรอผลอยู่ ไม่ได้ยิง API เพิ่ม
   *
   * ไว้ดูว่าการรวมคำขอช่วยกันการยิงซ้ำได้จริงแค่ไหน (เช่นตอนผู้ใช้กดปุ่มรัว)
   */
  shared: boolean;
}

/** ตัดช่องว่างกับขีด และทำเป็นตัวพิมพ์ใหญ่ ใช้เป็นรูปแบบมาตรฐานของทั้งระบบ */
export function normalizeTrackingNumber(input: string): string {
  return (input ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/** บันทึกผลที่เพิ่งยิงมาได้ลง cache แล้วส่งต่อ */
function store(
  trackingNumber: string,
  result: TrackingResult,
): TrackingResult {
  setCached(trackingNumber, result);
  return result;
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

/**
 * ยิงหนึ่งครั้งแล้วบอกว่า "เจอ" หรือ "ไม่พบ"
 *
 * error ที่ไม่ใช่ "ไม่พบ" ถูกโยนต่อขึ้นไปทันที เพราะถ้าเป็นปัญหาสิทธิ์หรือยิงถี่
 * เกินไป การลองทางที่เหลือก็จะพังเหมือนกันและเปลือง quota เปล่าๆ
 */
async function attempt(
  call: () => Promise<TrackingResult>,
): Promise<TrackingResult | null> {
  try {
    return await call();
  } catch (error) {
    const carrierError = toCarrierError(error);
    if (carrierError.code !== FALLBACK_TRIGGER) throw carrierError;
    return null;
  }
}

/**
 * ลองยิงซ้ำโดยระบุขนส่งเจาะจงทีละเจ้า จนกว่าจะเจอหรือครบเพดาน
 *
 * `alreadyTried` คือเจ้าที่ยิงไปแล้วในขั้นก่อนหน้า (เช่นเจ้าที่เดาจาก prefix)
 * ต้องข้ามไป ไม่งั้นจะยิงซ้ำคำถามเดิมและกิน quota ฟรีๆ
 */
async function retryWithCourierCodes(
  trackingNumber: string,
  adapter: CarrierAdapter,
  alreadyTried: readonly string[],
): Promise<{ result: TrackingResult | null; codes: string[] }> {
  const trackWithCourier = adapter.trackWithCourier;
  if (trackWithCourier === undefined) return { result: null, codes: [] };

  const candidates = (adapter.retryCourierCodes ?? [])
    .filter((code) => !alreadyTried.includes(code))
    .slice(0, MAX_COURIER_RETRIES);

  const codes: string[] = [];

  for (const courierCode of candidates) {
    codes.push(courierCode);

    const result = await attempt(() =>
      trackWithCourier.call(adapter, trackingNumber, courierCode),
    );
    if (result !== null) return { result, codes };
  }

  return { result: null, codes };
}

/**
 * ไล่ถามขนส่งจริงๆ ตามลำดับที่ประหยัดที่สุด — เรียกได้ก็ต่อเมื่อ cache ไม่มีของ
 * และไม่มีคำขอของเลขเดียวกันกำลังบินอยู่
 */
async function resolveFresh(
  normalized: string,
  primary: CarrierAdapter,
  fallback: CarrierAdapter,
): Promise<TrackingResult> {
  const fromPrimary = await attempt(() => primary.track(normalized));
  if (fromPrimary !== null) return store(normalized, fromPrimary);

  // เจ้าที่ยิงไปแล้ว ไว้กันไม่ให้ขั้นถัดไปถามซ้ำคำถามเดิม และไว้อธิบายใน log
  const tried: string[] = [];

  // prefix บอกได้แน่ๆ ว่าเป็นขนส่งเจ้าไหน → ยิงตรงเลย ประหยัดไป 1 call
  // เทียบกับการปล่อยให้ auto-detect เดาผิดแล้วค่อยมาลองซ้ำทีหลัง
  const prefixCourier = courierFromPrefix(normalized);
  const trackWithCourier = fallback.trackWithCourier;

  if (prefixCourier !== null && trackWithCourier !== undefined) {
    tried.push(prefixCourier);

    const byPrefix = await attempt(() =>
      trackWithCourier.call(fallback, normalized, prefixCourier),
    );
    if (byPrefix !== null) return store(normalized, byPrefix);
  }

  // prefix ไม่รู้จัก หรือระบุแล้วยังไม่เจอ → ให้ Track123 ตรวจจับขนส่งเอง
  // ยังต้องลองขั้นนี้แม้ prefix จะพลาด เพราะพัสดุข้ามประเทศอาจเปลี่ยนมือไปให้
  // ขนส่งเจ้าอื่นเดินช่วงสุดท้าย ซึ่ง prefix ต้นทางบอกไม่ได้
  const autoDetected = await attempt(() => fallback.track(normalized));
  if (autoDetected !== null) return store(normalized, autoDetected);

  // ขั้นสุดท้าย — การตรวจจับขนส่งอัตโนมัติเดาผิดได้ เช่นเลขของ Shopee Xpress
  // ที่ถูกเดาเป็น Flash Express แล้วตอบว่าไม่พบทั้งที่พัสดุมีอยู่จริง
  // จึงลองยิงซ้ำโดยระบุขนส่งเจาะจงจากรายชื่อที่รู้ว่ามีปัญหา
  const retried = await retryWithCourierCodes(normalized, fallback, tried);
  if (retried.result !== null) return store(normalized, retried.result);

  tried.push(...retried.codes);

  // ไม่พบจริงๆ ทุกทาง → บอกให้ชัดว่าค้นครบแล้ว
  throw new CarrierError(
    "not_found",
    "ไม่พบข้อมูลเลขพัสดุนี้ในระบบขนส่งที่รองรับ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
    {
      debugMessage:
        `ไม่พบเลข ${normalized} ทั้งที่ ${primary.carrierCode} และ ${fallback.carrierCode}` +
        (tried.length === 0
          ? ""
          : ` (ระบุขนส่งเจาะจงอีก ${tried.length} เจ้าแล้ว: ${tried.join(", ")})`),
    },
  );
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
      return { result: cached.result, fromCache: true, shared: false };
    }
  }

  // เลขเดียวกันที่กำลังรอผลอยู่ให้เกาะคำขอเดิม — cache ช่วยตรงนี้ไม่ได้ เพราะผล
  // ยังไม่ถูกบันทึกจนกว่าคำขอแรกจะเสร็จ ช่วงที่คำขอแรกกำลังบินคือช่องว่างที่
  // คนกดปุ่มรัวหรือคนละคนที่ค้นเลขเดียวกันจะหลุดออกไปยิงซ้ำได้
  const run = inflightResolves.start(normalized, () =>
    resolveFresh(normalized, primary, fallback),
  );

  return {
    result: await run.promise,
    fromCache: false,
    shared: run.joined,
  };
}
