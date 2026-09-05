import type { Metadata, Viewport } from "next";
import { Anuphan, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";
import InstallInvite from "./install-invite";
import ReferrerProbe from "./referrer-probe";
import ServiceWorkerRegistrar from "./service-worker-registrar";
import SiteNav from "./site-nav";
import Script from "next/script";


// หัวข้อ — รูปทรงเรขาคณิต มีบุคลิกชัดตอนขนาดใหญ่ (ดู DESIGN.md)
const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

// เนื้อหา — ออกแบบมาเพื่ออ่านขนาดเล็ก เหมาะกับมือถือ
const plexSansThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "พัสดุไทย.com — เช็คพัสดุถึงไหนแล้ว",
  description:
    "ติดตามพัสดุจาก ไปรษณีย์ไทย, Flash Express, Kerry Express, J&T Express, SPX Express และอื่นๆ ได้ในที่เดียว",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "พัสดุไทย",
    // ให้แถบสถานะกลืนไปกับพื้นกระดาษของหัวเว็บ
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // ต้องเป็น cover ไม่งั้น env(safe-area-inset-*) จะเป็น 0 เสมอ แถบล่างจะไปทับ
  // home indicator ของ iPhone
  viewportFit: "cover",
  themeColor: "#f6f3ec",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${plexSansThai.variable} h-full antialiased`}
    >

      {/* เผื่อระยะล่างเท่าความสูงแถบเมนู + safe area กันแถบลอยบังเนื้อหาท้ายหน้า
          จอใหญ่ไม่ต้องเผื่อ เพราะแถบกลับไปอยู่ในสายเนื้อหาตามปกติ

          --install-invite-space เป็น 0 เกือบตลอดเวลา จะมีค่าเฉพาะตอนการ์ดชวน
          ติดตั้งลอยอยู่เท่านั้น (ดู app/install-invite.tsx) */}
      <body className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom)+var(--install-invite-space,0px))] sm:pb-0">
        {/* ⚠️ ต้องทำงานก่อนโค้ดของ Next ทุกตัว — Chrome ยิง beforeinstallprompt
            ได้ก่อน React hydrate เสร็จ (วัดจริงบนเครื่องนี้: listener ของ hook
            มาช้ากว่า 340–480 ms) event ที่ยิงตอนไม่มีคนฟังหายไปเลย แล้วการ์ด
            ชวนติดตั้งจะไม่มีวันขึ้นสำหรับ page load นั้น โดยไม่มีอะไรพังให้เห็น
            (ดู lib/install-prompt-capture.ts)

            ทำไมเป็นไฟล์ static + beforeInteractive ไม่ใช่ inline script:
            ลองใส่ <head> ที่เขียนเองใน layout แล้ว — App Router ทิ้งทั้งก้อน
            สคริปต์ไม่โผล่ใน HTML เลย และ hydration พังจนการ์ดไม่ขึ้นเลยทั้งสองทาง
            ลองใส่ <script> ธรรมดาใน <body> แล้ว — React 19 hoist ออกไปแล้ว
            เนื้อสคริปต์หายไปจาก HTML เหมือนกัน · beforeInteractive คือทางที่
            เอกสารของ Next 16 บอกไว้ตรงๆ (node_modules/next/dist/docs) */}
        <Script
          src="/install-prompt-capture.js"
          strategy="beforeInteractive"
        />
        {children}
        <SiteNav />
        <InstallInvite />
        <ReferrerProbe />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
