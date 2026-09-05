/**
 * เทสต์เฝ้ากติกา "ห้ามยิง API เองโดยที่ผู้ใช้ไม่ได้กด"
 *
 * ------------------------------------------------------------------
 * ทำไมต้องเป็นเทสต์ที่อ่านซอร์สจริง
 *
 * การรั่วแบบนี้ไม่มีอาการอะไรเลย หน้าเว็บที่ยิงเองตอนเปิดจะ "ทำงานได้ดีกว่า"
 * ด้วยซ้ำในสายตาคนเขียน — สถานะสดโดยไม่ต้องกด ไม่มี error ไม่มีอะไรพัง
 * สิ่งเดียวที่เกิดขึ้นคือโควตาหายไปเดือนละหลายร้อยครั้งโดยไม่มีใครสังเกต
 * จนกว่าจะถึงวันที่มันหมดกลางเดือน
 *
 * เคยเป็นแบบนั้นมาแล้วจริง: หน้าประวัติเคยมี useEffect ที่เรียก
 * refreshSavedTrackings() ตอนเปิดหน้า ซึ่งแปลว่าคนที่บันทึกพัสดุไว้ 19 ใบ
 * จุดชนวนการยิงได้ถึง 19 ครั้งต่อการเปิดหน้าหนึ่งครั้ง
 *
 * ถ้าเทสต์ในไฟล์นี้ล้ม อย่าแก้เทสต์ ให้แก้โค้ด
 * ------------------------------------------------------------------
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PROJECT_DIR = resolve(import.meta.dirname, "..");

const HISTORY_LIST = join(PROJECT_DIR, "app/history/history-list.tsx");
const HISTORY_PAGE = join(PROJECT_DIR, "app/history/page.tsx");
const REFRESH_ROUTE = join(PROJECT_DIR, "app/api/saved/refresh/route.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * ตัดคอมเมนต์ออก ไม่งั้นจะไปโดนคอมเมนต์ที่อธิบายกติกาเอง
 *
 * ครอบคอมเมนต์ JSX ({/* … *\/) ด้วย เพราะไฟล์ .tsx เขียนคำอธิบายแบบนั้น
 * ทั้งไฟล์ — ตัวตัดที่ครอบแค่ /* กับ // จะปล่อยให้ข้อความในคอมเมนต์หลุดมา
 * ทำให้เทสต์ "ห้ามมีคำนี้" ตกเพราะคำอธิบาย ไม่ใช่เพราะโค้ดจริง
 */
function code(source: string): string {
  return (
    source
      // ตัดคอมเมนต์บล็อกทั้งก้อนก่อน รวมที่กินหลายบรรทัด — ของเดิมกรองทีละ
      // บรรทัดโดยดูว่าขึ้นต้นด้วยเครื่องหมายคอมเมนต์ไหม ซึ่งพลาดบรรทัดกลางๆ
      // ของคอมเมนต์ยาว (บรรทัดที่ขึ้นต้นด้วยข้อความธรรมดา) ทำให้เทสต์
      // "ห้ามมีคำนี้" ไปเจอคำในคำอธิบายของตัวเอง
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n")
  );
}

test("หน้าประวัติต้องไม่มี useEffect เหลืออยู่เลย", () => {
  // ตัดตรงรากเลย — useEffect คือทางเดียวที่ component จะยิงอะไรเองตอนโหลด
  // ถ้าวันหนึ่งต้องใช้ useEffect ด้วยเหตุผลอื่นจริงๆ ให้มาแก้เทสต์นี้พร้อม
  // อธิบายว่าทำไม ไม่ใช่ปล่อยให้ประตูเปิดทิ้งไว้เฉยๆ
  assert.doesNotMatch(code(read(HISTORY_LIST)), /useEffect/);
});

