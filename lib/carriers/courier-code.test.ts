/**
 * เทสต์การเทียบรหัสขนส่งแบบทนต่อการสะกดต่างกัน
 *
 * บั๊กที่ทำให้ไฟล์นี้เกิดขึ้น: cache เก็บ "flashexpress" (จาก Track123) แต่ตาราง
 * แปลงรหัสเขียนไว้ว่า "flash-express" ทั้งสองอันคือเจ้าเดียวกัน แต่เทียบกันไม่ติด
 * ผลคือ ETrackings ไม่เคยถูกเรียกให้ Flash เลย **และไม่มีอะไรฟ้องสักอย่าง**
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCourierLookup,
  normalizeCourierCode,
  reportUnknownCourier,
  resetCourierReports,
} from "./courier-code.ts";

test("ทุกวิธีสะกดของเจ้าเดียวกัน → ได้คีย์เดียวกัน", () => {
  const variants = [
    "flash-express",
    "flashexpress",
    "Flash Express",
    "FLASH_EXPRESS",
    "flash.express",
  ];

  const normalized = new Set(variants.map(normalizeCourierCode));
  assert.equal(normalized.size, 1, [...normalized].join(" / "));
  assert.equal([...normalized][0], "flashexpress");
});

test("เจ้าที่ต่างกันจริง ต้องไม่ถูกยุบรวมกัน", () => {
  // kerry กับ kex เป็นคนละคำ ไม่ใช่การสะกดต่างกันของคำเดียวกัน
  assert.notEqual(
    normalizeCourierCode("kerry-express"),
    normalizeCourierCode("kex-express"),
  );
  assert.notEqual(
    normalizeCourierCode("jt-express"),
    normalizeCourierCode("jnt-express"),
  );
});

test("ค่าว่างหรือไม่มีค่า → คืนสตริงว่าง ไม่พัง", () => {
  for (const empty of ["", "   ", "---", null, undefined]) {
    assert.equal(normalizeCourierCode(empty), "");
  }
});

test("ตารางค้นหาจับได้ทุกวิธีสะกด", () => {
  const lookup = buildCourierLookup({ "flash-express": "flash-express" });

  assert.equal(lookup.get(normalizeCourierCode("flashexpress")), "flash-express");
  assert.equal(lookup.get(normalizeCourierCode("Flash Express")), "flash-express");
});

test("ตารางที่ขัดแย้งกันเอง → พังตั้งแต่ import ไม่ปล่อยให้เงียบ", () => {
  // ถ้าปล่อยผ่าน ผลลัพธ์จะขึ้นกับลำดับที่เขียนในตาราง ซึ่งเป็นบั๊กที่หายาก
  // ที่สุดแบบหนึ่ง — พังดังๆ ตอน import ดีกว่ามาก
  assert.throws(
    () =>
      buildCourierLookup({
        "flash-express": "flash-express",
        flashexpress: "อีกเจ้าหนึ่ง",
      }),
    /ขัดแย้งกันเอง/,
  );
});

test("คีย์ที่สะกดต่างกันแต่ชี้ค่าเดียวกัน → ไม่ถือว่าขัดแย้ง", () => {
  assert.doesNotThrow(() =>
    buildCourierLookup({
      "flash-express": "flash-express",
      flashexpress: "flash-express",
    }),
  );
});

/* ---------------------- เสียงเตือนเมื่อเจอรหัสใหม่ ---------------------- */

function captureWarnings(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => void lines.push(String(line));
  try {
    run();
  } finally {
    console.warn = original;
  }
  return lines;
}

test("รหัสที่ไม่รู้จัก → เตือนหนึ่งครั้ง พร้อมบอกว่าต้องไปเติมที่ไหน", () => {
  resetCourierReports();

  const lines = captureWarnings(() => {
    reportUnknownCourier("newcarrier-th", "etrackings");
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /newcarrier-th/);
  assert.match(lines[0], /COURIER_MAP/);
});

test("รหัสเดิมซ้ำ → ไม่เตือนอีก log จะได้ไม่รก", () => {
  resetCourierReports();

  const lines = captureWarnings(() => {
    reportUnknownCourier("newcarrier-th", "etrackings");
    reportUnknownCourier("NEWCARRIER_TH", "etrackings");
    reportUnknownCourier("newcarrier-th", "etrackings");
  });

  assert.equal(lines.length, 1, "รหัสเดียวกันที่สะกดต่างกันก็นับเป็นตัวเดียวกัน");
});

test("เจ้าที่รู้อยู่แล้วว่าไม่รองรับ → เงียบ", () => {
  // ถ้าเตือนด้วย log จะเต็มไปด้วยเสียงของสิ่งที่เราตั้งใจไม่รองรับ แล้วเสียง
  // ของรหัสใหม่ที่ควรรู้จริงๆ จะจมหายไป
  resetCourierReports();

  const lines = captureWarnings(() => {
    for (const known of ["thailand-post", "lex", "fed-ex", "track123", "etrackings"]) {
      reportUnknownCourier(known, "etrackings");
    }
  });

  assert.deepEqual(lines, []);
});
