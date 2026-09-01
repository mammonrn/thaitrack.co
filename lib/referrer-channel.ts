/**
 * จำแนก "ช่องทางที่มา" ของผู้เข้าชมเป็นกลุ่มหยาบๆ
 *
 * ------------------------------------------------------------------
 * ⚠️ ข้อบังคับด้านความเป็นส่วนตัว — กติกาเดียวกับ search_events
 *
 * สิ่งที่ออกจากไฟล์นี้ได้มีอย่างเดียวคือ **คำเดียวจากชุดปิดข้างล่าง**
 *   ห้ามส่ง URL เต็มของหน้าที่มา (มันมีทั้ง path และ query ที่ระบุตัวได้)
 *   ห้ามส่ง user agent, ความละเอียดจอ, ภาษา หรืออะไรที่เอาไปทำ fingerprint ได้
 *   ห้ามผูกกับ user id
 *
 * "referrer เต็ม" เป็นข้อมูลที่ล่อใจมากเพราะมีประโยชน์กว่า แต่มันคือการรู้ว่า
 * คนคนหนึ่งเพิ่งอ่านอะไรอยู่ก่อนมาถึงเรา ซึ่งไม่ใช่เรื่องของเรา สิ่งที่เรา
 * ต้องการจริงคือ "ควรลงแรงที่ช่องทางไหน" ซึ่งคำเดียวตอบได้ครบแล้ว
 * ------------------------------------------------------------------
 */

/** ช่องทางที่มา — ชุดปิด ต้องตรงกับ constraint ของตารางใน migration 0017 */
export type ReferrerChannel =
  | "google"
  | "facebook"
  | "tiktok"
  | "line"
  | "instagram"
  | "direct"
  | "other";

export const REFERRER_CHANNELS: readonly ReferrerChannel[] = [
  "google",
  "facebook",
  "tiktok",
  "line",
  "instagram",
  "direct",
  "other",
];

/**
 * คำที่พบใน hostname ของแต่ละช่องทาง
 *
 * เทียบแบบ "ลงท้ายด้วยโดเมนนี้" ไม่ใช่ "มีคำนี้อยู่ที่ไหนก็ได้" — ไม่งั้น
 * เว็บอย่าง "not-google.example.com" จะถูกนับเป็น google
 *
 * รวม line กับ instagram เข้ามาด้วยทั้งที่โจทย์ไม่ได้ระบุ เพราะทั้งคู่เป็น
 * ช่องทางหลักของคนไทยจริงๆ การเหมาไปอยู่ใน "other" จะทำให้กลุ่มนั้นใหญ่จน
 * ไม่ได้บอกอะไรเลย ซึ่งเป็นอาการที่ทำให้สถิติกลายเป็นของประดับ
 */
const DOMAINS: ReadonlyArray<[ReferrerChannel, readonly string[]]> = [
  ["google", ["google.com", "google.co.th", "googleusercontent.com"]],
  ["facebook", ["facebook.com", "fb.com", "m.facebook.com", "messenger.com"]],
  ["tiktok", ["tiktok.com"]],
  ["line", ["line.me", "line-apps.com", "linecorp.com"]],
  ["instagram", ["instagram.com"]],
];

/** คำใน utm_source ที่ชี้ช่องทางได้ตรงๆ */
const UTM_SOURCES: ReadonlyArray<[ReferrerChannel, readonly string[]]> = [
  ["google", ["google", "adwords", "gads"]],
  ["facebook", ["facebook", "fb", "meta", "messenger"]],
  ["tiktok", ["tiktok"]],
  ["line", ["line", "lineoa"]],
  ["instagram", ["instagram", "ig"]],
];

/** โดเมนตรงกันหรือเป็นโดเมนย่อยของมัน */
function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * จำแนกช่องทางจาก referrer กับ utm_source
 *
 * utm_source มาก่อนเพราะเป็นสิ่งที่เราตั้งเองตอนทำแคมเปญ จึงตรงกว่า referrer
 * ที่บางแอปเขียนมาไม่ครบหรือไม่เขียนเลย (แอปมือถือหลายตัวเปิดลิงก์แบบไม่ส่ง
 * referrer ซึ่งจะกลายเป็น direct ทั้งที่มาจากโซเชียล — ข้อจำกัดที่แก้ไม่ได้
 * และต้องเขียนกำกับไว้บนหน้าสถิติ)
 *
 * @param referrer ค่าจาก document.referrer ("" เมื่อไม่มี)
 * @param utmSource ค่าจาก query string ("" เมื่อไม่มี)
 * @param selfHost โดเมนของเราเอง — ใช้ตัดการเดินภายในเว็บออก
 */
export function classifyChannel(
  referrer: string,
  utmSource: string,
  selfHost: string,
): ReferrerChannel | null {
  const source = utmSource.trim().toLowerCase();
  if (source !== "") {
    for (const [channel, keys] of UTM_SOURCES) {
      if (keys.includes(source)) return channel;
    }
    return "other";
  }

  const raw = referrer.trim();
  if (raw === "") return "direct";

  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // referrer ที่แปลงเป็น URL ไม่ได้ = ไม่รู้ว่ามาจากไหน ไม่ใช่ "มาตรงๆ"
    return "other";
  }

  // เดินภายในเว็บเราเอง → ไม่ใช่การเข้าชมใหม่ ไม่ต้องนับ
  if (host === selfHost.toLowerCase().replace(/^www\./, "")) return null;

  for (const [channel, domains] of DOMAINS) {
    if (domains.some((domain) => matchesDomain(host, domain))) return channel;
  }

  return "other";
}
