/**
 * ตัวกลางระหว่างหน้าเว็บกับ /api/saved
 *
 * แยกออกมาด้วยเหตุผลเดียวกับ tracking-view.ts คือให้ component เหลือแค่การ
 * แสดงผล และให้ทุกทางที่ล้มเหลวจบที่ข้อความไทยที่ผู้ใช้อ่านรู้เรื่องเสมอ
 */

import type { TrackingStatus } from "./carriers/types";
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
  lastUpdatedAt: string | null;
  createdAt: string;
}

/** ชื่อคอลัมน์ที่ดึงจากฐานข้อมูล ประกาศไว้ที่เดียวเพื่อให้ select ตรงกับ mapper */
export const SAVED_TRACKING_COLUMNS =
  "id, tracking_number, carrier_name, nickname, last_status, last_status_text, last_location_text, last_lat, last_lng, last_updated_at, created_at";

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
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at,
  };
}

/** ชื่อที่แสดงในรายการ — ชื่อเล่นถ้าตั้งไว้ ไม่งั้นใช้เลขพัสดุ */
export function displayTitleOf(saved: SavedTracking): string {
  const nickname = saved.nickname?.trim() ?? "";
  return nickname === "" ? saved.trackingNumber : nickname;
}

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
