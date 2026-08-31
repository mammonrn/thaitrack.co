/**
 * เทสต์ฝั่งที่แปลงคำตอบของ /api/track ให้พร้อมแสดงผล
 *
 * เน้นเรื่องข้อมูลเก่า (stale) เป็นหลัก เพราะเป็นทางที่ผู้ใช้จะเจอในวันที่
 * ระบบขนส่งล่ม ซึ่งเป็นวันที่ first impression สำคัญที่สุด และเป็นทางที่
 * ทดสอบด้วยมือได้ยากที่สุดเพราะต้องรอให้ปลายทางล่มจริง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrackingResult } from "./carriers/types.ts";
import {
  ERROR_MESSAGE,
  STALE_NOTICE,
  formatStaleSince,
  readStaleSince,
  requestTracking,
  toShipmentFacts,
} from "./tracking-view.ts";

const RESULT: TrackingResult = {
  trackingNumber: "EY145587896TH",
  carrierName: "ไปรษณีย์ไทย",
  carrierCode: "thailand-post",
  status: "in_transit",
  statusText: "อยู่ระหว่างขนส่ง",
  lastUpdated: "2026-08-30T09:00:00+07:00",
  events: [],
};

/** fetch ปลอมที่ตอบ payload ที่กำหนด */
function fakeFetch(payload: unknown, ok = true): typeof fetch {
  return (() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(payload),
    } as Response)) as typeof fetch;
}

/* ------------------------ อ่านธงข้อมูลเก่า ------------------------ */

test("payload ปกติ (ข้อมูลสด) → staleSince เป็น null", () => {
  assert.equal(readStaleSince({ ok: true, data: RESULT, stale: false }), null);
  assert.equal(readStaleSince({ ok: true, data: RESULT }), null);
});

test("payload บอกว่าเป็นข้อมูลเก่า → คืนเวลาที่ดึงมา", () => {
  assert.equal(
    readStaleSince({
      ok: true,
      data: RESULT,
      stale: true,
      fetchedAt: "2026-08-28T14:20:00+07:00",
    }),
    "2026-08-28T14:20:00+07:00",
  );
});

test("บอกว่าเก่าแต่ไม่บอกเวลา → ยังต้องนับว่าเก่า (ป้ายต้องขึ้น)", () => {
  // ป้ายที่ไม่มีเวลายังดีกว่าไม่ขึ้นป้ายเลย เพราะผู้ใช้จะเข้าใจว่าเป็นข้อมูลสด
  assert.equal(readStaleSince({ ok: true, data: RESULT, stale: true }), "");
});

test("payload ที่อ่านไม่ออก → ไม่พังและไม่นับว่าเก่า", () => {
  assert.equal(readStaleSince(null), null);
  assert.equal(readStaleSince("ข้อความแปลกๆ"), null);
  assert.equal(readStaleSince({ stale: "true" }), null);
});

/* ------------------------ ถ้อยคำของป้าย ------------------------ */

test("จัดรูปเวลาเป็นข้อความไทยที่คนอ่านรู้เรื่อง", () => {
  const text = formatStaleSince("2026-08-28T14:20:00+07:00");

  assert.ok(text !== null);
  assert.ok(text.startsWith("ข้อมูล ณ "));
  assert.ok(text.endsWith(" น."));
});

test("ไม่มีเวลาหรือเวลาอ่านไม่ออก → คืน null ไม่โชว์ค่าดิบ", () => {
  assert.equal(formatStaleSince(null), null);
  assert.equal(formatStaleSince(""), null);
  assert.equal(formatStaleSince("ไม่ใช่เวลา"), null);
});

test("ป้ายข้อมูลเก่าต้องไม่อ้างว่ากำลังลองใหม่อยู่", () => {
  // พอผู้ใช้เห็นป้ายนี้ การลองใหม่อัตโนมัติจบไปแล้วและไม่สำเร็จ
  // ระบบไม่ได้กำลังทำอะไรอยู่จริง จะบอกว่ากำลังลองอยู่ไม่ได้
  const wording = `${STALE_NOTICE.title} ${STALE_NOTICE.detail}`;

  assert.doesNotMatch(wording, /กำลังลอง|กำลังอัปเดต|กำลังดึง/);
  assert.match(wording, /ข้อมูลล่าสุดที่เราเก็บไว้/);
});

test("ทุกข้อความที่ผู้ใช้เห็นต้องไม่มีรหัส error หรือศัพท์เทคนิคหลุดมา", () => {
  const texts = [
    ...Object.values(ERROR_MESSAGE).flatMap((error) => [error.title, error.detail]),
    STALE_NOTICE.title,
    STALE_NOTICE.detail,
  ];

  for (const text of texts) {
    assert.doesNotMatch(text, /A0706|Track123|supabase|HTTP|[45]\d\d\b/i, text);
  }
});

/* ------------------------ requestTracking ------------------------ */

test("ผลสด → ok พร้อม staleSince เป็น null", async () => {
  const outcome = await requestTracking(
    "EY145587896TH",
    fakeFetch({ ok: true, data: RESULT, source: "api", stale: false }),
  );

  assert.equal(outcome.ok, true);
  assert.ok(outcome.ok);
  assert.equal(outcome.staleSince, null);
  assert.equal(outcome.result.trackingNumber, RESULT.trackingNumber);
});

