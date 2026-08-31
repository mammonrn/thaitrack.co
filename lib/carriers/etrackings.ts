/**
 * Adapter ของ "ETrackings" — หนึ่งในสองเจ้าที่ระบบสลับใช้ตามความถนัด
 *
 * เอกสาร: https://apps.etrackings.com/docs/api-reference
 *   /docs/trackings     โครงสร้าง response
 *   /docs/statuses      รหัสสถานะ 5 ตัว
 *   /docs/errors        รหัส HTTP และ meta.code
 *   /docs/couriers/all  รหัสขนส่ง
 *
 * ⚠️ ข้อจำกัดสองข้อที่กำหนดรูปร่างของไฟล์นี้ทั้งหมด:
 *
 *   1. **มีเพดานต่อเดือน** (แผนฟรี 50 ครั้ง แผนที่จ่ายเงินมากกว่านั้น ตั้งได้
 *      ผ่าน ETRACKINGS_MONTHLY_CALL_LIMIT) จึงต้องนับทุกครั้งที่เรียก แล้วให้
 *      lib/carriers/resolve.ts เอียงไปใช้อีกเจ้าเมื่อใกล้เพดาน
 *
 *   2. **POST /tracks/find บังคับให้ระบุ courier** ต่างจาก Track123 ที่ตรวจจับ
 *      ขนส่งให้เอง เราจึงต้องรู้ว่าเป็นขนส่งเจ้าไหน "ก่อน" ยิง และด้วยโควตา
 *      ระดับนี้ การไล่เดาทีละเจ้าเป็นไปไม่ได้เลย — เดาผิดหนึ่งครั้งคือโควตา
 *      หายไป 2% ของทั้งเดือน
 *
 *      ผลคือ adapter นี้ทำงานได้เฉพาะเลขที่เรารู้ขนส่งอยู่แล้ว (จากตาราง prefix
 *      ใน lib/carriers/courier-prefix.ts หรือจากผู้เรียกที่ระบุมา) ถ้าไม่รู้
 *      จะปฏิเสธตรงๆ ไม่ยิงมั่ว การขยายความครอบคลุมทำได้ด้วยการเติมแถวใน
 *      ตาราง prefix ซึ่งเป็นที่เดียวกับที่ Track123 ใช้อยู่แล้ว
 *
 * ข้อมูลที่ได้กลับมาเป็นภาษาไทยอยู่แล้ว (ส่ง Accept-Language: th เสมอ) จึงไม่
 * ต้องผ่านพจนานุกรมแปล — ดู lib/status-th.ts ที่ปล่อยข้อความไทยผ่านตามเดิม
 *
 * ข้อได้เปรียบที่ทำให้เจ้านี้ถูกเลือกก่อนเมื่อ prefix ฟันธงได้: ข้อความไทยล้วน
 * และ **ที่อยู่เต็มของสาขาที่ห้อยท้าย description มา** ซึ่งเป็นวัตถุดิบเดียว
 * ที่ทำให้เติมพิกัดสาขาอัตโนมัติได้ (ดู splitDescription และ lib/branch-harvest.ts)
 *
 * API key อ่านจาก env เท่านั้น — ห้าม hardcode และห้ามขึ้นต้นด้วย NEXT_PUBLIC_
 */

import { CircuitBreaker } from "../circuit-breaker";
import { countProviderCall, readQuota } from "../provider-usage";
import { courierFromPrefix } from "./courier-prefix";
import {
  CarrierError,
  TRACKING_STATUS_TEXT,
  type CarrierAdapter,
  type ShipmentDetails,
  type TrackingEvent,
  type TrackingResult,
  type TrackingStatus,
} from "./types";

const API_BASE = "https://api.etrackings.com/api/v3";
const CARRIER_CODE = "etrackings";
const CARRIER_NAME = "ETrackings";

/** สั้นกว่าของ Track123 เพราะนี่คือทางสำรองที่ถูกใช้ตอนผู้ใช้รอนานอยู่แล้ว */
const REQUEST_TIMEOUT_MS = 12_000;

/** ชื่อตัวแปร env — ทั้งคู่เป็นความลับ ห้ามขึ้นต้นด้วย NEXT_PUBLIC_ */
export const API_KEY_VAR = "ETRACKINGS_API_KEY";
export const KEY_SECRET_VAR = "ETRACKINGS_KEY_SECRET";

