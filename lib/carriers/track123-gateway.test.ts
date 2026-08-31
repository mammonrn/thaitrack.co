/**
 * เทสต์ประตูทางออกของ Track123 — คิว, การลองใหม่เมื่อชนลิมิต, และรูปแบบ log
 *
 * ใช้ fake timer ทั้งหมด ถ้ารอเวลาจริงเทสต์ชุดนี้ชุดเดียวจะกินเวลาเกิน 3 วินาที
 * และ flaky บนเครื่องที่โหลดหนัก
 *
 * ประเด็นที่ต้องไม่หลุด:
 *   1. ลองใหม่เฉพาะตอนชนลิมิต — error อื่นลองอีกกี่ครั้งก็ได้คำตอบเดิม เปลือง quota เปล่า
 *   2. การลองใหม่ต้องกลับไปเข้าคิว ไม่ใช่ยิงตรง ไม่งั้นจะไปซ้ำเติมปลายทางที่บอกว่ารับไม่ไหว
 *   3. ทุก request ที่ออกไปจริงต้องมี log หนึ่งบรรทัด ไม่มีตกหล่น
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { RateLimitQueue } from "../rate-limit-queue.ts";
import { BACKOFF_DELAYS_MS, callTrack123 } from "./track123-gateway.ts";
import { CarrierError } from "./types.ts";

const BACKOFF = [500, 1_000, 2_000] as const;
const TRACK_NO = "SPXTH046012345678";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function useFakeClock(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
}

/** error แบบเดียวกับที่ Track123 ตอบกลับมาเมื่อยิงเกิน 5 ครั้ง/วินาที */
function rateLimited(): CarrierError {
  return new CarrierError("rate_limited", "คิวค้นหาหนาแน่น", {
    debugMessage: "Track123 จำกัดอัตราการเรียก",
    upstreamCode: "A0706",
  });
}

interface Harness {
  lines: string[];
  options: {
    queue: RateLimitQueue;
    backoffMs: readonly number[];
    log: (line: string) => void;
    // ปิด breaker ในเทสต์ชุดนี้ ไม่งั้นความล้มเหลวจากเทสต์ตัวก่อนจะสะสมข้าม
    // ไปเปิดวงจรให้เทสต์ตัวถัดไป (breaker ตัวจริงเป็น singleton ของโปรเซส)
    // การทำงานร่วมกับ breaker มีเทสต์แยกอยู่ใน circuit-breaker.test.ts
    breaker: null;
  };
}

function harness(): Harness {
  const lines: string[] = [];
  return {
    lines,
    options: {
      queue: new RateLimitQueue(3),
      backoffMs: BACKOFF,
      log: (line) => lines.push(line),
      breaker: null,
    },
  };
}

test("ยิงผ่านครั้งแรก → ไม่ลองใหม่ และมี log หนึ่งบรรทัด", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  const result = await callTrack123(
    { trackNo: TRACK_NO, courierCode: "shopee-xpress-th" },
    async () => "ผลลัพธ์",
    options,
  );

  assert.equal(result, "ผลลัพธ์");
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "[track123] ts=0 no=SPXTH046012345678 courier=shopee-xpress-th" +
      " attempt=1/4 queued=1 wait=0ms took=0ms result=ok",
  );
});

test("ไม่ระบุขนส่ง → log บอกว่าเป็น auto", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  await callTrack123({ trackNo: TRACK_NO }, async () => "ok", options);

  assert.match(lines[0] ?? "", /\scourier=auto\s/);
});

test("ชนลิมิตสองรอบแล้วผ่าน → หน่วง 500ms แล้ว 1s ตามลำดับ", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  const firedAt: number[] = [];
  let attempts = 0;

  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      firedAt.push(Date.now());
      attempts += 1;
      if (attempts <= 2) throw rateLimited();
      return "ผ่านรอบสาม";
    },
    options,
  );

  await flush();
  assert.deepEqual(firedAt, [0], "รอบแรกยิงทันที");

  t.mock.timers.tick(500);
  await flush();
  assert.deepEqual(firedAt, [0, 500], "หน่วง 500ms ก่อนรอบสอง");

  t.mock.timers.tick(1_000);
  await flush();
  assert.deepEqual(firedAt, [0, 500, 1_500], "หน่วงเพิ่มเป็น 1s ก่อนรอบสาม");

  assert.equal(await promise, "ผ่านรอบสาม");
  assert.equal(lines.length, 3, "ทุกรอบที่ยิงจริงต้องมี log");
  assert.match(lines[0] ?? "", /result=rate_limited upstream=A0706$/);
  assert.match(lines[1] ?? "", /attempt=2\/4 /);
  assert.match(lines[2] ?? "", /attempt=3\/4 .* result=ok$/);
});

