/**
 * เทสต์การกันคำขอซ้ำที่บินพร้อมกัน (cache stampede)
 *
 * ══════════════════════════════════════════════════════════════════
 * เคสจริงที่เฝ้า: ผู้ใช้มีพัสดุ 5 ใบผ่านสาขาเดียวกัน หน้าประวัติโหลดภาพทั้ง 5
 * พร้อมกัน ทุกตัว cache miss ก่อนตัวแรกเขียน cache เสร็จ
 *
 * ถ้าไม่กัน → จ่าย Google 5 ครั้งสำหรับภาพเดียวกันเป๊ะ
 *
 * ⚠️ เทสต์ชุดนี้ยิงพร้อมกันจริงด้วย Promise.all ไม่ใช่ตรวจลำดับในซอร์ส —
 * การกันคำขอซ้ำเป็นเรื่องของ "จังหวะเวลา" ซึ่งอ่านจากโค้ดแล้วมั่นใจไม่ได้
 * ══════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clearMapCache, lookupMapImage, mapCacheStats } from "./map-cache.ts";
import {
  clearInflightMaps,
  fetchMapImage,
  inflightMapCount,
} from "./map-image.ts";

const PNG = new Uint8Array([137, 80, 78, 71]);

interface Harness {
  fetchImpl: typeof fetch;
  /** จำนวนครั้งที่ยิงออกไปจริง */
  calls: () => number;
  /** จำนวนครั้งที่ตัวนับถูกเรียก */
  counted: () => number;
  count: () => Promise<void>;
  exhausted: () => boolean;
  /** ปล่อยให้คำตอบที่ค้างอยู่เดินต่อ */
  release: () => void;
}

/**
 * ตัวยิงปลอมที่ **ค้างไว้จนกว่าจะสั่งปล่อย**
 *
 * จำเป็นต้องค้าง ไม่งั้นคำขอแรกจะเสร็จก่อนคำขอที่สองจะเริ่ม แล้วเทสต์จะผ่าน
 * ด้วยเหตุผลที่ผิด (cache hit แทนที่จะเป็นการเกาะคำขอเดิม)
 */
function harness(options: { status?: number; type?: string } = {}): Harness {
  let calls = 0;
  let counted = 0;
  let released = false;
  const waiters: Array<() => void> = [];

  return {
    calls: () => calls,
    counted: () => counted,
    count: () => {
      counted += 1;
      return Promise.resolve();
    },
    exhausted: () => false,
    release: () => {
      // ⚠️ ต้องจำว่าเคยปล่อยแล้ว ไม่ใช่แค่ปลุกคนที่รออยู่ตอนนี้ — factory เดิน
      // ถึง fetch ช้ากว่าที่เทสต์เรียก release() ได้ ถ้าไม่จำ คนที่มาทีหลังจะ
      // ค้างตลอดกาลแล้ว test runner จะล้มด้วย "event loop has already resolved"
      released = true;
      for (const go of waiters.splice(0)) go();
    },
    fetchImpl: (async () => {
      calls += 1;
      if (!released) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      const status = options.status ?? 200;
      return new Response(status === 200 ? PNG : null, {
        status,
        headers: { "content-type": options.type ?? "image/png" },
      });
    }) as unknown as typeof fetch,
  };
}

/** ปล่อยให้ microtask กับ macrotask ที่ค้างอยู่เดินจนสุด */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function reset(): void {
  clearMapCache();
  clearInflightMaps();
}

test("🔴 ยิงพิกัดเดียวกัน 5 ตัวพร้อมกัน → fetch ครั้งเดียว นับครั้งเดียว", async () => {
  reset();
  const h = harness();

  const all = Promise.all(
    Array.from({ length: 5 }, () =>
      fetchMapImage("k", "https://example.test/map", {
        fetchImpl: h.fetchImpl,
        count: h.count,
        exhausted: h.exhausted,
        now: 1_000,
      }),
    ),
  );

  // รอให้ factory เดินไปถึงจุดที่ยิงจริงก่อนตรวจ
  await settle();

  // ทั้งห้าต้องไปเกาะคำขอเดียวกัน — ทะเบียนจึงมีแค่หนึ่ง
  assert.equal(inflightMapCount(), 1, "ต้องมีคำขอบินอยู่แค่หนึ่ง");
  assert.equal(h.calls(), 1, "ยิงไปแล้วครั้งเดียวตั้งแต่ยังไม่ได้คำตอบ");

  h.release();
  const results = await all;

  assert.equal(h.calls(), 1, "ต้องยิง Google ครั้งเดียว");
  assert.equal(h.counted(), 1, "ต้องนับครั้งเดียว — ผู้เกาะไม่ใช่คนจ่าย");
  assert.equal(results.length, 5);
  for (const r of results) {
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.body, PNG);
  }
});