/**
 * รหัสสถานะ 5 ตัวของ ETrackings map เข้าสถานะกลางของเรา
 * (https://apps.etrackings.com/docs/statuses)
 *
 * ON_OTHER_STATUS เป็นถุงรวมของทุกอย่างระหว่างทาง — เอกสารยกตัวอย่างว่า
 * "อยู่ระหว่างขนส่ง" กับ "ถึง hub แล้ว" จึงตรงกับ in_transit ของเรา
 */
const STATUS_MAP: Record<string, TrackingStatus> = {
  ON_PICKED_UP: "in_transit",
  ON_SHIPPING: "out_for_delivery",
  ON_DELIVERED: "delivered",
  ON_UNABLE_TO_SEND: "exception",
  ON_OTHER_STATUS: "in_transit",
};

/**
 * รหัสขนส่งของเรา → รหัสของ ETrackings
 * (https://apps.etrackings.com/docs/couriers/all)
 *
 * ฝั่งซ้ายคือรหัสที่ระบบเราใช้อยู่ ซึ่งบางตัวตรงกับของ Track123 บางตัวเป็น
 * ของเราเอง เติมแถวใหม่ได้เลยเมื่อรองรับขนส่งเพิ่ม
 */
const COURIER_MAP: Record<string, string> = {
  "flash-express": "flash-express",
  "kerry-express": "kex-express",
  "kex-express": "kex-express",
  "jt-express": "jt-express",
  "jnt-express": "jt-express",
  "thailand-post": "thailand-post",
  "shopee-xpress-th": "shopee-express",
  "shopee-express": "shopee-express",
  "best-express": "best-express",
  "nim-express": "nim-express",
  "inter-express": "inter-express",
  "dhl-ecommerce": "dhl-ecommerce",
};

/** ชื่อไทยของขนส่งที่ ETrackings ตอบกลับมา ใช้เมื่อ response ไม่ได้บอกชื่อมา */
const COURIER_NAME_TH: Record<string, string> = {
  "flash-express": "Flash Express",
  "kex-express": "Kerry Express",
  "jt-express": "J&T Express",
  "thailand-post": "ไปรษณีย์ไทย",
  "shopee-express": "Shopee Xpress",
  "best-express": "BEST Express",
  "nim-express": "Nim Express",
  "inter-express": "Inter Express",
  "dhl-ecommerce": "DHL eCommerce",
};

/* ------------------------------------------------------------------ *
 * รูปแบบข้อมูลที่ ETrackings ส่งกลับมา (เอาเฉพาะฟิลด์ที่ใช้)
 * ------------------------------------------------------------------ */

export interface ETrackingsDetail {
  sender?: string | null;
  recipient?: string | null;
  originCity?: string | null;
  originProvince?: string | null;
  destinationCity?: string | null;
  destinationProvince?: string | null;
  signer?: string | null;
  dueDate?: string | null;
  cashOnDelivery?: string | null;
  isPayCashOnDelivery?: boolean | null;
  deliveryStaffName?: string | null;
  deliveryStaffPhoneNumber?: string | null;
  deliveryType?: string | null;
}

export interface ETrackingsDetailEntry {
  dateTime?: string | null;
  date?: string | null;
  time?: string | null;
  status?: string | null;
  description?: string | null;
}

export interface ETrackingsTimeline {
  date?: string | null;
  details?: ETrackingsDetailEntry[] | null;
}

export interface ETrackingsData {
  trackingNo?: string | null;
  courier?: string | null;
  courierKey?: string | null;
  status?: string | null;
  currentStatus?: string | null;
  detail?: ETrackingsDetail | null;
  timelines?: ETrackingsTimeline[] | null;
}

interface ETrackingsResponse {
  meta?: { code?: number | null; message?: string | null } | null;
  data?: ETrackingsData | null;
}

/* ------------------------------------------------------------------ *
 * โควตาและ circuit breaker
 * ------------------------------------------------------------------ */

/**
 * ตัวนับโควตาย้ายไปอยู่ที่ lib/provider-usage.ts แล้ว
 *
 * ของเดิมนับใน memory ของโปรเซสเดียว ตัวเลขจึงหายทุก restart และนับแยกกัน
 * ถ้ามีหลาย instance ซึ่งพอ ETrackings กลายเป็นทางหลักที่ใช้จริงทุกวัน
 * (ไม่ใช่ทางสำรองที่แทบไม่ถูกแตะ) ตัวเลขแบบนั้นใช้ตัดสินใจอะไรไม่ได้เลย
 */
const PROVIDER = "etrackings" as const;

