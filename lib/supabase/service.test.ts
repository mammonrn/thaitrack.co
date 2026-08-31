/**
 * เทสต์กันการถดถอยของ "ตารางของกลางต้องเข้าถึงด้วย service role เท่านั้น"
 *
 * ที่มา: บน production หลัง deploy #13 ทุกการเข้าถึงตารางของกลางถูกปฏิเสธด้วย
 * "permission denied" ทั้งที่ env ถูกตั้งไว้แล้วและ check-env บอกว่าอ่านค่าได้
 * อาการนี้ไม่มีเทสต์ตัวไหนจับได้เลย เพราะเทสต์ทั้งหมดใช้ store ปลอมที่ไม่เคย
 * แตะ Supabase จริง — ตรรกะทุกบรรทัดถูกต้อง แต่ token ที่ออกไปเป็นของ role ผิด
 *
 * ไฟล์นี้จึงตรวจสองชั้นที่เทสต์ตรรกะจับไม่ได้:
 *   1. runtime — สร้าง client แบบเดียวกับของจริง แล้วดัก header ที่ออกไปจริงๆ
 *   2. โครงสร้าง — อ่านซอร์สจริงว่าไม่มีไฟล์ไหนแอบใช้ client ตัวอื่นกับตารางกลุ่มนี้
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

import { createClient } from "@supabase/supabase-js";

import { createTimeoutFetch } from "./fetch.ts";
import { describeKeyProblem, explainPermissionDenied, readKeyRole } from "./key-role.ts";

const PROJECT_DIR = resolve(import.meta.dirname, "../..");

/** สร้าง JWT ปลอมที่มี claim role ตามที่ต้องการ (ไม่ได้เซ็นจริง) */
function fakeKey(role: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  // ลายเซ็นต้องเป็น ASCII เพราะ key ถูกใส่ลง HTTP header ซึ่งรับได้แค่ ByteString
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iss: "supabase", ref: "demo", role, iat: 1, exp: 2 }),
    "fake-signature",
  ].join(".");
}

/* ------------------------------------------------------------------ *
 * 1. อ่าน role ออกจาก key
 * ------------------------------------------------------------------ */

test("อ่าน role ออกจาก key ของ service_role ได้", () => {
  assert.deepEqual(readKeyRole(fakeKey("service_role")), {
    kind: "service_role",
    role: "service_role",
  });
});

test("จับได้ว่าเป็น key ฝั่ง client ที่วางผิดช่อง", () => {
  for (const role of ["anon", "authenticated"]) {
    const result = readKeyRole(fakeKey(role));
    assert.equal(result.kind, "client_role", role);
    assert.equal(result.role, role);
  }
});

test("ค่าที่ไม่ใช่ JWT → unknown ไม่ใช่ผิด (เผื่อ key รูปแบบใหม่)", () => {
  for (const value of ["", "sb_secret_abcdef", "ไม่ใช่ jwt", "a.b"]) {
    assert.equal(readKeyRole(value).kind, "unknown", value);
  }
});

test("ข้อความเตือนต้องบอกว่าให้ไปแก้ตรงไหน และห้ามมีตัว key อยู่ในนั้น", () => {
  const key = fakeKey("anon");
  const message = describeKeyProblem(key, "SUPABASE_SERVICE_ROLE_KEY");

  assert.ok(message !== null);
  assert.match(message, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(message, /anon/);
  assert.match(message, /Project Settings/);
  assert.ok(!message.includes(key), "ห้ามพิมพ์ตัว key ลง log");
});

test("key ที่ถูกต้อง → ไม่มีอะไรต้องเตือน", () => {
  assert.equal(
    describeKeyProblem(fakeKey("service_role"), "SUPABASE_SERVICE_ROLE_KEY"),
    null,
  );
});

test("คำอธิบาย permission denied ต้องบอกสาเหตุที่เป็นไปได้ทั้งสองอย่าง", () => {
  const hint = explainPermissionDenied("permission denied for table tracking_cache");

  assert.ok(hint !== null);
  assert.match(hint, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(hint, /0005_service_role_grants\.sql/);
});

test("error อื่นต้องไม่ถูกต่อคำอธิบายเรื่องสิทธิ์มั่วๆ", () => {
  assert.equal(explainPermissionDenied("connection timeout"), null);
  assert.equal(explainPermissionDenied("relation does not exist"), null);
});

/* ------------------------------------------------------------------ *
 * 2. header ที่ออกไปจริง
 *
 * นี่คือชั้นที่จับบั๊กเดิมได้ — ตรรกะถูกทุกบรรทัดแต่ token ที่ออกไปผิด role
 * ------------------------------------------------------------------ */

/** ดัก request แล้วคืน header ที่ถูกส่งออกไปจริง */
async function captureHeaders(key: string): Promise<Headers> {
  const captured: Headers[] = [];

  const client = createClient("https://demo.supabase.co", key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(
          new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          ),
        );
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    },
  });

  await client.from("tracking_cache").select("*").limit(1);

  assert.equal(captured.length, 1, "ต้องมี request ออกไปจริงหนึ่งครั้ง");
  return captured[0];
}

