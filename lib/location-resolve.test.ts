/**
 * เทสต์ลำดับการหาพิกัด
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือ "Google ถูกเรียกกี่ครั้ง และถูกเรียกด้วยอะไร"
 * เพราะทั้งงานนี้เกิดจากการที่เราส่งรหัสสาขาให้ Google แล้วได้หมุดมั่วกลับมา
 * ถ้าวันหนึ่งมีใครแก้ลำดับจนรหัสสาขาหลุดไปถึง Google อีก ต้องพังที่นี่ก่อน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Coordinates } from "./geocode.ts";
import { resolveLocation } from "./location-resolve.ts";
import type {
  CachedGeocode,
  CarrierBranch,
  LocationStore,
} from "./supabase/locations.ts";

const CHIANG_RAI: Coordinates = { lat: 19.9105, lng: 99.8406 };
const CARRIER = "flash-express";

interface FakeStore extends LocationStore {
  branches: Map<string, CarrierBranch>;
  geocodes: Map<string, CachedGeocode>;
  recorded: { carrierCode: string; branchCode: string; branchName: string | null }[];
  written: { query: string; coordinates: Coordinates | null }[];
}

function makeStore(): FakeStore {
  const branches = new Map<string, CarrierBranch>();
  const geocodes = new Map<string, CachedGeocode>();
  const recorded: FakeStore["recorded"] = [];
  const written: FakeStore["written"] = [];

  return {
    branches,
    geocodes,
    recorded,
    written,
    findBranch: (carrierCode, branchCode) =>
      Promise.resolve(branches.get(`${carrierCode}::${branchCode}`) ?? null),
    recordUnknownBranch: (carrierCode, branchCode, branchName) => {
      recorded.push({ carrierCode, branchCode, branchName });
      return Promise.resolve();
    },
    readGeocode: (query) => Promise.resolve(geocodes.get(query) ?? null),
    writeGeocode: (query, coordinates) => {
      written.push({ query, coordinates });
      geocodes.set(query, { found: coordinates !== null, coordinates });
      return Promise.resolve();
    },
  };
}

/** ตัวหาพิกัดปลอมที่จำว่าถูกเรียกด้วยข้อความอะไรบ้าง */
function makeGeocoder(result: Coordinates | null = CHIANG_RAI) {
  const calls: string[] = [];
  return {
    calls,
    geocode: (text: string) => {
      calls.push(text);
      return Promise.resolve(result);
    },
  };
}

function knownBranch(overrides: Partial<CarrierBranch> = {}): CarrierBranch {
  return {
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    branchName: "สาขาเมืองเชียงราย",
    lat: CHIANG_RAI.lat,
    lng: CHIANG_RAI.lng,
    note: null,
    updatedBy: "boss@example.com",
    updatedAt: null,
    ...overrides,
  };
}

/* ---------------------- รหัสสาขาที่รู้พิกัดแล้ว ---------------------- */

test("รหัสสาขาที่มีในตาราง → ใช้พิกัดนั้น ไม่แตะ Google เลย", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, knownBranch());
  const geocoder = makeGeocoder();

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.source, "branch");
  assert.deepEqual(geocoder.calls, [], "ห้ามเรียก Google เมื่อรู้พิกัดอยู่แล้ว");
  assert.deepEqual(store.recorded, [], "รู้จักแล้วต้องไม่ถูกจดเป็นสาขาที่ไม่รู้จัก");
});

test("ชื่อที่แอดมินกรอกไว้ชนะชื่อที่ขนส่งส่งมาในครั้งนี้", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, knownBranch());

  const result = await resolveLocation("ACRAI-B - เชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.equal(result.displayText, "สาขาเมืองเชียงราย");
});

test("แยกตามขนส่ง — รหัสเดียวกันคนละเจ้าคือคนละสาขา", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, knownBranch());
  const geocoder = makeGeocoder();

  const other = await resolveLocation("ACRAI-B - เมืองเชียงราย", "kerry-express", {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(other.coordinates, null);
  assert.deepEqual(geocoder.calls, []);
  assert.equal(store.recorded[0]?.carrierCode, "kerry-express");
});

/* --------------------- รหัสสาขาที่ยังไม่รู้พิกัด --------------------- */

