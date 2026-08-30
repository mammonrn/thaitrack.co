/**
 * อ่านบาร์โค้ด/QR จากภาพกล้อง
 *
 * ใช้ BarcodeDetector ของเบราว์เซอร์เป็นหลักเพราะเร็วกว่าและไม่ต้องโหลดอะไรเพิ่ม
 * (Chrome บน Android รองรับ) ส่วนเบราว์เซอร์ที่ไม่มี API นี้ — ที่สำคัญคือ
 * Safari บน iOS — ค่อยโหลด @zxing/browser มาใช้แทน
 *
 * ไลบรารีสำรองถูก import แบบ dynamic ในฟังก์ชัน ไม่ใช่ที่หัวไฟล์ เพื่อให้
 * bundler แยกเป็น chunk ต่างหาก ผู้ใช้ที่ไม่กดปุ่มกล้องจะไม่ต้องโหลดเลย
 */

/** รูปแบบที่ขนส่งไทยใช้จริง — QR กับ Code 128 เป็นสองอันหลัก */
const WANTED_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "itf",
  "ean_13",
] as const;

export interface ScannerControls {
  stop(): void;
}

type OnResult = (value: string) => void;

/** BarcodeDetector ยังไม่อยู่ใน TypeScript DOM lib จึงประกาศเท่าที่ใช้ */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

function getNativeDetector(): BarcodeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === "function"
    ? (candidate as BarcodeDetectorConstructor)
    : null;
}

/** เบราว์เซอร์นี้อ่านบาร์โค้ดได้เองไหม (ใช้ตัดสินใจว่าต้องโหลดไลบรารีสำรองหรือเปล่า) */
export function hasNativeBarcodeDetector(): boolean {
  return getNativeDetector() !== null;
}

/** อ่านด้วย API ของเบราว์เซอร์ วนอ่านทีละเฟรมตามจังหวะการวาดจอ */
async function startWithNativeDetector(
  detectorClass: BarcodeDetectorConstructor,
  video: HTMLVideoElement,
  onResult: OnResult,
): Promise<ScannerControls> {
  const supported = await detectorClass.getSupportedFormats();
  const formats = WANTED_FORMATS.filter((format) => supported.includes(format));

  const detector = new detectorClass(
    formats.length > 0 ? { formats: [...formats] } : undefined,
  );

  let stopped = false;
  let frame = 0;

  async function tick() {
    if (stopped) return;

    // ข้ามไปก่อนถ้าเฟรมยังไม่พร้อม detect() จะโยน error ถ้าวิดีโอยังไม่มีภาพ
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue?.trim();
        if (value !== undefined && value !== "") {
          onResult(value);
          return;
        }
      } catch (error) {
        console.error("[scan] อ่านเฟรมไม่สำเร็จ:", error);
      }
    }

    if (!stopped) frame = requestAnimationFrame(() => void tick());
  }

  frame = requestAnimationFrame(() => void tick());

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
    },
  };
}

/** โหลด @zxing/browser ตอนใช้จริงเท่านั้น */
async function startWithZxing(
  video: HTMLVideoElement,
  onResult: OnResult,
): Promise<ScannerControls> {
  const { BrowserMultiFormatReader } = await import("@zxing/browser");

  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    const value = result?.getText().trim();
    if (value !== undefined && value !== "") onResult(value);
  });

  return { stop: () => controls.stop() };
}

/**
 * เริ่มอ่านจาก <video> ที่มีภาพกล้องอยู่แล้ว
 *
 * ผู้เรียกเป็นเจ้าของ MediaStream เอง ฟังก์ชันนี้ไม่ยุ่งกับการเปิด/ปิดกล้อง
 * เพื่อให้การคืนกล้องอยู่ที่เดียวและมั่นใจได้ว่าไม่ค้าง
 */
export async function startScanning(
  video: HTMLVideoElement,
  onResult: OnResult,
): Promise<ScannerControls> {
  const detectorClass = getNativeDetector();

  if (detectorClass !== null) {
    return startWithNativeDetector(detectorClass, video, onResult);
  }

  return startWithZxing(video, onResult);
}
