/**
 * ทางเข้าเดียวของสามตารางที่เก็บข้อมูลตำแหน่ง
 *
 *   carrier_branches  พิกัดสาขาที่แอดมินกรอกไว้
 *   unknown_branches  สาขาที่เจอแล้วแต่ยังไม่รู้พิกัด พร้อมจำนวนครั้งที่เจอ
 *   geocode_cache     ผลการหาพิกัดจาก Google รวมถึงผลที่ "หาไม่เจอ"
 *
 * ดู supabase/migrations/0004_carrier_branches.sql
 *
 * กติกาเดียวกับ ./tracking-cache.ts: **ห้ามโยน error ออกไปเด็ดขาด** ในเส้นทาง
 * ที่ผู้ใช้รออยู่ การหาพิกัดไม่สำเร็จต้องไม่ทำให้การบันทึกพัสดุล้มเหลว
 * ทุกทางที่พังจบที่ log แล้วคืนค่าที่แปลว่า "ไม่รู้"
 *
 * ข้อยกเว้นคือฟังก์ชันที่หน้าแอดมินใช้เขียนข้อมูล (upsertBranch) ซึ่งต้องบอก
 * ผู้กรอกได้ว่าบันทึกสำเร็จหรือไม่ จึงคืนผลลัพธ์แบบมีสถานะแทนการกลืนเงียบ
 *
 * ⚠️ ใช้ service role key ที่ข้าม RLS ได้ — สามตารางนี้เป็นของกลางฝั่งเซิร์ฟเวอร์
 * ไม่มีทางไหนให้ client แตะตรงๆ (ไม่ถูก grant และเปิด RLS ไว้โดยไม่มี policy)
 */

import type { Coordinates } from "../geocode";
import { explainPermissionDenied } from "./key-role";
import { getServiceSupabaseClient } from "./service";

const BRANCHES_TABLE = "carrier_branches";
const UNKNOWN_TABLE = "unknown_branches";
const GEOCODE_TABLE = "geocode_cache";

/** หนึ่งสาขาที่รู้พิกัดแล้ว */
export interface CarrierBranch {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  lat: number;
  lng: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** หนึ่งสาขาที่ยังไม่รู้พิกัด */
export interface UnknownBranch {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/** ผลการอ่าน geocode_cache — null คือไม่เคยถาม, found=false คือถามแล้วไม่เจอ */
export interface CachedGeocode {
  found: boolean;
  coordinates: Coordinates | null;
}

/** สัญญาที่ตัวหาพิกัดต้องการ แยกเป็น interface เพื่อให้เทสต์ใส่ตัวปลอมแทนได้ */
export interface LocationStore {
  findBranch(
    carrierCode: string,
    branchCode: string,
  ): Promise<CarrierBranch | null>;
  recordUnknownBranch(
    carrierCode: string,
    branchCode: string,
    branchName: string | null,
  ): Promise<void>;
  readGeocode(query: string): Promise<CachedGeocode | null>;
  writeGeocode(query: string, coordinates: Coordinates | null): Promise<void>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * log ปัญหาของชั้นข้อมูล — ไม่ใช่ error ของผู้ใช้ จึงเป็น warn
 *
 * ต่อคำอธิบายให้เองเมื่อเป็นเรื่องสิทธิ์ (เหตุผลเดียวกับใน ./tracking-cache.ts)
 */
function warn(action: string, detail: string): void {
  const hint = explainPermissionDenied(detail);
  console.warn(
    `[locations] ${action} ล้มเหลว: ${detail}` + (hint === null ? "" : ` — ${hint}`),
  );
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toBranch(row: unknown): CarrierBranch | null {
  if (typeof row !== "object" || row === null) return null;

  const record = row as Record<string, unknown>;
  if (!isFiniteNumber(record.lat) || !isFiniteNumber(record.lng)) return null;
  if (typeof record.carrier_code !== "string") return null;
  if (typeof record.branch_code !== "string") return null;

  return {
    carrierCode: record.carrier_code,
    branchCode: record.branch_code,
    branchName: typeof record.branch_name === "string" ? record.branch_name : null,
    lat: record.lat,
    lng: record.lng,
    note: typeof record.note === "string" ? record.note : null,
    updatedBy: typeof record.updated_by === "string" ? record.updated_by : null,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
  };
}

function toUnknownBranch(row: unknown): UnknownBranch | null {
  if (typeof row !== "object" || row === null) return null;

  const record = row as Record<string, unknown>;
  if (typeof record.carrier_code !== "string") return null;
  if (typeof record.branch_code !== "string") return null;

  return {
    carrierCode: record.carrier_code,
    branchCode: record.branch_code,
    branchName: typeof record.branch_name === "string" ? record.branch_name : null,
    hitCount: isFiniteNumber(record.hit_count) ? record.hit_count : 0,
    firstSeenAt:
      typeof record.first_seen_at === "string" ? record.first_seen_at : null,
    lastSeenAt:
      typeof record.last_seen_at === "string" ? record.last_seen_at : null,
  };
}

/* ------------------------------------------------------------------ *
 * ทางที่อยู่ในเส้นทางของผู้ใช้ — ห้ามโยน error
 * ------------------------------------------------------------------ */

export const supabaseLocationStore: LocationStore = {
  async findBranch(carrierCode, branchCode) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase
        .from(BRANCHES_TABLE)
        .select("*")
        .eq("carrier_code", carrierCode)
        .eq("branch_code", branchCode)
        .maybeSingle();

      if (error) {
        warn("อ่านพิกัดสาขา", error.message);
        return null;
      }
      return data === null ? null : toBranch(data);
    } catch (cause) {
      warn("อ่านพิกัดสาขา", reason(cause));
      return null;
    }
  },

