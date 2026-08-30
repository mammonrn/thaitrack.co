/**
 * Adapter ของ "Track123" — ตัวรวม API ติดตามพัสดุหลายร้อยขนส่งทั่วโลก
 * ใช้เป็นตัวสำรองเมื่อไปรษณีย์ไทยไม่รู้จักเลขพัสดุนั้น
 *
 * เอกสาร: https://docs.track123.com/
 * ใช้ endpoint Instant Tracking (query-realtime) เพราะยิงเลขเดียวได้จบในครั้งเดียว
 * ไม่ต้อง register เลขไว้ก่อน และตรวจจับขนส่งให้อัตโนมัติเมื่อไม่ได้ระบุ courierCode
 *
 * ข้อจำกัดของ endpoint นี้: กิน quota 1 หน่วยต่อครั้ง และยิงได้ 5 ครั้ง/วินาที
 * เกินแล้วจะได้ code A0706 กลับมา ทุกการยิงจากไฟล์นี้จึงต้องผ่าน callTrack123()
 * ใน ./track123-gateway ซึ่งคุมคิว ลองใหม่เมื่อชนลิมิต และเขียน log ให้ครบ
 * — ห้ามเรียก postJson() ตรงๆ จากที่อื่นโดยข้ามประตูนั้น
 *
 * API key อ่านจาก process.env.TRACK123_API_KEY เท่านั้น — ห้าม hardcode
 */

import { callTrack123 } from "./track123-gateway";
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

export interface Track123Event {
  address?: string | null;
  eventTime?: string | null;
  eventTimeZeroUTC?: string | null;
  timezone?: string | null;
  eventDetail?: string | null;
  eventDetailTranslation?: string | null;
}

export interface Track123LogisticsInfo {
  courierCode?: string | null;
  courierNameEN?: string | null;
  courierNameCN?: string | null;
  trackingDetails?: Track123Event[] | null;
}

export interface Track123Accepted {
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
  // ติด code ดิบไปกับ error ทุกตัวที่มี เพื่อให้ log ของ gateway ชี้สาเหตุได้ตรงๆ
  // ว่าเป็น A0706 (ยิงถี่) หรือ B0210 (quota หมด) ซึ่งแก้คนละทางกัน
  const upstreamCode = code === "" ? undefined : code;

  if (httpStatus === 401 || httpStatus === 403 || AUTH_CODES.has(code)) {
    return new CarrierError(
      "auth_failed",
      "ระบบเชื่อมต่อ Track123 ไม่ผ่านการยืนยันตัวตน กรุณาแจ้งผู้ดูแลระบบ",
      { debugMessage: `เรียก Track123 ไม่ผ่านสิทธิ์ (${detail})`, upstreamCode },
    );
  }

  if (httpStatus === 429 || RATE_LIMIT_CODES.has(code)) {
    return new CarrierError(
      "rate_limited",
      "คิวค้นหาหนาแน่น ระบบลองใหม่ให้อัตโนมัติแล้วแต่ยังไม่สำเร็จ",
      {
        debugMessage: `Track123 จำกัดอัตราการเรียกหรือ quota หมด (${detail})`,
        upstreamCode,
      },
    );
  }

