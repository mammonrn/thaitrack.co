/**
 * เทสต์การเดาขนส่งจาก prefix ของเลขพัสดุ
 *
 * ตารางนี้ถูกใช้ "ก่อน" การตรวจจับอัตโนมัติของ Track123 การเดาผิดจึงแพงกว่า
 * การไม่เดาเลย เทสต์ชุดนี้จึงเน้นสองอย่าง: เจอที่ควรเจอ และไม่เดาเกินตัว
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { COURIER_PREFIXES, courierFromPrefix } from "./courier-prefix.ts";

test("เลขขึ้นต้น SPXTH → shopee-xpress-th", () => {
  assert.equal(courierFromPrefix("SPXTH046012345678"), "shopee-xpress-th");
});

test("พิมพ์เล็ก มีช่องว่างหรือขีดคั่น → ยัง match ได้", () => {
  assert.equal(courierFromPrefix("spxth046012345678"), "shopee-xpress-th");
  assert.equal(courierFromPrefix("SPX TH 0460 1234"), "shopee-xpress-th");
  assert.equal(courierFromPrefix("spx-th-046012345"), "shopee-xpress-th");
});

test("prefix ที่ไม่รู้จัก → คืน null ให้ไปใช้การตรวจจับอัตโนมัติตามเดิม", () => {
  assert.equal(courierFromPrefix("EY145587896TH"), null);
  assert.equal(courierFromPrefix("TH54018WD4DJ1P"), null);
  assert.equal(courierFromPrefix("1234567890"), null);
});

test("เลขว่างหรือสั้นกว่า prefix → คืน null ไม่พัง", () => {
  assert.equal(courierFromPrefix(""), null);
  assert.equal(courierFromPrefix("   "), null);
  assert.equal(courierFromPrefix("SPX"), null);
  assert.equal(courierFromPrefix("SPXT"), null);
});

test("prefix ต้องตรงตั้งแต่ตัวแรก ไม่ใช่แค่มีอยู่กลางเลข", () => {
  assert.equal(courierFromPrefix("EYSPXTH12345"), null);
});

test("ทุกแถวในตารางต้องเป็นตัวพิมพ์ใหญ่และยาวพอจะไม่ชนเจ้าอื่นโดยบังเอิญ", () => {
  for (const entry of COURIER_PREFIXES) {
    assert.equal(
      entry.prefix,
      entry.prefix.toUpperCase(),
      `prefix "${entry.prefix}" ต้องเป็นตัวพิมพ์ใหญ่ ไม่งั้นจะ match ไม่เจอ`,
    );
    assert.ok(
      entry.prefix.length >= 4,
      `prefix "${entry.prefix}" สั้นเกินไป เสี่ยงชนเลขของขนส่งเจ้าอื่น`,
    );
    assert.ok(entry.courierCode.trim() !== "");
  }
});

test("ไม่มี prefix ซ้ำกันสองแถว ซึ่งจะทำให้ผลลัพธ์ขึ้นกับลำดับที่เขียน", () => {
  const seen = new Set(COURIER_PREFIXES.map((entry) => entry.prefix));
  assert.equal(seen.size, COURIER_PREFIXES.length);
});

test("แถวที่ prefix ยาวกว่าชนะ ไม่ว่าจะเขียนไว้ลำดับไหน", () => {
  // ตรวจกติกาการเลือกโดยตรง เผื่ออนาคตมีแถวที่ prefix หนึ่งเป็นส่วนหน้าของอีกแถว
  const longest = [...COURIER_PREFIXES].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0];

  if (longest !== undefined) {
    assert.equal(
      courierFromPrefix(`${longest.prefix}000000000`),
      longest.courierCode,
    );
  }
});
test("เลข J&T ที่ผู้ใช้แจ้ง → ฟันธงเป็น jt-express", () => {
  // สองเลขนี้คือเลขจริงที่เว็บเคยตอบว่า "ยังไม่พบ" ทั้งที่ ETrackings หาเจอ
  assert.equal(courierFromPrefix("JTTH203388775531"), "jt-express");
  assert.equal(courierFromPrefix("JTTH203838762083"), "jt-express");
  assert.equal(courierFromPrefix("jtth203388775531"), "jt-express");
});

test("JT ที่ไม่ได้ตามด้วย TH → ไม่ฟันธง", () => {
  // เราเติมเฉพาะ JTTH ซึ่งเป็นของ J&T ไทยแน่ๆ ไม่ใช่ JT ล้วนที่กว้างเกินไป
  assert.equal(courierFromPrefix("JT203388775531"), null);
});

