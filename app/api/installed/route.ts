/**
 * POST /api/installed — สถิติเกี่ยวกับการติดตั้งแอพ (PWA)
 *
 * รับสองเรื่องที่เป็น funnel เดียวกัน:
 *
 *   { platform }          ติดตั้งสำเร็จจริง (เบราว์เซอร์ยิง appinstalled)
 *   { action, platform, context }  สิ่งที่เกิดกับการ์ดชวนติดตั้ง (shown/dismissed/clicked)
 *                                  context = ผู้ใช้เพิ่งค้นเจอ หรือค้นไม่เจอ
 *
 * อยู่ endpoint เดียวกันเพราะเป็นเรื่องเดียวกันและมีกติกาความเป็นส่วนตัวชุดเดียวกัน
 * แต่ลงคนละตารางโดยตั้งใจ — install_events ต้องคงความหมายเดิมไว้เป๊ะๆ ว่าคือ
 * "จำนวนการติดตั้งสำเร็จ" (ดู supabase/migrations/0013_install_prompt_events.sql)
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

import { PLATFORMS } from "@/lib/platform";
import {
  recordInstallEvent,
  recordInstallPromptEvent,
  type InstallPromptAction,
} from "@/lib/supabase/search-events";

/** ต้องรันบน Node.js runtime เพราะเขียนฐานข้อมูลด้วย service role */
export const runtime = "nodejs";

/** ชุดปิด — ตรงกับ constraint ของตาราง ค่าอื่นถูกทิ้ง ไม่ใช่เก็บดิบ */
const ACTIONS: ReadonlySet<string> = new Set(["shown", "dismissed", "clicked"]);

/**
 * บริบทของการค้นที่ทำให้การ์ดขึ้น — ชุดปิดเหมือนกัน
 *
 * ค่าที่ไม่รู้จักกลายเป็น "found" ซึ่งเป็นค่าเดิมก่อนมีฟิลด์นี้ · เบราว์เซอร์
 * รุ่นที่ยัง cache โค้ดเก่าไว้จึงยังส่งข้อมูลที่นับรวมได้ ไม่ใช่ถูกทิ้ง
 */
const CONTEXTS: ReadonlySet<string> = new Set(["found", "not_found"]);

export async function POST(request: Request) {
  let platform = "unknown";
  let action: InstallPromptAction | null = null;
  let context = "found";

  try {
    const body: unknown = await request.json();
    const fields =
      typeof body === "object" && body !== null
        ? (body as { platform?: unknown; action?: unknown; context?: unknown })
        : {};

    if (typeof fields.platform === "string" && PLATFORMS.has(fields.platform)) {
      platform = fields.platform;
    }
    if (typeof fields.action === "string" && ACTIONS.has(fields.action)) {
      action = fields.action as InstallPromptAction;
    }
    if (typeof fields.context === "string" && CONTEXTS.has(fields.context)) {
      context = fields.context;
    }
  } catch {
    // ไม่มี body หรือ body พัง → ยังนับเป็นการติดตั้งหนึ่งครั้ง แค่ไม่รู้ platform
  }

  if (action === null) await recordInstallEvent(platform);
  else await recordInstallPromptEvent(action, platform, context);

  // ไม่ต้องบอกอะไรกลับไป ฝั่งเบราว์เซอร์ไม่ได้ใช้คำตอบนี้ทำอะไรต่อ
  return new NextResponse(null, { status: 204 });
}
