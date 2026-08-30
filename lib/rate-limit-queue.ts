/**
 * คิวจำกัดอัตราการยิง API ปลายทาง — เขียนเองไม่พึ่ง dependency ภายนอก
 *
 * ปัญหาที่แก้: Track123 จำกัด 5 request/วินาที ต่อ endpoint ถ้ายิงเกินจะได้ code
 * A0706 กลับมา ผู้ใช้แค่ 3-4 คนกดค้นหาพร้อมกัน (หรือคนเดียวกดรัว) ก็ชนแล้ว
 * เพราะการค้นหา 1 ครั้งอาจยิง Track123 ได้หลายครั้ง (auto-detect + ลองระบุขนส่ง)
 *
 * วิธีการ: บังคับ "ระยะห่างขั้นต่ำระหว่างจุดเริ่มยิงแต่ละครั้ง" แทนการนับโควตา
 * เป็นหน้าต่างเวลา เพราะจองช่องเวลาได้ทันทีแบบ synchronous จึงได้ผลพลอยได้
 * สองอย่างฟรีๆ คือ
 *   1. ลำดับเป็น FIFO เสมอ — ใครเรียก run() ก่อนได้ช่องก่อน ไม่มีใครโดนแซง
 *   2. รู้ตั้งแต่ตอนเข้าคิวว่าต้องรอนานแค่ไหน เอาไปใส่ log ได้เลย
 *
 * ระยะห่าง 1000/3 ≈ 334ms หมายความว่าในหน้าต่าง 1 วินาทีใดๆ จะมีจุดเริ่มยิง
 * ไม่เกิน 3 ครั้ง (0ms, 334ms, 668ms แล้วครั้งถัดไปคือ 1002ms ซึ่งเลยวินาทีแรกไปแล้ว)
 * เหลือ margin จากเพดานจริง 5 อยู่ 2 ครั้ง เผื่อนาฬิกาสองฝั่งเหลื่อมกัน
 *
 * ⚠️ ข้อจำกัดที่ตั้งใจยอมรับ: คิวอยู่ใน memory ของ process เดียว ถ้า deploy
 * หลาย instance แต่ละตัวจะจำกัดอัตราของตัวเองแยกกัน (2 instance = 6 req/s รวม)
 * pm2 แบบ fork mode ตัวเดียวซึ่งเป็นสภาพตอนนี้ยังปลอดภัย แต่ถ้าเปลี่ยนไป cluster
 * mode หรือ serverless ต้องย้ายตัวนับไปไว้ที่กลาง (Redis) ก่อน
 *
 * ตั้งใจ "ไม่" ใส่เพดานความยาวคิว — คำขอที่เกินต้องได้เข้าแถวรอ ไม่ใช่ถูกทิ้ง
 * หรือเด้ง error กลับไปหาผู้ใช้
 */

/** หน่วงเวลาแบบ await ได้ — เรียก setTimeout ของ global เพื่อให้ fake timer ในเทสต์ดักได้ */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** ข้อมูลของการยิงหนึ่งครั้งที่คิวส่งต่อให้ผู้เรียก ไว้ใช้ทำ log */
export interface QueuedCall {
  /**
   * จำนวนคำขอที่คิวถืออยู่ ณ ตอนที่คำขอนี้เข้าคิว (นับตัวเองด้วย)
   *
   * ค่านี้คือคำตอบของ "จังหวะชนลิมิตมี call อัดกันกี่ตัว" — 1 คือไม่มีใครรออยู่เลย
   */
  depth: number;
  /** รอในคิวจริงกี่ ms ก่อนได้เริ่มยิง (0 = ได้ยิงทันที) */
  waitedMs: number;
}

/** ตัวจำกัดอัตราแบบ "ระยะห่างขั้นต่ำระหว่างจุดเริ่มยิง" */
export class RateLimitQueue {
  /** ระยะห่างขั้นต่ำระหว่างจุดเริ่มยิงสองครั้งติดกัน (ms) */
  readonly minIntervalMs: number;

  /** จำนวนคำขอที่ยังไม่จบ (ทั้งที่รอคิวอยู่และที่กำลังยิง) */
  #pending = 0;

  /** เวลาที่เร็วที่สุดที่คำขอถัดไปเริ่มยิงได้ (epoch ms) */
  #nextSlotAt = 0;

  /**
   * @param maxPerSecond จำนวนครั้งต่อวินาทีที่ยอมให้ยิงได้ ต้องมากกว่า 0
   */
  constructor(maxPerSecond: number) {
    if (!(maxPerSecond > 0)) {
      throw new RangeError("maxPerSecond ต้องมากกว่า 0");
    }
    this.minIntervalMs = Math.ceil(1000 / maxPerSecond);
  }

  /** จำนวนคำขอที่คิวถืออยู่ตอนนี้ (รอคิว + กำลังยิง) */
  get pending(): number {
    return this.#pending;
  }

  /**
   * เข้าคิวแล้วยิง task เมื่อถึงช่องเวลาของตัวเอง
   *
   * การจองช่องเวลาเกิดขึ้นแบบ synchronous ตั้งแต่ตอนเรียก run() (โค้ดก่อน await
   * ตัวแรกของ async function ทำงานทันที) ลำดับจึงเป็น FIFO ตามลำดับที่เรียกจริง
   *
   * error ที่ task โยนออกมาถูกส่งต่อขึ้นไปตามเดิม คิวไม่แปลงหรือกลืนอะไรทั้งนั้น
   */
  async run<T>(task: (call: QueuedCall) => Promise<T>): Promise<T> {
    const enqueuedAt = Date.now();
    this.#pending += 1;
    const depth = this.#pending;

    // จองช่องเวลาไว้ก่อน แล้วค่อยเลื่อนหมุดของคนถัดไป
    const startAt = Math.max(enqueuedAt, this.#nextSlotAt);
    this.#nextSlotAt = startAt + this.minIntervalMs;

    try {
      if (startAt > enqueuedAt) await delay(startAt - enqueuedAt);
      return await task({ depth, waitedMs: Date.now() - enqueuedAt });
    } finally {
      this.#pending -= 1;
    }
  }
}
