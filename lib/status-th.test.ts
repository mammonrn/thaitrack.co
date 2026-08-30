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
  translatePlaceDetailed,
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

/* ---------------- เคสที่เคยหลุดไปแสดงผิดบนหน้าเว็บจริง ---------------- */

test("บรรทัดที่เคยโผล่เป็นอังกฤษเต็ม หรือไทยชนอังกฤษ ต้องแปลจบทั้งประโยค", () => {
  const cases: [string, string][] = [
    // เคยแสดงเป็นอังกฤษเต็มบรรทัด
    [
      "[Delivery Driver Assigned] Delivery driver has been assigned",
      "มอบหมายพนักงานนำจ่ายแล้ว",
    ],
    // เคยแสดงเป็นอังกฤษเต็มบรรทัด เพราะมีชื่อสถานที่ไทยอยู่ในประโยคอังกฤษ
    [
      "[Enter Last Mile Hub] Parcel has arrived at station :ACRAI-B - เมืองเชียงราย",
      "ถึงสาขา ACRAI-B - เมืองเชียงราย",
    ],
    // เคยแสดงเป็น "ออกจากstation" (ไทยชนอังกฤษ ไม่มีวรรค)
    ["[Departed Station] Parcel has departed station", "ออกจากสาขา"],
    // เคยแสดงเป็น "ถึงstation :NORC-B SPX Express"
    [
      "[Arrived At Station] Parcel has arrived at station :NORC-B SPX Express",
      "ถึงสาขา NORC-B SPX Express",
    ],
    // เคยแสดงเป็น "ถึงstation:Kongjing"
    [
      "[Arrived At Station] Parcel has arrived at station:Kongjing",
      "ถึงสาขา Kongjing",
    ],
    // เคยแสดงเป็น "ออกจากthe origin port: SHENZHEN"
    [
      "[Departed] Parcel has departed from the origin port: SHENZHEN",
      "ออกจากท่าต้นทาง SHENZHEN",
    ],
  ];

  for (const [input, expected] of cases) {
    assert.equal(translateStatusText(input), expected, `แปลผิดที่: ${input}`);
  }
});

test("ผลลัพธ์ต้องไม่มีคำนามทั่วไปภาษาอังกฤษค้างอยู่", () => {
  const generic = /\b(?:station|hub|port|cent(?:er|re)|warehouse|depot|facility|branch)\b/i;

  const inputs = [
    "[Delivery Driver Assigned] Delivery driver has been assigned",
    "[Enter Last Mile Hub] Parcel has arrived at station :ACRAI-B - เมืองเชียงราย",
    "[Departed Station] Parcel has departed station",
    "[Arrived At Station] Parcel has arrived at station :NORC-B SPX Express",
    "[Arrived At Station] Parcel has arrived at station:Kongjing",
    "[Departed] Parcel has departed from the origin port: SHENZHEN",
    "[Transit Warehouse Outbound] [China]Parcel has departed from :Shenzhen sorting centre",
  ];

  for (const input of inputs) {
    const out = translateStatusText(input);
    assert.equal(generic.test(out), false, `ยังมีคำอังกฤษค้าง: ${input} → ${out}`);
  }
});

test("ผลลัพธ์ต้องมีช่องว่างคั่นเสมอตรงรอยต่อไทยกับละติน", () => {
  const clash = /[\u0E00-\u0E7F][A-Za-z0-9]|[A-Za-z0-9][\u0E00-\u0E7F]/;

  const inputs = [
    "[Enter Last Mile Hub] Parcel has arrived at station :ACRAI-B - เมืองเชียงราย",
    "[Arrived At Station] Parcel has arrived at station:Kongjing",
    "[Departed] Parcel has departed from the origin port: SHENZHEN",
    "[Transit Warehouse Inbound] [China]Parcel has arrived at :Shenzhen sorting centre",
  ];

  for (const input of inputs) {
    const out = translateStatusText(input);
    assert.equal(clash.test(out), false, `ไทยชนละติน: ${input} → ${out}`);
  }
});

test("แปลชื่อสถานที่ไม่จบ → fallback ทั้งประโยค ไม่แปลครึ่งเดียว", () => {
  // "depot" ไม่มีคำแปล และ tag ก็ไม่รู้จัก → ต้องคืนต้นฉบับทั้งบรรทัด
  const input = "[Some New Tag] Parcel has arrived at :Chonburi depot";
  assert.equal(translateStatusText(input), input);

  // ถ้ารู้จัก tag ให้ถอยไปใช้คำแปลของ tag แทนการแปลครึ่งประโยค
  assert.equal(
    translateStatusText("[In Transit] Parcel has arrived at :Chonburi depot"),
    "อยู่ระหว่างขนส่ง",
  );
});

test("translatePlaceDetailed บอกได้ว่าแปลจบหรือไม่", () => {
  assert.deepEqual(translatePlaceDetailed("station :ACRAI-B - เมืองเชียงราย"), {
    text: "สาขา ACRAI-B - เมืองเชียงราย",
    complete: true,
  });
  assert.deepEqual(translatePlaceDetailed("station:Kongjing"), {
    text: "สาขา Kongjing",
    complete: true,
  });
  assert.deepEqual(translatePlaceDetailed("the origin port: SHENZHEN"), {
    text: "ท่าต้นทาง SHENZHEN",
    complete: true,
  });
  // คำนามที่ยังไม่รู้จัก → complete = false เพื่อบังคับให้ fallback
  assert.equal(translatePlaceDetailed("Chonburi depot").complete, false);
});

test("คำที่ขึ้นต้นเหมือนคำนามทั่วไป แต่เป็นชื่อเฉพาะ ต้องไม่ถูกตัด", () => {
  // "Portland" ขึ้นต้นด้วย "port" — \b กันไม่ให้กลายเป็น "ท่า land"
  assert.equal(translatePlace("Portland"), "Portland");
  assert.equal(translatePlace("Centerville"), "Centerville");
});
