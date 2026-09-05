/**
 * ยิงขอภาพแผนที่จาก Google หนึ่งครั้ง พร้อมกันคำขอซ้ำที่บินพร้อมกัน
 *
 * ══════════════════════════════════════════════════════════════════
 * ปัญหาที่แก้: cache stampede
 *
 * หน้าประวัติโหลดภาพหลายใบพร้อมกัน · ถ้าผู้ใช้มีพัสดุ 5 ใบที่ผ่านสาขาเดียวกัน
 * (เรื่องปกติมาก — คนสั่งของร้านเดิมซ้ำ หรือของหลายชิ้นเข้าศูนย์คัดแยกเดียวกัน)
 * ทั้ง 5 จะ cache miss **พร้อมกัน** ก่อนตัวแรกจะเขียน cache เสร็จ แล้วจ่าย
 * Google 5 ครั้งสำหรับภาพเดียวกันเป๊ะ
 *
 * cache ช่วยกรณีนี้ไม่ได้เลย เพราะภาพยังไม่ถูกเก็บจนกว่าคำขอแรกจะได้คำตอบ —
 * ช่วงที่คำขอแรกกำลังบินคือช่องว่างที่คำขอที่เหลือหลุดออกไปยิงซ้ำได้
 *
 * ══════════════════════════════════════════════════════════════════
 * ใช้ InflightMap ตัวเดียวกับที่กันการยิง Track123 ซ้ำ (lib/inflight.ts)
 *
 * ไม่เขียนใหม่เพราะปัญหาเป็นตัวเดียวกันทุกประการ และตัวนั้นจัดการเคสยากไว้
 * ครบแล้ว: ลบทะเบียนทั้งขาสำเร็จและขาล้ม (.finally), กัน factory ที่โยน error
 * แบบ synchronous, และกัน unhandled rejection ของ promise ที่ไม่มีใคร await
 *
 * ⚠️ ข้อที่สำคัญที่สุดคือ **ลบทะเบียนตอนล้มด้วย** — ถ้าไม่ลบ คนที่มาทีหลังจะ
 * รอ promise ที่ล้มไปแล้วตลอดกาล ซึ่ง InflightMap ทำให้อยู่แล้วผ่าน .finally
 * ══════════════════════════════════════════════════════════════════
 */

import { InflightMap } from "./inflight";
import { rememberMapImage } from "./map-cache";
import { countProviderCall, isExhausted } from "./provider-usage";

/** ผู้ให้บริการที่คิดเงินสำหรับภาพแผนที่ */
export const MAP_PROVIDER = "google-static-maps" as const;

/**
 * ผลของการขอภาพหนึ่งครั้ง
 *
 * ⚠️ คืนเป็นค่า ไม่ใช่โยน error โดยตั้งใจ — ผู้เกาะคำขอเดิมจะได้ผลก้อนเดียวกับ
 * คนแรกเสมอ ทั้งขาสำเร็จและขาล้ม โดยไม่ต้องมี try/catch กระจายหลายที่
 */
export type MapOutcome =
  | { ok: true; body: Uint8Array; contentType: string }
  | { ok: false; status: number };

export interface MapFetchDeps {
  /** ตัวยิงจริง (ค่าเริ่มต้น: fetch ของ runtime) — ใส่เองได้ในเทสต์ */
  fetchImpl?: typeof fetch;
  /** นับหนึ่งครั้งที่จ่ายเงิน (ค่าเริ่มต้น: ตัวนับกลาง) */
  count?: () => Promise<unknown>;
  /** โควตาวันนี้หมดหรือยัง (ค่าเริ่มต้น: ตัวนับกลาง) */
  exhausted?: () => boolean;
  /** เวลาสำหรับบันทึกลง cache — ใส่เองได้ในเทสต์ */
  now?: number;
  /** timeout ของการยิง (ms) */
  timeoutMs?: number;
}

