"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { signInWithGoogle } from "@/lib/auth-view";
import type { UserFacingError } from "@/lib/tracking-view";

interface SignInPromptDialogProps {
  onClose: () => void;
}

/**
 * ชวนเข้าสู่ระบบเมื่อกดบันทึกทั้งที่ยังไม่ได้ล็อกอิน
 *
 * ให้เข้าสู่ระบบได้จากตรงนี้เลย ไม่ต้องไล่ผู้ใช้ไปกดปุ่มมุมขวาบนเอง เพราะเขา
 * แสดงเจตนาชัดแล้วว่าอยากบันทึก
 */
export default function SignInPromptDialog({ onClose }: SignInPromptDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const handleSignIn = useCallback(async () => {
    setIsWorking(true);
    setError(null);

    const outcome = await signInWithGoogle();

    // สำเร็จ = เบราว์เซอร์กำลังถูกพาไป Google คงปุ่มไว้ไม่ให้กดซ้ำ
    if (outcome.ok) return;

    setError(outcome.error);
    setIsWorking(false);
  }, []);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="signin-prompt-title"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl animate-rise backdrop:bg-ink/40"
    >
      <div className="p-5 sm:p-6">
        <h2
          id="signin-prompt-title"
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          เข้าสู่ระบบก่อนบันทึก
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          บันทึกแล้วจะกลับมาดูสถานะพัสดุชิ้นนี้ได้ทุกเมื่อ โดยไม่ต้องพิมพ์เลขใหม่
        </p>

        {error !== null && (
          <div role="alert" className="mt-3">
            <p className="text-sm font-semibold text-seal">{error.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-faint">
              {error.detail}
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-line-strong bg-white px-5 text-sm font-medium text-ink transition-colors hover:bg-ink/5 sm:h-10"
          >
            ไว้ก่อน
          </button>
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={isWorking}
            className="h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong disabled:cursor-not-allowed disabled:opacity-60 sm:h-10"
          >
            {isWorking ? "กำลังดำเนินการ" : "เข้าสู่ระบบด้วย Google"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
