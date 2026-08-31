/**
 * สัญญากลาง (contract) ของระบบติดตามพัสดุ
 *
 * ทุก carrier adapter (ไปรษณีย์ไทย, Flash, Kerry, J&T, SPX, ...) ต้องแปลงผลลัพธ์
 * จาก API ของตัวเองให้อยู่ในรูป TrackingResult เดียวกันนี้ ส่วนที่เหลือของแอป
 * (API route / UI) จะได้ไม่ต้องรู้จักรูปแบบข้อมูลเฉพาะของแต่ละขนส่ง
 */

/** สถานะกลางที่ UI ใช้ตัดสินใจแสดงผล (สี, ไอคอน, ลำดับขั้น) */
export type TrackingStatus =
  | "pending"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/**
 * ถ้อยคำสถานะภาษาไทย — ต้นทางเดียวของทั้งเว็บ
 *
 * ใช้ทั้งหัวการ์ดผลลัพธ์ ไทม์ไลน์ (ผ่าน lib/status-th.ts) และหน้าประวัติ
 * เพื่อไม่ให้สถานะเดียวกันถูกเรียกคนละชื่อในแต่ละหน้า ซึ่งทำให้ผู้ใช้เข้าใจว่า
 * เป็นคนละเรื่องกัน แก้ที่นี่ที่เดียวแล้วเปลี่ยนพร้อมกันทุกจุด
 */
export const TRACKING_STATUS_TEXT: Record<TrackingStatus, string> = {
  pending: "รอรับเข้าระบบ",
  in_transit: "อยู่ระหว่างขนส่ง",
  out_for_delivery: "กำลังนำจ่าย",
  delivered: "ส่งถึงแล้ว",
  exception: "พัสดุมีปัญหา",
};

/** เหตุการณ์หนึ่งบรรทัดใน timeline การเดินทางของพัสดุ */
export interface TrackingEvent {
  /** เวลาที่เกิดเหตุการณ์ รูปแบบ ISO 8601 เช่น "2026-08-30T09:12:00+07:00" */
  time: string;
  /** สถานที่ เช่น "ศูนย์ไปรษณีย์หลักสี่" ("" ถ้าขนส่งไม่ได้ส่งมา) */
  location: string;
  /** คำบรรยายเหตุการณ์เป็นภาษาไทย */
  description: string;
  /**
   * ที่อยู่เต็มของสถานที่ในบรรทัดนี้ ถ้าขนส่งส่งมาด้วย — ไม่แสดงให้ผู้ใช้เห็น
   *
   * ขนส่งส่วนใหญ่ให้มาแค่รหัสสาขา ("ACRAI-B - เมืองเชียงราย") ซึ่ง Google
   * ไม่รู้จัก แต่บางเจ้าห้อยที่อยู่เต็มมาท้ายข้อความด้วย นั่นคือวัตถุดิบเดียว
   * ที่ทำให้เติมพิกัดสาขาลงตารางของกลางได้เอง (ดู lib/branch-harvest.ts)
   *
   * ฟิลด์นี้เพิ่มทีหลัง ข้อมูลเก่าใน cache จึงไม่มี ทุกที่ที่อ่านต้องรับ
   * undefined ได้ด้วย ไม่ใช่แค่ null
   */
  address?: string | null;
}

/**
 * รายละเอียดการจัดส่งที่ขนส่งบางเจ้าส่งมาให้ — ทุกฟิลด์ขาดได้
 *
 * ขนส่งแต่ละเจ้าให้ข้อมูลไม่เท่ากัน และฟิลด์ที่ให้มาก็ว่างได้ UI จึงต้องแสดง
 * เฉพาะฟิลด์ที่มีค่าจริง ห้ามเว้นช่องว่างไว้หรือเติมคำว่า "ไม่ระบุ" ให้เต็ม
 *
 * ⚠️ ตั้งใจไม่มีชื่อผู้รับ ผู้เซ็นรับ ที่อยู่ และเบอร์โทร แม้ปลายทางจะส่งมาก็ตาม
 * เพราะการค้นหาในเว็บนี้ไม่ต้องพิสูจน์ตัวตนอะไรเลย ใครก็ตามที่เห็นเลขพัสดุ
 * (บนกล่อง ในกลุ่มแชท ในอีเมลยืนยันคำสั่งซื้อ) จะได้ชื่อและที่อยู่คนรับไปทันที
 * ข้อมูลที่เก็บไว้ตรงนี้จึงจำกัดเฉพาะเรื่องของ "พัสดุ" ไม่ใช่เรื่องของ "คน"
 */
export interface ShipmentDetails {
  /** จังหวัดต้นทาง */
  originProvince: string | null;
  /** จังหวัดปลายทาง */
  destinationProvince: string | null;
  /** ชื่อพนักงานที่นำจ่าย — ข้อมูลเชิงบริการ ไม่ใช่ตัวตนของผู้รับ */
  deliveryStaffName: string | null;
  /** กำหนดส่งถึง (YYYY-MM-DD) */
  dueDate: string | null;
  /** ยอดเก็บเงินปลายทาง — null เมื่อไม่มีการเก็บเงินปลายทาง */
  cashOnDelivery: string | null;
}

