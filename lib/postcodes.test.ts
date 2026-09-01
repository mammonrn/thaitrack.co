/**
 * เทสต์ความถูกต้องของชุดข้อมูลรหัสไปรษณีย์
 *
 * ข้อมูลนี้มาจากชุดข้อมูลสาธารณะภายนอก และถูกใช้สร้างหน้าเว็บกว่าพันหน้า
 * ถ้ามีแถวเสียปนมา มันจะกลายเป็นหน้าที่ Google เก็บไปแล้วมีข้อมูลผิด ซึ่งกู้
 * ยากกว่าการไม่มีหน้านั้นตั้งแต่แรกมาก — เทสต์ชุดนี้จึงตรวจของจริงทุกแถว
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DATA_SOURCE,
  PROVINCES,
  countTambons,
  findAmphoe,
  findProvince,
  postcodesOf,
  provincePostcodes,
} from "./postcodes.ts";

test("มีครบ 77 จังหวัด", () => {
  assert.equal(PROVINCES.length, 77);
});

test("ชื่อจังหวัดไม่ซ้ำกัน และชื่ออำเภอไม่ซ้ำภายในจังหวัดเดียวกัน", () => {
  // ชื่อคือกุญแจของ URL — ถ้าซ้ำ จะมีสองหน้าที่ path เดียวกันแล้วเหลือหน้าเดียว
  const provinces = new Set(PROVINCES.map((province) => province.name));
  assert.equal(provinces.size, PROVINCES.length);

  for (const province of PROVINCES) {
    const amphoes = new Set(province.amphoes.map((amphoe) => amphoe.name));
    assert.equal(amphoes.size, province.amphoes.length, province.name);
  }
});

test("ทุกตำบลมีรหัสไปรษณีย์ 5 หลักที่ใช้ได้จริง", () => {
  for (const province of PROVINCES) {
    for (const amphoe of province.amphoes) {
      assert.ok(amphoe.tambons.length > 0, `${province.name}/${amphoe.name} ว่าง`);

      for (const tambon of amphoe.tambons) {
        assert.ok(
          Number.isInteger(tambon.postcode) &&
            tambon.postcode >= 10000 &&
            tambon.postcode <= 99999,
          `${province.name}/${amphoe.name}/${tambon.name} = ${tambon.postcode}`,
        );
        assert.notEqual(tambon.name.trim(), "");
      }
    }
  }
});

test("ชื่อทุกระดับต้องไม่มีอักขระที่กวน URL", () => {
  // ชื่อถูกเอาไปต่อเป็น path ตรงๆ ถ้ามี / หรือ # หรือช่องว่างปนมา path จะเพี้ยน
  const hostile = /[\s/?#%&]/;

  for (const province of PROVINCES) {
    assert.doesNotMatch(province.name, hostile, province.name);
    for (const amphoe of province.amphoes) {
      assert.doesNotMatch(amphoe.name, hostile, `${province.name}/${amphoe.name}`);
    }
  }
});

test("ขนาดข้อมูลอยู่ในระดับที่คาดไว้", () => {
  // ตัวเลขนี้เท่ากับจำนวนหน้าที่ build จะสร้าง ถ้ามันกระโดดขึ้นเป็นหมื่น
  // แปลว่ามีคนเปลี่ยนโครงข้อมูลโดยไม่ได้ตั้งใจ
  const amphoes = PROVINCES.reduce(
    (total, province) => total + province.amphoes.length,
    0,
  );
  const tambons = PROVINCES.reduce(
    (total, province) => total + countTambons(province),
    0,
  );

  assert.equal(amphoes, 928);
  assert.ok(tambons > 7_000 && tambons < 8_000, `${tambons}`);
});

test("ค้นหาจังหวัดและอำเภอด้วยชื่อได้", () => {
  const province = findProvince("เชียงราย");
  assert.ok(province !== undefined);

  const amphoe = findAmphoe(province, "เมืองเชียงราย");
  assert.ok(amphoe !== undefined);
  assert.ok(postcodesOf(amphoe).includes(57000));

  assert.equal(findProvince("ไม่มีจังหวัดนี้"), undefined);
  assert.equal(findAmphoe(province, "ไม่มีอำเภอนี้"), undefined);
});

test("รหัสไปรษณีย์ของจังหวัดถูกยุบไม่ซ้ำและเรียงจากน้อยไปมาก", () => {
  for (const province of PROVINCES) {
    const codes = provincePostcodes(province);

    assert.ok(codes.length > 0, province.name);
    assert.deepEqual(codes, [...new Set(codes)].sort((a, b) => a - b));
  }
});

test("ต้องบอกที่มาและสัญญาอนุญาตของข้อมูลได้เสมอ", () => {
  // หน้าเว็บแสดงค่าพวกนี้จริง การใช้ข้อมูลของคนอื่นโดยไม่บอกที่มาคือสิ่งที่
  // ไม่ควรทำ ต่อให้สัญญาอนุญาตจะไม่ได้บังคับก็ตาม
  assert.match(DATA_SOURCE.url, /^https:\/\//);
  assert.notEqual(DATA_SOURCE.license.trim(), "");
  assert.notEqual(DATA_SOURCE.fetchedAt.trim(), "");
});
