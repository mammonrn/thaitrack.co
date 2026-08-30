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

import { resolveTracking } from "./resolve.ts";
import {
  CarrierError,
  type CarrierAdapter,
  type TrackingResult,
} from "./types.ts";

/** นับเลขให้ไม่ซ้ำกัน เพราะ resolveTracking มี cache ที่ใช้ร่วมกันทั้งโปรเซส */
let counter = 0;
const uniqueTrackingNumber = () => `TESTNO${(counter += 1)}0000TH`;

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
  });

  assert.equal(result.carrierName, "Flash Express");
  assert.deepEqual(fallback.calls, ["auto-detect"]);
});

test("auto-detect ได้ NO_RECORD → ลองซ้ำด้วย shopee-xpress-th แล้วเจอ (ยิง 2 ครั้ง)", async () => {
  const fallback = makeTrack123({ succeedsForCourier: "shopee-xpress-th" });

  const { result } = await resolveTracking(uniqueTrackingNumber(), {
    primary: primaryAlwaysNotFound,
    fallback,
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
    resolveTracking(uniqueTrackingNumber(), { primary, fallback }),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      assert.equal(error.code, "auth_failed");
      return true;
    },
  );

  assert.deepEqual(fallback.calls, []);
});
