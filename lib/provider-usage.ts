/**
 * นับโควตาที่ใช้ของแต่ละผู้ให้บริการ แล้วบอกว่าเจ้าไหน "ใกล้เพดานแล้ว"
 *
 * ทำไมต้องมี: ตั้งแต่เปลี่ยนมาใช้สองเจ้าสลับกันตามความถนัด (ดู lib/carriers/resolve.ts)
 * ทั้งคู่กลายเป็นทางหลักที่ใช้จริงทุกวัน ไม่ใช่ทางสำรองที่แทบไม่ถูกแตะอีกต่อไป
 * ถ้าไม่นับ เจ้าใดเจ้าหนึ่งจะเงียบๆ ชนเพดานกลางเดือนแล้วเราไปรู้ตอนที่มันพัง
 *
 * สองชั้นที่ทำงานคู่กัน:
 *   1. ตัวนับใน memory — อ่านได้ทันทีแบบ sync ใช้ตัดสินใจเรื่องลำดับการยิง
 *   2. ตาราง provider_usage ใน Supabase — รอด restart และรวมยอดข้าม instance
 *      ทุกครั้งที่นับ ฐานข้อมูลจะคืนยอดจริงกลับมาให้ memory ปรับตาม
 *
 * ตัวเลขที่นับคือ "จำนวน request ที่ยิงออกไปจริง" ไม่ใช่จำนวนเลขพัสดุ
 * ⚠️ Track123 คิดโควตาเป็นจำนวนเลขพัสดุต่อรอบบิล ยอดที่นี่จึงสูงกว่ายอดบิลเสมอ
 * ใช้เป็นสัญญาณเตือนว่า "เริ่มใช้เยอะแล้ว" ไม่ใช่ยอดที่เอาไปกระทบยอดได้
 */

import {
  nextResetAt,
  periodKey,
  normalizeResetDay,
  type BillingCycle,
  type BillingPeriod,
} from "./billing-period";
import {
  supabaseProviderUsageStore,
  type ProviderUsageStore,
} from "./supabase/provider-usage";

/**
 * ผู้ให้บริการที่มีโควตาให้นับ
 *
 * ไปรษณีย์ไทยเคยไม่อยู่ในนี้เพราะคิดว่า "ฟรีและไม่จำกัด" แต่บัญชีทั่วไปมีเพดาน
 * ต่อเดือนอยู่ การไม่นับแปลว่ามันเป็นเจ้าเดียวที่เราไม่รู้เลยว่าใช้ไปเท่าไร
 * ทั้งที่เป็นเจ้าที่ถูกถามบ่อยที่สุด (ถูกถามก่อนทุกครั้งที่ prefix เดาไม่ออก)
 */
export type ProviderId = "thailand-post" | "track123" | "etrackings";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "thailand-post",
  "track123",
  "etrackings",
];

/** ชื่อไทยไว้แสดงในหน้าสถิติ */
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  "thailand-post": "ไปรษณีย์ไทย",
  track123: "Track123",
  etrackings: "ETrackings",
};

/**
 * ชื่อตัวแปร env ของเพดานแต่ละเจ้า
 *
 * ชื่อเดิมมีคำว่า MONTHLY อยู่ ซึ่งกลายเป็นคำโกหกตั้งแต่รู้ว่ารอบบิลของสามเจ้า
 * ไม่เหมือนกันเลย — ชื่อใหม่จึงตัดคำนั้นออก แต่ยังอ่านชื่อเดิมเป็นทางสำรอง
 * เพื่อไม่ให้ค่าที่ตั้งไว้แล้วบนเซิร์ฟเวอร์หายไปเงียบๆ ตอน deploy
 */
export const QUOTA_VARS: Record<ProviderId, string> = {
  "thailand-post": "THAILAND_POST_CALL_LIMIT",
  track123: "TRACK123_CALL_LIMIT",
  etrackings: "ETRACKINGS_CALL_LIMIT",
};

/** ชื่อตัวแปร env ของรูปแบบรอบบิล (daily | monthly | lifetime) */
export const CYCLE_VARS: Record<ProviderId, string> = {
  "thailand-post": "THAILAND_POST_BILLING_CYCLE",
  track123: "TRACK123_BILLING_CYCLE",
  etrackings: "ETRACKINGS_BILLING_CYCLE",
};

