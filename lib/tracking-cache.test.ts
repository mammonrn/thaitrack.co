/**
 * เทสต์ cache สองชั้น (memory + ถาวร)
 *
 * ใช้ชั้นถาวรปลอมที่เก็บใน Map แทน Supabase จริง เพราะสิ่งที่ต้องพิสูจน์คือ
 * "ลำดับการถามและการเขียนกลับ" ไม่ใช่ว่า supabase-js ทำงานถูกไหม
 *
 * ประเด็นที่ต้องไม่หลุด:
 *   1. ชั้น memory ต้องตอบก่อนเสมอเมื่อของยังสด — ไม่งั้นเสียเวลาถามข้ามเครือข่ายฟรีๆ
 *   2. ของหมดอายุต้องไม่ถูกทิ้ง แต่ต้องติดธง stale — เป็นของสำรองตอนขนส่งล่ม
 *   3. ชั้นถาวรพังต้องไม่ทำให้การค้นหาพัง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { TTL_MS, cacheSize, clearCache, getEntry, setEntry } from "./cache.ts";
import type { TrackingResult } from "./carriers/types.ts";
import type { CacheEntry } from "./cache.ts";
import type { PersistentTrackingCache } from "./supabase/tracking-cache.ts";
import { lookupTracking, rememberTracking } from "./tracking-cache.ts";

const NOW = Date.parse("2026-08-30T10:00:00+07:00");

function makeResult(
  trackingNumber: string,
  status: TrackingResult["status"] = "in_transit",
): TrackingResult {
  return {
    trackingNumber,
    carrierName: "Flash Express",
    carrierCode: "flash-express",
    status,
    statusText: "อยู่ระหว่างขนส่ง",
    lastUpdated: "2026-08-30T09:00:00+07:00",
    events: [],
  };
}

/** ชั้นถาวรปลอมที่เก็บใน Map พร้อมนับจำนวนครั้งที่ถูกอ่าน/เขียน */
function makeFakeCache(): PersistentTrackingCache & {
  rows: Map<string, CacheEntry>;
  reads: string[];
  writes: string[];
} {
  const rows = new Map<string, CacheEntry>();
  const reads: string[] = [];
  const writes: string[] = [];

  return {
    rows,
    reads,
    writes,
    async read(trackingNumber) {
      reads.push(trackingNumber);
      return rows.get(trackingNumber) ?? null;
    },
    async write(trackingNumber, entry) {
      writes.push(trackingNumber);
      rows.set(trackingNumber, entry);
    },
  };
}

/* ---------------------------- อ่าน ---------------------------- */

test("ของสดอยู่ในชั้น memory → ตอบจาก memory ไม่แตะชั้นถาวรเลย", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000001TH";

  await rememberTracking(no, makeResult(no), cache, NOW);
  cache.reads.length = 0;

  const hit = await lookupTracking(no, cache, NOW + 60_000);

  assert.ok(hit !== null);
  assert.equal(hit.source, "memory");
  assert.equal(hit.stale, false);
  assert.deepEqual(cache.reads, [], "ไม่ควรถามชั้นถาวรเมื่อ memory มีของสด");
});

test("memory ว่าง (เช่นเพิ่ง restart) แต่ชั้นถาวรมีของสด → ตอบจาก supabase", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000002TH";

  await rememberTracking(no, makeResult(no), cache, NOW);
  clearCache(); // จำลอง deploy/restart — ชั้น memory หายหมด

  const hit = await lookupTracking(no, cache, NOW + 60_000);

  assert.ok(hit !== null);
  assert.equal(hit.source, "supabase");
  assert.equal(hit.stale, false);
  assert.deepEqual(cache.reads, [no]);
});

test("ดึงของจากชั้นถาวรขึ้นมาแล้ว ต้องคงเวลาเดิมไว้ ไม่ใช่นับอายุใหม่", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000003TH";

  await rememberTracking(no, makeResult(no), cache, NOW);
  clearCache();

  await lookupTracking(no, cache, NOW + 60_000);

  const promoted = getEntry(no);
  assert.ok(promoted !== undefined, "ต้องถูกดึงขึ้นมาไว้ในชั้น memory ด้วย");
  assert.equal(promoted.fetchedAt, NOW);
  assert.equal(promoted.expiresAt, NOW + TTL_MS.in_transit);

  // ครั้งถัดไปต้องได้จาก memory แล้ว ไม่ต้องถามชั้นถาวรซ้ำ
  cache.reads.length = 0;
  const again = await lookupTracking(no, cache, NOW + 120_000);
  assert.equal(again?.source, "memory");
  assert.deepEqual(cache.reads, []);
});

test("ไม่เคยเก็บเลขนี้ไว้เลย → คืน null ทั้งสองชั้น", async () => {
  clearCache();
  const cache = makeFakeCache();

  assert.equal(await lookupTracking("EY000000004TH", cache, NOW), null);
});

/* -------------------------- หมดอายุ -------------------------- */

