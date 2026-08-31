/**
 * รวมขนส่งหลายเจ้าเข้าด้วยกันแบบ hybrid พร้อม cache
 *
 * ลำดับการทำงาน:
 *   0. เช็ค cache ก่อนเสมอ (memory → Supabase) ถ้ามีและยังไม่หมดอายุ คืนเลย
 *   0.5 เลขเดียวกันที่กำลังรอผลอยู่ ให้เกาะคำขอเดิมแทนที่จะยิงซ้ำ
 *   1. ดู prefix ของเลขก่อน แล้วแยกเป็นสองทาง
 *      1ก. prefix ฟันธงว่าเป็นขนส่งเจ้าอื่น (เช่น SPXTH → Shopee Xpress)
 *          → ข้ามไปรษณีย์ไทยไปเลย ยิง Track123 โดยระบุขนส่งเจาะจงทันที
 *            เลขทรงนี้ไม่มีทางอยู่ในระบบไปรษณีย์ไทย การถามจึงเสียเวลารอฟรีๆ
 *            และไม่ต้องเสีย call ให้การตรวจจับอัตโนมัติที่เดาผิดได้
 *      1ข. prefix ไม่ฟันธง → ถามไปรษณีย์ไทยก่อนตามเดิม เพราะฟรีและไม่จำกัดครั้ง
 *   2. ยังไม่เจอ → ให้ Track123 ตรวจจับขนส่งเอง
 *   3. ตรวจจับเองแล้วยังไม่พบ ค่อยยิงซ้ำโดยระบุขนส่งเจาะจงจากรายชื่อที่รู้ว่า
 *      การตรวจจับอัตโนมัติมักเดาผิด (ข้ามเจ้าที่ลองไปแล้วในขั้นที่ 1ก)
 *   4. ถ้า Track123 พังด้วยเหตุระบบ (ล่ม, โควตาหมด, circuit breaker ตัดวงจร)
 *      ค่อยข้ามไปผู้ให้บริการสำรอง ETrackings — เฉพาะตอน "พัง" เท่านั้น
 *      ไม่ใช่ตอนตอบว่า "ไม่พบ" เพราะแผนฟรีให้แค่ 50 ครั้ง/เดือน
 *   5. ถ้าไปรษณีย์ไทยพังด้วยสาเหตุอื่น (ระบบล่ม, timeout, ยิงถี่เกินไป ฯลฯ)
 *      จะไม่ fallback — คืน error ไปเลย เพื่อไม่ให้เปลือง quota ของเจ้าอื่น
 *
 * เก็บลง cache เฉพาะผลที่ค้นเจอ — ไม่ cache error เพราะพัสดุที่วันนี้ยังไม่พบ
 * พรุ่งนี้อาจเข้าระบบแล้ว
 *
 * ถ้ายิง API ไม่สำเร็จเพราะระบบมีปัญหา (ขนส่งล่ม, โควตาหมด, ชนลิมิตจนเอาไม่อยู่)
 * แต่มีข้อมูลเก่าค้างอยู่ใน cache จะคืนข้อมูลเก่านั้นพร้อมธง stale แทนการโยน
 * error — ผู้ใช้ต้องได้คำตอบพร้อมป้ายบอกว่าเป็นข้อมูล ณ เวลาใด ไม่ใช่หน้าจอ error
 *
 * แยกออกมาจาก API route เพื่อให้ทดสอบได้โดยไม่ต้องเปิดเซิร์ฟเวอร์
 * (pattern เดียวกับที่แยก lib/tracking-view.ts ออกจาก page.tsx)
 */

import { InflightMap } from "../inflight";
import type { PersistentTrackingCache } from "../supabase/tracking-cache";
import {
  lookupTracking,
  rememberTracking,
  type CacheSource,
} from "../tracking-cache";
import { courierFromPrefix } from "./courier-prefix";
import { etrackings, isConfigured as isBackupConfigured } from "./etrackings";
import { thailandPost } from "./thailand-post";
import { track123 } from "./track123";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingErrorCode,
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
const inflightResolves = new InflightMap<FreshResult>();

