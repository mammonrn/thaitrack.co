/**
 * ทางเข้าเดียวของตาราง search_events และตัวเลขสรุปที่หน้าสถิติแอดมินใช้
 *
 * ดู supabase/migrations/0007_search_events.sql
 *
 * ------------------------------------------------------------------ --
 * ⚠️ ข้อบังคับด้านความเป็นส่วนตัว — อ่านก่อนแก้ไฟล์นี้ทุกครั้ง
 *
 * ไฟล์นี้ต้องตอบได้แค่ "มีคนค้นกี่ครั้ง ผลเป็นอย่างไร" เท่านั้น
 * **ห้ามมีทางใดที่ทำให้ตอบได้ว่า "ผู้ใช้คนไหนค้นพัสดุอะไร"**
 *
 *   ห้ามรับหรือเก็บ user id, อีเมล, IP, user agent, session
 *   ห้ามรับหรือเก็บเลขพัสดุ
 *   ห้ามมีฟังก์ชันที่คืนแถวดิบ — คืนได้เฉพาะตัวเลขรวม
 *
 * มีเทสต์เฝ้ากติกานี้อยู่ที่ lib/admin-privacy.test.ts ซึ่งอ่านซอร์สจริง
 * ถ้าเทสต์นั้นล้ม อย่าแก้เทสต์ ให้แก้โค้ด
 * ------------------------------------------------------------------ --
 *
 * กติกาเดียวกับ ./locations.ts: **ห้ามโยน error ออกไปเด็ดขาด** การบันทึกสถิติ
 * ไม่สำเร็จต้องไม่ทำให้การค้นหาของผู้ใช้ล้มเหลว
 */

import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

const EVENTS_TABLE = "search_events";

/** ผลของการค้นหนึ่งครั้ง */
export type SearchOutcome = "found" | "not_found" | "error";

/** สิ่งเดียวที่บันทึกต่อการค้นหนึ่งครั้ง — ไม่มีอะไรที่ระบุตัวคนได้เลย */
export interface SearchEventInput {
  /** รหัสขนส่งของผลลัพธ์ — null เมื่อค้นไม่เจอจึงไม่รู้ว่าเจ้าไหน */
  carrierCode: string | null;
  outcome: SearchOutcome;
  /** ชั้นที่ตอบ: memory | supabase | api | error */
  source: string;
  /** ผู้ให้บริการที่ตอบ: primary | fallback | backup | cache | none */
  provider: string;
  stale: boolean;
}

