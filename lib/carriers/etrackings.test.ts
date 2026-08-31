/**
 * เทสต์การแปลง response ของ ETrackings เป็นรูปแบบกลาง
 *
 * ข้อมูลตัวอย่างคัดลอกมาจากเอกสารจริง (https://apps.etrackings.com/docs/trackings)
 * ไม่ได้แต่งขึ้นเอง เพราะประเด็นทั้งหมดของเทสต์ชุดนี้คือ "เราอ่านของเขาถูกไหม"
 *
 * สองเรื่องที่เสี่ยงที่สุด:
 *   1. ชื่อสถานที่ฝังอยู่ท้าย description หลัง " - " ต้องแยกออกมาให้ตรง
 *      ไม่งั้นการจัดกลุ่มไทม์ไลน์ตามสถานที่ของเราจะใช้ไม่ได้ และถ้าแยกพลาด
 *      จะไปตัดเนื้อความทิ้ง ซึ่งแย่กว่าไม่แยกเลย
 *   2. โควตา 50 ครั้ง/เดือน — ต้องไม่มีทางไหนที่ยิงโดยไม่จำเป็น
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanBranchAddress,
  parseETrackingsTime,
  resolveCourier,
  splitDescription,
  toSensitiveDetails,
  toShipmentDetails,
  toTrackingResult,
  type ETrackingsData,
} from "./etrackings.ts";

/** ข้อมูลจริงจากเอกสาร — เลข SHP5054369172 ของ Kerry Express */
function sampleData(): ETrackingsData {
  return {
    trackingNo: "SHP5054369172",
    courier: "เคอรี่ เอ็กซ์เพรส",
    courierKey: "kex-express",
    status: "ON_DELIVERED",
    currentStatus:
      "13:59 เคอรี่จัดส่งพัสดุของคุณเรียบร้อยแล้ว - คานหาม, พระนครศรีอยุธยา",
    detail: {
      sender: "ETrackings****",
      recipient: "สหรัก ม******",
      originProvince: "นนทบุรี",
      destinationProvince: "พระนครศรีอยุธยา",
      signer: "สหรัก ม******",
      dueDate: "2021-02-10",
      cashOnDelivery: "0",
      isPayCashOnDelivery: false,
      deliveryStaffName: "",
      originCity: "",
      destinationCity: "",
      deliveryType: "Normal",
    },
    timelines: [
      {
        date: "2021-02-10",
        details: [
          {
            dateTime: "2021-02-10T13:59:56+07:00",
            date: "2021-02-10",
            time: "13:59",
            status: "ON_DELIVERED",
            description:
              "13:59 เคอรี่จัดส่งพัสดุของคุณเรียบร้อยแล้ว - คานหาม, พระนครศรีอยุธยา",
          },
          {
            dateTime: "2021-02-10T08:57:06+07:00",
            date: "2021-02-10",
            time: "08:57",
            status: "ON_SHIPPING",
            description:
              "08:57 พนักงานกำลังจัดส่งพัสดุของคุณ - คานหาม, พระนครศรีอยุธยา",
          },
        ],
      },
      {
        date: "2021-02-08",
        details: [
          {
            dateTime: "2021-02-08T22:03:55+07:00",
            date: "2021-02-08",
            time: "22:03",
            status: "ON_OTHER_STATUS",
            description:
              "22:03 พัสดุของคุณอยู่ระหว่างขนส่ง - ศูนย์คัดแยกสินค้าสมุทรสาคร, กรุงเทพมหานคร",
          },
          {
            dateTime: "2021-02-08T13:35:59+07:00",
            date: "2021-02-08",
            time: "13:35",
            status: "ON_PICKED_UP",
            description: "13:35 เคอรี่เข้ารับพัสดุแล้ว",
          },
        ],
      },
    ],
  };
}

/* --------------------- แยกสถานที่ท้าย description --------------------- */

test("แยกสถานที่ที่ห้อยท้ายออกจากเนื้อความ", () => {
  assert.deepEqual(
    splitDescription(
      "22:03 พัสดุของคุณอยู่ระหว่างขนส่ง - ศูนย์คัดแยกสินค้าสมุทรสาคร, กรุงเทพมหานคร",
    ),
    {
      description: "พัสดุของคุณอยู่ระหว่างขนส่ง",
      location: "ศูนย์คัดแยกสินค้าสมุทรสาคร, กรุงเทพมหานคร",
      address: "",
    },
  );
});

