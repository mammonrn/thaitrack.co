/**
 * Adapter ของ "Track123" — ตัวรวม API ติดตามพัสดุหลายร้อยขนส่งทั่วโลก
 * ใช้เป็นตัวสำรองเมื่อไปรษณีย์ไทยไม่รู้จักเลขพัสดุนั้น
 *
 * เอกสาร: https://docs.track123.com/
 * ใช้ endpoint Instant Tracking (query-realtime) เพราะยิงเลขเดียวได้จบในครั้งเดียว
 * ไม่ต้อง register เลขไว้ก่อน และตรวจจับขนส่งให้อัตโนมัติเมื่อไม่ได้ระบุ courierCode
 *
 * ข้อจำกัดของ endpoint นี้ตามเอกสาร: กิน quota 1 หน่วยต่อครั้ง และยิงได้ 1 ครั้ง/วินาที
 *
 * API key อ่านจาก process.env.TRACK123_API_KEY เท่านั้น — ห้าม hardcode
 */

import {
  CarrierError,
  TRACKING_STATUS_TEXT,
  type CarrierAdapter,
  type TrackingEvent,
  type TrackingResult,
  type TrackingStatus,
} from "./types";

const API_BASE = "https://api.track123.com/gateway/open-api/tk/v2.1";
const CARRIER_CODE = "track123";
const CARRIER_NAME = "Track123";

const REQUEST_TIMEOUT_MS = 20_000;

/** transitStatus ของ Track123 map เข้าสถานะกลางของเรา */
const TRANSIT_STATUS_MAP: Record<string, TrackingStatus> = {
  INIT: "pending", // เพิ่งเพิ่มเข้าระบบ ยังไม่เริ่มติดตาม
  INFO_RECEIVED: "pending", // ขนส่งรับข้อมูลแล้ว รอเข้ารับพัสดุ
  IN_TRANSIT: "in_transit",
  WAITING_DELIVERY: "out_for_delivery", // กำลังนำจ่าย หรือรอรับที่จุดรับพัสดุ
  DELIVERED: "delivered",
  DELIVERY_FAILED: "exception",
  ABNORMAL: "exception", // เสียหาย ตีกลับ ศุลกากรกัก ฯลฯ
  EXPIRED: "exception", // ไม่มีความเคลื่อนไหวเกิน 30 วัน
};

/** code ที่แปลว่าเลขพัสดุนี้ไม่มีข้อมูล (ไม่ใช่ความผิดพลาดของระบบ) */
const NO_RECORD_TRANSIT_STATUS = "NO_RECORD";
const NO_RECORD_QUERY_STATUS = "002";

const SUCCESS_CODE = "00000";

/** code ตอบกลับของ Track123 ที่บอกว่าเป็นปัญหาสิทธิ์/บัญชี */
const AUTH_CODES = new Set([
  "A0201",
  "A0202",
  "A0203",
  "A0230",
  "A0231",
  "A0300",
  "A0301",
]);
/** code ที่บอกว่ายิงถี่เกินไปหรือใช้ quota หมด */
const RATE_LIMIT_CODES = new Set(["A0706", "B0210", "B0310"]);
/** code ที่บอกว่าพารามิเตอร์ที่ส่งไปไม่ถูกต้อง */
const BAD_REQUEST_CODES = new Set(["A0400", "A0410"]);

/* ------------------------------------------------------------------ *
 * รูปแบบข้อมูลที่ Track123 ส่งกลับมา (เอาเฉพาะฟิลด์ที่ใช้)
 * ------------------------------------------------------------------ */

interface Track123Event {
  address?: string | null;
  eventTime?: string | null;
  eventTimeZeroUTC?: string | null;
  timezone?: string | null;
  eventDetail?: string | null;
  eventDetailTranslation?: string | null;
}

interface Track123LogisticsInfo {
  courierCode?: string | null;
  courierNameEN?: string | null;
  courierNameCN?: string | null;
  trackingDetails?: Track123Event[] | null;
}

interface Track123Accepted {
  trackNo?: string | null;
  trackingStatus?: string | null;
  transitStatus?: string | null;
  transitSubStatus?: string | null;
  lastTrackingTime?: string | null;
  localLogisticsInfo?: Track123LogisticsInfo | null;
  lastMileInfo?: Track123LogisticsInfo | null;
}

interface Track123Response {
  code?: string | null;
  msg?: string | null;
  data?: {
    accepted?: Track123Accepted | null;
    rejected?: unknown;
  } | null;
}

/* ------------------------------------------------------------------ *
 * การเรียก API
 * ------------------------------------------------------------------ */

function readApiKey(): string {
  const apiKey = process.env.TRACK123_API_KEY?.trim();
  if (!apiKey) {
    throw new CarrierError(
      "config_error",
      "ระบบยังไม่ได้ตั้งค่าเชื่อมต่อ Track123 กรุณาลองใหม่ภายหลัง",
      { debugMessage: "ไม่พบ environment variable TRACK123_API_KEY" },
    );
  }
  return apiKey;
}

