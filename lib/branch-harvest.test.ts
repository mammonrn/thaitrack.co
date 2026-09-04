/**
 * เทสต์การเติมพิกัดสาขาอัตโนมัติ
 *
 * สองอย่างที่เทสต์ชุดนี้เฝ้าไว้ และทั้งคู่ล้มเหลวแบบเงียบๆ ได้ถ้าไม่มีใครดู:
 *
 *   1. **พิกัดหยาบต้องไม่หลุดลง carrier_branches** ตารางนั้นคือที่ที่ทั้งระบบ
 *      เชื่อว่าถูกต้อง ถ้าหมุดกลางอำเภอเข้าไปนั่ง ผู้ใช้จะเห็นหมุดผิดโดยไม่มี
 *      ทางรู้ตัว และไม่มี error ที่ไหนขึ้นเลย
 *   2. **ด่านกันเผาโควตาต้องทำงานครบทุกชั้น** ชั้นที่หลุดไปจะไม่ทำให้อะไรพัง
 *      จนกว่าจะถึงวันที่โควตาหมดกลางเดือน
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectBranchAddresses,
  harvestBranchCoordinates,
  probeBranchAddress,
  resetProbeBudget,
} from "./branch-harvest.ts";
import type { TrackingResult } from "./carriers/types.ts";
import type { Coordinates, GeocodeHit } from "./geocode.ts";
import type {
  CachedGeocode,
  CarrierBranch,
  LocationStore,
} from "./supabase/locations.ts";

const CARRIER = "shopee-xpress-th";
const ADDRESS = "639 หมู่ที่1 ตำบลบ้านดู่ อำเภอเมืองเชียงราย จังหวัดเชียงราย 57100";
const CHIANG_RAI: Coordinates = { lat: 19.9814, lng: 99.8776 };

interface FakeStore extends LocationStore {
  branches: Map<string, CarrierBranch>;
  geocodes: Map<string, CachedGeocode>;
  saved: string[];
  claims: string[];
  allowClaim: boolean;
}

function makeStore(): FakeStore {
  const branches = new Map<string, CarrierBranch>();
  const geocodes = new Map<string, CachedGeocode>();
  const saved: string[] = [];
  const claims: string[] = [];

  const store: FakeStore = {
    branches,
    geocodes,
    saved,
    claims,
    allowClaim: true,
    findBranch: (carrierCode, branchCode) =>
      Promise.resolve(branches.get(`${carrierCode}::${branchCode}`) ?? null),
    recordUnknownBranch: () => Promise.resolve(),
    readGeocode: (query) => Promise.resolve(geocodes.get(query) ?? null),
    writeGeocode: (query, hit) => {
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
      saved.push(key);
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
 * ตัวหาพิกัดปลอม — คุมด้วย "รัศมีความคลาดเคลื่อน" ซึ่งเป็นตัวที่ระบบใช้ตัดสิน
 *
 * 80 ม. = ระดับบ้านเลขที่ (exact) · 3 กม. = ระดับตำบล (approximate)
 * · 25 กม. = ระดับอำเภอ (area — ต้องถูกปฏิเสธ)
 */
function makeGeocoder(
  accuracyMeters: number | null = 80,
  coordinates: Coordinates | null = CHIANG_RAI,
  areaOnly = false,
) {
  const calls: string[] = [];
  return {
    calls,
    geocode: (text: string): Promise<GeocodeHit | null> => {
      calls.push(text);
      if (coordinates === null || accuracyMeters === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        coordinates,
        precision: "center",
        accuracyMeters,
        areaOnly,
      });
    },
  };
}

function makeResult(
  events: TrackingResult["events"],
  carrierCode = CARRIER,
): TrackingResult {
  return {
    trackingNumber: "SPXTH046012345678",
    carrierName: "Shopee Xpress",
    carrierCode,
    status: "in_transit",
    statusText: "อยู่ระหว่างขนส่ง",
    lastUpdated: null,
    events,
  };
}

const branchEvent = (address: string | null = ADDRESS) => ({
  time: "2026-08-30T09:28:00+07:00",
  location: "ACRAI-B - เมืองเชียงราย",
  description: "พัสดุถึงสาขาปลายทาง",
  ...(address === null ? {} : { address }),
});

/* ------------------------ การคัดสาขาที่มีที่อยู่ ------------------------ */