export interface ResolveOptions {
  /** ขนส่งที่ถามก่อน (ค่าเริ่มต้น: ไปรษณีย์ไทย) */
  primary?: CarrierAdapter;
  /** ขนส่งสำรองที่ถามต่อเมื่อเจ้าแรกไม่พบ (ค่าเริ่มต้น: Track123) */
  fallback?: CarrierAdapter;
  /**
   * ผู้ให้บริการสำรองชั้นสุดท้าย ใช้เมื่อ fallback พังด้วยเหตุระบบ
   * (ค่าเริ่มต้น: ETrackings ถ้าตั้ง env ไว้ ไม่งั้นเป็น null)
   *
   * null = ไม่มีเจ้าสำรอง ระบบจะตกไปที่ cache ตามกลไก degradation ตามปกติ
   */
  backup?: CarrierAdapter | null;
  /** true = ข้าม cache แล้วยิง API สดๆ (ยังบันทึกผลลง cache ตามปกติ) */
  skipCache?: boolean;
  /** ชั้น cache ถาวร (ค่าเริ่มต้น: ตาราง tracking_cache ใน Supabase) */
  persistentCache?: PersistentTrackingCache;
}

/** ชั้นที่ตอบคำค้นนี้ — "api" คือยิงถามขนส่งจริง */
export type ResolveSource = CacheSource | "api";

/** ผู้ให้บริการที่ตอบคำค้นนี้ — ไว้ดูจาก log ว่าคำค้นไหนใช้เจ้าไหน */
export type ResolveProvider =
  /** ไปรษณีย์ไทย */
  | "primary"
  /** Track123 */
  | "fallback"
  /** ผู้ให้บริการสำรอง (ETrackings) */
  | "backup"
  /** ตอบจาก cache ไม่ได้ยิงใคร */
  | "cache"
  /** ไม่มีใครตอบได้ */
  | "none";

export interface ResolvedTracking {
  result: TrackingResult;
  /** ชั้นที่ตอบคำค้นนี้ — ไว้นับ cache hit rate จาก log */
  source: ResolveSource;
  /**
   * true = ข้อมูลหมดอายุแล้ว แต่ถูกใช้เป็นคำตอบสำรองเพราะยิง API ไม่สำเร็จ
   *
   * UI ต้องขึ้นป้ายบอกผู้ใช้ว่าเป็นข้อมูล ณ เวลาใดเมื่อค่านี้เป็น true
   */
  stale: boolean;
  /** เวลาที่ดึงข้อมูลชุดนี้มาจากขนส่ง (ISO 8601) — null เมื่อเพิ่งยิงสดๆ */
  fetchedAt: string | null;
  /** ผู้ให้บริการที่ตอบคำค้นนี้ */
  provider: ResolveProvider;
  /**
   * true = ไปเกาะคำขอของเลขเดียวกันที่กำลังรอผลอยู่ ไม่ได้ยิง API เพิ่ม
   *
   * ไว้ดูว่าการรวมคำขอช่วยกันการยิงซ้ำได้จริงแค่ไหน (เช่นตอนผู้ใช้กดปุ่มรัว)
   */
  shared: boolean;
}

/**
 * สาเหตุที่ยอมคืนข้อมูลเก่าแทนการโยน error
 *
 * ทั้งหมดคือ "ฝั่งระบบมีปัญหา" ไม่ใช่คำตอบที่แท้จริงเกี่ยวกับพัสดุ ตั้งใจไม่รวม
 * not_found กับ invalid_tracking_number เพราะสองอันนั้นเป็นคำตอบจริงที่ผู้ใช้
 * ต้องได้เห็น การเอาข้อมูลเก่ามาบังไว้จะทำให้พัสดุที่หลุดออกจากระบบขนส่งไปแล้ว
 * ดูเหมือนยังตามได้อยู่ตลอดกาล
 */
