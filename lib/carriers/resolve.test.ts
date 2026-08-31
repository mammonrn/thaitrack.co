/**
 * เทสต์ลำดับการถามขนส่งของ resolveTracking
 *
 * รันด้วย `npm test` (ใช้ test runner ในตัวของ Node ไม่ต้องลง dependency เพิ่ม)
 *
 * สิ่งที่เทสต์นี้เฝ้าไว้คือ "ยิง Track123 กี่ครั้ง" ในแต่ละสถานการณ์ เพราะทุกครั้ง
 * ที่ยิงคือ quota ที่เสียไปจริง การเพิ่มการลองซ้ำโดยไม่ระวังจะทำให้การค้นหาเลข
 * ที่ไม่มีอยู่จริงหนึ่งครั้งกิน quota หลายเท่าโดยไม่มีใครสังเกต
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clearCache, type CacheEntry } from "../cache.ts";
import type { PersistentTrackingCache } from "../supabase/tracking-cache.ts";
import { resolveTracking } from "./resolve.ts";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingResult,
} from "./types.ts";

/** นับเลขให้ไม่ซ้ำกัน เพราะ resolveTracking มี cache ที่ใช้ร่วมกันทั้งโปรเซส */
let counter = 0;
const uniqueTrackingNumber = () => `TESTNO${(counter += 1)}0000TH`;

/**
 * ชั้น cache ถาวรปลอม เก็บใน Map
 *
 * เทสต์ทุกตัวในไฟล์นี้ต้องส่งตัวนี้เข้าไป ไม่งั้นจะไปเรียกชั้นถาวรตัวจริงที่
 * ผูกกับ Supabase ซึ่งในเทสต์ไม่มีค่า env ให้ (ตอนนี้มันคืน null เงียบๆ อยู่
 * แต่พึ่งพฤติกรรมนั้นไม่ได้ — เทสต์ต้องไม่แตะบริการภายนอกโดยไม่ตั้งใจ)
 */
function makeFakeCache(): PersistentTrackingCache & { rows: Map<string, CacheEntry> } {
  const rows = new Map<string, CacheEntry>();
  return {
    rows,
    read: (trackingNumber) => Promise.resolve(rows.get(trackingNumber) ?? null),
    write: (trackingNumber, entry) => {
      rows.set(trackingNumber, entry);
      return Promise.resolve();
    },
  };
}

/** ชั้นถาวรว่างเปล่าที่ไม่จำอะไรเลย — ใช้กับเทสต์ที่ไม่ได้สนใจเรื่อง cache */
const noCache: PersistentTrackingCache = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
};

function makeResult(trackingNumber: string, carrierName: string): TrackingResult {
  return {
    trackingNumber,
    carrierName,
    carrierCode: "mock",
    status: "delivered",
    statusText: "ส่งถึงแล้ว",
    lastUpdated: "2026-08-30T10:00:00+07:00",
    events: [],
  };
}

const notFound = () =>
  new CarrierError("not_found", "ไม่พบข้อมูลเลขพัสดุนี้");

/** ไปรษณีย์ไทยที่ตอบว่าไม่พบเสมอ เพื่อบังคับให้ไหลไป Track123 ทุกครั้ง */
const primaryAlwaysNotFound: CarrierAdapter = {
  carrierCode: "thailand-post",
  carrierName: "ไปรษณีย์ไทย",
  track: () => Promise.reject(notFound()),
};

interface FakeTrack123Options {
  /** ให้ auto-detect สำเร็จเลยหรือไม่ */
  autoDetectSucceeds?: boolean;
  /** courierCode ที่ยิงแล้วจะเจอ — undefined คือไม่เจอเลยสักเจ้า */
  succeedsForCourier?: string;
  /** error ที่จะโยนตอนลองซ้ำ แทนที่จะเป็น "ไม่พบ" */
  retryError?: CarrierError;
  codes?: readonly string[];
}

interface FakeTrack123 extends CarrierAdapter {
  /** จำนวนครั้งที่ยิง API จริงทั้งหมด (auto-detect + ลองซ้ำ) */
  calls: string[];
}

