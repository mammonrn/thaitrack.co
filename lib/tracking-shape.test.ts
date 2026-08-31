/**
 * เทสต์ว่า "รูปแบบเลขพัสดุ" ที่เก็บลงสถิติย้อนกลับเป็นเลขจริงไม่ได้
 *
 * ถ้าเทสต์ในไฟล์นี้ล้ม อย่าแก้เทสต์ ให้แก้โค้ด — คอลัมน์ tracking_shape ใน
 * search_events มีอยู่ได้เพราะกติกาพวกนี้เท่านั้น ถ้ากติกาหลุด คอลัมน์นั้น
 * จะกลายเป็นการเก็บเลขพัสดุ ซึ่งเป็นสิ่งที่ทั้งระบบสัญญาว่าจะไม่ทำ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_PREFIX_LENGTH, trackingShape } from "./tracking-shape.ts";

test("แปลงตามรูปแบบที่ตกลงไว้", () => {
  assert.equal(trackingShape("JTTH203388775531"), "JTTH############");
  assert.equal(trackingShape("TH264511339099F"), "TH############A");
  // "SPXTH" ยาว 5 ตัว เกินเพดาน 4 ตัว ตัวที่ห้าจึงกลายเป็น A ตามกติกา
  assert.equal(trackingShape("SPXTH046012345678"), "SPXTA############");
});

test("ตัวเลขทุกตัวต้องหายหมด ไม่เหลือให้เดาเลย", () => {
  const shape = trackingShape("EY145587896TH");
  assert.ok(shape !== null);
  assert.doesNotMatch(shape, /\d/, "ยังมีตัวเลขหลงเหลืออยู่");
});

test("เลขสองใบที่ต่างกันแต่ทรงเดียวกัน → ได้รูปแบบเดียวกัน", () => {
  // นี่คือหัวใจของการย้อนกลับไม่ได้: รูปแบบหนึ่งอันแทนเลขได้เป็นล้านใบ
  assert.equal(
    trackingShape("JTTH203388775531"),
    trackingShape("JTTH203838762083"),
  );
});

test("ตัวอักษรนำหน้าถูกตัดที่เพดาน ไม่ว่าจะยาวแค่ไหน", () => {
  // ⚠️ ข้อนี้สำคัญที่สุดในไฟล์: ถ้าไม่จำกัด เลขที่เป็นตัวอักษรล้วนจะถูกเก็บ
  // ทั้งดุ้น ซึ่งเท่ากับเก็บเลขพัสดุจริงลงตารางสถิติ
  const shape = trackingShape("ABCDEFGHIJKLMNOP");
  assert.ok(shape !== null);

  assert.equal(shape.slice(0, MAX_PREFIX_LENGTH), "ABCD");
  assert.equal(shape.slice(MAX_PREFIX_LENGTH), "A".repeat(12));
});

test("ตัวอักษรที่ไม่ได้อยู่หน้าสุดต้องกลายเป็น A เสมอ", () => {
  // เลขไปรษณีย์ไทยลงท้ายด้วย TH ซึ่งบอกประเทศ ไม่ใช่ตัวระบุพัสดุ แต่ก็ไม่
  // มีเหตุผลให้เก็บไว้ กติกา "เก็บเฉพาะหน้าสุด" จึงตรงไปตรงมาที่สุด
  assert.equal(trackingShape("EY145587896TH"), "EY#########AA");
});

test("ตัวคั่นและตัวพิมพ์เล็กถูกจัดให้เหมือนกันหมดก่อนแปลง", () => {
  assert.equal(trackingShape("jtth-2033 8877 5531"), "JTTH############");
});

test("ค่าที่ไม่ใช่เลขพัสดุ → null ไม่ต้องเก็บ", () => {
  assert.equal(trackingShape(""), null);
  assert.equal(trackingShape("   "), null);
  assert.equal(trackingShape("-"), null);
  assert.equal(trackingShape("A".repeat(41)), null);
});
