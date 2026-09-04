/**
 * ทางเข้าเดียวของตาราง app_settings — สวิตช์เปิด/ปิดฟีเจอร์จากหลังบ้าน
 *
 * ดู supabase/migrations/0019_app_settings.sql
 *
 * กติกาเดียวกับ ./provider-usage.ts และ ./locations.ts: **ห้ามโยน error ออกไป
 * เด็ดขาด** ถ้าฐานข้อมูลล่ม ช้า หรือยังไม่ได้รัน migration หน้าเว็บต้องทำงาน
 * ต่อได้ด้วยค่าเริ่มต้น ไม่ใช่พังทั้งหน้าเพราะอ่านสวิตช์ไม่ได้
 *
 * ⚠️ ใช้ service role key ที่ข้าม RLS ได้ — ตารางนี้เป็นของกลางฝั่งเซิร์ฟเวอร์
 * เบราว์เซอร์ไม่มีทางแตะตรงๆ ทุกการเขียนต้องผ่าน API route ที่ตรวจสิทธิ์แอดมิน
 * ก่อนเสมอ (app/api/admin/settings/route.ts)
 */

import {
  defaultSettings,
  parseSettings,
  type SettingKey,
  type SettingValues,
} from "../app-settings";
import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

const TABLE = "app_settings";

/** log ปัญหาแบบสั้นๆ — ไม่ใช่ error ของการใช้งาน จึงเป็น warn ไม่ใช่ error */
function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[app-settings] ${action} ล้มเหลว: ${detail}` + (hint === null ? "" : ` — ${hint}`),
  );
}

/**
 * อ่านสวิตช์ทั้งหมด — คืนค่าเริ่มต้นเมื่ออ่านไม่ได้
 *
 * ⚠️ ห้ามเรียกตรงๆ จากเส้นทางแสดงผลที่มีคนเข้าเยอะ ให้เรียกผ่านตัวที่ห่อ cache
 * ไว้แล้ว (readCachedSettings ใน lib/settings-cache.ts) ไม่งั้นหน้าประวัติจะ
 * ยิงถาม Supabase เพิ่มหนึ่งครั้งต่อการเปิดหน้าหนึ่งครั้ง เพื่ออ่านค่าที่แทบ
 * ไม่เคยเปลี่ยน
 */
export async function readSettings(): Promise<SettingValues> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return defaultSettings();

  try {
    const { data, error } = await supabase.from(TABLE).select("key, value");

    if (error !== null) {
      warn("อ่านสวิตช์", error.message);
      return defaultSettings();
    }

    return parseSettings(data);
  } catch (cause) {
    warn("อ่านสวิตช์", cause instanceof Error ? cause.message : String(cause));
    return defaultSettings();
  }
}

/**
 * เขียนสวิตช์หนึ่งตัว — คืน true เมื่อบันทึกสำเร็จจริง
 *
 * ต่างจากการอ่านตรงที่ผู้เรียกต้องรู้ว่าสำเร็จไหม เพราะแอดมินกดปุ่มแล้วต้อง
 * ได้คำตอบว่าเปลี่ยนติดหรือไม่ การกลืน error เงียบๆ ตรงนี้จะทำให้ปุ่มดูเหมือน
 * ทำงานทั้งที่ค่าไม่เคยถูกบันทึก
 *
 * upsert เพราะแถวอาจยังไม่มี (ยังไม่ได้รันส่วน insert ของ migration หรือมี
 * คนลบทิ้ง) — สวิตช์ต้องตั้งได้เสมอ ไม่ใช่ต้องไปสร้างแถวก่อน
 */
export async function writeSetting(
  key: SettingKey,
  value: boolean,
): Promise<boolean> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) {
    warn("เขียนสวิตช์", "ยังไม่ได้ตั้ง service role key");
    return false;
  }

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (error !== null) {
      warn(`เขียนสวิตช์ ${key}`, error.message);
      return false;
    }

    return true;
  } catch (cause) {
    warn(
      `เขียนสวิตช์ ${key}`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return false;
  }
}