function makeTrack123(options: FakeTrack123Options = {}): FakeTrack123 {
  const calls: string[] = [];

  return {
    carrierCode: "track123",
    carrierName: "Track123",
    calls,
    retryCourierCodes: options.codes ?? ["shopee-xpress-th"],

    track(trackingNumber) {
      calls.push("auto-detect");
      return options.autoDetectSucceeds === true
        ? Promise.resolve(makeResult(trackingNumber, "Flash Express"))
        : Promise.reject(notFound());
    },

    trackWithCourier(trackingNumber, courierCode) {
      calls.push(courierCode);
      if (options.retryError !== undefined) {
        return Promise.reject(options.retryError);
      }
      return courierCode === options.succeedsForCourier
        ? Promise.resolve(makeResult(trackingNumber, "Shopee Xpress"))
        : Promise.reject(notFound());
    },
  };
}

test("auto-detect เจอตั้งแต่ครั้งแรก → ไม่ลองซ้ำ ยิง Track123 ครั้งเดียว", async () => {
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const { result } = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    persistentCache: noCache,
  });

  assert.equal(result.carrierName, "Flash Express");
  assert.deepEqual(fallback.calls, ["auto-detect"]);
});

test("auto-detect ได้ NO_RECORD → ลองซ้ำด้วย shopee-xpress-th แล้วเจอ (ยิง 2 ครั้ง)", async () => {
  const fallback = makeTrack123({ succeedsForCourier: "shopee-xpress-th" });

  const { result } = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    persistentCache: noCache,
  });

  assert.equal(result.carrierName, "Shopee Xpress");
  assert.deepEqual(fallback.calls, ["auto-detect", "shopee-xpress-th"]);
});

test("ลองครบทุก courier code แล้วยังไม่เจอ → คืน not_found ไม่ค้าง", async () => {
  const fallback = makeTrack123({ codes: ["shopee-xpress-th", "kerry-th"] });

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );

  assert.deepEqual(fallback.calls, [
    "auto-detect",
    "shopee-xpress-th",
    "kerry-th",
  ]);
});

test("รายการยาวเกินเพดาน → ลองแค่ 3 เจ้า ยิง Track123 รวม 4 ครั้ง", async () => {
  const fallback = makeTrack123({
    codes: ["a-th", "b-th", "c-th", "d-th", "e-th"],
  });

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback,
      persistentCache: noCache,
    }),
  );

  assert.deepEqual(fallback.calls, ["auto-detect", "a-th", "b-th", "c-th"]);
  assert.equal(fallback.calls.length, 4);
});

test("ลองซ้ำแล้วเจอปัญหาสิทธิ์ → หยุดทันที ไม่ไล่เจ้าที่เหลือ", async () => {
  const fallback = makeTrack123({
    codes: ["shopee-xpress-th", "kerry-th", "jt-th"],
    retryError: new CarrierError("rate_limited", "ยิงถี่เกินไป"),
  });

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "rate_limited");
      return true;
    },
  );

  // ยิงแค่ auto-detect กับเจ้าแรกเท่านั้น ไม่เปลือง quota กับอีกสองเจ้า
  assert.deepEqual(fallback.calls, ["auto-detect", "shopee-xpress-th"]);
});

test("adapter ที่ไม่รองรับการระบุขนส่ง → ไม่ลองซ้ำเลย", async () => {
  const calls: string[] = [];
  const fallback: CarrierAdapter = {
    carrierCode: "track123",
    carrierName: "Track123",
    track: () => {
      calls.push("auto-detect");
      return Promise.reject(notFound());
    },
  };

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback,
      persistentCache: noCache,
    }),
  );

  assert.deepEqual(calls, ["auto-detect"]);
});

test("ไปรษณีย์ไทยพังด้วยสาเหตุอื่น → ไม่แตะ Track123 เลย", async () => {
  const fallback = makeTrack123({ autoDetectSucceeds: true });
  const primary: CarrierAdapter = {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    track: () => Promise.reject(new CarrierError("auth_failed", "สิทธิ์มีปัญหา")),
  };

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary,
      fallback,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "auth_failed");
      return true;
    },
  );

  assert.deepEqual(fallback.calls, []);
});

