"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ------------------------------------------------------------------ *
 * ไอคอนเส้น — ใช้ภาษาเดียวกับโลโก้: viewBox 24, เส้นหนา 2, ปลายมน
 * ------------------------------------------------------------------ */

interface IconProps {
  className?: string;
}

/** กล่องพัสดุมีเส้นคาด — หน้าติดตามพัสดุ */
function ParcelIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="13" rx="2.5" />
      <path d="M3 11h18" />
      <path d="M9.5 6.5v4.5" />
    </svg>
  );
}

/** นาฬิกาย้อนเวลา — หน้าประวัติที่บันทึกไว้ */
function HistoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.2 4.6v3.9h3.9" />
      <path d="M12 8v4.4l3 1.8" />
    </svg>
  );
}

/** หมุดปักแผนที่ — หน้ารหัสไปรษณีย์ */
function PinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21c4-4.4 6-7.6 6-10a6 6 0 1 0-12 0c0 2.4 2 5.6 6 10z" />
      <circle cx="12" cy="11" r="2.3" />
    </svg>
  );
}

/** รูปคนครึ่งตัว — หน้าโปรไฟล์ */
function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c0-3.6 3.2-5.8 7.2-5.8s7.2 2.2 7.2 5.8" />
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** true เมื่อ path ปัจจุบันถือว่าอยู่ในเมนูนี้ */
  isActive: (pathname: string) => boolean;
  /**
   * ยังไม่มีหน้าปลายทาง จึงไม่แสดงในแถบเมนู
   *
   * เก็บนิยามไว้แทนที่จะลบทิ้ง เพราะไอคอนกับข้อความออกแบบไว้แล้ว พอทำหน้าจริง
   * เสร็จเมื่อไรแค่ลบบรรทัดนี้กับใส่ href ที่ถูกต้องก็กลับมาใช้ได้ทันที
   */
  comingSoon?: boolean;
}

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "ติดตาม",
    Icon: ParcelIcon,
    // หน้า landing รายขนส่ง (/เช็คพัสดุ-flash) เป็นหน้าติดตามเหมือนกัน
    // คนที่เข้ามาจาก Google แล้วเห็นเมนูไม่สว่างสักแท็บ จะไม่รู้ว่าตัวเองอยู่ไหน
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/เช็คพัสดุ-"),
  },
  {
    href: "/history",
    label: "ประวัติ",
    Icon: HistoryIcon,
    isActive: (pathname) => pathname.startsWith("/history"),
  },
  {
    href: "/profile",
    label: "โปรไฟล์",
    Icon: PersonIcon,
    isActive: (pathname) => pathname.startsWith("/profile"),
  },
  {
    href: "/รหัสไปรษณีย์",
    label: "รหัสไปรษณีย์",
    Icon: PinIcon,
    // รับ /postcode ด้วย เพราะเป็นปลายทางจริงของ rewrite — ผู้ใช้ไม่เห็น path นี้
    // แต่ถ้าวันหนึ่งมีการ render จาก path ที่ rewrite แล้ว เมนูต้องยังถูกต้อง
    isActive: (pathname) =>
      pathname.startsWith("/รหัสไปรษณีย์") || pathname.startsWith("/postcode"),
  },
];

/**
 * แถบเมนูหลักของเว็บ
 *
 * บนมือถือติดอยู่ล่างจอตลอดเวลาแบบแอพ ส่วนจอใหญ่กลับไปเป็น footer ท้ายเนื้อหา
 * ตามเดิม เพราะแถบลอยล่างจอบนจอกว้างกินพื้นที่โดยไม่ได้ช่วยอะไร
 *
 * ระยะเผื่อ safe-area-inset-bottom ไว้สำหรับ iPhone ที่มีแถบ home indicator
 * (ต้องมี viewport-fit=cover ใน layout ด้วย ไม่งั้นค่านี้จะเป็น 0 เสมอ)
 */
/** เมนูที่มีหน้าปลายทางจริงแล้วเท่านั้น */
const VISIBLE_ITEMS = ITEMS.filter((item) => item.comingSoon !== true);

