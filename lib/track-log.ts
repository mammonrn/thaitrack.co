/**
 * log หนึ่งบรรทัดต่อหนึ่งการค้นหาของผู้ใช้ — บอกว่าคำค้นนั้น "จบที่ชั้นไหน"
 *
 * คู่กับ log [track123] ที่มีอยู่แล้ว แต่คนละมุม:
 *   [track123] = หนึ่งบรรทัดต่อหนึ่ง request ที่ออกไปหา Track123 จริง
 *   [track]    = หนึ่งบรรทัดต่อหนึ่งการค้นหา ไม่ว่าจะได้คำตอบมาจากชั้นไหน
 *
 * เอาสองอันมาเทียบกันแล้วได้ cache hit rate จริงจาก pm2 logs ตรงๆ โดยไม่ต้อง
 * ต่อเครื่องมืออะไรเพิ่ม (คำสั่งนับอยู่ใน README)
 *
 * เขียนที่ระดับ route ไม่ใช่ใน resolveTracking เพราะ "หนึ่งการค้นหาของผู้ใช้"
 * เป็นแนวคิดระดับ route ส่วน resolveTracking ถูกเรียกจากเทสต์ด้วย ซึ่งไม่ควร
 * พ่น log ออกมา
 */

import type { ResolveSource } from "./carriers/resolve";

export interface TrackLogFields {
  /** เวลาที่เริ่มค้น (epoch ms) */
  ts: number;
  /** เลขพัสดุที่ normalize แล้ว */
  trackNo: string;
  /** ทางเข้าที่เรียกมา เช่น "track" (หน้าค้นหา) หรือ "saved" (กดบันทึก) */
  route: string;
  /** ชั้นที่ตอบ — memory / supabase / api หรือ "error" เมื่อไม่ได้คำตอบเลย */
  source: ResolveSource | "error";
  /** true = ข้อมูลหมดอายุแล้วแต่ถูกใช้เป็นคำตอบสำรอง */
  stale: boolean;
  /** true = ไปเกาะคำขอของเลขเดียวกันที่กำลังรอผลอยู่ */
  shared: boolean;
  /** ใช้เวลาทั้งหมดกี่ ms */
  tookMs: number;
  /** code ของ CarrierError เมื่อ source เป็น error หรือเมื่อ degrade มาเป็น stale */
  reason?: string;
}

const yesNo = (value: boolean) => (value ? "yes" : "no");

/**
 * ประกอบเป็นบรรทัดเดียวแบบ key=value รูปแบบเดียวกับ [track123]
 *
 * export แยกจากตัวเขียน log เพื่อให้เทสต์ตรวจรูปแบบได้โดยไม่ต้องดัก console
 */
export function formatTrackLog(fields: TrackLogFields): string {
  const parts = [
    `ts=${fields.ts}`,
    `no=${fields.trackNo}`,
    `route=${fields.route}`,
    `source=${fields.source}`,
    `stale=${yesNo(fields.stale)}`,
    `shared=${yesNo(fields.shared)}`,
    `took=${fields.tookMs}ms`,
  ];
  if (fields.reason !== undefined) parts.push(`reason=${fields.reason}`);

  return `[track] ${parts.join(" ")}`;
}

/** เขียน log ลง stdout ให้ pm2 เก็บ */
export function logTracking(fields: TrackLogFields): void {
  console.info(formatTrackLog(fields));
}
