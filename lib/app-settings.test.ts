/**
 * เทสต์สวิตช์เปิด/ปิดฟีเจอร์
 *
 * สองอย่างที่เฝ้าไว้ และทั้งคู่ล้มเหลวแบบเงียบๆ ได้:
 *
 *   1. **ค่าที่อ่านไม่ออกต้องกลายเป็นค่าเริ่มต้น ไม่ใช่ค่าที่เดาเอง** ตาราง
 *      app_settings เก็บ jsonb จึงมีอะไรอยู่ข้างในก็ได้ ถ้าปล่อยให้สตริง
 *      "false" กลายเป็น truthy แผนที่จะเปิดทั้งที่แอดมินสั่งปิด
 *   2. **คีย์นอกชุดปิดต้องไม่มีผลอะไร** ไม่งั้นการพิมพ์คีย์ผิดจะกลายเป็น
 *      สวิตช์ผีที่ไม่มีใครรู้ว่ามีอยู่
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SETTING_DEFAULTS,
  SETTING_KEYS,
  SETTING_LABEL,
  defaultSettings,
  isSettingKey,
  parseSettings,
} from "./app-settings.ts";

test("ค่าเริ่มต้นของแผนที่คือปิด", () => {
  // ปิดปลอดภัยกว่าเมื่อไม่รู้ — แผนที่ที่ขึ้นทั้งที่ควรปิดคือการจ่ายเงินให้
  // Google โดยไม่ได้ตั้งใจ ส่วนแผนที่ที่ไม่ขึ้นยังใช้งานเว็บได้ครบ
  assert.equal(SETTING_DEFAULTS.map_enabled, false);
  assert.equal(defaultSettings().map_enabled, false);
});

test("defaultSettings คืนสำเนาใหม่ทุกครั้ง ไม่ใช่ตัวเดิม", () => {
  const first = defaultSettings();
  first.map_enabled = true;
  assert.equal(defaultSettings().map_enabled, false, "ของเดิมต้องไม่ถูกแก้");
});

test("ทุกคีย์ต้องมีค่าเริ่มต้นและมีคำอธิบายบนหน้าแอดมิน", () => {
  for (const key of SETTING_KEYS) {
    assert.equal(typeof SETTING_DEFAULTS[key], "boolean", `${key} ไม่มีค่าเริ่มต้น`);
    assert.ok(SETTING_LABEL[key]?.title, `${key} ไม่มีชื่อให้แสดง`);
    assert.ok(SETTING_LABEL[key]?.detail, `${key} ไม่มีคำอธิบาย`);
  }
});

test("คีย์นอกชุดปิดถูกปฏิเสธ", () => {
  assert.equal(isSettingKey("map_enabled"), true);
  for (const bad of ["", "MAP_ENABLED", "map_enable", "maps_enabled", 1, null, undefined, {}]) {
    assert.equal(isSettingKey(bad), false, String(bad));
  }
});

/* ------------------------ การแปลงแถวจากฐานข้อมูล ------------------------ */

test("แถวปกติ → ใช้ค่าจากฐานข้อมูล", () => {
  assert.equal(
    parseSettings([{ key: "map_enabled", value: true }]).map_enabled,
    true,
  );
});

test("ไม่มีแถวเลย (ยังไม่ได้รัน migration) → ค่าเริ่มต้น", () => {
  assert.deepEqual(parseSettings([]), defaultSettings());
  assert.deepEqual(parseSettings(null), defaultSettings());
  assert.deepEqual(parseSettings(undefined), defaultSettings());
});

test("ค่าที่ไม่ใช่ boolean → ค่าเริ่มต้น ไม่ใช่เดาว่าเปิด", () => {
  // สตริง "false" เป็น truthy ใน JavaScript — ถ้าไม่กรองชนิด แถวนี้จะเปิดแผนที่
  // ทั้งที่ค่าที่เขียนไว้แปลว่าปิด
  for (const bad of ["false", "true", 0, 1, null, {}, []]) {
    assert.equal(
      parseSettings([{ key: "map_enabled", value: bad }]).map_enabled,
      false,
      JSON.stringify(bad),
    );
  }
});

test("คีย์ที่ไม่รู้จักถูกข้าม ไม่ทำให้ทั้งชุดพัง", () => {
  // เกิดได้จริงตอน rolling deploy: เครื่องเก่ายังไม่รู้จักสวิตช์ของโค้ดใหม่
  const settings = parseSettings([
    { key: "สวิตช์ที่ยังไม่มีในโค้ดนี้", value: true },
    { key: "map_enabled", value: true },
  ]);

  assert.equal(settings.map_enabled, true);
  assert.deepEqual(Object.keys(settings), [...SETTING_KEYS]);
});

test("แถวพิการ (ไม่มี key หรือเป็น null) → ไม่พัง", () => {
  assert.doesNotThrow(() =>
    parseSettings([
      null as never,
      undefined as never,
      {} as never,
      { key: null, value: true },
    ]),
  );
});
