/**
 * cache ภาพแผนที่ฝั่งเซิร์ฟเวอร์ — ภาพเดิมจ่าย Google ครั้งเดียว ใช้ได้ทุกคน
 *
 * ══════════════════════════════════════════════════════════════════
 * ทำไมต้องมี
 *
 * Cache-Control ที่ส่งให้เบราว์เซอร์ทำงานได้เฉพาะกับคนเดิม เครื่องเดิม —
 * คนละคนที่เปิดพัสดุซึ่งผ่านสาขาเดียวกัน จ่าย Google ใหม่ทุกครั้ง และ nginx
 * ไม่ได้ตั้ง proxy_cache ไว้ จึงไม่มีอะไรกันตรงกลางเลย
 *
 * เพดาน 500/วันเป็นเพดาน **รวมทั้งระบบ** ไม่ใช่ต่อคน ถ้าชนตอนบ่าย แผนที่ดับ
 * ให้ทุกคนจนเที่ยงคืน · ผู้ใช้ 15 คน × 10 รายการ × เปิด 3 ครั้ง = 450 ครั้ง
 * ซึ่งเกือบชนด้วยการใช้งานปกติ
 *
 * พิกัดสาขาซ้ำกันเยอะจริง (unknown_branches: ACRAI-B โดน 20 ครั้ง, SORC-A 9,
 * SOCN 7) และการปัดพิกัดเหลือ 4 ตำแหน่งก่อนสร้าง key ทำให้พัสดุคนละใบที่ผ่าน
 * สาขาเดียวกันได้ key เดียวกันเป๊ะ
 *
 * ══════════════════════════════════════════════════════════════════
 * ทำไม LRU ไม่ใช่ FIFO
 *
 * ความนิยมของสาขาเบ้มาก (20 : 9 : 7 : 1) · FIFO จะทิ้งสาขายอดนิยมที่ถูกใส่
 * เข้ามาก่อน ทั้งที่ยังถูกเรียกอยู่ตลอด แล้วจ่าย Google ใหม่ — ตรงข้ามกับ
 * สิ่งที่ cache ควรทำ
 *
 * JS Map จำลำดับการใส่อยู่แล้ว การ delete แล้ว set ใหม่จึงย้ายไปท้ายคิวได้
 * โดยไม่ต้องมีโครงสร้างข้อมูลเพิ่ม
 *
 * ⚠️ lib/cache.ts (cache ของผลติดตามพัสดุ) ยังเป็น FIFO อยู่ — คนละเรื่องกัน
 * และแยกเป็นงานต่างหาก ดูเหตุผลในรายงาน
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ เก็บเฉพาะคำตอบที่ใช้ได้จริง
 *
 * ห้ามเก็บ error เด็ดขาด · ถ้า Google ตอบ 500 หรือ timeout แล้วเราเก็บไว้
 * 30 วัน เท่ากับจำคำตอบผิดไว้เดือนหนึ่ง — บั๊กชนิดเดียวกับแถวใน geocode_cache
 * ที่ accuracy_meters เป็น null แล้วติดตายมาจนวันนี้
 *
 * ผู้เรียกต้องเรียก remember() เฉพาะตอนได้ภาพจริงเท่านั้น (มีเทสต์เฝ้า)
 */

/**
 * จำนวนภาพที่เก็บได้พร้อมกัน
 *
 * ภาพจริงที่วัดจาก log = 39 KB/ภาพ (640×288 scale=2) → 500 ภาพ ≈ 19 MB
 * โปรเซสตอนนี้ใช้ ~60 MB จึงขึ้นเป็น ~80 MB ซึ่งรับได้
 *
 * เพดานนี้ทำหน้าที่สองอย่าง: กันหน่วยความจำในวันปกติ และ **กันบอทที่ยิงพิกัด
 * สุ่มไม่ให้ดันหน่วยความจำขึ้นไปเรื่อยๆ** — บอทแบบนั้นจะชนเพดานโควตารายวัน
 * ก่อนอยู่แล้ว แต่เพดานนี้เป็นด่านที่สองที่ไม่พึ่งกันและกัน
 */
export const MAX_IMAGES = 500;

/**
 * อายุของภาพ — 30 วัน เท่ากับ Cache-Control ที่ส่งให้เบราว์เซอร์อยู่แล้ว
 *
 * แผนที่ฐานของ Google ขยับปีละไม่กี่ครั้ง ภาพของพิกัดเดิมจึงไม่เปลี่ยน
 */
