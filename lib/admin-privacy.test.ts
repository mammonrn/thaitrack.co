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
const ACCURACY_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0008_location_accuracy.sql",
);
const COURIERS_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0010_tracking_couriers.sql",
);
const STATS_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0011_stats_details.sql",
);
const PROMPT_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0013_install_prompt_events.sql",
);
const REFERRER_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0017_referrer_channels.sql",
);
const MIGRATIONS_DIR = join(PROJECT_DIR, "supabase/migrations");

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

test("migration ที่แตะตารางของผู้ใช้ ต้องเพิ่มได้แค่คุณสมบัติของหมุด", () => {
  // 0008 แตะ saved_trackings ซึ่งเป็นตารางของผู้ใช้ (มี user_id + RLS มาแต่เดิม)
  // การเพิ่มคอลัมน์ที่นั่นต้องเป็นเรื่องของ "หมุด" ไม่ใช่เรื่องของ "คน"
  // เทสต์นี้กันคนแอบพ่วงคอลัมน์อื่นเข้ามาพร้อมกัน
  const sql = withoutSqlComments(readFileSync(ACCURACY_MIGRATION, "utf8"));

  const added = [...sql.matchAll(/add column if not exists\s+(\w+)/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(added.sort(), [
    "accuracy",
    "accuracy_meters",
    "area_only",
    "last_location_accuracy",
  ]);
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

test("รูปแบบเลขที่ส่งเข้าสถิติต้องผ่านตัวแปลงเสมอ ไม่ใช่เลขดิบ", () => {
  // ด่านข้างบนกันเลขดิบไว้แล้ว ด่านนี้กันอีกทางหนึ่ง: ถ้าวันหนึ่งมีคนเปลี่ยน
  // ให้ส่งค่าอื่นเข้าฟิลด์ trackingShape โดยไม่ผ่าน trackingShape() เทสต์นี้จะล้ม
  const route = allFiles.find((file) => file.path === "app/api/track/route.ts");
  assert.ok(route !== undefined, "ต้องมี route ให้ตรวจจริง");

  if (!route.source.includes("trackingShape:")) return;

  assert.match(
    route.source,
    /const shape = trackingShape\(/,
    "ต้องแปลงผ่าน trackingShape() ก่อนเสมอ",
  );
  assert.match(
    route.source,
    /trackingShape: [^;]*shape/,
    "ฟิลด์ trackingShape ต้องรับค่าที่มาจากตัวแปลงเท่านั้น",
  );
});

/* --------------- ตารางของกลางที่เพิ่มมาในรอบหลัง --------------- */

test("ตาราง tracking_couriers ต้องไม่ผูกกับผู้ใช้", () => {
  // "เลขนี้เป็นของขนส่งเจ้าไหน" เป็นข้อเท็จจริงของพัสดุ ไม่ใช่ข้อมูลของคนที่ค้น
  // ถ้าเก็บว่าใครทำให้เรารู้ มันจะกลายเป็นบันทึกว่าใครค้นเลขอะไรทันที
  const sql = withoutSqlComments(readFileSync(COURIERS_MIGRATION, "utf8"));

  assert.doesNotMatch(sql, /user_id/);
  assert.doesNotMatch(sql, /references auth\.users/);
  assert.doesNotMatch(sql, /\bemail\b/i);
});

test("ตารางสถิติที่เพิ่มใหม่ต้องไม่เก็บอะไรที่ระบุตัวคน", () => {
  // ตรวจเฉพาะนิยามของตาราง ไม่ใช่ทั้งไฟล์ — ฟังก์ชันสรุปอ่าน user_id จาก
  // saved_trackings เพื่อ "นับผู้ใช้ที่ไม่ซ้ำ" ได้ ตราบใดที่คืนออกมาแค่ตัวเลข
  // (มีเทสต์แยกเฝ้าเรื่องนั้นอยู่ข้างล่าง)
  for (const file of [STATS_MIGRATION, PROMPT_MIGRATION, REFERRER_MIGRATION]) {
    const sql = withoutSqlComments(readFileSync(file, "utf8"));

    const definitions = [
      ...sql.matchAll(/create table[^;]*?\(([\s\S]*?)\);/g),
      ...sql.matchAll(/(add column if not exists[^;]*);/g),
    ]
      .map((match) => match[1])
      .join("\n");

    for (const forbidden of [
      "user_id",
      "ip_address",
      "user_agent",
      "session_id",
      "tracking_number",
      "email",
    ]) {
      assert.doesNotMatch(
        definitions,
        new RegExp(forbidden),
        `ตารางสถิติต้องไม่มีคอลัมน์ ${forbidden}`,
      );
    }
  }
});

test("ฟังก์ชันที่แตะ saved_trackings ต้องคืนได้แค่ตัวเลขนับ", () => {
  // saved_trackings มี user_id มาแต่เดิม การนับผู้ใช้ที่ไม่ซ้ำเป็นตัวเลขรวม
  // แต่ถ้าเผลอ select user_id ออกมา มันจะกลายเป็นรายชื่อคนทันที
  const sql = withoutSqlComments(readFileSync(STATS_MIGRATION, "utf8"));

  const bodies = sql
    .split(/create or replace function/i)
    .filter((body) => /from public\.saved_trackings/i.test(body));

  assert.equal(bodies.length, 1, "ควรมีฟังก์ชันเดียวที่อ่าน saved_trackings");

  const [body] = bodies;
  assert.match(body, /count\(\*\)/);
  assert.doesNotMatch(body, /returns table/i, "ห้ามคืนเป็นตาราง คืน jsonb ของตัวนับเท่านั้น");
  assert.doesNotMatch(body, /select\s+\*/i);
});

test("ตารางสถิติใหม่ต้องล็อกสิทธิ์แบบเดียวกับตารางของกลางอื่น", () => {
  const cases = [
    { file: COURIERS_MIGRATION, table: "tracking_couriers" },
    { file: STATS_MIGRATION, table: "install_events" },
    { file: PROMPT_MIGRATION, table: "install_prompt_events" },
    { file: REFERRER_MIGRATION, table: "referrer_daily" },
  ];

  for (const { file, table } of cases) {
    const sql = readFileSync(file, "utf8");

    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
      `${table} ยังไม่ได้ revoke`,
    );
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} ยังไม่ได้เปิด RLS`,
    );
    assert.deepEqual(
      sql.split("\n").filter((line) => /^\s*create policy/i.test(line)),
      [],
      `${table} ต้องไม่มี policy`,
    );
  }
});

test("โค้ดที่อ้างชื่อตารางสถิติใหม่ ต้องมีไฟล์ละหนึ่งที่", () => {
  const owners: Record<string, string> = {
    install_events: "lib/supabase/search-events.ts",
    install_prompt_events: "lib/supabase/search-events.ts",
    tracking_couriers: "lib/supabase/tracking-couriers.ts",
  };

  for (const [table, owner] of Object.entries(owners)) {
    const users = allFiles
      .filter((file) => new RegExp(`["'\`]${table}["'\`]`).test(file.source))
      .map((file) => file.path)
      .sort();

    assert.deepEqual(users, [owner], `${table} ถูกแตะจากหลายไฟล์`);
  }
});

/*
 * ด่านนี้ไล่ดู migration **ทุกไฟล์** ไม่ใช่ไฟล์ที่จดชื่อไว้
 *
 * ตั้งใจต่างจากเทสต์ข้างบนที่ระบุไฟล์ตรงๆ เพราะการเพิ่มคอลัมน์ให้ search_events
 * รอบหน้าจะอยู่ในไฟล์ที่ยังไม่มีใครรู้ชื่อ ถ้าด่านต้องรอให้คนมาจดชื่อไฟล์ใหม่
 * ก่อน มันจะกันได้เฉพาะคนที่ระวังตัวอยู่แล้ว ซึ่งไม่ใช่คนที่ด่านนี้มีไว้กัน
 */
test("ทุก migration ที่เพิ่มคอลัมน์ให้ search_events ต้องเพิ่มได้แค่คุณสมบัติของคำขอ", () => {
  const added: string[] = [];

  for (const name of readdirSync(MIGRATIONS_DIR)) {
    if (!name.endsWith(".sql")) continue;

    const sql = withoutSqlComments(
      readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
    );

    for (const block of sql.matchAll(
      /alter table\s+public\.search_events([\s\S]*?);/g,
    )) {
      // ⚠️ ต้องเป็น matchAll ไม่ใช่ exec — คำสั่ง alter table หนึ่งคำสั่งเพิ่ม
      // ได้หลายคอลัมน์ในคราวเดียว (add column a, add column b) ของเดิมใช้ exec
      // จึงเห็นแค่ตัวแรกแล้วปล่อยที่เหลือผ่านด่านไปเงียบๆ ทั้งชุด
      for (const column of block[1].matchAll(
        /add column(?:\s+if not exists)?\s+(\w+)/g,
      )) {
        added.push(column[1]);
      }
    }
  }

  // ทุกชื่อในรายการนี้ต้องตอบได้ว่า "เป็นเรื่องของคำขอ ไม่ใช่เรื่องของคน"
  // การเพิ่มชื่อใหม่เข้ามาคือการตัดสินใจที่ต้องตั้งใจ ไม่ใช่ผลข้างเคียง
  assert.deepEqual(added.sort(), [
    "reason",
    "took_ms",
    // ⚠️ ไม่ใช่เลขพัสดุ — เป็นรูปแบบที่ตัวเลขถูกแทนด้วย # จนย้อนกลับไม่ได้
    // (ดู lib/tracking-shape.ts และ supabase/migrations/0014_tracking_shape.sql)
    // เทสต์ที่พิสูจน์ว่าย้อนกลับไม่ได้อยู่ที่ lib/tracking-shape.test.ts
    "tracking_shape",
    "unknown_courier",
    // จำนวนครั้งที่ยิงถามขนส่งในคำขอนี้ กับเวลาที่รออยู่ในคิวของเราเอง —
    // ทั้งคู่เป็นตัวเลขที่บรรยายว่า "ระบบเราทำงานอย่างไร" ไม่ได้บรรยายคนที่ค้น
    // และไม่ได้ผูกกับคำขออื่นของคนเดียวกัน (ดู supabase/migrations/0022)
    "queue_ms",
    // "คำขอนี้มาจากการกดปุ่มลองอีกครั้งไหม" — บอกที่มาของคำขอ ไม่ได้บอกอะไร
    // เกี่ยวกับคนที่กด และไม่ผูกคำขอนี้กับคำขออื่นของคนเดียวกัน
    "retried",
    "upstream_calls",
    "upstream_code",
  ].sort());
});

test("ฝั่งเบราว์เซอร์ต้องส่งได้แค่ platform กับ action เท่านั้น", () => {
  // เซิร์ฟเวอร์กรองอยู่แล้ว (มีเทสต์ข้างล่าง) แต่สิ่งที่ "ไม่ได้ส่งออกไปเลย"
  // ปลอดภัยกว่าสิ่งที่ "ส่งไปแล้วถูกทิ้ง" — ถ้าวันหนึ่งมีคนเผลอแนบ user agent
  // เต็มไปด้วย มันจะไปโผล่ใน log ของ proxy หรือ CDN ก่อนถึงโค้ดของเราเสียอีก
  const callers = allFiles.filter((file) =>
    file.source.includes('fetch("/api/installed"'),
  );
  assert.ok(callers.length > 0, "ต้องมีผู้เรียกให้ตรวจจริง");

  for (const caller of callers) {
    for (const call of caller.source.split("JSON.stringify({").slice(1)) {
      const payload = call.slice(0, call.indexOf("})"));
      assert.doesNotMatch(
        payload,
        /userAgent|user_id|email|ip\b|screen|language|referrer/i,
        `${caller.path} ส่งอะไรที่ระบุตัวคนได้ไปกับสถิติ`,
      );
    }
  }
});

test("ตาราง referrer_daily ต้องแตะผ่านฟังก์ชันในฐานข้อมูลเท่านั้น", () => {
  // เข้มกว่ากติกา "ไฟล์ละหนึ่งที่" ของตารางอื่น: ตารางนี้ไม่ควรมีโค้ดฝั่งแอป
  // ที่อ้างชื่อมันเลยแม้แต่ไฟล์เดียว เพราะทุกทางเข้าเป็น RPC ซึ่งจำกัดสิ่งที่
  // ทำได้ไว้ในตัวฟังก์ชันแล้ว (บวกหนึ่ง / อ่านยอดรวม) ไม่มีทาง select ดิบออกมา
  const users = allFiles
    .filter((file) => /["'`]referrer_daily["'`]/.test(file.source))
    .map((file) => file.path);

  assert.deepEqual(users, [], "มีโค้ดที่อ้างชื่อตารางตรงๆ");
});

test("endpoint นับช่องทางที่มาต้องรับได้แค่คำเดียวจากชุดปิด", () => {
  // ⚠️ referrer เต็มคือการรู้ว่าคนคนหนึ่งเพิ่งอ่านอะไรอยู่ก่อนมาถึงเรา
  // ซึ่งไม่ใช่เรื่องของเรา ฝั่งเบราว์เซอร์จำแนกเป็นคำเดียวก่อนส่ง เซิร์ฟเวอร์
  // จึงต้องไม่มีทางไหนที่จะเผลออ่านหรือเก็บ URL ต้นทางได้เลย
  const route = allFiles.find(
    (file) => file.path === "app/api/referrer/route.ts",
  );
  assert.ok(route !== undefined, "ต้องมี endpoint ให้ตรวจจริง");

  assert.doesNotMatch(
    route.source,
    /headers\.get|document\.referrer|getUser|user_id|userAgent/i,
    "endpoint ต้องไม่แตะ header หรืออะไรที่ระบุตัวคนได้",
  );

  // ฝั่งเบราว์เซอร์ก็ต้องส่งแค่ channel ไม่ใช่ referrer ดิบ
  const probe = allFiles.find((file) => file.path === "app/referrer-probe.tsx");
  assert.ok(probe !== undefined);

  for (const call of probe.source.split("JSON.stringify({").slice(1)) {
    const payload = call.slice(0, call.indexOf("})"));
    assert.doesNotMatch(payload, /referrer|document|userAgent|location/i);
  }
});

test("endpoint ตรวจสุขภาพต้องไม่ส่งตัวเลขใดๆ ออกไป", () => {
  // endpoint นี้เปิดสาธารณะเพราะ uptime monitor ล็อกอินไม่ได้ ถ้าใส่ยอดค้นหา
  // หรือยอดโควตาลงในคำตอบ ใครก็ตามที่เดา URL เจอจะรู้ปริมาณธุรกิจของเราทันที
  const route = allFiles.find(
    (file) => file.path === "app/api/health/tracking/route.ts",
  );
  assert.ok(route !== undefined, "ต้องมี endpoint ให้ตรวจจริง");

  const body = route.source.slice(route.source.indexOf("NextResponse.json("));

  for (const forbidden of ["snapshot.total", "snapshot.found", "snapshot.error", "nearQuota.length", "usageOf"]) {
    assert.ok(
      !body.includes(forbidden),
      `คำตอบของ endpoint ต้องไม่มี ${forbidden}`,
    );
  }

  // ตัวเลขไปอยู่ใน log ฝั่งเซิร์ฟเวอร์เท่านั้น ซึ่งมีแต่เจ้าของเว็บเข้าถึงได้
  assert.match(route.source, /console\.warn\(healthLogLine\(/);
});

test("endpoint นับการติดตั้งแอพต้องไม่เก็บอะไรที่ระบุตัวคน", () => {
  const route = allFiles.find(
    (file) => file.path === "app/api/installed/route.ts",
  );
  assert.ok(route !== undefined, "ต้องมี endpoint ให้ตรวจจริง");

  assert.doesNotMatch(route.source, /getUser|user_id|headers\.get|userAgent/i);
});