test("client ที่สร้างแบบเดียวกับของจริง ต้องส่ง key ที่ให้ไปเป็น Authorization", async () => {
  const key = fakeKey("service_role");
  const headers = await captureHeaders(key);

  assert.equal(headers.get("apikey"), key);
  assert.equal(headers.get("authorization"), `Bearer ${key}`);
});

test("ไม่มี session ของผู้ใช้มาแทนที่ token ของ service role", async () => {
  // ถ้าวันหนึ่ง supabase-js เปลี่ยนไปหยิบ access token ของผู้ใช้มาใช้แทน
  // supabaseKey ตารางของกลางจะถูกเข้าถึงด้วยสิทธิ์ของผู้ใช้คนนั้นทันที
  const key = fakeKey("service_role");
  const headers = await captureHeaders(key);

  assert.equal(headers.get("authorization"), `Bearer ${key}`);
  assert.notEqual(headers.get("authorization"), `Bearer ${fakeKey("anon")}`);
});

test("createTimeoutFetch ต้องส่ง header ต่อไปครบ ไม่ทำหล่นระหว่างทาง", async () => {
  // ตัวห่อ fetch ที่ทำ header หายคือวิธีที่เนียนที่สุดที่จะทำให้ token หลุด
  // เก็บลง array ไม่ใช่ตัวแปรเดี่ยว เพราะ TypeScript มองไม่เห็นว่า closure
  // เขียนค่าให้ตัวแปรแล้ว จึงบีบชนิดเหลือ never หลังเช็ค null
  const seen: Headers[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(
      new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      ),
    );
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    await createTimeoutFetch()("https://demo.supabase.co/rest/v1/x", {
      headers: { apikey: "test-key", Authorization: "Bearer test-key" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0].get("apikey"), "test-key");
  assert.equal(seen[0].get("authorization"), "Bearer test-key");
});

/* ------------------------------------------------------------------ *
 * 3. โครงสร้าง — ห้ามมีทางลัดไปหาตารางของกลางด้วย client ตัวอื่น
 * ------------------------------------------------------------------ */

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

const files = [
  ...collect(join(PROJECT_DIR, "app")),
  ...collect(join(PROJECT_DIR, "lib")),
];

/** ไฟล์ที่ได้รับอนุญาตให้แตะตารางของกลาง */
const GATEWAYS = ["lib/supabase/tracking-cache.ts", "lib/supabase/locations.ts"];

const SHARED_TABLES = [
  "tracking_cache",
  "carrier_branches",
  "unknown_branches",
  "geocode_cache",
];

test("ทุกไฟล์ที่แตะตารางของกลาง ต้องใช้ service-role client เท่านั้น", () => {
  for (const path of GATEWAYS) {
    const file = files.find((candidate) => candidate.path === path);
    assert.ok(file !== undefined, `หาไฟล์ ${path} ไม่เจอ`);

    assert.match(
      file.source,
      /getServiceSupabaseClient/,
      `${path}: ต้องใช้ service-role client`,
    );
    assert.doesNotMatch(
      file.source,
      /createServerSupabaseClient|getBrowserClient/,
      `${path}: ห้ามใช้ client ที่ถือ anon key หรือ session ของผู้ใช้`,
    );
  }
});

test("ไม่มีไฟล์อื่นแอบเรียกตารางของกลางด้วย .from()", () => {
  for (const table of SHARED_TABLES) {
    const users = files
      .filter((file) => new RegExp(`["'\`]${table}["'\`]`).test(file.source))
      .map((file) => file.path)
      .filter((path) => !GATEWAYS.includes(path))
      .sort();

    assert.deepEqual(users, [], `${table} ถูกแตะจากไฟล์นอกทางเข้า: ${users.join(", ")}`);
  }
});

test("ฟังก์ชัน RPC ของตารางของกลางถูกเรียกจากทางเข้าเท่านั้น", () => {
  const callers = files
    .filter((file) => /\.rpc\(\s*["'`]record_unknown_branch/.test(file.source))
    .map((file) => file.path);

  assert.deepEqual(callers, ["lib/supabase/locations.ts"]);
});

test("มีเพียงไฟล์เดียวที่สร้าง service-role client", () => {
  const creators = files
    .filter((file) => /createClient\(/.test(file.source))
    .filter((file) => file.source.includes("readSupabaseServiceRoleKey"))
    .map((file) => file.path);

  assert.deepEqual(creators, ["lib/supabase/service.ts"]);
});

test("service client ต้องตรวจ role ของ key ก่อนใช้งาน", () => {
  // นี่คือด่านที่ทำให้ปัญหาเดิมถูกจับได้ตั้งแต่ตอนเริ่มระบบ
  // แทนที่จะต้องไปเจอ permission denied รายคำขอแล้วค่อยไล่หาสาเหตุ
  const service = files.find((file) => file.path === "lib/supabase/service.ts");
  assert.ok(service !== undefined);

  assert.match(service.source, /readKeyRole|describeKeyProblem/);
  assert.match(
    service.source,
    /client_role/,
    "ต้องปฏิเสธเมื่อรู้แน่ว่าเป็น key ฝั่ง client",
  );
});

/* ------------------------------------------------------------------ *
 * 4. migration ต้องให้สิทธิ์ service_role แบบเขียนไว้ชัดๆ
 * ------------------------------------------------------------------ */

const GRANTS_MIGRATION = join(
  PROJECT_DIR,
  "supabase/migrations/0005_service_role_grants.sql",
);

test("ทุกตารางของกลางต้องมี grant ให้ service_role เขียนไว้ตรงๆ", () => {
  // ไม่ฝากความหวังไว้กับ ALTER DEFAULT PRIVILEGES ของ Supabase ซึ่งเปลี่ยนได้
  // และมองไม่เห็นจากในโค้ด — ต้นเหตุหนึ่งของบั๊กเดิม
  const sql = readFileSync(GRANTS_MIGRATION, "utf8");

  for (const table of SHARED_TABLES) {
    assert.match(
      sql,
      new RegExp(`grant [^;]*on table public\\.${table} to service_role`),
      `${table} ยังไม่ได้ grant ให้ service_role`,
    );
  }
});

test("ฟังก์ชันต้องมี grant execute ให้ service_role หลังจาก revoke from public", () => {
  // PostgreSQL ให้ EXECUTE กับ PUBLIC เป็นค่าเริ่มต้น ซึ่ง service_role ได้มา
  // ทางอ้อม พอ 0004 revoke from public สิทธิ์นั้นก็หายไปด้วยถ้าไม่มี grant ตรงๆ
  const sql = readFileSync(GRANTS_MIGRATION, "utf8");

  assert.match(
    sql,
    /grant execute on function public\.record_unknown_branch\(text, text, text\) to service_role/,
  );
});

test("migration ที่ให้สิทธิ์ ต้องไม่ผ่อนเกราะของ anon และ authenticated", () => {
  const statements = readFileSync(GRANTS_MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

  assert.doesNotMatch(
    statements,
    /grant[^;]*to[^;]*\b(anon|authenticated)\b/,
    "ห้าม grant สิทธิ์ให้ anon หรือ authenticated เด็ดขาด",
  );
  assert.doesNotMatch(statements, /create policy/i);
});
