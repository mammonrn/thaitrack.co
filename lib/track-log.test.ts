/**
 * เทสต์รูปแบบ log ของการค้นหาหนึ่งครั้ง
 *
 * รูปแบบคือสัญญากับคำสั่งนับใน README ถ้าเปลี่ยนคำหรือลำดับโดยไม่ตั้งใจ
 * คำสั่งนับ cache hit rate จะให้ตัวเลขผิดโดยไม่มีอะไรเตือน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTrackLog } from "./track-log.ts";

const BASE = {
  ts: 1756531234567,
  trackNo: "EY145587896TH",
  route: "track",
  stale: false,
  shared: false,
  tookMs: 12,
} as const;

test("คำค้นที่จบที่ชั้น memory", () => {
  assert.equal(
    formatTrackLog({ ...BASE, source: "memory" }),
    "[track] ts=1756531234567 no=EY145587896TH route=track source=memory" +
      " stale=no shared=no took=12ms",
  );
});

test("คำค้นที่ต้องยิง API จริง", () => {
  assert.match(formatTrackLog({ ...BASE, source: "api" }), / source=api /);
});

test("คืนข้อมูลเก่าเพราะขนส่งล่ม → บอกทั้ง stale และสาเหตุ", () => {
  const line = formatTrackLog({
    ...BASE,
    source: "supabase",
    stale: true,
    tookMs: 1503,
    reason: "rate_limited",
  });

  assert.equal(
    line,
    "[track] ts=1756531234567 no=EY145587896TH route=track source=supabase" +
      " stale=yes shared=no took=1503ms reason=rate_limited",
  );
});

test("ไม่มีสาเหตุ → ไม่ต้องมีฟิลด์ reason ห้อยท้ายมาเปล่าๆ", () => {
  assert.doesNotMatch(formatTrackLog({ ...BASE, source: "memory" }), /reason=/);
});

test("ทุกบรรทัดขึ้นต้นด้วย [track] และเป็นบรรทัดเดียวเสมอ", () => {
  const sources = ["memory", "supabase", "api", "error"] as const;

  for (const source of sources) {
    const line = formatTrackLog({ ...BASE, source });
    assert.ok(line.startsWith("[track] "));
    assert.doesNotMatch(line, /\n/, "ขึ้นบรรทัดใหม่จะทำให้ grep นับเกินจริง");
  }
});

test("แยกจาก log ของ [track123] ได้ — ไม่งั้นคำสั่งนับจะปนกัน", () => {
  const line = formatTrackLog({ ...BASE, source: "api" });

  // grep '\[track123\]' ต้องไม่ไปโดนบรรทัดนี้ด้วย
  assert.doesNotMatch(line, /\[track123\]/);
});
