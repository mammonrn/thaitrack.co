/**
 * เทสต์การวัดความละเอียดของพิกัด
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือเส้นแบ่งระหว่าง "จุด" กับ "พื้นที่" ซึ่งเป็น
 * เส้นเดียวที่กันไม่ให้หมุดกลางอำเภอกลับเข้ามาในระบบอีก เกณฑ์เดิมใช้ชนิดของ
 * คำตอบที่ Google ส่งมาแล้วพัง (ที่อยู่ไทยไม่เคยได้ ROOFTOP เลย) รอบนี้จึงวัด
 * ขนาดจริง — ถ้ามีใครแก้จนพิกัดระดับอำเภอผ่านได้อีก ต้องพังที่นี่ก่อน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPROXIMATE_MAX_METERS,
  DEFAULT_MAX_ACCURACY_METERS,
  EXACT_MAX_METERS,
  classifyAccuracy,
  isAreaResult,
  readMaxAccuracyMeters,
  viewportRadiusMeters,
} from "./geocode.ts";

/** กรอบสี่เหลี่ยมรอบจุดหนึ่ง กว้างยาวเท่ากันโดยประมาณ */
function boxAround(lat: number, lng: number, spanDegrees: number) {
  return {
    northeast: { lat: lat + spanDegrees / 2, lng: lng + spanDegrees / 2 },
    southwest: { lat: lat - spanDegrees / 2, lng: lng - spanDegrees / 2 },
  };
}

/* ------------------------- การวัดขนาดกรอบ ------------------------- */

test("กรอบเล็กระดับบ้านเลขที่ → รัศมีหลักร้อยเมตร", () => {
  // 0.002 องศา ≈ 222 ม. ต่อด้าน → ครึ่งเส้นทแยงมุมราว 150 ม.
  const radius = viewportRadiusMeters(boxAround(19.98, 99.87, 0.002));

  assert.ok(radius > 100 && radius < 200, `ได้ ${radius}`);
});

test("กรอบระดับอำเภอ → รัศมีหลักสิบกิโลเมตร", () => {
  // 0.3 องศา ≈ 33 กม. ต่อด้าน
  const radius = viewportRadiusMeters(boxAround(19.98, 99.87, 0.3));

  assert.ok(radius > 15_000, `ได้ ${radius}`);
});

test("อ่านกรอบไม่ได้ → ถือว่าใหญ่จนวัดไม่ได้ ไม่ใช่ศูนย์", () => {
  // การเดาว่าเล็กแปลว่าเรารับรองความแม่นที่ไม่เคยวัด ซึ่งอันตรายกว่ามาก
  for (const bad of [undefined, null, {}, { northeast: { lat: 1 } }, "x"]) {
    assert.equal(viewportRadiusMeters(bad), Number.POSITIVE_INFINITY);
  }
});

/* --------------------- ผลลัพธ์ที่เป็น "พื้นที่" --------------------- */

test("types เป็นเขตปกครองระดับอำเภอขึ้นไป → เป็นพื้นที่", () => {
  for (const type of [
    "country",
    "administrative_area_level_1",
    "administrative_area_level_2",
  ]) {
    assert.equal(
      isAreaResult({ types: [type, "political"], partialMatch: false }),
      true,
      type,
    );
  }
});

test("Google บอกว่าจับได้ไม่ครบ → เป็นพื้นที่ ไม่ว่า types จะเป็นอะไร", () => {
  assert.equal(
    isAreaResult({ types: ["street_address"], partialMatch: true }),
    true,
  );
});

test("ที่อยู่หรือสถานที่จริง → ไม่ใช่พื้นที่", () => {
  for (const types of [
    ["street_address"],
    ["premise"],
    ["route"],
    ["sublocality_level_1", "sublocality", "political"],
    ["administrative_area_level_3", "political"],
  ]) {
    assert.equal(isAreaResult({ types, partialMatch: false }), false, `${types}`);
  }
});

/* -------------------------- ชั้นความละเอียด -------------------------- */

test("เล็กกว่าเกณฑ์ 'เป๊ะ' → exact", () => {
  assert.equal(
    classifyAccuracy({ accuracyMeters: EXACT_MAX_METERS - 1, areaOnly: false }),
    "exact",
  );
});

