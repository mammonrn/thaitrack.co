/**
 * รวมขนส่งหลายเจ้าเข้าด้วยกันแบบ hybrid พร้อม cache
 *
 * ลำดับการทำงาน:
 *   0. เช็ค cache ก่อนเสมอ (memory → Supabase) ถ้ามีและยังไม่หมดอายุ คืนเลย
 *   0.5 เลขเดียวกันที่กำลังรอผลอยู่ ให้เกาะคำขอเดิมแทนที่จะยิงซ้ำ
 *   1. ดู prefix ของเลขก่อน แล้วแยกเป็นสองทาง
 *      1ก. prefix ฟันธงว่าเป็นขนส่งเจ้าอื่น (เช่น SPXTH → Shopee Xpress)
 *          → ข้ามไปรษณีย์ไทยไปเลย เพราะเลขทรงนี้ไม่มีทางอยู่ในระบบไปรษณีย์ไทย
 *            การถามจึงเสียเวลารอฟรีๆ
 *      1ข. prefix ไม่ฟันธง → ถามไปรษณีย์ไทยก่อนตามเดิม เพราะฟรีและไม่จำกัดครั้ง
 *   2. ยังไม่เจอ → ไล่ถามสองเจ้าที่เสียเงิน **ตามความถนัด** (ดู chooseProviderOrder)
 *   3. เจ้าไหนพังก็สลับไปอีกเจ้าอัตโนมัติ
 *
 * ------------------------------------------------------------------
 * ทำไมถึงเป็น "สลับใช้ตามความถนัด" ไม่ใช่ "เจ้าหลัก + เจ้าสำรอง"
 *
 * ทั้ง Track123 และ ETrackings เสียเงินรายเดือนทั้งคู่ ของที่จ่ายแล้วไม่ได้ใช้
 * คือของที่เสียเปล่า และที่แย่กว่านั้นคือเจ้าที่ไม่เคยถูกแตะจะไปพังตอนที่เรา
 * ต้องใช้จริง โดยไม่มีใครรู้มาก่อน การใช้ทั้งคู่สม่ำเสมอทำให้ log บอกเราได้
 * ทันทีว่าเจ้าไหนเริ่มมีปัญหา
 *
 * ความถนัดของแต่ละเจ้า:
 *   ETrackings  ต้องระบุขนส่งเอง (ตามเลขที่เดาขนส่งไม่ได้ไม่ได้เลย) แต่คืน
 *               ข้อความไทยล้วน **และที่อยู่เต็มของสาขา** ซึ่งเป็นวัตถุดิบเดียว
 *               ที่ทำให้เติมพิกัดสาขาอัตโนมัติได้ (ดู lib/branch-harvest.ts)
 *   Track123    ตรวจจับขนส่งเองได้ จึงเป็นเจ้าเดียวที่รับมือเลขที่เดาไม่ออก
 *
 * ผลคือ: prefix ฟันธงได้และ ETrackings รองรับ → ETrackings ก่อน
 *        นอกนั้น → Track123 ก่อน
 * ------------------------------------------------------------------
 *
 * กติกาการ "ไปต่อเจ้าถัดไป" ต่างกันสองแบบโดยตั้งใจ:
 *   พังด้วยเหตุระบบ → ไปต่อเสมอ ทั้งสองเจ้า
 *   ตอบว่าไม่พบ     → ไปต่อเฉพาะเมื่อเจ้าที่ตอบคือ ETrackings
 *
 * เพราะ ETrackings ยิงครั้งเดียวด้วยขนส่งที่เราเดาให้ ถ้าเดาผิดก็ตอบไม่พบทั้งที่
 * พัสดุมีอยู่จริง ส่วน Track123 ตรวจจับเองแล้วยังไล่ระบุเจาะจงซ้ำอีกหลายเจ้า
 * คำว่า "ไม่พบ" ของมันจึงหนักแน่นกว่ามาก การถามต่อมีแต่จะจ่ายโควตาให้คำตอบเดิม
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

import { harvestBranchCoordinates } from "../branch-harvest";
import { InflightMap } from "../inflight";
import {
  canUseForLookup,
  isNearLookupQuota,
  loadProviderUsage,
  usageLabel,
} from "../provider-usage";
import type { PersistentTrackingCache } from "../supabase/tracking-cache";
import {
  supabaseTrackingCourierStore,
  type TrackingCourierStore,
} from "../supabase/tracking-couriers";
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

/** code ที่แปลว่า "ปลายทางตอบแล้วว่าไม่มีเลขนี้" ไม่ใช่ "ปลายทางมีปัญหา" */
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
  /**
   * เจ้าที่ตรวจจับขนส่งเองได้ (ค่าเริ่มต้น: Track123)
   *
   * ชื่อ "fallback" ตกทอดมาจากตอนที่มันเป็นเจ้าที่สองจริงๆ ตอนนี้มันอาจได้ยิง
   * ก่อนหรือหลัง ETrackings ก็ได้ แล้วแต่ลำดับที่ chooseProviderOrder ตัดสิน
   */
  fallback?: CarrierAdapter;
  /**
   * เจ้าที่ต้องระบุขนส่งเอง แต่ให้ที่อยู่สาขามาด้วย
   * (ค่าเริ่มต้น: ETrackings ถ้าตั้ง env ไว้ ไม่งั้นเป็น null)
   *
   * null = ไม่มีเจ้านี้ ระบบใช้ Track123 เจ้าเดียวและยังทำงานได้ครบทุกอย่าง
   * ยกเว้นการเติมพิกัดสาขาอัตโนมัติ
   */
  backup?: CarrierAdapter | null;
  /** true = ข้าม cache แล้วยิง API สดๆ (ยังบันทึกผลลง cache ตามปกติ) */
  skipCache?: boolean;
  /** ชั้น cache ถาวร (ค่าเริ่มต้น: ตาราง tracking_cache ใน Supabase) */
  persistentCache?: PersistentTrackingCache;
  /**
   * ความจำว่าเลขไหนเป็นของขนส่งเจ้าไหน
   * (ค่าเริ่มต้น: ตาราง tracking_couriers ใน Supabase)
   *
   * แยกจาก cache โดยตั้งใจ — "เลขนี้เป็นของ SPX" เป็นจริงตลอดกาล ไม่ควรหมดอายุ
   * พร้อมสถานะพัสดุ (ดู lib/supabase/tracking-couriers.ts)
   */
  courierStore?: TrackingCourierStore;
  /**
   * ขนส่งที่ "หน้าที่ผู้ใช้ยืนอยู่" บอกใบ้มา (หน้า landing รายขนส่ง)
   *
   * ------------------------------------------------------------------
   * ⚠️ ต่างจาก courier ที่จำไว้ในตาราง tracking_couriers อย่างสิ้นเชิง
   *
   * ตารางนั้นเก็บ "ข้อเท็จจริงที่พิสูจน์แล้ว" ว่าเลขนี้เป็นของเจ้าไหน ส่วนค่านี้
   * เป็นแค่ "คนนี้เปิดหน้า Flash อยู่" ซึ่งเดาผิดได้ง่ายมาก — คนเปิดหน้า Flash
   * แล้ววางเลข SPX มีจริงและต้องได้คำตอบที่ถูก
   *
   * จึงใช้มันในจุดเดียวที่ผิดแล้วไม่เสียอะไร: **ท้ายสุด หลังการตรวจจับอัตโนมัติ
   * ตอบว่าไม่พบแล้ว** (ดู runFallback) ผลคือ
   *   เดาถูก  → กู้เคสที่ auto-detect พลาดได้ โดยไม่เสีย call เพิ่มในทางที่สำเร็จ
   *   เดาผิด  → ไม่มีอะไรเปลี่ยน เพราะขั้นนั้นจะถูกไล่อยู่แล้วด้วยรายการมาตรฐาน
   *
   * และ **ห้ามเอาไปใช้กับ ETrackings เด็ดขาด** โควตาที่นั่นเหลือน้อยและถูกสงวน
   * ไว้ให้การเก็บที่อยู่สาขา (ดู canUseForLookup ใน lib/provider-usage.ts)
   * การยิงไปด้วยการเดาคือการเผาของหายากไปกับความน่าจะเป็น
   * ------------------------------------------------------------------
   */
  pageCourierHint?: string;
}

