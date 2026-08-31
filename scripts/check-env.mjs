/**
 * ตรวจว่าค่าที่โปรแกรมอ่านได้จริง ตรงกับที่เขียนไว้ในไฟล์ .env.local หรือไม่
 *
 *   node scripts/check-env.mjs                     ตรวจเฉพาะค่า
 *   node scripts/check-env.mjs --call-thailand-post ยิงขอ token จริงเทียบสองค่า
 *
 * มีไว้เพราะอาการ "curl ใช้ได้แต่แอปได้ 401" เกิดได้จากสองสาเหตุที่มองไม่เห็น
 * จากภายนอก และทั้งคู่ไม่ทำให้แอป error ตอนอ่าน env (ตัวแปรมีค่าอยู่ แค่ผิดค่า):
 *
 *   1. ค่ามีเครื่องหมาย $ — Next ใช้ dotenv-expand ตีความว่าเป็นชื่อตัวแปรอื่น
 *      แล้วตัดตั้งแต่ $ เป็นต้นไปทิ้ง (ทดสอบแล้ว: 17 ตัวอักษรเหลือ 3)
 *
 *   2. มีค่าเดิมค้างอยู่ใน process.env อยู่แล้ว เช่น PM2 จำ env ตอนสร้าง process
 *      ไว้ หรือมี export ใน shell — Next จะไม่เขียนทับค่าที่มีอยู่แล้ว ไฟล์
 *      .env.local จึงถูกมองข้ามทั้งไฟล์
 *
 * สคริปต์นี้ไม่พิมพ์ค่าเต็มของ key ออกมา แสดงแค่ความยาวกับ checksum
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import nextEnv from "@next/env";

const PROJECT_DIR = resolve(import.meta.dirname, "..");
const ENV_FILE = resolve(PROJECT_DIR, ".env.local");

const KEYS = [
  "THAILAND_POST_API_KEY",
  "TRACK123_API_KEY",
  "ETRACKINGS_API_KEY",
  "ETRACKINGS_KEY_SECRET",
  "GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_EMAILS",
];

const checksum = (value) =>
  value === "" ? "—" : createHash("sha256").update(value, "utf8").digest("hex").slice(0, 10);

/**
 * อ่าน claim "role" ออกจาก Supabase key
 *
 * key ของ anon กับ service_role หน้าตาเหมือนกันทุกประการ ต่างกันแค่ claim นี้
 * การวางสลับช่องจึงเกิดง่ายมากและทำให้ทุก request โดน permission denied
 * โดยที่ความยาวกับ checksum ยัง "ตรง" ทุกอย่าง — เคยเกิดจริงบน production
 *
 * ถอดรหัสอย่างเดียว ไม่ตรวจลายเซ็น และไม่พิมพ์ค่า key ออกมา
 * (ตรรกะชุดเดียวกับ lib/supabase/key-role.ts)
 */
function keyRole(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const role = JSON.parse(Buffer.from(padded, "base64").toString("utf8")).role;
    return typeof role === "string" && role.trim() !== "" ? role.trim() : null;
  } catch {
    return null;
  }
}

/** ป้ายบอก role พร้อมคำเตือนเมื่อวางผิดช่อง */
function roleLabel(name, value) {
  const role = keyRole(value);
  if (role === null) return "";

  const expected =
    name === "SUPABASE_SERVICE_ROLE_KEY"
      ? "service_role"
      : name === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        ? "anon"
        : null;

  if (expected === null) return `  role=${role}`;
  return role === expected
    ? `  role=${role} ✓`
    : `  role=${role} ⚠️ ควรเป็น ${expected} — วางสลับช่องหรือเปล่า?`;
}

/** ค่าดิบตามที่เขียนไว้ในไฟล์ (แบบเดียวกับที่ตาเห็นและที่ curl หยิบไปใช้) */
function readRawFile() {
  let text;
  try {
    text = readFileSync(ENV_FILE, "utf8");
  } catch {
    return null;
  }

  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1));
  }
  return values;
}

const raw = readRawFile();
if (raw === null) {
  console.error(`ไม่พบไฟล์ ${ENV_FILE}`);
  console.error("ถ้ารันจากที่อื่น ให้ cd เข้าโฟลเดอร์โปรเจกต์ก่อน");
  process.exit(1);
}

// ต้องจำไว้ก่อนโหลด เพื่อดูว่าตัวไหนถูกตั้งมาจากข้างนอกอยู่แล้ว
const preexisting = new Map(KEYS.map((key) => [key, process.env[key]]));

nextEnv.loadEnvConfig(PROJECT_DIR, false, { info: () => {}, error: () => {} });

console.log(`ไฟล์ที่อ่าน: ${ENV_FILE}`);
console.log(`โฟลเดอร์ที่ใช้เป็นฐาน: ${PROJECT_DIR}`);
console.log("(ค่าที่แสดงเป็นความยาวกับ checksum เท่านั้น ไม่ใช่ค่าจริง)\n");

let problems = 0;

