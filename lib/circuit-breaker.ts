/**
 * Circuit breaker — หยุดยิงไปหาปลายทางที่กำลังล่ม แทนที่จะให้ผู้ใช้รอ timeout ทีละคน
 *
 * ปัญหาที่แก้: ตอน Track123 ล่ม ทุกคำค้นจะไปค้างรอจนครบ 20 วินาทีแล้วค่อยพัง
 * ผู้ใช้ 10 คนก็รอ 10 ครั้ง ทั้งที่หลังคำขอแรกเรารู้อยู่แล้วว่าปลายทางไม่ตอบ
 * ที่แย่กว่านั้นคือคิวจะเต็มไปด้วยคำขอที่รู้อยู่แล้วว่าจะพัง ทำให้คำขอของ
 * ขนส่งเจ้าอื่นถูกหน่วงตามไปด้วย
 *
 * สามสถานะตามแบบมาตรฐาน:
 *
 *   closed    ปกติ — ปล่อยผ่านทุกคำขอ นับความล้มเหลวที่เกิดติดๆ กันไว้
 *   open      ล่ม — ปฏิเสธทันทีโดยไม่ยิงจริง จนกว่าจะครบเวลาพัก
 *   half_open ลองแตะดู — ปล่อยผ่านคำขอเดียวเพื่อดูว่าฟื้นหรือยัง
 *               สำเร็จ → กลับไป closed · พังอีก → กลับไป open แล้วพักใหม่
 *
 * "ติดๆ กัน" นับด้วยหน้าต่างเวลา ไม่ใช่นับสะสมตลอดกาล — ปลายทางที่พัง 5 ครั้ง
 * กระจายตลอดทั้งวันคือปลายทางที่ปกติดี ส่วนที่พัง 5 ครั้งใน 1 นาทีคือกำลังล่มจริง
 *
 * ทั้งไฟล์ไม่มี timer ทำงานเบื้องหลัง — เวลาถูกอ่านตอนถูกถามเท่านั้น จึงไม่มี
 * handle ค้างให้ต้องเก็บกวาด และเทสต์ด้วยนาฬิกาปลอมได้ตรงไปตรงมา
 */

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** ชื่อไว้ใส่ log เช่น "track123" */
  name: string;
  /** พังกี่ครั้งติดกันถึงจะเปิดวงจร (ตัดการยิง) */
  failureThreshold: number;
  /** นับความล้มเหลวย้อนหลังกี่ ms — ที่เก่ากว่านี้ถือว่าคนละเหตุการณ์ */
  windowMs: number;
  /** เปิดวงจรแล้วพักกี่ ms ก่อนยอมลองแตะดูอีกครั้ง */
  cooldownMs: number;
  /** ปลายทางของ log (ค่าเริ่มต้น: console.info) */
  log?: (line: string) => void;
}

/** สรุปสถานะไว้ใส่ log และไว้ให้เทสต์ตรวจ */
export interface BreakerSnapshot {
  state: BreakerState;
  /** จำนวนครั้งที่พังติดกันในหน้าต่างเวลาปัจจุบัน */
  failures: number;
  /** เหลืออีกกี่ ms ถึงจะยอมลองแตะดู — 0 เมื่อไม่ได้อยู่ในสถานะ open */
  cooldownRemainingMs: number;
}

export class CircuitBreaker {
  readonly name: string;
  readonly failureThreshold: number;
  readonly windowMs: number;
  readonly cooldownMs: number;

  readonly #log: (line: string) => void;

  /** เวลาที่เกิดความล้มเหลวแต่ละครั้ง (epoch ms) เก่ากว่าหน้าต่างจะถูกตัดทิ้ง */
  #failures: number[] = [];

  /** เวลาที่วงจรถูกเปิด — null เมื่อไม่ได้เปิดอยู่ */
  #openedAt: number | null = null;

  /** true = ปล่อยคำขอทดลองออกไปแล้ว กำลังรอผล */
  #probing = false;