test("ตัดเวลาที่นำหน้าออก เพราะซ้ำกับเวลาที่แสดงอยู่แล้ว", () => {
  assert.equal(
    splitDescription("13:35 เคอรี่เข้ารับพัสดุแล้ว").description,
    "เคอรี่เข้ารับพัสดุแล้ว",
  );
});

test("ไม่มีสถานที่ต่อท้าย → ไม่แยก และไม่ตัดเนื้อความทิ้ง", () => {
  assert.deepEqual(splitDescription("13:35 เคอรี่เข้ารับพัสดุแล้ว"), {
    description: "เคอรี่เข้ารับพัสดุแล้ว",
    location: "",
    address: "",
  });
});

test("ส่วนท้ายที่ไม่เข้ารูป 'ที่หนึ่ง, จังหวัดหนึ่ง' → ไม่แยก ปล่อยไว้ทั้งก้อน", () => {
  // เดาผิดแล้วตัดเนื้อความทิ้งแย่กว่าปล่อยให้สถานที่ติดอยู่ในประโยค
  const notLocations = [
    "พัสดุถูกตีกลับ - เนื่องจากผู้รับปฏิเสธการรับพัสดุและไม่ติดต่อกลับภายในเวลาที่กำหนดไว้",
    "อัปเดตสถานะ - 12345",
    "ข้อความ - ไม่มีคอมมาเลย",
  ];

  for (const raw of notLocations) {
    assert.equal(splitDescription(raw).location, "", raw);
  }
});

test("มี ' - ' หลายที่ → ใช้ตัวท้ายสุด และเนื้อความไม่หาย", () => {
  const result = splitDescription(
    "08:10 พัสดุถึงสาขา - เตรียมจัดส่ง - คานหาม, พระนครศรีอยุธยา",
  );

  assert.equal(result.description, "พัสดุถึงสาขา - เตรียมจัดส่ง");
  assert.equal(result.location, "คานหาม, พระนครศรีอยุธยา");
});

/* ---------------------------- เวลา ---------------------------- */

test("อ่าน dateTime มาตรฐานได้", () => {
  const parsed = parseETrackingsTime({ dateTime: "2021-02-10T13:59:56+07:00" });

  assert.ok(parsed !== null);
  assert.equal(parsed.iso, new Date("2021-02-10T13:59:56+07:00").toISOString());
});

test("อ่าน dateTime ที่มีช่องว่างรอบโคลอนได้ (แบบที่เอกสารแสดง)", () => {
  const parsed = parseETrackingsTime({
    dateTime: "2021-02-10T13: 59: 56+07: 00",
  });

  assert.ok(parsed !== null);
  assert.equal(parsed.iso, new Date("2021-02-10T13:59:56+07:00").toISOString());
});

test("ไม่มี dateTime → ประกอบจาก date + time ตามเวลาไทย", () => {
  const parsed = parseETrackingsTime({ date: "2021-02-10", time: "13:59" });

  assert.ok(parsed !== null);
  assert.equal(parsed.iso, new Date("2021-02-10T13:59:00+07:00").toISOString());
});

test("อ่านเวลาไม่ได้เลย → คืน null ไม่เดา", () => {
  assert.equal(parseETrackingsTime({}), null);
  assert.equal(parseETrackingsTime({ dateTime: "ไม่ใช่เวลา" }), null);
});

/* ------------------------ แปลงเป็นรูปแบบกลาง ------------------------ */

test("คลี่ timelines ที่จัดกลุ่มตามวันออกเป็นรายการเรียงเดี่ยว", () => {
  const result = toTrackingResult("SHP5054369172", sampleData());

  assert.equal(result.events.length, 4);
  // เรียงจากเก่าไปใหม่ ตามสัญญาของ TrackingResult
  assert.equal(result.events[0].description, "เคอรี่เข้ารับพัสดุแล้ว");
  assert.equal(
    result.events.at(-1)?.description,
    "เคอรี่จัดส่งพัสดุของคุณเรียบร้อยแล้ว",
  );
});

test("สถานที่ถูกแยกใส่ฟิลด์ location ให้ระบบจัดกลุ่มของเราใช้ได้", () => {
  const result = toTrackingResult("SHP5054369172", sampleData());

  assert.equal(
    result.events.at(-1)?.location,
    "คานหาม, พระนครศรีอยุธยา",
  );
  assert.equal(result.events[0].location, "", "อันที่ไม่มีสถานที่ต้องเป็นค่าว่าง");
});

