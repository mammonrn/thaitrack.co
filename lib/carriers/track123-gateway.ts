/**
 * ประตูทางออกเดียวของการยิง Track123 — คิว, ลองใหม่, และ log
 *
 * ทุก request ที่ออกไปหา Track123 ต้องผ่าน callTrack123() ที่นี่ที่เดียว จะได้
 * มั่นใจว่าไม่มีทางลัดไหนหลุดออกไปยิงโดยไม่ผ่านคิว และทุกครั้งที่ยิงมี log ครบ
 *
 * สามชั้นที่ซ้อนกันอยู่ (จากนอกเข้าใน):
 *   1. ลองใหม่สองแบบที่มีเหตุผลคนละอย่างกัน (ดู SYSTEM_RETRY_DELAY_MS)
 *      การลองใหม่แต่ละรอบต้องกลับไปเข้าคิวใหม่ ไม่ใช่ยิงตรง ไม่งั้นจะไปซ้ำเติม
 *      สถานการณ์ที่ปลายทางกำลังบอกว่ารับไม่ไหวอยู่แล้ว
 *   2. คิวจำกัดอัตรา — ไม่เกิน MAX_REQUESTS_PER_SECOND ครั้งต่อวินาที
 *   3. log หนึ่งบรรทัดต่อหนึ่ง request ที่ออกไปจริง
 *
 * ทำไมต้องมีทั้งคิวและ backoff ทั้งที่คิวควรกันได้อยู่แล้ว: คิวอยู่ใน memory
 * ของ process เดียว ถ้ามี process อื่น (หรือ deploy หลาย instance) ใช้ API key
 * เดียวกันอยู่ ลิมิตยังชนได้อยู่ดี backoff จึงเป็นตาข่ายชั้นสุดท้าย
 */

import { CircuitBreaker } from "../circuit-breaker";
import { countProviderCall } from "../provider-usage";
import { RateLimitQueue, delay } from "../rate-limit-queue";
import {
  CarrierError,
  TIMEOUT_UPSTREAM_CODE,
  type TrackingErrorCode,
} from "./types";

/**
 * เพดานที่เราจำกัดตัวเอง (ครั้ง/วินาที)
 *
 * Track123 ให้ 5 ครั้ง/วินาทีต่อ endpoint เราเผื่อ margin ไว้ 2 ครั้ง เพราะ
 * นาฬิกาของเรากับของปลายทางไม่ตรงกัน request ที่เราเริ่มยิงห่างกันพอดี อาจไปถึง
 * ปลายทางกระจุกกันได้ และเผื่อ process อื่นที่ใช้ API key เดียวกัน
 */
export const MAX_REQUESTS_PER_SECOND = 3;

/**
 * ระยะหน่วงก่อนลองใหม่แต่ละรอบเมื่อชนลิมิต (ms) — เพิ่มเป็นเท่าตัวไปเรื่อยๆ
 *
 * ความยาวของรายการ = จำนวนครั้งที่ยอมลองใหม่ รวมแล้วยิงได้มากสุด 4 ครั้ง
 * และรออยู่ในระบบนานสุดประมาณ 3.5 วินาทีก่อนยอมแพ้ ซึ่งยังสั้นกว่า timeout
 * ของ request เดียว (20 วินาที) มาก
 */
export const BACKOFF_DELAYS_MS: readonly number[] = [500, 1_000, 2_000];