/** ผลลัพธ์การติดตามพัสดุในรูปแบบกลาง */
export interface TrackingResult {
  /** เลขพัสดุที่ค้นหา (normalize แล้ว) */
  trackingNumber: string;
  /** ชื่อขนส่งภาษาไทย เช่น "ไปรษณีย์ไทย" */
  carrierName: string;
  /** รหัสขนส่งสำหรับใช้ในโค้ด เช่น "thailand-post" */
  carrierCode: string;
  status: TrackingStatus;
  /** ข้อความสถานะภาษาไทย (ใช้ของขนส่งถ้ามี ไม่งั้น fallback เป็น TRACKING_STATUS_TEXT) */
  statusText: string;
  /** เวลาอัปเดตล่าสุด ISO 8601 — null ถ้ายังไม่มีเหตุการณ์ใดเลย */
  lastUpdated: string | null;
  /** timeline เรียงจากเก่าไปใหม่ */
  events: TrackingEvent[];
  /**
   * รายละเอียดการจัดส่งเพิ่มเติม — null เมื่อขนส่งเจ้านั้นไม่ได้ส่งมา
   *
   * ฟิลด์นี้เพิ่มทีหลัง ข้อมูลเก่าใน cache จึงไม่มี ทุกที่ที่อ่านต้องรับ
   * undefined ได้ด้วย ไม่ใช่แค่ null
   */
  shipment?: ShipmentDetails | null;
}

/** adapter ของขนส่งแต่ละเจ้าต้องมีหน้าตาแบบนี้ */
export interface CarrierAdapter {
  carrierCode: string;
  carrierName: string;
  track(trackingNumber: string): Promise<TrackingResult>;

  /**
   * ยิงซ้ำโดยระบุขนส่งเจาะจง สำหรับ adapter ที่ปกติตรวจจับขนส่งให้เอง
   *
   * มีไว้เพื่อกู้กรณีที่การตรวจจับอัตโนมัติเดาผิดจนตอบว่าไม่พบ ทั้งที่พัสดุมีอยู่จริง
   * adapter ที่ไม่ได้ตรวจจับเองไม่ต้องมีเมธอดนี้
   */
  trackWithCourier?(
    trackingNumber: string,
    courierCode: string,
  ): Promise<TrackingResult>;

  /**
   * เจ้านี้ตามเลขนี้ได้ไหม โดยยังไม่ต้องยิงจริง
   *
   * มีไว้ให้ผู้เรียกตัดสินลำดับการยิงล่วงหน้า สำหรับ adapter ที่บังคับให้ระบุ
   * ขนส่งเอง (เช่น ETrackings) การยิงเลขที่มันตามไม่ได้คือการทิ้งโควตาเปล่าๆ
   * แน่นอน adapter ที่ตามได้ทุกเลขไม่ต้องมีเมธอดนี้ (ถือว่าตามได้เสมอ)
   *
   * courierHint คือขนส่งที่ **ยืนยันแล้ว** ของเลขนี้ (เช่นจากผลที่เคยค้นสำเร็จ
   * มาก่อน) ไม่ใช่การเดา — เลขไทยจำนวนมากดู prefix แล้วบอกไม่ได้ว่าเป็นเจ้าไหน
   * (`TH…` ใช้ร่วมกันระหว่าง SPX กับ Flash) ค่านี้จึงเป็นทางเดียวที่ทำให้
   * adapter แบบระบุขนส่งใช้งานได้กับเลขส่วนใหญ่
   */
  canTrack?(trackingNumber: string, courierHint?: string): boolean;

  /**
   * รหัสขนส่งที่ควรลองระบุเจาะจงเมื่อการตรวจจับอัตโนมัติตอบว่าไม่พบ
   *
   * เรียงจากที่เจอปัญหาบ่อยที่สุดก่อน เพราะผู้เรียกจะลองตามลำดับและหยุดเมื่อครบ
   * เพดานที่กำหนดไว้ เพื่อไม่ให้เปลือง quota
   */
  retryCourierCodes?: readonly string[];
}

/**
 * ประเภทข้อผิดพลาดที่ adapter โยนออกมาได้
 * ตั้งใจให้เป็นชุดปิด เพื่อให้ API route map เป็น HTTP status ได้ครบทุกกรณี
 */
export type TrackingErrorCode =
  | "invalid_tracking_number"
  | "not_found"
  | "auth_failed"
  | "rate_limited"
  | "network_error"
  | "upstream_error"
  | "config_error";

/**
 * error ที่ระบุสาเหตุได้ พร้อมข้อความไทยสำหรับโชว์ผู้ใช้
 *
 * ห้ามใส่ API key หรือ token ลงใน message เด็ดขาด เพราะ message ถูกส่งกลับไปหา client
 */
export class CarrierError extends Error {
  readonly code: TrackingErrorCode;
  /** ข้อความภาษาไทยที่แสดงให้ผู้ใช้เห็นได้ */
  readonly userMessage: string;
  /**
   * code ดิบที่ระบบขนส่งตอบกลับมา เช่น "A0706" ของ Track123
   *
   * มีไว้ให้ log ฝั่งเซิร์ฟเวอร์อ้างถึงสาเหตุที่แท้จริงได้ตรงๆ โดยไม่ต้องไปแกะ
   * จาก debugMessage — ห้ามส่งค่านี้กลับไปหา client
   */
  readonly upstreamCode?: string;

  constructor(
    code: TrackingErrorCode,
    userMessage: string,
    options?: { cause?: unknown; debugMessage?: string; upstreamCode?: string },
  ) {
    super(options?.debugMessage ?? userMessage, { cause: options?.cause });
    this.name = "CarrierError";
    this.code = code;
    this.userMessage = userMessage;
    this.upstreamCode = options?.upstreamCode;
  }
}