test("รหัสสาขาที่ไม่รู้จัก → ไม่มีพิกัด ไม่แตะ Google และถูกจดไว้", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(result.coordinates, null, "ไม่รู้ว่าอยู่ไหน ห้ามเดา");
  assert.equal(result.source, "none");
  assert.equal(result.branchCode, "ACRAI-B");
  assert.equal(result.displayText, "เมืองเชียงราย", "ต้องมีอะไรให้ผู้ใช้อ่าน");

  assert.deepEqual(
    geocoder.calls,
    [],
    "ห้ามเอาชื่อสาขาไปหาพิกัดต่อ — จะได้หมุดกลางอำเภอ คือปัญหาเดิมเป๊ะๆ",
  );
  assert.deepEqual(store.recorded, [
    { carrierCode: CARRIER, branchCode: "ACRAI-B", branchName: "เมืองเชียงราย" },
  ]);
});

test("เจอสาขาเดิมซ้ำ → ถูกจดทุกครั้ง (ฝั่งฐานข้อมูลเป็นคนบวกจำนวนครั้ง)", async () => {
  const store = makeStore();

  for (let index = 0; index < 3; index += 1) {
    await resolveLocation("NO4_HUB-เชียงราย", CARRIER, {
      store,
      geocode: makeGeocoder().geocode,
    });
  }

  assert.equal(store.recorded.length, 3);
});

/* ---------------------------- ที่อยู่จริง ---------------------------- */

test("ข้อความที่ดูเหมือนที่อยู่ → ถาม Google แล้วเก็บผลไว้", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.source, "geocode_fresh");
  assert.deepEqual(geocoder.calls, ["ศูนย์ไปรษณีย์หลักสี่"]);
  assert.deepEqual(store.written, [
    { query: "ศูนย์ไปรษณีย์หลักสี่", coordinates: CHIANG_RAI },
  ]);
});

test("ข้อความเดิมครั้งที่สอง → ใช้ผลที่เก็บไว้ ไม่ถาม Google ซ้ำ", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });
  const second = await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(second.source, "geocode_saved");
  assert.deepEqual(second.coordinates, CHIANG_RAI);
  assert.equal(geocoder.calls.length, 1, "ต้องถาม Google แค่ครั้งเดียว");
});

test("Google หาไม่เจอ → จำไว้ด้วย จะได้ไม่ถามซ้ำตลอดไป", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder(null);

  const first = await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });
  assert.equal(first.coordinates, null);
  assert.deepEqual(store.written, [
    { query: "ศูนย์คัดแยกที่ไม่มีจริง", coordinates: null },
  ]);

  const second = await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });
  assert.equal(second.coordinates, null);
  assert.equal(geocoder.calls.length, 1, "ผลที่หาไม่เจอต้องถูกจำไว้เหมือนกัน");
});

test("ข้อความที่ต่างกันแค่ตัวพิมพ์/ช่องว่าง → ใช้ผลก้อนเดียวกัน", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  await resolveLocation("Bangkok", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });
  await resolveLocation("  BANGKOK  ", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(geocoder.calls.length, 1);
});

/* --------------------------- ทางที่ล้มเหลว --------------------------- */

test("ข้อความว่าง → ไม่ทำอะไรเลย", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("   ", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(result.coordinates, null);
  assert.equal(result.displayText, "");
  assert.deepEqual(geocoder.calls, []);
  assert.deepEqual(store.recorded, []);
});

test("ข้อความที่อ่านไม่ออก → ไม่เสีย quota ไปกับการเดา", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("###???", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(result.coordinates, null);
  assert.equal(result.kind, "unknown");
  assert.deepEqual(geocoder.calls, []);
});

test("ตัวหาพิกัดโยน error → ไม่ทะลุขึ้นไป และไม่จำผลผิดๆ ไว้", async () => {
  const store = makeStore();

  const result = await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: () => Promise.reject(new Error("เครือข่ายล่ม")),
  });

  assert.equal(result.coordinates, null);
  assert.deepEqual(
    store.written,
    [],
    "ยังไม่รู้ว่าหาไม่เจอหรือถามไม่ถึง จึงห้ามจำว่า 'ไม่มี'",
  );
});
