/**
 * เทสต์กติกาของปุ่มลอยชวนติดตั้งแอป
 *
 * สิ่งที่ต้องไม่หลุดเด็ดขาด เรียงตามความเสียหายถ้าพลาด:
 *   1. ติดตั้งไปแล้ว → ห้ามขึ้น (ตื๊อคนที่ทำตามที่เราขอไปแล้ว)
 *   2. กดปิดแล้ว → ห้ามขึ้นอีก ไม่มีวันหมดอายุ
 *   3. ยังไม่ได้ค้นอะไร → ห้ามขึ้น (ยังไม่ได้พิสูจน์คุณค่าอะไรให้เขาเลย)
 *   4. กดแล้วไม่มีอะไรเกิดขึ้น (unsupported/checking) → ห้ามขึ้น
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INVITE_DELAY_MS,
  INVITE_DETAIL,
  INVITE_TITLE,
  shouldShowInvite,
  type InviteConditions,
} from "./install-invite.ts";
import type { InstallState } from "./use-install-state.ts";

/** เงื่อนไขที่ครบทุกข้อ — เทสต์แต่ละตัวค่อยพังทีละข้อจากตรงนี้ */
const READY: InviteConditions = {
  state: "promptable",
  searched: true,
  dismissed: false,
  narrow: true,
};

test("ครบทุกเงื่อนไข → ขึ้น", () => {
  assert.equal(shouldShowInvite(READY), true);
});

test("iOS ที่ต้องกดเพิ่มเอง → ขึ้นเหมือนกัน เพราะยังติดตั้งได้จริง", () => {
  assert.equal(shouldShowInvite({ ...READY, state: "manual" }), true);
});

/* ---------------- ข้อที่พลาดแล้วเสียหายที่สุด ---------------- */

test("เปิดอยู่ในโหมดแอพแล้ว → ห้ามขึ้นเด็ดขาด", () => {
  // คนกลุ่มนี้ทำตามที่เราขอไปแล้ว การชวนซ้ำคือการตื๊อล้วนๆ
  // และเป็นการบอกเขาว่าเราไม่รู้ด้วยซ้ำว่าเขาติดตั้งไปแล้ว
  assert.equal(shouldShowInvite({ ...READY, state: "installed" }), false);
});

test("ติดตั้งแล้วแต่เงื่อนไขอื่นครบทุกทาง → ก็ยังห้ามขึ้น", () => {
  // ไล่ทุกส่วนผสมที่เหลือ เพื่อกันการแก้ในอนาคตที่เผลอทำให้ installed หลุดออกมา
  // ทางใดทางหนึ่ง เช่นเปลี่ยนลำดับ if แล้วมีเงื่อนไขอื่นมาคืน true ก่อน
  for (const searched of [true, false]) {
    for (const dismissed of [true, false]) {
      for (const narrow of [true, false]) {
        assert.equal(
          shouldShowInvite({ state: "installed", searched, dismissed, narrow }),
          false,
          `installed ต้องไม่ขึ้น (searched=${searched} dismissed=${dismissed} narrow=${narrow})`,
        );
      }
    }
  }
});

test("กดปิดไปแล้ว → ไม่ขึ้นอีก", () => {
  assert.equal(shouldShowInvite({ ...READY, dismissed: true }), false);
});

test("ยังไม่ได้ค้นอะไรสำเร็จ → ไม่ขึ้น แม้จะติดตั้งได้ก็ตาม", () => {
  assert.equal(shouldShowInvite({ ...READY, searched: false }), false);
});

test("จอกว้าง → ไม่ขึ้น เพราะมีปุ่มดาวน์โหลดบนหัวเว็บอยู่แล้ว", () => {
  assert.equal(shouldShowInvite({ ...READY, narrow: false }), false);
});

test("สถานะที่กดแล้วไม่มีอะไรเกิดขึ้น → ไม่ขึ้น", () => {
  for (const state of ["checking", "unsupported"] as const satisfies readonly InstallState[]) {
    assert.equal(
      shouldShowInvite({ ...READY, state }),
      false,
      `${state} ต้องไม่ขึ้น`,
    );
  }
});

/* ---------------- ค่าคงที่ที่มีเหตุผลผูกอยู่ ---------------- */

test("หน่วงนานพอให้อ่านผลลัพธ์ก่อน แต่ไม่นานจนคนปิดหน้าไปแล้ว", () => {
  // ต่ำกว่า 2 วิ = แย่งความสนใจจากคำตอบที่เพิ่งได้มา
  // เกิน 8 วิ = คนอ่านจบแล้วปิดหน้าไปก่อน คำชวนไม่มีใครเห็น
  assert.ok(INVITE_DELAY_MS >= 2_000, "เร็วเกินไป");
  assert.ok(INVITE_DELAY_MS <= 8_000, "ช้าเกินไป");
});

test("ถ้อยคำต้องบอกว่าได้อะไร ไม่ใช่คำโฆษณาลอยๆ", () => {
  assert.equal(INVITE_TITLE, "ติดตั้งเป็นแอป");

  // ห้ามอ้างว่าค้นหาเร็วขึ้น — การติดตั้งไม่ได้ทำให้ยิง API เร็วขึ้นเลยสักนิด
  // เป็นคำที่เขียนง่ายและตรวจสอบไม่ได้ ซึ่งเป็นนิยามของคำโฆษณาที่เราไม่เอา
  assert.doesNotMatch(INVITE_DETAIL, /เร็ว/);
  assert.match(INVITE_DETAIL, /หน้าจอหลัก/);
});
