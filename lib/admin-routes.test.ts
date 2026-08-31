/**
 * เทสต์เชิงโครงสร้างของทุกจุดที่เป็น "แอดมิน"
 *
 * เทสต์ใน admin.test.ts พิสูจน์ว่าตรรกะการตัดสินสิทธิ์ถูกต้อง แต่ตรรกะที่ถูก
 * แล้วไม่มีใครเรียกก็ไม่ได้ป้องกันอะไร ไฟล์นี้อ่านซอร์สจริงแล้วยืนยันว่า
 * **ทุกจุดของแอดมินเรียกด่านตรวจสิทธิ์จริง** ก่อนแตะข้อมูล
 *
 * เป็นด่านที่จับกรณีที่อันตรายที่สุดได้: มีคนเพิ่ม API route ใหม่ใต้
 * /api/admin/ แล้วลืมใส่ requireAdmin() — โค้ดจะ "ทำงานได้ปกติ" ทุกประการ
 * ไม่มีเทสต์ตรรกะตัวไหนจับได้ และตัวแอดมินเองทดสอบแล้วก็ผ่าน เพราะเขาเป็นแอดมิน
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const PROJECT_DIR = resolve(import.meta.dirname, "..");
const MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0004_carrier_branches.sql",
);

interface SourceFile {
  path: string;
  source: string;
}

function collect(dir: string): SourceFile[] {
  const found: SourceFile[] = [];

  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts")) continue;
      found.push({
        path: relative(PROJECT_DIR, path),
        source: readFileSync(path, "utf8"),
      });
    }
  };

  walk(dir);
  return found;
}

const appFiles = collect(join(PROJECT_DIR, "app"));
const allFiles = [...appFiles, ...collect(join(PROJECT_DIR, "lib"))];

/** ไฟล์ทุกไฟล์ที่อยู่ใต้เส้นทางแอดมิน ไม่ว่าจะเป็นหน้าเว็บหรือ API */
const adminFiles = appFiles.filter((file) => file.path.includes("/admin"));

/* -------------------- ทุกจุดของแอดมินต้องมีด่าน -------------------- */

test("มีไฟล์ใต้เส้นทางแอดมินให้ตรวจจริง (กันเทสต์ผ่านเพราะหาไฟล์ไม่เจอ)", () => {
  assert.ok(
    adminFiles.length >= 2,
    `เจอแค่ ${adminFiles.length} ไฟล์ — ควรมีอย่างน้อยหน้าเว็บกับ API route`,
  );
});

test("ทุก API route ใต้ /api/admin ต้องเรียก requireAdmin()", () => {
  const routes = adminFiles.filter((file) => file.path.includes("api/admin"));
  assert.ok(routes.length >= 1);

  const missing = routes
    .filter((file) => !file.source.includes("requireAdmin("))
    .map((file) => file.path);

  assert.deepEqual(
    missing,
    [],
    `route เหล่านี้ไม่ได้ตรวจสิทธิ์: ${missing.join(", ")}`,
  );
});

test("ทุกหน้าเว็บใต้ /admin ต้องเรียก requireAdmin()", () => {
  const pages = adminFiles.filter((file) => /\/admin\/.*page\.tsx$/.test(file.path));
  assert.ok(pages.length >= 1);

  const missing = pages
    .filter((file) => !file.source.includes("requireAdmin("))
    .map((file) => file.path);

  assert.deepEqual(missing, []);
});

test("ด่านตรวจสิทธิ์ต้องถูกเรียกก่อนอ่าน body ของ request", () => {
  // ถ้าอ่าน body ก่อน คนที่ไม่มีสิทธิ์จะทำให้เซิร์ฟเวอร์ทำงานแทนเขาได้บ้างแล้ว
  // และง่ายต่อการเผลอเขียนโค้ดที่แตะข้อมูลก่อนถึงบรรทัดตรวจสิทธิ์
  for (const file of adminFiles.filter((f) => f.path.includes("api/admin"))) {
    const guardAt = file.source.indexOf("requireAdmin(");
    const bodyAt = file.source.indexOf("request.json(");

    if (bodyAt === -1) continue;
    assert.ok(
      guardAt !== -1 && guardAt < bodyAt,
      `${file.path}: ต้องตรวจสิทธิ์ก่อนอ่าน body`,
    );
  }
});