test("พิกัดคนละที่ยิงพร้อมกัน → ยิงแยกกันตามปกติ", async () => {
  reset();
  const h = harness();

  const all = Promise.all(
    ["a", "b", "c"].map((key) =>
      fetchMapImage(key, "https://example.test/map", {
        fetchImpl: h.fetchImpl,
        count: h.count,
        exhausted: h.exhausted,
        now: 1_000,
      }),
    ),
  );

  await settle();
  assert.equal(inflightMapCount(), 3);
  h.release();
  await all;

  assert.equal(h.calls(), 3);
  assert.equal(h.counted(), 3);
});

test("เสร็จแล้วต้องเข้า cache — คำขอรอบถัดไปไม่ยิงอีก", async () => {
  reset();
  const h = harness();

  const first = fetchMapImage("k", "https://example.test/map", {
    fetchImpl: h.fetchImpl,
    count: h.count,
    exhausted: h.exhausted,
    now: 1_000,
  });
  h.release();
  await first;

  assert.notEqual(lookupMapImage("k", 1_000), null, "ต้องถูกเก็บลง cache");
  assert.equal(h.calls(), 1);
  assert.equal(inflightMapCount(), 0, "ทะเบียนต้องว่างหลังเสร็จ");
});

/* ------------------------------------------------------------------ *
 * ขาที่ล้ม — ข้อที่พลาดแล้วเสียหายที่สุด
 * ------------------------------------------------------------------ */

test("🔴 fetch ล้ม → ทะเบียนต้องถูกลบ คำขอรอบหน้าต้องยิงใหม่ได้", async () => {
  reset();
  let calls = 0;

  const failing = (async () => {
    calls += 1;
    throw new Error("เน็ตหลุด");
  }) as unknown as typeof fetch;

  const outcome = await fetchMapImage("k", "https://example.test/map", {
    fetchImpl: failing,
    count: () => Promise.resolve(),
    exhausted: () => false,
  });

  assert.deepEqual(outcome, { ok: false, status: 504 });
  assert.equal(
    inflightMapCount(),
    0,
    "ไม่ลบทะเบียน = คนที่มาทีหลังรอ promise ที่ล้มไปแล้วตลอดกาล",
  );

  // ยิงรอบใหม่ต้องไปถึง fetch จริงอีกครั้ง ไม่ใช่ได้ผลเก่าที่ล้ม
  await fetchMapImage("k", "https://example.test/map", {
    fetchImpl: failing,
    count: () => Promise.resolve(),
    exhausted: () => false,
  });
  assert.equal(calls, 2);
});

test("🔴 ล้มแล้วต้องไม่เข้า cache", async () => {
  reset();

  for (const bad of [
    { status: 500, type: "image/png" },
    { status: 200, type: "text/html" },
  ]) {
    const h = harness(bad);
    const run = fetchMapImage("k", "https://example.test/map", {
      fetchImpl: h.fetchImpl,
      count: h.count,
      exhausted: h.exhausted,
      now: 1_000,
    });
    h.release();
    const outcome = await run;

    assert.equal(outcome.ok, false, JSON.stringify(bad));
    assert.equal(
      lookupMapImage("k", 1_000),
      null,
      "เก็บคำตอบพังไว้ 30 วัน = จำคำตอบผิดไว้เดือนหนึ่ง",
    );
  }
});

test("🔴 ล้มก็ยังต้องนับ — ยิงแล้ว error ก็จ่ายไปแล้ว", async () => {
  reset();
  const h = harness({ status: 500 });

  const run = fetchMapImage("k", "https://example.test/map", {
    fetchImpl: h.fetchImpl,
    count: h.count,
    exhausted: h.exhausted,
  });
  h.release();
  await run;

  assert.equal(h.counted(), 1);
});

test("ชนเพดาน → ไม่ยิง ไม่นับ ตอบ 404", async () => {
  reset();
  const h = harness();

  const outcome = await fetchMapImage("k", "https://example.test/map", {
    fetchImpl: h.fetchImpl,
    count: h.count,
    exhausted: () => true,
  });

  assert.deepEqual(outcome, { ok: false, status: 404 });
  assert.equal(h.calls(), 0);
  assert.equal(h.counted(), 0, "ไม่ได้ยิง จึงไม่ได้จ่าย จึงต้องไม่นับ");
  assert.equal(mapCacheStats().stored, 0);
});

test("ชนเพดานตอนที่มีคนเกาะอยู่ → ทุกคนได้ 404 เหมือนกัน และยังไม่นับ", async () => {
  reset();
  const h = harness();

  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      fetchMapImage("k", "https://example.test/map", {
        fetchImpl: h.fetchImpl,
        count: h.count,
        exhausted: () => true,
      }),
    ),
  );

  for (const r of results) assert.deepEqual(r, { ok: false, status: 404 });
  assert.equal(h.counted(), 0);
});
