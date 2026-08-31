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

/** ชื่อตัวแปร env ของเพดานแต่ละเจ้า */
export const QUOTA_VARS: Record<ProviderId, string> = {
  "thailand-post": "THAILAND_POST_MONTHLY_CALL_LIMIT",
  track123: "TRACK123_MONTHLY_CALL_LIMIT",
  etrackings: "ETRACKINGS_MONTHLY_CALL_LIMIT",
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
  // 1,000 ชิ้น/เดือนตามที่เข้าใจว่าเป็นเพดานของบัญชีทั่วไป — ตัวเลขนี้ไม่ได้
  // ยืนยันจากเอกสารทางการ ถ้ารู้เพดานจริงของบัญชีที่ใช้อยู่ ให้ตั้งผ่าน env
  "thailand-post": 1_000,
  track123: 1_000,
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

/** ยอดที่นับได้ในเดือนปัจจุบัน แยกตามเจ้า */
interface UsageState {
  /** "2026-08" ตามเวลาไทย — ต่างจากนี้เมื่อไรคือข้ามเดือนแล้ว ต้องเริ่มนับใหม่ */
  month: string;
  counts: Record<ProviderId, number>;
  /** เดือนที่อ่านยอดจากฐานข้อมูลมาแล้ว — null คือยังไม่เคยอ่าน */
  loadedMonth: string | null;
}

function emptyCounts(): Record<ProviderId, number> {
  return { "thailand-post": 0, track123: 0, etrackings: 0 };
}

let state: UsageState = {
  month: "",
  counts: emptyCounts(),
  loadedMonth: null,
};

/** "2026-08" ตามเวลาไทย — รอบบิลของผู้ให้บริการไทยย่อมนับตามเวลาไทย */
export function currentMonth(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(now);
}

/** ข้ามเดือนแล้วเริ่มนับใหม่ — เรียกก่อนแตะ state ทุกครั้ง */
function rollOver(now: number): void {
  const month = currentMonth(now);
  if (state.month === month) return;
  state = { month, counts: emptyCounts(), loadedMonth: null };
}

/** อ่านตัวเลขบวกจาก env — คืน fallback เมื่อไม่ได้ตั้งหรือตั้งค่าที่ใช้ไม่ได้ */
function readPositiveNumber(raw: string | undefined, fallback: number): number {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** เพดานต่อเดือนของเจ้านี้ */
export function readQuota(provider: ProviderId): number {
  // เขียนชื่อตัวแปรเต็มๆ ไม่อ้างแบบไดนามิก เพราะ Next แทนค่า process.env.X
  // ตอน build จากชื่อที่เขียนตรงๆ เท่านั้น (เหตุผลเดียวกับ lib/supabase/env.ts)
  const raw =
    provider === "thailand-post"
      ? process.env.THAILAND_POST_MONTHLY_CALL_LIMIT
      : provider === "track123"
        ? process.env.TRACK123_MONTHLY_CALL_LIMIT
        : process.env.ETRACKINGS_MONTHLY_CALL_LIMIT;

  return readPositiveNumber(raw, DEFAULT_QUOTA[provider]);
}

/** สัดส่วนที่ถือว่าใกล้เพดาน — บีบให้อยู่ในช่วง 0–1 เสมอ */
export function readLeanRatio(): number {
  const value = readPositiveNumber(
    process.env.PROVIDER_QUOTA_LEAN_RATIO,
    DEFAULT_LEAN_RATIO,
  );
  return Math.min(value, 1);
}

/** ยอดที่นับได้ในเดือนนี้ของเจ้านี้ */
export function usageOf(
  provider: ProviderId,
  now: number = Date.now(),
): number {
  rollOver(now);
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

export interface UsageOptions {
  now?: number;
  /** ชั้นเก็บยอดถาวร (ค่าเริ่มต้น: ตาราง provider_usage ใน Supabase) */
  store?: ProviderUsageStore;
}

/**
 * ดึงยอดของเดือนนี้จากฐานข้อมูลมาใส่ตัวนับใน memory — ทำครั้งเดียวต่อเดือน
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
  rollOver(now);

  if (state.loadedMonth === state.month) return;

  const store = options.store ?? supabaseProviderUsageStore;
  const counts = await store.read(state.month);

  // ระหว่างรออ่าน อาจมีการนับเพิ่มไปแล้ว จึงเอาค่าที่มากกว่าเสมอ
  // ไม่ใช่ทับทิ้ง — ตัวนับต้องไม่เดินถอยหลัง
  for (const provider of PROVIDER_IDS) {
    const fromStore = counts[provider];
    if (typeof fromStore === "number" && fromStore > state.counts[provider]) {
      state.counts[provider] = fromStore;
    }
  }

  state.loadedMonth = state.month;
}

/**
 * นับการยิงหนึ่งครั้ง แล้วคืนยอดสะสมของเดือนนี้
 *
 * นับใน memory ก่อนเสมอ แล้วค่อยไปบันทึกลงฐานข้อมูล — ถ้าฐานข้อมูลล่ม
 * ตัวนับยังเดินต่อได้ (แค่กลับไปเป็นยอดของโปรเซสเดียวเหมือนของเดิม)
 */
export async function countProviderCall(
  provider: ProviderId,
  options: UsageOptions = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  rollOver(now);

  state.counts[provider] += 1;

  const store = options.store ?? supabaseProviderUsageStore;
  const persisted = await store.bump(provider, state.month);

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
  state = { month: "", counts: emptyCounts(), loadedMonth: null };
}
