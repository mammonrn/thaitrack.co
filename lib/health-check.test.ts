/**
 * เทสต์การตัดสินสถานะระบบ
 *
 * ประเด็นที่ต้องไม่หลุด: **ห้ามเตือนตอนที่ไม่มีอะไรเสีย** การแจ้งเตือนที่ผิด
 * บ่อยๆ จบลงที่คนปิดการแจ้งเตือนทิ้ง ซึ่งแย่กว่าไม่มีการแจ้งเตือนตั้งแต่แรก
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { countProviderCall, resetProviderUsage } from "./provider-usage.ts";
import type { ProviderUsageStore } from "./supabase/provider-usage.ts";
import {
  DEFAULT_MIN_SEARCHES,
  judgeHealth,
  providersNearQuota,
  readMaxErrorRatio,
  readMaxNotFoundRatio,
  readMinSearches,
  readWindowMinutes,
  type HealthSnapshot,
} from "./health-check.ts";

/** ชั้นเก็บถาวรที่ไม่ทำอะไร — เทสต์ชุดนี้สนใจแค่ตัวนับใน memory */
const silentStore: ProviderUsageStore = {
  bump: () => Promise.resolve(null),
  read: () => Promise.resolve({}),
};

const healthy: HealthSnapshot = {
  total: 100,
  found: 90,
  notFound: 8,
  error: 2,
};

test("ทุกอย่างปกติ → ok", () => {
  assert.deepEqual(judgeHealth(healthy, []), { ok: true, reason: null });
});

test("คำค้นน้อยเกินกว่าจะสรุป → ไม่เตือน", () => {
  // ตีสาม มีคนค้นสองครั้งแล้วพิมพ์ผิดทั้งคู่ = ค้นไม่เจอ 100% ซึ่งไม่ได้แปลว่า
  // อะไรเลย ถ้าเตือนตรงนี้ เราจะปลุกเจ้าของเว็บกลางดึกด้วยเรื่องที่ไม่มีอะไรเสีย
  const quiet: HealthSnapshot = { total: 2, found: 0, notFound: 2, error: 0 };
  assert.deepEqual(judgeHealth(quiet, []), { ok: true, reason: null });
});

test("ระบบขัดข้องเกินเกณฑ์ → เตือน", () => {
  const broken: HealthSnapshot = { total: 50, found: 30, notFound: 5, error: 15 };
  assert.deepEqual(judgeHealth(broken, []), { ok: false, reason: "error_rate" });
});

test("ค้นไม่เจอเยอะผิดปกติ → เตือน", () => {
  const missing: HealthSnapshot = { total: 50, found: 15, notFound: 35, error: 0 };
  assert.deepEqual(judgeHealth(missing, []), {
    ok: false,
    reason: "not_found_rate",
  });
});

test("โควตาใกล้เต็ม → เตือน แม้การค้นหาจะยังปกติดีทุกอย่าง", () => {
  // นี่คือเคสที่ monitor แบบเดิมจับไม่ได้เลย — ทุกอย่างเขียวจนถึงวินาทีที่
  // โควตาหมดแล้วทั้งเว็บค้นอะไรไม่ได้พร้อมกัน
  assert.deepEqual(judgeHealth(healthy, ["etrackings"]), {
    ok: false,
    reason: "quota_warning",
  });
});

test("โควตามาก่อน แม้จะมีปัญหาอย่างอื่นพร้อมกัน", () => {
  // โควตาต้องลงมือทำอะไรสักอย่าง (ซื้อเพิ่ม/ปรับเพดาน) ส่วนอัตราค้นไม่เจอสูง
  // อาจเป็นเรื่องชั่วคราวของฝั่งขนส่งที่หายเองได้
  const missing: HealthSnapshot = { total: 50, found: 15, notFound: 35, error: 0 };
  assert.equal(judgeHealth(missing, ["track123"]).reason, "quota_warning");
});

test("โควตาใกล้เต็มตอนที่เงียบมาก → ยังเตือน", () => {
  // ด่าน "คำค้นน้อยเกินกว่าจะสรุป" ใช้กับอัตราส่วนเท่านั้น ไม่ใช่กับโควตา
  // เพราะโควตาที่ใช้ไปแล้วไม่ได้ขึ้นกับว่าตอนนี้มีคนใช้เว็บอยู่กี่คน
  const quiet: HealthSnapshot = { total: 0, found: 0, notFound: 0, error: 0 };
  assert.equal(judgeHealth(quiet, ["etrackings"]).reason, "quota_warning");
});

test("อยู่ที่เกณฑ์พอดี → ถือว่าเข้าเกณฑ์แล้ว", () => {
  const atLimit: HealthSnapshot = { total: 100, found: 80, notFound: 0, error: 20 };
  assert.equal(judgeHealth(atLimit, []).reason, "error_rate");
});

/* ------------------------- ค่าที่ตั้งผ่าน env ------------------------- */

test("ไม่ได้ตั้ง env → ใช้ค่าเริ่มต้น", () => {
  assert.equal(readMinSearches(), DEFAULT_MIN_SEARCHES);
  assert.ok(readWindowMinutes() > 0);
  assert.ok(readMaxErrorRatio() > 0 && readMaxErrorRatio() <= 1);
  assert.ok(readMaxNotFoundRatio() > 0 && readMaxNotFoundRatio() <= 1);
});

test("ตั้ง env → ใช้ค่าที่ตั้ง", (t) => {
  t.after(() => {
    delete process.env.HEALTH_MIN_SEARCHES;
    delete process.env.HEALTH_MAX_ERROR_RATIO;
  });

  process.env.HEALTH_MIN_SEARCHES = "5";
  process.env.HEALTH_MAX_ERROR_RATIO = "0.05";

  assert.equal(readMinSearches(), 5);
  assert.equal(readMaxErrorRatio(), 0.05);

  const few: HealthSnapshot = { total: 6, found: 5, notFound: 0, error: 1 };
  assert.equal(judgeHealth(few, []).reason, "error_rate");
});

test("ค่า env ที่ใช้ไม่ได้ → กลับไปใช้ค่าเริ่มต้น ไม่พังและไม่กลายเป็นศูนย์", (t) => {
  t.after(() => {
    delete process.env.HEALTH_MIN_SEARCHES;
  });

  for (const bad of ["", "  ", "abc", "0", "-3"]) {
    process.env.HEALTH_MIN_SEARCHES = bad;
    assert.equal(readMinSearches(), DEFAULT_MIN_SEARCHES, bad);
  }
});

test("ปิดเสียงเตือนโควตาของเจ้าที่รับทราบแล้วได้", (t) => {
  t.after(() => {
    delete process.env.HEALTH_IGNORE_QUOTA;
    delete process.env.ETRACKINGS_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.ETRACKINGS_CALL_LIMIT = "50";
  resetProviderUsage();

  // ดันให้ ETrackings ทะลุเกณฑ์ 80%
  for (let i = 0; i < 45; i += 1) {
    void countProviderCall("etrackings", { store: silentStore });
  }

  assert.deepEqual(providersNearQuota(), ["etrackings"]);

  process.env.HEALTH_IGNORE_QUOTA = "etrackings";
  assert.deepEqual(
    providersNearQuota(),
    [],
    "โควตาที่ไม่รีเซ็ตจะแดงค้างตลอดกาล ต้องปิดเสียงได้หลังรับทราบ",
  );
});
