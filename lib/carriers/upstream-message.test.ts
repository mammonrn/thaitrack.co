/**
 * เทสต์การกรองข้อความจากปลายทางก่อนเขียนลง log
 *
 * ⚠️ ข้อความจากปลายทางคือข้อมูลที่เราไม่ได้ควบคุม — ปลายทางเปลี่ยนรูปแบบ
 * เมื่อไรก็ได้ และอาจใส่อะไรมาก็ได้ · ด่านนี้คือจุดเดียวที่กันไม่ให้ความลับ
 * หรือข้อความยาวไม่จำกัดหลุดลง log
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAX_MESSAGE_LENGTH,
  safeUpstreamMessage,
} from "./upstream-message.ts";

test("ข้อความปกติผ่านได้ครบ", () => {
  assert.equal(
    safeUpstreamMessage("Request rate limit exceeded"),
    "Request rate limit exceeded",
  );
});

test("ว่างเปล่า / undefined → ไม่เก็บอะไร", () => {
  for (const empty of ["", "   ", "\n\t", null, undefined]) {
    assert.equal(safeUpstreamMessage(empty), undefined);
  }
});

test("ยุบช่องว่างซ้อนให้เหลือเดียว — log ต้องอยู่บรรทัดเดียว", () => {
  assert.equal(
    safeUpstreamMessage("rate  limit\nexceeded\tnow"),
    "rate limit exceeded now",
  );
});

test("🔴 ท่อนที่มีคำบ่งชี้ความลับถูกตัดทิ้งทั้งท่อน", () => {
  for (const secret of [
    "code=A0706, apiKey=abc123def",
    "invalid; token=zzz",
    "denied | Authorization: Bearer xyz",
    "bad password=hunter2",
    "signature mismatch",
  ]) {
    const out = safeUpstreamMessage(secret) ?? "";
    assert.doesNotMatch(
      out,
      /abc123def|zzz|xyz|hunter2/,
      `ความลับหลุดจาก ${JSON.stringify(secret)} → ${out}`,
    );
  }
});

test("🔴 ค่ายาวๆ ที่ดูเป็นคีย์หรือ id ภายในถูกแทนด้วย …", () => {
  const out = safeUpstreamMessage(
    "failed for a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  );
  assert.equal(out, "failed for …");
});

test("ตัดความยาวที่เพดาน", () => {
  // ใช้ประโยคยาว ไม่ใช่ตัวอักษรซ้ำ 500 ตัว — ตัวหลังจะถูกด่าน "ค่ายาวๆ ที่ดู
  // เป็นคีย์" จับไปก่อน ซึ่งก็ถูกต้องแล้ว แต่ไม่ได้ทดสอบการตัดความยาว
  const long = Array.from({ length: 60 }, (_, i) => `word${i % 10}`).join(" ");
  assert.ok(long.length > MAX_MESSAGE_LENGTH);

  const out = safeUpstreamMessage(long) ?? "";
  assert.equal(out.length, MAX_MESSAGE_LENGTH + 1, "ตัดแล้วต่อท้ายด้วย …");
  assert.ok(out.endsWith("…"));
});

test("ค่ายาวเกินไปทั้งก้อน → ถือว่าน่าสงสัย ไม่เก็บเลย", () => {
  // ข้อความจริงไม่มีทางเป็นตัวอักษรติดกัน 500 ตัวโดยไม่มีช่องว่าง
  assert.equal(safeUpstreamMessage("x".repeat(500)), undefined);
});

test("กรองจนไม่เหลืออะไร → ไม่เก็บ", () => {
  assert.equal(safeUpstreamMessage("token=aaa"), undefined);
});

/* ------------------------------------------------------------------ *
 * ที่ที่มันถูกใช้
 * ------------------------------------------------------------------ */

test("🔴 ข้อความต้องไม่มีทางเข้าฐานข้อมูล", () => {
  const events = readFileSync("lib/supabase/search-events.ts", "utf8");

  // search_events มีข้อบังคับว่าห้ามมีเลขพัสดุ และข้อความจากปลายทางอาจมี
  assert.doesNotMatch(events, /upstreamMessage|safeUpstreamMessage/);

  const route = readFileSync("app/api/track/route.ts", "utf8");
  assert.doesNotMatch(route, /upstreamMessage/);
});

test("gateway ต้องกรองก่อนเขียนเสมอ ห้ามเขียนดิบ", () => {
  const gateway = readFileSync("lib/carriers/track123-gateway.ts", "utf8");

  assert.match(gateway, /safeUpstreamMessage\(carrierError\?\.upstreamMessage\)/);
  // ห้ามมีทางที่เขียน upstreamMessage ลง log โดยไม่ผ่านตัวกรอง
  const raw = gateway.match(/\.upstreamMessage/g) ?? [];
  assert.equal(
    raw.length,
    1,
    "มีการอ้าง upstreamMessage มากกว่าหนึ่งที่ — ตรวจว่าทุกที่ผ่านตัวกรองแล้ว",
  );
});

test("เขียนเฉพาะตอนผลไม่ใช่ ok / not_found", () => {
  const gateway = readFileSync("lib/carriers/track123-gateway.ts", "utf8");

  // ขาสำเร็จเรียก write("ok") โดยไม่ส่ง msg
  assert.match(gateway, /write\("ok"\);/);
  // ขาที่ล้มเท่านั้นที่ส่ง msg — และ not_found ก็ไหลมาทางนี้ ซึ่งยอมรับได้
  // เพราะ debugMessage ของ not_found เป็นข้อความที่เราเขียนเอง ไม่ใช่ของปลายทาง
  // (toCarrierError ไม่ได้ถูกเรียกในเส้นทางนั้น จึงไม่มี upstreamMessage)
  assert.match(gateway, /safeUpstreamMessage\(/);
});

test("log ต้องบอกด้วยว่ารหัสขนส่งมาจากไหน", () => {
  const gateway = readFileSync("lib/carriers/track123-gateway.ts", "utf8");
  assert.match(gateway, /src=\$\{fields\.source\}/);

  const resolve = readFileSync("lib/carriers/resolve.ts", "utf8");
  for (const source of ["cache", "prefix", "guess"]) {
    assert.ok(
      resolve.includes(`"${source}"`),
      `resolve.ts ต้องส่ง source "${source}" — ไม่งั้น log แยกบริบทไม่ออก`,
    );
  }
});
