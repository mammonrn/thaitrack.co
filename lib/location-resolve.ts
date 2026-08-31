/**
 * หาพิกัดของข้อความสถานที่ ตามลำดับที่ "ไม่มีทางปักหมุดมั่ว"
 *
 *   1. เป็นรหัสสาขา → หาจากตาราง carrier_branches เท่านั้น
 *      เจอ   → ใช้พิกัดนั้น
 *      ไม่เจอ → จดลง unknown_branches แล้ว **ลองไปขอที่อยู่จากขนส่งมาเติมเอง**
 *              (ดู lib/branch-harvest.ts — มีด่านกันเผาโควตาสี่ชั้น)
 *              ได้ที่อยู่มา → ใช้พิกัดที่เพิ่งเติม · ไม่ได้ → ไม่มีพิกัด
 *              ห้ามเอาชื่อสาขาไป geocode ต่อ — จะได้หมุดกลางอำเภอ คือปัญหาเดิม
 *   2. ดูเหมือนที่อยู่จริง → ดู geocode_cache ก่อน ไม่มีค่อยถาม Google
 *      แล้วเก็บผลลง cache ถาวร (เก็บผลที่หาไม่เจอด้วย จะได้ไม่ถามซ้ำ)
 *   3. อ่านไม่ออกว่าเป็นอะไร → ไม่มีพิกัด และไม่เสีย quota ไปกับการเดา
 *
 * **ทุกทางที่จบด้วย "ไม่มีแผนที่" ถูกจดลง unknown_branches เสมอ** ไม่ใช่เฉพาะ
 * รหัสสาขาเหมือนเดิม เพราะถ้าไม่จด แอดมินไม่มีทางรู้เลยว่ามีสถานที่แบบไหน
 * ที่ผู้ใช้เจอแล้วไม่ได้แผนที่ — คอลัมน์ kind บอกว่าแต่ละแถวเป็นแบบไหน
 *
 * และก่อนจะยอมแพ้ทุกครั้ง จะเปิดตาราง carrier_branches ดูด้วยข้อความนั้นตรงๆ
 * อีกรอบ เพื่อให้พิกัดที่แอดมินกรอกไว้ใช้ได้กับข้อความทุกแบบ ไม่ใช่เฉพาะ
 * ข้อความที่ระบบมองว่าเป็นรหัสสาขา
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
import { probeBranchAddress, type ProbeOptions } from "./branch-harvest";
import { geocodeAddress, type Coordinates, type GeocodeHit } from "./geocode";
import {
  supabaseLocationStore,
  type CarrierBranch,
  type LocationStore,
} from "./supabase/locations";

/** ที่มาของพิกัดที่ได้ — ไว้ใส่ log และไว้ให้ UI อธิบายผู้ใช้ */
export type LocationSource =
  /** จากตารางพิกัดสาขาที่มีอยู่แล้ว */
  | "branch"
  /** จากตารางพิกัดสาขา หลังจากเพิ่งไปขอที่อยู่จากขนส่งมาเติมสดๆ */
  | "branch_filled"
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
  geocode?: (text: string) => Promise<GeocodeHit | null>;
  /**
   * เลขพัสดุที่กำลังดูอยู่ — ต้องมีถึงจะไปขอที่อยู่สาขามาเติมได้
   *
   * ไม่ส่งมาก็ทำงานได้ทุกอย่างตามเดิม เพียงแต่จะไม่มีการเติมพิกัดอัตโนมัติ
   */
  trackingNumber?: string;
  /** ตัวเลือกของการไปขอที่อยู่สาขา — ใส่เองได้ในเทสต์ */
  probe?: ProbeOptions;
  /** ปิดการไปขอที่อยู่สาขาสำหรับการเรียกครั้งนี้ */
  skipProbe?: boolean;
}

/**
 * ความยาวสูงสุดของ key ที่ใช้จดลง unknown_branches
 *
 * ตรงกับเพดานที่ API ของหน้าแอดมินยอมรับ (MAX_TEXT_LENGTH ใน
 * app/api/admin/branches/route.ts) — ถ้าจดค่าที่ยาวกว่านั้น แอดมินจะเห็นแถวนั้น
 * ในรายการแต่กรอกพิกัดไม่ได้เลย เพราะเซิร์ฟเวอร์จะปฏิเสธตอนบันทึก
 *
 * ตัดให้สั้นแบบเดียวกันทั้งตอนจดและตอนค้น ค่าที่ได้จึงยังจับคู่กันเสมอ
 */
const MAX_KEY_LENGTH = 200;

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

/** ผลลัพธ์เมื่อเจอพิกัดในตารางสาขา */
function fromBranch(
  branch: CarrierBranch,
  fallbackText: string,
  source: "branch" | "branch_filled",
): ResolvedLocation {
  return {
    coordinates: { lat: branch.lat, lng: branch.lng },
    source,
    kind: "branch",
    // ชื่อที่อยู่ในตารางถือว่าถูกต้องกว่าชื่อที่ขนส่งส่งมาในครั้งนี้
    displayText: branch.branchName ?? fallbackText,
    branchCode: branch.branchCode,
  };
}

