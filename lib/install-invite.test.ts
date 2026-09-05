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
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  INVITE_DELAY_MS,
  INVITE_DETAIL,
  INVITE_TITLE,
  hasSearchedThisSession,
  markSearchDone,
  readSearchContext,
  shouldShowInvite,
  type InviteConditions,
} from "./install-invite.ts";
import { ERROR_MESSAGE } from "./tracking-view.ts";
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

/* ------------------------------------------------------------------ *
 * จังหวะ "ค้นไม่เจอ" — เพิ่มเข้ามาทีหลัง ใช้การ์ดใบเดิม
 *
 * เหตุผล: คนที่เลขยังไม่ขึ้นระบบขนส่งต้องกลับมาค้นเลขเดิมอีกครั้งใน 1–2 ชั่วโมง
 * แน่นอน ซึ่งตรงกับสิ่งที่การติดตั้งช่วยได้พอดี · แต่ต้องนับแยกจากจังหวะเดิม
 * ไม่งั้นเวลาอัตราการกดขยับ เราจะแยกไม่ออกว่าเป็นเพราะอะไร
 * ------------------------------------------------------------------ */

/** storage ปลอมในหน่วยความจำ — เทสต์รันบน Node ที่ไม่มี window */
function withFakeStorage(run: () => void): void {
  const make = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  const before = {
    session: globals.sessionStorage,
    local: globals.localStorage,
    win: globals.window,
  };

  globals.sessionStorage = make();
  globals.localStorage = make();
  globals.window = { dispatchEvent: () => true };

  try {
    run();
  } finally {
    globals.sessionStorage = before.session;
    globals.localStorage = before.local;
    globals.window = before.win;
  }
}

test("ยังไม่ได้ค้นอะไร → บริบทเป็น found (ค่าเดิมก่อนมีฟิลด์นี้)", () => {
  withFakeStorage(() => {
    assert.equal(readSearchContext(), "found");
  });
});

test("ค้นเจอ → พร้อมขึ้น และบริบทเป็น found", () => {
  withFakeStorage(() => {
    markSearchDone("found");
    assert.equal(hasSearchedThisSession(), true);
    assert.equal(readSearchContext(), "found");
  });
});

test("ค้นไม่เจอ → การ์ดต้องขึ้นได้เหมือนกัน และบริบทเป็น not_found", () => {
  withFakeStorage(() => {
    markSearchDone("not_found");

    assert.equal(
      hasSearchedThisSession(),
      true,
      "ค้นไม่เจอต้องปลุกการ์ดได้ด้วย — คนกลุ่มนี้ต้องกลับมาค้นซ้ำแน่นอน",
    );
    assert.equal(readSearchContext(), "not_found");
  });
});

test("ค้นไม่เจอแล้วค้นเจอทีหลัง → บริบทเปลี่ยนตามครั้งล่าสุด", () => {
  withFakeStorage(() => {
    markSearchDone("not_found");
    markSearchDone("found");
    assert.equal(readSearchContext(), "found");
  });
});

test("หน้าค้นหาต้องเรียก markSearchDone เฉพาะ found กับ not_found เท่านั้น", () => {
  const source = readFileSync("app/tracking-search.tsx", "utf8");
  const calls = [...source.matchAll(/markSearchDone\("(\w+)"\)/g)].map(
    (m) => m[1],
  );

  assert.deepEqual(
    calls.sort(),
    ["found", "not_found"],
    "ห้ามชวนติดตั้งตอนระบบขัดข้อง — เป็นจังหวะที่เราทำงานให้เขาไม่ได้ " +
      "การขออะไรตรงนั้นคือจังหวะที่แย่ที่สุดเท่าที่จะเป็นไปได้",
  );
  assert.match(
    source,
    /if \(outcome\.notFound\) markSearchDone\("not_found"\)/,
    "ต้องผูกกับธง notFound ที่เซิร์ฟเวอร์บอกมา ไม่ใช่เดาจากข้อความ",
  );
});

test("การ์ดตอนค้นไม่เจอต้องไม่มีปุ่มเข้าสู่ระบบหรือปุ่มบันทึก", () => {
  // ข้อบังคับจากเจ้าของระบบ: ตรงจังหวะนี้ห้ามเสนอล็อกอินหรือ "บันทึกไว้"
  // และห้ามมี popup — การ์ดชวนติดตั้งใบเดิมเท่านั้น
  const source = readFileSync("app/install-invite.tsx", "utf8");

  assert.doesNotMatch(source, /เข้าสู่ระบบ|บันทึกไว้|sign-?in|login/i);
  assert.equal(
    INVITE_TITLE,
    "ติดตั้งเป็นแอป",
    "ต้องเป็นการ์ดใบเดิม ไม่ใช่ของใหม่ที่เขียนคำใหม่",
  );
});

test("ข้อความบนการ์ดค้นไม่เจอต้องอธิบายเรื่อง 1–2 ชั่วโมง และไม่โทษผู้ใช้", () => {
  const detail = ERROR_MESSAGE.not_found.detail;

  assert.match(detail, /1–2 ชั่วโมง/, "ต้องบอกเวลาที่ขนส่งใช้ก่อนเลขขึ้นระบบ");
  assert.match(detail, /อีกครั้ง|อีกสักพัก/, "ต้องบอกว่ากลับมาค้นใหม่ได้");
  assert.doesNotMatch(
    detail,
    /ตรวจ(สอบ)?ว่าพิมพ์|พิมพ์เลข.*ถูก/,
    "ห้ามขึ้นต้นด้วยการให้ผู้ใช้ไปตรวจว่าตัวเองพิมพ์ผิดไหม — " +
      "ส่วนใหญ่พิมพ์ถูกแล้ว แค่ของเพิ่งออกจากมือผู้ส่ง",
  );
});