test("โค้ดแอดมินต้องไม่ตัดสินสิทธิ์จากค่าที่ client ส่งมา", () => {
  // อีเมลที่จะเอาไปเทียบกับรายชื่อแอดมินต้องมาจาก getUser() ฝั่งเซิร์ฟเวอร์
  // เท่านั้น ห้ามหยิบจาก body หรือ header ที่ผู้ยิงกำหนดเองได้
  for (const file of adminFiles) {
    assert.doesNotMatch(
      file.source,
      /body[^\n]*\.email|headers\.get\(["'`]x-/i,
      `${file.path}: อ่านตัวตนจากค่าที่ client ส่งมา`,
    );
  }
});

/* ------------------ ตัวด่านเองต้องตรวจฝั่งเซิร์ฟเวอร์จริง ------------------ */

test("ด่านตรวจสิทธิ์ต้องใช้ getUser() ไม่ใช่ getSession()", () => {
  const guard = allFiles.find(
    (file) => file.path === "lib/supabase/admin-guard.ts",
  );
  assert.ok(guard !== undefined);

  // getSession() อ่านค่าจาก cookie มาเชื่อโดยไม่ยืนยันกับ Supabase
  // ซึ่งปลอมได้ ส่วน getUser() ยืนยัน token กับเซิร์ฟเวอร์ทุกครั้ง
  assert.match(guard.source, /auth\.getUser\(\)/);
  assert.doesNotMatch(guard.source, /auth\.getSession\(\)/);
});

test("ด่านตรวจสิทธิ์ต้องไม่ใช้ service role client", () => {
  const guard = allFiles.find(
    (file) => file.path === "lib/supabase/admin-guard.ts",
  );
  assert.ok(guard !== undefined);

  // service role ไม่ได้เป็นใครเลย จึงตอบไม่ได้ว่า "คนที่ยิงมาคือใคร"
  // ถ้าใช้ตัวนั้นตรวจ ทุกคนจะกลายเป็นแอดมินทันที
  assert.doesNotMatch(guard.source, /getServiceSupabaseClient/);
  assert.match(guard.source, /createServerSupabaseClient/);
});

test("รายชื่อแอดมินต้องอ่านจาก env ที่ไม่ขึ้นต้นด้วย NEXT_PUBLIC_", () => {
  const offenders = allFiles
    .filter((file) => /NEXT_PUBLIC_[A-Z_]*ADMIN/.test(file.source))
    .map((file) => file.path);

  assert.deepEqual(offenders, []);
});

test("อ่าน ADMIN_EMAILS จากไฟล์เดียว", () => {
  const readers = allFiles
    .filter((file) => file.source.includes("process.env.ADMIN_EMAILS"))
    .map((file) => file.path);

  assert.deepEqual(readers, ["lib/admin.ts"]);
});

test("client component ต้องไม่ import ด่านตรวจสิทธิ์หรือชั้นข้อมูลฝั่งเซิร์ฟเวอร์", () => {
  const serverOnly = ["supabase/admin-guard", "supabase/locations", "supabase/service"];

  const offenders = allFiles
    .filter((file) => /^\s*["']use client["']/.test(file.source))
    // import type ไม่ถูกรวมลง bundle จึงไม่ทำให้โค้ดฝั่งเซิร์ฟเวอร์หลุดไป
    .filter((file) =>
      serverOnly.some((moduleName) =>
        new RegExp(`^import(?!\\s+type)[^;]*${moduleName}`, "m").test(file.source),
      ),
    )
    .map((file) => file.path);

  assert.deepEqual(offenders, []);
});

/* ---------------------- สิทธิ์ในไฟล์ migration ---------------------- */

const LOCATION_TABLES = [
  "carrier_branches",
  "unknown_branches",
  "geocode_cache",
];

test("ทั้งสามตารางต้องเปิด RLS", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  for (const table of LOCATION_TABLES) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} ยังไม่ได้เปิด RLS`,
    );
  }
});

test("ทั้งสามตารางต้อง revoke สิทธิ์จาก anon และ authenticated", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  for (const table of LOCATION_TABLES) {
    for (const role of ["anon", "authenticated"]) {
      assert.match(
        sql,
        new RegExp(`revoke all on table public\\.${table} from ${role}`),
        `${table} ยังไม่ได้ revoke สิทธิ์ของ ${role}`,
      );
    }
  }
});

test("migration ต้องไม่สร้าง policy ให้ตารางกลุ่มนี้เลย", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const created = sql
    .split("\n")
    .filter((line) => /^\s*create policy/i.test(line));

  assert.deepEqual(created, []);
});

test("ฟังก์ชันนับสาขาที่ไม่รู้จักต้องถูก revoke สิทธิ์เรียกจาก role อื่น", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  for (const role of ["anon", "authenticated", "public"]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.record_unknown_branch\\(text, text, text\\) from ${role}`,
      ),
      `ยังไม่ได้ revoke สิทธิ์เรียกฟังก์ชันของ ${role}`,
    );
  }
});

