import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PROVINCES, findAmphoe, findProvince, postcodesOf } from "@/lib/postcodes";
import { absoluteUrl } from "@/lib/site";
import SiteHeader from "../../../site-header";

/**
 * หน้าอำเภอ — ชั้นล่างสุดที่เราสร้างเป็นหน้าจริง
 *
 * ตั้งใจหยุดที่ระดับอำเภอ ไม่ลงไปถึงตำบล: ตำบลมี 7,455 แห่ง ซึ่งจะกลายเป็น
 * หน้าที่มีเนื้อหาบรรทัดเดียวเกือบเหมือนกันหมด 7,455 หน้า — Google เรียกของ
 * แบบนั้นว่า thin content และมักไม่ index ให้ ที่แย่กว่าคือมันเจือจางน้ำหนัก
 * ของหน้าที่มีเนื้อหาจริง · ตำบลทั้งหมดอยู่ในตารางของหน้านี้อยู่แล้ว
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return PROVINCES.flatMap((province) =>
    province.amphoes.map((amphoe) => ({
      province: province.name,
      amphoe: amphoe.name,
    })),
  );
}

/** หาจังหวัดกับอำเภอจาก params — null เมื่อไม่มีอันใดอันหนึ่ง */
async function resolve(params: Promise<{ province: string; amphoe: string }>) {
  const raw = await params;
  const province = findProvince(decodeURIComponent(raw.province));
  if (province === undefined) return null;

  const amphoe = findAmphoe(province, decodeURIComponent(raw.amphoe));
  if (amphoe === undefined) return null;

  return { province, amphoe };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ province: string; amphoe: string }>;
}): Promise<Metadata> {
  const found = await resolve(params);
  if (found === null) return {};

  const { province, amphoe } = found;
  const codes = postcodesOf(amphoe);
  const title = `รหัสไปรษณีย์อำเภอ${amphoe.name} จังหวัด${province.name} — พัสดุไทย.com`;

  return {
    title,
    description:
      `รหัสไปรษณีย์อำเภอ${amphoe.name} จังหวัด${province.name} ` +
      `คือ ${codes.join(", ")} ครอบคลุม ${amphoe.tambons.length} ตำบล`,
    alternates: {
      canonical: absoluteUrl(`/รหัสไปรษณีย์/${province.name}/${amphoe.name}`),
    },
  };
}

export default async function AmphoePage({
  params,
}: {
  params: Promise<{ province: string; amphoe: string }>;
}) {
  const found = await resolve(params);
  if (found === null) notFound();

  const { province, amphoe } = found;
  const codes = postcodesOf(amphoe);

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
      {
        "@type": "ListItem",
        position: 4,
        name: `อำเภอ${amphoe.name}`,
        item: absoluteUrl(`/รหัสไปรษณีย์/${province.name}/${amphoe.name}`),
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
          <Link
            href={`/รหัสไปรษณีย์/${province.name}`}
            className="hover:text-ink"
          >
            {province.name}
          </Link>
          <span className="mx-1.5">›</span>
          <span className="text-ink">{amphoe.name}</span>
        </nav>

        <h1 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          รหัสไปรษณีย์อำเภอ{amphoe.name}
        </h1>
        <p className="mt-2.5 max-w-prose text-sm leading-relaxed text-faint sm:text-base">
          อำเภอ{amphoe.name} จังหวัด{province.name} ใช้รหัสไปรษณีย์{" "}
          {codes.length === 1 ? codes[0] : codes.join(" และ ")} ครอบคลุม{" "}
          {amphoe.tambons.length} ตำบล
        </p>

        <h2 className="mt-9 font-display text-lg font-semibold text-ink sm:text-xl">
          รหัสไปรษณีย์รายตำบล
        </h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left">
                <th scope="col" className="py-2 font-display font-semibold text-ink">
                  ตำบล
                </th>
                <th
                  scope="col"
                  className="py-2 text-right font-display font-semibold text-ink"
                >
                  รหัสไปรษณีย์
                </th>
              </tr>
            </thead>
            <tbody>
              {amphoe.tambons.map((tambon) => (
                <tr key={tambon.name} className="border-b border-line last:border-0">
                  <td className="py-2 text-body">ตำบล{tambon.name}</td>
                  <td className="py-2 text-right font-mono text-body">
                    {tambon.postcode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 font-display text-lg font-semibold text-ink sm:text-xl">
          อำเภออื่นในจังหวัด{province.name}
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {province.amphoes
            .filter((other) => other.name !== amphoe.name)
            .map((other) => (
              <li key={other.name}>
                <Link
                  href={`/รหัสไปรษณีย์/${province.name}/${other.name}`}
                  className="flex min-h-10 items-center rounded-lg border border-line bg-white px-3 text-[13px] text-ink transition-colors hover:border-line-strong"
                >
                  {other.name}
                </Link>
              </li>
            ))}
        </ul>
      </main>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