  async recordUnknownBranch(carrierCode, branchCode, branchName) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    try {
      // ใช้ฟังก์ชันใน Postgres เพราะต้องบวก hit_count แบบ atomic
      // (upsert ของ supabase-js เขียนค่าคงที่ได้อย่างเดียว)
      const { error } = await supabase.rpc("record_unknown_branch", {
        p_carrier_code: carrierCode,
        p_branch_code: branchCode,
        p_branch_name: branchName,
      });

      if (error) warn("บันทึกสาขาที่ไม่รู้จัก", error.message);
    } catch (cause) {
      warn("บันทึกสาขาที่ไม่รู้จัก", reason(cause));
    }
  },

  async readGeocode(query) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return null;

    try {
      const { data, error } = await supabase
        .from(GEOCODE_TABLE)
        .select("lat, lng, found")
        .eq("query", query)
        .maybeSingle();

      if (error) {
        warn("อ่าน cache พิกัด", error.message);
        return null;
      }
      if (data === null) return null;

      const record = data as Record<string, unknown>;
      if (record.found !== true) return { found: false, coordinates: null };

      if (!isFiniteNumber(record.lat) || !isFiniteNumber(record.lng)) return null;
      return { found: true, coordinates: { lat: record.lat, lng: record.lng } };
    } catch (cause) {
      warn("อ่าน cache พิกัด", reason(cause));
      return null;
    }
  },

  async writeGeocode(query, coordinates) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    try {
      const { error } = await supabase.from(GEOCODE_TABLE).upsert(
        {
          query,
          found: coordinates !== null,
          lat: coordinates?.lat ?? null,
          lng: coordinates?.lng ?? null,
          geocoded_at: new Date().toISOString(),
        },
        { onConflict: "query" },
      );

      if (error) warn("บันทึก cache พิกัด", error.message);
    } catch (cause) {
      warn("บันทึก cache พิกัด", reason(cause));
    }
  },
};

/* ------------------------------------------------------------------ *
 * ทางของหน้าแอดมิน — ต้องบอกได้ว่าสำเร็จหรือไม่
 *
 * ⚠️ ฟังก์ชันกลุ่มนี้ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin()
 * (lib/supabase/admin-guard.ts) มาก่อนเสมอ
 * ------------------------------------------------------------------ */

export type WriteResult = { ok: true } | { ok: false; message: string };

/** สาขาที่ยังไม่รู้พิกัด เรียงจากที่เจอบ่อยที่สุดก่อน */
export async function listUnknownBranches(
  limit = 200,
): Promise<UnknownBranch[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase
      .from(UNKNOWN_TABLE)
      .select("*")
      .order("hit_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    if (error) {
      warn("ดึงรายชื่อสาขาที่ไม่รู้จัก", error.message);
      return [];
    }
    return (data ?? [])
      .map(toUnknownBranch)
      .filter((branch): branch is UnknownBranch => branch !== null);
  } catch (cause) {
    warn("ดึงรายชื่อสาขาที่ไม่รู้จัก", reason(cause));
    return [];
  }
}

/** สาขาที่กรอกพิกัดไว้แล้ว เรียงจากที่แก้ล่าสุด */
export async function listKnownBranches(limit = 200): Promise<CarrierBranch[]> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return [];

  try {
    const { data, error } = await supabase
      .from(BRANCHES_TABLE)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) {
      warn("ดึงรายชื่อสาขาที่มีพิกัด", error.message);
      return [];
    }
    return (data ?? [])
      .map(toBranch)
      .filter((branch): branch is CarrierBranch => branch !== null);
  } catch (cause) {
    warn("ดึงรายชื่อสาขาที่มีพิกัด", reason(cause));
    return [];
  }
}

/**
 * บันทึกหรือแก้พิกัดของสาขาหนึ่ง แล้วถอดออกจากรายชื่อที่ยังไม่รู้พิกัด
 *
 * สองขั้นนี้ไม่ได้อยู่ใน transaction เดียวกัน ถ้าขั้นที่สองพลาด ผลคือสาขานั้น
 * ยังค้างอยู่ในรายการ "ยังไม่รู้พิกัด" ทั้งที่กรอกไปแล้ว ซึ่งกวนตาแต่ไม่เสียหาย
 * (การหาพิกัดอ่านจาก carrier_branches ก่อนเสมอ) จึงไม่คุ้มจะทำเป็น RPC เพิ่ม
 */
export async function upsertBranch(input: {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  lat: number;
  lng: number;
  note: string | null;
  updatedBy: string;
}): Promise<WriteResult> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) {
    return { ok: false, message: "ระบบยังไม่ได้ตั้งค่าเชื่อมต่อฐานข้อมูล" };
  }

  try {
    const { error } = await supabase.from(BRANCHES_TABLE).upsert(
      {
        carrier_code: input.carrierCode,
        branch_code: input.branchCode,
        branch_name: input.branchName,
        lat: input.lat,
        lng: input.lng,
        note: input.note,
        updated_by: input.updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "carrier_code,branch_code" },
    );

    if (error) {
      warn("บันทึกพิกัดสาขา", error.message);
      return { ok: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
    }

    const { error: cleanupError } = await supabase
      .from(UNKNOWN_TABLE)
      .delete()
      .eq("carrier_code", input.carrierCode)
      .eq("branch_code", input.branchCode);

    if (cleanupError) warn("ถอดสาขาออกจากรายการที่ไม่รู้จัก", cleanupError.message);

    return { ok: true };
  } catch (cause) {
    warn("บันทึกพิกัดสาขา", reason(cause));
    return { ok: false, message: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
