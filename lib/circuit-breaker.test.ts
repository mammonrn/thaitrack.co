/**
 * เทสต์ circuit breaker
 *
 * ทุกเทสต์ส่งเวลาเข้าไปเองแทนการใช้นาฬิกาจริง เพราะพฤติกรรมทั้งหมดของ breaker
 * คือฟังก์ชันของเวลา การรอจริงจะทำให้เทสต์ช้าและ flaky โดยไม่ได้พิสูจน์อะไรเพิ่ม
 *
 * ประเด็นที่ต้องไม่หลุด:
 *   1. นับเฉพาะความล้มเหลวที่ติดกันในหน้าต่างเวลา ไม่ใช่นับสะสมตลอดกาล
 *   2. ตอนพร้อมลองใหม่ ต้องปล่อยผ่านคำขอเดียว ไม่ใช่ทะลักออกไปพร้อมกันหมด
 *   3. ลองแล้วพังอีก ต้องพักใหม่ตั้งแต่ต้น ไม่ใช่ปล่อยผ่านรัวๆ ต่อ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CircuitBreaker } from "./circuit-breaker.ts";

const T0 = 1_756_531_200_000;

function makeBreaker(overrides: Partial<{ threshold: number }> = {}) {
  const lines: string[] = [];
  const breaker = new CircuitBreaker({
    name: "ทดสอบ",
    failureThreshold: overrides.threshold ?? 5,
    windowMs: 60_000,
    cooldownMs: 30_000,
    log: (line) => lines.push(line),
  });
  return { breaker, lines };
}

/* --------------------------- สถานะปกติ --------------------------- */

test("เริ่มต้นเป็น closed และปล่อยผ่านทุกคำขอ", () => {
  const { breaker } = makeBreaker();

  assert.equal(breaker.state(T0), "closed");
  for (let i = 0; i < 10; i += 1) assert.equal(breaker.allows(T0), true);
});

test("พังไม่ถึงเกณฑ์ → ยังปล่อยผ่านตามปกติ", () => {
  const { breaker } = makeBreaker();

  for (let i = 0; i < 4; i += 1) breaker.recordFailure(T0 + i * 100);

  assert.equal(breaker.state(T0 + 500), "closed");
  assert.equal(breaker.allows(T0 + 500), true);
});

test("สำเร็จหนึ่งครั้ง → ล้างประวัติความล้มเหลวทิ้ง", () => {
  const { breaker } = makeBreaker();

  for (let i = 0; i < 4; i += 1) breaker.recordFailure(T0 + i * 100);
  breaker.recordSuccess(T0 + 500);
  assert.equal(breaker.snapshot(T0 + 500).failures, 0);

  // พังอีก 4 ครั้งก็ยังไม่ถึงเกณฑ์ เพราะเริ่มนับใหม่แล้ว
  for (let i = 0; i < 4; i += 1) breaker.recordFailure(T0 + 600 + i * 100);
  assert.equal(breaker.state(T0 + 1_000), "closed");
});

/* ------------------------ พังจนต้องตัดวงจร ------------------------ */

test("พังครบเกณฑ์ในหน้าต่างเวลา → เปิดวงจร ปฏิเสธทันที", () => {
  const { breaker, lines } = makeBreaker();

  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);

  assert.equal(breaker.state(T0 + 500), "open");
  assert.equal(breaker.allows(T0 + 500), false);
  assert.ok(lines.some((line) => line.includes("action=open")));
});

test("พังกระจายเกินหน้าต่างเวลา → ไม่นับเป็นล่ม", () => {
  const { breaker } = makeBreaker();

  // 5 ครั้งแต่ห่างกันครั้งละ 20 วินาที ครั้งแรกๆ หลุดหน้าต่าง 60 วินาทีไปแล้ว
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 20_000);

  assert.equal(
    breaker.state(T0 + 80_000),
    "closed",
    "ปลายทางที่พังประปรายคือปลายทางที่ยังใช้ได้ ไม่ควรถูกตัด",
  );
});

