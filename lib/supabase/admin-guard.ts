/**
 * ด่านตรวจสิทธิ์แอดมินฝั่งเซิร์ฟเวอร์ — ทางเดียวที่ทุกจุดของแอดมินต้องผ่าน
 *
 * ทั้งหน้าเว็บ (Server Component) และทุก API route ที่แตะข้อมูลแอดมินต้องเรียก
 * requireAdmin() ก่อนทำอะไรทั้งสิ้น ไม่มีข้อยกเว้น
 *
 * ⚠️ เหตุผลที่ต้องเป็นฝั่งเซิร์ฟเวอร์: การซ่อนปุ่มหรือ redirect ฝั่ง client
 * กันได้แค่คนที่ใช้หน้าเว็บตามปกติ คนที่เปิด devtools แล้วยิง fetch ไปที่
 * /api/admin/... ตรงๆ ไม่ผ่านหน้าเว็บเลย ต้องโดนปฏิเสธที่นี่
 *
 * ใช้ createServerSupabaseClient() ที่ผูกกับ cookie ของผู้ใช้ ไม่ใช่ service
 * role — เพราะต้องรู้ว่า "คนที่ยิงมาคือใคร" ซึ่ง service role ตอบไม่ได้
 * (มันไม่ได้เป็นใครเลย) getUser() ยืนยัน token กับ Supabase จริงทุกครั้ง
 * ไม่ใช่แค่อ่านค่าจาก cookie มาเชื่อ
 */

import { authorizeAdmin, readAdminEmails, type AdminCheck } from "../admin";
import { SupabaseConfigError } from "./env";
import { createServerSupabaseClient } from "./server";

/**
 * ตรวจว่าคำขอนี้มาจากแอดมินหรือไม่
 *
 * ไม่ throw ในทางที่ปฏิเสธ — คืนเหตุผลกลับไปให้ผู้เรียกตัดสินใจว่าจะตอบ
 * 404 (หน้าเว็บ ไม่บอกว่ามีหน้านี้อยู่) หรือ 403 (API) ส่วนความล้มเหลวของ
 * การตั้งค่าถูกกลืนเป็น not_configured เพราะผลลัพธ์ที่ต้องการเหมือนกันคือ
 * "ไม่ให้ผ่าน"
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const adminEmails = readAdminEmails();

  // เช็คก่อนเรียก Supabase — ถ้ายังไม่ได้ตั้งรายชื่อแอดมิน ไม่มีใครผ่านได้อยู่ดี
  // ไม่ต้องเสียเวลาไปถามว่าคนที่ยิงมาเป็นใคร
  if (adminEmails.length === 0) return { ok: false, reason: "not_configured" };

  let user: { email?: string | null } | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();

    // error ที่นี่คือ token ไม่ผ่านการยืนยัน = ถือว่ายังไม่ได้เข้าสู่ระบบ
    if (error) return { ok: false, reason: "unauthenticated" };
    user = data.user;
  } catch (cause) {
    if (cause instanceof SupabaseConfigError) {
      return { ok: false, reason: "not_configured" };
    }
    // เครือข่ายพังหรือ Supabase ล่ม — ปฏิเสธไว้ก่อน ห้ามปล่อยผ่าน
    console.error(
      `[admin] ตรวจสิทธิ์ไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return { ok: false, reason: "unauthenticated" };
  }

  return authorizeAdmin(user, adminEmails);
}
