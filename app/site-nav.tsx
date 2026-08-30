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

interface NavItem {
  href: string;
  label: string;
  Icon: (props: IconProps) => React.ReactElement;
  /** true เมื่อ path ปัจจุบันถือว่าอยู่ในเมนูนี้ */
  isActive: (pathname: string) => boolean;
}

const ITEMS: NavItem[] = [
  {
    href: "/",
    label: "ติดตาม",
    Icon: ParcelIcon,
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/history",
    label: "ประวัติ",
    Icon: HistoryIcon,
    isActive: (pathname) => pathname.startsWith("/history"),
  },
  {
    // ยังไม่มีหน้านี้ คงพฤติกรรมเดิมของ footer ไว้ก่อน
    href: "#",
    label: "รหัสไปรษณีย์",
    Icon: PinIcon,
    isActive: () => false,
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
export default function SiteNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:mt-auto sm:bg-paper sm:pb-0 sm:backdrop-blur-none"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch justify-around px-2 sm:justify-center sm:gap-10 sm:px-6 sm:py-1.5">
        {ITEMS.map(({ href, label, Icon, isActive }) => {
          const active = isActive(pathname);

          return (
            <li key={label} className="flex-1 sm:flex-none">
              <Link
                href={href}
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
