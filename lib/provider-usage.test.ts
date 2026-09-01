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
  PROVIDER_IDS,
  PROVIDER_LABEL,
  QUOTA_VARS,
  canUseForLookup,
  readHarvestReserve,
  countProviderCall,
  currentPeriodKey,
  isExhausted,
  isNearQuota,
  nextResetOf,
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

test("นับสะสมภายในรอบเดียวกัน", async () => {
  resetProviderUsage();
  const { store } = makeStore();

  assert.equal(await countProviderCall("track123", { store, now: AUGUST }), 1);
  assert.equal(await countProviderCall("track123", { store, now: AUGUST }), 2);
  assert.equal(usageOf("track123", AUGUST), 2);
  assert.equal(usageOf("etrackings", AUGUST), 0, "แต่ละเจ้านับแยกกัน");
});

test("ขึ้นรอบใหม่ → เริ่มนับใหม่", async () => {
  resetProviderUsage();
  const { store } = makeStore();

  // Track123 รีเซ็ตวันที่ 29 ของทุกเดือน
  await countProviderCall("track123", {
    store,
    now: Date.parse("2026-08-28T23:00:00+07:00"),
  });

  assert.equal(usageOf("track123", Date.parse("2026-08-29T00:30:00+07:00")), 0);
});

test("ETrackings ไม่รีเซ็ตเลย — ข้ามเดือน ข้ามปี ก็ยังเป็นยอดเดิม", async () => {
  // แผนฟรีให้โควตาก้อนเดียวตลอดอายุบัญชี ถ้าตัวนับรีเซ็ตตามเดือน เราจะเชื่อว่า
  // ยังใช้ได้อีก 50 ครั้งทุกต้นเดือน ทั้งที่ของจริงหมดไปแล้ว
  resetProviderUsage();
  const { store } = makeStore();

  await countProviderCall("etrackings", {
    store,
    now: Date.parse("2026-08-31T23:00:00+07:00"),
  });

  assert.equal(usageOf("etrackings", Date.parse("2027-03-05T10:00:00+07:00")), 1);
});

test("ไปรษณีย์ไทยรีเซ็ตทุกเที่ยงคืนเวลาไทย", async () => {
  resetProviderUsage();
  const { store } = makeStore();

  await countProviderCall("thailand-post", {
    store,
    now: Date.parse("2026-08-31T23:00:00+07:00"),
  });

  assert.equal(
    usageOf("thailand-post", Date.parse("2026-08-31T23:59:00+07:00")),
    1,
    "ยังเป็นวันเดิมอยู่",
  );
  assert.equal(
    usageOf("thailand-post", Date.parse("2026-09-01T00:01:00+07:00")),
    0,
    "ข้ามเที่ยงคืนแล้วต้องเริ่มใหม่",
  );
});

test("นับตามเวลาไทย ไม่ใช่ UTC", () => {
  // 1 ก.ย. 01:00 น. ไทย = 31 ส.ค. 18:00 UTC — ถ้านับแบบ UTC จะยังเป็นวันที่ 31
  assert.equal(
    currentPeriodKey("thailand-post", Date.parse("2026-08-31T23:00:00+07:00")),
    "2026-08-31",
  );
  assert.equal(
    currentPeriodKey("thailand-post", Date.parse("2026-09-01T01:00:00+07:00")),
    "2026-09-01",
  );
});

test("คีย์รอบของแต่ละเจ้าเป็นคนละแบบกัน", () => {
  const now = Date.parse("2026-09-01T10:00:00+07:00");

  assert.equal(currentPeriodKey("thailand-post", now), "2026-09-01");
  assert.equal(
    currentPeriodKey("track123", now),
    "2026-08-29",
    "1 ก.ย. ยังอยู่ในรอบที่เริ่ม 29 ส.ค.",
  );
  assert.equal(currentPeriodKey("etrackings", now), "lifetime");
});

test("วันที่รีเซ็ตครั้งถัดไป — null เมื่อไม่มีวันรีเซ็ต", () => {
  const now = Date.parse("2026-09-01T10:00:00+07:00");

  assert.equal(
    nextResetOf("thailand-post", now),
    Date.parse("2026-09-02T00:00:00+07:00"),
  );
  assert.equal(
    nextResetOf("track123", now),
    Date.parse("2026-09-29T00:00:00+07:00"),
  );
  assert.equal(nextResetOf("etrackings", now), null);
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
  const { store } = makeStore({ track123: 290, etrackings: 45 });

  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(usageOf("track123", AUGUST), 290);
  assert.equal(usageOf("etrackings", AUGUST), 45);
});

test("อ่านซ้ำในรอบเดิม → ไม่ไปถามฐานข้อมูลอีก", async () => {
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
    delete process.env.ETRACKINGS_CALL_LIMIT;
    delete process.env.PROVIDER_QUOTA_LEAN_RATIO;
  });

  process.env.ETRACKINGS_CALL_LIMIT = "500";
  process.env.PROVIDER_QUOTA_LEAN_RATIO = "0.5";

  assert.equal(readQuota("etrackings"), 500);
  assert.equal(readLeanRatio(), 0.5);
});

