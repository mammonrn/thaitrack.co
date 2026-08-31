/**
 * ตรวจพิกัดก่อนบันทึก — ใช้ร่วมกันทั้งหน้าแอดมินและ API ที่เขียนข้อมูล
 *
 * แยกเป็นฟังก์ชันบริสุทธิ์เพื่อให้ฝั่ง server เรียกได้โดยไม่ต้องเชื่อค่าที่
 * ฝั่ง client ตรวจมาแล้ว — การตรวจที่เบราว์เซอร์เป็นแค่ความสะดวกของผู้กรอก
 * ไม่ใช่การป้องกัน คนที่ยิง API ตรงข้ามหน้าเว็บไปได้ต้องเจอการตรวจชุดเดียวกัน
 */

/** ค่าที่เป็นไปไม่ได้บนโลก — ผิดแน่นอน ปฏิเสธทันที */
export const LAT_RANGE = { min: -90, max: 90 } as const;
export const LNG_RANGE = { min: -180, max: 180 } as const;

/**
 * กรอบคร่าวๆ ของประเทศไทย เผื่อขอบไว้เล็กน้อย
 *
 * เหนือสุด แม่สาย ~20.46 · ใต้สุด เบตง ~5.61
 * ตะวันตกสุด แม่ฮ่องสอน ~97.34 · ตะวันออกสุด อุบลฯ ~105.64
 *
 * ใช้ "เตือน" ไม่ใช่ "ปฏิเสธ" เพราะพัสดุระหว่างประเทศมีจุดพักในต่างประเทศจริง
 * (คลังที่เซินเจิ้น สนามบินสิงคโปร์) การบล็อกไปเลยจะทำให้กรอกพิกัดที่ถูกต้องไม่ได้
 */
export const THAILAND_BOUNDS = {
  minLat: 5.5,
  maxLat: 20.6,
  minLng: 97.2,
  maxLng: 105.8,
} as const;

export type CoordinateError =
  /** ไม่ใช่ตัวเลข หรือเป็น NaN/Infinity */
  | "not_a_number"
  /** อยู่นอกช่วงที่เป็นไปได้บนโลก */
  | "out_of_range";

export type CoordinateCheck =
  | {
      ok: true;
      lat: number;
      lng: number;
      /** true = พิกัดใช้ได้แต่ไม่ได้อยู่ในไทย — บันทึกได้ แต่ควรเตือนผู้กรอก */
      outsideThailand: boolean;
    }
  | { ok: false; reason: CoordinateError };

/** ข้อความไทยของแต่ละสาเหตุ — หน้าแอดมินก็เป็นหน้าที่ต้องอ่านรู้เรื่องเหมือนกัน */
export const COORDINATE_ERROR_TEXT: Record<CoordinateError, string> = {
  not_a_number: "พิกัดต้องเป็นตัวเลข เช่น 19.9105 และ 99.8406",
  out_of_range: "พิกัดอยู่นอกช่วงที่เป็นไปได้ (ละติจูด -90 ถึง 90, ลองจิจูด -180 ถึง 180)",
};

export const OUTSIDE_THAILAND_WARNING =
  "พิกัดนี้อยู่นอกประเทศไทย ถ้าเป็นสาขาในไทย ให้ตรวจว่ากรอกตกหรือเกินหลักไปหรือไม่";

/**
 * แปลงค่าที่รับมาเป็นตัวเลข — รับได้ทั้ง number และ string จากฟอร์ม
 *
 * ปฏิเสธสตริงว่างและค่าที่แปลงแล้วได้ NaN อย่างชัดเจน ไม่ใช้ Number() เดี่ยวๆ
 * เพราะ Number("") คืน 0 ซึ่งเป็นพิกัดกลางมหาสมุทรที่ดูเหมือนค่าที่ถูกต้อง
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** อยู่ในกรอบประเทศไทยคร่าวๆ ไหม */
export function isInThailand(lat: number, lng: number): boolean {
  return (
    lat >= THAILAND_BOUNDS.minLat &&
    lat <= THAILAND_BOUNDS.maxLat &&
    lng >= THAILAND_BOUNDS.minLng &&
    lng <= THAILAND_BOUNDS.maxLng
  );
}

/** ตรวจคู่พิกัดที่รับมาจากฟอร์มหรือจาก request body */
export function checkCoordinates(
  latInput: unknown,
  lngInput: unknown,
): CoordinateCheck {
  const lat = toNumber(latInput);
  const lng = toNumber(lngInput);

  if (lat === null || lng === null) return { ok: false, reason: "not_a_number" };

  if (
    lat < LAT_RANGE.min ||
    lat > LAT_RANGE.max ||
    lng < LNG_RANGE.min ||
    lng > LNG_RANGE.max
  ) {
    return { ok: false, reason: "out_of_range" };
  }

  return { ok: true, lat, lng, outsideThailand: !isInThailand(lat, lng) };
}