test("ระหว่างพัก บอกได้ว่าเหลืออีกกี่ ms", () => {
  const { breaker } = makeBreaker();
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);

  assert.equal(breaker.snapshot(T0 + 400).cooldownRemainingMs, 30_000);
  assert.equal(breaker.snapshot(T0 + 10_400).cooldownRemainingMs, 20_000);
  assert.equal(breaker.snapshot(T0 + 40_000).cooldownRemainingMs, 0);
});

/* --------------------------- ลองแตะดู --------------------------- */

test("ครบเวลาพัก → ปล่อยผ่านคำขอเดียวเท่านั้น", () => {
  const { breaker } = makeBreaker();
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);

  const after = T0 + 400 + 30_000;
  assert.equal(breaker.state(after), "half_open");

  assert.equal(breaker.allows(after), true, "คำขอทดลองต้องผ่าน");
  assert.equal(
    breaker.allows(after),
    false,
    "คำขอที่เหลือต้องรอผลก่อน ไม่งั้นจะทะลักไปซ้ำเติมปลายทางที่เพิ่งฟื้น",
  );
  assert.equal(breaker.allows(after + 1_000), false);
});

test("ลองแล้วสำเร็จ → กลับมาปกติเต็มตัว", () => {
  const { breaker, lines } = makeBreaker();
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);

  const after = T0 + 400 + 30_000;
  breaker.allows(after);
  breaker.recordSuccess(after + 10);

  assert.equal(breaker.state(after + 20), "closed");
  assert.equal(breaker.allows(after + 20), true);
  assert.ok(lines.some((line) => line.includes("action=close")));
});

test("ลองแล้วพังอีก → พักใหม่ตั้งแต่ต้น ไม่ปล่อยผ่านต่อ", () => {
  const { breaker, lines } = makeBreaker();
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);

  const after = T0 + 400 + 30_000;
  breaker.allows(after);
  breaker.recordFailure(after + 10);

  assert.equal(breaker.state(after + 20), "open");
  assert.equal(breaker.allows(after + 20), false);
  assert.equal(breaker.snapshot(after + 20).cooldownRemainingMs, 29_990);
  assert.ok(lines.some((line) => line.includes("action=reopen")));

  // ต้องรออีกรอบเต็มๆ ถึงจะได้ลองใหม่
  assert.equal(breaker.state(after + 10 + 30_000), "half_open");
});

test("ฟื้นแล้วพังใหม่อีกรอบ → ตัดวงจรได้อีก", () => {
  const { breaker } = makeBreaker();

  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);
  const after = T0 + 400 + 30_000;
  breaker.allows(after);
  breaker.recordSuccess(after + 10);

  for (let i = 0; i < 5; i += 1) breaker.recordFailure(after + 100 + i * 100);
  assert.equal(breaker.state(after + 600), "open");
});

/* ---------------------------- ค่าตั้งต้น ---------------------------- */

test("ค่าตั้งต้นที่ไม่สมเหตุสมผล → ปฏิเสธตั้งแต่สร้าง", () => {
  const base = { name: "x", failureThreshold: 5, windowMs: 1_000, cooldownMs: 1_000 };

  assert.throws(() => new CircuitBreaker({ ...base, failureThreshold: 0 }), RangeError);
  assert.throws(() => new CircuitBreaker({ ...base, windowMs: 0 }), RangeError);
  assert.throws(() => new CircuitBreaker({ ...base, cooldownMs: -1 }), RangeError);
});

test("reset() คืนสู่สภาพเริ่มต้น", () => {
  const { breaker } = makeBreaker();
  for (let i = 0; i < 5; i += 1) breaker.recordFailure(T0 + i * 100);
  assert.equal(breaker.state(T0 + 500), "open");

  breaker.reset();
  assert.equal(breaker.state(T0 + 500), "closed");
  assert.equal(breaker.snapshot(T0 + 500).failures, 0);
});
