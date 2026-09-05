/**
 * เทสต์เวลารอของปุ่ม "ลองอีกครั้ง"
 *
 * สิ่งที่เฝ้า: **การรอต้องเพิ่มขึ้นเมื่อกดแล้วยังล้ม และต้องมีเพดาน**
 * ถ้าไม่เพิ่ม คนจะกดรัวจนล้มซ้ำแล้วเลิกไปเลย (ของจริงที่เจอในสถิติ:
 * ผู้ใช้รายหนึ่งกด 3 ครั้งใน 33 วินาที ล้มทั้งสามครั้ง)
 * ถ้าไม่มีเพดาน ตัวเลขจะโตจนไม่มีใครรอ ซึ่งเท่ากับไม่มีปุ่ม
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  FIRST_RETRY_SECONDS,
  MAX_RETRY_SECONDS,
  retryDelaySeconds,
} from "./retry-delay.ts";

test("ครั้งแรกรอ 10 วินาที", () => {
  assert.equal(FIRST_RETRY_SECONDS, 10);
  assert.equal(retryDelaySeconds(0), 10);
});

test("กดแล้วยังล้ม → รอนานขึ้นเป็นสองเท่า จนชนเพดาน", () => {
  assert.equal(retryDelaySeconds(1), 20);
  assert.equal(retryDelaySeconds(2), 40);
  assert.equal(retryDelaySeconds(3), 40, "ต้องไม่เกินเพดาน");
  assert.equal(retryDelaySeconds(99), MAX_RETRY_SECONDS);
});

test("ค่าที่ผิดรูป → ไม่ติดลบ ไม่เป็นศูนย์", () => {
  for (const bad of [-1, -99]) {
    assert.equal(retryDelaySeconds(bad), FIRST_RETRY_SECONDS);
  }
});

test("ปรับได้ผ่านค่าคงที่ที่ export ไว้ ไม่ต้องไล่แก้หลายที่", () => {
  const source = readFileSync("lib/retry-delay.ts", "utf8");
  assert.equal(
    (source.match(/\b10\b/g) ?? []).filter(Boolean).length >= 1,
    true,
  );
  // ตัวเลขต้องไม่ถูกฮาร์ดโค้ดซ้ำในหน้าค้นหา
  const page = readFileSync("app/tracking-search.tsx", "utf8");
  assert.match(page, /retryDelaySeconds\(/);
  assert.doesNotMatch(
    page,
    /setRetryIn\(\s*\d+\s*\)/,
    "ห้ามฮาร์ดโค้ดวินาทีลงในหน้า — ต้องมาจาก retryDelaySeconds ที่เดียว",
  );
});

/* ---------------- ปุ่มต้องขึ้นถูกที่ ---------------- */

test("🔴 ปุ่มต้องขึ้นเฉพาะ upstream_error ห้ามขึ้นตอน not_found", () => {
  const view = readFileSync("lib/tracking-view.ts", "utf8");

  assert.match(
    view,
    /retryable: code === "upstream_error"/,
    "เลขที่ขนส่งบอกว่าไม่มี ลองใหม่กี่ครั้งก็ไม่มี — ปุ่มตรงนั้นคือการหลอก" +
      "ให้เสียเวลาและเผาโควตาฟรี",
  );

  const page = readFileSync("app/tracking-search.tsx", "utf8");
  assert.match(page, /\{retryable && \(/, "ปุ่มต้องผูกกับธง retryable");
});

test("🔴 ปุ่มต้องใช้เส้นทางค้นหาเดิม ห้ามสร้างเส้นทางที่สอง", () => {
  const page = readFileSync("app/tracking-search.tsx", "utf8");

  // บทเรียนเดิมจาก saved-snapshot: ตรรกะที่ต้องมีที่เดียว ถ้าปล่อยให้ก๊อป
  // ไปวางที่สอง สองที่จะค่อยๆ เพี้ยนออกจากกันโดยไม่มีใครสังเกต
  assert.match(
    page,
    /applyOutcome\(await requestTracking\(trackingNumber, fetch, courierHint, true\)\)/,
    "ต้องเรียก requestTracking ตัวเดิม ต่างแค่ธง retried",
  );
  assert.doesNotMatch(
    page,
    /fetch\("\/api\/track"/,
    "ห้ามยิง /api/track เองตรงๆ ในหน้า",
  );
});

test("ธง retried ต้องไหลไปถึงสถิติ และต้องไม่เปลี่ยนพฤติกรรมการค้นหา", () => {
  const route = readFileSync("app/api/track/route.ts", "utf8");

  assert.match(route, /retried,/, "ต้องบันทึกลง search_events");
  // ธงนี้ห้ามไปโผล่ใน options ของ resolveTracking
  assert.doesNotMatch(
    route,
    /resolveTracking\([^)]*retried/,
    "ธงนี้ไหลไปสถิติอย่างเดียว ห้ามเปลี่ยนพฤติกรรมการค้นหา",
  );
});

test("ข้อความ upstream_error ต้องไม่มีตัวเลขเวลาและไม่อ้างสถิติ", () => {
  const view = readFileSync("lib/tracking-view.ts", "utf8");
  const block = view.slice(
    view.indexOf("upstream_error: {"),
    view.indexOf("upstream_error: {") + 400,
  );

  // ข้อความบนเว็บไม่มีกลไกอัปเดตตามความจริง วันที่ปลายทางแย่ลง ตัวเลขหรือ
  // คำสัญญาที่เขียนไว้จะกลายเป็นคำโกหกที่ค้างอยู่โดยไม่มีใครรู้
  assert.doesNotMatch(block, /\d+\s*[–-]\s*\d+\s*นาที/, "ห้ามใส่ช่วงเวลา");
  assert.doesNotMatch(block, /สถิติ|เกือบทุกราย|ส่วนใหญ่/, "ห้ามอ้างสถิติ");
  assert.match(block, /ไม่ใช่ปัญหาที่เลขพัสดุของคุณ/);
});
