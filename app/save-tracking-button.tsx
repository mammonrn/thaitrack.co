"use client";

import { useCallback, useEffect, useState } from "react";

import {
  displayTitleOf,
  findSavedTracking,
  saveTracking,
  type SavedTracking,
} from "@/lib/saved-trackings";
import type { UserFacingError } from "@/lib/tracking-view";
import { useSessionUser } from "@/lib/use-session-user";
import SaveTrackingDialog from "./save-tracking-dialog";
import SavedToast from "./saved-toast";
import SignInPromptDialog from "./sign-in-prompt-dialog";

interface SaveTrackingButtonProps {
  trackingNumber: string;
  /**
   * รายการที่บันทึกไว้ของเลขนี้เปลี่ยน — null คือยังไม่ได้บันทึก
   *
   * ปุ่มนี้เป็นที่เดียวที่รู้ว่าเลขนี้ถูกบันทึกไว้หรือยัง (มันเป็นคนถามเอง)
   * หัวการ์ดต้องใช้ชื่อเล่นจากตรงนี้ด้วย จึงส่งขึ้นไปให้แทนที่จะให้พ่อถามซ้ำ
   *
   * ต้องเป็นฟังก์ชันที่ identity คงที่ (useCallback) ไม่งั้น effect จะวนไม่จบ
   */
  onSavedChange?: (saved: SavedTracking | null) => void;
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4.5h12a1 1 0 0 1 1 1v14l-7-4-7 4v-14a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/**
 * ปุ่มบันทึกบนหัวการ์ดผลลัพธ์
 *
 * อยู่บนสุดเพื่อให้เห็นทันทีโดยไม่ต้องเลื่อนผ่านไทม์ไลน์ทั้งหมด และรวมการตั้ง
 * ชื่อเล่นไว้ในกล่องเดียวจบ ไม่ต้องไปตั้งทีหลังที่หน้าประวัติ
 *
 * ผู้ที่ยังไม่ล็อกอินก็เห็นปุ่มนี้ กดแล้วจะชวนเข้าสู่ระบบก่อน เพราะการซ่อนปุ่ม
 * ไปเลยทำให้ไม่มีใครรู้ว่าเว็บบันทึกพัสดุได้
 */
export default function SaveTrackingButton({
  trackingNumber,
  onSavedChange,
}: SaveTrackingButtonProps) {
  const { user } = useSessionUser();

  /**
   * ผลการถามว่าเลขนี้เคยบันทึกไว้ไหม ผูกไว้กับเลขที่ถามด้วยเสมอ
   *
   * ผูกคู่กันเพราะ props เปลี่ยนเป็นเลขใหม่ได้ก่อนที่คำตอบของเลขนั้นจะกลับมา
   * ถ้าเก็บแต่ผลลัพธ์เดี่ยวๆ ช่วงนั้นปุ่มจะขึ้น "บันทึกแล้ว" และหัวการ์ดจะขึ้น
   * ชื่อเล่นของพัสดุคนละชิ้น การเทียบเลขตอน render ทำให้ของเก่าใช้ไม่ได้ทันที
   * โดยไม่ต้อง setState ใน effect (ซึ่งทำให้เกิด cascading render)
   */
  const [loaded, setLoaded] = useState<{
    trackingNumber: string;
    saved: SavedTracking | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [toastTitle, setToastTitle] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  const saved =
    loaded !== null && loaded.trackingNumber === trackingNumber
      ? loaded.saved
      : null;

  // ถามว่าเลขนี้เคยบันทึกไว้แล้วหรือยัง เพื่อขึ้นปุ่มให้ตรงตั้งแต่แรกเห็น
  useEffect(() => {
    if (user === null) return;

    let isActive = true;

    async function load() {
      const existing = await findSavedTracking(trackingNumber);
      if (isActive) setLoaded({ trackingNumber, saved: existing });
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [trackingNumber, user]);

  // ส่งต่อทุกครั้งที่เปลี่ยน ครอบทั้งตอนโหลดครั้งแรกและตอนเพิ่งกดบันทึก
  useEffect(() => {
    onSavedChange?.(saved);
  }, [saved, onSavedChange]);

  const handleConfirm = useCallback(
    async (nickname: string) => {
      setIsDialogOpen(false);
      setIsSaving(true);
      setError(null);

      const outcome = await saveTracking(trackingNumber, nickname);

      if (outcome.ok) {
        setLoaded({ trackingNumber, saved: outcome.saved });
        setToastTitle(displayTitleOf(outcome.saved));
      } else {
        setError(outcome.error);
      }

      setIsSaving(false);
    },
    [trackingNumber],
  );

  const dismissToast = useCallback(() => setToastTitle(null), []);

  function handleClick() {
    if (user === null) {
      setIsSignInOpen(true);
      return;
    }
    setIsDialogOpen(true);
  }

  const isSaved = saved !== null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isSaving}
        aria-label={isSaved ? "แก้ชื่อที่บันทึกไว้" : "บันทึกพัสดุนี้ไว้"}
        className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isSaved
            ? "border-ok/40 bg-ok/8 text-ok hover:bg-ok/15"
            : "border-line-strong bg-white text-ink hover:bg-ink/5"
        }`}
      >
        <BookmarkIcon filled={isSaved} />
        {isSaving ? "กำลังบันทึก" : isSaved ? "บันทึกแล้ว" : "บันทึก"}
      </button>

      {error !== null && (
        <div role="alert" className="mt-2 basis-full">
          <p className="text-sm font-semibold text-seal">{error.title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-faint">
            {error.detail}
          </p>
        </div>
      )}

      {isDialogOpen && (
        <SaveTrackingDialog
          trackingNumber={trackingNumber}
          defaultNickname={saved?.nickname ?? ""}
          isEditing={isSaved}
          onConfirm={handleConfirm}
          onCancel={() => setIsDialogOpen(false)}
        />
      )}

      {isSignInOpen && (
        <SignInPromptDialog onClose={() => setIsSignInOpen(false)} />
      )}

      {toastTitle !== null && (
        <SavedToast title={toastTitle} onDismiss={dismissToast} />
      )}
    </>
  );
}
