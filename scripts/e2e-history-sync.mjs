/**
 * เทสต์ E2E: ค้นหาที่หน้าแรกแล้วสถานะในหน้าประวัติต้องตามมาด้วย
 *
 * ------------------------------------------------------------------
 * ⚠️ **ไม่ได้อยู่ในชุดเทสต์ประจำ** (npm test) โดยตั้งใจ
 *
 * มันแตะฐานข้อมูลจริง เปิดเบราว์เซอร์จริง และช้ากว่าเทสต์ปกติหลายสิบเท่า
 * รันแยกด้วย `npm run test:e2e` เมื่อต้องการพิสูจน์เส้นทางที่ต้องล็อกอิน
 *
 * ⚠️ **ห้ามใช้ service role key เด็ดขาด** เทสต์นี้ต้องทำได้เท่าที่ผู้ใช้จริง
 * ทำได้ — ถ้าวันไหนต้องใช้สิทธิ์พิเศษถึงจะผ่าน แปลว่าออกแบบผิด ไม่ใช่แปลว่า
 * ต้องเพิ่มสิทธิ์ให้เทสต์
 *
 * ⚠️ **ห้ามเผาโควตา** ใช้เลขพัสดุที่อยู่ใน tracking_cache แล้วเท่านั้น
 * (ตั้งผ่าน TEST_TRACKING_NUMBER) การค้นหาจึงตอบจาก cache ไม่ยิงถามขนส่งจริง
 * ------------------------------------------------------------------
 *
 * ต้องมีไฟล์ .env.test.local (chmod 600, อยู่ใน .gitignore) ที่มี
 *   TEST_USER_EMAIL / TEST_USER_PASSWORD
 * ถ้าไม่มี สคริปต์จะข้ามอย่างสุภาพ ไม่ล้ม — เครื่องอื่นจะได้รันชุดหลักได้ปกติ
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";

const PROJECT_DIR = resolve(import.meta.dirname, "..");
const BASE_URL = process.env.BASE_URL ?? "https://xn--l3cgts1b3bzcvf.com";

/** ข้ามอย่างสุภาพ — ไม่ใช่ความล้มเหลว */
function skip(reason) {
  console.log(`\n⏭️  ข้ามเทสต์ E2E: ${reason}`);
  console.log("   (เทสต์ชุดหลัก npm test ยังรันได้ตามปกติ)\n");
  process.exit(0);
}

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exitCode = 1;
}

/** อ่านไฟล์ .env แบบง่ายๆ — คืน {} เมื่อไม่มีไฟล์ */
function readEnvFile(name) {
  const path = join(PROJECT_DIR, name);
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [
          line.slice(0, at).trim(),
          line.slice(at + 1).trim().replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

/** หา chromium ที่ playwright ดาวน์โหลดไว้ — null เมื่อไม่มี */
function findChromium() {
  const root = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (!existsSync(root)) return null;

  for (const dir of readdirSync(root).sort().reverse()) {
    for (const rel of [
      "chrome-linux/headless_shell",
      "chrome-linux/chrome",
    ]) {
      const full = join(root, dir, rel);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/* --------------------------- เตรียมของ --------------------------- */

const test = readEnvFile(".env.test.local");
if (!test.TEST_USER_EMAIL || !test.TEST_USER_PASSWORD) {
  skip("ไม่มี .env.test.local หรือไม่มี TEST_USER_EMAIL / TEST_USER_PASSWORD");
}

// อ่านเฉพาะสองค่าที่เป็นสาธารณะอยู่แล้ว (ถูกฝังลงไฟล์ JS ที่ส่งให้เบราว์เซอร์)
const app = readEnvFile(".env.local");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? app.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? app.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) skip("ไม่พบค่า NEXT_PUBLIC_SUPABASE_* ");

const TRACKING_NUMBER = process.env.TEST_TRACKING_NUMBER;
if (!TRACKING_NUMBER) {
  skip("ต้องระบุ TEST_TRACKING_NUMBER (เลขที่อยู่ใน cache แล้ว เพื่อไม่เผาโควตา)");
}

const executablePath = findChromium();
if (executablePath === null) skip("ไม่พบ chromium ใน ~/.cache/ms-playwright");

const { chromium } = await import("playwright-core");

/* ------------------- ล็อกอินแล้วแปลงเป็น cookie ------------------- */

/**
 * ใช้ createServerClient ตัวเดียวกับที่แอปใช้ แล้วดักเก็บ cookie ที่มันเขียน
 *
 * ทำแบบนี้แทนการประกอบชื่อ/รูปแบบ cookie เอง เพราะรูปแบบนั้นเป็นรายละเอียด
 * ภายในของ @supabase/ssr ที่เปลี่ยนได้ทุกเวอร์ชัน — ให้ไลบรารีตัวเดียวกับที่
 * แอปอ่าน เป็นคนเขียนให้ จึงตรงกันเสมอโดยไม่ต้องเดา
 */
const captured = [];
const auth = createServerClient(SUPABASE_URL, ANON_KEY, {
  cookies: {
    getAll: () => [],
    setAll: (list) => captured.push(...list),
  },
});

console.log(`ล็อกอินเป็น ${test.TEST_USER_EMAIL} …`);
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: test.TEST_USER_EMAIL,
  password: test.TEST_USER_PASSWORD,   // ห้าม log ค่านี้
});

if (signInError !== null || session?.session == null) {
  fail(`ล็อกอินไม่สำเร็จ: ${signInError?.message ?? "ไม่ได้ session กลับมา"}`);
  process.exit(1);
}
if (captured.length === 0) {
  fail("ล็อกอินผ่านแต่ไม่ได้ cookie — รูปแบบของ @supabase/ssr อาจเปลี่ยน");
  process.exit(1);
}
console.log(`  ได้ cookie ${captured.length} ตัว`);

/* ------------------------------ เทสต์ ------------------------------ */

const origin = new URL(BASE_URL);
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const context = await browser.newContext();

await context.addCookies(
  captured.map(({ name, value }) => ({
    name,
    value,
    domain: origin.hostname,
    path: "/",
    httpOnly: false,
    secure: origin.protocol === "https:",
    sameSite: "Lax",
  })),
);

const page = await context.newPage();
const api = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/api/")) api.push(`${r.method()} ${u.pathname}`);
});