/** ชื่อตัวแปร env ของวันที่รอบเริ่มใหม่ (ใช้เฉพาะ monthly) */
export const RESET_DAY_VARS: Record<ProviderId, string> = {
  "thailand-post": "THAILAND_POST_BILLING_RESET_DAY",
  track123: "TRACK123_BILLING_RESET_DAY",
  etrackings: "ETRACKINGS_BILLING_RESET_DAY",
};

/**
 * รอบบิลเริ่มต้นของแต่ละเจ้า — ยืนยันจาก dashboard จริงทั้งสามเจ้าแล้ว
 *
 * ⚠️ ทั้งสามค่านี้เป็นข้อเท็จจริงของ **แผนที่ใช้อยู่ตอนนี้** ไม่ใช่คุณสมบัติถาวร
 * ของผู้ให้บริการ — ETrackings ที่เป็น lifetime อยู่เพราะใช้แผนฟรี ถ้าอัปแผน
 * เมื่อไรมันจะกลายเป็นรายเดือนทันที จึงต้องตั้งผ่าน env ได้ทุกค่า
 */
export const DEFAULT_PERIOD: Record<ProviderId, BillingPeriod> = {
  // รีเซ็ตทุกเที่ยงคืนเวลาไทย
  "thailand-post": { cycle: "daily", resetDay: 1 },
  // รายเดือนตามวันที่ซื้อแพ็กเกจ
  track123: { cycle: "monthly", resetDay: 29 },
  // แผนฟรี = โควตาก้อนเดียวตลอดอายุบัญชี ใช้หมดแล้วหมดเลย
  etrackings: { cycle: "lifetime", resetDay: 1 },
};

/**
 * เพดานเริ่มต้นต่อเดือน เมื่อไม่ได้ตั้ง env
 *
 * ตั้งไว้ค่อนไปทางระมัดระวัง เพราะผลของการตั้งต่ำเกินคือ "เอียงไปใช้อีกเจ้า
 * เร็วกว่าที่ควร" ซึ่งเสียแค่ความถนัด ส่วนผลของการตั้งสูงเกินคือ "ยิงจนโควตาหมด
 * แล้วค่อยรู้" ซึ่งคือสิ่งที่เรากำลังแก้อยู่พอดี
 *
 * ETrackings 50 = เพดานของแผนฟรีตามเอกสาร ส่วน Track123 ประเมินจากแผนเริ่มต้น
 * ทั้งคู่ปรับได้ผ่าน env และ **ควรปรับให้ตรงกับแผนที่ใช้จริง**
 */
export const DEFAULT_QUOTA: Record<ProviderId, number> = {
  // 1,000 ครั้ง/วัน
  "thailand-post": 1_000,
  // 300 ชิ้น/รอบ ตามแพ็กเกจที่ซื้อจริง (เดิมตั้งไว้ 1,000 ซึ่งสูงเกินจริงสามเท่า
  // แปลว่ากลไกเกลี่ยโหลดจะไม่เริ่มทำงานจนกว่าจะใช้ไป 800 ครั้ง = เกินเพดานจริง
  // ไปนานแล้ว)
  track123: 300,
  // แผนฟรี — ก้อนเดียวตลอดอายุบัญชี
  etrackings: 50,
};

/** ชื่อตัวแปร env ของสัดส่วนที่ถือว่า "ใกล้เพดาน" */
export const LEAN_RATIO_VAR = "PROVIDER_QUOTA_LEAN_RATIO";

/**
 * ใช้ไปกี่ส่วนของเพดานแล้วถือว่าใกล้เต็ม (0–1)
 *
 * 0.8 = เหลือ 20% ค่อยเริ่มเอียงไปอีกเจ้า นานพอให้ยังใช้เจ้าที่ถนัดได้เกือบ
 * ทั้งเดือน แต่เหลือ margin ให้เคสที่มีแต่เจ้านั้นเท่านั้นที่ตอบได้
 */
export const DEFAULT_LEAN_RATIO = 0.8;

/**
 * ชื่อตัวแปร env ของโควตาที่สงวนไว้ให้การเก็บที่อยู่สาขาโดยเฉพาะ
 *
 * ดูเหตุผลที่ readHarvestReserve()
 */
