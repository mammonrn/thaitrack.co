/**
 * เทสต์การแปลงข้อมูลของ Track123 เป็นรูปแบบกลาง
 *
 * ข้อมูลตัวอย่างมาจากเคสจริงของ Flash Express เลข TH54018WD4DJ1P ที่เจอสองปัญหา
 * พร้อมกันคือหัวการ์ดขัดแย้งกับไทม์ไลน์ และมีรหัสภายในของขนส่งปนในข้อความ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cleanEventText,
  toTrackingResult,
  type Track123Accepted,
} from "./track123.ts";

const TRACK_NO = "TH54018WD4DJ1P";

/**
 * ข้อมูลจริงจากเคส: นำจ่ายไม่สำเร็จรอบแรก แล้วสำเร็จรอบถัดมา
 * แต่ transitStatus ยังค้างเป็น ABNORMAL อยู่
 */
function flashExpressAccepted(): Track123Accepted {
  return {
    trackNo: TRACK_NO,
    transitStatus: "ABNORMAL",
    lastMileInfo: {
      courierCode: "flash-express",
      courierNameEN: "Flash Express",
      trackingDetails: [
        {
          eventTime: "2026-08-25T09:12:00+07:00",
          address: "เชียงราย",
          eventDetailTranslation:
            "DELIVERY_TICKET_CREATION_SCAN,พัสดุของคุณกำลังจัดส่งโดยแฟลช เอ็กซ์เพรส",
        },
        {
          eventTime: "2026-08-26T14:30:00+07:00",
          address: "เชียงราย",
          eventDetailTranslation:
            "TRANSFER_SCAN,ถูกส่งต่อพัสดุจากสาขา08 NO4_HUB-เชียงราย",
        },
        {
          eventTime: "2026-08-27T11:05:00+07:00",
          address: "เชียงราย",
          eventDetailTranslation: "นำจ่ายไม่สำเร็จ ผู้รับไม่อยู่",
        },
        {
          eventTime: "2026-08-28T10:20:00+07:00",
          address: "เชียงราย",
          eventDetailTranslation: "เซ็นรับพัสดุเรียบร้อย",
        },
      ],
    },
  };
}

/* ---------------- ปัญหาที่ 1: หัวการ์ดขัดแย้งกับไทม์ไลน์ ---------------- */

test("transitStatus ค้างเป็น ABNORMAL แต่ event ล่าสุดคือเซ็นรับ → สถานะต้องเป็น delivered", () => {
  const result = toTrackingResult(TRACK_NO, flashExpressAccepted());

  assert.equal(result.status, "delivered");
  assert.equal(result.statusText, "ส่งถึงแล้ว");
});

test("สถานะหัวการ์ดต้องตรงกับ event ล่าสุดในไทม์ไลน์เสมอ", () => {
  const result = toTrackingResult(TRACK_NO, flashExpressAccepted());
  const newest = result.events.at(-1);

  assert.ok(newest !== undefined);
  assert.match(newest.description, /เซ็นรับพัสดุเรียบร้อย/);
  assert.equal(result.status, "delivered");
  assert.equal(result.lastUpdated, newest.time);
});

test("นำจ่ายไม่สำเร็จเป็น event ล่าสุด → สถานะต้องเป็น exception ไม่ใช่ delivered", () => {
  const accepted = flashExpressAccepted();
  // ตัดเหตุการณ์เซ็นรับออก ให้ "นำจ่ายไม่สำเร็จ" กลายเป็นอันล่าสุด
  accepted.lastMileInfo!.trackingDetails!.pop();
  accepted.transitStatus = "DELIVERED"; // ถึงหัวจะบอกว่าส่งแล้วก็ตาม

  const result = toTrackingResult(TRACK_NO, accepted);

  assert.equal(result.status, "exception");
});

test('"ไม่สามารถเซ็นรับพัสดุ" ต้องไม่ถูกอ่านเป็นส่งสำเร็จ', () => {
  const accepted = flashExpressAccepted();
  accepted.lastMileInfo!.trackingDetails = [
    {
      eventTime: "2026-08-28T10:20:00+07:00",
      eventDetailTranslation: "ไม่สามารถเซ็นรับพัสดุได้ ผู้รับปฏิเสธ",
    },
  ];

  const result = toTrackingResult(TRACK_NO, accepted);

  assert.equal(result.status, "exception");
});

test("event ล่าสุดอ่านสถานะไม่ออก → ใช้ transitStatus ตามเดิม", () => {
  const accepted = flashExpressAccepted();
  accepted.transitStatus = "IN_TRANSIT";
  accepted.lastMileInfo!.trackingDetails = [
    {
      eventTime: "2026-08-28T10:20:00+07:00",
      eventDetailTranslation: "พัสดุถึงศูนย์คัดแยกแล้ว",
    },
  ];

  const result = toTrackingResult(TRACK_NO, accepted);

  assert.equal(result.status, "in_transit");
});

/* ---------------- ปัญหาที่ 2: รหัสภายในปนในข้อความ ---------------- */

test("ตัด event code ที่นำหน้าข้อความออก", () => {
  assert.equal(
    cleanEventText(
      "DELIVERY_TICKET_CREATION_SCAN,พัสดุของคุณกำลังจัดส่งโดยแฟลช เอ็กซ์เพรส",
    ),
    "พัสดุของคุณกำลังจัดส่งโดยแฟลช เอ็กซ์เพรส",
  );
});

test("ตัดรหัสสาขาภายในที่แทรกกลางประโยคออก", () => {
  assert.equal(
    cleanEventText("TRANSFER_SCAN,ถูกส่งต่อพัสดุจากสาขา08 NO4_HUB-เชียงราย"),
    "ถูกส่งต่อพัสดุจากสาขาเชียงราย",
  );
});

test("ข้อความที่สะอาดอยู่แล้วต้องไม่ถูกแตะ", () => {
  for (const text of [
    "เซ็นรับพัสดุเรียบร้อย",
    "นำจ่ายไม่สำเร็จ ผู้รับไม่อยู่",
    "พัสดุถึงศูนย์คัดแยกแล้ว",
    "Out for delivery",
  ]) {
    assert.equal(cleanEventText(text), text);
  }
});

test("คำย่อสั้นๆ ที่เป็นเนื้อหาจริงต้องไม่ถูกตัด", () => {
  assert.equal(cleanEventText("USA, ถึงปลายทางแล้ว"), "USA, ถึงปลายทางแล้ว");
});

test("ข้อความที่เป็นรหัสล้วน → คืนของเดิม ไม่ปล่อยให้ว่าง", () => {
  assert.equal(cleanEventText("PICKUP_SCAN,"), "PICKUP_SCAN,");
});

test("ทุก event ที่ส่งถึงผู้ใช้ต้องไม่มีรหัสภายในหลงเหลือ", () => {
  const result = toTrackingResult(TRACK_NO, flashExpressAccepted());

  for (const event of result.events) {
    assert.doesNotMatch(
      event.description,
      /[A-Z][A-Z0-9_]{3,}\s*,/,
      `ยังมี event code ปนอยู่: ${event.description}`,
    );
    assert.doesNotMatch(
      event.description,
      /[A-Z][A-Z0-9]*_[A-Z0-9]+-/,
      `ยังมีรหัสสาขาปนอยู่: ${event.description}`,
    );
  }

  assert.equal(
    result.events[0].description,
    "พัสดุของคุณกำลังจัดส่งโดยแฟลช เอ็กซ์เพรส",
  );
  assert.equal(
    result.events[1].description,
    "ถูกส่งต่อพัสดุจากสาขาเชียงราย",
  );
});
