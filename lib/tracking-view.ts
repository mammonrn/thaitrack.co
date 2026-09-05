/**
 * ตัวกลางระหว่างหน้าเว็บกับ POST /api/track
 *
 * แยกออกมาจาก page.tsx เพื่อให้หน้าเว็บเหลือแค่การแสดงผล และให้ logic
 * การเรียก API / แปลงข้อความ error ทดสอบได้ด้วย mock โดยไม่ต้องเปิดเบราว์เซอร์
 */

import type {
  ShipmentDetails,
  TrackingErrorCode,
  TrackingResult,
} from "./carriers/types";

/**
 * ข้อความที่แสดงให้ผู้ใช้เห็นเวลามีปัญหา
 * แยกเป็นหัวข้อ (เกิดอะไรขึ้น) กับรายละเอียด (ทำยังไงต่อ) เสมอ
 */
export interface UserFacingError {
  title: string;
  detail: string;
}

/**
 * ทุกข้อความบอก "สาเหตุ + สิ่งที่ผู้ใช้ทำได้ต่อ" ไม่มีศัพท์เทคนิค ไม่มีรหัส error
 * และไม่ยกข้อความดิบจากระบบขนส่งปลายทางมาแสดง
 */
export const ERROR_MESSAGE: Record<TrackingErrorCode, UserFacingError> = {
  invalid_tracking_number: {
    title: "เลขพัสดุยังไม่ถูกต้อง",
    detail:
      "เลขพัสดุมักยาว 8–20 ตัว เป็นตัวเลขผสมตัวอักษรอังกฤษ เช่น EE000000000TH ลองตรวจดูอีกครั้งว่าพิมพ์ครบทุกตัวหรือยัง",
  },
  // ⚠️ ประโยคแรกต้องอธิบาย "ทำไมถึงยังไม่เจอ" ก่อนเสมอ ไม่ใช่สั่งให้ผู้ใช้ทำอะไร
  // คนที่มาถึงหน้านี้ส่วนใหญ่พิมพ์เลขถูกแล้ว แค่ของเพิ่งออกจากมือผู้ส่ง การขึ้น
  // ข้อความแนวตรวจสอบเลขก่อนเป็นการโยนความสงสัยกลับไปให้เขาโดยไม่มีมูล
  not_found: {
    title: "ยังไม่พบเลขนี้ในระบบขนส่ง",
    detail:
      "หลังผู้ส่งฝากของ ขนส่งมักใช้เวลา 1–2 ชั่วโมงกว่าเลขพัสดุจะขึ้นระบบ " +
      "ถ้าเพิ่งได้เลขมาวันนี้ ลองกลับมาค้นอีกครั้งในอีกสักพัก " +
      "ระบบค้นให้แล้วทั้งไปรษณีย์ไทยและขนส่งเอกชนที่รองรับ",
  },
  auth_failed: {
    title: "ระบบเชื่อมต่อขนส่งมีปัญหา",
    detail: "ไม่ใช่ความผิดของคุณ ทีมงานกำลังแก้ไขอยู่ ลองใหม่อีกครั้งในอีกสักครู่",
  },
  // ถึงข้อความนี้ได้ก็ต่อเมื่อคิวฝั่งเซิร์ฟเวอร์กับการลองใหม่อัตโนมัติ (3 รอบ)
  // เอาไม่อยู่จริงๆ แล้ว จึงไม่บอกว่า "คุณค้นหาถี่เกินไป" ซึ่งไม่ตรงความจริงและ
  // โยนความผิดให้ผู้ใช้ทั้งที่ต้นเหตุคือคิวรวมของทุกคนที่ใช้อยู่ตอนนั้น
  rate_limited: {
    title: "คิวค้นหาหนาแน่น",
    detail:
      "ระบบลองใหม่ให้อัตโนมัติแล้วแต่ยังไม่สำเร็จ รอสักครู่แล้วกดค้นหาอีกครั้ง",
  },
  network_error: {
    title: "เชื่อมต่อไม่สำเร็จ",
    detail:
      "ตรวจสัญญาณอินเทอร์เน็ตหรือ Wi-Fi ของคุณ แล้วกดค้นหาอีกครั้ง",
  },
  // ⚠️ ห้ามใส่ตัวเลขหรือคำสัญญาลงในข้อความนี้
  //
  // ของเดิมเขียนว่า "ลองใหม่อีกครั้งในอีก 2–3 นาที" ซึ่งเป็นตัวเลขที่ไม่มีที่มา
  // และนานเกินจริง (จาก log: ลองใหม่ใน 7 วินาทีก็สำเร็จ) คนอ่านแล้วรู้สึกว่า
  // "นานขนาดนั้นก็ไม่รอแล้ว"
  //
  // และห้ามอ้างสถิติ เช่น "คนที่ลองใหม่ได้คำตอบเกือบทุกราย" — ข้อความบนเว็บ
  // ไม่มีกลไกอัปเดตตามความจริง วันที่ปลายทางแย่ลง มันจะกลายเป็นคำโกหกที่ค้าง
  // อยู่โดยไม่มีใครรู้ · ข้อความต้องจริงเสมอ ไม่ใช่จริงตอนเขียน
  //
  // "ไม่ใช่ปัญหาที่เลขพัสดุของคุณ" ปิดความสงสัยแรกของผู้ใช้ (พิมพ์ผิดหรือเปล่า)
  // โดยไม่โทษใคร · ส่วน "เมื่อไหร่ควรกด" ให้ปุ่มบอกเอง ไม่ใช่ข้อความ
  upstream_error: {
    title: "ระบบขนส่งตอบไม่ทัน",
    detail:
      "ปลายทางกำลังหนาแน่น ไม่ใช่ปัญหาที่เลขพัสดุของคุณ กดลองอีกครั้งได้เลย",
  },
  // ⚠️ ห้ามเขียนว่า "ลองใหม่ทันที" — เพดานถูกตัดเพราะปลายทางกำลังช้าจริง
  // การชวนให้กดรัวจะยิ่งทำให้คิวหนาขึ้นสำหรับทุกคน
  timeout: {
    title: "ขนส่งตอบช้ากว่าปกติ",
    detail:
      "ระบบรอจนครบเวลาที่ตั้งไว้แล้วแต่ยังไม่ได้ข้อมูล ไม่ใช่ว่าไม่มีพัสดุนี้ — รอสักครู่แล้วกดค้นหาอีกครั้ง",
  },
  config_error: {
    title: "ระบบยังไม่พร้อมให้บริการ",
    detail: "ไม่ใช่ความผิดของคุณ ทีมงานกำลังตั้งค่าระบบอยู่ ลองใหม่ภายหลัง",
  },
};

