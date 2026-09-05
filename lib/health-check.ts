/**
 * ตัดสินว่าระบบ "ทำงานแต่ตอบไม่ได้" อยู่หรือเปล่า — ตรรกะล้วน แยกไว้ให้เทสต์ครอบ
 *
 * ------------------------------------------------------------------
 * ปัญหาที่แก้: uptime monitor ที่มีอยู่จับได้แค่ "เว็บล่ม" (ไม่ตอบ / 5xx)
 * แต่สถานการณ์ที่ควรปลุกเราที่สุดกลับเป็นสถานการณ์ที่เว็บตอบ 200 ทุกหน้า —
 * วันที่ API key ของขนส่งเพี้ยน หน้าเว็บเปิดได้ปกติ แต่ค้นอะไรก็ไม่เจอ
 *
 * แทนที่จะเพิ่มบริการแจ้งเตือนใหม่ ให้ endpoint ตอบ 503 แล้วปล่อยให้ monitor
 * เดิมทำหน้าที่เดิมของมัน — ไม่มีของใหม่ให้ดูแล ไม่มี secret ใหม่ให้เก็บ
 * ------------------------------------------------------------------
 */

import {
  PROVIDER_IDS,
  isNearLookupQuota,
  isNearQuota,
  readLeanRatio,
  readPeriod,
  type ProviderId,
} from "./provider-usage";

/** ชื่อตัวแปร env ของหน้าต่างเวลาที่ใช้ตัดสิน (นาที) */
export const WINDOW_VAR = "HEALTH_WINDOW_MINUTES";
/** ชื่อตัวแปร env ของจำนวนคำค้นขั้นต่ำก่อนจะยอมเตือน */
export const MIN_SEARCHES_VAR = "HEALTH_MIN_SEARCHES";
/** ชื่อตัวแปร env ของสัดส่วนความล้มเหลวที่ถือว่าผิดปกติ */
export const ERROR_RATIO_VAR = "HEALTH_MAX_ERROR_RATIO";
/** ชื่อตัวแปร env ของสัดส่วน "ค้นไม่เจอ" ที่ถือว่าผิดปกติ */
export const NOT_FOUND_RATIO_VAR = "HEALTH_MAX_NOT_FOUND_RATIO";


export const DEFAULT_WINDOW_MINUTES = 30;

/**
 * ต้องมีคำค้นอย่างน้อยเท่านี้ในหน้าต่างนั้น ถึงจะยอมบอกว่าผิดปกติ
 *
 * ⚠️ ตัวคูณสำคัญที่สุดของทั้งไฟล์ ตอนตีสามที่มีคนค้นสองครั้งแล้วพิมพ์ผิดทั้งคู่
 * อัตราค้นไม่เจอคือ 100% ซึ่งไม่ได้แปลว่าอะไรเลย ถ้าไม่มีด่านนี้ ระบบจะปลุก
 * เจ้าของเว็บกลางดึกด้วยเรื่องที่ไม่มีอะไรเสีย แล้วครั้งที่สามเขาจะปิดการแจ้ง
 * เตือนทิ้ง — ซึ่งแย่กว่าไม่มีการแจ้งเตือนตั้งแต่แรก
 */
export const DEFAULT_MIN_SEARCHES = 20;

/** เกินสัดส่วนนี้ = ระบบขัดข้องจริง ไม่ใช่ความซวยรายครั้ง */
export const DEFAULT_MAX_ERROR_RATIO = 0.2;

/**
 * เกินสัดส่วนนี้ = น่าจะมีขนส่งเจ้าไหนที่เราตามไม่ได้
 *
 * ตั้งสูงกว่าเกณฑ์ error มากโดยตั้งใจ เพราะ "ค้นไม่เจอ" เป็นคำตอบที่ถูกต้อง
 * ได้ในหลายกรณี (พิมพ์ผิด, พัสดุเพิ่งส่งยังไม่เข้าระบบ) ต่างจาก error ที่แปลว่า
 * ระบบเรามีปัญหาเสมอ
 */
export const DEFAULT_MAX_NOT_FOUND_RATIO = 0.6;