/**
 * เกณฑ์ของ circuit breaker
 *
 * ไวกว่าของ Track123 (5 ครั้ง) โดยตั้งใจ เพราะทุกครั้งที่ยิงแล้วพังคือโควตา
 * ที่จ่ายไปโดยไม่ได้อะไรกลับมา สามครั้งติดกันพอจะบอกได้แล้วว่าไม่ใช่ความซวย
 * รายครั้ง และการรีบตัดวงจรทำให้ resolve สลับไปใช้อีกเจ้าได้ทันที
 *
 * พักนานกว่า (60 วินาที) ด้วยเหตุผลเดียวกัน — การลองแตะดูแต่ละครั้งมีราคา
 */
export const BREAKER_FAILURE_THRESHOLD = 3;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_COOLDOWN_MS = 60_000;

export const etrackingsBreaker = new CircuitBreaker({
  name: PROVIDER,
  failureThreshold: BREAKER_FAILURE_THRESHOLD,
  windowMs: BREAKER_WINDOW_MS,
  cooldownMs: BREAKER_COOLDOWN_MS,
});

/**
 * error ที่นับว่า "ปลายทางมีปัญหา"
 *
 * เกณฑ์เดียวกับของ Track123 — ไม่รวม not_found กับ invalid_tracking_number
 * เพราะสองอันนั้นคือคำตอบที่ถูกต้องของปลายทางที่ทำงานปกติดี
 */
const BREAKER_FAILURES: ReadonlySet<string> = new Set([
  "rate_limited",
  "network_error",
  "upstream_error",
  "auth_failed",
]);


/* ------------------------------------------------------------------ *
 * การเรียก API
 * ------------------------------------------------------------------ */

interface Credentials {
  apiKey: string;
  keySecret: string;
}

/** อ่าน credential — null เมื่อยังไม่ได้ตั้งค่า (ไม่ throw เพราะเป็นของเสริม) */
export function readCredentials(): Credentials | null {
  const apiKey = process.env.ETRACKINGS_API_KEY?.trim() ?? "";
  const keySecret = process.env.ETRACKINGS_KEY_SECRET?.trim() ?? "";

  if (apiKey === "" || keySecret === "") return null;
  return { apiKey, keySecret };
}

/** ตั้งค่าครบพร้อมใช้งานหรือยัง — ผู้เรียกใช้ตัดสินว่าจะข้าม adapter นี้ไหม */
export function isConfigured(): boolean {
  return readCredentials() !== null;
}

/** แปลง meta.code / HTTP status เป็น CarrierError ที่สื่อสาเหตุ */
function toCarrierError(
  httpStatus: number,
  payload: ETrackingsResponse | null,
): CarrierError {
  const code = payload?.meta?.code ?? httpStatus;
  const detail = `HTTP ${httpStatus}, meta.code=${code}: ${payload?.meta?.message ?? "ไม่มีข้อความตอบกลับ"}`;
  const upstreamCode = String(code);

  if (code === 401 || code === 403) {
    return new CarrierError(
      "auth_failed",
      "ระบบเชื่อมต่อผู้ให้บริการสำรองไม่ผ่านการยืนยันตัวตน กรุณาแจ้งผู้ดูแลระบบ",
      { debugMessage: `ETrackings ปฏิเสธสิทธิ์ (${detail})`, upstreamCode },
    );
  }

  // 404 ของ ETrackings แปลว่า "URI ผิด หรือ resource ไม่มีอยู่" ซึ่งรวมกรณี
  // ชื่อขนส่งผิดด้วย ไม่ใช่แค่ "ไม่พบเลขพัสดุ" จึงถือเป็นไม่พบไปก่อน
  // แล้วให้ debugMessage เป็นตัวบอกผู้ดูแลว่าเกิดจากอะไรกันแน่
  if (code === 404) {
    return new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
      { debugMessage: `ETrackings ไม่มีข้อมูล (${detail})`, upstreamCode },
    );
  }

  if (code === 429) {
    return new CarrierError(
      "rate_limited",
      "คิวค้นหาหนาแน่น ระบบลองใหม่ให้อัตโนมัติแล้วแต่ยังไม่สำเร็จ",
      {
        debugMessage: `ETrackings จำกัดอัตราการเรียก (${detail})`,
        upstreamCode,
      },
    );
  }

  if (code === 400) {
    return new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      { debugMessage: `ETrackings ปฏิเสธพารามิเตอร์ (${detail})`, upstreamCode },
    );
  }

  return new CarrierError(
    "upstream_error",
    "ระบบผู้ให้บริการสำรองขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
    { debugMessage: `เรียก ETrackings ไม่สำเร็จ (${detail})`, upstreamCode },
  );
}