/**
 * ถ้อยคำระหว่างรอผล — ต้นทางเดียวของทั้งเว็บ
 *
 * คำขอที่ต้องเข้าคิวยังเป็น "กำลังค้นหา" อยู่ ไม่ใช่ error ผู้ใช้จึงต้องเห็นว่า
 * ระบบยังทำงานให้อยู่ ไม่ใช่เห็นข้อความแดงแล้วเข้าใจว่าล้มเหลวไปแล้ว
 */
export const SEARCHING_MESSAGE = "กำลังถามขนส่งอยู่…";

/** ข้อความที่เปลี่ยนไปใช้เมื่อรอนานผิดปกติ ซึ่งแปลว่าน่าจะติดคิวอยู่ */
export const QUEUED_MESSAGE = "คิวค้นหาหนาแน่น กำลังรอคิวให้อัตโนมัติ…";

/**
 * รอเกินเท่านี้ (ms) ค่อยเปลี่ยนไปใช้ QUEUED_MESSAGE
 *
 * ตั้งให้ยาวกว่าเวลาตอบปกติของการค้นหาที่ไม่ติดคิว เพื่อไม่ให้ผู้ใช้ทั่วไปเห็น
 * คำว่า "คิวหนาแน่น" ทั้งที่ระบบว่าง แต่สั้นกว่าเวลาที่คิว + การลองใหม่
 * ใช้จนครบ (ประมาณ 3.5 วินาที) เพื่อให้ทันได้เห็นก่อนผลจะออก
 */
export const QUEUED_NOTICE_AFTER_MS = 2_500;

export const EMPTY_INPUT_ERROR: UserFacingError = {
  title: "ยังไม่ได้กรอกเลขพัสดุ",
  detail: "พิมพ์เลขพัสดุที่ได้จากผู้ส่งหรือจากใบเสร็จลงในช่องด้านบน",
};

