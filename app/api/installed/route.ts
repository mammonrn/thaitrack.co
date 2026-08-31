/**
 * POST /api/installed — มีคนติดตั้งแอพ (PWA) เพิ่มหนึ่งครั้ง
 *
 * เบราว์เซอร์ยิง event `appinstalled` ครั้งเดียวต่อการติดตั้งหนึ่งครั้ง ซึ่งเป็น
 * สัญญาณเดียวที่บอกจำนวนการติดตั้งได้จริง (การเช็ค display-mode ตอนเปิดหน้าจะนับ
 * ซ้ำทุกครั้งที่เปิดแอพ ซึ่งเป็นคนละตัวเลข)
 *
 * ⚠️ ไม่ต้องล็อกอินและไม่เก็บอะไรที่ระบุตัวคนได้เลย — ไม่มี user id ไม่มี IP
 * ไม่มี user agent เต็ม เก็บแค่ platform กว้างๆ ที่ฝั่งแอปแปลงมาให้แล้ว
 *
 * ผลของการไม่ต้องล็อกอินคือยิงปลอมได้ ตัวเลขนี้จึงเป็น "อย่างมากเท่านี้"
 * ยอมรับได้เพราะเป็นตัวเลขสำหรับตัดสินใจภายใน ไม่ใช่ตัวเลขที่ใครได้ประโยชน์
 * จากการปลอม และการบังคับล็อกอินจะทำให้นับพลาดคนส่วนใหญ่ที่ติดตั้งโดยไม่ล็อกอิน
 */

import { NextResponse } from "next/server";

import { recordInstallEvent } from "@/lib/supabase/search-events";

/** ต้องรันบน Node.js runtime เพราะเขียนฐานข้อมูลด้วย service role */
export const runtime = "nodejs";

/** ชุดปิด — ค่าอื่นกลายเป็น unknown ไม่ใช่ถูกเก็บดิบ */
const PLATFORMS: ReadonlySet<string> = new Set(["android", "ios", "desktop"]);

export async function POST(request: Request) {
  let platform = "unknown";

  try {
    const body: unknown = await request.json();
    const value =
      typeof body === "object" && body !== null
        ? (body as { platform?: unknown }).platform
        : undefined;

    if (typeof value === "string" && PLATFORMS.has(value)) platform = value;
  } catch {
    // ไม่มี body หรือ body พัง → ยังนับเป็นการติดตั้งหนึ่งครั้ง แค่ไม่รู้ platform
  }

  await recordInstallEvent(platform);

  // ไม่ต้องบอกอะไรกลับไป ฝั่งเบราว์เซอร์ไม่ได้ใช้คำตอบนี้ทำอะไรต่อ
  return new NextResponse(null, { status: 204 });
}