test("ฟังก์ชันต้องไม่เป็น security definer", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  // definer ทำให้ฟังก์ชันทำงานด้วยสิทธิ์ของเจ้าของ ซึ่งเป็นช่องให้ role อื่น
  // เรียกผ่านเข้าไปแตะตารางได้ถ้าวันหนึ่งมีใคร grant execute กลับมา
  assert.doesNotMatch(sql, /security\s+definer/i);
});

test("ตารางกลุ่มนี้ต้องไม่มีคอลัมน์ที่ผูกกับผู้ใช้", () => {
  // ตัดคอมเมนต์ทิ้งก่อน ไม่งั้นจะไปโดนคอมเมนต์ที่เขียนว่า "ห้ามมี user_id" เอง
  const statements = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

  // updated_by เก็บอีเมลแอดมินที่แก้พิกัด ซึ่งเป็นคนละเรื่องกับการเก็บว่า
  // ผู้ใช้ทั่วไปคนไหนค้นอะไร — ที่ห้ามคือ user_id ที่อ้างถึง auth.users
  assert.doesNotMatch(statements, /user_id/);
  assert.doesNotMatch(statements, /references auth\.users/);
});

test("โค้ดที่อ้างชื่อสามตารางนี้เป็นค่าจริง ต้องมีไฟล์เดียว", () => {
  for (const table of LOCATION_TABLES) {
    const users = allFiles
      .filter((file) => new RegExp(`["'\`]${table}["'\`]`).test(file.source))
      .map((file) => file.path)
      .sort();

    assert.deepEqual(
      users,
      ["lib/supabase/locations.ts"],
      `${table} ถูกแตะจากหลายไฟล์ — ทางเข้าถึงต้องมีทางเดียว`,
    );
  }
});

/* -------------- สิทธิ์ของตารางของกลางที่เพิ่มมาทีหลัง -------------- */

const USAGE_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0006_provider_usage_and_branch_probe.sql",
);

test("ตาราง provider_usage ต้องล็อกสิทธิ์แบบเดียวกับตารางของกลางอื่น", () => {
  const sql = readFileSync(USAGE_MIGRATION, "utf8");

  assert.match(
    sql,
    /revoke all on table public\.provider_usage from anon, authenticated/,
  );
  assert.match(
    sql,
    /alter table public\.provider_usage enable row level security/,
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.provider_usage to service_role/,
  );
  assert.deepEqual(
    sql.split("\n").filter((line) => /^\s*create policy/i.test(line)),
    [],
  );
});

