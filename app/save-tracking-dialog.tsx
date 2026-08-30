"use client";

import { useEffect, useRef, useState } from "react";

import { NICKNAME_MAX_LENGTH } from "@/lib/saved-trackings";

interface SaveTrackingDialogProps {
  open: boolean;
  trackingNumber: string;
  /** ชื่อเล่นเดิม ถ้าเลขนี้เคยบันทึกไว้แล้ว */
  defaultNickname: string;
  onConfirm: (nickname: string) => void;
  onCancel: () => void;
}

const CONFIRM_VALUE = "confirm";

/**
 * กล่องตั้งชื่อเล่นก่อนบันทึกเข้าประวัติ
 *
 * ใช้ <dialog> ของเบราว์เซอร์ด้วยเหตุผลเดียวกับ logout-dialog.tsx คือได้ focus
 * trap, ปิดด้วย Escape และคืนโฟกัสกลับปุ่มเดิมมาให้ครบโดยไม่ต้องเขียน JS เอง
 */
export default function SaveTrackingDialog({
  open,
  trackingNumber,
  defaultNickname,
  onConfirm,
  onCancel,
}: SaveTrackingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [nickname, setNickname] = useState(defaultNickname);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      // ค่าเดิมค้างจากการเปิดครั้งก่อน ต้องล้างก่อนเสมอ
      dialog.returnValue = "";
      setNickname(defaultNickname);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, defaultNickname]);

  function handleClose() {
    if (dialogRef.current?.returnValue === CONFIRM_VALUE) onConfirm(nickname);
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
      aria-labelledby="save-dialog-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl animate-rise backdrop:bg-ink/40"
    >
      <div className="p-5 sm:p-6">
        <h2
          id="save-dialog-title"
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          บันทึกพัสดุนี้ไว้
        </h2>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-faint">
          {trackingNumber}
        </p>

        {/* method="dialog" ทำให้ปุ่มปิดกล่องเองพร้อมส่งค่ากลับ และกด Enter
            ในช่องกรอกจะ submit เป็นการยืนยันให้อัตโนมัติ */}
        <form method="dialog" className="mt-4">
          <label
            htmlFor="save-nickname"
            className="block text-sm font-medium text-ink"
          >
            ตั้งชื่อเล่น <span className="font-normal text-faint">(ไม่บังคับ)</span>
          </label>
          <input
            id="save-nickname"
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            maxLength={NICKNAME_MAX_LENGTH}
            placeholder="เช่น รองเท้าที่สั่งให้แม่"
            className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-base text-body outline-none transition-colors placeholder:text-faint/70 hover:border-ink/30 focus:border-ink"
          />
          <p className="mt-1.5 text-xs text-faint">
            เว้นว่างไว้ได้ ระบบจะใช้เลขพัสดุเป็นชื่อแทน
          </p>

          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="submit"
              value=""
              className="h-11 rounded-xl border border-line-strong bg-white px-5 text-sm font-medium text-ink transition-colors hover:bg-ink/5 sm:h-10"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              value={CONFIRM_VALUE}
              className="h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong sm:h-10"
            >
              บันทึก
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
