/**
 * เทสต์โควตาของ Google สองตัว
 *
 * ⚠️ ทุกเทสต์ mock เวลาเสมอ ห้ามใช้เวลาจริง — รอบบิลเป็น daily ตัด ณ เที่ยงคืน
 * เวลาไทย (bangkokDate) ถ้าใช้เวลาจริง เทสต์จะพังตอนรันคร่อมเที่ยงคืน ซึ่งเป็น
 * ความพังที่เกิดปีละไม่กี่ครั้งและหาสาเหตุยากที่สุด
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_QUOTA,
  PROVIDER_IDS,
  QUOTA_VARS,
  countProviderCall,
  currentPeriodKey,
  isExhausted,
  readPeriod,
  readQuota,
  resetProviderUsage,
  usageOf,
} from "./provider-usage.ts";
import { recoverableQuotaAlerts, standingQuotaWarnings } from "./health-check.ts";
import type { ProviderUsageStore } from "./supabase/provider-usage.ts";

const silentStore: ProviderUsageStore = {
  bump: () => Promise.resolve(null),
  read: () => Promise.resolve({}),
};

/** เที่ยงวันของวันที่ 5 ก.ย. 2569 เวลาไทย — กลางวันชัดเจน ไม่คร่อมขอบวัน */
const NOON = Date.UTC(2026, 8, 5, 5, 0, 0);
/** วันถัดไป เวลาเดียวกัน */
const NEXT_NOON = NOON + 24 * 60 * 60_000;

test("Google ทั้งสองตัวอยู่ในรายชื่อผู้ให้บริการที่มีตัวนับ", () => {
  assert.ok(PROVIDER_IDS.includes("google-static-maps"));
  assert.ok(PROVIDER_IDS.includes("google-geocoding"));
});

test("รอบบิลเป็น daily ไม่ใช่ monthly", () => {
  // ⚠️ เพดานเป็นรายวัน ถ้ารอบบิลเป็น monthly ตัวนับจะสะสมทั้งเดือนแล้วชนเพดาน
  // ตั้งแต่วันที่ 2 · การยิงผิดปกติเกิดเป็นชั่วโมง ไม่ใช่เป็นเดือน
  for (const provider of ["google-static-maps", "google-geocoding"] as const) {
    assert.equal(readPeriod(provider).cycle, "daily", provider);
  }
});

test("เพดานเริ่มต้น 500 / 100", () => {
  assert.equal(DEFAULT_QUOTA["google-static-maps"], 500);
  assert.equal(DEFAULT_QUOTA["google-geocoding"], 100);
});

test("ตั้งเพดานผ่าน env ได้ และชื่อสอดคล้องกับของเดิม", (t) => {
  t.after(() => {
    delete process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT;
    resetProviderUsage();
  });

  assert.equal(QUOTA_VARS["google-static-maps"], "GOOGLE_STATIC_MAPS_CALL_LIMIT");
  assert.equal(QUOTA_VARS["google-geocoding"], "GOOGLE_GEOCODING_CALL_LIMIT");

  process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT = "42";
  assert.equal(readQuota("google-static-maps"), 42);
});

test("นับจนชนเพดาน → isExhausted เป็นจริง", async (t) => {
  t.after(() => {
    delete process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT = "3";
  resetProviderUsage();

  for (let i = 0; i < 2; i += 1) {
    await countProviderCall("google-static-maps", { store: silentStore, now: NOON });
  }
  assert.equal(isExhausted("google-static-maps", NOON), false, "2 จาก 3 ยังไม่หมด");

  await countProviderCall("google-static-maps", { store: silentStore, now: NOON });
  assert.equal(isExhausted("google-static-maps", NOON), true, "ครบ 3 = หมด");
});

test("⚠️ ข้ามเที่ยงคืนไทย → ตัวนับรีเซ็ต (mock เวลา ไม่ใช้เวลาจริง)", async (t) => {
  t.after(() => {
    delete process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.GOOGLE_STATIC_MAPS_CALL_LIMIT = "2";
  resetProviderUsage();

  await countProviderCall("google-static-maps", { store: silentStore, now: NOON });
  await countProviderCall("google-static-maps", { store: silentStore, now: NOON });
  assert.equal(isExhausted("google-static-maps", NOON), true);

  // วันถัดไป — คีย์รอบเปลี่ยน ตัวนับต้องกลับเป็นศูนย์
  assert.notEqual(
    currentPeriodKey("google-static-maps", NEXT_NOON),
    currentPeriodKey("google-static-maps", NOON),
  );
  assert.equal(usageOf("google-static-maps", NEXT_NOON), 0);
  assert.equal(
    isExhausted("google-static-maps", NEXT_NOON),
    false,
    "ชนเพดานแล้วต้องหายเองเมื่อขึ้นวันใหม่ — นั่นคือเหตุผลที่เลือก daily",
  );
});

test("Google เข้ากลุ่มที่ /api/health/quota ปลุกคนได้ (เพราะรีเซ็ตได้)", async (t) => {
  t.after(() => {
    delete process.env.GOOGLE_GEOCODING_CALL_LIMIT;
    resetProviderUsage();
  });

  process.env.GOOGLE_GEOCODING_CALL_LIMIT = "10";
  resetProviderUsage();

  for (let i = 0; i < 9; i += 1) {
    await countProviderCall("google-geocoding", { store: silentStore, now: NOON });
  }

  assert.deepEqual(
    recoverableQuotaAlerts(NOON),
    ["google-geocoding"],
    "หมดแล้วฟื้นเองเที่ยงคืน = เตือนแล้วมีปลายทาง",
  );
  assert.deepEqual(
    standingQuotaWarnings(NOON),
    [],
    "ไม่ใช่โควตาแบบ lifetime จึงต้องไม่เข้ากลุ่มที่ห้ามปลุก",
  );
});