/** ยอดรวมของคำค้นในหน้าต่างที่ดู */
export interface HealthSnapshot {
  total: number;
  found: number;
  notFound: number;
  error: number;
}

/** สาเหตุที่ตอบว่าไม่ปกติ — ไว้ให้คนอ่านรู้ว่าควรไปดูอะไรต่อ */
export type HealthReason =
  /** ระบบขัดข้องเกินสัดส่วนที่ยอมรับได้ */
  | "error_rate"
  /** ค้นไม่เจอเกินสัดส่วนที่ยอมรับได้ */
  | "not_found_rate"
  /** โควตาของผู้ให้บริการเจ้าใดเจ้าหนึ่งใกล้เต็ม */
  | "quota_warning";

export interface HealthVerdict {
  ok: boolean;
  /** null เมื่อปกติ */
  reason: HealthReason | null;
}

function readRatio(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, 1);
}

function readCount(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/** หน้าต่างเวลาที่ใช้ตัดสิน (นาที) */
export function readWindowMinutes(): number {
  return readCount(process.env.HEALTH_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
}

export function readMinSearches(): number {
  return readCount(process.env.HEALTH_MIN_SEARCHES, DEFAULT_MIN_SEARCHES);
}

export function readMaxErrorRatio(): number {
  return readRatio(process.env.HEALTH_MAX_ERROR_RATIO, DEFAULT_MAX_ERROR_RATIO);
}

export function readMaxNotFoundRatio(): number {
  return readRatio(
    process.env.HEALTH_MAX_NOT_FOUND_RATIO,
    DEFAULT_MAX_NOT_FOUND_RATIO,
  );
}

/**
 * แยกโควตาเป็นสองชนิดตาม "ธรรมชาติของรอบบิล" ไม่ใช่ตามชื่อเจ้า
 *
 * ══════════════════════════════════════════════════════════════════
 * หลักที่ใช้แยก: **การแจ้งเตือนมีไว้สำหรับสิ่งที่เปลี่ยนแปลงและแก้ได้
 * ไม่ใช่สภาพถาวรที่รอการตัดสินใจ**
 *
 *   รีเซ็ตได้ (daily / monthly)  พอข้ามรอบก็เขียวเอง การเตือนจึงเป็นสัญญาณ
 *                                ชั่วคราวที่หายไปเมื่อปัญหาหมดไป — ตรงกับที่
 *                                monitor ถูกออกแบบมาให้จับ
 *
 *   ไม่รีเซ็ต (lifetime)         พอข้ามเกณฑ์แล้วแดงค้างตลอดกาล เพราะไม่มีอะไร
 *                                ทำให้ตัวเลขลดลงได้อีก · การเตือนซ้ำทุก 5 นาที
 *                                ไม่ได้เพิ่มข้อมูลอะไรเลยหลังครั้งแรก มีแต่จะ
 *                                กลบสัญญาณอื่นจนคนปิดการแจ้งเตือนทิ้ง
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ ของเดิมคือ env ชื่อ HEALTH_IGNORE_QUOTA ที่ให้ใส่ชื่อเจ้าไปปิดปากทีละตัว
 * ถูกถอดทิ้งแล้วโดยตั้งใจ · มันไม่ใช่ทางแก้ แต่เป็นการสะสมจุดบอด: ทุกครั้งที่
 * เสียงดังเกินไป เราก็ใส่ชื่อเพิ่มอีกหนึ่ง จนสุดท้ายไม่เหลืออะไรให้ได้ยิน
 * และของจริงที่เกิดขึ้น — วันที่ถอดออก ชื่อที่อยู่ในนั้นไม่ได้ปิดปากอะไรเลย
 * แต่ยังเป็นจุดบอดที่รออยู่เฉยๆ
 *
 * ⚠️ ห้ามฮาร์ดโค้ดชื่อเจ้าลงในไฟล์นี้เด็ดขาด — การแยกอิงจาก readPeriod().cycle
 * ซึ่งเป็นข้อมูลที่ระบบมีอยู่แล้ว เจ้าใหม่ที่เป็น lifetime จึงเข้ากฎนี้เอง
 * อัตโนมัติโดยไม่ต้องมีใครมาจำว่าต้องไปเพิ่มชื่อที่ไหน (มีเทสต์เฝ้าข้อนี้)
 */
function isRecoverable(provider: ProviderId): boolean {
  return readPeriod(provider).cycle !== "lifetime";
}

/**
 * เจ้านี้มีเรื่องโควตาที่ควรรู้หรือยัง — เข้าเกณฑ์ข้อใดข้อหนึ่งก็นับ
 *
 *   isNearQuota        ใช้ไปเกิน 80% ของ **เพดานเต็ม**
 *   isNearLookupQuota  ใช้ไปเกิน 80% ของ **งบที่การค้นหาใช้ได้**
 *                      (เพดานเต็ม ลบส่วนที่กันไว้ให้เก็บที่อยู่สาขา)
 *
 * ⚠️ ต้องมีข้อสองด้วย ไม่งั้นจะมองไม่เห็นของจริงที่เกิดขึ้นแล้ว: ETrackings
 * เพดาน 50 กันไว้ให้เก็บที่อยู่สาขา 30 เหลืองบค้นหา 20 · พอใช้ครบ 20 ระบบ
 * ตัดมันออกจากลำดับการค้นหาไปแล้วจริงๆ แต่ 20/50 = 40% ซึ่งไม่ถึง 80%
 * ด่านเดิมจึงบอกว่า "ปกติดี" ทั้งที่ความสามารถหายไปแล้วหนึ่งอย่าง
 *
 * ไม่ได้เจาะจงเจ้าไหน — readHarvestReserve คืน 0 ให้เจ้าที่ไม่ได้กันโควตาไว้
 * สองเกณฑ์จึงเท่ากันเป๊ะสำหรับเจ้าเหล่านั้น ข้อสองไม่มีผลอะไรกับพวกเขาเลย
 */
function isQuotaConcerning(provider: ProviderId, now: number): boolean {
  return isNearQuota(provider, now) || isNearLookupQuota(provider, now);
}

/** เจ้าที่ใช้โควตาเกินเกณฑ์แล้ว ทุกชนิดรวมกัน — รายการว่างเมื่อทุกเจ้ายังปกติ */
export function providersNearQuota(now: number = Date.now()): ProviderId[] {
  return PROVIDER_IDS.filter((provider) => isQuotaConcerning(provider, now));
}

/**
 * เจ้าที่ใกล้ชนเพดาน **และรอบบิลรีเซ็ตได้** — กลุ่มที่ควรปลุกคน
 *
 * หมดแล้วฟื้นเองได้เมื่อข้ามรอบ การเตือนจึงมีปลายทาง: รอ หรือซื้อเพิ่ม
 */
export function recoverableQuotaAlerts(now: number = Date.now()): ProviderId[] {
  return providersNearQuota(now).filter(isRecoverable);
}

/**
 * เจ้าที่ใกล้ชนเพดาน **และไม่มีวันรีเซ็ต** — กลุ่มที่ต้องรู้แต่ห้ามปลุก
 *
 * ไปแสดงบนหน้าสถิติแทน เพราะเป็นสภาพถาวรที่รอการตัดสินใจ (จะซื้อเพิ่มไหม)
 * ไม่ใช่เหตุการณ์ที่จะหายไปเอง
 */
export function standingQuotaWarnings(now: number = Date.now()): ProviderId[] {
  return providersNearQuota(now).filter((provider) => !isRecoverable(provider));
}

/**
 * ตัดสินสถานะจากยอดที่นับได้ + สถานะโควตา
 *
 * เรียงลำดับความสำคัญโดยตั้งใจ: โควตาใกล้เต็มมาก่อน เพราะเป็นเรื่องที่ต้อง
 * ลงมือทำอะไรสักอย่าง (ซื้อเพิ่ม / ปรับเพดาน) ส่วนอัตราค้นไม่เจอสูงอาจเป็น
 * เรื่องชั่วคราวของฝั่งขนส่งที่หายเองได้
 */
/**
 * ระบบอยู่ในสภาพที่ "ผู้ใช้ใช้ไม่ได้จริง" หรือเปล่า
 *
 * ⚠️ โควตาไม่อยู่ในนี้แล้ว และห้ามเอากลับเข้ามา · "โควตาใกล้หมด" กับ
 * "เว็บใช้ไม่ได้" ไม่ใช่เรื่องเดียวกัน — ตอนโควตาเจ้าหนึ่งใกล้หมด ระบบสลับไป
 * ใช้เจ้าอื่นให้เองอัตโนมัติ ผู้ใช้ไม่รู้สึกอะไรเลยสักนิด การเอามาออกทางสัญญาณ
 * เดียวกับ "เว็บล่ม" เคยทำให้ monitor รายงาน DOWN ติดกัน 61 ชั่วโมงทั้งที่
 * เว็บใช้งานได้ปกติ แล้วจบลงที่การปิดปากมันทิ้ง
 *
 * โควตาไปออกทาง warnings ของ endpoint นี้ (200 พร้อมธง) และทาง
 * /api/health/quota สำหรับเจ้าที่รอบบิลรีเซ็ตได้
 */
export function judgeHealth(snapshot: HealthSnapshot): HealthVerdict {
  // น้อยเกินกว่าจะสรุปอะไรได้ — ดูเหตุผลที่ DEFAULT_MIN_SEARCHES
  if (snapshot.total < readMinSearches()) return { ok: true, reason: null };

  if (snapshot.error / snapshot.total >= readMaxErrorRatio()) {
    return { ok: false, reason: "error_rate" };
  }

  if (snapshot.notFound / snapshot.total >= readMaxNotFoundRatio()) {
    return { ok: false, reason: "not_found_rate" };
  }

  return { ok: true, reason: null };
}

/**
 * โควตาที่ควรปลุกคนตอนนี้มีไหม — ใช้กับ /api/health/quota เท่านั้น
 *
 * นับเฉพาะเจ้าที่รอบบิลรีเซ็ตได้ · เจ้าแบบ lifetime ไม่เข้าที่นี่เด็ดขาด
 * ไม่งั้นจะกลายเป็น 503 ถาวรที่ไม่มีวันหาย ซึ่งคือปัญหาเดิมย้ายที่อยู่
 */
export function judgeQuota(now: number = Date.now()): HealthVerdict {
  const alerts = recoverableQuotaAlerts(now);
  return alerts.length === 0
    ? { ok: true, reason: null }
    : { ok: false, reason: "quota_warning" };
}

/** ข้อความสำหรับ log ฝั่งเซิร์ฟเวอร์ — ตรงนี้ใส่ตัวเลขได้ เพราะไม่ได้ส่งออกไปไหน */
export function healthLogLine(
  verdict: HealthVerdict,
  snapshot: HealthSnapshot,
  nearQuota: readonly ProviderId[],
): string {
  const quota = nearQuota.length === 0 ? "-" : nearQuota.join(",");
  return (
    `[health] status=${verdict.ok ? "ok" : "degraded"}` +
    ` reason=${verdict.reason ?? "-"}` +
    ` total=${snapshot.total} found=${snapshot.found}` +
    ` not_found=${snapshot.notFound} error=${snapshot.error}` +
    ` near_quota=${quota} lean=${readLeanRatio()}`
  );
}

/**
 * ข้อความ log ของ /api/health/quota
 *
 * ต้อง log ทั้งฝั่งที่ปลุกและฝั่งที่ไม่ปลุก — ถ้า log เฉพาะตอนปลุก เจ้าแบบ
 * lifetime ที่หมดโควตาไปแล้วจะเงียบสนิททั้งใน monitor และใน log ซึ่งคือการ
 * ย้ายจุดบอดไปที่ใหม่ ไม่ใช่การแก้
 */
export function quotaLogLine(
  recoverable: readonly ProviderId[],
  standing: readonly ProviderId[],
): string {
  return (
    `[health-quota] alert=${recoverable.length === 0 ? "-" : recoverable.join(",")}` +
    ` standing=${standing.length === 0 ? "-" : standing.join(",")}` +
    ` lean=${readLeanRatio()}`
  );
}
