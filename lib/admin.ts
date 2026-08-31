/**
 * ตรรกะการตัดสินสิทธิ์แอดมิน — ฟังก์ชันบริสุทธิ์ล้วน ไม่แตะเครือข่าย
 *
 * แยกออกมาจากตัวที่คุยกับ Supabase เพื่อให้เทสต์ครอบทุกทางได้จริง โดยเฉพาะ
 * ทางที่ต้อง "ปฏิเสธ" ซึ่งเป็นทางที่ทดสอบด้วยมือแล้วมองไม่เห็นว่าพลาด —
 * ระบบที่ปล่อยคนที่ไม่ใช่แอดมินผ่านจะดู "ทำงานได้ปกติ" ทุกประการ
 *
 * ⚠️ กติกาข้อเดียวที่ห้ามลืม: การซ่อนปุ่มหรือซ่อนหน้าฝั่ง client ไม่ใช่การ
 * ป้องกัน ทุกจุดที่อ่านหรือเขียนข้อมูลแอดมินต้องเรียกฟังก์ชันในไฟล์นี้จาก
 * ฝั่งเซิร์ฟเวอร์ คนที่ยิง API ตรงต้องโดนปฏิเสธ ไม่ใช่แค่มองไม่เห็นปุ่ม
 */

/** ชื่อตัวแปร env — ห้ามขึ้นต้นด้วย NEXT_PUBLIC_ เพราะจะหลุดไปฝั่งเบราว์เซอร์ */
export const ADMIN_EMAILS_VAR = "ADMIN_EMAILS";

export type AdminDenyReason =
  /** ยังไม่ได้เข้าสู่ระบบ */
  | "unauthenticated"
  /** เข้าสู่ระบบแล้วแต่ไม่ได้อยู่ในรายชื่อแอดมิน */
  | "not_admin"
  /** ยังไม่ได้ตั้ง ADMIN_EMAILS — ปฏิเสธทุกคน ไม่ใช่ปล่อยผ่านทุกคน */
  | "not_configured";

export type AdminCheck =
  | { ok: true; email: string }
  | { ok: false; reason: AdminDenyReason };

/**
 * แยกรายชื่ออีเมลจากค่า env
 *
 * รับได้ทั้งคั่นด้วยคอมมา ช่องว่าง หรือขึ้นบรรทัดใหม่ เพราะคนตั้งค่ามักวาง
 * รายชื่อมาคนละแบบ และตัดเครื่องหมายคำพูดที่ติดมาจากการคัดลอกออกให้
 *
 * เทียบอีเมลแบบตัวพิมพ์เล็กเสมอ — ผู้ให้บริการอีเมลไม่แยกตัวพิมพ์ในส่วนโดเมน
 * และ Google ก็ไม่แยกในส่วนชื่อ การเทียบแบบตรงตัวจะทำให้แอดมินที่พิมพ์
 * ตัวใหญ่ตัวเดียวเข้าไม่ได้โดยไม่รู้สาเหตุ
 */
export function parseAdminEmails(raw: string | undefined): string[] {
  if (typeof raw !== "string") return [];

  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim().replace(/^["']|["']$/g, "").toLowerCase())
    // ต้องมี @ และมีอะไรอยู่ทั้งสองข้าง ไม่งั้นเป็นค่าที่พิมพ์ผิด
    .filter((value) => /^[^@\s]+@[^@\s]+$/.test(value));
}

/** อ่านรายชื่อแอดมินจาก env — คืน [] เมื่อยังไม่ได้ตั้งค่า */
export function readAdminEmails(): string[] {
  // เขียนชื่อตัวแปรเต็มๆ ตรงนี้ ไม่อ้างแบบไดนามิก (เหตุผลเดียวกับ lib/supabase/env.ts)
  return parseAdminEmails(process.env.ADMIN_EMAILS);
}

/**
 * ตัดสินว่าผู้ใช้คนนี้เป็นแอดมินหรือไม่
 *
 * ปฏิเสธเมื่อยังไม่ได้ตั้ง ADMIN_EMAILS โดยตั้งใจ (fail closed) — ระบบที่
 * "ยังไม่ได้ตั้งค่า" ต้องแปลว่าไม่มีใครเข้าได้ ไม่ใช่ทุกคนเข้าได้
 */
export function authorizeAdmin(
  user: { email?: string | null } | null | undefined,
  adminEmails: readonly string[],
): AdminCheck {
  if (adminEmails.length === 0) return { ok: false, reason: "not_configured" };

  const email = user?.email?.trim().toLowerCase() ?? "";
  if (email === "") return { ok: false, reason: "unauthenticated" };

  if (!adminEmails.includes(email)) return { ok: false, reason: "not_admin" };

  return { ok: true, email };
}
