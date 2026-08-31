/**
 * เทสต์การเรียงลำดับและตัวเลขสรุปของหน้าประวัติ
 *
 * ทั้งสองอย่างเป็นฟังก์ชันบริสุทธิ์โดยตั้งใจ จะได้ทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 * และให้ผลเหมือนกันไม่ว่าข้อมูลจะมาจาก server หรือ client
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrackingStatus } from "./carriers/types.ts";
import {
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
