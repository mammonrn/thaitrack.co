/**
 * ด่านเดียวที่ตัดสินว่า /api/map ยิงไปหา Google ได้หรือไม่
 *
 * ══════════════════════════════════════════════════════════════════
 * ทำไมต้องมี
 *
 * /api/map เป็น proxy ไป Google Static Maps ซึ่งคิดเงินต่อครั้ง และ endpoint นี้
 * **เปิดสาธารณะ** — ไม่ต้องล็อกอิน ไม่มี rate limit ไม่มีเพดานรายวัน
 * ใครก็ยิงรัวได้ไม่จำกัด แต่ละครั้งคือเงินที่เราจ่ายจริง
 *
 * ที่ผ่านมาไม่โดนเพราะ **โชค** ไม่ใช่เพราะป้องกัน — มีบอทสแกน endpoint ของเรา
 * มาแล้วสองราย เพียงแต่มันมองหา /dana-na กับ /ssl-vpn/prelogin.esp ไม่ได้ไล่
 * crawl หา endpoint ของเว็บ
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ map_enabled เคยปิดแค่ฝั่ง UI
 *
 * สวิตช์นี้ถูกอ่านที่ app/history/page.tsx ที่เดียว เพื่อตัดสินว่าจะ render
 * <img> ไหม · ตัว endpoint ไม่เคยรู้จักมันเลย จึงยิง Google ได้ตลอดเวลาแม้
 * สวิตช์จะปิดอยู่ — "ปิดแผนที่" จึงไม่เคยแปลว่า "หยุดจ่ายเงิน"
 *
 * ⚠️ นี่คือชั้นที่ 1 เท่านั้น มันปิดรูได้เพราะสวิตช์ปิดอยู่ **ไม่ใช่เพราะรูถูกอุด**
 * ถ้าวันหนึ่งจะเปิด map_enabled กลับมา ต้องมีชั้นที่ 2 ครบก่อนเสมอ
 * (จำกัดพิกัดในกรอบไทย, ปัดพิกัดให้ cache ทำงาน, ตัวนับ, เพดานรายวัน)
 * ══════════════════════════════════════════════════════════════════
 */

import type { SettingValues } from "./app-settings";

export interface MapAccessDeps {
  /** อ่านค่าสวิตช์ (ค่าเริ่มต้น: app_settings ผ่าน cache) — ใส่เองได้ในเทสต์ */
  readSettings?: () => Promise<SettingValues>;
}

/**
 * ยิงภาพแผนที่ได้ไหม
 *
 * ⚠️ **fail closed** — อ่านสวิตช์ไม่ได้ไม่ว่าด้วยเหตุใด (ฐานข้อมูลล่ม,
 * ยังไม่ได้รัน migration, เน็ตสะดุด) ให้ถือว่าปิด
 *
 * กติกาเดียวกับ SETTING_DEFAULTS: ไม่รู้ = ไม่จ่าย · แผนที่ที่ไม่ขึ้นทำให้
 * ผู้ใช้เห็นชื่อสถานที่เป็นข้อความแทน ซึ่งยังใช้งานได้ ส่วนแผนที่ที่ขึ้นทั้งที่
 * ควรปิดคือการจ่ายเงินให้ Google โดยไม่ได้ตั้งใจ
 */
export async function mapImageAllowed(
  deps: MapAccessDeps = {},
): Promise<boolean> {
  try {
    const read = deps.readSettings ?? defaultReadSettings;
    const settings = await read();
    return settings.map_enabled === true;
  } catch (cause) {
    console.warn(
      `[map] อ่านสวิตช์ไม่สำเร็จ ถือว่าปิด: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return false;
  }
}

/**
 * ⚠️ import แบบ dynamic โดยตั้งใจ — lib/settings-cache.ts พึ่ง next/cache
 * ซึ่ง test runner ของ Node resolve ไม่ได้ (เหตุผลเดียวกับ lib/branch-harvest.ts)
 */
async function defaultReadSettings(): Promise<SettingValues> {
  const { readCachedSettings } = await import("./settings-cache");
  return readCachedSettings();
}
