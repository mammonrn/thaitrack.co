/**
 * เทสต์การจำแนกช่องทางที่มา
 *
 * ประเด็นที่ต้องไม่หลุด: **ห้ามมีทางไหนที่ทำให้ URL ต้นทางหลุดออกไป**
 * ฟังก์ชันนี้คืนได้แค่คำเดียวจากชุดปิด ซึ่งเป็นเหตุผลเดียวที่การเก็บสถิตินี้
 * ผ่านกติกาความเป็นส่วนตัวของทั้งระบบ
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REFERRER_CHANNELS,
  classifyChannel,
  type ReferrerChannel,
} from "./referrer-channel.ts";

const SELF = "xn--42c0bd0a3b8b.com";
const classify = (referrer: string, utm = "") =>
  classifyChannel(referrer, utm, SELF);

test("คืนได้เฉพาะคำในชุดปิดเท่านั้น", () => {
  const inputs = [
    "https://www.google.co.th/search?q=%E0%B9%80%E0%B8%8A%E0%B9%87%E0%B8%84",
    "https://m.facebook.com/story.php?id=12345",
    "https://example.com/some/private/path?token=secret",
    "",
    "ไม่ใช่ url",
  ];

  for (const input of inputs) {
    const channel = classify(input);
    assert.ok(
      channel === null || REFERRER_CHANNELS.includes(channel),
      `${input} → ${channel}`,
    );
  }
});

test("จำแนกจากโดเมนได้ถูกต้อง", () => {
  const cases: [string, ReferrerChannel][] = [
    ["https://www.google.co.th/search?q=abc", "google"],
    ["https://google.com/", "google"],
    ["https://m.facebook.com/x", "facebook"],
    ["https://www.tiktok.com/@someone", "tiktok"],
    ["https://line.me/R/ti/p/abc", "line"],
    ["https://www.instagram.com/p/abc", "instagram"],
    ["https://pantip.com/topic/123", "other"],
  ];

  for (const [referrer, expected] of cases) {
    assert.equal(classify(referrer), expected, referrer);
  }
});

test("โดเมนที่แค่มีชื่อคล้ายกัน ต้องไม่ถูกนับเป็นเจ้านั้น", () => {
  // เทียบแบบ "ลงท้ายด้วยโดเมนนี้" ไม่ใช่ "มีคำนี้อยู่ที่ไหนก็ได้"
  assert.equal(classify("https://not-google.com/"), "other");
  assert.equal(classify("https://google.com.evil.example/"), "other");
  assert.equal(classify("https://myfacebook.com/"), "other");
});

test("ไม่มี referrer → มาตรงๆ", () => {
  assert.equal(classify(""), "direct");
  assert.equal(classify("   "), "direct");
});

test("referrer ที่แปลงเป็น URL ไม่ได้ → other ไม่ใช่ direct", () => {
  // "อ่านไม่ออกว่ามาจากไหน" กับ "มาตรงๆ" เป็นคนละเรื่อง การเหมารวมจะทำให้
  // ตัวเลข direct พองขึ้นโดยไม่มีใครรู้ว่าพองเพราะอะไร
  assert.equal(classify("ไม่ใช่ url"), "other");
});

test("เดินภายในเว็บเราเอง → null ไม่ต้องนับ", () => {
  assert.equal(classify(`https://${SELF}/history`), null);
  assert.equal(classify(`https://www.${SELF}/`), null);
});

test("utm_source ชนะ referrer เสมอ", () => {
  // utm เป็นสิ่งที่เราตั้งเองตอนทำแคมเปญ จึงตรงกว่า referrer ที่บางแอปไม่ส่งมา
  assert.equal(classify("https://pantip.com/", "facebook"), "facebook");
  assert.equal(classify("", "tiktok"), "tiktok");
});

test("utm_source ที่ไม่รู้จัก → other ไม่ใช่ direct", () => {
  assert.equal(classify("", "newsletter"), "other");
});