export const TTL_MS = 30 * 24 * 60 * 60_000;

export interface MapImage {
  body: Uint8Array;
  contentType: string;
  /** เวลาที่ได้ภาพนี้มาจาก Google (epoch ms) */
  storedAt: number;
}

const store = new Map<string, MapImage>();

/** นับไว้ดูว่า cache ช่วยได้จริงแค่ไหน — รีเซ็ตตอน restart เหมือนตัว cache เอง */
const stats = { hits: 0, misses: 0 };

/**
 * ปัดพิกัดให้เหลือ 4 ตำแหน่ง (~11 เมตร)
 *
 * ⚠️ ใช้เฉพาะตอนสร้าง key กับ URL ที่ส่งไป Google เท่านั้น **ห้ามเอาไปปัดค่าที่
 * เก็บใน saved_trackings หรือค่าที่ classifyAccuracy ใช้ตัดสิน** — เกณฑ์ความ
 * แม่นยำสามชั้นวัดจากรัศมีที่ Google บอกมา ไม่ได้วัดจากจำนวนตำแหน่งทศนิยม
 * การปัดที่นี่จึงไม่แตะการตัดสินว่าจะปักหมุดไหมเลย
 *
 * 11 เมตรเล็กกว่าขนาดของอาคารสาขาทั่วไป ภาพที่ได้จึงเหมือนกันทุกประการ
 * ในสายตาคนดู แต่ทำให้พิกัดที่ต่างกันเล็กน้อยรวมเป็น key เดียว
 */
export function roundCoordinate(value: number): number {
  return Number(value.toFixed(4));
}

/** key ของภาพหนึ่งใบ — พิกัดที่ปัดแล้วบวกระดับซูม */
export function mapCacheKey(
  lat: number,
  lng: number,
  zoom: string,
): string {
  return `${roundCoordinate(lat)},${roundCoordinate(lng)},${zoom}`;
}

/**
 * หาภาพใน cache — null เมื่อไม่มีหรือหมดอายุ
 *
 * ทุกครั้งที่เจอ จะย้ายรายการนั้นไปท้ายคิว (LRU) เพื่อให้ตัวที่ถูกเรียกบ่อย
 * รอดจากการถูกทิ้งตอนเต็ม
 */
export function lookupMapImage(
  key: string,
  now: number = Date.now(),
): MapImage | null {
  const found = store.get(key);
  if (found === undefined) {
    stats.misses += 1;
    return null;
  }

  if (now - found.storedAt >= TTL_MS) {
    store.delete(key);
    stats.misses += 1;
    return null;
  }

  // ย้ายไปท้ายคิว — Map เรียงตามลำดับการใส่ การลบแล้วใส่ใหม่จึงเท่ากับ
  // "เพิ่งถูกใช้" โดยไม่ต้องเก็บ timestamp ของการเข้าถึงแยกต่างหาก
  store.delete(key);
  store.set(key, found);

  stats.hits += 1;
  return found;
}

/**
 * เก็บภาพที่เพิ่งได้มาจาก Google
 *
 * ⚠️ ผู้เรียกต้องเรียกเฉพาะตอนได้ภาพจริง (HTTP 200 + content-type เป็นรูป)
 * เท่านั้น — ดูเหตุผลที่หัวไฟล์
 */
export function rememberMapImage(
  key: string,
  image: Omit<MapImage, "storedAt">,
  now: number = Date.now(),
): void {
  store.delete(key);
  store.set(key, { ...image, storedAt: now });

  // เต็มแล้วทิ้งตัวที่ "ถูกใช้นานที่สุดแล้ว" ซึ่งคือตัวแรกของ Map
  while (store.size > MAX_IMAGES) {
    const oldest = store.keys().next();
    if (oldest.done === true) break;
    store.delete(oldest.value);
  }
}

/** ยอด hit / miss ไว้แสดงบนหน้าสถิติ */
export function mapCacheStats(): {
  hits: number;
  misses: number;
  stored: number;
} {
  return { hits: stats.hits, misses: stats.misses, stored: store.size };
}

/** ล้างทั้งหมด — มีไว้ให้เทสต์เริ่มจากศูนย์ ไม่ได้เรียกจากโค้ดจริง */
export function clearMapCache(): void {
  store.clear();
  stats.hits = 0;
  stats.misses = 0;
}
