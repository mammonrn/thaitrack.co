/**
 * เทสต์ความสมบูรณ์ของข้อมูลหน้า landing รายขนส่ง
 *
 * ข้อมูลชุดนี้กลายเป็น URL, meta title, JSON-LD และ sitemap พร้อมกันทั้งหมด
 * แถวที่กรอกไม่ครบจึงไม่ได้พังตอน build แต่ไปโผล่เป็นหน้าที่ Google เก็บไป
 * แล้วมีข้อมูลว่าง ซึ่งกู้ยากกว่ามาก
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  TITLE_MAX,
  fitTitle,
  textLength,
} from "../seo.ts";
import { CARRIER_LANDINGS, findLanding } from "./landing.ts";
import { canTrack } from "./etrackings.ts";

test("slug ไม่ซ้ำกัน", () => {
  const slugs = new Set(CARRIER_LANDINGS.map((entry) => entry.slug));
  assert.equal(slugs.size, CARRIER_LANDINGS.length);
});

test("slug ต้องไม่มีอักขระที่กวน URL", () => {
  for (const entry of CARRIER_LANDINGS) {
    assert.doesNotMatch(entry.slug, /[\s/?#%&]/, entry.slug);
    assert.match(entry.slug, /^เช็คพัสดุ-/, "ต้องขึ้นต้นด้วยคำที่คนค้นหาจริง");
  }
});

test("ทุกแถวต้องมีเนื้อหาครบ ไม่มีช่องว่าง", () => {
  for (const entry of CARRIER_LANDINGS) {
    for (const [field, value] of Object.entries({
      name: entry.name,
      heading: entry.heading,
      fullName: entry.fullName,
      intro: entry.intro,
      placeholder: entry.placeholder,
      numberFormat: entry.numberFormat,
      description: entry.description,
    })) {
      assert.notEqual(value.trim(), "", `${entry.slug} ขาด ${field}`);
    }

    assert.ok(entry.faqs.length >= 3, `${entry.slug} มี FAQ น้อยเกินไป`);
    for (const faq of entry.faqs) {
      assert.notEqual(faq.question.trim(), "");
      assert.notEqual(faq.answer.trim(), "");
    }
  }
});

test("คำอธิบายยาวพอจะเป็น meta description ที่ใช้ได้จริง", () => {
  for (const entry of CARRIER_LANDINGS) {
    // สั้นกว่านี้ Google มักเขียนใหม่เองโดยดึงข้อความจากหน้ามาแทน
    // ยาวกว่านี้ก็ถูกตัดกลางประโยค — นับเป็นตัวอักษรจริง ไม่ใช่ code unit
    const length = textLength(entry.description);

    assert.ok(length >= DESCRIPTION_MIN, `${entry.slug} สั้นไป (${length})`);
    assert.ok(length <= DESCRIPTION_MAX, `${entry.slug} ยาวไป (${length})`);
  }
});

test("title อยู่ในความยาวที่ไม่ถูกตัดกลางคำ", () => {
  for (const entry of CARRIER_LANDINGS) {
    const title = fitTitle(`${entry.heading} ด้วยเลขพัสดุ`);
    assert.ok(textLength(title) <= TITLE_MAX, `${entry.slug}: ${title}`);
  }
});

test("หัวข้อภาษาอังกฤษต้องเว้นวรรคหลังคำไทย", () => {
  // "เช็คพัสดุFlash" อ่านแล้วสะดุดและดูเหมือนพิมพ์ผิด
  for (const entry of CARRIER_LANDINGS) {
    assert.doesNotMatch(
      entry.heading,
      /[฀-๿][A-Za-z]/,
      `${entry.slug}: ${entry.heading}`,
    );
  }
});

test("courierCode ที่ใส่ไว้ต้องเป็นรหัสที่ ETrackings รองรับจริง", () => {
  // ถ้าใส่รหัสที่ปลายทางไม่รู้จัก การส่ง hint ไปจะกลายเป็นการทิ้งโควตาเปล่าๆ
  for (const entry of CARRIER_LANDINGS) {
    if (entry.courierCode === null) continue;

    assert.ok(
      canTrack("TH123456", entry.courierCode),
      `${entry.slug}: ${entry.courierCode} ไม่อยู่ใน COURIER_MAP`,
    );
  }
});

test("ค้นหา landing ด้วย slug ได้ และ slug ที่ไม่มีคืน undefined", () => {
  assert.equal(findLanding("เช็คพัสดุ-flash")?.name, "Flash Express");
  assert.equal(findLanding("เช็คพัสดุ-ไม่มีเจ้านี้"), undefined);
});
