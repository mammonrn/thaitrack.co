/**
 * ประกอบค่าคอลัมน์ของ saved_trackings จากผลการค้นหาหนึ่งครั้ง
 *
 * แยกออกมาเพราะมีสองทางที่เขียนแถวเดียวกันนี้ และทั้งคู่ต้องได้ค่าชุดเดียวกัน
 * เป๊ะๆ ไม่งั้นสถานะที่ผู้ใช้เห็นจะต่างกันแล้วแต่ว่ามันถูกเขียนมาจากทางไหน:
 *
 *   1. POST /api/saved         ตอนผู้ใช้กดบันทึก
 *   2. POST /api/saved/refresh ตอนเปิดหน้าประวัติ (ดู lib/saved-refresh.ts)
 *
 * เหตุผลเดียวกับที่ withoutSensitive() ถูกใช้ร่วมกันทั้งสองทางใน
 * lib/tracking-cache.ts — นิยามที่ต่างกันระหว่างสองที่คือบั๊กที่ไม่มีใครเห็น
 * จนกว่าจะมีคนเทียบสองหน้าจอกัน
 */

import type { TrackingResult, TrackingStatus } from "./carriers/types";
import { resolveLocation } from "./location-resolve";

/** ค่าคอลัมน์ชุดที่ทั้งสองทางเขียนเหมือนกัน (snake_case ตรงกับฐานข้อมูล) */
export interface SavedSnapshot {
  carrier_name: string;
  last_status: TrackingStatus;
  last_status_text: string;
  last_location_text: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_location_accuracy: string | null;
  last_updated_at: string | null;
}

/**
 * หาสถานที่ล่าสุดที่ระบุมาจริง — เหตุการณ์ใหม่สุดบางอันไม่ได้บอกสถานที่มาด้วย
 *
 * ไล่จากท้ายมาหน้า เพราะ events เรียงจากเก่าไปใหม่
 */
export function latestLocation(events: { location: string }[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const location = events[index].location.trim();
    if (location !== "") return location;
  }
  return "";
}

export interface SnapshotOptions {
  /**
   * ห้ามไปขอที่อยู่สาขาจากขนส่งระหว่างนี้
   *
   * ใช้กับเส้นทางรีเฟรช — การขอที่อยู่สาขาเป็นการยิง ETrackings เพิ่มหนึ่งครั้ง
   * ต่อสาขาที่ยังไม่รู้พิกัด ถ้าปล่อยให้เกิดตอนเปิดหน้าประวัติ การเปิดหน้าครั้ง
   * เดียวอาจจุดชนวนการยิงหลายครั้งพร้อมกัน ซึ่งเป็นของแพงที่สุดในระบบ
   *
   * ไม่ได้เสียอะไร: การขอที่อยู่เกิดไปแล้วตอนกดบันทึก และสาขาที่เติมพิกัดสำเร็จ
   * จะอยู่ใน carrier_branches ให้ใช้ต่อได้ทันทีอยู่แล้ว
   */
  skipProbe?: boolean;
}

/**
 * แปลงผลการค้นหาเป็นค่าคอลัมน์พร้อมเขียน
 *
 * หาพิกัดตามลำดับที่ไม่มีทางปักหมุดมั่ว: ตารางพิกัดสาขา → geocode เฉพาะข้อความ
 * ที่ดูเหมือนที่อยู่จริง → ไม่รู้ก็ไม่ปัก (ดู lib/location-resolve.ts)
 *
 * หาพิกัดไม่ได้ต้องไม่ทำให้การเขียนแถวล้มเหลว — เก็บ null แล้วไปต่อ
 */
export async function buildSavedSnapshot(
  result: TrackingResult,
  options: SnapshotOptions = {},
): Promise<SavedSnapshot> {
  const rawLocationText = latestLocation(result.events);

  const location =
    rawLocationText === ""
      ? null
      : await resolveLocation(rawLocationText, result.carrierCode, {
          trackingNumber: result.trackingNumber,
          // ขนส่งที่เพิ่งค้นเจอ = ยืนยันแล้ว ไม่ใช่การเดา ปลดล็อกการขอที่อยู่
          // สาขาสำหรับเลขที่ prefix บอกไม่ได้ (เช่น TH… ของ SPX)
          courierHint: result.carrierCode,
          skipProbe: options.skipProbe,
        });

  const coordinates = location?.coordinates ?? null;

  // เก็บข้อความที่อ่านรู้เรื่อง (ชื่อสาขา) แทนข้อความดิบที่มีรหัสภายในปนมา
  const locationText = location?.displayText ?? rawLocationText;

  return {
    carrier_name: result.carrierName,
    last_status: result.status,
    last_status_text: result.statusText,
    last_location_text: locationText === "" ? null : locationText,
    last_lat: coordinates?.lat ?? null,
    last_lng: coordinates?.lng ?? null,
    // หน้าประวัติใช้ค่านี้ตัดสินว่าจะขึ้นป้าย "ตำแหน่งโดยประมาณ" หรือไม่
    last_location_accuracy:
      coordinates === null ? null : (location?.accuracy ?? null),
    last_updated_at: result.lastUpdated,
  };
}
