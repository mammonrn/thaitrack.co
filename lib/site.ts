/**
 * ที่อยู่ของเว็บ — ใช้ทำ canonical, sitemap และ metadataBase
 *
 * ต้องเป็นค่าสัมบูรณ์เสมอ เพราะ canonical ที่เป็น path เปล่าๆ ทำให้ Google
 * ตีความเป็นคนละหน้ากันเมื่อเข้าถึงได้หลายโดเมน (เช่น preview ของ Vercel)
 * ซึ่งเป็นสาเหตุคลาสสิกของ "หน้าซ้ำ" ที่ทำให้อันดับกระจาย
 */
const FALLBACK_URL = "https://xn--42c0bd0a3b8b.com";

/** ชื่อตัวแปร env ที่ตั้งที่อยู่จริงของเว็บ */
export const SITE_URL_VAR = "NEXT_PUBLIC_SITE_URL";

/**
 * ที่อยู่เว็บแบบไม่มี / ปิดท้าย
 *
 * ค่าเริ่มต้นเป็นโดเมนภาษาไทยในรูป punycode เพราะ URL ที่ส่งให้ Google ต้องเป็น
 * ASCII เสมอ · ตั้งทับผ่าน env ได้เมื่อโดเมนเปลี่ยนหรือตอนทดสอบบน staging
 */
export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const value = raw === "" ? FALLBACK_URL : raw;
  return value.replace(/\/+$/, "");
}

/**
 * URL เต็มของ path หนึ่ง โดย encode ส่วนที่เป็นภาษาไทยให้เรียบร้อย
 *
 * ⚠️ จำเป็นเพราะ slug ของเราเป็นภาษาไทย ("เช็คพัสดุ-flash") — ถ้าใส่ดิบๆ ลงใน
 * sitemap.xml ตัวไฟล์จะไม่ผ่านการตรวจของ Google ซึ่งบังคับว่า URL ต้องเป็น
 * ASCII ที่ escape แล้ว ส่วน <Link href> ไม่ต้องทำเอง Next encode ให้ตอน render
 */
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;

  const encoded = clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${siteUrl()}${encoded}`;
}