function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[search-events] ${action} ล้มเหลว: ${detail}` +
      (hint === null ? "" : ` — ${hint}`),
  );
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return 0;
}

/**
 * บันทึกว่ามีการค้นหนึ่งครั้ง
 *
 * เรียกจาก /api/track ที่เดียว เพราะ "หนึ่งการค้นหาของผู้ใช้" คือหนึ่งครั้ง
 * ที่คนกดค้น ไม่ใช่ทุกครั้งที่โค้ดภายในเรียก resolveTracking (การกดบันทึก
 * ประวัติก็เรียกด้วย ถ้านับด้วยจะกลายเป็นนับซ้ำคนละความหมาย)
 */
export async function recordSearchEvent(
  input: SearchEventInput,
): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return;

  try {
    const { error } = await supabase.from(EVENTS_TABLE).insert({
      carrier_code: input.carrierCode,
      outcome: input.outcome,
      source: input.source,
      provider: input.provider,
      stale: input.stale,
    });

    if (error) warn("บันทึกสถิติการค้นหา", error.message);
  } catch (cause) {
    warn("บันทึกสถิติการค้นหา", reason(cause));
  }
}

/* ------------------------------------------------------------------ *
 * ตัวเลขสรุปสำหรับหน้าสถิติ
 *
 * ⚠️ ทุกฟังก์ชันในกลุ่มนี้ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin()
 * (lib/supabase/admin-guard.ts) มาก่อนเสมอ
 * ------------------------------------------------------------------ */

export interface SearchOverview {
  total: number;
  found: number;
  notFound: number;
  error: number;
  fromCache: number;
  fromApi: number;
  stale: number;
}

const EMPTY_OVERVIEW: SearchOverview = {
  total: 0,
  found: 0,
  notFound: 0,
  error: 0,
  fromCache: 0,
  fromApi: 0,
  stale: 0,
};

/** ยอดรวมในช่วงกี่วันล่าสุด — 0 = ตั้งแต่ต้น */
export async function readSearchOverview(
  days: number,
): Promise<SearchOverview> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return EMPTY_OVERVIEW;

  try {
    const { data, error } = await supabase.rpc("admin_search_overview", {
      p_days: days,
    });

    if (error) {
      warn("อ่านสรุปการค้นหา", error.message);
      return EMPTY_OVERVIEW;
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      total: toCount(row.total),
      found: toCount(row.found),
      notFound: toCount(row.not_found),
      error: toCount(row.error),
      fromCache: toCount(row.from_cache),
      fromApi: toCount(row.from_api),
      stale: toCount(row.stale),
    };
  } catch (cause) {
    warn("อ่านสรุปการค้นหา", reason(cause));
    return EMPTY_OVERVIEW;
  }
}

export interface DailySearchCount {
  /** วันที่ตามเวลาไทย รูปแบบ YYYY-MM-DD */
  day: string;
  total: number;
  found: number;
}

/** จำนวนการค้นแยกตามวัน เรียงจากเก่าไปใหม่ */
export async function readSearchDaily(
  days: number,
): Promise<DailySearchCount[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase.rpc("admin_search_daily", {
      p_days: days,
    });

    if (error) {
      warn("อ่านการค้นหารายวัน", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: unknown) => {
        const record = row as Record<string, unknown>;
        if (typeof record.day !== "string") return null;
        return {
          day: record.day,
          total: toCount(record.total),
          found: toCount(record.found),
        } satisfies DailySearchCount;
      })
      .filter((row: DailySearchCount | null): row is DailySearchCount =>
        row !== null,
      );
  } catch (cause) {
    warn("อ่านการค้นหารายวัน", reason(cause));
    return [];
  }
}

export interface CarrierCount {
  carrierCode: string;
  total: number;
}

/** ขนส่งที่ถูกค้นเจอบ่อยที่สุด */
export async function readTopCarriers(
  days: number,
  limit: number,
): Promise<CarrierCount[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase.rpc("admin_top_carriers", {
      p_days: days,
      p_limit: limit,
    });

    if (error) {
      warn("อ่านขนส่งยอดนิยม", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: unknown) => {
        const record = row as Record<string, unknown>;
        if (typeof record.carrier_code !== "string") return null;
        return {
          carrierCode: record.carrier_code,
          total: toCount(record.total),
        } satisfies CarrierCount;
      })
      .filter((row: CarrierCount | null): row is CarrierCount => row !== null);
  } catch (cause) {
    warn("อ่านขนส่งยอดนิยม", reason(cause));
    return [];
  }
}

export interface MemberStats {
  total: number;
  new7d: number;
  new30d: number;
}

/**
 * จำนวนสมาชิก — ตัวเลขรวมล้วน
 *
 * ผ่านฟังก์ชัน admin_member_stats() ที่คืนได้แค่ count(*) เท่านั้น ตั้งใจไม่ใช้
 * auth.admin.listUsers() ของ supabase-js ซึ่งจะดึงอีเมลของสมาชิกทุกคนกลับมา
 * ทั้งที่เราต้องการแค่ตัวเลขเดียว — ข้อมูลที่ไม่ได้ดึงมาคือข้อมูลที่หลุดไม่ได้
 */
export async function readMemberStats(): Promise<MemberStats> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return { total: 0, new7d: 0, new30d: 0 };

  try {
    const { data, error } = await supabase.rpc("admin_member_stats");

    if (error) {
      warn("อ่านจำนวนสมาชิก", error.message);
      return { total: 0, new7d: 0, new30d: 0 };
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      total: toCount(row.total),
      new7d: toCount(row.new_7d),
      new30d: toCount(row.new_30d),
    };
  } catch (cause) {
    warn("อ่านจำนวนสมาชิก", reason(cause));
    return { total: 0, new7d: 0, new30d: 0 };
  }
}
