/**
 * เทสต์ตัวนับโควตาของไปรษณีย์ไทย
 *
 * ══════════════════════════════════════════════════════════════════
 * สิ่งเดียวที่เทสต์ไฟล์นี้เฝ้า: **หนึ่ง request ที่ออกจากเครื่อง = นับหนึ่ง**
 *
 * ของเดิมนับครั้งเดียวที่ต้นทาง แล้วพอ token หมดอายุกลางทาง มันขอ token ใหม่
 * แล้วยิง /track ซ้ำ — รอบที่สองไม่เคยถูกนับ ตัวนับจึงต่ำกว่าความจริงเสมอ
 *
 * นับต่ำกว่าจริงอันตรายกว่านับเกิน: นับเกินทำให้ตกใจแล้วไปตรวจจนเจอ
 * ส่วนนับต่ำทำให้คิดว่ายังเหลือเยอะ แล้วชนกำแพงโดยไม่มีสัญญาณเตือนมาก่อน
 *
 * เป็นบั๊กชนิดเดียวกับที่เคยเจอใน Track123 (#24) แต่กลับด้าน — คราวนั้นนับเกิน
 * เพราะนับรอบที่ปลายทางปฏิเสธด้วย A0706 ไปด้วย
 * ══════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { resetProviderUsage, usageOf } from "../provider-usage.ts";
import type { ProviderUsageStore } from "../supabase/provider-usage.ts";
import { track } from "./thailand-post.ts";
import { CarrierError } from "./types.ts";

/** ชั้นเก็บถาวรที่ไม่ทำอะไร — เทสต์ชุดนี้สนใจแค่ตัวนับใน memory */
const silentStore: ProviderUsageStore = {
  bump: () => Promise.resolve(null),
  read: () => Promise.resolve({}),
};

const TRACK_NO = "EY145587896TH";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** คำตอบของ /track ที่มีพัสดุหนึ่งใบ */
function trackOk(): Response {
  return jsonResponse(200, {
    response: {
      items: {
        [TRACK_NO]: [
          {
            barcode: TRACK_NO,
            status: "501",
            status_description: "รับฝาก",
            status_date: "2026-09-05T10:00:00+07:00",
            location: "ศูนย์ไปรษณีย์เชียงราย",
          },
        ],
      },
    },
  });
}

/**
 * ดัก fetch แล้วจดว่าถูกเรียกไปกี่ครั้งที่ path ไหน
 *
 * `trackStatuses` คือ HTTP status ที่จะตอบให้ /track ทีละรอบตามลำดับ —
 * ใส่ [401, 200] เพื่อจำลอง token หมดอายุแล้วขอใหม่สำเร็จ
 */
function stubFetch(t: TestContext, trackStatuses: readonly number[]) {
  const calls: string[] = [];
  let trackIndex = 0;

  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url.includes("/authenticate/token") ? "auth" : "track");

    if (url.includes("/authenticate/token")) {
      return Promise.resolve(
        jsonResponse(200, { token: `tok-${calls.length}`, expire: null }),
      );
    }

    const status = trackStatuses[trackIndex] ?? 200;
    trackIndex += 1;
    return Promise.resolve(status === 200 ? trackOk() : jsonResponse(status, {}));
  }) as typeof fetch;

  return calls;
}

function prepare(t: TestContext): void {
  const before = process.env.THAILAND_POST_API_KEY;
  t.after(() => {
    if (before === undefined) delete process.env.THAILAND_POST_API_KEY;
    else process.env.THAILAND_POST_API_KEY = before;
    resetProviderUsage();
  });

  process.env.THAILAND_POST_API_KEY = "test-key";
  resetProviderUsage();
}

/** นับให้ตัวนับใน memory อย่างเดียว ไม่แตะ Supabase */
function countedCalls(): number {
  return usageOf("thailand-post");
}

test("ยิงปกติหนึ่งครั้ง → นับ 1", async (t) => {
  prepare(t);
  const calls = stubFetch(t, [200]);

  const result = await track(TRACK_NO);

  assert.equal(result.trackingNumber, TRACK_NO);
  assert.deepEqual(calls, ["auth", "track"]);
  assert.equal(countedCalls(), 1);
});

test("token หมดอายุ (401) แล้วลองใหม่สำเร็จ → นับ 2 ไม่ใช่ 1", async (t) => {
  prepare(t);
  const calls = stubFetch(t, [401, 200]);

  const result = await track(TRACK_NO);

  assert.equal(result.trackingNumber, TRACK_NO);
  // นับเฉพาะ /track ไม่ผูกกับลำดับ auth — token ถูก cache ไว้ระดับโมดูล
  // เทสต์ตัวก่อนหน้าจึงอาจทิ้ง token ที่ยังไม่หมดอายุไว้ให้ตัวนี้ใช้ต่อ
  assert.equal(
    calls.filter((c) => c === "track").length,
    2,
    "ต้องยิง /track สองครั้งจริง",
  );
  assert.ok(
    calls.includes("auth"),
    "ต้องมีการขอ token ใหม่หลังเจอ 401",
  );
  assert.equal(
    countedCalls(),
    2,
    "ของเดิมนับได้ 1 ทั้งที่ยิงไปสองครั้ง — นี่คือบั๊กที่ไฟล์นี้เฝ้าอยู่",
  );
});

test("403 แล้วลองใหม่ก็ยังไม่ผ่าน → นับ 2 และโยน auth_failed", async (t) => {
  prepare(t);
  const calls = stubFetch(t, [403, 403]);

  await assert.rejects(
    () => track(TRACK_NO),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "auth_failed",
  );

  assert.equal(calls.filter((c) => c === "track").length, 2);
  assert.equal(
    countedCalls(),
    2,
    "รอบที่ล้มก็ต้องนับ — request ออกจากเครื่องไปแล้วจริง",
  );
});

test("เลขรูปแบบผิด → ไม่ยิงและไม่นับ", async (t) => {
  prepare(t);
  const calls = stubFetch(t, [200]);

  await assert.rejects(
    () => track("!!"),
    (error: unknown) =>
      error instanceof CarrierError && error.code === "invalid_tracking_number",
  );

  assert.deepEqual(calls, [], "ไม่มี request ออกจากเครื่องเลย");
  assert.equal(countedCalls(), 0);
});

test("⚠️ ตัวนับต้องอยู่ติดกับจุดที่ยิงจริง ไม่ใช่ที่ผู้เรียก", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/carriers/thailand-post.ts", "utf8");

  // ต้องมีที่เดียว และต้องอยู่ใน requestTracking() ซึ่งเป็นฟังก์ชันเดียวที่
  // ยิง /track ออกไปจริง · ถ้าย้ายกลับไปที่ trackOnce บั๊กเดิมจะกลับมาทันที
  assert.equal(
    source.match(/await countProviderCall\("thailand-post"\)/g)?.length,
    1,
    "ต้องนับที่เดียว",
  );

  const inRequestTracking = source
    .slice(source.indexOf("async function requestTracking"))
    .slice(0, 400);
  assert.match(
    inRequestTracking,
    /await countProviderCall\("thailand-post"\)/,
    "ตัวนับต้องอยู่ใน requestTracking() ซึ่งเป็นจุดที่ยิงจริง",
  );
});
