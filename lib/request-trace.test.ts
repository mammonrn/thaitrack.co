/**
 * เทสต์ตัวเก็บสถิติระดับคำขอ
 *
 * รันด้วย `npm test`
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้จริงๆ คือ **บริบทของ AsyncLocalStorage ไม่ขาด** ระหว่าง
 * ทางจากผู้เรียกลงไปถึงจุดที่ยิงจริง ถ้าขาดเมื่อไร ตัวเลขจะกลายเป็น 0 ทุกแถว
 * โดยไม่มีอะไรพัง ไม่มี error ไม่มีเทสต์ตัวอื่นแดง — จะรู้ตัวอีกทีตอนเปิดหน้า
 * สถิติแล้วพบว่าคอลัมน์ที่อุตส่าห์เพิ่มมาว่างเปล่าทั้งตาราง
 *
 * ที่ต้องยิงผ่าน gateway ตัวจริง (ไม่ใช่ adapter ปลอม) เพราะ **คิวคือจุดที่
 * บริบทมีสิทธิ์ขาดที่สุด** — งานถูกหน่วงด้วย setTimeout ก่อนได้ทำงานจริง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { RateLimitQueue } from "./rate-limit-queue.ts";
import {
  currentTrace,
  newTrace,
  recordAuthCall,
  recordUpstreamCall,
  withTrace,
} from "./request-trace.ts";
import { callTrack123 } from "./carriers/track123-gateway.ts";
import { CarrierError } from "./carriers/types.ts";

const gatewayOptions = (queue: RateLimitQueue) => ({
  queue,
  backoffMs: [] as readonly number[],
  log: () => {},
  countUsage: () => Promise.resolve(1),
  breaker: null,
});

test("นอกบริบทของคำขอ → ไม่ทำอะไรและไม่โยน error", () => {
  assert.equal(currentTrace(), null);
  assert.doesNotThrow(() => recordUpstreamCall({ queueMs: 5 }));
  assert.doesNotThrow(() => recordAuthCall(5));
});

test("นับสะสมภายในคำขอเดียว", async () => {
  const trace = newTrace();

  await withTrace(trace, async () => {
    recordUpstreamCall({ queueMs: 10 });
    recordUpstreamCall({ queueMs: 30 });
    recordAuthCall(120);
  });

  assert.deepEqual(trace, { upstreamCalls: 2, queueMs: 40, authMs: 120 });
});

test("สองคำขอที่ทำงานพร้อมกัน → ตัวเลขไม่ปนกัน", async () => {
  const a = newTrace();
  const b = newTrace();

  await Promise.all([
    withTrace(a, async () => {
      recordUpstreamCall();
      await new Promise((done) => setTimeout(done, 20));
      recordUpstreamCall();
    }),
    withTrace(b, async () => {
      await new Promise((done) => setTimeout(done, 5));
      recordUpstreamCall();
    }),
  ]);

  assert.equal(a.upstreamCalls, 2);
  assert.equal(b.upstreamCalls, 1);
});

test("บริบทไม่ขาดตอนถูกหน่วงในคิวจริงของ Track123", async () => {
  const trace = newTrace();
  // คิวที่ปล่อยได้วินาทีละครั้ง → คำขอที่สองต้องรอจริงราว 1 วินาที
  const queue = new RateLimitQueue(1);

  await withTrace(trace, async () => {
    await callTrack123(
      { trackNo: "SPXTH046012345678" },
      async () => "ok",
      gatewayOptions(queue),
    );
    await callTrack123(
      { trackNo: "SPXTH046012345678" },
      async () => "ok",
      gatewayOptions(queue),
    );
  });

  assert.equal(trace.upstreamCalls, 2, "ต้องนับครบทั้งสองครั้ง");
  assert.ok(
    trace.queueMs >= 900,
    `เวลารอคิวต้องถูกเก็บด้วย แต่ได้ ${trace.queueMs} ms`,
  );
});

test("การยิงที่ล้มก็ต้องถูกนับ — คำขอที่ล้มคือคำขอที่อยากรู้ที่สุด", async () => {
  const trace = newTrace();
  const queue = new RateLimitQueue(50);

  await withTrace(trace, async () => {
    await assert.rejects(() =>
      callTrack123(
        { trackNo: "SPXTH046012345678" },
        () => Promise.reject(new CarrierError("not_found", "ไม่พบ")),
        gatewayOptions(queue),
      ),
    );
  });

  assert.equal(trace.upstreamCalls, 1);
});

test("รอบที่ถูกปฏิเสธเพราะวงจรถูกตัด ต้องไม่ถูกนับเป็นการยิง", async () => {
  const trace = newTrace();
  const queue = new RateLimitQueue(50);

  await withTrace(trace, async () => {
    await assert.rejects(() =>
      callTrack123({ trackNo: "SPXTH046012345678" }, async () => "ok", {
        ...gatewayOptions(queue),
        // วงจรที่ปฏิเสธทุกอย่าง — ไม่มี request ออกจากเครื่องเลยสักตัว
        breaker: { allows: () => false, snapshot: () => ({ cooldownRemainingMs: 1_000 }) } as never,
      }),
    );
  });

  assert.equal(
    trace.upstreamCalls,
    0,
    "ไม่มี request ออกจากเครื่อง จึงต้องไม่นับ ไม่งั้นตัวเลขจะบวมโดยไม่มีใครรู้",
  );
});
