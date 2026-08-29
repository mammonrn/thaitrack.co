import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "พัสดุไทย.com — ติดตามพัสดุทุกขนส่งในที่เดียว",
  description:
    "ติดตามพัสดุจาก ไปรษณีย์ไทย, Flash Express, Kerry Express, J&T Express, SPX Express และอื่นๆ ได้ในที่เดียว",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
