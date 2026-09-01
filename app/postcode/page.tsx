import type { Metadata } from "next";
import Link from "next/link";

import { DATA_SOURCE, PROVINCES } from "@/lib/postcodes";
import { absoluteUrl } from "@/lib/site";
import SiteHeader from "../site-header";
import PostcodeSearch from "./postcode-search";

/**
 * /รหัสไปรษณีย์ — หน้ารวมจังหวัด
 *
 * ⚠️ ทั้งสายนี้เป็น static ล้วน ไม่มีการยิง API ของขนส่งเลยแม้แต่ครั้งเดียว
 * ข้อมูลมาจากไฟล์ในโปรเจกต์ (ดู lib/postcodes.ts)
 */
export const metadata: Metadata = {
  title: "รหัสไปรษณีย์ไทย ค้นตามจังหวัด อำเภอ ตำบล — พัสดุไทย.com",
  description:
    "ค้นรหัสไปรษณีย์ทุกจังหวัดในไทย ไล่ดูตามอำเภอและตำบล หรือกรอกรหัสเพื่อดูว่าเป็นพื้นที่ไหน",
  alternates: { canonical: absoluteUrl("/รหัสไปรษณีย์") },
};

export default function PostcodeIndexPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "หน้าแรก",
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "รหัสไปรษณีย์",
        item: absoluteUrl("/รหัสไปรษณีย์"),
      },
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          รหัสไปรษณีย์ไทย
        </h1>
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-faint sm:text-base">
          เลือกจังหวัดเพื่อไล่ดูรหัสไปรษณีย์รายอำเภอและตำบล
          หรือกรอกรหัสที่มีอยู่แล้วเพื่อดูว่าเป็นพื้นที่ไหน
        </p>

        <PostcodeSearch />

        <h2 className="mt-10 font-display text-lg font-semibold text-ink sm:text-xl">
          เลือกจังหวัด
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVINCES.map((province) => (
            <li key={province.name}>
              <Link
                href={`/รหัสไปรษณีย์/${province.name}`}
                className="flex min-h-11 items-center rounded-lg px-2.5 text-sm text-ink transition-colors hover:bg-ink/5"
              >
                {province.name}
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-xs leading-relaxed text-faint">
          ข้อมูลรหัสไปรษณีย์มาจากชุดข้อมูลสาธารณะ{" "}
          <a
            href={DATA_SOURCE.url}
            rel="noopener noreferrer"
            target="_blank"
            className="underline decoration-line-strong underline-offset-4"
          >
            jquery.Thailand.js
          </a>{" "}
          ({DATA_SOURCE.license}) ปรับปรุงล่าสุดที่เรานำมาใช้ {DATA_SOURCE.fetchedAt}
          {" · "}
          หากพบข้อมูลที่ไม่ตรงกับความจริง ให้ยึดตามประกาศของไปรษณีย์ไทยเป็นหลัก
        </p>
      </main>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