/**
 * ระยะหน่วงก่อนลองใหม่เมื่อปลายทางล้มด้วยเหตุระบบชั่วคราว (ms)
 *
 * ------------------------------------------------------------------
 * ทำไมต้องแยกจาก BACKOFF_DELAYS_MS ทั้งที่เป็นการลองใหม่เหมือนกัน
 *
 * การชนลิมิตกับปลายทางสะดุด เป็นคนละอาการที่ต้องการการรอคนละแบบ:
 *
 *   ชนลิมิต    หายเองแน่นอนถ้ารอนานพอ การรอเพิ่มเป็นเท่าตัวจึงคุ้ม
 *              ลองได้หลายรอบ (3 รอบ ตาม BACKOFF_DELAYS_MS)
 *   ระบบสะดุด  ถ้าปลายทางล่มจริง รออีก 2 วินาทีก็ไม่หาย การลองหลายรอบมีแต่จะ
 *              ทำให้ผู้ใช้รอ 6+6+6 วินาทีแล้วล้มอยู่ดี **ลองครั้งเดียวพอ**
 *              และหน่วงสั้นๆ แค่พอให้ไม่ยิงติดกันจนดูเหมือนการถล่ม
 *
 * เจอจาก log จริง: เลข TH54018X21H76P โดน upstream_error หลังรอ 6.1 วินาที
 * (ไม่ใช่ timeout — timeout ของเราคือ 20 วินาที แปลว่าปลายทางตอบกลับมาจริงแต่
 * ตอบเป็น error) แล้วทั้งคำขอจบทันทีเพราะเลขนี้เดา courier ไม่ได้ จึงไม่มี
 * เจ้าที่สองให้ไปต่อ · การค้นซ้ำด้วยมือ 13 วินาทีถัดมาสำเร็จใน 194ms
 * = อาการชั่วคราวแท้ๆ ที่การลองใหม่ครั้งเดียวก็เอาอยู่
 *
 * ก่อนหน้านี้ error กลุ่มนี้ไม่เคยถูกลองใหม่เลยแม้แต่ครั้งเดียว เพราะเงื่อนไข
 * เดิมเช็คแค่ isRateLimited()
 * ------------------------------------------------------------------
 */
export const SYSTEM_RETRY_DELAY_MS = 400;

/**
 * error ที่ถือว่า "ปลายทางสะดุดชั่วคราว" จึงลองใหม่ได้อีกครั้งเดียว
 *
 * ตั้งใจไม่รวม auth_failed กับ config_error — สิทธิ์ผิดหรือตั้งค่าผิดยิงอีกกี่ครั้ง
 * ก็ได้คำตอบเดิม การลองใหม่มีแต่จะเปลืองโควตาและถ่วงเวลาผู้ใช้
 * และไม่รวม not_found กับ invalid_tracking_number ซึ่งเป็นคำตอบที่แท้จริง
 */
const RETRYABLE_SYSTEM_ERRORS: ReadonlySet<TrackingErrorCode> = new Set([
  "upstream_error",
  "network_error",
]);

/**
 * เพดานการลองใหม่ของ error กลุ่มระบบ ต่อหนึ่งคำขอ
 *
 * หนึ่งครั้งโดยตั้งใจ — ดูเหตุผลที่ SYSTEM_RETRY_DELAY_MS
 */
const SYSTEM_RETRY_LIMIT = 1;

/** คิวกลางที่ทุกการยิง Track123 ในโปรเซสนี้ใช้ร่วมกัน */
export const track123Queue = new RateLimitQueue(MAX_REQUESTS_PER_SECOND);

/**
 * เกณฑ์ของ circuit breaker
 *
 * 5 ครั้งใน 1 นาที = ปลายทางล่มจริง ไม่ใช่ความซวยรายครั้ง ด้วยเพดาน 3 req/s
 * ของคิว การพัง 5 ครั้งติดกันใช้เวลาอย่างน้อยประมาณ 1.7 วินาที จึงเป็นสัญญาณ
 * ที่ชัดพอโดยไม่ไวเกินไป
 *
 * พัก 30 วินาทีก่อนลองแตะดู — นานพอให้ปลายทางที่กำลัง deploy หรือ restart
 * ได้ฟื้น แต่สั้นพอที่ผู้ใช้ที่กดค้นใหม่หลังเห็นข้อความ error จะเจอระบบที่
 * กลับมาทำงานแล้ว
 */
export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_COOLDOWN_MS = 30_000;

/**
 * breaker กลางของ Track123 ในโปรเซสนี้
 *
 * ตอนเปิดวงจร คำขอจะถูกปฏิเสธทันทีโดยไม่ยิงจริงและไม่เข้าคิว ผู้ใช้จึงไม่ต้อง
 * รอ timeout 20 วินาทีทีละคน และคิวไม่ถูกอุดด้วยคำขอที่รู้อยู่แล้วว่าจะพัง
 */
export const track123Breaker = new CircuitBreaker({
  name: "track123",
  failureThreshold: BREAKER_FAILURE_THRESHOLD,
  windowMs: BREAKER_WINDOW_MS,
  cooldownMs: BREAKER_COOLDOWN_MS,
});