test("ค่าที่ใช้ไม่ได้ใน env → กลับไปใช้ค่าเริ่มต้น ไม่พังและไม่กลายเป็นศูนย์", (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_CALL_LIMIT;
  });

  for (const bad of ["", "   ", "abc", "0", "-5"]) {
    process.env.ETRACKINGS_CALL_LIMIT = bad;
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
    delete process.env.ETRACKINGS_CALL_LIMIT;
  });

  resetProviderUsage();
  process.env.ETRACKINGS_CALL_LIMIT = "10";
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

/* ---------------- ไปรษณีย์ไทยก็มีเพดานเหมือนกัน ---------------- */

test("ไปรษณีย์ไทยถูกนับด้วย ไม่ใช่เจ้าเดียวที่มองไม่เห็น", async () => {
  // เคยไม่นับเพราะคิดว่า "ฟรีและไม่จำกัด" แต่บัญชีทั่วไปมีเพดานต่อเดือนอยู่
  // และมันเป็นเจ้าที่ถูกถามบ่อยที่สุด (ถูกถามก่อนทุกครั้งที่ prefix เดาไม่ออก)
  resetProviderUsage();
  const { store } = makeStore();

  assert.equal(
    await countProviderCall("thailand-post", { store, now: AUGUST }),
    1,
  );
  assert.equal(usageOf("thailand-post", AUGUST), 1);
  assert.equal(usageOf("track123", AUGUST), 0, "แต่ละเจ้ายังนับแยกกัน");
});

test("เพดานของไปรษณีย์ไทยตั้งผ่าน env ได้เหมือนสองเจ้าแรก", (t) => {
  t.after(() => {
    delete process.env.THAILAND_POST_MONTHLY_CALL_LIMIT;
  });

  assert.equal(readQuota("thailand-post"), DEFAULT_QUOTA["thailand-post"]);

  process.env.THAILAND_POST_MONTHLY_CALL_LIMIT = "2000";
  assert.equal(readQuota("thailand-post"), 2_000);
});

test("ทุกเจ้าที่ประกาศไว้ต้องมีชื่อไทยและชื่อ env ครบ", () => {
  // เพิ่มเจ้าใหม่แล้วลืมใส่ป้าย = หน้าสถิติขึ้นช่องว่างโดยไม่มีอะไรฟ้อง
  for (const provider of PROVIDER_IDS) {
    assert.ok(PROVIDER_LABEL[provider], provider);
    assert.ok(QUOTA_VARS[provider], provider);
    assert.ok(DEFAULT_QUOTA[provider] > 0, provider);
  }
});

/* -------- โควตาที่สงวนไว้ให้การเก็บที่อยู่สาขา (นโยบาย ETrackings) -------- */

test("การค้นหาทั่วไปใช้ได้แค่ส่วนที่ไม่ได้สงวนไว้", async (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_CALL_LIMIT;
    delete process.env.ETRACKINGS_HARVEST_RESERVE;
  });

  process.env.ETRACKINGS_CALL_LIMIT = "50";
  process.env.ETRACKINGS_HARVEST_RESERVE = "30";

  resetProviderUsage();
  const { store } = makeStore({ etrackings: 19 });
  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(canUseForLookup("etrackings", AUGUST), true, "19 < 20 ยังค้นได้");

  await countProviderCall("etrackings", { store, now: AUGUST });

  assert.equal(
    canUseForLookup("etrackings", AUGUST),
    false,
    "ครบ 20 แล้ว ที่เหลือเป็นของการเก็บที่อยู่สาขา",
  );
  assert.equal(
    isExhausted("etrackings", AUGUST),
    false,
    "แต่ยังไม่หมด — การเก็บที่อยู่สาขายังใช้ต่อได้อีก 30 ครั้ง",
  );
});

test("ใช้ครบเพดาน → หมดทั้งสองทาง", async (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_CALL_LIMIT;
  });

  process.env.ETRACKINGS_CALL_LIMIT = "50";
  resetProviderUsage();
  const { store } = makeStore({ etrackings: 50 });
  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(isExhausted("etrackings", AUGUST), true);
  assert.equal(canUseForLookup("etrackings", AUGUST), false);
});

test("เจ้าที่ไม่ได้สงวนโควตา → ใช้ได้จนถึงเพดานเต็มๆ", async () => {
  resetProviderUsage();
  const { store } = makeStore({ track123: DEFAULT_QUOTA.track123 - 1 });
  await loadProviderUsage({ store, now: AUGUST });

  assert.equal(canUseForLookup("track123", AUGUST), true);
  assert.equal(isExhausted("track123", AUGUST), false);
});

test("สงวนเกินเพดาน → ถูกบีบลงมา ไม่ทำให้ค้นไม่ได้ตั้งแต่ครั้งแรก", (t) => {
  t.after(() => {
    delete process.env.ETRACKINGS_HARVEST_RESERVE;
    delete process.env.ETRACKINGS_CALL_LIMIT;
  });

  process.env.ETRACKINGS_CALL_LIMIT = "50";
  process.env.ETRACKINGS_HARVEST_RESERVE = "999";
  resetProviderUsage();

  // สงวนเท่ากับเพดานพอดี = การค้นหาทั่วไปใช้ไม่ได้เลย ซึ่งเป็นผลที่ตั้งใจของ
  // การตั้งค่าแบบนั้น แต่ต้องไม่ติดลบจนคำนวณเพี้ยน
  assert.equal(readHarvestReserve("etrackings"), 50);
  assert.equal(canUseForLookup("etrackings", AUGUST), false);
});
