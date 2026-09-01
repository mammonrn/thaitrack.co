/**
 * เทสต์การคำนวณรอบบิล
 *
 * จุดที่พลาดง่ายที่สุดและเทสต์ชุดนี้เฝ้าไว้เป็นพิเศษ: วันเริ่มรอบ 29-31 กับ
 * เดือนที่สั้นกว่านั้น ถ้าไม่บีบวันลงมา รอบจะเลื่อนไปทั้งเดือนโดยไม่มีใครสังเกต
 * จนกว่าจะถึงเดือนกุมภาพันธ์
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bangkokDate,
  nextResetAt,
  normalizeResetDay,
  periodKey,
  type BillingPeriod,
} from "./billing-period.ts";

const daily: BillingPeriod = { cycle: "daily", resetDay: 1 };
const monthly29: BillingPeriod = { cycle: "monthly", resetDay: 29 };
const monthly31: BillingPeriod = { cycle: "monthly", resetDay: 31 };
const lifetime: BillingPeriod = { cycle: "lifetime", resetDay: 1 };

const at = (iso: string) => Date.parse(iso);

/* ---------------------------- รายวัน ---------------------------- */

test("รายวัน — คีย์คือวันที่ตามเวลาไทย", () => {
  assert.equal(periodKey(daily, at("2026-09-01T00:05:00+07:00")), "2026-09-01");
  assert.equal(periodKey(daily, at("2026-09-01T23:59:00+07:00")), "2026-09-01");
  assert.equal(periodKey(daily, at("2026-09-02T00:00:00+07:00")), "2026-09-02");
});

test("รายวัน — เที่ยงคืนเวลาไทย ไม่ใช่ UTC", () => {
  // 1 ก.ย. 01:00 ไทย = 31 ส.ค. 18:00 UTC
  assert.equal(periodKey(daily, at("2026-09-01T01:00:00+07:00")), "2026-09-01");
  assert.equal(
    nextResetAt(daily, at("2026-09-01T01:00:00+07:00")),
    at("2026-09-02T00:00:00+07:00"),
  );
});

/* --------------------------- รายเดือน --------------------------- */

test("รายเดือน — ยังไม่ถึงวันรีเซ็ต แปลว่ายังอยู่ในรอบที่เริ่มเดือนก่อน", () => {
  assert.equal(periodKey(monthly29, at("2026-09-01T10:00:00+07:00")), "2026-08-29");
  assert.equal(periodKey(monthly29, at("2026-09-28T23:00:00+07:00")), "2026-08-29");
  assert.equal(periodKey(monthly29, at("2026-09-29T00:00:00+07:00")), "2026-09-29");
});

test("รายเดือน — วันเริ่มรอบ 29 เจอเดือนกุมภาพันธ์ 28 วัน ต้องบีบลงมา", () => {
  // ถ้าไม่บีบ "29 ก.พ." ของปีปกติจะกลายเป็น 1 มี.ค. โดยอัตโนมัติ แล้วรอบจะเพี้ยน
  assert.equal(periodKey(monthly29, at("2026-02-28T10:00:00+07:00")), "2026-02-28");
  assert.equal(periodKey(monthly29, at("2026-02-27T10:00:00+07:00")), "2026-01-29");
});

test("รายเดือน — ปีอธิกสุรทินได้วันที่ 29 เต็มๆ", () => {
  assert.equal(periodKey(monthly29, at("2028-02-29T10:00:00+07:00")), "2028-02-29");
  assert.equal(periodKey(monthly29, at("2028-02-28T10:00:00+07:00")), "2028-01-29");
});

test("รายเดือน — วันเริ่มรอบ 31 ในเดือนที่มี 30 วัน", () => {
  assert.equal(periodKey(monthly31, at("2026-04-30T10:00:00+07:00")), "2026-04-30");
  assert.equal(periodKey(monthly31, at("2026-04-29T10:00:00+07:00")), "2026-03-31");
});

test("รายเดือน — วันรีเซ็ตครั้งถัดไปข้ามปีได้ถูกต้อง", () => {
  assert.equal(
    nextResetAt(monthly29, at("2026-12-30T10:00:00+07:00")),
    at("2027-01-29T00:00:00+07:00"),
  );
});

test("รายเดือน — วันรีเซ็ตครั้งถัดไปก็ต้องบีบวันเหมือนกัน", () => {
  assert.equal(
    nextResetAt(monthly31, at("2026-01-31T10:00:00+07:00")),
    at("2026-02-28T00:00:00+07:00"),
  );
});

test("รายเดือน — ทุกวันในรอบเดียวกันต้องได้คีย์เดียวกันทั้งหมด", () => {
  // ไล่ทีละวันจริงๆ เพราะบั๊กของการคำนวณวันมักโผล่เฉพาะบางวัน ไม่ใช่ทั้งช่วง
  const keys = new Set<string>();
  for (let day = 29; day <= 31; day += 1) {
    keys.add(periodKey(monthly29, at(`2026-08-${day}T12:00:00+07:00`)));
  }
  for (let day = 1; day <= 28; day += 1) {
    const date = String(day).padStart(2, "0");
    keys.add(periodKey(monthly29, at(`2026-09-${date}T12:00:00+07:00`)));
  }

  assert.deepEqual([...keys], ["2026-08-29"], "ทั้งรอบต้องเป็นคีย์เดียว");
});

/* --------------------------- สะสมตลอด --------------------------- */

test("ไม่รีเซ็ต — คีย์คงที่และไม่มีวันรีเซ็ตครั้งถัดไป", () => {
  assert.equal(periodKey(lifetime, at("2026-09-01T10:00:00+07:00")), "lifetime");
  assert.equal(periodKey(lifetime, at("2030-01-01T10:00:00+07:00")), "lifetime");
  assert.equal(nextResetAt(lifetime, at("2026-09-01T10:00:00+07:00")), null);
});

/* ------------------------- ค่าที่ตั้งมั่ว ------------------------- */

test("วันเริ่มรอบนอกช่วง 1-31 ถูกบีบกลับมา ไม่พัง", () => {
  assert.equal(normalizeResetDay(0), 1);
  assert.equal(normalizeResetDay(-3), 1);
  assert.equal(normalizeResetDay(99), 31);
  assert.equal(normalizeResetDay(15.7), 15);
  assert.equal(normalizeResetDay(Number.NaN), 1);
});

test("แตกวันที่ตามเวลาไทยได้ถูกต้องรอบเที่ยงคืน", () => {
  assert.deepEqual(bangkokDate(at("2026-09-01T00:00:00+07:00")), {
    year: 2026,
    month: 9,
    day: 1,
  });
  assert.deepEqual(bangkokDate(at("2026-08-31T23:59:59+07:00")), {
    year: 2026,
    month: 8,
    day: 31,
  });
});
