"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

/** สั้นพอไม่เกะกะ แต่นานพอให้กดลิงก์ไปหน้าประวัติทัน */
const AUTO_DISMISS_MS = 5000;

interface SavedToastProps {
  /** ชื่อที่บันทึกไว้ ใช้ยืนยันให้ผู้ใช้เห็นว่าบันทึกอันไหน */
  title: string;
  onDismiss: () => void;
}

/**
 * แถบยืนยันหลังบันทึกพัสดุ
 *
 * มีลิงก์ไปหน้าประวัติแต่ไม่พาไปเอง เพราะหลายคนกดบันทึกแล้วยังอยากอ่านไทม์ไลน์
 * ต่อ การดึงออกจากหน้าที่กำลังดูอยู่รบกวนกว่าที่ควร
 *
 * แขวนไว้ที่ body ผ่าน portal เพราะการ์ดผลลัพธ์อยู่ในสายเนื้อหาที่มี ancestor
 * สร้าง containing block ได้ และต้องยกให้พ้นแถบเมนูล่างจอด้วย
 */
export default function SavedToast({ title, onDismiss }: SavedToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      // ยกให้พ้นแถบเมนูล่างจอ (สูง ~56px) ไม่งั้นแถบเมนูจะบังทับ
      className="fixed inset-x-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 animate-rise sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-line-strong bg-white p-3.5 shadow-xl">
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
            บันทึกแล้ว
          </p>
          <p className="mt-0.5 truncate text-sm text-faint">{title}</p>
          <Link
            href="/history"
            className="mt-1.5 inline-block text-sm font-medium text-ink underline underline-offset-2"
          >
            ดูในประวัติ
          </Link>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="ปิดข้อความ"
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
