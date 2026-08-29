/**
 * Cache ผลการติดตามพัสดุแบบ in-memory พร้อม TTL ที่ต่างกันตามสถานะ
 *
 * ⚠️ ข้อจำกัดที่ตั้งใจยอมรับในตอนนี้ — ต้องเปลี่ยนก่อนขึ้น production จริง:
 *   1. เก็บใน memory ของ process เดียว จึง **หายทุกครั้งที่ dev server restart
 *      หรือ deploy ใหม่** ถือเป็นเรื่องปกติสำหรับตอนนี้ ไม่ต้องแก้
 *   2. ถ้า deploy แบบหลาย instance (เช่น serverless ของ Vercel) แต่ละ instance
 *      จะมี cache ของตัวเองแยกกัน hit rate จึงต่ำกว่าที่ควร
 *   3. ไม่มีการล้างของเก่าอัตโนมัติตามเวลา — ล้างตอนอ่านเจอของหมดอายุ
 *      กับตอนที่จำนวนรายการเกินเพดานเท่านั้น
 *
 * ตอนขึ้น production ให้ย้ายที่เก็บไปเป็น Supabase (ตารางถาวร ใช้ร่วมกันทุก instance)
 * หรือ Redis/Upstash (เร็วกว่า มี TTL ในตัว) โดยคงหน้าตาฟังก์ชัน getCached/setCached
 * ไว้เหมือนเดิม เพื่อให้ resolveTracking ไม่ต้องแก้ตาม
 */

import type { TrackingResult, TrackingStatus } from "./carriers/types";

/**
 * TTL ตามสถานะ — พัสดุที่จบแล้วไม่มีทางเปลี่ยนอีก เก็บได้นาน
 * ส่วนพัสดุที่กำลังนำจ่ายเปลี่ยนสถานะได้ทุกนาที จึงเก็บสั้นที่สุด
 */
export const TTL_MS: Record<TrackingStatus, number> = {
  delivered: 24 * 60 * 60_000, // 24 ชั่วโมง — จบแล้ว
  exception: 24 * 60 * 60_000, // 24 ชั่วโมง — จบแล้ว (ตีกลับ/นำจ่ายไม่สำเร็จ)
  out_for_delivery: 15 * 60_000, // 15 นาที — เปลี่ยนได้ตลอดเวลา
  pending: 2 * 60 * 60_000, // 2 ชั่วโมง
  in_transit: 2 * 60 * 60_000, // 2 ชั่วโมง
};

/** เพดานจำนวนรายการ กัน memory โตไม่จำกัดระหว่างที่ยังไม่ได้ย้ายไป Redis/Supabase */
const MAX_ENTRIES = 5_000;

export interface CacheEntry {
  result: TrackingResult;
  /** เวลาที่บันทึกลง cache (epoch ms) */
  cachedAt: number;
}

/** key = เลขพัสดุที่ normalize แล้ว */
const store = new Map<string, CacheEntry>();

/** อายุ cache ของผลลัพธ์นี้ ตามสถานะของพัสดุ */
export function ttlFor(result: TrackingResult): number {
  return TTL_MS[result.status] ?? TTL_MS.in_transit;
}

/** หมดอายุหรือยัง */
function isExpired(entry: CacheEntry, now: number): boolean {
  return now - entry.cachedAt >= ttlFor(entry.result);
}

/**
 * อ่านผลจาก cache — คืน undefined ถ้าไม่มีหรือหมดอายุแล้ว
 * (ของหมดอายุจะถูกลบทิ้งตอนอ่านเจอ)
 */
export function getCached(
  trackingNumber: string,
  now: number = Date.now(),
): CacheEntry | undefined {
  const entry = store.get(trackingNumber);
  if (!entry) return undefined;

  if (isExpired(entry, now)) {
    store.delete(trackingNumber);
    return undefined;
  }

  return entry;
}

/** บันทึกผลลงใน cache */
export function setCached(
  trackingNumber: string,
  result: TrackingResult,
  now: number = Date.now(),
): void {
  // ถึงเพดานแล้ว → ทิ้งรายการที่เก่าที่สุดก่อน (Map เรียงตามลำดับที่ใส่เข้ามา)
  if (store.size >= MAX_ENTRIES && !store.has(trackingNumber)) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }

  store.set(trackingNumber, { result, cachedAt: now });
}

/** ล้าง cache ทั้งหมด — ใช้ในเทสและตอนอยาก force รีเฟรชทั้งระบบ */
export function clearCache(): void {
  store.clear();
}

/** จำนวนรายการที่เก็บอยู่ตอนนี้ (รวมของที่หมดอายุแต่ยังไม่ถูกอ่านเจอ) */
export function cacheSize(): number {
  return store.size;
}