/**
 * ทางออกสุดท้ายของทุกเส้นทางที่ยังไม่ได้พิกัด
 *
 * เปิดตารางสาขาด้วยข้อความนั้นตรงๆ อีกรอบ (เผื่อแอดมินกรอกพิกัดของข้อความ
 * แบบนี้ไว้) แล้วจดลง unknown_branches ถ้ายังไม่เจอ
 *
 * การจดต้องเกิดขึ้นเสมอเมื่อจบด้วยไม่มีแผนที่ ไม่ว่าข้อความจะเป็นแบบไหน —
 * นี่คือรายการงานของแอดมิน ถ้าไม่จด งานนั้นจะไม่มีอยู่ในสายตาใครเลย
 */
async function giveUp(
  store: LocationStore,
  carrierCode: string,
  key: string,
  displayText: string,
  kind: LocationKind,
  branchName: string | null,
): Promise<ResolvedLocation> {
  const branchCode = normalizeBranchCode(key).slice(0, MAX_KEY_LENGTH);
  if (branchCode === "") return nothing(displayText, kind);

  const branch = await store.findBranch(carrierCode, branchCode);
  if (branch !== null) return fromBranch(branch, displayText, "branch");

  // การจดไม่สำเร็จต้องไม่ทำให้ทั้งเส้นทางพัง (store กลืน error ไว้แล้ว)
  await store.recordUnknownBranch(carrierCode, branchCode, branchName, kind);

  return {
    coordinates: null,
    source: "none",
    kind,
    displayText,
    branchCode: kind === "branch" ? branchCode : null,
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
  const geocode = options.geocode ?? geocodeAddress;

  const parsed = parseLocationText(locationText);
  if (parsed.displayText === "") return nothing("", "unknown");

  /* ---- 1. รหัสสาขา ---- */
  if (parsed.kind === "branch" && parsed.branchCode !== null) {
    const branchCode = normalizeBranchCode(parsed.branchCode);
    const branch = await store.findBranch(carrierCode, branchCode);

    if (branch !== null) {
      return fromBranch(branch, parsed.displayText, "branch");
    }

    // จดไว้ก่อนเสมอ — ทั้งเพื่อให้แอดมินเห็น และเพราะการจองสิทธิ์ไปถามที่อยู่
    // (claim_branch_probe) ทำงานบนแถวในตารางนี้ ต้องมีแถวอยู่ก่อน
    await store.recordUnknownBranch(
      carrierCode,
      branchCode,
      parsed.branchName,
      "branch",
    );

    const filled = await tryFillBranch(store, carrierCode, branchCode, options);
    if (filled !== null) {
      return fromBranch(filled, parsed.displayText, "branch_filled");
    }

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
      if (cached.coordinates !== null) {
        return {
          coordinates: cached.coordinates,
          source: "geocode_saved",
          kind: "address",
          displayText: parsed.displayText,
          branchCode: null,
        };
      }
      // เคยถามแล้วหาไม่เจอ — ไม่ถาม Google ซ้ำ แต่ยังต้องจดว่าจบด้วยไม่มีแผนที่
      return giveUp(
        store,
        carrierCode,
        parsed.displayText,
        parsed.displayText,
        "address",
        null,
      );
    }

    let hit: GeocodeHit | null = null;
    try {
      hit = await geocode(parsed.geocodeQuery);
    } catch (cause) {
      // geocodeAddress ไม่ throw อยู่แล้ว แต่ตัวที่ถูกใส่เข้ามาแทนอาจ throw ได้
      console.warn(
        `[locations] หาพิกัดไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      // ไม่บันทึกลง cache เพราะยังไม่รู้ว่า "หาไม่เจอ" หรือ "ถามไม่ถึง"
      return nothing(parsed.displayText, "address");
    }

    // เก็บผลที่หาไม่เจอด้วย ไม่งั้นข้อความที่ Google ไม่รู้จักจะถูกถามซ้ำตลอดไป
    await store.writeGeocode(
      query,
      hit?.coordinates ?? null,
      hit?.precision ?? null,
    );

    if (hit !== null) {
      return {
        coordinates: hit.coordinates,
        source: "geocode_fresh",
        kind: "address",
        displayText: parsed.displayText,
        branchCode: null,
      };
    }

    return giveUp(
      store,
      carrierCode,
      parsed.displayText,
      parsed.displayText,
      "address",
      null,
    );
  }

  /* ---- 3. อ่านไม่ออก ---- */
  return giveUp(
    store,
    carrierCode,
    parsed.displayText,
    parsed.displayText,
    parsed.kind,
    null,
  );
}

/**
 * ลองไปขอที่อยู่ของสาขานี้มาเติมพิกัด — คืนแถวที่เพิ่งเติมได้ หรือ null
 *
 * แยกออกมาเพื่อให้เส้นทางหลักอ่านรู้เรื่อง และเพื่อให้ชัดว่าความล้มเหลวของ
 * ขั้นนี้ไม่กระทบอะไรเลยนอกจาก "ยังไม่มีพิกัดเหมือนเดิม"
 */
async function tryFillBranch(
  store: LocationStore,
  carrierCode: string,
  branchCode: string,
  options: ResolveLocationOptions,
): Promise<CarrierBranch | null> {
  const trackingNumber = options.trackingNumber?.trim() ?? "";
  if (options.skipProbe === true || trackingNumber === "") return null;

  try {
    const filled = await probeBranchAddress({
      trackingNumber,
      carrierCode,
      branchCode,
      store,
      options: options.probe,
    });
    if (!filled) return null;

    return await store.findBranch(carrierCode, branchCode);
  } catch (cause) {
    console.warn(
      `[locations] เติมพิกัดสาขา ${branchCode} ไม่สำเร็จ: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    return null;
  }
}