test("รหัสสถานะ map เข้าสถานะกลางของเรา", () => {
  const cases: [string, string][] = [
    ["ON_DELIVERED", "delivered"],
    ["ON_SHIPPING", "out_for_delivery"],
    ["ON_PICKED_UP", "in_transit"],
    ["ON_OTHER_STATUS", "in_transit"],
    ["ON_UNABLE_TO_SEND", "exception"],
  ];

  for (const [code, expected] of cases) {
    const result = toTrackingResult("X", { ...sampleData(), status: code });
    assert.equal(result.status, expected, code);
  }
});

test("รหัสสถานะที่ไม่รู้จัก → ถือว่าอยู่ระหว่างขนส่ง ไม่พัง", () => {
  const result = toTrackingResult("X", {
    ...sampleData(),
    status: "ON_SOMETHING_NEW",
  });

  assert.equal(result.status, "in_transit");
});

test("ใช้ชื่อขนส่งจริง ไม่ใช่ชื่อ ETrackings", () => {
  const result = toTrackingResult("SHP5054369172", sampleData());

  assert.equal(result.carrierName, "เคอรี่ เอ็กซ์เพรส");
  assert.equal(result.carrierCode, "kex-express");
});

test("ข้อความไทยต้องไม่ถูกแตะ — ข้อมูลมาเป็นไทยอยู่แล้ว", () => {
  const result = toTrackingResult("SHP5054369172", sampleData());

  for (const event of result.events) {
    assert.doesNotMatch(event.description, /[A-Za-z]/, event.description);
  }
});

test("timelines ว่าง → ไม่พัง คืนรายการว่าง", () => {
  const result = toTrackingResult("X", { ...sampleData(), timelines: [] });

  assert.deepEqual(result.events, []);
  assert.equal(result.lastUpdated, null);
});

/* ------------------------ รายละเอียดการจัดส่ง ------------------------ */

test("ดึงเฉพาะฟิลด์ที่มีค่าจริง ฟิลด์ว่างถูกตัดทิ้ง", () => {
  const shipment = toShipmentDetails(sampleData().detail);

  assert.ok(shipment !== null);
  assert.equal(shipment.originProvince, "นนทบุรี");
  assert.equal(shipment.destinationProvince, "พระนครศรีอยุธยา");
  assert.equal(shipment.dueDate, "2021-02-10");
  assert.equal(shipment.deliveryStaffName, null, 'ตัวอย่างส่ง "" มา');
});

test('cashOnDelivery = "0" แปลว่าไม่มีเก็บเงินปลายทาง ไม่ใช่ยอดศูนย์บาท', () => {
  const shipment = toShipmentDetails(sampleData().detail);
  assert.equal(shipment?.cashOnDelivery, null);

  const withCod = toShipmentDetails({
    ...sampleData().detail,
    cashOnDelivery: "1250",
  });
  assert.equal(withCod?.cashOnDelivery, "1250");
});

test("ไม่มีฟิลด์ไหนมีค่าเลย → คืน null ไม่ใช่ object ว่าง", () => {
  assert.equal(toShipmentDetails({}), null);
  assert.equal(toShipmentDetails(null), null);
  assert.equal(
    toShipmentDetails({ originProvince: "", destinationProvince: "  " }),
    null,
  );
});

/** ข้อมูลจริงแบบที่ Flash ส่งมา — ชื่อคนไม่ถูกปิดบังมาให้เลย */
function unmaskedDetail() {
  return {
    ...sampleData().detail,
    sender: "amonthepnontarug",
    recipient: "ภูมิ ธรรมสอน",
    signer: "แผนกต้อนรับ",
    deliveryType: "On-Time Delivery",
    courierCallCenterPhoneNumber: "1436",
    signerImageURL: "https://cdn.example.com/proof/abc.jpg",
  };
}

test("ชื่อผู้รับกับผู้เซ็นรับต้องถูกปิดบังตั้งแต่ตอนแปลงข้อมูลเข้าระบบ", () => {
  // ใครที่เห็นเลขพัสดุก็ค้นได้โดยไม่ต้องพิสูจน์ตัวตน ชื่อเต็มของคนรับจึงต้อง
  // ไม่มีทางออกไปถึงใคร — ปิดที่ต้นทางแข็งกว่าไปกรองตอนขาออกทีละทาง
  const shipment = toShipmentDetails(unmaskedDetail());

  assert.equal(shipment?.recipientMasked, "ภูมิ ธ***");
  assert.equal(shipment?.signerMasked, "แผน***");
});

