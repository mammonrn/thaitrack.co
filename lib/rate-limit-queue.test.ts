/**
 * เทสต์คิวจำกัดอัตราการยิง
 *
 * ใช้ fake timer ของ node:test ทั้งหมด — เทสต์ที่ต้องรอเวลาจริงจะช้าและ flaky
 * บนเครื่อง CI ที่โหลดหนัก ทั้งที่สิ่งที่อยากรู้คือ "ระยะห่างระหว่างจุดเริ่มยิง"
 * ซึ่งวัดจากนาฬิกาปลอมได้แม่นกว่าเดิมด้วยซ้ำ
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { RateLimitQueue } from "./rate-limit-queue.ts";

/**
 * ปล่อยให้ promise ที่ค้างอยู่ทั้งหมดเดินจนสุด
 *
 * setImmediate ไม่ได้ถูกปลอม (เปิดปลอมแค่ setTimeout กับ Date) จึงใช้เป็นเส้นชัย
 * ที่รับประกันว่า microtask ทุกตัวที่ tick() ปลุกขึ้นมาได้ทำงานเสร็จแล้ว
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function useFakeClock(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
}

test("ยิงติดกันหลายครั้ง → จุดเริ่มยิงห่างกันอย่างน้อยตามระยะขั้นต่ำ", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);
  assert.equal(queue.minIntervalMs, 334);

  const startedAt: number[] = [];
  const runs = [1, 2, 3, 4].map(() =>
    queue.run(async () => {
      startedAt.push(Date.now());
    }),
  );

  await flush();
  assert.deepEqual(startedAt, [0], "ตัวแรกต้องได้ยิงทันที ไม่ต้องรอ");

  for (const expected of [334, 668, 1002]) {
    t.mock.timers.tick(334);
    await flush();
    assert.equal(startedAt.at(-1), expected);
  }

  await Promise.all(runs);
  assert.deepEqual(startedAt, [0, 334, 668, 1002]);
});

test("ในหน้าต่าง 1 วินาทีใดๆ ต้องมีจุดเริ่มยิงไม่เกินเพดานที่ตั้งไว้", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);
  const startedAt: number[] = [];

  // อัดเข้าไป 12 ตัวพร้อมกัน เลียนแบบตอนผู้ใช้หลายคนกดค้นหาพร้อมกัน
  const runs = Array.from({ length: 12 }, () =>
    queue.run(async () => {
      startedAt.push(Date.now());
    }),
  );

  await flush();
  for (let elapsed = 0; elapsed < 5_000; elapsed += 100) {
    t.mock.timers.tick(100);
    await flush();
  }
  await Promise.all(runs);

  assert.equal(startedAt.length, 12, "ต้องได้ยิงครบทุกตัว ไม่มีใครถูกทิ้ง");

  for (const start of startedAt) {
    const inSameSecond = startedAt.filter(
      (other) => other >= start && other < start + 1000,
    );
    assert.ok(
      inSameSecond.length <= 3,
      `มี ${inSameSecond.length} ครั้งในหน้าต่างที่เริ่มจาก ${start}ms ซึ่งเกินเพดาน 3`,
    );
  }
});

test("ลำดับที่เข้าคิวเป็นอย่างไร ลำดับที่ได้ยิงก็เป็นอย่างนั้น (FIFO)", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);
  const order: string[] = [];

  const runs = ["ก", "ข", "ค", "ง", "จ"].map((label) =>
    queue.run(async () => {
      order.push(label);
    }),
  );

  await flush();
  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(334);
    await flush();
  }
  await Promise.all(runs);

  assert.deepEqual(order, ["ก", "ข", "ค", "ง", "จ"]);
});

test("คิวว่างมานาน → ตัวถัดไปได้ยิงทันที ไม่ถูกหน่วงจากรอบก่อน", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);

  const first = await queue.run(async (call) => call.waitedMs);
  assert.equal(first, 0);

  // ปล่อยให้เวลาผ่านไปนานกว่าระยะขั้นต่ำมาก
  t.mock.timers.tick(10_000);

  const second = await queue.run(async (call) => call.waitedMs);
  assert.equal(second, 0);
});

test("บอกจำนวนที่อัดอยู่ในคิวและเวลาที่รอ ให้เอาไปลง log ได้", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);
  const seen: { depth: number; waitedMs: number }[] = [];

  const runs = [1, 2, 3].map(() =>
    queue.run(async (call) => {
      seen.push({ depth: call.depth, waitedMs: call.waitedMs });
    }),
  );

  assert.equal(queue.pending, 3, "ทั้งสามตัวต้องนับเป็นของที่ยังไม่จบ");

  await flush();
  t.mock.timers.tick(334);
  await flush();
  t.mock.timers.tick(334);
  await flush();
  await Promise.all(runs);

  assert.deepEqual(seen, [
    { depth: 1, waitedMs: 0 },
    { depth: 2, waitedMs: 334 },
    { depth: 3, waitedMs: 668 },
  ]);
  assert.equal(queue.pending, 0, "จบแล้วต้องไม่มีอะไรค้างในคิว");
});

test("task พัง → error ทะลุขึ้นไปตามเดิม และคิวไม่ค้าง", async (t) => {
  useFakeClock(t);

  const queue = new RateLimitQueue(3);
  const boom = new Error("พัง");

  await assert.rejects(
    queue.run(async () => {
      throw boom;
    }),
    boom,
  );

  assert.equal(queue.pending, 0);

  // คิวยังใช้งานต่อได้ตามปกติ
  t.mock.timers.tick(334);
  assert.equal(await queue.run(async () => "ต่อได้"), "ต่อได้");
});

test("เพดานต่อวินาทีที่ไม่สมเหตุสมผล → ปฏิเสธตั้งแต่สร้าง", () => {
  assert.throws(() => new RateLimitQueue(0), RangeError);
  assert.throws(() => new RateLimitQueue(-1), RangeError);
  assert.throws(() => new RateLimitQueue(Number.NaN), RangeError);
});
