/**
 * เติมพิกัดสาขาลงตารางของกลางเอง จากที่อยู่ที่ขนส่งห้อยมาท้ายข้อความ
 *
 * ปัญหาที่แก้: รหัสสาขาอย่าง "ACRAI-B" ไม่มีทาง geocode ได้ ที่ผ่านมาจึงต้อง
 * รอให้แอดมินเปิดหน้า /admin/branches แล้วไล่กรอกพิกัดทีละสาขาด้วยมือ
 *
 * แต่ ETrackings ส่งที่อยู่เต็มของสาขามาให้อยู่แล้วในบางบรรทัด:
 *
 *   "พัสดุถึงสาขาปลายทาง: ACRAI-B - เมืองเชียงราย - อยู่ที่ TH ... 639 หมู่ที่1
 *    ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100"
 *
 * ที่อยู่ตรงนั้น geocode ได้ ไฟล์นี้จึงเก็บมันมาแปลงเป็นพิกัดแล้วบันทึกลง
 * carrier_branches ให้เอง สาขาหนึ่งจ่ายราคาครั้งเดียวแล้วใช้ได้ตลอด กับทุกคน
 * และกับ **ทุกขนส่ง** ที่ส่งรหัสสาขาเดียวกันมา — carrier_branches เป็นของกลาง
 * ไม่ได้ผูกกับผู้ให้บริการ API เจ้าใดเจ้าหนึ่ง
 *
 * ------------------------------------------------------------------
 * ⚠️ สองกติกาที่ห้ามผ่อน
 *
 * 1. **ห้ามเขียนพิกัดที่หยาบลง carrier_branches** ตารางนั้นคือที่ที่ทั้งระบบ
 *    เชื่อว่าถูกต้องแน่นอน ถ้าปล่อยหมุดกลางอำเภอเข้าไปนั่ง บั๊กเดิม (ดู
 *    migration 0004) จะกลับมาแบบถาวรและมองไม่เห็น จึงรับเฉพาะผลที่ Google
 *    บอกว่าเป็น rooftop หรือ range เท่านั้น
 *
 * 2. **ห้ามทับของที่มีอยู่แล้ว** พิกัดที่แอดมินกรอกเองถือว่าถูกต้องกว่าเสมอ
 *    (บังคับที่ชั้นข้อมูลด้วย insert ไม่ใช่ upsert — ดู saveHarvestedBranch)
 * ------------------------------------------------------------------
 *
 * ทั้งไฟล์ห้ามโยน error — ถูกเรียกจากเส้นทางที่ผู้ใช้กำลังรอผลอยู่ การเติม
 * พิกัดไม่สำเร็จเป็นเรื่องปกติ ไม่ใช่ความล้มเหลวของการค้นหา
 */

import {
  normalizeBranchCode,
  normalizeGeocodeQuery,
  parseLocationText,
} from "./branch-location";
import { canTrack, isConfigured, track } from "./carriers/etrackings";
import type { TrackingResult } from "./carriers/types";
import { geocodeAddress, isPreciseEnough, type GeocodeHit } from "./geocode";
import { isNearQuota } from "./provider-usage";
import {
  supabaseLocationStore,
  type LocationStore,
} from "./supabase/locations";

/** ชื่อตัวแปร env ของด่านกันเผาโควตา */
export const PROBE_LIMIT_VAR = "BRANCH_PROBE_DAILY_LIMIT";
export const PROBE_COOLDOWN_VAR = "BRANCH_PROBE_COOLDOWN_HOURS";

/**
 * เพดานการไปถามที่อยู่สาขาต่อวันของโปรเซสนี้
 *
 * 10 ครั้ง/วัน = สาขาใหม่ 10 แห่งต่อวัน ซึ่งเร็วกว่าที่แอดมินกรอกมือได้มาก
 * และยังเหลือโควตาส่วนใหญ่ไว้ให้การค้นหาจริงของผู้ใช้
 */
export const DEFAULT_PROBE_DAILY_LIMIT = 10;

