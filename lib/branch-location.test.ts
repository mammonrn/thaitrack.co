/**
 * เทสต์การแยกรหัสสาขาออกจากที่อยู่จริง
 *
 * เคสที่สำคัญที่สุดคือ **ทางที่ห้ามผ่าน**: รหัสสาขาต้องไม่หลุดไปถึง Google
 * เพราะถ้าหลุด Google จะเดาจากคำที่พอเดาได้แล้วคืนหมุดกลางเมือง ซึ่งผู้ใช้
 * แยกไม่ออกว่าผิด — เป็นความผิดพลาดที่ "ดูเหมือนทำงานถูก"
 *
 * ตัวอย่างที่ใช้มาจากข้อความจริงที่เจอในระบบ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  looksLikeAddress,
  normalizeBranchCode,
  normalizeGeocodeQuery,
  parseLocationText,
} from "./branch-location.ts";

/* ------------------------- รหัสสาขา ------------------------- */

test("รหัสสาขาพร้อมชื่อ — แยกรหัสกับชื่อออกจากกัน และห้าม geocode", () => {
  const parsed = parseLocationText("ACRAI-B - เมืองเชียงราย");

  assert.equal(parsed.kind, "branch");
  assert.equal(parsed.branchCode, "ACRAI-B");
  assert.equal(parsed.branchName, "เมืองเชียงราย");
  assert.equal(parsed.displayText, "เมืองเชียงราย");
  assert.equal(
    parsed.geocodeQuery,
    null,
    "ห้ามส่งรหัสสาขาหรือชื่อสาขาไปให้ Google — นี่คือต้นเหตุของหมุดมั่ว",
  );
});

test("รหัสสาขาที่มีตัวเลขนำหน้าและใช้ขีดล่าง", () => {
  const parsed = parseLocationText("08 NO4_HUB-เชียงราย");

  assert.equal(parsed.kind, "branch");
  assert.equal(parsed.branchCode, "NO4_HUB");
  assert.equal(parsed.branchName, "เชียงราย");
  assert.equal(parsed.geocodeQuery, null);
});

test("รหัสสาขาล้วน ไม่มีชื่อต่อท้าย → แสดงรหัสแทน ไม่ปล่อยว่าง", () => {
  const parsed = parseLocationText("ACRAI-B");

  assert.equal(parsed.kind, "branch");
  assert.equal(parsed.branchCode, "ACRAI-B");
  assert.equal(parsed.branchName, null);
  assert.equal(parsed.displayText, "ACRAI-B");
  assert.equal(parsed.geocodeQuery, null);
});

test("ตัวคั่นระหว่างรหัสกับชื่อมีได้หลายแบบ", () => {
  for (const raw of [
    "ACRAI-B - เมืองเชียงราย",
    "ACRAI-B: เมืองเชียงราย",
    "ACRAI-B, เมืองเชียงราย",
    "ACRAI-B เมืองเชียงราย",
  ]) {
    const parsed = parseLocationText(raw);
    assert.equal(parsed.branchCode, "ACRAI-B", raw);
    assert.equal(parsed.branchName, "เมืองเชียงราย", raw);
  }
});

test("รหัสที่มีตัวเลขปนแต่ไม่มีขีด ก็ยังนับเป็นรหัสสาขา", () => {
  const parsed = parseLocationText("BKK12 คลังบางนา");

  assert.equal(parsed.kind, "branch");
  assert.equal(parsed.branchCode, "BKK12");
  assert.equal(parsed.geocodeQuery, null);
});

/* ------------------------- ที่อยู่จริง ------------------------- */

test("ชื่อสถานที่ภาษาไทย → ส่งไป geocode ได้", () => {
  const parsed = parseLocationText("ศูนย์ไปรษณีย์หลักสี่");

  assert.equal(parsed.kind, "address");
  assert.equal(parsed.branchCode, null);
  assert.equal(parsed.geocodeQuery, "ศูนย์ไปรษณีย์หลักสี่");
  assert.equal(parsed.displayText, "ศูนย์ไปรษณีย์หลักสี่");
});

test("ที่อยู่ที่มีรหัสไปรษณีย์ → ส่งไป geocode ได้", () => {
  const parsed = parseLocationText("สำเหร่ 10600");

  assert.equal(parsed.kind, "address");
  assert.equal(parsed.geocodeQuery, "สำเหร่ 10600");
});

