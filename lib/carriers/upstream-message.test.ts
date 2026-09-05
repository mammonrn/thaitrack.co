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

import { formatCallLog } from "./track123-gateway.ts";
import {
  MAX_MESSAGE_LENGTH,
  safeUpstreamMessage,
} from "./upstream-message.ts";

// ⚠️ ข้อความในเทสต์ทั้งไฟล์นี้เป็นตัวอย่างสมมติ ไม่ใช่ข้อความจริงจาก Track123
// เรายังไม่เคยเห็นข้อความจริงเลยสักครั้ง — นั่นคือเหตุผลทั้งหมดที่มีโค้ดนี้
// อย่าเขียนตัวอย่างที่ดูเหมือนคำตอบของคำถามที่เรากำลังจะไปหา
test("ข้อความปกติผ่านได้ครบ", () => {
  assert.equal(
    safeUpstreamMessage("upstream said something"),
    "upstream said something",
  );
});

test("ว่างเปล่า / undefined → ไม่เก็บอะไร", () => {
  for (const empty of ["", "   ", "\n\t", null, undefined]) {
    assert.equal(safeUpstreamMessage(empty), undefined);
  }
});

test("ยุบช่องว่างซ้อนให้เหลือเดียว — log ต้องอยู่บรรทัดเดียว", () => {
  assert.equal(
    safeUpstreamMessage("aaa  bbb\nccc\tddd"),
    "aaa bbb ccc ddd",
  );
});

test("🔴 อักขระที่ทำให้บรรทัดแตก ถูกแทนด้วยช่องว่างทุกตัว", () => {
  for (const breaker of [
    "\n",
    "\r\n",
    "\r",
    "\t",
    "\u000B",
    "\u000C",
    "\u0085",
    "\u2028",
    "\u2029",
    "\u001B[31m", // ลำดับสีของ terminal — ห้ามให้ปลายทางสั่งจอเรา
  ]) {
    const cleaned = safeUpstreamMessage(`before${breaker}after`);
    assert.ok(
      cleaned !== undefined && !/[\r\n\u2028\u2029]/.test(cleaned),
      `ยังมีตัวขึ้นบรรทัดใหม่หลงเหลือจาก ${JSON.stringify(breaker)}`,
    );
    assert.ok(
      cleaned !== undefined && !/[\u0000-\u001F\u007F-\u009F]/.test(cleaned),
      `ยังมีอักขระควบคุมหลงเหลือจาก ${JSON.stringify(breaker)}`,
    );
    assert.ok(
      cleaned !== undefined && cleaned.startsWith("before"),
      "เนื้อความก่อนหน้าต้องไม่หาย",
    );
  }
});

test('🔴 เครื่องหมายคำพูดถูกเปลี่ยน — ไม่งั้นมันปิดฟิลด์ msg="…" กลางคัน', () => {
  assert.equal(
    safeUpstreamMessage('courier "spx" not supported'),
    "courier 'spx' not supported",
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

test("🔴 บรรทัด log ที่ออกมาจริงต้องเป็นบรรทัดเดียวเสมอ", () => {
  // เทสต์ตัวอื่นตรวจตัวกรอง เทสต์ตัวนี้ตรวจของจริง: ข้อความร้ายๆ วิ่งผ่าน
  // ตัวกรองเข้าไปในตัวประกอบบรรทัด แล้วนับบรรทัดที่ได้
  //
  // ⚠️ ทำไมต้องตรวจถึงชั้นนี้: grep และการนับทุกอย่างที่เราใช้วิเคราะห์มาตลอด
  // ตั้งอยู่บนสมมติฐาน "หนึ่งการเรียก = หนึ่งบรรทัด" ถ้าสมมติฐานนี้พัง ตัวเลข
  // จะเพี้ยนแบบเงียบๆ ไม่มี error ให้เห็น และไม่มีใครสังเกต
  const nasty =
    'line one\nline two\r\nline three\u2028line four " quote \u001B[31mred';

  const line = formatCallLog({
    ts: 1_757_030_400_000,
    trackNo: "SPXTH046012345678",
    courier: "shopee-xpress-th",
    attempt: 1,
    maxAttempts: 4,
    queued: 1,
    waitMs: 0,
    tookMs: 120,
    result: "rate_limited",
    source: "guess",
    upstream: "A0706",
    msg: safeUpstreamMessage(nasty),
  });

  assert.equal(line.split(/\r?\n|[\u2028\u2029]/).length, 1, line);
  assert.ok(line.startsWith("[track123] "), line);

  // ฟิลด์ msg ต้องปิดท้ายบรรทัดพอดี — เครื่องหมายคำพูดข้างในต้องไม่ปิดก่อน
  const msgAt = line.indexOf('msg="');
  assert.ok(msgAt > 0, line);
  assert.equal(line.slice(-1), '"', line);
  assert.equal(line.slice(msgAt + 5, -1).includes('"'), false, line);
});
