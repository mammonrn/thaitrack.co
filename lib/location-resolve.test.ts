/**
 * เทสต์ลำดับการหาพิกัด
 *
 * สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือ "Google ถูกเรียกกี่ครั้ง และถูกเรียกด้วยอะไร"
 * เพราะทั้งงานนี้เกิดจากการที่เราส่งรหัสสาขาให้ Google แล้วได้หมุดมั่วกลับมา
 * ถ้าวันหนึ่งมีใครแก้ลำดับจนรหัสสาขาหลุดไปถึง Google อีก ต้องพังที่นี่ก่อน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Coordinates, GeocodeHit } from "./geocode.ts";
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
  recorded: {
    carrierCode: string;
    branchCode: string;
    branchName: string | null;
    kind: string;
  }[];
  written: { query: string; coordinates: Coordinates | null }[];
  claims: string[];
  /** true = ยอมให้จองสิทธิ์ไปถามที่อยู่สาขา */
  allowClaim: boolean;
}

function makeStore(): FakeStore {
  const branches = new Map<string, CarrierBranch>();
  const geocodes = new Map<string, CachedGeocode>();
  const recorded: FakeStore["recorded"] = [];
  const written: FakeStore["written"] = [];
  const claims: string[] = [];

  const store: FakeStore = {
    branches,
    geocodes,
    recorded,
    written,
    claims,
    allowClaim: true,
    findBranch: (carrierCode, branchCode) =>
      Promise.resolve(branches.get(`${carrierCode}::${branchCode}`) ?? null),
    recordUnknownBranch: (carrierCode, branchCode, branchName, kind) => {
      recorded.push({ carrierCode, branchCode, branchName, kind });
      return Promise.resolve();
    },
    readGeocode: (query) => Promise.resolve(geocodes.get(query) ?? null),
    writeGeocode: (query, hit) => {
      written.push({ query, coordinates: hit.coordinates });
      geocodes.set(query, {
        found: hit.coordinates !== null,
        coordinates: hit.coordinates,
        precision: hit.coordinates === null ? null : hit.precision,
        accuracyMeters: hit.accuracyMeters,
        areaOnly: hit.areaOnly,
      });
      return Promise.resolve();
    },
    claimBranchProbe: (carrierCode, branchCode) => {
      claims.push(`${carrierCode}::${branchCode}`);
      return Promise.resolve(store.allowClaim);
    },
    saveHarvestedBranch: (input) => {
      const key = `${input.carrierCode}::${input.branchCode}`;
      if (branches.has(key)) return Promise.resolve(false);
      branches.set(key, {
        carrierCode: input.carrierCode,
        branchCode: input.branchCode,
        branchName: input.branchName,
        lat: input.lat,
        lng: input.lng,
        accuracy: input.accuracy,
        note: input.address,
        updatedBy: "auto:etrackings",
        updatedAt: null,
      });
      return Promise.resolve(true);
    },
  };

  return store;
}

/**
 * ตัวหาพิกัดปลอมที่จำว่าถูกเรียกด้วยข้อความอะไรบ้าง
 *
 * accuracyMeters คือตัวที่ระบบใช้ตัดสิน — 80 ม. = ระดับบ้านเลขที่
 */