const FALLBACK_ERROR: UserFacingError = {
  title: "เกิดปัญหาที่เราไม่รู้จัก",
  detail: "ลองกดค้นหาอีกครั้ง ถ้ายังไม่ได้ ลองใหม่ในอีกสักครู่",
};

/**
 * ถ้อยคำของป้าย "ข้อมูลเก่า" ที่ขึ้นเมื่อระบบขนส่งไม่ตอบ
 *
 * ตั้งใจไม่เขียนว่า "กำลังลองใหม่ให้อัตโนมัติ" ตรงนี้ เพราะพอผู้ใช้เห็นป้ายนี้
 * แปลว่าการลองใหม่อัตโนมัติ (3 รอบในชั้น gateway) จบไปแล้วและไม่สำเร็จ
 * ระบบไม่ได้กำลังทำอะไรอยู่จริง การบอกว่ากำลังลองอยู่จึงเป็นการโกหกผู้ใช้
 * บอกตรงๆ ว่าเกิดอะไรขึ้นและทำอะไรต่อได้ ดีกว่าปลอบด้วยข้อความที่ไม่จริง
 */
export const STALE_NOTICE: UserFacingError = {
  title: "ระบบขนส่งไม่ตอบตอนนี้",
  detail:
    "ด้านล่างคือข้อมูลล่าสุดที่เราเก็บไว้ ไม่ใช่ข้อมูลสดจากขนส่ง ลองกดค้นหาอีกครั้งในอีกสักครู่",
};

/** "ข้อมูล ณ 30 ส.ค. 2569 14:20 น." — คืน null ถ้าไม่รู้เวลา (ป้ายจะไม่แสดงบรรทัดนี้) */
export function formatStaleSince(iso: string | null): string | null {
  if (!iso) return null;

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;

  return `ข้อมูล ณ ${formatThaiDateTime(iso)} น.`;
}

export type TrackingOutcome =
  | {
      ok: true;
      result: TrackingResult;
      /**
       * เวลาที่ดึงข้อมูลชุดนี้มาจากขนส่ง (ISO 8601) — null เมื่อเป็นข้อมูลสด
       *
       * มีค่าเมื่อไร แปลว่าต้องขึ้นป้าย STALE_NOTICE ให้ผู้ใช้เห็น
       */
      staleSince: string | null;
      /**
       * รูปถ่ายตอนนำจ่าย — รายการว่างเมื่อไม่มีสิทธิ์เห็นหรือไม่มีรูป
       *
       * เซิร์ฟเวอร์เป็นคนตัดสินสิทธิ์และส่งค่ามาให้เฉพาะคนที่ผ่านเกณฑ์
       * ฝั่ง client ไม่มีทางรู้ว่ามีรูปอยู่หรือไม่ถ้าไม่ได้ค่านี้มา — และนั่น
       * คือเจตนา ไม่ใช่การส่งมาแล้วซ่อนด้วย CSS
       *
       * เป็นรายการเพราะขนส่งบางเจ้าส่งมาหลายรูป (J&T: รูปพัสดุ + รูปลายเซ็น)
       */
      proofPhotoUrls: string[];
    }
  | {
      ok: false;
      error: UserFacingError;
      /**
       * true = ขนส่งตอบว่าไม่รู้จักเลขนี้ (ไม่ใช่ระบบขัดข้อง)
       *
       * แยกออกมาเป็นฟิลด์ของตัวเองแทนการให้ผู้เรียกไปเทียบ object กับ
       * ERROR_MESSAGE.not_found เพราะการเทียบแบบนั้นพังเงียบทันทีที่มีคน
       * เปลี่ยนถ้อยคำแล้วสร้าง object ใหม่ · ฝั่ง UI ใช้ค่านี้ตัดสินว่าจะ
       * ชวนติดตั้งแอปตรงจังหวะนี้ไหม (คนที่ต้องกลับมาเช็คใหม่ใน 1–2 ชม.
       * คือคนที่การติดตั้งช่วยได้จริงที่สุด)
       */
      notFound: boolean;
      /**
       * true = ลองใหม่แล้วมีโอกาสได้คำตอบต่าง (ปลายทางตอบไม่ทันชั่วคราว)
       *
       * ⚠️ **ห้ามรวม not_found เด็ดขาด** — เลขที่ขนส่งบอกว่าไม่มี ลองใหม่กี่ครั้ง
       * ก็ไม่มี การขึ้นปุ่มตรงนั้นคือการหลอกให้ผู้ใช้เสียเวลาและเผาโควตาฟรี
       *
       * ⚠️ ห้ามรวม rate_limited / network_error ด้วย — สองอันนั้นมีการลองใหม่
       * อัตโนมัติในระบบอยู่แล้ว ถ้าถึงมือผู้ใช้แปลว่าลองแล้วไม่ผ่านจริงๆ
       */
      retryable: boolean;
    };