test("ฟังก์ชันใหม่ต้องถูก revoke จาก role อื่น แล้ว grant ให้ service_role เท่านั้น", () => {
  const sql = readFileSync(USAGE_MIGRATION, "utf8");

  const functions = [
    "public\\.bump_provider_usage\\(text, text\\)",
    "public\\.record_unknown_branch\\(text, text, text, text\\)",
    "public\\.claim_branch_probe\\(text, text, integer\\)",
  ];

  for (const signature of functions) {
    assert.match(
      sql,
      new RegExp(`revoke all on function ${signature} from anon, authenticated, public`),
      `ยังไม่ได้ revoke ${signature}`,
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function ${signature} to service_role`),
      `ยังไม่ได้ grant ${signature}`,
    );
  }
});

test("ฟังก์ชันของกลางต้องไม่เป็น security definer", () => {
  // ข้อยกเว้นเดียวคือ admin_member_stats ใน 0007 ซึ่งมีเหตุผลเขียนกำกับไว้
  // และถูกตรวจแยกที่ lib/admin-privacy.test.ts
  assert.doesNotMatch(readFileSync(USAGE_MIGRATION, "utf8"), /security\s+definer/i);
});

test("ลายเซ็นเก่าของ record_unknown_branch ต้องถูก drop ก่อนสร้างตัวใหม่", () => {
  // ถ้าไม่ drop จะมีสองฟังก์ชันชื่อเดียวกันอยู่พร้อมกัน แล้วการเรียกด้วย
  // สามพารามิเตอร์จะกำกวมจน Postgres ปฏิเสธ
  const sql = readFileSync(USAGE_MIGRATION, "utf8");

  const dropAt = sql.indexOf(
    "drop function if exists public.record_unknown_branch(text, text, text);",
  );
  const createAt = sql.indexOf("create or replace function public.record_unknown_branch");

  assert.ok(dropAt !== -1, "ต้อง drop ลายเซ็นเดิม");
  assert.ok(dropAt < createAt, "ต้อง drop ก่อนสร้างตัวใหม่");
});


/* ----- สิทธิ์ของตารางของกลางที่เพิ่มมาในรอบหลัง (0010 / 0011) ----- */

const LATER_MIGRATIONS = [
  {
    file: "supabase/migrations/0010_tracking_couriers.sql",
    tables: ["tracking_couriers"],
    functions: ["public\\.remember_tracking_courier\\(text, text, text\\)"],
  },
  {
    file: "supabase/migrations/0011_stats_details.sql",
    tables: ["install_events"],
    functions: [
      "public\\.admin_error_breakdown\\(integer\\)",
      "public\\.admin_latency\\(integer\\)",
      "public\\.admin_install_stats\\(\\)",
      "public\\.admin_member_activity\\(\\)",
    ],
  },
];

test("ตารางของกลางที่เพิ่มใหม่ต้อง revoke + เปิด RLS + grant ให้ service_role", () => {
  for (const { file, tables } of LATER_MIGRATIONS) {
    const sql = readFileSync(join(PROJECT_DIR, file), "utf8");

    for (const table of tables) {
      assert.match(
        sql,
        new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
        `${table}: ยังไม่ได้ revoke`,
      );
      assert.match(
        sql,
        new RegExp(`alter table public\\.${table} enable row level security`),
        `${table}: ยังไม่ได้เปิด RLS`,
      );
      assert.match(
        sql,
        new RegExp(`grant select[^;]*on table public\\.${table} to service_role`),
        `${table}: ยังไม่ได้ grant ให้ service_role`,
      );
    }
  }
});

test("ฟังก์ชันที่เพิ่มใหม่ต้อง revoke จาก role อื่นแล้ว grant ให้ service_role", () => {
  for (const { file, functions } of LATER_MIGRATIONS) {
    const sql = readFileSync(join(PROJECT_DIR, file), "utf8");

    for (const signature of functions) {
      assert.match(
        sql,
        new RegExp(`revoke all on function\\s+${signature}\\s+from anon, authenticated, public`),
        `ยังไม่ได้ revoke ${signature}`,
      );
      assert.match(
        sql,
        new RegExp(`grant execute on function ${signature} to service_role`),
        `ยังไม่ได้ grant ${signature}`,
      );
    }
  }
});

test("ฟังก์ชันของกลางรอบหลังต้องไม่เป็น security definer", () => {
  for (const { file } of LATER_MIGRATIONS) {
    assert.doesNotMatch(
      readFileSync(join(PROJECT_DIR, file), "utf8"),
      /security\s+definer/i,
      file,
    );
  }
});