test("ชนลิมิตไม่หยุด → ยิงครบ 4 ครั้งแล้วยอมแพ้ ส่ง rate_limited ขึ้นไป", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  let attempts = 0;
  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      attempts += 1;
      throw rateLimited();
    },
    options,
  );

  // ผูกตัวรับ rejection ไว้ตั้งแต่ตอนนี้ ก่อนจะเดินนาฬิกา — ถ้ารอไปผูกทีหลัง
  // promise จะ reject ระหว่างที่ยังไม่มีใครรับ กลายเป็น unhandled rejection
  const settled = assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CarrierError);
    assert.equal(error.code, "rate_limited");
    return true;
  });

  await flush();
  for (const wait of BACKOFF) {
    t.mock.timers.tick(wait);
    await flush();
  }

  await settled;

  assert.equal(attempts, 4, "ยิงครั้งแรก + ลองใหม่ 3 รอบ");
  assert.equal(lines.length, 4);
});

test("error ที่ไม่ใช่การชนลิมิต → ไม่ลองใหม่เลย ไม่เปลือง quota", async (t) => {
  useFakeClock(t);
  const lines: string[] = [];

  for (const code of ["not_found", "auth_failed", "network_error"] as const) {
    let attempts = 0;

    // คิวใหม่ทุกรอบ เพราะนาฬิกาถูกแช่ไว้ที่ 0 ถ้าใช้คิวเดิม รอบที่สองจะติดรอ
    // ช่องเวลาถัดไปตลอดกาล ซึ่งเป็นข้อจำกัดของเทสต์ ไม่ใช่พฤติกรรมที่อยากวัด
    await assert.rejects(
      callTrack123(
        { trackNo: TRACK_NO },
        async () => {
          attempts += 1;
          throw new CarrierError(code, "ทดสอบ");
        },
        {
          queue: new RateLimitQueue(3),
          backoffMs: BACKOFF,
          log: (line) => lines.push(line),
          breaker: null,
        },
      ),
    );

    assert.equal(attempts, 1, `${code} ต้องไม่ถูกลองใหม่`);
  }

  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? "", /result=not_found$/);
  assert.match(lines[1] ?? "", /result=auth_failed$/);
  assert.match(lines[2] ?? "", /result=network_error$/);
});

test("error ที่ไม่ใช่ CarrierError → log ว่า error แล้วส่งต่อดิบๆ", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();
  const boom = new TypeError("อ่าน property ของ undefined");

  await assert.rejects(
    callTrack123({ trackNo: TRACK_NO }, async () => {
      throw boom;
    }, options),
    boom,
  );

  assert.match(lines[0] ?? "", /result=error$/);
});

test("การลองใหม่ต้องกลับไปเข้าคิว ไม่แซงคิวของคนอื่น", async (t) => {
  useFakeClock(t);
  const { options } = harness();

  const firedAt: number[] = [];
  let attempts = 0;

  // คำขอ ก ชนลิมิตรอบแรก แล้วต้องรอ 500ms ก่อนลองใหม่
  const a = callTrack123(
    { trackNo: "AAAAAA" },
    async () => {
      firedAt.push(Date.now());
      attempts += 1;
      if (attempts === 1) throw rateLimited();
      return "ก";
    },
    options,
  );

  // คำขอ ข กับ ค เข้าคิวตามมาทันที ได้ช่องที่ 334ms และ 668ms
  const b = callTrack123(
    { trackNo: "BBBBBB" },
    async () => {
      firedAt.push(Date.now());
      return "ข";
    },
    options,
  );
  const c = callTrack123(
    { trackNo: "CCCCCC" },
    async () => {
      firedAt.push(Date.now());
      return "ค";
    },
    options,
  );

  await flush();
  for (let i = 0; i < 6; i += 1) {
    t.mock.timers.tick(334);
    await flush();
  }

  assert.deepEqual(await Promise.all([a, b, c]), ["ก", "ข", "ค"]);

  // ก(0) → ข(334) → ค(668) → ก ลองใหม่ตอน 668+ ไม่ใช่ 500 ตรงๆ
  // เพราะต้องรอช่องคิวถัดไปหลังหน่วง backoff ครบ
  assert.deepEqual(firedAt.slice(0, 3), [0, 334, 668]);
  assert.ok(
    (firedAt[3] ?? 0) >= 668,
    `รอบลองใหม่ยิงตอน ${firedAt[3]}ms ซึ่งแซงคิวของ ข/ค`,
  );
});

test("ค่าหน่วงเริ่มต้นเป็น exponential backoff และไม่ยาวจนผู้ใช้ทิ้งหน้าไปก่อน", () => {
  assert.deepEqual([...BACKOFF_DELAYS_MS], [500, 1_000, 2_000]);

  const total = BACKOFF_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
  assert.ok(total <= 5_000, `รอรวม ${total}ms นานเกินไปสำหรับการรอหน้าเว็บ`);
});
