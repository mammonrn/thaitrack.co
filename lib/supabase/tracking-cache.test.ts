/**
 * เทสต์ที่เฝ้า "ทางเข้าถึงตาราง tracking_cache" ไม่ใช่ตรรกะของ cache
 *
 * ตารางนี้ถูกอ่าน/เขียนด้วย service role key ซึ่งข้าม Row Level Security ได้
 * ทุกตาราง ถ้าวันหนึ่งมีใครเผลอ import ไฟล์ที่ถือ key นี้เข้า client component
 * หรือเผลอเพิ่ม policy ให้ตาราง key จะหลุดออกไปฝั่งเบราว์เซอร์ทันที และไม่มี
 * เทสต์ตรรกะตัวไหนจับได้เลยเพราะโค้ดยัง "ทำงานถูก" อยู่
 *
 * เทสต์ชุดนี้จึงอ่านซอร์สกับไฟล์ migration ตรงๆ แล้วยืนยันข้อตกลงเชิงโครงสร้าง
 * แทนการรันโค้ด — เป็นด่านเดียวที่จับความผิดพลาดแบบนี้ได้ก่อนขึ้น production
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const PROJECT_DIR = resolve(import.meta.dirname, "../..");
const MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0003_tracking_cache.sql",
);

/** ไฟล์ซอร์สทั้งหมดใน app/ กับ lib/ ยกเว้นไฟล์เทสต์เอง */
function sourceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts")) continue;
      found.push(path);
    }
  };

  walk(join(PROJECT_DIR, "app"));
  walk(join(PROJECT_DIR, "lib"));
  return found;
}

const files = sourceFiles().map((path) => ({
  path: relative(PROJECT_DIR, path),
  source: readFileSync(path, "utf8"),
}));

/* -------------------- สิทธิ์ในไฟล์ migration -------------------- */

test("migration ต้องเปิด RLS ให้ตาราง tracking_cache", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  assert.match(
    sql,
    /alter table public\.tracking_cache enable row level security/,
    "ไม่เปิด RLS แปลว่าถ้ามีใคร grant สิทธิ์ให้ทีหลัง ตารางจะเปิดออกทันที",
  );
});

test("migration ต้อง revoke สิทธิ์จาก anon และ authenticated", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  for (const role of ["anon", "authenticated"]) {
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.tracking_cache from ${role}`),
      `ยังไม่ได้ revoke สิทธิ์ของ ${role}`,
    );
  }
});

test("migration ต้องไม่สร้าง policy ให้ tracking_cache เลยแม้แต่อันเดียว", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  // เปิด RLS แล้วไม่มี policy = Postgres ปฏิเสธทุกแถวเป็นค่าเริ่มต้น
  // ส่วน service role ข้าม RLS ได้อยู่แล้ว การเพิ่ม policy จึงมีแต่จะเปิดประตู
  const created = sql
    .split("\n")
    .filter((line) => /^\s*create policy/i.test(line));

  assert.deepEqual(
    created,
    [],
    `เจอ create policy ในไฟล์ migration: ${created.join(" / ")}`,
  );
});

/* ------------- ทางเข้าถึงตารางในซอร์สของแอป ------------- */

test("โค้ดที่อ้างชื่อตาราง tracking_cache เป็นค่าจริง ต้องมีไฟล์เดียว", () => {
  // มองหาชื่อตารางที่อยู่ในเครื่องหมายคำพูด ซึ่งแปลว่าเป็นค่าที่โค้ดใช้จริง
  // ไม่ใช่แค่ถูกเอ่ยถึงในคอมเมนต์ (ไฟล์อื่นอ้างถึงในคอมเมนต์ได้ตามปกติ)
  const users = files
    .filter((file) => /["'`]tracking_cache["'`]/.test(file.source))
    .map((file) => file.path)
    .sort();

  assert.deepEqual(
    users,
    ["lib/supabase/tracking-cache.ts"],
    "ทางเข้าถึงตารางต้องมีทางเดียว ถ้ามีไฟล์อื่นแตะแปลว่ามีประตูบานที่สอง",
  );
});

test("การเรียก .from() ด้วยชื่อตารางนี้ต้องเกิดขึ้นในไฟล์เดียว", () => {
  const callers = files
    .filter((file) => /\.from\(\s*["'`]tracking_cache/.test(file.source))
    .map((file) => file.path);

  // ไฟล์ทางเข้าใช้ค่าคงที่ TABLE จึงไม่เข้าเงื่อนไขนี้ — ที่นี่ดักคนที่เขียน
  // ชื่อตารางตรงๆ ลงไปในไฟล์อื่นเพื่อลัดผ่านทางเข้าที่ตั้งใจไว้
  assert.deepEqual(callers, []);
});

test("client ที่ใช้ anon key ต้องไม่เคยแตะตาราง cache", () => {
  const gateway = files.find(
    (file) => file.path === "lib/supabase/tracking-cache.ts",
  );
  assert.ok(gateway !== undefined);

  // ไฟล์เดียวที่แตะตารางต้องหยิบ client มาจาก ./service (service role) เท่านั้น
  assert.match(gateway.source, /from "\.\/service"/);
  assert.doesNotMatch(
    gateway.source,
    /from "\.\/(client|server)"/,
    "client/server ถือ anon key กับ session ของผู้ใช้ ใช้กับตารางนี้ไม่ได้",
  );
});

test("ไฟล์ที่ถือ service role key ต้องไม่ถูก import จาก client component", () => {
  const serverOnly = ["supabase/service", "supabase/tracking-cache"];

  const offenders = files
    .filter((file) => /^\s*["']use client["']/.test(file.source))
    .filter((file) =>
      serverOnly.some((moduleName) => file.source.includes(moduleName)),
    )
    .map((file) => file.path);

  assert.deepEqual(
    offenders,
    [],
    `client component เหล่านี้ import โมดูลฝั่งเซิร์ฟเวอร์: ${offenders.join(", ")}`,
  );
});

test("service role key ต้องไม่ถูกตั้งชื่อให้ขึ้นต้นด้วย NEXT_PUBLIC_ ที่ไหนเลย", () => {
  // ชื่อที่ขึ้นต้นแบบนี้ถูก Next ฝังลงไฟล์ JS ที่ส่งให้เบราว์เซอร์ตอน build
  const offenders = files
    .filter((file) => /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(file.source))
    .map((file) => file.path);

  assert.deepEqual(offenders, []);
});

test("เส้นทางเข้าถึงต้องอ่าน env ชื่อ SUPABASE_SERVICE_ROLE_KEY ตัวเดียว", () => {
  const readers = files
    .filter((file) => file.source.includes("process.env.SUPABASE_SERVICE_ROLE_KEY"))
    .map((file) => file.path);

  assert.deepEqual(
    readers,
    ["lib/supabase/env.ts"],
    "อ่าน key จากที่เดียวเสมอ จะได้มีจุดเดียวที่ต้องตรวจว่าปลอดภัย",
  );
});
