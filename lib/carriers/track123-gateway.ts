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

import { RateLimitQueue, delay } from "../rate-limit-queue";
import { CarrierError } from "./types";

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

  const courier = meta.courierCode ?? "auto";
  const maxAttempts = backoffMs.length + 1;

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
          return value;
        } catch (error) {
          write(
            resultLabel(error),
            error instanceof CarrierError ? error.upstreamCode : undefined,
          );
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