  constructor(options: CircuitBreakerOptions) {
    if (!(options.failureThreshold > 0)) {
      throw new RangeError("failureThreshold ต้องมากกว่า 0");
    }
    if (!(options.windowMs > 0)) throw new RangeError("windowMs ต้องมากกว่า 0");
    if (!(options.cooldownMs > 0)) {
      throw new RangeError("cooldownMs ต้องมากกว่า 0");
    }

    this.name = options.name;
    this.failureThreshold = options.failureThreshold;
    this.windowMs = options.windowMs;
    this.cooldownMs = options.cooldownMs;
    this.#log = options.log ?? ((line: string) => console.info(line));
  }

  /** ตัดความล้มเหลวที่เก่าเกินหน้าต่างเวลาทิ้ง */
  #prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.#failures = this.#failures.filter((at) => at > cutoff);
  }

  /** สถานะตอนนี้ — คำนวณสดทุกครั้ง ไม่มี timer เบื้องหลัง */
  state(now: number = Date.now()): BreakerState {
    if (this.#openedAt === null) return "closed";
    if (now - this.#openedAt >= this.cooldownMs) return "half_open";
    return "open";
  }

  snapshot(now: number = Date.now()): BreakerSnapshot {
    this.#prune(now);
    const state = this.state(now);

    return {
      state,
      failures: this.#failures.length,
      cooldownRemainingMs:
        state === "open" && this.#openedAt !== null
          ? Math.max(0, this.#openedAt + this.cooldownMs - now)
          : 0,
    };
  }

  /**
   * ยิงได้ไหม
   *
   * ในสถานะ half_open จะปล่อยผ่าน "คำขอเดียว" เท่านั้น คำขอที่เหลือถูกปฏิเสธ
   * ต่อไปจนกว่าจะรู้ผลของคำขอทดลอง — ไม่งั้นตอนวงจรพร้อมลองใหม่ คำขอที่ค้างอยู่
   * ทั้งหมดจะทะลักออกไปพร้อมกันแล้วซ้ำเติมปลายทางที่เพิ่งจะฟื้น
   */
  allows(now: number = Date.now()): boolean {
    const state = this.state(now);

    if (state === "closed") return true;
    if (state === "open") return false;

    if (this.#probing) return false;
    this.#probing = true;
    this.#log(
      `[breaker] name=${this.name} action=probe state=half_open`,
    );
    return true;
  }

  /** ยิงแล้วสำเร็จ — ล้างประวัติความล้มเหลวและปิดวงจร */
  recordSuccess(now: number = Date.now()): void {
    const wasOpen = this.#openedAt !== null;

    this.#failures = [];
    this.#openedAt = null;
    this.#probing = false;

    if (wasOpen) {
      this.#log(`[breaker] name=${this.name} action=close ts=${now}`);
    }
  }

  /**
   * ยิงแล้วพัง
   *
   * ผู้เรียกต้องนับเฉพาะความล้มเหลวที่แปลว่า "ปลายทางมีปัญหา" เท่านั้น
   * เช่น timeout, 5xx, ชนลิมิตจนเอาไม่อยู่ ส่วน "ไม่พบเลขนี้" คือคำตอบที่
   * ถูกต้องของปลายทางที่ทำงานปกติ ห้ามนับ ไม่งั้นวันที่คนค้นเลขผิดกันเยอะๆ
   * วงจรจะถูกตัดทั้งที่ไม่มีอะไรเสีย
   */
  recordFailure(now: number = Date.now()): void {
    this.#probing = false;
    this.#prune(now);
    this.#failures.push(now);

    // อยู่ในช่วงลองแตะดูแล้วพังอีก → พักใหม่ตั้งแต่ต้น
    if (this.#openedAt !== null) {
      this.#openedAt = now;
      this.#log(
        `[breaker] name=${this.name} action=reopen ts=${now} cooldown=${this.cooldownMs}ms`,
      );
      return;
    }

    if (this.#failures.length >= this.failureThreshold) {
      this.#openedAt = now;
      this.#log(
        `[breaker] name=${this.name} action=open ts=${now}` +
          ` failures=${this.#failures.length}/${this.failureThreshold}` +
          ` window=${this.windowMs}ms cooldown=${this.cooldownMs}ms`,
      );
    }
  }

  /** คืนสู่สภาพเริ่มต้น — ใช้ในเทสต์ */
  reset(): void {
    this.#failures = [];
    this.#openedAt = null;
    this.#probing = false;
  }
}