/* ------------------------------------------------------------------ *
 * การแปลงข้อมูลเป็นรูปแบบกลาง
 * ------------------------------------------------------------------ */

function normalizeTrackingNumber(input: string): string {
  return (input ?? "").replace(/[\s-]/g, "").toUpperCase();
}

/** ตัดช่องว่างแล้วคืน null ถ้าว่าง — ฟิลด์ส่วนใหญ่ของ ETrackings เป็น "" เมื่อไม่มีค่า */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * เวลาที่ ETrackings ส่งมา → ISO 8601
 *
 * ตัวอย่างในเอกสารแสดงเป็น "2021-02-10T13: 59: 56+07: 00" ซึ่งมีช่องว่างหลัง
 * โคลอน — เกือบแน่นอนว่าเป็นผลจากตัวจัดรูปแบบโค้ดในหน้าเอกสาร ไม่ใช่ค่าจริง
 * แต่การตัดช่องว่างรอบโคลอนทิ้งก่อนแปลงราคาถูกมาก และทำให้อ่านได้ทั้งสองแบบ
 */
export function parseETrackingsTime(
  entry: ETrackingsDetailEntry,
): { iso: string; timestamp: number } | null {
  const raw = text(entry.dateTime)?.replace(/\s*:\s*/g, ":");

  if (raw) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) {
      return { iso: new Date(timestamp).toISOString(), timestamp };
    }
  }

  // ไม่มี dateTime ก็ประกอบจาก date + time ที่ส่งมาแยกกัน (เวลาไทยเสมอ)
  const date = text(entry.date);
  const time = text(entry.time)?.replace(/\s*:\s*/g, ":");
  if (date) {
    const iso = `${date}T${time ?? "00:00"}:00+07:00`;
    const timestamp = Date.parse(iso);
    if (Number.isFinite(timestamp)) {
      return { iso: new Date(timestamp).toISOString(), timestamp };
    }
  }

  return null;
}

/**
 * รูปร่างของ "สถานที่" ที่ห้อยท้าย description
 *
 * ตัวอย่างจริงจากเอกสาร:
 *   "พัสดุของคุณอยู่ระหว่างขนส่ง - ศูนย์คัดแยกสินค้าสมุทรสาคร, กรุงเทพมหานคร"
 *   "เคอรี่เข้ารับพัสดุแล้ว"                    ← ไม่มีสถานที่ต่อท้าย
 *
 * บังคับให้ส่วนท้ายต้องเป็น "ที่หนึ่ง, จังหวัดหนึ่ง" จริงๆ คือมีคอมมาเดียว
 * ทั้งสองข้างไม่ว่าง ไม่มีตัวเลข และไม่ยาวเกินไป ถ้าไม่เข้ารูปนี้จะไม่แยก
 * แล้วปล่อยข้อความทั้งก้อนไว้เหมือนเดิม — เดาผิดแล้วตัดเนื้อความทิ้งแย่กว่า
 * ปล่อยให้สถานที่ติดอยู่ในประโยค
 */
const LOCATION_SUFFIX = /^[^\d,]{2,40},\s*[^\d,]{2,40}$/;

/** เวลาที่นำหน้าข้อความ เช่น "13:59 " — ซ้ำกับฟิลด์ time จึงตัดทิ้ง */
const LEADING_TIME = /^\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s+/;

/**
 * รูปแบบที่ห้อย "ที่อยู่เต็มของสาขา" มาท้ายข้อความ
 *
 * ตัวอย่างจริงจาก Shopee Xpress:
 *   "09:28 พัสดุถึงสาขาปลายทาง: ACRAI-B - เมืองเชียงราย - อยู่ที่ TH จังหวัด
 *    เชียงราย 57000 อำเภอเมืองเชียงราย 639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมือง
 *    เชียงราย จังหวัดเชียงราย 57100"
 *
 * นี่คือกุญแจของการเติมพิกัดสาขาอัตโนมัติ — รหัสสาขาอย่าง ACRAI-B ไม่มีทาง
 * geocode ได้ แต่ที่อยู่ที่ห้อยมาด้วยนั้นได้
 *
 * บังคับให้ครบทั้งสามส่วน (หัวข้อความ : สถานที่ - อยู่ที่ ที่อยู่) ถ้าขาดส่วนใด
 * จะไม่เข้ารูปแล้วตกไปใช้ตรรกะเดิม — ขนส่งแต่ละเจ้าเขียนไม่เหมือนกัน การเดา
 * จากรูปที่ไม่ครบมีแต่จะได้ที่อยู่ผิดมาเขียนทับตารางที่ทั้งระบบเชื่อว่าถูก
 */
