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

import type {
  Coordinates,
  GeocodePrecision,
  LocationAccuracy,
} from "../geocode";
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
  /** พิกัดแถวนี้ละเอียดแค่ไหน — ที่แอดมินกรอกเองถือเป็น exact เสมอ */
  accuracy: LocationAccuracy;
}

/**
 * สิ่งที่จบด้วย "ไม่มีแผนที่" หนึ่งรายการ
 *
 * ไม่ได้มีแค่รหัสสาขาแล้ว — ตั้งแต่เติม kind เข้ามา ตารางนี้เก็บทุกกรณีที่
 * ผู้ใช้จะไม่เห็นแผนที่ ไม่ว่าจะเป็นรหัสสาขา ข้อความที่ดูเหมือนที่อยู่แต่หา
 * พิกัดไม่เจอ หรือข้อความที่อ่านไม่ออกว่าเป็นอะไร (ดู lib/location-resolve.ts)
 */
export interface UnknownBranch {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  /** 'branch' | 'address' | 'unknown' — ตรงกับ LocationKind ใน lib/branch-location.ts */
  kind: string;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** ครั้งล่าสุดที่ระบบไปถามที่อยู่ของสาขานี้จาก ETrackings */
  lastProbeAt: string | null;
  probeCount: number;
}

/** ผลการอ่าน geocode_cache — null คือไม่เคยถาม, found=false คือถามแล้วไม่เจอ */
export interface CachedGeocode {
  found: boolean;
  coordinates: Coordinates | null;
  /** location_type ดิบของ Google — ไว้วินิจฉัยเท่านั้น ห้ามใช้ตัดสิน */
  precision: GeocodePrecision | null;
  /**
   * ผลการวัดความละเอียด — null ทั้งคู่คือแถวเก่าก่อนมีคอลัมน์นี้
   * (ดู migration 0008) ส่งต่อให้ classifyAccuracy() ตัดสินชั้นเอา
   */
  accuracyMeters: number | null;
  areaOnly: boolean | null;
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
    kind: string,
  ): Promise<void>;
  readGeocode(query: string): Promise<CachedGeocode | null>;
  writeGeocode(query: string, hit: GeocodeWrite): Promise<void>;
  /**
   * ขอสิทธิ์ไปถามที่อยู่ของสาขานี้ — true เมื่อได้สิทธิ์เท่านั้น
   *
   * เป็นด่านกันเผาโควตาที่เป็น atomic จริงในฐานข้อมูล สองคำขอที่มาพร้อมกัน
   * (หรือมาจากคนละ instance) จะมีแค่คำขอเดียวที่ได้ true
   */
  claimBranchProbe(
    carrierCode: string,
    branchCode: string,
    cooldownHours: number,
  ): Promise<boolean>;
  /** บันทึกพิกัดที่ระบบหามาได้เอง — ไม่ทับของที่มีอยู่แล้ว */
  saveHarvestedBranch(input: HarvestedBranchInput): Promise<boolean>;
}

/** สิ่งที่บันทึกลง geocode_cache — coordinates เป็น null เมื่อหาไม่เจอ */
export interface GeocodeWrite {
  coordinates: Coordinates | null;
  precision: GeocodePrecision | null;
  accuracyMeters: number | null;
  areaOnly: boolean | null;
}

/** พิกัดสาขาที่ระบบหามาได้เองจากที่อยู่ในข้อความของขนส่ง */
export interface HarvestedBranchInput {
  carrierCode: string;
  branchCode: string;
  branchName: string | null;
  lat: number;
  lng: number;
  accuracy: LocationAccuracy;
  /** ที่อยู่ที่ใช้หาพิกัด — เก็บไว้ใน note ให้แอดมินตรวจย้อนได้ */
  address: string;
}

/**
 * ค่าที่ใส่ในคอลัมน์ updated_by ของแถวที่ระบบเติมเอง
 *
 * จงใจไม่ใช่รูปแบบอีเมล เพื่อให้แยกออกจากแอดมินตัวจริงได้ทันทีเมื่อไล่ดูว่า
 * ใครเป็นคนใส่พิกัดผิด
 */
export const HARVEST_AUTHOR = "auto:etrackings";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const PRECISIONS: readonly string[] = [
  "rooftop",
  "range",
  "center",
  "approximate",
];

