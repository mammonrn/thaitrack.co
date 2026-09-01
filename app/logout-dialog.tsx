"use client";

import { useEffect, useRef } from "react";

interface LogoutDialogProps {
  open: boolean;
  /** ชื่อที่แสดงในคำถาม ช่วยกันกดผิดตอนใช้เครื่องร่วมกับคนอื่น */
  userName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** ค่า returnValue ที่แปลว่าผู้ใช้กดยืนยัน ค่าอื่นทั้งหมดถือเป็นยกเลิก */
const CONFIRM_VALUE = "confirm";

/**
 * กล่องยืนยันก่อนออกจากระบบ
 *
 * ใช้ <dialog> ของเบราว์เซอร์แทน modal ที่เขียนเอง เพราะ showModal() ให้ focus
 * trap, ปิดด้วย Escape, คืนโฟกัสกลับปุ่มเดิมตอนปิด และกัน element ข้างหลังไม่ให้
 * ถูกอ่านโดย screen reader มาให้ครบโดยไม่ต้องเขียน JS เอง
 */
export default function LogoutDialog({
  open,
  userName,
  onConfirm,
  onCancel,
}: LogoutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      // returnValue ค้างจากการเปิดครั้งก่อน ต้องล้างก่อน ไม่งั้นการกด Escape
      // รอบถัดไปจะถูกอ่านเป็น "ยืนยัน"
      dialog.returnValue = "";
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // ปิดได้ทั้งจากปุ่ม, Escape และคลิกนอกกล่อง — ทุกทางมาจบที่ event เดียวกัน
  function handleClose() {
    if (dialogRef.current?.returnValue === CONFIRM_VALUE) onConfirm();
    else onCancel();
  }

  // เนื้อหาทั้งหมดอยู่ใน <div> ชั้นใน และ <dialog> ไม่มี padding ของตัวเอง
  // ดังนั้นคลิกที่ตัว <dialog> ตรงๆ ได้ทางเดียวคือคลิกโดนฉากหลัง
  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) dialogRef.current.close("");
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleBackdropClick}
      aria-labelledby="logout-dialog-title"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl animate-rise backdrop:bg-ink/40"
    >
      <div className="p-5 sm:p-6">
        <p
          id="logout-dialog-title"
          role="heading"
          aria-level={2}
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          ต้องการออกจากระบบใช่ไหม
        </p>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          {userName === ""
            ? "หลังออกจากระบบยังค้นหาพัสดุได้ตามปกติ และกลับเข้ามาใหม่เมื่อไรก็ได้"
            : `กำลังใช้งานในชื่อ ${userName} — หลังออกจากระบบยังค้นหาพัสดุได้ตามปกติ`}
        </p>

        {/* method="dialog" ทำให้ปุ่มปิดกล่องเองพร้อมส่งค่ากลับ ไม่ต้องเขียน JS */}
        <form method="dialog" className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            // โฟกัสมาที่ปุ่มปลอดภัยก่อน กัน Enter รัวแล้วหลุดออกจากระบบโดยไม่ตั้งใจ
            autoFocus
            value=""
            className="h-11 rounded-xl border border-line-strong bg-white px-5 text-sm font-medium text-ink transition-colors hover:bg-ink/5 sm:h-10"
          >
            ยกเลิก
          </button>
          <button
            value={CONFIRM_VALUE}
            className="h-11 rounded-xl bg-seal px-5 text-sm font-semibold text-white transition-colors hover:brightness-110 sm:h-10"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </dialog>
  );
}
