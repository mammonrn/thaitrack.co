/**
 * ประกอบ cache สองชั้นเข้าด้วยกัน
 *
 *   ชั้น 1  memory   (lib/cache.ts)                    เร็วสุด หายตอน restart
 *   ชั้น 2  supabase (lib/supabase/tracking-cache.ts)  รอด restart ใช้ร่วมกันทุก instance
 *
 * ลำดับการอ่าน: memory → supabase → (ผู้เรียกค่อยยิง API เอง)
 * ลำดับการเขียน: เขียนกลับทั้งสองชั้นทุกครั้งที่ได้ผลสดจาก API
 *
 * นอกจากความเร็ว ชั้นถาวรยังทำหน้าที่เป็น "ของสำรอง" ในวันที่ระบบขนส่งล่ม
 * ของที่หมดอายุแล้วจึงไม่ถูกทิ้ง แต่ถูกคืนกลับมาพร้อมธง stale ให้ผู้เรียก
 * ตัดสินใจว่าจะใช้เป็นคำตอบสำรองหรือไม่
 */

import {
  getEntry,
  isExpired,
  setCached,
  setEntry,
  type CacheEntry,
} from "./cache";
import type { TrackingResult } from "./carriers/types";
import {
  supabaseTrackingCache,
  type PersistentTrackingCache,
} from "./supabase/tracking-cache";

/** ชั้นที่ตอบคำค้นนี้ */
export type CacheSource = "memory" | "supabase";

export interface CacheHit {
  entry: CacheEntry;
  source: CacheSource;
  /** true = หมดอายุแล้ว ใช้เป็นคำตอบปกติไม่ได้ ใช้ได้เฉพาะตอนยิง API ไม่สำเร็จ */
  stale: boolean;
}

/** เลือกรายการที่ "ใหม่กว่า" ระหว่างสองชั้น — ใช้ตอนทั้งคู่หมดอายุแล้ว */
function newer(a: CacheHit | null, b: CacheHit | null): CacheHit | null {
  if (a === null) return b;
  if (b === null) return a;
  return b.entry.fetchedAt > a.entry.fetchedAt ? b : a;
}

/**
 * หาผลที่ดีที่สุดจาก cache — null เมื่อไม่เคยเก็บเลขนี้ไว้เลย
 *
 * คืนของที่หมดอายุแล้วด้วย (ติดธง stale) เพราะผู้เรียกต้องใช้เป็นคำตอบสำรอง
 * ตอนยิง API ไม่สำเร็จ การอ่านครั้งเดียวได้ทั้งของสดและของสำรอง ทำให้ไม่ต้อง
 * วิ่งไปถาม Supabase อีกรอบตอนขาล้มเหลว
 *
 * ชั้น memory ที่หมดอายุแล้วไม่ทำให้หยุดค้นต่อ เพราะ instance อื่นอาจเพิ่ง
 * ดึงของสดลงชั้นถาวรไปแล้ว
 */
export async function lookupTracking(
  trackingNumber: string,
  cache: PersistentTrackingCache = supabaseTrackingCache,
  now: number = Date.now(),
): Promise<CacheHit | null> {
  const fromMemory = getEntry(trackingNumber);

  if (fromMemory !== undefined && !isExpired(fromMemory, now)) {
    return { entry: fromMemory, source: "memory", stale: false };
  }

  const memoryHit: CacheHit | null =
    fromMemory === undefined
      ? null
      : { entry: fromMemory, source: "memory", stale: true };

  const fromPersistent = await cache.read(trackingNumber);
  if (fromPersistent === null) return memoryHit;

  if (!isExpired(fromPersistent, now)) {
    // ดึงขึ้นมาไว้ชั้นบนด้วย โดยคงเวลาเดิมไว้ ไม่ใช่นับอายุใหม่ตั้งแต่ตอนนี้
    setEntry(trackingNumber, fromPersistent);
    return { entry: fromPersistent, source: "supabase", stale: false };
  }

  return newer(memoryHit, {
    entry: fromPersistent,
    source: "supabase",
    stale: true,
  });
}

/**
 * บันทึกผลที่เพิ่งยิงมาได้ลงทั้งสองชั้น
 *
 * รอให้ชั้นถาวรเขียนเสร็จก่อนคืน (ไม่ยิงทิ้ง) เพราะการเขียนใช้เวลาไม่ถึงหนึ่ง
 * ในสิบของเวลาที่เพิ่งเสียไปกับการยิง API และการรอทำให้คำขอถัดไปเห็นของทันที
 * ที่นี่รอได้เพราะ write() ไม่มีทางโยน error ออกมา (ดูไฟล์ชั้นถาวร)
 */
export async function rememberTracking(
  trackingNumber: string,
  result: TrackingResult,
  cache: PersistentTrackingCache = supabaseTrackingCache,
  now: number = Date.now(),
): Promise<CacheEntry> {
  const entry = setCached(trackingNumber, withoutSensitive(result), now);
  await cache.write(trackingNumber, entry);
  return entry;
}

/**
 * ตัดข้อมูลอ่อนไหวออกก่อนเก็บหรือก่อนส่งออกไป
 *
 * ⚠️ นี่คือจุดเดียวที่กันไม่ให้รูปถ่ายตอนนำจ่ายไหลลง cache ซึ่งเป็นของกลางที่
 * ทุกคนที่ค้นเลขเดียวกันใช้ร่วมกัน ทั้ง cache ใน memory และใน Supabase เขียน
 * ผ่าน rememberTracking() ทางเดียว การตัดที่นี่จึงครอบทั้งสองชั้นพร้อมกัน
 *
 * ไม่แก้ของเดิม เพราะผู้เรียกที่เพิ่งยิง API มายังต้องใช้ค่าเต็มต่อ (ถ้าเขามีสิทธิ์)
 *
 * export ไว้ให้ API route ใช้ตัดก่อนตอบกลับด้วย — ตัดด้วยฟังก์ชันเดียวกันทั้ง
 * สองทาง จะได้ไม่มีทางที่นิยามของคำว่า "อ่อนไหว" ต่างกันระหว่างสองที่
 */
export function withoutSensitive(result: TrackingResult): TrackingResult {
  if (result.sensitive == null) return result;
  return { ...result, sensitive: null };
}