const BRANCH_WITH_ADDRESS = /^(.*?):\s*(.+?)\s+[-–—]\s*อยู่ที่\s+(.+)$/;

/** คำที่นำหน้าส่วนของบ้านเลขที่/หมู่/ถนน ซึ่งควรติดไปกับที่อยู่ด้วย */
const HOUSE_PART = /^(?:หมู่|ม\.|ซอย|ซ\.|ถนน|ถ\.|เลขที่|\d[\d/–—-]*)/;

/** ตัวคั่นระดับตำบล — จุดตั้งต้นของที่อยู่ที่ใช้หาพิกัดได้จริง */
const SUBDISTRICT = /^(?:ตำบล|แขวง)./;

/** ต้องมีจังหวัดหรือรหัสไปรษณีย์ ไม่งั้นแคบเกินกว่าจะหาพิกัดถูกที่ */
const HAS_PROVINCE = /จังหวัด|(?<!\d)\d{5}(?!\d)/;

/** ยาวเกินนี้แปลว่าเราแยกผิด ไม่ใช่ที่อยู่ */
const MAX_ADDRESS_LENGTH = 200;

/**
 * ตัดที่อยู่ดิบให้เหลือเฉพาะส่วนที่ใช้หาพิกัดได้ — "" เมื่อไม่มั่นใจ
 *
 * ที่อยู่ดิบที่ขนส่งส่งมามีของซ้ำซ้อนปนอยู่ ("TH จังหวัดเชียงราย 57000
 * อำเภอเมืองเชียงราย" นำหน้าที่อยู่จริงอีกที) ถ้าโยนทั้งก้อนให้ Google
 * ความซ้ำจะดันให้มันตอบเป็นหมุดกลางจังหวัดแทนที่จะเป็นตัวสาขา ซึ่งคือ
 * ปัญหาที่เรากำลังแก้อยู่พอดี
 *
 * จึงตัดจาก "ส่วนบ้านเลขที่ที่นำหน้าตำบล" ไปจนจบข้อความ ได้เป็นที่อยู่ไทย
 * มาตรฐานที่ Google อ่านออก และถ้าหาจุดตั้งต้นไม่เจอจะคืน "" ไม่เดา
 */
export function cleanBranchAddress(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter((token) => token !== "");
  // รหัสประเทศที่นำหน้ามา ("TH") ไม่ได้ช่วยอะไรเพราะเราจำกัด country:TH อยู่แล้ว
  const body = /^[A-Z]{2}$/.test(tokens[0] ?? "") ? tokens.slice(1) : tokens;

  let subdistrict = -1;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    if (SUBDISTRICT.test(body[index])) {
      subdistrict = index;
      break;
    }
  }
  if (subdistrict === -1) return "";

  let start = subdistrict;
  while (start > 0 && HOUSE_PART.test(body[start - 1])) start -= 1;

  const address = body.slice(start).join(" ");
  if (address.length > MAX_ADDRESS_LENGTH) return "";
  return HAS_PROVINCE.test(address) ? address : "";
}

export interface SplitDescription {
  description: string;
  location: string;
  /**
   * ที่อยู่เต็มของสถานที่ในบรรทัดนี้ — "" เมื่อไม่มีหรือแยกไม่ได้แน่
   *
   * ไม่ได้เอาไปแสดงให้ผู้ใช้เห็น มีไว้ให้ lib/branch-harvest.ts เอาไปหาพิกัด
   */
  address: string;
}

/** แยกสถานที่ที่ห้อยท้าย description ออกมา — location เป็น "" เมื่อแยกไม่ได้ */
export function splitDescription(raw: string): SplitDescription {
  const cleaned = raw.trim().replace(LEADING_TIME, "").trim();

  const withAddress = BRANCH_WITH_ADDRESS.exec(cleaned);
  if (withAddress !== null) {
    const head = withAddress[1].trim();
    const location = withAddress[2].trim();

    if (head !== "" && location !== "") {
      return {
        description: head,
        location,
        address: cleanBranchAddress(withAddress[3]),
      };
    }
  }

  const separator = cleaned.lastIndexOf(" - ");
  if (separator === -1) {
    return { description: cleaned, location: "", address: "" };
  }

  const head = cleaned.slice(0, separator).trim();
  const tail = cleaned.slice(separator + 3).trim();

  if (head === "" || !LOCATION_SUFFIX.test(tail)) {
    return { description: cleaned, location: "", address: "" };
  }

  return { description: head, location: tail, address: "" };
}

