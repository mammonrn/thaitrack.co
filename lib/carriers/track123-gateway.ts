/**
 * ประตูทางออกเดียวของการยิง Track123 — คิว, ลองใหม่เมื่อชนลิมิต, และ log
 *
 * ทุก request ที่ออกไปหา Track123 ต้องผ่าน callTrack123() ที่นี่ที่เดียว จะได้
 * มั่นใจว่าไม่มีทางลัดไหนหลุดออกไปยิงโดยไม่ผ่านคิว และทุกครั้งที่ยิงมี log ครบ
 *
 * สามชั้นที่ซ้อนกันอยู่ (จากนอกเข้าใน):
 *   1. ลองใหม่แบบ exponential backoff — เจอ A0706 (ชนลิมิต) แล้วหน่วงก่อนลองใหม่
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
import { RateLimitQueue, delay } from "../rate-limit-queue";
import { CarrierError, type TrackingErrorCode } from "./types";

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
 */
const BREAKER_FAILURES: ReadonlySet<TrackingErrorCode> = new Set([
  "rate_limited",
  "network_error",
  "upstream_error",
  "auth_failed",
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

/** ป้ายผลลัพธ์ที่จะลง log — ใช้ code ของ CarrierError ถ้ามี */
function resultLabel(error: unknown): string {
  return error instanceof CarrierError ? error.code : "error";
}

/** ชนลิมิตหรือ quota หมด = กรณีเดียวที่ลองใหม่แล้วมีโอกาสได้ผลต่างเดิม */
function isRateLimited(error: unknown): boolean {
  return error instanceof CarrierError && error.code === "rate_limited";
}

/**
 * ยิง Track123 หนึ่งคำขอผ่านคิว พร้อมลองใหม่อัตโนมัติเมื่อชนลิมิต
 *
 * error ที่ไม่ใช่การชนลิมิตถูกส่งต่อขึ้นไปทันทีโดยไม่ลองใหม่ — "ไม่พบเลขนี้"
 * หรือ "สิทธิ์ไม่ผ่าน" ยิงอีกกี่ครั้งก็ได้คำตอบเดิม มีแต่จะเปลือง quota
 *
 * ถ้าลองครบแล้วยังชนลิมิตอยู่ จะโยน CarrierError ตัวสุดท้ายออกไปตามเดิม
 * ให้ชั้นบนตัดสินใจว่าจะบอกผู้ใช้ยังไง
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

  for (let attempt = 1; ; attempt += 1) {
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
          return value;
        } catch (error) {
          write(
            resultLabel(error),
            error instanceof CarrierError ? error.upstreamCode : undefined,
          );

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
      // backoffMs[attempt - 1] คือระยะหน่วงหลังความพยายามครั้งที่ attempt
      // undefined = ลองครบแล้ว ยอมแพ้
      const wait = backoffMs[attempt - 1];
      if (wait === undefined || !isRateLimited(error)) throw error;

      await delay(wait);
    }
  }
}