/**
 * error ที่นับว่า "ปลายทางมีปัญหา" สำหรับ breaker
 *
 * ตั้งใจไม่รวม not_found กับ invalid_tracking_number เพราะสองอันนั้นคือคำตอบ
 * ที่ถูกต้องของปลายทางที่ทำงานปกติดี ถ้านับด้วย วันที่คนค้นเลขผิดกันเยอะๆ
 * วงจรจะถูกตัดทั้งที่ Track123 ไม่ได้เป็นอะไรเลย
 *
 * auth_failed นับด้วย เพราะสิทธิ์พังแปลว่ายิงไปกี่ครั้งก็ไม่ผ่าน การหยุดยิง
 * ชั่วคราวแล้วข้ามไปเจ้าสำรองคือสิ่งที่ถูกต้อง
 *
 * config_error ด้วยเหตุผลเดียวกันเป๊ะ (เช่น ลืมตั้ง TRACK123_API_KEY — readApiKey()
 * โยน error นี้จากในตัว request จึงมาถึงตรงนี้จริง) ถ้าไม่นับ วันที่ตั้งค่าผิดจน
 * ยิงพังทุกครั้ง วงจรจะไม่มีวันเปิด ผู้ใช้ทุกคนต้องรอเสียเวลาซ้ำๆ ทั้งที่รู้ผล
 * ล่วงหน้าอยู่แล้วว่าจะพัง
 */
const BREAKER_FAILURES: ReadonlySet<TrackingErrorCode> = new Set([
  "rate_limited",
  "network_error",
  "upstream_error",
  "auth_failed",
  "config_error",
]);

/** error ที่แจ้งว่าวงจรถูกตัดอยู่ — ผู้เรียกใช้เป็นสัญญาณให้ข้ามไปเจ้าสำรอง */
function breakerOpenError(remainingMs: number): CarrierError {
  return new CarrierError(
    "upstream_error",
    "ระบบ Track123 ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
    {
      debugMessage:
        `ข้ามการยิง Track123 เพราะ circuit breaker เปิดอยู่ ` +
        `(เหลืออีก ${remainingMs}ms ถึงจะลองแตะดู)`,
      upstreamCode: "breaker_open",
    },
  );
}

/** ข้อมูลของ request ที่จะโผล่ใน log */
export interface Track123CallMeta {
  /** เลขพัสดุที่ normalize แล้ว */
  trackNo: string;
  /** courierCode ที่ระบุไป — undefined = ปล่อยให้ Track123 ตรวจจับเอง */
  courierCode?: string;
}

export interface Track123CallOptions {
  /** คิวที่จะใช้ (ค่าเริ่มต้น: คิวกลางของโปรเซส) — ใส่เองได้ในเทสต์ */
  queue?: RateLimitQueue;
  /** ระยะหน่วงก่อนลองใหม่ (ค่าเริ่มต้น: BACKOFF_DELAYS_MS) */
  backoffMs?: readonly number[];
  /** ปลายทางของ log (ค่าเริ่มต้น: console.info) */
  log?: (line: string) => void;
  /** circuit breaker (ค่าเริ่มต้น: ตัวกลางของโปรเซส) — null = ไม่ใช้ */
  breaker?: CircuitBreaker | null;
  /**
   * ตัวนับโควตาที่ใช้ไป (ค่าเริ่มต้น: ตัวนับกลางใน lib/provider-usage.ts)
   *
   * นับที่นี่เพราะที่นี่คือทางออกเดียวของการยิง Track123 จริง — ทุก request
   * ที่ออกไปผ่านตรงนี้หมด ไม่มีทางลัดไหนหลุดไปโดยไม่ถูกนับ
   */
  countUsage?: () => Promise<unknown>;
}

