/**
 * เทสต์ cache ภาพแผนที่
 *
 * ══════════════════════════════════════════════════════════════════
 * สองข้อที่พลาดแล้วเสียหายจริง:
 *
 *   1. **LRU ไม่ใช่ FIFO** — ความนิยมของสาขาเบ้มาก (ACRAI-B 20 : SORC-A 9 :
 *      SOCN 7 : FSOCW1 1) · FIFO จะทิ้งสาขายอดนิยมที่ใส่เข้ามาก่อน ทั้งที่ยัง
 *      ถูกเรียกตลอด แล้วจ่าย Google ใหม่ — ตรงข้ามกับสิ่งที่ cache ควรทำ
 *
 *   2. **ห้ามเก็บ error** — เก็บคำตอบพังไว้ 30 วัน = จำคำตอบผิดไว้เดือนหนึ่ง
 *      บั๊กชนิดเดียวกับแถวใน geocode_cache ที่ accuracy_meters เป็น null
 *      แล้วติดตายมาจนวันนี้
 * ══════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_IMAGES,
  TTL_MS,
  clearMapCache,
  lookupMapImage,
  mapCacheKey,
  mapCacheStats,
  rememberMapImage,
  roundCoordinate,
} from "./map-cache.ts";

const IMAGE = { body: new Uint8Array([1, 2, 3]), contentType: "image/png" };

function put(key: string, at = 1_000): void {
  rememberMapImage(key, IMAGE, at);
}

/* ---------------- การปัดพิกัด ---------------- */

test("ปัดเหลือ 4 ตำแหน่ง (~11 เมตร)", () => {
  assert.equal(roundCoordinate(19.9773831), 19.9774);
  assert.equal(roundCoordinate(99.85943785), 99.8594);
  assert.equal(roundCoordinate(13.7554632), 13.7555);
});

test("พิกัดที่ต่างกันน้อยกว่า 11 เมตร → key เดียวกัน", () => {
  // 0.00001 องศา ≈ 1.1 เมตรที่ละติจูดของไทย
  const a = mapCacheKey(19.97738, 99.85943, "15");
  const b = mapCacheKey(19.977384, 99.859432, "15");
  const c = mapCacheKey(19.977379, 99.859428, "15");

  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(a, "19.9774,99.8594,15");
});

test("ระดับซูมต่างกัน → คนละ key (ภาพคนละแบบจริงๆ)", () => {
  assert.notEqual(
    mapCacheKey(19.9774, 99.8594, "15"),
    mapCacheKey(19.9774, 99.8594, "11"),
  );
});

test("พิกัดที่ห่างกันจริง → คนละ key", () => {
  assert.notEqual(
    mapCacheKey(19.9774, 99.8594, "15"),
    mapCacheKey(13.7555, 100.5148, "15"),
  );
});

/* ---------------- เก็บและอ่าน ---------------- */

test("เก็บแล้วอ่านเจอ", () => {
  clearMapCache();
  put("a");
  const found = lookupMapImage("a", 1_000);
  assert.deepEqual(found?.body, IMAGE.body);
  assert.equal(found?.contentType, "image/png");
});

test("หมดอายุตาม TTL → ไม่เจอ และถูกลบทิ้ง", () => {
  clearMapCache();
  put("a", 0);

  assert.notEqual(lookupMapImage("a", TTL_MS - 1), null);
  assert.equal(lookupMapImage("a", TTL_MS), null, "ครบ TTL พอดี = หมดอายุ");
  assert.equal(mapCacheStats().stored, 0);
});

test("นับ hit / miss แยกกัน", () => {
  clearMapCache();
  put("a");

  lookupMapImage("a", 1_000);
  lookupMapImage("a", 1_000);
  lookupMapImage("ไม่มี", 1_000);

  const stats = mapCacheStats();
  assert.equal(stats.hits, 2);
  assert.equal(stats.misses, 1);
});

/* ---------------- LRU ---------------- */

