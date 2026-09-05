/**
 * แปลงข้อความสถานที่เป็นพิกัด ด้วย Google Geocoding API
 *
 * ใช้ฝั่ง server เท่านั้น เพราะ API key ต้องไม่หลุดไปถึงเบราว์เซอร์ จึงอ่านจาก
 * GOOGLE_MAPS_API_KEY (ไม่ใช่ NEXT_PUBLIC_ ที่จะถูกฝังลงไฟล์ JS ตอน build)
 *
 * เรียกเฉพาะตอนบันทึกประวัติเท่านั้น แล้วเก็บพิกัดลงฐานข้อมูลไปเลย หน้าประวัติ
 * จึงอ่านพิกัดจากฐานข้อมูลได้ตรงๆ ไม่ต้องยิงถาม Google ซ้ำทุกครั้งที่แสดงผล
 *
 * ⚠️ ไฟล์นี้ไม่ได้คืนแค่พิกัด แต่คืน **ผลการวัดว่าพิกัดนั้นละเอียดแค่ไหน** ด้วย
 * เพราะหลักการของทั้งระบบคือ "เมื่อไม่แน่ใจ ห้ามปักหมุด" — และการจะรู้ว่าแน่ใจ
 * หรือไม่ ต้องวัดได้ ไม่ใช่เดาจากชนิดของคำตอบ (ดู GeocodePrecision)
 */

import { countProviderCall } from "./provider-usage";

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * geometry.location_type ดิบของ Google — เก็บไว้เพื่อวินิจฉัยเท่านั้น
 *
 * ⚠️ **ห้ามใช้ค่านี้ตัดสินว่าพิกัดดีพอหรือไม่** เคยใช้แล้วและพังมาแล้ว:
 * มันบอกแค่ *วิธี* ที่ Google ได้พิกัดมา ไม่ได้บอก *ขนาด* ของสิ่งที่มันจับได้
 * GEOMETRIC_CENTER เป็นได้ทั้ง "กลางถนนซอยหนึ่ง" และ "กลางตำบล" ส่วน
 * APPROXIMATE เป็นได้ทั้งตำบลและทั้งจังหวัด
 *
 * ตัวที่ใช้ตัดสินจริงคือ accuracyMeters กับ areaOnly ข้างล่าง
 */
export type GeocodePrecision = "rooftop" | "range" | "center" | "approximate";

/** ผลการหาพิกัดหนึ่งครั้ง พร้อมสิ่งที่บอกได้ว่าละเอียดแค่ไหน */
export interface GeocodeHit {
  coordinates: Coordinates;
  precision: GeocodePrecision;
  /**
   * รัศมีความคลาดเคลื่อนโดยประมาณ (เมตร) — ครึ่งเส้นทแยงมุมของ viewport
   *
   * นี่คือตัววัด "ขนาดของสิ่งที่ Google จับได้" ซึ่งเทียบกันได้ตรงๆ
   * บ้านเลขที่ราว 100 ม. · ตำบลราว 3–8 กม. · อำเภอ 15–40 กม. · จังหวัด 50 กม.+
   */
  accuracyMeters: number;
  /**
   * true = ผลลัพธ์เป็น "พื้นที่" ไม่ใช่ "จุด" ห้ามเอาไปปักหมุดไม่ว่าขนาดจะเท่าไร
   *
   * มาจากสองสัญญาณที่เด็ดขาดกว่าขนาด: types ของผลลัพธ์เป็นเขตปกครองระดับ
   * อำเภอขึ้นไป หรือ Google บอกเองว่า partial_match (จับได้ไม่ครบ ต้องเดา)
   */
  areaOnly: boolean;
}

/**
 * ชั้นความละเอียดที่ระบบใช้ตัดสินใจ
 *
 * แยก approximate กับ coarse ออกจากกันเพราะถ้อยคำที่บอกผู้ใช้ต้องต่างกัน —
 * ความคลาดเคลื่อน 200 ม. กับ 8 กม. ใช้ประโยคเดียวกันไม่ได้ ป้ายรุ่นแรกเขียนว่า
 * "ระดับตำบล" ซึ่งคนอ่านแล้วนึกถึงไม่กี่ร้อยเมตร แต่ตำบลในต่างจังหวัดกว้างได้
 * ถึง 8 กม. จริง (วัดจากข้อมูลจริงของ ตำบลบ้านดู่ เชียงราย)
 */
