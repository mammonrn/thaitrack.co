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
  isNearQuota,
  readLeanRatio,
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

/** ชื่อตัวแปร env ของเจ้าที่ไม่ต้องเตือนเรื่องโควตา (คั่นด้วยจุลภาค) */
export const IGNORE_QUOTA_VAR = "HEALTH_IGNORE_QUOTA";

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
 * เจ้าที่สั่งไว้ว่าไม่ต้องเตือนเรื่องโควตาแล้ว
 *
 * ------------------------------------------------------------------
 * มีไว้แก้ปัญหาเฉพาะของโควตาแบบ "ไม่รีเซ็ต" (ETrackings แผนฟรี)
 *
 * โควตาที่รีเซ็ตได้ พอข้ามรอบก็เขียวเอง การเตือนจึงเป็นสัญญาณชั่วคราวที่หายไป
 * เองเมื่อปัญหาหมดไป — ตรงกับที่ monitor ถูกออกแบบมาให้จับ
 *
 * แต่โควตาที่ไม่รีเซ็ต พอข้าม 80% แล้วมันจะแดงค้างตลอดกาล เพราะไม่มีอะไรทำให้
 * ตัวเลขลดลงได้อีก ผลคือ endpoint นี้จะแดงถาวรจนใช้จับเรื่องอื่นไม่ได้เลย
 * แล้วสุดท้ายก็จะมีคนปิดการแจ้งเตือนทิ้ง ซึ่งแย่กว่าไม่มีตั้งแต่แรก
 *
 * วิธีที่เลือก: ยังเตือนตามปกติ (เจ้าของเว็บต้องได้รู้) แต่พอรับทราบแล้วและ
 * ตัดสินใจว่าจะไม่ซื้อเพิ่ม ให้ปิดเสียงของเจ้านั้นด้วย env ตัวนี้ — หน้าสถิติ
 * ยังขึ้นสีแดงอยู่เหมือนเดิม เสียงที่ปิดคือเสียงที่ปลุกกลางดึกเท่านั้น
 * ------------------------------------------------------------------
 */
function ignoredProviders(): ReadonlySet<string> {
  const raw = process.env.HEALTH_IGNORE_QUOTA ?? "";
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== ""),
  );
}

/** เจ้าที่ใช้โควตาเกินเกณฑ์แล้ว — รายการว่างเมื่อทุกเจ้ายังปกติ */
export function providersNearQuota(now: number = Date.now()): ProviderId[] {
  const ignored = ignoredProviders();

  return PROVIDER_IDS.filter(
    (provider) => !ignored.has(provider) && isNearQuota(provider, now),
  );
}

/**
 * ตัดสินสถานะจากยอดที่นับได้ + สถานะโควตา
 *
 * เรียงลำดับความสำคัญโดยตั้งใจ: โควตาใกล้เต็มมาก่อน เพราะเป็นเรื่องที่ต้อง
 * ลงมือทำอะไรสักอย่าง (ซื้อเพิ่ม / ปรับเพดาน) ส่วนอัตราค้นไม่เจอสูงอาจเป็น
 * เรื่องชั่วคราวของฝั่งขนส่งที่หายเองได้
 */
export function judgeHealth(
  snapshot: HealthSnapshot,
  nearQuota: readonly ProviderId[],
): HealthVerdict {
  if (nearQuota.length > 0) return { ok: false, reason: "quota_warning" };

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
