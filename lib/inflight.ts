/**
 * รวมคำขอที่ซ้ำกันและกำลังรอผลอยู่ให้ใช้ promise เดียวกัน
 *
 * ปัญหาที่แก้: เลขพัสดุเดียวกันถูกค้นพร้อมกันได้ง่ายมาก — คนเดียวกดปุ่มรัวเพราะ
 * รู้สึกว่าช้า, กดค้นหาแล้วสแกนบาร์โค้ดซ้ำ, หรือผู้รับกับผู้ส่งค้นเลขเดียวกันคนละเครื่อง
 * ทุกครั้งคือ quota ของ Track123 ที่เสียไปเปล่าๆ เพราะคำตอบเป็นก้อนเดียวกันอยู่แล้ว
 *
 * cache ช่วยกรณีนี้ไม่ได้ เพราะผลยังไม่ถูกบันทึกจนกว่าคำขอแรกจะเสร็จ ช่วงเวลาที่
 * คำขอแรก "กำลังบิน" อยู่คือช่องว่างที่คำขอที่สองหลุดออกไปยิงซ้ำได้
 *
 * ผู้ที่มาทีหลังได้ทั้งผลสำเร็จและ error ก้อนเดียวกับคนแรก ซึ่งเป็นสิ่งที่ต้องการ:
 * ถ้าคนแรกเจอปัญหา คนที่สองยิงใหม่ตอนนั้นก็เจอเหมือนกัน
 */

/** ผลของการขอเข้าร่วมคำขอที่กำลังบินอยู่ */
export interface InflightRun<T> {
  /** true = ไปเกาะคำขอที่มีอยู่แล้ว (ไม่ได้ยิงใหม่), false = เป็นคนเปิดคำขอนี้เอง */
  joined: boolean;
  promise: Promise<T>;
}

/** ทะเบียนคำขอที่กำลังรอผลอยู่ แยกตาม key (เช่น เลขพัสดุที่ normalize แล้ว) */
export class InflightMap<T> {
  readonly #running = new Map<string, Promise<T>>();

  /** จำนวนคำขอที่กำลังบินอยู่ตอนนี้ */
  get size(): number {
    return this.#running.size;
  }

  /**
   * เริ่มคำขอของ key นี้ หรือเกาะคำขอเดิมถ้ามีอยู่แล้ว
   *
   * บอกด้วยว่าเป็นคนเปิดเองหรือไปเกาะ เพื่อให้ผู้เรียกเอาไปทำ log นับได้ว่า
   * การรวมคำขอช่วยประหยัดการยิงไปได้จริงกี่ครั้ง
   */
  start(key: string, factory: () => Promise<T>): InflightRun<T> {
    const existing = this.#running.get(key);
    if (existing !== undefined) return { joined: true, promise: existing };

    // เรียก factory ใน try เผื่อมันโยน error แบบ synchronous ออกมา
    // ไม่งั้น key จะไม่ถูกลบเพราะ .finally ยังไม่ทันได้ผูก
    let created: Promise<T>;
    try {
      created = factory();
    } catch (error) {
      return { joined: false, promise: Promise.reject(error) };
    }

    // ลบทะเบียนทันทีที่รู้ผล ไม่ว่าจะสำเร็จหรือพัง — คำขอรอบหน้าต้องได้ยิงใหม่
    // ผูก .finally กับ promise ที่เก็บไว้ ไม่ใช่ตัวที่คืนออกไป เพื่อไม่ให้ผู้เกาะ
    // ต้องรอ microtask เพิ่ม และไม่ให้เกิด unhandled rejection จาก chain ที่ทิ้ง
    const tracked: Promise<T> = created.finally(() => {
      // เช็คก่อนลบ เผื่อมีคำขอรอบใหม่ของ key เดียวกันถูกบันทึกทับไปแล้ว
      if (this.#running.get(key) === tracked) this.#running.delete(key);
    });

    // กัน unhandled rejection: ตัว tracked อาจไม่มีใคร await ถ้าผู้เรียกใช้แต่ created
    tracked.catch(() => {});

    this.#running.set(key, tracked);
    return { joined: false, promise: tracked };
  }

  /** เวอร์ชันย่อสำหรับผู้เรียกที่ไม่สนว่าเป็นคนเปิดเองหรือไปเกาะ */
  run(key: string, factory: () => Promise<T>): Promise<T> {
    return this.start(key, factory).promise;
  }

  /** ล้างทะเบียนทั้งหมด — ใช้ในเทสต์ ไม่ได้ยกเลิกคำขอที่กำลังบินอยู่ */
  clear(): void {
    this.#running.clear();
  }
}
