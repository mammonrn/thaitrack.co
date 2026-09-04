/**
 * เทสต์ประตูทางออกของ Track123 — คิว, การลองใหม่เมื่อชนลิมิต, และรูปแบบ log
 *
 * ใช้ fake timer ทั้งหมด ถ้ารอเวลาจริงเทสต์ชุดนี้ชุดเดียวจะกินเวลาเกิน 3 วินาที
 * และ flaky บนเครื่องที่โหลดหนัก
 *
 * ประเด็นที่ต้องไม่หลุด:
 *   1. ลองใหม่เฉพาะสองกลุ่ม (ชนลิมิต / ระบบสะดุดชั่วคราว) ด้วยเพดานคนละตัว —
 *      error อื่นลองอีกกี่ครั้งก็ได้คำตอบเดิม เปลือง quota เปล่า
 *   2. การลองใหม่ต้องกลับไปเข้าคิว ไม่ใช่ยิงตรง ไม่งั้นจะไปซ้ำเติมปลายทางที่บอกว่ารับไม่ไหว
 *   3. ทุก request ที่ออกไปจริงต้องมี log หนึ่งบรรทัด ไม่มีตกหล่น
 */

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { CircuitBreaker } from "../circuit-breaker.ts";
import { RateLimitQueue } from "../rate-limit-queue.ts";
import {
  BACKOFF_DELAYS_MS,
  SYSTEM_RETRY_DELAY_MS,
  callTrack123,
} from "./track123-gateway.ts";
import { CarrierError, TIMEOUT_UPSTREAM_CODE } from "./types.ts";

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
  /** นับว่าตัวนับโควตาถูกเรียกกี่ครั้ง — ของจริงไปแตะ Supabase จึงต้องแทน */
  counted: number;
  options: {
    queue: RateLimitQueue;
    backoffMs: readonly number[];
    log: (line: string) => void;
    countUsage: () => Promise<number>;
    // ปิด breaker ในเทสต์ชุดนี้ ไม่งั้นความล้มเหลวจากเทสต์ตัวก่อนจะสะสมข้าม
    // ไปเปิดวงจรให้เทสต์ตัวถัดไป (breaker ตัวจริงเป็น singleton ของโปรเซส)
    // การทำงานร่วมกับ breaker มีเทสต์แยกอยู่ใน circuit-breaker.test.ts
    breaker: null;
  };
}

function harness(): Harness {
  const lines: string[] = [];
  const state = { counted: 0 };

  return {
    lines,
    get counted() {
      return state.counted;
    },
    options: {
      queue: new RateLimitQueue(3),
      backoffMs: BACKOFF,
      log: (line) => lines.push(line),
      countUsage: () => {
        state.counted += 1;
        return Promise.resolve(state.counted);
      },
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

test("error ที่ยิงอีกกี่ครั้งก็ได้คำตอบเดิม → ไม่ลองใหม่เลย ไม่เปลือง quota", async (t) => {
  useFakeClock(t);
  const lines: string[] = [];

  // สองกลุ่มที่ไม่ควรลองใหม่ด้วยเหตุผลคนละอย่าง:
  //   not_found / invalid_tracking_number  = คำตอบที่แท้จริงของปลายทางที่ปกติดี
  //   auth_failed / config_error           = ปัญหาฝั่งเรา ยิงอีกก็ผลเดิม
  const codes = [
    "not_found",
    "invalid_tracking_number",
    "auth_failed",
    "config_error",
  ] as const;

  for (const code of codes) {
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

  assert.equal(lines.length, codes.length);
  assert.match(lines[0] ?? "", /result=not_found$/);
  assert.match(lines[2] ?? "", /result=auth_failed$/);
});

/*
 * เหลือเฉพาะ network_error ("ต่อไม่ติด") ที่ยังลองใหม่ได้
 *
 * upstream_error (504 ของ Track123) ถูกถอดออกจากชุดนี้แล้ว — ดูเหตุผลพร้อม
 * ตัวเลขที่ RETRYABLE_SYSTEM_ERRORS และเทสต์ตัวถัดไปที่เฝ้าไว้
 */
test("ต่อไม่ติดชั่วคราว → ลองใหม่ครั้งเดียวแล้วผ่าน", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  const firedAt: number[] = [];
  let attempts = 0;

  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      firedAt.push(Date.now());
      attempts += 1;
      if (attempts === 1) {
        throw new CarrierError("network_error", "ต่อไม่ติด");
      }
      return "ผ่านรอบสอง";
    },
    options,
  );

  await flush();
  assert.deepEqual(firedAt, [0], "รอบแรกยิงทันที");

  t.mock.timers.tick(SYSTEM_RETRY_DELAY_MS);
  await flush();

  assert.equal(await promise, "ผ่านรอบสอง");
  assert.deepEqual(
    firedAt,
    [0, SYSTEM_RETRY_DELAY_MS],
    "หน่วงสั้นๆ ก่อนลองใหม่ ไม่ใช้ backoff ยาวแบบตอนชนลิมิต",
  );
  assert.equal(lines.length, 2);
  assert.match(lines[1] ?? "", /result=ok$/);
});

test("Track123 ตอบ 504 → จบทันที ไม่ลองใหม่", async (t) => {
  // การลองใหม่ตรงนี้มีราคาคงที่ ~6.5 วินาที (504 มาถึงที่ ~6.15 วิเสมอ)
  // แต่กู้สำเร็จแค่ 2 จาก 35 ครั้งในข้อมูลจริง — ตัดสินใจแล้วว่าไม่คุ้ม
  // ถ้าเทสต์นี้ตก แปลว่ามีคนเอา upstream_error กลับเข้า RETRYABLE_SYSTEM_ERRORS
  // แล้วผู้ใช้จะกลับไปรอ 14 วินาทีก่อนเห็น error เหมือนเดิม
  useFakeClock(t);
  const h = harness();

  let attempts = 0;
  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        attempts += 1;
        throw new CarrierError("upstream_error", "ปลายทางสะดุด", {
          upstreamCode: "B0100",
        });
      },
      h.options,
    ),
  );

  assert.equal(attempts, 1, "ยิงครั้งเดียวจบ");
  assert.equal(h.lines.length, 1);
  assert.match(h.lines[0] ?? "", /result=upstream_error upstream=B0100$/);
});