/* ------------------------------------------------------------------ *
 * เดาขนส่งจาก prefix ก่อน แทนที่จะเสีย call ให้การตรวจจับอัตโนมัติเดาผิด
 * ------------------------------------------------------------------ */

/** เลขทรง Shopee Xpress ที่ prefix บอกขนส่งได้แน่ๆ */
const uniqueShopeeNumber = () => `SPXTH${(counter += 1)}0000000`;

/** ไปรษณีย์ไทยที่ตอบว่าไม่พบเสมอ แต่นับด้วยว่าถูกถามกี่ครั้ง */
function makeCountingPrimary(): CarrierAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    calls,
    track(trackingNumber) {
      calls.push(trackingNumber);
      return Promise.reject(notFound());
    },
  };
}

test("เลขขึ้นต้น SPXTH → ข้ามไปรษณีย์ไทย ยิง shopee-xpress-th ตรงเลย (ยิงครั้งเดียว)", async () => {
  const primary = makeCountingPrimary();
  const fallback = makeTrack123({ succeedsForCourier: "shopee-xpress-th" });

  const { result } = await resolveTracking(uniqueShopeeNumber(), {
    primary,
    fallback,
    persistentCache: noCache,
  });

  assert.equal(result.carrierName, "Shopee Xpress");
  // เลขทรงนี้ไม่มีทางอยู่ในระบบไปรษณีย์ไทย การถามคือเสียเวลารอฟรีๆ
  assert.deepEqual(primary.calls, [], "ต้องไม่ถามไปรษณีย์ไทยเลย");
  // เดิมเคสนี้กิน 2 call (auto-detect เดาผิด แล้วค่อยลองซ้ำ) ตอนนี้เหลือ 1
  assert.deepEqual(fallback.calls, ["shopee-xpress-th"]);
});

test("prefix ไม่ฟันธง → คงพฤติกรรมเดิม ถามไปรษณีย์ไทยก่อนเสมอ", async () => {
  const primary = makeCountingPrimary();
  const fallback = makeTrack123({ succeedsForCourier: "shopee-xpress-th" });
  const trackingNumber = uniqueTrackingNumber();

  await resolveTracking(trackingNumber, {
    primary,
    fallback,
    persistentCache: noCache,
  });

  assert.deepEqual(primary.calls, [trackingNumber], "ต้องถามเจ้าที่ฟรีก่อน");
  assert.deepEqual(fallback.calls, ["auto-detect", "shopee-xpress-th"]);
});

test("prefix ฟันธงแต่ยิงแล้วไม่เจอ → ลอง auto-detect ต่อ ไม่ย้อนไปถามไปรษณีย์ไทย", async () => {
  const primary = makeCountingPrimary();
  const fallback = makeTrack123({ codes: ["shopee-xpress-th", "kerry-th"] });

  await assert.rejects(
    resolveTracking(uniqueShopeeNumber(), {
      primary,
      fallback,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );

  assert.deepEqual(primary.calls, []);
  // shopee-xpress-th ต้องโผล่ครั้งเดียว ไม่ถูกไล่ซ้ำในขั้นลองรายชื่อ
  assert.deepEqual(fallback.calls, [
    "shopee-xpress-th",
    "auto-detect",
    "kerry-th",
  ]);
});

test("prefix ฟันธง แต่ auto-detect เป็นฝ่ายเจอ → หยุดที่ 2 call", async () => {
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const { result } = await resolveTracking(uniqueShopeeNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    persistentCache: noCache,
  });

  assert.equal(result.carrierName, "Flash Express");
  assert.deepEqual(fallback.calls, ["shopee-xpress-th", "auto-detect"]);
});

test("prefix ฟันธง แต่ adapter ระบุขนส่งเจาะจงไม่ได้ → กลับไปใช้ลำดับเดิม", async () => {
  const primary = makeCountingPrimary();
  const calls: string[] = [];
  const fallback: CarrierAdapter = {
    carrierCode: "track123",
    carrierName: "Track123",
    track(trackingNumber) {
      calls.push("auto-detect");
      return Promise.resolve(makeResult(trackingNumber, "Flash Express"));
    },
  };
  const trackingNumber = uniqueShopeeNumber();

  await resolveTracking(trackingNumber, {
    primary,
    fallback,
    persistentCache: noCache,
  });

  // ใช้ทางลัดไม่ได้ ก็ต้องไม่ทิ้งเจ้าที่ฟรีไปเปล่าๆ
  assert.deepEqual(primary.calls, [trackingNumber]);
  assert.deepEqual(calls, ["auto-detect"]);
});

/* ------------------------------------------------------------------ *
 * รวมคำขอซ้ำที่กำลังรอผลอยู่ ไม่ให้ยิง API ซ้ำ
 * ------------------------------------------------------------------ */

/** promise ที่เราสั่งให้จบเองได้ ใช้ตรึงคำขอแรกไว้ระหว่างยิงคำขอที่สอง */
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

/** ไปรษณีย์ไทยที่ค้างอยู่จนกว่าจะสั่งให้จบ ไว้จำลองช่วงที่คำขอ "กำลังบิน" */
function makeSlowPrimary(gate: Promise<void>): CarrierAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    calls,
    async track(trackingNumber) {
      calls.push(trackingNumber);
      await gate;
      return makeResult(trackingNumber, "ไปรษณีย์ไทย");
    },
  };
}