export const HARVEST_RESERVE_VAR = "ETRACKINGS_HARVEST_RESERVE";

/**
 * จำนวนครั้งท้ายๆ ของโควตา ETrackings ที่สงวนไว้ให้ branch-harvest เท่านั้น
 *
 * ------------------------------------------------------------------
 * นโยบายที่ตัดสินใจแล้ว: โควตา ETrackings ที่เหลือมีค่ากับ "การเก็บที่อยู่สาขา"
 * มากกว่า "การค้นหาทั่วไป" อย่างเทียบกันไม่ติด
 *
 *   ค้นหาทั่วไป      Track123 ก็ทำได้ ผลที่ได้หมดอายุพร้อม cache
 *   เก็บที่อยู่สาขา   ETrackings เป็นเจ้าเดียวที่ให้ที่อยู่เต็มมา และพิกัดที่
 *                    ได้มาอยู่ในตารางของกลางถาวร ใช้ซ้ำได้กับพัสดุทุกใบที่
 *                    ผ่านสาขานั้นตลอดไป = จ่ายครั้งเดียวได้ผลไม่รู้จบ
 *
 * 30 ครั้งสุดท้ายจากเพดาน 50 จึงถูกกันไว้ให้การเก็บที่อยู่ ส่วนการค้นหาทั่วไป
 * ใช้ได้แค่ 20 ครั้งแรกเท่านั้น
 * ------------------------------------------------------------------
 */
export const DEFAULT_HARVEST_RESERVE = 30;

/** ยอดที่นับได้ในรอบปัจจุบันของแต่ละเจ้า */
interface UsageState {
  /** คีย์รอบที่กำลังนับอยู่ของแต่ละเจ้า — ต่างจากนี้เมื่อไรคือขึ้นรอบใหม่แล้ว */
  periods: Record<ProviderId, string>;
  counts: Record<ProviderId, number>;
  /** คีย์รอบที่อ่านยอดจากฐานข้อมูลมาแล้ว — null คือยังไม่เคยอ่าน */
  loaded: Record<ProviderId, string | null>;
}

function emptyCounts(): Record<ProviderId, number> {
  return { "thailand-post": 0, track123: 0, etrackings: 0 };
}

function emptyState(): UsageState {
  return {
    periods: { "thailand-post": "", track123: "", etrackings: "" },
    counts: emptyCounts(),
    loaded: { "thailand-post": null, track123: null, etrackings: null },
  };
}

let state: UsageState = emptyState();

/** อ่านตัวเลขบวกจาก env — คืน fallback เมื่อไม่ได้ตั้งหรือตั้งค่าที่ใช้ไม่ได้ */
function readPositiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * ค่า env ทั้งหมดของเจ้านี้ — เขียนชื่อตัวแปรเต็มๆ ไม่อ้างแบบไดนามิก
 *
 * Next แทนค่า process.env.X ตอน build จากชื่อที่เขียนตรงๆ เท่านั้น การเขียน
 * process.env[name] จะได้ undefined เสมอบน production (เหตุผลเดียวกับ
 * lib/supabase/env.ts)
 */
function readEnv(provider: ProviderId): {
  quota: string | undefined;
  cycle: string | undefined;
  resetDay: string | undefined;
} {
  if (provider === "thailand-post") {
    return {
      quota:
        process.env.THAILAND_POST_CALL_LIMIT ??
        process.env.THAILAND_POST_MONTHLY_CALL_LIMIT,
      cycle: process.env.THAILAND_POST_BILLING_CYCLE,
      resetDay: process.env.THAILAND_POST_BILLING_RESET_DAY,
    };
  }
  if (provider === "track123") {
    return {
      quota:
        process.env.TRACK123_CALL_LIMIT ??
        process.env.TRACK123_MONTHLY_CALL_LIMIT,
      cycle: process.env.TRACK123_BILLING_CYCLE,
      resetDay: process.env.TRACK123_BILLING_RESET_DAY,
    };
  }
  return {
    quota:
      process.env.ETRACKINGS_CALL_LIMIT ??
      process.env.ETRACKINGS_MONTHLY_CALL_LIMIT,
    cycle: process.env.ETRACKINGS_BILLING_CYCLE,
    resetDay: process.env.ETRACKINGS_BILLING_RESET_DAY,
  };
}