test("ชื่อเต็มต้องไม่หลุดออกไปกับผลลัพธ์ทั้งก้อน", () => {
  const result = toTrackingResult("SHP5054369172", {
    ...sampleData(),
    detail: unmaskedDetail(),
  });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /ธรรมสอน/, "นามสกุลผู้รับหลุด");
  assert.doesNotMatch(serialized, /ต้อนรับ/, "ชื่อผู้เซ็นรับหลุด");
});

test("ผู้ส่งแสดงเต็ม เพราะแทบทั้งหมดเป็นชื่อร้านที่เปิดเผยอยู่แล้ว", () => {
  const shipment = toShipmentDetails(unmaskedDetail());
  assert.equal(shipment?.sender, "amonthepnontarug");
});

test("เก็บฟิลด์โลจิสติกส์ที่เคยทิ้งไปเงียบๆ", () => {
  const shipment = toShipmentDetails(unmaskedDetail());

  assert.equal(shipment?.deliveryType, "On-Time Delivery");
  assert.equal(shipment?.callCenterPhone, "1436");
});

test("รูปถ่ายตอนนำจ่ายไปอยู่ในก้อนอ่อนไหว ไม่ปนกับข้อมูลทั่วไป", () => {
  const result = toTrackingResult("SHP5054369172", {
    ...sampleData(),
    detail: unmaskedDetail(),
  });

  assert.deepEqual(result.sensitive?.proofPhotoUrls, [
    "https://cdn.example.com/proof/abc.jpg",
  ]);
  assert.doesNotMatch(JSON.stringify(result.shipment), /cdn\.example\.com/);
});

test("รูปหลายใบคั่นด้วยจุลภาค → แยกเป็นรายการ", () => {
  // J&T ส่งรูปพัสดุกับรูปลายเซ็นมาในฟิลด์เดียว ก่อนแก้ ค่าทั้งก้อนผ่านด่าน
  // startsWith("https://") ไปได้แล้วถูกยัดใส่ src ของ <img> → รูปแตกเงียบๆ
  const sensitive = toSensitiveDetails({
    signerImageURL:
      "https://cdn.example.com/a.jpg?q-sign-time=1, https://cdn.example.com/b.jpg?q-sign-time=1",
  });

  assert.deepEqual(sensitive?.proofPhotoUrls, [
    "https://cdn.example.com/a.jpg?q-sign-time=1",
    "https://cdn.example.com/b.jpg?q-sign-time=1",
  ]);
});

test("รายการที่มี URL เสียปนมา → เอาเฉพาะอันที่ใช้ได้ ไม่ทิ้งทั้งชุด", () => {
  const sensitive = toSensitiveDetails({
    signerImageURL: "http://cdn.example.com/a.jpg,https://cdn.example.com/b.jpg",
  });

  assert.deepEqual(sensitive?.proofPhotoUrls, ["https://cdn.example.com/b.jpg"]);
});

test("สถานที่แบบ J&T (ขึ้นต้นด้วย สาขา) → แยกออกมาได้", () => {
  // เลข JTTH203388775531 ของจริง — ไม่มีคอมมาและมีตัวเลขปน จึงไม่เข้ารูปเดิม
  // ผลคือก่อนแก้ สถานที่เป็นค่าว่าง = ไม่มีแผนที่เลย ทั้งที่ J&T ให้ชื่อสถานที่
  // ภาษาคนมา ซึ่งดีกว่ารหัสภายในของเจ้าอื่นเสียอีก
  const split = splitDescription(
    "ได้เซ็นรับพัสดุ - สาขา46Chiang Saen01 เวียง-เชียงแสน เชียงราย",
  );

  assert.equal(split.description, "ได้เซ็นรับพัสดุ");
  assert.equal(split.location, "สาขา46Chiang Saen01 เวียง-เชียงแสน เชียงราย");
});

test("ประโยคที่บังเอิญมีคำว่าสาขาอยู่กลางข้อความ → ไม่ตัด", () => {
  const split = splitDescription("พัสดุถูกส่งต่อ - ไปยังสาขาถัดไปตามเส้นทาง");
  assert.equal(split.location, "");
});