/** ฟิลด์ทั้งหมดของ log หนึ่งบรรทัด */
export interface Track123CallLog {
  /** เวลาที่ "เริ่มยิง" จริง (epoch ms) ไม่ใช่เวลาที่เข้าคิว */
  ts: number;
  trackNo: string;
  /** courierCode ที่ระบุไป หรือ "auto" เมื่อปล่อยให้ตรวจจับเอง */
  courier: string;
  /** ยิงเป็นครั้งที่เท่าไรของคำขอนี้ */
  attempt: number;
  /** ยิงได้มากสุดกี่ครั้ง */
  maxAttempts: number;
  /** มีคำขออัดอยู่ในคิวกี่ตัว ณ ตอนที่คำขอนี้เข้าคิว (นับตัวเองด้วย) */
  queued: number;
  /** รอคิวกี่ ms ก่อนได้ยิง */
  waitMs: number;
  /** ยิงแล้วใช้เวลากี่ ms กว่าจะรู้ผล */
  tookMs: number;
  /** "ok" หรือ code ของ CarrierError เช่น "not_found", "rate_limited" */
  result: string;
  /** code ดิบที่ Track123 ตอบมา เช่น "A0706" — undefined ถ้าไม่มี */
  upstream?: string;
}

/**
 * ประกอบ log ให้เป็นบรรทัดเดียวแบบ key=value
 *
 * ตั้งใจให้นับจาก pm2 logs ได้ตรงๆ โดยไม่ต้องพึ่งเครื่องมืออะไร:
 *   นับจำนวน request ทั้งหมด : pm2 logs --nostream | grep -c '\[track123\]'
 *   หาจังหวะที่อัดกันเยอะ    : pm2 logs --nostream | grep '\[track123\]' | grep -v 'queued=1 '
 *   หาครั้งที่ชนลิมิตจริง     : pm2 logs --nostream | grep 'result=rate_limited'
 *
 * export ไว้เพื่อให้เทสต์ตรวจรูปแบบได้โดยไม่ต้องยิง API จริง
 */
export function formatCallLog(fields: Track123CallLog): string {
  const parts = [
    `ts=${fields.ts}`,
    `no=${fields.trackNo}`,
    `courier=${fields.courier}`,
    `attempt=${fields.attempt}/${fields.maxAttempts}`,
    `queued=${fields.queued}`,
    `wait=${fields.waitMs}ms`,
    `took=${fields.tookMs}ms`,
    `result=${fields.result}`,
  ];
  if (fields.upstream !== undefined) parts.push(`upstream=${fields.upstream}`);

  return `[track123] ${parts.join(" ")}`;
}

/**
 * คำขอที่จบแบบนี้ กินโควตาของ Track123 จริงหรือเปล่า
 *
 * ------------------------------------------------------------------
 * ทำไมต้องมี: ตัวนับของเราเคยนับ **ทุกครั้งที่ตั้งใจจะยิง** ซึ่งรวมรอบที่
 * Track123 ปฏิเสธด้วย A0706 ("ยิงถี่เกินไป") เข้าไปด้วย รอบพวกนั้นไม่ได้
 * ข้อมูลอะไรกลับมาเลย และปลายทางไม่คิดเงิน แต่เราไปนับเป็นโควตาที่ใช้แล้ว
 *
 * ผลจากข้อมูลจริง (นับจาก log ของ gateway เอง 535 บรรทัด):
 *
 *   result=rate_limited   171   ← 32% ของทั้งหมด ไม่ได้ข้อมูล ไม่ถูกคิดเงิน
 *   result=not_found      263
 *   result=upstream_error  59
 *   result=ok              53
 *
 * ตัวนับจึงพองจนแซงเพดานทั้งที่ของจริงยังเหลือ (ของเราขึ้น 575/300 แต่
 * dashboard ของ Track123 บอกใช้จริง 277/300) แล้วไปปิดสวิตช์ที่คอยปกป้อง
 * โควตาของ ETrackings จนโควตาฝั่งค้นหาของเจ้านั้นถูกใช้จนหมด
 * (ดู chooseProviderOrder ใน ./resolve.ts — กติกาข้อ 2 ต้องการ
 * !fallbackNearQuota ถึงจะยอมสลับมาใช้ Track123 เพื่อถนอม ETrackings)
 * ------------------------------------------------------------------
 *
 * ⚠️ กติกาคือ "ไม่นับเฉพาะกรณีที่รู้แน่ว่าไม่ถูกคิดเงิน" ไม่ใช่ "นับเฉพาะที่
 * สำเร็จ" — not_found คือคำตอบจริงที่ปลายทางประมวลผลแล้ว ถือว่าถูกคิดเงิน
 * ส่วน network_error/timeout เราไม่รู้ว่าคำขอไปถึงหรือยัง จึงนับไว้ก่อน
 * นับเกินแล้วเราแค่ระวังเกินไป แต่นับขาดแล้วโควตาหมดโดยไม่รู้ตัว
 */
