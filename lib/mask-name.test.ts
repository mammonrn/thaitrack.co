/**
 * เทสต์การปิดบังชื่อคน
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้: ชื่อเต็มต้องไม่หลุด และผลลัพธ์ต้องยังพอให้เจ้าตัว
 * จำได้ว่าใช่ตัวเอง — สองอย่างนี้ขัดกันโดยธรรมชาติ ถ้ามีใครขยับกติกาไปทางใด
 * ทางหนึ่งมากไป ต้องพังที่นี่ก่อน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { graphemes, maskPersonName } from "./mask-name.ts";

test("ชื่อ-นามสกุลไทย → เห็นชื่อต้น ปิดนามสกุล", () => {
  assert.equal(maskPersonName("ภูมิ ธรรมสอน"), "ภูมิ ธ***");
});

test("ชื่ออังกฤษ → กติกาเดียวกัน", () => {
  assert.equal(maskPersonName("John Smith"), "John S***");
});

test("หลายคำ → ปิดทุกคำหลังคำแรก", () => {
  assert.equal(maskPersonName("สม ชาย ใจดี"), "สม ช*** ใ***");
});

test("คำเดียว → เห็นครึ่งแรก แต่ไม่เกิน 3 ตัวอักษร", () => {
  assert.equal(maskPersonName("แผนกต้อนรับ"), "แผน***");
  assert.equal(maskPersonName("สมชาย"), "สมช***");
});

test("ชื่อสั้นมาก → ยังเหลือให้เห็น ไม่กลายเป็นดาวล้วน", () => {
  // เงื่อนไขที่ตั้งไว้ตั้งแต่ต้น: mask แล้วต้องไม่เหลือแต่ดาว
  for (const short of ["สม", "AB", "ก", "A"]) {
    const masked = maskPersonName(short) ?? "";
    assert.notEqual(masked, "***", short);
    assert.ok(masked.startsWith(short[0]), `${short} → ${masked}`);
  }
});

test("นามสกุลต้องไม่หลุดไม่ว่ายาวแค่ไหน", () => {
  const masked = maskPersonName("ภูมิ ธรรมสอนสกุลยาวมาก") ?? "";
  assert.doesNotMatch(masked, /ธรรมสอน/);
});

test("จำนวนดาวคงที่ ไม่บอกความยาวของสิ่งที่ปิดไว้", () => {
  // ความยาวนามสกุลก็เป็นข้อมูลที่ช่วยเดาได้ ดาวเท่าความยาวจริงจึงยังบอก
  // อะไรออกไปโดยไม่จำเป็น
  const short = maskPersonName("ภูมิ ธง") ?? "";
  const long = maskPersonName("ภูมิ ธรรมสอนสกุลยาวมากจริงๆ") ?? "";

  assert.equal(short.length, long.length);
});

test("ตัดตามตัวอักษรที่คนมองเห็น ไม่ใช่ตาม code point", () => {
  // สระบนล่างเป็นคนละ code point กับพยัญชนะที่มันเกาะอยู่ ถ้าตัดผิดจะได้
  // สระลอยหรือพยัญชนะที่สระหายไป
  assert.deepEqual(graphemes("ภูมิ"), ["ภู", "มิ"]);
  assert.equal(maskPersonName("เมื่อยล้า"), "เมื่อ***");
});

test("ค่าว่างหรือไม่มีค่า → null ไม่ใช่ดาวลอยๆ", () => {
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(maskPersonName(empty), null);
  }
});

test("ช่องว่างซ้ำหรือช่องว่างหัวท้าย ไม่ทำให้ผลเพี้ยน", () => {
  assert.equal(maskPersonName("  ภูมิ   ธรรมสอน  "), "ภูมิ ธ***");
});
