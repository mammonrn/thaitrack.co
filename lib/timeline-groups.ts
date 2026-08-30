/**
 * จัดกลุ่มเหตุการณ์ในไทม์ไลน์ตามสถานที่
 *
 * ไทม์ไลน์แบนยาวอ่านยาก เพราะพัสดุหนึ่งชิ้นมีหลายเหตุการณ์ที่เกิดในที่เดียวกัน
 * ติดกัน (เข้าศูนย์ → คัดแยก → ออกจากศูนย์) การรวมเป็นก้อนเดียวแล้วขึ้นหัวว่า
 * เป็นที่ไหน ทำให้กวาดตาหาคำตอบว่า "ตอนนี้อยู่ไหน" ได้เร็วขึ้น
 *
 * จัดกลุ่มเฉพาะเหตุการณ์ที่อยู่ "ติดกัน" และสถานที่ตรงกันเท่านั้น ไม่รวมข้ามช่วง
 * เวลา เพราะพัสดุอาจวนกลับมาที่เดิมได้ การรวมข้ามช่วงจะทำให้ลำดับเวลาผิด
 *
 * ทำงานที่ชั้นแสดงผลล้วนๆ ไม่แตะข้อมูลที่มาจาก API หรือ cache
 */

import type { TrackingEvent } from "./carriers/types";

export interface TimelineGroup {
  /** ชื่อสถานที่สำหรับแสดงเป็นหัวกลุ่ม — null คือกลุ่มที่ขนส่งไม่ได้บอกสถานที่ */
  location: string | null;
  events: TrackingEvent[];
}

/**
 * ทำให้ชื่อสถานที่เทียบกันได้
 *
 * ขนส่งสะกดชื่อเดียวกันไม่ตรงกันบ่อย เช่น "ศูนย์คัดแยก  ขอนแก่น" กับ
 * "ศูนย์คัดแยกขอนแก่น" หรือพิมพ์ใหญ่เล็กต่างกัน ("SHENZHEN" กับ "Shenzhen")
 * ถ้าไม่ normalize ก่อนเทียบ จะได้กลุ่มซ้อนกันหลายกลุ่มทั้งที่เป็นที่เดียวกัน
 */
export function normalizeLocation(location: string): string {
  return location
    .trim()
    .toLowerCase()
    // ตัดช่องว่างทั้งหมดทิ้ง ไม่ใช่แค่ยุบให้เหลืออันเดียว เพราะภาษาไทยเขียน
    // ติดกันหรือเว้นวรรคก็อ่านออกเหมือนกัน
    .replace(/\s+/g, "")
    // เครื่องหมายวรรคตอนท้ายชื่อไม่มีความหมาย
    .replace(/[.,;:·-]+$/u, "");
}

/**
 * รวมเหตุการณ์ที่อยู่ติดกันและเกิดที่เดียวกันเข้าเป็นกลุ่มเดียว
 *
 * ลำดับของ events ที่ส่งเข้ามาเป็นอย่างไร ลำดับที่คืนออกไปก็เป็นอย่างนั้น
 * (หน้าเว็บส่งมาแบบใหม่→เก่า จึงได้กลุ่มเรียงใหม่→เก่าเช่นกัน)
 */
export function groupEventsByLocation(
  events: readonly TrackingEvent[],
): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let currentKey: string | null = null;

  for (const event of events) {
    const rawLocation = event.location.trim();
    const key = rawLocation === "" ? null : normalizeLocation(rawLocation);

    // ต่อกลุ่มเดิมเมื่อสถานที่ตรงกัน (รวมกรณีไม่มีสถานที่ทั้งคู่)
    if (groups.length > 0 && key === currentKey) {
      groups[groups.length - 1].events.push(event);
      continue;
    }

    groups.push({
      // ใช้การสะกดของเหตุการณ์แรกในกลุ่มเป็นชื่อที่แสดง เพราะเป็นอันใหม่ที่สุด
      location: rawLocation === "" ? null : rawLocation,
      events: [event],
    });
    currentKey = key;
  }

  return groups;
}
