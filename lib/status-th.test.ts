/**
 * เทสต์การแปลสถานะเป็นภาษาไทย
 *
 * ข้อความตัวอย่างคัดมาจากผลลัพธ์จริงของ SPX/Shopee ผ่าน Track123
 * (เลข SPXTH060984526215) และของไปรษณีย์ไทย
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseStatusText,
  translatePlace,
  translateStatusText,
} from "./status-th.ts";

test("แยก tag ประเทศ และประโยคออกจากกันได้", () => {
  assert.deepEqual(
    parseStatusText(
      "[Transit Warehouse Inbound] [China]Parcel has arrived at :Shenzhen sorting centre",
    ),
    {
      tag: "Transit Warehouse Inbound",
      country: "China",
      body: "Parcel has arrived at :Shenzhen sorting centre",
    },
  );
});

test("ข้อความที่ไม่มีวงเล็บเลย → เป็นประโยคล้วน", () => {
  assert.deepEqual(parseStatusText("Parcel has been delivered"), {
    tag: null,
    country: null,
    body: "Parcel has been delivered",
  });
});

/* ---------------- เคสแปลได้ ---------------- */

test("แปลข้อความจริงจากเคส SPX ได้ครบทุกบรรทัด", () => {
  const cases: [string, string][] = [
    ["[Delivered] Parcel has been delivered", "ส่งถึงแล้ว"],
    [
      "[Export Customs Cleared] [China]Parcel has cleared export customs",
      "ผ่านพิธีการศุลกากรขาออกแล้ว (จีน)",
    ],
    [
      "[Forwarder Received Parcel] [China]Parcel has been handed over to delivery service provider",
      "ส่งมอบให้ผู้ให้บริการขนส่งแล้ว (จีน)",
    ],
    [
      "[Transit Warehouse Outbound] [China]Parcel has departed from :Shenzhen sorting centre",
      "ออกจากศูนย์คัดแยก Shenzhen (จีน)",
    ],
    [
      "[Transit Warehouse Inbound] [China]Parcel has arrived at :Shenzhen sorting centre",
      "ถึงศูนย์คัดแยก Shenzhen (จีน)",
    ],
    [
      "[Pickup From Cross Border Seller] [China]Sender has shipped your parcel",
      "ผู้ขายส่งพัสดุแล้ว (จีน)",
    ],
    [
      "[Manifested] [China]Sender is preparing to ship your parcel",
      "ผู้ส่งกำลังเตรียมพัสดุ (จีน)",
    ],
  ];

  for (const [input, expected] of cases) {
    assert.equal(translateStatusText(input), expected, `แปลผิดที่: ${input}`);
  }
});

test("tag เที่ยวบินที่พบในเคสจริง แปลได้", () => {
  assert.equal(
    translateStatusText("[Export Flight Departed] [China]Parcel has departed on flight"),
    "พัสดุขึ้นเครื่องแล้ว (จีน)",
  );
});

test("แปลไม่ได้ทั้งประโยค แต่รู้จัก tag → ใช้คำแปลของ tag", () => {
  assert.equal(
    translateStatusText("[Out For Delivery] Courier is on the way to you now"),
    "กำลังนำจ่าย",
  );
});

test("ชื่อสถานที่เฉพาะไม่ถูกแปล แต่คำนามต่อท้ายถูกแปลและสลับมาไว้หน้า", () => {
  assert.equal(translatePlace("Shenzhen sorting centre"), "ศูนย์คัดแยก Shenzhen");
  assert.equal(translatePlace("Shenzhen Bao'an International Airport"), "สนามบิน Shenzhen Bao'an");
  assert.equal(translatePlace("ShiYan warehouse"), "คลังสินค้า ShiYan");
  // ไม่มีคำนามที่รู้จักต่อท้าย → คงไว้ทั้งก้อน
  assert.equal(translatePlace("ShiYan"), "ShiYan");
});

/* ---------------- เคส fallback ---------------- */

test("ข้อความที่ไม่รู้จักเลย → คืนต้นฉบับ ไม่กลืนหาย", () => {
  const unknown = "[Weird New Status] Something we have never seen before";
  assert.equal(translateStatusText(unknown), unknown);
});

test("ประโยคล้วนที่ไม่รู้จักและไม่มี tag → คืนต้นฉบับ", () => {
  assert.equal(
    translateStatusText("Parcel is doing something unusual"),
    "Parcel is doing something unusual",
  );
});

test("ข้อความว่าง → คืนค่าว่าง ไม่พัง", () => {
  assert.equal(translateStatusText(""), "");
  assert.equal(translateStatusText("   "), "");
});

/* ---------------- เคสข้อความผสม ---------------- */

test("ข้อความที่เป็นภาษาไทยอยู่แล้ว (ไปรษณีย์ไทย) ต้องไม่ถูกแตะ", () => {
  for (const text of [
    "รับฝากจากผู้ฝากส่ง",
    "อยู่ระหว่างการนำจ่าย",
    "เซ็นรับพัสดุเรียบร้อย",
  ]) {
    assert.equal(translateStatusText(text), text);
  }
});

test("ข้อความไทยผสมอังกฤษ ต้องคงไว้ทั้งก้อน ไม่แปลครึ่งเดียว", () => {
  const mixed = "ถึงศูนย์คัดแยก Shenzhen sorting centre";
  assert.equal(translateStatusText(mixed), mixed);
});

test("tag รู้จักแต่พิมพ์ตัวเล็กใหญ่ต่างกัน → ยังแปลได้", () => {
  assert.equal(translateStatusText("[DELIVERED] whatever happens here"), "ส่งถึงแล้ว");
  assert.equal(translateStatusText("[delivered] whatever happens here"), "ส่งถึงแล้ว");
});

test("ประเทศที่ไม่รู้จัก → คงชื่อเดิมไว้ ไม่ทำให้แปลล้มเหลว", () => {
  assert.equal(
    translateStatusText("[Delivered] [Narnia]Parcel has been delivered"),
    "ส่งถึงแล้ว (Narnia)",
  );
});