/** ตรวจรูปร่างข้อมูลก่อนเชื่อ — ไม่ cast ทื่อๆ เผื่อ API ตอบอะไรแปลกๆ กลับมา */
export function isSuccessPayload(
  payload: unknown,
): payload is { ok: true; data: TrackingResult } {
  if (typeof payload !== "object" || payload === null) return false;

  const { ok, data } = payload as { ok?: unknown; data?: unknown };
  if (ok !== true || typeof data !== "object" || data === null) return false;

  const { status, statusText, events } = data as {
    status?: unknown;
    statusText?: unknown;
    events?: unknown;
  };
  return (
    typeof status === "string" &&
    typeof statusText === "string" &&
    Array.isArray(events)
  );
}

/**
 * อ่านรายการ URL รูปถ่ายตอนนำจ่าย — รายการว่างเมื่อเซิร์ฟเวอร์ไม่ได้ส่งมา
 *
 * รับเฉพาะ https เท่านั้น เพราะค่านี้ถูกเอาไปใส่ใน src ของ <img> โดยตรง
 * (ฝั่งเซิร์ฟเวอร์กรองมาแล้วชั้นหนึ่ง ตรงนี้เป็นชั้นที่สอง — ค่าที่วิ่งข้าม
 * เครือข่ายมาต้องไม่ถูกเชื่อทันทีแม้จะมาจากเซิร์ฟเวอร์ของเราเอง)
 *
 * ยังรับรูปแบบเดิม (สตริงเดี่ยว) ด้วย เผื่อ client เวอร์ชันเก่าที่ยังเปิดค้าง
 * อยู่ในเครื่องผู้ใช้คุยกับเซิร์ฟเวอร์ใหม่ระหว่าง deploy
 */
export function readProofPhotoUrls(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];

  const { proofPhotoUrls, proofPhotoUrl } = payload as {
    proofPhotoUrls?: unknown;
    proofPhotoUrl?: unknown;
  };

  const values = Array.isArray(proofPhotoUrls)
    ? proofPhotoUrls
    : [proofPhotoUrl];

  return values.filter(
    (value): value is string =>
      typeof value === "string" && value.startsWith("https://"),
  );
}

/**
 * อ่านเวลาของข้อมูลเก่าจาก payload — null เมื่อเป็นข้อมูลสด
 *
 * ตรวจรูปร่างก่อนเชื่อเหมือนกับ isSuccessPayload เพราะสองฟิลด์นี้มาจากฝั่ง
 * เซิร์ฟเวอร์เหมือนกัน และการแสดงเวลาผิดแย่กว่าการไม่แสดงเวลาเลย
 */
export function readStaleSince(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const { stale, fetchedAt } = payload as {
    stale?: unknown;
    fetchedAt?: unknown;
  };

  if (stale !== true) return null;
  return typeof fetchedAt === "string" ? fetchedAt : "";
}

/** code ดิบที่เซิร์ฟเวอร์ส่งมา — null เมื่อ payload ไม่ใช่รูปที่รู้จัก */
export function readErrorCode(payload: unknown): string | null {
  const code =
    typeof payload === "object" && payload !== null
      ? (payload as { error?: { code?: unknown } }).error?.code
      : undefined;

  return typeof code === "string" ? code : null;
}

/** เลือกข้อความ error จาก code ที่รู้จัก ไม่ยกข้อความดิบจากระบบภายนอกมาแสดง */
export function toUserError(payload: unknown): UserFacingError {
  const code = readErrorCode(payload);

  if (code !== null && code in ERROR_MESSAGE) {
    return ERROR_MESSAGE[code as TrackingErrorCode];
  }
  return FALLBACK_ERROR;
}