  if (BAD_REQUEST_CODES.has(code)) {
    return new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      { debugMessage: `Track123 ปฏิเสธพารามิเตอร์ (${detail})`, upstreamCode },
    );
  }

  return new CarrierError(
    "upstream_error",
    "ระบบ Track123 ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
    { debugMessage: `เรียก Track123 ไม่สำเร็จ (${detail})`, upstreamCode },
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
  const rawDescription =
    event.eventDetailTranslation?.trim() || event.eventDetail?.trim();
  const description =
    rawDescription === undefined ? undefined : cleanEventText(rawDescription);
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

/* ------------------------------------------------------------------ *
 * ทำความสะอาดข้อความเหตุการณ์
 *
 * ขนส่งบางเจ้า (พบกับ Flash Express) ส่งรหัสภายในปนมากับข้อความที่ตั้งใจให้คนอ่าน
 * ผู้ใช้ทั่วไปไม่ควรเห็นรหัสพวกนี้ เช่น
 *   "DELIVERY_TICKET_CREATION_SCAN,พัสดุของคุณกำลังจัดส่งโดยแฟลช"
 *   "ถูกส่งต่อพัสดุจากสาขา08 NO4_HUB-เชียงราย"
 * ------------------------------------------------------------------ */

/**
 * รหัส event ภายในที่นำหน้าข้อความแล้วคั่นด้วยจุลภาค
 *
 * บังคับให้เป็นตัวพิมพ์ใหญ่/ตัวเลข/ขีดล่างล้วน และยาวอย่างน้อย 4 ตัว เพื่อไม่ให้
 * ไปตัดคำย่อสั้นๆ ที่เป็นเนื้อหาจริง (เช่น "USA, ...") ข้อความภาษาไทยไม่มีทาง
 * ขึ้นต้นด้วยรูปแบบนี้อยู่แล้ว
 */
const EVENT_CODE_PREFIX = /^[A-Z][A-Z0-9_]{3,}\s*,\s*/;

/**
 * รหัสสาขาภายในที่แทรกกลางประโยค เช่น "08 NO4_HUB-" ใน "สาขา08 NO4_HUB-เชียงราย"
 *
 * สัญญาณที่ชี้ชัดคือรูปแบบ ตัวพิมพ์ใหญ่_ตัวพิมพ์ใหญ่ ตามด้วยขีด ซึ่งไม่ปรากฏใน
 * ข้อความภาษาไทยปกติ ส่วนเลขนำหน้ามีบ้างไม่มีบ้างจึงเขียนเป็นทางเลือก
 */
const INTERNAL_BRANCH_CODE = /\d*\s*[A-Z][A-Z0-9]*_[A-Z0-9]+-/g;

/** ตัดรหัสภายในของขนส่งออก ให้เหลือแต่ข้อความที่คนอ่านรู้เรื่อง */
export function cleanEventText(raw: string): string {
  const cleaned = raw
    .replace(EVENT_CODE_PREFIX, "")
    .replace(INTERNAL_BRANCH_CODE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // ถ้าทำความสะอาดแล้วไม่เหลืออะไรเลย แปลว่าข้อความทั้งก้อนเป็นรหัส
  // คืนของเดิมดีกว่าปล่อยให้ว่าง ผู้ใช้จะได้ยังเห็นว่ามีเหตุการณ์เกิดขึ้น
  return cleaned === "" ? raw.trim() : cleaned;
}

/* ------------------------------------------------------------------ *
 * อ่านสถานะจากข้อความเหตุการณ์
 * ------------------------------------------------------------------ */

/** คำที่บอกว่าการนำจ่ายมีปัญหา ต้องตรวจก่อนคำว่าสำเร็จเสมอ */
const FAILURE_WORDS =
  /ไม่สำเร็จ|ไม่สามารถ|ตีกลับ|ส่งคืน|ปฏิเสธ|เสียหาย|สูญหาย|failed|unsuccessful|returned|refused/i;

/** คำที่บอกว่าผู้รับได้รับพัสดุแล้วจริง */
const DELIVERED_WORDS =
  /เซ็นรับ|รับพัสดุเรียบร้อย|นำจ่ายสำเร็จ|จัดส่งสำเร็จ|ส่งสำเร็จ|ได้รับพัสดุแล้ว|delivered|signed/i;

/**
 * เดาสถานะจากข้อความเหตุการณ์ คืน null เมื่อไม่มั่นใจ
 *
 * ต้องตรวจคำที่บอกความล้มเหลวก่อน เพราะข้อความอย่าง "ไม่สามารถเซ็นรับพัสดุ"
 * มีคำว่า "เซ็นรับ" อยู่ด้วย ถ้าตรวจสลับลำดับจะอ่านเป็นส่งสำเร็จ
 */
function statusFromEventText(text: string): TrackingStatus | null {
  if (FAILURE_WORDS.test(text)) return "exception";
  if (DELIVERED_WORDS.test(text)) return "delivered";
  return null;
}

/** รวมเหตุการณ์จากขนส่งต้นทางและขนส่งช่วงสุดท้าย แล้วตัดรายการซ้ำออก */
function collectEvents(accepted: Track123Accepted): Track123Event[] {
  return [
    ...(accepted.localLogisticsInfo?.trackingDetails ?? []),
    ...(accepted.lastMileInfo?.trackingDetails ?? []),
  ].filter((event): event is Track123Event => event !== null && event !== undefined);
}

/**
 * แปลงข้อมูลดิบจาก Track123 เป็นรูปแบบกลาง
 *
 * export ไว้เพื่อให้เทสต์เรียกตรงได้โดยไม่ต้องยิง API จริง
 */
export function toTrackingResult(
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

  const events = pairs.map((pair) => pair.event);
  const latest = pairs.at(-1);

  const transitStatus = accepted.transitStatus?.trim() ?? "";
  const headlineStatus = TRANSIT_STATUS_MAP[transitStatus] ?? "pending";

  // transitStatus ตามหลังไทม์ไลน์ได้ พบกับ Flash Express ที่นำจ่ายไม่สำเร็จรอบแรก
  // แล้วสำเร็จรอบถัดมา แต่ transitStatus ยังค้างเป็น ABNORMAL อยู่ ผลคือหัวการ์ด
  // ขึ้น "มีปัญหาในการนำจ่าย" ทั้งที่เหตุการณ์บนสุดบอกว่าเซ็นรับเรียบร้อยแล้ว
  //
  // เหตุการณ์ล่าสุดคือข้อมูลที่ใหม่ที่สุดเสมอ ถ้าอ่านออกชัดเจนจึงให้ถือตามนั้น
  // ถ้าอ่านไม่ออก (คืน null) ค่อยกลับไปใช้ transitStatus ตามเดิม
  const status =
    (latest === undefined
      ? null
      : statusFromEventText(latest.event.description)) ?? headlineStatus;

  // ชื่อขนส่งจริงที่ Track123 ตรวจจับได้ (เช่น Flash Express) ไม่ใช่ชื่อ Track123 เอง
  const detectedName =
    accepted.lastMileInfo?.courierNameEN?.trim() ||
    accepted.localLogisticsInfo?.courierNameEN?.trim() ||
    accepted.lastMileInfo?.courierNameCN?.trim() ||
    accepted.localLogisticsInfo?.courierNameCN?.trim();
  const detectedCode =
    accepted.lastMileInfo?.courierCode?.trim() ||
    accepted.localLogisticsInfo?.courierCode?.trim();

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
function toTrackNo(trackingNumber: string): string {
  const trackNo = normalizeTrackingNumber(trackingNumber ?? "");

  if (!/^[A-Z0-9]{6,40}$/.test(trackNo)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  return trackNo;
}

/**
 * ยิงถาม Track123 หนึ่งครั้ง
 *
 * ไม่ส่ง courierCode = ให้ Track123 ตรวจจับขนส่งเอง
 * ส่ง courierCode = บังคับให้ถามขนส่งเจ้านั้นตรงๆ
 */
async function query(
  trackNo: string,
  courierCode?: string,
): Promise<TrackingResult> {
  // ทุกอย่างในนี้ถูกห่อด้วย callTrack123 เพื่อให้ผ่านคิวและถูก log เสมอ
  // รวมถึงรอบที่ถูกลองใหม่หลังชนลิมิตด้วย (gateway เข้าคิวใหม่ให้ทุกรอบ)
  return callTrack123({ trackNo, courierCode }, async () => {
    const response = await postJson("/track/query-realtime", {
      trackNo,
      ...(courierCode === undefined ? {} : { courierCode }),
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
        {
          debugMessage: `Track123 ไม่มีข้อมูลของเลข ${trackNo}${
            courierCode === undefined
              ? " (ตรวจจับขนส่งอัตโนมัติ)"
              : ` เมื่อระบุขนส่งเป็น ${courierCode}`
          }`,
        },
      );
    }

    return toTrackingResult(trackNo, accepted);
  });
}

/**
 * ติดตามพัสดุโดยให้ Track123 ตรวจจับขนส่งเอง
 *
 * ทุกความผิดพลาดถูกโยนเป็น CarrierError ที่มี code ระบุสาเหตุ
 */
export async function track(trackingNumber: string): Promise<TrackingResult> {
  return query(toTrackNo(trackingNumber));
}

/** ติดตามพัสดุโดยบังคับว่าเป็นขนส่งเจ้าไหน ข้ามการตรวจจับอัตโนมัติ */
export async function trackWithCourier(
  trackingNumber: string,
  courierCode: string,
): Promise<TrackingResult> {
  return query(toTrackNo(trackingNumber), courierCode);
}

/**
 * ขนส่งที่การตรวจจับอัตโนมัติของ Track123 เดาผิดจนตอบว่าไม่พบ
 *
 * เรียงจากที่เจอปัญหาบ่อยที่สุดก่อน เพราะ resolveTracking ลองตามลำดับนี้แล้วหยุด
 * เมื่อครบเพดาน การเพิ่มเจ้าใหม่ในอนาคตทำได้ด้วยการเติมรหัสต่อท้ายรายการนี้
 *
 * shopee-xpress-th คือ SPX / Shopee Xpress ประเทศไทย
 * ห้ามสับสนกับ "spx" ซึ่งเป็นคนละบริษัท (SPX Express / SpeedX ในต่างประเทศ)
 * ยืนยันแล้วว่าเลขของ Shopee ที่ auto-detect เดาเป็น Flash Express จนได้
 * NO_RECORD กลับมาถูกต้องเมื่อระบุรหัสนี้
 */
export const RETRY_COURIER_CODES: readonly string[] = ["shopee-xpress-th"];

/** adapter object สำหรับให้ส่วนอื่นเรียกใช้แบบเดียวกันทุกขนส่ง */
export const track123: CarrierAdapter = {
  carrierCode: CARRIER_CODE,
  carrierName: CARRIER_NAME,
  track,
  trackWithCourier,
  retryCourierCodes: RETRY_COURIER_CODES,
};
