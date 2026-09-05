/**
 * เทสต์การตัดสินสถานะระบบ
 *
 * ประเด็นที่ต้องไม่หลุด: **ห้ามเตือนตอนที่ไม่มีอะไรเสีย** การแจ้งเตือนที่ผิด
 * บ่อยๆ จบลงที่คนปิดการแจ้งเตือนทิ้ง ซึ่งแย่กว่าไม่มีการแจ้งเตือนตั้งแต่แรก
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { countProviderCall, resetProviderUsage } from "./provider-usage.ts";
import type { ProviderUsageStore } from "./supabase/provider-usage.ts";
import {
  DEFAULT_MIN_SEARCHES,
  judgeHealth,
  judgeQuota,
  providersNearQuota,
  readMaxErrorRatio,
  readMaxNotFoundRatio,
  readMinSearches,
  readWindowMinutes,
  recoverableQuotaAlerts,
  standingQuotaWarnings,
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
  assert.deepEqual(judgeHealth(healthy), { ok: true, reason: null });
});

test("คำค้นน้อยเกินกว่าจะสรุป → ไม่เตือน", () => {
  // ตีสาม มีคนค้นสองครั้งแล้วพิมพ์ผิดทั้งคู่ = ค้นไม่เจอ 100% ซึ่งไม่ได้แปลว่า
  // อะไรเลย ถ้าเตือนตรงนี้ เราจะปลุกเจ้าของเว็บกลางดึกด้วยเรื่องที่ไม่มีอะไรเสีย
  const quiet: HealthSnapshot = { total: 2, found: 0, notFound: 2, error: 0 };
  assert.deepEqual(judgeHealth(quiet), { ok: true, reason: null });
});

test("ระบบขัดข้องเกินเกณฑ์ → เตือน", () => {
  const broken: HealthSnapshot = { total: 50, found: 30, notFound: 5, error: 15 };
  assert.deepEqual(judgeHealth(broken), { ok: false, reason: "error_rate" });
});

test("ค้นไม่เจอเยอะผิดปกติ → เตือน", () => {
  const missing: HealthSnapshot = { total: 50, found: 15, notFound: 35, error: 0 };
  assert.deepEqual(judgeHealth(missing), {
    ok: false,
    reason: "not_found_rate",
  });
});

/* ------------------------------------------------------------------ *
 * โควตาแยกออกจาก "เว็บใช้ไม่ได้" แล้ว
 *
 * เดิมโควตาเป็นด่านแรกของ judgeHealth ซึ่งทำให้ monitor รายงาน DOWN ติดกัน
 * 61 ชั่วโมงทั้งที่เว็บใช้งานได้ปกติ แล้วจบลงที่การปิดปากมันทิ้งด้วย env
 * ชื่อ HEALTH_IGNORE_QUOTA — ซึ่งแปลว่าตั้งแต่วันนั้นเราไม่มีทางรู้เรื่อง
 * โควตาอีกเลย
 * ------------------------------------------------------------------ */

test("โควตาใกล้เต็ม → /api/health/tracking ต้องไม่ 503 อีกต่อไป", () => {
  // ตอนโควตาเจ้าหนึ่งใกล้หมด ระบบสลับไปใช้เจ้าอื่นให้เองอัตโนมัติ
  // ผู้ใช้ไม่รู้สึกอะไรเลย จึงไม่ใช่เรื่องที่ควรปลุกใครกลางดึก
  assert.deepEqual(judgeHealth(healthy), { ok: true, reason: null });
});

test("โควตาไม่บังปัญหาจริง — ระบบขัดข้องยังต้องเตือนได้เหมือนเดิม", () => {
  // ของเดิมโควตาเป็นด่านแรก error_rate จึงถูกกลบทุกครั้งที่โควตาแดงค้างอยู่
  const broken: HealthSnapshot = { total: 50, found: 30, notFound: 5, error: 15 };
  assert.deepEqual(judgeHealth(broken), { ok: false, reason: "error_rate" });
});