function countsAgainstQuota(error: unknown): boolean {
  // A0706 = ปลายทางปฏิเสธตั้งแต่ยังไม่ประมวลผล ไม่มีข้อมูลกลับมา ไม่คิดเงิน
  return !isRateLimited(error);
}

/** ป้ายผลลัพธ์ที่จะลง log — ใช้ code ของ CarrierError ถ้ามี */
function resultLabel(error: unknown): string {
  return error instanceof CarrierError ? error.code : "error";
}

/** ชนลิมิตหรือ quota หมด — ลองใหม่ได้หลายรอบด้วย exponential backoff */
function isRateLimited(error: unknown): boolean {
  return error instanceof CarrierError && error.code === "rate_limited";
}

/**
 * ปลายทางสะดุดชั่วคราว — ลองใหม่ได้อีกครั้งเดียว (ดู SYSTEM_RETRY_DELAY_MS)
 *
 * ยกเว้น timeout ทั้งที่ code เป็น network_error เหมือนกัน เพราะ timeout หนึ่งครั้ง
 * แปลว่าผู้ใช้รอไปแล้ว 20 วินาที การลองใหม่จะทำให้รอรวมเกิน 40 วินาที ซึ่งไม่มีใคร
 * รอ — คนกดปิดหน้าไปก่อนแน่นอน (ตัวยิงติดป้าย upstreamCode="timeout" มาให้)
 */
function isRetryableSystemError(error: unknown): boolean {
  if (!(error instanceof CarrierError)) return false;
  if (error.upstreamCode === TIMEOUT_UPSTREAM_CODE) return false;
  return RETRYABLE_SYSTEM_ERRORS.has(error.code);
}

/**
 * ยิง Track123 หนึ่งคำขอผ่านคิว พร้อมลองใหม่อัตโนมัติในสองกรณี
 *
 *   ชนลิมิต     ลองได้ตามความยาวของ backoffMs (หน่วงเพิ่มเป็นเท่าตัว)
 *   ระบบสะดุด   ลองได้อีกครั้งเดียว หน่วงสั้นๆ (ดู SYSTEM_RETRY_DELAY_MS)
 *
 * error อื่นถูกส่งต่อขึ้นไปทันทีโดยไม่ลองใหม่ — "ไม่พบเลขนี้" หรือ "สิทธิ์ไม่ผ่าน"
 * ยิงอีกกี่ครั้งก็ได้คำตอบเดิม มีแต่จะเปลือง quota
 *
 * ลองครบแล้วยังไม่ผ่าน จะโยน CarrierError ตัวสุดท้ายออกไปตามเดิม ให้ชั้นบน
 * ตัดสินใจว่าจะบอกผู้ใช้ยังไง
 */
