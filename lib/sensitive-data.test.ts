/**
 * เทสต์เฝ้าว่าข้อมูลอ่อนไหวไม่มีทางหลุดไปหาคนที่ไม่มีสิทธิ์
 *
 * ของที่เฝ้าอยู่มีสามอย่าง เรียงจากอ่อนไหวน้อยไปมาก:
 *   ชื่อผู้รับเต็ม · ชื่อผู้เซ็นรับเต็ม · รูปถ่ายตอนนำจ่าย
 *
 * สองอย่างแรกถูกปิดตั้งแต่ adapter จึงไม่มีค่าเต็มให้หลุด (ดู lib/mask-name.ts)
 * ส่วนอย่างที่สามมีค่าจริงเดินทางอยู่ในระบบ และต้องผ่านสองด่านเสมอ:
 *
 *   1. **ห้ามลง tracking_cache** ซึ่งเป็นของกลางที่ทุกคนที่ค้นเลขเดียวกันใช้
 *      ร่วมกัน — ถ้าหลุดลงไป คนที่ค้นเลขเดียวกันคนถัดไปจะได้รูปบ้านคนอื่นไปดู
 *   2. **ห้ามอยู่ใน response ก้อนหลัก** ต้องแยกเป็นฟิลด์ที่เซิร์ฟเวอร์ใส่ให้
 *      เฉพาะคนที่ผ่านเกณฑ์เท่านั้น
 *
 * ทั้งสองด่านล้มเหลวแบบเงียบสนิทได้ — ไม่มี error ไม่มีอาการ มีแต่ข้อมูลที่
 * ไปอยู่ผิดที่ กว่าจะรู้ก็ต่อเมื่อมีคนไปเปิดตารางดู เทสต์จึงต้องเป็นคนเฝ้า
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

import { clearCache } from "./cache.ts";
import type { TrackingResult } from "./carriers/types.ts";
import type { CacheEntry } from "./cache.ts";
import type { PersistentTrackingCache } from "./supabase/tracking-cache.ts";
import { lookupTracking, rememberTracking, withoutSensitive } from "./tracking-cache.ts";

const PROJECT_DIR = resolve(import.meta.dirname, "..");
const PROOF_URL = "https://cdn.example.com/proof/secret.jpg";

function makeResult(): TrackingResult {
  return {
    trackingNumber: "TH264511339099F",
    carrierName: "Flash Express",
    carrierCode: "flashexpress",
    status: "delivered",
    statusText: "ส่งถึงแล้ว",
    lastUpdated: "2026-08-30T14:00:00+07:00",
    events: [],
    shipment: {
      originProvince: "ราชบุรี",
      destinationProvince: "เชียงราย",
      deliveryStaffName: null,
      dueDate: null,
      cashOnDelivery: null,
      deliveryType: "On-Time Delivery",
      callCenterPhone: "1436",
      sender: "amonthepnontarug",
      recipientMasked: "ภูมิ ธ***",
      signerMasked: "แผน***",
    },
    sensitive: { proofPhotoUrls: [PROOF_URL] },
  };
}

function makeCache(): PersistentTrackingCache & { rows: Map<string, CacheEntry> } {
  const rows = new Map<string, CacheEntry>();
  return {
    rows,
    read: (trackingNumber) => Promise.resolve(rows.get(trackingNumber) ?? null),
    write: (trackingNumber, entry) => {
      rows.set(trackingNumber, entry);
      return Promise.resolve();
    },
  };
}

/* -------------------- ด่านที่ 1: ห้ามลง cache -------------------- */

test("เขียนลง cache ถาวร → รูปถ่ายต้องไม่ติดไปด้วย", () => {
  const cache = makeCache();
  clearCache();

  void rememberTracking("TH264511339099F", makeResult(), cache);

  const stored = JSON.stringify([...cache.rows.values()]);
  assert.doesNotMatch(stored, /cdn\.example\.com/, "รูปถ่ายหลุดลง cache ถาวร");
});

test("เขียนลง cache ใน memory → รูปถ่ายต้องไม่ติดไปด้วย", async () => {
  // cache ใน memory ก็เป็นของกลางเหมือนกัน ทุกคนที่ยิงมาที่ instance เดียวกัน
  // ใช้ร่วมกันหมด การกันเฉพาะชั้น Supabase จึงไม่พอ
  const cache = makeCache();
  clearCache();

  await rememberTracking("TH264511339099F", makeResult(), cache);
  const found = await lookupTracking("TH264511339099F", {
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(),
  });

  assert.ok(found !== null);
  assert.equal(found.entry.result.sensitive, null);
});

test("ของที่เพิ่งยิงมาสดๆ ต้องไม่ถูกแก้ — ผู้เรียกที่มีสิทธิ์ยังต้องใช้ต่อได้", () => {
  const result = makeResult();
  clearCache();

  void rememberTracking("TH264511339099F", result, makeCache());

  assert.deepEqual(result.sensitive?.proofPhotoUrls, [PROOF_URL]);
});