test("คลาดเคลื่อนราวหนึ่งกิโล → approximate", () => {
  assert.equal(
    classifyAccuracy({ accuracyMeters: APPROXIMATE_MAX_METERS - 1, areaOnly: false }),
    "approximate",
  );
});

test("คลาดเคลื่อนหลายกิโล → coarse (ถ้อยคำต้องต่างจาก approximate)", () => {
  // ข้อมูลจริง: ที่อยู่ที่ละเอียดถึงบ้านเลขที่ยังได้กรอบ 8.3 กม.
  // ถ้าใช้ถ้อยคำเดียวกับ 200 ม. ผู้ใช้จะเชื่อหมุดเกินความจริงไปหลายกิโล
  assert.equal(
    classifyAccuracy({ accuracyMeters: 8_299, areaOnly: false }),
    "coarse",
  );
});

test("ที่อยู่ไทยแบบเต็มยศต้องผ่านเกณฑ์ได้จริง", () => {
  // เพดานรุ่นแรก 5 กม. ทำให้ค่านี้ตกทุกครั้ง การเก็บพิกัดสาขาจึงไม่เคยทำงาน
  assert.notEqual(
    classifyAccuracy({ accuracyMeters: 8_299, areaOnly: false }),
    "area",
  );
});

test("เกินเพดาน → area (ห้ามปักหมุด)", () => {
  assert.equal(
    classifyAccuracy({
      accuracyMeters: DEFAULT_MAX_ACCURACY_METERS + 1,
      areaOnly: false,
    }),
    "area",
  );
});

test("เป็นเขตปกครอง → area ต่อให้กรอบจะเล็กแค่ไหน", () => {
  // อำเภอเล็กๆ ที่กรอบบังเอิญเล็กก็ยังเป็นอำเภอ จุดกึ่งกลางของมันไม่ใช่
  // ที่ตั้งของอะไรทั้งนั้น
  assert.equal(classifyAccuracy({ accuracyMeters: 10, areaOnly: true }), "area");
});

test("ไม่รู้ความละเอียด (แถวเก่าใน cache) → coarse ซึ่งเป็นถ้อยคำที่คลุมเครือที่สุด", () => {
  // เดาว่าแม่นคือการรับรองสิ่งที่เราไม่รู้ — ยอมปักหมุดให้ แต่ต้องติดป้าย
  // และต้องเป็นป้ายที่ไม่รับประกันระยะใดๆ
  assert.equal(classifyAccuracy({ accuracyMeters: null, areaOnly: null }), "coarse");
});

/* ------------------------------ เพดาน ------------------------------ */

test("ไม่ได้ตั้ง env → ใช้ค่าเริ่มต้น", () => {
  assert.equal(readMaxAccuracyMeters(), DEFAULT_MAX_ACCURACY_METERS);
});

test("ตั้ง env แล้วมีผลกับของที่ cache ไว้แล้วทันที", (t) => {
  t.after(() => {
    delete process.env.GEOCODE_MAX_ACCURACY_METERS;
  });

  const measured = { accuracyMeters: 3_000, areaOnly: false };
  assert.equal(classifyAccuracy(measured), "coarse");

  // ชั้นถูกคำนวณสดจากค่าที่วัดไว้ ไม่ได้เก็บคำตัดสินลงฐานข้อมูล
  // การปรับเพดานจึงไม่ต้องล้าง cache และไม่ต้องยิงถาม Google ใหม่
  process.env.GEOCODE_MAX_ACCURACY_METERS = "1000";
  assert.equal(classifyAccuracy(measured), "area");
});

test("ค่าที่ใช้ไม่ได้ใน env → กลับไปใช้ค่าเริ่มต้น ไม่กลายเป็นศูนย์", (t) => {
  t.after(() => {
    delete process.env.GEOCODE_MAX_ACCURACY_METERS;
  });

  for (const bad of ["", "  ", "abc", "0", "-1"]) {
    process.env.GEOCODE_MAX_ACCURACY_METERS = bad;
    assert.equal(readMaxAccuracyMeters(), DEFAULT_MAX_ACCURACY_METERS, bad);
  }
});