test("ระบบสะดุดไม่หยุด → ลองใหม่แค่ครั้งเดียวเท่านั้น ไม่ไล่ยิงต่อ", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  let attempts = 0;
  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      attempts += 1;
      throw new CarrierError("network_error", "ต่อไม่ติด");
    },
    options,
  );

  const settled = assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CarrierError);
    assert.equal(error.code, "network_error");
    return true;
  });

  await flush();
  t.mock.timers.tick(SYSTEM_RETRY_DELAY_MS);
  await flush();

  await settled;

  assert.equal(attempts, 2, "ยิงครั้งแรก + ลองใหม่อีกครั้งเดียว");
  assert.equal(lines.length, 2);
});

test("หมดเวลารอ (timeout) → ไม่ลองใหม่ เพราะผู้ใช้รอไปแล้วเต็มเพดาน", async (t) => {
  useFakeClock(t);
  const h = harness();

  let attempts = 0;
  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        attempts += 1;
        throw new CarrierError("network_error", "ปลายทางตอบช้าเกินไป", {
          upstreamCode: TIMEOUT_UPSTREAM_CODE,
        });
      },
      h.options,
    ),
  );

  assert.equal(
    attempts,
    1,
    "timeout ต้องไม่ถูกลองใหม่ ไม่งั้นผู้ใช้รอรวมเป็นสองเท่าของเพดาน",
  );
  assert.equal(h.lines.length, 1);
});

test("timeout ยังนับเป็นโควตา — เราไม่รู้ว่าคำขอไปถึงปลายทางหรือยัง", async (t) => {
  useFakeClock(t);
  const h = harness();

  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        throw new CarrierError("network_error", "ปลายทางตอบช้าเกินไป", {
          upstreamCode: TIMEOUT_UPSTREAM_CODE,
        });
      },
      h.options,
    ),
  );

  // ต่างจาก 504 (upstream_error) ที่รู้แน่ว่าปลายทางพังแล้วไม่คิดเงิน —
  // timeout เราตัดสายเอง จึงไม่รู้ว่าฝั่งเขาประมวลผลจบไปแล้วหรือยัง
  // ⚠️ ข้อนี้สำคัญตอนลดเพดานเวลา: 504 ที่เคยมาถึงตอน 13.9 วิ จะกลายเป็น
  // timeout แทน แล้วเปลี่ยนจาก "ไม่นับ" เป็น "นับ" — เกิดน้อยมากเพราะ 504
  // ปกติมาถึงตั้งแต่ 6.15 วิ แต่ต้องรู้ว่ามันมีอยู่
  assert.equal(h.counted, 1);
});

