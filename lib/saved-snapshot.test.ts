/**
 * เทสต์เฝ้ากติกา "snapshot ของ saved_trackings ต้องมาจากที่เดียว"
 *
 * ------------------------------------------------------------------
 * ทำไมต้องเฝ้าถึงระดับนี้
 *
 * ตอนนี้มีสามเส้นทางที่เขียนสถานะลงแถวเดียวกัน:
 *
 *   POST /api/saved           ตอนกดบันทึก
 *   POST /api/saved/refresh   ตอนกดปุ่มค้นหาสถานะในหน้าประวัติ
 *   POST /api/track           ตอนค้นหาแล้วเลขนั้นอยู่ในประวัติของผู้ใช้
 *
 * ถ้าเส้นทางไหนประกอบค่าคอลัมน์เอง มันจะเพี้ยนจากอีกสองเส้นทันทีที่มีคนแก้
 * ที่เดียว — และ **ไม่มี type error ให้เห็นเลย** เพราะทุกฟิลด์ยังชนิดถูกอยู่
 * ผู้ใช้จะเห็นสถานะไม่ตรงกันระหว่างหน้าประวัติกับหน้าค้นหา แล้วไม่มีใครรู้ว่า
 * ทำไม จนกว่าจะมีคนเทียบสองหน้าจอกัน
 *
 * นี่คือรูปแบบเดียวกับบั๊ก P0 (#29) เป๊ะๆ ที่ /api/saved กับ
 * /api/saved/refresh คืนข้อมูลคนละรูปแบบกันโดยไม่มีอะไรฟ้อง
 *
 * ถ้าเทสต์ในไฟล์นี้ล้ม อย่าแก้เทสต์ ให้ไปเรียก buildSavedSnapshot()
 * ------------------------------------------------------------------
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

import { latestLocation } from "./saved-snapshot.ts";

const PROJECT_DIR = resolve(import.meta.dirname, "..");

/** ไฟล์เดียวที่ได้รับอนุญาตให้ประกอบค่าคอลัมน์ของ saved_trackings */
const SNAPSHOT_FILE = "lib/saved-snapshot.ts";

/** คอลัมน์สถานะที่ต้องเขียนผ่านตัวประกอบกลางเท่านั้น */
const SNAPSHOT_COLUMNS = [
  "last_status",
  "last_status_text",
  "last_location_text",
  "last_lat",
  "last_lng",
  "last_location_accuracy",
  "last_updated_at",
];

interface SourceFile {
  path: string;
  source: string;
}

function collect(dir: string): SourceFile[] {
  const found: SourceFile[] = [];

  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;

    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;

    found.push({
      path: relative(PROJECT_DIR, full),
      source: readFileSync(full, "utf8"),
    });
  }

  return found;
}

const files = [
  ...collect(join(PROJECT_DIR, "app")),
  ...collect(join(PROJECT_DIR, "lib")),
];

/** ตัดคอมเมนต์ออก ไม่งั้นจะไปโดนคำอธิบายที่พูดถึงชื่อคอลัมน์เอง */
function code(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\{?\/\*|\*|\/\/)/.test(line))
    .join("\n");
}

test("มีตัวประกอบ snapshot อยู่จริงและ export ออกมาให้ใช้ร่วมกัน", () => {
  const file = files.find((entry) => entry.path === SNAPSHOT_FILE);
  assert.ok(file !== undefined, `ต้องมี ${SNAPSHOT_FILE}`);
  assert.match(file.source, /export async function buildSavedSnapshot/);
});

test("ห้ามมีไฟล์อื่นประกอบค่าคอลัมน์สถานะเอง", () => {
  // นี่คือเทสต์ที่จะพังทันทีถ้ามีคนสร้าง snapshot ตัวที่สอง ไม่ว่าจะที่ไฟล์ไหน
  for (const file of files) {
    if (file.path === SNAPSHOT_FILE) continue;

    // ตรวจเฉพาะไฟล์ที่แตะตาราง saved_trackings จริง — ตารางอื่นมีคอลัมน์ชื่อ
    // ซ้ำกันได้ (tracking_cache ก็มี last_updated_at เหมือนกัน) การเหมารวมจะ
    // ทำให้เทสต์ฟ้องของที่ไม่เกี่ยวข้อง แล้วคนก็จะเลิกเชื่อมัน
    if (!file.source.includes("saved_trackings")) continue;

    const body = code(file.source);

    for (const line of body.split("\n")) {
      for (const column of SNAPSHOT_COLUMNS) {
        const at = new RegExp(`\\b${column}\\s*:(.*)$`).exec(line);
        if (at === null) continue;

        // แยก "ประกาศชนิด" (last_status: string | null) ออกจาก "กำหนดค่า"
        // (last_status: result.status) — อย่างแรกคือ interface ของแถวที่อ่านมา
        // ซึ่งไม่เกี่ยวกับการเขียน อย่างหลังคือการประกอบ snapshot เอง
        const value = at[1].trim();
        const isTypeDeclaration = /^(string|number|boolean|null|unknown)\b/.test(value);
        if (isTypeDeclaration) continue;

        assert.fail(
          `${file.path}: ประกอบค่า ${column} เอง — ต้องเรียก buildSavedSnapshot() แทน\n    ${line.trim()}`,
        );
      }
    }
  }
});

