/**
 * รอบบิลของผู้ให้บริการแต่ละเจ้า — ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะ env หรือฐานข้อมูล
 *
 * ------------------------------------------------------------------
 * ปัญหาที่แก้: ตัวนับเดิมนับตาม "เดือนปฏิทิน" เจ้าเดียวกันหมด ซึ่งผิดทั้งสามเจ้า
 *
 *   ไปรษณีย์ไทย  รีเซ็ต **รายวัน** เที่ยงคืนเวลาไทย
 *   Track123     รีเซ็ต **รายเดือนตามวันที่ซื้อ** (วันที่ 29)
 *   ETrackings   **ไม่รีเซ็ตเลย** นับสะสมตลอดกาล (แผนฟรี)
 *
 * ผลของการนับผิด: วันที่ 1 ก.ย. หน้าสถิติแสดง 0/300 และ 0/50 ทั้งที่ของจริง
 * ใช้ไป 38 และ 9 — **ตัวนับที่ผิดแย่กว่าไม่มีตัวนับ เพราะให้ความมั่นใจปลอม**
 * และกลไกเกลี่ยโหลดตามโควตาก็ตัดสินใจผิดตามไปด้วย
 * ------------------------------------------------------------------
 * เวลาไทยคงที่ที่ UTC+7 ตลอดกาล ไม่มี DST — ทั้งไฟล์นี้จึงคำนวณตรงๆ ได้
 * โดยไม่ต้องพึ่งไลบรารีเขตเวลา (ประเทศไทยเลิกใช้ DST ตั้งแต่ปี 2495)
 * ------------------------------------------------------------------
 */

/** ชั่วโมงที่เวลาไทยเร็วกว่า UTC — คงที่ตลอดกาล */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;

/** รูปแบบรอบบิลที่รองรับ */
export type BillingCycle =
  /** รีเซ็ตทุกเที่ยงคืนเวลาไทย */
  | "daily"
  /** รีเซ็ตทุกเดือนในวันที่กำหนด */
  | "monthly"
  /** ไม่รีเซ็ตเลย นับสะสมตลอดอายุบัญชี */
  | "lifetime";

export interface BillingPeriod {
  cycle: BillingCycle;
  /**
   * วันที่ของเดือนที่รอบเริ่มใหม่ (1–31) — ใช้เฉพาะ cycle "monthly"
   *
   * เดือนที่สั้นกว่าค่านี้จะถูกบีบลงมาเป็นวันสุดท้ายของเดือนนั้นแทน
   * (วันที่ 31 ในเดือนกุมภาพันธ์ = วันที่ 28 หรือ 29)
   */
  resetDay: number;
}

/** คีย์ของรอบที่ไม่มีวันรีเซ็ต — คงที่ตลอดกาล ทุกยอดจึงกองรวมอยู่แถวเดียว */
export const LIFETIME_KEY = "lifetime";

/** ส่วนประกอบวันที่ตามเวลาไทย */
interface BangkokDate {
  year: number;
  month: number;
  day: number;
}

/** แตกเวลาสากลออกเป็นวันที่ตามเวลาไทย */
export function bangkokDate(now: number): BangkokDate {
  const shifted = new Date(now + BANGKOK_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** เวลาสากลของเที่ยงคืนวันนั้นตามเวลาไทย */
function bangkokMidnight(date: BangkokDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) - BANGKOK_OFFSET_MS;
}

/** จำนวนวันในเดือนนั้น */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** เลื่อนเดือนไปข้างหน้า/หลัง โดยยังได้ปีที่ถูกต้อง */
function shiftMonth(year: number, month: number, by: number): [number, number] {
  const index = year * 12 + (month - 1) + by;
  return [Math.floor(index / 12), (index % 12) + 1];
}

/**
 * วันที่รอบเริ่มในเดือนนั้น — บีบลงมาเมื่อเดือนสั้นกว่าวันที่ตั้งไว้
 *
 * ⚠️ จุดที่พลาดง่ายที่สุดของทั้งไฟล์: ตั้งวันเริ่มรอบเป็น 29-31 แล้วเจอเดือน
 * กุมภาพันธ์ ถ้าไม่บีบ วันที่ 31 ก.พ. จะกลายเป็นต้นเดือนมีนาคมโดยอัตโนมัติ
 * (พฤติกรรมของ Date) แล้วรอบจะเพี้ยนไปทั้งเดือน
 */
function startDayIn(year: number, month: number, resetDay: number): number {
  return Math.min(resetDay, daysInMonth(year, month));
}

/** บีบวันเริ่มรอบให้อยู่ในช่วง 1–31 เสมอ ไม่ว่าจะตั้ง env มาเป็นอะไร */
export function normalizeResetDay(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), 31);
}

/**
 * วันเริ่มของรอบที่ครอบเวลานี้อยู่ (เฉพาะ cycle "monthly")
 *
 * ถ้าวันนี้ยังไม่ถึงวันรีเซ็ตของเดือนนี้ แปลว่าเรายังอยู่ในรอบที่เริ่มเดือนก่อน
 */
function monthlyStart(now: number, resetDay: number): BangkokDate {
  const today = bangkokDate(now);
  const thisMonth = startDayIn(today.year, today.month, resetDay);

  if (today.day >= thisMonth) {
    return { year: today.year, month: today.month, day: thisMonth };
  }

  const [year, month] = shiftMonth(today.year, today.month, -1);
  return { year, month, day: startDayIn(year, month, resetDay) };
}

/** "2026-09-01" จากส่วนประกอบวันที่ */
function formatDate(date: BangkokDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

/**
 * คีย์ของรอบที่กำลังใช้อยู่ — ยอดถูกนับแยกตามคีย์นี้
 *
 * รูปแบบคีย์ต่างกันตามรอบโดยตั้งใจ เพราะทำให้อ่านแถวในฐานข้อมูลแล้วรู้ทันทีว่า
 * แถวนั้นมาจากรอบแบบไหน ไม่ต้องไปเปิดโค้ดดู:
 *   daily     "2026-09-01"  วันนั้น
 *   monthly   "2026-08-29"  วันที่รอบเริ่ม
 *   lifetime  "lifetime"
 */
export function periodKey(period: BillingPeriod, now: number): string {
  if (period.cycle === "lifetime") return LIFETIME_KEY;
  if (period.cycle === "daily") return formatDate(bangkokDate(now));
  return formatDate(monthlyStart(now, normalizeResetDay(period.resetDay)));
}

/**
 * เวลาที่รอบถัดไปจะเริ่ม (เที่ยงคืนเวลาไทย) — null เมื่อไม่มีวันรีเซ็ต
 *
 * หน้าสถิติเอาไปแสดงว่า "รีเซ็ตครั้งถัดไปเมื่อไร" ซึ่งเป็นข้อมูลที่ต้องมี
 * ถ้าจะอ่านตัวเลขโควตาให้เข้าใจ — 38/300 มีความหมายต่างกันมากระหว่าง
 * "เหลืออีก 27 วัน" กับ "รีเซ็ตพรุ่งนี้"
 */
export function nextResetAt(
  period: BillingPeriod,
  now: number,
): number | null {
  if (period.cycle === "lifetime") return null;

  if (period.cycle === "daily") {
    const today = bangkokDate(now);
    return bangkokMidnight(today) + 24 * 60 * 60 * 1_000;
  }

  const resetDay = normalizeResetDay(period.resetDay);
  const start = monthlyStart(now, resetDay);
  const [year, month] = shiftMonth(start.year, start.month, 1);

  return bangkokMidnight({
    year,
    month,
    day: startDayIn(year, month, resetDay),
  });
}
