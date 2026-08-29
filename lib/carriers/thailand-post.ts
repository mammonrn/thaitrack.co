/**
 * Adapter ของ "ไปรษณีย์ไทย" (Thailand Post Track & Trace API)
 *
 * เอกสาร: https://track.thailandpost.co.th/developerGuide
 * - POST /post/api/v1/authenticate/token  → แลก API key เป็น Auth Token (อายุประมาณ 1 เดือน)
 * - POST /post/api/v1/track               → ค้นหาสถานะพัสดุด้วยเลข barcode
 *
 * ทั้งสอง endpoint ใช้ header `Authorization: Token <ค่า>` โดยตอนขอ token ใช้ API key
 * ส่วนตอน track ใช้ Auth Token ที่เพิ่งได้มา
 *
 * API key อ่านจาก process.env.THAILAND_POST_API_KEY เท่านั้น — ห้าม hardcode
 */

import {
  CarrierError,
  TRACKING_STATUS_TEXT,
  type CarrierAdapter,
  type TrackingEvent,
  type TrackingResult,
  type TrackingStatus,
} from "./types";

const API_BASE = "https://trackapi.thailandpost.co.th/post/api/v1";
const CARRIER_CODE = "thailand-post";
const CARRIER_NAME = "ไปรษณีย์ไทย";

const REQUEST_TIMEOUT_MS = 15_000;
/** ขอ token ใหม่ก่อนหมดอายุจริง 5 นาที กันกรณีนาฬิกาสองฝั่งเหลื่อมกัน */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** ถ้า API ไม่ได้บอกวันหมดอายุมา ให้ถือว่าใช้ได้ 12 ชั่วโมง */
const TOKEN_FALLBACK_TTL_MS = 12 * 60 * 60_000;

/**
 * ตารางรหัสสถานะของไปรษณีย์ไทย (101–501) map เข้าสถานะกลางของเรา
 * อ้างอิงจาก developer guide — ถ้าเจอรหัสใหม่ที่ยังไม่รู้จัก จะตกไปที่ตัวเดาจากข้อความไทยแทน
 */
const STATUS_CODE_MAP: Record<string, TrackingStatus> = {
  "101": "pending", // Preload — สร้างรายการแล้วแต่ยังไม่รับฝาก
  "102": "in_transit", // Accepted by Agent
  "103": "in_transit", // รับฝาก
  "201": "in_transit", // In transit
  "202": "in_transit", // อยู่ระหว่างพิธีการศุลกากร
  "203": "exception", // ตีกลับผู้ฝากส่ง
  "204": "in_transit", // ส่งออกจากที่ทำการแลกเปลี่ยนขาออก
  "205": "in_transit", // ถึงที่ทำการแลกเปลี่ยนขาเข้า
  "206": "in_transit", // ถึงที่ทำการไปรษณีย์ปลายทาง
  "207": "in_transit", // เตรียมการขนส่ง
  "301": "out_for_delivery", // อยู่ระหว่างการนำจ่าย
  "302": "out_for_delivery", // รอผู้รับมาติดต่อรับ ณ ที่ทำการ
  "401": "exception", // นำจ่ายไม่สำเร็จ
  "501": "delivered", // นำจ่ายสำเร็จ
};

/** เผื่อรหัสสถานะที่ยังไม่รู้จัก — เดาจากคำในข้อความไทยที่ API ส่งมา */
function guessStatusFromText(text: string): TrackingStatus {
  if (/นำจ่ายสำเร็จ|จ่ายสำเร็จ|ได้รับแล้ว/.test(text)) return "delivered";
  if (/ไม่สำเร็จ|ตีกลับ|ปฏิเสธ|ตกค้าง|เสียหาย/.test(text)) return "exception";
  if (/นำจ่าย|มาติดต่อรับ|รอรับ/.test(text)) return "out_for_delivery";
  if (/รับฝาก|ขนส่ง|ที่ทำการ|ศูนย์|ส่งออก|ถึง/.test(text)) return "in_transit";
  return "pending";
}