export type LocationAccuracy =
  /** แม่นพอจะบอกว่า "อยู่ตรงนี้" — ปักหมุดได้ตามปกติ ไม่ต้องขึ้นป้าย */
  | "exact"
  /** คลาดเคลื่อนได้ราวหนึ่งกิโลเมตร — ปักหมุดได้ แต่ต้องบอกผู้ใช้ */
  | "approximate"
  /** คลาดเคลื่อนได้หลายกิโลเมตร — ปักหมุดได้ แต่ต้องบอกให้ชัดกว่านั้นอีก */
  | "coarse"
  /**
   * ไม่ใช่ "จุด" แต่เป็น "พื้นที่" — ห้ามปักหมุด ไม่ว่ากรอบจะเล็กแค่ไหน
   *
   * ⚠️ ชั้นนี้มาจาก areaOnly **ทางเดียวเท่านั้น** (types[] เป็นเขตปกครองระดับ
   * อำเภอขึ้นไป หรือ Google บอกเองว่า partial_match) ไม่ได้มาจากขนาดอีกต่อไป
   * — พิกัดที่อยู่ไกลแค่ไหนก็ยังปักหมุดได้ ขอแค่ติดป้ายบอกความคลาดเคลื่อน
   */
  | "area";

/**
 * ละเอียดกว่านี้ถือว่า "จุด" ไม่ต้องขึ้นป้ายเตือน
 *
 * 150 ม. ครอบคลุมบ้านเลขที่กับหัวมุมถนนได้สบาย แต่แคบพอที่หมู่บ้านทั้งหมู่บ้าน
 * จะไม่ผ่าน ค่านี้ไม่เปิดให้ปรับ เพราะมันคือนิยามของคำว่า "เป๊ะ" ไม่ใช่ policy
 */
export const EXACT_MAX_METERS = 150;

/**
 * ขอบบนของชั้น approximate — เกินนี้ถ้อยคำต้องเปลี่ยนเป็น "หลายกิโลเมตร"
 *
 * ไม่เปิดให้ปรับผ่าน env เพราะมันคือเส้นแบ่งของ **ถ้อยคำ** ว่าจะบอกผู้ใช้ว่า
 * "ราว 1 กม." หรือ "หลายกิโลเมตร" ไม่ใช่ policy ว่าจะรับพิกัดแค่ไหน
 *
 * ตั้งแต่ตัดเพดานระยะทางทิ้ง เส้นแบ่งทุกเส้นในไฟล์นี้เป็นเรื่องถ้อยคำล้วนๆ
 * ไม่มีเส้นไหนตัดสินว่า "ปักหรือไม่ปัก" อีกแล้ว — ตัวที่ตัดสินเหลือ areaOnly
 * ตัวเดียว ซึ่งเป็นเรื่องคุณภาพของ geocode ไม่ใช่ระยะทาง
 */
export const APPROXIMATE_MAX_METERS = 1_000;

/*
 * ------------------------------------------------------------------
 * เคยมีเพดานระยะทาง (GEOCODE_MAX_ACCURACY_METERS ค่าเริ่มต้น 12 กม.) ตรงนี้
 * เกินเพดานแล้วไม่ปักหมุดเลย — **ตัดทิ้งแล้ว** เจตนาคือ "มีพิกัดที่ผ่านด่าน
 * คุณภาพเมื่อไร ก็โชว์เมื่อนั้น ไกลแค่ไหนก็โชว์" ให้เท่ากับที่ ThaiEMS ทำ
 *
 * เหตุผลที่ตัดได้โดยไม่เปิดบั๊กหมุดกลางอำเภอกลับมา: ตัวที่กันบั๊กนั้นคือด่าน
 * types[] (AREA_TYPES ข้างล่าง) ไม่ใช่เพดานนี้ เขตปกครองถูกปฏิเสธด้วย
 * **ชนิด**ของผลลัพธ์ไปแล้วไม่ว่ากรอบจะเล็กหรือใหญ่แค่ไหน เพดานเป็นแค่ตาข่าย
 * ชั้นสองที่ซ้อนอยู่เฉยๆ
 *
 * ยืนยันด้วยข้อมูลจริงก่อนตัด: ทุกครั้งที่ระบบปฏิเสธพิกัดใน production
 * ปฏิเสธด้วย areaOnly=true ที่ radius 82 ม. กับ 209 ม. — ต่ำกว่าเพดาน 12 กม.
 * หลายสิบเท่า เพดานนี้จึงไม่เคยเป็นตัวบล็อกอะไรเลยสักครั้ง
 *
 * ผลของการตัด: ระยะทางไม่ตัดสิน "ปักหรือไม่ปัก" อีกต่อไป มันเหลือหน้าที่เดียว
 * คือเลือก **ถ้อยคำ**บนป้าย (เกิน 150 ม. ต้องมีป้ายเสมอ) และเลือกระดับซูมของ
 * ภาพแผนที่ (ดู ZOOM_BY_ACCURACY ใน app/api/map/route.ts)
 * ------------------------------------------------------------------
 */

