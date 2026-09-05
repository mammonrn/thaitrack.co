/**
 * เทสต์ด่านของ /api/map
 *
 * ══════════════════════════════════════════════════════════════════
 * สิ่งเดียวที่เฝ้า: **สวิตช์ปิด = ไม่มี request ออกไปหา Google เลย**
 *
 * /api/map เปิดสาธารณะ ไม่ต้องล็อกอิน ไม่มี rate limit — แต่ละครั้งที่ยิงคือ
 * เงินที่จ่าย Google จริง · ถ้าด่านนี้หลุด จะไม่มีอะไรพังให้เห็น มีแต่บิล
 * ══════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { defaultSettings } from "./app-settings.ts";
import { mapImageAllowed } from "./map-access.ts";

const ROUTE = readFileSync("app/api/map/route.ts", "utf8");

test("สวิตช์เปิด → ยิงได้", async () => {
  const allowed = await mapImageAllowed({
    readSettings: () =>
      Promise.resolve({ ...defaultSettings(), map_enabled: true }),
  });
  assert.equal(allowed, true);
});

test("สวิตช์ปิด → ไม่ให้ยิง", async () => {
  const allowed = await mapImageAllowed({
    readSettings: () =>
      Promise.resolve({ ...defaultSettings(), map_enabled: false }),
  });
  assert.equal(allowed, false);
});

test("ค่าเริ่มต้นของระบบคือปิด → ไม่ให้ยิง", async () => {
  const allowed = await mapImageAllowed({
    readSettings: () => Promise.resolve(defaultSettings()),
  });
  assert.equal(allowed, false, "SETTING_DEFAULTS.map_enabled ต้องเป็น false");
});

test("⚠️ อ่านสวิตช์ไม่ได้ → ถือว่าปิด (fail closed)", async () => {
  for (const failure of [
    () => Promise.reject(new Error("ฐานข้อมูลล่ม")),
    () => Promise.reject(new Error("ยังไม่ได้รัน migration 0019")),
    () => {
      throw new Error("โยนแบบ synchronous");
    },
  ]) {
    assert.equal(
      await mapImageAllowed({ readSettings: failure }),
      false,
      "ไม่รู้ = ไม่จ่าย · fail open ตรงนี้แปลว่าเปิดรูให้ยิง Google ฟรี",
    );
  }
});

test("ค่าที่ไม่ใช่ true เป๊ะๆ → ถือว่าปิด", async () => {
  // กันกรณีที่แถวในฐานข้อมูลเก็บค่าเป็นสตริง/ตัวเลขแล้วหลุดการแปลงมา
  for (const weird of [1, "true", "1", {}, [], null, undefined]) {
    const allowed = await mapImageAllowed({
      readSettings: () =>
        Promise.resolve({
          ...defaultSettings(),
          map_enabled: weird as unknown as boolean,
        }),
    });
    assert.equal(allowed, false, `ค่า ${JSON.stringify(weird)} ต้องไม่ผ่าน`);
  }
});

/* ------------------------------------------------------------------ *
 * ด่านต้องอยู่ก่อนทุกอย่างในตัว route จริง
 *
 * เทสต์ข้างบนพิสูจน์ว่า "ตรรกะตัดสินถูก" แต่ไม่ได้พิสูจน์ว่า route เรียกใช้มัน
 * ก่อนจะยิง Google — สองข้อนี้ต้องแยกกันตรวจ
 * ------------------------------------------------------------------ */

test("route ต้องเช็คด่านก่อนตรวจพิกัด และก่อน fetch", () => {
  const gate = ROUTE.indexOf("await mapImageAllowed()");
  const coords = ROUTE.indexOf("checkCoordinates(");
  const fetchAt = ROUTE.indexOf("await fetch(");
  const apiKey = ROUTE.indexOf("process.env.GOOGLE_MAPS_API_KEY");

  assert.ok(gate > 0, "route ต้องเรียก mapImageAllowed()");
  assert.ok(
    gate < coords,
    "ด่านต้องมาก่อน checkCoordinates — ปิดแล้วต้องไม่ทำงานอะไรเลย",
  );
  assert.ok(gate < apiKey, "ด่านต้องมาก่อนการอ่าน API key");
  assert.ok(gate < fetchAt, "ด่านต้องมาก่อน fetch ไปหา Google");
});

test("ปิดแล้วต้องตอบ 404 ไม่ใช่ 403", () => {
  // 403 บอกใบ้ว่า "มี endpoint นี้อยู่ แค่เข้าไม่ได้" ซึ่งคนสแกนหาช่องโหว่
  // เอาไปใช้ต่อได้ · 404 ไม่บอกอะไรเลย
  assert.match(
    ROUTE,
    /if \(!\(await mapImageAllowed\(\)\)\) return errorResponse\(404\);/,
  );
  assert.doesNotMatch(ROUTE, /errorResponse\(403\)/);
});

test("⚠️ ชั้นที่ 2 ยังไม่มี — ด่านนี้ปิดรูได้เพราะสวิตช์ปิด ไม่ใช่เพราะรูถูกอุด", () => {
  // เทสต์ตัวนี้ไม่ได้ตรวจโค้ด แต่เป็นบันทึกที่รันได้: ถ้าวันหนึ่งมีคนเปิด
  // map_enabled กลับมาโดยยังไม่มีชั้นที่ 2 ครบ รูจะเปิดกลับทันที
  //
  // ชั้นที่ 2 = จำกัดพิกัดในกรอบไทย + ปัดพิกัดให้ cache ทำงาน + ตัวนับ + เพดานรายวัน
  const hasThailandBound = /isInThailand|outsideThailand/.test(ROUTE);
  const hasRounding = /toFixed\(4\)|roundCoordinate/.test(ROUTE);
  const hasQuota = /countProviderCall|isExhausted/.test(ROUTE);

  assert.equal(
    [hasThailandBound, hasRounding, hasQuota].every(Boolean),
    false,
    "ถ้าชั้นที่ 2 ครบแล้ว ให้ลบเทสต์ตัวนี้ทิ้งและอัปเดตคอมเมนต์ใน lib/map-access.ts",
  );
});
