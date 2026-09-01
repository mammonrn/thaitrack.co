import Link from "next/link";

import AuthButton from "./auth-button";
import InstallButton from "./install-button";

/**
 * หัวเว็บที่ใช้ร่วมกันทุกหน้าฝั่งผู้ใช้
 *
 * แยกออกมาตอนทำหน้า landing รายขนส่ง เพราะหน้าพวกนั้นต้องมีหัวเว็บเหมือนกันเป๊ะ
 * การก๊อปปี้ไปวางจะทำให้วันที่เพิ่มเมนูใหม่ มันโผล่แค่บางหน้า
 *
 * เป็น server component ได้เพราะไม่มี state ของตัวเอง — ปุ่มสองตัวข้างในเป็น
 * client component ซึ่งประกอบเข้ามาได้ตามปกติ
 */
export default function SiteHeader() {
  return (
  <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
    <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:h-16 sm:px-6">
      <Link href="/" className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8 text-ink sm:h-9 sm:w-9" />
        <span className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
          พัสดุไทย
          <span className="font-medium text-faint">.com</span>
        </span>
      </Link>

      <div className="flex items-center gap-1">
        <InstallButton />
        <AuthButton />
      </div>
    </div>
  </header>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="7" width="24" height="17" rx="2.5" />
      <path d="M2.4 8.2 L13.5 16.8 L24.6 8.2" />
      <circle
        cx="24.5"
        cy="23.5"
        r="6.2"
        fill="var(--color-paper)"
        strokeDasharray="2.4 2.6"
      />
    </svg>
  );
}
