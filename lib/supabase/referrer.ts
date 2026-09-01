/**
 * ทางเข้าเดียวของตาราง referrer_daily — ตัวนับช่องทางที่มาแบบรวมต่อวัน
 *
 * ดู supabase/migrations/0017_referrer_channels.sql
 *
 * กติกาเดียวกับ ./search-events.ts: **ห้ามโยน error ออกไปเด็ดขาด** และ
 * **ห้ามรับหรือเก็บอะไรที่ระบุตัวคนได้** — รับได้แค่คำเดียวจากชุดปิด
 */

import type { ReferrerChannel } from "../referrer-channel";
import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[referrer] ${action} ล้มเหลว: ${detail}` +
      (hint === null ? "" : ` — ${hint}`),
  );
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** นับการเข้าชมจากช่องทางนี้หนึ่งครั้ง — วันถูกคำนวณในฐานข้อมูลด้วยเวลาไทย */
export async function recordReferrerVisit(
  channel: ReferrerChannel,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return;

  try {
    const { error } = await supabase.rpc("bump_referrer_visit", {
      p_channel: channel,
    });

    if (error) warn("นับช่องทางที่มา", error.message);
  } catch (cause) {
    warn("นับช่องทางที่มา", reason(cause));
  }
}

export interface ReferrerCount {
  channel: string;
  total: number;
}

/**
 * ยอดแยกตามช่องทางในกี่วันล่าสุด
 *
 * ⚠️ ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin() มาก่อนเสมอ
 */
export async function readReferrerChannels(
  days: number,
): Promise<ReferrerCount[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase.rpc("admin_referrer_channels", {
      p_days: days,
    });

    if (error) {
      warn("อ่านช่องทางที่มา", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: unknown) => {
        const record = row as Record<string, unknown>;
        if (typeof record.channel !== "string") return null;

        const total = record.total;
        const value =
          typeof total === "number"
            ? total
            : typeof total === "string" && /^\d+$/.test(total)
              ? Number(total)
              : 0;

        return { channel: record.channel, total: value } satisfies ReferrerCount;
      })
      .filter((row: ReferrerCount | null): row is ReferrerCount => row !== null);
  } catch (cause) {
    warn("อ่านช่องทางที่มา", reason(cause));
    return [];
  }
}
