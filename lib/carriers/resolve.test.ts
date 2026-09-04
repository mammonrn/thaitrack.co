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
import { normalizeCourierCode } from "./courier-code.ts";
import {
  chooseProviderOrder,
  isUnknownCourierFailure,
  resolveTracking,
} from "./resolve.ts";
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

test("ไปรษณีย์ไทยพัง → ข้ามไปเจ้าถัดไป ไม่ใช่จบทั้งคำขอ", async () => {
  // เจอของจริงมาแล้ว: วันที่ API key ของไปรษณีย์ไทยเพี้ยน ทั้งเว็บค้นอะไรไม่ได้
  // เลย ทั้งที่ Track123 ยังทำงานปกติดี — ผู้ใช้เจอ auth_failed ของเจ้าที่อาจ
  // ไม่ใช่ขนส่งของพัสดุเขาด้วยซ้ำ
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const resolved = await resolveTracking(uniqueTrackingNumber(), {
    primary: makeBrokenPrimary(new CarrierError("auth_failed", "สิทธิ์มีปัญหา")),
    fallback,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
  assert.equal(fallback.calls.length, 1);
});

test("ไปรษณีย์ไทยพังทุกแบบก็ข้ามหมด ไม่ใช่เฉพาะเรื่องสิทธิ์", async () => {
  for (const code of ["config_error", "rate_limited", "network_error", "upstream_error"] as const) {
    const fallback = makeTrack123({ autoDetectSucceeds: true });

    const resolved = await resolveTracking(uniqueTrackingNumber(), {
      primary: makeBrokenPrimary(new CarrierError(code, "พัง")),
      fallback,
      persistentCache: noCache,
    });

    assert.equal(resolved.provider, "fallback", code);
  }
});

test("ไปรษณีย์ไทยพัง แต่ Track123 ตอบว่าไม่พบ → ผู้ใช้ได้คำตอบจริง ไม่ใช่ error ของเจ้าที่พัง", async () => {
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: makeBrokenPrimary(new CarrierError("auth_failed", "สิทธิ์มีปัญหา")),
      fallback: makeTrack123(),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("พังทั้งคู่ → ส่ง error ของเจ้าที่ตามได้จริงขึ้นไป ไม่ใช่ของเจ้าแรก", async () => {
  // ชั้นบนใช้ code นี้ตัดสินเรื่องการคืนข้อมูลเก่าจาก cache — error ของ
  // ไปรษณีย์ไทยที่อาจไม่ใช่ขนส่งของพัสดุนี้เลย ไม่ควรเป็นตัวตัดสิน
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: makeBrokenPrimary(new CarrierError("auth_failed", "สิทธิ์มีปัญหา")),
      fallback: makeBrokenFallback(new CarrierError("rate_limited", "คิวหนาแน่น")),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "rate_limited");
      return true;
    },
  );
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
  // ไปรษณีย์ไทยพังแล้วระบบข้ามไปเจ้าถัดไป (ดูเทสต์เรื่องการข้าม) เจ้าถัดไปจึง
  // ต้องพังด้วย error จึงจะไหลขึ้นไปถึงผู้เรียกให้เทสต์นี้ตรวจได้
  const fallback = makeBrokenFallback(
    new CarrierError("rate_limited", "คิวค้นหาหนาแน่น"),
  );

  const first = resolveTracking(trackingNumber, {
    primary,
    fallback,
    persistentCache: noCache,
  });
  const second = resolveTracking(trackingNumber, {
    primary,
    fallback,
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
 * สองเจ้าที่เสียเงิน — สลับกันตามความถนัด ไม่ใช่เจ้าหลัก + เจ้าสำรอง
 *
 * เทสต์กลุ่มนี้เฝ้าสองอย่าง: ลำดับที่ถูกต้อง และ "ยิงกี่ครั้ง" ของแต่ละเจ้า
 * เพราะทั้งคู่มีเพดานต่อเดือน การยิงเกินความจำเป็นคือเงินที่เสียไปจริง
 * ------------------------------------------------------------------ */

/** เลขที่ prefix ฟันธงได้ว่าเป็น Shopee Xpress — ETrackings รองรับเจ้านี้ */
const uniquePrefixedNumber = () => `SPXTH${(counter += 1)}0460123`;

/** ETrackings ปลอม: ตามได้เฉพาะเลขที่ prefix ฟันธง เหมือนตัวจริง */
function makeBackup(result: "found" | CarrierError = "found"): CarrierAdapter & {
  calls: string[];
} {
  const calls: string[] = [];
  const answer = (trackingNumber: string) =>
    result === "found"
      ? Promise.resolve(makeResult(trackingNumber, "Shopee Xpress"))
      : Promise.reject(result);

  return {
    carrierCode: "etrackings",
    carrierName: "ETrackings",
    calls,
    // เหมือนตัวจริง: ตามได้เมื่อ prefix ฟันธง หรือมี courier ที่ยืนยันแล้ว
    // และเทียบรหัสแบบ normalize เหมือนกัน (shopee-xpress-th = shopeexpressth)
    canTrack: (trackingNumber, hint) =>
      trackingNumber.startsWith("SPXTH") ||
      normalizeCourierCode(hint) === "shopeexpressth",
    track(trackingNumber) {
      calls.push("auto");
      return answer(trackingNumber);
    },
    trackWithCourier(trackingNumber, courierCode) {
      calls.push(courierCode);
      return answer(trackingNumber);
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
    trackWithCourier(trackingNumber) {
      calls.push(trackingNumber);
      return Promise.reject(error);
    },
  };
}

/* ------------------------- ลำดับที่เลือกใช้ ------------------------- */

test("prefix ฟันธงได้ → ETrackings ก่อน แล้วไม่ต้องแตะ Track123 เลย", async () => {
  const backup = makeBackup();
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const resolved = await resolveTracking(uniquePrefixedNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "backup");
  assert.deepEqual(
    backup.calls,
    ["shopee-xpress-th"],
    "ต้องยิงโดยระบุขนส่งที่ prefix ฟันธงมา ไม่ใช่ปล่อยให้เดาเอง",
  );
  assert.deepEqual(fallback.calls, [], "ETrackings ตอบได้แล้วไม่ต้องถามซ้ำ");
});

test("prefix ฟันธงได้ → ข้ามไปรษณีย์ไทยไปเลย", async () => {
  const primary = makeWorkingPrimary();

  await resolveTracking(uniquePrefixedNumber(), {
    primary,
    fallback: makeTrack123(),
    backup: makeBackup(),
    persistentCache: noCache,
  });

  assert.deepEqual(primary.calls, []);
});

test("prefix เดาขนส่งไม่ออก → Track123 เจ้าเดียว ไม่แตะ ETrackings", async () => {
  // ETrackings บังคับให้ระบุขนส่ง เลขที่เดาไม่ออกจึงยิงไปก็เสียโควตาแน่นอน
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

test("ไปรษณีย์ไทยเจอตั้งแต่แรก → ไม่แตะเจ้าที่เสียเงินสักเจ้า", async () => {
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

/* ----------------------- เจ้าไหนพังก็สลับไปอีกเจ้า ----------------------- */

test("ETrackings พัง → สลับไป Track123 อัตโนมัติ", async () => {
  const backup = makeBackup(new CarrierError("upstream_error", "ETrackings ล่ม"));
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const resolved = await resolveTracking(uniquePrefixedNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
  assert.equal(backup.calls.length, 1, "ต้องได้ลอง ETrackings ก่อน");
});

test("Track123 พัง (prefix ฟันธงไม่ได้) → ส่ง error เดิมขึ้นไป ไม่มีใครมาช่วย", async () => {
  const backup = makeBackup();

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

  assert.deepEqual(
    backup.calls,
    [],
    "ETrackings ตามเลขนี้ไม่ได้อยู่แล้ว การยิงคือการทิ้งโควตาเปล่าๆ",
  );
});

test("circuit breaker ตัดวงจรของ ETrackings → ไปต่อที่ Track123 ทันที", async () => {
  const backup = makeBackup(
    new CarrierError("upstream_error", "ระบบขัดข้อง", {
      upstreamCode: "breaker_open",
    }),
  );

  const resolved = await resolveTracking(uniquePrefixedNumber(), {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ autoDetectSucceeds: true }),
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
});

test("ทั้งสองเจ้าพัง → ส่ง error ของ Track123 ขึ้นไป ไม่ใช่ของ ETrackings", async () => {
  // ชั้นบนใช้ code นี้ตัดสินใจเรื่องการคืนข้อมูลเก่าจาก cache
  // ถ้าถูกทับด้วย error ของอีกเจ้า การตัดสินใจนั้นจะผิด
  const backup = makeBackup(new CarrierError("auth_failed", "คีย์ผิด"));

  await assert.rejects(
    resolveTracking(uniquePrefixedNumber(), {
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

  assert.equal(backup.calls.length, 1, "ต้องได้ลองทั้งสองเจ้าก่อนยอมแพ้");
});

test("ไม่ได้ตั้งค่า ETrackings → ระบบทำงานต่อได้ด้วย Track123 เจ้าเดียว", async () => {
  const resolved = await resolveTracking(uniquePrefixedNumber(), {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ succeedsForCourier: "shopee-xpress-th" }),
    backup: null,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
});

/* ------ ป้ายบอกว่าล้มตอนเหลือผู้ให้บริการเจ้าเดียว (ไว้ทำสถิติ) ------ */

/*
 * เคสจริงที่ทำให้ต้องมีป้ายนี้: เลข TH54018X21H76P ไม่มี prefix ที่ฟันธงได้
 * (TH… ใช้ร่วมกันระหว่าง SPX กับ Flash จึงตั้งใจไม่ใส่ในตาราง prefix) และยัง
 * ไม่เคยค้นสำเร็จมาก่อนจึงไม่มีความจำเรื่องขนส่ง ETrackings เลยถูกตัดออกจาก
 * ลำดับตั้งแต่ต้น พอ Track123 ล้มก็จบทั้งคำขอทันที
 *
 * หน้าสถิติต้องนับเคสนี้ได้ เพราะมันคือตัวเลขเดียวที่บอกได้ว่าคุ้มจะลงทุนทำ
 * กลไกเดาขนส่งตอนจนตรอกไหม (โควตา ETrackings มีแค่ 50 ครั้ง/เดือน)
 */
test("ไม่รู้ขนส่ง + เจ้าเดียวที่เหลือล้ม → error ติดป้ายไว้ให้สถิตินับได้", async () => {
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeBrokenFallback(
        new CarrierError("upstream_error", "Track123 ล่ม"),
      ),
      backup: makeBackup(),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "upstream_error", "code เดิมต้องไม่ถูกกลืนหาย");
      assert.equal(isUnknownCourierFailure(error), true);
      return true;
    },
  );
});

test("รู้ขนส่งจาก prefix แต่ทั้งสองเจ้าล้ม → ไม่ติดป้าย เพราะได้ลองครบแล้ว", async () => {
  await assert.rejects(
    resolveTracking(uniquePrefixedNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeBrokenFallback(
        new CarrierError("upstream_error", "Track123 ล่ม"),
      ),
      backup: makeBackup(new CarrierError("network_error", "เน็ตล่ม")),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.equal(isUnknownCourierFailure(error), false);
      return true;
    },
  );
});

test("ยังไม่ได้ตั้งค่า ETrackings → ไม่ติดป้าย เพราะไม่ใช่ปัญหาการเดาขนส่ง", async () => {
  // ป้ายนี้ต้องหมายถึง "มีเจ้าที่สองอยู่แต่ใช้ไม่ได้" เท่านั้น ไม่งั้นตัวเลข
  // บนหน้าสถิติจะพองขึ้นด้วยเคสที่กลไกเดาขนส่งช่วยอะไรไม่ได้เลย
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeBrokenFallback(
        new CarrierError("upstream_error", "Track123 ล่ม"),
      ),
      backup: null,
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.equal(isUnknownCourierFailure(error), false);
      return true;
    },
  );
});

test("ค้นไม่เจอจริงๆ (ไม่ใช่ระบบล้ม) → ไม่ติดป้าย", async () => {
  await assert.rejects(
    resolveTracking(uniqueTrackingNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeTrack123(),
      backup: makeBackup(),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      assert.equal(isUnknownCourierFailure(error), false);
      return true;
    },
  );
});

test("ทั้งสองเจ้าพัง + มี cache เก่า → คืนข้อมูลเก่าตามกลไกเดิม", async () => {
  const trackingNumber = uniquePrefixedNumber();
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

/* --------------------- "ไม่พบ" ของใครหนักแน่นกว่ากัน --------------------- */

test('ETrackings ตอบ "ไม่พบ" → ยังไปต่อที่ Track123 เพราะยิงครั้งเดียวด้วยขนส่งที่เราเดาให้', async () => {
  const backup = makeBackup(new CarrierError("not_found", "ไม่พบเลขนี้"));
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const resolved = await resolveTracking(uniquePrefixedNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
    backup,
    persistentCache: noCache,
  });

  assert.equal(resolved.provider, "fallback");
});

test('Track123 ตอบ "ไม่พบ" → หยุดทันที ไม่ถาม ETrackings ต่อ', async () => {
  // Track123 ตรวจจับเองแล้วยังไล่ระบุเจาะจงซ้ำอีกหลายเจ้า คำว่าไม่พบของมัน
  // จึงหนักแน่นพอ การถามต่อมีแต่จะจ่ายโควตาให้คำตอบเดิม
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

  assert.deepEqual(backup.calls, []);
});

test("ทั้งสองเจ้าตอบว่าไม่พบ → not_found ไม่ใช่ error ของระบบ", async () => {
  await assert.rejects(
    resolveTracking(uniquePrefixedNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeTrack123(),
      backup: makeBackup(new CarrierError("not_found", "ไม่พบเลขนี้")),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

test("ETrackings พัง แต่ Track123 ตอบว่าไม่พบ → คำตอบคือไม่พบ ไม่ใช่ระบบขัดข้อง", async () => {
  // ถ้าส่ง error ของ ETrackings ขึ้นไป ชั้นบนจะเอาข้อมูลเก่าจาก cache มาบัง
  // ทั้งที่ความจริงคือพัสดุไม่อยู่ในระบบขนส่งแล้ว
  await assert.rejects(
    resolveTracking(uniquePrefixedNumber(), {
      primary: primaryAlwaysNotFound,
      fallback: makeTrack123(),
      backup: makeBackup(new CarrierError("auth_failed", "คีย์ผิด")),
      persistentCache: noCache,
    }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "not_found");
      return true;
    },
  );
});

/* ------------------- การตัดสินลำดับ (ฟังก์ชันบริสุทธิ์) ------------------- */

const ORDER_BASE = {
  backupUsable: true,
  fallbackNearQuota: false,
  backupNearQuota: false,
  backupOutOfLookupBudget: false,
};

test("ETrackings ใกล้หมดงบค้นหา แต่ Track123 ยังเหลือ → สลับไปถนอม ETrackings", () => {
  // เงื่อนไขนี้เคยเป็น dead logic: ธง backupNearQuota วัดจากเพดานเต็ม (40)
  // ส่วนการค้นหาถูกตัดขาดที่ 20 ธงจึงไม่มีทางติดก่อนถูกตัด — พอวัดจากงบ
  // ค้นหาแทน (ดู isNearLookupQuota) เส้นทางนี้ถึงจะถูกใช้จริงเป็นครั้งแรก
  assert.deepEqual(
    chooseProviderOrder({
      ...ORDER_BASE,
      backupNearQuota: true,
      fallbackNearQuota: false,
    }),
    ["fallback", "backup"],
    "ต้องยิง Track123 ก่อน เก็บ ETrackings ที่เหลือไว้ให้ branch-harvest",
  );
});

test("ตัวนับ Track123 ที่พองเกินจริง ต้องไม่ไปปิดการถนอม ETrackings", () => {
  // บั๊กจริงที่เจอ: ตัวนับ track123 ขึ้น 575/300 ทั้งที่ใช้จริง 277 ทำให้
  // fallbackNearQuota เป็น true ตลอด ซึ่งจะกลืนเงื่อนไขข้างบนทิ้ง
  // เทสต์นี้เฝ้าไว้ว่าถ้าธงทั้งคู่ติดพร้อมกัน จะไม่สลับ (ไม่มีประโยชน์)
  assert.deepEqual(
    chooseProviderOrder({
      ...ORDER_BASE,
      backupNearQuota: true,
      fallbackNearQuota: true,
    }),
    ["backup", "fallback"],
    "ทั้งคู่ใกล้เต็ม → ใช้ตามความถนัดเหมือนเดิม",
  );
});

test("ETrackings ตามเลขนี้ไม่ได้ → เหลือ Track123 เจ้าเดียว", () => {
  assert.deepEqual(
    chooseProviderOrder({ ...ORDER_BASE, backupUsable: false }),
    ["fallback"],
  );
});

test("รู้ courier แล้ว → ETrackings ก่อน", () => {
  assert.deepEqual(chooseProviderOrder(ORDER_BASE), ["backup", "fallback"]);
});

test("เจ้าที่ควรได้ไปก่อนใกล้ชนเพดาน → สลับไปอีกเจ้า", () => {
  assert.deepEqual(
    chooseProviderOrder({ ...ORDER_BASE, backupNearQuota: true }),
    ["fallback", "backup"],
  );

  assert.deepEqual(
    chooseProviderOrder({ ...ORDER_BASE, fallbackNearQuota: true }),
    ["backup", "fallback"],
    "Track123 ใกล้เต็มแต่ ETrackings ยังว่าง → ลำดับเดิมอยู่แล้ว",
  );
});

test("โควตาส่วนค้นหาของ ETrackings หมด → ตัดออกจากลำดับ ไม่ใช่แค่ไว้ทีหลัง", () => {
  // ที่เหลือถูกสงวนไว้ให้การเก็บที่อยู่สาขา (ดู canUseForLookup) การคงไว้เป็น
  // ตัวสำรองมีแต่ทำให้ผู้ใช้รออีกรอบก่อนได้คำตอบจากเจ้าที่ยังใช้ได้จริง
  assert.deepEqual(
    chooseProviderOrder({ ...ORDER_BASE, backupOutOfLookupBudget: true }),
    ["fallback"],
  );

  assert.deepEqual(
    chooseProviderOrder({
      ...ORDER_BASE,
      backupOutOfLookupBudget: true,
      fallbackNearQuota: true,
    }),
    ["fallback"],
    "ถึง Track123 จะใกล้เต็มก็ยังต้องตัด ETrackings ออกอยู่ดี",
  );
});

test("ทั้งคู่ใกล้ชนเพดาน → ไม่สลับ ใช้ตามความถนัดเหมือนเดิม", () => {
  // สลับไปหาเจ้าที่ใกล้ชนเพดานเหมือนกันไม่ได้ช่วยอะไร
  assert.deepEqual(
    chooseProviderOrder({
      ...ORDER_BASE,
      fallbackNearQuota: true,
      backupNearQuota: true,
    }),
    ["backup", "fallback"],
  );
});

test("ใกล้ชนเพดานไม่ใช่ห้ามใช้ — ยังอยู่ในลำดับที่สองเสมอ", () => {
  // ปฏิเสธคำค้นทั้งที่ยังมีโควตาเหลือ แย่กว่าการใช้โควตาที่เหลืออยู่
  const order = chooseProviderOrder({ ...ORDER_BASE, backupNearQuota: true });
  assert.ok(order.includes("backup"));
});

/* ------------- courier ที่ยืนยันแล้วจากการค้นครั้งก่อน ------------- */

/** ผลที่ cache ไว้จากการค้นสำเร็จครั้งก่อน พร้อมรหัสขนส่งที่ตรวจจับได้ */
function cachedAs(trackingNumber: string, carrierCode: string): CacheEntry {
  return {
    result: { ...makeResult(trackingNumber, "Shopee Xpress"), carrierCode },
    fetchedAt: Date.now() - 48 * 60 * 60_000,
    // หมดอายุแล้ว → ต้องยิงถามใหม่ ไม่ใช่ตอบจาก cache
    expiresAt: Date.now() - 46 * 60 * 60_000,
  };
}

test("เคยค้นเลขนี้สำเร็จแล้ว → ครั้งต่อไปใช้ ETrackings ได้ แม้ prefix จะบอกไม่ได้", async () => {
  // เลข SPX ในไทยส่วนใหญ่ขึ้นต้นด้วย TH ซึ่งใช้ร่วมกับ Flash จึงฟันธงจาก
  // prefix ไม่ได้ตลอดกาล — cache ที่จำ courier ไว้คือทางเดียวที่ทำให้
  // ETrackings ถูกใช้จริงกับเลขกลุ่มนี้
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  cache.rows.set(trackingNumber, cachedAs(trackingNumber, "shopee-xpress-th"));

  const backup = makeBackup();
  const fallback = makeTrack123({ autoDetectSucceeds: true });

  const resolved = await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback,
    backup,
    persistentCache: cache,
  });

  assert.equal(resolved.provider, "backup");
  assert.deepEqual(
    backup.calls,
    ["shopee-xpress-th"],
    "ต้องยิงโดยระบุขนส่งที่ยืนยันแล้ว ไม่ใช่ปล่อยให้เดาเอง",
  );
  assert.deepEqual(fallback.calls, []);
});

test("courier ที่จำไว้เป็นเจ้าที่ ETrackings ไม่รองรับ → ไม่แตะ ETrackings", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  cache.rows.set(trackingNumber, cachedAs(trackingNumber, "thailand-post"));

  const backup = makeBackup();

  const resolved = await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ autoDetectSucceeds: true }),
    backup,
    persistentCache: cache,
  });

  assert.equal(resolved.provider, "fallback");
  assert.deepEqual(backup.calls, [], "ยิงไปก็ได้ 400 กลับมา เสียโควตาเปล่า");
});

test("ยังไม่เคยค้นเลขนี้ → ไม่มีอะไรให้จำ ใช้ Track123 ตามเดิม", async () => {
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

test("prefix ยังชนะ courier ที่จำไว้ เมื่อทั้งคู่มี", async () => {
  const trackingNumber = uniquePrefixedNumber();
  const cache = makeFakeCache();
  cache.rows.set(trackingNumber, cachedAs(trackingNumber, "flash-express"));

  const backup = makeBackup();

  await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123(),
    backup,
    persistentCache: cache,
  });

  assert.deepEqual(
    backup.calls,
    ["shopee-xpress-th"],
    "prefix ที่ผ่านเกณฑ์ 'ฟันธงได้จริง' เชื่อถือได้กว่าผลตรวจจับครั้งก่อน",
  );
});

/* --------- ความจำว่าเลขไหนเป็นของขนส่งเจ้าไหน (ตารางถาวร) --------- */

/** ความจำปลอมที่เก็บใน Map — แทนตาราง tracking_couriers */
function makeCourierStore(seed: Record<string, string> = {}) {
  const rows = new Map(Object.entries(seed));
  const writes: string[] = [];

  return {
    rows,
    writes,
    read: (trackingNumber: string) =>
      Promise.resolve(rows.get(trackingNumber) ?? null),
    remember: (trackingNumber: string, courierCode: string, by: string) => {
      writes.push(`${trackingNumber}=${courierCode}@${by}`);
      rows.set(trackingNumber, courierCode);
      return Promise.resolve();
    },
  };
}

test("จำขนส่งไว้ในตารางถาวร → ใช้เป็น hint ได้แม้ cache จะว่างเปล่า", async () => {
  // นี่คือบั๊กที่เจอจริง: ลบแถวออกจาก tracking_cache แล้วค้นใหม่ ระบบไม่มี
  // ความจำเรื่องขนส่งเลย ทั้งที่ "เลขนี้เป็นของ SPX" ไม่มีวันเปลี่ยน
  const trackingNumber = uniqueTrackingNumber();
  const courierStore = makeCourierStore({
    [trackingNumber]: "shopeexpressth",
  });
  const backup = makeBackup();

  const resolved = await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ autoDetectSucceeds: true }),
    backup,
    persistentCache: noCache,
    courierStore,
  });

  assert.equal(resolved.provider, "backup");
  assert.deepEqual(
    backup.calls,
    ["shopeexpressth"],
    "รหัสที่ normalize แล้วต้องยังใช้เทียบได้",
  );
});

test("ค้นเจอ → จำไว้ว่าเลขนี้เป็นของขนส่งเจ้าไหน", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const courierStore = makeCourierStore();

  await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123({ autoDetectSucceeds: true }),
    backup: null,
    persistentCache: noCache,
    courierStore,
  });

  assert.deepEqual(courierStore.writes, [`${trackingNumber}=mock@fallback`]);
});

test("ตารางถาวรชนะ cache เมื่อทั้งคู่มีค่า", async () => {
  // cache หายได้เมื่อแถวถูกกวาด ตารางถาวรไม่หาย จึงเชื่อถือได้กว่า
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  cache.rows.set(trackingNumber, cachedAs(trackingNumber, "flashexpress"));

  const courierStore = makeCourierStore({
    [trackingNumber]: "shopeexpressth",
  });
  const backup = makeBackup();

  await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123(),
    backup,
    persistentCache: cache,
    courierStore,
  });

  assert.deepEqual(backup.calls, ["shopeexpressth"]);
});

test("ตารางถาวรว่าง → ตกไปใช้ courier ที่ cache จำไว้", async () => {
  const trackingNumber = uniqueTrackingNumber();
  const cache = makeFakeCache();
  cache.rows.set(trackingNumber, cachedAs(trackingNumber, "shopee-xpress-th"));

  const backup = makeBackup();

  await resolveTracking(trackingNumber, {
    primary: primaryAlwaysNotFound,
    fallback: makeTrack123(),
    backup,
    persistentCache: cache,
    courierStore: makeCourierStore(),
  });

  assert.deepEqual(backup.calls, ["shopee-xpress-th"]);
});
