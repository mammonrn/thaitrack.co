/**
 * ตัวกลางระหว่างหน้าเว็บกับ /api/saved
 *
 * แยกออกมาด้วยเหตุผลเดียวกับ tracking-view.ts คือให้ component เหลือแค่การ
 * แสดงผล และให้ทุกทางที่ล้มเหลวจบที่ข้อความไทยที่ผู้ใช้อ่านรู้เรื่องเสมอ
 */

import { TRACKING_STATUS_TEXT, type TrackingStatus } from "./carriers/types";
import type { LocationAccuracy } from "./geocode";
import type { UserFacingError } from "./tracking-view";

/** หนึ่งรายการในหน้าประวัติ (แปลงจากคอลัมน์ snake_case ของฐานข้อมูลแล้ว) */
export interface SavedTracking {
  id: string;
  trackingNumber: string;
  carrierName: string | null;
  nickname: string | null;
  lastStatus: TrackingStatus | null;
  lastStatusText: string | null;
  lastLocationText: string | null;
  lastLat: number | null;
  lastLng: number | null;
  /**
   * หมุดนี้ละเอียดแค่ไหน — null = แถวเก่าที่บันทึกก่อนมีคอลัมน์นี้
   *
   * "approximate" ต้องขึ้นป้ายบอกผู้ใช้ว่าเป็นตำแหน่งโดยประมาณ ส่วน null
   * ไม่ขึ้นป้าย เพราะเราไม่รู้จริงๆ ว่าแม่นแค่ไหน การเดาว่า "ไม่แม่น" แล้ว
   * ติดป้ายให้ทุกแถวเก่า คือการบอกสิ่งที่เราไม่รู้ ไม่ต่างจากการเดาว่าแม่น
   */
  lastLocationAccuracy: LocationAccuracy | null;
  lastUpdatedAt: string | null;
  createdAt: string;
}

/** ชื่อคอลัมน์ที่ดึงจากฐานข้อมูล ประกาศไว้ที่เดียวเพื่อให้ select ตรงกับ mapper */
export const SAVED_TRACKING_COLUMNS =
  "id, tracking_number, carrier_name, nickname, last_status, last_status_text, last_location_text, last_lat, last_lng, last_location_accuracy, last_updated_at, created_at";

interface SavedTrackingRow {
  id: string;
  tracking_number: string;
  carrier_name: string | null;
  nickname: string | null;
  last_status: string | null;
  last_status_text: string | null;
  last_location_text: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_location_accuracy: string | null;
  last_updated_at: string | null;
  created_at: string;
}

const TRACKING_STATUSES = new Set<string>([
  "pending",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
]);

export function toSavedTracking(row: SavedTrackingRow): SavedTracking {
  return {
    id: row.id,
    trackingNumber: row.tracking_number,
    carrierName: row.carrier_name,
    nickname: row.nickname,
    // ฐานข้อมูลมี check constraint คุมอยู่แล้ว แต่ยังกรองซ้ำตรงนี้เพราะ TypeScript
    // เชื่อค่าที่มาจากนอกโปรแกรมไม่ได้
    lastStatus:
      row.last_status !== null && TRACKING_STATUSES.has(row.last_status)
        ? (row.last_status as TrackingStatus)
        : null,
    lastStatusText: row.last_status_text,
    lastLocationText: row.last_location_text,
    lastLat: row.last_lat,
    lastLng: row.last_lng,
    // ฐานข้อมูลมี check constraint คุมอยู่ แต่กรองซ้ำด้วยเหตุผลเดียวกับ lastStatus
    lastLocationAccuracy:
      row.last_location_accuracy === "exact" ||
      row.last_location_accuracy === "approximate"
        ? row.last_location_accuracy
        : null,
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at,
  };
}

/** ชื่อที่แสดงในรายการ — ชื่อเล่นถ้าตั้งไว้ ไม่งั้นใช้เลขพัสดุ */
export function displayTitleOf(saved: SavedTracking): string {
  const nickname = saved.nickname?.trim() ?? "";
  return nickname === "" ? saved.trackingNumber : nickname;
}