/** ชั้นที่ตอบคำค้นนี้ — "api" คือยิงถามขนส่งจริง */
export type ResolveSource = CacheSource | "api";

/** ผู้ให้บริการที่ตอบคำค้นนี้ — ไว้ดูจาก log ว่าคำค้นไหนใช้เจ้าไหน */
export type ResolveProvider =
  /** ไปรษณีย์ไทย */
  | "primary"
  /** Track123 — เจ้าที่ตรวจจับขนส่งเองได้ */
  | "fallback"
  /** ETrackings — เจ้าที่ต้องระบุขนส่งเอง แต่ให้ที่อยู่สาขามาด้วย */
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
 * error ของ resolve ที่พ่วง "ทำไมถึงไม่มีเจ้าที่สองให้ไปต่อ" มาด้วย
 *
 * มีไว้ตอบคำถามเดียวที่ log ปกติตอบไม่ได้: **ระบบล้มเพราะเหลือผู้ให้บริการ
 * เจ้าเดียวบ่อยแค่ไหน** ซึ่งเป็นตัวเลขที่ต้องใช้ตัดสินใจว่าจะลงทุนทำกลไก
 * "เดา courier แล้วยิง ETrackings ตอนจนตรอก" หรือไม่ (ยังไม่ทำ รอตัวเลขก่อน)
 *
 * เป็น subclass ของ CarrierError เพื่อให้ทุกที่ที่เช็ค `instanceof CarrierError`
 * อยู่แล้วทำงานเหมือนเดิมทุกประการ และเพื่อให้ฟิลด์นี้ไม่ต้องไปโผล่ในสัญญากลาง
 * ของ adapter ทุกเจ้า (lib/carriers/types.ts) ทั้งที่เป็นเรื่องของการจัดลำดับ
 * ซึ่งเป็นงานของไฟล์นี้ที่เดียว
 *
 * สร้างใหม่แทนการยัดฟิลด์ใส่ error เดิม เพราะ error เดิมเป็นของ adapter ที่
 * อาจถูกอ้างถึงจากที่อื่น การไปแก้ไขของคนอื่นกลางทางคือบั๊กที่ตามยาก
 */
