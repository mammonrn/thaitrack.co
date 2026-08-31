/**
 * เทสต์การตรวจพิกัดก่อนบันทึก
 *
 * ฟังก์ชันนี้เป็นด่านเดียวที่กันไม่ให้พิกัดผิดเข้าฐานข้อมูล และพิกัดผิดที่
 * เข้าไปแล้วจะกลายเป็นหมุดมั่วที่ผู้ใช้เห็น — ซึ่งคือปัญหาเดิมที่ทั้งงานนี้
 * ตั้งใจจะแก้ เทสต์จึงเน้นค่าที่ "ดูเหมือนใช้ได้แต่ผิด" มากกว่าค่าที่ผิดชัดๆ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkCoordinates, isInThailand } from "./coordinates.ts";

/* --------------------------- ค่าที่ใช้ได้ --------------------------- */

test("พิกัดในไทย → ผ่าน และไม่ต้องเตือน", () => {
  const result = checkCoordinates(19.9105, 99.8406); // เชียงราย

  assert.ok(result.ok);
  assert.equal(result.lat, 19.9105);
  assert.equal(result.lng, 99.8406);
  assert.equal(result.outsideThailand, false);
});

test("รับค่าที่มาเป็นสตริงจากฟอร์มได้", () => {
  const result = checkCoordinates("13.7563", " 100.5018 ");

  assert.ok(result.ok);
  assert.equal(result.lat, 13.7563);
  assert.equal(result.lng, 100.5018);
});

test("พิกัดนอกไทยยังบันทึกได้ แต่ต้องติดธงเตือน", () => {
  // คลังพักที่เซินเจิ้นเป็นจุดจริงของพัสดุระหว่างประเทศ ห้ามบล็อก
  const result = checkCoordinates(22.5431, 114.0579);

  assert.ok(result.ok);
  assert.equal(result.outsideThailand, true);
});

test("สลับละติจูดกับลองจิจูดของจุดในไทย → ถูกจับได้เสมอ", () => {
  // ลองจิจูดของไทยอยู่ที่ 97–106 ซึ่งเกิน 90 ทั้งหมด การสลับช่องจึงทำให้
  // ละติจูดหลุดช่วงที่เป็นไปได้เสมอ และถูกปฏิเสธตั้งแต่ด่านแรก
  const thaiPoints: [number, number][] = [
    [19.9105, 99.8406], // เชียงราย
    [13.7563, 100.5018], // กรุงเทพ
    [7.8804, 98.3923], // ภูเก็ต
  ];

  for (const [lat, lng] of thaiPoints) {
    const swapped = checkCoordinates(lng, lat);
    assert.equal(swapped.ok, false, `${lng}, ${lat} ต้องถูกปฏิเสธ`);
    assert.ok(!swapped.ok && swapped.reason === "out_of_range");
  }
});

test("กรอกตกจุดทศนิยม → ยังอยู่ในช่วงที่เป็นไปได้ แต่ต้องเตือนว่าไม่ได้อยู่ในไทย", () => {
  // นี่คือความผิดพลาดที่ด่านตรวจช่วงจับไม่ได้ และเป็นเหตุผลที่ต้องมีการตรวจ
  // ขอบเขตประเทศไทยเพิ่ม — 1.99105 เป็นละติจูดที่ถูกต้องบนโลก แค่ไม่ใช่ไทย
  const typo = checkCoordinates(1.99105, 99.8406);

  assert.ok(typo.ok);
  assert.equal(typo.outsideThailand, true);
});

/* --------------------------- ค่าที่ต้องปฏิเสธ --------------------------- */

test("ไม่ใช่ตัวเลข → ปฏิเสธ", () => {
  for (const [lat, lng] of [
    ["abc", "100"],
    ["13.7", "ไม่ใช่ตัวเลข"],
    [null, 100],
    [undefined, 100],
    [{}, 100],
    [[], 100],
    [true, 100],
  ] as const) {
    const result = checkCoordinates(lat, lng);
    assert.equal(result.ok, false, `${String(lat)}, ${String(lng)}`);
  }
});

test("ช่องว่าง → ปฏิเสธ ไม่ใช่ตีเป็น 0", () => {
  // Number("") คืน 0 ซึ่งเป็นพิกัดกลางมหาสมุทรแอตแลนติกที่ดูเหมือนค่าที่ใช้ได้
  for (const [lat, lng] of [
    ["", "100"],
    ["   ", "100"],
    ["13.7", ""],
  ]) {
    const result = checkCoordinates(lat, lng);
    assert.equal(result.ok, false, `"${lat}", "${lng}"`);
    assert.ok(!result.ok && result.reason === "not_a_number");
  }
});

test("NaN และ Infinity → ปฏิเสธ", () => {
  assert.equal(checkCoordinates(Number.NaN, 100).ok, false);
  assert.equal(checkCoordinates(Number.POSITIVE_INFINITY, 100).ok, false);
  assert.equal(checkCoordinates(13.7, Number.NEGATIVE_INFINITY).ok, false);
});

test("นอกช่วงที่เป็นไปได้บนโลก → ปฏิเสธ", () => {
  for (const [lat, lng] of [
    [91, 100],
    [-91, 100],
    [13.7, 181],
    [13.7, -181],
  ]) {
    const result = checkCoordinates(lat, lng);
    assert.equal(result.ok, false, `${lat}, ${lng}`);
    assert.ok(!result.ok && result.reason === "out_of_range");
  }
});

test("ค่าที่ขอบพอดีต้องยังผ่าน", () => {
  assert.equal(checkCoordinates(90, 180).ok, true);
  assert.equal(checkCoordinates(-90, -180).ok, true);
});

/* --------------------------- ขอบเขตประเทศไทย --------------------------- */

test("จุดในไทยจริง → อยู่ในกรอบ", () => {
  const inside: [number, number][] = [
    [20.44, 99.88], // แม่สาย
    [5.77, 101.07], // เบตง
    [19.3, 97.97], // แม่ฮ่องสอน
    [15.24, 104.85], // อุบลราชธานี
    [13.7563, 100.5018], // กรุงเทพ
  ];

  for (const [lat, lng] of inside) {
    assert.equal(isInThailand(lat, lng), true, `${lat}, ${lng}`);
  }
});

test("จุดนอกไทย → อยู่นอกกรอบ", () => {
  const outside: [number, number][] = [
    [22.5431, 114.0579], // เซินเจิ้น
    [1.3521, 103.8198], // สิงคโปร์
    [3.139, 101.6869], // กัวลาลัมเปอร์
    [0, 0], // กลางมหาสมุทร — ค่าที่ได้จากการแปลงสตริงว่างพลาด
  ];

  for (const [lat, lng] of outside) {
    assert.equal(isInThailand(lat, lng), false, `${lat}, ${lng}`);
  }
});