/**
 * เรียงรายการจากที่บันทึกล่าสุดไปเก่าสุด
 *
 * ผู้ใช้เพิ่งกดบันทึกอะไรไป ก็คาดว่าจะเห็นอันนั้นบนสุด การเรียงตาม
 * last_updated_at (เวลาที่ขนส่งอัปเดต) ทำให้พัสดุที่บันทึกเมื่อครู่แต่ยังไม่มี
 * ความเคลื่อนไหวตกไปอยู่ท้ายสุด ซึ่งดูเหมือนกดบันทึกไม่ติด
 *
 * ฐานข้อมูลเรียงมาให้แล้วด้วย order by created_at desc — ฟังก์ชันนี้ทำซ้ำฝั่ง
 * แอปเพื่อให้ลำดับเหมือนกันแน่นอนไม่ว่าข้อมูลจะมาจากทางไหน (เช่นรายการที่
 * client ต่อเพิ่มเองหลังบันทึกสำเร็จ) และเพื่อให้ทดสอบลำดับได้โดยไม่ต้องมี DB
 *
 * ไม่แก้อาร์เรย์เดิม เพราะผู้เรียกอาจถือ props ของ React อยู่
 */
export function sortBySavedAtDesc(items: readonly SavedTracking[]): SavedTracking[] {
  return [...items].sort((a, b) => {
    const gap = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (gap !== 0 && Number.isFinite(gap)) return gap;

    // บันทึกพร้อมกันเป๊ะ (หรือเวลาเสีย) → ใช้ id ตัดสิน จะได้ลำดับคงที่ ไม่สลับ
    // ไปมาทุกครั้งที่ render
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** ตัวเลขสรุปบนหัวหน้าประวัติ */
export interface SavedSummary {
  /** ยังไม่ถึงมือผู้รับ: รอรับเข้าระบบ + อยู่ระหว่างขนส่ง + กำลังนำจ่าย */
  inTransit: number;
  delivered: number;
  problem: number;
  total: number;
}

/** สถานะที่ถือว่าพัสดุยังเดินทางอยู่ */
const IN_TRANSIT_STATUSES = new Set<TrackingStatus>([
  "pending",
  "in_transit",
  "out_for_delivery",
]);

/**
 * นับสถานะจาก snapshot ที่เก็บไว้ตอนกดบันทึก
 *
 * ไม่ยิงถาม API ขนส่งใหม่โดยตั้งใจ — หน้าประวัติที่มี 20 รายการจะกลายเป็น 20
 * คำขอออกนอกเครื่องทันทีที่เปิดหน้า ตัวเลขจึงเป็น "สถานะ ณ ครั้งล่าสุดที่ดู"
 * ซึ่งตรงกับสิ่งที่การ์ดแต่ละใบแสดงอยู่แล้ว ไม่ขัดกันเอง
 *
 * รายการที่ไม่มีสถานะติดมา (บันทึกตอนขนส่งยังไม่ตอบ) นับเฉพาะใน total
 * เพราะเดาแทนผู้ใช้ไม่ได้ว่าอยู่ขั้นไหน
 */
export function summarizeSavedTrackings(
  items: readonly SavedTracking[],
): SavedSummary {
  let inTransit = 0;
  let delivered = 0;
  let problem = 0;

  for (const item of items) {
    if (item.lastStatus === null) continue;
    if (item.lastStatus === "delivered") delivered += 1;
    else if (item.lastStatus === "exception") problem += 1;
    else if (IN_TRANSIT_STATUSES.has(item.lastStatus)) inTransit += 1;
  }

  return { inTransit, delivered, problem, total: items.length };
}

/**
 * ป้ายกำกับของตัวเลขสรุป
 *
 * ป้ายที่ตรงกับสถานะเดี่ยวอ้าง TRACKING_STATUS_TEXT เพื่อให้ใช้คำเดียวกับ
 * หัวการ์ดและไทม์ไลน์ ส่วน "กำลังเดินทาง" เป็นชื่อกลุ่มที่รวมหลายสถานะเข้าด้วยกัน
 * จึงตั้งชื่อของตัวเอง
 */
export const SUMMARY_LABEL = {
  inTransit: "กำลังเดินทาง",
  delivered: TRACKING_STATUS_TEXT.delivered,
  problem: TRACKING_STATUS_TEXT.exception,
  total: "ทั้งหมด",
} as const;

/** ความยาวสูงสุดของชื่อเล่น กันไม่ให้ยัดข้อความยาวจนหน้าเพี้ยน */
export const NICKNAME_MAX_LENGTH = 60;

export const SAVE_ERROR: Record<string, UserFacingError> = {
  unauthenticated: {
    title: "ต้องเข้าสู่ระบบก่อน",
    detail: "กดเข้าสู่ระบบที่มุมขวาบน แล้วลองบันทึกอีกครั้ง",
  },
  not_found: {
    title: "บันทึกไม่สำเร็จ",
    detail: "ไม่พบเลขพัสดุนี้ในระบบขนส่งแล้ว ลองค้นหาใหม่อีกครั้ง",
  },
  network_error: {
    title: "เชื่อมต่อไม่สำเร็จ",
    detail: "ตรวจสัญญาณอินเทอร์เน็ตของคุณ แล้วลองอีกครั้ง",
  },
  unknown: {
    title: "บันทึกไม่สำเร็จ",
    detail: "ลองอีกครั้ง ถ้ายังไม่ได้ ลองใหม่ในอีกสักครู่",
  },
};

export const DELETE_ERROR: UserFacingError = {
  title: "ลบไม่สำเร็จ",
  detail: "ลองกดลบอีกครั้ง ถ้ายังไม่ได้ ลองรีเฟรชหน้าแล้วทำใหม่",
};

export type SavedOutcome =
  | { ok: true; saved: SavedTracking }
  | { ok: false; error: UserFacingError };

function saveFailure(code: unknown): SavedOutcome {
  const key = typeof code === "string" && code in SAVE_ERROR ? code : "unknown";
  return { ok: false, error: SAVE_ERROR[key] };
}

/**
 * บันทึกหรืออัปเดตรายการ
 *
 * ส่งไปแค่เลขพัสดุกับชื่อเล่น ไม่ส่งสถานะไปด้วย เพราะฝั่ง server จะไปอ่านสถานะ
 * ล่าสุดเองจาก cache ที่มีอยู่แล้ว ทำให้ข้อมูลที่บันทึกเชื่อถือได้เสมอ
 * ไม่ขึ้นกับสิ่งที่ client ส่งมา
 */
export async function saveTracking(
  trackingNumber: string,
  nickname: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SavedOutcome> {
  try {
    const response = await fetchImpl("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingNumber, nickname }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (
      response.ok &&
      typeof payload === "object" &&
      payload !== null &&
      "data" in payload
    ) {
      return {
        ok: true,
        saved: toSavedTracking((payload as { data: SavedTrackingRow }).data),
      };
    }

    const code =
      typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: { code?: unknown } }).error?.code
        : undefined;

    return saveFailure(code);
  } catch {
    return { ok: false, error: SAVE_ERROR.network_error };
  }
}

/**
 * ถามว่าเลขนี้เคยบันทึกไว้แล้วหรือยัง
 *
 * คืน null ทั้งกรณี "ยังไม่เคยบันทึก" และกรณีถามไม่สำเร็จ เพราะหน้าเว็บทำอย่าง
 * เดียวกันทั้งสองกรณีคือแสดงปุ่ม "บันทึก" ตามปกติ ไม่ต้องรบกวนผู้ใช้
 */
export async function findSavedTracking(
  trackingNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SavedTracking | null> {
  try {
    const response = await fetchImpl(
      `/api/saved?trackingNumber=${encodeURIComponent(trackingNumber)}`,
    );
    if (!response.ok) return null;

    const payload: unknown = await response.json().catch(() => null);
    const row =
      typeof payload === "object" && payload !== null && "data" in payload
        ? (payload as { data: SavedTrackingRow | null }).data
        : null;

    return row === null ? null : toSavedTracking(row);
  } catch {
    return null;
  }
}

export async function deleteSavedTracking(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: UserFacingError }> {
  try {
    const response = await fetchImpl(`/api/saved/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (response.ok) return { ok: true };

    return { ok: false, error: DELETE_ERROR };
  } catch {
    return { ok: false, error: SAVE_ERROR.network_error };
  }
}
