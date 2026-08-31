/**
 * เทสต์การตัดสินสิทธิ์แอดมิน
 *
 * ทางที่ต้อง "ปฏิเสธ" คือทางที่ทดสอบด้วยมือแล้วมองไม่เห็นว่าพลาด — ระบบที่
 * ปล่อยคนที่ไม่ใช่แอดมินผ่านจะดูทำงานปกติทุกประการเวลาแอดมินตัวจริงเป็นคนลอง
 * เทสต์ชุดนี้จึงเน้นทางปฏิเสธมากกว่าทางอนุญาต
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizeAdmin, parseAdminEmails } from "./admin.ts";

const ADMINS = ["boss@example.com", "ops@example.com"];

/* ------------------------ อ่านรายชื่อจาก env ------------------------ */

test("คั่นด้วยคอมมา ช่องว่าง หรือขึ้นบรรทัดใหม่ ก็อ่านได้เหมือนกัน", () => {
  assert.deepEqual(parseAdminEmails("a@x.com,b@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(parseAdminEmails("a@x.com b@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(parseAdminEmails("a@x.com\nb@x.com"), ["a@x.com", "b@x.com"]);
  assert.deepEqual(parseAdminEmails(" a@x.com , b@x.com "), [
    "a@x.com",
    "b@x.com",
  ]);
});

test("ตัดเครื่องหมายคำพูดที่ติดมาจากการคัดลอกออกให้", () => {
  assert.deepEqual(parseAdminEmails('"a@x.com"'), ["a@x.com"]);
  assert.deepEqual(parseAdminEmails("'a@x.com','b@x.com'"), [
    "a@x.com",
    "b@x.com",
  ]);
});

test("เก็บเป็นตัวพิมพ์เล็กเสมอ", () => {
  assert.deepEqual(parseAdminEmails("Boss@Example.COM"), ["boss@example.com"]);
});

test("ค่าที่ไม่ใช่อีเมลถูกตัดทิ้ง ไม่ถูกนับเป็นแอดมิน", () => {
  assert.deepEqual(parseAdminEmails("ไม่ใช่อีเมล, a@x.com, @x.com, b@"), [
    "a@x.com",
  ]);
});

test("ไม่ได้ตั้งค่าไว้เลย → รายชื่อว่าง", () => {
  assert.deepEqual(parseAdminEmails(undefined), []);
  assert.deepEqual(parseAdminEmails(""), []);
  assert.deepEqual(parseAdminEmails("   "), []);
});

/* -------------------------- ทางที่ปฏิเสธ -------------------------- */

test("ยังไม่ได้เข้าสู่ระบบ → ปฏิเสธ", () => {
  assert.deepEqual(authorizeAdmin(null, ADMINS), {
    ok: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(authorizeAdmin(undefined, ADMINS), {
    ok: false,
    reason: "unauthenticated",
  });
});

test("เข้าสู่ระบบแล้วแต่ไม่มีอีเมล → ปฏิเสธ", () => {
  assert.deepEqual(authorizeAdmin({}, ADMINS), {
    ok: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(authorizeAdmin({ email: null }, ADMINS), {
    ok: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(authorizeAdmin({ email: "   " }, ADMINS), {
    ok: false,
    reason: "unauthenticated",
  });
});

test("เข้าสู่ระบบแล้วแต่ไม่ใช่แอดมิน → ปฏิเสธ", () => {
  assert.deepEqual(authorizeAdmin({ email: "someone@example.com" }, ADMINS), {
    ok: false,
    reason: "not_admin",
  });
});

test("ยังไม่ได้ตั้ง ADMIN_EMAILS → ปฏิเสธทุกคน ไม่ใช่ปล่อยผ่านทุกคน", () => {
  // นี่คือความผิดพลาดที่อันตรายที่สุดของระบบสิทธิ์: ตั้งค่าไม่ครบแล้วเปิดหมด
  for (const user of [
    null,
    { email: "boss@example.com" },
    { email: "attacker@example.com" },
  ]) {
    assert.deepEqual(authorizeAdmin(user, []), {
      ok: false,
      reason: "not_configured",
    });
  }
});

test("อีเมลที่คล้ายแต่ไม่ตรง ต้องไม่ผ่าน", () => {
  const lookalikes = [
    "boss@example.com.attacker.com",
    "attacker.boss@example.com",
    "boss@example.co",
    "boss+admin@example.com",
    " boss@example.com.evil",
  ];

  for (const email of lookalikes) {
    const result = authorizeAdmin({ email }, ADMINS);
    assert.equal(result.ok, false, `"${email}" ต้องไม่ผ่าน`);
  }
});

/* -------------------------- ทางที่อนุญาต -------------------------- */

test("อีเมลตรงกับรายชื่อ → ผ่าน", () => {
  assert.deepEqual(authorizeAdmin({ email: "boss@example.com" }, ADMINS), {
    ok: true,
    email: "boss@example.com",
  });
});

test("ตัวพิมพ์ใหญ่เล็กและช่องว่างหัวท้ายไม่ทำให้แอดมินตัวจริงเข้าไม่ได้", () => {
  assert.deepEqual(authorizeAdmin({ email: "  BOSS@Example.com " }, ADMINS), {
    ok: true,
    email: "boss@example.com",
  });
});

test("อีเมลที่คืนกลับมาเป็นตัวพิมพ์เล็กเสมอ — ใช้บันทึกว่าใครแก้", () => {
  const result = authorizeAdmin({ email: "OPS@EXAMPLE.COM" }, ADMINS);
  assert.ok(result.ok);
  assert.equal(result.email, "ops@example.com");
});
