/**
 * เทสต์ cache ของคำตอบ "ไม่พบเลขนี้"
 *
 * รันด้วย `npm test`
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือ **จำนวนครั้งที่ยิงขนส่งจริง** เพราะทั้งหมดของ
 * cache ตัวนี้คือการลดตัวเลขนั้น ถ้าใครแก้แล้วมันกลับไปยิงทุกครั้งเหมือนเดิม
 * ระบบยังตอบถูกทุกอย่าง หน้าเว็บยังใช้งานได้ปกติ และไม่มีอะไรพังให้เห็นเลย
 * — จะรู้ตัวอีกทีตอนดูบิลปลายเดือน เทสต์จึงเป็นด่านเดียวที่จับได้
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clearCache } from "./cache.ts";
import {
  clearNotFoundCache,
  lookupNotFound,
  notFoundCacheSize,
  rememberNotFound,
  NOT_FOUND_TTL_MS,
} from "./not-found-cache.ts";
import { resolveTracking } from "./carriers/resolve.ts";
import type { PersistentTrackingCache } from "./supabase/tracking-cache.ts";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingResult,
} from "./carriers/types.ts";

/** ชั้นถาวรว่างเปล่า — เทสต์ต้องไม่แตะ Supabase จริงโดยไม่ตั้งใจ */
const noCache: PersistentTrackingCache = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
};

/** ตารางจำขนส่งว่างเปล่า — เหตุผลเดียวกับ noCache */
const noCourierStore = {
  read: () => Promise.resolve(null),
  remember: () => Promise.resolve(),
  forget: () => Promise.resolve(),
};

let counter = 0;
const uniqueTrackingNumber = () => `NFCACHE${(counter += 1)}0000TH`;

const notFound = () => new CarrierError("not_found", "ไม่พบข้อมูลเลขพัสดุนี้");

interface Counting extends CarrierAdapter {
  calls: number;
}

/** ขนส่งที่ตอบว่าไม่พบเสมอ พร้อมนับว่าถูกถามกี่ครั้ง */
function alwaysNotFound(carrierCode: string): Counting {
  const adapter = {
    carrierCode,
    carrierName: carrierCode,
    calls: 0,
    track() {
      adapter.calls += 1;
      return Promise.reject(notFound());
    },
  };
  return adapter;
}

/** ขนส่งที่เจอเสมอ พร้อมนับว่าถูกถามกี่ครั้ง */
function alwaysFound(carrierCode: string): Counting {
  const adapter = {
    carrierCode,
    carrierName: carrierCode,
    calls: 0,
    track(trackingNumber: string): Promise<TrackingResult> {
      adapter.calls += 1;
      return Promise.resolve({
        trackingNumber,
        carrierName: carrierCode,
        carrierCode: "mock",
        status: "delivered" as const,
        statusText: "ส่งถึงแล้ว",
        lastUpdated: "2026-09-05T10:00:00+07:00",
        events: [],
      });
    },
  };
  return adapter;
}

function reset(): void {
  clearNotFoundCache();
  clearCache();
}

/* ------------------------------------------------------------------ *
 * ตัวโมดูลเอง
 * ------------------------------------------------------------------ */

test("จำแล้วอ่านเจอทันที", () => {
  reset();
  rememberNotFound("ABC123", 1_000);
  assert.notEqual(lookupNotFound("ABC123", 1_000), null);
});

test("ยังไม่ถึง TTL → ยังอ่านเจอ · ถึง TTL พอดี → ไม่เจอแล้ว", () => {
  reset();
  rememberNotFound("ABC123", 1_000);

  assert.notEqual(
    lookupNotFound("ABC123", 1_000 + NOT_FOUND_TTL_MS - 1),
    null,
    "ก่อนหมดอายุหนึ่งมิลลิวินาที ต้องยังอ่านเจอ",
  );
  assert.equal(
    lookupNotFound("ABC123", 1_000 + NOT_FOUND_TTL_MS),
    null,
    "ครบ TTL พอดีต้องถือว่าหมดอายุแล้ว",
  );
});

test("ของหมดอายุถูกลบทิ้งตอนอ่านเจอ ไม่เก็บไว้เป็นคำตอบสำรอง", () => {
  reset();
  rememberNotFound("ABC123", 1_000);
  assert.equal(notFoundCacheSize(), 1);

  lookupNotFound("ABC123", 1_000 + NOT_FOUND_TTL_MS);
  assert.equal(notFoundCacheSize(), 0);
});

test("TTL คือ 10 นาที", () => {
  assert.equal(NOT_FOUND_TTL_MS, 10 * 60_000);
});

/* ------------------------------------------------------------------ *
 * ผ่าน resolveTracking ซึ่งเป็นทางเดียวที่โค้ดจริงใช้
 * ------------------------------------------------------------------ */

test("ค้นเลขที่ไม่เจอสองรอบติด → รอบที่สองไม่ยิงขนส่งเลยสักเจ้า", async () => {
  reset();
  const trackingNumber = uniqueTrackingNumber();
  const primary = alwaysNotFound("thailand-post");
  const fallback = alwaysNotFound("track123");

  const options = {
    primary,
    fallback,
    backup: null,
    persistentCache: noCache,
    courierStore: noCourierStore,
  };

  await assert.rejects(
    () => resolveTracking(trackingNumber, options),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "not_found",
  );

  const callsAfterFirst = primary.calls + fallback.calls;
  assert.ok(callsAfterFirst > 0, "รอบแรกต้องยิงจริง");

  await assert.rejects(
    () => resolveTracking(trackingNumber, options),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "not_found",
    "รอบที่สองต้องยังตอบว่าไม่พบเหมือนเดิม",
  );

  assert.equal(
    primary.calls + fallback.calls,
    callsAfterFirst,
    "รอบที่สองต้องไม่เพิ่มจำนวนการยิงแม้แต่ครั้งเดียว",
  );
});