/** ยิง POST พร้อม timeout และแปลง network error ให้เป็น CarrierError เสมอ */
async function postJson(path: string, body: unknown): Promise<Response> {
  const apiKey = readApiKey();

  try {
    return await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Track123-Api-Secret": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new CarrierError(
      "network_error",
      timedOut
        ? "ระบบ Track123 ตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง"
        : "เชื่อมต่อระบบ Track123 ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      { cause, debugMessage: `เรียก ${path} ไม่สำเร็จ` },
    );
  }
}

/** อ่าน JSON แบบไม่ throw — API อาจตอบ HTML หรือ body เปล่ามาตอนระบบขัดข้อง */
async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** แปลง code/HTTP status ของ Track123 เป็น CarrierError ที่สื่อสาเหตุ */
function toCarrierError(
  httpStatus: number,
  payload: Track123Response | null,
): CarrierError {
  const code = payload?.code?.trim() ?? "";
  const detail = `HTTP ${httpStatus}, code=${code || "-"}: ${payload?.msg ?? "ไม่มีข้อความตอบกลับ"}`;

  if (httpStatus === 401 || httpStatus === 403 || AUTH_CODES.has(code)) {
    return new CarrierError(
      "auth_failed",
      "ระบบเชื่อมต่อ Track123 ไม่ผ่านการยืนยันตัวตน กรุณาแจ้งผู้ดูแลระบบ",
      { debugMessage: `เรียก Track123 ไม่ผ่านสิทธิ์ (${detail})` },
    );
  }

  if (httpStatus === 429 || RATE_LIMIT_CODES.has(code)) {
    return new CarrierError(
      "rate_limited",
      "มีการค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
      { debugMessage: `Track123 จำกัดอัตราการเรียกหรือ quota หมด (${detail})` },
    );
  }

  if (BAD_REQUEST_CODES.has(code)) {
    return new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      { debugMessage: `Track123 ปฏิเสธพารามิเตอร์ (${detail})` },
    );
  }

  return new CarrierError(
    "upstream_error",
    "ระบบ Track123 ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
    { debugMessage: `เรียก Track123 ไม่สำเร็จ (${detail})` },
  );
}

/* ------------------------------------------------------------------ *
 * การแปลงข้อมูลเป็นรูปแบบกลาง
 * ------------------------------------------------------------------ */

