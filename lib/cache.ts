/**
 * ชั้นที่หนึ่งของ cache — เก็บใน memory ของ process นี้ เร็วที่สุด
 *
 * ชั้นที่สองคือตาราง public.tracking_cache ใน Supabase (ดู lib/tracking-cache.ts
 * ที่ประกอบสองชั้นเข้าด้วยกัน) ชั้นนี้ยังจำเป็นอยู่แม้จะมีชั้นถาวรแล้ว เพราะ
 * การอ่านจาก memory ใช้เวลาไม่ถึงมิลลิวินาที ส่วนการถาม Supabase ใช้หลักสิบ
 * มิลลิวินาที และเป็นการเรียกข้ามเครือข่ายที่ล้มเหลวได้
 *
 * ⚠️ ข้อจำกัดที่ยังเหมือนเดิม: หายทุกครั้งที่ deploy หรือ restart และแต่ละ
 * instance มีของตัวเองแยกกัน — สองข้อนี้คือเหตุผลที่ต้องมีชั้นถาวรมาเสริม
 * ไม่ใช่มาแทน
 *
 * ⚠️ ของที่หมดอายุแล้ว "ไม่ถูกลบทิ้งตอนอ่านเจอ" อีกต่อไป เพราะเป็นของสำรอง
 * ที่เอาไว้แสดงในวันที่ระบบขนส่งล่ม (ดู getEntry) การควบคุมขนาดจึงพึ่ง
 * MAX_ENTRIES อย่างเดียว
 */

import type { TrackingResult, TrackingStatus } from "./carriers/types";

/**
 * TTL ตามสถานะ — พัสดุที่จบแล้วไม่มีทางเปลี่ยนอีก เก็บได้นาน
 * ส่วนพัสดุที่กำลังนำจ่ายเปลี่ยนสถานะได้ทุกนาที จึงเก็บสั้นที่สุด
 *
 * ตัวเลขชุดนี้ปรับใหม่ตอนย้ายมาใช้ cache ถาวร โดยยึดหลักว่า "โควตาของ Track123
 * นับเป็นจำนวนเลขพัสดุต่อรอบบิล ไม่ใช่จำนวน request" การยิงเลขเดิมซ้ำจึงไม่
 * เสียโควตาเพิ่ม TTL จึงไม่ต้องยาวเพื่อประหยัดโควตา แต่ยาวเพื่อลดจำนวน request
 * (เพดาน 5 req/s) กับเวลารอของผู้ใช้
 */
export const TTL_MS: Record<TrackingStatus, number> = {
  // 30 วัน — พัสดุที่ถึงมือผู้รับแล้วไม่มีทางเปลี่ยนสถานะอีก การถามซ้ำได้
  // คำตอบเดิมเป๊ะๆ เสมอ ก่อนหน้านี้ตั้งไว้ 24 ชั่วโมงเพราะ cache หายตอน restart
  // อยู่แล้ว เก็บนานกว่านั้นก็ไม่มีความหมาย พอมีชั้นถาวรแล้วจึงยืดได้เต็มที่
  delivered: 30 * 24 * 60 * 60_000,

  // 3 ชั่วโมง — ลดลงจาก 24 ชั่วโมง เพราะเดิมถูกจัดเป็น "จบแล้ว" กองเดียวกับ
  // delivered ซึ่งไม่จริง: exception รวม "นำจ่ายไม่สำเร็จ" ที่ขนส่งมักกลับมา
  // ส่งใหม่ในวันถัดไป การค้างสถานะ "พัสดุมีปัญหา" ไว้ 24 ชั่วโมงแปลว่าผู้ใช้
  // อาจเห็นว่ามีปัญหาอยู่ ทั้งที่ส่งสำเร็จไปตั้งแต่เช้าแล้ว
  exception: 3 * 60 * 60_000,

  out_for_delivery: 15 * 60_000, // 15 นาที — เปลี่ยนได้ตลอดเวลา และเป็นช่วงที่ผู้ใช้เช็คถี่ที่สุด
  pending: 2 * 60 * 60_000, // 2 ชั่วโมง
  in_transit: 2 * 60 * 60_000, // 2 ชั่วโมง
};

/** เพดานจำนวนรายการในชั้น memory — ชั้นถาวรไม่มีเพดานนี้ */
const MAX_ENTRIES = 5_000;

export interface CacheEntry {
  result: TrackingResult;
  /** เวลาที่ดึงข้อมูลชุดนี้มาจากขนส่ง (epoch ms) */
  fetchedAt: number;
  /** เวลาหมดอายุ (epoch ms) */
  expiresAt: number;
}

/** key = เลขพัสดุที่ normalize แล้ว */
const store = new Map<string, CacheEntry>();

/** อายุ cache ของผลลัพธ์นี้ ตามสถานะของพัสดุ */
export function ttlFor(result: TrackingResult): number {
  return TTL_MS[result.status] ?? TTL_MS.in_transit;
}

/** หมดอายุหรือยัง */
export function isExpired(entry: CacheEntry, now: number = Date.now()): boolean {
  return now >= entry.expiresAt;
}

/**
 * อ่านรายการจากชั้น memory ไม่ว่าจะหมดอายุแล้วหรือยัง
 *
 * ของที่หมดอายุมีค่าตอนระบบขนส่งล่ม — แสดงข้อมูลเก่าพร้อมป้ายบอกเวลา
 * ดีกว่าโชว์หน้าจอ error ผู้เรียกต้องเช็ค isExpired() เองก่อนใช้เป็นคำตอบปกติ
 */
export function getEntry(trackingNumber: string): CacheEntry | undefined {
  return store.get(trackingNumber);
}

/** อ่านเฉพาะรายการที่ยังไม่หมดอายุ — undefined ถ้าไม่มีหรือหมดอายุแล้ว */
export function getCached(
  trackingNumber: string,
  now: number = Date.now(),
): CacheEntry | undefined {
  const entry = store.get(trackingNumber);
  if (entry === undefined || isExpired(entry, now)) return undefined;
  return entry;
}

/** บันทึกรายการที่ประกอบไว้แล้ว — ใช้ตอนดึงของจากชั้นถาวรขึ้นมาไว้ในชั้น memory */
export function setEntry(trackingNumber: string, entry: CacheEntry): void {
  // ถึงเพดานแล้ว → ทิ้งรายการที่เก่าที่สุดก่อน (Map เรียงตามลำดับที่ใส่เข้ามา)
  if (store.size >= MAX_ENTRIES && !store.has(trackingNumber)) {
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }

  store.set(trackingNumber, entry);
}

/** บันทึกผลที่เพิ่งยิงมาได้ แล้วคืนรายการที่ประกอบเสร็จ (ไว้ส่งต่อให้ชั้นถาวร) */
export function setCached(
  trackingNumber: string,
  result: TrackingResult,
  now: number = Date.now(),
): CacheEntry {
  const entry: CacheEntry = {
    result,
    fetchedAt: now,
    expiresAt: now + ttlFor(result),
  };

  setEntry(trackingNumber, entry);
  return entry;
}

/** ล้าง cache ทั้งหมด — ใช้ในเทสและตอนอยาก force รีเฟรชทั้งระบบ */
export function clearCache(): void {
  store.clear();
}

/** จำนวนรายการที่เก็บอยู่ตอนนี้ (รวมของที่หมดอายุแล้ว) */
export function cacheSize(): number {
  return store.size;
}