test("เอาเฉพาะบรรทัดที่มีทั้งรหัสสาขาและที่อยู่", () => {
  const found = collectBranchAddresses(
    makeResult([
      { time: "", location: "ACRAI-B - เมืองเชียงราย", description: "ก" },
      { time: "", location: "", description: "ข", address: ADDRESS },
      { time: "", location: "ศูนย์คัดแยกสมุทรสาคร", description: "ค", address: ADDRESS },
      branchEvent(),
    ]),
  );

  assert.deepEqual(found, [
    { branchCode: "ACRAI-B", branchName: "เมืองเชียงราย", address: ADDRESS },
  ]);
});

test("รหัสเดียวกันหลายบรรทัด → เหลืออันเดียว", () => {
  const found = collectBranchAddresses(
    makeResult([branchEvent(), branchEvent(), branchEvent()]),
  );

  assert.equal(found.length, 1);
});

/* -------------------------- การเขียนพิกัดจริง -------------------------- */

test("ที่อยู่ที่หาพิกัดได้แม่น → บันทึกลงตารางสาขา", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(saved, 1);
  assert.deepEqual(store.saved, [`${CARRIER}::ACRAI-B`]);
  assert.deepEqual(geocoder.calls, [ADDRESS]);

  const branch = store.branches.get(`${CARRIER}::ACRAI-B`);
  assert.equal(branch?.lat, CHIANG_RAI.lat);
  assert.equal(branch?.branchName, "เมืองเชียงราย");
  assert.equal(branch?.accuracy, "exact");
});

test("ที่อยู่ไทยเต็มยศ (8.3 กม. จากของจริง) → บันทึกได้ ติดชั้น coarse", async () => {
  // เกณฑ์เดิม 5 กม. ทำให้ค่านี้ตกทุกครั้ง การเก็บพิกัดสาขาจึงไม่เคยทำงานเลย
  // ตอนนี้รับได้ แต่ต้องติดชั้นไว้ให้ UI บอกผู้ใช้ว่าคลาดเคลื่อนได้หลายกิโล
  const store = makeStore();

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: makeGeocoder(8_299).geocode,
  });

  assert.equal(saved, 1);
  assert.equal(store.branches.get(`${CARRIER}::ACRAI-B`)?.accuracy, "coarse");
});

test("คลาดเคลื่อนราวหนึ่งกิโล → ติดชั้น approximate", async () => {
  const store = makeStore();

  await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: makeGeocoder(900).geocode,
  });

  assert.equal(
    store.branches.get(`${CARRIER}::ACRAI-B`)?.accuracy,
    "approximate",
  );
});

test("กรอบใหญ่แต่ไม่ใช่เขตปกครอง → เขียนลงตารางสาขาได้ ติดชั้น coarse ไว้", async () => {
  // เดิมเพดาน 12 กม. ปฏิเสธเคสนี้ทิ้ง ตอนนี้รับแล้วเพราะตัวที่กันบั๊ก
  // "หมุดกลางอำเภอ" คือด่าน types[] ไม่ใช่ขนาดกรอบ (ดูเทสต์ถัดไป)
  //
  // ⚠️ ความหยาบไม่ได้หายไป มันถูก **บันทึกไว้** เป็นชั้น coarse ซึ่ง UI เอาไป
  // ขึ้นป้าย "คลาดเคลื่อนได้หลายกิโลเมตร" ต่อ — เก็บค่าที่วัดได้ ไม่ใช่ซ่อนมัน
  const store = makeStore();

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: makeGeocoder(25_000).geocode,
  });

  assert.equal(saved, 1);
  assert.equal(store.branches.get(`${CARRIER}::ACRAI-B`)?.accuracy, "coarse");
});

test("Google บอกเองว่าเป็นเขตปกครอง → ปฏิเสธ ต่อให้กรอบจะเล็ก", async () => {
  const store = makeStore();

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: makeGeocoder(80, CHIANG_RAI, true).geocode,
  });

  assert.equal(saved, 0);
});

test("มีพิกัดอยู่แล้ว → ไม่ทับ และไม่เสีย quota ของ Google", async () => {
  const store = makeStore();
  store.branches.set(`${CARRIER}::ACRAI-B`, {
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    branchName: "สาขาที่แอดมินกรอกเอง",
    lat: 1,
    lng: 2,
    accuracy: "exact",
    note: null,
    updatedBy: "boss@example.com",
    updatedAt: null,
  });
  const geocoder = makeGeocoder();

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(saved, 0);
  assert.deepEqual(geocoder.calls, []);
  assert.equal(store.branches.get(`${CARRIER}::ACRAI-B`)?.lat, 1);
});

