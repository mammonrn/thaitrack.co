/**
 * แพลตฟอร์มกว้างๆ ของเครื่องที่เปิดเว็บอยู่ — ใช้ร่วมกันทุกที่ที่ส่งสถิติ
 *
 * ⚠️ ตั้งใจให้หยาบขนาดนี้เพราะความเป็นส่วนตัว: user agent เต็มเป็นค่าที่เอาไป
 * ระบุตัวเครื่องได้ (fingerprint) ส่วนคำสี่คำนี้บอกได้แค่ว่าเป็นมือถือค่ายไหน
 * ซึ่งเป็นข้อมูลที่หน้าสถิติต้องใช้จริง — ทางติดตั้งของ iOS กับ Android ต่างกัน
 * คนละเรื่อง (Safari ต้องกดเพิ่มเอง Chrome เรียกหน้าต่างให้ได้) ถ้าแยกไม่ออก
 * เราจะอ่าน conversion rate รวมๆ แล้วสรุปผิด
 *
 * อยู่ในไฟล์ของตัวเองเพื่อไม่ให้ use-install-state กับ install-invite ต้อง
 * import วนกัน
 */
export type Platform = "android" | "ios" | "desktop" | "unknown";

/** ชุดปิดที่ฝั่งเซิร์ฟเวอร์ใช้ตรวจซ้ำ — ค่าอื่นกลายเป็น unknown ไม่ใช่ถูกเก็บดิบ */
export const PLATFORMS: ReadonlySet<string> = new Set([
  "android",
  "ios",
  "desktop",
]);

export function detectPlatform(): Platform {
  const agent = navigator.userAgent;

  if (/android/i.test(agent)) return "android";
  if (/iphone|ipad|ipod/i.test(agent)) return "ios";
  if (/windows|macintosh|linux/i.test(agent)) return "desktop";
  return "unknown";
}
