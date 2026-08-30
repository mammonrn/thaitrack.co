/**
 * เทสต์การจัดกลุ่มไทม์ไลน์ตามสถานที่
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrackingEvent } from "./carriers/types.ts";
import { groupEventsByLocation, normalizeLocation } from "./timeline-groups.ts";

function event(description: string, location: string): TrackingEvent {
  return { time: "2026-08-30T10:00:00+07:00", location, description };
}

test("เหตุการณ์ติดกันที่สถานที่เดียวกัน → รวมเป็นกลุ่มเดียว", () => {
  const groups = groupEventsByLocation([
    event("ออกจากศูนย์", "ศูนย์คัดแยก ขอนแก่น"),
    event("คัดแยกแล้ว", "ศูนย์คัดแยก ขอนแก่น"),
    event("ถึงศูนย์", "ศูนย์คัดแยก ขอนแก่น"),
    event("ออกจากคลัง", "ShiYan"),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].location, "ศูนย์คัดแยก ขอนแก่น");
  assert.equal(groups[0].events.length, 3);
  assert.equal(groups[1].location, "ShiYan");
  assert.equal(groups[1].events.length, 1);
});

test("สถานที่เดียวกันแต่สะกดต่างกันเล็กน้อย → ยังรวมกลุ่มเดียวกัน", () => {
  const groups = groupEventsByLocation([
    event("ก", "SHENZHEN"),
    event("ข", "Shenzhen"),
    event("ค", "  shenzhen  "),
  ]);

  assert.equal(groups.length, 1);
  // ใช้การสะกดของอันใหม่ที่สุดเป็นหัวกลุ่ม
  assert.equal(groups[0].location, "SHENZHEN");
  assert.equal(groups[0].events.length, 3);
});

test("ช่องว่างในชื่อไทยต่างกัน → ถือเป็นที่เดียวกัน", () => {
  assert.equal(
    normalizeLocation("ศูนย์คัดแยก ขอนแก่น"),
    normalizeLocation("ศูนย์คัดแยกขอนแก่น"),
  );

  const groups = groupEventsByLocation([
    event("ก", "ศูนย์คัดแยก ขอนแก่น"),
    event("ข", "ศูนย์คัดแยกขอนแก่น"),
  ]);
  assert.equal(groups.length, 1);
});

test("พัสดุวนกลับมาที่เดิม → ต้องแยกกลุ่ม ไม่รวมข้ามช่วงเวลา", () => {
  const groups = groupEventsByLocation([
    event("รอบสอง", "เชียงราย"),
    event("ไปที่อื่น", "เชียงใหม่"),
    event("รอบแรก", "เชียงราย"),
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.location),
    ["เชียงราย", "เชียงใหม่", "เชียงราย"],
  );
});

test("เหตุการณ์ที่ไม่มีสถานที่ → รวมเป็นกลุ่มที่ location เป็น null", () => {
  const groups = groupEventsByLocation([
    event("ผู้ส่งเตรียมพัสดุ", ""),
    event("สร้างคำสั่งซื้อ", "   "),
    event("ถึงศูนย์", "กรุงเทพ"),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].location, null);
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[1].location, "กรุงเทพ");
});

test("ไม่มีเหตุการณ์เลย → คืนอาร์เรย์ว่าง ไม่พัง", () => {
  assert.deepEqual(groupEventsByLocation([]), []);
});

test("ลำดับที่ส่งเข้าไปเป็นอย่างไร ลำดับที่ได้กลับมาก็เป็นอย่างนั้น", () => {
  const input = [event("ใหม่สุด", "A"), event("กลาง", "B"), event("เก่าสุด", "C")];
  const groups = groupEventsByLocation(input);

  assert.deepEqual(
    groups.flatMap((g) => g.events.map((e) => e.description)),
    ["ใหม่สุด", "กลาง", "เก่าสุด"],
  );
});
