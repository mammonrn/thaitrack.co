/**
 * เทสต์การเรียงลำดับและตัวเลขสรุปของหน้าประวัติ
 *
 * ทั้งสองอย่างเป็นฟังก์ชันบริสุทธิ์โดยตั้งใจ จะได้ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 * และให้ผลเหมือนกันไม่ว่าข้อมูลจะมาจาก server หรือ client
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import type { TrackingStatus } from "./carriers/types.ts";
import type { LocationAccuracy } from "./geocode.ts";
import {
  LOCATION_ACCURACY_NOTICE,
  sortBySavedAtDesc,
  summarizeSavedTrackings,
  type SavedTracking,
} from "./saved-trackings.ts";

function saved(
  id: string,
  createdAt: string,
  lastStatus: TrackingStatus | null = null,
): SavedTracking {
  return {
    id,
    trackingNumber: `TH${id}`,
    carrierName: null,
    nickname: null,
    lastStatus,
    lastStatusText: null,
    lastLocationText: null,
    lastLat: null,
    lastLng: null,
    lastLocationAccuracy: null,
    lastUpdatedAt: null,
    createdAt,
  };
}

/* ---------------- ลำดับ ---------------- */

test("เรียงจากที่บันทึกล่าสุดไปเก่าสุด", () => {
  const items = [
    saved("เก่าสุด", "2026-08-01T09:00:00Z"),
    saved("ใหม่สุด", "2026-08-30T09:00:00Z"),
    saved("กลาง", "2026-08-15T09:00:00Z"),
  ];

  assert.deepEqual(
    sortBySavedAtDesc(items).map((item) => item.id),
    ["ใหม่สุด", "กลาง", "เก่าสุด"],
  );
});

test("เรียงแล้วไม่แก้อาร์เรย์เดิม", () => {
  const items = [
    saved("a", "2026-08-01T09:00:00Z"),
    saved("b", "2026-08-30T09:00:00Z"),
  ];

  sortBySavedAtDesc(items);

  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b"],
  );
});

test("บันทึกพร้อมกันเป๊ะ → ลำดับคงที่ ไม่สลับไปมา", () => {
  const same = "2026-08-30T09:00:00Z";
  const first = sortBySavedAtDesc([saved("b", same), saved("a", same)]);
  const second = sortBySavedAtDesc([saved("a", same), saved("b", same)]);

  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id),
  );
});

/* ---------------- ตัวเลขสรุป ---------------- */

test("นับสถานะเป็นกลุ่มตามที่หน้าประวัติแสดง", () => {
  const summary = summarizeSavedTrackings([
    saved("1", "2026-08-30T09:00:00Z", "pending"),
    saved("2", "2026-08-30T09:00:00Z", "in_transit"),
    saved("3", "2026-08-30T09:00:00Z", "out_for_delivery"),
    saved("4", "2026-08-30T09:00:00Z", "delivered"),
    saved("5", "2026-08-30T09:00:00Z", "delivered"),
    saved("6", "2026-08-30T09:00:00Z", "exception"),
  ]);

  assert.deepEqual(summary, {
    inTransit: 3,
    delivered: 2,
    problem: 1,
    total: 6,
  });
});

test("รายการที่ไม่มีสถานะ → นับแค่ใน total ไม่เดาแทนผู้ใช้", () => {
  const summary = summarizeSavedTrackings([
    saved("1", "2026-08-30T09:00:00Z", null),
    saved("2", "2026-08-30T09:00:00Z", "delivered"),
  ]);

  assert.deepEqual(summary, {
    inTransit: 0,
    delivered: 1,
    problem: 0,
    total: 2,
  });
});

test("ไม่มีรายการเลย → ได้ศูนย์ทั้งหมด ไม่พัง", () => {
  assert.deepEqual(summarizeSavedTrackings([]), {
    inTransit: 0,
    delivered: 0,
    problem: 0,
    total: 0,
  });
});

/* ------------------- ป้ายบอกความคลาดเคลื่อนของหมุด ------------------- */

const ACCURACY_TIERS: LocationAccuracy[] = [
  "exact",
  "approximate",
  "coarse",
  "area",
];

test("พิกัดที่แม่นแล้วต้องไม่ขึ้นป้าย ส่วนที่เหลือต้องขึ้น", () => {
  assert.equal(LOCATION_ACCURACY_NOTICE.exact, null);

  for (const tier of ["approximate", "coarse"] as const) {
    assert.ok(
      (LOCATION_ACCURACY_NOTICE[tier] ?? "").length > 0,
      `${tier} ต้องมีข้อความบอกผู้ใช้`,
    );
  }
});

test("แต่ละชั้นต้องใช้ถ้อยคำที่ต่างกันจริง", () => {
  // ถ้าใช้ประโยคเดียวกัน การแยกชั้นก็ไม่มีความหมาย — ป้ายรุ่นแรกเขียนว่า
  // "ระดับตำบล" กับความคลาดเคลื่อน 8 กม. ซึ่งทำให้ผู้ใช้เชื่อเกินความจริง
  assert.notEqual(
    LOCATION_ACCURACY_NOTICE.approximate,
    LOCATION_ACCURACY_NOTICE.coarse,
  );
});

test("ทุกชั้นที่โค้ดผลิตได้ ต้องเป็นค่าที่ฐานข้อมูลยอมรับ", () => {
  // ความผิดพลาดแบบนี้เงียบสนิทจนถึงวินาทีที่ผู้ใช้กดบันทึกแล้วโดนปฏิเสธ
  // เพราะ check constraint ไม่รู้จักค่าที่โค้ดเพิ่งเริ่มเขียน
  const sql = readFileSync(
    join(
      resolvePath(import.meta.dirname, ".."),
      "supabase/migrations/0009_location_accuracy_tiers.sql",
    ),
    "utf8",
  );

  // ชั้น area ไม่เคยถูกเขียนลงฐานข้อมูล — พิกัดชั้นนั้นไม่ถูกปักหมุดตั้งแต่ต้นทาง
  const stored = ACCURACY_TIERS.filter((tier) => tier !== "area");

  for (const table of [
    "carrier_branches_accuracy_check",
    "saved_trackings_location_accuracy_check",
  ]) {
    const at = sql.indexOf(`add constraint ${table}`);
    assert.ok(at !== -1, `ไม่เจอ constraint ${table}`);

    const body = sql.slice(at, sql.indexOf(";", at));
    for (const tier of stored) {
      assert.ok(body.includes(`'${tier}'`), `${table} ยังไม่รับค่า ${tier}`);
    }
  }
});

test("migration ต้องขยาย constraint ก่อนแก้ข้อมูล", () => {
  // สลับลำดับเมื่อไร update จะชน constraint เดิมทันทีแล้ว migration ล้มทั้งไฟล์
  const sql = readFileSync(
    join(
      resolvePath(import.meta.dirname, ".."),
      "supabase/migrations/0009_location_accuracy_tiers.sql",
    ),
    "utf8",
  );

  const lastConstraint = sql.lastIndexOf("add constraint");
  const firstUpdate = sql.indexOf("update public.");

  assert.ok(lastConstraint !== -1 && firstUpdate !== -1);
  assert.ok(lastConstraint < firstUpdate, "ต้อง add constraint ให้ครบก่อน update");
});