test("การรีเฟรชต้องถูกเรียกจาก onClick เท่านั้น", () => {
  const source = read(HISTORY_LIST);

  // ทุกจุดที่เรียก runRefresh ต้องอยู่ในบรรทัดที่มี onClick
  const calls = source
    .split("\n")
    .filter((line) => /runRefresh\(/.test(line) && !/^\s*(\*|\/\/)/.test(line));

  assert.ok(calls.length > 0, "ต้องมีปุ่มให้กดจริง");

  for (const line of calls) {
    const isDefinition = /const runRefresh/.test(line);
    assert.ok(
      isDefinition || /onClick/.test(line),
      `เรียก runRefresh นอก onClick: ${line.trim()}`,
    );
  }
});

test("หน้าประวัติฝั่ง server ต้องไม่เรียก endpoint รีเฟรช", () => {
  // page.tsx รันบนเซิร์ฟเวอร์ การเรียกจากตรงนั้นจะยิงทุกครั้งที่มีคนเปิดหน้า
  // โดยที่ผู้ใช้ไม่มีทางห้ามได้เลย
  assert.doesNotMatch(code(read(HISTORY_PAGE)), /refreshSavedTrackings|saved\/refresh/);
});

test("ไม่มีที่ไหนยิงรีเฟรชจากการโหลดหน้าหรือจับเวลา", () => {
  const source = code(read(HISTORY_LIST));

  for (const forbidden of ["setInterval", "setTimeout", "requestIdleCallback"]) {
    assert.doesNotMatch(
      source,
      new RegExp(forbidden),
      `${forbidden} เปิดทางให้ยิงเองโดยผู้ใช้ไม่ได้กด`,
    );
  }
});

test("endpoint ยังอยู่และยังใช้ได้ — แค่ไม่มีใครเรียกให้เอง", () => {
  // ตั้งใจไม่ลบทิ้ง เพราะปุ่มที่ผู้ใช้กดยังต้องใช้มัน
  const route = read(REFRESH_ROUTE);
  assert.match(route, /export async function POST/);
  assert.match(route, /requireAdmin|createServerSupabaseClient/);
});

test("เอกสารในโค้ดต้องเตือนคนที่จะเอา auto กลับมา", () => {
  // คอมเมนต์คือสิ่งเดียวที่จะไปถึงคนที่กำลังจะเพิ่ม useEffect ในอีกหกเดือน
  assert.match(read(REFRESH_ROUTE), /ห้ามเรียกอัตโนมัติ/);
  assert.match(read(HISTORY_LIST), /ไม่มี auto-refresh/);
});

/* ------------- ปุ่ม "บันทึกไว้" ต้องไม่ยิงถามขนส่ง ------------- *
 *
 * เจตนาทั้งหมดของปุ่มนั้นคือ "เก็บเลขไว้ก่อน ค่อยค้นทีหลัง" ถ้า lookup: false
 * หลุดหายไปเมื่อไร มันจะกลายเป็นการค้นหาเงียบๆ ที่ผู้ใช้ไม่ได้ขอ และไม่มีอาการ
 * อะไรให้เห็นเลยนอกจากโควตาที่หายไป
 */

const SAVE_ONLY_BUTTON = join(PROJECT_DIR, "app/save-only-button.tsx");
const SAVED_ROUTE = join(PROJECT_DIR, "app/api/saved/route.ts");
const SEARCH_FORM = join(PROJECT_DIR, "app/tracking-search.tsx");

test('ปุ่ม "บันทึกไว้" ต้องส่ง lookup: false เสมอ', () => {
  assert.match(code(read(SAVE_ONLY_BUTTON)), /lookup:\s*false/);
});

test("เส้นทางบันทึกแบบไม่ค้นหา ต้องไม่เรียก resolveTracking", () => {
  const route = read(SAVED_ROUTE);

  // ตัดเอาเฉพาะบล็อกของ skipLookup มาตรวจ — เส้นทางปกติยังต้องเรียกได้ตามเดิม
  const start = route.indexOf("if (skipLookup) {");
  assert.ok(start > 0, "ต้องมีเส้นทาง skipLookup");

  // ตัดคอมเมนต์ก่อน ไม่งั้นจะไปโดนคอมเมนต์ที่อ้างชื่อฟังก์ชันเพื่ออธิบายเอง
  const block = code(
    route.slice(start, route.indexOf("// อ่านสถานะล่าสุดเอง", start)),
  );
  assert.doesNotMatch(block, /resolveTracking|buildSavedSnapshot/);
});

test("เส้นทางบันทึกแบบไม่ค้นหา ต้องไม่ล้างสถานะเดิมทิ้ง", () => {
  const route = read(SAVED_ROUTE);
  const start = route.indexOf("if (skipLookup) {");
  const block = code(
    route.slice(start, route.indexOf("// อ่านสถานะล่าสุดเอง", start)),
  );

  // เขียนได้แค่สามคอลัมน์นี้ ถ้ามี last_* โผล่มาแปลว่าไปทับของเดิม
  assert.doesNotMatch(block, /last_status|last_location|last_lat|last_lng|last_updated/);
});

test('ฟอร์มหน้าแรกต้องมีทั้งปุ่มค้นหาและปุ่มบันทึก และปุ่มค้นหายังเป็น submit', () => {
  const form = read(SEARCH_FORM);

  assert.match(form, /<SaveOnlyButton/, "ต้องมีปุ่มบันทึกไว้");
  assert.match(form, /ค้นหาพัสดุ/, "ปุ่มค้นหาต้องยังอยู่");
  assert.match(
    form,
    /type="submit"/,
    "ปุ่มค้นหาต้องยังเป็น submit — คำสัญญาหลักของสินค้าห้ามเปลี่ยน",
  );
});

/* ------------- การ์ดในหน้าประวัติ: แตะทั้งใบ ------------- *
 *
 * ปุ่ม "ดูอีกครั้ง" กับ "ค้นหาสถานะ" ถูกลบทิ้งเพราะทำหน้าที่เดียวกับการแตะการ์ด
 * ปุ่มหลายอันที่พาไปที่เดียวกันคือการให้ผู้ใช้ต้องเลือกโดยไม่มีความหมาย
 */

test("การ์ดต้องแตะได้ทั้งใบ และพาไปหน้าแรกพร้อมเลขพัสดุ", () => {
  const source = read(HISTORY_LIST);
  assert.match(source, /href=\{`\/\?track=\$\{encodeURIComponent\(item\.trackingNumber\)\}`\}/);
});

test("ปุ่มที่ซ้ำซ้อนต้องไม่กลับมา", () => {
  const source = code(read(HISTORY_LIST));
  assert.doesNotMatch(source, /ดูอีกครั้ง/, "ปุ่มดูอีกครั้งถูกลบไปแล้ว");
  assert.doesNotMatch(source, /"ค้นหาสถานะ"/, "ปุ่มค้นหาสถานะรายใบถูกลบไปแล้ว");
});

test('ปุ่ม "ค้นหาสถานะล่าสุด (N)" ตัวรวมต้องยังอยู่', () => {
  // ตัวนี้ไม่ได้ถูกลบ — เป็นทางเดียวที่รีเฟรชหลายใบพร้อมกันได้โดยไม่ต้องแตะทีละใบ
  assert.match(read(HISTORY_LIST), /ค้นหาสถานะล่าสุด/);
});

test("ปุ่มลบต้องอยู่นอกลิงก์ ไม่งั้นกดลบแล้วเด้งไปหน้าอื่นด้วย", () => {
  const source = read(HISTORY_LIST);

  const linkClose = source.indexOf("</Link>");
  const deleteButton = source.indexOf("setPendingDelete(item)");

  assert.ok(linkClose > 0 && deleteButton > 0, "ต้องมีทั้งลิงก์และปุ่มลบ");
  assert.ok(
    deleteButton > linkClose,
    "ปุ่มลบต้องอยู่หลัง </Link> — ถ้าซ้อนอยู่ข้างในจะกดลบไม่ได้",
  );
});

/* ------------- ช่องตั้งชื่อบนฟอร์มหน้าแรก ------------- */

test("ฟอร์มหน้าแรกต้องมีช่องตั้งชื่อ และส่งค่าไปกับปุ่มบันทึก", () => {
  const form = read(SEARCH_FORM);
  assert.match(form, /id="tracking-nickname"/, "ต้องมีช่องตั้งชื่อ");
  assert.match(form, /nickname=\{nickname\}/, "ต้องส่งชื่อไปให้ปุ่มบันทึก");
});

test("ช่องตั้งชื่อต้องไม่ไปยุ่งกับการค้นหา", () => {
  // คนที่มาค้นอย่างเดียวต้องไม่ต้องแตะช่องนี้เลย และการค้นหาต้องไม่อ่านค่ามัน
  const form = code(read(SEARCH_FORM));
  const submit = form.slice(form.indexOf("function handleSubmit"), form.indexOf("function handleSubmit") + 600);
  assert.doesNotMatch(submit, /nickname/, "handleSubmit ต้องไม่อ่านค่าชื่อ");
});

/* ------------- สวิตช์แผนที่ต้องปิดได้สนิท ------------- *
 *
 * บั๊กที่เจอ: ปิดสวิตช์แล้วการ์ดยังโชว์กล่อง "ยังไม่มีพิกัดของจุดนี้ จึงยังแสดง
 * แผนที่ไม่ได้" เพราะด่านตรวจสวิตช์ถูกวางลึกเกินไป (อยู่ในเงื่อนไข showMap)
 * ซึ่งครอบแค่กิ่ง "มีพิกัด" ส่วนกิ่ง "ไม่มีพิกัด" หลุดออกมา
 *
 * บทเรียน: ด่านที่วางลึกกว่าจุดที่ต้องปิด จะครอบได้ไม่ครบเสมอ
 */

test("ด่านสวิตช์แผนที่ต้องมีจุดเดียว และอยู่ปากทางเข้าของบล็อกแผนที่", () => {
  const source = code(read(HISTORY_LIST));

  // นับเฉพาะการ "ใช้ค่า" ไม่รวมการประกาศ prop กับพารามิเตอร์ของฟังก์ชัน
  const uses = [...source.matchAll(/\bmapEnabled\b/g)].length;
  assert.equal(
    uses,
    3,
    `mapEnabled ควรปรากฏ 3 ที่ (ประกาศ prop · รับเข้าฟังก์ชัน · ด่านเดียว) แต่เจอ ${uses}`,
  );

  // ด่านต้องเป็นการครอบทั้งก้อน ไม่ใช่ไปผสมอยู่ในเงื่อนไขอื่น
  assert.match(source, /\{mapEnabled && \(/, "ด่านต้องครอบบล็อกทั้งก้อน");
  assert.doesNotMatch(
    source,
    /mapEnabled &&\s*item\.last/,
    "ห้ามเอาสวิตช์ไปผสมกับเงื่อนไขว่ามีพิกัดไหม — ด่านจะครอบไม่ครบ",
  );
});

test("showMap ต้องตอบแค่ว่ามีพิกัดไหม ไม่เกี่ยวกับสวิตช์", () => {
  const source = code(read(HISTORY_LIST));
  const line = source
    .split("\n")
    .find((l) => l.includes("const showMap"));

  assert.ok(line !== undefined, "ต้องมี showMap");
  assert.doesNotMatch(line, /mapEnabled/, "showMap ต้องไม่รู้จักสวิตช์");
});

test("ทุกอย่างที่พูดถึงแผนที่/พิกัด ต้องอยู่ในด่านสวิตช์", () => {
  const source = read(HISTORY_LIST);

  const gateAt = source.indexOf("{mapEnabled && (");
  assert.ok(gateAt > 0, "ต้องมีด่าน");

  // ทุกที่ที่เอ่ยถึงแผนที่/พิกัดในส่วน JSX ต้องอยู่หลังด่าน
  // (ยกเว้นคอมเมนต์อธิบายกับ prop ซึ่งไม่ได้ render ออกไป)
  const beforeGate = code(source.slice(0, gateAt));
  for (const word of ["/api/map", "ยังไม่มีพิกัด", "แสดงแผนที่ไม่ได้"]) {
    assert.ok(
      !beforeGate.includes(word),
      `"${word}" อยู่นอกด่านสวิตช์ — ปิดสวิตช์แล้วจะยังโผล่`,
    );
  }
});
