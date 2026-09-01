import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  PROVINCES,
  countTambons,
  findProvince,
  postcodesOf,
  provincePostcodes,
} from "@/lib/postcodes";
import { absoluteUrl } from "@/lib/site";
import SiteHeader from "../../site-header";

/** ทุกจังหวัดถูกสร้างล่วงหน้าเป็น static — ชื่อที่ไม่มีในรายการตอบ 404 */
export const dynamicParams = false;

export function generateStaticParams() {
  return PROVINCES.map((province) => ({ province: province.name }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ province: string }>;
}): Promise<Metadata> {
  const province = findProvince(decodeURIComponent((await params).province));
  if (province === undefined) return {};

  const codes = provincePostcodes(province);
  const title = `รหัสไปรษณีย์จังหวัด${province.name} ครบทุกอำเภอ — พัสดุไทย.com`;

  return {
    title,
    description:
      `รหัสไปรษณีย์จังหวัด${province.name} ทั้งหมด ${codes.length} รหัส ` +
      `ครอบคลุม ${province.amphoes.length} อำเภอ ${countTambons(province)} ตำบล`,
    alternates: {
      canonical: absoluteUrl(`/รหัสไปรษณีย์/${province.name}`),
    },
  };
}

export default async function ProvincePage({
  params,
}: {
  params: Promise<{ province: string }>;
}) {
  const name = decodeURIComponent((await params).province);
  const province = findProvince(name);
  if (province === undefined) notFound();

  const codes = provincePostcodes(province);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "หน้าแรก", item: absoluteUrl("/") },
      {
        "@type": "ListItem",
        position: 2,
        name: "รหัสไปรษณีย์",
        item: absoluteUrl("/รหัสไปรษณีย์"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `จังหวัด${province.name}`,
        item: absoluteUrl(`/รหัสไปรษณีย์/${province.name}`),
      },
    ],
  };

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <nav aria-label="เส้นทาง" className="text-xs text-faint">
          <Link href="/รหัสไปรษณีย์" className="hover:text-ink">
            รหัสไปรษณีย์
          </Link>
          <span className="mx-1.5">›</span>
          <span className="text-ink">{province.name}</span>
        </nav>

        <h1 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          รหัสไปรษณีย์จังหวัด{province.name}
        </h1>
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-faint sm:text-base">
          จังหวัด{province.name}มี {province.amphoes.length} อำเภอ{" "}
          {countTambons(province)} ตำบล ใช้รหัสไปรษณีย์ทั้งหมด {codes.length} รหัส
          ตั้งแต่ {codes[0]} ถึง {codes[codes.length - 1]}
        </p>

        <h2 className="mt-9 font-display text-lg font-semibold text-ink sm:text-xl">
          เลือกอำเภอ
        </h2>
        <ul className="mt-4 flex flex-col">
          {province.amphoes.map((amphoe) => {
            const amphoeCodes = postcodesOf(amphoe);

            return (
              <li key={amphoe.name} className="border-b border-line last:border-0">
                <Link
                  href={`/รหัสไปรษณีย์/${province.name}/${amphoe.name}`}
                  className="flex min-h-12 items-center gap-3 px-1 transition-colors hover:bg-ink/5"
                >
                  <span className="text-sm text-ink">อำเภอ{amphoe.name}</span>
                  <span className="ml-auto font-mono text-[11px] text-faint">
                    {amphoeCodes.join(" · ")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
