/**
 * เทสต์การจัดความยาวข้อความ meta
 *
 * เว็บนี้สร้างหน้ากว่าพันหน้าจากข้อมูลชุดเดียว ไม่มีใครเปิดดูครบทุกหน้าได้
 * เทสต์ชุดนี้จึงเป็นสิ่งเดียวที่รับประกันว่าไม่มีหน้าไหนถูกตัดกลางคำ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DESCRIPTION_MAX,
  SITE_SUFFIX,
  TITLE_MAX,
  fitDescription,
  fitTitle,
  textLength,
} from "./seo.ts";

test("นับความยาวเป็นตัวอักษรจริง ไม่ใช่ code unit", () => {
  // สระกับวรรณยุกต์ไทยเป็น code unit แยก ถ้านับด้วย .length จะได้ตัวเลขที่
  // มากกว่าจำนวนตัวอักษรที่คนเห็นจริง แล้วเราจะตัดข้อความสั้นเกินไป
  assert.equal(textLength("กก"), 2);
  assert.ok(textLength("เชียงราย") <= "เชียงราย".length);
});

test("ต่อชื่อเว็บเมื่อยังมีที่เหลือ", () => {
  const title = fitTitle("เช็คพัสดุ Flash Express");

  assert.ok(title.endsWith(SITE_SUFFIX));
  assert.ok(textLength(title) <= TITLE_MAX);
});

test("ไม่ต่อชื่อเว็บเมื่อจะทำให้เกินเพดาน — ตัดชื่อเว็บก่อนเนื้อหาเสมอ", () => {
  const core = "รหัสไปรษณีย์อำเภอ" + "ก".repeat(40);
  const title = fitTitle(core);

  assert.equal(title, core, "เนื้อหาต้องอยู่ครบ");
  assert.ok(!title.endsWith(SITE_SUFFIX));
});

test("ใส่ส่วนขยายเท่าที่ยังไม่เกินเพดาน", () => {
  const text = fitDescription("ฐาน", ["หนึ่ง", "สอง", "สาม"]);

  assert.equal(text, "ฐาน หนึ่ง สอง สาม");
  assert.ok(textLength(text) <= DESCRIPTION_MAX);
});

test("หยุดใส่ทันทีที่ชิ้นถัดไปจะทำให้เกิน — ไม่ตัดกลางคำ", () => {
  const base = "ก".repeat(140);
  const text = fitDescription(base, ["ตำบลหนึ่ง", "ตำบลสอง"]);

  assert.ok(textLength(text) <= DESCRIPTION_MAX);
  assert.ok(text.startsWith(base), "ประโยคหลักต้องอยู่ครบเสมอ");
  assert.doesNotMatch(text, /ตำบลสอง/);
});

test("ประโยคหลักยาวเกินเพดานอยู่แล้ว → คืนตามเดิม ไม่ตัดทิ้ง", () => {
  // ตัดประโยคหลักทิ้งจะได้ข้อความที่อ่านไม่รู้เรื่อง ซึ่งแย่กว่ายาวเกิน
  const base = "ก".repeat(200);
  assert.equal(fitDescription(base, ["เพิ่ม"]), base);
});