/**
 * path ที่เทียบกับกติกาของเมนูได้จริง
 *
 * ⚠️ usePathname() คืน path ที่ยัง percent-encoded อยู่ ("/%E0%B8%A3...") ส่วน
 * กติกาของเราเขียนเป็นภาษาไทย ถ้าไม่ decode ก่อน เมนูจะไม่มีวัน active บนหน้า
 * ที่ URL เป็นภาษาไทยเลย (เจอจากการยิงจริง — ทุกหน้าใหม่ไม่มีแท็บไหนสว่าง)
 *
 * decode ล้มได้เมื่อเจอ % ที่ไม่ใช่ escape ที่ถูกต้อง ซึ่งเกิดได้จาก URL ที่คน
 * พิมพ์เอง — คืนค่าเดิมไปแทนที่จะโยน error ใส่หน้าเว็บ
 */
function readablePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export default function SiteNav() {
  const pathname = readablePath(usePathname());

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:mt-auto sm:bg-paper sm:pb-0 sm:backdrop-blur-none"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch justify-around px-2 sm:justify-center sm:gap-10 sm:px-6 sm:py-1.5">
        {VISIBLE_ITEMS.map(({ href, label, Icon, isActive }) => {
          const active = isActive(pathname);

          return (
            <li key={label} className="flex-1 sm:flex-none">
              <Link
                href={href}
                /**
                 * ⚠️ ห้ามลบบรรทัดนี้โดยไม่อ่านเหตุผลก่อน — ไม่ได้เผลอใส่
                 *
                 * URL ภาษาไทยของหน้ารหัสไปรษณีย์ทำงานด้วย rewrite ใน
                 * next.config.ts (โฟลเดอร์จริงชื่อ /postcode) ผลข้างเคียงคือ
                 * **RSC prefetch ของ route ที่ถูก rewrite ตอบ 404** — Next
                 * ปรับ payload ของ route ที่ถูกเขียนทับไม่ได้ ทำให้ทุกครั้งที่
                 * โหลดหน้าที่มีแถบเมนูนี้ จะมี request เสียเปล่าหนึ่งครั้ง
                 * (การกดเข้าไปยังทำงานปกติ — Next ตกไปโหลดเต็มหน้าให้เอง)
                 *
                 * ทางอื่นที่ลองแล้ว **ไม่ได้ผล** (วัดด้วย chromium จริงทั้งคู่):
                 *   · เพิ่ม rewrite ที่ใช้ string ไทยแบบ decode คู่กับตัว
                 *     encoded เดิม → 404 เหมือนเดิมเป๊ะ เพราะ rewrite match
                 *     อยู่แล้ว ปัญหาอยู่ที่ฝั่ง client router ไม่ใช่การ match
                 *   · อัปเกรด Next เป็น 16.3.4 → ยัง InvalidCharacterError
                 *     ตอน prerender โฟลเดอร์ชื่อ Unicode เหมือน 16.3.3
                 *
                 * ก่อนจะลบบรรทัดนี้ทิ้ง ต้องยืนยันก่อนว่า Next แก้ปัญหา
                 * โฟลเดอร์ชื่อ Unicode แล้วจริง (ทดสอบด้วยการสร้าง
                 * app/<ชื่อไทย>/page.tsx แล้ว build ให้ผ่าน) เพราะถ้าแก้แล้ว
                 * เราจะเลิกใช้ rewrite ได้ และ prefetch จะกลับมาทำงานเอง
                 *
                 * ปิดเฉพาะลิงก์ที่มีอักษรนอก ASCII — ลิงก์อังกฤษ (/history,
                 * /profile) ยัง prefetch ตามปกติ
                 */
                prefetch={/[^\x00-\x7F]/.test(href) ? false : undefined}
                aria-current={active ? "page" : undefined}
                // ขั้นต่ำ 56px ทั้งกว้างและสูง เกินเกณฑ์นิ้วสัมผัส 44px
                className={`flex min-h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors sm:flex-row sm:gap-2 sm:py-1.5 ${
                  active
                    ? "text-ink"
                    : "text-faint hover:text-ink"
                }`}
              >
                <Icon className={`h-6 w-6 sm:h-5 sm:w-5 ${active ? "" : "opacity-80"}`} />
                <span
                  className={`text-[11px] leading-none sm:text-sm ${
                    active ? "font-semibold" : "font-normal"
                  }`}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
