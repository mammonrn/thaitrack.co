/**
 * GET /api/map?lat=..&lng=.. — ภาพแผนที่นิ่งหนึ่งรูป
 *
 * แทนที่ Google Maps Embed API (iframe) ด้วยสองเหตุผล:
 *
 *   1. Embed เป็นแผนที่โต้ตอบได้ ผู้ใช้ลาก/ซูม/กดเข้า Google Maps ได้ ซึ่งเกิน
 *      ความจำเป็น — สิ่งที่ต้องการคือ "พัสดุอยู่แถวนี้" ภาพเดียวจบ
 *   2. Embed บังคับให้ใส่ API key ลงใน URL ของ iframe ซึ่งผู้ใช้เปิดดู source
 *      เห็นได้เสมอ จึงต้องใช้คีย์แยกที่จำกัดด้วย HTTP referrer มาตลอด
 *
 * ที่นี่เซิร์ฟเวอร์เป็นคนยิงไปหา Google แล้วส่งภาพต่อให้เบราว์เซอร์ คีย์จึงไม่
 * เคยออกจากเครื่องเรา ใช้ GOOGLE_MAPS_API_KEY ตัวเดียวกับที่ใช้ geocode ได้เลย
 * (จำกัดด้วย IP อยู่แล้ว) ส่วน GOOGLE_MAPS_EMBED_KEY ไม่จำเป็นอีกต่อไป
 *
 * ⚠️ ต้องเปิด "Maps Static API" ใน Google Cloud Console ให้คีย์ตัวนี้ด้วย
 * (คนละตัวกับ Geocoding API ที่เปิดไว้แล้ว)
 */

import { NextResponse } from "next/server";

import { checkCoordinates } from "@/lib/coordinates";

/** ต้องรันบน Node.js runtime เพราะอ่าน API key จาก process.env */
export const runtime = "nodejs";

const STATIC_MAP_ENDPOINT = "https://maps.googleapis.com/maps/api/staticmap";

/** สั้นกว่า timeout ของ reverse proxy มาก — รูปแผนที่ต้องไม่ทำให้หน้าค้าง */
const TIMEOUT_MS = 6000;

/**
 * ขนาดกับระดับซูมถูกกำหนดตายตัวฝั่งเซิร์ฟเวอร์ ไม่ให้ client เลือกเอง
 *
 * ถ้าปล่อยให้ส่งมาได้ ใครก็ยิงขอภาพขนาดใหญ่สุดรัวๆ ให้โควตาหมดได้ และการมี
 * ชุดพารามิเตอร์เดียวยังทำให้ทุกคนที่ดูพิกัดเดียวกันได้ URL เดียวกันเป๊ะ
 * ซึ่ง CDN กับเบราว์เซอร์ cache ต่อได้เต็มที่
 */
const MAP_PARAMS = {
  size: "640x288",
  scale: "2",
  maptype: "roadmap",
  language: "th",
  region: "TH",
} as const;

/**
 * ระดับซูมมีสามค่าให้เลือก ไม่ใช่ค่าอิสระ — ยังเป็นชุดปิดเหมือนเดิม
 *
 *   15  พิกัดที่รู้แน่ว่าเป็นจุดไหน (≤ 150 ม.) — เห็นระดับถนน
 *   14  คลาดเคลื่อนได้ราว 1 กม. — เห็นเป็นย่าน
 *   11  คลาดเคลื่อนได้หลายกิโลเมตร — เห็นเป็นอำเภอ
 *
 * การซูมออกไม่ใช่เรื่องความสวยงาม แต่เป็นการพูดความจริง: หมุดที่ z15 สื่อว่า
 * "อยู่ตรงอาคารนี้" ซึ่งเราไม่รู้ ส่วนที่ z11 อ่านได้ว่า "อยู่แถวนี้"
 *
 * z11 เลือกจากการคำนวณจริง: ที่ละติจูดของไทย z11 ได้ราว 72 ม./พิกเซล ภาพสูง
 * 288 พิกเซลจึงครอบราว 10 กม. จากกลางภาพถึงขอบบน — พอดีกับความคลาดเคลื่อน
 * ของ coarse ส่วนใหญ่ โดยที่หมุดยังไม่ลอยอยู่กลางภาพว่างๆ
 *
 * ⚠️ ตั้งแต่ตัดเพดาน 12 กม. ทิ้ง ชั้น coarse ไม่มีขอบบนแล้ว (ดู classifyAccuracy
 * ใน lib/geocode.ts) พิกัดที่คลาด 40 กม. จึงได้ z11 เท่ากับพิกัดที่คลาด 3 กม.
 * ซึ่งซูมเข้าเกินความจริงไปหน่อยสำหรับเคสสุดขั้ว
 *
 * ยอมรับไว้ก่อนโดยตั้งใจ เพราะสิ่งเดียวที่หน้าเว็บรู้คือ "ชั้น" ไม่ใช่ตัวเลข
 * รัศมี (saved_trackings เก็บแค่ last_location_accuracy) การจะซูมตามระยะจริงได้
 * ต้องเก็บตัวเลขเพิ่มซึ่งเป็นการแก้ schema — แยกเป็นงานต่างหากถ้าเจอเคสจริง
 * ป้ายที่ขึ้นคู่กันยังพูดความจริงอยู่ ("คลาดเคลื่อนได้หลายกิโลเมตร")
 */
