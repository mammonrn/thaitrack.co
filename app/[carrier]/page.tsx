import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CARRIER_LANDINGS, findLanding } from "@/lib/carriers/landing";
import { absoluteUrl } from "@/lib/site";
import SiteHeader from "../site-header";
import TrackingSearch from "../tracking-search";

/**
 * หน้า landing รายขนส่ง — /เช็คพัสดุ-flash และพี่น้อง
 *
 * ------------------------------------------------------------------
 * ทำไมเป็น [carrier] ที่ระดับบนสุด แทนที่จะเป็น /tracking/[carrier]
 *
 * เพราะ URL ที่ต้องการเป็นภาษาไทยทั้งก้อน ("/เช็คพัสดุ-flash") และ Next รองรับ
 * dynamic segment เฉพาะทั้ง segment — โฟลเดอร์ต้องชื่อ [carrier] เป๊ะๆ จะทำ
 * "เช็คพัสดุ-[carrier]" ไม่ได้
 *
 * ผลข้างเคียงที่ต้องระวัง: segment นี้จับ path ระดับบนสุดทุกอันที่ไม่ตรงกับ
 * route แบบตายตัว (/history, /profile, /admin, /api ชนะเสมอเพราะเจาะจงกว่า)
 * จึงต้องปิด dynamicParams เพื่อให้ path ที่ไม่อยู่ในรายการตอบ 404 ทันที
 * ไม่ใช่พยายาม render แล้วค่อยพัง
 * ------------------------------------------------------------------
 *
 * ⚠️ หน้านี้ต้องไม่ยิง API ของขนส่งตอน render เด็ดขาด — โควตามีจำกัดและ
 * crawler เข้ามาเมื่อไรก็ได้ ทุกอย่างที่เห็นตอนโหลดมาจากไฟล์ในโปรเจกต์ล้วน
 * การค้นหาเกิดขึ้นก็ต่อเมื่อผู้ใช้กดปุ่มเท่านั้น
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return CARRIER_LANDINGS.map((carrier) => ({ carrier: carrier.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ carrier: string }>;
}): Promise<Metadata> {
  const { carrier } = await params;
  const landing = findLanding(decodeURIComponent(carrier));
  if (landing === undefined) return {};

  const title = `${landing.heading} ด้วยเลขพัสดุ — พัสดุไทย.com`;

  return {
    title,
    description: landing.description,
    alternates: { canonical: absoluteUrl(`/${landing.slug}`) },
    openGraph: {
      title,
      description: landing.description,
      url: absoluteUrl(`/${landing.slug}`),
      type: "website",
      locale: "th_TH",
    },
  };
}

export default async function CarrierLandingPage({
  params,
}: {
  params: Promise<{ carrier: string }>;
}) {
  const { carrier } = await params;
  const landing = findLanding(decodeURIComponent(carrier));
  if (landing === undefined) notFound();

  /*
   * JSON-LD ของ FAQ — ทำให้คำถาม-คำตอบมีสิทธิ์ขึ้นเป็น rich result ใน Google
   *
   * ⚠️ Google กำหนดว่าเนื้อหาใน JSON-LD ต้องเป็นเนื้อหาเดียวกับที่ผู้ใช้เห็น
   * บนหน้าจริง จึง render จากตัวแปรชุดเดียวกันกับที่ใช้วาดหน้า ไม่ใช่เขียนซ้ำ
   */
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: landing.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <TrackingSearch
          title={landing.heading}
          intro={landing.intro}
          footnote={`ค้นได้ทุกขนส่งจากช่องเดียวกัน ไม่ใช่เฉพาะ${landing.name}`}
          placeholder={landing.placeholder}
          courierHint={landing.courierCode ?? undefined}
        />

        <section className="border-t border-line px-4 py-10 sm:px-6 sm:py-14">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
                รูปแบบเลขพัสดุของ{landing.name}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {landing.numberFormat}
              </p>
            </div>

            <div>
              <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
                คำถามที่พบบ่อย
              </h2>
              <dl className="mt-4 flex flex-col gap-5">
                {landing.faqs.map((faq) => (
                  <div key={faq.question}>
                    <dt className="font-display text-base font-semibold text-ink">
                      {faq.question}
                    </dt>
                    <dd className="mt-1.5 text-sm leading-relaxed text-body">
                      {faq.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h2 className="font-display text-lg font-semibold text-ink sm:text-xl">
                ขนส่งเจ้าอื่น
              </h2>
              <ul className="mt-4 flex flex-wrap gap-2.5">
                {CARRIER_LANDINGS.filter((other) => other.slug !== landing.slug).map(
                  (other) => (
                    <li key={other.slug}>
                      <Link
                        href={`/${other.slug}`}
                        className="flex min-h-11 items-center rounded-xl border border-line bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:border-line-strong"
                      >
                        {other.name}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <script
        type="application/ld+json"
        // เนื้อหามาจากไฟล์ในโปรเจกต์ ไม่ใช่ข้อมูลจากผู้ใช้หรือปลายทาง
        // (ถ้าวันหนึ่งมีข้อมูลจากภายนอกมาอยู่ตรงนี้ ต้อง escape ก่อนเสมอ)
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