test("ที่อยู่เดิม → ใช้ผลที่เก็บไว้ ไม่ยิงถาม Google ซ้ำ", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: geocoder.geocode,
  });
  // สาขาเดียวกันของขนส่งอีกเจ้า — ที่อยู่เหมือนกันเป๊ะ
  await harvestBranchCoordinates(makeResult([branchEvent()], "kerry-express"), {
    store,
    geocode: geocoder.geocode,
  });

  assert.equal(geocoder.calls.length, 1);
  assert.equal(store.saved.length, 2, "แต่ต้องบันทึกให้ทั้งสองเจ้า");
});

test("แถวเก่าใน cache ที่ไม่รู้ความละเอียด → ไม่เอามาใช้ ไม่เดาว่าแม่น", async () => {
  const store = makeStore();
  store.geocodes.set(ADDRESS.toLowerCase(), {
    found: true,
    coordinates: CHIANG_RAI,
    precision: null,
    accuracyMeters: null,
    areaOnly: null,
  });

  const saved = await harvestBranchCoordinates(makeResult([branchEvent()]), {
    store,
    geocode: makeGeocoder().geocode,
  });

  assert.equal(saved, 0);
});

test("ผลลัพธ์ที่ไม่มีที่อยู่เลย → ไม่ทำอะไร ไม่แตะอะไรทั้งนั้น", async () => {
  const store = makeStore();
  const geocoder = makeGeocoder();

  const saved = await harvestBranchCoordinates(
    makeResult([branchEvent(null)]),
    { store, geocode: geocoder.geocode },
  );

  assert.equal(saved, 0);
  assert.deepEqual(geocoder.calls, []);
});

/* ----------------------- ด่านกันเผาโควตา ----------------------- */

function probeOptions(overrides: Record<string, unknown> = {}) {
  return {
    fetchResult: () => Promise.resolve(makeResult([branchEvent()])),
    canProbe: () => true,
    outOfQuota: () => false,
    geocode: makeGeocoder().geocode,
    ...overrides,
  };
}

test("ครบทุกด่าน → ยิงหนึ่งครั้งแล้วได้พิกัดมา", async () => {
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "SPXTH046012345678",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions(),
  });

  assert.equal(filled, true);
  assert.deepEqual(store.claims, [`${CARRIER}::ACRAI-B`]);
});

test("ด่าน 1 — เลขที่ ETrackings ตามไม่ได้ → ไม่ยิง และไม่จองสิทธิ์", async () => {
  resetProbeBudget();
  const store = makeStore();
  let fetched = 0;

  const filled = await probeBranchAddress({
    trackingNumber: "EY145587896TH",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions({
      canProbe: () => false,
      fetchResult: () => {
        fetched += 1;
        return Promise.resolve(makeResult([branchEvent()]));
      },
    }),
  });

  assert.equal(filled, false);
  assert.equal(fetched, 0);
  assert.deepEqual(store.claims, []);
});

test("ด่าน 2 — โควตาหมด → ไม่ยิง และไม่เผา cooldown ของสาขา", async () => {
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "SPXTH046012345678",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions({ outOfQuota: () => true }),
  });

  assert.equal(filled, false);
  assert.deepEqual(store.claims, []);
});

test("ด่าน 3 — งบต่อวันหมด → หยุดยิง", async (t) => {
  t.after(() => {
    delete process.env.BRANCH_PROBE_DAILY_LIMIT;
    resetProbeBudget();
  });

  resetProbeBudget();
  process.env.BRANCH_PROBE_DAILY_LIMIT = "2";

  const store = makeStore();
  const attempts: boolean[] = [];

  for (let index = 0; index < 4; index += 1) {
    const code = `BR-${index}`;
    attempts.push(
      await probeBranchAddress({
        trackingNumber: "SPXTH046012345678",
        carrierCode: CARRIER,
        branchCode: code,
        store,
        options: probeOptions({
          fetchResult: () =>
            Promise.resolve(
              makeResult([
                { ...branchEvent(), location: `${code} - สาขาที่ ${index}` },
              ]),
            ),
        }),
      }),
    );
  }

  assert.deepEqual(attempts, [true, true, false, false]);
  assert.equal(store.claims.length, 2, "ด่านงบต้องมาก่อนการจองสิทธิ์");
});