/** ดึงรายละเอียดการจัดส่งที่มีค่าจริง — ฟิลด์ที่ว่างถูกตัดทิ้งทั้งหมด */
export function toShipmentDetails(
  detail: ETrackingsDetail | null | undefined,
): ShipmentDetails | null {
  if (!detail) return null;

  const cod = text(detail.cashOnDelivery);

  const shipment: ShipmentDetails = {
    originProvince: text(detail.originProvince),
    destinationProvince: text(detail.destinationProvince),
    deliveryStaffName: text(detail.deliveryStaffName),
    dueDate: text(detail.dueDate),
    // "0" แปลว่าไม่มีเก็บเงินปลายทาง ไม่ใช่ยอดศูนย์บาทที่ต้องแสดง
    cashOnDelivery: cod === null || cod === "0" ? null : cod,
  };

  const hasAnything = Object.values(shipment).some((value) => value !== null);
  return hasAnything ? shipment : null;
}

/**
 * แปลงข้อมูลดิบเป็นรูปแบบกลาง
 *
 * timelines ถูกจัดกลุ่มตามวันมาแล้วจากต้นทาง แต่ระบบเราจัดกลุ่มตามสถานที่เอง
 * (lib/timeline-groups.ts) จึงคลี่ออกเป็นรายการเรียงเดี่ยวๆ แล้วปล่อยให้ชั้น
 * แสดงผลจัดกลุ่มตามกติกาเดิม ผลลัพธ์จึงหน้าตาเหมือนขนส่งเจ้าอื่นทุกประการ
 *
 * export ไว้ให้เทสต์เรียกตรงได้โดยไม่ต้องยิง API จริง
 */
export function toTrackingResult(
  trackingNumber: string,
  data: ETrackingsData,
): TrackingResult {
  const pairs: { event: TrackingEvent; timestamp: number }[] = [];

  for (const timeline of data.timelines ?? []) {
    for (const entry of timeline?.details ?? []) {
      if (!entry) continue;

      const raw = text(entry.description);
      if (raw === null) continue;

      const { description, location, address } = splitDescription(raw);
      const parsed = parseETrackingsTime(entry);

      pairs.push({
        event: {
          time: parsed?.iso ?? "",
          location,
          description: description === "" ? "อัปเดตสถานะ" : description,
          ...(address === "" ? {} : { address }),
        },
        // เวลาที่อ่านไม่ได้ถูกดันไปต้นแถว เพื่อไม่ให้ไปแย่งเป็น "ล่าสุด"
        timestamp: parsed?.timestamp ?? Number.NEGATIVE_INFINITY,
      });
    }
  }

  pairs.sort((a, b) => a.timestamp - b.timestamp);

  const events = pairs.map((pair) => pair.event);
  const latest = pairs.at(-1);

  const courierKey = text(data.courierKey) ?? "";
  const status = STATUS_MAP[text(data.status) ?? ""] ?? "in_transit";

  return {
    trackingNumber,
    // ชื่อขนส่งจริงที่ ETrackings บอกมา ไม่ใช่ชื่อ ETrackings เอง
    carrierName:
      text(data.courier) ?? COURIER_NAME_TH[courierKey] ?? CARRIER_NAME,
    carrierCode: courierKey === "" ? CARRIER_CODE : courierKey,
    status,
    statusText: TRACKING_STATUS_TEXT[status],
    lastUpdated: latest?.event.time || null,
    events,
    shipment: toShipmentDetails(data.detail),
  };
}

/* ------------------------------------------------------------------ *
 * Track
 * ------------------------------------------------------------------ */

/**
 * หารหัสขนส่งของ ETrackings สำหรับเลขนี้ — null เมื่อไม่รู้
 *
 * ไม่เดาเด็ดขาด เพราะโควตา 50 ครั้ง/เดือนแปลว่าการเดาผิดหนึ่งครั้งกิน 2%
 * ของทั้งเดือน การเติมตาราง prefix (lib/carriers/courier-prefix.ts) คือทางเดียว
 * ที่ทำให้ adapter นี้ครอบคลุมเลขได้มากขึ้น
 */