test("🔴 LRU ไม่ใช่ FIFO — ตัวที่เพิ่งถูกเรียกต้องรอด", () => {
  clearMapCache();

  // จำลองด้วยเพดานจริง: ใส่จนเต็ม แล้วเรียกตัวแรก แล้วใส่อีกหนึ่ง
  for (let i = 0; i < MAX_IMAGES; i += 1) put(`k${i}`);

  // เรียกตัวที่ 0 → มันต้องย้ายไปท้ายคิว
  assert.notEqual(lookupMapImage("k0", 1_000), null);

  // ใส่ตัวใหม่ → ต้องมีตัวถูกทิ้งหนึ่งตัว
  put("ใหม่");

  assert.notEqual(
    lookupMapImage("k0", 1_000),
    null,
    "ตัวที่เพิ่งถูกเรียกต้องรอด — FIFO จะทิ้งตัวนี้",
  );
  assert.equal(
    lookupMapImage("k1", 1_000),
    null,
    "ตัวที่ถูกทิ้งต้องเป็นตัวที่ไม่ได้ถูกใช้นานที่สุด",
  );
  assert.notEqual(lookupMapImage("ใหม่", 1_000), null);
});

test("ใส่ 3 ตัวจนเต็ม → เรียกตัวที่ 1 → ใส่ตัวที่ 4 → ตัวที่ถูกทิ้งคือตัวที่ 2", () => {
  // เคสเดียวกับข้างบนแต่เล็กพอให้อ่านออกด้วยตา — พิสูจน์ตรรกะ LRU ล้วนๆ
  clearMapCache();
  put("1");
  put("2");
  put("3");

  lookupMapImage("1", 1_000); // ตัวที่ 1 ถูกใช้ → ย้ายไปท้ายคิว
  assert.equal(mapCacheStats().stored, 3);

  // จำลองการเต็มโดยใส่จนเกินเพดาน
  for (let i = 0; i < MAX_IMAGES; i += 1) put(`เติม${i}`);

  assert.equal(lookupMapImage("2", 1_000), null, "ตัวที่ 2 ต้องถูกทิ้งก่อน");
});

test("เพดานจำนวนรายการต้องไม่ถูกทะลุ — กันบอทที่ยิงพิกัดสุ่มดันหน่วยความจำ", () => {
  clearMapCache();
  for (let i = 0; i < MAX_IMAGES * 2; i += 1) put(`สุ่ม${i}`);

  assert.equal(mapCacheStats().stored, MAX_IMAGES);
});

/* ---------------- ห้ามเก็บของพัง ---------------- */

test("🔴 route ต้องเก็บ cache หลังผ่านด่านตรวจคำตอบครบแล้วเท่านั้น", () => {
  const route = readFileSync("app/api/map/route.ts", "utf8");

  const remember = route.indexOf("rememberMapImage(");
  const statusCheck = route.indexOf("if (!upstream.ok)");
  const typeCheck = route.indexOf('!contentType.startsWith("image/")');

  assert.ok(remember > 0, "route ต้องเก็บภาพลง cache");
  assert.ok(
    statusCheck > 0 && statusCheck < remember,
    "ต้องเช็ค upstream.ok ก่อนเก็บ — เก็บ error ไว้ 30 วันคือจำคำตอบผิดไว้เดือนหนึ่ง",
  );
  assert.ok(
    typeCheck > 0 && typeCheck < remember,
    "ต้องเช็ค content-type ก่อนเก็บ — Google ตอบ text/html มาได้เมื่อคีย์ผิดหรือโควตาหมด",
  );
});

test("🔴 cache ต้องมาก่อนตัวนับและก่อน fetch — hit ห้ามถูกนับเป็นการจ่ายเงิน", () => {
  const route = readFileSync("app/api/map/route.ts", "utf8");

  const lookup = route.indexOf("lookupMapImage(");
  const load = route.indexOf("await loadProviderUsage()");
  const count = route.indexOf("await countProviderCall(PROVIDER)");
  const fetchAt = route.indexOf("await fetch(url");

  assert.ok(lookup > 0 && load > lookup, "อ่าน cache ก่อนแตะโควตา");
  assert.ok(count > lookup, "ตัวนับต้องอยู่ใต้ cache");
  assert.ok(
    count < fetchAt,
    "ต้องนับก่อนยิง — ยิงแล้ว error ก็จ่ายไปแล้ว การนับเฉพาะครั้งที่สำเร็จคือนับขาด",
  );
});