/** Track123 ที่ต้องไม่ถูกแตะเลยในเทสต์ชุดนี้ */
const fallbackNeverUsed: CarrierAdapter = {
  carrierCode: "track123",
  carrierName: "Track123",
  track: () => {
    throw new Error("ไม่ควรถูกเรียก");
  },
};

test("เลขเดียวกันถูกค้นพร้อมกัน → ยิงจริงครั้งเดียว อีกคนเกาะผลเดียวกัน", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const gate = deferred<void>();
  const primary = makeSlowPrimary(gate.promise);

  // คำขอที่สองเข้ามาระหว่างที่คำขอแรกยังไม่ได้คำตอบ — cache ช่วยไม่ได้เพราะ
  // ผลยังไม่ถูกบันทึก ถ้าไม่มีการรวมคำขอ ตรงนี้จะยิง API สองครั้ง
  const first = resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: noCache,
  });
  const second = resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: noCache,
  });

  gate.resolve();
  const [a, b] = await Promise.all([first, second]);

  assert.deepEqual(primary.calls, [trackingNumber], "ต้องยิงแค่ครั้งเดียว");
  assert.equal(a.shared, false, "คนแรกเป็นคนเปิดคำขอ");
  assert.equal(b.shared, true, "คนที่สองไปเกาะคำขอเดิม");
  assert.equal(a.result, b.result, "ต้องเป็นผลก้อนเดียวกัน");
});

test("คนละเลขที่ค้นพร้อมกัน → ต่างคนต่างยิง ไม่ถูกจับรวมผิดคน", async () => {
  const gate = deferred<void>();
  const primary = makeSlowPrimary(gate.promise);
  const first = uniqueTrackingNumber();
  const second = uniqueTrackingNumber();

  const runs = Promise.all([
    resolveTracking(first, {
      primary,
      fallback: fallbackNeverUsed,
      persistentCache: noCache,
    }),
    resolveTracking(second, {
      primary,
      fallback: fallbackNeverUsed,
      persistentCache: noCache,
    }),
  ]);

  gate.resolve();
  const [a, b] = await runs;

  assert.deepEqual(primary.calls, [first, second]);
  assert.equal(a.result.trackingNumber, first);
  assert.equal(b.result.trackingNumber, second);
  assert.equal(a.shared, false);
  assert.equal(b.shared, false);
});