/** รูปแบบข้อมูล 1 เหตุการณ์ที่ API ส่งกลับมา (เอาเฉพาะฟิลด์ที่ใช้) */
interface ThailandPostItem {
  barcode?: string | null;
  status?: string | null;
  status_description?: string | null;
  status_date?: string | null;
  location?: string | null;
  postcode?: string | null;
  delivery_status?: string | null;
  delivery_description?: string | null;
  receiver_name?: string | null;
}

interface ThailandPostTrackResponse {
  response?: {
    items?: Record<string, ThailandPostItem[] | null> | null;
  } | null;
  message?: string | null;
  status?: boolean | null;
}

interface ThailandPostTokenResponse {
  token?: string | null;
  expire?: string | null;
  status?: boolean | null;
  message?: string | null;
}

/* ------------------------------------------------------------------ *
 * Token cache
 * ------------------------------------------------------------------ */

interface CachedToken {
  token: string;
  /** เวลาหมดอายุ (epoch ms) */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
/** กันกรณีหลาย request ยิงพร้อมกันตอน token หมด แล้วแห่กันไปขอ token ใหม่ */
let pendingAuth: Promise<CachedToken> | null = null;

function readApiKey(): string {
  const apiKey = process.env.THAILAND_POST_API_KEY?.trim();
  if (!apiKey) {
    throw new CarrierError(
      "config_error",
      "ระบบยังไม่ได้ตั้งค่าเชื่อมต่อไปรษณีย์ไทย กรุณาลองใหม่ภายหลัง",
      { debugMessage: "ไม่พบ environment variable THAILAND_POST_API_KEY" },
    );
  }
  return apiKey;
}

/** ยิง POST พร้อม timeout และแปลง network error ให้เป็น CarrierError เสมอ */
async function postJson(
  path: string,
  authorizationValue: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${authorizationValue}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    throw new CarrierError(
      "network_error",
      timedOut
        ? "ระบบไปรษณีย์ไทยตอบกลับช้าเกินไป กรุณาลองใหม่อีกครั้ง"
        : "เชื่อมต่อระบบไปรษณีย์ไทยไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
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

/**
 * ขอ Auth Token ใหม่จากไปรษณีย์ไทย โดยใช้ API key จาก environment variable
 *
 * ปกติไม่ต้องเรียกเอง — track() จัดการ cache และการต่ออายุให้อัตโนมัติ
 */
export async function authenticate(): Promise<CachedToken> {
  const apiKey = readApiKey();
  const response = await postJson("/authenticate/token", apiKey);
  const payload = await readJson<ThailandPostTokenResponse>(response);

  if (response.status === 401 || response.status === 403) {
    throw new CarrierError(
      "auth_failed",
      "ระบบเชื่อมต่อไปรษณีย์ไทยไม่ผ่านการยืนยันตัวตน กรุณาแจ้งผู้ดูแลระบบ",
      {
        // แนบข้อความจากไปรษณีย์ไทยไว้ใน log ฝั่ง server เพื่อให้ไล่ปัญหาได้ง่าย
        debugMessage: `ขอ token ไม่ผ่าน (HTTP ${response.status}) — API key อาจไม่ถูกต้องหรือหมดอายุ: ${payload?.message ?? "ไม่มีข้อความตอบกลับ"}`,
      },
    );
  }

  if (!response.ok || !payload?.token) {
    throw new CarrierError(
      "auth_failed",
      "ขอสิทธิ์เชื่อมต่อไปรษณีย์ไทยไม่สำเร็จ กรุณาลองใหม่ภายหลัง",
      {
        debugMessage: `ขอ token ไม่สำเร็จ (HTTP ${response.status}): ${payload?.message ?? "ไม่มีข้อความตอบกลับ"}`,
      },
    );
  }

  const expireAt = payload.expire ? Date.parse(payload.expire) : Number.NaN;
  const expiresAt = Number.isFinite(expireAt)
    ? expireAt
    : Date.now() + TOKEN_FALLBACK_TTL_MS;

  return { token: payload.token, expiresAt };
}

/** คืน token ที่ยังไม่หมดอายุ (ใช้ของเดิมถ้ายังใช้ได้) */
async function getToken(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()
  ) {
    return cachedToken.token;
  }

  if (forceRefresh) {
    cachedToken = null;
  }

  pendingAuth ??= authenticate()
    .then((token) => {
      cachedToken = token;
      return token;
    })
    .finally(() => {
      pendingAuth = null;
    });

  const { token } = await pendingAuth;
  return token;
}

/* ------------------------------------------------------------------ *
 * Track
 * ------------------------------------------------------------------ */

/** ตัดช่องว่างกับขีด และทำเป็นตัวพิมพ์ใหญ่ ให้ตรงรูปแบบที่ API ต้องการ */
function normalizeTrackingNumber(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

const pad2 = (value: string | number) => String(value).padStart(2, "0");

/** "+0700" → "+07:00" (รูปแบบที่ Date.parse รับได้) */
function normalizeOffset(offset: string | undefined): string {
  if (!offset) return "+07:00";
  return offset.includes(":") ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`;
}

/**
 * ไปรษณีย์ไทยส่ง status_date มาเป็น "DD/MM/YYYY HH:mm:ss+07:00" โดยปีเป็น พ.ศ.
 * เช่น "16/06/2569 18:43:04+07:00" ซึ่ง Date.parse() อ่านไม่ออก
 * จึงต้องแปลงเป็น ISO 8601 (ค.ศ.) เองก่อน เพื่อให้เรียงลำดับและแสดงผลได้ถูกต้อง
 */
function parseThailandPostDate(raw: string): { iso: string; timestamp: number } {
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2})?$/.exec(
      raw,
    );

  if (match) {
    const [, day, month, year, hour, minute, second = "00", offset] = match;
    // ปี 2400 ขึ้นไปถือว่าเป็น พ.ศ. (เผื่อวันหนึ่ง API เปลี่ยนมาส่ง ค.ศ. มาแทน)
    const christianYear = Number(year) >= 2400 ? Number(year) - 543 : Number(year);
    const iso = `${christianYear}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${minute}:${second}${normalizeOffset(offset)}`;
    const timestamp = Date.parse(iso);
    if (Number.isFinite(timestamp)) return { iso, timestamp };
  }

  // เผื่อ API เปลี่ยนไปส่งรูปแบบมาตรฐานมาให้ในอนาคต
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed)
    ? { iso: new Date(parsed).toISOString(), timestamp: parsed }
    : { iso: raw, timestamp: Number.NaN };
}

function toEvent(
  item: ThailandPostItem,
): { event: TrackingEvent; timestamp: number } | null {
  const rawTime = item.status_date?.trim();
  if (!rawTime) return null;

  const { iso: time, timestamp } = parseThailandPostDate(rawTime);

  const description =
    item.status_description?.trim() ||
    item.delivery_description?.trim() ||
    "อัปเดตสถานะ";

  const location = item.location?.trim() ?? "";
  const postcode = item.postcode?.trim();

  return {
    event: {
      time,
      location: location && postcode ? `${location} ${postcode}` : location,
      description,
    },
    timestamp,
  };
}

function toTrackingResult(
  trackingNumber: string,
  items: ThailandPostItem[],
): TrackingResult {
  const pairs = items
    .map((item) => {
      const parsed = toEvent(item);
      return parsed === null ? null : { item, ...parsed };
    })
    .filter((pair) => pair !== null)
    // เวลาที่แปลงไม่ได้ (timestamp = NaN) ถูกดันไปไว้ต้นแถว เพื่อไม่ให้ไปแย่งเป็น "ล่าสุด"
    .sort(
      (a, b) =>
        (Number.isFinite(a.timestamp) ? a.timestamp : -Infinity) -
        (Number.isFinite(b.timestamp) ? b.timestamp : -Infinity),
    );

  const events: TrackingEvent[] = pairs.map((pair) => pair.event);
  const latest = pairs.at(-1);

  if (!latest) {
    // มี barcode อยู่ในระบบ แต่ยังไม่มีเหตุการณ์ใดเลย
    return {
      trackingNumber,
      carrierName: CARRIER_NAME,
      carrierCode: CARRIER_CODE,
      status: "pending",
      statusText: TRACKING_STATUS_TEXT.pending,
      lastUpdated: null,
      events: [],
    };
  }

  const code = latest.item.status?.trim() ?? "";
  const status =
    STATUS_CODE_MAP[code] ?? guessStatusFromText(latest.event.description);

  return {
    trackingNumber,
    carrierName: CARRIER_NAME,
    carrierCode: CARRIER_CODE,
    status,
    statusText: latest.event.description || TRACKING_STATUS_TEXT[status],
    lastUpdated: latest.event.time,
    events,
  };
}

/** ยิง /track หนึ่งครั้งด้วย token ที่ให้มา */
async function requestTracking(
  token: string,
  barcode: string,
): Promise<Response> {
  return postJson("/track", token, {
    status: "all",
    language: "TH",
    barcode: [barcode],
  });
}

/**
 * ติดตามพัสดุไปรษณีย์ไทย 1 ชิ้น แล้วแปลงผลเป็นรูปแบบกลาง TrackingResult
 *
 * ทุกความผิดพลาดถูกโยนเป็น CarrierError ที่มี code ระบุสาเหตุ — ไม่มี error ดิบหลุดออกไป
 * เพื่อให้ฝั่งเรียกใช้จัดการได้เสมอและแอปไม่ crash
 */
export async function track(trackingNumber: string): Promise<TrackingResult> {
  const barcode = normalizeTrackingNumber(trackingNumber ?? "");

  // ใช้ช่วงความยาวกว้างเท่ากับ adapter อื่น เพื่อให้เลขของขนส่งเจ้าอื่นถูกส่งมาถามจริง
  // แล้วได้ not_found กลับไป (resolveTracking อาศัย not_found เป็นสัญญาณให้ fallback)
  if (!/^[A-Z0-9]{6,40}$/.test(barcode)) {
    throw new CarrierError(
      "invalid_tracking_number",
      "รูปแบบเลขพัสดุไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
    );
  }

  let token = await getToken();
  let response = await requestTracking(token, barcode);

  // token หมดอายุก่อนกำหนดหรือถูกยกเลิก → ขอใหม่แล้วลองอีกครั้งเดียว
  if (response.status === 401 || response.status === 403) {
    token = await getToken(true);
    response = await requestTracking(token, barcode);
  }

  if (response.status === 401 || response.status === 403) {
    throw new CarrierError(
      "auth_failed",
      "ระบบเชื่อมต่อไปรษณีย์ไทยไม่ผ่านการยืนยันตัวตน กรุณาแจ้งผู้ดูแลระบบ",
      {
        debugMessage: `เรียก /track ไม่ผ่านแม้ขอ token ใหม่แล้ว (HTTP ${response.status})`,
      },
    );
  }

  if (response.status === 429) {
    throw new CarrierError(
      "rate_limited",
      "มีการค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่",
    );
  }

  const payload = await readJson<ThailandPostTrackResponse>(response);

  if (!response.ok || payload?.status === false) {
    throw new CarrierError(
      "upstream_error",
      "ระบบไปรษณีย์ไทยขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
      {
        debugMessage: `เรียก /track ไม่สำเร็จ (HTTP ${response.status}): ${payload?.message ?? "ไม่มีข้อความตอบกลับ"}`,
      },
    );
  }

  const items = payload?.response?.items?.[barcode];

  if (!items || items.length === 0) {
    throw new CarrierError(
      "not_found",
      "ไม่พบข้อมูลเลขพัสดุนี้ในระบบไปรษณีย์ไทย กรุณาตรวจสอบเลขพัสดุอีกครั้ง",
    );
  }

  return toTrackingResult(barcode, items);
}

/** adapter object สำหรับให้ส่วนอื่นเรียกใช้แบบเดียวกันทุกขนส่ง */
export const thailandPost: CarrierAdapter = {
  carrierCode: CARRIER_CODE,
  carrierName: CARRIER_NAME,
  track,
};