test("เบอร์สาขาแสดงได้ แต่เบอร์มือถือพนักงานต้องไม่ออกมาเลย", () => {
  // พนักงานส่งของไม่ได้ยินยอมให้เบอร์ตัวเองขึ้นเว็บสาธารณะ และไม่ใช่ผู้ใช้ของเรา
  // จึงไม่มีทางถอนความยินยอมได้ — เบอร์สาขากับคอลเซ็นเตอร์ตอบโจทย์ "ติดต่อใคร"
  // ได้ครบอยู่แล้วโดยไม่ต้องเปิดเผยเบอร์ส่วนตัวของใคร
  const shipment = toShipmentDetails({
    deliveryStaffName: "สมชาย",
    deliveryStaffPhoneNumber: "0650265482",
    deliveryStaffBranchPhoneNumber: "052-020-230",
    courierCallCenterPhoneNumber: "1361",
    senderPhoneNumber: "******7971",
    recipientPhoneNumber: "******1234",
  });

  assert.equal(shipment?.deliveryBranchPhone, "052-020-230");
  assert.equal(shipment?.callCenterPhone, "1361");
  assert.equal(shipment?.deliveryStaffName, "สมชาย");

  const dump = JSON.stringify(shipment);
  assert.doesNotMatch(dump, /0650265482/, "เบอร์มือถือพนักงานหลุดออกมา");
  assert.doesNotMatch(dump, /7971|1234/, "เบอร์ผู้ส่ง/ผู้รับหลุดออกมา");
});

test("URL ที่ไม่ใช่ https → ไม่รับ", () => {
  // ค่านี้ถูกเอาไปใส่ใน src ของ <img> โดยตรง
  for (const bad of ["http://x/a.jpg", "javascript:alert(1)", "", "  "]) {
    assert.equal(
      toSensitiveDetails({ ...unmaskedDetail(), signerImageURL: bad }),
      null,
      bad,
    );
  }
});

/* ------------------------- เลือกขนส่ง ------------------------- */

test("prefix ที่รู้จัก → ได้รหัสขนส่งของ ETrackings", () => {
  assert.equal(resolveCourier("SPXTH046012345678"), "shopee-express");
});

test("ผู้เรียกระบุขนส่งมาเอง → แปลงเป็นรหัสของ ETrackings", () => {
  assert.equal(resolveCourier("TH123456", "flash-express"), "flash-express");
  assert.equal(resolveCourier("TH123456", "kerry-express"), "kex-express");
  assert.equal(resolveCourier("TH123456", "shopee-xpress-th"), "shopee-express");
});

test("ขนส่งที่ยืนยันแล้วว่า ETrackings ไม่รองรับ → คืน null ไม่ยิงทิ้งโควตา", () => {
  // ยิงจริงแล้วได้ 400 Courier does not exist — ตั้งแต่มี courier hint
  // ตารางนี้ถูกใช้บ่อยขึ้นมาก แถวที่ไม่รองรับหนึ่งแถวคือโควตาที่ทิ้งทุกครั้ง
  assert.equal(resolveCourier("EY145587896TH", "thailand-post"), null);
});

test("เดาขนส่งไม่ได้ → คืน null ไม่เดามั่ว", () => {
  // โควตา 50 ครั้ง/เดือน การเดาผิดหนึ่งครั้งกิน 2% ของทั้งเดือน
  assert.equal(resolveCourier("EY145587896TH"), null);
  assert.equal(resolveCourier("TH54018WD4DJ1P"), null);
});

test("ขนส่งที่ ETrackings ไม่รองรับ → คืน null", () => {
  assert.equal(resolveCourier("X1234567", "ninja-van"), null);
});


/* ------------------ ที่อยู่สาขาที่ห้อยท้าย description ------------------ */

/** ข้อความจริงที่ยิงมาจาก API ของ Shopee Xpress */
const WITH_ADDRESS =
  "09:28 พัสดุถึงสาขาปลายทาง: ACRAI-B - เมืองเชียงราย - อยู่ที่ TH " +
  "จังหวัดเชียงราย 57000 อำเภอเมืองเชียงราย 639 หมู่ที่1 ตำบลบ้านดู่ " +
  "อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100";

test("แยกรหัสสาขาและที่อยู่เต็มออกจากกันได้", () => {
  const parsed = splitDescription(WITH_ADDRESS);

  assert.equal(parsed.description, "พัสดุถึงสาขาปลายทาง");
  assert.equal(parsed.location, "ACRAI-B - เมืองเชียงราย");
  assert.equal(
    parsed.address,
    "639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100",
  );
});

