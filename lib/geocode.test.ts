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
  EXACT_MAX_METERS,
  classifyAccuracy,
  isAreaResult,
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

test("ไกลแค่ไหนก็ยังปักหมุดได้ ไม่มีเพดานระยะทางอีกแล้ว", () => {
  // เจตนาของ K1: มีพิกัดที่ผ่านด่านคุณภาพเมื่อไร ก็โชว์เมื่อนั้น
  // เดิมเกิน 12 กม. แล้วกลายเป็น area ซึ่งแปลว่าไม่ปักหมุดเลย
  for (const meters of [12_001, 40_000, 250_000, 1_000_000]) {
    assert.equal(
      classifyAccuracy({ accuracyMeters: meters, areaOnly: false }),
      "coarse",
      `${meters} ม.`,
    );
  }
});

test("ระยะทางไม่มีทางทำให้ได้ area — ต่อให้ไกลระดับครึ่งประเทศ", () => {
  // ด่านเดียวที่ยังคืน area ได้คือ areaOnly ซึ่งเป็นคุณภาพของ geocode
  // ไม่ใช่ระยะทาง สองเรื่องนี้ต้องไม่ปนกันอีก
  assert.notEqual(
    classifyAccuracy({ accuracyMeters: Number.MAX_SAFE_INTEGER, areaOnly: false }),
    "area",
  );
});

test("เป็นเขตปกครอง → area ต่อให้กรอบจะเล็กแค่ไหน", () => {
  // อำเภอเล็กๆ ที่กรอบบังเอิญเล็กก็ยังเป็นอำเภอ จุดกึ่งกลางของมันไม่ใช่
  // ที่ตั้งของอะไรทั้งนั้น
  assert.equal(classifyAccuracy({ accuracyMeters: 10, areaOnly: true }), "area");
});

test("ด่าน areaOnly ต้องรอดจากการตัดเพดาน — เคสจริงจาก production", () => {
  // สองค่านี้คือของจริงจาก log: สาขา SOCN ได้ radius 209 ม. และอีกที่อยู่หนึ่ง
  // ได้ 82 ม. ทั้งคู่ถูกปฏิเสธด้วย areaOnly ไม่ใช่ด้วยเพดาน 12 กม.
  // ถ้าเทสต์นี้ตก แปลว่าการตัดเพดานเผลอไปถอดด่าน types[] ออกด้วย ซึ่งจะทำให้
  // หมุดกลางอำเภอ/จังหวัดกลับมาปักทับบ้านคนอื่นเหมือนบั๊กใน migration 0004
  assert.equal(classifyAccuracy({ accuracyMeters: 209, areaOnly: true }), "area");
  assert.equal(classifyAccuracy({ accuracyMeters: 82, areaOnly: true }), "area");
});

test("ไม่รู้ความละเอียด (แถวเก่าใน cache) → coarse ซึ่งเป็นถ้อยคำที่คลุมเครือที่สุด", () => {
  // เดาว่าแม่นคือการรับรองสิ่งที่เราไม่รู้ — ยอมปักหมุดให้ แต่ต้องติดป้าย
  // และต้องเป็นป้ายที่ไม่รับประกันระยะใดๆ
  assert.equal(classifyAccuracy({ accuracyMeters: null, areaOnly: null }), "coarse");
});

/* ------------------------------ เพดาน ------------------------------ */

test("เพดานเก่าไม่มีผลอะไรอีกแล้ว ต่อให้ยังตั้ง env ค้างไว้", (t) => {
  // ผู้ดูแลระบบที่ตั้ง GEOCODE_MAX_ACCURACY_METERS ไว้ตั้งแต่ก่อนตัดเพดาน
  // ต้องไม่เจอพฤติกรรมแปลกๆ ค่านี้กลายเป็นตัวแปรที่ไม่มีใครอ่านแล้ว
  t.after(() => {
    delete process.env.GEOCODE_MAX_ACCURACY_METERS;
  });

  process.env.GEOCODE_MAX_ACCURACY_METERS = "1000";
  assert.equal(
    classifyAccuracy({ accuracyMeters: 3_000, areaOnly: false }),
    "coarse",
  );
});
