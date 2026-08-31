/**
 * ทางเข้าเดียวของตาราง provider_usage — ยอดการยิงของแต่ละผู้ให้บริการต่อเดือน
 *
 * ดู supabase/migrations/0006_provider_usage_and_branch_probe.sql
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

/** ยอดของผู้ให้บริการหนึ่งเจ้าในเดือนหนึ่ง */
export interface ProviderUsageRow {
  provider: string;
  month: string;
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
  bump(provider: string, month: string): Promise<number | null>;
  read(month: string): Promise<Record<string, number>>;
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
  async bump(provider, month) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase.rpc("bump_provider_usage", {
        p_provider: provider,
        p_month: month,
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

  async read(month) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return {};

    try {
      const { data, error } = await supabase
        .from(USAGE_TABLE)
        .select("provider, call_count")
        .eq("month", month);

      if (error) {
        warn("อ่านโควตาที่ใช้", error.message);
        return {};
      }

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const count = toCount(record.call_count);
        if (typeof record.provider === "string" && count !== null) {
          counts[record.provider] = count;
        }
      }
      return counts;
    } catch (cause) {
      warn("อ่านโควตาที่ใช้", reason(cause));
      return {};
    }
  },
};

/**
 * ยอดของทุกเจ้าในเดือนที่ระบุ — สำหรับหน้าสถิติของแอดมิน
 *
 * ⚠️ ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin() มาก่อนเสมอ
 */
export async function listProviderUsage(
  month: string,
): Promise<ProviderUsageRow[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase
      .from(USAGE_TABLE)
      .select("provider, month, call_count, last_call_at")
      .eq("month", month)
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

        return {
          provider: record.provider,
          month: typeof record.month === "string" ? record.month : month,
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