export class ResolveError extends CarrierError {
  /**
   * true = ล้มทั้งที่ตั้งค่าเจ้าสำรองไว้แล้ว แต่ใช้ไม่ได้เพราะไม่รู้ว่าเลขนี้
   * เป็นขนส่งเจ้าไหน (ETrackings บังคับให้ระบุขนส่ง) จึงเหลือ Track123 เจ้าเดียว
   * แล้วเจ้านั้นก็ล้มพอดี
   */
  readonly unknownCourier: boolean;

  constructor(source: CarrierError, init: { unknownCourier: boolean }) {
    super(source.code, source.userMessage, {
      cause: source.cause,
      debugMessage: source.message,
      upstreamCode: source.upstreamCode,
    });
    this.name = "ResolveError";
    this.unknownCourier = init.unknownCourier;
  }
}

/**
 * คำขอนี้ล้มเพราะเหลือผู้ให้บริการเจ้าเดียวหรือเปล่า
 *
 * ผู้เรียก (/api/track) ใช้บันทึกลงสถิติ — ดูหมายเหตุความเป็นส่วนตัวใน
 * lib/supabase/search-events.ts: ค่านี้เป็นคุณสมบัติของคำขอ ไม่ใช่ของคน
 */
export function isUnknownCourierFailure(error: unknown): boolean {
  return error instanceof ResolveError && error.unknownCourier;
}