for (const key of KEYS) {
  const inFile = raw.get(key);
  const loaded = process.env[key] ?? "";
  const shadowed = preexisting.get(key) !== undefined;

  if (inFile === undefined && loaded === "") {
    console.log(`${key}\n  ไม่ได้ตั้งค่าไว้ทั้งในไฟล์และใน process.env\n`);
    continue;
  }

  console.log(key);

  if (inFile !== undefined) {
    console.log(`  ในไฟล์      ยาว ${inFile.length} ตัวอักษร  checksum ${checksum(inFile)}`);
  } else {
    console.log("  ในไฟล์      ไม่มีบรรทัดนี้");
  }
  console.log(
    `  โปรแกรมอ่านได้ ยาว ${loaded.length} ตัวอักษร  checksum ${checksum(loaded)}` +
      roleLabel(key, loaded),
  );

  // ความยาวกับ checksum "ตรง" ได้ทั้งที่วางผิดช่อง เพราะ key ของ anon กับ
  // service_role หน้าตาเหมือนกัน ต้องดู role ข้างในถึงจะรู้
  const role = keyRole(loaded);
  const wantedRole =
    key === "SUPABASE_SERVICE_ROLE_KEY"
      ? "service_role"
      : key === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
        ? "anon"
        : null;

  if (role !== null && wantedRole !== null && role !== wantedRole) {
    problems += 1;
    console.log(`  ❌ key นี้เป็นของ role "${role}" แต่ช่องนี้ต้องการ "${wantedRole}"`);
    console.log("     ทุก request จะโดน permission denied ทั้งที่ค่าดูเหมือนตั้งครบ");
    console.log("     แก้: คัดลอกค่าใหม่จาก Supabase dashboard → Project Settings → API");
  }

  if (shadowed) {
    problems += 1;
    console.log("  ❌ ค่านี้ถูกตั้งมาจากข้างนอกก่อนแล้ว (PM2 / ecosystem / export ใน shell)");
    console.log("     Next ไม่เขียนทับค่าที่มีอยู่แล้ว ไฟล์ .env.local จึงถูกมองข้าม");
    console.log("     แก้: เอาค่านี้ออกจาก ecosystem.config.js หรือ shell แล้ว pm2 delete + start ใหม่");
  } else if (inFile !== undefined && inFile.includes("$") && !inFile.includes("\\$")) {
    problems += 1;
    console.log("  ❌ ค่ามีเครื่องหมาย $ ที่ยังไม่ได้ escape");
    console.log("     Next (dotenv-expand) จะตัดตั้งแต่ $ เป็นต้นไปทิ้ง");
    console.log("     แก้: เปลี่ยน $ เป็น \\$ ในไฟล์ .env.local แล้ว build ใหม่");
  } else if (inFile !== undefined) {
    const trimmedFile = inFile.trim().replace(/^(['"])(.*)\1$/s, "$2");
    if (trimmedFile !== loaded) {
      problems += 1;
      console.log("  ❌ ค่าที่โปรแกรมอ่านได้ไม่ตรงกับในไฟล์ โดยไม่ทราบสาเหตุ");
    } else {
      console.log("  ✅ ตรงกับในไฟล์");
    }
  }
  console.log();
}

if (!process.argv.includes("--call-thailand-post")) {
  console.log(problems === 0
    ? "ไม่พบความผิดปกติของค่า env"
    : `พบ ${problems} จุดที่ต้องแก้ (ดู ❌ ข้างบน)`);
  console.log("\nอยากยิงขอ token จริงเทียบสองค่า ให้เติม --call-thailand-post");
  process.exit(problems === 0 ? 0 : 1);
}

/* ---- ยิงขอ token จริง เทียบค่าในไฟล์กับค่าที่โปรแกรมอ่านได้ ---- */

const ENDPOINT = "https://trackapi.thailandpost.co.th/post/api/v1/authenticate/token";

async function requestToken(label, apiKey) {
  if (apiKey === undefined || apiKey === "") {
    console.log(`  ${label}: ไม่มีค่าให้ทดสอบ`);
    return;
  }
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    const got = typeof body?.token === "string" ? "ได้ token กลับมา" : `ไม่ได้ token (${body?.message ?? "ไม่มีข้อความ"})`;
    console.log(`  ${label}: HTTP ${response.status} — ${got}`);
  } catch (error) {
    console.log(`  ${label}: ยิงไม่สำเร็จ — ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("ยิงขอ token จริงจากไปรษณีย์ไทย เทียบสองค่า\n");
const fileValue = raw.get("THAILAND_POST_API_KEY")?.trim().replace(/^(['"])(.*)\1$/s, "$2");
await requestToken("ค่าที่เขียนไว้ในไฟล์ (แบบที่ curl ใช้)", fileValue);
await requestToken("ค่าที่โปรแกรมอ่านได้จริง       ", process.env.THAILAND_POST_API_KEY);
console.log("\nถ้าบรรทัดแรกผ่านแต่บรรทัดสองไม่ผ่าน = ค่าถูกแปลงระหว่างทาง ดู ❌ ข้างบน");