function makeGeocoder(
  result: Coordinates | null = CHIANG_RAI,
  accuracyMeters = 80,
  areaOnly = false,
) {
  const calls: string[] = [];
  return {
    calls,
    geocode: (text: string): Promise<GeocodeHit | null> => {
      calls.push(text);
      return Promise.resolve(
        result === null
          ? null
          : {
              coordinates: result,
              precision: "center" as const,
              accuracyMeters,
              areaOnly,
            },
      );
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
    accuracy: "exact",
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
    {
      carrierCode: CARRIER,
      branchCode: "ACRAI-B",
      branchName: "เมืองเชียงราย",
      kind: "branch",
    },
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
  await resolveLocation("  bangkok  ", "thailand-post", {
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

/* --------- ทุกกรณีที่จบด้วย "ไม่มีแผนที่" ต้องถูกจดไว้ให้แอดมิน --------- */

test("ข้อความที่ Google หาไม่เจอ → ถูกจดเป็น kind=address", async () => {
  const store = makeStore();

  await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", CARRIER, {
    store,
    geocode: makeGeocoder(null).geocode,
  });

  assert.deepEqual(store.recorded, [
    {
      carrierCode: CARRIER,
      branchCode: "ศูนย์คัดแยกที่ไม่มีจริง",
      branchName: null,
      kind: "address",
    },
  ]);
});

test("ผลที่จำไว้ว่าหาไม่เจอ → ยังถูกจดทุกครั้งที่เจอซ้ำ", async () => {
  // ถ้าจดแค่ครั้งแรก จำนวนครั้งที่เจอจะหยุดนิ่ง แอดมินจะเรียงลำดับงานไม่ได้
  const store = makeStore();
  const geocoder = makeGeocoder(null);

  await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });
  await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(store.recorded.length, 2);
  assert.equal(geocoder.calls.length, 1, "แต่ต้องไม่ถาม Google ซ้ำ");
});

test("ข้อความที่อ่านไม่ออก → ถูกจดเป็น kind=unknown", async () => {
  const store = makeStore();

  await resolveLocation("###???", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.equal(store.recorded[0]?.kind, "unknown");
});

test("รหัสล้วนอย่าง SOCN → เป็นรหัสสาขา ไม่ใช่ที่อยู่ ห้ามส่งให้ Google", async () => {
  // เดิมข้อความแบบนี้ผ่านเกณฑ์ "ดูเหมือนที่อยู่" แล้วถูกส่งไปหาพิกัด
  // ซึ่งเป็นทางที่ปักหมุดมั่วได้
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("SOCN", CARRIER, {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(result.kind, "branch");
  assert.equal(result.coordinates, null);
  assert.deepEqual(geocoder.calls, []);
  assert.equal(store.recorded[0]?.branchCode, "SOCN");
  assert.equal(store.recorded[0]?.kind, "branch");
});

test("พิกัดที่แอดมินกรอกไว้ ใช้ได้กับข้อความที่ไม่ใช่รหัสสาขาด้วย", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ศูนย์คัดแยกที่ไม่มีจริง`, {
    ...knownBranch(),
    branchCode: "ศูนย์คัดแยกที่ไม่มีจริง",
  });

  const result = await resolveLocation("ศูนย์คัดแยกที่ไม่มีจริง", CARRIER, {
    store,
    geocode: makeGeocoder(null).geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.source, "branch");
  assert.deepEqual(store.recorded, [], "เจอพิกัดแล้วต้องไม่ถูกจดว่ายังไม่รู้");
});

/* ------------------- ไปขอที่อยู่สาขามาเติมพิกัดเอง ------------------- */

/** ผลลัพธ์ปลอมที่มีที่อยู่สาขาห้อยมาด้วย แบบเดียวกับที่ ETrackings ส่งมาจริง */
function resultWithAddress() {
  return {
    trackingNumber: "SPXTH046012345678",
    carrierName: "Shopee Xpress",
    carrierCode: CARRIER,
    status: "in_transit" as const,
    statusText: "อยู่ระหว่างขนส่ง",
    lastUpdated: null,
    events: [
      {
        time: "2026-08-30T09:28:00+07:00",
        location: "ACRAI-B - เมืองเชียงราย",
        description: "พัสดุถึงสาขาปลายทาง",
        address: "639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100",
      },
    ],
  };
}

test("สาขาที่ยังไม่รู้พิกัด → ไปขอที่อยู่มาเติม แล้วใช้พิกัดนั้นได้เลย", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: geocoder.geocode,
    trackingNumber: "SPXTH046012345678",
    probe: {
      fetchResult: () => Promise.resolve(resultWithAddress()),
      canProbe: () => true,
      outOfQuota: () => false,
      geocode: geocoder.geocode,
    },
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.source, "branch_filled");
  assert.deepEqual(store.claims, [`${CARRIER}::ACRAI-B`]);
  assert.deepEqual(
    geocoder.calls,
    ["639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100"],
    "ต้องหาพิกัดจากที่อยู่จริง ไม่ใช่จากชื่อสาขา",
  );
});

test("จองสิทธิ์ไม่ได้ (เพิ่งถามไปแล้ว) → ไม่ยิงขนส่งเลย", async () => {
  const store = makeStore();
  store.allowClaim = false;
  let fetched = 0;

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
    trackingNumber: "SPXTH046012345678",
    probe: {
      fetchResult: () => {
        fetched += 1;
        return Promise.resolve(resultWithAddress());
      },
      canProbe: () => true,
      outOfQuota: () => false,
    },
  });

  assert.equal(fetched, 0, "ด่านจองสิทธิ์คือตัวรับประกันว่าสาขาหนึ่งจ่ายครั้งเดียว");
  assert.equal(result.coordinates, null);
});

test("โควตาหมดเกลี้ยง → ไม่ไปขอที่อยู่", async () => {
  // ⚠️ เกณฑ์นี้กลับด้านจากเดิม: เดิมหยุดตอน "ใกล้เต็ม" เพื่อเก็บโควตาไว้ให้
  // การค้นหา ตอนนี้การเก็บที่อยู่สาขาได้สิทธิ์ก่อน เพราะพิกัดที่ได้อยู่ถาวร
  // ส่วนการค้นหาทั่วไป Track123 ก็ทำได้ (ดู canUseForLookup)
  const store = makeStore();
  let fetched = 0;

  await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
    trackingNumber: "SPXTH046012345678",
    probe: {
      fetchResult: () => {
        fetched += 1;
        return Promise.resolve(resultWithAddress());
      },
      canProbe: () => true,
      outOfQuota: () => true,
    },
  });

  assert.equal(fetched, 0);
  assert.deepEqual(store.claims, [], "ต้องไม่แม้แต่จองสิทธิ์ — ไม่งั้นเผา cooldown ทิ้ง");
});

test("ไม่ได้ส่งเลขพัสดุมา → ทำงานเหมือนเดิมทุกอย่าง ไม่มีการไปขอที่อยู่", async () => {
  const store = makeStore();

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.equal(result.coordinates, null);
  assert.deepEqual(store.claims, []);
});

/* ------------- เกณฑ์ความละเอียดครอบเส้นทางที่อยู่ด้วย ------------- */

test("ที่อยู่ที่ได้พิกัดคลาดเคลื่อนหลายกิโล → ปักหมุดได้ แต่ติดชั้น coarse", async () => {
  const store = makeStore();

  const result = await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: makeGeocoder(CHIANG_RAI, 8_299).geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.accuracy, "coarse");
});

test("คลาดเคลื่อนราวหนึ่งกิโล → ติดชั้น approximate", async () => {
  const store = makeStore();

  const result = await resolveLocation("ศูนย์ไปรษณีย์หลักสี่", "thailand-post", {
    store,
    geocode: makeGeocoder(CHIANG_RAI, 900).geocode,
  });

  assert.equal(result.accuracy, "approximate");
});

test("กรอบใหญ่แต่ไม่ใช่เขตปกครอง → ปักหมุดพร้อมป้าย ไม่บล็อกเพราะระยะทางอีกแล้ว", async () => {
  // K1: ระยะทางไม่ใช่เหตุผลที่จะไม่โชว์แผนที่ ผู้ใช้ได้เห็นว่า "อยู่แถวไหน"
  // พร้อมป้ายบอกความคลาดเคลื่อน ดีกว่าไม่เห็นอะไรเลย
  const store = makeStore();

  const result = await resolveLocation("เมืองเชียงราย", "thailand-post", {
    store,
    geocode: makeGeocoder(CHIANG_RAI, 25_000).geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.accuracy, "coarse");
  // ปักหมุดได้แล้วก็ไม่ใช่งานค้างของแอดมินอีกต่อไป จึงไม่ต้องจด
  assert.deepEqual(store.recorded, []);
});

test("Google บอกเองว่าเป็นเขตปกครอง → ไม่ปักหมุด ต่อให้กรอบจะเล็ก", async () => {
  const store = makeStore();

  const result = await resolveLocation("เชียงราย", "thailand-post", {
    store,
    geocode: makeGeocoder(CHIANG_RAI, 80, true).geocode,
  });

  assert.equal(result.coordinates, null);
});

test("พิกัดระดับพื้นที่ที่ cache ไว้แล้ว → ยังไม่ปักหมุด และไม่ถาม Google ซ้ำ", async () => {
  // ใช้ areaOnly = true เพื่อให้เป็น "พื้นที่" จริงๆ ไม่ใช่แค่กรอบใหญ่ —
  // ตั้งแต่ตัดเพดาน ขนาดกรอบอย่างเดียวไม่ทำให้ถูกปฏิเสธอีกต่อไป
  const store = makeStore();
  const geocoder = makeGeocoder(CHIANG_RAI, 25_000, true);

  await resolveLocation("เมืองเชียงราย", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });
  const second = await resolveLocation("เมืองเชียงราย", "thailand-post", {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(second.coordinates, null);
  assert.equal(geocoder.calls.length, 1);
  assert.equal(store.recorded.length, 2, "ต้องจดทุกครั้งที่เจอ");
});

test("พิกัดจากตารางสาขาส่งชั้นความละเอียดของแถวนั้นออกมาด้วย", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, {
    ...knownBranch(),
    accuracy: "approximate",
  });

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.deepEqual(result.coordinates, CHIANG_RAI);
  assert.equal(result.accuracy, "approximate");
});

test("พิกัดที่แอดมินกรอกเอง → exact ไม่ต้องขึ้นป้าย", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, knownBranch());

  const result = await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.equal(result.accuracy, "exact");
});

/* ------------------ courier ที่ยืนยันแล้วส่งต่อถึงด่านขอที่อยู่ ------------------ */

test("ส่ง courier ที่ยืนยันแล้วต่อไปให้ด่านขอที่อยู่สาขา", async () => {
  // เลข TH… ของ SPX ดู prefix แล้วบอกไม่ได้ ถ้าไม่ส่งค่านี้ต่อ ด่านแรกของ
  // การขอที่อยู่จะตกเสมอ และการเติมพิกัดสาขาจะไม่ทำงานกับเลขส่วนใหญ่เลย
  const store = makeStore();
  const seen: (string | undefined)[] = [];

  await resolveLocation("ACRAI-B - เมืองเชียงราย", CARRIER, {
    store,
    geocode: makeGeocoder().geocode,
    trackingNumber: "TH264511339099F",
    courierHint: "shopee-xpress-th",
    probe: {
      canProbe: (_no, hint) => {
        seen.push(hint);
        return true;
      },
      outOfQuota: () => false,
      fetchResult: () => Promise.resolve(resultWithAddress()),
    },
  });

  assert.deepEqual(seen, ["shopee-xpress-th"]);
});