test("ข้อมูลที่ไม่อ่อนไหวต้องยังอยู่ครบหลังตัด", () => {
  const stripped = withoutSensitive(makeResult());

  assert.equal(stripped.sensitive, null);
  assert.equal(stripped.shipment?.recipientMasked, "ภูมิ ธ***");
  assert.equal(stripped.shipment?.callCenterPhone, "1436");
  assert.equal(stripped.status, "delivered");
});

/* -------------------- ด่านที่ 2: ทางที่ข้อมูลไหลได้ -------------------- */

interface SourceFile {
  path: string;
  source: string;
}

function collect(dir: string): SourceFile[] {
  const found: SourceFile[] = [];

  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts")) continue;
      found.push({
        path: relative(PROJECT_DIR, path),
        source: readFileSync(path, "utf8"),
      });
    }
  };

  walk(dir);
  return found;
}

const allFiles = [
  ...collect(join(PROJECT_DIR, "app")),
  ...collect(join(PROJECT_DIR, "lib")),
];

test("รูปถ่ายตอนนำจ่ายถูกแตะได้จากไฟล์ที่ตั้งใจเท่านั้น", () => {
  // ยิ่งมีที่แตะได้น้อย ยิ่งไล่ตรวจได้ครบ — ไฟล์ใหม่ที่แตะค่านี้ต้องมาแก้
  // รายชื่อตรงนี้ ซึ่งบังคับให้คนเพิ่มต้องอ่านกติกาในไฟล์นี้ก่อน
  const users = allFiles
    .filter((file) => file.source.includes("proofPhotoUrl"))
    .map((file) => file.path)
    .sort();

  assert.deepEqual(users, [
    "app/api/track/route.ts",
    // ย้ายมาจาก app/page.tsx ตอนแยก component ค้นหาออกมาให้หน้า landing ใช้ร่วม
    // — หน้าแรกกลายเป็น server component ที่ไม่แตะข้อมูลอ่อนไหวเลย
    "app/tracking-search.tsx",
    "lib/carriers/etrackings.ts",
    "lib/carriers/types.ts",
    "lib/tracking-view.ts",
  ]);
});

test("เส้นทางบันทึกประวัติต้องไม่แตะข้อมูลอ่อนไหวเลย", () => {
  // /api/saved เขียนลง saved_trackings ซึ่งเป็นของผู้ใช้ ไม่ใช่ของกลาง แต่ก็ไม่
  // ควรเก็บรูปไว้ที่นั่นเช่นกัน — เก็บแล้วต้องมีคนดูแลอายุของมันต่อ
  const saved = allFiles.find((file) => file.path === "app/api/saved/route.ts");
  assert.ok(saved !== undefined);

  assert.doesNotMatch(saved.source, /proofPhotoUrl|sensitive|signerImageURL/);
});

test("URL รูปดิบจากขนส่งถูกอ่านที่ adapter ที่เดียว", () => {
  const users = allFiles
    .filter((file) => file.source.includes("signerImageURL"))
    .map((file) => file.path);

  assert.deepEqual(users, ["lib/carriers/etrackings.ts"]);
});

test("API ต้องตัดข้อมูลอ่อนไหวออกจากก้อนข้อมูลหลักก่อนตอบเสมอ", () => {
  const route = allFiles.find((file) => file.path === "app/api/track/route.ts");
  assert.ok(route !== undefined);

  assert.match(
    route.source,
    /data: withoutSensitive\(/,
    "ต้องส่ง data ที่ตัดของอ่อนไหวออกแล้วเท่านั้น",
  );
});

test("สิทธิ์ดูรูปต้องตัดสินฝั่งเซิร์ฟเวอร์ ไม่ใช่ซ่อนที่ฝั่งเบราว์เซอร์", () => {
  const page = allFiles.find((file) => file.path === "app/page.tsx");
  assert.ok(page !== undefined);

  // หน้าเว็บได้แค่ค่าที่เซิร์ฟเวอร์ยอมส่งมา ห้ามมีตรรกะตัดสินสิทธิ์ของตัวเอง
  assert.doesNotMatch(page.source, /canRevealProof|savedAt/);
});

test("สัญญากลางต้องไม่มีช่องเก็บชื่อเต็มของผู้รับหรือผู้เซ็นรับ", () => {
  const types = allFiles.find(
    (file) => file.path === "lib/carriers/types.ts",
  );
  assert.ok(types !== undefined);

  // ชื่อฟิลด์ต้องลงท้ายด้วย Masked เสมอ เพื่อให้การเผลอใส่ค่าเต็มอ่านแล้วผิด
  // ตั้งแต่ตอนเขียน ไม่ต้องรอให้ใครไปตรวจตอน review
  assert.match(types.source, /recipientMasked/);
  assert.match(types.source, /signerMasked/);
  assert.doesNotMatch(types.source, /^\s*recipient\s*:/m);
  assert.doesNotMatch(types.source, /^\s*signer\s*:/m);
});