const DEGRADE_ON: ReadonlySet<TrackingErrorCode> = new Set([
  "rate_limited",
  "network_error",
  "upstream_error",
  "auth_failed",
  "config_error",
]);

/** ตัดช่องว่างกับขีด และทำเป็นตัวพิมพ์ใหญ่ ใช้เป็นรูปแบบมาตรฐานของทั้งระบบ */
export function normalizeTrackingNumber(input: string): string {
  return (input ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/** บันทึกผลที่เพิ่งยิงมาได้ลง cache ทั้งสองชั้น แล้วส่งต่อ */
async function store(
  trackingNumber: string,
  result: TrackingResult,
  cache: PersistentTrackingCache | undefined,
): Promise<TrackingResult> {
  await rememberTracking(trackingNumber, result, cache);
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

/** ทางลัดยิงตรงไปหาขนส่งที่ prefix ฟันธงแล้ว */
interface PrefixShortcut {
  courierCode: string;
  track: () => Promise<TrackingResult>;
}

/**
 * หาทางลัดจาก prefix ของเลขพัสดุ — null เมื่อใช้ทางลัดไม่ได้
 *
 * ใช้ไม่ได้สองกรณี: prefix ไม่ฟันธงว่าเป็นเจ้าไหน หรือ adapter สำรองไม่รองรับ
 * การระบุขนส่งเจาะจง ทั้งสองกรณีต้องกลับไปใช้ลำดับเดิม (ถามไปรษณีย์ไทยก่อน)
 *
 * มัดรหัสขนส่งกับฟังก์ชันที่ผูก this ไว้แล้วมาเป็นก้อนเดียว เพื่อให้ผู้เรียก
 * เช็ค null ครั้งเดียวจบ ไม่ต้องเช็คสองค่าที่ต้องมีหรือไม่มีพร้อมกันเสมอ
 */
function prefixShortcut(
  trackingNumber: string,
  fallback: CarrierAdapter,
): PrefixShortcut | null {
  const trackWithCourier = fallback.trackWithCourier;
  if (trackWithCourier === undefined) return null;

  const courierCode = courierFromPrefix(trackingNumber);
  if (courierCode === null) return null;

  return {
    courierCode,
    track: () => trackWithCourier.call(fallback, trackingNumber, courierCode),
  };
}

/** ผลของการไล่ถามจริง พร้อมบอกว่าเจ้าไหนเป็นคนตอบ */
interface FreshResult {
  result: TrackingResult;
  provider: ResolveProvider;
}

/**
 * ยิงหนึ่งครั้งแล้วกลืน error ทุกชนิด — ใช้กับเจ้าสำรองเท่านั้น
 *
 * ต่างจาก attempt() ที่ปล่อย error ที่ไม่ใช่ "ไม่พบ" ทะลุขึ้นไป ตรงนี้ต้อง
 * กลืนทั้งหมด เพราะความล้มเหลวของเจ้าสำรองไม่ควรไปบัง error เดิมของ Track123
 * ซึ่งเป็นตัวที่ชั้นบนใช้ตัดสินใจเรื่องการคืนข้อมูลเก่าจาก cache
 */
async function attemptQuietly(
  call: () => Promise<TrackingResult>,
): Promise<TrackingResult | null> {
  try {
    return await call();
  } catch (error) {
    const carrierError = toCarrierError(error);
    console.warn(
      `[resolve] ผู้ให้บริการสำรองช่วยไม่ได้ (${carrierError.code}): ${carrierError.message}`,
    );
    return null;
  }
}

/**
 * ไล่ถามขนส่งจริงๆ ตามลำดับที่ประหยัดที่สุด — เรียกได้ก็ต่อเมื่อ cache ไม่มีของ
 * และไม่มีคำขอของเลขเดียวกันกำลังบินอยู่
 */
async function resolveFresh(
  normalized: string,
  primary: CarrierAdapter,
  fallback: CarrierAdapter,
  backup: CarrierAdapter | null,
  cache: PersistentTrackingCache | undefined,
): Promise<FreshResult> {
  // เจ้าที่ยิงไปแล้ว ไว้กันไม่ให้ขั้นถัดไปถามซ้ำคำถามเดิม และไว้อธิบายใน log
  const tried: string[] = [];
  const shortcut = prefixShortcut(normalized, fallback);

  if (shortcut === null) {
    // prefix ไม่ฟันธงว่าเป็นเจ้าไหน → ลำดับเดิม ถามไปรษณีย์ไทยก่อนเพราะฟรี
    // และไม่จำกัดจำนวนครั้ง จะได้ไม่ไปแตะ quota ของ Track123 โดยไม่จำเป็น
    const fromPrimary = await attempt(() => primary.track(normalized));
    if (fromPrimary !== null) {
      return { result: await store(normalized, fromPrimary, cache), provider: "primary" };
    }
  } else {
    // prefix ฟันธงว่าเป็นขนส่งเจ้าอื่น → ข้ามไปรษณีย์ไทยไปเลย
    //
    // เลขทรงนี้ (เช่น SPXTH...) เป็นรูปแบบเฉพาะของขนส่งเจ้านั้น ไม่มีทางอยู่ใน
    // ระบบไปรษณีย์ไทย การถามจึงได้ not_found แน่นอนอยู่แล้ว เสียแค่เวลารอ
    // ของผู้ใช้ไปหนึ่งรอบเปล่าๆ ที่กล้าข้ามได้เพราะตาราง prefix รับเฉพาะแถวที่
    // ผ่านเกณฑ์ "ฟันธงได้จริง" (ดูเกณฑ์ในหัว lib/carriers/courier-prefix.ts)
    tried.push(shortcut.courierCode);
  }

  // ---- Track123 ----
  // ห่อทั้งก้อนไว้ เพราะถ้าพังด้วยเหตุระบบต้องข้ามไปเจ้าสำรอง ไม่ใช่เลิกทันที
  let fallbackError: CarrierError | null = null;

  try {
    if (shortcut !== null) {
      const byPrefix = await attempt(shortcut.track);
      if (byPrefix !== null) {
        return { result: await store(normalized, byPrefix, cache), provider: "fallback" };
      }
    }

    // ยังไม่เจอ → ให้ Track123 ตรวจจับขนส่งเอง
    // ยังต้องลองขั้นนี้แม้ prefix จะพลาด เพราะพัสดุข้ามประเทศอาจเปลี่ยนมือไปให้
    // ขนส่งเจ้าอื่นเดินช่วงสุดท้าย ซึ่ง prefix ต้นทางบอกไม่ได้
    const autoDetected = await attempt(() => fallback.track(normalized));
    if (autoDetected !== null) {
      return { result: await store(normalized, autoDetected, cache), provider: "fallback" };
    }

    // การตรวจจับขนส่งอัตโนมัติเดาผิดได้ เช่นเลขของ Shopee Xpress ที่ถูกเดาเป็น
    // Flash Express แล้วตอบว่าไม่พบทั้งที่พัสดุมีอยู่จริง จึงลองยิงซ้ำโดยระบุ
    // ขนส่งเจาะจงจากรายชื่อที่รู้ว่ามีปัญหา
    const retried = await retryWithCourierCodes(normalized, fallback, tried);
    tried.push(...retried.codes);
    if (retried.result !== null) {
      return { result: await store(normalized, retried.result, cache), provider: "fallback" };
    }
  } catch (error) {
    fallbackError = toCarrierError(error);
  }

  // ---- ผู้ให้บริการสำรอง ----
  // ใช้เฉพาะตอน Track123 "พัง" เท่านั้น ไม่ใช่ตอนตอบว่า "ไม่พบ" เพราะแผนฟรี
  // ให้แค่ 50 ครั้ง/เดือน การยิงทุกครั้งที่ค้นไม่เจอจะกินหมดภายในไม่กี่วัน
  if (fallbackError !== null && backup !== null) {
    const viaBackup = await attemptQuietly(() => backup.track(normalized));
    if (viaBackup !== null) {
      return { result: await store(normalized, viaBackup, cache), provider: "backup" };
    }
  }

  // เจ้าสำรองก็ช่วยไม่ได้ → ส่ง error เดิมของ Track123 ขึ้นไป
  // เพื่อให้ชั้นบนตัดสินใจเรื่องการคืนข้อมูลเก่าจาก cache ได้ถูกต้องตาม code จริง
  if (fallbackError !== null) throw fallbackError;

  // ไม่พบจริงๆ ทุกทาง → บอกให้ชัดว่าค้นครบแล้ว
  throw new CarrierError(
    "not_found",
    "ไม่พบข้อมูลเลขพัสดุนี้ในระบบขนส่งที่รองรับ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
    {
      debugMessage:
        `ไม่พบเลข ${normalized} ที่ ` +
        (shortcut === null
          ? `${primary.carrierCode} และ ${fallback.carrierCode}`
          : `${fallback.carrierCode} (ข้าม ${primary.carrierCode} เพราะ prefix ชี้ว่าเป็น ${shortcut.courierCode})`) +
        (tried.length === 0
          ? ""
          : ` — ระบุขนส่งเจาะจงแล้ว ${tried.length} เจ้า: ${tried.join(", ")}`),
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
  // ยังไม่ได้ตั้ง env ของเจ้าสำรอง → ทำงานเหมือนเดิมทุกประการ ไม่มีเจ้าสำรอง
  const backup =
    options.backup === undefined
      ? isBackupConfigured()
        ? etrackings
        : null
      : options.backup;

  const normalized = normalizeTrackingNumber(trackingNumber);

  if (!/^[A-Z0-9]{6,40}$/.test(normalized)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  // อ่าน cache ครั้งเดียวได้ทั้งของสด (คืนเลย) และของเก่า (เก็บไว้เป็นคำตอบ
  // สำรองเผื่อยิง API ไม่สำเร็จ) จะได้ไม่ต้องวิ่งไปถาม Supabase อีกรอบขาล้มเหลว
  const cached = options.skipCache
    ? null
    : await lookupTracking(normalized, options.persistentCache);

  if (cached !== null && !cached.stale) {
    return {
      result: cached.entry.result,
      source: cached.source,
      stale: false,
      fetchedAt: new Date(cached.entry.fetchedAt).toISOString(),
      provider: "cache",
      shared: false,
    };
  }

  // เลขเดียวกันที่กำลังรอผลอยู่ให้เกาะคำขอเดิม — cache ช่วยตรงนี้ไม่ได้ เพราะผล
  // ยังไม่ถูกบันทึกจนกว่าคำขอแรกจะเสร็จ ช่วงที่คำขอแรกกำลังบินคือช่องว่างที่
  // คนกดปุ่มรัวหรือคนละคนที่ค้นเลขเดียวกันจะหลุดออกไปยิงซ้ำได้
  const run = inflightResolves.start(normalized, () =>
    resolveFresh(normalized, primary, fallback, backup, options.persistentCache),
  );

  try {
    const fresh = await run.promise;
    return {
      result: fresh.result,
      source: "api",
      stale: false,
      fetchedAt: null,
      provider: fresh.provider,
      shared: run.joined,
    };
  } catch (error) {
    const carrierError = toCarrierError(error);

    // ระบบมีปัญหา แต่เรามีของเก่าอยู่ → คืนของเก่าพร้อมธง stale
    // ผู้ใช้ได้คำตอบพร้อมป้ายบอกเวลา ดีกว่าหน้าจอ error ที่ทำอะไรต่อไม่ได้เลย
    if (cached === null || !DEGRADE_ON.has(carrierError.code)) throw carrierError;

    return {
      result: cached.entry.result,
      source: cached.source,
      stale: true,
      fetchedAt: new Date(cached.entry.fetchedAt).toISOString(),
      provider: "cache",
      shared: run.joined,
    };
  }
}