/**
 * types ที่แปลว่า "นี่คือเขตปกครอง ไม่ใช่สถานที่"
 *
 * ปฏิเสธเด็ดขาดไม่ว่า viewport จะเล็กแค่ไหน — อำเภอเล็กๆ ที่ viewport บังเอิญ
 * ต่ำกว่าเพดานก็ยังเป็นอำเภอ จุดกึ่งกลางของมันไม่ใช่ที่ตั้งของอะไรทั้งนั้น
 *
 * ตั้งใจไม่ใส่ locality กับ postal_code เพราะสองอันนั้นเล็กใหญ่ต่างกันมาก
 * แล้วแต่พื้นที่ ปล่อยให้เพดานขนาดเป็นคนตัดสินตามจริงดีกว่า
 */
const AREA_TYPES: ReadonlySet<string> = new Set([
  "country",
  "administrative_area_level_1",
  "administrative_area_level_2",
]);

/** geometry.location_type ของ Google → คำที่เราใช้ */
const PRECISION_MAP: Record<string, GeocodePrecision> = {
  ROOFTOP: "rooftop",
  RANGE_INTERPOLATED: "range",
  GEOMETRIC_CENTER: "center",
  APPROXIMATE: "approximate",
};

/**
 * ตัดสินชั้นความละเอียดจากผลการวัด — ฟังก์ชันบริสุทธิ์
 *
 * ใช้ทั้งกับผลที่เพิ่งถาม Google มาและกับแถวที่อ่านจาก cache ชั้นถูกคำนวณสด
 * ทุกครั้งที่อ่าน ไม่ได้เก็บคำตัดสินลงฐานข้อมูล (ดู migration 0008) การแก้
 * กติกาในฟังก์ชันนี้จึงมีผลกับของที่ cache ไว้แล้วทันที ไม่ต้องล้าง cache
 * และไม่ต้องยิงถาม Google ใหม่ — รวมถึงการตัดเพดานครั้งนี้ด้วย
 *
 * ⚠️ **ระยะทางไม่คืน "area" อีกต่อไป** ไกลแค่ไหนก็หยุดที่ coarse ซึ่งปักหมุด
 * ได้พร้อมป้าย ทางเดียวที่จะได้ "area" คือ areaOnly === true ซึ่งเป็นคำตอบ
 * ของคำถามคนละข้อ: "นี่เป็นจุดหรือเป็นพื้นที่" ไม่ใช่ "อยู่ไกลแค่ไหน"
 *
 * accuracyMeters เป็น null = แถวเก่าที่บันทึกก่อนมีคอลัมน์นี้ ถือว่า "ไม่รู้"
 * ซึ่งได้ coarse — ปักหมุดได้แต่ใช้ถ้อยคำที่คลุมเครือที่สุด การเดาว่าแม่นคือ
 * การรับรองสิ่งที่เราไม่รู้
 */
export function classifyAccuracy(input: {
  accuracyMeters: number | null;
  areaOnly: boolean | null;
}): LocationAccuracy {
  if (input.areaOnly === true) return "area";
  if (input.accuracyMeters === null) return "coarse";
  if (input.accuracyMeters <= EXACT_MAX_METERS) return "exact";
  return input.accuracyMeters <= APPROXIMATE_MAX_METERS
    ? "approximate"
    : "coarse";
}