test("cache หมดอายุแล้ว → ยิงใหม่ได้ปกติ", async () => {
  reset();
  const trackingNumber = uniqueTrackingNumber();
  const primary = alwaysNotFound("thailand-post");
  const fallback = alwaysNotFound("track123");

  // ปลูกคำตอบ "ไม่พบ" ที่หมดอายุไปแล้วหนึ่งมิลลิวินาที แทนการรอจริงสิบนาที
  rememberNotFound(trackingNumber, Date.now() - NOT_FOUND_TTL_MS - 1);

  await assert.rejects(
    () =>
      resolveTracking(trackingNumber, {
        primary,
        fallback,
        backup: null,
        persistentCache: noCache,
        courierStore: noCourierStore,
      }),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "not_found",
  );

  assert.ok(
    primary.calls + fallback.calls > 0,
    "ของหมดอายุแล้วต้องไม่ถูกใช้ ต้องกลับไปถามขนส่งใหม่",
  );
});

test("ผลที่ค้นเจอชนะคำตอบ 'ไม่พบ' ที่ค้างอยู่ใน cache", async () => {
  reset();
  const trackingNumber = uniqueTrackingNumber();

  // สถานการณ์จริง: ค้นไม่เจอตอน 10:00 แล้วพัสดุขึ้นระบบตอน 10:03 โดยมีคำขอ
  // อีกทางเขียนผลจริงลง cache ไว้ — คนที่ค้นตอน 10:05 ต้องเห็นผลจริง ไม่ใช่
  // "ไม่พบ" ที่ยังไม่หมดอายุ
  rememberNotFound(trackingNumber);

  const found = alwaysFound("track123");
  const first = await resolveTracking(trackingNumber, {
    primary: alwaysNotFound("thailand-post"),
    fallback: found,
    backup: null,
    persistentCache: noCache,
    courierStore: noCourierStore,
    // ข้าม cache รอบนี้เพื่อจำลอง "คำขอที่ยิงจริงจนได้ผลมา" แล้วเขียนลง cache
    skipCache: true,
  });
  assert.equal(first.result.trackingNumber, trackingNumber);

  const second = await resolveTracking(trackingNumber, {
    primary: alwaysNotFound("thailand-post"),
    fallback: alwaysNotFound("track123"),
    backup: null,
    persistentCache: noCache,
    courierStore: noCourierStore,
  });

  assert.equal(second.source, "memory", "ต้องตอบจาก cache ของผลที่เจอ");
  assert.equal(second.result.trackingNumber, trackingNumber);
});

test("skipCache ข้าม cache ของคำตอบ 'ไม่พบ' ด้วย ไม่ใช่ข้ามแค่ผลที่เจอ", async () => {
  reset();
  const trackingNumber = uniqueTrackingNumber();
  rememberNotFound(trackingNumber);

  const fallback = alwaysNotFound("track123");
  await assert.rejects(() =>
    resolveTracking(trackingNumber, {
      primary: alwaysNotFound("thailand-post"),
      fallback,
      backup: null,
      persistentCache: noCache,
      courierStore: noCourierStore,
      skipCache: true,
    }),
  );

  assert.ok(fallback.calls > 0, "skipCache ต้องบังคับให้ยิงจริง");
});

/* ------------------------------------------------------------------ *
 * ด่านกันเส้นทางที่สอง
 *
 * บทเรียนเดิมจาก saved-snapshot: ตรรกะที่ต้องมีที่เดียว ถ้าปล่อยให้ก๊อปไปวางที่
 * สองเมื่อไร สองที่นั้นจะค่อยๆ เพี้ยนออกจากกันโดยไม่มีใครสังเกต · ที่นี่คือ
 * "ปุ่มค้นหาสถานะล่าสุด" ในหน้าประวัติต้องได้ประโยชน์จาก cache ตัวเดียวกัน
 * ไม่ใช่มีทางอ่าน/เขียนของตัวเอง
 * ------------------------------------------------------------------ */

test("มีที่เดียวในโค้ดจริงที่อ่าน/เขียน cache ตัวนี้ คือ resolveTracking", () => {
  const callers = [
    "lib/carriers/resolve.ts",
    "app/api/track/route.ts",
    "app/api/saved/refresh/route.ts",
    "app/api/saved/route.ts",
  ];

  for (const path of callers) {
    const source = readFileSync(path, "utf8");
    const usesCache = /from "[^"]*not-found-cache"/.test(source);

    assert.equal(
      usesCache,
      path === "lib/carriers/resolve.ts",
      `${path} ${usesCache ? "ไม่ควร" : "ควร"} import lib/not-found-cache โดยตรง` +
        " — ทุกทางต้องผ่าน resolveTracking ทางเดียว",
    );
  }
});

test("ปุ่มค้นหาสถานะล่าสุดในหน้าประวัติวิ่งผ่าน resolveTracking โดยไม่ข้าม cache", () => {
  const source = readFileSync("app/api/saved/refresh/route.ts", "utf8");

  assert.match(
    source,
    /resolveTracking\(item\.trackingNumber\)/,
    "ต้องเรียก resolveTracking โดยไม่ส่ง option ใดๆ — ส่ง skipCache เมื่อไร" +
      " ปุ่มนี้จะกลายเป็นเส้นทางที่สองที่ไม่ได้ประโยชน์จาก cache ทั้งสองชนิด",
  );
});
