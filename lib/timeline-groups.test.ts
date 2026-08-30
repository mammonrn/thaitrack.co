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

test("เหตุการณ์ที่ไม่มีสถานที่ → ยุบเข้ากลุ่มที่เก่ากว่าถัดลงไป", () => {
  const groups = groupEventsByLocation([
    event("ผู้ส่งเตรียมพัสดุ", ""),
    event("สร้างคำสั่งซื้อ", "   "),
    event("ถึงศูนย์", "กรุงเทพ"),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].location, "กรุงเทพ");
  assert.deepEqual(
    groups[0].events.map((e) => e.description),
    ["ผู้ส่งเตรียมพัสดุ", "สร้างคำสั่งซื้อ", "ถึงศูนย์"],
  );
});

test("เหตุการณ์ไร้พิกัดที่แทรกกลาง → ไม่หั่นสถานีเดียวออกเป็นหลายกลุ่ม", () => {
  // ลำดับจริงจากเคส SPX: เหตุการณ์เชิงสถานะไม่มีสถานที่ คั่นอยู่ระหว่างสถานี
  const groups = groupEventsByLocation([
    event("มอบหมายพนักงานนำจ่ายแล้ว", ""),
    event("ถึงสาขา ACRAI-B", "ACRAI-B - เมืองเชียงราย"),
    event("อยู่ระหว่างขนส่ง", ""),
    event("ออกจากสาขา ACRAI-B", "ACRAI-B - เมืองเชียงราย"),
    event("ออกจากศูนย์คัดแยก", "NORC-B SPX Express"),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].location, "ACRAI-B - เมืองเชียงราย");
  assert.deepEqual(
    groups[0].events.map((e) => e.description),
    [
      "มอบหมายพนักงานนำจ่ายแล้ว",
      "ถึงสาขา ACRAI-B",
      "อยู่ระหว่างขนส่ง",
      "ออกจากสาขา ACRAI-B",
    ],
  );
  assert.equal(groups[1].location, "NORC-B SPX Express");
});

test("เหตุการณ์ไร้พิกัดที่อยู่ท้ายสุด → ถอยไปยุบเข้ากลุ่มที่ใหม่กว่า", () => {
  const groups = groupEventsByLocation([
    event("ถึงศูนย์", "กรุงเทพ"),
    event("ผู้ส่งเตรียมพัสดุ", ""),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].location, "กรุงเทพ");
  assert.deepEqual(
    groups[0].events.map((e) => e.description),
    ["ถึงศูนย์", "ผู้ส่งเตรียมพัสดุ"],
  );
});

test("ทั้งไทม์ไลน์ไม่มีสถานที่เลย → เหลือกลุ่มเดียวที่ location เป็น null", () => {
  const groups = groupEventsByLocation([
    event("อยู่ระหว่างขนส่ง", ""),
    event("รับพัสดุแล้ว", "  "),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].location, null);
  assert.equal(groups[0].events.length, 2);
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