test("หมดอายุแล้ว → ยังคืนของเดิมแต่ติดธง stale ไม่ใช่ทิ้ง", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000005TH";

  await rememberTracking(no, makeResult(no), cache, NOW);

  const justBefore = await lookupTracking(no, cache, NOW + TTL_MS.in_transit - 1);
  assert.equal(justBefore?.stale, false, "ก่อนหมดอายุ 1ms ยังต้องนับว่าสด");

  const justAfter = await lookupTracking(no, cache, NOW + TTL_MS.in_transit);
  assert.ok(justAfter !== null, "ของหมดอายุห้ามหาย — เป็นของสำรองตอนขนส่งล่ม");
  assert.equal(justAfter.stale, true);
  assert.equal(justAfter.entry.fetchedAt, NOW);
});

test("TTL ต่างกันตามสถานะ — ส่งถึงแล้วอยู่ได้นานกว่ากำลังนำจ่ายมาก", async () => {
  clearCache();
  const cache = makeFakeCache();

  await rememberTracking("EY000000006TH", makeResult("EY000000006TH", "delivered"), cache, NOW);
  await rememberTracking("EY000000007TH", makeResult("EY000000007TH", "out_for_delivery"), cache, NOW);

  const afterOneDay = NOW + 24 * 60 * 60_000;
  assert.equal(
    (await lookupTracking("EY000000006TH", cache, afterOneDay))?.stale,
    false,
    "พัสดุที่ส่งถึงแล้วไม่มีทางเปลี่ยนอีก ต้องยังสดหลังผ่านไปหนึ่งวัน",
  );
  assert.equal(
    (await lookupTracking("EY000000007TH", cache, NOW + 16 * 60_000))?.stale,
    true,
    "พัสดุที่กำลังนำจ่ายต้องหมดอายุเร็ว",
  );
});

test("ทั้งสองชั้นหมดอายุ → เลือกก้อนที่ดึงมาใหม่กว่า", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000008TH";

  // ชั้นถาวรเก่ากว่า (instance อื่นเขียนไว้นานแล้ว)
  const old: CacheEntry = {
    result: makeResult(no),
    fetchedAt: NOW - 10 * 60 * 60_000,
    expiresAt: NOW - 8 * 60 * 60_000,
  };
  await cache.write(no, old);

  // ชั้น memory ใหม่กว่าแต่ก็หมดอายุแล้วเหมือนกัน
  const newer: CacheEntry = {
    result: makeResult(no),
    fetchedAt: NOW - 3 * 60 * 60_000,
    expiresAt: NOW - 60 * 60_000,
  };
  setEntry(no, newer);

  const hit = await lookupTracking(no, cache, NOW);

  assert.equal(hit?.stale, true);
  assert.equal(hit?.entry.fetchedAt, newer.fetchedAt);
  assert.equal(hit?.source, "memory");
});

test("memory หมดอายุแต่ชั้นถาวรมีของสด (instance อื่นเพิ่งรีเฟรช) → ใช้ของสด", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000009TH";

  setEntry(no, {
    result: makeResult(no),
    fetchedAt: NOW - 5 * 60 * 60_000,
    expiresAt: NOW - 3 * 60 * 60_000,
  });
  await cache.write(no, {
    result: makeResult(no),
    fetchedAt: NOW - 60_000,
    expiresAt: NOW + 60 * 60_000,
  });

  const hit = await lookupTracking(no, cache, NOW);

  assert.equal(hit?.source, "supabase");
  assert.equal(hit?.stale, false);
});

/* --------------------------- เขียน --------------------------- */

test("บันทึกผลสด → เขียนกลับทั้งสองชั้น", async () => {
  clearCache();
  const cache = makeFakeCache();
  const no = "EY000000010TH";

  const entry = await rememberTracking(no, makeResult(no), cache, NOW);

  assert.equal(getEntry(no)?.fetchedAt, NOW, "ชั้น memory ต้องมี");
  assert.deepEqual(cache.writes, [no], "ชั้นถาวรต้องถูกเขียนหนึ่งครั้ง");
  assert.equal(cache.rows.get(no)?.expiresAt, entry.expiresAt, "อายุต้องตรงกันทั้งสองชั้น");
});

test("ชั้นถาวรอ่านไม่ได้ → ยังใช้ชั้น memory ต่อได้ ไม่โยน error ขึ้นไป", async () => {
  clearCache();
  const no = "EY000000011TH";
  const broken: PersistentTrackingCache = {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  };

  await rememberTracking(no, makeResult(no), broken, NOW);

  const hit = await lookupTracking(no, broken, NOW + 60_000);
  assert.equal(hit?.source, "memory");
  assert.equal(hit?.stale, false);
});

test("เพดานจำนวนรายการในชั้น memory ยังทำงาน ไม่โตไม่จำกัด", async () => {
  clearCache();
  const cache = makeFakeCache();

  for (let index = 0; index < 5_050; index += 1) {
    await rememberTracking(`EY${index}TH`, makeResult(`EY${index}TH`), cache, NOW);
  }

  assert.equal(cacheSize(), 5_000);
  clearCache();
});
