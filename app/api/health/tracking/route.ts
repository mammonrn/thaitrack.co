/**
 * GET /api/health/tracking — "เว็บทำงานแต่ตอบได้จริงไหม"
 *
 * ให้ uptime monitor ที่มีอยู่แล้วยิงถามเป็นระยะ แล้วอ่านผลจาก HTTP status:
 *
 *   200  ปกติ
 *   503  ผิดปกติ — monitor เดิมแจ้งเตือนให้เองโดยไม่ต้องเพิ่มบริการใหม่
 *
 * ------------------------------------------------------------------
 * ⚠️ ทำไมคำตอบไม่มีตัวเลขเลย
 *
 * endpoint นี้ต้องเปิดสาธารณะ เพราะ monitor ล็อกอินไม่ได้ ถ้าใส่ยอดค้นหาหรือ
 * ยอดโควตาลงไปในคำตอบ ใครก็ตามที่เดา URL เจอจะรู้ปริมาณธุรกิจของเราทันที
 * ตัวเลขทั้งหมดจึงถูกใช้ตัดสิน 200/503 แล้วทิ้งไป ส่วนรายละเอียดไปอยู่ใน log
 * ฝั่งเซิร์ฟเวอร์ซึ่งมีแต่เจ้าของเว็บเข้าถึงได้
 *
 * reason ที่ส่งกลับไปเป็นคำกว้างๆ พอให้รู้ว่าควรเปิดดูอะไรต่อ ("โควตาใกล้เต็ม"
 * กับ "ค้นไม่เจอเยอะผิดปกติ" แก้คนละทางกันสิ้นเชิง) แต่ไม่บอกว่าเท่าไร
 * ------------------------------------------------------------------
 */

import { NextResponse } from "next/server";

import {
  healthLogLine,
  judgeHealth,
  providersNearQuota,
  readWindowMinutes,
} from "@/lib/health-check";
import { loadProviderUsage } from "@/lib/provider-usage";
import { readHealthSnapshot } from "@/lib/supabase/search-events";

/** ต้องรันบน Node.js runtime เพราะอ่าน env และคุยกับ Supabase ด้วย service role */
export const runtime = "nodejs";
/** ห้าม cache — คำตอบที่ค้างอยู่คือคำตอบที่บอกว่า "ปกติ" ทั้งที่พังไปแล้ว */
export const dynamic = "force-dynamic";

export async function GET() {
  // ยอดโควตาใน memory เป็นศูนย์หลัง restart ต้องอ่านของจริงก่อนตัดสิน
  // ไม่งั้น endpoint นี้จะรายงานว่าโควตายังว่างทุกครั้งที่เพิ่ง deploy เสร็จ
  await loadProviderUsage();

  const snapshot = await readHealthSnapshot(readWindowMinutes());
  const nearQuota = providersNearQuota();
  const verdict = judgeHealth(snapshot, nearQuota);

  // log ทุกครั้งที่ผิดปกติเท่านั้น — ถ้า log ทุกครั้งที่ monitor ยิง (ทุก 5 นาที
  // ตลอด 24 ชม.) บรรทัดที่สำคัญจริงจะจมหายไปในบรรทัดที่บอกว่าทุกอย่างปกติดี
  if (!verdict.ok) {
    console.warn(healthLogLine(verdict, snapshot, nearQuota));
  }

  return NextResponse.json(
    verdict.ok
      ? { status: "ok" as const }
      : { status: "degraded" as const, reason: verdict.reason },
    {
      status: verdict.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