test("คำขอที่เกาะอยู่ได้ error ก้อนเดียวกัน ไม่ยิงซ้ำเพื่อไปเจอ error เดิม", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const gate = deferred<void>();
  const calls: string[] = [];

  const primary: CarrierAdapter = {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    async track(value) {
      calls.push(value);
      await gate.promise;
      throw new CarrierError("rate_limited", "คิวค้นหาหนาแน่น");
    },
  };

  const first = resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: noCache,
  });
  const second = resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: noCache,
  });

  gate.resolve();

  const [firstError, secondError] = await Promise.all([
    first.catch((error: unknown) => error),
    second.catch((error: unknown) => error),
  ]);

  assert.equal(calls.length, 1);
  assert.equal(firstError, secondError, "ต้องเป็น error ก้อนเดียวกัน");
  assert.ok(firstError instanceof CarrierError);
  assert.equal(firstError.code, "rate_limited");
});

test("คำขอแรกจบแล้ว → รอบถัดไปต้องได้ยิงใหม่ ไม่ค้างคำตอบเดิมไว้", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const gate = deferred<void>();
  const primary = makeSlowPrimary(gate.promise);

  gate.resolve();
  await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: noCache,
  });

  // skipCache เพื่อให้ผ่าน cache ไปถึงชั้นรวมคำขอจริงๆ
  const again = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    skipCache: true,
    persistentCache: noCache,
  });

  assert.equal(primary.calls.length, 2);
  assert.equal(again.shared, false);
});

/* ------------------------------------------------------------------ *
 * Cache สองชั้น และการยอมคืนข้อมูลเก่าเมื่อระบบขนส่งมีปัญหา
 * ------------------------------------------------------------------ */

/** ไปรษณีย์ไทยที่เจอตั้งแต่ครั้งแรก พร้อมนับจำนวนครั้งที่ถูกถาม */
function makeWorkingPrimary(): CarrierAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    calls,
    track(trackingNumber) {
      calls.push(trackingNumber);
      return Promise.resolve(makeResult(trackingNumber, "ไปรษณีย์ไทย"));
    },
  };
}

/** ไปรษณีย์ไทยที่พังด้วย error ที่กำหนดเอง */
function makeBrokenPrimary(error: CarrierError): CarrierAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    carrierCode: "thailand-post",
    carrierName: "ไปรษณีย์ไทย",
    calls,
    track(trackingNumber) {
      calls.push(trackingNumber);
      return Promise.reject(error);
    },
  };
}

test("ค้นครั้งแรกได้จาก api ครั้งที่สองได้จาก memory ไม่ยิงซ้ำ", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  const primary = makeWorkingPrimary();

  const first = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });
  const second = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  assert.equal(first.source, "api");
  assert.equal(first.stale, false);
  assert.equal(first.fetchedAt, null, "ของสดไม่ต้องบอกเวลาที่ดึงมา");

  assert.equal(second.source, "memory");
  assert.equal(second.stale, false);
  assert.ok(second.fetchedAt !== null, "ของจาก cache ต้องบอกได้ว่าดึงมาเมื่อไร");

  assert.deepEqual(primary.calls, [trackingNumber], "ต้องยิงจริงแค่ครั้งเดียว");
  assert.ok(cache.rows.has(trackingNumber), "ต้องถูกเขียนลงชั้นถาวรด้วย");
});

test("restart แล้วชั้น memory หาย → ยังได้คำตอบจากชั้นถาวร ไม่ต้องยิงใหม่", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  const primary = makeWorkingPrimary();

  await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  clearCache(); // จำลอง deploy / pm2 restart

  const afterRestart = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  assert.equal(afterRestart.source, "supabase");
  assert.equal(afterRestart.stale, false);
  assert.deepEqual(primary.calls, [trackingNumber], "ยังต้องยิงจริงแค่ครั้งเดียว");
});

test("cache หมดอายุ + ขนส่งล่ม → คืนข้อมูลเก่าพร้อมธง stale ไม่ใช่ error", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();

  // เก็บของไว้ก่อนด้วยเวลาที่หมดอายุไปแล้ว
  cache.rows.set(trackingNumber, {
    result: makeResult(trackingNumber, "ไปรษณีย์ไทย"),
    fetchedAt: Date.now() - 48 * 60 * 60_000,
    expiresAt: Date.now() - 46 * 60 * 60_000,
  });

  const primary = makeBrokenPrimary(
    new CarrierError("upstream_error", "ระบบขนส่งขัดข้อง"),
  );

  const resolved = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  assert.equal(resolved.stale, true);
  assert.equal(resolved.source, "supabase");
  assert.ok(resolved.fetchedAt !== null, "ต้องบอกได้ว่าเป็นข้อมูล ณ เวลาใด");
  assert.equal(resolved.result.trackingNumber, trackingNumber);
  assert.deepEqual(primary.calls, [trackingNumber], "ต้องพยายามยิงของสดก่อนเสมอ");
});

