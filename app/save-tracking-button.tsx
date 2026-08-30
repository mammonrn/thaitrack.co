"use client";

import { useCallback, useState } from "react";

import { saveTracking } from "@/lib/saved-trackings";
import type { UserFacingError } from "@/lib/tracking-view";
import { useSessionUser } from "@/lib/use-session-user";
import SaveTrackingDialog from "./save-tracking-dialog";

interface SaveTrackingButtonProps {
  trackingNumber: string;
}

/**
 * ปุ่ม "บันทึกไว้" ที่มุมล่างของการ์ดผลลัพธ์
 *
 * โผล่เฉพาะตอนล็อกอินแล้ว ผู้ที่ยังไม่ล็อกอินจะไม่เห็นปุ่มนี้เลย เพื่อไม่ให้
 * ต้องเจอทางตันหลังกด
 */
export default function SaveTrackingButton({
  trackingNumber,
}: SaveTrackingButtonProps) {
  const { user, isResolved } = useSessionUser();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNickname, setSavedNickname] = useState("");
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  const handleConfirm = useCallback(
    async (nickname: string) => {
      setIsDialogOpen(false);
      setIsSaving(true);
      setError(null);

      const outcome = await saveTracking(trackingNumber, nickname);

      if (outcome.ok) {
        // จำชื่อเล่นไว้ ถ้าผู้ใช้กดบันทึกซ้ำจะได้เห็นค่าเดิมในช่องกรอก
        setSavedNickname(outcome.saved.nickname ?? "");
        setIsSaved(true);
      } else {
        setError(outcome.error);
      }

      setIsSaving(false);
    },
    [trackingNumber],
  );

  if (!isResolved || user === null) return null;

  return (
    <div className="border-t border-line px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          disabled={isSaving}
          className="h-10 rounded-xl border border-line-strong bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "กำลังบันทึก" : isSaved ? "บันทึกแล้ว · แก้ชื่อเล่น" : "บันทึกไว้"}
        </button>

        {isSaved && error === null && (
          <p className="text-sm text-ok">เก็บไว้ในประวัติแล้ว</p>
        )}
      </div>

      {error !== null && (
        <div role="alert" className="mt-3">
          <p className="text-sm font-semibold text-seal">{error.title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-faint">
            {error.detail}
          </p>
        </div>
      )}

      <SaveTrackingDialog
        open={isDialogOpen}
        trackingNumber={trackingNumber}
        defaultNickname={savedNickname}
        onConfirm={handleConfirm}
        onCancel={() => setIsDialogOpen(false)}
      />
    </div>
  );
}
