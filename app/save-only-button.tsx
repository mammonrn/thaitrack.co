"use client";

/**
 * ปุ่ม "บันทึกไว้" ที่ฟอร์มหน้าแรก — เก็บเลขไว้เฉยๆ **ไม่ยิงถามขนส่งเลย**
 *
 * ------------------------------------------------------------------
 * ⚠️ คนละปุ่มกับ "ค้นหาพัสดุ" และห้ามทำให้สับสนกัน
 *
 *   ค้นหาพัสดุ   ยิง API ทันที — คำสัญญาหลักของสินค้า ("พิมพ์เลขพัสดุครั้งเดียว
 *                เราไล่ถามให้ทุกขนส่ง") ห้ามแตะเด็ดขาด
 *   บันทึกไว้     ไม่ยิงอะไรเลย เก็บเลขกับชื่อที่ตั้งไว้ลงประวัติ แล้วค่อยกดค้น
 *                ทีหลังจากหน้าประวัติเมื่ออยากรู้
 *
 * ปุ่มที่สองมีไว้สำหรับคนที่ "เพิ่งได้เลขมา ยังไม่อยากรู้ตอนนี้" ซึ่งเดิมต้อง
 * ค้นก่อนถึงจะบันทึกได้ — เสียโควตาไปกับความอยากรู้ที่ยังไม่เกิด
 * ------------------------------------------------------------------
 *
 * ต่างจาก SaveTrackingButton (บนการ์ดผลลัพธ์) ตรงที่อันนั้นบันทึกพร้อมสถานะที่
 * เพิ่งค้นได้ (ซึ่งอยู่ใน cache แล้ว ไม่เสียอะไรเพิ่ม) ส่วนอันนี้ไม่มีสถานะให้
 * บันทึกเพราะยังไม่เคยค้น
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { displayTitleOf, saveTracking } from "@/lib/saved-trackings";
import type { UserFacingError } from "@/lib/tracking-view";
import { useSessionUser } from "@/lib/use-session-user";
import SavedToast from "./saved-toast";
import SignInPromptDialog from "./sign-in-prompt-dialog";

interface SaveOnlyButtonProps {
  /** เลขที่พิมพ์อยู่ในช่อง — ปุ่มถูกปิดเมื่อยังว่าง */
  trackingNumber: string;
  /** ชื่อที่ผู้ใช้ตั้งไว้ในฟอร์ม — เว้นว่างได้ */
  nickname: string;
  /** บันทึกสำเร็จแล้ว ให้ฟอร์มล้างช่องชื่อ */
  onSaved: () => void;
}

export default function SaveOnlyButton({
  trackingNumber,
  nickname,
  onSaved,
}: SaveOnlyButtonProps) {
  const { user } = useSessionUser();
  const router = useRouter();

  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastTitle, setToastTitle] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  const trimmed = trackingNumber.trim();

  /**
   * บันทึกทันทีที่กด ไม่มีกล่องถามชื่อคั่นกลาง
   *
   * ชื่ออยู่ในฟอร์มเดียวกันแล้ว (ดู tracking-search.tsx) การเด้งกล่องมาถามซ้ำ
   * คือการถามสิ่งที่ผู้ใช้เพิ่งกรอกไปเมื่อครู่ — ต่างจากปุ่มบันทึกบนการ์ด
   * ผลลัพธ์ ซึ่งไม่มีช่องชื่อให้กรอกจึงยังต้องใช้กล่อง
   */
  const handleSave = useCallback(
    async () => {
      setIsSaving(true);
      setError(null);

      // lookup: false คือหัวใจของปุ่มนี้ — ถ้าหายไปเมื่อไร ปุ่มจะกลายเป็นการ
      // ค้นหาเงียบๆ ที่ผู้ใช้ไม่ได้ขอ (มีเทสต์เฝ้าที่ lib/history-refresh.test.ts)
      const outcome = await saveTracking(trimmed, nickname, { lookup: false });

      if (outcome.ok) {
        setToastTitle(displayTitleOf(outcome.saved));
        onSaved();
        // พาไปหน้าประวัติเพื่อให้เห็นว่าของถูกเก็บไว้จริง และเห็นปุ่มค้นหา
        // ที่กดได้เมื่ออยากรู้ — refresh เพื่อให้รายการใหม่โผล่ทันที
        router.refresh();
      } else {
        setError(outcome.error);
      }

      setIsSaving(false);
    },
    [nickname, onSaved, router, trimmed],
  );

  function handleClick() {
    if (user === null) {
      setIsSignInOpen(true);
      return;
    }
    void handleSave();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={isSaving || trimmed === ""}
        className="h-14 shrink-0 rounded-xl border border-line-strong bg-white px-6 font-display text-base font-semibold text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50 sm:h-15 sm:text-lg"
      >
        {isSaving ? "กำลังบันทึก…" : "บันทึกไว้"}
      </button>

      {error !== null && (
        <div role="alert" className="mt-2 basis-full">
          <p className="text-sm font-semibold text-seal">{error.title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-faint">
            {error.detail}
          </p>
        </div>
      )}

      {isSignInOpen && (
        <SignInPromptDialog onClose={() => setIsSignInOpen(false)} />
      )}

      {toastTitle !== null && (
        <SavedToast title={toastTitle} onDismiss={() => setToastTitle(null)} />
      )}
    </>
  );
}
