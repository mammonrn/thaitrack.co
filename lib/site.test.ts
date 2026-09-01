/**
 * เทสต์การสร้าง URL สัมบูรณ์
 *
 * จุดที่พลาดแล้วเสียหายเงียบๆ: slug ของเราเป็นภาษาไทย ถ้าไม่ encode ไฟล์
 * sitemap.xml จะไม่ผ่านการตรวจของ Google ทั้งไฟล์ ซึ่งแปลว่าไม่มีหน้าไหนถูก
 * ส่งเข้าไปเลย ไม่ใช่แค่หน้าที่มีภาษาไทย
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { absoluteUrl, siteUrl } from "./site.ts";

test("ต่อ path เข้ากับที่อยู่เว็บ", () => {
  assert.equal(absoluteUrl("/"), `${siteUrl()}/`);
  assert.equal(absoluteUrl("about"), `${siteUrl()}/about`);
});

test("encode ส่วนที่เป็นภาษาไทย", () => {
  const url = absoluteUrl("/เช็คพัสดุ-flash");

  assert.ok(url.startsWith(siteUrl()));
  assert.doesNotMatch(url, /[^\x20-\x7E]/, "ต้องเป็น ASCII ล้วน");
  assert.ok(url.endsWith("-flash"), `ได้ ${url}`);
});

test("ไม่ encode เครื่องหมาย / ที่คั่น path", () => {
  const url = absoluteUrl("/รหัสไปรษณีย์/เชียงราย/เมืองเชียงราย");

  assert.equal(url.split("/").length - 1, 5, "ต้องเหลือ / ครบทุกชั้น");
  assert.doesNotMatch(url, /%2F/i);
});

test("ที่อยู่เว็บต้องไม่ลงท้ายด้วย /", (t) => {
  t.after(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://example.com///";
  assert.equal(siteUrl(), "https://example.com");
  assert.equal(absoluteUrl("/a"), "https://example.com/a");
});

test("ไม่ได้ตั้ง env → ใช้โดเมนเริ่มต้นที่เป็น ASCII แล้ว", (t) => {
  t.after(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  process.env.NEXT_PUBLIC_SITE_URL = "";
  // โดเมนภาษาไทยต้องอยู่ในรูป punycode เสมอ เพราะ URL ที่ส่งให้ Google
  // ต้องเป็น ASCII
  assert.doesNotMatch(siteUrl(), /[^\x20-\x7E]/);
});
