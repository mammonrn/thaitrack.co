/**
 * อ่านค่าเชื่อมต่อ Supabase จาก environment variable
 *
 * แยกออกมาเป็นไฟล์เดียวเพราะเป็นจุดที่พังเงียบได้ง่ายที่สุด: ค่า NEXT_PUBLIC_*
 * ถูกฝังลงไฟล์ JS ตอน `next build` ไม่ได้อ่านตอน runtime ถ้าตอน build
 * ไม่มีค่า ผลลัพธ์คือ undefined ติดไปกับไฟล์ที่ deploy โดยไม่มี error ใดๆ
 * ให้เห็น ที่นี่จึงตรวจให้ชัดแล้วบอกออกไปว่าตัวไหนขาด แทนที่จะปล่อยผ่าน
 */

/** ชื่อตัวแปรจริงที่ใช้ในไฟล์ .env — ใช้ประกอบข้อความบอกผู้ดูแลระบบว่าต้องเพิ่มอะไร */
export const SUPABASE_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export type SupabaseEnvResult =
  | { ok: true; env: SupabaseEnv }
  | { ok: false; missing: string[] };

/** ข้อผิดพลาดตอนตั้งค่าระบบ ไม่ใช่ความผิดของผู้ใช้ — ผู้เรียกต้องดักแล้วแปลงเป็นข้อความไทย */
export class SupabaseConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`ตั้งค่า Supabase ไม่ครบ ขาดตัวแปร: ${missing.join(", ")}`);
    this.name = "SupabaseConfigError";
    this.missing = missing;
  }
}

/**
 * ตัดช่องว่างหัวท้าย และเครื่องหมายคำพูดที่มักติดมาเวลาคัดลอกค่าจาก dashboard
 * มาวางในไฟล์ .env (dotenv ถอดคำพูดให้ชั้นเดียว ถ้าใส่ซ้อนสองชั้นจะเหลือติดมา)
 */
function normalize(value: string | undefined): string {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));

  return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * คืนค่าที่ใช้ต่อได้ทันที หรือรายชื่อตัวแปรที่ยังขาด
 *
 * หมายเหตุสำคัญ: ต้องเขียน `process.env.NEXT_PUBLIC_...` เต็มๆ ตรงนี้เท่านั้น
 * ห้ามเขียนเป็น process.env[ชื่อตัวแปร] เพราะ Next แทนค่าตอน build ด้วยการ
 * จับคู่ข้อความแบบตรงตัว การอ้างแบบไดนามิกจะได้ undefined เสมอในฝั่งเบราว์เซอร์
 */
export function readSupabaseEnv(): SupabaseEnvResult {
  const url = normalize(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = normalize(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const missing: string[] = [];
  if (url === "") missing.push(SUPABASE_URL_VAR);
  if (anonKey === "") missing.push(SUPABASE_ANON_KEY_VAR);

  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, env: { url, anonKey } };
}