/**
 * ถามสาขาเดิมซ้ำได้เมื่อพ้นกี่ชั่วโมง
 *
 * 7 วัน — นานพอที่จะไม่เผาโควตากับสาขาที่ขนส่งไม่เคยส่งที่อยู่มาให้ แต่ไม่ใช่
 * "ห้ามถามตลอดกาล" เพราะขนส่งอาจเริ่มส่งที่อยู่มาในภายหลัง
 */
export const DEFAULT_PROBE_COOLDOWN_HOURS = 24 * 7;

/** เก็บที่อยู่ได้มากสุดกี่สาขาต่อผลลัพธ์หนึ่งชุด */
const MAX_BRANCHES_PER_RESULT = 5;

/** สาขาหนึ่งแห่งที่มีที่อยู่ให้หาพิกัดได้ */
export interface BranchAddress {
  branchCode: string;
  branchName: string | null;
  address: string;
}

/**
 * ดึงสาขาที่มีที่อยู่ติดมาด้วยออกจากผลลัพธ์ — ฟังก์ชันบริสุทธิ์
 *
 * รับเฉพาะบรรทัดที่ "สถานที่แยกเป็นรหัสสาขาได้" และ "มีที่อยู่ติดมา" ครบทั้ง
 * สองอย่าง ถ้าขาดข้อใดข้อหนึ่งก็ไม่รู้ว่าจะเอาพิกัดไปผูกกับรหัสอะไร
 *
 * รหัสเดียวกันที่โผล่หลายบรรทัดถูกยุบเหลืออันเดียว โดยใช้บรรทัดแรกที่เจอ
 */
export function collectBranchAddresses(
  result: TrackingResult,
): BranchAddress[] {
  const found = new Map<string, BranchAddress>();

  for (const event of result.events) {
    const address = (event.address ?? "").trim();
    if (address === "") continue;

    const parsed = parseLocationText(event.location);
    if (parsed.kind !== "branch" || parsed.branchCode === null) continue;

    const branchCode = normalizeBranchCode(parsed.branchCode);
    if (found.has(branchCode)) continue;

    found.set(branchCode, {
      branchCode,
      branchName: parsed.branchName,
      address,
    });
  }

  return [...found.values()].slice(0, MAX_BRANCHES_PER_RESULT);
}

export interface HarvestOptions {
  store?: LocationStore;
  /** ตัวหาพิกัดที่บอกความละเอียดมาด้วย (ค่าเริ่มต้น: Google Geocoding) */
  geocode?: (text: string) => Promise<GeocodeHit | null>;
}

/**
 * แปลงที่อยู่ของสาขาเป็นพิกัดแล้วบันทึกลงตารางของกลาง — คืนจำนวนที่บันทึกได้
 *
 * ผ่าน geocode_cache เสมอ จึงไม่ยิงถาม Google ซ้ำสำหรับที่อยู่เดิม ต่อให้
 * เจอสาขาเดียวกันจากพัสดุคนละใบก็ตาม
 */