test("ชนลิมิตแล้วระบบสะดุด → ใช้เพดานคนละตัว แต่รวมกันไม่เกินเพดานรวม", async (t) => {
  useFakeClock(t);
  const { lines, options } = harness();

  const firedAt: number[] = [];
  let attempts = 0;

  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      firedAt.push(Date.now());
      attempts += 1;
      if (attempts === 1) throw rateLimited();
      if (attempts === 2) throw new CarrierError("network_error", "ต่อไม่ติด");
      return "ผ่านรอบสาม";
    },
    options,
  );

  await flush();
  t.mock.timers.tick(500);
  await flush();
  t.mock.timers.tick(SYSTEM_RETRY_DELAY_MS);
  await flush();

  assert.equal(await promise, "ผ่านรอบสาม");
  assert.deepEqual(firedAt, [0, 500, 500 + SYSTEM_RETRY_DELAY_MS]);
  assert.equal(lines.length, 3);
});

test("วงจรถูกตัดระหว่างที่กำลังลองใหม่ → หยุดทันที ไม่ลอดด่าน breaker", async (t) => {
  useFakeClock(t);
  const { lines } = harness();

  const breaker = new CircuitBreaker({
    name: "ทดสอบ",
    failureThreshold: 1,
    windowMs: 60_000,
    cooldownMs: 60_000,
  });

  let attempts = 0;
  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        attempts += 1;
        throw new CarrierError("upstream_error", "ปลายทางล่ม");
      },
      {
        queue: new RateLimitQueue(3),
        backoffMs: BACKOFF,
        log: (line) => lines.push(line),
        breaker,
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof CarrierError);
      // error ของปลายทางจริง ไม่ใช่ breaker_open — คำขอนี้ยิงไปแล้วและได้คำตอบ
      assert.equal(error.upstreamCode, undefined);
      return true;
    },
  );

  assert.equal(attempts, 1, "วงจรตัดแล้วต้องไม่ลองใหม่");
  assert.equal(lines.length, 1);
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

/*
 * config_error ต้องเปิดวงจรได้ ไม่งั้นวันที่ลืมตั้ง TRACK123_API_KEY ผู้ใช้ทุกคน
 * จะต้องรอเข้าคิวแล้วพังทีละคน ทั้งที่รู้ผลล่วงหน้าอยู่แล้วว่าจะพังทุกครั้ง
 */
test("ตั้งค่าผิดจนพังทุกครั้ง → วงจรต้องเปิด ไม่ปล่อยให้ทุกคนรอเสียเวลาซ้ำ", async (t) => {
  useFakeClock(t);
  const lines: string[] = [];

  const breaker = new CircuitBreaker({
    name: "ทดสอบ",
    failureThreshold: 1,
    windowMs: 60_000,
    cooldownMs: 60_000,
  });

  const options = {
    queue: new RateLimitQueue(3),
    backoffMs: BACKOFF,
    log: (line: string) => lines.push(line),
    breaker,
  };

  let attempts = 0;
  const fire = () =>
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        attempts += 1;
        throw new CarrierError("config_error", "ยังไม่ได้ตั้งค่า");
      },
      options,
    );

  await assert.rejects(fire());
  assert.equal(attempts, 1);

  await assert.rejects(fire(), (error: unknown) => {
    assert.ok(error instanceof CarrierError);
    assert.equal(error.upstreamCode, "breaker_open");
    return true;
  });

  assert.equal(attempts, 1, "คำขอที่สองต้องถูกปฏิเสธก่อนยิงจริง");
  assert.match(lines[1] ?? "", /result=breaker_open$/);
});

test("ค่าหน่วงเริ่มต้นเป็น exponential backoff และไม่ยาวจนผู้ใช้ทิ้งหน้าไปก่อน", () => {
  assert.deepEqual([...BACKOFF_DELAYS_MS], [500, 1_000, 2_000]);

  const total = BACKOFF_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
  assert.ok(total <= 5_000, `รอรวม ${total}ms นานเกินไปสำหรับการรอหน้าเว็บ`);
});

/* ------------------------- การนับโควตา ------------------------- *
 *
 * เทสต์ชุดนี้เกิดขึ้นหลังเจอของจริง: ตัวนับของเราขึ้น 575/300 (191.7%) ทั้งที่
 * dashboard ของ Track123 บอกใช้จริง 277/300 ผลคือด่าน isNearQuota เข้าใจผิด
 * ว่า Track123 เต็มแล้ว จึงไม่ยอมสลับมาใช้มันเพื่อถนอมโควตาของ ETrackings
 * (ดู chooseProviderOrder ใน ./resolve.ts) จน ETrackings ฝั่งค้นหาถูกใช้จนหมด
 *
 * ก่อนหน้านี้ไม่มีเทสต์ครอบการนับเลยสักตัว ความเพี้ยนจึงสะสมได้เงียบๆ
 */

