"use client";

import { useEffect, useRef } from "react";

interface DeleteSavedDialogProps {
  open: boolean;
  /** ชื่อรายการที่กำลังจะลบ ให้ผู้ใช้ยืนยันได้ว่ากดถูกอัน */
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const CONFIRM_VALUE = "confirm";

/**
 * กล่องยืนยันก่อนลบรายการในประวัติ
 *
 * ใช้ <dialog> ของเบราว์เซอร์แบบเดียวกับ logout-dialog.tsx เพื่อให้ได้ focus
 * trap, ปิดด้วย Escape และคืนโฟกัสกลับปุ่มเดิมโดยไม่ต้องเขียน JS เอง
 */
export default function DeleteSavedDialog({
  open,
  title,
  onConfirm,
  onCancel,
}: DeleteSavedDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      dialog.returnValue = "";
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    if (dialogRef.current?.returnValue === CONFIRM_VALUE) onConfirm();
    else onCancel();
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) dialogRef.current.close("");
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleBackdropClick}
      aria-labelledby="delete-dialog-title"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl animate-rise backdrop:bg-ink/40"
    >
      <div className="p-5 sm:p-6">
        <h2
          id="delete-dialog-title"
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          ลบรายการนี้ใช่ไหม
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          {title === ""
            ? "ลบแล้วจะหายไปจากประวัติ ค้นหาเลขเดิมแล้วกดบันทึกใหม่ได้เสมอ"
            : `“${title}” จะหายไปจากประวัติ ค้นหาเลขเดิมแล้วกดบันทึกใหม่ได้เสมอ`}
        </p>

        <form
          method="dialog"
          className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end"
        >
          <button
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
            ลบ
          </button>
        </form>
      </div>
    </dialog>
  );
}