test("ที่อยู่ที่แยกได้ต้องตัดส่วนที่ซ้ำซ้อนนำหน้าทิ้ง", () => {
  // "TH จังหวัดเชียงราย 57000 อำเภอเมืองเชียงราย" ที่นำหน้ามาไม่ใช่ที่อยู่จริง
  // ถ้าปล่อยติดไป Google จะเอนไปตอบเป็นหมุดกลางจังหวัดแทนที่จะเป็นตัวสาขา
  const address = cleanBranchAddress(
    "TH จังหวัดเชียงราย 57000 อำเภอเมืองเชียงราย 639 หมู่ที่1 ตำบลบ้านดู่ " +
      "อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100",
  );

  assert.ok(!address.startsWith("TH"));
  assert.ok(!address.startsWith("จังหวัด"));
  assert.equal(address.match(/จังหวัด/g)?.length, 1);
});

test("ไม่มีระดับตำบล → ไม่เดา คืนค่าว่าง", () => {
  // แยกไม่ได้แน่ๆ ดีกว่าเดาแล้วเอาพิกัดผิดไปเขียนลงตารางที่ทั้งระบบเชื่อว่าถูก
  assert.equal(cleanBranchAddress("TH กรุงเทพมหานคร"), "");
  assert.equal(cleanBranchAddress("บริเวณศูนย์คัดแยก"), "");
});

test("ไม่มีจังหวัดและไม่มีรหัสไปรษณีย์ → ไม่เดา คืนค่าว่าง", () => {
  assert.equal(cleanBranchAddress("12 ตำบลบ้านดู่"), "");
});

test("รูปแบบไม่ครบสามส่วน → ตกไปใช้ตรรกะเดิม ไม่มีที่อยู่", () => {
  const noColon = splitDescription("พัสดุถึงสาขา ACRAI-B - อยู่ที่ TH ตำบลบ้านดู่");
  assert.equal(noColon.address, "");

  const noMarker = splitDescription(
    "08:10 พัสดุถึงสาขา: ACRAI-B - เมืองเชียงราย",
  );
  assert.equal(noMarker.address, "");
});

test("ที่อยู่ถูกส่งต่อไปอยู่ในเหตุการณ์ ไม่ใช่หายไประหว่างทาง", () => {
  const result = toTrackingResult("SPXTH046012345678", {
    courierKey: "shopee-express",
    status: "ON_OTHER_STATUS",
    timelines: [
      { date: "2026-08-30", details: [{ time: "09:28", description: WITH_ADDRESS }] },
    ],
  });

  assert.equal(result.events[0].location, "ACRAI-B - เมืองเชียงราย");
  assert.match(result.events[0].address ?? "", /ตำบลบ้านดู่/);
});

test("รองรับครบทั้ง 15 เจ้าที่เอกสารบอกว่ายิงได้", () => {
  // รายชื่อจากคอลัมน์ API ในหน้า /docs/couriers/all
  // ตารางที่ขาดเจ้าไหน = เลขของเจ้านั้นจะไม่มีวันถูกส่งไปหา ETrackings เลย
  // ต่อให้เรารู้อยู่แล้วว่าเป็นเจ้าไหนก็ตาม (ดู canTrack)
  const supported = [
    "kex-express",
    "shopee-express",
    "flash-express",
    "jt-express",
    "best-express",
    "speed-d",
    "nim-express",
    "inter-express",
    "tnt-express",
    "shippop",
    "tp-logistics",
    "sky-box",
    "business-idea-transport",
    "quantium-solutions",
    "dhl-ecommerce",
  ];

  for (const courier of supported) {
    assert.equal(
      resolveCourier("TH123456", courier),
      courier,
      `ยังไม่รองรับ ${courier}`,
    );
  }
});

test("ขนส่งที่ยิงแล้วโดนปฏิเสธ ต้องไม่กลับเข้าตารางอีก", () => {
  // ยืนยันด้วยการยิงจริงแล้วว่า ETrackings ไม่รู้จัก — แถวที่ไม่รองรับหนึ่งแถว
  // คือการทิ้งโควตาหนึ่งครั้งทุกครั้งที่มีเลขของเจ้านั้นเข้ามา
  for (const courier of [
    "thailand-post",
    "lex",
    "fed-ex",
    "dhl-express",
    "ems-international",
  ]) {
    assert.equal(resolveCourier("TH123456", courier), null, `${courier} ไม่ควรอยู่ในตาราง`);
  }
});
