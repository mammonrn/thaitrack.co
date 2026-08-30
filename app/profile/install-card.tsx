"use client";

import { useInstallState } from "@/lib/use-install-state";
import InstallGuideDialog from "../install-guide-dialog";

const PRIMARY_BUTTON =
  "mt-4 inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong";

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

/**
 * การ์ดชวนติดตั้งแอพในหน้าโปรไฟล์
 *
 * ต่างจากปุ่มบนหัวเว็บตรงที่การ์ดนี้พูดครบทุกสถานะ ไม่ซ่อนตัวเอง เพราะผู้ใช้ที่
 * ตั้งใจเข้ามาหา "ดาวน์โหลด" แล้วไม่เจออะไรเลยจะคิดว่าเว็บพัง ถ้าติดตั้งไม่ได้จริง
 * ก็ต้องบอกว่าทำไมและต้องทำอย่างไรถึงจะได้
 */
export default function InstallCard() {
  const { state, install, isGuideOpen, openGuide, closeGuide } =
    useInstallState();

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-start gap-4 p-5">
        <span
          className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
            state === "installed"
              ? "border-ok/30 bg-ok/10 text-ok"
              : "border-line-strong bg-paper text-ink"
          }`}
        >
          {state === "installed" ? (
            <CheckIcon className="h-5 w-5" />
          ) : (
            <PhoneIcon className="h-5 w-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {state === "installed" ? "ติดตั้งแล้ว" : "ติดตั้งเป็นแอพ"}
          </h2>

          {state === "installed" && (
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              คุณกำลังเปิดจากหน้าจอโฮมอยู่ เปิดใช้ได้เลยไม่ต้องพิมพ์ที่อยู่เว็บ
            </p>
          )}

          {state === "promptable" && (
            <>
              <p className="mt-1.5 text-sm leading-relaxed text-faint">
                เพิ่มไว้บนหน้าจอโฮม เปิดได้เหมือนแอพ ไม่ต้องพิมพ์ที่อยู่เว็บทุกครั้ง
              </p>
              <button
                type="button"
                onClick={() => void install()}
                className={PRIMARY_BUTTON}
              >
                ติดตั้งเลย
              </button>
            </>
          )}

          {state === "manual" && (
            <>
              <p className="mt-1.5 text-sm leading-relaxed text-faint">
                Safari ติดตั้งให้อัตโนมัติไม่ได้ ต้องกดเพิ่มเอง 2 ขั้นตอน ใช้เวลาไม่ถึงนาที
              </p>
              <button type="button" onClick={openGuide} className={PRIMARY_BUTTON}>
                ดูวิธีติดตั้ง
              </button>
            </>
          )}

          {state === "checking" && (
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              กำลังตรวจสอบว่าเบราว์เซอร์นี้ติดตั้งได้หรือไม่
            </p>
          )}

          {state === "unsupported" && (
            <p className="mt-1.5 text-sm leading-relaxed text-faint">
              เบราว์เซอร์นี้ยังติดตั้งเป็นแอพไม่ได้ ลองเปิดเว็บนี้ด้วย Chrome บนแอนดรอยด์
              หรือ Safari บน iPhone แล้วกลับมาที่หน้านี้อีกครั้ง
            </p>
          )}
        </div>
      </div>

      <InstallGuideDialog open={isGuideOpen} onClose={closeGuide} />
    </section>
  );
}
