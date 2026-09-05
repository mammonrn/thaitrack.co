/**
 * เทสต์เพดานเวลารวมต่อหนึ่งคำขอ
 *
 * รันด้วย `npm test`
 *
 * สองสิ่งที่เทสต์ชุดนี้เฝ้าไว้:
 *
 *   1. **ต้องตอบเสมอภายในเพดาน** ต่อให้ขนส่งไม่ยอมตอบเลย
 *   2. **ห้ามเรียกการหมดเวลาว่า "ไม่พบพัสดุ"** ข้อนี้อันตรายที่สุด เพราะจะทำให้
 *      เราเก็บคำตอบผิดลง cache สิบนาที แล้วบอกผู้ใช้ว่าพัสดุเขาไม่มีอยู่จริง
 *      ทั้งที่เราแค่รอไม่ไหวเอง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clearCache } from "./cache.ts";
import { clearNotFoundCache, lookupNotFound } from "./not-found-cache.ts";
import { Deadline, REQUEST_BUDGET_MS } from "./request-deadline.ts";
import { resolveTracking } from "./carriers/resolve.ts";
import type { PersistentTrackingCache } from "./supabase/tracking-cache.ts";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingResult,
} from "./carriers/types.ts";

const noCache: PersistentTrackingCache = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
};

const noCourierStore = {
  read: () => Promise.resolve(null),
  remember: () => Promise.resolve(),
  forget: () => Promise.resolve(),
};

let counter = 0;
const uniqueTrackingNumber = () => `DEADLINE${(counter += 1)}00TH`;

const notFound = () => new CarrierError("not_found", "ไม่พบข้อมูลเลขพัสดุนี้");

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** ขนส่งที่ไม่มีวันตอบ — จำลองปลายทางที่ค้าง */
const neverAnswers: CarrierAdapter = {
  carrierCode: "stuck",
  carrierName: "ปลายทางที่ค้าง",
  track: () => new Promise<TrackingResult>(() => {}),
};

/** ขนส่งที่ตอบว่าไม่พบ หลังใช้เวลาไปเท่าที่กำหนด */
function slowNotFound(ms: number): CarrierAdapter & { calls: number } {
  const adapter = {
    carrierCode: "slow",
    carrierName: "ช้า",
    calls: 0,
    async track(): Promise<TrackingResult> {
      adapter.calls += 1;
      await sleep(ms);
      throw notFound();
    },
    async trackWithCourier(): Promise<TrackingResult> {
      adapter.calls += 1;
      await sleep(ms);
      throw notFound();
    },
    retryCourierCodes: ["shopee-xpress-th", "flash-express", "kerry-th"],
  };
  return adapter;
}

function reset(): void {
  clearCache();
  clearNotFoundCache();
}

/* ---------------- ตัวนาฬิกาเอง ---------------- */

test("เพดานเริ่มต้นคือ 10 วินาที", () => {
  assert.equal(REQUEST_BUDGET_MS, 10_000);
  assert.equal(new Deadline().budgetMs, 10_000);
});

test("expired เป็นจริงเมื่อเวลาหมดพอดี ไม่ใช่หลังจากนั้น", () => {
  const deadline = new Deadline(1_000, 0);
  assert.equal(deadline.expired(999), false);
  assert.equal(deadline.expired(1_000), true);
  assert.equal(deadline.remaining(1_500), 0);
});

test("race คืนผลตามปกติเมื่องานเสร็จทัน", async () => {
  const deadline = new Deadline(1_000);
  assert.equal(await deadline.race(Promise.resolve("ok")), "ok");
});

test("race ตัดงานที่ไม่ยอมจบ แล้วโยน timeout", async () => {
  const deadline = new Deadline(50);
  await assert.rejects(
    () => deadline.race(new Promise(() => {})),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "timeout",
  );
});

test("งานที่ล้มหลังถูกตัดไปแล้ว ต้องไม่กลายเป็น unhandled rejection", async () => {
  const deadline = new Deadline(20);
  const late = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("มาช้าไปแล้ว")), 60);
  });

  await assert.rejects(() => deadline.race(late));
  // ถ้า race ไม่ผูก catch ไว้ให้ โปรเซสจะตายตรงนี้ใน Node รุ่นใหม่
  await sleep(120);
});

/* ---------------- ผ่าน resolveTracking ---------------- */

test("ขนส่งค้างไม่ยอมตอบ → ผู้ใช้ได้คำตอบภายในเพดาน ไม่ค้างตาม", async () => {
  reset();
  const startedAt = Date.now();

  await assert.rejects(
    () =>
      resolveTracking(uniqueTrackingNumber(), {
        primary: neverAnswers,
        fallback: neverAnswers,
        backup: null,
        persistentCache: noCache,
        courierStore: noCourierStore,
        deadline: new Deadline(200),
      }),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "timeout",
  );

  assert.ok(
    Date.now() - startedAt < 2_000,
    "ต้องหลุดออกมาที่เพดาน ไม่ใช่รอจนขนส่งยอมตอบ",
  );
});

test("หมดเวลา → ต้องไม่บอกว่า not_found และต้องไม่จำลง cache", async () => {
  reset();
  const trackingNumber = uniqueTrackingNumber();

  await assert.rejects(
    () =>
      resolveTracking(trackingNumber, {
        primary: neverAnswers,
        fallback: neverAnswers,
        backup: null,
        persistentCache: noCache,
        courierStore: noCourierStore,
        deadline: new Deadline(150),
      }),
    (error: unknown) =>
      error instanceof CarrierError &&
      error.code === "timeout" &&
      error.upstreamCode === "deadline_exceeded",
  );

  assert.equal(
    lookupNotFound(trackingNumber),
    null,
    "การหมดเวลาไม่ใช่คำตอบว่าไม่มีพัสดุนี้ ห้ามจำลง cache ของคำตอบ 'ไม่พบ'",
  );
});

test("เวลาหมดกลางทาง → หยุดยิงครั้งต่อไป ไม่ยิงต่อจนครบทุกเจ้า", async () => {
  reset();
  // แต่ละครั้งใช้ 120 ms เพดาน 200 ms → ยิงได้ราวสองครั้งแล้วต้องหยุด
  // ถ้าไม่มีด่านเวลา ขั้นยิงซ้ำจะไล่จนครบ 3 เจ้า = 4 ครั้งขึ้นไป
  const fallback = slowNotFound(120);

  await assert.rejects(() =>
    resolveTracking(uniqueTrackingNumber(), {
      primary: slowNotFound(120),
      fallback,
      backup: null,
      persistentCache: noCache,
      courierStore: noCourierStore,
      deadline: new Deadline(200),
    }),
  );

  assert.ok(
    fallback.calls < 4,
    `ต้องหยุดยิงเมื่อหมดเวลา แต่ยิงไป ${fallback.calls} ครั้ง`,
  );
});

test("เวลาเหลือเฟือ → ทำงานเหมือนเดิมทุกประการ ยังตอบ not_found ได้", async () => {
  reset();
  const fallback = slowNotFound(1);

  await assert.rejects(
    () =>
      resolveTracking(uniqueTrackingNumber(), {
        primary: slowNotFound(1),
        fallback,
        backup: null,
        persistentCache: noCache,
        courierStore: noCourierStore,
        deadline: new Deadline(5_000),
      }),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "not_found",
    "เวลาเหลือแล้วยังต้องสรุปว่าไม่พบได้ตามปกติ",
  );
});
