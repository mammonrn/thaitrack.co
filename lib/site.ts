/**
 * ที่อยู่ของเว็บ — ใช้ทำ canonical, sitemap และ metadataBase
 *
 * ต้องเป็นค่าสัมบูรณ์เสมอ เพราะ canonical ที่เป็น path เปล่าๆ ทำให้ Google
 * ตีความเป็นคนละหน้ากันเมื่อเข้าถึงได้หลายโดเมน (เช่น preview ของ Vercel)
 * ซึ่งเป็นสาเหตุคลาสสิกของ "หน้าซ้ำ" ที่ทำให้อันดับกระจาย
 */
/**
 * โดเมนจริงของเว็บในรูป punycode — "พัสดุไทย.com"
 *
 * ⚠️ ห้ามเดาค่านี้เอง ตรวจได้ด้วย:
 *   node -e "console.log('xn--l3cgts1b3bzcvf'.split('').length && require('punycode/').toUnicode('xn--l3cgts1b3bzcvf'))"
 *   หรือ python3 -c "print('xn--l3cgts1b3bzcvf'.encode().decode('idna'))"
 *
 * ค่าเดิมในไฟล์นี้เคยเป็นการเดา ซึ่ง decode ออกมาได้ "คฮฦพถท.com" — โดเมนที่
 * ไม่ใช่ของเรา ถ้าหลุดขึ้น production โดยไม่ได้ตั้ง env ทับ canonical ของทุกหน้า
 * จะบอก Google ว่าหน้าจริงอยู่ที่โดเมนอื่น ซึ่งทำให้ทั้งเว็บหายจากผลค้นหา
 * โดยไม่มีอะไรฟ้องเลย
 */
const FALLBACK_URL = "https://xn--l3cgts1b3bzcvf.com";

/** ชื่อตัวแปร env ที่ตั้งที่อยู่จริงของเว็บ */
export const SITE_URL_VAR = "NEXT_PUBLIC_SITE_URL";

/**
 * ที่อยู่เว็บแบบไม่มี / ปิดท้าย
 *
 * ค่าเริ่มต้นเป็นโดเมนจริงในรูป punycode เพราะ URL ที่ส่งให้ Google ต้องเป็น
 * ASCII เสมอ · ตั้งทับผ่าน env ได้ตอนทดสอบบน staging หรือเมื่อโดเมนเปลี่ยน
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
