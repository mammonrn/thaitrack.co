/**
 * เดาขนส่งจาก prefix ของเลขพัสดุ ก่อนจะยอมเสีย call ให้ Track123 ตรวจจับเอง
 *
 * ปัญหาที่แก้: การตรวจจับขนส่งอัตโนมัติของ Track123 เดาผิดได้ เช่นเลข SPXTH...
 * ของ Shopee Xpress ถูกเดาเป็น Flash Express แล้วตอบ NO_RECORD กลับมาทั้งที่
 * พัสดุมีอยู่จริง ผลคือต้องยิงซ้ำอีกครั้งโดยระบุขนส่งเจาะจง = เสีย quota 2 ครั้ง
 * ต่อการค้นหา 1 ครั้ง และไปเร่งให้ชนลิมิต 5 req/s เร็วขึ้นเป็นเท่าตัว
 *
 * prefix ที่ชี้ขนส่งได้ชัดเจนจึงควรข้ามการตรวจจับไปเลย ยิงตรงครั้งเดียวจบ
 *
 * ─────────────────────────────────────────────────────────────────────
 * วิธีเพิ่มเจ้าใหม่: เติมอีกแถวลงใน COURIER_PREFIXES ก็พอ ไม่ต้องแก้ logic
 *
 * เกณฑ์ที่ควรผ่านก่อนเติม — ต้อง "ชัดเจน" จริงเท่านั้น เพราะเดาผิดแปลว่าเรา
 * บังคับยิงผิดเจ้าตั้งแต่ครั้งแรก ซึ่งแย่กว่าปล่อยให้ auto-detect ทำงาน:
 *   1. prefix นั้นเป็นของขนส่งเจ้านั้นเจ้าเดียว ไม่มีเจ้าอื่นใช้ซ้ำ
 *   2. ยืนยันด้วยเลขจริงแล้วว่ายิงด้วย courierCode นี้แล้วได้ข้อมูลกลับมา
 *   3. ยาวพอจะไม่ชนกับเลขของเจ้าอื่นโดยบังเอิญ (prefix สั้นๆ อย่าง "TH"
 *      หรือ "SP" ไม่ผ่านข้อนี้)
 * ถ้าไม่มั่นใจครบทั้งสามข้อ ให้ใส่ไว้ใน RETRY_COURIER_CODES (lib/carriers/track123.ts)
 * แทน ซึ่งเป็นทางลองซ้ำหลัง auto-detect ไม่เจอ ไม่ใช่ทางบังคับตั้งแต่แรก
 * ─────────────────────────────────────────────────────────────────────
 */

/** หนึ่งแถวในตาราง prefix → ขนส่ง */
export interface CourierPrefix {
  /** ตัวขึ้นต้นของเลขพัสดุ (ตัวพิมพ์ใหญ่ ไม่มีช่องว่างหรือขีด) */
  prefix: string;
  /** courierCode ที่ Track123 ใช้เรียกขนส่งเจ้านี้ */
  courierCode: string;
  /** ชื่อขนส่งไว้ให้คนอ่านโค้ดเข้าใจ ไม่ได้ใช้ในการทำงาน */
  carrierName: string;
}

/**
 * ตาราง prefix → ขนส่ง
 *
 * shopee-xpress-th คือ SPX / Shopee Xpress ประเทศไทย
 * ห้ามสับสนกับ "spx" ซึ่งเป็นคนละบริษัท (SPX Express / SpeedX ในต่างประเทศ)
 */
export const COURIER_PREFIXES: readonly CourierPrefix[] = [
  {
    prefix: "SPXTH",
    courierCode: "shopee-xpress-th",
    carrierName: "Shopee Xpress ไทย",
  },
  {
    /*
     * ยืนยันด้วยเลขจริงจากผู้ใช้: JTTH203388775531 และ JTTH203838762083
     * ยิง ETrackings ด้วย courier=jt-express แล้วได้ meta.code 200 พร้อมข้อมูลครบ
     *
     * ก่อนหน้านี้ทั้งสองเลขขึ้นว่า "ยังไม่พบเลขนี้" เพราะ JTTH ไม่มีในตารางนี้
     * → ETrackings ไม่ถูกเรียกเลย (ดู backupUsable ใน resolve.ts) เหลือแต่
     * Track123 ที่ auto-detect หาไม่เจอ ทั้งที่พัสดุมีอยู่จริง
     *
     * ผ่านเกณฑ์ทั้งสามข้อ: JTTH เป็นของ J&T เจ้าเดียว, ยืนยันด้วยเลขจริงแล้ว,
     * และยาว 4 ตัวพร้อมรหัสประเทศในตัว ไม่ชนกับเจ้าอื่นโดยบังเอิญ
     * (ต่างจาก "TH" ล้วนที่ SPX กับ Flash ใช้ร่วมกัน จึงห้ามเติม)
     *
     * ⚠️ courierCode นี้ยืนยันแล้วกับ ETrackings ยังไม่ได้ยืนยันกับ Track123
     * ในทางปฏิบัติไม่กระทบ เพราะ prefix ที่ฟันธงได้ทำให้ ETrackings ได้ยิงก่อน
     * และถ้า Track123 ไม่รู้จักรหัสนี้ runFallback ยังไล่ต่อด้วย auto-detect อยู่ดี
     */
    prefix: "JTTH",
    courierCode: "jt-express",
    carrierName: "J&T Express ไทย",
  },
];

/**
 * หา courierCode จาก prefix ของเลขพัสดุ — คืน null ถ้าไม่มี prefix ไหนตรง
 *
 * เลือกแถวที่ prefix ยาวที่สุดเมื่อมีหลายแถวตรงพร้อมกัน เพื่อให้เติมแถวที่
 * เจาะจงกว่า (เช่น "SPXTH") ทับแถวกว้างกว่าได้ในอนาคตโดยไม่ต้องสนใจลำดับที่เขียน
 *
 * รับเลขที่ normalize มาแล้วหรือยังไม่ normalize ก็ได้ — จัดการให้ในนี้ เพราะ
 * ผู้เรียกบางที่ (เช่นฝั่ง UI) ยังไม่ได้ผ่าน normalizeTrackingNumber
 */
export function courierFromPrefix(trackingNumber: string): string | null {
  const value = (trackingNumber ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (value === "") return null;

  let best: CourierPrefix | null = null;
  for (const entry of COURIER_PREFIXES) {
    if (!value.startsWith(entry.prefix)) continue;
    if (best === null || entry.prefix.length > best.prefix.length) best = entry;
  }

  return best?.courierCode ?? null;
}