/**
 * ยิงหนึ่งครั้งแล้วบอกว่า "เจอ" หรือ "ไม่พบ"
 *
 * error ที่ไม่ใช่ "ไม่พบ" ถูกโยนต่อขึ้นไปทันที เพราะภายในเจ้าเดียวกัน ถ้าขั้นแรก
 * พังด้วยปัญหาสิทธิ์หรือยิงถี่เกินไป ขั้นที่เหลือของเจ้านั้นก็จะพังเหมือนกัน
 * (ผู้เรียกที่ต้องการ "ข้ามไปเจ้าถัดไป" ใช้ attemptOrSkip แทน)
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
 * ยิงหนึ่งครั้งแล้วบอกว่า "เจอ" หรือ "ไม่ได้คำตอบจากเจ้านี้"
 *
 * ต่างจาก attempt() ตรงที่ **กลืนความล้มเหลวทุกชนิด** แล้วคืน null เพื่อให้
 * ผู้เรียกไปถามเจ้าถัดไปได้ ใช้กับการข้ามระหว่างเจ้า ไม่ใช่ภายในเจ้าเดียวกัน
 *
 * มีอยู่เพราะบทเรียนจากของจริง: ตอน API key ของไปรษณีย์ไทยเพี้ยน ระบบล้มที่
 * ด่านแรกแล้วจบ ไม่มี [track123] หรือ [etrackings] โผล่ใน log เลย ทั้งเว็บ
 * ค้นอะไรไม่ได้เพราะเจ้าเดียวล้ม — การพังของเจ้าหนึ่งไม่ควรเป็นการพังของทั้งระบบ
 *
 * ยังคง log ให้เห็นเสมอว่าเจ้าไหนมีปัญหาอะไร ไม่งั้นการข้ามจะกลายเป็นการซ่อน
 * ปัญหา แล้วเจ้าที่พังจะพังเงียบไปเรื่อยๆ โดยไม่มีใครรู้
 */
