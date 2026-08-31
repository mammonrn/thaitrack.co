/**
 * ทางเข้าเดียวของตารางสถิติ (search_events, install_events) และตัวเลขสรุปที่
 * หน้าสถิติแอดมินใช้
 *
 * ดู supabase/migrations/0007_search_events.sql และ 0011_stats_details.sql
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
  /**
   * สาเหตุที่ตอบไม่ได้ เช่น "auth_failed" — null เมื่อค้นเจอ
   *
   * เป็นคุณสมบัติของคำขอ ไม่ใช่ของคน · มีเพราะเคยต้องไปงมใน pm2 log กว่าจะรู้
   * ว่าวันนั้นระบบขัดข้องเพราะอะไร ทั้งที่ควรอยู่บนหน้าสถิติตั้งแต่แรก
   */
  reason?: string | null;
  /** code ดิบของปลายทาง เช่น "A0706" หรือ "breaker_open" */
  upstreamCode?: string | null;
  /** ใช้เวลากี่มิลลิวินาที — ไว้ดู p50/p95 แยกตามชั้นที่ตอบ */
  tookMs?: number | null;
  /**
   * true = คำขอนี้ล้มตอนที่เหลือผู้ให้บริการเจ้าเดียว เพราะเดาไม่ออกว่าเลขนี้
   * เป็นขนส่งเจ้าไหน (ดู isUnknownCourierFailure ใน lib/carriers/resolve.ts)
   *
   * เป็นคุณสมบัติของคำขอล้วนๆ ไม่ได้บอกอะไรเกี่ยวกับคนที่ค้นเลย มีเพราะเป็น
   * ตัวเลขเดียวที่ใช้ตัดสินได้ว่าควรลงทุนทำกลไกเดาขนส่งตอนจนตรอกหรือไม่
   */
  unknownCourier?: boolean;
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
      reason: input.reason ?? null,
      upstream_code: input.upstreamCode ?? null,
      took_ms: input.tookMs ?? null,
      unknown_courier: input.unknownCourier ?? false,
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

export interface ErrorBreakdownRow {
  reason: string;
  upstreamCode: string | null;
  total: number;
}

/** สาเหตุที่ระบบตอบไม่ได้ แยกตามชนิด เรียงจากที่เจอบ่อยสุด */
export async function readErrorBreakdown(
  days: number,
): Promise<ErrorBreakdownRow[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase.rpc("admin_error_breakdown", {
      p_days: days,
    });

    if (error) {
      warn("อ่านสาเหตุข้อผิดพลาด", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: unknown) => {
        const record = row as Record<string, unknown>;
        if (typeof record.reason !== "string") return null;
        return {
          reason: record.reason,
          upstreamCode:
            typeof record.upstream_code === "string" ? record.upstream_code : null,
          total: toCount(record.total),
        } satisfies ErrorBreakdownRow;
      })
      .filter((row: ErrorBreakdownRow | null): row is ErrorBreakdownRow =>
        row !== null,
      );
  } catch (cause) {
    warn("อ่านสาเหตุข้อผิดพลาด", reason(cause));
    return [];
  }
}

/**
 * จำนวนคำขอที่ล้มเพราะเหลือผู้ให้บริการเจ้าเดียว (ไม่รู้ว่าเลขเป็นขนส่งเจ้าไหน)
 *
 * ⚠️ นับเป็น **รายคำขอ ไม่ใช่รายเลขพัสดุ** เพราะเราไม่ได้เก็บเลขพัสดุไว้เลย
 * (และจะไม่เก็บ — ดูข้อบังคับที่หัวไฟล์) คนที่กดค้นเลขเดิมซ้ำสามครั้งจึงถูกนับ
 * สามครั้ง ตัวเลขนี้เป็น "เพดานบน" ของจำนวนเลขที่ได้ประโยชน์จากกลไกเดาขนส่ง
 * ไม่ใช่จำนวนจริง — หน้าสถิติต้องเขียนกำกับไว้ ห้ามเอาไปคูณโควตาตรงๆ
 */
export async function readUnknownCourierFailures(days: number): Promise<number> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return 0;

  try {
    const { data, error } = await supabase.rpc("admin_unknown_courier_failures", {
      p_days: days,
    });

    if (error) {
      warn("อ่านจำนวนคำขอที่ไม่รู้ขนส่ง", error.message);
      return 0;
    }

    return toCount(data);
  } catch (cause) {
    warn("อ่านจำนวนคำขอที่ไม่รู้ขนส่ง", reason(cause));
    return 0;
  }
}

