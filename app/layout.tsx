import type { Metadata } from "next";
import { Anuphan, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${anuphan.variable} ${plexSansThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
