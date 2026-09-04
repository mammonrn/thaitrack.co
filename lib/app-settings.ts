/**
 * สวิตช์เปิด/ปิดฟีเจอร์ — ตรรกะบริสุทธิ์ ไม่แตะเครือข่ายและไม่แตะฐานข้อมูล
 *
 * แยกออกมาจากตัวที่คุยกับ Supabase (lib/supabase/app-settings.ts) ด้วยเหตุผล
 * เดียวกับที่แยก lib/admin.ts ออกมา — ทางที่ต้อง "ปฏิเสธ" คือทางที่ทดสอบด้วยมือ
 * แล้วมองไม่เห็นว่าพลาด สวิตช์ที่รับค่าอะไรก็ได้จะดูทำงานปกติทุกประการ
 *
 * ------------------------------------------------------------------
 * ⚠️ ชุดคีย์ต้องปิด และค่าต้องถูกบังคับชนิด
 *
 * ตาราง app_settings เก็บ jsonb จึงใส่อะไรลงไปก็ได้ ไฟล์นี้คือด่านเดียวที่กัน
 * ไม่ให้ค่าที่อ่านไม่ออกหลุดเข้าไปมีผลกับหน้าเว็บ กติกาสองข้อ:
 *
 *   1. คีย์นอก SETTING_KEYS ถูกปฏิเสธตั้งแต่ตอนเขียน ไม่ใช่ตอนอ่าน
 *   2. ค่าที่อ่านไม่ออก (null, สตริง, ตัวเลข, แถวหาย) → ใช้ค่าเริ่มต้นเสมอ
 *      ไม่ใช่โยน error และไม่ใช่เดาว่าเป็น true
 *
 * ข้อ 2 สำคัญกว่าที่คิด: ถ้าฐานข้อมูลล่มหรือยังไม่ได้รัน migration 0019
 * ระบบต้องทำงานต่อได้ด้วยค่าเริ่มต้น ไม่ใช่พังทั้งหน้า
 * ------------------------------------------------------------------
 */

/** สวิตช์ทั้งหมดที่ระบบรู้จัก — ชุดปิด */
export const SETTING_KEYS = ["map_enabled"] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * ค่าเริ่มต้นเมื่ออ่านค่าจริงไม่ได้
 *
 * map_enabled = false ตามที่ตัดสินใจไว้ และเป็นค่าที่ปลอดภัยกว่าเมื่อไม่รู้ —
 * แผนที่ที่ไม่ขึ้นทำให้ผู้ใช้เห็นชื่อสถานที่เป็นข้อความแทน ซึ่งยังใช้งานได้
 * ส่วนแผนที่ที่ขึ้นทั้งที่ควรปิดคือการจ่ายเงินให้ Google โดยไม่ได้ตั้งใจ
 */
export const SETTING_DEFAULTS: Record<SettingKey, boolean> = {
  map_enabled: false,
};

/** คำอธิบายสั้นๆ ที่แสดงข้างสวิตช์บนหน้าแอดมิน */
export const SETTING_LABEL: Record<SettingKey, { title: string; detail: string }> = {
  map_enabled: {
    title: "แผนที่ในหน้าประวัติ",
    detail:
      "ปิดแล้วจะแสดงชื่อสถานที่เป็นข้อความแทนแผนที่ เหมือนตอนที่ไม่รู้พิกัด" +
      " — ใช้ตอนโควตา Google หมดหรือแผนที่แสดงผลผิด",
  },
};

/** ค่านี้เป็นคีย์ที่เรารู้จักไหม — ใช้ตรวจค่าที่มาจากนอกโปรแกรม */
export function isSettingKey(value: unknown): value is SettingKey {
  return (
    typeof value === "string" &&
    (SETTING_KEYS as readonly string[]).includes(value)
  );
}

/** ค่าที่อ่านจากฐานข้อมูลได้จริง แยกตามคีย์ */
export type SettingValues = Record<SettingKey, boolean>;

/** ชุดค่าเริ่มต้นทั้งหมด — สำเนาใหม่ทุกครั้ง ผู้เรียกแก้ได้โดยไม่กระทบของเดิม */
export function defaultSettings(): SettingValues {
  return { ...SETTING_DEFAULTS };
}

/**
 * แปลงแถวดิบจากฐานข้อมูลเป็นชุดค่าที่ใช้ได้ — ฟังก์ชันบริสุทธิ์
 *
 * แถวที่คีย์ไม่รู้จักถูกข้าม (ไม่ใช่ error) เพราะอาจเป็นสวิตช์ของโค้ดรุ่นใหม่กว่า
 * ที่ยังไม่ได้ deploy ลงเครื่องนี้ — สถานการณ์ปกติระหว่าง rolling deploy
 *
 * ค่าที่ไม่ใช่ boolean ก็ถูกข้ามด้วยเหตุผลเดียวกับข้อ 2 ข้างบน
 */
export function parseSettings(
  rows: readonly { key: unknown; value: unknown }[] | null | undefined,
): SettingValues {
  const settings = defaultSettings();
  if (!Array.isArray(rows)) return settings;

  for (const row of rows) {
    // ผูกไว้กับตัวแปรก่อน เพื่อให้ TypeScript แคบชนิดของ key ได้จริง
    // (การเช็ค row?.key แล้วใช้ row.key ต่อ ไม่ทำให้ชนิดแคบลง)
    const key: unknown = row?.key;
    const value: unknown = row?.value;

    if (!isSettingKey(key)) continue;
    if (typeof value !== "boolean") continue;

    settings[key] = value;
  }

  return settings;
}
