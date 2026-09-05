/**
 * เทสต์ตัวดักจับ beforeinstallprompt
 *
 * รันด้วย `npm test`
 *
 * ⚠️ สิ่งที่เทสต์ชุดนี้เฝ้าไว้คือความพังแบบ "เงียบสนิท" — ถ้าไฟล์ static
 * ไม่ตรงกับชื่อที่ hook อ่าน หรือ layout เลิกโหลดไฟล์นั้น การ์ดชวนติดตั้งจะ
 * กลับไปพลาด event ของ Chrome เหมือนเดิม โดยไม่มี error ไม่มีเทสต์อื่นแดง
 * และไม่มีตัวเลขไหนบอกได้ว่าเสียโอกาสไปกี่ครั้ง
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  CAPTURED_PROMPT_KEY,
  CAPTURE_SCRIPT,
  PROMPT_CAPTURED_EVENT,
} from "./install-prompt-capture.ts";

const PUBLIC_FILE = "public/install-prompt-capture.js";
const publicSource = readFileSync(PUBLIC_FILE, "utf8");

test("ไฟล์ static ต้องมีเนื้อตรงกับ CAPTURE_SCRIPT เป๊ะ", () => {
  // ไฟล์จริงมีหัวคอมเมนต์บอกที่มา ส่วนที่เหลือต้องเหมือนกันทุกตัวอักษร
  const body = publicSource.slice(publicSource.indexOf("(function()")).trim();

  assert.equal(
    body,
    CAPTURE_SCRIPT.trim(),
    "public/install-prompt-capture.js ไม่ตรงกับนิยามใน lib/install-prompt-capture.ts" +
      " — สองที่นี้ต้องเป็นของเดียวกันเสมอ ไม่งั้น hook จะอ่าน key ที่ไม่มีใครเขียน",
  );
});

test("สคริปต์ต้องเขียน key กับยิง event ที่ hook รออยู่จริง", () => {
  assert.match(publicSource, new RegExp(`w\\.${CAPTURED_PROMPT_KEY}\\s*=\\s*e;`));
  assert.ok(publicSource.includes(`new Event("${PROMPT_CAPTURED_EVENT}")`));
});

test("สคริปต์ต้องเรียก preventDefault และล้างค่าเมื่อติดตั้งเสร็จ", () => {
  assert.ok(
    publicSource.includes("e.preventDefault()"),
    "ไม่กัน Chrome ขึ้นแถบเชิญของตัวเอง จะกลายเป็นชวนซ้อนชวน",
  );
  assert.match(
    publicSource,
    /appinstalled[\s\S]*__thaitrackInstallPrompt\s*=\s*null/,
    "ติดตั้งไปแล้วต้องทิ้ง event ทิ้ง ไม่งั้นจะยังชวนคนที่ติดตั้งไปแล้ว",
  );
});

test("ทั้งก้อนต้องอยู่ใน try/catch — พังตรงนี้ห้ามทำให้ทั้งหน้าพัง", () => {
  // สคริปต์นี้ทำงานก่อน bundle ทุกตัว ถ้ามันโยน error ขึ้นมา หน้าเว็บจะพัง
  // ตั้งแต่ยังไม่เริ่ม เพราะเรื่องปุ่มชวนติดตั้งซึ่งเป็นของรอง
  assert.match(publicSource, /\(function\(\)\{try\{/);
  assert.match(publicSource, /\}catch\(err\)\{\}\}\)\(\);/);
});

test("สคริปต์ต้องไม่มีไวยากรณ์ใหม่ที่เบราว์เซอร์เก่ารันไม่ได้", () => {
  // ไม่ผ่าน bundler ไม่ผ่าน transpiler — ต้องรันได้ทุกที่ที่เปิดเว็บนี้ได้
  assert.doesNotMatch(publicSource, /=>|\blet\b|\bconst\b|\?\.|\?\?/);
});

test("layout ต้องโหลดสคริปต์นี้แบบ beforeInteractive", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");

  assert.match(
    layout,
    /src="\/install-prompt-capture\.js"/,
    "layout ไม่ได้โหลดไฟล์ดักจับ — การ์ดจะกลับไปพลาด event ของ Chrome",
  );
  assert.match(
    layout,
    /strategy="beforeInteractive"/,
    'ต้องเป็น beforeInteractive เท่านั้น · afterInteractive ทำงานหลัง hydrate' +
      " ซึ่งช้าเกินไปและเป็นบั๊กเดิมที่เพิ่งแก้ไป",
  );
});

test("hook ต้องหยิบของที่ดักไว้ ไม่ใช่รอ event อย่างเดียว", () => {
  const hook = readFileSync("lib/use-install-state.ts", "utf8");

  assert.ok(
    hook.includes("CAPTURED_PROMPT_KEY"),
    "hook ไม่ได้อ่านค่าที่สคริปต์ดักไว้ — event ที่ยิงไปก่อน hydrate จะหายเหมือนเดิม",
  );
  assert.ok(
    hook.includes("PROMPT_CAPTURED_EVENT"),
    "hook ไม่ได้ฟัง event ที่สคริปต์ยิงบอก",
  );
});
