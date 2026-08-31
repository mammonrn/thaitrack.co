/**
 * เทสต์ตัวนับโควตาและการตัดสินว่า "ใกล้เพดานแล้ว"
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือความถูกต้องของตัวเลขที่ระบบใช้ตัดสินใจเรื่อง
 * ลำดับการยิง ถ้าตัวเลขนี้เพี้ยน ระบบจะเอียงไปใช้เจ้าที่ผิดโดยไม่มีใครสังเกต
 * จนกว่าจะมีเจ้าใดเจ้าหนึ่งโควตาหมดจริง
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LEAN_RATIO,
  DEFAULT_QUOTA,
  countProviderCall,
  currentMonth,
  isNearQuota,
  loadProviderUsage,
  readLeanRatio,
  readQuota,
  resetProviderUsage,
  usageLabel,
  usageOf,
} from "./provider-usage.ts";
import type { ProviderUsageStore } from "./supabase/provider-usage.ts";

/** ชั้นเก็บถาวรปลอม — จำยอดไว้ใน Map เหมือนตารางจริง */
function makeStore(seed: Record<string, number> = {}) {
  const counts = new Map(Object.entries(seed));
  const bumps: string[] = [];

  const store: ProviderUsageStore = {
    bump(provider, month) {
      bumps.push(`${provider}@${month}`);
      const next = (counts.get(provider) ?? 0) + 1;
      counts.set(provider, next);
      return Promise.resolve(next);
    },
    read: () => Promise.resolve(Object.fromEntries(counts)),
  };

  return { store, bumps, counts };
}

/** ชั้นเก็บถาวรที่พังทุกครั้ง — จำลองตอนฐานข้อมูลล่ม */
const brokenStore: ProviderUsageStore = {
  bump: () => Promise.resolve(null),
  read: () => Promise.resolve({}),
};

const AUGUST = Date.parse("2026-08-15T10:00:00+07:00");

test("นับสะสมภายในเดือนเดียวกัน", async () => {
  resetProviderUsage();
  const { store } = makeStore();

  assert.equal(await countProviderCall("track123", { store, now: AUGUST }), 1);
  assert.equal(await countProviderCall("track123", { store, now: AUGUST }), 2);
  assert.equal(usageOf("track123", AUGUST), 2);
  assert.equal(usageOf("etrackings", AUGUST), 0, "แต่ละเจ้านับแยกกัน");
});

test("ข้ามเดือน → เริ่มนับใหม่", async () => {
  resetProviderUsage();
  const { store } = makeStore();

  await countProviderCall("etrackings", {
    store,
    now: Date.parse("2026-08-31T23:00:00+07:00"),
  });

  const september = Date.parse("2026-09-01T00:30:00+07:00");
  assert.equal(usageOf("etrackings", september), 0);
});

test("นับตามเวลาไทย ไม่ใช่ UTC", () => {
  // 1 ก.ย. 01:00 น. ไทย = 31 ส.ค. 18:00 UTC — ถ้านับแบบ UTC จะยังเป็น ส.ค.
  assert.equal(currentMonth(Date.parse("2026-08-31T23:00:00+07:00")), "2026-08");
  assert.equal(currentMonth(Date.parse("2026-09-01T01:00:00+07:00")), "2026-09");
});

test("ฐานข้อมูลเป็นตัวจริง — ยอดจากที่นั่นชนะยอดใน memory", async () => {
  resetProviderUsage();
  // instance อื่นยิงไปแล้ว 40 ครั้ง ตัวเราเพิ่งเริ่มนับ
  const { store } = makeStore({ etrackings: 40 });

  const used = await countProviderCall("etrackings", { store, now: AUGUST });
  assert.equal(used, 41, "ต้องเห็นยอดรวมของทุก instance ไม่ใช่แค่ของตัวเอง");
});

test("ฐานข้อมูลล่ม → ตัวนับยังเดินต่อได้ด้วยยอดของโปรเซสเดียว", async () => {
  resetProviderUsage();

  assert.equal(
    await countProviderCall("track123", { store: brokenStore, now: AUGUST }),
    1,
  );
  assert.equal(usageOf("track123", AUGUST), 1);
});