test("ชื่อเมืองภาษาอังกฤษที่ไม่มีรหัสปน → ยังหาพิกัดได้ตามเดิม", () => {
  for (const raw of ["Bangkok", "Shenzhen sorting centre", "Chiang Mai"]) {
    const parsed = parseLocationText(raw);
    assert.equal(parsed.kind, "address", raw);
    assert.equal(parsed.geocodeQuery, raw, raw);
  }
});

test("ตัดช่องว่างซ้ำและช่องว่างหัวท้ายก่อนเสมอ", () => {
  const parsed = parseLocationText("  ศูนย์คัดแยก   ลาดกระบัง  ");

  assert.equal(parsed.displayText, "ศูนย์คัดแยก ลาดกระบัง");
  assert.equal(parsed.geocodeQuery, "ศูนย์คัดแยก ลาดกระบัง");
});

/* --------------------- ทางที่ต้องไม่ปักหมุด --------------------- */

test("ข้อความว่าง → ไม่มีอะไรให้แสดงและไม่มีอะไรให้หา", () => {
  for (const raw of ["", "   ", "\n"]) {
    const parsed = parseLocationText(raw);
    assert.equal(parsed.kind, "unknown");
    assert.equal(parsed.displayText, "");
    assert.equal(parsed.geocodeQuery, null);
  }
});

test("ข้อความที่อ่านไม่ออกว่าเป็นอะไร → ไม่ geocode แต่ยังแสดงให้ผู้ใช้เห็น", () => {
  const parsed = parseLocationText("###???");

  assert.equal(parsed.kind, "unknown");
  assert.equal(parsed.geocodeQuery, null);
  assert.equal(parsed.displayText, "###???", "ขนส่งบอกอะไรมา ผู้ใช้ควรได้เห็น");
});

test("ตัวเลขล้วน → ไม่ใช่ที่อยู่ ไม่ geocode", () => {
  const parsed = parseLocationText("123456789");
  assert.equal(parsed.geocodeQuery, null);
});

test("ไม่มี input ไหนที่เป็นรหัสสาขาแล้วยังหลุดไป geocode ได้", () => {
  const branchCodes = [
    "ACRAI-B",
    "NO4_HUB",
    "TH-BKK",
    "SPX_TH_01",
    "CM01-A",
    "BKK12",
    "ACRAI-B - เมืองเชียงราย",
    "08 NO4_HUB-เชียงราย",
  ];

  for (const raw of branchCodes) {
    const parsed = parseLocationText(raw);
    assert.equal(parsed.geocodeQuery, null, `"${raw}" หลุดไปหาพิกัดได้`);
  }
});

/* ----------------------- looksLikeAddress ----------------------- */

test("looksLikeAddress ตัดสินจากสัญญาณที่ชัดเจนเท่านั้น", () => {
  assert.equal(looksLikeAddress("เชียงราย"), true);
  assert.equal(looksLikeAddress("สำเหร่ 10600"), true);
  assert.equal(looksLikeAddress("Bangkok"), true);
  assert.equal(looksLikeAddress(""), false);
  assert.equal(looksLikeAddress("###"), false);
  assert.equal(looksLikeAddress("123456789"), false);
});

/* ------------------------- normalize ------------------------- */

test("รหัสสาขาถูกทำเป็นตัวพิมพ์ใหญ่เสมอ ก่อนใช้เป็น key ในฐานข้อมูล", () => {
  assert.equal(normalizeBranchCode(" acrai-b "), "ACRAI-B");
  assert.equal(normalizeBranchCode("No4_Hub"), "NO4_HUB");
});

test("key ของ cache พิกัดเป็นตัวพิมพ์เล็ก ช่องว่างเดียว", () => {
  assert.equal(
    normalizeGeocodeQuery("  ศูนย์คัดแยก   ลาดกระบัง "),
    "ศูนย์คัดแยก ลาดกระบัง",
  );
  assert.equal(normalizeGeocodeQuery("BANGKOK"), "bangkok");
});

test("ข้อความเดียวกันที่พิมพ์ต่างกันเล็กน้อย ต้องได้ key เดียวกัน", () => {
  const variants = ["Bangkok", "bangkok", "  BANGKOK  ", "Bang kok"];
  const keys = new Set(variants.slice(0, 3).map(normalizeGeocodeQuery));

  assert.equal(keys.size, 1, "สามแบบแรกต้องได้ key เดียวกัน");
  assert.notEqual(
    normalizeGeocodeQuery(variants[3]),
    normalizeGeocodeQuery(variants[0]),
    "ข้อความที่ต่างกันจริงต้องไม่ถูกยุบรวม",
  );
});