const ZOOM_BY_ACCURACY: Record<string, string> = {
  approximate: "14",
  coarse: "11",
};
const ZOOM_EXACT = "15";

/**
 * เก็บภาพไว้ที่เบราว์เซอร์และ CDN ได้นาน
 *
 * ภาพของพิกัดเดิมไม่เปลี่ยน (แผนที่ฐานของ Google ขยับปีละไม่กี่ครั้ง) 30 วัน
 * จึงปลอดภัย และ stale-while-revalidate ทำให้ผู้ใช้ไม่ต้องรอโหลดใหม่เลย
 */
const CACHE_CONTROL = "public, max-age=2592000, stale-while-revalidate=86400";

function errorResponse(status: number) {
  // ไม่ตอบเป็น JSON เพราะปลายทางคือ <img> ที่อ่าน body ไม่ได้อยู่แล้ว
  // ตัว status code คือสิ่งเดียวที่มีความหมายตรงนี้
  return new NextResponse(null, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // ตรวจด้วยชุดเดียวกับที่ใช้ตอนบันทึกพิกัด — ค่าที่บันทึกไม่ได้ ก็ไม่ควรวาดได้
  const coordinates = checkCoordinates(params.get("lat"), params.get("lng"));
  if (!coordinates.ok) return errorResponse(400);

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
  if (apiKey === "") {
    console.error("[map] ไม่ได้ตั้ง GOOGLE_MAPS_API_KEY จึงแสดงแผนที่ไม่ได้");
    // 503 ไม่ใช่ 500 — เป็นเรื่องการตั้งค่าที่แก้ได้ ไม่ใช่โค้ดพัง
    return errorResponse(503);
  }

  // รับได้เฉพาะชื่อชั้นที่รู้จัก ไม่ใช่ตัวเลขซูมอิสระ — ชุดพารามิเตอร์จึงยังปิด
  // และจำนวน URL ที่เป็นไปได้ต่อหนึ่งพิกัดมีแค่สาม ซึ่ง cache ต่อได้เหมือนเดิม
  const zoom =
    ZOOM_BY_ACCURACY[params.get("accuracy") ?? ""] ?? ZOOM_EXACT;

  const point = `${coordinates.lat},${coordinates.lng}`;
  const url = new URL(STATIC_MAP_ENDPOINT);
  url.searchParams.set("center", point);
  url.searchParams.set("zoom", zoom);
  for (const [key, value] of Object.entries(MAP_PARAMS)) {
    url.searchParams.set(key, value);
  }
  // หมุดสีเดียวกับตราประทับในธีม (--color-seal) ให้แผนที่กลมกลืนกับหน้าเว็บ
  url.searchParams.set("markers", `color:0xa8342a|${point}`);
  url.searchParams.set("key", apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    // ห้าม log ตัว url เพราะมี API key อยู่ในนั้น
    console.error(
      `[map] เรียก Maps Static API ไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return errorResponse(504);
  }

  if (!upstream.ok) {
    console.error(`[map] Maps Static API ตอบ HTTP ${upstream.status}`);
    return errorResponse(502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  // Google ตอบข้อความอธิบายปัญหาเป็น text/html มาได้เมื่อคีย์ผิดหรือโควตาหมด
  // ถ้าส่งต่อไปตรงๆ เบราว์เซอร์จะแสดงเป็นภาพเสีย จับไว้ตรงนี้ให้เป็น 502 แทน
  if (!contentType.startsWith("image/")) {
    console.error(`[map] Maps Static API ตอบชนิดข้อมูล "${contentType}" ไม่ใช่รูป`);
    return errorResponse(502);
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
