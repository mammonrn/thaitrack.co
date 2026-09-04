/**
 * เทสต์รายงานที่ export จากหน้าแอดมิน
 *
 * ข้อที่สำคัญที่สุดคือข้อสุดท้าย: **รายงานต้องไม่มีอะไรที่ระบุตัวบุคคลได้**
 * ไฟล์ที่ดาวน์โหลดไปแล้วเดินทางต่อไปที่ไหนก็ได้ ต่างจากหน้าเว็บที่ต้องล็อกอินดู
 * การรั่วตรงนี้จึงร้ายแรงกว่า และมองไม่เห็นจนกว่าจะมีคนเปิดไฟล์อ่าน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  reportFileName,
  toJson,
  toMarkdown,
  type ReportData,
} from "./admin-report.ts";

function sample(): ReportData {
  return {
    generatedAt: "2026-09-04T18:30:00.000Z",
    windowDays: 30,
    members: { total: 6, new7d: 6, new30d: 6 },
    activity: { active7d: 2, activePrev7d: 0, returned: 0, saves7d: 28 },
    searchAllTime: { total: 331, found: 177, notFound: 112, error: 42 },
    searchWindow: {
      total: 331,
      found: 177,
      notFound: 112,
      error: 42,
      fromCache: 44,
      fromApi: 133,
      stale: 0,
    },
    efficiency: [
      { day: "2026-09-03", total: 100, fromApi: 40, fromCache: 20, failed: 40 },
      { day: "2026-09-04", total: 50, fromApi: 10, fromCache: 30, failed: 10 },
    ],
    carriers: [{ carrierCode: "shopee-xpress-th", total: 40 }],
    errors: [{ reason: "upstream_error", upstreamCode: null, total: 24 }],
    latency: [{ source: "api", label: "ยิงถามขนส่ง", p50Ms: 1711, p95Ms: 2319, total: 133 }],
    unfoundShapes: [{ shape: "############", total: 18 }],
    unknownCourierFailures: 22,
    quotas: [
      {
        provider: "track123",
        label: "Track123",
        used: 575,
        quota: 300,
        reserve: 0,
        period: "2026-08-29",
      },
    ],
    branches: { known: 0, unknown: 5 },
    installs: { total: 2, last7d: 0, last30d: 2 },
    invite: { shown: 8, clicked: 3, dismissed: 0 },
    referrers: [{ channel: "direct", last7d: 5, last30d: 20 }],
    settings: { map_enabled: false },
  };
}

/* ------------------------------ ชื่อไฟล์ ------------------------------ */

test("ชื่อไฟล์มีวันเวลาไทย และนามสกุลตรงกับรูปแบบ", () => {
  // 18:30 UTC = 01:30 ของวันถัดไปตามเวลาไทย — ต้องได้ 0905 ไม่ใช่ 0904
  assert.equal(
    reportFileName("2026-09-04T18:30:00.000Z", "json"),
    "thaitrack-stats-202609050130.json",
  );
  assert.match(reportFileName("2026-09-04T18:30:00.000Z", "md"), /\.md$/);
});

/* ------------------------------ JSON ------------------------------ */

test("JSON อ่านกลับมาได้ครบทุกฟิลด์", () => {
  const data = sample();
  assert.deepEqual(JSON.parse(toJson(data)), data);
});

test("JSON จัดฟอร์แมตให้คนอ่านได้ ไม่ใช่บรรทัดเดียวยาว", () => {
  assert.ok(toJson(sample()).includes("\n"));
});

/* ---------------------------- Markdown ---------------------------- */

test("Markdown มีครบทุกหัวข้อที่อยู่บนหน้าเว็บ", () => {
  const md = toMarkdown(sample());

  for (const heading of [
    "# รายงานสถิติ",
    "## สมาชิก",
    "## การกลับมาใช้ซ้ำ",
    "## การค้นหา",
    "## ค้นหา เทียบ โควตาที่ใช้จริง (รายวัน)",
    "## ขนส่งที่ค้นเจอบ่อย",
    "## ความล้มเหลว",
    "## เวลาตอบสนอง",
    "## โควตาผู้ให้บริการ",
    "## พิกัดสาขา",
    "## การติดตั้งแอป",
    "## ช่องทางที่มา",
    "## สวิตช์ระบบ",
  ]) {
    assert.ok(md.includes(heading), `ขาดหัวข้อ ${heading}`);
  }
});

test("ตารางรายวันมีครบทุกวันพร้อมสัดส่วนที่ยิงจริง", () => {
  const md = toMarkdown(sample());
  assert.ok(md.includes("2026-09-03"), "ขาดวันที่");
  assert.ok(md.includes("40%"), "40/100 ต้องเป็น 40%");
  assert.ok(md.includes("20%"), "10/50 ต้องเป็น 20%");
});

test("หารด้วยศูนย์ → ขีด ไม่ใช่ 0% หรือ NaN", () => {
  const data = sample();
  data.efficiency = [{ day: "2026-09-05", total: 0, fromApi: 0, fromCache: 0, failed: 0 }];

  const md = toMarkdown(data);
  assert.ok(!md.includes("NaN"), "ห้ามมี NaN หลุดไปถึงไฟล์");
  assert.ok(md.includes("—"));
});

test("ช่วงที่ไม่มีข้อมูล → บอกตรงๆ ไม่ใช่ตารางเปล่า", () => {
  const data = sample();
  data.carriers = [];
  assert.ok(toMarkdown(data).includes("_(ไม่มีข้อมูลในช่วงนี้)_"));
});

test("สวิตช์แสดงเป็นคำว่าเปิด/ปิด ไม่ใช่ true/false", () => {
  const md = toMarkdown(sample());
  assert.ok(md.includes("`map_enabled`"));
  assert.ok(md.includes("ปิด"));
});

/* ------------------- ข้อบังคับความเป็นส่วนตัว ------------------- */

test("รายงานต้องไม่มีอะไรที่ระบุตัวบุคคลได้", () => {
  const data = sample();
  const outputs = [toJson(data), toMarkdown(data)];

  for (const text of outputs) {
    for (const forbidden of [
      "@",           // อีเมล
      "user_id",
      "userId",
      "trackingNumber",
      "tracking_number",
      "ip_address",
    ]) {
      assert.ok(
        !text.includes(forbidden),
        `รายงานมี "${forbidden}" ซึ่งห้ามมีเด็ดขาด`,
      );
    }
  }
});

test("ชนิดของทุกฟิลด์ในรายงานต้องเป็นตัวเลข สตริง หรือ boolean เท่านั้น", () => {
  // กันคนเผลอยัดออบเจ็กต์ดิบจากฐานข้อมูลเข้ามาทั้งก้อน ซึ่งอาจพ่วงฟิลด์ที่
  // ไม่ได้ตั้งใจให้ออกไปกับไฟล์
  function walk(value: unknown, path: string): void {
    if (value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
      return;
    }
    assert.ok(
      ["number", "string", "boolean"].includes(typeof value),
      `${path} เป็น ${typeof value}`,
    );
  }

  walk(sample(), "report");
});
