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
 * เหตุการณ์ที่ขนส่งไม่ได้บอกสถานที่ (เช่น "มอบหมายพนักงานนำจ่ายแล้ว") จะถูกยุบ
 * เข้ากลุ่มเพื่อนบ้านแทนการตั้งกลุ่ม "ไม่ระบุสถานที่" ของตัวเอง ดูเหตุผลที่
 * absorbLocationlessGroups
 *
 * ทำงานที่ชั้นแสดงผลล้วนๆ ไม่แตะข้อมูลที่มาจาก API หรือ cache
 */

import type { TrackingEvent } from "./carriers/types";

export interface TimelineGroup {
  /**
   * ชื่อสถานที่สำหรับแสดงเป็นหัวกลุ่ม
   *
   * เป็น null ได้กรณีเดียว คือไทม์ไลน์ทั้งเส้นไม่มีเหตุการณ์ไหนบอกสถานที่เลย
   */
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

  return mergeAdjacentSameLocation(absorbLocationlessGroups(groups));
}

/**
 * ยุบกลุ่มที่ไม่มีสถานที่เข้ากลุ่มเพื่อนบ้าน
 *
 * ขนส่งหลายเจ้าไม่ใส่สถานที่ให้เหตุการณ์เชิงสถานะ ("มอบหมายพนักงานนำจ่ายแล้ว",
 * "อยู่ระหว่างขนส่ง") ถ้าปล่อยให้เหตุการณ์พวกนี้ตั้งกลุ่ม "ไม่ระบุสถานที่" ของ
 * ตัวเอง ไทม์ไลน์จะถูกหั่นเป็นกลุ่มเล็กๆ สลับกับหัวข้อที่ไม่ได้บอกอะไรเลย
 * ซึ่งอ่านยากกว่าไม่จัดกลุ่มเสียอีก
 *
 * เลือกยุบเข้ากลุ่ม "ถัดลงไป" (เหตุการณ์ที่เก่ากว่า เพราะไทม์ไลน์เรียงใหม่→เก่า)
 * เพราะสถานที่ที่เหตุการณ์ไร้พิกัดเกิดขึ้นจริง คือที่ที่พัสดุอยู่ ณ ตอนนั้น และ
 * ที่นั้นถูกระบุไว้แล้วโดยเหตุการณ์ก่อนหน้า เช่น "ถึงสาขา ACRAI-B" แล้วค่อย
 * "มอบหมายพนักงานนำจ่ายแล้ว" — คนขับถูกมอบหมายที่ ACRAI-B ไม่ใช่ที่ปลายทาง
 * ถัดไปที่พัสดุยังไปไม่ถึง
 *
 * ถ้าไม่มีกลุ่มที่เก่ากว่าให้ยุบเข้า (เหตุการณ์ไร้พิกัดอยู่ท้ายสุด) จึงถอยไปยุบ
 * เข้ากลุ่มที่ใหม่กว่าแทน และถ้าทั้งไทม์ไลน์ไม่มีสถานที่เลย ก็คงกลุ่ม null ไว้
 */
function absorbLocationlessGroups(groups: TimelineGroup[]): TimelineGroup[] {
  if (groups.every((group) => group.location === null)) return groups;

  const merged: TimelineGroup[] = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];

    if (group.location !== null) {
      merged.push(group);
      continue;
    }

    // หากลุ่มที่มีสถานที่ตัวถัดไป (เก่ากว่า) แล้วแทรกไว้ด้านหน้าของกลุ่มนั้น
    // เพื่อคงลำดับเวลาเดิมไว้
    let next = i + 1;
    while (next < groups.length && groups[next].location === null) next++;

    if (next < groups.length) {
      groups[next].events.unshift(...group.events);
      continue;
    }

    // ไม่มีกลุ่มที่เก่ากว่าแล้ว → ต่อท้ายกลุ่มที่ใหม่กว่าซึ่งออกไปแล้ว
    merged[merged.length - 1].events.push(...group.events);
  }

  return merged;
}

/**
 * รวมกลุ่มที่อยู่ติดกันและเป็นสถานที่เดียวกัน
 *
 * หลังยุบเหตุการณ์ไร้พิกัดออกไป กลุ่มของสถานที่เดียวกันที่เคยถูกคั่นอยู่จะมาชน
 * กันพอดี ต้องรวมอีกรอบ ไม่งั้นจะเห็นหัวข้อชื่อเดียวกันซ้ำสองบรรทัดติด
 */
function mergeAdjacentSameLocation(groups: TimelineGroup[]): TimelineGroup[] {
  const merged: TimelineGroup[] = [];
  let currentKey: string | null = null;

  for (const group of groups) {
    const key = group.location === null ? null : normalizeLocation(group.location);

    if (key !== null && merged.length > 0 && key === currentKey) {
      merged[merged.length - 1].events.push(...group.events);
      continue;
    }

    merged.push(group);
    currentKey = key;
  }

  return merged;
}
