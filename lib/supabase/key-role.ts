/**
 * อ่าน role ที่ฝังอยู่ใน Supabase API key
 *
 * ทำไมต้องมี: key ของ Supabase (anon กับ service_role) หน้าตาเหมือนกันทุกประการ
 * — เป็น JWT ยาวประมาณ 200 ตัวอักษรทั้งคู่ ต่างกันแค่ claim "role" ข้างใน
 * การวางสลับช่องใน .env จึงเกิดขึ้นได้ง่ายมากและ **ไม่มีอะไรเตือนเลย**
 * ระบบจะดูเหมือนตั้งค่าครบ แต่ทุก request โดน "permission denied" เพราะ
 * PostgREST อ่าน role จาก JWT แล้วให้สิทธิ์ตามนั้น
 *
 * อาการนี้เคยเกิดจริงบน production หลัง deploy #13 — cache ถาวรไม่เคยทำงานเลย
 * ทั้งที่ env ถูกตั้งไว้แล้วและ check-env บอกว่าอ่านค่าได้
 *
 * ⚠️ ที่นี่ **ถอดรหัสอย่างเดียว ไม่ได้ตรวจลายเซ็น** — ใช้เพื่อวินิจฉัยการตั้งค่า
 * เท่านั้น ห้ามเอาไปใช้ตัดสินใจเรื่องสิทธิ์ ตัวที่ตัดสินจริงคือ Postgres
 * (ผู้ตรวจลายเซ็นตัวจริง) การถอดฝั่งเราแค่บอกว่า "เราส่งอะไรออกไป"
 */

/** role ที่ Supabase ใช้ */
export const SERVICE_ROLE = "service_role";

/** role ฝั่ง client ที่ห้ามใช้กับตารางของกลาง ถ้าเจอแปลว่าตั้งค่าสลับช่องกัน */
const CLIENT_ROLES = new Set(["anon", "authenticated"]);

export type KeyRoleKind =
  /** เป็น service_role จริง ใช้ได้ */
  | "service_role"
  /** เป็น key ฝั่ง client (anon/authenticated) — ตั้งค่าสลับช่องแน่นอน */
  | "client_role"
  /** อ่านไม่ออกว่าเป็น role อะไร (ไม่ใช่ JWT หรือไม่มี claim role) */
  | "unknown";

export interface KeyRole {
  kind: KeyRoleKind;
  /** ค่า role ที่อ่านได้ — null เมื่ออ่านไม่ออก */
  role: string | null;
}

/** ถอด base64url หนึ่งส่วนของ JWT — คืน null เมื่ออ่านไม่ออก */
function decodeSegment(segment: string): string | null {
  try {
    // base64url ใช้ - กับ _ แทน + กับ / และตัด padding ทิ้ง
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * อ่าน claim "role" ออกจาก key
 *
 * คืน kind = "unknown" เมื่ออ่านไม่ออก ซึ่งเป็นได้ทั้งกรณีที่ค่าผิดจริง และ
 * กรณีที่ Supabase เปลี่ยนรูปแบบ key ในอนาคต (เช่น key แบบใหม่ที่ไม่ใช่ JWT)
 * ผู้เรียกจึงต้องปฏิบัติกับ unknown แบบ "ไม่รู้" ไม่ใช่ "ผิด"
 */
export function readKeyRole(key: string): KeyRole {
  const parts = key.trim().split(".");
  if (parts.length !== 3) return { kind: "unknown", role: null };

  const payload = decodeSegment(parts[1]);
  if (payload === null) return { kind: "unknown", role: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: "unknown", role: null };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "unknown", role: null };
  }

  const role = (parsed as { role?: unknown }).role;
  if (typeof role !== "string" || role.trim() === "") {
    return { kind: "unknown", role: null };
  }

  const value = role.trim();
  if (value === SERVICE_ROLE) return { kind: "service_role", role: value };
  if (CLIENT_ROLES.has(value)) return { kind: "client_role", role: value };

  return { kind: "unknown", role: value };
}

/**
 * ข้อความอธิบายปัญหาที่พร้อมใส่ log — คืน null เมื่อ key ใช้ได้
 *
 * ⚠️ ห้ามใส่ตัว key ลงในข้อความเด็ดขาด บอกได้แค่ role กับความยาว
 */
export function describeKeyProblem(key: string, variableName: string): string | null {
  const { kind, role } = readKeyRole(key);

  if (kind === "service_role") return null;

  if (kind === "client_role") {
    return (
      `${variableName} มีค่าเป็น key ของ role "${role}" ไม่ใช่ "${SERVICE_ROLE}" — ` +
      "แทบแน่นอนว่าวางสลับช่องกับ NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "(key สองตัวนี้หน้าตาเหมือนกันมาก) ให้คัดลอกค่า service_role จาก " +
      "Supabase dashboard → Project Settings → API มาวางใหม่ แล้ว restart"
    );
  }

  return (
    `${variableName} อ่าน role ข้างในไม่ออก (ยาว ${key.trim().length} ตัวอักษร` +
    `${role === null ? "" : `, role="${role}"`}) — ` +
    "ถ้าเป็น key รูปแบบใหม่ที่ไม่ใช่ JWT ถือว่าปกติ ระบบจะใช้งานต่อตามเดิม " +
    "แต่ถ้าเจอ permission denied ตามมา ให้ตรวจว่าวางค่าถูกช่องหรือไม่"
  );
}

/**
 * ข้อความช่วยวินิจฉัยเมื่อ Postgres ปฏิเสธเพราะสิทธิ์ — คืน null เมื่อไม่ใช่กรณีนั้น
 *
 * "permission denied" แปลว่า request ออกไปถึงและถูกยืนยันตัวตนแล้ว แต่ role
 * ที่ได้ไม่มีสิทธิ์ ซึ่งเหลือสาเหตุที่เป็นไปได้แค่สองอย่าง — บอกทั้งคู่ไว้เลย
 * จะได้ไม่ต้องไปไล่หาเอง
 */
export function explainPermissionDenied(message: string): string | null {
  if (!/permission denied/i.test(message)) return null;

  return (
    "สาเหตุที่เป็นไปได้มีสองอย่าง: " +
    "(1) ค่าใน SUPABASE_SERVICE_ROLE_KEY ไม่ใช่ key ของ service_role จริง " +
    "(ดูบรรทัด [supabase] ตอนเริ่มระบบว่า role อะไร) หรือ " +
    "(2) ยังไม่ได้รัน supabase/migrations/0005_service_role_grants.sql " +
    "ซึ่งให้สิทธิ์ service_role กับตารางของกลางแบบเขียนไว้ชัดๆ"
  );
}