function toPrecision(value: unknown): GeocodePrecision | null {
  return typeof value === "string" && PRECISIONS.includes(value)
    ? (value as GeocodePrecision)
    : null;
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
    // แถวเก่าก่อน migration 0008 ไม่มีคอลัมน์นี้ — ทั้งหมดเป็นของที่แอดมิน
    // กรอกเอง ซึ่งคือจุดที่คนไปยืนยันมาแล้ว จึงเป็น exact โดยปริยาย
    accuracy: record.accuracy === "approximate" ? "approximate" : "exact",
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
    kind: typeof record.kind === "string" ? record.kind : "branch",
    hitCount: isFiniteNumber(record.hit_count) ? record.hit_count : 0,
    firstSeenAt:
      typeof record.first_seen_at === "string" ? record.first_seen_at : null,
    lastSeenAt:
      typeof record.last_seen_at === "string" ? record.last_seen_at : null,
    lastProbeAt:
      typeof record.last_probe_at === "string" ? record.last_probe_at : null,
    probeCount: isFiniteNumber(record.probe_count) ? record.probe_count : 0,
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

  async recordUnknownBranch(carrierCode, branchCode, branchName, kind) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    try {
      // ใช้ฟังก์ชันใน Postgres เพราะต้องบวก hit_count แบบ atomic
      // (upsert ของ supabase-js เขียนค่าคงที่ได้อย่างเดียว)
      const { error } = await supabase.rpc("record_unknown_branch", {
        p_carrier_code: carrierCode,
        p_branch_code: branchCode,
        p_branch_name: branchName,
        p_kind: kind,
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
        .select("lat, lng, found, precision, accuracy_meters, area_only")
        .eq("query", query)
        .maybeSingle();

      if (error) {
        warn("อ่าน cache พิกัด", error.message);
        return null;
      }
      if (data === null) return null;

      const record = data as Record<string, unknown>;

      if (record.found !== true) {
        return {
          found: false,
          coordinates: null,
          precision: null,
          accuracyMeters: null,
          areaOnly: null,
        };
      }

      if (!isFiniteNumber(record.lat) || !isFiniteNumber(record.lng)) return null;
      return {
        found: true,
        coordinates: { lat: record.lat, lng: record.lng },
        precision: toPrecision(record.precision),
        accuracyMeters: isFiniteNumber(record.accuracy_meters)
          ? record.accuracy_meters
          : null,
        areaOnly: typeof record.area_only === "boolean" ? record.area_only : null,
      };
    } catch (cause) {
      warn("อ่าน cache พิกัด", reason(cause));
      return null;
    }
  },

  async writeGeocode(query, hit) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return;

    const found = hit.coordinates !== null;

    try {
      const { error } = await supabase.from(GEOCODE_TABLE).upsert(
        {
          query,
          found,
          lat: hit.coordinates?.lat ?? null,
          lng: hit.coordinates?.lng ?? null,
          precision: found ? hit.precision : null,
          // Infinity ลง jsonb/double ไม่ได้ และ "ใหญ่จนวัดไม่ได้" กับ "ไม่รู้"
          // ต่างกัน — ตัวแรกต้องถูกปฏิเสธ ตัวหลังแค่ไม่ยืนยัน จึงเก็บ area_only
          // เป็น true แทนที่จะปล่อยให้ตัวเลขหายไปเฉยๆ
          accuracy_meters:
            found && Number.isFinite(hit.accuracyMeters ?? NaN)
              ? hit.accuracyMeters
              : null,
          area_only: found
            ? (hit.areaOnly ?? false) ||
              !Number.isFinite(hit.accuracyMeters ?? NaN)
            : null,
          geocoded_at: new Date().toISOString(),
        },
        { onConflict: "query" },
      );

      if (error) warn("บันทึก cache พิกัด", error.message);
    } catch (cause) {
      warn("บันทึก cache พิกัด", reason(cause));
    }
  },

  async claimBranchProbe(carrierCode, branchCode, cooldownHours) {
    const supabase = getServiceSupabaseClient();
    // ไม่มีฐานข้อมูล = จองไม่ได้ = ไม่ยิง ตั้งใจ fail closed เพราะทางที่ผิดพลาด
    // ได้อย่างปลอดภัยคือ "ไม่เติมพิกัด" ไม่ใช่ "ยิงรัวโดยไม่มีอะไรกันไว้"
    if (supabase === null) return false;

    try {
      const { data, error } = await supabase.rpc("claim_branch_probe", {
        p_carrier_code: carrierCode,
        p_branch_code: branchCode,
        p_cooldown_hours: cooldownHours,
      });

      if (error) {
        warn("ขอสิทธิ์ถามที่อยู่สาขา", error.message);
        return false;
      }
      return data === true;
    } catch (cause) {
      warn("ขอสิทธิ์ถามที่อยู่สาขา", reason(cause));
      return false;
    }
  },

  async saveHarvestedBranch(input) {
    const supabase = getServiceSupabaseClient();
    if (supabase === null) return false;

    try {
      // insert ไม่ใช่ upsert โดยตั้งใจ — พิกัดที่แอดมินกรอกเองถือว่าถูกต้อง
      // กว่าเสมอ ระบบอัตโนมัติห้ามทับ ชนคีย์ซ้ำ (23505) จึงไม่ใช่ความผิดพลาด
      // แต่แปลว่า "มีคนใส่ไว้แล้ว" ซึ่งคือผลลัพธ์ที่เราต้องการอยู่แล้ว
      const { error } = await supabase.from(BRANCHES_TABLE).insert({
        carrier_code: input.carrierCode,
        branch_code: input.branchCode,
        branch_name: input.branchName,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        note: `เติมอัตโนมัติจากที่อยู่ในข้อความของขนส่ง: ${input.address}`.slice(0, 500),
        updated_by: HARVEST_AUTHOR,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        if (error.code === "23505") return false;
        warn("บันทึกพิกัดสาขาที่หามาได้เอง", error.message);
        return false;
      }

      // ถอดออกจากรายการที่ยังไม่รู้พิกัด เหตุผลเดียวกับใน upsertBranch()
      const { error: cleanupError } = await supabase
        .from(UNKNOWN_TABLE)
        .delete()
        .eq("carrier_code", input.carrierCode)
        .eq("branch_code", input.branchCode);

      if (cleanupError) {
        warn("ถอดสาขาออกจากรายการที่ไม่รู้จัก", cleanupError.message);
      }

      return true;
    } catch (cause) {
      warn("บันทึกพิกัดสาขาที่หามาได้เอง", reason(cause));
      return false;
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

/**
 * จำนวนสาขาที่มีพิกัดแล้ว/ยังไม่มี — สำหรับหน้าสถิติของแอดมิน
 *
 * นับด้วย head:true จึงไม่ดึงแถวจริงกลับมาเลย ได้แต่ตัวเลข ซึ่งเป็นสิ่งเดียว
 * ที่หน้าสถิติต้องการ
 *
 * ⚠️ ไม่ได้ตรวจสิทธิ์เอง ผู้เรียกต้องผ่าน requireAdmin() มาก่อนเสมอ
 */
export interface BranchCounts {
  known: number;
  unknown: number;
  /** แยกตามชนิดของสิ่งที่หาพิกัดไม่ได้ — branch / address / unknown */
  unknownByKind: Record<string, number>;
  /**
   * รวมจำนวนครั้งที่ยิงถามที่อยู่สาขาไปแล้ว (probe_count ของทุกแถว)
   *
   * ── ทำไมต้องมี ────────────────────────────────────────────────
   * เดิมหน้าสถิติบอกได้แค่ "มีพิกัดแล้วกี่สาขา" ซึ่งเป็นตัวเลขที่ดูดีเสมอ
   * เพราะ 0 ก็อ่านได้ว่า "ยังไม่มีสาขาไหนต้องใช้" · สิ่งที่หายไปคือ **ต้นทุน**
   *
   * ของจริงตอนที่เพิ่งเจอ: ยิงไป 3 ครั้ง (10% ของโควตา ETrackings ทั้งชีวิต
   * ที่ไม่มีวันเติม) ได้พิกัดกลับมา 0 จุด — ไม่มีตัวเลขไหนบนหน้าบอกเรื่องนี้เลย
   * เรารู้เพราะบังเอิญเปิดตารางดู
   *
   * หลักการ: ต้องวัด **ผลลัพธ์** ไม่ใช่แค่ว่าทำสำเร็จ · "ยิงได้" ไม่ใช่ผลลัพธ์
   * "ได้พิกัดมาใช้จริง" ต่างหากที่ใช่
   */
  probeAttempts: number;
}

const UNKNOWN_KINDS: readonly string[] = ["branch", "address", "unknown"];

async function countRows(
  table: string,
  filter?: { column: string; value: string },
): Promise<number> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return 0;

  try {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter !== undefined) query = query.eq(filter.column, filter.value);

    const { count, error } = await query;
    if (error) {
      warn("นับจำนวนแถว", error.message);
      return 0;
    }
    return count ?? 0;
  } catch (cause) {
    warn("นับจำนวนแถว", reason(cause));
    return 0;
  }
}

/** รวม probe_count ของทุกแถวใน unknown_branches */
async function sumProbeAttempts(): Promise<number> {
  const supabase = getServiceSupabaseClient();
  if (supabase === null) return 0;

  try {
    const { data, error } = await supabase
      .from(UNKNOWN_TABLE)
      .select("probe_count");

    if (error) {
      warn("นับจำนวนครั้งที่ถามที่อยู่สาขา", error.message);
      return 0;
    }

    return (data ?? []).reduce(
      (total: number, row: { probe_count?: number | null }) =>
        total + (row.probe_count ?? 0),
      0,
    );
  } catch (cause) {
    warn("นับจำนวนครั้งที่ถามที่อยู่สาขา", reason(cause));
    return 0;
  }
}

export async function countBranches(): Promise<BranchCounts> {
  const [known, unknown, probeAttempts, ...byKind] = await Promise.all([
    countRows(BRANCHES_TABLE),
    countRows(UNKNOWN_TABLE),
    sumProbeAttempts(),
    ...UNKNOWN_KINDS.map((kind) =>
      countRows(UNKNOWN_TABLE, { column: "kind", value: kind }),
    ),
  ]);

  const unknownByKind: Record<string, number> = {};
  UNKNOWN_KINDS.forEach((kind, index) => {
    unknownByKind[kind] = byKind[index] ?? 0;
  });

  return { known, unknown, unknownByKind, probeAttempts };
}
