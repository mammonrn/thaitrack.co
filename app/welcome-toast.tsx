"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/** สั้นพอที่จะไม่เกะกะ แต่ยังนานพอให้อ่านชื่อตัวเองทัน */
const AUTO_DISMISS_MS = 3500;

interface WelcomeToastProps {
  /** ชื่อผู้ใช้ ค่าว่างแปลว่าอ่านชื่อไม่ได้ ให้ทักแบบไม่ระบุชื่อแทน */
  userName: string;
  onDismiss: () => void;
}

/**
 * แถบต้อนรับหลังเข้าสู่ระบบสำเร็จ
 *
 * ขึ้นเฉพาะตอนที่ /auth/callback ยืนยันว่าเพิ่งแลก code สำเร็จจริง ไม่ได้ดูจาก
 * การมี session อยู่ จึงไม่โผล่ซ้ำเวลา reload หน้าโดยที่ยังล็อกอินค้าง
 *
 * ต้องแขวนไว้ที่ <body> ผ่าน portal เพราะปุ่มที่เรียกใช้อยู่ในหัวเว็บที่มี
 * backdrop-blur ซึ่ง backdrop-filter ทำให้ element นั้นกลายเป็น containing block
 * ของลูกที่เป็น position: fixed แถบนี้จึงถูกดึงไปวางเทียบกับหัวเว็บแทนที่จะเป็น
 * ขอบจอ (วัดได้จริงว่าไปโผล่ที่ y = -32px คือเลยขอบบนจอออกไป มองไม่เห็น)
 */
export default function WelcomeToast({
  userName,
  onDismiss,
}: WelcomeToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return createPortal(
    <div
      // status ไม่ขัดจังหวะสิ่งที่ screen reader กำลังอ่านอยู่ ต่างจาก alert
      role="status"
      aria-live="polite"
      // ยกให้พ้นแถบเมนูล่างจอ (สูง ~56px + safe area) ไม่งั้นแถบเมนูจะบังทับ
      className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 animate-rise sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-line-strong bg-white p-3.5 shadow-xl">
        {/* ตราประทับเล็กๆ ให้เข้ากับธีมเอกสารไปรษณีย์ */}
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ok text-ok"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10.5 8 14.5 16 6" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold tracking-tight text-ink">
            เข้าสู่ระบบแล้ว
          </p>
          <p className="mt-0.5 truncate text-sm text-faint">
            {userName === "" ? "ยินดีต้อนรับ" : `ยินดีต้อนรับ ${userName}`}
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="ปิดข้อความต้อนรับ"
          className="-m-1 shrink-0 rounded-lg p-1 text-faint transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}
