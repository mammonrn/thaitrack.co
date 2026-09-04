/**
 * เทสต์กติกาการรีเฟรชสถานะหน้าประวัติ
 *
 * สองอย่างที่เฝ้าไว้ และทั้งคู่ล้มเหลวแบบเงียบๆ ได้:
 *
 *   1. **สถานะที่ยังเปลี่ยนได้ต้องถูกรีเฟรช** ถ้าหลุดไปอยู่ฝั่ง "จบแล้ว"
 *      ผู้ใช้จะเห็นสถานะค้างเหมือนเดิม ซึ่งคือบั๊กที่ทั้งเรื่องนี้ตั้งใจแก้
 *      และไม่มี error ที่ไหนขึ้นเลย
 *   2. **ต้องไม่ยิงพรวดเดียวทุกใบ** เพดาน 5 req/s ของ Track123 ไม่ได้พังทันที
 *      ตอนเทสต์ แต่จะไปโผล่เป็น A0706 ตอนผู้ใช้จริงมีพัสดุเยอะ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrackingStatus } from "./carriers/types.ts";
import {
  REFRESH_CONCURRENCY,
  TERMINAL_STATUSES,
  mapWithConcurrency,
  needsStatusRefresh,
  pickForRefresh,
} from "./saved-refresh.ts";

/* --------------------------- ใบไหนต้องรีเฟรช --------------------------- */

test("พัสดุที่ถึงมือผู้รับแล้ว → ไม่ต้องยิงถามซ้ำ", () => {
  assert.equal(needsStatusRefresh({ lastStatus: "delivered" }), false);
});

test("ทุกสถานะที่ยังเปลี่ยนได้ → ต้องรีเฟรช", () => {
  const movable: TrackingStatus[] = [
    "pending",
    "in_transit",
    "out_for_delivery",
    "exception",
  ];

  for (const status of movable) {
    assert.equal(needsStatusRefresh({ lastStatus: status }), true, status);
  }
});

test('"พัสดุมีปัญหา" ไม่ใช่สถานะจบ — ขนส่งมักกลับมาส่งใหม่วันถัดไป', () => {
  // เคสที่พลาดง่ายที่สุด: exception ดูเหมือนจุดจบเลยถูกเหมารวมกับ delivered
  // ผลคือผู้ใช้เห็น "พัสดุมีปัญหา" ค้างอยู่ทั้งที่ส่งสำเร็จไปตั้งแต่เช้า
  assert.equal(TERMINAL_STATUSES.has("exception"), false);
});

test("ยังไม่เคยมีสถานะ (บันทึกก่อนขนส่งรับเข้าระบบ) → ต้องรีเฟรช", () => {
  assert.equal(needsStatusRefresh({ lastStatus: null }), true);
});

test("คัดเฉพาะใบที่ต้องรีเฟรช โดยคงลำดับเดิมไว้", () => {
  const items = [
    { id: "a", lastStatus: "delivered" as TrackingStatus | null },
    { id: "b", lastStatus: "in_transit" as TrackingStatus | null },
    { id: "c", lastStatus: null },
    { id: "d", lastStatus: "delivered" as TrackingStatus | null },
    { id: "e", lastStatus: "exception" as TrackingStatus | null },
  ];

  assert.deepEqual(
    pickForRefresh(items).map((item) => item.id),
    ["b", "c", "e"],
  );
});

test("ทุกใบถึงปลายทางแล้ว → ไม่มีอะไรต้องยิงเลย", () => {
  const items = [
    { lastStatus: "delivered" as TrackingStatus | null },
    { lastStatus: "delivered" as TrackingStatus | null },
  ];

  assert.deepEqual(pickForRefresh(items), []);
});

/* ------------------------------ การหรี่ ------------------------------ */

test("ยิงพร้อมกันไม่เกินเพดาน และผลเรียงตามลำดับเดิม", async () => {
  const items = Array.from({ length: 19 }, (_, index) => index);

  let running = 0;
  let peak = 0;

  const results = await mapWithConcurrency(items, REFRESH_CONCURRENCY, async (n) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running -= 1;
    return n * 2;
  });

  assert.equal(peak <= REFRESH_CONCURRENCY, true, `พีคอยู่ที่ ${peak}`);
  assert.deepEqual(results, items.map((n) => n * 2));
});

test("ใบเดียวที่พังต้องไม่ทำให้ทั้งชุดล้ม", async () => {
  const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error("ขนส่งล่ม");
    return n;
  });

  assert.deepEqual(results, [1, null, 3]);
});

test("ไม่มีอะไรให้ทำ → คืนอาร์เรย์ว่าง ไม่ค้าง", async () => {
  assert.deepEqual(await mapWithConcurrency([], REFRESH_CONCURRENCY, async () => 1), []);
});

test("รายการสั้นกว่าเพดาน → ไม่สร้าง worker เกินจำเป็น", async () => {
  const results = await mapWithConcurrency([7], 10, async (n) => n);
  assert.deepEqual(results, [7]);
});