test("อยู่ที่เกณฑ์พอดี → ถือว่าเข้าเกณฑ์แล้ว", () => {
  const atLimit: HealthSnapshot = { total: 100, found: 80, notFound: 0, error: 20 };
  assert.equal(judgeHealth(atLimit).reason, "error_rate");
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
  assert.equal(judgeHealth(few).reason, "error_rate");
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

/* ------------------------------------------------------------------ *
 * แยกโควตาตาม "ชนิดของรอบบิล" ไม่ใช่ตามชื่อเจ้า
 * ------------------------------------------------------------------ */

/** ดันโควตาของเจ้าหนึ่งให้ทะลุเกณฑ์ 80% */
function burnQuota(provider: "etrackings" | "track123", times: number): void {
  for (let i = 0; i < times; i += 1) {
    void countProviderCall(provider, { store: silentStore });
  }
}

test("โควตา lifetime หมด → /api/health/quota ยังตอบ 200", (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.ETRACKINGS_CALL_LIMIT = "50";
  resetProviderUsage();
  burnQuota("etrackings", 50); // ใช้จนหมดเกลี้ยง

  assert.deepEqual(
    providersNearQuota(),
    ["etrackings"],
    "ต้องยังมองเห็นว่าใกล้ชนเพดาน — การไม่ปลุกคนไม่ใช่การมองไม่เห็น",
  );
  assert.deepEqual(
    recoverableQuotaAlerts(),
    [],
    "รอบบิลแบบ lifetime ห้ามทำให้ /api/health/quota เป็น 503 " +
      "เพราะมันจะค้างตลอดกาล ไม่มีอะไรทำให้ตัวเลขลดลงได้อีก",
  );
  assert.deepEqual(standingQuotaWarnings(), ["etrackings"]);
  assert.deepEqual(judgeQuota(), { ok: true, reason: null });
});

test("โควตารายเดือนเกิน 80% → /api/health/quota ตอบ 503", (t) => {
  t.after(() => {
    delete process.env.TRACK123_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.TRACK123_CALL_LIMIT = "100";
  resetProviderUsage();
  burnQuota("track123", 85);

  assert.deepEqual(recoverableQuotaAlerts(), ["track123"]);
  assert.deepEqual(standingQuotaWarnings(), []);
  assert.deepEqual(judgeQuota(), { ok: false, reason: "quota_warning" });
});

test("โควตาที่รีเซ็ตได้ไม่ทำให้ /api/health/tracking เป็น 503", (t) => {
  t.after(() => {
    delete process.env.TRACK123_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.TRACK123_CALL_LIMIT = "100";
  resetProviderUsage();
  burnQuota("track123", 85);

  assert.deepEqual(
    judgeHealth(healthy),
    { ok: true, reason: null },
    "โควตาต้องไม่แตะ status ของ endpoint ที่บอกว่าผู้ใช้ใช้เว็บได้หรือไม่",
  );
});

test("⚠️ การแยกต้องอิงชนิดของรอบบิล ห้ามฮาร์ดโค้ดชื่อเจ้า", () => {
  const source = readFileSync("lib/health-check.ts", "utf8");

  // ถ้ามีชื่อเจ้าโผล่ในไฟล์นี้เมื่อไร มันคือ ignore list อีกอันในคราบใหม่ —
  // เจ้าใหม่ที่เป็น lifetime จะไม่เข้ากฎเองและไม่มีใครรู้จนกว่าจะสายเกินไป
  for (const name of ["etrackings", "track123", "thailand-post"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`["'\`]${name}["'\`]`),
      `lib/health-check.ts ห้ามอ้างชื่อ ${name} — ต้องแยกจาก readPeriod().cycle`,
    );
  }

  assert.match(
    source,
    /readPeriod\(provider\)\.cycle !== "lifetime"/,
    "การแยกต้องมาจากชนิดของรอบบิลที่ระบบมีอยู่แล้ว",
  );
});

test("⚠️ HEALTH_IGNORE_QUOTA ต้องถูกถอดออกหมด ห้ามหลงเหลือ", () => {
  const source = readFileSync("lib/health-check.ts", "utf8");

  // ห้าม **อ่าน** env ตัวนี้ · การเอ่ยถึงในคอมเมนต์ยังทำได้และควรทำด้วย —
  // คนที่มาแก้ทีหลังต้องรู้ว่าเคยมีของแบบนี้และทำไมถึงถูกถอดออก ไม่งั้นวันหนึ่ง
  // จะมีคนใส่กลับเข้ามาใหม่ด้วยความหวังดี
  assert.doesNotMatch(
    source,
    /process\.env\.HEALTH_IGNORE_QUOTA|env\["HEALTH_IGNORE_QUOTA"\]/,
    "การเพิ่ม ignore list ไม่ใช่ทางแก้ — เป็นการสะสมจุดบอด",
  );
  assert.doesNotMatch(
    source,
    /export const IGNORE_QUOTA_VAR/,
    "ค่าคงที่ที่ไม่มีใครใช้แล้วต้องถูกลบ ไม่ใช่ปล่อยค้างไว้ให้เข้าใจผิดว่ายังทำงานอยู่",
  );

  // ตั้งค่า env เก่าค้างไว้ต้องไม่มีผลอะไรทั้งสิ้น
  process.env.HEALTH_IGNORE_QUOTA = "etrackings,track123,thailand-post";
  try {
    process.env.ETRACKINGS_CALL_LIMIT = "50";
    resetProviderUsage();
    burnQuota("etrackings", 50);

    assert.deepEqual(
      providersNearQuota(),
      ["etrackings"],
      "env เก่าที่ค้างอยู่ต้องปิดปากอะไรไม่ได้อีกแล้ว",
    );
  } finally {
    delete process.env.HEALTH_IGNORE_QUOTA;
    delete process.env.ETRACKINGS_CALL_LIMIT;
    resetProviderUsage();
  }
});