async function attemptOrSkip(
  call: () => Promise<TrackingResult>,
  carrierCode: string,
): Promise<TrackingResult | null> {
  try {
    return await call();
  } catch (error) {
    const carrierError = toCarrierError(error);
    if (carrierError.code !== FALLBACK_TRIGGER) {
      console.warn(
        `[resolve] ข้าม ${carrierCode} (${carrierError.code}): ${carrierError.message}`,
      );
    }
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
  /** ขนส่งที่หน้า landing บอกใบ้มา — ลองก่อนรายการมาตรฐาน */
  preferred?: string,
): Promise<{ result: TrackingResult | null; codes: string[] }> {
  const trackWithCourier = adapter.trackWithCourier;
  if (trackWithCourier === undefined) return { result: null, codes: [] };

  // ใบ้จากหน้ามาก่อนเสมอ เพราะเจาะจงกว่ารายการกลางที่เรียงตาม "เจอปัญหาบ่อย"
  // แต่ยังอยู่ใต้เพดานเดียวกัน จึงไม่ทำให้การค้นหนึ่งครั้งกิน quota เพิ่ม
  const ordered = [
    ...(preferred === undefined ? [] : [preferred]),
    ...(adapter.retryCourierCodes ?? []),
  ];

  const candidates = [...new Set(ordered)]
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

/** ผู้ให้บริการที่เสียเงิน สองเจ้าที่สลับกันได้ */
type PaidProvider = Extract<ResolveProvider, "fallback" | "backup">;

export interface ProviderOrderInput {
  /**
   * ETrackings ตั้งค่าไว้แล้ว และเรารู้ว่าเลขนี้เป็นขนส่งเจ้าไหน
   *
   * "รู้" มาได้สองทาง: prefix ฟันธง (เช่น SPXTH) หรือเคยค้นเลขนี้สำเร็จมาก่อน
   * แล้ว cache จำ courier ไว้ ทางหลังคือทางที่ใช้ได้จริงกับเลขไทยส่วนใหญ่
   */
  backupUsable: boolean;
  /** โควตาของ Track123 ใกล้เพดานแล้ว */
  fallbackNearQuota: boolean;
  /** โควตาของ ETrackings ใกล้เพดานแล้ว */
  backupNearQuota: boolean;
  /**
   * โควตาของ ETrackings ส่วนที่ให้ใช้กับการค้นหาทั่วไปหมดแล้ว
   *
   * ต่างจาก backupNearQuota ที่แปลว่า "เอาไว้ทีหลัง" — ข้อนี้แปลว่า **ห้ามใช้**
   * เพราะที่เหลือถูกสงวนไว้ให้การเก็บที่อยู่สาขา หรือหมดเกลี้ยงแล้วจริงๆ
   * (ดู canUseForLookup ใน lib/provider-usage.ts)
   */
  backupOutOfLookupBudget: boolean;
}

/**
 * ตัดสินว่าจะถามเจ้าไหนก่อน — ฟังก์ชันบริสุทธิ์ แยกไว้ให้เทสต์ครอบได้ทุกทาง
 *
 * กติกาสองข้อ:
 *
 *   1. รู้ courier แล้วและ ETrackings รองรับ → **ETrackings ก่อน** เพราะเป็น
 *      เจ้าเดียวที่ให้ที่อยู่สาขามาด้วย ซึ่งมีค่ามากกว่าความสะดวกของ
 *      auto-detect (ดูหัวไฟล์) · ไม่รู้ courier → เหลือ Track123 เจ้าเดียว
 *      เพราะ ETrackings บังคับให้ระบุขนส่ง ยิงไปก็ทิ้งโควตาแน่นอน
 *   2. เจ้าที่ควรได้ไปก่อนใกล้ชนเพดานแล้ว แต่อีกเจ้ายังไม่ใกล้ → สลับ
 *      "ใกล้ชนเพดาน" ไม่ใช่ "ห้ามใช้" — ยังอยู่ในลำดับที่สอง เผื่อเจ้าแรกพัง
 *      เพราะการปฏิเสธคำค้นทั้งที่ยังมีโควตาเหลือแย่กว่าการใช้โควตาที่เหลือ
 *
 * ทั้งสองเจ้าใกล้ชนเพดานพร้อมกัน → ไม่สลับ ใช้ตามความถนัดเหมือนเดิม
 * เพราะการสลับไปหาเจ้าที่ใกล้ชนเพดานเหมือนกันไม่ได้ช่วยอะไรเลย
 */
export function chooseProviderOrder(
  input: ProviderOrderInput,
): readonly PaidProvider[] {
  if (!input.backupUsable) return ["fallback"];

  // โควตาส่วนของการค้นหาหมดแล้ว → ตัดออกจากลำดับไปเลย ไม่ใช่แค่ไว้ทีหลัง
  //
  // การคงไว้เป็นตัวสำรองไม่ได้ช่วยอะไร เพราะยิงไปก็ได้ error กลับมาอย่างเดียว
  // แต่ทำให้ผู้ใช้ต้องรออีกหนึ่งรอบก่อนจะได้คำตอบจากเจ้าที่ยังใช้ได้จริง
  if (input.backupOutOfLookupBudget) return ["fallback"];

  if (input.backupNearQuota && !input.fallbackNearQuota) {
    return ["fallback", "backup"];
  }
  return ["backup", "fallback"];
}

/**
 * เก็บที่อยู่สาขาจากผลลัพธ์ที่เพิ่งได้มา — ล้มเหลวได้โดยไม่กระทบอะไร
 *
 * ทำเฉพาะผลจาก ETrackings เพราะเป็นเจ้าเดียวที่ห้อยที่อยู่มาให้ ผลจากเจ้าอื่น
 * ไม่มี event.address เลยจึงไม่มีอะไรให้เก็บอยู่แล้ว (เรียกไปก็คืน 0 ทันที)
 */
async function harvest(result: TrackingResult): Promise<void> {
  try {
    await harvestBranchCoordinates(result);
  } catch (cause) {
    console.warn(
      `[resolve] เก็บที่อยู่สาขาไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
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
  courierHint: string | undefined,
  courierStore: TrackingCourierStore,
  pageCourierHint: string | undefined,
): Promise<FreshResult> {
  // เจ้าที่ยิงไปแล้ว ไว้กันไม่ให้ขั้นถัดไปถามซ้ำคำถามเดิม และไว้อธิบายใน log
  const tried: string[] = [];
  const shortcut = prefixShortcut(normalized, fallback);

  if (shortcut === null) {
    // prefix ไม่ฟันธงว่าเป็นเจ้าไหน → ลำดับเดิม ถามไปรษณีย์ไทยก่อนเพราะฟรี
    // และไม่จำกัดจำนวนครั้ง จะได้ไม่ไปแตะ quota ของเจ้าที่เสียเงินโดยไม่จำเป็น
    //
    // ⚠️ ความล้มเหลวตรงนี้ต้อง **ไม่** จบทั้งคำขอ — เคยเป็นแบบนั้นแล้วเจอของจริง:
    // วันที่ API key ของไปรษณีย์ไทยเพี้ยน ทั้งเว็บค้นอะไรไม่ได้เลย ทั้งที่
    // Track123 ยังทำงานปกติดี ผู้ใช้ทุกคนเจอ auth_failed ของเจ้าที่อาจไม่ใช่
    // ขนส่งของพัสดุเขาด้วยซ้ำ
    const fromPrimary = await attemptOrSkip(
      () => primary.track(normalized),
      primary.carrierCode,
    );
    if (fromPrimary !== null) {
      return finish(normalized, fromPrimary, "primary", cache, courierStore);
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

  /* ---- สองเจ้าที่เสียเงิน ---- */

  // อ่านยอดโควตาของจริงมาก่อนตัดสินใจ — หลัง restart ตัวนับใน memory เป็นศูนย์
  // ถ้าไม่อ่าน เราจะเชื่อว่ายังไม่ได้ใช้อะไรเลยทั้งที่โควตาอาจใกล้หมดแล้ว
  await loadProviderUsage();

  // ขนส่งที่จะบอก ETrackings — จาก prefix ถ้าฟันธงได้ ไม่งั้นจากที่เคยค้นสำเร็จ
  const backupCourier = shortcut?.courierCode ?? courierHint;

  const backupUsable =
    backup !== null &&
    backupCourier !== undefined &&
    (backup.canTrack === undefined || backup.canTrack(normalized, backupCourier));

  const order = chooseProviderOrder({
    backupUsable,
    // วัดจาก "งบที่การค้นหาใช้ได้" ไม่ใช่เพดานเต็ม — ไม่งั้นธงของ ETrackings
    // จะติดที่ 40 ทั้งที่การค้นหาถูกตัดขาดไปตั้งแต่ 20 (ดู isNearLookupQuota)
    fallbackNearQuota: isNearLookupQuota("track123"),
    backupNearQuota: isNearLookupQuota("etrackings"),
    // นโยบายที่ตัดสินใจแล้ว: โควตา ETrackings ที่เหลือมีค่ากับการเก็บที่อยู่สาขา
    // มากกว่าการค้นหาทั่วไป เพราะพิกัดสาขาที่ได้มาอยู่ถาวรและใช้ซ้ำได้กับพัสดุ
    // ทุกใบที่ผ่านสาขานั้น ส่วนการค้นหาทั่วไป Track123 ก็ทำได้อยู่แล้ว
    backupOutOfLookupBudget: !canUseForLookup("etrackings"),
  });

  console.info(
    `[resolve] no=${normalized} order=${order.join(",")}` +
      ` courier=${backupCourier ?? "-"}` +
      `(${shortcut !== null ? "prefix" : courierHint === undefined ? "none" : "cache"})` +
      ` track123=${usageLabel("track123")} etrackings=${usageLabel("etrackings")}`,
  );

  const errors = new Map<PaidProvider, CarrierError>();
  let fallbackSaidNotFound = false;

  for (const slot of order) {
    try {
      const found =
        slot === "backup"
          ? await runBackup(normalized, backup, backupCourier)
          : await runFallback(
              normalized,
              fallback,
              shortcut,
              tried,
              pageCourierHint,
            );

      if (found !== null) {
        // เก็บที่อยู่สาขาก่อนคืนผล — ทำหลังจากนี้ไม่ได้เพราะ Next อาจตัด
        // งานที่ยังค้างอยู่ทิ้งเมื่อ response ถูกส่งออกไปแล้ว
        if (slot === "backup") await harvest(found);
        return finish(normalized, found, slot, cache, courierStore);
      }

      // ตอบว่าไม่พบ — คำว่าไม่พบของ Track123 หนักแน่นพอจะหยุด (ดูหัวไฟล์)
      if (slot === "fallback") {
        fallbackSaidNotFound = true;
        break;
      }
    } catch (error) {
      const carrierError = toCarrierError(error);
      errors.set(slot, carrierError);
      console.warn(
        `[resolve] ${slot} ช่วยไม่ได้ (${carrierError.code}): ${carrierError.message}`,
      );
    }
  }

  // Track123 บอกว่าไม่พบ = คำตอบที่แท้จริง ต่อให้อีกเจ้าจะพังไปก่อนหน้าก็ตาม
  // ส่วน error ของ Track123 มาก่อน error ของ ETrackings เพราะชั้นบนใช้ code
  // ตัดสินเรื่องการคืนข้อมูลเก่าจาก cache และ Track123 คือเจ้าที่ครอบคลุมกว่า
  if (!fallbackSaidNotFound) {
    const error = errors.get("fallback") ?? errors.get("backup");
    if (error !== undefined) {
      // ติดป้ายไว้ว่าคำขอนี้ล้มตอนที่ไม่มีเจ้าที่สองให้ไปต่อ — เกิดเมื่อ
      // ตั้งค่า ETrackings ไว้แล้ว แต่เดาไม่ออกว่าเลขนี้เป็นขนส่งเจ้าไหน
      // (เลข TH… ใช้ร่วมกันระหว่าง SPX กับ Flash และเลขนี้ยังไม่เคยค้นสำเร็จ)
      // หน้าสถิติแอดมินนับตัวเลขนี้ไว้ตัดสินใจว่าคุ้มจะทำกลไกเดา courier ไหม
      throw new ResolveError(error, {
        unknownCourier: backup !== null && backupCourier === undefined,
      });
    }
  }

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
        ` — ลำดับที่ใช้: ${order.join(", ")}` +
        (tried.length === 0
          ? ""
          : ` — ระบุขนส่งเจาะจงแล้ว ${tried.length} เจ้า: ${tried.join(", ")}`),
    },
  );
}

/**
 * เก็บผลที่ค้นเจอลงทุกที่ที่ต้องเก็บ แล้วคืนคำตอบ
 *
 * รวมสองการเก็บที่มีอายุต่างกันไว้ในที่เดียว เพื่อให้ทุกทางที่ค้นเจอผ่านจุดนี้
 * เหมือนกันหมด ไม่มีทางไหนลืมเก็บอะไร:
 *
 *   cache          สถานะพัสดุ มี TTL เก่าแล้วไร้ค่า
 *   courierStore   เลขนี้เป็นของขนส่งเจ้าไหน จริงตลอดกาล
 *
 * การจำขนส่งล้มเหลวได้โดยไม่กระทบอะไร (store กลืน error ไว้แล้ว) — ผลที่ตามมา
 * คือครั้งหน้าต้องไปตรวจจับใหม่ ซึ่งก็คือพฤติกรรมก่อนมีตารางนี้
 */
async function finish(
  normalized: string,
  result: TrackingResult,
  provider: ResolveProvider,
  cache: PersistentTrackingCache | undefined,
  courierStore: TrackingCourierStore,
): Promise<FreshResult> {
  await courierStore.remember(normalized, result.carrierCode, provider);
  return { result: await store(normalized, result, cache), provider };
}

/**
 * ยิง ETrackings หนึ่งครั้ง — ครั้งเดียวเสมอ ไม่มีการไล่เดา
 *
 * เจ้านี้บังคับให้ระบุขนส่ง เราจึงใช้รหัสที่ "รู้แล้ว" เท่านั้น (จาก prefix
 * หรือจากผลที่เคยค้นสำเร็จ) ผู้เรียกรับประกันว่ามาถึงตรงนี้ได้ก็ต่อเมื่อ
 * backupUsable เป็นจริง ซึ่งแปลว่า courier ไม่ใช่ undefined อยู่แล้ว
 */
async function runBackup(
  normalized: string,
  backup: CarrierAdapter | null,
  courier: string | undefined,
): Promise<TrackingResult | null> {
  if (backup === null) return null;

  const trackWithCourier = backup.trackWithCourier;
  if (courier !== undefined && trackWithCourier !== undefined) {
    return attempt(() => trackWithCourier.call(backup, normalized, courier));
  }
  return attempt(() => backup.track(normalized));
}

/**
 * ไล่ถาม Track123 ให้ครบทุกทาง — ยิงตรงตาม prefix, ตรวจจับเอง, แล้วระบุเจาะจง
 *
 * ทั้งสามขั้นนับเป็น "หนึ่งเจ้า" เพราะเป็นการถามปลายทางเดียวกัน และเพราะ
 * ความหนักแน่นของคำว่า "ไม่พบ" มาจากการที่ทั้งสามขั้นตอบเหมือนกันหมด
 */
async function runFallback(
  normalized: string,
  fallback: CarrierAdapter,
  shortcut: PrefixShortcut | null,
  tried: string[],
  pageCourierHint?: string,
): Promise<TrackingResult | null> {
  if (shortcut !== null) {
    const byPrefix = await attempt(shortcut.track);
    if (byPrefix !== null) return byPrefix;
  }

  // ยังไม่เจอ → ให้ Track123 ตรวจจับขนส่งเอง
  // ยังต้องลองขั้นนี้แม้ prefix จะพลาด เพราะพัสดุข้ามประเทศอาจเปลี่ยนมือไปให้
  // ขนส่งเจ้าอื่นเดินช่วงสุดท้าย ซึ่ง prefix ต้นทางบอกไม่ได้
  const autoDetected = await attempt(() => fallback.track(normalized));
  if (autoDetected !== null) return autoDetected;

  // การตรวจจับขนส่งอัตโนมัติเดาผิดได้ เช่นเลขของ Shopee Xpress ที่ถูกเดาเป็น
  // Flash Express แล้วตอบว่าไม่พบทั้งที่พัสดุมีอยู่จริง จึงลองยิงซ้ำโดยระบุ
  // ขนส่งเจาะจงจากรายชื่อที่รู้ว่ามีปัญหา
  const retried = await retryWithCourierCodes(
    normalized,
    fallback,
    tried,
    pageCourierHint,
  );
  tried.push(...retried.codes);
  return retried.result;
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
  // ขนส่งที่ยืนยันแล้วจากครั้งก่อน — สำคัญมากในทางปฏิบัติ เพราะเลขไทยส่วนใหญ่
  // ดู prefix แล้วบอกไม่ได้ (`TH…` ใช้ร่วมกันระหว่าง SPX กับ Flash) ถ้าไม่มีค่านี้
  // ETrackings แทบไม่ถูกเรียกเลย
  //
  // อ่านจากตารางถาวรก่อน แล้วค่อยตกมาที่ cache — ตารางถาวรไม่มีวันหมดอายุ ส่วน
  // cache หายได้เมื่อแถวถูกกวาด ซึ่งเคยทำให้ความจำเรื่องขนส่งหายไปทั้งระบบ
  // (ดู supabase/migrations/0010_tracking_couriers.sql)
  const courierStore = options.courierStore ?? supabaseTrackingCourierStore;
  const courierHint =
    (await courierStore.read(normalized)) ?? cached?.entry.result.carrierCode;

  const run = inflightResolves.start(normalized, () =>
    resolveFresh(
      normalized,
      primary,
      fallback,
      backup,
      options.persistentCache,
      courierHint,
      courierStore,
      options.pageCourierHint,
    ),
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
