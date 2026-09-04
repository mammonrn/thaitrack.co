/**
 * อ่านสวิตช์แบบมี cache — สำหรับเส้นทางแสดงผลที่มีคนเข้าเยอะ
 *
 * ------------------------------------------------------------------
 * ทำไมต้อง cache
 *
 * หน้าประวัติเป็น force-dynamic (อ่าน session จาก cookie) จึง render ใหม่ทุก
 * request ถ้าอ่านสวิตช์ตรงๆ ทุกครั้ง เราจะยิงถาม Supabase เพิ่มหนึ่งครั้งต่อการ
 * เปิดหน้าหนึ่งครั้ง เพื่ออ่านค่าที่เปลี่ยนปีละไม่กี่หน — เป็นการจ่ายค่า latency
 * ให้ผู้ใช้ทุกคนเพื่อความสดที่ไม่มีใครต้องการ
 *
 * 60 วินาทีมาจากการชั่งสองด้าน: นานพอให้แทบทุก request ตอบจาก cache
 * และสั้นพอที่ถ้ากลไกล้าง cache พังไป การกดปิดแผนที่จะยังมีผลภายในหนึ่งนาที
 *
 * ⚠️ ตัวเลข 60 นี้เป็น **ตาข่ายรับ ไม่ใช่ทางหลัก** ทางหลักคือ revalidateTag()
 * ที่ API route เรียกทันทีหลังบันทึกสำเร็จ ทำให้ผลของการกดปุ่มเห็นทันที
 * ไม่ต้องรอครบนาที (ดู app/api/admin/settings/route.ts)
 * ------------------------------------------------------------------
 *
 * ⚠️ ห้ามอ่าน cookies/headers ในฟังก์ชันที่ถูก cache — unstable_cache ไม่รองรับ
 * และค่าที่ได้จะรั่วข้ามผู้ใช้ สวิตช์เป็นค่ารวมของทั้งระบบอยู่แล้ว จึงไม่มี
 * อะไรที่ผูกกับผู้ใช้ให้ต้องอ่าน
 */

import { unstable_cache } from "next/cache";

import type { SettingValues } from "./app-settings";
import { readSettings } from "./supabase/app-settings";

/** ป้ายสำหรับล้าง cache ทันทีเมื่อแอดมินเปลี่ยนค่า */
export const SETTINGS_CACHE_TAG = "app-settings";

/** อายุ cache สูงสุด (วินาที) — ตาข่ายรับเผื่อการล้างด้วย tag ไม่ทำงาน */
export const SETTINGS_CACHE_SECONDS = 60;

/**
 * อ่านสวิตช์ผ่าน cache ของ Next
 *
 * readSettings() ไม่โยน error อยู่แล้ว (คืนค่าเริ่มต้นเมื่ออ่านไม่ได้) ค่าที่
 * ถูก cache จึงเป็นค่าที่ใช้ได้เสมอ ไม่มีทางเป็น error ที่ถูกแช่ไว้หนึ่งนาที
 */
export const readCachedSettings: () => Promise<SettingValues> = unstable_cache(
  () => readSettings(),
  ["app-settings"],
  { tags: [SETTINGS_CACHE_TAG], revalidate: SETTINGS_CACHE_SECONDS },
);