export function resolveCourier(
  trackingNumber: string,
  hint?: string,
): string | null {
  const fromHint = hint === undefined ? undefined : COURIER_MAP[hint];
  if (fromHint !== undefined) return fromHint;

  const fromPrefix = courierFromPrefix(trackingNumber);
  if (fromPrefix === null) return null;

  return COURIER_MAP[fromPrefix] ?? null;
}

function toTrackNo(trackingNumber: string): string {
  const trackNo = normalizeTrackingNumber(trackingNumber);

  if (!/^[A-Z0-9]{6,40}$/.test(trackNo)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  return trackNo;
}

/** log หนึ่งบรรทัดต่อหนึ่ง request ที่ออกไปจริง — รูปแบบเดียวกับ [track123] */
function logCall(fields: {
  ts: number;
  trackNo: string;
  courier: string;
  tookMs: number;
  result: string;
  used: number;
  upstream?: string;
}): void {
  const parts = [
    `ts=${fields.ts}`,
    `no=${fields.trackNo}`,
    `courier=${fields.courier}`,
    `took=${fields.tookMs}ms`,
    `result=${fields.result}`,
    `used=${fields.used}/${readQuota(PROVIDER)}`,
  ];
  if (fields.upstream !== undefined) parts.push(`upstream=${fields.upstream}`);

  console.info(`[etrackings] ${parts.join(" ")}`);
}

/**
 * ยิงถาม ETrackings หนึ่งครั้ง
 *
 * ไม่มีการลองใหม่อัตโนมัติเลย แม้แต่ตอนเจอ 429 — ทุกครั้งที่ยิงกินโควตาที่มี
 * เพดานต่อเดือน การลองใหม่จึงแพงเกินกว่าจะคุ้ม และ 429 ของเขาคือ 10 ครั้ง/วินาที
 * ซึ่งเราไม่มีทางไปถึงอยู่แล้ว ถ้าเจอแปลว่ามีอย่างอื่นผิดปกติ การถล่มยิงซ้ำ
 * มีแต่จะแย่ลง
 *
 * circuit breaker ห่ออยู่ชั้นนอกสุด: วงจรเปิดอยู่ = ปฏิเสธทันทีโดยไม่ยิงและ
 * ไม่นับโควตา ผู้เรียก (resolve) จะได้สลับไปใช้อีกเจ้าทันทีโดยไม่ต้องรอ timeout
 */
async function query(
  trackNo: string,
  courier: string,
): Promise<TrackingResult> {
  const credentials = readCredentials();
  if (credentials === null) {
    throw new CarrierError(
      "config_error",
      "ระบบยังไม่ได้ตั้งค่าผู้ให้บริการสำรอง กรุณาลองใหม่ภายหลัง",
      {
        debugMessage: `ไม่พบ environment variable ${API_KEY_VAR} หรือ ${KEY_SECRET_VAR}`,
      },
    );
  }

  const startedAt = Date.now();

  if (!etrackingsBreaker.allows(startedAt)) {
    const snapshot = etrackingsBreaker.snapshot(startedAt);
    throw new CarrierError(
      "upstream_error",
      "ระบบ ETrackings ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
      {
        debugMessage:
          "ข้ามการยิง ETrackings เพราะ circuit breaker เปิดอยู่ " +
          `(เหลืออีก ${snapshot.cooldownRemainingMs}ms ถึงจะลองแตะดู)`,
        upstreamCode: "breaker_open",
      },
    );
  }

  const used = await countProviderCall(PROVIDER, { now: startedAt });

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/tracks/find`, {
      method: "POST",
      headers: {
        "Etrackings-Api-Key": credentials.apiKey,
        "Etrackings-Key-Secret": credentials.keySecret,
        // ขอภาษาไทยเสมอ — ข้อมูลที่ได้จึงพร้อมแสดงโดยไม่ต้องผ่านพจนานุกรมแปล
        "Accept-Language": "th",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ courier, trackingNo: trackNo }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    etrackingsBreaker.recordFailure();
    logCall({
      ts: startedAt,
      trackNo,
      courier,
      tookMs: Date.now() - startedAt,
      result: "network_error",
      used,
    });

    throw new CarrierError(
      "network_error",
      timedOut
        ? "ระบบผู้ให้บริการสำรองตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง"
        : "เชื่อมต่อผู้ให้บริการสำรองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      { cause, debugMessage: "เรียก ETrackings /tracks/find ไม่สำเร็จ" },
    );
  }

  let payload: ETrackingsResponse | null = null;
  try {
    payload = (await response.json()) as ETrackingsResponse;
  } catch {
    payload = null;
  }

  const metaCode = payload?.meta?.code ?? response.status;

  if (!response.ok || metaCode !== 200) {
    const error = toCarrierError(response.status, payload);

    // "ไม่พบเลขนี้" คือคำตอบของปลายทางที่ทำงานปกติ ไม่ใช่ความล้มเหลวของระบบ
    if (BREAKER_FAILURES.has(error.code)) etrackingsBreaker.recordFailure();
    else etrackingsBreaker.recordSuccess();

    logCall({
      ts: startedAt,
      trackNo,
      courier,
      tookMs: Date.now() - startedAt,
      result: error.code,
      used,
      upstream: String(metaCode),
    });
    throw error;
  }

  etrackingsBreaker.recordSuccess();

  const data = payload?.data;
  if (!data || (data.timelines ?? []).length === 0) {
    logCall({
      ts: startedAt,
      trackNo,
      courier,
      tookMs: Date.now() - startedAt,
      result: "not_found",
      used,
    });

    throw new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
      { debugMessage: `ETrackings ไม่มีความเคลื่อนไหวของเลข ${trackNo}` },
    );
  }

  logCall({
    ts: startedAt,
    trackNo,
    courier,
    tookMs: Date.now() - startedAt,
    result: "ok",
    used,
  });

  return toTrackingResult(trackNo, data);
}

/**
 * ติดตามพัสดุผ่าน ETrackings
 *
 * โยน not_found เมื่อเดาขนส่งไม่ได้ เพื่อให้ผู้เรียกไหลต่อไปตามลำดับเดิม
 * (ปลายทางคือข้อความ "ไม่พบเลขนี้" ซึ่งตรงกับความจริง — เราค้นให้ไม่ได้)
 */
export async function track(trackingNumber: string): Promise<TrackingResult> {
  const trackNo = toTrackNo(trackingNumber);
  const courier = resolveCourier(trackNo);

  if (courier === null) {
    throw new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
      {
        debugMessage:
          `ข้ามผู้ให้บริการสำรองสำหรับเลข ${trackNo} เพราะระบุขนส่งไม่ได้ ` +
          "และ ETrackings บังคับให้ระบุขนส่ง (โควตาน้อยเกินกว่าจะไล่เดา) " +
          "— เติมแถวใน lib/carriers/courier-prefix.ts เพื่อให้ครอบคลุมเลขทรงนี้",
      },
    );
  }

  return query(trackNo, courier);
}

/** ติดตามพัสดุโดยระบุขนส่งเจาะจง (รหัสของระบบเรา ไม่ใช่ของ ETrackings) */
export async function trackWithCourier(
  trackingNumber: string,
  courierCode: string,
): Promise<TrackingResult> {
  const trackNo = toTrackNo(trackingNumber);
  const courier = resolveCourier(trackNo, courierCode);

  if (courier === null) {
    throw new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
      {
        debugMessage: `ETrackings ไม่รองรับขนส่ง ${courierCode} (ดู COURIER_MAP)`,
      },
    );
  }

  return query(trackNo, courier);
}

/**
 * เจ้านี้ตามเลขนี้ได้ไหม — ใช้ตัดสินลำดับการยิงใน lib/carriers/resolve.ts
 *
 * "ได้" แปลว่ารู้ว่าเป็นขนส่งเจ้าไหนและ ETrackings รองรับเจ้านั้น ไม่ได้แปลว่า
 * จะเจอข้อมูล — ถ้าตอบ false คือยิงไปก็เสียโควตาเปล่าแน่นอน
 */
export function canTrack(trackingNumber: string, hint?: string): boolean {
  return resolveCourier(trackingNumber, hint) !== null;
}

/** adapter object สำหรับให้ส่วนอื่นเรียกใช้แบบเดียวกันทุกขนส่ง */
export const etrackings: CarrierAdapter = {
  carrierCode: CARRIER_CODE,
  carrierName: CARRIER_NAME,
  track,
  trackWithCourier,
  canTrack,
  // ไม่มีรายการลองซ้ำ — เพดานต่อเดือนไม่เหลือที่ให้ลองผิดลองถูก
  retryCourierCodes: [],
};