test("ทุกเส้นทางที่เขียนสถานะ ต้อง import ตัวประกอบกลาง", () => {
  const writers = files.filter(
    (file) =>
      file.path.startsWith("app/api/") &&
      /\.from\("saved_trackings"\)[\s\S]{0,200}\.(update|upsert)\(/.test(file.source),
  );

  assert.ok(writers.length >= 2, "ควรมีอย่างน้อยสองเส้นทางที่เขียน");

  for (const file of writers) {
    // ยกเว้นเส้นทางที่เขียนแค่ nickname (ปุ่ม "บันทึกไว้" ที่ไม่ยิงถามขนส่ง)
    // — เส้นนั้นไม่มีสถานะให้บันทึกอยู่แล้ว จึงไม่ต้องใช้ตัวประกอบ
    const writesStatus = SNAPSHOT_COLUMNS.some((c) =>
      new RegExp(`\\b${c}\\b`).test(code(file.source)),
    );
    if (!writesStatus && !/buildSavedSnapshot/.test(file.source)) continue;

    assert.match(
      file.source,
      /buildSavedSnapshot/,
      `${file.path}: เขียนสถานะแต่ไม่ได้เรียก buildSavedSnapshot()`,
    );
  }
});

/* ------------------- เงื่อนไขความปลอดภัยของการเขียนกลับ ------------------- */

test("การเขียนกลับจาก /api/track ต้องกรองด้วย user_id ตรงๆ", () => {
  const route = files.find((f) => f.path === "app/api/track/route.ts");
  assert.ok(route !== undefined);

  const fn = route.source.slice(route.source.indexOf("async function syncSavedRow"));
  const block = fn.slice(0, fn.indexOf("\n}\n"));

  assert.match(block, /\.eq\("user_id", user\.id\)/, "ต้องกรอง user_id ไม่พึ่ง RLS อย่างเดียว");
  assert.match(block, /\.update\(/, "ต้องใช้ update");
  assert.doesNotMatch(block, /\.upsert\(/, "ห้าม upsert — จะไปสร้างแถวใหม่ให้คนที่ไม่ได้บันทึก");
});

test("การเขียนกลับต้องไม่ทำให้การค้นหาล้มตาม", () => {
  const route = files.find((f) => f.path === "app/api/track/route.ts");
  const fn = route!.source.slice(route!.source.indexOf("async function syncSavedRow"));
  const block = fn.slice(0, fn.indexOf("\n}\n"));

  assert.match(block, /try\s*\{/, "ต้องมี try ครอบทั้งก้อน");
  assert.match(block, /catch/, "ต้องมี catch");
  assert.doesNotMatch(block, /\bthrow\b/, "ห้าม throw ออกไปจากเส้นทางนี้");
});

test("ต้องไม่เขียนกลับเมื่อยังไม่ล็อกอิน", () => {
  const route = files.find((f) => f.path === "app/api/track/route.ts");
  const fn = route!.source.slice(route!.source.indexOf("async function syncSavedRow"));
  const block = fn.slice(0, fn.indexOf("\n}\n"));

  assert.match(
    block,
    /if \(user === null\) return null;/,
    "ต้องออกทันทีเมื่อไม่ล็อกอิน ก่อนแตะฐานข้อมูลใดๆ",
  );
});

/* ------------------------------ ตัวช่วย ------------------------------ */

test("หาสถานที่ล่าสุดที่ระบุมาจริง ไล่จากใหม่ไปเก่า", () => {
  assert.equal(
    latestLocation([
      { location: "ศูนย์คัดแยก" },
      { location: "  " },
      { location: "" },
    ]),
    "ศูนย์คัดแยก",
  );
  assert.equal(latestLocation([]), "");
});