test("ชนลิมิตจนเอาไม่อยู่ + มีข้อมูลเก่า → คืนข้อมูลเก่า ไม่เด้ง error ใส่ผู้ใช้", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  const primary = makeWorkingPrimary();

  await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  // ทำให้ของใน cache ทั้งสองชั้นหมดอายุ แล้วให้ขนส่งชนลิมิต
  clearCache();
  const stored = cache.rows.get(trackingNumber);
  assert.ok(stored !== undefined);
  cache.rows.set(trackingNumber, { ...stored, expiresAt: Date.now() - 1 });

  const resolved = await resolveTracking(trackingNumber, {
    primary: makeBrokenPrimary(new CarrierError("rate_limited", "คิวหนาแน่น")),
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });

  assert.equal(resolved.stale, true);
  assert.equal(resolved.result.carrierName, "ไปรษณีย์ไทย");
});

test("ขนส่งล่มแต่ไม่เคยมีข้อมูลเก่าเลย → โยน error ตามเดิม ไม่กลืนเงียบ", async () => {
  const cache = makeFakeCache();

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: makeBrokenPrimary(
        new CarrierError("upstream_error", "ระบบขนส่งขัดข้อง"),
      ),
      fallback: fallbackNeverUsed,
      persistentCache: cache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "upstream_error");
      return true;
    },
  );
});

test('"ไม่พบเลขนี้" ต้องไม่ถูกข้อมูลเก่าบัง — เป็นคำตอบจริงที่ผู้ใช้ต้องเห็น', async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();

  cache.rows.set(trackingNumber, {
    result: makeResult(trackingNumber, "ไปรษณีย์ไทย"),
    fetchedAt: Date.now() - 48 * 60 * 60_000,
    expiresAt: Date.now() - 46 * 60 * 60_000,
  });

  // ถ้าเอาข้อมูลเก่ามาบัง not_found พัสดุที่หลุดออกจากระบบขนส่งไปแล้วจะดูเหมือน
  // ยังตามได้อยู่ตลอดกาล ซึ่งหลอกผู้ใช้ยิ่งกว่าการบอกตรงๆ ว่าไม่พบ
  await assert.rejects(
    resolveTracking(trackingNumber, {
      primary: primaryAlwaysNotFound,
      fallback: makeTrack123(),
      persistentCache: cache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("skipCache → ข้าม cache ทั้งสองชั้น ยิงสดเสมอ", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  const primary = makeWorkingPrimary();

  await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
  });
  const forced = await resolveTracking(trackingNumber, {
    primary,
    fallback: fallbackNeverUsed,
    persistentCache: cache,
    skipCache: true,
  });

  assert.equal(forced.source, "api");
  assert.equal(primary.calls.length, 2);
});

/* ------------------------------------------------------------------ *
 * ผู้ให้บริการสำรอง — ใช้เมื่อ Track123 พังด้วยเหตุระบบเท่านั้น
 * ------------------------------------------------------------------ */

/** เจ้าสำรองที่ตอบได้เสมอ พร้อมนับจำนวนครั้งที่ถูกเรียก */
function makeBackup(result: "found" | CarrierError = "found"): CarrierAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    carrierCode: "etrackings",
    carrierName: "ETrackings",
    calls,
    track(trackingNumber) {
      calls.push(trackingNumber);
      if (result !== "found") return Promise.reject(result);
      return Promise.resolve(makeResult(trackingNumber, "Kerry Express"));
    },
  };
}

