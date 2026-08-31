/**
 * เทสต์เฝ้าข้อบังคับด้านความเป็นส่วนตัวของสถิติและหน้าแอดมิน
 *
 * ข้อบังคับมีข้อเดียวและไม่มีข้อยกเว้น:
 * **ห้ามมีหน้าหรือ API ใดที่ดูได้ว่าผู้ใช้คนไหนค้นพัสดุอะไร**
 *
 * ทำไมต้องเป็นเทสต์ที่อ่านซอร์สจริง แทนที่จะเป็นเทสต์พฤติกรรม: การรั่วแบบนี้
 * ไม่มีอาการอะไรเลย ระบบที่เก็บ user_id ลงตารางสถิติจะ "ทำงานได้ปกติ" ทุกประการ
 * ตัวเลขบนหน้าสถิติก็ยังถูกต้อง คนที่เพิ่มคอลัมน์นั้นก็ไม่รู้ตัวว่าทำอะไรลงไป
 * และไม่มีเทสต์พฤติกรรมตัวไหนจับได้ จนกว่าจะมีคนเปิดตารางดูแล้วเห็นเข้า
 *
 * ถ้าเทสต์ในไฟล์นี้ล้ม อย่าแก้เทสต์ ให้แก้โค้ด
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const PROJECT_DIR = resolve(import.meta.dirname, "..");

const SEARCH_EVENTS_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0007_search_events.sql",
);
const USAGE_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0006_provider_usage_and_branch_probe.sql",
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
const adminFiles = appFiles.filter((file) => file.path.includes("/admin"));

/** ตัดคอมเมนต์ทิ้ง ไม่งั้นจะไปโดนคอมเมนต์ที่เขียนว่า "ห้ามมี user_id" เอง */
function withoutSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

/* ------------------- ตารางสถิติต้องไม่ผูกกับผู้ใช้ ------------------- */

test("ตาราง search_events ต้องไม่มีคอลัมน์ที่ผูกกับตัวบุคคล", () => {
  const sql = withoutSqlComments(readFileSync(SEARCH_EVENTS_MIGRATION, "utf8"));

  for (const forbidden of [
    "user_id",
    "auth.users",
    "email",
    "ip_address",
    "user_agent",
    "session_id",
  ]) {
    assert.doesNotMatch(
      sql.replace(/from auth\.users/g, ""),
      new RegExp(forbidden.replace(".", "\\.")),
      `search_events ต้องไม่มี ${forbidden}`,
    );
  }
});

test("ตาราง search_events ต้องไม่เก็บเลขพัสดุ", () => {
  // เลขพัสดุหนึ่งเลขผูกกับคนสองคนเสมอ (ผู้ส่งกับผู้รับ) ต่อให้ไม่เก็บว่าใครค้น
  // การเก็บเลขไว้พร้อมเวลาก็เอาไปเทียบกับ saved_trackings ได้
  const sql = withoutSqlComments(readFileSync(SEARCH_EVENTS_MIGRATION, "utf8"));
  assert.doesNotMatch(sql, /tracking_number/);
});

test("ตารางของกลางที่เพิ่มใหม่ต้องไม่ผูกกับผู้ใช้เช่นกัน", () => {
  const sql = withoutSqlComments(readFileSync(USAGE_MIGRATION, "utf8"));
  assert.doesNotMatch(sql, /user_id/);
  assert.doesNotMatch(sql, /references auth\.users/);
});

test("ฟังก์ชันเดียวที่แตะ auth.users ต้องคืนได้แค่ตัวเลขนับ", () => {
  const sql = readFileSync(SEARCH_EVENTS_MIGRATION, "utf8");

  const bodies = sql
    .split(/create or replace function/i)
    .filter((body) => /from auth\.users/i.test(body));

  assert.equal(bodies.length, 1, "ควรมีฟังก์ชันเดียวที่อ่าน auth.users");

  const [body] = bodies;
  // select ที่ไม่ใช่ count(*) คือช่องที่ดึงแถวของคนจริงออกมาได้
  assert.match(body, /count\(\*\)/);
  assert.doesNotMatch(body, /select\s+\*/i);
  assert.doesNotMatch(body, /\bemail\b/i);
  assert.doesNotMatch(body, /\bid\b\s*,/i);
});

test("ฟังก์ชันที่แตะ auth.users ต้องล็อก search_path และให้สิทธิ์เฉพาะ service_role", () => {
  const sql = readFileSync(SEARCH_EVENTS_MIGRATION, "utf8");

  assert.match(sql, /set search_path = ''/);
  for (const role of ["anon", "authenticated", "public"]) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.admin_member_stats\\(\\)[^;]*${role}`,
      ),
      `ยังไม่ได้ revoke สิทธิ์เรียกของ ${role}`,
    );
  }
});

test("ตารางสถิติต้องถูก revoke จาก anon/authenticated และเปิด RLS", () => {
  const sql = readFileSync(SEARCH_EVENTS_MIGRATION, "utf8");

  assert.match(sql, /revoke all on table public\.search_events from anon, authenticated/);
  assert.match(sql, /alter table public\.search_events enable row level security/);
  assert.deepEqual(
    sql.split("\n").filter((line) => /^\s*create policy/i.test(line)),
    [],
  );
});

/* --------------------- ทางเข้าถึงต้องมีทางเดียว --------------------- */

test("โค้ดที่อ้างชื่อตาราง search_events ต้องมีไฟล์เดียว", () => {
  const users = allFiles
    .filter((file) => /["'`]search_events["'`]/.test(file.source))
    .map((file) => file.path)
    .sort();

  assert.deepEqual(users, ["lib/supabase/search-events.ts"]);
});

