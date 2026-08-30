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

/** ข้อความไทยเริ่มต้นของแต่ละสถานะ ใช้เมื่อขนส่งไม่ได้ส่งคำบรรยายมาให้ */
export const TRACKING_STATUS_TEXT: Record<TrackingStatus, string> = {
  pending: "รอรับเข้าระบบ",
  in_transit: "อยู่ระหว่างขนส่ง",
  out_for_delivery: "อยู่ระหว่างนำจ่าย",
  delivered: "นำจ่ายสำเร็จ",
  exception: "มีปัญหาในการนำจ่าย",
};

/** เหตุการณ์หนึ่งบรรทัดใน timeline การเดินทางของพัสดุ */
export interface TrackingEvent {
  /** เวลาที่เกิดเหตุการณ์ รูปแบบ ISO 8601 เช่น "2026-08-30T09:12:00+07:00" */
  time: string;
  /** สถานที่ เช่น "ศูนย์ไปรษณีย์หลักสี่" ("" ถ้าขนส่งไม่ได้ส่งมา) */
  location: string;
  /** คำบรรยายเหตุการณ์เป็นภาษาไทย */
  description: string;
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

  constructor(
    code: TrackingErrorCode,
    userMessage: string,
    options?: { cause?: unknown; debugMessage?: string },
  ) {
    super(options?.debugMessage ?? userMessage, { cause: options?.cause });
    this.name = "CarrierError";
    this.code = code;
    this.userMessage = userMessage;
  }
}
