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
/** ตรรกะที่มีต้นทุนย้ายมาอยู่ที่นี่ ด่านจึงต้องตามมาตรวจด้วย */
const IMAGE = readFileSync("lib/map-image.ts", "utf8");

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

test("route ต้องเช็คด่านก่อนตรวจพิกัด และก่อนทุกอย่างที่มีต้นทุน", () => {
  const gate = ROUTE.indexOf("await mapImageAllowed()");
  const coords = ROUTE.indexOf("checkCoordinates(");
  const apiKey = ROUTE.indexOf("process.env.GOOGLE_MAPS_API_KEY");
  const fetchAt = ROUTE.indexOf("fetchMapImage(");

  assert.ok(gate > 0, "route ต้องเรียก mapImageAllowed()");
  assert.ok(
    gate < coords,
    "ด่านต้องมาก่อน checkCoordinates — ปิดแล้วต้องไม่ทำงานอะไรเลย",
  );
  assert.ok(gate < apiKey, "ด่านต้องมาก่อนการอ่าน API key");
  assert.ok(gate < fetchAt, "ด่านต้องมาก่อนขั้นที่ยิง Google");

  // route ต้องไม่ยิง Google เองอีกแล้ว — ทุกอย่างที่มีต้นทุนอยู่ใน map-image
  assert.doesNotMatch(
    ROUTE,
    /await fetch\(/,
    "route ต้องไม่ยิงเอง ไม่งั้นจะมีเส้นทางที่เลี่ยงตัวนับกับการกันคำขอซ้ำได้",
  );
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

test("ชั้นที่ 2 ต้องอยู่ครบ — ด่านสวิตช์อย่างเดียวไม่ได้อุดรู", () => {
  // เทสต์ตัวนี้แทนที่ตัวเดิมที่เคยเฝ้าว่า "ชั้นที่ 2 ยังไม่มี" · ตอนนี้มีแล้ว
  // หน้าที่จึงกลับด้าน: เฝ้าไม่ให้ใครถอดออก
  //
  // ด่านสวิตช์ปิดรูได้เพราะสวิตช์ปิดอยู่ ไม่ใช่เพราะรูถูกอุด — ถ้าเปิด
  // map_enabled โดยไม่มีสามอย่างนี้ รูจะเปิดกลับทันที
  assert.match(
    ROUTE,
    /coordinates\.outsideThailand/,
    "ต้องปฏิเสธพิกัดนอกกรอบไทย ไม่งั้นใครก็ขยับพิกัดหลบ cache ได้ไม่จำกัด",
  );
  assert.match(
    ROUTE,
    /roundCoordinate\(/,
    "ต้องปัดพิกัดก่อนส่ง Google ไม่งั้น cache แทบไม่มีทาง hit",
  );
  // เพดานกับตัวนับย้ายไปอยู่ใน lib/map-image.ts พร้อมกับการกันคำขอซ้ำ
  assert.match(
    IMAGE,
    /isExhausted\(MAP_PROVIDER\)/,
    "ต้องมีเพดานรายวัน — เพดานที่หยุดไม่ได้ก็ไม่ใช่เพดาน",
  );
  assert.match(
    IMAGE,
    /countProviderCall\(MAP_PROVIDER\)/,
    "ต้องนับทุกครั้งที่ยิงจริง",
  );
  assert.match(
    IMAGE,
    /inflight\.run\(/,
    "ต้องกันคำขอซ้ำที่บินพร้อมกัน ไม่งั้นหน้าเดียวจ่าย Google หลายครั้งสำหรับภาพเดียวกัน",
  );
});
