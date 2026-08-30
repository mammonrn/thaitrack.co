/**
 * fetch ที่มีเพดานเวลาสำหรับเรียก Supabase
 *
 * supabase-js ไม่ได้ตั้ง timeout มาให้ ถ้าเครื่องต่อไปหา Supabase ไม่ได้จริงๆ
 * (firewall ปิดขาออก, DNS เพี้ยน, เครือข่ายกินแพ็กเก็ตเงียบๆ) การเรียกจะค้างรอ
 * ไปเรื่อยๆ โดยไม่โยน error
 *
 * อาการที่ตามมาคือฝั่ง server ค้างจน reverse proxy หมดเวลารอแล้วโยน 502/504
 * ให้ผู้ใช้ ส่วน log ของแอพไม่มีอะไรขึ้นเลย เพราะ request ยังไม่จบ จึงหาสาเหตุ
 * ไม่เจอ ที่นี่บังคับให้ล้มเหลวเร็วและดัง แทนที่จะค้างเงียบ
 */

/** 8 วินาทีพอสำหรับเครือข่ายที่ช้าแต่ยังใช้ได้ และสั้นกว่า timeout ของ reverse proxy ทั่วไป (60s) มาก */
export const SUPABASE_TIMEOUT_MS = 8000;

export function createTimeoutFetch(
  timeoutMs: number = SUPABASE_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // ถ้าผู้เรียกส่ง signal มาเองอยู่แล้ว ต้องเคารพด้วย ไม่ใช่ทิ้งของเดิม
    const callerSignal = init?.signal;
    const forwardAbort = () => controller.abort();
    callerSignal?.addEventListener("abort", forwardAbort);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}