/** ค่าที่รับได้ของรูปแบบรอบบิล — ค่าอื่นถูกเมินแล้วใช้ค่าเริ่มต้นแทน */
const CYCLES: ReadonlySet<string> = new Set(["daily", "monthly", "lifetime"]);

/** รอบบิลของเจ้านี้ตามที่ตั้งไว้ */
export function readPeriod(provider: ProviderId): BillingPeriod {
  const env = readEnv(provider);
  const fallback = DEFAULT_PERIOD[provider];

  const raw = (env.cycle ?? "").trim().toLowerCase();
  const cycle: BillingCycle = CYCLES.has(raw)
    ? (raw as BillingCycle)
    : fallback.cycle;

  return {
    cycle,
    resetDay: normalizeResetDay(
      readPositiveNumber(env.resetDay, fallback.resetDay),
    ),
  };
}

/** คีย์รอบที่กำลังใช้อยู่ของเจ้านี้ */
export function currentPeriodKey(
  provider: ProviderId,
  now: number = Date.now(),
): string {
  return periodKey(readPeriod(provider), now);
}

/** เวลาที่รอบถัดไปของเจ้านี้จะเริ่ม — null เมื่อไม่มีวันรีเซ็ต */
export function nextResetOf(
  provider: ProviderId,
  now: number = Date.now(),
): number | null {
  return nextResetAt(readPeriod(provider), now);
}

/** ขึ้นรอบใหม่แล้วเริ่มนับใหม่ — เรียกก่อนแตะ state ของเจ้านี้ทุกครั้ง */
function rollOver(provider: ProviderId, now: number): void {
  const key = currentPeriodKey(provider, now);
  if (state.periods[provider] === key) return;

  state.periods[provider] = key;
  state.counts[provider] = 0;
  state.loaded[provider] = null;
}

/** เพดานต่อรอบของเจ้านี้ */
export function readQuota(provider: ProviderId): number {
  return readPositiveNumber(readEnv(provider).quota, DEFAULT_QUOTA[provider]);
}

/** สัดส่วนที่ถือว่าใกล้เพดาน — บีบให้อยู่ในช่วง 0–1 เสมอ */
export function readLeanRatio(): number {
  const value = readPositiveNumber(
    process.env.PROVIDER_QUOTA_LEAN_RATIO,
    DEFAULT_LEAN_RATIO,
  );
  return Math.min(value, 1);
}

/** โควตาที่สงวนไว้ให้การเก็บที่อยู่สาขา — บีบไม่ให้เกินเพดานของเจ้านั้น */
export function readHarvestReserve(provider: ProviderId): number {
  if (provider !== "etrackings") return 0;

  const value = readPositiveNumber(
    process.env.ETRACKINGS_HARVEST_RESERVE,
    DEFAULT_HARVEST_RESERVE,
  );
  return Math.min(value, readQuota(provider));
}

/** ยอดที่นับได้ในรอบนี้ของเจ้านี้ */
export function usageOf(
  provider: ProviderId,
  now: number = Date.now(),
): number {
  rollOver(provider, now);
  return state.counts[provider];
}

/** ใช้ไปกี่ส่วนของเพดานแล้ว (0–1+) */
export function quotaPressure(
  provider: ProviderId,
  now: number = Date.now(),
): number {
  return usageOf(provider, now) / readQuota(provider);
}

/** ใกล้เพดานจนควรเอียงไปใช้อีกเจ้าหรือยัง */
export function isNearQuota(
  provider: ProviderId,
  now: number = Date.now(),
): boolean {
  return quotaPressure(provider, now) >= readLeanRatio();
}

/**
 * โควตาหมดแล้ว — ห้ามยิงเจ้านี้อีกจนกว่าจะขึ้นรอบใหม่
 *
 * ต่างจาก isNearQuota ที่แปลว่า "เอียงไปใช้อีกเจ้าก่อน" (ยังยิงได้ถ้าจำเป็น)
 * ข้อนี้คือห้ามเด็ดขาด เพราะยิงไปก็ได้ error กลับมาอย่างเดียว เสียเวลาผู้ใช้
 * ฟรีๆ และทำให้ log เต็มไปด้วยความล้มเหลวที่รู้ล่วงหน้าอยู่แล้ว
 */