test("ตัวนับต้องไม่เดินถอยหลัง แม้ฐานข้อมูลจะตามไม่ทัน", async () => {
  resetProviderUsage();
  const behind: ProviderUsageStore = {
    bump: () => Promise.resolve(1),
    read: () => Promise.resolve({}),
  };

  await countProviderCall("track123", { store: behind, now: AUGUST });
  await countProviderCall("track123", { store: behind, now: AUGUST });

  assert.equal(usageOf("track123", AUGUST), 2);
});

test("อ่านยอดจากฐานข้อมูลตอนเริ่ม — หลัง restart ต้องไม่เชื่อว่ายังไม่ได้ใช้อะไรเลย", async () => {
  resetProviderUsage();
  const { store } = makeStore({ track123: 900, etrackings: 45 });

  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(usageOf("track123", AUGUST), 900);
  assert.equal(usageOf("etrackings", AUGUST), 45);
});

test("อ่านซ้ำในเดือนเดิม → ไม่ไปถามฐานข้อมูลอีก", async () => {
  resetProviderUsage();
  let reads = 0;
  const store: ProviderUsageStore = {
    bump: () => Promise.resolve(null),
    read: () => {
      reads += 1;
      return Promise.resolve({});
    },
  };

  await loadProviderUsage({ store, now: AUGUST });
  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(reads, 1);
});

test("การอ่านต้องไม่ทับยอดที่นับไปแล้วให้ต่ำลง", async () => {
  resetProviderUsage();
  const { store } = makeStore({ track123: 1 });

  await countProviderCall("track123", { store, now: AUGUST });
  await countProviderCall("track123", { store, now: AUGUST });
  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(usageOf("track123", AUGUST), 3);
});

/* ---------------------------- เพดาน ---------------------------- */

test("ไม่ได้ตั้ง env → ใช้ค่าเริ่มต้น", () => {
  assert.equal(readQuota("track123"), DEFAULT_QUOTA.track123);
  assert.equal(readQuota("etrackings"), DEFAULT_QUOTA.etrackings);
  assert.equal(readLeanRatio(), DEFAULT_LEAN_RATIO);
});

test("ตั้ง env → ใช้ค่าที่ตั้ง", (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_MONTHLY_CALL_LIMIT;
    delete process.env.PROVIDER_QUOTA_LEAN_RATIO;
  });

  process.env.ETRACKINGS_MONTHLY_CALL_LIMIT = "500";
  process.env.PROVIDER_QUOTA_LEAN_RATIO = "0.5";

  assert.equal(readQuota("etrackings"), 500);
  assert.equal(readLeanRatio(), 0.5);
});

test("ค่าที่ใช้ไม่ได้ใน env → กลับไปใช้ค่าเริ่มต้น ไม่พังและไม่กลายเป็นศูนย์", (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_MONTHLY_CALL_LIMIT;
  });

  for (const bad of ["", "   ", "abc", "0", "-5"]) {
    process.env.ETRACKINGS_MONTHLY_CALL_LIMIT = bad;
    assert.equal(readQuota("etrackings"), DEFAULT_QUOTA.etrackings, bad);
  }
});

test("สัดส่วนเกิน 1 ถูกบีบลงมา — ไม่งั้นจะไม่มีวันถือว่าใกล้เพดานเลย", (t) => {
  t.after(() => {
    delete process.env.PROVIDER_QUOTA_LEAN_RATIO;
  });

  process.env.PROVIDER_QUOTA_LEAN_RATIO = "5";
  assert.equal(readLeanRatio(), 1);
});

test("ใช้ถึงสัดส่วนที่ตั้งไว้ → ถือว่าใกล้เพดาน", async (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_MONTHLY_CALL_LIMIT;
  });

  resetProviderUsage();
  process.env.ETRACKINGS_MONTHLY_CALL_LIMIT = "10";
  const { store } = makeStore({ etrackings: 7 });

  await loadProviderUsage({ store, now: AUGUST });
  assert.equal(isNearQuota("etrackings", AUGUST), false, "7/10 ยังไม่ถึง 80%");

  await countProviderCall("etrackings", { store, now: AUGUST });
  assert.equal(isNearQuota("etrackings", AUGUST), true, "8/10 = 80% แล้ว");
});

test("ป้ายโควตาในรูปที่เอาไปต่อท้าย log ได้", async () => {
  resetProviderUsage();
  const { store } = makeStore({ track123: 11 });

  await loadProviderUsage({ store, now: AUGUST });
  assert.equal(usageLabel("track123", AUGUST), `11/${DEFAULT_QUOTA.track123}`);
});
