/**
 * เทสต์ช่วงเวลาของหน้าสถิติ
 *
 * รันด้วย `npm test`
 *
 * สองเรื่องที่เฝ้าไว้:
 *   1. ค่าจาก URL ต้องไม่หลุดเข้าไปเป็น p_days ของฐานข้อมูลได้ตามใจ
 *   2. **ตัวเลขที่ควรนิ่งต้องนิ่ง** — ยอดสะสมตลอดกาล โควตาตามรอบบิล และ
 *      ตารางที่เทียบสองช่วงในตัวเอง ต้องไม่ขยับตามปุ่ม ไม่งั้นคนอ่านจะเข้าใจว่า
 *      "ติดตั้งทั้งหมด" ลดลงเพราะเลือก 1 วัน ซึ่งไม่จริงและน่าตกใจโดยไม่จำเป็น
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DEFAULT_WINDOW_DAYS,
  REFERRER_LONG_DAYS,
  REFERRER_SHORT_DAYS,
  WINDOW_OPTIONS,
  readWindowDays,
} from "./admin-window.ts";

const PAGE = readFileSync("app/admin/stats/page.tsx", "utf8");

/* ---------------- ค่าที่มาจาก URL ---------------- */

test("ค่าที่อยู่ในชุดปิด → ใช้ได้ทุกตัว", () => {
  for (const option of WINDOW_OPTIONS) {
    assert.equal(readWindowDays(String(option)), option);
  }
});

test("ไม่ส่งอะไรมา → ได้ค่าเริ่มต้น 30 วัน เท่าเดิมกับก่อนมีปุ่ม", () => {
  assert.equal(readWindowDays(undefined), 30);
  assert.equal(DEFAULT_WINDOW_DAYS, 30);
});

test("ค่าประหลาดจาก URL ต้องตกกลับเป็นค่าเริ่มต้น ไม่ใช่ไหลเข้าฐานข้อมูล", () => {
  // ทุกค่าตรงนี้เคยเป็นช่องโหว่ได้ถ้าแปลงเป็นตัวเลขแล้วส่งต่อดื้อๆ
  for (const evil of [
    "0", // 0 แปลว่า "ตลอดกาล" ในฟังก์ชัน SQL — ห้ามให้ URL สั่งได้
    "-1",
    "9999",
    "1.5",
    "1e3",
    "seven",
    "",
    "7; drop table search_events",
    "30, 0",
  ]) {
    assert.equal(
      readWindowDays(evil),
      DEFAULT_WINDOW_DAYS,
      `ค่า ${JSON.stringify(evil)} ต้องไม่ผ่าน`,
    );
  }
});

test("ข้อบังคับที่แท้จริง: ค่าที่คืนออกมาต้องอยู่ในชุดปิดเสมอ", () => {
  // ด่านนี้สำคัญกว่าด่านข้างบน เพราะเป็นสิ่งที่ฐานข้อมูลต้องพึ่งได้จริง —
  // ไม่ว่าใครจะยัดอะไรมาทาง URL ค่าที่ไหลต่อไปเป็น p_days ต้องเป็นหนึ่งใน
  // WINDOW_OPTIONS เท่านั้น
  //
  // ⚠️ " 7 " คืน 7 ไม่ใช่ค่าเริ่มต้น ซึ่ง **ถูกต้องแล้ว** — Number() ตัดช่องว่าง
  // ให้เอง และ 7 ก็อยู่ในชุดปิดอยู่ดี จึงไม่ใช่ช่องโหว่ แค่การรับค่าที่ผ่อนปรน
  const inputs = [
    undefined,
    "",
    " 7 ",
    "7.0",
    "0",
    "-1",
    "9999",
    "seven",
    "1e3",
    "null",
    "NaN",
    "Infinity",
    "0x1e",
    "7; drop table search_events",
    ["30"],
    ["evil", "1"],
    [],
  ];

  for (const input of inputs) {
    const result = readWindowDays(input as string | string[] | undefined);
    assert.ok(
      (WINDOW_OPTIONS as readonly number[]).includes(result),
      `ค่า ${JSON.stringify(input)} ให้ผลลัพธ์ ${result} ซึ่งหลุดชุดปิด`,
    );
  }
});

test("ส่งซ้ำหลายค่า (?days=1&days=30) → ใช้ตัวแรก", () => {
  assert.equal(readWindowDays(["1", "30"]), 1);
  assert.equal(readWindowDays(["evil", "1"]), DEFAULT_WINDOW_DAYS);
});

/* ---------------- ตัวไหนควรขยับ ตัวไหนไม่ควร ---------------- */

test("ตัวเลขที่ผูกกับช่วงเวลา ต้องรับ windowDays ทุกตัว", () => {
  const followers = [
    "readSearchOverview(windowDays)",
    "readSearchDaily(windowDays)",
    "readTopCarriers(windowDays, TOP_CARRIER_LIMIT)",
    "readErrorBreakdown(windowDays)",
    "readLatency(windowDays)",
    "readLatencyGaps(windowDays)",
    "readUnknownCourierFailures(windowDays)",
    "readInstallPromptStats(windowDays)",
    "readUnfoundShapes(windowDays, UNFOUND_SHAPE_LIMIT)",
    "readSearchEfficiency(windowDays)",
  ];

  for (const call of followers) {
    assert.ok(PAGE.includes(call), `${call} ต้องวิ่งตามปุ่ม แต่ไม่พบในหน้า`);
  }
});