test("ยิงผ่าน → นับหนึ่งครั้ง", async (t) => {
  useFakeClock(t);
  const h = harness();

  await callTrack123({ trackNo: TRACK_NO }, async () => "ok", h.options);

  assert.equal(h.counted, 1);
});

test("ถูกปฏิเสธด้วย A0706 → ไม่นับรอบนั้น เพราะปลายทางไม่คิดเงิน", async (t) => {
  useFakeClock(t);
  const h = harness();

  // ชนลิมิตสองรอบแล้วผ่านรอบสาม = ยิงไป 3 ครั้ง แต่คิดเงินแค่ครั้งเดียว
  let attempts = 0;
  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      attempts += 1;
      if (attempts <= 2) throw rateLimited();
      return "ผ่านรอบสาม";
    },
    h.options,
  );

  await flush();
  t.mock.timers.tick(500);
  await flush();
  t.mock.timers.tick(1_000);
  await flush();

  assert.equal(await promise, "ผ่านรอบสาม");
  assert.equal(h.lines.length, 3, "ยิงจริง 3 ครั้ง");
  assert.equal(h.counted, 1, "แต่กินโควตาแค่ครั้งเดียว");
});

test("ชนลิมิตจนยอมแพ้ → ไม่นับเลยสักครั้ง", async (t) => {
  useFakeClock(t);
  const h = harness();

  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      throw rateLimited();
    },
    h.options,
  );
  const settled = promise.catch((error: unknown) => error);

  for (const wait of BACKOFF) {
    await flush();
    t.mock.timers.tick(wait);
  }
  await flush();

  assert.ok((await settled) instanceof CarrierError);
  assert.equal(h.lines.length, BACKOFF.length + 1, "ยิงครบทุกรอบ");
  assert.equal(h.counted, 0, "ทุกรอบถูกปฏิเสธก่อนประมวลผล จึงไม่กินโควตา");
});

test('"ไม่พบเลขนี้" → นับ เพราะเป็นคำตอบจริงที่ปลายทางประมวลผลแล้ว', async (t) => {
  useFakeClock(t);
  const h = harness();

  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        throw new CarrierError("not_found", "ไม่พบเลขพัสดุนี้");
      },
      h.options,
    ),
  );

  assert.equal(h.counted, 1);
});

test("ปลายทางพังระหว่างประมวลผล → ไม่นับเลย และจบทันที", async (t) => {
  useFakeClock(t);
  const h = harness();

  await assert.rejects(
    callTrack123(
      { trackNo: TRACK_NO },
      async () => {
        throw new CarrierError("upstream_error", "ปลายทางสะดุด");
      },
      h.options,
    ),
  );

  assert.equal(h.lines.length, 1, "ยิงครั้งเดียว ไม่ลองใหม่");
  assert.equal(h.counted, 0, "ไม่มีผลลัพธ์กลับมา ปลายทางไม่คิดเงิน");
});

test("ต่อไม่ติดแล้วลองใหม่ → นับทั้งสองรอบ", async (t) => {
  useFakeClock(t);
  const h = harness();

  let attempts = 0;
  const promise = callTrack123(
    { trackNo: TRACK_NO },
    async () => {
      attempts += 1;
      if (attempts === 1) throw new CarrierError("network_error", "ต่อไม่ติด");
      return "ผ่านรอบสอง";
    },
    h.options,
  );

  await flush();
  t.mock.timers.tick(SYSTEM_RETRY_DELAY_MS);
  await flush();

  assert.equal(await promise, "ผ่านรอบสอง");
  assert.equal(h.counted, 2, "ไม่รู้ว่าคำขอไปถึงหรือยัง นับเกินดีกว่านับขาด");
});

test("วงจรถูกตัด → ไม่นับ เพราะไม่ได้ยิงออกไปเลย", async (t) => {
  useFakeClock(t);
  const h = harness();

  const breaker = new CircuitBreaker({
    name: "track123-test",
    failureThreshold: 1,
    windowMs: 60_000,
    cooldownMs: 60_000,
    log: () => {},
  });
  breaker.recordFailure();

  await assert.rejects(
    callTrack123({ trackNo: TRACK_NO }, async () => "ไม่ควรถูกเรียก", {
      ...h.options,
      breaker,
    }),
  );

  assert.equal(h.counted, 0);
});