/** Track123 ที่พังด้วย error ที่กำหนดเอง */
function makeBrokenFallback(error: CarrierError): CarrierAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    carrierCode: "track123",
    carrierName: "Track123",
    calls,
    track(trackingNumber) {
      calls.push(trackingNumber);
      return Promise.reject(error);
    },
  };
}

test("Track123 พังด้วยเหตุระบบ → ข้ามไปเจ้าสำรอง และบอกได้ว่าใช้เจ้าไหน", async () => {
  const backup = makeBackup();

  const resolved = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback: makeBrokenFallback(
      new CarrierError("upstream_error", "Track123 ล่ม"),
    ),
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "backup");
  assert.equal(resolved.result.carrierName, "Kerry Express");
  assert.equal(backup.calls.length, 1);
});

test("circuit breaker ตัดวงจร → ข้ามไปเจ้าสำรองทันที ไม่ต้องรอ timeout", async () => {
  const backup = makeBackup();

  const resolved = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback: makeBrokenFallback(
      new CarrierError("upstream_error", "ระบบขัดข้อง", {
        upstreamCode: "breaker_open",
      }),
    ),
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "backup");
});

test('Track123 ตอบว่า "ไม่พบ" → ห้ามแตะเจ้าสำรอง (โควตา 50 ครั้ง/เดือน)', async () => {
  const backup = makeBackup();

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeTrack123(),
      backup,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );

  assert.deepEqual(
    backup.calls,
    [],
    "ค้นไม่เจอเป็นคำตอบปกติ ถ้ายิงเจ้าสำรองทุกครั้งโควตาจะหมดในไม่กี่วัน",
  );
});

test("Track123 เจอตั้งแต่แรก → ไม่แตะเจ้าสำรอง", async () => {
  const backup = makeBackup();

  const resolved = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ autoDetectSucceeds: true }),
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
  assert.deepEqual(backup.calls, []);
});

test("ไปรษณีย์ไทยเจอตั้งแต่แรก → provider เป็น primary", async () => {
  const backup = makeBackup();
  const primary = makeWorkingPrimary();

  const resolved = await resolveTracking(uniqueTrackingNumber(), {
    primary,
    fallback: fallbackNeverUsed,
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "primary");
  assert.deepEqual(backup.calls, []);
});

test("ไม่มีเจ้าสำรอง + Track123 พัง → ทำงานเหมือนเดิม ส่ง error เดิมขึ้นไป", async () => {
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeBrokenFallback(
        new CarrierError("rate_limited", "คิวหนาแน่น"),
      ),
      backup: null,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "rate_limited");
      return true;
    },
  );
});

test("เจ้าสำรองก็พัง → ส่ง error ของ Track123 ขึ้นไป ไม่ใช่ของเจ้าสำรอง", async () => {
  // ชั้นบนใช้ code นี้ตัดสินใจเรื่องการคืนข้อมูลเก่าจาก cache
  // ถ้าถูกทับด้วย error ของเจ้าสำรอง การตัดสินใจนั้นจะผิด
  const backup = makeBackup(new CarrierError("auth_failed", "คีย์ผิด"));

  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeBrokenFallback(
        new CarrierError("rate_limited", "คิวหนาแน่น"),
      ),
      backup,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "rate_limited");
      return true;
    },
  );

  assert.equal(backup.calls.length, 1, "ต้องได้ลองเจ้าสำรองก่อนยอมแพ้");
});

test("Track123 พัง + เจ้าสำรองพัง + มี cache เก่า → คืนข้อมูลเก่าตามกลไกเดิม", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();

  cache.rows.set(trackingNumber, {
    result: makeResult(trackingNumber, "ไปรษณีย์ไทย"),
    fetchedAt: Date.now() - 48 * 60 * 60_000,
    expiresAt: Date.now() - 46 * 60 * 60_000,
  });

  const resolved = await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeBrokenFallback(
      new CarrierError("upstream_error", "Track123 ล่ม"),
    ),
    backup: makeBackup(new CarrierError("network_error", "เน็ตล่ม")),
    persistentCache: cache,
  });

  assert.equal(resolved.stale, true);
  assert.equal(resolved.provider, "cache");
  assert.equal(resolved.source, "supabase");
});