test("⚠️ ตัวเลขที่ต้องนิ่ง ห้ามรับ windowDays เด็ดขาด", () => {
  // แต่ละตัวมีเหตุผลของตัวเอง เขียนไว้ให้คนที่มาแก้ทีหลังเห็นว่าทำไม
  const frozen: Record<string, string> = {
    "readSearchOverview(0)":
      "ยอดค้นหาสะสมตลอดกาล — 0 แปลว่าตั้งแต่ต้น ไม่ใช่ศูนย์วัน",
    "readMemberStats()":
      "จำนวนสมาชิกทั้งหมด กับยอดสมัครใหม่ 7/30 วันที่ตรึงไว้ในตัวฟังก์ชันเอง",
    "readMemberActivity()":
      "การกลับมาใช้ซ้ำ วัดจากหน้าต่าง 7 วันสองช่วงติดกัน เปลี่ยนช่วงแล้วความหมายหาย",
    "readInstallStats()":
      "ยอดติดตั้งสะสมตลอดกาล — เลือก 1 วันแล้วเห็นยอดลดคือความเข้าใจผิด",
    "countBranches()": "จำนวนสาขาที่มีพิกัด เป็นสถานะปัจจุบัน ไม่ใช่ช่วงเวลา",
    "listProviderUsage(periods)":
      "โควตาผูกกับรอบบิลของแต่ละเจ้า ซึ่งไม่ตรงกับหน้าต่างที่เราเลือกเลย",
    "readReferrerChannels(REFERRER_SHORT_DAYS)":
      "ตารางช่องทางเทียบสองช่วงในตัวเอง (7 กับ 30) ปล่อยให้วิ่งตามปุ่มแล้วอ่านไม่รู้เรื่อง",
    "readReferrerChannels(REFERRER_LONG_DAYS)": "เหตุผลเดียวกับข้างบน",
  };

  for (const [call, why] of Object.entries(frozen)) {
    assert.ok(PAGE.includes(call), `${call} หายไปจากหน้า — ${why}`);
  }

  // กันการเผลอเปลี่ยนตัวที่ต้องนิ่งให้วิ่งตามปุ่ม
  for (const reader of [
    "readMemberStats",
    "readMemberActivity",
    "readInstallStats",
    "countBranches",
  ]) {
    assert.doesNotMatch(
      PAGE,
      new RegExp(`${reader}\\(\\s*windowDays`),
      `${reader} ต้องไม่รับ windowDays — ${frozen[`${reader}()`] ?? ""}`,
    );
  }

  assert.doesNotMatch(
    PAGE,
    /readReferrerChannels\(\s*windowDays/,
    "ตารางช่องทางเข้าเว็บต้องยึด 7/30 วันเสมอ",
  );
  assert.equal(REFERRER_SHORT_DAYS, 7);
  assert.equal(REFERRER_LONG_DAYS, 30);
});

/* ---------------- ปุ่มกับรายงาน ---------------- */

test("ปุ่มต้องเป็นลิงก์ที่ใส่ค่าลง URL ไม่ใช่ state ในหน้า", () => {
  assert.match(
    PAGE,
    /href=\{`\/admin\/stats\?days=\$\{option\}`\}/,
    "ค่าที่เลือกต้องอยู่ใน URL ไม่งั้น refresh แล้วหาย และส่งลิงก์ให้กันไม่ได้",
  );
  assert.doesNotMatch(PAGE, /"use client"/, "หน้านี้ต้องยังเป็น server component");
});

test("รายงานที่ export ต้องใช้ช่วงเดียวกับที่แสดงอยู่", () => {
  assert.match(
    PAGE,
    /windowDays,/,
    "ReportData.windowDays ต้องมาจากค่าที่เลือก ไม่ใช่ 30 ตายตัว",
  );
  assert.doesNotMatch(
    PAGE,
    /windowDays:\s*30/,
    "ห้ามฮาร์ดโค้ด 30 ลงในรายงาน",
  );

  // หัวรายงานต้องบอกช่วงที่ใช้จริง
  const report = readFileSync("lib/admin-report.ts", "utf8");
  assert.match(report, /ช่วงที่แสดง \$\{data\.windowDays\} วันล่าสุด/);
});

test("หมายเหตุแถวที่ไม่มีค่าเวลา ต้องมาจากการนับจริง ไม่ใช่เลขคงที่", () => {
  assert.match(PAGE, /latencyGaps > 0/);
  assert.match(PAGE, /count\(latencyGaps\)/);
  assert.doesNotMatch(
    PAGE,
    /ไม่รวม 2 ครั้ง/,
    "ห้ามฮาร์ดโค้ดจำนวน — แถวพวกนี้จะทยอยหลุดหน้าต่างเวลาไปเอง",
  );
});
