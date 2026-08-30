"use client";

import { useEffect, useRef } from "react";

interface InstallGuideDialogProps {
  open: boolean;
  onClose: () => void;
}

/** ไอคอนแชร์ของ iOS (สี่เหลี่ยมมีลูกศรพุ่งขึ้น) วาดด้วยเส้นให้เข้าชุดกับโลโก้ */
function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function PlusSquareIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

/**
 * วิธีติดตั้งบน iOS
 *
 * Safari ไม่มี API ให้เรียกหน้าต่างติดตั้งเหมือน Chrome ทางเดียวคือผู้ใช้กด
 * ปุ่มแชร์เอง จึงต้องบอกขั้นตอนให้ชัด ใช้ <dialog> แบบเดียวกับกล่องอื่นในเว็บ
 * เพื่อให้ได้ focus trap และปิดด้วย Escape มาให้ครบ
 */
export default function InstallGuideDialog({
  open,
  onClose,
}: InstallGuideDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) dialogRef.current.close();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="install-guide-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-paper p-0 text-body shadow-2xl animate-rise backdrop:bg-ink/40"
    >
      <div className="p-5 sm:p-6">
        <h2
          id="install-guide-title"
          className="font-display text-lg font-bold tracking-tight text-ink"
        >
          เพิ่มลงหน้าจอโฮม
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-faint">
          เปิดใช้เหมือนแอพได้เลย ไม่ต้องพิมพ์ที่อยู่เว็บทุกครั้ง
        </p>

        <ol className="mt-4 flex flex-col gap-3">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-white text-ink">
              <ShareIcon className="h-4 w-4" />
            </span>
            <p className="flex-1 text-sm leading-relaxed text-body">
              กดปุ่ม <span className="font-medium text-ink">แชร์</span>{" "}
              ที่แถบด้านล่างของ Safari
            </p>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-white text-ink">
              <PlusSquareIcon className="h-4 w-4" />
            </span>
            <p className="flex-1 text-sm leading-relaxed text-body">
              เลื่อนหาแล้วกด{" "}
              <span className="font-medium text-ink">เพิ่มไปที่หน้าจอโฮม</span>
            </p>
          </li>
        </ol>

        <form method="dialog" className="mt-5 flex justify-end">
          <button
            autoFocus
            className="h-11 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-strong sm:h-10"
          >
            เข้าใจแล้ว
          </button>
        </form>
      </div>
    </dialog>
  );
}
