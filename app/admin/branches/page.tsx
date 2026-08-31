/**
 * /admin/branches — หน้าเติมพิกัดสาขาให้แอดมิน
 *
 * ⚠️ ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์ก่อน render อะไรทั้งสิ้น ถ้าไม่ผ่านตอบ 404
 *
 * ทำไม 404 ไม่ใช่ 403: 403 บอกคนที่เปิดเจอว่า "หน้านี้มีอยู่จริง แค่คุณเข้าไม่ได้"
 * ซึ่งเป็นข้อมูลที่ไม่จำเป็นต้องให้ 404 ทำให้หน้านี้ไม่ต่างจาก URL ที่ไม่มีอยู่จริง
 *
 * การตรวจตรงนี้กันคนไม่ให้ "เห็นหน้า" เท่านั้น ส่วนการกัน "การเขียนข้อมูล"
 * อยู่ที่ app/api/admin/branches/route.ts ซึ่งตรวจสิทธิ์ชุดเดียวกันอีกรอบ
 * — สองด่านนี้ต้องมีทั้งคู่ ด่านใดด่านหนึ่งหายไปคือช่องโหว่
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/supabase/admin-guard";
import { listKnownBranches, listUnknownBranches } from "@/lib/supabase/locations";
import BranchesEditor from "./branches-editor";

/** ต้องรันบน Node.js runtime และห้าม cache — ข้อมูลเปลี่ยนทุกครั้งที่กรอก */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminBranchesPage() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    console.warn(`[admin] ปฏิเสธการเปิดหน้าจัดการสาขา: ${admin.reason}`);
    notFound();
  }

  const [unknown, known] = await Promise.all([
    listUnknownBranches(),
    listKnownBranches(),
  ]);

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
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
            แอดมิน
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          พิกัดสาขาขนส่ง
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-faint">
          สาขาที่ยังไม่มีพิกัดจะไม่แสดงแผนที่ให้ผู้ใช้ (แสดงเป็นชื่อสถานที่แทน)
          กรอกพิกัดแล้วแผนที่จะขึ้นทันทีในการบันทึกครั้งถัดไป
        </p>
        <p className="mt-1 font-mono text-[11px] text-faint">
          เข้าสู่ระบบเป็น {admin.email}
        </p>
        <Link
          href="/admin/stats"
          className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-4"
        >
          ดูสถิติระบบ
        </Link>

        <BranchesEditor unknown={unknown} known={known} />
      </main>
    </div>
  );
}
