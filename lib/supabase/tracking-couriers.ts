/**
 * ทางเข้าเดียวของตาราง tracking_couriers — ความจำว่าเลขไหนเป็นของขนส่งเจ้าไหน
 *
 * ดู supabase/migrations/0010_tracking_couriers.sql
 *
 * แยกจาก tracking_cache โดยตั้งใจ เพราะอายุของข้อมูลสองอย่างนี้ต่างกันสิ้นเชิง:
 * สถานะพัสดุเปลี่ยนทุกชั่วโมงและเก่าแล้วไร้ค่า ส่วน "เลขนี้เป็นของ SPX" เป็นจริง
 * ตลอดกาล เคยเก็บรวมกันแล้วเจอปัญหาจริง — พอแถว cache หายไป ความจำเรื่องขนส่ง
 * หายตามไปด้วย และ ETrackings กลับไปไม่ถูกเรียกเหมือนเดิม
 *
 * กติกาเดียวกับ ./locations.ts: **ห้ามโยน error ออกไปเด็ดขาด** ความจำเรื่องขนส่ง
 * เป็นของเสริมที่ทำให้ระบบฉลาดขึ้น ไม่ใช่สิ่งที่ขาดแล้วค้นหาไม่ได้
 *
 * ⚠️ ใช้ service role key ที่ข้าม RLS ได้ — ตารางนี้เป็นของกลาง ไม่มี user_id
 */

import { normalizeCourierCode } from "../carriers/courier-code";
import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

const COURIERS_TABLE = "tracking_couriers";

/**
 * รหัสที่ไม่ควรจำ เพราะไม่ได้บอกว่าเป็นขนส่งเจ้าไหนจริงๆ
 *
 * adapter คืนรหัสของตัวเองมาเมื่อตรวจจับขนส่งไม่ได้ การจำค่าพวกนี้จะทำให้ครั้ง
 * ถัดไปเชื่อว่า "รู้แล้ว" ทั้งที่ไม่รู้ แล้วข้ามโอกาสที่จะตรวจจับใหม่ให้ถูก
 */
const NOT_A_COURIER: ReadonlySet<string> = new Set(["track123", "etrackings"]);

/** สัญญาที่ resolve ต้องการ แยกเป็น interface เพื่อให้เทสต์ใส่ตัวปลอมแทนได้ */
export interface TrackingCourierStore {
  /** รหัสขนส่งที่ยืนยันแล้วของเลขนี้ — null เมื่อยังไม่เคยรู้ */
  read(trackingNumber: string): Promise<string | null>;
  /** จำว่าเลขนี้เป็นของขนส่งเจ้าไหน — เงียบเสมอ ล้มเหลวได้โดยไม่กระทบอะไร */
  remember(
    trackingNumber: string,
    courierCode: string,
    confirmedBy: string,
  ): Promise<void>;
}

function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[tracking-couriers] ${action} ล้มเหลว: ${detail}` +
      (hint === null ? "" : ` — ${hint}`),
  );
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** ค่านี้ควรจำไหม — กันขยะเข้าตารางตั้งแต่ต้นทาง */
export function isRememberable(courierCode: string | null | undefined): boolean {
  const normalized = normalizeCourierCode(courierCode);
  return normalized !== "" && !NOT_A_COURIER.has(normalized);
}

export const supabaseTrackingCourierStore: TrackingCourierStore = {
  async read(trackingNumber) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase
        .from(COURIERS_TABLE)
        .select("courier_code")
        .eq("tracking_number", trackingNumber)
        .maybeSingle();

      if (error) {
        warn("อ่านขนส่งที่จำไว้", error.message);
        return null;
      }

      const code = (data as { courier_code?: unknown } | null)?.courier_code;
      return typeof code === "string" && code !== "" ? code : null;
    } catch (cause) {
      warn("อ่านขนส่งที่จำไว้", reason(cause));
      return null;
    }
  },

  async remember(trackingNumber, courierCode, confirmedBy) {
    if (!isRememberable(courierCode)) return;

    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    try {
      // เก็บรูป normalize เสมอ จะได้ไม่เจอปัญหา flashexpress กับ flash-express
      // เทียบกันไม่ติดซ้ำอีก (ดู lib/carriers/courier-code.ts)
      const { error } = await supabase.rpc("remember_tracking_courier", {
        p_tracking_number: trackingNumber,
        p_courier_code: normalizeCourierCode(courierCode),
        p_confirmed_by: confirmedBy,
      });

      if (error) warn("จำขนส่งของเลขพัสดุ", error.message);
    } catch (cause) {
      warn("จำขนส่งของเลขพัสดุ", reason(cause));
    }
  },
};