/** หนึ่งบรรทัดของรายละเอียดการจัดส่งที่พร้อมแสดง */
export interface ShipmentFact {
  label: string;
  value: string;
}

/** "2021-02-10" → "10 ก.พ. 2564" — คืน null เมื่ออ่านไม่ออก */
function formatThaiDate(value: string): string | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(timestamp);
}

/**
 * แปลงรายละเอียดการจัดส่งเป็นบรรทัดที่พร้อมแสดง — เฉพาะฟิลด์ที่มีค่าจริง
 *
 * ขนส่งแต่ละเจ้าให้ข้อมูลไม่เท่ากัน และหลายฟิลด์ส่งมาเป็นค่าว่าง การ์ดจึงต้อง
 * ยืดหดตามของที่มีจริง ไม่ใช่เว้นช่องว่างไว้หรือเติมคำว่า "ไม่ระบุ" ให้เต็ม
 *
 * ⚠️ ไม่มีชื่อผู้รับและผู้เซ็นรับในนี้โดยตั้งใจ (ดูเหตุผลใน ShipmentDetails)
 * ต่อให้ปลายทางส่งมาก็ไม่แสดง เพราะการค้นหาในเว็บนี้ไม่ต้องพิสูจน์ตัวตนเลย
 */
export function toShipmentFacts(
  shipment: ShipmentDetails | null | undefined,
): ShipmentFact[] {
  if (!shipment) return [];

  const facts: ShipmentFact[] = [];

  // ต้นทาง–ปลายทางรวมเป็นบรรทัดเดียวเมื่อมีครบ อ่านเป็นเส้นทางได้ทันที
  if (shipment.originProvince && shipment.destinationProvince) {
    facts.push({
      label: "เส้นทาง",
      value: `${shipment.originProvince} → ${shipment.destinationProvince}`,
    });
  } else if (shipment.originProvince) {
    facts.push({ label: "ต้นทาง", value: shipment.originProvince });
  } else if (shipment.destinationProvince) {
    facts.push({ label: "ปลายทาง", value: shipment.destinationProvince });
  }

  if (shipment.dueDate) {
    const due = formatThaiDate(shipment.dueDate);
    if (due !== null) facts.push({ label: "กำหนดส่งถึง", value: due });
  }

  if (shipment.cashOnDelivery) {
    facts.push({
      label: "เก็บเงินปลายทาง",
      value: `${shipment.cashOnDelivery} บาท`,
    });
  }

  if (shipment.deliveryType) {
    facts.push({ label: "รูปแบบการส่ง", value: shipment.deliveryType });
  }

  if (shipment.sender) {
    facts.push({ label: "ผู้ส่ง", value: shipment.sender });
  }

  // ชื่อสองช่องนี้ถูกปิดบังมาตั้งแต่ adapter แล้ว (ดู lib/mask-name.ts)
  // ค่าเต็มไม่เคยเดินทางมาถึงตรงนี้ จึงไม่ต้องปิดซ้ำ และห้ามพยายามเปิดคืน
  if (shipment.recipientMasked) {
    facts.push({ label: "ผู้รับ", value: shipment.recipientMasked });
  }

  if (shipment.signerMasked) {
    facts.push({ label: "ผู้เซ็นรับ", value: shipment.signerMasked });
  }

  if (shipment.deliveryStaffName) {
    facts.push({ label: "พนักงานนำจ่าย", value: shipment.deliveryStaffName });
  }

  // เบอร์ติดต่ออยู่ท้ายสุดเพราะเป็นสิ่งที่ต้องใช้เมื่อมีปัญหา ไม่ใช่ข้อมูลที่
  // คนอ่านทุกครั้ง แต่ต้องมีให้หาเจอโดยไม่ต้องไปเปิดเว็บขนส่ง
  //
  // เบอร์สาขาขึ้นก่อนคอลเซ็นเตอร์เพราะเจาะจงกว่า — คนที่รู้เรื่องพัสดุใบนี้จริง
  // คือสาขาที่ถือของอยู่ ไม่ใช่คอลเซ็นเตอร์กลาง
  //
  // ⚠️ ทั้งสองเบอร์เป็นเบอร์บริษัท เบอร์มือถือของพนักงานส่งของไม่เคยมาถึงตรงนี้
  // (ตั้งใจไม่ดึงตั้งแต่ใน adapter — ดู deliveryStaffPhoneNumber ใน etrackings.ts)
  if (shipment.deliveryBranchPhone) {
    facts.push({ label: "สาขาที่นำจ่าย", value: shipment.deliveryBranchPhone });
  }

  if (shipment.callCenterPhone) {
    facts.push({ label: "คอลเซ็นเตอร์ขนส่ง", value: shipment.callCenterPhone });
  }

  return facts;
}