export async function harvestBranchCoordinates(
  result: TrackingResult,
  options: HarvestOptions = {},
): Promise<number> {
  const store = options.store ?? supabaseLocationStore;
  const geocode = options.geocode ?? geocodeAddress;

  const candidates = collectBranchAddresses(result);
  if (candidates.length === 0) return 0;

  let saved = 0;

  for (const candidate of candidates) {
    try {
      // มีพิกัดอยู่แล้ว → ไม่ต้องทำอะไรต่อ และไม่ต้องเสีย quota ของ Google
      const existing = await store.findBranch(
        result.carrierCode,
        candidate.branchCode,
      );
      if (existing !== null) continue;

      const hit = await lookupAddress(candidate.address, store, geocode);
      if (hit === null) continue;

      const written = await store.saveHarvestedBranch({
        carrierCode: result.carrierCode,
        branchCode: candidate.branchCode,
        branchName: candidate.branchName,
        lat: hit.coordinates.lat,
        lng: hit.coordinates.lng,
        address: candidate.address,
      });

      if (written) {
        saved += 1;
        console.info(
          `[branch-harvest] เติมพิกัดสาขา carrier=${result.carrierCode}` +
            ` branch=${candidate.branchCode} precision=${hit.precision}`,
        );
      }
    } catch (cause) {
      console.warn(
        `[branch-harvest] เติมพิกัดสาขา ${candidate.branchCode} ไม่สำเร็จ: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
  }

  return saved;
}

/**
 * หาพิกัดของที่อยู่หนึ่งอัน ผ่าน cache — null เมื่อไม่ได้พิกัดที่ "แม่นพอ"
 *
 * แถวเก่าใน cache ที่ไม่รู้ความละเอียด (precision = null ดู migration 0006)
 * ถูกปฏิเสธด้วย ไม่ใช่เดาว่าแม่น และไม่ยิงถาม Google ใหม่เพื่อหาความละเอียด
 * เพราะข้อความพวกนั้นเข้ามาทางเส้นแสดงผลปกติ ไม่ใช่ที่อยู่สาขาแบบนี้
 */
async function lookupAddress(
  address: string,
  store: LocationStore,
  geocode: (text: string) => Promise<GeocodeHit | null>,
): Promise<GeocodeHit | null> {
  const query = normalizeGeocodeQuery(address);

  const cached = await store.readGeocode(query);
  if (cached !== null) {
    if (!cached.found || cached.coordinates === null) return null;
    if (!isPreciseEnough(cached.precision)) return null;
    return { coordinates: cached.coordinates, precision: cached.precision! };
  }

  const hit = await geocode(address);
  await store.writeGeocode(query, hit?.coordinates ?? null, hit?.precision ?? null);

  if (hit === null) return null;
  if (!isPreciseEnough(hit.precision)) {
    console.info(
      `[branch-harvest] ข้ามที่อยู่เพราะพิกัดหยาบเกินไป (${hit.precision})`,
    );
    return null;
  }
  return hit;
}

/* ------------------------------------------------------------------ *
 * ไปถามที่อยู่สาขาเพิ่ม — ด่านกันเผาโควตาอยู่ตรงนี้ทั้งหมด
 * ------------------------------------------------------------------ */

/** งบการถามของวันนี้ รีเซ็ตเองเมื่อข้ามวัน (เวลาไทย) */
let budget = { day: "", spent: 0 };

/** "2026-08-31" ตามเวลาไทย */
function today(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(now);
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function readProbeDailyLimit(): number {
  return readPositiveInt(
    process.env.BRANCH_PROBE_DAILY_LIMIT,
    DEFAULT_PROBE_DAILY_LIMIT,
  );
}

export function readProbeCooldownHours(): number {
  return readPositiveInt(
    process.env.BRANCH_PROBE_COOLDOWN_HOURS,
    DEFAULT_PROBE_COOLDOWN_HOURS,
  );
}

/** ใช้งบไปแล้วกี่ครั้งวันนี้ — ไว้ใส่ log และไว้ให้เทสต์ตรวจ */
export function probesToday(now: number = Date.now()): number {
  return budget.day === today(now) ? budget.spent : 0;
}

/** ล้างงบ — ใช้ในเทสต์เท่านั้น */
export function resetProbeBudget(): void {
  budget = { day: "", spent: 0 };
}

/** ขอใช้งบหนึ่งครั้ง — false เมื่อวันนี้ใช้ครบแล้ว */
function spendBudget(now: number): boolean {
  const day = today(now);
  if (budget.day !== day) budget = { day, spent: 0 };

  if (budget.spent >= readProbeDailyLimit()) return false;
  budget.spent += 1;
  return true;
}

export interface ProbeOptions extends HarvestOptions {
  now?: number;
  /** ตัวยิงถามขนส่ง (ค่าเริ่มต้น: ETrackings) — ใส่เองได้ในเทสต์ */
  fetchResult?: (trackingNumber: string) => Promise<TrackingResult>;
  /** ETrackings ตามเลขนี้ได้ไหม (ค่าเริ่มต้น: ตาราง prefix ของ ETrackings) */
  canProbe?: (trackingNumber: string) => boolean;
  /** โควตาของ ETrackings ใกล้เต็มหรือยัง */
  nearQuota?: () => boolean;
}

/**
 * ยิง ETrackings หนึ่งครั้งเพื่อขอที่อยู่ของสาขาที่ยังไม่รู้พิกัด
 *
 * คืน true เมื่อได้พิกัดใหม่ลงตารางจริงเท่านั้น
 *
 * ⚠️ กลไกกันเผาโควตา — สี่ด่านซ้อนกัน เรียงจากถูกไปแพง:
 *
 *   1. เลขนี้ ETrackings ตามได้ไหม (ตาราง prefix) — ตอบไม่ได้ก็ไม่เสียอะไรเลย
 *   2. โควตาของ ETrackings ใกล้เต็มหรือยัง — ใกล้เต็มแล้วต้องเก็บไว้ให้การ
 *      ค้นหาจริงของผู้ใช้ก่อน การเติมพิกัดรอวันหลังได้
 *   3. งบต่อวันของโปรเซสนี้ (BRANCH_PROBE_DAILY_LIMIT) — เพดานบนแบบหยาบๆ
 *      กันกรณีที่มีสาขาใหม่โผล่พรวดเดียวเป็นร้อย
 *   4. การจองสิทธิ์ในฐานข้อมูล (claim_branch_probe) — ด่านเดียวที่เป็น atomic
 *      จริงข้าม instance และเป็นตัวรับประกันว่า "สาขาหนึ่งจ่ายครั้งเดียว"
 *      สาขาที่ถามแล้วไม่ได้ที่อยู่จะถูกล็อกไว้จนพ้น cooldown
 *
 * ด่าน 4 ต้องมาหลังสุดเสมอ เพราะมันเขียนฐานข้อมูล — ถ้าเอามาไว้ก่อนด่านถูกๆ
 * เราจะเผา last_probe_at ทิ้งไปกับกรณีที่ยังไงก็ไม่ได้ยิงอยู่ดี
 */
export async function probeBranchAddress(input: {
  trackingNumber: string;
  carrierCode: string;
  branchCode: string;
  store: LocationStore;
  options?: ProbeOptions;
}): Promise<boolean> {
  const options = input.options ?? {};
  const now = options.now ?? Date.now();
  const fetchResult = options.fetchResult ?? track;
  const allowedByPrefix = options.canProbe ?? ((no: string) => canTrack(no));
  const nearQuota = options.nearQuota ?? (() => isNearQuota("etrackings", now));

  // ด่าน 0: ยังไม่ได้ตั้งค่าเจ้านี้ → ไม่มีอะไรให้ถาม
  if (options.fetchResult === undefined && !isConfigured()) return false;

  // ด่าน 1
  if (!allowedByPrefix(input.trackingNumber)) return false;

  // ด่าน 2
  if (nearQuota()) {
    console.info(
      "[branch-harvest] ข้ามการถามที่อยู่สาขาเพราะโควตา ETrackings ใกล้เต็ม",
    );
    return false;
  }

  // ด่าน 3
  if (!spendBudget(now)) {
    console.info(
      `[branch-harvest] ข้ามการถามที่อยู่สาขาเพราะใช้งบครบแล้ววันนี้ (${readProbeDailyLimit()} ครั้ง)`,
    );
    return false;
  }

  // ด่าน 4
  const claimed = await input.store.claimBranchProbe(
    input.carrierCode,
    input.branchCode,
    readProbeCooldownHours(),
  );
  if (!claimed) return false;

  let result: TrackingResult;
  try {
    result = await fetchResult(input.trackingNumber);
  } catch (cause) {
    console.info(
      `[branch-harvest] ถามที่อยู่สาขา ${input.branchCode} ไม่สำเร็จ: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    return false;
  }

  const saved = await harvestBranchCoordinates(result, {
    store: input.store,
    geocode: options.geocode,
  });

  return saved > 0;
}
