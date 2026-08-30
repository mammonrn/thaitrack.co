"use client";

import { useInstallState } from "@/lib/use-install-state";
import InstallGuideDialog from "./install-guide-dialog";

const BUTTON_CLASS =
  "rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink";

/**
 * ปุ่มติดตั้งแอพลงเครื่อง บนหัวเว็บ
 *
 * ซ่อนตัวเองเมื่อไม่มีทางติดตั้งได้จริง (ติดตั้งไปแล้ว หรือเบราว์เซอร์ไม่รองรับ
 * ทั้งสองทาง) ดีกว่าโชว์ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้น ส่วนการ์ดในหน้าโปรไฟล์
 * อธิบายทุกสถานะรวมถึงกรณีที่ติดตั้งไม่ได้ เพราะที่นั่นมีที่ให้อธิบาย
 */
export default function InstallButton() {
  const { state, install, isGuideOpen, openGuide, closeGuide } =
    useInstallState();

  if (state !== "promptable" && state !== "manual") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (state === "promptable") void install();
          else openGuide();
        }}
        className={BUTTON_CLASS}
      >
        ดาวน์โหลด
      </button>

      <InstallGuideDialog open={isGuideOpen} onClose={closeGuide} />
    </>
  );
}
