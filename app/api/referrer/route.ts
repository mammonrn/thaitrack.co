/**
 * POST /api/referrer — มีคนเข้าเว็บจากช่องทางนี้เพิ่มหนึ่งครั้ง
 *
 * ⚠️ รับได้แค่คำเดียวจากชุดปิด ({ "channel": "google" }) ไม่มีอย่างอื่นเลย
 * ฝั่งเบราว์เซอร์จำแนกมาให้แล้ว (ดู lib/referrer-channel.ts) เซิร์ฟเวอร์จึงไม่
 * เคยเห็น URL ต้นทาง และไม่มีอะไรให้เผลอเก็บติดไปด้วย
 *
 * ไม่ต้องล็อกอิน จึงยิงปลอมได้เหมือน /api/installed — ตัวเลขนี้เป็น
 * "อย่างมากเท่านี้" ใช้ตัดสินใจภายในว่าควรลงแรงที่ช่องทางไหน ไม่ใช่ตัวเลข
 * ที่ใครได้ประโยชน์จากการปลอม
 */

import { NextResponse } from "next/server";

import {
  REFERRER_CHANNELS,
  type ReferrerChannel,
} from "@/lib/referrer-channel";
import { recordReferrerVisit } from "@/lib/supabase/referrer";

/** ต้องรันบน Node.js runtime เพราะเขียนฐานข้อมูลด้วย service role */
export const runtime = "nodejs";

const CHANNELS: ReadonlySet<string> = new Set(REFERRER_CHANNELS);

export async function POST(request: Request) {
  let channel: ReferrerChannel | null = null;

  try {
    const body: unknown = await request.json();
    const value =
      typeof body === "object" && body !== null
        ? (body as { channel?: unknown }).channel
        : undefined;

    if (typeof value === "string" && CHANNELS.has(value)) {
      channel = value as ReferrerChannel;
    }
  } catch {
    // body พังหรือไม่มี → ไม่นับ ดีกว่าเดาว่าเป็นช่องทางไหน
  }

  // ค่าที่ไม่อยู่ในชุดปิดถูกทิ้งเงียบๆ ไม่ตอบ error — ฝั่งเบราว์เซอร์ไม่ได้ใช้
  // คำตอบทำอะไรต่อ และการตอบ error จะทำให้ log เต็มไปด้วยเรื่องที่ไม่ต้องแก้
  if (channel !== null) await recordReferrerVisit(channel);

  return new NextResponse(null, { status: 204 });
}
