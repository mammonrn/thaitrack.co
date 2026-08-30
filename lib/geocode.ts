/**
 * แปลงข้อความสถานที่เป็นพิกัด ด้วย Google Geocoding API
 *
 * ใช้ฝั่ง server เท่านั้น เพราะ API key ต้องไม่หลุดไปถึงเบราว์เซอร์ จึงอ่านจาก
 * GOOGLE_MAPS_API_KEY (ไม่ใช่ NEXT_PUBLIC_ ที่จะถูกฝังลงไฟล์ JS ตอน build)
 *
 * เรียกเฉพาะตอนบันทึกประวัติเท่านั้น แล้วเก็บพิกัดลงฐานข้อมูลไปเลย หน้าประวัติ
 * จึงอ่านพิกัดจากฐานข้อมูลได้ตรงๆ ไม่ต้องยิงถาม Google ซ้ำทุกครั้งที่แสดงผล
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

/** สั้นกว่า timeout ของ reverse proxy มาก เพราะการบันทึกต้องไม่ค้างรอ Google */
const TIMEOUT_MS = 6000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * คืนพิกัด หรือ null เมื่อหาไม่ได้
 *
 * ฟังก์ชันนี้ห้ามโยน error ออกไปเด็ดขาด เพราะการหาพิกัดไม่สำเร็จต้องไม่ทำให้
 * การบันทึกประวัติทั้งรายการล้มเหลว ข้อความสถานที่จากขนส่งหลายอันคลุมเครือ
 * เกินกว่าจะหาพิกัดได้อยู่แล้ว (เช่น "ศูนย์คัดแยก") ถือเป็นเรื่องปกติ
 */
export async function geocodeLocation(
  locationText: string,
): Promise<Coordinates | null> {
  const address = locationText.trim();
  if (address === "") return null;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
  if (apiKey === "") {
    console.error("[geocode] ไม่ได้ตั้ง GOOGLE_MAPS_API_KEY จึงข้ามการหาพิกัด");
    return null;
  }

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  // จำกัดผลลัพธ์ไว้ในไทยและขอชื่อภาษาไทย เพราะข้อความสถานที่จากขนส่งเป็นชื่อไทย
  // ล้วน ถ้าไม่จำกัด คำอย่าง "บางรัก" อาจไปเจอสถานที่ชื่อคล้ายกันในประเทศอื่น
  url.searchParams.set("components", "country:TH");
  url.searchParams.set("language", "th");

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[geocode] HTTP ${response.status} สำหรับ "${address}"`);
      return null;
    }

    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;

    const { status, results, error_message: errorMessage } = payload as {
      status?: unknown;
      results?: unknown;
      error_message?: unknown;
    };

    // ZERO_RESULTS คือหาไม่เจอ ถือเป็นเรื่องปกติ ไม่ต้อง log ให้รก
    // ส่วนสถานะอื่น (REQUEST_DENIED, OVER_QUERY_LIMIT) เป็นปัญหาการตั้งค่าที่
    // ผู้ดูแลระบบต้องรู้ — ห้าม log ตัว url เพราะมี API key อยู่ในนั้น
    if (status !== "OK") {
      if (status !== "ZERO_RESULTS") {
        console.error(
          `[geocode] Google ตอบ ${String(status)}` +
            (typeof errorMessage === "string" ? `: ${errorMessage}` : ""),
        );
      }
      return null;
    }

    if (!Array.isArray(results) || results.length === 0) return null;

    const location = (
      results[0] as { geometry?: { location?: { lat?: unknown; lng?: unknown } } }
    )?.geometry?.location;

    if (!isFiniteNumber(location?.lat) || !isFiniteNumber(location?.lng)) {
      return null;
    }

    return { lat: location.lat, lng: location.lng };
  } catch (error) {
    console.error(
      `[geocode] หาพิกัดของ "${address}" ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
