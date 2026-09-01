/**
 * ทางเข้าเดียวของตาราง provider_usage — ยอดการยิงของแต่ละผู้ให้บริการต่อรอบบิล
 *
 * ⚠️ "รอบบิล" ไม่ใช่ "เดือน" — สามเจ้าที่ใช้อยู่มีรอบไม่เหมือนกันเลย (รายวัน /
 * รายเดือนตามวันที่ซื้อ / ไม่รีเซ็ตเลย) คอลัมน์ period จึงเก็บคีย์ที่คำนวณจาก
 * รอบของเจ้านั้นๆ ไม่ใช่เดือนปฏิทิน (ดู lib/billing-period.ts)
 *
 * ดู supabase/migrations/0006_provider_usage_and_branch_probe.sql
 * และ supabase/migrations/0015_provider_billing_period.sql
 *
 * กติกาเดียวกับ ./locations.ts: **ห้ามโยน error ออกไปเด็ดขาด** การนับโควตา
 * ไม่สำเร็จต้องไม่ทำให้การค้นหาพัสดุล้มเหลว ทุกทางที่พังจบที่ log แล้วคืนค่า
 * ที่แปลว่า "นับไม่ได้" ให้ผู้เรียกไปใช้ตัวนับใน memory แทน
 *
 * ⚠️ ใช้ service role key ที่ข้าม RLS ได้ — ตารางนี้เป็นของกลางฝั่งเซิร์ฟเวอร์
 * ไม่ผูกกับผู้ใช้คนใด และไม่มีทางไหนให้ client แตะตรงๆ
 */

import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

const USAGE_TABLE = "provider_usage";

/** ยอดของผู้ให้บริการหนึ่งเจ้าในรอบหนึ่ง */
export interface ProviderUsageRow {
  provider: string;
  period: string;
  callCount: number;
  lastCallAt: string | null;
}

/**
 * สัญญาที่ตัวนับโควตาต้องการ แยกเป็น interface เพื่อให้เทสต์ใส่ตัวปลอมแทนได้
 *
 * bump คืนยอดสะสมใหม่กลับมา (null เมื่อบันทึกไม่ได้) ผู้เรียกจึงรู้ยอดจริง
 * ข้าม instance ได้โดยไม่ต้องอ่านซ้ำอีกรอบ
 */
export interface ProviderUsageStore {
  bump(provider: string, period: string): Promise<number | null>;
  /**
   * อ่านยอดของหลายเจ้าพร้อมกัน โดยแต่ละเจ้าอยู่คนละรอบกันได้
   *
   * รับเป็น { provider: periodKey } เพราะรอบของแต่ละเจ้าไม่ตรงกัน — การอ่าน
   * ด้วยคีย์รอบเดียวแบบเดิมจะได้ยอดของเจ้าที่รอบไม่ตรงกลับมาผิดทั้งหมด
   */
  read(periods: Record<string, string>): Promise<Record<string, number>>;
}

function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[provider-usage] ${action} ล้มเหลว: ${detail}` +
      (hint === null ? "" : ` — ${hint}`),
  );
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toCount(value: unknown): number | null {
  // Postgres คืน bigint มาเป็นข้อความเมื่อค่าเกินช่วงที่ JSON รับได้อย่างปลอดภัย
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export const supabaseProviderUsageStore: ProviderUsageStore = {
  async bump(provider, period) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase.rpc("bump_provider_usage", {
        p_provider: provider,
        p_period: period,
      });

      if (error) {
        warn("นับโควตาที่ใช้", error.message);
        return null;
      }
      return toCount(data);
    } catch (cause) {
      warn("นับโควตาที่ใช้", reason(cause));
      return null;
    }
  },

  async read(periods) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return {};

    const providers = Object.keys(periods);
    if (providers.length === 0) return {};

    try {
      // ยิงรอบเดียวแล้วค่อยจับคู่ฝั่งแอป — การกรองด้วย in() สองชั้นได้แถวเกินมา
      // บ้าง (เจ้า A กับรอบของเจ้า B) แต่ถูกคัดทิ้งตอนจับคู่ ซึ่งถูกกว่าการยิง
      // หนึ่งครั้งต่อเจ้า
      const { data, error } = await supabase
        .from(USAGE_TABLE)
        .select("provider, period, call_count")
        .in("provider", providers)
        .in("period", [...new Set(Object.values(periods))]);

      if (error) {
        warn("อ่านโควตาที่ใช้", error.message);
        return {};
      }

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const count = toCount(record.call_count);
        if (typeof record.provider !== "string" || count === null) continue;
        if (record.period !== periods[record.provider]) continue;

        counts[record.provider] = count;
      }
      return counts;
    } catch (cause) {
      warn("อ่านโควตาที่ใช้", reason(cause));
      return {};
    }
  },
};

/**
 * ยอดของทุกเจ้าในรอบปัจจุบันของแต่ละเจ้า — สำหรับหน้าสถิติของแอดมิน
 *
 * รับ { provider: periodKey } เพราะรอบของแต่ละเจ้าไม่ตรงกัน (ดู read ข้างบน)
 *
 * ⚠️ ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin() มาก่อนเสมอ
 */
export async function listProviderUsage(
  periods: Record<string, string>,
): Promise<ProviderUsageRow[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  const providers = Object.keys(periods);
  if (providers.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from(USAGE_TABLE)
      .select("provider, period, call_count, last_call_at")
      .in("provider", providers)
      .in("period", [...new Set(Object.values(periods))])
      .order("provider");

    if (error) {
      warn("ดึงยอดโควตาของทุกเจ้า", error.message);
      return [];
    }

    return (data ?? [])
      .map((row) => {
        const record = row as Record<string, unknown>;
        const count = toCount(record.call_count);
        if (typeof record.provider !== "string" || count === null) return null;
        if (record.period !== periods[record.provider]) return null;

        return {
          provider: record.provider,
          period: record.period,
          callCount: count,
          lastCallAt:
            typeof record.last_call_at === "string" ? record.last_call_at : null,
        } satisfies ProviderUsageRow;
      })
      .filter((row): row is ProviderUsageRow => row !== null);
  } catch (cause) {
    warn("ดึงยอดโควตาของทุกเจ้า", reason(cause));
    return [];
  }
}