/** ตัดช่องว่างกับขีด และทำเป็นตัวพิมพ์ใหญ่ */
function normalizeTrackingNumber(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** "+0800" → "+08:00" ให้ Date.parse อ่านได้ */
function normalizeOffset(offset: string | null | undefined): string | null {
  const value = offset?.trim();
  if (!value) return null;
  if (/^[+-]\d{2}:\d{2}$/.test(value)) return value;
  if (/^[+-]\d{4}$/.test(value)) return `${value.slice(0, 3)}:${value.slice(3)}`;
  if (/^[+-]\d{1,2}$/.test(value)) {
    const sign = value[0];
    return `${sign}${value.slice(1).padStart(2, "0")}:00`;
  }
  return null;
}

/**
 * Track123 ส่งเวลามาได้หลายทรง — "2026-06-16 18:43:04" คู่กับ timezone แยกฟิลด์
 * หรือ eventTimeZeroUTC ที่เป็น UTC อยู่แล้ว จึงต้องไล่ลองทีละแบบ
 */
function parseTrack123Date(event: Track123Event): {
  iso: string;
  timestamp: number;
} {
  const raw = event.eventTime?.trim();

  if (raw) {
    const offset = normalizeOffset(event.timezone);
    // "YYYY-MM-DD HH:mm(:ss)" ที่ยังไม่มี offset ติดมา
    const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(raw);
    if (local) {
      const [, date, hhmm, ss = ":00"] = local;
      const iso = `${date}T${hhmm}${ss}${offset ?? "Z"}`;
      const timestamp = Date.parse(iso);
      if (Number.isFinite(timestamp)) return { iso, timestamp };
    }

    const direct = Date.parse(raw);
    if (Number.isFinite(direct)) {
      return { iso: new Date(direct).toISOString(), timestamp: direct };
    }
  }

  const utc = event.eventTimeZeroUTC?.trim();
  if (utc) {
    const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(utc) ? utc : `${utc}Z`;
    const timestamp = Date.parse(withZone.replace(" ", "T"));
    if (Number.isFinite(timestamp)) {
      return { iso: new Date(timestamp).toISOString(), timestamp };
    }
  }

  return { iso: raw ?? utc ?? "", timestamp: Number.NaN };
}

function toEvent(
  event: Track123Event,
): { event: TrackingEvent; timestamp: number } | null {
  const description =
    event.eventDetailTranslation?.trim() || event.eventDetail?.trim();
  const { iso, timestamp } = parseTrack123Date(event);

  // ไม่มีทั้งคำบรรยายและเวลา ถือว่าไม่มีสาระพอจะแสดง
  if (!description && !iso) return null;

  return {
    event: {
      time: iso,
      location: event.address?.trim() ?? "",
      description: description || "อัปเดตสถานะ",
    },
    timestamp,
  };
}

/** รวมเหตุการณ์จากขนส่งต้นทางและขนส่งช่วงสุดท้าย แล้วตัดรายการซ้ำออก */
function collectEvents(accepted: Track123Accepted): Track123Event[] {
  return [
    ...(accepted.localLogisticsInfo?.trackingDetails ?? []),
    ...(accepted.lastMileInfo?.trackingDetails ?? []),
  ].filter((event): event is Track123Event => event !== null && event !== undefined);
}

function toTrackingResult(
  trackingNumber: string,
  accepted: Track123Accepted,
): TrackingResult {
  const seen = new Set<string>();
  const pairs = collectEvents(accepted)
    .map(toEvent)
    .filter((pair) => pair !== null)
    .filter((pair) => {
      const key = `${pair.event.time}|${pair.event.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // เวลาที่แปลงไม่ได้ถูกดันไปต้นแถว เพื่อไม่ให้ไปแย่งเป็น "ล่าสุด"
    .sort(
      (a, b) =>
        (Number.isFinite(a.timestamp) ? a.timestamp : -Infinity) -
        (Number.isFinite(b.timestamp) ? b.timestamp : -Infinity),
    );

  const transitStatus = accepted.transitStatus?.trim() ?? "";
  const status = TRANSIT_STATUS_MAP[transitStatus] ?? "pending";

  // ชื่อขนส่งจริงที่ Track123 ตรวจจับได้ (เช่น Flash Express) ไม่ใช่ชื่อ Track123 เอง
  const detectedName =
    accepted.lastMileInfo?.courierNameEN?.trim() ||
    accepted.localLogisticsInfo?.courierNameEN?.trim() ||
    accepted.lastMileInfo?.courierNameCN?.trim() ||
    accepted.localLogisticsInfo?.courierNameCN?.trim();
  const detectedCode =
    accepted.lastMileInfo?.courierCode?.trim() ||
    accepted.localLogisticsInfo?.courierCode?.trim();

  const events = pairs.map((pair) => pair.event);
  const latest = pairs.at(-1);

  return {
    trackingNumber,
    // ถ้าตรวจไม่เจอว่าเป็นขนส่งเจ้าไหน อย่างน้อยก็บอกว่ามาจาก Track123
    carrierName: detectedName || CARRIER_NAME,
    carrierCode: detectedCode || CARRIER_CODE,
    status,
    // Track123 ส่งคำบรรยายมาเป็นภาษาอังกฤษ จึงใช้ข้อความสถานะภาษาไทยของเราแทน
    statusText: TRACKING_STATUS_TEXT[status],
    lastUpdated: latest?.event.time ?? null,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * Track
 * ------------------------------------------------------------------ */

/**
 * ติดตามพัสดุ 1 ชิ้นผ่าน Track123 แล้วแปลงผลเป็นรูปแบบกลาง TrackingResult
 *
 * ทุกความผิดพลาดถูกโยนเป็น CarrierError ที่มี code ระบุสาเหตุ — ไม่มี error ดิบหลุดออกไป
 */
export async function track(trackingNumber: string): Promise<TrackingResult> {
  const trackNo = normalizeTrackingNumber(trackingNumber ?? "");

  if (!/^[A-Z0-9]{6,40}$/.test(trackNo)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  const response = await postJson("/track/query-realtime", {
    trackNo,
    // ไม่ระบุ courierCode เพื่อให้ Track123 ตรวจจับขนส่งให้เอง
    lang: "th",
  });

  const payload = await readJson<Track123Response>(response);

  if (!response.ok || payload?.code !== SUCCESS_CODE) {
    throw toCarrierError(response.status, payload);
  }

  const accepted = payload.data?.accepted;

  if (
    !accepted ||
    accepted.transitStatus?.trim() === NO_RECORD_TRANSIT_STATUS ||
    accepted.trackingStatus?.trim() === NO_RECORD_QUERY_STATUS
  ) {
    throw new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
      { debugMessage: `Track123 ไม่มีข้อมูลของเลข ${trackNo}` },
    );
  }

  return toTrackingResult(trackNo, accepted);
}

/** adapter object สำหรับให้ส่วนอื่นเรียกใช้แบบเดียวกันทุกขนส่ง */
export const track123: CarrierAdapter = {
  carrierCode: CARRIER_CODE,
  carrierName: CARRIER_NAME,
  track,
};
