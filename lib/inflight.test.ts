/**
 * เทสต์การรวมคำขอซ้ำที่กำลังรอผลอยู่ให้ใช้ promise เดียวกัน
 *
 * สิ่งที่เทสต์นี้เฝ้าไว้คือ "factory ถูกเรียกกี่ครั้ง" เพราะหนึ่งครั้งคือหนึ่ง
 * request ที่ออกไปหา Track123 จริงและกิน quota จริง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { InflightMap } from "./inflight.ts";

/** promise ที่เราสั่งให้จบเองได้ ใช้ตรึงคำขอไว้ระหว่างที่ยิงคำขอที่สองเข้าไป */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("key เดียวกันที่กำลังรอผลอยู่ → เรียก factory ครั้งเดียว", async () => {
  const inflight = new InflightMap<string>();
  const gate = deferred<string>();
  let calls = 0;

  const factory = () => {
    calls += 1;
    return gate.promise;
  };

  const first = inflight.start("EY000000001TH", factory);
  const second = inflight.start("EY000000001TH", factory);

  assert.equal(calls, 1, "คำขอที่สองต้องไม่ยิงใหม่");
  assert.equal(first.joined, false, "คนแรกเป็นคนเปิดคำขอ");
  assert.equal(second.joined, true, "คนที่สองไปเกาะคำขอเดิม");
  assert.equal(inflight.size, 1);

  gate.resolve("ส่งถึงแล้ว");
  assert.deepEqual(await Promise.all([first.promise, second.promise]), [
    "ส่งถึงแล้ว",
    "ส่งถึงแล้ว",
  ]);
});

test("คนละ key → ต่างคนต่างยิง ไม่ไปปนกัน", async () => {
  const inflight = new InflightMap<string>();
  const seen: string[] = [];

  const results = await Promise.all([
    inflight.run("A", async () => {
      seen.push("A");
      return "ผลของ A";
    }),
    inflight.run("B", async () => {
      seen.push("B");
      return "ผลของ B";
    }),
  ]);

  assert.deepEqual(seen.sort(), ["A", "B"]);
  assert.deepEqual(results, ["ผลของ A", "ผลของ B"]);
});

test("คำขอจบแล้ว → รอบหน้าต้องได้ยิงใหม่ ไม่ค้างคำตอบเก่าไว้ตลอดกาล", async () => {
  const inflight = new InflightMap<number>();
  let calls = 0;
  const factory = async () => (calls += 1);

  assert.equal(await inflight.run("EY000000002TH", factory), 1);
  assert.equal(inflight.size, 0, "จบแล้วต้องถอนทะเบียนทิ้ง");

  assert.equal(await inflight.run("EY000000002TH", factory), 2);
  assert.equal(calls, 2);
});

test("คำขอที่ไปเกาะได้ error ก้อนเดียวกับคนแรก", async () => {
  const inflight = new InflightMap<string>();
  const gate = deferred<string>();
  const boom = new Error("ปลายทางล่ม");
  let calls = 0;

  const factory = () => {
    calls += 1;
    return gate.promise;
  };

  const first = inflight.start("EY000000003TH", factory);
  const second = inflight.start("EY000000003TH", factory);

  gate.reject(boom);

  await assert.rejects(first.promise, boom);
  await assert.rejects(second.promise, boom);
  assert.equal(calls, 1);
});

test("คำขอพัง → ถอนทะเบียนเหมือนกัน รอบหน้าต้องได้ลองใหม่", async () => {
  const inflight = new InflightMap<string>();
  let calls = 0;

  await assert.rejects(
    inflight.run("EY000000004TH", async () => {
      calls += 1;
      throw new Error("พังรอบแรก");
    }),
  );
  assert.equal(inflight.size, 0);

  assert.equal(
    await inflight.run("EY000000004TH", async () => {
      calls += 1;
      return "รอบสองผ่าน";
    }),
    "รอบสองผ่าน",
  );
  assert.equal(calls, 2);
});

test("factory โยน error แบบ synchronous → ไม่ทิ้งทะเบียนค้างไว้", async () => {
  const inflight = new InflightMap<string>();
  const boom = new Error("พังตั้งแต่ยังไม่ทันยิง");

  const run = inflight.start("EY000000005TH", () => {
    throw boom;
  });

  await assert.rejects(run.promise, boom);
  assert.equal(inflight.size, 0, "ถ้าค้าง เลขนี้จะค้นไม่ได้ไปตลอดอายุโปรเซส");

  assert.equal(
    await inflight.run("EY000000005TH", async () => "ยิงใหม่ได้"),
    "ยิงใหม่ได้",
  );
});