export function isExhausted(
  provider: ProviderId,
  now: number = Date.now(),
): boolean {
  return usageOf(provider, now) >= readQuota(provider);
}

/**
 * ยังใช้เจ้านี้กับ "การค้นหาทั่วไป" ได้อยู่ไหม
 *
 * ต่างจาก isExhausted ตรงที่กันโควตาส่วนที่สงวนไว้ให้ branch-harvest ออกไปด้วย
 * (ดู readHarvestReserve) — การเก็บที่อยู่สาขายังใช้โควตาส่วนนั้นได้ต่อ
 */
export function canUseForLookup(
  provider: ProviderId,
  now: number = Date.now(),
): boolean {
  const budget = readQuota(provider) - readHarvestReserve(provider);
  return usageOf(provider, now) < budget;
}

export interface UsageOptions {
  now?: number;
  /** ชั้นเก็บยอดถาวร (ค่าเริ่มต้น: ตาราง provider_usage ใน Supabase) */
  store?: ProviderUsageStore;
}

/**
 * ดึงยอดของรอบปัจจุบันจากฐานข้อมูลมาใส่ตัวนับใน memory — ทำครั้งเดียวต่อรอบ
 *
 * จำเป็นเพราะหลัง restart ตัวนับใน memory เป็นศูนย์ ถ้าไม่อ่านของจริงมาก่อน
 * การตัดสินใจเรื่องลำดับจะเชื่อว่า "ยังไม่ได้ใช้อะไรเลย" ทั้งที่โควตาอาจใกล้หมด
 * แล้ว — ซึ่งเป็นสถานการณ์เดียวกับตอนที่ไม่มีตัวนับเลย
 *
 * ห้ามโยน error (store กลืนไว้ให้แล้ว) และเรียกซ้ำได้ตลอด ราคาถูก
 */
export async function loadProviderUsage(
  options: UsageOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now();

  const wanted: Record<string, string> = {};
  for (const provider of PROVIDER_IDS) {
    rollOver(provider, now);
    if (state.loaded[provider] !== state.periods[provider]) {
      wanted[provider] = state.periods[provider];
    }
  }

  if (Object.keys(wanted).length === 0) return;

  const store = options.store ?? supabaseProviderUsageStore;
  const counts = await store.read(wanted);

  // ระหว่างรออ่าน อาจมีการนับเพิ่มไปแล้ว จึงเอาค่าที่มากกว่าเสมอ
  // ไม่ใช่ทับทิ้ง — ตัวนับต้องไม่เดินถอยหลัง
  for (const provider of PROVIDER_IDS) {
    if (wanted[provider] === undefined) continue;

    const fromStore = counts[provider];
    if (typeof fromStore === "number" && fromStore > state.counts[provider]) {
      state.counts[provider] = fromStore;
    }
    state.loaded[provider] = state.periods[provider];
  }
}

/**
 * นับการยิงหนึ่งครั้ง แล้วคืนยอดสะสมของรอบนี้
 *
 * นับใน memory ก่อนเสมอ แล้วค่อยไปบันทึกลงฐานข้อมูล — ถ้าฐานข้อมูลล่ม
 * ตัวนับยังเดินต่อได้ (แค่กลับไปเป็นยอดของโปรเซสเดียวเหมือนของเดิม)
 */
export async function countProviderCall(
  provider: ProviderId,
  options: UsageOptions = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  rollOver(provider, now);

  state.counts[provider] += 1;

  const store = options.store ?? supabaseProviderUsageStore;
  const persisted = await store.bump(provider, state.periods[provider]);

  // ยอดจากฐานข้อมูลรวมของทุก instance จึงเป็นตัวจริง แต่ต้องไม่ทำให้ตัวนับ
  // เดินถอยหลังในกรณีที่ฐานข้อมูลตามไม่ทัน
  if (persisted !== null && persisted > state.counts[provider]) {
    state.counts[provider] = persisted;
  }

  return state.counts[provider];
}

/** ข้อความสรุปโควตาไว้ต่อท้าย log เช่น "used=12/50" */
export function usageLabel(
  provider: ProviderId,
  now: number = Date.now(),
): string {
  return `${usageOf(provider, now)}/${readQuota(provider)}`;
}

/** ล้างตัวนับ — ใช้ในเทสต์เท่านั้น */
export function resetProviderUsage(): void {
  state = emptyState();
}