/**
 * ชั้นที่ตอบการค้นหา — ใช้พิสูจน์ว่าไม่ได้ยิงถามขนส่งจริง
 *
 * "memory" / "supabase" = ตอบจาก cache ไม่เสียโควตา
 * "api" = ยิงถามขนส่งจริง ซึ่งเทสต์นี้ห้ามให้เกิด
 */
let trackSource = null;
page.on("response", async (r) => {
  if (!new URL(r.url()).pathname.startsWith("/api/track")) return;
  const body = await r.json().catch(() => null);
  if (body?.source != null) trackSource = body.source;
});

/** ข้อความบนการ์ดของเลขนี้ในหน้าประวัติ — null เมื่อไม่เจอการ์ด */
async function historyCardText() {
  await page.goto(`${BASE_URL}/history`, { waitUntil: "networkidle", timeout: 60000 });
  const card = page.locator("li").filter({ hasText: TRACKING_NUMBER }).first();
  if ((await card.count()) === 0) return null;
  return (await card.innerText()).replace(/\s+/g, " ").trim();
}

let savedId = null;

try {
  /* --- ขั้น 0: ยืนยันว่าล็อกอินติดจริง --- */
  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60000 });
  const loggedIn = await page.getByText("ออกจากระบบ").count();
  if (loggedIn === 0) {
    fail("ใส่ cookie แล้วแต่เว็บยังถือว่าไม่ได้ล็อกอิน");
    throw new Error("not-logged-in");
  }
  console.log("✅ ล็อกอินติดบนเบราว์เซอร์แล้ว");

  /* --- ขั้น 1: บันทึกพัสดุโดยไม่ยิงถามขนส่ง --- */
  await page.locator("#tracking-number").fill(TRACKING_NUMBER);
  await page.locator("#tracking-nickname").fill("อีทูอีทดสอบ");
  api.length = 0;
  await page.getByRole("button", { name: "บันทึกไว้" }).click();
  await page.waitForTimeout(3000);

  if (api.some((c) => c.includes("/api/track"))) {
    fail(`ปุ่ม "บันทึกไว้" ไม่ควรยิง /api/track แต่ยิง: ${api.join(", ")}`);
  }
  console.log(`✅ บันทึกแล้ว (ยิง: ${api.join(", ") || "ไม่มี"})`);

  // เก็บ id ไว้ลบทีหลัง — ใช้ API เดียวกับที่หน้าเว็บใช้ ผ่าน session ของผู้ใช้
  savedId = await page.evaluate(async (no) => {
    const res = await fetch(`/api/saved?trackingNumber=${encodeURIComponent(no)}`);
    const body = await res.json().catch(() => null);
    return body?.data?.id ?? null;
  }, TRACKING_NUMBER);

  if (savedId === null) {
    fail("บันทึกแล้วแต่หาแถวไม่เจอ");
    throw new Error("no-row");
  }

  /* --- ขั้น 2: หน้าประวัติต้องขึ้น "รอค้นหา" --- */
  const before = await historyCardText();
  if (before === null) {
    fail("ไม่เจอการ์ดในหน้าประวัติ");
    throw new Error("no-card");
  }
  console.log(`\nสถานะก่อนค้นหา : ${before.slice(0, 90)}`);

  if (!before.includes("รอค้นหา")) {
    fail(`คาดว่าจะเห็น "รอค้นหา" แต่เห็น: ${before.slice(0, 120)}`);
  }

  /* --- ขั้น 3: ค้นหาเลขเดิมที่หน้าแรก --- */
  api.length = 0;
  await page.goto(`${BASE_URL}/?track=${encodeURIComponent(TRACKING_NUMBER)}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(6000);

  const searchText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const STATUSES = ["ส่งถึงแล้ว", "อยู่ระหว่างขนส่ง", "กำลังนำจ่าย", "รอรับเข้าระบบ", "พัสดุมีปัญหา"];
  const searched = STATUSES.find((s) => searchText.includes(s));

  if (searched === undefined) {
    fail(`ค้นหาแล้วไม่เห็นสถานะใดๆ (ยิง: ${api.join(", ")})`);
    throw new Error("no-status");
  }
  console.log(`สถานะจากการค้นหา: ${searched}   (ยิง: ${api.join(", ")})`);

  // ข้อบังคับ: ห้ามเผาโควตา — คำตอบต้องมาจาก cache เท่านั้น
  if (trackSource === "api") {
    fail(
      `การค้นหายิงถามขนส่งจริง (source=api) — ต้องใช้เลขที่อยู่ใน cache แล้วเท่านั้น`,
    );
  } else {
    console.log(`ชั้นที่ตอบ      : ${trackSource ?? "(ไม่ทราบ)"} → ไม่ได้ยิงถามขนส่งจริง ✅`);
  }

  /* --- ขั้น 4: กลับหน้าประวัติ สถานะต้องตามมา --- */
  const after = await historyCardText();
  console.log(`สถานะหลังค้นหา : ${after?.slice(0, 90)}`);

  console.log("\n────────────────────────────────────");
  if (after !== null && after.includes(searched)) {
    console.log(`✅ ผ่าน — หน้าประวัติอัปเดตเป็น "${searched}" ตามผลค้นหาแล้ว`);
  } else {
    fail(
      `หน้าประวัติไม่อัปเดต — คาดว่าจะเห็น "${searched}" แต่การ์ดยังเป็น:\n   ${after?.slice(0, 160)}`,
    );
  }
} catch (cause) {
  if (!["not-logged-in", "no-row", "no-card", "no-status"].includes(cause?.message)) {
    fail(`เทสต์ล้มกลางทาง: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
} finally {
  /* --- เก็บกวาดเสมอ แม้เทสต์ล้มกลางทาง --- */
  if (savedId !== null) {
    const deleted = await page
      .evaluate(async (id) => {
        const res = await fetch(`/api/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
        return res.ok;
      }, savedId)
      .catch(() => false);

    // ยืนยันด้วยการถามซ้ำ ไม่ใช่เชื่อว่าโค้ดลบแล้ว
    const stillThere = await page
      .evaluate(async (no) => {
        const res = await fetch(`/api/saved?trackingNumber=${encodeURIComponent(no)}`);
        const body = await res.json().catch(() => null);
        return body?.data?.id ?? null;
      }, TRACKING_NUMBER)
      .catch(() => "ตรวจไม่ได้");

    if (deleted && stillThere === null) {
      console.log("🧹 ลบรายการทดสอบแล้ว — ยืนยันด้วยการถามซ้ำว่าไม่เหลือแถว ✅");
    } else {
      fail(
        `ลบรายการทดสอบไม่สำเร็จ (deleted=${deleted} ยังเหลือ id=${stillThere}) — ต้องลบเองที่หน้าประวัติ`,
      );
    }
  }

  await browser.close();
}