/** ทะเบียนคำขอที่กำลังบินอยู่ แยกตาม cache key */
const inflight = new InflightMap<MapOutcome>();

/** จำนวนคำขอที่กำลังบินอยู่ — ใช้ในเทสต์ */
export function inflightMapCount(): number {
  return inflight.size;
}

/** ล้างทะเบียน — ใช้ในเทสต์ ไม่ได้ยกเลิกคำขอที่กำลังบิน */
export function clearInflightMaps(): void {
  inflight.clear();
}

/**
 * ขอภาพของ key นี้ — ถ้ามีคำขอเดียวกันบินอยู่แล้ว ให้ไปเกาะแทนการยิงใหม่
 *
 * ทุกอย่างที่มีต้นทุน (เช็คโควตา, นับ, ยิง Google, เขียน cache) อยู่ **ข้างใน**
 * factory ทั้งหมด ผู้ที่มาเกาะจึงไม่แตะอะไรเลยสักอย่าง — ไม่นับซ้ำ ไม่ยิงซ้ำ
 */
export function fetchMapImage(
  key: string,
  url: string,
  deps: MapFetchDeps = {},
): Promise<MapOutcome> {
  return inflight.run(key, async (): Promise<MapOutcome> => {
    const exhausted = deps.exhausted ?? (() => isExhausted(MAP_PROVIDER));

    // ชนเพดานรายวัน → หยุดยิง · เพดานที่หยุดไม่ได้ก็ไม่ใช่เพดาน
    // ตอบ 404 เหมือนตอนสวิตช์ปิด ไม่บอกใบ้ว่าเกิดอะไรขึ้นข้างใน
    if (exhausted()) {
      console.warn(
        `[map] ชนเพดานรายวันแล้ว หยุดยิง Google จนกว่าจะขึ้นรอบใหม่ (${MAP_PROVIDER})`,
      );
      return { ok: false, status: 404 };
    }

    // ⚠️ นับก่อนยิง และนับทุกครั้งรวมครั้งที่ล้ม — ยิงแล้ว error แปลว่า Google
    // รับ request ไปแล้ว = จ่ายไปแล้ว · การนับเฉพาะครั้งที่สำเร็จคือการนับขาด
    const count = deps.count ?? (() => countProviderCall(MAP_PROVIDER));
    await count();

    const fetchImpl = deps.fetchImpl ?? fetch;

    let upstream: Response;
    try {
      upstream = await fetchImpl(url, {
        signal: AbortSignal.timeout(deps.timeoutMs ?? 6000),
      });
    } catch (cause) {
      // ห้าม log ตัว url เพราะมี API key อยู่ในนั้น
      console.error(
        `[map] เรียก Maps Static API ไม่สำเร็จ: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return { ok: false, status: 504 };
    }

    if (!upstream.ok) {
      console.error(`[map] Maps Static API ตอบ HTTP ${upstream.status}`);
      return { ok: false, status: 502 };
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    // Google ตอบข้อความอธิบายปัญหาเป็น text/html มาได้เมื่อคีย์ผิดหรือโควตาหมด
    // ถ้าส่งต่อไปตรงๆ เบราว์เซอร์จะแสดงเป็นภาพเสีย จับไว้ตรงนี้ให้เป็น 502 แทน
    if (!contentType.startsWith("image/")) {
      console.error(
        `[map] Maps Static API ตอบชนิดข้อมูล "${contentType}" ไม่ใช่รูป`,
      );
      return { ok: false, status: 502 };
    }

    const body = new Uint8Array(await upstream.arrayBuffer());

    // ⚠️ ถึงตรงนี้ได้แปลว่า 200 และเป็นรูปจริงเท่านั้น — ทุกทางที่ล้ม return
    // ออกไปหมดแล้วข้างบน จึงไม่มีทางเก็บคำตอบพังลง cache
    rememberMapImage(key, { body, contentType }, deps.now);

    return { ok: true, body, contentType };
  });
}
