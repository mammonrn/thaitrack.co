import Link from "next/link";
import type { Metadata } from "next";

import InstallCard from "./install-card";
import ProfilePanel from "./profile-panel";

export const metadata: Metadata = {
  title: "โปรไฟล์ — พัสดุไทย.com",
  description: "บัญชีที่เข้าสู่ระบบอยู่ และการติดตั้งเว็บนี้เป็นแอพบนเครื่อง",
};

/**
 * หน้าโปรไฟล์
 *
 * ตัวหน้าเป็น static ล้วน ส่วนที่ต้องรู้ว่าใครล็อกอินอยู่แยกเป็น client component
 * เพราะสถานะสมาชิกอยู่ใน cookie ฝั่งเบราว์เซอร์ ทำแบบนี้แล้วหน้านี้ยัง prerender
 * ตอน build ได้ ผู้ใช้จึงเห็นโครงหน้าทันทีโดยไม่ต้องรอ server ตอบ
 */
export default function ProfilePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link
            href="/"
            className="font-display text-lg font-bold tracking-tight text-ink sm:text-xl"
          >
            พัสดุไทย
            <span className="font-medium text-faint">.com</span>
          </Link>
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-medium text-faint transition-colors hover:bg-ink/5 hover:text-ink"
          >
            ค้นหาพัสดุ
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            โปรไฟล์
          </h1>
          <p className="mt-2 text-sm text-faint">
            บัญชีที่ใช้อยู่ และการติดตั้งเว็บนี้ลงเครื่อง
          </p>

          <ProfilePanel />
          <InstallCard />
        </div>
      </main>
    </div>
  );
}
