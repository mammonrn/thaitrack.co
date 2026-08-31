/**
 * เทสต์สิทธิ์ดูรูปถ่ายตอนนำจ่าย
 *
 * รูปนี้มักติดใบปะหน้าที่มีที่อยู่เต็มของผู้รับ ทุกทางที่ข้อมูลไม่ครบต้องตอบว่า
 * "ไม่มีสิทธิ์" — เทสต์ชุดนี้ไล่ทุกทางที่ตอบผิดแล้วจะกลายเป็นการเปิดรูปบ้าน
 * คนอื่นให้คนแปลกหน้าดู
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { canRevealProof } from "./proof-access.ts";

const DELIVERED_AT = "2026-08-30T14:00:00+07:00";
const BEFORE = "2026-08-28T09:00:00+07:00";
const AFTER = "2026-08-31T09:00:00+07:00";

test("บันทึกไว้ก่อนของถึงมือ → มีสิทธิ์", () => {
  assert.equal(
    canRevealProof({
      status: "delivered",
      lastUpdated: DELIVERED_AT,
      savedAt: BEFORE,
    }),
    true,
  );
});

test("เพิ่งมาบันทึกหลังของถึงมือแล้ว → ไม่มีสิทธิ์", () => {
  // นี่คือกรณีที่เกณฑ์นี้ตั้งใจตัดออก: หยิบเลขจากกล่องที่ทิ้งแล้วมาค้นย้อนหลัง
  assert.equal(
    canRevealProof({
      status: "delivered",
      lastUpdated: DELIVERED_AT,
      savedAt: AFTER,
    }),
    false,
  );
});

test("ไม่เคยบันทึกไว้เลย → ไม่มีสิทธิ์", () => {
  assert.equal(
    canRevealProof({
      status: "delivered",
      lastUpdated: DELIVERED_AT,
      savedAt: null,
    }),
    false,
  );
});

test("พัสดุยังไม่ถึงมือ → ไม่มีรูปให้ดูอยู่แล้ว", () => {
  for (const status of ["pending", "in_transit", "out_for_delivery", "exception"] as const) {
    assert.equal(
      canRevealProof({ status, lastUpdated: DELIVERED_AT, savedAt: BEFORE }),
      false,
      status,
    );
  }
});

test("ข้อมูลเวลาไม่ครบหรืออ่านไม่ออก → ปฏิเสธไว้ก่อน", () => {
  const cases = [
    { lastUpdated: null, savedAt: BEFORE },
    { lastUpdated: DELIVERED_AT, savedAt: "ไม่ใช่วันที่" },
    { lastUpdated: "ไม่ใช่วันที่", savedAt: BEFORE },
  ];

  for (const input of cases) {
    assert.equal(
      canRevealProof({ status: "delivered", ...input }),
      false,
      JSON.stringify(input),
    );
  }
});

test("บันทึกในวินาทีเดียวกับที่ของถึงมือ → ไม่ผ่าน", () => {
  // เท่ากันไม่ใช่ "ก่อน" — พลาดไปทางที่ปลอดภัยเมื่อเวลาคาบเกี่ยวกันพอดี
  assert.equal(
    canRevealProof({
      status: "delivered",
      lastUpdated: DELIVERED_AT,
      savedAt: DELIVERED_AT,
    }),
    false,
  );
});