/** หนึ่งองศาละติจูดเป็นเมตร (ค่าเฉลี่ยทั้งโลก คลาดเคลื่อนไม่ถึง 0.5%) */
const METERS_PER_DEGREE = 111_320;

interface Viewport {
  northeast?: { lat?: unknown; lng?: unknown };
  southwest?: { lat?: unknown; lng?: unknown };
}

/**
 * ครึ่งเส้นทแยงมุมของกรอบที่ Google คืนมา หน่วยเมตร
 *
 * ใช้สูตรแบน (equirectangular) พอ เพราะกรอบพวกนี้เล็กเมื่อเทียบกับโลก และเรา
 * ต้องการแค่ลำดับขนาดเพื่อเทียบกับเพดาน ไม่ได้ต้องการระยะทางที่แม่นถึงเมตร
 *
 * อ่านกรอบไม่ได้ → คืนค่าที่แปลว่า "ใหญ่มาก" ไม่ใช่ 0 เพราะการเดาว่าเล็ก
 * แปลว่าเรารับรองความแม่นที่ไม่เคยวัด
 */
export function viewportRadiusMeters(viewport: unknown): number {
  const box = (viewport ?? {}) as Viewport;
  const { northeast: ne, southwest: sw } = box;

  const values = [ne?.lat, ne?.lng, sw?.lat, sw?.lng];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return Number.POSITIVE_INFINITY;
  }

  const [neLat, neLng, swLat, swLng] = values as number[];

  const latSpan = Math.abs(neLat - swLat) * METERS_PER_DEGREE;
  const midLat = ((neLat + swLat) / 2) * (Math.PI / 180);
  const lngSpan =
    Math.abs(neLng - swLng) * METERS_PER_DEGREE * Math.cos(midLat);

  return Math.hypot(latSpan, lngSpan) / 2;
}

/** ผลลัพธ์นี้เป็น "พื้นที่" ไม่ใช่ "จุด" หรือไม่ */
export function isAreaResult(input: {
  types: unknown;
  partialMatch: unknown;
}): boolean {
  if (input.partialMatch === true) return true;
  if (!Array.isArray(input.types)) return false;
  return input.types.some(
    (type) => typeof type === "string" && AREA_TYPES.has(type),
  );
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
  return (await geocodeAddress(locationText))?.coordinates ?? null;
}

/**
 * เหมือน geocodeLocation แต่บอกความละเอียดของผลลัพธ์มาด้วย
 *
 * ห้ามโยน error ด้วยเหตุผลเดียวกัน
 */
export async function geocodeAddress(
  locationText: string,
): Promise<GeocodeHit | null> {
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

    const top = results[0] as {
      geometry?: {
        location?: { lat?: unknown; lng?: unknown };
        location_type?: unknown;
        viewport?: unknown;
        bounds?: unknown;
      };
      types?: unknown;
      partial_match?: unknown;
    };

    const location = top.geometry?.location;
    if (!isFiniteNumber(location?.lat) || !isFiniteNumber(location?.lng)) {
      return null;
    }

    // bounds คือขอบเขตจริงของสิ่งที่จับได้ ส่วน viewport คือกรอบที่แนะนำให้
    // แสดงผล ซึ่งมักกว้างกว่าเล็กน้อย ใช้ bounds ก่อนถ้ามี จะได้ไม่ตัดสินว่า
    // หยาบทั้งที่ Google แค่เผื่อขอบให้ดูสวย
    const box = top.geometry?.bounds ?? top.geometry?.viewport;

    return {
      coordinates: { lat: location.lat, lng: location.lng },
      // ไม่รู้จักค่าที่ส่งมา → ถือว่าหยาบที่สุดไว้ก่อน ปลอดภัยกว่าเดาว่าแม่น
      precision:
        PRECISION_MAP[String(top.geometry?.location_type ?? "")] ?? "approximate",
      accuracyMeters: viewportRadiusMeters(box),
      areaOnly: isAreaResult({
        types: top.types,
        partialMatch: top.partial_match,
      }),
    };
  } catch (error) {
    console.error(
      `[geocode] หาพิกัดของ "${address}" ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
