/**
 * รหัสไปรษณีย์ไทย — อ่านจากไฟล์ในโปรเจกต์ ไม่มีฐานข้อมูลและไม่มี API
 *
 * ------------------------------------------------------------------
 * ทำไมเป็นไฟล์ static
 *
 * ข้อมูลชุดนี้แทบไม่เปลี่ยน (ตำบล/อำเภอใหม่เกิดปีละไม่กี่แห่ง) การเอาไปไว้ใน
 * ฐานข้อมูลจึงได้แต่ค่าใช้จ่ายกับความเสี่ยงที่หน้าเว็บพังตอนฐานข้อมูลล่ม
 * โดยไม่ได้อะไรกลับมาเลย · อยู่ในไฟล์แปลว่าหน้าทั้งหมดเป็น static ล้วน
 * เสิร์ฟจาก CDN ได้ และ **ไม่มีทางไปแตะโควตา API ของขนส่ง** ซึ่งเป็นเงื่อนไข
 * ของงานนี้
 *
 * ⚠️ ไฟล์นี้ import ข้อมูล ~290KB เข้ามาตรงๆ — **ห้าม import จาก client component**
 * ไม่งั้นข้อมูลทั้งก้อนจะถูกส่งไปที่เบราว์เซอร์ทุกครั้งที่เปิดหน้า
 * ฝั่งเบราว์เซอร์ที่ต้องค้นย้อนกลับให้ใช้ /postcode-lookup.json แทน ซึ่งเล็กกว่า
 * และโหลดเมื่อผู้ใช้เริ่มพิมพ์เท่านั้น (ดู app/รหัสไปรษณีย์/postcode-search.tsx)
 * ------------------------------------------------------------------
 *
 * ที่มาของข้อมูล: https://github.com/earthchie/jquery.Thailand.js
 * ไฟล์ jquery.Thailand.js/database/raw_database/raw_database.json
 * สัญญาอนุญาต: WTFPL (ใช้ ดัดแปลง และแจกจ่ายต่อได้โดยไม่มีเงื่อนไข)
 * ดึงมาเมื่อ 1 ก.ย. 2569 แล้วยุบเป็นโครงสร้างซ้อนชั้นเพื่อลดขนาด
 *
 * ⚠️ ตัดทิ้ง 43 แถวที่ไม่มีรหัสไปรษณีย์ในต้นทาง — เกือบทั้งหมดเป็นเกาะที่ไม่มี
 * รหัสไปรษณีย์ของตัวเองจริงๆ (เช่น "เกาะขี้นก" อ.ทุ่งตะโก จ.ชุมพร) ไม่ใช่ข้อมูล
 * ขาด การใส่ไว้โดยไม่มีรหัสจะทำให้หน้าเว็บมีบรรทัดว่างที่อธิบายไม่ได้
 *
 * ตั้งใจไม่เก็บรหัสตัวเลขของจังหวัด/อำเภอ (province_code, amphoe_code) เพราะ
 * ต้นทางมีบางแถวที่ค่าเป็น false และเราไม่ได้ใช้มันทำอะไรเลย — ชื่อไม่ซ้ำกัน
 * อยู่แล้วในแต่ละระดับ จึงใช้ชื่อเป็นกุญแจได้ตรงๆ
 */

import { THAI_POSTCODES, type RawProvince } from "../data/thai-postcodes";

export interface Tambon {
  name: string;
  postcode: number;
}

export interface Amphoe {
  name: string;
  tambons: Tambon[];
}

export interface Province {
  name: string;
  amphoes: Amphoe[];
}

/**
 * ที่มาของข้อมูล — แสดงบนหน้าเว็บตามมารยาทและตามที่ควรทำ
 *
 * เขียนไว้ที่นี่คู่กับหัวไฟล์ของ data/thai-postcodes.ts ถ้าวันหนึ่งเปลี่ยน
 * แหล่งข้อมูล ต้องแก้ทั้งสองที่ให้ตรงกัน
 */
export const DATA_SOURCE = {
  url: "https://github.com/earthchie/jquery.Thailand.js",
  license: "WTFPL",
  fetchedAt: "2026-09-01",
};

/** จังหวัดทั้งหมด เรียงตามชื่อไทย */
export const PROVINCES: readonly Province[] = THAI_POSTCODES.provinces
  .map((province: RawProvince) => ({
    name: province.name,
    amphoes: province.amphoes
      .map((amphoe) => ({
        name: amphoe.name,
        tambons: amphoe.tambons.map(([name, postcode]) => ({ name, postcode })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "th"));

export function findProvince(name: string): Province | undefined {
  return PROVINCES.find((province) => province.name === name);
}

export function findAmphoe(
  province: Province,
  name: string,
): Amphoe | undefined {
  return province.amphoes.find((amphoe) => amphoe.name === name);
}

/** รหัสไปรษณีย์ทั้งหมดของอำเภอนี้ เรียงจากน้อยไปมาก ไม่ซ้ำ */
export function postcodesOf(amphoe: Amphoe): number[] {
  return [...new Set(amphoe.tambons.map((tambon) => tambon.postcode))].sort(
    (a, b) => a - b,
  );
}

/** รหัสไปรษณีย์ทั้งหมดของจังหวัดนี้ */
export function provincePostcodes(province: Province): number[] {
  const codes = province.amphoes.flatMap((amphoe) =>
    amphoe.tambons.map((tambon) => tambon.postcode),
  );
  return [...new Set(codes)].sort((a, b) => a - b);
}

/** จำนวนตำบลทั้งจังหวัด — ไว้เขียนบนหน้าให้เห็นขนาดข้อมูล */
export function countTambons(province: Province): number {
  return province.amphoes.reduce(
    (total, amphoe) => total + amphoe.tambons.length,
    0,
  );
}