test("ด่าน 4 — จองสิทธิ์ไม่ได้ (เพิ่งถามไปแล้ว) → ไม่ยิง", async () => {
  resetProbeBudget();
  const store = makeStore();
  store.allowClaim = false;
  let fetched = 0;

  const filled = await probeBranchAddress({
    trackingNumber: "SPXTH046012345678",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions({
      fetchResult: () => {
        fetched += 1;
        return Promise.resolve(makeResult([branchEvent()]));
      },
    }),
  });

  assert.equal(filled, false);
  assert.equal(fetched, 0);
});

test("ยิงแล้วขนส่งพัง → ไม่โยน error ขึ้นไป แค่ตอบว่าเติมไม่ได้", async () => {
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "SPXTH046012345678",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions({
      fetchResult: () => Promise.reject(new Error("ETrackings ล่ม")),
    }),
  });

  assert.equal(filled, false);
});

test("ยิงแล้วไม่มีที่อยู่ติดมา → สาขานั้นถูกล็อกไว้ด้วย cooldown แล้ว", async () => {
  // ด่านจองสิทธิ์เขียน last_probe_at ไปแล้วตั้งแต่ก่อนยิง สาขาที่ขนส่งไม่เคย
  // ส่งที่อยู่มาให้จึงไม่ถูกถามซ้ำทุกครั้งที่มีคนผ่านจุดนั้น
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "SPXTH046012345678",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: probeOptions({
      fetchResult: () => Promise.resolve(makeResult([branchEvent(null)])),
    }),
  });

  assert.equal(filled, false);
  assert.deepEqual(store.claims, [`${CARRIER}::ACRAI-B`]);
});

/* ------------- courier ที่ยืนยันแล้วปลดล็อกเลขที่ prefix บอกไม่ได้ ------------- */

test("ด่าน 1 — เลข TH… ที่ไม่มี hint → ตกด่านแรก (ยิงไปก็ทิ้งโควตา)", async () => {
  // ไม่ override canProbe จึงได้ตัวจริงของ ETrackings มาตัดสิน
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "TH264511339099F",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    store,
    options: {
      fetchResult: () => Promise.resolve(makeResult([branchEvent()])),
      outOfQuota: () => false,
      geocode: makeGeocoder().geocode,
    },
  });

  assert.equal(filled, false);
  assert.deepEqual(store.claims, []);
});

test("ด่าน 1 — เลข TH… พร้อม courier ที่ยืนยันแล้ว → ผ่าน และยิงโดยระบุขนส่ง", async () => {
  // นี่คือเคสของเลข SPX ส่วนใหญ่ในไทย ถ้าด่านนี้ไม่ผ่าน การเติมพิกัดสาขา
  // จะไม่ทำงานเลยกับเลขกลุ่มนั้น
  resetProbeBudget();
  const store = makeStore();
  const hints: (string | undefined)[] = [];

  const filled = await probeBranchAddress({
    trackingNumber: "TH264511339099F",
    carrierCode: CARRIER,
    branchCode: "ACRAI-B",
    courierHint: "shopee-xpress-th",
    store,
    options: {
      fetchResult: (_no, hint) => {
        hints.push(hint);
        return Promise.resolve(makeResult([branchEvent()]));
      },
      outOfQuota: () => false,
      geocode: makeGeocoder().geocode,
    },
  });

  assert.equal(filled, true);
  assert.deepEqual(hints, ["shopee-xpress-th"]);
});

test("ด่าน 1 — hint เป็นเจ้าที่ ETrackings ไม่รองรับ → ยังตกด่านแรก", async () => {
  resetProbeBudget();
  const store = makeStore();

  const filled = await probeBranchAddress({
    trackingNumber: "EY145587896TH",
    carrierCode: "thailand-post",
    branchCode: "SOCN",
    courierHint: "thailand-post",
    store,
    options: {
      fetchResult: () => Promise.resolve(makeResult([branchEvent()])),
      outOfQuota: () => false,
      geocode: makeGeocoder().geocode,
    },
  });

  assert.equal(filled, false);
});