export async function callTrack123<T>(
  meta: Track123CallMeta,
  request: () => Promise<T>,
  options: Track123CallOptions = {},
): Promise<T> {
  const queue = options.queue ?? track123Queue;
  const backoffMs = options.backoffMs ?? BACKOFF_DELAYS_MS;
  const log = options.log ?? ((line: string) => console.info(line));
  const breaker =
    options.breaker === undefined ? track123Breaker : options.breaker;

  const courier = meta.courierCode ?? "auto";
  const maxAttempts = backoffMs.length + 1;

  // วงจรถูกตัดอยู่ → ปฏิเสธทันทีโดยไม่ยิงและไม่เข้าคิว
  // ผู้ใช้จึงไม่ต้องรอ timeout ทีละคน และผู้เรียกข้ามไปเจ้าสำรองได้เลย
  if (breaker !== null && !breaker.allows()) {
    const remaining = breaker.snapshot().cooldownRemainingMs;
    log(
      formatCallLog({
        ts: Date.now(),
        trackNo: meta.trackNo,
        courier,
        attempt: 0,
        maxAttempts,
        queued: 0,
        waitMs: 0,
        tookMs: 0,
        result: "breaker_open",
      }),
    );
    throw breakerOpenError(remaining);
  }

  const countUsage =
    options.countUsage ?? (() => countProviderCall("track123"));

  // นับแยกกันเพราะเพดานคนละตัว: ชนลิมิตลองได้ตามความยาวของ backoffMs
  // ส่วนระบบสะดุดลองได้ SYSTEM_RETRY_LIMIT ครั้ง
  let rateLimitRetries = 0;
  let systemRetries = 0;

  for (let attempt = 1; ; attempt += 1) {
    /**
     * รอบนี้กินโควตาจริงไหม — รู้ได้ก็ต่อเมื่อเห็นผลแล้วเท่านั้น
     *
     * เดิมนับก่อนเข้าคิวทุกรอบ ซึ่งนับรวมรอบที่ถูก A0706 ปฏิเสธไปด้วย
     * (ดู countsAgainstQuota) การลองใหม่แต่ละรอบยังนับเป็นคนละครั้งเหมือนเดิม
     * เพราะมันคือ request จริงอีกหนึ่งครั้ง — เปลี่ยนแค่ว่ารอบไหน "นับ"
     */
    let billable = false;

    try {
      return await queue.run(async (call) => {
        const startedAt = Date.now();

        const write = (result: string, upstream?: string) => {
          log(
            formatCallLog({
              ts: startedAt,
              trackNo: meta.trackNo,
              courier,
              attempt,
              maxAttempts,
              queued: call.depth,
              waitMs: call.waitedMs,
              tookMs: Date.now() - startedAt,
              result,
              upstream,
            }),
          );
        };

        try {
          const value = await request();
          write("ok");
          breaker?.recordSuccess();
          // ได้ข้อมูลกลับมาจริง = ปลายทางคิดเงินแน่นอน
          billable = true;
          return value;
        } catch (error) {
          write(
            resultLabel(error),
            error instanceof CarrierError ? error.upstreamCode : undefined,
          );

          billable = countsAgainstQuota(error);

          // นับเฉพาะความล้มเหลวที่แปลว่าปลายทางมีปัญหา ไม่ใช่ทุก error
          if (
            error instanceof CarrierError &&
            BREAKER_FAILURES.has(error.code)
          ) {
            breaker?.recordFailure();
          } else {
            // ปลายทางตอบได้ตามปกติ (เช่น "ไม่พบเลขนี้") = ยังไม่ได้ล่ม
            breaker?.recordSuccess();
          }

          throw error;
        }
      });
    } catch (error) {
      // เพดานรวมของทุกชนิดการลองใหม่ กันไม่ให้การผสมสองแบบยืดยาวเกินที่ตั้งใจ
      if (attempt >= maxAttempts) throw error;


      // วงจรเพิ่งถูกตัดระหว่างที่เรากำลังลองอยู่ (คำขออื่นในโปรเซสเดียวกันพังจน
      // ครบเกณฑ์) → หยุดทันที การลองใหม่ตรงนี้จะเป็นการลอดด่าน breaker
      // ซึ่งทำให้ด่านที่ตั้งไว้ไม่มีความหมาย
      if (breaker !== null && !breaker.allows()) throw error;

      if (isRateLimited(error)) {
        // backoffMs[rateLimitRetries] คือระยะหน่วงก่อนการลองใหม่รอบถัดไป
        // undefined = ลองครบแล้ว ยอมแพ้
        const wait = backoffMs[rateLimitRetries];
        if (wait === undefined) throw error;

        rateLimitRetries += 1;
        await delay(wait);
        continue;
      }

      if (isRetryableSystemError(error) && systemRetries < SYSTEM_RETRY_LIMIT) {
        systemRetries += 1;
        await delay(SYSTEM_RETRY_DELAY_MS);
        continue;
      }

      // ที่เหลือคือคำตอบที่แท้จริง (ไม่พบ / เลขผิดรูป) หรือปัญหาที่ยิงอีกกี่ครั้ง
      // ก็เหมือนเดิม (สิทธิ์ / ตั้งค่า) — ส่งต่อขึ้นไปทันที
      throw error;
    } finally {
      // นับนอกคิว ไม่ใช่ในคิว — การรอฐานข้อมูลตอบไม่ควรไปกินช่องของคิวที่
      // จำกัดอัตราการยิงไว้ (เหตุผลเดิมของการนับก่อนเข้าคิว ยังใช้ได้อยู่)
      //
      // finally ทำงานทั้งตอน return และตอน throw จึงครอบทุกทางออกของรอบนี้
      if (billable) await countUsage();
    }
  }
}