test("ชั้นข้อมูลสถิติต้องไม่รับหรือส่งอะไรที่ระบุตัวบุคคลได้", () => {
  const file = allFiles.find(
    (entry) => entry.path === "lib/supabase/search-events.ts",
  );
  assert.ok(file !== undefined);

  // ตัดคอมเมนต์ออกก่อน เพราะหัวไฟล์เขียนกติกาพวกนี้ไว้เป็นตัวอักษร
  const code = file.source
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join("\n");

  for (const forbidden of [
    "user_id",
    "userId",
    "email",
    "trackingNumber",
    "tracking_number",
    "listUsers",
  ]) {
    assert.doesNotMatch(code, new RegExp(forbidden), `ต้องไม่มี ${forbidden}`);
  }
});

/* ------------------ หน้าและ API ของแอดมิน ------------------ */

test("โค้ดแอดมินต้องไม่แตะตารางที่ผูกกับผู้ใช้", () => {
  for (const file of adminFiles) {
    for (const forbidden of ["saved_trackings", "auth.users", "listUsers"]) {
      assert.doesNotMatch(
        file.source,
        new RegExp(forbidden.replace(".", "\\.")),
        `${file.path}: แตะ ${forbidden}`,
      );
    }
  }
});

test("โค้ดแอดมินต้องไม่แตะเลขพัสดุของใคร", () => {
  for (const file of adminFiles) {
    assert.doesNotMatch(
      file.source,
      /trackingNumber|tracking_number/,
      `${file.path}: อ้างถึงเลขพัสดุ`,
    );
  }
});

test("อีเมลเดียวที่หน้าแอดมินแตะได้ คืออีเมลของแอดมินที่กำลังเปิดหน้าอยู่", () => {
  for (const file of adminFiles) {
    const uses = [...file.source.matchAll(/[A-Za-z_.]*\.email\b/g)].map(
      (match) => match[0],
    );

    const strays = uses.filter((use) => use !== "admin.email");
    assert.deepEqual(strays, [], `${file.path}: อ่านอีเมลจาก ${strays.join(", ")}`);
  }
});

test("หน้าสถิติต้องไม่มีการวนแสดงรายการที่มาจากตารางของผู้ใช้", () => {
  const page = adminFiles.find(
    (file) => file.path === "app/admin/stats/page.tsx",
  );
  assert.ok(page !== undefined, "ต้องมีหน้าสถิติให้ตรวจจริง");

  // ทุกตัวเลขต้องมาจากฟังก์ชันสรุปที่คืน count(*) เท่านั้น
  for (const allowed of [
    "readMemberStats",
    "readSearchOverview",
    "readSearchDaily",
    "readTopCarriers",
    "countBranches",
    "listProviderUsage",
  ]) {
    assert.match(page.source, new RegExp(allowed));
  }

  assert.doesNotMatch(page.source, /createServerSupabaseClient|\.from\(/);
});

test("หน้าสถิติต้องผ่านด่านตรวจสิทธิ์ชุดเดียวกับหน้าอื่นของแอดมิน", () => {
  const page = adminFiles.find(
    (file) => file.path === "app/admin/stats/page.tsx",
  );
  assert.ok(page !== undefined);

  const guardAt = page.source.indexOf("requireAdmin(");
  assert.ok(guardAt !== -1, "ต้องเรียก requireAdmin()");

  // ต้องตรวจก่อนไปดึงข้อมูลใดๆ ไม่ใช่ดึงมาก่อนแล้วค่อยตรวจ
  for (const reader of ["readMemberStats(", "readSearchOverview("]) {
    const readerAt = page.source.indexOf(reader);
    assert.ok(readerAt === -1 || guardAt < readerAt, `ต้องตรวจสิทธิ์ก่อน ${reader}`);
  }
});

test("การบันทึกสถิติต้องเกิดจากที่เดียว และไม่ส่งอะไรที่ระบุตัวคนไปด้วย", () => {
  const callers = allFiles
    .filter((file) => file.source.includes("recordSearchEvent("))
    .map((file) => file.path)
    .sort();

  assert.deepEqual(callers, [
    "app/api/track/route.ts",
    "lib/supabase/search-events.ts",
  ]);

  const route = allFiles.find((file) => file.path === "app/api/track/route.ts");
  assert.ok(route !== undefined);

  // ตัวเลขทั้งหมดที่ส่งไปต้องมาจากผลลัพธ์ของการค้น ไม่ใช่จากตัวผู้ค้น
  for (const call of route.source.split("recordSearchEvent(").slice(1)) {
    const payload = call.slice(0, call.indexOf("});"));
    assert.doesNotMatch(payload, /trackNo|trackingNumber|user|email|request/);
  }
});
