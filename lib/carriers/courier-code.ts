/**
 * รูปแบบมาตรฐานของรหัสขนส่ง — กันบั๊ก "สะกดไม่ตรงกันเลยไม่ match"
 *
 * ปัญหาที่แก้: Track123 คืนรหัสขนส่งมาไม่คงที่ ในฐานข้อมูลจริงพบทั้ง
 * `flashexpress`, `shopee-xpress-th` และ `shopee-express` ปนกันอยู่ ส่วนตาราง
 * แปลงรหัสของ ETrackings เขียนไว้เป็น `flash-express` (มีขีด) ผลคือ courier
 * hint ของ Flash **ไม่ match ตลอดกาล** และ ETrackings ไม่เคยถูกเรียกให้ Flash เลย
 *
 * ที่แย่ที่สุดคือมันเงียบสนิท — ไม่มี error ไม่มี log ระบบแค่ทำงานน้อยกว่าที่ควร
 * โดยไม่มีใครรู้ กว่าจะเจอก็ต่อเมื่อมีคนไปนั่งไล่ดูข้อมูลจริงเทียบกับโค้ด
 *
 * ทางแก้ระยะยาวสองชั้น (การเติมแถวทีละครั้งเมื่อเจอไม่นับเป็นทางแก้):
 *
 *   1. **normalize ก่อนเทียบเสมอ** — ตัดทุกอย่างที่ไม่ใช่ a–z 0–9 ทิ้ง แล้วเทียบ
 *      ด้วยผลลัพธ์นั้น `flash-express` `flashexpress` `Flash Express` จึงกลาย
 *      เป็นคีย์เดียวกันโดยไม่ต้องรู้ล่วงหน้าว่าปลายทางจะสะกดแบบไหน
 *
 *   2. **ส่งเสียงเมื่อเจอรหัสที่ไม่รู้จัก** (ดู reportUnknownCourier) เพื่อให้รหัส
 *      ใหม่ที่เราไม่เคยเห็นโผล่ใน log ทันทีที่เจอครั้งแรก แทนที่จะเงียบไปเรื่อยๆ
 */

/**
 * ตัดตัวคั่นและตัวพิมพ์ใหญ่ทิ้ง เหลือแต่ a–z กับ 0–9
 *
 * ตั้งใจตัด "ทุกอย่างที่ไม่ใช่ตัวอักษรกับตัวเลข" ไม่ใช่ตัดเฉพาะขีด เพราะเรา
 * ไม่รู้ว่าปลายทางจะใช้ตัวคั่นอะไรในอนาคต (ขีดล่าง จุด ช่องว่าง เจอมาแล้วทั้งนั้น)
 */
export function normalizeCourierCode(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * สร้างตารางค้นหาที่ทนต่อการสะกดต่างกัน จากตารางที่คนเขียนอ่านง่าย
 *
 * โยน error ทันทีเมื่อมีสองคีย์ที่ normalize แล้วชนกันแต่ชี้คนละค่า เพราะนั่น
 * แปลว่าตารางขัดแย้งกันเอง และผลลัพธ์จะขึ้นอยู่กับลำดับที่เขียน ซึ่งเป็นบั๊ก
 * ที่หายากที่สุดแบบหนึ่ง — พังตอน import ดังกว่าพังตอน runtime แบบเงียบๆ
 */
export function buildCourierLookup(
  table: Readonly<Record<string, string>>,
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const [key, value] of Object.entries(table)) {
    const normalized = normalizeCourierCode(key);
    const existing = lookup.get(normalized);

    if (existing !== undefined && existing !== value) {
      throw new Error(
        `ตารางรหัสขนส่งขัดแย้งกันเอง: "${key}" กลายเป็น "${normalized}" ` +
          `ซึ่งชี้ไปที่ "${existing}" อยู่แล้ว แต่แถวนี้ชี้ไปที่ "${value}"`,
      );
    }
    lookup.set(normalized, value);
  }

  return lookup;
}

/**
 * รหัสที่ "รู้อยู่แล้วว่าไม่รองรับ" — เจอแล้วไม่ต้องส่งเสียง
 *
 * แยกจากรหัสที่ไม่รู้จักจริงๆ เพราะถ้าเตือนรวมกันหมด log จะเต็มไปด้วยเสียงของ
 * สิ่งที่เราตั้งใจไม่รองรับ แล้วเสียงของสิ่งที่ควรรู้จริงๆ จะจมหายไป
 *
 * ห้าตัวแรกยืนยันด้วยการยิงจริงแล้วว่า ETrackings ไม่รองรับ ส่วนสองตัวหลังเป็น
 * รหัสของ adapter เราเอง ซึ่งโผล่มาเป็น hint ได้เมื่อครั้งก่อนตรวจจับขนส่งไม่ได้
 */
const KNOWN_UNSUPPORTED: ReadonlySet<string> = new Set([
  "thailandpost",
  "lex",
  "fedex",
  "dhlexpress",
  "emsinternational",
  "track123",
  "etrackings",
]);

/** รหัสที่เคยเตือนไปแล้ว — เตือนซ้ำไม่ได้ข้อมูลเพิ่ม มีแต่ทำให้ log รก */
const reported = new Set<string>();

/**
 * ส่งเสียงเมื่อเจอรหัสขนส่งที่ไม่รู้จัก — ครั้งเดียวต่อหนึ่งรหัส
 *
 * นี่คือชั้นที่ทำให้บั๊กแบบ flashexpress ไม่เงียบอีก: รหัสใหม่ที่ปลายทางเริ่ม
 * ส่งมาจะโผล่ใน log ทันทีที่เจอครั้งแรก พร้อมบอกว่าต้องไปเติมที่ไหน
 */
export function reportUnknownCourier(code: string, where: string): void {
  const normalized = normalizeCourierCode(code);
  if (normalized === "" || KNOWN_UNSUPPORTED.has(normalized)) return;
  if (reported.has(normalized)) return;

  reported.add(normalized);
  console.warn(
    `[${where}] ไม่รู้จักรหัสขนส่ง "${code}" (normalize แล้วเป็น "${normalized}") ` +
      "— ถ้าเป็นเจ้าที่ควรรองรับ ให้เติมแถวใน COURIER_MAP ของ lib/carriers/etrackings.ts",
  );
}

/** ล้างรายชื่อที่เคยเตือน — ใช้ในเทสต์เท่านั้น */
export function resetCourierReports(): void {
  reported.clear();
}