export interface LatencyRow {
  source: string;
  p50Ms: number;
  p95Ms: number;
  total: number;
}

/** ความเร็วแยกตามชั้นที่ตอบ */
export async function readLatency(days: number): Promise<LatencyRow[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase.rpc("admin_latency", { p_days: days });

    if (error) {
      warn("อ่านความเร็ว", error.message);
      return [];
    }

    return (data ?? [])
      .map((row: unknown) => {
        const record = row as Record<string, unknown>;
        if (typeof record.source !== "string") return null;
        return {
          source: record.source,
          p50Ms: toCount(record.p50_ms),
          p95Ms: toCount(record.p95_ms),
          total: toCount(record.total),
        } satisfies LatencyRow;
      })
      .filter((row: LatencyRow | null): row is LatencyRow => row !== null);
  } catch (cause) {
    warn("อ่านความเร็ว", reason(cause));
    return [];
  }
}

export interface InstallStats {
  total: number;
  last7d: number;
  last30d: number;
  android: number;
  ios: number;
  desktop: number;
}

const EMPTY_INSTALLS: InstallStats = {
  total: 0,
  last7d: 0,
  last30d: 0,
  android: 0,
  ios: 0,
  desktop: 0,
};

/** จำนวนการติดตั้งแอพ */
export async function readInstallStats(): Promise<InstallStats> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return EMPTY_INSTALLS;

  try {
    const { data, error } = await supabase.rpc("admin_install_stats");

    if (error) {
      warn("อ่านจำนวนการติดตั้งแอพ", error.message);
      return EMPTY_INSTALLS;
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      total: toCount(row.total),
      last7d: toCount(row.last_7d),
      last30d: toCount(row.last_30d),
      android: toCount(row.android),
      ios: toCount(row.ios),
      desktop: toCount(row.desktop),
    };
  } catch (cause) {
    warn("อ่านจำนวนการติดตั้งแอพ", reason(cause));
    return EMPTY_INSTALLS;
  }
}

/** หนึ่งครั้งที่มีคนติดตั้งแอพ — ไม่รู้ว่าใคร และไม่ต้องรู้ */
export async function recordInstallEvent(platform: string): Promise<void> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return;

  try {
    const { error } = await supabase
      .from("install_events")
      .insert({ platform });

    if (error) warn("บันทึกการติดตั้งแอพ", error.message);
  } catch (cause) {
    warn("บันทึกการติดตั้งแอพ", reason(cause));
  }
}

export interface MemberActivity {
  active7d: number;
  activePrev7d: number;
  returned: number;
  saves7d: number;
}

/**
 * การกลับมาใช้ซ้ำของสมาชิก — วัดจาก **การบันทึกพัสดุ** ไม่ใช่การค้นหา
 *
 * ⚠️ ข้อจำกัดที่ตั้งใจ: search_events ไม่มี user_id (และจะไม่มี) จึงตอบไม่ได้ว่า
 * ใครกลับมาค้นซ้ำ สิ่งที่ตอบได้โดยไม่ผิดคำสัญญาคือการบันทึกพัสดุ ซึ่งเป็นการ
 * กระทำที่ผู้ใช้ตั้งใจผูกกับบัญชีตัวเองอยู่แล้ว
 *
 * ตัวเลขจึงต่ำกว่าความจริงเสมอ — หน้าสถิติต้องเขียนกำกับให้ชัด ห้ามเรียกมันว่า
 * "คนที่กลับมาค้นหา"
 */
export async function readMemberActivity(): Promise<MemberActivity> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) {
    return { active7d: 0, activePrev7d: 0, returned: 0, saves7d: 0 };
  }

  try {
    const { data, error } = await supabase.rpc("admin_member_activity");

    if (error) {
      warn("อ่านการใช้งานของสมาชิก", error.message);
      return { active7d: 0, activePrev7d: 0, returned: 0, saves7d: 0 };
    }

    const row = (data ?? {}) as Record<string, unknown>;
    return {
      active7d: toCount(row.active_7d),
      activePrev7d: toCount(row.active_prev_7d),
      returned: toCount(row.returned),
      saves7d: toCount(row.saves_7d),
    };
  } catch (cause) {
    warn("อ่านการใช้งานของสมาชิก", reason(cause));
    return { active7d: 0, activePrev7d: 0, returned: 0, saves7d: 0 };
  }
}