/** แปลง ISO 8601 เป็นวันเวลาแบบไทยเต็ม เช่น "16 มิ.ย. 2569 18:43" */
export function formatThaiDateTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;

  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(timestamp);
}

/**
 * แยกวันกับเวลาไว้แสดงในตราประทับ เช่น { date: "16 มิ.ย.", time: "18:43" }
 * คืน null ถ้าแปลงเวลาไม่ได้ (ตราประทับจะไม่แสดงวันที่แทนที่จะโชว์ค่าดิบ)
 */
export function formatPostmark(
  iso: string | null,
): { date: string; time: string } | null {
  if (!iso) return null;

  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;

  const date = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(timestamp);

  const time = new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).format(timestamp);

  return { date, time };
}

/**
 * ยิง POST /api/track แล้วคืนผลลัพธ์ที่พร้อมแสดงผล
 * ไม่ throw ออกไปเลย — ทุกความผิดพลาดถูกแปลงเป็นข้อความไทยให้แล้ว
 *
 * รับ fetchImpl เข้ามาได้เพื่อให้ทดสอบด้วย mock ได้โดยไม่ต้องยิงเน็ตจริง
 */
export async function requestTracking(
  trackingNumber: string,
  fetchImpl: typeof fetch = fetch,
  /**
   * ขนส่งที่หน้านี้เจาะจงอยู่ (หน้า landing รายขนส่ง) — undefined บนหน้าแรก
   *
   * เป็นแค่บริบทของหน้า ไม่ใช่ข้อเท็จจริงของเลขพัสดุ ฝั่งเซิร์ฟเวอร์จึงใช้มัน
   * เฉพาะตอนที่การตรวจจับอัตโนมัติตอบว่าไม่พบแล้วเท่านั้น
   */
  courierHint?: string,
  /**
   * true = คำขอนี้มาจากการกดปุ่ม "ลองอีกครั้ง"
   *
   * ⚠️ ไหลไปที่สถิติอย่างเดียว ไม่เปลี่ยนพฤติกรรมการค้นหาแม้แต่นิดเดียว —
   * ปุ่มลองอีกครั้งต้องใช้เส้นทางเดียวกับการค้นครั้งแรกทุกประการ
   */
  retried = false,
): Promise<TrackingOutcome> {
  const value = trackingNumber.trim();
  if (value === "") {
    return {
      ok: false,
      error: EMPTY_INPUT_ERROR,
      notFound: false,
      retryable: false,
    };
  }

  try {
    const response = await fetchImpl("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trackingNumber: value,
        ...(courierHint === undefined ? {} : { courierHint }),
        ...(retried ? { retried: true } : {}),
      }),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (response.ok && isSuccessPayload(payload)) {
      return {
        ok: true,
        result: payload.data,
        staleSince: readStaleSince(payload),
        proofPhotoUrls: readProofPhotoUrls(payload),
      };
    }

    const code = readErrorCode(payload);
    return {
      ok: false,
      error: toUserError(payload),
      notFound: code === "not_found",
      // ปุ่ม "ลองอีกครั้ง" ขึ้นเฉพาะกรณีนี้เท่านั้น (ดู UserFacingOutcome)
      retryable: code === "upstream_error",
    };
  } catch {
    // fetch ล้มเหลวเอง เช่น เน็ตหลุด หรือเซิร์ฟเวอร์ไม่ตอบ
    // เน็ตของผู้ใช้เอง ไม่ใช่ปลายทางตอบไม่ทัน — กดปุ่มก็ล้มเหมือนเดิม
    return {
      ok: false,
      error: ERROR_MESSAGE.network_error,
      notFound: false,
      retryable: false,
    };
  }
}
