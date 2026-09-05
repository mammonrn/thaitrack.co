/**
 * เก็บว่า "หนึ่งคำขอของผู้ใช้" ทำอะไรไปบ้าง — ไว้ตอบคำถามที่ log เดิมตอบไม่ได้
 *
 * ── ช่องว่างที่ปิด ────────────────────────────────────────────────────
 * ก่อนหน้านี้เรารู้แค่ว่าคำขอหนึ่งใช้เวลาเท่าไร (took_ms) แต่ไม่รู้ว่าเวลานั้น
 * หมดไปกับอะไร คำถามที่ตอบไม่ได้เลยมีสามข้อ:
 *
 *   1. คำขอนี้ยิงขนส่งไปกี่ครั้ง — เดาได้จาก log เท่านั้น และเดาผิดง่ายเพราะ
 *      log ของแต่ละเจ้าอยู่คนละบรรทัดและไม่มีอะไรผูกให้รู้ว่าเป็นคำขอเดียวกัน
 *   2. รอคิวไปกี่ ms — Track123 มีเลขนี้ในบรรทัด log ของตัวเอง (wait=) แต่ไม่มี
 *      ใครรวมให้ระดับคำขอ · ถ้าเวลาส่วนใหญ่หมดไปกับ "รอคิวของเราเอง" ทางแก้คือ
 *      เพิ่ม concurrency ซึ่งฟรี · ถ้าหมดไปกับการรอปลายทาง ทางแก้คือลดจำนวนครั้ง
 *      ที่ยิง ซึ่งแลกกับอัตราการค้นเจอ — สองทางนี้ตรงข้ามกัน เลือกผิดคือแย่ลง
 *   3. เสียเวลาไปกับการขอ token ใหม่ของไปรษณีย์ไทยเท่าไร — เป็นการยิงที่ซ่อนอยู่
 *      ไม่เคยโผล่ใน log ไหนเลย
 *
 * ── ทำไมใช้ AsyncLocalStorage ────────────────────────────────────────
 * ทางเลือกคือส่ง object นี้เป็นพารามิเตอร์ผ่านทุกชั้น: resolveTracking →
 * resolveFresh → runFallback → adapter → gateway → queue ซึ่งต้องแก้ลายเซ็น
 * ของฟังก์ชันสิบกว่าตัวที่ไม่ได้สนใจเรื่องนี้เลย และถ้าใครลืมส่งต่อสักชั้น
 * ตัวเลขจะหายไปเงียบๆ โดยไม่มีอะไรพัง — ซึ่งเป็นบั๊กที่จับไม่ได้เลย
 *
 * ALS ผูกกับ "การไหลของ async" ของคำขอนั้นโดยตรง ผ่าน await กี่ชั้นก็ไม่หลุด
 *
 * ⚠️ นอกบริบทของคำขอ (เช่นงานเบื้องหลัง หรือเทสต์ที่เรียก adapter ตรงๆ)
 * ทุกฟังก์ชัน record* จะไม่ทำอะไรเลยและไม่โยน error — เก็บสถิติไม่ได้ต้องไม่
 * ทำให้การค้นหาของผู้ใช้พัง (กติกาเดียวกับ lib/supabase/search-events.ts)
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestTrace {
  /** ยิงถามขนส่งจริงกี่ครั้ง — รวมทุกเจ้า ทุกการลองซ้ำ */
  upstreamCalls: number;
  /** รวมเวลาที่รออยู่ในคิวฝั่งเรา ก่อนได้ยิงจริง (ms) */
  queueMs: number;
  /** รวมเวลาที่หมดไปกับการขอ token ใหม่ (ms) — การยิงที่ผู้ใช้ไม่เคยเห็น */
  authMs: number;
}

const storage = new AsyncLocalStorage<RequestTrace>();

function emptyTrace(): RequestTrace {
  return { upstreamCalls: 0, queueMs: 0, authMs: 0 };
}

/**
 * รันงานในบริบทของ trace ใหม่ แล้วคืนทั้งผลและตัวเลขที่เก็บได้
 *
 * ต้องคืน trace ออกมาด้วยแม้ตอนงานล้ม เพราะคำขอที่ล้มคือคำขอที่เราอยากรู้ที่สุด
 * ว่ามันยิงไปกี่ครั้งก่อนจะยอมแพ้ — ผู้เรียกจึงอ่าน trace ได้จากตัวมันเองที่
 * ส่งเข้าไป ไม่ต้องพึ่งค่าที่คืนออกมา
 */
export function withTrace<T>(
  trace: RequestTrace,
  work: () => Promise<T>,
): Promise<T> {
  return storage.run(trace, work);
}

/** trace ของคำขอที่กำลังทำงานอยู่ — null เมื่อไม่ได้อยู่ในบริบทของคำขอ */
export function currentTrace(): RequestTrace | null {
  return storage.getStore() ?? null;
}

/** สร้าง trace เปล่าไว้ส่งให้ withTrace */
export function newTrace(): RequestTrace {
  return emptyTrace();
}

/**
 * บันทึกว่ามีการยิงถามขนส่งจริงหนึ่งครั้ง
 *
 * เรียกจากตัว adapter/gateway ที่เป็นทางออกจริงของแต่ละเจ้าเท่านั้น ไม่ใช่จาก
 * ชั้นที่จัดลำดับ — ไม่งั้นจะนับรอบที่ถูกข้าม (breaker เปิด, โควตาหมด) เป็นการ
 * ยิงด้วย ทั้งที่ไม่มี request ออกจากเครื่องเลย
 */
export function recordUpstreamCall(fields: { queueMs?: number } = {}): void {
  const trace = storage.getStore();
  if (trace === undefined) return;

  trace.upstreamCalls += 1;
  trace.queueMs += fields.queueMs ?? 0;
}

/** บันทึกเวลาที่หมดไปกับการขอ token ใหม่ */
export function recordAuthCall(tookMs: number): void {
  const trace = storage.getStore();
  if (trace === undefined) return;

  trace.authMs += tookMs;
}