test("ผลเก่าเพราะขนส่งล่ม → ok (ไม่ใช่ error) พร้อมเวลาที่ดึงมา", async () => {
  const outcome = await requestTracking(
    "EY145587896TH",
    fakeFetch({
      ok: true,
      data: RESULT,
      source: "supabase",
      stale: true,
      fetchedAt: "2026-08-28T14:20:00+07:00",
    }),
  );

  // สำคัญ: ต้องเป็น ok ไม่ใช่ error — ผู้ใช้ต้องได้เห็นข้อมูล ไม่ใช่หน้าจอแดง
  assert.ok(outcome.ok);
  assert.equal(outcome.staleSince, "2026-08-28T14:20:00+07:00");
});

test("ไม่มีข้อมูลเก่าให้แสดง → ยังเป็น error ตามเดิม", async () => {
  const outcome = await requestTracking(
    "EY145587896TH",
    fakeFetch({ ok: false, error: { code: "rate_limited" } }, false),
  );

  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.error, ERROR_MESSAGE.rate_limited);
});

/* ------------------------------------------------------------------ *
 * รายละเอียดการจัดส่งบนการ์ดสถานะ (งาน D4)
 * ------------------------------------------------------------------ */

test("มีทั้งต้นทางและปลายทาง → รวมเป็นบรรทัดเส้นทางเดียว", () => {
  const facts = toShipmentFacts({
    originProvince: "นนทบุรี",
    destinationProvince: "พระนครศรีอยุธยา",
    deliveryStaffName: null,
    dueDate: null,
    cashOnDelivery: null,
  });

  assert.deepEqual(facts, [
    { label: "เส้นทาง", value: "นนทบุรี → พระนครศรีอยุธยา" },
  ]);
});

test("มีข้างเดียว → แสดงข้างที่มี ไม่เติมคำว่าไม่ระบุ", () => {
  const originOnly = toShipmentFacts({
    originProvince: "นนทบุรี",
    destinationProvince: null,
    deliveryStaffName: null,
    dueDate: null,
    cashOnDelivery: null,
  });
  assert.deepEqual(originOnly, [{ label: "ต้นทาง", value: "นนทบุรี" }]);

  const destinationOnly = toShipmentFacts({
    originProvince: null,
    destinationProvince: "เชียงราย",
    deliveryStaffName: null,
    dueDate: null,
    cashOnDelivery: null,
  });
  assert.deepEqual(destinationOnly, [{ label: "ปลายทาง", value: "เชียงราย" }]);
});

test("แสดงเฉพาะฟิลด์ที่มีค่าจริง", () => {
  const facts = toShipmentFacts({
    originProvince: null,
    destinationProvince: null,
    deliveryStaffName: "สมชาย ใจดี",
    dueDate: null,
    cashOnDelivery: "1250",
  });

  assert.deepEqual(facts, [
    { label: "เก็บเงินปลายทาง", value: "1250 บาท" },
    { label: "พนักงานนำจ่าย", value: "สมชาย ใจดี" },
  ]);
});

test("ไม่มีข้อมูลเลย → รายการว่าง แถบจะไม่ขึ้นบนการ์ด", () => {
  assert.deepEqual(toShipmentFacts(null), []);
  assert.deepEqual(toShipmentFacts(undefined), []);
  assert.deepEqual(
    toShipmentFacts({
      originProvince: null,
      destinationProvince: null,
      deliveryStaffName: null,
      dueDate: null,
      cashOnDelivery: null,
    }),
    [],
  );
});

test("กำหนดส่งถึงแสดงเป็นวันที่แบบไทย ไม่ใช่ค่าดิบ", () => {
  const facts = toShipmentFacts({
    originProvince: null,
    destinationProvince: null,
    deliveryStaffName: null,
    dueDate: "2021-02-10",
    cashOnDelivery: null,
  });

  assert.equal(facts.length, 1);
  assert.equal(facts[0].label, "กำหนดส่งถึง");
  assert.doesNotMatch(facts[0].value, /2021-02-10/, "ห้ามโชว์ค่าดิบ");
  assert.match(facts[0].value, /ก\.พ\./);
});

test("วันที่อ่านไม่ออก → ไม่แสดงบรรทัดนั้น แทนที่จะโชว์ค่าดิบ", () => {
  const facts = toShipmentFacts({
    originProvince: null,
    destinationProvince: null,
    deliveryStaffName: null,
    dueDate: "ไม่ใช่วันที่",
    cashOnDelivery: null,
  });

  assert.deepEqual(facts, []);
});

test("ข้อมูลเก่าใน cache ที่ยังไม่มีฟิลด์นี้ → ไม่พัง", () => {
  // ฟิลด์ shipment เพิ่มทีหลัง แถวเก่าใน tracking_cache จึงไม่มี
  const legacy = { ...RESULT } as TrackingResult;
  assert.deepEqual(toShipmentFacts(legacy.shipment), []);
});
