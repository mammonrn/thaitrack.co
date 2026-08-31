/**
 * หาพิกัดของข้อความสถานที่ ตามลำดับที่ "ไม่มีทางปักหมุดมั่ว"
 *
 *   1. เป็นรหัสสาขา → หาจากตาราง carrier_branches เท่านั้น
 *      เจอ   → ใช้พิกัดนั้น
 *      ไม่เจอ → ไม่มีพิกัด + บันทึกลง unknown_branches ให้แอดมินไล่เติม
 *              (ห้ามเอาชื่อสาขาไป geocode ต่อ — จะได้หมุดกลางอำเภอ คือปัญหาเดิม)
 *   2. ดูเหมือนที่อยู่จริง → ดู geocode_cache ก่อน ไม่มีค่อยถาม Google
 *      แล้วเก็บผลลง cache ถาวร (เก็บผลที่หาไม่เจอด้วย จะได้ไม่ถามซ้ำ)
 *   3. อ่านไม่ออกว่าเป็นอะไร → ไม่มีพิกัด และไม่เสีย quota ไปกับการเดา
 *
 * ทุกทางที่ล้มเหลวจบที่ "ไม่มีพิกัด" ซึ่ง UI จะแสดงชื่อสถานที่เป็นข้อความแทน
 * แผนที่ — ผู้ใช้ยังได้ข้อมูลที่ถูกต้อง เพียงแต่ไม่มีหมุด
 *
 * รับ store กับ geocoder เข้ามาได้เพื่อให้เทสต์ครอบทุกเส้นทางโดยไม่ต้องต่อ
 * ฐานข้อมูลจริงหรือยิงถาม Google
 */

import {
  normalizeBranchCode,
  normalizeGeocodeQuery,
  parseLocationText,
  type LocationKind,
} from "./branch-location";
import { geocodeLocation, type Coordinates } from "./geocode";
import {
  supabaseLocationStore,
  type LocationStore,
} from "./supabase/locations";

/** ที่มาของพิกัดที่ได้ — ไว้ใส่ log และไว้ให้ UI อธิบายผู้ใช้ */
export type LocationSource =
  /** จากตารางพิกัดสาขาที่แอดมินกรอกไว้ */
  | "branch"
  /** จากผลการหาพิกัดที่เคยถาม Google ไว้แล้วเก็บไว้ */
  | "geocode_saved"
  /** เพิ่งถาม Google มาสดๆ */
  | "geocode_fresh"
  /** ไม่มีพิกัด */
  | "none";

export interface ResolvedLocation {
  /** null = ไม่มีพิกัด ห้ามปักหมุด */
  coordinates: Coordinates | null;
  source: LocationSource;
  kind: LocationKind;
  /** ข้อความที่แสดงให้ผู้ใช้เห็น (ชื่อสาขา หรือข้อความเดิม) */
  displayText: string;
  /** รหัสสาขาที่แยกได้ — null เมื่อไม่ใช่รหัสสาขา */
  branchCode: string | null;
}

export interface ResolveLocationOptions {
  store?: LocationStore;
  /** ตัวหาพิกัด (ค่าเริ่มต้น: Google Geocoding) */
  geocode?: (text: string) => Promise<Coordinates | null>;
}

/** ผลลัพธ์สำหรับกรณีที่ไม่มีอะไรให้ทำ */
function nothing(displayText: string, kind: LocationKind): ResolvedLocation {
  return {
    coordinates: null,
    source: "none",
    kind,
    displayText,
    branchCode: null,
  };
}

/**
 * หาพิกัดของข้อความสถานที่หนึ่งอัน
 *
 * ฟังก์ชันนี้ห้ามโยน error ออกไปเด็ดขาด — เรียกจากเส้นทางที่ผู้ใช้กำลังรอ
 * ผลการบันทึกพัสดุอยู่ การหาพิกัดไม่สำเร็จเป็นเรื่องปกติ ไม่ใช่ความล้มเหลว
 */
export async function resolveLocation(
  locationText: string,
  carrierCode: string,
  options: ResolveLocationOptions = {},
): Promise<ResolvedLocation> {
  const store = options.store ?? supabaseLocationStore;
  const geocode = options.geocode ?? geocodeLocation;

  const parsed = parseLocationText(locationText);
  if (parsed.displayText === "") return nothing("", "unknown");

  /* ---- 1. รหัสสาขา ---- */
  if (parsed.kind === "branch" && parsed.branchCode !== null) {
    const branchCode = normalizeBranchCode(parsed.branchCode);
    const branch = await store.findBranch(carrierCode, branchCode);

    if (branch !== null) {
      return {
        coordinates: { lat: branch.lat, lng: branch.lng },
        source: "branch",
        kind: "branch",
        // ชื่อที่แอดมินกรอกไว้ถือว่าถูกต้องกว่าชื่อที่ขนส่งส่งมาในครั้งนี้
        displayText: branch.branchName ?? parsed.displayText,
        branchCode,
      };
    }

    // ยังไม่รู้พิกัด — จดไว้ว่าเจออีกครั้ง แล้วบอกว่าไม่มีพิกัด
    // การจดไม่สำเร็จต้องไม่ทำให้ทั้งเส้นทางพัง (store กลืน error ไว้แล้ว)
    await store.recordUnknownBranch(carrierCode, branchCode, parsed.branchName);

    return {
      coordinates: null,
      source: "none",
      kind: "branch",
      displayText: parsed.displayText,
      branchCode,
    };
  }

  /* ---- 2. ที่อยู่จริง ---- */
  if (parsed.kind === "address" && parsed.geocodeQuery !== null) {
    const query = normalizeGeocodeQuery(parsed.geocodeQuery);

    const cached = await store.readGeocode(query);
    if (cached !== null) {
      return {
        coordinates: cached.coordinates,
        source: cached.found ? "geocode_saved" : "none",
        kind: "address",
        displayText: parsed.displayText,
        branchCode: null,
      };
    }

    let coordinates: Coordinates | null = null;
    try {
      coordinates = await geocode(parsed.geocodeQuery);
    } catch (cause) {
      // geocodeLocation ไม่ throw อยู่แล้ว แต่ตัวที่ถูกใส่เข้ามาแทนอาจ throw ได้
      console.warn(
        `[locations] หาพิกัดไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      // ไม่บันทึกลง cache เพราะยังไม่รู้ว่า "หาไม่เจอ" หรือ "ถามไม่ถึง"
      return nothing(parsed.displayText, "address");
    }

    // เก็บผลที่หาไม่เจอด้วย ไม่งั้นข้อความที่ Google ไม่รู้จักจะถูกถามซ้ำตลอดไป
    await store.writeGeocode(query, coordinates);

    return {
      coordinates,
      source: coordinates === null ? "none" : "geocode_fresh",
      kind: "address",
      displayText: parsed.displayText,
      branchCode: null,
    };
  }

  /* ---- 3. อ่านไม่ออก ---- */
  return nothing(parsed.displayText, parsed.kind);
}
