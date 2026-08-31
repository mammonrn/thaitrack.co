/**
 * ชั้นที่สองของ cache — ตาราง public.tracking_cache ใน Supabase
 *
 * รอด restart และใช้ร่วมกันทุก instance ต่างจากชั้น memory ที่หายทุกครั้งที่
 * deploy (ดู lib/cache.ts และ supabase/migrations/0003_tracking_cache.sql)
 *
 * กติกาข้อเดียวที่สำคัญที่สุดของไฟล์นี้: **ห้ามโยน error ออกไปเด็ดขาด**
 * cache เป็นของเสริม ถ้าฐานข้อมูลล่ม ช้า หรือยังไม่ได้รันไฟล์ migration
 * การค้นหาพัสดุต้องทำงานต่อได้ตามปกติ เพียงแต่ไม่มีชั้นถาวรช่วยเท่านั้น
 * ทุกทางที่ล้มเหลวจึงจบที่ log แล้วคืน null ไม่ใช่ throw
 *
 * ⚠️ ใช้ service role key ซึ่งข้าม RLS ได้ — ตารางนี้เป็นของกลางที่ไม่ผูกกับ
 * ผู้ใช้คนใด และไม่มีทางไหนให้ client อ่านตรงๆ (ไม่ถูก grant และเปิด RLS
 * ไว้โดยไม่มี policy) การเข้าถึงมีทางเดียวคือผ่านไฟล์นี้ ฝั่งเซิร์ฟเวอร์
 */

import type { TrackingResult } from "../carriers/types";
import type { CacheEntry } from "../cache";
import { getServiceSupabaseClient } from "./service";

const TABLE = "tracking_cache";

/** คอลัมน์ที่ต้องอ่านกลับมา ประกาศที่เดียวให้ตรงกับ mapper ข้างล่าง */
const COLUMNS = "result, fetched_at, expires_at";

/** สัญญาของชั้นถาวร — แยกเป็น interface เพื่อให้เทสต์ใส่ตัวปลอมแทนได้ */
export interface PersistentTrackingCache {
  read(trackingNumber: string): Promise<CacheEntry | null>;
  write(trackingNumber: string, entry: CacheEntry): Promise<void>;
}

/**
 * ตรวจรูปร่างของ jsonb ก่อนเชื่อ
 *
 * ข้อมูลในตารางถูกเขียนไว้ตั้งแต่ deploy รอบก่อนๆ ซึ่งอาจเป็นโค้ดคนละเวอร์ชัน
 * กับที่กำลังรันอยู่ ถ้ารูปแบบ TrackingResult เปลี่ยนไป แถวเก่าจะกลายเป็นของ
 * ที่อ่านไม่ได้ ต้องทิ้งไปเงียบๆ ไม่ใช่ปล่อยให้หลุดไปพังที่ UI
 */
function isTrackingResult(value: unknown): value is TrackingResult {
  if (typeof value !== "object" || value === null) return false;

  const { trackingNumber, carrierName, status, statusText, events } =
    value as Record<string, unknown>;

  return (
    typeof trackingNumber === "string" &&
    typeof carrierName === "string" &&
    typeof status === "string" &&
    typeof statusText === "string" &&
    Array.isArray(events)
  );
}

/** timestamptz ที่ Postgres ส่งกลับมา → epoch ms (NaN ถ้าอ่านไม่ออก) */
function toEpochMs(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

function toEntry(row: unknown): CacheEntry | null {
  if (typeof row !== "object" || row === null) return null;

  const { result, fetched_at, expires_at } = row as Record<string, unknown>;
  if (!isTrackingResult(result)) return null;

  const fetchedAt = toEpochMs(fetched_at);
  const expiresAt = toEpochMs(expires_at);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(expiresAt)) return null;

  return { result, fetchedAt, expiresAt };
}

/** log ปัญหาของ cache แบบสั้นๆ — ไม่ใช่ error ของการค้นหา จึงเป็น warn ไม่ใช่ error */
function warn(action: string, trackingNumber: string, detail: string): void {
  console.warn(`[track-cache] ${action} no=${trackingNumber} ล้มเหลว: ${detail}`);
}

/** ชั้นถาวรตัวจริง — เป็น no-op ทั้งหมดถ้ายังไม่ได้ตั้ง service role key */
export const supabaseTrackingCache: PersistentTrackingCache = {
  async read(trackingNumber) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .eq("tracking_number", trackingNumber)
        // maybeSingle() คืน null เมื่อไม่เจอแถว แทนที่จะนับเป็น error
        .maybeSingle();

      if (error) {
        warn("อ่าน", trackingNumber, error.message);
        return null;
      }

      return data === null ? null : toEntry(data);
    } catch (cause) {
      // เครือข่ายพัง หรือ timeout ของ createTimeoutFetch
      warn("อ่าน", trackingNumber, cause instanceof Error ? cause.message : "ไม่ทราบสาเหตุ");
      return null;
    }
  },

  async write(trackingNumber, entry) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    const { result } = entry;

    try {
      const { error } = await supabase.from(TABLE).upsert(
        {
          tracking_number: trackingNumber,
          result,
          courier_code: result.carrierCode,
          courier_name: result.carrierName,
          status: result.status,
          last_updated_at: result.lastUpdated,
          fetched_at: new Date(entry.fetchedAt).toISOString(),
          expires_at: new Date(entry.expiresAt).toISOString(),
        },
        // เลขเดิมต้องทับแถวเดิมเสมอ ไม่ใช่สร้างแถวใหม่
        { onConflict: "tracking_number" },
      );

      if (error) warn("เขียน", trackingNumber, error.message);
    } catch (cause) {
      warn("เขียน", trackingNumber, cause instanceof Error ? cause.message : "ไม่ทราบสาเหตุ");
    }
  },
};
